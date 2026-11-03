import { randomUUID } from 'node:crypto'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

import { BlockedDestinationException } from '@peregrinus/core'

import { isBlockedAddress } from './guard.js'

/** Same shape as `fetch`, so tests and the browser build can hand over their own. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export type PinnedOptions = {
  /** Accept a certificate that does not verify: self-signed, expired, wrong host. Only when the person asks. */
  insecureTls?: boolean
  /** Decides whether the connection may go to an address. Tests open it for 127.0.0.1. */
  isAllowed?: (address: string) => boolean
}

const NO_BODY = new Set([101, 204, 205, 304])
const DECODERS = { gzip: createGunzip, 'x-gzip': createGunzip, deflate: createInflate, br: createBrotliDecompress }

const forbidden = (host: string, address: string): BlockedDestinationException =>
  new BlockedDestinationException(`"${host}" points to ${address}, which a request may not reach from the server`)

/**
 * The resolver `net.connect` calls to find the address to connect to. The check and the connection use the
 * same answer, so a name cannot pass the check with a public address and then connect to a private one
 * (DNS rebinding). Every address of the name must be allowed.
 */
const refusal = (
  hostname: string,
  error: Error | null,
  addresses: readonly LookupAddress[],
  isAllowed: (address: string) => boolean
): Error | undefined => {
  const bad = addresses.find((entry) => !isAllowed(entry.address))
  if (error) {
    return error
  }
  return addresses.length === 0 || bad ? forbidden(hostname, bad?.address ?? 'no address') : undefined
}

const answer = (
  callback: Parameters<LookupFunction>[2],
  all: boolean | undefined,
  addresses: LookupAddress[],
  refused: Error | undefined
): void => {
  const first = addresses[0]
  if (refused || !first) {
    callback((refused ?? new Error('No address')) as NodeJS.ErrnoException, '')
  } else if (all) {
    callback(null, addresses)
  } else {
    callback(null, first.address, first.family)
  }
}

const pinnedLookup =
  (isAllowed: (address: string) => boolean): LookupFunction =>
  (hostname, options, callback) => {
    dnsLookup(hostname, { all: true }, (error, addresses = []) =>
      answer(callback, options.all, addresses, refusal(hostname, error, addresses, isAllowed))
    )
  }

/** Headers a plain HTTP client adds on its own; `fetch` does the same. */
const withDefaults = (headers: Headers): Headers => {
  const merged = new Headers(headers)
  for (const [name, value] of [
    ['accept', '*/*'],
    ['user-agent', 'peregrinus'],
    ['accept-encoding', 'gzip, deflate, br']
  ] as const) {
    if (!merged.has(name)) {
      merged.set(name, value)
    }
  }
  return merged
}

const quoted = (value: string): string => value.replace(/[\r\n"]/g, '_')

/** A multipart/form-data body of text fields. Files are not sent, so there is no other kind of part. */
const multipart = (form: FormData): { bytes: Buffer; type: string } => {
  const boundary = `----peregrinus${randomUUID().replaceAll('-', '')}`
  const parts = [...form.entries()].map(
    ([name, value]) =>
      `--${boundary}\r\ncontent-disposition: form-data; name="${quoted(name)}"\r\n\r\n${String(value)}\r\n`
  )
  return {
    bytes: Buffer.from(`${parts.join('')}--${boundary}--\r\n`),
    type: `multipart/form-data; boundary=${boundary}`
  }
}

/** A body as bytes with the content type it needs. */
const encodeBody = async (
  body: BodyInit | null | undefined
): Promise<{ bytes: Buffer | undefined; type: string | null }> => {
  if (body === null || body === undefined) {
    return { bytes: undefined, type: null }
  }
  if (body instanceof FormData) {
    return multipart(body)
  }
  return { bytes: Buffer.from(await new Response(body).arrayBuffer()), type: null }
}

const decoded = (message: import('node:http').IncomingMessage): { stream: Readable; headers: Headers } => {
  const headers = new Headers()
  for (let at = 0; at < message.rawHeaders.length; at += 2) {
    headers.append(message.rawHeaders[at] ?? '', message.rawHeaders[at + 1] ?? '')
  }
  const encoding = (headers.get('content-encoding') ?? '').toLowerCase() as keyof typeof DECODERS
  const decoder = DECODERS[encoding]
  if (!decoder) {
    return { stream: message, headers }
  }
  headers.delete('content-encoding')
  headers.delete('content-length')
  return { stream: message.pipe(decoder()), headers }
}

/**
 * A `fetch` that connects through `pinnedLookup`, never follows a redirect and decompresses what it reads.
 * It is what runs in the Lambda; `sendRequest` still checks every URL first, for a clear error.
 */
export const createPinnedFetcher = (options: PinnedOptions = {}): Fetcher => {
  const isAllowed = options.isAllowed ?? ((address: string) => !isBlockedAddress(address))
  return async (url, init) => {
    const target = new URL(url)
    const host = target.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) !== 0 && !isAllowed(host)) {
      throw forbidden(target.hostname, host)
    }
    const headers = withDefaults(new Headers(init.headers))
    const { bytes, type } = await encodeBody(init.body)
    if (type && !headers.has('content-type')) {
      headers.set('content-type', type)
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    return await new Promise<Response>((resolve, reject) => {
      const request = send(
        target,
        {
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
          lookup: pinnedLookup(isAllowed),
          ...(init.signal ? { signal: init.signal } : {}),
          ...(options.insecureTls ? { rejectUnauthorized: false } : {})
        },
        (message) => {
          const { stream, headers: received } = decoded(message)
          const status = message.statusCode ?? 502
          const body = NO_BODY.has(status) ? null : (Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>)
          resolve(new Response(body, { status, statusText: message.statusMessage ?? '', headers: received }))
        }
      )
      request.on('error', reject)
      request.end(bytes)
    })
  }
}
