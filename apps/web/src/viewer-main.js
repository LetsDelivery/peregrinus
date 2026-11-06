import { LANGUAGES, renderDocumentation, renderStandalone } from '@postmano/docs'

import { ApiError, api } from './lib/api.js'
import { isLocal, logout, profile } from './lib/auth.js'
import { html, mount, raw } from './lib/html.js'
import { locale, setLocale, t } from './lib/i18n.js'
import { savePrefs, state } from './lib/store.js'
import { applyTheme, isNight } from './lib/theme.js'

/**
 * The page at `/docs/<slug>`: a published collection on its own, with no sidebar and no editor, as an API's
 * Swagger page. The server decides whether this person may open it; here there is only the page, or why not.
 */
const view = { page: null, failure: null, who: null, gate: null }

const $ = (selector) => document.querySelector(selector)

const shell = html`<header class="top">
    <div class="top-left"><img class="logo" src="/wordmark-dark.svg" alt="postmano" height="36" /><strong id="viewer-title"></strong></div>
    <div class="top-right" id="viewer-tools"></div>
  </header>
  <main class="viewer" id="viewer-body"></main>`

const tools = () => {
  const night = isNight(state.settings.theme)
  return html`${
    view.page
      ? html`<select data-viewer-language aria-label="${t('Linguagem dos exemplos')}">${LANGUAGES.map((l) => html`<option value="${l.id}" ${l.id === state.docsLanguage ? 'selected' : ''}>${l.label}</option>`)}</select>
        <button class="ghost" data-viewer-export>${t('Exportar HTML')}</button>`
      : ''
  }
    <button class="icon-btn theme-toggle" data-viewer-theme aria-label="${night ? t('Modo claro') : t('Modo escuro')}" title="${night ? t('Mudar para o modo claro') : t('Mudar para o modo escuro')}">${night ? '☀️' : '🌙'}</button>
    ${view.who && !view.who.local ? html`<span class="who">${view.who.email}</span><button class="ghost" data-viewer-logout>${t('Sair')}</button>` : ''}`
}

const FAILURES = {
  forbidden: () => t('Você não tem acesso a esta documentação. Peça a quem a publicou para liberar o seu e-mail.'),
  not_found: () => t('Este link não existe ou foi removido.'),
  expired: () => t('Este acesso expirou. Peça um novo ao time.')
}

/** The token a right password gave lives in this tab only: it goes when the tab closes. */
const tokenKey = (slug) => `pg:docs-token:${slug}`
const savedToken = (slug) => {
  try {
    return sessionStorage.getItem(tokenKey(slug))
  } catch {
    return null
  }
}
const keepToken = (slug, token) => {
  try {
    sessionStorage.setItem(tokenKey(slug), token)
  } catch {
    // Without storage the person types the password again on the next load: the page still opens now.
  }
}
const dropToken = (slug) => {
  try {
    sessionStorage.removeItem(tokenKey(slug))
  } catch {
    // Nothing was kept, so there is nothing to drop.
  }
}

const time = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

/** What a wrong password or a lock says. From the third wrong one the person is told what comes next. */
const gateMessage = (error) => {
  if (error.code === 'locked') {
    // A lock that came from a gateway, not from the API, has no time to tell.
    return error.data.lockedUntil
      ? t('Acesso bloqueado depois de muitas tentativas erradas. Tente de novo às {time}.', {
          time: time(error.data.lockedUntil)
        })
      : t('Acesso bloqueado depois de muitas tentativas erradas.')
  }
  const left = error.data.attemptsLeft
  return left !== undefined && left <= 2
    ? t('Senha incorreta. Mais {left} tentativa(s) e o acesso é bloqueado por 15 minutos.', { left })
    : t('Senha incorreta.')
}

const gate = () =>
  html`<div class="viewer-message gate">
    <h2>${t('Esta documentação pede a senha de acesso')}</h2>
    <form id="gate-form" class="gate-form">
      <input type="password" name="password" autocomplete="off" aria-label="${t('Senha de acesso')}" />
      <button class="primary" type="submit">${t('Entrar')}</button>
    </form>
    ${view.gate.message ? html`<p class="error" role="alert">${view.gate.message}</p>` : ''}
  </div>`

