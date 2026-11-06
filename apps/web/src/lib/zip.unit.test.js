import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'

import { readZipJson } from './zip.js'

const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}
const u16 = (n) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}

/** A zip with the given files, each stored (method 0) or deflated (method 8). Enough of the format to read back. */
const zip = (files) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, content, method } of files) {
    const raw = Buffer.from(content)
    const data = method === 8 ? deflateRawSync(raw) : raw
    const nameBytes = Buffer.from(name)
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(data.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data
    ])
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(data.length),
        u32(raw.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ])
    )
    locals.push(local)
    offset += local.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0)
  ])
  const all = Buffer.concat([...locals, central, end])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length)
}

describe('reading the json files of a zip', () => {
  test('reads stored and deflated files, and skips folders, other files and macOS leftovers', async () => {
    // Arrange
    const buffer = zip([
      { name: 'collection/Orders.json', content: '{"a":1}', method: 8 },
      { name: 'environment/Dev.json', content: '{"b":2}', method: 0 },
      { name: 'collection/', content: '', method: 0 },
      { name: 'readme.txt', content: 'hello', method: 0 },
      { name: '__MACOSX/collection/._Orders.json', content: 'junk', method: 0 }
    ])

    // Act
    const files = await readZipJson(buffer)

    // Assert
    expect(files).toEqual([
      { name: 'collection/Orders.json', text: '{"a":1}' },
      { name: 'environment/Dev.json', text: '{"b":2}' }
    ])
  })

  test('refuses what is not a zip', async () => {
    // Act & Assert
    await expect(readZipJson(new TextEncoder().encode('{"not":"a zip"}').buffer)).rejects.toThrow('Not a zip file')
  })
})
