'use strict';
// Telas: Categorias e tags; Importar, exportar e backup.

// ---------- Categorias e tags ----------
async function tela_categorias() {
  const [cats, tags] = await Promise.all([api.categorias.listar(), api.tags.listar()]);
  const bloco = (tipo, titulo) => {
    const itens = cats.filter(c => c.tipo === tipo);
    return `<div class="card">
      <div class="secao-titulo"><h3>${titulo}</h3><button class="botao pequeno primario" data-nova="${tipo}">+ Nova</button></div>
      <ul class="lista-simples">${itens.map(c => `<li class="${c.pai_id ? 'subcategoria' : ''}">
        <div class="desc">${c.pai_id ? '↳ ' : ''}${esc(c.nome)}<small>${c.usos} lançamento(s)${c.filhas ? ` · ${c.filhas} subcategoria(s)` : ''}</small></div>
        <span class="acoes">
          ${!c.pai_id ? `<button class="botao pequeno" data-sub="${c.id}" title="Criar subcategoria">+ Sub</button>` : ''}
          <button class="botao pequeno" data-editar="${c.id}">Editar</button>
          <button class="botao pequeno perigo" data-excluir="${c.id}">Excluir</button>
        </span>
      </li>`).join('')}</ul>
    </div>`;
  };
  $('#conteudo').innerHTML = `
    <p class="ajuda">Organize do seu jeito: crie categorias e <b>subcategorias</b> (ex.: Alimentação fora › Delivery). Os gráficos somam
      as subcategorias na categoria principal. <b>Tags</b> servem para marcar gastos de categorias diferentes, como #viagem ou #reforma.</p>
    <div class="grade-2">${bloco('despesa', 'Categorias de gastos')}${bloco('receita', 'Categorias de receitas')}</div>
    <div class="card">
      <h3>Tags</h3>
      ${tags.length ? `<ul class="lista-simples">${tags.map(t => `<li>
        <div class="desc">#${esc(t.nome)}<small>${t.usos} lançamento(s)</small></div>
        <span class="acoes"><button class="botao pequeno" data-ver-tag="${t.id}">Ver lançamentos</button>
        <button class="botao pequeno" data-renomear-tag="${t.id}">Renomear</button>
        <button class="botao pequeno perigo" data-excluir-tag="${t.id}">Excluir</button></span>
      </li>`).join('')}</ul>` : '<div class="vazio">Nenhuma tag ainda. Elas são criadas ao digitar no campo "Tags" de um lançamento.</div>'}
    </div>`;

  const achar = id => cats.find(c => c.id === Number(id));
  const principais = tipo => cats.filter(c => c.tipo === tipo && !c.pai_id);
  const form = (c, tipo, pai) => abrirFormulario({
    titulo: c ? 'Editar categoria' : pai ? `Nova subcategoria de ${pai.nome}` : 'Nova categoria',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: c?.nome },
      { nome: 'pai_id', rotulo: 'Dentro de', tipo: 'select', valor: c ? c.pai_id || '' : pai?.id || '',
        opcoes: [{ valor: '', texto: '— (categoria principal)' }, ...principais(tipo).filter(p => !c || p.id !== c.id).map(p => ({ valor: p.id, texto: p.nome }))] },
    ],
    salvar: async d => { await api.categorias.salvar({ ...d, id: c?.id, tipo }); avisar('Categoria salva.'); renderizar(); },
  });
  $$('[data-nova]').forEach(b => b.onclick = () => form(null, b.dataset.nova));
  $$('[data-sub]').forEach(b => { const p = achar(b.dataset.sub); b.onclick = () => form(null, p.tipo, p); });
  $$('[data-editar]').forEach(b => { const c = achar(b.dataset.editar); b.onclick = () => form(c, c.tipo); });
  $$('[data-excluir]').forEach(b => b.onclick = () => tentar(async () => {
    const c = achar(b.dataset.excluir);
    if (!confirm(`Excluir a categoria "${c.nome}"?` + (c.usos ? '\nOs lançamentos antigos continuam com ela no histórico.' : ''))) return;
    await api.categorias.excluir({ id: c.id });
    avisar('Categoria excluída.');
    renderizar();
  }));
  const acharTag = id => tags.find(t => t.id === Number(id));
  $$('[data-ver-tag]').forEach(b => b.onclick = () => {
    estado.filtros = { ...novosFiltros(), tag_id: b.dataset.verTag, periodo: 'personalizado', de: '2000-01-01', ate: '2100-12-31' };
    irPara('lancamentos');
  });
  $$('[data-renomear-tag]').forEach(b => b.onclick = () => {
    const t = acharTag(b.dataset.renomearTag);
    abrirFormulario({
      titulo: 'Renomear tag',
      campos: [{ nome: 'nome', rotulo: 'Nome', tipo: 'texto', valor: t.nome }],
      salvar: async d => { await api.tags.renomear({ id: t.id, nome: d.nome }); avisar('Tag renomeada.'); renderizar(); },
    });
  });
  $$('[data-excluir-tag]').forEach(b => b.onclick = () => tentar(async () => {
    const t = acharTag(b.dataset.excluirTag);
    if (!confirm(`Excluir a tag #${t.nome}? Ela sai dos lançamentos, mas eles continuam.`)) return;
    await api.tags.excluir({ id: t.id });
    renderizar();
  }));
}