const body = () => {
  if (view.gate) {
    return gate()
  }
  if (view.failure) {
    const message = (FAILURES[view.failure.code] ?? (() => t('Não foi possível abrir a documentação.')))()
    return html`<div class="viewer-message"><p>${message}</p>${view.who && !view.who.local && view.failure.code === 'forbidden' ? html`<p class="hint">${t('Conta em uso: {email}', { email: view.who.email })}</p><button class="ghost" data-viewer-logout>${t('Sair e entrar com outra conta')}</button>` : ''}</div>`
  }
  if (!view.page) {
    return html`<p class="empty">${t('Carregando…')}</p>`
  }
  return html`<div class="docs-frame">${raw(renderDocumentation(view.page.collection, options()))}</div>`
}

const options = () => ({ variables: view.page.variables, language: state.docsLanguage, locale: locale() })

const draw = () => {
  setLocale(state.settings.language)
  applyTheme(state.settings.theme)
  document.title = view.page ? `${view.page.title} · postmano` : 'postmano'
  $('#viewer-title').textContent = view.page?.title ?? ''
  mount($('#viewer-tools'), tools())
  mount($('#viewer-body'), body())
}

const download = () => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([renderStandalone(view.page.collection, options())], { type: 'text/html' }))
  link.download = `${view.page.title.replace(/[^\w-]+/g, '-')}.html`
  link.click()
  URL.revokeObjectURL(link.href)
}

const onClick = (event) => {
  const data = event.target.closest('[data-viewer-export],[data-viewer-theme],[data-viewer-logout]')?.dataset
  if (data?.viewerExport !== undefined) {
    download()
  } else if (data?.viewerTheme !== undefined) {
    state.settings.theme = isNight(state.settings.theme) ? 'light' : 'dark'
    savePrefs()
    draw()
  } else if (data?.viewerLogout !== undefined) {
    logout()
  }
}

const onChange = (event) => {
  if (event.target.dataset.viewerLanguage !== undefined) {
    state.docsLanguage = event.target.value
    savePrefs()
    draw()
  }
}

const asApiError = (error) => (error instanceof ApiError ? error : new ApiError('unknown'))

/** Opens the page, with the token of this tab if there is one. A page that asks for a password shows its gate. */
const load = async (slug, token = savedToken(slug)) => {
  try {
    view.page = await api.get(`/v1/docs/${slug}`, token ? { 'x-docs-token': token } : {})
    state.docsLanguage = view.page.language
    Object.assign(view, { failure: null, gate: null })
  } catch (error) {
    const failure = asApiError(error)
    if (failure.code === 'password_required') {
      dropToken(slug)
      view.gate = { slug, message: null }
    } else {
      view.failure = failure
    }
  }
}

/** The password goes to the API; a right one gives a token and the page loads, a wrong one says so and stays. */
const submitGate = async (event) => {
  if (!event.target.matches?.('#gate-form')) {
    return
  }
  event.preventDefault()
  const { slug } = view.gate
  try {
    const { token } = await api.post(`/v1/docs/${slug}/access`, { password: event.target.elements.password.value })
    keepToken(slug, token)
    // The token goes straight in: with the tab's storage blocked, reading it back would show the gate again.
    await load(slug, token)
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.error('The password could not be sent', error)
      view.gate.message = t('Não foi possível falar com o servidor. Tente de novo.')
    } else if (error.code === 'invalid_password' || error.code === 'locked') {
      view.gate.message = gateMessage(error)
    } else {
      Object.assign(view, { gate: null, failure: error })
    }
  }
  draw()
  $('#gate-form input')?.focus()
}

export const startViewer = async (slug) => {
  mount($('#app'), shell)
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  document.addEventListener('submit', submitGate)
  view.who = await profile().catch(() => null)
  draw()
  await load(slug)
  draw()
  $('#gate-form input')?.focus()
  if (isLocal && view.page) {
    view.who = await profile()
  }
}
