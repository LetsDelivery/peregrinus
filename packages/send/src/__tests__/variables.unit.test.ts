import { describe, expect, test } from 'bun:test'

import { createResolver, type DynamicSource } from '../variables.js'

const dynamic: DynamicSource = {
  now: () => new Date('2026-10-29T12:00:00.000Z'),
  uuid: () => '00000000-0000-4000-8000-000000000000',
  random: () => 0.5
}

describe('createResolver', () => {
  test('uses the highest-precedence scope that defines the name', () => {
    // Arrange
    const resolver = createResolver([{ host: 'local' }, { host: 'env' }, { host: 'global' }])

    // Act
    const text = resolver.resolve('https://{{host}}/x')

    // Assert
    expect(text).toBe('https://local/x')
  })

  test('falls through to a lower scope when the higher ones do not define the name', () => {
    // Arrange
    const resolver = createResolver([{}, { token: 'abc' }])

    // Act
    const text = resolver.resolve('Bearer {{ token }}')

    // Assert
    expect(text).toBe('Bearer abc')
  })

  test('keeps an undefined variable as written and reports it once', () => {
    // Arrange
    const resolver = createResolver([{ a: '1' }])

    // Act
    const text = resolver.resolve('{{a}} {{missing}} {{missing}}')

    // Assert
    expect(text).toBe('1 {{missing}} {{missing}}')
    expect(resolver.unresolved()).toEqual(['missing'])
  })

  test('does not expand a value that itself holds a variable', () => {
    // Arrange
    const resolver = createResolver([{ a: '{{b}}', b: 'deep' }])

    // Act
    const text = resolver.resolve('{{a}}')

    // Assert
    expect(text).toBe('{{b}}')
  })

  test('does not read inherited object properties as variables', () => {
    // Arrange
    const resolver = createResolver([{}])

    // Act
    const text = resolver.resolve('{{constructor}}')

    // Assert
    expect(text).toBe('{{constructor}}')
  })

  test('fills the dynamic variables from the source', () => {
    // Arrange
    const resolver = createResolver([], dynamic)

    // Act
    const text = resolver.resolve('{{$guid}}|{{$timestamp}}|{{$isoTimestamp}}|{{$randomInt}}')

    // Assert
    expect(text).toBe('00000000-0000-4000-8000-000000000000|1793275200|2026-10-29T12:00:00.000Z|500')
  })
})
