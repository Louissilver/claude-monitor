# ADR-002: Suporte a Linux/Ubuntu com instalação em máquina

**Status:** Proposto
**Data:** 2026-08-15
**Decisores:** Luis Fernando (proprietário do projeto)

## Contexto

O Claude Monitor (ADR-001) roda hoje só no Windows. Objetivo desta evolução:
rodar em Linux/Ubuntu com instalação "de verdade" na máquina (pacote
instalável, ícone no launcher, autostart), mantendo todos os controles de
segurança do ADR-001.

Inventário do que é específico de plataforma no código atual:

| Ponto | Hoje (Windows) | No Linux |
|---|---|---|
| Autostart | `app.setLoginItemSettings` (registro Run) | **No-op no Linux** — precisa de XDG Autostart (`~/.config/autostart/*.desktop`) |
| Cifra do token (R2) | `safeStorage` → DPAPI | `safeStorage` → libsecret (gnome-keyring/kwallet). **Atenção**: sem keyring ativo, Electron cai no backend `basic_text`, que **não cifra** — e `isEncryptionAvailable()` pode retornar `true` mesmo assim |
| Notificações | Nativas Win32 | libnotify/D-Bus — API `Notification` do Electron cobre, mas exige ambiente desktop com daemon de notificação |
| Janela transparente/frameless/always-on-top | OK | Depende de compositor (X11 precisa de compositing ativo; Wayland tem quirks próprios de `alwaysOnTop`/`skipTaskbar`) |
| `AppUserModelId` | Necessário | Irrelevante — equivalente é o `.desktop` file com `StartupWMClass` |
| Logs do Claude Code | `%USERPROFILE%\.claude\projects` | `~/.claude/projects` — `os.homedir()` já resolve, zero mudança |

Restrição do ambiente de desenvolvimento: a máquina de dev é Windows 11, sem
Linux nativo. WSL 2.7.11 com **WSLg 1.0.73** está instalado (GUI apps Linux
rodam direto, sem X server manual), mas a única distro presente é
`docker-desktop` — seria preciso `wsl --install -d Ubuntu` para ter um Ubuntu
de trabalho.

## Decisão

1. **Port cross-platform num código só** (sem fork): extrair as diferenças de
   plataforma para um módulo `platform.js` (autostart, checagem de backend de
   cifra), mantendo `main.js`/`auth.js` únicos.
2. **Empacotar como `.deb` + AppImage** via electron-builder (alvo Ubuntu como
   primeira classe; AppImage cobre as demais distros de graça).
3. **Validação em dois estágios**: loop de desenvolvimento no **WSLg** (rápido,
   cobre ~80% do comportamento) e validação final numa **VM Ubuntu Desktop**
   (Hyper-V Quick Create), que é o único ambiente fiel para autostart,
   keyring, notificações e compositor. Docker fica só para build/CI headless —
   **não** serve para validar GUI.

## Opções consideradas

### Empacotamento

#### Opção A: AppImage apenas
| Dimensão | Avaliação |
|-----------|------------|
| Complexidade | Baixa |
| Instalação "de verdade" | Fraca — arquivo solto, sem entrada no apt, integração com launcher exige AppImageLauncher |
| Atualização | Manual (troca de arquivo) |

**Prós:** um artefato roda em qualquer distro; zero dependência de formato.
**Cons:** não é "instalado na máquina"; autostart e ícone exigem passos extras do usuário.

#### Opção B: `.deb` apenas
| Dimensão | Avaliação |
|-----------|------------|
| Complexidade | Baixa (electron-builder gera) |
| Instalação "de verdade" | Forte — `apt install ./claude-monitor.deb`, ícone no launcher, desinstalação limpa, dependências (libnotify, libsecret) declaradas |
| Alcance | Só Debian/Ubuntu |

**Prós:** exatamente o requisito ("instalação em máquina"); dependências resolvidas pelo apt.
**Cons:** exclui Fedora/Arch (irrelevante se o alvo declarado é Ubuntu).

