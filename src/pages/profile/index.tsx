import { useAccount } from 'wagmi'
import { ConnectedPlatforms } from '@/widgets/connected-platforms'
import { BalancesSection } from '@/widgets/balances-section'
import { CopyTradingSection } from '@/widgets/copy-trading-section'
import { PositionsSection } from '@/widgets/positions-section'
import { TransactionHistory } from '@/widgets/transaction-history'

export function ProfilePage() {
  useAccount()

  return (
    <div className="max-w-[1920px] mx-auto px-6 py-8">
      <h1 className="text-h1 font-bold text-text-primary mb-8">Profile</h1>

      <div className="flex gap-6">
        <aside className="w-[18%] min-w-[160px] max-w-[200px] shrink-0" aria-hidden />
        <main className="flex-1 min-w-0">
          <section className="mb-10">
            <ConnectedPlatforms />
          </section>
          <section className="mb-10">
            <BalancesSection />
          </section>
          <section id="copy-trading" className="mb-10 scroll-mt-8">
            <CopyTradingSection />
          </section>
          <section className="mb-10">
            <PositionsSection />
          </section>
          <section id="history">
            <TransactionHistory />
          </section>
        </main>
        <aside className="w-[18%] min-w-[160px] max-w-[200px] shrink-0" aria-hidden />
      </div>
    </div>
  )
}
