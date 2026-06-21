// ======================================================
// OTTO • API PODEROSA DE ESTOQUE
// /api/sistema-otto/estoque.js
//
// FUNÇÃO:
// Responder perguntas rápidas e precisas sobre estoque,
// produtos, saldo, mínimo, ideal, local de saída,
// empresa, entradas, saídas, itens zerados e itens críticos.
//
// FONTES:
// - mercatto_estoque
// - vw_resumo_estoque
// - mercatto_requisicoes
// - movimentacoes_estoque
//
// EXEMPLOS:
// "quanto tem de arroz?"
// "tem filé mignon no estoque?"
// "qual saldo do produto X?"
// "produtos sem estoque"
// "produtos abaixo do mínimo"
// "itens críticos"
// "saída de arroz no mês"
// "entrada de arroz hoje"
// "onde fica o produto X?"
// ======================================================

const { createClient } = require("@supabase/supabase-js");

// ======================================================
// CONFIGURAÇÕES
// ======================================================

const TIMEZONE = "America/Bahia";

const REQUEST_LIMIT_PADRAO = Number(
  process.env.ESTOQUE_LIMIT_PADRAO || 20
);

const REQUEST_LIMIT_MAX = Number(
  process.env.ESTOQUE_LIMIT_MAX || 80
);

const HISTORICO_ATIVO =
  String(process.env.ESTOQUE_HISTORICO_ATIVO || "true") !== "false";

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
  return Number(numero(valor).toFixed(3));
}

function formatarNumero(valor) {
  return numero(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
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

function interpretarPeriodo(pergunta, body = {}) {
  const texto = normalizar(pergunta);
  const hoje = hojeBahiaISO();

  let data = hoje;
  let inicio = hoje;
  let fim = hoje;
  let tipo = "dia";
  let label = "hoje";

  if (body.data && dataValidaISO(body.data)) {
    data = body.data;
    inicio = data;
    fim = data;
    tipo = "dia";
    label = labelDataBR(data);
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
  }

  const iso = texto.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const dataBR = texto.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);

  if (iso && dataValidaISO(iso[0])) {
    data = iso[0];
    inicio = data;
    fim = data;
    tipo = "dia";
    label = labelDataBR(data);
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
    }
  } else if (texto.includes("anteontem")) {
    data = addDiasISO(hoje, -2);
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "anteontem";
  } else if (texto.includes("ontem")) {
    data = addDiasISO(hoje, -1);
    inicio = data;
    fim = data;
    tipo = "dia";
    label = "ontem";
  } else if (texto.includes("semana") || texto.includes("ultimos 7") || texto.includes("ultimas 7")) {
    fim = hoje;
    inicio = addDiasISO(hoje, -6);
    data = fim;
    tipo = "periodo";
    label = "últimos 7 dias";
  } else if (texto.includes("ultimos 30") || texto.includes("ultimas 30")) {
    fim = hoje;
    inicio = addDiasISO(hoje, -29);
    data = fim;
    tipo = "periodo";
    label = "últimos 30 dias";
  } else if (
    texto.includes("mes") ||
    texto.includes("mensal") ||
    texto.includes("no mes") ||
    texto.includes("mês")
  ) {
    inicio = inicioMesISO(hoje);
    fim = hoje;
    data = hoje;
    tipo = "mes";
    label = "mês atual";
  }

  return {
    tipo,
    data,
    inicio,
    fim,
    label,
    hoje,
    ano_mes: anoMesISO(data)
  };
}

// ======================================================
// INTERPRETAÇÃO
// ======================================================

const LOCAIS_SAIDA = [
  "ESTOQUE CENTRAL",
  "ESTOQUE AÇOUGUE",
  "ESTOQUE BAR",
  "ESTOQUE VINHOS"
];

