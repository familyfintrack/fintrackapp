/* ═══════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack AI Agent
   Interpreta linguagem natural e executa ações no app via Gemini API.
   Suporta: transações, programadas, beneficiários, categorias, dívidas,
            contas, lista de mercado, preços e consultas de saldo.
═══════════════════════════════════════════════════════════════════════ */

'use strict';

const _agent = {
  open: false,
  history: [],
  apiKey: null,
  loading: false,
  pendingPlan: null,
  lastModel: null,
};

window.toggleAgent = function() {
  _agent.open = !_agent.open;
  const panel = document.getElementById('agentPanel');
  if (panel) {
    panel.style.display = _agent.open ? 'flex' : 'none';
    if (_agent.open) {
      document.getElementById('agentInput')?.focus();
      if (!_agent.history.length) _agentWelcome();
    }
  }
};

function _agentWelcome() {
  _agentAppend('assistant', [
    'Olá! Sou o **FinTrack Agent** 🤖',
    '',
    'Posso criar, buscar e gerenciar dados do app por você. Exemplos:',
    '• *"Crie uma transação de R$150 de Supermercado Extra na categoria Alimentação"*',
    '• *"Adicione transação programada de R$10 mensais para Pão de Açúcar em 10 parcelas para o Décio"*',
    '• *"Crie o beneficiário Padaria Central"*',
    '• *"Qual é meu saldo total?"*',
    '• *"Crie uma dívida de R$2000 de empréstimo pessoal"*',
    '• *"Adicione a categoria Lazer com cor azul"*',
  ].join('\n'));
}

window.agentSend = async function() {
  const input = document.getElementById('agentInput');
  const text = (input?.value || '').trim();
  if (!text || _agent.loading) return;
  if (input) input.value = '';

  _agentAppend('user', text);
  _agentSetLoading(true);

  try {
    const deps = _agentGetDependencies();
    if (!deps.sb) throw new Error('Conexão com banco indisponível no momento.');
    if (!deps.user) throw new Error('Sessão do usuário não encontrada. Recarregue a página e tente novamente.');

    if (_agent.pendingPlan) {
      const decision = _agentParseConfirmation(text);
      if (decision === 'confirm') {
        const pending = _agent.pendingPlan;
        _agent.pendingPlan = null;
        await _agentExecute(pending.plan, pending.originalText);
        return;
      }
      if (decision === 'cancel') {
        _agent.pendingPlan = null;
        _agentAppend('assistant', 'Tudo bem. Cancelei a ação pendente.');
        return;
      }
      _agentAppend('assistant', 'Tenho uma ação pendente. Responda **sim** para executar ou **não** para cancelar.');
      return;
    }

    const key = await _agentGetKey();
    if (!key) {
      _agentAppend('assistant', '⚠️ Configure a chave Gemini em **Configurações → IA** para usar o agente.');
      return;
    }
    _agent.apiKey = key;

    const plan = await _agentPlan(text);
    if (plan?.requires_confirmation) {
      _agent.pendingPlan = { plan, originalText: text };
      _agentAppend('assistant', `Confirma esta ação?\n\n**${plan.summary || 'Executar ações solicitadas'}**\n\nResponda **sim** para continuar ou **não** para cancelar.`);
      return;
    }

    await _agentExecute(plan, text);
  } catch (e) {
    _agentAppend('assistant', `❌ Erro: ${e.message}`);
  } finally {
    _agentSetLoading(false);
  }
};

async function _agentGetKey() {
  if (_agent.apiKey) return _agent.apiKey;
  try {
    const k = await getAppSetting('gemini_api_key', '');
    return k || null;
  } catch (_) {
    return null;
  }
}

function _agentGetDependencies() {
  return {
    sb: window.sb || (typeof sb !== 'undefined' ? sb : null),
    state: window.state || (typeof state !== 'undefined' ? state : {}),
    user: window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null),
  };
}

