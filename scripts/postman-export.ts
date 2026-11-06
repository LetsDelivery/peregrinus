import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Downloads every collection and environment of a Postman account (or of one workspace) into a folder, to import them
 * into postmano in one go:
 *
 *     POSTMAN_API_KEY=<key> bun run postman:export [folder] [workspace-id]
 *
 * The key comes from Postman, Settings, API keys, and is read from the environment only: it is never written to disk
 * or printed. The files hold the variable values, secret ones included, so delete the folder after importing.
 * Globals are not in Postman's API: export them by hand (Environments, Globals, Export).
 */
const BASE = process.env.POSTMAN_API_URL ?? 'https://api.getpostman.com'

type Listed = { uid: string; name: string }

const get = async (key: string, path: string): Promise<Record<string, unknown>> => {
  const response = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': key } })
  if (response.status === 401) {
    throw new Error('Postman refused the key (401). Check POSTMAN_API_KEY.')
  }
  if (!response.ok) {
    throw new Error(`Postman answered ${response.status} for ${path.split('?')[0]}`)
  }
  return (await response.json()) as Record<string, unknown>
}

const safeName = (name: string): string => name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80)

const save = (folder: string, kind: string, listed: Listed, body: unknown): void => {
  const dir = join(folder, kind)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, `${safeName(listed.name)}-${listed.uid}.json`), JSON.stringify(body, null, 2), {
    mode: 0o600
  })
}

const download = async (key: string, folder: string, kind: 'collection' | 'environment', query: string) => {
  const list = ((await get(key, `/${kind}s${query}`))[`${kind}s`] ?? []) as Listed[]
  for (const listed of list) {
    save(folder, kind, listed, (await get(key, `/${kind}s/${listed.uid}`))[kind])
  }
  return list.length
}

const main = async (): Promise<void> => {
  const key = process.env.POSTMAN_API_KEY
  if (!key) {
    throw new Error('Set POSTMAN_API_KEY first (Postman, Settings, API keys).')
  }
  const folder = process.argv[2] ?? 'postman-export'
  const workspace = process.argv[3]
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
  const collections = await download(key, folder, 'collection', query)
  const environments = await download(key, folder, 'environment', query)
  process.stdout.write(`${collections} collections and ${environments} environments saved in ${folder}/\n`)
}

main().catch((error: Error) => {
  process.stderr.write(`\n  postman-export: ${error.message}\n\n`)
  process.exit(1)
})
