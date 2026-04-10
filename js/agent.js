/* ═══════════════════════════════════════════════════════════════════════════
   AGENT.JS — FinTrack Copiloto Financeiro v4
   Bot profissional usando Gemini Function Calling (tool use).
   Todas as ações são executadas via ferramentas declarativas — sem parsing
   de JSON em texto livre, sem heurísticas frágeis.

   Arquitetura:
     1. _agGetContext()      → carrega snapshot da família (TTL 90s)
     2. _agCallGemini()      → envia histórico + system prompt + tools ao Gemini
     3. _agHandleFcall()     → executa a função escolhida pelo modelo
     4. _agFeedResult()      → devolve resultado ao Gemini para gerar resposta final
     5. Toda query de dados passa por famQ() — RLS garante isolamento por família

   Depende de: receipt_ai.js (RECEIPT_AI_KEY_SETTING, RECEIPT_AI_MODEL)
═══════════════════════════════════════════════════════════════════════════ */

/* ── Estado global do agente ────────────────────────────────────────────── */
const _ag = {
  open:     false,
  loading:  false,
  apiKey:   null,
  history:  [],          // [{role:'user'|'model', parts:[...]}]
  ctx:      null,        // contexto da família (cache)
  ctxTs:    0,           // timestamp do cache
  welcomed: false,
};
const _AG_CTX_TTL = 90_000; // 90s — invalida ao executar ação

/* ════════════════════════════════════════════════════════════════════════════
   FERRAMENTAS (Gemini Function Declarations)
   Cada ferramenta mapeia para uma ação concreta no app.
════════════════════════════════════════════════════════════════════════════ */
const _AG_TOOLS = [{
  function_declarations: [

    /* ── Consultas ──────────────────────────────────────────────────────── */
    {
      name: 'get_summary',
      description: 'Retorna resumo financeiro: saldo total de todas as contas, receitas e despesas do mês atual, patrimônio líquido (descontando dívidas), e top categorias de gasto.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_accounts',
      description: 'Lista todas as contas da família com seus saldos atuais.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_transactions',
      description: 'Lista transações filtradas por período, categoria ou conta.',
      parameters: {
        type: 'object',
        properties: {
          period:       { type: 'string', description: 'Período como "este_mes", "mes_passado", "ultimos_30_dias", "YYYY-MM"' },
          account_name: { type: 'string', description: 'Filtrar por conta' },
          category_name:{ type: 'string', description: 'Filtrar por categoria' },
          type:         { type: 'string', enum: ['expense','income','all'], description: 'Tipo da transação' },
          limit:        { type: 'number', description: 'Máximo de resultados (padrão 20)' },
        },
      },
    },
    {
      name: 'get_budgets',
      description: 'Retorna o status dos orçamentos do mês atual com percentual gasto.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_scheduled',
      description: 'Lista programados ativos e próximas ocorrências.',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: { type: 'number', description: 'Próximos N dias (padrão 30)' },
        },
      },
    },
    {
      name: 'get_debts',
      description: 'Lista dívidas ativas com saldo devedor e progresso de quitação.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'search_transactions',
      description: 'Busca transações por descrição ou beneficiário.',
      parameters: {
        type: 'object',
        properties: {
          query:  { type: 'string', description: 'Texto a buscar' },
          limit:  { type: 'number', description: 'Máximo de resultados (padrão 15)' },
        },
        required: ['query'],
      },
    },

    /* ── Criação de registros ───────────────────────────────────────────── */
    {
      name: 'create_transaction',
      description: 'Cria uma transação financeira (despesa ou receita) em uma conta. Sempre pede confirmação antes de executar.',
      parameters: {
        type: 'object',
        properties: {
          type:          { type: 'string', enum: ['expense','income'], description: 'Tipo da transação' },
          amount:        { type: 'number', description: 'Valor positivo em reais' },
          description:   { type: 'string', description: 'Descrição da transação' },
          account_name:  { type: 'string', description: 'Nome da conta a debitar/creditar' },
          category_name: { type: 'string', description: 'Categoria (ex: Alimentação, Salário)' },
          payee_name:    { type: 'string', description: 'Beneficiário (ex: Mercado Extra, Empresa X)' },
          date:          { type: 'string', description: 'Data ISO YYYY-MM-DD (padrão: hoje)' },
          memo:          { type: 'string', description: 'Observação adicional' },
        },
        required: ['type','amount','description'],
      },
    },
    {
      name: 'create_transfer',
      description: 'Cria uma transferência entre duas contas da família.',
      parameters: {
        type: 'object',
        properties: {
          amount:            { type: 'number', description: 'Valor em reais' },
          from_account_name: { type: 'string', description: 'Conta de origem' },
          to_account_name:   { type: 'string', description: 'Conta de destino' },
          description:       { type: 'string', description: 'Descrição da transferência' },
          date:              { type: 'string', description: 'Data ISO YYYY-MM-DD' },
        },
        required: ['amount','from_account_name','to_account_name'],
      },
    },
    {
      name: 'open_new_transaction_form',
      description: 'Abre o formulário de nova transação com campos pré-preenchidos para o usuário revisar e salvar.',
      parameters: {
        type: 'object',
        properties: {
          type:          { type: 'string', enum: ['expense','income'] },
          amount:        { type: 'number' },
          description:   { type: 'string' },
          account_name:  { type: 'string' },
          category_name: { type: 'string' },
          payee_name:    { type: 'string' },
        },
      },
    },
    {
      name: 'create_scheduled',
      description: 'Cria um programado (transação recorrente). Sempre pede confirmação.',
      parameters: {
        type: 'object',
        properties: {
          type:          { type: 'string', enum: ['expense','income'] },
          amount:        { type: 'number', description: 'Valor positivo' },
          description:   { type: 'string', description: 'Descrição do programado' },
          account_name:  { type: 'string', description: 'Conta associada' },
          category_name: { type: 'string' },
          frequency:     { type: 'string', enum: ['monthly','weekly','biweekly','yearly','once'], description: 'Frequência' },
          start_date:    { type: 'string', description: 'Data de início YYYY-MM-DD' },
        },
        required: ['type','amount','description','frequency'],
      },
    },
    {
      name: 'toggle_scheduled',
      description: 'Pausa ou retoma um programado ativo.',
      parameters: {
        type: 'object',
        properties: {
          name:   { type: 'string', description: 'Nome do programado' },
          action: { type: 'string', enum: ['pause','resume'], description: 'Ação a realizar' },
        },
        required: ['name','action'],
      },
    },
    {
      name: 'create_budget',
      description: 'Cria um orçamento mensal para uma categoria.',
      parameters: {
        type: 'object',
        properties: {
          category_name: { type: 'string', description: 'Nome da categoria' },
          amount:        { type: 'number', description: 'Limite mensal em reais' },
          month:         { type: 'string', description: 'Mês YYYY-MM (padrão: mês atual)' },
        },
        required: ['category_name','amount'],
      },
    },

    /* ── Navegação ──────────────────────────────────────────────────────── */
    {
      name: 'navigate_to',
      description: 'Navega para uma página do aplicativo.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['dashboard','transactions','accounts','scheduled','budgets','reports','categories','payees','investments','debts','dreams','grocery','prices'],
            description: 'Página de destino',
          },
        },
        required: ['page'],
      },
    },

  ]
}];

