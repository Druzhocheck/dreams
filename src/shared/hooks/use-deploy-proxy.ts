import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWalletClient } from 'wagmi'
import { polygon } from 'viem/chains'
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import { buildActionAuthMessage } from '@/shared/lib/request-auth'
import { getDerivedSafeAddress, ONBOARD_API } from '@/shared/api/onboard'
import { logger } from '@/shared/lib/logger'

const SAFE_ALREADY_DEPLOYED = 'safe already deployed!'

function walletClientForPolygon<T extends { chain?: { id: number } }>(client: T): T {
  return { ...client, chain: polygon } as T
}

/** Full URL for builder callback — backend must be reachable at this URL. */
function getBuilderSignUrl() {
  const base = ONBOARD_API.startsWith('http') ? ONBOARD_API : `${typeof window !== 'undefined' ? window.location.origin : ''}${ONBOARD_API}`
  return `${base}/builder-sign`
}

export function useDeployProxy(eoa: string | undefined) {
  const { data: walletClient } = useWalletClient()
  const queryClient = useQueryClient()
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  const { data: config } = useQuery({
    queryKey: ['onboard-relayer-config'],
    queryFn: async () => {
      const r = await fetch(`${ONBOARD_API}/relayer-config`)
      return r.json() as Promise<{ relayerUrl: string; canDeployProxy: boolean }>
    },
  })

  const deploy = useCallback(async () => {
    if (!eoa || !walletClient) {
      setDeployError('Wallet not connected')
      return null
    }
    if (!config?.canDeployProxy || !config?.relayerUrl) {
      setDeployError('Proxy deployment is not configured on backend')
      return null
    }
    setDeploying(true)
    setDeployError(null)
    try {
      const builderSignUrl = getBuilderSignUrl()
      logger.info('deployProxy: start', { eoa, builderSignUrl }, { component: 'deploy-proxy', function: 'deploy' })
      const builderConfig = new BuilderConfig({
        remoteBuilderConfig: { url: builderSignUrl },
      })
      const client = new RelayClient(
        config.relayerUrl,
        137,
        walletClientForPolygon(walletClient as never),
        builderConfig,
        RelayerTxType.SAFE
      )
      let proxyAddress: string | null = null
      try {
        const response = await client.deploy()
        const tx = await response.wait()
        proxyAddress = tx?.proxyAddress ?? null
      } catch (deployErr) {
        const deployMsg = deployErr instanceof Error ? deployErr.message : String(deployErr)
        if (deployMsg.toLowerCase().includes('safe already deployed') || deployMsg === SAFE_ALREADY_DEPLOYED) {
          logger.info('deployProxy: safe already deployed, resolving derived address', { eoa: eoa.slice(0, 10) + '…' }, { component: 'deploy-proxy', function: 'deploy' })
          proxyAddress = await getDerivedSafeAddress(eoa)
          if (!proxyAddress) throw new Error('Could not get derived proxy address')
        } else {
          throw deployErr
        }
      }
      if (!proxyAddress) throw new Error('Deploy did not return proxy address')

      const timestamp = Math.floor(Date.now() / 1000)
      const signature = await walletClient.signMessage({
        message: buildActionAuthMessage({
          action: 'deployed_proxy',
          eoa,
          proxyAddress,
          timestamp,
        }),
      })
      const reg = await fetch(`${ONBOARD_API}/deployed-proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eoa,
          proxyAddress,
          auth: { signature, timestamp },
        }),
      })
      if (!reg.ok) {
        const data = await reg.json().catch(() => ({}))
        throw new Error(data?.error ?? 'Could not register deployed proxy')
      }
      logger.info('deployProxy: success', { proxyAddress }, { component: 'deploy-proxy', function: 'deploy' })
      queryClient.invalidateQueries({ queryKey: ['polymarket-proxy', eoa.toLowerCase()] })
      return proxyAddress
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('deployProxy: failed', { message: msg }, undefined, { component: 'deploy-proxy', function: 'deploy' })
      setDeployError(msg)
      return null
    } finally {
      setDeploying(false)
    }
  }, [eoa, walletClient, config, queryClient])

  return {
    canDeploy: !!config?.canDeployProxy && !!eoa,
    deploying,
    deployError,
    deploy,
  }
}
