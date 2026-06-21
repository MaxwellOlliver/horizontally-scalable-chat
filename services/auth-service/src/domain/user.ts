import type { Email } from './value-objects/email.js'

/**
 * User entity. The id is a server-assigned UUIDv7 (project convention,
 * REQUIREMENTS.md). `passwordHash` is an Argon2id hash — the plaintext never
 * lives on this entity (AC-R4).
 */
export interface User {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly displayName: string
  readonly createdAt: Date
}

export interface NewUser {
  id: string
  email: Email
  passwordHash: string
  displayName: string
  createdAt: Date
}

export function createUser(props: NewUser): User {
  return {
    id: props.id,
    email: props.email.value,
    passwordHash: props.passwordHash,
    displayName: props.displayName,
    createdAt: props.createdAt,
  }
}
