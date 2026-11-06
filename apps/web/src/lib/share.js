/** The pure parts of sharing documentation: what the dialog edits, and what the API takes. */

export const shareUrl = (origin, slug) => `${origin}/docs/${slug}`

const emails = (text) =>
  text
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)

// ---- the selection tree ------------------------------------------------------------------------------------

/** The ids of every request below these items, at any depth. */
export const requestIdsUnder = (items) =>
  items.flatMap((item) => (item.kind === 'folder' ? requestIdsUnder(item.children) : item.id ? [item.id] : []))

const stateOf = (ids, selection) => {
  const ticked = ids.filter((id) => selection.has(id)).length
  if (ticked === 0) {
    return 'off'
  }
  return ticked === ids.length ? 'on' : 'mixed'
}

/**
 * The tree as a flat list of rows to draw, each with how far it is indented and whether it is ticked (`on`), not
 * (`off`) or partly (`mixed`, for a folder with some of its requests ticked). A folder without requests has no box.
 */
export const treeRows = (items, selected, depth = 0) => {
  const selection = new Set(selected)
  return items.flatMap((item) => {
    if (item.kind === 'request') {
      return [
        {
          depth,
          kind: 'request',
          id: item.id,
          name: item.name,
          method: item.method,
          state: selection.has(item.id) ? 'on' : 'off'
        }
      ]
    }
    const ids = requestIdsUnder(item.children)
    const own = {
      depth,
      kind: 'folder',
      id: item.id,
      name: item.name,
      state: stateOf(ids, selection),
      empty: ids.length === 0
    }
    return [own, ...treeRows(item.children, selected, depth + 1)]
  })
}

const findNode = (items, id) => {
  for (const item of items) {
    if (item.id === id) {
      return item
    }
    const inside = item.kind === 'folder' ? findNode(item.children, id) : undefined
    if (inside) {
      return inside
    }
  }
  return undefined
}

/**
 * What ticking a box does: a request toggles itself; a folder ticks everything it holds now (or clears it, when all
 * of it was ticked already). What is added to the folder later is not in it until someone ticks it.
 */
export const toggleNode = (items, selected, id) => {
  const node = findNode(items, id)
  if (!node) {
    return [...selected]
  }
  const ids = node.kind === 'folder' ? requestIdsUnder(node.children) : [node.id]
  const selection = new Set(selected)
  const allOn = ids.length > 0 && ids.every((one) => selection.has(one))
  for (const one of ids) {
    if (allOn) {
      selection.delete(one)
    } else {
      selection.add(one)
    }
  }
  return [...selection]
}

// ---- expiry and dates --------------------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0')

/** `05/11/2026 12:00 UTC`: the server keeps and compares every time in UTC, so the panel says the zone. */
export const formatUtc = (iso) => {
  const at = new Date(iso)
  const day = `${two(at.getUTCDate())}/${two(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`
  return `${day} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`
}

/** The date only, `05/11/2026`. */
export const formatUtcDay = (iso) => formatUtc(iso).slice(0, 10)

/** Whole days until the page stops opening, rounded up; null when it never does. Zero or less: it already has. */
export const daysLeft = (expiresAt, now = new Date()) =>
  expiresAt === null ? null : Math.ceil((Date.parse(expiresAt) - now.getTime()) / 86_400_000)

/** How soon an expiry is announced in the panel. */
export const WARN_DAYS = 7

/** What the API takes for the validity the person picked; nothing when they left the current one. */
export const expiryPayload = (draft) => {
  switch (draft.expiryKind) {
    case '7':
    case '30':
    case '90':
      return { kind: 'days', days: Number(draft.expiryKind) }
    case 'date':
      return { kind: 'date', date: draft.expiryDate }
    case 'never':
      return { kind: 'never' }
    default:
      return undefined
  }
}

// ---- the draft ---------------------------------------------------------------------------------------------

/** A publication as the dialog edits it: lists become text, and what the page shows is the whole or a selection. */
export const draftFromPublication = (publication) => ({
  slug: publication.slug,
  version: publication.version,
  title: publication.title,
  visibility: publication.visibility,
  peopleText: publication.people.join('\n'),
  mode: publication.selection === null ? 'whole' : 'selection',
  selection: publication.selection ?? [],
  environmentId: publication.environmentId ?? '',
  language: publication.language,
  expiresAt: publication.expiresAt,
  expiryKind: 'keep',
  expiryDate: '',
  adminOnly: publication.adminOnly,
  passwordSetAt: publication.passwordSetAt,
  lockedUntil: publication.lockedUntil,
  lastAccessAt: publication.lastAccessAt,
  health: publication.health
})

/** A new link: for the company, over the whole collection, for 30 days. */
export const newDraft = (title) => ({
  slug: null,
  version: null,
  title,
  visibility: 'company',
  peopleText: '',
  mode: 'whole',
  selection: [],
  environmentId: '',
  language: 'curl',
  expiresAt: null,
  expiryKind: '30',
  expiryDate: '',
  adminOnly: false,
  passwordSetAt: null,
  lockedUntil: null,
  lastAccessAt: null,
  health: null
})

/** What the API takes to create or save a publication. `expiry` is left out when the current one is kept. */
export const payloadFromDraft = (draft, collectionId) => {
  const expiry = expiryPayload(draft)
  return {
    collectionId,
    title: draft.title.trim() || 'Documentação',
    visibility: draft.visibility,
    people: draft.visibility === 'people' ? emails(draft.peopleText) : [],
    selection: draft.mode === 'selection' ? [...draft.selection] : null,
    environmentId: draft.environmentId === '' ? null : draft.environmentId,
    language: draft.language,
    ...(expiry ? { expiry } : {})
  }
}
