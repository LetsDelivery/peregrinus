import './styles/app.css'
import { ApiError, api } from './lib/api.js'
import { completeLogin, login, logout, profile, signedIn } from './lib/auth.js'
import { sendFromBrowser } from './lib/browser-send.js'
import { html, mount } from './lib/html.js'
import { setLocale, t } from './lib/i18n.js'
import { getPath, setPath } from './lib/paths.js'
import { renameRequest } from './lib/rename.js'
import { draftFromPublication, newDraft, payloadFromDraft, shareUrl } from './lib/share.js'
import { clampSide, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_STEP } from './lib/side-width.js'
import { canEdit, currentWorkspace, resolveSelection, savePrefs, scopes, sendOptions, state, ws } from './lib/store.js'
import { applyTheme, isNight } from './lib/theme.js'
import { docs, standalone } from './views/docs.js'
import { editor } from './views/editor.js'
import { environments } from './views/environments.js'
import { response } from './views/response.js'
import { settings } from './views/settings.js'
import { share } from './views/share.js'
import { sidebar } from './views/sidebar.js'
import { topbar, workspaceName, workspaceSwitcher } from './views/topbar.js'

const shell = html`<header class="top">
    <div class="top-left">
      <img class="logo" src="/wordmark-dark.svg" alt="postmano" height="36" />
      <div id="ws-switch"></div>
    </div>
    <div class="top-right" id="top-right"></div>
  </header>
  <main class="layout">
    <aside class="side">
      <div class="side-tools">
        <input id="filter" type="search" />
        <label class="icon-btn" id="import-btn"><span id="import-label"></span><input id="file" type="file" hidden accept=".json,application/json" /></label>
      </div>
      <div id="tree"></div>
    </aside>
    <div class="side-resizer" id="side-resizer" role="separator" aria-orientation="vertical" tabindex="0"></div>
    <section class="work">
      <nav class="views" id="views"></nav>
      <div id="main"></div>
    </section>
  </main>
  <div id="modal"></div>
  <div id="toast" role="status"></div>`

const $ = (selector) => document.querySelector(selector)

const toast = (message) => {
  $('#toast').textContent = message
  setTimeout(() => {
    $('#toast').textContent = ''
  }, 6000)
}

/** The reason the API gave (its own message) goes after the panel's sentence, so a refusal says what to fix. */
const fail = (error) => {
  const message = error.message ?? t('Algo deu errado.')
  toast(error instanceof ApiError && error.detail ? `${message} ${error.detail}` : message)
}

const viewTabs = () => {
  const tabs = [
    ['request', t('Requisição')],
    ['docs', t('Documentação')]
  ]
  return state.view === 'envs' ? [...tabs, ['envs', t('Ambiente')]] : tabs
}

const mainView = () => {
  if (state.view === 'docs') {
    return docs(state)
  }
  if (state.view === 'envs') {
    return environments(state)
  }
  return html`<div id="editor">${editor(state)}</div><div id="response">${response(state)}</div>`
}

const applyStaticText = () => {
  $('#filter').placeholder = t('Filtrar coleções')
  $('#filter').setAttribute('aria-label', t('Filtrar'))
  $('#import-label').textContent = t('Importar')
  $('#import-btn').title = t('Importar coleção do Postman (Collection v2.1)')
}

const draw = () => {
  setLocale(state.settings.language)
  applyTheme(state.settings.theme)
  applyStaticText()
  mount($('#ws-switch'), workspaceSwitcher(state))
  mount($('#top-right'), topbar(state))
  mount($('#tree'), sidebar(state))
  mount(
    $('#views'),
    html`${viewTabs().map(([id, label]) => html`<button class="${state.view === id ? 'on' : ''}" data-view="${id}">${label}</button>`)}`
  )
  mount($('#main'), mainView())
  mount($('#modal'), html`${settings(state)}${share(state)}`)
}

// ---- loading from the API -------------------------------------------------------------------------------

const loadWorkspaces = async () => {
  state.workspaces = (await api.get('/v1/workspaces')).items
  if (!currentWorkspace()) {
    state.workspaceId = state.workspaces[0]?.id ?? null
  }
}

