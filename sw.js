// Service worker: guarda o app no aparelho para abrir sem internet.
// A página vem da internet quando possível (pega versão nova); os scripts têm ?v=versão no endereço,
// então cada versão da página sempre usa os scripts da mesma versão.
const CACHE = 'mf-2026.11.23-2101';
const ARQUIVOS = [
  "./",
  "index.html",
  "vendor/sql-wasm.wasm",
  "icones/icone-512.png",
  "manifest.webmanifest",
  "icones/icone-192.png",
  "icones/icone-180.png",
  "tema.js?v=2026.11.23-2101",
  "styles.css?v=2026.11.23-2101",
  "vendor/sql-wasm.js",
  "db.js?v=2026.11.23-2101",
  "importar.js?v=2026.11.23-2101",
  "util.js?v=2026.11.23-2101",
  "graficos.js?v=2026.11.23-2101",
  "app.js?v=2026.11.23-2101",
  "telas-principais.js?v=2026.11.23-2101",
  "telas-contas.js?v=2026.11.23-2101",
  "telas-planejamento.js?v=2026.11.23-2101",
  "telas-config.js?v=2026.11.23-2101",
  "armazenamento.js?v=2026.11.23-2101",
  "nuvem.js?v=2026.11.23-2101",
  "tela-sync.js?v=2026.11.23-2101",
  "manual.js?v=2026.11.23-2101",
  "projecao.js?v=2026.11.23-2101",
  "menu-celular.js?v=2026.11.23-2101",
  "backend.js?v=2026.11.23-2101"
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k.startsWith('mf-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub API: sempre direto na rede
  if (req.mode === 'navigate') {
    // no-cache: sempre confere no servidor se a página mudou (o GitHub Pages deixaria até 10 min de cópia velha).
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put('./', copia)); }
      return r;
    }).catch(async () => (await caches.match('./')) || caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(guardado => guardado || fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return r;
  })));
});
