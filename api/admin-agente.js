// ======================================================
// 🚀 OTTO • ORQUESTRADOR CENTRAL
// PROMPT ÚNICO NO SUPABASE
// HASHTAG = /api/sistema-otto/{hashtag}
// API: /api/admin-agente
// COM TIMEOUT TOTAL MÁXIMO DE 1 MINUTO
// ======================================================

const OpenAI = require("openai")

const {
  createClient
} = require("@supabase/supabase-js")

const fetch = (...args) =>
  import("node-fetch")
    .then(({ default: fetch }) => fetch(...args))

// ======================================================
// CONFIG VERCEL / NEXT API
// EVITA 413 QUANDO O INDEX MANDAR CONTEXTO MAIOR
// ======================================================

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb"
    }
  }
}

// ======================================================
// AMBIENTE
// ======================================================

if(!process.env.SUPABASE_URL){
  throw new Error("SUPABASE_URL não configurada")
}

if(!process.env.SUPABASE_SERVICE_ROLE){
  throw new Error("SUPABASE_SERVICE_ROLE não configurada")
}

if(!process.env.OPENAI_API_KEY){
  throw new Error("OPENAI_API_KEY não configurada")
}

// ======================================================
// CLIENTES
// ======================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  {
    auth: {
      persistSession: false
    }
  }
)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// ======================================================
// CONFIG
// ======================================================

const TIMEZONE = "America/Bahia"

const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini"

const NOME_PARAMETRO_PROMPT =
  process.env.OTTO_PARAMETRO_PROMPT ||
  "otto_prompt_direcionamento"

// Tempo total nunca deve passar de 1 minuto
const TIMEOUT_TOTAL_MS =
  Number(process.env.OTTO_TIMEOUT_TOTAL_MS || 59000)

// Tempo máximo para buscar prompt
const TIMEOUT_SUPABASE_MS =
  Number(process.env.OTTO_TIMEOUT_SUPABASE_MS || 8000)

// Tempo máximo para IA escolher hashtag
const TIMEOUT_OPENAI_MS =
  Number(process.env.OTTO_TIMEOUT_OPENAI_MS || 12000)

// Tempo máximo para agente responder
const TIMEOUT_AGENTE_MS =
  Math.min(
    Number(process.env.OTTO_TIMEOUT_AGENTE_MS || 42000),
    55000
  )

// Fallback quando a IA falhar ou retornar hashtag inválida
const HASHTAG_FALLBACK = "#principal"

// Limite de texto para não estourar payload interno
const LIMITE_TEXTO_PERGUNTA = 8000
const LIMITE_TEXTO_CONTEXTO = 12000

// ======================================================
// HELPERS GERAIS
// ======================================================

function normalizar(texto){
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function limitarTexto(valor, limite){
  const texto = String(valor || "")

  if(texto.length <= limite){
    return texto
  }

  return texto.slice(0, limite) + "\n\n[CONTEÚDO CORTADO PELO OTTO CENTRAL PARA EVITAR PAYLOAD GRANDE]"
}

function limitarObjeto(objeto, limite){
  try{
    const json = JSON.stringify(objeto || {})

    if(json.length <= limite){
      return objeto || {}
    }

    return {
      aviso: "Contexto reduzido pelo OTTO Central para evitar payload grande.",
      resumo: json.slice(0, limite)
    }
  }catch(e){
    return {
      aviso: "Contexto inválido ou circular. Foi removido pelo OTTO Central."
    }
  }
}

function parseBody(req){
  if(!req.body){
    return {}
  }

  if(typeof req.body === "string"){
    try{
      return JSON.parse(req.body || "{}")
    }catch(e){
      return {}
    }
  }

  return req.body
}

function montarOrigin(req){
  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    ""

  const proto =
    req.headers["x-forwarded-proto"] ||
    "https"

  if(req.headers.origin){
    return req.headers.origin
  }

  if(host){
    return `${proto}://${host}`
  }

  if(process.env.VERCEL_URL){
    return `https://${process.env.VERCEL_URL}`
  }

  return ""
}

function hojeBahiaISO(){
  const partes = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).formatToParts(new Date())

  const get = tipo =>
    partes.find(p => p.type === tipo)?.value

  return `${get("year")}-${get("month")}-${get("day")}`
}

