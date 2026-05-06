import type http from 'http'
import crypto from 'crypto'
import { loadConfig, writeConfig } from './config.js'
import * as state from './state.js'

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
const JWT_ALG = 'HS256'

export interface AuthUser {
  userId: string
  email: string
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401
  ) {
    super(message)
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function getJwtSecret(): string {
  if (process.env.TURING_JWT_SECRET) {
    return process.env.TURING_JWT_SECRET
  }
  const config = loadConfig()
  const existing = config.auth?.jwtSecret
  if (existing) {
    return existing
  }
  const jwtSecret = crypto.randomBytes(32).toString('hex')
  writeConfig({ ...config, auth: { ...config.auth, jwtSecret } })
  return jwtSecret
}

export function signJwt(user: AuthUser, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = { alg: JWT_ALG, typ: 'JWT' }
  const payload = {
    userId: user.userId,
    email: user.email,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = crypto.createHmac('sha256', getJwtSecret()).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function verifyJwt(token: string, nowSeconds = Math.floor(Date.now() / 1000)): AuthUser {
  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('Invalid token')
  const [headerPart, payloadPart, signature] = parts
  const expected = crypto.createHmac('sha256', getJwtSecret()).update(`${headerPart}.${payloadPart}`).digest('base64url')
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw new AuthError('Invalid token')
  }

  let header: { alg?: string }
  let payload: { userId?: string; email?: string; exp?: number }
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf-8')) as { alg?: string }
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as {
      userId?: string
      email?: string
      exp?: number
    }
  } catch {
    throw new AuthError('Invalid token')
  }
  if (header.alg !== JWT_ALG) throw new AuthError('Invalid token')

  if (!payload.userId || !payload.email || !payload.exp) {
    throw new AuthError('Invalid token')
  }
  if (payload.exp <= nowSeconds) {
    throw new AuthError('Token expired')
  }
  const user = state.getUserById(payload.userId)
  if (!user || user.email !== payload.email) {
    throw new AuthError('Invalid token')
  }
  return { userId: user.id, email: user.email }
}

export function registerUser(email: string, password: string): { user: AuthUser; token: string } {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || password.length < 8) {
    throw new AuthError('Email and password are required', 400)
  }
  if (state.getUserByEmail(normalizedEmail)) {
    throw new AuthError('Email already registered', 409)
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const created = state.createUser({
    id: crypto.randomUUID(),
    email: normalizedEmail,
    salt,
    passwordHash: hashPassword(password, salt),
  })
  const user = { userId: created.id, email: created.email }
  return { user, token: signJwt(user) }
}

export function loginUser(email: string, password: string): { user: AuthUser; token: string } {
  const userRecord = state.getUserByEmail(normalizeEmail(email))
  if (!userRecord || !safeEqualHex(userRecord.passwordHash, hashPassword(password, userRecord.salt))) {
    throw new AuthError('Invalid email or password')
  }
  const user = { userId: userRecord.id, email: userRecord.email }
  return { user, token: signJwt(user) }
}

export function loginLocalUser(email?: string): { user: AuthUser; token: string } {
  const normalizedEmail = email ? normalizeEmail(email) : undefined
  const existing = normalizedEmail ? state.getUserByEmail(normalizedEmail) : state.getPrimaryUser()
  if (existing) {
    const user = { userId: existing.id, email: existing.email }
    return { user, token: signJwt(user) }
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const created = state.createUser({
    id: crypto.randomUUID(),
    email: normalizedEmail || 'local@turing.local',
    salt,
    passwordHash: hashPassword(crypto.randomBytes(32).toString('hex'), salt),
  })
  const user = { userId: created.id, email: created.email }
  return { user, token: signJwt(user) }
}

export function createUserToken(userId: string, name?: string): { id: string; token: string; name: string; createdAt: number } {
  const token = `turing_${crypto.randomBytes(32).toString('hex')}`
  const record = state.createApiToken({
    id: crypto.randomUUID(),
    userId,
    tokenHash: sha256(token),
    tokenLast4: token.slice(-4),
    name: name?.trim() || 'API token',
  })
  return { id: record.id, token, name: record.name, createdAt: record.createdAt }
}

export function listUserTokens(userId: string): Array<{ id: string; name: string; token: string; createdAt: number; lastUsedAt?: number }> {
  return state.listApiTokens(userId).map((token) => ({
    id: token.id,
    name: token.name,
    token: `****${token.tokenLast4}`,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
  }))
}

export function revokeUserToken(userId: string, id: string): boolean {
  return state.deleteApiToken(id, userId)
}

export function authenticateRequest(req: http.IncomingMessage): AuthUser {
  const authorization = req.headers.authorization
  const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : undefined
  const token = bearer ?? readCookie(req, 'turing_token')
  if (!token) throw new AuthError('Authentication required')

  if (token.startsWith('turing_')) {
    const apiToken = state.getApiTokenByHash(sha256(token))
    if (!apiToken) throw new AuthError('Invalid token')
    const user = state.getUserById(apiToken.userId)
    if (!user) throw new AuthError('Invalid token')
    state.touchApiToken(apiToken.id)
    return { userId: user.id, email: user.email }
  }

  if (token.startsWith('ey')) {
    return verifyJwt(token)
  }

  throw new AuthError('Invalid token')
}

export function authCookie(token: string): string {
  return `turing_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_SECONDS}`
}

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
  const cookie = req.headers.cookie
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
