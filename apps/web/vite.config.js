import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const source = (name) => fileURLToPath(new URL(`../../packages/${name}/src`, import.meta.url))

/** The panel shares code with the server: the request preparation, the documentation renderer and the model. */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@postmano/send/browser', replacement: `${source('send')}/browser.ts` },
      { find: '@postmano/postman', replacement: `${source('postman')}/index.ts` },
      { find: '@postmano/docs', replacement: `${source('docs')}/index.ts` },
      { find: '@postmano/core', replacement: `${source('core')}/index.ts` }
    ]
  },
  server: { host: '127.0.0.1', fs: { allow: ['../..'] } }
})