/* ════════════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT
════════════════════════════════════════════════════════════════════════════ */
function _agSystemPrompt(ctx) {
  const s   = ctx.snapshot;
  const acc = ctx.accounts.map(a => `${a.name} (${a.typePt}, ${a.currency}, saldo: ${a.balanceFmt}${a.negative?' ⚠️ NEGATIVO':''})`).join('\n  ');
  const catsExp = ctx.categories.filter(c => c.type==='expense' && !c.parent_id).map(c => c.name).join(', ');
  const catsInc = ctx.categories.filter(c => c.type==='income'  && !c.parent_id).map(c => c.name).join(', ');
  const pays    = ctx.payees.slice(0,50).map(p => p.name).join(', ');
  const scheds  = ctx.scheduled.slice(0,15).map(s => `${s.description} (${s.freqPt}, ${s.typePt}, R$${Math.abs(s.amount).toFixed(2)})`).join('\n  ');
  const debts   = ctx.debts.length ? ctx.debts.map(d => `${d.name}: ${d.balanceFmt}${d.creditor?' — '+d.creditor:''}`).join('\n  ') : 'Nenhuma';
  const budgets = ctx.budgets.length ? ctx.budgets.map(b => `${b.category}: ${b.pct}% de ${b.limitFmt}`).join('\n  ') : 'Nenhum';

  return `Você é o **FinTrack Agent**, assistente financeiro pessoal da família no aplicativo FinTrack.

## IDENTIDADE E COMPORTAMENTO
- Nome: FinTrack Agent
- Tom: amigável, direto, preciso — como um consultor financeiro de confiança
- Idioma: SEMPRE português brasileiro
- Use emojis com moderação (1-2 por mensagem, nunca em excesso)
- Respostas objetivas: máximo 3 parágrafos para consultas, 1 para confirmações
- NUNCA invente dados — use apenas os dados reais abaixo
- Quando executar uma ação com sucesso, confirme brevemente e ofereça ajuda adicional
- Quando não souber algo, diga claramente

## DADOS DA FAMÍLIA (atualizado em ${ctx.today})
**Página atual:** ${ctx.currentPage}
**Saldo total:** ${s.totalSaldoFmt} | **Dívidas:** ${s.debtTotalFmt} | **Patrimônio líquido:** ${s.patrimonioFmt}
**Mês ${ctx.monthName}:** Receitas ${s.incomeMonthFmt} · Despesas ${s.expenseMonthFmt} · Saldo ${s.balanceMonthFmt}
${s.topCats.length ? `**Top gastos:** ${s.topCats.slice(0,4).join(' | ')}` : ''}
${s.upcomingCount ? `**Próximos 7 dias:** ${s.upcomingCount} programados (${s.upcomingDesc.join(', ')})` : ''}

### Contas:
  ${acc || 'Nenhuma'}

### Categorias de despesa: ${catsExp || 'nenhuma'}
### Categorias de receita: ${catsInc || 'nenhuma'}
### Beneficiários frequentes: ${pays || 'nenhum'}

### Programados ativos:
  ${scheds || 'Nenhum'}

### Dívidas ativas:
  ${debts}

### Orçamentos:
  ${budgets}

## REGRAS DE USO DAS FERRAMENTAS
- Use **create_transaction** quando o usuário quiser registrar uma despesa/receita direta
- Use **open_new_transaction_form** quando o usuário mencionar algo que precisa revisar antes de salvar, ou quando faltar informação mas você não quiser interromper com perguntas
- Para transferências entre contas, use **create_transfer**
- **Consultas de dados** (saldo, histórico, orçamentos) → use as ferramentas get_*
- Para **navegar** para uma tela, use navigate_to
- Não execute ações destrutivas sem confirmação explícita do usuário
- Se o usuário confirmar com "sim", "ok", "pode", "confirma" → execute a ação pendente
- Ao criar transações, resolva o nome da conta e categoria pelos dados acima`;
}