function _agentGetFamilyId() {
  try {
    if (typeof famId === 'function') return famId();
  } catch (_) {}
  return _agentGetDependencies().user?.family_id || null;
}

function _agentBuildContext() {
  const { state: appState } = _agentGetDependencies();
  const accs = (appState.accounts || []).map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency || 'BRL',
    balance: a.balance,
  }));
  const cats = (appState.categories || []).map(c => ({ id: c.id, name: c.name, type: c.type }));
  const pays = (appState.payees || []).map(p => ({ id: p.id, name: p.name }));
  const mems = (appState.familyMembers || []).map(m => ({ id: m.id, name: m.name || m.full_name }));
  const today = new Date().toISOString().slice(0, 10);
  return { accounts: accs, categories: cats, payees: pays, familyMembers: mems, today };
}

async function _agentPlan(userMessage) {
  const ctx = _agentBuildContext();
  const prompt = `Você é o FinTrack Agent, um assistente de finanças pessoais integrado ao app FinTrack.
O usuário quer executar uma ação. Analise o pedido e retorne um JSON com o plano de execução.

CONTEXTO ATUAL DO APP:
- Data atual: ${ctx.today}
- Contas: ${JSON.stringify(ctx.accounts.slice(0, 20))}
- Categorias: ${JSON.stringify(ctx.categories.slice(0, 30))}
- Beneficiários: ${JSON.stringify(ctx.payees.slice(0, 30))}
- Membros da família: ${JSON.stringify(ctx.familyMembers.slice(0, 10))}

PEDIDO DO USUÁRIO: "${userMessage}"

RETORNE APENAS JSON válido (sem markdown, sem explicações extras) no formato:
{
  "intent": "create_transaction|create_scheduled|create_payee|create_category|create_debt|query_balance|query_transactions|navigate|not_understood",
  "summary": "Resumo em português do que vai ser feito",
  "actions": [
    {
      "type": "create_transaction|create_scheduled|create_payee|create_category|create_debt|check_payee|check_category|navigate",
      "data": { ... campos específicos ... }
    }
  ],
  "requires_confirmation": true|false
}

REGRAS IMPORTANTES:
1. Para criar transação: data={date,description,amount(positivo=receita,negativo=despesa),account_id(ou account_name),category_id(ou category_name),payee_id(ou payee_name),type(income|expense|transfer)}
2. Para criar programada: data={description,amount,type,account_id(ou account_name),category_id(ou category_name),payee_id(ou payee_name),frequency(daily|weekly|monthly|yearly),start_date,installments(null=indefinido),family_member_name(se mencionado)}
3. Para criar beneficiário: data={name,type(beneficiario|fonte_pagadora|ambos)}
4. Para criar categoria: data={name,type(expense|income|both),color(hex opcional)}
5. Para criar dívida: data={description,original_amount,currency(BRL),start_date,creditor(nome do credor)}
6. Se payee_name não bate exato com lista, inclua ação check_payee antes para verificar/criar
7. Se category_name não bate exato com lista, inclua ação check_category antes
8. Para consulta de saldo: intent=query_balance, sem actions
9. Valores sempre em número (sem R$): "10 reais" = 10, "1.500,00" = 1500
10. Parcelas: "10 parcelas" = installments:10; "mensal indefinido" = installments:null
11. Use requires_confirmation=true para criar/excluir/modificar dados quando houver ambiguidade ou risco de interpretar errado.
`;

  const rawText = await _agentCallGemini(prompt);
  const parsed = _agentParsePlanResponse(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Resposta inválida da IA. Tente reformular o pedido.');
  }
  if (!Array.isArray(parsed.actions)) parsed.actions = [];
  return parsed;
}

function _agentGetModelCandidates() {
  const raw = [
    window.AGENT_AI_MODEL,
    window.RECEIPT_AI_MODEL,
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
  ].filter(Boolean);
  return [...new Set(raw.map(v => String(v).trim()).filter(Boolean))];
}

