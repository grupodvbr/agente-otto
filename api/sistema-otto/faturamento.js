// ======================================================
// OTTO • API PODEROSA DE FATURAMENTO
// /api/sistema-otto/faturamento.js
//
// FUNÇÃO:
// Responder perguntas sobre faturamento, vendas, metas,
// ranking, ticket médio, projeção, dias, meses e períodos.
//
// EMPRESAS OFICIAIS:
// - MERCATTO RESTAURANTE
// - MERCATTO EMPORIO
// - PADARIA
// - VILLA
// - KIDS
//
// REGRA ABSOLUTA:
// Se perguntar de uma empresa, responde SOMENTE ela.
// Se não falar empresa, responde GERAL.
// Se pedir ranking/todas/por empresa, mostra as 5 separadas.
//
// SEPARAÇÃO FORTE:
// MERCATTO RESTAURANTE nunca mistura com MERCATTO EMPORIO.
// VILLA aceita VILA.
// KIDS aceita M.KIDS, M KIDS e MKIDS.
// PADARIA aceita PADARIA DELICIA.
// ======================================================

const { createClient } = require("@supabase/supabase-js");

const fetchCompat = (...args) => {
  if (typeof fetch === "function") {
    return fetch(...args);
  }

  return import("node-fetch").then(({ default: fetchNode }) =>
    fetchNode(...args)
  );
};

// ======================================================
// CONFIGURAÇÕES
// ======================================================

const TIMEZONE = "America/Bahia";

const REQUEST_TIMEOUT_MS = Number(
  process.env.FATURAMENTO_TIMEOUT_MS || 25000
);

const CONFIG_CACHE_MS = Number(
  process.env.CONFIG_CACHE_MS || 60000
);

const HISTORICO_ATIVO =
  String(process.env.FATURAMENTO_HISTORICO_ATIVO || "true") !== "false";

const MAX_DIAS_PERIODO = Number(
  process.env.FATURAMENTO_MAX_DIAS_PERIODO || 62
);

// ======================================================
// VALIDAÇÃO DE AMBIENTE
// ======================================================

if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL não configurada");
}

if (!process.env.SUPABASE_SERVICE_ROLE) {
  throw new Error("SUPABASE_SERVICE_ROLE não configurada");
}

// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

let cacheConfig = null;

// ======================================================
// EMPRESAS OFICIAIS
// ======================================================

const EMPRESAS_OFICIAIS = [
  "MERCATTO RESTAURANTE",
  "MERCATTO EMPORIO",
  "PADARIA",
  "VILLA",
  "KIDS"
];

// ======================================================
// APELIDOS E NOMES ACEITOS
// ======================================================

const APELIDOS_EMPRESAS = {
  "MERCATTO RESTAURANTE": [
    "mercatto restaurante",
    "restaurante mercatto",
    "restaurante",
    "mercatto delicia restaurante",
    "mercatto delícia restaurante",
    "mercatto delicia",
    "mercatto delícia",
    "mercatto",
    "mercato restaurante",
    "mercato delicia"
  ],

  "MERCATTO EMPORIO": [
    "mercatto emporio",
    "mercatto empório",
    "emporio mercatto",
    "empório mercatto",
    "emporio",
    "empório",
    "mercato emporio",
    "mercato empório"
  ],

  PADARIA: [
    "padaria",
    "padaria delicia",
    "padaria delícia",
    "delicia padaria",
    "delícia padaria"
  ],

  VILLA: [
    "villa",
    "vila",
    "villa gourmet",
    "vila gourmet"
  ],

  KIDS: [
    "kids",
    "m kids",
    "m.kids",
    "mkids",
    "m kids festas",
    "m.kids festas",
    "kids festas"
  ]
};

// ======================================================
// TERMOS QUE FORÇAM UMA EMPRESA
// ======================================================

const TERMOS_FORCA_EMPRESA = [
  {
    empresa: "MERCATTO EMPORIO",
    termos: [
      "mercatto emporio",
      "mercatto empório",
      "emporio",
      "empório",
      "empório mercatto",
      "emporio mercatto"
    ]
  },
  {
    empresa: "MERCATTO RESTAURANTE",
    termos: [
      "mercatto restaurante",
      "restaurante",
      "restaurante mercatto"
    ]
  },
  {
    empresa: "PADARIA",
    termos: [
      "padaria",
      "padaria delicia",
      "padaria delícia"
    ]
  },
  {
    empresa: "VILLA",
    termos: [
      "villa",
      "vila",
      "villa gourmet",
      "vila gourmet"
    ]
  },
  {
    empresa: "KIDS",
    termos: [
      "kids",
      "m kids",
      "m.kids",
      "mkids",
      "m kids festas",
      "m.kids festas"
    ]
  }
];

// ======================================================
// MESES
// ======================================================

const MESES = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
};

// ======================================================
// HELPERS BÁSICOS
// ======================================================

function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactar(valor) {
  return normalizar(valor).replace(/\s+/g, "");
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  let texto = String(valor)
    .replace(/[R$\s]/g, "")
    .trim();

  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  texto = texto.replace(/[^\d.-]/g, "");

  const n = Number(texto);

  return Number.isFinite(n) ? n : 0;
}

function arredondar(valor) {
  return Number(numero(valor).toFixed(2));
}

