'use strict';
// Telas: Contas bancárias e Cartões de crédito.

// ---------- Contas ----------
let contaGrafico = null;

async function tela_contas() {
  const contas = await api.contas.listar({ ate: fimDoMes(estado.mes) });
  const total = contas.reduce((s, c) => s + c.saldo_atual, 0);
  const totalPrev = contas.reduce((s, c) => s + c.saldo_previsto, 0);
  if (!contas.some(c => c.id === contaGrafico)) contaGrafico = contas[0]?.id;
  const sinal = v => (v >= 0 ? 'bom' : 'ruim');

  $('#conteudo').innerHTML = `
    <div class="secao-titulo">
      <p class="ajuda" style="margin:0">Saldo <b>atual</b> considera só o que já foi pago/recebido. O <b>previsto</b> soma também
        o que está pendente até ${dataBR(fimDoMes(estado.mes))} (inclusive faturas de cartão).</p>
      <div class="acoes-topo"><button class="botao" id="transferir">⇄ Transferir</button><button class="botao primario" id="novaConta">+ Nova conta</button></div>
    </div>
    <div class="grade-contas">
      ${contas.map(c => `<div class="card conta-card">
        <div class="conta-topo"><b>${esc(c.nome)}</b><span class="etiqueta">${TIPOS_CONTA[c.tipo]}</span></div>
        <div class="valor ${sinal(c.saldo_atual)}">${dinheiro(c.saldo_atual)}</div>
        <div class="sub">Previsto em ${dataBR(fimDoMes(estado.mes))}: <b class="${sinal(c.saldo_previsto)}">${dinheiro(c.saldo_previsto)}</b></div>
        <div class="conta-acoes">
          <button class="botao pequeno" data-extrato="${c.id}">Extrato</button>
          <button class="botao pequeno" data-ajustar="${c.id}" title="Corrigir o saldo para bater com o banco">Ajustar saldo</button>
          <button class="botao pequeno" data-editar="${c.id}">Editar</button>
          <button class="botao pequeno perigo" data-excluir="${c.id}">Excluir</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="grade-2 topo-alinhado">
      <div class="card tile">
        <div class="rotulo">Total em todas as contas</div>
        <div class="valor ${sinal(total)}">${dinheiro(total)}</div>
        <div class="sub">Previsto em ${dataBR(fimDoMes(estado.mes))}: <b class="${sinal(totalPrev)}">${dinheiro(totalPrev)}</b></div>
      </div>
      <div class="card">
        <div class="secao-titulo"><h3>Evolução do saldo <small>fim de cada mês</small></h3>
          <select id="contaGrafico">${contas.map(c => `<option value="${c.id}" ${c.id === contaGrafico ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        </div>
        <div id="graficoConta"></div>
      </div>
    </div>`;

  if (contaGrafico) {
    const hist = await api.contas.historico({ id: contaGrafico, mes: estado.mes });
    graficoLinha($('#graficoConta'), hist, { chave: 'saldo', rotulo: 'Saldo', cor: 'var(--receita)' });
  }
  $('#contaGrafico').onchange = e => { contaGrafico = Number(e.target.value); renderizar(); };
  $('#novaConta').onclick = () => formConta();
  $('#transferir').onclick = () => formTransferencia();
  const achar = id => contas.find(c => c.id === Number(id));
  $$('[data-extrato]').forEach(b => b.onclick = () => {
    estado.filtros = { ...novosFiltros(), onde: 'conta:' + b.dataset.extrato };
    irPara('lancamentos');
  });
  $$('[data-editar]').forEach(b => b.onclick = () => formConta(achar(b.dataset.editar)));
  $$('[data-ajustar]').forEach(b => b.onclick = () => {
    const c = achar(b.dataset.ajustar);
    abrirFormulario({
      titulo: `Ajustar saldo — ${c.nome}`,
      campos: [
        { nome: 'info', tipo: 'info', valor: `Saldo no app: <b>${dinheiro(c.saldo_atual)}</b>. Informe o saldo que aparece no banco; a diferença vira um lançamento de ajuste (não entra nos relatórios de gastos).` },
        { nome: 'saldo_real', rotulo: 'Saldo real (R$)', tipo: 'dinheiroSinal', valor: centavosParaTexto(c.saldo_atual), linha: true },
        { nome: 'data', rotulo: 'Data', tipo: 'data', valor: hojeISO(), linha: true },
      ],
      botao: 'Ajustar',
      salvar: async d => { await api.contas.ajustar({ ...d, conta_id: c.id }); avisar('Saldo ajustado.'); renderizar(); },
    });
  });
  $$('[data-excluir]').forEach(b => b.onclick = () => tentar(async () => {
    const c = achar(b.dataset.excluir);
    if (!confirm(`Excluir a conta "${c.nome}"?` + (c.usos ? '\nEla tem lançamentos: vai ficar oculta, mas o histórico continua.' : ''))) return;
    await api.contas.excluir({ id: c.id });
    avisar('Conta excluída.');
    renderizar();
  }));
}

function formConta(c = {}) {
  abrirFormulario({
    titulo: c.id ? 'Editar conta' : 'Nova conta',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: c.nome, placeholder: 'Ex.: Nubank, Caixa, Carteira' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: c.tipo || 'corrente', opcoes: Object.entries(TIPOS_CONTA).map(([v, t]) => ({ valor: v, texto: t })), linha: true },
      { nome: 'saldo_inicial', rotulo: 'Saldo inicial (R$)', tipo: 'dinheiroSinal', valor: centavosParaTexto(c.saldo_inicial || 0), linha: true,
        ajuda: c.id ? 'Saldo de quando começou a usar o app. Para corrigir o saldo de hoje, use "Ajustar saldo".' : 'Quanto tem nesta conta hoje.' },
    ],
    salvar: async d => { await api.contas.salvar({ ...d, id: c.id }); avisar('Conta salva.'); renderizar(); },
  });
}

