// ── State ──────────────────────────────────────────────
state.scheduled = [];

/**
 * Retorna a data LOCAL do dispositivo do usuário no formato 'YYYY-MM-DD'.
 * Evita o bug do toISOString() que retorna a data em UTC, podendo mostrar
 * o dia anterior/posterior para usuários em fusos diferentes de UTC (ex: Brasil UTC-3).
 * @param {Date} [d] - Objeto Date opcional; usa new Date() se omitido.
 * @returns {string} 'YYYY-MM-DD'
 */
function localDateStr(d) {
  const dt = d || new Date();
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dy = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}


async function _createPairedTransferLeg(originTx, sc, actualDate, memoOverride=null) {
  if(!sc?.transfer_to_account_id) return null;
  const pairedTx = {
    family_id: famId(),
    date: actualDate,
    description: sc.description,
    amount: Math.abs(originTx.amount),
    account_id: sc.transfer_to_account_id,
    payee_id: null,
    category_id: sc.category_id || null,
    memo: memoOverride ?? originTx.memo ?? sc.memo,
    tags: sc.tags,
    is_transfer: true,
    is_card_payment: sc.type==='card_payment',
    transfer_to_account_id: sc.account_id,
    updated_at: new Date().toISOString(),
    status: originTx.status || 'confirmed',
  };
  let pairedResult, pairedErr;
  ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
    .insert({...pairedTx, linked_transfer_id: originTx.id}).select().single());
  if(pairedErr && pairedErr.message?.includes('linked_transfer_id')) {
    ({data:pairedResult, error:pairedErr} = await sb.from('transactions')
      .insert(pairedTx).select().single());
  }
  if(pairedErr) {
    toast('Ocorrência registrada, mas erro ao criar lançamento de entrada: ' + pairedErr.message, 'warning');
    return null;
  }
  // Back-link origin to paired (best-effort)
  try { await sb.from('transactions').update({linked_transfer_id: pairedResult.id}).eq('id', originTx.id).then(()=>{}); } catch(_) {};
  return pairedResult;
}


function _isScheduledOccurrenceAlreadyProcessed(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('unique constraint') || msg.includes('conflict');
}

async function _reserveScheduledOccurrence(sc, scheduledDate, actualDate, amount, memo) {
  const executionToken = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const { data: existingBefore } = await sb.from('scheduled_occurrences')
    .select('id,scheduled_id,scheduled_date,transaction_id,execution_status,execution_token')
    .eq('scheduled_id', sc.id)
    .eq('scheduled_date', scheduledDate)
    .maybeSingle();

  if (existingBefore?.transaction_id || existingBefore?.execution_status === 'executed') {
    return { status: 'already_executed', occurrence: existingBefore };
  }

  try {
    const { error: reserveErr } = await sb.from('scheduled_occurrences').upsert({
      scheduled_id: sc.id,
      scheduled_date: scheduledDate,
      actual_date: actualDate,
      amount,
      memo: memo ?? null,
      execution_status: 'processing',
      execution_token: executionToken,
      executed_at: null,
      transaction_id: null,
    }, { onConflict: 'scheduled_id,scheduled_date' });
    if (reserveErr && !_isScheduledOccurrenceAlreadyProcessed(reserveErr)) throw reserveErr;
  } catch (err) {
    return { status: 'error', error: err };
  }

  const { data: reserved, error: readErr } = await sb.from('scheduled_occurrences')
    .select('id,scheduled_id,scheduled_date,transaction_id,execution_status,execution_token')
    .eq('scheduled_id', sc.id)
    .eq('scheduled_date', scheduledDate)
    .maybeSingle();

  if (readErr) return { status: 'error', error: readErr };
  if (!reserved) return { status: 'error', error: new Error('Não foi possível reservar a ocorrência programada.') };
  if (reserved.transaction_id || reserved.execution_status === 'executed') {
    return { status: 'already_executed', occurrence: reserved };
  }
  if (reserved.execution_token !== executionToken) {
    return { status: 'locked_by_other', occurrence: reserved };
  }
  return { status: 'reserved', occurrence: reserved, executionToken };
}

async function _markScheduledOccurrenceFailure(scId, scheduledDate, executionToken, actualDate, amount, memo, errorMessage) {
  const payload = {
    actual_date: actualDate,
    amount,
    memo: memo ?? null,
    execution_status: 'failed',
  };
  if (errorMessage) payload.error_message = String(errorMessage).slice(0, 1000);

  let q = sb.from('scheduled_occurrences').update(payload)
    .eq('scheduled_id', scId)
    .eq('scheduled_date', scheduledDate);
  if (executionToken) q = q.eq('execution_token', executionToken);
  await q.then(()=>{}).catch(()=>{});
}

async function _finalizeScheduledOccurrence(scId, scheduledDate, executionToken, actualDate, amount, memo, transactionId) {
  const payload = {
    actual_date: actualDate,
    amount,
    memo: memo ?? null,
    transaction_id: transactionId,
    execution_status: 'executed',
    executed_at: new Date().toISOString(),
  };
  let q = sb.from('scheduled_occurrences').update(payload)
    .eq('scheduled_id', scId)
    .eq('scheduled_date', scheduledDate);
  if (executionToken) q = q.eq('execution_token', executionToken);
  const { error } = await q;
  return { error };
}

async function processScheduledOccurrence(sc, opts = {}) {
  const scheduledDate = opts.scheduledDate;
  const actualDate = opts.actualDate || scheduledDate;
  const memo = opts.memo ?? sc.memo ?? null;
  const amountInput = Number(opts.amount ?? sc.amount ?? 0);
  const isScTransfer = sc.type === 'transfer' || sc.type === 'card_payment';
  const finalAmount = opts.finalAmount ?? ((sc.type === 'expense' || isScTransfer) ? -Math.abs(amountInput) : Math.abs(amountInput));
  const txStatus = (sc.auto_confirm ?? true) ? 'confirmed' : 'pending';

  const reservation = await _reserveScheduledOccurrence(sc, scheduledDate, actualDate, finalAmount, memo);
  if (reservation.status === 'already_executed' || reservation.status === 'locked_by_other') {
    return reservation;
  }
  if (reservation.status === 'error') {
    return reservation;
  }

  const executionToken = reservation.executionToken;

  const txPayload = {
    family_id: famId(),
    date: actualDate,
    description: sc.description,
    amount: finalAmount,
    account_id: sc.account_id,
    payee_id: isScTransfer ? null : (sc.payee_id || null),
    category_id: sc.category_id || null,
    memo,
    tags: sc.tags,
    is_transfer: isScTransfer,
    is_card_payment: sc.type === 'card_payment',
    transfer_to_account_id: isScTransfer ? sc.transfer_to_account_id : null,
    updated_at: new Date().toISOString(),
    status: txStatus,
    // Propagate member attribution from the scheduled transaction
    family_member_id:  sc.family_member_id  || null,
    family_member_ids: sc.family_member_ids?.length ? sc.family_member_ids : [],
  };

  const { data: txData, error: txErr } = await sb.from('transactions').insert(txPayload).select().single();
  if (txErr) {
    await _markScheduledOccurrenceFailure(sc.id, scheduledDate, executionToken, actualDate, finalAmount, memo, txErr.message);
    return { status: 'error', error: txErr };
  }

  if (isScTransfer) {
    try {
      await _createPairedTransferLeg(txData, sc, actualDate, memo);
    } catch (pairErr) {
      console.warn('[scheduled paired leg]', pairErr?.message || pairErr);
    }
  }

  const { error: occErr } = await _finalizeScheduledOccurrence(sc.id, scheduledDate, executionToken, actualDate, finalAmount, memo, txData.id);
  if (occErr) {
    await _markScheduledOccurrenceFailure(sc.id, scheduledDate, executionToken, actualDate, finalAmount, memo, occErr.message);
    return { status: 'error', error: occErr, transaction: txData };
  }

  return { status: 'executed', transaction: txData, executionToken, amount: finalAmount, actualDate, txStatus };
}

// ── Frequency helpers ──────────────────────────────────
const FREQ_LABELS = {
  once: 'Uma vez', weekly: 'Semanal', biweekly: 'Quinzenal',
  monthly: 'Mensal', bimonthly: 'Bimestral', quarterly: 'Trimestral',
  semiannual: 'Semestral', annual: 'Anual', custom: 'Personalizado'
};

// Adds N months to a Date, clamping to the last valid day of the target month.
// Prevents overflow: 2025-01-31 + 1 month → 2025-02-28 (not 2025-03-03).
function _addMonthsClamped(d, n) {
  const originalDay = d.getDate();
  d.setDate(1);                    // go to 1st to avoid overflow during month change
  d.setMonth(d.getMonth() + n);    // move to target month
  // Clamp to the last day of the target month
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
}

function nextDate(from, freq, customInterval, customUnit) {
  const d = new Date(from + 'T12:00:00');
  switch(freq) {
    case 'weekly':     d.setDate(d.getDate() + 7); break;
    case 'biweekly':   d.setDate(d.getDate() + 14); break;
    case 'monthly':    _addMonthsClamped(d, 1); break;
    case 'bimonthly':  _addMonthsClamped(d, 2); break;
    case 'quarterly':  _addMonthsClamped(d, 3); break;
    case 'semiannual': _addMonthsClamped(d, 6); break;
    case 'annual':     _addMonthsClamped(d, 12); break;
    case 'custom':
      const n = parseInt(customInterval) || 1;
      if(customUnit === 'days')   d.setDate(d.getDate() + n);
      else if(customUnit === 'weeks')  d.setDate(d.getDate() + n*7);
      else if(customUnit === 'months') d.setMonth(d.getMonth() + n);
      else if(customUnit === 'years')  d.setFullYear(d.getFullYear() + n);
      break;
  }
  return localDateStr(d);
}

function generateOccurrences(sc, limit = 12) {
  const dates = [];
  if(sc.frequency === 'once') {
    dates.push(sc.start_date);
    return dates;
  }
  let cur = sc.start_date;
  const today = localDateStr();
  let count = 0;
  const maxCount = sc.end_count || 999;
  const endDate = sc.end_date || '2099-12-31';
  while(count < maxCount && cur <= endDate && dates.length < limit) {
    dates.push(cur);
    count++;
    if(count >= maxCount || cur >= endDate) break;
    cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
  }
  return dates;
}

function getNextOccurrence(sc) {
  const today = localDateStr();
  const registered = (sc.occurrences || []).map(o => o.scheduled_date);
  if(sc.frequency === 'once') {
    return registered.includes(sc.start_date) ? null : sc.start_date;
  }
  let cur = sc.start_date;
  const maxCount = sc.end_count || 999;
  const endDate = sc.end_date || '2099-12-31';
  let count = 0;
  while(count < maxCount && cur <= endDate) {
    if(!registered.includes(cur)) return cur;
    count++;
    cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
  }
  return null;
}

function scFreqLabel(sc) {
  if(sc.frequency === 'custom') {
    return `A cada ${sc.custom_interval} ${({days:'dia(s)',weeks:'semana(s)',months:'mês/meses',years:'ano(s)'})[sc.custom_unit]||sc.custom_unit}`;
  }
  return FREQ_LABELS[sc.frequency] || sc.frequency;
}

function scStatusLabel(sc) {
  if(sc.status === 'paused') return {cls:'sc-status-paused', label:'⏸ Pausado'};
  if(sc.status === 'finished') return {cls:'sc-status-finished', label:'✓ Concluído'};
  const next = getNextOccurrence(sc);
  const today = localDateStr();
  if(next && next < today) return {cls:'sc-status-overdue', label:'⚠ Atrasado'};
  if(!next) return {cls:'sc-status-finished', label:'✓ Concluído'};
  return {cls:'sc-status-active', label:'● Ativo'};
}

// ── Load & Render ──────────────────────────────────────

// ── clearAllScFilters: reset all scheduled filters ──────────────────────────
function clearAllScFilters() {
  const searchEl = document.getElementById('scSearch');
  if (searchEl) searchEl.value = '';
  const searchDesktopEl = document.getElementById('scSearchDesktop');
  if (searchDesktopEl) searchDesktopEl.value = '';
  const typeEl = document.getElementById('scTypeFilter');
  if (typeEl) typeEl.value = '';
  // Reset chip to "Todos"
  document.querySelectorAll('.sc-mf-chip').forEach(b => b.classList.remove('active'));
  const allChip = document.getElementById('scChipAll');
  if (allChip) allChip.classList.add('active');
  if (typeof filterScheduled === 'function') filterScheduled();
  if (typeof toast === 'function') toast('Filtros limpos', 'info');
}
window.clearAllScFilters = clearAllScFilters;

async function loadScheduled() {
  // Recuperar view preferida — padrão: lista (carrega mais rápido, sem flash)
  // sc_view_pref: read from localStorage (fast) or app_users.preferred_sc_view (sync)
  const _savedView = (() => {
    try {
      const local = localStorage.getItem('sc_view_pref');
      if (local) return local;
      // Fallback to app_users preference (already loaded into currentUser)
      return currentUser?.preferred_sc_view || 'list';
    } catch(_) { return 'list'; }
  })();

  // Sincronizar variável de estado ANTES de qualquer render
  _scView = _savedView;

  // Aplicar visibilidade das áreas imediatamente (sem dados ainda) — elimina qualquer flash
  const _lvEarly    = document.getElementById('scListView');
  const _cvEarly    = document.getElementById('scCalendarView');
  const _catsEarly  = document.getElementById('scCategoriesView');
  const _kpiEarly   = document.getElementById('scKpiStrip');
  const _mKpiEarly  = document.getElementById('scMobileKpis');

  if (_lvEarly)    _lvEarly.style.display    = _savedView === 'list'       ? '' : 'none';
  if (_cvEarly)    _cvEarly.style.display    = _savedView === 'calendar'   ? '' : 'none';
  if (_catsEarly)  _catsEarly.style.display  = _savedView === 'categories' ? '' : 'none';
  if (_kpiEarly)   _kpiEarly.style.display   = _savedView === 'list'       ? '' : 'none';
  if (_mKpiEarly)  _mKpiEarly.style.display  = _savedView === 'list'       ? '' : 'none';

  // Atualizar botões de view imediatamente
  document.querySelectorAll('#scViewList').forEach(b => b.classList.toggle('active', _savedView === 'list'));
  document.querySelectorAll('#scViewCal').forEach(b  => b.classList.toggle('active', _savedView === 'calendar'));
  document.querySelectorAll('#scViewCats').forEach(b => b.classList.toggle('active', _savedView === 'categories'));

  try {
    const { data, error } = await famQ(sb.from('scheduled_transactions').select('*, accounts!scheduled_transactions_account_id_fkey(name,currency), payees(name), categories(name,color), occurrences:scheduled_occurrences(id,scheduled_date,actual_date,amount,memo,transaction_id,execution_status,executed_at)'));
    if(error) throw error;
    state.scheduled = data || [];

// Sort by next scheduled occurrence (closest first)
state.scheduled.sort((a,b) => {
  const da = getNextOccurrence(a) || '9999-12-31';
  const db = getNextOccurrence(b) || '9999-12-31';
  if (da < db) return -1;
  if (da > db) return 1;
  // tie-breaker: description
  return (a.description||'').localeCompare(b.description||'');
});

  } catch(e) {
    // Table might not exist yet
    if(e.message?.includes('does not exist') || e.code === '42P01') {
      document.getElementById('scheduledList').innerHTML = `
        <div class="card" style="text-align:center;padding:40px">
          <div style="font-size:2rem;margin-bottom:12px">📅</div>
          <div style="font-weight:600;margin-bottom:8px">Tabela ainda não criada</div>
          <p style="color:var(--muted);font-size:.875rem;max-width:400px;margin:0 auto 16px">
            Execute o SQL abaixo no Supabase para habilitar esta funcionalidade:
          </p>
          <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px;text-align:left;font-size:.72rem;overflow-x:auto;white-space:pre-wrap">${esc(SCHEDULED_SQL)}</pre>
        </div>`;
      return;
    }
    toast(e.message, 'error');
    return;
  }
  filterScheduled();
}

// Active chip state (replaces old scStatusFilter select)
let _scStatusChip = 'all';

