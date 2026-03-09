import { useState, useEffect } from 'react'
import { X, Copy, Check, ExternalLink } from 'lucide-react'
import { useAccount, useBalance } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useEnsureNetwork } from '@/shared/hooks/use-ensure-network'
import { usePolymarketProxy } from '@/shared/hooks/use-polymarket-proxy'
import { usePolymarketBalance } from '@/shared/hooks/use-polymarket-balance'
import { polygon } from 'wagmi/chains'
import { transferUsdcFromProxy } from '@/shared/api/safe-proxy'
import { cn } from '@/shared/lib/cn'
import { createWithdrawalAddresses, getBridgeStatus, type BridgeTransaction } from '@/shared/api/bridge'

const MIN_WITHDRAW_USD = 1
const POLYGON_CHAIN_ID = 137
const POLYGON_SCAN = 'https://polygonscan.com'
const AVALANCHE_USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const EPS = 1e-6
const WITHDRAW_HISTORY_KEY = 'ave.withdraw.history.v1'

function truncateAddr(addr: string, head = 8, tail = 6) {
  if (!addr || addr.length <= head + tail + 2) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

function parseAmountInput(value: string): number {
  const normalized = value.replace(',', '.').trim()
  const num = Number(normalized)
  return Number.isFinite(num) ? num : 0
}

interface WithdrawModalProps {
  platformName: string
  onClose: () => void
}

interface WithdrawalHistoryItem {
  id: string
  createdAt: number
  amount: number
  toChainId: string
  recipient: string
  bridgeAddress: string
  safeTxHash: string
  bridgeStatus?: BridgeTransaction['status']
  bridgeTxHash?: string
}

const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

function getToTokenAddress(chainId: string): string {
  if (chainId === '1') return USDC_ETHEREUM
  if (chainId === '43114') return AVALANCHE_USDC
  if (chainId === '8453') return USDC_BASE
  return USDC_POLYGON
}

const DESTINATION_CHAINS = [
  { chainId: '1', name: 'Ethereum' },
  { chainId: '137', name: 'Polygon' },
  { chainId: '43114', name: 'Avalanche' },
  { chainId: '8453', name: 'Base' },
] as const

const WITHDRAW_PLATFORMS = [{ id: 'polymarket', name: 'Polymarket' }] as const

export function WithdrawModal({ platformName: _platformName, onClose }: WithdrawModalProps) {
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()
  const { ensureNetwork } = useEnsureNetwork()
  const { proxy } = usePolymarketProxy(address ?? undefined)
  const { cash: proxyCash } = usePolymarketBalance(proxy)
  const [platform, setPlatform] = useState<string>(WITHDRAW_PLATFORMS[0].id)
  const [amount, setAmount] = useState('')
  const [toChainId, setToChainId] = useState('1')
  const [recipientAddr, setRecipientAddr] = useState('')
  const [useMyWallet, setUseMyWallet] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [withdrawAddress, setWithdrawAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawStep, setWithdrawStep] = useState<string | null>(null)
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null)
  const [bridgeTx, setBridgeTx] = useState<BridgeTransaction | null>(null)
  const [history, setHistory] = useState<WithdrawalHistoryItem[]>([])

  const amountNum = parseAmountInput(amount)
  const recipient = useMyWallet ? (address ?? '') : recipientAddr
  const recipientValid = recipient.length === 42 && recipient.startsWith('0x')

  const { data: usdcBalance } = useBalance({
    address: address ?? undefined,
    token: USDC_POLYGON as `0x${string}`,
    chainId: polygon.id,
  })
  const hasEnoughProxyBalance = amountNum <= proxyCash + EPS
  const validForAmount = recipientValid && amountNum >= MIN_WITHDRAW_USD && hasEnoughProxyBalance && !!proxy

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WITHDRAW_HISTORY_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as WithdrawalHistoryItem[]
      if (Array.isArray(parsed)) setHistory(parsed.slice(0, 12))
    } catch {
      // ignore corrupted local storage
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(WITHDRAW_HISTORY_KEY, JSON.stringify(history.slice(0, 12)))
    } catch {
      // ignore write errors
    }
  }, [history])

  useEffect(() => {
    setWithdrawAddress(null)
    setBridgeTx(null)
  }, [toChainId, recipient])

  useEffect(() => {
    if (!withdrawAddress || !withdrawTx) return
    let cancelled = false
    const pull = async () => {
      try {
        const s = await getBridgeStatus(withdrawAddress)
        if (cancelled) return
        const list = Array.isArray(s.transactions) ? s.transactions : []
        if (list.length > 0) {
          const current = list[0]
          setBridgeTx(current)
          setHistory((prev) =>
            prev.map((h) =>
              h.bridgeAddress.toLowerCase() === withdrawAddress.toLowerCase()
                ? {
                    ...h,
                    bridgeStatus: current.status,
                    bridgeTxHash: current.txHash ?? h.bridgeTxHash,
                  }
                : h
            )
          )
        }
      } catch {
        // Ignore polling errors; user still has tx hash on explorer.
      }
    }
    pull()
    const id = setInterval(pull, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [withdrawAddress, withdrawTx])

  const copyAddress = () => {
    if (!withdrawAddress) return
    navigator.clipboard.writeText(withdrawAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleWithdrawNow = async () => {
    if (!validForAmount || !proxy) return
    setError(null)
    setWithdrawTx(null)
    setBridgeTx(null)
    setWithdrawing(true)
    try {
      let targetAddress = withdrawAddress
      if (!targetAddress) {
        setWithdrawStep('Creating withdrawal address…')
        const toToken = getToTokenAddress(toChainId)
        const res = await createWithdrawalAddresses({
          address: proxy,
          toChainId,
          toTokenAddress: toToken,
          recipientAddr: recipient,
        })
        targetAddress = res.address?.evm ?? null
        if (!targetAddress) throw new Error('Could not create withdrawal address')
        setWithdrawAddress(targetAddress)
      }
      setWithdrawStep('Switching to Polygon…')
      const switched = await ensureNetwork(POLYGON_CHAIN_ID)
      if (!switched) throw new Error('Could not switch to Polygon')
      setWithdrawStep('Sign Safe transaction in wallet…')
      const hash = await transferUsdcFromProxy(proxy, targetAddress, amountNum)
      setWithdrawTx(hash)
      const item: WithdrawalHistoryItem = {
        id: `${Date.now()}-${hash.slice(2, 8)}`,
        createdAt: Date.now(),
        amount: amountNum,
        toChainId,
        recipient,
        bridgeAddress: targetAddress,
        safeTxHash: hash,
      }
      setHistory((prev) => [item, ...prev].slice(0, 12))
      setWithdrawStep(null)
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['positions', 'balance', proxy] })
      setTimeout(onClose, 3000)
    } catch (e) {
      setWithdrawStep(null)
      const msg = e instanceof Error ? e.message : 'Withdraw transaction failed'
      const lower = msg.toLowerCase()
      if (lower.includes('user rejected') || lower.includes('denied transaction')) {
        setError('Transaction cancelled in wallet.')
      } else if (lower.includes('insufficient funds for gas')) {
        setError('Not enough POL on Polygon for Safe transaction gas.')
      } else {
        setError(msg)
      }
    } finally {
      setWithdrawing(false)
      setWithdrawStep(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative rounded-panel-lg bg-bg-secondary border border-white/10 shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-h3 font-bold text-text-primary">Withdraw</h2>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-white/10 text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-small text-text-body block mb-1.5">Withdraw from site</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full h-10 px-3 rounded-panel bg-bg-tertiary border border-white/10 text-body outline-none focus:border-accent-violet/50"
          >
            {WITHDRAW_PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-tiny text-text-muted mt-1">
            Withdraw sends from your Polymarket (proxy) balance to the bridge. Requires POL for gas.
          </p>
          <p className="text-tiny text-status-warning mt-1">
            If funds get stuck on the bridge (not arriving at recipient), try smaller amounts. The bridge swaps USDC.e via Uniswap — pool liquidity may be limited. Check status below.
          </p>
        </div>

        {!isConnected || !address ? (
          <p className="text-body text-text-muted">Connect your wallet to withdraw.</p>
        ) : (
          <>
            <div className="mb-4">
              <label className="text-small text-text-body block mb-1">Destination chain</label>
              <select
                value={toChainId}
                onChange={(e) => setToChainId(e.target.value)}
                className="w-full h-10 px-3 rounded-panel bg-bg-tertiary border border-white/10 text-body"
              >
                {DESTINATION_CHAINS.map((c) => (
                  <option key={c.chainId} value={c.chainId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="text-small text-text-body block mb-1">Recipient</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setUseMyWallet(true)}
                  className={cn(
                    'flex-1 py-2 rounded-panel text-small',
                    useMyWallet ? 'bg-accent-violet/20 text-accent-violet border border-accent-violet/40' : 'bg-bg-tertiary border border-white/10'
                  )}
                >
                  My wallet
                </button>
                <button
                  type="button"
                  onClick={() => setUseMyWallet(false)}
                  className={cn(
                    'flex-1 py-2 rounded-panel text-small',
                    !useMyWallet ? 'bg-accent-violet/20 text-accent-violet border border-accent-violet/40' : 'bg-bg-tertiary border border-white/10'
                  )}
                >
                  Custom
                </button>
              </div>
              {useMyWallet ? (
                <div className="h-10 px-3 rounded-panel bg-bg-tertiary border border-white/10 flex items-center font-mono text-tiny text-text-muted truncate">
                  {address}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="0x..."
                  value={recipientAddr}
                  onChange={(e) => setRecipientAddr(e.target.value)}
                  className="w-full h-10 px-3 rounded-panel bg-bg-tertiary border border-white/10 font-mono text-small outline-none"
                />
              )}
            </div>

            <div className="mb-4">
              <label className="text-small text-text-body block mb-1">Amount (USDC.e) — min ${MIN_WITHDRAW_USD}</label>
              <p className="text-tiny text-text-muted mb-1">Balance on {WITHDRAW_PLATFORMS[0].name}: {proxyCash.toFixed(2)} USDC</p>
              {usdcBalance != null && (
                <p className="text-tiny text-text-muted mb-1">Balance on Polygon (EOA): {usdcBalance.formatted} USDC.e</p>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={cn(
                  'w-full h-12 px-3 rounded-panel bg-bg-tertiary border font-mono text-body outline-none',
                  amountNum >= MIN_WITHDRAW_USD ? 'border-status-success/50' : 'border-white/10'
                )}
              />
              {amountNum > 0 && !hasEnoughProxyBalance && (
                <p className="text-tiny text-status-error mt-1">
                  Not enough balance on {WITHDRAW_PLATFORMS[0].name}. Need {amountNum.toFixed(2)} USDC, available {proxyCash.toFixed(2)} USDC.
                </p>
              )}
            </div>

            {error && <p className="text-small text-status-error mb-2">{error}</p>}

            {withdrawAddress ? (
              <div className="rounded-panel bg-bg-tertiary/50 border border-white/10 p-3 mb-4">
                <p className="text-small text-text-body mb-2">
                  Bridge address: {truncateAddr(withdrawAddress, 10, 8)}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-tiny text-text-body break-all min-w-0 flex-1" title={withdrawAddress}>
                    {truncateAddr(withdrawAddress, 10, 8)}
                  </code>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={copyAddress} className="p-2 rounded hover:bg-white/10" title="Copy">
                      {copied ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <a
                      href={`${POLYGON_SCAN}/address/${withdrawAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded hover:bg-white/10 text-text-muted"
                      title="View on PolygonScan"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-tiny text-text-muted mb-3">
                Bridge address will be created when you click withdraw.
              </p>
            )}

            {withdrawStep && (
              <p className="text-tiny text-accent-blue mb-2">{withdrawStep}</p>
            )}
            <button
              type="button"
              disabled={!validForAmount || withdrawing}
              onClick={handleWithdrawNow}
              className="w-full h-11 rounded-panel bg-status-success hover:bg-status-success/90 text-white text-small font-medium disabled:opacity-50 disabled:cursor-not-allowed mt-2 mb-2"
            >
              {withdrawing ? (withdrawStep ?? 'Withdrawing…') : 'Withdraw now'}
            </button>
            {withdrawTx && (
              <p className="text-tiny text-status-success mb-2">
                Safe tx sent.{' '}
                <a
                  href={`${POLYGON_SCAN}/tx/${withdrawTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue hover:underline inline-flex items-center gap-1"
                >
                  View on PolygonScan <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            )}
            {bridgeTx && (
              <p className="text-tiny text-text-muted">
                Bridge status: <span className="font-mono">{bridgeTx.status}</span>
                {bridgeTx.txHash && (
                  <>
                    {' '}
                    · tx: <a href={`${POLYGON_SCAN}/tx/${bridgeTx.txHash}`} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">{truncateAddr(bridgeTx.txHash)}</a>
                  </>
                )}
              </p>
            )}
            {history.length > 0 && (
              <div className="mt-4 rounded-panel bg-bg-tertiary/40 border border-white/10 p-3">
                <p className="text-small text-text-body mb-2">Recent withdrawals</p>
                <div className="space-y-2">
                  {history.slice(0, 5).map((h) => (
                    <div key={h.id} className="text-tiny text-text-muted border border-white/10 rounded-panel p-2">
                      <p>
                        {h.amount.toFixed(2)} USDC.e → {DESTINATION_CHAINS.find((c) => c.chainId === h.toChainId)?.name ?? h.toChainId}
                      </p>
                      <p>
                        Status: <span className="font-mono">{h.bridgeStatus ?? 'SUBMITTED'}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <a
                          href={`${POLYGON_SCAN}/tx/${h.safeTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-blue hover:underline inline-flex items-center gap-1"
                        >
                          Safe tx <ExternalLink className="w-3 h-3" />
                        </a>
                        {h.bridgeTxHash && (
                          <a
                            href={`${POLYGON_SCAN}/tx/${h.bridgeTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-blue hover:underline inline-flex items-center gap-1"
                          >
                            Bridge tx <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
