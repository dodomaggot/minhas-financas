'use strict';
// Armazenamento local do navegador (IndexedDB): banco de dados, comprovantes e cópias de segurança.

const idb = (() => {
  let conexao = null;
  function abrir() {
    if (conexao) return conexao;
    conexao = new Promise((resolve, reject) => {
      const req = indexedDB.open('minhas-financas', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('anexos')) db.createObjectStore('anexos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return conexao;
  }
  async function operar(loja, modo, fn) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(loja, modo);
      const req = fn(tx.objectStore(loja));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Falha ao gravar no aparelho.'));
    });
  }
  return {
    get: (loja, chave) => operar(loja, 'readonly', s => s.get(chave)),
    set: (loja, chave, valor) => operar(loja, 'readwrite', s => s.put(valor, chave)),
    del: (loja, chave) => operar(loja, 'readwrite', s => s.delete(chave)),
    chaves: loja => operar(loja, 'readonly', s => s.getAllKeys()),
  };
})();

// Guarda até 5 cópias locais (antes de restaurar backup ou de trocar pela versão da nuvem).
async function guardarCopiaLocal(bytes, motivo) {
  const lista = (await idb.get('kv', 'copias')) || [];
  lista.unshift({ quando: new Date().toISOString(), motivo, bytes });
  await idb.set('kv', 'copias', lista.slice(0, 5));
}

// ---------- Arquivos: escolher, baixar, compartilhar ----------

// Abre o seletor de arquivos. Precisa ser chamado direto do clique (sem "await" antes), senão o iPhone bloqueia.
function escolherArquivos({ accept = '', multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const fim = arquivos => { input.remove(); resolve(arquivos); };
    input.addEventListener('change', () => fim([...input.files]));
    input.addEventListener('cancel', () => fim([]));
    input.click();
  });
}

const lerBytes = arquivo => arquivo.arrayBuffer().then(b => new Uint8Array(b));

// No celular abre o "Compartilhar" (Salvar em Arquivos, enviar...). No PC, baixa o arquivo.
function entregarArquivo(nome, blob) {
  const arquivo = new File([blob], nome, { type: blob.type });
  const toque = matchMedia('(pointer: coarse)').matches;
  if (toque && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    navigator.share({ files: [arquivo], title: nome }).catch(() => {});
    return nome;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return nome;
}

// Fotos do celular ficam grandes: reduz para no máximo 1600px em JPEG.
async function comprimirImagem(arquivo) {
  if (!arquivo.type.startsWith('image/') || arquivo.type === 'image/gif') return { bytes: await lerBytes(arquivo), tipo: arquivo.type };
  try {
    const img = await createImageBitmap(arquivo);
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) throw new Error('sem blob');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), tipo: 'image/jpeg' };
  } catch {
    return { bytes: await lerBytes(arquivo), tipo: arquivo.type };
  }
}
