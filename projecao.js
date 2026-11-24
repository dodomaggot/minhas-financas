'use strict';
// Tela "Projeção do saldo": saldo dia a dia até uma data, com o ponto mais baixo e quanto falta para não ficar negativo.

TELAS.projecao = { titulo: 'Projeção do saldo', usaMes: false };
let projecaoPeriodo = 'proximo';

function fimDoPeriodoProjecao(periodo) {
  const hoje = hojeISO();
  if (periodo === 'este') return fimDoMes(hoje.slice(0, 7));
  if (periodo === '90') { const d = new Date(hoje + 'T12:00:00'); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); }
  return fimDoMes(somarMeses(hoje.slice(0, 7), 1));
}

async function tela_projecao() {
  const ate = fimDoPeriodoProjecao(projecaoPeriodo);
  const p = await api.painel.projecao({ ate });
  const sinal = v => (v >= 0 ? 'bom' : 'ruim');
  const primeiroNegativo = p.dias.find(d => d.saldo < 0);
  const ddmm = d => dataBR(d).slice(0, 5);
  const iMin = p.dias.findIndex(d => d.data === p.minimo.data && d.saldo === p.minimo.saldo);

  $('#conteudo').innerHTML = `
    <div class="secao-titulo">
      <p class="ajuda" style="margin:0">Soma, dia a dia, o que ainda vai entrar e sair das suas contas: contas a pagar, fixos dos próximos meses
        (salário, aluguel…) e as faturas dos cartões na data de vencimento. O que está atrasado entra como se fosse pago hoje.</p>
      <select id="projPeriodo">
        <option value="este" ${projecaoPeriodo === 'este' ? 'selected' : ''}>Até o fim deste mês</option>
        <option value="proximo" ${projecaoPeriodo === 'proximo' ? 'selected' : ''}>Até o fim do próximo mês</option>
        <option value="90" ${projecaoPeriodo === '90' ? 'selected' : ''}>Próximos 90 dias</option>
      </select>
    </div>

    <div class="card destaque-projecao ${p.falta ? 'negativo' : 'positivo'}">
      ${p.falta
        ? `<div class="proj-numero ruim">Faltam ${dinheiro(p.falta)}</div>
           <div>para o saldo não ficar negativo até ${dataBR(ate)}.
             O saldo fica negativo a partir de <b>${dataBR(primeiroNegativo.data)}</b> e chega ao ponto mais baixo em <b>${dataBR(p.minimo.data)}</b>
             (${dinheiro(p.minimo.saldo)}).</div>`
        : `<div class="proj-numero bom">O saldo não fica negativo</div>
           <div>até ${dataBR(ate)}. O ponto mais baixo é <b>${dinheiro(p.minimo.saldo)}</b> em <b>${dataBR(p.minimo.data)}</b>.</div>`}
      <div class="ajuda" style="margin:8px 0 0">A conta usa só o que está no app: confira se o saldo das contas bate com o banco
        (Contas → Ajustar saldo) e se todas as contas fixas e faturas estão lançadas.</div>
    </div>

    <div class="grade-cards">
      <div class="card tile"><div class="rotulo">Saldo nas contas hoje</div><div class="valor ${sinal(p.inicio)}">${dinheiro(p.inicio)}</div></div>
      <div class="card tile"><div class="rotulo"><span class="marcador" style="background:var(--receita)"></span>Vai entrar até ${ddmm(ate)}</div><div class="valor">${dinheiro(p.entradas)}</div></div>
      <div class="card tile"><div class="rotulo"><span class="marcador" style="background:var(--despesa)"></span>Vai sair até ${ddmm(ate)}</div><div class="valor">${dinheiro(p.saidas)}</div></div>
      <div class="card tile"><div class="rotulo">Saldo em ${ddmm(ate)}</div><div class="valor ${sinal(p.fim)}">${dinheiro(p.fim)}</div></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3>Saldo dia a dia <small>o ponto vermelho é o dia mais apertado</small></h3>
      <div id="graficoProjecao"></div>
    </div>

    <div class="card">
      <h3>O que entra e sai <small>${p.eventos.length} item(ns)</small></h3>
      ${p.eventos.length ? `<table class="tabela tabela-projecao">
        <thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th><th class="num">Saldo depois</th></tr></thead>
        <tbody>${p.eventos.map(e => `<tr>
          <td>${dataBR(e.data)}</td>
          <td>${esc(e.descricao)} ${e.atrasado ? `<span class="etiqueta ruim" title="Vencia em ${dataBR(e.original)}">atrasado</span>` : ''}
            ${e.conta ? `<small class="mudo">${esc(e.conta)}</small>` : ''}</td>
          <td class="num ${e.valor > 0 ? 'tipo-receita' : ''}">${e.valor > 0 ? '+ ' : '− '}${dinheiro(Math.abs(e.valor))}</td>
          <td class="num ${sinal(e.saldo)}">${dinheiro(e.saldo)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="vazio">Nada pendente neste período.</div>'}
    </div>`;

  graficoLinha($('#graficoProjecao'), p.dias, {
    chave: 'saldo', rotulo: 'Saldo', cor: 'var(--receita)', altura: 220,
    rotuloX: d => ddmm(d.data), titulo: d => dataBR(d.data), marcar: iMin,
  });
  $('#projPeriodo').onchange = e => { projecaoPeriodo = e.target.value; renderizar(); };
}
