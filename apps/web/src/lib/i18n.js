import { EN } from './en.js'

const SUPPORTED = ['pt', 'en']

/**
 * The language the panel speaks. `auto` follows the browser's language list, in order, and takes the first one
 * the panel has; if it has none, Portuguese. A person can also pin one in the settings.
 */
export const resolveLocale = (preference, languages = []) => {
  if (SUPPORTED.includes(preference)) {
    return preference
  }
  for (const tag of languages) {
    const base = String(tag).toLowerCase().split('-')[0]
    if (SUPPORTED.includes(base)) {
      return base
    }
  }
  return 'pt'
}

let current = 'pt'

export const setLocale = (preference) => {
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  current = resolveLocale(preference, languages)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current === 'en' ? 'en' : 'pt-BR'
  }
  return current
}

export const locale = () => current

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))

/**
 * The text in the current language. The key is the Portuguese text, which is also what shows when there is no
 * translation. `{name}` marks a value to fill in: `t('Olá, {name}', { name })`.
 */
export const t = (text, vars = {}) => fill(current === 'en' ? (EN[text] ?? text) : text, vars)