function identificarLocal(pergunta, body = {}) {
  if (body.local_saida) {
    return String(body.local_saida).trim();
  }

  const texto = normalizar(pergunta);

  if (texto.includes("central")) {
    return "ESTOQUE CENTRAL";
  }

  if (
    texto.includes("acougue") ||
    texto.includes("açougue") ||
    texto.includes("carne")
  ) {
    return "ESTOQUE AÇOUGUE";
  }

  if (
    texto.includes("bar") ||
    texto.includes("bebida") ||
    texto.includes("bebidas")
  ) {
    return "ESTOQUE BAR";
  }

  if (
    texto.includes("vinho") ||
    texto.includes("vinhos") ||
    texto.includes("adega")
  ) {
    return "ESTOQUE VINHOS";
  }

  return null;
}

function identificarEmpresa(pergunta, body = {}) {
  if (body.empresa) {
    return String(body.empresa).trim();
  }

  const texto = normalizar(pergunta);

  if (texto.includes("mercatto delicia") || texto.includes("mercatto delícia")) {
    return "MERCATTO DELICIA";
  }

  if (texto.includes("mercatto")) {
    return "MERCATTO DELICIA";
  }

  if (texto.includes("villa") || texto.includes("vila")) {
    return "VILLA GOURMET";
  }

  if (texto.includes("padaria")) {
    return "PADARIA DELICIA";
  }

  if (texto.includes("kids") || texto.includes("mkids") || texto.includes("m kids")) {
    return "M.KIDS";
  }

  if (texto.includes("delicia gourmet") || texto.includes("delícia gourmet")) {
    return "DELICIA GOURMET";
  }

  return null;
}

function interpretarIntencao(pergunta) {
  const texto = normalizar(pergunta);

  if (
    texto.includes("resumo") ||
    texto.includes("geral") ||
    texto.includes("cards") ||
    texto.includes("total de produtos") ||
    texto.includes("quantos produtos")
  ) {
    return "resumo";
  }

  if (
    texto.includes("sem estoque") ||
    texto.includes("zerado") ||
    texto.includes("zerados") ||
    texto.includes("saldo zero") ||
    texto.includes("acabou") ||
    texto.includes("acabaram")
  ) {
    return "sem_estoque";
  }

  if (
    texto.includes("abaixo do minimo") ||
    texto.includes("abaixo do mínimo") ||
    texto.includes("critico") ||
    texto.includes("crítico") ||
    texto.includes("estoque baixo") ||
    texto.includes("precisa comprar") ||
    texto.includes("comprar")
  ) {
    return "criticos";
  }

  if (
    texto.includes("acima do ideal") ||
    texto.includes("sobrando") ||
    texto.includes("excesso") ||
    texto.includes("muito estoque")
  ) {
    return "excesso";
  }

  if (
    texto.includes("entrada") ||
    texto.includes("entrou") ||
    texto.includes("comprou") ||
    texto.includes("compra manual") ||
    texto.includes("movimentacao entrada") ||
    texto.includes("movimentação entrada")
  ) {
    return "entradas";
  }

  if (
    texto.includes("saida") ||
    texto.includes("saída") ||
    texto.includes("saiu") ||
    texto.includes("consumo") ||
    texto.includes("requisicao") ||
    texto.includes("requisição") ||
    texto.includes("usou") ||
    texto.includes("usaram")
  ) {
    return "saidas";
  }

  if (
    texto.includes("movimentacao") ||
    texto.includes("movimentação") ||
    texto.includes("historico") ||
    texto.includes("histórico")
  ) {
    return "movimentacoes";
  }

  if (
    texto.includes("onde") ||
    texto.includes("local") ||
    texto.includes("fica") ||
    texto.includes("qual estoque")
  ) {
    return "local";
  }

  if (
    texto.includes("minimo") ||
    texto.includes("mínimo") ||
    texto.includes("ideal")
  ) {
    return "parametros";
  }

  return "produto";
}

