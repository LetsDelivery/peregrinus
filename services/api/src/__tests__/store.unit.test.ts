import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConflictException, NotFoundException } from '@postmano/core'

import { createDynamoStore } from '../store/dynamo.js'
import { createFileStore } from '../store/file.js'
import { createMemoryStore } from '../store/memory.js'
import { createMemoryTable } from '../store/table.js'
import type { DocumentStore } from '../store/types.js'

const NOW = new Date('2026-10-30T12:00:00.000Z')
const input = (overrides: Partial<Parameters<DocumentStore['put']>[2]> = {}) => ({
  id: 'c1',
  name: 'Orders',
  value: { items: [1, 2, 3] },
  expectedVersion: null,
  by: 'ana@uselets.com',
  now: NOW,
  ...overrides
})

/** The behaviour every store must have, run against each of them. */
const contract = (name: string, make: () => DocumentStore) => {
  describe(`${name} store`, () => {
    test('creates at version 1 and reads the document back with who saved it', async () => {
      // Arrange
      const store = make()

      // Act
      await store.put('w1', 'collection', input())
      const doc = await store.get('w1', 'collection', 'c1')

      // Assert
      expect(doc).toEqual({
        id: 'c1',
        name: 'Orders',
        version: 1,
        updatedAt: NOW.toISOString(),
        updatedBy: 'ana@uselets.com',
        value: { items: [1, 2, 3] }
      })
    })

    test('a save with the version it read goes to the next version', async () => {
      // Arrange
      const store = make()
      await store.put('w1', 'collection', input())

      // Act
      const saved = await store.put(
        'w1',
        'collection',
        input({ expectedVersion: 1, value: { items: [9] }, name: 'Orders v2' })
      )

      // Assert
      expect(saved.version).toBe(2)
      expect((await store.get('w1', 'collection', 'c1'))?.value).toEqual({ items: [9] })
    })

    test('refuses a save with an old version, a second create, and a save of what does not exist', async () => {
      // Arrange
      const store = make()
      await store.put('w1', 'collection', input())
      await store.put('w1', 'collection', input({ expectedVersion: 1 }))

      // Act & Assert
      await expect(store.put('w1', 'collection', input({ expectedVersion: 1 }))).rejects.toThrow(ConflictException)
      await expect(store.put('w1', 'collection', input())).rejects.toThrow(ConflictException)
      await expect(store.put('w1', 'collection', input({ id: 'nope', expectedVersion: 3 }))).rejects.toThrow(
        NotFoundException
      )
    })

    test('lists summaries by name and keeps kinds apart', async () => {
      // Arrange
      const store = make()
      await store.put('w1', 'collection', input({ id: 'b', name: 'B' }))
      await store.put('w1', 'collection', input({ id: 'a', name: 'A' }))
      await store.put('w1', 'environment', input({ id: 'e', name: 'Staging' }))

      // Act
      const collections = await store.list('w1', 'collection')
      const environments = await store.list('w1', 'environment')

      // Assert
      expect(collections.map((doc) => doc.name)).toEqual(['A', 'B'])
      expect(environments.map((doc) => doc.name)).toEqual(['Staging'])
    })

    test('removes a document and does not mind removing one that is gone', async () => {
      // Arrange
      const store = make()
      await store.put('w1', 'collection', input())

      // Act
      await store.remove('w1', 'collection', 'c1')
      await store.remove('w1', 'collection', 'c1')

      // Assert
      expect(await store.get('w1', 'collection', 'c1')).toBeUndefined()
      expect(await store.list('w1', 'collection')).toEqual([])
    })

    test('keeps the same id apart in two scopes', async () => {
      // Arrange
      const store = make()
      await store.put('w1', 'collection', input({ name: 'In one' }))
      await store.put('w2', 'collection', input({ name: 'In two' }))

      // Act
      const one = await store.get('w1', 'collection', 'c1')
      const two = await store.get('w2', 'collection', 'c1')
      await store.remove('w1', 'collection', 'c1')

      // Assert
      expect([one?.name, two?.name]).toEqual(['In one', 'In two'])
      expect(await store.list('w1', 'collection')).toEqual([])
      expect((await store.list('w2', 'collection')).map((doc) => doc.name)).toEqual(['In two'])
    })

    test('does not hand out a reference to what it stores', async () => {
      // Arrange
      const store = make()
      const value = { items: [1] }
      await store.put('w1', 'collection', input({ value }))

      // Act
      value.items.push(2)
      const doc = await store.get('w1', 'collection', 'c1')

      // Assert
      expect(doc?.value).toEqual({ items: [1] })
    })
  })
}

contract('memory', createMemoryStore)
contract('DynamoDB (memory table)', () => createDynamoStore(createMemoryTable(), 64))
contract('file', () => createFileStore(join(mkdtempSync(join(tmpdir(), 'pg-store-')), 'data.json')))

