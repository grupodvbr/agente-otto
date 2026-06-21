// ======================================================
// 🤖 OTTO • ADMIN AGENTE CENTRAL
// ARQUIVO: /api/admin-agente.js
// FUNÇÃO:
// - Receber pergunta do INDEX / WHATSAPP / PAINEL
// - Identificar o agente correto
// - Redirecionar para a rota correta
// - Se não souber, mandar para o AGENTE PRINCIPAL
// - Proteger contra payload gigante / loop / erro 413
// ======================================================

const TIMEZONE = "America/Bahia";

// ======================================================
// CONFIGURAÇÕES GERAIS
// ======================================================

const CONFIG = {
  nome: "OTTO Central",
  versao: "4.0.0",

  // Limite interno seguro antes da função tentar processar.
  // ATENÇÃO: se o payload chegar grande demais na Vercel,
  // a Vercel pode bloquear antes de entrar aqui.
  LIMITE_PAYLOAD_CHARS: Number(process.env.OTTO_LIMITE_PAYLOAD || 650000),

  // Timeout para chamada dos agentes
  TIMEOUT_AGENTE_MS: Number(process.env.OTTO_TIMEOUT_AGENTE_MS || 45000),

  // Bloqueio emergencial
  API_BLOQUEADA: process.env.OTTO_API_BLOQUEADA === "true",

  // Mostrar logs grandes
  LOG_DETALHADO: process.env.OTTO_LOG_DETALHADO !== "false",

  // Base externa opcional.
  // Se não existir, usa o host atual.
  BASE_URL: process.env.OTTO_BASE_URL || "",

  // Chave interna opcional para proteger chamadas entre APIs
  INTERNAL_TOKEN: process.env.OTTO_INTERNAL_TOKEN || "",

  // Evita loop infinito
  MAX_SALTOS: Number(process.env.OTTO_MAX_SALTOS || 3),
};

// ======================================================
// MAPA DE AGENTES
// Ajuste as rotas conforme seus arquivos reais.
// ======================================================