const loadWorkspaceDetail = async () => {
  const detail = await api.get(ws(''))
  state.wsDraft = {
    name: detail.name,
    members: detail.members,
    version: detail.version,
    personal: detail.personal,
    role: detail.role
  }
}

const resetWorkspaceData = () =>
  Object.assign(state, {
    collections: [],
    collectionId: null,
    collection: null,
    environments: [],
    environmentId: '',
    environment: null,
    envDraft: null,
    selected: null,
    renaming: null,
    current: null,
    response: null,
    wsDraft: null,
    view: 'request'
  })

/** Goes to another workspace: what was open belonged to the old one, so it is closed and the new one is loaded. */
const switchWorkspace = async (id) => {
  resetWorkspaceData()
  state.workspaceId = id
  savePrefs()
  await loadLists()
  draw()
}

const loadEnvironment = async () => {
  state.environment = state.environmentId
    ? (await api.get(ws(`/environments/${state.environmentId}`))).environment
    : null
}

const loadLists = async () => {
  const [collections, environmentList] = await Promise.all([api.get(ws('/collections')), api.get(ws('/environments'))])
  state.collections = collections.items
  state.environments = environmentList.items
  if (state.environmentId && !state.environments.some((env) => env.id === state.environmentId)) {
    state.environmentId = ''
    toast(t('O ambiente escolhido não existe mais; as variáveis dele não serão usadas.'))
  }
}

const openCollection = async (id) => {
  const loaded = await api.get(ws(`/collections/${id}`))
  Object.assign(state, {
    collectionId: id,
    version: loaded.version,
    collection: loaded.collection,
    selected: null,
    renaming: null,
    current: null,
    response: null,
    saved: JSON.stringify(loaded.collection)
  })
  savePrefs()
}

/** Writes the request being edited back into the open collection, in memory. Save sends the collection. */
const commitCurrent = () => {
  const path = state.selected?.split('.').map(Number)
  if (!path || !state.current) {
    return
  }
  const parent = path.slice(0, -1).reduce((node, index) => node.children[index], { children: state.collection.items })
  parent.children[path.at(-1)] = structuredClone(state.current)
}

/** True when the open collection has changes that were not saved. */
const isDirty = () => {
  if (!state.collection) {
    return false
  }
  commitCurrent()
  return JSON.stringify(state.collection) !== state.saved
}

/** Asks before leaving a collection with unsaved changes. */
const mayLeave = () => !isDirty() || confirm(t('Há mudanças não salvas nesta coleção. Descartar?'))

/** A double click on a request in the sidebar turns its name into a field. */
const startRename = (key) => {
  if (!canEdit()) {
    return
  }
  state.renaming = key
  draw()
  $('input[data-rename]')?.select()
}

// While a mouse button is down, redrawing would replace the element under the pointer and the click would be lost.
let pointerDown = false
let drawAfterClick = false

/** Puts the new name on the request, on the selected copy too, and says so only when it really changed. */
const applyRename = (key, name) => {
  commitCurrent()
  if (!renameRequest(state.collection, key, name)) {
    return
  }
  if (state.selected === key) {
    state.current.name = name
  }
  toast(t('Nome alterado. Salve para gravar.'))
}

/** Enter or leaving the field keeps the name; Esc drops it. Whatever ends it, it runs once. */
const finishRename = (value, keep, byKeyboard = false) => {
  const key = state.renaming
  if (key === null) {
    return
  }
  state.renaming = null
  const name = value.trim()
  if (keep && name !== '') {
    applyRename(key, name)
  }
  if (pointerDown) {
    drawAfterClick = true
    return
  }
  draw()
  if (byKeyboard) {
    $(`[data-select="${key}"]`)?.focus()
  }
}

const select = (key) => {
  commitCurrent()
  const { request, parents } = resolveSelection(state.collection, key.split('.').map(Number))
  Object.assign(state, { selected: key, current: structuredClone(request), parents, response: null, view: 'request' })
  draw()
}

// ---- actions --------------------------------------------------------------------------------------------

