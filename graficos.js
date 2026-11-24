'use strict';
// Gráficos em SVG/HTML puro (sem bibliotecas): colunas agrupadas, linha e ranking horizontal.

// Escala "redonda" para o eixo: devolve { min, max, passo }.
function escala(minV, maxV, divisoes = 4) {
  if (maxV === minV) maxV = minV + 1;
  const bruto = (maxV - minV) / divisoes;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * pot).find(p => p >= bruto);
  return { min: Math.floor(minV / passo) * passo, max: Math.ceil(maxV / passo) * passo, passo };
}

// Quantos rótulos pular para não encavalar (cada rótulo "nov/26" precisa de ~44px).
const pularRotulo = largura => (largura >= 44 ? 1 : largura >= 22 ? 2 : 3);

// Colunas agrupadas. series: [{ chave, rotulo, cor }]. dados: [{ mes, ...valores }]
function graficoColunas(el, dados, { series, selecionado, aoClicar, altura = 230, dica }) {
  const W = Math.max(320, el.clientWidth || 520);
  const H = altura;
  const m = { t: 8, r: 4, b: 26, l: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(10000, ...dados.flatMap(d => series.map(s => d[s.chave] || 0))); // mínimo R$ 100 no eixo
  const { max: topo, passo } = escala(0, maxV);
  const y = v => m.t + ih - (v / topo) * ih;
  const grupo = iw / dados.length;
  const bw = Math.max(3, Math.min(18, (grupo - 10) / series.length - 2));

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">`;
  for (let v = 0; v <= topo + 1; v += passo) {
    svg += `<line class="grade-linha" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${dinheiroCurto(v)}</text>`;
  }
  const barra = (x, v, cor) => {
    if (!v || v < 0) return '';
    const h = Math.max(1, (v / topo) * ih), yb = m.t + ih, r = Math.min(4, bw / 2, h);
    // Cantos arredondados só no topo; a base fica reta, apoiada no eixo.
    return `<path fill="${cor}" pointer-events="none" d="M${x},${yb} V${yb - h + r} Q${x},${yb - h} ${x + r},${yb - h} H${x + bw - r} Q${x + bw},${yb - h} ${x + bw},${yb - h + r} V${yb} Z"/>`;
  };
  const larguraGrupo = series.length * bw + (series.length - 1) * 2;
  dados.forEach((d, i) => {
    const gx = m.l + i * grupo;
    const cx = gx + grupo / 2;
    svg += `<rect class="alvo ${d.mes === selecionado ? 'sel' : ''}" data-i="${i}" x="${gx + 1}" y="${m.t}" width="${grupo - 2}" height="${ih}" rx="4"/>`;
    series.forEach((s, j) => { svg += barra(cx - larguraGrupo / 2 + j * (bw + 2), d[s.chave], s.cor); });
    if (i % pularRotulo(grupo) === 0 || d.mes === selecionado) svg += `<text class="eixo-x ${d.mes === selecionado ? 'atual' : ''}" x="${cx}" y="${H - 8}" text-anchor="middle">${mesCurto(d.mes)}</text>`;
  });
  svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/></svg>`;
  el.innerHTML = svg;
  el.classList.add('grafico');

  el.querySelectorAll('.alvo').forEach(a => {
    const d = dados[a.dataset.i];
    comDica(a, () => `<b>${esc(nomeMes(d.mes))}</b>` + series.map(s =>
      `<div class="linha"><span><i style="background:${s.cor}"></i>${esc(s.rotulo)}</span><span>${dinheiro(d[s.chave])}</span></div>`).join('')
      + (dica ? dica(d) : ''));
    if (aoClicar) { a.style.cursor = 'pointer'; a.onclick = () => { esconderDica(); aoClicar(d); }; } else a.style.cursor = 'default';
  });
}

// Linha com área suave; dica com linha-guia ao passar o mouse.
function graficoLinha(el, dados, { chave, rotulo, cor, altura = 200, rotuloX = d => mesCurto(d.mes), titulo = d => nomeMes(d.mes), marcar = -1 }) {
  const W = Math.max(320, el.clientWidth || 520);
  const H = altura;
  const m = { t: 10, r: 10, b: 26, l: 66 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = dados.map(d => d[chave]);
  const { min, max, passo } = escala(Math.min(0, ...vals), Math.max(10000, ...vals));
  const y = v => m.t + ih - ((v - min) / (max - min)) * ih;
  const x = i => m.l + (dados.length === 1 ? iw / 2 : (i / (dados.length - 1)) * iw);

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">`;
  for (let v = min; v <= max + 1; v += passo) {
    svg += `<line class="${v === 0 ? 'base' : 'grade-linha'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${dinheiroCurto(v)}</text>`;
  }
  const pts = dados.map((d, i) => `${x(i)},${y(d[chave])}`);
  svg += `<path d="M${pts.join(' L')} L${x(dados.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z" fill="${cor}" opacity=".12"/>`;
  svg += `<path d="M${pts.join(' L')}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>`;
  const passoRotulo = Math.max(1, Math.ceil(44 / (iw / Math.max(1, dados.length - 1))));
  dados.forEach((d, i) => {
    if ((dados.length - 1 - i) % passoRotulo === 0) svg += `<text class="eixo-x" x="${x(i)}" y="${H - 8}" text-anchor="middle">${rotuloX(d)}</text>`;
  });
  if (marcar >= 0) svg += `<circle cx="${x(marcar)}" cy="${y(dados[marcar][chave])}" r="5" fill="var(--ruim)" stroke="var(--superficie)" stroke-width="2"/>`;
  svg += `<line class="guia" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<circle class="ponto" r="5" fill="${cor}" visibility="hidden"/>`;
  svg += `<rect class="captura" x="${m.l - 10}" y="${m.t}" width="${iw + 20}" height="${ih}" fill="transparent"/></svg>`;
  el.innerHTML = svg;
  el.classList.add('grafico');

  const svgEl = el.querySelector('svg'), guia = el.querySelector('.guia'), ponto = el.querySelector('.ponto');
  const cap = el.querySelector('.captura');
  cap.onmousemove = ev => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(dados.length - 1, Math.round(((px - m.l) / iw) * (dados.length - 1))));
    const d = dados[i];
    guia.setAttribute('x1', x(i)); guia.setAttribute('x2', x(i)); guia.setAttribute('visibility', 'visible');
    ponto.setAttribute('cx', x(i)); ponto.setAttribute('cy', y(d[chave])); ponto.setAttribute('visibility', 'visible');
    mostrarDica(`<b>${esc(titulo(d))}</b><div class="linha"><span><i style="background:${cor}"></i>${esc(rotulo)}</span><span>${dinheiro(d[chave])}</span></div>`, ev);
  };
  cap.onmouseleave = () => { esconderDica(); guia.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden'); };
}

