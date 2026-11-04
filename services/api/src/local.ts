import { readConfig } from './config.js'
import { corsHeaders } from './cors.js'
import { createHandler } from './routes.js'
import { createFileStore } from './store/file.js'

/**
 * The API on this machine, with no sign-in: `x-local-user: <email>` stands in for the Google login. It
 * listens on 127.0.0.1 only, and the proxy still refuses private destinations, as in the deployed stack.
 */
const config = readConfig(process.env)
const store = createFileStore(process.env.DATA_FILE ?? '.postmano/data.json')
const handle = createHandler({ identity: undefined, allowedDomains: config.allowedDomains, localUsers: true, store })
const PANEL_PORT = process.env.PANEL_PORT ?? '5280'
const PANEL_ORIGINS = [`http://localhost:${PANEL_PORT}`, `http://127.0.0.1:${PANEL_PORT}`]

const corsFor = (request: Request) => corsHeaders(request.headers.get('origin'), PANEL_ORIGINS)

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 8280),
  fetch: async (request) => {
    // A page on the web can point its own name at 127.0.0.1 and call this server as anyone; only our names pass.
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) {
      return new Response('Not found', { status: 404 })
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsFor(request) })
    }
    const response = await handle(request)
    for (const [name, value] of Object.entries(corsFor(request))) {
      response.headers.set(name, value)
    }
    return response
  }
})

console.error(JSON.stringify({ message: 'postmano api listening', url: String(server.url) }))
