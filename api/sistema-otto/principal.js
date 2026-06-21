// ======================================================
// 🤖 OTTO • AGENTE PRINCIPAL EXECUTIVO
// CONVERSA NORMAL / MEMÓRIA / CONTEXTO / ANÁLISE
// ROTA: /api/sistema-otto/principal
// OBJETIVO: responder como pessoa, direto, sem enrolar
// ======================================================

const OpenAI =
require("openai")

const {
  createClient
} = require("@supabase/supabase-js")

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
process.env.OPENAI_MODEL_PRINCIPAL ||
process.env.OPENAI_MODEL ||
"gpt-4.1-mini"

const LIMITE_MEMORIAS_RELEVANTES =
Number(process.env.OTTO_LIMITE_MEMORIAS_RELEVANTES || 28)

const LIMITE_MEMORIAS_RECENTES =
Number(process.env.OTTO_LIMITE_MEMORIAS_RECENTES || 24)

const LIMITE_TEXTO_MEMORIA =
Number(process.env.OTTO_LIMITE_TEXTO_MEMORIA || 18000)

const LIMITE_MEMORIAS_CANVAS =
Number(process.env.OTTO_LIMITE_MEMORIAS_CANVAS || 10)

// ======================================================
// HELPERS DE DATA
// ======================================================

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
  partes.find(p => p.type === tipo)?.value

  return `${get("year")}-${get("month")}-${get("day")}`

}

function dataHoraBahiaTexto(){

  const data =
  new Intl.DateTimeFormat(
    "pt-BR",
    {
      timeZone:
      TIMEZONE,
      dateStyle:
      "full"
    }
  ).format(new Date())

  const hora =
  new Intl.DateTimeFormat(
    "pt-BR",
    {
      timeZone:
      TIMEZONE,
      hour:
      "2-digit",
      minute:
      "2-digit"
    }
  ).format(new Date())

  return `${data}, ${hora}`

}

function saudacaoPorHorario(){

  const hora =
  agoraBahia().getHours()

  if(hora >= 5 && hora < 12){

    return "Bom dia"

  }

  if(hora >= 12 && hora < 18){

    return "Boa tarde"

  }

  return "Boa noite"

}

// ======================================================
// HELPERS DE TEXTO
// ======================================================

function limparTexto(valor){

  return String(valor || "")
  .trim()

}

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

function limitarTexto(texto, limite){

  const valor =
  String(texto || "")

  if(valor.length <= limite){

    return valor

  }

  return valor.slice(0, limite) + "\n[texto cortado por limite de contexto]"

}

