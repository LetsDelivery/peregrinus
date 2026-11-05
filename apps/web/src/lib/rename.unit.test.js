import { describe, expect, test } from 'bun:test'

import { renameRequest } from './rename.js'

const request = (name) => ({ kind: 'request', name, method: 'GET', url: '' })
const collection = () => ({
  items: [request('Root'), { kind: 'folder', name: 'Orders', children: [request('Inside'), request('Other')] }]
})

describe('renameRequest', () => {
  test('renames a request at the root and one inside a folder, and nothing else', () => {
    // Arrange
    const input = collection()

    // Act
    const root = renameRequest(input, '0', 'Renamed root')
    const inside = renameRequest(input, '1.1', 'Renamed inside')

    // Assert
    expect([root, inside]).toEqual([true, true])
    expect(input.items[0].name).toBe('Renamed root')
    expect(input.items[1].children.map((child) => child.name)).toEqual(['Inside', 'Renamed inside'])
    expect(input.items[1].name).toBe('Orders')
  })

  test('says nothing changed when the name is the one it already had', () => {
    // Arrange
    const input = collection()

    // Act
    const changed = renameRequest(input, '0', 'Root')

    // Assert
    expect(changed).toBe(false)
  })

  test('refuses a folder and a key that leads nowhere, and leaves the collection as it was', () => {
    // Arrange
    const input = collection()
    const before = JSON.stringify(input)

    // Act
    const results = [renameRequest(input, '1', 'x'), renameRequest(input, '5', 'x'), renameRequest(input, '1.9', 'x')]

    // Assert
    expect(results).toEqual([false, false, false])
    expect(JSON.stringify(input)).toBe(before)
  })
})