const AGENTES = {
  PRINCIPAL: {
    id: "AGENTE_PRINCIPAL",
    nome: "Agente Principal",
    hashtag: "#principal",
    rota: "/api/sistema-otto/principal",
    descricao: "Conversa normal, dúvidas gerais, memória e fallback.",
  },

  FATURAMENTO: {
    id: "AGENTE_FATURAMENTO",
    nome: "Agente de Faturamento",
    hashtag: "#faturamento",
    rota: "/api/sistema-otto/faturamento",
    descricao: "Vendas, faturamento, metas, ranking e empresas.",
  },

  FINANCEIRO: {
    id: "AGENTE_FINANCEIRO",
    nome: "Agente Financeiro",
    hashtag: "#financeiro",
    rota: "/api/sistema-otto/financeiro",
    descricao: "Contas, despesas, F360, planos de contas, travas e financeiro.",
  },

  COMPRAS_RUA: {
    id: "AGENTE_COMPRAS_RUA",
    nome: "Agente Compras de Rua",
    hashtag: "#compras_rua",
    rota: "/api/sistema-otto/compras-rua",
    descricao: "Pedidos de rua, aprovações, cartão, dinheiro e compras fora de cotação.",
  },

  FORNECEDORES: {
    id: "AGENTE_FORNECEDORES",
    nome: "Agente de Fornecedores",
    hashtag: "#fornecedores",
    rota: "/api/sistema-otto/fornecedores",
    descricao: "Dados de fornecedores, contatos, CNPJ, WhatsApp e relatórios.",
  },

  COTACAO: {
    id: "AGENTE_COTACAO",
    nome: "Agente de Cotação",
    hashtag: "#cotacao",
    rota: "/api/sistema-otto/cotacao",
    descricao: "Cotações, menor preço, fornecedores vencedores e PDFs.",
  },

  ESTOQUE: {
    id: "AGENTE_ESTOQUE",
    nome: "Agente de Estoque",
    hashtag: "#estoque",
    rota: "/api/sistema-otto/estoque",
    descricao: "Estoque, validade, produtos, saldo, entrada e saída.",
  },

  REQUISICOES: {
    id: "AGENTE_REQUISICOES",
    nome: "Agente de Requisições",
    hashtag: "#requisicoes",
    rota: "/api/sistema-otto/requisicoes",
    descricao: "Requisições internas, entregas, recebimentos e conferências.",
  },

  CHECKLIST: {
    id: "AGENTE_CHECKLIST",
    nome: "Agente de Checklist",
    hashtag: "#checklist",
    rota: "/api/sistema-otto/checklist",
    descricao: "Tarefas, atrasos, cobrança, recorrência e notificações.",
  },

  DELIVERY: {
    id: "AGENTE_DELIVERY",
    nome: "Agente Delivery",
    hashtag: "#delivery",
    rota: "/api/sistema-otto/delivery",
    descricao: "Pedidos delivery, horários, operação e relatórios.",
  },

  RESERVAS: {
    id: "AGENTE_RESERVAS",
    nome: "Agente Reservas",
    hashtag: "#reservas",
    rota: "/api/sistema-otto/reservas",
    descricao: "Reservas, eventos, salas, clientes e datas.",
  },

  MUSICA: {
    id: "AGENTE_MUSICA",
    nome: "Agente Música",
    hashtag: "#musica",
    rota: "/api/sistema-otto/musica",
    descricao: "OTTO Music, playlists, volume, player e programação musical.",
  },

  MEMORIA: {
    id: "AGENTE_MEMORIA",
    nome: "Agente Memória",
    hashtag: "#memoria",
    rota: "/api/sistema-otto/memoria",
    descricao: "Memórias, ensinamentos, histórico e aprendizado do OTTO.",
  },

  CARDAPIO: {
    id: "AGENTE_CARDAPIO",
    nome: "Agente Cardápio",
    hashtag: "#cardapio",
    rota: "/api/sistema-otto/cardapio",
    descricao: "Buffet, produtos, receitas, preços, cardápio e custos.",
  },

  RH: {
    id: "AGENTE_RH",
    nome: "Agente RH",
    hashtag: "#rh",
    rota: "/api/sistema-otto/rh",
    descricao: "Colaboradores, advertência, suspensão, escala e comunicação interna.",
  },
};

// ======================================================
// HELPERS DE DATA
// ======================================================

function agoraBahia() {
  try {
    return new Date(
      new Date().toLocaleString("en-US", {
        timeZone: TIMEZONE,
      })
    );
  } catch {
    return new Date();
  }
}

