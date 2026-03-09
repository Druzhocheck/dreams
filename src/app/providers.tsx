import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { avalanche, polygon, gnosis } from 'wagmi/chains'
import type { ReactNode } from 'react'
import { BridgeModalsProvider, useBridgeModals } from '@/shared/context/bridge-modals'
import { TradingProvider } from '@/shared/context/trading-context'
import { DepositModal } from '@/features/deposit/deposit-modal'
import { WithdrawModal } from '@/features/withdraw/withdraw-modal'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60 * 1000, refetchOnWindowFocus: false },
  },
})

const config = createConfig({
  chains: [avalanche, polygon, gnosis],
  connectors: [injected()],
  transports: {
    [avalanche.id]: http(),
    [polygon.id]: http(),
    [gnosis.id]: http(),
  },
})

function BridgeModals() {
  const { openModal, closeModal } = useBridgeModals()
  if (openModal === 'deposit') return <DepositModal onClose={closeModal} />
  if (openModal === 'withdraw') return <WithdrawModal platformName="Polymarket" onClose={closeModal} />
  return null
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BridgeModalsProvider>
          <TradingProvider>
            {children}
            <BridgeModals />
          </TradingProvider>
        </BridgeModalsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
