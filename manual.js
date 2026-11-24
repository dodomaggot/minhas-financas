'use strict';
// Tela "Manual": guia de uso do app, por assunto, com busca.

TELAS.manual = { titulo: 'Manual', usaMes: false };

const MANUAL = [
  {
    id: 'inicio', titulo: '🚀 Primeiros passos', texto: `
<p>Faça isto uma vez, na ordem, e o app já fica pronto para o dia a dia:</p>
<ol>
  <li><b>Contas</b>: em <a data-ir="contas">Contas</a>, renomeie a "Conta principal" para o seu banco e informe o <b>saldo de hoje</b>.
    Se tiver poupança ou dinheiro na carteira, crie uma conta para cada um com <b>+ Nova conta</b>.</li>
  <li><b>Salário e contas fixas</b>: em <a data-ir="fixos">Fixos e recorrentes</a>, cadastre o salário e as contas que se repetem
    (aluguel, luz, internet, assinaturas). Elas aparecem sozinhas em todo mês.</li>
  <li><b>Cartão de crédito</b>: em <a data-ir="cartoes">Cartões de crédito</a>, cadastre cada cartão com limite, dia de fechamento e dia de vencimento.</li>
  <li><b>Sincronização</b> (opcional): para usar no celular e no computador com os mesmos dados, veja o capítulo <a data-cap="sync">Sincronização</a>.</li>
</ol>
<p>Depois disso, é só lançar os gastos do dia a dia com <b>+ Gasto</b>.</p>`,
  },
  {
    id: 'painel', titulo: '📊 Painel', texto: `
<p>É a tela inicial: um resumo do mês escolhido no topo (use ‹ › para trocar de mês; tocar no nome do mês volta para o mês atual).</p>
<ul>
  <li><b>Saldo em contas hoje</b>: soma de tudo o que já foi pago e recebido. Embaixo, o <b>previsto</b> para o fim do mês, contando o que ainda está pendente e as faturas de cartão.</li>
  <li><b>Receitas</b> e <b>Despesas do mês</b>: tudo o que entra e sai no mês, pago ou não.</li>
  <li><b>Resultado do mês</b>: receitas menos despesas, e quanto da renda já foi gasto.</li>
  <li><b>Avisos</b>: contas vencidas ou vencendo, faturas, orçamento estourado e limite do cartão. Os botões ao lado resolvem na hora (ex.: <i>Paguei</i>). O sino 🔔 no topo mostra quantos avisos existem.</li>
  <li><b>Onde mais gasto</b>: categorias do maior para o menor gasto. Toque numa categoria para ver os lançamentos dela.</li>
  <li><b>Receitas x despesas</b>: os últimos 12 meses. Toque num mês para abri-lo.</li>
  <li>Também mostra <b>contas a pagar</b>, <b>faturas</b>, <b>orçamento</b> e <b>metas</b>.</li>
</ul>`,
  },
  {
    id: 'lancamentos', titulo: '🧾 Lançar gastos e receitas', texto: `
<h4>Novo gasto</h4>
<p>Toque em <b>+ Gasto</b> no topo (no computador também pela tecla <b>N</b>) e preencha:</p>
<ul>
  <li><b>Descrição</b> e <b>valor</b> (pode digitar 1.234,56 ou 1234,56).</li>
  <li><b>Categoria</b>: o app sugere sozinho quando a descrição já foi usada antes.</li>
  <li><b>Pago com</b>: a conta de onde saiu o dinheiro ou o <b>cartão de crédito</b>.</li>
  <li><b>Parcelas</b>: para compras parceladas, informe o valor <b>total</b> e o número de parcelas. O app divide e coloca uma parcela em cada mês (ou em cada fatura do cartão).</li>
  <li><b>Começa na parcela</b>: para uma compra parcelada <b>antiga</b> que já está pela metade. Ex.: TV em 21x de R$ 100, comprada em junho, já na 6ª parcela →
    valor total 2.100,00, data da compra em junho, 21 parcelas, começa na 6. O app cria só da 6/21 à 21/21, cada uma na fatura certa.</li>
  <li><b>Tags</b> (opcional): marcadores livres, como <i>viagem</i> ou <i>reforma</i>, separados por vírgula.</li>
  <li><b>Já está pago</b>: desmarque se for uma conta que ainda vai pagar. Ela fica como <i>a pagar</i> e aparece nos avisos.</li>
</ul>
<h4>Nova receita</h4>
<p>Toque em <b>+ Receita</b> (no celular, <b>+ R</b>; no computador, tecla <b>R</b>). Use para renda extra, freelas, vendas, reembolsos.
O salário fixo é melhor cadastrar em <a data-ir="fixos">Fixos e recorrentes</a>.</p>
<h4>Tela Lançamentos</h4>
<ul>
  <li>Lista tudo do mês. Marque a caixinha para mudar entre <b>Pago/Recebido</b> e <b>A pagar/A receber</b>.</li>
  <li><b>Filtros</b>: período personalizado, tipo, conta ou cartão, categoria, tag, situação e busca pela descrição.</li>
  <li><b>📎 Comprovantes</b>: anexe foto ou PDF do recibo (no celular dá para tirar a foto na hora).</li>
  <li><b>Editar</b> e <b>Excluir</b>. Em compras parceladas, o app pergunta se exclui só aquela parcela ou também as próximas.</li>
  <li><b>Exportar CSV</b>: salva a lista (com os filtros aplicados) numa planilha que abre no Excel.</li>
</ul>
<p>Etiquetas na lista: <b>fixo</b> = criado automaticamente; <b>3/10</b> = parcela 3 de 10; <b>#tag</b>; <b>📎</b> = tem comprovante.</p>`,
  },
  {
    id: 'contas', titulo: '🏦 Contas, transferências e ajuste de saldo', texto: `
<p>Em <a data-ir="contas">Contas</a> ficam suas contas correntes, poupança, carteira e investimentos.</p>
<ul>
  <li><b>Saldo atual</b>: só o que já aconteceu. <b>Previsto</b>: soma também o que está pendente até o fim do mês escolhido.</li>
  <li><b>Extrato</b>: abre os lançamentos só daquela conta.</li>
  <li><b>Ajustar saldo</b>: se o saldo do app não bater com o do banco, informe o saldo real. A diferença vira um lançamento de ajuste, que <b>não</b> entra nos gráficos de gastos.</li>
  <li><b>Evolução do saldo</b>: gráfico com o saldo no fim de cada mês.</li>
</ul>
<h4>Transferir entre contas</h4>
<p>Use o botão <b>⇄</b> no topo (ou <i>Transferir</i> em Contas). Ex.: guardar dinheiro na poupança. Transferência não é gasto nem receita: só muda o dinheiro de lugar.</p>`,
  },
  {
    id: 'cartoes', titulo: '💳 Cartões de crédito e faturas', texto: `
<ul>
  <li>Cadastre o cartão com <b>limite</b>, <b>dia do fechamento</b>, <b>dia do vencimento</b> e a conta que paga a fatura.</li>
  <li>Ao lançar um gasto <b>pago com o cartão</b>, ele vai sozinho para a fatura certa. Compras feitas <b>no dia do fechamento ou depois</b> vão para a fatura seguinte.</li>
  <li>A compra conta como despesa no mês em que foi feita (é quando você gastou). A fatura é só a forma de pagar.</li>
  <li><b>Ver fatura</b>: mostra as compras, o total, a situação (aberta, fechada, paga, vencida) e o histórico. Use ‹ › para ver faturas anteriores ou futuras (com parcelas).</li>
  <li><b>Pagar fatura</b>: informe o valor pago (pode ser parcial) e a conta de onde saiu. O dinheiro sai da conta e o limite é liberado. O pagamento não conta como gasto de novo.</li>
  <li><b>Limite disponível</b>: limite menos as compras ainda não pagas, incluindo parcelas futuras.</li>
</ul>`,
  },
  {
    id: 'fixos', titulo: '🔁 Salário e contas fixas', texto: `
<p>Em <a data-ir="fixos">Fixos e recorrentes</a> você cadastra uma vez o que se repete, e o app cria o lançamento em todo mês como <i>a receber</i> ou <i>a pagar</i>.</p>
<h4>Exemplo: salário em duas partes (vale dia 15 e pagamento dia 30)</h4>
<ol>
  <li><b>+ Cadastrar salário</b> → Descrição <i>Vale</i>, valor líquido, dia <b>15</b>, categoria Salário, conta onde cai.</li>
  <li><b>+ Cadastrar salário</b> de novo → Descrição <i>Pagamento</i>, valor, dia <b>30</b>.</li>
</ol>
<p>Em fevereiro, dia 30 vira automaticamente o último dia do mês. Quando o dinheiro cair, marque como <b>Recebido</b>.</p>
<h4>Contas fixas e assinaturas</h4>
<ul>
  <li><b>+ Nova conta fixa</b>: aluguel, luz, internet, Netflix… Escolha se paga com conta ou cartão (assinaturas no cartão entram direto na fatura).</li>
  <li><b>Repete</b>: todo mês, a cada 2, 3 ou 6 meses, ou uma vez por ano (ex.: IPVA, IPTU, seguro).</li>
</ul>
<h4>Quando o valor muda</h4>
<ul>
  <li><b>Só neste mês</b> (ex.: conta de luz veio diferente): edite o lançamento do mês em Lançamentos.</li>
  <li><b>De vez</b> (ex.: aumento de salário): <b>Editar</b> o cadastro. Vale do mês atual em diante.</li>
  <li><b>Parou de existir</b>: <b>Encerrar</b>. Os meses anteriores continuam no histórico.</li>
</ul>`,
  },
  {
    id: 'orcamento', titulo: '🎯 Orçamento por categoria', texto: `
<p>Em <a data-ir="orcamento">Orçamento</a>, defina o máximo que quer gastar por mês em cada categoria (ex.: Mercado R$ 800).</p>
<ul>
  <li>O limite vale para todos os meses e inclui as subcategorias.</li>
  <li>A barra fica <b>amarela</b> a partir de 80% e <b>vermelha</b> quando estoura, com aviso no Painel.</li>
  <li>Para remover um limite, deixe o valor vazio ou 0.</li>
</ul>`,
  },
  {
    id: 'metas', titulo: '🏁 Metas', texto: `
<p>Em <a data-ir="metas">Metas</a>, crie objetivos como reserva de emergência, viagem ou carro, com valor e prazo.</p>
<ul>
  <li><b>+ Guardar</b>: registre quanto separou para a meta. <b>Retirar</b>: se precisar usar.</li>
  <li>O app mostra a porcentagem atingida e <b>quanto guardar por mês</b> para chegar no prazo.</li>
  <li>As metas são um controle à parte: não mexem no saldo das contas. Se quiser, transfira de verdade para a poupança com ⇄.</li>
</ul>`,
  },
  {
    id: 'projecao', titulo: '📈 Projeção do saldo (quanto falta até o salário)', texto: `
<p>Em <a data-ir="projecao">Projeção do saldo</a>, o app soma <b>dia a dia</b> o que ainda vai entrar e sair: contas a pagar,
salário e contas fixas dos próximos meses, e as faturas dos cartões na data de vencimento. O que está atrasado entra como se fosse pago hoje.</p>
<ul>
  <li>Escolha o período: até o fim deste mês, do próximo mês, ou 90 dias.</li>
  <li>O quadro de cima mostra se o saldo fica negativo, <b>em que dia</b> fica mais apertado e <b>quanto falta</b> para não ficar no negativo.</li>
  <li>O gráfico mostra o saldo de cada dia (o ponto vermelho é o dia mais baixo) e a lista mostra cada entrada/saída com o saldo depois dela.</li>
  <li>A conta só é tão boa quanto os dados: confira o saldo das contas (Contas → Ajustar saldo) e se o salário, as contas fixas e as faturas estão no app.</li>
</ul>`,
  },
  {
    id: 'categorias', titulo: '🏷️ Categorias e tags', texto: `
<ul>
  <li>Em <a data-ir="categorias">Categorias e tags</a>, crie, renomeie ou exclua categorias de gastos e de receitas.</li>
  <li><b>Subcategorias</b>: use <b>+ Sub</b> (ex.: Alimentação fora › Delivery). Nos gráficos, elas somam dentro da categoria principal.</li>
  <li>Categoria já usada não some do histórico: ela só fica escondida para novos lançamentos.</li>
  <li><b>Tags</b> são criadas ao digitar no campo Tags de um lançamento. Aqui dá para renomear, excluir ou ver todos os lançamentos de uma tag.</li>
</ul>`,
  },
  {
    id: 'config', titulo: '⚙️ Configurações: aparência, importar e backup', texto: `
<h4>Aparência</h4>
<p>Modo <b>Automático</b> (segue o celular/computador), <b>Claro</b> ou <b>Escuro</b>, e a <b>cor de destaque</b>. Vale só para o aparelho onde foi escolhido.</p>
<h4>Importar extrato do banco</h4>
<ol>
  <li>No app ou site do banco, baixe o extrato (ou a fatura do cartão) em <b>OFX</b> — o mais confiável — ou <b>CSV</b>.</li>
  <li>Em <a data-ir="ferramentas">Configurações</a>, escolha para qual conta ou cartão importar e toque em <b>Escolher arquivo</b>.</li>
  <li>Revise a lista: o app sugere categorias e desmarca o que parece já lançado. Ajuste e toque em <b>Importar</b>.</li>
</ol>
<h4>Fatura do cartão Nubank (CSV)</h4>
<ol>
  <li>No app do Nubank, abra a fatura do mês e exporte em CSV (o arquivo vem com nome tipo <code>Nubank_2026-12-24.csv</code>).</li>
  <li>Em Configurações, escolha o <b>cartão Nubank</b> em "Importar para" e selecione um ou <b>vários arquivos</b> de uma vez.</li>
  <li>O app coloca cada compra na fatura certa (pelo nome do arquivo), ignora o "Pagamento recebido", junta as parcelas da mesma compra
    (ex.: <i>Maze - Parcela 2/10</i>) e oferece criar as <b>parcelas futuras</b>.</li>
  <li>Pode importar de novo a fatura do mês em aberto quantas vezes quiser: o que já foi importado aparece como "já lançado?" e fica desmarcado.</li>
</ol>
<p>Dica: cadastre o cartão Nubank com o mesmo fechamento e vencimento da sua fatura (normalmente o fechamento é 7 dias antes do vencimento).</p>
<h4>Fatura em PDF (Mercado Pago e Nubank)</h4>
<ul>
  <li>Baixe o <b>PDF da fatura</b> no app do banco e importe do mesmo jeito, escolhendo o cartão. O app lê as compras do PDF.</li>
  <li>No <b>Mercado Pago</b>, as parcelas mostram a data original da compra (ex.: "17/07 … Parcela 16 de 21"): o app coloca a parcela no mês certo
    e guarda a data da compra na observação. Compras parceladas iguais (ex.: duas "NATURA PAY 1/3" no mesmo dia) ficam separadas.</li>
  <li>O "Pagamento da fatura" que aparece no PDF é ignorado — registre o pagamento em Cartões → Pagar fatura.</li>
  <li>Cartão Mercado Pago: cadastre com o fechamento e o vencimento que aparecem em "Datas importantes" no fim do PDF.</li>
</ul>
<h4>Exportar e cópia de segurança</h4>
<ul>
  <li><b>Exportar planilha</b>: lançamentos de um período em CSV (abre no Excel).</li>
  <li><b>Salvar cópia</b>: arquivo com todos os seus dados. No iPhone, escolha "Salvar em Arquivos" (iCloud Drive). Faça isso de vez em quando.</li>
  <li><b>Restaurar cópia</b>: volta os dados de um arquivo salvo (também serve para trazer os dados do app antigo do Windows).</li>
</ul>`,
  },
  {
    id: 'sync', titulo: '☁️ Sincronização (celular + computador)', texto: `
<p>Seus dados ficam guardados no aparelho. Com a sincronização ligada, uma cópia <b>criptografada</b> vai para o repositório <b>privado</b> <code>financas-dados</code> no seu GitHub,
e os outros aparelhos baixam de lá.</p>
<h4>Ligar num aparelho</h4>
<ol>
  <li>Menu <a data-ir="sincronizacao">Sincronização</a>.</li>
  <li>Preencha <b>usuário</b> do GitHub, <b>repositório</b> (<code>financas-dados</code>), o <b>token</b> e a <b>senha dos dados</b>.</li>
  <li>Toque em <b>Conectar</b>. No segundo aparelho, use o <b>mesmo token e a mesma senha</b>: ele baixa os dados da nuvem.</li>
</ol>
<h4>Token × senha</h4>
<ul>
  <li><b>Token</b>: chave criada no site do GitHub, com acesso só ao <code>financas-dados</code> e permissão <i>Contents: Read and write</i>. Não compartilhe com ninguém.</li>
  <li><b>Senha dos dados</b>: senha que <b>você inventa</b> no app (não é a senha do GitHub). Ela embaralha os dados antes de sair do aparelho. <b>Se esquecer, os dados da nuvem não podem ser recuperados</b> — anote num lugar seguro.</li>
</ul>
<h4>No dia a dia</h4>
<ul>
  <li>O ícone ☁︎ no topo mostra a situação: sincronizado, enviando, alterações pendentes ou sem internet.</li>
  <li>As alterações são enviadas segundos depois de feitas, e o app confere a nuvem ao abrir. Sem internet funciona normal e envia quando a conexão voltar.</li>
  <li>Se dois aparelhos mudarem ao mesmo tempo, o app pergunta qual versão manter. A outra fica em <b>Cópias locais</b> (na tela Sincronização), de onde pode ser recuperada.</li>
  <li>Token vencido? Gere um novo no GitHub, toque em <b>Desconectar este aparelho</b> e conecte de novo com o token novo e a mesma senha.</li>
</ul>`,
  },
  {
    id: 'instalar', titulo: '📱 Instalar no iPhone e no computador', texto: `
<p>Endereço do app: <code>https://dodomaggot.github.io/minhas-financas/</code></p>
<ul>
  <li><b>iPhone</b>: abra o endereço no <b>Safari</b> → botão <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</li>
  <li><b>Computador</b>: abra no <b>Chrome</b> ou <b>Edge</b> → ícone de instalar na barra de endereço (ou menu ⋮ → Instalar app).</li>
  <li>Depois de aberto uma vez, o app funciona <b>sem internet</b>.</li>
  <li><b>Atualizações</b> chegam sozinhas: feche e abra o app com internet. A versão aparece no fim do menu lateral.
    No iPhone, se continuar na versão antiga, feche o app de vez (arraste para cima na lista de apps abertos) e abra de novo.</li>
  <li>⚠ Se apagar o app da tela de início do iPhone, os dados daquele aparelho são apagados junto. Com a sincronização ligada, basta instalar e conectar de novo.</li>
</ul>`,
  },
  {
    id: 'duvidas', titulo: '❓ Dúvidas comuns', texto: `
<h4>O saldo do app não bate com o do banco.</h4>
<p>Confira se há lançamentos <i>a pagar</i> que já foram pagos (marque como pago). Se ainda assim não bater, use <b>Contas → Ajustar saldo</b>.</p>
<h4>Por que a compra no cartão aparece no mês da compra, e não no mês da fatura?</h4>
<p>Porque é quando você gastou — assim o "onde mais gasto" mostra a realidade do mês. A fatura aparece separada, no Painel e em Cartões, na data de vencimento.</p>
<h4>Lancei uma parcela errada.</h4>
<p>Edite só aquela parcela, ou exclua escolhendo "Esta e as próximas" e lance a compra de novo.</p>
<h4>Apareceu "Senha incorreta" ao conectar.</h4>
<p>É a <b>senha dos dados</b> criada no primeiro aparelho (não a do GitHub). Digite exatamente igual.</p>
<h4>Apareceu "Token inválido" ou "sem permissão de escrita".</h4>
<p>Gere um novo token com acesso ao <code>financas-dados</code> e <i>Contents: Read and write</i>.</p>
<h4>Meus dados estão seguros?</h4>
<p>Ficam no seu aparelho e, se ligar a sincronização, num repositório privado seu, criptografados com a sua senha. O site do app guarda só o programa, nenhum dado.</p>`,
  },
];

