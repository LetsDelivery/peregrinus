import { describe, expect, test } from 'bun:test'

import { InvalidRequestException } from '../exceptions.js'
import type { Collection, FolderNode, RequestNode } from '../model.js'
import { findSecrets, folderNamesAt, HIDDEN, publicationSchema, publicView, viewerView } from '../publication.js'

const request = (overrides: Partial<RequestNode> = {}): RequestNode => ({
  kind: 'request',
  name: 'Get order',
  method: 'GET',
  url: '{{baseUrl}}/orders',
  query: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: [],
  ...overrides
})

const folder = (children: FolderNode['children'], overrides: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder',
  name: 'Orders',
  auth: { type: 'inherit' },
  children,
  ...overrides
})

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  name: 'Shop',
  auth: { type: 'bearer', token: 'COLLECTION-TOKEN' },
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com', secret: false },
    { key: 'apiSecret', value: 'VARIABLE-SECRET', secret: true }
  ],
  items: [],
  ...overrides
})

describe('publicView', () => {
  test('takes the token, password and key value out of every auth, at every level', () => {
    // Arrange
    const input = collection({
      items: [
        folder([request({ auth: { type: 'basic', username: 'ana', password: 'REQUEST-PASSWORD' } })], {
          auth: { type: 'apikey', key: 'X-Key', value: 'FOLDER-KEY', in: 'header' }
        })
      ]
    })

    // Act
    const view = publicView(input, [])

    // Assert
    const text = JSON.stringify(view)
    for (const secret of ['COLLECTION-TOKEN', 'REQUEST-PASSWORD', 'FOLDER-KEY', 'ana']) {
      expect(text).not.toContain(secret)
    }
    expect(view.auth).toEqual({ type: 'bearer', token: '' })
    expect(JSON.stringify(view)).toContain('"key":"X-Key"')
  })

  test('drops secret variables and keeps the public ones', () => {
    // Act
    const view = publicView(collection(), [])

    // Assert
    expect(view.variables).toEqual([{ key: 'baseUrl', value: 'https://api.example.com', secret: false }])
    expect(JSON.stringify(view)).not.toContain('VARIABLE-SECRET')
  })

  test('hides the value of credential headers, query parameters and form fields, and of cookies in saved responses', () => {
    // Arrange
    const input = collection({
      items: [
        request({
          headers: [
            { key: 'Authorization', value: 'Bearer HEADER-SECRET', disabled: false },
            { key: 'X-Api-Key', value: 'KEY-SECRET', disabled: false },
            { key: 'Accept', value: 'application/json', disabled: false }
          ],
          query: [
            { key: 'access_token', value: 'QUERY-SECRET', disabled: false },
            { key: 'page', value: '2', disabled: false }
          ],
          body: {
            mode: 'urlencoded',
            fields: [
              { key: 'password', value: 'FORM-SECRET', disabled: false },
              { key: 'name', value: 'Ana', disabled: false }
            ]
          },
          examples: [
            {
              name: 'ok',
              status: 'OK',
              code: 200,
              headers: [{ key: 'Set-Cookie', value: 'session=COOKIE-SECRET', disabled: false }],
              body: '{}'
            }
          ]
        })
      ]
    })

    // Act
    const view = publicView(input, [])

    // Assert
    const text = JSON.stringify(view)
    for (const secret of ['HEADER-SECRET', 'KEY-SECRET', 'QUERY-SECRET', 'FORM-SECRET', 'COOKIE-SECRET']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain(HIDDEN)
    expect(text).toContain('application/json')
    expect(text).toContain('"page"')
    expect(text).toContain('"Ana"')
  })

  test('does not change the collection it was given', () => {
    // Arrange
    const input = collection({
      items: [request({ headers: [{ key: 'Authorization', value: 'Bearer X', disabled: false }] })]
    })
    const before = JSON.stringify(input)

    // Act
    publicView(input, [])

    // Assert
    expect(JSON.stringify(input)).toBe(before)
  })

  test('publishes one folder as if it were the collection, with the kind of auth that applies to it', () => {
    // Arrange
    const inner = folder([request({ name: 'Inside' })], { name: 'Inner', description: 'Deep' })
    const input = collection({
      items: [folder([inner], { name: 'Outer', auth: { type: 'inherit' } }), request({ name: 'Elsewhere' })]
    })

    // Act
    const view = publicView(input, [0, 0])

    // Assert
    expect(view.name).toBe('Inner')
    expect(view.description).toBe('Deep')
    expect(view.items.map((item) => item.name)).toEqual(['Inside'])
    expect(view.auth).toEqual({ type: 'bearer', token: '' })
    expect(JSON.stringify(view)).not.toContain('Elsewhere')
    expect(JSON.stringify(view)).not.toContain('COLLECTION-TOKEN')
  })

  test('refuses a folder path that leads to nothing or to a request', () => {
    // Arrange
    const input = collection({ items: [folder([request()]), request({ name: 'Loose' })] })

    // Act & Assert
    expect(() => publicView(input, [5])).toThrow(InvalidRequestException)
    expect(() => publicView(input, [1])).toThrow(/does not lead to a folder/)
    expect(() => publicView(input, [0, 0])).toThrow(InvalidRequestException)
  })
})

describe('findSecrets', () => {
  const withBody = (content: string) =>
    collection({ items: [folder([request({ name: 'Login', body: { mode: 'raw', language: 'json', content } })])] })

  test.each([
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'],
    ['a bearer token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789'],
    ['an AWS access key', 'key AKIAIOSFODNN7EXAMPLE'],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['a Slack token', 'xoxb-1234567890-abcdefghij'],
    ['a GitHub token', `ghp_${'a'.repeat(36)}`]
  ])('finds %s and names the request', (kind, content) => {
    // Act
    const found = findSecrets(withBody(content))

    // Assert
    expect(found).toEqual([{ path: 'Orders / Login', kind }])
  })

  test('does not flag a variable, a placeholder or ordinary text', () => {
    // Act & Assert
    expect(findSecrets(withBody('Authorization: Bearer {{token}}'))).toEqual([])
    expect(findSecrets(withBody('Authorization: Bearer <token>'))).toEqual([])
    expect(findSecrets(withBody('{"name":"Ana","note":"nothing secret here"}'))).toEqual([])
  })

  test('looks in the url, headers, query, descriptions and saved responses, not only the body', () => {
    // Arrange
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    const input = collection({
      items: [
        request({ name: 'In header', headers: [{ key: 'X', value: token, disabled: false }] }),
        request({ name: 'In example', examples: [{ name: 'e', status: 'OK', code: 200, headers: [], body: token }] }),
        request({ name: 'In description', description: `use ${token}` })
      ]
    })

    // Act
    const found = findSecrets(input)

    // Assert
    expect(found.map((item) => item.path)).toEqual(['In header', 'In example', 'In description'])
  })
})

describe('publicView, credentials that no list names', () => {
  const row = (key: string, value: string) => ({ key, value, disabled: false })

  test('takes the user, the password and the credential parameters out of the address', () => {
    // Arrange
    const input = collection({
      items: [request({ url: 'https://ana:URLPASS@api.example.com/y?api_key=URLQUERY&page=2&access_token=T2' })]
    })

    // Act
    const view = publicView(input, [])

    // Assert
    const text = JSON.stringify(view)
    for (const secret of ['ana:', 'URLPASS', 'URLQUERY', 'T2']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('https://api.example.com/y?api_key=<hidden>&page=2&access_token=<hidden>')
  })

  test('hides headers, query and form fields by what their name says, not by a list', () => {
    // Arrange
    const input = collection({
      items: [
        request({
          headers: [
            row('X-Amz-Security-Token', 'AMZ-SECRET'),
            row('Ocp-Apim-Subscription-Key', 'APIM-SECRET'),
            row('X-Goog-Api-Key', 'GOOG-SECRET'),
            row('Accept-Language', 'pt-BR')
          ],
          query: [row('X-Amz-Signature', 'SIG-SECRET'), row('refresh_token', 'REFRESH-SECRET'), row('author', 'Ana')]
        })
      ]
    })

    // Act
    const text = JSON.stringify(publicView(input, []))

    // Assert
    for (const secret of ['AMZ-SECRET', 'APIM-SECRET', 'GOOG-SECRET', 'SIG-SECRET', 'REFRESH-SECRET']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('pt-BR')
    expect(text).toContain('"Ana"')
  })

  test('hides credential keys inside JSON bodies, of a request and of a saved response, and leaves the rest', () => {
    // Arrange
    const input = collection({
      items: [
        request({
          body: {
            mode: 'raw',
            language: 'json',
            content: '{"user":"ana","password":"RAWSECRET","nested":{"client_secret":"DEEP"}}'
          },
          examples: [{ name: 'ok', status: 'OK', code: 200, headers: [], body: '{"access_token":"EXSECRET","id":7}' }]
        }),
        request({ name: 'Plain', body: { mode: 'raw', language: 'text', content: 'not json, kept as it is' } })
      ]
    })

    // Act
    const view = publicView(input, [])

    // Assert
    const text = JSON.stringify(view)
    for (const secret of ['RAWSECRET', 'DEEP', 'EXSECRET']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('ana')
    expect(text).toContain('not json, kept as it is')
  })

  test('keeps a JSON body byte for byte when it has nothing to hide', () => {
    // Arrange
    const content = '{"a":   1}'
    const input = collection({ items: [request({ body: { mode: 'raw', language: 'json', content } })] })

    // Act
    const view = publicView(input, [])

    // Assert
    expect(JSON.stringify(view)).toContain(JSON.stringify(content).slice(1, -1))
  })

  test('drops a variable named like a credential even when it is not marked secret, and cuts an odd auth type', () => {
    // Arrange
    const input = collection({
      auth: { type: 'unsupported', original: 'x'.repeat(40) },
      variables: [
        { key: 'apiKey', value: 'VAR-SECRET', secret: false },
        { key: 'baseUrl', value: 'https://api.example.com', secret: false }
      ]
    })

    // Act
    const view = publicView(input, [])

    // Assert
    expect(view.variables.map((variable) => variable.key)).toEqual(['baseUrl'])
    expect(view.auth).toEqual({ type: 'unsupported', original: '' })
  })
})

describe('viewerView', () => {
  test('keeps the whole collection but empties every secret value', () => {
    // Arrange
    const input = collection({ items: [request({ auth: { type: 'bearer', token: 'REQ-TOKEN' } })] })

    // Act
    const view = viewerView(input)

    // Assert
    const text = JSON.stringify(view)
    for (const secret of ['COLLECTION-TOKEN', 'VARIABLE-SECRET', 'REQ-TOKEN']) {
      expect(text).not.toContain(secret)
    }
    expect(view.variables.map((variable) => variable.key)).toEqual(['baseUrl', 'apiSecret'])
  })
})

describe('findSecrets, what the redaction cannot see', () => {
  test('finds a password in free text, a collection description and a key-value description', () => {
    // Arrange
    const input = collection({
      description: 'login with password: hunter2hunter2',
      items: [
        folder(
          [
            request({
              name: 'A',
              query: [{ key: 'q', value: '1', description: 'secret=abcdef123456', disabled: false }]
            })
          ],
          {
            description: 'client_secret: abcdef123456'
          }
        )
      ]
    })

    // Act
    const found = findSecrets(input)

    // Assert
    expect(found.map((item) => item.path)).toEqual(['Shop', 'Orders', 'Orders / A'])
  })

  test('does not flag what the redaction already took out, nor a placeholder', () => {
    // Arrange
    const input = collection({
      items: [
        request({
          url: 'https://ana:PASS@api.example.com/y?token=ABCDEFGHIJ',
          body: { mode: 'raw', language: 'json', content: '{"password":"RAWSECRET","note":"password: {{pass}}"}' }
        })
      ]
    })

    // Act & Assert
    expect(findSecrets(input)).toEqual([])
  })

  test('scans only the folder that would be published', () => {
    // Arrange
    const leaky = request({ name: 'Leaky', description: 'password: hunter2hunter2' })
    const input = collection({
      items: [folder([request({ name: 'Clean' })], { name: 'Public' }), folder([leaky], { name: 'Private' })]
    })

    // Act & Assert
    expect(findSecrets(input, [0])).toEqual([])
    expect(findSecrets(input, [1]).map((item) => item.path)).toEqual(['Leaky'])
  })
})

describe('folderNamesAt', () => {
  test('lists the names along the path, and refuses a path that leads nowhere', () => {
    // Arrange
    const input = collection({ items: [folder([folder([], { name: 'Inner' })], { name: 'Outer' })] })

    // Act & Assert
    expect(folderNamesAt(input, [0, 0])).toEqual(['Outer', 'Inner'])
    expect(folderNamesAt(input, [])).toEqual([])
    expect(() => folderNamesAt(input, [3])).toThrow(InvalidRequestException)
  })
})

describe('publicationSchema', () => {
  test('fills the defaults and refuses a visibility it does not know', () => {
    // Act
    const parsed = publicationSchema.parse({ collectionId: 'c1', title: 'API', visibility: 'company' })
    const bad = publicationSchema.safeParse({ collectionId: 'c1', title: 'API', visibility: 'everyone' })

    // Assert
    expect(parsed).toMatchObject({ people: [], folderPath: [], environmentId: null, language: 'curl' })
    expect(bad.success).toBe(false)
  })
})
