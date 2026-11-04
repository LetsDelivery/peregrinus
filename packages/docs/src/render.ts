import type { Auth, Collection, Example, FolderNode, KeyValue, Node, RequestNode } from '@postmano/core'
import { effectiveAuth, prepareRequest } from '@postmano/send/browser'

import { escapeHtml as esc } from './escape.js'
import { type Labels, type Locale, labelsFor } from './labels.js'
import { renderMarkdown } from './markdown.js'
import { type Language, snippet } from './snippets.js'

export type DocsOptions = {
  /** The variables the page may show. Secrets are left out by the caller, so `{{token}}` stays as written. */
  variables: Readonly<Record<string, string>>
  language: Language
  /** The language of the words the page adds itself (headings, table headers). Portuguese when left out. */
  locale?: Locale
}

const anchor = (path: readonly number[]): string => `n-${path.join('-')}`

const authLabel = (type: Auth['type'], l: Labels): string =>
  ({
    inherit: l.inherited,
    none: l.noAuth,
    bearer: 'Bearer token',
    basic: 'Basic',
    apikey: 'API Key',
    unsupported: l.unsupported
  })[type]

const badge = (method: string): string =>
  `<span class="method m-${esc(method.toLowerCase())}">${esc(method.toUpperCase())}</span>`

const rows = (items: readonly KeyValue[], l: Labels): string =>
  items.length === 0
    ? ''
    : `<table><thead><tr><th>${l.name}</th><th>${l.value}</th><th>${l.description}</th></tr></thead><tbody>${items
        .map(
          (row) =>
            `<tr class="${row.disabled ? 'off' : ''}"><td><code>${esc(row.key)}</code></td><td><code>${esc(row.value)}</code></td><td>${renderMarkdown(row.description)}</td></tr>`
        )
        .join('')}</tbody></table>`

const section = (title: string, body: string): string => (body === '' ? '' : `<h3>${esc(title)}</h3>${body}`)

/** The request with its secrets replaced by placeholders: the page shows the shape of the call, not anyone's token. */
const placeholderAuth = (auth: Auth, l: Labels): Auth => {
  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: l.token }
    case 'basic':
      return { type: 'basic', username: l.username, password: l.password }
    case 'apikey':
      return { ...auth, value: l.key }
    default:
      return { type: 'none' }
  }
}

const exampleHtml = (example: Example, l: Labels): string =>
  `<details class="example"><summary><strong>${esc(String(example.code))} ${esc(example.status)}</strong> ${esc(example.name)}</summary>${rows(example.headers, l)}<pre><code>${esc(example.body)}</code></pre></details>`

const bodyHtml = (request: RequestNode, l: Labels): string => {
  const { body } = request
  switch (body.mode) {
    case 'raw':
      return `<p>raw (${esc(body.language)})</p><pre><code>${esc(body.content)}</code></pre>`
    case 'urlencoded':
    case 'formdata':
      return `<p>${esc(body.mode)}</p>${rows(body.fields, l)}`
    case 'graphql':
      return `<p>GraphQL</p><pre><code>${esc(body.query)}</code></pre>`
    default:
      return ''
  }
}

const requestHtml = (
  request: RequestNode,
  parents: readonly Auth[],
  path: readonly number[],
  options: DocsOptions
): string => {
  const auth = effectiveAuth(request.auth, parents)
  const scopes = [options.variables]
  const l = labelsFor(options.locale)
  const prepared = prepareRequest(request, placeholderAuth(auth, l), scopes, { lenientUrl: true })
  const authLine = `<p>${esc(authLabel(auth.type, l))}${request.auth.type === 'inherit' && auth.type !== 'none' ? l.fromParent : ''}</p>`
  return `<section class="doc-request" id="${anchor(path)}">
    <h2>${badge(request.method)} ${esc(request.name)}</h2>
    <p class="doc-url"><code>${esc(request.url)}</code></p>
    ${renderMarkdown(request.description)}
    ${section(l.authorization, authLine)}${section(l.queryParams, rows(request.query, l))}${section(l.headers, rows(request.headers, l))}${section(l.body, bodyHtml(request, l))}
    ${section(l.exampleRequest, `<pre><code>${esc(snippet(options.language, prepared))}</code></pre>`)}
    ${section(l.exampleResponses, request.examples.map((example) => exampleHtml(example, l)).join(''))}
  </section>`
}

const folderHtml = (
  folder: FolderNode,
  parents: readonly Auth[],
  path: readonly number[],
  options: DocsOptions
): string =>
  `<section class="doc-folder" id="${anchor(path)}"><h2 class="folder">${esc(folder.name)}</h2>${renderMarkdown(folder.description)}${body(folder.children, [folder.auth, ...parents], path, options)}</section>`

const body = (
  items: readonly Node[],
  parents: readonly Auth[],
  path: readonly number[],
  options: DocsOptions
): string =>
  items
    .map((item, at) =>
      item.kind === 'folder'
        ? folderHtml(item, parents, [...path, at], options)
        : requestHtml(item, parents, [...path, at], options)
    )
    .join('')

const tocHtml = (items: readonly Node[], path: readonly number[]): string =>
  `<ul>${items
    .map((item, at) => {
      const here = [...path, at]
      const label = item.kind === 'folder' ? esc(item.name) : `${badge(item.method)} ${esc(item.name)}`
      const inner = item.kind === 'folder' ? tocHtml(item.children, here) : ''
      return `<li><a href="#${anchor(here)}">${label}</a>${inner}</li>`
    })
    .join('')}</ul>`

/** The documentation of a collection as an HTML fragment: a table of contents and one section per folder and request. */
export const renderDocumentation = (collection: Collection, options: DocsOptions): string =>
  `<div class="docs"><nav class="toc"><strong>${esc(collection.name)}</strong>${tocHtml(collection.items, [])}</nav>
  <article class="content"><h1>${esc(collection.name)}</h1>${renderMarkdown(collection.description)}${body(collection.items, [collection.auth], [], options)}</article></div>`

const STYLE = `body{margin:0;font:15px/1.55 system-ui,sans-serif;color:#17203a;background:#fff}.docs{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
.toc{padding:16px;border-right:1px solid #dde1ee;position:sticky;top:0;height:100vh;overflow:auto;font-size:13px}.toc ul{list-style:none;padding-left:12px;margin:4px 0}.toc a{color:inherit;text-decoration:none}
.content{padding:24px 32px;max-width:960px}pre{background:#f3f5fb;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,Menlo,monospace;font-size:13px}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #dde1ee;padding:6px 10px;text-align:left;vertical-align:top}tr.off{opacity:.5}
.method{font:700 11px ui-monospace,monospace;padding:2px 6px;border-radius:4px;background:#eef1fa}.m-get{color:#14803c}.m-post{color:#a16207}.m-delete{color:#c0182b}.m-put,.m-patch{color:#1d4ed8}
.doc-request{border-top:1px solid #dde1ee;padding-top:16px;margin-top:24px}.folder{margin-top:32px}details.example{margin:8px 0}@media(max-width:820px){.docs{grid-template-columns:1fr}.toc{position:static;height:auto}}`

/** The same documentation as a whole HTML file, with its style inline, to send to someone or attach to a ticket. */
export const renderStandalone = (collection: Collection, options: DocsOptions): string =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(collection.name)}</title><style>${STYLE}</style></head><body>${renderDocumentation(collection, options)}</body></html>`
