import { html } from '../lib/html.js'
import { t } from '../lib/i18n.js'

const variableRows = (variables) => html`<div class="kv">
  ${variables.map(
    (variable, index) => html`<div class="kv-row env-row">
      <input placeholder="${t('chave')}" value="${variable.key}" data-env-bind="variables.${index}.key" />
      <input type="${variable.secret ? 'password' : 'text'}" placeholder="${t('valor')}" value="${variable.value}" data-env-bind="variables.${index}.value" autocomplete="off" />
      <label class="secret"><input type="checkbox" data-env-bind="variables.${index}.secret" ${variable.secret ? 'checked' : ''} /> ${t('secreta')}</label>
      <button class="icon" aria-label="${t('Remover variável')}" data-action="remove-variable" data-index="${index}">×</button>
    </div>`
  )}
  <button class="ghost" data-action="add-variable">${t('+ Adicionar variável')}</button>
</div>`

export const environments = (state) => {
  const draft = state.envDraft
  if (!draft) {
    return html`<p class="empty">${t('Escolha um ambiente na barra lateral, ou crie um novo com +.')}</p>`
  }
  return html`<div class="env-edit">
    <input placeholder="${t('Nome do ambiente')}" value="${draft.name}" data-env-bind="name" aria-label="${t('Nome do ambiente')}" />
    ${variableRows(draft.variables)}
    <p class="hint">${t('Valores secretos aparecem mascarados aqui e ficam de fora da documentação. Quem edita o ambiente os vê.')}</p>
    <div class="actions">
      <button class="primary" data-action="save-env">${t('Salvar ambiente')}</button>
      <button class="ghost" data-action="use-env" ${draft.id ? '' : 'disabled'}>${t('Usar este ambiente')}</button>
      ${draft.id ? html`<button class="ghost" data-action="delete-env">${t('Excluir')}</button>` : ''}
    </div>
  </div>`
}