function escaparHTML(valor){

  return String(valor || "")

  .replace(/&/g, "&amp;")

  .replace(/</g, "&lt;")

  .replace(/>/g, "&gt;")

  .replace(/"/g, "&quot;")

  .replace(/'/g, "&#039;")

}

function primeiraLinha(texto){

  return String(texto || "")
  .split("\n")
  .map(linha => linha.trim())
  .find(Boolean) || ""

}

function removerMarkdownPesado(texto){

  return String(texto || "")
  .replace(/```/g, "")
  .replace(/\*\*/g, "")
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

function removerDuplicados(lista){

  return Array.from(
    new Set(
      (lista || [])
      .filter(Boolean)
      .map(item => String(item).trim())
      .filter(Boolean)
    )
  )

}

function textoCurto(texto, limite = 180){

  const valor =
  String(texto || "")
  .replace(/\s+/g, " ")
  .trim()

  if(valor.length <= limite){

    return valor

  }

  return valor.slice(0, limite) + "..."

}

// ======================================================
// DETECÇÃO DE INTENÇÃO
// ======================================================

function detectarTipoMensagem(pergunta){

  const texto =
  normalizar(pergunta)

  if(!texto){

    return "vazio"

  }

  const saudacoesExatas = [

    "oi",
    "ola",
    "olá",
    "bom dia",
    "boa tarde",
    "boa noite",
    "opa",
    "e ai",
    "e aí",
    "fala",
    "otto",
    "teste"

  ].map(normalizar)

  const agradecimentos = [

    "obrigado",
    "obrigada",
    "valeu",
    "show",
    "perfeito",
    "top",
    "beleza",
    "certo",
    "ok",
    "entendi",
    "otimo",
    "ótimo"

  ]

  const ajuda = [

    "me ajuda",
    "ajuda",
    "o que voce faz",
    "quem e voce",
    "como funciona",
    "o que posso perguntar",
    "quais agentes",
    "comandos",
    "como usar",
    "o que voce sabe fazer"

  ]

  const analise = [

    "analisa",
    "analise",
    "analisar",
    "cruza",
    "cruzar",
    "cruze",
    "compare",
    "comparar",
    "comparativo",
    "entenda",
    "resuma",
    "resumo",
    "relatorio",
    "relatório",
    "me explique",
    "explique",
    "o que aconteceu",
    "porque",
    "por que",
    "qual motivo",
    "descubra",
    "verifica",
    "verifique",
    "confere",
    "confira",
    "conclusao",
    "conclusão",
    "diagnostico",
    "diagnóstico",
    "causa",
    "causas",
    "problema",
    "inconsistencia",
    "inconsistência",
    "diferença",
    "diferenca"

  ]

  const memoria = [

    "lembra",
    "lembre",
    "memoria",
    "memória",
    "o que eu falei",
    "o que falei",
    "o que eu perguntei",
    "o que perguntei",
    "o que falamos",
    "o que conversamos",
    "ultima coisa",
    "última coisa",
    "ultima pergunta",
    "última pergunta",
    "ultima resposta",
    "última resposta",
    "mensagem anterior",
    "pergunta anterior",
    "resposta anterior",
    "ja falamos",
    "já falamos",
    "contexto",
    "historico",
    "histórico",
    "antes",
    "anterior"

  ]

  if(
    saudacoesExatas.includes(texto)
  ){

    return "saudacao"

  }

  if(
    agradecimentos.some(item =>
      texto === normalizar(item)
    )
  ){

    return "agradecimento"

  }

  if(
    memoria.some(item =>
      texto.includes(normalizar(item))
    )
  ){

    return "memoria"

  }

  if(
    analise.some(item =>
      texto.includes(normalizar(item))
    )
  ){

    return "analise"

  }

  if(
    ajuda.some(item =>
      texto.includes(normalizar(item))
    )
  ){

    return "ajuda"

  }

  return "conversa"

}

function detectarSentimento(pergunta){

  const texto =
  normalizar(pergunta)

  const irritado = [
    "porcaria",
    "raiva",
    "estressado",
    "estresse",
    "errado",
    "nao funciona",
    "não funciona",
    "droga",
    "bug",
    "problema",
    "pessimo",
    "péssimo",
    "ruim",
    "horrivel",
    "horrível",
    "lixo"
  ]

  const positivo = [
    "otimo",
    "ótimo",
    "perfeito",
    "show",
    "top",
    "excelente",
    "boa",
    "gostei",
    "certo"
  ]

  if(
    irritado.some(item =>
      texto.includes(normalizar(item))
    )
  ){

    return "irritado"

  }

  if(
    positivo.some(item =>
      texto.includes(normalizar(item))
    )
  ){

    return "positivo"

  }

  return "neutro"

}

function detectarCategoria(pergunta){

  const texto =
  normalizar(pergunta)

  const regras = [

    {
      categoria:
      "faturamento",
      termos:[
        "faturamento",
        "venda",
        "vendeu",
        "vendido",
        "ticket",
        "pix",
        "credito",
        "crédito",
        "débito",
        "debito",
        "dinheiro",
        "cartao",
        "cartão",
        "finalizadora"
      ]
    },

    {
      categoria:
      "metas",
      termos:[
        "meta",
        "meta prata",
        "meta ouro",
        "faltam",
        "falta para bater",
        "previsao",
        "previsão",
        "projecao",
        "projeção",
        "ideal do mes",
        "ideal do mês"
      ]
    },

    {
      categoria:
      "financeiro",
      termos:[
        "financeiro",
        "contas",
        "boleto",
        "boletos",
        "despesa",
        "despesas",
        "titulo",
        "título",
        "titulos",
        "títulos",
        "fornecedor",
        "trava",
        "pagamento",
        "recebimento"
      ]
    },

    {
      categoria:
      "rh",
      termos:[
        "funcionario",
        "funcionário",
        "colaborador",
        "rh",
        "advertencia",
        "advertência",
        "suspensao",
        "suspensão",
        "falta",
        "atraso",
        "ocorrencia",
        "ocorrência"
      ]
    },

    {
      categoria:
      "compras",
      termos:[
        "compra de rua",
        "compras de rua",
        "pedido de compra",
        "aprovar compra",
        "negar compra",
        "solicitacao de compra",
        "solicitação de compra"
      ]
    },

    {
      categoria:
      "cotacoes",
      termos:[
        "cotacao",
        "cotação",
        "fornecedor ganhou",
        "menor preco",
        "menor preço",
        "pdf fornecedor",
        "orcamento",
        "orçamento",
        "cotacoes",
        "cotações"
      ]
    },

    {
      categoria:
      "estoque",
      termos:[
        "estoque",
        "saldo",
        "produto",
        "validade",
        "vencimento",
        "entrada",
        "saida",
        "saída",
        "requisição",
        "requisicao"
      ]
    },

    {
      categoria:
      "marketing",
      termos:[
        "arte",
        "banner",
        "stories",
        "instagram",
        "logo",
        "imagem",
        "post",
        "marketing"
      ]
    },

    {
      categoria:
      "reservas",
      termos:[
        "reserva",
        "reservas",
        "mesa",
        "sala vip",
        "sacada",
        "cliente reservado"
      ]
    },

    {
      categoria:
      "whatsapp",
      termos:[
        "whatsapp",
        "template",
        "mensagem",
        "webhook",
        "campanha"
      ]
    },

    {
      categoria:
      "operacional",
      termos:[
        "operacao",
        "operação",
        "dashboard",
        "indicador",
        "indicadores",
        "processo",
        "rotina",
        "padrão",
        "padrao"
      ]
    }

  ]

  for(const regra of regras){

    if(
      regra.termos.some(item =>
        texto.includes(normalizar(item))
      )
    ){

      return regra.categoria

    }

  }

  return "principal"

}

function extrairTags(pergunta){

  const texto =
  normalizar(pergunta)

  const tags = []

  const mapa = {

    faturamento:[
      "faturamento",
      "venda",
      "vendeu",
      "pix",
      "ticket"
    ],

    metas:[
      "meta",
      "prata",
      "ouro",
      "projecao",
      "projeção"
    ],

    financeiro:[
      "financeiro",
      "conta",
      "despesa",
      "titulo",
      "título",
      "boleto"
    ],

    rh:[
      "rh",
      "funcionario",
      "funcionário",
      "colaborador",
      "advertencia",
      "advertência",
      "suspensao",
      "suspensão"
    ],

    compras:[
      "compra",
      "pedido"
    ],

    cotacoes:[
      "cotacao",
      "cotação",
      "fornecedor",
      "menor preco",
      "menor preço"
    ],

    estoque:[
      "estoque",
      "produto",
      "saldo",
      "validade"
    ],

    reservas:[
      "reserva",
      "mesa"
    ],

    marketing:[
      "banner",
      "arte",
      "imagem",
      "instagram"
    ],

    whatsapp:[
      "whatsapp",
      "template",
      "mensagem"
    ],

    memoria:[
      "memoria",
      "memória",
      "lembra",
      "historico",
      "histórico",
      "anterior"
    ],

    analise:[
      "analisa",
      "analise",
      "cruza",
      "compare",
      "o que aconteceu",
      "conclusao",
      "conclusão"
    ]

  }

  for(const [tag, termos] of Object.entries(mapa)){

    if(
      termos.some(termo =>
        texto.includes(normalizar(termo))
      )
    ){

      tags.push(tag)

    }

  }

  return removerDuplicados(tags)

}

// ======================================================
// MEMÓRIA
// ======================================================

function montarConteudoMemoria({

  pergunta,
  resposta,
  papel,
  agente,
  hashtag,
  empresa,
  nome,
  categoria,
  intencao

}){

  const partes = [

    `PAPEL: ${papel || ""}`,
    `AGENTE: ${agente || ""}`,
    `HASHTAG: ${hashtag || ""}`,
    `EMPRESA: ${empresa || ""}`,
    `USUARIO: ${nome || ""}`,
    `CATEGORIA: ${categoria || ""}`,
    `INTENCAO: ${intencao || ""}`,
    pergunta ? `PERGUNTA: ${pergunta}` : "",
    resposta ? `RESPOSTA: ${resposta}` : ""

  ].filter(Boolean)

  return partes.join("\n")

}

async function salvarMemoria({

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
  categoria,
  intencao,
  sentimento,
  prioridade,
  tags,
  dados,
  contexto,
  importante,
  permanente,
  fonte_tabela,
  fonte_id,
  referencia_externa

}){

  try{

    const conteudo =
    montarConteudoMemoria({

      pergunta,
      resposta,
      papel,
      agente,
      hashtag,
      empresa,
      nome:
      usuario_nome,
      categoria,
      intencao

    })

    const resumoBase =
    resposta
    ? primeiraLinha(resposta)
    : primeiraLinha(pergunta)

    const payload = {

      origem:
      origem || "OTTO_PRINCIPAL",

      agente:
      agente || "AGENTE_PRINCIPAL",

      hashtag:
      hashtag || "#principal",

      endpoint:
      endpoint || "/api/sistema-otto/principal",

      tipo:
      tipo || "mensagem",

      papel:
      papel || "sistema",

      telefone:
      telefone || null,

      numero:
      numero || telefone || null,

      usuario_id:
      usuario_id || null,

      usuario_nome:
      usuario_nome || null,

      empresa:
      empresa || null,

      pergunta:
      pergunta || null,

      resposta:
      resposta || null,

      conteudo:
      conteudo || pergunta || resposta || "",

      resumo:
      resumoBase || null,

      categoria:
      categoria || null,

      subcategoria:
      null,

      intencao:
      intencao || null,

      sentimento:
      sentimento || null,

      prioridade:
      prioridade || "normal",

      tags:
      Array.isArray(tags)
      ? removerDuplicados(tags)
      : [],

      entidades:
      {},

      dados:
      dados && typeof dados === "object"
      ? dados
      : {},

      contexto:
      contexto && typeof contexto === "object"
      ? contexto
      : {},

      metadata:{

        salvo_por:
        "principal.js",

        timezone:
        TIMEZONE,

        hoje:
        hojeBahiaISO()

      },

      fonte_tabela:
      fonte_tabela || null,

      fonte_id:
      fonte_id || null,

      referencia_externa:
      referencia_externa || null,

      importante:
      importante === true,

      permanente:
      permanente === true,

      pode_usar_contexto:
      true,

      ativo:
      true,

      arquivado:
      false,

      deletado:
      false,

      data_referencia:
      hojeBahiaISO()

    }

    const {
      error
    } = await supabase

    .from("memoria_otto_principal")

    .insert([payload])

    if(error){

      console.log(
        "ERRO AO SALVAR MEMÓRIA PRINCIPAL:",
        error.message
      )

    }

  }catch(e){

    console.log(
      "FALHA AO SALVAR MEMÓRIA PRINCIPAL:",
      e.message
    )

  }

}

async function buscarMemoriasRelevantes(pergunta){

  try{

    const termo =
    limparTexto(pergunta)

    const {
      data,
      error
    } = await supabase

    .rpc(
      "buscar_memoria_otto_principal",
      {
        termo_busca:
        termo || "",

        limite_resultados:
        LIMITE_MEMORIAS_RELEVANTES
      }
    )

    if(error){

      console.log(
        "ERRO AO BUSCAR MEMÓRIAS RELEVANTES VIA RPC:",
        error.message
      )

      return await buscarMemoriasRelevantesFallback(pergunta)

    }

    const resultado =
    Array.isArray(data)
    ? data
    : []

    if(resultado.length > 0){

      return resultado

    }

    return await buscarMemoriasRelevantesFallback(pergunta)

  }catch(e){

    console.log(
      "FALHA BUSCAR MEMÓRIAS RELEVANTES:",
      e.message
    )

    return await buscarMemoriasRelevantesFallback(pergunta)

  }

}

async function buscarMemoriasRelevantesFallback(pergunta){

  try{

    const termo =
    limparTexto(pergunta)

    let query =
    supabase

    .from("memoria_otto_principal")

    .select(
      "id,origem,agente,hashtag,tipo,papel,usuario_nome,empresa,pergunta,resposta,conteudo,resumo,categoria,intencao,tags,dados,contexto,importante,permanente,criado_em"
    )

    .eq("ativo", true)

    .eq("deletado", false)

    .eq("arquivado", false)

    .eq("pode_usar_contexto", true)

    .order("importante", {
      ascending:
      false
    })

    .order("criado_em", {
      ascending:
      false
    })

    .limit(LIMITE_MEMORIAS_RELEVANTES)

    if(termo){

      const seguro =
      termo
      .replace(/[%_]/g, "")
      .replace(/,/g, " ")
      .trim()

      if(seguro){

        query =
        query.or(
          [
            `conteudo.ilike.%${seguro}%`,
            `pergunta.ilike.%${seguro}%`,
            `resposta.ilike.%${seguro}%`,
            `resumo.ilike.%${seguro}%`,
            `categoria.ilike.%${seguro}%`,
            `agente.ilike.%${seguro}%`,
            `hashtag.ilike.%${seguro}%`
          ].join(",")
        )

      }

    }

    const {
      data,
      error
    } = await query

    if(error){

      console.log(
        "ERRO FALLBACK MEMÓRIAS:",
        error.message
      )

      return []

    }

    return Array.isArray(data)
    ? data
    : []

  }catch(e){

    console.log(
      "FALHA FALLBACK MEMÓRIAS:",
      e.message
    )

    return []

  }

}

async function buscarMemoriasRecentes({

  telefone,
  usuario_id,
  empresa

}){

  try{

    const resultados =
    []

    const adicionar =
    lista => {

      for(const item of lista || []){

        if(
          item &&
          item.id &&
          !resultados.some(memoria => memoria.id === item.id)
        ){

          resultados.push(item)

        }

      }

    }

    async function buscarComFiltro(nomeCampo, valor, limite){

      if(!valor){

        return []

      }

      const {
        data,
        error
      } = await supabase

      .from("memoria_otto_principal")

      .select(
        "id,origem,agente,hashtag,tipo,papel,usuario_nome,empresa,pergunta,resposta,conteudo,resumo,categoria,intencao,tags,dados,contexto,importante,permanente,criado_em"
      )

      .eq("ativo", true)

      .eq("deletado", false)

      .eq("arquivado", false)

      .eq("pode_usar_contexto", true)

      .eq(nomeCampo, String(valor))

      .order("criado_em", {
        ascending:
        false
      })

      .limit(limite)

      if(error){

        console.log(
          `ERRO AO BUSCAR MEMÓRIAS POR ${nomeCampo}:`,
          error.message
        )

        return []

      }

      return Array.isArray(data)
      ? data
      : []

    }

    async function buscarGerais(limite){

      const {
        data,
        error
      } = await supabase

      .from("memoria_otto_principal")

      .select(
        "id,origem,agente,hashtag,tipo,papel,usuario_nome,empresa,pergunta,resposta,conteudo,resumo,categoria,intencao,tags,dados,contexto,importante,permanente,criado_em"
      )

      .eq("ativo", true)

      .eq("deletado", false)

      .eq("arquivado", false)

      .eq("pode_usar_contexto", true)

      .order("criado_em", {
        ascending:
        false
      })

      .limit(limite)

      if(error){

        console.log(
          "ERRO AO BUSCAR MEMÓRIAS GERAIS:",
          error.message
        )

        return []

      }

      return Array.isArray(data)
      ? data
      : []

    }

    adicionar(
      await buscarComFiltro(
        "usuario_id",
        usuario_id,
        LIMITE_MEMORIAS_RECENTES
      )
    )

    adicionar(
      await buscarComFiltro(
        "telefone",
        telefone,
        LIMITE_MEMORIAS_RECENTES
      )
    )

    adicionar(
      await buscarComFiltro(
        "empresa",
        empresa,
        LIMITE_MEMORIAS_RECENTES
      )
    )

    adicionar(
      await buscarGerais(
        LIMITE_MEMORIAS_RECENTES
      )
    )

    return resultados.slice(
      0,
      LIMITE_MEMORIAS_RECENTES * 2
    )

  }catch(e){

    console.log(
      "FALHA BUSCAR MEMÓRIAS RECENTES:",
      e.message
    )

    return []

  }

}

function chaveMemoria(item){

  return String(item?.id || "")

}

function juntarMemorias({

  relevantes,
  recentes

}){

  const mapa =
  new Map()

  for(const item of recentes || []){

    if(item?.id){

      mapa.set(
        chaveMemoria(item),
        item
      )

    }

  }

  for(const item of relevantes || []){

    if(item?.id){

      mapa.set(
        chaveMemoria(item),
        item
      )

    }

  }

  return Array.from(mapa.values())

  .sort((a,b)=>{

    const ai =
    a.importante ? 1 : 0

    const bi =
    b.importante ? 1 : 0

    if(ai !== bi){

      return bi - ai

    }

    return new Date(b.criado_em || 0) - new Date(a.criado_em || 0)

  })

}

function filtrarMemoriasDaPerguntaAtual({

  memorias,
  perguntaAtual

}){

  const atual =
  normalizar(perguntaAtual)

  if(!atual){

    return memorias || []

  }

  return (memorias || []).filter(m => {

    const perguntaMemoria =
    normalizar(m.pergunta)

    const respostaMemoria =
    normalizar(m.resposta)

    if(
      perguntaMemoria === atual &&
      !respostaMemoria
    ){

      return false

    }

    return true

  })

}

function agruparMemoriasPorCategoria(memorias){

  const grupos = {}

  for(const memoria of memorias || []){

    const categoria =
    memoria.categoria ||
    String(memoria.hashtag || "")
    .replace("#","") ||
    "geral"

    if(!grupos[categoria]){

      grupos[categoria] = []

    }

    grupos[categoria].push(memoria)

  }

  return grupos

}

function criarResumoAnaliticoMemoria(memorias){

  const grupos =
  agruparMemoriasPorCategoria(memorias)

  const linhas = []

  for(const [categoria, itens] of Object.entries(grupos)){

    const ultimos =
    itens
    .slice(0, 5)
    .map(item => {

      const base =
      item.resumo ||
      primeiraLinha(item.resposta) ||
      primeiraLinha(item.pergunta) ||
      primeiraLinha(item.conteudo)

      return `- ${textoCurto(base, 220)}`

    })

    linhas.push(
      `Categoria: ${categoria}\n${ultimos.join("\n")}`
    )

  }

  return linhas.join("\n\n")

}

function formatarMemoriasParaIA(memorias){

  if(!memorias.length){

    return "Nenhuma memória relevante encontrada."

  }

  const resumoAnalitico =
  criarResumoAnaliticoMemoria(memorias)

  const blocos =
  memorias.map((m, index)=>{

    const linhas = [

      `MEMÓRIA ${index + 1}`,
      `Data: ${m.criado_em || ""}`,
      `Origem: ${m.origem || ""}`,
      `Agente: ${m.agente || ""}`,
      `Hashtag: ${m.hashtag || ""}`,
      `Tipo: ${m.tipo || ""}`,
      `Papel: ${m.papel || ""}`,
      `Empresa: ${m.empresa || ""}`,
      `Categoria: ${m.categoria || ""}`,
      `Intenção: ${m.intencao || ""}`,
      `Importante: ${m.importante === true ? "sim" : "não"}`,
      m.resumo ? `Resumo: ${m.resumo}` : "",
      m.pergunta ? `Pergunta: ${m.pergunta}` : "",
      m.resposta ? `Resposta: ${m.resposta}` : "",
      m.conteudo ? `Conteúdo: ${m.conteudo}` : "",
      m.dados ? `Dados: ${JSON.stringify(m.dados).slice(0, 1800)}` : ""

    ].filter(Boolean)

    return linhas.join("\n")

  })

  return limitarTexto(
    [
      "RESUMO AGRUPADO DAS MEMÓRIAS:",
      resumoAnalitico || "Sem agrupamento disponível.",
      "",
      "MEMÓRIAS DETALHADAS:",
      blocos.join("\n\n-----------------------------\n\n")
    ].join("\n"),
    LIMITE_TEXTO_MEMORIA
  )

}

// ======================================================
// IA PRINCIPAL
// ======================================================

function montarPromptSistema({

  nome,
  empresa,
  tipo,
  sentimento

}){

  const saudacao =
  saudacaoPorHorario()

  return `
Você é o OTTO Principal do Grupo Mercatto.

Responda como uma pessoa direta, firme, útil e objetiva.
Não seja robótico.
Não diga que é IA.
Não diga "como assistente virtual".
Não ofereça ajuda no final.
Não termine com frases como "se precisar, estou à disposição", "posso ajudar", "quer que eu faça".
Não enrole.
Não faça introdução desnecessária.
Não elogie sem necessidade.
Não repita a pergunta do usuário sem motivo.
Não invente dados.

Seu padrão de resposta:
- Para saudação: responda em uma frase curta.
- Para agradecimento: responda em uma frase curta.
- Para pergunta simples: responda direto.
- Para memória: responda com o que encontrou, sem explicar demais.
- Para análise: use as memórias, cruze os registros e entregue conclusão objetiva.
- Para erro ou falta de dados: diga exatamente o que falta.
- Para informação conflitante: aponte a divergência.
- Para assunto de outro agente: use somente a memória disponível; não finja consulta em tabela externa.
- Se houver memória disponível, use.
- Se não houver memória suficiente, diga: "Na memória disponível, não encontrei dado suficiente para concluir."
- Não faça lista grande sem necessidade.
- Evite frases genéricas.

Formato para análise:
1. Achado principal
2. Evidências na memória
3. Conclusão
4. Ação objetiva

Formato para memória:
- Último registro encontrado
- Resumo do que foi salvo
- Data, se houver

Identidade:
- Nome: OTTO.
- Papel: central executiva do Grupo Mercatto.
- Saudação atual: ${saudacao}.
- Data e hora na Bahia: ${dataHoraBahiaTexto()}.
- Timezone: ${TIMEZONE}.
- Nome do usuário: ${nome || "não informado"}.
- Empresa informada: ${empresa || "não informada"}.
- Tipo detectado: ${tipo}.
- Sentimento detectado: ${sentimento}.
`.trim()

}

function montarPromptUsuario({

  pergunta,
  contexto,
  memoriasTexto

}){

  return `
PERGUNTA:
${pergunta || ""}

CONTEXTO:
${JSON.stringify(contexto || {}, null, 2)}

MEMÓRIA DISPONÍVEL:
${memoriasTexto}

Responda de forma direta e objetiva, usando a memória quando ela ajudar.
Não ofereça ajuda no final.
`.trim()

}

async function gerarRespostaComIA({

  pergunta,
  contexto,
  memorias,
  nome,
  empresa,
  tipo,
  sentimento

}){

  const memoriasTexto =
  formatarMemoriasParaIA(memorias)

  const completion =
  await openai.chat.completions.create({

    model:
    OPENAI_MODEL,

    temperature:
    tipo === "analise" || tipo === "memoria"
    ? 0.18
    : 0.35,

    max_tokens:
    tipo === "analise"
    ? 1200
    : tipo === "memoria"
    ? 850
    : 420,

    messages:[

      {
        role:
        "system",

        content:
        montarPromptSistema({

          nome,
          empresa,
          tipo,
          sentimento

        })
      },

      {
        role:
        "user",

        content:
        montarPromptUsuario({

          pergunta,
          contexto,
          memoriasTexto

        })
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

  return removerMarkdownPesado(resposta)

}

// ======================================================
// FALLBACK SEM IA
// ======================================================

function respostaFallback({

  nome,
  tipo,
  memorias

}){

  const saudacao =
  saudacaoPorHorario()

  if(tipo === "saudacao"){

    return nome
    ? `${saudacao}, ${nome}.`
    : `${saudacao}.`

  }

  if(tipo === "agradecimento"){

    return "Perfeito."

  }

  if(tipo === "vazio"){

    return "Não recebi a pergunta."

  }

  if(tipo === "memoria"){

    const ultima =
    (memorias || [])[0]

    if(!ultima){

      return "Na memória disponível, não encontrei registro anterior suficiente."

    }

    const resumo =
    ultima.resumo ||
    primeiraLinha(ultima.resposta) ||
    primeiraLinha(ultima.pergunta) ||
    "Registro encontrado, mas sem resumo claro."

    return `Último registro encontrado: ${resumo}`

  }

  if(tipo === "analise"){

    if(!memorias || !memorias.length){

      return "Na memória disponível, não encontrei dado suficiente para concluir."

    }

    const resumo =
    criarResumoAnaliticoMemoria(memorias)

    return `Achado principal: há registros na memória, mas a IA não respondeu agora.\n\nEvidências na memória:\n${resumo}\n\nConclusão: revise os registros acima para confirmar o ponto principal.`

  }

  return "Entendi."

}

// ======================================================
// HTML DO CANVAS
// ======================================================

function montarMemoriasHTML(memorias){

  if(!memorias.length){

    return `
      <div class="bloco">
        <h3>Memória</h3>
        <p>Nenhum registro relevante encontrado.</p>
      </div>
    `

  }

  const linhas =
  memorias.slice(0, LIMITE_MEMORIAS_CANVAS).map((m, index)=>{

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escaparHTML(m.agente || "-")}</td>
        <td>${escaparHTML(m.categoria || "-")}</td>
        <td>${escaparHTML(textoCurto(m.resumo || primeiraLinha(m.resposta) || primeiraLinha(m.pergunta) || "-", 160))}</td>
        <td>${escaparHTML(m.criado_em ? new Date(m.criado_em).toLocaleString("pt-BR") : "-")}</td>
      </tr>
    `

  }).join("")

  return `
    <div class="resultado-tabela-wrap">
      <table class="resultado-tabela">
        <thead>
          <tr>
            <th>#</th>
            <th>Agente</th>
            <th>Categoria</th>
            <th>Resumo</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `

}

function montarHTMLPrincipal({

  resposta,
  pergunta,
  nome,
  empresa,
  tipo,
  sentimento,
  memorias

}){

  const respostaHTML =
  escaparHTML(resposta)
  .replace(/\n/g, "<br>")

  const mostrarMemoria =
  tipo === "analise" ||
  tipo === "memoria" ||
  memorias.length > 0

  return `
    <div class="resultado-html">

      <div class="bloco">
        <h2>OTTO Principal</h2>
        <p>${respostaHTML}</p>
      </div>

      <div class="bloco">
        <h3>Leitura</h3>
        <p><strong>Pergunta:</strong> ${escaparHTML(pergunta || "-")}</p>
        <p><strong>Categoria:</strong> ${escaparHTML(tipo || "-")}</p>
        <p><strong>Sentimento:</strong> ${escaparHTML(sentimento || "-")}</p>
        <p><strong>Usuário:</strong> ${escaparHTML(nome || "-")}</p>
        <p><strong>Empresa:</strong> ${escaparHTML(empresa || "-")}</p>
      </div>

      ${
        mostrarMemoria
        ? `
          <div class="bloco">
            <h3>Memória usada</h3>
            <p>${memorias.length} registro(s) encontrado(s).</p>
          </div>
          ${montarMemoriasHTML(memorias)}
        `
        : ""
      }

    </div>
  `

}

// ======================================================
// HANDLER
// ======================================================

module.exports = async function handler(req, res){

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

    const contextoRecebido =
    body.contexto &&
    typeof body.contexto === "object"
    ? body.contexto
    : {}

    const pergunta =
    limparTexto(
      body.pergunta ||
      body.mensagem ||
      body.texto ||
      ""
    )

    const telefone =
    limparTexto(
      body.telefone ||
      body.numero ||
      contextoRecebido.telefone ||
      contextoRecebido.numero ||
      ""
    )

    const numero =
    limparTexto(
      body.numero ||
      body.telefone ||
      contextoRecebido.numero ||
      contextoRecebido.telefone ||
      ""
    )

    const nome =
    limparTexto(
      body.nome ||
      contextoRecebido.nome ||
      ""
    )

    const empresa =
    limparTexto(
      body.empresa ||
      contextoRecebido.empresa ||
      ""
    )

    const usuario_id =
    body.usuario_id ||
    body.usuarioId ||
    contextoRecebido.usuario_id ||
    contextoRecebido.usuarioId ||
    null

    const contexto = {

      ...contextoRecebido,

      telefone,

      numero,

      nome,

      empresa,

      usuario_id,

      hoje:
      hojeBahiaISO(),

      timezone:
      TIMEZONE,

      origem:
      body.origem || "OTTO_PRINCIPAL"

    }

    const tipo =
    detectarTipoMensagem(pergunta)

    const sentimento =
    detectarSentimento(pergunta)

    const categoria =
    detectarCategoria(pergunta)

    const tags =
    extrairTags(pergunta)

    // ====================================================
    // BUSCA MEMÓRIA ANTES DE SALVAR A PERGUNTA ATUAL
    // ====================================================

    const [
      memoriasRelevantes,
      memoriasRecentes
    ] =
    await Promise.all([

      buscarMemoriasRelevantes(pergunta),

      buscarMemoriasRecentes({

        telefone,

        usuario_id,

        empresa

      })

    ])

    const memorias =
    filtrarMemoriasDaPerguntaAtual({

      memorias:
      juntarMemorias({

        relevantes:
        memoriasRelevantes,

        recentes:
        memoriasRecentes

      }),

      perguntaAtual:
      pergunta

    })

    // ====================================================
    // GERA RESPOSTA INTELIGENTE
    // ====================================================

    let resposta = ""

    try{

      resposta =
      await gerarRespostaComIA({

        pergunta,

        contexto,

        memorias,

        nome,

        empresa,

        tipo,

        sentimento

      })

    }catch(e){

      console.log(
        "ERRO IA AGENTE PRINCIPAL:",
        e.message
      )

      resposta =
      respostaFallback({

        nome,

        tipo,

        memorias

      })

    }

    if(!resposta){

      resposta =
      respostaFallback({

        nome,

        tipo,

        memorias

      })

    }

    // ====================================================
    // SALVA A PERGUNTA NA MEMÓRIA
    // ====================================================

    if(pergunta){

      await salvarMemoria({

        origem:
        body.origem || "USUARIO",

        agente:
        "AGENTE_PRINCIPAL",

        hashtag:
        "#principal",

        endpoint:
        "/api/sistema-otto/principal",

        tipo:
        "mensagem_usuario",

        papel:
        "usuario",

        telefone,

        numero,

        usuario_id,

        usuario_nome:
        nome,

        empresa,

        pergunta,

        resposta:
        null,

        categoria,

        intencao:
        tipo,

        sentimento,

        prioridade:
        sentimento === "irritado"
        ? "alta"
        : "normal",

        tags,

        dados:{

          body_original:
          body,

          memorias_disponiveis_antes:
          memorias.length

        },

        contexto,

        importante:
        tipo === "analise" || tipo === "memoria",

        permanente:
        false

      })

    }

    // ====================================================
    // SALVA A RESPOSTA NA MEMÓRIA
    // ====================================================

    await salvarMemoria({

      origem:
      "OTTO_PRINCIPAL",

      agente:
      "AGENTE_PRINCIPAL",

      hashtag:
      "#principal",

      endpoint:
      "/api/sistema-otto/principal",

      tipo:
      "mensagem_assistente",

      papel:
      "assistente",

      telefone,

      numero,

      usuario_id,

      usuario_nome:
      nome,

      empresa,

      pergunta,

      resposta,

      categoria,

      intencao:
      tipo,

      sentimento,

      prioridade:
      sentimento === "irritado"
      ? "alta"
      : "normal",

      tags,

      dados:{

        memorias_usadas:
        memorias.slice(0, 18).map(m => m.id),

        total_memorias:
        memorias.length,

        modelo:
        OPENAI_MODEL

      },

      contexto,

      importante:
      tipo === "analise" || tipo === "memoria",

      permanente:
      false

    })

    // ====================================================
    // HTML
    // ====================================================

    const html =
    montarHTMLPrincipal({

      resposta,

      pergunta,

      nome,

      empresa,

      tipo,

      sentimento,

      memorias

    })

    // ====================================================
    // RETORNO PADRÃO OTTO
    // ====================================================

    return res.status(200).json({

      ok:
      true,

      agente:
      "AGENTE_PRINCIPAL",

      hashtag:
      "#principal",

      endpoint:
      "/api/sistema-otto/principal",

      pergunta,

      resposta,

      mensagem:
      resposta,

      texto:
      resposta,

      fala:
      resposta,

      canvas:{

        tipo:
        "html",

        titulo:
        "OTTO Principal",

        subtitulo:
        tipo === "analise"
        ? "Análise com base na memória"
        : tipo === "memoria"
        ? "Consulta de memória"
        : "Resposta direta",

        tema:
        sentimento === "irritado"
        ? "vermelho"
        : tipo === "analise"
        ? "executivo"
        : "azul",

        html

      },

      dados:{

        tipo,

        sentimento,

        categoria,

        tags,

        nome,

        empresa,

        memorias_encontradas:
        memorias.length,

        memorias_relevantes:
        memoriasRelevantes.length,

        memorias_recentes:
        memoriasRecentes.length

      },

      memoria:{

        total:
        memorias.length,

        usadas:
        memorias.slice(0, 18).map(m => ({

          id:
          m.id,

          agente:
          m.agente,

          hashtag:
          m.hashtag,

          categoria:
          m.categoria,

          resumo:
          m.resumo,

          criado_em:
          m.criado_em

        }))

      },

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
      "ERRO AGENTE PRINCIPAL:",
      err
    )

    return res.status(500).json({

      ok:
      false,

      erro:
      true,

      agente:
      "AGENTE_PRINCIPAL",

      hashtag:
      "#principal",

      endpoint:
      "/api/sistema-otto/principal",

      mensagem:
      err.message || "Erro interno no agente principal.",

      resposta:
      "Erro no agente principal. Verifique a rota /api/sistema-otto/principal e a tabela memoria_otto_principal.",

      hoje:
      hojeBahiaISO(),

      timezone:
      TIMEZONE,

      timestamp:
      new Date().toISOString()

    })

  }

}
