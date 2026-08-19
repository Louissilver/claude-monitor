// Leitura local dos logs do Claude Code (~/.claude/projects/*.jsonl). Só
// leitura de disco, sem rede — nenhum dado sai da máquina por este módulo.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

function familyOf(model) {
  if (!model) return null
  const m = model.toLowerCase()
  return m.includes('opus')
    ? 'Opus'
    : m.includes('sonnet')
      ? 'Sonnet'
      : m.includes('haiku')
        ? 'Haiku'
        : m.includes('fable')
          ? 'Fable'
          : m.includes('mythos')
            ? 'Mythos'
            : null
}

function labelFor(model) {
  if (!model) return 'desconhecido'
  const fam = familyOf(model)
  const ver = model.toLowerCase().match(/-(\d)-(\d+)/)
  if (fam && ver) return `${fam} ${ver[1]}.${ver[2]}`
  if (fam) return fam
  return model
}

function tokensOf(entry) {
  const u = entry.usage || {}
  return (
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_read_input_tokens || 0) +
    (u.cache_creation_input_tokens || 0)
  )
}

// USD por milhão de tokens, preço de API "pay as you go" (não é o que você
// paga — planos Pro/Max são preço fixo). ESTIMATIVA pública de referência,
// só para dar noção de escala; a Anthropic pode mudar preços a qualquer
// momento e não temos como acompanhar isso automaticamente. Só cobre as
// famílias com preço público conhecido — Fable/Mythos ficam sem $ (melhor
// omitir do que simular um número inventado).
const PRICING_USD_PER_MTOK = {
  Opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  Sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  Haiku: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
}

function costOf(usage, family) {
  const p = PRICING_USD_PER_MTOK[family]
  if (!p) return null
  const u = usage || {}
  const input = u.input_tokens || 0
  const output = u.output_tokens || 0
  const cacheRead = u.cache_read_input_tokens || 0
  const cacheWrite = u.cache_creation_input_tokens || 0
  return (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6
}

const fileCache = new Map()

function walkJsonl(dir, out, cutoffMs) {
  let items
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const it of items) {
    const full = path.join(dir, it.name)
    if (it.isDirectory()) {
      walkJsonl(full, out, cutoffMs)
    } else if (it.isFile() && it.name.endsWith('.jsonl')) {
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.mtimeMs < cutoffMs) continue
      out.push({ full, st })
    }
  }
}

function parseFile(full, st) {
  const cached = fileCache.get(full)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.entries
  }
  const entries = []
  let raw
  try {
    raw = fs.readFileSync(full, 'utf8')
  } catch {
    return entries
  }
  for (const line of raw.split('\n')) {
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue
    if (obj.message.model === '<synthetic>') continue // mensagens internas do Claude Code
    const ts = Date.parse(obj.timestamp || obj.message?.timestamp || 0)
    if (!ts) continue
    entries.push({
      ts,
      model: obj.message.model,
      tokens: tokensOf({ usage: obj.message.usage }),
      costUsd: costOf(obj.message.usage, familyOf(obj.message.model)),
      key: `${obj.message.id || ''}:${obj.requestId || obj.uuid || ''}`,
    })
  }
  fileCache.set(full, { mtimeMs: st.mtimeMs, size: st.size, entries })
  return entries
}

const DAYS = 30
const SESSION_MS = 5 * 3600 * 1000

// mapeia uma ferramenta do Claude Code para o que o bichinho está "fazendo"
const ACTIVITY_BY_TOOL = {
  Edit: 'editing',
  MultiEdit: 'editing',
  Write: 'editing',
  NotebookEdit: 'editing',
  Read: 'reading',
  Grep: 'reading',
  Glob: 'reading',
  LS: 'reading',
  Bash: 'running',
  BashOutput: 'running',
  KillShell: 'running',
  WebSearch: 'researching',
  WebFetch: 'researching',
  Task: 'delegating',
  Agent: 'delegating',
  TodoWrite: 'planning',
  ExitPlanMode: 'planning',
  AskUserQuestion: 'waiting',
}

// Classifica o que o Claude Code está fazendo agora lendo o final do log de
// sessão mais recente: o último tool_use vira uma atividade; plan mode
// (permission-mode) tem prioridade sobre tudo. Retorna null sem sinal.
function detectActivity(file) {
  let raw
  try {
    const fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, 65536) // últimos 64KB bastam para o rabo recente
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    raw = buf.toString('utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n').filter(Boolean)
  let activity = null
  let permMode = null
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 80; i--) {
    let o
    try {
      o = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (permMode === null && (o.type === 'permission-mode' || o.type === 'mode')) {
      const v = o.mode || o.permissionMode || o.value
      if (typeof v === 'string') permMode = v
    }
    if (activity === null && o.type === 'assistant' && Array.isArray(o.message?.content)) {
      const blocks = o.message.content
      const tools = blocks.filter((b) => b && b.type === 'tool_use')
      if (tools.length) activity = ACTIVITY_BY_TOOL[tools[tools.length - 1].name] || 'working'
    }
    if (activity !== null && permMode !== null) break
  }
  if (permMode === 'plan') return 'planning'
  return activity
}

