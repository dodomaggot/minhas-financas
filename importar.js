// Leitura de extratos bancários (OFX e CSV) para uma lista de { data, descricao, valor, importacao_id }.
// valor em centavos, negativo = saída (despesa), positivo = entrada (receita).

// O mesmo arquivo roda no Node/Electron (module.exports) e no navegador (window.FinancasImportar).
(function () {
const ehNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';

// Bancos brasileiros costumam gerar OFX/CSV em Latin-1; se o UTF-8 vier com caractere inválido, relê.
function decodificar(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const utf8 = new TextDecoder('utf-8').decode(u8);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(u8) : utf8.replace(/^﻿/, '');
}

function centavos(txt) {
  let s = String(txt || '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (/[dD]$/.test(s)) { negativo = true; s = s.slice(0, -1); } // "123,45 D"
  if (/[cC]$/.test(s)) s = s.slice(0, -1);
  // Decide qual é o separador decimal: o último entre ponto e vírgula.
  const ultVirg = s.lastIndexOf(','), ultPonto = s.lastIndexOf('.');
  if (ultVirg > ultPonto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negativo ? -Math.abs(n) : n) * 100);
}

function data(txt) {
  const s = String(txt || '').trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function lerOfx(conteudo) {
  const itens = [];
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  const campo = (b, nome) => {
    const m = b.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };
  for (const b of blocos) {
    const valor = centavos(campo(b, 'TRNAMT').replace(',', '.'));
    const d = data(campo(b, 'DTPOSTED'));
    if (!d || !Number.isFinite(valor) || valor === 0) continue;
    const memo = campo(b, 'MEMO'), nome = campo(b, 'NAME');
    const descricao = (memo && nome && !memo.includes(nome) ? `${nome} - ${memo}` : memo || nome || 'Sem descrição')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const fitid = campo(b, 'FITID');
    itens.push({ data: d, descricao, valor, importacao_id: fitid ? `ofx:${fitid}:${d}:${valor}` : null });
  }
  return itens;
}

// Divide uma linha CSV respeitando aspas.
function dividir(linha, sep) {
  const r = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (ch === sep && !aspas) { r.push(atual.trim()); atual = ''; } else atual += ch;
  }
  r.push(atual.trim());
  return r;
}

const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// CSV: procura as colunas de data, descrição e valor pelo cabeçalho; sem cabeçalho, usa a 1ª data,
// o texto mais longo e o último número da linha.
function lerCsv(conteudo) {
  const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return [];
  const sep = [';', '\t', ','].map(s => [s, linhas.slice(0, 5).reduce((n, l) => n + dividir(l, s).length, 0)])
    .sort((a, b) => b[1] - a[1])[0][0];
  const cab = dividir(linhas[0], sep).map(semAcento);
  const achar = re => cab.findIndex(c => re.test(c));
  let iData = achar(/^data|date|dt\b/), iDesc = achar(/descri|historico|lancamento|memo|estabelecimento|title|titulo/),
    iValor = achar(/^valor|amount|quantia|montante/);
  const iCred = achar(/credito|entrada/), iDeb = achar(/debito|saida/);
  const temCab = iData >= 0 && (iValor >= 0 || (iCred >= 0 && iDeb >= 0));
  const itens = [];
  for (const linha of linhas.slice(temCab ? 1 : 0)) {
    const col = dividir(linha, sep);
    let d, desc, v;
    if (temCab) {
      d = data(col[iData]);
      desc = iDesc >= 0 ? col[iDesc] : col.filter((_, i) => i !== iData && i !== iValor).join(' ');
      if (iValor >= 0) v = centavos(col[iValor]);
      else {
        const cred = centavos(col[iCred]), deb = centavos(col[iDeb]);
        v = (Number.isFinite(cred) ? Math.abs(cred) : 0) - (Number.isFinite(deb) ? Math.abs(deb) : 0);
      }
    } else {
      const iD = col.findIndex(c => data(c));
      if (iD < 0) continue;
      d = data(col[iD]);
      const nums = col.map((c, i) => [i, centavos(c)]).filter(([i, n]) => i !== iD && Number.isFinite(n) && /\d/.test(col[i]) && !data(col[i]));
      if (!nums.length) continue;
      v = nums[nums.length - 1][1];
      desc = col.filter((c, i) => i !== iD && !nums.some(([j]) => j === i)).sort((a, b) => b.length - a.length)[0];
    }
    if (!d || !Number.isFinite(v) || v === 0) continue;
    if (/saldo/i.test(desc || '')) continue; // linhas de "saldo do dia" não são movimentações
    itens.push({ data: d, descricao: String(desc || 'Sem descrição').replace(/\s+/g, ' ').trim(), valor: v, importacao_id: null });
  }
  return itens;
}

// "Maze - Parcela 2/10", "LOJA X PARC 02/10", "Loja (3/12)" -> { base, num, total }
function lerParcela(descricao) {
  const m = String(descricao).match(/^(.*?)[\s-]*(?:\bparcela\b|\bparc\.?)\s*(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})\s*$/i)
    || String(descricao).match(/^(.*?)\s*\((\d{1,3})\/(\d{1,3})\)\s*$/);
  if (!m) return null;
  const num = Number(m[2]), total = Number(m[3]);
  if (!(total >= 2 && num >= 1 && num <= total) || !m[1].trim()) return null;
  return { base: m[1].trim(), num, total };
}

// Identificador estável para linhas de CSV (sem código do banco): data + valor + descrição + ordem entre linhas iguais.
// Assim, importar a mesma fatura de novo não duplica, mas duas compras iguais no mesmo dia continuam separadas.
function marcarIds(itens, origem) {
  const vistos = {};
  for (const it of itens) {
    if (it.importacao_id) continue;
    const chave = `${it.data}|${it.valor}|${it.descricao.toLowerCase()}`;
    vistos[chave] = (vistos[chave] || 0) + 1;
    it.importacao_id = `${origem}:${chave}|${vistos[chave]}`;
  }
}

// nomeArquivo é opcional: faturas como "Nubank_2026-12-24.csv" dizem o vencimento no nome.
function lerExtratoBytes(bytes, nomeArquivo = '') {
  const conteudo = decodificar(bytes);
  const ofx = /<OFX>|OFXHEADER/i.test(conteudo);
  const itens = ofx ? lerOfx(conteudo) : lerCsv(conteudo);
  if (!itens.length) throw new Error('Não encontrei movimentações neste arquivo. Use um extrato em OFX ou CSV.');
  if (!ofx) marcarIds(itens, 'csv');
  const venc = String(nomeArquivo).match(/(20\d{2})-(0[1-9]|1[0-2])-\d{2}/);
  for (const it of itens) {
    const p = lerParcela(it.descricao);
    if (p) { it.parcela_num = p.num; it.parcela_total = p.total; it.base = p.base; }
    if (venc) it.fatura_arquivo = `${venc[1]}-${venc[2]}`;
    it.arquivo = nomeArquivo;
  }
  return itens.sort((a, b) => a.data.localeCompare(b.data));
}

// ---------- Faturas em PDF ----------
const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const p2 = n => String(n).padStart(2, '0');
const iso = (a, m, d) => `${a}-${p2(m)}-${p2(d)}`;
const ultimoDiaMes = (a, m) => new Date(a, m, 0).getDate();
function menosMeses(dataIso, n) {
  const [a, m, d] = dataIso.split('-').map(Number);
  const t = new Date(a, m - 1 - n, 1);
  return iso(t.getFullYear(), t.getMonth() + 1, Math.min(d, ultimoDiaMes(t.getFullYear(), t.getMonth() + 1)));
}
// Data mais recente com esse dia/mês que não passa do limite (resolve o ano que o PDF não mostra).
function ateLimite(dia, mes, limite) {
  let a = Number(limite.slice(0, 4));
  if (iso(a, mes, dia) > limite) a--;
  return iso(a, mes, Math.min(dia, ultimoDiaMes(a, mes)));
}

// Dia da parcela dentro do ciclo que termina no fechamento: mesmo dia do mês do fechamento, ou do mês anterior se passar dele.
function diaNoCiclo(dia, fech) {
  const a = Number(fech.slice(0, 4)), m = Number(fech.slice(5, 7));
  const neste = iso(a, m, Math.min(dia, ultimoDiaMes(a, m)));
  if (neste <= fech) return neste;
  const ant = new Date(a, m - 2, 1);
  return iso(ant.getFullYear(), ant.getMonth() + 1, Math.min(dia, ultimoDiaMes(ant.getFullYear(), ant.getMonth() + 1)));
}

// Texto do PDF em linhas (pdfjs = biblioteca pdf.js já carregada). Junta pedaços na mesma altura da página.
async function extrairLinhasPdf(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const linhas = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const itens = tc.items.filter(i => i.str && i.str.trim())
        .map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      let atual = null;
      for (const it of itens) {
        if (!atual || Math.abs(atual.y - it.y) > 4) { atual = { y: it.y, partes: [] }; linhas.push(atual); }
        atual.partes.push(it);
      }
    }
  } finally {
    doc.destroy();
  }
  const texto = linhas.map(l => l.partes.sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim());
  // Data sozinha numa linha e o resto na seguinte (acontece no PDF do Nubank): junta as duas.
  const r = [];
  for (let i = 0; i < texto.length; i++) {
    if (/^\d{2}(\/\d{2}| [A-Z]{3})$/.test(texto[i]) && texto[i + 1]) { r.push(texto[i] + ' ' + texto[i + 1]); i++; } else r.push(texto[i]);
  }
  return r;
}

