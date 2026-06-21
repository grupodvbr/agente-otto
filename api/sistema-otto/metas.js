// ======================================================
// OTTO • API COMPLETA DE METAS DE FATURAMENTO
// /api/sistema-otto/metas.js
//
// OBJETIVO:
// Responder tudo sobre metas:
// - relatório detalhado por empresa
// - faturamento total no mês
// - meta ouro
// - meta prata
// - quanto falta
// - percentual atingido
// - ideal para a data
// - acima/abaixo da previsão
// - necessário por dia
// - projeção de fechamento
// - ranking de proximidade
// - empresa mais perto da meta
// - empresa mais distante da meta
// - resposta em texto
// - canvas_html bonito para o index abrir no canvas
//
// PADRÃO:
// Busca URL da API externa em:
// public.url_api
// tipo = vendas_api
// ativo = true
//
// Busca metas em:
// public.parametros_sistema
// nome_parametro = meta_vendas
//
// EMPRESAS OFICIAIS:
// - MERCATTO RESTAURANTE
// - MERCATTO EMPORIO
// - PADARIA
// - VILLA
// - KIDS
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
  process.env.METAS_TIMEOUT_MS || 25000
);

const CONFIG_CACHE_MS = Number(
  process.env.CONFIG_CACHE_MS || 60000
);

const HISTORICO_ATIVO =
  String(process.env.METAS_HISTORICO_ATIVO || "true") !== "false";

// ======================================================
// AMBIENTE
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
// EMPRESAS
// ======================================================

