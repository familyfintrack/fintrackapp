/* ═══════════════════════════════════════════════════════════════════════════
   AI INSIGHTS — Análise financeira inteligente + Chat financeiro
   Reutiliza a mesma infraestrutura Gemini já usada em receipt_ai.js e import_ai.js
   (RECEIPT_AI_KEY_SETTING, RECEIPT_AI_MODEL, getAppSetting)

   Módulos:
     1. Análise IA  — insights financeiros sobre dados pré-computados pelo app
     2. Chat IA     — perguntas em linguagem natural sobre suas finanças
     3. Enriquecimento — contexto adicional para classificação de transações

   Regra de ouro: a IA NUNCA calcula saldos/totais. Toda verdade financeira
   vem do app/banco. A IA apenas interpreta dados já computados.
═══════════════════════════════════════════════════════════════════════════ */

// ── Feature flag ──────────────────────────────────────────────────────────

async function isAiInsightsEnabled() {
  const famId = currentUser?.family_id;
  if (!famId) return false;
  const cacheKey = 'ai_insights_enabled_' + famId;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache) {
    return !!window._familyFeaturesCache[cacheKey];
  }
  const val = await getAppSetting(cacheKey, false);
  return val === true || val === 'true';
}

async function applyAiInsightsFeature() {
  const on = await isAiInsightsEnabled();
  const navEl = document.getElementById('aiInsightsNav');
  if (navEl) navEl.style.display = on ? '' : 'none';
  _syncModulesSection?.();
}

// ── Estado do módulo ───────────────────────────────────────────────────────

const _ai = {
  // Filtros ativos da tela de Análise
  filters: { dateFrom: '', dateTo: '', memberId: '', accountId: '', categoryId: '', payeeId: '' },
  // Resultado da última análise
  analysisResult: null,
  // Histórico do chat
  chatHistory: [],
  // Contexto financeiro gerado pelo app (não pela IA)
  financialContext: null,
  // Loading states
  analysisLoading: false,
  chatLoading: false,
};

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 1 — INICIALIZAÇÃO DA PÁGINA
// ══════════════════════════════════════════════════════════════════════════