function agoraBahia(){
  return new Date(
    new Date().toLocaleString(
      "en-US",
      {
        timeZone: TIMEZONE
      }
    )
  )
}

function limparHashtag(valor){
  const texto = String(valor || "")
  const match = texto.match(/#[a-zA-Z0-9_-]+/)

  if(!match){
    return ""
  }

  return normalizar(match[0])
}

function hashtagParaEndpoint(hashtag){
  const limpa = limparHashtag(hashtag)

  if(!limpa){
    return null
  }

  const slug = limpa
    .replace("#", "")
    .replace(/_/g, "-")

  return `/api/sistema-otto/${slug}`
}

function hashtagParaNomeAgente(hashtag){
  const limpa = limparHashtag(hashtag)

  if(!limpa){
    return "AGENTE_DESCONHECIDO"
  }

  const slug = limpa
    .replace("#", "")
    .replace(/-/g, "_")
    .toUpperCase()

  return `AGENTE_${slug}`
}

function erroTimeout(nome, ms){
  const err = new Error(`${nome} demorou demais e foi encerrado. Limite: ${Math.round(ms / 1000)}s.`)
  err.code = "OTTO_TIMEOUT"
  return err
}

function comTimeout(promise, ms, nome){
  let timer = null

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(erroTimeout(nome, ms))
    }, ms)
  })

  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    if(timer){
      clearTimeout(timer)
    }
  })
}

function criarAbortController(timeoutMs){
  const controller = new AbortController()

  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  return {
    controller,
    timer
  }
}

function responderJSON(res, status, payload){
  if(res.headersSent){
    return
  }

  return res.status(status).json(payload)
}

// ======================================================
// LOG BONITO
// ======================================================

function logInfo(titulo, dados){
  try{
    console.log(`\n==============================`)
    console.log(titulo)
    console.log(JSON.stringify(dados, null, 2))
    console.log(`==============================\n`)
  }catch(e){
    console.log(titulo, dados)
  }
}

function logErro(titulo, erro){
  console.log(`\n❌ ${titulo}`)
  console.log({
    message: erro?.message,
    code: erro?.code,
    name: erro?.name,
    stack: erro?.stack
  })
}

// ======================================================
// BUSCAR PROMPT ÚNICO NO SUPABASE
// ======================================================

async function buscarPromptDirecionamento(){
  const exec = async () => {
    const {
      data,
      error
    } = await supabase
      .from("parametros_sistema")
      .select("dados")
      .eq("nome_parametro", NOME_PARAMETRO_PROMPT)
      .eq("ativo", true)
      .maybeSingle()

    if(error){
      throw new Error(`Erro ao buscar prompt no Supabase: ${error.message}`)
    }

    const prompt =
      data?.dados?.prompt_comando ||
      data?.dados?.prompt ||
      data?.dados?.ensinamento ||
      ""

    if(!String(prompt).trim()){
      throw new Error("Prompt de direcionamento não encontrado em parametros_sistema.")
    }

    return String(prompt).trim()
  }

  return comTimeout(
    exec(),
    TIMEOUT_SUPABASE_MS,
    "Busca do prompt no Supabase"
  )
}

// ======================================================
// IA ESCOLHE SOMENTE UMA HASHTAG
// ======================================================