const EMPRESAS_OFICIAIS = [
  "MERCATTO RESTAURANTE",
  "MERCATTO EMPORIO",
  "PADARIA",
  "VILLA",
  "KIDS"
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
// HELPERS
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

function escaparHTML(valor) {
  return String(valor || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  return Math.max(
    0,
    Math.round((b.getTime() - a.getTime()) / 86400000)
  );
}

// ======================================================
// PERÍODO
// ======================================================

function interpretarPeriodo(pergunta, body = {}) {
  const texto = normalizar(pergunta);
  const hoje = hojeBahiaISO();

  let tipo = "mes";
  let data = hoje;
  let inicio = inicioMesISO(hoje);
  let fim = hoje;
  let label = "mês atual";
  let origem = "padrao_mes_atual";

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
  }

  if (
    texto.includes("hoje") ||
    texto.includes("meta de hoje") ||
    texto.includes("meta diaria") ||
    texto.includes("meta diária")
  ) {
    data = hoje;
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "hoje";
    origem = "hoje";
  }

  if (texto.includes("ontem")) {
    data = addDiasISO(hoje, -1);
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "ontem";
    origem = "ontem";
  }

  if (
    texto.includes("semana") ||
    texto.includes("ultimos 7") ||
    texto.includes("últimos 7")
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
    texto.includes("últimos 30")
  ) {
    fim = hoje;
    inicio = addDiasISO(hoje, -29);
    data = fim;
    tipo = "periodo";
    label = "últimos 30 dias";
    origem = "ultimos_30_dias";
  }

  if (
    texto.includes("mes passado") ||
    texto.includes("mês passado") ||
    texto.includes("mes anterior") ||
    texto.includes("mês anterior")
  ) {
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
    texto.includes("mês") ||
    texto.includes("mensal") ||
    texto.includes("acumulado") ||
    texto.includes("desse mes") ||
    texto.includes("desse mês") ||
    texto.includes("este mes") ||
    texto.includes("este mês")
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
// EMPRESAS
// ======================================================

function empresaCombina(nomeVindoDaApi, empresaOficial) {
  const nome = normalizar(nomeVindoDaApi);
  const nomeCompacto = compactar(nomeVindoDaApi);

  if (!nome) {
    return false;
  }

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

  if (empresaOficial === "PADARIA") {
    return (
      nome.includes("padaria") ||
      nomeCompacto.includes("padariadelicia") ||
      nomeCompacto.includes("padariadelícia")
    );
  }

  if (empresaOficial === "VILLA") {
    return (
      nome.includes("villa") ||
      nome.includes("vila") ||
      nomeCompacto.includes("villagourmet") ||
      nomeCompacto.includes("vilagourmet")
    );
  }

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

function identificarEmpresaEmTexto(textoOriginal) {
  const texto = normalizar(textoOriginal);
  const textoCompacto = compactar(textoOriginal);

  if (!texto) {
    return null;
  }

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

  if (
    texto.includes("padaria") ||
    textoCompacto.includes("padariadelicia") ||
    textoCompacto.includes("padariadelícia")
  ) {
    return "PADARIA";
  }

  if (
    texto.includes("villa") ||
    texto.includes("vila") ||
    textoCompacto.includes("villagourmet") ||
    textoCompacto.includes("vilagourmet")
  ) {
    return "VILLA";
  }

  if (
    texto.includes("kids") ||
    textoCompacto.includes("mkids") ||
    textoCompacto.includes("mkidsfestas")
  ) {
    return "KIDS";
  }

  if (
    texto.includes("restaurante") ||
    textoCompacto.includes("mercattorestaurante") ||
    textoCompacto.includes("restaurantemercatto")
  ) {
    return "MERCATTO RESTAURANTE";
  }

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

function identificarEmpresa(pergunta) {
  return identificarEmpresaEmTexto(pergunta);
}

function pedeTodasEmpresas(pergunta) {
  const texto = normalizar(pergunta);

  return (
    texto.includes("todas") ||
    texto.includes("empresas") ||
    texto.includes("por empresa") ||
    texto.includes("cada empresa") ||
    texto.includes("relatorio") ||
    texto.includes("relatório") ||
    texto.includes("detalhado") ||
    texto.includes("ranking") ||
    texto.includes("mais perto") ||
    texto.includes("mais distante") ||
    texto.includes("mais longe")
  );
}

// ======================================================
// INTENÇÃO
// ======================================================

function interpretarIntencao(pergunta) {
  const texto = normalizar(pergunta);

  if (
    texto.includes("relatorio") ||
    texto.includes("relatório") ||
    texto.includes("detalhado") ||
    texto.includes("detalhada")
  ) {
    return "relatorio_detalhado";
  }

  if (
    texto.includes("mais perto") ||
    texto.includes("mais proxima") ||
    texto.includes("mais próxima") ||
    texto.includes("proxima de bater") ||
    texto.includes("próxima de bater")
  ) {
    return "mais_perto";
  }

  if (
    texto.includes("mais distante") ||
    texto.includes("mais longe") ||
    texto.includes("pior")
  ) {
    return "mais_distante";
  }

  if (
    texto.includes("previsao") ||
    texto.includes("previsão") ||
    texto.includes("projecao") ||
    texto.includes("projeção") ||
    texto.includes("tendencia") ||
    texto.includes("tendência") ||
    texto.includes("vai bater")
  ) {
    return "previsao";
  }

  if (
    texto.includes("quanto falta") ||
    texto.includes("falta para") ||
    texto.includes("quanto preciso") ||
    texto.includes("quanto precisa") ||
    texto.includes("preciso para") ||
    texto.includes("precisa para")
  ) {
    return "quanto_falta";
  }

  if (
    texto.includes("ranking") ||
    texto.includes("ordem")
  ) {
    return "ranking";
  }

  if (
    texto.includes("estrategia") ||
    texto.includes("estratégia") ||
    texto.includes("o que fazer") ||
    texto.includes("como bater")
  ) {
    return "estrategia";
  }

  return "consulta_meta";
}

// ======================================================
// CONFIGURAÇÕES
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
// BUSCA API EXTERNA
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

// ======================================================
// EXTRAÇÃO
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
// METAS
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
      mes.meta_mensal ??
      mes.metaMensal ??
      mes.valor ??
      registro.meta_prata ??
      registro.prata ??
      registro.meta_mensal ??
      registro.valor ??
      0
    ),

    meta_ouro: numero(
      mes.meta_ouro ??
      mes.ouro ??
      mes.metaOuro ??
      mes.super_meta ??
      mes.meta_superior ??
      registro.meta_ouro ??
      registro.ouro ??
      registro.super_meta ??
      0
    ),

    meta_diaria: numero(
      mes.meta_diaria ??
      mes.diaria ??
      mes.metaDiaria ??
      mes.meta_dia ??
      registro.meta_diaria ??
      registro.diaria ??
      0
    )
  };
}

// ======================================================
// CÁLCULOS
// ======================================================

function criarEmpresaBase(empresa, metasEmpresa) {
  return {
    empresa,

    faturamento_hoje: 0,
    faturamento_mes: 0,

    vendas_hoje: 0,
    vendas_mes: 0,

    meta_ouro: arredondar(metasEmpresa.meta_ouro),
    meta_prata: arredondar(metasEmpresa.meta_prata),
    meta_diaria: arredondar(metasEmpresa.meta_diaria),

    origem_encontrada: false,
    nomes_encontrados_na_api: []
  };
}

function enriquecerEmpresa(empresa, periodo) {
  const dataReferencia =
    periodo.ano_mes === anoMesISO(periodo.hoje)
      ? periodo.hoje
      : fimMesISO(`${periodo.ano_mes}-01`);

  const diaAtual = Math.max(1, Number(String(dataReferencia).slice(8, 10)));
  const totalDiasMes = Number(fimMesISO(dataReferencia).slice(8, 10));
  const diasRestantes = Math.max(0, totalDiasMes - diaAtual);

  const faturamentoMes = numero(empresa.faturamento_mes);

  const metaOuro = numero(empresa.meta_ouro);
  const metaPrata = numero(empresa.meta_prata);

  const percentualIdealData = arredondar((diaAtual / totalDiasMes) * 100);

  const idealOuroData = arredondar(metaOuro * (percentualIdealData / 100));
  const idealPrataData = arredondar(metaPrata * (percentualIdealData / 100));

  const percentualOuro = percentual(faturamentoMes, metaOuro);
  const percentualPrata = percentual(faturamentoMes, metaPrata);

  const faltaOuro = Math.max(0, arredondar(metaOuro - faturamentoMes));
  const faltaPrata = Math.max(0, arredondar(metaPrata - faturamentoMes));

  const diferencaIdealOuro = arredondar(faturamentoMes - idealOuroData);
  const diferencaIdealPrata = arredondar(faturamentoMes - idealPrataData);

  const acimaIdealOuro = diferencaIdealOuro >= 0;
  const acimaIdealPrata = diferencaIdealPrata >= 0;

  const metaReferencia =
    metaOuro > 0
      ? metaOuro
      : metaPrata;

  const tipoMetaReferencia =
    metaOuro > 0
      ? "OURO"
      : "PRATA";

  const faltaReferencia = Math.max(
    0,
    arredondar(metaReferencia - faturamentoMes)
  );

  const percentualReferencia = percentual(
    faturamentoMes,
    metaReferencia
  );

  const ritmoDiarioAtual = arredondar(faturamentoMes / diaAtual);

  const projecaoMes = arredondar(
    ritmoDiarioAtual * totalDiasMes
  );

  const necessarioPorDia =
    diasRestantes > 0
      ? arredondar(faltaReferencia / diasRestantes)
      : faltaReferencia;

  const metaDiariaReferencia =
    numero(empresa.meta_diaria) > 0
      ? numero(empresa.meta_diaria)
      : metaReferencia > 0
        ? arredondar(metaReferencia / totalDiasMes)
        : 0;

  let status = "SEM META CADASTRADA";
  let statusEmoji = "⚪";
  let risco = "indefinido";

  if (metaReferencia > 0) {
    if (percentualReferencia >= 100) {
      status = `META ${tipoMetaReferencia} BATIDA`;
      statusEmoji = "🟢";
      risco = "baixo";
    } else if (percentualReferencia >= percentualIdealData) {
      status = "DENTRO OU ACIMA DA PREVISÃO";
      statusEmoji = "🟢";
      risco = "baixo";
    } else if (percentualReferencia >= percentualIdealData - 8) {
      status = "LEVEMENTE ABAIXO DA PREVISÃO";
      statusEmoji = "🟡";
      risco = "medio";
    } else {
      status = "ABAIXO DA PREVISÃO";
      statusEmoji = "🔴";
      risco = "alto";
    }
  }

  return {
    ...empresa,

    dia_atual: diaAtual,
    total_dias_mes: totalDiasMes,
    dias_restantes: diasRestantes,

    ideal_percentual_data: percentualIdealData,

    ideal_ouro_data: idealOuroData,
    ideal_prata_data: idealPrataData,

    percentual_ouro: percentualOuro,
    percentual_prata: percentualPrata,

    falta_ouro: faltaOuro,
    falta_prata: faltaPrata,

    diferenca_ideal_ouro: diferencaIdealOuro,
    diferenca_ideal_prata: diferencaIdealPrata,

    acima_ideal_ouro: acimaIdealOuro,
    acima_ideal_prata: acimaIdealPrata,

    meta_referencia: arredondar(metaReferencia),
    tipo_meta_referencia: tipoMetaReferencia,
    percentual_referencia: percentualReferencia,
    falta_referencia: faltaReferencia,

    ritmo_diario_atual: ritmoDiarioAtual,
    projecao_mes: projecaoMes,
    necessario_por_dia: necessarioPorDia,
    meta_diaria_referencia: arredondar(metaDiariaReferencia),

    status,
    status_emoji: statusEmoji,
    risco
  };
}

function consolidarEmpresas({ resumoDia, resumoMes, metas, periodo }) {
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

    base.faturamento_hoje = arredondar(
      linhasDiaEmpresa.reduce((s, linha) => s + faturamentoDaLinha(linha), 0)
    );

    base.faturamento_mes = arredondar(
      linhasMesEmpresa.reduce((s, linha) => s + faturamentoDaLinha(linha), 0)
    );

    base.vendas_hoje = linhasDiaEmpresa.reduce(
      (s, linha) => s + vendasDaLinha(linha),
      0
    );

    base.vendas_mes = linhasMesEmpresa.reduce(
      (s, linha) => s + vendasDaLinha(linha),
      0
    );

    base.origem_encontrada =
      linhasDiaEmpresa.length > 0 ||
      linhasMesEmpresa.length > 0;

    base.nomes_encontrados_na_api = [
      ...new Set([
        ...linhasDiaEmpresa.map(nomeEmpresaDaLinha),
        ...linhasMesEmpresa.map(nomeEmpresaDaLinha)
      ].filter(Boolean))
    ];

    return enriquecerEmpresa(base, periodo);
  });
}