async function initAiInsightsPage() {
  const enabled = await isAiInsightsEnabled();
  const page    = document.getElementById('page-ai_insights');
  if (!page) return;

  if (!enabled) {
    page.innerHTML = `
      <div class="ai-disabled-state">
        <div class="ai-disabled-icon">🤖</div>
        <h3>AI Insights não ativado</h3>
        <p>O módulo de IA não está habilitado para esta família.<br>
           Solicite ao administrador para ativar em <strong>Configurações → Módulos da Família</strong>.</p>
      </div>`;
    return;
  }

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    page.innerHTML = `
      <div class="ai-disabled-state">
        <div class="ai-disabled-icon">🔑</div>
        <h3>Chave Gemini não configurada</h3>
        <p>Configure a chave da API Gemini em <strong>Configurações → IA</strong> para usar os AI Insights.</p>
        <button class="btn btn-primary" onclick="showAiConfig()">Configurar IA</button>
      </div>`;
    return;
  }

  // Populate filter selects
  _aiPopulateFilters();

  // Set default date range (current month)
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  const dateFrom = document.getElementById('aiDateFrom');
  const dateTo   = document.getElementById('aiDateTo');
  if (dateFrom && !dateFrom.value) dateFrom.value = `${y}-${m}-01`;
  if (dateTo   && !dateTo.value)   dateTo.value   = `${y}-${m}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;

  // Show/hide tabs — start on Analysis tab
  _aiShowTab('analysis');

  // Render existing result if available
  if (_ai.analysisResult) _aiRenderAnalysis(_ai.analysisResult);
  if (_ai.chatHistory.length) _aiRenderChatHistory();
}

function _aiShowTab(tab) {
  ['analysis','chat'].forEach(t => {
    const btn   = document.getElementById('aiTab-' + t);
    const panel = document.getElementById('aiPanel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = t === tab ? '' : 'none';
  });
}

function _aiPopulateFilters() {
  // Members
  const memSel = document.getElementById('aiMemberFilter');
  if (memSel) {
    const members = state.profile ? [state.profile] : [];
    // Try to get all members from family_members if available
    const allMembers = window._familyMembers || members;
    memSel.innerHTML = '<option value="">Todos os membros</option>' +
      allMembers.map(m => `<option value="${esc(m.id || m.user_id || '')}">${esc(m.display_name || m.name || 'Membro')}</option>`).join('');
  }

  // Accounts
  const accSel = document.getElementById('aiAccountFilter');
  if (accSel) {
    accSel.innerHTML = '<option value="">Todas as contas</option>' +
      (state.accounts || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
  }

  // Categories
  const catSel = document.getElementById('aiCategoryFilter');
  if (catSel) {
    catSel.innerHTML = '<option value="">Todas as categorias</option>' +
      (state.categories || []).filter(c => !c.parent_id).map(c =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`
      ).join('');
  }

  // Payees
  const paySel = document.getElementById('aiPayeeFilter');
  if (paySel) {
    paySel.innerHTML = '<option value="">Todos os beneficiários</option>' +
      (state.payees || []).slice(0, 200).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 2 — COLETA E AGREGAÇÃO DE DADOS FINANCEIROS (pelo app, não pela IA)
// ══════════════════════════════════════════════════════════════════════════

async function _aiCollectFinancialContext() {
  // Lê filtros da UI
  const dateFrom   = document.getElementById('aiDateFrom')?.value   || '';
  const dateTo     = document.getElementById('aiDateTo')?.value     || '';
  const memberId   = document.getElementById('aiMemberFilter')?.value || '';
  const accountId  = document.getElementById('aiAccountFilter')?.value || '';
  const categoryId = document.getElementById('aiCategoryFilter')?.value || '';
  const payeeId    = document.getElementById('aiPayeeFilter')?.value   || '';

  // Busca transações no período
  let q = famQ(sb.from('transactions').select(
    'id,date,amount,amount_brl,brl_amount,is_transfer,is_card_payment,status,description,memo,category_id,payee_id,account_id,user_id,currency,exchange_rate'
  ).eq('status', 'confirmed'));

  if (dateFrom) q = q.gte('date', dateFrom);
  if (dateTo)   q = q.lte('date', dateTo);
  if (accountId)  q = q.eq('account_id', accountId);
  if (payeeId)    q = q.eq('payee_id', payeeId);
  if (categoryId) q = q.eq('category_id', categoryId);

  q = q.order('date', { ascending: false }).limit(2000);

  const { data: txs, error } = await q;
  if (error) throw new Error('Erro ao carregar transações: ' + error.message);

  const rows = txs || [];

  // Helpers para mapear IDs → nomes
  const catMap  = Object.fromEntries((state.categories || []).map(c => [c.id, c.name]));
  const payMap  = Object.fromEntries((state.payees     || []).map(p => [p.id, p.name]));
  const accMap  = Object.fromEntries((state.accounts   || []).map(a => [a.id, { name: a.name, currency: a.currency }]));

  // Filtro por membro (user_id)
  const filtered = memberId ? rows.filter(t => t.user_id === memberId) : rows;

  // Agregações (feitas pelo app, não pela IA)
  let totalIncome = 0, totalExpense = 0;
  const byCategory  = {};
  const byPayee     = {};
  const byMember    = {};
  const byMonth     = {};

  filtered.forEach(t => {
    const amt = Math.abs(parseFloat(t.brl_amount || t.amount_brl || 0));
    // Derive type from amount sign and flags (no 'type' column in schema)
    const rawAmt = parseFloat(t.amount || 0);
    const type = t.is_transfer
      ? (t.is_card_payment ? 'card_payment' : 'transfer')
      : rawAmt >= 0 ? 'income' : 'expense';

    if (type === 'income') {
      totalIncome += amt;
    } else if (type === 'expense') {
      totalExpense += amt;

      // Por categoria
      const catName = catMap[t.category_id] || 'Sem categoria';
      byCategory[catName] = (byCategory[catName] || 0) + amt;

      // Por beneficiário
      const payName = payMap[t.payee_id] || 'Sem beneficiário';
      byPayee[payName] = (byPayee[payName] || 0) + amt;

      // Por membro
      const memId = t.user_id || 'unknown';
      byMember[memId] = (byMember[memId] || 0) + amt;
    }

    // Por mês (todas as transações)
    const month = (t.date || '').slice(0, 7);
    if (month) {
      if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
      if (type === 'income') byMonth[month].income += amt;
      else if (type === 'expense') byMonth[month].expense += amt;
    }
  });

  // Top categorias e beneficiários
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2), pct: totalExpense ? +(amount/totalExpense*100).toFixed(1) : 0 }));

  const topPayees = Object.entries(byPayee)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

  // Membro → nome
  const memberMap = {};
  (window._familyMembers || []).forEach(m => { memberMap[m.id || m.user_id] = m.display_name || m.name; });

  const memberInsights = Object.entries(byMember)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amount]) => ({ name: memberMap[id] || id, amount: +amount.toFixed(2) }));

  // Transações agendadas
  const { data: sched } = await famQ(sb.from('scheduled_transactions').select('description,brl_amount,frequency,next_date,type')).limit(20);
  const scheduledSummary = (sched || []).slice(0, 10).map(s => ({
    description: s.description,
    amount: Math.abs(parseFloat(s.brl_amount || 0)),
    frequency: s.frequency,
    next_date: s.next_date,
    type: s.type,
  }));

  // Saldos atuais das contas (do state — computados pelo app)
  const accountBalances = (state.accounts || [])
    .filter(a => !accountId || a.id === accountId)
    .map(a => ({ name: a.name, balance: a.balance || 0, currency: a.currency }));

  // Anomalias simples: despesas > 2x a média do mesmo beneficiário/categoria no período
  const anomalies = _aiDetectAnomalies(filtered, catMap, payMap);

  // Tendência mensal
  const monthlyTrend = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, income: +v.income.toFixed(2), expense: +v.expense.toFixed(2), net: +(v.income - v.expense).toFixed(2) }));

  const ctx = {
    period: { from: dateFrom || 'início', to: dateTo || 'hoje' },
    summary: {
      totalIncome:   +totalIncome.toFixed(2),
      totalExpense:  +totalExpense.toFixed(2),
      netResult:     +(totalIncome - totalExpense).toFixed(2),
      txCount:       filtered.length,
    },
    topCategories,
    topPayees,
    memberInsights,
    monthlyTrend,
    scheduledSummary,
    accountBalances,
    anomalies,
    filters: { dateFrom, dateTo, memberId, accountId, categoryId, payeeId },
  };

  _ai.financialContext = ctx;
  return ctx;
}

