# Deploy do peregrinus

O peregrinus é uma ferramenta interna e tem **um só ambiente**, na conta AWS dev (`761817249596`, `us-east-1`).
Não há versão de produção separada.
O pipeline da Lets (aws-cicd) roda o `buildspec.yml`, e o CloudFormation sobe a stack do `template.yml`.

## O que o pipeline faz

1. `bun install --frozen-lockfile` e `bun run build` (função em `dist/lambda.zip`, painel em `apps/web/dist`).
2. Envia `app.zip` e os arquivos do painel para o bucket do pipeline, e grava `config.json` com os parâmetros
   `ArtifactBucket`, `ArtifactPackage`, `ArtifactPackageVersion` e `PanelPrefix`.
3. O CloudFormation cria ou atualiza a stack. Um recurso da stack copia o painel para o bucket do site e
   limpa o cache da CloudFront. Um `PanelPrefix` novo (um por commit) faz o painel ser publicado de novo.

## Antes do primeiro deploy

Estes itens ficam fora do template de propósito. Sem eles a stack não sobe ou o login não funciona.

| # | O que | Quem | Como |
|---|---|---|---|
| 1 | Cliente OAuth do Google, tipo **Interno** | Infra | Console do Google Cloud. URI de redirecionamento: `https://peregrinus-761817249596.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` |
| 2 | Segredo `peregrinus/google` | Infra | Secrets Manager, JSON `{"clientSecret": "..."}` |
| 3 | Parâmetro `/peregrinus/google/client-id` | Infra | SSM Parameter Store, tipo `String`, com o ID do cliente |
| 4 | Pipeline do repositório | Infra | Criar em `aws-cicd`, com o repositório `LetsDelivery/peregrinus` e a branch `master` |
| 5 | Registro DNS `peregrinus.uselets.com` | Infra | A zona fica em outra conta. Depois do deploy, criar um CNAME para o valor `DistributionDomain` das saídas da stack |

O certificado `*.uselets.com` já existe na conta dev e já está no `template.yml`.

## Regra do time para `template.yml`

Mudança em `template.yml` pede um teste manual no CloudFormation antes do pull request: enviar o template, criar o
change set e executar tudo até o fim. O lint passa em templates que falham no deploy. Diga no pull request que o
teste foi feito.

## Depois do deploy

1. Abrir `https://peregrinus.uselets.com`. Deve pedir login do Google.
2. Entrar com uma conta de `AllowedEmailDomains`. Uma conta de outro domínio deve ser recusada.
3. Criar uma coleção, uma requisição e enviar. Testar uma URL privada (por exemplo `http://169.254.169.254`):
   a resposta deve ser recusada pelo servidor.
4. Publicar a documentação com visibilidade "link" e abrir o link em uma janela anônima. Deve abrir sem pedir login e sem nenhum segredo na página.
5. Assinar o tópico `AlarmTopicArn` (saída da stack) com um e-mail ou um hook de chat. Sem assinante, os alarmes
   não avisam ninguém.

## Remover uma pessoa

O acesso depende da conta Google da empresa. Quando a conta é desligada, o Google não emite mais token e a
sessão acaba na próxima renovação. Para cortar na hora, desabilitar o usuário no Cognito:

```bash
aws cognito-idp admin-disable-user --user-pool-id <UserPoolId> --username <usuario> --profile lets-dev
```

## Tirar do ar

Excluir a stack remove tudo, menos os dados: a tabela do DynamoDB tem retenção. Apague-a à mão só se for mesmo
para perder as coleções. O bucket do painel precisa estar vazio para a stack apagá-lo.
