import { ResponseTooLargeException, UpstreamException, UpstreamTimeoutException } from '@peregrinus/core'

import { assertPublicDestination, type Lookup, systemLookup } from './guard.js'
import { createPinnedFetcher, type Fetcher } from './pinned.js'
import type { PreparedBody, PreparedRequest } from './prepare.js'

export type SendOptions = { timeoutMs: number; maxRedirects: number; maxResponseBytes: number; insecureTls: boolean }

export const DEFAULT_OPTIONS: SendOptions = {
  timeoutMs: 25_000,
  maxRedirects: 5,
  maxResponseBytes: 3 * 1024 * 1024,
  insecureTls: false
}

/** What a caller may change; a field left out, or `undefined`, keeps its default. */
export type SendOverrides = { [K in keyof SendOptions]?: SendOptions[K] | undefined }

const withDefaults = (overrides: SendOverrides): SendOptions => ({
  timeoutMs: overrides.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
  maxRedirects: overrides.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects,
  maxResponseBytes: overrides.maxResponseBytes ?? DEFAULT_OPTIONS.maxResponseBytes,
  insecureTls: overrides.insecureTls ?? DEFAULT_OPTIONS.insecureTls
})

/** `fetch` is the pinned fetcher unless a test hands over its own. */
export type SendDeps = { fetch?: Fetcher; lookup: Lookup }
const systemDeps: SendDeps = { lookup: systemLookup }

export type SendResult = {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  /** `base64` when the body is not valid UTF-8 text. */
  bodyEncoding: 'utf8' | 'base64'
  sizeBytes: number
  timeMs: number
  finalUrl: string
  redirects: string[]
}

type Hop = { url: string; method: string; headers: [string, string][]; body: PreparedBody | undefined }

const REDIRECTS = new Set([301, 302, 303, 307, 308])

const bodyInit = (body: PreparedBody | undefined): string | FormData | null => {
  if (body?.kind === 'form') {
    const form = new FormData()
    for (const [key, value] of body.fields) {
      form.append(key, value)
    }
    return form
  }
  return body?.text ?? null
}

const classify = (error: unknown, url: string, timeoutMs: number): Error => {
  const host = new URL(url).host
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new UpstreamTimeoutException(`No response from ${host} within ${timeoutMs} ms`)
  }
  return new UpstreamException(`Could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`)
}

/** The headers that may follow a redirect to another origin: they say what the person wants, not who they are. */
const NEUTRAL_HEADERS = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'cache-control',
  'content-type',
  'content-length',
  'user-agent'
])

/** The next hop for a redirect: 303, and 301/302 on a POST, become a GET without a body; 307/308 repeat the request. */
const followRedirect = (response: Response, hop: Hop): Hop | undefined => {
  const location = response.headers.get('location')
  if (!REDIRECTS.has(response.status) || location === null) {
    return undefined
  }
  const url = new URL(location, hop.url)
  const toGet =
    response.status === 303 || ((response.status === 301 || response.status === 302) && hop.method === 'POST')
  const sameOrigin = url.origin === new URL(hop.url).origin
  const kept = hop.headers.filter(([name]) => sameOrigin || NEUTRAL_HEADERS.has(name.toLowerCase()))
  return toGet
    ? {
        url: url.toString(),
        method: 'GET',
        headers: kept.filter(([name]) => !name.toLowerCase().startsWith('content-')),
        body: undefined
      }
    : { ...hop, url: url.toString(), headers: kept }
}

const readBody = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (let part = await reader?.read(); part && !part.done; part = await reader?.read()) {
    total += part.value.byteLength
    if (total > maxBytes) {
      await reader?.cancel()
      throw new ResponseTooLargeException(`The response is larger than ${maxBytes} bytes`)
    }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks)
}

const decode = (bytes: Uint8Array): Pick<SendResult, 'body' | 'bodyEncoding'> => {
  try {
    return { body: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bodyEncoding: 'utf8' }
  } catch {
    return { body: Buffer.from(bytes).toString('base64'), bodyEncoding: 'base64' }
  }
}

/**
 * Sends a prepared request from the server. Every hop is checked against the destination guard, redirects
 * are followed by hand up to a limit, and the time and the size of the response are capped.
 */
export const sendRequest = async (
  prepared: PreparedRequest,
  overrides: SendOverrides = {},
  deps: SendDeps = systemDeps
): Promise<SendResult> => {
  const options = withDefaults(overrides)
  const fetcher = deps.fetch ?? createPinnedFetcher({ insecureTls: options.insecureTls })
  const signal = AbortSignal.timeout(options.timeoutMs)
  const started = performance.now()
  const redirects: string[] = []
  let hop: Hop = { url: prepared.url, method: prepared.method, headers: prepared.headers, body: prepared.body }
  for (;;) {
    await assertPublicDestination(new URL(hop.url), deps.lookup)
    const response = await fetcher(hop.url, {
      method: hop.method,
      headers: hop.headers,
      body: bodyInit(hop.body),
      redirect: 'manual',
      signal
    }).catch((error: unknown) => {
      throw classify(error, hop.url, options.timeoutMs)
    })
    const next = followRedirect(response, hop)
    if (!next) {
      const bytes = await readBody(response, options.maxResponseBytes)
      return {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        ...decode(bytes),
        sizeBytes: bytes.byteLength,
        timeMs: Math.round(performance.now() - started),
        finalUrl: hop.url,
        redirects
      }
    }
    if (redirects.length >= options.maxRedirects) {
      throw new UpstreamException(`Stopped after ${options.maxRedirects} redirects`)
    }
    redirects.push(next.url)
    hop = next
  }
}
