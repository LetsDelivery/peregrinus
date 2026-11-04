import { type Auth, type Body, InvalidRequestException, type KeyValue, type RequestNode } from '@postmano/core'

import { createResolver, type DynamicSource, type Scopes } from './variables.js'

export type PreparedBody =
  | { kind: 'text'; text: string; contentType: string | undefined }
  | { kind: 'form'; fields: [string, string][] }

export type PreparedRequest = {
  method: string
  url: string
  headers: [string, string][]
  body: PreparedBody | undefined
  /** `{{names}}` no scope defined: the request still goes out with them as written. */
  unresolved: string[]
}

const RAW_TYPES = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript'
} as const

/** The auth a request runs with: its own, else the nearest parent's (closest first), else none. */
export const effectiveAuth = (own: Auth, parents: readonly Auth[]): Auth =>
  [own, ...parents].find((auth) => auth.type !== 'inherit') ?? { type: 'none' }

const enabled = (rows: readonly KeyValue[]): KeyValue[] => rows.filter((row) => !row.disabled && row.key !== '')

const prepareBody = (body: Body, resolve: (text: string) => string): PreparedBody | undefined => {
  switch (body.mode) {
    case 'raw':
      return { kind: 'text', text: resolve(body.content), contentType: RAW_TYPES[body.language] }
    case 'urlencoded': {
      const params = new URLSearchParams(enabled(body.fields).map((row) => [resolve(row.key), resolve(row.value)]))
      return { kind: 'text', text: params.toString(), contentType: 'application/x-www-form-urlencoded' }
    }
    case 'formdata':
      return {
        kind: 'form',
        fields: enabled(body.fields)
          .filter((row) => row.key !== '' && (row as { type?: string }).type !== 'file')
          .map((row) => [resolve(row.key), resolve(row.value)])
      }
    case 'graphql': {
      const variables = body.variables.trim() === '' ? {} : (JSON.parse(resolve(body.variables)) as unknown)
      return {
        kind: 'text',
        text: JSON.stringify({ query: resolve(body.query), variables }),
        contentType: 'application/json'
      }
    }
    default:
      return undefined
  }
}

/** UTF-8 text as base64, with `btoa` so the same code runs in the browser. */
const base64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

const authHeader = (auth: Auth, resolve: (text: string) => string): [string, string] | undefined => {
  if (auth.type === 'bearer') {
    return ['Authorization', `Bearer ${resolve(auth.token)}`]
  }
  if (auth.type === 'basic') {
    const credentials = `${resolve(auth.username)}:${resolve(auth.password)}`
    return ['Authorization', `Basic ${base64(credentials)}`]
  }
  return auth.type === 'apikey' && auth.in === 'header' ? [resolve(auth.key), resolve(auth.value)] : undefined
}

const withQuery = (base: string, pairs: readonly [string, string][]): string => {
  const query = new URLSearchParams(pairs as [string, string][]).toString()
  return query === '' ? base : `${base}${base.includes('?') ? '&' : '?'}${query}`
}

/**
 * The address with the query rows on it. A URL that does not parse is an error, unless `lenient` is on (the
 * documentation page): then it is kept as written, with the query appended, so `{{baseUrl}}/orders` shows as is.
 */
const buildUrl = (request: RequestNode, auth: Auth, resolve: (text: string) => string, lenient: boolean): string => {
  const resolved = resolve(request.url)
  const pairs = enabled(request.query).map((row): [string, string] => [resolve(row.key), resolve(row.value)])
  if (auth.type === 'apikey' && auth.in === 'query') {
    pairs.push([resolve(auth.key), resolve(auth.value)])
  }
  try {
    const url = new URL(resolved)
    for (const [key, value] of pairs) {
      url.searchParams.append(key, value)
    }
    return url.toString()
  } catch {
    if (lenient) {
      return withQuery(resolved, pairs)
    }
    throw new InvalidRequestException(`Invalid URL "${resolved}"`)
  }
}

const buildHeaders = (request: RequestNode, extra: [string, string] | undefined, resolve: (text: string) => string) => {
  const rows = enabled(request.headers).map((row): [string, string] => [resolve(row.key), resolve(row.value)])
  const dropped = new Set(['host', 'content-length'])
  const headers = rows.filter(([name]) => !dropped.has(name.toLowerCase()))
  const has = (name: string) => headers.some(([key]) => key.toLowerCase() === name.toLowerCase())
  return extra && !has(extra[0]) ? [...headers, extra] : headers
}

/**
 * Turns a request of the collection into what goes on the wire: variables resolved, disabled rows
 * dropped, the auth applied, the body encoded and the content type set unless the person set one.
 */
export type PrepareOptions = { dynamic?: DynamicSource; lenientUrl?: boolean }

export const prepareRequest = (
  request: RequestNode,
  auth: Auth,
  scopes: Scopes,
  options: PrepareOptions = {}
): PreparedRequest => {
  if (auth.type === 'unsupported') {
    throw new InvalidRequestException(`Authorization type "${auth.original}" is not supported yet`)
  }
  const resolver = options.dynamic ? createResolver(scopes, options.dynamic) : createResolver(scopes)
  const url = buildUrl(request, auth, resolver.resolve, options.lenientUrl === true)
  const body = prepareBody(request.body, resolver.resolve)
  const headers = buildHeaders(request, authHeader(auth, resolver.resolve), resolver.resolve)
  const hasType = headers.some(([name]) => name.toLowerCase() === 'content-type')
  if (body?.kind === 'text' && body.contentType && !hasType) {
    headers.push(['Content-Type', body.contentType])
  }
  return { method: request.method.toUpperCase(), url, headers, body, unresolved: resolver.unresolved() }
}
