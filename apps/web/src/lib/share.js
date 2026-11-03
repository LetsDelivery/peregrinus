/** The pure parts of sharing documentation: what the dialog edits, and what the API takes. */

export const shareUrl = (origin, slug) => `${origin}/docs/${slug}`

/** Every folder of the collection, with the path down to it, for the "what to publish" choice. */
export const folderOptions = (items, trail = [], names = []) =>
  items.flatMap((item, index) => {
    if (item.kind !== 'folder') {
      return []
    }
    const path = [...trail, index]
    const label = [...names, item.name].join(' / ')
    return [{ value: path.join('.'), label }, ...folderOptions(item.children, path, [...names, item.name])]
  })

const emails = (text) =>
  text
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)

/** A publication as the dialog edits it: lists become text, the folder path becomes one value. */
export const draftFromPublication = (publication) => ({
  slug: publication.slug,
  version: publication.version,
  title: publication.title,
  visibility: publication.visibility,
  peopleText: publication.people.join('\n'),
  folder: publication.folderPath.join('.'),
  environmentId: publication.environmentId ?? '',
  language: publication.language
})

export const newDraft = (title) => ({
  slug: null,
  version: null,
  title,
  visibility: 'company',
  peopleText: '',
  folder: '',
  environmentId: '',
  language: 'curl'
})

/** What the API takes to create or save a publication. */
export const payloadFromDraft = (draft, collectionId) => ({
  collectionId,
  title: draft.title.trim() || 'Documentação',
  visibility: draft.visibility,
  people: draft.visibility === 'people' ? emails(draft.peopleText) : [],
  folderPath: draft.folder === '' ? [] : draft.folder.split('.').map(Number),
  environmentId: draft.environmentId === '' ? null : draft.environmentId,
  language: draft.language
})
