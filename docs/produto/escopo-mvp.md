# peregrinus: escopo do MVP

Cliente de requisições HTTP para a web, para o time da Lets. É o básico do Postman mais a geração
de documentação, sem o resto. Login só com a conta Google da empresa: quando a pessoa é desligada,
perde o acesso. É uma ferramenta interna, com um só ambiente, na conta AWS dev.

Origem: pedido do time de engenharia em 2026-10-29. Esta especificação nasceu do uso normal do Postman (telas
abertas por quem tem licença). Nenhum código nem bundle do Postman foi aberto ou analisado.

## O que o Postman mostra (levantamento das telas)

**Barra de cima:** seletor de workspace, busca global, convite, notificações, configurações, conta.
No canto direito, o **seletor de ambiente** (ex.: "Parceiro (homolog)") com um atalho para ver as
variáveis.

**Barra lateral:** ícones de Coleções, APIs, Histórico e Arquivos. Seções: *Collections* (árvore),
*Environments* (lista), Specs, SDKs, Mocks, Documents, Flows, Toolsets.

**Abas abertas:** requisição, pasta, coleção e o cofre local convivem na mesma barra de abas.

**Construtor de requisição:**
- Método (lista), URL, botão **Send** (com menu), **Save** e **Share**.
- Abas: Docs, Params, Authorization, Headers, Body, Scripts, Settings. Mais *Cookies* à direita.
- Params e Headers são tabelas com Key, Value, Description, edição em massa (*Bulk Edit*) e
  marcação para ligar e desligar cada linha. Headers mostra os automáticos (Host, User-Agent, Accept,
  Accept-Encoding, Connection, Cache-Control) e deixa escondê-los.
- Body: none, form-data, x-www-form-urlencoded, raw, binary, GraphQL.
- Authorization: API Key, Basic, Bearer, Digest, Hawk, JWT Bearer, OAuth 1.0, OAuth 2.0, Akamai
  EdgeGrid, ASAP, AWS Signature, NTLM, No Auth.

**Resposta:** painel embaixo com histórico de respostas da requisição. Vazio mostra atalhos
("Send + Get a successful response", "Visualize response", "Write tests").

**Rodapé:** Open Folder, Terminal, Console, Globals, Vault, Tools.

## Entra no MVP

| Área | O que entra |
|---|---|
| Requisição | Método, URL, Params, Headers (com linhas ligáveis), Body (none, raw JSON/texto/XML, x-www-form-urlencoded, form-data só com texto), Send |
| Autenticação | No Auth, API Key, Basic, Bearer. JWT e OAuth 2.0 (client credentials) depois |
| Resposta | Status, tempo, tamanho, body formatado, headers, histórico da requisição |
| Organização | Coleções com pastas, requisições salvas, abas abertas, histórico |
| Ambientes | Variáveis `{{nome}}`, seletor de ambiente no topo, valores secretos mascarados |
| Documentação | Aba Docs por requisição e página gerada a partir de uma coleção, com exemplos de resposta |
| Troca | Importar coleção do Postman (v2.1) e cURL; exportar |
| Envio | Dois modos por requisição: pelo servidor (sem CORS, com proteção contra IP privado) e pelo browser (para localhost) |
| Acesso | Login Google da empresa. **Workspaces**: cada pessoa tem o seu pessoal e pode criar os de time; coleções, ambientes e specs pertencem a um workspace. Papéis: administrador, editor e leitor |

## Fica de fora

Scripts e testes, Settings da requisição, Specs, SDKs, Mocks, Flows, Toolsets, Runner, monitores,
cofre, Terminal, Console, WebSocket, gRPC, Digest, Hawk, OAuth 1.0, Akamai, ASAP, AWS Signature, NTLM.

## Decisões

- Dados em DynamoDB, como nos outros backends da Lets. O Aurora do JiraIA existe por filtros
  em qualquer campo e busca textual, que o peregrinus não tem.
- Painel em JavaScript puro com Vite, como o JiraIA.
- Valores secretos de ambiente não vão para log nem para a documentação gerada.

## Workspaces (decidido em 2026-10-30)

- Cada pessoa ganha um workspace pessoal, privado, no primeiro acesso. Ele não se compartilha nem se exclui.
- Qualquer pessoa cria workspaces de time e vira administradora dele. Os membros entram por e-mail da empresa.
- **Administrador:** gerencia membros e exclui o workspace. **Editor:** altera coleções e ambientes.
  **Leitor:** só lê, e não vê o valor das variáveis secretas.
- Sempre há ao menos um administrador, e o mesmo e-mail não entra duas vezes.
- Excluir um workspace exclui o que há dentro dele.
- Fica para depois: convite com aceite, visibilidade "toda a empresa vê", papéis por coleção e transferir uma coleção entre workspaces.

## Idioma e configurações (decidido em 2026-10-30)

- O painel e a documentação gerada falam **português (padrão) e inglês**. Em "Automático" segue a lista de
  idiomas do navegador e escolhe o primeiro que o painel tem; sem nenhum, português. A pessoa pode fixar um idioma.
- Configurações, a partir do Postman: **Geral** (enviar por padrão, tempo limite, seguir redirecionamentos e máximo,
  verificar certificado SSL, idioma, linguagem dos exemplos), **Atalhos** (Ctrl/⌘+Enter envia, Ctrl/⌘+S salva,
  Ctrl/⌘+K filtra, Esc fecha), **Temas**, **Dados** (importar do Postman, exportar a coleção aberta),
  **Workspace** e **Sobre**.
- Ficam para depois, como no Postman: certificados de cliente e de CA, proxy próprio, versão HTTP e tamanho máximo
  da resposta editável.
