import type { PolymarketEvent, PolymarketMarket, OrderBookSummary, OrderBookLevel } from '@/entities/market/types'
import { GAMMA_API, CLOB_API, DATA_API } from '@/shared/config/api'
import { logger } from '@/shared/lib/logger'

// --- Proxy (Gamma) ---
export interface GammaPublicProfile {
  proxyWallet?: string | null
  createdAt?: string
  name?: string
  users?: { id: string }[]
}

/** Resolve Polymarket proxy wallet for an EOA via Gamma API (same as reference). */
export async function fetchProxyWallet(eoa: string): Promise<string | null> {
  if (!eoa?.startsWith?.('0x')) return null
  const url = `${GAMMA_API}/public-profile?address=${encodeURIComponent(eoa)}`
  try {
    const res = await fetch(url)
    let proxy: string | null = null
    if (!res.ok) {
      logger.info('fetchProxyWallet: Gamma API response not ok', { status: res.status, url, eoa: eoa.slice(0, 10) + '…' }, { component: 'polymarket', function: 'fetchProxyWallet' })
    } else {
      const data = (await res.json()) as GammaPublicProfile
      proxy = data?.proxyWallet ?? null
      logger.info('fetchProxyWallet: result', { hasProxy: !!proxy, eoa: eoa.slice(0, 10) + '…' }, { component: 'polymarket', function: 'fetchProxyWallet' })
      if (proxy) return proxy
    }
    // Fallback to local onboarding backend where deployed proxy can be registered before Gamma indexing.
    const requirementsUrl = `/api/onboard/requirements?eoa=${encodeURIComponent(eoa)}`
    const reqRes = await fetch(requirementsUrl).catch(() => null)
    logger.info('fetchProxyWallet: onboard fallback', {
      url: requirementsUrl,
      ok: reqRes?.ok,
      status: reqRes?.status,
      eoa: eoa.slice(0, 10) + '…',
    }, { component: 'polymarket', function: 'fetchProxyWallet' })
    if (reqRes?.ok) {
      const req = (await reqRes.json().catch(() => ({}))) as { proxyWallet?: string | null; hasProxy?: boolean }
      logger.info('fetchProxyWallet: onboard response', {
        hasProxy: !!req?.hasProxy,
        hasProxyWallet: !!req?.proxyWallet,
        proxyWalletLength: typeof req?.proxyWallet === 'string' ? req.proxyWallet.length : 0,
        eoa: eoa.slice(0, 10) + '…',
      }, { component: 'polymarket', function: 'fetchProxyWallet' })
      if (req?.proxyWallet) {
        logger.info('fetchProxyWallet: resolved via onboard backend', { eoa: eoa.slice(0, 10) + '…', proxy: req.proxyWallet.slice(0, 10) + '…' }, { component: 'polymarket', function: 'fetchProxyWallet' })
        return req.proxyWallet
      }
    }
    return null
  } catch (e) {
    logger.warn('fetchProxyWallet: failed', { error: String(e), url }, { component: 'polymarket', function: 'fetchProxyWallet' })
    return null
  }
}

const limit = 30
const defaultOrder = 'volume'
const defaultAsc = false

export type EventsOrder = 'volume' | 'liquidity' | 'start_date' | 'end_date_asc' | 'newest'