/* ════════════════════════════════════════════════════════════════════════════
   CONTEXTO DA FAMÍLIA
════════════════════════════════════════════════════════════════════════════ */
async function _agGetContext() {
  if (_ag.ctx && (Date.now() - _ag.ctxTs) < _AG_CTX_TTL) return _ag.ctx;

  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid) return _agCtxEmpty();

  // Garantir dados básicos no state
  try {
    if (!state.accounts?.length)    await DB.accounts.load();
    if (!state.categories?.length)  await DB.categories.load();
    if (!state.payees?.length)      await DB.payees.load();
    if (!state.scheduled?.length && typeof loadScheduled === 'function') await loadScheduled();
    if (!state.budgets?.length    && typeof loadBudgets  === 'function') await loadBudgets();
  } catch(_) {}

  const now   = new Date();
  const y     = now.getFullYear();
  const mon   = String(now.getMonth() + 1).padStart(2, '0');
  const today = now.toISOString().slice(0, 10);
  const months_pt = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const monthName = months_pt[now.getMonth()];

  // Transações do mês via RLS
  let monthlyTxs = [];
  try {
    const { data } = await famQ(
      sb.from('transactions')
        .select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id,payee_id,status')
    ).gte('date',`${y}-${mon}-01`).lte('date',`${y}-${mon}-31`).eq('status','confirmed').order('date',{ascending:false}).limit(300);
    monthlyTxs = (data||[]).filter(t => !t.is_transfer && !t.is_card_payment);
  } catch(_) {}

  // Dívidas via RLS
  let debts = [];
  try {
    const { data: dd } = await famQ(
      sb.from('debts').select('id,description,name,current_balance,original_amount,currency,status,creditor,creditor_payee_id')
    ).eq('status','active');
    debts = dd || [];
  } catch(_) {}

  const accs    = state.accounts   || [];
  const cats    = state.categories || [];
  const payees  = state.payees     || [];
  const sched   = state.scheduled  || [];
  const budgets = state.budgets    || [];

  const brl  = (v, cur) => typeof toBRL    === 'function' ? toBRL(+v||0, cur||'BRL') : +v||0;
  const fmt  = (v)      => typeof dashFmt  === 'function' ? dashFmt(Math.abs(+v||0),'BRL') : `R$${(+v||0).toFixed(2)}`;
  const typePtAcc = t => ({ corrente:'Conta corrente', poupanca:'Poupança', cartao_credito:'Cartão de crédito', investimento:'Investimento', dinheiro:'Dinheiro', outros:'Outros' }[t] || t);
  const typePtSc  = t => ({ expense:'Despesa', income:'Receita', transfer:'Transferência', card_payment:'Pagamento cartão' }[t] || t);
  const freqPt    = f => ({ monthly:'Mensal', weekly:'Semanal', biweekly:'Quinzenal', yearly:'Anual', once:'Única vez' }[f] || f);

  const totalSaldo = accs.reduce((s,a) => s + brl(a.balance||0, a.currency), 0);
  const debtTotal  = debts.reduce((s,d) => s + brl(d.current_balance ?? d.original_amount, d.currency), 0);

  let incomeMonth = 0, expenseMonth = 0;
  const byCat = {};
  monthlyTxs.forEach(t => {
    const v = brl(t.brl_amount ?? t.amount, t.currency);
    if (v > 0) incomeMonth  += v;
    else       expenseMonth += Math.abs(v);
    const catName = cats.find(c => c.id === t.category_id)?.name;
    if (v < 0 && catName) byCat[catName] = (byCat[catName]||0) + Math.abs(v);
  });
  const topCats = Object.entries(byCat).sort(([,a],[,b])=>b-a).slice(0,6).map(([n,v]) => `${n} (${fmt(v)})`);

  const upcoming = sched.filter(sc => {
    if ((sc.status||'active') !== 'active') return false;
    const d = sc.start_date || sc.next_occurrence || '';
    if (!d) return false;
    const diff = (new Date(d) - new Date(today)) / 86400000;
    return diff >= 0 && diff <= 7;
  });

  const budgetObjs = budgets.slice(0,10).map(b => {
    const catName = cats.find(c => c.id === b.category_id)?.name || '?';
    const pct = b.amount > 0 ? Math.round((+(b.spent||0) / +b.amount) * 100) : 0;
    return { id:b.id, category:catName, category_id:b.category_id, limit:+b.amount, spent:+(b.spent||0), pct, limitFmt:fmt(+b.amount) };
  });

  _ag.ctx  = {
    today, familyId: fid, monthName,
    currentPage: window.state?.currentPage || 'dashboard',
    accounts: accs.map(a => ({
      id:a.id, name:a.name, type:a.type, typePt:typePtAcc(a.type),
      currency:a.currency||'BRL',
      balance: brl(a.balance||0, a.currency),
      balanceFmt: fmt(brl(a.balance||0, a.currency)),
      negative: brl(a.balance||0, a.currency) < 0,
    })),
    categories: cats.map(c => ({ id:c.id, name:c.name, type:c.type, parent_id:c.parent_id })),
    payees:     payees.map(p => ({ id:p.id, name:p.name, default_category_id:p.default_category_id })),
    scheduled:  sched.filter(s=>(s.status||'active')==='active').map(s=>({
      id:s.id, description:s.description, amount:s.amount,
      type:s.type, typePt:typePtSc(s.type),
      frequency:s.frequency, freqPt:freqPt(s.frequency),
      account_id:s.account_id,
      next: s.start_date || s.next_occurrence || '',
    })),
    debts: debts.map(d => ({
      id:d.id, name:d.description||d.name,
      balance: brl(d.current_balance ?? d.original_amount, d.currency),
      balanceFmt: fmt(brl(d.current_balance ?? d.original_amount, d.currency)),
      creditor: typeof d.creditor==='object' ? d.creditor?.name : d.creditor,
    })),
    budgets: budgetObjs,
    snapshot: {
      totalSaldoFmt:   fmt(totalSaldo),   totalSaldo,
      debtTotalFmt:    fmt(debtTotal),    debtTotal,
      patrimonioFmt:   fmt(totalSaldo - debtTotal),
      incomeMonthFmt:  fmt(incomeMonth),  incomeMonth,
      expenseMonthFmt: fmt(expenseMonth), expenseMonth,
      balanceMonthFmt: fmt(incomeMonth - expenseMonth),
      topCats, txCount: monthlyTxs.length,
      upcomingCount: upcoming.length,
      upcomingDesc:  upcoming.slice(0,3).map(s => s.description),
    },
  };
  _ag.ctxTs = Date.now();
  return _ag.ctx;
}