function _aiDetectAnomalies(txs, catMap, payMap) {
  // Agrupa por beneficiário e calcula média e desvio padrão
  const payeeAmounts = {};
  txs.filter(t => { const r=parseFloat(t.amount||0); return !t.is_transfer && r < 0; }).forEach(t => {
    const name = payMap[t.payee_id] || 'Sem beneficiário';
    if (!payeeAmounts[name]) payeeAmounts[name] = [];
    payeeAmounts[name].push(Math.abs(parseFloat(t.brl_amount || t.amount_brl || 0)));
  });

  const anomalies = [];
  Object.entries(payeeAmounts).forEach(([payee, amounts]) => {
    if (amounts.length < 2) return;
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const max = Math.max(...amounts);
    if (max > avg * 2.5 && max > 50) {
      anomalies.push({ type: 'high_spend', payee, average: +avg.toFixed(2), max: +max.toFixed(2) });
    }
  });

  return anomalies.slice(0, 5);
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 3 — ANÁLISE IA
// ══════════════════════════════════════════════════════════════════════════

async function runAiAnalysis() {
  if (_ai.analysisLoading) return;

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) {
    toast(t('ai.no_api_key_config'), 'warning');
    showAiConfig();
    return;
  }

  _ai.analysisLoading = true;
  _aiSetAnalysisState('loading');

  try {
    const ctx    = await _aiCollectFinancialContext();
    const result = await _callGeminiAnalysis(apiKey, ctx);
    _ai.analysisResult = result;
    _aiRenderAnalysis(result);
    toast(t('ai.analysis_done'), 'success');
  } catch (e) {
    _aiSetAnalysisState('error', e.message);
    toast('Erro na análise: ' + e.message, 'error');
    console.error('[AIInsights] analysis error:', e);
  } finally {
    _ai.analysisLoading = false;
  }
}

function _aiSetAnalysisState(state, msg) {
  const container = document.getElementById('aiAnalysisResult');
  if (!container) return;

  if (state === 'loading') {
    container.innerHTML = `
      <div class="ai-loading">
        <div class="ai-loading-spinner"></div>
        <p>Analisando seus dados financeiros com IA…</p>
        <span class="ai-loading-sub">Coletando dados do app → enviando para Gemini → interpretando…</span>
      </div>`;
  } else if (state === 'error') {
    container.innerHTML = `
      <div class="ai-error-state">
        <span class="ai-error-icon">⚠️</span>
        <p><strong>Erro na análise</strong></p>
        <p class="ai-error-msg">${esc(msg || 'Tente novamente.')}</p>
        <button class="btn btn-ghost btn-sm" onclick="runAiAnalysis()">↺ Tentar novamente</button>
      </div>`;
  } else if (state === 'empty') {
    container.innerHTML = `
      <div class="ai-empty-state">
        <span style="font-size:2rem">🔍</span>
        <p>Nenhuma transação encontrada no período selecionado.</p>
        <p class="ai-loading-sub">Ajuste os filtros e tente novamente.</p>
      </div>`;
  }
}

