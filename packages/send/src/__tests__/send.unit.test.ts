import { describe, expect, test } from 'bun:test'

import {
  BlockedDestinationException,
  ResponseTooLargeException,
  UpstreamException,
  UpstreamTimeoutException
} from '@postmano/core'
import type { Fetcher } from '../pinned.js'
import type { PreparedRequest } from '../prepare.js'
import { type SendDeps, sendRequest } from '../send.js'

const prepared = (overrides: Partial<PreparedRequest> = {}): PreparedRequest => ({
  method: 'GET',
  url: 'https://api.example.com/orders',
  headers: [['Authorization', 'Bearer x']],
  body: undefined,
  unresolved: [],
  ...overrides
})

const deps = (fetcher: Fetcher, addresses: Record<string, string[]> = {}): SendDeps => ({
  fetch: fetcher,
  lookup: async (host) => addresses[host] ?? ['93.184.216.34']
})

const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } })

describe('sendRequest', () => {
  test('returns status, headers, text body, size and the url it ended on', async () => {
    // Arrange
    const fetcher: Fetcher = async () => Response.json({ id: 1 }, { status: 201, statusText: 'Created' })

    // Act
    const result = await sendRequest(prepared(), {}, deps(fetcher))

    // Assert
    expect(result).toMatchObject({
      status: 201,
      statusText: 'Created',
      body: '{"id":1}',
      bodyEncoding: 'utf8',
      sizeBytes: 8
    })
    expect(result.headers).toContainEqual(['content-type', 'application/json;charset=utf-8'])
    expect(result.finalUrl).toBe('https://api.example.com/orders')
    expect(result.redirects).toEqual([])
  })

  test('returns a non-text body as base64', async () => {
    // Arrange
    const fetcher: Fetcher = async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd]))

    // Act
    const result = await sendRequest(prepared(), {}, deps(fetcher))

    // Assert
    expect(result.bodyEncoding).toBe('base64')
    expect(result.body).toBe(Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'))
  })

  test('does not follow redirects by itself: the fetch is called with redirect manual', async () => {
    // Arrange
    let seen: RequestInit | undefined
    const fetcher: Fetcher = async (_url, init) => {
      seen = init
      return new Response('ok')
    }

    // Act
    await sendRequest(prepared(), {}, deps(fetcher))

    // Assert
    expect(seen?.redirect).toBe('manual')
  })

  test('follows a redirect, records it, and turns 303 into a GET without a body', async () => {
    // Arrange
    const calls: { url: string; method: string | undefined; body: unknown }[] = []
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body })
      return calls.length === 1 ? redirect(303, '/done') : new Response('done')
    }
    const post = prepared({ method: 'POST', body: { kind: 'text', text: '{}', contentType: 'application/json' } })

    // Act
    const result = await sendRequest(post, {}, deps(fetcher))

    // Assert
    expect(result.body).toBe('done')
    expect(result.redirects).toEqual(['https://api.example.com/done'])
    expect(calls[1]).toEqual({ url: 'https://api.example.com/done', method: 'GET', body: null })
  })

  test('keeps the method and body on a 307', async () => {
    // Arrange
    const methods: (string | undefined)[] = []
    const fetcher: Fetcher = async (_url, init) => {
      methods.push(init.method)
      return methods.length === 1 ? redirect(307, '/again') : new Response('ok')
    }
    const post = prepared({ method: 'POST', body: { kind: 'text', text: 'x', contentType: undefined } })

    // Act
    await sendRequest(post, {}, deps(fetcher))

    // Assert
    expect(methods).toEqual(['POST', 'POST'])
  })

  test('keeps only neutral headers when a redirect leaves the origin', async () => {
    // Arrange
    const headersSeen: [string, string][][] = []
    const fetcher: Fetcher = async (_url, init) => {
      headersSeen.push(init.headers as [string, string][])
      return headersSeen.length === 1 ? redirect(302, 'https://other.example.org/x') : new Response('ok')
    }
    const input = prepared({
      headers: [
        ['Authorization', 'Bearer x'],
        ['Cookie', 'a=b'],
        ['X-Api-Key', 'k'],
        ['Accept', 'text/plain']
      ]
    })

    // Act
    await sendRequest(input, {}, deps(fetcher))

    // Assert
    expect(headersSeen[0]?.map(([name]) => name)).toEqual(['Authorization', 'Cookie', 'X-Api-Key', 'Accept'])
    expect(headersSeen[1]).toEqual([['Accept', 'text/plain']])
  })

  test('refuses a redirect that points at the metadata service', async () => {
    // Arrange
    const fetcher: Fetcher = async () => redirect(302, 'http://169.254.169.254/latest/meta-data/')

    // Act & Assert
    await expect(sendRequest(prepared(), {}, deps(fetcher))).rejects.toThrow(BlockedDestinationException)
  })

  test('refuses the first url too, before any request goes out', async () => {
    // Arrange
    let called = false
    const fetcher: Fetcher = async () => {
      called = true
      return new Response('x')
    }

    // Act & Assert
    await expect(
      sendRequest(
        prepared({ url: 'https://intranet.example.com/' }),
        {},
        deps(fetcher, { 'intranet.example.com': ['10.0.0.5'] })
      )
    ).rejects.toThrow(BlockedDestinationException)
    expect(called).toBe(false)
  })

  test('stops after the maximum number of redirects', async () => {
    // Arrange
    const fetcher: Fetcher = async () => redirect(302, '/again')

    // Act & Assert
    await expect(sendRequest(prepared(), { maxRedirects: 2 }, deps(fetcher))).rejects.toThrow(
      /Stopped after 2 redirects/
    )
  })

  test('refuses a response bigger than the limit', async () => {
    // Arrange
    const fetcher: Fetcher = async () => new Response('x'.repeat(100))

    // Act & Assert
    await expect(sendRequest(prepared(), { maxResponseBytes: 50 }, deps(fetcher))).rejects.toThrow(
      ResponseTooLargeException
    )
  })

  test('maps a network failure and a timeout to their own errors', async () => {
    // Arrange
    const failing: Fetcher = async () => {
      throw new TypeError('connect ECONNREFUSED')
    }
    const slow: Fetcher = async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })

    // Act & Assert
    await expect(sendRequest(prepared(), {}, deps(failing))).rejects.toThrow(UpstreamException)
    await expect(sendRequest(prepared(), { timeoutMs: 20 }, deps(slow))).rejects.toThrow(UpstreamTimeoutException)
  })
})
