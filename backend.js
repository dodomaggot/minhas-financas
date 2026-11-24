'use strict';
// Versão web: liga as telas (mesmas do app Windows) ao banco SQLite rodando no próprio navegador.

window.PLATAFORMA = 'web';
let banco = null;

// Biblioteca de PDF: só é baixada na primeira vez que um PDF é importado (depois fica guardada para usar offline).
let pdfjsCarregado = null;
function carregarPdfjs() {
  if (!pdfjsCarregado) {
    pdfjsCarregado = import('./vendor/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
      return m;
    }).catch(e => { pdfjsCarregado = null; throw new Error('Não consegui carregar o leitor de PDF (precisa de internet na primeira vez). ' + e.message); });
  }
  return pdfjsCarregado;
}

// Troca o banco inteiro (backup restaurado ou versão vinda da nuvem) sem disparar novo envio.
async function aplicarBanco(bytes) {
  const salvar = banco.aoSalvar;
  banco.aoSalvar = null;
  try {
    await banco.abrir(bytes);
  } finally {
    banco.aoSalvar = salvar;
  }
  await idb.set('kv', 'banco', banco.exportar());
  if (typeof renderizar === 'function') renderizar();
}

function criarApi() {
  const b = banco;
  const hoje = () => b.hoje();
  // Mesmos nomes do app Windows (preload.js): api.grupo.acao(arg) devolve uma Promise.
  const rotas = {
    categorias: {
      listar: f => b.listarCategorias(f), salvar: c => b.salvarCategoria(c), excluir: ({ id }) => b.excluirCategoria(id),
      sugerir: ({ descricao, tipo }) => b.sugerirCategoria(descricao, tipo),
    },
    tags: { listar: () => b.listarTags(), renomear: ({ id, nome }) => b.renomearTag(id, nome), excluir: ({ id }) => b.excluirTag(id) },
    contas: {
      listar: f => b.listarContas(f), salvar: c => b.salvarConta(c), excluir: ({ id }) => b.excluirConta(id),
      ajustar: a => b.ajustarSaldo(a), transferir: t => b.transferir(t), historico: ({ id, mes }) => b.historicoConta(id, mes, 12),
    },
    cartoes: {
      listar: f => b.listarCartoes(f), salvar: c => b.salvarCartao(c), excluir: ({ id }) => b.excluirCartao(id),
      fatura: ({ id, mes }) => b.fatura(id, mes), historico: ({ id, mes }) => b.historicoFaturas(id, mes, 12), pagar: p => b.pagarFatura(p),
    },
    recorrentes: { listar: f => b.listarRecorrentes(f), salvar: r => b.salvarRecorrente(r), encerrar: ({ id }) => b.encerrarRecorrente(id) },
    lancamentos: {
      listar: f => b.listarLancamentos(f), salvar: l => b.salvarLancamento(l),
      pago: ({ id, pago }) => b.marcarPago(id, pago), excluir: ({ id, escopo }) => b.excluirLancamento(id, escopo),
    },
    orcamento: { listar: ({ mes }) => b.listarOrcamento(mes), definir: ({ categoria_id, valor }) => b.definirOrcamento(categoria_id, valor) },
    metas: {
      listar: () => b.listarMetas(), salvar: m => b.salvarMeta(m), excluir: ({ id }) => b.excluirMeta(id),
      movimentar: m => b.movimentarMeta(m), movimentos: ({ id }) => b.movimentosMeta(id), excluirMovimento: ({ id }) => b.excluirMovimentoMeta(id),
    },
    painel: { resumo: ({ mes }) => b.resumoMes(mes), historico: ({ mes }) => b.historico(mes, 12), projecao: ({ ate }) => b.projecao(ate) },
    config: { obter: () => b.obterConfig(), definir: ({ chave, valor }) => b.definirConfig(chave, valor) },
    importar: {
      preparar: d => b.prepararImportacao(d), confirmar: d => b.importar(d),
      contarImportados: d => b.contarImportados(d), apagarImportados: d => b.apagarImportados(d),
      // Pode escolher vários arquivos de uma vez (ex.: as faturas de vários meses).
      ler: () => escolherArquivos({ accept: '.ofx,.csv,.txt,.pdf,text/csv,application/x-ofx,application/pdf', multiple: true }).then(async arquivos => {
        if (!arquivos.length) return null;
        const itens = [];
        for (const arq of arquivos) {
          const bytes = await lerBytes(arq);
          if (FinancasImportar.ehPdf(bytes)) {
            avisar('Lendo o PDF…');
            itens.push(...await FinancasImportar.lerPdf(await carregarPdfjs(), bytes, arq.name));
          } else {
            itens.push(...FinancasImportar.lerExtratoBytes(bytes, arq.name));
          }
        }
        itens.sort((a, b) => a.data.localeCompare(b.data));
        return { arquivo: arquivos.map(a => a.name).join(', '), itens };
      }),
    },
    exportar: {
      csv: filtros => entregarArquivo(`lancamentos-${filtros.mes || filtros.de || 'periodo'}.csv`,
        new Blob([b.exportarCsv(filtros)], { type: 'text/csv;charset=utf-8' })),
    },
    backup: {
      salvar: () => entregarArquivo(`backup-financas-${hoje()}.db`, new Blob([b.exportar()], { type: 'application/octet-stream' })),
      restaurar: () => escolherArquivos({ accept: '.db,application/octet-stream,application/x-sqlite3' }).then(async ([arq]) => {
        if (!arq) return false;
        const bytes = await lerBytes(arq);
        if (new TextDecoder().decode(bytes.slice(0, 15)) !== 'SQLite format 3') throw new Error('Este arquivo não é um backup válido.');
        if (!confirm('Os dados atuais serão substituídos pelos do backup. Uma cópia dos dados atuais fica guardada neste aparelho. Continuar?')) return false;
        await guardarCopiaLocal(b.exportar(), 'Antes de restaurar backup');
        await b.abrir(bytes); // dispara salvar → grava no aparelho e envia para a nuvem
        return true;
      }),
      copias: () => idb.get('kv', 'copias').then(l => (l || []).map((c, i) => ({ i, quando: c.quando, motivo: c.motivo, tamanho: c.bytes.length }))),
      usarCopia: async ({ i }) => {
        const lista = (await idb.get('kv', 'copias')) || [];
        if (!lista[i]) throw new Error('Cópia não encontrada.');
        await guardarCopiaLocal(b.exportar(), 'Antes de voltar uma cópia local');
        await b.abrir(lista[i].bytes);
        return true;
      },
    },
    anexos: {
      listar: ({ id }) => b.listarAnexos(id),
      adicionar: ({ id }) => escolherArquivos({ accept: 'image/*,application/pdf', multiple: true }).then(async arquivos => {
        for (const [i, arq] of arquivos.entries()) {
          if (arq.size > 20 * 1024 * 1024) throw new Error(`"${arq.name}" é grande demais (máximo 20 MB).`);
          const { bytes, tipo } = await comprimirImagem(arq);
          const ext = tipo === 'image/jpeg' ? 'jpg' : (arq.name.split('.').pop() || 'bin').toLowerCase();
          const arquivo = `${id}-${Date.now()}-${i}.${ext}`;
          await idb.set('anexos', arquivo, { nome: arq.name, tipo, bytes });
          b.registrarAnexo(id, arq.name, arquivo);
          Sync.anexoAlterado(arquivo, 'enviar');
        }
        return arquivos.length;
      }),
      abrir: async ({ id }) => {
        const reg = b.anexo(id);
        let a = await idb.get('anexos', reg.arquivo);
        if (!a) {
          avisar('Baixando comprovante da nuvem…');
          a = await Sync.baixarAnexo(reg.arquivo);
        }
        if (!a) throw new Error('Comprovante não encontrado neste aparelho nem na nuvem.');
        mostrarAnexo(a);
        return true;
      },
      remover: ({ id }) => b.removerAnexo(id),
    },
    sistema: { abrirPasta: () => true },
  };
  const api = {};
  for (const [grupo, acoes] of Object.entries(rotas)) {
    api[grupo] = {};
    // Promise.resolve().then() faria o seletor de arquivo perder o "clique"; por isso a chamada é direta.
    for (const [acao, fn] of Object.entries(acoes)) {
      api[grupo][acao] = arg => { try { return Promise.resolve(fn(arg || {})); } catch (e) { return Promise.reject(e); } };
    }
  }
  return api;
}

