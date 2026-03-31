/* ═══════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack Agent v2
   Três capacidades:
     1) AÇÕES    — criar transações, programados, beneficiários, categorias, dívidas
     2) AJUDA    — responder dúvidas sobre o app (busca semântica em help.js)
     3) FINANÇAS — responder sobre as finanças do usuário (saldos, gastos, orçamentos)

   Fluxo: userMessage → _agentClassifyIntent() → dispatcher
     HELP    → _agentAnswerHelp()     (busca semântica no help.js + Gemini)
     FINANCE → _agentAnswerFinance()  (consulta state + Supabase + Gemini)
     ACTION  → _agentBuildPlan() → _agentExecute()
     UNKNOWN → tenta Gemini, fallback amigável
═══════════════════════════════════════════════════════════════════════ */
'use strict';

const _agent = {
  open: false,
  history: [],
  apiKey: null,
  loading: false,
  pendingPlan: null,
  liveSuggestions: [],
};

const AGENT_ALLOWED_INTENTS = new Set([
  'create_transaction','create_scheduled','create_payee','create_category',
  'create_debt','query_balance','navigate','confirm','help','finance_query','not_understood',
]);

// ── Public API ────────────────────────────────────────────────────────────
window.toggleAgent = function() {
  _agent.open = !_agent.open;
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  panel.style.display = _agent.open ? 'flex' : 'none';
  if (_agent.open) {
    document.getElementById('agentInput')?.focus();
    if (!_agent.history.length) _agentWelcome();
  }
};

window.agentSend = async function() {
  const input = document.getElementById('agentInput');
  const text = (input?.value || '').trim();
  if (!text || _agent.loading) return;
  input.value = '';
  input.style.height = 'auto';
  _agentAppend('user', text);
  _agentSetLoading(true);
  try { await _agentDispatch(text); }
  catch (e) { console.error('[agent]', e); _agentAppend('assistant', `❌ Erro: ${e.message}`); }
  finally { _agentSetLoading(false); }
};

window.agentKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentSend(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); window.agentAcceptTopSuggestion?.(); }
};

window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) { input.value = text; input.focus(); window.agentInputChanged?.(); }
};

