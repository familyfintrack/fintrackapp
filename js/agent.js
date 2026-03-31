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
  inputTimer: null,
  memory: _agentLoadMemory(),
  learned: _agentLoadLearnedPatterns(),
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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentSend(); }
};

window.agentSuggest = function(text) {
  const input = document.getElementById('agentInput');
  if (input) {
    input.value = text;
    input.focus();
    agentInputChanged(text);
  }
};

window.agentPickSuggestion = function(kind, value) {
  const input = document.getElementById('agentInput');
  if (!input) return;
  const injected = _agentInjectSuggestion(input.value || '', kind, value);
  input.value = injected;
  input.focus();
  agentInputChanged(injected);
};

window.agentInputChanged = function(value) {
  const v = String(value || '');
  const input = document.getElementById('agentInput');
  if (input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }
  clearTimeout(_agent.inputTimer);
  if (!v.trim()) {
    _agentRenderSuggestions([]);
    return;
  }
  _agent.inputTimer = setTimeout(async () => {
    try {
      await _agentEnsureContextLoaded();
      _agentRenderSuggestions(_agentSuggestFromText(v));
    } catch (_) {
      _agentRenderSuggestions([]);
    }
  }, 120);
};


function _agentLoadMemory() {
  try { return JSON.parse(localStorage.getItem('fintrack_agent_memory') || '{}') || {}; }
  catch (_) { return {}; }
}

function _agentSaveMemory() {
  try { localStorage.setItem('fintrack_agent_memory', JSON.stringify(_agent.memory || {})); } catch (_) {}
}

function _agentLoadLearnedPatterns() {
  try {
    const raw = JSON.parse(localStorage.getItem('fintrack_agent_learned') || '{}') || {};
    raw.payeeToCategory = raw.payeeToCategory || {};
    raw.payeeToAccount = raw.payeeToAccount || {};
    raw.categoryToAccount = raw.categoryToAccount || {};
    return raw;
  } catch (_) {
    return { payeeToCategory:{}, payeeToAccount:{}, categoryToAccount:{} };
  }
}

function _agentSaveLearnedPatterns() {
  try { localStorage.setItem('fintrack_agent_learned', JSON.stringify(_agent.learned || {})); } catch (_) {}
}

function _agentRememberPlan(plan) {
  const action = plan?.actions?.[0];
  const d = action?.data || {};
  if (!action) return;
  _agent.memory.last_intent = plan.intent || action.type;
  if (d.account_name) _agent.memory.last_account_name = d.account_name;
  if (d.category_name) _agent.memory.last_category_name = d.category_name;
  if (d.payee_name) _agent.memory.last_payee_name = d.payee_name;
  _agent.memory.last_plan_at = new Date().toISOString();
  _agentSaveMemory();
}

function _agentLearnFromPlan(plan) {
  const action = plan?.actions?.[0];
  const d = action?.data || {};
  if (!action) return;
  const payee = _agentNorm(d.payee_name || d.description || '');
  const account = d.account_name || '';
  const category = d.category_name || '';
  if (payee && category) _agentIncrementPattern(_agent.learned.payeeToCategory, payee, category);
  if (payee && account) _agentIncrementPattern(_agent.learned.payeeToAccount, payee, account);
  if (category && account) _agentIncrementPattern(_agent.learned.categoryToAccount, _agentNorm(category), account);
  _agentSaveLearnedPatterns();
}

function _agentIncrementPattern(bucket, key, value) {
  if (!bucket || !key || !value) return;
  bucket[key] = bucket[key] || {};
  bucket[key][value] = (bucket[key][value] || 0) + 1;
}

function _agentTopPattern(bucket, key) {
  const map = bucket?.[key];
  if (!map) return '';
  return Object.entries(map).sort((a,b) => b[1]-a[1])[0]?.[0] || '';
}

