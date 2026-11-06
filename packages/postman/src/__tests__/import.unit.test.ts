import { describe, expect, test } from 'bun:test'

import { InvalidRequestException } from '@postmano/core'

import { importPostmanCollection } from '../import.js'

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

const fixture = () => ({
  info: { name: 'Orders API', description: 'Docs **here**', schema: SCHEMA },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
  item: [
    {
      name: 'Orders',
      description: { content: 'Everything about orders' },
      item: [
        {
          name: 'Get order',
          event: [{ listen: 'test', script: { exec: ['pm.test("ok")'] } }],
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }],
            url: {
              raw: '{{baseUrl}}/orders/:id?expand=items&debug=1',
              host: ['{{baseUrl}}'],
              path: ['orders', ':id'],
              query: [
                { key: 'expand', value: 'items', description: 'Related data' },
                { key: 'debug', value: '1', disabled: true }
              ]
            }
          },
          response: [
            {
              name: 'Order found',
              status: 'OK',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '{"id":1}',
              _postman_previewlanguage: 'json'
            }
          ]
        },
        {
          name: 'Create order',
          request: {
            method: 'POST',
            url: '{{baseUrl}}/orders',
            auth: { type: 'oauth2', oauth2: [{ key: 'accessToken', value: 'x' }] },
            body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } }
          }
        }
      ]
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/files',
        auth: { type: 'noauth' },
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'file', type: 'file', src: '/tmp/a.png' },
            { key: 'note', value: 'hi' }
          ]
        }
      }
    }
  ]
})

describe('importPostmanCollection', () => {
  test('reads the collection name, description, auth and variables', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    expect(collection.name).toBe('Orders API')
    expect(collection.description).toBe('Docs **here**')
    expect(collection.auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(collection.variables).toEqual([{ key: 'baseUrl', value: 'https://api.example.com', secret: false }])
  })

  test('keeps a Postman secret variable secret, so it never reaches a public page', () => {
    // Arrange
    const input = {
      ...fixture(),
      variable: [
        { key: 'apiKey', value: 'S3CR3T', type: 'secret' },
        { key: 'baseUrl', value: 'x' }
      ]
    }

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    expect(collection.variables.map((variable) => [variable.key, variable.secret])).toEqual([
      ['apiKey', true],
      ['baseUrl', false]
    ])
  })

  test('says so when an authorization cannot be read, instead of importing it empty and quiet', () => {
    // Arrange
    const input = { ...fixture(), auth: { type: 'bearer', bearer: 'not-a-list' } }

    // Act
    const { warnings } = importPostmanCollection(input)

    // Assert
    expect(warnings.map((warning) => warning.message).join(' ')).toContain('could not be read')
  })

  test('keeps folders nested and requests under them, in order', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    const [orders, upload] = collection.items
    expect(orders?.kind).toBe('folder')
    expect(orders?.kind === 'folder' && orders.children.map((child) => child.name)).toEqual([
      'Get order',
      'Create order'
    ])
    expect(upload?.kind).toBe('request')
  })

  test('splits the url from the structured query rows and keeps disabled flags', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    const orders = collection.items[0]
    const request = orders?.kind === 'folder' ? orders.children[0] : undefined
    expect(request?.kind === 'request' && request.url).toBe('{{baseUrl}}/orders/:id')
    expect(request?.kind === 'request' && request.query).toEqual([
      { key: 'expand', value: 'items', description: 'Related data', disabled: false },
      { key: 'debug', value: '1', description: undefined, disabled: true }
    ])
  })

  test('imports saved responses as examples', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    const orders = collection.items[0]
    const request = orders?.kind === 'folder' ? orders.children[0] : undefined
    expect(request?.kind === 'request' && request.examples[0]).toMatchObject({
      name: 'Order found',
      code: 200,
      body: '{"id":1}',
      language: 'json'
    })
  })

  test('reads a raw body with its language and a string url request', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    const orders = collection.items[0]
    const request = orders?.kind === 'folder' ? orders.children[1] : undefined
    expect(request?.kind === 'request' && request.body).toEqual({ mode: 'raw', language: 'json', content: '{"a":1}' })
    expect(request?.kind === 'request' && request.url).toBe('{{baseUrl}}/orders')
  })

  test('warns about OAuth, scripts and file fields without failing the import', () => {
    // Arrange
    const input = fixture()

    // Act
    const { warnings } = importPostmanCollection(input)

    // Assert
    const messages = warnings.map((warning) => warning.message)
    expect(messages).toContain('Authorization type "oauth2" is not supported and was kept as a label')
    expect(messages).toContain('1 items have scripts or tests, which are not imported')
    expect(messages).toContain('File fields are kept as rows but their files are not imported')
  })

  test('marks a request without auth as inherit and noauth as none', () => {
    // Arrange
    const input = fixture()

    // Act
    const { collection } = importPostmanCollection(input)

    // Assert
    const upload = collection.items[1]
    expect(upload?.kind === 'request' && upload.auth).toEqual({ type: 'none' })
    const orders = collection.items[0]
    const get = orders?.kind === 'folder' ? orders.children[0] : undefined
    expect(get?.kind === 'request' && get.auth).toEqual({ type: 'inherit' })
  })

  test('rejects a collection exported in another schema version', () => {
    // Arrange
    const input = { info: { name: 'x', schema: 'https://schema.postman.com/json/collection/v3.0.0/' }, item: [] }

    // Act & Assert
    expect(() => importPostmanCollection(input)).toThrow(InvalidRequestException)
  })

  test('rejects something that is not a collection', () => {
    // Arrange
    const input = { hello: 'world' }

    // Act & Assert
    expect(() => importPostmanCollection(input)).toThrow(/Not a Postman collection/)
  })

  test('cuts a saved response over 100 KB and says how many were cut', () => {
    // Arrange
    const big = 'x'.repeat(150_000)
    const input = {
      info: { name: 'Big', schema: SCHEMA },
      item: [
        {
          name: 'Dump',
          request: { method: 'GET', url: 'https://api.example.com/dump' },
          response: [
            { name: 'huge', code: 200, status: 'OK', body: big },
            { name: 'small', code: 200, status: 'OK', body: '{"ok":true}' }
          ]
        }
      ]
    }

    // Act
    const { collection, warnings } = importPostmanCollection(input)
    const node = collection.items[0]
    const examples = node?.kind === 'request' ? node.examples : []

    // Assert
    expect(examples[0]?.body.length).toBeLessThan(100_100)
    expect(examples[0]?.body).toContain('cut when imported: the original had 150 KB')
    expect(examples[1]?.body).toBe('{"ok":true}')
    expect(warnings.map((warning) => warning.message)).toContain(
      '1 saved responses were longer than 100 KB and were cut'
    )
  })
})
