# ADR-001: Cópia segura do widget de monitoramento de uso do Claude para Windows

**Status:** Proposto
**Data:** 2026-08-15
**Decisores:** Luis Fernando (proprietário do projeto)

## Contexto

Auditoria dos repositórios `renatoaug/claude-usage-monitor` (Clauddy) e `vitoriahellen/Claude-Glass` concluiu que nenhum é malicioso, mas identificou riscos concretos:

| # | Risco | Onde | Severidade |
|---|-------|------|------------|
| R1 | `state` OAuth retornado nunca é comparado com o gerado localmente (`returnedState \|\| pending.state`) | `auth.js` (idêntico nos dois) | Média |
| R2 | Tokens OAuth (access + refresh) gravados em texto claro em `auth.json`; `mode: 0o600` é inócuo no Windows | `auth.js` | Alta |
| R3 | Escopo do token amplo: `org:create_api_key user:profile user:inference` — vazamento do arquivo dá inferência e criação de API keys na conta | `auth.js` | Alta (impacto) |
| R4 | Self-update via `curl \| bash` do branch `main`, sem checksum/assinatura; app não assinado; bypass de Gatekeeper | Clauddy `main.js:550`, `install.sh` | Alta |
| R5 | Sem Content-Security-Policy no renderer | `renderer/index.html` (ambos) | Baixa |
| R6 | IPC `save-config` faz `Object.assign(obj, patch)` com patch arbitrário do renderer — sem allowlist de chaves, risco de poluição de protótipo e gravação de chaves inesperadas | `main.js` (ambos) | Baixa/Média |
| R7 | Cadeia de suprimentos: instalação com scripts de pós-install habilitados, versões com range (`^`) | `package.json` (ambos) | Média |
| R8 | Colagem de token direto (branch sem `#` em `complete()`) aceita qualquer string como token de longa duração | `auth.js` | Baixa |

Objetivo: implementar em `D:\Projetos\claudemonitor` uma cópia funcional do widget para Windows com **todos** os riscos acima fechados, mantendo o comportamento visual (pet + barras de uso) e a leitura de uso local (`~/.claude/projects/*.jsonl`) e oficial (endpoint OAuth de usage).

Restrições:
- Plataforma alvo: exclusivamente Windows 11 (desktop pessoal).
- Uso pessoal; não haverá distribuição pública nem infraestrutura de release.
- Dependência única desejada: Electron (dev). Nenhuma dependência de runtime.

## Decisão

Criar projeto novo em `D:\Projetos\claudemonitor` tomando **Claude-Glass como base funcional** (já é a variante Windows, sem self-update e com superfície menor), reescrevendo os módulos sensíveis (`auth.js`, `main.js`, `preload.js`) com os controles de segurança abaixo, em vez de fazer fork direto de qualquer um dos repositórios.

## Opções consideradas

### Opção A: Fork direto do Claude-Glass + patches pontuais

| Dimensão | Avaliação |
|-----------|------------|
| Complexidade | Baixa |
| Custo | ~1 dia |
| Segurança | Média — herda código não auditado linha a linha (renderer com ~1.500 linhas de pet.js) |
| Manutenção | Acoplada ao upstream |

**Prós:** rápido; comportamento idêntico garantido.
**Cons:** confiança herdada; patches de segurança espalhados dificultam auditoria; upstream pode divergir.

### Opção B: Projeto novo, base funcional do Claude-Glass, módulos sensíveis reescritos (recomendada)

| Dimensão | Avaliação |
|-----------|------------|
| Complexidade | Média |
| Custo | 2–3 dias |
| Segurança | Alta — todo código que toca token/rede/IPC é escrito e auditado do zero; renderer (pet/UI) copiado após revisão, pois não tem acesso a rede nem a Node |
| Manutenção | Independente |

**Prós:** fronteira de confiança clara (renderer é "burro", main/auth são nossos); cada risco fechado por construção.
**Cons:** mais trabalho inicial; paridade visual exige testes manuais.

### Opção C: Reescrita total (incluindo UI) em stack própria (ex.: Tauri)