function formatarMoeda(valor) {
  return numero(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatarNumero(valor) {
  return numero(valor).toLocaleString("pt-BR", {
    maximumFractionDigits: 0
  });
}

function formatarPercentual(valor) {
  return `${numero(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function percentual(valor, total) {
  valor = numero(valor);
  total = numero(total);

  if (total <= 0) {
    return 0;
  }

  return arredondar((valor / total) * 100);
}

function calcularTicket(faturamento, vendas) {
  faturamento = numero(faturamento);
  vendas = numero(vendas);

  if (vendas <= 0) {
    return 0;
  }

  return arredondar(faturamento / vendas);
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

function parseJSONSeguro(valor, fallback = {}) {
  if (!valor) {
    return fallback;
  }

  if (typeof valor === "object") {
    return valor;
  }

  try {
    return JSON.parse(valor);
  } catch (e) {
    return fallback;
  }
}

function limitarTexto(valor, limite) {
  const texto = String(valor || "");
  return texto.length > limite ? texto.slice(0, limite) : texto;
}

// ======================================================
// DATAS
// ======================================================

function partesDataBahia(date = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = tipo => partes.find(p => p.type === tipo)?.value;

  return {
    ano: get("year"),
    mes: get("month"),
    dia: get("day")
  };
}

function hojeBahiaISO() {
  const p = partesDataBahia(new Date());
  return `${p.ano}-${p.mes}-${p.dia}`;
}

function agoraBahiaDate() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: TIMEZONE
    })
  );
}

function montarDataISO(ano, mes, dia) {
  return [
    String(ano).padStart(4, "0"),
    String(mes).padStart(2, "0"),
    String(dia).padStart(2, "0")
  ].join("-");
}

function dataValidaISO(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) {
    return false;
  }

  const [ano, mes, dia] = String(data).split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    d.getUTCFullYear() === ano &&
    d.getUTCMonth() + 1 === mes &&
    d.getUTCDate() === dia
  );
}

function addDiasISO(dataISO, dias) {
  const d = new Date(`${dataISO}T12:00:00`);
  d.setDate(d.getDate() + dias);

  return montarDataISO(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate()
  );
}

function anoMesISO(dataISO) {
  return String(dataISO || "").slice(0, 7);
}

function inicioMesISO(dataISO) {
  return `${anoMesISO(dataISO)}-01`;
}

function fimMesISO(dataISO) {
  const [ano, mes] = String(dataISO).split("-").map(Number);
  const ultimo = new Date(ano, mes, 0).getDate();

  return montarDataISO(ano, mes, ultimo);
}

function labelDataBR(dataISO) {
  if (!dataValidaISO(dataISO)) {
    return String(dataISO || "");
  }

  return String(dataISO).split("-").reverse().join("/");
}

function nomeMesPorNumero(numeroMes) {
  const achado = Object.entries(MESES).find(([, n]) => n === Number(numeroMes));
  return achado ? achado[0] : String(numeroMes);
}

function labelMesBR(dataISO) {
  const [ano, mes] = String(dataISO).split("-").map(Number);
  return `${nomeMesPorNumero(mes)}/${ano}`;
}

function diasEntreISO(inicio, fim) {
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function listarDiasPeriodo(inicio, fim, limite = MAX_DIAS_PERIODO) {
  const dias = [];
  let atual = inicio;

  while (atual <= fim && dias.length < limite) {
    dias.push(atual);
    atual = addDiasISO(atual, 1);
  }

  return dias;
}

// ======================================================
// INTERPRETAR PERÍODO
// ======================================================

function interpretarPeriodo(pergunta, body = {}) {
  const texto = normalizar(pergunta);
  const hoje = hojeBahiaISO();

  let tipo = "dia";
  let data = hoje;
  let inicio = hoje;
  let fim = hoje;
  let label = "hoje";
  let origem = "padrao_hoje";

  if (body.data && dataValidaISO(body.data)) {
    data = body.data;
    inicio = data;
    fim = data;
    tipo = "dia";
    label = labelDataBR(data);
    origem = "body_data";
  }

  if (
    body.inicio &&
    body.fim &&
    dataValidaISO(body.inicio) &&
    dataValidaISO(body.fim)
  ) {
    inicio = body.inicio;
    fim = body.fim;

    if (inicio > fim) {
      const tmp = inicio;
      inicio = fim;
      fim = tmp;
    }

    data = fim;
    tipo = inicio === fim ? "dia" : "periodo";
    label =
      inicio === fim
        ? labelDataBR(inicio)
        : `${labelDataBR(inicio)} até ${labelDataBR(fim)}`;
    origem = "body_periodo";
  }

  const iso = texto.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const dataBR = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);

  if (iso && dataValidaISO(iso[0])) {
    data = iso[0];
    inicio = data;
    fim = data;
    tipo = "dia";
    label = labelDataBR(data);
    origem = "pergunta_iso";
  } else if (dataBR) {
    const dia = Number(dataBR[1]);
    const mes = Number(dataBR[2]);

    let ano = dataBR[3]
      ? Number(dataBR[3])
      : Number(hoje.slice(0, 4));

    if (ano < 100) {
      ano += 2000;
    }

    const montada = montarDataISO(ano, mes, dia);

    if (dataValidaISO(montada)) {
      data = montada;
      inicio = data;
      fim = data;
      tipo = "dia";
      label = labelDataBR(data);
      origem = "pergunta_data_br";
    }
  } else if (texto.includes("anteontem")) {
    data = addDiasISO(hoje, -2);
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "anteontem";
    origem = "anteontem";
  } else if (texto.includes("ontem")) {
    data = addDiasISO(hoje, -1);
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "ontem";
    origem = "ontem";
  } else if (
    texto.includes("hoje") ||
    texto.includes("agora") ||
    texto.includes("ja vendeu") ||
    texto.includes("ja faturou") ||
    texto.includes("vendeu hoje") ||
    texto.includes("faturou hoje")
  ) {
    data = hoje;
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "hoje";
    origem = "hoje";
  }

  if (
    texto.includes("semana") ||
    texto.includes("ultimos 7") ||
    texto.includes("ultimas 7")
  ) {
    fim = hoje;
    inicio = addDiasISO(hoje, -6);
    data = fim;
    tipo = "periodo";
    label = "últimos 7 dias";
    origem = "ultimos_7_dias";
  }

  if (
    texto.includes("ultimos 30") ||
    texto.includes("ultimas 30")
  ) {
    fim = hoje;
    inicio = addDiasISO(hoje, -29);
    data = fim;
    tipo = "periodo";
    label = "últimos 30 dias";
    origem = "ultimos_30_dias";
  }

  if (texto.includes("mes passado")) {
    const [anoAtual, mesAtual] = hoje.split("-").map(Number);
    const d = new Date(anoAtual, mesAtual - 2, 1);

    data = montarDataISO(d.getFullYear(), d.getMonth() + 1, 1);
    inicio = inicioMesISO(data);
    fim = fimMesISO(data);
    tipo = "mes";
    label = `mês passado (${labelMesBR(data)})`;
    origem = "mes_passado";
  }

  for (const [nomeMes, numeroMes] of Object.entries(MESES)) {
    if (texto.includes(normalizar(nomeMes))) {
      const anoEncontrado = texto.match(/\b(20\d{2})\b/);

      const ano = anoEncontrado
        ? Number(anoEncontrado[1])
        : Number(hoje.slice(0, 4));

      data = montarDataISO(ano, numeroMes, 1);
      inicio = inicioMesISO(data);

      if (anoMesISO(data) === anoMesISO(hoje)) {
        fim = hoje;
      } else {
        fim = fimMesISO(data);
      }

      tipo = "mes";
      label = `${nomeMes}/${ano}`;
      origem = "mes_nome";
    }
  }

  if (
    texto.includes("mes") ||
    texto.includes("mensal") ||
    texto.includes("acumulado") ||
    texto.includes("no mes")
  ) {
    if (origem !== "mes_passado" && origem !== "mes_nome") {
      tipo = "mes";
      inicio = inicioMesISO(data);

      if (anoMesISO(data) === anoMesISO(hoje)) {
        fim = hoje;
        label = "mês atual";
      } else {
        fim = fimMesISO(data);
        label = labelMesBR(data);
      }

      origem = "mes_atual_ou_data";
    }
  }

  if (inicio > fim) {
    const tmp = inicio;
    inicio = fim;
    fim = tmp;
  }

  const dias = diasEntreISO(inicio, fim) + 1;

  return {
    tipo,
    data,
    inicio,
    fim,
    dias,
    label,
    ano_mes: anoMesISO(data),
    hoje,
    origem
  };
}

// ======================================================
// INTENÇÃO
// ======================================================

function pediuAnalise(pergunta, body = {}) {
  if (body.analise === true || body.detalhado === true) {
    return true;
  }

  const texto = normalizar(pergunta);

  return (
    texto.includes("analise") ||
    texto.includes("analisa") ||
    texto.includes("detalhe") ||
    texto.includes("detalhado") ||
    texto.includes("explica") ||
    texto.includes("diagnostico") ||
    texto.includes("comparar") ||
    texto.includes("comparacao") ||
    texto.includes("projecao") ||
    texto.includes("previsao") ||
    texto.includes("ritmo") ||
    texto.includes("tendencia") ||
    texto.includes("recomenda") ||
    texto.includes("o que fazer") ||
    texto.includes("porque") ||
    texto.includes("por que")
  );
}

function interpretarIntencao(pergunta) {
  const texto = normalizar(pergunta);

  if (
    texto.includes("ranking") ||
    texto.includes("quem vendeu mais") ||
    texto.includes("vendeu mais") ||
    texto.includes("maior venda") ||
    texto.includes("lider") ||
    texto.includes("primeiro lugar")
  ) {
    return "ranking";
  }

  if (
    texto.includes("pix") ||
    texto.includes("credito") ||
    texto.includes("debito") ||
    texto.includes("cartao") ||
    texto.includes("dinheiro") ||
    texto.includes("forma de pagamento") ||
    texto.includes("formas de pagamento") ||
    texto.includes("finalizadora") ||
    texto.includes("pagamento")
  ) {
    return "formas_pagamento";
  }

  if (
    texto.includes("ticket") ||
    texto.includes("ticket medio") ||
    texto === "tm"
  ) {
    return "ticket";
  }

  if (
    texto.includes("meta") ||
    texto.includes("prata") ||
    texto.includes("ouro") ||
    texto.includes("bateu") ||
    texto.includes("bater") ||
    texto.includes("falta para")
  ) {
    return "meta";
  }

  if (
    texto.includes("projecao") ||
    texto.includes("previsao") ||
    texto.includes("ritmo") ||
    texto.includes("tendencia")
  ) {
    return "projecao";
  }

  if (
    texto.includes("comparar") ||
    texto.includes("comparacao") ||
    texto.includes("diferenca") ||
    texto.includes("versus") ||
    texto.includes(" vs ")
  ) {
    return "comparacao";
  }

  if (
    texto.includes("resumo") ||
    texto.includes("geral") ||
    texto.includes("todas") ||
    texto.includes("cada empresa") ||
    texto.includes("por empresa")
  ) {
    return "resumo";
  }

  return "faturamento";
}

function pedeTodasEmpresas(pergunta, body = {}) {
  const texto = normalizar(pergunta);

  // ======================================================
  // REGRA:
  // Só lista empresa por empresa quando o usuário pedir isso.
  // Não usa body.todas nem body.geral para não forçar resposta.
  // ======================================================

  return (
    texto.includes("todas as empresas") ||
    texto.includes("as empresas") ||
    texto.includes("cada empresa") ||
    texto.includes("por empresa") ||
    texto.includes("vendas das empresas") ||
    texto.includes("venda das empresas") ||
    texto.includes("faturamento das empresas") ||
    texto.includes("quanto vendeu cada") ||
    texto.includes("quanto cada empresa") ||
    texto.includes("lista as empresas") ||
    texto.includes("listar empresas") ||
    texto.includes("separado por empresa") ||
    texto.includes("separada por empresa") ||
    texto.includes("uma por uma")
  );
}

// ======================================================
// SEPARAÇÃO DE EMPRESAS
// ======================================================

function identificarEmpresaEmTexto(textoOriginal) {
  const texto = normalizar(textoOriginal);
  const textoCompacto = compactar(textoOriginal);

  if (!texto) {
    return null;
  }

  // ======================================================
  // 1. EMPORIO
  // ======================================================
  if (
    texto.includes("emporio") ||
    texto.includes("empório") ||
    textoCompacto.includes("mercattoemporio") ||
    textoCompacto.includes("mercattoempório") ||
    textoCompacto.includes("emporiomercatto") ||
    textoCompacto.includes("empóriomercatto")
  ) {
    return "MERCATTO EMPORIO";
  }

  // ======================================================
  // 2. PADARIA
  // ======================================================
  if (
    texto.includes("padaria") ||
    textoCompacto.includes("padariadelicia") ||
    textoCompacto.includes("padariadelícia")
  ) {
    return "PADARIA";
  }

  // ======================================================
  // 3. VILLA / VILA
  // ======================================================
  if (
    texto.includes("villa") ||
    texto.includes("vila") ||
    textoCompacto.includes("villagourmet") ||
    textoCompacto.includes("vilagourmet")
  ) {
    return "VILLA";
  }

  // ======================================================
  // 4. KIDS / M.KIDS
  // ======================================================
  if (
    texto.includes("kids") ||
    textoCompacto.includes("mkids") ||
    textoCompacto.includes("mkidsfestas")
  ) {
    return "KIDS";
  }

  // ======================================================
  // 5. RESTAURANTE
  // ======================================================
  if (
    texto.includes("restaurante") ||
    textoCompacto.includes("mercattorestaurante") ||
    textoCompacto.includes("restaurantemercatto")
  ) {
    return "MERCATTO RESTAURANTE";
  }

  // ======================================================
  // 6. MERCATTO SOZINHO
  // Só vale quando o USUÁRIO realmente escreveu Mercatto.
  // ======================================================
  if (
    texto === "mercatto" ||
    texto === "mercato" ||
    texto.includes(" mercatto ") ||
    texto.startsWith("mercatto ") ||
    texto.endsWith(" mercatto") ||
    textoCompacto === "mercatto" ||
    textoCompacto === "mercato"
  ) {
    return "MERCATTO RESTAURANTE";
  }

  return null;
}

function identificarEmpresa(pergunta, body = {}) {
  // ======================================================
  // REGRA ABSOLUTA:
  // NÃO usa body.empresa, body.unidade, body.loja ou filial.
  // Só leva para empresa se o USUÁRIO pedir na pergunta.
  // ======================================================

  return identificarEmpresaEmTexto(pergunta);
}
function identificarEmpresasParaSomar(pergunta) {
  const texto = normalizar(pergunta);
  const empresas = [];

  const adicionar = empresa => {
    if (!empresas.includes(empresa)) {
      empresas.push(empresa);
    }
  };

  // ======================================================
  // MERCATTO RESTAURANTE
  // ======================================================
  if (
    texto.includes("restaurante") ||
    texto.includes("mercatto restaurante")
  ) {
    adicionar("MERCATTO RESTAURANTE");
  }

  // ======================================================
  // MERCATTO EMPORIO
  // ======================================================
  if (
    texto.includes("emporio") ||
    texto.includes("empório") ||
    texto.includes("mercatto emporio") ||
    texto.includes("mercatto empório")
  ) {
    adicionar("MERCATTO EMPORIO");
  }

  // ======================================================
  // PADARIA
  // ======================================================
  if (
    texto.includes("padaria") ||
    texto.includes("padaria delicia") ||
    texto.includes("padaria delícia")
  ) {
    adicionar("PADARIA");
  }

  // ======================================================
  // VILLA
  // ======================================================
  if (
    texto.includes("villa") ||
    texto.includes("vila")
  ) {
    adicionar("VILLA");
  }

  // ======================================================
  // KIDS
  // ======================================================
  if (
    texto.includes("kids") ||
    texto.includes("m kids") ||
    texto.includes("m.kids") ||
    texto.includes("mkids")
  ) {
    adicionar("KIDS");
  }

  return empresas;
}

function pediuSomaEmpresas(pergunta) {
  const texto = normalizar(pergunta);

  return (
    texto.includes("soma") ||
    texto.includes("somar") ||
    texto.includes("some") ||
    texto.includes("somando") ||
    texto.includes("junto") ||
    texto.includes("juntar") ||
    texto.includes("junte") ||
    texto.includes("total de") ||
    texto.includes("total da") ||
    texto.includes("total do") ||
    texto.includes("mais") ||
    texto.includes("+")
  );
}

function consolidarSomaEmpresas(empresas, empresasParaSomar, periodo) {
  const selecionadas = empresas.filter(e =>
    empresasParaSomar.includes(e.empresa)
  );

  const nome = selecionadas.map(e => e.empresa).join(" + ");

  const soma = {
    empresa: nome || "SOMA DE EMPRESAS",

    empresas_somadas: selecionadas.map(e => e.empresa),

    faturamento_hoje: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.faturamento_hoje), 0)
    ),

    faturamento_periodo: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.faturamento_periodo), 0)
    ),

    faturamento_mes: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.faturamento_mes), 0)
    ),

    vendas: selecionadas.reduce((s, e) => s + numero(e.vendas), 0),

    vendas_periodo: selecionadas.reduce((s, e) => s + numero(e.vendas_periodo), 0),

    vendas_mes: selecionadas.reduce((s, e) => s + numero(e.vendas_mes), 0),

    meta_prata: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.meta_prata), 0)
    ),

    meta_ouro: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.meta_ouro), 0)
    ),

    meta_diaria: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.meta_diaria), 0)
    ),

    trava_compras: arredondar(
      selecionadas.reduce((s, e) => s + numero(e.trava_compras), 0)
    ),

    origem_encontrada: selecionadas.some(e => e.origem_encontrada),

    nomes_encontrados_na_api: selecionadas.flatMap(e => e.nomes_encontrados_na_api || [])
  };

  soma.ticket = calcularTicket(soma.faturamento_hoje, soma.vendas);

  soma.ticket_periodo = calcularTicket(
    soma.faturamento_periodo,
    soma.vendas_periodo
  );

  soma.ticket_mes = calcularTicket(
    soma.faturamento_mes,
    soma.vendas_mes
  );

  soma.percentual_prata = percentual(
    soma.faturamento_mes,
    soma.meta_prata
  );

  soma.percentual_ouro = percentual(
    soma.faturamento_mes,
    soma.meta_ouro
  );

  soma.falta_prata = Math.max(
    0,
    arredondar(soma.meta_prata - soma.faturamento_mes)
  );

  soma.falta_ouro = Math.max(
    0,
    arredondar(soma.meta_ouro - soma.faturamento_mes)
  );

  return enriquecerEmpresa(soma, periodo);
}

function responderSomaEmpresasDireto(soma, periodo) {
  const valor = valorPrincipal(soma, periodo);
  const periodoTexto = labelPeriodoResposta(periodo);

  const linhas = [];

  linhas.push(`SOMA DAS EMPRESAS`);
  linhas.push(periodoTexto);
  linhas.push("");

  soma.empresas_somadas.forEach(nomeEmpresa => {
    linhas.push(`- ${nomeEmpresa}`);
  });

  linhas.push("");
  linhas.push(`Total: ${formatarMoeda(valor)}.`);

  if (periodo.tipo === "dia") {
    linhas.push(`No mês: ${formatarMoeda(soma.faturamento_mes)}.`);
  }

  return linhas.join("\n");
}





function empresaCombina(nomeVindoDaApi, empresaOficial) {
  const nome = normalizar(nomeVindoDaApi);
  const nomeCompacto = compactar(nomeVindoDaApi);

  if (!nome) {
    return false;
  }

  // ======================================================
  // EMPORIO
  // Prioridade máxima porque também tem Mercatto no nome.
  // ======================================================
  if (empresaOficial === "MERCATTO EMPORIO") {
    return (
      nome.includes("emporio") ||
      nome.includes("empório") ||
      nomeCompacto.includes("mercattoemporio") ||
      nomeCompacto.includes("mercattoempório") ||
      nomeCompacto.includes("emporiomercatto") ||
      nomeCompacto.includes("empóriomercatto")
    );
  }

  // ======================================================
  // RESTAURANTE
  // Só é Restaurante se NÃO for Empório, Padaria, Villa ou Kids.
  // ======================================================
  if (empresaOficial === "MERCATTO RESTAURANTE") {
    if (
      nome.includes("emporio") ||
      nome.includes("empório") ||
      nome.includes("padaria") ||
      nome.includes("villa") ||
      nome.includes("vila") ||
      nome.includes("kids") ||
      nomeCompacto.includes("mkids")
    ) {
      return false;
    }

    return (
      nome.includes("mercatto restaurante") ||
      nome.includes("restaurante mercatto") ||
      nome.includes("restaurante") ||
      nome === "mercatto" ||
      nome === "mercato" ||
      nomeCompacto === "mercatto" ||
      nomeCompacto === "mercato" ||
      nome.includes("mercatto delicia") ||
      nome.includes("mercatto delícia")
    );
  }

  // ======================================================
  // PADARIA
  // ======================================================
  if (empresaOficial === "PADARIA") {
    return (
      nome.includes("padaria") ||
      nomeCompacto.includes("padariadelicia") ||
      nomeCompacto.includes("padariadelícia")
    );
  }

  // ======================================================
  // VILLA
  // ======================================================
  if (empresaOficial === "VILLA") {
    return (
      nome.includes("villa") ||
      nome.includes("vila") ||
      nomeCompacto.includes("villagourmet") ||
      nomeCompacto.includes("vilagourmet")
    );
  }

  // ======================================================
  // KIDS
  // ======================================================
  if (empresaOficial === "KIDS") {
    return (
      nome.includes("kids") ||
      nomeCompacto.includes("mkids") ||
      nomeCompacto.includes("mkidsfestas")
    );
  }

  return false;
}

function classificarEmpresaDaLinha(nomeVindoDaApi) {
  const nome = normalizar(nomeVindoDaApi);

  if (!nome) {
    return null;
  }

  // ======================================================
  // ORDEM OBRIGATÓRIA
  // Empresas com nomes mais específicos vêm primeiro.
  // Mercatto Restaurante fica por último entre Mercatto e Empório.
  // ======================================================

  if (empresaCombina(nome, "MERCATTO EMPORIO")) {
    return "MERCATTO EMPORIO";
  }

  if (empresaCombina(nome, "PADARIA")) {
    return "PADARIA";
  }

  if (empresaCombina(nome, "VILLA")) {
    return "VILLA";
  }

  if (empresaCombina(nome, "KIDS")) {
    return "KIDS";
  }

  if (empresaCombina(nome, "MERCATTO RESTAURANTE")) {
    return "MERCATTO RESTAURANTE";
  }

  return null;
}

// ======================================================
// CONFIGURAÇÕES SUPABASE
// ======================================================

async function carregarConfiguracoes() {
  if (
    cacheConfig &&
    Date.now() - cacheConfig.carregado_em < CONFIG_CACHE_MS
  ) {
    return cacheConfig.valor;
  }

  const { data: urlRows, error: urlError } = await supabase
    .from("url_api")
    .select("*")
    .eq("tipo", "vendas_api")
    .eq("ativo", true)
    .limit(1);

  if (urlError) {
    throw new Error(`Erro ao buscar url_api: ${urlError.message}`);
  }

  const apiConfig = urlRows?.[0];

  if (!apiConfig?.url) {
    throw new Error(
      "URL da API de vendas não encontrada na tabela url_api com tipo = vendas_api e ativo = true."
    );
  }

  const { data: metaRows, error: metaError } = await supabase
    .from("parametros_sistema")
    .select("*")
    .eq("nome_parametro", "meta_vendas")
    .limit(1);

  if (metaError) {
    throw new Error(`Erro ao buscar meta_vendas: ${metaError.message}`);
  }

  const valor = {
    API_URL: String(apiConfig.url || "").replace(/\/$/, ""),
    METAS: parseJSONSeguro(metaRows?.[0]?.dados || {}, {})
  };

  cacheConfig = {
    carregado_em: Date.now(),
    valor
  };

  return valor;
}

// ======================================================
// BUSCA HTTP
// ======================================================

async function buscarJSON(url, contexto, obrigatorio = true) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const resposta = await fetchCompat(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });

    const texto = await resposta.text();

    let json = {};

    try {
      json = texto ? JSON.parse(texto) : {};
    } catch (e) {
      throw new Error(`${contexto}: resposta não é JSON válido.`);
    }

    if (!resposta.ok) {
      throw new Error(`${contexto}: API retornou status ${resposta.status}.`);
    }

    return json || {};
  } catch (e) {
    if (!obrigatorio) {
      return {
        erro:
          e.name === "AbortError"
            ? `${contexto}: tempo limite excedido.`
            : e.message,
        url
      };
    }

    if (e.name === "AbortError") {
      throw new Error(`${contexto}: tempo limite excedido.`);
    }

    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

async function buscarPrimeiroJSON(urls, contexto, obrigatorio = true) {
  let ultimoErro = null;

  for (const url of urls) {
    const resultado = await buscarJSON(url, contexto, false);

    if (!resultado?.erro) {
      return {
        ok: true,
        url,
        json: resultado
      };
    }

    ultimoErro = resultado.erro;
  }

  if (obrigatorio) {
    throw new Error(
      `${contexto}: nenhuma rota respondeu corretamente. Último erro: ${ultimoErro || "desconhecido"}`
    );
  }

  return {
    ok: false,
    url: urls[0],
    erro: ultimoErro || "Não foi possível buscar dados.",
    json: {}
  };
}

async function buscarResumoDia(API_URL, data) {
  return buscarPrimeiroJSON(
    [
      `${API_URL}/resumo-dia?data=${encodeURIComponent(data)}`,
      `${API_URL}/resumo?data=${encodeURIComponent(data)}`,
      `${API_URL}/vendas/resumo-dia?data=${encodeURIComponent(data)}`,
      `${API_URL}/vendas?data=${encodeURIComponent(data)}`
    ],
    `Resumo do dia ${data}`,
    true
  );
}

async function buscarResumoMes(API_URL, periodo) {
  const anoMes = periodo.ano_mes;
  const inicio = inicioMesISO(`${anoMes}-01`);
  const fim =
    anoMes === anoMesISO(periodo.hoje)
      ? periodo.hoje
      : fimMesISO(`${anoMes}-01`);

  return buscarPrimeiroJSON(
    [
      `${API_URL}/resumo-mes?ano_mes=${encodeURIComponent(anoMes)}`,
      `${API_URL}/resumo-mes?mes=${encodeURIComponent(anoMes)}`,
      `${API_URL}/resumo-mes?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`,
      `${API_URL}/vendas/resumo-mes?ano_mes=${encodeURIComponent(anoMes)}`,
      `${API_URL}/resumo-mes`
    ],
    `Resumo do mês ${anoMes}`,
    true
  );
}

async function buscarAnalitico(API_URL, data) {
  return buscarPrimeiroJSON(
    [
      `${API_URL}/cupons-analitico?data=${encodeURIComponent(data)}`,
      `${API_URL}/analitico?data=${encodeURIComponent(data)}`,
      `${API_URL}/vendas/cupons-analitico?data=${encodeURIComponent(data)}`,
      `${API_URL}/vendas/analitico?data=${encodeURIComponent(data)}`
    ],
    `Analítico do dia ${data}`,
    false
  );
}

async function buscarResumoPeriodoPorDias(API_URL, periodo) {
  const dias = listarDiasPeriodo(periodo.inicio, periodo.fim, MAX_DIAS_PERIODO);

  const resultados = await Promise.all(
    dias.map(async data => {
      const resultado = await buscarResumoDia(API_URL, data).catch(e => ({
        ok: false,
        erro: e.message,
        url: null,
        json: {}
      }));

      return {
        data,
        ...resultado
      };
    })
  );

  return resultados;
}

// ======================================================
// EXTRAÇÃO DOS DADOS DA API EXTERNA
// ======================================================

function extrairArrayResumo(obj) {
  if (Array.isArray(obj)) {
    return obj;
  }

  const caminhos = [
    obj?.empresas,
    obj?.data?.empresas,
    obj?.resultado?.empresas,
    obj?.dados?.empresas,
    obj?.rows,
    obj?.data,
    obj?.resultado,
    obj?.dados
  ];

  for (const item of caminhos) {
    if (Array.isArray(item)) {
      return item;
    }
  }

  return [];
}

function nomeEmpresaDaLinha(linha) {
  return (
    linha.empresa ||
    linha.nome ||
    linha.unidade ||
    linha.loja ||
    linha.filial ||
    linha.empresa_nome ||
    linha.nome_empresa ||
    linha.fantasia ||
    linha.descricao_empresa ||
    linha.company ||
    linha.branch ||
    ""
  );
}

function faturamentoDaLinha(linha) {
  return numero(
    linha.faturamento ??
    linha.faturamento_hoje ??
    linha.faturamento_dia ??
    linha.faturamento_mes ??
    linha.total ??
    linha.valor ??
    linha.valor_total ??
    linha.receita ??
    linha.venda ??
    linha.vendas_valor ??
    linha.total_vendido ??
    linha.liquido ??
    linha.valor_liquido ??
    linha.net_sales ??
    linha.sales ??
    0
  );
}

function vendasDaLinha(linha) {
  return numero(
    linha.vendas ??
    linha.quantidade ??
    linha.qtd ??
    linha.total_vendas ??
    linha.cupons ??
    linha.tickets ??
    linha.atendimentos ??
    linha.pedidos ??
    linha.orders ??
    linha.count ??
    0
  );
}

// ======================================================
// METAS SEPARADAS POR EMPRESA
// ======================================================

function buscarBlocoEmpresaNasMetas(metas, empresa) {
  const origem =
    metas?.empresas ||
    metas?.Empresas ||
    metas?.EMPRESAS ||
    metas ||
    {};

  const chave = Object.keys(origem).find(nome => {
    return empresaCombina(nome, empresa);
  });

  return chave ? origem[chave] || {} : {};
}

function metasDaEmpresa(metas, empresa, anoMes) {
  const registro = buscarBlocoEmpresaNasMetas(metas, empresa);

  const mes =
    registro?.metas?.[anoMes] ||
    registro?.meses?.[anoMes] ||
    registro?.[anoMes] ||
    {};

  return {
    meta_prata: numero(
      mes.meta_prata ??
      mes.prata ??
      mes.metaPrata ??
      registro.meta_prata ??
      registro.prata ??
      0
    ),
    meta_ouro: numero(
      mes.meta_ouro ??
      mes.ouro ??
      mes.metaOuro ??
      registro.meta_ouro ??
      registro.ouro ??
      0
    ),
    meta_diaria: numero(
      mes.meta_diaria ??
      mes.diaria ??
      mes.metaDiaria ??
      registro.meta_diaria ??
      registro.diaria ??
      0
    ),
    trava_compras: numero(
      mes.trava_compras ??
      mes.trava ??
      mes.travaCompras ??
      registro.trava_compras ??
      registro.trava ??
      0
    )
  };
}

// ======================================================
// CONSOLIDAÇÃO
// ======================================================

function criarEmpresaBase(empresa, metasEmpresa) {
  return {
    empresa,
    faturamento_hoje: 0,
    faturamento_periodo: 0,
    faturamento_mes: 0,
    vendas: 0,
    vendas_periodo: 0,
    vendas_mes: 0,
    ticket: 0,
    ticket_periodo: 0,
    ticket_mes: 0,
    meta_prata: arredondar(metasEmpresa.meta_prata),
    meta_ouro: arredondar(metasEmpresa.meta_ouro),
    meta_diaria: arredondar(metasEmpresa.meta_diaria),
    trava_compras: arredondar(metasEmpresa.trava_compras),
    percentual_prata: 0,
    percentual_ouro: 0,
    falta_prata: arredondar(metasEmpresa.meta_prata),
    falta_ouro: arredondar(metasEmpresa.meta_ouro),
    origem_encontrada: false,
    nomes_encontrados_na_api: []
  };
}

function enriquecerEmpresa(empresa, periodo) {
  const dataReferencia =
    periodo.ano_mes === anoMesISO(periodo.hoje)
      ? periodo.hoje
      : fimMesISO(`${periodo.ano_mes}-01`);

  const diaDoMes = Math.max(1, Number(String(dataReferencia).slice(8, 10)));
  const totalDiasMes = Number(fimMesISO(dataReferencia).slice(8, 10));
  const diasRestantesMes = Math.max(0, totalDiasMes - diaDoMes);

  const faturamentoMes = numero(empresa.faturamento_mes);

  const ritmoDiarioAtual = arredondar(faturamentoMes / diaDoMes);
  const projecaoMes = arredondar(ritmoDiarioAtual * totalDiasMes);

  const metaReferencia =
    numero(empresa.meta_ouro) > 0
      ? numero(empresa.meta_ouro)
      : numero(empresa.meta_prata);

  const faltaMetaReferencia = Math.max(
    0,
    arredondar(metaReferencia - faturamentoMes)
  );

  const necessarioPorDia =
    diasRestantesMes > 0
      ? arredondar(faltaMetaReferencia / diasRestantesMes)
      : faltaMetaReferencia;

  const mediaPeriodo =
    periodo.dias > 0
      ? arredondar(numero(empresa.faturamento_periodo) / periodo.dias)
      : 0;

  const metaDiariaReferencia =
    numero(empresa.meta_diaria) > 0
      ? numero(empresa.meta_diaria)
      : metaReferencia > 0
        ? arredondar(metaReferencia / totalDiasMes)
        : 0;

  return {
    ...empresa,
    ritmo_diario_atual: ritmoDiarioAtual,
    media_periodo: mediaPeriodo,
    projecao_mes: projecaoMes,
    dias_restantes_mes: diasRestantesMes,
    total_dias_mes: totalDiasMes,
    dia_do_mes: diaDoMes,
    meta_referencia: arredondar(metaReferencia),
    falta_meta_referencia: faltaMetaReferencia,
    necessario_por_dia: necessarioPorDia,
    meta_diaria_referencia: arredondar(metaDiariaReferencia),
    desempenho_hoje_vs_meta_diaria: percentual(
      empresa.faturamento_hoje,
      metaDiariaReferencia
    ),
    desempenho_periodo_vs_meta_diaria: percentual(
      mediaPeriodo,
      metaDiariaReferencia
    ),
    tendencia_bate_meta:
      metaReferencia > 0
        ? projecaoMes >= metaReferencia
        : null
  };
}

function consolidarDiaMes({ resumoDia, resumoMes, metas, periodo }) {
  const linhasDia = extrairArrayResumo(resumoDia);
  const linhasMes = extrairArrayResumo(resumoMes);

  return EMPRESAS_OFICIAIS.map(empresaOficial => {
    const metasEmpresa = metasDaEmpresa(metas, empresaOficial, periodo.ano_mes);
    const base = criarEmpresaBase(empresaOficial, metasEmpresa);

    const linhasDiaEmpresa = linhasDia.filter(linha => {
      const nome = nomeEmpresaDaLinha(linha);
      const classificada = classificarEmpresaDaLinha(nome);
      return classificada === empresaOficial;
    });

    const linhasMesEmpresa = linhasMes.filter(linha => {
      const nome = nomeEmpresaDaLinha(linha);
      const classificada = classificarEmpresaDaLinha(nome);
      return classificada === empresaOficial;
    });

    const faturamentoHoje = linhasDiaEmpresa.reduce(
      (soma, linha) => soma + faturamentoDaLinha(linha),
      0
    );

    const vendasHoje = linhasDiaEmpresa.reduce(
      (soma, linha) => soma + vendasDaLinha(linha),
      0
    );

    const faturamentoMes = linhasMesEmpresa.reduce(
      (soma, linha) => soma + faturamentoDaLinha(linha),
      0
    );

    const vendasMes = linhasMesEmpresa.reduce(
      (soma, linha) => soma + vendasDaLinha(linha),
      0
    );

    base.faturamento_hoje = arredondar(faturamentoHoje);
    base.faturamento_mes = arredondar(faturamentoMes);
    base.vendas = vendasHoje;
    base.vendas_mes = vendasMes;
    base.ticket = calcularTicket(faturamentoHoje, vendasHoje);
    base.ticket_mes = calcularTicket(faturamentoMes, vendasMes);

    if (periodo.tipo === "mes") {
      base.faturamento_periodo = arredondar(faturamentoMes);
      base.vendas_periodo = vendasMes;
      base.ticket_periodo = calcularTicket(faturamentoMes, vendasMes);
    } else {
      base.faturamento_periodo = arredondar(faturamentoHoje);
      base.vendas_periodo = vendasHoje;
      base.ticket_periodo = calcularTicket(faturamentoHoje, vendasHoje);
    }

    base.percentual_prata = percentual(faturamentoMes, base.meta_prata);
    base.percentual_ouro = percentual(faturamentoMes, base.meta_ouro);
    base.falta_prata = Math.max(0, arredondar(base.meta_prata - faturamentoMes));
    base.falta_ouro = Math.max(0, arredondar(base.meta_ouro - faturamentoMes));
    base.origem_encontrada = linhasDiaEmpresa.length > 0 || linhasMesEmpresa.length > 0;
    base.nomes_encontrados_na_api = [
      ...new Set([
        ...linhasDiaEmpresa.map(nomeEmpresaDaLinha),
        ...linhasMesEmpresa.map(nomeEmpresaDaLinha)
      ].filter(Boolean))
    ];

    return enriquecerEmpresa(base, periodo);
  });
}

function consolidarPeriodo({ resultadosDias, resumoMes, metas, periodo }) {
  const mapa = new Map();

  for (const empresa of EMPRESAS_OFICIAIS) {
    const metasEmpresa = metasDaEmpresa(metas, empresa, periodo.ano_mes);
    mapa.set(empresa, criarEmpresaBase(empresa, metasEmpresa));
  }

  for (const resultado of resultadosDias || []) {
    const linhas = extrairArrayResumo(resultado.json || {});

    for (const linha of linhas) {
      const nomeLinha = nomeEmpresaDaLinha(linha);
      const empresaOficial = classificarEmpresaDaLinha(nomeLinha);

      if (!empresaOficial || !mapa.has(empresaOficial)) {
        continue;
      }

      const atual = mapa.get(empresaOficial);

      const faturamento = faturamentoDaLinha(linha);
      const vendas = vendasDaLinha(linha);

      atual.faturamento_periodo = arredondar(
        numero(atual.faturamento_periodo) + faturamento
      );

      atual.vendas_periodo = numero(atual.vendas_periodo) + vendas;

      if (resultado.data === periodo.hoje) {
        atual.faturamento_hoje = arredondar(faturamento);
        atual.vendas = vendas;
        atual.ticket = calcularTicket(faturamento, vendas);
      }

      atual.origem_encontrada = true;

      if (nomeLinha && !atual.nomes_encontrados_na_api.includes(nomeLinha)) {
        atual.nomes_encontrados_na_api.push(nomeLinha);
      }

      mapa.set(empresaOficial, atual);
    }
  }

  const linhasMes = extrairArrayResumo(resumoMes || {});

  return [...mapa.values()].map(empresa => {
    const linhasMesEmpresa = linhasMes.filter(linha => {
      const nome = nomeEmpresaDaLinha(linha);
      const classificada = classificarEmpresaDaLinha(nome);
      return classificada === empresa.empresa;
    });

    const faturamentoMes = linhasMesEmpresa.reduce(
      (soma, linha) => soma + faturamentoDaLinha(linha),
      0
    );

    const vendasMes = linhasMesEmpresa.reduce(
      (soma, linha) => soma + vendasDaLinha(linha),
      0
    );

    empresa.faturamento_mes = arredondar(faturamentoMes);
    empresa.vendas_mes = vendasMes;
    empresa.ticket_mes = calcularTicket(faturamentoMes, vendasMes);
    empresa.ticket_periodo = calcularTicket(
      empresa.faturamento_periodo,
      empresa.vendas_periodo
    );

    empresa.percentual_prata = percentual(faturamentoMes, empresa.meta_prata);
    empresa.percentual_ouro = percentual(faturamentoMes, empresa.meta_ouro);
    empresa.falta_prata = Math.max(0, arredondar(empresa.meta_prata - faturamentoMes));
    empresa.falta_ouro = Math.max(0, arredondar(empresa.meta_ouro - faturamentoMes));

    for (const linha of linhasMesEmpresa) {
      const nome = nomeEmpresaDaLinha(linha);

      if (nome && !empresa.nomes_encontrados_na_api.includes(nome)) {
        empresa.nomes_encontrados_na_api.push(nome);
      }
    }

    return enriquecerEmpresa(empresa, periodo);
  });
}

function consolidarGeral(empresas, periodo) {
  const geral = {
    empresa: "GERAL",
    faturamento_hoje: arredondar(
      empresas.reduce((s, e) => s + numero(e.faturamento_hoje), 0)
    ),
    faturamento_periodo: arredondar(
      empresas.reduce((s, e) => s + numero(e.faturamento_periodo), 0)
    ),
    faturamento_mes: arredondar(
      empresas.reduce((s, e) => s + numero(e.faturamento_mes), 0)
    ),
    vendas: empresas.reduce((s, e) => s + numero(e.vendas), 0),
    vendas_periodo: empresas.reduce((s, e) => s + numero(e.vendas_periodo), 0),
    vendas_mes: empresas.reduce((s, e) => s + numero(e.vendas_mes), 0),
    meta_prata: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_prata), 0)
    ),
    meta_ouro: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_ouro), 0)
    ),
    meta_diaria: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_diaria), 0)
    ),
    trava_compras: arredondar(
      empresas.reduce((s, e) => s + numero(e.trava_compras), 0)
    ),
    origem_encontrada: empresas.some(e => e.origem_encontrada),
    nomes_encontrados_na_api: empresas.flatMap(e => e.nomes_encontrados_na_api || [])
  };

  geral.ticket = calcularTicket(geral.faturamento_hoje, geral.vendas);
  geral.ticket_periodo = calcularTicket(
    geral.faturamento_periodo,
    geral.vendas_periodo
  );
  geral.ticket_mes = calcularTicket(geral.faturamento_mes, geral.vendas_mes);

  geral.percentual_prata = percentual(geral.faturamento_mes, geral.meta_prata);
  geral.percentual_ouro = percentual(geral.faturamento_mes, geral.meta_ouro);
  geral.falta_prata = Math.max(0, arredondar(geral.meta_prata - geral.faturamento_mes));
  geral.falta_ouro = Math.max(0, arredondar(geral.meta_ouro - geral.faturamento_mes));

  return enriquecerEmpresa(geral, periodo);
}

function gerarRanking(empresas, periodo) {
  const campo =
    periodo.tipo === "mes"
      ? "faturamento_mes"
      : periodo.tipo === "periodo"
        ? "faturamento_periodo"
        : "faturamento_hoje";

  return [...empresas]
    .sort((a, b) => numero(b[campo]) - numero(a[campo]))
    .map((e, index) => ({
      posicao: index + 1,
      empresa: e.empresa,
      valor: arredondar(e[campo]),
      faturamento_hoje: arredondar(e.faturamento_hoje),
      faturamento_periodo: arredondar(e.faturamento_periodo),
      faturamento_mes: arredondar(e.faturamento_mes),
      vendas: numero(e.vendas),
      vendas_periodo: numero(e.vendas_periodo),
      vendas_mes: numero(e.vendas_mes),
      ticket: numero(e.ticket),
      ticket_periodo: numero(e.ticket_periodo),
      ticket_mes: numero(e.ticket_mes),
      percentual_prata: numero(e.percentual_prata),
      percentual_ouro: numero(e.percentual_ouro)
    }));
}

// ======================================================
// M.KIDS • FATURAMENTO DIRETO DO SUPABASE
// ORIGEM: vw_mkids_faturamento
// ======================================================

async function buscarMkidsFaturamentoPeriodo(periodo) {
  const { data, error } = await supabase
    .from("vw_mkids_faturamento")
    .select(`
      empresa,
      dia,
      faturamento,
      vendas,
      dinheiro,
      credito,
      debito,
      pix,
      consumo_socio,
      funcionarios,
      criado_em
    `)
    .gte("dia", periodo.inicio)
    .lte("dia", periodo.fim)
    .order("dia", { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar faturamento do M.KIDS: ${error.message}`);
  }

  return data || [];
}