function scChipFilter(event, status) {
  _scStatusChip = status;
  // Update active chip
  ['all','active','paused','finished'].forEach(s => {
    const el = document.getElementById('scChip' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.classList.toggle('active', s === status);
  });
  filterScheduled();
}

function filterScheduled() {
  // Read search from whichever input the user is typing in (mobile panel or desktop panel)
  const _mSearch  = document.getElementById('scSearch')?.value || '';
  const _dSearch  = document.getElementById('scSearchDesktop')?.value || '';
  const search = (_dSearch || _mSearch).toLowerCase();
  // Keep both search inputs in sync
  const _mEl = document.getElementById('scSearch');
  const _dEl = document.getElementById('scSearchDesktop');
  if (_mEl && _dEl) {
    if (_dSearch && _mEl.value !== _dEl.value) _mEl.value = _dEl.value;
    else if (_mSearch && _dEl.value !== _mEl.value) _dEl.value = _mEl.value;
  }
  const statusF = _scStatusChip || '';
  // Read from mobile filter OR desktop panel filter — whichever has a value
  // (desktop uses scTypeFilterDesktop to avoid duplicate-id collision with mobile)
  const _mobileType  = document.getElementById('scTypeFilter')?.value || '';
  const _desktopType = document.getElementById('scTypeFilterDesktop')?.value || '';
  const typeF = _desktopType || _mobileType;

  let list = state.scheduled;
  if(search) list = list.filter(s => s.description?.toLowerCase().includes(search) || s.payees?.name?.toLowerCase().includes(search));
  if(typeF) list = list.filter(s => s.type === typeF);
  if(statusF && statusF !== 'all') {
    list = list.filter(s => {
      const st = scStatusLabel(s);
      if(statusF === 'active') return st.label.includes('Ativo') || st.label.includes('Atrasado');
      if(statusF === 'paused') return s.status === 'paused';
      if(statusF === 'finished') return !st.label.includes('Ativo') && !st.label.includes('Atrasado') && s.status !== 'paused';
    });
  }
  // Store filtered list globally so calendar + upcoming also respect active filters
  state._scFiltered = list;

  // Renderizar apenas o que está visível — evita flash entre views
  const currentView = typeof _scView !== 'undefined' ? _scView : 'list';

  if (currentView === 'calendar') {
    // View calendário: só renderizar calendário, não a lista
    renderScCalendar();
    _renderScKpis(); // KPIs usados pela barra de topo
  } else if (currentView === 'categories') {
    renderScCategories();
  } else {
    // View lista
    renderScheduled(list);
    renderUpcoming();
    _renderScKpis();
  }
  // Keep both type selects in sync so switching between views preserves selection
  const _syncVal = typeF;
  const _m = document.getElementById('scTypeFilter');
  const _d = document.getElementById('scTypeFilterDesktop');
  if (_m && _m.value !== _syncVal) _m.value = _syncVal;
  if (_d && _d.value !== _syncVal) _d.value = _syncVal;
}


// ── KPI Strip ──────────────────────────────────────────────────────────
function _renderScKpis() {
  const all = state.scheduled || [];
  const today = localDateStr();
  const in30  = new Date(); in30.setDate(in30.getDate() + 30);
  const in30s = localDateStr(in30);

  let expense30 = 0, income30 = 0, pending = 0;
  all.forEach(sc => {
    if (sc.status === 'paused' || sc.status === 'finished') return;
    const occs = generateOccurrences(sc, 60);
    occs.forEach(date => {
      if (date < today || date > in30s) return;
      const amt = Math.abs(sc.amount);
      const isExp = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
      if (isExp) expense30 += amt; else income30 += amt;
    });
    const next = getNextOccurrence(sc);
    if (next && next <= today) {
      const executed = (sc.occurrences || []).some(o => o.scheduled_date === next &&
        (o.execution_status === 'executed' || o.execution_status === 'processing'));
      if (!executed) pending++;
    }
  });

  // Desktop KPI strip
  const expEl  = document.getElementById('scKpiExpense');
  const incEl  = document.getElementById('scKpiIncome');
  const pendEl = document.getElementById('scKpiPending');
  if (expEl)  expEl.textContent  = expense30 ? '-' + fmt(expense30) : '—';
  if (incEl)  incEl.textContent  = income30  ? '+' + fmt(income30)  : '—';
  if (pendEl) pendEl.textContent = pending   ? pending + ' pendente' + (pending > 1 ? 's' : '') : '0';

  // Mobile KPI strip
  const mExpEl  = document.getElementById('scMKpiExpense');
  const mIncEl  = document.getElementById('scMKpiIncome');
  const mPendEl = document.getElementById('scMKpiPending');
  if (mExpEl)  mExpEl.textContent  = expense30 ? '-' + fmt(expense30) : '—';
  if (mIncEl)  mIncEl.textContent  = income30  ? '+' + fmt(income30)  : '—';
  if (mPendEl) mPendEl.textContent = pending + (pending !== 1 ? ' pend.' : ' pend.');

  // Show/hide pending amber
  if (pendEl) pendEl.className = 'sc-kpi-val ' + (pending > 0 ? 'sc-kpi-pending' : 'sc-kpi-ok');
  if (mPendEl) mPendEl.className = 'sc-mkpi-val ' + (pending > 0 ? 'amber' : '');
}

function renderScheduled(list) {
  const container = document.getElementById('scheduledList');

  // Summary bar
  const bar = document.getElementById('scheduledSummaryBar');
  if(bar) {
    const all = state.scheduled;
    const today = localDateStr();
    const active = all.filter(s => { const st=scStatusLabel(s); return st.label.includes('Ativo'); }).length;
    const overdue = all.filter(s => scStatusLabel(s).label.includes('Atrasado')).length;
    const paused = all.filter(s => s.status==='paused').length;
    const finished = all.filter(s => { const st=scStatusLabel(s); return st.label.includes('Concluído'); }).length;
    bar.innerHTML = [
      active   ? `<span class="badge sc-status-active" style="font-size:.8rem;padding:4px 12px">● ${active} ativo${active>1?'s':''}</span>` : '',
      overdue  ? `<span class="badge sc-status-overdue" style="font-size:.8rem;padding:4px 12px">⚠ ${overdue} atrasado${overdue>1?'s':''}</span>` : '',
      paused   ? `<span class="badge sc-status-paused" style="font-size:.8rem;padding:4px 12px">⏸ ${paused} pausado${paused>1?'s':''}</span>` : '',
      finished ? `<span class="badge sc-status-finished" style="font-size:.8rem;padding:4px 12px">✓ ${finished} concluído${finished>1?'s':''}</span>` : '',
    ].join('');
  }

  if(!list.length) {
    container.innerHTML = `<div class="card" style="text-align:center;padding:48px;color:var(--muted)">
      <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">📅</div>
      <div style="font-weight:600;margin-bottom:6px">Nenhuma transação programada</div>
      <p style="font-size:.875rem">Clique em "+ Programar" para agendar pagamentos ou recebimentos.</p>
    </div>`;
    return;
  }

  // Feature 10: separate active/paused from finished
  const activeList   = list.filter(sc => sc.status !== 'finished' && sc.status !== 'paused' || sc.status === 'paused');
  const finishedList = list.filter(sc => {
    const st = scStatusLabel(sc); return st.label.includes('Concluído');
  });
  const renderableActive   = list.filter(sc => { const st=scStatusLabel(sc); return !st.label.includes('Concluído'); });
  const renderableFinished = list.filter(sc => { const st=scStatusLabel(sc); return st.label.includes('Concluído'); });

  const activeHtml   = renderableActive.map(sc => _scCardHtml(sc)).join('');
  const finishedHtml = renderableFinished.map(sc => _scCardHtml(sc)).join('');

  let finishedSection = '';
  if (renderableFinished.length) {
    finishedSection = `
    <div class="sc-finished-section" id="scFinishedSection" style="margin-top:16px">
      <button class="sc-finished-toggle" onclick="toggleScFinished()" id="scFinishedToggleBtn"
        style="width:100%;display:flex;align-items:center;justify-content:space-between;
               padding:10px 16px;background:var(--surface2);border:1px solid var(--border);
               border-radius:var(--r-sm);cursor:pointer;font-size:.82rem;font-weight:600;
               color:var(--muted);font-family:inherit">
        <span>✓ Concluídos (${renderableFinished.length})</span>
        <svg id="scFinishedArrow" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
             style="transition:transform .2s;transform:rotate(-90deg)">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div id="scFinishedBody" style="display:none;margin-top:6px">${finishedHtml}</div>
    </div>`;
  }

  container.innerHTML = activeHtml + finishedSection;

  // Update mobile recurrents label visibility
  const mLabel = document.getElementById('scMobileRecurrentsLabel');
  if (mLabel) mLabel.style.display = (activeHtml || finishedSection) ? '' : 'none';
  return;

}

function _scCardHtml(sc) {
  const st = scStatusLabel(sc);
  const next = getNextOccurrence(sc);
  const today = localDateStr();
  const isExpense     = sc.type === 'expense' || sc.type === 'transfer' || sc.type === 'card_payment';
  const isCardPayment = sc.type === 'card_payment';
  const isTransferSc  = sc.type === 'transfer' || sc.type === 'card_payment';
  const acct     = state.accounts.find(a => a.id === sc.account_id);
  const destAcct = isTransferSc ? state.accounts.find(a => a.id === sc.transfer_to_account_id) : null;
  const regCount = (sc.occurrences||[]).length;
  const totalCount = sc.end_count ? `${regCount}/${sc.end_count}` : `${regCount}×`;
  const occList  = generateOccurrences(sc, 8);
  const registered = (sc.occurrences||[]).reduce((m,o)=>{m[o.scheduled_date]=o;return m;},{});

  // Compact meta: frequency pill + account/payee
  const freqKey = (sc.frequency || 'once').toLowerCase();
  const freqPill = `<span class="sc-freq-pill sc-freq-${freqKey}">${esc(scFreqLabel(sc))}</span>`;
  const metaParts = [];
  if (acct) metaParts.push(esc(acct.name));
  if (sc.payees) metaParts.push(esc(sc.payees.name));
  const meta = metaParts.join(' · ');

  // Type icon bg
  const iconBg = isCardPayment ? 'var(--blue-lt,#eff6ff)'
               : isTransferSc  ? 'var(--surface2)'
               : isExpense     ? 'var(--red-lt)'
               : 'var(--green-lt)';
  const icon = isCardPayment ? '💳' : isTransferSc ? '🔄' : isExpense ? '💸' : '💰';

  // Next badge
  const nextBadge = next
    ? `<span class="sc-next-pill ${next < today ? 'overdue' : next === today ? 'today' : ''}">${next === today ? '📌 Hoje' : next < today ? '⚠ ' + fmtDate(next) : fmtDate(next)}</span>`
    : '';

  // Category chip
  const catChip = sc.categories
    ? `<span class="sc-cat-chip" style="--c:${sc.categories.color}">${esc(sc.categories.name)}</span>`
    : '';

  // Member chip(s)
  const memberIds = sc.family_member_ids?.length ? sc.family_member_ids
    : (sc.family_member_id ? [sc.family_member_id] : []);
  const memberChips = memberIds.length && typeof getFamilyMemberById === 'function'
    ? memberIds.map(mid => {
        const m = getFamilyMemberById(mid);
        if (!m) return '';
        const emoji = m.avatar_emoji || (m.member_type === 'child' ? '👶' : '🧑');
        const age   = typeof _fmcCalcAge === 'function' ? _fmcCalcAge(m.birth_date) : null;
        const lbl   = emoji + ' ' + esc(m.name) + (age !== null ? ` (${age})` : '');
        return `<span class="sc-member-chip">${lbl}</span>`;
      }).filter(Boolean).join('')
    : '';

  return `<div class="sc-card" id="scCard-${sc.id}" data-id="${sc.id}">
    <!-- Header row: icon · title+meta · amount+status · actions -->
    <div class="sc-card-row" onclick="toggleScCard('${sc.id}')">
      <div class="sc-card-icon" style="background:${iconBg}">${icon}</div>
      <div class="sc-card-mid">
        <div class="sc-card-title2">${esc(sc.description)}</div>
        <div class="sc-card-meta">${freqPill}${meta ? `<span class="sc-card-meta-text">${meta}</span>` : ''}${catChip}${memberChips ? '<div class="sc-member-chips">' + memberChips + '</div>' : ''}</div>
      </div>
      <div class="sc-card-end">
        <div class="sc-card-amt ${isExpense?'amount-neg':'amount-pos'}">${isExpense?'−':'+'}${fmt(Math.abs(sc.amount), sc.currency||acct?.currency||'BRL')}</div>
        ${(sc.currency && sc.currency !== 'BRL' && acct?.currency !== sc.currency) ? `<div style="font-size:.66rem;color:var(--muted);text-align:right">≈ ${fmt(Math.abs(sc.amount) * (sc.fx_rate || 1), 'BRL')}</div>` : ''}
        <div class="sc-card-badges">${nextBadge}<span class="sc-status-badge ${st.cls}">${st.label}</span></div>
      </div>
      <svg class="sc-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" id="scChev-${sc.id}"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <!-- Quick action bar (always visible) -->
    <div class="sc-card-actions" onclick="event.stopPropagation()">
      ${next
        ? `<button class="sc-reg-btn" onclick="openRegisterOcc('${sc.id}','${next}')">✓ Registrar ${next===today?'hoje':fmtDate(next)}</button>`
        : `<span class="sc-reg-btn sc-reg-none">${totalCount} registradas</span>`
      }
      <div class="sc-icon-btns">
        ${(sc.frequency !== 'once' && (sc.end_count || sc.end_date) && sc.status === 'active') ? `<button class="sc-icon-btn sc-icon-antecipar" onclick="openAnteciparSerie('${sc.id}')" title="Antecipar todas as parcelas pendentes" style="background:rgba(180,83,9,.10);color:#b45309">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
        </button>` : ''}
        <button class="sc-icon-btn" onclick="toggleScStatus('${sc.id}')" title="${sc.status==='active'?'Pausar':'Reativar'}">
          ${sc.status==='active'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'
          }
        </button>
        <button class="sc-icon-btn" onclick="duplicateScheduled('${sc.id}')" title="Copiar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="sc-icon-btn" onclick="openScheduledModal('${sc.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="sc-icon-btn sc-icon-del" onclick="deleteScheduled('${sc.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
    <!-- Expanded body: occurrences -->
    <div class="sc-card-body" id="scBody-${sc.id}">
      <div class="sc-occurrences">
        <div class="sc-occ-header">Ocorrências · ${totalCount}${sc.end_date ? ` · até ${fmtDate(sc.end_date)}` : ''}</div>
        ${occList.map(date => {
          const occ = registered[date];
          const isPast  = date < today;
          const isToday = date === today;
          return `<div class="sc-occ-row">
            <span class="sc-occ-date ${isToday?'text-accent':''}">${fmtDate(date)}${isToday?' ·hoje':''}</span>
            <span class="sc-occ-label">${occ ? esc(occ.memo||sc.description) : '<span style="color:var(--muted2)">—</span>'}</span>
            <span class="sc-occ-status">
              ${occ
                ? `<span class="sc-status-badge sc-status-finished">✓ ${fmt(occ.amount||sc.amount)}</span>`
                : isPast
                  ? `<span class="sc-status-badge sc-status-overdue">Pendente</span>`
                  : `<span class="sc-status-badge" style="background:var(--bg2);color:var(--muted);border:1px solid var(--border)">Agendado</span>`
              }
            </span>
            ${!occ ? `<button class="btn-icon" style="font-size:.72rem;padding:3px 7px" onclick="openRegisterOcc('${sc.id}','${date}')">✓</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function toggleScFinished() {
  const body  = document.getElementById('scFinishedBody');
  const arrow = document.getElementById('scFinishedArrow');
  const btn   = document.getElementById('scFinishedToggleBtn');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function renderUpcoming() {
  const today = localDateStr();
  const limit = new Date(); limit.setDate(limit.getDate() + 10);
  const limitStr = localDateStr(limit);

  const upcoming = [];
  // Use filtered list so type/search filters affect upcoming panel too
  const _srcList = state._scFiltered || state.scheduled;
  _srcList.forEach(sc => {
    if(sc.status === 'paused') return;
    // Dates that are explicitly skipped (ignored) — must NOT appear in upcoming
    // EXCEPTION: dates with an AR record ('ar_pending') DO appear, but with special UI
    const arPending = state._arPendingKeys || new Set();
    const skippedDates = new Set(
      (sc.occurrences||[])
        .filter(o => o.execution_status === 'skipped' && !arPending.has(sc.id + '|' + o.scheduled_date))
        .map(o => o.scheduled_date)
    );
    const arPendingDates = new Set(
      (sc.occurrences||[])
        .filter(o => o.execution_status === 'skipped' && arPending.has(sc.id + '|' + o.scheduled_date))
        .map(o => o.scheduled_date)
    );
    const pendingDates = new Set(
      (sc.occurrences||[])
        .filter(o => o.execution_status === 'pending' && o.scheduled_date >= today && o.scheduled_date <= limitStr)
        .map(o => o.scheduled_date)
    );
    const executedDates = new Set(
      (sc.occurrences||[])
        .filter(o => o.execution_status === 'executed' || o.execution_status === 'processing')
        .map(o => o.scheduled_date)
    );
    const occ = generateOccurrences(sc, 30);
    occ.forEach(date => {
      // Skip: outside window, already executed, or explicitly ignored
      if (date < today || date > limitStr) return;
      if (executedDates.has(date)) return;
      if (skippedDates.has(date)) return;
      upcoming.push({sc, date, isPending: pendingDates.has(date),
                     isArPending: arPendingDates.has(date)});
    });
    // Also show pending occurrences that aren't in the generated list (edge case)
    pendingDates.forEach(date => {
      if (!occ.includes(date) && !skippedDates.has(date))
        upcoming.push({sc, date, isPending: true, isArPending: false});
    });
    // Also show AR-pending dates that may be outside the normal occurrence window
    arPendingDates.forEach(date => {
      if (date >= today && date <= limitStr && !occ.includes(date))
        upcoming.push({sc, date, isPending: false, isArPending: true});
    });
  });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const card    = document.getElementById('scheduledUpcomingCard');
  const listEl  = document.getElementById('scheduledUpcomingList');
  const totalEl = document.getElementById('scheduledUpcomingTotal');
  const cntEl   = document.getElementById('scheduledUpcomingCount');
  if(!upcoming.length) { if(card) card.style.display='none'; return; }

  if(card) card.style.display = '';
  if(cntEl) cntEl.textContent = upcoming.length + ' item' + (upcoming.length>1?'s':'');
  if(totalEl) {
    const tot = upcoming.reduce((s,{sc}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      return s + (isExp ? -1 : 1) * Math.abs(sc.amount);
    }, 0);
    totalEl.textContent = (tot>=0?'+':'') + fmt(tot);
    totalEl.className = 'badge ' + (tot>=0?'badge-green':'badge-red');
  }
  // Card starts expanded by default (display is '' from HTML)
  // toggleUpcomingCard() handles collapse/expand on click

  // Agrupar por data
  const byDate = {};
  upcoming.forEach(u => { if(!byDate[u.date]) byDate[u.date]=[]; byDate[u.date].push(u); });

  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = localDateStr(tomorrow);

  if(listEl) listEl.innerHTML = Object.entries(byDate).map(([date, items]) => {
    const isToday    = date === today;
    const isTomorrow = date === tomorrowStr;
    const dow = DOW[new Date(date+'T12:00:00').getDay()];
    const dayLabel = isToday ? '🔔 Hoje' : isTomorrow ? '📆 Amanhã' : `${dow}, ${fmtDate(date)}`;

    const dayTot = items.reduce((s,{sc}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      return s + (isExp ? -1 : 1)*Math.abs(sc.amount);
    }, 0);

    const gid = 'upg_' + date.replace(/-/g,'');
    const rows = items.map(({sc, isPending}) => {
      const isExp    = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      const typeIcon = sc.type==='card_payment'?'💳':sc.type==='transfer'?'↔':isExp?'↑':'↓';
      const dest     = (sc.type==='transfer'||sc.type==='card_payment')
                       ? state.accounts.find(a=>a.id===sc.transfer_to_account_id) : null;
      const catColor = sc.categories?.color || (isExp ? 'var(--red)' : 'var(--green)');
      const manualBadge = !sc.auto_register
        ? `<span class="sup-manual-badge">Manual</span>` : '';
      const pendingBadge = isPending
        ? `<span class="sup-pending-badge" title="Aguardando registro">⚠ Pendente</span>` : '';

      // AR-pending row: special styling + Receive/Cancel buttons
      if (isArPending) {
        const arRecord = (state._arPendingKeys ? [...(state._arPendingKeys)] : [])
          .find(k => k === sc.id + '|' + date);
        // Fetch arId from loaded records for action buttons
        const arRec = (window._scArRecordsCache || []).find(r => r.sc_id === sc.id && r.date === date);
        const arId  = arRec?.id || '';
        return `<div class="sup-item sup-item--ar-pending${isToday?' sup-item--today':''}">
          <div class="sup-icon" style="background:rgba(251,191,36,.15);color:#d97706;font-size:.9rem">📬</div>
          <div class="sup-body">
            <div class="sup-desc" style="color:var(--text)">${esc(sc.description)}
              <span class="sup-ar-badge">📬 A Receber</span>
            </div>
            <div class="sup-acct" style="color:var(--muted)">${esc(sc.accounts?.name||'—')} · ${fmtDate(date)}</div>
            <div style="font-size:.72rem;color:#d97706;margin-top:2px">⏳ Aguardando confirmação de recebimento</div>
          </div>
          <div class="sup-right">
            <span class="sup-amt ${isExp?'neg':'pos'}">${isExp?'−':'+'}${fmt(Math.abs(sc.amount))}</span>
            <div class="sup-actions" style="gap:5px">
              ${arId ? `<button onclick="event.stopPropagation();_scArReceive('${arId}')"
                style="padding:4px 8px;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">✅ Receber</button>
              <button onclick="event.stopPropagation();_scArCancelFromUpcoming('${arId}','${sc.id}','${date}')"
                style="padding:4px 8px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit">🗑</button>` :
              `<button onclick="event.stopPropagation();openReceivablesModal()"
                style="padding:4px 8px;background:rgba(251,191,36,.15);color:#d97706;border:1px solid rgba(251,191,36,.4);border-radius:7px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit">Ver →</button>`}
            </div>
          </div>
        </div>`;
      }

      return `<div class="sup-item${isToday?' sup-item--today':''}">
        <div class="sup-icon" style="background:color-mix(in srgb,${catColor} 14%,transparent);color:${catColor}">${typeIcon}</div>
        <div class="sup-body">
          <div class="sup-desc">${esc(sc.description)}${manualBadge}${pendingBadge}</div>
          <div class="sup-acct">${esc(sc.accounts?.name||'—')}${dest?` <span class="sup-arrow">→</span> ${esc(dest.name)}`:''}</div>
        </div>
        <div class="sup-right">
          <span class="sup-amt ${isExp?'neg':'pos'}">${isExp?'−':'+'}${fmt(Math.abs(sc.amount))}</span>
          <div class="sup-actions">
            <button class="sup-ignore-btn" title="Ignorar"
              onclick="event.stopPropagation();ignoreOccurrence('${sc.id}','${date}')">✕</button>
            <button class="sup-register-btn" onclick="openRegisterOcc('${sc.id}','${date}')">✓</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const dayNum = new Date(date+'T12:00:00').getDate();
    const dayMon = new Date(date+'T12:00:00').toLocaleString('pt-BR',{month:'short'}).replace('.','');
    const dayPill = isToday
      ? `<div class="sup-day-pill sup-day-pill--today"><span>Hoje</span></div>`
      : isTomorrow
      ? `<div class="sup-day-pill sup-day-pill--tmrw"><span>Amanhã</span></div>`
      : `<div class="sup-day-pill"><span class="sup-day-num">${dayNum}</span><span class="sup-day-mon">${dayMon}</span></div>`;

    // Para Hoje/Amanhã: subtítulo com data por extenso; demais: só dow + data
    const dowLabel = isToday
      ? `<div class="sup-group-dow-wrap">
           <span class="sup-group-dow sup-group-dow--special">Hoje</span>
           <span class="sup-group-date-sub">${dow} · ${dayNum} de ${dayMon}</span>
         </div>`
      : isTomorrow
      ? `<div class="sup-group-dow-wrap">
           <span class="sup-group-dow sup-group-dow--special">Amanhã</span>
           <span class="sup-group-date-sub">${dow} · ${dayNum} de ${dayMon}</span>
         </div>`
      : `<span class="sup-group-dow">${dow}, ${fmtDate(date)}</span>`;

    const _startOpen = isToday || isTomorrow;
    return `<div class="sup-group">
      <div class="sup-group-hdr" onclick="toggleUpcomingGroup('${gid}')">
        <div class="sup-group-left">
          ${dayPill}
          ${dowLabel}
        </div>
        <div class="sup-group-meta">
          <span class="sup-day-total ${dayTot>=0?'pos':'neg'}">${dayTot>=0?'+':''}${fmt(dayTot)}</span>
          <span class="sup-day-count">${items.length}</span>
          <svg class="sc-upcoming-day-arrow" id="${gid}_arr" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            style="transform:rotate(${_startOpen?'180':'0'}deg);transition:transform .2s"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="sup-rows" id="${gid}" style="${_startOpen?'':'display:none'}">${rows}</div>
    </div>`;
  }).join('');

  // Auto-open the desktop upcoming panel after rendering
  // (panel body starts display:none; open it so events are visible)
  const _upBody  = document.getElementById('scheduledUpcomingList');
  const _upArrow = document.getElementById('upcomingDesktopArrow');
  if (_upBody && upcoming.length > 0) {
    _upBody.style.setProperty('display', 'block', 'important');
    _upcomingDesktopOpen  = true;
    if (_upArrow) _upArrow.style.transform = 'rotate(180deg)';
  }
}