function extrairProdutoDaPergunta(pergunta, body = {}) {
  if (body.produto) {
    return String(body.produto).trim();
  }

  const original = String(pergunta || "").trim();
  const texto = normalizar(original);

  let limpo = texto;

  const frasesRemover = [
    "quanto tem de",
    "quanto tem do",
    "quanto tem da",
    "quanto tem",
    "qual saldo de",
    "qual saldo do",
    "qual saldo da",
    "saldo de",
    "saldo do",
    "saldo da",
    "tem estoque de",
    "tem estoque do",
    "tem estoque da",
    "tem de",
    "tem do",
    "tem da",
    "tem",
    "onde fica",
    "onde esta",
    "onde está",
    "qual local de",
    "qual local do",
    "qual local da",
    "saida de",
    "saída de",
    "saida do",
    "saída do",
    "saida da",
    "saída da",
    "entrada de",
    "entrada do",
    "entrada da",
    "movimentacao de",
    "movimentação de",
    "movimentacao do",
    "movimentação do",
    "movimentacao da",
    "movimentação da",
    "no estoque",
    "estoque",
    "produto",
    "produtos",
    "hoje",
    "ontem",
    "anteontem",
    "esse mes",
    "este mes",
    "mês",
    "mes",
    "semana",
    "ultimos 7 dias",
    "últimos 7 dias",
    "ultimos 30 dias",
    "últimos 30 dias"
  ];

  frasesRemover.forEach(frase => {
    limpo = limpo.replaceAll(frase, " ");
  });

  LOCAIS_SAIDA.forEach(local => {
    limpo = limpo.replaceAll(normalizar(local), " ");
  });

  const empresasRemover = [
    "mercatto delicia",
    "mercatto delícia",
    "mercatto",
    "villa gourmet",
    "vila gourmet",
    "villa",
    "vila",
    "padaria delicia",
    "padaria delícia",
    "padaria",
    "kids",
    "mkids",
    "m kids",
    "delicia gourmet",
    "delícia gourmet"
  ];

  empresasRemover.forEach(emp => {
    limpo = limpo.replaceAll(emp, " ");
  });

  limpo = limpo
    .replace(/\b(de|do|da|dos|das|o|a|os|as|no|na|nos|nas|em|para|pra)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo || limpo.length < 2) {
    return "";
  }

  return limpo;
}

// ======================================================
// CONSULTAS
// ======================================================

async function buscarResumoEstoque() {
  const { data, error } = await supabase
    .from("vw_resumo_estoque")
    .select("*")
    .single();

  if (error) {
    throw new Error(`Erro ao buscar vw_resumo_estoque: ${error.message}`);
  }

  return data || {};
}

async function buscarProdutos({
  produto,
  local_saida,
  empresa,
  ativo,
  limite = REQUEST_LIMIT_PADRAO
}) {
  let query = supabase
    .from("mercatto_estoque")
    .select(`
      id,
      produto,
      unidade,
      saldo,
      quantidade,
      und_compra,
      qtd_unidades,
      ativo,
      local_saida,
      empresa,
      estoque_minimo,
      estoque_ideal,
      atualizado_em,
      criado_em
    `)
    .order("produto", { ascending: true })
    .limit(Math.min(Number(limite) || REQUEST_LIMIT_PADRAO, REQUEST_LIMIT_MAX));

  if (produto) {
    query = query.ilike("produto", `%${produto}%`);
  }

  if (local_saida) {
    query = query.eq("local_saida", local_saida);
  }

  if (empresa) {
    query = query.eq("empresa", empresa);
  }

  if (ativo === true || ativo === false) {
    query = query.eq("ativo", ativo);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar mercatto_estoque: ${error.message}`);
  }

  return data || [];
}

async function buscarProdutoMaisProvavel({ produto, local_saida, empresa }) {
  const encontrados = await buscarProdutos({
    produto,
    local_saida,
    empresa,
    limite: 15
  });

  if (!produto) {
    return {
      produto: null,
      encontrados
    };
  }

  const termo = normalizar(produto);
  const termoCompacto = compactar(produto);

  const exato = encontrados.find(item => {
    return (
      normalizar(item.produto) === termo ||
      compactar(item.produto) === termoCompacto
    );
  });

  if (exato) {
    return {
      produto: exato,
      encontrados
    };
  }

  const comeca = encontrados.find(item => {
    return normalizar(item.produto).startsWith(termo);
  });

  if (comeca) {
    return {
      produto: comeca,
      encontrados
    };
  }

  return {
    produto: encontrados[0] || null,
    encontrados
  };
}

async function buscarProdutosSemEstoque({ local_saida, empresa, limite }) {
  let query = supabase
    .from("mercatto_estoque")
    .select(`
      id,
      produto,
      unidade,
      saldo,
      quantidade,
      ativo,
      local_saida,
      empresa,
      estoque_minimo,
      estoque_ideal,
      atualizado_em
    `)
    .lte("saldo", 0)
    .order("produto", { ascending: true })
    .limit(Math.min(Number(limite) || REQUEST_LIMIT_PADRAO, REQUEST_LIMIT_MAX));

  if (local_saida) {
    query = query.eq("local_saida", local_saida);
  }

  if (empresa) {
    query = query.eq("empresa", empresa);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar produtos sem estoque: ${error.message}`);
  }

  return data || [];
}

