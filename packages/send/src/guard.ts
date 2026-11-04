import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

import { BlockedDestinationException, InvalidRequestException } from '@postmano/core'

/** Resolves a host name to every address it points to. Tests hand over their own. */
export type Lookup = (hostname: string) => Promise<string[]>

export const systemLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((entry) => entry.address)

const blocked = new BlockList()
const V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]
const V6: [string, number][] = [
  ['::', 96],
  ['64:ff9b::', 96],
  ['2002::', 16],
  ['fec0::', 10],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
]
for (const [network, prefix] of V4) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of V6) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

const MAPPED_DOTTED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i

/** An IPv4 address written as IPv6 (`::ffff:127.0.0.1`) is the IPv4 address, so it follows IPv4's rules. */
const unmap = (address: string): string => {
  const dotted = MAPPED_DOTTED.exec(address)?.[1]
  if (dotted) {
    return dotted
  }
  const hex = MAPPED_HEX.exec(address)
  if (!hex) {
    return address
  }
  const high = Number.parseInt(hex[1] ?? '0', 16)
  const low = Number.parseInt(hex[2] ?? '0', 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

/** True for loopback, private, link-local (cloud metadata), carrier, multicast and reserved ranges. Not an IP: true. */
export const isBlockedAddress = (address: string): boolean => {
  const normalized = unmap(address.split('%')[0] ?? address)
  const family = isIP(normalized)
  return family === 0 ? true : blocked.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
}

const assertAllowedUrl = (url: URL): void => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidRequestException(`Scheme "${url.protocol}" is not allowed; use http or https`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new InvalidRequestException('Credentials in the URL are not allowed; use the Authorization tab')
  }
}

/**
 * Refuses a URL whose host is, or resolves to, an address a request must not reach from the server:
 * the server's own network, the VPC and the cloud metadata service. Every address of the host is
 * checked, so a name that also points to a private address is refused. Checked again on every redirect.
 */
export const assertPublicDestination = async (url: URL, lookup: Lookup): Promise<void> => {
  assertAllowedUrl(url)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) === 0 ? await lookup(host) : [host]
  const forbidden = addresses.find(isBlockedAddress)
  if (addresses.length === 0 || forbidden !== undefined) {
    throw new BlockedDestinationException(
      `"${url.hostname}" points to ${forbidden ?? 'no address'}, which a request may not reach from the server`
    )
  }
}
