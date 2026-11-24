'use strict';
// Telas: Fixos e recorrentes, Orçamento e Metas.

// ---------- Fixos e recorrentes ----------
async function tela_fixos() {
  const lista = await api.recorrentes.listar();
  const receitas = lista.filter(r => r.tipo === 'receita');
  const contas = lista.filter(r => r.tipo === 'despesa');
  // Valor médio por mês (uma conta anual de 1200 pesa 100 por mês).
  const porMes = arr => arr.reduce((s, r) => s + r.valor / (r.periodicidade || 1), 0);
  const tabela = (itens, tipo) => itens.length ? `
    <table class="tabela">
      <thead><tr><th>Descrição</th><th>Categoria</th><th>Conta / cartão</th><th>${tipo === 'receita' ? 'Recebe dia' : 'Vence dia'}</th><th>Repete</th><th>Desde</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${itens.map(r => `<tr>
        <td>${esc(r.descricao)}</td><td>${esc(r.categoria || '—')}</td>
        <td>${r.cartao ? '💳 ' + esc(r.cartao) : esc(r.conta || '—')}</td>
        <td>${r.dia}</td><td>${PERIODOS[r.periodicidade || 1]}</td><td>${mesCurto(r.inicio)}</td>
        <td class="num">${dinheiro(r.valor)}</td>
        <td class="acoes"><button data-editar="${r.id}">Editar</button><button data-encerrar="${r.id}">Encerrar</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Média por mês</td><td class="num">${dinheiro(Math.round(porMes(itens)))}</td><td></td></tr></tfoot>
    </table>` : `<div class="vazio">${tipo === 'receita' ? 'Nenhum salário cadastrado.' : 'Nenhuma conta fixa cadastrada.'}</div>`;

  const sobra = Math.round(porMes(receitas) - porMes(contas));
  $('#conteudo').innerHTML = `
    <p class="ajuda">Cadastre aqui o que se repete: salário, aluguel, luz, internet, assinaturas, IPVA… O app cria o lançamento
      sozinho em cada mês, como <b>a receber</b> / <b>a pagar</b>. Assinaturas no cartão entram direto na fatura.
      Se o valor de um mês mudar (conta de luz, por exemplo), ajuste direto no lançamento daquele mês.</p>
    <div class="card" style="margin-bottom:16px">
      <div class="secao-titulo"><h3>Salário e receitas fixas</h3><button class="botao primario pequeno" id="novoSalario">+ Cadastrar salário</button></div>
      ${tabela(receitas, 'receita')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="secao-titulo"><h3>Contas fixas e assinaturas</h3><button class="botao primario pequeno" id="novaConta">+ Nova conta fixa</button></div>
      ${tabela(contas, 'despesa')}
    </div>
    ${receitas.length || contas.length ? `<div class="card tile" style="max-width:420px">
      <div class="rotulo">Sobra depois das contas fixas</div>
      <div class="valor ${sobra >= 0 ? 'bom' : 'ruim'}">${dinheiro(sobra)}</div>
      <div class="sub">É o que fica livre por mês para mercado, lazer e outros gastos.</div>
    </div>` : ''}`;

  $('#novoSalario').onclick = () => formRecorrente('receita');
  $('#novaConta').onclick = () => formRecorrente('despesa');
  $$('[data-editar]').forEach(b => b.onclick = () => {
    const r = lista.find(x => x.id === Number(b.dataset.editar));
    formRecorrente(r.tipo, r);
  });
  $$('[data-encerrar]').forEach(b => b.onclick = () => tentar(async () => {
    const r = lista.find(x => x.id === Number(b.dataset.encerrar));
    if (!confirm(`Encerrar "${r.descricao}"?\nEle deixa de aparecer a partir deste mês. Os meses anteriores continuam no histórico.`)) return;
    await api.recorrentes.encerrar({ id: r.id });
    avisar('Encerrado.');
    renderizar();
  }));
}

// ---------- Orçamento ----------
async function tela_orcamento() {
  const lista = await api.orcamento.listar({ mes: estado.mes });
  const comTeto = lista.filter(o => o.teto);
  const semTeto = lista.filter(o => !o.teto);
  const totTeto = comTeto.reduce((s, o) => s + o.teto, 0);
  const totGasto = comTeto.reduce((s, o) => s + o.gasto, 0);

  $('#conteudo').innerHTML = `
    <p class="ajuda">Defina quanto quer gastar no máximo por mês em cada categoria. O limite vale para todos os meses e
      inclui as subcategorias. Você recebe um aviso ao chegar em 80% e quando estourar.</p>
    ${comTeto.length ? `<div class="grade-cards" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="card tile"><div class="rotulo">Total planejado</div><div class="valor">${dinheiro(totTeto)}</div><div class="sub">nas categorias com limite</div></div>
      <div class="card tile"><div class="rotulo">Gasto nessas categorias</div><div class="valor">${dinheiro(totGasto)}</div>${barraProgresso(totGasto, totTeto)}</div>
      <div class="card tile"><div class="rotulo">${totTeto - totGasto >= 0 ? 'Ainda pode gastar' : 'Passou do planejado'}</div>
        <div class="valor ${totTeto - totGasto >= 0 ? 'bom' : 'ruim'}">${dinheiro(Math.abs(totTeto - totGasto))}</div><div class="sub">em ${esc(nomeMes(estado.mes))}</div></div>
    </div>` : ''}
    <div class="grade-2">
      <div class="card">
        <h3>Categorias com limite <small>${esc(nomeMes(estado.mes))}</small></h3>
        ${comTeto.length ? comTeto.map(o => `<div class="orc-item">${orcamentoLinha(o)}
          <div class="orc-acoes"><button class="botao pequeno" data-definir="${o.id}">Alterar</button>
          <button class="botao pequeno" data-ver="${o.id}">Ver gastos</button></div></div>`).join('')
          : '<div class="vazio">Nenhum limite definido ainda. Escolha uma categoria ao lado.</div>'}
      </div>
      <div class="card">
        <h3>Sem limite</h3>
        <ul class="lista-simples">${semTeto.map(o => `<li>
          <div class="desc">${esc(o.nome)}<small>gasto em ${esc(nomeMes(estado.mes))}: ${dinheiro(o.gasto)}</small></div>
          <button class="botao pequeno" data-definir="${o.id}">Definir limite</button></li>`).join('')}</ul>
      </div>
    </div>`;

  $$('[data-definir]').forEach(b => b.onclick = () => {
    const o = lista.find(x => x.id === Number(b.dataset.definir));
    abrirFormulario({
      titulo: `Limite mensal — ${o.nome}`,
      campos: [
        { nome: 'info', tipo: 'info', valor: `Gasto em ${esc(nomeMes(estado.mes))}: <b>${dinheiro(o.gasto)}</b>` },
        { nome: 'valor', rotulo: 'Limite por mês (R$)', tipo: 'dinheiro', valor: o.teto ? centavosParaTexto(o.teto) : '', opcional: true, ajuda: 'Deixe vazio ou 0 para remover o limite.' },
      ],
      salvar: async d => { await api.orcamento.definir({ categoria_id: o.id, valor: d.valor || 0 }); avisar('Orçamento salvo.'); renderizar(); },
    });
  });
  $$('[data-ver]').forEach(b => b.onclick = () => {
    estado.filtros = { ...novosFiltros(), tipo: 'despesa', categoria_id: b.dataset.ver };
    irPara('lancamentos');
  });
}

// ---------- Metas ----------
async function tela_metas() {
  const metas = await api.metas.listar();
  $('#conteudo').innerHTML = `
    <div class="secao-titulo">
      <p class="ajuda" style="margin:0">Crie objetivos com valor e prazo (reserva de emergência, viagem, carro…) e registre quanto
        guardou. O app calcula quanto falta guardar por mês para chegar lá.</p>
      <button class="botao primario" id="novaMeta">+ Nova meta</button>
    </div>
    ${metas.length ? `<div class="grade-contas">${metas.map(m => {
      const p = pct(m.acumulado, m.valor_alvo);
      return `<div class="card conta-card">
        <div class="conta-topo"><b>🎯 ${esc(m.nome)}</b>${m.prazo ? `<span class="mudo">até ${dataBR(m.prazo)}</span>` : ''}</div>
        <div class="valor">${dinheiro(m.acumulado)} <small class="mudo">de ${dinheiro(m.valor_alvo)}</small></div>
        <div class="barra-progresso meta"><div style="width:${Math.min(100, p)}%"></div></div>
        <div class="sub" style="margin-top:6px">${m.falta === 0 ? '<span class="bom">✔ Meta atingida!</span>'
          : m.atrasada ? `<span class="ruim">⛔ Prazo passou — faltam ${dinheiro(m.falta)}</span>`
          : m.por_mes ? `${p}% · faltam ${dinheiro(m.falta)} → guarde <b>${dinheiro(m.por_mes)}/mês</b> por ${m.meses} ${m.meses === 1 ? 'mês' : 'meses'}`
          : `${p}% · faltam ${dinheiro(m.falta)}`}</div>
        <div class="conta-acoes">
          <button class="botao pequeno primario" data-guardar="${m.id}">+ Guardar</button>
          <button class="botao pequeno" data-retirar="${m.id}">Retirar</button>
          <button class="botao pequeno" data-historico="${m.id}">Histórico</button>
          <button class="botao pequeno" data-editar="${m.id}">Editar</button>
          <button class="botao pequeno perigo" data-excluir="${m.id}">Excluir</button>
        </div>
      </div>`;
    }).join('')}</div>` : '<div class="card vazio">Nenhuma meta ainda. Que tal começar por uma reserva de emergência (uns 6 meses de gastos)?</div>'}`;

  const achar = id => metas.find(m => m.id === Number(id));
  $('#novaMeta').onclick = () => formMeta();
  $$('[data-editar]').forEach(b => b.onclick = () => formMeta(achar(b.dataset.editar)));
  const mov = (m, retirada) => abrirFormulario({
    titulo: `${retirada ? 'Retirar de' : 'Guardar em'} ${m.nome}`,
    campos: [
      { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'dinheiro', linha: true },
      { nome: 'data', rotulo: 'Data', tipo: 'data', valor: hojeISO(), linha: true },
      { nome: 'obs', rotulo: 'Observação (opcional)', tipo: 'texto' },
    ],
    salvar: async d => { await api.metas.movimentar({ ...d, meta_id: m.id, retirada }); avisar(retirada ? 'Retirada registrada.' : 'Valor guardado. 👏'); renderizar(); },
  });
  $$('[data-guardar]').forEach(b => b.onclick = () => mov(achar(b.dataset.guardar), false));
  $$('[data-retirar]').forEach(b => b.onclick = () => mov(achar(b.dataset.retirar), true));
  $$('[data-historico]').forEach(b => b.onclick = async () => {
    const m = achar(b.dataset.historico);
    const desenhar = async () => {
      const movs = await api.metas.movimentos({ id: m.id });
      $('#f_lista').innerHTML = movs.length ? `<ul class="lista-simples">${movs.map(x => `<li>
        <div class="desc">${dataBR(x.data)}${x.obs ? `<small>${esc(x.obs)}</small>` : ''}</div>
        <span class="num ${x.valor < 0 ? 'ruim' : 'bom'}">${x.valor < 0 ? '− ' : '+ '}${dinheiro(Math.abs(x.valor))}</span>
        <button type="button" class="botao pequeno perigo" data-apagar="${x.id}">Apagar</button></li>`).join('')}</ul>`
        : '<div class="vazio">Nada guardado ainda.</div>';
      $$('[data-apagar]').forEach(a => a.onclick = () => tentar(async () => {
        if (!confirm('Apagar este registro?')) return;
        await api.metas.excluirMovimento({ id: Number(a.dataset.apagar) });
        desenhar();
      }));
    };
    abrirFormulario({ titulo: `Histórico — ${m.nome}`, campos: [{ nome: 'lista', tipo: 'info', valor: '' }], depois: desenhar });
    $('#modal').addEventListener('close', () => renderizar(), { once: true });
  });
  $$('[data-excluir]').forEach(b => b.onclick = () => tentar(async () => {
    const m = achar(b.dataset.excluir);
    if (!confirm(`Excluir a meta "${m.nome}" e todo o histórico dela?`)) return;
    await api.metas.excluir({ id: m.id });
    avisar('Meta excluída.');
    renderizar();
  }));
}

function formMeta(m = {}) {
  abrirFormulario({
    titulo: m.id ? 'Editar meta' : 'Nova meta',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: m.nome, placeholder: 'Ex.: Reserva de emergência, Viagem' },
      { nome: 'valor_alvo', rotulo: 'Quanto quer juntar (R$)', tipo: 'dinheiro', valor: m.valor_alvo ? centavosParaTexto(m.valor_alvo) : '', linha: true },
      { nome: 'prazo', rotulo: 'Até quando (opcional)', tipo: 'data', valor: m.prazo || '', linha: true },
    ],
    salvar: async d => { await api.metas.salvar({ ...d, id: m.id }); avisar('Meta salva.'); renderizar(); },
  });
}
