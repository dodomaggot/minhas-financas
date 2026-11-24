'use strict';
// Aparência: modo (auto / claro / escuro) e cor de destaque, guardados neste aparelho.
const CORES_TEMA = [
  { nome: 'azul', rotulo: 'Azul', claro: '#2a78d6', escuro: '#3987e5' },
  { nome: 'verde', rotulo: 'Verde', claro: '#16884a', escuro: '#2fa863' },
  { nome: 'roxo', rotulo: 'Roxo', claro: '#6250d6', escuro: '#9085e9' },
  { nome: 'rosa', rotulo: 'Rosa', claro: '#c9306b', escuro: '#e5639a' },
  { nome: 'laranja', rotulo: 'Laranja', claro: '#c9581f', escuro: '#e8783f' },
  { nome: 'grafite', rotulo: 'Grafite', claro: '#4b5563', escuro: '#8b95a5' },
];
function lerTema() {
  let modo = 'auto', cor = 'azul';
  try { modo = localStorage.getItem('mf.tema') || 'auto'; cor = localStorage.getItem('mf.cor') || 'azul'; } catch { /* sem acesso */ }
  return { modo, cor };
}
function aplicarTema({ modo, cor } = lerTema()) {
  const raiz = document.documentElement;
  if (modo === 'claro' || modo === 'escuro') raiz.dataset.tema = modo; else delete raiz.dataset.tema;
  raiz.dataset.cor = CORES_TEMA.some(c => c.nome === cor) ? cor : 'azul';
}
function definirTema(parcial) {
  const t = { ...lerTema(), ...parcial };
  try { localStorage.setItem('mf.tema', t.modo); localStorage.setItem('mf.cor', t.cor); } catch { /* sem acesso */ }
  aplicarTema(t);
}
aplicarTema();
