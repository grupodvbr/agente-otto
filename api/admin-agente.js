// ======================================================
// 🚀 OTTO • ORQUESTRADOR CENTRAL
// PROMPT ÚNICO NO SUPABASE
// HASHTAG = /api/sistema-otto/{hashtag}
// API: /api/admin-agente
// ======================================================

const OpenAI =
require("openai")

const {
  createClient
} = require("@supabase/supabase-js")

const fetch = (...args) =>
  import("node-fetch")
    .then(({ default: fetch }) => fetch(...args));

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

const supabase =
createClient(

  process.env.SUPABASE_URL,

  process.env.SUPABASE_SERVICE_ROLE,

  {
    auth:{
      persistSession:false
    }
  }

)

const openai =
new OpenAI({

  apiKey:
  process.env.OPENAI_API_KEY

})

// ======================================================
// CONFIG
// ======================================================

const TIMEZONE =
"America/Bahia"

const OPENAI_MODEL =
process.env.OPENAI_MODEL ||
"gpt-4.1-mini"

const NOME_PARAMETRO_PROMPT =
"otto_prompt_direcionamento"

const TIMEOUT_AGENTE_MS =
Number(process.env.OTTO_TIMEOUT_AGENTE_MS || 30000)

// ======================================================
// HELPERS
// ======================================================

function normalizar(texto){

  return String(texto || "")

  .normalize("NFD")

  .replace(
    /[\u0300-\u036f]/g,
    ""
  )

  .toLowerCase()

  .trim()

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

  if(req.headers.origin){

    return req.headers.origin

  }

  if(req.headers.host){

    return `https://${req.headers.host}`

  }

  if(process.env.VERCEL_URL){

    return `https://${process.env.VERCEL_URL}`

  }

  return ""

}

function hojeBahiaISO(){

  const partes =
  new Intl.DateTimeFormat(

    "en-CA",

    {
      timeZone:
      TIMEZONE,

      year:
      "numeric",

      month:
      "2-digit",

      day:
      "2-digit"
    }

  ).formatToParts(new Date())

  const get = tipo =>
  partes.find(p=>p.type === tipo)?.value

  return `${get("year")}-${get("month")}-${get("day")}`

}

function agoraBahia(){

  return new Date(

    new Date().toLocaleString(

      "en-US",

      {
        timeZone:
        TIMEZONE
      }

    )

  )

}