async function buscarProdutosCriticos({ local_saida, empresa, limite }) {
  let query = supabase
    .from("mercatto_estoque")
    .select(`
      id,
      produto,
      unidade,
      saldo,
      quantidade,
      ativo,
      local_saida,
      empresa,
      estoque_minimo,
      estoque_ideal,
      atualizado_em
    `)
    .order("produto", { ascending: true })
    .limit(1000);

  if (local_saida) {
    query = query.eq("local_saida", local_saida);
  }

  if (empresa) {
    query = query.eq("empresa", empresa);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar produtos críticos: ${error.message}`);
  }

  return (data || [])
    .filter(item => {
      return numero(item.estoque_minimo) > 0 &&
        numero(item.saldo) <= numero(item.estoque_minimo);
    })
    .sort((a, b) => {
      const faltaA = numero(a.estoque_minimo) - numero(a.saldo);
      const faltaB = numero(b.estoque_minimo) - numero(b.saldo);
      return faltaB - faltaA;
    })
    .slice(0, Math.min(Number(limite) || REQUEST_LIMIT_PADRAO, REQUEST_LIMIT_MAX));
}

async function buscarProdutosExcesso({ local_saida, empresa, limite }) {
  let query = supabase
    .from("mercatto_estoque")
    .select(`
      id,
      produto,
      unidade,
      saldo,
      quantidade,
      ativo,
      local_saida,
      empresa,
      estoque_minimo,
      estoque_ideal,
      atualizado_em
    `)
    .order("produto", { ascending: true })
    .limit(1000);

  if (local_saida) {
    query = query.eq("local_saida", local_saida);
  }

  if (empresa) {
    query = query.eq("empresa", empresa);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar produtos em excesso: ${error.message}`);
  }

  return (data || [])
    .filter(item => {
      return numero(item.estoque_ideal) > 0 &&
        numero(item.saldo) > numero(item.estoque_ideal);
    })
    .sort((a, b) => {
      const excessoA = numero(a.saldo) - numero(a.estoque_ideal);
      const excessoB = numero(b.saldo) - numero(b.estoque_ideal);
      return excessoB - excessoA;
    })
    .slice(0, Math.min(Number(limite) || REQUEST_LIMIT_PADRAO, REQUEST_LIMIT_MAX));
}

