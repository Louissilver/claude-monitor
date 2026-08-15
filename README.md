# Claude Monitor

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Plataforma: Windows](https://img.shields.io/badge/plataforma-Windows-0078D6.svg)](#pré-requisitos)
[![Electron](https://img.shields.io/badge/Electron-42.8.0-47848F.svg)](https://www.electronjs.org/)
[![PRs bem-vindos](https://img.shields.io/badge/PRs-bem--vindos-brightgreen.svg)](#contribuindo)

Um bichinho de estimação na sua área de trabalho que mostra, em tempo real,
quanto do seu limite de uso do Claude (sessão de 5h e semanal) já foi
consumido — e reage visualmente ao que o Claude Code está fazendo agora
(lendo, editando, rodando comandos, pensando...).

Este projeto é uma reimplementação própria, do zero, dos widgets
[claude-usage-monitor](https://github.com/renatoaug/claude-usage-monitor) e
[Claude-Glass](https://github.com/vitoriahellen/Claude-Glass) — nasceu de uma
auditoria de segurança nesses dois projetos que encontrou falhas reais (token
OAuth salvo em texto claro, validação de `state` ausente, self-update via
`curl | bash` sem verificação, entre outras). Em vez de aplicar patches em
cima do código auditado, o `auth.js`, `main.js` e `preload.js` — os únicos
arquivos que tocam credenciais, rede e IPC — foram escritos do zero com essas
falhas fechadas por construção. O raciocínio completo, risco por risco, está
em [`docs/ADR-001`](docs/ADR-001-claude-monitor-seguro.md).

## Índice

- [Funcionalidades](#funcionalidades)
- [Por que este projeto existe](#por-que-este-projeto-existe)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Uso](#uso)
- [Conectar a conta Claude (opcional)](#conectar-a-conta-claude-opcional)
- [Configuração](#configuração)
- [Gerando o instalável](#gerando-o-instalável)
- [Segurança](#segurança)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Atualizando](#atualizando)
- [Contribuindo](#contribuindo)
- [Licença](#licença)
- [Créditos](#créditos)

## Funcionalidades

- 🐾 Bichinho animado que reflete o estado do Claude Code em tempo real (ocioso, trabalhando, lendo, editando, rodando, pesquisando, dormindo, pegando fogo perto do limite...).
- 📊 Barras de uso da sessão atual (5h) e da semana, com % oficial da Anthropic quando conectado.
- 🗓️ Mapa de calor dos últimos 30 dias e detalhamento de consumo por modelo (Opus, Sonnet, Haiku...).
- 🔔 Alertas configuráveis por notificação nativa do Windows ao cruzar limites de uso.
- 🔒 Funciona 100% offline por padrão, lendo só os logs locais do Claude Code — conectar a conta é opcional.
- 🪟 Widget flutuante, sem moldura, sempre visível, com modo minimizado.
- 🚀 Inicialização automática com o Windows (configurável).

## Por que este projeto existe

Os dois projetos originais não são maliciosos, mas uma auditoria encontrou
riscos reais de segurança neles (detalhados na íntegra no
[ADR-001](docs/ADR-001-claude-monitor-seguro.md)):

| Risco | Nos originais | Aqui |
|---|---|---|
| Token OAuth em disco | Texto claro (`chmod 600`, inócuo no Windows) | Cifrado com `safeStorage` (DPAPI) — login recusado se a cifra não estiver disponível |
| Validação do `state` OAuth | Ausente | Comparação de tempo constante, obrigatória |
| Escopo do token | `org:create_api_key user:profile user:inference` | `user:profile user:inference` — sem poder de criar API keys |
| Auto-update | `curl \| bash` sem checksum/assinatura | Não existe — atualização é `git pull` manual e revisado |
| CSP no renderer | Ausente | Estrita, aplicada duas vezes (`<meta>` + header) |
| IPC de configuração | `Object.assign` cru com o que o renderer mandar | Allowlist de chaves com validação de tipo/faixa |
| Cadeia de suprimentos | Dependências com `^` (range) | Versões exatas, `npm ci` + `ignore-scripts` |

## Pré-requisitos

- **Windows** (único SO suportado)
- [Node.js](https://nodejs.org/) 18 ou superior
- [npm](https://www.npmjs.com/) (vem com o Node.js)
- [Git](https://git-scm.com/)

## Instalação

```bash
git clone https://github.com/Louissilver/claude-monitor.git
cd claude-monitor
npm ci
```

O projeto roda com `ignore-scripts=true` (`.npmrc`) para que nenhuma
dependência da árvore execute script de instalação silenciosamente —
inclusive transitivas do `electron-builder`. Isso também bloqueia o
postinstall do próprio `electron`, que baixa o binário da versão pinada;
rode-o manualmente depois do `npm ci` (é o mesmo script que rodaria sozinho,
só que visível e deliberado):

```bash
npm run postinstall-electron
```

Confira a árvore por vulnerabilidades conhecidas antes de usar:

```bash
npm audit
```

## Uso

```bash
npm start
```

O widget abre ancorado no canto inferior direito da tela. Arraste-o pelo
corpo para reposicionar, clique duas vezes (ou no botão `–`) para
minimizar, e use a engrenagem para abrir as configurações.

## Conectar a conta Claude (opcional)

Sem conectar, o widget já funciona lendo os logs locais do Claude Code
(`~/.claude/projects/*.jsonl`) — zero token em disco, zero rede. Para ver o %
oficial da Anthropic, clique na engrenagem → **Entrar pelo navegador**.

O login exige que o Windows tenha DPAPI disponível (é o mecanismo que cifra o
token em disco, via `safeStorage` do Electron). Se `safeStorage` não estiver
disponível no seu perfil do Windows, o app recusa o login em vez de gravar o
token sem cifra — ver [Segurança](#segurança).

## Configuração

As opções abaixo ficam em `config.json` (valores padrão) e podem ser
sobrescritas por um `config.json` externo em `%USERPROFILE%\.claude-monitor\`
— editável sem precisar reinstalar. A maioria também é ajustável direto pela
UI (engrenagem → Configurações).

| Campo | Padrão | Descrição |
|---|---|---|
| `plan` | `"max5x"` | Plano Claude, usado para calibrar os orçamentos estimados (`pro`, `max5x`, `max20x`) |
| `startWithWindows` | `true` | Abre o widget sozinho ao ligar o computador |
| `alerts` | `true` | Notificações nativas ao cruzar os limites configurados |
| `alertThresholds` | `[80, 95]` | Percentuais (sessão e semana) que disparam alerta |
| `fireThreshold` | `90` | % de sessão a partir do qual o bichinho "pega fogo" |
| `weeklyAnchorIso` | `null` | Data ISO de referência para o reset semanal, se diferente do padrão |
| `pollIntervalMs` | `4000` | Intervalo de releitura dos logs locais |

## Gerando o instalável

```bash
npm run dist:win
```

Gera um `.zip` não assinado em `dist/` com o app empacotado (via
`electron-builder`).

## Segurança

Este projeto trata segurança como requisito de primeira classe, não um
detalhe de implementação — ver o raciocínio completo, risco por risco, em
[`docs/ADR-001`](docs/ADR-001-claude-monitor-seguro.md). Resumo dos
controles:

- **Token cifrado, nunca em texto claro** — `safeStorage` (DPAPI no Windows); sem cifra disponível, login é recusado.
- **`state` OAuth validado** em comparação de tempo constante; expira em 10 min e é consumido numa tentativa só.
- **Escopo mínimo** solicitado ao servidor OAuth — sem poder de criar API keys.
- **Electron isolado**: `contextIsolation`, `sandbox`, `nodeIntegration: false`, sem `child_process`, navegação e popups do renderer bloqueados.
- **CSP estrita** aplicada duas vezes (`<meta>` no HTML e header no processo principal).
- **IPC com allowlist**: toda configuração vinda do renderer passa por validação de tipo/faixa antes de tocar o disco.
- **Sem self-update**: atualizar é `git pull` manual, revisado por você.
- **Cadeia de suprimentos**: versões exatas, `npm ci` + `ignore-scripts`.

Encontrou uma falha de segurança? Não abra uma issue pública — veja
[Contribuindo](#contribuindo) para como reportar de forma responsável.

## Estrutura do projeto

```
claude-monitor/
├── main.js          # Processo principal: janela, IPC, polling de uso, CSP
├── auth.js          # Fluxo OAuth + armazenamento cifrado do token
├── preload.js       # Ponte mínima entre renderer e processo principal
├── usage.js         # Leitura local dos logs do Claude Code (sem rede)
├── config.json      # Configuração padrão
├── renderer/
│   ├── index.html   # Marcação do widget + CSP
│   ├── style.css    # Estilo e animações
│   └── pet.js        # Lógica do bichinho e da UI
└── docs/
    └── ADR-001-*.md  # Decisão de arquitetura de segurança
```

## Atualizando

Não há auto-update (ver ADR-001, risco R4). Para atualizar:

```bash
git pull
```

Revise o diff antes de rodar `npm start` de novo — é assim que a confiança se
mantém sem um mecanismo de update automático.

## Contribuindo

Contribuições são bem-vindas. Para propor uma mudança:

1. Faça um fork do repositório e crie uma branch a partir de `main`: `git checkout -b minha-melhoria`.
2. Rode `npm ci` e `npm run postinstall-electron` para preparar o ambiente.
3. Faça a alteração. Se tocar em `auth.js`, `main.js` ou `preload.js` — os arquivos que lidam com credenciais, rede e IPC —, leia o [ADR-001](docs/ADR-001-claude-monitor-seguro.md) antes: qualquer mudança nesses arquivos precisa manter (ou justificar explicitamente por que relaxa) cada controle listado lá.
4. Teste localmente com `npm start` antes de abrir o PR.
5. Rode `npm audit` se tiver alterado dependências.
6. Abra um Pull Request descrevendo o quê e o porquê da mudança.

Achou uma vulnerabilidade de segurança? Prefira reportar em privado (contato
via perfil do GitHub) em vez de abrir uma issue pública, para dar tempo de
corrigir antes da divulgação.

## Licença

[MIT](LICENSE) — © 2026 [Louissilver](https://github.com/Louissilver).

## Créditos

Inspirado nos widgets [claude-usage-monitor](https://github.com/renatoaug/claude-usage-monitor)
(Renato) e [Claude-Glass](https://github.com/vitoriahellen/Claude-Glass)
(Vitória Silva), cuja auditoria de segurança motivou esta reimplementação.