| Dimensão | Avaliação |
|-----------|------------|
| Complexidade | Alta |
| Custo | 1–2 semanas |
| Segurança | Alta (Tauri tem superfície menor que Electron) |
| Manutenção | Independente, porém stack nova (Rust) |

**Prós:** binário menor, sem Node no processo principal.
**Cons:** custo desproporcional para uso pessoal; perde o pet SVG pronto; curva de Rust.

## Análise de trade-offs

A Opção B compra auditabilidade no ponto que importa — os três arquivos que tocam credenciais e IPC somam menos de 500 linhas e serão de autoria própria — sem pagar o custo da Opção C. O renderer herdado é aceitável porque, com `contextIsolation`, `sandbox`, CSP estrita e bridge IPC mínima, ele não consegue alcançar rede, disco nem o token mesmo que contenha código indesejado.

## Especificação dos controles de segurança (fecha R1–R8)

### R1 — Validação de `state` OAuth
Em `complete()`: rejeitar com erro se `returnedState !== pending.state` (comparação com `crypto.timingSafeEqual` sobre buffers). `pending` é invalidado após uma tentativa (sucesso ou falha) e expira em 10 minutos.

### R2 — Armazenamento cifrado do token
Usar `safeStorage` do Electron (DPAPI no Windows): gravar `auth.json.enc` com o resultado de `safeStorage.encryptString(JSON.stringify(tokens))`. Na leitura, `decryptString`. Se `safeStorage.isEncryptionAvailable()` for falso, **recusar login** com mensagem clara — nunca cair para texto claro. Risco residual documentado: DPAPI protege contra leitura por outros usuários/máquinas, não contra malware rodando na mesma sessão do usuário — esse é o limite prático em qualquer app desktop.

### R3 — Escopo mínimo
Solicitar apenas `user:profile` no authorize; testar se os endpoints `/api/oauth/usage` e `/api/oauth/profile` aceitam token sem `user:inference` e `org:create_api_key`. Se o servidor exigir os escopos do Claude Code (provável, pois o CLIENT_ID é dele e o servidor pode ignorar o pedido reduzido), documentar o risco residual e compensar com R2 (cifra) mais logout fácil (botão que chama `clear()` e orienta revogação em claude.ai/settings). Alternativa de menor privilégio a oferecer na UI: usar somente o modo local (leitura dos `.jsonl`), que funciona sem OAuth algum — zero token em disco.

### R4 — Sem self-update
Nenhum mecanismo de atualização automática, nenhum `child_process` no código do app. Atualização é manual: `git pull` + revisão do diff pelo próprio usuário. O `package.json` não terá scripts de instalação remota.

### R5 — CSP estrita no renderer
Meta tag no `index.html`:
`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'`.
Toda chamada de rede vive exclusivamente no processo main.

### R6 — IPC endurecido
- `save-config`: allowlist explícita de chaves (`plan`, `alerts`, `alertThresholds`, `fireThreshold`, `startWithWindows`, `weeklyAnchorIso`, budgets), validação de tipo e faixa por chave; objeto novo criado com `Object.create(null)` — patch nunca passa por `Object.assign` cru (bloqueia `__proto__`/`constructor`).
- Todos os handlers verificam `event.senderFrame === win.webContents.mainFrame`.
- `resize`: limites máximos além dos mínimos.
- `shell.openExternal` somente para URLs de uma constante allowlist (página de usage e authorize).

### R7 — Cadeia de suprimentos
- `electron` e `electron-builder` com versão **exata** (sem `^`), instalados com `npm ci` e `--ignore-scripts`; `.npmrc` com `ignore-scripts=true`.
- Zero dependências de runtime.
- Lockfile commitado; `npm audit` no fluxo de build.

### R8 — Validação do token colado
No branch de colagem direta, aceitar apenas strings que casem com o formato de token OAuth da Anthropic (prefixo `sk-ant-oat`, comprimento plausível); rejeitar o resto com erro amigável.

