'use strict';
// Sincronização com um repositório PRIVADO do GitHub. Os dados são criptografados no aparelho
// (AES-256-GCM, chave derivada da senha com PBKDF2) antes de sair dele: o GitHub só vê bytes embaralhados.

// ---------- Criptografia ----------
const Cripto = (() => {
  const MAGICO = [77, 70, 49]; // "MF1"
  const ITERACOES = 310000;
  const b64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const deB64 = txt => Uint8Array.from(atob(txt.replace(/\s/g, '')), c => c.charCodeAt(0));

  async function derivarChave(senha, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERACOES, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const exportarChave = async chave => b64(new Uint8Array(await crypto.subtle.exportKey('raw', chave)));
  const importarChave = txt => crypto.subtle.importKey('raw', deB64(txt), 'AES-GCM', true, ['encrypt', 'decrypt']);

  async function transformar(bytes, Stream) {
    const s = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // Formato: "MF1" | 1 byte (1 = gzip) | salt 16 | iv 12 | dados cifrados
  async function cifrar(chave, salt, bytes) {
    const comprimir = typeof CompressionStream !== 'undefined';
    const corpo = comprimir ? await transformar(bytes, CompressionStream) : bytes;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, corpo));
    const r = new Uint8Array(4 + 16 + 12 + cifrado.length);
    r.set(MAGICO, 0); r[3] = comprimir ? 1 : 0; r.set(salt, 4); r.set(iv, 20); r.set(cifrado, 32);
    return r;
  }
  function lerCabecalho(bytes) {
    if (bytes.length < 33 || MAGICO.some((v, i) => bytes[i] !== v)) throw new Error('O arquivo da nuvem não é do Minhas Finanças.');
    return { gzip: bytes[3] === 1, salt: bytes.slice(4, 20), iv: bytes.slice(20, 32), dados: bytes.slice(32) };
  }
  async function decifrar(chave, bytes) {
    const c = lerCabecalho(bytes);
    let corpo;
    try {
      corpo = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, chave, c.dados));
    } catch {
      throw new Error('Senha incorreta: não foi possível abrir os dados da nuvem.');
    }
    if (c.gzip) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador é antigo demais para abrir os dados. Atualize o iOS/navegador.');
      corpo = await transformar(corpo, DecompressionStream);
    }
    return corpo;
  }
  return { derivarChave, exportarChave, importarChave, cifrar, decifrar, lerCabecalho, b64, deB64 };
})();

// ---------- API do GitHub ----------
class ErroConflito extends Error {}

