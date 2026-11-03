import { escapeHtml } from './escape.js'

/**
 * A small Markdown renderer for the descriptions in a collection. It escapes everything first, so there is
 * no way to put HTML in, and it only knows what a description needs: headings, paragraphs, lists, tables,
 * fenced code, and inline code, bold, italic and links. Links go only to http, https, mailto, or the same page.
 */
/** Marks where a code span was lifted out; a private-use character, so it cannot be in the text. */
const HOLD = '\uE000'

const SAFE_LINK = /^(https?:\/\/|mailto:|#|\/)/i

const link = (_match: string, text: string, href: string): string =>
  SAFE_LINK.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text

/** Inline marks on text that is already escaped. Code spans are lifted out first so their content stays literal. */
export const renderInline = (escaped: string): string => {
  const codes: string[] = []
  const lifted = escaped.replace(
    /`([^`]+)`/g,
    (_match, code: string) => `${HOLD}${codes.push(`<code>${code}</code>`) - 1}${HOLD}`
  )
  return lifted
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, link)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_match, at: string) => codes[Number(at)] ?? '')
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

const isTableSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

const table = (lines: string[]): string => {
  const [head = '', , ...body] = lines
  const row = (line: string, tag: 'th' | 'td') =>
    `<tr>${cells(line)
      .map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`)
      .join('')}</tr>`
  return `<table><thead>${row(head, 'th')}</thead><tbody>${body.map((line) => row(line, 'td')).join('')}</tbody></table>`
}

const list = (lines: string[], ordered: boolean): string => {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>${lines.map((line) => `<li>${renderInline(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))}</li>`).join('')}</${tag}>`
}

type Block = { kind: 'code' | 'table' | 'ul' | 'ol' | 'heading' | 'paragraph'; lines: string[] }

const startOf = (line: string, next: string | undefined): Block['kind'] => {
  if (/^```/.test(line)) {
    return 'code'
  }
  if (/^#{1,6}\s/.test(line)) {
    return 'heading'
  }
  if (line.includes('|') && next !== undefined && isTableSeparator(next)) {
    return 'table'
  }
  if (/^\s*[-*+]\s+/.test(line)) {
    return 'ul'
  }
  return /^\s*\d+\.\s+/.test(line) ? 'ol' : 'paragraph'
}

const continues = (kind: Block['kind'], line: string): boolean => {
  switch (kind) {
    case 'table':
      return line.includes('|')
    case 'ul':
      return /^\s*[-*+]\s+/.test(line)
    case 'ol':
      return /^\s*\d+\.\s+/.test(line)
    case 'paragraph':
      return line.trim() !== '' && !/^(```|#{1,6}\s)/.test(line)
    default:
      return false
  }
}

const takeCode = (lines: string[], at: number): { block: Block; next: number } => {
  const content: string[] = []
  let next = at + 1
  while (next < lines.length && !/^```/.test(lines[next] ?? '')) {
    content.push(lines[next] ?? '')
    next += 1
  }
  return { block: { kind: 'code', lines: [lines[at] ?? '', ...content] }, next: next + 1 }
}

const takeRun = (lines: string[], at: number, kind: Block['kind']): { block: Block; next: number } => {
  const run = [lines[at] ?? '']
  let next = at + 1
  while (kind !== 'heading' && next < lines.length && continues(kind, lines[next] ?? '')) {
    run.push(lines[next] ?? '')
    next += 1
  }
  return { block: { kind, lines: run }, next }
}

const blocksOf = (lines: string[]): Block[] => {
  const blocks: Block[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (line.trim() === '') {
      at += 1
      continue
    }
    const kind = startOf(line, lines[at + 1])
    const taken = kind === 'code' ? takeCode(lines, at) : takeRun(lines, at, kind)
    blocks.push(taken.block)
    at = taken.next
  }
  return blocks
}

const renderBlock = ({ kind, lines }: Block): string => {
  switch (kind) {
    case 'code':
      return `<pre><code>${lines.slice(1).join('\n')}</code></pre>`
    case 'heading': {
      const level = Math.min(6, (/^#+/.exec(lines[0] ?? '')?.[0].length ?? 1) + 2)
      return `<h${level}>${renderInline((lines[0] ?? '').replace(/^#+\s+/, ''))}</h${level}>`
    }
    case 'table':
      return table(lines)
    case 'ul':
      return list(lines, false)
    case 'ol':
      return list(lines, true)
    default:
      return `<p>${renderInline(lines.join(' '))}</p>`
  }
}

/** Headings start at `h3`, below the request's own title. */
export const renderMarkdown = (source: string | undefined): string =>
  source
    ? blocksOf(escapeHtml(source.replaceAll('\r\n', '\n')).split('\n'))
        .map(renderBlock)
        .join('\n')
    : ''