function tela_manual() {
  const el = $('#conteudo');
  el.innerHTML = `
    <div class="manual">
      <div class="card manual-topo">
        <p class="ajuda" style="margin:0 0 10px">Guia rápido do Minhas Finanças. Toque num assunto para abrir, ou busque uma palavra.</p>
        <input type="search" id="manualBusca" placeholder="Buscar no manual (ex.: fatura, salário, token)…">
        <div class="manual-indice">${MANUAL.map(c => `<button class="botao pequeno" data-cap="${c.id}">${c.titulo}</button>`).join('')}</div>
      </div>
      ${MANUAL.map(c => `<details class="card manual-cap" id="cap-${c.id}"><summary>${c.titulo}</summary><div class="manual-texto">${c.texto}</div></details>`).join('')}
      <p class="ajuda manual-vazio" hidden>Nada encontrado para essa busca.</p>
    </div>`;

  const abrirCapitulo = id => {
    const cap = $('#cap-' + id);
    if (!cap) return;
    cap.open = true;
    cap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  el.querySelectorAll('[data-cap]').forEach(b => b.onclick = e => { e.preventDefault(); abrirCapitulo(b.dataset.cap); });
  el.querySelectorAll('.manual-texto a[data-ir]').forEach(a => { a.href = '#'; a.onclick = e => { e.preventDefault(); irPara(a.dataset.ir); }; });
  el.querySelectorAll('.manual-texto a[data-cap]').forEach(a => { a.href = '#'; });

  // Busca: mostra só os capítulos que têm a palavra e já deixa abertos.
  const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  $('#manualBusca').oninput = e => {
    const termo = semAcento(e.target.value.trim());
    let algum = false;
    $$('.manual-cap').forEach(cap => {
      const achou = !termo || semAcento(cap.textContent).includes(termo);
      cap.hidden = !achou;
      cap.open = !!termo && achou;
      algum = algum || achou;
    });
    $('.manual-vazio').hidden = algum;
  };
}
