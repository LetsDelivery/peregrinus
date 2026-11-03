export type Locale = 'pt' | 'en'

const PT = {
  inherited: 'Herdada',
  noAuth: 'Sem autenticação',
  unsupported: 'Tipo ainda não suportado',
  fromParent: ' (da pasta ou da coleção)',
  name: 'Nome',
  value: 'Valor',
  description: 'Descrição',
  authorization: 'Autenticação',
  queryParams: 'Parâmetros de query',
  headers: 'Headers',
  body: 'Body',
  exampleRequest: 'Exemplo de requisição',
  exampleResponses: 'Respostas de exemplo',
  username: '<usuário>',
  password: '<senha>',
  key: '<chave>',
  token: '<token>'
}

const EN: typeof PT = {
  inherited: 'Inherited',
  noAuth: 'No authentication',
  unsupported: 'Type not supported yet',
  fromParent: ' (from the folder or the collection)',
  name: 'Name',
  value: 'Value',
  description: 'Description',
  authorization: 'Authorization',
  queryParams: 'Query parameters',
  headers: 'Headers',
  body: 'Body',
  exampleRequest: 'Example request',
  exampleResponses: 'Example responses',
  username: '<username>',
  password: '<password>',
  key: '<key>',
  token: '<token>'
}

export type Labels = typeof PT

/** The words the generated page uses itself, in the language of the person who reads it. Portuguese is the default. */
export const labelsFor = (locale: Locale | undefined): Labels => (locale === 'en' ? EN : PT)
