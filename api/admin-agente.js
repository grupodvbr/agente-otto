

const OpenAI = require("openai");

const {
  createClient
} = require("@supabase/supabase-js");

const fetch = (...args) =>
  import("node-fetch")
    .then(({ default: fetch }) => fetch(...args));

// ======================================================
// AMBIENTE
// ======================================================

if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL não configurada");
}

if (!process.env.SUPABASE_SERVICE_ROLE) {
  throw new Error("SUPABASE_SERVICE_ROLE não configurada");
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY não configurada");
}

// ======================================================
// CLIENTES
// ======================================================

const supabase =
createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  {
    auth: {
      persistSession: false
    }
  }
);

const openai =
new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ======================================================
// CONFIG
// ======================================================

const TIMEZONE =
"America/Bahia";

const OPENAI_MODEL =
process.env.OPENAI_MODEL ||
"gpt-4.1-mini";

const NOME_PARAMETRO_PROMPT =
"otto_prompt_direcionamento";

const TIMEOUT_AGENTE_MS =
Number(process.env.OTTO_TIMEOUT_AGENTE_MS || 30000);

const LIMITE_MEMORIA_CONTEXTO =
Number(process.env.OTTO_LIMITE_MEMORIA_CONTEXTO || 12);

// ======================================================
// HELPERS BÁSICOS
// ======================================================

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function limparTexto(valor) {
  return String(valor || "").trim();
}

function primeiraLinha(texto) {
  return String(texto || "")
    .split("\n")
    .map((linha) => linha.trim())
    .find(Boolean) || "";
}

function limitarTexto(texto, limite) {
  const valor = String(texto || "");

  if (valor.length <= limite) {
    return valor;
  }

  return valor.slice(0, limite) + "\n[texto cortado por limite]";
}

function parseBody(req) {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (e) {
      return {};
    }
  }

  return req.body;
}

function montarOrigin(req) {
  if (req.headers.origin) {
    return req.headers.origin;
  }

  if (req.headers.host) {
    return `https://${req.headers.host}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "";
}

function hojeBahiaISO() {
  const partes =
  new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date());

  const get = (tipo) =>
    partes.find((p) => p.type === tipo)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function agoraBahia() {
  return new Date(
    new Date().toLocaleString(
      "en-US",
      {
        timeZone: TIMEZONE
      }
    )
  );
}

function limparHashtag(valor) {
  const texto =
  String(valor || "");

  const match =
  texto.match(/#[a-zA-Z0-9_-]+/);

  if (!match) {
    return "";
  }

  return normalizar(match[0]);
}

function hashtagParaEndpoint(hashtag) {
  const limpa =
  limparHashtag(hashtag);

  if (!limpa) {
    return null;
  }

  const slug =
  limpa
    .replace("#", "")
    .replace(/_/g, "-");

  return `/api/sistema-otto/${slug}`;
}

function hashtagParaNomeAgente(hashtag) {
  const limpa =
  limparHashtag(hashtag);

  if (!limpa) {
    return "AGENTE_DESCONHECIDO";
  }

  const slug =
  limpa
    .replace("#", "")
    .replace(/-/g, "_")
    .toUpperCase();

  return `AGENTE_${slug}`;
}

function criarAbortController(timeoutMs) {
  const controller =
  new AbortController();

  const timer =
  setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    timer
  };
}

function extrairCategoriaPorHashtag(hashtag) {
  const limpa =
  limparHashtag(hashtag);

  if (!limpa) {
    return null;
  }

  return limpa.replace("#", "");
}

function detectarSentimentoBasico(texto) {
  const normalizado =
  normalizar(texto);

  const irritado = [
    "porcaria",
    "droga",
    "raiva",
    "estressado",
    "estresse",
    "errado",
    "bug",
    "nao funciona",
    "não funciona",
    "pessimo",
    "péssimo",
    "ruim",
    "horrivel",
    "horrível"
  ];

  const positivo = [
    "otimo",
    "ótimo",
    "perfeito",
    "show",
    "top",
    "excelente",
    "gostei",
    "boa"
  ];

  if (
    irritado.some((item) =>
      normalizado.includes(normalizar(item))
    )
  ) {
    return "irritado";
  }

  if (
    positivo.some((item) =>
      normalizado.includes(normalizar(item))
    )
  ) {
    return "positivo";
  }

  return "neutro";
}

function extrairTagsMemoria({
  hashtag,
  agente,
  pergunta
}) {
  const tags = [];

  const categoria =
  extrairCategoriaPorHashtag(hashtag);

  if (categoria) {
    tags.push(categoria);
  }

  if (agente) {
    tags.push(
      String(agente)
        .toLowerCase()
        .replace("agente_", "")
    );
  }

  const texto =
  normalizar(pergunta);

  const mapa = {
    faturamento: [
      "faturamento",
      "venda",
      "vendeu",
      "ticket",
      "pix",
      "meta",
      "ouro",
      "prata",
      "dia",
      "mes",
      "mês"
    ],

    metas: [
      "meta",
      "ouro",
      "prata",
      "ideal",
      "previsao",
      "previsão",
      "falta"
    ],

    financeiro: [
      "financeiro",
      "conta",
      "boleto",
      "despesa",
      "titulo",
      "título",
      "pagar",
      "receber",
      "f360"
    ],

    compras: [
      "compra",
      "pedido de compra",
      "compras de rua",
      "aprovacao",
      "aprovação",
      "cartao",
      "cartão"
    ],

    cotacoes: [
      "cotacao",
      "cotação",
      "fornecedor",
      "menor preco",
      "menor preço",
      "precos",
      "preços"
    ],

    estoque: [
      "estoque",
      "produto",
      "saldo",
      "validade",
      "lote",
      "movimentacao",
      "movimentação"
    ],

    rh: [
      "rh",
      "funcionario",
      "funcionário",
      "colaborador",
      "advertencia",
      "advertência",
      "suspensao",
      "suspensão"
    ],

    reservas: [
      "reserva",
      "mesa",
      "sala vip",
      "evento",
      "casamento",
      "aniversario",
      "aniversário"
    ],

    whatsapp: [
      "whatsapp",
      "template",
      "mensagem",
      "envio"
    ],

    marketing: [
      "banner",
      "arte",
      "instagram",
      "stories",
      "logo",
      "cardapio",
      "cardápio"
    ],

    operacional: [
      "operacao",
      "operação",
      "dashboard",
      "indicador",
      "processo",
      "checklist",
      "tarefas"
    ],

    principal: [
      "oi",
      "ola",
      "olá",
      "bom dia",
      "boa tarde",
      "boa noite",
      "teste"
    ]
  };

  for (const [tag, termos] of Object.entries(mapa)) {
    if (
      termos.some((termo) =>
        texto.includes(normalizar(termo))
      )
    ) {
      tags.push(tag);
    }
  }

  return Array.from(new Set(tags.filter(Boolean)));
}

// ======================================================
// MEMÓRIA CONTEXTUAL
// ======================================================

function perguntaPareceContinuidade(pergunta) {
  const texto =
  normalizar(pergunta);

  const palavras =
  texto.split(/\s+/).filter(Boolean);

  if (palavras.length <= 5) {
    return true;
  }

  const termos = [
    "e hoje",
    "hoje",
    "e ontem",
    "ontem",
    "e o",
    "e a",
    "dele",
    "dela",
    "desse",
    "dessa",
    "isso",
    "esse",
    "essa",
    "tambem",
    "também",
    "agora",
    "detalhado",
    "detalhada",
    "grafico",
    "gráfico",
    "manda",
    "mostra",
    "relatorio",
    "relatório",
    "quanto falta",
    "qual deles",
    "qual empresa",
    "me explica",
    "por empresa",
    "separa",
    "completo",
    "completa",
    "lista",
    "tabela",
    "card",
    "canvas"
  ];

  return termos.some((termo) =>
    texto.includes(normalizar(termo))
  );
}

function deduplicarPorId(lista) {
  const mapa =
  new Map();

  for (const item of lista || []) {
    if (!item) {
      continue;
    }

    const chave =
    item.id ||
    `${item.created_at || ""}-${item.pergunta || ""}-${item.resposta || ""}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, item);
    }
  }

  return Array.from(mapa.values());
}

