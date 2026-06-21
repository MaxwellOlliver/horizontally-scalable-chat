import { and, eq, isNull } from 'drizzle-orm'
import type { RefreshTokenRecord } from '../../domain/refresh-token.js'
import type { RefreshTokenRepository } from '../../application/ports/refresh-token-repository.js'
import type { Database } from '../db/client.js'
import { refreshTokens, type RefreshTokenRow } from '../db/schema.js'

export function createDrizzleRefreshTokenRepository(db: Database): RefreshTokenRepository {
  return {
    async save(token: RefreshTokenRecord): Promise<void> {
      await db.insert(refreshTokens).values({
        id: token.id,
        userId: token.userId,
        familyId: token.familyId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        createdAt: token.createdAt,
      })
    },

    async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      const [row] = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
      return row ? toDomain(row) : null
    },

    async revoke(id: string, revokedAt: Date): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt })
        .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
    },

    async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt })
        .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    },
  }
}

function toDomain(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  }
}
