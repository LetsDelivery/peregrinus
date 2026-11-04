# AGENTS.md: postmano

Rules for anyone, person or coding agent, changing this repository. They follow `LetsDelivery/JiraIA`;
where it has a rule and this file is silent, its rule applies.

## Read first

1. `docs/produto/escopo-mvp.md`: what is in, later and out.
2. `docs/produto/levantamento-postman.md`: what was learned about Postman and what changed in the design.
3. `docs/adr/`: every decision that would surprise a reader of the code.

## Clean room

Never open, decompile or analyze the code, bundle or traffic of Postman or of any other product. The
spec is built from public documentation and from using the product as a licensed user. Dependencies must
be permissive.

## Language

English everywhere: code, comments, commits, ADRs, logs, error messages. Only text a person reads on screen
is pt-BR, and the panel picks it from the error `code`, never from the API's `message`.

## Code

- Relative imports carry a `.js` extension. `bunx tsc --noEmit` must pass.
- No `enum`, no `any`, no `.d.ts`. A zod schema is the type.
- Functions of 4 to 20 lines, files under 500, at most two levels of indentation, cognitive complexity 8.
- Errors name the offending value (`Scheme "file:" is not allowed`), via `@postmano/core` exceptions.
- Everything is UTC. Never call local-time `Date` methods.
- Log with `console.error` and a JSON line, never `console.log`. Never log an `Authorization` header or a body.
- Every text the panel shows goes through `t('texto em português')` (`lib/i18n.js`) and has an English entry in
  `lib/en.js`; the Portuguese text is the key. `i18n.unit.test.js` fails when one is missing. A text built from
  user data (a collection name) is never passed through `t()`. The documentation page takes a `locale` too.
- Panel (`apps/web`): plain JavaScript, no framework. Markup only through the `html` template, which escapes.
  Mobile first: check a new screen at 390px; no screen scrolls the page sideways.

## The proxy is a security boundary

`@postmano/send` calls other servers on behalf of a person, from inside AWS. Every change to it needs a
test that shows the destination guard still holds: loopback, private ranges, `169.254.169.254`, IPv4 written
as IPv6, a name that resolves to a private address, and a redirect to any of them.

## Tests

- `*.unit.test.ts`, run with `bun test`. Tests never leave localhost: the proxy takes its `fetch` and its
  resolver as arguments, and tests hand over fakes.
- Every new function gets a test; every bug fix gets a regression test.
- Anything that renders text from a collection must escape it, and must never print a secret value or an auth
  token: the documentation tests check both.
- **A green suite is not a working feature.** Run `bun run api` and the panel, call the route and read the
  body, and open the screen in a browser before calling it done.

## Commits and branches

- Conventional commits with a required module scope (`commitlint.config.cjs`): `feat(send): ...`.
- `master` takes changes by pull request only.

## Commands

| Command | What it does |
|---|---|
| `bun run up` | Everything, in one command: installs what is missing, then the API on :8280 and the panel on :5280. Ctrl+C stops both |
| `bun run api` | Only the API on 127.0.0.1:8280; authenticate with `x-local-user: <email>` |
| `bun run --cwd apps/web dev` | The panel on 127.0.0.1:5280 |
| `bun run test:ci` | Biome, `tsc` and every test |
| `bun run build` | `dist/lambda.zip` (upload it to the code bucket) and the panel in `apps/web/dist` |
