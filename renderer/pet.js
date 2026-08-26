const SVGNS = 'http://www.w3.org/2000/svg'
const el = (id) => document.getElementById(id)

// Claude pixel-art sprite
const SPRITE = [
  '.########.',
  '.########.',
  '##########',
  '###o##o###',
  '##########',
  '.########.',
  '.########.',
  '.#.#..#.#.',
  '.#.#..#.#.',
]

;(function buildPixel() {
  const body = el('body')
  const eyes = el('eyes')
  const C = 10
  SPRITE.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const rect = document.createElementNS(SVGNS, 'rect')
      rect.setAttribute('x', c * C)
      rect.setAttribute('y', r * C)
      rect.setAttribute('width', C)
      rect.setAttribute('height', C)
      body.appendChild(rect)
      if (ch === 'o') {
        const eye = document.createElementNS(SVGNS, 'rect')
        eye.setAttribute('x', c * C)
        eye.setAttribute('y', r * C)
        eye.setAttribute('width', C)
        eye.setAttribute('height', C)
        eyes.appendChild(eye)
      }
    }
  })
})()

// Skins: roupa desenhada por cima do corpo nas linhas 4-6 do SPRITE
// ("camisa") e linha 7 ("bermuda") — por padrão reaproveita essas linhas
// tal qual (shirtMask opcional por skin substitui, sempre como
// SUBCONJUNTO das células do SPRITE ali, nunca acrescenta célula fora
// dele), então a roupa nunca escapa da silhueta do bichinho. Cocar/chapéu
// usa a mesma técnica do buildHat() acima (bitmap próprio, posicionado
// com y negativo acima da cabeça).
//
// "ninja" e "pirata" são inspirados livremente em arquétipos genéricos
// (não em personagens específicos) — nome do personagem não aparece em
// lugar nenhum do código nem da UI, e cada skin mistura pelo menos um
// elemento fora da paleta do personagem que inspirou o pedido original
// (pirata: faixa do chapéu e bermuda marrom, nunca a combinação de três
// cores que tornaria identificável). Ver docs/ADR-001 e o histórico da
// conversa que definiu esse critério antes de desenhar qualquer coisa.
const SKINS = {
  default: null, // sem sobreposição — cor base do bichinho (var(--pixel))
  brasil: {
    label: 'Seleção',
    shirtColor: '#f4d64b', // amarelo canarinho
    // mesma altura da camisa da skin Pirata (só linha 6, afastada dos
    // olhos e da boca) mas fechada — sem o vão do meio, que é só da
    // versão "aberta" da Pirata
    shirtMask: [SPRITE[6]],
    shirtStartRow: 6,
    shortsColor: '#1e4fa3', // azul
  },
  ninja: {
    label: 'Ninja',
    shirtColor: '#141414', // mesma cor da máscara — não o laranja de personagem nenhum
    shortsColor: '#141414',
    headbandColor: '#141414',
  },
  pirata: {
    // Paleta igual à do personagem que inspirou o pedido, por decisão
    // explícita do usuário (confirmado sabendo do risco — ver conversa).
    // Não é mais a versão genérica original deste projeto.
    label: 'Pirata',
    shirtColor: '#c0392b', // vermelho
    // "aberta": vão no meio do peito (mostra a cor base do corpo por
    // baixo) em vez do preenchimento cheio do SPRITE — efeito colete,
    // não camisa fechada. Continua um subconjunto das células do
    // SPRITE nessas linhas, então nunca escapa da silhueta do corpo.
    // Só a linha 6 (não 4-6) — deixa as linhas 4 e 5 com a cor base do
    // corpo, afastando a camisa tanto dos olhos (linha 3) quanto da
    // boca (que ocupa parte das linhas 4-5, y 54-64). Fica pequena de
    // propósito.
    shirtMask: ['.###..###.'],
    shirtStartRow: 6,
    shortsColor: '#2a4a8a', // azul
    hatColor: '#d9b25c',
    hatBandColor: '#c0392b', // faixa vermelha
  },
}

function paintSpriteRows(group, rows, startRow, color) {
  const C = 10
  rows.forEach((rowStr, i) => {
    const r = startRow + i
    for (let c = 0; c < rowStr.length; c++) {
      if (rowStr[c] === '.') continue
      const rect = document.createElementNS(SVGNS, 'rect')
      rect.setAttribute('x', c * C)
      rect.setAttribute('y', r * C)
      rect.setAttribute('width', C)
      rect.setAttribute('height', C)
      rect.setAttribute('fill', color)
      group.appendChild(rect)
    }
  })
}
// Linha 3 do SPRITE é `###o##o###` (índices 0-9, 'o' = olho em 3 e 6).
// Máscara da bandana só cobre as duas pontas (0,1 e 8,9) nessa linha —
// libera dois pixels de cada lado de cada olho (2,4 em volta do olho em
// 3; 5,7 em volta do olho em 6) e o que sobra entre eles (4,5), com a
// cor base do bichinho aparecendo aí. Ainda um subconjunto da linha
// original do SPRITE (nunca pinta onde o SPRITE tem '.').
const NINJA_MASK_ROW3 = '##......##'