// Feature 1: toggle entire upcoming panel open/closed
function toggleUpcomingCard() {
  const listEl = document.getElementById('scheduledUpcomingList');
  const arrow  = document.getElementById('upcomingCardArrow');
  if (!listEl) return;
  const isOpen = listEl.style.display !== 'none';
  listEl.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function toggleUpcomingGroup(gid) {
  const rows  = document.getElementById(gid);
  const arrow = document.getElementById(gid + '_arr');
  if (!rows) return;
  const isOpen = rows.style.display !== 'none';
  rows.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}
function _toggleUpcomingGroupOLD(gid) {
  const rows = document.getElementById(gid);
  const arrow = document.getElementById(gid + '_arr');
  if (!rows) return;
  // Use getComputedStyle to detect actual visibility (CSS may override inline style)
  const isOpen = rows.style.display !== 'none' && getComputedStyle(rows).display !== 'none';
  if (isOpen) {
    rows.style.setProperty('display', 'none', 'important');
  } else {
    rows.style.setProperty('display', 'block', 'important');
  }
  if (arrow) arrow.classList.toggle('open', !isOpen);
}

function toggleScCard(id) {
  const body = document.getElementById('scBody-'+id);
  if(body) body.classList.toggle('open');
}

// ── Sync date entre os dois campos de data (Principal ↔ Recorrência) ──
// Ambos os campos chamam esta função via oninput/onchange.
// Ela mantém os dois sincronizados e dispara o preview.
window._scSyncDate = function(value) {
  const p = document.getElementById('scStartDatePrincipal');
  const r = document.getElementById('scStartDate');
  if (p && p.value !== value) p.value = value;
  if (r && r.value !== value) r.value = value;
  if (typeof updateScPreview === 'function') updateScPreview();
};

// ── Modal open/save/delete ─────────────────────────────
function openScheduledModal(id='') {
  const sc = id ? state.scheduled.find(s=>s.id===id) : null;
  document.getElementById('scId').value = id;
  document.getElementById('scDesc').value = sc?.description||'';
  setAmtField('scAmount', sc ? sc.amount : 0);
  document.getElementById('scMemo').value = sc?.memo||'';
  document.getElementById('scTags').value = (sc?.tags||[]).join(', ');
  document.getElementById('scStatus').value = sc?.status||'active';

  // Populate account select (favorites first)
  const aEl = document.getElementById('scAccountId');
  aEl.innerHTML = (typeof _accountOptions === 'function')
    ? _accountOptions(state.accounts, 'Selecione a conta')
    : state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
  if(sc?.account_id) aEl.value = sc.account_id;

  // Populate transfer-to account select (favorites first)
  const trEl = document.getElementById('scTransferToAccountId');
  if(trEl) {
    const trOpts = (typeof _accountOptions === 'function')
      ? _accountOptions(state.accounts, '— Selecionar conta destino —')
      : '<option value="">— Selecionar conta destino —</option>' + state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('');
    trEl.innerHTML = trOpts;
    if(sc?.transfer_to_account_id) trEl.value = sc.transfer_to_account_id;
  }

  // Populate category picker (same as transaction modal)
  buildCatPicker(null, 'sc');
  setCatPickerValue(sc?.category_id || null, 'sc');

  // Payee
  setPayeeField(sc?.payee_id||null, 'sc');

  // Type — sets FX panel visibility
  setScType(sc?.type||'expense');
  setTimeout(()=>_updateScCurrencyPanel(),30);

  // Ensure the currency selector is always editable for any source account
  const currentAccount = (state.accounts||[]).find(a => a.id === document.getElementById('scAccountId')?.value);
  _rebuildScCurrencySelect(currentAccount?.currency || 'BRL', sc?.currency || currentAccount?.currency || 'BRL');

  // Restore currency select and conversion mode
  requestAnimationFrame(() => {
    const accId      = document.getElementById('scAccountId')?.value;
    const acc        = (state.accounts||[]).find(a => a.id === accId);
    const accountCur = acc?.currency || 'BRL';
    // Build the select with the right currency pre-selected
    const savedCur = sc?.currency || _getScSelectedCurrency() || accountCur;
    _rebuildScCurrencySelect(accountCur, savedCur);
    // Restore conversion mode and rate for non-transfer types
    if (sc && sc.type !== 'transfer' && sc.type !== 'card_payment') {
      _updateScCurrencyPanel();
      const cPanel = document.getElementById('scCurrencyPanel');
      if (cPanel && cPanel.style.display !== 'none' && sc.fx_mode) {
        setScCurrencyMode(sc.fx_mode);
        if (sc.fx_mode === 'fixed' && sc.fx_rate) {
          const inp = document.getElementById('scCurrencyRate');
          if (inp) { inp.value = Number(sc.fx_rate).toFixed(6); updateScCurrencyPreview(); }
        }
      }
    }
  });

  // Restore FX settings for cross-currency transfers
  setTimeout(() => {
    onScTransferAccountChange(); // re-evaluate if currencies differ
    if (sc?.type === 'transfer') {
      const fxMode = sc?.fx_mode || 'fixed';
      setScFxMode(fxMode);
      if (fxMode === 'fixed' && sc?.fx_rate) {
        const input = document.getElementById('scFxRate');
        if (input) input.value = Number(sc.fx_rate).toFixed(6);
        updateScFxPreview();
      }
    }
  }, 50);

  // Dates — usa _scSyncDate para manter os dois campos sincronizados
  const _startDate = (sc?.start_date||'').slice(0,10) || localDateStr();
  _scSyncDate(_startDate);

  // Frequency
  const freq = sc?.frequency||'once';
  document.querySelectorAll('input[name=scFreq]').forEach(r => r.checked = r.value===freq);
  document.getElementById('scCustomIntervalGroup').style.display = freq==='custom' ? '' : 'none';
  document.getElementById('scEndGroup').style.display = freq==='once' ? 'none' : '';
  document.getElementById('scCustomInterval').value = sc?.custom_interval||1;
  document.getElementById('scCustomUnit').value = sc?.custom_unit||'months';

  // End condition
  const endType = sc?.end_count ? 'count' : sc?.end_date ? 'date' : 'forever';
  document.querySelectorAll('input[name=scEnd]').forEach(r => r.checked = r.value===endType);
  document.getElementById('scEndCountGroup').style.display = endType==='count' ? '' : 'none';
  document.getElementById('scEndDateGroup').style.display = endType==='date' ? '' : 'none';
  document.getElementById('scEndCount').value = sc?.end_count||'';
  document.getElementById('scEndDate').value = sc?.end_date||'';

  // Attach event listeners for dynamic preview (replace to avoid dupes)
  document.querySelectorAll('input[name=scFreq]').forEach(r => { r.onchange = onScFreqChange; });
  document.querySelectorAll('input[name=scEnd]').forEach(r => { r.onchange = onScEndChange; });
  // Campos de data: usa _scSyncDate (que mantém os dois sincronizados E chama updateScPreview)
  ['scStartDate','scStartDatePrincipal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = el.onchange = () => _scSyncDate(el.value);
  });
  // Demais campos: apenas atualiza o preview
  ['scEndCount','scEndDate','scCustomInterval','scCustomUnit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = updateScPreview;
  });

  document.getElementById('scheduledModalTitle').textContent = id ? 'Editar Programação' : 'Programar Transação';

  // Auto-register & notify fields
  const arEl = document.getElementById('scAutoRegister');
  const neEl = document.getElementById('scNotifyEmail');
  const naEl = document.getElementById('scNotifyEmailAddr');
  const ndEl = document.getElementById('scNotifyDaysBefore');
  const ndDiv = document.getElementById('scNotifyEmailDetails');
  const ntEl = document.getElementById('scNotifyTelegram');
  const ntdEl = document.getElementById('scNotifyTelegramDetails');
  const ntcEl = document.getElementById('scNotifyTelegramChatId');
  const ntdaysEl = document.getElementById('scNotifyTelegramDaysBefore');
  const ntUpEl = document.getElementById('scNotifyTelegramUpcoming');
  const ntProcEl = document.getElementById('scNotifyTelegramProcessed');
  const nwEl = document.getElementById('scNotifyWhatsapp');
  const nwdEl = document.getElementById('scNotifyWhatsappDetails');
  const nwnEl = document.getElementById('scNotifyWhatsappNumber');
  const nwdaysEl = document.getElementById('scNotifyWhatsappDaysBefore');
  const nwUpEl = document.getElementById('scNotifyWhatsappUpcoming');
  const nwProcEl = document.getElementById('scNotifyWhatsappProcessed');
  const nwTplEl = document.getElementById('scNotifyWhatsappTemplate');
  const nwLangEl = document.getElementById('scNotifyWhatsappLang');
  if(arEl) arEl.checked = sc?.auto_register || false;
  const acEl = document.getElementById('scAutoConfirm');
  if(acEl) {
    acEl.checked = (sc?.auto_confirm ?? true);
    _updateAutoConfirmHint();
  }

  if(neEl) {
    neEl.checked = sc?.notify_email || false;
    if(ndDiv) ndDiv.style.display = neEl.checked ? '' : 'none';
  }
  if(naEl) {
    naEl.value = sc?.notify_email_addr || currentUser?.email || '';
  }
  if(ndEl) ndEl.value = sc?.notify_days_before ?? 1;
  if(nwEl) {
    nwEl.checked = sc?.notify_whatsapp || false;
    toggleScheduledWhatsappDetails(nwEl.checked);
    if (nwdEl) nwdEl.style.display = nwEl.checked ? '' : 'none';
  }
  if(nwnEl) nwnEl.value = sc?.notify_whatsapp_number || currentUser?.whatsapp_number || '';
  if(nwdaysEl) nwdaysEl.value = sc?.notify_whatsapp_days_before ?? sc?.notify_days_before ?? 1;
  if(nwUpEl) nwUpEl.checked = sc?.notify_whatsapp_on_upcoming ?? true;
  if(nwProcEl) nwProcEl.checked = sc?.notify_whatsapp_on_processed ?? true;
  if(nwTplEl) nwTplEl.value = sc?.notify_whatsapp_template || 'scheduled_upcoming';
  if(nwLangEl) nwLangEl.value = sc?.notify_whatsapp_lang || 'pt_BR';
  if(ntEl) {
    ntEl.checked = sc?.notify_telegram || false;
    toggleScheduledTelegramDetails(ntEl.checked);
    if (ntdEl) ntdEl.style.display = ntEl.checked ? '' : 'none';
  }
  if(ntcEl) ntcEl.value = sc?.notify_telegram_chat_id || currentUser?.telegram_chat_id || '';
  if(ntdaysEl) ntdaysEl.value = sc?.notify_telegram_days_before ?? sc?.notify_days_before ?? 1;
  if(ntUpEl) ntUpEl.checked = sc?.notify_telegram_on_upcoming ?? true;
  if(ntProcEl) ntProcEl.checked = sc?.notify_telegram_on_processed ?? true;

  // Render family member multi-picker
  if (typeof renderFmcMultiPicker === 'function') {
    const preselected = sc?.family_member_ids?.length
      ? sc.family_member_ids
      : (sc?.family_member_id ? [sc.family_member_id] : []);
    renderFmcMultiPicker('scFamilyMemberPicker', {
      selected: preselected,
      placeholder: '👨‍👩‍👧 Família (geral)',
    });
  }

  updateScPreview();
  openModal('scheduledModal');
  // Show Reembolso button (only for non-transfer types)
  const _scReimbBtn = document.getElementById('scReimbBtn');
  const _scId = document.getElementById('scId')?.value;
  const _scTypeVal = document.getElementById('scTypeField')?.value;
  if (_scReimbBtn) {
    const _isScTransfer = _scTypeVal === 'transfer' || _scTypeVal === 'card_payment';
    _scReimbBtn.style.display = _isScTransfer ? 'none' : 'flex';
    if (_scId && !_isScTransfer && typeof checkReimbOnScOpen === 'function') {
      checkReimbOnScOpen(_scId).catch(()=>{});
    }
  }
  if (typeof initScFormMode === "function") initScFormMode();
  if (typeof initScFormMode === 'function') initScFormMode();
  // Apply admin notification channel visibility
  if (typeof loadNotifChannelSettings === 'function') loadNotifChannelSettings().catch(() => {});
  else if (typeof _applyNotifChannelVisibility === 'function') _applyNotifChannelVisibility();
  // Scroll modal body to top on every open
  requestAnimationFrame(() => {
    const body = document.querySelector('#scheduledModal .modal-body');
    if (body) body.scrollTop = 0;
  });
}

function setScType(type) {
  document.getElementById('scTypeField').value = type;
  const activeTab = type;
  document.querySelectorAll('#scTypeTabs .tab').forEach((t,i)=>t.classList.toggle('active',['expense','income','transfer','card_payment'][i]===activeTab));
  const isTransfer = type==='transfer' || type==='card_payment';
  const isCardPayment = type==='card_payment';
  const trGroup = document.getElementById('scTransferToGroup');
  const payGroup = document.getElementById('scPayeeGroup');
  const catGroup = document.getElementById('scCategoryGroup');
  if(trGroup) trGroup.style.display = isTransfer ? '' : 'none';
  if(payGroup) payGroup.style.display = isTransfer ? 'none' : '';
  if(catGroup) catGroup.style.display = isCardPayment ? '' : (isTransfer ? 'none' : '');
  const cpBadge = document.getElementById('scCardPaymentBadge');
  if(cpBadge) cpBadge.style.display = isCardPayment ? '' : 'none';
  const trLabel = document.querySelector('#scTransferToGroup label');
  if(trLabel) trLabel.textContent = isCardPayment ? 'Cartão de Crédito (Destino) *' : 'Conta Destino *';
  // Hide FX panel when switching away from transfer
  if (!isTransfer) _hideScFxPanel();
  // Filter source account: card_payment origin cannot be a credit card account
  _filterScAccountOrigin(isCardPayment);
  // Rebuild category picker for this type
  buildCatPicker(null, 'sc');
}

// ── Scheduled FX helpers ──────────────────────────────────────────────────

function _getScTransferCurrencies() {
  const srcId  = document.getElementById('scAccountId')?.value;
  const dstId  = document.getElementById('scTransferToAccountId')?.value;
  const srcAcc = state.accounts.find(a => a.id === srcId);
  const dstAcc = state.accounts.find(a => a.id === dstId);
  return {
    src: srcAcc?.currency || null,
    dst: dstAcc?.currency || null,
  };
}

function _hideScFxPanel() {
  const panel = document.getElementById('scFxPanel');
  if (panel) panel.style.display = 'none';
}

function onScTransferAccountChange() {
  const { src, dst } = _getScTransferCurrencies();
  const panel = document.getElementById('scFxPanel');
  if (!panel) return;
  const type = document.getElementById('scTypeField').value;
  if (type !== 'transfer' || !src || !dst || src === dst) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const title = document.getElementById('scFxTitle');
  const label = document.getElementById('scFxLabel');
  if (title) title.textContent = `Câmbio: ${src} → ${dst}`;
  if (label) label.textContent = `(1 ${src} = ? ${dst})`;
  updateScFxPreview();
}

function setScFxMode(mode) {
  const fixedBtn  = document.getElementById('scFxModeFixed');
  const apiBtn    = document.getElementById('scFxModeApi');
  const fixedPan  = document.getElementById('scFxFixedPanel');
  const apiPan    = document.getElementById('scFxApiPanel');
  const activeStyle   = 'border-color:#2563eb;background:#2563eb;color:#fff;';
  const inactiveStyle = 'border-color:#e5e7eb;background:transparent;color:#6b7280;';
  if (mode === 'fixed') {
    if (fixedBtn) fixedBtn.style.cssText += activeStyle;
    if (apiBtn)   apiBtn.style.cssText   += inactiveStyle;
    if (fixedPan) fixedPan.style.display = '';
    if (apiPan)   apiPan.style.display   = 'none';
    document.getElementById('scFxPanel')?.setAttribute('data-fx-mode', 'fixed');
  } else {
    if (fixedBtn) fixedBtn.style.cssText += inactiveStyle;
    if (apiBtn)   apiBtn.style.cssText   += activeStyle;
    if (fixedPan) fixedPan.style.display = 'none';
    if (apiPan)   apiPan.style.display   = '';
    document.getElementById('scFxPanel')?.setAttribute('data-fx-mode', 'api');
  }
}

