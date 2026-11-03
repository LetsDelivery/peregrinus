import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { currentWorkspace } from '../lib/store.js'
import { isNight } from '../lib/theme.js'

const initials = (profile) =>
  (profile?.name || profile?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')

const envOptions = (state) =>
  [{ id: '', name: t('Sem ambiente') }, ...state.environments].map(
    (env) => html`<option value="${env.id}" ${env.id === state.environmentId ? 'selected' : ''}>${env.name}</option>`
  )

const menu = (profile) => html`<div class="menu" role="menu">
  <div class="menu-head">
    <strong>${profile.name}</strong>
    <span>${profile.email}</span>
    ${profile.local ? html`<small class="pill">${t('Modo local: sem login do Google')}</small>` : ''}
  </div>
  <button role="menuitem" data-action="open-settings">${t('Configurações')}</button>
  ${profile.local ? '' : html`<button role="menuitem" data-action="logout">${t('Sair')}</button>`}
</div>`

const themeButton = (state) => {
  const night = isNight(state.settings.theme)
  return html`<button class="icon-btn theme-toggle" data-action="toggle-theme" title="${night ? t('Mudar para o modo claro') : t('Mudar para o modo escuro')}" aria-label="${night ? t('Modo claro') : t('Modo escuro')}">${night ? '☀️' : '🌙'}</button>`
}

/** The top right: the environment in use, and the profile with its menu (sign-in, settings, sign out). */
export const topbar = (state) => {
  const profile = state.profile ?? { name: '', email: '', local: true }
  return html`<select data-env-select aria-label="${t('Ambiente')}">${envOptions(state)}</select>
    ${themeButton(state)}
    <div class="profile">
      <button class="avatar-button" data-action="toggle-menu" aria-haspopup="menu" aria-expanded="${state.menuOpen}" title="${profile.email}">
        <span class="avatar">${initials(profile)}</span><span class="caret">▾</span>
      </button>
      ${state.menuOpen ? menu(profile) : ''}
    </div>`
}

export const roleLabel = (role) => ({ admin: t('Administrador'), editor: t('Editor'), viewer: t('Leitor') })[role]

/** The personal workspace is made by the server with a Portuguese name; it is shown in the person's language. */
export const workspaceName = (workspace) => (workspace.personal ? t('Meu workspace') : workspace.name)

const workspaceItem = (item, state) => html`<button role="menuitem" data-switch-workspace="${item.id}">
  <span>${item.id === state.workspaceId ? '✓ ' : ''}${workspaceName(item)}</span><small>${item.personal ? t('pessoal') : roleLabel(item.role)}</small>
</button>`

const workspaceMenu = (state) => html`<div class="menu ws-menu" role="menu">
  <div class="menu-head"><small>${t('Seus workspaces')}</small></div>
  ${state.workspaces.map((item) => workspaceItem(item, state))}
  <hr />
  <button role="menuitem" data-action="create-workspace">${t('+ Criar workspace')}</button>
  <button role="menuitem" data-action="manage-workspace">${t('Gerenciar este workspace')}</button>
</div>`

/** Next to the logo: the workspace in use and the others the person can go to, as in Postman. */
export const workspaceSwitcher = (state) => html`<div class="ws-switch">
  <button class="ws-button" data-action="toggle-ws-menu" aria-haspopup="menu" aria-expanded="${state.wsMenuOpen}" title="${t('Trocar de workspace')}">
    <span class="ws-name">${currentWorkspace() ? workspaceName(currentWorkspace()) : 'Workspace'}</span><span class="caret">▾</span>
  </button>
  ${state.wsMenuOpen ? workspaceMenu(state) : ''}
</div>`