const importFile = async (file) => {
  try {
    const { collection, warnings } = await api.post('/v1/imports/postman', JSON.parse(await file.text()))
    const created = await api.post(ws('/collections'), { collection })
    await loadLists()
    await openCollection(created.id)
    state.view = 'request'
    draw()
    toast(
      warnings.length
        ? t('Importada, com {count} aviso(s): {message}', { count: warnings.length, message: warnings[0].message })
        : t('Coleção importada.')
    )
  } catch (error) {
    fail(error instanceof SyntaxError ? new Error(t('Esse arquivo não é um JSON de coleção do Postman.')) : error)
  }
}

const newCollection = async () => {
  const name = prompt(t('Nome da nova coleção'))?.trim()
  if (!name) {
    return
  }
  const created = await api.post(ws('/collections'), {
    collection: { name, auth: { type: 'none' }, variables: [], items: [] }
  })
  await loadLists()
  await openCollection(created.id)
  state.view = 'request'
  draw()
}

const blankRequest = () => ({
  kind: 'request',
  name: t('Nova requisição'),
  method: 'GET',
  url: '',
  query: [],
  headers: [],
  body: { mode: 'none' },
  auth: { type: 'inherit' },
  examples: []
})

/** Adds a request at the root of the open collection and selects it; Salvar writes it to the server. */
const newRequest = () => {
  state.collection.items.push(blankRequest())
  select(String(state.collection.items.length - 1))
}

const send = async () => {
  Object.assign(state, { sending: true, response: null })
  draw()
  const payload = { request: state.current, parents: state.parents, variables: scopes() }
  try {
    state.response =
      state.settings.via === 'browser'
        ? await sendFromBrowser(payload)
        : await api.post('/v1/send', { ...payload, options: sendOptions() })
  } catch (error) {
    state.response = { error: { message: error.message ?? t('Falha de rede.'), detail: error.detail } }
  }
  state.sending = false
  draw()
}

const saveCollection = async () => {
  commitCurrent()
  try {
    const saved = await api.put(ws(`/collections/${state.collectionId}`), {
      collection: state.collection,
      version: state.version
    })
    state.version = saved.version
    state.saved = JSON.stringify(state.collection)
    toast(t('Salvo.'))
  } catch (error) {
    fail(error)
  }
}

const deleteCollection = async () => {
  if (!confirm(t('Excluir a coleção "{name}" para todo o time?', { name: state.collection.name }))) {
    return
  }
  await api.del(ws(`/collections/${state.collectionId}`))
  Object.assign(state, { collectionId: null, collection: null, current: null, selected: null })
  await loadLists()
  draw()
}

const saveEnvironment = async () => {
  const { id, name, variables, version } = state.envDraft
  try {
    const saved = id
      ? await api.put(ws(`/environments/${id}`), { name, variables, version })
      : await api.post(ws('/environments'), { name, variables })
    await loadLists()
    Object.assign(state.envDraft, { id: saved.id, version: saved.version })
    if (state.environmentId === saved.id) {
      await loadEnvironment()
    }
    draw()
    toast(t('Ambiente salvo.'))
  } catch (error) {
    fail(error)
  }
}

const editEnvironment = async (id) => {
  const loaded = await api.get(ws(`/environments/${id}`))
  Object.assign(state, {
    view: 'envs',
    envDraft: { id, name: loaded.name, version: loaded.version, variables: loaded.environment.variables }
  })
  draw()
}

const useEnvironment = async () => {
  state.environmentId = state.envDraft.id
  await loadEnvironment()
  savePrefs()
  draw()
  toast(t('Ambiente "{name}" em uso.', { name: state.envDraft.name }))
}

const exportDocs = () => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([standalone(state)], { type: 'text/html' }))
  link.download = `${state.collection.name.replace(/[^\w-]+/g, '-')}.html`
  link.click()
  URL.revokeObjectURL(link.href)
}

const editing =
  (action) =>
  async (...args) => {
    if (!canEdit()) {
      return toast(t('Você só pode ler no workspace "{name}".', { name: workspaceName(currentWorkspace()) }))
    }
    return await action(...args)
  }

const loadShares = async () => {
  const { items } = await api.get(ws(`/docs?collectionId=${state.collectionId}`))
  state.shares = items.map(draftFromPublication)
}