function extrairResumoMemoria(item) {
  const pergunta =
  limparTexto(item?.pergunta || "");

  const resposta =
  limparTexto(item?.resposta || item?.resumo || "");

  const partes = [];

  if (item?.created_at) {
    partes.push(`DATA: ${item.created_at}`);
  }

  if (item?.agente) {
    partes.push(`AGENTE: ${item.agente}`);
  }

  if (item?.hashtag) {
    partes.push(`HASHTAG: ${item.hashtag}`);
  }

  if (item?.endpoint) {
    partes.push(`ENDPOINT: ${item.endpoint}`);
  }

  if (item?.categoria) {
    partes.push(`CATEGORIA: ${item.categoria}`);
  }

  if (item?.empresa) {
    partes.push(`EMPRESA: ${item.empresa}`);
  }

  if (Array.isArray(item?.tags) && item.tags.length) {
    partes.push(`TAGS: ${item.tags.join(", ")}`);
  }

  if (pergunta) {
    partes.push(`PERGUNTA: ${pergunta}`);
  }

  if (resposta) {
    partes.push(`RESPOSTA: ${limitarTexto(resposta, 1200)}`);
  }

  return partes.join("\n");
}

function calcularPontuacaoMemoria({
  item,
  perguntaAtual,
  contexto
}) {
  let pontos = 0;

  const textoAtual =
  normalizar(perguntaAtual);

  const textoMemoria =
  normalizar(
    [
      item?.pergunta,
      item?.resposta,
      item?.resumo,
      item?.conteudo,
      item?.categoria,
      item?.hashtag,
      item?.agente,
      Array.isArray(item?.tags) ? item.tags.join(" ") : ""
    ].filter(Boolean).join(" ")
  );

  const telefoneAtual =
  limparTexto(
    contexto?.telefone ||
    contexto?.numero ||
    ""
  );

  const usuarioAtual =
  contexto?.usuario_id ||
  contexto?.usuarioId ||
  null;

  const empresaAtual =
  normalizar(contexto?.empresa || "");

  if (usuarioAtual && item?.usuario_id === usuarioAtual) {
    pontos += 35;
  }

  if (
    telefoneAtual &&
    (
      limparTexto(item?.telefone || "") === telefoneAtual ||
      limparTexto(item?.numero || "") === telefoneAtual
    )
  ) {
    pontos += 35;
  }

  if (
    empresaAtual &&
    normalizar(item?.empresa || "") === empresaAtual
  ) {
    pontos += 12;
  }

  if (item?.tipo === "resposta_final") {
    pontos += 18;
  }

  if (item?.tipo === "roteamento") {
    pontos += 12;
  }

  if (item?.permanente === true) {
    pontos += 20;
  }

  if (item?.importante === true) {
    pontos += 8;
  }

  const palavras =
  textoAtual
    .split(/\s+/)
    .filter((p) => p.length >= 4);

  for (const palavra of palavras) {
    if (textoMemoria.includes(palavra)) {
      pontos += 4;
    }
  }

  if (perguntaPareceContinuidade(perguntaAtual)) {
    pontos += 18;
  }

  const data =
  item?.created_at
    ? new Date(item.created_at).getTime()
    : 0;

  if (data) {
    const horas =
    Math.abs(Date.now() - data) / 1000 / 60 / 60;

    if (horas <= 1) {
      pontos += 35;
    } else if (horas <= 6) {
      pontos += 25;
    } else if (horas <= 24) {
      pontos += 18;
    } else if (horas <= 72) {
      pontos += 10;
    } else if (horas <= 168) {
      pontos += 5;
    }
  }

  return pontos;
}

async function buscarMemoriaContextual({
  pergunta,
  contexto,
  limite = LIMITE_MEMORIA_CONTEXTO
}) {
  const contextoSeguro =
  contexto && typeof contexto === "object"
    ? contexto
    : {};

  const telefone =
  limparTexto(
    contextoSeguro.telefone ||
    contextoSeguro.numero ||
    ""
  );

  const numero =
  limparTexto(
    contextoSeguro.numero ||
    contextoSeguro.telefone ||
    ""
  );

  const usuario_id =
  contextoSeguro.usuario_id ||
  contextoSeguro.usuarioId ||
  null;

  const empresa =
  limparTexto(
    contextoSeguro.empresa ||
    ""
  );

  const colunas = `
    id,
    created_at,
    origem,
    agente,
    hashtag,
    endpoint,
    tipo,
    papel,
    telefone,
    numero,
    usuario_id,
    usuario_nome,
    empresa,
    pergunta,
    resposta,
    conteudo,
    resumo,
    categoria,
    subcategoria,
    intencao,
    sentimento,
    prioridade,
    tags,
    entidades,
    dados,
    contexto,
    importante,
    permanente,
    pode_usar_contexto,
    ativo,
    arquivado,
    deletado
  `;

  function baseQuery() {
    return supabase
      .from("memoria_otto_principal")
      .select(colunas)
      .eq("ativo", true)
      .eq("arquivado", false)
      .eq("deletado", false)
      .eq("pode_usar_contexto", true)
      .order("created_at", { ascending: false })
      .limit(50);
  }

  const consultas = [];

  if (usuario_id) {
    consultas.push(
      baseQuery()
        .eq("usuario_id", usuario_id)
    );
  }

  if (telefone) {
    consultas.push(
      baseQuery()
        .or(`telefone.eq.${telefone},numero.eq.${telefone}`)
    );
  }

  if (numero && numero !== telefone) {
    consultas.push(
      baseQuery()
        .or(`telefone.eq.${numero},numero.eq.${numero}`)
    );
  }

  if (empresa) {
    consultas.push(
      baseQuery()
        .eq("empresa", empresa)
    );
  }

  consultas.push(
    baseQuery()
      .eq("permanente", true)
  );

  if (!consultas.length) {
    return {
      itens: [],
      resumo: "",
      ultima_hashtag: null,
      ultimo_agente: null,
      ultimo_endpoint: null,
      ultima_categoria: null,
      ultima_empresa: null
    };
  }

  const resultados =
  await Promise.allSettled(consultas);

  const todos = [];

  for (const resultado of resultados) {
    if (resultado.status !== "fulfilled") {
      continue;
    }

    const value =
    resultado.value;

    if (value?.error) {
      console.log(
        "ERRO AO BUSCAR MEMÓRIA CONTEXTUAL:",
        value.error.message
      );
      continue;
    }

    if (Array.isArray(value?.data)) {
      todos.push(...value.data);
    }
  }

  const deduplicados =
  deduplicarPorId(todos);

  const filtrados =
  deduplicados.filter((item) => {
    if (!item) {
      return false;
    }

    if (item.tipo === "entrada_usuario" && !item.resposta) {
      return false;
    }

    if (
      limparTexto(item.pergunta || "") === limparTexto(pergunta || "") &&
      item.tipo === "entrada_usuario"
    ) {
      return false;
    }

    return true;
  });

  const ordenados =
  filtrados
    .map((item) => ({
      ...item,
      _score: calcularPontuacaoMemoria({
        item,
        perguntaAtual: pergunta,
        contexto: contextoSeguro
      })
    }))
    .sort((a, b) => {
      if (b._score !== a._score) {
        return b._score - a._score;
      }

      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    })
    .slice(0, limite);

  const ultimaComRota =
  ordenados.find((item) =>
    item?.hashtag &&
    item?.agente &&
    item?.endpoint
  ) || null;

  const ultimaComEmpresa =
  ordenados.find((item) =>
    item?.empresa
  ) || null;

  const resumo =
  ordenados
    .map((item, index) => {
      return `MEMÓRIA ${index + 1}\n${extrairResumoMemoria(item)}`;
    })
    .join("\n\n---\n\n");

  return {
    itens: ordenados,
    resumo,
    ultima_hashtag: ultimaComRota?.hashtag || null,
    ultimo_agente: ultimaComRota?.agente || null,
    ultimo_endpoint: ultimaComRota?.endpoint || null,
    ultima_categoria: ultimaComRota?.categoria || null,
    ultima_empresa: ultimaComEmpresa?.empresa || null
  };
}

