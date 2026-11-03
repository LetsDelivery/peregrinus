import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer as httpServer, type Server, type ServerResponse } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { BlockedDestinationException } from '@peregrinus/core'

import { createPinnedFetcher } from '../pinned.js'

const open = { isAllowed: () => true }
let http: Server
let https: Server
let httpUrl: string
let httpsUrl: string
const seen: { method: string | undefined; body: string; headers: Record<string, string | string[] | undefined> }[] = []

/** A self-signed certificate for localhost, made for this run, so no private key is kept in the repository. */
const selfSigned = (): { key: Buffer; cert: Buffer } => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-cert-'))
  const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')]
  const made = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout',
    key,
    '-out',
    cert
  ])
  if (made.status !== 0) {
    throw new Error(`openssl could not make the test certificate: ${made.stderr}`)
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `${server instanceof Object && 'setSecureContext' in server ? 'https' : 'http'}://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const REPLIES: Record<string, (response: ServerResponse) => void> = {
  '/redirect': (response) => response.writeHead(302, { location: '/target' }).end(),
  '/gzip': (response) =>
    response
      .writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' })
      .end(gzipSync('compressed hello')),
  '/empty': (response) => response.writeHead(204).end()
}

beforeAll(async () => {
  const handler: Parameters<typeof httpServer>[1] = (request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      seen.push({ method: request.method, body, headers: request.headers })
      const reply = REPLIES[request.url ?? '']
      reply ? reply(response) : response.writeHead(200, { 'set-cookie': ['a=1', 'b=2'] }).end('ok')
    })
  }
  http = httpServer(handler)
  https = httpsServer(selfSigned(), handler)
  httpUrl = (await listen(http)).replace('https', 'http')
  httpsUrl = (await listen(https)).replace('http:', 'https:')
})

afterAll(() => {
  http.close()
  https.close()
})

describe('createPinnedFetcher', () => {
  test('returns status, a text body and every Set-Cookie header', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)

    // Act
    const response = await fetcher(`${httpUrl}/`, { method: 'GET' })

    // Assert
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  })

  test('does not follow a redirect, and sends a plain client default headers', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)
    seen.length = 0

    // Act
    const response = await fetcher(`${httpUrl}/redirect`, { method: 'GET' })

    // Assert
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/target')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.headers['user-agent']).toBe('peregrinus')
    expect(seen[0]?.headers.accept).toBe('*/*')
  })

  test('decompresses a gzip body and drops the encoding headers', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)

    // Act
    const response = await fetcher(`${httpUrl}/gzip`, { method: 'GET' })

    // Assert
    expect(await response.text()).toBe('compressed hello')
    expect(response.headers.get('content-encoding')).toBeNull()
  })

  test('answers 204 without a body', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)

    // Act
    const response = await fetcher(`${httpUrl}/empty`, { method: 'GET' })

    // Assert
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  test('sends a text body and a multipart form with its boundary', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)
    const form = new FormData()
    form.append('note', 'hi')
    seen.length = 0

    // Act
    await fetcher(`${httpUrl}/`, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })
    await fetcher(`${httpUrl}/`, { method: 'POST', body: form })

    // Assert
    expect(seen[0]).toMatchObject({ method: 'POST', body: '{"a":1}' })
    expect(String(seen[1]?.headers['content-type'])).toStartWith('multipart/form-data; boundary=')
    expect(seen[1]?.body).toContain('name="note"')
  })

  test('refuses a name that resolves to a private address, at connection time', async () => {
    // Arrange
    const port = new URL(httpUrl).port
    const fetcher = createPinnedFetcher()

    // Act & Assert
    await expect(fetcher(`http://localhost:${port}/`, { method: 'GET' })).rejects.toThrow(BlockedDestinationException)
  })

  test('refuses an IP literal that is not allowed, before connecting', async () => {
    // Arrange
    seen.length = 0
    const fetcher = createPinnedFetcher()

    // Act & Assert
    await expect(fetcher(httpUrl, { method: 'GET' })).rejects.toThrow(BlockedDestinationException)
    expect(seen).toHaveLength(0)
  })

  test('rejects a self-signed certificate, and accepts it when the person asks to', async () => {
    // Arrange
    const strict = createPinnedFetcher(open)
    const lenient = createPinnedFetcher({ ...open, insecureTls: true })

    // Act & Assert
    await expect(strict(`${httpsUrl}/`, { method: 'GET' })).rejects.toThrow()
    const response = await lenient(`${httpsUrl}/`, { method: 'GET' })
    expect(await response.text()).toBe('ok')
  })

  test('stops a request when the signal aborts', async () => {
    // Arrange
    const fetcher = createPinnedFetcher(open)
    const signal = AbortSignal.abort()

    // Act & Assert
    await expect(fetcher(`${httpUrl}/`, { method: 'GET', signal })).rejects.toThrow()
  })
})