// Barras horizontais ordenadas (onde mais gasto). dados: [{ id, categoria, total, qtd }]
function graficoRanking(el, dados, total, { aoClicar, cor = 'var(--despesa)' } = {}) {
  if (!dados.length) {
    el.innerHTML = '<div class="vazio">Nenhum gasto neste período ainda.<br>Use "+ Novo gasto" para começar.</div>';
    return;
  }
  const max = dados[0].total;
  el.className = 'ranking';
  el.innerHTML = dados.map((d, i) => `
    <button class="ranking-linha" data-i="${i}">
      <span class="ranking-nome">${esc(d.categoria)}</span>
      <span class="ranking-trilho"><div class="ranking-barra" style="width:${(d.total / max) * 100}%;background:${cor}"></div></span>
      <span class="num">${dinheiro(d.total)}</span>
      <span class="ranking-pct">${pct(d.total, total)}%</span>
    </button>`).join('');
  el.querySelectorAll('.ranking-linha').forEach(b => {
    const d = dados[b.dataset.i];
    comDica(b, `<b>${esc(d.categoria)}</b>
      <div class="linha"><span>Total</span><span>${dinheiro(d.total)}</span></div>
      <div class="linha"><span>Do total gasto</span><span>${((d.total / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></div>
      <div class="linha"><span>Lançamentos</span><span>${d.qtd}</span></div>
      ${aoClicar ? '<div style="margin-top:6px;color:var(--texto-3)">Clique para ver os lançamentos</div>' : ''}`);
    b.onclick = () => { esconderDica(); if (aoClicar) aoClicar(d); };
  });
}

// Barra de progresso com estado (bom / alerta / ruim) e rótulo de texto (não só cor).
function barraProgresso(valor, teto, { invertido } = {}) {
  const p = teto ? valor / teto : 0;
  let classe = 'bom';
  if (!invertido) classe = p > 1 ? 'ruim' : p >= 0.8 ? 'alerta' : 'bom';
  return `<div class="barra-progresso ${classe}"><div style="width:${Math.min(100, p * 100)}%"></div></div>`;
}