/** Saves one link. A public link over text that looks like a credential asks first, and goes on only if told to. */
const saveShare = async (index) => {
  const draft = state.shares[index]
  const send = (acknowledgeSecrets) => {
    const body = { ...payloadFromDraft(draft, state.collectionId), acknowledgeSecrets }
    return draft.slug
      ? api.put(ws(`/docs/${draft.slug}`), { ...body, version: draft.version })
      : api.post(ws('/docs'), body)
  }
  let result
  try {
    result = await send(false)
  } catch (error) {
    const question = `${t('Esta coleção tem texto que parece credencial. Quem tiver o endereço vai ler.')}\n\n${error.detail}\n\n${t('Publicar mesmo assim?')}`
    if (error.code !== 'unsafe_content' || !confirm(question)) {
      throw error
    }
    result = await send(true)
  }
  // The link is saved by now. If the list cannot be reloaded, say so apart, and do not call the save a failure.
  await loadShares().catch((error) => fail(error))
  draw()
  const [first] = result.warnings
  toast(
    first
      ? t('Salvo, mas {count} requisição(ões) têm texto que parece credencial: {first}', {
          count: result.warnings.length,
          first: first.path
        })
      : t('Link salvo.')
  )
}

const emptyRow = () => ({ key: '', value: '', disabled: false })

/** What a click on `[data-action]` does, by the action's name. */
const ACTIONS = {
  send,
  save: editing(saveCollection),
  logout,
  'new-collection': editing(newCollection),
  'new-request': editing(newRequest),
  'delete-collection': editing(deleteCollection),
  'save-env': editing(saveEnvironment),
  'use-env': useEnvironment,
  'export-docs': exportDocs,
  'open-share': async () => {
    await loadShares()
    state.shareOpen = true
    draw()
  },
  'close-share': () => {
    state.shareOpen = false
    draw()
  },
  'new-share': () => {
    state.shares.push(newDraft(state.collection.name))
    draw()
  },
  'drop-share': ({ index }) => {
    state.shares.splice(Number(index), 1)
    draw()
  },
  'save-share': ({ index }) => saveShare(Number(index)),
  'delete-share': async ({ index }) => {
    const draft = state.shares[Number(index)]
    if (confirm(t('Excluir o link "{name}"? Quem o tiver deixa de abrir a página.', { name: draft.title }))) {
      await api.del(ws(`/docs/${draft.slug}`))
      await loadShares()
      draw()
    }
  },
  'copy-share': async ({ index }) => {
    await navigator.clipboard.writeText(shareUrl(location.origin, state.shares[Number(index)].slug))
    toast(t('Endereço copiado.'))
  },
  'pick-import': () => $('#file').click(),
  'export-collection': () => {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(state.collection, null, 2)], { type: 'application/json' }))
    link.download = `${state.collection.name.replace(/[^\w-]+/g, '-')}.postmano.json`
    link.click()
    URL.revokeObjectURL(link.href)
  },
  'toggle-theme': () => {
    state.settings.theme = isNight(state.settings.theme) ? 'light' : 'dark'
    savePrefs()
    draw()
  },
  'toggle-ws-menu': () => {
    Object.assign(state, { wsMenuOpen: !state.wsMenuOpen, menuOpen: false })
    draw()
  },
  'create-workspace': async () => {
    const name = prompt(t('Nome do novo workspace'))?.trim()
    state.wsMenuOpen = false
    if (name) {
      const created = await api.post('/v1/workspaces', { name })
      await loadWorkspaces()
      await switchWorkspace(created.id)
    }
  },
  'manage-workspace': async () => {
    await loadWorkspaceDetail()
    Object.assign(state, { settingsOpen: true, settingsTab: 'workspace', wsMenuOpen: false })
    draw()
  },
  'save-workspace': async () => {
    const { name, members, version } = state.wsDraft
    await api.put(ws(''), { name, members, version })
    await loadWorkspaces()
    await loadWorkspaceDetail()
    draw()
    toast(t('Workspace salvo.'))
  },
  'delete-workspace': async () => {
    if (confirm(t('Excluir o workspace "{name}" e tudo que há nele?', { name: state.wsDraft.name }))) {
      await api.del(ws(''))
      state.settingsOpen = false
      await loadWorkspaces()
      await switchWorkspace(state.workspaceId)
    }
  },
  'add-member': () => {
    state.wsDraft.members.push({ email: '', role: 'viewer' })
    draw()
  },
  'remove-member': ({ index }) => {
    state.wsDraft.members.splice(Number(index), 1)
    draw()
  },
  'toggle-menu': () => {
    state.menuOpen = !state.menuOpen
    draw()
  },
  'open-settings': () => {
    Object.assign(state, { settingsOpen: true, menuOpen: false, settingsTab: 'general' })
    draw()
  },
  'close-settings': () => {
    state.settingsOpen = false
    draw()
  },
  'new-env': () => {
    Object.assign(state, {
      view: 'envs',
      envDraft: { id: null, name: '', version: null, variables: [{ key: '', value: '', secret: false }] }
    })
    draw()
  },
  'delete-env': async () => {
    if (confirm(t('Excluir o ambiente "{name}" para todo o time?', { name: state.envDraft.name }))) {
      await api.del(ws(`/environments/${state.envDraft.id}`))
      state.envDraft = null
      await loadLists()
      draw()
    }
  },
  'add-variable': () => {
    state.envDraft.variables.push({ key: '', value: '', secret: false })
    draw()
  },
  'remove-variable': ({ index }) => {
    state.envDraft.variables.splice(Number(index), 1)
    draw()
  },
  'add-row': ({ target }) => {
    getPath(state.current, target).push(emptyRow())
    draw()
  },
  'remove-row': ({ target, index }) => {
    getPath(state.current, target).splice(Number(index), 1)
    draw()
  }
}

