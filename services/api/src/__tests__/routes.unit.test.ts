import { describe, expect, test } from 'bun:test'

import type { Fetcher } from '@postmano/send'
import { createMemoryAccessState } from '../access-state.js'
import type { ClaimsVerifier } from '../identity.js'
import { type ApiDeps, createHandler } from '../routes.js'
import { createMemoryStore } from '../store/memory.js'

const DOMAINS = ['uselets.com']

const verifierFor = (email: string): ClaimsVerifier => ({
  verify: async (token) =>
    token === 'good'
      ? {
          caller: { subject: 's1', email },
          claims: { sub: 's1', email, email_verified: true, hd: email.split('@')[1] }
        }
      : undefined
})

const handlerFor = (overrides: Partial<ApiDeps> = {}, fetcher?: Fetcher) =>
  createHandler({
    identity: verifierFor('ana@uselets.com'),
    allowedDomains: DOMAINS,
    localUsers: false,
    store: createMemoryStore(),
    access: createMemoryAccessState(),
    ...(fetcher
      ? {
          send: {
            fetch: fetcher,
            lookup: async (host) => (host === 'intranet.test' ? ['10.0.0.5'] : ['93.184.216.34'])
          }
        }
      : {}),
    ...overrides
  })

const call = async (handle: ReturnType<typeof handlerFor>, path: string, init: RequestInit = {}) =>
  await handle(new Request(`https://api.test${path}`, init))

const authed = (body?: unknown): RequestInit => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
})

const orderRequest = (overrides: Record<string, unknown> = {}) => ({
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

describe('API', () => {
  test('answers the health check without a token', async () => {
    // Arrange
    const handle = handlerFor()

    // Act
    const response = await call(handle, '/v1/health')

    // Assert
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('answers 401 without a token and 404 for an unknown route', async () => {
    // Arrange
    const handle = handlerFor()

    // Act
    const unauthenticated = await call(handle, '/v1/me')
    const unknown = await call(handle, '/v1/nope', authed())

    // Assert
    expect(unauthenticated.status).toBe(401)
    expect(unknown.status).toBe(404)
  })

  test('answers 403 for an account outside the company domain', async () => {
    // Arrange
    const handle = handlerFor({ identity: verifierFor('ana@gmail.com') })

    // Act
    const response = await call(handle, '/v1/me', authed())

    // Assert
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } })
  })

  test('returns the caller on /v1/me', async () => {
    // Arrange
    const handle = handlerFor()

    // Act
    const response = await call(handle, '/v1/me', authed())

    // Assert
    expect(await response.json()).toEqual({ subject: 's1', email: 'ana@uselets.com' })
  })

  test('accepts x-local-user only when local users are on', async () => {
    // Arrange
    const headers = { 'x-local-user': 'dev@uselets.com' }

    // Act
    const off = await call(handlerFor({ identity: undefined }), '/v1/me', { headers })
    const on = await call(handlerFor({ identity: undefined, localUsers: true }), '/v1/me', { headers })

    // Assert
    expect(off.status).toBe(401)
    expect(on.status).toBe(200)
  })

  test('imports a Postman collection and returns the warnings', async () => {
    // Arrange
    const handle = handlerFor()
    const collection = {
      info: { name: 'C', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: []
    }

    // Act
    const response = await call(handle, '/v1/imports/postman', authed(collection))

    // Assert
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ collection: { name: 'C' }, warnings: [] })
  })

  test('answers 400 for a body that is not JSON and for one that breaks the schema', async () => {
    // Arrange
    const handle = handlerFor()

    // Act
    const notJson = await call(handle, '/v1/send', { ...authed({}), body: '{oops' })
    const invalid = await call(handle, '/v1/send', authed({ request: { kind: 'request' } }))

    // Assert
    expect(notJson.status).toBe(400)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_request' } })
  })

  test('sends a request through the proxy with variables and inherited auth', async () => {
    // Arrange
    let seen: { url: string; headers: [string, string][] } | undefined
    const fetcher: Fetcher = async (url, init) => {
      seen = { url, headers: init.headers as [string, string][] }
      return Response.json({ ok: true })
    }
    const body = {
      request: orderRequest(),
      parents: [{ type: 'bearer', token: '{{token}}' }],
      variables: { environment: { baseUrl: 'https://api.example.com', token: 'T0K' } }
    }

    // Act
    const response = await call(handlerFor({}, fetcher), '/v1/send', authed(body))

    // Assert
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { status: 200, body: '{"ok":true}' }, unresolved: [] })
    expect(seen?.url).toBe('https://api.example.com/orders')
    expect(seen?.headers).toContainEqual(['Authorization', 'Bearer T0K'])
  })

  test('refuses to send to an internal address with 422 and never calls out', async () => {
    // Arrange
    let called = false
    const fetcher: Fetcher = async () => {
      called = true
      return new Response('x')
    }
    const body = { request: orderRequest({ url: 'https://intranet.test/secret' }) }

    // Act
    const response = await call(handlerFor({}, fetcher), '/v1/send', authed(body))

    // Assert
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'blocked_destination' } })
    expect(called).toBe(false)
  })
})

