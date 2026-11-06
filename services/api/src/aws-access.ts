import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { DeleteCommand, type DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { type AccessState, type Failure, LOCK_MS, MAX_FAILURES, TOUCH_EVERY_MS, WINDOW_MS } from './access-state.js'

/**
 * `AccessState` on the stack's table. Two small items per publication, `ACCESS#<slug>`: `ATTEMPTS` (the wrong
 * passwords and the lock) and `LAST` (the last access). Times are epoch milliseconds; `ttl` (epoch seconds) lets
 * DynamoDB clean up what nobody will read again. This file is checked by the type system and by a deploy: the
 * rules it must follow are in `access-state.ts` and tested there.
 */
const DAY_S = 86_400

const keyOf = (slug: string, sk: 'ATTEMPTS' | 'LAST') => ({ pk: `ACCESS#${slug}`, sk })
const seconds = (ms: number): number => Math.ceil(ms / 1000)
const wasRefused = (error: unknown): boolean => error instanceof ConditionalCheckFailedException

export const createAwsAccessState = (client: DynamoDBDocumentClient, tableName: string): AccessState => {
  const lockOf = async (slug: string): Promise<number | undefined> => {
    const { Item } = await client.send(
      new GetCommand({ TableName: tableName, Key: keyOf(slug, 'ATTEMPTS'), ConsistentRead: true })
    )
    return typeof Item?.lockedUntil === 'number' ? Item.lockedUntil : undefined
  }

  const add = async (slug: string, now: number, windowEnd: number): Promise<number> => {
    const { Attributes } = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: keyOf(slug, 'ATTEMPTS'),
        UpdateExpression: 'ADD failures :one SET windowEnd = if_not_exists(windowEnd, :end), #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(pk) OR windowEnd >= :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':end': windowEnd, ':now': now, ':ttl': seconds(windowEnd) + DAY_S },
        ReturnValues: 'ALL_NEW'
      })
    )
    return Number(Attributes?.failures)
  }

  /**
   * Starts a new window, counting this one. Conditional, so two guesses at the edge of a window cannot both reset it,
   * and a lock that is still running is never wiped: `lockedUntil` goes only once it has passed.
   */
  const restart = async (slug: string, now: number, windowEnd: number): Promise<void> => {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: keyOf(slug, 'ATTEMPTS'),
        UpdateExpression: 'SET failures = :one, windowEnd = :end, #ttl = :ttl REMOVE lockedUntil',
        ConditionExpression:
          'attribute_not_exists(windowEnd) OR (windowEnd < :now AND (attribute_not_exists(lockedUntil) OR lockedUntil < :now))',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':end': windowEnd, ':now': now, ':ttl': seconds(windowEnd) + DAY_S }
      })
    )
  }

  /** The result of a conditional write, or undefined when its condition refused it. Any other error is real. */
  const unlessRefused = async <T>(write: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await write()
    } catch (error) {
      if (wasRefused(error)) {
        return undefined
      }
      throw error
    }
  }

  /** The count after one more wrong password. A window that ran out starts again from one. */
  const count = async (slug: string, now: number): Promise<number> => {
    const windowEnd = now + WINDOW_MS
    const added = await unlessRefused(() => add(slug, now, windowEnd))
    if (added !== undefined) {
      return added
    }
    const restarted = await unlessRefused(async () => {
      await restart(slug, now, windowEnd)
      return 1
    })
    if (restarted !== undefined) {
      return restarted
    }
    // Refused twice: another guess restarted the window in between, or a lock is still running.
    return (await unlessRefused(() => add(slug, now, windowEnd))) ?? MAX_FAILURES
  }

  return {
    lockedUntil: async (slug, now) => {
      const until = await lockOf(slug)
      return until !== undefined && until > now.getTime() ? new Date(until) : undefined
    },

    registerFailure: async (slug, now): Promise<Failure> => {
      const failures = await count(slug, now.getTime())
      if (failures < MAX_FAILURES) {
        return { failures, lockedUntil: undefined }
      }
      const until = now.getTime() + LOCK_MS
      const { Attributes } = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: keyOf(slug, 'ATTEMPTS'),
          UpdateExpression: 'SET lockedUntil = if_not_exists(lockedUntil, :until), #ttl = :ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':until': until, ':ttl': seconds(until) + DAY_S },
          ReturnValues: 'ALL_NEW'
        })
      )
      return { failures, lockedUntil: new Date(Number(Attributes?.lockedUntil ?? until)) }
    },

    clear: async (slug) => {
      await client.send(new DeleteCommand({ TableName: tableName, Key: keyOf(slug, 'ATTEMPTS') }))
    },

    touch: async (slug, now) => {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: keyOf(slug, 'LAST'),
            UpdateExpression: 'SET #at = :now',
            ConditionExpression: 'attribute_not_exists(#at) OR #at < :cutoff',
            ExpressionAttributeNames: { '#at': 'at' },
            ExpressionAttributeValues: { ':now': now.getTime(), ':cutoff': now.getTime() - TOUCH_EVERY_MS }
          })
        )
      } catch (error) {
        if (!wasRefused(error)) {
          // Not the hourly limit: log it, but a visit must not fail because of a note about it.
          console.error(JSON.stringify({ message: 'Last access was not written', slug, error: String(error) }))
        }
      }
    },

    lastAccess: async (slug) => {
      const { Item } = await client.send(new GetCommand({ TableName: tableName, Key: keyOf(slug, 'LAST') }))
      return typeof Item?.at === 'number' ? new Date(Item.at) : undefined
    },

    forget: async (slug) => {
      await client.send(new DeleteCommand({ TableName: tableName, Key: keyOf(slug, 'ATTEMPTS') }))
      await client.send(new DeleteCommand({ TableName: tableName, Key: keyOf(slug, 'LAST') }))
    }
  }
}