async function _callGeminiAnalysis(apiKey, ctx) {
  const prompt = `Você é um consultor financeiro pessoal analisando dados financeiros de uma família brasileira.
Os dados abaixo foram COMPUTADOS pelo sistema financeiro e são 100% precisos. Sua função é INTERPRETAR, não recalcular.
Responda SOMENTE com JSON válido, sem markdown, sem texto antes ou depois.

DADOS FINANCEIROS DO PERÍODO ${ctx.period.from} a ${ctx.period.to}:
${JSON.stringify(ctx, null, 0)}

RETORNE EXATAMENTE ESTE JSON:
{
  "summary": "2-3 frases resumindo o período financeiro de forma clara e humana",
  "overview": {
    "income_comment": "comentário sobre as receitas (máx 1 frase)",
    "expense_comment": "comentário sobre as despesas (máx 1 frase)",
    "net_comment": "avaliação do resultado líquido (positivo/negativo/neutro) (máx 1 frase)"
  },
  "member_insights": [
    { "name": "nome do membro", "insight": "observação personalizada sobre os gastos deste membro" }
  ],
  "category_insights": [
    { "category": "nome", "insight": "o que esse padrão de gasto indica", "action": "sugestão de ação (opcional)" }
  ],
  "anomalies": [
    { "title": "título curto", "description": "descrição do que foi detectado", "severity": "low|medium|high" }
  ],
  "savings_opportunities": [
    { "title": "oportunidade de economia", "description": "como economizar", "estimated_saving": "ex: R$150/mês (estimativa)" }
  ],
  "recommendations": [
    { "title": "recomendação", "description": "ação concreta recomendada", "priority": "high|medium|low" }
  ],
  "cashflow_alerts": [
    { "type": "warning|info|ok", "message": "alerta de fluxo de caixa" }
  ],
  "chart_suggestions": [
    { "type": "bar|pie|line|donut", "title": "título do gráfico sugerido", "rationale": "por que este gráfico seria útil" }
  ],
  "classification_suggestions": [
    {
      "description": "descrição da transação sem categoria clara",
      "suggested_category": "categoria sugerida da lista",
      "suggested_payee": "nome normalizado do beneficiário",
      "purpose": "propósito inferido da transação",
      "confidence": 0.85,
      "explanation": "justificativa breve"
    }
  ]
}

REGRAS IMPORTANTES:
- NÃO invente números ou totais — use apenas os dados fornecidos
- Seja específico e acionável, não genérico
- Respeite o contexto brasileiro (BRL, hábitos locais)
- member_insights: apenas se houver dados por membro, lista vazia se não houver
- classification_suggestions: apenas para transações sem categoria ou com categoria genérica (máx 5)
- Todos os textos em português brasileiro`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 3000, temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 429) throw new Error('Limite de requisições atingido. Aguarde alguns segundos.');
    throw new Error(msg);
  }

  const data  = await resp.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error('Resposta inválida da IA'); }

  return parsed;
}

// ── Renderização da análise ───────────────────────────────────────────────

