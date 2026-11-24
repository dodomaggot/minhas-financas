'use strict';
// Estado, navegação e formulários usados por várias telas.

const estado = {
  tela: 'painel',
  mes: mesDeHoje(),
  filtros: novosFiltros(),
  cartaoAberto: null, // cartão cuja fatura está sendo vista
  faturaMes: null,
};

function novosFiltros() {
  return { periodo: 'mes', de: '', ate: '', tipo: '', onde: '', categoria_id: '', tag_id: '', situacao: '', busca: '' };
}

const TELAS = {
  painel: { titulo: 'Painel', usaMes: true },
  lancamentos: { titulo: 'Lançamentos', usaMes: true },
  contas: { titulo: 'Contas', usaMes: true },
  cartoes: { titulo: 'Cartões de crédito', usaMes: false },
  fixos: { titulo: 'Fixos e recorrentes', usaMes: false },
  orcamento: { titulo: 'Orçamento do mês', usaMes: true },
  metas: { titulo: 'Metas', usaMes: false },
  categorias: { titulo: 'Categorias e tags', usaMes: false },
  ferramentas: { titulo: 'Configurações', usaMes: false },
};

function irPara(tela) {
  estado.tela = tela;
  $$('#menu button').forEach(b => b.classList.toggle('ativo', b.dataset.tela === tela));
  esconderDica();
  $('#conteudo').scrollTop = 0;
  renderizar();
}

async function renderizar() {
  const t = TELAS[estado.tela];
  $('#tituloTela').textContent = t.titulo;
  $('#seletorMes').style.visibility = t.usaMes ? 'visible' : 'hidden';
  $('#mesTexto').textContent = nomeMes(estado.mes);
  await tentar(() => window['tela_' + estado.tela]());
  atualizarSino();
}

async function atualizarSino() {
  const r = await api.painel.resumo({ mes: mesDeHoje() }).catch(() => null);
  const n = r ? r.alertas.filter(a => a.nivel !== 'info').length : 0;
  const el = $('#contadorAlertas');
  el.textContent = n;
  el.hidden = !n;
}

// Contas, cartões e categorias usados nos formulários.
async function base() {
  const [contas, cartoes, categorias] = await Promise.all([api.contas.listar(), api.cartoes.listar(), api.categorias.listar()]);
  return { contas, cartoes, categorias };
}

function opcoesOnde({ contas, cartoes }, { comCartao = true } = {}) {
  return [
    { rotulo: 'Contas', opcoes: contas.map(c => ({ valor: 'conta:' + c.id, texto: c.nome })) },
    ...(comCartao ? [{ rotulo: 'Cartões de crédito', opcoes: cartoes.map(c => ({ valor: 'cartao:' + c.id, texto: '💳 ' + c.nome })) }] : []),
  ];
}
function lerOnde(v) {
  const [tipo, id] = String(v || '').split(':');
  return { conta_id: tipo === 'conta' ? Number(id) : null, cartao_id: tipo === 'cartao' ? Number(id) : null };
}
const ondeDe = l => (l.cartao_id ? 'cartao:' + l.cartao_id : l.conta_id ? 'conta:' + l.conta_id : '');

function opcoesCategoria(categorias, tipo) {
  return categorias.filter(c => c.tipo === tipo).map(c => ({ valor: c.id, texto: c.pai_id ? '   ↳ ' + c.nome : c.nome }));
}