async function buscarMkidsFaturamentoMes(periodo) {
  const inicioMes = inicioMesISO(`${periodo.ano_mes}-01`);

  const fimMes =
    periodo.ano_mes === anoMesISO(periodo.hoje)
      ? periodo.hoje
      : fimMesISO(`${periodo.ano_mes}-01`);

  const { data, error } = await supabase
    .from("vw_mkids_faturamento")
    .select(`
      empresa,
      dia,
      faturamento,
      vendas,
      dinheiro,
      credito,
      debito,
      pix,
      consumo_socio,
      funcionarios,
      criado_em
    `)
    .gte("dia", inicioMes)
    .lte("dia", fimMes)
    .order("dia", { ascending: true });

  if (error) {
    throw new Error(`Erro ao buscar faturamento mensal do M.KIDS: ${error.message}`);
  }

  return data || [];
}

function somarCampoMkids(linhas, campo) {
  return arredondar(
    (linhas || []).reduce((soma, linha) => {
      return soma + numero(linha?.[campo]);
    }, 0)
  );
}

function montarEmpresaMkids({ linhasPeriodo, linhasMes, metas, periodo }) {
  const metasEmpresa = metasDaEmpresa(metas, "KIDS", periodo.ano_mes);
  const base = criarEmpresaBase("KIDS", metasEmpresa);

  const linhasDoDia = (linhasMes || []).filter(linha => linha.dia === periodo.data);

  const faturamentoHoje = somarCampoMkids(linhasDoDia, "faturamento");
  const faturamentoPeriodo = somarCampoMkids(linhasPeriodo, "faturamento");
  const faturamentoMes = somarCampoMkids(linhasMes, "faturamento");

  const vendasHoje = somarCampoMkids(linhasDoDia, "vendas");
  const vendasPeriodo = somarCampoMkids(linhasPeriodo, "vendas");
  const vendasMes = somarCampoMkids(linhasMes, "vendas");

  base.faturamento_hoje = arredondar(faturamentoHoje);
  base.faturamento_periodo = arredondar(
    periodo.tipo === "mes" ? faturamentoMes : faturamentoPeriodo
  );
  base.faturamento_mes = arredondar(faturamentoMes);

  base.vendas = vendasHoje;
  base.vendas_periodo = periodo.tipo === "mes" ? vendasMes : vendasPeriodo;
  base.vendas_mes = vendasMes;

  base.ticket = calcularTicket(base.faturamento_hoje, base.vendas);
  base.ticket_periodo = calcularTicket(base.faturamento_periodo, base.vendas_periodo);
  base.ticket_mes = calcularTicket(base.faturamento_mes, base.vendas_mes);

  base.percentual_prata = percentual(base.faturamento_mes, base.meta_prata);
  base.percentual_ouro = percentual(base.faturamento_mes, base.meta_ouro);

  base.falta_prata = Math.max(
    0,
    arredondar(base.meta_prata - base.faturamento_mes)
  );

  base.falta_ouro = Math.max(
    0,
    arredondar(base.meta_ouro - base.faturamento_mes)
  );

  base.origem_encontrada =
    (linhasPeriodo || []).length > 0 ||
    (linhasMes || []).length > 0;

  base.nomes_encontrados_na_api = base.origem_encontrada
    ? ["vw_mkids_faturamento"]
    : [];

  return enriquecerEmpresa(base, periodo);
}

