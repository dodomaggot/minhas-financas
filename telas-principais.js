'use strict';
// Telas: Painel e Lançamentos.

// ---------- Painel ----------
async function tela_painel() {
  const [r, hist] = await Promise.all([api.painel.resumo({ mes: estado.mes }), api.painel.historico({ mes: estado.mes })]);
  const el = $('#conteudo');
  const pctGasto = r.receitas ? pct(r.despesas, r.receitas) : null;
  const faltaPagar = r.despesas - r.pago - r.no_cartao;
  const faltaReceber = r.receitas - r.recebido;
  const hoje = hojeISO();
  const sinal = v => (v >= 0 ? 'bom' : 'ruim');
  const primeiroUso = !r.contas.some(c => c.saldo_inicial || c.usos) && !r.receitas && !r.despesas;

  el.innerHTML = `
    ${primeiroUso ? `<div class="card boas-vindas">
      <h3>Bem-vindo! Comece em 3 passos</h3>
      <ol>
        <li><a href="#" data-ir="contas">Cadastre suas contas</a> (banco, carteira, poupança) com o saldo de hoje.</li>
        <li><a href="#" data-ir="fixos">Cadastre o salário e as contas fixas</a> — eles aparecem sozinhos todo mês.</li>
        <li>Tem cartão de crédito? <a href="#" data-ir="cartoes">Cadastre o cartão</a> com o dia de fechamento e vencimento.</li>
      </ol>
      <p>Depois é só lançar os gastos com <b>+ Novo gasto</b> (ou a tecla <b>N</b>).</p>
    </div>` : ''}
    <div class="grade-cards">
      <div class="card tile">
        <div class="rotulo">Saldo em contas hoje</div>
        <div class="valor ${sinal(r.saldoAtual)}">${dinheiro(r.saldoAtual)}</div>
        <div class="sub">Previsto em ${dataBR(r.fimMes)}: <b class="${sinal(r.saldoPrevisto)}">${dinheiro(r.saldoPrevisto)}</b></div>
      </div>
      <div class="card tile">
        <div class="rotulo"><span class="marcador" style="background:var(--receita)"></span>Receitas do mês</div>
        <div class="valor">${dinheiro(r.receitas)}</div>
        <div class="sub">${faltaReceber > 0 ? `Falta receber ${dinheiro(faltaReceber)}` : r.receitas ? 'Tudo recebido' : 'Nenhuma receita no mês'}</div>
      </div>
      <div class="card tile">
        <div class="rotulo"><span class="marcador" style="background:var(--despesa)"></span>Despesas do mês</div>
        <div class="valor">${dinheiro(r.despesas)}</div>
        <div class="sub">${faltaPagar > 0 ? `<span class="alerta">Falta pagar ${dinheiro(faltaPagar)}</span> · ` : ''}no cartão ${dinheiro(r.no_cartao)}</div>
      </div>
      <div class="card tile">
        <div class="rotulo">Resultado do mês</div>
        <div class="valor ${sinal(r.saldo)}">${r.saldo >= 0 ? '▲' : '▼'} ${dinheiro(r.saldo)}</div>
        ${barraProgresso(r.despesas, r.receitas || r.despesas || 1)}
        <div class="sub" style="margin-top:6px">${pctGasto === null ? 'Sem receitas neste mês' : `${pctGasto}% da renda gasto` + (pctGasto > 100 ? ' — <span class="ruim">acima da renda</span>' : '')}</div>
      </div>
    </div>

    ${r.alertas.length ? `<div class="card alertas" style="margin-bottom:16px">
      <h3>Avisos <small>${r.alertas.length}</small></h3>
      <ul class="lista-simples">${r.alertas.slice(0, 8).map((a, i) => `<li class="nivel-${a.nivel}">
        <span class="icone-nivel" title="${a.nivel}">${ICONE_NIVEL[a.nivel]}</span>
        <div class="desc">${esc(a.texto)}</div>
        <span class="num">${dinheiro(a.valor)}</span>
        ${a.tipo === 'conta' ? `<button class="botao pequeno" data-alerta="${i}">Paguei</button>`
          : a.tipo === 'receber' ? `<button class="botao pequeno" data-alerta="${i}">Recebi</button>`
          : a.tipo === 'fatura' || a.tipo === 'limite' ? `<button class="botao pequeno" data-alerta="${i}">Ver cartão</button>`
          : `<button class="botao pequeno" data-alerta="${i}">Ver orçamento</button>`}
      </li>`).join('')}</ul>
      ${r.alertas.length > 8 ? `<div class="sub" style="margin-top:8px">…e mais ${r.alertas.length - 8} aviso(s).</div>` : ''}
    </div>` : ''}

    <div class="grade-2">
      <div class="card">
        <h3>Onde mais gasto <small>${esc(nomeMes(estado.mes))}</small></h3>
        <div id="ranking"></div>
      </div>
      <div class="card">
        <h3>Receitas x despesas <small>últimos 12 meses · clique num mês para abrir</small></h3>
        <div class="legenda"><span style="--cor:var(--receita)">Receitas</span><span style="--cor:var(--despesa)">Despesas</span></div>
        <div id="graficoMeses"></div>
      </div>
    </div>

    <div class="grade-2">
      <div class="card">
        <h3>Contas a pagar <small>pendentes do mês</small></h3>
        ${r.aPagar.length ? `<ul class="lista-simples">${r.aPagar.map(l => `<li>
            <div class="desc">${esc(l.descricao)}<small>${esc(l.categoria || '')} · ${esc(l.conta || '')} · vence ${dataBR(l.data)}
              ${l.data < hoje ? '<span class="ruim">⛔ vencida</span>' : ''}</small></div>
            <span class="num">${dinheiro(l.valor)}</span>
            <button class="botao pequeno" data-pagar="${l.id}">Paguei</button>
          </li>`).join('')}</ul>` : '<div class="vazio">Nenhuma conta pendente neste mês. 🎉</div>'}
      </div>
      <div class="card">
        <h3>Faturas de cartão <small>vencendo em ${esc(nomeMes(estado.mes))}</small></h3>
        ${r.faturas.length ? `<ul class="lista-simples">${r.faturas.map((f, i) => {
          const [rot, cls] = STATUS_FATURA[f.status];
          return `<li>
            <div class="desc">💳 ${esc(f.cartao)}<small>fecha ${dataBR(f.fechamento)} · vence ${dataBR(f.vencimento)} · <span class="${cls}">${rot}</span></small></div>
            <span class="num">${dinheiro(f.total)}</span>
            <button class="botao pequeno" data-fatura="${i}">${f.restante > 0 && f.status !== 'aberta' ? 'Pagar' : 'Ver'}</button>
          </li>`;
        }).join('')}</ul>` : '<div class="vazio">Nenhuma fatura neste mês.</div>'}
      </div>
    </div>

    <div class="grade-2">
      <div class="card">
        <div class="secao-titulo"><h3>Orçamento do mês</h3><button class="botao pequeno" data-ir="orcamento">Ajustar</button></div>
        ${r.orcamento.length ? r.orcamento.slice(0, 6).map(o => orcamentoLinha(o)).join('')
          : '<div class="vazio">Defina um limite de gasto por categoria em <a href="#" data-ir="orcamento">Orçamento</a>.</div>'}
      </div>
      <div class="card">
        <div class="secao-titulo"><h3>Metas</h3><button class="botao pequeno" data-ir="metas">Ver todas</button></div>
        ${r.metas.length ? r.metas.map(m => `<div class="meta-mini">
            <div class="meta-mini-topo"><span>${esc(m.nome)}</span><span class="num">${dinheiro(m.acumulado)} de ${dinheiro(m.valor_alvo)}</span></div>
            <div class="barra-progresso meta"><div style="width:${Math.min(100, pct(m.acumulado, m.valor_alvo))}%"></div></div>
            <small>${m.falta === 0 ? '<span class="bom">✔ Meta atingida</span>' : m.por_mes ? `Guardar ${dinheiro(m.por_mes)}/mês até ${dataBR(m.prazo)}` : `Faltam ${dinheiro(m.falta)}`}</small>
          </div>`).join('') : '<div class="vazio">Crie uma meta em <a href="#" data-ir="metas">Metas</a> (reserva de emergência, viagem…).</div>'}
      </div>
    </div>`;

  graficoRanking($('#ranking'), r.porCategoria, r.despesas, {
    aoClicar: d => {
      estado.filtros = { ...novosFiltros(), tipo: 'despesa', categoria_id: d.id ? String(d.id) : '' };
      irPara('lancamentos');
    },
  });
  graficoColunas($('#graficoMeses'), hist, {
    series: [{ chave: 'receitas', rotulo: 'Receitas', cor: 'var(--receita)' }, { chave: 'despesas', rotulo: 'Despesas', cor: 'var(--despesa)' }],
    selecionado: estado.mes,
    aoClicar: d => { estado.mes = d.mes; renderizar(); },
    dica: d => `<div class="linha"><span>Resultado</span><span class="${d.receitas - d.despesas >= 0 ? 'bom' : 'ruim'}">${dinheiro(d.receitas - d.despesas)}</span></div>`,
  });

  el.querySelectorAll('[data-ir]').forEach(a => a.onclick = e => { e.preventDefault(); irPara(a.dataset.ir); });
  el.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => tentar(async () => {
    await api.lancamentos.pago({ id: Number(b.dataset.pagar), pago: true });
    avisar('Marcado como pago.');
    renderizar();
  }));
  el.querySelectorAll('[data-fatura]').forEach(b => b.onclick = () => {
    const f = r.faturas[b.dataset.fatura];
    estado.cartaoAberto = f.cartao_id;
    estado.faturaMes = f.mes;
    irPara('cartoes');
  });
  el.querySelectorAll('[data-alerta]').forEach(b => b.onclick = () => tentar(async () => {
    const a = r.alertas[b.dataset.alerta];
    if (a.tipo === 'conta' || a.tipo === 'receber') {
      await api.lancamentos.pago({ id: a.id, pago: true });
      avisar('Feito!');
      renderizar();
    } else if (a.tipo === 'fatura' || a.tipo === 'limite') {
      estado.cartaoAberto = a.cartao_id;
      estado.faturaMes = a.mes || null;
      irPara('cartoes');
    } else irPara('orcamento');
  }));
}