function buildHeadband(group, color) {
  // Máscara cobre a cabeça inteira (linhas 0-2 do SPRITE cheias) mais a
  // linha 3 recortada acima. #eyes é desenhado DEPOIS de #skin-overlay
  // no SVG (ver index.html), então os próprios pixels dos olhos aparecem
  // por cima da máscara de qualquer forma, independente do que tem por
  // baixo. Não desce até a linha 4 de propósito — ali começa a camisa
  // (rows4-6), evita as duas sobreposições brigando por cor na mesma
  // célula.
  paintSpriteRows(group, [...SPRITE.slice(0, 3), NINJA_MASK_ROW3], 0, color)
  // tira caindo atrás, saindo de baixo da máscara
  const tail = document.createElementNS(SVGNS, 'rect')
  tail.setAttribute('x', 78)
  tail.setAttribute('y', 30)
  tail.setAttribute('width', 5)
  tail.setAttribute('height', 20)
  tail.setAttribute('fill', color)
  group.appendChild(tail)
}
function buildStrawHat(group, hatColor, bandColor) {
  const brim = document.createElementNS(SVGNS, 'rect')
  brim.setAttribute('x', -8)
  brim.setAttribute('y', -14)
  brim.setAttribute('width', 116)
  brim.setAttribute('height', 6)
  brim.setAttribute('rx', 3)
  brim.setAttribute('fill', hatColor)
  group.appendChild(brim)
  const crown = document.createElementNS(SVGNS, 'rect')
  crown.setAttribute('x', 22)
  crown.setAttribute('y', -30)
  crown.setAttribute('width', 56)
  crown.setAttribute('height', 18)
  crown.setAttribute('rx', 4)
  crown.setAttribute('fill', hatColor)
  group.appendChild(crown)
  const band = document.createElementNS(SVGNS, 'rect')
  band.setAttribute('x', 22)
  band.setAttribute('y', -16)
  band.setAttribute('width', 56)
  band.setAttribute('height', 4)
  band.setAttribute('fill', bandColor)
  group.appendChild(band)
}
function applySkin(key) {
  const group = el('skin-overlay')
  if (!group) return
  clearChildren(group)
  const skin = SKINS[key]
  if (!skin) return // 'default' (ou chave desconhecida): sem roupa
  paintSpriteRows(group, skin.shirtMask || SPRITE.slice(4, 7), skin.shirtStartRow || 4, skin.shirtColor)
  paintSpriteRows(group, [SPRITE[7]], 7, skin.shortsColor)
  if (skin.headbandColor) buildHeadband(group, skin.headbandColor)
  if (skin.hatColor) buildStrawHat(group, skin.hatColor, skin.hatBandColor)
}

// hard hat (mechanic mode): pixel-art bitmap so it matches the pet's blocky look
;(function buildHat() {
  const g = el('hardhat')
  if (!g) return
  // L = highlight, Y = main, D = shadow rim, B = brim
  const HAT = [
    '.....YLLY.....',
    '...YYYLLYYY...',
    '..YYYYLLYYYY..',
    '.YYYYYLLYYYYY.',
    '.DDDDDDDDDDDD.',
    'BBBBBBBBBBBBBB',
  ]
  const COL = { L: '#ffe27a', Y: '#f5c518', D: '#d99a00', B: '#c98f14' }
  const C = 8 // cell size in svg units
  const cols = HAT[0].length
  const ox = 50 - (cols * C) / 2 // centered on the head (center x = 50)
  const oy = -24 // rises above the head, brim ends just over the eyes
  HAT.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const rect = document.createElementNS(SVGNS, 'rect')
      rect.setAttribute('x', ox + c * C)
      rect.setAttribute('y', oy + r * C)
      rect.setAttribute('width', C)
      rect.setAttribute('height', C)
      rect.setAttribute('fill', COL[ch])
      g.appendChild(rect)
    }
  })
})()

// night scene backdrop (clouds, crescent moon, stars, dotted ground/sky)
;(function buildScene() {
  const s = el('scene')
  if (!s) return
  const add = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    s.appendChild(e)
  }
  // dotted top + bottom (sky + ground)
  for (let x = 4; x <= 212; x += 9) {
    add('circle', { cx: x, cy: 6, r: 1.3, fill: '#fff', 'fill-opacity': 0.85 })
    add('circle', { cx: x, cy: 130, r: 1.3, fill: '#fff', 'fill-opacity': 0.85 })
  }
  // clouds (blocky, dark gray)
  const cloud = (x, y, b, m, t) => {
    add('rect', { x: x + 12, y: y, width: t, height: 9, fill: '#3a3a3a' })
    add('rect', { x: x + 5, y: y + 7, width: m, height: 9, fill: '#3a3a3a' })
    add('rect', { x: x, y: y + 14, width: b, height: 10, fill: '#3a3a3a' })
  }
  cloud(16, 10, 58, 42, 22)
  cloud(120, 50, 40, 28, 15)
  // stars (small plus)
  const star = (x, y) => {
    add('rect', { x: x - 3, y: y - 0.7, width: 6, height: 1.4, fill: '#d8d8d8' })
    add('rect', { x: x - 0.7, y: y - 3, width: 1.4, height: 6, fill: '#d8d8d8' })
  }
  ;[
    [100, 16],
    [60, 22],
    [150, 100],
    [196, 56],
    [205, 98],
    [128, 26],
    [182, 22],
    [202, 14],
  ].forEach(([x, y]) => {
    star(x, y)
  })
})()

