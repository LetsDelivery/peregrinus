import { describe, expect, test } from 'bun:test'

import type { Collection, RequestNode } from '@peregrinus/core'
import { prepareRequest } from '@peregrinus/send/browser'

import { renderDocumentation, renderStandalone } from '../render.js'
import { snippet } from '../snippets.js'

const request = (overrides: Partial<RequestNode> = {}): RequestNode => ({
  kind: 'request',
  name: 'Get order',
  description: 'Returns **one** order.',
  method: 'GET',
  url: '{{baseUrl}}/orders/:id',
  query: [{ key: 'expand', value: 'items', description: 'Related data', disabled: false }],
  headers: [{ key: 'Accept', value: 'application/json', disabled: false }],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: [
    {
      name: 'Found',
      status: 'OK',
      code: 200,
      headers: [{ key: 'Content-Type', value: 'application/json', disabled: false }],
      body: '{"id":1}'
    }
  ],
  ...overrides
})

const collection = (): Collection => ({
  name: 'Orders <API>',
  description: 'All about orders.',
  auth: { type: 'bearer', token: 'REAL-SECRET-TOKEN' },
  variables: [],
  items: [{ kind: 'folder', name: 'Orders', auth: { type: 'inherit' }, children: [request()] }]
})

const options = { variables: { baseUrl: 'https://api.example.com' }, language: 'curl' as const }

describe('renderDocumentation', () => {
  test('has a table of contents with an anchor for the folder and for the request', () => {
    // Arrange
    const input = collection()

    // Act
    const html = renderDocumentation(input, options)

    // Assert
    expect(html).toContain('<a href="#n-0">Orders</a>')
    expect(html).toContain('href="#n-0-0"')
    expect(html).toContain('id="n-0-0"')
  })

  test('shows the request: method, url, description, query table and example response', () => {
    // Arrange
    const input = collection()

    // Act
    const html = renderDocumentation(input, options)

    // Assert
    expect(html).toContain('<span class="method m-get">GET</span> Get order')
    expect(html).toContain('<code>{{baseUrl}}/orders/:id</code>')
    expect(html).toContain('Returns <strong>one</strong> order.')
    expect(html).toContain('<code>expand</code>')
    expect(html).toContain('200 OK')
    expect(html).toContain('{&quot;id&quot;:1}')
  })

  test('never prints the collection auth token, only a placeholder, in text or in the snippet', () => {
    // Arrange
    const input = collection()

    // Act
    const html = renderDocumentation(input, options)

    // Assert
    expect(html).not.toContain('REAL-SECRET-TOKEN')
    expect(html).toContain('Authorization: Bearer &lt;token&gt;')
    expect(html).toContain('Bearer token (da pasta ou da coleção)')
  })

  test('puts a variable in the snippet only when the caller handed it over, so secrets stay as written', () => {
    // Arrange
    const input = collection()

    // Act
    const withValue = renderDocumentation(input, options)
    const withoutValue = renderDocumentation(input, { ...options, variables: {} })

    // Assert
    expect(withValue).toContain('https://api.example.com/orders/:id?expand=items')
    expect(withoutValue).toContain('{{baseUrl}}/orders/:id?expand=items')
  })

  test('escapes names and descriptions from the collection', () => {
    // Arrange
    const input = collection()

    // Act
    const html = renderDocumentation(input, options)

    // Assert
    expect(html).toContain('Orders &lt;API&gt;')
    expect(html).not.toContain('Orders <API>')
  })

  test('the standalone page is a full document with its style and the same content', () => {
    // Arrange
    const input = collection()

    // Act
    const page = renderStandalone(input, options)

    // Assert
    expect(page).toStartWith('<!doctype html>')
    expect(page).toContain('<style>')
    expect(page).toContain('id="n-0-0"')
    expect(page).not.toContain('REAL-SECRET-TOKEN')
  })
})

describe('snippet', () => {
  const prepared = prepareRequest(
    request({ method: 'POST', body: { mode: 'raw', language: 'json', content: `{"name":"O'Neil"}` } }),
    { type: 'none' },
    [{ baseUrl: 'https://api.example.com' }]
  )

  test('writes a cURL command that quotes a single quote in the body', () => {
    // Act
    const text = snippet('curl', prepared)

    // Assert
    expect(text).toStartWith("curl --request 'POST' 'https://api.example.com/orders/:id?expand=items'")
    expect(text).toContain("--data-raw '{\"name\":\"O'\\''Neil\"}'")
  })

  test('writes a fetch call and a Python call with the same method, url, headers and body', () => {
    // Act
    const js = snippet('javascript', prepared)
    const py = snippet('python', prepared)

    // Assert
    expect(js).toContain('await fetch("https://api.example.com/orders/:id?expand=items"')
    expect(js).toContain('method: "POST"')
    expect(js).toContain(`body: "{\\"name\\":\\"O'Neil\\"}"`)
    expect(py).toContain('requests.request("POST", "https://api.example.com/orders/:id?expand=items"')
    expect(py).toContain('"Content-Type": "application/json"')
  })

  test('writes a form body for each language', () => {
    // Arrange
    const form = prepareRequest(
      request({
        method: 'POST',
        body: { mode: 'formdata', fields: [{ key: 'note', value: 'hi', disabled: false, type: 'text' }] }
      }),
      { type: 'none' },
      [{ baseUrl: 'https://api.example.com' }]
    )

    // Act & Assert
    expect(snippet('curl', form)).toContain("--form-string 'note=hi'")
    expect(snippet('javascript', form)).toContain('form.append("note", "hi")')
    expect(snippet('python', form)).toContain('files={"note": (None, "hi")}')
  })
})

describe('renderDocumentation, English', () => {
  test('writes the headings and table headers it adds itself in English when asked', () => {
    // Arrange
    const input = collection()

    // Act
    const html = renderDocumentation(input, { ...options, locale: 'en' })

    // Assert
    expect(html).toContain('<h3>Query parameters</h3>')
    expect(html).toContain('<th>Name</th><th>Value</th><th>Description</th>')
    expect(html).toContain('<h3>Example request</h3>')
    expect(html).toContain('<h3>Example responses</h3>')
    expect(html).toContain('Bearer token (from the folder or the collection)')
    expect(html).toContain('Authorization: Bearer &lt;token&gt;')
    expect(html).not.toContain('Parâmetros de query')
  })

  test('uses Portuguese when no language is given, and never prints the real token in either', () => {
    // Arrange
    const input = collection()

    // Act
    const pt = renderDocumentation(input, options)
    const en = renderDocumentation(input, { ...options, locale: 'en' })

    // Assert
    expect(pt).toContain('<h3>Parâmetros de query</h3>')
    expect(pt + en).not.toContain('REAL-SECRET-TOKEN')
  })
})
