import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildHmacSignature } from '@polymarket/builder-signing-sdk'
import { ethers } from 'ethers'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = Number(process.env.PORT || 3001)
const CLOB_HOST = (process.env.CLOB_HOST || 'https://clob.polymarket.com').replace(/\/$/, '')
const GAMMA_HOST = (process.env.GAMMA_HOST || 'https://gamma-api.polymarket.com').replace(/\/$/, '')
const DATA_HOST = (process.env.DATA_HOST || 'https://data-api.polymarket.com').replace(/\/$/, '')
const BRIDGE_HOST = (process.env.BRIDGE_HOST || 'https://bridge.polymarket.com').replace(/\/$/, '')
const RELAYER_URL = String(process.env.RELAYER_URL || '')
const BUILDER_API_KEY = String(process.env.BUILDER_API_KEY || '')
const BUILDER_SECRET = String(process.env.BUILDER_SECRET || '')
const BUILDER_PASSPHRASE = String(process.env.BUILDER_PASSPHRASE || '')
const RELAY_API_BASE = (process.env.RELAY_API_BASE || 'https://api.relay.link').replace(/\/$/, '')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROXY_STORE_PATH = path.join(__dirname, '..', 'data', 'proxy-store.json')

// In-memory stores with disk persistence for proxy mapping
const credsStore = new Map()
const deployedProxyStore = new Map()

const POLYGON_SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b'
const SAFE_INIT_CODE_HASH = '0x2bce2127ff07fb632d16c8347c4ebf501f4841168bed00d9e6ef715ddb6fcecf'
const AVALANCHE_CHAIN_ID = 43114
const POLYGON_CHAIN_ID = 137
const USDC_AVALANCHE = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'

const { defaultAbiCoder, getCreate2Address, keccak256, verifyMessage } = ethers.utils

function buildActionAuthMessage({ action, eoa, proxyAddress, timestamp }) {
  return [
    'Polymarket Avalanche Authorization',
    `action:${action}`,
    `eoa:${String(eoa || '').toLowerCase()}`,
    'nonce:',
    'requestId:',
    `proxy:${proxyAddress ? String(proxyAddress).toLowerCase() : ''}`,
    `timestamp:${timestamp}`,
  ].join('\n')
}

function verifyDeployAuth({ eoa, proxyAddress, signature, timestamp }) {
  if (!signature || !Number.isFinite(timestamp)) return { ok: false, error: 'Missing auth signature or timestamp' }
  // 10-minute skew guard
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(timestamp)) > 600) return { ok: false, error: 'Auth signature expired' }
  const expected = String(eoa).toLowerCase()
  const message = buildActionAuthMessage({ action: 'deployed_proxy', eoa, proxyAddress, timestamp })
  try {
    const recovered = verifyMessage(message, signature).toLowerCase()
    if (recovered !== expected) return { ok: false, error: 'Invalid auth signature' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Auth verification failed' }
  }
}

function l1Headers({ address, signature, timestamp, nonce }) {
  return {
    'Content-Type': 'application/json',
    POLY_ADDRESS: address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: String(timestamp),
    POLY_NONCE: String(nonce),
  }
}

function _trunc(s) {
  if (typeof s !== 'string') return String(s)
  return s.length <= 14 ? s : s.slice(0, 10) + '…'
}

async function loadProxyStore() {
  try {
    const txt = await fs.readFile(PROXY_STORE_PATH, 'utf8')
    const parsed = JSON.parse(txt)
    if (parsed && typeof parsed === 'object') {
      for (const [eoa, proxy] of Object.entries(parsed)) {
        if (String(eoa).startsWith('0x') && String(proxy).startsWith('0x')) {
          deployedProxyStore.set(String(eoa).toLowerCase(), String(proxy).toLowerCase())
        }
      }
    }
    console.log('[ave-backend] proxy-store loaded', { size: deployedProxyStore.size })
  } catch {
    // First run: no file yet.
  }
}

async function persistProxyStore() {
  await fs.mkdir(path.dirname(PROXY_STORE_PATH), { recursive: true })
  const obj = Object.fromEntries(deployedProxyStore.entries())
  await fs.writeFile(PROXY_STORE_PATH, JSON.stringify(obj, null, 2), 'utf8')
}

