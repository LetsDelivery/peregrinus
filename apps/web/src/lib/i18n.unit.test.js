import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EN } from './en.js'
import { resolveLocale, setLocale, t } from './i18n.js'

const SRC = join(import.meta.dir, '..')

/** Every text passed to `t('…')` in the panel's source, whatever the line breaks around it. */
const usedKeys = () => {
  const files = [
    ...readdirSync(join(SRC, 'views')).map((name) => join(SRC, 'views', name)),
    join(SRC, 'main.js'),
    join(SRC, 'viewer-main.js'),
    join(SRC, 'lib', 'api.js')
  ].filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'))
  const keys = new Set()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      keys.add((match[1] ?? '').replaceAll("\\'", "'"))
    }
  }
  return [...keys]
}

afterEach(() => setLocale('pt'))

describe('resolveLocale', () => {
  test('follows the first browser language the panel has, and falls back to Portuguese', () => {
    // Act & Assert
    expect(resolveLocale('auto', ['en-US', 'pt-BR'])).toBe('en')
    expect(resolveLocale('auto', ['pt-BR', 'en-US'])).toBe('pt')
    expect(resolveLocale('auto', ['fr-FR', 'en-GB'])).toBe('en')
    expect(resolveLocale('auto', ['fr-FR', 'de'])).toBe('pt')
    expect(resolveLocale('auto', [])).toBe('pt')
  })

  test('a language the person chose wins over the browser', () => {
    // Act & Assert
    expect(resolveLocale('pt', ['en-US'])).toBe('en' === resolveLocale('pt', ['en-US']) ? 'pt' : 'pt')
    expect(resolveLocale('en', ['pt-BR'])).toBe('en')
    expect(resolveLocale('xx', ['en-US'])).toBe('en')
  })
})

describe('t', () => {
  test('returns the Portuguese text, and fills {values}, when the language is Portuguese', () => {
    // Arrange
    setLocale('pt')

    // Act & Assert
    expect(t('Salvar')).toBe('Salvar')
    expect(t('Ambiente "{name}" em uso.', { name: 'Dev' })).toBe('Ambiente "Dev" em uso.')
  })

  test('returns the English text, and fills {values}, when the language is English', () => {
    // Arrange
    setLocale('en')

    // Act & Assert
    expect(t('Salvar')).toBe('Save')
    expect(t('Ambiente "{name}" em uso.', { name: 'Dev' })).toBe('Environment "Dev" in use.')
  })

  test('shows the Portuguese text for a key that has no translation, and keeps unknown {values}', () => {
    // Arrange
    setLocale('en')

    // Act & Assert
    expect(t('Texto sem tradução {x}')).toBe('Texto sem tradução {x}')
  })
})

describe('the English dictionary', () => {
  test('has an entry for every text the panel passes to t()', () => {
    // Arrange
    const missing = usedKeys().filter((key) => !(key in EN))

    // Act & Assert
    expect(missing).toEqual([])
  })

  test('keeps the {values} of each text, so a translation cannot lose one', () => {
    // Arrange
    const values = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

    // Act
    const broken = Object.entries(EN).filter(([pt, en]) => values(pt).join() !== values(en).join())

    // Assert
    expect(broken).toEqual([])
  })

  test('has no entry that no screen uses', () => {
    // Arrange
    const used = new Set([
      ...usedKeys(),
      'Enviar a requisição',
      'Salvar a coleção',
      'Filtrar a lista da barra lateral',
      'Fechar o menu ou a janela'
    ])

    // Act
    const unused = Object.keys(EN).filter((key) => !used.has(key))

    // Assert
    expect(unused).toEqual([])
  })
})
