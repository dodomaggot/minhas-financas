// Camada de dados: SQLite (sql.js) gravado em um arquivo local.
// Dinheiro em centavos (inteiros). Datas 'AAAA-MM-DD'; mês 'AAAA-MM'.
//
// Tipos de lançamento:
//   receita / despesa      -> entram nos relatórios. Em conta (conta_id) ou no cartão (cartao_id + fatura).
//   transferencia          -> sai de conta_id e entra em conta_destino_id. Não é receita nem despesa.
//   ajuste                 -> correção de saldo (valor com sinal). Não entra nos relatórios.
//   pagamento_fatura       -> sai de conta_id e abate a fatura (cartao_id + fatura). Não é despesa
//                             (as compras do cartão já foram contadas como despesa).

// O mesmo arquivo roda no Node/Electron (module.exports) e no navegador (window.FinancasDB).
(function () {
const ehNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
const fs = ehNode ? require('fs') : null;
const path = ehNode ? require('path') : null;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (nome, tipo)
);
CREATE TABLE IF NOT EXISTS recorrentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  valor INTEGER NOT NULL,
  dia INTEGER NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT
);
CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  valor INTEGER NOT NULL,
  data TEXT NOT NULL,
  competencia TEXT NOT NULL,
  pago INTEGER NOT NULL DEFAULT 1,
  forma TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '',
  recorrente_id INTEGER REFERENCES recorrentes(id),
  cancelado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_lanc_comp ON lancamentos(competencia);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_rec ON lancamentos(recorrente_id, competencia);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'corrente',   -- corrente | poupanca | carteira | investimento
  saldo_inicial INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cartoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  limite INTEGER NOT NULL DEFAULT 0,
  dia_fechamento INTEGER NOT NULL,
  dia_vencimento INTEGER NOT NULL,
  conta_pagamento_id INTEGER REFERENCES contas(id),
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS lancamento_tags (
  lancamento_id INTEGER NOT NULL REFERENCES lancamentos(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lancamento_id, tag_id)
);
CREATE TABLE IF NOT EXISTS anexos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lancamento_id INTEGER NOT NULL REFERENCES lancamentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  arquivo TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orcamentos (
  categoria_id INTEGER PRIMARY KEY REFERENCES categorias(id),
  valor INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS metas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  valor_alvo INTEGER NOT NULL,
  prazo TEXT,
  criado_em TEXT NOT NULL DEFAULT (date('now','localtime'))
);
CREATE TABLE IF NOT EXISTS metas_movs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meta_id INTEGER NOT NULL REFERENCES metas(id) ON DELETE CASCADE,
  valor INTEGER NOT NULL,     -- positivo guarda, negativo retira
  data TEXT NOT NULL,
  obs TEXT NOT NULL DEFAULT ''
);
`;

const CATEGORIAS_PADRAO = {
  despesa: ['Moradia', 'Mercado', 'Alimentação fora', 'Transporte', 'Saúde', 'Educação',
    'Lazer', 'Compras', 'Contas e serviços', 'Assinaturas', 'Outros'],
  receita: ['Salário', 'Renda extra', 'Rendimentos', 'Outros'],
};

// Palavras comuns em extratos → categoria padrão (texto já sem acento e em minúsculas). A ordem importa.
const REGRAS_CATEGORIA = [
  [/netflix|spotify|prime video|disney|hbo|\bmax\b|youtube|deezer|globoplay|icloud|apple com|google one|paramount|crunchyroll|melimais|meli ?\+|meli mais/, 'Assinaturas'],
  [/blizzard|nuuvem|steam|epic games|playstation|xbox|nintendo|riot/, 'Lazer'],
  [/mercado ?livre|mercadolivre|shopee|shein|amazon|magalu|magazine|americanas|renner|riachuelo|torra|zara|centauro|kalunga|\bloja\b|shopping|natura|boticario|daiso|caedu|varej|comercio/, 'Compras'],
  [/ifd|ifood|rappi|restaur|lanch|pizz|burg|\bbar\b|padaria|cafe|sorvet|janta|comer|churrasc|acai|confeitar|doceria|mc ?donald|subway|habib|outback|popeyes|burger king|\bbk\b|kfc|starbucks|cervej|armazem/, 'Alimentação fora'],
  [/supermerc|mercado|atacad|assai|covabra|hortifrut|acougue|sacolao|carrefour|pao de acucar|savegnago|sonda/, 'Mercado'],
  [/posto|combust|auto ?ban|pedagio|sem ?parar|conectcar|uber|\b99\b|estacion|allpark|zona azul|metro|onibus|cptm|bilhete/, 'Transporte'],
  [/drogaria|farmac|droga|raia|pacheco|hospital|clinic|medic|laborat|dentist|odonto|otica|academia|smart ?fit/, 'Saúde'],
  [/aluguel|condomin|loft|quinto ?andar|imobili/, 'Moradia'],
  [/cinema|cinemark|thermas|water ?park|parque|teatro|show|ingresso|sympla|eventim|\bnba\b|steam|playstation|xbox|nintendo|viagem|hotel|airbnb|booking/, 'Lazer'],
  [/escola|curso|faculd|livrar|udemy|alura|papelaria/, 'Educação'],
  [/energia|enel|cpfl|eletropaulo|sabesp|\bagua\b|internet|vivo|claro|\btim\b|\boi\b|\bnet\b|telefon|comgas/, 'Contas e serviços'],
];

const TIPOS_CONTA = ['corrente', 'poupanca', 'carteira', 'investimento'];
const PERIODOS = [1, 2, 3, 6, 12];

// ---------- Datas ----------
const pad = n => String(n).padStart(2, '0');
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function somarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function diffMeses(de, ate) {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}
function ultimoDia(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
// Data do mês com o dia pedido, ajustada para meses curtos (dia 31 em fevereiro vira 28/29).
function dataNoMes(mes, dia) {
  return `${mes}-${pad(Math.min(dia, ultimoDia(mes)))}`;
}
function somarDias(data, n) {
  const d = new Date(data + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fatura (identificada pelo mês de vencimento) em que cai uma compra feita em "data".
// Compra no dia do fechamento ou depois vai para a fatura seguinte.
function faturaDe(data, fechamento, vencimento) {
  const mes = data.slice(0, 7);
  const dia = Number(data.slice(8));
  let mesFech = mes;
  if (dia >= Math.min(fechamento, ultimoDia(mes))) mesFech = somarMeses(mes, 1);
  return vencimento > fechamento ? mesFech : somarMeses(mesFech, 1);
}
function datasFatura(fatura, fechamento, vencimento) {
  const mesFech = vencimento > fechamento ? fatura : somarMeses(fatura, -1);
  return { fechamento: dataNoMes(mesFech, fechamento), vencimento: dataNoMes(fatura, vencimento) };
}

// ---------- Validações ----------
function validarMes(m) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '')) throw new Error('Mês inválido.');
  return m;
}
function validarData(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || isNaN(new Date(d + 'T00:00:00'))) throw new Error('Data inválida.');
  return d;
}
function validarValor(v, { permiteZero = false } = {}) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || (!permiteZero && n === 0)) throw new Error('Informe um valor maior que zero.');
  return n;
}
function validarDia(d, rotulo = 'O dia') {
  const n = Math.round(Number(d));
  if (!(n >= 1 && n <= 31)) throw new Error(`${rotulo} deve ser entre 1 e 31.`);
  return n;
}
function texto(v, rotulo) {
  const s = String(v ?? '').trim();
  if (rotulo && !s) throw new Error(`Informe ${rotulo}.`);
  return s;
}
const idOuNulo = v => (v === '' || v === null || v === undefined || Number(v) === 0 ? null : Number(v));

// Normaliza descrição para comparar (sugestão de categoria, duplicados na importação).
const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\d+\/\d+/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

class Banco {
  // No navegador: new Banco(null, { SQL, aoSalvar(bytes), aoRemoverAnexo(arquivo) }) e abrir(bytes).
  constructor(arquivo, { pastaAnexos, SQL, aoSalvar, aoRemoverAnexo } = {}) {
    this.arquivo = arquivo;
    this.pastaAnexos = pastaAnexos || (arquivo && path ? path.join(path.dirname(arquivo), 'anexos') : null);
    this.SQL = SQL || null;
    this.aoSalvar = aoSalvar || null;
    this.aoRemoverAnexo = aoRemoverAnexo || null;
    this.db = null;
    this.hoje = hojeISO; // pode ser trocado nos testes
  }

  // dados: bytes de um banco SQLite. Sem dados, lê o arquivo (Node) ou cria um banco vazio.
  async abrir(dados) {
    if (!this.SQL) {
      const initSqlJs = require('sql.js');
      const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
      this.SQL = await initSqlJs({ wasmBinary });
    }
    if (dados === undefined && this.arquivo && fs && fs.existsSync(this.arquivo)) dados = fs.readFileSync(this.arquivo);
    const novo = dados ? new this.SQL.Database(dados instanceof Uint8Array ? dados : new Uint8Array(dados)) : new this.SQL.Database();
    try {
      novo.exec('SELECT count(*) FROM sqlite_master');
    } catch {
      novo.close();
      throw new Error('Este arquivo não é um banco de dados do Minhas Finanças.');
    }
    if (this.db) this.db.close();
    this.db = novo;
    this.db.run('PRAGMA foreign_keys = ON');
    this.migrar();
    this.salvar();
  }

  migrar() {
    const versao = this.um('PRAGMA user_version').user_version;
    if (versao < 1) {
      this.db.run(SCHEMA_V1);
      for (const tipo of ['despesa', 'receita']) {
        for (const nome of CATEGORIAS_PADRAO[tipo]) {
          this.db.run('INSERT OR IGNORE INTO categorias (nome, tipo) VALUES (?, ?)', [nome, tipo]);
        }
      }
      this.db.run('PRAGMA user_version = 1');
    }
    if (versao < 2) {
      this.db.run('BEGIN');
      try {
        this.db.run(SCHEMA_V2);
        const add = (tabela, coluna, def) => {
          if (!this.temColuna(tabela, coluna)) this.db.run(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
        };
        add('categorias', 'pai_id', 'INTEGER REFERENCES categorias(id)');
        add('lancamentos', 'conta_id', 'INTEGER REFERENCES contas(id)');
        add('lancamentos', 'conta_destino_id', 'INTEGER REFERENCES contas(id)');
        add('lancamentos', 'cartao_id', 'INTEGER REFERENCES cartoes(id)');
        add('lancamentos', 'fatura', 'TEXT');
        add('lancamentos', 'parcela_grupo', 'INTEGER');
        add('lancamentos', 'parcela_num', 'INTEGER');
        add('lancamentos', 'parcela_total', 'INTEGER');
        add('lancamentos', 'importacao_id', 'TEXT');
        add('recorrentes', 'conta_id', 'INTEGER REFERENCES contas(id)');
        add('recorrentes', 'cartao_id', 'INTEGER REFERENCES cartoes(id)');
        add('recorrentes', 'periodicidade', 'INTEGER NOT NULL DEFAULT 1');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_lanc_data ON lancamentos(data)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_lanc_cartao ON lancamentos(cartao_id, fatura)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_lanc_grupo ON lancamentos(parcela_grupo)');
        this.db.run('INSERT OR IGNORE INTO categorias (nome, tipo) VALUES (?, ?)', ['Assinaturas', 'despesa']);
        this.db.run('INSERT OR IGNORE INTO categorias (nome, tipo) VALUES (?, ?)', ['Rendimentos', 'receita']);
        // Tudo que já existia passa a pertencer a uma conta padrão.
        if (!this.um('SELECT id FROM contas LIMIT 1')) {
          this.db.run(`INSERT INTO contas (nome, tipo) VALUES ('Conta principal', 'corrente')`);
        }
        const conta = this.um('SELECT id FROM contas ORDER BY id LIMIT 1').id;
        this.db.run('UPDATE lancamentos SET conta_id = ? WHERE conta_id IS NULL AND cartao_id IS NULL', [conta]);
        this.db.run('UPDATE recorrentes SET conta_id = ? WHERE conta_id IS NULL AND cartao_id IS NULL', [conta]);
        this.db.run(`INSERT OR IGNORE INTO config (chave, valor) VALUES ('notificacoes', '1')`);
        this.db.run('PRAGMA user_version = 2');
        this.db.run('COMMIT');
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
    }
    if (versao < 3) {
      // Versão 3: chave da compra parcelada (separa compras iguais, ex.: duas "NATURA PAY 1/3" no mesmo dia).
      if (!this.temColuna('lancamentos', 'parcela_chave')) this.db.run('ALTER TABLE lancamentos ADD COLUMN parcela_chave TEXT');
      this.db.run('PRAGMA user_version = 3');
    }
  }

  temColuna(tabela, coluna) {
    return this.todos(`PRAGMA table_info(${tabela})`).some(c => c.name === coluna);
  }

  // Grava em arquivo temporário e renomeia, para não corromper o banco se o PC desligar no meio.
  salvar() {
    if (this.aoSalvar) { this.aoSalvar(this.db.export()); return; }
    if (!this.arquivo) return;
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.arquivo);
  }

  backup(pasta, manter = 30) {
    if (!this.arquivo || !fs.existsSync(this.arquivo)) return;
    fs.mkdirSync(pasta, { recursive: true });
    fs.copyFileSync(this.arquivo, path.join(pasta, `financas-${this.hoje()}.db`));
    const antigos = fs.readdirSync(pasta).filter(f => f.startsWith('financas-')).sort();
    for (const f of antigos.slice(0, Math.max(0, antigos.length - manter))) fs.unlinkSync(path.join(pasta, f));
  }

  todos(sql, params = []) {
    const st = this.db.prepare(sql);
    st.bind(params);
    const linhas = [];
    while (st.step()) linhas.push(st.getAsObject());
    st.free();
    return linhas;
  }
  um(sql, params = []) { return this.todos(sql, params)[0] || null; }
  exec(sql, params = []) {
    this.db.run(sql, params);
    return this.um('SELECT last_insert_rowid() AS id').id;
  }

  // Executa várias alterações de uma vez: ou grava tudo, ou nada. Aceita chamadas aninhadas.
  transacao(fn) {
    if (this.emTransacao) return fn();
    this.db.run('BEGIN');
    this.emTransacao = true;
    try {
      const r = fn();
      this.db.run('COMMIT');
      this.emTransacao = false;
      this.salvar();
      return r;
    } catch (e) {
      this.emTransacao = false;
      this.db.run('ROLLBACK');
      throw e;
    }
  }

  mesAtual() { return this.hoje().slice(0, 7); }

  // ---------- Configurações ----------
  obterConfig() {
    return Object.fromEntries(this.todos('SELECT chave, valor FROM config').map(c => [c.chave, c.valor]));
  }
  definirConfig(chave, valor) {
    this.transacao(() => this.db.run('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)', [chave, String(valor)]));
    return true;
  }

  // ---------- Categorias ----------
  listarCategorias({ tipo, incluirInativas } = {}) {
    const onde = [];
    const p = [];
    if (tipo) { onde.push('c.tipo = ?'); p.push(tipo); }
    if (!incluirInativas) onde.push('c.ativo = 1');
    return this.todos(`
      SELECT c.*, cp.nome AS pai,
        CASE WHEN cp.id IS NULL THEN c.nome ELSE cp.nome || ' › ' || c.nome END AS nome_completo,
        (SELECT COUNT(*) FROM lancamentos l WHERE l.categoria_id = c.id AND l.cancelado = 0) AS usos,
        (SELECT COUNT(*) FROM categorias f WHERE f.pai_id = c.id AND f.ativo = 1) AS filhas
      FROM categorias c LEFT JOIN categorias cp ON cp.id = c.pai_id
      ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''}
      ORDER BY c.tipo, COALESCE(cp.nome, c.nome) COLLATE NOCASE, c.pai_id IS NOT NULL, c.nome COLLATE NOCASE`, p);
  }

  salvarCategoria({ id, nome, tipo, pai_id }) {
    nome = texto(nome, 'o nome da categoria');
    pai_id = idOuNulo(pai_id);
    return this.transacao(() => {
      const atual = id ? this.um('SELECT * FROM categorias WHERE id = ?', [id]) : null;
      if (id && !atual) throw new Error('Categoria não encontrada.');
      tipo = atual ? atual.tipo : tipo;
      if (!['despesa', 'receita'].includes(tipo)) throw new Error('Tipo inválido.');
      if (pai_id) {
        const pai = this.um('SELECT * FROM categorias WHERE id = ?', [pai_id]);
        if (!pai || pai.tipo !== tipo) throw new Error('Categoria principal inválida.');
        if (pai.pai_id) throw new Error('Uma subcategoria não pode ter outras subcategorias.');
        if (id && pai.id === Number(id)) throw new Error('A categoria não pode ser subcategoria dela mesma.');
        if (id && this.um('SELECT id FROM categorias WHERE pai_id = ? AND ativo = 1', [id])) {
          throw new Error('Esta categoria tem subcategorias, por isso não pode virar subcategoria.');
        }
      }
      const igual = this.um('SELECT * FROM categorias WHERE nome = ? COLLATE NOCASE AND tipo = ? AND id <> ?', [nome, tipo, id || 0]);
      if (igual && igual.ativo) throw new Error('Já existe uma categoria com esse nome.');
      if (id) {
        this.db.run('UPDATE categorias SET nome = ?, pai_id = ? WHERE id = ?', [nome, pai_id, id]);
        return id;
      }
      if (igual) {
        this.db.run('UPDATE categorias SET ativo = 1, pai_id = ? WHERE id = ?', [pai_id, igual.id]);
        return igual.id;
      }
      return this.exec('INSERT INTO categorias (nome, tipo, pai_id) VALUES (?, ?, ?)', [nome, tipo, pai_id]);
    });
  }

  // Categoria com uso é só desativada, para o histórico continuar certo.
  excluirCategoria(id) {
    return this.transacao(() => {
      if (this.um('SELECT id FROM categorias WHERE pai_id = ? AND ativo = 1', [id])) {
        throw new Error('Exclua ou mova as subcategorias antes.');
      }
      const usada = this.um(`SELECT
          (SELECT COUNT(*) FROM lancamentos WHERE categoria_id = ?) +
          (SELECT COUNT(*) FROM recorrentes WHERE categoria_id = ?) +
          (SELECT COUNT(*) FROM categorias WHERE pai_id = ?) AS n`, [id, id, id]).n;
      this.db.run('DELETE FROM orcamentos WHERE categoria_id = ?', [id]);
      if (usada) this.db.run('UPDATE categorias SET ativo = 0 WHERE id = ?', [id]);
      else this.db.run('DELETE FROM categorias WHERE id = ?', [id]);
      return true;
    });
  }

  validarCategoria(categoriaId, tipo) {
    const c = this.um('SELECT * FROM categorias WHERE id = ?', [categoriaId]);
    if (!c) throw new Error('Escolha uma categoria.');
    if (c.tipo !== tipo) throw new Error('A categoria não combina com o tipo do lançamento.');
    return c.id;
  }

  // Sugere a categoria usada da última vez num lançamento com descrição parecida.
  sugerirCategoria(descricao, tipo) {
    const alvo = normalizar(descricao);
    if (!alvo) return null;
    const linhas = this.todos(`SELECT descricao, categoria_id FROM lancamentos
      WHERE tipo = ? AND categoria_id IS NOT NULL AND cancelado = 0 ORDER BY id DESC LIMIT 3000`, [tipo]);
    const exata = linhas.find(l => normalizar(l.descricao) === alvo);
    if (exata) return exata.categoria_id;
    const palavra = alvo.split(' ').find(p => p.length >= 4);
    const parecida = palavra && linhas.find(l => normalizar(l.descricao).split(' ').includes(palavra));
    if (parecida) return parecida.categoria_id;
    return this.categoriaPorPalavra(alvo, tipo);
  }

  // Primeira vez que aparece: tenta pela palavra (Padaria → Alimentação fora, Drogaria → Saúde...).
  categoriaPorPalavra(alvo, tipo) {
    if (tipo !== 'despesa') return null;
    for (const [re, nome] of REGRAS_CATEGORIA) {
      if (!re.test(alvo)) continue;
      const c = this.um(`SELECT id FROM categorias WHERE tipo = 'despesa' AND ativo = 1 AND nome = ? COLLATE NOCASE`, [nome]);
      if (c) return c.id;
    }
    return null;
  }

  // ---------- Tags ----------
  listarTags() {
    return this.todos(`SELECT t.*, (SELECT COUNT(*) FROM lancamento_tags lt WHERE lt.tag_id = t.id) AS usos
      FROM tags t ORDER BY t.nome COLLATE NOCASE`);
  }
  renomearTag(id, nome) {
    nome = texto(nome, 'o nome da tag').replace(/^#/, '');
    return this.transacao(() => {
      if (this.um('SELECT id FROM tags WHERE nome = ? AND id <> ?', [nome, id])) throw new Error('Já existe uma tag com esse nome.');
      this.db.run('UPDATE tags SET nome = ? WHERE id = ?', [nome, id]);
      return true;
    });
  }
  excluirTag(id) {
    return this.transacao(() => { this.db.run('DELETE FROM tags WHERE id = ?', [id]); return true; });
  }
  definirTags(lancamentoId, tags) {
    const nomes = [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(','))
      .map(t => t.trim().replace(/^#/, '')).filter(Boolean))];
    this.db.run('DELETE FROM lancamento_tags WHERE lancamento_id = ?', [lancamentoId]);
    for (const nome of nomes) {
      let tag = this.um('SELECT id FROM tags WHERE nome = ?', [nome]);
      const tagId = tag ? tag.id : this.exec('INSERT INTO tags (nome) VALUES (?)', [nome]);
      this.db.run('INSERT OR IGNORE INTO lancamento_tags (lancamento_id, tag_id) VALUES (?, ?)', [lancamentoId, tagId]);
    }
  }

  // ---------- Contas ----------
  // Saldo de cada conta. "ate" (data) limita o previsto; efetivado = só o que está pago.
  saldosContas({ ate, previsto } = {}) {
    const p = [];
    let filtro = 'pago = 1';
    if (previsto) { filtro = '(pago = 1 OR data <= ?)'; p.push(ate); }
    const linhas = this.todos(`
      SELECT conta, SUM(efeito) AS total FROM (
        SELECT conta_id AS conta,
          CASE tipo WHEN 'receita' THEN valor WHEN 'ajuste' THEN valor ELSE -valor END AS efeito, pago, data
        FROM lancamentos
        WHERE cancelado = 0 AND conta_id IS NOT NULL AND NOT (cartao_id IS NOT NULL AND tipo IN ('receita', 'despesa'))
        UNION ALL
        SELECT conta_destino_id, valor, pago, data FROM lancamentos
        WHERE cancelado = 0 AND tipo = 'transferencia'
      ) WHERE ${filtro} GROUP BY conta`, p);
    const saldos = Object.fromEntries(linhas.map(l => [l.conta, l.total]));
    if (previsto) {
      // Faturas ainda não pagas que vencem até a data saem da conta de pagamento do cartão.
      const padrao = this.contaPadrao();
      for (const f of this.faturasPendentes(ate)) {
        const conta = f.conta_pagamento_id || padrao;
        saldos[conta] = (saldos[conta] || 0) - f.restante;
      }
    }
    return saldos;
  }

  contaPadrao() {
    const c = this.um('SELECT id FROM contas WHERE ativo = 1 ORDER BY id LIMIT 1');
    return c ? c.id : null;
  }

  listarContas({ incluirInativas, ate } = {}) {
    ate = ate || dataNoMes(this.mesAtual(), 31);
    const atual = this.saldosContas();
    const prev = this.saldosContas({ ate, previsto: true });
    return this.todos(`SELECT c.*, (SELECT COUNT(*) FROM lancamentos l WHERE l.conta_id = c.id OR l.conta_destino_id = c.id) AS usos
      FROM contas c ${incluirInativas ? '' : 'WHERE c.ativo = 1'} ORDER BY c.ativo DESC, c.id`)
      .map(c => ({ ...c, saldo_atual: c.saldo_inicial + (atual[c.id] || 0), saldo_previsto: c.saldo_inicial + (prev[c.id] || 0) }));
  }

  salvarConta({ id, nome, tipo, saldo_inicial }) {
    nome = texto(nome, 'o nome da conta');
    if (!TIPOS_CONTA.includes(tipo)) throw new Error('Tipo de conta inválido.');
    const inicial = Math.round(Number(saldo_inicial || 0));
    if (!Number.isFinite(inicial)) throw new Error('Saldo inicial inválido.');
    return this.transacao(() => {
      if (id) {
        this.db.run('UPDATE contas SET nome = ?, tipo = ?, saldo_inicial = ? WHERE id = ?', [nome, tipo, inicial, id]);
        return id;
      }
      return this.exec('INSERT INTO contas (nome, tipo, saldo_inicial) VALUES (?, ?, ?)', [nome, tipo, inicial]);
    });
  }

  excluirConta(id) {
    return this.transacao(() => {
      const ativas = this.um('SELECT COUNT(*) AS n FROM contas WHERE ativo = 1').n;
      if (ativas <= 1) throw new Error('É preciso ter pelo menos uma conta.');
      const usada = this.um(`SELECT
        (SELECT COUNT(*) FROM lancamentos WHERE conta_id = ? OR conta_destino_id = ?) +
        (SELECT COUNT(*) FROM recorrentes WHERE conta_id = ? AND (fim IS NULL OR fim >= ?)) AS n`,
      [id, id, id, this.mesAtual()]).n;
      this.db.run('UPDATE cartoes SET conta_pagamento_id = NULL WHERE conta_pagamento_id = ?', [id]);
      if (usada) this.db.run('UPDATE contas SET ativo = 0 WHERE id = ?', [id]);
      else this.db.run('DELETE FROM contas WHERE id = ?', [id]);
      return true;
    });
  }

  // Ajusta o saldo para bater com o extrato do banco, criando um lançamento de ajuste.
  ajustarSaldo({ conta_id, saldo_real, data }) {
    const real = Math.round(Number(saldo_real));
    if (!Number.isFinite(real)) throw new Error('Saldo inválido.');
    data = validarData(data || this.hoje());
    const conta = this.listarContas({ incluirInativas: true }).find(c => c.id === Number(conta_id));
    if (!conta) throw new Error('Conta não encontrada.');
    const diff = real - conta.saldo_atual;
    if (diff === 0) throw new Error('O saldo já está igual ao informado.');
    return this.transacao(() => this.exec(`INSERT INTO lancamentos (tipo, descricao, valor, data, competencia, pago, conta_id)
      VALUES ('ajuste', 'Ajuste de saldo', ?, ?, ?, 1, ?)`, [diff, data, data.slice(0, 7), conta.id]));
  }

  transferir({ id, de, para, valor, data, descricao, pago = true }) {
    de = idOuNulo(de); para = idOuNulo(para);
    if (!de || !para) throw new Error('Escolha as duas contas.');
    if (de === para) throw new Error('As contas de origem e destino devem ser diferentes.');
    valor = validarValor(valor);
    data = validarData(data);
    descricao = texto(descricao) || 'Transferência';
    return this.transacao(() => {
      if (id) {
        this.db.run(`UPDATE lancamentos SET conta_id = ?, conta_destino_id = ?, valor = ?, data = ?, competencia = ?,
          descricao = ?, pago = ? WHERE id = ? AND tipo = 'transferencia'`,
        [de, para, valor, data, data.slice(0, 7), descricao, pago ? 1 : 0, id]);
        return id;
      }
      return this.exec(`INSERT INTO lancamentos (tipo, descricao, valor, data, competencia, pago, conta_id, conta_destino_id)
        VALUES ('transferencia', ?, ?, ?, ?, ?, ?, ?)`, [descricao, valor, data, data.slice(0, 7), pago ? 1 : 0, de, para]);
    });
  }

  // ---------- Cartões ----------
  cartao(id) {
    const c = this.um('SELECT * FROM cartoes WHERE id = ?', [id]);
    if (!c) throw new Error('Cartão não encontrado.');
    return c;
  }

  listarCartoes({ incluirInativos } = {}) {
    const hoje = this.hoje();
    return this.todos(`SELECT c.*, ct.nome AS conta_pagamento,
        COALESCE((SELECT SUM(CASE l.tipo WHEN 'despesa' THEN l.valor ELSE -l.valor END) FROM lancamentos l
          WHERE l.cartao_id = c.id AND l.cancelado = 0), 0) AS usado
      FROM cartoes c LEFT JOIN contas ct ON ct.id = c.conta_pagamento_id
      ${incluirInativos ? '' : 'WHERE c.ativo = 1'} ORDER BY c.ativo DESC, c.id`)
      .map(c => {
        const atual = faturaDe(hoje, c.dia_fechamento, c.dia_vencimento);
        return {
          ...c,
          usado: Math.max(0, c.usado),
          disponivel: c.limite - Math.max(0, c.usado),
          fatura_atual: this.fatura(c.id, atual, { semItens: true }),
          fatura_anterior: this.fatura(c.id, somarMeses(atual, -1), { semItens: true }),
        };
      });
  }

  salvarCartao({ id, nome, limite, dia_fechamento, dia_vencimento, conta_pagamento_id }) {
    nome = texto(nome, 'o nome do cartão');
    limite = validarValor(limite || 0, { permiteZero: true });
    const fech = validarDia(dia_fechamento, 'O dia de fechamento');
    const venc = validarDia(dia_vencimento, 'O dia de vencimento');
    const conta = idOuNulo(conta_pagamento_id);
    return this.transacao(() => {
      if (id) {
        const antes = this.cartao(id);
        this.db.run(`UPDATE cartoes SET nome = ?, limite = ?, dia_fechamento = ?, dia_vencimento = ?, conta_pagamento_id = ?
          WHERE id = ?`, [nome, limite, fech, venc, conta, id]);
        if (antes.dia_fechamento !== fech || antes.dia_vencimento !== venc) {
          // Recalcula a fatura das compras que ainda não estão em fatura fechada.
          const aberta = faturaDe(this.hoje(), antes.dia_fechamento, antes.dia_vencimento);
          for (const l of this.todos(`SELECT id, data FROM lancamentos WHERE cartao_id = ? AND tipo IN ('despesa','receita')
            AND fatura >= ?`, [id, aberta])) {
            this.db.run('UPDATE lancamentos SET fatura = ? WHERE id = ?', [faturaDe(l.data, fech, venc), l.id]);
          }
        }
        return id;
      }
      return this.exec(`INSERT INTO cartoes (nome, limite, dia_fechamento, dia_vencimento, conta_pagamento_id)
        VALUES (?, ?, ?, ?, ?)`, [nome, limite, fech, venc, conta]);
    });
  }

  excluirCartao(id) {
    return this.transacao(() => {
      const usado = this.um('SELECT COUNT(*) AS n FROM lancamentos WHERE cartao_id = ?', [id]).n
        + this.um('SELECT COUNT(*) AS n FROM recorrentes WHERE cartao_id = ? AND (fim IS NULL OR fim >= ?)', [id, this.mesAtual()]).n;
      if (usado) this.db.run('UPDATE cartoes SET ativo = 0 WHERE id = ?', [id]);
      else this.db.run('DELETE FROM cartoes WHERE id = ?', [id]);
      return true;
    });
  }

  // Situação de uma fatura: aberta (ainda recebendo compras), fechada, paga, parcial ou vencida.
  fatura(cartaoId, mes, { semItens } = {}) {
    validarMes(mes);
    const c = this.cartao(cartaoId);
    const { fechamento, vencimento } = datasFatura(mes, c.dia_fechamento, c.dia_vencimento);
    const tot = this.um(`SELECT
        COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor WHEN tipo = 'receita' THEN -valor END), 0) AS total,
        COALESCE(SUM(CASE WHEN tipo = 'pagamento_fatura' THEN valor END), 0) AS pago
      FROM lancamentos WHERE cartao_id = ? AND fatura = ? AND cancelado = 0`, [cartaoId, mes]);
    const hoje = this.hoje();
    const restante = Math.max(0, tot.total - tot.pago);
    let status;
    if (hoje < fechamento) status = 'aberta';
    else if (tot.total <= 0 || restante === 0) status = 'paga';
    else if (hoje > vencimento) status = 'vencida';
    else if (tot.pago > 0) status = 'parcial';
    else status = 'fechada';
    if (status === 'aberta' && tot.total > 0 && restante === 0) status = 'paga';
    const r = { cartao_id: c.id, cartao: c.nome, mes, fechamento, vencimento, total: tot.total, pago: tot.pago, restante, status };
    if (!semItens) {
      r.itens = this.todos(`SELECT l.*, ${SQL_NOME_CATEGORIA} AS categoria, ${SQL_TAGS} AS tags FROM lancamentos l ${JOIN_CATEGORIA}
        WHERE l.cartao_id = ? AND l.fatura = ? AND l.cancelado = 0 AND l.tipo IN ('despesa','receita') ORDER BY l.data, l.id`, [cartaoId, mes]);
      r.pagamentos = this.todos(`SELECT l.*, ct.nome AS conta FROM lancamentos l LEFT JOIN contas ct ON ct.id = l.conta_id
        WHERE l.cartao_id = ? AND l.fatura = ? AND l.tipo = 'pagamento_fatura' AND l.cancelado = 0 ORDER BY l.data`, [cartaoId, mes]);
    }
    return r;
  }

  historicoFaturas(cartaoId, ateMes, meses = 12) {
    const r = [];
    for (let i = meses - 1; i >= 0; i--) {
      const f = this.fatura(cartaoId, somarMeses(ateMes, -i), { semItens: true });
      r.push({ mes: f.mes, total: f.total, status: f.status });
    }
    return r;
  }

  // Faturas com valor em aberto que vencem até a data (para saldo previsto e alertas).
  faturasPendentes(ate) {
    const r = [];
    const grupos = this.todos(`SELECT DISTINCT cartao_id, fatura FROM lancamentos
      WHERE cartao_id IS NOT NULL AND fatura IS NOT NULL AND cancelado = 0`);
    for (const g of grupos) {
      const c = this.um('SELECT * FROM cartoes WHERE id = ?', [g.cartao_id]);
      if (!c) continue;
      if (datasFatura(g.fatura, c.dia_fechamento, c.dia_vencimento).vencimento > ate) continue;
      const f = this.fatura(g.cartao_id, g.fatura, { semItens: true });
      if (f.restante > 0) r.push({ ...f, conta_pagamento_id: c.conta_pagamento_id });
    }
    return r.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  // Faturas que vencem no mês (todas, pagas ou não), para o painel.
  faturasDoMes(mes) {
    return this.listarCartoes().map(c => this.fatura(c.id, mes, { semItens: true }))
      .filter(f => f.total > 0 || f.pago > 0);
  }

  pagarFatura({ cartao_id, fatura, conta_id, valor, data }) {
    const c = this.cartao(cartao_id);
    validarMes(fatura);
    valor = validarValor(valor);
    data = validarData(data || this.hoje());
    conta_id = idOuNulo(conta_id) || c.conta_pagamento_id || this.contaPadrao();
    if (!this.um('SELECT id FROM contas WHERE id = ?', [conta_id])) throw new Error('Escolha a conta de onde sai o pagamento.');
    return this.transacao(() => this.exec(`INSERT INTO lancamentos (tipo, descricao, valor, data, competencia, pago, conta_id, cartao_id, fatura)
      VALUES ('pagamento_fatura', ?, ?, ?, ?, 1, ?, ?, ?)`,
    [`Fatura ${c.nome}`, valor, data, data.slice(0, 7), conta_id, c.id, fatura]));
  }

  // ---------- Recorrentes (salário, contas fixas, assinaturas) ----------
  listarRecorrentes({ tipo } = {}) {
    const hoje = this.mesAtual();
    return this.todos(`
      SELECT r.*, ${SQL_NOME_CATEGORIA.replace(/l\./g, 'r.')} AS categoria, ct.nome AS conta, cr.nome AS cartao
      FROM recorrentes r
      LEFT JOIN categorias c ON c.id = r.categoria_id LEFT JOIN categorias cp ON cp.id = c.pai_id
      LEFT JOIN contas ct ON ct.id = r.conta_id LEFT JOIN cartoes cr ON cr.id = r.cartao_id
      WHERE (r.fim IS NULL OR r.fim >= ?) ${tipo ? 'AND r.tipo = ?' : ''}
      ORDER BY r.tipo DESC, r.dia, r.descricao COLLATE NOCASE`, tipo ? [hoje, tipo] : [hoje]);
  }

  // Valida e resolve "onde": conta ou cartão (cartão só para despesas).
  resolverDestino(tipo, conta_id, cartao_id) {
    conta_id = idOuNulo(conta_id);
    cartao_id = idOuNulo(cartao_id);
    if (cartao_id) {
      if (tipo !== 'despesa' && tipo !== 'receita') throw new Error('Cartão só pode ter compras ou estornos.');
      const c = this.cartao(cartao_id);
      if (!c.ativo) throw new Error('Este cartão está desativado.');
      return { conta_id: null, cartao: c };
    }
    if (!conta_id) throw new Error('Escolha a conta.');
    if (!this.um('SELECT id FROM contas WHERE id = ?', [conta_id])) throw new Error('Conta não encontrada.');
    return { conta_id, cartao: null };
  }

  salvarRecorrente(r) {
    const tipo = r.tipo;
    if (!['despesa', 'receita'].includes(tipo)) throw new Error('Tipo inválido.');
    const descricao = texto(r.descricao, 'a descrição');
    const valor = validarValor(r.valor);
    const dia = validarDia(r.dia);
    const periodicidade = Number(r.periodicidade || 1);
    if (!PERIODOS.includes(periodicidade)) throw new Error('Periodicidade inválida.');
    const categoriaId = this.validarCategoria(r.categoria_id, tipo);
    const destino = this.resolverDestino(tipo, r.conta_id, r.cartao_id);
    const cartaoId = destino.cartao ? destino.cartao.id : null;
    const hoje = this.mesAtual();

    return this.transacao(() => {
      if (r.id) {
        const atual = this.um('SELECT * FROM recorrentes WHERE id = ?', [r.id]);
        if (!atual) throw new Error('Cadastro não encontrado.');
        this.db.run(`UPDATE recorrentes SET descricao = ?, categoria_id = ?, valor = ?, dia = ?, conta_id = ?, cartao_id = ?,
          periodicidade = ? WHERE id = ?`, [descricao, categoriaId, valor, dia, destino.conta_id, cartaoId, periodicidade, r.id]);
        // Atualiza os lançamentos deste mês em diante que ainda não aconteceram.
        const pendentes = this.todos(`SELECT id, competencia FROM lancamentos
          WHERE recorrente_id = ? AND competencia >= ? AND cancelado = 0
            AND (pago = 0 OR (cartao_id IS NOT NULL AND data > ?))`, [r.id, hoje, this.hoje()]);
        for (const l of pendentes) {
          const data = dataNoMes(l.competencia, dia);
          const fatura = destino.cartao ? faturaDe(data, destino.cartao.dia_fechamento, destino.cartao.dia_vencimento) : null;
          this.db.run(`UPDATE lancamentos SET descricao = ?, categoria_id = ?, valor = ?, data = ?, conta_id = ?, cartao_id = ?,
            fatura = ?, pago = ? WHERE id = ?`,
          [descricao, categoriaId, valor, data, destino.conta_id, cartaoId, fatura, cartaoId ? 1 : 0, l.id]);
        }
        return r.id;
      }
      const inicio = r.inicio ? validarMes(r.inicio) : hoje;
      return this.exec(`INSERT INTO recorrentes (tipo, descricao, categoria_id, valor, dia, inicio, conta_id, cartao_id, periodicidade)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, descricao, categoriaId, valor, dia, inicio, destino.conta_id, cartaoId, periodicidade]);
    });
  }

  // Encerra: para de gerar a partir deste mês e apaga o que ainda não aconteceu.
  encerrarRecorrente(id) {
    return this.transacao(() => {
      const r = this.um('SELECT * FROM recorrentes WHERE id = ?', [id]);
      if (!r) throw new Error('Cadastro não encontrado.');
      const hoje = this.mesAtual();
      this.db.run(`DELETE FROM lancamentos WHERE recorrente_id = ? AND competencia >= ?
        AND (pago = 0 OR (cartao_id IS NOT NULL AND data > ?))`, [id, hoje, this.hoje()]);
      let fim = somarMeses(hoje, -1);
      const ultimo = this.um('SELECT MAX(competencia) AS m FROM lancamentos WHERE recorrente_id = ? AND cancelado = 0', [id]).m;
      if (ultimo && ultimo > fim) fim = ultimo;
      if (fim < r.inicio && !this.um('SELECT COUNT(*) AS n FROM lancamentos WHERE recorrente_id = ?', [id]).n) {
        this.db.run('DELETE FROM recorrentes WHERE id = ?', [id]);
        return true;
      }
      this.db.run('UPDATE recorrentes SET fim = ? WHERE id = ?', [fim, id]);
      return true;
    });
  }

  // Cria os lançamentos automáticos do mês (salário, contas fixas, assinaturas), se ainda não existirem.
  gerarMes(mes) {
    validarMes(mes);
    const faltando = this.todos(`
      SELECT r.*, c.dia_fechamento, c.dia_vencimento FROM recorrentes r LEFT JOIN cartoes c ON c.id = r.cartao_id
      WHERE r.inicio <= ? AND (r.fim IS NULL OR r.fim >= ?)
        AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.recorrente_id = r.id AND l.competencia = ?)`,
    [mes, mes, mes]).filter(r => diffMeses(r.inicio, mes) % (r.periodicidade || 1) === 0);
    if (!faltando.length) return 0;
    this.transacao(() => {
      for (const r of faltando) {
        const data = dataNoMes(mes, r.dia);
        const fatura = r.cartao_id ? faturaDe(data, r.dia_fechamento, r.dia_vencimento) : null;
        this.db.run(`INSERT INTO lancamentos (tipo, descricao, categoria_id, valor, data, competencia, pago, recorrente_id,
            conta_id, cartao_id, fatura)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.tipo, r.descricao, r.categoria_id, r.valor, data, mes, r.cartao_id ? 1 : 0, r.id, r.conta_id, r.cartao_id, fatura]);
      }
    });
    return faltando.length;
  }

  gerarPeriodo(de, ate) {
    let m = de.slice(0, 7);
    const fim = ate.slice(0, 7);
    for (let i = 0; m <= fim && i < 60; i++, m = somarMeses(m, 1)) this.gerarMes(m);
  }

  // ---------- Lançamentos ----------
  listarLancamentos(f = {}) {
    let de, ate;
    if (f.de || f.ate) {
      de = validarData(f.de || '2000-01-01');
      ate = validarData(f.ate || '2100-12-31');
    } else {
      const mes = validarMes(f.mes || this.mesAtual());
      de = `${mes}-01`;
      ate = dataNoMes(mes, 31);
    }
    if (f.de && f.ate) this.gerarPeriodo(de, ate);
    else if (!f.de && !f.ate) this.gerarMes(de.slice(0, 7));

    const onde = ['l.cancelado = 0'];
    const p = [];
    // Compras de cartão filtradas pela fatura quando o filtro é o próprio cartão.
    if (f.cartao_id && f.porFatura) { onde.push('l.fatura BETWEEN ? AND ?'); p.push(de.slice(0, 7), ate.slice(0, 7)); }
    else { onde.push('l.data BETWEEN ? AND ?'); p.push(de, ate); }
    if (f.tipo === 'despesa' || f.tipo === 'receita') { onde.push('l.tipo = ?'); p.push(f.tipo); }
    if (f.tipo === 'movimentacao') onde.push(`l.tipo IN ('transferencia','ajuste','pagamento_fatura')`);
    if (f.conta_id) { onde.push('(l.conta_id = ? OR l.conta_destino_id = ?)'); p.push(f.conta_id, f.conta_id); }
    if (f.cartao_id) { onde.push(`l.cartao_id = ? AND l.tipo IN ('despesa','receita')`); p.push(f.cartao_id); }
    if (f.categoria_id) { onde.push('(l.categoria_id = ? OR c.pai_id = ?)'); p.push(f.categoria_id, f.categoria_id); }
    if (f.tag_id) { onde.push('EXISTS (SELECT 1 FROM lancamento_tags lt WHERE lt.lancamento_id = l.id AND lt.tag_id = ?)'); p.push(f.tag_id); }
    if (f.situacao === 'pendente') onde.push('l.pago = 0');
    if (f.situacao === 'pago') onde.push('l.pago = 1');
    if (f.busca) { onde.push('(l.descricao LIKE ? OR l.obs LIKE ?)'); p.push(`%${f.busca}%`, `%${f.busca}%`); }
    return this.todos(`
      SELECT l.*, ${SQL_NOME_CATEGORIA} AS categoria, ct.nome AS conta, cd.nome AS conta_destino, cr.nome AS cartao,
        ${SQL_TAGS} AS tags,
        (SELECT COUNT(*) FROM anexos a WHERE a.lancamento_id = l.id) AS anexos
      FROM lancamentos l ${JOIN_CATEGORIA}
        LEFT JOIN contas ct ON ct.id = l.conta_id LEFT JOIN contas cd ON cd.id = l.conta_destino_id
        LEFT JOIN cartoes cr ON cr.id = l.cartao_id
      WHERE ${onde.join(' AND ')}
      ORDER BY l.data, l.id`, p);
  }

  lancamento(id) {
    const l = this.um('SELECT * FROM lancamentos WHERE id = ?', [id]);
    if (!l) throw new Error('Lançamento não encontrado.');
    return l;
  }

  // Cria ou edita uma receita/despesa. Na criação, "parcelas" > 1 divide o valor em meses seguidos.
  salvarLancamento(l) {
    const tipo = l.tipo;
    if (!['despesa', 'receita'].includes(tipo)) throw new Error('Tipo inválido.');
    const descricao = texto(l.descricao, 'a descrição');
    const valor = validarValor(l.valor);
    const data = validarData(l.data);
    const categoriaId = this.validarCategoria(l.categoria_id, tipo);
    const destino = this.resolverDestino(tipo, l.conta_id, l.cartao_id);
    const cartao = destino.cartao;
    const obs = texto(l.obs);
    const fatura = d => (cartao ? faturaDe(d, cartao.dia_fechamento, cartao.dia_vencimento) : null);

    return this.transacao(() => {
      if (l.id) {
        const atual = this.lancamento(l.id);
        const competencia = atual.recorrente_id ? atual.competencia : data.slice(0, 7);
        this.db.run(`UPDATE lancamentos SET descricao = ?, categoria_id = ?, valor = ?, data = ?, competencia = ?, pago = ?,
          obs = ?, conta_id = ?, cartao_id = ?, fatura = ? WHERE id = ?`,
        [descricao, categoriaId, valor, data, competencia, cartao || l.pago ? 1 : 0, obs, destino.conta_id,
          cartao ? cartao.id : null, fatura(data), l.id]);
        if (l.tags !== undefined) this.definirTags(l.id, l.tags);
        return l.id;
      }
      const n = Math.round(Number(l.parcelas || 1));
      if (!(n >= 1 && n <= 120)) throw new Error('Número de parcelas deve ser entre 1 e 120.');
      // Divide em centavos; a sobra da divisão vai na primeira parcela.
      const base = Math.floor(valor / n);
      // Compra antiga já em andamento: "data" é a data da compra e só são criadas as parcelas a partir de "parcela_inicial".
      const inicial = Math.round(Number(l.parcela_inicial || 1));
      if (!(inicial >= 1 && inicial <= n)) throw new Error(`A parcela inicial deve ser entre 1 e ${n}.`);
      const ids = [];
      for (let i = inicial - 1; i < n; i++) {
        const v = i === 0 ? valor - base * (n - 1) : base;
        if (v <= 0) throw new Error('Valor pequeno demais para tantas parcelas.');
        const d = i === 0 ? data : dataNoMes(somarMeses(data.slice(0, 7), i), Number(data.slice(8)));
        const pago = cartao ? 1 : (i === inicial - 1 && l.pago ? 1 : 0);
        const desc = n > 1 ? `${descricao} (${i + 1}/${n})` : descricao;
        const id = this.exec(`INSERT INTO lancamentos (tipo, descricao, categoria_id, valor, data, competencia, pago, obs,
            conta_id, cartao_id, fatura, parcela_grupo, parcela_num, parcela_total, importacao_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tipo, desc, categoriaId, v, d, d.slice(0, 7), pago, obs, destino.conta_id, cartao ? cartao.id : null, fatura(d),
          n > 1 ? (ids[0] || null) : null, n > 1 ? i + 1 : null, n > 1 ? n : null, l.importacao_id || null]);
        if (n > 1 && !ids.length) this.db.run('UPDATE lancamentos SET parcela_grupo = ? WHERE id = ?', [id, id]);
        if (l.tags) this.definirTags(id, l.tags);
        ids.push(id);
      }
      return ids[0];
    });
  }

  marcarPago(id, pago) {
    return this.transacao(() => {
      this.db.run('UPDATE lancamentos SET pago = ? WHERE id = ? AND cartao_id IS NULL', [pago ? 1 : 0, id]);
      return true;
    });
  }

  // escopo: 'este' ou 'proximos' (esta parcela e as seguintes).
  excluirLancamento(id, escopo = 'este') {
    return this.transacao(() => {
      const l = this.lancamento(id);
      const alvos = escopo === 'proximos' && l.parcela_grupo
        ? this.todos('SELECT * FROM lancamentos WHERE parcela_grupo = ? AND parcela_num >= ?', [l.parcela_grupo, l.parcela_num])
        : [l];
      for (const a of alvos) {
        this.removerArquivosAnexos(a.id);
        // Automático: marca como removido para não ser recriado no mesmo mês.
        if (a.recorrente_id) this.db.run('UPDATE lancamentos SET cancelado = 1 WHERE id = ?', [a.id]);
        else this.db.run('DELETE FROM lancamentos WHERE id = ?', [a.id]);
      }
      return alvos.length;
    });
  }

  // ---------- Anexos ----------
  listarAnexos(lancamentoId) {
    return this.todos('SELECT * FROM anexos WHERE lancamento_id = ? ORDER BY id', [lancamentoId]);
  }
  anexo(id) {
    const a = this.um('SELECT * FROM anexos WHERE id = ?', [id]);
    if (!a) throw new Error('Anexo não encontrado.');
    return a;
  }
  caminhoAnexo(id) {
    return path.join(this.pastaAnexos, this.anexo(id).arquivo);
  }
  // Navegador: o arquivo é guardado fora do banco; aqui só fica o registro.
  registrarAnexo(lancamentoId, nome, arquivo) {
    this.lancamento(lancamentoId);
    return this.transacao(() => this.exec('INSERT INTO anexos (lancamento_id, nome, arquivo) VALUES (?, ?, ?)', [lancamentoId, nome, arquivo]));
  }
  adicionarAnexo(lancamentoId, origem) {
    this.lancamento(lancamentoId);
    if (!fs.existsSync(origem)) throw new Error('Arquivo não encontrado.');
    if (fs.statSync(origem).size > 25 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 25 MB).');
    fs.mkdirSync(this.pastaAnexos, { recursive: true });
    const nome = path.basename(origem);
    const arquivo = `${lancamentoId}-${Date.now()}${path.extname(nome).toLowerCase()}`;
    fs.copyFileSync(origem, path.join(this.pastaAnexos, arquivo));
    return this.transacao(() => this.exec('INSERT INTO anexos (lancamento_id, nome, arquivo) VALUES (?, ?, ?)', [lancamentoId, nome, arquivo]));
  }
  removerAnexo(id) {
    const a = this.anexo(id);
    this.transacao(() => this.db.run('DELETE FROM anexos WHERE id = ?', [id]));
    this.apagarArquivoAnexo(a.arquivo);
    return true;
  }
  apagarArquivoAnexo(arquivo) {
    if (this.aoRemoverAnexo) { this.aoRemoverAnexo(arquivo); return; }
    if (fs && this.pastaAnexos) {
      try { fs.unlinkSync(path.join(this.pastaAnexos, arquivo)); } catch { /* arquivo já não existe */ }
    }
  }
  removerArquivosAnexos(lancamentoId) {
    for (const a of this.listarAnexos(lancamentoId)) this.apagarArquivoAnexo(a.arquivo);
  }
  // Tem algum dado lançado? (para decidir o que fazer na primeira sincronização)
  temDados() {
    return this.um(`SELECT (SELECT COUNT(*) FROM lancamentos) + (SELECT COUNT(*) FROM recorrentes) + (SELECT COUNT(*) FROM metas)
      + (SELECT COUNT(*) FROM cartoes) + (SELECT COUNT(*) FROM contas WHERE saldo_inicial <> 0) AS n`).n > 0;
  }
  exportar() { return this.db.export(); }

  // ---------- Orçamento ----------
  listarOrcamento(mes) {
    mes = validarMes(mes || this.mesAtual());
    this.gerarMes(mes);
    return this.todos(`
      SELECT c.id, c.nome, o.valor AS teto,
        COALESCE((SELECT SUM(l.valor) FROM lancamentos l LEFT JOIN categorias lc ON lc.id = l.categoria_id
          WHERE l.tipo = 'despesa' AND l.cancelado = 0 AND l.competencia = ?
            AND (l.categoria_id = c.id OR lc.pai_id = c.id)), 0) AS gasto
      FROM categorias c LEFT JOIN orcamentos o ON o.categoria_id = c.id
      WHERE c.tipo = 'despesa' AND c.pai_id IS NULL AND (c.ativo = 1 OR o.valor IS NOT NULL)
      ORDER BY o.valor IS NULL, c.nome COLLATE NOCASE`, [mes]);
  }
  definirOrcamento(categoriaId, valor) {
    const v = Math.round(Number(valor || 0));
    if (!Number.isFinite(v) || v < 0) throw new Error('Valor inválido.');
    return this.transacao(() => {
      if (v === 0) this.db.run('DELETE FROM orcamentos WHERE categoria_id = ?', [categoriaId]);
      else this.db.run('INSERT OR REPLACE INTO orcamentos (categoria_id, valor) VALUES (?, ?)', [categoriaId, v]);
      return true;
    });
  }

  // ---------- Metas ----------
  listarMetas() {
    const hoje = this.hoje();
    return this.todos(`SELECT m.*, COALESCE((SELECT SUM(valor) FROM metas_movs WHERE meta_id = m.id), 0) AS acumulado
      FROM metas m ORDER BY m.prazo IS NULL, m.prazo, m.id`).map(m => {
      const falta = Math.max(0, m.valor_alvo - m.acumulado);
      let meses = null, porMes = null;
      if (m.prazo && falta > 0) {
        meses = Math.max(1, diffMeses(hoje.slice(0, 7), m.prazo.slice(0, 7)) + (m.prazo.slice(8) >= hoje.slice(8) ? 1 : 0));
        porMes = Math.ceil(falta / meses);
      }
      return { ...m, falta, meses, por_mes: porMes, atrasada: !!(m.prazo && m.prazo < hoje && falta > 0) };
    });
  }
  salvarMeta({ id, nome, valor_alvo, prazo }) {
    nome = texto(nome, 'o nome da meta');
    valor_alvo = validarValor(valor_alvo);
    prazo = prazo ? validarData(prazo) : null;
    return this.transacao(() => {
      if (id) { this.db.run('UPDATE metas SET nome = ?, valor_alvo = ?, prazo = ? WHERE id = ?', [nome, valor_alvo, prazo, id]); return id; }
      return this.exec('INSERT INTO metas (nome, valor_alvo, prazo) VALUES (?, ?, ?)', [nome, valor_alvo, prazo]);
    });
  }
  excluirMeta(id) {
    return this.transacao(() => { this.db.run('DELETE FROM metas WHERE id = ?', [id]); return true; });
  }
  movimentarMeta({ meta_id, valor, data, obs, retirada }) {
    let v = validarValor(valor);
    if (retirada) v = -v;
    data = validarData(data || this.hoje());
    const m = this.listarMetas().find(x => x.id === Number(meta_id));
    if (!m) throw new Error('Meta não encontrada.');
    if (m.acumulado + v < 0) throw new Error('Não dá para retirar mais do que está guardado.');
    return this.transacao(() => this.exec('INSERT INTO metas_movs (meta_id, valor, data, obs) VALUES (?, ?, ?, ?)',
      [meta_id, v, data, texto(obs)]));
  }
  movimentosMeta(id) {
    return this.todos('SELECT * FROM metas_movs WHERE meta_id = ? ORDER BY data DESC, id DESC', [id]);
  }
  excluirMovimentoMeta(id) {
    return this.transacao(() => { this.db.run('DELETE FROM metas_movs WHERE id = ?', [id]); return true; });
  }

  // ---------- Painel e alertas ----------
  resumoMes(mes) {
    mes = validarMes(mes || this.mesAtual());
    this.gerarMes(mes);
    const fimMes = dataNoMes(mes, 31);
    const tot = this.um(`SELECT
        COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS receitas,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND pago = 1 THEN valor END), 0) AS recebido,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS despesas,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND pago = 1 AND cartao_id IS NULL THEN valor END), 0) AS pago,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND cartao_id IS NOT NULL THEN valor END), 0) AS no_cartao,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND recorrente_id IS NOT NULL THEN valor END), 0) AS fixas
      FROM lancamentos WHERE competencia = ? AND cancelado = 0`, [mes]);
    const porCategoria = this.todos(`
      SELECT top.id, COALESCE(top.nome, 'Sem categoria') AS categoria, SUM(l.valor) AS total, COUNT(*) AS qtd
      FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
        LEFT JOIN categorias top ON top.id = COALESCE(c.pai_id, c.id)
      WHERE l.competencia = ? AND l.cancelado = 0 AND l.tipo = 'despesa'
      GROUP BY top.id ORDER BY total DESC`, [mes]);
    const aPagar = this.todos(`
      SELECT l.*, ${SQL_NOME_CATEGORIA} AS categoria, ct.nome AS conta FROM lancamentos l ${JOIN_CATEGORIA}
        LEFT JOIN contas ct ON ct.id = l.conta_id
      WHERE l.competencia = ? AND l.cancelado = 0 AND l.tipo = 'despesa' AND l.pago = 0 AND l.cartao_id IS NULL
      ORDER BY l.data LIMIT 10`, [mes]);
    const contas = this.listarContas({ ate: fimMes });
    const saldoAtual = contas.reduce((s, c) => s + c.saldo_atual, 0);
    const saldoPrevisto = contas.reduce((s, c) => s + c.saldo_previsto, 0);
    const orcamento = this.listarOrcamento(mes).filter(o => o.teto);
    return {
      mes, ...tot, saldo: tot.receitas - tot.despesas, saldoAtual, saldoPrevisto, fimMes,
      porCategoria, aPagar, contas, faturas: this.faturasDoMes(mes), orcamento,
      metas: this.listarMetas().slice(0, 4), alertas: this.alertas(),
    };
  }

  // Receitas x despesas dos últimos N meses (terminando no mês informado).
  historico(mes, meses = 12) {
    mes = validarMes(mes || this.mesAtual());
    const inicio = somarMeses(mes, -(meses - 1));
    const linhas = this.todos(`
      SELECT competencia,
        COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS receitas,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS despesas
      FROM lancamentos WHERE competencia BETWEEN ? AND ? AND cancelado = 0
      GROUP BY competencia`, [inicio, mes]);
    const porMes = Object.fromEntries(linhas.map(l => [l.competencia, l]));
    const r = [];
    for (let i = 0; i < meses; i++) {
      const m = somarMeses(inicio, i);
      r.push({ mes: m, receitas: porMes[m]?.receitas || 0, despesas: porMes[m]?.despesas || 0 });
    }
    return r;
  }

  // Saldo da conta no fim de cada um dos últimos N meses (efetivado).
  historicoConta(contaId, mes, meses = 12) {
    const conta = this.um('SELECT * FROM contas WHERE id = ?', [contaId]);
    if (!conta) throw new Error('Conta não encontrada.');
    const r = [];
    for (let i = meses - 1; i >= 0; i--) {
      const m = somarMeses(mes, -i);
      const fim = dataNoMes(m, 31);
      const s = this.um(`SELECT COALESCE(SUM(efeito), 0) AS t FROM (
          SELECT CASE tipo WHEN 'receita' THEN valor WHEN 'ajuste' THEN valor ELSE -valor END AS efeito FROM lancamentos
          WHERE cancelado = 0 AND pago = 1 AND conta_id = ? AND data <= ?
            AND NOT (cartao_id IS NOT NULL AND tipo IN ('receita','despesa'))
          UNION ALL
          SELECT valor FROM lancamentos WHERE cancelado = 0 AND pago = 1 AND tipo = 'transferencia' AND conta_destino_id = ? AND data <= ?)`,
      [contaId, fim, contaId, fim]).t;
      r.push({ mes: m, saldo: conta.saldo_inicial + s });
    }
    return r;
  }

  // Projeção do saldo dia a dia, de hoje até "ate": parte do saldo atual das contas e aplica, na data de cada um,
  // o que ainda vai entrar ou sair (contas pendentes, fixos dos próximos meses, faturas dos cartões no vencimento).
  // O que está atrasado entra hoje. Transferências entre contas não mudam o total e ficam de fora.
  projecao(ate) {
    const hoje = this.hoje();
    ate = validarData(ate);
    if (ate < hoje) throw new Error('Escolha uma data a partir de hoje.');
    this.gerarPeriodo(hoje, ate);
    const contas = this.listarContas();
    const inicio = contas.reduce((s, c) => s + c.saldo_atual, 0);
    const eventos = [];
    for (const l of this.todos(`SELECT l.id, l.tipo, l.descricao, l.valor, l.data, ct.nome AS conta FROM lancamentos l
        LEFT JOIN contas ct ON ct.id = l.conta_id
      WHERE l.cancelado = 0 AND l.pago = 0 AND l.cartao_id IS NULL AND l.tipo IN ('despesa','receita') AND l.data <= ?`, [ate])) {
      eventos.push({ data: l.data < hoje ? hoje : l.data, original: l.data, atrasado: l.data < hoje, tipo: l.tipo,
        descricao: l.descricao, conta: l.conta, valor: l.tipo === 'receita' ? l.valor : -l.valor, lancamento_id: l.id });
    }
    for (const f of this.faturasPendentes(ate)) {
      eventos.push({ data: f.vencimento < hoje ? hoje : f.vencimento, original: f.vencimento, atrasado: f.vencimento < hoje, tipo: 'fatura',
        descricao: `Fatura ${f.cartao} (${f.mes.slice(5)}/${f.mes.slice(0, 4)})`, valor: -f.restante, cartao_id: f.cartao_id, mes: f.mes });
    }
    // No mesmo dia, entradas antes das saídas (o salário costuma cair cedo).
    eventos.sort((a, b) => a.data.localeCompare(b.data) || b.valor - a.valor);
    let saldo = inicio;
    for (const e of eventos) { saldo += e.valor; e.saldo = saldo; }
    // Saldo no fim de cada dia (para o gráfico) e o ponto mais baixo.
    const dias = [];
    let i = 0, corrente = inicio, minimo = { data: hoje, saldo: inicio };
    for (let d = hoje; d <= ate; d = somarDias(d, 1)) {
      while (i < eventos.length && eventos[i].data === d) corrente = eventos[i++].saldo;
      dias.push({ data: d, saldo: corrente });
      if (corrente < minimo.saldo) minimo = { data: d, saldo: corrente };
    }
    return {
      hoje, ate, inicio, fim: corrente, minimo, eventos, dias,
      entradas: eventos.filter(e => e.valor > 0).reduce((s, e) => s + e.valor, 0),
      saidas: -eventos.filter(e => e.valor < 0).reduce((s, e) => s + e.valor, 0),
      falta: Math.max(0, -minimo.saldo),
    };
  }

  // Avisos: contas vencidas/vencendo, faturas, orçamento estourado ou perto do limite.
  alertas() {
    const hoje = this.hoje();
    const em3 = somarDias(hoje, 3);
    this.gerarMes(this.mesAtual());
    this.gerarMes(somarMeses(this.mesAtual(), 1));
    const r = [];
    for (const l of this.todos(`SELECT * FROM lancamentos WHERE cancelado = 0 AND pago = 0 AND cartao_id IS NULL
      AND tipo IN ('despesa','transferencia') AND data <= ? ORDER BY data`, [em3])) {
      const vencida = l.data < hoje;
      r.push({
        nivel: vencida ? 'critico' : 'aviso', tipo: 'conta', id: l.id, data: l.data, valor: l.valor,
        texto: vencida ? `${l.descricao} venceu em ${dataBR(l.data)}`
          : l.data === hoje ? `${l.descricao} vence hoje` : `${l.descricao} vence em ${dataBR(l.data)}`,
      });
    }
    for (const l of this.todos(`SELECT * FROM lancamentos WHERE cancelado = 0 AND pago = 0 AND tipo = 'receita'
      AND data < ? ORDER BY data`, [hoje])) {
      r.push({ nivel: 'info', tipo: 'receber', id: l.id, data: l.data, valor: l.valor, texto: `${l.descricao} (a receber) estava previsto para ${dataBR(l.data)}` });
    }
    for (const c of this.listarCartoes()) {
      for (const f of [c.fatura_anterior, c.fatura_atual]) {
        if (f.restante > 0 && f.vencimento < hoje) {
          r.push({ nivel: 'critico', tipo: 'fatura', cartao_id: c.id, mes: f.mes, valor: f.restante, texto: `Fatura ${c.nome} venceu em ${dataBR(f.vencimento)}` });
        } else if (f.restante > 0 && f.status !== 'aberta' && f.vencimento <= somarDias(hoje, 5)) {
          r.push({ nivel: 'aviso', tipo: 'fatura', cartao_id: c.id, mes: f.mes, valor: f.restante, texto: `Fatura ${c.nome} vence em ${dataBR(f.vencimento)}` });
        } else if (f.status === 'aberta' && f.fechamento <= somarDias(hoje, 2) && f.total > 0) {
          r.push({ nivel: 'info', tipo: 'fatura', cartao_id: c.id, mes: f.mes, valor: f.total, texto: `Fatura ${c.nome} fecha em ${dataBR(f.fechamento)}` });
        }
      }
      if (c.limite > 0 && c.disponivel < c.limite * 0.1) {
        r.push(c.disponivel < 0
          ? { nivel: 'critico', tipo: 'limite', cartao_id: c.id, valor: -c.disponivel, texto: `Cartão ${c.nome} passou do limite` }
          : { nivel: 'aviso', tipo: 'limite', cartao_id: c.id, valor: c.disponivel, texto: `Cartão ${c.nome} com pouco limite disponível` });
      }
    }
    for (const o of this.listarOrcamento(this.mesAtual())) {
      if (!o.teto) continue;
      const pct = o.gasto / o.teto;
      if (pct > 1) r.push({ nivel: 'critico', tipo: 'orcamento', categoria_id: o.id, valor: o.gasto - o.teto, texto: `Orçamento de ${o.nome} estourado` });
      else if (pct >= 0.8) r.push({ nivel: 'aviso', tipo: 'orcamento', categoria_id: o.id, valor: o.teto - o.gasto, texto: `Orçamento de ${o.nome} em ${Math.round(pct * 100)}%` });
    }
    const ordem = { critico: 0, aviso: 1, info: 2 };
    return r.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  }

  // ---------- Importação e exportação ----------
  // Marca quais itens parecem já existir no destino e sugere a categoria.
  // Parcela já lançada da mesma compra (mesma descrição-base e mesmo total de parcelas) neste cartão/conta.
  // Com "chave" (o banco informa a data original da compra), identifica exatamente a compra; sem ela, pelo nome.
  acharParcela({ cartaoId, contaId, base, total, num, chave }) {
    const alvo = normalizar(base);
    return this.todos(`SELECT * FROM lancamentos WHERE cancelado = 0 AND parcela_total = ?
      ${num ? 'AND parcela_num = ?' : ''} ${chave ? 'AND parcela_chave = ?' : ''}
      AND ${cartaoId ? 'cartao_id = ?' : 'conta_id = ?'} ORDER BY parcela_num DESC`,
    [total, ...(num ? [num] : []), ...(chave ? [chave] : []), cartaoId || contaId])
      .filter(l => chave || (!l.parcela_chave && normalizar(l.descricao) === alvo));
  }
  chaveCompra(it) {
    return it.parcela_chave || `${normalizar(it.base || it.descricao)}|${it.parcela_total}`;
  }

  // Marca o que parece já existir, sugere a categoria, descobre a fatura e as parcelas futuras.
  // Em cartão: extratos que trazem compras positivas (ex.: fatura Nubank em CSV) têm o sinal invertido,
  // e linhas de pagamento da fatura são ignoradas (o pagamento se registra em Cartões → Pagar fatura).
  prepararImportacao({ conta_id, cartao_id, itens }) {
    const cartaoId = idOuNulo(cartao_id);
    const contaId = idOuNulo(conta_id);
    const cartao = cartaoId ? this.cartao(cartaoId) : null;
    // Decide arquivo por arquivo (pode-se misturar OFX, que traz compras negativas, com CSV do Nubank, que traz positivas).
    const inverterArquivo = {};
    if (cartao) {
      const porArquivo = {};
      for (const i of itens) (porArquivo[i.arquivo || ''] = porArquivo[i.arquivo || ''] || []).push(i);
      for (const [arq, lista] of Object.entries(porArquivo)) inverterArquivo[arq] = lista.filter(i => i.valor > 0).length > lista.length / 2;
    }
    const ePagamento = d => /^(pagamento (recebido|efetuado|de fatura|da fatura|em \d)|pagto fatura|pag fatura)/i.test(d.trim());
    const r = itens.map(original => {
      const it = { ...original };
      const bruto = inverterArquivo[it.arquivo || ''] ? -it.valor : it.valor;
      const tipo = bruto < 0 ? 'despesa' : 'receita';
      const valor = Math.abs(bruto);
      const base = it.base || it.descricao;
      const fatura = cartao ? (it.fatura_arquivo || faturaDe(it.data, cartao.dia_fechamento, cartao.dia_vencimento)) : null;
      if (cartao && ePagamento(it.descricao)) {
        return { ...it, tipo, valor, fatura, ignorado: 'Pagamento da fatura — registre em Cartões → Pagar fatura', duplicado: false, categoria_id: null };
      }
      let dup = false;
      if (it.importacao_id) dup = !!this.um('SELECT id FROM lancamentos WHERE importacao_id = ? AND cancelado = 0', [it.importacao_id]);
      if (!dup && it.parcela_total) {
        const existente = this.acharParcela({ cartaoId, contaId, base, total: it.parcela_total, num: it.parcela_num, chave: it.parcela_chave })[0];
        // Parcela prevista (criada pelo app, não veio de extrato): a linha real substitui, com o valor e a data certos.
        if (existente && !existente.importacao_id) {
          return { ...it, tipo, valor, fatura, duplicado: false, substituir: existente.id, valor_previsto: existente.valor, categoria_id: existente.categoria_id };
        }
        dup = !!existente;
      }
      return { ...it, tipo, valor, fatura, duplicado: dup, porValor: !dup && !it.parcela_total, categoria_id: this.sugerirCategoria(base, tipo) };
    });
    // Compras avulsas: mesma data + mesmo valor de um lançamento que já existe conta como "já lançado", mesmo com nome
    // diferente (ex.: "99 Ride" no print do app × "DL*99 RIDE" no PDF). Conta uma a uma: duas compras iguais no mesmo dia
    // só são "já lançadas" se já existirem duas.
    const k = (data, valor, tipo) => `${data}|${valor}|${tipo}`;
    const existentes = {};
    for (const l of this.todos(`SELECT data, valor, tipo, COUNT(*) AS n FROM lancamentos WHERE cancelado = 0 AND parcela_total IS NULL
      AND tipo IN ('despesa','receita') AND ${cartaoId ? 'cartao_id = ?' : 'conta_id = ?'} GROUP BY data, valor, tipo`, [cartaoId || contaId])) {
      existentes[k(l.data, l.valor, l.tipo)] = l.n;
    }
    const usados = {};
    for (const it of r) if (it.duplicado && !it.parcela_total) usados[k(it.data, it.valor, it.tipo)] = (usados[k(it.data, it.valor, it.tipo)] || 0) + 1;
    for (const it of r) {
      if (!it.porValor || it.ignorado) continue;
      const chave = k(it.data, it.valor, it.tipo);
      if ((usados[chave] || 0) < (existentes[chave] || 0)) { it.duplicado = true; usados[chave] = (usados[chave] || 0) + 1; }
    }
    // Parcelas futuras: para cada compra parcelada, conta as que ainda faltam depois da última parcela conhecida.
    const grupos = {};
    for (const it of r) {
      if (!it.parcela_total || it.ignorado) continue;
      const chave = this.chaveCompra(it);
      if (!grupos[chave] || it.parcela_num > grupos[chave].parcela_num) grupos[chave] = it;
    }
    for (const it of Object.values(grupos)) {
      const jaTem = this.acharParcela({ cartaoId, contaId, base: it.base, total: it.parcela_total, chave: it.parcela_chave })[0];
      const ultima = Math.max(it.parcela_num, jaTem ? jaTem.parcela_num : 0);
      it.futuras = it.parcela_total - ultima;
    }
    return r;
  }

  // Tudo o que veio de extrato (e as parcelas previstas criadas na importação) num cartão ou conta.
  sqlImportados(cartaoId, contaId) {
    return {
      onde: `${cartaoId ? 'cartao_id = ?' : 'conta_id = ?'} AND tipo IN ('despesa','receita')
        AND (importacao_id IS NOT NULL OR obs IN ('Importado do extrato', 'Parcela prevista (criada na importação)'))`,
      p: [cartaoId || contaId],
    };
  }
  contarImportados({ conta_id, cartao_id }) {
    const { onde, p } = this.sqlImportados(idOuNulo(cartao_id), idOuNulo(conta_id));
    return this.um(`SELECT COUNT(*) AS n FROM lancamentos WHERE ${onde}`, p).n;
  }
  // Para refazer uma importação errada: apaga só o que veio de extrato (lançamentos feitos à mão ficam).
  apagarImportados({ conta_id, cartao_id }) {
    const { onde, p } = this.sqlImportados(idOuNulo(cartao_id), idOuNulo(conta_id));
    return this.transacao(() => {
      const ids = this.todos(`SELECT id FROM lancamentos WHERE ${onde}`, p).map(l => l.id);
      for (const id of ids) {
        this.removerArquivosAnexos(id);
        this.db.run('DELETE FROM lancamentos WHERE id = ?', [id]);
      }
      return ids.length;
    });
  }

  importar({ conta_id, cartao_id, itens, criarFuturas = true }) {
    const cartaoId = idOuNulo(cartao_id);
    const contaId = idOuNulo(conta_id);
    const destino = this.resolverDestino('despesa', contaId, cartaoId);
    let n = 0;
    this.transacao(() => {
      const ultimas = {};
      for (const it of itens) {
        if (it.ignorado) continue;
        const categoriaId = this.validarCategoria(it.categoria_id, it.tipo);
        const valor = validarValor(it.valor);
        const data = validarData(it.data);
        const fatura = destino.cartao ? (it.fatura || faturaDe(data, destino.cartao.dia_fechamento, destino.cartao.dia_vencimento)) : null;
        if (it.substituir) {
          this.db.run(`UPDATE lancamentos SET valor = ?, data = ?, competencia = ?, fatura = ?, categoria_id = ?, importacao_id = ?,
            obs = 'Importado do extrato' WHERE id = ? AND importacao_id IS NULL`,
          [valor, data, data.slice(0, 7), fatura, categoriaId, it.importacao_id || null, it.substituir]);
          n++;
          continue;
        }
        let grupo = null;
        let descricao = texto(it.descricao, 'a descrição');
        if (it.parcela_total) {
          descricao = `${texto(it.base || it.descricao)} (${it.parcela_num}/${it.parcela_total})`;
          const irma = this.acharParcela({ cartaoId, contaId, base: it.base || it.descricao, total: it.parcela_total, chave: it.parcela_chave })[0];
          grupo = irma ? (irma.parcela_grupo || irma.id) : null;
        }
        const obs = it.obs ? `Importado do extrato · ${it.obs}` : 'Importado do extrato';
        const id = this.exec(`INSERT INTO lancamentos (tipo, descricao, categoria_id, valor, data, competencia, pago, obs,
            conta_id, cartao_id, fatura, parcela_grupo, parcela_num, parcela_total, importacao_id, parcela_chave)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [it.tipo, descricao, categoriaId, valor, data, data.slice(0, 7), obs, destino.conta_id, cartaoId, fatura,
          grupo, it.parcela_num || null, it.parcela_total || null, it.importacao_id || null, it.parcela_chave || null]);
        if (it.parcela_total && !grupo) this.db.run('UPDATE lancamentos SET parcela_grupo = ? WHERE id = ?', [id, id]);
        if (it.parcela_total) {
          const chave = this.chaveCompra(it);
          if (!ultimas[chave] || it.parcela_num > ultimas[chave].parcela_num) ultimas[chave] = { ...it, id };
        }
        n++;
      }
      if (criarFuturas) {
        for (const it of Object.values(ultimas)) {
          const ref = this.acharParcela({ cartaoId, contaId, base: it.base || it.descricao, total: it.parcela_total, chave: it.parcela_chave })[0];
          if (!ref) continue;
          for (let k = ref.parcela_num + 1; k <= ref.parcela_total; k++) {
            const passo = k - ref.parcela_num;
            const data = dataNoMes(somarMeses(ref.data.slice(0, 7), passo), Number(ref.data.slice(8)));
            const fatura = ref.fatura ? somarMeses(ref.fatura, passo) : null;
            this.db.run(`INSERT INTO lancamentos (tipo, descricao, categoria_id, valor, data, competencia, pago, obs,
                conta_id, cartao_id, fatura, parcela_grupo, parcela_num, parcela_total, parcela_chave)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'Parcela prevista (criada na importação)', ?, ?, ?, ?, ?, ?, ?)`,
            [ref.tipo, `${texto(it.base || it.descricao)} (${k}/${ref.parcela_total})`, ref.categoria_id, ref.valor, data,
              data.slice(0, 7), cartaoId ? 1 : 0, ref.conta_id, ref.cartao_id, fatura, ref.parcela_grupo || ref.id, k, ref.parcela_total,
              ref.parcela_chave || null]);
            n++;
          }
        }
      }
    });
    return n;
  }

  exportarCsv(filtros) {
    const linhas = this.listarLancamentos(filtros);
    const nomes = { receita: 'Receita', despesa: 'Despesa', transferencia: 'Transferência', ajuste: 'Ajuste', pagamento_fatura: 'Pagamento de fatura' };
    const csv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const valor = c => (c / 100).toFixed(2).replace('.', ',');
    const cab = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Cartão', 'Fatura', 'Valor', 'Situação', 'Tags', 'Observação'];
    const corpo = linhas.map(l => [
      dataBR(l.data), nomes[l.tipo] || l.tipo, l.descricao, l.categoria || '',
      l.tipo === 'transferencia' ? `${l.conta} → ${l.conta_destino}` : (l.conta || ''), l.cartao || '', l.fatura || '',
      valor(l.tipo === 'despesa' || l.tipo === 'pagamento_fatura' || l.tipo === 'transferencia' ? -l.valor : l.valor),
      l.pago ? 'Efetivado' : 'Pendente', l.tags || '', l.obs,
    ].map(csv).join(';'));
    return '﻿' + [cab.map(csv).join(';'), ...corpo].join('\r\n');
  }
}

const dataBR = d => (d ? d.split('-').reverse().join('/') : '');
const SQL_NOME_CATEGORIA = `CASE WHEN cp.id IS NULL THEN c.nome ELSE cp.nome || ' › ' || c.nome END`;
const SQL_TAGS = `(SELECT group_concat(t.nome, ',') FROM lancamento_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lancamento_id = l.id)`;
const JOIN_CATEGORIA ='LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN categorias cp ON cp.id = c.pai_id';

const exportado = { Banco, hojeISO, somarMeses, dataNoMes, faturaDe, datasFatura, normalizar, somarDias };
if (ehNode) module.exports = exportado; else globalThis.FinancasDB = exportado;
})();
