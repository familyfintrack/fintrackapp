/* ═══════════════════════════════════════════════════════════════════════
   FORECAST.JS  —  Previsão de fluxo de caixa
   Corrigido: nested function bug, dependências de estado, fallbacks robustos
═══════════════════════════════════════════════════════════════════════ */

const _forecastDateUtils = window.FinTrackDateUtils || {
  getUserLocale: () => document?.documentElement?.lang || navigator.language || 'pt-BR',
  getTodayLocalISO: () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  },
};

// ── Safe wrappers (funcionam mesmo se i18n/utils não carregou ainda) ──────────
const _fct   = (key) => { try { return t(key); } catch(_) { return key; } };
const _fcEsc = (s)   => { try { return esc(s); } catch(_) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } };
const _fcFmt = (v,c) => { try { return fmt(v,c); } catch(_) { return String(Number(v||0).toFixed(2)); } };

// ── Data de partes — FORA de qualquer outra função (era o bug principal) ──────
function _forecastDateParts(iso) {
  try {
    const dt = new Date(`${String(iso||'').slice(0,10)}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return { weekday:'', day:'--', monthYear:'', short:'—' };
    const locale  = _forecastDateUtils.getUserLocale();
    const weekday = new Intl.DateTimeFormat(locale, { weekday:'short' }).format(dt).replace('.','').toUpperCase();
    const day     = new Intl.DateTimeFormat(locale, { day:'2-digit' }).format(dt);
    const month   = new Intl.DateTimeFormat(locale, { month:'short' }).format(dt).replace('.','').toUpperCase();
    const year    = new Intl.DateTimeFormat(locale, { year:'2-digit' }).format(dt);
    return {
      weekday,
      day,
      monthYear: `${month} · ${year}`,
      short: `${day}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`,
    };
  } catch(_) {
    return { weekday:'', day:'--', monthYear:'', short:'—' };
  }
}

// ── Account picker init ───────────────────────────────────────────────────────
function _initForecastPicker(savedIds) {
  if (typeof _fcPickerBuild !== 'function') return;
  _fcPickerBuild('forecastAcctPicker', savedIds || [], loadForecast);
}

// ── Chart instance ────────────────────────────────────────────────────────────
let forecastChartInstance = null;

function _destroyForecastChart() {
  if (forecastChartInstance) {
    try { forecastChartInstance.destroy(); } catch(_) {}
    forecastChartInstance = null;
  }
}



function _fcGetSupabase() {
  try {
    if (typeof sb !== 'undefined' && sb) return sb;
  } catch(_) {}
  try {
    if (window.sb) return window.sb;
  } catch(_) {}
  try {
    if (typeof ensureSupabaseClient === 'function') {
      const client = ensureSupabaseClient();
      if (client) return client;
    }
  } catch(_) {}
  try {
    if (typeof window.ensureSupabaseClient === 'function') {
      const client = window.ensureSupabaseClient();
      if (client) return client;
    }
  } catch(_) {}
  return null;
}

function _fcGetCurrentUser() {
  try {
    if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
  } catch(_) {}
  try {
    if (window.currentUser) return window.currentUser;
  } catch(_) {}
  try {
    if (state && state.user) return state.user;
  } catch(_) {}
  return null;
}

async function _fcHydrateAuthContext() {
  let client = _fcGetSupabase();
  let user = _fcGetCurrentUser();

  if (!client) {
    try { client = typeof ensureSupabaseClient === 'function' ? ensureSupabaseClient() : client; } catch(_) {}
    try { client = client || (typeof window.ensureSupabaseClient === 'function' ? window.ensureSupabaseClient() : null); } catch(_) {}
  }
  if (client && !window.sb) {
    try { window.sb = client; } catch(_) {}
  }

  if (!user && client?.auth?.getSession) {
    try {
      const { data } = await client.auth.getSession();
      const authUser = data?.session?.user || null;
      if (authUser) {
        user = _fcGetCurrentUser() || {
          id: authUser.id,
          email: authUser.email || '',
          name: authUser.user_metadata?.name || authUser.email || 'Usuário',
          family_id: null,
        };
      }
    } catch(_) {}
  }

  if (user && !window.currentUser) {
    try { window.currentUser = user; } catch(_) {}
  }

  return { client, user };
}

// ── Garante que state.accounts e state.scheduled estão carregados ────────────
async function _fcEnsureState(client) {
  const sbClient = client || _fcGetSupabase();

  if (!state.accounts || !state.accounts.length) {
    try {
      if (typeof DB !== 'undefined' && DB.accounts && typeof DB.accounts.load === 'function') {
        await DB.accounts.load();
      } else if (sbClient) {
        const { data } = await famQ(
          sbClient.from('accounts')
            .select('id,name,color,currency,icon,type,balance,confirmed_balance,active,is_favorite')
            .eq('active', true)
        ).order('name');
        state.accounts = data || [];
      }
    } catch(e) { console.warn('[forecast] accounts load:', e?.message); }
  }

  if (!state.scheduled || !state.scheduled.length) {
    try {
      if (typeof loadScheduled === 'function') await loadScheduled();
    } catch(e) { console.warn('[forecast] scheduled load:', e?.message); }
  }
}

// ── loadForecast — função principal ──────────────────────────────────────────
async function loadForecast() {
  const { client: sbClient, user } = await _fcHydrateAuthContext();

  const fromStr = document.getElementById('forecastFrom')?.value || '';
  const toStr   = document.getElementById('forecastTo')?.value   || '';
  if (!fromStr || !toStr) return;

  const container = document.getElementById('forecastAccountsContainer');
  if (!sbClient) {
    console.warn('[forecast] Supabase não disponível para carregar a previsão');
    if (container) {
      container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Supabase não está disponível para carregar a previsão.</p>
      </div>`;
    }
    _destroyForecastChart();
    return;
  }

  if (!user) {
    console.warn('[forecast] contexto do usuário ausente para previsão');
    if (container) {
      container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Não foi possível identificar a sessão do usuário para carregar a previsão.</p>
      </div>`;
    }
    _destroyForecastChart();
    return;
  }

  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('forecastAcctPicker')
    : [];
  const includeScheduled = document.getElementById('forecastIncludeScheduled')?.checked !== false;

  // Salva preferência
  try {
    if (typeof _dashGetPrefs === 'function' && typeof _dashSavePrefs === 'function') {
      _dashSavePrefs({ ..._dashGetPrefs(), forecastAccounts: accIds }).catch(() => {});
    }
  } catch(_) {}

  // Loading
  if (container) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:10px">⏳</div>
        <div style="font-size:.88rem">Carregando previsão…</div>
      </div>`;
  }

  // Garante estado
  await _fcEnsureState(sbClient);

  // ── 1. Transações reais do período ──────────────────────────────────────
  let txData = [];
  try {
    let q = famQ(
      sbClient.from('transactions')
        .select([
          'id','date','description','amount','currency','brl_amount',
          'account_id','is_transfer',
          'categories(name,color,icon)',
          'payees(name)',
          'accounts!transactions_account_id_fkey(id,name,color,currency,icon,type,balance)',
        ].join(', '))
        .gte('date', fromStr)
        .lte('date', toStr)
        .order('date')
    );
    if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
    else if (accIds.length > 1) q = q.in('account_id', accIds);

    const { data, error } = await q;
    if (error) throw error;
    txData = data || [];
    window._forecastTxCache = txData; // cache para _forecastDrillRow
  } catch(e) {
    console.error('[forecast] transactions query:', e?.message);
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Erro ao carregar transações: ${_fcEsc(e?.message||'Verifique sua conexão.')}</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 2. Transações programadas do período ────────────────────────────────
  const scheduledItems = [];
  if (includeScheduled && (state.scheduled||[]).length) {
    const schList = accIds.length
      ? state.scheduled.filter(s => accIds.includes(s.account_id) || accIds.includes(s.transfer_to_account_id))
      : state.scheduled;

    schList.forEach(sc => {
      if (sc.status === 'paused') return;
      if (typeof generateOccurrences !== 'function') return;

      let occ;
      try { occ = generateOccurrences(sc, 200); } catch(_) { return; }

      const registered    = new Set((sc.occurrences||[]).map(o => o.scheduled_date));
      const isTransfer    = sc.type === 'transfer' || sc.type === 'card_payment';
      const isIncome      = sc.type === 'income';
      const isExpense     = sc.type === 'expense';
      const isCardPayment = sc.type === 'card_payment';
      const baseAmt       = Math.abs(parseFloat(sc.amount)||0);

      occ.forEach(date => {
        if (date < fromStr || date > toStr || registered.has(date)) return;

        if (!accIds.length || accIds.includes(sc.account_id)) {
          let originAmt = 0;
          if (isIncome)  originAmt =  baseAmt;
          else if (isExpense || isTransfer || isCardPayment) originAmt = -baseAmt;
          if (originAmt !== 0) {
            scheduledItems.push({
              date, description: sc.description||'', amount: originAmt,
              currency: sc.currency || sc.accounts?.currency || 'BRL',
              account_id: sc.account_id,
              categories: sc.categories||null, payees: sc.payees||null,
              isScheduled: true,
            });
          }
        }

        if ((isTransfer||isCardPayment) && sc.transfer_to_account_id &&
            (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          let creditAmt = baseAmt;
          if (sc.fx_mode==='fixed' && sc.fx_rate>0) creditAmt *= sc.fx_rate;
          scheduledItems.push({
            date, description: sc.description||'', amount: creditAmt,
            currency: null, account_id: sc.transfer_to_account_id,
            categories: sc.categories||null, payees: null, isScheduled: true,
          });
        }
      });
    });
  }

  // ── 3. Merge ─────────────────────────────────────────────────────────────
  const allItems = [...txData, ...scheduledItems]
    .sort((a,b) => (a.date||'').localeCompare(b.date||''));

  if (!allItems.length) {
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">📅</div>
        <p>Nenhuma transação no período selecionado.</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 4. Resolve contas ────────────────────────────────────────────────────
  const accountIds = [...new Set(allItems.map(t => t.account_id))].filter(Boolean);

  let accounts = accIds.length
    ? (state.accounts||[]).filter(a => accIds.includes(a.id))
    : (state.accounts||[]).filter(a => accountIds.includes(a.id));

  // Fallback: extrai conta do join em txData
  if (!accounts.length) {
    const accMap = {};
    txData.forEach(tx => {
      if (tx.account_id && tx.accounts && !accMap[tx.account_id]) {
        accMap[tx.account_id] = {
          id: tx.account_id,
          name:     tx.accounts.name     || 'Conta',
          color:    tx.accounts.color    || '#2a6049',
          currency: tx.accounts.currency || tx.currency || 'BRL',
          icon:     tx.accounts.icon     || '',
          type:     tx.accounts.type     || 'corrente',
          balance:  parseFloat(tx.accounts.balance)||0,
        };
      }
    });
    // Adiciona contas de transações programadas que não estavam no txData
    scheduledItems.forEach(s => {
      if (s.account_id && !accMap[s.account_id]) {
        const fromState = (state.accounts||[]).find(a => a.id === s.account_id);
        if (fromState) accMap[s.account_id] = fromState;
      }
    });
    accounts = Object.values(accMap).filter(a => accountIds.includes(a.id));
  }

  if (!accounts.length) {
    if (container) container.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <p>Não foi possível identificar as contas. Recarregue a página e tente novamente.</p>
      </div>`;
    _destroyForecastChart();
    return;
  }

  // ── 5. Gráfico ────────────────────────────────────────────────────────────
  try { renderForecastChart(allItems, accounts, fromStr, toStr); }
  catch(e) { console.warn('[forecast] chart error:', e?.message); }

  // ── 6. Tabelas ────────────────────────────────────────────────────────────
  try { renderForecastTables(allItems, accounts); }
  catch(e) {
    console.error('[forecast] table error:', e?.message);
    if (container) container.innerHTML += `
      <div class="card" style="text-align:center;padding:24px;color:var(--muted)">
        <p>Erro ao renderizar tabela: ${_fcEsc(e?.message||'')}</p>
      </div>`;
  }
}
window.loadForecast = loadForecast;

// ── Gráfico ───────────────────────────────────────────────────────────────────
function renderForecastChart(allItems, accounts, fromStr, toStr) {
  const canvas = document.getElementById('forecastChart');
  if (!canvas || typeof Chart === 'undefined') return;
  _destroyForecastChart();

  // Build ALL daily dates (full resolution — no sampling)
  const allDates = [];
  let cur = new Date(fromStr + 'T12:00:00');
  const end = new Date(toStr + 'T12:00:00');
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
  }
  if (!allDates.length) return;

  const COLORS = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];
  const weekdays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  // Pre-index items by account and date for fast lookup
  const byAccDate = {};
  allItems.forEach(t => {
    const key = `${t.account_id}|${t.date}`;
    if (!byAccDate[key]) byAccDate[key] = [];
    byAccDate[key].push(t);
  });

  // Build daily balance + activity map
  const dailyData = {};
  allDates.forEach(d => { dailyData[d] = { txs: [], scheduled: [] }; });
  allItems.forEach(t => {
    if (!dailyData[t.date]) return;
    if (t.isScheduled) dailyData[t.date].scheduled.push(t);
    else               dailyData[t.date].txs.push(t);
  });

  // ── Line datasets (one per account, scalar y[], no points) ───────────────
  const lineDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color     = (a.color && a.color !== 'var(--accent)') ? a.color : COLORS[idx % COLORS.length];
    const txsForAcc = allItems.filter(t => t.account_id === a.id);
    const realSum   = txsForAcc.filter(t => !t.isScheduled).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    let running     = (parseFloat(a.balance)||0) - realSum;

    const yData = allDates.map(d => {
      const dayItems = txsForAcc.filter(t => t.date === d);
      dayItems.forEach(t => { running += (parseFloat(t.amount)||0); });
      return +running.toFixed(2);
    });

    return {
      label: a.name,
      data: yData,
      borderColor: color,
      backgroundColor: color + '15',
      fill: idx === 0 && accounts.length === 1,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHitRadius: 14,
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      _accountId: a.id,
      _color: color,
    };
  });

  // ── Scatter marker datasets (one per account, active days only) ──────────
  const markerDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color     = lineDatasets[idx]._color;
    const txsForAcc = allItems.filter(t => t.account_id === a.id);
    const realSum   = txsForAcc.filter(t => !t.isScheduled).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    let running     = (parseFloat(a.balance)||0) - realSum;

    const pts = [];
    allDates.forEach((d, i) => {
      const dayItems = txsForAcc.filter(t => t.date === d);
      dayItems.forEach(t => { running += (parseFloat(t.amount)||0); });
      const hasReal  = dayItems.some(t => !t.isScheduled);
      const hasSched = dayItems.some(t => t.isScheduled);
      if (!hasReal && !hasSched) return;
      pts.push({
        x: i,
        y: +running.toFixed(2),
        _date: d,
        _isSched: hasSched && !hasReal,
        _isMixed: hasReal && hasSched,
      });
    });

    return {
      type: 'scatter',
      label: '_marker_' + a.id,
      xAxisID: 'x',
      yAxisID: 'y',
      data: pts,
      backgroundColor: pts.map(p =>
        p._isMixed ? '#f59e0b' :
        p._isSched ? '#1d4ed8' :
        color
      ),
      borderColor: '#fff',
      borderWidth: 1.5,
      pointRadius: 5,
      pointHoverRadius: 8,
      pointStyle: pts.map(p => p._isSched ? 'triangle' : 'circle'),
      showLine: false,
    };
  });

  const datasets = [...lineDatasets, ...markerDatasets];

  // ── Annotations ───────────────────────────────────────────────────────────
  const todayIdx = allDates.indexOf(new Date().toISOString().slice(0,10));
  const annotations = {
    zeroLine: {
      type:'line', yMin:0, yMax:0,
      borderColor:'rgba(220,38,38,0.5)', borderWidth:1.5, borderDash:[5,3],
    },
  };
  if (todayIdx >= 0) {
    annotations.todayLine = {
      type:'line', xMin:todayIdx, xMax:todayIdx,
      borderColor:'rgba(42,122,74,0.55)', borderWidth:2, borderDash:[4,3],
      label:{ content:'Hoje', display:true, position:'start',
              font:{size:9,weight:'700'}, color:'#2a6049',
              backgroundColor:'rgba(42,122,74,0.08)', padding:{x:4,y:2}, borderRadius:3 },
    };
  }
  // Weekly guides
  allDates.forEach((d, i) => {
    if (i === 0) return;
    if (new Date(d+'T12:00').getDay() === 1) {
      annotations['wk_'+i] = {
        type:'line', xMin:i, xMax:i,
        borderColor:'rgba(125,194,66,0.07)', borderWidth:1,
      };
    }
  });

  forecastChartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12, font: { size: 11 },
            filter: item => !item.text.startsWith('_marker_'),
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10,30,18,0.93)',
          titleColor: '#f4f8f2',
          bodyColor: '#d1fae5',
          borderColor: 'rgba(125,194,66,0.3)',
          borderWidth: 1,
          padding: { x:11, y:9 },
          filter: item => !item.dataset.label?.startsWith('_marker_'),
          callbacks: {
            title(items) {
              const d = items[0]?.label || '';
              if (!d) return '';
              const [y,m,day] = d.split('-');
              const wd  = weekdays[new Date(d+'T12:00').getDay()];
              const dd  = dailyData[d];
              const nR  = (dd?.txs||[]).length;
              const nS  = (dd?.scheduled||[]).length;
              const parts = [];
              if (nR)  parts.push(`${nR} lançamento${nR>1?'s':''}`);
              if (nS)  parts.push(`${nS} programado${nS>1?'s':''}`);
              return `${wd}, ${day}/${m}/${y}` + (parts.length ? `  ·  ${parts.join(' + ')}` : '');
            },
            label(ctx) {
              if (ctx.dataset.label?.startsWith('_marker_')) return null;
              const bal = ctx.parsed.y;
              if (bal == null) return '';
              const acc = lineDatasets[ctx.datasetIndex];
              return `  ${ctx.dataset.label}: ${_fcFmt(bal)}`;
            },
            afterBody(items) {
              const d   = items[0]?.label || '';
              const dd  = dailyData[d];
              if (!dd) return [];
              const all = [...(dd.txs||[]), ...(dd.scheduled||[])];
              if (!all.length) return [];
              const lines = [''];
              all.slice(0, 6).forEach(t => {
                const neg   = Number(t.amount) < 0;
                const sign  = neg ? '−' : '+';
                const amt   = _fcFmt(Math.abs(Number(t.amount)));
                const desc  = (t.description || t.payees?.name || '—').slice(0, 22);
                const tag   = t.isScheduled ? ' ▲' : '';
                const cat   = t.categories?.icon ? t.categories.icon + ' ' : '';
                lines.push(`  ${sign}${amt}  ${cat}${desc}${tag}`);
              });
              if (all.length > 6) lines.push(`  … e mais ${all.length - 6}`);
              lines.push('');
              lines.push('  👆 Clique para detalhes');
              return lines;
            },
          },
        },
        annotation: { annotations },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        // Skip scatter marker elements — use first line dataset element
        const el   = elements.find(e => !datasets[e.datasetIndex]?.label?.startsWith('_marker_')) || elements[0];
        const idx  = el.index;
        const date = allDates[idx];
        if (!date) return;
        const txsOnDay = allItems.filter(t => t.date === date);
        if (!txsOnDay.length) return;
        const dp = typeof _forecastDateParts === 'function'
          ? _forecastDateParts(date) : { short: date };
        const label = dp.weekday ? `${dp.weekday}, ${dp.short}` : date;
        if (typeof _forecastDrillRow === 'function') {
          _forecastDrillRow(date, label);
        }
      },
      onHover(evt, elements) {
        const hasTx = elements.some(el => {
          const d = allDates[el.index];
          return d && allItems.some(t => t.date === d);
        });
        evt.native.target.style.cursor = (hasTx || elements.length) ? 'pointer' : 'default';
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            color: '#8c8278',
            font: { size: 10 },
            maxRotation: 0,
            callback(val, idx) {
              const d = allDates[idx];
              if (!d) return '';
              const [,m,day] = d.split('-');
              const dow = new Date(d+'T12:00').getDay();
              if (idx === 0 || idx === allDates.length - 1) return `${day}/${m}`;
              if (dow === 1) return `${day}/${m}`;
              return '';
            },
          },
          grid: {
            color: ctx => {
              const d = allDates[ctx.index];
              if (!d) return '#e8e4de18';
              return new Date(d+'T12:00').getDay() === 1
                ? 'rgba(125,194,66,0.09)' : '#e8e4de18';
            },
            lineWidth: ctx => {
              const d = allDates[ctx.index];
              return d && new Date(d+'T12:00').getDay() === 1 ? 1.5 : 0.5;
            },
          },
        },
        y: {
          ticks: {
            callback: v => _fcFmt(v),
            color: '#8c8278',
            font: { size: 10 },
            maxTicksLimit: 6,
          },
          grid: {
            color:      ctx => ctx.tick?.value === 0 ? 'rgba(220,38,38,0.45)' : '#e8e4de22',
            lineWidth:  ctx => ctx.tick?.value === 0 ? 1.5 : 1,
          },
        },
      },
    },
  });
}

// ── Tabelas por conta ─────────────────────────────────────────────────────────
function renderForecastTables(allItems, accounts) {
  const container = document.getElementById('forecastAccountsContainer');
  if (!container) return;

  if (!accounts.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:2rem;margin-bottom:12px">📅</div><p>Nenhuma conta no período.</p></div>`;
    return;
  }

  const today = _forecastDateUtils.getTodayLocalISO();

  container.innerHTML = accounts.map(a => {
    const txs = allItems.filter(t=>t.account_id===a.id).sort((x,y)=>(x.date||'').localeCompare(y.date||''));
    if (!txs.length) return '';

    const realSum      = txs.filter(t=>!t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    let runningBalance = (parseFloat(a.balance)||0) - realSum;
    const periodSum    = txs.reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    const finalBalance = (parseFloat(a.balance)||0) - realSum + periodSum;
    const accentColor  = (a.color && a.color!=='var(--accent)') ? a.color : '#2a6049';

    let currentDateGroup = null;

    const rows = txs.map(t => {
      runningBalance += parseFloat(t.amount)||0;
      const isPast   = t.date < today;
      const isToday  = t.date === today;
      const prevBal  = runningBalance; // saldo ANTES desta TX
      const isNeg    = runningBalance < 0;
      const isPos    = runningBalance >= 0;
      const crossedToNeg = prevBal >= 0 && runningBalance < 0;  // pos → neg
      const crossedToPos = prevBal < 0  && runningBalance >= 0; // neg → pos
      const isSignChange = crossedToNeg || crossedToPos;
      const rowCls   = [
        isPast  ? 'forecast-row-past'  : '',
        isToday ? 'forecast-row-today' : '',
        isNeg   ? 'forecast-row-negative' : '',
        crossedToNeg ? 'forecast-row-cross-neg' : '',
        crossedToPos ? 'forecast-row-cross-pos' : '',
      ].filter(Boolean).join(' ');
      const catColor = t.categories?.color || (parseFloat(t.amount)>=0 ? 'var(--accent)' : 'var(--red)');
      const dp       = _forecastDateParts(t.date);
      const todayBadge = isToday ? '<span class="forecast-date-today">Hoje</span>' : '';
      const catLine  = t.categories?.name ? `<div class="forecast-line forecast-category" style="color:${catColor}"><span class="forecast-cat-dot" style="background:${catColor}"></span>${_fcEsc(t.categories.name)}</div>` : '';
      const paLine   = t.payees?.name ? `<div class="forecast-line forecast-payee">${_fcEsc(t.payees.name)}</div>` : '';
      const scBadge  = t.isScheduled ? '<span style="font-size:.62rem;background:rgba(30,91,168,.12);color:#1e5ba8;border-radius:4px;padding:1px 5px;margin-left:4px">prog.</span>' : '';

      // ── Badge de alerta inline na descrição ───────────────────────────
      const signChangeBadge = crossedToNeg
        ? '<span class="forecast-sign-badge forecast-sign-badge--neg">⚠ Fica negativa</span>'
        : crossedToPos
          ? '<span class="forecast-sign-badge forecast-sign-badge--pos">✓ Volta ao positivo</span>'
          : '';

      // ── Separador visual entre zonas positiva e negativa ──────────────
      const crossDivider = isSignChange
        ? `<tr class="forecast-cross-divider forecast-cross-divider--${crossedToNeg?'neg':'pos'}" aria-hidden="true"><td colspan="3"><div class="forecast-cross-line"><span class="forecast-cross-label">${crossedToNeg ? '⚠ Saldo fica negativo a partir daqui' : '✓ Saldo volta ao positivo a partir daqui'}</span></div></td></tr>`
        : '';

      const grpHdr = currentDateGroup !== t.date
        ? (() => {
            currentDateGroup = t.date;
            return `<tr class="forecast-date-group-row${isToday?' forecast-date-group-row--today':''}"><td colspan="3"><div class="forecast-date-group-pill"><div class="forecast-date-group-copy"><span class="forecast-date-group-main">${dp.weekday}</span><span class="forecast-date-group-sub">${dp.short}</span></div>${todayBadge}</div></td></tr>`;
          })()
        : '';

      const drillLabel = (t.description||dp.short).replace(/'/g,"\\'");
      const amt = parseFloat(t.amount)||0;
      const clickAction = (!t.isScheduled && t.id)
        ? `if(typeof editTransaction==='function')editTransaction('${t.id}')`
        : `if(typeof _forecastDrillRow==='function')_forecastDrillRow('${t.date}','${drillLabel}')`;
      const rowTitle = t.isScheduled ? 'Ver programados desta data' : 'Editar transação';

      const runBalEmphasis = isSignChange ? ' forecast-run-bal--emphasis' : '';
      return `${crossDivider}${grpHdr}<tr class="${rowCls} forecast-tx-row" style="cursor:pointer" onclick="${clickAction}" title="${rowTitle}">
        <td class="forecast-date-cell${isToday?' forecast-date-cell--today':''}"><div class="forecast-date-card forecast-date-card--compact"><div class="forecast-date-weekday">${dp.weekday}</div><div class="forecast-date-daynum">${dp.day}</div><div class="forecast-date-monthyear">${dp.monthYear}</div></div></td>
        <td class="forecast-desc-cell"><div class="forecast-line forecast-title">${_fcEsc(t.description||'')}${scBadge}${signChangeBadge}</div>${catLine}${paLine}</td>
        <td class="forecast-amount-cell ${amt>=0?'amount-pos':'amount-neg'}">
          <div class="forecast-amount-main">${amt>=0?'+':''}${_fcFmt(t.amount,a.currency)}</div>
          ${a.currency!=='BRL'&&t.brl_amount!=null?`<div class="forecast-amount-brl">${_fcFmt(t.brl_amount,'BRL')}</div>`:''}
          <div class="forecast-run-bal ${isNeg?'amount-neg':isPos?'amount-pos':''}${runBalEmphasis}">${_fcFmt(runningBalance,a.currency)}</div>
        </td>
      </tr>`;
    }).join('');

    const iconHtml = typeof renderIconEl==='function'
      ? renderIconEl(a.icon, a.color, 22)
      : `<span style="font-size:1.1rem">${a.icon||'💳'}</span>`;

    return `
    <div class="forecast-account-section" id="forecastAcc-${a.id}">
      <div class="forecast-account-header" onclick="toggleForecastSection('${a.id}')">
        <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${accentColor}22;flex-shrink:0">${iconHtml}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.95rem">${_fcEsc(a.name)}</div>
          <div style="font-size:.75rem;color:var(--muted)">${_fct('fc.current_balance')} <strong>${_fcFmt(a.balance||0,a.currency)}</strong> · ${txs.length} ${txs.length!==1?_fct('fc.txs_in_period_pl'):_fct('fc.txs_in_period')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:var(--font-serif);font-weight:700;font-size:1rem;color:${finalBalance>=0?'var(--green,#16a34a)':'var(--red)'}">${_fcFmt(finalBalance,a.currency)}</div>
          <div style="font-size:.68rem;color:var(--muted)">${_fct('fc.final_balance')}</div>
        </div>
        <span id="forecastToggle-${a.id}" style="color:var(--muted);font-size:.75rem;margin-left:8px">▼</span>
      </div>
      <div class="forecast-table-wrap" id="forecastBody-${a.id}">
        <div class="table-wrap" style="margin:0">
          <table class="resizable-table forecast-grid-table" id="forecastTable-${a.id}">
            <colgroup><col class="forecast-col-date"><col class="forecast-col-desc"><col class="forecast-col-amount"></colgroup>
            <thead><tr>
              <th class="forecast-head-date">${_fct('fc.date')}</th>
              <th class="forecast-head-desc">${_fct('fc.description')}</th>
              <th class="forecast-head-amount">${_fct('fc.amount')}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr style="background:var(--surface2);font-weight:600">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem">${_fct('fc.period_total')}</td>
                <td class="${periodSum>=0?'amount-pos':'amount-neg'}" style="text-align:right;padding:7px 8px">${periodSum>=0?'+':''}${_fcFmt(periodSum,a.currency)}</td>
              </tr>
              <tr style="background:color-mix(in srgb,${accentColor} 8%,var(--surface));border-top:2px solid ${accentColor}40">
                <td colspan="2" style="padding:7px 8px;font-size:.78rem;color:var(--muted);font-weight:600">${_fct('fc.final_balance')}</td>
                <td class="${finalBalance<0?'amount-neg':''}" style="text-align:right;padding:7px 8px;font-weight:800;font-size:.95rem;font-family:var(--font-serif)">${_fcFmt(finalBalance,a.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');

  setTimeout(() => { try { if (typeof initAllResizableTables==='function') initAllResizableTables(); } catch(_) {} }, 60);
}

// ── Toggle seção aberta/fechada ───────────────────────────────────────────────
function toggleForecastSection(id) {
  const body  = document.getElementById('forecastBody-'+id);
  const arrow = document.getElementById('forecastToggle-'+id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}
window.toggleForecastSection = toggleForecastSection;

// ── Cor de periodicidade (usado por scheduled.js) ─────────────────────────────
function getPeriodColor(period) {
  return ({ daily:'#2ecc71', weekly:'#3498db', monthly:'#f39c12', yearly:'#9b59b6' })[(period||'').toLowerCase()] || '#1F6B4F';
}
window.getPeriodColor = getPeriodColor;

// ── Expor funções públicas no window ──────────────────────────────────────────
window._destroyForecastChart               = _destroyForecastChart;
window._fcEnsureState                      = _fcEnsureState;
window._initForecastPicker                 = _initForecastPicker;