async function fetchScSuggestedFxRate() {
  const { src, dst } = _getScTransferCurrencies();
  if (!src || !dst || src === dst) return;
  const btn  = document.getElementById('scFxFetchBtn');
  const icon = document.getElementById('scFxFetchIcon');
  const sugg = document.getElementById('scFxSuggestion');
  if (btn) btn.disabled = true;
  if (icon) icon.textContent = '⏳';
  if (sugg) sugg.style.display = 'none';
  try {
    const today = localDateStr();
    const res = await fetch(`${window.FX_API_BASE || 'https://api.frankfurter.dev/v1'}/${today}?base=${src}&to=${dst}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rate = json?.rates?.[dst];
    if (!rate) throw new Error('Taxa não encontrada');
    const rateStr = Number(rate).toFixed(6);
    const input = document.getElementById('scFxRate');
    if (input) input.value = rateStr;
    if (sugg) {
      sugg.textContent = `📡 Cotação de ${json.date||today} (BCE): 1 ${src} = ${rateStr} ${dst}`;
      sugg.style.display = '';
      sugg.style.background = '';
      sugg.style.color = '';
    }
    updateScFxPreview();
  } catch(e) {
    if (sugg) {
      sugg.textContent = `⚠️ Não foi possível buscar: ${e.message}`;
      sugg.style.display = '';
      sugg.style.background = '#fef9c3';
      sugg.style.color = '#92400e';
    }
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.textContent = '🔄';
  }
}

function updateScFxPreview() {
  const { src, dst } = _getScTransferCurrencies();
  const rateVal = parseFloat(document.getElementById('scFxRate')?.value?.replace(',', '.'));
  const amtVal  = getAmtField('scAmount');
  const preview = document.getElementById('scFxPreview');
  if (!preview) return;
  if (!rateVal || isNaN(rateVal) || !amtVal) { preview.textContent = ''; return; }
  preview.textContent = `= ${fmt(Math.abs(amtVal) * rateVal, dst)}`;
}

function _filterScAccountOrigin(excludeCreditCards) {
  const sel = document.getElementById('scAccountId');
  if (!sel || !state.accounts) return;
  const currentVal = sel.value;
  const accounts = excludeCreditCards
    ? state.accounts.filter(a => a.type !== 'cartao_credito')
    : state.accounts;
  sel.innerHTML = (typeof _accountOptions === 'function')
    ? _accountOptions(accounts, 'Selecione a conta')
    : accounts.map(a =>
        `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`
      ).join('');
  sel.value = currentVal || '';
  if (excludeCreditCards && currentVal) {
    const acct = state.accounts.find(a => a.id === currentVal);
    if (acct && acct.type === 'cartao_credito') sel.value = '';
  }
}

function onScFreqChange() {
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  document.getElementById('scCustomIntervalGroup').style.display = freq==='custom' ? '' : 'none';
  document.getElementById('scEndGroup').style.display = freq==='once' ? 'none' : '';
  updateScPreview();
}

function onScEndChange() {
  const end = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  document.getElementById('scEndCountGroup').style.display = end==='count' ? '' : 'none';
  document.getElementById('scEndDateGroup').style.display = end==='date' ? '' : 'none';
  updateScPreview();
}

function updateScPreview() {
  const preview = document.getElementById('scPreview');
  if(!preview) return;
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  // Lê a data de ambos os campos — Principal tem prioridade por ser o visível
  const start = document.getElementById('scStartDatePrincipal')?.value?.trim()
             || document.getElementById('scStartDate')?.value?.trim()
             || '';
  const end = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  const count = parseInt(document.getElementById('scEndCount').value) || null;
  const endDate = document.getElementById('scEndDate').value;
  const interval = parseInt(document.getElementById('scCustomInterval').value) || 1;
  const unit = document.getElementById('scCustomUnit').value;

  if(!start) { preview.innerHTML = '<span style="color:var(--muted2)">Defina a data de início para ver o resumo.</span>'; return; }

  const sc = { frequency: freq, start_date: start, end_count: end==='count'?count:null, end_date: end==='date'?endDate:null, custom_interval: interval, custom_unit: unit, occurrences: [] };
  const dates = generateOccurrences(sc, 6);

  let html = `<strong>${FREQ_LABELS[freq]||freq}</strong>`;
  if(freq==='custom') html += ` — a cada ${interval} ${({days:'dia(s)',weeks:'semana(s)',months:'mês/meses',years:'ano(s)'})[unit]}`;
  if(end==='count' && count) html += ` · <strong>${count}x</strong> parcelas`;
  if(end==='date' && endDate) html += ` · até <strong>${fmtDate(endDate)}</strong>`;
  if(freq !== 'once' && end==='forever') html += ' · indefinido';

  if(dates.length) {
    html += `<div class="sc-dates">${dates.map((d,i)=>`<span class="sc-date-chip">${i===0?'1ª: ':''}${fmtDate(d)}</span>`).join('')}${end!=='count'||!count||count>6?'<span class="sc-date-chip" style="opacity:.5">…</span>':''}</div>`;
  }
  preview.innerHTML = html;
}

async function saveScheduled() {
  const id = document.getElementById('scId').value;
  const freq = document.querySelector('input[name=scFreq]:checked')?.value || 'once';
  const endType = document.querySelector('input[name=scEnd]:checked')?.value || 'forever';
  const type = document.getElementById('scTypeField').value;
  const amount = getAmtField('scAmount');
  const tags = document.getElementById('scTags').value.split(',').map(s=>s.trim()).filter(Boolean);

  const autoReg = document.getElementById('scAutoRegister')?.checked || false;
  const autoConfirm = document.getElementById('scAutoConfirm')?.checked ?? true;
  const notifyEm = document.getElementById('scNotifyEmail')?.checked || false;
  const notifyWa = document.getElementById('scNotifyWhatsapp')?.checked || false;
  const notifyTg = document.getElementById('scNotifyTelegram')?.checked || false;
  const notifyWaNumber = (document.getElementById('scNotifyWhatsappNumber')?.value || '').trim();
  const notifyTgChatId = (document.getElementById('scNotifyTelegramChatId')?.value || '').trim();
  const notifyWaDaysBefore = parseInt(document.getElementById('scNotifyWhatsappDaysBefore')?.value || document.getElementById('scNotifyDaysBefore')?.value || '1', 10) || 0;
  const notifyWaUpcoming = document.getElementById('scNotifyWhatsappUpcoming')?.checked ?? true;
  const notifyWaProcessed = document.getElementById('scNotifyWhatsappProcessed')?.checked ?? true;
  const notifyWaTemplate = (document.getElementById('scNotifyWhatsappTemplate')?.value || 'scheduled_upcoming').trim();
  const notifyWaLang = (document.getElementById('scNotifyWhatsappLang')?.value || 'pt_BR').trim();
  const notifyTgDaysBefore = parseInt(document.getElementById('scNotifyTelegramDaysBefore')?.value || document.getElementById('scNotifyDaysBefore')?.value || '1', 10) || 0;
  const notifyTgUpcoming = document.getElementById('scNotifyTelegramUpcoming')?.checked ?? true;
  const notifyTgProcessed = document.getElementById('scNotifyTelegramProcessed')?.checked ?? true;
  const isScTransfer = type==='transfer' || type==='card_payment';
  const isScCardPayment = type==='card_payment';

  // FX settings — from the transfer FX panel OR from the currency conversion panel
  const fxPanel     = document.getElementById('scFxPanel');
  const fxVisible   = fxPanel && fxPanel.style.display !== 'none';
  const currPanel   = document.getElementById('scCurrencyPanel');
  const currVisible = currPanel && currPanel.style.display !== 'none';
  let fxMode = null, fxRate = null;
  if (fxVisible) {
    // Transfer between accounts with different currencies
    fxMode = fxPanel.getAttribute('data-fx-mode') || 'fixed';
    const raw = parseFloat(document.getElementById('scFxRate')?.value?.replace(',', '.'));
    fxRate = (fxMode === 'fixed' && raw > 0) ? raw : null;
  } else if (currVisible) {
    // Expense/income in a currency different from the account or BRL
    fxMode = currPanel.getAttribute('data-curr-mode') || 'fixed';
    const raw = parseFloat(document.getElementById('scCurrencyRate')?.value?.replace(',', '.'));
    fxRate = (fxMode === 'fixed' && raw > 0) ? raw : null;
  }

  const scDescEl = document.getElementById('scDesc');
  let autoScDesc = scDescEl?.value?.trim() || '';
  if (!autoScDesc) {
    // Auto-generate from payee name + category name
    const scPayeeName = document.getElementById('scPayeeName')?.value?.trim() || '';
    const scCatLabel  = document.getElementById('scCatPickerLabel')?.textContent?.trim() || '';
    const scCleanCat  = scCatLabel.replace(/^—.*—$/, '').trim();
    if (scPayeeName && scCleanCat && scCleanCat.length > 0) {
      autoScDesc = scPayeeName + ' — ' + scCleanCat;
    } else if (scPayeeName) {
      autoScDesc = scPayeeName;
    } else if (typeof ensureTransactionDescription === 'function') {
      autoScDesc = (await ensureTransactionDescription(scDescEl)).trim();
    }
    if (scDescEl && autoScDesc) scDescEl.value = autoScDesc;
  }

  const data = {
    description: autoScDesc,
    type,
    amount: (type==='expense'||isScTransfer) ? -Math.abs(amount) : Math.abs(amount),
    currency: _getScSelectedCurrency() || (()=>{const _a=(state.accounts||[]).find(a=>a.id===document.getElementById('scAccountId').value);return _a?.currency||'BRL';})(),
    account_id: document.getElementById('scAccountId').value || null,
    transfer_to_account_id: isScTransfer ? (document.getElementById('scTransferToAccountId')?.value || null) : null,
    payee_id: isScTransfer ? null : (document.getElementById('scPayeeId').value || null),
    category_id: document.getElementById('scCategoryId').value || null,
    memo: document.getElementById('scMemo').value,
    tags: tags.length ? tags : null,
    status: document.getElementById('scStatus').value,
    start_date: (() => {
      // _scSyncDate() garante que ambos os campos estão sempre iguais.
      // Lemos o campo da aba Principal como fonte primária;
      // o campo da aba Recorrência como fallback caso o Principal esteja oculto.
      const principal   = document.getElementById('scStartDatePrincipal')?.value?.trim() || '';
      const recorrencia = document.getElementById('scStartDate')?.value?.trim() || '';
      // Usa o que tiver valor; se ambos tiverem (caso normal), são iguais por design.
      return principal || recorrencia || '';
    })(),
    frequency: freq,
    custom_interval: freq==='custom' ? parseInt(document.getElementById('scCustomInterval').value)||1 : null,
    custom_unit: freq==='custom' ? document.getElementById('scCustomUnit').value : null,
    end_count: endType==='count' ? parseInt(document.getElementById('scEndCount').value)||null : null,
    end_date: endType==='date' ? document.getElementById('scEndDate').value||null : null,
    auto_register: autoReg,
    auto_confirm: autoConfirm,
    notify_email: notifyEm,
    notify_email_addr: notifyEm ? (document.getElementById('scNotifyEmailAddr')?.value.trim()||null) : null,
    notify_days_before: notifyEm ? parseInt(document.getElementById('scNotifyDaysBefore')?.value||'1') : 1,
    notify_whatsapp: notifyWa,
    notify_whatsapp_number: notifyWa ? (notifyWaNumber || null) : null,
    notify_whatsapp_days_before: notifyWa ? notifyWaDaysBefore : 1,
    notify_whatsapp_on_processed: notifyWa ? !!notifyWaProcessed : false,
    notify_whatsapp_on_upcoming: notifyWa ? !!notifyWaUpcoming : false,
    notify_whatsapp_template: notifyWa ? (notifyWaTemplate || 'scheduled_upcoming') : null,
    notify_whatsapp_lang: notifyWa ? (notifyWaLang || 'pt_BR') : 'pt_BR',
    notify_telegram: notifyTg,
    notify_telegram_chat_id: notifyTg ? (notifyTgChatId || null) : null,
    notify_telegram_days_before: notifyTg ? notifyTgDaysBefore : 1,
    notify_telegram_on_processed: notifyTg ? !!notifyTgProcessed : false,
    notify_telegram_on_upcoming: notifyTg ? !!notifyTgUpcoming : false,
    fx_mode:  fxVisible ? fxMode : null,
    fx_rate:  fxRate,
    updated_at: new Date().toISOString(),
    family_member_ids: typeof getFmcMultiPickerSelected === 'function'
      ? getFmcMultiPickerSelected('scFamilyMemberPicker')
      : [],
    family_member_id: (() => {
      if (typeof getFmcMultiPickerSelected === 'function') {
        const ids = getFmcMultiPickerSelected('scFamilyMemberPicker');
        return ids[0] || null;
      }
      return null;
    })(),
  };

  // ── Duplicate check for new scheduled transactions ──────────────────────
  if (!id) {
    try {
      const _scAmount   = data.amount;
      const _scPayeeId  = data.payee_id;
      const _scCatId    = data.category_id;
      const _scDesc     = data.description;
      const _scAccId    = data.account_id;
      const _scFreq     = data.frequency;

      if (_scAccId && _scAmount) {
        const { data: existing } = await famQ(
          sb.from('scheduled_transactions')
            .select('id,description,amount,payee_id,category_id,frequency')
        ).eq('account_id', _scAccId)
          .eq('status', 'active')
          .gte('amount', _scAmount - 0.01)
          .lte('amount', _scAmount + 0.01)
          .limit(5);

        if (existing && existing.length > 0) {
          // Regra forte: valor + conta + payee + categoria + descrição
          const strongMatch = existing.find(e =>
            (!_scPayeeId || !e.payee_id || e.payee_id === _scPayeeId) &&
            (!_scCatId   || !e.category_id || e.category_id === _scCatId) &&
            (!_scDesc    || !e.description || e.description.toLowerCase() === _scDesc.toLowerCase())
          );
          // Regra parcial: valor + conta + frequência
          const partialMatch = !strongMatch && existing.find(e => e.frequency === _scFreq);

          if (strongMatch || partialMatch) {
            const amtFmt = typeof fmt === 'function' ? fmt(Math.abs(_scAmount)) : Math.abs(_scAmount).toFixed(2);
            const payeeName = document.getElementById('scPayeeName')?.value?.trim() || '—';
            const catLabel  = document.getElementById('scCatPickerLabel')?.textContent?.replace(/^—.*—$/, '').trim() || '—';
            const freqLabel = _scFreq;

            // Reutilizar _txDupConfirm se disponível, senão modal inline
            let confirmed = false;
            if (typeof _txDupConfirm === 'function') {
              confirmed = await _txDupConfirm({
                payeeName: strongMatch ? payeeName : null,
                catLabel:  strongMatch ? catLabel  : null,
                amtFmt,
                dateLabel: data.start_date,
                level: strongMatch ? 'strong' : 'partial',
                message: strongMatch
                  ? 'Já existe uma transação programada com os mesmos dados (valor, conta, beneficiário e categoria).'
                  : `Já existe uma transação programada com o mesmo valor nesta conta (frequência: ${freqLabel}).`
              });
            } else {
              confirmed = confirm(
                strongMatch
                  ? `⚠️ Já existe uma transação programada similar (${amtFmt} para ${payeeName}). Deseja criar mesmo assim?`
                  : `⚠️ Já existe uma transação programada com valor ${amtFmt} nesta conta. Deseja criar mesmo assim?`
              );
            }
            if (!confirmed) return;
          }
        }
      }
    } catch(dupErr) {
      console.debug('[sc-dup-check]', dupErr.message); // non-fatal
    }
  }
  // ── End duplicate check ───────────────────────────────────────────────────

  if(!data.account_id) { toast('Selecione a conta', 'error'); return; }
  if(!isScTransfer && !data.payee_id) {
    toast('Beneficiário / Fonte é obrigatório.','error');
    if(typeof switchScTab==='function') {
      const btn = document.querySelector('[data-tab="scCtxPrincipal"]');
      if(btn) switchScTab('scCtxPrincipal', btn);
    }
    setTimeout(()=>document.getElementById('scPayeeName')?.focus(),100);
    return;
  }
  if(!isScTransfer && !data.category_id) {
    toast('Categoria é obrigatória.','error');
    if(typeof switchScTab==='function') {
      const btn = document.querySelector('[data-tab="scCtxPrincipal"]');
      if(btn) switchScTab('scCtxPrincipal', btn);
    }
    return;
  }
  if(isScTransfer && !data.transfer_to_account_id) { toast('Selecione a conta destino da transferência', 'error'); return; }
  if(isScTransfer && data.account_id === data.transfer_to_account_id) { toast('Conta origem e destino não podem ser iguais', 'error'); return; }
  if(!data.start_date) { toast('Informe a data de início', 'error'); return; }
  if (notifyWa && !notifyWaNumber) { toast('Informe o número de WhatsApp para a notificação.', 'error'); return; }
  if (notifyTg && !notifyTgChatId) { toast('Informe o Chat ID do Telegram para a notificação.', 'error'); return; }

  let err, newId = id;
  if(!id) data.family_id = famId();
  if(id) { ({error:err} = await sb.from('scheduled_transactions').update(data).eq('id',id)); }
  else {
    const {data: inserted, error: insErr} = await sb.from('scheduled_transactions').insert(data).select('id').single();
    err = insErr;
    if (inserted?.id) newId = inserted.id;
  }
  if(err) { toast(err.message,'error'); return; }
  const _scNew=!id;
  toast(id?'Programação atualizada!':'Transação programada!','success');
  closeModal('scheduledModal');
  await loadScheduled();
  if(_scNew) {
    const sel = newId ? `.sc-card[data-id="${newId}"],.sc-item[data-id="${newId}"]` : '.sc-card:first-child,.sc-item:first-child';
    _scrollTopAndHighlight(sel, 2500);
  }
}

async function deleteScheduled(id) {
  if(!confirm('Excluir esta programação e todas as ocorrências?')) return;
  await sb.from('scheduled_occurrences').delete().eq('scheduled_id', id);
  const {error} = await sb.from('scheduled_transactions').delete().eq('id', id);
  if(error) { toast(error.message,'error'); return; }
  toast('Removido','success');
  loadScheduled();
}

async function toggleScStatus(id) {
  const sc = state.scheduled.find(s=>s.id===id);
  if(!sc) return;
  const newStatus = sc.status==='active'?'paused':'active';
  const {error} = await sb.from('scheduled_transactions').update({status:newStatus}).eq('id',id);
  if(error) { toast(error.message,'error'); return; }
  sc.status = newStatus;
  filterScheduled();
}

// Feature 8: Update hint for auto_confirm status
function _prefillScheduledEmailDefault() {
  const el = document.getElementById('scNotifyEmailAddr');
  if (!el || (el.value || '').trim()) return;
  el.value = currentUser?.email || '';
}
function _prefillScheduledWhatsappDefault() {
  const el = document.getElementById('scNotifyWhatsappNumber');
  if (!el || (el.value || '').trim()) return;
  el.value = currentUser?.whatsapp_number || '';
}
function _prefillScheduledTelegramDefault() {
  const el = document.getElementById('scNotifyTelegramChatId');
  if (!el || (el.value || '').trim()) return;
  el.value = currentUser?.telegram_chat_id || '';
}
function toggleScheduledEmailDetails(show) {
  const details = document.getElementById('scNotifyEmailDetails');
  if (details) details.style.display = show ? '' : 'none';
  if (show) _prefillScheduledEmailDefault();
}
window.toggleScheduledEmailDetails = toggleScheduledEmailDetails;

function toggleScheduledWhatsappDetails(show) {
  const details = document.getElementById('scNotifyWhatsappDetails');
  if (details) details.style.display = show ? '' : 'none';
  if (show) _prefillScheduledWhatsappDefault();
}
window.toggleScheduledWhatsappDetails = toggleScheduledWhatsappDetails;

function toggleScheduledTelegramDetails(show) {
  const details = document.getElementById('scNotifyTelegramDetails');
  if (details) details.style.display = show ? '' : 'none';
  if (show) _prefillScheduledTelegramDefault();
}
window.toggleScheduledTelegramDetails = toggleScheduledTelegramDetails;

function _updateAutoConfirmHint() {
  const el  = document.getElementById('scAutoConfirm');
  const hint = document.getElementById('scAutoConfirmHint');
  if (!hint) return;
  const confirmed = el ? el.checked : true;
  hint.textContent = confirmed
    ? '✅ Lançará como Confirmada'
    : '⏳ Lançará como Pendente';
  hint.style.color = confirmed ? 'var(--green,#16a34a)' : 'var(--amber,#b45309)';
}

// ── Feature 7: Ignorar uma ocorrência específica ──────────────────────────
async function ignoreOccurrence(scId, date) {
  if (!confirm(`Ignorar a ocorrência de ${fmtDate(date)}?\n\nApenas esta data será desconsiderada. As próximas ocorrências continuam normais.`)) return;
  const { error } = await sb.from('scheduled_occurrences').upsert({
    scheduled_id: scId,
    scheduled_date: date,
    actual_date: date,
    amount: 0,
    execution_status: 'skipped',
    executed_at: new Date().toISOString(),
  }, { onConflict: 'scheduled_id,scheduled_date' });
  if (error) { toast('Erro ao ignorar ocorrência: ' + error.message, 'error'); return; }
  toast('Ocorrência ignorada. Próximas datas não são afetadas.', 'success');
  await loadScheduled();
}

// ── Register Occurrence ────────────────────────────────
let _registerOccScId = null;
let _registerOccDate = null;

function openRegisterOcc(scId, date) {
  _registerOccScId = scId;
  _registerOccDate = date;
  const sc = state.scheduled.find(s=>s.id===scId);
  if(!sc) return;
  document.getElementById('occScId').value = scId;
  document.getElementById('occDate').value = date;
  setAmtField('occAmount', sc.amount);
  document.getElementById('occMemo').value = '';

  // Populate the hero header
  const isIncome = sc.type === 'income';
  const isExpense = sc.type === 'expense' || sc.type === 'card_payment';
  const typeEmoji = isIncome ? '💰' : isExpense ? '💸' : '↔';

  const nameEl  = document.getElementById('occModalName');
  const metaEl  = document.getElementById('occModalMeta');
  const amtEl   = document.getElementById('occModalOriginalAmt');
  const iconEl  = document.getElementById('occModalTypeIcon');
  const acctEl  = document.getElementById('occAccountDisplay');
  const hintEl  = document.getElementById('occAmountHint');

  if (nameEl) nameEl.textContent = sc.description || '—';
  if (iconEl) iconEl.textContent = typeEmoji;
  if (amtEl)  amtEl.textContent  = (isExpense ? '−' : '+') + fmt(Math.abs(sc.amount), sc.currency || 'BRL');
  if (amtEl)  amtEl.style.color  = isIncome ? '#7dc242' : '#fca5a5';
  if (acctEl) acctEl.textContent = sc.accounts?.name || '—';
  if (hintEl) hintEl.textContent = `Valor original: ${fmt(Math.abs(sc.amount), sc.currency||'BRL')} — ajuste se houver juros ou correção`;

  // Meta chips: frequency · account · category
  if (metaEl) {
    const freqMap = { daily:'Diário', weekly:'Semanal', biweekly:'Quinzenal',
                      monthly:'Mensal', bimonthly:'Bimestral', quarterly:'Trimestral',
                      semiannual:'Semestral', annual:'Anual', once:'Único' };
    const parts = [
      freqMap[sc.frequency] || sc.frequency,
      sc.accounts?.name,
      sc.payees?.name,
    ].filter(Boolean);
    metaEl.innerHTML = parts.map(p => `<span style="background:rgba(255,255,255,.12);padding:2px 7px;border-radius:100px">${esc(p)}</span>`).join('');
  }

  // Show/hide the "Não Recebido" button — only for income type
  _scArShowBtn(sc);
  openModal('registerOccModal');
}

async function confirmRegisterOccurrence() {
  const scId = _registerOccScId;
  const schedDate = _registerOccDate;
  const sc = state.scheduled.find(s=>s.id===scId);
  if(!sc) return;

  const actualDate = document.getElementById('occDate').value;
  const amount = getAmtField('occAmount') || Math.abs(sc.amount);
  const memo = document.getElementById('occMemo').value;

  // ── Duplicate detection against existing transactions ──────────────────
  try {
    const signedAmt = (sc.type === 'expense' || sc.type === 'transfer' || sc.type === 'card_payment')
      ? -Math.abs(amount) : Math.abs(amount);

    // Query: same date + account + amount
    const { data: dupes } = await sb.from('transactions')
      .select('id,date,description,amount,account_id')
      .eq('family_id', famId())
      .eq('date', actualDate)
      .eq('account_id', sc.account_id)
      .eq('amount', signedAmt);

    if (dupes && dupes.length > 0) {
      // Determine match quality
      const exactMatch = dupes.find(d =>
        d.description?.toLowerCase() === (sc.description || '').toLowerCase()
      );
      const msgLines = [
        exactMatch
          ? '⚠️ <strong>Transação idêntica já existe</strong> — mesma data, valor, conta e descrição:'
          : '⚠️ <strong>Possível duplicata detectada</strong> — mesma data, valor e conta:',
        '',
        ...dupes.slice(0,3).map(d =>
          `• ${d.date} | ${d.description || '—'} | ${typeof fmt==='function'?fmt(d.amount,'BRL'):d.amount}`
        ),
      ];

      const confirmed = await new Promise(res => {
        const overlay = document.createElement('div');
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
        overlay.innerHTML=`<div style="background:var(--surface);border-radius:16px;padding:24px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
          <div style="font-size:1.3rem;text-align:center;margin-bottom:10px">⚠️</div>
          <div style="font-size:.9rem;color:var(--text);line-height:1.6;margin-bottom:16px">${msgLines.join('<br>')}</div>
          <div style="display:flex;gap:10px">
            <button id="_dupCancelBtn" style="flex:1;padding:11px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">
              ✕ Cancelar
            </button>
            <button id="_dupConfirmBtn" style="flex:1;padding:11px;border-radius:9px;border:none;background:#d97706;color:#fff;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">
              Registrar mesmo assim
            </button>
          </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#_dupCancelBtn').onclick  = () => { overlay.remove(); res(false); };
        overlay.querySelector('#_dupConfirmBtn').onclick = () => { overlay.remove(); res(true);  };
      });

      if (!confirmed) return;
    }
  } catch(dupErr) {
    console.warn('[dup-check]', dupErr?.message); // non-fatal — proceed
  }
  // ── End duplicate detection ────────────────────────────────────────────

  const result = await processScheduledOccurrence(sc, {
    scheduledDate: schedDate,
    actualDate,
    amount,
    memo: memo || sc.memo || null,
  });

  if(result.status === 'already_executed') {
    toast('Essa ocorrência já foi registrada anteriormente.', 'warning');
    closeModal('registerOccModal');
    await loadScheduled();
    return;
  }
  if(result.status === 'locked_by_other') {
    toast('Essa ocorrência já está sendo processada em outra execução.', 'warning');
    await loadScheduled();
    return;
  }
  if(result.status === 'error') {
    toast(result.error?.message || 'Erro ao registrar ocorrência.', 'error');
    return;
  }

  toast('Transação registrada!', 'success');
  closeModal('registerOccModal');
  await loadScheduled();
  // Refresh dashboard upcoming list if visible so registered tx disappears immediately
  if (typeof renderDashboardUpcoming === 'function' && typeof state !== 'undefined' && state.currentPage === 'dashboard') {
    renderDashboardUpcoming().catch(() => {});
  } else if (typeof renderDashboardUpcoming === 'function') {
    // Always refresh upcoming section so changes are reflected
    setTimeout(() => renderDashboardUpcoming().catch(() => {}), 300);
  }
}