function orcamentoLinha(o) {
  const p = pct(o.gasto, o.teto);
  const resto = o.teto - o.gasto;
  return `<div class="orc-linha">
    <div class="orc-topo"><span>${esc(o.nome)}</span><span class="num">${dinheiro(o.gasto)} de ${dinheiro(o.teto)}</span></div>
    ${barraProgresso(o.gasto, o.teto)}
    <small class="${p > 100 ? 'ruim' : p >= 80 ? 'alerta' : ''}">${p > 100 ? `⛔ Estourou ${dinheiro(-resto)}` : p >= 80 ? `⚠ ${p}% usado — restam ${dinheiro(resto)}` : `${p}% usado — restam ${dinheiro(resto)}`}</small>
  </div>`;
}

// ---------- Lançamentos ----------
const NOME_TIPO = { transferencia: 'Transferência', ajuste: 'Ajuste de saldo', pagamento_fatura: 'Pagamento de fatura' };

function filtrosParaApi() {
  const f = estado.filtros;
  const r = { busca: f.busca, situacao: f.situacao, tipo: f.tipo, categoria_id: Number(f.categoria_id) || null, tag_id: Number(f.tag_id) || null, ...lerOnde(f.onde) };
  if (f.periodo === 'personalizado' && (f.de || f.ate)) { r.de = f.de; r.ate = f.ate; } else r.mes = estado.mes;
  return r;
}

