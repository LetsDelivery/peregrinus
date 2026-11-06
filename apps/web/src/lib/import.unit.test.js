import { describe, expect, test } from 'bun:test'

import { importMessage } from './import.js'

describe('the message after an import', () => {
  test('counts what came in by kind', () => {
    // Act
    const message = importMessage(
      [
        { kind: 'collection', warnings: [] },
        { kind: 'environment', warnings: [] },
        { kind: 'environment', warnings: [] }
      ],
      []
    )

    // Assert
    expect(message).toBe('Importado: 1 coleção(ões), 2 ambiente(s).')
  })

  test('adds the first warning and the first failure, with their counts', () => {
    // Act
    const message = importMessage(
      [{ kind: 'collection', warnings: [{ message: 'a' }, { message: 'b' }] }],
      [
        { name: 'archive.json', message: 'x' },
        { name: 'other.json', message: 'y' }
      ]
    )

    // Assert
    expect(message).toBe('Importado: 1 coleção(ões). 2 aviso(s): a 2 arquivo(s) não importado(s): archive.json (x)')
  })

  test('says nothing came in when every file failed', () => {
    // Act
    const message = importMessage([], [{ name: 'a.json', message: 'bad' }])

    // Assert
    expect(message).toBe('Nada foi importado. 1 arquivo(s) não importado(s): a.json (bad)')
  })

  test('counts the files of a zip that were skipped, apart from the failures', () => {
    // Act
    const message = importMessage([{ kind: 'environment', warnings: [] }], [], 1)

    // Assert
    expect(message).toBe('Importado: 1 ambiente(s). 1 arquivo(s) do .zip ignorado(s): não são coleção nem ambiente.')
  })
})
