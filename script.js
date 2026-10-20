/* =========================================================================
   AI-901 · Simulado
   Consome window.QUIZ_DATA (gerado por gerar-dados.mjs). Não faz parsing
   de Markdown em runtime: enunciados, alternativas e gabarito já vêm
   resolvidos e verificados contra a origem.

   Quatro modos:
     · teste         — pontua, destaca erro em vermelho, mostra resultado ao final
     · estudo        — não pontua, revela a resposta, serve para revisar
     · estudo rápido — o modo de estudo com uma rodada curta
     · grande desafio — o acervo inteiro, sorteado, com pontuação

   As alternativas são RENUMERADAS na ordem em que aparecem (1, 2, 3, 4).
   A marca de "correta" viaja com a alternativa, então o número exibido
   nunca fica desconectado do texto. Nas questões com mais de uma resposta,
   a marcação é múltipla; nos demais tipos, há um único gabarito por item.
   ========================================================================= */
(function () {
  "use strict";

  var D = window.QUIZ_DATA || { questoes: [] };

  /* ---------------------------------------------------------------- dados */

  var DISPONIVEIS = D.questoes.filter(function (q) {
    return q.origem === "pdf";
  });

  /* As questões que o PDF não traz com gabarito continuam em dados.js, mas
     o filtro acima já as deixa de fora: nenhum modo as oferece. O campo
     "origem" é a autoridade — o gerador rebaixa para "sem-resposta" também
     quando o gabarito existe mas é inválido. */

  /* Cada modo define quantas questões a rodada sorteia. O "estudo rápido" é
     o modo de estudo com uma rodada curta. O "grande desafio" não tem teto:
     percorre o acervo inteiro. */
  var TAMANHOS = { teste: 40, estudo: 40, rapido: 20 };

  function tamanhoDoModo(modo) {
    return TAMANHOS[modo] || 40;
  }

  /* O grande desafio não tem teto de tamanho: sua rodada é o acervo todo,
     só que sorteado. */
  function ehIntegral(modo) {
    return modo === "grande";
  }

  /* Teste e grande desafio pontuam. Estudo e estudo rápido apenas revelam:
     a resposta aparece, mas nada é somado. */
  var PONTUADOS = ["teste", "grande"];

  function ehPontuado(modo) {
    return PONTUADOS.indexOf(modo) >= 0;
  }

  /* -------------------------------------------------------------- estado */

  var estado = {
    modo: null,
    origem: "rodada", // "rodada" | "erros"
    rodada: [],
    indice: 0,
    acertos: 0,
    erros: 0,
    registro: [],
    selecao: null,
    fase: "responder" // "responder" | "revelado"
  };

  var el = function (id) { return document.getElementById(id); };

  function mostrar(id) { el(id).hidden = false; }
  function esconder(id) { el(id).hidden = true; }

  /* ---------------------------------------------------------------- tema */

  var CHAVE_TEMA = "ai901:tema";
  var TEMAS = ["claro", "escuro"];

  /* Só aceita os dois temas conhecidos. Qualquer outra coisa salva antes
     (ou um item corrompido) cai no claro. */
  function normalizarTema(valor) {
    return TEMAS.indexOf(valor) >= 0 ? valor : "claro";
  }

  function aplicarTema(tema) {
    var alvo = normalizarTema(tema);
    document.documentElement.setAttribute("data-tema", alvo);
    sincronizarBotaoTema(alvo);
    try {
      localStorage.setItem(CHAVE_TEMA, alvo);
    } catch (e) {
      // Sem armazenamento (modo privado, jsdom): o tema segue valendo na sessão.
    }
    return alvo;
  }

  function temaAtual() {
    return normalizarTema(document.documentElement.getAttribute("data-tema"));
  }

  /* Lê o atributo do elemento raiz, não a storage: se a gravação falhou,
     a alternância continua funcionando nesta sessão. */
  function alternarTema() {
    return aplicarTema(temaAtual() === "escuro" ? "claro" : "escuro");
  }

  function sincronizarBotaoTema(tema) {
    var btn = el("btn-tema");
    if (!btn) return;
    var escuro = tema === "escuro";
    btn.setAttribute("aria-pressed", escuro ? "true" : "false");
    var rotulo = el("btn-tema-rotulo");
    if (rotulo) rotulo.textContent = escuro ? "Ativar tema claro" : "Ativar tema escuro";
  }

  /* ------------------------------------------------------- fisher-yates */

  function embaralhar(lista) {
    var a = lista.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* Prepara a questão para exibição.
     - alternativas: sempre embaralhadas. A ordem original A, B, C… é
       descartada de propósito, senão a posição da alternativa passa a
       denunciar a resposta.
     - afirmações: mantidas na ordem original, porque o gabarito é posicional
     - associações: destinos na ordem original (gabarito posicional),
       apenas a lista de valores arrastáveis é embaralhada */
  function preparar(q) {
    var vista = { id: q.id, tipo: q.tipo, formato: q.formato, prompt: q.prompt, codigo: q.codigo, tabelas: q.tabelas };

    if (q.formato === "alternativas") {
      vista.alternativas = embaralhar(q.alternativas).map(function (a) {
        return { texto: a.texto, correta: a.correta, letraOrigem: a.letra };
      });
      var corretas = q.alternativas.filter(function (a) { return a.correta; }).length;
      vista.totalCorretas = corretas;
      vista.multi = corretas > 1;
    } else if (q.formato === "afirmacoes") {
      vista.afirmacoes = q.afirmacoes;
      vista.total = vista.afirmacoes.length;
    } else if (q.formato === "associacoes") {
      vista.codigo = q.codigo;
      vista.destinos = q.destinos;
      vista.gabarito = q.gabarito; // ordem posicional: item N do destino = gabarito[N]
      vista.valores = embaralhar(q.valores);
      vista.total = q.destinos.length;
    }
    return vista;
  }

  /* Todos os modos sorteiam de DISPONIVEIS, embaralhados. Os modos de treino
     cortam em TAMANHOS; o grande desafio, sem teto, leva o acervo inteiro —
     também embaralhado, porque a ordem do material de origem denunciaria a
     sequência das questões. */
  function sortearRodada(modo) {
    var alvo = ehIntegral(modo) ? DISPONIVEIS.length : tamanhoDoModo(modo);
    return embaralhar(DISPONIVEIS).slice(0, Math.min(alvo, DISPONIVEIS.length)).map(preparar);
  }

  /* ------------------------------------------------------------ helpers */

  // Escreve na região invisível que leitores de tela anunciam. Limpar antes de
  // escrever garante que a mudança seja detectada mesmo repetindo a mesma frase.
  function anunciar(texto) {
    var alvo = el("anuncio");
    alvo.textContent = "";
    window.setTimeout(function () { alvo.textContent = texto; }, 40);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function comCodigo(txt) {
    return esc(txt).replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function paragrafos(txt) {
    return String(txt).split(/\n{2,}/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean)
      .map(function (p) { return "<p>" + comCodigo(p).replace(/\n/g, "<br>") + "</p>"; })
      .join("");
  }

  /* Tabelas de conteúdo do enunciado (o gerador já vem com cabeçalho e
   células resolvidos; aqui não há parsing de Markdown). O único elemento
   traduzido é a quebra de linha interna da célula — é assim que a origem
   guarda vários itens numa célula só. */
function celula(txt) {
    // A quebra de linha é a única marcação traduzida. Ela precisa ser
    // reconhecida ANTES do escape: depois de escapada, "<br>" já é "&lt;br&gt;".
    return String(txt)
      .split(/<br\s*\/?>/i)
      .map(function (p) { return esc(p); })
      .join("<br>");
  }

  function tabelaPorLinha(t) {
    // 1 linha de dados e 2 colunas: o cabeçalho da origem identifica a
    // LINHA, não a coluna. Uma linha por coluna da origem, com o rótulo
    // marcado como cabeçalho de linha — é esse papel que faz um leitor de
    // tela anunciar "Entrada" junto com o texto que segue.
    var celulas = t.linhas[0];
    var linhas = t.cabecalho
      .map(function (rotulo, i) {
        return "<tr><th scope=\"row\">" + celula(rotulo) + "</th><td>" +
          celula(celulas[i] === undefined ? "" : celulas[i]) + "</td></tr>";
      })
      .join("");
    return '<table class="tabela-enunciado tabela-por-linha"><tbody>' + linhas + "</tbody></table>";
  }

  function tabelaPorColuna(t) {
    var cab = t.cabecalho
      .map(function (c) { return "<th>" + celula(c) + "</th>"; })
      .join("");
    var linhas = t.linhas
      .map(function (l) {
        return "<tr>" + l.map(function (c) { return "<td>" + celula(c) + "</td>"; }).join("") + "</tr>";
      })
      .join("");
    return '<table class="tabela-enunciado"><thead><tr>' + cab + "</tr></thead><tbody>" + linhas + "</tbody></table>";
  }

  /* O layout é escolhido pela FORMA da tabela, não pela origem: só 1×2 é
     transposto. Qualquer outro formato — inclusive uma tabela futura com
     mais colunas ou mais linhas — fica no caminho de colunas, que é o
     comportamento conhecido. */
  function tabelas(lista) {
    if (!lista || !lista.length) return "";
    return lista
      .map(function (t) {
        var duasColunas = t.cabecalho.length === 2 && t.linhas.length === 1 &&
          t.linhas[0].length === 2;
        return duasColunas ? tabelaPorLinha(t) : tabelaPorColuna(t);
      })
      .join("");
  }

  /* --------------------------------------------------------- TELA INICIO */

  function montarInicio() {
    // A contagem vem do acervo real, não do HTML: o número envelhece sozinho
    // conforme as questões entram ou saem.
    el("btn-modo-grande-desafio-desc").textContent =
      DISPONIVEIS.length +
      (DISPONIVEIS.length === 1 ? " questão em ordem aleatória, com pontuação" :
        " questões em ordem aleatória, com pontuação");

    // Cada botão é habilitado pelo tamanho do conjunto que ele sorteia.
    [["btn-modo-teste", DISPONIVEIS], ["btn-modo-estudo", DISPONIVEIS],
     ["btn-modo-rapido", DISPONIVEIS], ["btn-modo-grande-desafio", DISPONIVEIS]]
      .forEach(function (par) {
        el(par[0]).disabled = par[1].length === 0;
      });
  }

  function comecar(modo) {
    estado.modo = modo;
    estado.rodada = sortearRodada(modo);
    estado.indice = 0;
    estado.acertos = 0;
    estado.erros = 0;
    estado.registro = [];
    estado.origem = "rodada";
    esconder("tela-inicio");
    esconder("tela-fim");
    mostrar("tela-jogo");
    renderizar();
  }

  function sair() {
    esconder("tela-jogo");
    esconder("tela-fim");
    mostrar("tela-inicio");
  }

  /* ---------------------------------------------------------- RENDERIZAR */

  function renderizar() {
    var q = estado.rodada[estado.indice];
    var total = estado.rodada.length;
    var n = estado.indice + 1;

    estado.selecao = {};
    estado.fase = "responder";

    el("trilho-fill").style.width = ((estado.indice / total) * 100) + "%";
    el("topo-texto").textContent = n + " de " + total;
    el("numero-questao").textContent = "Questão " + q.id;
    el("etiqueta-tipo").textContent = q.tipo;

    el("enunciado").innerHTML = paragrafos(q.prompt) + tabelas(q.tabelas);

    if (q.codigo) {
      el("codigo").textContent = q.codigo;
      el("codigo").hidden = false;
    } else {
      el("codigo").hidden = true;
    }

    var alvo = el("respostas");
    alvo.innerHTML = "";

    if (q.formato === "alternativas") montarAlternativas(alvo, q);
    else if (q.formato === "afirmacoes") montarAfirmacoes(alvo, q);
    else if (q.formato === "associacoes") montarAssociacoes(alvo, q);

    el("anuncio").textContent = "";

    // Todo modo tem gabarito: quem responde habilita o Verificar, e só depois
    // de verificar o Próxima assume o lugar.
    var verificar = el("btn-verificar");
    verificar.hidden = false;
    verificar.disabled = true;
    verificar.textContent = "Verificar";

    var avancar = el("btn-avancar");
    avancar.hidden = true;
    avancar.textContent = "Próxima";

    window.scrollTo(0, 0);
  }

  /* Chamado por cada formato quando a resposta muda: libera o Verificar. */
  function liberarAcao(completo) {
    el("btn-verificar").disabled = !completo;
  }

  function campo(titulo) {
    var fs = document.createElement("fieldset");
    var lg = document.createElement("legend");
    lg.textContent = titulo;
    fs.appendChild(lg);
    return fs;
  }

  /* -- alternativas: numeração 1..N na ordem exibida -- */
  function montarAlternativas(alvo, q) {
    var fs = campo(q.multi
      ? "Selecione todas as alternativas corretas"
      : "Selecione uma alternativa");

    q.alternativas.forEach(function (alt, i) {
      var lab = document.createElement("label");
      lab.className = "alternativa" + (q.multi ? " multi" : "");
      lab.setAttribute("for", "alt-" + i);

      var inp = document.createElement("input");
      inp.type = q.multi ? "checkbox" : "radio";
      inp.name = "alt";
      inp.id = "alt-" + i;
      inp.value = String(i);

      var marca = document.createElement("span");
      marca.className = "marca-num";
      marca.textContent = String(i + 1);
      marca.setAttribute("aria-hidden", "true");

      var txt = document.createElement("span");
      txt.className = "alternativa-texto";
      txt.innerHTML = comCodigo(alt.texto);

      lab.appendChild(inp);
      lab.appendChild(marca);
      lab.appendChild(txt);

      inp.addEventListener("change", function () {
        if (q.multi) {
          var marcados = [];
          fs.querySelectorAll("input:checked").forEach(function (x) {
            marcados.push(parseInt(x.value, 10));
          });
          estado.selecao = marcados;
        } else {
          estado.selecao = [parseInt(inp.value, 10)];
        }
        fs.querySelectorAll(".alternativa").forEach(function (l) {
          l.classList.remove("selecionada");
        });
        fs.querySelectorAll("input:checked").forEach(function (x) {
          x.closest(".alternativa").classList.add("selecionada");
        });
        liberarAcao(true);
      });

      fs.appendChild(lab);
    });

    alvo.appendChild(fs);
  }

  /* -- afirmações: um par Sim/Não por item -- */
  function montarAfirmacoes(alvo, q) {
    var fs = campo("Responda Sim ou Não para cada afirmação");

    q.afirmacoes.forEach(function (af, i) {
      var bloco = document.createElement("div");
      bloco.className = "afirmacao";

      var p = document.createElement("p");
      p.className = "afirmacao-texto";
      p.innerHTML = comCodigo(af.texto);

      var par = document.createElement("div");
      par.className = "par-botoes";

      [["Sim", "sim", true], ["Não", "nao", false]].forEach(function (par2) {
        var lab = document.createElement("label");
        lab.className = "par-btn";
        lab.setAttribute("for", "af" + i + "-" + par2[1]);

        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "af" + i;
        inp.id = "af" + i + "-" + par2[1];
        inp.value = par2[0];

        var t = document.createElement("span");
        t.textContent = par2[0];
        lab.appendChild(inp);
        lab.appendChild(t);

        inp.addEventListener("change", function () {
          estado.selecao[i] = par2[0];
          bloco.querySelectorAll(".par-btn").forEach(function (b) {
            b.classList.remove("selecionado");
          });
          lab.classList.add("selecionado");
          var respondidas = Object.keys(estado.selecao).length;
          liberarAcao(respondidas >= q.total);
        });

        par.appendChild(lab);
      });

      bloco.appendChild(p);
      bloco.appendChild(par);
      fs.appendChild(bloco);
    });

    alvo.appendChild(fs);
  }

  /* -- associações: um seletor por destino -- */
  function montarAssociacoes(alvo, q) {
    var fs = campo("Associe um valor a cada destino");

    q.destinos.forEach(function (dest, i) {
      var linha = document.createElement("div");
      linha.className = "assoc";

      var lb = document.createElement("p");
      lb.className = "assoc-destino";
      lb.innerHTML = comCodigo(dest);

      var sel = document.createElement("select");
      sel.id = "dest-" + i;
      sel.setAttribute("aria-label", "Valor para: " + dest.replace(/<[^>]*>/g, ""));

      var vazio = document.createElement("option");
      vazio.value = "";
      vazio.textContent = "— selecione —";
      sel.appendChild(vazio);

      q.valores.forEach(function (v) {
        var o = document.createElement("option");
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      });

      sel.addEventListener("change", function () {
        if (sel.value) estado.selecao[i] = sel.value;
        else delete estado.selecao[i];
        var n = Object.keys(estado.selecao).length;
        liberarAcao(n >= q.total);
      });

      linha.appendChild(lb);
      linha.appendChild(sel);
      fs.appendChild(linha);
    });

    alvo.appendChild(fs);
  }

  /* ------------------------------------------------------------ AVALIAR */

  function avaliar() {
    var q = estado.rodada[estado.indice];
    // O feedback por questão é idêntico em todos os modos: revela a correta em
    // verde e pinta a escolhida em vermelho. O que muda é o fim da rodada —
    // estudo e estudo rápido não mantêm nota.
    var certo = false;
    var titulo = "";
    var detalhe = "";

    if (q.formato === "alternativas") {
      var escolhidas = (estado.selecao || []).slice().sort();
      var corretas = [];
      q.alternativas.forEach(function (a, i) { if (a.correta) corretas.push(i); });
      corretas.sort();

      certo = escolhidas.length === corretas.length &&
        escolhidas.every(function (v, i) { return v === corretas[i]; });

      var fs = document.querySelector("#respostas fieldset");
      fs.querySelectorAll("input").forEach(function (x) { x.disabled = true; });
      fs.querySelectorAll(".alternativa").forEach(function (lab, i) {
        var marcada = corretas.indexOf(i) >= 0;
        if (marcada) lab.classList.add("correta");
        else if (escolhidas.indexOf(i) >= 0) lab.classList.add("errada");
      });

      var pos = corretas.map(function (i) { return i + 1; }).join(", ");
      titulo = certo ? "Correto!" : "Incorreto";
      detalhe = certo
        ? (q.multi ? "Marcou todas as corretas." : "Alternativa " + pos + ".")
        : (q.multi ? "Corretas: " + pos + "." : "A correta é a " + pos + ".");
    } else if (q.formato === "afirmacoes") {
      var acertos = 0;
      var erros = [];
      var fs2 = document.querySelector("#respostas fieldset");
      fs2.querySelectorAll("input").forEach(function (x) { x.disabled = true; });

      q.afirmacoes.forEach(function (af, i) {
        var esperada = af.correta ? "Sim" : "Não";
        var minha = estado.selecao[i];
        var bloco = fs2.querySelector("#af" + i + "-" + (af.correta ? "sim" : "nao")).closest(".par-btn");
        bloco.classList.add("correto");
        if (minha === esperada) acertos++;
        else {
          erros.push((i + 1) + " (" + minha + ", era " + esperada + ")");
          if (minha) {
            var marcado = fs2.querySelector("#af" + i + "-" + (minha === "Sim" ? "sim" : "nao")).closest(".par-btn");
            marcado.classList.add("errado");
          }
        }
      });

      certo = acertos === q.total;
      titulo = certo ? "Tudo certo!" : acertos + " de " + q.total;
      detalhe = certo ? "Todas as afirmações corretas." : "Erradas: " + erros.join("; ") + ".";
    } else if (q.formato === "associacoes") {
      var ok = true;
      var linhasErradas = [];
      var fs3 = document.querySelector("#respostas fieldset");
      fs3.querySelectorAll("select").forEach(function (x) { x.disabled = true; });

      q.destinos.forEach(function (dest, i) {
        var sel = fs3.querySelector("#dest-" + i);
        var esperada = q.gabarito[i];
        var minha = estado.selecao[i];
        if (minha === esperada) {
          sel.classList.add("correto");
        } else {
          ok = false;
          sel.classList.add("errado");
          linhasErradas.push("“" + dest.replace(/<[^>]*>/g, "").slice(0, 60) + "…” → " + esperada);
        }
      });

      certo = ok;
      titulo = certo ? "Correto!" : "Incorreto";
      detalhe = certo
        ? "Todas as associações corretas."
        : "Correto seria: " + linhasErradas.join(" | ");
    }

    // O registro é sempre alimentado: é dele que sai a lista de revisão
    // de erros. A pontuação, essa, só existe nos modos pontuados.
    estado.registro.push({ id: q.id, certo: certo, resumo: resumoCurto(q) });
    if (ehPontuado(estado.modo)) {
      if (certo) estado.acertos++;
      else estado.erros++;
    }

    estado.fase = "revelado";

    // O resultado é comunicado pelas marcações nas alternativas. O texto vai
    // apenas para a região invisível, que existe para leitores de tela.
    anunciar(certo ? titulo + " " + detalhe : "Incorreto. " + detalhe);

    el("btn-verificar").hidden = true;
    var prox = el("btn-avancar");
    prox.hidden = false;
    prox.textContent = estado.indice === estado.rodada.length - 1 ? "Ver resultado" : "Próxima";
    prox.focus();
  }

  function resumoCurto(q) {
    var t = q.prompt.replace(/\s+/g, " ");
    return t.length > 90 ? t.slice(0, 90) + "…" : t;
  }

  function avancar() {
    if (estado.indice < estado.rodada.length - 1) {
      estado.indice++;
      renderizar();
    } else {
      mostrarResultado();
    }
  }

  /* ------------------------------------------------------ TELA RESULTADO */

  /* ------------------------------------------------- DONUT DE RESULTADO */

  // Desenha o donut com dois arcos: verde para acertos, vermelho para erros.
  // A contagem vem sempre do registro, então o gráfico funciona igual nos
  // modos com e sem placar.
  function desenharDonut(acertos, erros) {
    var total = acertos + erros;
    var pct = total ? (acertos / total) * 100 : 0;
    var C = 2 * Math.PI * 52;

    var arcoAcerto = el("donut-acerto");
    var arcoErro = el("donut-erro");

    // Estado zerado antes de medir, senão o segundo round anima a partir do
    // desenho anterior e o preenchimento fica torto.
    arcoAcerto.style.strokeDasharray = String(C) + " " + String(C);
    arcoAcerto.style.strokeDashoffset = "0";
    arcoErro.style.strokeDasharray = String(C) + " " + String(C);
    arcoErro.style.strokeDashoffset = "0";

    if (total) {
      var comprimentoAcerto = C * pct / 100;
      arcoAcerto.style.strokeDasharray = String(comprimentoAcerto) + " " + String(C);
      arcoErro.style.strokeDasharray = String(C - comprimentoAcerto) + " " + String(C);
      arcoErro.style.strokeDashoffset = String(-comprimentoAcerto);
    }

    el("donut-pct").textContent = Math.round(pct) + "%";
    el("donut-desc").textContent = total
      ? pct + "% de acerto: " + acertos + " acertos e " + erros + " erros em " + total + " questões."
      : "Sem respostas registradas.";

    el("legenda-acerto").textContent = String(acertos);
    el("legenda-erro").textContent = String(erros);
    el("legenda-total").textContent = String(total);
    el("legenda-acerto-pct").textContent = (total ? (pct).toFixed(1) : "0.0") + "%";
    el("legenda-erro-pct").textContent = (total ? (100 - pct).toFixed(1) : "0.0") + "%";

    return pct;
  }

  function mostrarResultado() {
    esconder("tela-jogo");
    mostrar("tela-fim");

    var total = estado.rodada.length;
    var acertos = estado.registro.filter(function (r) { return r.certo; }).length;
    var erros = estado.registro.filter(function (r) { return !r.certo; }).length;

    var pct = desenharDonut(acertos, erros);

    // Botão de revisão só existe quando há o que revisar.
    var btnRevisar = el("btn-revisar-erros");
    btnRevisar.hidden = erros === 0;
    btnRevisar.textContent = "Revisar só os erros (" + erros + ")";

    var msg;
    if (erros === 0 && total) msg = "Perfeito: todas as " + total + " questões corretas.";
    else if (pct >= 90) msg = "Excelente. Você está pronto para a prova.";
    else if (pct >= 75) msg = "Muito bom. Revise os " + erros + " erro(s) para fechar.";
    else if (pct >= 60) msg = "Bom começo. Ainda dá para subir bastante.";
    else if (pct >= 40) msg = "Abaixo do ideal. Vale revisar o material e repetir.";
    else msg = "Precisa estudar mais. Tente o modo estudo antes de novo.";

    el("fim-titulo").textContent =
      erros === 0 && total ? "Rodada perfeita!" : pct >= 75 ? "Boa rodada!" : "Rodada concluída";
    el("fim-sub").textContent = msg;
    el("btn-reiniciar").textContent = ehPontuado(estado.modo)
      ? "Jogar novamente"
      : "Revisar outras " + tamanhoDoModo(estado.modo);
  }

  /* --------------------------------------------------- revisar só erros */

  // Nova rodada contendo apenas as questões erradas da rodada anterior.
  // Não há teto de 40 aqui: são, por definição, no máximo 40.
  function revisarErros() {
    var idsErrados = estado.registro
      .filter(function (r) { return !r.certo; })
      .map(function (r) { return r.id; });

    if (!idsErrados.length) return;

    var alvo = {};
    idsErrados.forEach(function (id) { alvo[id] = true; });

    estado.rodada = DISPONIVEIS
      .filter(function (q) { return alvo[q.id]; })
      .map(preparar);

    if (!estado.rodada.length) return;

    estado.indice = 0;
    estado.acertos = 0;
    estado.erros = 0;
    estado.registro = [];
    estado.origem = "erros";

    esconder("tela-fim");
    mostrar("tela-jogo");
    renderizar();
  }

  /* ------------------------------------------------------------- Eventos */

  function ligar() {
    el("btn-modo-teste").addEventListener("click", function () { comecar("teste"); });
    el("btn-modo-estudo").addEventListener("click", function () { comecar("estudo"); });
    el("btn-modo-rapido").addEventListener("click", function () { comecar("rapido"); });
    el("btn-modo-grande-desafio").addEventListener("click", function () { comecar("grande"); });
    el("btn-sair").addEventListener("click", sair);
    el("btn-voltar").addEventListener("click", sair);
    el("btn-revisar-erros").addEventListener("click", revisarErros);
    el("btn-reiniciar").addEventListener("click", function () {
      if (estado.origem === "erros") {
        // a rodada anterior era uma revisão: "Jogar novamente" sorteia normal
        estado.origem = "rodada";
        comecar(estado.modo);
      } else {
        comecar(estado.modo);
      }
    });

    el("btn-verificar").addEventListener("click", function () {
      if (!el("btn-verificar").disabled) avaliar();
    });
    el("btn-avancar").addEventListener("click", avancar);

    // O script inline do <head> já aplicou o atributo; aqui só sincroniza o
    // estado acessível do botão, sem reler o armazenamento.
    sincronizarBotaoTema(temaAtual());
    el("btn-tema").addEventListener("click", function () { alternarTema(); });

    // Atalhos: 1–9 escolhem alternativa, Enter confirma/avança, Esc sai.
    document.addEventListener("keydown", function (ev) {
      if (el("tela-jogo").hidden) return;
      if (ev.target && /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
        if (ev.key !== "Enter") return;
      }
      if (ev.key === "Escape") { sair(); return; }
      if (ev.key === "Enter") {
        if (!el("btn-avancar").hidden) { ev.preventDefault(); avancar(); }
        else if (!el("btn-verificar").hidden && !el("btn-verificar").disabled) {
          ev.preventDefault(); avaliar();
        }
        return;
      }
      if (!el("btn-avancar").hidden) return; // já revelou
      var q = estado.rodada[estado.indice];
      if (q.formato === "alternativas" && /^[1-9]$/.test(ev.key)) {
        var i = parseInt(ev.key, 10) - 1;
        var inp = document.getElementById("alt-" + i);
        if (inp) {
          inp.checked = true;
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
  }

  /* --------------------------------------------------------------- início */

  // Gancho de inspeção: permite a suíte de testes (e depuração no console)
  // conferir o estado interno sem depender da ordem aleatória das alternativas.
  window.Simulado = {
    estado: estado,
    disponiveis: DISPONIVEIS,
    comecar: comecar,
    avaliar: avaliar,
    avancar: avancar,
    revisarErros: revisarErros,
    totalRodada: function (modo) {
      // O grande desafio não tem teto: devolve o acervo inteiro.
      return ehIntegral(modo || "teste")
        ? DISPONIVEIS.length
        : Math.min(tamanhoDoModo(modo || "teste"), DISPONIVEIS.length);
    },
    tamanhoDoModo: tamanhoDoModo,
    ehPontuado: ehPontuado,
    tema: temaAtual,
    alternarTema: alternarTema
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { ligar(); montarInicio(); });
  } else {
    ligar();
    montarInicio();
  }
})();
