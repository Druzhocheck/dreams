import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchEvents } from '@/shared/api/polymarket'
import type { PolymarketEvent } from '@/entities/market/types'
import { cn } from '@/shared/lib/cn'

function eventToSlug(e: PolymarketEvent): string {
  return (e.slug ?? e.id).toString()
}

function parsePrices(outcomePrices?: string | null): { yes: number; no: number } {
  if (!outcomePrices) return { yes: 0.5, no: 0.5 }
  try {
    const arr = JSON.parse(outcomePrices) as string[]
    const yes = arr[0] ? Number(arr[0]) : 0.5
    const no = arr[1] ? Number(arr[1]) : 1 - yes
    return { yes, no }
  } catch {
    return { yes: 0.5, no: 0.5 }
  }
}

function MarketCard({ event, className }: { event: PolymarketEvent; className?: string }) {
  const slug = eventToSlug(event)
  const markets = event.markets ?? []
  const first = markets[0]
  const prices = first?.outcomePrices ? parsePrices(first.outcomePrices) : parsePrices(null)
  const yesPct = prices.yes * 100
  const vol = event.volumeNum ?? Number(event.volume ?? 0) ?? 0
  const endDate = event.endDate ?? first?.endDate

  return (
    <Link
      to={`/market/${slug}`}
      className={cn(
        'block rounded-2xl overflow-hidden border border-white/10 bg-bg-secondary/80 backdrop-blur-panel p-4 transition-all duration-200 hover:scale-[1.02] hover:border-accent-violet/30 hover:shadow-glow-strong',
        className
      )}
    >
      <div className="flex gap-4">
        <div className="w-20 h-20 shrink-0 rounded-panel bg-bg-tertiary flex items-center justify-center overflow-hidden">
          {event.image ? (
            <img src={event.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl text-text-muted">?</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text-primary line-clamp-2 text-body">
            {event.title ?? event.ticker ?? event.id}
          </h3>
          <div className="mt-2 h-2 rounded-full overflow-hidden bg-bg-tertiary flex">
            <div
              className="h-full bg-gradient-to-r from-status-success to-status-error transition-all duration-300"
              style={{ width: `${yesPct}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-tiny text-text-muted">
            <span>Vol ${(vol / 1e6).toFixed(2)}M</span>
            <span>Resolves {endDate ? new Date(endDate).toLocaleDateString() : '—'}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

interface FeaturedMarketsProps {
  /** Reserved for future: exclude these from main grid */
  excludeFromGrid?: boolean
}

function isEventActive(e: PolymarketEvent): boolean {
  if (e.closed === true) return false
  const m = e.markets?.[0]
  if (m?.closed === true) return false
  const endDate = e.endDate ?? m?.endDate
  if (endDate && new Date(endDate).getTime() < Date.now()) return false
  return true
}

export function FeaturedMarkets(_props: FeaturedMarketsProps) {
  const { data: rawEvents = [], isLoading } = useQuery({
    queryKey: ['events', 'featured', { limit: 3, featured: true, active: true, closed: false }],
    queryFn: () => fetchEvents({ limit: 3, featured: true, active: true, closed: false }),
  })
  const events = rawEvents.filter(isEventActive).slice(0, 3)

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-bg-secondary/50 animate-pulse" />
        ))}
      </div>
    )
  }

  if (events.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="text-h3 font-bold text-text-primary mb-4">Featured Markets</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {events.slice(0, 3).map((event) => (
          <MarketCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  )
}

export function getFeaturedIds(events: PolymarketEvent[]): string[] {
  return events.map((e) => e.id).filter(Boolean)
}
