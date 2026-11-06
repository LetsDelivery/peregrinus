/**
 * Reads the `.json` files out of a `.zip`, in the browser, for the export Postman makes of a whole workspace. It reads
 * the central directory, stored and deflated entries only, and stops at limits so a hostile archive cannot fill memory.
 */

const MAX_ENTRIES = 1000
const MAX_TOTAL_BYTES = 100 * 1024 * 1024

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

const findEnd = (view) => {
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 22 - 65_535); at -= 1) {
    if (view.getUint32(at, true) === EOCD) {
      return at
    }
  }
  throw new Error('Not a zip file')
}

const inflate = async (bytes) =>
  new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
  )

const isWanted = (name) => name.toLowerCase().endsWith('.json') && !name.startsWith('__MACOSX/') && !name.endsWith('/')

const entryAt = (view, bytes, at) => {
  if (view.getUint32(at, true) !== CENTRAL) {
    throw new Error('Broken zip file')
  }
  const nameLength = view.getUint16(at + 28, true)
  const extraLength = view.getUint16(at + 30, true)
  const commentLength = view.getUint16(at + 32, true)
  const entry = {
    method: view.getUint16(at + 10, true),
    size: view.getUint32(at + 20, true),
    outSize: view.getUint32(at + 24, true),
    local: view.getUint32(at + 42, true),
    name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
  }
  return { entry, next: at + 46 + nameLength + extraLength + commentLength }
}

const readEntry = async (view, bytes, entry) => {
  if (view.getUint32(entry.local, true) !== LOCAL) {
    throw new Error('Broken zip file')
  }
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true)
  const data = bytes.subarray(start, start + entry.size)
  if (entry.method === 0) {
    return data
  }
  if (entry.method === 8) {
    return await inflate(data)
  }
  throw new Error(`Unsupported zip compression in ${entry.name}`)
}

/** `[{ name, text }]` for every `.json` file in the archive. */
export const readZipJson = async (buffer) => {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const end = findEnd(view)
  const count = view.getUint16(end + 10, true)
  if (count > MAX_ENTRIES) {
    throw new Error('The zip file has too many files')
  }
  let at = view.getUint32(end + 16, true)
  let total = 0
  const files = []
  for (let n = 0; n < count; n += 1) {
    const { entry, next } = entryAt(view, bytes, at)
    at = next
    if (!isWanted(entry.name)) {
      continue
    }
    total += entry.outSize
    if (total > MAX_TOTAL_BYTES) {
      throw new Error('The zip file is too large')
    }
    files.push({ name: entry.name, text: new TextDecoder().decode(await readEntry(view, bytes, entry)) })
  }
  return files
}