export async function fetchEvents(params: {
  limit?: number
  offset?: number
  tag_slug?: string
  active?: boolean
  closed?: boolean
  liquidity_min?: number
  volume_min?: number
  end_date_min?: string
  end_date_max?: string
  featured?: boolean
  order?: EventsOrder
  ascending?: boolean
}): Promise<PolymarketEvent[]> {
  const search = new URLSearchParams()
  search.set('limit', String(params.limit ?? limit))
  search.set('offset', String(params.offset ?? 0))
  const order = params.order ?? defaultOrder
  const asc = params.ascending ?? defaultAsc
  // Gamma API returns 422 for start_date and end_date. Use volume/liquidity only.
  const gammaOrder = order === 'newest' || order === 'end_date_asc' ? 'volume' : order
  const gammaAsc = order === 'liquidity' ? asc : false
  search.set('order', gammaOrder)
  search.set('ascending', String(gammaAsc))
  if (params.tag_slug) search.set('tag_slug', params.tag_slug)
  if (params.active !== undefined) search.set('active', String(params.active))
  if (params.closed !== undefined) search.set('closed', String(params.closed))
  if (params.liquidity_min != null) search.set('liquidity_min', String(params.liquidity_min))
  if (params.volume_min != null) search.set('volume_min', String(params.volume_min))
  if (params.end_date_min != null) search.set('end_date_min', params.end_date_min)
  if (params.end_date_max != null) search.set('end_date_max', params.end_date_max)
  if (params.featured !== undefined) search.set('featured', String(params.featured))

  const url = `${GAMMA_API}/events?${search}`
  const sentAt = Date.now()
  try {
    const res = await fetch(url)
    const responseAt = Date.now()
    const durationMs = responseAt - sentAt
    logger.api(res.ok ? 'INFO' : 'WARN', `GET ${url}`, {
      method: 'GET',
      url,
      requestParams: params,
      sentAt,
      responseAt,
      statusCode: res.status,
      durationMs,
    }, { component: 'polymarket', function: 'fetchEvents' })
    if (!res.ok) throw new Error('Failed to fetch events')
    const data = await res.json()
    return data
  } catch (e) {
    logger.api('ERROR', `GET ${url}`, { method: 'GET', url, sentAt }, { component: 'polymarket', function: 'fetchEvents' })
    logger.error('fetchEvents failed', {}, { message: (e as Error).message, stack: (e as Error).stack }, { component: 'polymarket', function: 'fetchEvents', params })
    throw e
  }
}

export async function fetchMarkets(params: {
  limit?: number
  offset?: number
  tag_id?: number
  closed?: boolean
  liquidity_num_min?: number
  volume_num_min?: number
  order?: string
  ascending?: boolean
  id?: string[]
}): Promise<PolymarketMarket[]> {
  const search = new URLSearchParams()
  search.set('limit', String(params.limit ?? limit))
  search.set('offset', String(params.offset ?? 0))
  search.set('order', params.order ?? defaultOrder)
  search.set('ascending', String(params.ascending ?? defaultAsc))
  if (params.tag_id != null) search.set('tag_id', String(params.tag_id))
  if (params.closed !== undefined) search.set('closed', String(params.closed))
  if (params.liquidity_num_min != null) search.set('liquidity_num_min', String(params.liquidity_num_min))
  if (params.volume_num_min != null) search.set('volume_num_min', String(params.volume_num_min))
  if (params.id?.length) params.id.forEach((id) => search.append('id', id))

  const res = await fetch(`${GAMMA_API}/markets?${search}`)
  if (!res.ok) throw new Error('Failed to fetch markets')
  return res.json()
}

