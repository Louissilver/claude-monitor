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
//
// Comportamento de janela (usabilidade, não segurança):
//   - ícone na bandeja: fechar (X) esconde em vez de matar o processo —
//     sem isso não existe como reabrir o widget sem achar o atalho de novo,
//     já que a janela não aparece na barra de tarefas (skipTaskbar).
//   - single-instance lock: abrir o app com uma instância já rodando foca a
//     existente em vez de subir um segundo processo (dois pollers de uso
//     concorrentes, duas janelas sobrepostas).
//   - resize usa um único `setBounds` atômico em vez de `setContentSize` +
//     `setPosition` separados — evita a janela transparente deixar uma
//     região "fantasma" do tamanho antigo, clicável mas invisível.
const { app, BrowserWindow, ipcMain, screen, Notification, shell, session, Tray, Menu, nativeImage } =
  require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { getUsage } = require('./usage')
const auth = require('./auth')
const platform = require('./platform')

// Precisa ser chamado antes de app estar pronto (e antes de qualquer janela).
app.enableSandbox()

// Só uma instância roda por vez — a segunda só foca a primeira e sai.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

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
let tray = null
// true só a partir de um quit "de verdade" (menu do tray, SO desligando).
// Sem isso, fechar a janela (X) mataria o processo — é para evitar isso
// que o handler de 'close' abaixo intercepta e esconde em vez de fechar.
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

function showWindow() {
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}
function hideWindow() {
  if (!win || win.isDestroyed()) return
  win.hide()
}
// Reposiciona no canto inferior direito do monitor primário atual — mesmo
// cálculo do posicionamento inicial. Serve de rede de segurança manual caso
// a janela fique fora de qualquer tela visível (ex.: monitor desconectado).
function centerWindow() {
  if (!win || win.isDestroyed()) return
  const { workAreaSize } = screen.getPrimaryDisplay()
  const [width, height] = win.getContentSize()
  win.setBounds({
    x: workAreaSize.width - width - 20,
    y: workAreaSize.height - height - 20,
    width,
    height,
  })
}

// Ícone da bandeja gerado em runtime (buffer de pixels), sem depender de
// nenhum asset de design que ainda não existe no projeto — ver ADR-002.
// Quadrado com cantos arredondados na cor terracota do próprio bichinho
// (--pixel em style.css), só para ter algo reconhecível na bandeja.
function buildTrayIcon() {
  const size = 16
  const [r, g, b] = [0xd5, 0x76, 0x58]
  const buf = Buffer.alloc(size * size * 4) // BGRA, formato esperado pelo nativeImage
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cut =
        (x < 2 && y < 2 && x + y < 1) ||
        (x >= size - 2 && y < 2 && size - 1 - x + y < 1) ||
        (x < 2 && y >= size - 2 && x + (size - 1 - y) < 1) ||
        (x >= size - 2 && y >= size - 2 && size - 1 - x + (size - 1 - y) < 1)
      buf[i] = b
      buf[i + 1] = g
      buf[i + 2] = r
      buf[i + 3] = cut ? 0 : 255
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function createTray() {
  tray = new Tray(buildTrayIcon())
  tray.setToolTip('Claude Monitor')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir', click: showWindow },
      {
        label: 'Configurações',
        click: () => {
          showWindow()
          if (win && !win.isDestroyed()) win.webContents.send('open-settings')
        },
      },
      { label: 'Centralizar posição', click: centerWindow },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => {
    if (win && win.isVisible()) hideWindow()
    else showWindow()
  })
}

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

  // Fechar (X, Alt+F4) esconde para a bandeja em vez de matar o processo —
  // sem isso não haveria como reabrir o widget (skipTaskbar tira ele da
  // barra de tarefas). Sair de verdade só existe pelo menu do tray.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideWindow()
  })

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
  const { workAreaSize } = screen.getPrimaryDisplay()
  // Um único setBounds atômico — setContentSize + setPosition separados
  // podiam deixar uma região "fantasma" do tamanho antigo, invisível mas
  // ainda clicável, numa janela transparente/sem moldura no Windows.
  win.setBounds({
    x: workAreaSize.width - width - 20,
    y: workAreaSize.height - height - 20,
    width,
    height,
  })
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

// Botão "fechar" da UI: esconde para a bandeja, não mata o processo — sair
// de verdade só existe pelo menu do tray ("Sair"), que passa por
// 'before-quit' e por isso o handler de 'close' da janela deixa passar.
ipcMain.on('quit', (event) => {
  if (!fromOwnWindow(event)) return
  hideWindow()
})

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.local.claude-monitor')
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] },
      })
    })
    createWindow() // define `config`
    createTray()
    platform.applyAutoStart(config)
  })
}

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer)
  app.quit()
})
