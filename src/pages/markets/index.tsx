import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MarketsSidebar } from '@/widgets/markets-sidebar'
import { FeaturedMarkets } from '@/widgets/featured-markets'
import { MarketsGrid } from '@/widgets/markets-grid'
import { ActivitySidebar } from '@/widgets/activity-sidebar'
import type { EventsOrder } from '@/shared/api/polymarket'
import { cn } from '@/shared/lib/cn'

const STORAGE_KEY = 'ave-markets-filters'
const SORT_OPTIONS: { label: string; value: EventsOrder }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Ending Soon', value: 'end_date_asc' },
  { label: 'Most Popular', value: 'volume' },
  { label: 'Highest Liquidity', value: 'liquidity' },
]
const CATEGORIES = ['All', 'Politics', 'Crypto', 'Sports', 'Science', 'Entertainment', 'Business', 'Other'] as const
const STATUS_OPTIONS = ['Active', 'Pending', 'Resolved', 'All'] as const

export function MarketsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const categorySlug = searchParams.get('category') ?? undefined
  const liquidityMin = searchParams.get('liquidity_min') ? Number(searchParams.get('liquidity_min')) : undefined
  const [endingSoon, setEndingSoon] = useState(false)
  const [highRoi, setHighRoi] = useState(false)
  const [liveNow, setLiveNow] = useState(false)
  const [trending, setTrending] = useState(false)
  const [sort, setSort] = useState<EventsOrder>(() => (searchParams.get('sort') as EventsOrder) || 'volume')
  const [status, setStatus] = useState<'Active' | 'Pending' | 'Resolved' | 'All'>('Active')
  const [hideSports, setHideSports] = useState(false)
  const [hideCrypto, setHideCrypto] = useState(false)
  const [hidePolitics, setHidePolitics] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>
        if (saved.hideSports) setHideSports(true)
        if (saved.hideCrypto) setHideCrypto(true)
        if (saved.hidePolitics) setHidePolitics(true)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hideSports, hideCrypto, hidePolitics })
      )
    } catch {
      // ignore
    }
  }, [hideSports, hideCrypto, hidePolitics])

  const syncUrl = useCallback(() => {
    const next = new URLSearchParams()
    if (categorySlug) next.set('category', categorySlug)
    if (liquidityMin != null && liquidityMin > 0) next.set('liquidity_min', String(liquidityMin))
    if (sort && sort !== 'volume') next.set('sort', sort)
    setSearchParams(next, { replace: true })
  }, [categorySlug, liquidityMin, sort, setSearchParams])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  const resetFilters = () => {
    setSearchParams({})
    setEndingSoon(false)
    setHighRoi(false)
    setLiveNow(false)
    setTrending(false)
    setSort('volume')
    setStatus('Active')
    setHideSports(false)
    setHideCrypto(false)
    setHidePolitics(false)
    setSearchQuery('')
  }

  const activeFilterCount = [categorySlug, liquidityMin, endingSoon, highRoi, liveNow, trending, sort !== 'volume', status !== 'Active', hideSports, hideCrypto, hidePolitics].filter(Boolean).length

  return (
    <div className="max-w-[1920px] mx-auto px-6 py-6 flex gap-6">
      <aside className="w-[280px] shrink-0 hidden lg:block">
        <MarketsSidebar
          categorySlug={categorySlug}
          liquidityMin={liquidityMin}
          endingSoon={endingSoon}
          highRoi={highRoi}
          liveNow={liveNow}
          trending={trending}
          onCategoryChange={(slug) => setSearchParams(slug ? { category: slug } : {})}
          onLiquidityChange={(v) => setSearchParams((p) => ({ ...Object.fromEntries(p), liquidity_min: String(v) }))}
          onEndingSoonChange={setEndingSoon}
          onHighRoiChange={setHighRoi}
          onLiveNowChange={setLiveNow}
          onTrendingChange={setTrending}
          onResetFilters={resetFilters}
        />
      </aside>

      <div className="flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-h1 font-bold text-text-primary">Markets</h1>
          <p className="text-body text-text-muted mt-1">
            {categorySlug
              ? `Prediction markets in ${categorySlug}`
              : 'Trade on outcome of real-world events across politics, crypto, sports and more.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select
            className={cn(
              'h-10 px-3 rounded-panel bg-bg-tertiary border text-small',
              sort !== 'volume' ? 'border-accent-violet/50' : 'border-white/10'
            )}
            value={sort}
            onChange={(e) => setSort(e.target.value as EventsOrder)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className={cn(
              'h-10 px-3 rounded-panel bg-bg-tertiary border text-small',
              categorySlug ? 'border-accent-violet/50' : 'border-white/10'
            )}
            value={categorySlug ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setSearchParams((prev) => {
                const p = new URLSearchParams(prev)
                if (v) p.set('category', v)
                else p.delete('category')
                return p
              })
            }}
          >
            <option value="">All</option>
            {CATEGORIES.filter((c) => c !== 'All').map((c) => (
              <option key={c} value={c.toLowerCase()}>{c}</option>
            ))}
          </select>
          <select
            className={cn(
              'h-10 px-3 rounded-panel bg-bg-tertiary border text-small',
              status !== 'Active' ? 'border-accent-violet/50' : 'border-white/10'
            )}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="Search markets..."
            className="h-10 px-3 rounded-panel bg-bg-tertiary border border-white/10 text-small min-w-[180px]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex gap-2 ml-auto flex-wrap">
            <label className="flex items-center gap-2 text-tiny text-text-muted cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-white/20 text-accent-violet"
                checked={hideSports}
                onChange={(e) => setHideSports(e.target.checked)}
              />
              Hide sports
            </label>
            <label className="flex items-center gap-2 text-tiny text-text-muted cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-white/20 text-accent-violet"
                checked={hideCrypto}
                onChange={(e) => setHideCrypto(e.target.checked)}
              />
              Hide crypto
            </label>
            <label className="flex items-center gap-2 text-tiny text-text-muted cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-white/20 text-accent-violet"
                checked={hidePolitics}
                onChange={(e) => setHidePolitics(e.target.checked)}
              />
              Hide politics
            </label>
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-tiny bg-bg-tertiary border border-white/10 hover:bg-white/5"
            >
              <span className="rounded-full bg-accent-violet/30 px-1.5">{activeFilterCount}</span>
              Reset all
            </button>
          )}
        </div>

        {status !== 'Resolved' && <FeaturedMarkets />}
        <MarketsGrid
          categorySlug={categorySlug}
          liquidityMin={liquidityMin}
          endingSoon={endingSoon}
          highRoi={highRoi}
          liveNow={liveNow}
          trending={trending}
          sort={sort}
          hideSports={hideSports}
          hideCrypto={hideCrypto}
          hidePolitics={hidePolitics}
          searchQuery={searchQuery || undefined}
          status={status}
        />
      </div>

      <aside className="w-[320px] shrink-0 hidden xl:block">
        <ActivitySidebar />
      </aside>
    </div>
  )
}