function _agCtxEmpty() {
  return {
    today: new Date().toISOString().slice(0,10), familyId: null, monthName: '',
    currentPage: 'dashboard',
    accounts:[], categories:[], payees:[], scheduled:[], debts:[], budgets:[],
    snapshot:{ totalSaldoFmt:'R$0', totalSaldo:0, debtTotalFmt:'R$0', debtTotal:0,
      patrimonioFmt:'R$0', incomeMonthFmt:'R$0', expenseMonthFmt:'R$0', balanceMonthFmt:'R$0',
      topCats:[], txCount:0, upcomingCount:0, upcomingDesc:[] },
  };
}

function _agInvalidateCtx() { _ag.ctxTs = 0; }

/* ════════════════════════════════════════════════════════════════════════════
   CHAMADA AO GEMINI (Function Calling)
════════════════════════════════════════════════════════════════════════════ */
async function _agCallGemini(userText, ctx, toolResultParts) {
  const model = typeof RECEIPT_AI_MODEL !== 'undefined' ? RECEIPT_AI_MODEL : 'gemini-2.5-flash-lite';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${_ag.apiKey}`;

  // Adiciona turno do usuário ao histórico (somente na primeira chamada do turno)
  if (userText) _ag.history.push({ role:'user', parts:[{text:userText}] });

  // Se estamos devolvendo resultados de ferramentas, adiciona ao histórico
  if (toolResultParts) {
    _ag.history.push({ role:'model', parts: toolResultParts.modelParts });
    _ag.history.push({ role:'user',  parts: toolResultParts.resultParts });
  }

  // Mantém contexto razoável
  if (_ag.history.length > 30) _ag.history = _ag.history.slice(-30);

  const body = {
    system_instruction: { parts: [{ text: _agSystemPrompt(ctx) }] },
    contents: _ag.history,
    tools: _AG_TOOLS,
    tool_config: { function_calling_config: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/* ════════════════════════════════════════════════════════════════════════════
   EXECUÇÃO DAS FERRAMENTAS
════════════════════════════════════════════════════════════════════════════ */
async function _agExecTool(name, args, ctx) {
  const fid  = ctx.familyId || (typeof famId === 'function' ? famId() : null);
  const brl  = (v, cur) => typeof toBRL   === 'function' ? toBRL(+v||0, cur||'BRL') : +v||0;
  const fmt  = (v)      => typeof dashFmt === 'function' ? dashFmt(Math.abs(+v||0),'BRL') : `R$${(+v||0).toFixed(2)}`;

  // Fuzzy match: encontra o melhor match por nome (case-insensitive, parcial)
  const match = (list, query, key='name') => {
    if (!query) return null;
    const q = query.toLowerCase().trim();
    return list.find(x => (x[key]||'').toLowerCase() === q) ||
           list.find(x => (x[key]||'').toLowerCase().includes(q)) ||
           list.find(x => q.includes((x[key]||'').toLowerCase()) && (x[key]||'').length > 3) ||
           null;
  };

  switch(name) {

    /* ── get_summary ──────────────────────────────────────────────────── */
    case 'get_summary': {
      const s = ctx.snapshot;
      return {
        saldo_total:    s.totalSaldoFmt,
        dividas:        s.debtTotalFmt,
        patrimonio:     s.patrimonioFmt,
        receitas_mes:   s.incomeMonthFmt,
        despesas_mes:   s.expenseMonthFmt,
        saldo_mes:      s.balanceMonthFmt,
        transacoes_mes: s.txCount,
        top_categorias: s.topCats,
        programados_proximos: s.upcomingCount,
      };
    }

    /* ── get_accounts ─────────────────────────────────────────────────── */
    case 'get_accounts': {
      return ctx.accounts.map(a => ({
        nome: a.name, tipo: a.typePt, moeda: a.currency,
        saldo: a.balanceFmt, negativo: a.negative,
      }));
    }

    /* ── get_transactions ─────────────────────────────────────────────── */
    case 'get_transactions': {
      const now = new Date();
      let from, to;
      const p = (args.period || 'este_mes').toLowerCase();
      if (p === 'este_mes' || !p) {
        from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
        to   = now.toISOString().slice(0,10);
      } else if (p === 'mes_passado') {
        const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
        from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
        to   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-31`;
      } else if (p === 'ultimos_30_dias') {
        const d = new Date(now); d.setDate(d.getDate()-30);
        from = d.toISOString().slice(0,10);
        to   = now.toISOString().slice(0,10);
      } else if (/^\d{4}-\d{2}$/.test(p)) {
        from = `${p}-01`; to = `${p}-31`;
      } else {
        from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
        to   = now.toISOString().slice(0,10);
      }
      const lim = Math.min(+(args.limit)||20, 50);
      let q = famQ(sb.from('transactions')
        .select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id'))
        .gte('date',from).lte('date',to).eq('status','confirmed').order('date',{ascending:false}).limit(lim);
      const { data } = await q;
      let txs = (data||[]).filter(t => !t.is_transfer && !t.is_card_payment);
      if (args.type === 'expense') txs = txs.filter(t => (t.brl_amount??t.amount) < 0);
      if (args.type === 'income')  txs = txs.filter(t => (t.brl_amount??t.amount) > 0);
      if (args.category_name) {
        const cat = match(ctx.categories, args.category_name);
        if (cat) txs = txs.filter(t => t.category_id === cat.id);
      }
      if (args.account_name) {
        const acc = match(ctx.accounts, args.account_name);
        if (acc) txs = txs.filter(t => t.account_id === acc.id);
      }
      return txs.slice(0, lim).map(t => ({
        data: t.date,
        descricao: t.description,
        valor: fmt(brl(t.brl_amount??t.amount, t.currency)),
        tipo: (t.brl_amount??t.amount) > 0 ? 'receita' : 'despesa',
        categoria: ctx.categories.find(c=>c.id===t.category_id)?.name || '',
        conta: ctx.accounts.find(a=>a.id===t.account_id)?.name || '',
      }));
    }

    /* ── search_transactions ──────────────────────────────────────────── */
    case 'search_transactions': {
      const lim = Math.min(+(args.limit)||15, 30);
      const { data } = await famQ(
        sb.from('transactions').select('id,date,description,amount,brl_amount,currency,is_transfer,is_card_payment,category_id,account_id')
      ).ilike('description', `%${args.query}%`).eq('status','confirmed').order('date',{ascending:false}).limit(lim);
      const txs = (data||[]).filter(t => !t.is_transfer && !t.is_card_payment);
      return txs.map(t => ({
        data: t.date, descricao: t.description,
        valor: fmt(brl(t.brl_amount??t.amount, t.currency)),
        tipo: (t.brl_amount??t.amount) > 0 ? 'receita' : 'despesa',
        categoria: ctx.categories.find(c=>c.id===t.category_id)?.name || '',
      }));
    }

    /* ── get_budgets ──────────────────────────────────────────────────── */
    case 'get_budgets': {
      return ctx.budgets.map(b => ({
        categoria: b.category,
        limite:    b.limitFmt,
        gasto:     fmt(b.spent),
        percentual: b.pct + '%',
        status:    b.pct >= 100 ? '🔴 Excedido' : b.pct >= 80 ? '🟡 Atenção' : '🟢 OK',
      }));
    }

    /* ── get_scheduled ────────────────────────────────────────────────── */
    case 'get_scheduled': {
      const dias = +(args.days_ahead)||30;
      const today = new Date(); const limDate = new Date(); limDate.setDate(limDate.getDate()+dias);
      return ctx.scheduled.slice(0,20).map(s => ({
        descricao:  s.description,
        tipo:       s.typePt,
        frequencia: s.freqPt,
        valor:      fmt(Math.abs(s.amount)),
        proxima:    s.next || 'indefinido',
      }));
    }

    /* ── get_debts ────────────────────────────────────────────────────── */
    case 'get_debts': {
      return ctx.debts.map(d => ({
        nome:    d.name,
        saldo:   d.balanceFmt,
        credor:  d.creditor || '',
      }));
    }

    /* ── create_transaction ───────────────────────────────────────────── */
    case 'create_transaction': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return { ok:false, error:'Valor inválido.' };

      // Resolver conta
      let acc = match(ctx.accounts, args.account_name);
      if (!acc && ctx.accounts.length === 1) acc = ctx.accounts[0];
      if (!acc) return { ok:false, error:`Conta "${args.account_name || '?'}" não encontrada. Contas disponíveis: ${ctx.accounts.map(a=>a.name).join(', ')}` };

      // Resolver categoria
      const catType = args.type === 'income' ? 'income' : 'expense';
      let cat = match(ctx.categories.filter(c=>c.type===catType), args.category_name);
      if (!cat) cat = match(ctx.categories, args.category_name);

      // Resolver beneficiário
      const payee = match(ctx.payees, args.payee_name);

      const data = {
        date:         args.date || new Date().toISOString().slice(0,10),
        description:  args.description || (args.type==='income'?'Receita':'Despesa'),
        amount:       args.type === 'expense' ? -amt : amt,
        brl_amount:   args.type === 'expense' ? -amt : amt,
        currency:     'BRL',
        account_id:   acc.id,
        category_id:  cat?.id || null,
        payee_id:     payee?.id || null,
        memo:         args.memo || null,
        status:       'confirmed',
        is_transfer:  false,
        is_card_payment: false,
        updated_at:   new Date().toISOString(),
        family_id:    fid,
      };
      const { error } = await sb.from('transactions').insert(data);
      if (error) return { ok:false, error:error.message };
      _agInvalidateCtx();
      setTimeout(() => {
        if (typeof loadTransactions === 'function') loadTransactions(true).catch(()=>{});
        if (typeof loadDashboard === 'function') loadDashboard().catch(()=>{});
        if (typeof DB !== 'undefined') DB.accounts.bust?.();
      }, 300);
      return {
        ok: true,
        mensagem: `${args.type==='income'?'Receita':'Despesa'} de ${fmt(amt)} registrada em ${acc.name}${cat?` · ${cat.name}`:''}`,
        data: data.date, conta: acc.name, categoria: cat?.name||'sem categoria',
      };
    }

    /* ── create_transfer ──────────────────────────────────────────────── */
    case 'create_transfer': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return { ok:false, error:'Valor inválido.' };
      const accFrom = match(ctx.accounts, args.from_account_name);
      const accTo   = match(ctx.accounts, args.to_account_name);
      if (!accFrom) return { ok:false, error:`Conta origem "${args.from_account_name}" não encontrada.` };
      if (!accTo)   return { ok:false, error:`Conta destino "${args.to_account_name}" não encontrada.` };
      const desc = args.description || `Transferência para ${accTo.name}`;
      const date = args.date || new Date().toISOString().slice(0,10);
      const base = { date, description:desc, amount:-amt, brl_amount:-amt, currency:'BRL', status:'confirmed', is_transfer:true, is_card_payment:false, updated_at:new Date().toISOString(), family_id:fid };
      const { data:d1, error:e1 } = await sb.from('transactions').insert({...base, account_id:accFrom.id, transfer_to_account_id:accTo.id}).select().single();
      if (e1) return { ok:false, error:e1.message };
      await sb.from('transactions').insert({...base, amount:amt, brl_amount:amt, account_id:accTo.id, transfer_to_account_id:accFrom.id, linked_transfer_id:d1.id}).catch(()=>{});
      _agInvalidateCtx();
      setTimeout(() => { if (typeof loadTransactions==='function') loadTransactions(true).catch(()=>{}); }, 300);
      return { ok:true, mensagem:`Transferência de ${fmt(amt)} de ${accFrom.name} para ${accTo.name} registrada.` };
    }

    /* ── open_new_transaction_form ────────────────────────────────────── */
    case 'open_new_transaction_form': {
      const prefill = {};
      if (args.type)          prefill.type = args.type;
      if (args.amount)        prefill.amount = Math.abs(+args.amount);
      if (args.description)   prefill.description = args.description;
      if (args.account_name)  { const a = match(ctx.accounts, args.account_name); if (a) prefill.account_id = a.id; }
      if (args.category_name) { const c = match(ctx.categories, args.category_name); if (c) prefill.category_id = c.id; }
      if (args.payee_name)    { const p = match(ctx.payees, args.payee_name); if (p) prefill.payee_id = p.id; }
      _agOpenModal('txModal', prefill);
      return { ok:true, mensagem:'Formulário de transação aberto com os dados pré-preenchidos.' };
    }

    /* ── create_scheduled ─────────────────────────────────────────────── */
    case 'create_scheduled': {
      const amt = Math.abs(+(args.amount)||0);
      if (!amt) return { ok:false, error:'Valor inválido.' };
      const acc = match(ctx.accounts, args.account_name) || (ctx.accounts.length===1?ctx.accounts[0]:null);
      if (!acc) return { ok:false, error:'Conta não encontrada.' };
      const catType = args.type==='income' ? 'income':'expense';
      const cat = match(ctx.categories.filter(c=>c.type===catType), args.category_name) || match(ctx.categories, args.category_name);
      const data = {
        type:        args.type,
        amount:      args.type==='expense' ? -amt : amt,
        description: args.description,
        account_id:  acc.id,
        category_id: cat?.id||null,
        frequency:   args.frequency || 'monthly',
        status:      'active',
        start_date:  args.start_date || new Date().toISOString().slice(0,10),
        auto_register: false,
        auto_confirm:  true,
        updated_at:  new Date().toISOString(),
        family_id:   fid,
      };
      const { error } = await sb.from('scheduled_transactions').insert(data);
      if (error) return { ok:false, error:error.message };
      _agInvalidateCtx();
      setTimeout(() => { if (typeof loadScheduled==='function') loadScheduled().catch(()=>{}); }, 300);
      return { ok:true, mensagem:`Programado "${args.description}" (${fmt(amt)}, ${args.frequency}) criado em ${acc.name}.` };
    }

    /* ── toggle_scheduled ─────────────────────────────────────────────── */
    case 'toggle_scheduled': {
      const sc = match(ctx.scheduled, args.name, 'description');
      if (!sc) return { ok:false, error:`Programado "${args.name}" não encontrado.` };
      const newStatus = args.action==='pause' ? 'paused' : 'active';
      const { error } = await sb.from('scheduled_transactions').update({ status:newStatus, updated_at:new Date().toISOString() }).eq('id', sc.id);
      if (error) return { ok:false, error:error.message };
      _agInvalidateCtx();
      setTimeout(() => { if (typeof loadScheduled==='function') loadScheduled().catch(()=>{}); }, 300);
      return { ok:true, mensagem:`Programado "${sc.description}" ${args.action==='pause'?'pausado':'retomado'}.` };
    }

    /* ── create_budget ────────────────────────────────────────────────── */
    case 'create_budget': {
      const cat = match(ctx.categories, args.category_name);
      if (!cat) return { ok:false, error:`Categoria "${args.category_name}" não encontrada.` };
      const now = new Date();
      const month = args.month || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const { error } = await sb.from('budgets').insert({ category_id:cat.id, amount:+args.amount, month, family_id:fid, created_at:new Date().toISOString() });
      if (error) return { ok:false, error:error.message };
      _agInvalidateCtx();
      setTimeout(() => { if (typeof loadBudgets==='function') loadBudgets().catch(()=>{}); }, 300);
      return { ok:true, mensagem:`Orçamento de ${fmt(+args.amount)} para ${cat.name} em ${month} criado.` };
    }

    /* ── navigate_to ──────────────────────────────────────────────────── */
    case 'navigate_to': {
      const pages = { transacoes:'transactions', programados:'scheduled', contas:'accounts', orcamentos:'budgets', relatorios:'reports', categorias:'categories', beneficiarios:'payees', investimentos:'investments', dividas:'debts', sonhos:'dreams', mercado:'grocery', precos:'prices' };
      const page = args.page || pages[args.page] || args.page;
      if (typeof navigate === 'function') navigate(page);
      return { ok:true, mensagem:`Abrindo ${page}.` };
    }

    default:
      return { ok:false, error:`Ferramenta desconhecida: ${name}` };
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   PROCESSAMENTO PRINCIPAL
════════════════════════════════════════════════════════════════════════════ */
async function _agProcess(userText) {
  if (_ag.loading) return;
  _agAppendUser(userText);
  _agSetLoading(true);

  try {
    await _agLoadKey();
    if (!_ag.apiKey) {
      _agAppendBot('⚠️ Configure a **chave Gemini** em **Configurações → IA** para usar o assistente.');
      return;
    }

    const ctx = await _agGetContext();
    let response = await _agCallGemini(userText, ctx, null);

    // Loop de function calling (máximo 3 turnos)
    let turns = 0;
    while (turns++ < 3) {
      const candidate = response?.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const fcPart = parts.find(p => p.function_call);

      if (!fcPart) {
        // Resposta de texto — finaliza
        const text = parts.find(p => p.text)?.text || '';
        if (text) {
          _agAppendBot(text);
          // Salva turno do modelo no histórico
          _ag.history.push({ role:'model', parts:[{text}] });
        }
        break;
      }

      // Executa a ferramenta
      const fc   = fcPart.function_call;
      const name = fc.name;
      const args = fc.args || {};

      _agAppendToolCall(name, args);

      let result;
      try {
        result = await _agExecTool(name, args, ctx);
      } catch(e) {
        result = { ok:false, error:e.message };
      }

      // Devolve resultado ao Gemini para gerar resposta final
      response = await _agCallGemini(null, ctx, {
        modelParts: parts,
        resultParts: [{
          function_response: {
            name,
            response: { result },
          }
        }]
      });
    }

  } catch(e) {
    console.error('[agent]', e);
    _agAppendBot(`❌ Erro: ${e.message || 'falha na comunicação com o assistente'}. Tente novamente.`);
  } finally {
    _agSetLoading(false);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   UI — HELPERS
════════════════════════════════════════════════════════════════════════════ */
function _agLoadKey() {
  if (_ag.apiKey) return Promise.resolve();
  return getAppSetting(RECEIPT_AI_KEY_SETTING, '').then(k => {
    _ag.apiKey = (k && String(k).startsWith('AIza')) ? k : null;
    _agUpdateStatus();
  }).catch(() => {});
}

function _agUpdateStatus() {
  const dot  = document.querySelector('.ag-status-dot');
  const text = document.getElementById('agentStatusText');
  if (!dot || !text) return;
  if (_ag.loading) {
    dot.style.background  = '#f59e0b';
    text.textContent = 'Processando…';
  } else if (_ag.apiKey) {
    dot.style.background  = '#22c55e';
    text.textContent = 'Pronto';
  } else {
    dot.style.background  = '#ef4444';
    text.textContent = 'Chave Gemini não configurada';
  }
}

function _agAppendUser(text) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'ag-msg ag-msg--user';
  div.innerHTML = `<div class="ag-bubble ag-bubble--user">${esc(text)}</div>`;
  box.appendChild(div);
  _agScrollBottom();
}

function _agAppendBot(text) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'ag-msg ag-msg--bot';
  div.innerHTML = `
    <div class="ag-avatar">✦</div>
    <div class="ag-bubble ag-bubble--bot">${_agMarkdown(text)}</div>`;
  box.appendChild(div);
  _agScrollBottom();
}

