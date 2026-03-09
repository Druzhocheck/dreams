import { useQuery } from '@tanstack/react-query'
import { useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { polygon } from 'wagmi/chains'
import { fetchPositions } from '@/shared/api/polymarket'

const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const
const ERC20_BALANCE_ABI = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const

/**
 * Polymarket balance: USDC cash (on-chain proxy balance) + positions value (Data API), same as reference.
 */
export function usePolymarketBalance(proxy: string | null | undefined) {
  const { data: rawUsdc, isLoading: usdcLoading } = useReadContract({
    address: USDC_POLYGON,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: proxy && proxy.startsWith('0x') ? [proxy as `0x${string}`] : undefined,
    chainId: polygon.id,
  })

  const { data: positions = [], isLoading: positionsLoading } = useQuery({
    queryKey: ['positions', 'balance', proxy],
    queryFn: () => fetchPositions({ user: proxy!, limit: 200 }),
    enabled: !!proxy?.startsWith?.('0x'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const cash = rawUsdc != null ? Number(formatUnits(rawUsdc, 6)) : 0
  const positionsValue = positions.reduce((sum, p) => sum + (Number(p.currentValue ?? 0) || 0), 0)
  const total = cash + positionsValue
  const isLoading = usdcLoading || positionsLoading

  return { cash, positionsValue, total, isLoading }
}
