import { existsSync } from 'node:fs'
import { connect } from 'node:net'

import { spawn } from 'bun'

/**
 * Everything the project needs, from nothing, in one command:
 *
 *     bun run up
 *
 * dependencies (when missing) → the API on :8280 → the panel on :5280.
 * Nothing else has to be running: the data lives in `.postmano/data.json` and sign-in is replaced
 * by `x-local-user` on this machine. Ctrl+C stops both.
 */
const API_PORT = 8280
const PANEL_PORT = 5280
const READY_TIMEOUT_MS = 30_000

const fail = (message: string): never => {
  process.stderr.write(`\n  up: ${message}\n\n`)
  process.exit(1)
}

const isListening = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

const waitFor = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isListening(port)) {
      return true
    }
    await Bun.sleep(250)
  }
  return false
}

const installIfMissing = async (): Promise<void> => {
  if (existsSync('node_modules')) {
    return
  }
  const install = spawn(['bun', 'install', '--frozen-lockfile'], { stdout: 'inherit', stderr: 'inherit' })
  if ((await install.exited) !== 0) {
    fail('bun install failed')
  }
}

const refuseBusyPorts = async (): Promise<void> => {
  for (const port of [API_PORT, PANEL_PORT]) {
    if (await isListening(port)) {
      fail(`port ${port} is already in use (is another postmano running? stop it first)`)
    }
  }
}

await installIfMissing()
await refuseBusyPorts()

const api = spawn(['bun', 'run', 'api'], { stdout: 'inherit', stderr: 'inherit' })
const panel = spawn(['bun', 'run', '--cwd', 'apps/web', 'dev'], { stdout: 'inherit', stderr: 'inherit' })

const stop = (code: number): never => {
  api.kill()
  panel.kill()
  process.exit(code)
}

process.on('SIGINT', () => stop(130))
process.on('SIGTERM', () => stop(143))
process.on('uncaughtException', (error) => {
  process.stderr.write(`\n  up: ${error.message}\n`)
  stop(1)
})

// A child that dies while starting must be named at once, not after the timeout.
const diedFirst = Promise.race([api.exited.then(() => 'the API'), panel.exited.then(() => 'the panel')])
const bothListening = Promise.all([waitFor(API_PORT), waitFor(PANEL_PORT)]).then((ready) => ready.every(Boolean))
const outcome = await Promise.race([bothListening, diedFirst])
if (outcome !== true) {
  const why = outcome === false ? 'did not start in time' : `${outcome} exited before it was ready`
  process.stderr.write(`\n  up: ${why}\n`)
  stop(1)
}

process.stdout.write(`\n  postmano is up: open http://localhost:${PANEL_PORT}\n`)
process.stdout.write(`  API on http://127.0.0.1:${API_PORT}  ·  Ctrl+C stops both\n\n`)

await Promise.race([api.exited, panel.exited])
stop(1)