function _agAppendToolCall(name, args) {
  const box = document.getElementById('agentFeed');
  if (!box) return;
  const labels = { get_summary:'📊 Consultando resumo', get_accounts:'🏦 Buscando contas', get_transactions:'📋 Buscando transações', search_transactions:'🔍 Pesquisando transações', get_budgets:'🎯 Verificando orçamentos', get_scheduled:'📆 Buscando programados', get_debts:'📉 Consultando dívidas', create_transaction:'💾 Registrando transação', create_transfer:'↔️ Registrando transferência', open_new_transaction_form:'📝 Abrindo formulário', create_scheduled:'⚙️ Criando programado', toggle_scheduled:'⏸️ Alterando programado', create_budget:'🎯 Criando orçamento', navigate_to:'🧭 Navegando' };
  const label = labels[name] || `⚙️ ${name}`;
  const div = document.createElement('div');
  div.className = 'ag-msg ag-msg--tool';
  div.innerHTML = `<div class="ag-tool-chip"><span class="ag-tool-spin">⟳</span> ${esc(label)}…</div>`;
  box.appendChild(div);
  _agScrollBottom();
}

function _agMarkdown(text) {
  return String(text||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
}

function _agScrollBottom() {
  const box = document.getElementById('agentFeed');
  if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function _agSetLoading(v) {
  _ag.loading = v;
  _agUpdateStatus();
  const btn = document.getElementById('agentSendBtn');
  if (btn) btn.disabled = v;
  if (v) {
    const box = document.getElementById('agentFeed');
    if (box) {
      const el = document.createElement('div');
      el.id = 'agTyping';
      el.className = 'ag-msg ag-msg--bot';
      el.innerHTML = `<div class="ag-avatar">✦</div><div class="ag-bubble ag-bubble--bot ag-typing"><span></span><span></span><span></span></div>`;
      box.appendChild(el);
      _agScrollBottom();
    }
  } else {
    document.getElementById('agTyping')?.remove();
  }
}

function _agOpenModal(modalId, prefill) {
  if (typeof openTransactionModal === 'function' && modalId === 'txModal') {
    openTransactionModal(null);
    requestAnimationFrame(() => {
      if (prefill.type && typeof setTxType === 'function') setTxType(prefill.type);
      if (prefill.amount && typeof setAmtField === 'function') setAmtField('txAmount', prefill.amount);
      if (prefill.description) { const el = document.getElementById('txDesc'); if(el) el.value = prefill.description; }
      if (prefill.account_id) { const el = document.getElementById('txAccountId'); if(el) el.value = prefill.account_id; }
      if (prefill.category_id) { const el = document.getElementById('txCategoryId'); if(el) el.value = prefill.category_id; }
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   UI PRINCIPAL
════════════════════════════════════════════════════════════════════════════ */
function toggleAgent() {
  _ag.open = !_ag.open;
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  if (_ag.open) {
    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('agent-open'));
    if (!_ag.welcomed) { _agWelcome(); _ag.welcomed = true; }
    _agUpdateContextBar();
    setTimeout(() => document.getElementById('agentInput')?.focus(), 200);
  } else {
    panel.classList.remove('agent-open');
    setTimeout(() => { panel.style.display = 'none'; }, 280);
  }
}

function _agWelcome() {
  const fam = (state.families || [])[0]?.name || 'sua família';
  _agAppendBot(`Olá! Sou o **FinTrack Agent**, seu assistente financeiro pessoal.\n\nPosso te ajudar a **registrar transações**, **consultar saldos e gastos**, **criar orçamentos**, **verificar programados**, entre outras coisas — tudo com linguagem natural.\n\nComo posso ajudar hoje?`);
  _agLoadKey().then(() => {
    if (!_ag.apiKey) {
      _agAppendBot('⚠️ Para usar todas as funcionalidades, configure sua **chave Gemini** em Configurações → IA.');
    }
  });
}

async function agentSend() {
  const inp = document.getElementById('agentInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text || _ag.loading) return;
  inp.value = '';
  inp.style.height = '';
  await _agProcess(text);
}

function agentSuggest(text) {
  const inp = document.getElementById('agentInput');
  if (inp) { inp.value = text; inp.focus(); }
}

function _agClearHistory() {
  _ag.history = [];
  _ag.welcomed = false;
  const box = document.getElementById('agentFeed');
  if (box) box.innerHTML = '';
  _agWelcome();
}
window._agentClearHistory = _agClearHistory;

function _agToggleFullscreen() {
  const panel = document.getElementById('agentPanel');
  if (!panel) return;
  panel.classList.toggle('agent-fullscreen');
  const btn = document.getElementById('agentFullscreenBtn');
  if (btn) btn.title = panel.classList.contains('agent-fullscreen') ? 'Sair da tela cheia' : 'Tela cheia';
}
window._agentToggleFullscreen = _agToggleFullscreen;

function _agUpdateContextBar() {
  const el = document.getElementById('agentContextPage');
  if (!el) return;
  const pages = { dashboard:'📊 Dashboard', transactions:'💳 Transações', accounts:'🏦 Contas', scheduled:'📆 Programados', budgets:'🎯 Orçamentos', reports:'📈 Relatórios', investments:'📊 Investimentos', debts:'📉 Dívidas' };
  const cur = window.state?.currentPage || 'dashboard';
  el.textContent = pages[cur] || cur;
}

function _agOnInput(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function _agOnKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentSend(); }
}
// Aliases for HTML event handlers (HTML uses _agent prefix)
window._agentOnInput    = _agOnInput;
window._agentOnKeydown  = _agOnKeydown;
window.agentSend        = agentSend;
window.agentSuggest     = agentSuggest;
window.toggleAgent      = toggleAgent;