// Payee autocomplete for SC modal uses shared onPayeeInput/selectPayee with ctx='sc'

// ── SQL for table creation ─────────────────────────────
const SCHEDULED_SQL = `-- Run this in your Supabase SQL Editor
CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income','transfer','card_payment')),
  amount NUMERIC NOT NULL,
  account_id UUID REFERENCES accounts(id),
  transfer_to_account_id UUID REFERENCES accounts(id),
  payee_id UUID REFERENCES payees(id),
  category_id UUID REFERENCES categories(id),
  memo TEXT,
  tags TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','finished')),
  start_date DATE NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'once'
    CHECK (frequency IN ('once','weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual','custom')),
  custom_interval INTEGER,
  custom_unit TEXT CHECK (custom_unit IN ('days','weeks','months','years')),
  end_count INTEGER,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_id UUID NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  actual_date DATE,
  amount NUMERIC,
  memo TEXT,
  transaction_id UUID REFERENCES transactions(id),
  execution_status TEXT NOT NULL DEFAULT 'pending' CHECK (execution_status IN ('pending','processing','executed','failed','skipped')),
  execution_token UUID,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_occurrence ON scheduled_occurrences (scheduled_id, scheduled_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_occurrence_tx ON scheduled_occurrences (transaction_id) WHERE transaction_id IS NOT NULL;

-- Enable RLS
ALTER TABLE scheduled_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON scheduled_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON scheduled_occurrences FOR ALL USING (true) WITH CHECK (true);`;


/* ═══════════════════════════════════════════════════════════════
   ATTACHMENT UPLOAD (Supabase Storage)
═══════════════════════════════════════════════════════════════ */


async function runScheduledAutoRegister() {
  // Runs in browser session after boot. Registers missing occurrences up to today (and optionally days ahead).
  try {
    const cfg = getAutoCheckConfig ? getAutoCheckConfig() : { daysAhead: 0 };
    const daysAhead = parseInt(cfg?.daysAhead || 0, 10) || 0;
    // Always use local midnight as the baseline — prevents timestamp-based drift.
    // new Date() could be 14:00; adding N×86400000 would point to 14:00 in N days
    // instead of midnight, causing transactions to register 0-23h too early.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0); // local midnight, no timezone ambiguity
    const todayStr = localDateStr(todayMidnight);
    // For the cutoff (toStr), add whole calendar days from local midnight
    const toDate = new Date(todayMidnight);
    toDate.setDate(toDate.getDate() + daysAhead); // calendar-day addition, not ms
    const toStr = localDateStr(toDate);

    // Ensure scheduled loaded
    if(!state.scheduled || !state.scheduled.length) return 0;

    let created = 0;
    const createdItems = [];
    for(const sc of state.scheduled) {
      if(sc.status !== 'active' || !sc.auto_register) continue;
      const occDates = generateOccurrences(sc, 500);
      for(const d of occDates) {
        if(d > toStr) break;  // dates are ordered ASC — once past cutoff, stop

        const result = await processScheduledOccurrence(sc, {
          scheduledDate: d,
          actualDate: d,
          amount: Math.abs(sc.amount),
          memo: sc.memo,
          finalAmount: sc.amount,
        });

        if(result.status === 'already_executed' || result.status === 'locked_by_other') continue;
        if(result.status === 'error') {
          console.warn('[auto_register]', result.error?.message || result.error);
          continue;
        }

        createdItems.push({ scheduled_id: sc.id, description: sc.description, date: d, amount: result.amount, status: result.txStatus, tx_id: result.transaction?.id, notify_email: sc.notify_email, notify_email_addr: sc.notify_email_addr });

        try{
          const cfg2 = getAutoCheckConfig ? getAutoCheckConfig() : null;
          const method = cfg2?.method || 'browser';
          const emailTo = sc.notify_email ? (sc.notify_email_addr || cfg2?.emailDefault || currentUser?.email) : null;
          if(method==='email' && emailTo && typeof sendScheduledNotification==='function') {
            await sendScheduledNotification(sc, d, result.amount, emailTo);
          }
        }catch(e){ console.warn('[auto_register notify email]', e.message); }

        // WhatsApp notification for processed occurrence
        try{
          const waOnProcessed = !!(sc.notify_whatsapp && sc.notify_whatsapp_on_processed);
          if(waOnProcessed && typeof sendScheduledWhatsappNotification === 'function') {
            await sendScheduledWhatsappNotification(sc, d, result.amount, 'processed');
          }
        }catch(e){ console.warn('[auto_register notify whatsapp]', e.message); }

        // Telegram notification for processed occurrence
        try{
          const tgOnProcessed = !!(sc.notify_telegram && sc.notify_telegram_on_processed);
          if(tgOnProcessed && typeof sendScheduledTelegramNotification === 'function') {
            await sendScheduledTelegramNotification(sc, d, result.amount, 'processed');
          }
        }catch(e){ console.warn('[auto_register notify telegram]', e.message); }

        created++;

        try{
          if((sc.frequency==='once' || sc.frequency==='single' || !sc.frequency) && d===todayStr){
            await sb.from('scheduled_transactions').delete().eq('id', sc.id);
          }
        }catch(e){ console.warn('[auto_register delete]', e.message); }
      }
    }
    if(created) {
      // Persist audit logs (best-effort)
      try{
        for(const it of createdItems){
          await insertScheduledRunLog({
            family_id: famId(),
            scheduled_id: it.scheduled_id,
            scheduled_date: it.date,
            transaction_id: it.tx_id,
            status: it.status,
            amount: it.amount,
            description: it.description,
            created_at: new Date().toISOString(),
          });
        }
      }catch(e){}

      // Browser notification summary
      try{ await showAutoRegisterNotification(createdItems); }catch(e){}

      await loadScheduled(); // refresh occurrences
      await loadAccounts(true);  // force refresh balances (pending excluded now)
      try{await recalcAccountBalances();}catch(_e){}
      if(state.currentPage==='transactions') loadTransactions();
      if(state.currentPage==='dashboard') loadDashboard();
      toast(`✓ ${created} ocorrência(s) registrada(s) automaticamente`, 'success');
    }
    return created;
  } catch(e) {
    console.warn('runScheduledAutoRegister error', e);
    return 0;
  }
}


// ─────────────────────────────────────────────
// Auto-run logs (admin audit)
// ─────────────────────────────────────────────
async function insertScheduledRunLog(entry){
  try{
    if(!sb) return;
    // Best-effort (table may not exist yet)
    await sb.from('scheduled_run_logs').insert(entry);
  }catch(e){
    // ignore if table missing
    console.warn('[scheduled_run_logs]', e.message);
  }
}


async function showAutoRegisterNotification(items){
  if(!items || !items.length) return;
  const title = `FinTrack: ${items.length} programada(s) registrada(s) ✅`;
  const body  = items.slice(0,3).map(i=>`• ${i.description} (${fmt(i.amount)})`).join('\n') + (items.length>3?`\n… +${items.length-3} outras`:'');
  // Try Service Worker notification first (best on mobile/PWA)
  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg && reg.showNotification){
        await reg.showNotification(title, { body, tag:'fintrack-autoreg', renotify:false });
        return;
      }
    }
  }catch(e){}
  // Fallback to Notification API (in-page)
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){
    // Do not force prompt; keep user-driven via settings
    return;
  }
  if(Notification.permission === 'granted'){
    try{ new Notification(title, { body }); }catch(e){}
  }
}


