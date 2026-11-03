import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createMemoryStore } from './memory.js'
import type { DocumentStore } from './types.js'

/**
 * The memory store, saved to one JSON file after every change, so the local server keeps its collections
 * between runs. Local use only: one process, no locking.
 */
export const createFileStore = (path: string): DocumentStore => {
  const memory = createMemoryStore()
  if (existsSync(path)) {
    memory.load(JSON.parse(readFileSync(path, 'utf8')) as [string, never][])
  }
  const write = async (): Promise<void> => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.tmp`
    await writeFile(temp, JSON.stringify(memory.dump()))
    await rename(temp, path)
  }
  // One write at a time, so two saves never share the temp file.
  let queue: Promise<void> = Promise.resolve()
  const persist = (): Promise<void> => {
    const next = queue.then(write)
    queue = next.catch(() => undefined)
    return next
  }
  return {
    list: memory.list,
    get: memory.get,
    put: async (scope, kind, input) => {
      const doc = await memory.put(scope, kind, input)
      await persist()
      return doc
    },
    remove: async (scope, kind, id) => {
      const removed = await memory.remove(scope, kind, id)
      await persist()
      return removed
    }
  }
}
