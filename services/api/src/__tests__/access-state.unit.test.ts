import { describe, expect, test } from 'bun:test'

import { createMemoryAccessState, LOCK_MS, MAX_FAILURES, TOUCH_EVERY_MS, WINDOW_MS } from '../access-state.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const after = (ms: number) => new Date(NOW.getTime() + ms)

describe('wrong passwords', () => {
  test('are counted, and the fifth locks the publication for 15 minutes', async () => {
    // Arrange
    const state = createMemoryAccessState()

    // Act
    const failures = []
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      failures.push(await state.registerFailure('slug-1', NOW))
    }

    // Assert
    expect(failures.map((failure) => failure.failures)).toEqual([1, 2, 3, 4, 5])
    expect(failures.slice(0, 4).every((failure) => failure.lockedUntil === undefined)).toBe(true)
    expect(failures[4]?.lockedUntil?.toISOString()).toBe(after(LOCK_MS).toISOString())
    expect((await state.lockedUntil('slug-1', NOW))?.toISOString()).toBe(after(LOCK_MS).toISOString())
  })

  test('stop being locked when the 15 minutes pass, and start counting again from one', async () => {
    // Arrange
    const state = createMemoryAccessState()
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      await state.registerFailure('slug-1', NOW)
    }

    // Act
    const stillLocked = await state.lockedUntil('slug-1', after(LOCK_MS - 1))
    const free = await state.lockedUntil('slug-1', after(LOCK_MS))
    const again = await state.registerFailure('slug-1', after(LOCK_MS + 1))

    // Assert
    expect(stillLocked).toBeDefined()
    expect(free).toBeUndefined()
    expect(again).toEqual({ failures: 1, lockedUntil: undefined })
  })

  test('older than the window no longer count', async () => {
    // Arrange
    const state = createMemoryAccessState()
    await state.registerFailure('slug-1', NOW)
    await state.registerFailure('slug-1', NOW)

    // Act
    const late = await state.registerFailure('slug-1', after(WINDOW_MS + 1))

    // Assert
    expect(late.failures).toBe(1)
  })

  test('are kept apart by publication, and cleared by the right password', async () => {
    // Arrange
    const state = createMemoryAccessState()
    await state.registerFailure('slug-1', NOW)
    await state.registerFailure('slug-1', NOW)
    await state.registerFailure('slug-2', NOW)

    // Act
    await state.clear('slug-1')
    const one = await state.registerFailure('slug-1', NOW)
    const two = await state.registerFailure('slug-2', NOW)

    // Assert
    expect(one.failures).toBe(1)
    expect(two.failures).toBe(2)
  })
})

describe('last access', () => {
  test('is written at most once an hour, so a page opened a thousand times costs 24 writes a day', async () => {
    // Arrange
    const state = createMemoryAccessState()

    // Act
    await state.touch('slug-1', NOW)
    await state.touch('slug-1', after(TOUCH_EVERY_MS - 1))
    const within = await state.lastAccess('slug-1')
    await state.touch('slug-1', after(TOUCH_EVERY_MS))
    const next = await state.lastAccess('slug-1')

    // Assert
    expect(within?.toISOString()).toBe(NOW.toISOString())
    expect(next?.toISOString()).toBe(after(TOUCH_EVERY_MS).toISOString())
  })

  test('is unknown until the first access, and forget removes the lock and the access of a removed publication', async () => {
    // Arrange
    const state = createMemoryAccessState()
    expect(await state.lastAccess('slug-1')).toBeUndefined()
    await state.touch('slug-1', NOW)
    for (let n = 0; n < MAX_FAILURES; n += 1) {
      await state.registerFailure('slug-1', NOW)
    }

    // Act
    await state.forget('slug-1')

    // Assert
    expect(await state.lastAccess('slug-1')).toBeUndefined()
    expect(await state.lockedUntil('slug-1', NOW)).toBeUndefined()
  })
})