function substituirKidsNasEmpresas(empresas, empresaKids) {
  return (empresas || []).map(empresa => {
    if (empresa.empresa === "KIDS") {
      return empresaKids;
    }

    return empresa;
  });
}

function montarFinalizadorasMkids(linhasMkids) {
  const totais = {
    dinheiro: somarCampoMkids(linhasMkids, "dinheiro"),
    credito: somarCampoMkids(linhasMkids, "credito"),
    debito: somarCampoMkids(linhasMkids, "debito"),
    pix: somarCampoMkids(linhasMkids, "pix"),
    consumo_socio: somarCampoMkids(linhasMkids, "consumo_socio"),
    funcionarios: somarCampoMkids(linhasMkids, "funcionarios")
  };

  return [
    {
      nome: "Dinheiro",
      valor: totais.dinheiro,
      quantidade: 0
    },
    {
      nome: "Crédito",
      valor: totais.credito,
      quantidade: 0
    },
    {
      nome: "Débito",
      valor: totais.debito,
      quantidade: 0
    },
    {
      nome: "Pix",
      valor: totais.pix,
      quantidade: 0
    },
    {
      nome: "Consumo Sócio",
      valor: totais.consumo_socio,
      quantidade: 0
    },
    {
      nome: "Funcionários",
      valor: totais.funcionarios,
      quantidade: 0
    }
  ].filter(item => numero(item.valor) > 0);
}

