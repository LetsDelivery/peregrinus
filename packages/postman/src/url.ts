import type { KeyValue } from '@postmano/core'

import type { RawUrl } from './raw.js'
import { toKeyValues } from './text.js'

export type ParsedUrl = { url: string; query: KeyValue[] }

const parseQueryString = (queryString: string): KeyValue[] =>
  queryString
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const at = pair.indexOf('=')
      const key = at < 0 ? pair : pair.slice(0, at)
      return { key, value: at < 0 ? '' : pair.slice(at + 1), disabled: false }
    })

const splitQuery = (value: string): ParsedUrl => {
  const at = value.indexOf('?')
  if (at < 0) {
    return { url: value, query: [] }
  }
  return { url: value.slice(0, at), query: parseQueryString(value.slice(at + 1)) }
}

const joinPath = (path: unknown): string => {
  const parts = Array.isArray(path) ? path : [path]
  return parts
    .map((part) => (typeof part === 'object' && part !== null ? (part as { value?: string }).value : part))
    .filter((part): part is string => typeof part === 'string')
    .join('/')
}

const assemble = (url: Exclude<RawUrl, string | undefined>): string => {
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
  const origin = `${url.protocol ? `${url.protocol}://` : ''}${host}${url.port ? `:${url.port}` : ''}`
  const path = joinPath(url.path)
  return path === '' ? origin : `${origin}/${path}`
}

/**
 * The request URL split into the address and its query rows. The query rows come from the structured
 * `query` array when the file has one, because it keeps descriptions and disabled flags that `raw` loses.
 */
export const parseUrl = (raw: RawUrl): ParsedUrl => {
  if (raw === undefined) {
    return { url: '', query: [] }
  }
  if (typeof raw === 'string') {
    return splitQuery(raw)
  }
  const base = raw.raw === undefined ? { url: assemble(raw), query: [] } : splitQuery(raw.raw)
  return raw.query ? { url: base.url, query: toKeyValues(raw.query) } : base
}
