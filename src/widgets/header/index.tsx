import { Link } from 'react-router-dom'
import { Search, Gem } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { cn } from '@/shared/lib/cn'
import { useSearchMarkets } from '@/features/search'
import { NetworkSelector } from './network-selector'
import { BalanceDropdown } from './balance-dropdown'
import { WalletButton } from './wallet-button'
import { ProfileDropdown } from './profile-dropdown'

export function Header() {
  useAccount()
  const [searchOpen, setSearchOpen] = useState(false)
  const { query, setQuery, results, isLoading, open, setOpen } = useSearchMarkets(300)

  const handleFocus = useCallback(() => {
    setSearchOpen(true)
    setOpen(true)
  }, [setOpen])

  const handleBlur = useCallback(() => {
    setTimeout(() => setSearchOpen(false), 150)
  }, [])

  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-50 bg-bg-secondary/90 backdrop-blur-panel border-b border-white/10">
      <div className="h-full max-w-[1920px] mx-auto px-4 flex items-center gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-0 shrink-0 text-text-primary font-bold text-lg tracking-tight"
        >
          <img
            src="/img/logo.png"
            alt="Dreams"
            className="h-[84px] w-auto object-contain block -mr-2"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              const fallback = target.parentElement?.querySelector('.logo-fallback')
              if (fallback) (fallback as HTMLElement).style.display = 'flex'
            }}
          />
          <span className="bg-gradient-to-r from-accent-violet to-accent-blue bg-clip-text text-transparent -ml-2">
            Dreams
          </span>
          <span className="logo-fallback flex items-center shrink-0" style={{ display: 'none' }}>
            <Gem className="w-6 h-6 text-accent-violet shrink-0" />
          </span>
        </Link>

        {/* Search - 40-50% width */}
        <div className="flex-1 max-w-[50%] min-w-[200px] relative">
          <div
            className={cn(
              'flex items-center gap-2 h-10 px-3 rounded-panel bg-bg-tertiary border transition-all duration-200',
              searchOpen ? 'border-accent-violet/60 shadow-glow' : 'border-white/10 hover:border-white/20'
            )}
          >
            <Search className="w-4 h-4 text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search events, markets..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              className="flex-1 min-w-0 bg-transparent text-text-body placeholder:text-text-muted text-small outline-none"
            />
            <kbd className="hidden sm:inline text-tiny text-text-muted border border-white/10 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </div>
          {open && (query.length > 0 || (results.events?.length ?? 0) > 0 || (results.markets?.length ?? 0) > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-panel bg-bg-secondary/95 backdrop-blur-panel border border-white/10 shadow-xl max-h-80 overflow-y-auto scrollbar-hover">
              {isLoading && (
                <div className="p-4 text-text-muted text-small">Loading...</div>
              )}
              {!isLoading && (
                <>
                  {(results.events?.length ?? 0) > 0 && (
                    <div className="p-2">
                      <div className="text-tiny text-text-muted uppercase px-2 py-1">Events</div>
                      {results.events!.slice(0, 5).map((e) => (
                        <Link
                          key={e.id}
                          to={`/market/${e.slug ?? e.id}`}
                          className="block px-2 py-2 rounded hover:bg-white/5 text-body"
                          onClick={() => setOpen(false)}
                        >
                          {e.title ?? e.ticker ?? e.id}
                        </Link>
                      ))}
                    </div>
                  )}
                  {(results.markets?.length ?? 0) > 0 && (
                    <div className="p-2">
                      <div className="text-tiny text-text-muted uppercase px-2 py-1">Markets</div>
                      {results.markets!.slice(0, 5).map((m) => (
                        <Link
                          key={m.id}
                          to={`/market/${m.slug ?? m.id}`}
                          className="block px-2 py-2 rounded hover:bg-white/5 text-body"
                          onClick={() => setOpen(false)}
                        >
                          {m.question ?? m.id}
                        </Link>
                      ))}
                    </div>
                  )}
                  {(results.events?.length ?? 0) === 0 && (results.markets?.length ?? 0) === 0 && query.length > 0 && (
                    <div className="p-4 text-text-muted text-small">No results</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 shrink-0">
          <NetworkSelector />
          <BalanceDropdown />
          <WalletButton />
          <ProfileDropdown />
        </div>
      </div>
    </header>
  )
}