function filtrarFinalizadorasPorPerguntaMkids(finalizadoras, pergunta) {
  return (finalizadoras || []).filter(forma => {
    return formaCombinaComPergunta(forma.nome, pergunta);
  });
}








// ======================================================
// FORMAS DE PAGAMENTO
// ======================================================

function extrairFinalizadoras(analitico) {
  const linhas = extrairArrayResumo(analitico);

  return linhas.map(linha => {
    const formas =
      linha.finalizadoras ||
      linha.formas_pagamento ||
      linha.formasPagamento ||
      linha.pagamentos ||
      linha.meios_pagamento ||
      linha.meiosPagamento ||
      linha.recebimentos ||
      [];

    return {
      empresa: nomeEmpresaDaLinha(linha),
      formas_pagamento: Array.isArray(formas)
        ? formas.map(forma => ({
            nome:
              forma.nome ||
              forma.descricao ||
              forma.tipo ||
              forma.finalizadora ||
              forma.forma ||
              forma.meio ||
              "Não informado",
            valor: numero(
              forma.valor ??
              forma.faturamento ??
              forma.total ??
              forma.valor_total ??
              0
            ),
            quantidade: numero(
              forma.quantidade ??
              forma.qtd ??
              forma.vendas ??
              forma.cupons ??
              0
            )
          }))
        : []
    };
  });
}

