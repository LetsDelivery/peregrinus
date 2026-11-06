import { describe, expect, test } from 'bun:test'

import { LOCK_MS } from '../access-state.js'
import { makeWorld, publish, request } from './world.js'

const DOCS = '/v1/workspaces/team/docs'
const DAY = 86_400_000

type Saved = {
  publication: { slug: string; version: number; expiresAt: string | null; [key: string]: unknown }
  warnings: unknown[]
  password?: string
}

const create = async (world: Awaited<ReturnType<typeof makeWorld>>, who: 'ana' | 'edu', body: unknown) => {
  const response = await world.call(who, DOCS, body)
  return { response, saved: (await response.clone().json()) as Saved }
}

const names = (items: { name: string; children?: unknown[] }[]): string[] => items.map((item) => item.name)

describe('a selection of the collection', () => {
  test('shows only the ticked requests, with the folders around them, and leaves the rest out', async () => {
    // Arrange
    const world = await makeWorld()
    const selection = [await world.idOf('Get order'), await world.idOf('Ping')]
    await create(world, 'ana', publish({ visibility: 'link', selection }))

    // Act
    const page = await (await world.call('nobody', '/v1/docs/slug-1')).json()

    // Assert
    expect(names(page.collection.items)).toEqual(['Orders', 'Ping'])
    expect(names(page.collection.items[0].children)).toEqual(['Get order'])
    const text = JSON.stringify(page)
    for (const absent of ['List orders', 'Admin', 'Reset', 'HEADER-SECRET', 'COLLECTION-TOKEN']) {
      expect(text).not.toContain(absent)
    }
  })

  test('gives every folder and request an id when the collection is saved, and keeps them on the next save', async () => {
    // Arrange
    const world = await makeWorld()
    const idsIn = async () =>
      JSON.stringify((await world.collection()).collection.items).match(/"id":"[A-Za-z0-9_-]{12}"/g)

    // Act
    const before = await idsIn()
    await world.edit(() => undefined)
    const after = await idsIn()

    // Assert
    expect(before).toHaveLength(6)
    expect(new Set(before).size).toBe(6)
    expect([...(after ?? [])].sort()).toEqual([...(before ?? [])].sort())
  })

  test('refuses an empty selection, an id that is not a request of the collection, and a folder id', async () => {
    // Arrange
    const world = await makeWorld()
    const folderId = (await world.collection()).collection.items[0]?.id ?? ''

    // Act
    const empty = await world.call('ana', DOCS, publish({ selection: [] }))
    const unknown = await world.call('ana', DOCS, publish({ selection: ['nope'] }))
    const aFolder = await world.call('ana', DOCS, publish({ selection: [folderId] }))

    // Assert
    expect([empty.status, unknown.status, aFolder.status]).toEqual([400, 400, 400])
  })

  test('survives renaming and moving a ticked request, because the page knows it by its id', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish({ visibility: 'link', selection: [await world.idOf('Get order')] }))

    // Act
    await world.edit((items) => {
      const orders = items[0]
      const moved = orders?.children?.shift()
      if (moved) {
        moved.name = 'Renamed on the way'
        items[1]?.children?.push(moved)
      }
    })
    const page = await (await world.call('nobody', '/v1/docs/slug-1')).json()

    // Assert
    expect(names(page.collection.items)).toEqual(['Admin'])
    expect(names(page.collection.items[0].children)).toEqual(['Renamed on the way'])
  })

  test('drops a deleted request and keeps the rest, and answers 404 when nothing is left', async () => {
    // Arrange
    const world = await makeWorld()
    const selection = [await world.idOf('Get order'), await world.idOf('Ping')]
    await create(world, 'ana', publish({ visibility: 'link', selection }))

    // Act
    await world.edit((items) => {
      items[0]?.children?.shift()
    })
    const partly = await (await world.call('nobody', '/v1/docs/slug-1')).json()
    await world.edit((items) => {
      items.pop()
    })
    const nothing = await world.call('nobody', '/v1/docs/slug-1')

    // Assert
    expect(names(partly.collection.items)).toEqual(['Ping'])
    expect(nothing.status).toBe(404)
  })

  test('keeps out what was added later, and tells the admin how many are new and how many were deleted', async () => {
    // Arrange
    const world = await makeWorld()
    const selection = [await world.idOf('Get order'), await world.idOf('Ping')]
    await create(world, 'ana', publish({ visibility: 'link', selection }))

    // Act
    await world.edit((items) => {
      items[0]?.children?.push(request('Internal only') as never)
    })
    await world.edit((items) => {
      items.pop()
    })
    const page = JSON.stringify(await (await world.call('nobody', '/v1/docs/slug-1')).json())
    const listed = await (await world.call('ana', DOCS)).json()

    // Assert
    expect(page).not.toContain('Internal only')
    expect(listed.items[0].health).toEqual({ removed: 1, added: 1 })
  })

  test('is not reported as health for a page that follows the whole collection', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish())

    // Act
    const listed = await (await world.call('ana', DOCS)).json()

    // Assert
    expect(listed.items[0]).toMatchObject({ selection: null, health: null })
  })

  test('is only possible after the ids exist: a collection saved before them gets them from the ids route', async () => {
    // Arrange
    const world = await makeWorld()
    await world.store.put('team', 'collection', {
      id: 'old',
      name: 'Old',
      value: {
        name: 'Old',
        auth: { type: 'none' },
        variables: [],
        items: [{ ...(await world.collection()).collection.items[2], id: undefined }]
      },
      expectedVersion: null,
      by: 'ana@uselets.com',
      now: new Date()
    })

    // Act
    const refused = await world.call('ana', DOCS, publish({ collectionId: 'old', selection: ['x'] }))
    const first = await (await world.call('ana', '/v1/workspaces/team/collections/old/ids', {})).json()
    const second = await (await world.call('ana', '/v1/workspaces/team/collections/old/ids', {})).json()

    // Assert
    expect(refused.status).toBe(400)
    expect(first.collection.items[0].id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(first.version).toBe(2)
    expect(second.version).toBe(2)
    expect(second.collection.items[0].id).toBe(first.collection.items[0].id)
  })

  test('closes a page saved before selections existed, so it never shows more than it did', async () => {
    // Arrange
    const world = await makeWorld()
    const base = {
      collectionId: 'col-1',
      title: 'Old',
      visibility: 'link',
      people: [],
      environmentId: null,
      language: 'curl'
    }
    await world.store.put('team', 'publication', {
      id: 'legacy',
      name: 'Old',
      value: { ...base, folderPath: [0] },
      expectedVersion: null,
      by: 'ana@uselets.com',
      now: new Date()
    })
    await world.store.put('GLOBAL', 'publication', {
      id: 'legacy',
      name: 'team',
      value: { workspaceId: 'team' },
      expectedVersion: null,
      by: 'ana@uselets.com',
      now: new Date()
    })

    // Act
    const response = await world.call('nobody', '/v1/docs/legacy')

    // Assert
    expect(response.status).toBe(404)
  })
})

