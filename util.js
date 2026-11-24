'use strict';
// Utilidades compartilhadas pelas telas: formatação, datas, avisos, modal de formulário e dicas.

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = centavos => fmtReal.format((centavos || 0) / 100);
const dinheiroCurto = centavos => {
  const v = (centavos || 0) / 100;
  if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
const centavosParaTexto = c => ((c || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = d => (d ? d.split('-').reverse().join('/') : '');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Aceita "1.234,56", "1234,56", "1234.56", "1234" e negativos. Devolve centavos ou NaN.
function lerDinheiro(txt) {
  let s = String(txt || '').replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const pad2 = n => String(n).padStart(2, '0');
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const mesDeHoje = () => hojeISO().slice(0, 7);
function somarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function fimDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${pad2(new Date(a, m, 0).getDate())}`;
}
const nomeMes = mes => { const [a, m] = mes.split('-'); return `${NOMES_MES[m - 1]} ${a}`; };
const mesCurto = mes => { const [a, m] = mes.split('-'); return `${NOMES_MES[m - 1].slice(0, 3)}/${a.slice(2)}`; };

const TIPOS_CONTA = { corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Carteira / dinheiro', investimento: 'Investimento' };
const PERIODOS = { 1: 'Todo mês', 2: 'A cada 2 meses', 3: 'A cada 3 meses', 6: 'A cada 6 meses', 12: 'Uma vez por ano' };
const STATUS_FATURA = {
  aberta: ['Aberta', ''], fechada: ['Fechada', 'alerta'], parcial: ['Paga em parte', 'alerta'], paga: ['Paga', 'bom'], vencida: ['Vencida', 'ruim'],
};
const ICONE_NIVEL = { critico: '⛔', aviso: '⚠', info: 'ℹ' };

let timerAviso;
function avisar(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, 2800);
}

async function tentar(fn) {
  try { return await fn(); } catch (e) { alert(e.message); return undefined; }
}

// ---------- Dica flutuante (tooltip) ----------
function mostrarDica(html, ev) {
  const dica = $('#dica');
  dica.innerHTML = html;
  dica.hidden = false;
  moverDica(ev);
}
function moverDica(ev) {
  const dica = $('#dica');
  const r = dica.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  dica.style.left = x + 'px';
  dica.style.top = y + 'px';
}
const esconderDica = () => { $('#dica').hidden = true; };
function comDica(el, html) {
  el.onmouseenter = ev => mostrarDica(typeof html === 'function' ? html() : html, ev);
  el.onmousemove = moverDica;
  el.onmouseleave = esconderDica;
}

// ---------- Modal de formulário ----------
// campos: [{ nome, rotulo, tipo, valor, opcoes, grupos, linha, placeholder, ajuda, oculto }]
//   tipo: texto | dinheiro | dinheiroSinal | data | mes | numero | select | check | info
//   opcoes: [{ valor, texto }]  ou  grupos: [{ rotulo, opcoes }]
// depois(form, campo): chamado após montar, para ligar comportamentos (campo(nome) devolve o elemento).
function abrirFormulario({ titulo, campos, botao = 'Salvar', salvar, depois, largo }) {
  const modal = $('#modal');
  modal.classList.toggle('largo', !!largo);
  $('#modalTitulo').textContent = titulo;
  $('#modalOk').textContent = botao;
  $('#modalOk').hidden = !salvar;
  $('#modalCancelar').textContent = salvar ? 'Cancelar' : 'Fechar';
  const erro = $('#modalErro');
  erro.hidden = true;

  const opcoesHtml = (ops, valor) => ops.map(o =>
    `<option value="${esc(o.valor)}" ${String(o.valor) === String(valor) ? 'selected' : ''}>${esc(o.texto)}</option>`).join('');

  const htmlCampo = c => {
    const id = 'f_' + c.nome;
    const ajuda = c.ajuda ? `<small class="campo-ajuda">${c.ajuda}</small>` : '';
    if (c.tipo === 'info') return `<div class="campo-info" id="${id}">${c.valor}</div>`;
    if (c.tipo === 'check') {
      return `<div class="campo-check" data-campo="${c.nome}" ${c.oculto ? 'hidden' : ''}><input type="checkbox" id="${id}" ${c.valor ? 'checked' : ''}><label for="${id}">${esc(c.rotulo)}</label></div>`;
    }
    let input;
    if (c.tipo === 'select') {
      const corpo = c.grupos
        ? c.grupos.filter(g => g.opcoes.length).map(g => `<optgroup label="${esc(g.rotulo)}">${opcoesHtml(g.opcoes, c.valor)}</optgroup>`).join('')
        : opcoesHtml(c.opcoes, c.valor);
      input = `<select id="${id}">${corpo}</select>`;
    } else {
      const tipo = { data: 'date', numero: 'number', mes: 'month' }[c.tipo] || 'text';
      const extra = c.tipo.startsWith('dinheiro') ? 'inputmode="decimal" placeholder="0,00"'
        : c.tipo === 'numero' ? `min="${c.min ?? 1}" max="${c.max ?? 31}"` : '';
      input = `<input type="${tipo}" id="${id}" value="${esc(c.valor ?? '')}" ${extra} ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''} autocomplete="off">`;
    }
    return `<div class="campo" data-campo="${c.nome}" ${c.oculto ? 'hidden' : ''}><label for="${id}">${esc(c.rotulo)}</label>${input}${ajuda}</div>`;
  };

  // Agrupa campos marcados com "linha" dois a dois.
  let html = '';
  for (let i = 0; i < campos.length; i++) {
    const c = campos[i];
    if (c.linha && campos[i + 1]?.linha) {
      html += `<div class="campo-linha">${htmlCampo(c)}${htmlCampo(campos[i + 1])}</div>`;
      i++;
    } else html += htmlCampo(c);
  }
  $('#modalCorpo').innerHTML = html;

  const form = $('#modalForm');
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (!salvar) { modal.close(); return; }
    const dados = {};
    for (const c of campos) {
      if (c.tipo === 'info') continue;
      const el = $('#f_' + c.nome);
      const visivel = !el.closest('[hidden]');
      if (c.tipo === 'check') dados[c.nome] = el.checked;
      else if (c.tipo === 'dinheiro' || c.tipo === 'dinheiroSinal') {
        if (!visivel) continue;
        dados[c.nome] = el.value.trim() === '' && c.opcional ? 0 : lerDinheiro(el.value);
        const ok = c.tipo === 'dinheiroSinal' ? Number.isFinite(dados[c.nome]) : dados[c.nome] > 0 || (c.opcional && dados[c.nome] === 0);
        if (!ok) { erro.textContent = `Valor inválido em "${c.rotulo}".`; erro.hidden = false; el.focus(); return; }
      } else dados[c.nome] = el.value;
    }
    const ok = $('#modalOk');
    ok.disabled = true;
    try {
      await salvar(dados);
      modal.close();
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    } finally {
      ok.disabled = false;
    }
  };
  $('#modalCancelar').onclick = () => modal.close();
  modal.showModal();
  const campo = nome => $('#f_' + nome);
  const mostrar = (nome, sim) => { const el = modal.querySelector(`[data-campo="${nome}"]`); if (el) el.hidden = !sim; };
  if (depois) depois({ campo, mostrar, erro });
  const primeiro = modal.querySelector('#modalCorpo input:not([type=checkbox]):not([type=date]), #modalCorpo select');
  if (primeiro) { primeiro.focus(); if (primeiro.select) primeiro.select(); }
}

// Pergunta com botões. Devolve o valor do botão escolhido, ou null se cancelar.
function escolher({ titulo, mensagem, opcoes }) {
  return new Promise(resolve => {
    const d = $('#escolha');
    $('#escolhaTitulo').textContent = titulo;
    $('#escolhaMsg').textContent = mensagem;
    const box = $('#escolhaBotoes');
    box.innerHTML = '';
    for (const o of [...opcoes, { valor: null, texto: 'Cancelar' }]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'botao ' + (o.valor === null ? 'secundario' : o.perigo ? 'perigo-cheio' : 'primario');
      b.textContent = o.texto;
      b.onclick = () => { d.close(); resolve(o.valor); };
      box.appendChild(b);
    }
    d.oncancel = () => resolve(null);
    d.showModal();
  });
}
