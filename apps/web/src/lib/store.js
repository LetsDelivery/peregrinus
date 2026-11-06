const PREFS = 'postmano:prefs'

const stored = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) ?? '{}')
  } catch {
    return {}
  }
}

const DEFAULT_SETTINGS = {
  via: 'server',
  verifyTls: true,
  timeoutMs: 25000,
  followRedirects: true,
  maxRedirects: 5,
  theme: 'system',
  language: 'auto',
  shortcuts: true
}

/** Settings saved by an older version: `insecureTls` became its opposite, `verifyTls`. */
const migrateSettings = (saved = {}) => {
  const { insecureTls, ...rest } = saved
  return { ...DEFAULT_SETTINGS, ...rest, ...(insecureTls === true ? { verifyTls: false } : {}) }
}

/** The panel's state. Collections and environments live in the API; only the person's choices stay here. */
export const state = {
  view: 'request',
  workspaces: [],
  workspaceId: stored().workspaceId ?? null,
  wsDraft: null,
  wsMenuOpen: false,
  shares: [],
  /** The access passwords just made, by slug. They are shown once and dropped when the dialog closes. */
  issued: {},
  shareOpen: false,
  collections: [],
  collectionId: stored().collectionId ?? null,
  version: null,
  collection: null,
  environments: [],
  environmentId: stored().environmentId ?? '',
  environment: null,
  envDraft: null,
  selected: null,
  /** The key of the request whose name is being edited in the sidebar, or null. */
  renaming: null,
  current: null,
  parents: [],
  tab: 'query',
  responseTab: 'body',
  response: null,
  sending: false,
  settings: migrateSettings(stored().settings),
  docsLanguage: stored().docsLanguage ?? 'curl',
  open: new Set(),
  filter: '',
  sections: { collections: true, environments: true, specs: false, documents: true, ...stored().sections },
  menuOpen: false,
  settingsOpen: false,
  settingsTab: 'general',
  profile: null
}

export const savePrefs = () => {
  try {
    const { workspaceId, collectionId, environmentId, settings, docsLanguage, sections } = state
    localStorage.setItem(
      PREFS,
      JSON.stringify({ workspaceId, collectionId, environmentId, settings, docsLanguage, sections })
    )
  } catch {
    // Storage can be off in a private window; the panel works without it.
  }
}

const toRecord = (variables) => Object.fromEntries((variables ?? []).map((variable) => [variable.key, variable.value]))

/** The variable scopes a request is resolved with: the selected environment wins over the collection's. */
export const scopes = () => ({
  environment: toRecord(state.environment?.variables),
  collection: toRecord(state.collection?.variables)
})

/** What the documentation page may show: no secret value, from the environment or the collection. */
export const publicVariables = () => ({
  ...toRecord(state.collection?.variables?.filter((variable) => !variable.secret)),
  ...toRecord(state.environment?.variables?.filter((variable) => !variable.secret))
})

/** Walks the collection to the request at `path` (indexes), and the auths above it, closest first. */
export const resolveSelection = (collection, path) => {
  const parents = [collection.auth]
  let node = { children: collection.items }
  for (const index of path) {
    node = node.children[index]
    if (node.kind === 'folder') {
      parents.unshift(node.auth)
    }
  }
  return { request: node, parents }
}

/** The path of something in the open workspace: `ws('/collections')`. */
export const ws = (rest) => `/v1/workspaces/${state.workspaceId}${rest}`

export const currentWorkspace = () => state.workspaces.find((item) => item.id === state.workspaceId) ?? null

/** A viewer reads; an editor and an admin also change. The API enforces it, the panel just stops offering it. */
export const canEdit = () => ['editor', 'admin'].includes(currentWorkspace()?.role)
export const canAdmin = () => currentWorkspace()?.role === 'admin'

/** What goes to the proxy with a request, from the settings. Redirects off means none are followed. */
export const sendOptions = () => ({
  timeoutMs: Number(state.settings.timeoutMs),
  maxRedirects: state.settings.followRedirects ? Number(state.settings.maxRedirects) : 0,
  insecureTls: !state.settings.verifyTls
})