// Mostra imagem dentro do app; PDF abre no visualizador do aparelho.
function mostrarAnexo(a) {
  const blob = new Blob([a.bytes], { type: a.tipo || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  if ((a.tipo || '').startsWith('image/')) {
    const v = $('#visualizador');
    v.querySelector('img').src = url;
    v.querySelector('.vis-nome').textContent = a.nome;
    v.hidden = false;
    v.onclick = () => { v.hidden = true; URL.revokeObjectURL(url); };
  } else {
    const janela = window.open(url, '_blank');
    if (!janela) entregarArquivo(a.nome, blob);
  }
}

function mostrarAvisoVersaoNova() {
  if ($('#versaoNova')) return;
  const el = document.createElement('div');
  el.id = 'versaoNova';
  el.className = 'versao-nova';
  el.innerHTML = '<span>✨ Nova versão do app disponível</span><button class="botao primario pequeno">Atualizar agora</button>';
  el.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(el);
}

function mostrarStatusSync(s) {
  const el = $('#statusSync');
  if (!el) return;
  const icones = { ok: '☁︎', enviando: '⟳', pendente: '⇡', offline: '⚠', erro: '⚠', desligado: '☁︎' };
  el.dataset.fase = s.fase;
  el.querySelector('.icone').textContent = icones[s.fase] || '☁︎';
  el.querySelector('.texto').textContent = s.fase === 'desligado' ? 'Ativar sincronização' : s.texto;
  el.title = s.texto;
  if (estado.tela === 'sincronizacao' && s.fase !== 'enviando') renderizar();
}

(async () => {
  try {
    const SQL = await initSqlJs({ locateFile: arq => 'vendor/' + arq });
    const salvo = await idb.get('kv', 'banco');
    banco = new FinancasDB.Banco(null, { SQL, aoRemoverAnexo: arquivo => { idb.del('anexos', arquivo); Sync.anexoAlterado(arquivo, 'apagar'); } });
    await banco.abrir(salvo || undefined);
    await idb.set('kv', 'banco', banco.exportar());
    banco.aoSalvar = bytes => {
      idb.set('kv', 'banco', bytes).catch(e => alert('Não foi possível gravar no aparelho: ' + e.message));
      Sync.marcarAlterado();
    };
    window.api = criarApi();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    $('#carregando').remove();
    iniciar();
    Sync.iniciar({ banco, aplicar: aplicarBanco, aoMudar: mostrarStatusSync });
    $('#statusSync').onclick = () => irPara('sincronizacao');
  } catch (e) {
    $('#carregando').innerHTML = `<p>Não foi possível abrir o app.</p><p class="erro">${esc(e.message)}</p>`;
    console.error(e);
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const jaTinha = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Procura versão nova ao voltar para o app e a cada 30 minutos.
      const procurar = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') procurar(); });
      setInterval(procurar, 30 * 60 * 1000);
    }).catch(e => console.warn('Sem modo offline:', e));
    // Quando a versão nova assume, oferece recarregar (só se já havia uma versão antes, não na primeira instalação).
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (jaTinha) mostrarAvisoVersaoNova(); });
  }
})();
