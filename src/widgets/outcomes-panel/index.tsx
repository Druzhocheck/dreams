import { useQuery } from '@tanstack/react-query'
import type { PolymarketEvent, PolymarketMarket } from '@/entities/market/types'
import type { OutcomeToken } from '@/shared/lib/market-utils'
import { getMarketOutcomeDisplayName, parseOutcomePrices } from '@/shared/lib/market-utils'
import { fetchOrderBook } from '@/shared/api/polymarket'
import { cn } from '@/shared/lib/cn'


interface OutcomesPanelProps {
  event: PolymarketEvent
  outcomeTokens: OutcomeToken[]
  selectedIndex: number
  onSelectOutcome: (index: number) => void
}

function parsePercentLike(value: unknown): number | null {
  const n = Number.parseFloat(String(value).replace('%', '').trim())
  if (!Number.isFinite(n)) return null
  if (n > 1 && n <= 100) return n / 100
  if (n >= 0 && n <= 1) return n
  return null
}

function getFallbackFromMarket(market: PolymarketMarket, outcome: string): number {
  const prices = parseOutcomePrices(market.outcomePrices)
  const mapped = market.outcomePricesByOutcome ?? null
  if (mapped) {
    const key = Object.keys(mapped).find((k) => k.toLowerCase() === outcome.toLowerCase())
    const v = key ? parsePercentLike(mapped[key]) : null
    if (v != null) return v
  }
  const first = parsePercentLike(prices[0])
  const second = parsePercentLike(prices[1])
  if (outcome === 'Yes') {
    if (first != null) return first
    if (second != null) return 1 - second
  } else {
    if (second != null) return second
    if (first != null) return 1 - first
  }
  const orderPrice = parsePercentLike(market.orderPrice)
  if (orderPrice != null) return outcome === 'Yes' ? orderPrice : 1 - orderPrice
  return 0.5
}

/** Best ask = min of asks = price you pay when buying. */
function getBestAsk(asks: { price: string }[]): number | null {
  if (!asks?.length) return null
  const prices = asks.map((l) => Number(l.price)).filter(Number.isFinite)
  if (prices.length === 0) return null
  const best = Math.min(...prices)
  return best > 0 && best <= 1 ? best : null
}

function formatPct(p: number): string {
  const pct = p * 100
  if (pct === 0 || (pct > 0 && pct < 1)) return '<1%'
  return `${Math.round(pct)}%`
}