class GitHub {
  constructor({ usuario, repo, token, base }) {
    this.raiz = `${base || 'https://api.github.com'}/repos/${encodeURIComponent(usuario)}/${encodeURIComponent(repo)}`;
    this.token = token;
  }
  async req(metodo, caminho, corpo) {
    let r;
    try {
      r = await fetch(this.raiz + caminho, {
        method: metodo,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      throw new Error('Sem conexão com o GitHub.');
    }
    if (r.status === 401) throw new Error('Token do GitHub inválido ou vencido. Gere um novo e conecte de novo.');
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw new Error('Limite de uso do GitHub atingido. Tente em alguns minutos.');
    return r;
  }
  async verificar() {
    const r = await this.req('GET', '');
    if (r.status === 404) throw new Error('Repositório não encontrado. Confira o usuário, o nome do repositório e se o token tem acesso a ele.');
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}.`);
    const info = await r.json();
    if (!info.private) throw new Error('Este repositório é PÚBLICO. Por segurança, use um repositório privado.');
    if (info.permissions && !info.permissions.push) throw new Error('O token não tem permissão de escrita (Contents: Read and write).');
    return info;
  }
  // Devolve { sha, bytes } ou null se não existir.
  async ler(caminho) {
    const r = await this.req('GET', `/contents/${caminho}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Falha ao ler da nuvem (${r.status}).`);
    const j = await r.json();
    let conteudo = j.content;
    if (!conteudo && j.size > 0) {
      // Arquivos acima de 1 MB vêm vazios por esse caminho: busca pelo blob.
      const rb = await this.req('GET', `/git/blobs/${j.sha}`);
      if (!rb.ok) throw new Error(`Falha ao ler da nuvem (${rb.status}).`);
      conteudo = (await rb.json()).content;
    }
    return { sha: j.sha, bytes: Cripto.deB64(conteudo || '') };
  }
  async sha(caminho) {
    const r = await this.req('GET', `/contents/${caminho}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Falha ao consultar a nuvem (${r.status}).`);
    return (await r.json()).sha;
  }
  // Grava; sha = versão que eu conhecia (null para criar). Se alguém gravou antes, dá ErroConflito.
  async escrever(caminho, bytes, sha, mensagem) {
    const r = await this.req('PUT', `/contents/${caminho}`, { message: mensagem, content: Cripto.b64(bytes), ...(sha ? { sha } : {}) });
    if (r.status === 409 || r.status === 422) throw new ErroConflito('A nuvem tem uma versão mais nova.');
    if (!r.ok) throw new Error(`Falha ao enviar para a nuvem (${r.status}).`);
    return (await r.json()).content.sha;
  }
  async apagar(caminho) {
    const sha = await this.sha(caminho);
    if (!sha) return;
    const r = await this.req('DELETE', `/contents/${caminho}`, { message: 'Remove comprovante', sha });
    if (!r.ok && r.status !== 404) throw new Error(`Falha ao apagar na nuvem (${r.status}).`);
  }
}

// ---------- Sincronização ----------
const Sync = (() => {
  const ARQUIVO = 'financas.mfdb';
  const K_CONFIG = 'mf.sync', K_ESTADO = 'mf.sync.estado';
  let ctx = null;          // { banco, aplicar(bytes), aoMudar() }
  let fila = Promise.resolve();
  let timer = null;
  let status = { fase: 'desligado', texto: 'Sincronização desligada' };

  const lerJSON = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) || padrao; } catch { return padrao; } };
  const config = () => lerJSON(K_CONFIG, null);
  const estado = () => lerJSON(K_ESTADO, { sha: null, pendente: false, ultima: null, anexosPendentes: [] });
  const gravarEstado = e => localStorage.setItem(K_ESTADO, JSON.stringify(e));
  const mudarEstado = parcial => gravarEstado({ ...estado(), ...parcial });

  function definirStatus(fase, texto) {
    status = { fase, texto };
    if (ctx && ctx.aoMudar) ctx.aoMudar(status);
  }
  // Uma operação de cada vez, para não cruzar envio com recebimento.
  const enfileirar = fn => (fila = fila.then(fn, fn).catch(e => { console.error(e); definirStatus('erro', e.message); }));

  async function cliente() {
    const c = config();
    return { gh: new GitHub(c), chave: await Cripto.importarChave(c.chave), salt: Cripto.deB64(c.salt) };
  }

  // Primeira conexão neste aparelho.
  async function conectar({ usuario, repo, token, senha, base }) {
    usuario = String(usuario || '').trim().replace(/^@/, '');
    repo = String(repo || '').trim();
    token = String(token || '').trim();
    if (!usuario || !repo || !token) throw new Error('Preencha usuário, repositório e token.');
    if (!senha || senha.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    const gh = new GitHub({ usuario, repo, token, base });
    await gh.verificar();
    const remoto = await gh.ler(ARQUIVO);
    let salt, bytesRemotos = null;
    if (remoto) {
      salt = Cripto.lerCabecalho(remoto.bytes).salt;
      const chave = await Cripto.derivarChave(senha, salt);
      bytesRemotos = await Cripto.decifrar(chave, remoto.bytes); // confere a senha
    } else {
      salt = crypto.getRandomValues(new Uint8Array(16));
    }
    const chave = await Cripto.derivarChave(senha, salt);
    return {
      existeNaNuvem: !!remoto,
      bytesNuvem: () => bytesRemotos,
      // Salva a configuração e decide o que fica: 'nuvem' (baixa) ou 'aparelho' (envia este).
      async confirmar(manter) {
        localStorage.setItem(K_CONFIG, JSON.stringify({ usuario, repo, token, base, chave: await Cripto.exportarChave(chave), salt: Cripto.b64(salt) }));
        gravarEstado({ sha: remoto ? remoto.sha : null, pendente: manter === 'aparelho', ultima: null, anexosPendentes: [] });
        if (manter === 'nuvem' && bytesRemotos) {
          await guardarCopiaLocal(ctx.banco.exportar(), 'Antes de usar os dados da nuvem');
          await ctx.aplicar(bytesRemotos);
          mudarEstado({ ultima: new Date().toISOString() });
          definirStatus('ok', 'Sincronizado');
        } else {
          await enviarAgora(true);
          enviarTodosAnexos();
        }
      },
    };
  }

  function desconectar() {
    localStorage.removeItem(K_CONFIG);
    localStorage.removeItem(K_ESTADO);
    definirStatus('desligado', 'Sincronização desligada');
  }

  // Chamado a cada alteração no banco.
  function marcarAlterado() {
    if (!config()) return;
    mudarEstado({ pendente: true });
    definirStatus('pendente', 'Alterações a enviar');
    clearTimeout(timer);
    timer = setTimeout(() => enfileirar(() => enviar()), 3000);
  }

  async function enviar(forcar = false) {
    if (!config()) return;
    const e = estado();
    if (!e.pendente && !forcar) return;
    if (!navigator.onLine) { definirStatus('offline', 'Sem internet — envio pendente'); return; }
    definirStatus('enviando', 'Enviando…');
    const { gh, chave, salt } = await cliente();
    const bytes = await Cripto.cifrar(chave, salt, ctx.banco.exportar());
    try {
      const sha = await gh.escrever(ARQUIVO, bytes, e.sha, `Atualiza dados (${new Date().toLocaleString('pt-BR')})`);
      mudarEstado({ sha, pendente: false, ultima: new Date().toISOString() });
      definirStatus('ok', 'Sincronizado');
    } catch (erro) {
      if (erro instanceof ErroConflito) return receber();
      throw erro;
    }
    await enviarAnexosPendentes();
  }
  const enviarAgora = forcar => enfileirar(() => enviar(forcar));

  // Busca a versão da nuvem. Se os dois lados mudaram, pergunta qual manter.
  async function receber() {
    if (!config()) return;
    if (!navigator.onLine) { definirStatus('offline', estado().pendente ? 'Sem internet — envio pendente' : 'Sem internet'); return; }
    definirStatus('enviando', 'Verificando…');
    const { gh, chave } = await cliente();
    const e = estado();
    const shaRemoto = await gh.sha(ARQUIVO);
    if (!shaRemoto) { mudarEstado({ sha: null }); return enviar(true); } // arquivo apagado na nuvem: reenviar
    if (shaRemoto === e.sha) {
      if (e.pendente) return enviar();
      mudarEstado({ ultima: new Date().toISOString() });
      definirStatus('ok', 'Sincronizado');
      return;
    }
    const remoto = await gh.ler(ARQUIVO);
    const bytes = await Cripto.decifrar(chave, remoto.bytes);
    if (e.pendente) {
      const escolha = await escolher({
        titulo: 'Dados diferentes na nuvem',
        mensagem: 'Este aparelho e outro aparelho alteraram os dados ao mesmo tempo. Qual versão deseja manter? '
          + 'A outra fica guardada como cópia neste aparelho (Sincronização → Cópias locais).',
        opcoes: [{ valor: 'nuvem', texto: 'Usar a da nuvem' }, { valor: 'aparelho', texto: 'Manter a deste aparelho' }],
      });
      if (escolha === 'aparelho') {
        await guardarCopiaLocal(bytes, 'Versão da nuvem substituída');
        mudarEstado({ sha: remoto.sha });
        return enviar(true);
      }
      if (escolha !== 'nuvem') { definirStatus('pendente', 'Conflito não resolvido'); return; }
      await guardarCopiaLocal(ctx.banco.exportar(), 'Versão deste aparelho substituída');
    }
    await ctx.aplicar(bytes);
    mudarEstado({ sha: remoto.sha, pendente: false, ultima: new Date().toISOString() });
    definirStatus('ok', 'Sincronizado');
  }

  // ---------- Comprovantes ----------
  const caminhoAnexo = arquivo => `anexos/${arquivo}.mf`;

  function anexoAlterado(arquivo, acao) {
    if (!config()) return;
    const e = estado();
    const lista = (e.anexosPendentes || []).filter(p => p.arquivo !== arquivo);
    lista.push({ arquivo, acao });
    mudarEstado({ anexosPendentes: lista });
    enfileirar(() => enviarAnexosPendentes());
  }
  async function enviarAnexosPendentes() {
    if (!config() || !navigator.onLine) return;
    const { gh, chave, salt } = await cliente();
    for (const p of [...(estado().anexosPendentes || [])]) {
      if (p.acao === 'enviar') {
        const a = await idb.get('anexos', p.arquivo);
        if (a) {
          const pacote = new TextEncoder().encode(JSON.stringify({ nome: a.nome, tipo: a.tipo }) + '\n');
          const junto = new Uint8Array(pacote.length + a.bytes.length);
          junto.set(pacote); junto.set(a.bytes, pacote.length);
          const sha = await gh.sha(caminhoAnexo(p.arquivo));
          if (!sha) await gh.escrever(caminhoAnexo(p.arquivo), await Cripto.cifrar(chave, salt, junto), null, 'Adiciona comprovante');
        }
      } else {
        await gh.apagar(caminhoAnexo(p.arquivo));
      }
      mudarEstado({ anexosPendentes: (estado().anexosPendentes || []).filter(x => !(x.arquivo === p.arquivo && x.acao === p.acao)) });
    }
  }
  // Ao conectar enviando os dados deste aparelho, manda também todos os comprovantes.
  async function enviarTodosAnexos() {
    const chaves = await idb.chaves('anexos');
    for (const arquivo of chaves) anexoAlterado(arquivo, 'enviar');
  }
  async function baixarAnexo(arquivo) {
    if (!config()) return null;
    const { gh, chave } = await cliente();
    const r = await gh.ler(caminhoAnexo(arquivo));
    if (!r) return null;
    const junto = await Cripto.decifrar(chave, r.bytes);
    const fimLinha = junto.indexOf(10);
    const meta = JSON.parse(new TextDecoder().decode(junto.slice(0, fimLinha)));
    const a = { nome: meta.nome, tipo: meta.tipo, bytes: junto.slice(fimLinha + 1) };
    await idb.set('anexos', arquivo, a);
    return a;
  }

  function iniciar(contexto) {
    ctx = contexto;
    const verificar = () => { if (config() && document.visibilityState === 'visible') enfileirar(() => receber()); };
    // Ao voltar para o app (trocar de aba, desbloquear o celular), quando a internet volta e a cada 5 minutos.
    document.addEventListener('visibilitychange', verificar);
    addEventListener('online', verificar);
    addEventListener('offline', () => { if (config()) definirStatus('offline', estado().pendente ? 'Sem internet — envio pendente' : 'Sem internet'); });
    setInterval(verificar, 5 * 60 * 1000);
    if (!config()) { definirStatus('desligado', 'Sincronização desligada'); return; }
    definirStatus(estado().pendente ? 'pendente' : 'ok', estado().pendente ? 'Alterações a enviar' : 'Sincronizado');
    verificar();
  }

  return {
    iniciar, conectar, desconectar, marcarAlterado, anexoAlterado, baixarAnexo,
    sincronizarAgora: () => enfileirar(() => receber()),
    config, estado, status: () => status,
  };
})();