function formaCombinaComPergunta(nomeForma, pergunta) {
  const forma = normalizar(nomeForma);
  const texto = normalizar(pergunta);

  if (texto.includes("pix")) {
    return forma.includes("pix");
  }

  if (texto.includes("credito")) {
    return forma.includes("credito") || forma.includes("credit");
  }

  if (texto.includes("debito")) {
    return forma.includes("debito") || forma.includes("debit");
  }

  if (texto.includes("dinheiro")) {
    return forma.includes("dinheiro") || forma.includes("cash");
  }

  if (texto.includes("cartao")) {
    return (
      forma.includes("cartao") ||
      forma.includes("credito") ||
      forma.includes("debito") ||
      forma.includes("credit") ||
      forma.includes("debit")
    );
  }

  return true;
}

function consolidarFormasPagamento(finalizadoras, empresaSelecionada, pergunta) {
  const mapa = new Map();

  for (const item of finalizadoras || []) {
    const empresaDaLinha = classificarEmpresaDaLinha(item.empresa);

    if (
      empresaSelecionada &&
      empresaSelecionada !== "GERAL" &&
      empresaDaLinha !== empresaSelecionada
    ) {
      continue;
    }

    for (const forma of item.formas_pagamento || []) {
      if (!formaCombinaComPergunta(forma.nome, pergunta)) {
        continue;
      }

      const chave = normalizar(forma.nome) || "nao informado";

      const atual = mapa.get(chave) || {
        nome: forma.nome,
        valor: 0,
        quantidade: 0
      };

      atual.valor += numero(forma.valor);
      atual.quantidade += numero(forma.quantidade);

      mapa.set(chave, atual);
    }
  }

  return [...mapa.values()]
    .map(item => ({
      nome: item.nome,
      valor: arredondar(item.valor),
      quantidade: numero(item.quantidade)
    }))
    .sort((a, b) => b.valor - a.valor);
}

// ======================================================
// DIAGNÓSTICO
// ======================================================

function diagnosticarEmpresa(empresa, periodo) {
  const alertas = [];
  const pontos = [];
  const acoes = [];

  if (!empresa.origem_encontrada && empresa.empresa !== "GERAL") {
    alertas.push("Não encontrei movimento dessa empresa na API externa.");
  }

  if (periodo.tipo === "dia" && numero(empresa.faturamento_hoje) <= 0) {
    alertas.push("Faturamento do dia está zerado.");
  }

  if (numero(empresa.meta_referencia) > 0) {
    if (empresa.tendencia_bate_meta) {
      pontos.push("No ritmo atual, tende a bater a meta.");
    } else {
      alertas.push(
        `No ritmo atual, não tende a bater a meta. Falta ${formatarMoeda(empresa.falta_meta_referencia)}.`
      );
      acoes.push(
        `Precisa vender em média ${formatarMoeda(empresa.necessario_por_dia)} por dia até o fim do mês.`
      );
    }
  }

  if (numero(empresa.meta_diaria_referencia) > 0 && periodo.tipo === "dia") {
    if (numero(empresa.faturamento_hoje) >= numero(empresa.meta_diaria_referencia)) {
      pontos.push(
        `Hoje está acima da meta diária: ${formatarPercentual(empresa.desempenho_hoje_vs_meta_diaria)}.`
      );
    } else {
      alertas.push(
        `Hoje está abaixo da meta diária: ${formatarPercentual(empresa.desempenho_hoje_vs_meta_diaria)}.`
      );
      acoes.push(
        `Faltam ${formatarMoeda(Math.max(0, empresa.meta_diaria_referencia - empresa.faturamento_hoje))} para a meta diária.`
      );
    }
  }

  if (numero(empresa.faturamento_hoje) > 0 && numero(empresa.vendas) <= 0) {
    alertas.push("A API trouxe faturamento, mas não trouxe quantidade de vendas/cupons.");
  }

  if (numero(empresa.vendas) > 0 && numero(empresa.faturamento_hoje) <= 0) {
    alertas.push("A API trouxe vendas/cupons, mas o faturamento está zerado.");
  }

  return {
    alertas,
    pontos,
    acoes
  };
}

// ======================================================
// RESPOSTAS DIRETAS
// ======================================================

