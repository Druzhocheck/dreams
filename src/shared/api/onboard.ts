import { logger } from '@/shared/lib/logger'

/** Backend base for onboard API. Use VITE_ONBOARD_API in prod (e.g. https://your-backend.railway.app/onboard). */
export const ONBOARD_API =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ONBOARD_API?.trim?.()) || '/api/onboard'

export interface OnboardRequirements {
  linked: boolean
  needSignature: boolean
  hasProxy: boolean
  proxyWallet: string | null
  canDeployProxy?: boolean
}

export interface OnboardSignPayload {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  message: Record<string, unknown>
  timestamp: number
  nonce: number
}

export interface BridgeCurrency {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  metadata?: { isNative?: boolean }
}

export interface BridgeQuoteStepItemData {
  to: string
  data: string
  value: string
  chainId: number
}

export interface BridgeQuoteStep {
  requestId?: string
  items?: Array<{ data?: BridgeQuoteStepItemData }>
}

export interface BridgeQuoteResponse {
  steps?: BridgeQuoteStep[]
  details?: { currencyOut?: { amount: string }; currencyIn?: { amount: string } }
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

export async function getOnboardRequirements(eoa: string): Promise<OnboardRequirements> {
  const url = `${ONBOARD_API}/requirements?eoa=${encodeURIComponent(eoa)}`
  const res = await fetch(url)
  const data = await safeJson(res)
  logger.info('onboard: requirements', { status: res.status, hasProxy: !!data?.hasProxy, linked: !!data?.linked }, { component: 'onboard-api', function: 'getOnboardRequirements' })
  if (!res.ok) throw new Error(data?.error ?? 'Failed to load onboarding requirements')
  return data as OnboardRequirements
}

export async function getOnboardSignPayload(eoa: string, chainId = 137): Promise<OnboardSignPayload> {
  const url = `${ONBOARD_API}/sign-payload?eoa=${encodeURIComponent(eoa)}&chainId=${chainId}`
  const res = await fetch(url)
  const data = await safeJson(res)
  logger.info('onboard: sign payload', { status: res.status, chainId }, { component: 'onboard-api', function: 'getOnboardSignPayload' })
  if (!res.ok) throw new Error(data?.error ?? 'Failed to load sign payload')
  return data as OnboardSignPayload
}

export async function getDerivedSafeAddress(eoa: string): Promise<string | null> {
  const url = `${ONBOARD_API}/derived-safe?eoa=${encodeURIComponent(eoa)}`
  const res = await fetch(url)
  const data = await safeJson(res)
  if (!res.ok) return null
  const addr = data?.proxyAddress ?? null
  return typeof addr === 'string' && addr.startsWith('0x') ? addr : null
}

export async function getBridgeCurrencies(chainId = 43114): Promise<BridgeCurrency[]> {
  const res = await fetch(`${ONBOARD_API}/bridge/currencies?chainId=${chainId}`)
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data?.error ?? 'Failed to load bridge currencies')
  return Array.isArray(data?.currencies) ? (data.currencies as BridgeCurrency[]) : []
}

export async function getBridgeQuote(params: {
  user: string
  recipient: string
  amount?: string
  amountWei?: string
  exactOutputUsdc?: string
  originCurrency: string
}): Promise<BridgeQuoteResponse> {
  const res = await fetch(`${ONBOARD_API}/bridge/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data?.error ?? 'Failed to get bridge quote')
  return data as BridgeQuoteResponse
}

export async function createOnboard(eoa: string, signature: string, timestamp: number, nonce: number) {
  const res = await fetch(`${ONBOARD_API}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eoa, signature, timestamp, nonce, chainId: 137 }),
  })
  const data = await safeJson(res)
  logger.info('onboard: create', { status: res.status, success: !!data?.success, needsPolymarketAccount: !!data?.needsPolymarketAccount }, { component: 'onboard-api', function: 'createOnboard' })
  if (!res.ok) {
    const msg = data?.error ?? 'Onboarding failed'
    const err = new Error(msg)
    ;(err as Error & { needsPolymarketAccount?: boolean }).needsPolymarketAccount = !!data?.needsPolymarketAccount
    throw err
  }
  return data as { success: boolean; linked: boolean }
}