// ---------- Receita / despesa ----------
async function formLancamento(tipo, existente, padrao = {}) {
  const b = await base();
  const l = existente || {};
  const despesa = tipo === 'despesa';
  const dataPadrao = estado.mes === mesDeHoje() ? hojeISO() : `${estado.mes}-01`;
  const ondePadrao = existente ? ondeDe(l) : padrao.onde || 'conta:' + b.contas[0]?.id;
  let categoriaMexida = !!existente;
  abrirFormulario({
    titulo: existente ? (despesa ? 'Editar despesa' : 'Editar receita') : (despesa ? 'Novo gasto' : 'Nova receita'),
    campos: [
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', valor: l.descricao, placeholder: despesa ? 'Ex.: Mercado, Uber, Farmácia' : 'Ex.: Freela, venda' },
      { nome: 'valor', rotulo: existente ? 'Valor (R$)' : 'Valor total (R$)', tipo: 'dinheiro', valor: l.valor ? centavosParaTexto(l.valor) : '', linha: true },
      { nome: 'data', rotulo: 'Data', tipo: 'data', valor: l.data || padrao.data || dataPadrao, linha: true },
      { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'select', valor: l.categoria_id, opcoes: opcoesCategoria(b.categorias, tipo), linha: true },
      { nome: 'onde', rotulo: despesa ? 'Pago com' : 'Recebido em', tipo: 'select', valor: ondePadrao, grupos: opcoesOnde(b, { comCartao: despesa || !!l.cartao_id }), linha: true },
      ...(existente ? [] : [
        { nome: 'parcelas', rotulo: 'Parcelas', tipo: 'numero', valor: 1, min: 1, max: 120, linha: true, ajuda: 'Use mais de 1 para compras ou recebimentos parcelados.' },
        { nome: 'parcela_inicial', rotulo: 'Começa na parcela', tipo: 'numero', valor: 1, min: 1, max: 120, linha: true, oculto: true,
          ajuda: 'Compra antiga? Use a data da compra e a parcela atual.' },
      ]),
      { nome: 'tags', rotulo: 'Tags (opcional)', tipo: 'texto', valor: l.tags || '', placeholder: 'Ex.: viagem, família — separadas por vírgula' },
      { nome: 'obs', rotulo: 'Observação (opcional)', tipo: 'texto', valor: l.obs },
      { nome: 'pago', rotulo: despesa ? 'Já está pago' : 'Já recebi', tipo: 'check', valor: existente ? !!l.pago : true },
    ],
    depois: ({ campo, mostrar }) => {
      const onde = campo('onde');
      const atualizar = () => {
        const cartao = onde.value.startsWith('cartao:');
        mostrar('pago', !cartao);
        if (campo('parcelas')) {
          const n = Number(campo('parcelas').value) || 1;
          const v = lerDinheiro(campo('valor').value);
          const ini = Math.min(n, Math.max(1, Number(campo('parcela_inicial').value) || 1));
          mostrar('parcela_inicial', n > 1);
          const ajuda = campo('parcelas').parentElement.querySelector('.campo-ajuda');
          ajuda.textContent = n > 1 && v > 0
            ? `${n}x de ${dinheiro(Math.floor(v / n))}${ini > 1 ? ` — cria da ${ini}ª à ${n}ª (${n - ini + 1} parcelas)` : cartao ? ', uma em cada fatura' : ', uma por mês (as próximas ficam pendentes)'}.`
            : 'Use mais de 1 para compras ou recebimentos parcelados.';
        }
      };
      onde.onchange = atualizar;
      campo('valor').oninput = atualizar;
      if (campo('parcelas')) { campo('parcelas').oninput = atualizar; campo('parcela_inicial').oninput = atualizar; }
      atualizar();
      campo('categoria_id').onchange = () => { categoriaMexida = true; };
      campo('descricao').onblur = async () => {
        if (categoriaMexida || !campo('descricao').value.trim()) return;
        const sug = await api.categorias.sugerir({ descricao: campo('descricao').value, tipo }).catch(() => null);
        if (sug && !categoriaMexida) campo('categoria_id').value = String(sug);
      };
      if (!existente && !padrao.categoria_id) campo('categoria_id').selectedIndex = -1;
      if (padrao.categoria_id) campo('categoria_id').value = String(padrao.categoria_id);
    },
    salvar: async d => {
      if (!d.categoria_id) throw new Error('Escolha uma categoria.');
      await api.lancamentos.salvar({ ...d, ...lerOnde(d.onde), id: l.id, tipo });
      avisar(existente ? 'Alterações salvas.' : Number(d.parcelas) > 1 ? `Parcelado em ${d.parcelas}x.` : despesa ? 'Gasto registrado.' : 'Receita registrada.');
      if (!existente && d.data.slice(0, 7) !== estado.mes && TELAS[estado.tela].usaMes) estado.mes = d.data.slice(0, 7);
      renderizar();
    },
  });
}