const RE_VALOR = /(-|−)?\s?R\$ ?(\d{1,3}(?:\.\d{3})*,\d{2})$/;
const valorPdf = (sinal, numero) => {
  const c = Math.round(Number(numero.replace(/\./g, '').replace(',', '.')) * 100);
  return sinal ? c : -c; // na fatura, valor positivo = compra (saída); com "-" = pagamento/estorno (entrada)
};

// Fatura do cartão Mercado Pago: "17/07 MERCADOPAGO*EASYTECH Parcela 16 de 21 R$ 128,57"
function lerFaturaMercadoPago(linhas) {
  const tudo = linhas.join('\n');
  const v = tudo.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/) || tudo.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!v) throw new Error('Não encontrei a data de vencimento na fatura do Mercado Pago.');
  const venc = iso(v[3], v[2], v[1]);
  const f = tudo.match(/Fechamento da fatura\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const fech = f ? iso(f[3], f[2], f[1]) : menosMeses(venc, 0).slice(0, 8) + p2(Math.max(1, Number(venc.slice(8)) - 8));
  const itens = [];
  let cartao = '';
  const vistos = {};
  for (const l of linhas) {
    const c = l.match(/Cart[aã]o .*\[\**(\d{4})\]/i);
    if (c) { cartao = c[1]; continue; }
    const m = l.match(/^(\d{2})\/(\d{2}) (.+)$/);
    if (!m) continue;
    const val = m[3].match(RE_VALOR);
    if (!val) continue;
    let desc = m[3].slice(0, val.index).trim();
    const dia = Number(m[1]), mes = Number(m[2]);
    const parc = desc.match(/^(.*?)\s+Parcela (\d+) de (\d+)$/i);
    const it = { valor: valorPdf(val[1], val[2]), arquivo: '', fatura_arquivo: venc.slice(0, 7), obs: cartao ? `Cartão final ${cartao}` : '' };
    if (parc && Number(parc[3]) >= 2) {
      const num = Number(parc[2]), total = Number(parc[3]);
      // O PDF traz a data ORIGINAL da compra; a parcela deste mês cai no ciclo desta fatura.
      const dataCompra = ateLimite(dia, mes, menosMeses(fech, num - 1));
      it.data = num === 1 ? dataCompra : diaNoCiclo(dia, fech);
      it.descricao = `${parc[1].trim()} - Parcela ${num}/${total}`;
      it.base = parc[1].trim(); it.parcela_num = num; it.parcela_total = total;
      const chave = `${it.base.toLowerCase()}|${total}|${dataCompra}`;
      vistos[chave] = (vistos[chave] || 0) + 1;
      it.parcela_chave = `${chave}#${vistos[chave]}`;
      it.obs = [it.obs, `compra em ${dataCompra.split('-').reverse().join('/')}`].filter(Boolean).join(' · ');
    } else {
      it.data = ateLimite(dia, mes, fech);
      it.descricao = desc;
    }
    itens.push(it);
  }
  return itens;
}

