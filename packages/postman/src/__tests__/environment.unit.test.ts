import { describe, expect, test } from 'bun:test'

import { InvalidRequestException } from '@postmano/core'

import { importPostman, importPostmanEnvironment } from '../index.js'

const environment = () => ({
  id: 'abc',
  name: 'Parceiro (homolog)',
  values: [
    { key: 'baseUrl', value: 'https://hom.example.com', type: 'default', enabled: true },
    { key: 'apiKey', value: 'k-123', type: 'secret', enabled: true },
    { key: 'timeout', value: 30, type: 'any', enabled: true },
    { key: 'old', value: 'x', type: 'default', enabled: false },
    { key: '', value: 'no key', enabled: true }
  ],
  _postman_variable_scope: 'environment'
})

describe('importing a Postman environment', () => {
  test('keeps the name and the enabled variables, marks the secret type and turns numbers into text', () => {
    // Act
    const result = importPostmanEnvironment(environment())

    // Assert
    expect(result.environment.name).toBe('Parceiro (homolog)')
    expect(result.environment.variables).toEqual([
      { key: 'baseUrl', value: 'https://hom.example.com', secret: false },
      { key: 'apiKey', value: 'k-123', secret: true },
      { key: 'timeout', value: '30', secret: false }
    ])
    expect(result.scope).toBe('environment')
  })

  test('says how many disabled variables were left out', () => {
    // Act
    const result = importPostmanEnvironment(environment())

    // Assert
    expect(result.warnings).toEqual([{ path: 'Parceiro (homolog)', message: '1 disabled variables were not imported' }])
  })

  test('reads globals as an environment named Globals, and says so', () => {
    // Act
    const result = importPostmanEnvironment({
      values: [{ key: 'region', value: 'br', enabled: true }],
      _postman_variable_scope: 'globals'
    })

    // Assert
    expect(result.scope).toBe('globals')
    expect(result.environment.name).toBe('Globals')
    expect(result.warnings[0]?.message).toContain('Globals are imported as an environment')
  })

  test('refuses what has no list of values', () => {
    // Act & Assert
    expect(() => importPostmanEnvironment({ name: 'x' })).toThrow(InvalidRequestException)
  })
})

describe('importing whatever Postman exported', () => {
  test('tells an environment from a collection by its shape', () => {
    // Arrange
    const collection = { info: { name: 'C' }, item: [] }

    // Act
    const env = importPostman(environment())
    const col = importPostman(collection)

    // Assert
    expect(env.kind).toBe('environment')
    expect(col.kind).toBe('collection')
  })
})