// Presets de plano (orçamento de tokens ~= 100%). Calibrado para Max 5x a
// partir do painel oficial (5h ~24% em 152M tokens, semanal ~62% em 2.14B);
// Pro/Max20x escalados pelo multiplicador do plano. ESTIMATIVAS — a
// Anthropic não publica os números exatos.
const PLAN_BUDGETS = {
  pro: { session: 126e6, week: 690e6 },
  max5x: { session: 630e6, week: 3450e6 },
  max20x: { session: 2520e6, week: 13800e6 },
}

function getUsage(config) {
  const now = Date.now()
  const dayMs = 24 * 3600 * 1000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const todayMs = startOfToday.getTime()
  let weekStart = now - 7 * dayMs
  let weekResetMs = null
  if (config.weeklyAnchorIso) {
    const anchor = Date.parse(config.weeklyAnchorIso)
    if (!Number.isNaN(anchor)) {
      const period = 7 * dayMs
      const lastReset = anchor + Math.floor((now - anchor) / period) * period
      weekStart = lastReset
      weekResetMs = lastReset + period - now
    }
  }
  const start30 = todayMs - (DAYS - 1) * dayMs
  const fiveMinAgo = now - 5 * 60000
  const recentCutoff = now - 12 * 3600 * 1000
  const scanCutoff = start30 - dayMs

  const files = []
  walkJsonl(PROJECTS_DIR, files, scanCutoff)

  let lastMtime = 0
  let newestFile = null
  for (const f of files) {
    if (f.st.mtimeMs > lastMtime) {
      lastMtime = f.st.mtimeMs
      newestFile = f.full
    }
  }

  const seen = new Set()
  let todayTokens = 0
  let weekTokens = 0
  let monthTokens = 0
  const byModel = new Map() // tokens por modelo, 7 dias
  const days30 = new Array(DAYS).fill(0) // tokens por dia
  const recent = [] // últimas 12h, para detectar a sessão de 5h
  let last5mTokens = 0

  for (const f of files) {
    const entries = parseFile(f.full, f.st)
    for (const e of entries) {
      if (e.ts < start30) continue
      if (e.key && e.key !== ':' && seen.has(e.key)) continue
      if (e.key && e.key !== ':') seen.add(e.key)
      const t = e.tokens
      monthTokens += t

      const dayIdx = Math.min(DAYS - 1, Math.max(0, Math.floor((e.ts - start30) / dayMs)))
      days30[dayIdx] += t

      if (e.ts >= weekStart) {
        weekTokens += t
        const lbl = labelFor(e.model)
        const cur = byModel.get(lbl) || { tokens: 0, costUsd: 0, priced: false }
        cur.tokens += t
        if (e.costUsd != null) {
          cur.costUsd += e.costUsd
          cur.priced = true
        }
        byModel.set(lbl, cur)
      }
      if (e.ts >= todayMs) todayTokens += t
      if (e.ts >= recentCutoff) recent.push({ ts: e.ts, tokens: t })
      if (e.ts >= fiveMinAgo) last5mTokens += t
    }
  }

  // janela de sessão de 5h (como o "Current session" do /usage)
  recent.sort((a, b) => a.ts - b.ts)
  let sStart = null
  let sEnd = null
  for (const e of recent) {
    if (sStart === null || e.ts >= sEnd) {
      sStart = e.ts
      sEnd = sStart + SESSION_MS
    }
  }
  const planB = PLAN_BUDGETS[config.plan]
  const sessionBudget = planB ? planB.session : config.sessionTokenBudget
  const weeklyBudget = planB ? planB.week : config.weeklyTokenBudget

  const session = { tokens: 0, pct: 0, resetMs: 0, active: false }
  if (sStart !== null && now < sEnd) {
    let tk = 0
    for (const e of recent) if (e.ts >= sStart && e.ts < sEnd) tk += e.tokens
    session.tokens = tk
    session.active = true
    session.resetMs = sEnd - now
    session.pct = sessionBudget ? Math.min(100, (tk / sessionBudget) * 100) : 0
  }

  const weekPct = weeklyBudget ? Math.min(100, (weekTokens / weeklyBudget) * 100) : 0

  const lastActivityMs = lastMtime ? now - lastMtime : Infinity
  const active = lastActivityMs <= (config.activeThresholdMs || 20000)
  const sleeping = lastActivityMs >= (config.sleepThresholdMs || 300000)

  // o que o Claude está fazendo agora (só faz sentido enquanto ativo)
  const activity = active && newestFile ? detectActivity(newestFile) : null

  const byModelArr = [...byModel.entries()]
    .map(([label, v]) => ({ label, tokens: v.tokens, costUsd: v.priced ? v.costUsd : null }))
    .sort((a, b) => b.tokens - a.tokens)

  return {
    session,
    week: { tokens: weekTokens, pct: weekPct, resetMs: weekResetMs },
    today: { tokens: todayTokens },
    byModel: byModelArr,
    days30,
    monthTokens,
    tokensPerMin: Math.round(last5mTokens / 5),
    active,
    sleeping,
    activity,
    lastActivityMs,
    ts: now,
  }
}

module.exports = { getUsage }