function valorPrincipal(empresa, periodo) {
  if (periodo.tipo === "mes") {
    return empresa.faturamento_mes;
  }

  if (periodo.tipo === "periodo") {
    return empresa.faturamento_periodo;
  }

  return empresa.faturamento_hoje;
}

function labelPeriodoResposta(periodo) {
  if (periodo.tipo === "dia") {
    return `Data: ${labelDataBR(periodo.data)}`;
  }

  if (periodo.tipo === "mes") {
    return `Período: ${labelDataBR(periodo.inicio)} até ${labelDataBR(periodo.fim)}`;
  }

  if (periodo.tipo === "periodo") {
    return `Período: ${labelDataBR(periodo.inicio)} até ${labelDataBR(periodo.fim)}`;
  }

  return `Data: ${labelDataBR(periodo.data)}`;
}

function responderFaturamentoDireto(empresa, periodo) {
  const valor = valorPrincipal(empresa, periodo);
  const periodoTexto = labelPeriodoResposta(periodo);

  if (periodo.tipo === "mes") {
    return `${empresa.empresa}: ${formatarMoeda(valor)}.\n${periodoTexto}.`;
  }

  if (periodo.tipo === "periodo") {
    return `${empresa.empresa}: ${formatarMoeda(valor)}.\n${periodoTexto}.`;
  }

  return `${empresa.empresa}: ${formatarMoeda(empresa.faturamento_hoje)}.\n${periodoTexto}.\nNo mês: ${formatarMoeda(empresa.faturamento_mes)}.`;
}
function responderTicketDireto(empresa, periodo) {
  if (periodo.tipo === "mes") {
    return `${empresa.empresa}: ticket médio do mês ${formatarMoeda(empresa.ticket_mes)}. Vendas: ${formatarNumero(empresa.vendas_mes)}.`;
  }

  if (periodo.tipo === "periodo") {
    return `${empresa.empresa}: ticket médio do período ${formatarMoeda(empresa.ticket_periodo)}. Vendas: ${formatarNumero(empresa.vendas_periodo)}.`;
  }

  return `${empresa.empresa}: ticket médio hoje ${formatarMoeda(empresa.ticket)}. Vendas: ${formatarNumero(empresa.vendas)}.`;
}

function responderMetaDireto(empresa) {
  const partes = [];

  partes.push(`${empresa.empresa}: ${formatarMoeda(empresa.faturamento_mes)} no mês.`);

  if (empresa.meta_prata > 0) {
    partes.push(`Meta prata: ${formatarPercentual(empresa.percentual_prata)}.`);
  }

  if (empresa.meta_ouro > 0) {
    partes.push(`Meta ouro: ${formatarPercentual(empresa.percentual_ouro)}.`);
  }

  if (empresa.meta_referencia > 0) {
    partes.push(`Falta: ${formatarMoeda(empresa.falta_meta_referencia)}.`);
  }

  return partes.join(" ");
}

function responderProjecaoDireta(empresa) {
  if (empresa.meta_referencia > 0) {
    const status = empresa.tendencia_bate_meta
      ? "tende a bater"
      : "não tende a bater";

    return `${empresa.empresa}: projeção ${formatarMoeda(empresa.projecao_mes)}. Meta ${formatarMoeda(empresa.meta_referencia)}. No ritmo atual, ${status}.`;
  }

  return `${empresa.empresa}: projeção do mês ${formatarMoeda(empresa.projecao_mes)}.`;
}

function responderRankingDireto(ranking, periodo) {
  if (!ranking.length) {
    return `Não encontrei faturamento para montar o ranking.\n${labelPeriodoResposta(periodo)}.`;
  }

  const lider = ranking[0];

  const linhas = [];

  linhas.push(`Ranking de vendas`);
  linhas.push(labelPeriodoResposta(periodo));
  linhas.push("");
  linhas.push(`1º lugar: ${lider.empresa} com ${formatarMoeda(lider.valor)}.`);
  linhas.push("");
  linhas.push("Empresas:");

  ranking.forEach(item => {
    linhas.push(`${item.posicao}. ${item.empresa}: ${formatarMoeda(item.valor)}`);
  });

  return linhas.join("\n");
}
function responderTodasDireto(empresas, periodo) {
  const campo =
    periodo.tipo === "mes"
      ? "faturamento_mes"
      : periodo.tipo === "periodo"
        ? "faturamento_periodo"
        : "faturamento_hoje";

  const linhas = [];

  linhas.push("Vendas das empresas");
  linhas.push(labelPeriodoResposta(periodo));
  linhas.push("");

  EMPRESAS_OFICIAIS.forEach(nomeEmpresa => {
    const empresa = empresas.find(e => e.empresa === nomeEmpresa);

    const valor = empresa ? numero(empresa[campo]) : 0;

    linhas.push(`${nomeEmpresa}: ${formatarMoeda(valor)}`);
  });

  const total = empresas.reduce((s, e) => s + numero(e[campo]), 0);

  linhas.push("");
  linhas.push(`Total geral: ${formatarMoeda(total)}.`);

  return linhas.join("\n");
}
function responderFormasPagamentoDireto(empresa, formas, periodo) {
  if (!formas.length) {
    return `Não encontrei formas de pagamento para ${empresa || "GERAL"} em ${periodo.label}.`;
  }

  const linhas = [];

  linhas.push(`Formas de pagamento • ${empresa || "GERAL"} • ${periodo.label}`);
  linhas.push("");

  formas.forEach(item => {
    linhas.push(`${item.nome}: ${formatarMoeda(item.valor)}`);
  });

  const total = formas.reduce((s, item) => s + numero(item.valor), 0);

  linhas.push("");
  linhas.push(`Total: ${formatarMoeda(total)}.`);

  return linhas.join("\n");
}

// ======================================================
// RESPOSTAS COM ANÁLISE
// ======================================================

function responderAnaliseEmpresa(empresa, periodo) {
  const diagnostico = diagnosticarEmpresa(empresa, periodo);

  const linhas = [];

  linhas.push(`Análise • ${empresa.empresa}`);
  linhas.push(`Período: ${periodo.label}`);
  linhas.push("");

  linhas.push(`Faturamento hoje: ${formatarMoeda(empresa.faturamento_hoje)}.`);
  linhas.push(`Faturamento no período: ${formatarMoeda(empresa.faturamento_periodo)}.`);
  linhas.push(`Faturamento no mês: ${formatarMoeda(empresa.faturamento_mes)}.`);
  linhas.push(`Vendas hoje: ${formatarNumero(empresa.vendas)}.`);
  linhas.push(`Vendas no período: ${formatarNumero(empresa.vendas_periodo)}.`);
  linhas.push(`Vendas no mês: ${formatarNumero(empresa.vendas_mes)}.`);
  linhas.push(`Ticket hoje: ${formatarMoeda(empresa.ticket)}.`);
  linhas.push(`Ticket período: ${formatarMoeda(empresa.ticket_periodo)}.`);
  linhas.push(`Ticket mês: ${formatarMoeda(empresa.ticket_mes)}.`);
  linhas.push(`Ritmo diário atual: ${formatarMoeda(empresa.ritmo_diario_atual)}.`);
  linhas.push(`Projeção do mês: ${formatarMoeda(empresa.projecao_mes)}.`);

  if (empresa.meta_prata > 0) {
    linhas.push(`Meta prata: ${formatarMoeda(empresa.meta_prata)} — ${formatarPercentual(empresa.percentual_prata)}.`);
    linhas.push(`Falta para prata: ${formatarMoeda(empresa.falta_prata)}.`);
  }

  if (empresa.meta_ouro > 0) {
    linhas.push(`Meta ouro: ${formatarMoeda(empresa.meta_ouro)} — ${formatarPercentual(empresa.percentual_ouro)}.`);
    linhas.push(`Falta para ouro: ${formatarMoeda(empresa.falta_ouro)}.`);
  }

  if (empresa.meta_referencia > 0) {
    linhas.push(`Meta de referência: ${formatarMoeda(empresa.meta_referencia)}.`);
    linhas.push(`Necessário por dia: ${formatarMoeda(empresa.necessario_por_dia)}.`);
  }

  if (empresa.nomes_encontrados_na_api?.length) {
    linhas.push("");
    linhas.push("Nomes encontrados na API para essa empresa:");
    empresa.nomes_encontrados_na_api.forEach(nome => {
      linhas.push(`- ${nome}`);
    });
  }

  if (diagnostico.pontos.length) {
    linhas.push("");
    linhas.push("Pontos positivos:");
    diagnostico.pontos.forEach(p => linhas.push(`- ${p}`));
  }

  if (diagnostico.alertas.length) {
    linhas.push("");
    linhas.push("Alertas:");
    diagnostico.alertas.forEach(a => linhas.push(`- ${a}`));
  }

  if (diagnostico.acoes.length) {
    linhas.push("");
    linhas.push("Ações:");
    diagnostico.acoes.forEach(a => linhas.push(`- ${a}`));
  }

  return linhas.join("\n");
}

function responderAnaliseGeral(empresas, periodo) {
  const geral = consolidarGeral(empresas, periodo);
  const ranking = gerarRanking(empresas, periodo);

  const linhas = [];

  linhas.push(`Análise geral • ${periodo.label}`);
  linhas.push("");
  linhas.push(`Total geral no período: ${formatarMoeda(valorPrincipal(geral, periodo))}.`);
  linhas.push(`Acumulado geral no mês: ${formatarMoeda(geral.faturamento_mes)}.`);
  linhas.push(`Ticket médio geral: ${formatarMoeda(geral.ticket_periodo || geral.ticket_mes || geral.ticket)}.`);

  if (ranking[0]) {
    linhas.push(`Líder: ${ranking[0].empresa} com ${formatarMoeda(ranking[0].valor)}.`);
  }

  linhas.push("");
  linhas.push("Ranking:");

  ranking.forEach(item => {
    linhas.push(`${item.posicao}. ${item.empresa}: ${formatarMoeda(item.valor)}`);
  });

  linhas.push("");
  linhas.push("Metas:");

  empresas.forEach(e => {
    linhas.push(
      `${e.empresa}: mês ${formatarMoeda(e.faturamento_mes)} | prata ${formatarPercentual(e.percentual_prata)} | ouro ${formatarPercentual(e.percentual_ouro)}`
    );
  });

  return linhas.join("\n");
}