function consolidarGeral(empresas, periodo) {
  const geral = {
    empresa: "GERAL",

    faturamento_hoje: arredondar(
      empresas.reduce((s, e) => s + numero(e.faturamento_hoje), 0)
    ),

    faturamento_mes: arredondar(
      empresas.reduce((s, e) => s + numero(e.faturamento_mes), 0)
    ),

    vendas_hoje: empresas.reduce((s, e) => s + numero(e.vendas_hoje), 0),
    vendas_mes: empresas.reduce((s, e) => s + numero(e.vendas_mes), 0),

    meta_ouro: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_ouro), 0)
    ),

    meta_prata: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_prata), 0)
    ),

    meta_diaria: arredondar(
      empresas.reduce((s, e) => s + numero(e.meta_diaria), 0)
    ),

    origem_encontrada: empresas.some(e => e.origem_encontrada),
    nomes_encontrados_na_api: empresas.flatMap(e => e.nomes_encontrados_na_api || [])
  };

  return enriquecerEmpresa(geral, periodo);
}

function rankingProximidade(empresas) {
  return [...empresas]
    .sort((a, b) => numero(b.percentual_referencia) - numero(a.percentual_referencia));
}

function rankingDistancia(empresas) {
  return [...empresas]
    .sort((a, b) => numero(b.falta_referencia) - numero(a.falta_referencia));
}

