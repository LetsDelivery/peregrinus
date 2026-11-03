import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb'

import type { Item, Key, TableClient, TransactPut } from './table.js'

/** DynamoDB takes 25 writes per batch. */
const BATCH = 25
const RETRIES = 5

const chunked = <T>(list: readonly T[]): T[][] => {
  const groups: T[][] = []
  for (let at = 0; at < list.length; at += BATCH) {
    groups.push(list.slice(at, at + BATCH))
  }
  return groups
}

const conditionOf = (condition: TransactPut['condition']) => {
  if (!condition) {
    return {}
  }
  return 'absent' in condition
    ? { ConditionExpression: 'attribute_not_exists(pk)' }
    : {
        ConditionExpression: '#version = :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': condition.versionEquals }
      }
}

const isConditionFailure = (error: unknown): boolean =>
  error instanceof TransactionCanceledException &&
  (error.CancellationReasons ?? []).some((reason) => reason.Code === 'ConditionalCheckFailed')

const keyCondition = (pk: string, skPrefix: string) =>
  skPrefix === ''
    ? { KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': pk } }
    : {
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix }
      }

const queryAll = async (
  client: DynamoDBDocumentClient,
  tableName: string,
  pk: string,
  skPrefix: string
): Promise<Item[]> => {
  const items: Item[] = []
  let start: Record<string, unknown> | undefined
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: tableName,
        ConsistentRead: true,
        ...keyCondition(pk, skPrefix),
        ...(start ? { ExclusiveStartKey: start } : {})
      })
    )
    items.push(...(page.Items ?? []))
    start = page.LastEvaluatedKey
  } while (start)
  return items
}

/**
 * The adapter from `TableClient` to the AWS SDK. It is thin on purpose: the logic is in the document store,
 * which is tested against the memory table. This file is checked by the type system and by a deploy to dev.
 */
export const createAwsTable = (client: DynamoDBDocumentClient, tableName: string): TableClient => {
  const batch = async (requests: Record<string, unknown>[]): Promise<void> => {
    let pending = requests
    for (let attempt = 0; pending.length > 0 && attempt < RETRIES; attempt += 1) {
      const result = await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending as never } }))
      pending = (result.UnprocessedItems?.[tableName] ?? []) as Record<string, unknown>[]
    }
    if (pending.length > 0) {
      throw new Error(`DynamoDB left ${pending.length} writes unprocessed after ${RETRIES} attempts`)
    }
  }

  return {
    get: async (pk, sk) =>
      (await client.send(new GetCommand({ TableName: tableName, Key: { pk, sk }, ConsistentRead: true }))).Item,

    query: async (pk, skPrefix) => await queryAll(client, tableName, pk, skPrefix),

    putMany: async (items) => {
      for (const group of chunked(items)) {
        await batch(group.map((item) => ({ PutRequest: { Item: item } })))
      }
    },

    deleteMany: async (keys: Key[]) => {
      for (const group of chunked(keys)) {
        await batch(group.map(({ pk, sk }) => ({ DeleteRequest: { Key: { pk, sk } } })))
      }
    },

    transact: async (puts) => {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: puts.map(({ item, condition }) => ({
              Put: { TableName: tableName, Item: item, ...conditionOf(condition) }
            }))
          })
        )
        return true
      } catch (error) {
        if (isConditionFailure(error)) {
          return false
        }
        throw error
      }
    }
  }
}
