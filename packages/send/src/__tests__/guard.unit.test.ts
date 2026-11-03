import { describe, expect, test } from 'bun:test'

import { BlockedDestinationException, InvalidRequestException } from '@peregrinus/core'

import { assertPublicDestination, isBlockedAddress } from '../guard.js'

const publicLookup = async () => ['93.184.216.34']

describe('isBlockedAddress', () => {
  test.each([
    ['loopback', '127.0.0.1'],
    ['private 10/8', '10.1.2.3'],
    ['private 172.16/12', '172.31.255.255'],
    ['private 192.168/16', '192.168.0.10'],
    ['cloud metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['unspecified', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique local', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1%en0'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata in hex', '::ffff:a9fe:a9fe'],
    ['NAT64 metadata', '64:ff9b::a9fe:a9fe'],
    ['IPv4-compatible loopback', '::7f00:1'],
    ['6to4', '2002:a9fe:a9fe::1'],
    ['site-local', 'fec0::1'],
    ['not an address', 'example.com']
  ])('blocks %s (%s)', (_label, address) => {
    // Arrange & Act
    const result = isBlockedAddress(address)

    // Assert
    expect(result).toBe(true)
  })

  test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('allows public %s', (address) => {
    // Arrange & Act
    const result = isBlockedAddress(address)

    // Assert
    expect(result).toBe(false)
  })
})

describe('assertPublicDestination', () => {
  test('accepts a host that resolves only to public addresses', async () => {
    // Arrange
    const url = new URL('https://api.example.com/orders')

    // Act & Assert
    await expect(assertPublicDestination(url, publicLookup)).resolves.toBeUndefined()
  })

  test('refuses a host that resolves to a private address', async () => {
    // Arrange
    const url = new URL('https://internal.example.com/')

    // Act & Assert
    await expect(assertPublicDestination(url, async () => ['10.0.0.8'])).rejects.toThrow(BlockedDestinationException)
  })

  test('refuses a host with one public and one private address', async () => {
    // Arrange
    const url = new URL('https://mixed.example.com/')

    // Act & Assert
    await expect(assertPublicDestination(url, async () => ['93.184.216.34', '127.0.0.1'])).rejects.toThrow(
      /127\.0\.0\.1/
    )
  })

  test('refuses an IP literal without asking the resolver', async () => {
    // Arrange
    let asked = false
    const url = new URL('http://169.254.169.254/latest/meta-data')

    // Act & Assert
    await expect(
      assertPublicDestination(url, async () => {
        asked = true
        return []
      })
    ).rejects.toThrow(BlockedDestinationException)
    expect(asked).toBe(false)
  })

  test('refuses a decimal IP that the URL parser turns into loopback', async () => {
    // Arrange
    const url = new URL('http://2130706433/')

    // Act & Assert
    await expect(assertPublicDestination(url, publicLookup)).rejects.toThrow(BlockedDestinationException)
  })

  test('refuses a host that resolves to nothing', async () => {
    // Arrange
    const url = new URL('https://nowhere.example.com/')

    // Act & Assert
    await expect(assertPublicDestination(url, async () => [])).rejects.toThrow(/no address/)
  })

  test('refuses other schemes and credentials in the url', async () => {
    // Arrange
    const file = new URL('file:///etc/passwd')
    const withCredentials = new URL('https://user:secret@api.example.com/')

    // Act & Assert
    await expect(assertPublicDestination(file, publicLookup)).rejects.toThrow(InvalidRequestException)
    await expect(assertPublicDestination(withCredentials, publicLookup)).rejects.toThrow(/Credentials/)
  })
})