async function _agentCallGemini(prompt) {
  const models = _agentGetModelCandidates();
  let lastError = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(_agent.apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500, temperature: 0.1 },
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const detail = await _agentReadGeminiError(resp);
        const err = new Error(`Gemini API (${model}): HTTP ${resp.status}${detail ? ` - ${detail}` : ''}`);
        err.status = resp.status;
        err.model = model;
        lastError = err;
        if (resp.status === 404) continue;
        throw err;
      }

      const result = await resp.json();
      const text = result?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || '';
      if (!text.trim()) {
        throw new Error(`Gemini API (${model}) retornou resposta vazia.`);
      }
      _agent.lastModel = model;
      return text;
    } catch (err) {
      lastError = err;
      if (err?.status === 404) continue;
      throw err;
    }
  }

  throw lastError || new Error('Não foi possível obter resposta da IA.');
}

async function _agentReadGeminiError(resp) {
  try {
    const text = await resp.text();
    if (!text) return '';
    try {
      const json = JSON.parse(text);
      return json?.error?.message || json?.message || text.slice(0, 300);
    } catch (_) {
      return text.slice(0, 300);
    }
  } catch (_) {
    return '';
  }
}

function _agentParsePlanResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = [raw];
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]) candidates.push(codeBlock[1].trim());

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }
  return null;
}

async function _agentExecute(plan, originalText) {
  if (!plan || plan.intent === 'not_understood') {
    _agentAppend('assistant', '🤔 Não entendi o pedido. Pode reformular? Tente ser mais específico, ex: *"Crie uma transação de R$50 de despesa na categoria Alimentação"*');
    return;
  }

  if (plan.intent === 'query_balance') {
    _agentAnswerBalance();
    return;
  }

  if (plan.intent === 'navigate') {
    const page = plan.actions?.[0]?.data?.page;
    if (page && typeof navigate === 'function') {
      navigate(page);
      _agentAppend('assistant', `✓ Navegando para **${page}**`);
      return;
    }
    _agentAppend('assistant', 'Não consegui identificar a página para navegação.');
    return;
  }

  _agentAppend('assistant', `🔄 **${plan.summary || 'Executando ações…'}**`);

  const results = [];
  const context = {};

  for (const action of (plan.actions || [])) {
    try {
      const r = await _agentRunAction(action, context);
      results.push(r);
    } catch (e) {
      results.push({ ok: false, msg: `Erro em ${action.type}: ${e.message}` });
    }
  }

  const lines = results.length
    ? results.map(r => r.ok ? `✅ ${r.msg}` : `❌ ${r.msg}`)
    : ['⚠️ Nenhuma ação foi gerada para esse pedido.'];
  const allOk = results.length > 0 && results.every(r => r.ok);

  _agentAppend('assistant', lines.join('\n') + (allOk ? '\n\n*Tudo pronto!*' : ''));

  if (allOk) {
    try {
      await _agentRefreshAfterPlan(plan.intent);
    } catch (_) {}
  }
}

async function _agentRefreshAfterPlan(intent) {
  if (intent === 'create_transaction') {
    DB?.accounts?.bust?.();
    if (typeof loadTransactions === 'function') await loadTransactions();
    if (typeof loadDashboard === 'function') await loadDashboard();
    if (typeof window.triggerForecastLoad === 'function') {
      try { await window.triggerForecastLoad(); } catch (_) {}
    } else if (typeof window.loadForecast === 'function') {
      try { await window.loadForecast(); } catch (_) {}
    }
    return;
  }

  if (intent === 'create_scheduled') {
    if (typeof loadScheduled === 'function') await loadScheduled();
    if (typeof window.triggerForecastLoad === 'function') {
      try { await window.triggerForecastLoad(); } catch (_) {}
    } else if (typeof window.loadForecast === 'function') {
      try { await window.loadForecast(); } catch (_) {}
    }
    return;
  }

  if (intent === 'create_payee') {
    DB?.payees?.bust?.();
    if (typeof loadPayees === 'function') await loadPayees(true);
    if (_agentGetDependencies().state.currentPage === 'payees' && typeof renderPayees === 'function') renderPayees();
    return;
  }

  if (intent === 'create_category') {
    if (typeof loadCategories === 'function') await loadCategories();
    return;
  }

  if (intent === 'create_debt') {
    if (typeof loadDebts === 'function') await loadDebts();
  }
}

