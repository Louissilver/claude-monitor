// Claude OAuth (mesmo fluxo do Claude Code) + endpoint oficial de usage.
//
// Diferenças deliberadas em relação ao Clauddy/Claude-Glass (ver docs/ADR-001):
//   - state OAuth é validado (comparação de tempo constante) antes de trocar o
//     code por tokens; `pending` expira em 10 min e é consumido em uma única
//     tentativa (R1).
//   - tokens nunca tocam disco em texto claro: são cifrados com `safeStorage`
//     do Electron (DPAPI no Windows) antes de gravar (R2). Sem DPAPI
//     disponível, o login é recusado — não há fallback para texto claro.
//   - escopo pedido é o mínimo necessário para ler perfil + usage; o app
//     nunca cria API keys, então `org:create_api_key` não é solicitado (R3).
//   - token colado manualmente precisa bater com o formato conhecido de
//     token OAuth da Anthropic antes de ser aceito (R8).
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { safeStorage } = require('electron')

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REDIRECT = 'https://platform.claude.com/oauth/code/callback'
const AUTHORIZE = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
// Escopo mínimo: só leitura de perfil e uso. Sem org:create_api_key — este
// app nunca cria API keys, então não há motivo para pedir esse poder.
const SCOPE = 'user:profile user:inference'
const UA = 'claude-cli/2.1.181 (external, cli)'
const DATA_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'claude-monitor')
  : path.join(os.homedir(), '.claude-monitor')
// Buffer binário cifrado (safeStorage), não JSON em texto claro.
const TOKEN_PATH = path.join(DATA_DIR, 'auth.enc')
const PENDING_TTL_MS = 10 * 60 * 1000

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Comparação de tempo constante que tolera tamanhos diferentes sem lançar
// exceção (timingSafeEqual exige buffers do mesmo tamanho).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

let tokens = null // { access_token, refresh_token, expires_at }
let pending = null // { verifier, state, createdAt }
let profile = null // { email, name, plan } — cache da identidade da conta

function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function load() {
  if (tokens) return tokens
  try {
    const enc = fs.readFileSync(TOKEN_PATH)
    tokens = JSON.parse(safeStorage.decryptString(enc))
  } catch {
    tokens = null
  }
  return tokens
}
function save(t) {
  if (!isEncryptionAvailable()) {
    throw Object.assign(new Error('secure storage unavailable on this system'), {
      code: 'NO_SECURE_STORAGE',
    })
  }
  tokens = t
  try {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true })
    const enc = safeStorage.encryptString(JSON.stringify(t))
    fs.writeFileSync(TOKEN_PATH, enc)
  } catch (e) {
    tokens = null
    throw e
  }
}
function clear() {
  tokens = null
  profile = null
  try {
    fs.unlinkSync(TOKEN_PATH)
  } catch {}
}
function isConnected() {
  return !!load()
}

// Etapa 1: monta a URL de autorização (abre no navegador)
function begin() {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(32))
  pending = { verifier, state, createdAt: Date.now() }
  const params = {
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${AUTHORIZE}?${query}`
}

// Etapa 2: troca o "code#state" colado pelos tokens
async function complete(pasted) {
  const raw = String(pasted).trim()
  // Token de longa duração colado diretamente (ex.: `claude setup-token`)
  // pula a troca de code — mas precisa bater com o formato conhecido.
  if (!raw.includes('#')) {
    if (!/^sk-ant-oat/.test(raw)) {
      throw new Error('formato de token inesperado (esperado prefixo sk-ant-oat)')
    }
    if (raw.length < 20 || raw.length > 500) {
      throw new Error('tamanho de token inesperado')
    }
    save({ access_token: raw, refresh_token: null, expires_at: Date.now() + 365 * 864e5 })
    pending = null
    return
  }
  if (!pending) throw new Error('nenhum login pendente — clique em "Entrar pelo navegador" primeiro')
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    pending = null
    throw new Error('login expirado — tente novamente')
  }
  const [code, returnedState] = raw.split('#')
  const expectedState = pending.state
  const verifier = pending.verifier
  // Consumido de uma vez: uma tentativa só, sucesso ou falha.
  pending = null
  if (!safeEqual(returnedState, expectedState)) {
    throw new Error('state OAuth não confere — login abortado por segurança')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state: expectedState,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`exchange ${res.status}: ${body.slice(0, 150)}`)
  }
  const j = await res.json()
  save({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
  })
}

async function refresh() {
  const t = load()
  if (!t?.refresh_token) throw Object.assign(new Error('no refresh token'), { status: 401 })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) {
    // grant rejeitado (refresh token expirado/revogado) = sessão morta.
    // falha transitória (429, 5xx) mantém o status para retry, não logout.
    const dead = res.status === 400 || res.status === 403
    throw Object.assign(new Error('refresh failed'), { status: dead ? 401 : res.status })
  }
  const j = await res.json()
  save({
    access_token: j.access_token,
    refresh_token: j.refresh_token || t.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
  })
}

async function validToken() {
  const t = load()
  if (!t) throw Object.assign(new Error('not connected'), { status: 401 })
  if (!t.expires_at || t.expires_at - Date.now() < 60000) await refresh()
  return load().access_token
}

function win(o) {
  return o && typeof o.utilization === 'number'
    ? { pct: o.utilization, resetMs: o.resets_at ? Date.parse(o.resets_at) - Date.now() : null }
    : null
}

// Etapa 3: busca o usage oficial
async function fetchUsage() {
  const token = await validToken()
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'User-Agent': UA,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(new Error(`usage ${res.status}: ${body.slice(0, 150)}`), {
      status: res.status,
    })
  }
  const j = await res.json()
  return {
    session: win(j.five_hour) || { pct: 0, resetMs: null },
    week: win(j.seven_day) || { pct: 0, resetMs: null },
    sonnet: win(j.seven_day_sonnet),
    opus: win(j.seven_day_opus),
  }
}

// Identidade da conta logada (email + plano). Cacheada na sessão; só muda
// no login/logout, então não refazemos a busca a cada poll de usage.
async function fetchProfile() {
  if (profile) return profile
  const token = await validToken()
  const res = await fetch(PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'User-Agent': UA,
    },
  })
  if (!res.ok) {
    throw Object.assign(new Error(`profile ${res.status}`), { status: res.status })
  }
  const a = (await res.json()).account || {}
  profile = {
    email: a.email || null,
    name: a.display_name || a.full_name || null,
    plan: a.has_claude_max ? 'Max' : a.has_claude_pro ? 'Pro' : null,
  }
  return profile
}

module.exports = {
  begin,
  complete,
  fetchUsage,
  fetchProfile,
  clear,
  isConnected,
  isEncryptionAvailable,
}
