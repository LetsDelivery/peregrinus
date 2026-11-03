import { describe, expect, test } from 'bun:test'

import { escapeHtml, html, raw } from './html.js'

describe('html template', () => {
  test('escapes every interpolated value', () => {
    // Arrange
    const name = '<img src=x onerror=alert(1)> & "q"'

    // Act
    const out = html`<p title="${name}">${name}</p>`

    // Assert
    expect(out.raw).toBe(
      '<p title="&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;">&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;</p>'
    )
  })

  test('keeps markup wrapped in raw() and nested templates, and joins lists', () => {
    // Arrange
    const items = ['a', '<b>'].map((value) => html`<li>${value}</li>`)

    // Act
    const out = html`<ul>${items}</ul>${raw('<hr>')}`

    // Assert
    expect(out.raw).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul><hr>')
  })

  test('renders null and undefined as nothing', () => {
    // Act & Assert
    expect(escapeHtml(null)).toBe('')
    expect(html`${undefined}x`.raw).toBe('x')
  })
})