async function escolherHashtag({
  pergunta,
  promptComando,
  contexto
}){
  const perguntaLimpa = limitarTexto(pergunta, LIMITE_TEXTO_PERGUNTA)
  const contextoLimpo = limitarObjeto(contexto, LIMITE_TEXTO_CONTEXTO)

  const exec = async () => {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 30,
      messages: [
        {
          role: "system",
          content:
            "Você é o OTTO Central. Use exclusivamente o prompt fornecido pelo Supabase para escolher uma única hashtag. Tudo que começa com # é uma rota. Responda somente com uma hashtag. Não explique nada."
        },
        {
          role: "user",
          content:
`${promptComando}

PERGUNTA:
${perguntaLimpa}

CONTEXTO:
${JSON.stringify(contextoLimpo, null, 2)}

Escolha agora somente uma hashtag.`
        }
      ]
    })

    const resposta =
      completion
        ?.choices
        ?.[0]
        ?.message
        ?.content ||
      ""

    const hashtag = limparHashtag(resposta)

    if(!hashtag){
      throw new Error(`A IA não retornou uma hashtag válida. Resposta recebida: ${resposta}`)
    }

    return hashtag
  }

  return comTimeout(
    exec(),
    TIMEOUT_OPENAI_MS,
    "Escolha da hashtag pela IA"
  )
}

// ======================================================
// ESCOLHER HASHTAG COM FALLBACK
// ======================================================

async function escolherHashtagSegura({
  pergunta,
  promptComando,
  contexto
}){
  try{
    return await escolherHashtag({
      pergunta,
      promptComando,
      contexto
    })
  }catch(e){
    logErro("Falha ao escolher hashtag. Usando fallback #principal.", e)
    return HASHTAG_FALLBACK
  }
}

// ======================================================
// LER RESPOSTA HTTP SEM BODY USED ALREADY
// ======================================================

async function lerRespostaHTTP(resposta){
  const texto = await resposta.text()

  if(!texto){
    return {}
  }

  try{
    return JSON.parse(texto)
  }catch(e){
    return {
      resposta: texto
    }
  }
}

// ======================================================
// EXTRAIR RESPOSTA FINAL DO AGENTE
// ======================================================

function extrairRespostaFinal(data){
  if(!data){
    return ""
  }

  if(typeof data === "string"){
    return data
  }

  return (
    data?.resposta ||
    data?.mensagem ||
    data?.texto ||
    data?.resultado ||
    data?.data?.resposta ||
    data?.data?.mensagem ||
    data?.retorno ||
    ""
  )
}

// ======================================================
// CHAMAR ROTA GERADA PELA HASHTAG
// ======================================================

async function chamarRota({
  pergunta,
  contexto,
  origin,
  hashtag,
  endpoint,
  agente
}){
  const timeout = Math.min(TIMEOUT_AGENTE_MS, 55000)

  const {
    controller,
    timer
  } = criarAbortController(timeout)

  try{
    if(!origin){
      throw new Error("Origin não identificado para montar a rota final.")
    }

    const url = `${origin}${endpoint}`

    const payload = {
      pergunta: limitarTexto(pergunta, LIMITE_TEXTO_PERGUNTA),
      mensagem: limitarTexto(pergunta, LIMITE_TEXTO_PERGUNTA),
      texto: limitarTexto(pergunta, LIMITE_TEXTO_PERGUNTA),

      telefone: contexto?.telefone || "",
      numero: contexto?.telefone || "",
      nome: contexto?.nome || "",
      empresa: contexto?.empresa || "",
      usuario_id: contexto?.usuario_id || null,

      data: contexto?.data || hojeBahiaISO(),
      hoje: contexto?.hoje || hojeBahiaISO(),
      timezone: TIMEZONE,

      origem: "OTTO_CENTRAL",
      hashtag,
      agente_origem: agente,

      contexto: limitarObjeto(contexto, LIMITE_TEXTO_CONTEXTO)
    }

    logInfo("🤖 OTTO CENTRAL ENVIANDO", {
      pergunta: payload.pergunta,
      hashtag,
      agente,
      rota: url,
      timeout_ms: timeout
    })

    const resposta = await fetch(
      url,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-otto-origem": "OTTO_CENTRAL",
          "x-otto-timeout-ms": String(timeout)
        },
        body: JSON.stringify(payload)
      }
    )

    const data = await lerRespostaHTTP(resposta)

    if(!resposta.ok){
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
        bruto: data
      }
    }

    const respostaFinal = extrairRespostaFinal(data)

    return {
      ok: true,
      status: resposta.status,
      hashtag,
      agente,
      endpoint,
      resposta:
        respostaFinal ||
        JSON.stringify(data),
      bruto: data
    }

  }catch(e){
    const abortado =
      e.name === "AbortError" ||
      e.code === "ABORT_ERR"

    return {
      ok: false,
      hashtag,
      agente,
      endpoint,
      erro: abortado
        ? `Tempo excedido. O agente ${endpoint} demorou demais e a busca foi derrubada.`
        : e.message
    }
  }finally{
    clearTimeout(timer)
  }
}

