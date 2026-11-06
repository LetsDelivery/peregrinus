# ADR 0002: Published documentation is a view of a collection, checked on every open

Status: accepted, 2026-11-03.

Extended by [ADR 0003](0003-customer-access-to-published-documentation.md): a fifth visibility `password`, a selection
of requests in place of one folder, an expiry on every page, and a lockout. The folder rule below no longer applies.

## Context

People want to open the documentation of a collection at an address, as they do with a Swagger page, without
being given access to the collection itself. Some pages are for the team, some for the whole company, and some
for partners who have no company account.

## Decision

A **publication** points at a collection (or one folder of it) and carries a visibility: `workspace`, `people`
(a list of company addresses), `company` (any signed-in company account) or `link` (anyone with the address, no
sign-in). The address holds a random 128-bit slug. A pointer item outside any workspace turns the slug back into
the workspace, because the address names none.

- **The rule is checked on every open**, with the live members of the workspace. A leaked link of a restricted page
  opens nothing. Only `link` is open by design, and the author is told so.
- **The page is a view, not a copy.** It follows the collection. Before the view leaves the server, every secret is
  taken out: the values of auths, secret variables, anything named like a credential (headers, query, form fields,
  JSON keys, the user and password of an address) and cookies in saved responses. Names are matched by substring,
  because a list of names always misses one.
- **Free text is scanned, not rewritten.** A public link over text that looks like a credential (descriptions,
  non-JSON bodies) is refused unless the author confirms. The scan runs again on every open, so a credential added
  later takes the page down until it is removed or confirmed.
- **A moved folder takes the page down.** The folder is kept as a path of indexes and the names along it; if the names
  no longer match, the page answers 404 instead of showing whatever now sits at that path.
- **Removing is checked against the workspace.** A person can only take down an address that belongs to a workspace
  they edit. Deleting a collection or a workspace takes its pages and addresses down.

## Consequences

- A viewer of a workspace reads collections with secret values emptied, as it already did for environments.
- Opening a page costs a few reads (pointer, publication, workspace, collection). Pages are small and rarely hot.
- Listing workspaces reads every workspace; fine for a company-sized table, and the first thing to index if it grows.
