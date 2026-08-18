#!/usr/bin/env bash
# Instala o Claude Monitor no Ubuntu buildando a partir do código-fonte —
# nenhum binário pré-compilado é baixado ou executado neste script (ver
# docs/ADR-001, R4/R7, e docs/ADR-002). Pra instalar a partir de um .deb já
# pronto (mais rápido, verificado por checksum), veja install-quick.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/Louissilver/claude-monitor/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/Louissilver/claude-monitor.git"
DEST="${HOME}/claude-monitor"

echo "==> Instalando dependências de sistema..."
sudo apt-get update -qq
sudo apt-get install -y -qq git curl \
  libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64 \
  libnotify4 libsecret-1-0

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if ! command -v node >/dev/null 2>&1 || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "==> Node >= 22 não encontrado (claude-monitor exige — ver README), instalando via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

if [ -d "$DEST/.git" ]; then
  echo "==> Repositório já existe em $DEST, atualizando..."
  git -C "$DEST" pull --ff-only
else
  echo "==> Clonando o repositório em $DEST..."
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

cd "$DEST"

echo "==> Instalando dependências do projeto (npm ci)..."
npm ci

echo "==> Baixando o binário do Electron (postinstall bloqueado de propósito por ignore-scripts, roda manual)..."
npm run postinstall-electron

echo "==> Gerando o pacote .deb a partir do código que acabou de ser clonado..."
npm run dist:linux

echo "==> Instalando o pacote..."
sudo apt install -y ./dist/*.deb

echo
echo "✓ Claude Monitor instalado. Abra pelo menu de aplicativos do seu ambiente de desktop."
