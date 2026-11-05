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
A collection (or one folder of it) shown as a documentation page at its own address, with a rule for who may
open it. The page follows the collection: an edit shows without publishing again, except that a folder that moved,
or a credential added to a `link` page, takes the page down (ADR 0002). Screen word: "link".
_Avoid_: export, docs page

**Visibility**:
Who may open a publication: `workspace` (its members), `people` (a list of company addresses), `company` (any
signed-in company account) or `link` (anyone with the address, no sign-in). Checked on every open.
Screen word: "Quem pode abrir".
_Avoid_: privacy, audience

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