/* ══════════════════════════════════════════════════════════════════
   SCHEDULED CALENDAR VIEW
   Renders a monthly calendar showing future occurrences of all
   active scheduled transactions with semantic color coding:
     🔴 red dot    = expense / card_payment
     🟡 amber dot  = transfer
     🟢 green dot  = income
   Clicking a day opens a detail panel with full breakdown.
══════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────
let _scView       = 'list';           // 'list' | 'calendar' — padrão: lista
let _scCalYear    = new Date().getFullYear();
let _scCalMonth   = new Date().getMonth(); // 0-indexed
let _scCalSelDay  = null;             // 'YYYY-MM-DD' | null
// Expose setter so app.js can set today's date from outside this module
window._setScCalSelDay = function(d) { _scCalSelDay = d; };
window._getScCalSelDay = function()  { return _scCalSelDay; };

const SC_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── View switch ───────────────────────────────────────────────────
function setScView(view) {
  _scView = view;
  // Persist: localStorage (instant) + app_users (cross-device sync)
  try { localStorage.setItem('sc_view_pref', view); } catch(_) {}
  if (typeof sb !== 'undefined' && sb && typeof currentUser !== 'undefined' && currentUser?.id) {
    sb.from('app_users').update({ preferred_sc_view: view }).eq('id', currentUser.id)
      .then(({error}) => { if(error) console.warn('[sc_view] save:', error.message); })
      .catch(e => console.warn('[sc_view] save:', e?.message));
  }

  // Update all view buttons — handles both desktop and mobile variants
  document.querySelectorAll('#scViewList').forEach(b => b.classList.toggle('active', view === 'list'));
  document.querySelectorAll('#scViewCal').forEach(b  => b.classList.toggle('active', view === 'calendar'));
  document.querySelectorAll('#scViewCats').forEach(b => b.classList.toggle('active', view === 'categories'));

  const listView = document.getElementById('scListView');
  const calView  = document.getElementById('scCalendarView');
  const catsView = document.getElementById('scCategoriesView');
  const kpiStrip = document.getElementById('scKpiStrip');
  const mKpis    = document.getElementById('scMobileKpis');

  // Hide all content areas
  [listView, calView, catsView].forEach(el => { if (el) el.style.display = 'none'; });

  if (view === 'calendar') {
    if (calView) calView.style.display = '';
    if (kpiStrip) kpiStrip.style.display = 'none';
    if (mKpis) mKpis.style.display = 'none';
    renderScCalendar();
  } else if (view === 'categories') {
    if (catsView) catsView.style.display = '';
    if (kpiStrip) kpiStrip.style.display = 'none';
    if (mKpis) mKpis.style.display = 'none';
    renderScCategories();
  } else {
    if (listView) listView.style.display = '';
    if (kpiStrip) kpiStrip.style.display = '';
    if (mKpis) mKpis.style.display = '';
    _renderScKpis();
    filterScheduled();
    renderUpcoming();
  }
}

function scMobileToggleFilter() {
  const panel = document.getElementById('scMobileFilters');
  const btn   = document.getElementById('scMobileFilterBtn');
  if (!panel) return;
  const open = panel.style.display === 'block' || (panel.style.display !== 'none' && panel.style.display !== '');
  panel.style.display = open ? 'none' : 'block';
  if (btn) btn.classList.toggle('active', !open);
  if (!open) {
    // focus search input when opening
    setTimeout(() => { const s = document.getElementById('scSearch'); if (s) s.focus(); }, 50);
  }
}
window.scMobileToggleFilter = scMobileToggleFilter;

// ── Navigation ────────────────────────────────────────────────────
function scCalMove(delta) {
  _scCalMonth += delta;
  if (_scCalMonth > 11) { _scCalMonth = 0;  _scCalYear++; }
  if (_scCalMonth < 0)  { _scCalMonth = 11; _scCalYear--; }
  _scCalSelDay = null;
  renderScCalendar();
}

function scCalGoToday() {
  const now = new Date();
  _scCalYear  = now.getFullYear();
  _scCalMonth = now.getMonth();
  _scCalSelDay = localDateStr(now); // select today
  renderScCalendar();
}

// ── Build day map: date → { expenses, transfers, incomes, totExp, totInc } ──
function _scCalBuildDayMap(year, month) {
  const map = {};     // key = 'YYYY-MM-DD'
  const today = localDateStr();

  // Look 3 months ahead from start of displayed month
  const scanFrom = `${String(year).padStart(4,'0')}-${String(month+1).padStart(2,'0')}-01`;
  const scanTo   = localDateStr(new Date(year, month + 3, 0));

  // Use filtered list so type filter applies to calendar view too
  const _calSrc = state._scFiltered || state.scheduled;
  _calSrc.forEach(sc => {
    if (sc.status === 'finished') return;
    // Generate enough occurrences to cover the visible month + overflow
    const occDates = generateOccurrences(sc, 200);
    const registered = new Set((sc.occurrences||[]).map(o => o.scheduled_date));

    occDates.forEach(dateStr => {
      if (dateStr < scanFrom || dateStr > scanTo) return;
      // Don't double-count already-registered occurrences as "upcoming"
      // but DO show them with a ✓ indicator
      const isRegistered = registered.has(dateStr);

      if (!map[dateStr]) {
        map[dateStr] = {
          items: [], totDebit: 0, totCredit: 0,
        };
      }

      const isTransfer = sc.type === 'transfer' || sc.type === 'card_payment';
      const isIncome   = sc.type === 'income';
      const isExpense  = !isIncome && !isTransfer;

      // Resolve amount (may have currency — use brl_amount if available)
      const amt = Math.abs(parseFloat(sc.amount) || 0);

      if (isIncome) {
        map[dateStr].totCredit += amt;
      } else if (isExpense) {
        map[dateStr].totDebit  += amt;
      }
      // transfers don't add to debit/credit — they're neutral for net

      map[dateStr].items.push({
        sc,
        dateStr,
        isRegistered,
        isTransfer,
        isIncome,
        isExpense,
        amt,
        dotClass: isTransfer ? 'sc-cal-day-dot-transfer'
                : isIncome   ? 'sc-cal-day-dot-income'
                             : 'sc-cal-day-dot-expense',
      });
    });
  });

  return map;
}

// ── Main render ───────────────────────────────────────────────────
function renderScCalendar() {
  const labelEl = document.getElementById('scCalMonthLabel');
  if (labelEl) labelEl.textContent = `${SC_MONTHS[_scCalMonth]} ${_scCalYear}`;

  const grid = document.getElementById('scCalGrid');
  if (!grid) return;

  const today    = localDateStr();
  const dayMap   = _scCalBuildDayMap(_scCalYear, _scCalMonth);

  // First day of the month (0=Sun)
  const firstDay = new Date(_scCalYear, _scCalMonth, 1).getDay();
  // Last day of the month
  const lastDay  = new Date(_scCalYear, _scCalMonth + 1, 0).getDate();
  // Last day of previous month
  const prevLast = new Date(_scCalYear, _scCalMonth, 0).getDate();

  const cells = [];

  // Leading cells from previous month
  for (let i = 0; i < firstDay; i++) {
    const d = prevLast - firstDay + 1 + i;
    const m = _scCalMonth === 0 ? 12 : _scCalMonth;
    const y = _scCalMonth === 0 ? _scCalYear - 1 : _scCalYear;
    cells.push({ day: d, inMonth: false, dateStr: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` });
  }
  // Current month
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${_scCalYear}-${String(_scCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, inMonth: true, dateStr });
  }
  // Trailing cells for next month
  const totalCells = cells.length > 35 ? 42 : 35;
  let trailing = 1;
  while (cells.length < totalCells) {
    const m = _scCalMonth === 11 ? 1 : _scCalMonth + 2;
    const y = _scCalMonth === 11 ? _scCalYear + 1 : _scCalYear;
    cells.push({ day: trailing, inMonth: false, dateStr: `${y}-${String(m).padStart(2,'0')}-${String(trailing).padStart(2,'0')}` });
    trailing++;
  }

  grid.innerHTML = cells.map(({ day, inMonth, dateStr }) => {
    const data     = dayMap[dateStr];
    const isToday  = dateStr === today;
    const isSel    = dateStr === _scCalSelDay;
    const hasEvts  = !!(data?.items?.length);

    // CSS classes
    const cls = [
      'sc-cal-day',
      !inMonth   ? 'sc-cal-day--other-month' : '',
      isToday    ? 'sc-cal-day--today'       : '',
      hasEvts    ? 'sc-cal-day--has-events'  : '',
      isSel      ? 'sc-cal-day--selected'    : '',   // selected regardless of events
    ].filter(Boolean).join(' ');

    // Day number
    const dayNumHtml = `<div class="sc-cal-day-num">${day}</div>`;

    if (!hasEvts) {
      // Empty days: clicking selects/deselects and shows "no events" message
      const emptyOnclick = isSel
        ? `onclick="scCalSelectDay('${dateStr}')"` // deselect on second click
        : `onclick="scCalShowEmpty('${dateStr}')"`;
      return `<div class="${cls}" ${emptyOnclick} style="cursor:pointer">${dayNumHtml}</div>`;
    }

    // Dot row — max 5 dots, then "…"
    const items = data.items;
    const maxDots = 5;
    const dots = items.slice(0, maxDots).map(it =>
      `<span class="sc-cal-day-dot ${it.dotClass}"></span>`
    ).join('') + (items.length > maxDots ? `<span style="font-size:.55rem;color:var(--muted);align-self:center">+${items.length-maxDots}</span>` : '');
    const dotsHtml = `<div class="sc-cal-dots">${dots}</div>`;

    // Daily totals
    const totD = data.totDebit;
    const totC = data.totCredit;
    const bal  = totC - totD;
    const totHtml = `<div class="sc-cal-day-totals">
      ${totD > 0 ? `<div class="sc-cal-day-total-row debit">−${_scCalFmt(totD)}</div>` : ''}
      ${totC > 0 ? `<div class="sc-cal-day-total-row credit">+${_scCalFmt(totC)}</div>` : ''}
      ${(totD>0||totC>0) ? `<div class="sc-cal-day-total-row bal">${bal>=0?'+':''}${_scCalFmt(bal)}</div>` : ''}
    </div>`;

    const onclick = hasEvts ? `onclick="scCalSelectDay('${dateStr}')"` : `onclick="scCalShowEmpty('${dateStr}')"` ;
    return `<div class="${cls}" ${onclick}>${dayNumHtml}${dotsHtml}${totHtml}</div>`;
  }).join('');

  // Sync right-column panels (desktop calendar view)
  _renderCalUpcoming();
  _renderCalScheduledList();

  // Re-render detail if a day is selected
  if (_scCalSelDay && dayMap[_scCalSelDay]) {
    // Selected day has events — show detail (desktop always visible, mobile needs .visible)
    const _det = document.getElementById('scCalDetail');
    if (_det) { _det.classList.add('visible'); _det.style.removeProperty('display'); }
    _scCalRenderDetail(_scCalSelDay, dayMap[_scCalSelDay]);
  } else if (_scCalSelDay) {
    // Selected day exists but has no events — show empty message
    const det = document.getElementById('scCalDetail');
    if (det) {
      const [y, m, d] = _scCalSelDay.split('-');
      const label = `${parseInt(d)} de ${SC_MONTHS[parseInt(m)-1]} de ${y}`;
      const isToday = _scCalSelDay === localDateStr();
      det.style.display = '';
      det.classList.add('visible'); // mobile
      det.innerHTML = `<div style="padding:24px 18px;text-align:center">
        <div style="font-size:2rem;margin-bottom:10px;opacity:.45">${isToday ? '☀️' : '📅'}</div>
        <div style="font-size:.88rem;font-weight:700;color:var(--text2);margin-bottom:6px">${isToday ? 'Hoje — ' : ''}${label}</div>
        <div style="font-size:.78rem;color:var(--muted)">Nenhum evento programado neste dia.</div>
      </div>`;
    }
  } else {
    const det = document.getElementById('scCalDetail');
    if (det) {
      det.classList.remove('visible');
      // Desktop: show placeholder; Mobile: hide
      det.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:10px;opacity:.3">📅</div>
        <div style="font-size:.85rem;font-weight:600;color:var(--text2);margin-bottom:4px">Selecione um dia</div>
        <div style="font-size:.76rem">Clique em qualquer dia do calendário para ver os eventos.</div>
      </div>`;
    }
  }
}

// ── Compact money format for cells (no R$ symbol on mobile) ──────
function _scCalFmt(v) {
  if (typeof fmt === 'function') {
    // Use compact format for small cells
    const abs = Math.abs(v);
    if (abs >= 1000) return 'R$' + (abs/1000).toFixed(1).replace('.',',') + 'k';
    return 'R$' + abs.toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0});
  }
  return String(Math.round(v));
}

// ── Day click → detail panel ──────────────────────────────────────
function scCalSelectDay(dateStr) {
  _scCalSelDay = (_scCalSelDay === dateStr) ? null : dateStr;
  renderScCalendar();
}

function scCalShowEmpty(dateStr) {
  // Set selection state and re-render — renderScCalendar handles the empty message
  _scCalSelDay = (_scCalSelDay === dateStr) ? null : dateStr;
  renderScCalendar();
}

function _scCalRenderDetail(dateStr, data) {
  const det = document.getElementById('scCalDetail');
  if (!det) return;

  const [y, m, d] = dateStr.split('-');
  const dateLabel = `${parseInt(d)} de ${SC_MONTHS[parseInt(m)-1]} de ${y}`;
  const today     = localDateStr();
  const isPast    = dateStr < today;
  const isToday   = dateStr === today;

  const totD = data.totDebit;
  const totC = data.totCredit;
  const bal  = totC - totD;

  const summaryHtml = `
    <div class="sc-cal-detail-summary">
      ${totD > 0 ? `<span>💸 Débito: <span class="debit">−${typeof fmt==='function'?fmt(totD):totD.toFixed(2)}</span></span>` : ''}
      ${totC > 0 ? `<span>💰 Crédito: <span class="credit">+${typeof fmt==='function'?fmt(totC):totC.toFixed(2)}</span></span>` : ''}
      ${(totD>0||totC>0) ? `<span>= Saldo do dia: <span class="bal">${typeof fmt==='function'?fmt(bal):bal.toFixed(2)}</span></span>` : ''}
    </div>`;

  const itemsHtml = data.items.map(it => {
    const sc = it.sc;
    const typeIcon = it.isTransfer ? '🔄' : it.isIncome ? '💰' : '💸';
    const typeBg   = it.isTransfer ? 'var(--amber-lt)' : it.isIncome ? 'var(--green-lt)' : 'var(--red-lt)';
    const amtClass = it.isTransfer ? 'transfer' : it.isIncome ? 'credit' : 'debit';
    const amtPrefix = it.isIncome ? '+' : it.isTransfer ? '⇄' : '−';
    const amtStr = typeof fmt==='function' ? fmt(it.amt) : it.amt.toFixed(2);
    const freq  = typeof scFreqLabel==='function' ? scFreqLabel(sc) : '';
    const acct  = (state.accounts||[]).find(a=>a.id===sc.account_id);
    const meta  = [freq, acct?.name, sc.payees?.name, sc.categories?.name].filter(Boolean).join(' · ');
    const regBadge = it.isRegistered
      ? '<span style="font-size:.65rem;color:var(--green);font-weight:700;margin-left:4px">✓ Registrada</span>'
      : (isPast && !isToday ? '<span style="font-size:.65rem;color:var(--amber);font-weight:700;margin-left:4px">⚠ Pendente</span>' : '');

    const actionBtn = !it.isRegistered
      ? `<button class="btn btn-ghost btn-sm"
           data-scid="${sc.id}" data-date="${it.dateStr}"
           onclick="event.stopPropagation();openRegisterOcc(this.dataset.scid,this.dataset.date)"
           style="font-size:.75rem;padding:5px 12px;white-space:nowrap;background:var(--accent);color:#fff;border-color:var(--accent)">
           ✓ Registrar
         </button>`
      : `<span style="font-size:.7rem;color:var(--green);font-weight:700;padding:4px 8px;background:var(--green-lt);border-radius:6px">✓ Registrada</span>`;

    return `
      <div class="sc-cal-detail-item">
        <div class="sc-cal-detail-type-icon" style="background:${typeBg}">${typeIcon}</div>
        <div class="sc-cal-detail-mid">
          <div class="sc-cal-detail-desc">${esc(sc.description||'—')}${regBadge}</div>
          <div class="sc-cal-detail-meta">${esc(meta)}</div>
        </div>
        <div class="sc-cal-detail-amt ${amtClass}">${amtPrefix}${amtStr}</div>
        <div class="sc-cal-detail-action">${actionBtn}</div>
      </div>`;
  }).join('');

  det.style.display = '';
  det.classList.add('visible'); // mobile: override display:none !important
  det.innerHTML = `
    <div class="sc-cal-detail-header">
      <div class="sc-cal-detail-date">${dateLabel}${isToday?' <span style="font-size:.75rem;color:var(--accent);font-weight:700">— Hoje</span>':''}</div>
      <div style="flex:1"></div>
      ${summaryHtml}
      <button onclick="scCalSelectDay('${dateStr}')" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:1rem;padding:0 0 0 8px">✕</button>
    </div>
    ${itemsHtml}`;
}

// ── Currency helpers ────────────────────────────────────────────────────────
function _getScSelectedCurrency() {
  const sel = document.getElementById('scCurrencySelect');
  return sel?.value || 'BRL';
}

function _rebuildScCurrencySelect(accountCur, selectedCur) {
  const sel = document.getElementById('scCurrencySelect');
  if (!sel) return;
  const CURRENCIES = ['BRL','USD','EUR','GBP','AED','ARS','CAD','CHF','JPY','MXN','CLP','COP','PEN','UYU'];
  const list = [...new Set([accountCur || 'BRL', ...CURRENCIES])];
  const targetCur = selectedCur || accountCur || 'BRL';
  sel.innerHTML = list.map(c =>
    `<option value="${c}"${c === targetCur ? ' selected' : ''}>${c}</option>`
  ).join('');
}

function onScCurrencyChange() {
  _updateScCurrencyPanel();
}

function onScAccountChange() {
  const accId = document.getElementById('scAccountId')?.value;
  const acc   = (state.accounts||[]).find(a => a.id === accId);
  const accountCur = acc?.currency || 'BRL';
  // Keep user-chosen currency if already set; default to account currency
  const currentSel = _getScSelectedCurrency();
  _rebuildScCurrencySelect(accountCur, currentSel || accountCur);
  _updateScCurrencyPanel();
  if (typeof onScTransferAccountChange === 'function') onScTransferAccountChange();
}

function setScCurrencyMode(mode) {
  const panel    = document.getElementById('scCurrencyPanel');
  const fixedBtn = document.getElementById('scCurrModeFixed');
  const apiBtn   = document.getElementById('scCurrModeApi');
  const fixedPan = document.getElementById('scCurrFixedPanel');
  const apiPan   = document.getElementById('scCurrApiPanel');
  if (fixedBtn) {
    fixedBtn.style.background  = mode === 'fixed' ? 'var(--accent)' : 'transparent';
    fixedBtn.style.color       = mode === 'fixed' ? '#fff' : 'var(--text2)';
    fixedBtn.style.borderColor = mode === 'fixed' ? 'var(--accent)' : 'var(--border)';
  }
  if (apiBtn) {
    apiBtn.style.background  = mode === 'api' ? 'var(--accent)' : 'transparent';
    apiBtn.style.color       = mode === 'api' ? '#fff' : 'var(--text2)';
    apiBtn.style.borderColor = mode === 'api' ? 'var(--accent)' : 'var(--border)';
  }
  if (fixedPan) fixedPan.style.display = mode === 'fixed' ? '' : 'none';
  if (apiPan)   apiPan.style.display   = mode === 'api'   ? '' : 'none';
  if (panel)    panel.setAttribute('data-curr-mode', mode);
}

function _updateScCurrencyPanel() {
  const accId      = document.getElementById('scAccountId')?.value;
  const acc        = (state.accounts||[]).find(a => a.id === accId);
  const accountCur = acc?.currency || 'BRL';
  const txCur      = _getScSelectedCurrency();
  const tv         = document.getElementById('scTypeField')?.value || '';

  // Panel shows whenever tx currency ≠ BRL OR account is non-BRL
  // (always hidden for transfers — they use scFxPanel instead)
  const needsConversion = tv !== 'transfer' && tv !== 'card_payment' &&
    (txCur !== 'BRL' || accountCur !== 'BRL');

  const panel = document.getElementById('scCurrencyPanel');
  if (!panel) return;
  if (!needsConversion) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Determine display labels: what we're converting from and to
  // If txCur ≠ accountCur: show txCur → accountCur (e.g. USD → BRL)
  // If txCur === accountCur (both non-BRL): show accountCur → BRL
  const dispFrom = txCur !== accountCur ? txCur : accountCur;
  const dispTo   = txCur !== accountCur ? accountCur : 'BRL';

  const fl = document.getElementById('scCurrencyRateFromLabel');
  const tl = document.getElementById('scCurrencyPanelTitle');
  if (fl) fl.textContent = dispFrom;
  if (tl) tl.textContent = `Conversão: ${dispFrom} → ${dispTo}`;

  // Default to fixed mode if not yet set
  const currMode = panel.getAttribute('data-curr-mode') || 'fixed';
  setScCurrencyMode(currMode);

  updateScCurrencyPreview();
  // Auto-fetch rate for the current currency pair
  fetchScCurrencyRate();
}

function updateScCurrencyPreview() {
  const txCur  = _getScSelectedCurrency();
  const accId  = document.getElementById('scAccountId')?.value;
  const acc    = (state.accounts||[]).find(a => a.id === accId);
  const accCur = acc?.currency || 'BRL';
  const dispFrom = txCur !== accCur ? txCur : accCur;
  const rate   = parseFloat(document.getElementById('scCurrencyRate')?.value?.replace(',','.')) || 0;
  const amt    = Math.abs(getAmtField('scAmount') || 0);
  const prev   = document.getElementById('scCurrencyPreview');
  const hint   = document.getElementById('scCurrencyBrlHint');
  if (!prev) return;
  if (rate && amt) {
    const converted = amt * rate;
    const toCur = txCur !== accCur ? accCur : 'BRL';
    prev.textContent = `≈ ${fmt(converted, toCur)} (1 ${dispFrom} = ${rate.toFixed(4)} ${toCur})`;
    if (hint) hint.textContent = fmt(converted, toCur);
  } else {
    prev.textContent = '';
    if (hint) hint.textContent = '—';
  }
}

async function fetchScCurrencyRate() {
  const txCur  = _getScSelectedCurrency();
  const accId  = document.getElementById('scAccountId')?.value;
  const acc    = (state.accounts||[]).find(a => a.id === accId);
  const accCur = acc?.currency || 'BRL';
  const fromCur = txCur !== accCur ? txCur : accCur;
  const toCur   = txCur !== accCur ? accCur : 'BRL';
  if (fromCur === toCur) return;
  const btn = document.getElementById('scCurrencyFetchBtn');
  const ico = document.getElementById('scCurrencyFetchIcon');
  if (btn) btn.disabled = true;
  if (ico) ico.textContent = '⏳';
  try {
    const rate = typeof getFxRate === 'function' ? getFxRate(fromCur) : 0;
    if (rate && rate !== 1) {
      const inp = document.getElementById('scCurrencyRate');
      if (inp) { inp.value = rate.toFixed(6); updateScCurrencyPreview(); }
      const sg = document.getElementById('scCurrencySuggestion');
      if (sg) { sg.style.display = ''; sg.textContent = `1 ${fromCur} = ${rate.toFixed(4)} ${toCur}`; }
    } else {
      toast('Cotação não disponível. Insira manualmente.', 'warning');
    }
  } catch(e) { toast('Erro: ' + e.message, 'error'); }
  finally {
    if (btn) btn.disabled = false;
    if (ico) ico.textContent = '🔄';
  }
}

function duplicateScheduled(id) {
  const sc = state.scheduled.find(s => s.id === id);
  if (!sc) { toast('Programação não encontrada', 'error'); return; }
  // Open modal pre-filled as a NEW record (no id) — user edits then saves
  openScheduledModal('');
  // Overwrite fields with original values after modal opens
  requestAnimationFrame(() => {
    document.getElementById('scDesc').value = (sc.description || '') + ' (cópia)';
    setAmtField('scAmount', sc.amount || 0);
    document.getElementById('scMemo').value = sc.memo || '';
    document.getElementById('scTags').value = (sc.tags || []).join(', ');
    const aEl = document.getElementById('scAccountId');
    if (aEl && sc.account_id) aEl.value = sc.account_id;
    const trEl = document.getElementById('scTransferToAccountId');
    if (trEl && sc.transfer_to_account_id) trEl.value = sc.transfer_to_account_id;
    setCatPickerValue(sc.category_id || null, 'sc');
    setPayeeField(sc.payee_id || null, 'sc');
    setScType(sc.type || 'expense');
    const freq = sc.frequency || 'once';
    document.querySelectorAll('input[name=scFreq]').forEach(r => r.checked = r.value === freq);
    document.getElementById('scCustomIntervalGroup').style.display = freq === 'custom' ? '' : 'none';
    document.getElementById('scEndGroup').style.display = freq === 'once' ? 'none' : '';
    document.getElementById('scCustomInterval').value = sc.custom_interval || 1;
    document.getElementById('scCustomUnit').value = sc.custom_unit || 'months';
    document.getElementById('scStatus').value = 'active';
    document.getElementById('scheduledModalTitle').textContent = 'Nova Programação (cópia)';
    updateScPreview();
  });
}


// ══════════════════════════════════════════════════════════════════════════
//  SCHEDULED CATEGORIES CHART  (scCats*)
// ══════════════════════════════════════════════════════════════════════════

let _scCatsFilter = 'all'; // 'all' | 'expense' | 'income'

function scCatsFilter(type) {
  _scCatsFilter = type;
  ['all','expense','income'].forEach(t => {
    const id = 'scCatsBtn' + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(id)?.classList.toggle('active', t === type);
  });
  renderScCategories();
}
window.scCatsFilter = scCatsFilter;

function renderScCategories() {
  const sched = state.scheduled || [];
  if (!sched.length) {
    _scCatsSetEmpty('Nenhum programado cadastrado.');
    return;
  }

  // Filter by type
  const filtered = sched.filter(s => {
    if (s.status === 'finished') return false;
    if (_scCatsFilter === 'expense') return s.type === 'expense';
    if (_scCatsFilter === 'income')  return s.type === 'income';
    return s.type === 'expense' || s.type === 'income';
  });

  if (!filtered.length) {
    _scCatsSetEmpty('Nenhum programado para o filtro selecionado.');
    return;
  }

  // Aggregate by category
  const catMap  = Object.fromEntries((state.categories||[]).map(c => [c.id, c]));
  const bycat   = {};

  filtered.forEach(s => {
    const cat = catMap[s.category_id];
    const key = cat?.name || 'Sem categoria';
    const color = cat?.color || '#94a3b8';
    const amt = Math.abs(parseFloat(s.brl_amount || s.amount || 0));
    if (!bycat[key]) bycat[key] = { total: 0, color, count: 0, items: [] };
    bycat[key].total += amt;
    bycat[key].count++;
    bycat[key].items.push(s);
  });

  const entries = Object.entries(bycat)
    .sort((a,b) => b[1].total - a[1].total);

  const totalAmt = entries.reduce((s,[,v]) => s + v.total, 0);

  // ── KPI strip ─────────────────────────────────────────────────────────
  const kpiEl = document.getElementById('scCatsKpis');
  if (kpiEl) {
    const totalCount = filtered.length;
    const catCount   = entries.length;
    kpiEl.innerHTML = `
      <div class="sc-cats-kpi">
        <span class="sc-cats-kpi-lbl">Total mensal est.</span>
        <span class="sc-cats-kpi-val">${fmt(totalAmt)}</span>
      </div>
      <div class="sc-cats-kpi">
        <span class="sc-cats-kpi-lbl">Programados</span>
        <span class="sc-cats-kpi-val">${totalCount}</span>
      </div>
      <div class="sc-cats-kpi">
        <span class="sc-cats-kpi-lbl">Categorias</span>
        <span class="sc-cats-kpi-val">${catCount}</span>
      </div>`;
  }

  // ── Title ─────────────────────────────────────────────────────────────
  const titleEl = document.getElementById('scCatsChartTitle');
  if (titleEl) {
    const typeLabel = { all:'Todos os Programados', expense:'Despesas', income:'Receitas' }[_scCatsFilter];
    titleEl.textContent = `Distribuição por Categoria — ${typeLabel}`;
  }

  // ── Bar chart ─────────────────────────────────────────────────────────
  const canvas = document.getElementById('scCatsChart');
  if (!canvas) return;

  // Destroy existing
  if (state.chartInstances?.['scCatsChart']) {
    try { state.chartInstances['scCatsChart'].destroy(); } catch(_) {}
    delete state.chartInstances['scCatsChart'];
  }

  const top = entries.slice(0, 15);
  const labels = top.map(([k]) => k);
  const vals   = top.map(([,v]) => +v.total.toFixed(2));
  const colors = top.map(([,v]) => v.color || '#94a3b8');

  if (typeof Chart === 'undefined' || typeof renderChart !== 'function') {
    canvas.style.display = 'none';
  } else {
    canvas.style.display = '';
    const chart = renderChart('scCatsChart', 'bar', labels,
      [{ data: vals, backgroundColor: colors, borderRadius: 6, borderSkipped: false }],
      {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { callback: v => fmt(v), font: { size: 11 } } },
          y: { ticks: { font: { size: 11 } } },
        },
      }
    );
    if (chart) state.chartInstances['scCatsChart'] = chart;
  }

  // ── Category detail cards ──────────────────────────────────────────────
  const listEl = document.getElementById('scCatsList');
  if (!listEl) return;

  listEl.innerHTML = entries.map(([catName, v]) => {
    const pct = totalAmt > 0 ? (v.total / totalAmt * 100).toFixed(1) : '0.0';
    const itemRows = v.items.slice(0, 4).map(s => `
      <div class="sc-cats-item-row" onclick="openScheduledDetail('${s.id}')">
        <span class="sc-cats-item-desc">${esc(s.description || '—')}</span>
        <span class="sc-cats-item-amt">${fmt(Math.abs(parseFloat(s.brl_amount||s.amount||0)))}</span>
      </div>`).join('');
    const more = v.items.length > 4 ? `<div class="sc-cats-item-more">+${v.items.length-4} mais</div>` : '';

    return `
    <div class="card mb-3 sc-cats-card">
      <div class="sc-cats-card-header">
        <div class="sc-cats-dot" style="background:${v.color}"></div>
        <div class="sc-cats-card-info">
          <span class="sc-cats-card-name">${esc(catName)}</span>
          <span class="sc-cats-card-count">${v.count} programado${v.count!==1?'s':''}</span>
        </div>
        <div class="sc-cats-card-right">
          <span class="sc-cats-card-total">${fmt(v.total)}</span>
          <span class="sc-cats-card-pct">${pct}%</span>
        </div>
      </div>
      <div class="sc-cats-bar-track">
        <div class="sc-cats-bar-fill" style="width:${pct}%;background:${v.color}"></div>
      </div>
      ${itemRows}${more}
    </div>`;
  }).join('');
}
window.renderScCategories = renderScCategories;

function _scCatsSetEmpty(msg) {
  const kpiEl  = document.getElementById('scCatsKpis');
  const listEl = document.getElementById('scCatsList');
  if (kpiEl)  kpiEl.innerHTML = '';
  if (listEl) listEl.innerHTML = `<div class="empty-state"><div class="es-icon">🏷️</div><p>${msg}</p></div>`;
  const canvas = document.getElementById('scCatsChart');
  if (canvas) canvas.style.display = 'none';
}


// === PERIODICITY COLORS ===
function getPeriodColor(period) {
  switch((period||'').toLowerCase()) {
    case 'daily': return '#2ecc71';
    case 'weekly': return '#3498db';
    case 'monthly': return '#f39c12';
    case 'yearly': return '#9b59b6';
    default: return '#1F6B4F';
  }
}

// ── Desktop upcoming panel: collapse/expand ───────────────────────────────
let _upcomingDesktopOpen = false;
window.toggleUpcomingDesktopPanel = function() {
  _upcomingDesktopOpen = !_upcomingDesktopOpen;
  const body  = document.getElementById('scheduledUpcomingList');
  const arrow = document.getElementById('upcomingDesktopArrow');
  if (body) {
    // Use setProperty with important to override mobile CSS !important rules
    if (_upcomingDesktopOpen) {
      body.style.removeProperty('display');
      body.style.setProperty('display', 'block', 'important');
    } else {
      body.style.setProperty('display', 'none', 'important');
    }
  }
  if (arrow) arrow.style.transform = _upcomingDesktopOpen ? 'rotate(180deg)' : 'rotate(0)';
};

// Opens upcoming panel if it has items (called after renderUpcoming)
function _autoOpenUpcomingIfItems() {
  const body = document.getElementById('scheduledUpcomingList');
  if (body && body.children.length > 0 && !_upcomingDesktopOpen) {
    // Already has items from renderUpcoming — keep collapsed per spec
    // User explicitly clicks to open
  }
}

// ── Show all recurrents — scroll to recurrents panel and clear filter ────
window.scShowAllRecurrents = function() {
  // Clear filters to show all
  const chipAll  = document.getElementById('scChipAll');
  const typeFilter = document.getElementById('scTypeFilter');
  const search   = document.getElementById('scSearch');
  if (chipAll)    chipAll.click();
  if (typeFilter) typeFilter.value = '';
  if (search)     search.value = '';
  if (typeof filterScheduled === 'function') filterScheduled();
  // Scroll to recurrents panel
  const panel = document.getElementById('scRecurrentsPanel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Called from app.js after loadScheduled to open upcoming panel if it has events
function _openUpcomingIfHasEvents() {
  const body  = document.getElementById('scheduledUpcomingList');
  const arrow = document.getElementById('upcomingDesktopArrow');
  if (body && body.children.length > 0) {
    body.style.setProperty('display', 'block', 'important');
    _upcomingDesktopOpen = true;
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR VIEW — Right column panels (Upcoming + Recorrentes)
// ══════════════════════════════════════════════════════════════════════════════

let _calUpcomingOpen = true;
let _calScStatusChip = 'all';

window.toggleCalUpcomingPanel = function() {
  _calUpcomingOpen = !_calUpcomingOpen;
  const body  = document.getElementById('scCalUpcomingList');
  const arrow = document.getElementById('scCalUpcomingArrow');
  if (body) {
    if (_calUpcomingOpen) {
      body.style.setProperty('display', 'block', 'important');
    } else {
      body.style.setProperty('display', 'none', 'important');
    }
  }
  if (arrow) arrow.style.transform = _calUpcomingOpen ? 'rotate(180deg)' : 'rotate(0)';
};

function _renderCalUpcoming() {
  const listEl   = document.getElementById('scCalUpcomingList');
  const totalEl  = document.getElementById('scCalUpcomingTotal');
  const countEl  = document.getElementById('scCalUpcomingCount');
  const arrowEl  = document.getElementById('scCalUpcomingArrow');
  if (!listEl) return;

  const today    = localDateStr();
  const limit    = new Date(); limit.setDate(limit.getDate() + 10);
  const limitStr = localDateStr(limit);

  const upcoming = [];
  const srcList  = state._scFiltered || state.scheduled;
  srcList.forEach(sc => {
    if (sc.status === 'paused' || sc.status === 'finished') return;
    const pendingSet = new Set(
      (sc.occurrences || [])
        .filter(o => (o.execution_status === 'pending' || o.execution_status === 'skipped') && o.scheduled_date >= today && o.scheduled_date <= limitStr)
        .map(o => o.scheduled_date)
    );
    const executedSet = new Set(
      (sc.occurrences || []).filter(o => o.execution_status === 'executed' || o.execution_status === 'processing').map(o => o.scheduled_date)
    );
    const occs = generateOccurrences(sc, 30);
    occs.forEach(date => {
      if (date >= today && date <= limitStr && !executedSet.has(date))
        upcoming.push({ sc, date, isPending: pendingSet.has(date) });
    });
    pendingSet.forEach(date => {
      if (!occs.includes(date)) upcoming.push({ sc, date, isPending: true });
    });
  });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  if (countEl) countEl.textContent = upcoming.length + ' item' + (upcoming.length !== 1 ? 's' : '');
  if (totalEl) {
    const tot = upcoming.reduce((s, { sc }) => {
      const isExp = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
      return s + (isExp ? -1 : 1) * Math.abs(sc.amount);
    }, 0);
    totalEl.textContent = (tot >= 0 ? '+' : '') + (typeof fmt === 'function' ? fmt(tot) : tot.toFixed(2));
    totalEl.className   = 'badge ' + (tot >= 0 ? 'badge-green' : 'badge-red');
  }

  if (!upcoming.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:.8rem">Nenhum evento nos próximos 10 dias.</div>';
    return;
  }

  const today2   = localDateStr();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomStr   = localDateStr(tomorrow);
  const byDate   = {};
  upcoming.forEach(u => { (byDate[u.date] = byDate[u.date] || []).push(u); });
  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  listEl.innerHTML = Object.entries(byDate).map(([date, items]) => {
    const isToday    = date === today2;
    const isTomorrow = date === tomStr;
    const dayDiff    = (new Date(date + 'T12:00:00') - new Date(today2 + 'T12:00:00')) / 86400000;
    const dow        = DOW[new Date(date + 'T12:00:00').getDay()];
    const dayNum     = new Date(date + 'T12:00:00').getDate();
    const dayMon     = new Date(date + 'T12:00:00').toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
    const gid        = 'calupg_' + date.replace(/-/g, '');
    const autoOpen   = dayDiff <= 1; // today + tomorrow open by default

    const dayPill = isToday
      ? `<div class="sup-day-pill sup-day-pill--today"><span>Hoje</span></div>`
      : isTomorrow
      ? `<div class="sup-day-pill sup-day-pill--tmrw"><span>Amanhã</span></div>`
      : `<div class="sup-day-pill"><span class="sup-day-num">${dayNum}</span><span class="sup-day-mon">${dayMon}</span></div>`;

    const dayTot = items.reduce((s, { sc }) => {
      const isExp = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
      return s + (isExp ? -1 : 1) * Math.abs(sc.amount);
    }, 0);

    const rows = items.map(({ sc, isPending }) => {
      const isExp    = sc.type === 'expense' || sc.type === 'card_payment' || sc.type === 'transfer';
      const isIncome = sc.type === 'income';
      const typeIcon = sc.type === 'transfer' ? '🔄' : isExp ? '💸' : '💰';
      const amtStr   = typeof fmt === 'function' ? fmt(Math.abs(sc.amount)) : Math.abs(sc.amount).toFixed(2);
      const pendingBadge = isPending
        ? `<span class="sc-occ-pending-dot" title="Pendente"></span>` : '';
      return `<div class="sup-item${isToday ? ' sup-item--today' : ''}">
        <span class="sup-type-icon">${typeIcon}</span>
        <div class="sup-item-mid">
          <div class="sup-item-desc">${esc(sc.description || '—')}${pendingBadge}</div>
          <div class="sup-item-meta">${esc((state.accounts || []).find(a => a.id === sc.account_id)?.name || '')}</div>
        </div>
        <span class="sup-item-amt ${isExp ? 'neg' : 'pos'}">${isExp ? '−' : '+'}${amtStr}</span>
        <button class="sup-register-btn" onclick="openRegisterOcc('${sc.id}','${date}')">✓</button>
      </div>`;
    }).join('');

    return `<div class="sup-group">
      <div class="sup-group-hdr" onclick="toggleUpcomingGroup('${gid}')">
        <div class="sup-group-left">${dayPill}<span class="sup-group-dow">${dow}</span></div>
        <div class="sup-group-meta">
          <span class="sup-day-total ${dayTot >= 0 ? 'pos' : 'neg'}">${dayTot >= 0 ? '+' : ''}${typeof fmt === 'function' ? fmt(dayTot) : dayTot.toFixed(2)}</span>
          <span class="sup-day-count">${items.length}</span>
          <svg class="sc-upcoming-day-arrow" id="${gid}_arr" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="sup-rows" id="${gid}" style="display:none">${rows}</div>
    </div>`;
  }).join('');

  // Open the upcoming panel
  listEl.style.setProperty('display', 'block', 'important');
  _calUpcomingOpen = true;
  if (arrowEl) arrowEl.style.transform = 'rotate(180deg)';
}

function filterScheduledCal() {
  const search = (document.getElementById('scCalSearch')?.value || '').toLowerCase();
  const typeF  = document.getElementById('scCalTypeFilter')?.value || '';
  let list = state.scheduled;
  if (search) list = list.filter(s => s.description?.toLowerCase().includes(search) || s.payees?.name?.toLowerCase().includes(search));
  if (typeF) list = list.filter(s => s.type === typeF);
  if (_calScStatusChip && _calScStatusChip !== 'all') {
    list = list.filter(s => {
      const st = typeof scStatusLabel === 'function' ? scStatusLabel(s) : { label: '' };
      if (_calScStatusChip === 'active')  return st.label.includes('Ativo') || st.label.includes('Atrasado');
      if (_calScStatusChip === 'paused')  return s.status === 'paused';
      return false;
    });
  }
  _renderCalList(list);
}
window.filterScheduledCal = filterScheduledCal;

window.scCalChipFilter = function(e, chip) {
  _calScStatusChip = chip;
  document.querySelectorAll('#scCalRecurrentsPanel .sc-chip').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  filterScheduledCal();
};

function _renderCalScheduledList() {
  filterScheduledCal();
}

function _renderCalList(list) {
  const el = document.getElementById('scCalScheduledList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:.8rem">Nenhuma transação recorrente.</div>';
    return;
  }
  // Reuse existing _scCardHtml if available
  if (typeof _scCardHtml === 'function') {
    const renderableActive   = list.filter(sc => { const st = typeof scStatusLabel === 'function' ? scStatusLabel(sc) : { label:'Ativo' }; return !st.label.includes('Concluído'); });
    const renderableFinished = list.filter(sc => { const st = typeof scStatusLabel === 'function' ? scStatusLabel(sc) : { label:'' }; return st.label.includes('Concluído'); });
    el.innerHTML = renderableActive.map(sc => _scCardHtml(sc)).join('');
    if (renderableFinished.length) {
      el.innerHTML += `<div style="font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:10px 14px 4px">Concluídos</div>`;
      el.innerHTML += renderableFinished.map(sc => _scCardHtml(sc)).join('');
    }
  } else {
    el.innerHTML = list.map(sc => `<div style="padding:10px 14px;border-bottom:1px solid var(--border);font-size:.84rem">${esc(sc.description||'—')}</div>`).join('');
  }
}

// ── Expor funções públicas no window ──────────────────────────────────────────
window._openUpcomingIfHasEvents            = _openUpcomingIfHasEvents;
window.confirmRegisterOccurrence           = confirmRegisterOccurrence;
window.fetchScCurrencyRate                 = fetchScCurrencyRate;
window.fetchScSuggestedFxRate              = fetchScSuggestedFxRate;
window.generateOccurrences                 = generateOccurrences;
window.ignoreOccurrence                    = ignoreOccurrence;

// ═══════════════════════════════════════════════════════════════════════════
// A/R — VALORES A RECEBER (Contas a receber pendentes)
// Guarda num store scoped por família em app_settings
// ═══════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// VALORES A RECEBER — Supabase-backed (scheduled_ar_records)
// ════════════════════════════════════════════════════════════════════════════

async function _scArFetch(statusFilter) {
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    if (!fid) return [];
    let q = sb.from('scheduled_ar_records')
      .select('*')
      .eq('family_id', fid)
      .order('date', { ascending: true });
    if (statusFilter && statusFilter.length === 1) {
      q = q.eq('status', statusFilter[0]);
    } else if (statusFilter && statusFilter.length > 1) {
      q = q.in('status', statusFilter);
    }
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    // Rebuild ar_pending keys for renderUpcoming cross-reference
    if (!statusFilter || statusFilter.includes('pending')) {
      state._arPendingKeys = new Set(
        rows.filter(r => r.status === 'pending' && r.sc_id && r.date)
            .map(r => r.sc_id + '|' + r.date)
      );
    }
    return rows;
  } catch (e) {
    console.warn('[scAr] fetch error:', e?.message);
    return [];
  }
}

async function registerAsNotReceived() {
  const scId   = document.getElementById('occScId')?.value;
  const date   = document.getElementById('occDate')?.value;
  const memo   = document.getElementById('occMemo')?.value?.trim() || '';

  if (!scId || !date) { toast('Preencha a data.', 'warning'); return; }

  const sc     = (state.scheduled || []).find(s => s.id === scId);
  const amount = Math.abs(getAmtField('occAmount') || parseFloat(sc?.amount) || 0);
  const desc   = sc?.description || 'Valor a receber';
  const fid    = typeof famId === 'function' ? famId() : null;
  if (!fid) { toast('Familia nao identificada.', 'error'); return; }

  // ── Duplicate detection ────────────────────────────────────────────────────
  try {
    const { data: existing } = await sb.from('scheduled_ar_records')
      .select('id,date,amount,description,status')
      .eq('family_id', fid)
      .eq('sc_id',     scId)
      .eq('status',   'pending');
    if (existing?.length) {
      // Already has a pending AR for this scheduled item
      const dup = existing[0];
      const dupDate = typeof fmtDate === 'function' ? fmtDate(dup.date) : dup.date;
      const sameDateDup = existing.find(r => r.date === date);
      if (sameDateDup) {
        // Exact duplicate: same scheduled item, same date
        toast(`⚠️ Já existe um registro de A Receber para esta data (${dupDate}). Verifique em A Receber.`, 'warning');
        return;
      }
      // Different date but same sc — warn but allow
      if (!confirm(`⚠️ Este programado já tem um registro pendente em A Receber (${dupDate}).

Deseja adicionar mais uma entrada para ${typeof fmtDate === 'function' ? fmtDate(date) : date}?`)) {
        return;
      }
    }
  } catch (_dupErr) {
    // Non-critical — proceed even if duplicate check fails
    console.warn('[scAr] Duplicate check failed:', _dupErr?.message);
  }

  try {
    // Tenta via RPC SECURITY DEFINER primeiro — bypassa edge cases de RLS
    let insertOk = false;
    try {
      const { error: rpcErr } = await sb.rpc('insert_scheduled_ar_record', {
        p_family_id:   fid,
        p_sc_id:       scId,
        p_description: desc,
        p_date:        date,
        p_amount:      amount,
        p_memo:        memo || null,
      });
      if (!rpcErr) insertOk = true;
      else console.warn('[scAr] RPC insert_scheduled_ar_record:', rpcErr.message);
    } catch(rpcEx) {
      console.warn('[scAr] RPC exception:', rpcEx?.message);
    }

    // Fallback: INSERT direto (funciona se RLS estiver configurada corretamente)
    if (!insertOk) {
      const { error } = await sb.from('scheduled_ar_records').insert({
        family_id:   fid,
        sc_id:       scId,
        description: desc,
        date,
        amount,
        memo:        memo || null,
        status:      'pending',
      });
      if (error) throw error;
    }

    // Mark occurrence as 'ar_pending' (stored as 'skipped' in DB — no schema change)
    // renderUpcoming detects ar_pending by cross-referencing state._arPendingKeys
    try {
      await sb.from('scheduled_occurrences')
        .upsert({
          sc_id:            scId,
          scheduled_date:   date,
          family_id:        fid,
          execution_status: 'skipped',
          updated_at:       new Date().toISOString(),
        }, { onConflict: 'sc_id,scheduled_date' });
      // Update local cache
      const scLocal = (state.scheduled || []).find(s => s.id === scId);
      if (scLocal) {
        if (!scLocal.occurrences) scLocal.occurrences = [];
        const existing = scLocal.occurrences.find(o => o.scheduled_date === date);
        if (existing) existing.execution_status = 'skipped';
        else scLocal.occurrences.push({ sc_id: scId, scheduled_date: date, execution_status: 'skipped', family_id: fid });
      }
      // Track ar_pending keys so renderUpcoming can show them as "awaiting" rows
      if (!state._arPendingKeys) state._arPendingKeys = new Set();
      state._arPendingKeys.add(scId + '|' + date);
    } catch(skipErr) {
      console.warn('[scAr] Could not mark occurrence as ar_pending:', skipErr?.message);
    }

    closeModal('registerOccModal');
    toast('📬 Adicionado em A Receber', 'success');
    _scArLoad();
    renderUpcoming();
    if (typeof loadDashboard === 'function' && typeof state !== 'undefined' && state.currentPage === 'dashboard') loadDashboard();
  } catch (e) {
    toast('Erro ao registrar: ' + (e.message || e), 'error');
  }
}

async function _scArLoad() {
  const section = document.getElementById('scArSection');
  const list    = document.getElementById('scArList');
  const cntEl   = document.getElementById('scArCount');
  if (!section || !list) return;

  // Only show on the scheduled page
  if (state.currentPage !== 'scheduled') {
    section.style.display = 'none';
    return;
  }

  const pending = await _scArFetch(['pending']);
  window._scArRecordsCache = pending;  // cache for renderUpcoming inline buttons

  section.style.display = pending.length ? '' : 'none';
  if (cntEl) cntEl.textContent = pending.length || '';
  if (!pending.length) { list.innerHTML = ''; return; }

  list.innerHTML = pending.map(r => {
    const dt  = r.date ? r.date.split('-').reverse().join('/') : '--';
    const amt = typeof fmt === 'function' ? fmt(r.amount || 0) : 'R$ ' + (+(r.amount || 0)).toFixed(2);
    return `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
      background:var(--surface);border:1px solid #fde68a;border-radius:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.83rem;font-weight:700;color:var(--text)">${esc(r.description)}</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.78rem;color:var(--muted)">${dt}</span>
          <span style="font-size:.83rem;font-weight:800;color:#d97706">${amt}</span>
          ${r.memo ? '<span style="font-size:.72rem;color:var(--muted);font-style:italic">'+esc(r.memo)+'</span>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="_scArReceive('${r.id}')"
          style="padding:5px 10px;background:#dcfce7;color:#15803d;border:1px solid #86efac;
            border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">
          Recebido
        </button>
        <button onclick="_scArCancel('${r.id}')"
          style="padding:5px 10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);
            border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit">
          X
        </button>
      </div>
    </div>`;
  }).join('');
}

async function _scArReceive(arId) {
  // Load ar_record details then open the receipt modal
  try {
    const { data: rec, error } = await sb.from('scheduled_ar_records')
      .select('*, scheduled_transactions(account_id,category_id,payee_id,currency,accounts!scheduled_transactions_account_id_fkey(name))')
      .eq('id', arId).maybeSingle();
    if (error || !rec) throw error || new Error('Registro não encontrado');

    const sc = rec.scheduled_transactions;
    // Open the unified receipt modal
    if (typeof _openReceiptModal === 'function') {
      _openReceiptModal({
        type:        'ar_record',
        id:          arId,
        description: rec.description || '—',
        amount:      rec.amount || 0,
        currency:    sc?.currency || 'BRL',
        date:        new Date().toISOString().slice(0,10),
        accountId:   sc?.account_id || '',
        categoryId:  sc?.category_id || null,
        payeeId:     sc?.payee_id    || null,
        memo:        rec.memo || '',
      });
    } else {
      // Fallback: direct confirm without modal
      const fid = typeof famId === 'function' ? famId() : null;
      const { error: upErr } = await sb.from('scheduled_ar_records')
        .update({ status:'received', received_at:new Date().toISOString(), updated_at:new Date().toISOString() })
        .eq('id', arId).eq('family_id', fid);
      if (upErr) throw upErr;
      _scArLoad();
      toast('Marcado como recebido','success');
    }
  } catch(e) {
    toast('Erro: '+(e.message||e),'error');
  }
}

async function _scArCancel(arId) {
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    // Load the AR record first so we can restore the occurrence
    const { data: rec } = await sb.from('scheduled_ar_records')
      .select('sc_id,date').eq('id', arId).maybeSingle();

    const { error } = await sb.from('scheduled_ar_records')
      .update({
        status:       'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .eq('id', arId)
      .eq('family_id', fid);
    if (error) throw error;

    // Restore occurrence: remove skipped status so it reappears in upcoming
    if (rec?.sc_id && rec?.date) {
      await sb.from('scheduled_occurrences')
        .delete()
        .eq('sc_id', rec.sc_id)
        .eq('scheduled_date', rec.date)
        .eq('execution_status', 'skipped')
        .eq('family_id', fid);
      // Update local cache
      const sc = (state.scheduled || []).find(s => s.id === rec.sc_id);
      if (sc?.occurrences) {
        sc.occurrences = sc.occurrences.filter(
          o => !(o.scheduled_date === rec.date && o.execution_status === 'skipped')
        );
      }
      // Remove from pending keys
      if (state._arPendingKeys) state._arPendingKeys.delete(rec.sc_id + '|' + rec.date);
    }

    await _scArLoad();
    renderUpcoming();
    toast('📅 Transação restaurada para Programados', 'info');
  } catch (e) {
    toast('Erro: ' + (e.message || e), 'error');
  }
}

function _scArShowBtn(sc) {
  const btn = document.getElementById('registerNotReceivedBtn');
  if (!btn) return;
  btn.style.display = sc && sc.type === 'income' ? '' : 'none';
}



// Cancel AR from the upcoming panel row (faster than going through scArSection)
async function _scArCancelFromUpcoming(arId, scId, date) {
  if (!confirm('Remover de A Receber e restaurar em Programados?')) return;
  await _scArCancel(arId);
}
window._scArCancelFromUpcoming = _scArCancelFromUpcoming;
window._scArLoad              = _scArLoad;
window._scArReceive           = _scArReceive;
window.registerAsNotReceived  = registerAsNotReceived;
window._scArCancel  = _scArCancel;
window._scArShowBtn = _scArShowBtn;

window.loadScheduled                       = loadScheduled;
// Auto-load A/R section after scheduled loads
_scArLoad && setTimeout(_scArLoad, 500);
// Show A Receber access button in Programados page
setTimeout(() => {
  const bar = document.getElementById('scArAccessBar');
  if (bar) bar.style.display = '';
}, 100);
window.openRegisterOcc                     = openRegisterOcc;

// ── switchScTab: handles tab navigation inside the scheduled modal ──────────
function switchScTab(paneId, btn) {
  document.querySelectorAll('[id^="scCtx"]').forEach(p => { p.style.display = 'none'; });
  const pane = document.getElementById(paneId);
  if (pane) pane.style.display = '';
  document.querySelectorAll('.tx-ctx-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (paneId === 'scCtxDivisao') {
    const scAmt = Math.abs(getAmtField('scAmount') || 0);
    if (typeof _scSplitRenderCat === 'function') _scSplitRenderCat(scAmt);
    if (typeof _scSplitRenderMem === 'function') _scSplitRenderMem(scAmt);
    const activeScTab = (typeof _scSplit !== 'undefined' && _scSplit.activeTab) || 'cat';
    if (typeof scSplitShowTab === 'function') scSplitShowTab(activeScTab);
  }
}
window.switchScTab = switchScTab;

window.openScheduledModal                  = openScheduledModal;
window.renderScheduled                     = renderScheduled;
window.runScheduledAutoRegister            = runScheduledAutoRegister;
window.saveScheduled                       = saveScheduled;
window.scCalGoToday                        = scCalGoToday;
window.scCalMove                           = scCalMove;
window.scChipFilter                        = scChipFilter;
window.setScCurrencyMode                   = setScCurrencyMode;
window.setScFxMode                         = setScFxMode;
window.setScType                           = setScType;
window.setScView                           = setScView;

// ── Antecipar Série — Computar e consolidar todas as parcelas pendentes ───────

function openAnteciparSerie(scId) {
  const sc = state.scheduled.find(s => s.id === scId);
  if (!sc) return;

  // Compute pending occurrences (not yet registered)
  const registered = new Set((sc.occurrences || []).map(o => o.scheduled_date));
  const allOccs    = generateOccurrences(sc, 500);
  const today      = localDateStr();
  const pending    = allOccs.filter(d => !registered.has(d) && d >= today);

  if (!pending.length) {
    toast('Não há parcelas pendentes para antecipar.', 'info');
    return;
  }

  const baseAmt    = Math.abs(parseFloat(sc.amount) || 0);
  const totalAmt   = baseAmt * pending.length;
  const isExpense  = sc.type === 'expense' || sc.type === 'transfer' || sc.type === 'card_payment';
  const currency   = sc.currency || (state.accounts.find(a => a.id === sc.account_id)?.currency) || 'BRL';
  const fmtAmt     = v => fmt(v, currency);

  // Build modal HTML
  const existing = document.getElementById('anteciparSerieModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'anteciparSerieModal';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">⏩ Antecipar Parcelas</span>
        <button class="modal-close" onclick="document.getElementById('anteciparSerieModal').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px">
          <div style="font-size:.78rem;font-weight:700;color:var(--text);margin-bottom:8px">${esc(sc.description || '—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <div style="font-size:.62rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Parcelas pendentes</div>
              <div style="font-size:1.1rem;font-weight:800;font-family:var(--font-serif)">${pending.length}</div>
            </div>
            <div>
              <div style="font-size:.62rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Valor por parcela</div>
              <div style="font-size:1.1rem;font-weight:800;font-family:var(--font-serif)">${fmtAmt(baseAmt)}</div>
            </div>
            <div>
              <div style="font-size:.62rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Total a consolidar</div>
              <div style="font-size:1.2rem;font-weight:900;font-family:var(--font-serif);color:${isExpense?'var(--red)':'var(--accent)'}">
                ${isExpense?'−':'+'}${fmtAmt(totalAmt)}
              </div>
            </div>
            <div>
              <div style="font-size:.62rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Data da transação</div>
              <div style="font-size:1rem;font-weight:700">${fmtDate(today)}</div>
            </div>
          </div>
        </div>

        <div style="background:rgba(180,83,9,.07);border:1px solid rgba(180,83,9,.22);border-radius:10px;padding:12px 14px;margin-bottom:16px">
          <div style="font-size:.78rem;color:#b45309;font-weight:600;margin-bottom:4px">⚠️ O que acontecerá:</div>
          <ul style="font-size:.75rem;color:#b45309;margin:0;padding-left:16px;line-height:1.7">
            <li>Todas as ${pending.length} parcelas pendentes serão consolidadas em <strong>uma única transação</strong> com data de hoje</li>
            <li>Valor total: <strong>${fmtAmt(totalAmt)}</strong> (${pending.length} × ${fmtAmt(baseAmt)})</li>
            <li>A transação programada será <strong>marcada como concluída</strong></li>
            <li>Descrição inclui detalhes das parcelas antecipadas</li>
          </ul>
        </div>

        <div style="font-size:.78rem;color:var(--muted);margin-bottom:4px;font-weight:600">Observação adicional (opcional)</div>
        <textarea id="anteciparMemo" rows="2"
          placeholder="Ex: Quitação antecipada, negociação de desconto…"
          style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-family:inherit;font-size:.83rem;resize:vertical;background:var(--surface);color:var(--text);box-sizing:border-box"></textarea>

        <div style="font-size:.72rem;color:var(--muted);margin-top:8px">
          Parcelas: ${pending.slice(0,5).map(d=>fmtDate(d)).join(', ')}${pending.length>5?` … +${pending.length-5} mais`:''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('anteciparSerieModal').remove()">Cancelar</button>
        <button class="btn btn-primary" id="anteciparConfirmBtn" onclick="_confirmarAntecipacao('${scId}')">
          ⏩ Confirmar Antecipação
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}
window.openAnteciparSerie = openAnteciparSerie;

async function _confirmarAntecipacao(scId) {
  const sc = state.scheduled.find(s => s.id === scId);
  if (!sc) return;

  const btn = document.getElementById('anteciparConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processando…'; }

  try {
    const registered = new Set((sc.occurrences || []).map(o => o.scheduled_date));
    const allOccs    = generateOccurrences(sc, 500);
    const today      = localDateStr();
    const pending    = allOccs.filter(d => !registered.has(d) && d >= today);

    if (!pending.length) throw new Error('Nenhuma parcela pendente.');

    const baseAmt   = Math.abs(parseFloat(sc.amount) || 0);
    const totalAmt  = baseAmt * pending.length;
    const isExpense = sc.type === 'expense' || sc.type === 'transfer' || sc.type === 'card_payment';
    const finalAmt  = isExpense ? -totalAmt : totalAmt;
    const currency  = sc.currency || (state.accounts.find(a => a.id === sc.account_id)?.currency) || 'BRL';
    const extraMemo = (document.getElementById('anteciparMemo')?.value || '').trim();

    // Build description with details
    const fmtAmt  = v => fmt(v, currency);
    const desc    = `${sc.description || 'Programado'} — Antecipação de ${pending.length} parcela${pending.length!==1?'s':''} (${fmtAmt(baseAmt)} cada)`;
    const memo    = [
      `Antecipação em ${fmtDate(today)}: ${pending.length} parcela${pending.length!==1?'s':''} × ${fmtAmt(baseAmt)} = ${fmtAmt(totalAmt)}`,
      `Período: ${fmtDate(pending[0])} a ${fmtDate(pending[pending.length-1])}`,
      `Ref. programado ID: ${scId}`,
      extraMemo
    ].filter(Boolean).join('\n');

    // Insert consolidated transaction
    const txPayload = {
      family_id:    famId(),
      date:         today,
      description:  desc,
      amount:       finalAmt,
      account_id:   sc.account_id,
      payee_id:     sc.payee_id || null,
      category_id:  sc.category_id || null,
      memo,
      tags:         sc.tags || [],
      is_transfer:  false,
      status:       'confirmed',
      currency:     currency,
      updated_at:   new Date().toISOString(),
    };

    const { data: txData, error: txErr } = await sb.from('transactions').insert(txPayload).select().single();
    if (txErr) throw txErr;

    // Register all pending occurrences as executed, pointing to this tx
    for (const d of pending) {
      try {
        await sb.from('scheduled_occurrences').insert({
          scheduled_transaction_id: scId,
          scheduled_date:  d,
          actual_date:     today,
          amount:          isExpense ? -baseAmt : baseAmt,
          memo:            `Antecipada em ${fmtDate(today)}`,
          transaction_id:  txData.id,
          execution_status:'executed',
          executed_at:     new Date().toISOString(),
        });
      } catch(occErr) {
        console.warn('[antecipar] occurrence insert:', occErr?.message);
      }
    }

    // Mark scheduled as finished
    await sb.from('scheduled_transactions').update({ status: 'finished', updated_at: new Date().toISOString() }).eq('id', scId);

    // Close modal and reload
    document.getElementById('anteciparSerieModal')?.remove();
    toast(`✅ ${pending.length} parcela${pending.length!==1?'s':''} antecipadas em uma transação de ${fmt(Math.abs(finalAmt), currency)}`, 'success');

    // Reload state
    if (typeof loadScheduled === 'function') await loadScheduled(true);
    if (typeof renderScheduled === 'function') renderScheduled(state.scheduled || []);

  } catch(e) {
    toast('Erro na antecipação: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⏩ Confirmar Antecipação'; }
  }
}
window._confirmarAntecipacao = _confirmarAntecipacao;

/* ── ctsUpdateMode: visual toggle for Convert-to-Scheduled modal ─────────── */
function ctsUpdateMode() {
  const sel = document.querySelector('input[name="ctsMode"]:checked')?.value || 'keep';
  const keepLabel    = document.getElementById('ctsModeKeepLabel');
  const convertLabel = document.getElementById('ctsModeConvertLabel');
  const dateLabel    = document.getElementById('ctsDateLabel');
  const warning      = document.getElementById('ctsWarning');
  const accent       = 'var(--accent)';
  const border       = 'var(--border)';

  if (keepLabel) {
    keepLabel.style.borderColor  = sel === 'keep' ? accent : border;
    keepLabel.style.background   = sel === 'keep' ? 'rgba(42,96,73,.06)' : 'transparent';
  }
  if (convertLabel) {
    convertLabel.style.borderColor = sel === 'convert' ? accent : border;
    convertLabel.style.background  = sel === 'convert' ? 'rgba(42,96,73,.06)' : 'transparent';
  }
  if (dateLabel) dateLabel.textContent = sel === 'keep' ? 'Data de início (próxima) *' : 'Data original *';

  if (warning) {
    if (sel === 'convert') {
      warning.textContent = '⚠️ O lançamento original será deletado e o saldo da conta revertido. Esta ação cria uma programação equivalente a partir da data original.';
      warning.style.display = '';
    } else {
      warning.style.display = 'none';
    }
  }
}
window.ctsUpdateMode = ctsUpdateMode;

/* ── runScheduledManual: trigger pending auto-register immediately ─────────── */
async function runScheduledManual() {
  if (typeof runAutoRegister === 'function') {
    toast('▶ Executando transações agendadas…', 'info');
    try {
      await runAutoRegister(true);
      toast('✅ Transações agendadas processadas.', 'success');
    } catch(e) {
      toast('Erro ao executar: ' + (e.message||e), 'error');
    }
  } else if (typeof runScheduledAutoRegister === 'function') {
    toast('▶ Executando transações agendadas…', 'info');
    try {
      await runScheduledAutoRegister();
      toast('✅ Transações agendadas processadas.', 'success');
    } catch(e) {
      toast('Erro ao executar: ' + (e.message||e), 'error');
    }
  } else {
    toast('Função de auto-registro não disponível.', 'warning');
  }
}
window.runScheduledManual = runScheduledManual;


function syncScheduledAutomationSummary() {
  if (typeof _updateAutoConfirmHint === 'function') _updateAutoConfirmHint();
}
window.syncScheduledAutomationSummary = syncScheduledAutomationSummary;
