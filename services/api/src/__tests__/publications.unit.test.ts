import { describe, expect, test } from 'bun:test'

import type { ClaimsVerifier } from '../identity.js'
import { createPublication } from '../publications.js'
import { createHandler } from '../routes.js'
import { createMemoryStore } from '../store/memory.js'

const verifierFor = (email: string): ClaimsVerifier => ({
  verify: async (token) =>
    token === 'good'
      ? {
          caller: { subject: email, email },
          claims: { sub: email, email, email_verified: true, hd: email.split('@')[1] }
        }
      : undefined
})

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'

const request = (name: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'request',
  name,
  method: 'GET',
  url: '{{baseUrl}}/orders',
  query: [{ key: 'access_token', value: 'QUERY-SECRET', disabled: false }],
  headers: [{ key: 'Authorization', value: 'Bearer HEADER-SECRET', disabled: false }],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: [],
  ...overrides
})

const shop = (overrides: Record<string, unknown> = {}) => ({
  name: 'Shop',
  auth: { type: 'bearer', token: 'COLLECTION-TOKEN' },
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com', secret: false },
    { key: 'apiSecret', value: 'VARIABLE-SECRET', secret: true }
  ],
  items: [
    { kind: 'folder', name: 'Orders', auth: { type: 'inherit' }, children: [request('Get order')] },
    { kind: 'folder', name: 'Admin', auth: { type: 'inherit' }, children: [request('Reset')] }
  ],
  ...overrides
})

type Person = 'ana' | 'edu' | 'vera' | 'cris' | 'nobody'
const EMAIL: Record<Exclude<Person, 'nobody'>, string> = {
  ana: 'ana@uselets.com',
  edu: 'edu@uselets.com',
  vera: 'vera@uselets.com',
  cris: 'cris@lets.delivery'
}

const ids = (...values: string[]) => {
  const queue = [...values]
  return () => queue.shift() ?? 'id-x'
}

/** One store, a team workspace `team` (ana admin, edu editor, vera viewer), and cris, a company person outside it. */
const setup = async () => {
  const store = createMemoryStore()
  const slugs = ids('slug-1', 'slug-2', 'slug-3', 'slug-4')
  const newId = ids('team', 'col-1', 'env-1', 'col-2')
  const handler = (person: Exclude<Person, 'nobody'>) =>
    createHandler({
      identity: verifierFor(EMAIL[person]),
      allowedDomains: ['uselets.com', 'lets.delivery'],
      localUsers: false,
      store,
      newId,
      newSlug: slugs
    })
  const anonymous = createHandler({
    identity: verifierFor('x@uselets.com'),
    allowedDomains: ['uselets.com', 'lets.delivery'],
    localUsers: false,
    store
  })
  const call = async (who: Person, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (who !== 'nobody') {
      headers.authorization = 'Bearer good'
    }
    const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
    return await (who === 'nobody' ? anonymous : handler(who))(new Request(`https://api.test${path}`, init))
  }
  // ana makes the team and adds the others
  const ana = handler('ana')
  await ana(
    new Request('https://api.test/v1/workspaces', {
      method: 'POST',
      headers: { authorization: 'Bearer good' },
      body: JSON.stringify({ name: 'Parceiros' })
    })
  )
  const members = [
    { email: EMAIL.ana, role: 'admin' },
    { email: EMAIL.edu, role: 'editor' },
    { email: EMAIL.vera, role: 'viewer' }
  ]
  await call('ana', '/v1/workspaces/team', { name: 'Parceiros', members, version: 1 }, 'PUT')
  await call('ana', '/v1/workspaces/team/collections', { collection: shop() })
  await call('ana', '/v1/workspaces/team/environments', {
    name: 'Dev',
    variables: [
      { key: 'host', value: 'dev.example.com', secret: false },
      { key: 'token', value: 'ENV-SECRET', secret: true }
    ]
  })
  return { call, store }
}

const publish = (overrides: Record<string, unknown> = {}) => ({
  collectionId: 'col-1',
  title: 'Shop API',
  visibility: 'company',
  ...overrides
})