// ======================================================
// RESPOSTAS TEXTO
// ======================================================

function linhaEmpresaTexto(e) {
  const previsaoOuro = e.acima_ideal_ouro ? "acima do ideal" : "abaixo do ideal";
  const previsaoPrata = e.acima_ideal_prata ? "acima do ideal" : "abaixo do ideal";

  return [
    `${e.status_emoji} ${e.empresa}`,
    `Faturamento no mês: ${formatarMoeda(e.faturamento_mes)}`,
    `Meta ouro: ${formatarMoeda(e.meta_ouro)} | ${formatarPercentual(e.percentual_ouro)} | falta ${formatarMoeda(e.falta_ouro)}`,
    `Meta prata: ${formatarMoeda(e.meta_prata)} | ${formatarPercentual(e.percentual_prata)} | falta ${formatarMoeda(e.falta_prata)}`,
    `Ideal para a data: ${formatarPercentual(e.ideal_percentual_data)}`,
    `Ideal ouro até hoje: ${formatarMoeda(e.ideal_ouro_data)} | ${previsaoOuro} em ${formatarMoeda(Math.abs(e.diferenca_ideal_ouro))}`,
    `Ideal prata até hoje: ${formatarMoeda(e.ideal_prata_data)} | ${previsaoPrata} em ${formatarMoeda(Math.abs(e.diferenca_ideal_prata))}`,
    `Necessário por dia: ${formatarMoeda(e.necessario_por_dia)}`,
    `Projeção do mês: ${formatarMoeda(e.projecao_mes)}`,
    `Status: ${e.status}`
  ].join("\n");
}