function dataHoraBR() {
  const d = agoraBahia();

  return d.toLocaleString("pt-BR", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function gerarRequestId() {
  return `otto_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ======================================================
// HELPERS DE RESPOSTA
// ======================================================

function setCors(req, res) {
  const origin = req.headers.origin || "*";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,x-otto-token,x-request-id"
  );
}

function responder(res, status, dados) {
  return res.status(status).json({
    ok: status >= 200 && status < 300,
    sistema: CONFIG.nome,
    versao: CONFIG.versao,
    horario_bahia: dataHoraBR(),
    ...dados,
  });
}

function erroJson(res, status, codigo, mensagem, extra = {}) {
  return responder(res, status, {
    ok: false,
    erro: codigo,
    mensagem,
    ...extra,
  });
}

// ======================================================
// HELPERS DE TEXTO
// ======================================================

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function textoOriginalDoPayload(body = {}) {
  return (
    body.pergunta ||
    body.mensagem ||
    body.texto ||
    body.prompt ||
    body.query ||
    body.input ||
    body.audio_texto ||
    body.audio_transcrito_texto ||
    ""
  );
}

function cortarTexto(texto, limite = 12000) {
  const t = String(texto || "");
  if (t.length <= limite) return t;

  return (
    t.slice(0, limite) +
    "\n\n[CONTEÚDO CORTADO PELO OTTO CENTRAL PARA EVITAR PAYLOAD GRANDE]"
  );
}

function limparPayloadParaAgente(body = {}) {
  const limpo = { ...body };

  // Remove campos que geralmente deixam o payload gigante
  delete limpo.historico_completo;
  delete limpo.messages;
  delete limpo.conversation;
  delete limpo.conversa;
  delete limpo.memoria_bruta;
  delete limpo.logs;
  delete limpo.html;
  delete limpo.canvas_html;
  delete limpo.base64;
  delete limpo.audio_base64;
  delete limpo.imagem_base64;
  delete limpo.arquivo_base64;
  delete limpo.print;
  delete limpo.screenshot;

  const pergunta = textoOriginalDoPayload(body);

  limpo.pergunta = cortarTexto(pergunta, 12000);
  limpo.mensagem = cortarTexto(body.mensagem || pergunta, 12000);
  limpo.texto = cortarTexto(body.texto || pergunta, 12000);

  // Mantém histórico pequeno se existir
  if (Array.isArray(body.historico)) {
    limpo.historico = body.historico
      .slice(-8)
      .map((item) => {
        if (typeof item === "string") {
          return cortarTexto(item, 1500);
        }

        if (item && typeof item === "object") {
          return {
            role: item.role || item.tipo || "user",
            content: cortarTexto(
              item.content || item.texto || item.mensagem || "",
              1500
            ),
          };
        }

        return item;
      });
  }

  return limpo;
}

function tamanhoPayload(obj) {
  try {
    return JSON.stringify(obj || {}).length;
  } catch {
    return 0;
  }
}

// ======================================================
// LOGS
// ======================================================

function logInfo(titulo, dados = {}) {
  if (!CONFIG.LOG_DETALHADO) return;

  console.log(
    JSON.stringify(
      {
        nivel: "INFO",
        titulo,
        horario_bahia: dataHoraBR(),
        ...dados,
      },
      null,
      2
    )
  );
}

function logErro(titulo, erro, dados = {}) {
  console.error(
    JSON.stringify(
      {
        nivel: "ERRO",
        titulo,
        horario_bahia: dataHoraBR(),
        erro_nome: erro?.name || null,
        erro_mensagem: erro?.message || String(erro || ""),
        erro_stack: erro?.stack || null,
        ...dados,
      },
      null,
      2
    )
  );
}

// ======================================================
// DETECÇÃO DE EMPRESA
// ======================================================

function detectarEmpresa(textoNormalizado) {
  const t = textoNormalizado;

  if (
    /\bmercatto restaurante\b/.test(t) ||
    /\brestaurante\b/.test(t) ||
    /\bmercatto\b/.test(t)
  ) {
    return {
      codigo: "MERCATTO_RESTAURANTE",
      nome: "Mercatto Restaurante",
    };
  }

  if (
    /\bemporio\b/.test(t) ||
    /\bmercatto emporio\b/.test(t)
  ) {
    return {
      codigo: "MERCATTO_EMPORIO",
      nome: "Mercatto Empório",
    };
  }

  if (
    /\bdelicia gourmet\b/.test(t) ||
    /\bdelicia\b/.test(t)
  ) {
    return {
      codigo: "DELICIA_GOURMET",
      nome: "Delícia Gourmet",
    };
  }

  if (
    /\bpadaria\b/.test(t) ||
    /\bpadaria delicia\b/.test(t)
  ) {
    return {
      codigo: "PADARIA_DELICIA",
      nome: "Padaria Delícia",
    };
  }

  if (
    /\bvilla\b/.test(t) ||
    /\bvila\b/.test(t) ||
    /\bvilla gourmet\b/.test(t)
  ) {
    return {
      codigo: "VILLA_GOURMET",
      nome: "Villa Gourmet",
    };
  }

  if (
    /\bkids\b/.test(t) ||
    /\bm kids\b/.test(t) ||
    /\bmkids\b/.test(t) ||
    /\bm\.kids\b/.test(t)
  ) {
    return {
      codigo: "MKIDS",
      nome: "M.KIDS",
    };
  }

  return null;
}

// ======================================================
// REGRAS DE ROTEAMENTO
// ======================================================

const REGRAS = [
  {
    agente: "FATURAMENTO",
    peso: 100,
    palavras: [
      "faturamento",
      "faturou",
      "vendeu",
      "vendas",
      "venda",
      "meta",
      "meta ouro",
      "meta prata",
      "quanto falta",
      "bater meta",
      "previsao de meta",
      "ranking de vendas",
      "ticket medio",
      "empresa vendeu",
      "venda hoje",
      "venda do dia",
      "venda do mes",
      "relatorio de metas",
      "relatorio das metas",
      "quanto ja vendeu",
      "qual empresa esta mais proxima",
      "qual empresa esta mais distante",
    ],
  },

  {
    agente: "FINANCEIRO",
    peso: 90,
    palavras: [
      "financeiro",
      "despesa",
      "despesas",
      "contas",
      "conta a pagar",
      "contas a pagar",
      "f360",
      "plano de contas",
      "liquidado",
      "liquidados",
      "pendente",
      "pendentes",
      "vencimento",
      "trava",
      "trava de compras",
      "gastos",
      "compras por plano",
      "relatorio financeiro",
      "centro de custo",
      "fornecedor pago",
    ],
  },

  {
    agente: "COMPRAS_RUA",
    peso: 85,
    palavras: [
      "compra de rua",
      "compras de rua",
      "pedido de rua",
      "pedidos de rua",
      "cartao",
      "dinheiro",
      "mercado livre",
      "aprovacao",
      "aprovar compra",
      "reprovar compra",
      "solicitacao de compra",
      "fora de cotacao",
      "comprar na rua",
    ],
  },

  {
    agente: "FORNECEDORES",
    peso: 85,
    palavras: [
      "fornecedor",
      "fornecedores",
      "cnpj",
      "whatsapp do fornecedor",
      "contato do fornecedor",
      "dados do fornecedor",
      "telefone do fornecedor",
      "email do fornecedor",
      "relatorio de fornecedores",
      "cadastro fornecedor",
      "senha fornecedor",
    ],
  },

  {
    agente: "COTACAO",
    peso: 85,
    palavras: [
      "cotacao",
      "cotacoes",
      "menor preco",
      "melhor preco",
      "preco fornecedor",
      "fornecedor vencedor",
      "vencedores",
      "pdf fornecedor",
      "pdf separado",
      "mapa de cotacao",
      "ganhou",
      "ganharam",
      "itens cotados",
    ],
  },

  {
    agente: "ESTOQUE",
    peso: 80,
    palavras: [
      "estoque",
      "saldo",
      "validade",
      "validade produto",
      "produto vencendo",
      "entrada estoque",
      "saida estoque",
      "movimentacao estoque",
      "codigo de barras",
      "lote",
      "estoque minimo",
    ],
  },

  {
    agente: "REQUISICOES",
    peso: 80,
    palavras: [
      "requisicao",
      "requisicoes",
      "uso e consumo",
      "entregue",
      "recebida",
      "conferida",
      "negado",
      "qtd estoque",
      "qtd emp",
      "local de saida",
      "solicitante",
      "setor solicitante",
    ],
  },

  {
    agente: "CHECKLIST",
    peso: 80,
    palavras: [
      "checklist",
      "tarefa",
      "tarefas",
      "tarefa atrasada",
      "tarefas atrasadas",
      "recorrente",
      "subtarefa",
      "cobranca",
      "cancelamento",
      "notificacao",
      "pendente",
      "concluida",
      "apagar duplicadas",
      "duplicadas",
    ],
  },

  {
    agente: "DELIVERY",
    peso: 75,
    palavras: [
      "delivery",
      "pedido delivery",
      "pedidos delivery",
      "ifood",
      "entrega",
      "motoboy",
      "horario delivery",
      "taxa de entrega",
      "delivery operacional",
    ],
  },

  {
    agente: "RESERVAS",
    peso: 75,
    palavras: [
      "reserva",
      "reservas",
      "evento",
      "eventos",
      "sala vip",
      "sala paulo augusto",
      "casamento",
      "aniversario",
      "rodizio",
      "pessoa",
      "couvert",
      "mesa",
      "mesas",
    ],
  },

  {
    agente: "MUSICA",
    peso: 75,
    palavras: [
      "musica",
      "música",
      "playlist",
      "otto music",
      "volume",
      "player",
      "pausar musica",
      "tocar musica",
      "programacao musical",
      "musico",
      "musicos",
      "dj",
      "ao vivo",
    ],
  },

  {
    agente: "MEMORIA",
    peso: 70,
    palavras: [
      "memoria",
      "memória",
      "lembrar",
      "salvar memoria",
      "ensinamento",
      "aprendeu",
      "aprendizado",
      "historico",
      "o que voce sabe",
      "o que voce lembra",
    ],
  },

  {
    agente: "CARDAPIO",
    peso: 70,
    palavras: [
      "cardapio",
      "cardápio",
      "buffet",
      "receita",
      "receitas",
      "prato",
      "produto buffet",
      "preco ideal",
      "custo unitario",
      "margem",
      "modo de preparo",
    ],
  },

  {
    agente: "RH",
    peso: 70,
    palavras: [
      "colaborador",
      "colaboradores",
      "advertencia",
      "advertência",
      "suspensao",
      "suspensão",
      "bebendo",
      "horario de trabalho",
      "falta",
      "atestado",
      "gerencia",
      "escala",
      "funcionario",
      "funcionário",
    ],
  },
];

function detectarHashtag(textoNormalizado) {
  const t = textoNormalizado;

  for (const chave of Object.keys(AGENTES)) {
    const agente = AGENTES[chave];
    const hashtagNormalizada = normalizarTexto(agente.hashtag);

    if (t.includes(hashtagNormalizada)) {
      return {
        chave,
        agente,
        motivo: `Hashtag detectada: ${agente.hashtag}`,
        score: 999,
      };
    }
  }

  return null;
}

function calcularScoreRegra(textoNormalizado, regra) {
  let score = 0;
  const encontrados = [];

  for (const palavra of regra.palavras) {
    const p = normalizarTexto(palavra);

    if (!p) continue;

    if (textoNormalizado.includes(p)) {
      score += regra.peso;
      encontrados.push(palavra);
    }
  }

  return {
    score,
    encontrados,
  };
}

function escolherAgente(perguntaOriginal) {
  const texto = normalizarTexto(perguntaOriginal);

  if (!texto) {
    return {
      chave: "PRINCIPAL",
      agente: AGENTES.PRINCIPAL,
      motivo: "Pergunta vazia. Enviado para o agente principal.",
      score: 0,
      palavras_detectadas: [],
    };
  }

  const porHashtag = detectarHashtag(texto);
  if (porHashtag) {
    return {
      ...porHashtag,
      palavras_detectadas: [porHashtag.agente.hashtag],
    };
  }

  let melhor = {
    chave: "PRINCIPAL",
    agente: AGENTES.PRINCIPAL,
    motivo: "Nenhuma regra específica encontrada. Enviado para o agente principal.",
    score: 0,
    palavras_detectadas: [],
  };

  for (const regra of REGRAS) {
    const resultado = calcularScoreRegra(texto, regra);

    if (resultado.score > melhor.score) {
      melhor = {
        chave: regra.agente,
        agente: AGENTES[regra.agente],
        motivo: `Detectado por palavras: ${resultado.encontrados.join(", ")}`,
        score: resultado.score,
        palavras_detectadas: resultado.encontrados,
      };
    }
  }

  // Reforço: se falar de empresa + venda/meta, manda para faturamento
  const empresa = detectarEmpresa(texto);
  const falaDeVendaOuMeta =
    texto.includes("vendeu") ||
    texto.includes("venda") ||
    texto.includes("faturou") ||
    texto.includes("faturamento") ||
    texto.includes("meta") ||
    texto.includes("quanto falta");

  if (empresa && falaDeVendaOuMeta && melhor.score < 500) {
    melhor = {
      chave: "FATURAMENTO",
      agente: AGENTES.FATURAMENTO,
      motivo: `Empresa detectada (${empresa.nome}) com assunto de venda/meta.`,
      score: 500,
      palavras_detectadas: ["empresa", "venda/meta"],
    };
  }

  return melhor;
}

// ======================================================
// URL / FETCH COM TIMEOUT
// ======================================================

function montarBaseUrl(req) {
  if (CONFIG.BASE_URL) {
    return CONFIG.BASE_URL.replace(/\/+$/, "");
  }

  const proto =
    req.headers["x-forwarded-proto"] ||
    req.headers["x-vercel-forwarded-proto"] ||
    "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${proto}://${host}`;
}

function montarUrlAgente(req, rota) {
  const base = montarBaseUrl(req);
  const caminho = String(rota || "").startsWith("/")
    ? rota
    : `/${rota}`;

  return `${base}${caminho}`;
}

async function fetchComTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resposta = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return resposta;
  } finally {
    clearTimeout(timer);
  }
}

