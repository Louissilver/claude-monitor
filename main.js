// Processo principal. Único lugar que fala com a rede, o disco e o OAuth —
// o renderer nunca tem contextIsolation desligado nem acesso a Node.
//
// Endurecimento deliberado (ver docs/ADR-001):
//   - sandbox global (app.enableSandbox) + contextIsolation + sem nodeIntegration.
//   - sem child_process em lugar nenhum: não existe self-update (R4). Atualizar
//     é `git pull` manual, revisado pelo próprio usuário.
//   - toda navegação/popup do renderer é negada (setWindowOpenHandler / will-navigate).
//   - IPC 'save-config' passa por uma allowlist de chaves com validação de
//     tipo/faixa antes de tocar o disco (R6) — nunca um Object.assign cru
//     com um patch vindo do renderer.
//   - todo handler IPC confere que o evento veio do frame principal da
//     própria janela (defesa contra um <iframe> ou popup hipotético).
const { app, BrowserWindow, ipcMain, screen, Notification, shell, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { getUsage } = require('./usage')
const auth = require('./auth')
const platform = require('./platform')

// Precisa ser chamado antes de app estar pronto (e antes de qualquer janela).
app.enableSandbox()

const DATA_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.join(process.env.CLAUDE_CONFIG_DIR, 'claude-monitor')
  : path.join(os.homedir(), '.claude-monitor')

if (process.env.CLAUDE_CONFIG_DIR) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  app.setPath('userData', path.join(DATA_DIR, 'electron'))
}

const EXTERNAL_CONFIG = path.join(DATA_DIR, 'config.json')
const USAGE_PAGE_URL = 'https://claude.ai/settings/usage'
// Mesma política do <meta> em renderer/index.html, aplicada de novo aqui via
// header. `frame-ancestors` só tem efeito quando entregue por header — a
// spec de CSP diz explicitamente para ignorá-la num <meta> — então esta é a
// única cópia da política onde essa diretiva realmente vale algo (R5).
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

let win
let pollTimer
let config

function loadConfig() {
  const defaults = {
    plan: 'max5x',
    startAtLogin: true,
    sessionTokenBudget: 630000000,
    weeklyTokenBudget: 3450000000,
    weeklyAnchorIso: null,
    alerts: true,
    alertThresholds: [80, 95],
    fireThreshold: 90,
    pollIntervalMs: 4000,
    activeThresholdMs: 20000,
    sleepThresholdMs: 300000,
  }
  for (const p of [EXTERNAL_CONFIG, path.join(__dirname, 'config.json')]) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      // compat: configs salvos antes do port Linux usavam `startWithWindows`.
      if (raw.startAtLogin === undefined && typeof raw.startWithWindows === 'boolean') {
        raw.startAtLogin = raw.startWithWindows
      }
      return { ...defaults, ...raw }
    } catch {}
  }
  return defaults
}

// --- validação da config salva pelo renderer (fecha R6) ---------------------
// Allowlist explícita: cada chave só é aceita se passar no validador. Tudo
// que não está aqui é descartado — inclusive `__proto__`/`constructor`, que
// nunca sobrevivem a este filtro porque o objeto de saída não tem protótipo.
const CONFIG_SCHEMA = {
  plan: (v) => v === 'pro' || v === 'max5x' || v === 'max20x',
  startAtLogin: (v) => typeof v === 'boolean',
  alerts: (v) => typeof v === 'boolean',
  alertThresholds: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 4 &&
    v.every((n) => Number.isFinite(n) && n >= 1 && n <= 100),
  fireThreshold: (v) => Number.isFinite(v) && v >= 1 && v <= 99,
  weeklyAnchorIso: (v) => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v))),
}
function sanitizeConfigPatch(patch) {
  const clean = Object.create(null)
  if (!patch || typeof patch !== 'object') return clean
  for (const [key, isValid] of Object.entries(CONFIG_SCHEMA)) {
    if (Object.hasOwn(patch, key) && isValid(patch[key])) clean[key] = patch[key]
  }
  return clean
}

const armed = new Set()
function checkAlerts(config, d) {
  if (!config.alerts || !Notification.isSupported()) return
  const ths = config.alertThresholds || [80, 95]
  const scopes = [
    ['sessão', d.session.pct],
    ['uso semanal', d.week.pct],
  ]
  for (const [name, pct] of scopes) {
    for (const t of ths) {
      const key = `${name}:${t}`
      if (pct >= t) {
        if (!armed.has(key)) {
          armed.add(key)
          new Notification({
            title: 'Claude Monitor',
            body: `Sua ${name} passou de ${t}% — agora em ${Math.round(pct)}%`,
            silent: false,
          }).show()
        }
      } else {
        armed.delete(key)
      }
    }
  }
}

// Só handlers cujo evento veio do frame principal da nossa própria janela.
function fromOwnWindow(event) {
  return !!win && !win.isDestroyed() && event.senderFrame === win.webContents.mainFrame
}

// `platform` não é persistido em disco (fica fora de CONFIG_SCHEMA, então
// nunca volta do renderer) — só informa a UI para trocar o texto do
// checkbox de autostart ("com o Windows" vs. "ao entrar na sessão").
function configForRenderer(cfg) {
  return { ...cfg, platform: process.platform }
}