function limparHashtag(valor){

  const texto =
  String(valor || "")

  const match =
  texto.match(/#[a-zA-Z0-9_-]+/)

  if(!match){

    return ""

  }

  return normalizar(match[0])

}

function hashtagParaEndpoint(hashtag){

  const limpa =
  limparHashtag(hashtag)

  if(!limpa){

    return null

  }

  const slug =
  limpa

  .replace("#","")

  .replace(/_/g,"-")

  return `/api/sistema-otto/${slug}`

}

function hashtagParaNomeAgente(hashtag){

  const limpa =
  limparHashtag(hashtag)

  if(!limpa){

    return "AGENTE_DESCONHECIDO"

  }

  const slug =
  limpa
  .replace("#","")
  .replace(/-/g,"_")
  .toUpperCase()

  return `AGENTE_${slug}`

}

function criarAbortController(timeoutMs){

  const controller =
  new AbortController()

  const timer =
  setTimeout(()=>{

    controller.abort()

  },timeoutMs)

  return {
    controller,
    timer
  }

}

// ======================================================
// BUSCAR PROMPT ÚNICO NO SUPABASE
// ======================================================

async function buscarPromptDirecionamento(){

  const {
    data,
    error
  } = await supabase

  .from("parametros_sistema")

  .select("dados")

  .eq(
    "nome_parametro",
    NOME_PARAMETRO_PROMPT
  )

  .eq(
    "ativo",
    true
  )

  .maybeSingle()

  if(error){

    throw new Error(
      `Erro ao buscar prompt no Supabase: ${error.message}`
    )

  }

  const prompt =

    data?.dados?.prompt_comando ||

    data?.dados?.prompt ||

    data?.dados?.ensinamento ||

    ""

  if(!String(prompt).trim()){

    throw new Error(
      "Prompt de direcionamento não encontrado em parametros_sistema."
    )

  }

  return String(prompt).trim()

}

// ======================================================
// IA ESCOLHE SOMENTE UMA HASHTAG
// ======================================================

async function escolherHashtag({

  pergunta,
  promptComando,
  contexto

}){

  const completion =
  await openai.chat.completions.create({

    model:
    OPENAI_MODEL,

    temperature:
    0,

    max_tokens:
    20,

    messages:[

      {
        role:"system",
        content:
        "Você é o OTTO Central. Use exclusivamente o prompt fornecido pelo Supabase para escolher uma única hashtag. Tudo que começa com # é uma rota. Responda somente com uma hashtag."
      },

      {
        role:"user",
        content:
`${promptComando}

PERGUNTA:
${pergunta}

CONTEXTO:
${JSON.stringify(contexto || {},null,2)}

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

  const hashtag =
  limparHashtag(resposta)

  if(!hashtag){

    throw new Error(
      `A IA não retornou uma hashtag válida. Resposta recebida: ${resposta}`
    )

  }

  return hashtag

}

// ======================================================
// LER RESPOSTA HTTP SEM BODY USED ALREADY
// ======================================================

async function lerRespostaHTTP(resposta){

  const texto =
  await resposta.text()

  if(!texto){

    return {}

  }

  try{

    return JSON.parse(texto)

  }catch(e){

    return {
      resposta:
      texto
    }

  }

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

  const {
    controller,
    timer
  } = criarAbortController(TIMEOUT_AGENTE_MS)

  try{

    if(!origin){

      throw new Error(
        "Origin não identificado para montar a rota final."
      )

    }

    const url =
    `${origin}${endpoint}`

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

    `)

    const resposta =
    await fetch(

      url,

      {
        method:
        "POST",

        signal:
        controller.signal,

        headers:{

          "Content-Type":
          "application/json"

        },

        body:
        JSON.stringify({

          pergunta,

          mensagem:
          pergunta,

          texto:
          pergunta,

          telefone:
          contexto?.telefone || "",

          numero:
          contexto?.telefone || "",

          nome:
          contexto?.nome || "",

          empresa:
          contexto?.empresa || "",

          usuario_id:
          contexto?.usuario_id || null,

          data:
          contexto?.data || hojeBahiaISO(),

          hoje:
          contexto?.hoje || hojeBahiaISO(),

          timezone:
          TIMEZONE,

          origem:
          "OTTO_CENTRAL",

          hashtag,

          agente_origem:
          agente,

          contexto

        })

      }

    )

    const data =
    await lerRespostaHTTP(resposta)

    if(!resposta.ok){

      return {

        ok:false,

        status:
        resposta.status,

        hashtag,

        agente,

        endpoint,

        erro:

          data?.erro ||

          data?.mensagem ||

          data?.message ||

          data?.resposta ||

          `Erro HTTP ${resposta.status}`

      }

    }

    return {

      ok:true,

      status:
      resposta.status,

      hashtag,

      agente,

      endpoint,

      resposta:

        data?.resposta ||

        data?.mensagem ||

        data?.texto ||

        data?.resultado ||

        JSON.stringify(data)

    }

  }catch(e){

    return {

      ok:false,

      hashtag,

      agente,

      endpoint,

      erro:
      e.name === "AbortError"

      ? `Tempo excedido ao chamar ${endpoint}`

      : e.message

    }

  }finally{

    clearTimeout(timer)

  }

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

}){

  try{

    await supabase

    .from("otto_historico")

    .insert([{

      pergunta:
      pergunta || "",

      resposta:
      resposta || "",

      agente:
      agente || "OTTO_CENTRAL",

      hashtag:
      hashtag || null,

      endpoint:
      endpoint || null,

      contexto:
      contexto || null,

      roteamento:
      roteamento || null,

      resposta_agente:
      resposta_agente || null,

      created_at:
      new Date().toISOString()

    }])

  }catch(e){

    console.log(
      "ERRO AO SALVAR HISTÓRICO OTTO:",
      e.message
    )

  }

}

// ======================================================
// HANDLER
// ======================================================

module.exports = async function handler(

  req,
  res

){

  try{

    // ====================================================
    // CORS
    // ====================================================

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    )

    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST,OPTIONS"
    )

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    )

    if(req.method === "OPTIONS"){

      return res.status(200).end()

    }

    // ====================================================
    // MÉTODO
    // ====================================================

    if(req.method !== "POST"){

      return res.status(405).json({

        ok:false,

        erro:
        "Método não permitido. Use POST."

      })

    }

    // ====================================================
    // BODY
    // ====================================================

    const body =
    parseBody(req)

    const pergunta =

      body?.pergunta ||

      body?.mensagem ||

      body?.texto ||

      ""

    if(!String(pergunta).trim()){

      return res.status(400).json({

        ok:false,

        erro:
        "Pergunta não informada."

      })

    }

    const contextoRecebido =

      body?.contexto &&
      typeof body.contexto === "object"

      ? body.contexto

      : {}

    const contexto = {

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

    const origin =
    montarOrigin(req)

    // ====================================================
    // BUSCA SOMENTE O PROMPT DO SUPABASE
    // ====================================================

    const promptComando =
    await buscarPromptDirecionamento()

    // ====================================================
    // ESCOLHE A HASHTAG PELO PROMPT DO SUPABASE
    // ====================================================

    const hashtag =
    await escolherHashtag({

      pergunta,

      promptComando,

      contexto

    })

    // ====================================================
    // COMPLETA A ROTA AUTOMATICAMENTE
    // ====================================================

    const endpoint =
    hashtagParaEndpoint(hashtag)

    if(!endpoint){

      return res.status(400).json({

        ok:false,

        erro:
        "Hashtag inválida retornada pelo roteador.",

        hashtag

      })

    }

    const agente =
    hashtagParaNomeAgente(hashtag)

    // ====================================================
    // CHAMA A ROTA
    // ====================================================

    const respostaAgente =
    await chamarRota({

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

    // ====================================================
    // HISTÓRICO
    // ====================================================

    await salvarHistorico({

      pergunta,

      resposta:
      respostaFinal,

      agente,

      hashtag,

      endpoint,

      contexto:{

        ...contexto,

        origin

      },

      roteamento:{

        pergunta,

        hashtag,

        endpoint,

        agente,

        regra:
        "hashtag_completa_api_sistema_otto"

      },

      resposta_agente:
      respostaAgente

    })

    // ====================================================
    // RETORNO
    // ====================================================

    return res.status(200).json({

      ok:
      respostaAgente.ok === true,

      pergunta,

      resposta:
      respostaFinal,

      roteamento:{

        hashtag,

        endpoint,

        agente

      },

      agente:
      respostaAgente,

      hoje:
      hojeBahiaISO(),

      timezone:
      TIMEZONE,

      timestamp:
      new Date().toISOString(),

      agora_bahia:
      agoraBahia().toISOString()

    })

  }catch(err){

    console.log(
      "ERRO OTTO CENTRAL:",
      err
    )

    return res.status(500).json({

      ok:false,

      erro:true,

      mensagem:
      err.message

    })

  }

}