describe('DynamoDB store specifics', () => {
  test('splits a body bigger than a chunk and joins it back, whatever its size', async () => {
    // Arrange
    const table = createMemoryTable()
    const store = createDynamoStore(table, 100)
    const big = { text: Array.from({ length: 400 }, (_, at) => `line ${at} ${Math.sin(at)}`).join('\n') }

    // Act
    await store.put('w1', 'collection', input({ value: big }))
    const doc = await store.get('w1', 'collection', 'c1')

    // Assert
    expect(doc?.value).toEqual(big)
    expect(table.size()).toBeGreaterThan(4)
  })

  test('removes the chunks of the old version after a save, and all of them on remove', async () => {
    // Arrange
    const table = createMemoryTable()
    const store = createDynamoStore(table, 50)
    await store.put('w1', 'collection', input({ value: { text: 'x'.repeat(500) } }))
    const afterFirst = table.size()

    // Act
    await store.put('w1', 'collection', input({ expectedVersion: 1, value: { text: 'x'.repeat(500) } }))
    const afterSecond = table.size()
    await store.remove('w1', 'collection', 'c1')

    // Assert
    expect(afterSecond).toBe(afterFirst)
    expect(table.size()).toBe(0)
  })

  test('a failed control write leaves no chunks behind and reads still see the old version', async () => {
    // Arrange
    const table = createMemoryTable()
    const store = createDynamoStore(table, 50)
    await store.put('w1', 'collection', input())
    const sizeBefore = table.size()
    const racing = { ...table, transact: async () => false }
    const loser = createDynamoStore(racing, 50)

    // Act & Assert
    await expect(
      loser.put('w1', 'collection', input({ expectedVersion: 1, value: { text: 'y'.repeat(300) } }))
    ).rejects.toThrow(ConflictException)
    expect(table.size()).toBe(sizeBefore)
    expect((await store.get('w1', 'collection', 'c1'))?.version).toBe(1)
  })
})

describe('DynamoDB store, concurrent saves', () => {
  test('two saves from the same version: one wins, one conflicts, and the winner stays readable', async () => {
    // Arrange
    const table = createMemoryTable()
    const store = createDynamoStore(table, 50)
    await store.put('w1', 'collection', input({ value: { text: 'a'.repeat(200) } }))

    // Act
    const results = await Promise.allSettled([
      store.put('w1', 'collection', input({ expectedVersion: 1, value: { text: 'b'.repeat(400) } })),
      store.put('w1', 'collection', input({ expectedVersion: 1, value: { text: 'c'.repeat(300) } }))
    ])
    const doc = await store.get('w1', 'collection', 'c1')

    // Assert
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(doc?.version).toBe(2)
    const text = (doc?.value as { text: string } | undefined)?.text ?? ''
    expect(['b'.repeat(400), 'c'.repeat(300)]).toContain(text)
  })

  test('a failed cleanup of the old chunks does not turn a saved document into an error', async () => {
    // Arrange
    const table = createMemoryTable()
    await createDynamoStore(table, 50).put('w1', 'collection', input())
    const flaky = createDynamoStore({ ...table, deleteMany: async () => Promise.reject(new Error('throttled')) }, 50)

    // Act
    const saved = await flaky.put('w1', 'collection', input({ expectedVersion: 1, value: { text: 'z' } }))

    // Assert
    expect(saved.version).toBe(2)
    expect((await flaky.get('w1', 'collection', 'c1'))?.value).toEqual({ text: 'z' })
  })

  test('says so when a chunk is missing, instead of handing back half a document', async () => {
    // Arrange
    const table = createMemoryTable()
    const store = createDynamoStore(table, 20)
    await store.put('w1', 'collection', input({ value: { text: 'x'.repeat(300) } }))
    const [first] = await table.query('DOC#w1#collection#c1', 'V#')
    await table.deleteMany([{ pk: String(first?.pk), sk: String(first?.sk) }])

    // Act & Assert
    await expect(store.get('w1', 'collection', 'c1')).rejects.toThrow(/chunks/)
  })

  test('remove says whether there was something to remove', async () => {
    // Arrange
    const store = createDynamoStore(createMemoryTable(), 50)
    await store.put('w1', 'collection', input())

    // Act & Assert
    expect(await store.remove('w1', 'collection', 'c1')).toBe(true)
    expect(await store.remove('w1', 'collection', 'c1')).toBe(false)
  })
})

describe('file store', () => {
  test('keeps its documents between runs', async () => {
    // Arrange
    const path = join(mkdtempSync(join(tmpdir(), 'pg-store-')), 'data.json')
    await createFileStore(path).put('w1', 'collection', input())

    // Act
    const again = await createFileStore(path).get('w1', 'collection', 'c1')

    // Assert
    expect(again?.name).toBe('Orders')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1)
  })
})