const DEFAULTS = {
  body: {
    none: { mode: 'none' },
    raw: { mode: 'raw', language: 'json', content: '' },
    urlencoded: { mode: 'urlencoded', fields: [] },
    formdata: { mode: 'formdata', fields: [] },
    graphql: { mode: 'graphql', query: '', variables: '' }
  },
  auth: {
    inherit: { type: 'inherit' },
    none: { type: 'none' },
    bearer: { type: 'bearer', token: '' },
    basic: { type: 'basic', username: '', password: '' },
    apikey: { type: 'apikey', key: '', value: '', in: 'header' }
  }
}

const guarded = (action) => async (event) => {
  try {
    await action(event)
  } catch (error) {
    fail(error)
  }
}

const CLICKABLE =
  '[data-select],[data-tab],[data-rtab],[data-view],[data-open-collection],[data-open-doc],[data-edit-env],[data-toggle-section],[data-settings-tab],[data-switch-workspace],[data-action]'

/** What a click does, by the `data-*` attribute of the element that was clicked. */
const CLICKS = {
  select,
  openCollection: async (id) => {
    if (id !== state.collectionId && !mayLeave()) {
      return
    }
    await openCollection(id)
    state.view = 'request'
    draw()
  },
  openDoc: async (id) => {
    if (id !== state.collectionId) {
      if (!mayLeave()) {
        return
      }
      await openCollection(id)
    }
    state.view = 'docs'
    draw()
  },
  editEnv: editEnvironment,
  view: (id) => {
    state.view = id
    draw()
  },
  tab: (id) => {
    state.tab = id
    draw()
  },
  rtab: (id) => {
    state.responseTab = id
    draw()
  },
  toggleSection: (id) => {
    state.sections[id] = !state.sections[id]
    savePrefs()
    draw()
  },
  settingsTab: async (id) => {
    state.settingsTab = id
    draw()
    if (id === 'workspace') {
      await loadWorkspaceDetail()
      draw()
    }
  },
  switchWorkspace: async (id) => {
    state.wsMenuOpen = false
    if (!mayLeave()) {
      return
    }
    await switchWorkspace(id)
  }
}

const closeMenuOutside = (event) => {
  const outsideProfile = state.menuOpen && !event.target.closest('.profile')
  const outsideWorkspaces = state.wsMenuOpen && !event.target.closest('.ws-switch')
  if (outsideProfile || outsideWorkspaces) {
    Object.assign(state, { menuOpen: false, wsMenuOpen: false })
    draw()
  }
}

const click = guarded(async (event) => {
  closeMenuOutside(event)
  const data = event.target.closest(CLICKABLE)?.dataset
  if (!data) {
    return
  }
  const name = Object.keys(CLICKS).find((key) => data[key] !== undefined)
  await (name ? CLICKS[name](data[name]) : ACTIONS[data.action]?.(data))
})