// Fatura do cartão Nubank em PDF: "17 OUT •••• 7478 Thermas Water Park - Parcela 2/12 R$ 149,80"
function lerFaturaNubankPdf(linhas) {
  const tudo = linhas.join('\n');
  const v = tudo.match(/vencimento:\s*(\d{2}) ([A-Z]{3}) (\d{4})/i) || tudo.match(/FATURA (\d{2}) ([A-Z]{3}) (\d{4})/);
  if (!v || !MESES[v[2].toUpperCase()]) throw new Error('Não encontrei a data de vencimento na fatura do Nubank.');
  const venc = iso(v[3], MESES[v[2].toUpperCase()], v[1]);
  const e = tudo.match(/EMISS[AÃ]O E ENVIO (\d{2}) ([A-Z]{3}) (\d{4})/);
  const fech = e && MESES[e[2]] ? iso(e[3], MESES[e[2]], e[1]) : venc;
  const itens = [];
  for (const l of linhas) {
    const m = l.match(/^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (.+)$/);
    if (!m) continue;
    const val = m[3].match(RE_VALOR);
    if (!val) continue;
    const desc = m[3].slice(0, val.index).replace(/^•+\s?\d{4}\s+/, '').trim();
    if (!desc) continue;
    itens.push({ data: ateLimite(Number(m[1]), MESES[m[2]], fech), descricao: desc, valor: valorPdf(val[1], val[2]), fatura_arquivo: venc.slice(0, 7) });
  }
  return itens;
}

