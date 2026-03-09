import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { fetchOrderBook } from '@/shared/api/polymarket'
import { useMarketWs } from '@/shared/hooks/use-market-ws'
import { cn } from '@/shared/lib/cn'

interface OrderbookPanelProps {
  yesTokenId?: string | null
  noTokenId?: string | null
  /** Controlled tab: sync with selected outcome (e.g. Yes = even index, No = odd). */
  activeTab?: 'yes' | 'no'
  onTabChange?: (tab: 'yes' | 'no') => void
  onPriceClick?: (price: number) => void
}

function BookContent({
  tokenId,
  onPriceClick,
}: {
  tokenId: string
  onPriceClick?: (price: number) => void
}) {
  const formatCents = (price: number) => `${(price * 100).toFixed(1)}¢`
  const { data: restBook, isLoading, isError, refetch } = useQuery({
    queryKey: ['orderbook', tokenId],
    queryFn: () => fetchOrderBook(tokenId),
    enabled: !!tokenId,
    refetchInterval: 30_000,
  })
  const { book: wsBook } = useMarketWs(tokenId)

  // Prefer REST for full depth; WebSocket often sends fewer levels. Use WS only for lastTradePrice.
  const restAsks = restBook?.asks ?? []
  const restBids = restBook?.bids ?? []
  const wsAsks = wsBook?.asks ?? []
  const wsBids = wsBook?.bids ?? []
  const useRestForDepth = restAsks.length + restBids.length >= wsAsks.length + wsBids.length
  const rawAsks = useRestForDepth ? restAsks : wsAsks
  const rawBids = useRestForDepth ? restBids : wsBids
  const lastTradePrice = wsBook?.lastTradePrice ?? (restBook as { last_trade_price?: string } | undefined)?.last_trade_price

  // Asks: best (lowest) first — ascending
  const asks = [...rawAsks]
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, 50)
  // Bids: best (highest) first — descending
  const bids = [...rawBids]
    .sort((a, b) => Number(b.price) - Number(a.price))
    .slice(0, 50)
  const bestAsk = asks[0]?.price
  const bestBid = bids[0]?.price
  const spreadAbs = bestAsk && bestBid ? Number(bestAsk) - Number(bestBid) : 0
  const spreadPct = bestAsk && bestBid ? (spreadAbs / Number(bestBid)) * 100 : 0
  const isEmpty = rawAsks.length === 0 && rawBids.length === 0
  const maxSize = Math.max(...[...asks, ...bids].map((l) => Number(l.size)), 1)

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 py-8">
        <div className="h-2 w-2 rounded-full bg-accent-violet animate-pulse" />
        <span className="text-small text-text-muted">Loading...</span>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
        <p className="text-small text-status-error">Failed to load order book</p>
        <button type="button" onClick={() => refetch()} className="flex items-center gap-2 px-3 py-2 rounded-panel bg-bg-tertiary border border-white/10 text-small hover:bg-white/5">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    )
  }
  if (isEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center py-8">
        <p className="text-small text-text-muted">No liquidity</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hover font-mono text-small">
      <div className="grid grid-cols-[1fr_1fr_1fr_3rem] gap-x-2 gap-y-0 px-3 py-2 bg-bg-tertiary/50 text-text-muted border-b border-white/10">
        <span>Price (¢)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      <div className="text-status-error">
        <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-status-error/90 bg-status-error/10 border-b border-status-error/20">
          Sell Orders (Asks) - You buy here
        </div>
        {asks.map((level, i) => {
          const price = Number(level.price)
          const size = Number(level.size)
          const total = price * size
          const depthPct = (size / maxSize) * 100
          return (
            <div
              key={`a-${i}`}
              role="button"
              tabIndex={0}
              className={cn(
                'grid grid-cols-[1fr_1fr_1fr_3rem] gap-x-2 gap-y-0.5 px-3 py-1.5 items-center hover:bg-status-error/10 cursor-pointer transition-colors text-status-error'
              )}
              onClick={() => onPriceClick?.(price)}
              onKeyDown={(e) => e.key === 'Enter' && onPriceClick?.(price)}
              title={`${level.price} × ${level.size} = $${total.toFixed(2)}`}
            >
              <span>{formatCents(price)}</span>
              <span className="text-right text-text-body">{Number(level.size).toLocaleString()}</span>
              <span className="text-right text-text-muted">${total.toFixed(2)}</span>
              <div className="h-1.5 rounded bg-status-error/30 min-w-0 overflow-hidden">
                <div className="h-full rounded bg-status-error/50" style={{ width: `${Math.min(100, depthPct)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-3 py-2 bg-bg-tertiary text-center border-y border-white/10 text-tiny">
        <span className="text-text-muted">Spread </span>
        <span className="text-text-primary">{(spreadAbs * 100).toFixed(1)}¢</span>
        <span className="text-text-muted"> ({spreadPct.toFixed(1)}%)</span>
        {lastTradePrice != null && (
          <>
            <span className="text-text-muted mx-2">|</span>
            <span className="text-text-body">Last {(Number(lastTradePrice) * 100).toFixed(1)}¢</span>
          </>
        )}
      </div>
      <div className="text-status-success">
        <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-status-success/90 bg-status-success/10 border-b border-status-success/20">
          Buy Orders (Bids) - You sell here
        </div>
        {bids.map((level, i) => {
          const price = Number(level.price)
          const size = Number(level.size)
          const total = price * size
          const depthPct = (size / maxSize) * 100
          return (
            <div
              key={`b-${i}`}
              role="button"
              tabIndex={0}
              className={cn(
                'grid grid-cols-[1fr_1fr_1fr_3rem] gap-x-2 gap-y-0.5 px-3 py-1.5 items-center hover:bg-status-success/10 cursor-pointer transition-colors text-status-success'
              )}
              onClick={() => onPriceClick?.(price)}
              onKeyDown={(e) => e.key === 'Enter' && onPriceClick?.(price)}
              title={`${level.price} × ${level.size} = $${total.toFixed(2)}`}
            >
              <span>{formatCents(price)}</span>
              <span className="text-right text-text-body">{Number(level.size).toLocaleString()}</span>
              <span className="text-right text-text-muted">${total.toFixed(2)}</span>
              <div className="h-1.5 rounded bg-status-success/30 min-w-0 overflow-hidden">
                <div className="h-full rounded bg-status-success/50" style={{ width: `${Math.min(100, depthPct)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function OrderbookPanel({ yesTokenId, noTokenId, activeTab: activeTabProp, onTabChange, onPriceClick }: OrderbookPanelProps) {
  const [internalTab, setInternalTab] = useState<'yes' | 'no'>('yes')
  const activeTab = activeTabProp ?? internalTab
  const setActiveTab = (tab: 'yes' | 'no') => {
    if (activeTabProp === undefined) setInternalTab(tab)
    onTabChange?.(tab)
  }
  const tokenId = activeTab === 'yes' ? yesTokenId : noTokenId
  const hasYes = !!yesTokenId
  const hasNo = !!noTokenId

  if (!hasYes && !hasNo) {
    return (
      <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-4 h-[420px] flex items-center justify-center">
        <p className="text-small text-text-muted">Select an outcome to view order book</p>
      </div>
    )
  }

  return (
    <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 overflow-hidden flex flex-col h-[420px]">
      <div className="flex items-center justify-between border-b border-white/10">
        <div className="flex">
          {hasYes && (
            <button
              type="button"
              onClick={() => setActiveTab('yes')}
              className={cn(
                'px-4 py-3 text-small font-medium transition-colors border-b-2',
                activeTab === 'yes'
                  ? 'border-status-success text-status-success'
                  : 'border-transparent text-text-muted hover:text-text-body'
              )}
            >
              Trade Yes
            </button>
          )}
          {hasNo && (
            <button
              type="button"
              onClick={() => setActiveTab('no')}
              className={cn(
                'px-4 py-3 text-small font-medium transition-colors border-b-2',
                activeTab === 'no'
                  ? 'border-status-error text-status-error'
                  : 'border-transparent text-text-muted hover:text-text-body'
              )}
            >
              Trade No
            </button>
          )}
        </div>
      </div>
      {tokenId ? (
        <BookContent tokenId={tokenId} onPriceClick={onPriceClick} />
      ) : (
        <div className="flex-1 flex items-center justify-center py-8 text-text-muted text-small">No data</div>
      )}
    </div>
  )
}