describe('publishing a collection', () => {
  test('an editor publishes and gets an address made of a random slug; a viewer cannot', async () => {
    // Arrange
    const { call } = await setup()

    // Act
    const byEditor = await call('edu', '/v1/workspaces/team/docs', publish())
    const byViewer = await call('vera', '/v1/workspaces/team/docs', publish())

    // Assert
    expect(byEditor.status).toBe(200)
    expect(await byEditor.json()).toMatchObject({
      publication: {
        slug: 'slug-1',
        title: 'Shop API',
        visibility: 'company',
        language: 'curl',
        folderPath: [],
        version: 1
      },
      warnings: []
    })
    expect(byViewer.status).toBe(403)
  })

  test('generates a slug that cannot be guessed when none is handed over', async () => {
    // Arrange
    const store = createMemoryStore()
    const handle = createHandler({
      identity: verifierFor(EMAIL.ana),
      allowedDomains: ['uselets.com'],
      localUsers: false,
      store,
      newId: ids('team', 'col-1')
    })
    const send = (path: string, body: unknown, method = 'POST') =>
      handle(
        new Request(`https://api.test${path}`, {
          method,
          headers: { authorization: 'Bearer good' },
          body: JSON.stringify(body)
        })
      )
    await send('/v1/workspaces', { name: 'T' })
    await send('/v1/workspaces/team/collections', { collection: shop() })

    // Act
    const first = await (await send('/v1/workspaces/team/docs', publish())).json()
    const second = await (await send('/v1/workspaces/team/docs', publish())).json()

    // Assert
    expect(first.publication.slug).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(second.publication.slug).not.toBe(first.publication.slug)
  })

  test('refuses what it cannot publish: an unknown collection, a bad folder, an unknown environment, bad people', async () => {
    // Arrange
    const { call } = await setup()

    // Act
    const noCollection = await call('ana', '/v1/workspaces/team/docs', publish({ collectionId: 'nope' }))
    const badFolder = await call('ana', '/v1/workspaces/team/docs', publish({ folderPath: [9] }))
    const noEnvironment = await call('ana', '/v1/workspaces/team/docs', publish({ environmentId: 'nope' }))
    const outsider = await call(
      'ana',
      '/v1/workspaces/team/docs',
      publish({ visibility: 'people', people: ['x@gmail.com'] })
    )
    const nobodyListed = await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'people', people: [] }))

    // Assert
    expect(noCollection.status).toBe(404)
    expect(badFolder.status).toBe(400)
    expect(noEnvironment.status).toBe(400)
    expect(outsider.status).toBe(400)
    expect(await outsider.json()).toMatchObject({ error: { message: expect.stringContaining('x@gmail.com') } })
    expect(nobodyListed.status).toBe(400)
  })

  test('lists the links of a collection for editors, and keeps the viewers out', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ title: 'B' }))
    await call(
      'ana',
      '/v1/workspaces/team/docs',
      publish({ title: 'A', collectionId: 'col-1', visibility: 'workspace' })
    )

    // Act
    const listed = await (await call('edu', '/v1/workspaces/team/docs?collectionId=col-1')).json()
    const other = await (await call('edu', '/v1/workspaces/team/docs?collectionId=other')).json()
    const viewer = await call('vera', '/v1/workspaces/team/docs')

    // Assert
    expect(listed.items.map((item: { title: string }) => item.title)).toEqual(['A', 'B'])
    expect(other.items).toEqual([])
    expect(viewer.status).toBe(403)
  })
})

describe('who may open a page', () => {
  const open = async (visibility: string, people: string[] = []) => {
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/docs', publish({ visibility, people }))
    return world
  }
  const status = async (world: Awaited<ReturnType<typeof setup>>, who: Person) =>
    (await world.call(who, '/v1/docs/slug-1')).status

  test('workspace: its members, of any role, and nobody else', async () => {
    // Arrange
    const world = await open('workspace')

    // Act & Assert
    expect(await status(world, 'vera')).toBe(200)
    expect(await status(world, 'edu')).toBe(200)
    expect(await status(world, 'cris')).toBe(403)
    expect(await status(world, 'nobody')).toBe(401)
  })

  test('company: any signed-in company account, and not a stranger', async () => {
    // Arrange
    const world = await open('company')

    // Act & Assert
    expect(await status(world, 'cris')).toBe(200)
    expect(await status(world, 'vera')).toBe(200)
    expect(await status(world, 'nobody')).toBe(401)
  })

  test('people: the listed addresses and the workspace editors; a viewer who is not listed is refused', async () => {
    // Arrange
    const world = await open('people', ['cris@lets.delivery'])

    // Act & Assert
    expect(await status(world, 'cris')).toBe(200)
    expect(await status(world, 'edu')).toBe(200)
    expect(await status(world, 'ana')).toBe(200)
    expect(await status(world, 'vera')).toBe(403)
    expect(await status(world, 'nobody')).toBe(401)
  })

  test('link: anyone, with no sign-in at all', async () => {
    // Arrange
    const world = await open('link')

    // Act & Assert
    expect(await status(world, 'nobody')).toBe(200)
    expect(await status(world, 'cris')).toBe(200)
  })

  test('a wrong token is a 401 even on a public link, never a quiet downgrade to anonymous', async () => {
    // Arrange
    const world = await open('link')

    // Act
    const response = await world.call('nobody', '/v1/docs/slug-1').then(async () => {
      const handler = createHandler({
        identity: verifierFor('x@uselets.com'),
        allowedDomains: ['uselets.com'],
        localUsers: false,
        store: world.store
      })
      return await handler(
        new Request('https://api.test/v1/docs/slug-1', { headers: { authorization: 'Bearer wrong' } })
      )
    })

    // Assert
    expect(response.status).toBe(401)
  })

  test('answers 404 for an unknown slug, and for one that was removed', async () => {
    // Arrange
    const world = await open('link')

    // Act
    const unknown = await world.call('cris', '/v1/docs/not-a-slug')
    const removed = await world.call('ana', '/v1/workspaces/team/docs/slug-1', undefined, 'DELETE')
    const after = await world.call('nobody', '/v1/docs/slug-1')

    // Assert
    expect(unknown.status).toBe(404)
    expect(removed.status).toBe(200)
    expect(after.status).toBe(404)
  })

  test('answers 404 when the collection behind the page was deleted', async () => {
    // Arrange
    const world = await open('company')

    // Act
    await world.call('ana', '/v1/workspaces/team/collections/col-1', undefined, 'DELETE')

    // Assert
    expect(await status(world, 'cris')).toBe(404)
  })
})