function OutcomeRow({
  title,
  vol,
  yesPrice,
  noPrice,
  isYesSelected,
  isNoSelected,
  onSelectYes,
  onSelectNo,
  onSelectRow,
}: {
  title: string
  vol: number
  yesPrice: number
  noPrice: number
  isYesSelected: boolean
  isNoSelected: boolean
  onSelectYes: () => void
  onSelectNo: () => void
  onSelectRow?: () => void
}) {
  const volStr = vol >= 1e6 ? `$${(vol / 1e6).toFixed(2)}M` : vol >= 1e3 ? `$${(vol / 1e3).toFixed(1)}K` : `$${vol.toFixed(0)}`

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 py-3 px-4 rounded-xl border border-white/10 bg-bg-tertiary/50',
        (isYesSelected || isNoSelected) && 'ring-2 ring-accent-violet/50 border-accent-violet/50'
      )}
    >
      <div
        className="min-w-0 flex-1 cursor-pointer select-none"
        onClick={onSelectRow}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRow?.() } }}
        role={onSelectRow ? 'button' : undefined}
        tabIndex={onSelectRow ? 0 : undefined}
        title={onSelectRow ? 'Select outcome (order book and order form will open)' : undefined}
      >
        <p className="text-base font-semibold text-text-primary break-words" title={title}>
          {title}
        </p>
        <p className="text-tiny text-text-muted mt-0.5">{volStr} Vol</p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className="font-mono text-lg font-bold text-text-primary w-12 text-right">{formatPct(yesPrice)}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSelectYes}
            className={cn(
              'px-4 py-2 rounded-lg font-semibold text-small transition-colors',
              'bg-[#10b981] hover:bg-[#0d9668] text-white',
              isYesSelected && 'ring-2 ring-white/60'
            )}
          >
            Buy Yes {yesPrice <= 0 || yesPrice >= 1 ? '—' : `${(yesPrice * 100).toFixed(1)}¢`}
          </button>
          <button
            type="button"
            onClick={onSelectNo}
            className={cn(
              'px-4 py-2 rounded-lg font-semibold text-small transition-colors',
              'bg-[#ef4444] hover:bg-[#dc2626] text-white',
              isNoSelected && 'ring-2 ring-white/60'
            )}
          >
            Buy No {noPrice <= 0 || noPrice >= 1 ? '—' : `${(noPrice * 100).toFixed(1)}¢`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function OutcomesPanel({ event, outcomeTokens, selectedIndex, onSelectOutcome }: OutcomesPanelProps) {
  const eventVol = event.volumeNum ?? Number(event.volume ?? 0) ?? 0

  const rows: {
    market: PolymarketMarket
    yesToken: OutcomeToken
    noToken: OutcomeToken
    yesIndex: number
    noIndex: number
  }[] = []
  for (let i = 0; i < outcomeTokens.length; i += 2) {
    const yesToken = outcomeTokens[i]
    const noToken = outcomeTokens[i + 1]
    if (!yesToken || !noToken) continue
    rows.push({ market: yesToken.market, yesToken, noToken, yesIndex: i, noIndex: i + 1 })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-4">
        <h3 className="text-base font-bold text-text-primary mb-2">Outcomes</h3>
        <p className="text-small text-text-muted">No outcome data</p>
      </div>
    )
  }

  return (
    <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-4">
      <h3 className="text-base font-bold text-text-primary mb-2">Outcome options</h3>
      <p className="text-tiny text-text-muted mb-3">
        Select an outcome and click Buy Yes or Buy No, or use the form on the right.
      </p>
      <div className="flex flex-col gap-2">
        {[...rows]
          .sort((a, b) => {
            const aYes = getFallbackFromMarket(a.market, 'Yes')
            const bYes = getFallbackFromMarket(b.market, 'Yes')
            return bYes - aYes
          })
          .map(({ market, yesToken, noToken, yesIndex, noIndex }, i) => (
          <OutcomeRowWithPrices
            key={market.id ?? i}
            market={market}
            yesToken={yesToken}
            noToken={noToken}
            vol={market.volumeNum ?? eventVol}
            yesIndex={yesIndex}
            noIndex={noIndex}
            selectedIndex={selectedIndex}
            onSelectOutcome={onSelectOutcome}
          />
        ))}
      </div>
    </div>
  )
}

function OutcomeRowWithPrices({
  market,
  yesToken,
  noToken,
  vol,
  yesIndex,
  noIndex,
  selectedIndex,
  onSelectOutcome,
}: {
  market: PolymarketMarket
  yesToken: OutcomeToken
  noToken: OutcomeToken
  vol: number
  yesIndex: number
  noIndex: number
  selectedIndex: number
  onSelectOutcome: (index: number) => void
}) {
  const title = getMarketOutcomeDisplayName(market) || market.question || `Outcome ${yesIndex / 2 + 1}`
  const { data: yesBook } = useQuery({
    queryKey: ['orderbook', yesToken.tokenId],
    queryFn: () => fetchOrderBook(yesToken.tokenId!),
    enabled: !!yesToken.tokenId,
  })
  const { data: noBook } = useQuery({
    queryKey: ['orderbook', noToken.tokenId],
    queryFn: () => fetchOrderBook(noToken.tokenId!),
    enabled: !!noToken.tokenId,
  })
  const yesBestAsk = getBestAsk(yesBook?.asks ?? [])
  const noBestAsk = getBestAsk(noBook?.asks ?? [])
  const yesPrice = yesBestAsk ?? getFallbackFromMarket(market, 'Yes')
  const noPrice = noBestAsk ?? getFallbackFromMarket(market, 'No')

  return (
    <OutcomeRow
      title={title}
      vol={vol}
      yesPrice={yesPrice}
      noPrice={noPrice}
      isYesSelected={selectedIndex === yesIndex}
      isNoSelected={selectedIndex === noIndex}
      onSelectYes={() => onSelectOutcome(yesIndex)}
      onSelectNo={() => onSelectOutcome(noIndex)}
      onSelectRow={() => onSelectOutcome(yesIndex)}
    />
  )
}
