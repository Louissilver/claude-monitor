# Claude Monitor

Widget desktop (Electron) que mostra o uso do Claude num bichinho de estimação
na tela — reimplementação própria e mais restritiva do
[claude-usage-monitor](https://github.com/renatoaug/claude-usage-monitor) e do
[Claude-Glass](https://github.com/vitoriahellen/Claude-Glass), com os riscos
de segurança encontrados na auditoria desses dois projetos fechados por
construção. Ver [docs/ADR-001](docs/ADR-001-claude-monitor-seguro.md) para o
raciocínio completo.

Windows apenas. Sem self-update, sem telemetria, sem dependência de runtime.

## Instalação

```bash
npm ci
```

O projeto roda com `ignore-scripts=true` (`.npmrc`) para que nenhuma
dependência da árvore execute script de instalação silenciosamente — inclusive
transitivas de `electron-builder`. Isso também bloqueia o postinstall do
próprio `electron`, que baixa o binário da versão pinada; rode-o manualmente
depois do `npm ci` (é o mesmo script que rodaria sozinho, só que visível e
deliberado):

```bash
npm run postinstall-electron
```

Confira a árvore por vulnerabilidades conhecidas antes de usar:

```bash
npm audit
```

## Rodando

```bash
npm start
```

## Gerando o instalável (.zip)

```bash
npm run dist:win
```

## Conectar a conta Claude (opcional)

Sem conectar, o widget já funciona lendo os logs locais do Claude Code
(`~/.claude/projects/*.jsonl`) — zero token em disco, zero rede. Para ver o %
oficial da Anthropic, clique na engrenagem → "Entrar pelo navegador".

O login exige que o Windows tenha DPAPI disponível (é o mecanismo que cifra o
token em disco — `safeStorage` do Electron). Se `safeStorage` não estiver
disponível no seu perfil do Windows, o app recusa o login em vez de gravar o
token sem cifra.

## Atualizar

Não há auto-update (ver ADR-001, R4). Para atualizar:

```bash
git pull
```

Revise o diff antes de rodar `npm start` de novo — é assim que a confiança se
mantém sem um mecanismo de update automático.
