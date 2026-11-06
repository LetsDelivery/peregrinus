import { describe, expect, test } from 'bun:test'

import {
  daysLeft,
  draftFromPublication,
  expiryPayload,
  formatUtc,
  formatUtcDay,
  newDraft,
  payloadFromDraft,
  requestIdsUnder,
  shareUrl,
  toggleNode,
  treeRows
} from './share.js'

const tree = [
  {
    kind: 'folder',
    id: 'f1',
    name: 'Orders',
    children: [
      { kind: 'request', id: 'r1', name: 'Get', method: 'GET' },
      {
        kind: 'folder',
        id: 'f2',
        name: 'Admin',
        children: [{ kind: 'request', id: 'r2', name: 'Reset', method: 'POST' }]
      }
    ]
  },
  { kind: 'request', id: 'r3', name: 'Loose', method: 'GET' },
  { kind: 'folder', id: 'f3', name: 'Empty', children: [] }
]

describe('the selection tree', () => {
  test('lists every request under any folder, and nothing else', () => {
    // Act & Assert
    expect(requestIdsUnder(tree)).toEqual(['r1', 'r2', 'r3'])
  })

  test('draws every row, indented, with the folders ticked, not ticked or partly ticked', () => {
    // Act
    const rows = treeRows(tree, ['r1', 'r3'])

    // Assert
    expect(rows.map((row) => [row.depth, row.name, row.state])).toEqual([
      [0, 'Orders', 'mixed'],
      [1, 'Get', 'on'],
      [1, 'Admin', 'off'],
      [2, 'Reset', 'off'],
      [0, 'Loose', 'on'],
      [0, 'Empty', 'off']
    ])
    expect(rows.find((row) => row.name === 'Empty')?.empty).toBe(true)
  })

  test('shows a folder as ticked only when everything in it is', () => {
    // Act
    const rows = treeRows(tree, ['r1', 'r2'])

    // Assert
    expect(rows.find((row) => row.name === 'Orders')?.state).toBe('on')
    expect(rows.find((row) => row.name === 'Admin')?.state).toBe('on')
  })

  test('ticking a request toggles it alone', () => {
    // Act
    const on = toggleNode(tree, [], 'r1')
    const off = toggleNode(tree, on, 'r1')

    // Assert
    expect(on).toEqual(['r1'])
    expect(off).toEqual([])
  })

  test('ticking a folder ticks everything it holds, and clearing it clears all of it', () => {
    // Act
    const ticked = toggleNode(tree, [], 'f1')
    const partly = toggleNode(tree, ['r1'], 'f1')
    const cleared = toggleNode(tree, ticked, 'f1')

    // Assert
    expect([...ticked].sort()).toEqual(['r1', 'r2'])
    expect([...partly].sort()).toEqual(['r1', 'r2'])
    expect(cleared).toEqual([])
  })

  test('keeps what was ticked elsewhere, and ignores an id that is not in the tree or a folder with nothing in it', () => {
    // Act & Assert
    expect(toggleNode(tree, ['r3'], 'f1').sort()).toEqual(['r1', 'r2', 'r3'])
    expect(toggleNode(tree, ['r3'], 'nope')).toEqual(['r3'])
    expect(toggleNode(tree, ['r3'], 'f3')).toEqual(['r3'])
  })
})

describe('dates and expiry', () => {
  test('writes a time in UTC with the zone, and a day alone', () => {
    // Act & Assert
    expect(formatUtc('2026-11-05T09:07:00.000Z')).toBe('05/11/2026 09:07 UTC')
    expect(formatUtcDay('2026-12-31T23:59:59.999Z')).toBe('31/12/2026')
  })

  test('counts the days left, rounded up, none for a page that never expires, and zero or less when it has', () => {
    // Arrange
    const now = new Date('2026-11-05T12:00:00.000Z')

    // Act & Assert
    expect(daysLeft('2026-11-12T12:00:00.000Z', now)).toBe(7)
    expect(daysLeft('2026-11-12T12:00:01.000Z', now)).toBe(8)
    expect(daysLeft(null, now)).toBeNull()
    expect(daysLeft('2026-11-05T12:00:00.000Z', now)).toBe(0)
    expect(daysLeft('2026-11-01T12:00:00.000Z', now)).toBeLessThan(0)
  })

  test('turns the picked validity into what the API takes, and sends nothing when the current one is kept', () => {
    // Act & Assert
    expect(expiryPayload({ expiryKind: '30' })).toEqual({ kind: 'days', days: 30 })
    expect(expiryPayload({ expiryKind: '7' })).toEqual({ kind: 'days', days: 7 })
    expect(expiryPayload({ expiryKind: 'date', expiryDate: '2026-12-31' })).toEqual({
      kind: 'date',
      date: '2026-12-31'
    })
    expect(expiryPayload({ expiryKind: 'never' })).toEqual({ kind: 'never' })
    expect(expiryPayload({ expiryKind: 'keep' })).toBeUndefined()
  })
})