function responderRelatorioDetalhado(empresas, geral, periodo) {
  const ranking = rankingProximidade(empresas);
  const distancia = rankingDistancia(empresas);

  const melhor = ranking[0];
  const pior = distancia[0];

  const linhas = [];

  linhas.push("📊 RELATÓRIO DETALHADO DE METAS");
  linhas.push(`Período: ${periodo.label}`);
  linhas.push(`Data base: ${labelDataBR(periodo.hoje)}`);
  linhas.push("");

  linhas.push("RESUMO GERAL");
  linhas.push(`Faturamento total no mês: ${formatarMoeda(geral.faturamento_mes)}`);
  linhas.push(`Meta ouro geral: ${formatarMoeda(geral.meta_ouro)} | ${formatarPercentual(geral.percentual_ouro)}`);
  linhas.push(`Meta prata geral: ${formatarMoeda(geral.meta_prata)} | ${formatarPercentual(geral.percentual_prata)}`);
  linhas.push(`Ideal para a data: ${formatarPercentual(geral.ideal_percentual_data)}`);
  linhas.push(`Falta para referência: ${formatarMoeda(geral.falta_referencia)}`);
  linhas.push(`Necessário por dia geral: ${formatarMoeda(geral.necessario_por_dia)}`);
  linhas.push(`Projeção geral: ${formatarMoeda(geral.projecao_mes)}`);
  linhas.push(`${geral.status_emoji} Status geral: ${geral.status}`);

  if (melhor) {
    linhas.push("");
    linhas.push(`Mais próxima da meta: ${melhor.empresa}, com ${formatarPercentual(melhor.percentual_referencia)}.`);
  }

  if (pior) {
    linhas.push(`Mais distante da meta: ${pior.empresa}, faltando ${formatarMoeda(pior.falta_referencia)}.`);
  }

  linhas.push("");
  linhas.push("DETALHADO POR EMPRESA");
  linhas.push("");

  empresas.forEach(e => {
    linhas.push(linhaEmpresaTexto(e));
    linhas.push("");
  });

  return linhas.join("\n").trim();
}

function responderEmpresa(e, periodo) {
  return [
    `🎯 METAS • ${e.empresa}`,
    `Período: ${periodo.label}`,
    "",
    linhaEmpresaTexto(e)
  ].join("\n");
}

function responderMaisPerto(empresas) {
  const melhor = rankingProximidade(empresas)[0];

  if (!melhor) {
    return "Não encontrei empresa para calcular proximidade da meta.";
  }

  return [
    "🏆 EMPRESA MAIS PRÓXIMA DA META",
    "",
    linhaEmpresaTexto(melhor)
  ].join("\n");
}

function responderMaisDistante(empresas) {
  const pior = rankingDistancia(empresas)[0];

  if (!pior) {
    return "Não encontrei empresa para calcular distância da meta.";
  }

  return [
    "⚠️ EMPRESA MAIS DISTANTE DA META",
    "",
    linhaEmpresaTexto(pior)
  ].join("\n");
}

function responderPrevisao(e, periodo) {
  const linhas = [];

  linhas.push(`🔮 PREVISÃO DE META • ${e.empresa}`);
  linhas.push(`Período: ${periodo.label}`);
  linhas.push("");

  linhas.push(`Faturamento atual do mês: ${formatarMoeda(e.faturamento_mes)}`);
  linhas.push(`Ritmo diário atual: ${formatarMoeda(e.ritmo_diario_atual)}`);
  linhas.push(`Projeção de fechamento: ${formatarMoeda(e.projecao_mes)}`);
  linhas.push(`Meta referência: ${e.tipo_meta_referencia} — ${formatarMoeda(e.meta_referencia)}`);
  linhas.push(`Falta para bater: ${formatarMoeda(e.falta_referencia)}`);
  linhas.push(`Necessário por dia: ${formatarMoeda(e.necessario_por_dia)}`);
  linhas.push(`Ideal para a data: ${formatarPercentual(e.ideal_percentual_data)}`);
  linhas.push(`${e.status_emoji} Status: ${e.status}`);

  return linhas.join("\n");
}

function responderRanking(empresas) {
  const ranking = rankingProximidade(empresas);

  const linhas = [];

  linhas.push("🏆 RANKING DE METAS");
  linhas.push("");

  ranking.forEach((e, index) => {
    linhas.push(
      `${index + 1}. ${e.empresa}: ${formatarPercentual(e.percentual_referencia)} | falta ${formatarMoeda(e.falta_referencia)} | ${e.status_emoji} ${e.status}`
    );
  });

  return linhas.join("\n");
}

// ======================================================
// CANVAS HTML
// ======================================================

function barraPercentual(valor) {
  const v = Math.max(0, Math.min(100, numero(valor)));

  return `
    <div class="bar">
      <div class="bar-fill" style="width:${v}%"></div>
    </div>
  `;
}

