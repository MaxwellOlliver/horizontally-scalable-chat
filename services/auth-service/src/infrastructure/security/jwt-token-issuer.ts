import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { uuidv7 } from 'uuidv7'
import type {
  AccessTokenClaims,
  IssuedAccessToken,
  TokenIssuer,
} from '../../application/ports/token-issuer.js'

const ALG = 'HS256'

export interface JwtConfig {
  secret: string
  issuer: string
  accessTtlSeconds: number
}

/**
 * HS256 access-token issuer/verifier (spec §2.2, §2.5). Stateless: verification
 * needs only the shared secret, no DB lookup (AC-L3, AC-W2). The same secret +
 * claim shape (`sub`, `iat`, `exp`, `jti`) is the contract the Go gateway
 * verifies against (spec §2.8).
 */
export function createJwtTokenIssuer(config: JwtConfig): TokenIssuer {
  const key = new TextEncoder().encode(config.secret)

  return {
    async issueAccessToken(userId: string): Promise<IssuedAccessToken> {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: ALG, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(config.issuer)
        .setIssuedAt()
        .setJti(uuidv7())
        .setExpirationTime(`${config.accessTtlSeconds}s`)
        .sign(key)
      return { token, expiresIn: config.accessTtlSeconds }
    },

    async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
      const { payload } = await jwtVerify(token, key, {
        issuer: config.issuer,
        algorithms: [ALG],
      })
      return assertClaims(payload)
    },
  }
}

function assertClaims(payload: JWTPayload): AccessTokenClaims {
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('Access token is missing required claims')
  }
  return { sub: payload.sub, jti: payload.jti, iat: payload.iat, exp: payload.exp }
}
