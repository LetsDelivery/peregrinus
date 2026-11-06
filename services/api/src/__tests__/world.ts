import { createMemoryAccessState } from '../access-state.js'
import type { ClaimsVerifier } from '../identity.js'
import { createHandler } from '../routes.js'
import { createMemoryStore } from '../store/memory.js'

/**
 * A small company for the tests of published pages: a team workspace `team` (ana admin, edu editor, vera viewer),
 * cris of the company but outside it, and a clock the test moves. The collection is saved through the API, so every
 * folder and request has the id the server gave it.
 */
export const EMAIL = {
  ana: 'ana@uselets.com',
  edu: 'edu@uselets.com',
  vera: 'vera@uselets.com',
  cris: 'cris@lets.delivery'
}
export type Person = keyof typeof EMAIL | 'nobody'

const verifierFor = (email: string): ClaimsVerifier => ({
  verify: async (token) =>
    token === 'good'
      ? {
          caller: { subject: email, email },
          claims: { sub: email, email, email_verified: true, hd: email.split('@')[1] }
        }
      : undefined
})

export const request = (name: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'request',
  name,
  method: 'GET',
  url: '{{baseUrl}}/orders',
  query: [],
  headers: [{ key: 'Authorization', value: 'Bearer HEADER-SECRET', disabled: false }],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: [],
  ...overrides
})

export const folder = (name: string, children: unknown[]) => ({
  kind: 'folder',
  name,
  auth: { type: 'inherit' },
  children
})

export const shop = () => ({
  name: 'Shop',
  auth: { type: 'bearer', token: 'COLLECTION-TOKEN' },
  variables: [
    { key: 'baseUrl', value: 'https://api.example.com', secret: false },
    { key: 'apiSecret', value: 'VARIABLE-SECRET', secret: true }
  ],
  items: [
    folder('Orders', [request('Get order'), request('List orders')]),
    folder('Admin', [request('Reset')]),
    request('Ping')
  ]
})

type Node = { kind: string; id: string; name: string; children?: Node[] }

const sequence = (prefix: string) => {
  let n = 0
  return () => {
    n += 1
    return `${prefix}-${n}`
  }
}

export const makeWorld = async () => {
  const store = createMemoryStore()
  const access = createMemoryAccessState()
  const clock = { at: new Date('2026-11-05T12:00:00.000Z') }
  const newId = (() => {
    const queue = ['team', 'col-1', 'env-1']
    let n = 0
    return () => {
      n += 1
      return queue.shift() ?? `id-${n}`
    }
  })()
  const newSlug = sequence('slug')
  const handler = createHandler({
    identity: verifierFor('x@uselets.com'),
    allowedDomains: ['uselets.com', 'lets.delivery'],
    localUsers: false,
    store,
    access,
    now: () => clock.at,
    newId,
    newSlug
  })
  const handlerOf = (person: keyof typeof EMAIL) =>
    createHandler({
      identity: verifierFor(EMAIL[person]),
      allowedDomains: ['uselets.com', 'lets.delivery'],
      localUsers: false,
      store,
      access,
      now: () => clock.at,
      newId,
      newSlug
    })

  const call = async (
    who: Person,
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    headers: Record<string, string> = {}
  ) => {
    const all: Record<string, string> = { 'content-type': 'application/json', ...headers }
    if (who !== 'nobody') {
      all.authorization = 'Bearer good'
    }
    const init: RequestInit = { method, headers: all, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
    return await (who === 'nobody' ? handler : handlerOf(who))(new Request(`https://api.test${path}`, init))
  }

  await call('ana', '/v1/workspaces', { name: 'Parceiros' })
  await call(
    'ana',
    '/v1/workspaces/team',
    {
      name: 'Parceiros',
      version: 1,
      members: [
        { email: EMAIL.ana, role: 'admin' },
        { email: EMAIL.edu, role: 'editor' },
        { email: EMAIL.vera, role: 'viewer' }
      ]
    },
    'PUT'
  )
  await call('ana', '/v1/workspaces/team/collections', { collection: shop() })
  await call('ana', '/v1/workspaces/team/environments', {
    name: 'Dev',
    variables: [
      { key: 'host', value: 'dev.example.com', secret: false },
      { key: 'token', value: 'ENV-SECRET', secret: true }
    ]
  })

  const collection = async (): Promise<{ collection: { items: Node[] }; version: number }> =>
    await (await call('ana', '/v1/workspaces/team/collections/col-1')).json()

  /** The id of a request by its name. */
  const idOf = async (name: string): Promise<string> => {
    const walk = (items: Node[]): string[] =>
      items.flatMap((item) => [
        ...(item.kind === 'request' && item.name === name ? [item.id] : []),
        ...walk(item.children ?? [])
      ])
    return walk((await collection()).collection.items)[0] ?? ''
  }

  /** Changes the saved collection the way an editor would and saves it, keeping every id. */
  const edit = async (change: (items: Node[]) => void) => {
    const current = await collection()
    change(current.collection.items)
    const response = await call(
      'ana',
      '/v1/workspaces/team/collections/col-1',
      { collection: current.collection, version: current.version },
      'PUT'
    )
    if (!response.ok) {
      // A test that edits the collection and does not notice it was refused would pass for the wrong reason.
      throw new Error(`The edit was refused: ${response.status} ${await response.text()}`)
    }
    return response
  }

  return { call, store, access, clock, collection, idOf, edit }
}

export const publish = (overrides: Record<string, unknown> = {}) => ({
  collectionId: 'col-1',
  title: 'Shop API',
  visibility: 'company',
  ...overrides
})