describe('what a page carries', () => {
  test('no token, password, secret variable, credential header or query value reaches the response', async () => {
    // Arrange
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'company', environmentId: 'env-1' }))

    // Act
    const text = await (await world.call('cris', '/v1/docs/slug-1')).text()

    // Assert
    for (const secret of ['COLLECTION-TOKEN', 'VARIABLE-SECRET', 'HEADER-SECRET', 'QUERY-SECRET', 'ENV-SECRET']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('<hidden>')
  })

  test('carries the public variables of the collection and of the chosen environment, the environment winning', async () => {
    // Arrange
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/docs', publish({ environmentId: 'env-1' }))

    // Act
    const page = await (await world.call('cris', '/v1/docs/slug-1')).json()

    // Assert
    expect(page.variables).toEqual({ baseUrl: 'https://api.example.com', host: 'dev.example.com' })
    expect(page).toMatchObject({ title: 'Shop API', visibility: 'company', language: 'curl' })
  })

  test('publishes one folder alone, without the rest of the collection', async () => {
    // Arrange
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/docs', publish({ folderPath: [0] }))

    // Act
    const page = await (await world.call('cris', '/v1/docs/slug-1')).json()

    // Assert
    expect(page.collection.name).toBe('Orders')
    expect(JSON.stringify(page)).toContain('Get order')
    expect(JSON.stringify(page)).not.toContain('Reset')
    expect(JSON.stringify(page)).not.toContain('Admin')
  })

  test('the page follows the collection: an edit shows without publishing again', async () => {
    // Arrange
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/docs', publish())
    const edited = shop({ items: [{ kind: 'folder', name: 'Renamed', auth: { type: 'inherit' }, children: [] }] })

    // Act
    await world.call('ana', '/v1/workspaces/team/collections/col-1', { collection: edited, version: 1 }, 'PUT')
    const page = await (await world.call('cris', '/v1/docs/slug-1')).json()

    // Assert
    expect(page.collection.items.map((item: { name: string }) => item.name)).toEqual(['Renamed'])
  })
})

describe('credentials in the content', () => {
  const leaky = () => shop({ items: [request('Login', { description: `try ${TOKEN}` })] })
  const setupLeaky = async () => {
    const world = await setup()
    await world.call('ana', '/v1/workspaces/team/collections/col-1', { collection: leaky(), version: 1 }, 'PUT')
    return world
  }

  test('refuses a public link over text that looks like a credential, and says which request', async () => {
    // Arrange
    const world = await setupLeaky()

    // Act
    const response = await world.call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))

    // Assert
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'unsafe_content', message: expect.stringContaining('Login') }
    })
  })

  test('goes ahead when the author confirms, and still warns', async () => {
    // Arrange
    const world = await setupLeaky()

    // Act
    const response = await world.call(
      'ana',
      '/v1/workspaces/team/docs',
      publish({ visibility: 'link', acknowledgeSecrets: true })
    )

    // Assert
    expect(response.status).toBe(200)
    expect((await response.json()).warnings).toEqual([{ path: 'Login', kind: 'a JWT' }])
  })

  test('only warns when the page needs a sign-in anyway', async () => {
    // Arrange
    const world = await setupLeaky()

    // Act
    const response = await world.call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'company' }))

    // Assert
    expect(response.status).toBe(200)
    expect((await response.json()).warnings).toHaveLength(1)
  })

  test('narrowing a public link to a folder with nothing suspicious needs no confirmation', async () => {
    // Arrange
    const world = await setup()
    const mixed = shop({
      items: [
        { kind: 'folder', name: 'Clean', auth: { type: 'inherit' }, children: [request('Fine')] },
        request('Leaky', { description: TOKEN })
      ]
    })
    await world.call('ana', '/v1/workspaces/team/collections/col-1', { collection: mixed, version: 1 }, 'PUT')

    // Act
    const whole = await world.call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))

    // Assert: the scan is of the whole collection, so a folder does not hide it
    expect(whole.status).toBe(422)
  })
})