function createWindow() {
  config = loadConfig()
  const { workAreaSize } = screen.getPrimaryDisplay()
  const W = 290
  const H = 580

  win = new BrowserWindow({
    width: W,
    height: H,
    x: workAreaSize.width - W - 20,
    y: workAreaSize.height - H - 20,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.setAlwaysOnTop(true, 'floating')

  // Nunca deixamos o renderer navegar para outro lugar ou abrir popups —
  // ele só existe para carregar o index.html local uma vez.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  const tick = () => {
    if (!win || win.isDestroyed()) return
    try {
      const data = getUsage(config)
      win.webContents.send('usage', data)
      checkAlerts(config, data)
    } catch (err) {
      win.webContents.send('usage-error', String(err))
    }
  }

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('config', configForRenderer(config))
    tick()
    win.webContents.send('auth-state', { connected: auth.isConnected() })
    pollTimer = setInterval(tick, config.pollIntervalMs)
    startUsagePoll()
    sendProfile()
  })
}

// Defesa em profundidade: mesma política para qualquer webContents criado
// nesta app (inclusive se algo um dia criar uma segunda janela).
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
})

ipcMain.on('resize', (event, w, h) => {
  if (!fromOwnWindow(event)) return
  const width = Math.min(400, Math.max(280, Math.round(Number(w) || 0)))
  const height = Math.min(900, Math.max(200, Math.round(Number(h) || 0)))
  win.setContentSize(width, height)
  const { workAreaSize } = screen.getPrimaryDisplay()
  win.setPosition(workAreaSize.width - width - 20, workAreaSize.height - height - 20)
})

// URL fixa, sem entrada do renderer — nada a validar além de ser esta constante.
ipcMain.on('open-usage', (event) => {
  if (!fromOwnWindow(event)) return
  shell.openExternal(USAGE_PAGE_URL)
})

// --- polling de usage via OAuth ---------------------------------------------
let usageTimer = null
let usageBackoff = 5 * 60 * 1000
function scheduleUsagePoll() {
  clearTimeout(usageTimer)
  if (auth.isConnected()) usageTimer = setTimeout(pollUsage, usageBackoff)
}
async function pollUsage() {
  try {
    const u = await auth.fetchUsage()
    usageBackoff = 5 * 60 * 1000
    if (win && !win.isDestroyed()) win.webContents.send('real-usage', u)
  } catch (e) {
    if (e && e.status === 429) {
      usageBackoff = Math.min(usageBackoff * 2, 30 * 60 * 1000)
    } else if (e && e.status === 401) {
      auth.clear()
      if (win && !win.isDestroyed()) {
        win.webContents.send('auth-state', { connected: false })
        win.webContents.send('real-usage', null)
        win.webContents.send('profile', null)
      }
    }
  }
  scheduleUsagePoll()
}
function startUsagePoll() {
  if (auth.isConnected()) pollUsage()
}

async function sendProfile() {
  if (!auth.isConnected()) return
  try {
    const p = await auth.fetchProfile()
    if (win && !win.isDestroyed()) win.webContents.send('profile', p)
  } catch {}
}

ipcMain.on('auth-start', (event) => {
  if (!fromOwnWindow(event)) return
  if (!auth.isEncryptionAvailable()) {
    win.webContents.send('auth-result', {
      ok: false,
      error:
        'Armazenamento seguro do sistema indisponível (Windows: DPAPI; Linux: keyring como ' +
        'gnome-keyring/kwallet, ausente ou desligado) — login recusado.',
    })
    return
  }
  shell.openExternal(auth.begin())
})
ipcMain.on('auth-code', async (event, code) => {
  if (!fromOwnWindow(event)) return
  if (typeof code !== 'string' || code.length === 0 || code.length > 2000) {
    win.webContents.send('auth-result', { ok: false, error: 'código inválido' })
    return
  }
  const ok = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('auth-state', { connected: true })
      win.webContents.send('auth-result', { ok: true })
    }
    sendProfile()
  }
  try {
    await auth.complete(code)
    usageBackoff = 5 * 60 * 1000
    try {
      const u = await auth.fetchUsage()
      ok()
      if (win && !win.isDestroyed()) win.webContents.send('real-usage', u)
    } catch (e) {
      if (e && e.status === 429) ok()
      else throw e
    }
    scheduleUsagePoll()
  } catch (err) {
    auth.clear()
    if (win && !win.isDestroyed())
      win.webContents.send('auth-result', { ok: false, error: String(err?.message || err) })
  }
})
ipcMain.on('auth-logout', (event) => {
  if (!fromOwnWindow(event)) return
  auth.clear()
  clearTimeout(usageTimer)
  if (win && !win.isDestroyed()) {
    win.webContents.send('auth-state', { connected: false })
    win.webContents.send('real-usage', null)
    win.webContents.send('profile', null)
  }
})

ipcMain.on('save-config', (event, patch) => {
  if (!fromOwnWindow(event)) return
  const clean = sanitizeConfigPatch(patch)
  let obj = {}
  for (const p of [EXTERNAL_CONFIG, path.join(__dirname, 'config.json')]) {
    try {
      obj = JSON.parse(fs.readFileSync(p, 'utf8'))
      break
    } catch {}
  }
  const merged = { ...obj, ...clean }
  try {
    fs.mkdirSync(path.dirname(EXTERNAL_CONFIG), { recursive: true })
    fs.writeFileSync(EXTERNAL_CONFIG, JSON.stringify(merged, null, 2))
  } catch {}
  config = loadConfig()
  armed.clear()
  if (win && !win.isDestroyed()) win.webContents.send('config', configForRenderer(config))
  platform.applyAutoStart(config)
})

ipcMain.on('quit', (event) => {
  if (!fromOwnWindow(event)) return
  app.quit()
})

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.local.claude-monitor')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
    })
  })
  createWindow() // define `config`
  platform.applyAutoStart(config)
})

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer)
  app.quit()
})
