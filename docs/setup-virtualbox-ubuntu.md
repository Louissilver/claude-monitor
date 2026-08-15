# Setup: VM Ubuntu Desktop no VirtualBox (para validar o Claude Monitor Linux)

Guia para criar o ambiente de teste "de verdade" do port Linux (ADR-002) —
o único que reproduz keyring (gnome-keyring), autostart XDG e notificações
nativas, coisas que o WSLg não reproduz. Se sua máquina Windows é **Home**
(sem Hyper-V), VirtualBox é o caminho; se for **Pro/Enterprise**, Hyper-V com
Quick Create é uma alternativa mais rápida (não coberta aqui).

Tempo estimado: ~30–40 min na primeira vez (a maior parte é o instalador do
Ubuntu rodando sozinho).

## 1. Instalar o VirtualBox

1. Baixe em [virtualbox.org/wiki/Downloads](https://www.virtualbox.org/wiki/Downloads) → "Windows hosts".
2. Rode o instalador com as opções padrão.
3. (Opcional, mas recomendado) instale também o **VirtualBox Extension Pack**
   da mesma página — melhora suporte a USB e desempenho gráfico.
4. Se o Windows tiver Hyper-V ativo (comum com WSL2 instalado), o VirtualBox
   pede para reiniciar para usar seu modo de virtualização compatível
   (Windows Hypervisor Platform) — aceite e reinicie. WSL continua funcionando
   normalmente depois.

## 2. Baixar o Ubuntu Desktop

1. Baixe a ISO do **Ubuntu Desktop 24.04 LTS** (ou a LTS mais recente) em
   [ubuntu.com/download/desktop](https://ubuntu.com/download/desktop).
2. Guarde o `.iso` em uma pasta fácil de achar (ex.: `D:\ISOs\ubuntu-24.04-desktop-amd64.iso`).

## 3. Criar a máquina virtual

1. Abra o VirtualBox → **Novo**.
2. Nome: `Ubuntu Claude Monitor`. Tipo: `Linux`. Versão: `Ubuntu (64-bit)`.
3. Na tela de ISO, aponte para o arquivo baixado — o VirtualBox 7.x oferece
   **instalação não assistida** (preenche usuário/senha automaticamente);
   pode usar ou desmarcar e instalar manualmente, como preferir.
4. Memória: **4096 MB** (mínimo confortável; 8192 MB se sua máquina tiver
   folga).
5. CPU: **2 núcleos** (mais, se disponível).
6. Disco: **25 GB**, dinamicamente alocado.
7. Confirme e deixe a instalação come do zero rodar. Se não usou a instalação
   não assistida, siga o instalador gráfico do Ubuntu (idioma, teclado,
   "Instalação normal", apagar disco — é o disco virtual, não afeta o
   Windows —, criar usuário).
8. Ao terminar, reinicie a VM quando solicitado.

## 4. Pós-instalação

1. Faça login no Ubuntu.
2. Instale as **Guest Additions** (melhora resolução de tela e permite
   clipboard compartilhado, útil para copiar comandos deste tutorial para
   dentro da VM):
   - Menu da janela da VM → **Dispositivos** → **Inserir imagem de CD das Adições
     para Convidado…** Se aparecer um popup perguntando se quer rodar o
     software, feche-o — vamos rodar via terminal.
   - Instale as dependências e entre no diretório onde o CD foi montado
     (o nome exato da pasta varia por versão, por isso o `*`):
     ```bash
     sudo apt update
     sudo apt install -y build-essential dkms linux-headers-$(uname -r)
     cd /media/$USER/VBox_GAs_*/
     ```
   - Confira que o instalador está ali antes de rodar (se `cd` der erro de
     "No such file or directory", o CD não montou — repita o passo do menu
     **Dispositivos** acima e tente de novo):
     ```bash
     ls
     sudo ./VBoxLinuxAdditions.run
     ```
   - Reinicie a VM.
3. Atualize o sistema:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
4. (Opcional, recomendado) Tire um **snapshot** da VM agora (menu **Máquina**
   → **Fazer snapshot**) — assim, testes futuros voltam a um Ubuntu limpo e
   atualizado em segundos, sem reinstalar do zero.

## 5. Preparar o ambiente para rodar o Claude Monitor

Dentro da VM Ubuntu, abra um terminal:

```bash
# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git

# libs de runtime que o Electron precisa (mesmas do .deb, ver package.json)
sudo apt install -y libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 \
  libasound2t64 libnotify4 libsecret-1-0
```

## 6. Clonar e rodar o projeto

```bash
git clone https://github.com/Louissilver/claude-monitor.git
cd claude-monitor
npm ci
npm run postinstall-electron
npm start
```

O widget deve abrir ancorado no canto da tela, igual no Windows. É aqui que
dá pra testar o que o WSLg não cobre:

- **Login OAuth** (engrenagem → Entrar pelo navegador): o Ubuntu Desktop já
  roda GNOME com gnome-keyring ativo por padrão — é o único ambiente, dos
  três (Windows real, WSLg, VM), onde o fluxo completo de cifra do token é
  testável de ponta a ponta.
- **Notificação de alerta**: force um teste rápido reduzindo `alertThresholds`
  em `~/.claude-monitor/config.json` para algo como `[1, 2]` e reabra o app —
  deve aparecer a notificação nativa do GNOME.

## 7. Testar o pacote `.deb` (instalação "de verdade")

Builds `.deb`/AppImage não funcionam no host Windows puro (o electron-builder
pula o alvo `.deb` silenciosamente e o AppImage falha por causa de symlink —
Windows exige privilégio elevado para isso). Gere o pacote **de dentro desta
mesma VM** ou do WSL:

```bash
npm run dist:linux
sudo apt install ./dist/*.deb
```

Depois:

1. Abra o **Claude Monitor** pelo launcher de aplicativos do GNOME (confirma
   que o ícone/entrada `.desktop` foi instalado corretamente).
2. Na engrenagem, marque "Iniciar automaticamente ao entrar na sessão" e
   salve — confirme que o arquivo foi criado:
   ```bash
   cat ~/.config/autostart/claude-monitor.desktop
   ```
3. **Reinicie a VM** e faça login de novo — o widget deve abrir sozinho, sem
   precisar rodar `npm start` manualmente. Esse é o teste que nem o WSL nem
   Docker conseguem fazer (não têm sessão de login de desktop).
4. Desmarque a opção e confirme que o arquivo `.desktop` some.

## 8. Desinstalar / limpar

```bash
sudo apt remove claude-monitor
rm -rf ~/.claude-monitor ~/claude-monitor
```

Ou simplesmente restaure o snapshot do passo 4 para voltar a um estado limpo.