describe('draft and payload', () => {
  test('a new draft is a link for anyone of the company, over the whole collection, for 30 days', () => {
    // Act
    const payload = payloadFromDraft(newDraft('Shop'), 'col-1')

    // Assert
    expect(payload).toEqual({
      collectionId: 'col-1',
      title: 'Shop',
      visibility: 'company',
      people: [],
      selection: null,
      environmentId: null,
      language: 'curl',
      expiry: { kind: 'days', days: 30 }
    })
  })

  test('sends the ticked requests only in selection mode, and the pasted addresses only for "people"', () => {
    // Arrange
    const draft = {
      ...newDraft('Shop'),
      visibility: 'people',
      mode: 'selection',
      selection: ['r1', 'r3'],
      peopleText: 'ana@uselets.com, bob@lets.delivery;\n cris@uselets.com ',
      environmentId: 'env-1'
    }

    // Act
    const payload = payloadFromDraft(draft, 'col-1')
    const whole = payloadFromDraft({ ...draft, mode: 'whole', visibility: 'company' }, 'col-1')

    // Assert
    expect(payload.people).toEqual(['ana@uselets.com', 'bob@lets.delivery', 'cris@uselets.com'])
    expect(payload.selection).toEqual(['r1', 'r3'])
    expect(payload.environmentId).toBe('env-1')
    expect(whole.selection).toBeNull()
    expect(whole.people).toEqual([])
  })

  test('reads a saved publication back into a draft that keeps its validity and saves as the same thing', () => {
    // Arrange
    const publication = {
      slug: 's1',
      version: 3,
      collectionId: 'col-1',
      title: 'Shop',
      visibility: 'password',
      people: [],
      selection: ['r2'],
      environmentId: null,
      language: 'python',
      expiresAt: '2026-12-05T12:00:00.000Z',
      adminOnly: true,
      passwordSetAt: '2026-11-05T12:00:00.000Z',
      lockedUntil: null,
      lastAccessAt: null,
      health: { removed: 0, added: 2 }
    }

    // Act
    const draft = draftFromPublication(publication)
    const payload = payloadFromDraft(draft, 'col-1')

    // Assert
    expect(draft).toMatchObject({ slug: 's1', version: 3, mode: 'selection', selection: ['r2'], expiryKind: 'keep' })
    expect(payload).toEqual({
      collectionId: 'col-1',
      title: 'Shop',
      visibility: 'password',
      people: [],
      selection: ['r2'],
      environmentId: null,
      language: 'python'
    })
  })

  test('reads a page that follows the whole collection as the whole', () => {
    // Act
    const draft = draftFromPublication({
      slug: 's1',
      version: 1,
      title: 'Shop',
      visibility: 'company',
      people: [],
      selection: null,
      environmentId: null,
      language: 'curl',
      expiresAt: null,
      adminOnly: false,
      passwordSetAt: null,
      lockedUntil: null,
      lastAccessAt: null,
      health: null
    })

    // Assert
    expect(draft).toMatchObject({ mode: 'whole', selection: [] })
  })

  test('builds the address from the page origin and the slug', () => {
    // Act & Assert
    expect(shareUrl('https://postmano.uselets.com', 'abc_DEF-123')).toBe(
      'https://postmano.uselets.com/docs/abc_DEF-123'
    )
  })
})
