import { useState } from 'react'
import { Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { fetchPositions, fetchClosedPositions, type DataPosition } from '@/shared/api/polymarket'
import { usePolymarketProxy } from '@/shared/hooks/use-polymarket-proxy'
import { cn } from '@/shared/lib/cn'

/** Positions are loaded by proxy address (Data API), not EOA (same as reference). */
export function PositionsSection() {
  const { address, isConnected } = useAccount()
  const { proxy, isLoading: proxyLoading } = usePolymarketProxy(address ?? undefined)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open')

  const user = proxy ?? undefined

  const { data: openPositions = [], isLoading: openLoading } = useQuery({
    queryKey: ['positions', 'open', user],
    queryFn: () => fetchPositions({ user: user!, limit: 100 }),
    enabled: !!user && filter !== 'closed',
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const { data: closedPositions = [], isLoading: closedLoading } = useQuery({
    queryKey: ['positions', 'closed', user],
    queryFn: () => fetchClosedPositions({ user: user!, limit: 100 }),
    enabled: !!user && filter !== 'open',
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const positions: DataPosition[] = filter === 'open' ? openPositions : filter === 'closed' ? closedPositions : [...openPositions, ...closedPositions]
  const filtered = search.trim()
    ? positions.filter((p) => (p.title ?? '').toLowerCase().includes(search.toLowerCase()))
    : positions
  const isLoading =
    (isConnected && !!address && proxyLoading && !user) ||
    (filter === 'open' ? openLoading : filter === 'closed' ? closedLoading : openLoading || closedLoading)

  return (
    <>
      <h2 className="text-h3 font-bold text-text-primary mb-4">Your Positions</h2>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-panel bg-bg-secondary border border-white/10 text-body outline-none focus:border-accent-violet/50"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'open' | 'closed')}
          className="h-10 px-3 rounded-panel bg-bg-secondary border border-white/10 text-body"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
      </div>

      {!isConnected || !address ? (
        <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-8 text-center">
          <p className="text-text-muted text-body">Connect your wallet to see positions.</p>
        </div>
      ) : isLoading ? (
        <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-8 text-center">
          <p className="text-text-muted text-body">Loading positions...</p>
        </div>
      ) : !proxyLoading && !user && isConnected && address ? (
        <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-8 text-center">
          <p className="text-text-muted text-body">No Polymarket proxy found for this wallet.</p>
          <p className="text-tiny text-text-muted mt-1">Link Polymarket in Connected Platforms to trade and see positions.</p>
          <Link to="/profile" className="mt-2 inline-block text-accent-violet hover:underline text-small">
            Go to Profile
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 p-8 text-center">
          <p className="text-text-muted text-body">No positions yet.</p>
          <Link to="/" className="mt-2 inline-block text-accent-violet hover:underline text-small">
            Browse markets
          </Link>
        </div>
      ) : (
        <div className="rounded-panel bg-bg-secondary/80 backdrop-blur-panel border border-white/10 overflow-hidden">
          <div className="divide-y divide-white/5">
            {filtered.map((pos) => (
              <div
                key={`${pos.conditionId}-${pos.asset}`}
                className="p-4 hover:bg-white/5 flex flex-wrap items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    to={pos.eventSlug ? `/market/${pos.eventSlug}` : '#'}
                    className="font-medium text-text-primary hover:text-accent-violet break-words"
                  >
                    {pos.title ?? 'Unknown'}
                  </Link>
                  <div className="text-tiny text-text-muted mt-0.5 break-words">
                    {pos.outcome} · {pos.size != null ? pos.size.toFixed(2) : '—'} shares
                    {pos.avgPrice != null && ` @ ${(pos.avgPrice * 100).toFixed(1)}¢`}
                  </div>
                </div>
                <div className="text-right">
                  {pos.curPrice != null && (
                    <span className="text-small text-text-body">{(pos.curPrice * 100).toFixed(1)}¢</span>
                  )}
                  {pos.cashPnl != null && (
                    <div className={cn('text-small font-mono', pos.cashPnl >= 0 ? 'text-status-success' : 'text-status-error')}>
                      {pos.cashPnl >= 0 ? '+' : ''}{pos.cashPnl.toFixed(2)} ({pos.percentPnl != null ? `${pos.percentPnl >= 0 ? '+' : ''}${pos.percentPnl.toFixed(1)}%` : '—'})
                    </div>
                  )}
                </div>
                <Link
                  to={pos.eventSlug ? `/market/${pos.eventSlug}` : '#'}
                  className="text-small text-accent-violet hover:underline"
                >
                  View
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
