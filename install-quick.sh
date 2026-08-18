#!/usr/bin/env bash
# Instala o Claude Monitor no Ubuntu a partir do .deb pré-compilado da
# última Release no GitHub. Verifica o checksum SHA256 antes de instalar
# qualquer coisa — sem isso, confiar num binário pré-compilado seria
# exatamente o risco que o ADR-001 (R4) rejeitou no projeto original.
# Pra buildar do código-fonte em vez de confiar num binário, veja install.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/Louissilver/claude-monitor/main/install-quick.sh | bash
set -euo pipefail

REPO="Louissilver/claude-monitor"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 não encontrado — necessário pra ler a API do GitHub com segurança." >&2
  echo "Use install.sh (build do código-fonte) em vez deste script." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Buscando a última release em github.com/${REPO}..."
API="https://api.github.com/repos/${REPO}/releases/latest"
curl -fsSL "$API" -o "$TMP/release.json"

# name (nome real do arquivo) é lido do JSON, não derivado da URL — a URL
# de download vem com espaços percent-encoded (%20), então "basename" nela
# não bateria com o nome de arquivo real usado dentro do SHA256SUMS.
#
# Tudo passado pro Python via variável de ambiente, nunca interpolado
# dentro do texto do script — não tem string vinda do JSON entrando na
# sintaxe do Python, então não existe classe de injeção via nome de asset.
PARSED="$(RELEASE_JSON="$TMP/release.json" python3 -c "
import json, os
with open(os.environ['RELEASE_JSON']) as f:
    data = json.load(f)
assets = {a['name']: a['browser_download_url'] for a in data['assets']}
deb_name = next((n for n in assets if n.endswith('.deb')), '')
print(deb_name)
print(assets.get(deb_name, ''))
print(assets.get('SHA256SUMS', ''))
")"
DEB_NAME="$(sed -n '1p' <<< "$PARSED")"
DEB_URL="$(sed -n '2p' <<< "$PARSED")"
SUMS_URL="$(sed -n '3p' <<< "$PARSED")"

if [ -z "$DEB_NAME" ] || [ -z "$DEB_URL" ] || [ -z "$SUMS_URL" ]; then
  echo "Não encontrei .deb e/ou SHA256SUMS na última release. Abortando." >&2
  echo "Use install.sh (build do código-fonte) como alternativa." >&2
  exit 1
fi

echo "==> Baixando ${DEB_NAME}..."
curl -fsSL "$DEB_URL" -o "$TMP/$DEB_NAME"
curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS"

echo "==> Verificando checksum..."
if ! (cd "$TMP" && grep -F " $DEB_NAME" SHA256SUMS | sha256sum -c -); then
  echo "Checksum não confere — o arquivo pode estar corrompido ou adulterado." >&2
  echo "Instalação abortada. Nada foi instalado." >&2
  exit 1
fi

echo "==> Checksum ok. Instalando..."
sudo apt install -y "$TMP/$DEB_NAME"

echo
echo "✓ Claude Monitor instalado. Abra pelo menu de aplicativos do seu ambiente de desktop."