async function _agentRunAction(action, ctx) {
  const d = action?.data || {};
  const { sb: db, state: appState } = _agentGetDependencies();
  const familyId = _agentGetFamilyId();
  if (!db) throw new Error('Banco indisponível.');
  if (!familyId) throw new Error('family_id não encontrado para o usuário atual.');

  switch (action?.type) {
    case 'check_payee': {
      const name = d.name || d.payee_name || '';
      if (!name) {
        ctx.payee_id = null;
        return { ok: true, msg: 'Nenhum beneficiário especificado' };
      }
      const existing = (appState.payees || []).find(p => (p.name || '').toLowerCase() === name.toLowerCase());
      if (existing) {
        ctx.payee_id = existing.id;
        return { ok: true, msg: `Beneficiário **${existing.name}** encontrado` };
      }
      const { data, error } = await db.from('payees').insert({ name, type: 'beneficiario', family_id: familyId }).select('id,name,type').single();
      if (error) throw new Error(error.message);
      ctx.payee_id = data.id;
      appState.payees = [...(appState.payees || []), data];
      DB?.payees?.bust?.();
      return { ok: true, msg: `Beneficiário **${name}** criado` };
    }

    case 'check_category': {
      const name = d.name || d.category_name || '';
      if (!name) {
        ctx.category_id = null;
        return { ok: true, msg: 'Nenhuma categoria especificada' };
      }
      const existing = (appState.categories || []).find(c => (c.name || '').toLowerCase() === name.toLowerCase());
      if (existing) {
        ctx.category_id = existing.id;
        return { ok: true, msg: `Categoria **${existing.name}** encontrada` };
      }
      const catType = d.type || 'expense';
      const catColor = d.color || '#2a6049';
      const { data, error } = await db.from('categories').insert({ name, type: catType, color: catColor, family_id: familyId }).select('id,name,type,color').single();
      if (error) throw new Error(error.message);
      ctx.category_id = data.id;
      appState.categories = [...(appState.categories || []), data];
      return { ok: true, msg: `Categoria **${name}** criada` };
    }

    case 'create_transaction': {
      const accountId = d.account_id || _agentResolveAccount(d.account_name, ctx);
      const categoryId = ctx.category_id || d.category_id || _agentResolveCategory(d.category_name);
      const payeeId = ctx.payee_id || d.payee_id || _agentResolvePayee(d.payee_name);
      if (!accountId) throw new Error('Conta não encontrada. Especifique o nome da conta.');
      let amount = parseFloat(d.amount) || 0;
      if (d.type === 'expense' && amount > 0) amount = -amount;
      const payload = {
        date: d.date || new Date().toISOString().slice(0, 10),
        description: d.description || '',
        amount,
        account_id: accountId,
        category_id: categoryId || null,
        payee_id: payeeId || null,
        status: 'confirmed',
        family_id: familyId,
        is_transfer: false,
        is_card_payment: false,
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from('transactions').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      DB?.accounts?.bust?.();
      const sign = amount >= 0 ? '+' : '-';
      return { ok: true, msg: `Transação **${payload.description || 'sem descrição'}** (${sign}${Math.abs(amount).toFixed(2)}) criada` };
    }

    case 'create_scheduled': {
      const accountId = d.account_id || _agentResolveAccount(d.account_name, ctx);
      const categoryId = ctx.category_id || d.category_id || _agentResolveCategory(d.category_name);
      const payeeId = ctx.payee_id || d.payee_id || _agentResolvePayee(d.payee_name);
      if (!accountId) throw new Error('Conta não encontrada.');
      let amount = parseFloat(d.amount) || 0;
      if ((d.type === 'expense' || d.type === 'card_payment' || d.type === 'transfer') && amount > 0) amount = -amount;
      let familyMemberId = null;
      if (d.family_member_name) {
        const mem = (appState.familyMembers || []).find(m =>
          String(m.name || m.full_name || '').toLowerCase().includes(String(d.family_member_name).toLowerCase())
        );
        if (mem) familyMemberId = mem.id;
      }
      const installments = d.installments === null || d.installments === '' ? null : (parseInt(d.installments, 10) || null);
      const payload = {
        description: d.description || '',
        amount,
        type: d.type || 'expense',
        frequency: d.frequency || 'monthly',
        start_date: d.start_date || new Date().toISOString().slice(0, 10),
        installments,
        account_id: accountId,
        category_id: categoryId || null,
        payee_id: payeeId || null,
        family_member_id: familyMemberId,
        auto_register: true,
        status: 'active',
        family_id: familyId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from('scheduled_transactions').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      const parcLabel = payload.installments ? ` em ${payload.installments} parcelas` : ' indefinidamente';
      const freqMap = { monthly: 'mensal', weekly: 'semanal', daily: 'diário', yearly: 'anual' };
      return { ok: true, msg: `Programado **${payload.description || 'sem descrição'}** (${freqMap[payload.frequency] || payload.frequency}${parcLabel}) criado` };
    }

    case 'create_payee': {
      const name = d.name || '';
      if (!name) throw new Error('Nome do beneficiário não especificado.');
      const existing = (appState.payees || []).find(p => (p.name || '').toLowerCase() === name.toLowerCase());
      if (existing) return { ok: true, msg: `Beneficiário **${existing.name}** já existe` };
      const { data, error } = await db.from('payees').insert({ name, type: d.type || 'beneficiario', family_id: familyId }).select('id,name,type').single();
      if (error) throw new Error(error.message);
      appState.payees = [...(appState.payees || []), data];
      DB?.payees?.bust?.();
      return { ok: true, msg: `Beneficiário **${name}** criado com sucesso` };
    }

    case 'create_category': {
      const name = d.name || '';
      if (!name) throw new Error('Nome da categoria não especificado.');
      const existing = (appState.categories || []).find(c => (c.name || '').toLowerCase() === name.toLowerCase());
      if (existing) return { ok: true, msg: `Categoria **${existing.name}** já existe` };
      const { data, error } = await db.from('categories').insert({
        name,
        type: d.type || 'expense',
        color: d.color || '#2a6049',
        family_id: familyId,
      }).select('id,name,type,color').single();
      if (error) throw new Error(error.message);
      appState.categories = [...(appState.categories || []), data];
      return { ok: true, msg: `Categoria **${name}** criada` };
    }

    case 'create_debt': {
      const desc = d.description || d.creditor || 'Dívida';
      const amount = parseFloat(d.original_amount || d.amount) || 0;
      if (!amount) throw new Error('Valor da dívida não especificado.');
      const payload = {
        description: desc,
        creditor: d.creditor || desc,
        original_amount: amount,
        current_balance: amount,
        currency: d.currency || 'BRL',
        start_date: d.start_date || new Date().toISOString().slice(0, 10),
        status: 'active',
        family_id: familyId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from('debts').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      return { ok: true, msg: `Dívida **${desc}** de R$${amount.toFixed(2)} criada` };
    }

    default:
      return { ok: false, msg: `Ação desconhecida: ${action?.type || 'desconhecida'}` };
  }
}

function _agentResolveAccount(name) {
  const { state: appState } = _agentGetDependencies();
  const accs = appState.accounts || [];
  if (!name) return accs[0]?.id || null;
  const lower = String(name).toLowerCase();
  const exact = accs.find(a => String(a.name || '').toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = accs.find(a => String(a.name || '').toLowerCase().includes(lower));
  return partial?.id || null;
}

function _agentResolveCategory(name) {
  const { state: appState } = _agentGetDependencies();
  const cats = appState.categories || [];
  if (!name) return null;
  const lower = String(name).toLowerCase();
  const exact = cats.find(c => String(c.name || '').toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = cats.find(c => String(c.name || '').toLowerCase().includes(lower));
  return partial?.id || null;
}

function _agentResolvePayee(name) {
  const { state: appState } = _agentGetDependencies();
  const pays = appState.payees || [];
  if (!name) return null;
  const lower = String(name).toLowerCase();
  const exact = pays.find(p => String(p.name || '').toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = pays.find(p => String(p.name || '').toLowerCase().includes(lower));
  return partial?.id || null;
}

function _agentAnswerBalance() {
  const { state: appState } = _agentGetDependencies();
  const accs = appState.accounts || [];
  if (!accs.length) {
    _agentAppend('assistant', 'Não consegui carregar as contas. Tente recarregar a página.');
    return;
  }
  const totalBRL = accs.reduce((s, a) => s + toBRL(parseFloat(a.balance) || 0, a.currency || 'BRL'), 0);
  const lines = ['**Saldo das suas contas:**', ''];
  accs.forEach(a => {
    const bal = parseFloat(a.balance) || 0;
    lines.push(`• **${a.name}**: ${fmt(bal, a.currency || 'BRL')}${a.currency && a.currency !== 'BRL' ? ` (${dashFmt(toBRL(bal, a.currency), 'BRL')})` : ''}`);
  });
  lines.push('', `**Total (BRL): ${dashFmt(totalBRL, 'BRL')}**`);
  _agentAppend('assistant', lines.join('\n'));
}

function _agentParseConfirmation(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;
  if (/^(sim|s|ok|confirmar|confirmo|pode|yes|y)$/.test(value)) return 'confirm';
  if (/^(nao|não|n|cancelar|cancela|pare|stop|no)$/.test(value)) return 'cancel';
  return null;
}

function _agentAppend(role, text) {
  _agent.history.push({ role, text });
  _agentRenderMessage(role, text);
}

function _agentRenderMessage(role, text) {
  const feed = document.getElementById('agentFeed');
  if (!feed) return;
  const isUser = role === 'user';
  const html = _agentMarkdown(text);
  const msg = document.createElement('div');
  msg.className = `agent-msg agent-msg--${role}`;
  msg.innerHTML = `
    <div class="agent-bubble">
      ${!isUser ? '<span class="agent-avatar">🤖</span>' : ''}
      <div class="agent-text">${html}</div>
    </div>`;
  feed.appendChild(msg);
  feed.scrollTop = feed.scrollHeight;
}

function _agentMarkdown(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _agentSetLoading(on) {
  _agent.loading = on;
  const btn = document.getElementById('agentSendBtn');
  const ind = document.getElementById('agentLoading');
  if (btn) btn.disabled = on;
  if (ind) ind.style.display = on ? '' : 'none';
  if (!on) {
    document.querySelectorAll('.agent-loading').forEach(el => el.remove());
  } else {
    const feed = document.getElementById('agentFeed');
    if (feed) {
      const el = document.createElement('div');
      el.className = 'agent-msg agent-msg--assistant agent-loading';
      el.innerHTML = '<div class="agent-bubble"><span class="agent-avatar">🤖</span><div class="agent-typing"><span></span><span></span><span></span></div></div>';
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
    }
  }
}

window.agentKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    agentSend();
  }
};

window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) {
    input.value = text;
    input.focus();
  }
};
