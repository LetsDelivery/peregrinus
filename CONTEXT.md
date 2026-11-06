# postmano

LET'S internal web client for HTTP requests, with documentation generated from the requests and
published at an address. It does the basics of Postman and nothing more. One deployment, no
separate production. Product scope: `docs/produto/escopo-mvp.md`.

## Language

**Workspace**:
The unit that owns collections, environments and publications, and the people who may use them.
Screen word: "Workspace".
_Avoid_: project, team, space

**Personal workspace**:
The one every person gets on first sign-in. Private: one member, never shared, never deleted.
Screen word: "Meu workspace".
_Avoid_: home, default workspace

**Role**:
What a member may do in a workspace: admin (manages members and deletes it), editor (changes
collections, environments and publications) or viewer (reads, with credentials hidden: secret values, tokens and
passwords).
_Avoid_: permission, level, access

**Collection**:
A tree of folders and requests, saved whole with a version. Screen word: "Coleção".
_Avoid_: project, API, suite

**Request**:
One HTTP call: method, address, parameters, headers, body and authorization. Screen word: "Requisição".
_Avoid_: call, endpoint

**Example**:
A saved response of a request. It feeds the generated documentation.
_Avoid_: sample, mock

**Environment**:
A named set of variables, chosen from the top bar. Screen word: "Ambiente".
_Avoid_: stage, profile

**Variable**:
A `{{name}}` that is replaced by its value when a request is prepared. It comes from the collection or from
the chosen environment, the environment winning.
_Avoid_: placeholder, parameter

**Secret variable**:
A variable whose value only editors read. It never reaches a published page.
_Avoid_: private variable, hidden variable

**Publication**:
A collection, or a selection of it, shown as a documentation page at its own address, with a rule for who may
open it and until when. The page follows the collection: an edit shows without publishing again, except that a
credential added to a page open to people outside the company takes the page down (ADR 0002). Screen word: "link".
_Avoid_: export, docs page, view (a "visualização" is not a term of the code)

**Selection**:
The folders and requests a publication shows, marked on a tree and kept by their ids, so renaming or moving one
changes nothing and deleting one only removes it from the page. A folder ticked marks what it holds now; what is
added to it later stays out until an admin ticks it. The other mode, the whole collection, follows everything.
Screen word: "O que publicar".
_Avoid_: filter, subset, scope

**Visibility**:
Who may open a publication: `workspace` (its members), `people` (a list of company addresses), `company` (any
signed-in company account), `link` (anyone with the address, no sign-in) or `password` (anyone who knows the access
password, for a customer). Checked on every open. Screen word: "Quem pode abrir"; the last one reads "Cliente, com senha".
_Avoid_: privacy, audience

**Access password**:
The one password of a `password` publication. The system generates it and shows it once, and keeps only a hash, so
nobody can read it again: if it is lost, an admin changes it. Only a workspace admin creates, changes or removes a
`password` publication; editors see it, read-only. Screen word: "Senha de acesso".
_Avoid_: key, passphrase, token

**Expiry**:
The moment, in server time (UTC), when a publication stops opening. Any visibility can have one: 7, 30 or 90 days, a
date, or none. The default is 30 days. The page then says the access expired. Renewing a `password` publication always
changes the password too. Screen word: "Validade".
_Avoid_: ttl, lifetime, deadline

**Lockout**:
After 5 wrong passwords the publication refuses every attempt, the right password included, for 15 minutes. The page
warns on the third. An admin ends it early by changing the password. Screen word: "Bloqueado até hh:mm".
_Avoid_: ban, throttle, rate limit

**Last access**:
When a publication was last opened, written at most once an hour in an item of its own, never inside the
publication. Screen word: "Último acesso".
_Avoid_: visit count, analytics

**Slug**:
The random part of a publication's address. Impossible to guess, and not a secret by itself.
_Avoid_: id, token, code

**Send through the server**:
The default. The API makes the call, so there is no CORS, and it refuses private destinations.
_Avoid_: proxy mode, remote

**Send from the browser**:
For `localhost` and the person's own network, which the server cannot reach. The destination has to allow CORS.
_Avoid_: local mode, direct

**Allowed domain**:
A company e-mail domain whose accounts may sign in and be added as members.
_Avoid_: whitelist, tenant
