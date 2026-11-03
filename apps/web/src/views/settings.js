import { LANGUAGES } from '@peregrinus/docs'

import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'
import { roleLabel } from './topbar.js'

const tabs = () => [
  ['general', t('Geral')],
  ['shortcuts', t('Atalhos')],
  ['themes', t('Temas')],
  ['data', t('Dados')],
  ['workspace', 'Workspace'],
  ['about', t('Sobre')]
]

const radio = (name, value, label, current, hint = '') =>
  html`<label class="choice"><input type="radio" name="${name}" value="${value}" data-setting="${name}" ${current === value ? 'checked' : ''} /> ${label} ${hint ? html`<small>${hint}</small>` : ''}</label>`

const numberField = (name, label, settings, { min, max, step, hint = '', disabled = false }) =>
  html`<label class="field">${label}
    <input type="number" data-setting="${name}" value="${settings[name]}" min="${min}" max="${max}" step="${step}" ${disabled ? 'disabled' : ''} />
    ${hint ? html`<small>${hint}</small>` : ''}
  </label>`

const general = (state) => {
  const s = state.settings
  return html`<h3>${t('Requisições')}</h3>
  <fieldset class="settings"><legend>${t('Enviar por padrão')}</legend>
    ${radio('via', 'server', t('Servidor'), s.via, t('(sem CORS; não alcança localhost nem rede interna)'))}
    ${radio('via', 'browser', t('Meu browser'), s.via, t('(para localhost e rede interna; a API precisa liberar CORS)'))}
  </fieldset>
  ${numberField('timeoutMs', t('Tempo limite da requisição (ms)'), s, { min: 1000, max: 25000, step: 1000, hint: t('Entre 1000 e 25000. Vale só para o envio pelo servidor.') })}
  <label class="check"><input type="checkbox" data-setting="followRedirects" ${s.followRedirects ? 'checked' : ''} /> ${t('Seguir redirecionamentos')}</label>
  ${numberField('maxRedirects', t('Máximo de redirecionamentos'), s, { min: 0, max: 10, step: 1, disabled: !s.followRedirects })}
  <label class="check"><input type="checkbox" data-setting="verifyTls" ${s.verifyTls ? 'checked' : ''} /> ${t('Verificar certificado SSL')}</label>
  ${s.verifyTls ? '' : html`<p class="warn-box">${t('Atenção: sem verificar o certificado, quem estiver no meio do caminho pode ler e alterar esta chamada. Use só em homologação.')}</p>`}
  <h3>${t('Idioma')}</h3>
  <fieldset class="settings"><legend>${t('Idioma do painel')}</legend>
    ${radio('language', 'auto', t('Automático'), s.language, t('(segue o idioma do navegador; padrão: português)'))}
    ${radio('language', 'pt', 'Português (Brasil)', s.language)}
    ${radio('language', 'en', 'English', s.language)}
  </fieldset>
  <h3>${t('Documentação')}</h3>
  <label class="field">${t('Linguagem dos exemplos')}
    <select data-docs-language>${LANGUAGES.map((language) => html`<option value="${language.id}" ${language.id === state.docsLanguage ? 'selected' : ''}>${language.label}</option>`)}</select>
  </label>`
}

const SHORTCUTS = [
  ['Ctrl/⌘ + Enter', 'Enviar a requisição'],
  ['Ctrl/⌘ + S', 'Salvar a coleção'],
  ['Ctrl/⌘ + K', 'Filtrar a lista da barra lateral'],
  ['Esc', 'Fechar o menu ou a janela']
]

const shortcuts = (state) => html`<h3>${t('Atalhos de teclado')}</h3>
  <label class="check"><input type="checkbox" data-setting="shortcuts" ${state.settings.shortcuts ? 'checked' : ''} /> ${t('Ativar os atalhos de teclado')}</label>
  <dl class="about">${SHORTCUTS.map(([keys, action]) => html`<dt><kbd>${keys}</kbd></dt><dd>${t(action)}</dd>`)}</dl>`

const themes = (state) => html`<h3>${t('Tema')}</h3>
  <fieldset class="settings"><legend>${t('Aparência')}</legend>
    ${radio('theme', 'system', t('Seguir o sistema'), state.settings.theme)}
    ${radio('theme', 'light', t('Claro'), state.settings.theme)}
    ${radio('theme', 'dark', t('Escuro'), state.settings.theme)}
  </fieldset>`