### Endurecimento adicional do Electron (por construção)
- `BrowserWindow.webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` (default, não sobrescrever).
- `will-navigate` e `setWindowOpenHandler` negando tudo (janela só carrega o `index.html` local).
- `app.enableSandbox()` global.
- Preload expõe apenas a bridge mínima já existente (nenhuma API genérica de `ipcRenderer`).

## Consequências

**Fica mais fácil:**
- Auditar: todo código com acesso a credenciais é próprio e curto.
- Confiar no widget mesmo com a conta Claude conectada.

**Fica mais difícil:**
- Atualizar: sem auto-update, sincronizar melhorias do upstream é manual.
- Se `safeStorage` indisponível (perfil corporativo estranho), o modo OAuth simplesmente não funciona — decisão deliberada.

**Revisitar quando:**
- Anthropic publicar API oficial de usage com escopo próprio de leitura → eliminar o CLIENT_ID emprestado do Claude Code (fecha R3 de vez).
- Upstream corrigir R1/R2 → avaliar convergência.

## Itens de ação

1. [x] Estrutura do projeto: `main.js`, `auth.js`, `preload.js` novos; `renderer/` (index.html, style.css, pet.js) e `usage.js` portados do Claude-Glass após leitura linha a linha.
2. [x] Implementar `auth.js` com R1 (state check + expiração de `pending`), R2 (safeStorage/DPAPI), R3 (escopo mínimo + fallback documentado), R8 (validação de formato).
3. [x] Implementar `main.js` com endurecimento Electron, R6 (IPC com allowlist e verificação de sender) e sem qualquer `child_process` (R4).
4. [x] Adicionar CSP ao `index.html` (R5) e confirmar que pet.js funciona sob CSP — os 6 `style="animation-delay: …"` inline viraram classes `.dly-*` em `style.css`; `script-src` ficou sem `'unsafe-inline'`/`'unsafe-eval'`. `style-src` manteve `'unsafe-inline'` como risco residual documentado (animações via `element.style.*` em JS); `connect-src 'none'` cobre a parte que importa (rede só no main).
   - Extra encontrado durante a implementação, fora da lista original: `pet.js` usava `innerHTML` com template string interpolando `m.label` (nome do modelo, lido de `~/.claude/projects/*.jsonl`) em `renderModels()`, e `row.innerHTML = ''` para limpar listas. Trocado por construção de DOM com `textContent`/`createElement` — fecha injeção de HTML mesmo que a fonte seja local e hoje confiável.
5. [x] `package.json` + `.npmrc` com versões exatas e `ignore-scripts` (R7); `npm install` (gera lockfile) + `npm audit` → **0 vulnerabilidades**. Ressalva prática documentada no README: `ignore-scripts=true` também bloqueia o postinstall do próprio Electron (baixa o binário); roda-se manualmente e de forma visível via `npm run postinstall-electron`.
6. [ ] Teste do fluxo OAuth completo: login, state inválido rejeitado, refresh, logout apaga `auth.enc`, e teste de escopo reduzido no endpoint de usage. **Pendente** — exige login real numa conta Claude; não foi possível validar nesta sessão (sem acesso interativo a uma conta/navegador do usuário).
7. [ ] Teste do modo somente-local (sem OAuth) lendo `~/.claude/projects`. **Parcial** — `npm start` sobe sem exceções de código próprio (checado via log filtrado); verificação visual/interativa completa (bichinho renderizando, popup de settings, etc.) só é possível na sessão de desktop real do usuário, fora do alcance das ferramentas deste ambiente.
8. [x] Checklist final. `/security-review` automatizado exige repositório git com remote configurado (compara contra `origin/HEAD`); este projeto é local, sem remote, então a automação não roda. Revisão manual adversarial feita em substituição, arquivo por arquivo (`auth.js`, `main.js`, `preload.js`, `renderer/*`, `package.json`, `.npmrc`). Achado e corrigido: `frame-ancestors` na CSP só tem efeito via header HTTP, não via `<meta>` (a spec manda ignorá-la nesse caso) — adicionada uma segunda cópia da política em `main.js` via `session.defaultSession.webRequest.onHeadersReceived`, que é a única cópia onde essa diretiva realmente atua. Nenhum outro problema novo encontrado nessa passada.