function gerarCardEmpresaHTML(e) {
  const classe =
    e.risco === "baixo"
      ? "ok"
      : e.risco === "medio"
        ? "medio"
        : e.risco === "alto"
          ? "alto"
          : "neutro";

  return `
    <section class="empresa-card ${classe}">
      <div class="empresa-top">
        <div>
          <h2>${escaparHTML(e.empresa)}</h2>
          <p>${escaparHTML(e.status)}</p>
        </div>
        <div class="badge">${e.status_emoji}</div>
      </div>

      <div class="grid-metricas">
        <div class="metrica forte">
          <span>Faturamento total no mês</span>
          <strong>${formatarMoeda(e.faturamento_mes)}</strong>
        </div>

        <div class="metrica">
          <span>Meta ouro</span>
          <strong>${formatarMoeda(e.meta_ouro)}</strong>
          <small>${formatarPercentual(e.percentual_ouro)} atingido</small>
          ${barraPercentual(e.percentual_ouro)}
        </div>

        <div class="metrica">
          <span>Meta prata</span>
          <strong>${formatarMoeda(e.meta_prata)}</strong>
          <small>${formatarPercentual(e.percentual_prata)} atingido</small>
          ${barraPercentual(e.percentual_prata)}
        </div>

        <div class="metrica">
          <span>Falta para ouro</span>
          <strong>${formatarMoeda(e.falta_ouro)}</strong>
        </div>

        <div class="metrica">
          <span>Falta para prata</span>
          <strong>${formatarMoeda(e.falta_prata)}</strong>
        </div>

        <div class="metrica">
          <span>Ideal para a data</span>
          <strong>${formatarPercentual(e.ideal_percentual_data)}</strong>
          <small>Dia ${e.dia_atual} de ${e.total_dias_mes}</small>
        </div>

        <div class="metrica">
          <span>Ideal ouro até hoje</span>
          <strong>${formatarMoeda(e.ideal_ouro_data)}</strong>
          <small class="${e.acima_ideal_ouro ? "positivo" : "negativo"}">
            ${e.acima_ideal_ouro ? "Acima" : "Abaixo"} em ${formatarMoeda(Math.abs(e.diferenca_ideal_ouro))}
          </small>
        </div>

        <div class="metrica">
          <span>Ideal prata até hoje</span>
          <strong>${formatarMoeda(e.ideal_prata_data)}</strong>
          <small class="${e.acima_ideal_prata ? "positivo" : "negativo"}">
            ${e.acima_ideal_prata ? "Acima" : "Abaixo"} em ${formatarMoeda(Math.abs(e.diferenca_ideal_prata))}
          </small>
        </div>

        <div class="metrica">
          <span>Necessário por dia</span>
          <strong>${formatarMoeda(e.necessario_por_dia)}</strong>
          <small>${e.dias_restantes} dias restantes</small>
        </div>

        <div class="metrica">
          <span>Projeção do mês</span>
          <strong>${formatarMoeda(e.projecao_mes)}</strong>
        </div>
      </div>
    </section>
  `;
}

function gerarCanvasHTML({ empresas, geral, periodo, pergunta }) {
  const ranking = rankingProximidade(empresas);
  const distancia = rankingDistancia(empresas);

  const melhor = ranking[0];
  const pior = distancia[0];

  const cards = empresas.map(gerarCardEmpresaHTML).join("");

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Relatório de Metas</title>

<style>
*{
  box-sizing:border-box;
  margin:0;
  padding:0;
  font-family:Inter,Arial,sans-serif;
}

body{
  background:#f1f5f9;
  color:#0f172a;
  padding:22px;
}

.wrap{
  max-width:1400px;
  margin:0 auto;
}

.header{
  background:linear-gradient(135deg,#0f172a,#1d4ed8);
  color:white;
  border-radius:28px;
  padding:28px;
  box-shadow:0 20px 50px rgba(15,23,42,.18);
  margin-bottom:20px;
}

.header h1{
  font-size:30px;
  font-weight:900;
  margin-bottom:8px;
}

.header p{
  opacity:.88;
  font-size:15px;
  line-height:1.5;
}

.resumo-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
  margin-bottom:20px;
}

.resumo-card{
  background:white;
  border:1px solid #e2e8f0;
  border-radius:22px;
  padding:18px;
  box-shadow:0 12px 32px rgba(15,23,42,.07);
}

.resumo-card span{
  display:block;
  color:#64748b;
  font-size:12px;
  font-weight:800;
  text-transform:uppercase;
  margin-bottom:8px;
}

.resumo-card strong{
  font-size:23px;
  font-weight:900;
  color:#0f172a;
}

.alertas{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-bottom:20px;
}

.alerta{
  background:white;
  border-radius:22px;
  padding:18px;
  border:1px solid #e2e8f0;
  box-shadow:0 12px 32px rgba(15,23,42,.07);
}

.alerta h3{
  font-size:15px;
  margin-bottom:8px;
}

.alerta strong{
  display:block;
  font-size:22px;
  font-weight:900;
}

.empresas{
  display:grid;
  grid-template-columns:1fr;
  gap:18px;
}

.empresa-card{
  background:white;
  border-radius:26px;
  padding:22px;
  border:1px solid #e2e8f0;
  box-shadow:0 16px 38px rgba(15,23,42,.08);
}

.empresa-card.ok{
  border-left:8px solid #16a34a;
}

.empresa-card.medio{
  border-left:8px solid #ca8a04;
}

.empresa-card.alto{
  border-left:8px solid #dc2626;
}

.empresa-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:14px;
  margin-bottom:18px;
}