describe('expiry', () => {
  test('is 30 days from now by default, whatever the visibility', async () => {
    // Arrange
    const world = await makeWorld()

    // Act
    const { saved } = await create(world, 'ana', publish({ visibility: 'workspace' }))

    // Assert
    expect(saved.publication.expiresAt).toBe(new Date(world.clock.at.getTime() + 30 * DAY).toISOString())
  })

  test('can be 7 or 90 days, a date (the end of that day, UTC), or never', async () => {
    // Arrange
    const world = await makeWorld()

    // Act
    const week = (await create(world, 'ana', publish({ expiry: { kind: 'days', days: 7 } }))).saved
    const date = (await create(world, 'ana', publish({ expiry: { kind: 'date', date: '2026-12-31' } }))).saved
    const never = (await create(world, 'ana', publish({ expiry: { kind: 'never' } }))).saved

    // Assert
    expect(week.publication.expiresAt).toBe('2026-11-12T12:00:00.000Z')
    expect(date.publication.expiresAt).toBe('2026-12-31T23:59:59.999Z')
    expect(never.publication.expiresAt).toBeNull()
  })

  test('refuses a date in the past', async () => {
    // Arrange
    const world = await makeWorld()

    // Act
    const response = await world.call('ana', DOCS, publish({ expiry: { kind: 'date', date: '2026-11-04' } }))

    // Assert
    expect(response.status).toBe(400)
  })

  test('closes the page at that instant with a message of its own, for a public link and for a company page alike', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish({ visibility: 'link', expiry: { kind: 'days', days: 1 } }))
    await create(world, 'ana', publish({ visibility: 'company', expiry: { kind: 'days', days: 1 } }))
    const before = [
      (await world.call('nobody', '/v1/docs/slug-1')).status,
      (await world.call('cris', '/v1/docs/slug-2')).status
    ]

    // Act
    world.clock.at = new Date(world.clock.at.getTime() + DAY)
    const link = await world.call('nobody', '/v1/docs/slug-1')
    const company = await world.call('cris', '/v1/docs/slug-2')

    // Assert
    expect(before).toEqual([200, 200])
    expect([link.status, company.status]).toEqual([410, 410])
    expect(await link.json()).toMatchObject({ error: { code: 'expired' } })
  })

  test('says nothing about a team page to someone who may not open it, expired or not', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish({ visibility: 'workspace', expiry: { kind: 'days', days: 1 } }))
    world.clock.at = new Date(world.clock.at.getTime() + DAY)

    // Act
    const outsider = await world.call('cris', '/v1/docs/slug-1')
    const member = await world.call('vera', '/v1/docs/slug-1')

    // Assert
    expect(outsider.status).toBe(403)
    expect(member.status).toBe(410)
  })

  test('remembers the requests it has seen only when it follows a selection', async () => {
    // Arrange
    const world = await makeWorld()
    const selection = [await world.idOf('Ping')]
    await create(world, 'ana', publish({ visibility: 'link' }))
    await create(world, 'ana', publish({ visibility: 'link', selection }))

    // Act
    const whole = await world.store.get('team', 'publication', 'slug-1')
    const picked = await world.store.get('team', 'publication', 'slug-2')

    // Assert
    const seen = (doc: { value: unknown } | undefined) => (doc as { value: { seen: string[] } }).value.seen
    expect(seen(whole)).toEqual([])
    expect(seen(picked)).toHaveLength(4)
  })

  test('is kept when a save does not send one, and changed when it does', async () => {
    // Arrange
    const world = await makeWorld()
    const { saved } = await create(world, 'ana', publish({ visibility: 'link', expiry: { kind: 'days', days: 7 } }))
    const slug = saved.publication.slug

    // Act
    const kept = await (
      await world.call('ana', `${DOCS}/${slug}`, publish({ visibility: 'link', title: 'Renamed', version: 1 }), 'PUT')
    ).json()
    const never = await (
      await world.call(
        'ana',
        `${DOCS}/${slug}`,
        publish({ visibility: 'link', version: 2, expiry: { kind: 'never' } }),
        'PUT'
      )
    ).json()

    // Assert
    expect(kept.publication.expiresAt).toBe(saved.publication.expiresAt)
    expect(never.publication.expiresAt).toBeNull()
  })
})

