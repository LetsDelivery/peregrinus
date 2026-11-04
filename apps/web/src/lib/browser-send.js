import { effectiveAuth, prepareRequest } from '@postmano/send/browser'

import { ApiError } from './api.js'

const bodyOf = (body) => {
  if (body?.kind === 'form') {
    const form = new FormData()
    for (const [key, value] of body.fields) {
      form.append(key, value)
    }
    return form
  }
  return body?.text
}

const decode = (bytes) => {
  try {
    return { body: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bodyEncoding: 'utf8' }
  } catch {
    return { body: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')), bodyEncoding: 'base64' }
  }
}

/**
 * Sends from this browser, for `localhost` and the person's own network. It builds the request with the same
 * code the server uses, but the browser decides what it may do: the destination has to allow CORS, and a few
 * headers (Host, Cookie, ...) are ignored. Redirects are followed by the browser and not listed.
 */
export const sendFromBrowser = async ({ request, parents, variables }) => {
  const scopes = [variables.local ?? {}, variables.environment ?? {}, variables.collection ?? {}, {}]
  const prepared = prepareRequest(request, effectiveAuth(request.auth, parents), scopes)
  const started = performance.now()
  let response
  try {
    response = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: bodyOf(prepared.body)
    })
  } catch (error) {
    throw new ApiError('browser_blocked', String(error.message ?? error))
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    unresolved: prepared.unresolved,
    result: {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      ...decode(bytes),
      sizeBytes: bytes.byteLength,
      timeMs: Math.round(performance.now() - started),
      finalUrl: response.url,
      redirects: []
    }
  }
}