#### Opção C: `.deb` + AppImage (recomendada)
Mesmo custo de build (duas linhas no `electron-builder`), `.deb` como caminho
oficial Ubuntu e AppImage como cortesia portátil. Sem repositório apt próprio
(seria infraestrutura de update — ADR-001/R4 proíbe auto-update; instalação e
atualização continuam manuais e revisadas).

### Validação sem máquina Linux

#### Opção A: WSLg (WSL2 + GUI)
| Dimensão | Avaliação |
|-----------|------------|
| Custo de setup | Mínimo — WSLg já instalado; falta só `wsl --install -d Ubuntu` |
| Fidelidade | ~80%: janela, renderer, leitura de logs, IPC, `.deb` instala e abre |
| Pontos cegos | Autostart (não há "login de sessão" XDG no WSL), keyring (gnome-keyring não roda por padrão → `safeStorage` cai em `basic_text` → nosso código **recusa login por design**, então o fluxo OAuth não é testável), notificações (daemon ausente), compositor real (WSLg usa Weston embutido — transparência/always-on-top se comportam diferente do GNOME) |

**Prós:** loop de desenvolvimento em segundos; roda `npm start` direto no filesystem do projeto.
**Cons:** exatamente os recursos "de máquina instalada" (autostart, keyring, notificação) ficam fora do alcance.

#### Opção B: Docker
| Dimensão | Avaliação |
|-----------|------------|
| Custo de setup | Médio |
| Fidelidade | Péssima para GUI — container não tem display server; exigiria X11 forwarding para... o próprio WSLg, adicionando camada sem ganho |

**Prós:** ótimo para **build/CI headless** (gerar o `.deb` reproduzível).
**Cons:** não responde nenhuma pergunta visual/desktop; keyring/systemd/autostart tão ausentes quanto no WSL. Não é alternativa de validação, é ferramenta de build.

#### Opção C: VM Ubuntu Desktop (Hyper-V ou VirtualBox)
| Dimensão | Avaliação |
|-----------|------------|
| Custo de setup | ~30 min uma vez (Hyper-V Quick Create tem imagem Ubuntu pronta; Windows 11 Home exige VirtualBox, pois Hyper-V é Pro+) |
| Fidelidade | ~100%: GNOME real, gnome-keyring ativo (safeStorage cifra de verdade), notificações, autostart no login, compositor Mutter |

**Prós:** único ambiente que valida o produto como o usuário final vai usar.
**Cons:** loop mais lento; snapshot/atualização da VM é manutenção.

## Análise de trade-offs

WSLg vs. Docker não é empate: para GUI, WSLg ganha em tudo — Docker num host
Windows renderizaria via WSLg de qualquer forma. A dúvida real é "WSLg
basta?", e a resposta é **não para o escopo deste ADR**: os três recursos que
definem "instalado na máquina" (autostart XDG, cifra via keyring, notificação
nativa) são justamente os que o WSLg não reproduz. Máquina é Windows 11
**Home** (sem Hyper-V) → VirtualBox com ISO do Ubuntu Desktop é o caminho da
VM. A divisão de trabalho fica:

- **WSLg**: desenvolvimento diário — janela abre, pet anima, logs são lidos, `.deb` instala sem erro de dependência.
- **VM VirtualBox Ubuntu**: checklist final por release — autostart após reboot, login OAuth com keyring, notificação de alerta, transparência no GNOME (X11 e Wayland).
- **Docker**: opcional, só se um dia houver CI de build do `.deb`.

## Consequências

**Fica mais fácil:**
- Alcançar usuários Linux com instalação de um comando.
- Testar regressões de renderer rapidamente (WSLg).

**Fica mais difícil:**
- Matriz de teste dobra (Windows + Ubuntu X11/Wayland).
- R2 ganha uma variante Linux: a checagem `isEncryptionAvailable()` deixa de
  ser suficiente — é preciso também rejeitar o backend `basic_text`
  (`safeStorage.getSelectedStorageBackend() === 'basic_text'` → recusar
  login), senão o token seria gravado "cifrado" em claro. Sem essa checagem, o
  port **enfraqueceria** a garantia do ADR-001.