function _agentNorm(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

function _agentEditDistance(a, b) {
  a = _agentNorm(a); b = _agentNorm(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function _agentSimilarity(a, b) {
  const na = _agentNorm(a), nb = _agentNorm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return Math.max(0.88, Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  const dist = _agentEditDistance(na, nb);
  return 1 - (dist / Math.max(na.length, nb.length, 1));
}

function _agentFindCandidates(list, name) {
  const q = _agentNorm(name);
  if (!q) return [];
  return (list || []).map(item => ({ item, score: _agentSimilarity(item?.name || '', q) }))
    .filter(x => x.score >= 0.45)
    .sort((a,b) => b.score - a.score)
    .slice(0, 5);
}

function _agentRenderSuggestions(groups) {
  const box = document.getElementById('agentInlineSuggestions');
  if (!box) return;
  if (!groups || !groups.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.innerHTML = groups.map(group => `
    <div class="agent-sg-group">
      <div class="agent-sg-label">${group.label}</div>
      <div class="agent-sg-row">${group.items.map(item => `<button type="button" class="agent-sg-chip" onclick="agentPickSuggestion('${group.kind}','${String(item.value || item.name || '').replace(/'/g, "&#39;")}')">${item.badge ? `<span class="agent-sg-badge">${item.badge}</span>` : ''}${item.label || item.name || item.value}</button>`).join('')}</div>
    </div>`).join('');
  box.style.display = '';
}

function _agentSuggestFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const entities = _agentExtractEntities(raw);
  const groups = [];
  const accItems = _agentFindCandidates(state.accounts || [], entities.account_name || raw).map(x => ({ value:x.item.name, label:x.item.name, badge:'Conta' }));
  if (accItems.length) groups.push({ kind:'account', label:'Contas sugeridas', items:accItems });
  const catItems = _agentFindCandidates(state.categories || [], entities.category_name || raw).map(x => ({ value:x.item.name, label:x.item.name, badge:'Categoria' }));
  if (catItems.length) groups.push({ kind:'category', label:'Categorias sugeridas', items:catItems });
  const payItems = _agentFindCandidates(state.payees || [], entities.payee_name || entities.description || raw).map(x => ({ value:x.item.name, label:x.item.name, badge:'Beneficiário' }));
  if (payItems.length) groups.push({ kind:'payee', label:'Beneficiários sugeridos', items:payItems });

  const payeeKey = _agentNorm(entities.payee_name || entities.description || '');
  const learnedCategory = _agentTopPattern(_agent.learned.payeeToCategory, payeeKey);
  const learnedAccount = _agentTopPattern(_agent.learned.payeeToAccount, payeeKey) || _agentTopPattern(_agent.learned.categoryToAccount, _agentNorm(entities.category_name || ''));
  const learnedItems = [];
  if (learnedAccount) learnedItems.push({ value: learnedAccount, label: learnedAccount, badge:'Conta preferida' });
  if (learnedCategory) learnedItems.push({ value: learnedCategory, label: learnedCategory, badge:'Categoria provável' });
  if (learnedItems.length) groups.unshift({ kind: learnedAccount ? 'account' : 'category', label:'Sugestões aprendidas', items: learnedItems });

  return groups.slice(0, 3);
}

function _agentInjectSuggestion(current, kind, value) {
  const text = String(current || '').trim();
  const safe = String(value || '').trim();
  if (!safe) return text;
  if (kind === 'account') {
    if (/\b(na|da) conta\b/i.test(text)) return text.replace(/((?:na|da) conta)\s+([^,.;]+)/i, `$1 ${safe}`);
    return `${text} na conta ${safe}`.trim();
  }
  if (kind === 'category') {
    if (/\bcategoria\b/i.test(text)) return text.replace(/(categoria)\s+([^,.;]+)/i, `$1 ${safe}`);
    if (/\bcom\b/i.test(text)) return text.replace(/(com)\s+([^,.;]+)/i, `$1 ${safe}`);
    return `${text} com ${safe}`.trim();
  }
  if (kind === 'payee') {
    if (/\b(em|no|na|para)\b/i.test(text)) return text.replace(/(em|no|na|para)\s+([^,.;]+)/i, `$1 ${safe}`);
    return `${text} para ${safe}`.trim();
  }
  return text;
}

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
  if (_agent.pendingPlan && _agent.pendingPlan._clarification) {
    const clarified = _agentApplyClarification(_agent.pendingPlan, text);
    if (clarified) {
      _agent.pendingPlan = null;
      await _agentExecute(clarified, text);
      return;
    }
  }

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
  const key = await _agentGetKey();

  if (direct.intent !== 'not_understood') {
    if (key && _agentPlanNeedsAI(direct, userMessage)) {
      try {
        _agent.apiKey = key;
        const aiPlan = await _agentPlanWithGemini(userMessage);
        return _agentMergePlans(direct, _agentNormalizePlan(aiPlan, userMessage), userMessage);
      } catch (e) {
        console.warn('[agent ai plan fallback]', e?.message || e);
      }
    }
    return direct;
  }

  if (!key) return { ...direct, _noKey: true };
  _agent.apiKey = key;
  const aiPlan = await _agentPlanWithGemini(userMessage);
  return _agentNormalizePlan(aiPlan, userMessage);
}

function _agentPlanNeedsAI(plan, userMessage) {
  const d = plan?.actions?.[0]?.data || {};
  const msg = _agentNorm(userMessage);
  return !d.account_name || (!d.category_name && /(categoria|com|aliment|mercado|lazer|transporte|saude|moradia|restaurante)/.test(msg)) || /mesma conta|igual a antes|como da ultima|como antes/.test(msg);
}

function _agentMergePlans(direct, aiPlan, originalText) {
  if (!aiPlan || aiPlan.intent === 'not_understood') return direct;
  const merged = JSON.parse(JSON.stringify(direct));
  const base = merged.actions?.[0]?.data || {};
  const alt = aiPlan.actions?.[0]?.data || {};
  if (merged.actions?.[0]) {
    merged.actions[0].data = {
      ...base,
      ...Object.fromEntries(Object.entries(alt).filter(([_,v]) => v !== null && v !== undefined && v !== ''))
    };
  }
  merged.intent = aiPlan.intent || merged.intent;
  merged.summary = aiPlan.summary || merged.summary;
  merged.requires_confirmation = !!(aiPlan.requires_confirmation || merged.requires_confirmation);
  return _agentNormalizePlan(merged, originalText);
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
  const raw = String(text || '').trim();
  const msg = _agentNorm(raw);
  const amount = _agentParseAmount(raw);
  const date = _agentParseDate(raw);
  const entities = _agentExtractEntities(raw);

  if (/saldo total|qual .*saldo|quanto .*saldo/.test(msg))
    return {intent:'query_balance',summary:'Consultando saldo',requires_confirmation:false,actions:[]};

  if (/\b(abr[ia]|ir para|naveg)\b/.test(msg)) {
    const page = _agentExtractNavPage(text);
    if (page) return {intent:'navigate',summary:`Abrindo ${page}`,requires_confirmation:false,actions:[{type:'navigate',data:{page}}]};
  }

  if (/(cri[ea]r?|adicionar?|adicione|lanc[ae]r?|registrar?|registre)\s.*?(transac|despesa|receita)/.test(msg) && amount !== null) {
    const isIncome = /(receita|entrada|ganho|recebimento)/.test(msg);
    return {intent:'create_transaction',summary:'Criando transação',requires_confirmation:false,actions:[{type:'create_transaction',data:{
      date,
      amount:isIncome?Math.abs(amount):-Math.abs(amount),
      type:isIncome?'income':'expense',
      description:entities.description || 'Lançamento via Agent',
      account_name:entities.account_name,
      category_name:entities.category_name,
      payee_name:entities.payee_name,
      family_member_name:entities.family_member_name,
    }}]};
  }

  if (/programad/.test(msg) && amount !== null) {
    return {intent:'create_scheduled',summary:'Criando programado',requires_confirmation:false,actions:[{type:'create_scheduled',data:{
      date,
      amount:/receita|entrada/.test(msg)?Math.abs(amount):-Math.abs(amount),
      type:/receita|entrada/.test(msg)?'income':'expense',
      description:entities.description || 'Programado via Agent',
      account_name:entities.account_name,
      category_name:entities.category_name,
      payee_name:entities.payee_name,
      frequency:_agentParseFrequency(msg)||'monthly',
      start_date:date,
      installments:_agentParseInstallments(msg),
      family_member_name:entities.family_member_name,
    }}]};
  }

  if (/benefici[aá]rio|favorecido/.test(msg) && /(cri[ea]|adicione)/.test(msg)) {
    const name = entities.payee_name || _agentExtractAfter(raw,[/benefici[aá]rio\s+([^,.;]+)/i,/favorecido\s+([^,.;]+)/i]);
    if (name) return {intent:'create_payee',summary:'Criando beneficiário',requires_confirmation:false,actions:[{type:'create_payee',data:{name}}]};
  }

  if (/categoria/.test(msg) && /(cri[ea]|adicione)/.test(msg)) {
    const name = entities.category_name || _agentExtractAfter(raw,[/categoria\s+([^,.;]+)/i]);
    if (name) return {intent:'create_category',summary:'Criando categoria',requires_confirmation:false,actions:[{type:'create_category',data:{name,type:'expense',color:_agentParseColor(msg)}}]};
  }

  if (/d[ií]vida/.test(msg) && amount !== null)
    return {intent:'create_debt',summary:'Criando dívida',requires_confirmation:false,actions:[{type:'create_debt',data:{description:entities.description || 'Dívida via Agent',creditor:entities.payee_name || _agentExtractPayee(raw),original_amount:Math.abs(amount),start_date:date}}]};

  return {intent:'not_understood',summary:'',requires_confirmation:false,actions:[]};
}

function _agentExtractEntities(text) {
  const raw = String(text || '').trim();
  const msg = _agentNorm(raw);
  const entities = { account_name:'', category_name:'', payee_name:'', family_member_name:'', description:'' };
  const quoted = raw.match(/["“](.+?)["”]/);
  if (quoted?.[1]) entities.description = quoted[1].trim();

  entities.account_name = _agentCleanEntity(_agentExtractAfter(raw,[/(?:na|da)\s+conta\s+([^,.;]+?)(?=\s+(?:em|no|na|com|categoria|para|pelo|pela|do|da)\b|$)/i]));
  entities.category_name = _agentCleanEntity(_agentExtractAfter(raw,[/(?:categoria\s+)([^,.;]+?)(?=\s+(?:para|em|no|na|pelo|pela|do|da)\b|$)/i,/(?:com\s+)([^,.;]+?)(?=\s+(?:para|em|no|na|pelo|pela|do|da)\b|$)/i]));
  entities.payee_name = _agentCleanEntity(_agentExtractAfter(raw,[/(?:em|para)\s+([^,.;]+?)(?=\s+(?:com|categoria|pelo|pela|do|da)\b|$)/i,/(?:no|na)\s+([^,.;]+?)(?=\s+(?:com|categoria|pelo|pela|do|da)\b|$)/i]));
  entities.family_member_name = _agentCleanEntity(_agentExtractAfter(raw,[/(?:pelo|pela)\s+([^,.;]+)$/i]));

  if (entities.payee_name && /^conta\b/i.test(entities.payee_name)) entities.payee_name = '';
  if (!entities.description) entities.description = entities.payee_name || entities.category_name || 'Lançamento via Agent';

  if (/mesma conta|igual a antes|como da ultima|como antes/.test(msg)) entities.account_name = _agent.memory.last_account_name || entities.account_name;
  if (/mesma categoria|categoria de antes|como antes/.test(msg)) entities.category_name = _agent.memory.last_category_name || entities.category_name;
  if (/mesmo beneficiario|mesmo lugar|como antes/.test(msg)) entities.payee_name = _agent.memory.last_payee_name || entities.payee_name;

  return entities;
}

function _agentCleanEntity(value) {
  return String(value || '').trim().replace(/^(de|do|da)\s+/i,'').replace(/["“”]/g,'').trim();
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

  if (normalized.intent==='not_understood') {
    _agentAppend('assistant', normalized._noKey
      ? '🤔 Pedido não reconhecido.\n\nPara pedidos complexos, configure a **chave Gemini** em Configurações → IA.\n\nOu tente: *"Quanto gastei este mês?"* ou *"Como criar uma conta?"*'
      : '🤔 Não consegui mapear esse pedido.\n\nTente:\n• *"Crie despesa de R$50 em Alimentação"*\n• *"Quanto gastei este mês?"*\n• *"Como criar uma conta?"*'
    );
    return;
  }

  if (normalized.intent==='confirm') {
    if (!_agent.pendingPlan) { _agentAppend('assistant','Não há ação pendente.'); return; }
    plan=_agent.pendingPlan; _agent.pendingPlan=null;
  } else if (normalized.requires_confirmation) {
    _agent.pendingPlan=normalized;
    _agentAppend('assistant',`🧾 ${normalized.summary||'Ação a executar.'}\n\nDigite **ok** para confirmar.`);
    return;
  } else {
    plan=normalized;
  }

  if (plan.intent==='query_balance') { _agentAnswerBalance(); return; }

  await _agentEnsureContextLoaded();
  plan = _agentHydratePlanFromMemory(plan);
  const clarification = _agentMaybeClarifyPlan(plan);
  if (clarification) {
    _agent.pendingPlan = clarification.plan;
    _agentAppend('assistant', clarification.message);
    return;
  }

  if (plan.intent==='navigate') {
    const page=plan.actions?.[0]?.data?.page;
    if (page&&typeof navigate==='function') { navigate(page); _agentAppend('assistant',`✅ Abrindo **${page}**.`); return; }
  }

  _agentAppend('assistant',`🔄 **${plan.summary||'Executando…'}**`);
  const results=[], ctx={};
  for (const action of (plan.actions||[])) {
    try { results.push(await _agentRunAction(action,ctx)); }
    catch (e) { results.push({ok:false,msg:`Erro em ${action.type}: ${e.message}`}); }
  }
  const allOk=results.length&&results.every(r=>r.ok);
  _agentAppend('assistant',results.map(r=>r.ok?`✅ ${r.msg}`:`❌ ${r.msg}`).join('\n')+(allOk?'\n\n*Tudo pronto!*':''));
  if (allOk) {
    _agentRememberPlan(plan);
    _agentLearnFromPlan(plan);
    await _agentRefreshAfterPlan(plan);
  }
}


function _agentHydratePlanFromMemory(plan) {
  const clone = JSON.parse(JSON.stringify(plan || {}));
  const d = clone?.actions?.[0]?.data;
  if (!d) return clone;
  if (!d.account_name) {
    d.account_name = _agentTopPattern(_agent.learned.payeeToAccount, _agentNorm(d.payee_name || d.description || ''))
      || _agentTopPattern(_agent.learned.categoryToAccount, _agentNorm(d.category_name || ''))
      || _agent.memory.last_account_name
      || d.account_name;
  }
  if (!d.category_name) {
    d.category_name = _agentTopPattern(_agent.learned.payeeToCategory, _agentNorm(d.payee_name || d.description || ''))
      || _agent.memory.last_category_name
      || d.category_name;
  }
  if (!d.payee_name && d.description && !/^lancamento via agent$/i.test(d.description)) d.payee_name = d.description;
  return clone;
}

function _agentMaybeClarifyPlan(plan) {
  const action = plan?.actions?.[0];
  const d = action?.data || {};
  if (!action || !['create_transaction','create_scheduled'].includes(action.type)) return null;
  const fields = [
    { key:'account_name', label:'conta', list: state.accounts || [] },
    { key:'category_name', label:'categoria', list: state.categories || [] },
    { key:'payee_name', label:'beneficiário', list: state.payees || [] },
  ];
  for (const field of fields) {
    const raw = d[field.key];
    if (!raw && field.key === 'payee_name') continue;
    if (!raw) {
      if (field.key === 'account_name' && field.list.length > 1) {
        return {
          message: `🤔 Qual **conta** devo usar?\n\n${field.list.slice(0,5).map(x => `• ${x.name}`).join('\n')}`,
          plan: { ...plan, _clarification:{ field: field.key, options: field.list.slice(0,5).map(x => x.name) } }
        };
      }
      continue;
    }
    const exact = _agentFindByName(field.list, raw);
    if (exact) { d[field.key] = exact.name; continue; }
    const candidates = _agentFindCandidates(field.list, raw);
    if (candidates[0]?.score >= 0.83) { d[field.key] = candidates[0].item.name; continue; }
    if (candidates.length > 1) {
      const opts = candidates.slice(0,3).map(c => c.item.name);
      return {
        message: `🤔 Fiquei em dúvida sobre a **${field.label}** \`${raw}\`. Você quis dizer:\n\n${opts.map(o => `• ${o}`).join('\n')}\n\nResponda só com o nome correto.`,
        plan: { ...plan, _clarification:{ field: field.key, options: opts } }
      };
    }
    if (!candidates.length && field.key !== 'payee_name') {
      return {
        message: `🤔 Não encontrei a **${field.label}** \`${raw}\`. Responda com o nome correto para eu continuar.`,
        plan: { ...plan, _clarification:{ field: field.key, options: [] } }
      };
    }
  }
  return null;
}

function _agentApplyClarification(plan, reply) {
  const clarified = JSON.parse(JSON.stringify(plan || {}));
  const field = clarified?._clarification?.field;
  if (!field || !clarified?.actions?.[0]?.data) return null;
  clarified.actions[0].data[field] = String(reply || '').trim();
  delete clarified._clarification;
  clarified.requires_confirmation = false;
  return clarified;
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
  const ex=_agentFindByName(state.categories||[],c);
  if(ex){ctx.category_id=ex.id;return{ok:true,msg:`Categoria **${ex.name}** encontrada`};}
  const dbType = _agentMapCategoryType(type);
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

function _agentResolveAccountObj(id,name){const a=state.accounts||[];if(id)return a.find(x=>x.id===id)||null;if(!name)return a[0]||null;return _agentFindByName(a,name)||_agentFindCandidates(a,name)?.[0]?.item||null;}
function _agentResolveCategory(name){return name?_agentFindByName(state.categories||[],name)?.id||_agentFindCandidates(state.categories||[],name)?.[0]?.item?.id||null:null;}
function _agentResolvePayee(name){return name?_agentFindByName(state.payees||[],name)?.id||_agentFindCandidates(state.payees||[],name)?.[0]?.item?.id||null:null;}
function _agentFindByName(list,name){
  const n=_agentNorm(name);
  if(!n) return null;
  return list.find(i=>_agentNorm(i?.name||'')=== n)
      ||list.find(i=>_agentNorm(i?.name||'').includes(n))
      ||list.find(i=>n.includes(_agentNorm(i?.name||'')))
      ||null;
}

function _agentMapCategoryType(type){
  const t=_agentNorm(type);
  if(['expense','despesa'].includes(t)) return 'despesa';
  if(['income','receita'].includes(t)) return 'receita';
  if(['transfer','transferencia'].includes(t)) return 'transferencia';
  return 'despesa';
}

async function _agentGetKey(){if(_agent.apiKey)return _agent.apiKey;try{const k=await getAppSetting('gemini_api_key','');_agent.apiKey=k||null;return _agent.apiKey;}catch(_){return null;}}
function _agentGetUser(){try{if(typeof currentUser!=='undefined'&&currentUser)return currentUser;}catch(_){}return window.currentUser||state?.user||null;}
function _agentGetFamilyId(){const u=_agentGetUser();try{if(typeof famId==='function')return famId()||u?.family_id||state?.familyId||null;}catch(_){}return u?.family_id||state?.familyId||null;}
async function _agentEnsureContextLoaded(){
  if(!window.sb) throw new Error('Cliente Supabase não inicializado no app.');
  if(!_agentGetFamilyId()) throw new Error('Sessão não identificada. Faça login novamente.');
  try{
    if((!state.accounts||!state.accounts.length)&&typeof DB!=='undefined'&&DB.accounts?.load) await DB.accounts.load();
    if((!state.categories||!state.categories.length)&&typeof loadCategories==='function') await loadCategories();
    if((!state.payees||!state.payees.length)&&typeof loadPayees==='function'){try{await loadPayees(true);}catch(_){await loadPayees();}}
    if((!state.scheduled||!state.scheduled.length)&&typeof loadScheduled==='function') await loadScheduled();
  }catch(e){console.warn('[agent]preload:',e?.message||e);}
}
function _agentBuildContext(){return{today:new Date().toISOString().slice(0,10),accounts:(state.accounts||[]).slice(0,30).map(a=>({id:a.id,name:a.name,type:a.type,currency:a.currency||'BRL'})),categories:(state.categories||[]).slice(0,50).map(c=>({id:c.id,name:c.name,type:c.type})),payees:(state.payees||[]).slice(0,50).map(p=>({id:p.id,name:p.name})),};}

function _agentIsConfirmation(msg){return /^(ok|pode|confirmo|confirmar|sim|manda ver|prosseguir)$/i.test(String(msg).trim());}
function _agentParseAmount(text){const m=String(text||'').match(/(?:r\$\s*)?(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|-?\d+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i);if(!m)return null;let v=m[1].replace(/\s/g,'');if(v.includes(',')&&v.includes('.'))v=v.replace(/\./g,'').replace(',','.');else if(v.includes(','))v=v.replace(',','.');const n=parseFloat(v);return Number.isFinite(n)?n:null;}
function _agentParseDate(text){const msg=String(text||'').toLowerCase();const dt=new Date();if(/amanh[ãa]/.test(msg))dt.setDate(dt.getDate()+1);else if(/ontem/.test(msg))dt.setDate(dt.getDate()-1);const abs=String(text||'').match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);if(abs){let yy=abs[3]?Number(abs[3]):dt.getFullYear();if(yy<100)yy+=2000;const p=new Date(yy,Number(abs[2])-1,Number(abs[1]),12,0,0);if(!isNaN(p))return p.toISOString().slice(0,10);}return dt.toISOString().slice(0,10);}
function _agentParseFrequency(msg){if(/seman/.test(msg))return'weekly';if(/anual|ano/.test(msg))return'yearly';if(/di[aá]ri/.test(msg))return'daily';if(/mensa|m[eê]s/.test(msg))return'monthly';return null;}
function _agentParseInstallments(msg){const m=String(msg||'').match(/(\d+)\s*parcelas?/i);if(!m)return null;const n=Number(m[1]);return Number.isFinite(n)?n:null;}
function _agentParseColor(msg){const map={azul:'#2563eb',verde:'#16a34a',vermelho:'#dc2626',laranja:'#f97316',roxo:'#7c3aed',amarelo:'#f59e0b',rosa:'#ec4899',cinza:'#6b7280'};return map[Object.keys(map).find(c=>msg.includes(c))||'']||'#2a6049';}
function _agentExtractAfter(text,regexes){for(const rx of regexes){const m=String(text||'').match(rx);if(m?.[1])return m[1].trim().replace(/["""]/g,'');}return'';}
function _agentExtractPayee(text){return _agentExtractEntities(text).payee_name||'';}
function _agentParseDescription(text){return _agentExtractEntities(text).description||'Lançamento via Agent';}

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
