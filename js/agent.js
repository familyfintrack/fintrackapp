import { supabase } from '../lib/supabaseClient'

// ========================
// CORE STATE
// ========================
const _agent = {
  pendingPlan: null,
  contextMemory: {},
  learning: {}
}

// ========================
// FIX CRÍTICO (ANTES DE TUDO)
// ========================
function _agentIsConfirmation(msg) {
  return /^(ok|pode|confirmo|confirmar|sim|manda ver|prosseguir|yes|yep)$/i
    .test(String(msg || '').trim())
}

window._agentIsConfirmation = _agentIsConfirmation

// ========================
// UTILS
// ========================
function normalize(text) {
  return text?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function similarity(a, b) {
  if (!a || !b) return 0
  a = normalize(a)
  b = normalize(b)
  return a.includes(b) || b.includes(a) ? 0.8 : 0
}

function fuzzyFind(list, value, field = 'name') {
  if (!value) return null

  let best = null
  let bestScore = 0

  for (const item of list) {
    const score = similarity(item[field], value)
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }

  return bestScore > 0.6 ? best : null
}

// ========================
// CONTEXT
// ========================
async function ensureContext() {
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) throw new Error("Usuário não autenticado")

  const [accounts, categories, payees] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('payees').select('*')
  ])

  return {
    user,
    accounts: accounts.data || [],
    categories: categories.data || [],
    payees: payees.data || []
  }
}

// ========================
// PARSER INTELIGENTE
// ========================
function parseIntent(input) {
  const text = normalize(input)

  return {
    type: 'CREATE_EXPENSE',
    amount: parseFloat((text.match(/\d+[.,]?\d*/) || [])[0]?.replace(',', '.')),
    account: (text.match(/conta\s+([a-z0-9]+)/) || [])[1],
    category: (text.match(/(alimentacao|mercado|lazer|transporte)/) || [])[1],
    payee: (text.match(/em\s+([a-z0-9\s]+)/) || [])[1]
  }
}

// ========================
// SUGESTÕES
// ========================
export async function getSuggestions(input) {
  const ctx = await ensureContext()
  const text = normalize(input)

  return {
    accounts: ctx.accounts.filter(a => normalize(a.name).includes(text)).slice(0, 5),
    categories: ctx.categories.filter(c => normalize(c.name).includes(text)).slice(0, 5),
    payees: ctx.payees.filter(p => normalize(p.name).includes(text)).slice(0, 5)
  }
}

// ========================
// EXECUÇÃO
// ========================
export async function runAgent(input) {
  try {
    const text = input.trim()

    if (_agentIsConfirmation(text) && _agent.pendingPlan) {
      const plan = _agent.pendingPlan
      _agent.pendingPlan = null

      const { error } = await supabase.from('transactions').insert(plan)

      if (error) throw error

      return { type: 'success', message: 'Transação confirmada com sucesso' }
    }

    const intent = parseIntent(input)
    const ctx = await ensureContext()

    if (!intent.amount) {
      return { type: 'confirm', message: 'Qual o valor?' }
    }

    const account = fuzzyFind(ctx.accounts, intent.account)
    const category = fuzzyFind(ctx.categories, intent.category)
    const payee = fuzzyFind(ctx.payees, intent.payee)

    if (!account) {
      return {
        type: 'confirm',
        message: 'Qual conta?',
        suggestions: ctx.accounts.slice(0, 5)
      }
    }

    if (!category) {
      return {
        type: 'confirm',
        message: 'Qual categoria?',
        suggestions: ctx.categories.slice(0, 5)
      }
    }

    const plan = {
      amount: intent.amount,
      type: 'expense',
      account_id: account.id,
      category_id: category.id,
      payee_id: payee?.id || null,
      created_by: ctx.user.id
    }

    _agent.pendingPlan = plan

    return {
      type: 'confirm',
      message: `Confirmar despesa de R$ ${intent.amount} em ${category.name}?`
    }

  } catch (e) {
    console.error('[Agent]', e)

    return {
      type: 'error',
      message: e.message
    }
  }
}