// ---------- Importar, exportar e backup ----------
let importacao = null; // { arquivo, destino, itens }

async function tela_ferramentas() {
  if (importacao) return telaRevisarImportacao();
  const [b, cfg] = await Promise.all([base(), api.config.obter()]);
  const web = window.PLATAFORMA === 'web';
  $('#conteudo').innerHTML = `
    ${htmlAparencia()}
    <div class="grade-2">
      <div class="card">
        <h3>Importar extrato do banco</h3>
        <p class="ajuda">No internet banking, baixe o extrato (ou a fatura do cartão) em <b>OFX</b> — é o formato mais confiável — ou em <b>CSV</b>.
          Você revisa tudo antes de importar; o app sugere a categoria pelo que você já lançou e avisa o que parece repetido.
          <b>Faturas de cartão:</b> aceita também o <b>PDF da fatura</b> do <b>Mercado Pago</b> e do <b>Nubank</b> (e o CSV/OFX do Nubank).
          Escolha o cartão em "Importar para"; pode selecionar vários meses de uma vez.</p>
        <div class="campo"><label for="impDestino">Importar para</label>
          <select id="impDestino">${opcoesOnde(b).filter(g => g.opcoes.length).map(g => `<optgroup label="${esc(g.rotulo)}">${g.opcoes.map(o => `<option value="${o.valor}">${esc(o.texto)}</option>`).join('')}</optgroup>`).join('')}</select>
        </div>
        <div class="acoes-topo">
          <button class="botao primario" id="impEscolher">Escolher arquivo(s)…</button>
          ${api.importar.apagarImportados ? '<button class="botao perigo" id="impDesfazer" title="Apaga os lançamentos que vieram de extrato neste cartão/conta">Desfazer importações…</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h3>Exportar</h3>
        <p class="ajuda">Salva os lançamentos numa planilha (abre no Excel). Para exportar só uma parte, use os filtros da tela
          <a href="#" data-ir="lancamentos">Lançamentos</a> e clique em "Exportar CSV" lá.</p>
        <div class="campo-linha">
          <div class="campo"><label for="expDe">De</label><input type="date" id="expDe" value="${new Date().getFullYear()}-01-01"></div>
          <div class="campo"><label for="expAte">Até</label><input type="date" id="expAte" value="${new Date().getFullYear()}-12-31"></div>
        </div>
        <button class="botao" id="exportar">Exportar planilha (CSV)</button>
      </div>
    </div>
    <div class="grade-2">
      <div class="card">
        <h3>Cópia de segurança</h3>
        <p class="ajuda">${web
          ? 'Com a sincronização ligada, seus dados já ficam guardados na nuvem. Mesmo assim, de vez em quando salve uma cópia em arquivo (no iPhone: "Salvar em Arquivos" / iCloud Drive).'
          : 'O app já guarda sozinho uma cópia por dia na pasta de dados (as últimas 30). Para levar para outro PC ou guardar num pen drive / Google Drive, salve uma cópia manual.'}
          Também serve para trazer os dados do app antigo do Windows: lá use "Salvar cópia…" e aqui "Restaurar cópia…".</p>
        <div class="acoes-topo">
          <button class="botao primario" id="backupSalvar">Salvar cópia…</button>
          <button class="botao" id="backupRestaurar">Restaurar cópia…</button>
          ${web ? '' : '<button class="botao" id="abrirPasta2">Abrir pasta dos dados</button>'}
        </div>
      </div>
      ${web ? `<div class="card">
        <h3>Sincronização entre aparelhos</h3>
        <p class="ajuda">Use os mesmos dados no celular e no computador, guardados criptografados num repositório privado do seu GitHub.</p>
        <button class="botao" data-ir="sincronizacao">Abrir sincronização</button>
        <p class="ajuda" style="margin-top:14px">Os avisos de contas vencendo, faturas e orçamento aparecem no Painel e no sino 🔔 ao abrir o app.</p>
      </div>` : `<div class="card">
        <h3>Avisos do Windows</h3>
        <p class="ajuda">Uma vez por dia, ao abrir o app, aparece uma notificação com contas vencendo, faturas próximas e orçamentos estourados.</p>
        <label class="campo-check"><input type="checkbox" id="cfgNotif" ${cfg.notificacoes !== '0' ? 'checked' : ''}> Mostrar notificações</label>
        <p class="ajuda" style="margin-top:14px"><b>Sincronização automática com o banco (Open Finance):</b> não está disponível — exige
          contratar um serviço autorizado pelo Banco Central. A importação de OFX acima cobre o mesmo resultado, sem custo.</p>
      </div>`}
    </div>`;

  $$('[data-ir]').forEach(a => a.onclick = e => { e.preventDefault(); irPara(a.dataset.ir); });
  ligarAparencia();
  $('#impEscolher').onclick = () => tentar(async () => {
    const destino = lerOnde($('#impDestino').value);
    const lido = await api.importar.ler();
    if (!lido) return;
    const itens = await api.importar.preparar({ ...destino, itens: lido.itens });
    importacao = { arquivo: lido.arquivo, destino, nomeDestino: $('#impDestino').selectedOptions[0].textContent, itens: itens.map(i => ({ ...i, incluir: !i.duplicado && !i.ignorado })), criarFuturas: true };
    renderizar();
  });
  if ($('#impDesfazer')) $('#impDesfazer').onclick = () => tentar(async () => {
    const destino = lerOnde($('#impDestino').value);
    const nome = $('#impDestino').selectedOptions[0].textContent;
    const n = await api.importar.contarImportados(destino);
    if (!n) { alert(`Não há nada importado de extrato em ${nome}.`); return; }
    const ok = await escolher({
      titulo: 'Desfazer importações',
      mensagem: `Apagar os ${n} lançamento(s) que vieram de extrato em ${nome} (inclusive as parcelas previstas)? `
        + 'O que você lançou à mão continua. Use para importar de novo do zero. Antes, salve uma cópia se quiser garantia.',
      opcoes: [{ valor: 'sim', texto: `Apagar ${n} lançamento(s)`, perigo: true }],
    });
    if (ok !== 'sim') return;
    const apagados = await api.importar.apagarImportados(destino);
    avisar(`${apagados} lançamento(s) apagado(s). Agora é só importar de novo.`);
  });
  $('#exportar').onclick = () => tentar(async () => {
    const arq = await api.exportar.csv({ de: $('#expDe').value, ate: $('#expAte').value });
    if (arq) avisar('Planilha salva em ' + arq);
  });
  $('#backupSalvar').onclick = () => tentar(async () => {
    const arq = await api.backup.salvar();
    if (arq) avisar(web ? 'Cópia gerada: ' + arq : 'Cópia salva em ' + arq);
  });
  $('#backupRestaurar').onclick = () => tentar(async () => {
    if (await api.backup.restaurar()) { avisar('Backup restaurado.'); irPara('painel'); }
  });
  if ($('#abrirPasta2')) $('#abrirPasta2').onclick = () => tentar(() => api.sistema.abrirPasta());
  if ($('#cfgNotif')) $('#cfgNotif').onchange = e => tentar(async () => {
    await api.config.definir({ chave: 'notificacoes', valor: e.target.checked ? '1' : '0' });
    avisar(e.target.checked ? 'Notificações ligadas.' : 'Notificações desligadas.');
  });
}