async function chamarAgente(req, destino, payload, requestId) {
  const url = montarUrlAgente(req, destino.agente.rota);

  const headers = {
    "Content-Type": "application/json",
    "x-request-id": requestId,
    "x-otto-central": "true",
  };

  if (CONFIG.INTERNAL_TOKEN) {
    headers["x-otto-token"] = CONFIG.INTERNAL_TOKEN;
    headers.Authorization = `Bearer ${CONFIG.INTERNAL_TOKEN}`;
  }

  const bodyFinal = {
    ...payload,

    otto_central: {
      request_id: requestId,
      origem: "admin-agente",
      horario_bahia: dataHoraBR(),
      agente_escolhido: destino.agente.id,
      agente_nome: destino.agente.nome,
      hashtag: destino.agente.hashtag,
      motivo: destino.motivo,
      score: destino.score,
      palavras_detectadas: destino.palavras_detectadas || [],
    },
  };

  const bodyString = JSON.stringify(bodyFinal);

  logInfo("OTTO CENTRAL ENVIANDO PARA AGENTE", {
    request_id: requestId,
    agente: destino.agente.id,
    rota: destino.agente.rota,
    url,
    tamanho_body: bodyString.length,
  });

  const resposta = await fetchComTimeout(
    url,
    {
      method: "POST",
      headers,
      body: bodyString,
    },
    CONFIG.TIMEOUT_AGENTE_MS
  );

  const contentType = resposta.headers.get("content-type") || "";
  const texto = await resposta.text();

  let dados;

  if (contentType.includes("application/json")) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = {
        ok: false,
        resposta_bruta: texto,
      };
    }
  } else {
    dados = {
      ok: resposta.ok,
      resposta: texto,
    };
  }

  return {
    status: resposta.status,
    ok: resposta.ok,
    dados,
  };
}

