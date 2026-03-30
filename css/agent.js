/* ═══════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack AI Agent
   Interpreta linguagem natural e executa ações no app via Gemini API.
   Suporta: transações, programadas, beneficiários, categorias, dívidas,
            contas, lista de mercado, preços e consultas de saldo.
═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Estado interno ────────────────────────────────────────────────────────────
const _agent = {
  open:      false,
  history:   [],   // { role:'user'|'assistant', text, actions }
  apiKey:    null,
  loading:   false,
};

// ── Abrir/Fechar ──────────────────────────────────────────────────────────────
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

// ── Enviar mensagem ───────────────────────────────────────────────────────────
window.agentSend = async function() {
  const input = document.getElementById('agentInput');
  const text  = (input?.value || '').trim();
  if (!text || _agent.loading) return;
  if (input) input.value = '';

  _agentAppend('user', text);
  _agentSetLoading(true);

  try {
    const key = await _agentGetKey();
    if (!key) {
      _agentAppend('assistant', '⚠️ Configure a chave Gemini em **Configurações → IA** para usar o agente.');
      return;
    }
    _agent.apiKey = key;

    const plan = await _agentPlan(text);
    await _agentExecute(plan, text);
  } catch(e) {
    _agentAppend('assistant', `❌ Erro: ${e.message}`);
  } finally {
    _agentSetLoading(false);
  }
};

// ── Buscar chave Gemini ───────────────────────────────────────────────────────
async function _agentGetKey() {
  if (_agent.apiKey) return _agent.apiKey;
  try {
    const k = await getAppSetting('gemini_api_key', '');
    return k || null;
  } catch(_) { return null; }
}

// ── Contexto do app para o Gemini ────────────────────────────────────────────
function _agentBuildContext() {
  const accs  = (state.accounts  || []).map(a => ({ id:a.id, name:a.name, type:a.type, currency:a.currency||'BRL', balance:a.balance }));
  const cats  = (state.categories|| []).map(c => ({ id:c.id, name:c.name, type:c.type }));
  const pays  = (state.payees    || []).map(p => ({ id:p.id, name:p.name }));
  const mems  = (state.familyMembers || []).map(m => ({ id:m.id, name:m.name||m.full_name }));
  const today = new Date().toISOString().slice(0,10);
  return { accounts:accs, categories:cats, payees:pays, familyMembers:mems, today };
}

// ── Chamar Gemini para gerar plano de ação ────────────────────────────────────
async function _agentPlan(userMessage) {
  const ctx  = _agentBuildContext();
  const prompt = `Você é o FinTrack Agent, um assistente de finanças pessoais integrado ao app FinTrack.
O usuário quer executar uma ação. Analise o pedido e retorne um JSON com o plano de execução.

CONTEXTO ATUAL DO APP:
- Data atual: ${ctx.today}
- Contas: ${JSON.stringify(ctx.accounts.slice(0,20))}
- Categorias: ${JSON.stringify(ctx.categories.slice(0,30))}
- Beneficiários: ${JSON.stringify(ctx.payees.slice(0,30))}
- Membros da família: ${JSON.stringify(ctx.familyMembers.slice(0,10))}

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
`;

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${_agent.apiKey}`;
  const body = { contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:1500,temperature:0.1} };
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Gemini API: HTTP ${resp.status}`);
  const result = await resp.json();
  const text   = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean  = text.replace(/```json|```/g,'').trim();
  try { return JSON.parse(clean); }
  catch(_) { throw new Error('Resposta inválida da IA. Tente reformular o pedido.'); }
}

// ── Executar plano ────────────────────────────────────────────────────────────
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
    }
    return;
  }

  // Show what we're about to do
  _agentAppend('assistant', `🔄 **${plan.summary || 'Executando ações…'}**`);

  const results = [];
  const context = {}; // carries IDs resolved in earlier steps

  for (const action of (plan.actions || [])) {
    try {
      const r = await _agentRunAction(action, context);
      results.push(r);
    } catch(e) {
      results.push({ ok:false, msg:`Erro em ${action.type}: ${e.message}` });
    }
  }

  // Build result message
  const lines = results.map(r => r.ok ? `✅ ${r.msg}` : `❌ ${r.msg}`);
  const allOk = results.every(r => r.ok);

  _agentAppend('assistant', lines.join('\n') + (allOk ? '\n\n*Tudo pronto!*' : ''));

  // Refresh relevant state
  if (allOk) {
    try {
      if (plan.intent === 'create_transaction')  { DB.accounts.bust(); if (state.currentPage==='transactions') loadTransactions(); if (state.currentPage==='dashboard') loadDashboard(); }
      if (plan.intent === 'create_scheduled')    { if (state.currentPage==='scheduled') loadScheduled(); }
      if (plan.intent === 'create_payee')        { DB.payees.bust(); await loadPayees(true); if (state.currentPage==='payees') renderPayees(); }
      if (plan.intent === 'create_category')     { await loadCategories(); }
      if (plan.intent === 'create_debt')         { if (state.currentPage==='debts') loadDebts(); }
    } catch(_) {}
  }
}

// ── Executar uma action individual ────────────────────────────────────────────
async function _agentRunAction(action, ctx) {
  const d = action.data || {};

  switch(action.type) {

    // ── Resolve/cria beneficiário ──────────────────────────────────────────
    case 'check_payee': {
      const name = d.name || d.payee_name || '';
      if (!name) { ctx.payee_id = null; return { ok:true, msg:`Nenhum beneficiário especificado` }; }
      const existing = (state.payees||[]).find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) { ctx.payee_id = existing.id; return { ok:true, msg:`Beneficiário **${existing.name}** encontrado` }; }
      // Create it
      const { data, error } = await sb.from('payees').insert({ name, type:'beneficiario', family_id:famId() }).select('id,name').single();
      if (error) throw new Error(error.message);
      ctx.payee_id = data.id;
      state.payees = [...(state.payees||[]), data];
      DB.payees.bust();
      return { ok:true, msg:`Beneficiário **${name}** criado` };
    }

    // ── Resolve/cria categoria ─────────────────────────────────────────────
    case 'check_category': {
      const name = d.name || d.category_name || '';
      if (!name) { ctx.category_id = null; return { ok:true, msg:`Nenhuma categoria especificada` }; }
      const existing = (state.categories||[]).find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) { ctx.category_id = existing.id; return { ok:true, msg:`Categoria **${existing.name}** encontrada` }; }
      const catType = d.type || 'expense';
      const catColor = d.color || '#2a6049';
      const { data, error } = await sb.from('categories').insert({ name, type:catType, color:catColor, family_id:famId() }).select('id,name,type,color').single();
      if (error) throw new Error(error.message);
      ctx.category_id = data.id;
      state.categories = [...(state.categories||[]), data];
      return { ok:true, msg:`Categoria **${name}** criada` };
    }

    // ── Criar transação ────────────────────────────────────────────────────
    case 'create_transaction': {
      const accountId = d.account_id || _agentResolveAccount(d.account_name, ctx);
      const categoryId = ctx.category_id || d.category_id || _agentResolveCategory(d.category_name);
      const payeeId    = ctx.payee_id    || d.payee_id    || _agentResolvePayee(d.payee_name);
      if (!accountId) throw new Error('Conta não encontrada. Especifique o nome da conta.');
      let amount = parseFloat(d.amount) || 0;
      if (d.type === 'expense' && amount > 0) amount = -amount;
      const payload = {
        date:        d.date || new Date().toISOString().slice(0,10),
        description: d.description || '',
        amount,
        account_id:  accountId,
        category_id: categoryId || null,
        payee_id:    payeeId    || null,
        status:      'confirmed',
        family_id:   famId(),
        is_transfer: false,
        is_card_payment: false,
        updated_at:  new Date().toISOString(),
      };
      const { data, error } = await sb.from('transactions').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      DB.accounts.bust();
      const sign = amount >= 0 ? '+' : '';
      return { ok:true, msg:`Transação **${payload.description||'sem descrição'}** (${sign}${Math.abs(amount).toFixed(2)}) criada` };
    }

    // ── Criar transação programada ─────────────────────────────────────────
    case 'create_scheduled': {
      const accountId  = d.account_id || _agentResolveAccount(d.account_name, ctx);
      const categoryId = ctx.category_id || d.category_id || _agentResolveCategory(d.category_name);
      const payeeId    = ctx.payee_id    || d.payee_id    || _agentResolvePayee(d.payee_name);
      if (!accountId) throw new Error('Conta não encontrada.');
      let amount = parseFloat(d.amount) || 0;
      if ((d.type==='expense'||d.type==='card_payment'||d.type==='transfer') && amount>0) amount=-amount;
      // Resolve family member if mentioned
      let familyMemberId = null;
      if (d.family_member_name) {
        const mem = (state.familyMembers||[]).find(m =>
          (m.name||m.full_name||'').toLowerCase().includes(d.family_member_name.toLowerCase()));
        if (mem) familyMemberId = mem.id;
      }
      const payload = {
        description:   d.description || '',
        amount,
        type:          d.type || 'expense',
        frequency:     d.frequency || 'monthly',
        start_date:    d.start_date || new Date().toISOString().slice(0,10),
        installments:  d.installments || null,
        account_id:    accountId,
        category_id:   categoryId || null,
        payee_id:      payeeId    || null,
        family_member_id: familyMemberId,
        auto_register: true,
        status:        'active',
        family_id:     famId(),
        updated_at:    new Date().toISOString(),
      };
      const { data, error } = await sb.from('scheduled_transactions').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      const parcLabel = payload.installments ? ` em ${payload.installments} parcelas` : ' indefinidamente';
      const freqMap = { monthly:'mensal', weekly:'semanal', daily:'diário', yearly:'anual' };
      return { ok:true, msg:`Programado **${payload.description}** (${freqMap[payload.frequency]||payload.frequency}${parcLabel}) criado` };
    }

    // ── Criar beneficiário ─────────────────────────────────────────────────
    case 'create_payee': {
      const name = d.name || '';
      if (!name) throw new Error('Nome do beneficiário não especificado.');
      const existing = (state.payees||[]).find(p => p.name.toLowerCase()===name.toLowerCase());
      if (existing) return { ok:true, msg:`Beneficiário **${existing.name}** já existe` };
      const { data, error } = await sb.from('payees').insert({ name, type:d.type||'beneficiario', family_id:famId() }).select('id,name').single();
      if (error) throw new Error(error.message);
      state.payees = [...(state.payees||[]), data];
      DB.payees.bust();
      return { ok:true, msg:`Beneficiário **${name}** criado com sucesso` };
    }

    // ── Criar categoria ────────────────────────────────────────────────────
    case 'create_category': {
      const name = d.name || '';
      if (!name) throw new Error('Nome da categoria não especificado.');
      const existing = (state.categories||[]).find(c => c.name.toLowerCase()===name.toLowerCase());
      if (existing) return { ok:true, msg:`Categoria **${existing.name}** já existe` };
      const { data, error } = await sb.from('categories').insert({
        name, type:d.type||'expense', color:d.color||'#2a6049', family_id:famId()
      }).select('id,name,type,color').single();
      if (error) throw new Error(error.message);
      state.categories = [...(state.categories||[]), data];
      return { ok:true, msg:`Categoria **${name}** criada` };
    }

    // ── Criar dívida ───────────────────────────────────────────────────────
    case 'create_debt': {
      const desc   = d.description || d.creditor || 'Dívida';
      const amount = parseFloat(d.original_amount || d.amount) || 0;
      if (!amount) throw new Error('Valor da dívida não especificado.');
      const payload = {
        description:      desc,
        creditor:         d.creditor || desc,
        original_amount:  amount,
        current_balance:  amount,
        currency:         d.currency || 'BRL',
        start_date:       d.start_date || new Date().toISOString().slice(0,10),
        status:           'active',
        family_id:        famId(),
        updated_at:       new Date().toISOString(),
      };
      const { data, error } = await sb.from('debts').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      return { ok:true, msg:`Dívida **${desc}** de R$${amount.toFixed(2)} criada` };
    }

    default:
      return { ok:false, msg:`Ação desconhecida: ${action.type}` };
  }
}

// ── Resolvers de ID por nome ──────────────────────────────────────────────────
function _agentResolveAccount(name, ctx) {
  if (!name) return (state.accounts||[])[0]?.id || null;
  const accs = state.accounts || [];
  const exact = accs.find(a => a.name.toLowerCase()===name.toLowerCase());
  if (exact) return exact.id;
  const partial = accs.find(a => a.name.toLowerCase().includes(name.toLowerCase()));
  return partial?.id || null;
}
function _agentResolveCategory(name) {
  if (!name) return null;
  const cats = state.categories || [];
  const exact = cats.find(c => c.name.toLowerCase()===name.toLowerCase());
  if (exact) return exact.id;
  const partial = cats.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
  return partial?.id || null;
}
function _agentResolvePayee(name) {
  if (!name) return null;
  const pays = state.payees || [];
  const exact = pays.find(p => p.name.toLowerCase()===name.toLowerCase());
  if (exact) return exact.id;
  const partial = pays.find(p => p.name.toLowerCase().includes(name.toLowerCase()));
  return partial?.id || null;
}

// ── Responder consulta de saldo ───────────────────────────────────────────────
function _agentAnswerBalance() {
  const accs = state.accounts || [];
  if (!accs.length) { _agentAppend('assistant', 'Não consegui carregar as contas. Tente recarregar a página.'); return; }
  const totalBRL = accs.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
  const lines = ['**Saldo das suas contas:**', ''];
  accs.forEach(a => {
    const bal = parseFloat(a.balance)||0;
    lines.push(`• **${a.name}**: ${fmt(bal,a.currency||'BRL')}${a.currency&&a.currency!=='BRL'?' ('+dashFmt(toBRL(bal,a.currency),'BRL')+')':''}`);
  });
  lines.push('', `**Total (BRL): ${dashFmt(totalBRL,'BRL')}**`);
  _agentAppend('assistant', lines.join('\n'));
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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
      ${!isUser?'<span class="agent-avatar">🤖</span>':''}
      <div class="agent-text">${html}</div>
    </div>`;
  feed.appendChild(msg);
  feed.scrollTop = feed.scrollHeight;
}

function _agentMarkdown(text) {
  // Simple markdown: bold, italic, code, line breaks
  return String(text||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
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
    // Remove any loading messages
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

// ── Input: Enter to send ──────────────────────────────────────────────────────
window.agentKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentSend(); }
};

// ── Quick suggestions ─────────────────────────────────────────────────────────
window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) { input.value = text; input.focus(); }
};