async function buscarSaidasProduto({ produtoNome, periodo }) {
  let query = supabase
    .from("mercatto_requisicoes")
    .select(`
      id,
      produto,
      quantidade,
      created_at,
      status,
      setor,
      solicitante,
      local_saida,
      empresa
    `)
    .gte("created_at", `${periodo.inicio}T00:00:00`)
    .lt("created_at", `${addDiasISO(periodo.fim, 1)}T00:00:00`)
    .order("created_at", { ascending: false })
    .limit(500);

  if (produtoNome) {
    query = query.ilike("produto", `%${produtoNome}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar mercatto_requisicoes: ${error.message}`);
  }

  return (data || []).filter(item => item.status !== "NEGADO");
}

async function buscarEntradasProduto({ produtoId, periodo }) {
  let query = supabase
    .from("movimentacoes_estoque")
    .select(`
      id,
      produto_id,
      tipo,
      quantidade,
      origem,
      origem_id,
      estoque_antes,
      estoque_depois,
      observacao,
      created_at
    `)
    .gte("created_at", `${periodo.inicio}T00:00:00`)
    .lt("created_at", `${addDiasISO(periodo.fim, 1)}T00:00:00`)
    .order("created_at", { ascending: false })
    .limit(300);

  if (produtoId) {
    query = query.eq("produto_id", produtoId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Erro ao buscar movimentacoes_estoque: ${error.message}`);
  }

  return data || [];
}

async function buscarHistoricoMovimentacoes({ produtoId, periodo }) {
  const entradas = await buscarEntradasProduto({
    produtoId,
    periodo
  });

  return entradas;
}

// ======================================================
// CÁLCULOS
// ======================================================

function enriquecerProduto(item) {
  const saldo = numero(item.saldo);
  const minimo = numero(item.estoque_minimo);
  const ideal = numero(item.estoque_ideal);

  const faltaMinimo = Math.max(0, arredondar(minimo - saldo));
  const faltaIdeal = Math.max(0, arredondar(ideal - saldo));
  const excessoIdeal = Math.max(0, arredondar(saldo - ideal));

  let situacao = "OK";

  if (saldo <= 0) {
    situacao = "SEM ESTOQUE";
  } else if (minimo > 0 && saldo <= minimo) {
    situacao = "CRÍTICO";
  } else if (ideal > 0 && saldo > ideal) {
    situacao = "ACIMA DO IDEAL";
  }

  return {
    ...item,
    saldo: arredondar(saldo),
    quantidade: arredondar(item.quantidade),
    estoque_minimo: arredondar(minimo),
    estoque_ideal: arredondar(ideal),
    falta_minimo: faltaMinimo,
    falta_ideal: faltaIdeal,
    excesso_ideal: excessoIdeal,
    situacao
  };
}

function somarQuantidade(linhas) {
  return arredondar(
    (linhas || []).reduce((soma, item) => {
      return soma + numero(item.quantidade);
    }, 0)
  );
}

function agruparSaidasPorProduto(saidas) {
  const mapa = new Map();

  for (const item of saidas || []) {
    const nome = item.produto || "Produto não informado";

    const atual = mapa.get(nome) || {
      produto: nome,
      quantidade: 0,
      registros: 0
    };

    atual.quantidade += numero(item.quantidade);
    atual.registros += 1;

    mapa.set(nome, atual);
  }

  return [...mapa.values()]
    .map(item => ({
      ...item,
      quantidade: arredondar(item.quantidade)
    }))
    .sort((a, b) => numero(b.quantidade) - numero(a.quantidade));
}

// ======================================================
// RESPOSTAS
// ======================================================

function responderResumo(resumo) {
  return [
    "Resumo do estoque:",
    "",
    `Produtos: ${formatarNumero(resumo.total_produtos || 0)}.`,
    `Ativos: ${formatarNumero(resumo.total_ativos || 0)}.`,
    `Inativos: ${formatarNumero(resumo.total_inativos || 0)}.`,
    `Saldo total: ${formatarNumero(resumo.saldo_total || 0)}.`
  ].join("\n");
}

function responderProduto(produto, encontrados, periodo) {
  if (!produto) {
    return "Não encontrei esse produto no estoque.";
  }

  const p = enriquecerProduto(produto);

  const linhas = [];

  linhas.push(`${p.produto}`);
  linhas.push("");
  linhas.push(`Saldo atual: ${formatarNumero(p.saldo)} ${p.unidade || ""}.`);
  linhas.push(`Situação: ${p.situacao}.`);

  if (p.local_saida) {
    linhas.push(`Local de saída: ${p.local_saida}.`);
  }

  if (p.empresa) {
    linhas.push(`Empresa: ${p.empresa}.`);
  }

  if (p.und_compra) {
    linhas.push(`Compra em: ${p.und_compra}.`);
  }

  if (numero(p.qtd_unidades) > 0) {
    linhas.push(`Vem com ${formatarNumero(p.qtd_unidades)} unidade(s).`);
  }

  if (numero(p.estoque_minimo) > 0) {
    linhas.push(`Estoque mínimo: ${formatarNumero(p.estoque_minimo)}.`);
  }

  if (numero(p.estoque_ideal) > 0) {
    linhas.push(`Estoque ideal: ${formatarNumero(p.estoque_ideal)}.`);
  }

  if (p.falta_minimo > 0) {
    linhas.push(`Falta para o mínimo: ${formatarNumero(p.falta_minimo)}.`);
  }

  if (p.falta_ideal > 0) {
    linhas.push(`Falta para o ideal: ${formatarNumero(p.falta_ideal)}.`);
  }

  if (p.excesso_ideal > 0) {
    linhas.push(`Acima do ideal em: ${formatarNumero(p.excesso_ideal)}.`);
  }

  if (encontrados.length > 1) {
    linhas.push("");
    linhas.push("Também encontrei itens parecidos:");

    encontrados.slice(0, 5).forEach(item => {
      if (item.id !== produto.id) {
        linhas.push(`- ${item.produto}: ${formatarNumero(item.saldo)} ${item.unidade || ""}`);
      }
    });
  }

  return linhas.join("\n");
}

function responderLista(titulo, itens) {
  if (!itens.length) {
    return `${titulo}\n\nNenhum item encontrado.`;
  }

  const linhas = [];

  linhas.push(titulo);
  linhas.push("");

  itens.forEach((item, index) => {
    const p = enriquecerProduto(item);

    linhas.push(
      `${index + 1}. ${p.produto} — saldo ${formatarNumero(p.saldo)} ${p.unidade || ""} | mínimo ${formatarNumero(p.estoque_minimo)} | ideal ${formatarNumero(p.estoque_ideal)} | ${p.local_saida || "sem local"}`
    );
  });

  return linhas.join("\n");
}

function responderSaidas(produtoNome, saidas, periodo) {
  if (!saidas.length) {
    return `Não encontrei saída de ${produtoNome || "produtos"} em ${periodo.label}.`;
  }

  const total = somarQuantidade(saidas);

  const linhas = [];

  linhas.push(`Saídas de estoque`);
  linhas.push(`Período: ${periodo.label}`);
  linhas.push("");

  if (produtoNome) {
    linhas.push(`Produto: ${produtoNome}`);
    linhas.push(`Total de saída: ${formatarNumero(total)}.`);
    linhas.push("");

    saidas.slice(0, 15).forEach(item => {
      linhas.push(
        `- ${labelDataBR(String(item.created_at || "").slice(0, 10))}: ${formatarNumero(item.quantidade)} | ${item.status || ""} | ${item.setor || ""} | ${item.solicitante || ""}`
      );
    });
  } else {
    const agrupado = agruparSaidasPorProduto(saidas);

    linhas.push(`Total movimentado: ${formatarNumero(total)}.`);
    linhas.push("");

    agrupado.slice(0, 20).forEach((item, index) => {
      linhas.push(`${index + 1}. ${item.produto}: ${formatarNumero(item.quantidade)}`);
    });
  }

  return linhas.join("\n");
}

function responderEntradas(produto, entradas, periodo) {
  if (!entradas.length) {
    return `Não encontrei entradas de ${produto?.produto || "produtos"} em ${periodo.label}.`;
  }

  const total = somarQuantidade(entradas);

  const linhas = [];

  linhas.push(`Entradas de estoque`);
  linhas.push(`Período: ${periodo.label}`);
  linhas.push("");

  if (produto?.produto) {
    linhas.push(`Produto: ${produto.produto}`);
  }

  linhas.push(`Total de entrada: ${formatarNumero(total)}.`);
  linhas.push("");

  entradas.slice(0, 15).forEach(item => {
    linhas.push(
      `- ${labelDataBR(String(item.created_at || "").slice(0, 10))}: ${formatarNumero(item.quantidade)} | antes ${formatarNumero(item.estoque_antes)} | depois ${formatarNumero(item.estoque_depois)} | ${item.observacao || ""}`
    );
  });

  return linhas.join("\n");
}

function responderLocal(produto) {
  if (!produto) {
    return "Não encontrei esse produto para informar o local.";
  }

  const p = enriquecerProduto(produto);

  return [
    `${p.produto}`,
    "",
    `Local de saída: ${p.local_saida || "não informado"}.`,
    `Empresa: ${p.empresa || "não informada"}.`,
    `Saldo: ${formatarNumero(p.saldo)} ${p.unidade || ""}.`,
    `Situação: ${p.situacao}.`
  ].join("\n");
}

function responderParametros(produto) {
  if (!produto) {
    return "Não encontrei esse produto para informar mínimo e ideal.";
  }

  const p = enriquecerProduto(produto);

  return [
    `${p.produto}`,
    "",
    `Saldo atual: ${formatarNumero(p.saldo)} ${p.unidade || ""}.`,
    `Estoque mínimo: ${formatarNumero(p.estoque_minimo)}.`,
    `Estoque ideal: ${formatarNumero(p.estoque_ideal)}.`,
    `Falta para mínimo: ${formatarNumero(p.falta_minimo)}.`,
    `Falta para ideal: ${formatarNumero(p.falta_ideal)}.`,
    `Situação: ${p.situacao}.`
  ].join("\n");
}

// ======================================================
// HISTÓRICO
// ======================================================

async function salvarHistorico({ pergunta, resposta, dados }) {
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
          agente: "AGENTE_ESTOQUE",
          empresa: dados?.empresa || null,
          contexto: dados || null,
          created_at: new Date().toISOString()
        }
      ]);
  } catch (e) {
    console.log("ERRO AO SALVAR HISTÓRICO ESTOQUE:", e.message);
  }
}

// ======================================================
// HANDLER
// ======================================================

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const body = parseBody(req);

    const pergunta =
      body.pergunta ||
      body.mensagem ||
      body.texto ||
      req.query.pergunta ||
      req.query.q ||
      "";

    if (!pergunta) {
      return res.status(400).json({
        ok: false,
        erro: "Pergunta não informada.",
        exemplo: "Quanto tem de arroz no estoque?"
      });
    }

    const periodo = interpretarPeriodo(pergunta, body);
    const intencao = interpretarIntencao(pergunta);
    const produtoBusca = extrairProdutoDaPergunta(pergunta, body);
    const local_saida = identificarLocal(pergunta, body);
    const empresa = identificarEmpresa(pergunta, body);

    const limite = Math.min(
      Number(body.limite || req.query.limite || REQUEST_LIMIT_PADRAO),
      REQUEST_LIMIT_MAX
    );

    let resposta = "";
    let dados = {
      intencao,
      produto_busca: produtoBusca,
      local_saida,
      empresa,
      periodo,
      limite
    };

    if (intencao === "resumo") {
      const resumo = await buscarResumoEstoque();

      resposta = responderResumo(resumo);

      dados.resumo = resumo;
    }

    else if (intencao === "sem_estoque") {
      const itens = await buscarProdutosSemEstoque({
        local_saida,
        empresa,
        limite
      });

      resposta = responderLista("Produtos sem estoque", itens);

      dados.itens = itens.map(enriquecerProduto);
    }

    else if (intencao === "criticos") {
      const itens = await buscarProdutosCriticos({
        local_saida,
        empresa,
        limite
      });

      resposta = responderLista("Produtos críticos / abaixo do mínimo", itens);

      dados.itens = itens.map(enriquecerProduto);
    }

    else if (intencao === "excesso") {
      const itens = await buscarProdutosExcesso({
        local_saida,
        empresa,
        limite
      });

      resposta = responderLista("Produtos acima do ideal", itens);

      dados.itens = itens.map(enriquecerProduto);
    }

    else if (intencao === "saidas") {
      const saidas = await buscarSaidasProduto({
        produtoNome: produtoBusca,
        periodo
      });

      resposta = responderSaidas(produtoBusca, saidas, periodo);

      dados.saidas = saidas;
      dados.total_saida = somarQuantidade(saidas);
    }

    else if (intencao === "entradas") {
      const encontrado = await buscarProdutoMaisProvavel({
        produto: produtoBusca,
        local_saida,
        empresa
      });

      const entradas = await buscarEntradasProduto({
        produtoId: encontrado.produto?.id || null,
        periodo
      });

      resposta = responderEntradas(encontrado.produto, entradas, periodo);

      dados.produto = encontrado.produto ? enriquecerProduto(encontrado.produto) : null;
      dados.entradas = entradas;
      dados.total_entrada = somarQuantidade(entradas);
    }

    else if (intencao === "movimentacoes") {
      const encontrado = await buscarProdutoMaisProvavel({
        produto: produtoBusca,
        local_saida,
        empresa
      });

      const movimentacoes = await buscarHistoricoMovimentacoes({
        produtoId: encontrado.produto?.id || null,
        periodo
      });

      resposta = responderEntradas(encontrado.produto, movimentacoes, periodo);

      dados.produto = encontrado.produto ? enriquecerProduto(encontrado.produto) : null;
      dados.movimentacoes = movimentacoes;
    }

    else if (intencao === "local") {
      const encontrado = await buscarProdutoMaisProvavel({
        produto: produtoBusca,
        local_saida,
        empresa
      });

      resposta = responderLocal(encontrado.produto);

      dados.produto = encontrado.produto ? enriquecerProduto(encontrado.produto) : null;
      dados.encontrados = encontrado.encontrados.map(enriquecerProduto);
    }

    else if (intencao === "parametros") {
      const encontrado = await buscarProdutoMaisProvavel({
        produto: produtoBusca,
        local_saida,
        empresa
      });

      resposta = responderParametros(encontrado.produto);

      dados.produto = encontrado.produto ? enriquecerProduto(encontrado.produto) : null;
      dados.encontrados = encontrado.encontrados.map(enriquecerProduto);
    }

    else {
      const encontrado = await buscarProdutoMaisProvavel({
        produto: produtoBusca,
        local_saida,
        empresa
      });

      resposta = responderProduto(
        encontrado.produto,
        encontrado.encontrados,
        periodo
      );

      dados.produto = encontrado.produto ? enriquecerProduto(encontrado.produto) : null;
      dados.encontrados = encontrado.encontrados.map(enriquecerProduto);
    }

    await salvarHistorico({
      pergunta,
      resposta,
      dados
    });

    return res.status(200).json({
      ok: true,
      agente: "AGENTE_ESTOQUE",
      pergunta,
      resposta,
      dados,
      fontes: {
        produtos: "mercatto_estoque",
        resumo: "vw_resumo_estoque",
        saidas: "mercatto_requisicoes",
        entradas: "movimentacoes_estoque"
      }
    });

  } catch (e) {
    console.error("ERRO API ESTOQUE:", e);

    return res.status(500).json({
      ok: false,
      agente: "AGENTE_ESTOQUE",
      erro: e.message || "Erro interno na API de estoque."
    });
  }
};