// ---------- Cartões ----------
async function tela_cartoes() {
  if (estado.cartaoAberto) return telaFatura();
  const cartoes = await api.cartoes.listar();
  $('#conteudo').innerHTML = `
    <div class="secao-titulo">
      <p class="ajuda" style="margin:0">Compras no cartão entram como despesa no mês da compra e vão para a fatura certa pelo dia de fechamento.
        Ao pagar a fatura, o valor sai da conta escolhida e o limite é liberado.</p>
      <button class="botao primario" id="novoCartao">+ Novo cartão</button>
    </div>
    ${cartoes.length ? `<div class="grade-contas">${cartoes.map(c => {
      const f = c.fatura_atual, fa = c.fatura_anterior;
      const [rot, cls] = STATUS_FATURA[f.status];
      const pendenteAnterior = fa.restante > 0;
      return `<div class="card conta-card">
        <div class="conta-topo"><b>💳 ${esc(c.nome)}</b><span class="mudo">fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}</span></div>
        ${c.limite ? `<div class="limite">
          <div class="orc-topo"><span>Limite disponível</span><span class="num"><b>${dinheiro(c.disponivel)}</b> de ${dinheiro(c.limite)}</span></div>
          ${barraProgresso(c.usado, c.limite)}
        </div>` : ''}
        ${pendenteAnterior ? `<div class="fatura-mini destaque-fatura">
          <span>Fatura de ${mesCurto(fa.mes)} · vence ${dataBR(fa.vencimento)} · <span class="${STATUS_FATURA[fa.status][1]}">${STATUS_FATURA[fa.status][0]}</span></span>
          <b class="num">${dinheiro(fa.restante)}</b>
        </div>` : ''}
        <div class="fatura-mini">
          <span>Fatura de ${mesCurto(f.mes)} · vence ${dataBR(f.vencimento)} · <span class="${cls}">${rot}</span></span>
          <b class="num">${dinheiro(f.total)}</b>
        </div>
        <div class="conta-acoes">
          <button class="botao pequeno primario" data-ver="${c.id}" data-mes="${pendenteAnterior ? fa.mes : f.mes}">Ver fatura</button>
          <button class="botao pequeno" data-compra="${c.id}">+ Compra</button>
          <button class="botao pequeno" data-editar="${c.id}">Editar</button>
          <button class="botao pequeno perigo" data-excluir="${c.id}">Excluir</button>
        </div>
      </div>`;
    }).join('')}</div>` : '<div class="card vazio">Nenhum cartão cadastrado.</div>'}`;

  const achar = id => cartoes.find(c => c.id === Number(id));
  $('#novoCartao').onclick = () => formCartao();
  $$('[data-ver]').forEach(b => b.onclick = () => { estado.cartaoAberto = Number(b.dataset.ver); estado.faturaMes = b.dataset.mes; renderizar(); });
  $$('[data-compra]').forEach(b => b.onclick = () => formLancamento('despesa', null, { onde: 'cartao:' + b.dataset.compra, data: hojeISO() }));
  $$('[data-editar]').forEach(b => b.onclick = () => formCartao(achar(b.dataset.editar)));
  $$('[data-excluir]').forEach(b => b.onclick = () => tentar(async () => {
    const c = achar(b.dataset.excluir);
    if (!confirm(`Excluir o cartão "${c.nome}"?\nSe ele tiver compras, fica oculto e o histórico continua.`)) return;
    await api.cartoes.excluir({ id: c.id });
    avisar('Cartão excluído.');
    renderizar();
  }));
}

