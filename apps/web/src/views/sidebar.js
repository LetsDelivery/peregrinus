import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { canEdit } from '../lib/store.js'

const METHOD = { DELETE: 'DEL' }

const badge = (method) => html`<span class="method m-${method.toLowerCase()}">${METHOD[method] ?? method}</span>`

/** A folder stays when any request below it matches; a request matches by name or address. */
const matches = (item, filter) => {
  if (filter === '') {
    return true
  }
  if (item.kind === 'folder') {
    return item.name.toLowerCase().includes(filter) || item.children.some((child) => matches(child, filter))
  }
  return `${item.name} ${item.url}`.toLowerCase().includes(filter)
}

const node = (item, path, view) => {
  const key = path.join('.')
  const { selected, open, filter } = view
  if (!matches(item, filter)) {
    return ''
  }
  if (item.kind === 'folder') {
    const expanded = filter !== '' || open.has(key) || selected?.startsWith(`${key}.`)
    return html`<details data-folder="${key}" ${expanded ? 'open' : ''}>
      <summary>${item.name}</summary>
      <div class="children">${item.children.map((child, index) => node(child, [...path, index], view))}</div>
    </details>`
  }
  if (view.renaming === key) {
    return html`<div class="request renaming">
      ${badge(item.method.toUpperCase())}<input data-rename="${key}" value="${item.name}" aria-label="${t('Nome da requisição')}" />
    </div>`
  }
  const active = selected === key ? ' active' : ''
  return html`<button class="request${active}" data-select="${key}" title="${item.name}">
    ${badge(item.method.toUpperCase())}<span class="name">${item.name || item.url}</span>
  </button>`
}

const section = (id, title, state, body, actions = '') => {
  const open = state.sections[id]
  return html`<section class="side-section">
    <header>
      <button class="section-toggle" data-toggle-section="${id}" aria-expanded="${open}"><span class="chev">${open ? '▾' : '▸'}</span>${title}</button>
      ${open ? actions : ''}
    </header>
    ${open ? html`<div class="section-body">${body}</div>` : ''}
  </section>`
}

const rootRow = (item, active) => html`<div class="root-row">
  <button class="root-btn" data-open-collection="${item.id}"><span class="chev">${active ? '▾' : '▸'}</span>${item.name}</button>
  ${
    active && canEdit()
      ? html`<button class="icon" data-action="new-request" title="${t('Nova requisição')}" aria-label="${t('Nova requisição')}">+</button>
        <button class="icon" data-action="delete-collection" title="${t('Excluir coleção')}" aria-label="${t('Excluir coleção')}">🗑</button>`
      : ''
  }
</div>`

const collectionRoot = (item, state) => {
  const active = item.id === state.collectionId
  const tree =
    active && state.collection ? state.collection.items.map((child, index) => node(child, [index], state)) : ''
  return html`<div class="root${active ? ' active' : ''}">${rootRow(item, active)}${tree}</div>`
}

const collectionsBody = (state) =>
  state.collections.length === 0
    ? html`<p class="empty">${t('Nenhuma coleção ainda. Importe uma do Postman ou crie uma nova.')}</p>`
    : state.collections.map((item) => collectionRoot(item, state))

const environmentItem = (env, state) => {
  const used = env.id === state.environmentId
  const active = state.envDraft?.id === env.id
  return html`<button class="side-item${active ? ' active' : ''}" data-edit-env="${env.id}">
    <span class="dot${used ? ' on' : ''}" title="${used ? t('Em uso') : ''}"></span>${env.name}
  </button>`
}

const environmentsBody = (state) =>
  state.environments.length === 0
    ? html`<p class="empty">${t('Nenhum ambiente. Crie um para guardar variáveis como')} <code>baseUrl</code>.</p>`
    : state.environments.map((env) => environmentItem(env, state))

const specsBody = () =>
  html`<p class="empty">${t('Em breve: importar um arquivo OpenAPI para virar uma especificação e gerar a coleção.')}</p>`

const documentItem = (item, state) => {
  const active = state.view === 'docs' && item.id === state.collectionId
  return html`<button class="side-item${active ? ' active' : ''}" data-open-doc="${item.id}">📄 ${item.name}</button>`
}

const documentsBody = (state) =>
  state.collections.length === 0
    ? html`<p class="empty">${t('A documentação sai de uma coleção.')}</p>`
    : state.collections.map((item) => documentItem(item, state))

const add = (action, label) =>
  canEdit() ? html`<button class="icon" data-action="${action}" title="${label}" aria-label="${label}">+</button>` : ''

export const sidebar = (state) => html`
  ${section('collections', t('Coleções'), state, collectionsBody(state), add('new-collection', t('Nova coleção')))}
  ${section('environments', t('Ambientes'), state, environmentsBody(state), add('new-env', t('Novo ambiente')))}
  ${section('specs', 'Specs', state, specsBody())}
  ${section('documents', t('Documentos'), state, documentsBody(state))}`