const data = (state) => html`<h3>${t('Dados')}</h3>
  <p class="hint">${t('Leve suas coleções para dentro e para fora do peregrinus.')}</p>
  <div class="actions">
    <button class="ghost" data-action="pick-import">${t('Importar coleção do Postman')}</button>
    <button class="ghost" data-action="export-collection" ${state.collection ? '' : 'disabled'}>${t('Exportar a coleção aberta (JSON)')}</button>
  </div>
  <p class="hint">${t('O JSON exportado é o do peregrinus. Para levar de volta ao Postman, use a exportação do Postman.')}</p>`

const about = (state) => html`<h3>peregrinus</h3>
  <dl class="about">
    <dt>${t('Conta')}</dt><dd>${state.profile?.email ?? ''}</dd>
    <dt>${t('Acesso')}</dt><dd>${state.profile?.local ? t('Modo local: sem login. Em produção, só contas Google da empresa.') : t('Conta Google da empresa')}</dd>
    <dt>${t('Versão')}</dt><dd>0.1.0</dd>
  </dl>`

const ROLES = ['admin', 'editor', 'viewer']

const roleSelect = (path, current, disabled) =>
  html`<select data-ws-bind="${path}" ${disabled ? 'disabled' : ''}>${ROLES.map((id) => html`<option value="${id}" ${id === current ? 'selected' : ''}>${roleLabel(id)}</option>`)}</select>`

const memberRow = (member, index, admin) => html`<div class="kv-row member-row">
  <input type="email" placeholder="nome@uselets.com" value="${member.email}" data-ws-bind="members.${index}.email" ${admin ? '' : 'disabled'} />
  ${roleSelect(`members.${index}.role`, member.role, !admin)}
  ${admin ? html`<button class="icon" data-action="remove-member" data-index="${index}" aria-label="${t('Remover membro')}">×</button>` : ''}
</div>`

const members = (draft, admin) =>
  draft.personal
    ? html`<p class="hint">${t('Este é o seu workspace pessoal: só você enxerga. Para trabalhar com outras pessoas, crie um workspace de time.')}</p>`
    : html`<h4>${t('Membros')}</h4>
      <div class="kv">${draft.members.map((member, index) => memberRow(member, index, admin))}
        ${admin ? html`<button class="ghost" data-action="add-member">${t('+ Adicionar membro')}</button>` : html`<p class="hint">${t('Só administradores veem e alteram os membros.')}</p>`}
      </div>
      <p class="hint">${t('Administrador gerencia membros e exclui o workspace. Editor altera coleções e ambientes. Leitor só lê (e não vê valores secretos). Só e-mails da empresa.')}</p>`

const workspaceActions = (draft, admin) => {
  if (!admin) {
    return html`<p class="hint">${t('Você é {role} neste workspace.', { role: roleLabel(draft.role).toLowerCase() })}</p>`
  }
  return draft.personal
    ? ''
    : html`<div class="actions">
        <button class="primary" data-action="save-workspace">${t('Salvar workspace')}</button>
        <button class="ghost" data-action="delete-workspace">${t('Excluir workspace')}</button>
      </div>`
}

const workspaceTab = (state) => {
  const draft = state.wsDraft
  if (!draft) {
    return html`<p class="empty">${t('Carregando…')}</p>`
  }
  const admin = draft.role === 'admin'
  return html`<h3>Workspace</h3>
    <label class="field">${t('Nome')} <input data-ws-bind="name" value="${draft.personal ? t('Meu workspace') : draft.name}" ${admin && !draft.personal ? '' : 'disabled'} /></label>
    ${members(draft, admin)}
    ${workspaceActions(draft, admin)}`
}

const BODY = { general, shortcuts, themes, data, workspace: workspaceTab, about }

/** The settings dialog: tabs on the left, the chosen page on the right, as in Postman. */
export const settings = (state) => {
  if (!state.settingsOpen) {
    return ''
  }
  return html`<div class="backdrop"><div class="dialog" role="dialog" aria-label="${t('Configurações')}">
    <nav class="dialog-tabs">
      ${tabs().map(([id, label]) => html`<button class="${state.settingsTab === id ? 'on' : ''}" data-settings-tab="${id}">${label}</button>`)}
    </nav>
    <div class="dialog-body">
      <button class="icon close" data-action="close-settings" aria-label="${t('Fechar')}">×</button>
      ${BODY[state.settingsTab](state)}
    </div>
  </div></div>`
}