describe('a page with a password', () => {
  const makeOne = async (world: Awaited<ReturnType<typeof makeWorld>>, overrides: Record<string, unknown> = {}) => {
    const { saved } = await create(world, 'ana', publish({ visibility: 'password', ...overrides }))
    return { slug: saved.publication.slug, password: saved.password ?? '', saved }
  }
  const submit = (world: Awaited<ReturnType<typeof makeWorld>>, slug: string, password: string) =>
    world.call('nobody', `/v1/docs/${slug}/access`, { password })
  const open = (world: Awaited<ReturnType<typeof makeWorld>>, slug: string, token?: string) =>
    world.call('nobody', `/v1/docs/${slug}`, undefined, 'GET', token ? { 'x-docs-token': token } : {})

  test('is made by an admin, who gets the password once; an editor cannot make one', async () => {
    // Arrange
    const world = await makeWorld()

    // Act
    const byEditor = await world.call('edu', DOCS, publish({ visibility: 'password' }))
    const { saved, password } = await makeOne(world)

    // Assert
    expect(byEditor.status).toBe(403)
    expect(password).toMatch(/^[A-Za-z0-9]{16}$/)
    expect(saved.publication).toMatchObject({ visibility: 'password', adminOnly: true })
  })

  test('never shows the password or its hash again: the list says only when it was set', async () => {
    // Arrange
    const world = await makeWorld()
    const { password } = await makeOne(world)

    // Act
    const asAdmin = await (await world.call('ana', DOCS)).text()
    const asEditor = await (await world.call('edu', DOCS)).text()

    // Assert
    for (const text of [asAdmin, asEditor]) {
      expect(text).not.toContain(password)
      expect(text).not.toContain('"hash"')
      expect(text).not.toContain('"salt"')
      expect(text).toContain('"passwordSetAt":"2026-11-05T12:00:00.000Z"')
    }
  })

  test('is seen by an editor but changed, moved or removed only by an admin', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug } = await makeOne(world)
    const aLink = (await create(world, 'ana', publish({ visibility: 'link' }))).saved.publication.slug
    const asEditor = await (await world.call('edu', DOCS)).json()

    // Act
    const edit = await world.call(
      'edu',
      `${DOCS}/${slug}`,
      publish({ visibility: 'password', title: 'x', version: 1 }),
      'PUT'
    )
    const toLink = await world.call('edu', `${DOCS}/${slug}`, publish({ visibility: 'link', version: 1 }), 'PUT')
    const intoPassword = await world.call(
      'edu',
      `${DOCS}/${aLink}`,
      publish({ visibility: 'password', version: 1 }),
      'PUT'
    )
    const remove = await world.call('edu', `${DOCS}/${slug}`, undefined, 'DELETE')

    // Assert
    expect(asEditor.items).toHaveLength(2)
    expect([edit.status, toLink.status, intoPassword.status, remove.status]).toEqual([403, 403, 403, 403])
    expect((await open(world, slug)).status).toBe(401)
  })

  test('asks for the password: 401 without a token, and the page opens with the token the right password gave', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world, { selection: [await world.idOf('Ping')] })

    // Act
    const closed = await open(world, slug)
    const given = await submit(world, slug, password)
    const { token, expiresAt } = await given.json()
    const opened = await open(world, slug, token)
    const page = await opened.json()

    // Assert
    expect(closed.status).toBe(401)
    expect(await closed.json()).toMatchObject({ error: { code: 'password_required' } })
    expect(given.status).toBe(200)
    expect(expiresAt).toBe('2026-11-05T20:00:00.000Z')
    expect(opened.status).toBe(200)
    expect(names(page.collection.items)).toEqual(['Ping'])
    expect(JSON.stringify(page)).not.toContain('HEADER-SECRET')
  })

  test('refuses a token that is wrong, made up or meant for another page', async () => {
    // Arrange
    const world = await makeWorld()
    const first = await makeOne(world)
    const second = await makeOne(world)
    const { token } = await (await submit(world, first.slug, first.password)).json()

    // Act & Assert
    expect((await open(world, first.slug, `${token}x`)).status).toBe(401)
    expect((await open(world, first.slug, 'v1.9999999999999.abc')).status).toBe(401)
    expect((await open(world, second.slug, token)).status).toBe(401)
  })

  test('counts wrong passwords, says how many are left, and locks at the fifth, the right password included', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)

    // Act
    const answers = []
    for (let n = 0; n < 5; n += 1) {
      answers.push(await submit(world, slug, 'not the password'))
    }
    const bodies = await Promise.all(answers.map((answer) => answer.json()))
    const theRightOne = await submit(world, slug, password)

    // Assert
    expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 429])
    expect(bodies.slice(0, 4).map((body) => body.error.data.attemptsLeft)).toEqual([4, 3, 2, 1])
    expect(bodies[4].error).toMatchObject({ code: 'locked', data: { lockedUntil: '2026-11-05T12:15:00.000Z' } })
    expect(theRightOne.status).toBe(429)
  })

  test('opens again after 15 minutes, and the right password clears the count', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)
    for (let n = 0; n < 5; n += 1) {
      await submit(world, slug, 'wrong')
    }

    // Act
    world.clock.at = new Date(world.clock.at.getTime() + LOCK_MS)
    const opened = await submit(world, slug, password)
    const again = await (await submit(world, slug, 'wrong')).json()

    // Assert
    expect(opened.status).toBe(200)
    expect(again.error.data.attemptsLeft).toBe(4)
  })

  test('tells the admin when it is locked, and a new password ends the lock and every open session', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)
    const { token } = await (await submit(world, slug, password)).json()
    for (let n = 0; n < 5; n += 1) {
      await submit(world, slug, 'wrong')
    }
    const locked = (await (await world.call('ana', DOCS)).json()).items[0].lockedUntil

    // Act
    const rotated = await (
      await world.call(
        'ana',
        `${DOCS}/${slug}`,
        publish({ visibility: 'password', version: 1, rotatePassword: true }),
        'PUT'
      )
    ).json()
    const oldPassword = await submit(world, slug, password)
    const newPassword = await submit(world, slug, rotated.password)

    // Assert
    expect(locked).toBe('2026-11-05T12:15:00.000Z')
    expect(rotated.password).toMatch(/^[A-Za-z0-9]{16}$/)
    expect(rotated.password).not.toBe(password)
    expect(oldPassword.status).toBe(401)
    expect(newPassword.status).toBe(200)
    expect((await open(world, slug, token)).status).toBe(401)
  })

  test('keeps a session that was open before the lock: a stranger guessing must not close the page on its reader', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)
    const { token } = await (await submit(world, slug, password)).json()

    // Act
    for (let n = 0; n < 5; n += 1) {
      await submit(world, slug, 'wrong')
    }
    const reader = await open(world, slug, token)
    const stranger = await submit(world, slug, password)

    // Assert
    expect(reader.status).toBe(200)
    expect(stranger.status).toBe(429)
  })

  test('is renewed only with a new password: a new date alone would reopen the old one', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)

    // Act
    const renewed = await (
      await world.call(
        'ana',
        `${DOCS}/${slug}`,
        publish({ visibility: 'password', version: 1, expiry: { kind: 'days', days: 90 } }),
        'PUT'
      )
    ).json()

    // Assert
    expect(renewed.password).toMatch(/^[A-Za-z0-9]{16}$/)
    expect(renewed.publication.expiresAt).toBe('2027-02-03T12:00:00.000Z')
    expect((await submit(world, slug, password)).status).toBe(401)
    expect((await submit(world, slug, renewed.password)).status).toBe(200)
  })

  test('keeps its password when it is saved without a new date or a new password', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)

    // Act
    const saved = await (
      await world.call(
        'ana',
        `${DOCS}/${slug}`,
        publish({ visibility: 'password', version: 1, title: 'Renamed' }),
        'PUT'
      )
    ).json()

    // Assert
    expect(saved.password).toBeUndefined()
    expect((await submit(world, slug, password)).status).toBe(200)
  })

  test('says it expired, not that it is missing, once the date passes', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world, { expiry: { kind: 'days', days: 7 } })
    const { token } = await (await submit(world, slug, password)).json()

    // Act
    world.clock.at = new Date(world.clock.at.getTime() + 7 * DAY)
    const page = await open(world, slug, token)
    const access = await submit(world, slug, password)

    // Assert
    expect([page.status, access.status]).toEqual([410, 410])
    expect(await page.json()).toMatchObject({ error: { code: 'expired' } })
  })

  test('ends a session when the page does: the token never outlives the expiry', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world, { expiry: { kind: 'days', days: 1 } })

    // Act
    world.clock.at = new Date(world.clock.at.getTime() + DAY - 3_600_000)
    const { expiresAt } = await (await submit(world, slug, password)).json()

    // Assert
    expect(expiresAt).toBe('2026-11-06T12:00:00.000Z')
  })

  test('answers 404 for an address that does not exist and for a page that has no password', async () => {
    // Arrange
    const world = await makeWorld()
    const link = (await create(world, 'ana', publish({ visibility: 'link' }))).saved.publication.slug

    // Act & Assert
    expect((await submit(world, 'nope', 'x')).status).toBe(404)
    expect((await submit(world, link, 'x')).status).toBe(404)
    expect((await open(world, 'nope')).status).toBe(404)
  })

  test('is checked for credentials like a public link: refused unless the author confirms, and closed if one appears later', async () => {
    // Arrange
    const world = await makeWorld()
    const leaky = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    await world.edit((items) => {
      const ping = items[2] as unknown as { description?: string }
      ping.description = `use ${leaky}`
    })

    // Act
    const refused = await world.call('ana', DOCS, publish({ visibility: 'password' }))
    const confirmed = await world.call('ana', DOCS, publish({ visibility: 'password', acknowledgeSecrets: true }))

    // Assert
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ error: { code: 'unsafe_content' } })
    expect(confirmed.status).toBe(200)
  })

  test('is checked for credentials in the environment it uses, when it is made and every time it opens', async () => {
    // Arrange
    const world = await makeWorld()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    const environment = await (
      await world.call('ana', '/v1/workspaces/team/environments', {
        name: 'Leaky',
        variables: [{ key: 'adminHeader', value: jwt, secret: false }]
      })
    ).json()
    const body = publish({ visibility: 'password', environmentId: environment.id })

    // Act
    const refused = await world.call('ana', DOCS, body)
    const confirmed = await world.call('ana', DOCS, { ...body, acknowledgeSecrets: true })

    // Assert
    expect(refused.status).toBe(422)
    expect(confirmed.status).toBe(200)
  })

  test('does not keep a yes given when there was nothing to confirm: a credential added later closes the page', async () => {
    // Arrange
    const world = await makeWorld()
    const leaky = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    const { saved } = await create(world, 'ana', publish({ visibility: 'password', acknowledgeSecrets: true }))
    const { token } = await (await submit(world, saved.publication.slug, saved.password ?? '')).json()

    // Act
    await world.edit((items) => {
      const ping = items[2] as unknown as { description?: string }
      ping.description = `use ${leaky}`
    })
    const page = await open(world, saved.publication.slug, token)

    // Assert
    expect(page.status).toBe(404)
  })

  test('closes when a credential is added after it was approved clean', async () => {
    // Arrange
    const world = await makeWorld()
    const { slug, password } = await makeOne(world)
    const { token } = await (await submit(world, slug, password)).json()
    const before = (await open(world, slug, token)).status

    // Act
    await world.edit((items) => {
      const ping = items[2] as unknown as { description?: string }
      ping.description = 'use eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'
    })
    const after = await open(world, slug, token)

    // Assert
    expect([before, after.status]).toEqual([200, 404])
  })

  test('forgets the lock, the count and the last access when it is removed, and goes with its collection', async () => {
    // Arrange
    const world = await makeWorld()
    const one = await makeOne(world)
    const two = await makeOne(world)
    await submit(world, one.slug, 'wrong')
    await submit(world, two.slug, two.password)

    // Act
    const removed = await world.call('ana', `${DOCS}/${one.slug}`, undefined, 'DELETE')
    await world.call('ana', '/v1/workspaces/team/collections/col-1', undefined, 'DELETE')

    // Assert
    expect(removed.status).toBe(200)
    expect(await world.access.lastAccess(two.slug)).toBeUndefined()
    expect((await world.call('nobody', `/v1/docs/${one.slug}`)).status).toBe(404)
    expect((await world.call('nobody', `/v1/docs/${two.slug}`)).status).toBe(404)
  })
})

describe('the last access', () => {
  test('is noted when a page opens, at most once an hour, and shown to the admin', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish({ visibility: 'link' }))

    // Act
    await world.call('nobody', '/v1/docs/slug-1')
    world.clock.at = new Date(world.clock.at.getTime() + 30 * 60_000)
    await world.call('nobody', '/v1/docs/slug-1')
    const within = (await (await world.call('ana', DOCS)).json()).items[0].lastAccessAt
    world.clock.at = new Date(world.clock.at.getTime() + 31 * 60_000)
    await world.call('nobody', '/v1/docs/slug-1')
    const next = (await (await world.call('ana', DOCS)).json()).items[0].lastAccessAt

    // Assert
    expect(within).toBe('2026-11-05T12:00:00.000Z')
    expect(next).toBe('2026-11-05T13:01:00.000Z')
  })

  test('is empty until someone opens the page', async () => {
    // Arrange
    const world = await makeWorld()
    await create(world, 'ana', publish({ visibility: 'link' }))

    // Act
    const listed = await (await world.call('ana', DOCS)).json()

    // Assert
    expect(listed.items[0].lastAccessAt).toBeNull()
  })
})
