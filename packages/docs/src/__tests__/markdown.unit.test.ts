import { describe, expect, test } from 'bun:test'

import { renderMarkdown } from '../markdown.js'

describe('renderMarkdown', () => {
  test('renders paragraphs, bold, italic and inline code', () => {
    // Arrange
    const source = 'Returns **the order** and *its* `items`.'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).toBe('<p>Returns <strong>the order</strong> and <em>its</em> <code>items</code>.</p>')
  })

  test('shifts headings below the request title and renders lists and ordered lists', () => {
    // Arrange
    const source = '# Title\n\n- one\n- two\n\n1. first\n2. second'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).toContain('<h3>Title</h3>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
  })

  test('renders fenced code literally, without reading markdown inside it', () => {
    // Arrange
    const source = '```\n{"a": "**not bold**"}\n```'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).toBe('<pre><code>{&quot;a&quot;: &quot;**not bold**&quot;}</code></pre>')
  })

  test('renders a table with a header row', () => {
    // Arrange
    const source = '| Name | Type |\n| --- | --- |\n| id | `uuid` |'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).toBe(
      '<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody><tr><td>id</td><td><code>uuid</code></td></tr></tbody></table>'
    )
  })

  test('escapes any HTML a description holds', () => {
    // Arrange
    const source = '<script>alert(1)</script> <img src=x onerror=alert(1)>'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  test('links only to http, https, mailto and the same page; any other scheme is plain text', () => {
    // Arrange
    const source =
      '[ok](https://example.com/a?b=1&c=2) [anchor](#n-0) [bad](javascript:alert(1)) [data](data:text/html,x)'

    // Act
    const html = renderMarkdown(source)

    // Assert
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a>'
    )
    expect(html).toContain('<a href="#n-0"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:text')
    expect(html).toContain('bad')
  })

  test('returns an empty string for no description', () => {
    // Act & Assert
    expect(renderMarkdown(undefined)).toBe('')
    expect(renderMarkdown('')).toBe('')
  })
})
