import { useMemo, useRef, useEffect } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchEvents, type EventsOrder } from '@/shared/api/polymarket'
import type { PolymarketEvent } from '@/entities/market/types'

const PAGE_SIZE = 24

/** Stable date window for "Ending Soon" - rounded to start of hour to avoid refetch spam */
function getEndingSoonWindow(): { min: string; max: string } | null {
  const hourMs = 60 * 60 * 1000
  const dayMs = 24 * hourMs
  const now = Date.now()
  const startOfHour = new Date(Math.floor(now / hourMs) * hourMs)
  return {
    min: startOfHour.toISOString(),
    max: new Date(startOfHour.getTime() + 7 * dayMs).toISOString(),
  }
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

function MarketCard({ event, featuredIds }: { event: PolymarketEvent; featuredIds: string[] }) {
  if (featuredIds.includes(event.id)) return null
  const slug = (event.slug ?? event.id).toString()
  const markets = event.markets ?? []
  const first = markets[0]
  const prices = first?.outcomePrices ? parsePrices(first.outcomePrices) : parsePrices(null)
  const yesPct = prices.yes * 100
  const vol = event.volumeNum ?? Number(event.volume ?? 0) ?? 0
  const endDate = event.endDate ?? first?.endDate

  return (
    <Link
      to={`/market/${slug}`}
      className="block rounded-panel overflow-hidden border border-white/10 bg-bg-secondary/80 backdrop-blur-panel p-4 transition-all duration-200 hover:border-accent-violet/30 hover:shadow-glow hover:-translate-y-0.5"
    >
      <div className="flex gap-3">
        <div className="w-20 h-20 shrink-0 rounded-panel bg-bg-tertiary flex items-center justify-center overflow-hidden">
          {event.image ? (
            <img src={event.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl text-text-muted">?</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text-primary line-clamp-2 text-small">
            {event.title ?? event.ticker ?? event.id}
          </h3>
          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden bg-bg-tertiary flex">
            <div
              className="h-full bg-gradient-to-r from-status-success to-status-error transition-all duration-300"
              style={{ width: `${yesPct}%` }}
            />
          </div>
          <div className="flex gap-3 mt-1 text-tiny text-text-muted">
            <span>Vol ${(vol / 1e6).toFixed(2)}M</span>
            <span>Resolves {endDate ? new Date(endDate).toLocaleDateString() : '—'}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

interface MarketsGridProps {
  categorySlug?: string
  liquidityMin?: number
  endingSoon?: boolean
  highRoi?: boolean
  liveNow?: boolean
  trending?: boolean
  sort?: EventsOrder
  hideSports?: boolean
  hideCrypto?: boolean
  hidePolitics?: boolean
  searchQuery?: string
  status?: 'Active' | 'Pending' | 'Resolved' | 'All'
}

export function MarketsGrid({
  categorySlug,
  liquidityMin,
  endingSoon,
  highRoi: _highRoi,
  liveNow,
  trending: _trending,
  sort = 'volume',
  status,
  hideSports,
  hideCrypto,
  hidePolitics,
  searchQuery,
}: MarketsGridProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const { data: featuredEvents = [] } = useQuery({
    queryKey: ['events', 'featured', { limit: 3, featured: true, active: true, closed: false }],
    queryFn: () => fetchEvents({ limit: 3, featured: true, active: true, closed: false }),
  })
  const featuredIds = useMemo(() => featuredEvents.map((e) => e.id), [featuredEvents])

  const endingSoonWindow = useMemo(() => (endingSoon ? getEndingSoonWindow() : null), [endingSoon])

  const apiActive = useMemo(() => {
    if (status === 'Resolved') return false
    if (status === 'Active' || liveNow) return true
    return undefined
  }, [status, liveNow])

  const apiClosed = useMemo(() => {
    if (status === 'Resolved') return true
    if (status === 'Active' || liveNow) return false
    return undefined
  }, [status, liveNow])

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: [
      'events',
      'infinite',
      status,
      {
        tag_slug: categorySlug,
        liquidity_min: liquidityMin,
        active: apiActive,
        closed: apiClosed,
        order: sort,
        end_date_min: endingSoonWindow?.min,
        end_date_max: endingSoonWindow?.max,
      },
    ],
    queryFn: ({ pageParam = 0 }) =>
      fetchEvents({
        limit: PAGE_SIZE,
        offset: pageParam,
        tag_slug: categorySlug,
        active: apiActive,
        liquidity_min: liquidityMin,
        order: sort,
        ascending: sort === 'end_date_asc',
        end_date_min: endingSoonWindow?.min,
        end_date_max: endingSoonWindow?.max,
        closed: apiClosed,
      }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined
      return allPages.length * PAGE_SIZE
    },
    initialPageParam: 0,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const events = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p).filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i),
    [data]
  )

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const el = loadMoreRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage()
      },
      { rootMargin: '200px', threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const filtered = useMemo(() => {
    let list = events.filter((e) => !featuredIds.includes(e.id))
    const now = Date.now()
    if (status === 'Active' || liveNow) {
      list = list.filter((e) => {
        if (e.closed === true) return false
        const m = e.markets?.[0]
        if (m?.closed === true) return false
        const endDate = e.endDate ?? m?.endDate
        if (endDate && new Date(endDate).getTime() < now) return false
        return true
      })
    } else if (status === 'Resolved') {
      list = list.filter((e) => {
        if (e.closed === true) return true
        const m = e.markets?.[0]
        if (m?.closed === true) return true
        const endDate = e.endDate ?? m?.endDate
        if (endDate && new Date(endDate).getTime() < now) return true
        return false
      })
    }
    const q = (searchQuery ?? '').toLowerCase().trim()
    if (q) {
      list = list.filter(
        (e) =>
          (e.title ?? '').toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q) ||
          (e.ticker ?? '').toLowerCase().includes(q)
      )
    }
    if (hideSports) {
      list = list.filter((e) => !e.tags?.some((t) => (t.slug ?? t.label ?? '').toLowerCase().includes('sport')))
    }
    if (hideCrypto) {
      list = list.filter((e) => !e.tags?.some((t) => (t.slug ?? t.label ?? '').toLowerCase().includes('crypto')))
    }
    if (hidePolitics) {
      list = list.filter((e) => !e.tags?.some((t) => (t.slug ?? t.label ?? '').toLowerCase().includes('politic')))
    }
    // Client-side sort (Gamma API returns 422 for start_date/end_date)
    if (sort === 'end_date_asc') {
      list = [...list].sort((a, b) => {
        const da = new Date(a.endDate ?? a.markets?.[0]?.endDate ?? 0).getTime()
        const db = new Date(b.endDate ?? b.markets?.[0]?.endDate ?? 0).getTime()
        return da - db
      })
    } else if (sort === 'newest') {
      list = [...list].sort((a, b) => {
        const da = new Date(a.startDate ?? 0).getTime()
        const db = new Date(b.startDate ?? 0).getTime()
        return db - da
      })
    } else if (sort === 'liquidity') {
      list = [...list].sort((a, b) => (b.liquidityNum ?? 0) - (a.liquidityNum ?? 0))
    } else {
      list = [...list].sort((a, b) => (b.volumeNum ?? 0) - (a.volumeNum ?? 0))
    }
    return list
  }, [events, featuredIds, searchQuery, hideSports, hideCrypto, hidePolitics, status, liveNow, sort])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-28 rounded-panel bg-bg-secondary/50 animate-pulse" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-panel bg-bg-secondary/50 border border-white/10 p-12 text-center">
        <p className="text-status-error text-body">Failed to load markets</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 px-4 py-2 rounded-panel bg-bg-tertiary border border-white/10 text-small hover:bg-white/5"
        >
          Retry
        </button>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-panel bg-bg-secondary/50 border border-white/10 p-12 text-center">
        <p className="text-text-muted text-body">No markets found</p>
        <a href="/" className="mt-2 inline-block text-accent-violet hover:underline text-small">
          Reset filters
        </a>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((event) => (
          <MarketCard key={event.id} event={event} featuredIds={featuredIds} />
        ))}
      </div>
      <div ref={loadMoreRef} className="min-h-[24px] flex items-center justify-center py-4">
        {isFetchingNextPage && (
          <span className="text-small text-text-muted">Loading more...</span>
        )}
        {!hasNextPage && events.length >= PAGE_SIZE && (
          <span className="text-small text-text-muted">No more markets</span>
        )}
      </div>
    </>
  )
}