.empresa-top h2{
  font-size:23px;
  font-weight:900;
}

.empresa-top p{
  color:#64748b;
  font-size:13px;
  font-weight:800;
  margin-top:4px;
}

.badge{
  width:48px;
  height:48px;
  border-radius:18px;
  background:#f8fafc;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:24px;
}

.grid-metricas{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:12px;
}

.metrica{
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:18px;
  padding:14px;
  min-height:105px;
}

.metrica.forte{
  background:#eff6ff;
  border-color:#bfdbfe;
}

.metrica span{
  display:block;
  color:#64748b;
  font-size:11px;
  font-weight:900;
  text-transform:uppercase;
  margin-bottom:8px;
}

.metrica strong{
  display:block;
  font-size:18px;
  font-weight:900;
  color:#0f172a;
}

.metrica small{
  display:block;
  margin-top:6px;
  color:#64748b;
  font-size:12px;
  font-weight:700;
}

.positivo{
  color:#16a34a !important;
}

.negativo{
  color:#dc2626 !important;
}

.bar{
  width:100%;
  height:9px;
  border-radius:99px;
  background:#e2e8f0;
  overflow:hidden;
  margin-top:10px;
}

.bar-fill{
  height:100%;
  border-radius:99px;
  background:linear-gradient(90deg,#2563eb,#22c55e);
}

@media(max-width:1100px){
  .resumo-grid{
    grid-template-columns:repeat(2,1fr);
  }

  .grid-metricas{
    grid-template-columns:repeat(2,1fr);
  }
}

@media(max-width:720px){
  body{
    padding:12px;
  }

  .header{
    border-radius:22px;
    padding:20px;
  }

  .header h1{
    font-size:22px;
  }

  .resumo-grid,
  .alertas,
  .grid-metricas{
    grid-template-columns:1fr;
  }

  .empresa-card{
    padding:16px;
  }

  .empresa-top h2{
    font-size:19px;
  }
}
</style>
</head>

<body>
<div class="wrap">

  <div class="header">
    <h1>📊 Relatório de Metas de Faturamento</h1>
    <p>
      Período: <strong>${escaparHTML(periodo.label)}</strong> •
      Data base: <strong>${labelDataBR(periodo.hoje)}</strong><br>
      Pergunta: ${escaparHTML(pergunta)}
    </p>
  </div>

  <div class="resumo-grid">
    <div class="resumo-card">
      <span>Faturamento geral no mês</span>
      <strong>${formatarMoeda(geral.faturamento_mes)}</strong>
    </div>

    <div class="resumo-card">
      <span>Meta ouro geral</span>
      <strong>${formatarMoeda(geral.meta_ouro)}</strong>
    </div>

    <div class="resumo-card">
      <span>Meta prata geral</span>
      <strong>${formatarMoeda(geral.meta_prata)}</strong>
    </div>

    <div class="resumo-card">
      <span>Ideal para a data</span>
      <strong>${formatarPercentual(geral.ideal_percentual_data)}</strong>
    </div>
  </div>

  <div class="alertas">
    <div class="alerta">
      <h3>🏆 Mais próxima da meta</h3>
      <strong>${melhor ? escaparHTML(melhor.empresa) : "Sem dados"}</strong>
      <p>${melhor ? `${formatarPercentual(melhor.percentual_referencia)} atingido` : ""}</p>
    </div>

    <div class="alerta">
      <h3>⚠️ Mais distante da meta</h3>
      <strong>${pior ? escaparHTML(pior.empresa) : "Sem dados"}</strong>
      <p>${pior ? `Falta ${formatarMoeda(pior.falta_referencia)}` : ""}</p>
    </div>
  </div>

  <div class="empresas">
    ${cards}
  </div>

</div>
</body>
</html>
  `;
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
          resposta: limitarTexto(resposta, 12000),
          agente: "AGENTE_METAS",
          empresa: empresa || null,
          contexto: dados || null,
          created_at: new Date().toISOString()
        }
      ]);
  } catch (e) {
    console.log("ERRO AO SALVAR HISTÓRICO METAS:", e.message);
  }
}

// ======================================================
// MONTAR RESPOSTA FINAL
// ======================================================

function montarResposta({
  intencao,
  empresaPerguntada,
  empresaSelecionada,
  empresas,
  geral,
  periodo
}) {
  if (intencao === "mais_perto") {
    return responderMaisPerto(empresas);
  }

  if (intencao === "mais_distante") {
    return responderMaisDistante(empresas);
  }

  if (intencao === "previsao") {
    return responderPrevisao(empresaSelecionada, periodo);
  }

  if (intencao === "ranking") {
    return responderRanking(empresas);
  }

  if (empresaPerguntada) {
    return responderEmpresa(empresaSelecionada, periodo);
  }

  return responderRelatorioDetalhado(empresas, geral, periodo);
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
        erro: "Método não permitido. Use POST ou GET."
      });
    }

    const body = parseBody(req);

    const pergunta =
      body.pergunta ||
      body.mensagem ||
      body.texto ||
      body.query ||
      req.query?.pergunta ||
      req.query?.q ||
      "Me mande um relatório detalhado das metas desse mês.";

    const periodo = interpretarPeriodo(pergunta, body);
    const intencao = interpretarIntencao(pergunta);
    const empresaPerguntada = identificarEmpresa(pergunta);

    const { API_URL, METAS } = await carregarConfiguracoes();

    const resumoDiaResultado = await buscarResumoDia(
      API_URL,
      periodo.data || periodo.hoje
    );

    const resumoMesResultado = await buscarResumoMes(
      API_URL,
      periodo
    );

    const empresas = consolidarEmpresas({
      resumoDia: resumoDiaResultado.json,
      resumoMes: resumoMesResultado.json,
      metas: METAS,
      periodo
    });

    const geral = consolidarGeral(empresas, periodo);

    const empresaSelecionada = empresaPerguntada
      ? empresas.find(e => e.empresa === empresaPerguntada) || geral
      : geral;

    const ranking_proximidade = rankingProximidade(empresas);
    const ranking_distancia = rankingDistancia(empresas);

    const resposta = montarResposta({
      intencao,
      empresaPerguntada,
      empresaSelecionada,
      empresas,
      geral,
      periodo
    });

    const canvas_html = gerarCanvasHTML({
      empresas,
      geral,
      periodo,
      pergunta
    });

    await salvarHistorico({
      pergunta,
      resposta,
      empresa: empresaPerguntada || "GERAL",
      dados: {
        periodo,
        intencao,
        empresaPerguntada,
        empresaSelecionada,
        geral,
        empresas,
        ranking_proximidade,
        ranking_distancia
      }
    });

    return res.status(200).json({
      ok: true,
      agente: "AGENTE_METAS",
      pergunta,
      resposta,

      canvas: true,
      canvas_tipo: "html",
      canvas_html,

      periodo,
      intencao,

      empresa_perguntada: empresaPerguntada,
      empresa: empresaSelecionada,

      geral,
      empresas,

      ranking_proximidade,
      ranking_distancia,

      fontes: {
        api_url: API_URL,
        resumo_dia: resumoDiaResultado?.url || null,
        resumo_mes: resumoMesResultado?.url || null,
        metas: "parametros_sistema.nome_parametro = meta_vendas"
      },

      calculos: {
        ideal_para_data:
          "ideal_percentual_data = dia_atual / total_dias_mes * 100",
        ideal_ouro_data:
          "ideal_ouro_data = meta_ouro * ideal_percentual_data / 100",
        ideal_prata_data:
          "ideal_prata_data = meta_prata * ideal_percentual_data / 100",
        previsao:
          "se percentual atingido >= ideal_percentual_data, está dentro/acima da previsão"
      },

      regras: {
        detalhado_por_empresa: true,
        mostra_nome: true,
        mostra_faturamento_total_mes: true,
        mostra_meta_ouro: true,
        mostra_meta_prata: true,
        mostra_quanto_falta: true,
        mostra_percentual: true,
        mostra_ideal_para_data: true,
        mostra_acima_ou_abaixo_da_previsao: true,
        mostra_canvas_html: true,
        empresas_separadas: true,
        emporio_nao_mistura_com_restaurante: true,
        villa_aceita_vila: true,
        kids_aceita_mkids: true
      },

      hoje: periodo.hoje,
      timezone: TIMEZONE,
      timestamp: new Date().toISOString(),
      agora_bahia: agoraBahiaDate().toISOString()
    });
  } catch (error) {
    console.log("ERRO API METAS:", error);

    return res.status(500).json({
      ok: false,
      agente: "AGENTE_METAS",
      erro: error.message || "Erro interno na API de metas.",
      timezone: TIMEZONE,
      timestamp: new Date().toISOString()
    });
  }
};