window.agentInputChanged = function() {
  const input = document.getElementById('agentInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight,100) + 'px';
  _agentRenderComposerSuggestions(input.value || '');
};

window.agentApplySuggestion = function(value) {
  const input = document.getElementById('agentInput');
  if (!input) return;
  input.value = value;
  input.focus();
  window.agentInputChanged?.();
};

window.agentAcceptTopSuggestion = function() {
  if (!_agent.liveSuggestions?.length) return;
  const top = _agent.liveSuggestions[0];
  if (top?.apply) window.agentApplySuggestion(top.apply);
};

// ── Welcome ───────────────────────────────────────────────────────────────
function _agentWelcome() {
  _agentAppend('assistant', [
    '👋 Olá! Sou o **FinTrack Agent**.',
    '',
    'Posso ajudar com três tipos de tarefa:',
    '',
    '**📊 Suas finanças**',
    '› *"Quanto gastei este mês?"*',
    '› *"Qual categoria mais pesou no orçamento?"*',
    '› *"Quais contas estão no vermelho?"*',
    '',
    '**❓ Dúvidas sobre o app**',
    '› *"Como adicionar uma conta?"*',
    '› *"O que é uma transação programada?"*',
    '› *"Como convidar um familiar?"*',
    '',
    '**⚡ Ações rápidas**',
    '› *"Crie despesa de R$80 no Supermercado"*',
    '› *"Adicione programado mensal de R$500"*',
  ].join('\n'));
}

// ── Main dispatcher ───────────────────────────────────────────────────────
async function _agentDispatch(text) {
  if (_agentIsConfirmation(text) && _agent.pendingPlan) {
    const plan = _agent.pendingPlan;
    _agent.pendingPlan = null;
    await _agentExecute(plan, text);
    return;
  }

  const intent = _agentClassifyIntent(text);

  if (intent === 'help') { await _agentAnswerHelp(text); return; }
  if (intent === 'finance_query') { await _agentAnswerFinance(text); return; }

  if (intent === 'navigate') {
    const page = _agentExtractNavPage(text);
    if (page && typeof navigate === 'function') {
      navigate(page);
      _agentAppend('assistant', `✅ Abrindo **${page}**.`);
      return;
    }
  }

  const plan = await _agentBuildPlan(text);
  await _agentExecute(plan, text);
}

// ── Intent classifier ─────────────────────────────────────────────────────
function _agentClassifyIntent(text) {
  const msg = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const helpRx = [
    /como (adicionar|criar|cadastrar|editar|excluir|deletar|remover|configurar|ativar|desativar|convidar|usar|fazer|mudar|alterar)/,
    /o que [ee] (uma?|o|a)\s+(conta|transacao|categoria|orcamento|programado|beneficiario|modulo|dashboard|relatorio|previsao|reconciliacao|divida|investimento|cartao)/,
    /para que serve|como funciona|onde (fico|encontro|vejo|acho|esta)/,
    /nao (consigo|encontro|acho|sei|entendo)\s/,
    /o que significa|qual a diferenca|me explique|central de ajuda/,
    /como (mudar|trocar|alterar) (idioma|senha|foto|perfil|avatar|nome)/,
    /como (convidar|adicionar|remover) (membro|familiar|usuario)/,
    /o que (posso|da pra) fazer/,
  ];
  if (helpRx.some(p => p.test(msg))) return 'help';

  const financeRx = [
    /quanto (gastei|recebi|entrou|saiu|paguei|ganhei)/,
    /qual (meu|minha|o meu|a minha|foi o|foi a).{0,30}(saldo|gasto|despesa|receita|conta|categoria|total)/,
    /quais (contas|categorias|despesas|receitas|transacoes|programados)\s*(estao|tem|tenho|mais)/,
    /maior (gasto|despesa|receita|categoria|conta)/,
    /saldo (total|atual|das contas|por conta|negativo)/,
    /resumo (financeiro|do mes|mensal|das financas)/,
    /mostre (meu|minha|os|as)\s*(saldo|gasto|despesa|receita|conta|categoria)/,
    /tendencia|evolucao|historico (de gastos|financeiro|mensal)/,
    /estou (no vermelho|no azul|gastando mais|recebendo mais)/,
    /previsao|forecast|proximo mes/,
    /orcamento (restante|utilizado|estourado|disponivel)/,
    /minhas? financas|meu financeiro|minha situacao/,
  ];
  if (financeRx.some(p => p.test(msg))) return 'finance_query';

  if (/\b(abr[ia]|ir para|naveg|vai para)\b/.test(msg)) return 'navigate';
  if (/(cri[ea]r?|adicionar?|adicione|lanc[ae]r?|registrar?|registre)\s/.test(msg)) return 'action';

  return 'unknown';
}

// ════════════════════════════════════════════════════════════════════════════
// HELP — busca semântica em help.js + Gemini
// ════════════════════════════════════════════════════════════════════════════

async function _agentAnswerHelp(query) {
  const index = _agentBuildHelpIndex();
  if (!index.length) {
    _agentAppend('assistant', '⚠️ Central de ajuda não disponível no momento.');
    return;
  }

  const scored = _agentScoreHelpArticles(index, query);
  const top = scored.slice(0, 3);
  const key = await _agentGetKey();

  if (top.length && top[0].score >= 2 && key) {
    await _agentAnswerHelpWithGemini(query, top, key);
    return;
  }

  if (top.length && top[0].score >= 2) {
    const best = top[0];
    const lines = [`📖 **${best.title}**`, '', best.summary.slice(0, 300) + (best.summary.length > 300 ? '…' : '')];
    if (best.section) lines.push('', `*Seção: ${best.section}*`);
    if (top.length > 1) {
      lines.push('', '**Relacionados:**');
      top.slice(1).forEach(a => lines.push(`• ${a.title}`));
    }
    _agentAppend('assistant', lines.join('\n'));
    return;
  }

  if (key) {
    await _agentAnswerHelpWithGemini(query, index.slice(0, 8), key);
    return;
  }

  _agentAppend('assistant',
    '🤔 Não encontrei resposta exata.\n\n' +
    'Consulte a **Central de Ajuda** no menu lateral para mais detalhes.'
  );
}

async function _agentAnswerHelpWithGemini(query, articles, apiKey) {
  const ctx = articles.slice(0, 4).map(a =>
    `=== ${a.title} (${a.section}) ===\n${a.plainText.slice(0, 500)}`
  ).join('\n\n');

  const prompt = `Você é o suporte do app Family FinTrack.
Pergunta do usuário: "${query}"

Responda em português usando APENAS o contexto abaixo. Seja objetivo (máx 5 frases).
Use **negrito** para termos importantes. Se não souber, diga que não encontrou.

CONTEXTO:
${ctx}`;

  try {
    const resp = await _agentCallGemini(prompt, apiKey, 400);
    _agentAppend('assistant', resp);
  } catch (e) {
    _agentAppend('assistant', articles[0]?.summary || 'Consulte a Central de Ajuda para detalhes.');
  }
}

function _agentBuildHelpIndex() {
  try {
    if (typeof _helpContent !== 'function') return [];
    const lang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';
    return _helpContent().flatMap(section => {
      const sectionTitle = section.title?.[lang] || section.title?.pt || '';
      return (section.articles || []).map(article => {
        const title = article.title?.[lang] || article.title?.pt || '';
        const rawBody = article.body?.[lang] || article.body?.pt || '';
        const plainText = _agentStripHtml(typeof rawBody === 'string' ? rawBody : String(rawBody));
        return {
          id: article.id, section: sectionTitle, title,
          plainText,
          summary: plainText.replace(/\s+/g,' ').trim().slice(0, 300),
          keywords: _agentExtractKeywords(title + ' ' + plainText),
        };
      });
    });
  } catch (e) { return []; }
}

function _agentScoreHelpArticles(index, query) {
  const qWords = _agentTokenize(query);
  return index.map(a => {
    let score = 0;
    const tWords = _agentTokenize(a.title);
    const bWords = _agentTokenize(a.plainText);
    for (const qw of qWords) {
      if (qw.length < 3) continue;
      if (tWords.some(w => w.includes(qw) || qw.includes(w))) score += 3;
      if (bWords.some(w => w.includes(qw) || qw.includes(w))) score += 1;
      if (a.keywords.includes(qw)) score += 2;
    }
    if (_agentTokenize(a.section).some(w => qWords.includes(w))) score += 1;
    return { ...a, score };
  }).filter(a => a.score > 0).sort((a,b) => b.score - a.score);
}

function _agentStripHtml(html) {
  return html.replace(/<[^>]+>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}

function _agentTokenize(text) {
  return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=3);
}

function _agentExtractKeywords(text) {
  const stop = new Set(['para','como','que','uma','com','por','mais','mas','nao','dos','das','nos','nas','seu','sua','seus','suas','este','esta','esse','essa','isto','isso','aqui','ali','tambem','ainda','bem','quando','onde','quem','qual','porque','entao','assim','cada','todo','toda','todos','todas','muito','antes','depois','entre','sobre','sem','ter','ser','foi','sao','esta','tem','vai','deve','pode']);
  return _agentTokenize(text).filter(w => !stop.has(w));
}

// ════════════════════════════════════════════════════════════════════════════
// FINANCE QUERY
// ════════════════════════════════════════════════════════════════════════════

async function _agentAnswerFinance(query) {
  await _agentEnsureContextLoaded();
  const msg = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const key = await _agentGetKey();

  let snapshot = '';

  if (/saldo|conta|vermelho|azul/.test(msg)) {
    snapshot = _agentFinanceBalances();
  } else if (/gastei|gasto|despesa|receita|entrou|saiu|paguei|ganhei/.test(msg)) {
    const period = _agentParsePeriodFromQuery(msg);
    snapshot = await _agentFinanceSpending(period);
  } else if (/orcamento|budget|restante|estourado|limite/.test(msg)) {
    snapshot = _agentFinanceBudgets();
  } else if (/programado|recorrente|proximo mes|vencer|debito/.test(msg)) {
    snapshot = _agentFinanceScheduled();
  } else {
    snapshot = _agentBuildFinanceSnapshot();
  }

  if (key) {
    await _agentFinanceWithGemini(query, snapshot, key);
  } else {
    _agentAppend('assistant', snapshot);
  }
}

async function _agentFinanceWithGemini(query, data, apiKey) {
  const prompt = `Você é o assistente financeiro do app Family FinTrack.
Pergunta: "${query}"

Use SOMENTE os dados abaixo. Responda em português, de forma objetiva (máx 8 linhas).
Use **negrito** e listas com •. Não invente dados.

DADOS:
${data}`;
  try {
    _agentAppend('assistant', await _agentCallGemini(prompt, apiKey, 500));
  } catch (e) {
    _agentAppend('assistant', data);
  }
}

function _agentFinanceBalances() {
  const accs = state.accounts || [];
  if (!accs.length) return '⚠️ Nenhuma conta cadastrada.';
  const f = (v,cur) => typeof fmt==='function'?fmt(v,cur||'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const toBrl = (v,cur) => typeof toBRL==='function'?toBRL(v,cur):Number(v);
  const total = accs.reduce((s,a)=>s+toBrl(Number(a.balance)||0,a.currency||'BRL'),0);
  const neg = accs.filter(a=>Number(a.balance)<0);
  const lines = ['**💰 Saldo das contas:**',''];
  accs.forEach(a => {
    const bal = Number(a.balance)||0;
    const icon = bal < 0 ? '🔴' : '🟢';
    const brl = a.currency!=='BRL' ? ` *(${f(toBrl(bal,a.currency),'BRL')} BRL)*` : '';
    lines.push(`${icon} **${a.name}**: ${f(bal,a.currency)}${brl}`);
  });
  lines.push('',`**Total BRL: ${f(total,'BRL')}**`);
  if (neg.length) lines.push('',`⚠️ ${neg.length} conta(s) negativa(s): ${neg.map(a=>a.name).join(', ')}`);
  return lines.join('\n');
}

async function _agentFinanceSpending(period) {
  const { year, month, label } = period;
  const f = (v) => typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  let txs = state.transactions || [];

  // Try to fetch from DB for the specific period
  if (_agentGetFamilyId()) {
    try {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = `${year}-${String(month).padStart(2,'0')}-31`;
      const { data } = await sb.from('transactions')
        .select('amount,status,categories(name)')
        .gte('date',start).lte('date',end)
        .eq('family_id',_agentGetFamilyId())
        .eq('is_transfer',false).neq('is_card_payment',true)
        .limit(500);
      if (data?.length) txs = data;
    } catch(e) { console.warn('[agent finance]',e); }
  }

  if (!txs.length) return `📭 Nenhuma transação para ${label}.`;

  let income=0, expense=0;
  const byCat = {};
  for (const t of txs) {
    if ((t.status||'confirmed')==='pending') continue;
    const amt = Number(t.amount)||0;
    if (amt>0) income+=amt; else expense+=Math.abs(amt);
    const cat = t.categories?.name||'Sem categoria';
    if (amt<0) byCat[cat]=(byCat[cat]||0)+Math.abs(amt);
  }

  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lines=[
    `**📅 ${label}:**`,'',
    `🟢 Receitas: **${f(income)}**`,
    `🔴 Despesas: **${f(expense)}**`,
    `${income-expense>=0?'✅':'⚠️'} Resultado: **${f(income-expense)}**`,
  ];
  if (topCats.length) {
    lines.push('','**🏷️ Maiores despesas por categoria:**');
    topCats.forEach(([cat,val])=>{
      const pct = expense>0?((val/expense)*100).toFixed(0):0;
      lines.push(`• **${cat}**: ${f(val)} (${pct}%)`);
    });
  }
  return lines.join('\n');
}

function _agentFinanceBudgets() {
  const budgets = state.budgets||[];
  if (!budgets.length) return '📭 Nenhum orçamento cadastrado.';
  const f=(v)=>typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const lines=['**🎯 Orçamentos:**',''];
  budgets.forEach(b=>{
    const limit=Number(b.amount)||0, spent=Number(b.spent)||0;
    const pct=limit>0?Math.round((spent/limit)*100):0;
    const icon=pct>=100?'🔴':pct>=80?'🟡':'🟢';
    lines.push(`${icon} **${b.categories?.name||'Categoria'}**: ${f(spent)} / ${f(limit)} (${pct}%)`);
  });
  return lines.join('\n');
}

function _agentFinanceScheduled() {
  const sched=state.scheduled||[];
  if (!sched.length) return '📭 Nenhum programado cadastrado.';
  const f=(v)=>typeof fmt==='function'?fmt(Math.abs(v),'BRL'):`R$ ${Math.abs(Number(v)).toFixed(2)}`;
  const active=sched.filter(s=>(s.status||'active')==='active');
  const exp=active.filter(s=>Number(s.amount)<0);
  const inc=active.filter(s=>Number(s.amount)>0);
  const totalExp=exp.reduce((s,t)=>s+Math.abs(Number(t.amount)||0),0);
  const totalInc=inc.reduce((s,t)=>s+(Number(t.amount)||0),0);
  const lines=[
    `**📅 Programados ativos:**`,'',
    `🔴 Despesas: **${f(totalExp)}** (${exp.length} itens)`,
    `🟢 Receitas: **${f(totalInc)}** (${inc.length} itens)`,
  ];
  if (exp.length) {
    lines.push('','**Maiores despesas programadas:**');
    exp.sort((a,b)=>Math.abs(Number(a.amount))-Math.abs(Number(b.amount))).reverse().slice(0,5)
      .forEach(s=>lines.push(`• **${s.description}**: ${f(s.amount)} (${s.frequency||'mensal'})`));
  }
  return lines.join('\n');
}

function _agentBuildFinanceSnapshot() {
  const f=(v)=>typeof fmt==='function'?fmt(v,'BRL'):`R$ ${Number(v).toFixed(2)}`;
  const toBrl=(v,cur)=>typeof toBRL==='function'?toBRL(v,cur):Number(v);
  const accs=state.accounts||[];
  const total=accs.reduce((s,a)=>s+toBrl(Number(a.balance)||0,a.currency||'BRL'),0);
  const txs=state.transactions||[];
  const inc=txs.filter(t=>Number(t.amount)>0).reduce((s,t)=>s+Number(t.amount),0);
  const exp=txs.filter(t=>Number(t.amount)<0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  return [
    `**💰 Total em contas: ${f(total)}**`,
    `📈 Receitas (exibidas): ${f(inc)}`,
    `📉 Despesas (exibidas): ${f(exp)}`,
    `📅 Programados ativos: ${(state.scheduled||[]).filter(s=>(s.status||'active')==='active').length}`,
    `🎯 Orçamentos: ${(state.budgets||[]).length}`,
    `🏦 Contas: ${accs.length} (${accs.filter(a=>Number(a.balance)<0).length} negativa(s))`,
  ].join('\n');
}

function _agentParsePeriodFromQuery(msg) {
  const now=new Date();
  const months={janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
  for (const [n,num] of Object.entries(months)) {
    if (msg.includes(n)) {
      const y=msg.match(/20\d{2}/)?.[0]||now.getFullYear();
      return {year:Number(y),month:num,label:`${n} ${y}`};
    }
  }
  if (/mes passado|ultimo mes/.test(msg)) {
    const d=new Date(now.getFullYear(),now.getMonth()-1,1);
    return {year:d.getFullYear(),month:d.getMonth()+1,label:'mês passado'};
  }
  return {year:now.getFullYear(),month:now.getMonth()+1,label:'este mês'};
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIONS — build + execute
// ════════════════════════════════════════════════════════════════════════════

async function _agentBuildPlan(userMessage) {
  const direct = _agentParseStructured(userMessage);
  if (direct.intent !== 'not_understood') return direct;
  const key = await _agentGetKey();
  if (!key) return { ...direct, _noKey: true };
  _agent.apiKey = key;
  const aiPlan = await _agentPlanWithGemini(userMessage);
  return _agentNormalizePlan(aiPlan, userMessage);
}

async function _agentPlanWithGemini(userMessage) {
  const ctx = _agentBuildContext();
  const prompt = `Você é o FinTrack Agent. Converta o pedido em JSON para execução no app.
Retorne APENAS JSON válido, sem markdown.

Data: ${ctx.today}
Contas: ${JSON.stringify(ctx.accounts)}
Categorias: ${JSON.stringify(ctx.categories)}
Beneficiários: ${JSON.stringify(ctx.payees)}

Formato:
{"intent":"create_transaction|create_scheduled|create_payee|create_category|create_debt|navigate|not_understood","summary":"texto","requires_confirmation":false,"actions":[{"type":"...","data":{}}]}

Regras: despesa=amount negativo, receita=positivo. Use *_name quando sem id. Se faltar dado crítico, intent=not_understood.

Pedido: ${JSON.stringify(userMessage)}`;

  for (const model of ['gemini-2.0-flash','gemini-2.5-flash','gemini-2.5-flash-lite']) {
    try {
      const text = await _agentCallGemini(prompt, _agent.apiKey, 800, model);
      return JSON.parse(_agentExtractJson(text));
    } catch (e) {
      if (!/404/.test(e.message||'')) throw e;
    }
  }
  throw new Error('Não foi possível interpretar o pedido com a IA.');
}

// ── Core Gemini caller ─────────────────────────────────────────────────────
async function _agentCallGemini(prompt, apiKey, maxTokens=600, model='gemini-2.0-flash') {
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp=await fetch(url,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens,temperature:0.15}})
  });
  if(!resp.ok){const raw=await resp.text().catch(()=>'');throw new Error(`Gemini HTTP ${resp.status}${raw?': '+raw.slice(0,120):''}`);}
  const data=await resp.json();
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}

function _agentExtractJson(text) {
  const s=String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
  const f=s.indexOf('{'),l=s.lastIndexOf('}');
  return (f>=0&&l>f)?s.slice(f,l+1):s;
}

function _agentNormalizePlan(plan, originalText) {
  if (!plan||typeof plan!=='object') return _agentParseStructured(originalText);
  if (!AGENT_ALLOWED_INTENTS.has(plan.intent)) plan.intent='not_understood';
  plan.summary=plan.summary||'';
  plan.actions=Array.isArray(plan.actions)?plan.actions:[];
  plan.requires_confirmation=!!plan.requires_confirmation;
  return plan;
}

function _agentParseStructured(text) {
  const raw=String(text||'').trim();
  const msg=_agentNormalize(raw);
  const amount=_agentParseAmount(raw);
  const date=_agentParseDate(raw);
  const entities=_agentExtractEntities(raw);

  if (/saldo total|qual .*saldo|quanto .*saldo/.test(msg))
    return {intent:'query_balance',summary:'Consultando saldo',requires_confirmation:false,actions:[]};

  if (/\b(abr[ia]|ir para|naveg)\b/.test(msg)) {
    const page=_agentExtractNavPage(text);
    if (page) return {intent:'navigate',summary:`Abrindo ${page}`,requires_confirmation:false,actions:[{type:'navigate',data:{page}}]};
  }

  if (/(cri[ea]r?|adicionar?|adicione|lanc[ae]r?|registrar?|registre)\s.*?(transac|despesa|receita)/.test(msg)&&amount!==null) {
    const isIncome=/(receita|entrada|ganho|recebimento)/.test(msg);
    return {intent:'create_transaction',summary:'Criando transação',requires_confirmation:false,actions:[{type:'create_transaction',data:{
      date,amount:isIncome?Math.abs(amount):-Math.abs(amount),type:isIncome?'income':'expense',
      description:_agentParseDescription(raw, entities),
      account_name:entities.account_name||'',
      category_name:entities.category_name||'',
      payee_name:entities.payee_name||'',
      family_member_name:entities.family_member_name||'',
      _entities:entities,
    }}]};
  }

  if (/programad/.test(msg)&&amount!==null) {
    const isIncome=/receita|entrada/.test(msg);
    return {intent:'create_scheduled',summary:'Criando programado',requires_confirmation:false,actions:[{type:'create_scheduled',data:{
      date,amount:isIncome?Math.abs(amount):-Math.abs(amount),type:isIncome?'income':'expense',
      description:_agentParseDescription(raw, entities),
      account_name:entities.account_name||'',
      category_name:entities.category_name||'',
      payee_name:entities.payee_name||'',
      frequency:_agentParseFrequency(msg)||'monthly',
      start_date:date,installments:_agentParseInstallments(msg),
      family_member_name:entities.family_member_name||'',
      _entities:entities,
    }}]};
  }

  if (/benefici[aá]rio|favorecido/.test(msg)&&/(cri[ea]|adicione)/.test(msg)) {
    const name=entities.payee_name||_agentExtractAfter(raw,[/benefici[aá]rio\s+([^,.;]+)/i,/favorecido\s+([^,.;]+)/i]);
    if (name) return {intent:'create_payee',summary:'Criando beneficiário',requires_confirmation:false,actions:[{type:'create_payee',data:{name}}]};
  }

  if (/categoria/.test(msg)&&/(cri[ea]|adicione)/.test(msg)) {
    const name=entities.category_name||_agentExtractAfter(raw,[/categoria\s+([^,.;]+)/i]);
    if (name) return {intent:'create_category',summary:'Criando categoria',requires_confirmation:false,actions:[{type:'create_category',data:{name,type:'expense',color:_agentParseColor(msg)}}]};
  }

  if (/d[ií]vida/.test(msg)&&amount!==null)
    return {intent:'create_debt',summary:'Criando dívida',requires_confirmation:false,actions:[{type:'create_debt',data:{description:_agentParseDescription(raw, entities),creditor:entities.payee_name||_agentExtractPayee(raw),original_amount:Math.abs(amount),start_date:date}}]};

  return {intent:'not_understood',summary:'',requires_confirmation:false,actions:[]};
}

function _agentExtractNavPage(text) {
  const navMap=[
    ['dashboard',/dashboard|painel/],['transactions',/transa[cç][aã]o|lan[çc]amento|despesa|receita/],
    ['scheduled',/programad/],['reports',/relat[oó]rio|forecast|previs[aã]o/],
    ['payees',/benefici[aá]rio|favorecido/],['categories',/categoria/],
    ['accounts',/\bconta/],['budgets',/or[cç]amento/],
    ['settings',/configura[cç][oõ]es?/],['help',/ajuda|help/],
    ['investments',/investimento/],['debts',/d[ií]vida/],
    ['prices',/pre[cç]o/],['grocery',/lista.*compra/],
  ];
  const msg=text.toLowerCase();
  return navMap.find(([,rx])=>rx.test(msg))?.[0]||null;
}

async function _agentExecute(plan, originalText) {
  const normalized=_agentNormalizePlan(plan,originalText);
  if(normalized.intent==='not_understood'){
    _agentAppend('assistant', normalized._noKey
      ? `🔑 Para ações livres, configure sua chave do Gemini em Configurações → Integrações.

Sem a chave, consigo responder ajuda e finanças, mas ações complexas ficam limitadas.`
      : `🤔 Não consegui entender o pedido com segurança. Tente algo como:
• \`Crie uma despesa de R$ 50 na conta Nubank com Alimentação\`
• \`Crie uma despesa de R$ 30 em McDonalds\``);
    return;
  }
  if(normalized.intent==='confirm'){
    if (!_agent.pendingPlan) { _agentAppend('assistant','Não há ação pendente.'); return; }
    plan=_agent.pendingPlan; _agent.pendingPlan=null;
  } else {
    plan=normalized;
  }
  if (plan.intent==='query_balance') { _agentAnswerBalance(); return; }
  await _agentEnsureContextLoaded();
  if (plan.intent==='navigate') {
    const page=plan.actions?.[0]?.data?.page;
    if (page&&typeof navigate==='function') { navigate(page); _agentAppend('assistant',`✅ Abrindo **${page}**.`); return; }
  }

  const preflight=_agentPreflightPlan(plan);
  if(preflight.needUserDecision){
    _agent.pendingPlan=plan;
    _agentAppend('assistant', preflight.message);
    return;
  }
  if(preflight.askConfirmation && !_agentIsConfirmation(originalText)){
    _agent.pendingPlan=plan;
    _agentAppend('assistant', preflight.message + '\n\nDigite **ok** para confirmar ou reformule a frase.');
    return;
  }

  _agentAppend('assistant',`🔄 **${plan.summary||'Executando…'}**`);
  const ctx={}; const results=[];
  for(const action of (plan.actions||[])){
    try { results.push(await _agentRunAction(action,ctx)); }
    catch(e){ results.push({ok:false,msg:`Erro em ${action.type}: ${e.message}`}); }
  }
  const allOk=results.every(r=>r.ok);
  _agentAppend('assistant',results.map(r=>r.ok?`✅ ${r.msg}`:`❌ ${r.msg}`).join('\n')+(allOk?'\n\n*Tudo pronto!*':''));
  if (allOk) await _agentRefreshAfterPlan(plan);
}

function _agentPreflightPlan(plan){
  const action=plan.actions?.[0];
  const data=action?.data||{};
  const doubts=[];
  const hard=[];
  if(action?.type==='create_transaction' || action?.type==='create_scheduled'){
    const account=_agentEntityResolution('account', data.account_name);
    const category=_agentEntityResolution('category', data.category_name);
    const payee=_agentEntityResolution('payee', data.payee_name);
    if(account.status==='empty'){
      if((state.accounts||[]).length===1){ data.account_name=state.accounts[0].name; data.account_id=state.accounts[0].id; doubts.push(`conta única **${state.accounts[0].name}**`); }
      else { const topAccounts=(state.accounts||[]).slice(0,5).map(a=>`• Conta: **${a.name}**`).join('\n'); return {needUserDecision:true,message:`⚠️ Preciso saber em qual conta lançar.\n\n${topAccounts || 'Escreva o nome exato da conta para continuar.'}`}; }
    } else if(account.status==='missing'){
      hard.push('Não encontrei a conta informada.');
      const topAccounts=(state.accounts||[]).slice(0,5).map(a=>`• Conta: **${a.name}**`).join('\n');
      return {needUserDecision:true,message:`⚠️ ${hard.join(' ')}\n\n${topAccounts || 'Escreva o nome exato da conta para continuar.'}`};
    }
    if(account.status==='soft' || account.status==='ambiguous'){ doubts.push(`conta como **${account.resolved?.name}**`); data.account_name=account.resolved?.name||data.account_name; }
    else if(account.resolved){ data.account_name=account.resolved.name; data.account_id=account.resolved.id; }

    if(data.category_name){
      if(category.status==='soft' || category.status==='ambiguous'){ doubts.push(`categoria como **${category.resolved?.name}**`); data.category_name=category.resolved?.name||data.category_name; }
      else if(category.resolved){ data.category_name=category.resolved.name; data.category_id=category.resolved.id; }
    }
    if(data.payee_name){
      if(payee.status==='soft' || payee.status==='ambiguous'){ doubts.push(`beneficiário como **${payee.resolved?.name}**`); data.payee_name=payee.resolved?.name||data.payee_name; }
      else if(payee.resolved){ data.payee_name=payee.resolved.name; data.payee_id=payee.resolved.id; }
    }
  }
  if(doubts.length){
    return {askConfirmation:true,needUserDecision:false,message:`🧐 Encontrei alguns pontos com dúvida. Vou seguir interpretando ${doubts.join(', ')}.`};
  }
  return {askConfirmation:false,needUserDecision:false,message:''};
}

async function _agentRunAction(action,ctx) {

  const d=action.data||{};
  switch(action.type){
    case 'check_payee':    return _agentEnsurePayee(d.name||d.payee_name||'',ctx);
    case 'check_category': return _agentEnsureCategory(d.category_name||d.name||'',d.type||'expense',d.color,ctx);
    case 'create_transaction': return _agentCreateTransaction(d,ctx);
    case 'create_scheduled':   return _agentCreateScheduled(d,ctx);
    case 'create_payee':       return _agentEnsurePayee(d.name||'',ctx,true);
    case 'create_category':    return _agentEnsureCategory(d.name||'',d.type||'expense',d.color,ctx,true);
    case 'create_debt':        return _agentCreateDebt(d);
    case 'navigate':
      if(d.page&&typeof navigate==='function'){navigate(d.page);return{ok:true,msg:`Página **${d.page}** aberta`};}
      throw new Error('Página não informada.');
    default: return{ok:false,msg:`Ação desconhecida: ${action.type}`};
  }
}

async function _agentEnsurePayee(name,ctx,explicit=false){
  const c=String(name||'').trim();
  if(!c) return{ok:!explicit,msg:explicit?'Nome não informado.':'Sem beneficiário'};
  const ex=_agentFindByName(state.payees||[],c);
  if(ex){ctx.payee_id=ex.id;return{ok:true,msg:`Beneficiário **${ex.name}** encontrado`};}
  const{data,error}=await sb.from('payees').insert({name:c,type:'beneficiario',family_id:_agentGetFamilyId()}).select('id,name,type').single();
  if(error) throw new Error(error.message);
  state.payees=[...(state.payees||[]),data];
  if(typeof DB!=='undefined'&&DB.payees?.bust) DB.payees.bust();
  ctx.payee_id=data.id;
  return{ok:true,msg:`Beneficiário **${c}** criado`};
}

async function _agentEnsureCategory(name,type='expense',color='#2a6049',ctx={},explicit=false){
  const c=String(name||'').trim();
  if(!c) return{ok:!explicit,msg:explicit?'Nome não informado.':'Sem categoria'};
  const ex=_agentFindByName(state.categories||[],c,{kind:'category'});
  if(ex){ctx.category_id=ex.id;return{ok:true,msg:`Categoria **${ex.name}** encontrada`};}
  const dbType = type==='income' ? 'receita' : type==='expense' ? 'despesa' : type;
  const{data,error}=await sb.from('categories').insert({name:c,type:dbType,color:color||'#2a6049',family_id:_agentGetFamilyId()}).select('id,name,type,color').single();
  if(error) throw new Error(error.message);
  state.categories=[...(state.categories||[]),data];
  ctx.category_id=data.id;
  return{ok:true,msg:`Categoria **${c}** criada`};
}

async function _agentCreateTransaction(d,ctx){
  const account=_agentResolveAccountObj(d.account_id,d.account_name);
  if(!account) throw new Error('Conta não encontrada. Especifique o nome da conta.');
  let catId=d.category_id||ctx.category_id||_agentResolveCategory(d.category_name);
  if(!catId&&d.category_name){const r=await _agentEnsureCategory(d.category_name,d.type==='income'?'income':'expense',null,ctx);if(!r.ok)throw new Error(r.msg);catId=ctx.category_id;}
  let payId=d.payee_id||ctx.payee_id||_agentResolvePayee(d.payee_name);
  if(!payId&&d.payee_name){const r=await _agentEnsurePayee(d.payee_name,ctx);if(!r.ok)throw new Error(r.msg);payId=ctx.payee_id;}
  let amount=Number(d.amount||0);
  if(!Number.isFinite(amount)||!amount) throw new Error('Valor inválido.');
  if((d.type||'').toLowerCase()==='expense'&&amount>0) amount=-amount;
  if((d.type||'').toLowerCase()==='income'&&amount<0) amount=Math.abs(amount);
  const payload={date:d.date||new Date().toISOString().slice(0,10),description:d.description||d.payee_name||'Lançamento via Agent',amount,account_id:account.id,category_id:catId||null,payee_id:payId||null,family_id:_agentGetFamilyId(),status:'confirmed',is_transfer:false,is_card_payment:false,updated_at:new Date().toISOString()};
  const{data,error}=await sb.from('transactions').insert(payload).select('id,date,description,amount').single();
  if(error) throw new Error(error.message);
  if(typeof notifyOnTransaction==='function'){try{await notifyOnTransaction(data);}catch(_){}}
  ctx.last_transaction_id=data.id;
  const fmtAmt=typeof fmt==='function'?fmt(Math.abs(amount),account.currency||'BRL'):Math.abs(amount).toFixed(2);
  return{ok:true,msg:`**${payload.description}** em **${account.name}** — ${fmtAmt}`};
}

async function _agentCreateScheduled(d,ctx){
  const account=_agentResolveAccountObj(d.account_id,d.account_name);
  if(!account) throw new Error('Conta não encontrada.');
  let catId=d.category_id||ctx.category_id||_agentResolveCategory(d.category_name);
  if(!catId&&d.category_name){await _agentEnsureCategory(d.category_name,d.type==='income'?'income':'expense',null,ctx);catId=ctx.category_id;}
  let payId=d.payee_id||ctx.payee_id||_agentResolvePayee(d.payee_name);
  if(!payId&&d.payee_name){await _agentEnsurePayee(d.payee_name,ctx);payId=ctx.payee_id;}
  let amount=Number(d.amount||0);
  if(!Number.isFinite(amount)||!amount) throw new Error('Valor inválido.');
  if((d.type||'').toLowerCase()!=='income') amount=-Math.abs(amount);
  const payload={description:d.description||d.payee_name||'Programado via Agent',amount,type:d.type||'expense',frequency:d.frequency||'monthly',start_date:d.start_date||new Date().toISOString().slice(0,10),installments:d.installments??null,account_id:account.id,category_id:catId||null,payee_id:payId||null,family_id:_agentGetFamilyId(),auto_register:true,status:'active',updated_at:new Date().toISOString()};
  const{error}=await sb.from('scheduled_transactions').insert(payload);
  if(error) throw new Error(error.message);
  return{ok:true,msg:`Programado **${payload.description}** (${payload.frequency})`};
}

async function _agentCreateDebt(d){
  const amount=Math.abs(Number(d.original_amount||d.amount||0));
  if(!amount) throw new Error('Valor inválido.');
  const payload={description:d.description||d.creditor||'Dívida via Agent',creditor:d.creditor||d.description||'Credor',original_amount:amount,current_balance:amount,currency:d.currency||'BRL',start_date:d.start_date||new Date().toISOString().slice(0,10),status:'active',family_id:_agentGetFamilyId(),updated_at:new Date().toISOString()};
  const{error}=await sb.from('debts').insert(payload);
  if(error) throw new Error(error.message);
  return{ok:true,msg:`Dívida **${payload.description}** — ${typeof fmt==='function'?fmt(amount,'BRL'):amount.toFixed(2)}`};
}

function _agentResolveAccountObj(id,name){
  const a=state.accounts||[];
  if(id)return a.find(x=>x.id===id)||null;
  if(!name)return a[0]||null;
  return _agentFindByName(a,name,{kind:'account'});
}
function _agentResolveCategory(name){return name?_agentFindByName(state.categories||[],name,{kind:'category'})?.id||null:null;}
function _agentResolvePayee(name){return name?_agentFindByName(state.payees||[],name,{kind:'payee'})?.id||null:null;}
function _agentNormalize(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function _agentLevenshtein(a,b){
  a=_agentNormalize(a); b=_agentNormalize(b);
  const m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++)dp[i][0]=i; for(let j=0;j<=n;j++)dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}
function _agentSimilarity(a,b){
  const na=_agentNormalize(a), nb=_agentNormalize(b);
  if(!na||!nb) return 0;
  if(na===nb) return 1;
  if(na.includes(nb)||nb.includes(na)) return Math.max(0.9, Math.min(na.length,nb.length)/Math.max(na.length,nb.length));
  const ta=new Set(na.split(' ')), tb=new Set(nb.split(' '));
  let overlap=0; ta.forEach(x=>{ if(tb.has(x)) overlap++; });
  const tokenScore=overlap/Math.max(ta.size,tb.size,1);
  const lev=1-(_agentLevenshtein(na,nb)/Math.max(na.length,nb.length,1));
  return Math.max(tokenScore, lev);
}
function _agentFindCandidates(list,name,{kind='generic',limit=5}={}){
  const query=String(name||'').trim(); if(!query) return [];
  return (list||[]).map(item=>{
    const label=String(item?.name||'');
    let score=_agentSimilarity(label, query);
    const nLabel=_agentNormalize(label), nQuery=_agentNormalize(query);
    if(kind==='account' && /[a-z]{1,4}\d+/i.test(query) && nLabel.replace(/\s+/g,'').includes(nQuery.replace(/\s+/g,''))) score=Math.max(score,0.96);
    if(kind==='account'){ const firstToken=String(label).split(/\s+/)[0]; score=Math.max(score, _agentSimilarity(firstToken, query)); }
    return {item, score};
  }).filter(x=>x.score>0.45).sort((a,b)=>b.score-a.score).slice(0,limit);
}
function _agentFindByName(list,name,opts={}){ return _agentFindCandidates(list,name,opts)[0]?.item||null; }
function _agentEntityResolution(kind, rawValue){
  const value=String(rawValue||'').trim();
  if(!value) return {value:'',resolved:null,candidates:[],confidence:0,status:'empty'};
  const source = kind==='account' ? (state.accounts||[]) : kind==='category' ? (state.categories||[]) : (state.payees||[]);
  const candidates=_agentFindCandidates(source,value,{kind});
  const top=candidates[0]||null;
  const second=candidates[1]||null;
  const confidence=top?.score||0;
  const ambiguous=!!(top&&second&&Math.abs(top.score-second.score)<0.08);
  const status = !top ? 'missing' : (confidence>=0.92 && !ambiguous ? 'strong' : ambiguous ? 'ambiguous' : confidence>=0.60 ? 'soft' : 'missing');
  return {value,resolved:top?.item||null,candidates:candidates.map(c=>c.item),confidence,status};
}
function _agentCleanEntityValue(v){
  return String(v||'').replace(/^[\s:,-]+|[\s:,-]+$/g,'').replace(/["“”]/g,'').replace(/\s+/g,' ').trim();
}
function _agentExtractEntities(text){
  const raw=String(text||'').trim();
  const entities={account_name:'',category_name:'',payee_name:'',family_member_name:''};
  const account = raw.match(/(?:na|da) conta\s+(.+?)(?=\s+(?:em|no|na|com|de|categoria|para|pro|pra)\b|[,.]|$)/i);
  if(account?.[1]) entities.account_name=_agentCleanEntityValue(account[1]);

  const payeePatterns=[
    /conta\s+.+?\s+em\s+(.+?)(?=\s+com\b|\s+categoria\b|[,.]|$)/i,
    /categoria\s+.+?\s+para\s+(.+?)(?=[,.]|$)/i,
    /\bpara\s+(.+?)(?=\s+com\b|[,.]|$)/i,
    /\bem\s+(.+?)(?=\s+com\b|\s+categoria\b|[,.]|$)/i,
    /\bno\s+(.+?)(?=\s+com\b|\s+categoria\b|[,.]|$)/i,
    /\bna\s+(.+?)(?=\s+com\b|\s+categoria\b|[,.]|$)/i
  ];
  for(const rx of payeePatterns){ const m=raw.match(rx); if(m?.[1] && !/^conta\b/i.test(m[1]) && !/^categoria\b/i.test(m[1])) { entities.payee_name=_agentCleanEntityValue(m[1]); break; } }

  const categoryPatterns=[
    /categoria\s+(.+?)(?=\s+(?:para|em|no|na|pro|pra|com)\b|[,.]|$)/i,
    /\bcom\s+([A-Za-zÀ-ÿ][^,.;]*?)(?=[,.]|$)/i,
    /conta\s+.+?\s+de\s+([A-Za-zÀ-ÿ][^,.;]*?)(?=[,.]|$)/i
  ];
  for(const rx of categoryPatterns){ const m=raw.match(rx); if(m?.[1] && !/reais?|r\$/i.test(m[1])) { entities.category_name=_agentCleanEntityValue(m[1]); break; } }

  const member=raw.match(/(?:pelo|pela|pro|pra|para)\s+([A-ZÀ-ÿ][^,.;]+)$/i);
  if(member?.[1] && /programad/i.test(raw)) entities.family_member_name=_agentCleanEntityValue(member[1]);
  if(entities.payee_name && entities.account_name && _agentNormalize(entities.payee_name)===_agentNormalize(entities.account_name)) entities.payee_name='';
  return entities;
}
function _agentExtractSuggestionContext(text){
  const raw=String(text||'');
  let field=''; let query='';
  const category = raw.match(/(?:categoria|com)\s+([^,.;]*)$/i) || raw.match(/conta\s+.+?\s+de\s+([^,.;]*)$/i);
  const payee = raw.match(/(?:em|no|na|para)\s+([^,.;]*)$/i);
  const account = raw.match(/(?:na|da) conta\s+([^,.;]*?)$/i);
  if(category && !/(?:r\$|reais?)/i.test(category[1])){ field='category'; query=_agentCleanEntityValue(category[1]); }
  else if(payee && !/^conta/i.test(payee[1]) && !/^categoria/i.test(payee[1])){ field='payee'; query=_agentCleanEntityValue(payee[1]); }
  else if(account && !/(?:em|no|na|com|de|categoria|para)/i.test(account[1])){ field='account'; query=_agentCleanEntityValue(account[1]); }
  return {field,query};
}
function _agentBuildInputSuggestions(text){
  const raw=String(text||'').trim();
  if(!raw) return [];
  const ctx=_agentExtractSuggestionContext(raw);
  const out=[];
  if(ctx.field==='account'){
    _agentFindCandidates(state.accounts||[], ctx.query, {kind:'account',limit:5}).forEach(c=>out.push({label:`Conta: ${c.item.name}`, apply: raw.replace(/(?:na|da) conta\s+([^,.;]*)$/i, (m)=>m.replace(/([^,.;]*)$/,'') + c.item.name)}));
  } else if(ctx.field==='category'){
    _agentFindCandidates(state.categories||[], ctx.query, {kind:'category',limit:5}).forEach(c=>out.push({label:`Categoria: ${c.item.name}`, apply: raw.replace(/(?:categoria|com|de)\s+([^,.;]*)$/i, (m)=>m.replace(/([^,.;]*)$/,'') + c.item.name)}));
  } else if(ctx.field==='payee'){
    _agentFindCandidates(state.payees||[], ctx.query, {kind:'payee',limit:5}).forEach(c=>out.push({label:`Beneficiário: ${c.item.name}`, apply: raw.replace(/(?:em|no|na|para)\s+([^,.;]*)$/i, (m)=>m.replace(/([^,.;]*)$/,'') + c.item.name)}));
  }
  if(!out.length){
    ['Crie uma despesa de R$ 50 na conta ','Crie uma despesa de R$ 30 em ','Crie uma despesa de R$ 25 com Alimentação','Crie transação programada mensal de R$ '].forEach(t=>{ if(t.toLowerCase().includes(raw.toLowerCase())||raw.length<10) out.push({label:t,apply:t}); });
  }
  return out.slice(0,5);
}
function _agentRenderComposerSuggestions(text){
  const box=document.getElementById('agentComposerSuggestions');
  if(!box) return;
  const suggestions=_agentBuildInputSuggestions(text);
  _agent.liveSuggestions=suggestions;
  if(!suggestions.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.innerHTML='';
  suggestions.forEach((s)=>{ const b=document.createElement('button'); b.type='button'; b.className='agent-chip agent-chip--ghost'; b.textContent=s.label; b.onclick=()=>window.agentApplySuggestion(s.apply); box.appendChild(b); });
  box.style.display='flex';
}
function _agentExtractAfter(text,regexes){for(const rx of regexes){const m=String(text||'').match(rx);if(m?.[1])return m[1].trim().replace(/["“”]/g,'');}return'';}
function _agentExtractPayee(text){return _agentExtractEntities(text).payee_name||'';}
function _agentParseDescription(text, entities){
  const e=entities||_agentExtractEntities(text);
  if(e.payee_name) return e.payee_name;
  if(e.category_name && !e.account_name) return e.category_name;
  const t=String(text||'').trim();
  const q=t.match(/["“”](.+?)["“”]/); if(q?.[1]) return q[1].trim();
  return 'Lançamento via Agent';
}

function _agentParseAmount(text){const m=String(text||'').match(/(?:r\$\s*)?(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|-?\d+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i);if(!m)return null;let v=m[1].replace(/\s/g,'');if(v.includes(',')&&v.includes('.'))v=v.replace(/\./g,'').replace(',','.');else if(v.includes(','))v=v.replace(',','.');const n=parseFloat(v);return Number.isFinite(n)?n:null;}
function _agentParseDate(text){const msg=String(text||'').toLowerCase();const dt=new Date();if(/amanh[ãa]/.test(msg))dt.setDate(dt.getDate()+1);else if(/ontem/.test(msg))dt.setDate(dt.getDate()-1);const abs=String(text||'').match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);if(abs){let yy=abs[3]?Number(abs[3]):dt.getFullYear();if(yy<100)yy+=2000;const p=new Date(yy,Number(abs[2])-1,Number(abs[1]),12,0,0);if(!isNaN(p))return p.toISOString().slice(0,10);}return dt.toISOString().slice(0,10);}
function _agentParseFrequency(msg){if(/seman/.test(msg))return'weekly';if(/anual|ano/.test(msg))return'yearly';if(/di[aá]ri/.test(msg))return'daily';if(/mensa|m[eê]s/.test(msg))return'monthly';return null;}
function _agentParseInstallments(msg){const m=String(msg||'').match(/(\d+)\s*parcelas?/i);if(!m)return null;const n=Number(m[1]);return Number.isFinite(n)?n:null;}
function _agentParseColor(msg){const map={azul:'#2563eb',verde:'#16a34a',vermelho:'#dc2626',laranja:'#f97316',roxo:'#7c3aed',amarelo:'#f59e0b',rosa:'#ec4899',cinza:'#6b7280'};return map[Object.keys(map).find(c=>msg.includes(c))||'']||'#2a6049';}

async function _agentRefreshAfterPlan(plan){
  try{
    if(plan.intent==='create_transaction'){if(typeof DB!=='undefined'&&DB.accounts?.bust)DB.accounts.bust();if(typeof loadTransactions==='function')await loadTransactions();if(typeof loadDashboard==='function')await loadDashboard();}
    if(plan.intent==='create_scheduled'&&typeof loadScheduled==='function')await loadScheduled();
    if(plan.intent==='create_payee'&&typeof loadPayees==='function')await loadPayees(true);
    if(plan.intent==='create_category'&&typeof loadCategories==='function')await loadCategories();
    if(plan.intent==='create_debt'&&state.currentPage==='debts'&&typeof loadDebts==='function')await loadDebts();
  }catch(e){console.warn('[agent refresh]',e?.message||e);}
}

function _agentAnswerBalance(){_agentAppend('assistant',_agentFinanceBalances());}

function _agentAppend(role,text){_agent.history.push({role,text});_agentRenderMessage(role,text);}
function _agentRenderMessage(role,text){
  const feed=document.getElementById('agentFeed');
  if(!feed)return;
  const msg=document.createElement('div');
  msg.className=`agent-msg agent-msg--${role}`;
  msg.innerHTML=`<div class="agent-bubble">${role!=='user'?'<span class="agent-avatar">🤖</span>':''}<div class="agent-text">${_agentMarkdown(text)}</div></div>`;
  feed.appendChild(msg);
  feed.scrollTop=feed.scrollHeight;
}
function _agentMarkdown(text){return String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`(.+?)`/g,'<code>$1</code>').replace(/\n/g,'<br>');}
function _agentSetLoading(on){
  _agent.loading=on;
  const btn=document.getElementById('agentSendBtn'),ind=document.getElementById('agentLoading');
  if(btn)btn.disabled=on;if(ind)ind.style.display=on?'':'none';
  document.querySelectorAll('.agent-loading').forEach(el=>el.remove());
  if(!on)return;
  const feed=document.getElementById('agentFeed');if(!feed)return;
  const el=document.createElement('div');
  el.className='agent-msg agent-msg--assistant agent-loading';
  el.innerHTML='<div class="agent-bubble"><span class="agent-avatar">🤖</span><div class="agent-typing"><span></span><span></span><span></span></div></div>';
  feed.appendChild(el);feed.scrollTop=feed.scrollHeight;
}