// ======================================================
// PROMPT DO SUPABASE
// ======================================================

async function buscarPromptDirecionamento() {
  const {
    data,
    error
  } = await supabase
    .from("parametros_sistema")
    .select("dados")
    .eq("nome_parametro", NOME_PARAMETRO_PROMPT)
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Erro ao buscar prompt no Supabase: ${error.message}`
    );
  }

  const prompt =
    data?.dados?.prompt_comando ||
    data?.dados?.prompt ||
    data?.dados?.ensinamento ||
    "";

  if (!String(prompt).trim()) {
    throw new Error(
      "Prompt de direcionamento não encontrado em parametros_sistema."
    );
  }

  return String(prompt).trim();
}

// ======================================================
// IA ESCOLHE HASHTAG USANDO MEMÓRIA
// ======================================================

async function escolherHashtag({
  pergunta,
  promptComando,
  contexto,
  memoriaContextual
}) {
  const memoriaTexto =
  memoriaContextual?.resumo || "";

  const perguntaContinua =
  perguntaPareceContinuidade(pergunta);

  const completion =
  await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    max_tokens: 30,
    messages: [
      {
        role: "system",
        content:
`Você é o OTTO Central, um orquestrador de agentes.

Sua função NÃO é responder a pergunta final.
Sua função é escolher uma única hashtag de rota.

Regras obrigatórias:
1. Responda somente com uma hashtag.
2. Tudo que começa com # é uma rota.
3. Use o prompt do Supabase como regra principal.
4. Use a memória contextual para entender continuidade de conversa.
5. Se a pergunta atual for curta, vaga ou dependente de contexto, mantenha o último assunto/agente da memória.
6. Exemplos de perguntas dependentes:
   - "e hoje?"
   - "manda detalhado"
   - "e o Vila?"
   - "mostra em gráfico"
   - "quanto falta?"
   - "e desse mês?"
   - "separa por empresa"
   - "manda o relatório"
7. Se a memória indicar que o assunto anterior era faturamento, metas, compras, fornecedores, estoque, financeiro, reservas ou RH, continue nesse mesmo contexto.
8. Só mude de hashtag quando a pergunta atual claramente mudar de assunto.
9. Se não houver contexto suficiente e a pergunta for conversa simples, use a hashtag principal/conversa normal definida no prompt.
10. Nunca explique.
11. Nunca mande JSON.
12. Nunca mande texto fora da hashtag.`
      },
      {
        role: "user",
        content:
`${promptComando}

PERGUNTA ATUAL:
${pergunta}

A PERGUNTA PARECE CONTINUIDADE?
${perguntaContinua ? "SIM" : "NÃO"}

CONTEXTO RECEBIDO:
${JSON.stringify(contexto || {}, null, 2)}

ÚLTIMA HASHTAG DA MEMÓRIA:
${memoriaContextual?.ultima_hashtag || ""}

ÚLTIMO AGENTE DA MEMÓRIA:
${memoriaContextual?.ultimo_agente || ""}

ÚLTIMO ENDPOINT DA MEMÓRIA:
${memoriaContextual?.ultimo_endpoint || ""}

ÚLTIMA CATEGORIA DA MEMÓRIA:
${memoriaContextual?.ultima_categoria || ""}

ÚLTIMA EMPRESA DA MEMÓRIA:
${memoriaContextual?.ultima_empresa || ""}

MEMÓRIA CONTEXTUAL RECENTE:
${memoriaTexto || "SEM MEMÓRIA ENCONTRADA"}

Escolha agora somente uma hashtag.`
      }
    ]
  });

  const resposta =
  completion
    ?.choices
    ?.[0]
    ?.message
    ?.content ||
  "";

  const hashtag =
  limparHashtag(resposta);

  if (!hashtag) {
    throw new Error(
      `A IA não retornou uma hashtag válida. Resposta recebida: ${resposta}`
    );
  }

  return hashtag;
}

// ======================================================
// LEITURA HTTP
// ======================================================

async function lerRespostaHTTP(resposta) {
  const texto =
  await resposta.text();

  if (!texto) {
    return {};
  }

  try {
    return JSON.parse(texto);
  } catch (e) {
    return {
      resposta: texto
    };
  }
}

// ======================================================
// NORMALIZA RESPOSTA DO AGENTE
// ======================================================

function normalizarRespostaAgente(data) {
  const payload =
  data && typeof data === "object"
    ? data
    : {};

  const canvas =
    payload?.canvas ||
    payload?.resultado?.canvas ||
    payload?.ui ||
    payload?.layout ||
    null;

  const dados =
    payload?.dados ||
    payload?.resultado?.dados ||
    payload?.data?.dados ||
    null;

  const graficos =
    payload?.graficos ||
    payload?.grafico ||
    payload?.charts ||
    payload?.chart ||
    payload?.resultado?.graficos ||
    payload?.resultado?.grafico ||
    payload?.data?.graficos ||
    null;

  const tabelas =
    payload?.tabelas ||
    payload?.resultado?.tabelas ||
    null;

  const tabela =
    payload?.tabela ||
    payload?.resultado?.tabela ||
    null;

  const cards =
    payload?.cards ||
    payload?.resultado?.cards ||
    null;

  const html =
    payload?.html ||
    payload?.resultado?.html ||
    null;

  const respostaTexto =
    payload?.respostaTexto ||
    payload?.resposta ||
    payload?.mensagem ||
    payload?.texto ||
    payload?.resultado?.respostaTexto ||
    payload?.resultado?.resposta ||
    payload?.resultado?.mensagem ||
    payload?.fala ||
    "";

  const fala =
    payload?.fala ||
    payload?.respostaTexto ||
    payload?.resposta ||
    payload?.mensagem ||
    payload?.texto ||
    "";

  let canvasFinal =
  canvas;

  if (!canvasFinal && (graficos || tabela || tabelas || cards || html)) {
    canvasFinal = {
      kicker: "OTTO RESULTADO",
      titulo: payload?.titulo || payload?.title || "Resultado",
      subtitulo: payload?.subtitulo || payload?.descricao || "Resposta organizada pela API",
      texto: respostaTexto,
      html,
      cards,
      tabela,
      tabelas,
      graficos: Array.isArray(graficos)
        ? graficos
        : graficos
          ? [graficos]
          : [],
      estilo: payload?.estilo || {
        tema: "azul"
      }
    };
  }

  if (canvasFinal && graficos && !canvasFinal.graficos) {
    canvasFinal.graficos =
    Array.isArray(graficos)
      ? graficos
      : [graficos];
  }

  if (canvasFinal && dados && !canvasFinal.dados) {
    canvasFinal.dados =
    dados;
  }

  if (canvasFinal && tabela && !canvasFinal.tabela) {
    canvasFinal.tabela =
    tabela;
  }

  if (canvasFinal && tabelas && !canvasFinal.tabelas) {
    canvasFinal.tabelas =
    tabelas;
  }

  if (canvasFinal && cards && !canvasFinal.cards) {
    canvasFinal.cards =
    cards;
  }

  if (canvasFinal && html && !canvasFinal.html) {
    canvasFinal.html =
    html;
  }

  return {
    resposta:
      respostaTexto ||
      fala ||
      JSON.stringify(payload),

    respostaTexto:
      respostaTexto ||
      fala ||
      "",

    fala:
      fala ||
      respostaTexto ||
      "",

    canvas:
      canvasFinal || null,

    dados:
      dados || null,

    graficos:
      Array.isArray(graficos)
        ? graficos
        : graficos
          ? [graficos]
          : [],

    tabela:
      tabela || null,

    tabelas:
      tabelas || null,

    cards:
      cards || null,

    html:
      html || null,

    fontes:
      payload?.fontes ||
      payload?.resultado?.fontes ||
      null
  };
}

// ======================================================
// CHAMAR ROTA DO AGENTE
// ======================================================

async function chamarRota({
  pergunta,
  contexto,
  origin,
  hashtag,
  endpoint,
  agente
}) {
  const {
    controller,
    timer
  } = criarAbortController(TIMEOUT_AGENTE_MS);

  try {
    if (!origin) {
      throw new Error(
        "Origin não identificado para montar a rota final."
      );
    }

    const url =
    `${origin}${endpoint}`;

    console.log(`

🤖 OTTO CENTRAL ENVIANDO

❓ PERGUNTA:
${pergunta}

🏷️ HASHTAG:
${hashtag}

➡ AGENTE:
${agente}

📍 ROTA:
${url}

`);

    const resposta =
    await fetch(
      url,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer mercatto_admin_2026"
        },
        body: JSON.stringify({
          pergunta,
          mensagem: pergunta,
          texto: pergunta,

          telefone: contexto?.telefone || "",
          numero: contexto?.numero || contexto?.telefone || "",
          nome: contexto?.nome || "",
          empresa: contexto?.empresa || "",
          usuario_id: contexto?.usuario_id || null,
          usuario: contexto?.usuario || "",
          email: contexto?.email || "",

          data: contexto?.data || hojeBahiaISO(),
          hoje: contexto?.hoje || hojeBahiaISO(),
          timezone: TIMEZONE,

          origem: "OTTO_CENTRAL",
          interface: contexto?.interface || "OTTO_INDEX_CANVAS",

          aceita_canvas: true,
          aceita_html: true,
          aceita_cards: true,
          aceita_tabelas: true,
          aceita_graficos: true,
          aceita_dados: true,

          hashtag,
          agente_origem: agente,

          contexto
        })
      }
    );

    const data =
    await lerRespostaHTTP(resposta);

    if (!resposta.ok) {
      return {
        ok: false,
        status: resposta.status,
        hashtag,
        agente,
        endpoint,
        erro:
          data?.erro ||
          data?.mensagem ||
          data?.message ||
          data?.resposta ||
          `Erro HTTP ${resposta.status}`,
        data
      };
    }

    const normalizada =
    normalizarRespostaAgente(data);

    return {
      ok: true,
      status: resposta.status,
      hashtag,
      agente,
      endpoint,

      resposta: normalizada.resposta,
      respostaTexto: normalizada.respostaTexto,
      fala: normalizada.fala,

      canvas: normalizada.canvas,
      dados: normalizada.dados,
      graficos: normalizada.graficos,
      tabela: normalizada.tabela,
      tabelas: normalizada.tabelas,
      cards: normalizada.cards,
      html: normalizada.html,
      fontes: normalizada.fontes,

      data
    };

  } catch (e) {
    return {
      ok: false,
      hashtag,
      agente,
      endpoint,
      erro:
        e.name === "AbortError"
          ? `Tempo excedido ao chamar ${endpoint}`
          : e.message
    };

  } finally {
    clearTimeout(timer);
  }
}
function tamanhoJSON(valor) {
  try {
    return JSON.stringify(valor || {}).length;
  } catch (e) {
    return 0;
  }
}

function limitarTextoBanco(valor, limite = 8000) {
  const texto = String(valor || "");

  if (texto.length <= limite) {
    return texto;
  }

  return texto.slice(0, limite) + "\n[texto cortado para salvar somente o necessário]";
}

function limparContextoParaBanco(contexto) {
  const c =
    contexto && typeof contexto === "object"
      ? contexto
      : {};

  return {
    telefone: c.telefone || "",
    numero: c.numero || c.telefone || "",
    nome: c.nome || "",
    usuario: c.usuario || "",
    usuario_id: c.usuario_id || c.usuarioId || null,
    empresa: c.empresa || "",
    email: c.email || "",
    interface: c.interface || "",
    tema_atual: c.tema_atual || null,
    timezone: c.timezone || TIMEZONE,
    hoje: c.hoje || hojeBahiaISO(),

    memoria_contextual: c.memoria_contextual
      ? {
          ultima_hashtag: c.memoria_contextual.ultima_hashtag || null,
          ultimo_agente: c.memoria_contextual.ultimo_agente || null,
          ultimo_endpoint: c.memoria_contextual.ultimo_endpoint || null,
          ultima_categoria: c.memoria_contextual.ultima_categoria || null,
          ultima_empresa: c.memoria_contextual.ultima_empresa || null,
          resumo: limitarTextoBanco(c.memoria_contextual.resumo || "", 2500)
        }
      : null
  };
}

function resumirTabelaParaBanco(tabela) {
  if (!tabela) {
    return null;
  }

  const linhas =
    Array.isArray(tabela.linhas)
      ? tabela.linhas.length
      : Array.isArray(tabela.rows)
        ? tabela.rows.length
        : 0;

  const colunas =
    Array.isArray(tabela.colunas)
      ? tabela.colunas.length
      : Array.isArray(tabela.columns)
        ? tabela.columns.length
        : 0;

  return {
    titulo: tabela.titulo || tabela.title || null,
    linhas,
    colunas
  };
}

function resumirTabelasParaBanco(tabelas) {
  if (!tabelas) {
    return [];
  }

  const lista =
    Array.isArray(tabelas)
      ? tabelas
      : [tabelas];

  return lista.slice(0, 10).map(resumirTabelaParaBanco);
}

function resumirGraficosParaBanco(graficos) {
  if (!graficos) {
    return [];
  }

  const lista =
    Array.isArray(graficos)
      ? graficos
      : [graficos];

  return lista.slice(0, 10).map((grafico) => {
    const labels =
      Array.isArray(grafico?.labels)
        ? grafico.labels.length
        : 0;

    const datasets =
      Array.isArray(grafico?.datasets)
        ? grafico.datasets.length
        : 0;

    return {
      titulo: grafico?.titulo || grafico?.title || null,
      tipo: grafico?.tipo || grafico?.type || null,
      formato: grafico?.formato || null,
      labels,
      datasets
    };
  });
}

function resumirCardsParaBanco(cards) {
  if (!cards) {
    return [];
  }

  const lista =
    Array.isArray(cards)
      ? cards
      : [cards];

  return lista.slice(0, 20).map((card) => ({
    label: limitarTextoBanco(card?.label || card?.titulo || "", 80),
    valor: limitarTextoBanco(card?.valor || card?.value || "", 120),
    desc: limitarTextoBanco(card?.desc || card?.descricao || "", 180)
  }));
}

function resumirCanvasParaBanco(canvas) {
  if (!canvas) {
    return null;
  }

  return {
    existe: true,
    kicker: limitarTextoBanco(canvas.kicker || "", 80),
    titulo: limitarTextoBanco(canvas.titulo || canvas.title || "", 160),
    subtitulo: limitarTextoBanco(canvas.subtitulo || canvas.descricao || "", 220),
    tema: canvas?.estilo?.tema || canvas?.tema || null,
    tem_html: Boolean(canvas.html),
    tem_cards: Boolean(canvas.cards),
    tem_tabela: Boolean(canvas.tabela),
    tem_tabelas: Boolean(canvas.tabelas),
    tem_graficos: Boolean(canvas.graficos),
    cards: resumirCardsParaBanco(canvas.cards),
    tabela: resumirTabelaParaBanco(canvas.tabela),
    tabelas: resumirTabelasParaBanco(canvas.tabelas),
    graficos: resumirGraficosParaBanco(canvas.graficos)
  };
}

function resumirDadosParaBanco(dados) {
  if (!dados || typeof dados !== "object") {
    return {};
  }

  return {
    periodo: dados.periodo || null,
    filtros: dados.filtros || null,
    resumo: dados.resumo || dados.relatorio?.resumo || null,

    total_reservas:
      dados.resumo?.total_reservas ??
      dados.relatorio?.total_reservas ??
      dados.reservas?.length ??
      null,

    total_pessoas:
      dados.resumo?.total_pessoas ??
      dados.relatorio?.total_pessoas ??
      null,

    total_cotacoes:
      dados.resumo?.total_cotacoes ??
      dados.cotacoes?.length ??
      null,

    total_itens:
      dados.resumo?.total_itens ??
      null,

    faturamento_mes:
      dados.resumo?.faturamento_mes ??
      dados.geral?.faturamento_mes ??
      null,

    faturamento_hoje:
      dados.resumo?.faturamento_hoje ??
      dados.geral?.faturamento_hoje ??
      null,

    empresa:
      dados.empresa?.empresa ||
      dados.empresa_perguntada ||
      null
  };
}

function resumirRespostaAgenteParaBanco(respostaAgente) {
  if (!respostaAgente || typeof respostaAgente !== "object") {
    return null;
  }

  const data =
    respostaAgente.data && typeof respostaAgente.data === "object"
      ? respostaAgente.data
      : {};

  return {
    ok: respostaAgente.ok === true,
    status: respostaAgente.status || null,
    hashtag: respostaAgente.hashtag || data.hashtag || null,
    agente: respostaAgente.agente || data.agente || null,
    endpoint: respostaAgente.endpoint || data.endpoint || null,
    erro: limitarTextoBanco(respostaAgente.erro || data.erro || "", 1500),

    respostaTexto: limitarTextoBanco(
      respostaAgente.respostaTexto ||
      respostaAgente.resposta ||
      data.respostaTexto ||
      data.resposta ||
      "",
      6000
    ),

    fala: limitarTextoBanco(
      respostaAgente.fala ||
      data.fala ||
      "",
      2500
    ),

    canvas: resumirCanvasParaBanco(
      respostaAgente.canvas ||
      data.canvas ||
      data?.resultado?.canvas ||
      null
    ),

    dados: resumirDadosParaBanco(
      respostaAgente.dados ||
      data.dados ||
      data?.resultado?.dados ||
      null
    ),

    graficos: resumirGraficosParaBanco(
      respostaAgente.graficos ||
      data.graficos ||
      data?.resultado?.graficos ||
      null
    ),

    tabela: resumirTabelaParaBanco(
      respostaAgente.tabela ||
      data.tabela ||
      data?.resultado?.tabela ||
      null
    ),

    tabelas: resumirTabelasParaBanco(
      respostaAgente.tabelas ||
      data.tabelas ||
      data?.resultado?.tabelas ||
      null
    ),

    tamanho_original_aproximado: tamanhoJSON(respostaAgente)
  };
}

function resumirRoteamentoParaBanco(roteamento) {
  if (!roteamento || typeof roteamento !== "object") {
    return null;
  }

  return {
    pergunta: limitarTextoBanco(roteamento.pergunta || "", 1000),
    hashtag: roteamento.hashtag || null,
    endpoint: roteamento.endpoint || null,
    agente: roteamento.agente || null,
    regra: roteamento.regra || null,
    memoria_contextual: roteamento.memoria_contextual
      ? {
          usada: roteamento.memoria_contextual.usada === true,
          ultima_hashtag: roteamento.memoria_contextual.ultima_hashtag || null,
          ultimo_agente: roteamento.memoria_contextual.ultimo_agente || null,
          ultimo_endpoint: roteamento.memoria_contextual.ultimo_endpoint || null,
          ultima_categoria: roteamento.memoria_contextual.ultima_categoria || null,
          ultima_empresa: roteamento.memoria_contextual.ultima_empresa || null,
          total_memorias: roteamento.memoria_contextual.total_memorias || 0
        }
      : null
  };
}

function montarDadosMinimosMemoria({
  etapa,
  pergunta,
  respostaAgente,
  roteamento,
  body,
  extra
}) {
  return {
    etapa,
    pergunta: limitarTextoBanco(pergunta || "", 1000),
    roteamento: resumirRoteamentoParaBanco(roteamento),
    resposta_agente: resumirRespostaAgenteParaBanco(respostaAgente),
    origem: body?.origem || body?.interface || null,
    aceita_canvas: body?.aceita_canvas !== false,
    aceita_graficos: body?.aceita_graficos !== false,
    extra: extra || null
  };
}
// ======================================================
// SALVAR HISTÓRICO
// ======================================================

async function salvarHistorico({
  pergunta,
  resposta,
  agente,
  hashtag,
  endpoint,
  contexto,
  roteamento,
  resposta_agente
}) {
  try {
    await supabase
      .from("otto_historico")
      .insert([
        {
          pergunta: limitarTextoBanco(pergunta || "", 3000),
          resposta: limitarTextoBanco(resposta || "", 8000),
          agente: agente || "OTTO_CENTRAL",
          hashtag: hashtag || null,
          endpoint: endpoint || null,

          contexto: limparContextoParaBanco(contexto),

          roteamento: resumirRoteamentoParaBanco(roteamento),

          resposta_agente: resumirRespostaAgenteParaBanco(resposta_agente),

          created_at: new Date().toISOString()
        }
      ]);

  } catch (e) {
    console.log(
      "ERRO AO SALVAR HISTÓRICO OTTO:",
      e.message
    );
  }
}

// ======================================================
// SALVAR MEMÓRIA PRINCIPAL
// ======================================================

async function salvarMemoriaOttoPrincipal({
  origem,
  agente,
  hashtag,
  endpoint,
  tipo,
  papel,
  pergunta,
  resposta,
  contexto,
  dados,
  roteamento,
  resposta_agente,
  importante,
  permanente,
  prioridade
}) {
  try {
    const contextoSeguro =
    contexto && typeof contexto === "object"
      ? contexto
      : {};

    const telefone =
    limparTexto(
      contextoSeguro.telefone ||
      contextoSeguro.numero ||
      ""
    );

    const numero =
    limparTexto(
      contextoSeguro.numero ||
      contextoSeguro.telefone ||
      ""
    );

    const usuario_id =
      contextoSeguro.usuario_id ||
      contextoSeguro.usuarioId ||
      null;

    const usuario_nome =
    limparTexto(
      contextoSeguro.nome ||
      contextoSeguro.usuario_nome ||
      contextoSeguro.usuario ||
      ""
    );

    const empresa =
    limparTexto(
      contextoSeguro.empresa ||
      ""
    );

    const categoria =
    extrairCategoriaPorHashtag(hashtag);

    const sentimento =
    detectarSentimentoBasico(
      `${pergunta || ""}\n${resposta || ""}`
    );

    const tags =
    extrairTagsMemoria({
      hashtag,
      agente,
      pergunta
    });

    const conteudo =
    limitarTexto(
      [
        `ORIGEM: ${origem || ""}`,
        `AGENTE: ${agente || ""}`,
        `HASHTAG: ${hashtag || ""}`,
        `ENDPOINT: ${endpoint || ""}`,
        `TIPO: ${tipo || ""}`,
        `PAPEL: ${papel || ""}`,
        `EMPRESA: ${empresa || ""}`,
        `USUÁRIO: ${usuario_nome || ""}`,
        pergunta ? `PERGUNTA: ${pergunta}` : "",
        resposta ? `RESPOSTA: ${resposta}` : "",
        roteamento ? `ROTEAMENTO: ${JSON.stringify(roteamento, null, 2)}` : "",
        resposta_agente ? `RESPOSTA_AGENTE: ${JSON.stringify(resposta_agente, null, 2)}` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      30000
    );

    const resumo =
    primeiraLinha(resposta) ||
    primeiraLinha(pergunta) ||
    null;

    const payload = {
      origem: origem || "ADMIN_AGENTE",
      agente: agente || "OTTO_CENTRAL",
      hashtag: hashtag || null,
      endpoint: endpoint || null,
      tipo: tipo || "roteamento",
      papel: papel || "sistema",

      telefone: telefone || null,
      numero: numero || null,
      usuario_id: usuario_id || null,
      usuario_nome: usuario_nome || null,
      empresa: empresa || null,

      pergunta: pergunta || null,
      resposta: resposta || null,
      conteudo: conteudo || pergunta || resposta || "",
      resumo,

      categoria: categoria || null,
      subcategoria: null,
      intencao: tipo || null,
      sentimento,

      prioridade:
        prioridade ||
        (
          sentimento === "irritado"
            ? "alta"
            : "normal"
        ),

      tags: tags || [],
      entidades: {},

dados:
  dados && typeof dados === "object"
    ? {
        etapa: dados.etapa || tipo || null,
        pergunta: limitarTextoBanco(dados.pergunta || pergunta || "", 1000),
        resumo: dados.resumo || null,
        roteamento: resumirRoteamentoParaBanco(
          dados.roteamento || roteamento
        ),
        resposta_agente: resumirRespostaAgenteParaBanco(
          dados.resposta_agente || resposta_agente
        ),
        ok:
          dados.ok !== undefined
            ? dados.ok
            : resposta_agente?.ok === true,
        status:
          dados.status ||
          resposta_agente?.status ||
          null,
        extra:
          dados.extra ||
          null
      }
    : {},

contexto: limparContextoParaBanco(contextoSeguro),

metadata: {
  salvo_por: "admin-agente.js",
  timezone: TIMEZONE,
  hoje: hojeBahiaISO(),

  roteamento: resumirRoteamentoParaBanco(roteamento),

  resposta_agente: resumirRespostaAgenteParaBanco(resposta_agente),

  politica_salvamento: "somente_resumo_sem_payload_bruto"
},

      fonte_tabela: null,
      fonte_id: null,
      referencia_externa: null,

      importante: importante === true,
      permanente: permanente === true,
      pode_usar_contexto: true,
      ativo: true,
      arquivado: false,
      deletado: false,
      data_referencia: hojeBahiaISO()
    };

    const {
      error
    } = await supabase
      .from("memoria_otto_principal")
      .insert([payload]);

    if (error) {
      console.log(
        "ERRO AO SALVAR MEMÓRIA OTTO PRINCIPAL:",
        error.message
      );
    }

  } catch (e) {
    console.log(
      "FALHA AO SALVAR MEMÓRIA OTTO PRINCIPAL:",
      e.message
    );
  }
}

// ======================================================
// HANDLER
// ======================================================

module.exports = async function handler(req, res) {
  let perguntaParaErro = "";
  let contextoParaErro = {};

  try {
    // ====================================================
    // CORS
    // ====================================================

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    // ====================================================
    // MÉTODO
    // ====================================================

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        erro: "Método não permitido. Use POST."
      });
    }

    // ====================================================
    // BODY
    // ====================================================

    const body =
    parseBody(req);

    const pergunta =
      body?.pergunta ||
      body?.mensagem ||
      body?.texto ||
      "";

    perguntaParaErro =
    pergunta;

    if (!String(pergunta).trim()) {
      return res.status(400).json({
        ok: false,
        erro: "Pergunta não informada."
      });
    }

    const contextoRecebido =
      body?.contexto &&
      typeof body.contexto === "object"
        ? body.contexto
        : {};

    const contexto = {
      telefone:
        body?.telefone ||
        body?.numero ||
        contextoRecebido?.telefone ||
        contextoRecebido?.numero ||
        "",

      numero:
        body?.numero ||
        body?.telefone ||
        contextoRecebido?.numero ||
        contextoRecebido?.telefone ||
        "",

      nome:
        body?.nome ||
        body?.usuario ||
        contextoRecebido?.nome ||
        contextoRecebido?.usuario ||
        "",

      usuario:
        body?.usuario ||
        contextoRecebido?.usuario ||
        "",

      email:
        body?.email ||
        contextoRecebido?.email ||
        "",

      empresa:
        body?.empresa ||
        contextoRecebido?.empresa ||
        "",

      usuario_id:
        body?.usuario_id ||
        body?.usuarioId ||
        contextoRecebido?.usuario_id ||
        contextoRecebido?.usuarioId ||
        null,

      data:
        body?.data ||
        contextoRecebido?.data ||
        hojeBahiaISO(),

      hoje:
        hojeBahiaISO(),

      timezone:
        TIMEZONE,

      interface:
        body?.interface ||
        contextoRecebido?.interface ||
        "OTTO_INDEX_CANVAS",

      aceita_canvas:
        body?.aceita_canvas !== false,

      aceita_html:
        body?.aceita_html !== false,

      aceita_cards:
        body?.aceita_cards !== false,

      aceita_tabelas:
        body?.aceita_tabelas !== false,

      aceita_graficos:
        body?.aceita_graficos !== false,

      aceita_dados:
        body?.aceita_dados !== false,

      tema_atual:
        body?.tema_atual ||
        contextoRecebido?.tema_atual ||
        null
    };

    contextoParaErro =
    contexto;

    const origin =
    montarOrigin(req);

    // ====================================================
    // SALVA ENTRADA NA MEMÓRIA
    // ====================================================

await salvarMemoriaOttoPrincipal({
  origem: "ADMIN_AGENTE",
  agente: "OTTO_CENTRAL",
  hashtag: null,
  endpoint: "/api/admin-agente",
  tipo: "entrada_usuario",
  papel: "usuario",
  pergunta,
  resposta: null,
  contexto,
  dados: {
    etapa: "pergunta_recebida",
    pergunta: limitarTextoBanco(pergunta, 1000),
    origem: body?.origem || body?.interface || "OTTO",
    aceita_canvas: body?.aceita_canvas !== false,
    aceita_graficos: body?.aceita_graficos !== false
  },
  importante: false,
  permanente: false
});

    // ====================================================
    // BUSCA MEMÓRIA CONTEXTUAL ANTES DE ROTEAR
    // ====================================================

    const memoriaContextual =
    await buscarMemoriaContextual({
      pergunta,
      contexto,
      limite: LIMITE_MEMORIA_CONTEXTO
    });

    console.log(`

🧠 OTTO MEMÓRIA CONTEXTUAL

❓ PERGUNTA:
${pergunta}

🏷️ ÚLTIMA HASHTAG:
${memoriaContextual?.ultima_hashtag || "nenhuma"}

➡ ÚLTIMO AGENTE:
${memoriaContextual?.ultimo_agente || "nenhum"}

📍 ÚLTIMO ENDPOINT:
${memoriaContextual?.ultimo_endpoint || "nenhum"}

📌 ÚLTIMA CATEGORIA:
${memoriaContextual?.ultima_categoria || "nenhuma"}

🏢 ÚLTIMA EMPRESA:
${memoriaContextual?.ultima_empresa || "nenhuma"}

📚 MEMÓRIAS USADAS:
${memoriaContextual?.itens?.length || 0}

`);

    // ====================================================
    // BUSCA PROMPT DO SUPABASE
    // ====================================================

    const promptComando =
    await buscarPromptDirecionamento();

    // ====================================================
    // ESCOLHE HASHTAG COM MEMÓRIA
    // ====================================================

    const hashtag =
    await escolherHashtag({
      pergunta,
      promptComando,
      contexto: {
        ...contexto,
        memoria_contextual: {
          ultima_hashtag: memoriaContextual?.ultima_hashtag || null,
          ultimo_agente: memoriaContextual?.ultimo_agente || null,
          ultimo_endpoint: memoriaContextual?.ultimo_endpoint || null,
          ultima_categoria: memoriaContextual?.ultima_categoria || null,
          ultima_empresa: memoriaContextual?.ultima_empresa || null
        }
      },
      memoriaContextual
    });

    // ====================================================
    // COMPLETA ROTA
    // ====================================================

    const endpoint =
    hashtagParaEndpoint(hashtag);

    if (!endpoint) {
      await salvarMemoriaOttoPrincipal({
        origem: "ADMIN_AGENTE",
        agente: "OTTO_CENTRAL",
        hashtag,
        endpoint: null,
        tipo: "erro_roteamento",
        papel: "sistema",
        pergunta,
        resposta: "Hashtag inválida retornada pelo roteador.",
        contexto,
        dados: {
          etapa: "hashtag_invalida",
          hashtag
        },
        importante: true,
        permanente: false,
        prioridade: "alta"
      });

      return res.status(400).json({
        ok: false,
        erro: "Hashtag inválida retornada pelo roteador.",
        hashtag
      });
    }

    const agente =
    hashtagParaNomeAgente(hashtag);

    const contextoComMemoria = {
      ...contexto,

      memoria_contextual: {
        ultima_hashtag: memoriaContextual?.ultima_hashtag || null,
        ultimo_agente: memoriaContextual?.ultimo_agente || null,
        ultimo_endpoint: memoriaContextual?.ultimo_endpoint || null,
        ultima_categoria: memoriaContextual?.ultima_categoria || null,
        ultima_empresa: memoriaContextual?.ultima_empresa || null,
        resumo: memoriaContextual?.resumo || "",
        itens: memoriaContextual?.itens || []
      }
    };

    const roteamento = {
      pergunta,
      hashtag,
      endpoint,
      agente,
      regra: "hashtag_completa_api_sistema_otto_com_memoria_contextual",
      memoria_contextual: {
        usada: true,
        ultima_hashtag: memoriaContextual?.ultima_hashtag || null,
        ultimo_agente: memoriaContextual?.ultimo_agente || null,
        ultimo_endpoint: memoriaContextual?.ultimo_endpoint || null,
        ultima_categoria: memoriaContextual?.ultima_categoria || null,
        ultima_empresa: memoriaContextual?.ultima_empresa || null,
        total_memorias: memoriaContextual?.itens?.length || 0
      }
    };

    // ====================================================
    // SALVA ROTEAMENTO
    // ====================================================

await salvarMemoriaOttoPrincipal({
  origem: "ADMIN_AGENTE",
  agente: "OTTO_CENTRAL",
  hashtag,
  endpoint,
  tipo: "roteamento",
  papel: "sistema",
  pergunta,
  resposta: `Pergunta direcionada para ${agente} pela hashtag ${hashtag}.`,
  contexto: {
    ...limparContextoParaBanco(contextoComMemoria),
    origin
  },
  dados: {
    etapa: "roteamento_definido",
    roteamento: resumirRoteamentoParaBanco(roteamento)
  },
  roteamento: resumirRoteamentoParaBanco(roteamento),
  importante: false,
  permanente: false
});

    // ====================================================
    // CHAMA AGENTE FINAL
    // ====================================================

    const respostaAgente =
    await chamarRota({
      pergunta,
      contexto: contextoComMemoria,
      origin,
      hashtag,
      endpoint,
      agente
    });

    const respostaFinal =
      respostaAgente?.resposta ||
      respostaAgente?.erro ||
      "Sem resposta do agente.";

    // ====================================================
    // HISTÓRICO
    // ====================================================

await salvarHistorico({
  pergunta,
  resposta: respostaFinal,
  agente,
  hashtag,
  endpoint,
  contexto: {
    ...limparContextoParaBanco(contextoComMemoria),
    origin
  },
  roteamento: resumirRoteamentoParaBanco(roteamento),
  resposta_agente: resumirRespostaAgenteParaBanco(respostaAgente)
});

    // ====================================================
    // SALVA RESPOSTA FINAL
    // ====================================================

await salvarMemoriaOttoPrincipal({
  origem: "ADMIN_AGENTE",
  agente,
  hashtag,
  endpoint,
  tipo:
    respostaAgente?.ok === true
      ? "resposta_final"
      : "erro_agente",
  papel: "assistente",
  pergunta,
  resposta: limitarTextoBanco(respostaFinal, 8000),
  contexto: {
    ...limparContextoParaBanco(contextoComMemoria),
    origin
  },
  dados: {
    etapa: "resposta_final",
    pergunta: limitarTextoBanco(pergunta, 1000),
    ok: respostaAgente?.ok === true,
    status: respostaAgente?.status || null,

    resposta_resumo: limitarTextoBanco(
      respostaAgente?.respostaTexto ||
      respostaAgente?.resposta ||
      respostaFinal,
      6000
    ),

    fala_resumo: limitarTextoBanco(
      respostaAgente?.fala ||
      respostaAgente?.respostaTexto ||
      respostaFinal,
      2500
    ),

    visual: {
      tem_canvas: Boolean(respostaAgente?.canvas),
      tem_graficos: Array.isArray(respostaAgente?.graficos)
        ? respostaAgente.graficos.length > 0
        : Boolean(respostaAgente?.graficos),
      tem_tabela: Boolean(respostaAgente?.tabela),
      tem_tabelas: Boolean(respostaAgente?.tabelas),
      tem_cards: Boolean(respostaAgente?.cards),
      tem_html: Boolean(respostaAgente?.html)
    },

    canvas_resumo: resumirCanvasParaBanco(respostaAgente?.canvas),
    graficos_resumo: resumirGraficosParaBanco(respostaAgente?.graficos),
    tabela_resumo: resumirTabelaParaBanco(respostaAgente?.tabela),
    tabelas_resumo: resumirTabelasParaBanco(respostaAgente?.tabelas),
    dados_resumo: resumirDadosParaBanco(respostaAgente?.dados),

    tamanho_original_aproximado: tamanhoJSON(respostaAgente)
  },
  roteamento: resumirRoteamentoParaBanco(roteamento),
  resposta_agente: resumirRespostaAgenteParaBanco(respostaAgente),
  importante: respostaAgente?.ok !== true,
  permanente: false,
  prioridade:
    respostaAgente?.ok === true
      ? "normal"
      : "alta"
});
    // ====================================================
    // RETORNO PARA O INDEX
    // ====================================================

    return res.status(200).json({
      ok: respostaAgente.ok === true,
      sucesso: respostaAgente.ok === true,

      pergunta,

      resposta: respostaFinal,

      respostaTexto:
        respostaAgente?.respostaTexto ||
        respostaAgente?.resposta ||
        respostaFinal,

      fala:
        respostaAgente?.fala ||
        respostaAgente?.respostaTexto ||
        respostaAgente?.resposta ||
        respostaFinal,

      canvas:
        respostaAgente?.canvas ||
        respostaAgente?.data?.canvas ||
        respostaAgente?.data?.resultado?.canvas ||
        null,

      dados:
        respostaAgente?.dados ||
        respostaAgente?.data?.dados ||
        respostaAgente?.data?.resultado?.dados ||
        null,

      graficos:
        respostaAgente?.graficos ||
        respostaAgente?.data?.graficos ||
        respostaAgente?.data?.resultado?.graficos ||
        [],

      tabela:
        respostaAgente?.tabela ||
        respostaAgente?.data?.tabela ||
        respostaAgente?.data?.resultado?.tabela ||
        null,

      tabelas:
        respostaAgente?.tabelas ||
        respostaAgente?.data?.tabelas ||
        respostaAgente?.data?.resultado?.tabelas ||
        null,

      cards:
        respostaAgente?.cards ||
        respostaAgente?.data?.cards ||
        respostaAgente?.data?.resultado?.cards ||
        null,

      html:
        respostaAgente?.html ||
        respostaAgente?.data?.html ||
        respostaAgente?.data?.resultado?.html ||
        null,

      fontes:
        respostaAgente?.fontes ||
        respostaAgente?.data?.fontes ||
        null,

      roteamento: {
        hashtag,
        endpoint,
        agente,
        memoria_contextual: roteamento.memoria_contextual
      },

      agente_nome: agente,
      hashtag,
      endpoint,
      agente: respostaAgente,

      memoria: {
        tabela: "memoria_otto_principal",
        salvo: true,
        contexto_usado: true,
        eventos: [
          "entrada_usuario",
          "roteamento",
          "resposta_final"
        ]
      },

      hoje: hojeBahiaISO(),
      timezone: TIMEZONE,
      timestamp: new Date().toISOString(),
      agora_bahia: agoraBahia().toISOString()
    });

  } catch (err) {
    console.log(
      "ERRO OTTO CENTRAL:",
      err
    );

    await salvarMemoriaOttoPrincipal({
      origem: "ADMIN_AGENTE",
      agente: "OTTO_CENTRAL",
      hashtag: null,
      endpoint: "/api/admin-agente",
      tipo: "erro_admin_agente",
      papel: "sistema",
      pergunta: perguntaParaErro,
      resposta: err.message || "Erro interno no admin-agente.",
      contexto: contextoParaErro,
      dados: {
        etapa: "catch_global",
        erro: err.message,
        stack: err.stack || null
      },
      importante: true,
      permanente: false,
      prioridade: "alta"
    });

    return res.status(500).json({
      ok: false,
      erro: true,
      mensagem: err.message,
      resposta: err.message,
      respostaTexto: err.message,
      fala: "Tive um erro interno ao processar essa solicitação.",
      memoria: {
        tabela: "memoria_otto_principal",
        tentativa_salvar_erro: true
      }
    });
  }
};