// ---------- Transferência entre contas ----------
async function formTransferencia(existente, padrao = {}) {
  const { contas } = await base();
  if (contas.length < 2) { alert('Cadastre pelo menos duas contas para fazer transferências (tela Contas).'); return; }
  const t = existente || {};
  const ops = contas.map(c => ({ valor: c.id, texto: c.nome }));
  abrirFormulario({
    titulo: existente ? 'Editar transferência' : 'Transferir entre contas',
    campos: [
      { nome: 'de', rotulo: 'Sai de', tipo: 'select', opcoes: ops, valor: t.conta_id || padrao.de || contas[0].id, linha: true },
      { nome: 'para', rotulo: 'Entra em', tipo: 'select', opcoes: ops, valor: t.conta_destino_id || padrao.para || contas[1].id, linha: true },
      { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', valor: t.valor ? centavosParaTexto(t.valor) : '', linha: true },
      { nome: 'data', rotulo: 'Data', tipo: 'data', valor: t.data || hojeISO(), linha: true },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', valor: t.descricao || 'Transferência' },
      { nome: 'pago', rotulo: 'Já foi feita', tipo: 'check', valor: existente ? !!t.pago : true },
    ],
    salvar: async d => {
      await api.contas.transferir({ ...d, id: t.id });
      avisar('Transferência registrada.');
      renderizar();
    },
  });
}

// ---------- Salário, contas fixas e assinaturas ----------
async function formRecorrente(tipo, existente) {
  const b = await base();
  const r = existente || {};
  const receita = tipo === 'receita';
  const cats = b.categorias.filter(c => c.tipo === tipo);
  const catPadrao = r.categoria_id || (receita ? cats.find(c => c.nome === 'Salário')?.id : cats.find(c => c.nome === 'Contas e serviços')?.id);
  abrirFormulario({
    titulo: existente ? 'Editar' : (receita ? 'Cadastrar salário / receita fixa' : 'Cadastrar conta fixa ou assinatura'),
    campos: [
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', valor: r.descricao ?? (receita ? 'Salário' : ''), placeholder: receita ? 'Ex.: Salário' : 'Ex.: Aluguel, Luz, Netflix' },
      { nome: 'valor', rotulo: receita ? 'Valor líquido (R$)' : 'Valor (R$)', tipo: 'dinheiro', valor: r.valor ? centavosParaTexto(r.valor) : '', linha: true },
      { nome: 'dia', rotulo: receita ? 'Dia que recebe' : 'Dia do vencimento', tipo: 'numero', valor: r.dia || (receita ? 5 : 10), linha: true },
      { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'select', valor: catPadrao, opcoes: opcoesCategoria(b.categorias, tipo), linha: true },
      { nome: 'onde', rotulo: receita ? 'Recebe em' : 'Paga com', tipo: 'select', valor: existente ? ondeDe(r) : 'conta:' + b.contas[0]?.id, grupos: opcoesOnde(b, { comCartao: !receita }), linha: true },
      { nome: 'periodicidade', rotulo: 'Repete', tipo: 'select', valor: r.periodicidade || 1, opcoes: Object.entries(PERIODOS).map(([v, t]) => ({ valor: v, texto: t })), linha: !existente },
      ...(existente ? [] : [{ nome: 'inicio', rotulo: 'A partir de', tipo: 'mes', valor: estado.mes, linha: true }]),
    ],
    salvar: async d => {
      await api.recorrentes.salvar({ ...d, ...lerOnde(d.onde), id: r.id, tipo });
      avisar(existente ? 'Alterações salvas (valem a partir deste mês).' : 'Cadastrado! Ele vai aparecer automaticamente nos próximos meses.');
      renderizar();
    },
  });
}

// ---------- Anexos (comprovantes) ----------
async function abrirAnexos(lancamento) {
  const desenhar = async () => {
    const anexos = await api.anexos.listar({ id: lancamento.id });
    const el = $('#f_lista');
    el.innerHTML = (anexos.length ? `<ul class="lista-simples">${anexos.map(a => `<li>
        <div class="desc">📎 ${esc(a.nome)}</div>
        <button type="button" class="botao pequeno" data-abrir="${a.id}">Abrir</button>
        <button type="button" class="botao pequeno perigo" data-remover="${a.id}">Remover</button>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhum comprovante anexado.</div>')
      + '<button type="button" class="botao primario" id="anexar" style="margin-top:12px">+ Anexar arquivo</button>';
    el.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => tentar(() => api.anexos.abrir({ id: Number(b.dataset.abrir) })));
    el.querySelectorAll('[data-remover]').forEach(b => b.onclick = () => tentar(async () => {
      if (!confirm('Remover este anexo?')) return;
      await api.anexos.remover({ id: Number(b.dataset.remover) });
      desenhar();
    }));
    $('#anexar').onclick = () => tentar(async () => {
      const n = await api.anexos.adicionar({ id: lancamento.id });
      if (n) { avisar('Comprovante anexado.'); desenhar(); }
    });
  };
  abrirFormulario({
    titulo: `Comprovantes — ${lancamento.descricao}`,
    campos: [{ nome: 'lista', tipo: 'info', valor: '' }],
    depois: desenhar,
  });
  $('#modal').addEventListener('close', () => renderizar(), { once: true });
}

// ---------- Pagamento de fatura ----------
async function formPagarFatura(fatura, cartao) {
  const { contas } = await base();
  abrirFormulario({
    titulo: `Pagar fatura ${cartao.nome} — ${nomeMes(fatura.mes)}`,
    campos: [
      { nome: 'info', tipo: 'info', valor: `Total da fatura: <b>${dinheiro(fatura.total)}</b> · já pago: ${dinheiro(fatura.pago)} · vence ${dataBR(fatura.vencimento)}` },
      { nome: 'valor', rotulo: 'Valor pago (R$)', tipo: 'dinheiro', valor: centavosParaTexto(fatura.restante), linha: true, ajuda: 'Pode ser um valor menor, se pagar só uma parte.' },
      { nome: 'data', rotulo: 'Data do pagamento', tipo: 'data', valor: hojeISO(), linha: true },
      { nome: 'conta_id', rotulo: 'Sai da conta', tipo: 'select', valor: cartao.conta_pagamento_id || contas[0]?.id, opcoes: contas.map(c => ({ valor: c.id, texto: `${c.nome} (${dinheiro(c.saldo_atual)})` })) },
    ],
    botao: 'Registrar pagamento',
    salvar: async d => {
      await api.cartoes.pagar({ ...d, cartao_id: cartao.id, fatura: fatura.mes });
      avisar('Pagamento registrado.');
      renderizar();
    },
  });
}

// ---------- Inicialização ----------
function iniciar() {
  $$('#menu button').forEach(b => b.onclick = () => irPara(b.dataset.tela));
  $('#mesAnterior').onclick = () => { estado.mes = somarMeses(estado.mes, -1); renderizar(); };
  $('#mesProximo').onclick = () => { estado.mes = somarMeses(estado.mes, 1); renderizar(); };
  $('#mesTexto').onclick = () => { estado.mes = mesDeHoje(); renderizar(); };
  $('#novoGasto').onclick = () => formLancamento('despesa');
  $('#novaReceita').onclick = () => formLancamento('receita');
  $('#novaTransferencia').onclick = () => formTransferencia();
  if ($('#abrirPasta')) $('#abrirPasta').onclick = () => tentar(() => api.sistema.abrirPasta());
  $('#sino').onclick = () => irPara('painel');

  // Atalhos: N = novo gasto, R = nova receita (fora de campos de texto).
  addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea, dialog') || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); formLancamento('despesa'); }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); formLancamento('receita'); }
  });

  let timerResize;
  addEventListener('resize', () => {
    clearTimeout(timerResize);
    timerResize = setTimeout(() => { if (['painel', 'contas', 'cartoes'].includes(estado.tela)) renderizar(); }, 200);
  });

  renderizar();
}