async function tela_lancamentos() {
  const f = estado.filtros;
  const [lista, b, tags] = await Promise.all([api.lancamentos.listar(filtrosParaApi()), base(), api.tags.listar()]);
  const tipoCat = f.tipo === 'despesa' || f.tipo === 'receita' ? f.tipo : null;
  const cats = b.categorias.filter(c => !tipoCat || c.tipo === tipoCat);
  const soma = cond => lista.filter(cond).reduce((s, l) => s + l.valor, 0);
  const receitas = soma(l => l.tipo === 'receita');
  const despesas = soma(l => l.tipo === 'despesa');
  const pendentes = soma(l => l.tipo === 'despesa' && !l.pago && !l.cartao_id);
  const temFiltro = Object.entries(f).some(([k, v]) => v && !(k === 'periodo' && v === 'mes'));
  const sel = (v, atual) => (String(v) === String(atual) ? 'selected' : '');

  $('#conteudo').innerHTML = `
    <div class="card">
      <div class="filtros">
        <select id="fPeriodo">
          <option value="mes" ${sel('mes', f.periodo)}>Mês: ${esc(nomeMes(estado.mes))}</option>
          <option value="personalizado" ${sel('personalizado', f.periodo)}>Período personalizado</option>
        </select>
        ${f.periodo === 'personalizado' ? `<input type="date" id="fDe" value="${esc(f.de)}" title="De"> até <input type="date" id="fAte" value="${esc(f.ate)}" title="Até">` : ''}
        <input type="search" id="fBusca" placeholder="Buscar descrição..." value="${esc(f.busca)}">
        <button class="botao pequeno" id="exportar" title="Salvar estes lançamentos numa planilha">Exportar CSV</button>
      </div>
      <div class="filtros">
        <select id="fTipo">
          <option value="">Todos os tipos</option>
          <option value="despesa" ${sel('despesa', f.tipo)}>Só despesas</option>
          <option value="receita" ${sel('receita', f.tipo)}>Só receitas</option>
          <option value="movimentacao" ${sel('movimentacao', f.tipo)}>Transferências, ajustes e faturas</option>
        </select>
        <select id="fOnde">
          <option value="">Todas as contas e cartões</option>
          <optgroup label="Contas">${b.contas.map(c => `<option value="conta:${c.id}" ${sel('conta:' + c.id, f.onde)}>${esc(c.nome)}</option>`).join('')}</optgroup>
          ${b.cartoes.length ? `<optgroup label="Cartões">${b.cartoes.map(c => `<option value="cartao:${c.id}" ${sel('cartao:' + c.id, f.onde)}>💳 ${esc(c.nome)}</option>`).join('')}</optgroup>` : ''}
        </select>
        <select id="fCategoria">
          <option value="">Todas as categorias</option>
          ${cats.map(c => `<option value="${c.id}" ${sel(c.id, f.categoria_id)}>${c.pai_id ? '   ↳ ' : ''}${esc(c.nome)}${!tipoCat && c.tipo === 'receita' && !c.pai_id ? ' (receita)' : ''}</option>`).join('')}
        </select>
        ${tags.length ? `<select id="fTag"><option value="">Todas as tags</option>${tags.map(t => `<option value="${t.id}" ${sel(t.id, f.tag_id)}>#${esc(t.nome)}</option>`).join('')}</select>` : ''}
        <select id="fSituacao">
          <option value="">Efetivados e pendentes</option>
          <option value="pendente" ${sel('pendente', f.situacao)}>Só pendentes</option>
          <option value="pago" ${sel('pago', f.situacao)}>Só efetivados</option>
        </select>
        ${temFiltro ? '<button class="botao pequeno" id="fLimpar">Limpar filtros</button>' : ''}
      </div>
      ${lista.length ? `
      <table class="tabela tabela-lanc">
        <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta / cartão</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map(linhaLancamento).join('')}</tbody>
      </table>
      <div class="totais">
        <span>Receitas: <b>${dinheiro(receitas)}</b></span>
        <span>Despesas: <b>${dinheiro(despesas)}</b></span>
        <span>Resultado: <b class="${receitas - despesas >= 0 ? 'bom' : 'ruim'}">${dinheiro(receitas - despesas)}</b></span>
        <span>A pagar: <b class="${pendentes ? 'alerta' : ''}">${dinheiro(pendentes)}</b></span>
        <span>${lista.length} lançamento(s)</span>
      </div>` : '<div class="vazio">Nenhum lançamento encontrado.</div>'}
    </div>`;

  const atualizar = () => renderizar();
  let timer;
  $('#fBusca').oninput = e => {
    f.busca = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(async () => { await atualizar(); const el = $('#fBusca'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300);
  };
  $('#fPeriodo').onchange = e => {
    f.periodo = e.target.value;
    if (f.periodo === 'personalizado' && !f.de) { f.de = `${estado.mes}-01`; f.ate = fimDoMes(estado.mes); }
    atualizar();
  };
  if ($('#fDe')) { $('#fDe').onchange = e => { f.de = e.target.value; atualizar(); }; $('#fAte').onchange = e => { f.ate = e.target.value; atualizar(); }; }
  $('#fTipo').onchange = e => { f.tipo = e.target.value; f.categoria_id = ''; atualizar(); };
  $('#fOnde').onchange = e => { f.onde = e.target.value; atualizar(); };
  $('#fCategoria').onchange = e => { f.categoria_id = e.target.value; atualizar(); };
  if ($('#fTag')) $('#fTag').onchange = e => { f.tag_id = e.target.value; atualizar(); };
  $('#fSituacao').onchange = e => { f.situacao = e.target.value; atualizar(); };
  if ($('#fLimpar')) $('#fLimpar').onclick = () => { estado.filtros = novosFiltros(); atualizar(); };
  $('#exportar').onclick = () => tentar(async () => {
    const arq = await api.exportar.csv(filtrosParaApi());
    if (arq) avisar('Planilha salva em ' + arq);
  });
  ligarAcoesLancamentos(lista);
}

function linhaLancamento(l) {
  const sinal = l.tipo === 'receita' ? '+ ' : l.tipo === 'ajuste' ? (l.valor >= 0 ? '+ ' : '− ') : l.tipo === 'transferencia' ? '⇄ ' : '− ';
  const classeValor = l.tipo === 'receita' || (l.tipo === 'ajuste' && l.valor >= 0) ? 'tipo-receita' : l.tipo === 'transferencia' ? 'tipo-neutro' : '';
  const onde = l.tipo === 'transferencia' ? `${esc(l.conta)} → ${esc(l.conta_destino)}`
    : l.cartao_id && l.tipo !== 'pagamento_fatura' ? `💳 ${esc(l.cartao)} <small class="mudo">fatura ${mesCurto(l.fatura)}</small>`
    : esc(l.conta || '—');
  const etiquetas = [
    l.recorrente_id ? '<span class="etiqueta" title="Gerado automaticamente">fixo</span>' : '',
    l.parcela_total ? `<span class="etiqueta">${l.parcela_num}/${l.parcela_total}</span>` : '',
    ...(l.tags ? l.tags.split(',').map(t => `<span class="etiqueta tag">#${esc(t)}</span>`) : []),
    l.anexos ? `<span class="etiqueta" title="Tem comprovante">📎 ${l.anexos}</span>` : '',
  ].join(' ');
  const descricao = l.parcela_total ? l.descricao.replace(/ \(\d+\/\d+\)$/, '') : l.descricao;
  let situacao;
  if (l.cartao_id && (l.tipo === 'despesa' || l.tipo === 'receita')) situacao = '<span class="mudo">No cartão</span>';
  else if (l.tipo === 'ajuste' || l.tipo === 'pagamento_fatura') situacao = '<span class="mudo">Efetivado</span>';
  else {
    situacao = `<label class="situacao"><input type="checkbox" data-pago="${l.id}" ${l.pago ? 'checked' : ''}>
      ${l.pago ? (l.tipo === 'receita' ? 'Recebido' : l.tipo === 'transferencia' ? 'Feita' : 'Pago') : `<span class="alerta">${l.tipo === 'receita' ? 'A receber' : l.tipo === 'transferencia' ? 'Agendada' : l.data < hojeISO() ? 'Vencida' : 'A pagar'}</span>`}</label>`;
  }
  const editavel = l.tipo === 'receita' || l.tipo === 'despesa' || l.tipo === 'transferencia';
  return `<tr>
    <td class="c-data">${dataBR(l.data)}</td>
    <td class="c-desc">${esc(descricao)} ${etiquetas}${l.obs ? `<br><small class="mudo">${esc(l.obs)}</small>` : ''}</td>
    <td class="c-cat">${esc(l.categoria || NOME_TIPO[l.tipo] || '—')}</td>
    <td class="c-onde">${onde}</td>
    <td class="num c-valor ${classeValor}">${sinal}${dinheiro(Math.abs(l.valor))}</td>
    <td class="c-sit">${situacao}</td>
    <td class="acoes c-acoes">
      ${l.tipo === 'receita' || l.tipo === 'despesa' ? `<button data-anexos="${l.id}" title="Comprovantes">📎</button>` : ''}
      ${editavel ? `<button data-editar="${l.id}">Editar</button>` : ''}
      <button data-excluir="${l.id}">Excluir</button>
    </td>
  </tr>`;
}

function ligarAcoesLancamentos(lista) {
  const achar = id => lista.find(x => x.id === Number(id));
  $$('[data-pago]').forEach(c => c.onchange = () => tentar(async () => {
    await api.lancamentos.pago({ id: Number(c.dataset.pago), pago: c.checked });
    renderizar();
  }));
  $$('[data-anexos]').forEach(b => b.onclick = () => abrirAnexos(achar(b.dataset.anexos)));
  $$('[data-editar]').forEach(b => b.onclick = () => {
    const l = achar(b.dataset.editar);
    if (l.tipo === 'transferencia') formTransferencia(l); else formLancamento(l.tipo, l);
  });
  $$('[data-excluir]').forEach(b => b.onclick = () => tentar(async () => {
    const l = achar(b.dataset.excluir);
    let escopo = 'este';
    if (l.parcela_total && l.parcela_num < l.parcela_total) {
      escopo = await escolher({
        titulo: 'Excluir parcela',
        mensagem: `"${l.descricao}" faz parte de um parcelamento. O que deseja excluir?`,
        opcoes: [{ valor: 'este', texto: 'Só esta parcela' }, { valor: 'proximos', texto: 'Esta e as próximas', perigo: true }],
      });
      if (!escopo) return;
    } else {
      const msg = l.recorrente_id
        ? `Remover "${l.descricao}" só deste mês?\n(Para parar de vez, use "Fixos e recorrentes".)`
        : `Excluir "${l.descricao}" (${dinheiro(Math.abs(l.valor))})?` + (l.anexos ? '\nOs comprovantes anexados também serão apagados.' : '');
      if (!confirm(msg)) return;
    }
    const n = await api.lancamentos.excluir({ id: l.id, escopo });
    avisar(n > 1 ? `${n} parcelas excluídas.` : 'Lançamento excluído.');
    renderizar();
  }));
}