export async function fetchEventBySlug(slug: string): Promise<PolymarketEvent | null> {
  const res = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`)
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

export async function fetchMarketBySlug(slug: string): Promise<PolymarketMarket | null> {
  const res = await fetch(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}`)
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/** Ensure single token ID string (no JSON array or extra quotes). */
function normalizeTokenIdForApi(tokenId: string): string {
  const s = String(tokenId).trim().replace(/^["'\s]+|["'\s]+$/g, '')
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s) as unknown[]
      const first = Array.isArray(arr) && arr.length > 0 ? String(arr[0]).trim().replace(/^["']|["']$/g, '') : s
      return first || s
    } catch {
      return s
    }
  }
  return s
}

/** Try decimal token_id as hex (CLOB accepts both; reference uses toClobTokenId). */
function toClobTokenIds(raw: string): string[] {
  const t = normalizeTokenIdForApi(raw).trim()
  if (!t) return []
  const out = [t]
  if (!t.startsWith('0x') && /^\d+$/.test(t)) {
    try {
      const hex = '0x' + BigInt(t).toString(16)
      if (hex !== t) out.push(hex)
    } catch {
      // ignore
    }
  }
  return out
}

function normalizeBookRow(row: unknown): OrderBookLevel {
  if (Array.isArray(row)) {
    // Support [price, size] tuple format
    const [p, s] = row
    return { price: String(p ?? ''), size: String(s ?? '') }
  }
  const r = row as Record<string, unknown>
  // Support {price, size} and {px, qty} (Exchange Partner API)
  const price = r?.price ?? r?.px ?? ''
  const size = r?.size ?? r?.qty ?? ''
  return { price: String(price), size: String(size) }
}

function normalizeOrderBook(data: Record<string, unknown>): OrderBookSummary {
  const bids = (Array.isArray(data.bids) ? data.bids : []).map(normalizeBookRow)
  const asks = (Array.isArray(data.asks) ? data.asks : []).map(normalizeBookRow)
  return {
    market: String(data.market ?? ''),
    asset_id: String(data.asset_id ?? ''),
    timestamp: String(data.timestamp ?? ''),
    hash: String(data.hash ?? ''),
    bids,
    asks,
    min_order_size: String(data.min_order_size ?? '1'),
    tick_size: String(data.tick_size ?? '0.01'),
    neg_risk: Boolean(data.neg_risk),
    last_trade_price: String(data.last_trade_price ?? ''),
  }
}

async function fetchLastTradePrice(tokenId: string): Promise<string> {
  const idsToTry = toClobTokenIds(normalizeTokenIdForApi(tokenId))
  for (const id of idsToTry) {
    try {
      const res = await fetch(`${CLOB_API}/last-trade-price?token_id=${encodeURIComponent(id)}`)
      if (res.ok) {
        const json = (await res.json()) as { price?: string }
        if (json?.price) return String(json.price)
      }
    } catch {
      // ignore
    }
  }
  return ''
}

/** Orderbook: GET /book then POST /books fallback. Fetches last_trade_price separately if missing. */
export async function fetchOrderBook(tokenId: string): Promise<OrderBookSummary | null> {
  const sentAt = Date.now()
  const idsToTry = toClobTokenIds(normalizeTokenIdForApi(tokenId))
  try {
    let data: Record<string, unknown> | null = null
    let lastStatus = 0
    for (const id of idsToTry) {
      const res = await fetch(`${CLOB_API}/book?token_id=${encodeURIComponent(id)}`)
      lastStatus = res.status
      if (res.ok) {
        const json = await res.json()
        if (json && typeof json === 'object') {
          data = json as Record<string, unknown>
          break
        }
      }
    }
    if (!data) {
      for (const id of idsToTry) {
        const res = await fetch(`${CLOB_API}/books`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ token_id: id }]),
        })
        lastStatus = res.status
        if (res.ok) {
          const arr = (await res.json()) as unknown[]
          const first = Array.isArray(arr) && arr.length > 0 ? arr[0] : null
          if (first && typeof first === 'object') {
            data = first as Record<string, unknown>
            break
          }
        }
      }
    }
    const responseAt = Date.now()
    logger.info('fetchOrderBook: result', {
      tokenId: tokenId.slice(0, 20) + (tokenId.length > 20 ? '…' : ''),
      hasBook: !!data,
      lastStatus,
      durationMs: responseAt - sentAt,
    }, { component: 'polymarket', function: 'fetchOrderBook' })
    if (!data) return null
    const summary = normalizeOrderBook(data)
    // GET /book sometimes omits last_trade_price; fetch separately if missing
    if (!summary.last_trade_price) {
      const lastPrice = await fetchLastTradePrice(tokenId)
      if (lastPrice) summary.last_trade_price = lastPrice
    }
    return summary
  } catch (e) {
    logger.error('fetchOrderBook failed', { tokenId: tokenId.slice(0, 24) + '…', error: String(e) }, { message: (e as Error).message }, { component: 'polymarket', function: 'fetchOrderBook' })
    return null
  }
}

export async function searchMarketsEvents(query: string): Promise<{ events?: PolymarketEvent[]; markets?: PolymarketMarket[] }> {
  if (!query.trim()) return { events: [], markets: [] }
  const res = await fetch(
    `${GAMMA_API}/public-search?q=${encodeURIComponent(query)}&limit_per_type=10`
  )
  if (!res.ok) return { events: [], markets: [] }
  const data = await res.json()
  return {
    events: data.events ?? [],
    markets: data.markets ?? [],
  }
}

