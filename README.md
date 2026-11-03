# peregrinus

A web client for HTTP requests for the Lets team: the basics of Postman plus generated API documentation,
signed in with the company's Google account. Named after *Falco peregrinus*, the peregrine falcon.

Status: working in dev, not deployed. What exists: importing a Postman Collection v2.1; a request builder with
environments and variables; a server-side proxy that refuses internal destinations (and a browser mode for
`localhost`); collections and environments saved in DynamoDB; generated documentation with examples and code
snippets; documentation published at an address (like a Swagger page) with its own rule for who may open it; sign-in with the company's Google account; workspaces (personal and team) with admin, editor and viewer roles; a panel in Portuguese (default) and English, automatic or chosen in the settings.

## Run it

```bash
bun install
bun run api                      # API on 127.0.0.1:8280, `x-local-user: you@uselets.com` stands in for the login
bun run --cwd apps/web dev       # panel on 127.0.0.1:5280
bun run test:ci                  # Biome, tsc and every test
bun run build                    # dist/lambda.zip and the panel build, for the pipeline
```

Needs bun >= 1.4.3 and Node >= 24.18.

## Layout

| Path | What |
|---|---|
| `packages/core` | The domain model (zod) and the exceptions |
| `packages/postman` | Postman Collection v2.1 importer |
| `packages/send` | Variables, request preparation, the destination guard and the pinned proxy `fetch` |
| `packages/docs` | Documentation renderer: safe Markdown, code snippets, the page and the standalone HTML |
| `services/api` | The HTTP API: routes, Google sign-in through Cognito, the document stores (memory, file, DynamoDB), local server and Lambda adapter |
| `template.yml` | The stack: DynamoDB, Lambda, HTTP API, S3 + CloudFront, Cognito |
| `apps/web` | The panel, plain JavaScript |
| `docs/` | Product spec (pt-BR), ADRs and the [deploy guide](docs/deploy.md) |

Rules for contributors are in `AGENTS.md`.