// ======================================================
// GET SEGURO
// ======================================================

function responderGet(req, res) {
  return responder(res, 200, {
    status: "online",
    mensagem:
      "OTTO Central ativo. Esta rota deve ser chamada por POST para perguntas.",
    metodo_recebido: req.method,
    rota: "/api/admin-agente",
    bloqueado: CONFIG.API_BLOQUEADA,
    limite_payload_chars: CONFIG.LIMITE_PAYLOAD_CHARS,
    agentes_disponiveis: Object.values(AGENTES).map((a) => ({
      id: a.id,
      nome: a.nome,
      hashtag: a.hashtag,
      rota: a.rota,
      descricao: a.descricao,
    })),
    exemplo_post: {
      pergunta: "Quanto o Villa já vendeu hoje?",
      origem: "index",
    },
  });
}

// ======================================================
// HANDLER PRINCIPAL
// ======================================================

export default async function handler(req, res) {
  const requestId =
    req.headers["x-request-id"] ||
    req.body?.request_id ||
    gerarRequestId();

  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // ==================================================
    // BLOQUEIO EMERGENCIAL
    // ==================================================

    if (CONFIG.API_BLOQUEADA) {
      logInfo("OTTO CENTRAL BLOQUEADO POR ENV", {
        request_id: requestId,
        metodo: req.method,
        url: req.url,
      });

      return erroJson(
        res,
        503,
        "OTTO_API_BLOQUEADA",
        "API temporariamente bloqueada pela diretoria.",
        {
          request_id: requestId,
          dica: "Para liberar, altere OTTO_API_BLOQUEADA=false na Vercel e faça redeploy.",
        }
      );
    }

    // ==================================================
    // GET NÃO PODE PROCESSAR PERGUNTA
    // Isso evita loop do navegador chamando GET sem querer.
    // ==================================================

    if (req.method === "GET") {
      logInfo("GET RECEBIDO NA CENTRAL", {
        request_id: requestId,
        url: req.url,
        user_agent: req.headers["user-agent"] || null,
      });

      return responderGet(req, res);
    }

    if (req.method !== "POST") {
      return erroJson(
        res,
        405,
        "METODO_NAO_PERMITIDO",
        "Use POST para enviar perguntas ao OTTO Central.",
        {
          request_id: requestId,
          metodo_recebido: req.method,
        }
      );
    }

    // ==================================================
    // PROTEÇÃO CONTRA BODY AUSENTE
    // ==================================================

    const bodyOriginal = req.body || {};
    const tamanhoOriginal = tamanhoPayload(bodyOriginal);

    logInfo("OTTO CENTRAL RECEBEU REQUISIÇÃO", {
      request_id: requestId,
      metodo: req.method,
      url: req.url,
      tamanho_payload: tamanhoOriginal,
      content_type: req.headers["content-type"] || null,
      user_agent: req.headers["user-agent"] || null,
      origem: bodyOriginal.origem || bodyOriginal.source || null,
    });

    // ==================================================
    // BLOQUEIO DE LOOP
    // ==================================================

    const saltosAtuais = Number(bodyOriginal.otto_saltos || 0);

    if (saltosAtuais >= CONFIG.MAX_SALTOS) {
      return erroJson(
        res,
        508,
        "LOOP_DETECTADO",
        "O OTTO detectou muitas tentativas de redirecionamento e interrompeu para evitar loop.",
        {
          request_id: requestId,
          saltos: saltosAtuais,
          max_saltos: CONFIG.MAX_SALTOS,
        }
      );
    }

    // ==================================================
    // BLOQUEIO DE PAYLOAD GRANDE
    // ==================================================

    if (tamanhoOriginal > CONFIG.LIMITE_PAYLOAD_CHARS) {
      logInfo("PAYLOAD GRANDE BLOQUEADO PELO OTTO CENTRAL", {
        request_id: requestId,
        tamanho_payload: tamanhoOriginal,
        limite: CONFIG.LIMITE_PAYLOAD_CHARS,
      });

      return erroJson(
        res,
        413,
        "PAYLOAD_GRANDE_DEMAIS",
        "O conteúdo enviado está grande demais. O OTTO bloqueou antes de processar.",
        {
          request_id: requestId,
          tamanho_payload: tamanhoOriginal,
          limite_payload_chars: CONFIG.LIMITE_PAYLOAD_CHARS,
          acao:
            "No index.html, envie somente pergunta, origem, usuário e no máximo as últimas mensagens do histórico.",
        }
      );
    }

    // ==================================================
    // LIMPA PAYLOAD
    // ==================================================

    const payloadLimpo = limparPayloadParaAgente(bodyOriginal);
    payloadLimpo.otto_saltos = saltosAtuais + 1;
    payloadLimpo.request_id = requestId;

    const perguntaOriginal = textoOriginalDoPayload(payloadLimpo);
    const pergunta = String(perguntaOriginal || "").trim();

    if (!pergunta) {
      return erroJson(
        res,
        400,
        "PERGUNTA_VAZIA",
        "Nenhuma pergunta foi enviada para o OTTO.",
        {
          request_id: requestId,
          campos_aceitos: [
            "pergunta",
            "mensagem",
            "texto",
            "prompt",
            "query",
            "input",
          ],
        }
      );
    }

    // ==================================================
    // ESCOLHE AGENTE
    // ==================================================

    const destino = escolherAgente(pergunta);
    const empresaDetectada = detectarEmpresa(normalizarTexto(pergunta));

    payloadLimpo.empresa_detectada = empresaDetectada;
    payloadLimpo.agente_destino = destino.agente.id;
    payloadLimpo.hashtag = destino.agente.hashtag;

    logInfo("OTTO CENTRAL CLASSIFICOU PERGUNTA", {
      request_id: requestId,
      pergunta: cortarTexto(pergunta, 1500),
      agente: destino.agente.id,
      nome_agente: destino.agente.nome,
      rota: destino.agente.rota,
      motivo: destino.motivo,
      score: destino.score,
      palavras_detectadas: destino.palavras_detectadas,
      empresa_detectada: empresaDetectada,
    });

    // ==================================================
    // CHAMA AGENTE
    // ==================================================

    let respostaAgente;

    try {
      respostaAgente = await chamarAgente(
        req,
        destino,
        payloadLimpo,
        requestId
      );
    } catch (erro) {
      logErro("ERRO AO CHAMAR AGENTE DESTINO", erro, {
        request_id: requestId,
        agente: destino.agente.id,
        rota: destino.agente.rota,
      });

      // Se o agente específico falhar, tenta principal,
      // desde que o destino ainda não seja o principal.
      if (destino.chave !== "PRINCIPAL") {
        const fallback = {
          chave: "PRINCIPAL",
          agente: AGENTES.PRINCIPAL,
          motivo: `Fallback: agente ${destino.agente.id} falhou.`,
          score: 1,
          palavras_detectadas: [],
        };

        logInfo("TENTANDO FALLBACK PARA AGENTE PRINCIPAL", {
          request_id: requestId,
          agente_original: destino.agente.id,
        });

        try {
          respostaAgente = await chamarAgente(
            req,
            fallback,
            {
              ...payloadLimpo,
              erro_agente_original: {
                agente: destino.agente.id,
                rota: destino.agente.rota,
                mensagem: erro?.message || String(erro),
              },
            },
            requestId
          );

          return responder(res, respostaAgente.status || 200, {
            request_id: requestId,
            fallback_usado: true,
            agente_original: destino.agente,
            agente_final: fallback.agente,
            classificacao: {
              motivo_original: destino.motivo,
              motivo_fallback: fallback.motivo,
            },
            resposta: respostaAgente.dados,
          });
        } catch (erroFallback) {
          logErro("ERRO TAMBÉM NO FALLBACK PRINCIPAL", erroFallback, {
            request_id: requestId,
          });

          return erroJson(
            res,
            502,
            "ERRO_AGENTE_E_FALLBACK",
            "O agente escolhido falhou e o agente principal também não respondeu.",
            {
              request_id: requestId,
              agente_original: destino.agente.id,
              erro_original: erro?.message || String(erro),
              erro_fallback: erroFallback?.message || String(erroFallback),
            }
          );
        }
      }

      return erroJson(
        res,
        502,
        "ERRO_AGENTE_DESTINO",
        "O agente destino não respondeu corretamente.",
        {
          request_id: requestId,
          agente: destino.agente.id,
          rota: destino.agente.rota,
          erro: erro?.message || String(erro),
        }
      );
    }

    // ==================================================
    // RESPOSTA FINAL
    // ==================================================

    logInfo("OTTO CENTRAL RECEBEU RESPOSTA DO AGENTE", {
      request_id: requestId,
      agente: destino.agente.id,
      status_agente: respostaAgente.status,
      ok_agente: respostaAgente.ok,
    });

    return responder(res, respostaAgente.status || 200, {
      request_id: requestId,
      agente_escolhido: destino.agente,
      classificacao: {
        motivo: destino.motivo,
        score: destino.score,
        palavras_detectadas: destino.palavras_detectadas,
        empresa_detectada: empresaDetectada,
      },
      resposta: respostaAgente.dados,
    });
  } catch (erro) {
    logErro("ERRO GERAL NO OTTO CENTRAL", erro, {
      request_id: requestId,
      metodo: req.method,
      url: req.url,
    });

    return erroJson(
      res,
      500,
      "ERRO_GERAL_ADMIN_AGENTE",
      "Erro geral no OTTO Central.",
      {
        request_id: requestId,
        erro: erro?.message || String(erro),
      }
    );
  }
}
