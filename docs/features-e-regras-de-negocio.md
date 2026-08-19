# Features e regras de negócio — Claude Monitor

Este documento descreve **o que o produto faz** e **as regras que governam
seu comportamento** — cálculos, limiares, precedência entre estados. Não é
sobre segurança (isso está no [ADR-001](ADR-001-claude-monitor-seguro.md) e
[ADR-002](ADR-002-suporte-linux.md)) nem sobre como instalar (isso está no
[README](../README.md)). É a referência de "por que o app se comporta assim"
para quem for mexer no código ou decidir a próxima feature.

## Índice

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Regras de negócio](#regras-de-negócio)
  - [Sessão de 5 horas](#sessão-de-5-horas)
  - [Semana e orçamentos de plano](#semana-e-orçamentos-de-plano)
  - [Estados do bichinho](#estados-do-bichinho)
  - [Detecção de atividade](#detecção-de-atividade)
  - [Alertas](#alertas)
  - [Custo simulado em $](#custo-simulado-em-)
  - [Mapa de calor de 30 dias](#mapa-de-calor-de-30-dias)
  - [Deduplicação e cache de leitura](#deduplicação-e-cache-de-leitura)
  - [Configuração: origem, validação e precedência](#configuração-origem-validação-e-precedência)
  - [Autostart por sistema operacional](#autostart-por-sistema-operacional)
  - [Janela, bandeja e painéis](#janela-bandeja-e-painéis)
  - [Conta conectada (OAuth)](#conta-conectada-oauth)
  - [Multi-conta](#multi-conta)

## Visão geral

Claude Monitor é um widget de desktop (Windows/Linux) que mostra, em tempo
real, quanto do limite de uso do Claude já foi consumido, através de um
bichinho de estimação animado. Funciona em dois modos, não excludentes:

- **Local** (padrão, sem login): lê os logs do Claude Code em
  `~/.claude/projects/*.jsonl` e estima o uso a partir deles. Zero rede,
  zero token em disco.
- **Conectado** (OAuth opcional): busca o % oficial direto da Anthropic.
  Mais preciso, mas depende de login e de armazenamento seguro disponível
  no sistema (ver ADR-001).

## Funcionalidades

| Funcionalidade | Onde no código | Resumo |
|---|---|---|
| Bichinho animado | `renderer/pet.js`, `renderer/style.css` | Reflete o estado atual (ocioso, trabalhando, dormindo, no limite, pegando fogo) e a atividade (editando, lendo, rodando, pesquisando, delegando, planejando, aguardando) |
| Uso da sessão (5h) | `usage.js` `getUsage()` | Barra de progresso da janela de 5h corrente, com tempo até resetar |
| Uso semanal | `usage.js` `getUsage()` | Barra de progresso dos 7 dias corrente (ou período customizado), com tempo até resetar |
| Uso oficial (conta conectada) | `auth.js`, `main.js` `pollUsage()` | % vindo direto da API da Anthropic, sobrepõe a estimativa local quando conectado |
| Por modelo (7 dias) | `usage.js` `byModel`, `renderer/pet.js` `renderModels()` | Tokens e custo simulado por modelo (Opus/Sonnet/Haiku/Fable/Mythos) |
| Detalhe por tipo de token | `renderer/pet.js` `renderModelDetail()` | Clique num modelo → entrada/saída/cache leitura/cache escrita, cada um com tokens e $ |
| Custo simulado em $ | `usage.js` `PRICING_USD_PER_MTOK`/`costBreakdown()` | Conversão de tokens pra USD como se fosse cobrança via API — não é cobrança real |
| Mapa de calor (30 dias) | `usage.js` `days30`, `renderer/pet.js` `renderHeat()` | Intensidade de cor por dia de uso, com tooltip instantâneo ao passar o mouse |
| Gráfico de uso diário | `renderer/pet.js` `renderChart()` | Gráfico de linha dos mesmos 30 dias, SVG desenhado na mão (sem biblioteca) |
| Alertas | `main.js` `checkAlerts()` | Notificação nativa do SO ao cruzar limiares configuráveis de sessão/semana |
| Configurações | `renderer/index.html`/`pet.js` painel `#settings` | Autostart, alertas, limiares, threshold de fogo, restaurar padrões |
| Bandeja do sistema | `main.js` `createTray()` | Ícone na bandeja; fechar a janela esconde, não mata o processo |
| Single instance | `main.js` `requestSingleInstanceLock` | Segunda tentativa de abrir só foca a janela existente |
| Multiplataforma | `platform.js` | Autostart e checagem de armazenamento seguro adaptados por SO |
| Multi-conta | `main.js`/`auth.js` via `CLAUDE_CONFIG_DIR` | Cada valor de `CLAUDE_CONFIG_DIR` isola dados, config e sessão numa pasta própria |

## Regras de negócio

### Sessão de 5 horas

Espelha o comportamento do painel oficial do Claude Code ("Current
session"). Não é um cron fixo (ex.: 00h–05h) — é uma janela **deslizante**
ancorada no primeiro uso detectado:

1. Olha as últimas 12h de entradas (`recentCutoff`).
2. Ordena por timestamp.
3. Anda pela lista: sempre que a entrada atual está **fora** da janela de 5h
   aberta pela entrada anterior (`e.ts >= sEnd`), abre uma **nova** janela
   começando naquela entrada (`sStart = e.ts`, `sEnd = sStart + 5h`).
4. A sessão "atual" é a última janela aberta — só é considerada **ativa**
   se `now < sEnd` (ainda não expirou).
5. `resetMs` = tempo até `sEnd`. Sem sessão ativa, a UI mostra "sem sessão
   ativa" em vez de uma barra zerada.

`SESSION_MS = 5 * 3600 * 1000` (`usage.js`).

### Semana e orçamentos de plano

Duas formas de calcular o início da semana, mutuamente exclusivas:

- **Padrão**: últimos 7 dias corridos a partir de agora (`now - 7 dias`),
  sem hora de reset fixa.
- **Com âncora** (`config.weeklyAnchorIso` setado): a semana reseta em
  ciclos fixos de 7 dias a partir da data âncora — `lastReset = anchor +
  floor((now - anchor) / 7dias) * 7dias`. Só existe se o usuário editar
  `config.json` manualmente; não há campo pra isso na UI hoje.

Orçamentos (100% = limite do plano) são **estimativas**, não valores
publicados oficialmente pela Anthropic — calibrados a partir do painel
oficial do Max 5x (5h ~24% em 152M tokens, semanal ~62% em 2.14B) e
escalados pelo multiplicador de cada plano:

| Plano | Sessão (5h) | Semanal |
|---|---|---|
| `pro` | 126.000.000 tokens | 690.000.000 tokens |
| `max5x` (padrão) | 630.000.000 tokens | 3.450.000.000 tokens |
| `max20x` | 2.520.000.000 tokens | 13.800.000.000 tokens |

Se `config.plan` não bater com nenhum desses três, cai para
`config.sessionTokenBudget`/`config.weeklyTokenBudget` (valores brutos,
sem preset). Não existe seletor de plano na UI hoje — só editando
`config.json`.

Com conta conectada, os % de sessão e semana exibidos são os **oficiais**
da Anthropic (via `auth.fetchUsage()`), substituindo o cálculo local —
a estimativa acima só é usada no modo offline.

### Estados do bichinho

Um único estado "principal" por vez, nessa ordem de precedência (a
primeira condição verdadeira vence — `renderer/pet.js`, função `render`):

1. **`tired`** (no limite) — conectado **e** sessão ≥ 100%.
2. **`working`** (trabalhando) — `d.active` verdadeiro (ver
   [Detecção de atividade](#detecção-de-atividade)).
3. **`stressed`** (pegando fogo) — conectado **e** sessão ≥
   `fireThreshold` (padrão 90%, configurável 1–99%).
4. **`sleeping`** (dormindo) — `d.sleeping` verdadeiro.
5. **`idle`** (ocioso) — nenhuma das anteriores.

`active`/`sleeping` vêm de `usage.js`: `active` = última atividade nos
logs há ≤ `activeThresholdMs` (padrão 20s); `sleeping` = última atividade
há ≥ `sleepThresholdMs` (padrão 5min). Existe uma zona cinza entre 20s e
5min onde nem `active` nem `sleeping` são verdadeiros — o pet fica
`idle`.

`tired`/`stressed` só disparam com conta conectada (`liveOn`), porque
dependem do % oficial — no modo local, sem login, o pet nunca fica
cansado ou pega fogo, mesmo perto do limite estimado.

### Detecção de atividade

Só roda quando `active` é verdadeiro (não desperdiça leitura de disco à
toa). Lê só os últimos 64KB do arquivo de sessão mais recentemente
tocado, olha as últimas 80 linhas de trás pra frente:

- Se achar `permission-mode`/`mode` = `"plan"` em qualquer uma dessas
  linhas, o resultado é **sempre** `planning` — modo plano tem
  precedência sobre qualquer ferramenta em uso.
- Senão, pega a **última** chamada de ferramenta (`tool_use`) e mapeia
  pro rótulo de atividade (`ACTIVITY_BY_TOOL` em `usage.js`): Edit/Write
  → editando, Read/Grep/Glob → lendo, Bash → executando,
  WebSearch/WebFetch → pesquisando, Task/Agent → delegando,
  TodoWrite/ExitPlanMode → planejando, AskUserQuestion → aguardando.
  Ferramenta não mapeada cai em `working` genérico.

### Alertas

Dois limiares configuráveis (`alertThresholds`, padrão `[80, 95]`, 1 a 4
valores entre 1–100), checados contra sessão **e** semana
independentemente. Cada combinação limiar×escopo tem uma trava
("armed") pra não notificar repetido:

- Cruzou o limiar pela primeira vez → notifica, marca como "armado".
- Continua acima → não notifica de novo.
- Cai abaixo → desarma; se cruzar de novo, notifica outra vez.

Notificação nativa do SO (`Notification` do Electron) — se o SO não
suportar notificações, o alerta simplesmente não dispara (sem erro).
Trocar qualquer configuração via `save-config` limpa todos os "armados"
(`armed.clear()`), pra não perder um alerta genuíno logo após editar os
limiares.

### Custo simulado em $

**Não é cobrança real** — é uma simulação de "quanto custaria via API
pay-as-you-go" para dar noção de escala, mesmo num plano de preço fixo
(Pro/Max). Regras:

- Preço por milhão de tokens, por família de modelo, com 4 taxas
  diferentes (entrada, saída, cache leitura, cache escrita) — não é um
  preço único por token, cache leitura é ~10–20x mais barato que
  entrada normal, e saída é 5x mais cara que entrada.
- Só famílias com preço público conhecido têm $: **Opus, Sonnet, Haiku**.
  **Fable e Mythos ficam sem $** — de propósito, melhor omitir do que
  simular um número inventado sem base real.
- Custo é computado **por modelo já agregado** (soma dos tokens de cada
  tipo × preço), não por entrada individual — matematicamente
  equivalente (custo é linear) e mais simples de manter.
- Preços são estimativas de referência hardcoded no código
  (`PRICING_USD_PER_MTOK`) — a Anthropic pode mudar a qualquer momento, o
  app não busca preço atualizado de lugar nenhum.

### Mapa de calor de 30 dias

Nível de cor (0 a 4) por dia, relativo ao **dia de maior uso dentro da
janela de 30 dias** (não a um valor absoluto fixo):

```
proporção = tokens_do_dia / max(1, maior_dia_dos_30)
nível 0: sem uso        nível 1: < 30%
nível 2: 30–60%          nível 3: 60–85%
nível 4: ≥ 85%
```

Os mesmos 30 valores (`days30`) alimentam tanto o mapa de calor quanto o
gráfico de linha — um único cálculo em `usage.js`, duas visualizações no
renderer.

### Deduplicação e cache de leitura

- Cada entrada de log tem uma chave `messageId:requestId|uuid`. Se a
  mesma chave aparecer de novo (ex.: mesma resposta relida em runs
  diferentes do scan), só conta uma vez (`seen` Set, por chamada de
  `getUsage()` — não persiste entre chamadas).
- Arquivos `.jsonl` só são reparseados se `mtimeMs`/tamanho mudaram desde
  a última leitura (`fileCache`) — evita reprocessar 30 dias de logs a
  cada tick de 4s.
- Mensagens com `model === '<synthetic>'` são descartadas — são
  internas do Claude Code, não representam uso real de tokens.

### Configuração: origem, validação e precedência

Ordem de leitura em `loadConfig()`: primeiro tenta
`~/.claude-monitor/config.json` (ou o path sob `CLAUDE_CONFIG_DIR`, se
setado); se não existir/for inválido, cai pro `config.json` embutido no
app; por fim, cai nos `DEFAULT_CONFIG` do próprio `main.js`. Compat:
configs salvos antes do port Linux usavam `startWithWindows` em vez de
`startAtLogin` — lido e migrado automaticamente na carga.

Nada que o renderer manda via `save-config` é gravado sem passar pelo
`CONFIG_SCHEMA` (allowlist de chave + validador de tipo/faixa por
campo) — chave desconhecida (inclusive `__proto__`/`constructor`) é
descartada silenciosamente, nunca chega no disco.

### Autostart por sistema operacional

Nunca é a mesma API nos dois SOs (`platform.js`):

- **Windows**: `app.setLoginItemSettings({ openAtLogin })` — API nativa
  do Electron.
- **Linux**: escreve/remove um arquivo `.desktop` em
  `~/.config/autostart/` (spec XDG Autostart, lido por GNOME/KDE/XFCE/
  Cinnamon/MATE no login da sessão). `Exec=` aponta pra
  `$APPIMAGE` (rodando via AppImage) ou `process.execPath` (instalado
  via `.deb`).

Em ambos, só age se `app.isPackaged` for verdadeiro — em desenvolvimento
(`npm start`), nunca mexe na inicialização do sistema.

### Janela, bandeja e painéis

- **Fechar (×) esconde, não mata o processo.** Sair de verdade só existe
  pelo menu da bandeja ("Sair"). A janela intercepta o evento nativo
  `close` e cancela, a menos que `quitting` esteja `true` (setado só em
  `before-quit`, disparado por um `app.quit()` real).
- **Uma instância só.** `requestSingleInstanceLock()` — a segunda
  tentativa de abrir só foca a janela já existente e sai, sem duplicar
  poller de uso.
- **Três painéis mutuamente exclusivos**: Configurações, Gráfico e
  Detalhe por modelo. Abrir qualquer um fecha os outros dois
  automaticamente. Nenhum dos três pode ficar aberto junto com o modo
  colapsado (minimizado).
- **Reposicionamento**: preserva onde o usuário arrastou a janela ao
  redimensionar (colapsar/expandir não teleporta de volta pro canto).
  Só reposiciona pro canto inferior direito em três casos explícitos: a
  primeira abertura, o botão "Centralizar posição" da bandeja, e o botão
  "Restaurar padrões" das configurações.

### Conta conectada (OAuth)

- Escopo pedido: `user:profile user:inference` — sem
  `org:create_api_key` (o app nunca cria API keys, não pede esse poder).
- Login por navegador (PKCE + `state` validado em comparação de tempo
  constante) ou colando um token de longa duração direto (precisa bater
  com o formato `sk-ant-oat...`).
- Token só é persistido se `safeStorage` estiver disponível **e**, no
  Linux, o backend não for `basic_text` (que não cifra, só ofusca) — sem
  isso, login é recusado, nunca há fallback pra texto claro.
- Refresh automático quando o token expira em menos de 60s
  (`validToken()`); refresh rejeitado (400/403) desloga automaticamente;
  erro transitório (429/5xx) mantém a sessão e tenta de novo depois.
- Polling de uso: a cada 5 minutos quando conectado; em 429 (rate
  limit), o intervalo dobra a cada tentativa até um teto de 30 minutos,
  e volta a 5 min assim que uma chamada funciona de novo.

### Multi-conta

Setar `CLAUDE_CONFIG_DIR` isola **tudo** daquela conta numa subpasta
própria: `userData` do Electron, `config.json`, token cifrado do OAuth
(`auth.enc`), e o próprio diretório de projetos do Claude Code lido pelo
`usage.js` (`CLAUDE_CONFIG_DIR/projects`). Duas instâncias do app com
`CLAUDE_CONFIG_DIR` diferentes rodam em paralelo sem colidir — cada uma
pensa que é a única instância (o lock de instância única é por processo/
`userData`, não global).
