import { describe, expect, test } from 'bun:test'

import { corsHeaders } from '../cors.js'

const PANEL = ['http://localhost:5280', 'http://127.0.0.1:5280']

describe('corsHeaders', () => {
  test('announces every method the API has routes for, so save and delete are not blocked', () => {
    // Arrange & Act
    const headers = corsHeaders('http://127.0.0.1:5280', PANEL)

    // Assert
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(headers['access-control-allow-methods']).toContain(method)
    }
  })

  test('answers the panel origins, both spellings of localhost, and nobody else', () => {
    // Act & Assert
    expect(corsHeaders('http://localhost:5280', PANEL)['access-control-allow-origin']).toBe('http://localhost:5280')
    expect(corsHeaders('http://127.0.0.1:5280', PANEL)['access-control-allow-origin']).toBe('http://127.0.0.1:5280')
    expect(corsHeaders('https://evil.example', PANEL)['access-control-allow-origin']).toBeUndefined()
    expect(corsHeaders(null, PANEL)['access-control-allow-origin']).toBeUndefined()
  })

  test('lets the panel send the sign-in header and a JSON body', () => {
    // Act
    const headers = corsHeaders('http://127.0.0.1:5280', PANEL)

    // Assert
    expect(headers['access-control-allow-headers']).toContain('authorization')
    expect(headers['access-control-allow-headers']).toContain('content-type')
  })
})
