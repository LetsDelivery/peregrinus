import { describe, expect, test } from 'bun:test'

import { ensureIds, hasAllIds, newNodeId, requestIds } from '../ids.js'
import type { Collection, FolderNode, RequestNode } from '../model.js'

const request = (name: string, id?: string): RequestNode => ({
  kind: 'request',
  ...(id === undefined ? {} : { id }),
  name,
  method: 'GET',
  url: '',
  query: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: []
})

const folder = (name: string, children: FolderNode['children'], id?: string): FolderNode => ({
  kind: 'folder',
  ...(id === undefined ? {} : { id }),
  name,
  auth: { type: 'inherit' },
  children
})

const collection = (items: Collection['items']): Collection => ({
  name: 'Shop',
  auth: { type: 'none' },
  variables: [],
  items
})

describe('newNodeId', () => {
  test('makes 12 URL-safe characters, and a different one each time', () => {
    // Act
    const ids = Array.from({ length: 200 }, () => newNodeId())

    // Assert
    expect(ids.every((id) => /^[A-Za-z0-9_-]{12}$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(200)
  })
})

describe('ensureIds', () => {
  test('gives an id to every folder and request that has none, at any depth, and says it changed', () => {
    // Arrange
    const input = collection([folder('Orders', [request('Get'), folder('Deep', [request('Post')])]), request('Loose')])

    // Act
    const changed = ensureIds(input)

    // Assert
    expect(changed).toBe(true)
    expect(hasAllIds(input)).toBe(true)
    expect(requestIds(input)).toHaveLength(3)
  })

  test('keeps the ids that are there and changes nothing when all of them are', () => {
    // Arrange
    const input = collection([folder('Orders', [request('Get', 'r1')], 'f1'), request('Loose', 'r2')])

    // Act
    const changed = ensureIds(input)

    // Assert
    expect(changed).toBe(false)
    expect(requestIds(input)).toEqual(['r1', 'r2'])
  })

  test('gives the second of two nodes that share an id a new one, so a copy never answers for the original', () => {
    // Arrange
    const input = collection([request('Original', 'same'), request('Copy', 'same')])
    let next = 0

    // Act
    const changed = ensureIds(input, () => {
      next += 1
      return `new-${next}`
    })

    // Assert
    expect(changed).toBe(true)
    expect(requestIds(input)).toEqual(['same', 'new-1'])
  })
})

describe('hasAllIds and requestIds', () => {
  test('say when an id is missing, and list the requests only, never the folders', () => {
    // Arrange
    const input = collection([folder('Orders', [request('Get', 'r1')], 'f1'), request('Loose')])

    // Act & Assert
    expect(hasAllIds(input)).toBe(false)
    expect(requestIds(input)).toEqual(['r1'])
  })
})