const inputValue = (input) => {
  if (input.type !== 'checkbox') {
    return input.value
  }
  return input.dataset.invert === undefined ? input.checked : !input.checked
}

const applyBinding = (target) => {
  const { bind, envBind, wsBind, shareBind } = target.dataset
  if (bind) {
    setPath(state.current, bind, inputValue(target))
  } else if (envBind) {
    setPath(state.envDraft, envBind, inputValue(target))
  } else if (wsBind) {
    setPath(state.wsDraft, wsBind, inputValue(target))
  } else if (shareBind) {
    setPath(state.shares, shareBind, inputValue(target))
    if (shareBind.endsWith('.visibility')) {
      draw()
    }
  }
  return Boolean(bind || envBind || wsBind || shareBind)
}

const applyPreference = (target) => {
  const { setting, docsLanguage } = target.dataset
  if (setting) {
    state.settings[setting] = target.type === 'checkbox' ? target.checked : target.value
  } else if (docsLanguage !== undefined) {
    state.docsLanguage = target.value
  } else {
    return
  }
  savePrefs()
  if (target.type !== 'number') {
    draw()
  }
}

const switchEnvironment = async (id) => {
  state.environmentId = id
  await loadEnvironment()
  savePrefs()
  draw()
}

const change = guarded(async ({ target }) => {
  if (target.dataset.envSelect !== undefined) {
    await switchEnvironment(target.value)
  } else if (target.dataset.bindMode) {
    state.current[target.dataset.bindMode] = structuredClone(DEFAULTS[target.dataset.bindMode][target.value])
    draw()
  } else if (!applyBinding(target)) {
    applyPreference(target)
  }
})

const rememberFolder = (event) => {
  const key = event.target.dataset?.folder
  if (key) {
    event.target.open ? state.open.add(key) : state.open.delete(key)
  }
}

/** Ctrl or Cmd plus a key. They are off when the person turns shortcuts off in the settings. */
const SHORTCUT_KEYS = {
  enter: () => state.current && ACTIONS.send(),
  s: () => state.current && ACTIONS.save(),
  k: () => $('#filter').focus()
}

/** F2 renames the selected request, unless the person is typing somewhere. */
const renameByKey = (event) => {
  if (event.key !== 'F2' || state.selected === null || event.target.matches?.('input, textarea, select')) {
    return false
  }
  event.preventDefault()
  startRename(state.selected)
  return true
}

const onKey = (event) => {
  if (renameByKey(event)) {
    return
  }
  if (event.key === 'Escape' && (state.menuOpen || state.wsMenuOpen || state.settingsOpen || state.shareOpen)) {
    Object.assign(state, { menuOpen: false, wsMenuOpen: false, settingsOpen: false, shareOpen: false })
    draw()
    return
  }
  const run =
    state.settings.shortcuts && (event.metaKey || event.ctrlKey) ? SHORTCUT_KEYS[event.key.toLowerCase()] : undefined
  if (run) {
    event.preventDefault()
    run()
  }
}

// ---- the width of the sidebar ----------------------------------------------------------------------------

const setSide = (width) => {
  state.sideWidth = clampSide(width, window.innerWidth)
  $('.layout').style.setProperty('--side-width', `${state.sideWidth}px`)
  const handle = $('#side-resizer')
  handle.setAttribute('aria-valuenow', String(state.sideWidth))
}

/** Dragging the edge, or the arrow keys on it, sets the width; Home and End go to the limits; a double click resets. */
const wireSideResizer = () => {
  const handle = $('#side-resizer')
  handle.setAttribute('aria-label', t('Largura da barra lateral'))
  handle.setAttribute('aria-valuemin', String(SIDE_MIN))
  handle.setAttribute('aria-valuemax', String(SIDE_MAX))
  setSide(state.sideWidth)
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
  })
  handle.addEventListener('pointermove', (event) => {
    if (handle.hasPointerCapture(event.pointerId)) {
      setSide(event.clientX - $('.layout').getBoundingClientRect().left)
    }
  })
  handle.addEventListener('pointerup', () => {
    handle.classList.remove('dragging')
    savePrefs()
  })
  handle.addEventListener('dblclick', () => {
    setSide(SIDE_DEFAULT)
    savePrefs()
  })
  handle.addEventListener('keydown', (event) => {
    const next = {
      ArrowLeft: state.sideWidth - SIDE_STEP,
      ArrowRight: state.sideWidth + SIDE_STEP,
      Home: SIDE_MIN,
      End: SIDE_MAX
    }[event.key]
    if (next !== undefined) {
      event.preventDefault()
      setSide(next)
      savePrefs()
    }
  })
}