async function getProxyWallet(eoa) {
  const key = eoa.toLowerCase()
  const deployed = deployedProxyStore.get(key)
  console.log('[ave-backend] getProxyWallet', { eoa: _trunc(eoa), key: _trunc(key), fromStore: !!deployed, storeSize: deployedProxyStore.size })
  if (deployed) return deployed
  try {
    const url = `${GAMMA_HOST}/public-profile?address=${encodeURIComponent(eoa)}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const proxy = data?.proxyWallet ?? null
    if (proxy && String(proxy).startsWith('0x')) {
      deployedProxyStore.set(key, String(proxy).toLowerCase())
      await persistProxyStore().catch(() => {})
    }
    return proxy
  } catch {
    return null
  }
}

async function getServerTime() {
  const fallback = Math.floor(Date.now() / 1000)
  try {
    const res = await fetch(`${CLOB_HOST}/time`)
    if (!res.ok) return fallback
    const txt = await res.text()
    const n = Number(txt.trim())
    if (Number.isFinite(n)) return n
    const j = JSON.parse(txt)
    return Number(j?.timestamp ?? j?.time ?? fallback)
  } catch {
    return fallback
  }
}

async function deriveApiKey({ address, signature, timestamp, nonce }) {
  const res = await fetch(`${CLOB_HOST}/auth/derive-api-key`, {
    method: 'GET',
    headers: l1Headers({ address, signature, timestamp, nonce }),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.apiKey || !data?.secret || !data?.passphrase) return null
  return data
}

async function createApiKey({ address, signature, timestamp, nonce }) {
  const res = await fetch(`${CLOB_HOST}/auth/api-key`, {
    method: 'POST',
    headers: l1Headers({ address, signature, timestamp, nonce }),
    body: JSON.stringify({}),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    return { ok: false, status: res.status, error: text || `CLOB api-key failed: ${res.status}` }
  }
  try {
    const data = JSON.parse(text)
    if (!data?.apiKey || !data?.secret || !data?.passphrase) {
      return { ok: false, status: 500, error: 'CLOB returned malformed api key payload' }
    }
    return { ok: true, data }
  } catch {
    return { ok: false, status: 500, error: 'CLOB returned non-JSON api key payload' }
  }
}

async function relayFetch(path, init = {}) {
  const res = await fetch(`${RELAY_API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (!res.ok) {
    let msg = `Relay API ${res.status}`
    try {
      const data = await res.json()
      if (data?.message || data?.error) msg = String(data?.message || data?.error)
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json()
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

// Proxy for Polymarket APIs (avoids CORS from frontend)
async function proxyTo(baseUrl, req, res) {
  const subpath = (req.path || req.url || '').replace(/^\/+/, '')
  const qs = req.originalUrl?.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
  const url = `${baseUrl}/${subpath}${qs}`
  try {
    const init = { method: req.method, headers: { 'Content-Type': 'application/json' } }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body || {}).length) {
      init.body = JSON.stringify(req.body)
    }
    const r = await fetch(url, init)
    const text = await r.text()
    res.status(r.status).set('Content-Type', r.headers.get('Content-Type') || 'application/json').send(text)
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Proxy failed' })
  }
}
app.use('/proxy/gamma', (req, res) => proxyTo(GAMMA_HOST, req, res))
app.use('/proxy/data', (req, res) => proxyTo(DATA_HOST, req, res))
app.use('/proxy/bridge', (req, res) => proxyTo(BRIDGE_HOST, req, res))

app.get('/onboard/relayer-config', (_req, res) => {
  const canDeployProxy = !!(RELAYER_URL && BUILDER_API_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE)
  return res.json({ relayerUrl: RELAYER_URL, canDeployProxy })
})

app.post('/onboard/builder-sign', (req, res) => {
  if (!BUILDER_API_KEY || !BUILDER_SECRET || !BUILDER_PASSPHRASE) {
    return res.status(503).json({ error: 'Builder credentials not configured' })
  }
  const { method, path, body, timestamp } = req.body || {}
  if (!method || !path) return res.status(400).json({ error: 'Missing method or path' })
  const ts = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Math.floor(Date.now() / 1000)
  const signature = buildHmacSignature(BUILDER_SECRET, ts, method, path, body)
  return res.json({
    POLY_BUILDER_API_KEY: BUILDER_API_KEY,
    POLY_BUILDER_TIMESTAMP: String(ts),
    POLY_BUILDER_PASSPHRASE: BUILDER_PASSPHRASE,
    POLY_BUILDER_SIGNATURE: signature,
  })
})

app.get('/onboard/status', (req, res) => {
  const eoa = String(req.query.eoa || '').toLowerCase()
  if (!eoa.startsWith('0x')) return res.status(400).json({ error: 'Missing or invalid eoa' })
  return res.json({ linked: credsStore.has(eoa) })
})

app.get('/onboard/requirements', async (req, res) => {
  const eoa = String(req.query.eoa || '').toLowerCase()
  if (!eoa.startsWith('0x')) return res.status(400).json({ error: 'Missing or invalid eoa' })
  const proxy = await getProxyWallet(eoa)
  const payload = {
    linked: credsStore.has(eoa),
    needSignature: !credsStore.has(eoa),
    hasProxy: !!proxy,
    proxyWallet: proxy ?? null,
    canDeployProxy: !!(RELAYER_URL && BUILDER_API_KEY && BUILDER_SECRET && BUILDER_PASSPHRASE) && !proxy,
  }
  console.log('[ave-backend] GET /onboard/requirements', { eoa: _trunc(eoa), hasProxy: !!proxy, proxyWallet: _trunc(proxy) })
  return res.json(payload)
})

app.get('/onboard/derived-safe', (req, res) => {
  const eoa = String(req.query.eoa || '').toLowerCase()
  if (!eoa.startsWith('0x')) return res.status(400).json({ error: 'Missing or invalid eoa' })
  const salt = keccak256(defaultAbiCoder.encode(['address'], [eoa]))
  const proxyAddress = getCreate2Address(POLYGON_SAFE_FACTORY, salt, SAFE_INIT_CODE_HASH)
  return res.json({ proxyAddress })
})

app.post('/onboard/deployed-proxy', (req, res) => {
  const eoa = String(req.body?.eoa || '').toLowerCase()
  const proxyAddress = String(req.body?.proxyAddress || '').toLowerCase()
  const auth = req.body?.auth || {}
  if (!eoa.startsWith('0x') || !proxyAddress.startsWith('0x')) {
    return res.status(400).json({ error: 'Missing or invalid eoa or proxyAddress' })
  }
  const check = verifyDeployAuth({
    eoa,
    proxyAddress,
    signature: auth.signature,
    timestamp: Number(auth.timestamp),
  })
  if (!check.ok) return res.status(401).json({ error: check.error })
  deployedProxyStore.set(eoa, proxyAddress)
  persistProxyStore().catch(() => {})
  console.log('[ave-backend] deployed-proxy registered', { eoa: _trunc(eoa), proxyAddress: _trunc(proxyAddress), storeSize: deployedProxyStore.size, storeKeys: [...deployedProxyStore.keys()].map(_trunc) })
  return res.json({ success: true })
})

app.get('/onboard/sign-payload', async (req, res) => {
  const eoa = String(req.query.eoa || '').toLowerCase()
  const chainId = Number(req.query.chainId || 137)
  if (!eoa.startsWith('0x')) return res.status(400).json({ error: 'Missing or invalid eoa' })
  const timestamp = chainId === 137 ? await getServerTime() : Math.floor(Date.now() / 1000)
  const nonce = 0
  return res.json({
    domain: { name: 'ClobAuthDomain', version: '1', chainId },
    types: {
      ClobAuth: [
        { name: 'address', type: 'address' },
        { name: 'timestamp', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'message', type: 'string' },
      ],
    },
    message: {
      address: eoa,
      timestamp: String(timestamp),
      nonce,
      message: 'This message attests that I control the given wallet',
    },
    timestamp,
    nonce,
  })
})

app.post('/onboard/create', async (req, res) => {
  const eoa = String(req.body?.eoa || '').toLowerCase()
  const signature = String(req.body?.signature || '')
  const timestamp = Number(req.body?.timestamp)
  const nonce = Number(req.body?.nonce ?? 0)
  if (!eoa.startsWith('0x') || !signature || !Number.isFinite(timestamp)) {
    return res.status(400).json({ error: 'Missing eoa, signature, timestamp, or nonce' })
  }
  const params = { address: eoa, signature, timestamp, nonce }
  let creds = await deriveApiKey(params)
  if (!creds) {
    const created = await createApiKey(params)
    if (!created.ok) {
      const needsPolymarketAccount = created.status === 400 && /Could not create api key/i.test(created.error || '')
      return res.status(422).json({
        error: created.error || 'Could not create api key',
        needsPolymarketAccount,
      })
    }
    creds = created.data
  }
  credsStore.set(eoa, creds)
  return res.json({ success: true, linked: true })
})

app.post('/onboard/unlink', (req, res) => {
  const eoa = String(req.body?.eoa || '').toLowerCase()
  if (!eoa.startsWith('0x')) return res.status(400).json({ error: 'Missing or invalid eoa' })
  const removed = credsStore.delete(eoa)
  return res.json({ success: true, removed })
})

app.get('/onboard/bridge/currencies', async (req, res) => {
  const chainId = Number(req.query.chainId || AVALANCHE_CHAIN_ID)
  if (!Number.isFinite(chainId)) return res.status(400).json({ error: 'Invalid chainId' })
  try {
    const list = await relayFetch('/currencies/v2', {
      method: 'POST',
      body: JSON.stringify({ chainIds: [chainId], limit: 100 }),
    })
    return res.json({ chainId, currencies: Array.isArray(list) ? list : [] })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to fetch currencies' })
  }
})

app.post('/onboard/bridge/quote', async (req, res) => {
  const { user, recipient, amount, amountWei, exactOutputUsdc, originCurrency } = req.body || {}
  const userAddr = String(user || '').toLowerCase()
  const recipientAddr = String(recipient || '').toLowerCase()
  if (!userAddr.startsWith('0x') || !recipientAddr.startsWith('0x')) {
    return res.status(400).json({ error: 'Missing or invalid user or recipient' })
  }

  const originToken = String(originCurrency || USDC_AVALANCHE).toLowerCase()
  const isUsdc = originToken === USDC_AVALANCHE.toLowerCase()
  let rawAmount = ''
  let tradeType = 'EXACT_INPUT'

  const exactOut = exactOutputUsdc != null ? String(exactOutputUsdc).trim() : ''
  if (exactOut) {
    const outNum = Number(exactOut)
    if (!Number.isFinite(outNum) || outNum <= 0) return res.status(400).json({ error: 'Invalid exactOutputUsdc' })
    rawAmount = String(Math.floor(outNum * 1e6))
    tradeType = 'EXACT_OUTPUT'
  } else if (amountWei != null && String(amountWei).trim() !== '') {
    rawAmount = String(amountWei).trim()
  } else if (isUsdc && amount != null) {
    rawAmount = String(Math.floor(Number(amount) * 1e6))
  } else {
    return res.status(400).json({ error: 'Provide amountWei, amount (USDC), or exactOutputUsdc' })
  }
  if (!rawAmount || BigInt(rawAmount) <= 0n) return res.status(400).json({ error: 'Invalid amount' })

  try {
    const quote = await relayFetch('/quote/v2', {
      method: 'POST',
      body: JSON.stringify({
        user: userAddr,
        recipient: recipientAddr,
        originChainId: AVALANCHE_CHAIN_ID,
        destinationChainId: POLYGON_CHAIN_ID,
        originCurrency: originToken.startsWith('0x') ? originToken : USDC_AVALANCHE,
        destinationCurrency: USDC_POLYGON,
        amount: rawAmount,
        tradeType,
      }),
    })
    return res.json(quote)
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Quote failed' })
  }
})

await loadProxyStore()
app.listen(PORT, () => {
  console.log(`[ave-backend] listening on ${PORT}`)
})