// ======================================================
// HISTÓRICO
// ======================================================

async function salvarHistorico({ pergunta, resposta, empresa, dados }) {
  if (!HISTORICO_ATIVO) {
    return;
  }

  try {
    await supabase
      .from("otto_historico")
      .insert([
        {
          pergunta: limitarTexto(pergunta, 5000),
          resposta: limitarTexto(resposta, 10000),
          agente: "AGENTE_FATURAMENTO",
          empresa: empresa || null,
          contexto: dados || null,
          created_at: new Date().toISOString()
        }
      ]);
  } catch (e) {
    console.log("ERRO AO SALVAR HISTÓRICO FATURAMENTO:", e.message);
  }
}

// ======================================================
// MONTAR RESPOSTA
// ======================================================

function montarResposta({
  pergunta,
  intencao,
  modoAnalise,
  periodo,
  empresaPerguntada,
  empresaSelecionada,
  empresas,
  ranking,
  formasPagamento
}) {
  if (modoAnalise) {
    if (empresaPerguntada) {
      return responderAnaliseEmpresa(empresaSelecionada, periodo);
    }

    if (intencao === "ranking") {
      return responderRankingDireto(ranking, periodo);
    }

    return responderAnaliseGeral(empresas, periodo);
  }

  if (intencao === "ranking") {
    return responderRankingDireto(ranking, periodo);
  }

  if (intencao === "formas_pagamento") {
    return responderFormasPagamentoDireto(
      empresaPerguntada || "GERAL",
      formasPagamento,
      periodo
    );
  }

  if (!empresaPerguntada && pedeTodasEmpresas(pergunta)) {
    return responderTodasDireto(empresas, periodo);
  }

  if (intencao === "ticket") {
    return responderTicketDireto(empresaSelecionada, periodo);
  }

  if (intencao === "meta") {
    return responderMetaDireto(empresaSelecionada);
  }

  if (intencao === "projecao") {
    return responderProjecaoDireta(empresaSelecionada);
  }

  if (intencao === "resumo" || intencao === "comparacao") {
    if (!empresaPerguntada) {
      return responderTodasDireto(empresas, periodo);
    }
  }

  return responderFaturamentoDireto(empresaSelecionada, periodo);
}

// ======================================================
// HANDLER
// ======================================================

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        agente: "AGENTE_FATURAMENTO",
        erro: "Método não permitido. Use POST ou GET."
      });
    }

    const body =
      req.method === "GET"
        ? req.query || {}
        : parseBody(req);

    const pergunta =
      body.pergunta ||
      body.mensagem ||
      body.texto ||
      body.q ||
      body.query ||
      "";

    if (!String(pergunta).trim()) {
      return res.status(400).json({
        ok: false,
        agente: "AGENTE_FATURAMENTO",
        erro: "Pergunta não informada."
      });
    }

    const periodo = interpretarPeriodo(pergunta, body);
    const intencao = interpretarIntencao(pergunta);
    const modoAnalise = pediuAnalise(pergunta, body);
const empresasParaSomar = identificarEmpresasParaSomar(pergunta);
const deveSomarEmpresas = pediuSomaEmpresas(pergunta) && empresasParaSomar.length >= 2;

const empresaPerguntada = deveSomarEmpresas
  ? null
  : identificarEmpresa(pergunta, body);

console.log("🏢 EMPRESA IDENTIFICADA:", {
  pergunta,
  empresa_body_ignorada: body.empresa || null,
  empresa_identificada_apenas_pela_pergunta: empresaPerguntada,
  deve_somar_empresas: deveSomarEmpresas,
  empresas_para_somar: empresasParaSomar
});

    const { API_URL, METAS } = await carregarConfiguracoes();

    let resumoDiaResultado = null;
    let resumoMesResultado = null;
    let resultadosDias = [];
    let analiticoResultado = null;

    if (periodo.tipo === "periodo") {
      const [diasResultado, mesResultado] = await Promise.all([
        buscarResumoPeriodoPorDias(API_URL, periodo),
        buscarResumoMes(API_URL, periodo)
      ]);

      resultadosDias = diasResultado;
      resumoMesResultado = mesResultado;
    } else {
      const [diaResultado, mesResultado] = await Promise.all([
        buscarResumoDia(API_URL, periodo.data),
        buscarResumoMes(API_URL, periodo)
      ]);

      resumoDiaResultado = diaResultado;
      resumoMesResultado = mesResultado;
    }

    if (intencao === "formas_pagamento") {
      analiticoResultado = await buscarAnalitico(API_URL, periodo.data);
    }

    let empresas = [];

    if (periodo.tipo === "periodo") {
      empresas = consolidarPeriodo({
        resultadosDias,
        resumoMes: resumoMesResultado?.json || {},
        metas: METAS,
        periodo
      });
    } else {
      empresas = consolidarDiaMes({
        resumoDia: resumoDiaResultado?.json || {},
        resumoMes: resumoMesResultado?.json || {},
        metas: METAS,
        periodo
      });
    }

    // ======================================================
    // REGRA ESPECIAL:
    // KIDS SEMPRE VEM DA VIEW vw_mkids_faturamento
    // As outras empresas continuam vindo da API externa.
    // ======================================================

    const [linhasMkidsPeriodo, linhasMkidsMes] = await Promise.all([
      buscarMkidsFaturamentoPeriodo(periodo),
      buscarMkidsFaturamentoMes(periodo)
    ]);

    const empresaKids = montarEmpresaMkids({
      linhasPeriodo: linhasMkidsPeriodo,
      linhasMes: linhasMkidsMes,
      metas: METAS,
      periodo
    });

    empresas = substituirKidsNasEmpresas(empresas, empresaKids);

    const ranking = gerarRanking(empresas, periodo);

let empresaSelecionada = null;
let somaEmpresas = null;

if (deveSomarEmpresas) {
  somaEmpresas = consolidarSomaEmpresas(
    empresas,
    empresasParaSomar,
    periodo
  );

  empresaSelecionada = somaEmpresas;
} else if (empresaPerguntada) {
  empresaSelecionada = empresas.find(e => e.empresa === empresaPerguntada);

  if (!empresaSelecionada) {
    const metasEmpresa = metasDaEmpresa(METAS, empresaPerguntada, periodo.ano_mes);
    empresaSelecionada = enriquecerEmpresa(
      criarEmpresaBase(empresaPerguntada, metasEmpresa),
      periodo
    );
  }
} else {
  empresaSelecionada = consolidarGeral(empresas, periodo);
}


    let formasPagamento = [];

    if (intencao === "formas_pagamento") {
      if (empresaPerguntada === "KIDS") {
        const finalizadorasKids = montarFinalizadorasMkids(linhasMkidsPeriodo);

        formasPagamento = filtrarFinalizadorasPorPerguntaMkids(
          finalizadorasKids,
          pergunta
        );
      } else if (analiticoResultado?.json) {
        const finalizadoras = extrairFinalizadoras(analiticoResultado.json);

        formasPagamento = consolidarFormasPagamento(
          finalizadoras,
          empresaPerguntada || "GERAL",
          pergunta
        );
      }
    }
const resposta = deveSomarEmpresas
  ? responderSomaEmpresasDireto(somaEmpresas, periodo)
  : montarResposta({
      pergunta,
      intencao,
      modoAnalise,
      periodo,
      empresaPerguntada,
      empresaSelecionada,
      empresas,
      ranking,
      formasPagamento
    });
    const diagnostico = diagnosticarEmpresa(empresaSelecionada, periodo);

    await salvarHistorico({
      pergunta,
      resposta,
      empresa:
        empresaSelecionada?.empresa ||
        empresaPerguntada ||
        null,
      dados: {
        periodo,
        intencao,
        modo_analise: modoAnalise,
        empresa_perguntada: empresaPerguntada,
empresa: empresaSelecionada,
empresas,
soma_empresas: somaEmpresas,
deve_somar_empresas: deveSomarEmpresas,
empresas_para_somar: empresasParaSomar,
ranking,
formas_pagamento: formasPagamento,
diagnostico,
      }
    });

    return res.status(200).json({
      ok: true,
      agente: "AGENTE_FATURAMENTO",
      pergunta,
      resposta,
      modo_resposta: modoAnalise ? "analise" : "direto",
      periodo,
      intencao,
      empresa_perguntada: empresaPerguntada,
      empresa: empresaSelecionada,
      empresas,
      ranking,
      formas_pagamento: formasPagamento,
      diagnostico,
      fontes: {
        api_url: API_URL,
        resumo_dia: resumoDiaResultado?.url || null,
        resumo_mes: resumoMesResultado?.url || null,
        cupons_analitico: analiticoResultado?.url || null,
        periodo_por_dias: resultadosDias.map(r => ({
          data: r.data,
          ok: r.ok,
          url: r.url,
          erro: r.erro || null
        }))
      },
      separacao_empresas: {
        empresas_oficiais: EMPRESAS_OFICIAIS,
        mercatto_sozinho_vira: "MERCATTO RESTAURANTE",
        emporio_nunca_mistura_com_restaurante: true,
        villa_aceita_vila: true,
        kids_aceita_mkids: true,
        padaria_separada: true
      },
      regras: {
        empresa_especifica_nao_mistura: true,
        resposta_padrao_direta: true,
        analise_somente_quando_pedir: true,
        metas_separadas_por_empresa: true,
        entende_dias_meses_periodos: true
      },
      hoje: periodo.hoje,
      timezone: TIMEZONE,
      timestamp: new Date().toISOString(),
      agora_bahia: agoraBahiaDate().toISOString()
    });
  } catch (error) {
    console.log("ERRO API FATURAMENTO:", error);

    return res.status(500).json({
      ok: false,
      agente: "AGENTE_FATURAMENTO",
      erro: error.message || "Erro interno na API de faturamento.",
      timezone: TIMEZONE,
      timestamp: new Date().toISOString()
    });
  }
};
