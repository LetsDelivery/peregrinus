/**
 * Markup only through this template: every interpolated value is escaped, except what `raw()` wraps,
 * which is for markup the app ships itself. Arrays are joined, so a list is a `.map(...)`.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char])

class Markup {
  constructor(markup) {
    this.raw = String(markup)
  }
}

export const raw = (markup) => new Markup(markup)

const render = (value) => {
  if (Array.isArray(value)) {
    return value.map(render).join('')
  }
  return value instanceof Markup ? value.raw : escapeHtml(value)
}

export const html = (strings, ...values) =>
  raw(strings.reduce((out, chunk, index) => out + chunk + (index < values.length ? render(values[index]) : ''), ''))

export const mount = (element, template) => {
  element.innerHTML = template.raw
}