// reading mode: the doc's filename slowly cycles through project docs, since
// it's a Claude app "reading" different files (a gentle fade between names)
;(function cycleDocName() {
  const node = el('dc-fname')
  if (!node) return
  const names = [
    'README.md',
    'ARCHITECTURE.md',
    'api.md',
    'AUTH.md',
    'MIGRATION.md',
    'CONTRIBUTING.md',
    'usage.md',
    'config.md',
  ]
  let i = 0
  setInterval(() => {
    node.style.opacity = '0'
    setTimeout(() => {
      i = (i + 1) % names.length
      node.textContent = names[i]
      node.style.opacity = '1'
    }, 260)
  }, 3800)
})()

// helpers
function fmtTokens(t) {
  t = t || 0
  if (t >= 1e9) return `${(t / 1e9).toFixed(2)}B`
  if (t >= 1e6) return `${(t / 1e6).toFixed(1)}M`
  if (t >= 1e3) return `${(t / 1e3).toFixed(1)}k`
  return String(t)
}
function fmtReset(ms) {
  if (!ms || ms <= 0) return 'now'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
// simulação de custo via API — não é cobrança real (ver usage.js)
function fmtUsd(v) {
  if (v == null) return null
  if (v > 0 && v < 0.01) return '<$0.01'
  return `$${v.toFixed(2)}`
}
function setState(name) {
  const b = document.body
  ;[...b.classList].forEach((c) => {
    if (c.startsWith('state-')) b.classList.remove(c)
  })
  b.classList.add(`state-${name}`)
}

// coins (Claude "eating" tokens) — arc in, spin, get gulped with a crumb pop
const W = 86
const H = 77
const MOUTH_X = 43
const MOUTH_Y = 46

function spawnCoin() {
  const zone = el('dropzone')
  const coin = document.createElement('div')
  coin.className = 'coin'
  const sz = 6 + Math.random() * 3
  coin.style.width = coin.style.height = `${sz.toFixed(1)}px`

  const side = Math.floor(Math.random() * 4)
  let x, y
  if (side === 0) {
    x = Math.random() * W
    y = -10
  } else if (side === 1) {
    x = W + 10
    y = Math.random() * H * 0.7
  } else if (side === 2) {
    x = Math.random() * W
    y = H + 10
  } else {
    x = -10
    y = Math.random() * H * 0.7
  }
  coin.style.left = `${x}px`
  coin.style.top = `${y}px`
  zone.appendChild(coin)

  const dx = MOUTH_X - x
  const dy = MOUTH_Y - y
  // perpendicular offset -> curved arc toward the mouth
  const mxo = dx * 0.5 - dy * 0.18
  const myo = dy * 0.5 + dx * 0.18
  const rot = (Math.random() * 2 - 1) * 320
  const anim = coin.animate(
    [
      { transform: 'translate(0,0) scale(0.7) rotate(0deg)', opacity: 0.95 },
      {
        transform: `translate(${mxo}px,${myo}px) scale(1) rotate(${(rot * 0.6).toFixed(0)}deg)`,
        opacity: 1,
        offset: 0.55,
      },
      {
        transform: `translate(${dx}px,${dy}px) scale(0.2) rotate(${rot.toFixed(0)}deg)`,
        opacity: 0,
      },
    ],
    { duration: 780 + Math.random() * 320, easing: 'cubic-bezier(0.45,0,0.55,1)' },
  )
  anim.onfinish = () => {
    coin.remove()
    popCrumbs()
    chomp() // mouth opens to eat it
    nibble() // tiny gulp reaction
  }
}

// the mouth opens and snaps shut on each token
function chomp() {
  el('mouth').animate(
    [
      { transform: 'scaleY(0.1)' },
      { transform: 'scaleY(1)', offset: 0.4 },
      { transform: 'scaleY(0.1)' },
    ],
    { duration: 240, easing: 'ease-in-out' },
  )
}

// quick squash of the whole pet on each gulp (doesn't fight the hop on #claude)
function nibble() {
  el('pet').animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.06, 0.94)', offset: 0.5 },
      { transform: 'scale(1, 1)' },
    ],
    { duration: 200, easing: 'ease' },
  )
}

