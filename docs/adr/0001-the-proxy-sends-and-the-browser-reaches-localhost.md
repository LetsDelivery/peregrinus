# ADR 0001: The proxy sends the request; the browser reaches localhost

Status: accepted, 2026-10-29.

## Context

postmano is a web client for HTTP requests. A page in a browser cannot call most APIs: they do not send
CORS headers for it, a page cannot set some headers, and it cannot keep cookies or use client certificates.
A server can. But a server inside AWS that calls any URL a person types is a way into the VPC and to the cloud
metadata service (`169.254.169.254`), and from the server `localhost` is the server itself.

## Decision

**Two ways to send, chosen per request.**

- **Through the server (default).** The API calls the destination. Before every hop, redirects included, the
  guard resolves the host and refuses it when any address is loopback, private, link-local, carrier, multicast
  or reserved (IPv4-mapped IPv6 is read as IPv4). Only `http` and `https`, no credentials in the URL, a timeout
  of 25 s, at most 5 redirects, a response of at most 3 MiB (the function answers in a JSON of at most 6 MB, with the body in base64). When a
  redirect leaves the origin, only neutral headers follow (`Accept`, `Content-Type`, `User-Agent` and the like);
  `Authorization`, `Cookie`, API keys and any other custom header are dropped.
- **From the browser.** For `localhost` and the person's own network. The panel builds the request with the same
  code the server uses (`@postmano/send/browser`) and calls from the page, so the destination has to allow CORS
  and the browser decides which headers it sends. Redirects are the browser's.

**Access** is the company's Google Workspace account, through the stack's Cognito user pool, as in the company's other internal tools. The API checks a verified address of an allowed domain and a matching `hd` claim, so a person
who leaves the company loses the access with the Workspace account. Locally there is no pool and `x-local-user`
stands in, on 127.0.0.1 only.

**Storage is DynamoDB**, as in the other Lets backends, not Aurora (PostgreSQL), which another internal tool uses for filters on any
field and full-text search; this tool has neither need.

## Consequences

- The proxy is a security boundary with its own tests (`AGENTS.md`).
- **DNS rebinding is closed.** The connection does not use `fetch`'s own resolver: `createPinnedFetcher` connects
  through a `lookup` that checks every address of the name and connects to the one it checked, so the check and
  the connection cannot disagree. `sendRequest` still checks each URL first, for a clear error.
- **Ignoring a bad certificate** is an explicit per-request option (`insecureTls`), only through the server, with a
  visible warning in the panel. Partner staging environments sometimes need it.
- Collections do not fit a DynamoDB item (400 KB), so each save is gzipped, cut in chunks, written under a new
  version, and switched on by one conditional write of the control item. Readers see the old save or the new
  one, never half; a stale save is a 409.
- **Workspaces own the data.** Every collection and environment lives in one workspace, and the role of the
  caller in it (admin, editor, viewer) is checked on every route. A viewer reads an environment without its
  secret values. The workspace list of a person is built by reading the workspaces and keeping the ones they
  belong to, which is fine for hundreds of workspaces; a membership index replaces it if that stops being true.
- Cookies and client certificates are out of the first version.
- The stack (`template.yml`) is linted with `cfn-lint` but has not been deployed. Per the team's rule for
  templates, upload it and run the whole changeset in dev before the first pull request that touches it.
