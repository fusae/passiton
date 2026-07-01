import crypto from 'crypto'
import { loadConfig, writeConfig } from './config.js'
import * as state from './state.js'

type Provider = state.StoredApiKeyRecord['provider']

const PROVIDERS = new Set<Provider>(['anthropic', 'openai', 'deepseek', 'zhipu', 'qwen', 'moonshot'])

export class KeyVaultError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function validateProvider(value: string): Provider {
  if (!PROVIDERS.has(value as Provider)) {
    throw new KeyVaultError(400, '"provider" must be one of anthropic, openai, deepseek, zhipu, qwen, moonshot')
  }
  return value as Provider
}

function getEncryptionSecret(): string {
  if (process.env.TURING_ENCRYPTION_KEY) {
    return process.env.TURING_ENCRYPTION_KEY
  }
  const config = loadConfig()
  const existing = config.auth?.encryptionKey
  if (existing) {
    return existing
  }
  const encryptionKey = crypto.randomBytes(32).toString('hex')
  writeConfig({ ...config, auth: { ...config.auth, encryptionKey } })
  return encryptionKey
}

function deriveUserKey(userId: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.from(getEncryptionSecret(), 'utf-8'),
    Buffer.from(userId, 'utf-8'),
    Buffer.from('turing-key-vault', 'utf-8'),
    32
  ))
}

export function encryptSecret(userId: string, key: string): { encryptedKey: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveUserKey(userId), iv)
  const encrypted = Buffer.concat([cipher.update(key, 'utf-8'), cipher.final()])
  return {
    encryptedKey: encrypted.toString('base64url'),
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  }
}

export function decryptSecret(record: { userId: string; encryptedKey: string; iv: string; authTag: string }): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveUserKey(record.userId),
    Buffer.from(record.iv, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(record.encryptedKey, 'base64url')),
    decipher.final(),
  ]).toString('utf-8')
}

export function storeKey(params: { userId: string; provider: string; key: string; name?: string }): {
  id: string
  provider: Provider
  name: string
  maskedKey: string
  createdAt: number
} {
  const provider = validateProvider(params.provider)
  if (!params.key.trim()) {
    throw new KeyVaultError(400, '"key" must be a non-empty string')
  }
  const encrypted = encryptSecret(params.userId, params.key)
  const record = state.createStoredApiKey({
    id: crypto.randomUUID(),
    userId: params.userId,
    provider,
    name: params.name?.trim() || provider,
    ...encrypted,
  })
  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    maskedKey: maskKey(params.key),
    createdAt: record.createdAt,
  }
}

export function listKeys(userId: string): Array<{ id: string; provider: Provider; name: string; maskedKey: string; createdAt: number }> {
  return state.listStoredApiKeys(userId).map((record) => {
    const key = decryptSecret(record)
    return {
      id: record.id,
      provider: record.provider,
      name: record.name,
      maskedKey: maskKey(key),
      createdAt: record.createdAt,
    }
  })
}

export function decryptKey(userId: string, id: string): { provider: Provider; key: string; envVar: string } {
  const record = state.getStoredApiKey(id, userId)
  if (!record) throw new KeyVaultError(404, 'Not found')
  return {
    provider: record.provider,
    key: decryptSecret(record),
    envVar: envVarForProvider(record.provider),
  }
}

export function deleteKey(userId: string, id: string): boolean {
  return state.deleteStoredApiKey(id, userId)
}

export function envVarForProvider(provider: Provider): string {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'deepseek':
      return 'DEEPSEEK_API_KEY'
    case 'zhipu':
      return 'ZHIPU_API_KEY'
    case 'qwen':
      return 'DASHSCOPE_API_KEY'
    case 'moonshot':
      return 'MOONSHOT_API_KEY'
  }
}

export function maskKey(key: string): string {
  return `****${key.slice(-4)}`
}

export function maskAgentKey(key: string): string {
  if (key.length <= 8) return maskKey(key)
  return `${key.slice(0, 3)}...${key.slice(-4)}`
}
