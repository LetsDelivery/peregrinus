import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { createAwsAccessState } from './aws-access.js'
import { readConfig } from './config.js'
import { cognitoIdentity } from './identity.js'
import { createHandler } from './routes.js'
import { createAwsTable } from './store/aws-table.js'
import { createDynamoStore } from './store/dynamo.js'

/**
 * The stack's Lambda behind `ANY /{proxy+}`: the HTTP API event becomes a web `Request`, goes through the
 * same handler as the local server, and the `Response` becomes the API's result. Built at module scope,
 * so the cost is paid once per cold start and a bad environment fails the start.
 */
const config = readConfig(process.env)
if (!config.cognito || !config.tableName) {
  throw new Error('COGNITO_ISSUER, COGNITO_CLIENT_ID and TABLE_NAME must be set')
}
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
})
const handle = createHandler({
  identity: cognitoIdentity({ issuer: config.cognito.issuer, audience: config.cognito.clientId }),
  allowedDomains: config.allowedDomains,
  localUsers: false,
  store: createDynamoStore(createAwsTable(documents, config.tableName)),
  access: createAwsAccessState(documents, config.tableName)
})

const toRequest = (event: APIGatewayProxyEventV2): Request => {
  const query = event.rawQueryString ? `?${event.rawQueryString}` : ''
  const body = event.body === undefined ? undefined : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
  return new Request(`https://${event.requestContext.domainName}${event.rawPath}${query}`, {
    method: event.requestContext.http.method,
    headers: event.headers as Record<string, string>,
    ...(body === undefined || event.requestContext.http.method === 'GET' ? {} : { body })
  })
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const response = await handle(toRequest(event))
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  }
}
