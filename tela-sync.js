'use strict';
// Tela de sincronização (só na versão web).

TELAS.sincronizacao = { titulo: 'Sincronização', usaMes: false };

async function tela_sincronizacao() {
  const cfg = Sync.config();
  const copias = await api.backup.copias();
  const el = $('#conteudo');
  const blocoCopias = `<div class="card">
    <h3>Cópias locais <small>guardadas neste aparelho</small></h3>
    <p class="ajuda">Antes de trocar os dados (restaurar backup ou resolver diferença com a nuvem), o app guarda aqui uma cópia do que havia antes.</p>
    ${copias.length ? `<ul class="lista-simples">${copias.map(c => `<li>
      <div class="desc">${new Date(c.quando).toLocaleString('pt-BR')}<small>${esc(c.motivo)} · ${Math.ceil(c.tamanho / 1024)} KB</small></div>
      <button class="botao pequeno" data-copia="${c.i}">Voltar para esta</button></li>`).join('')}</ul>` : '<div class="vazio">Nenhuma cópia ainda.</div>'}
  </div>`;

  if (cfg) {
    const e = Sync.estado();
    const s = Sync.status();
    el.innerHTML = `
      <div class="grade-2 topo-alinhado">
        <div class="card">
          <h3>☁︎ Sincronização ligada</h3>
          <ul class="lista-simples">
            <li><div class="desc">Situação</div><b class="${s.fase === 'ok' ? 'bom' : s.fase === 'erro' ? 'ruim' : 'alerta'}">${esc(s.texto)}</b></li>
            <li><div class="desc">Última sincronização</div><span>${e.ultima ? new Date(e.ultima).toLocaleString('pt-BR') : '—'}</span></li>
            <li><div class="desc">Repositório</div><span>${esc(cfg.usuario)}/${esc(cfg.repo)} (privado)</span></li>
            <li><div class="desc">Comprovantes aguardando envio</div><span>${(e.anexosPendentes || []).length}</span></li>
          </ul>
          <p class="ajuda" style="margin-top:12px">Os dados são enviados alguns segundos depois de cada alteração e conferidos sempre que o app é aberto.
            Estão criptografados com a sua senha: sem ela, ninguém consegue ler — nem o GitHub.</p>
          <div class="acoes-topo">
            <button class="botao primario" id="syncAgora">Sincronizar agora</button>
            <button class="botao perigo" id="syncDesligar">Desconectar este aparelho</button>
          </div>
        </div>
        ${blocoCopias}
      </div>`;
    $('#syncAgora').onclick = () => { Sync.sincronizarAgora(); avisar('Sincronizando…'); };
    $('#syncDesligar').onclick = () => {
      if (!confirm('Desconectar este aparelho da nuvem?\nOs dados continuam aqui e na nuvem; só param de sincronizar. Para reconectar vai precisar do token e da senha.')) return;
      Sync.desconectar();
      renderizar();
    };
  } else {
    el.innerHTML = `
      <div class="grade-2 topo-alinhado">
        <div class="card passos">
          <h3>Como ligar (uma vez só, ~5 minutos)</h3>
          <ol>
            <li><b>Crie um repositório privado</b> em <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a>:
              nome <code>financas-dados</code>, marque <b>Private</b> e clique em <i>Create repository</i>.</li>
            <li><b>Crie um token</b> em <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>:
              <ul>
                <li><i>Token name</i>: Minhas Finanças · <i>Expiration</i>: o maior prazo disponível</li>
                <li><i>Repository access</i>: <b>Only select repositories</b> → <code>financas-dados</code></li>
                <li><i>Permissions → Repository permissions → Contents</i>: <b>Read and write</b></li>
              </ul>
              Clique em <i>Generate token</i> e copie o código (começa com <code>github_pat_</code>).</li>
            <li><b>Preencha ao lado</b>. Use o mesmo token e a mesma senha no celular e no computador.</li>
          </ol>
          <p class="ajuda">⚠ <b>Guarde bem a senha.</b> Ela embaralha seus dados antes de irem para a nuvem; se esquecer, os dados da nuvem não podem ser recuperados
            (os deste aparelho continuam aqui).</p>
        </div>
        <div class="card">
          <h3>Conectar</h3>
          <form id="formSync" autocomplete="off">
            <div class="campo"><label for="sUsuario">Seu usuário do GitHub</label><input id="sUsuario" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ex.: joaosilva"></div>
            <div class="campo"><label for="sRepo">Repositório</label><input id="sRepo" value="financas-dados" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
            <div class="campo"><label for="sToken">Token</label><input id="sToken" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="github_pat_..."></div>
            <div class="campo-linha">
              <div class="campo"><label for="sSenha">Senha dos dados</label><input id="sSenha" type="password" autocomplete="new-password" placeholder="mínimo 8 caracteres"></div>
              <div class="campo"><label for="sSenha2">Repita a senha</label><input id="sSenha2" type="password" autocomplete="new-password"></div>
            </div>
            <p class="erro" id="sErro" hidden></p>
            <button class="botao primario" id="sConectar" type="submit">Conectar</button>
          </form>
        </div>
      </div>
      ${blocoCopias}`;

    $('#formSync').onsubmit = async ev => {
      ev.preventDefault();
      const erro = $('#sErro');
      const botao = $('#sConectar');
      erro.hidden = true;
      botao.disabled = true;
      botao.textContent = 'Conectando…';
      try {
        const senha = $('#sSenha').value;
        const conexao = await Sync.conectar({
          usuario: $('#sUsuario').value, repo: $('#sRepo').value, token: $('#sToken').value, senha,
          base: localStorage.getItem('mf.apiBase') || undefined,
        });
        let manter;
        if (!conexao.existeNaNuvem) {
          if ($('#sSenha2').value !== senha) throw new Error('As duas senhas não são iguais.');
          manter = 'aparelho';
        } else if (!banco.temDados()) {
          manter = 'nuvem';
        } else {
          manter = await escolher({
            titulo: 'Já existem dados na nuvem',
            mensagem: 'Este aparelho também tem dados. Normalmente, no segundo aparelho, você usa os dados da nuvem. '
              + 'A versão que não for escolhida fica guardada como cópia local.',
            opcoes: [{ valor: 'nuvem', texto: 'Usar os da nuvem' }, { valor: 'aparelho', texto: 'Substituir pelos deste aparelho', perigo: true }],
          });
          if (!manter) throw new Error('Conexão cancelada.');
          if (manter === 'aparelho') await guardarCopiaLocal(await conexaoBytesNuvem(conexao), 'Versão da nuvem substituída');
        }
        await conexao.confirmar(manter);
        avisar(manter === 'nuvem' ? 'Conectado! Dados da nuvem carregados.' : 'Conectado! Enviando seus dados…');
        renderizar();
      } catch (e) {
        erro.textContent = e.message;
        erro.hidden = false;
        botao.disabled = false;
        botao.textContent = 'Conectar';
      }
    };
  }

  $$('[data-copia]').forEach(b => b.onclick = () => tentar(async () => {
    if (!confirm('Voltar para esta cópia? Os dados atuais também ficam guardados como cópia.')) return;
    await api.backup.usarCopia({ i: Number(b.dataset.copia) });
    avisar('Cópia restaurada.');
    renderizar();
  }));
}

// A versão da nuvem já foi baixada e conferida em conectar(); aqui só a recuperamos para guardar como cópia.
async function conexaoBytesNuvem(conexao) {
  return conexao.bytesNuvem ? conexao.bytesNuvem() : new Uint8Array();
}