// ======================================================
// SALVAR HISTÓRICO
// NÃO PODE TRAVAR A RESPOSTA FINAL
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
}){
  try{
    await comTimeout(
      supabase
        .from("otto_historico")
        .insert([
          {
            pergunta: limitarTexto(pergunta || "", 12000),
            resposta: limitarTexto(resposta || "", 12000),
            agente: agente || "OTTO_CENTRAL",
            hashtag: hashtag || null,
            endpoint: endpoint || null,
            contexto: limitarObjeto(contexto || {}, 12000),
            roteamento: limitarObjeto(roteamento || {}, 12000),
            resposta_agente: limitarObjeto(resposta_agente || {}, 12000),
            created_at: new Date().toISOString()
          }
        ]),
      5000,
      "Salvar histórico OTTO"
    )
  }catch(e){
    logErro("ERRO AO SALVAR HISTÓRICO OTTO", e)
  }
}

// ======================================================
// MONTAR CONTEXTO
// ======================================================

function montarContexto(body){
  const contextoRecebido =
    body?.contexto &&
    typeof body.contexto === "object"
      ? body.contexto
      : {}

  return {
    telefone:
      body?.telefone ||
      body?.numero ||
      contextoRecebido?.telefone ||
      contextoRecebido?.numero ||
      "",

    nome:
      body?.nome ||
      contextoRecebido?.nome ||
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
      TIMEZONE
  }
}

// ======================================================
// EXECUÇÃO PRINCIPAL
// ======================================================