**Revisitar quando:**
- Electron mudar o comportamento de `safeStorage` no Linux (acompanhar release notes).
- Surgir demanda por Flatpak/Snap (sandbox próprio muda os caminhos de `~/.claude`).

## Itens de ação

1. [x] Criar `platform.js`: `applyAutoStart()` (Windows: `setLoginItemSettings`; Linux: escreve/remove `~/.config/autostart/claude-monitor.desktop`) e `isSecureStorageUsable()` (Windows: `isEncryptionAvailable()`; Linux: idem **e** `getSelectedStorageBackend() !== 'basic_text'`).
2. [x] Trocar as chamadas diretas em `main.js`/`auth.js` pelas funções do `platform.js`. Mensagem de erro do login (`auth-start`) passou a ser neutra de plataforma (menciona DPAPI e keyring). Como efeito colateral necessário: a config `startWithWindows` virou `startAtLogin` em `main.js`/`config.json`/`renderer/pet.js` (com leitura de compatibilidade para configs antigos) — um checkbox dizendo "Iniciar com o Windows" rodando no Ubuntu seria um bug visível; o label agora é dinâmico (`cfg.platform`, mandado por `main.js`, nunca persistido).
3. [x] `package.json` → `build.linux`: targets `deb` + `AppImage`, `category: Utility`, dependências do `.deb` (`libnotify4`, `libsecret-1-0`), scripts `dist:linux`. **Sem ícone customizado ainda** — não há asset de design no projeto; electron-builder usa o ícone padrão do Electron até alguém desenhar um `build/icon.png`.
4. [x] **Achado empírico, não estava previsto no ADR**: testei `npm run dist:linux` direto do Windows (fora do escopo original, só para confirmar a hipótese) — confirma que build de `.deb`/AppImage **não funciona no host Windows puro**: o `.deb` é pulado silenciosamente pelo electron-builder, e o AppImage falha com `EPERM` ao criar symlink (Windows exige privilégio elevado/Developer Mode). Documentado no README e no tutorial da VM: o build precisa rodar de dentro do WSL/Linux, não do Windows host. Instalação de uma distro Ubuntu real no WSL (`wsl --install -d Ubuntu`) e o teste interativo em si **ficam para você rodar** — precisam de setup de conta Ubuntu (usuário/senha) que exige interação, fora do alcance deste ambiente sem desktop.
5. [ ] VM VirtualBox + Ubuntu Desktop LTS: checklist final — instalar `.deb`, reboot (autostart), login OAuth (keyring), alerta de notificação. Tutorial completo entregue em [`docs/setup-virtualbox-ubuntu.md`](setup-virtualbox-ubuntu.md); execução pendente (depende de download de ISO e instalação interativa).
6. [x] README atualizado (pré-requisitos, instalação, configuração, geração do instalável e segurança agora cobrem Linux; link para o tutorial da VM). ADR-001 não foi editado — é um registro histórico da decisão original, não documentação viva; a nuance do R2 no Linux (`basic_text`) está documentada aqui e no README/`platform.js`, não duplicada lá.
7. [x] `/security-review` rodado sobre o diff completo (`platform.js` novo + mudanças em `auth.js`, `main.js`, `config.json`, `renderer/*`, `package.json`). Foco checado explicitamente: `isSecureStorageUsable()` não deixa `basic_text` passar como seguro (falha fechado); `applyLinuxAutostart()` interpola `process.env.APPIMAGE`/`process.execPath` no `Exec=` do `.desktop` — nenhum dos dois é controlável remotamente, e o arquivo é lido só na sessão de login do próprio usuário (sem elevação de privilégio); o campo `platform` novo no objeto de config não está no `CONFIG_SCHEMA`, então `sanitizeConfigPatch` o descarta se o renderer tentar reenviá-lo. **Nenhum achado com confiança suficiente.**
