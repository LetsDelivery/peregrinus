# postmano

A web client for HTTP requests for the Lets team: the basics of Postman plus generated API documentation,
signed in with the company's Google account. The name is what the team already says: jira became JiraIA, and postman became postmano.

Status: working locally, not deployed yet. One environment only (an internal tool). What exists: importing from Postman (collections, environments, globals, several files at once, or the workspace `.zip`); a request builder with
environments and variables; a server-side proxy that refuses internal destinations (and a browser mode for
`localhost`); collections and environments saved in DynamoDB; generated documentation with examples and code
snippets; documentation published at an address (like a Swagger page) with its own rule for who may open it; sign-in with the company's Google account; workspaces (personal and team) with admin, editor and viewer roles; a panel in Portuguese (default) and English, automatic or chosen in the settings.

## Run it

```bash
bun run up                       # everything: installs what is missing, the API on :8280 and the panel on :5280 (Ctrl+C stops both)

# or each part on its own:
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
| `packages/postman` | Postman importer: collections (v2.0, v2.1), environments and globals |
| `packages/send` | Variables, request preparation, the destination guard and the pinned proxy `fetch` |
| `packages/docs` | Documentation renderer: safe Markdown, code snippets, the page and the standalone HTML |
| `services/api` | The HTTP API: routes, Google sign-in through Cognito, the document stores (memory, file, DynamoDB), local server and Lambda adapter |
| `template.yml` | The stack: DynamoDB, Lambda, HTTP API, S3 + CloudFront, Cognito |
| `apps/web` | The panel, plain JavaScript |
| `docs/` | Product spec (pt-BR), ADRs and the [deploy guide](docs/deploy.md) |

Rules for contributors are in `AGENTS.md`.