function _aiRenderAnalysis(r) {
  const container = document.getElementById('aiAnalysisResult');
  if (!container || !r) return;

  const ctx = _ai.financialContext;
  const fmt = (v) => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Badge de origem
  const dataBadge = `<span class="ai-badge ai-badge-data">📊 Dado do App</span>`;
  const aiBadge   = `<span class="ai-badge ai-badge-ai">🤖 Insight IA</span>`;
  const tipBadge  = `<span class="ai-badge ai-badge-tip">💡 Sugestão</span>`;

  // Overview financeiro (dados do app)
  let overviewHtml = '';
  if (ctx) {
    const net = ctx.summary.netResult;
    const netColor = net >= 0 ? 'var(--green,#22c55e)' : 'var(--red,#ef4444)';
    overviewHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${dataBadge} Resumo do Período</div>
        <div class="ai-kpi-row">
          <div class="ai-kpi ai-kpi-green">
            <span class="ai-kpi-label">Receitas</span>
            <span class="ai-kpi-value">${fmt(ctx.summary.totalIncome)}</span>
          </div>
          <div class="ai-kpi ai-kpi-red">
            <span class="ai-kpi-label">Despesas</span>
            <span class="ai-kpi-value">${fmt(ctx.summary.totalExpense)}</span>
          </div>
          <div class="ai-kpi" style="border-color:${netColor}">
            <span class="ai-kpi-label">Resultado Líquido</span>
            <span class="ai-kpi-value" style="color:${netColor}">${fmt(net)}</span>
          </div>
        </div>
      </div>`;
  }

  // Sumário IA
  let summaryHtml = '';
  if (r.summary) {
    summaryHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${aiBadge} Análise Geral</div>
        <p class="ai-summary-text">${esc(r.summary)}</p>
        ${r.overview ? `
          <div class="ai-overview-pills">
            ${r.overview.income_comment  ? `<div class="ai-overview-pill ai-pill-green">💰 ${esc(r.overview.income_comment)}</div>` : ''}
            ${r.overview.expense_comment ? `<div class="ai-overview-pill ai-pill-red">💸 ${esc(r.overview.expense_comment)}</div>` : ''}
            ${r.overview.net_comment     ? `<div class="ai-overview-pill ai-pill-blue">📈 ${esc(r.overview.net_comment)}</div>` : ''}
          </div>` : ''}
      </div>`;
  }

  // Alertas de cashflow
  let alertsHtml = '';
  if (r.cashflow_alerts?.length) {
    alertsHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${aiBadge} Alertas de Fluxo de Caixa</div>
        ${r.cashflow_alerts.map(a => `
          <div class="ai-alert ai-alert-${a.type || 'info'}">
            ${a.type === 'warning' ? '⚠️' : a.type === 'ok' ? '✅' : 'ℹ️'} ${esc(a.message)}
          </div>`).join('')}
      </div>`;
  }

  // Anomalias
  let anomaliesHtml = '';
  if (r.anomalies?.length) {
    anomaliesHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${aiBadge} Anomalias Detectadas</div>
        ${r.anomalies.map(a => `
          <div class="ai-insight-card ai-severity-${a.severity || 'low'}">
            <div class="ai-insight-title">${esc(a.title)}</div>
            <div class="ai-insight-desc">${esc(a.description)}</div>
          </div>`).join('')}
      </div>`;
  }

  // Top categorias (dados do app) + insights IA
  let catHtml = '';
  if (ctx?.topCategories?.length) {
    catHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${dataBadge} Gastos por Categoria</div>
        <div class="ai-bar-list">
          ${ctx.topCategories.map(c => `
            <div class="ai-bar-item">
              <div class="ai-bar-label"><span>${esc(c.name)}</span><span>${fmt(c.amount)} <small>(${c.pct}%)</small></span></div>
              <div class="ai-bar-track"><div class="ai-bar-fill" style="width:${c.pct}%"></div></div>
            </div>`).join('')}
        </div>
        ${r.category_insights?.length ? `
          <div class="ai-insights-list" style="margin-top:12px">
            <div class="ai-badge-row">${aiBadge} <span style="font-size:.78rem;color:var(--muted)">Insights por categoria</span></div>
            ${r.category_insights.map(ci => `
              <div class="ai-cat-insight">
                <strong>${esc(ci.category)}</strong> — ${esc(ci.insight)}
                ${ci.action ? `<span class="ai-action-tip">→ ${esc(ci.action)}</span>` : ''}
              </div>`).join('')}
          </div>` : ''}
      </div>`;
  }

  // Top beneficiários
  let payeeHtml = '';
  if (ctx?.topPayees?.length) {
    payeeHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${dataBadge} Top Beneficiários</div>
        <div class="ai-payee-list">
          ${ctx.topPayees.map((p, i) => `
            <div class="ai-payee-row">
              <span class="ai-payee-rank">${i + 1}</span>
              <span class="ai-payee-name">${esc(p.name)}</span>
              <span class="ai-payee-amt">${fmt(p.amount)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // Gastos por membro
  let memberHtml = '';
  if (ctx?.memberInsights?.length > 1 || r.member_insights?.length) {
    memberHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${dataBadge} Gastos por Membro</div>
        ${ctx.memberInsights.map(m => `
          <div class="ai-member-row">
            <span class="ai-member-name">${esc(m.name)}</span>
            <span class="ai-member-amt">${fmt(m.amount)}</span>
          </div>`).join('')}
        ${r.member_insights?.length ? `
          <div style="margin-top:10px">
            <div class="ai-badge-row">${aiBadge}</div>
            ${r.member_insights.map(mi => `
              <div class="ai-cat-insight"><strong>${esc(mi.name)}</strong> — ${esc(mi.insight)}</div>
            `).join('')}
          </div>` : ''}
      </div>`;
  }

  // Oportunidades de economia
  let savingsHtml = '';
  if (r.savings_opportunities?.length) {
    savingsHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${tipBadge} Oportunidades de Economia</div>
        ${r.savings_opportunities.map(s => `
          <div class="ai-savings-card">
            <div class="ai-savings-title">${esc(s.title)}</div>
            <div class="ai-savings-desc">${esc(s.description)}</div>
            ${s.estimated_saving ? `<div class="ai-savings-est">💰 Estimativa: ${esc(s.estimated_saving)}</div>` : ''}
          </div>`).join('')}
      </div>`;
  }

  // Recomendações
  let recsHtml = '';
  if (r.recommendations?.length) {
    recsHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${tipBadge} Recomendações</div>
        ${r.recommendations.map(rec => `
          <div class="ai-rec-card ai-rec-${rec.priority || 'medium'}">
            <div class="ai-rec-prio">${rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢'}</div>
            <div>
              <div class="ai-rec-title">${esc(rec.title)}</div>
              <div class="ai-rec-desc">${esc(rec.description)}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // Sugestões de classificação (advisory only)
  let classSugHtml = '';
  if (r.classification_suggestions?.length) {
    classSugHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${tipBadge} Sugestões de Classificação
          <span class="ai-advisory-note">⚠️ Apenas sugestões — não aplicadas automaticamente</span>
        </div>
        ${r.classification_suggestions.map(cs => `
          <div class="ai-class-card">
            <div class="ai-class-desc">${esc(cs.description)}</div>
            <div class="ai-class-details">
              ${cs.suggested_category ? `<span class="ai-class-tag">📁 ${esc(cs.suggested_category)}</span>` : ''}
              ${cs.suggested_payee    ? `<span class="ai-class-tag">👤 ${esc(cs.suggested_payee)}</span>` : ''}
              ${cs.purpose            ? `<span class="ai-class-tag">🎯 ${esc(cs.purpose)}</span>` : ''}
              <span class="ai-class-conf">${Math.round((cs.confidence || 0) * 100)}% confiança</span>
            </div>
            ${cs.explanation ? `<div class="ai-class-exp">${esc(cs.explanation)}</div>` : ''}
          </div>`).join('')}
        <p class="ai-disclaimer">As sugestões acima são apenas orientativas. Aplique manualmente se concordar.</p>
      </div>`;
  }

  // Tendência mensal (dados do app)
  let trendHtml = '';
  if (ctx?.monthlyTrend?.length > 1) {
    trendHtml = `
      <div class="ai-section">
        <div class="ai-section-header">${dataBadge} Tendência Mensal</div>
        <div class="ai-trend-table">
          <div class="ai-trend-header">
            <span>Mês</span><span>Receitas</span><span>Despesas</span><span>Resultado</span>
          </div>
          ${ctx.monthlyTrend.map(m => {
            const netColor = m.net >= 0 ? 'var(--green,#22c55e)' : 'var(--red,#ef4444)';
            return `<div class="ai-trend-row">
              <span>${m.month}</span>
              <span class="ai-trend-in">${fmt(m.income)}</span>
              <span class="ai-trend-out">${fmt(m.expense)}</span>
              <span style="color:${netColor};font-weight:600">${fmt(m.net)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = overviewHtml + summaryHtml + alertsHtml + anomaliesHtml + catHtml + payeeHtml + memberHtml + trendHtml + savingsHtml + recsHtml + classSugHtml;
}

// ── Export ────────────────────────────────────────────────────────────────

function exportAiAnalysis() {
  if (!_ai.analysisResult || !_ai.financialContext) {
    toast('Execute uma análise primeiro', 'warning');
    return;
  }
  const ctx = _ai.financialContext;
  const r   = _ai.analysisResult;
  const lines = [
    `AI Insights — Family FinTrack`,
    `Período: ${ctx.period.from} a ${ctx.period.to}`,
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    ``,
    `=== RESUMO FINANCEIRO (App) ===`,
    `Receitas:  R$ ${ctx.summary.totalIncome}`,
    `Despesas:  R$ ${ctx.summary.totalExpense}`,
    `Resultado: R$ ${ctx.summary.netResult}`,
    ``,
    `=== ANÁLISE IA ===`,
    r.summary || '',
    ``,
    `=== RECOMENDAÇÕES ===`,
    ...(r.recommendations || []).map(rec => `[${rec.priority?.toUpperCase()}] ${rec.title}: ${rec.description}`),
    ``,
    `=== OPORTUNIDADES DE ECONOMIA ===`,
    ...(r.savings_opportunities || []).map(s => `${s.title}: ${s.description} (${s.estimated_saving || ''})`),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `ai-insights-${ctx.period.from}-${ctx.period.to}.txt`;
  a.click();
  toast(t('report.export_ok'), 'success');
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 4 — AI CHAT
// ══════════════════════════════════════════════════════════════════════════

async function sendAiChatMessage() {
  const input = document.getElementById('aiChatInput');
  const msg   = (input?.value || '').trim();
  if (!msg) return;
  if (_ai.chatLoading) return;

  const enabled = await isAiInsightsEnabled();
  if (!enabled) { toast('AI Insights não está habilitado para esta família', 'warning'); return; }

  const apiKey = await getAppSetting(RECEIPT_AI_KEY_SETTING, '');
  if (!apiKey || !apiKey.startsWith('AIza')) { toast('Configure a chave Gemini', 'warning'); showAiConfig(); return; }

  // Adiciona mensagem do usuário
  _ai.chatHistory.push({ role: 'user', text: msg });
  if (input) input.value = '';
  _aiRenderChatHistory();

  _ai.chatLoading = true;
  _aiSetChatTyping(true);

  try {
    // Coleta contexto se ainda não temos
    if (!_ai.financialContext) {
      await _aiCollectFinancialContext();
    }

    const reply = await _callGeminiChat(apiKey, msg, _ai.chatHistory.slice(-12));
    _ai.chatHistory.push({ role: 'assistant', text: reply });
  } catch (e) {
    _ai.chatHistory.push({ role: 'assistant', text: `❌ Erro: ${e.message}`, isError: true });
    console.error('[AIInsights] chat error:', e);
  } finally {
    _ai.chatLoading = false;
    _aiSetChatTyping(false);
    _aiRenderChatHistory();
  }
}

async function _callGeminiChat(apiKey, question, history) {
  const ctx = _ai.financialContext;
  const ctxStr = ctx ? JSON.stringify({
    period: ctx.period,
    summary: ctx.summary,
    topCategories: ctx.topCategories.slice(0,5),
    topPayees: ctx.topPayees.slice(0,5),
    memberInsights: ctx.memberInsights,
    monthlyTrend: ctx.monthlyTrend.slice(-3),
    scheduledSummary: ctx.scheduledSummary.slice(0,5),
    accountBalances: ctx.accountBalances,
    anomalies: ctx.anomalies,
  }) : '{}';

  // Monta histórico no formato Gemini
  const geminiHistory = history.slice(0, -1).map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  const systemInstruction = `Você é um assistente financeiro pessoal para uma família brasileira usando o app Family FinTrack.
Você responde perguntas sobre as finanças da família usando os dados fornecidos pelo app (não os invente).

DADOS FINANCEIROS ATUAIS (computados pelo app — use como fonte de verdade):
${ctxStr}

REGRAS:
- Seja conciso mas completo. Prefira bullets e listas para clareza.
- NÃO invente números — cite apenas os dados fornecidos acima.
- Quando citar um número, diga se é "dado do app" ou "estimativa IA".
- Se não souber, diga claramente. Não suponha.
- Responda em português brasileiro.
- Para perguntas sobre saldos/totais, cite os dados do app literalmente.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${RECEIPT_AI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [
        ...geminiHistory,
        { role: 'user', parts: [{ text: question }] },
      ],
      generationConfig: { maxOutputTokens: 800, temperature: 0.4 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 429) throw new Error('Limite de requisições. Aguarde.');
    throw new Error(msg);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '(sem resposta)';
}

function _aiRenderChatHistory() {
  const feed = document.getElementById('aiChatFeed');
  if (!feed) return;

  if (!_ai.chatHistory.length) {
    feed.innerHTML = `
      <div class="ai-chat-empty">
        <p>💬 Faça perguntas sobre suas finanças em linguagem natural.</p>
        <div class="ai-chat-suggestions">
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Qual foi meu maior gasto este mês?')">Maior gasto este mês?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Como estão meus gastos comparados ao mês passado?')">Vs. mês passado?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Em quais categorias posso economizar?')">Onde economizar?</button>
          <button class="ai-chat-suggest" onclick="aiChatSuggest('Qual é o meu saldo atual?')">Saldo atual?</button>
        </div>
      </div>`;
    return;
  }

  feed.innerHTML = _ai.chatHistory.map(msg => `
    <div class="ai-chat-msg ai-chat-${msg.role}${msg.isError ? ' ai-chat-error' : ''}">
      <div class="ai-chat-bubble">
        ${msg.role === 'assistant' ? `<span class="ai-chat-origin">${msg.isError ? '⚠️ Erro' : '🤖 IA'}</span>` : ''}
        <div class="ai-chat-text">${_aiFormatChatText(msg.text)}</div>
      </div>
    </div>`).join('');

  // Scroll to bottom
  feed.scrollTop = feed.scrollHeight;
}

function _aiFormatChatText(text) {
  // Simples formatação: negrito, itálico, listas
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/g, '<br>');
}

function _aiSetChatTyping(typing) {
  let indicator = document.getElementById('aiChatTyping');
  if (typing && !indicator) {
    const feed = document.getElementById('aiChatFeed');
    if (feed) {
      feed.insertAdjacentHTML('beforeend', `
        <div class="ai-chat-msg ai-chat-assistant" id="aiChatTyping">
          <div class="ai-chat-bubble">
            <span class="ai-chat-origin">🤖 IA</span>
            <div class="ai-typing-dots"><span></span><span></span><span></span></div>
          </div>
        </div>`);
      feed.scrollTop = feed.scrollHeight;
    }
  } else if (!typing && indicator) {
    indicator.remove();
  }
}

function aiChatSuggest(text) {
  const input = document.getElementById('aiChatInput');
  if (input) { input.value = text; input.focus(); }
}

function clearAiChat() {
  _ai.chatHistory = [];
  _ai.financialContext = null;
  _aiRenderChatHistory();
  toast(t('ai.chat_clear'), 'info');
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 5 — ENRIQUECIMENTO DE CONTEXTO DE TRANSAÇÕES
// ══════════════════════════════════════════════════════════════════════════

async function enrichTransactionContext(tx) {
  if (!tx) return null;

  const catMap   = Object.fromEntries((state.categories || []).map(c => [c.id, c.name]));
  const payMap   = Object.fromEntries((state.payees     || []).map(p => [p.id, p.name]));
  const accMap   = Object.fromEntries((state.accounts   || []).map(a => [a.id, a.name]));

  // Histórico do mesmo beneficiário
  let payeeHistory = [];
  if (tx.payee_id) {
    const { data } = await famQ(sb.from('transactions').select('date,brl_amount,category_id,description').eq('payee_id', tx.payee_id).order('date', { ascending: false }).limit(10));
    payeeHistory = (data || []).map(t => ({
      date: t.date,
      amount: Math.abs(parseFloat(t.brl_amount || 0)),
      category: catMap[t.category_id] || null,
    }));
  }

  // Detectar recorrência simples
  let recurrencePattern = null;
  if (payeeHistory.length >= 2) {
    const intervals = [];
    for (let i = 1; i < payeeHistory.length; i++) {
      const d1 = new Date(payeeHistory[i-1].date);
      const d2 = new Date(payeeHistory[i].date);
      intervals.push(Math.abs(Math.round((d1 - d2) / (1000 * 60 * 60 * 24))));
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgInterval <= 10)       recurrencePattern = 'semanal';
    else if (avgInterval <= 35)  recurrencePattern = 'mensal';
    else if (avgInterval <= 100) recurrencePattern = 'trimestral';
  }

  return {
    transaction: {
      description: tx.description,
      amount: Math.abs(parseFloat(tx.brl_amount || 0)),
      type: tx.is_transfer ? (tx.is_card_payment ? 'card_payment' : 'transfer') : parseFloat(tx.amount||0) >= 0 ? 'income' : 'expense',
      date: tx.date,
      memo: tx.memo,
      category: catMap[tx.category_id] || null,
      payee: payMap[tx.payee_id] || null,
      account: accMap[tx.account_id] || null,
    },
    payeeHistory,
    recurrencePattern,
    isRecurrent: !!recurrencePattern,
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  SEÇÃO 6 — INICIALIZAÇÃO (chamada pelo app.js via navigate)
// ══════════════════════════════════════════════════════════════════════════

// Teclado: Enter envia chat
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const chatInput = document.getElementById('aiChatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAiChatMessage();
        }
      });
    }

    // Aplica feature flag ao carregar
    applyAiInsightsFeature();
  }, 400);
});
