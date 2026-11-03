import { describe, expect, test } from 'bun:test'

import { draftFromPublication, folderOptions, newDraft, payloadFromDraft, shareUrl } from './share.js'

const tree = [
  {
    kind: 'folder',
    name: 'Orders',
    children: [
      { kind: 'request', name: 'Get' },
      { kind: 'folder', name: 'Admin', children: [] }
    ]
  },
  { kind: 'request', name: 'Loose' },
  { kind: 'folder', name: 'Users', children: [] }
]

describe('folderOptions', () => {
  test('lists every folder with the path to it and a readable label, and skips requests', () => {
    // Act
    const options = folderOptions(tree)

    // Assert
    expect(options).toEqual([
      { value: '0', label: 'Orders' },
      { value: '0.1', label: 'Orders / Admin' },
      { value: '2', label: 'Users' }
    ])
  })
})

describe('draft and payload', () => {
  test('a new draft is a link for anyone of the company, over the whole collection', () => {
    // Act
    const payload = payloadFromDraft(newDraft('Shop'), 'col-1')

    // Assert
    expect(payload).toEqual({
      collectionId: 'col-1',
      title: 'Shop',
      visibility: 'company',
      people: [],
      folderPath: [],
      environmentId: null,
      language: 'curl'
    })
  })

  test('turns the folder value and the pasted addresses into what the API takes, only for "people"', () => {
    // Arrange
    const draft = {
      ...newDraft('Shop'),
      visibility: 'people',
      folder: '0.1',
      peopleText: 'ana@uselets.com, bob@lets.delivery;\n cris@uselets.com ',
      environmentId: 'env-1'
    }

    // Act
    const payload = payloadFromDraft(draft, 'col-1')
    const other = payloadFromDraft({ ...draft, visibility: 'company' }, 'col-1')

    // Assert
    expect(payload.people).toEqual(['ana@uselets.com', 'bob@lets.delivery', 'cris@uselets.com'])
    expect(payload.folderPath).toEqual([0, 1])
    expect(payload.environmentId).toBe('env-1')
    expect(other.people).toEqual([])
  })

  test('reads a saved publication back into a draft that saves as the same thing', () => {
    // Arrange
    const publication = {
      slug: 's1',
      version: 3,
      collectionId: 'col-1',
      title: 'Shop',
      visibility: 'people',
      people: ['ana@uselets.com'],
      folderPath: [2],
      environmentId: null,
      language: 'python'
    }

    // Act
    const draft = draftFromPublication(publication)
    const { collectionId, ...rest } = publication

    // Assert
    expect(draft).toMatchObject({ slug: 's1', version: 3, folder: '2', environmentId: '' })
    const { slug, version, ...saved } = payloadFromDraft(draft, collectionId)
    expect({ ...saved }).toEqual({
      collectionId,
      title: rest.title,
      visibility: 'people',
      people: rest.people,
      folderPath: rest.folderPath,
      environmentId: null,
      language: 'python'
    })
  })

  test('builds the address from the page origin and the slug', () => {
    // Act & Assert
    expect(shareUrl('https://dev-peregrinus.uselets.com', 'abc_DEF-123')).toBe(
      'https://dev-peregrinus.uselets.com/docs/abc_DEF-123'
    )
  })
})
