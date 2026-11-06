import { describe, expect, test } from 'bun:test'

import type { Collection, FolderNode, RequestNode } from '../model.js'
import {
  findSecrets,
  findSecretsInVariables,
  HIDDEN,
  isExternal,
  publicationSchema,
  publicView,
  selectionHealth,
  viewerView
} from '../publication.js'

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
    const view = publicView(input, null)

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
    const view = publicView(collection(), null)

    // Assert
    expect(view.variables).toEqual([{ key: 'baseUrl', value: 'https://api.example.com', secret: false }])
    expect(JSON.stringify(view)).not.toContain('VARIABLE-SECRET')
  })

  test('with a selection, keeps only the variables the shown requests use, and no description', () => {
    // Arrange
    const input = collection({
      description: 'INTERNAL NOTES',
      variables: [
        { key: 'baseUrl', value: 'https://api.example.com', secret: false },
        { key: 'internalAdminUrl', value: 'https://admin.corp.internal', secret: false }
      ],
      items: [request({ id: 'r1' }), request({ id: 'r2', name: 'Admin', url: '{{internalAdminUrl}}/x' })]
    })

    // Act
    const view = publicView(input, ['r1'])
    const whole = publicView(input, null)

    // Assert
    expect(view.variables.map((variable) => variable.key)).toEqual(['baseUrl'])
    expect(view.description).toBeUndefined()
    expect(whole.variables).toHaveLength(2)
    expect(whole.description).toBe('INTERNAL NOTES')
  })

  test('finds a credential in the value of a variable that would be published, and ignores the ones that never are', () => {
    // Arrange
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
    const variables = [
      { key: 'adminHeader', value: jwt, secret: false },
      { key: 'host', value: 'dev.example.com', secret: false },
      { key: 'apiToken', value: jwt, secret: false },
      { key: 'other', value: jwt, secret: true }
    ]

    // Act
    const found = findSecretsInVariables(variables, 'environment Dev')

    // Assert
    expect(found).toEqual([{ path: 'environment Dev/adminHeader', kind: 'a JWT' }])
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
    const view = publicView(input, null)

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
    publicView(input, null)

    // Assert
    expect(JSON.stringify(input)).toBe(before)
  })

  describe('with a selection', () => {
    const tree = () =>
      collection({
        items: [
          folder(
            [
              folder([request({ id: 'c', name: 'Deep one' }), request({ id: 'd', name: 'Deep two' })], {
                id: 'f2',
                name: 'Inner',
                description: 'Deep'
              }),
              request({ id: 'b', name: 'Beta' })
            ],
            { id: 'f1', name: 'Outer' }
          ),
          request({ id: 'a', name: 'Alpha' }),
          folder([request({ id: 'e', name: 'Elsewhere' })], { id: 'f3', name: 'Nothing ticked' })
        ]
      })

    test('shows only the ticked requests and the folders around them, in their order', () => {
      // Arrange
      const input = tree()

      // Act
      const view = publicView(input, ['c', 'a'])

      // Assert
      expect(view.items.map((item) => item.name)).toEqual(['Outer', 'Alpha'])
      const outer = view.items[0] as FolderNode
      expect(outer.children.map((child) => child.name)).toEqual(['Inner'])
      expect((outer.children[0] as FolderNode).children.map((child) => child.name)).toEqual(['Deep one'])
    })

    test('leaves out a folder with nothing ticked and everything else of the collection', () => {
      // Arrange
      const input = tree()

      // Act
      const text = JSON.stringify(publicView(input, ['b']))

      // Assert
      for (const absent of ['Elsewhere', 'Nothing ticked', 'Alpha', 'Deep one', 'Inner']) {
        expect(text).not.toContain(absent)
      }
      expect(text).toContain('Beta')
      expect(text).not.toContain('COLLECTION-TOKEN')
    })

    test('shows the whole collection when there is no selection, and nothing for ids that are not there', () => {
      // Arrange
      const input = tree()

      // Act
      const whole = publicView(input, null)
      const none = publicView(input, ['gone'])

      // Assert
      expect(whole.items.map((item) => item.name)).toEqual(['Outer', 'Alpha', 'Nothing ticked'])
      expect(none.items).toEqual([])
    })

    test('counts what was deleted from the selection and what the collection gained since it was saved', () => {
      // Arrange
      const input = tree()

      // Act
      const health = selectionHealth(input, ['a', 'zzz'], ['a', 'b', 'c', 'd', 'gone-long-ago'])

      // Assert
      expect(health).toEqual({ removed: 1, added: 1 })
    })
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
    const view = publicView(input, null)

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
    const text = JSON.stringify(publicView(input, null))

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
    const view = publicView(input, null)

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
    const view = publicView(input, null)

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
    const view = publicView(input, null)

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

  test('scans only what the selection would show', () => {
    // Arrange
    const leaky = request({ id: 'leaky', name: 'Leaky', description: 'password: hunter2hunter2' })
    const input = collection({
      items: [
        folder([request({ id: 'clean', name: 'Clean' })], { name: 'Public' }),
        folder([leaky], { name: 'Private' })
      ]
    })

    // Act & Assert
    expect(findSecrets(input, ['clean'])).toEqual([])
    expect(findSecrets(input, ['leaky']).map((item) => item.path)).toEqual(['Private / Leaky'])
  })
})

describe('publicationSchema', () => {
  test('fills the defaults and refuses a visibility it does not know', () => {
    // Act
    const parsed = publicationSchema.parse({ collectionId: 'c1', title: 'API', visibility: 'company' })
    const bad = publicationSchema.safeParse({ collectionId: 'c1', title: 'API', visibility: 'everyone' })

    // Assert
    expect(parsed).toMatchObject({ people: [], selection: null, environmentId: null, language: 'curl' })
    expect(bad.success).toBe(false)
  })

  test('knows `password` and calls it, with `link`, a page for people outside the company', () => {
    // Act
    const parsed = publicationSchema.safeParse({ collectionId: 'c1', title: 'API', visibility: 'password' })

    // Assert
    expect(parsed.success).toBe(true)
    expect(['password', 'link'].every((v) => isExternal(v as 'link'))).toBe(true)
    expect(['workspace', 'people', 'company'].some((v) => isExternal(v as 'link'))).toBe(false)
  })
})