async function telaRevisarImportacao() {
  const imp = importacao;
  const { categorias } = await base();
  const ops = tipo => categorias.filter(c => c.tipo === tipo);
  const validos = imp.itens.filter(i => !i.ignorado);
  const selecionados = validos.filter(i => i.incluir);
  const semCategoria = selecionados.filter(i => !i.categoria_id).length;
  const noCartao = !!imp.destino.cartao_id;
  // Parcelas futuras das compras parceladas (contadas a partir da última parcela conhecida).
  const futuras = imp.itens.filter(i => i.futuras > 0 && (i.incluir || i.duplicado)).reduce((t, i) => t + i.futuras, 0);
  const ignorados = imp.itens.filter(i => i.ignorado);
  const total = selecionados.reduce((t, i) => t + (i.tipo === 'despesa' ? i.valor : -i.valor), 0);
  $('#tituloTela').textContent = 'Revisar importação';
  $('#conteudo').innerHTML = `
    <div class="card">
      <div class="secao-titulo">
        <div><h3>${esc(imp.arquivo)} → ${esc(imp.nomeDestino)}</h3>
          <div class="sub">${validos.length} movimentações · ${validos.filter(i => i.duplicado).length} parecem já lançadas (desmarcadas)
            ${ignorados.length ? ` · ${ignorados.length} ignorada(s)` : ''} · marcados somam ${dinheiro(total)}</div></div>
        <div class="acoes-topo">
          <button class="botao" id="impCancelar">Cancelar</button>
          <button class="botao primario" id="impConfirmar" ${selecionados.length || (futuras && imp.criarFuturas) ? '' : 'disabled'}>Importar ${selecionados.length} lançamento(s)</button>
        </div>
      </div>
      ${futuras ? `<label class="campo-check importar-futuras"><input type="checkbox" id="impFuturas" ${imp.criarFuturas ? 'checked' : ''}>
        Criar também as <b>${futuras} parcelas futuras</b> das compras parceladas (aparecem nas próximas faturas e descontam do limite)</label>` : ''}
      ${!noCartao && validos.length >= 3 && validos.filter(i => i.tipo === 'receita').length > validos.length * 0.6 ? `<div class="aviso-importacao">
        ⚠ <b>Atenção:</b> quase tudo neste arquivo vai entrar como <b>RECEITA</b> (dinheiro entrando) em <b>${esc(imp.nomeDestino)}</b>.
        Se este arquivo é de <b>cartão de crédito</b> (fatura, prints da fatura), toque em <b>Cancelar</b> e escolha o <b>💳 cartão</b> em "Importar para".</div>` : ''}
      ${semCategoria ? `<p class="alerta">⚠ ${semCategoria} item(ns) marcado(s) sem categoria — escolha antes de importar.</p>` : ''}
      <table class="tabela tabela-importar">
        <thead><tr><th><input type="checkbox" id="impTodos" ${selecionados.length === validos.length ? 'checked' : ''} title="Marcar todos"></th>
          <th>Data</th><th>Descrição</th>${noCartao ? '<th>Fatura</th>' : ''}<th>Categoria</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>${imp.itens.map((it, i) => it.ignorado ? `<tr class="desmarcado">
          <td><input type="checkbox" disabled></td><td>${dataBR(it.data)}</td><td>${esc(it.descricao)}</td>${noCartao ? `<td>${mesCurto(it.fatura)}</td>` : ''}
          <td colspan="2" class="mudo">${esc(it.ignorado)}</td><td></td></tr>` : `<tr class="${it.incluir ? '' : 'desmarcado'}">
          <td><input type="checkbox" data-incluir="${i}" ${it.incluir ? 'checked' : ''}></td>
          <td>${dataBR(it.data)}</td>
          <td><input class="input-tabela" data-desc="${i}" value="${esc(it.parcela_total ? it.base : it.descricao)}">
            ${it.parcela_total ? `<span class="etiqueta">${it.parcela_num}/${it.parcela_total}</span>` : ''}</td>
          ${noCartao ? `<td>${mesCurto(it.fatura)}</td>` : ''}
          <td><select data-cat="${i}" class="${it.incluir && !it.categoria_id ? 'faltando' : ''}"><option value="">— escolha —</option>
            ${ops(it.tipo).map(c => `<option value="${c.id}" ${c.id === it.categoria_id ? 'selected' : ''}>${c.pai_id ? '   ↳ ' : ''}${esc(c.nome)}</option>`).join('')}</select></td>
          <td class="num ${it.tipo === 'receita' ? 'tipo-receita' : ''}">${it.tipo === 'receita' ? '+ ' : '− '}${dinheiro(it.valor)}</td>
          <td>${it.substituir ? `<span class="etiqueta" title="Era R$ ${centavosParaTexto(it.valor_previsto)} na previsão">atualiza a prevista</span>`
            : it.duplicado ? '<span class="etiqueta" title="Já existe um lançamento igual">já lançado?</span>' : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
      ${noCartao ? '<p class="ajuda" style="margin-top:12px">A coluna Fatura mostra em qual fatura cada compra entra: pelo nome do arquivo (ex.: Nubank_2026-12-24 = fatura de dez/26) ou pelo dia de fechamento do cartão.</p>' : ''}
    </div>`;

  const chave = it => (it.parcela_total ? it.base : it.descricao).trim().toLowerCase();
  $('#impCancelar').onclick = () => { importacao = null; renderizar(); };
  $('#impTodos').onchange = e => { validos.forEach(i => { i.incluir = e.target.checked; }); renderizar(); };
  if ($('#impFuturas')) $('#impFuturas').onchange = e => { imp.criarFuturas = e.target.checked; renderizar(); };
  $$('[data-incluir]').forEach(c => c.onchange = () => { imp.itens[c.dataset.incluir].incluir = c.checked; renderizar(); });
  $$('[data-desc]').forEach(c => c.onchange = () => {
    const it = imp.itens[c.dataset.desc];
    if (it.parcela_total) it.base = c.value; else it.descricao = c.value;
  });
  $$('[data-cat]').forEach(s => s.onchange = () => {
    const it = imp.itens[s.dataset.cat];
    it.categoria_id = Number(s.value) || null;
    // Aplica a mesma categoria às outras linhas com a mesma descrição ainda sem categoria.
    imp.itens.forEach(o => { if (!o.ignorado && !o.categoria_id && o.tipo === it.tipo && chave(o) === chave(it)) o.categoria_id = it.categoria_id; });
    renderizar();
  });
  $('#impConfirmar').onclick = () => tentar(async () => {
    const itens = imp.itens.filter(i => i.incluir && !i.ignorado);
    if (itens.some(i => !i.categoria_id)) { alert('Escolha a categoria de todos os itens marcados.'); return; }
    const n = await api.importar.confirmar({ ...imp.destino, itens, criarFuturas: !!imp.criarFuturas });
    importacao = null;
    avisar(`${n} lançamento(s) criado(s).`);
    estado.filtros = { ...novosFiltros(), onde: imp.destino.cartao_id ? 'cartao:' + imp.destino.cartao_id : 'conta:' + imp.destino.conta_id };
    if (imp.destino.cartao_id) { estado.cartaoAberto = imp.destino.cartao_id; estado.faturaMes = null; irPara('cartoes'); } else irPara('lancamentos');
  });
}

// ---------- Aparência ----------
function htmlAparencia() {
  const { modo, cor } = lerTema();
  const modos = [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']];
  const escuro = document.documentElement.dataset.tema === 'escuro'
    || (!document.documentElement.dataset.tema && matchMedia('(prefers-color-scheme: dark)').matches);
  return `<div class="card aparencia" style="margin-bottom:16px">
    <h3>Aparência <small>vale só para este aparelho</small></h3>
    <h4>Modo</h4>
    <div class="segmentado">${modos.map(([v, t]) => `<button data-modo="${v}" class="${v === modo ? 'ativo' : ''}">${t}</button>`).join('')}</div>
    <p class="ajuda" style="margin:6px 0 0">Automático acompanha o modo claro/escuro do celular ou do computador.</p>
    <h4>Cor de destaque</h4>
    <div class="cores">${CORES_TEMA.map(c => `<button class="cor-opcao ${c.nome === cor ? 'ativo' : ''}" data-cor-tema="${c.nome}" style="--c:${escuro ? c.escuro : c.claro}">
      <span class="bolinha"></span>${c.rotulo}</button>`).join('')}</div>
  </div>`;
}
function ligarAparencia() {
  $$('[data-modo]').forEach(b => b.onclick = () => { definirTema({ modo: b.dataset.modo }); renderizar(); });
  $$('[data-cor-tema]').forEach(b => b.onclick = () => { definirTema({ cor: b.dataset.corTema }); renderizar(); });
}