// poke reaction: bouncy squish + little hearts floating up
function popHearts() {
  const zone = el('dropzone')
  const n = 5
  for (let i = 0; i < n; i++) {
    const h = document.createElement('div')
    h.className = 'heart'
    h.textContent = '♥'
    // spread across lanes along the width + a little jitter
    const baseX = 14 + i * 15 + (Math.random() * 6 - 3)
    h.style.left = `${baseX.toFixed(0)}px`
    h.style.top = `${(14 + Math.random() * 12).toFixed(0)}px`
    zone.appendChild(h)
    // fan outward from the center
    const dx = (baseX - 43) * 0.55 + (Math.random() * 8 - 4)
    const a = h.animate(
      [
        { transform: 'translate(0, 8px) scale(0.4)', opacity: 0 },
        {
          transform: `translate(${(dx * 0.5).toFixed(1)}px, -12px) scale(1.3)`,
          opacity: 1,
          offset: 0.3,
        },
        { transform: `translate(${dx.toFixed(1)}px, -48px) scale(0.85)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 350, easing: 'ease-out', delay: i * 120 },
    )
    a.onfinish = () => h.remove()
  }
}
function pokePet() {
  oneShot('poke', 850)
  popHearts()
}

function popCrumbs() {
  const zone = el('dropzone')
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('div')
    c.className = 'crumb'
    c.style.left = `${MOUTH_X}px`
    c.style.top = `${MOUTH_Y}px`
    zone.appendChild(c)
    const ang = Math.random() * Math.PI * 2
    const d = 5 + Math.random() * 8
    const a = c.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 0.9 },
        {
          transform: `translate(${(Math.cos(ang) * d).toFixed(1)}px, ${(Math.sin(ang) * d - 4).toFixed(1)}px) scale(0.2)`,
          opacity: 0,
        },
      ],
      { duration: 240 + Math.random() * 160, easing: 'ease-out' },
    )
    a.onfinish = () => c.remove()
  }
}

// continuous stream while working; faster when burning more tokens/min
let eatTimer = null
let eating = false
let currentRate = 0
function eatInterval() {
  return Math.max(750, 1700 - Math.min(850, currentRate / 2600))
}
function startEating() {
  stopEating()
  const loop = () => {
    spawnCoin()
    eatTimer = setTimeout(loop, eatInterval())
  }
  loop()
}
function stopEating() {
  if (eatTimer) clearTimeout(eatTimer)
  eatTimer = null
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

// Tooltip instantâneo compartilhado (mapa de calor + gráfico) — posiciona
// relativo a #card, que já é o ancestral posicionado (position: absolute)
// mais próximo de qualquer elemento da UI, então funciona tanto para os
// quadradinhos do heat map quanto para os pontos <circle> do SVG do gráfico.
function showTip(targetEl, text) {
  const tip = el('tooltip')
  const card = el('card')
  tip.textContent = text
  tip.hidden = false
  const cardRect = card.getBoundingClientRect()
  const targetRect = targetEl.getBoundingClientRect()
  let left = targetRect.left - cardRect.left + targetRect.width / 2
  tip.style.left = `${left}px`
  tip.style.top = `${targetRect.top - cardRect.top}px`
  // clampa depois de medir a largura real do tooltip, pra não vazar pra
  // fora da janela (que não tem scroll — conteúdo fora da borda só some)
  requestAnimationFrame(() => {
    if (tip.hidden) return
    const half = tip.getBoundingClientRect().width / 2
    left = Math.min(cardRect.width - half - 4, Math.max(half + 4, left))
    tip.style.left = `${left}px`
  })
}
function hideTip() {
  el('tooltip').hidden = true
}

// 30-day map
function renderHeat(days) {
  const row = el('heat-row')
  clearChildren(row)
  hideTip() // quadrados velhos (com os listeners) somem nesse clearChildren
  const max = Math.max(1, ...days)
  days.forEach((v, i) => {
    const sq = document.createElement('div')
    let lv = 0
    if (v > 0) {
      const r = v / max
      lv = r < 0.3 ? 1 : r < 0.6 ? 2 : r < 0.85 ? 3 : 4
    }
    sq.className = `sq${lv ? ` lv${lv}` : ''}`
    const daysAgo = days.length - 1 - i
    const label = `${daysAgo === 0 ? 'hoje' : `${daysAgo}d atrás`} · ${fmtTokens(v)} tokens`
    sq.addEventListener('mouseenter', () => showTip(sq, label))
    sq.addEventListener('mouseleave', hideTip)
    row.appendChild(sq)
  })
}

// by model (7 days)
// Construído com DOM/textContent em vez de innerHTML: `m.label` vem de um
// campo "model" lido de arquivos locais (~/.claude/projects/*.jsonl) — nunca
// deve ser interpretado como HTML, mesmo que hoje esses arquivos só sejam
// escritos pelo próprio Claude Code.
function renderModels(list) {
  const box = el('bymodel-list')
  clearChildren(box)
  const top = list.slice(0, 4)
  const max = Math.max(1, ...top.map((m) => m.tokens))
  for (const m of top) {
    const row = document.createElement('div')
    row.className = 'mrow'

    const name = document.createElement('span')
    name.className = 'mname'
    name.textContent = m.label

    const barWrap = document.createElement('span')
    barWrap.className = 'mbar'
    const bar = document.createElement('i')
    bar.style.width = `${(m.tokens / max) * 100}%`
    barWrap.appendChild(bar)

    const val = document.createElement('span')
    val.className = 'mval'
    const usd = fmtUsd(m.costUsd)
    val.textContent = usd ? `${fmtTokens(m.tokens)} · ${usd}` : fmtTokens(m.tokens)

    row.append(name, barWrap, val)
    row.addEventListener('click', () => openModelDetail(m))
    box.appendChild(row)
  }
  if (!top.length) {
    const empty = document.createElement('div')
    empty.className = 'mrow mrow-empty'
    empty.style.opacity = '.5'
    empty.textContent = 'sem atividade'
    box.appendChild(empty)
  }
}

// painel de detalhe por tipo de token (entrada/saída/cache), aberto ao
// clicar num modelo em "por modelo"
function renderModelDetail(m) {
  el('model-detail-title').textContent = m.label
  const rows = el('model-detail-rows')
  clearChildren(rows)
  const items = [
    ['Entrada', m.input, m.cost && m.cost.input],
    ['Saída', m.output, m.cost && m.cost.output],
    ['Cache · leitura', m.cacheRead, m.cost && m.cost.cacheRead],
    ['Cache · escrita', m.cacheWrite, m.cost && m.cost.cacheWrite],
  ]
  for (const [label, tokens, cost] of items) {
    const row = document.createElement('div')
    row.className = 'mdrow'
    const name = document.createElement('span')
    name.textContent = label
    const val = document.createElement('span')
    const usd = fmtUsd(cost)
    val.textContent = usd ? `${fmtTokens(tokens)} · ${usd}` : fmtTokens(tokens)
    row.append(name, val)
    rows.appendChild(row)
  }
  const total = document.createElement('div')
  total.className = 'mdrow mdrow-total'
  const totalName = document.createElement('span')
  totalName.textContent = 'Total · 7 dias'
  const totalVal = document.createElement('span')
  const totalUsd = fmtUsd(m.costUsd)
  totalVal.textContent = totalUsd ? `${fmtTokens(m.tokens)} · ${totalUsd}` : fmtTokens(m.tokens)
  total.append(totalName, totalVal)
  rows.appendChild(total)
}
function openModelDetail(m) {
  document.body.classList.remove('collapsed', 'settings-open', 'chart-open', 'skins-open')
  document.body.classList.add('model-detail-open')
  renderModelDetail(m)
  fitSize()
}
function closeModelDetail() {
  document.body.classList.remove('model-detail-open')
  fitSize()
}
el('model-detail-close').addEventListener('click', closeModelDetail)

// gráfico de linha do uso diário (30 dias) — SVG desenhado na mão, sem
// biblioteca (o projeto não tem dependência de runtime nenhuma, ver README)
function renderChart(days) {
  const svg = el('chart-svg')
  if (!svg) return
  clearChildren(svg)
  hideTip()
  if (!days.length) return
  const W = 240
  const H = 100
  const PAD = 4
  const max = Math.max(1, ...days)
  const stepX = days.length > 1 ? (W - PAD * 2) / (days.length - 1) : 0
  const points = days.map((v, i) => [PAD + i * stepX, H - PAD - (v / max) * (H - PAD * 2)])

  const area = document.createElementNS(SVGNS, 'path')
  const areaD =
    `M${PAD},${H - PAD} ` +
    points.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
    ` L${W - PAD},${H - PAD} Z`
  area.setAttribute('d', areaD)
  area.setAttribute('class', 'chart-area')
  svg.appendChild(area)

  const line = document.createElementNS(SVGNS, 'path')
  line.setAttribute('d', `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`)
  line.setAttribute('class', 'chart-line')
  svg.appendChild(line)

  points.forEach(([x, y], i) => {
    const dot = document.createElementNS(SVGNS, 'circle')
    dot.setAttribute('cx', x.toFixed(1))
    dot.setAttribute('cy', y.toFixed(1))
    dot.setAttribute('class', 'chart-dot')
    const daysAgo = days.length - 1 - i
    const label = `${daysAgo === 0 ? 'hoje' : `${daysAgo}d atrás`} · ${fmtTokens(days[i])} tokens`
    dot.addEventListener('mouseenter', () => showTip(dot, label))
    dot.addEventListener('mouseleave', hideTip)
    svg.appendChild(dot)
  })
}

// one-shot reaction (adds a class, removes after ms)
function oneShot(cls, ms) {
  document.body.classList.add(cls)
  setTimeout(() => document.body.classList.remove(cls), ms)
}

// session-reset celebration: jump + a colorful confetti burst
const CONFETTI_COLORS = ['#ffd23f', '#ff5d86', '#7ec77d', '#6db3f2', '#e0805a', '#c89bff']
function spawnConfetti(i) {
  const zone = el('dropzone')
  const p = document.createElement('div')
  p.className = 'confetti'
  p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
  const w = 4 + Math.random() * 4
  p.style.width = `${w.toFixed(1)}px`
  p.style.height = `${(w + 2 + Math.random() * 4).toFixed(1)}px`
  p.style.left = '43px'
  p.style.top = '38px'
  zone.appendChild(p)
  // launch up + outward, then fall back down with a tumble
  const ang = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.15
  const speed = 34 + Math.random() * 36
  const ux = Math.cos(ang) * speed
  const uy = Math.sin(ang) * speed // negative = upward
  const fallY = 50 + Math.random() * 40
  const rot = (Math.random() * 2 - 1) * 600
  const a = p.animate(
    [
      { transform: 'translate(0,0) rotate(0) scale(0.5)', opacity: 1 },
      {
        transform: `translate(${ux.toFixed(0)}px, ${uy.toFixed(0)}px) rotate(${(rot * 0.4).toFixed(0)}deg) scale(1)`,
        opacity: 1,
        offset: 0.4,
      },
      {
        transform: `translate(${(ux * 1.4).toFixed(0)}px, ${fallY.toFixed(0)}px) rotate(${rot.toFixed(0)}deg) scale(0.9)`,
        opacity: 0,
      },
    ],
    { duration: 1150 + Math.random() * 550, easing: 'cubic-bezier(0.25, 0.7, 0.4, 1)' },
  )
  a.onfinish = () => p.remove()
}
function celebrate() {
  oneShot('celebrate', 1300)
  for (let i = 0; i < 24; i++) spawnConfetti(i)
}

// main render
let prevState = null
let prevPct = null
let lastData = null
function render(d) {
  lastData = d
  // % comes only from the connected account — no estimates
  const liveOn = !!realUsage
  document.body.classList.toggle('live', liveOn)
  const sessPct = liveOn ? realUsage.session.pct : 0
  const sessReset = liveOn ? realUsage.session.resetMs : null
  const sessActive = liveOn && sessReset != null
  const wkPct = liveOn ? realUsage.week.pct : 0
  const wkReset = liveOn ? realUsage.week.resetMs : null

  const fireAt = currentConfig.fireThreshold ?? 90
  let st =
    liveOn && sessPct >= 100
      ? 'tired'
      : d.active
        ? 'working'
        : liveOn && sessPct >= fireAt
          ? 'stressed'
          : d.sleeping
            ? 'sleeping'
            : 'idle'
  const acts = ['editing', 'reading', 'planning', 'running', 'researching', 'delegating', 'waiting']
  let curActivity = d.activity
  // dev override from `./pet <state>` (base states or an activity name)
  if (debugState) {
    const map = {
      working: 'working',
      sleeping: 'sleeping',
      fire: 'stressed',
      tired: 'tired',
      idle: 'idle',
    }
    if (map[debugState]) {
      st = map[debugState]
      curActivity = null
    } else if (acts.includes(debugState)) {
      st = 'working'
      curActivity = debugState
    }
  }
  setState(st)
  // expose the current activity as a body class so per-action animations can
  // hook it (e.g. body.act-reading). Only while actively working.
  for (const a of acts) {
    document.body.classList.toggle(`act-${a}`, st === 'working' && curActivity === a)
  }
  if (prevState && prevState !== st) {
    if (st === 'sleeping') oneShot('drowse', 700)
    else if (prevState === 'sleeping') oneShot('wake', 700)
  }
  prevState = st

  const actLabels = {
    editing: 'editando', reading: 'lendo', planning: 'planejando',
    running: 'executando', researching: 'pesquisando',
    delegating: 'delegando', waiting: 'aguardando'
  }
  const word =
    st === 'working'
      ? (curActivity ? (actLabels[curActivity] || curActivity) : 'trabalhando')
      : st === 'sleeping'
        ? 'dormindo'
        : st === 'stressed'
          ? 'pegando fogo'
          : st === 'tired'
            ? 'no limite'
            : 'ocioso'
  el('status-text').textContent = word
  el('mini-text').textContent = word
  el('rate').textContent =
    d.active && d.tokensPerMin > 0
      ? `${fmtTokens(d.tokensPerMin)} tok/min`
      : `${fmtTokens(d.today.tokens)} tokens hoje`

  if (liveOn && prevPct != null && sessActive && prevPct - sessPct > 25) celebrate()
  prevPct = sessPct
  el('session-pct').textContent = `${Math.round(sessPct)}%`
  const mini = el('mini-pct')
  mini.textContent = liveOn ? `${Math.round(sessPct)}%` : '—'
  mini.classList.toggle('high', liveOn && sessPct >= 80)
  const sf = el('session-fill')
  sf.style.width = `${sessPct}%`
  sf.classList.toggle('high', sessPct >= 80)
  el('session-sub').textContent = sessActive
    ? `reset em ${fmtReset(sessReset)} · ${fmtTokens(d.session.tokens)} tokens`
    : 'sem sessão ativa'

  el('week-pct').textContent = `${Math.round(wkPct)}%`
  const wf = el('week-fill')
  wf.style.width = `${wkPct}%`
  wf.classList.toggle('high', wkPct >= 80)
  el('week-sub').textContent =
    wkReset != null
      ? `reset em ${fmtReset(wkReset)} · ${fmtTokens(d.week.tokens)} tokens`
      : `${fmtTokens(d.week.tokens)} tokens · últimos 7 dias`

  renderModels(d.byModel || [])
  renderHeat(d.days30 || [])
  renderChart(d.days30 || [])
  el('month-total').textContent = `${fmtTokens(d.monthTokens)} tokens`

  currentRate = d.tokensPerMin || 0
  if (st === 'working') {
    if (!eating) {
      eating = true
      startEating()
    }
  } else if (eating) {
    eating = false
    stopEating()
  }

  fitSize()
}

// fit the window to the content (no leftover border)
let lastH = 0
let lastW = 0
function fitSize() {
  requestAnimationFrame(() => {
    const collapsed = document.body.classList.contains('collapsed')
    const skinsOpen = document.body.classList.contains('skins-open')
    const w = collapsed ? 140 : skinsOpen ? 320 : 276
    const h = el('card').offsetHeight + 24 // 12px margin top + bottom
    if (Math.abs(h - lastH) > 2 || w !== lastW) {
      lastH = h
      lastW = w
      window.api.resize(w, h)
    }
  })
}

let currentConfig = {}
let realUsage = null
let debugState = null
window.api.onDebugState((o) => {
  const s = o?.state
  if (s === 'poke') return pokePet()
  if (s === 'celebrate') return celebrate()
  debugState = s === 'auto' || s === 'clear' || !s ? null : s
  if (lastData) render(lastData)
})
window.api.onUsage(render)
window.api.onError((msg) => {
  el('status-text').textContent = 'error'
  console.error(msg)
})
// texto do checkbox de autostart depende do SO (main.js manda `cfg.platform`,
// que nunca é persistido — só serve para a UI escolher o texto certo)
function applyAutostartLabel(platformName) {
  const label = el('set-autostart-label')
  if (!label) return
  label.textContent =
    platformName === 'linux' ? 'Iniciar automaticamente ao entrar na sessão' : 'Iniciar com o Windows'
}
// badge fixo no topo do stage — só aparece quando o bichinho tem nome
function applyPetNameBadge(name) {
  const badge = el('pet-name-badge')
  if (!badge) return
  badge.textContent = (name || '').trim()
}
window.api.onConfig((cfg) => {
  currentConfig = cfg || {}
  applyAutostartLabel(currentConfig.platform)
  applySkin(currentConfig.skin || 'default')
  applyPetNameBadge(currentConfig.petName)
})
window.api.onRealUsage((u) => {
  realUsage = u || null
  if (lastData) render(lastData)
})
window.api.onAuthState((s) => {
  const on = !!s?.connected
  document.body.classList.toggle('auth-on', on)
  if (!on) {
    realUsage = null
    document.body.classList.remove('live')
    el('acc-paste').classList.remove('show')
    showProfile(null)
  }
  if (document.body.classList.contains('settings-open')) fitSize()
})

// logged-in account chip (email + plan) shown top-left when connected
function showProfile(p) {
  const chip = el('account-chip')
  const mini = el('mini-acct')
  if (!p?.email) {
    chip.hidden = true
    mini.hidden = true
    return
  }
  // expanded: full email chip in the top bar
  el('ac-email').textContent = p.email
  chip.title = p.name ? `${p.name} · ${p.email}` : p.email
  setPlan(el('ac-plan'), p.plan)
  chip.hidden = false
  // collapsed: short name + plan in the mini block (email won't fit at 116px)
  el('mini-acct-name').textContent = p.name || p.email.split('@')[0]
  setPlan(el('mini-acct-plan'), p.plan)
  mini.hidden = false
}
function setPlan(node, plan) {
  if (plan) {
    node.textContent = plan
    node.hidden = false
  } else {
    node.hidden = true
  }
}
window.api.onProfile(showProfile)
window.api.onAuthResult((r) => {
  if (r?.ok) {
    el('acc-msg').textContent = ''
    el('acc-code').value = ''
    el('acc-paste').classList.remove('show')
  } else {
    const e = r?.error || ''
    el('acc-msg').textContent = /429|rate_limit/i.test(e)
      ? 'Rate limited by Anthropic — wait a few minutes, then try once with a fresh code.'
      : `Failed: ${e || 'check the code and try again'}`
  }
  fitSize()
})

el('close').addEventListener('click', () => window.api.quit())
el('usage').addEventListener('click', () => window.api.openUsage())

// account login (browser flow)
el('acc-connect').addEventListener('click', () => {
  window.api.authStart() // opens the browser to log in
  el('acc-paste').classList.add('show') // reveal the code field
  fitSize()
})
el('acc-confirm').addEventListener('click', () => {
  const code = el('acc-code').value.trim()
  if (!code) return
  el('acc-msg').textContent = 'Checking…'
  window.api.authCode(code)
  const b = el('acc-confirm')
  b.disabled = true
  setTimeout(() => (b.disabled = false), 5000) // avoid hammering the rate-limited endpoint
})
el('acc-logout').addEventListener('click', () => window.api.authLogout())

// settings panel
// snapshot of the editable fields, to tell whether there are unsaved changes
let settingsBaseline = null
function snapshotSettings() {
  return JSON.stringify({
    autostart: el('set-autostart').checked,
    alerts: el('set-alerts').checked,
    t1: el('set-t1').value,
    t2: el('set-t2').value,
    fire: el('set-fire').value,
    petname: el('set-petname').value,
  })
}
function refreshSaveDirty() {
  if (settingsBaseline == null) return
  el('set-save').classList.toggle('dirty', snapshotSettings() !== settingsBaseline)
}
function clearSaveDirty() {
  settingsBaseline = snapshotSettings()
  el('set-save').classList.remove('dirty')
}
// `source` deixa reaproveitar isso tanto pra popular do config salvo
// (openSettings) quanto do config padrão (botão "Restaurar padrões").
function populateSettings(source) {
  const c = source || currentConfig || {}
  el('set-autostart').checked = c.startAtLogin !== false
  el('set-alerts').checked = c.alerts !== false
  const th = c.alertThresholds || [80, 95]
  el('set-t1').value = th[0] != null ? th[0] : 80
  el('set-t2').value = th[1] != null ? th[1] : 95
  el('set-fire').value = c.fireThreshold != null ? c.fireThreshold : 90
  el('set-petname').value = c.petName || ''
}
function openSettings() {
  document.body.classList.remove('collapsed', 'chart-open', 'model-detail-open', 'skins-open')
  populateSettings(currentConfig)
  clearSaveDirty() // fields now match the saved config
  document.body.classList.add('settings-open')
  fitSize()
}
el('gear').addEventListener('click', openSettings)
// menu "Configurações" da bandeja pede pra abrir direto nas configurações
window.api.onOpenSettings(openSettings)

// gráfico de uso diário — abre clicando no mapa de calor
function openChart() {
  document.body.classList.remove('collapsed', 'settings-open', 'model-detail-open', 'skins-open')
  document.body.classList.add('chart-open')
  renderChart(lastData?.days30 || [])
  fitSize()
}
function closeChart() {
  document.body.classList.remove('chart-open')
  hideTip()
  fitSize()
}
el('heat').addEventListener('click', openChart)
el('chart-close').addEventListener('click', closeChart)

// galeria de skins — clicar num item já aplica no bichinho ao vivo (é o
// mesmo #stage por trás do painel); Salvar persiste, Cancelar reverte pra
// skin salva sem precisar recarregar nada.
let pendingSkin = null
function renderSkinsList() {
  const box = el('skins-list')
  clearChildren(box)
  const options = [{ key: 'default', label: 'Padrão' }, ...Object.entries(SKINS)
    .filter(([key]) => key !== 'default')
    .map(([key, s]) => ({ key, label: s.label }))]
  for (const opt of options) {
    const btn = document.createElement('button')
    btn.className = `skin-option${opt.key === pendingSkin ? ' selected' : ''}`
    btn.type = 'button'

    const swatch = document.createElement('span')
    swatch.className = 'skin-swatch'
    const s = SKINS[opt.key]
    const shirt = document.createElement('i')
    shirt.style.background = s ? s.shirtColor : 'var(--pixel)'
    const shorts = document.createElement('i')
    shorts.style.background = s ? s.shortsColor : 'var(--pixel)'
    swatch.append(shirt, shorts)

    const name = document.createElement('span')
    name.className = 'skin-option-name'
    name.textContent = opt.label

    const check = document.createElement('span')
    check.className = 'skin-option-check'
    check.textContent = '✓'

    btn.append(swatch, name, check)
    btn.addEventListener('click', () => {
      pendingSkin = opt.key
      applySkin(pendingSkin) // pré-visualização ao vivo no bichinho de verdade
      renderSkinsList() // reaplica a marcação "selected"
    })
    box.appendChild(btn)
  }
}
function openSkins() {
  document.body.classList.remove('collapsed', 'settings-open', 'chart-open', 'model-detail-open')
  document.body.classList.add('skins-open')
  pendingSkin = currentConfig.skin || 'default'
  renderSkinsList()
  fitSize()
}
function closeSkins() {
  document.body.classList.remove('skins-open')
  applySkin(currentConfig.skin || 'default') // desfaz qualquer pré-visualização não salva
  fitSize()
}
el('skins-btn').addEventListener('click', openSkins)
el('skins-cancel').addEventListener('click', closeSkins)
el('skins-save').addEventListener('click', () => {
  window.api.saveConfig({ skin: pendingSkin || 'default' })
  document.body.classList.remove('skins-open')
  fitSize()
})
// só preenche os campos com o padrão — não salva sozinho, o Salvar acende
// (fica "sujo") igual a qualquer outra edição, precisa confirmar
el('set-reset-defaults').addEventListener('click', () => {
  populateSettings(currentConfig.defaults)
  refreshSaveDirty()
  window.api.resetPosition() // reposiciona já — posição nunca foi algo "salvo"
})
// the "connect" placeholder jumps straight to settings
el('limits-connect').addEventListener('click', openSettings)
// custom number steppers (▲ / ▼)
for (const b of document.querySelectorAll('.num-btn')) {
  b.addEventListener('click', () => {
    const input = el(b.dataset.for)
    const min = Number(input.min) || 1
    const max = Number(input.max) || 100
    const next = (Number.parseInt(input.value, 10) || 0) + Number(b.dataset.step)
    input.value = Math.min(max, Math.max(min, next))
    refreshSaveDirty() // steppers change the value without an 'input' event
  })
}
// light up Save whenever an editable field changes
for (const id of ['set-autostart', 'set-alerts', 'set-t1', 'set-t2', 'set-fire', 'set-petname']) {
  el(id).addEventListener('input', refreshSaveDirty)
  el(id).addEventListener('change', refreshSaveDirty)
}
el('set-cancel').addEventListener('click', () => {
  document.body.classList.remove('settings-open')
  clearSaveDirty()
  fitSize()
})
el('set-save').addEventListener('click', () => {
  const num = (id) => parseFloat(el(id).value)
  const fire = num('set-fire')
  window.api.saveConfig({
    startAtLogin: el('set-autostart').checked,
    alerts: el('set-alerts').checked,
    alertThresholds: [num('set-t1'), num('set-t2')]
      .filter((n) => n >= 1 && n <= 100)
      .sort((a, b) => a - b),
    fireThreshold: fire >= 1 && fire <= 99 ? fire : 90,
    petName: el('set-petname').value.trim().slice(0, 24),
  })
  clearSaveDirty()
  document.body.classList.remove('settings-open')
  fitSize()
})
el('min').addEventListener('click', () => {
  document.body.classList.toggle('collapsed')
  fitSize()
})
// double-click the pet to collapse / expand
el('pet').addEventListener('dblclick', () => {
  document.body.classList.toggle('collapsed')
  fitSize()
})

// poke the pet -> bouncy squish + hearts
el('pet').addEventListener('click', () => pokePet())

// eyes follow the cursor
const eyesG = el('eyes')
window.addEventListener('mousemove', (e) => {
  const b = document.body.classList
  if (b.contains('state-sleeping') || b.contains('state-tired')) return
  const r = el('pet').getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  const len = Math.hypot(dx, dy) || 1
  eyesG.setAttribute(
    'transform',
    `translate(${((dx / len) * 3).toFixed(2)} ${((dy / len) * 2).toFixed(2)})`,
  )
})
window.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) eyesG.setAttribute('transform', 'translate(0 0)')
})

// welcome wave
document.body.classList.add('greet')
setTimeout(() => document.body.classList.remove('greet'), 1200)