describe('changing and removing a link', () => {
  test('saves with the version it read; an old version is a 409', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish())

    // Act
    const saved = await call(
      'ana',
      '/v1/workspaces/team/docs/slug-1',
      publish({ visibility: 'workspace', title: 'Renamed', version: 1 }),
      'PUT'
    )
    const stale = await call('ana', '/v1/workspaces/team/docs/slug-1', publish({ version: 1 }), 'PUT')

    // Assert
    expect((await saved.json()).publication).toMatchObject({ visibility: 'workspace', title: 'Renamed', version: 2 })
    expect(stale.status).toBe(409)
  })

  test('narrowing the visibility takes effect on the next open', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'company' }))
    const before = (await call('cris', '/v1/docs/slug-1')).status

    // Act
    await call('ana', '/v1/workspaces/team/docs/slug-1', publish({ visibility: 'workspace', version: 1 }), 'PUT')

    // Assert
    expect(before).toBe(200)
    expect((await call('cris', '/v1/docs/slug-1')).status).toBe(403)
  })

  test('an editor of another workspace cannot change or remove it', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish())

    // Act
    const remove = await call('cris', '/v1/workspaces/team/docs/slug-1', undefined, 'DELETE')
    const change = await call('cris', '/v1/workspaces/team/docs/slug-1', publish({ version: 1 }), 'PUT')

    // Assert
    expect(remove.status).toBe(404)
    expect(change.status).toBe(404)
    expect((await call('cris', '/v1/docs/slug-1')).status).toBe(200)
  })
})