async function formCartao(c = {}) {
  const { contas } = await base();
  abrirFormulario({
    titulo: c.id ? 'Editar cartão' : 'Novo cartão de crédito',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: c.nome, placeholder: 'Ex.: Nubank, Itaú Visa' },
      { nome: 'limite', rotulo: 'Limite total (R$)', tipo: 'dinheiro', valor: c.limite ? centavosParaTexto(c.limite) : '', opcional: true },
      { nome: 'dia_fechamento', rotulo: 'Dia do fechamento', tipo: 'numero', valor: c.dia_fechamento || '', linha: true, ajuda: 'Compras a partir deste dia vão para a fatura seguinte.' },
      { nome: 'dia_vencimento', rotulo: 'Dia do vencimento', tipo: 'numero', valor: c.dia_vencimento || '', linha: true },
      { nome: 'conta_pagamento_id', rotulo: 'Paga a fatura com a conta', tipo: 'select', valor: c.conta_pagamento_id || contas[0]?.id, opcoes: contas.map(x => ({ valor: x.id, texto: x.nome })) },
    ],
    salvar: async d => { await api.cartoes.salvar({ ...d, id: c.id }); avisar('Cartão salvo.'); renderizar(); },
  });
}

async function telaFatura() {
  const id = estado.cartaoAberto;
  const cartoes = await api.cartoes.listar({ incluirInativos: true });
  const cartao = cartoes.find(c => c.id === id);
  if (!cartao) { estado.cartaoAberto = null; return tela_cartoes(); }
  const mes = estado.faturaMes || cartao.fatura_atual.mes;
  const [f, hist] = await Promise.all([api.cartoes.fatura({ id, mes }), api.cartoes.historico({ id, mes: somarMeses(cartao.fatura_atual.mes, 3) })]);
  const [rot, cls] = STATUS_FATURA[f.status];
  $('#tituloTela').textContent = `Fatura — ${cartao.nome}`;

  $('#conteudo').innerHTML = `
    <div class="secao-titulo">
      <button class="botao" id="voltar">‹ Voltar aos cartões</button>
      <div class="seletor-mes">
        <button id="fatAnt" title="Fatura anterior">‹</button>
        <span class="mes-fatura">Fatura de ${esc(nomeMes(f.mes))}</span>
        <button id="fatProx" title="Próxima fatura">›</button>
      </div>
      <div class="acoes-topo">
        <button class="botao" id="novaCompra">+ Compra</button>
        ${f.restante > 0 ? '<button class="botao primario" id="pagar">Pagar fatura</button>' : ''}
      </div>
    </div>
    <div class="grade-cards">
      <div class="card tile"><div class="rotulo">Total da fatura</div><div class="valor">${dinheiro(f.total)}</div><div class="sub"><span class="${cls}">${rot}</span></div></div>
      <div class="card tile"><div class="rotulo">Já pago</div><div class="valor">${dinheiro(f.pago)}</div><div class="sub">Falta ${dinheiro(f.restante)}</div></div>
      <div class="card tile"><div class="rotulo">Fechamento</div><div class="valor">${dataBR(f.fechamento)}</div><div class="sub">Compras até a véspera entram aqui</div></div>
      <div class="card tile"><div class="rotulo">Vencimento</div><div class="valor">${dataBR(f.vencimento)}</div><div class="sub">Conta: ${esc(cartao.conta_pagamento || '—')}</div></div>
    </div>
    <div class="grade-2">
      <div class="card">
        <h3>Compras desta fatura <small>${f.itens.length}</small></h3>
        ${f.itens.length ? `<table class="tabela">
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th></th></tr></thead>
          <tbody>${f.itens.map(l => `<tr>
            <td>${dataBR(l.data)}</td>
            <td>${esc(l.descricao)} ${l.recorrente_id ? '<span class="etiqueta">fixo</span>' : ''}</td>
            <td>${esc(l.categoria || '—')}</td>
            <td class="num ${l.tipo === 'receita' ? 'tipo-receita' : ''}">${l.tipo === 'receita' ? '+ ' : ''}${dinheiro(l.valor)}</td>
            <td class="acoes"><button data-anexos="${l.id}" title="Comprovantes">📎</button><button data-editar="${l.id}">Editar</button><button data-excluir="${l.id}">Excluir</button></td>
          </tr>`).join('')}</tbody>
        </table>` : '<div class="vazio">Nenhuma compra nesta fatura.</div>'}
        ${f.pagamentos.length ? `<h3 style="margin-top:18px">Pagamentos</h3><ul class="lista-simples">${f.pagamentos.map(p => `<li>
          <div class="desc">${dataBR(p.data)}<small>saiu de ${esc(p.conta || '—')}</small></div><span class="num">${dinheiro(p.valor)}</span>
          <button class="botao pequeno perigo" data-excluir="${p.id}">Desfazer</button></li>`).join('')}</ul>` : ''}
      </div>
      <div class="card">
        <h3>Histórico de faturas <small>clique para abrir</small></h3>
        <div id="graficoFaturas"></div>
      </div>
    </div>`;

  graficoColunas($('#graficoFaturas'), hist, {
    series: [{ chave: 'total', rotulo: 'Fatura', cor: 'var(--despesa)' }],
    selecionado: f.mes,
    aoClicar: d => { estado.faturaMes = d.mes; renderizar(); },
  });
  $('#voltar').onclick = () => { estado.cartaoAberto = null; estado.faturaMes = null; renderizar(); };
  $('#fatAnt').onclick = () => { estado.faturaMes = somarMeses(f.mes, -1); renderizar(); };
  $('#fatProx').onclick = () => { estado.faturaMes = somarMeses(f.mes, 1); renderizar(); };
  $('#novaCompra').onclick = () => formLancamento('despesa', null, { onde: 'cartao:' + id, data: hojeISO() });
  if ($('#pagar')) $('#pagar').onclick = () => formPagarFatura(f, cartao);
  const lista = [...f.itens, ...f.pagamentos].map(l => ({ ...l, cartao: cartao.nome }));
  ligarAcoesLancamentos(lista);
}
