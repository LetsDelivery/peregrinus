import { describe, expect, test } from 'bun:test'

import { getPath, setPath } from './paths.js'
import { publicVariables, resolveSelection, scopes, state } from './store.js'

const collection = {
  name: 'C',
  auth: { type: 'bearer', token: 'collection' },
  variables: [
    { key: 'host', value: 'collection-host', secret: false },
    { key: 'key', value: 'collection-secret', secret: true }
  ],
  items: [
    {
      kind: 'folder',
      name: 'F',
      auth: { type: 'basic', username: 'u', password: 'p' },
      children: [
        {
          kind: 'request',
          name: 'R',
          method: 'GET',
          url: 'x',
          query: [],
          headers: [],
          body: { mode: 'none' },
          auth: { type: 'inherit' },
          examples: []
        }
      ]
    }
  ]
}

describe('resolveSelection', () => {
  test('finds the request and the auths above it, closest first', () => {
    // Act
    const { request, parents } = resolveSelection(collection, [0, 0])

    // Assert
    expect(request.name).toBe('R')
    expect(parents.map((auth) => auth.type)).toEqual(['basic', 'bearer'])
  })
})

describe('variables', () => {
  test('the environment wins over the collection, and the documentation never gets a secret', () => {
    // Arrange
    state.collection = collection
    state.environment = {
      variables: [
        { key: 'host', value: 'env-host', secret: false },
        { key: 'token', value: 'env-secret', secret: true }
      ]
    }

    // Act
    const resolved = scopes()
    const visible = publicVariables()

    // Assert
    expect(resolved.environment.host).toBe('env-host')
    expect(resolved.collection.host).toBe('collection-host')
    expect(visible).toEqual({ host: 'env-host' })
  })
})

describe('paths', () => {
  test('reads and writes a dotted path into arrays and objects', () => {
    // Arrange
    const target = { query: [{ key: 'a' }] }

    // Act
    setPath(target, 'query.0.key', 'b')

    // Assert
    expect(getPath(target, 'query.0.key')).toBe('b')
    expect(getPath(target, 'query.5.key')).toBeUndefined()
  })
})
