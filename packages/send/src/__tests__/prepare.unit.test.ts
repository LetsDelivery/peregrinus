import { describe, expect, test } from 'bun:test'

import type { Auth, RequestNode } from '@postmano/core'

import { effectiveAuth, prepareRequest } from '../prepare.js'

const request = (overrides: Partial<RequestNode> = {}): RequestNode => ({
  kind: 'request',
  name: 'Get order',
  method: 'get',
  url: '{{baseUrl}}/orders',
  query: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: [],
  ...overrides
})

const none: Auth = { type: 'none' }
const scopes = [{ baseUrl: 'https://api.example.com', token: 'T0K' }]

describe('effectiveAuth', () => {
  test('uses the request own auth, else the nearest parent, else none', () => {
    // Arrange
    const bearer: Auth = { type: 'bearer', token: 'a' }
    const basic: Auth = { type: 'basic', username: 'u', password: 'p' }

    // Act & Assert
    expect(effectiveAuth(bearer, [basic])).toEqual(bearer)
    expect(effectiveAuth({ type: 'inherit' }, [{ type: 'inherit' }, basic])).toEqual(basic)
    expect(effectiveAuth({ type: 'inherit' }, [])).toEqual(none)
  })
})

describe('prepareRequest', () => {
  test('resolves variables, upper-cases the method and appends enabled query rows', () => {
    // Arrange
    const input = request({
      query: [
        { key: 'expand', value: 'items', disabled: false },
        { key: 'debug', value: '1', disabled: true }
      ]
    })

    // Act
    const prepared = prepareRequest(input, none, scopes)

    // Assert
    expect(prepared.method).toBe('GET')
    expect(prepared.url).toBe('https://api.example.com/orders?expand=items')
  })

  test('reports unresolved variables and still builds the request', () => {
    // Arrange
    const input = request({ url: 'https://api.example.com/{{missing}}' })

    // Act
    const prepared = prepareRequest(input, none, scopes)

    // Assert
    expect(prepared.unresolved).toEqual(['missing'])
    expect(prepared.url).toContain('missing')
  })

  test('applies bearer, basic and api key (header and query) auth', () => {
    // Arrange
    const input = request()

    // Act
    const bearer = prepareRequest(input, { type: 'bearer', token: '{{token}}' }, scopes)
    const basic = prepareRequest(input, { type: 'basic', username: 'ana', password: 'pw' }, scopes)
    const header = prepareRequest(input, { type: 'apikey', key: 'X-Key', value: 'k', in: 'header' }, scopes)
    const query = prepareRequest(input, { type: 'apikey', key: 'key', value: 'k', in: 'query' }, scopes)

    // Assert
    expect(bearer.headers).toContainEqual(['Authorization', 'Bearer T0K'])
    expect(basic.headers).toContainEqual(['Authorization', `Basic ${Buffer.from('ana:pw').toString('base64')}`])
    expect(header.headers).toContainEqual(['X-Key', 'k'])
    expect(query.url).toBe('https://api.example.com/orders?key=k')
  })

  test('keeps an Authorization header the person set instead of overriding it', () => {
    // Arrange
    const input = request({ headers: [{ key: 'authorization', value: 'Custom x', disabled: false }] })

    // Act
    const prepared = prepareRequest(input, { type: 'bearer', token: 'ignored' }, scopes)

    // Assert
    expect(prepared.headers).toEqual([['authorization', 'Custom x']])
  })

  test('drops Host and Content-Length headers and disabled rows', () => {
    // Arrange
    const input = request({
      headers: [
        { key: 'Host', value: 'evil.example', disabled: false },
        { key: 'Content-Length', value: '1', disabled: false },
        { key: 'X-Off', value: 'no', disabled: true },
        { key: 'X-On', value: 'yes', disabled: false }
      ]
    })

    // Act
    const prepared = prepareRequest(input, none, scopes)

    // Assert
    expect(prepared.headers).toEqual([['X-On', 'yes']])
  })

  test('encodes a raw json body and sets the content type once', () => {
    // Arrange
    const input = request({ method: 'POST', body: { mode: 'raw', language: 'json', content: '{"t":"{{token}}"}' } })

    // Act
    const prepared = prepareRequest(input, none, scopes)

    // Assert
    expect(prepared.body).toEqual({ kind: 'text', text: '{"t":"T0K"}', contentType: 'application/json' })
    expect(prepared.headers).toEqual([['Content-Type', 'application/json']])
  })

  test('does not override a content type the person set', () => {
    // Arrange
    const input = request({
      body: { mode: 'raw', language: 'json', content: '{}' },
      headers: [{ key: 'Content-Type', value: 'application/vnd.api+json', disabled: false }]
    })

    // Act
    const prepared = prepareRequest(input, none, scopes)

    // Assert
    expect(prepared.headers).toEqual([['Content-Type', 'application/vnd.api+json']])
  })

  test('encodes urlencoded, formdata (text only) and graphql bodies', () => {
    // Arrange
    const urlencoded = request({
      body: { mode: 'urlencoded', fields: [{ key: 'a b', value: 'c&d', disabled: false }] }
    })
    const formdata = request({
      body: {
        mode: 'formdata',
        fields: [
          { key: 'note', value: 'hi', disabled: false, type: 'text' },
          { key: 'file', value: '', disabled: false, type: 'file' }
        ]
      }
    })
    const graphql = request({ body: { mode: 'graphql', query: '{ me { id } }', variables: '{"id":1}' } })

    // Act
    const a = prepareRequest(urlencoded, none, scopes).body
    const b = prepareRequest(formdata, none, scopes).body
    const c = prepareRequest(graphql, none, scopes).body

    // Assert
    expect(a).toEqual({ kind: 'text', text: 'a+b=c%26d', contentType: 'application/x-www-form-urlencoded' })
    expect(b).toEqual({ kind: 'form', fields: [['note', 'hi']] })
    expect(c).toEqual({
      kind: 'text',
      text: '{"query":"{ me { id } }","variables":{"id":1}}',
      contentType: 'application/json'
    })
  })

  test('rejects an invalid url and an unsupported auth type', () => {
    // Arrange
    const broken = request({ url: 'not a url' })

    // Act & Assert
    expect(() => prepareRequest(broken, none, scopes)).toThrow(/Invalid URL "not a url"/)
    expect(() => prepareRequest(request(), { type: 'unsupported', original: 'oauth2' }, scopes)).toThrow(/oauth2/)
  })
})

describe('prepareRequest, lenient url', () => {
  test('keeps an unresolved base url as written for the documentation, query included', () => {
    // Arrange
    const input = request({ url: '{{baseUrl}}/orders', query: [{ key: 'a', value: '1', disabled: false }] })

    // Act
    const prepared = prepareRequest(input, none, [], { lenientUrl: true })

    // Assert
    expect(prepared.url).toBe('{{baseUrl}}/orders?a=1')
    expect(prepared.unresolved).toEqual(['baseUrl'])
  })

  test('still refuses it when not lenient', () => {
    // Act & Assert
    expect(() => prepareRequest(request({ url: '{{baseUrl}}/orders' }), none, [])).toThrow(/Invalid URL/)
  })
})
