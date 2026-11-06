# ADR 0003: Customers open published documentation with a generated password, for a limited time

Status: accepted, 2026-11-05. Extends [ADR 0002](0002-published-documentation.md).

## Context

ADR 0002 gives a publication four rules: team, named people, the company, or anyone with the link. Partners and
customers have no company account. Sending them a link that anyone can open is too open, and they must not see the
whole collection, only the APIs that concern them (for example two APIs of one carrier).

## Decision

A fifth visibility, `password` ("Cliente, com senha"), and three rules that apply to every publication.

**Password**

- Only a workspace **admin** creates, changes or removes a page with a password. Editors see it, read-only.
- The server generates the password (16 characters, no look-alike characters) and shows it **once**. Nobody picks it,
  so nobody reuses one.
- Only a scrypt hash is stored, with its own salt. A password cannot be read back. A lost one is replaced.
- A right password gives a token: `v1.<expiry>.<hmac>`, signed with the stored hash, valid 8 hours. It is kept in
  `sessionStorage` and sent as `x-docs-token`. Changing the password changes the hash, so every open token stops.
- An unknown address answers 404, as before. A page with a password answers 401 until the password is right. That
  shows the page exists, and nothing else: the address is a random 128-bit slug.

**Selection**

- A publication holds a **selection**: the ids of the requests it shows. `null` means the whole collection and follows
  it. A list shows only those requests, with the folders above them. Selecting a folder in the panel selects the
  requests it has at that moment. What is added later does not join by itself, and the panel says how many are new.
- Every folder and request has a fixed id, given at the first save. A selection by position or name would show the
  wrong request after a move or a rename.
- With a selection, the page also leaves out the collection description and every variable the shown requests do not use.
- A deleted request leaves the page. A page with nothing left answers 404.
- A publication from ADR 0002 that points at a folder path fails closed until an admin selects again.

**Expiry**

- Every publication has an expiry: 7, 30 or 90 days, a date, or none. The default is 30 days.
- A date means the end of that day in UTC. The server clock decides. An expired page answers 410 with
  "Este acesso expirou. Peça um novo ao time."
- The panel warns 7 days before. Renewing a page with a password also changes the password.

**Lockout**

- 5 wrong passwords lock the page for 15 minutes. A right password is refused while it is locked. The 3rd wrong one
  warns the person. A right password resets the counter. An admin unlocks by changing the password.
- The counter lives in `ACCESS#<slug>`, a separate item that is not versioned, with a `ttl` so it cleans itself.
  Counting uses an atomic `ADD`, so parallel guesses cannot skip the limit.

**Last access**

- Each publication keeps its last access, written at most once an hour in a separate item. The panel shows it.

## Consequences

- The credential scan of ADR 0002 runs on the selection only, so a secret in a request nobody selected does not
  block the page.
- The table has a TTL attribute `ttl`, and the Lambda role may `UpdateItem`. This is a change to `template.yml`: it
  needs the manual CloudFormation test.
- A page with a password is public on the Internet behind a shared secret. The password does not tell who opened it.
  The panel warns the admin to check that nothing confidential is on the page.
- One password per publication. Two customers with different access need two publications.
- The credential scan also reads the values of the environment the page uses. A "yes" from the author counts only for
  what was found at that save, so a credential added later still closes the page.
- The selection is what the admin approved, not a fence against editors. An editor can change the content of a
  selected request, and can move an id onto another request when saving the collection. Editors are trusted with the
  content of the collection.
- Anyone who has the address can lock the page for new sign-ins with 5 wrong passwords. A session that is already
  open keeps working, and an admin unlocks by changing the password.
- The token is signed with the stored hash. Whoever can read the table can sign a token for any page. A server secret
  (a pepper kept outside the table) would close this and is a follow-up.
