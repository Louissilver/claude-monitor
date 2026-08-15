// Diferenças de plataforma isoladas aqui (ver docs/ADR-002). main.js e
// auth.js nunca checam `process.platform` diretamente — sempre passam por
// este módulo, para manter a lógica de segurança e integração com o SO num
// lugar só.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// safeStorage.isEncryptionAvailable() sozinho NÃO basta no Linux: sem um
// keyring ativo (gnome-keyring/kwallet), o Electron cai no backend
// 'basic_text', que não cifra nada — só guarda o valor com uma ofuscação
// fixa. Rejeitamos esse backend explicitamente para nunca gravar o token
// achando que está protegido quando na verdade não está (variante Linux do
// risco R2 do ADR-001).
function isSecureStorageUsable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend()
      if (!backend || backend === 'basic_text') return false
    }
    return true
  } catch {
    return false
  }
}

function linuxAutostartFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'claude-monitor.desktop')
}

function quoteExec(p) {
  return `"${String(p).replace(/"/g, '\\"')}"`
}

// Windows/macOS têm API nativa (app.setLoginItemSettings) para autostart. No
// Linux, o mecanismo equivalente é a especificação XDG Autostart: um arquivo
// .desktop em ~/.config/autostart, lido por todo ambiente de desktop
// (GNOME, KDE, XFCE, Cinnamon, MATE) na hora do login da sessão.
function applyLinuxAutostart(enabled) {
  const file = linuxAutostartFile()
  if (!enabled) {
    try {
      fs.unlinkSync(file)
    } catch {}
    return
  }
  // AppImage roda a partir de $APPIMAGE; instalação via .deb roda de um
  // caminho fixo em process.execPath — os dois precisam funcionar.
  const exec = process.env.APPIMAGE || process.execPath
  const entry =
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Claude Monitor',
      `Exec=${quoteExec(exec)}`,
      'X-GNOME-Autostart-enabled=true',
      'NoDisplay=false',
      'Terminal=false',
    ].join('\n') + '\n'
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, entry, { mode: 0o644 })
  } catch {}
}

// Chamado com a config já carregada. Em dev (app não empacotado) não mexe na
// inicialização do SO, nos dois casos — igual ao comportamento original.
function applyAutoStart(config) {
  if (!app.isPackaged) return
  const enabled = config.startAtLogin !== false
  if (process.platform === 'linux') {
    applyLinuxAutostart(enabled)
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false })
}

module.exports = { isSecureStorageUsable, applyAutoStart }