export async function fetchTags(): Promise<{ slug: string; label?: string; id?: number }[]> {
  const res = await fetch(`${GAMMA_API}/tags?limit=50`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** Leaderboard entry shape from Data API v1/leaderboard (same as reference). */
export interface LeaderboardEntry {
  rank?: number
  userName?: string | null
  proxyWallet?: string | null
  pnl?: number
  vol?: number
  volume?: number
}

/** GET v1/leaderboard with timePeriod (WEEK|MONTH|ALL), orderBy=PNL (same as reference). */
export async function fetchLeaderboard(params: {
  limit?: number
  timePeriod?: 'WEEK' | 'MONTH' | 'ALL'
  orderBy?: string
  category?: string
}): Promise<LeaderboardEntry[]> {
  const search = new URLSearchParams()
  search.set('limit', String(params.limit ?? 10))
  search.set('timePeriod', params.timePeriod ?? 'WEEK')
  search.set('orderBy', params.orderBy ?? 'PNL')
  if (params.category) search.set('category', params.category)
  const res = await fetch(`${DATA_API}/v1/leaderboard?${search}`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export interface DataPosition {
  proxyWallet?: string
  asset?: string
  conditionId?: string
  size?: number
  avgPrice?: number
  initialValue?: number
  currentValue?: number
  cashPnl?: number
  percentPnl?: number
  curPrice?: number
  title?: string
  slug?: string
  eventSlug?: string
  outcome?: string
  endDate?: string
}

export async function fetchPositions(params: { user: string; limit?: number; closed?: boolean }): Promise<DataPosition[]> {
  const search = new URLSearchParams()
  search.set('user', params.user)
  search.set('limit', String(params.limit ?? 100))
  const res = await fetch(`${DATA_API}/positions?${search}`)
  if (!res.ok) return []
  const data = await res.json()
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { positions?: DataPosition[] }).positions)) return (data as { positions: DataPosition[] }).positions
  return []
}

export async function fetchClosedPositions(params: { user: string; limit?: number }): Promise<DataPosition[]> {
  const search = new URLSearchParams()
  search.set('user', params.user)
  search.set('limit', String(params.limit ?? 100))
  const res = await fetch(`${DATA_API}/positions?${search}&redeemable=false`)
  if (!res.ok) return []
  const data = await res.json()
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { positions?: DataPosition[] }).positions)) return (data as { positions: DataPosition[] }).positions
  return []
}

export interface DataTrade {
  proxyWallet?: string
  side?: 'BUY' | 'SELL'
  asset?: string
  conditionId?: string
  size?: number
  price?: number
  timestamp?: number
  title?: string
  slug?: string
  eventSlug?: string
  outcome?: string
  transactionHash?: string
}

export async function fetchUserTrades(params: { user: string; limit?: number; offset?: number }): Promise<DataTrade[]> {
  const search = new URLSearchParams()
  search.set('user', params.user)
  search.set('limit', String(params.limit ?? 50))
  if (params.offset != null) search.set('offset', String(params.offset))
  const res = await fetch(`${DATA_API}/trades?${search}`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** Activity feed from Data API (same as reference). user = proxy address. */
export interface DataActivityItem {
  id?: string
  type?: string
  side?: string
  title?: string
  market?: string
  eventId?: string
  asset?: string
  size?: number
  price?: number
  value?: number
  timestamp?: number
  transactionHash?: string
  [key: string]: unknown
}

export async function fetchActivity(params: {
  user: string
  limit?: number
  offset?: number
  type?: string
  sortBy?: string
  sortDirection?: string
}): Promise<DataActivityItem[]> {
  const search = new URLSearchParams()
  search.set('user', params.user)
  search.set('limit', String(params.limit ?? 50))
  if (params.offset != null) search.set('offset', String(params.offset))
  if (params.type) search.set('type', params.type)
  if (params.sortBy) search.set('sortBy', params.sortBy)
  if (params.sortDirection) search.set('sortDirection', params.sortDirection)
  const res = await fetch(`${DATA_API}/activity?${search}`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}