const wire = () => {
  wireSideResizer()
  document.addEventListener('click', click)
  document.addEventListener('change', change)
  document.addEventListener('input', (event) => {
    if (
      event.target.matches('input:not([type=checkbox]):not([type=radio]):not(#filter):not([data-rename]), textarea')
    ) {
      change(event)
    }
  })
  // `toggle` does not bubble, so it is caught on the way down to remember which folders the person opened.
  document.addEventListener('toggle', rememberFolder, true)
  document.addEventListener(
    'mousedown',
    () => {
      pointerDown = true
    },
    true
  )
  document.addEventListener(
    'mouseup',
    () => {
      pointerDown = false
    },
    true
  )
  document.addEventListener('click', () => {
    if (drawAfterClick) {
      drawAfterClick = false
      draw()
    }
  })
  document.addEventListener('dblclick', (event) => {
    const key = event.target.closest?.('[data-select]')?.dataset.select
    if (key !== undefined) {
      startRename(key)
    }
  })
  document.addEventListener('focusout', (event) => {
    if (event.target.matches?.('[data-rename]')) {
      finishRename(event.target.value, true)
    }
  })
  document.addEventListener('keydown', (event) => {
    if (event.target.matches?.('[data-rename]') && ['Enter', 'Escape'].includes(event.key)) {
      event.preventDefault()
      finishRename(event.target.value, event.key === 'Enter', true)
    }
  })
  document.addEventListener('focusin', (event) => event.target.matches?.('.share-url input') && event.target.select())
  document.addEventListener('keydown', onKey)
  $('#modal').addEventListener('click', (event) => {
    if (event.target.classList.contains('backdrop')) {
      Object.assign(state, { settingsOpen: false, shareOpen: false })
      draw()
    }
  })
  $('#filter').addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase()
    draw()
  })
  $('#file').addEventListener('change', (event) => event.target.files[0] && editing(importFile)(event.target.files[0]))
}

const boot = async () => {
  if (!(await signedIn())) {
    return await login()
  }
  state.profile = await profile()
  await loadWorkspaces()
  await loadLists()
  await loadEnvironment()
  if (state.collectionId && state.collections.some((item) => item.id === state.collectionId)) {
    await openCollection(state.collectionId)
  }
  draw()
}

/** `/docs/<slug>` is the public page of a published collection; everything else is the panel. */
const viewerSlug = () => /^\/docs\/([A-Za-z0-9_-]{1,64})\/?$/.exec(location.pathname)?.[1]

const startPanel = async () => {
  mount($('#app'), shell)
  wire()
  state.profile = await profile()
  draw()
  await boot().catch(fail)
}

const showLoginError = (message) => {
  mount(
    $('#app'),
    html`<main class="login-error">
      <h1>${t('Não foi possível entrar')}</h1>
      <p>${message}</p>
      <button id="retry-login">${t('Tentar de novo')}</button>
    </main>`
  )
  $('#retry-login').addEventListener('click', login)
}

const start = async () => {
  await completeLogin().catch((error) => {
    // Without this the panel would send the person to Google again with no word, and loop.
    for (const key of ['pg:state', 'pg:verifier']) {
      sessionStorage.removeItem(key)
    }
    history.replaceState(null, '', '/')
    state.loginError = error.message
  })
  if (state.loginError) {
    return showLoginError(state.loginError)
  }
  const slug = viewerSlug()
  if (!slug) {
    return await startPanel()
  }
  const { startViewer } = await import('./viewer-main.js')
  await startViewer(slug)
}

start().catch((error) => {
  // Before the panel is drawn there is no toast to show it in.
  if ($('#toast')) {
    fail(error)
  } else {
    document.body.textContent = error.message ?? t('Algo deu errado.')
  }
})
