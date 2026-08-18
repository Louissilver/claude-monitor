// Ponte mínima entre renderer (sandboxed, sem Node) e o processo principal.
// Só expõe os canais que o renderer realmente usa — nunca ipcRenderer cru.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('usage-error', (_e, msg) => cb(msg)),
  onRealUsage: (cb) => ipcRenderer.on('real-usage', (_e, u) => cb(u)),
  onAuthState: (cb) => ipcRenderer.on('auth-state', (_e, s) => cb(s)),
  onProfile: (cb) => ipcRenderer.on('profile', (_e, p) => cb(p)),
  onAuthResult: (cb) => ipcRenderer.on('auth-result', (_e, r) => cb(r)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
  onDebugState: (cb) => ipcRenderer.on('debug-state', (_e, o) => cb(o)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  authStart: () => ipcRenderer.send('auth-start'),
  authCode: (code) => ipcRenderer.send('auth-code', code),
  authLogout: () => ipcRenderer.send('auth-logout'),
  saveConfig: (patch) => ipcRenderer.send('save-config', patch),
  resize: (w, h) => ipcRenderer.send('resize', w, h),
  openUsage: () => ipcRenderer.send('open-usage'),
  resetPosition: () => ipcRenderer.send('reset-position'),
  quit: () => ipcRenderer.send('quit'),
})
