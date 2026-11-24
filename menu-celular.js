'use strict';
// Menu lateral que abre e fecha no celular.
(() => {
  const abrir = sim => document.body.classList.toggle('menu-aberto', sim);
  $('#menuBotao').onclick = () => abrir(!document.body.classList.contains('menu-aberto'));
  $('#fundoMenu').onclick = () => abrir(false);
  $$('#menu button').forEach(b => b.addEventListener('click', () => abrir(false)));
})();
