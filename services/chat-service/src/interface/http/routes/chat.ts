import { Elysia } from 'elysia'
import type { AccessTokenVerifier } from '@hsc/platform'
import type { GetHistory } from '../../../application/use-cases/get-history.js'
import type { GetReceipts } from '../../../application/use-cases/get-receipts.js'
import type { ListConversations } from '../../../application/use-cases/list-conversations.js'
import type { ResolveConversation } from '../../../application/use-cases/resolve-conversation.js'
import { requireUser } from '../auth-context.js'
import { toHttpError } from '../error-mapper.js'
import { conversationIdSchema, friendIdSchema, historyQuerySchema } from '../validation.js'

export interface ChatUseCases {
  getHistory: GetHistory
  listConversations: ListConversations
  resolveConversation: ResolveConversation
  getReceipts: GetReceipts
}

export interface ChatRoutesDeps {
  useCases: ChatUseCases
  verifier: AccessTokenVerifier
}

/**
 * Elysia plugin for `/chat/*` (spec §2.7 interface). History is the only
 * synchronous read path; sending is async over the inbound queue. `/chat` is the
 * service prefix (mirrors `/auth/*`, `/social/*`); the handler authenticates the
 * caller and the use case enforces participant authz (AC-H3).
 */
export function createChatRoutes({ useCases, verifier }: ChatRoutesDeps) {
  return new Elysia({ prefix: '/chat' })
    .get('/conversations', async ({ headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier)
        set.status = 200
        return { conversations: await useCases.listConversations.execute(me) }
      } catch (err) {
        const { status, body } = toHttpError(err)
        set.status = status
        return body
      }
    })
    .get('/conversations/with/:friendId', async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier)
        const friendId = friendIdSchema.parse(params.friendId)
        const resolved = await useCases.resolveConversation.execute(me, friendId)
        if (!resolved) {
          set.status = 404
          return { error: 'USER_NOT_FOUND', message: 'Unknown user' }
        }
        set.status = 200
        return resolved
      } catch (err) {
        const { status, body } = toHttpError(err)
        set.status = status
        return body
      }
    })
    .get('/conversations/:conversationId/messages', async ({ params, query, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier)
        const conversationId = conversationIdSchema.parse(params.conversationId)
        const { before, limit } = historyQuerySchema.parse(query)
        set.status = 200
        return await useCases.getHistory.execute({ me, conversationId, before, limit })
      } catch (err) {
        const { status, body } = toHttpError(err)
        set.status = status
        return body
      }
    })
    .get('/conversations/:conversationId/receipts', async ({ params, headers, set }) => {
      try {
        const me = await requireUser(headers.authorization, verifier)
        const conversationId = conversationIdSchema.parse(params.conversationId)
        set.status = 200
        return { receipts: await useCases.getReceipts.execute(me, conversationId) }
      } catch (err) {
        const { status, body } = toHttpError(err)
        set.status = status
        return body
      }
    })
}