describe('workspaces', () => {
  const collection = (name = 'Orders') => ({ name, auth: { type: 'none' }, variables: [], items: [orderRequest()] })
  const put = (body: unknown): RequestInit => ({ ...authed(body), method: 'PUT' })
  const del = (): RequestInit => ({ ...authed(), method: 'DELETE' })
  const ids = (...values: string[]) => {
    const queue = [...values]
    return () => queue.shift() ?? 'id-x'
  }
  const json = async (response: Response) => await response.json()

  /** The same store seen by different people, as in the deployed stack. */
  const world = (newId?: () => string) => {
    const store = createMemoryStore()
    return {
      as: (email: string) => handlerFor({ identity: verifierFor(email), store, ...(newId ? { newId } : {}) })
    }
  }

  const personal = async (handle: ReturnType<typeof handlerFor>) =>
    (await json(await call(handle, '/v1/workspaces', authed()))).items[0]

  test('gives a person a personal workspace on first sight, the same one every time', async () => {
    // Arrange
    const handle = world().as('ana@uselets.com')

    // Act
    const first = await personal(handle)
    const second = await personal(handle)

    // Assert
    expect(first).toMatchObject({ name: 'Meu workspace', personal: true, role: 'admin', version: 1 })
    expect(second.id).toBe(first.id)
  })

  test('creates, lists, reads, saves with the version and deletes a collection in a workspace', async () => {
    // Arrange
    const handle = world(ids('col-1')).as('ana@uselets.com')
    const { id: ws } = await personal(handle)
    const base = `/v1/workspaces/${ws}/collections`

    // Act
    const created = await json(await call(handle, base, authed({ collection: collection() })))
    const listed = await json(await call(handle, base, authed()))
    const read = await json(await call(handle, `${base}/col-1`, authed()))
    const saved = await json(
      await call(handle, `${base}/col-1`, put({ collection: collection('Orders v2'), version: 1 }))
    )
    const removed = await call(handle, `${base}/col-1`, del())

    // Assert
    expect(created).toMatchObject({ id: 'col-1', version: 1, updatedBy: 'ana@uselets.com' })
    expect(listed.items).toMatchObject([{ id: 'col-1', name: 'Orders', version: 1 }])
    expect(read.collection.items[0].url).toBe('{{baseUrl}}/orders')
    expect(saved).toMatchObject({ id: 'col-1', version: 2 })
    expect(removed.status).toBe(200)
    expect((await call(handle, `${base}/col-1`, authed())).status).toBe(404)
  })

  test('answers 409 for an old version, 400 for a missing one and for a broken collection', async () => {
    // Arrange
    const handle = world(ids('col-1')).as('ana@uselets.com')
    const { id: ws } = await personal(handle)
    const base = `/v1/workspaces/${ws}/collections`
    await call(handle, base, authed({ collection: collection() }))
    await call(handle, `${base}/col-1`, put({ collection: collection(), version: 1 }))

    // Act
    const stale = await call(handle, `${base}/col-1`, put({ collection: collection(), version: 1 }))
    const missing = await call(handle, `${base}/col-1`, put({ collection: collection() }))
    const broken = await call(handle, base, authed({ collection: { name: 'x' } }))

    // Assert
    expect(stale.status).toBe(409)
    expect(await json(stale)).toMatchObject({ error: { code: 'conflict' } })
    expect(missing.status).toBe(400)
    expect(broken.status).toBe(400)
  })

  test('keeps environments apart from collections and saves their variables', async () => {
    // Arrange
    const handle = world(ids('env-1')).as('ana@uselets.com')
    const { id: ws } = await personal(handle)
    const body = {
      name: 'Staging',
      variables: [{ key: 'baseUrl', value: 'https://staging.example.com', secret: false }]
    }

    // Act
    await call(handle, `/v1/workspaces/${ws}/environments`, authed(body))
    const read = await json(await call(handle, `/v1/workspaces/${ws}/environments/env-1`, authed()))
    const collections = await json(await call(handle, `/v1/workspaces/${ws}/collections`, authed()))

    // Assert
    expect(read).toMatchObject({ id: 'env-1', name: 'Staging', environment: { variables: [{ key: 'baseUrl' }] } })
    expect(collections.items).toEqual([])
  })

  test('needs a login for every workspace route', async () => {
    // Arrange
    const handle = handlerFor()

    // Act & Assert
    expect((await call(handle, '/v1/workspaces')).status).toBe(401)
    expect((await call(handle, '/v1/workspaces/w1/collections')).status).toBe(401)
  })

  test('a team workspace has its own collections, invisible from another workspace', async () => {
    // Arrange
    const ana = world(ids('team-1', 'col-1')).as('ana@uselets.com')
    const mine = await personal(ana)
    const team = await json(await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' })))
    await call(ana, `/v1/workspaces/${team.id}/collections`, authed({ collection: collection('Only in the team') }))

    // Act
    const inTeam = await json(await call(ana, `/v1/workspaces/${team.id}/collections`, authed()))
    const inMine = await json(await call(ana, `/v1/workspaces/${mine.id}/collections`, authed()))

    // Assert
    expect(team).toMatchObject({ id: 'team-1', name: 'Parceiros', personal: false, role: 'admin' })
    expect(inTeam.items.map((item: { name: string }) => item.name)).toEqual(['Only in the team'])
    expect(inMine.items).toEqual([])
  })

  test('refuses a person who is not a member, and shows them only their own workspaces', async () => {
    // Arrange
    const { as } = world(ids('team-1'))
    const ana = as('ana@uselets.com')
    const bob = as('bob@uselets.com')
    const team = await json(await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' })))

    // Act
    const read = await call(bob, `/v1/workspaces/${team.id}`, authed())
    const collections = await call(bob, `/v1/workspaces/${team.id}/collections`, authed())
    const bobsList = await json(await call(bob, '/v1/workspaces', authed()))

    // Assert
    expect(read.status).toBe(404)
    expect(collections.status).toBe(404)
    expect(bobsList.items).toHaveLength(1)
    expect(bobsList.items[0].personal).toBe(true)
  })

  test('a viewer reads but does not write; an editor writes but does not manage members', async () => {
    // Arrange
    const { as } = world(ids('team-1', 'col-1'))
    const ana = as('ana@uselets.com')
    const team = await json(await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' })))
    const members = [
      { email: 'ana@uselets.com', role: 'admin' },
      { email: 'vera@uselets.com', role: 'viewer' },
      { email: 'edu@uselets.com', role: 'editor' }
    ]
    await call(ana, `/v1/workspaces/${team.id}`, put({ name: 'Parceiros', members, version: 1 }))
    const vera = as('vera@uselets.com')
    const edu = as('edu@uselets.com')
    const base = `/v1/workspaces/${team.id}/collections`

    // Act
    const viewerReads = await call(vera, base, authed())
    const viewerWrites = await call(vera, base, authed({ collection: collection() }))
    const editorWrites = await call(edu, base, authed({ collection: collection() }))
    const editorManages = await call(edu, `/v1/workspaces/${team.id}`, put({ name: 'x', members, version: 2 }))

    // Assert
    expect(viewerReads.status).toBe(200)
    expect(viewerWrites.status).toBe(403)
    expect(editorWrites.status).toBe(200)
    expect(editorManages.status).toBe(403)
    expect(
      (await json(await call(vera, '/v1/workspaces', authed()))).items.map((item: { role: string }) => item.role)
    ).toEqual(['admin', 'viewer'])
  })

  test('a viewer reads an environment without its secret values', async () => {
    // Arrange
    const { as } = world(ids('team-1', 'env-1'))
    const ana = as('ana@uselets.com')
    const team = await json(await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' })))
    const members = [
      { email: 'ana@uselets.com', role: 'admin' },
      { email: 'vera@uselets.com', role: 'viewer' }
    ]
    await call(ana, `/v1/workspaces/${team.id}`, put({ name: 'Parceiros', members, version: 1 }))
    const variables = [
      { key: 'host', value: 'public', secret: false },
      { key: 'token', value: 'S3CRET', secret: true }
    ]
    await call(ana, `/v1/workspaces/${team.id}/environments`, authed({ name: 'Prod', variables }))

    // Act
    const asAdmin = await json(await call(ana, `/v1/workspaces/${team.id}/environments/env-1`, authed()))
    const asViewer = await json(
      await call(as('vera@uselets.com'), `/v1/workspaces/${team.id}/environments/env-1`, authed())
    )

    // Assert
    expect(asAdmin.environment.variables[1].value).toBe('S3CRET')
    expect(asViewer.environment.variables).toEqual([
      { key: 'host', value: 'public', secret: false },
      { key: 'token', value: '', secret: true }
    ])
  })

  test('members must be company addresses, listed once, with at least one admin', async () => {
    // Arrange
    const ana = world(ids('team-1')).as('ana@uselets.com')
    const team = await json(await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' })))
    const change = (members: unknown) =>
      call(ana, `/v1/workspaces/${team.id}`, put({ name: 'Parceiros', members, version: 1 }))

    // Act
    const outsider = await change([
      { email: 'ana@uselets.com', role: 'admin' },
      { email: 'x@gmail.com', role: 'viewer' }
    ])
    const twice = await change([
      { email: 'ana@uselets.com', role: 'admin' },
      { email: 'ANA@uselets.com', role: 'viewer' }
    ])
    const noAdmin = await change([{ email: 'ana@uselets.com', role: 'editor' }])

    // Assert
    expect(outsider.status).toBe(400)
    expect(await json(outsider)).toMatchObject({ error: { message: expect.stringContaining('x@gmail.com') } })
    expect(twice.status).toBe(400)
    expect(noAdmin.status).toBe(400)
  })

  test('a personal workspace cannot be shared or deleted', async () => {
    // Arrange
    const ana = world().as('ana@uselets.com')
    const mine = await personal(ana)
    const shared = [
      { email: 'ana@uselets.com', role: 'admin' },
      { email: 'bob@uselets.com', role: 'viewer' }
    ]

    // Act
    const share = await call(
      ana,
      `/v1/workspaces/${mine.id}`,
      put({ name: 'Meu workspace', members: shared, version: 1 })
    )
    const remove = await call(ana, `/v1/workspaces/${mine.id}`, del())
    const rename = await call(
      ana,
      `/v1/workspaces/${mine.id}`,
      put({ name: 'Casa', members: [{ email: 'ana@uselets.com', role: 'admin' }], version: 1 })
    )

    // Assert
    expect(share.status).toBe(400)
    expect(remove.status).toBe(403)
    expect(rename.status).toBe(200)
  })

  test('deleting a team workspace deletes what is in it', async () => {
    // Arrange
    const { as } = world(ids('team-1', 'col-1', 'env-1'))
    const ana = as('ana@uselets.com')
    await call(ana, '/v1/workspaces', authed({ name: 'Parceiros' }))
    await call(ana, '/v1/workspaces/team-1/collections', authed({ collection: collection() }))
    await call(ana, '/v1/workspaces/team-1/environments', authed({ name: 'Dev', variables: [] }))

    // Act
    const removed = await call(ana, '/v1/workspaces/team-1', del())

    // Assert
    expect(removed.status).toBe(200)
    expect((await call(ana, '/v1/workspaces/team-1', authed())).status).toBe(404)
    expect((await json(await call(ana, '/v1/workspaces', authed()))).items).toHaveLength(1)
  })
})
