import { randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

import { ConflictException } from '@postmano/core'

import { nextVersion } from './memory.js'
import type { Item, Key, TableClient } from './table.js'
import type { Doc, DocSummary, DocumentStore, Kind, Scope } from './types.js'

/** A DynamoDB item holds 400 KB; a chunk stays well under it, as the item also carries its keys. */
export const DEFAULT_CHUNK_BYTES = 300_000

const metaKey = (scope: Scope, kind: Kind, id: string): Key => ({ pk: `DOC#${scope}#${kind}#${id}`, sk: 'META' })
const indexKey = (scope: Scope, kind: Kind, id: string): Key => ({ pk: `INDEX#${scope}#${kind}`, sk: id })
/** Every write has its own chunk prefix, so a save that loses the race can only ever delete its own chunks. */
const prefixOf = (version: number, writeId: string): string => `V#${String(version).padStart(8, '0')}#${writeId}#C#`
const prefixOfMeta = (meta: Item): string => prefixOf(Number(meta.version), String(meta.writeId))

const summaryOf = (item: Item): DocSummary => ({
  id: String(item.id),
  name: String(item.name),
  version: Number(item.version),
  updatedAt: String(item.updatedAt),
  updatedBy: String(item.updatedBy)
})

const split = (bytes: Buffer, size: number): Buffer[] => {
  const parts: Buffer[] = []
  for (let at = 0; at < bytes.length; at += size) {
    parts.push(bytes.subarray(at, at + size))
  }
  return parts.length === 0 ? [Buffer.alloc(0)] : parts
}

/**
 * Documents in one DynamoDB table, in a way that fits any size and never shows half a save:
 *
 * - The body is JSON, gzipped, cut in chunks, and written under a new version and a random write id
 *   (`V#<n>#<write id>#C#<i>`) first.
 * - Then one transaction writes the control item (`META`, which names the version, the write id and the chunk
 *   count) and the list entry (`INDEX#<kind>`). The control item is conditional: its current version must be the
 *   one the caller read, or it is a conflict. Readers follow `META`, so they see the old save or the new one.
 * - The previous save's chunks are deleted after, on a best-effort basis: a failure there leaves unreferenced
 *   chunks, never a failed save.
 */
export const createDynamoStore = (table: TableClient, chunkBytes = DEFAULT_CHUNK_BYTES): DocumentStore => {
  const chunkKeys = async (scope: Scope, kind: Kind, id: string, meta: Item): Promise<Key[]> =>
    (await table.query(metaKey(scope, kind, id).pk, prefixOfMeta(meta))).map((item) => ({
      pk: String(item.pk),
      sk: String(item.sk)
    }))

  const read = async (scope: Scope, kind: Kind, id: string, meta: Item): Promise<unknown> => {
    const chunks = await table.query(metaKey(scope, kind, id).pk, prefixOfMeta(meta))
    if (chunks.length !== Number(meta.chunks)) {
      throw new Error(`The ${kind} "${id}" has ${chunks.length} of ${String(meta.chunks)} chunks`)
    }
    return JSON.parse(
      gunzipSync(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data as Uint8Array)))).toString('utf8')
    )
  }

  /** The save already happened, so a failed cleanup must not turn it into an error. */
  const dropQuietly = async (clean: () => Promise<void>): Promise<void> => {
    try {
      await clean()
    } catch (error) {
      console.error(JSON.stringify({ message: 'Leftover chunks were not deleted', error: String(error) }))
    }
  }

  return {
    list: async (scope, kind) =>
      (await table.query(`INDEX#${scope}#${kind}`, '')).map(summaryOf).sort((a, b) => a.name.localeCompare(b.name)),

    get: async (scope, kind, id) => {
      const meta = await table.get(metaKey(scope, kind, id).pk, 'META')
      return meta ? ({ ...summaryOf(meta), value: await read(scope, kind, id, meta) } satisfies Doc) : undefined
    },

    put: async (scope, kind, input) => {
      const { pk } = metaKey(scope, kind, input.id)
      const current = await table.get(pk, 'META')
      const version = nextVersion(kind, input, current ? Number(current.version) : undefined)
      const parts = split(gzipSync(JSON.stringify(input.value)), chunkBytes)
      const writeId = randomUUID().replaceAll('-', '')
      const chunks = parts.map((data, at) => ({
        pk,
        sk: `${prefixOf(version, writeId)}${String(at).padStart(4, '0')}`,
        data
      }))
      await table.putMany(chunks)
      const summary = {
        id: input.id,
        name: input.name,
        version,
        updatedAt: input.now.toISOString(),
        updatedBy: input.by
      }
      const done = await table.transact([
        {
          item: { ...metaKey(scope, kind, input.id), kind, scope, ...summary, writeId, chunks: parts.length },
          condition: current ? { versionEquals: Number(current.version) } : { absent: true }
        },
        { item: { ...indexKey(scope, kind, input.id), ...summary } }
      ])
      if (!done) {
        await table.deleteMany(chunks.map(({ pk: p, sk }) => ({ pk: p, sk })))
        throw new ConflictException(`The ${kind} "${input.id}" was saved by someone else while this save was written`)
      }
      if (current) {
        await dropQuietly(() => chunkKeys(scope, kind, input.id, current).then((keys) => table.deleteMany(keys)))
      }
      return { ...summary, value: structuredClone(input.value) }
    },

    remove: async (scope, kind, id) => {
      const meta = await table.get(metaKey(scope, kind, id).pk, 'META')
      if (!meta) {
        return false
      }
      // The control item goes last: if this stops half way, the document is still there and the remove can be retried.
      await table.deleteMany([indexKey(scope, kind, id), ...(await chunkKeys(scope, kind, id, meta))])
      await table.deleteMany([metaKey(scope, kind, id)])
      return true
    }
  }
}