// Lê um PDF de fatura (Mercado Pago ou Nubank). pdfjs = biblioteca pdf.js.
async function lerPdf(pdfjs, bytes, nomeArquivo = '') {
  const linhas = await extrairLinhasPdf(pdfjs, bytes);
  const tudo = linhas.join('\n');
  let itens;
  if (/mercado ?pago/i.test(tudo) && /Movimenta[cç][oõ]es/i.test(tudo)) itens = lerFaturaMercadoPago(linhas);
  else if (/nubank|nu pagamentos/i.test(tudo) && /TRANSA[CÇ][OÕ]ES/i.test(tudo)) itens = lerFaturaNubankPdf(linhas);
  else throw new Error('Este PDF ainda não é reconhecido. Por enquanto: faturas do cartão Mercado Pago e do Nubank. Para outros bancos, use OFX ou CSV.');
  if (!itens.length) throw new Error('Não encontrei compras neste PDF.');
  marcarIds(itens, 'pdf');
  for (const it of itens) {
    it.arquivo = nomeArquivo;
    if (!it.parcela_total) {
      const p = lerParcela(it.descricao);
      if (p) { it.parcela_num = p.num; it.parcela_total = p.total; it.base = p.base; }
    }
  }
  return itens.sort((a, b) => a.data.localeCompare(b.data));
}

const ehPdf = bytes => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"

// Node: lê direto do arquivo.
const lerExtrato = arquivo => lerExtratoBytes(require('fs').readFileSync(arquivo), require('path').basename(arquivo));

const exportado = { lerExtrato, lerExtratoBytes, lerOfx, lerCsv, lerParcela, centavos, data, decodificar,
  lerPdf, ehPdf, extrairLinhasPdf, lerFaturaMercadoPago, lerFaturaNubankPdf };
if (ehNode) module.exports = exportado; else globalThis.FinancasImportar = exportado;
})();