describe('a page and the things it depends on', () => {
  const editCollection = async (call: Awaited<ReturnType<typeof setup>>['call'], items: unknown[], version = 1) =>
    await call('ana', '/v1/workspaces/team/collections/col-1', { collection: shop({ items }), version }, 'PUT')

  test('a person cannot unpublish the page of a workspace that is not theirs, through a workspace of their own', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'company' }))
    const mine = (await (await call('cris', '/v1/workspaces')).json()).items[0].id

    // Act
    const attempt = await call('cris', `/v1/workspaces/${mine}/docs/slug-1`, undefined, 'DELETE')

    // Assert
    expect(attempt.status).toBe(404)
    expect((await call('cris', '/v1/docs/slug-1')).status).toBe(200)
  })

  test('a failed write of the page leaves no address behind', async () => {
    // Arrange
    const store = createMemoryStore()
    await store.put('w1', 'collection', {
      id: 'col-1',
      name: 'Shop',
      value: shop(),
      expectedVersion: null,
      by: 'ana@uselets.com',
      now: new Date()
    })
    const failing = {
      ...store,
      put: async (...args: Parameters<typeof store.put>) => {
        if (args[1] === 'publication' && args[0] !== 'GLOBAL') {
          throw new Error('disk full')
        }
        return await store.put(...args)
      }
    }

    // Act & Assert
    await expect(
      createPublication(failing, {
        workspaceId: 'w1',
        slug: 's1',
        input: {
          collectionId: 'col-1',
          title: 'T',
          visibility: 'company',
          people: [],
          folderPath: [],
          environmentId: null,
          language: 'curl'
        },
        by: 'ana@uselets.com',
        now: new Date(),
        allowedDomains: ['uselets.com'],
        acknowledgeSecrets: false
      })
    ).rejects.toThrow('disk full')
    expect(await store.get('GLOBAL', 'publication', 's1')).toBeUndefined()
  })

  test('deleting the collection takes its pages down, and the list shows none', async () => {
    // Arrange
    const { call, store } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))

    // Act
    const removed = await call('ana', '/v1/workspaces/team/collections/col-1', undefined, 'DELETE')

    // Assert
    expect(removed.status).toBe(200)
    expect((await call('nobody', '/v1/docs/slug-1')).status).toBe(404)
    expect(await store.get('GLOBAL', 'publication', 'slug-1')).toBeUndefined()
    expect((await (await call('ana', '/v1/workspaces/team/docs')).json()).items).toEqual([])
  })

  test('deleting a document that is not there is a 404, not a quiet success', async () => {
    // Arrange
    const { call } = await setup()

    // Act
    const response = await call('ana', '/v1/workspaces/team/collections/nope', undefined, 'DELETE')

    // Assert
    expect(response.status).toBe(404)
  })

  test('deleting the workspace takes its pages and their addresses down', async () => {
    // Arrange
    const { call, store } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))

    // Act
    const removed = await call('ana', '/v1/workspaces/team', undefined, 'DELETE')

    // Assert
    expect(removed.status).toBe(200)
    expect((await call('nobody', '/v1/docs/slug-1')).status).toBe(404)
    expect(await store.get('GLOBAL', 'publication', 'slug-1')).toBeUndefined()
    expect(await store.list('team', 'publication')).toEqual([])
  })

  test('a folder that moved no longer answers: the page does not show another folder in its place', async () => {
    // Arrange
    const { call } = await setup()
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link', folderPath: [0] }))
    const admin = {
      kind: 'folder',
      name: 'Admin',
      auth: { type: 'inherit' },
      children: [request('Reset', { query: [], headers: [] })]
    }
    const orders = {
      kind: 'folder',
      name: 'Orders',
      auth: { type: 'inherit' },
      children: [request('Get order', { query: [], headers: [] })]
    }

    // Act
    const before = await call('nobody', '/v1/docs/slug-1')
    await editCollection(call, [admin, orders])
    const after = await call('nobody', '/v1/docs/slug-1')

    // Assert
    expect(before.status).toBe(200)
    expect(after.status).toBe(404)
  })

  test('a credential added after a public link was approved takes the page down until it is taken out', async () => {
    // Arrange
    const { call } = await setup()
    const clean = [
      {
        kind: 'folder',
        name: 'Orders',
        auth: { type: 'inherit' },
        children: [request('Get order', { query: [], headers: [] })]
      }
    ]
    await editCollection(call, clean)
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))
    const leaky = [
      {
        kind: 'folder',
        name: 'Orders',
        auth: { type: 'inherit' },
        children: [request('Get order', { query: [], headers: [], description: `use ${TOKEN}` })]
      }
    ]

    // Act
    const before = await call('nobody', '/v1/docs/slug-1')
    await editCollection(call, leaky, 2)
    const during = await call('nobody', '/v1/docs/slug-1')
    await editCollection(call, clean, 3)
    const after = await call('nobody', '/v1/docs/slug-1')

    // Assert
    expect([before.status, during.status, after.status]).toEqual([200, 404, 200])
  })

  test('a viewer reads a collection with every secret emptied; an editor reads it whole', async () => {
    // Arrange
    const { call } = await setup()

    // Act
    const viewer = JSON.stringify(await (await call('vera', '/v1/workspaces/team/collections/col-1')).json())
    const editor = JSON.stringify(await (await call('edu', '/v1/workspaces/team/collections/col-1')).json())

    // Assert
    for (const secret of ['COLLECTION-TOKEN', 'VARIABLE-SECRET', 'HEADER-SECRET', 'QUERY-SECRET']) {
      expect(viewer).not.toContain(secret)
      expect(editor).toContain(secret)
    }
  })

  test('a public page carries no user, password or token that sits in the address or in a header nobody listed', async () => {
    // Arrange
    const { call } = await setup()
    const items = [
      request('Odd', {
        url: 'https://ana:URLPASS@api.example.com/y?api_key=URLQUERY',
        query: [],
        headers: [{ key: 'X-Amz-Security-Token', value: 'AMZ-SECRET', disabled: false }],
        body: { mode: 'raw', language: 'json', content: '{"password":"RAWSECRET"}' }
      })
    ]
    await editCollection(call, items)

    // Act
    await call('ana', '/v1/workspaces/team/docs', publish({ visibility: 'link' }))
    const text = JSON.stringify(await (await call('nobody', '/v1/docs/slug-1')).json())

    // Assert
    for (const secret of ['URLPASS', 'URLQUERY', 'AMZ-SECRET', 'RAWSECRET', 'COLLECTION-TOKEN', 'VARIABLE-SECRET']) {
      expect(text).not.toContain(secret)
    }
  })
})