async function executarOttoCentral(req, res){
  // ====================================================
  // CORS
  // ====================================================

  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if(req.method === "OPTIONS"){
    return res.status(200).end()
  }

  // ====================================================
  // MÉTODO
  // ====================================================

  if(req.method !== "POST"){
    return responderJSON(
      res,
      405,
      {
        ok: false,
        erro: "Método não permitido. Use POST."
      }
    )
  }

  // ====================================================
  // BODY
  // ====================================================

  const body = parseBody(req)

  const perguntaOriginal =
    body?.pergunta ||
    body?.mensagem ||
    body?.texto ||
    ""

  const pergunta = limitarTexto(perguntaOriginal, LIMITE_TEXTO_PERGUNTA)

  if(!String(pergunta).trim()){
    return responderJSON(
      res,
      400,
      {
        ok: false,
        erro: "Pergunta não informada."
      }
    )
  }

  const contexto = montarContexto(body)
  const origin = montarOrigin(req)

  const inicio = Date.now()

  // ====================================================
  // BUSCA PROMPT
  // ====================================================

  let promptComando = ""

  try{
    promptComando = await buscarPromptDirecionamento()
  }catch(e){
    logErro("Erro ao buscar prompt. Usando fallback para #principal.", e)

    promptComando = `
Você é o OTTO Central.
Quando não souber exatamente qual agente usar, responda #principal.
Para conversa normal, saudação, ajuda geral ou pergunta sem agente específico, responda #principal.
`
  }

  // ====================================================
  // ESCOLHE HASHTAG
  // ====================================================

  const hashtag = await escolherHashtagSegura({
    pergunta,
    promptComando,
    contexto
  })

  // ====================================================
  // MONTA ROTA
  // ====================================================

  const endpoint =
    hashtagParaEndpoint(hashtag) ||
    hashtagParaEndpoint(HASHTAG_FALLBACK)

  const agente =
    hashtagParaNomeAgente(hashtag)

  // ====================================================
  // CHAMA AGENTE
  // ====================================================

  const respostaAgente = await chamarRota({
    pergunta,
    contexto,
    origin,
    hashtag,
    endpoint,
    agente
  })

  const respostaFinal =
    respostaAgente?.resposta ||
    respostaAgente?.erro ||
    "Sem resposta do agente."

  const duracaoMs = Date.now() - inicio

  // ====================================================
  // SALVAR HISTÓRICO SEM TRAVAR MUITO
  // ====================================================

  await salvarHistorico({
    pergunta,
    resposta: respostaFinal,
    agente,
    hashtag,
    endpoint,
    contexto: {
      ...contexto,
      origin,
      duracao_ms: duracaoMs
    },
    roteamento: {
      pergunta,
      hashtag,
      endpoint,
      agente,
      regra: "hashtag_completa_api_sistema_otto",
      timeout_total_ms: TIMEOUT_TOTAL_MS,
      timeout_agente_ms: TIMEOUT_AGENTE_MS,
      duracao_ms: duracaoMs
    },
    resposta_agente: respostaAgente
  })

  // ====================================================
  // RETORNO
  // ====================================================

  return responderJSON(
    res,
    200,
    {
      ok: respostaAgente.ok === true,
      pergunta,
      resposta: respostaFinal,

      roteamento: {
        hashtag,
        endpoint,
        agente
      },

      agente: respostaAgente,

      tempo: {
        duracao_ms: duracaoMs,
        limite_total_ms: TIMEOUT_TOTAL_MS,
        limite_agente_ms: TIMEOUT_AGENTE_MS
      },

      hoje: hojeBahiaISO(),
      timezone: TIMEZONE,
      timestamp: new Date().toISOString(),
      agora_bahia: agoraBahia().toISOString()
    }
  )
}

// ======================================================
// HANDLER COM TIMEOUT GLOBAL
// ======================================================

module.exports = async function handler(req, res){
  const inicioGlobal = Date.now()

  let timerGlobal = null

  const timeoutGlobalPromise = new Promise(resolve => {
    timerGlobal = setTimeout(() => {
      resolve({
        timeout: true
      })
    }, TIMEOUT_TOTAL_MS)
  })

  try{
    const execPromise = executarOttoCentral(req, res)

    const resultado = await Promise.race([
      execPromise,
      timeoutGlobalPromise
    ])

    if(resultado?.timeout === true){
      const duracaoMs = Date.now() - inicioGlobal

      console.log("⏱️ OTTO CENTRAL: TIMEOUT GLOBAL ATINGIDO", {
        duracao_ms: duracaoMs,
        limite_ms: TIMEOUT_TOTAL_MS
      })

      if(!res.headersSent){
        return responderJSON(
          res,
          504,
          {
            ok: false,
            erro: true,
            mensagem: "A busca demorou demais e foi derrubada automaticamente. Limite máximo: 1 minuto.",
            resposta: "A busca demorou demais e foi encerrada para não travar o OTTO. Tente uma pergunta mais direta ou peça um relatório menor.",
            timeout: true,
            limite_ms: TIMEOUT_TOTAL_MS,
            duracao_ms: duracaoMs,
            hoje: hojeBahiaISO(),
            timezone: TIMEZONE,
            timestamp: new Date().toISOString()
          }
        )
      }

      return
    }

    return resultado

  }catch(err){
    logErro("ERRO OTTO CENTRAL", err)

    if(!res.headersSent){
      return responderJSON(
        res,
        500,
        {
          ok: false,
          erro: true,
          mensagem: err.message,
          resposta: "Ocorreu um erro no OTTO Central antes de concluir a resposta.",
          hoje: hojeBahiaISO(),
          timezone: TIMEZONE,
          timestamp: new Date().toISOString()
        }
      )
    }

  }finally{
    if(timerGlobal){
      clearTimeout(timerGlobal)
    }
  }
}
