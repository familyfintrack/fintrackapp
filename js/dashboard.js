const _dashGroupCollapsed = {}; // groupId → true/false

function toggleDashGroup(key) {
  _dashGroupCollapsed[key] = !_dashGroupCollapsed[key];
  const body  = document.getElementById('dashGroupBody-' + key);
  const arrow = document.getElementById('dashGroupArrow-' + key);
  const collapsed = _dashGroupCollapsed[key];
  if (body)  body.style.maxHeight  = collapsed ? '0' : '2000px';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

// Dashboard formatter: no decimals (0 casas) for quick glance

function _dashRenderIcon(iconKey, color, size){
  try {
    if (typeof renderIconEl === 'function') return renderIconEl(iconKey, color, size);
  } catch(_) {}
  return `<span style="font-size:${size || 18}px">🏦</span>`;
}

function _dashRenderChart(id, type, labels, datasets, extraOptions={}) {
  if (typeof renderChart === 'function') return renderChart(id, type, labels, datasets, extraOptions);
  const canvas = document.getElementById(id);
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || typeof Chart === 'undefined') return null;
  state.chartInstances = state.chartInstances || {};
  if (state.chartInstances[id]) {
    try { state.chartInstances[id].destroy(); } catch(_) {}
  }
  state.chartInstances[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: Object.assign({ responsive:true, maintainAspectRatio:true }, extraOptions || {})
  });
  return state.chartInstances[id];
}

function dashFmt(value, currency='BRL'){
  if (state?.privacyMode) return '••••••';
  const v = Number(value) || 0;
  try{
    const opts = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    if(currency){
      return v.toLocaleString('pt-BR', { style:'currency', currency, ...opts });
    }
    return v.toLocaleString('pt-BR', opts);
  }catch(e){
    // Fallback
    const rounded = Math.round(v);
    return (currency ? `R$ ${rounded.toLocaleString('pt-BR')}` : rounded.toLocaleString('pt-BR'));
  }
}

async function loadDashboardRecent(memberIds = null){
  const status = document.getElementById('dashRecentStatus')?.value || '';
  let q = famQ(
    sb.from('transactions')
      .select('*, status, accounts!transactions_account_id_fkey(name), categories(name,color)')
  ).order('date', { ascending: false }).limit(30);

  if (status) q = q.eq('status', status);
  const qFiltered = _applyDashMemberFilter(q, memberIds);
  if (qFiltered === null) {
    const body = document.getElementById('recentTxBody');
    if (body) body.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">${t('dash.empty_tx')}</td></tr>`;
    return;
  }
  q = qFiltered;

  const { data: recent, error } = await q;
  if (error) { console.warn('[dashboard recent]', error.message); }

  const body = document.getElementById('recentTxBody');
  if (!body) return;

  const items = recent || [];
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:24px;font-size:.83rem">${t('dash.empty_tx')}</td></tr>`;
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const byDate = {};
  items.forEach(t => { (byDate[t.date] ||= []).push(t); });

  const dateLabel = (date) => {
    if (date === todayStr) return 'Hoje';
    if (date === yesterdayStr) return 'Ontem';
    return fmtDate(date);
  };

  body.innerHTML = Object.entries(byDate).map(([date, rows]) => {
    const confirmedCount = rows.filter(t => (t.status || 'confirmed') !== 'pending').length;
    const pendingCount = rows.length - confirmedCount;
    const total = rows.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const badgeParts = [
      `<span style="font-size:.7rem;color:var(--muted)">${rows.length} item${rows.length > 1 ? 's' : ''}</span>`
    ];
    if (pendingCount) badgeParts.push(`<span class="badge" style="background:rgba(245,158,11,.14);color:var(--amber,#b45309);border:1px solid rgba(180,83,9,.18);font-size:.64rem">⏳ ${pendingCount} pendente${pendingCount>1?'s':''}</span>`);
    const totalColor = total === 0 ? 'var(--muted)' : (total > 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)');

    const header = `<tr class="recent-date-group"><td colspan="4" style="padding:10px 10px 8px 10px;background:var(--surface2);border-top:1px solid var(--border);border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:.78rem;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.03em">${dateLabel(date)}</span><span style="font-size:.72rem;color:var(--muted)">${fmtDate(date)}</span>${badgeParts.join('')}</div><span style="font-size:.78rem;font-weight:800;color:${totalColor}">${fmt(total)}</span></div></td></tr>`;

    const lines = rows.map(t => {
      const isPend = (t.status || 'confirmed') === 'pending';
      const rowStyle = isPend ? 'background:rgba(245,158,11,.10)' : '';
      const badge = isPend ? '<span class="badge" style="margin-left:6px;background:rgba(245,158,11,.16);color:var(--amber,#b45309);border:1px solid rgba(180,83,9,.18);font-size:.65rem">⏳ pendente</span>' : '';
      const clip = t.attachment_url ? ' <span title="Possui anexo" style="font-size:.85rem;opacity:.75">📎</span>' : '';
      return `<tr class="tx-row-clickable" data-tx-id="${t.id}" onclick="openTxDetail('${t.id}')" style="cursor:pointer;${rowStyle}">
        <td class="text-muted" style="white-space:nowrap">${fmtDate(t.date)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}${clip}${badge}</td>
        <td>${t.categories?`<span class="badge" style="background:${t.categories.color}18;color:${t.categories.color};border:1px solid ${t.categories.color}28">${esc(t.categories.name)}</span>`:'—'}</td>
        <td class="${t.amount>=0?'amount-pos':'amount-neg'}" style="white-space:nowrap">${fmt(t.amount)}</td>
      </tr>`;
    }).join('');

    return header + lines;
  }).join('');
}


// ── Dashboard member filter helper ───────────────────────────────────────────
// Returns array of member IDs for the current dashboard filters,
// or null if no filter is active (= show all).
function _updateDashFilterBadge(memberIds) {
  let badge = document.getElementById('dashFilterBadge');
  if (!memberIds) {
    if (badge) { badge.style.display = 'none'; } return;
  }
  if (!badge) return;
  const memberId  = document.getElementById('dashMemberFilter')?.value || '';
  const relGroup  = document.getElementById('dashRelGroup')?.value    || '';
  const sel       = document.getElementById('dashMemberFilter');
  const relSel    = document.getElementById('dashRelGroup');
  let label = '';
  if (memberId && sel) {
    label = sel.options[sel.selectedIndex]?.text || memberId;
  } else if (relGroup && relSel) {
    label = relSel.options[relSel.selectedIndex]?.text || relGroup;
  }
  if (label) {
    badge.style.display = 'inline-flex';
    const span = badge.querySelector('span');
    if (span) span.textContent = '👤 ' + label;
  } else {
    badge.style.display = 'none';
  }
}


function _getDashMemberIds() {
  const memberId = document.getElementById('dashMemberFilter')?.value || '';
  const relGroup = document.getElementById('dashRelGroup')?.value    || '';
  if (memberId) return [memberId];
  if (relGroup && typeof getMemberIdsByRelGroup === 'function') {
    return getMemberIdsByRelGroup(relGroup); // may be [] if group empty
  }
  return null; // no filter active
}

// Apply member filter to a Supabase query object (transactions table).
// Returns the (possibly modified) query.
function _applyDashMemberFilter(q, memberIds) {
  if (!memberIds) return q;          // no filter
  if (memberIds.length === 0) return null; // filter active but no members — no results
  return q.in('family_member_id', memberIds);
}


function _openDashMonthTx(type, memberIds) {
  const now=new Date();
  const month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  state.txFilter=state.txFilter||{};
  Object.assign(state.txFilter,{month,type,search:'',account:'',status:'confirmed'});
  state.txPage=0; state.txSortField='date'; state.txSortAsc=false;
  const _e=id=>document.getElementById(id);
  if(_e('txMonth'))        _e('txMonth').value=month;
  if(_e('txType'))         _e('txType').value=type;
  if(_e('txStatusFilter')) _e('txStatusFilter').value='confirmed';
  if(_e('txSearch'))       _e('txSearch').value='';
  if(_e('txAccount'))      _e('txAccount').value='';
  navigate('transactions');
}
async function loadDashboard(){
  // Atualizar nome da família ativa no topo do dashboard
  try {
    const famNameEl = document.getElementById('dashFamilyNameText');
    if (famNameEl) {
      const fid = currentUser?.family_id;
      const name = (typeof _familyDisplayName === 'function' && fid)
        ? _familyDisplayName(fid, '')
        : (currentUser?.families?.[0]?.name || '');
      famNameEl.textContent = name || '—';
    }
  } catch(_e) {}

  // Aplicar prefs de customização imediatamente (evita flash de cards ocultos)
  try { _dashApplyPrefs(_dashGetPrefs()); } catch(_e) {}
  // Sincronizar prefs do servidor em background
  _syncDashPrefsFromServer().catch(()=>{});
  // Guard: sem cliente Supabase ou sem family_id não há dados para mostrar
  if (!sb) { console.warn('[dashboard] sb não inicializado'); return; }
  if (!currentUser?.family_id && currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
    console.warn('[dashboard] currentUser sem family_id — lançando wizard de criação');
    // User has no family: let them create one instead of showing a dead-end message
    if (typeof enforceFirstLoginFamilyCreation === 'function') {
      enforceFirstLoginFamilyCreation();
    }
    return;
  }
  // Inicia FX em paralelo com os KPIs — nunca bloqueia o dashboard
  const fxPromise = initFxRates().catch(()=>{});
  const _dashMemberIds = _getDashMemberIds();

  // Show/hide active filter badge on dashboard KPIs
  _updateDashFilterBadge(_dashMemberIds);

  const [{ income, expense, total, pendingCount: _pendCount }] = await Promise.all([
    DB.dashboard.loadKPIs(_dashMemberIds),
    fxPromise,
  ]);
  const statTotalEl = document.getElementById('statTotal');
  const statIncomeEl = document.getElementById('statIncome');
  const statExpensesEl = document.getElementById('statExpenses');
  const bal = income - expense;
  const balEl = document.getElementById('statBalance');

  // Current month label for KPI subtexts
  const _now = new Date();
  const _monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const _curMonthLabel = `${_monthNames[_now.getMonth()]} ${_now.getFullYear()}`;

  if (statTotalEl){
    statTotalEl.textContent = dashFmt(total,'BRL');
    statTotalEl.className = 'dash-kpi-value ' + (total >= 0 ? 'amount-pos' : 'amount-neg');
    const _tc = statTotalEl.closest('.dash-kpi-card');
    if (_tc) {
      _tc.style.cursor = 'pointer';
      _tc.title = 'Ver composição do patrimônio';
      _tc.onclick = () => _openPatrimonioModal();
    }
  }
  if (statIncomeEl){
    statIncomeEl.textContent = dashFmt(income,'BRL');
    statIncomeEl.className = 'dash-kpi-value amount-pos';
    const _ic = statIncomeEl.closest('.dash-kpi-card');
    if (_ic) {
      _ic.style.cursor = 'pointer';
      _ic.title = 'Ver receitas do mês';
      _ic.onclick = () => _openDashMonthTx('income', _dashMemberIds);
    }
    const _im = document.getElementById('dashIncomeMonth');
    if (_im) _im.textContent = _curMonthLabel;
  }
  if (statExpensesEl){
    statExpensesEl.textContent = dashFmt(expense,'BRL');
    statExpensesEl.className = 'dash-kpi-value amount-neg';
    const _ec = statExpensesEl.closest('.dash-kpi-card');
    if (_ec) {
      _ec.style.cursor = 'pointer';
      _ec.title = 'Ver despesas do mês';
      _ec.onclick = () => _openDashMonthTx('expense', _dashMemberIds);
    }
    const _em = document.getElementById('dashExpenseMonth');
    if (_em) _em.textContent = _curMonthLabel;
  }
  if (balEl){
    balEl.textContent = dashFmt(bal,'BRL');
    balEl.className = 'dash-kpi-value ' + (bal >= 0 ? 'amount-pos' : 'amount-neg');
    const _bc = balEl.closest('.dash-kpi-card');
    if (_bc) {
      _bc.style.cursor = 'pointer';
      _bc.title = 'Ver saldo do mês';
      _bc.onclick = () => _openDashMonthTx(null, _dashMemberIds);
    }
  }
  // Pending badge — count already loaded by DB.dashboard.loadKPIs() above
  try {
    const pendingCount = _pendCount;
    const pb = document.getElementById('dashPendingBadge');
    if (pb) {
      if ((pendingCount || 0) > 0) {
        pb.style.display = '';
        pb.textContent = `⏳ ${pendingCount} pendente${pendingCount !== 1 ? 's' : ''}`;
        pb.title = 'Clique para ver pendentes';
        pb.style.cursor = 'pointer';
        pb.onclick = () => {
          navigate('transactions');
          // Apply pending filter when user lands on Transactions
          setTimeout(() => {
            const sel = document.getElementById('txStatusFilter');
            if (sel) { sel.value = 'pending'; filterTransactions(); }
          }, 50);
        };
      } else {
        pb.style.display = 'none';
      }
    }
  } catch(e) {
    // fail silently
  }

  // Recent transactions table (supports status filter)
  await loadDashboardRecent(_dashMemberIds);
  if (typeof renderDashboardUpcoming === 'function') await renderDashboardUpcoming(_dashMemberIds);
  if(typeof _renderDashFavCategories==='function') await _renderDashFavCategories(income, expense);
  _renderDashForecast().catch(()=>{});
  await loadDashboardAutoRunSummary();
  // Carregar cards opcionais (budgets + investments + dreams) se habilitados
  _loadDashBudgetsCard().catch(() => {});
  _loadDashInvestmentsCard().catch(() => {});
  _loadDashDreamsCard().catch(() => {});
  _loadDashTopPayeesCard().catch(() => {});

  // Render account balances grouped by account group
  (function renderAccountBalances() {
    const el = document.getElementById('accountBalancesList');
    if (!el) { console.warn('[dashboard] accountBalancesList not found'); return; }
    const accs = Array.isArray(state.accounts) ? state.accounts : [];
    const groups = state.groups || [];
    const favs = accs.filter(a => a.is_favorite);

    // ── Row renderers ────────────────────────────────────────────────────
    const rowHtml = a => {
      const isFav = !!a.is_favorite;
      const balColor = a.balance < 0 ? 'var(--red)' : 'var(--accent)';
      if (isFav) {
        // Fintech-style card for favorites
        const _cardColor  = a.color || '#2a6049';
        const _typeLabel  = accountTypeLabel(a.type) || a.type || '';
        const _isNeg      = a.balance < 0;
        const _brlLine    = (a.currency !== 'BRL')
          ? `<div class="dash-fav-brl">${dashFmt(toBRL(a.balance,a.currency),'BRL')}</div>`
          : '';
        // Confirmed-only balance line (hidden when equal to total balance)
        const _confBal = a.confirmed_balance;
        const _hasPending = (_confBal !== undefined) && (Math.abs(_confBal - a.balance) > 0.001);
        const _confIsNeg   = _confBal < 0;
        const _confLine    = _hasPending
          ? `<div class="dash-fav-card__confirmed ${_confIsNeg ? 'neg' : ''}">
               <span class="dash-fav-card__confirmed-label">confirmado</span>
               ${fmt(_confBal, a.currency)}
             </div>`
          : '';
        return `<div class="dash-fav-card" onclick="goToAccountTransactions('${a.id}')"
          style="--card-clr:${_cardColor}">
          <div class="dash-fav-card__top">
            <div class="dash-fav-card__icon">${_dashRenderIcon(a.icon,a.color,20)}</div>
            <span class="dash-fav-card__type">${esc(_typeLabel)}</span>
          </div>
          <div class="dash-fav-card__name">${esc(a.name)}</div>
          <div class="dash-fav-card__balance ${_isNeg ? 'neg' : ''}">${fmt(a.balance,a.currency)}</div>
          ${_confLine}
          ${_brlLine}
          <div class="dash-fav-card__spacer"></div>
          <div class="dash-fav-card__actions" onclick="event.stopPropagation()">
            <button class="dash-fav-card__btn"
              onclick="_openFavAccountModal('${a.id}')"
              title="Informações da conta">
              <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM9 9a1 1 0 0 0 0 2v3a1 1 0 0 0 2 0V9a1 1 0 0 0-1-1H9z" clip-rule="evenodd"/></svg>
            </button>
            <button class="dash-fav-card__btn"
              onclick="openConsolidateModal('${a.id}')"
              title="Consolidar saldo">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </button>
          </div>
          <div class="dash-fav-card__shine"></div>
        </div>`;
      }
      // Standard row for non-favorites
      return `<div onclick="goToAccountTransactions('${a.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;border-radius:4px;margin:0 -4px;padding-left:4px;padding-right:4px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:9px">${_dashRenderIcon(a.icon,a.color,20)}<span style="font-size:.92rem;font-weight:500;color:var(--text)">${esc(a.name)}</span></div>
        <span class="${a.balance<0?'text-red':'text-accent'}" style="font-size:.92rem;font-weight:700;font-family:var(--font-serif)">${fmt(a.balance,a.currency)}</span>
      </div>`;
    };

    // ── Build HTML ────────────────────────────────────────────────────────
    let html = '';

    // Favorites section — always at top if any exist, grouped by type
    if (favs.length) {
      // Group favorites: credit cards | checking+savings | others
      const favCC      = favs.filter(a => a.type === 'cartao_credito');
      const favCheck   = favs.filter(a => a.type === 'corrente' || a.type === 'poupanca');
      const favOthers  = favs.filter(a => !['cartao_credito','corrente','poupanca'].includes(a.type));

      const _favTypeSep = (items, label) => {
        if (!items.length) return '';
        const total = items.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
        const isCC = label === 'Cartão de Crédito';
        // Use fmt() for consistency with rest of app (shows centavos, respects privacy mode)
        const totalFmt = fmt(Math.abs(total), 'BRL');
        const totalColor = total < 0 ? 'var(--red)' : isCC ? 'var(--red)' : 'var(--accent)';
        const icon = isCC ? '💳' : label.includes('Corrente') ? '🏦' : '📦';
        return `<div class="dash-fav-type-group">
          <div class="dash-fav-type-header">
            <span class="dash-fav-type-label">${icon} ${label}</span>
            <span class="dash-fav-type-total" style="color:${totalColor};font-family:var(--font-serif,monospace)">${isCC && total < 0 ? '−' : ''}${totalFmt}</span>
          </div>
          <div class="dash-favs-grid">${items.map(rowHtml).join('')}</div>
        </div>`;
      };

      // Desktop: type groups rendered as parallel columns
      // Mobile/tablet: stacked vertically (default)
      const _hasMultipleGroups = [favCC, favCheck, favOthers].filter(g => g.length).length > 1;
      const favHtml = (favCC.length || favCheck.length || favOthers.length)
        ? (_hasMultipleGroups
            ? `<div class="dash-fav-columns">${
                [
                  _favTypeSep(favCC, 'Cartão de Crédito'),
                  _favTypeSep(favCheck, 'Corrente / Poupança'),
                  _favTypeSep(favOthers, 'Outros')
                ].filter(Boolean).join('')
              }</div>`
            : _favTypeSep(favCC, 'Cartão de Crédito') +
              _favTypeSep(favCheck, 'Corrente / Poupança') +
              _favTypeSep(favOthers, 'Outros')
          )
        : `<div class="dash-favs-grid">${favs.map(rowHtml).join('')}</div>`;

      html += `<div class="dash-favs-section">${favHtml}</div>`;

      // Non-favorites: split BRL vs foreign, both collapsed by default
      const nonFavs = accs.filter(a => !a.is_favorite);
      if (nonFavs.length) {
        const brlAccs = nonFavs.filter(a => !a.currency || a.currency === 'BRL');
        const fxAccs  = nonFavs.filter(a =>  a.currency && a.currency !== 'BRL');

        const buildOtherGroup = (key, label, emoji, gAccs) => {
          if (!gAccs.length) return '';
          // Start collapsed by default
          if (_dashGroupCollapsed[key] === undefined) _dashGroupCollapsed[key] = true;
          const collapsed = _dashGroupCollapsed[key];
          const gTotal = gAccs.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
          return `<div style="margin-top:6px">
            <div onclick="toggleDashGroup('${key}')"
              style="display:flex;justify-content:space-between;align-items:center;
                padding:7px 0;cursor:pointer;user-select:none;
                border-top:1px solid var(--border)">
              <span style="display:flex;align-items:center;gap:6px;font-size:.68rem;font-weight:700;
                text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">
                <span style="display:inline-block;transition:transform .2s;
                  transform:rotate(${collapsed?'-90deg':'0deg'})"
                  id="dashGroupArrow-${key}">▾</span>
                ${emoji} ${label}
              </span>
              <span style="font-size:.72rem;font-weight:600;color:var(--muted)">${dashFmt(gTotal,'BRL')}</span>
            </div>
            <div id="dashGroupBody-${key}"
              style="overflow:hidden;transition:max-height .25s ease;
                max-height:${collapsed?'0':'2000px'}">
              ${gAccs.map(rowHtml).join('')}
            </div>
          </div>`;
        };

        html += buildOtherGroup('__nonfav_brl', 'Em Real', '🇧🇷', brlAccs);
        html += buildOtherGroup('__nonfav_fx',  'Moeda Estrangeira', '🌍', fxAccs);
      }
      el.innerHTML = html;
      return;
    }

    // No favorites — use original group/flat layout
    if (!groups.length) {
      el.innerHTML = accs.map(rowHtml).join('');
      return;
    }
    const grouped = {};
    accs.forEach(a => { const gid = a.group_id || '__none__'; if (!grouped[gid]) grouped[gid] = []; grouped[gid].push(a); });
    const buildGroup = (key, label, gAccs) => {
      const collapsed = _dashGroupCollapsed[key] === true;
      const gTotal = gAccs.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
      return `<div style="margin-bottom:2px">
        <div onclick="toggleDashGroup('${key}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;margin-top:6px;cursor:pointer;user-select:none">
          <span style="display:flex;align-items:center;gap:5px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)">
            <span style="display:inline-block;transition:transform .2s;transform:rotate(${collapsed?'-90deg':'0deg'})" id="dashGroupArrow-${key}">▾</span>
            ${label}
          </span>
          <span style="font-size:.75rem;font-weight:600;color:var(--muted)">${dashFmt(gTotal,'BRL')}</span>
        </div>
        <div id="dashGroupBody-${key}" style="padding-left:4px;overflow:hidden;transition:max-height .25s ease;max-height:${collapsed?'0':'2000px'}">
          ${gAccs.map(rowHtml).join('')}
        </div>
      </div>`;
    };
    groups.forEach(g => {
      const gAccs = grouped[g.id];
      if (!gAccs || !gAccs.length) return;
      html += buildGroup(g.id, `${g.emoji||'🗂️'} ${esc(g.name)}`, gAccs);
    });
    const ungrouped = grouped['__none__'];
    if (ungrouped && ungrouped.length) html += buildGroup('__none__', 'Sem grupo', ungrouped);
    el.innerHTML = html || accs.map(rowHtml).join('');
  })();
  // Populate member and relationship filters for category chart
  if (typeof refreshAllFamilyMemberSelects === 'function') {
    refreshAllFamilyMemberSelects();
  } else {
    // member filter removed
  }

  // Render charts independently — failure in one must not block the other
  await Promise.all([
    renderCashflowChart(_dashMemberIds).catch(e => console.warn('[dashboard] cashflow:', e?.message)),
    renderCategoryChart().catch(e => console.warn('[dashboard] categoryChart:', e?.message)),
  ]);
}
async function renderCashflowChart(memberIds = null){
  // Populate account filter (refresh every time dashboard loads)
  const sel = document.getElementById('cashflowAccountFilter');
  if(sel) {
    const curVal = sel.value;
    sel.innerHTML = `<option value="">${t('dash.all_accounts')}</option>` +
      (typeof _accountOptions === 'function'
        ? _accountOptions(state.accounts, null)
        : state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join(''));
    if(curVal) sel.value = curVal;
  }
  const accId = sel ? sel.value : '';
  const labels=[];
  const cashRows = await DB.dashboard.loadCashflow(accId, memberIds);
  const incomes  = cashRows.map(r => r.income);
  const expenses = cashRows.map(r => r.expense);
  const balances = cashRows.map(r => r.balance);
  labels.length = 0;
  cashRows.forEach(r => labels.push(r.label));
  window._cashflowMonthData = {};
  cashRows.forEach(r => { window._cashflowMonthData[r.label] = r; });

  // Gradient fill for balance line
  const canvas = document.getElementById('cashflowChart');
  const ctx = canvas?.getContext?.('2d');
  let balGradient = 'rgba(30,91,168,.12)';
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, 'rgba(30,91,168,.22)');
    g.addColorStop(1, 'rgba(30,91,168,.01)');
    balGradient = g;
  }

  const chartInst = _dashRenderChart('cashflowChart','bar',labels,[
    {
      label:'Receitas', data:incomes,
      backgroundColor:'rgba(42,122,74,.82)',
      hoverBackgroundColor:'rgba(42,122,74,1)',
      borderRadius:7, borderSkipped:false, order:2,
    },
    {
      label:'Despesas', data:expenses,
      backgroundColor:'rgba(192,57,43,.75)',
      hoverBackgroundColor:'rgba(192,57,43,1)',
      borderRadius:7, borderSkipped:false, order:2,
    },
    {
      label:'Saldo', data:balances, type:'line',
      borderColor:'#1e5ba8',
      backgroundColor: balGradient,
      borderWidth:2.5, pointRadius:5, pointHoverRadius:7,
      pointBackgroundColor:'#fff', pointBorderColor:'#1e5ba8', pointBorderWidth:2,
      fill:true, tension:0.4, order:1,
    },
  ],{
    plugins:{
      legend:{
        display:true,
        position:'bottom',
        labels:{
          boxWidth:10, boxHeight:10, borderRadius:3,
          usePointStyle:true, pointStyle:'rectRounded',
          font:{size:11},
          color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() || '#3d3830',
          padding:14,
        },
      },
      tooltip:{
        backgroundColor:'rgba(10,20,15,.88)',
        titleColor:'#fff', bodyColor:'rgba(255,255,255,.85)',
        borderColor:'rgba(255,255,255,.12)', borderWidth:1,
        padding:10, cornerRadius:8,
        callbacks:{
          label(ctx){
            const v = ctx.parsed.y;
            const sign = ctx.dataset.label==='Despesas' ? '−' : (v>0?'+':'');
            return ` ${ctx.dataset.label}: ${sign}R$ ${Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0})}`;
          },
          title(items){ return items[0]?.label || ''; },
        },
      },
    },
    onClick(evt, elements) {
      if (!elements.length) return;
      const idx   = elements[0].index;
      const label = labels[idx];
      const dsIdx = elements[0].datasetIndex;
      _dashCashflowDrill(label, dsIdx===0?'income':dsIdx===1?'expense':null);
    },
    onHover(evt, elements) { evt.native.target.style.cursor = elements.length?'pointer':'default'; },
    scales:{
      x:{
        grid:{display:false},
        ticks:{font:{size:11},color:'#8c8278'},
      },
      y:{
        grid:{color:'rgba(0,0,0,.05)',drawBorder:false},
        ticks:{
          font:{size:11},color:'#8c8278',
          callback(v){ return 'R$'+Math.abs(v/1000).toFixed(v>=1000||v<=-1000?0:1)+'k'; },
        },
      },
    },
  });
}

async function _dashCashflowDrill(monthLabel, type) {
  const wrap  = document.getElementById('dashForecastChartWrap');
  const drill = document.getElementById('dashCashflowDrill');
  if (!wrap || !drill) return;

  drill.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">⏳ Carregando…</div>';
  wrap.style.display = 'none';
  drill.style.display = 'block';

  // Parse month from label (e.g. "Jan/25" → 2025-01)
  const monthMap = {Jan:'01',Fev:'02',Mar:'03',Abr:'04',Mai:'05',Jun:'06',Jul:'07',Ago:'08',Set:'09',Out:'10',Nov:'11',Dez:'12'};
  const parts = monthLabel.split('/');
  const monthNum = monthMap[parts[0]] || '01';
  const yearFull = parts[1] ? (parseInt(parts[1]) < 50 ? '20'+parts[1] : '19'+parts[1]) : new Date().getFullYear();
  const from = `${yearFull}-${monthNum}-01`;
  const lastDay = new Date(parseInt(yearFull), parseInt(monthNum), 0).getDate();
  const to = `${yearFull}-${monthNum}-${String(lastDay).padStart(2,'0')}`;

  try {
    let q = famQ(sb.from('transactions')
      .select('id,date,description,amount,accounts!transactions_account_id_fkey(name),categories(name,color)'))
      .gte('date', from).lte('date', to).order('date',{ascending:false});
    if (type === 'income')  q = q.gt('amount', 0);
    if (type === 'expense') q = q.lt('amount', 0);
    const { data: txs } = await q;

    const typeLabel = type === 'income' ? 'Receitas' : type === 'expense' ? 'Despesas' : 'Tudo';
    const total = (txs||[]).reduce((s,t) => s + Math.abs(Number(t.amount)||0), 0);

    drill.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
        <div>
          <span style="font-size:.88rem;font-weight:700;color:var(--text)">${monthLabel} · ${typeLabel}</span>
          <span style="font-size:.72rem;color:var(--muted);margin-left:8px">${(txs||[]).length} transações · ${fmt(total)}</span>
        </div>
        <button onclick="document.getElementById('dashCashflowDrill').style.display='none';document.getElementById('dashForecastChartWrap').style.display=''"
          style="display:flex;align-items:center;gap:4px;font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer">
          ← Voltar ao gráfico
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;max-height:220px;overflow-y:auto">
        ${(txs||[]).length ? (txs||[]).map(t => {
          const isNeg = t.amount < 0;
          const catColor = t.categories?.color || (isNeg ? 'var(--red)' : 'var(--green)');
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:7px;cursor:pointer;transition:background .12s"
            onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='var(--surface2)'"
            onclick="if(typeof openTransactionEdit==='function')openTransactionEdit('${t.id}')">
            <div style="width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description||'—')}</div>
              <div style="font-size:.65rem;color:var(--muted)">${t.date}${t.accounts?.name?' · '+esc(t.accounts.name):''}</div>
            </div>
            <span style="font-size:.8rem;font-weight:700;flex-shrink:0;color:${isNeg?'var(--red,#c0392b)':'var(--green,#2a7a4a)'}">
              ${isNeg?'−':'+'}${fmt(Math.abs(Number(t.amount)||0))}
            </span>
          </div>`;
        }).join('') : '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">Nenhuma transação</div>'}
      </div>`;
  } catch(e) {
    drill.innerHTML = `<div style="color:var(--red,#dc2626);padding:12px;font-size:.8rem">Erro: ${esc(e.message)}</div>
      <button onclick="document.getElementById('dashCashflowDrill').style.display='none';document.getElementById('dashForecastChartWrap').style.display=''"
        style="margin-top:8px;padding:5px 12px;border:1px solid var(--border);border-radius:7px;background:var(--surface);cursor:pointer;font-size:.78rem">
        ← Voltar
      </button>`;
  }
}
window._dashCashflowDrill = _dashCashflowDrill;
// ─── Category chart: rich palette + click-to-drill ───────────────────────
// Stores raw transaction data so click handler can filter without re-fetching
let _catChartType    = 'bar'; // 'bar' | 'doughnut' — declared early to avoid TDZ
let _catChartMode    = 'expense'; // 'expense' | 'income' — declared early to avoid TDZ
let _catChartRawData = [];   // [{name, color, brl, t}]
let _catChartEntries = [];   // [{name, total, color, txs}]

// Extended 24-color palette — enough for all realistic category counts without repeats
const CAT_PALETTE = [
  '#2a6049','#1e5ba8','#b45309','#c0392b','#7c3aed',
  '#0891b2','#be185d','#15803d','#c2410c','#4338ca',
  '#0f766e','#9333ea','#b91c1c','#1d4ed8','#92400e',
  '#166534','#0369a1','#a16207','#9f1239','#1e40af',
  '#065f46','#6d28d9','#7f1d1d','#1e3a5f',
];

const GENERIC_COLORS = new Set(['#94a3b8','#888','#888888','#999','#999999']);

/**
 * Assign a distinct palette color to each slice.
 * Strategy: if the category has a meaningful custom color, use it only if no
 * earlier slice in the same chart already used that exact color. Otherwise
 * advance to the next available palette slot — guaranteeing no repeats.
 *
 * @param {string}   color   raw category color from DB
 * @param {number}   idx     position in the current chart (0-based)
 * @param {Set}      usedSet Set of colors already assigned in this chart pass
 */
function _catColor(color, idx, usedSet) {
  const isGeneric = !color || GENERIC_COLORS.has(color.toLowerCase());
  if (!isGeneric) {
    const c = color.toLowerCase();
    if (!usedSet || !usedSet.has(c)) {
      if (usedSet) usedSet.add(c);
      return color;
    }
  }
  // Advance through palette until we find an unused color
  let paletteIdx = idx;
  if (usedSet) {
    paletteIdx = 0;
    let checked = 0;
    while (checked < CAT_PALETTE.length) {
      const candidate = CAT_PALETTE[paletteIdx % CAT_PALETTE.length];
      if (!usedSet.has(candidate)) { usedSet.add(candidate); return candidate; }
      paletteIdx++; checked++;
    }
    // All palette colors used (>24 categories) — cycle with opacity variation
    const base = CAT_PALETTE[idx % CAT_PALETTE.length];
    usedSet.add(base + '_' + idx);
    return base;
  }
  return CAT_PALETTE[paletteIdx % CAT_PALETTE.length];
}

async function renderCategoryChart(){
  const now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,'0');
  const _txSelect = 'id,date,description,amount,brl_amount,currency,account_id,category_id,categories(id,name,color),payees(name),accounts!transactions_account_id_fkey(name)';
  const _lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const _dateGte = `${y}-${m}-01`, _dateLte = `${y}-${m}-${String(_lastDay).padStart(2,'0')}`;

  // Build expense query (amount < 0)
  const qExp = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte).lt('amount',0).not('category_id','is',null);
  // Build income query (amount > 0)
  const qInc = famQ(sb.from('transactions').select(_txSelect))
    .gte('date',_dateGte).lte('date',_dateLte).gt('amount',0).not('category_id','is',null);

  const [{data}, {data: dataInc}] = await Promise.all([qExp, qInc]);

  // Build parent lookup from state.categories (already loaded, has parent_id)
  const allCats = state.categories || [];
  const catById = Object.fromEntries(allCats.map(c => [c.id, c]));
  function _getRootCat(tx) {
    // Start from the category_id on the transaction (not the join, to avoid nested FK issues)
    const startId = tx.category_id;
    if (!startId) return { name: 'Outros', color: '', id: null };
    let cur = catById[startId];
    if (!cur) {
      // Fallback: use join data if state doesn't have it yet
      return { name: tx.categories?.name || 'Outros', color: tx.categories?.color || '', id: startId };
    }
    while (cur.parent_id && catById[cur.parent_id]) {
      cur = catById[cur.parent_id];
    }
    return { name: cur.name, color: cur.color || '', id: cur.id };
  }

  const catMap={};
  (data||[]).forEach(t=>{
    const root = _getRootCat(t);
    const n = root.name;
    const rawColor = root.color;
    if(!catMap[n]) catMap[n]={rawColor, txs:[], total:0, rootId: root.id};
    const brl = t.brl_amount != null ? Math.abs(t.brl_amount) : toBRL(Math.abs(t.amount), t.currency||'BRL');
    catMap[n].total+=brl;
    catMap[n].txs.push({...t, _brl: brl});
  });

  const _usedColors = new Set();
  _catChartEntries=Object.entries(catMap)
    .sort((a,b)=>b[1].total-a[1].total)
    .slice(0,8)
    .map(([name,v],i)=>({
      name,
      total: v.total,
      color: _catColor(v.rawColor, i, _usedColors),
      txs: v.txs.sort((a,b)=>b._brl-a._brl),
      rootId: v.rootId,
    }));

  // Build income category entries (same logic, positive amounts)
  const incMap = {};
  (dataInc||[]).forEach(t => {
    const root = _getRootCat(t);
    const n = root.name, rawColor = root.color;
    if (!incMap[n]) incMap[n] = {rawColor, txs:[], total:0, rootId:root.id};
    const brl = t.brl_amount != null ? Math.abs(t.brl_amount) : toBRL(Math.abs(t.amount), t.currency||'BRL');
    incMap[n].total += brl;
    incMap[n].txs.push({...t, _brl:brl});
  });
  const _incColors = new Set();
  window._catChartIncEntries = Object.entries(incMap)
    .sort((a,b)=>b[1].total-a[1].total).slice(0,8)
    .map(([name,v],i)=>({ name, total:v.total, color:_catColor(v.rawColor,i,_incColors), txs:v.txs.sort((a,b)=>b._brl-a._brl), rootId:v.rootId }));

  // Cache both for mode toggle
  window._catChartExpEntriesRaw = [..._catChartEntries];
  window._catChartIncEntriesRaw = [...(window._catChartIncEntries||[])];

  if(!_catChartEntries.length){
    const el=document.getElementById('categoryChart');
    if(el){const ctx=el.getContext('2d');ctx.clearRect(0,0,el.width,el.height);ctx.fillStyle='#8c8278';ctx.textAlign='center';ctx.font='13px Outfit';ctx.fillText(t('dash.empty_tx'),el.width/2,el.height/2);}
  }

  closeCatDetail(); // reset any open detail

  // Restore chart type from prefs
  const savedType = _dashGetPrefs()?.catChartType || 'bar';
  if (savedType !== _catChartType) {
    _catChartType = savedType;
    // sync toggle buttons
    const pie = document.getElementById('catChartTypePie');
    const bar = document.getElementById('catChartTypeBar');
    if (pie) { pie.classList.toggle('active', savedType === 'doughnut'); pie.style.background=''; pie.style.color=''; }
    if (bar) { bar.classList.toggle('active', savedType === 'bar');     bar.style.background=''; bar.style.color=''; }
  }

  if (_catChartType === 'bar') {
    _renderCatChartBar();
    return;
  }

  _renderCatChartDoughnut();
}

// ── Render helpers: Bar chart ────────────────────────────────────────────────
function _renderCatChartBar() {
  const entries = _catChartMode === 'income'
    ? (window._catChartIncEntries || [])
    : (_catChartEntries || []);
  if (!entries.length) return;

  const total = entries.reduce((s, e) => s + e.total, 0);
  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text2').trim() || '#3d3830';
  const mutedColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--muted').trim() || '#8c8278';

  _dashRenderChart('categoryChart', 'bar',
    entries.map(e => e.name),
    [{
      data: entries.map(e => e.total),
      backgroundColor: entries.map(e => e.color + 'cc'),
      hoverBackgroundColor: entries.map(e => e.color),
      borderColor: entries.map(e => e.color),
      borderWidth: 1,
      borderRadius: 6,
      borderSkipped: false,
    }],
    {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,20,15,.88)',
          titleColor: '#fff', bodyColor: 'rgba(255,255,255,.85)',
          borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
          padding: 10, cornerRadius: 8,
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.x;
              const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
              return ` R$ ${v.toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: 0})} (${pct}%)`;
            },
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        openCatDetail(elements[0].index);
      },
      onHover(evt, elements) { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,.05)', drawBorder: false },
          ticks: {
            font: { size: 10 }, color: mutedColor,
            callback(v) { return 'R$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v); },
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { size: 11 }, color: textColor,
            callback(v, i) {
              const name = entries[i]?.name || v;
              return name.length > 14 ? name.slice(0, 13) + '…' : name;
            },
          },
        },
      },
    }
  );
}

// ── Render helpers: Doughnut chart ───────────────────────────────────────────
function _renderCatChartDoughnut() {
  const entries = _catChartMode === 'income'
    ? (window._catChartIncEntries || [])
    : (_catChartEntries || []);
  if (!entries.length) return;

  const total = entries.reduce((s, e) => s + e.total, 0);

  _dashRenderChart('categoryChart', 'doughnut',
    entries.map(e => e.name),
    [{
      data: entries.map(e => e.total),
      backgroundColor: entries.map(e => e.color + 'cc'),
      hoverBackgroundColor: entries.map(e => e.color),
      borderColor: 'var(--surface)',
      borderWidth: 2,
      hoverOffset: 8,
    }],
    {
      cutout: '62%',
      plugins: {
        legend: {
          display: true, position: 'right',
          labels: {
            boxWidth: 10, boxHeight: 10, borderRadius: 3,
            usePointStyle: true, pointStyle: 'circle',
            font: { size: 11 },
            color: getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() || '#3d3830',
            padding: 10,
            generateLabels(chart) {
              return entries.map((e, i) => ({
                text: e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name,
                fillStyle: e.color + 'cc',
                strokeStyle: e.color,
                lineWidth: 1,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10,20,15,.88)',
          titleColor: '#fff', bodyColor: 'rgba(255,255,255,.85)',
          borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
          padding: 10, cornerRadius: 8,
          callbacks: {
            label(ctx) {
              const v = ctx.parsed;
              const pct = total > 0 ? (v / total * 100).toFixed(1) : '0.0';
              return ` R$ ${v.toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: 0})} · ${pct}%`;
            },
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        openCatDetail(elements[0].index);
      },
      onHover(evt, elements) { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
    }
  );
}

// ── Toggle: bar ↔ doughnut ───────────────────────────────────────────────────
function _setCatChartType(type) {
  _catChartType = type;
  const pie = document.getElementById('catChartTypePie');
  const bar = document.getElementById('catChartTypeBar');
  if (pie) pie.classList.toggle('active', type === 'doughnut');
  if (bar) bar.classList.toggle('active', type === 'bar');
  // Persist to prefs (non-blocking)
  _dashSavePrefs({ ..._dashGetPrefs(), catChartType: type }).catch(() => {});
  if (type === 'bar') _renderCatChartBar();
  else _renderCatChartDoughnut();
}
window._setCatChartType = _setCatChartType;

// ── Toggle: expense ↔ income ─────────────────────────────────────────────────
function _setDashCatMode(mode) {
  _catChartMode = mode;
  const expBtn = document.getElementById('dashCatModeExp');
  const incBtn = document.getElementById('dashCatModeInc');
  if (expBtn) expBtn.classList.toggle('active', mode === 'expense');
  if (incBtn) incBtn.classList.toggle('active', mode === 'income');
  const titleEl = document.getElementById('dashCatChartTitle');
  if (titleEl) {
    const svgInner = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>';
    titleEl.innerHTML = `${svgInner} ${mode === 'income' ? 'Distribuição por Categoria (Receitas)' : 'Distribuição por Categoria'}`;
  }
  closeCatDetail();
  if (_catChartType === 'bar') _renderCatChartBar();
  else _renderCatChartDoughnut();
}
window._setDashCatMode = _setDashCatMode;

function openCatDetail(idx) {
  const entry = _catChartEntries[idx];
  if (!entry) return;

  const detailEl   = document.getElementById('catChartDetail');
  const titleEl    = document.getElementById('catChartDetailTitle');
  const listEl     = document.getElementById('catChartDetailList');
  const backBtn    = document.getElementById('catDetailBackBtn');
  const wrap       = document.getElementById('catChartWrap');
  const chartControls = document.getElementById('dashCatControls');
  const typeToggle    = document.querySelector('#catChartCard > div:last-child');

  if (!detailEl || !titleEl || !listEl) return;

  // Hide chart + mode controls, show back button + transaction list
  if (wrap)          wrap.style.display = 'none';
  if (chartControls) chartControls.style.display = 'none';
  if (typeToggle && typeToggle.querySelector('.dash-pill-toggle')) typeToggle.style.display = 'none';
  if (backBtn)       backBtn.style.display = 'flex';
  detailEl.style.display = '';

  const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${entry.color};flex-shrink:0"></span>`;
  titleEl.innerHTML = `${dot}<strong>${esc(entry.name)}</strong><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">${fmt(entry.total)}</span><span style="color:var(--muted);font-weight:400;font-size:.72rem;margin-left:4px">· ${entry.txs.length} lançamento${entry.txs.length!==1?'s':''}`;

  // "Ver transações" button — navigates to transactions page with category pre-filtered
  const now2 = new Date();
  const ym = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,'0')}`;
  titleEl.innerHTML += `&nbsp;<button onclick="_dashDrillToTx('${entry.rootId||''}','${ym}')" style="font-size:.68rem;padding:2px 7px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--accent);cursor:pointer;font-weight:600;margin-left:6px">${t('dash.view_all')}</button>`;

  const MON=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  listEl.innerHTML = entry.txs.map(t => {
    const d = t.date ? new Date(t.date+'T12:00:00') : new Date();
    const dateStr = `${d.getDate()} ${MON[d.getMonth()]}`;
    const acctName = t.accounts?.name || '';
    const payeeName = t.payees?.name || '';
    const meta = [acctName, payeeName].filter(Boolean).join(' · ');
    return `<div onclick="openTxDetail('${t.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s;border-radius:3px" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''">
      <div style="min-width:0;flex:1">
        <div style="font-size:.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.description||'—')}</div>
        <div style="font-size:.7rem;color:var(--muted)">${dateStr}${meta?' · '+esc(meta):''}</div>
      </div>
      <span style="font-size:.85rem;font-weight:700;color:var(--red);flex-shrink:0;margin-left:10px">${fmt(t._brl)}</span>
    </div>`;
  }).join('');

  // Highlight the selected arc
  const chart = state.chartInstances['categoryChart'];
  if (chart) {
    chart.data.datasets[0].backgroundColor = _catChartEntries.map((e,i) =>
      i === idx ? e.color : e.color + '44'
    );
    chart.update();
  }
}

function closeCatDetail() {
  const detailEl    = document.getElementById('catChartDetail');
  const backBtn     = document.getElementById('catDetailBackBtn');
  const wrap        = document.getElementById('catChartWrap');
  const chartControls = document.getElementById('dashCatControls');
  const typeToggle    = document.querySelector('#catChartCard > div:last-child');

  if (detailEl)       detailEl.style.display = 'none';
  if (backBtn)        backBtn.style.display  = 'none';
  if (wrap)           wrap.style.display = '';
  if (chartControls)  chartControls.style.display = '';
  if (typeToggle && typeToggle.querySelector('.dash-pill-toggle')) typeToggle.style.display = '';

  // Restore chart colors
  const chart = state.chartInstances['categoryChart'];
  if (chart && _catChartEntries.length) {
    chart.data.datasets[0].backgroundColor = _catChartEntries.map(e => e.color);
    chart.update();
  }
}
/* ═══════════════════════════════════════════════════════════════
   REPORTS — state, filters, data, export
═══════════════════════════════════════════════════════════════ */


// Daily summary: how many scheduled auto-registrations ran today
async function loadDashboardAutoRunSummary(){
  const el = document.getElementById('dashAutoRunSummary');
  if(!el || !sb) return;
  try{
    const today = new Date().toISOString().slice(0,10);
    const q = famQ(sb.from('scheduled_run_logs').select('id',{count:'exact', head:true}))
      .eq('scheduled_date', today);
    const { count, error } = await q;
    if(error) throw error;
    const n = count || 0;
    if(n>0){
      el.style.display='';
      el.textContent = `📌 Hoje: ${n} programada${n!==1?'s':''} auto-registrada${n!==1?'s':''}`;
      const isAdmin = (typeof currentUser!=='undefined') && (currentUser?.role==='admin' || currentUser?.role==='owner' || currentUser?.can_admin);
      if(!isAdmin){ el.style.cursor='default'; el.onclick=null; }
    } else {
      el.style.display='none';
    }
  }catch(e){
    // table may not exist; hide silently
    el.style.display='none';
  }
}



// ════════════════════════════════════════════════════════════════
// Dashboard: sistema de customização por usuário
// ════════════════════════════════════════════════════════════════

const _DASH_PREFS_KEY = () =>
  `dash_prefs_${typeof currentUser !== 'undefined' && currentUser?.id ? currentUser.id : 'default'}`;

const _DASH_CARDS = [
  { id: 'accounts',     label: 'Saldo por Conta',           icon: '🏦', sub: 'Saldo atual de cada conta',                 el: 'dashCardAccounts'     },
  { id: 'charts',       label: 'Fluxo de Caixa e Gráficos', icon: '📊', sub: 'Cashflow 6 meses + gráfico de despesas',    el: 'dashCardCharts'       },
  { id: 'favcats',      label: 'Categorias Favoritas',      icon: '⭐', sub: 'Evolução das categorias marcadas',          el: 'dashCardFavCats'      },
  { id: 'upcoming',     label: 'Próximas Transações',       icon: '📆', sub: 'Programadas para os próximos 10 dias',      el: 'dashCardUpcoming'     },
  { id: 'forecast90',   label: 'Previsão 90 dias',          icon: '📈', sub: 'Projeção de saldo para os próximos 90 dias',el: 'dashCardForecast90'   },
  { id: 'recent',       label: 'Últimas Transações',        icon: '🧾', sub: 'Histórico recente de lançamentos',          el: 'dashCardRecent'       },
  { id: 'budgets',      label: 'Orçamentos do Mês',         icon: '🎯', sub: 'Progresso dos orçamentos mensais',          el: 'dashCardBudgets',     optional: true },
  { id: 'investments',  label: 'Carteira de Investimentos', icon: '📈', sub: 'Resumo e distribuição da carteira',         el: 'dashCardInvestments', optional: true },
  { id: 'dreams',       label: 'Meus Sonhos',               icon: '🌟', sub: 'Progresso dos seus sonhos financeiros',     el: 'dashCardDreams',      optional: true },
  { id: 'toppayees',    label: 'Top Beneficiários',         icon: '🏪', sub: 'Quem mais recebe seus pagamentos',          el: 'dashCardTopPayees',   optional: true },
];

function _dashGetPrefs() {
  try {
    const raw = localStorage.getItem(_DASH_PREFS_KEY());
    if (raw) return JSON.parse(raw);
  } catch (_e) {}
  // Defaults: mandatory cards on, optional cards off (user activates via ⚙️)
  return Object.fromEntries(_DASH_CARDS.map(c => [c.id, !c.optional]));
}

async function _dashSavePrefs(prefs) {
  const key = _DASH_PREFS_KEY();
  try { localStorage.setItem(key, JSON.stringify(prefs)); } catch (_e) {}
  if (typeof sb === 'undefined' || !sb) return;
  try {
    const { error } = await sb.from('app_settings')
      .upsert({ key, value: prefs }, { onConflict: 'key' });
    if (error) console.warn('[dashPrefs] save error:', error.message);
  } catch (e) { console.warn('[dashPrefs] save exception:', e.message); }
}

async function _syncDashPrefsFromServer() {
  if (typeof sb === 'undefined' || !sb) return;
  const key = _DASH_PREFS_KEY();
  if (key.endsWith('_default')) return; // usuário não logado ainda
  try {
    const { data, error } = await sb.from('app_settings')
      .select('value').eq('key', key).maybeSingle();
    if (error) { console.warn('[dashPrefs] sync error:', error.message); return; }
    if (data?.value && typeof data.value === 'object') {
      _dashSavePrefs(data.value);
      _dashApplyPrefs(data.value);
      _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
    }
  } catch (e) { console.warn('[dashPrefs] sync exception:', e.message); }
}

function _dashApplyPrefs(prefs) {
  const order = _getDashCardOrder(prefs);
  // Apply visibility
  order.forEach(c => {
    const el = document.getElementById(c.el);
    if (!el) return;
    el.style.display = prefs[c.id] !== false ? '' : 'none';
  });
  // Apply order in DOM on all screen sizes
  try {
    const parent = document.getElementById(order[0]?.el)?.parentElement;
    if (parent) {
      order.forEach(c => {
        const el = document.getElementById(c.el);
        if (el && el.parentElement === parent) parent.appendChild(el);
      });
    }
  } catch(_) {}
}

function openDashCustomModal() {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder(prefs);
  const list  = document.getElementById('dashCustomList');
  if (!list) return;
  _renderDashCustomList(order, prefs);
  openModal('dashCustomModal');
}

function _getDashCardOrder(prefs) {
  // Use saved order from prefs, fallback to _DASH_CARDS default order
  const savedOrder = prefs._order;
  if (savedOrder && Array.isArray(savedOrder)) {
    const ordered = savedOrder
      .map(id => _DASH_CARDS.find(c => c.id === id))
      .filter(Boolean);
    // Append any new cards not in saved order
    _DASH_CARDS.forEach(c => { if (!ordered.find(x => x.id === c.id)) ordered.push(c); });
    return ordered;
  }
  return [..._DASH_CARDS];
}

function _renderDashCustomList(order, prefs) {
  const list = document.getElementById('dashCustomList');
  if (!list) return;

  list.innerHTML = order.map((c, idx) => `
    <div class="dcc-item" data-card-id="${c.id}" draggable="true">
      <div class="dcc-handle" title="Arrastar para reordenar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6"  x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </div>
      <span class="dcc-icon">${c.icon}</span>
      <div class="dcc-info">
        <div class="dcc-label">${c.label}</div>
        <div class="dcc-sub">${c.sub}</div>
        ${c.optional ? '<span class="dcc-badge">opcional</span>' : ''}
      </div>
      <div class="dcc-arrows">
        <button class="dcc-arrow-btn" onclick="event.stopPropagation();_dashMoveCard('${c.id}',-1)"
          title="Mover para cima" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="dcc-arrow-btn" onclick="event.stopPropagation();_dashMoveCard('${c.id}',1)"
          title="Mover para baixo" ${idx === order.length-1 ? 'disabled' : ''}>▼</button>
      </div>
      <button class="dcc-toggle ${prefs[c.id]!==false?'dcc-on':''}" data-card="${c.id}"
        onclick="event.stopPropagation();_dashToggleCard('${c.id}',this.closest('.dcc-item'))"
        title="${prefs[c.id]!==false?'Ocultar card':'Mostrar card'}">
        <span class="dcc-toggle-knob"></span>
      </button>
    </div>`).join('');

  _initDashDrag(list);
}

function _initDashDrag(list) {
  // ── Suporte a Mouse (HTML5 DnD) ──────────────────────────────────────────
  let dragSrc = null;

  list.querySelectorAll('.dcc-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragSrc = item;
      item.classList.add('dcc-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.cardId);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dcc-dragging');
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      _dashCustomPendingOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item !== dragSrc) {
        list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
        item.classList.add('dcc-over');
      }
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (dragSrc && item !== dragSrc) {
        const allItems = [...list.querySelectorAll('.dcc-item')];
        const srcIdx  = allItems.indexOf(dragSrc);
        const tgtIdx  = allItems.indexOf(item);
        if (srcIdx < tgtIdx) item.after(dragSrc);
        else item.before(dragSrc);
        _dashCustomPendingOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
      }
    });
  });

  // ── Suporte a Touch (iOS Safari + Android) ──────────────────────────────
  // HTML5 DnD não funciona em touch — implementar via touchstart/touchmove/touchend
  let touchSrc    = null;
  let touchClone  = null;
  let touchStartY = 0;
  let touchOffY   = 0;

  function _getItemAtY(y) {
    // Encontrar o dcc-item sob a coordenada Y ignorando o clone
    const items = [...list.querySelectorAll('.dcc-item:not(.dcc-dragging)')];
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return it;
    }
    return null;
  }

  // Detecção de eixo para não bloquear scroll vertical até confirmar drag
  let _dccTouchStartX = 0;
  let _dccAxis        = null; // null | 'drag' | 'scroll'
  const DRAG_THRESHOLD = 6; // px de movimento vertical para confirmar drag

  list.querySelectorAll('.dcc-item').forEach(item => {
    item.addEventListener('touchstart', e => {
      // Só iniciar drag se o toque for no handle ou no item fora do toggle
      const tog = e.target.closest('.dcc-toggle');
      if (tog) return;

      // Registrar ponto de início — ainda NÃO chamar preventDefault
      // (seria passive:false desnecessário que bloqueia scroll imediatamente)
      touchSrc     = item;
      touchStartY  = e.touches[0].clientY;
      _dccTouchStartX = e.touches[0].clientX;
      _dccAxis     = null; // aguardar confirmação de eixo

      const rect = item.getBoundingClientRect();
      touchOffY  = touchStartY - rect.top;
    }, { passive: true }); // passive:true — não bloquear scroll no touchstart

    item.addEventListener('touchmove', e => {
      if (!touchSrc) return;

      const t  = e.touches[0];
      const dy = Math.abs(t.clientY - touchStartY);
      const dx = Math.abs(t.clientX - _dccTouchStartX);

      // Fase de detecção de eixo
      if (_dccAxis === null) {
        if (dy < DRAG_THRESHOLD && dx < DRAG_THRESHOLD) return; // aguardar
        // Movimento horizontal dominante = scroll lateral (não é drag de reorder)
        // Movimento vertical dominante = drag de reorder
        _dccAxis = dy >= dx ? 'drag' : 'scroll';
      }

      // Eixo scroll → abandonar, deixar scroll livre
      if (_dccAxis === 'scroll') {
        touchSrc = null; _dccAxis = null;
        return;
      }

      // Eixo drag confirmado — agora sim bloquear scroll e criar clone
      e.preventDefault();

      if (!touchClone) {
        // Criar clone apenas quando drag é confirmado (primeira vez aqui)
        const rect = item.getBoundingClientRect();
        touchClone = item.cloneNode(true);
        touchClone.style.cssText = [
          'position:fixed',
          'z-index:9999',
          'pointer-events:none',
          'left:' + rect.left + 'px',
          'width:' + rect.width + 'px',
          'top:'  + (touchStartY - touchOffY) + 'px',
          'opacity:.85',
          'box-shadow:0 8px 28px rgba(0,0,0,.22)',
          'border-radius:10px',
          'transform:scale(1.02)',
          'transition:none',
        ].join(';');
        document.body.appendChild(touchClone);
        item.classList.add('dcc-dragging');
      }

      const y = t.clientY;
      touchClone.style.top = (y - touchOffY) + 'px';

      // Highlight do item alvo
      const over = _getItemAtY(y);
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      if (over && over !== touchSrc) over.classList.add('dcc-over');

    }, { passive: false }); // passive:false necessário para preventDefault no drag

    item.addEventListener('touchend', e => {
      if (!touchSrc) return;

      // Remover clone se foi criado
      if (touchClone) { touchClone.remove(); touchClone = null; }

      // Só reordenar se drag foi de facto confirmado (clone chegou a existir)
      if (_dccAxis === 'drag') {
        const y = e.changedTouches[0].clientY;
        const over = _getItemAtY(y);
        if (over && over !== touchSrc) {
          const allItems = [...list.querySelectorAll('.dcc-item')];
          const srcIdx = allItems.indexOf(touchSrc);
          const tgtIdx = allItems.indexOf(over);
          if (srcIdx < tgtIdx) over.after(touchSrc);
          else over.before(touchSrc);
        }
        _dashCustomPendingOrder = [...list.querySelectorAll('.dcc-item')].map(i => i.dataset.cardId);
      }

      touchSrc.classList.remove('dcc-dragging');
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      touchSrc = null; _dccAxis = null;
    });

    item.addEventListener('touchcancel', () => {
      if (touchClone) { touchClone.remove(); touchClone = null; }
      if (touchSrc)   { touchSrc.classList.remove('dcc-dragging'); touchSrc = null; }
      list.querySelectorAll('.dcc-item').forEach(i => i.classList.remove('dcc-over'));
      _dccAxis = null;
    });
  });
}

function _dashMoveCard(id, dir) {
  const prefs = _dashGetPrefs();
  const order = _getDashCardOrder(prefs);
  const idx   = order.findIndex(c => c.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  // Temporarily store new order and re-render the list
  _dashCustomPendingOrder = order.map(c => c.id);
  const updPrefs = {...prefs, _order: _dashCustomPendingOrder};
  _renderDashCustomList(order, updPrefs);
}
let _dashCustomPendingOrder = null;

function _dashToggleCard(id, row) {
  const btn = row?.querySelector('.dcc-toggle');
  if (!btn) return;
  const isOn = btn.classList.toggle('dcc-on');
  btn.title = isOn ? 'Ocultar card' : 'Mostrar card';
}

function _dashCustomSave() {
  // Start from existing prefs so we don't lose catChartType, dashForecastAccounts, etc.
  const existingPrefs = _dashGetPrefs();
  const prefs = { ...existingPrefs };
  _DASH_CARDS.forEach(c => {
    const btn = document.querySelector(`.dcc-toggle[data-card="${c.id}"]`);
    prefs[c.id] = btn ? btn.classList.contains('dcc-on') : !c.optional;
  });
  // Save card order if user reordered
  if (_dashCustomPendingOrder) {
    prefs._order = _dashCustomPendingOrder;
    _dashCustomPendingOrder = null;
  }
  _dashSavePrefs(prefs);
  _dashApplyPrefs(prefs);
  if (prefs.favcats !== false) _renderDashFavCategories(_lastDashIncome, _lastDashExpense);
  // Reload optional cards that were just switched ON (content would still say "Carregando…")
  // Treat undefined as the card's default: optional=false, mandatory=true
  const _wasOff = (id, optional) => { const v = existingPrefs[id]; return v === false || (v === undefined && optional); };
  if (prefs.budgets     !== false && _wasOff('budgets',     true))  _loadDashBudgetsCard().catch(()=>{});
  if (prefs.investments !== false && _wasOff('investments', true))  _loadDashInvestmentsCard().catch(()=>{});
  if (prefs.dreams      !== false && _wasOff('dreams',      true))  _loadDashDreamsCard().catch(()=>{});
  if (prefs.toppayees   !== false && _wasOff('toppayees',   false)) _loadDashTopPayeesCard().catch(()=>{});
  if (prefs.forecast90  !== false && _wasOff('forecast90',  false)) _renderDashForecast().catch(()=>{});
  closeModal('dashCustomModal');
  toast('Preferências do dashboard salvas!', 'success');
}

// Guardar últimos valores de income/expense para re-render após customização
let _lastDashIncome = 0, _lastDashExpense = 0;

// ════════════════════════════════════════════════════════════════
// _renderDashFavCategories — redesenhada
// ════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// Dashboard: categorias favoritas — redesign completo
// ══════════════════════════════════════════════════════════════════
async function _renderDashFavCategories(totalIncome, totalExpense) {
  _lastDashIncome  = totalIncome  != null ? totalIncome  : _lastDashIncome;
  _lastDashExpense = totalExpense != null ? totalExpense : _lastDashExpense;

  const prefs = _dashGetPrefs();
  _dashApplyPrefs(prefs);

  const el = document.getElementById('dashFavCategories');
  if (!el) return;
  if (prefs.favcats === false) return;

  const ids = typeof _loadCatFavorites === 'function' ? _loadCatFavorites() : [];

  // Estado vazio — sem favoritos configurados
  if (!ids.length) {
    el.innerHTML = `
      <div class="dfav-card">
        <div class="dfav-header">
          <span class="dfav-title">⭐ Categorias Favoritas</span>
          <button class="dfav-manage" onclick="navigate('categories')">+ Adicionar</button>
        </div>
        <div class="dfav-empty">
          <div style="font-size:1.6rem;margin-bottom:8px">⭐</div>
          <div style="font-weight:600;margin-bottom:4px">Nenhuma categoria favorita</div>
          <div style="font-size:.75rem;color:var(--muted)">Vá em Categorias e marque com ★ as que deseja acompanhar aqui.</div>
          <button onclick="navigate('categories')" class="btn btn-primary btn-sm" style="margin-top:12px;font-size:.78rem">
            Gerenciar Categorias
          </button>
        </div>
      </div>`;
    return;
  }

  const allCats = state.categories || [];
  const favCats = allCats.filter(c => ids.includes(c.id));
  if (!favCats.length) {
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">${t('dash.manage')}</button></div><div class="dfav-empty"><div>Categorias favoritas não encontradas.<br><span style="font-size:.75rem">Elas podem ter sido excluídas.</span></div></div></div>`;
    return;
  }

  const now  = new Date(), y = now.getFullYear(), mo = String(now.getMonth()+1).padStart(2,'0');
  const from = `${y}-${mo}-01`;
  const to   = `${y}-${mo}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;
  const monthLabel = now.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

  // Índice de transações confirmadas do mês por category_id
  const txsByCat = {};
  try {
    let q = famQ(sb.from('transactions').select('category_id,date,amount,brl_amount,currency,is_transfer,status,family_member_id'))
      .gte('date', from)
      .lte('date', to)
      .eq('status', 'confirmed');
    const memberIds = _getDashMemberIds();
    if (memberIds && memberIds.length > 0) q = q.in('family_member_id', memberIds);
    else if (memberIds && memberIds.length === 0) q = null;
    const { data: monthTx = [] } = q ? await q : { data: [] };
    monthTx.forEach(t => {
      const txDate = String(t.date || '').slice(0,10);
      if (!t.category_id || t.is_transfer || txDate < from || txDate > to) return;
      if (!txsByCat[t.category_id]) txsByCat[t.category_id] = [];
      txsByCat[t.category_id].push(t);
    });
  } catch (e) {
    console.warn('[dash favcats monthTx]', e?.message || e);
  }

  const sumBrl = txs => txs.reduce((acc, t) => {
    const v = typeof txToBRL === 'function' ? txToBRL(t) : parseFloat(t.brl_amount ?? t.amount) ?? 0;
    return acc + v;
  }, 0);

  // Inferir tipo pela categoria (DB) ou pelo sinal das transações
  const inferType = c => {
    const rawType = String(c?.type || '').toLowerCase();
    if (['receita','income','ganho','entrada'].includes(rawType)) return 'income';
    if (['despesa','expense','gasto','saida','saída'].includes(rawType)) return 'expense';
    const txs = txsByCat[c.id] || [];
    return txs.length ? (sumBrl(txs) >= 0 ? 'income' : 'expense') : 'expense';
  };

  // Construir linha individual
  const renderRow = (c, isChild, isCtxOnly, isLast) => {
    const ownTxs = txsByCat[c.id] || [];
    const ownVal = sumBrl(ownTxs);
    const cType  = inferType(c);
    const base   = cType === 'expense' ? _lastDashExpense : _lastDashIncome;
    const pct    = base > 0 ? Math.abs(ownVal) / base * 100 : 0;
    const barW   = Math.min(pct, 100).toFixed(1);
    const barClr = cType === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)';
    const valClr = ownVal === 0 ? 'var(--muted)' : (cType === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)');
    const valStr = ownVal === 0 ? '—' : (ownVal > 0 ? '+' : '') + fmt(ownVal, 'BRL');
    const pctStr = pct >= 0.1 ? pct.toFixed(1) + '%' : (pct > 0 ? '<0.1%' : '—');
    // Drill to exact transactions by category + current month
    const navAction = `onclick="_dashDrillToTx('${c.id}','${y}-${mo}')"`;  

    // Linha de contexto (pai não-favorito, só para hierarquia)
    if (isCtxOnly) {
      return `<div class="dfav-row dfav-row--ctx">
        <span class="dfav-icon">${c.icon||'📦'}</span>
        <span class="dfav-name dfav-name--ctx">${esc(c.name)}</span>
        ${ownVal !== 0 ? `<span class="dfav-val dfav-val--muted">${fmt(Math.abs(ownVal),'BRL')}</span>` : ''}
      </div>`;
    }

    const rowClass  = isChild ? 'dfav-row dfav-row--child' : 'dfav-row';
    const nameClass = isChild ? 'dfav-name dfav-name--child' : 'dfav-name';
    const connector = isChild
      ? `<span class="dfav-conn${isLast?' dfav-conn--last':''}"></span>` : '';

    return `<div class="${rowClass}" style="cursor:pointer" ${navAction} title="Ver transações">
        ${connector}
        <span class="dfav-icon${isChild?' dfav-icon--sm':''}">${c.icon||'📦'}</span>
        <div class="dfav-body">
          <div class="dfav-row-top">
            <span class="${nameClass}">${esc(c.name)}</span>
            <span class="dfav-val" style="color:${valClr}">${valStr}</span>
          </div>
          ${pct > 0 ? `<div class="dfav-bar-row">
            <div class="dfav-bar-bg">
              <div class="dfav-bar-fill" style="width:${barW}%;background:${barClr}"></div>
            </div>
            <span class="dfav-pct" style="color:${valClr}">${pctStr}</span>
          </div>` : `<div class="dfav-bar-row"><div class="dfav-bar-bg"></div><span class="dfav-pct">—</span></div>`}
        </div>
      </div>`;
  };

  // Construir seção (Despesas ou Receitas)
  const buildSection = (label, typeKey, secColor) => {
    const parentFavs = favCats.filter(c => !c.parent_id && inferType(c) === typeKey);

    // Pais NÃO favoritos que têm subcats favoritas
    const nfParents = [];
    allCats.filter(p => !p.parent_id && !ids.includes(p.id)).forEach(p => {
      const subs = allCats.filter(c => c.parent_id === p.id && ids.includes(c.id) && inferType(c) === typeKey);
      if (subs.length) nfParents.push({ p, subs });
    });

    // Marcar subcats já cobertas por pais acima
    const covered = new Set();
    parentFavs.forEach(p =>
      allCats.filter(c => c.parent_id === p.id && ids.includes(c.id)).forEach(c => covered.add(c.id)));
    nfParents.forEach(({ subs }) => subs.forEach(c => covered.add(c.id)));

    // Subcats favoritas sem pai visível
    const orphans = favCats.filter(c => c.parent_id && inferType(c) === typeKey && !covered.has(c.id));

    const rows = [];

    parentFavs.forEach(p => {
      rows.push(renderRow(p, false, false, false));
      const subs = allCats.filter(c => c.parent_id === p.id && ids.includes(c.id) && inferType(c) === typeKey);
      subs.forEach((sub, si) => rows.push(renderRow(sub, true, false, si === subs.length - 1)));
    });

    nfParents.forEach(({ p, subs }) => {
      rows.push(renderRow(p, false, true, false));
      subs.forEach((sub, si) => rows.push(renderRow(sub, true, false, si === subs.length - 1)));
    });

    orphans.forEach(c => rows.push(renderRow(c, false, false, false)));

    if (!rows.length) return '';

    // KPI da seção: total de todas as categorias favoritas deste tipo, sem duplicar
    const favIdsOfType = new Set(
      favCats.filter(c => inferType(c) === typeKey).map(c => c.id)
    );
    const sectionTotal = Array.from(favIdsOfType)
      .reduce((acc, id) => acc + sumBrl(txsByCat[id] || []), 0);
    const base = typeKey === 'expense' ? _lastDashExpense : _lastDashIncome;
    const secPct = base > 0 ? Math.abs(sectionTotal) / base * 100 : 0;

    return `<div class="dfav-section">
      <div class="dfav-section-hdr" style="border-left:3px solid ${secColor}">
        <span class="dfav-section-label" style="color:${secColor}">${label}</span>
        <span class="dfav-section-total" style="color:${valClrFromType(typeKey, sectionTotal)}">${sectionTotal===0?'—':(sectionTotal>0?'+':'')+fmt(sectionTotal,'BRL')}</span>
        ${secPct >= 0.1 ? `<span class="dfav-section-pct">${secPct.toFixed(1)}% do total</span>` : ''}
      </div>
      ${rows.join('')}
    </div>`;
  };

  const valClrFromType = (t, v) => v === 0 ? 'var(--muted)' : (t === 'expense' ? 'var(--red,#dc2626)' : 'var(--green,#16a34a)');

  const expSec = buildSection('Despesas', 'expense', 'var(--red,#dc2626)');
  const incSec = buildSection('Receitas', 'income',  'var(--green,#16a34a)');

  if (!expSec && !incSec) {
    el.innerHTML = `<div class="dfav-card"><div class="dfav-header"><span class="dfav-title">⭐ Categorias Favoritas</span><button class="dfav-manage" onclick="navigate('categories')">${t('dash.manage')}</button></div><div class="dfav-empty">Sem movimentações no mês para as categorias favoritas.</div></div>`;
    return;
  }

  el.innerHTML = `<div class="dfav-card">
    <div class="dfav-header">
      <div>
        <span class="dfav-title">⭐ Categorias Favoritas</span>
        <span class="dfav-subtitle">${monthLabel}</span>
      </div>
      <button class="dfav-manage" onclick="navigate('categories')" title="Gerenciar favoritas">★ Gerenciar</button>
    </div>
    <div class="dfav-body-wrap">
      ${expSec}
      ${expSec && incSec ? '<div class="dfav-divider"></div>' : ''}
      ${incSec}
    </div>
  </div>`;
}


async function renderDashboardUpcoming(memberIds = null) {
  const prefs = _dashGetPrefs();
  _dashApplyPrefs(prefs);
  const listEl = document.getElementById('dashUpcomingList');
  const cardEl = document.getElementById('dashCardUpcoming');
  if (!listEl || !cardEl) return;
  if (prefs.upcoming === false) return;

  if (!state.scheduled || !state.scheduled.length) {
    try { if (typeof loadScheduled === 'function') await loadScheduled(); } catch(e) { console.warn('[dash upcoming loadScheduled]', e?.message || e); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date();
  limit.setDate(limit.getDate() + 10);
  const limitStr = limit.toISOString().slice(0, 10);

  const memberSet = Array.isArray(memberIds) && memberIds.length ? new Set(memberIds) : null;
  const upcoming = [];

  const pushOccurrence = (sc, date, isPending=false) => {
    const scheduledMemberIds = [];
    if (sc.family_member_id) scheduledMemberIds.push(sc.family_member_id);
    if (Array.isArray(sc.family_member_ids)) scheduledMemberIds.push(...sc.family_member_ids.filter(Boolean));
    const uniqueMembers = [...new Set(scheduledMemberIds)];
    if (memberSet && uniqueMembers.length && !uniqueMembers.some(id => memberSet.has(id))) return;
    if (memberSet && uniqueMembers.length === 0) return;
    upcoming.push({ sc, date, isPending });
  };

  (state.scheduled || []).forEach(sc => {
    if (sc.status === 'paused') return;
    const pendingDates = new Set(
      (sc.occurrences || [])
        .filter(o => (o.execution_status === 'pending' || o.execution_status === 'skipped') && o.scheduled_date >= today && o.scheduled_date <= limitStr)
        .map(o => o.scheduled_date)
    );
    const executedDates = new Set(
      (sc.occurrences || [])
        .filter(o => o.execution_status === 'executed' || o.execution_status === 'processing')
        .map(o => o.scheduled_date)
    );

    let cur = sc.start_date;
    let count = 0;
    const maxCount = sc.end_count || 999;
    const endDate = sc.end_date || '2099-12-31';
    while (cur && cur <= limitStr && count < maxCount && cur <= endDate) {
      if (cur >= today && !executedDates.has(cur)) pushOccurrence(sc, cur, pendingDates.has(cur));
      count++;
      if (sc.frequency === 'once') break;
      cur = nextDate(cur, sc.frequency, sc.custom_interval, sc.custom_unit);
      if (!cur) break;
    }
    pendingDates.forEach(date => {
      if (date >= today && date <= limitStr && !executedDates.has(date) && !upcoming.some(x => x.sc.id === sc.id && x.date === date)) {
        pushOccurrence(sc, date, true);
      }
    });
  });

  upcoming.sort((a,b) => a.date.localeCompare(b.date) || String(a.sc.description||'').localeCompare(String(b.sc.description||'')));

  if (!upcoming.length) {
    listEl.innerHTML = '<div class="text-muted" style="text-align:center;padding:18px;font-size:.83rem">Sem programações para os próximos 10 dias.</div>';
    return;
  }

  const byDate = {};
  upcoming.forEach(u => { (byDate[u.date] ||= []).push(u); });
  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = tomorrow.toISOString().slice(0,10);

  listEl.innerHTML = Object.entries(byDate).map(([date, items]) => {
    const isToday = date === today;
    const isTomorrow = date === tomorrowStr;
    const dow = DOW[new Date(date+'T12:00:00').getDay()];
    const dayTot = items.reduce((s,{sc}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      return s + (isExp ? -1 : 1) * Math.abs(Number(sc.amount) || 0);
    }, 0);
    const rows = items.map(({sc,isPending}) => {
      const isExp = sc.type==='expense'||sc.type==='card_payment'||sc.type==='transfer';
      const typeIcon = sc.type==='card_payment' ? '💳' : sc.type==='transfer' ? '↔' : isExp ? '↑' : '↓';
      const dest = (sc.type==='transfer'||sc.type==='card_payment') ? (state.accounts || []).find(a => a.id === sc.transfer_to_account_id) : null;
      const catColor = sc.categories?.color || (isExp ? 'var(--red)' : 'var(--green)');
      const manualBadge = !sc.auto_register ? '<span class="sup-manual-badge">Manual</span>' : '';
      const pendingBadge = isPending ? '<span class="sup-pending-badge" title="Aguardando registro">⚠ Pendente</span>' : '';
      return `<div class="sup-item${isToday?' sup-item--today':''}">
        <div class="sup-icon" style="background:color-mix(in srgb,${catColor} 14%,transparent);color:${catColor}">${typeIcon}</div>
        <div class="sup-body">
          <div class="sup-desc">${esc(sc.description)}${manualBadge}${pendingBadge}</div>
          <div class="sup-acct">${esc(sc.accounts?.name||'—')}${dest?` <span class="sup-arrow">→</span> ${esc(dest.name)}`:''}</div>
        </div>
        <div class="sup-right">
          <span class="sup-amt ${isExp?'neg':'pos'}">${isExp?'−':'+'}${fmt(Math.abs(Number(sc.amount)||0))}</span>
          <div class="sup-actions">
            <button class="sup-ignore-btn" title="Ignorar" onclick="event.stopPropagation();ignoreOccurrence('${sc.id}','${date}')">✕</button>
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

    const groupId = 'supGroup-' + date;
    const isCollapsed = !isToday && !isTomorrow; // today/tomorrow expanded by default
    return `<div class="sup-group">
      <div class="sup-group-hdr" onclick="toggleSupGroup('${date}')" style="cursor:pointer;user-select:none">
        <div class="sup-group-left">
          ${dayPill}
          <span class="sup-group-dow">${dow}</span>
        </div>
        <div class="sup-group-meta">
          <span class="sup-day-total ${dayTot>=0?'pos':'neg'}">${dayTot>=0?'+':''}${fmt(dayTot)}</span>
          <span class="sup-day-count">${items.length}</span>
          <span class="sup-group-toggle" id="supArrow-${date}" style="font-size:.7rem;color:var(--muted);transition:transform .2s;display:inline-block;transform:rotate(${isCollapsed?'-90deg':'0deg'})">▾</span>
        </div>
      </div>
      <div class="sup-rows" id="${groupId}" style="overflow:hidden;transition:max-height .22s ease;max-height:${isCollapsed?'0':'2000px'}">${rows}</div>
    </div>`;
  }).join('');
}

// Navigate to transactions page with category + month pre-filtered
// ── Favorite account info modal ───────────────────────────────────────────
function _openFavAccountModal(accountId) {
  const a = (state.accounts || []).find(x => x.id === accountId);
  if (!a) { toast('Conta não encontrada', 'error'); return; }

  const typeLabel  = (typeof accountTypeLabel === 'function' ? accountTypeLabel(a.type) : '') || a.type || '';
  const balColor   = (parseFloat(a.balance)||0) < 0 ? 'var(--red,#dc2626)' : 'var(--accent)';
  const color      = a.color || '#2a6049';

  // Bank / card info lines
  const bankInfo  = [
    a.bank_name,
    a.bank_code   && `Cód. ${a.bank_code}`,
    a.agency      && `Ag. ${a.agency}`,
    a.account_number && `CC ${a.account_number}`,
  ].filter(Boolean).join(' · ');
  const ibanLine  = a.iban ? `IBAN: ${a.iban}` : (a.routing_number ? `Routing: ${a.routing_number}` : '');
  const swiftLine = a.swift_bic ? `SWIFT/BIC: ${a.swift_bic}` : '';
  const cardInfo  = a.type === 'cartao_credito'
    ? [a.card_issuer, a.card_brand, a.card_type, a.card_limit && `Limite: ${fmt(a.card_limit)}`].filter(Boolean).join(' · ')
    : '';
  const dueLine   = a.due_day ? `Dia ${a.due_day}` : '';
  const bestLine  = a.best_purchase_day ? `Melhor compra: dia ${a.best_purchase_day}` : '';
  const groupName = (() => { const g = (state.groups||[]).find(x=>x.id===a.group_id); return g ? g.name : ''; })();

  // Build info rows helper
  const row = (label, val, mono) => val
    ? `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.78rem;color:var(--muted);white-space:nowrap">${label}</span>
        <span style="font-size:.8rem;font-weight:600;color:var(--text);text-align:right${mono?';font-family:monospace':''}">${esc(val)}</span>
      </div>`
    : '';

  const brlLine = a.currency !== 'BRL'
    ? `<div style="font-size:.78rem;color:rgba(255,255,255,.65);margin-top:2px">≈ ${dashFmt(toBRL ? toBRL(a.balance,a.currency) : a.balance,'BRL')} BRL</div>`
    : '';

  const confBal  = a.confirmed_balance;
  const hasPend  = confBal !== undefined && Math.abs(confBal - (parseFloat(a.balance)||0)) > 0.001;
  const confLine = hasPend
    ? `<div style="font-size:.72rem;color:rgba(255,255,255,.65);margin-top:3px">Confirmado: ${fmt(confBal,a.currency)}</div>`
    : '';

  const content = `
    <!-- Hero -->
    <div style="background:linear-gradient(135deg,${color}dd,${color}99);padding:18px 20px 16px;border-radius:12px 12px 0 0;position:relative;overflow:hidden">
      <div style="position:absolute;right:-20px;bottom:-20px;width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,.08);pointer-events:none"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${typeof _dashRenderIcon === 'function' ? _dashRenderIcon(a.icon,a.color,20) : '🏦'}
        </div>
        <div style="min-width:0">
          <div style="font-size:.95rem;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.65);margin-top:1px">${esc(typeLabel)}</div>
        </div>
        <button onclick="closeModal('favAccModal')"
          style="margin-left:auto;flex-shrink:0;background:rgba(255,255,255,.15);border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#fff;font-size:.85rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <div style="font-size:1.55rem;font-weight:800;font-family:var(--font-serif,monospace);color:${(parseFloat(a.balance)||0)<0?'#fca5a5':'#fff'}">${fmt(a.balance,a.currency)}</div>
      ${brlLine}
      ${confLine}
    </div>

    <!-- Body -->
    <div style="padding:14px 20px 20px">
      <div style="display:flex;flex-direction:column;gap:0">
        ${groupName  ? row('Grupo',       groupName)                        : ''}
        ${a.currency !== 'BRL' ? row('Moeda', a.currency)                  : ''}
        ${bankInfo   ? row('Banco',       bankInfo)                         : ''}
        ${cardInfo   ? row('Cartão',      cardInfo)                         : ''}
        ${ibanLine   ? row('IBAN / Routing', ibanLine, true)                : ''}
        ${swiftLine  ? row('SWIFT/BIC',   swiftLine, true)                  : ''}
        ${dueLine    ? row('Vencimento',  dueLine)                          : ''}
        ${bestLine   ? row('Melhor compra', bestLine.replace('Melhor compra: ','')) : ''}
      </div>
      ${a.notes ? `<div style="margin-top:10px;padding:9px 11px;background:var(--surface2);border-radius:8px;font-size:.8rem;color:var(--text2);line-height:1.5">${esc(a.notes)}</div>` : ''}

      <!-- Actions -->
      <div style="display:flex;gap:8px;margin-top:16px">
        <button onclick="closeModal('favAccModal');goToAccountTransactions('${a.id}')"
          style="flex:1;padding:9px 0;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);font-size:.8rem;font-weight:700;color:var(--text2);cursor:pointer;transition:background .15s"
          onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='var(--surface2)'">
          📋 Ver Transações
        </button>
        <button onclick="closeModal('favAccModal');openAccountModal('${a.id}')"
          style="flex:1;padding:9px 0;border-radius:9px;border:none;background:${color};font-size:.8rem;font-weight:700;color:#fff;cursor:pointer;opacity:.9;transition:opacity .15s"
          onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.9'">
          ✏️ Editar Conta
        </button>
      </div>
    </div>`;

  // Reuse or create modal
  let modal = document.getElementById('favAccModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'favAccModal';
    modal.className = 'modal-overlay';
    modal.id = 'favAccModal';
    modal.onclick = e => { if (e.target === modal) closeModal('favAccModal'); };
    modal.innerHTML = '<div class="modal" style="max-width:400px;padding:0;overflow:hidden"><div class="modal-handle"></div><div id="favAccModalBody"></div></div>';
    document.body.appendChild(modal);
  }
  const _favBody = document.getElementById('favAccModalBody');
  if (_favBody) _favBody.innerHTML = content;
  openModal('favAccModal');
}
window._openFavAccountModal = _openFavAccountModal;

// ── Dashboard Forecast 90d ─────────────────────────────────────────────────
let _dashForecastChart = null;
let _dashForecastTimer = null;
// Store daily data for tooltip + drill-down (shared between chart and modal)
let _fcDailyData   = {};   // date → { balances:{accId→val}, txs:[], scheduled:[] }
let _fcAllAccounts = [];   // accounts used in this render
let _fcAllDates    = [];   // full 91-day date array

function _initDashForecastAccountSelect() {
  if (typeof _fcPickerBuild !== 'function') return;
  const prefs    = _dashGetPrefs();
  const savedIds = Array.isArray(prefs.dashForecastAccounts) ? prefs.dashForecastAccounts : [];
  _fcPickerBuild('dashForecastAcctPicker', savedIds, ids => {
    _dashSavePrefs({ ..._dashGetPrefs(), dashForecastAccounts: ids }).catch(()=>{});
    _renderDashForecast();
  });
}

async function _renderDashForecast() {
  const card = document.getElementById('dashCardForecast90');
  if (!card || card.style.display === 'none') return;

  _initDashForecastAccountSelect();

  const accIds = typeof _fcPickerGetSelected === 'function'
    ? _fcPickerGetSelected('dashForecastAcctPicker')
    : [];
  const includeScheduled = document.getElementById('dashForecastScheduled')?.checked !== false;
  const canvas = document.getElementById('dashForecastChart');
  if (!canvas) return;

  if (_dashForecastChart) { try { _dashForecastChart.destroy(); } catch(_) {} _dashForecastChart = null; }

  // Date range: today → today + 90 days (ALL days, daily resolution)
  const fromDate = new Date();
  const toDate   = new Date();
  toDate.setDate(toDate.getDate() + 90);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr   = toDate.toISOString().slice(0, 10);

  // Fetch real transactions in period
  let q = famQ(sb.from('transactions')
    .select('id,date,description,amount,currency,brl_amount,account_id,is_transfer,status,categories(name,color,icon),payees(name),accounts!transactions_account_id_fkey(id,name,color,currency,icon,type,balance)')
    .gte('date', fromStr).lte('date', toStr).order('date'));
  if (accIds.length === 1) q = q.eq('account_id', accIds[0]);
  else if (accIds.length > 1) q = q.in('account_id', accIds);
  const { data: txData } = await q;

  // Build scheduled items
  let scheduledItems = [];
  if (includeScheduled && state.scheduled?.length) {
    const schToProcess = accIds.length
      ? state.scheduled.filter(s => accIds.includes(s.account_id) || accIds.includes(s.transfer_to_account_id))
      : state.scheduled;
    schToProcess.forEach(sc => {
      if (sc.status === 'paused') return;
      const registered = new Set((sc.occurrences||[]).map(o => o.scheduled_date));
      const occ = typeof generateOccurrences === 'function' ? generateOccurrences(sc, 200) : [];
      const isTransfer = sc.type === 'transfer' || sc.type === 'card_payment';
      occ.forEach(date => {
        if (date < fromStr || date > toStr || registered.has(date)) return;
        const baseAmt = Math.abs(parseFloat(sc.amount) || 0);
        if (!accIds.length || accIds.includes(sc.account_id)) {
          const originAmount = sc.type === 'income' ? baseAmt : -baseAmt;
          if (originAmount !== 0) {
            const accMeta = (state.accounts || []).find(a => a.id === sc.account_id);
            scheduledItems.push({ date, description: sc.description || '', amount: originAmount, account_id: sc.account_id, currency: sc.currency || accMeta?.currency || 'BRL', categories: sc.categories || null, payees: sc.payees || null, accounts: accMeta || null, isScheduled: true });
          }
        }
        if (isTransfer && sc.transfer_to_account_id && (!accIds.length || accIds.includes(sc.transfer_to_account_id))) {
          const accMeta = (state.accounts || []).find(a => a.id === sc.transfer_to_account_id);
          scheduledItems.push({ date, description: sc.description || '', amount: Math.abs(parseFloat(sc.amount)||0), account_id: sc.transfer_to_account_id, currency: accMeta?.currency || 'BRL', categories: null, payees: null, accounts: accMeta || null, isScheduled: true });
        }
      });
    });
  }

  const allItems = [...(txData||[]), ...scheduledItems].sort((a,b)=>a.date.localeCompare(b.date));
  const accountIds = [...new Set(allItems.map(t=>t.account_id))].filter(Boolean);
  const accounts = accIds.length
    ? (state.accounts||[]).filter(a=>accIds.includes(a.id))
    : (state.accounts||[]).filter(a=>accountIds.includes(a.id));

  _fcAllAccounts = accounts;

  if (!accounts.length) {
    const summary = document.getElementById('dashForecastSummary');
    if (summary) summary.innerHTML = '<span style="color:var(--muted)">Sem dados de previsão para o período</span>';
    return;
  }

  // Build full daily date array (91 points)
  const allDates = [];
  let cur = new Date(fromStr + 'T12:00');
  const end = new Date(toStr + 'T12:00');
  while (cur <= end) { allDates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
  _fcAllDates = allDates;

  const COLORS = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669'];

  // ── Build _fcDailyData: cumulative balance + transactions per day ─────────
  _fcDailyData = {};
  allDates.forEach(d => { _fcDailyData[d] = { balances: {}, txs: [], scheduled: [], totalIn: 0, totalOut: 0 }; });

  accounts.forEach(a => {
    const txAcc = allItems.filter(t => t.account_id === a.id);
    const realSumAll = txAcc.filter(t => !t.isScheduled).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
    let running = (parseFloat(a.balance)||0) - realSumAll;
    allDates.forEach(d => {
      const dayItems = txAcc.filter(t => t.date === d);
      dayItems.forEach(t => { running += (parseFloat(t.amount)||0); });
      _fcDailyData[d].balances[a.id] = +running.toFixed(2);
    });
  });

  // Populate txs + scheduled + daily totals
  allItems.forEach(t => {
    if (!_fcDailyData[t.date]) return;
    const enriched = { ...t, accounts: t.accounts || (state.accounts||[]).find(a=>a.id===t.account_id)||null };
    const amt = parseFloat(t.amount) || 0;
    if (t.isScheduled) {
      _fcDailyData[t.date].scheduled.push(enriched);
    } else {
      _fcDailyData[t.date].txs.push(enriched);
    }
    if (amt > 0) _fcDailyData[t.date].totalIn  += amt;
    else         _fcDailyData[t.date].totalOut += Math.abs(amt);
  });

  // ── Datasets: line per account (scalar y) + scatter overlays for markers ─
  // IMPORTANT: use data.labels + scalar y[] — NOT {x,y} objects — so that
  // per-point arrays (pointRadius, pointBackgroundColor, pointStyle) stay
  // correctly index-aligned with Chart.js v4 category scale.
  const lineDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color = a.color || COLORS[idx % COLORS.length];
    return {
      label: a.name,
      data: allDates.map(d => _fcDailyData[d].balances[a.id] ?? null),
      borderColor: color,
      backgroundColor: color + '12',
      fill: idx === 0 && accounts.length === 1,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 0,        // hidden — markers drawn by scatter datasets below
      pointHoverRadius: 5,
      pointHitRadius: 12,    // large hit area so hover still triggers tooltip
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
    };
  });

  // Scatter marker datasets — one per account, only active days
  // These sit on top of the line and show circles/triangles with correct color
  const markerDatasets = accounts.slice(0, 6).map((a, idx) => {
    const color = a.color || COLORS[idx % COLORS.length];
    const pts = [];
    allDates.forEach((d, i) => {
      const dd       = _fcDailyData[d];
      const hasReal  = dd.txs.some(t => t.account_id === a.id);
      const hasSched = dd.scheduled.some(t => t.account_id === a.id);
      if (!hasReal && !hasSched) return;
      const bal = _fcDailyData[d].balances[a.id];
      if (bal == null) return;
      pts.push({
        x: i,                // category scale uses index as x for scatter
        y: bal,
        _date: d,
        _isSched: hasSched && !hasReal,
        _isMixed: hasReal && hasSched,
      });
    });
    return {
      type: 'scatter',
      label: '_marker_' + a.id,  // prefix so legend filter can hide these
      xAxisID: 'x',
      yAxisID: 'y',
      data: pts,
      backgroundColor: pts.map(p =>
        p._isMixed  ? '#f59e0b' :   // amber  — both real + scheduled
        p._isSched  ? '#1d4ed8' :   // blue   — scheduled only
        color                        // account color — real tx only
      ),
      borderColor: '#fff',
      borderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 9,
      pointStyle: pts.map(p => p._isSched ? 'triangle' : 'circle'),
      showLine: false,
    };
  });

  const datasets = [...lineDatasets, ...markerDatasets];

  // ── Annotations ───────────────────────────────────────────────────────────
  const allVals = lineDatasets.flatMap(ds => ds.data.filter(v => v != null));
  const minVal  = allVals.length ? Math.min(...allVals) : 0;
  const maxVal  = allVals.length ? Math.max(...allVals) : 0;
  const minDate = allDates.find(d => Object.values(_fcDailyData[d].balances).some(v => v === minVal));
  const maxDate = allDates.find(d => Object.values(_fcDailyData[d].balances).some(v => v === maxVal));
  const minIdx  = minDate ? allDates.indexOf(minDate) : -1;
  const maxIdx  = maxDate ? allDates.indexOf(maxDate) : -1;

  // Weekly vertical guides for readability
  const weekGuides = {};
  allDates.forEach((d, i) => {
    if (i === 0) return;
    const dow = new Date(d + 'T12:00').getDay();
    if (dow === 1) { // Monday
      weekGuides['wk_' + d] = {
        type: 'line', xMin: d, xMax: d,
        borderColor: 'rgba(125,194,66,0.08)', borderWidth: 1,
      };
    }
  });

  const annotations = {
    ...weekGuides,
    zeroLine: { type:'line', yMin:0, yMax:0, borderColor:'rgba(220,38,38,0.4)', borderWidth:1.5, borderDash:[5,3] },
    todayLine: {
      type:'line', xMin:fromStr, xMax:fromStr,
      borderColor:'rgba(42,122,74,0.6)', borderWidth:2, borderDash:[4,3],
      label:{ content:'Hoje', display:true, position:'start', font:{size:9,weight:'700'}, color:'#2a6049', backgroundColor:'rgba(42,122,74,0.08)', padding:{x:4,y:2}, borderRadius:3 },
    },
  };
  if (minIdx >= 0) annotations.minPt = { type:'point', xValue:minIdx, yValue:minVal, radius:6, backgroundColor:'#dc2626', borderColor:'#fff', borderWidth:2 };
  if (maxIdx >= 0) annotations.maxPt = { type:'point', xValue:maxIdx, yValue:maxVal, radius:6, backgroundColor:'#16a34a', borderColor:'#fff', borderWidth:2 };

  // ── Chart instance ────────────────────────────────────────────────────────
  _dashForecastChart = new Chart(canvas, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10, font: { size: 10 },
            filter: item => !item.text.startsWith('_marker_'),
            generateLabels(chart) {
              return chart.data.datasets
                .filter(ds => !ds.label.startsWith('_marker_'))
                .map((ds, i) => ({
                  text: ds.label,
                  fillStyle: ds.borderColor,
                  strokeStyle: ds.borderColor,
                  lineWidth: 2,
                  hidden: !chart.isDatasetVisible(i),
                  datasetIndex: i,
                }));
            },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(10,30,18,0.95)',
          titleColor: '#f4f8f2',
          bodyColor: '#d1fae5',
          borderColor: 'rgba(125,194,66,0.35)',
          borderWidth: 1,
          padding: { x: 12, y: 10 },
          filter: item => !item.dataset.label?.startsWith('_marker_'),
          callbacks: {
            // ── Title: data formatada + dia da semana + contagem de transações ──
            title(items) {
              const d = items[0]?.label || '';
              if (!d) return '';
              const [y, m, day] = d.split('-');
              const weekdays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
              const wd = weekdays[new Date(d + 'T12:00').getDay()];
              const dd = _fcDailyData[d];
              const nReal  = (dd?.txs||[]).length;
              const nSched = (dd?.scheduled||[]).length;
              const parts  = [];
              if (nReal)  parts.push(`${nReal} lançamento${nReal>1?'s':''}`);
              if (nSched) parts.push(`${nSched} programado${nSched>1?'s':''}`);
              return `${wd}, ${day}/${m}/${y}` + (parts.length ? `  ·  ${parts.join(' + ')}` : '');
            },
            // ── Body: saldo projetado por conta ──────────────────────────────
            label(ctx) {
              // skip marker scatter datasets (they appear in tooltip as duplicate)
              if (ctx.dataset.label?.startsWith('_marker_')) return null;
              const d   = ctx.label || '';
              const acc = accounts[ctx.datasetIndex]; // lineDatasets are first, index matches
              const bal = ctx.parsed.y;
              if (bal == null) return '';
              const balFmt = fmt(bal, acc?.currency || 'BRL');
              const dd = _fcDailyData[d];
              const hasTx    = (dd?.txs||[]).some(t => t.account_id === acc?.id);
              const hasSched = (dd?.scheduled||[]).some(t => t.account_id === acc?.id);
              const tag = hasTx && hasSched ? ' ●▲' : hasTx ? ' ●' : hasSched ? ' ▲' : '';
              return `  ${acc?.name || ctx.dataset.label}: ${balFmt}${tag}`;
            },
            // ── After body: fluxo diário + lista de transações do dia ─────────
            afterBody(items) {
              const d  = items[0]?.label || '';
              const dd = _fcDailyData[d];
              if (!dd) return [];
              const allDayItems = [...(dd.txs||[]), ...(dd.scheduled||[])];
              const lines = [];

              // Net flow summary
              if (dd.totalIn > 0 || dd.totalOut > 0) {
                lines.push('');
                lines.push(`  ↑ Entradas: +${fmt(dd.totalIn)}    ↓ Saídas: −${fmt(dd.totalOut)}`);
                const net = dd.totalIn - dd.totalOut;
                lines.push(`  Net do dia: ${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}`);
              }

              // List up to 6 transactions
              if (allDayItems.length) {
                lines.push('');
                allDayItems.slice(0, 6).forEach(t => {
                  const neg    = Number(t.amount) < 0;
                  const sign   = neg ? '−' : '+';
                  const amtStr = fmt(Math.abs(Number(t.amount)), t.currency || 'BRL');
                  const label  = (t.description || t.payees?.name || '—').slice(0, 24);
                  const sched  = t.isScheduled ? ' ▲' : '';
                  const cat    = t.categories?.icon ? t.categories.icon + ' ' : '';
                  lines.push(`  ${sign}${amtStr}  ${cat}${label}${sched}`);
                });
                if (allDayItems.length > 6) {
                  lines.push(`  … e mais ${allDayItems.length - 6} transaç${allDayItems.length - 6 > 1 ? 'ões' : 'ão'}`);
                }
              }

              lines.push('');
              lines.push('  👆 Clique para detalhes completos');
              return lines;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          type: 'category',
          ticks: {
            color: '#8c8278',
            font: { size: 10 },
            maxRotation: 0,
            // Daily markers: show every day but only label every ~9 days
            callback(val, idx) {
              const d = allDates[idx];
              if (!d) return '';
              const [, m, day] = d.split('-');
              // Mark every day (short tick via major/minor not available in category scale;
              // we show labels at ~weekly intervals, dots for every day via pointRadius)
              const dow = new Date(d + 'T12:00').getDay();
              if (idx === 0) return `${day}/${m}`;           // always show first
              if (idx === allDates.length - 1) return `${day}/${m}`; // always show last
              if (dow === 1) return `${day}/${m}`;           // every Monday
              return '';
            },
          },
          grid: {
            color: ctx => {
              const d = allDates[ctx.index];
              if (!d) return '#e8e4de18';
              const dow = new Date(d + 'T12:00').getDay();
              if (dow === 1) return 'rgba(125,194,66,0.10)'; // monday grid line
              return '#e8e4de18';
            },
            lineWidth: ctx => {
              const d = allDates[ctx.index];
              if (!d) return 1;
              return new Date(d + 'T12:00').getDay() === 1 ? 1.5 : 0.5;
            },
          },
        },
        y: {
          ticks: {
            callback: v => fmt(v),
            color: '#8c8278',
            font: { size: 10 },
            maxTicksLimit: 6,
          },
          grid: {
            color: ctx => ctx.tick.value === 0 ? 'rgba(220,38,38,0.20)' : '#e8e4de18',
            lineWidth: ctx => ctx.tick.value === 0 ? 1.5 : 1,
          },
        },
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        // Skip if click landed on a scatter marker — find first line dataset element
        const el = elements.find(e => !datasets[e.datasetIndex]?.label?.startsWith('_marker_')) || elements[0];
        const idx  = el.index;
        const date = allDates[idx];
        if (date) _dashForecastDrill(date, _fcDailyData[date]);
      },
      onHover(evt, elements) {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  });

  // ── Summary row: today balance + 90-day projected balance + delta ─────────
  const summary = document.getElementById('dashForecastSummary');
  if (summary) {
    const lastDate = allDates[allDates.length - 1];
    summary.innerHTML = accounts.slice(0,6).map((a, idx) => {
      const finalBal = _fcDailyData[lastDate]?.balances[a.id] ?? 0;
      const todayBal = _fcDailyData[fromStr]?.balances[a.id] ?? (parseFloat(a.balance)||0);
      const delta    = finalBal - todayBal;
      const isNeg    = finalBal < 0;
      const color    = a.color || COLORS[idx % COLORS.length];
      const deltaStr = (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta), a.currency);
      const deltaClr = delta >= 0 ? 'var(--accent)' : 'var(--red,#c0392b)';
      return `<span style="display:flex;align-items:center;gap:4px;white-space:nowrap">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="color:var(--text2);font-size:.78rem">${esc(a.name)}</span>
        <strong style="color:${isNeg?'var(--red,#c0392b)':'var(--accent)'};font-size:.78rem">${fmt(finalBal, a.currency)}</strong>
        <span style="font-size:.7rem;color:${deltaClr};opacity:.8">(${deltaStr})</span>
      </span>`;
    }).join('');
  }
}


function attachForecastNavigation(chartInstance, labelsArr, txByLabel) {
  if (!chartInstance) return;
  chartInstance.options.onClick = function(evt, elements) {
    if (elements?.length && labelsArr) {
      const date = labelsArr[elements[0].index];
      if (date) _dashForecastDrill(date, _fcDailyData[date]);
    }
  };
  chartInstance.update();
}

function _dashForecastDrill(date, dayData) {
  _showForecastDrillModal(date, dayData || _fcDailyData[date] || {});
}

// ── Forecast drill-down modal ─────────────────────────────────────────────
function _showForecastDrillModal(date, dayData) {
  const txs       = dayData?.txs       || [];
  const scheduled = dayData?.scheduled || [];
  const balances  = dayData?.balances  || {};
  const allItems  = [...txs, ...scheduled];

  const [y, m, d] = (date || '').split('-');
  const dateLabel  = d && m && y ? `${d}/${m}/${y}` : date;
  const weekdays   = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  const weekday    = date ? weekdays[new Date(date + 'T12:00').getDay()] : '';
  const isToday    = date === new Date().toISOString().slice(0,10);
  const isPast     = date < new Date().toISOString().slice(0,10);

  // ── Estatísticas do dia ───────────────────────────────────────────────────
  const totalIn   = allItems.filter(t => Number(t.amount) > 0).reduce((s,t)=>s+Number(t.amount),0);
  const totalOut  = allItems.filter(t => Number(t.amount) < 0).reduce((s,t)=>s+Math.abs(Number(t.amount)),0);
  const netFlow   = totalIn - totalOut;
  const nReal     = txs.length;
  const nSched    = scheduled.length;

  // Breakdown por categoria
  const catTotals = {};
  allItems.forEach(t => {
    const key  = t.categories?.name || (Number(t.amount)>0 ? 'Receitas' : 'Outros');
    const icon = t.categories?.icon || (Number(t.amount)>0 ? '💰' : '📦');
    const col  = t.categories?.color || (Number(t.amount)>0 ? '#16a34a' : '#6b7280');
    if (!catTotals[key]) catTotals[key] = { icon, color: col, totalIn:0, totalOut:0, count:0 };
    if (Number(t.amount) > 0) catTotals[key].totalIn  += Number(t.amount);
    else                      catTotals[key].totalOut += Math.abs(Number(t.amount));
    catTotals[key].count++;
  });
  const catRows = Object.entries(catTotals)
    .sort((a,b) => (b[1].totalIn + b[1].totalOut) - (a[1].totalIn + a[1].totalOut))
    .slice(0, 6);

  // ── Saldo das contas neste dia ────────────────────────────────────────────
  const balCards = _fcAllAccounts.filter(a => balances[a.id] !== undefined).map(a => {
    const bal     = balances[a.id];
    const isNeg   = bal < 0;
    const color   = a.color || '#2a6049';
    const todayBal= _fcDailyData[_fcAllDates[0]]?.balances[a.id] ?? bal;
    const delta   = bal - todayBal;
    const deltaFmt= (delta >= 0 ? '+' : '−') + fmt(Math.abs(delta), a.currency);
    const deltaClr= delta >= 0 ? 'var(--accent)' : 'var(--red,#c0392b)';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface2);border-radius:10px;border-left:3px solid ${color}">
        <span style="font-size:1.2rem;flex-shrink:0">${a.icon||'🏦'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.78rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
          <div style="font-size:.67rem;color:var(--muted);margin-top:1px">Saldo projetado${isPast?' (real)':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.9rem;font-weight:800;color:${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
            ${fmt(bal, a.currency)}
          </div>
          ${!isToday && delta !== 0 ? `<div style="font-size:.65rem;color:${deltaClr};margin-top:1px">${deltaFmt} vs hoje</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // ── Lista de transações ───────────────────────────────────────────────────
  const txRows = allItems.length
    ? allItems.map(t => {
        const isNeg   = Number(t.amount) < 0;
        const catIcon = t.categories?.icon || (isNeg ? '📦' : '💰');
        const catClr  = t.categories?.color || (isNeg ? '#6b7280' : '#16a34a');
        const payee   = t.payees?.name || '';
        const desc    = t.description || payee || '—';
        const accName = t.accounts?.name || (state.accounts||[]).find(a=>a.id===t.account_id)?.name || '';
        const accClr  = t.accounts?.color || (state.accounts||[]).find(a=>a.id===t.account_id)?.color || '#2a6049';
        const amt     = Math.abs(Number(t.amount));
        const cur     = t.currency || t.accounts?.currency || 'BRL';
        const isPend  = (t.status || 'confirmed') === 'pending';

        const tags = [];
        if (t.isScheduled) tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:rgba(29,78,216,.12);color:#1d4ed8;font-weight:600">▲ Programado</span>`);
        if (isPend)        tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:rgba(180,83,9,.12);color:#b45309;font-weight:600">Pendente</span>`);
        if (t.categories?.name) tags.push(`<span style="font-size:.6rem;padding:1px 6px;border-radius:4px;background:${catClr}18;color:${catClr}">${catIcon} ${esc(t.categories.name)}</span>`);

        return `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;background:var(--surface2);border-radius:10px;border-left:2.5px solid ${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
            <span style="font-size:1.15rem;flex-shrink:0;margin-top:1px">${catIcon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.82rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(desc)}</div>
              ${accName ? `<div style="font-size:.68rem;color:var(--muted);margin-top:2px;display:flex;align-items:center;gap:3px"><span style="width:5px;height:5px;border-radius:50%;background:${accClr};flex-shrink:0"></span>${esc(accName)}</div>` : ''}
              ${tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${tags.join('')}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span style="font-size:.9rem;font-weight:800;color:${isNeg?'var(--red,#c0392b)':'var(--accent)'}">
                ${isNeg?'−':'+'}${fmt(amt, cur)}
              </span>
            </div>
          </div>`;
      }).join('')
    : `<div style="padding:24px 10px;text-align:center;color:var(--muted);font-size:.83rem">
         📭 Nenhuma movimentação neste dia.
       </div>`;

  // ── Breakdown por categoria ───────────────────────────────────────────────
  const maxCatVal = Math.max(...catRows.map(([, v]) => v.totalIn + v.totalOut), 1);
  const catSection = catRows.length ? `
    <div style="margin-top:18px">
      <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Por categoria</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${catRows.map(([cat, {icon, color, totalIn: tIn, totalOut: tOut, count}]) => {
          const total = tIn + tOut;
          const pct   = Math.round((total / maxCatVal) * 100);
          const isInc = tIn > tOut;
          return `
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:.9rem;flex-shrink:0">${icon}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
                <span style="font-size:.75rem;color:var(--text2);font-weight:600">${esc(cat)}</span>
                <span style="font-size:.72rem;font-weight:700;color:${isInc?'var(--accent)':'var(--red,#c0392b)'}">${isInc?'+':'-'}${fmt(total)}</span>
              </div>
              <div style="height:3px;border-radius:2px;background:var(--border)">
                <div style="height:100%;border-radius:2px;background:${color || (isInc?'var(--accent)':'var(--red,#c0392b)')};width:${pct}%;transition:width .3s"></div>
              </div>
            </div>
            <span style="font-size:.65rem;color:var(--muted);flex-shrink:0">${count}x</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // ── Estatísticas de tendência (vs dia anterior e vs mesma semana) ─────────
  const dayIdx   = _fcAllDates.indexOf(date);
  const prevDate = dayIdx > 0 ? _fcAllDates[dayIdx - 1] : null;
  const prev7    = dayIdx >= 7 ? _fcAllDates[dayIdx - 7] : null;
  let trendHtml  = '';
  if (prevDate || prev7) {
    const prevBal = prevDate ? Object.values(_fcDailyData[prevDate]?.balances||{}).reduce((s,v)=>s+v,0) : null;
    const curBal  = Object.values(balances).reduce((s,v)=>s+v,0);
    const prev7Bal= prev7 ? Object.values(_fcDailyData[prev7]?.balances||{}).reduce((s,v)=>s+v,0) : null;
    const d1Delta = prevBal != null ? curBal - prevBal : null;
    const d7Delta = prev7Bal != null ? curBal - prev7Bal : null;
    const pill = (val, label) => val == null ? '' : `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface2);border-radius:8px">
        <span style="font-size:.72rem;color:var(--muted)">${label}</span>
        <span style="font-size:.76rem;font-weight:700;color:${val>=0?'var(--accent)':'var(--red,#c0392b)'}">
          ${val>=0?'+':'−'}${fmt(Math.abs(val))}
        </span>
      </div>`;
    trendHtml = `
      <div style="margin-top:18px">
        <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Tendência do saldo total</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${pill(d1Delta, 'vs dia anterior')}
          ${pill(d7Delta, 'vs semana passada')}
        </div>
      </div>`;
  }

  // ── Badge de tipo do dia ──────────────────────────────────────────────────
  const dayBadge = isToday
    ? `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:rgba(42,96,73,.15);color:#2a6049;font-weight:700">Hoje</span>`
    : isPast
    ? `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:var(--surface3,var(--surface2));color:var(--muted);font-weight:600">Passado</span>`
    : `<span style="font-size:.65rem;padding:2px 8px;border-radius:20px;background:rgba(29,78,216,.1);color:#1d4ed8;font-weight:600">Futuro</span>`;

  // ── Navegação entre dias ──────────────────────────────────────────────────
  const prevDateNav = dayIdx > 0 ? _fcAllDates[dayIdx - 1] : null;
  const nextDateNav = dayIdx < _fcAllDates.length - 1 ? _fcAllDates[dayIdx + 1] : null;
  const navBtn = (d, label, dir) => d
    ? `<button onclick="_dashForecastDrill('${d}', _fcDailyData['${d}'])"
         style="display:flex;align-items:center;gap:4px;font-size:.72rem;padding:5px 10px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);cursor:pointer">
         ${dir === 'prev' ? '←' : ''} ${label} ${dir === 'next' ? '→' : ''}
       </button>`
    : `<span></span>`;

  // ── HTML do modal ─────────────────────────────────────────────────────────
  const content = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:8px">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <span style="font-size:1.05rem;font-weight:800;color:var(--text)">${weekday}</span>
          ${dayBadge}
        </div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${dateLabel}
          ${nReal || nSched ? `· <strong style="color:var(--text2)">${nReal} lançamento${nReal!==1?'s':''}</strong>${nSched ? ` + <strong style="color:#1d4ed8">${nSched} programado${nSched!==1?'s':''}</strong>` : ''}` : ''}
        </div>
      </div>
      <button onclick="closeModal('forecastDrillModal')"
        style="background:none;border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer;font-size:.75rem;color:var(--muted);flex-shrink:0">✕</button>
    </div>

    <!-- Stats bar -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:14px">
      <div style="background:rgba(42,122,74,.1);border:1px solid rgba(42,122,74,.15);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Entradas</div>
        <div style="font-size:.92rem;font-weight:800;color:var(--accent)">+${fmt(totalIn)}</div>
      </div>
      <div style="background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.15);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Saídas</div>
        <div style="font-size:.92rem;font-weight:800;color:var(--red,#c0392b)">−${fmt(totalOut)}</div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:9px 10px;text-align:center">
        <div style="font-size:.65rem;color:var(--muted);margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Net do dia</div>
        <div style="font-size:.92rem;font-weight:800;color:${netFlow>=0?'var(--accent)':'var(--red,#c0392b)'}">
          ${netFlow>=0?'+':'−'}${fmt(Math.abs(netFlow))}
        </div>
      </div>
    </div>

    <!-- Saldo das contas -->
    ${balCards ? `
    <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Saldo projetado das contas</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">${balCards}</div>` : ''}

    <!-- Transações do dia -->
    <div style="font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">
      Transações${allItems.length ? ` (${allItems.length})` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;max-height:260px;overflow-y:auto;padding-right:2px">
      ${txRows}
    </div>

    ${catSection}
    ${trendHtml}

    <!-- Footer: navegação + ação -->
    <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:6px">
        ${navBtn(prevDateNav, 'Anterior', 'prev')}
        ${navBtn(nextDateNav, 'Próximo', 'next')}
      </div>
      <button onclick="navigate('reports');setTimeout(()=>typeof setReportView==='function'&&setReportView('forecast'),300);closeModal('forecastDrillModal')"
        style="font-size:.72rem;padding:5px 12px;border-radius:7px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);cursor:pointer">
        📊 Previsão completa
      </button>
    </div>`;

  // ── Criar / reusar modal ──────────────────────────────────────────────────
  let modal = document.getElementById('forecastDrillModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forecastDrillModal';
    modal.className = 'modal-overlay';
    modal.id = 'forecastDrillModal';
    modal.onclick = e => { if (e.target === modal) closeModal('forecastDrillModal'); };
    modal.innerHTML = '<div class="modal" style="max-width:540px;max-height:90dvh;overflow-y:auto;padding:0"><div class="modal-handle"></div><div id="forecastDrillModalBody" style="padding:18px 18px 22px"></div></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('forecastDrillModalBody').innerHTML = content;
  openModal('forecastDrillModal');
}
window._dashForecastDrill = _dashForecastDrill;
window._showForecastDrillModal = _showForecastDrillModal;



function toggleSupGroup(date) {
  const body  = document.getElementById('supGroup-' + date);
  const arrow = document.getElementById('supArrow-' + date);
  if (!body) return;
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '0';
  body.style.maxHeight  = isOpen ? '0' : '2000px';
  if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}
window.toggleSupGroup = toggleSupGroup;

// ── Modal: Composição do Patrimônio Total ─────────────────────────────────
async function _openPatrimonioModal() {
  let accs = Array.isArray(state.accounts) ? state.accounts : [];
  if (!accs.length) {
    try { await DB.accounts.load(); accs = state.accounts || []; } catch(_) {}
  }
  if (!accs.length) { toast('Nenhuma conta encontrada', 'info'); return; }

  // ── Calcular totais — idêntico ao KPI ──────────────────────────────────
  const accsLiquid  = accs.filter(a => !['investimento','cartao_credito'].includes(a.type));
  const accsInvest  = accs.filter(a => a.type === 'investimento');
  const accsCard    = accs.filter(a => a.type === 'cartao_credito');

  const liquidTotal = accsLiquid.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
  const invTotal    = accsInvest.reduce((s,a) => {
    const bal = (a._totalPortfolioBalance != null) ? a._totalPortfolioBalance : (parseFloat(a.balance)||0);
    return s + toBRL(bal, a.currency||'BRL');
  }, 0);
  const cardTotal   = accsCard.reduce((s,a) => s + toBRL(parseFloat(a.balance)||0, a.currency||'BRL'), 0);
  const accountTotal = liquidTotal + invTotal + cardTotal;
  const cardDebt    = Math.abs(Math.min(0, cardTotal));

  // Posições de investimento por tipo
  const invPositions = (typeof _inv !== 'undefined' && _inv.positions) ? _inv.positions : [];
  const invByType = {};
  invPositions.forEach(p => {
    const k = p.asset_type || 'outro';
    if (!invByType[k]) invByType[k] = { positions: [], total: 0 };
    const mv = (typeof _invMarketValue === 'function') ? _invMarketValue(p) : (+(p.quantity||0) * (+(p.current_price||p.avg_cost||0)));
    invByType[k].positions.push({ ...p, _mv: mv });
    invByType[k].total += mv;
  });

  // Dívidas ativas
  let debtTotal = 0, debts = [];
  try {
    const { data: dd, error: de } = await famQ(
      sb.from('debts').select('id,name,current_balance,original_amount,currency,status,fixed_rate,adjustment_type,creditor:payees!debts_creditor_payee_id_fkey(id,name)')
    ).eq('status','active').order('current_balance',{ascending:false});
    if (de) throw de;
    debts = dd || [];
    debtTotal = debts.reduce((s,d) => s + toBRL(parseFloat(d.current_balance??d.original_amount)||0, d.currency||'BRL'), 0);
  } catch(_) {
    try {
      const { data: ds } = await famQ(sb.from('debts').select('id,name,current_balance,original_amount,currency,status')).eq('status','active');
      debts = ds || [];
      debtTotal = debts.reduce((s,d) => s + toBRL(parseFloat(d.current_balance??d.original_amount)||0, d.currency||'BRL'), 0);
    } catch(__) {}
  }

  const totalPassivos = debtTotal + cardDebt;
  const totalBRL      = accountTotal - debtTotal;
  const ativosBase    = Math.max(accountTotal, 0.01);

  // ── Helpers ────────────────────────────────────────────────────────────
  const _pct  = (val, base) => base > 0 ? Math.min(100, Math.abs(val / base * 100)).toFixed(1) : '0.0';
  const _isFX = (cur) => cur && cur !== 'BRL';

  const _invTypeLabel = { acao_br:'Ações BR', fii:'FII', etf_br:'ETF BR', acao_us:'Ações US',
    etf_us:'ETF US', bdr:'BDR', fundo:'Fundos', crypto:'Criptomoeda', renda_fixa:'Renda Fixa', outro:'Outros' };
  const _invTypeEmoji = { acao_br:'🇧🇷', fii:'🏢', etf_br:'📊', acao_us:'🇺🇸', etf_us:'📈',
    bdr:'🌐', fundo:'🏦', crypto:'₿', renda_fixa:'💰', outro:'📌' };
  const _adjLabel     = { fixed:'Fixo', selic:'SELIC', ipca:'IPCA', igpm:'IGP-M', cdi:'CDI', poupanca:'Poupança', custom:'Personalizado' };

  // Barra de progresso proporcional
  const _bar = (pct, color, h = 3) =>
    `<div style="height:${h}px;border-radius:${h}px;background:var(--border);margin:3px 12px;overflow:hidden">
      <div style="height:100%;width:${Math.min(+pct,100)}%;background:${color};border-radius:${h}px;transition:width .45s ease"></div>
    </div>`;

  // Linha de conta
  const _accountRow = (a, bal, balBRL, pct, cur, color, onclick) => {
    const isFX   = _isFX(cur);
    const isNeg  = balBRL < 0;
    const dispBal = isFX ? dashFmt(Math.abs(bal), cur) : dashFmt(Math.abs(balBRL), 'BRL');
    const subBRL  = isFX ? `<span style="font-size:.7rem;color:var(--muted)">= ${dashFmt(Math.abs(balBRL),'BRL')}</span>` : '';
    return `
      <div class="pat-account-row" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;
        background:var(--surface2);cursor:${onclick?'pointer':'default'};transition:background .12s;margin-bottom:3px"
        ${onclick ? `onclick="${onclick}" onmouseover="this.style.background='rgba(0,0,0,.04)'" onmouseout="this.style.background='var(--surface2)'"` : ''}>
        <div style="width:34px;height:34px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${_dashRenderIcon(a.icon, a.color, 17)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:.68rem;color:var(--muted)">${(typeof accountTypeLabel==='function'?accountTypeLabel(a.type):a.type)||''}</span>
            ${isFX ? `<span style="font-size:.65rem;font-weight:700;color:var(--muted);background:rgba(0,0,0,.06);border-radius:4px;padding:1px 5px">${cur}</span>` : ''}
            ${subBRL}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.9rem;font-weight:800;font-family:var(--font-serif);color:${isNeg?'var(--red,#dc2626)':'var(--text)'}">${isNeg?'−':''}${dispBal}</div>
          <div style="font-size:.65rem;color:var(--muted);margin-top:1px">${pct}% do patrimônio</div>
        </div>
      </div>
      ${_bar(pct, color || 'var(--accent)')}`;
  };

  // ── Seção: cabeçalho colapsável ──
  const _sectionHeader = (id, emoji, title, total, color, extra='') =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 2px 8px;border-bottom:2px solid ${color}22;margin-bottom:10px;cursor:pointer"
      onclick="document.getElementById('pat-sec-${id}').classList.toggle('pat-collapsed')">
      <div style="display:flex;align-items:center;gap:7px">
        <span style="font-size:.9rem">${emoji}</span>
        <span style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:${color}">${title}</span>
        ${extra}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:${color}">${dashFmt(total,'BRL')}</span>
        <span style="font-size:.75rem;color:var(--muted)" id="pat-chev-${id}">▾</span>
      </div>
    </div>`;

  // ══════════════════════════════════════════════════════
  // BUILD HTML
  // ══════════════════════════════════════════════════════
  let html = `
  <style>
    .pat-collapsed > .pat-body { display:none !important; }
    .pat-collapsed { }
  </style>
  <div style="padding:0 0 24px">

    <!-- ── HERO ─────────────────────────────────────────────────── -->
    <div style="background:linear-gradient(145deg,#0d3d28,#1a6644,#0f4a31);padding:22px 20px 20px;position:relative;overflow:hidden">
      <div style="position:absolute;inset:0;background:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2280%22 cy=%2220%22 r=%2250%22 fill=%22rgba(255,255,255,.04)%22/><circle cx=%2210%22 cy=%2280%22 r=%2240%22 fill=%22rgba(255,255,255,.03)%22/></svg>') no-repeat center/cover"></div>
      <div style="position:relative">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px">
          <div>
            <div style="font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.5);margin-bottom:6px">Patrimônio Líquido</div>
            <div style="font-size:2rem;font-weight:900;font-family:var(--font-serif);color:#fff;line-height:1">${dashFmt(totalBRL,'BRL')}</div>
            <div style="font-size:.72rem;color:rgba(255,255,255,.55);margin-top:5px">Posição em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</div>
          </div>
          <button onclick="closeModal('patrimonioModal')"
            style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:50%;width:34px;height:34px;font-size:.85rem;cursor:pointer;color:rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;flex-shrink:0;backdrop-filter:blur(4px)">✕</button>
        </div>

        <!-- Barra ativos vs passivos -->
        <div style="height:6px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden;display:flex;gap:1px;margin-bottom:10px">
          <div style="flex:${Math.max(accountTotal,0)};background:rgba(100,220,140,.85);border-radius:4px 0 0 4px;min-width:4px;transition:flex .5s"></div>
          ${totalPassivos > 0 ? `<div style="flex:${totalPassivos};background:rgba(240,80,80,.8);border-radius:0 4px 4px 0;min-width:4px;transition:flex .5s"></div>` : ''}
        </div>

        <!-- Grid KPIs -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <div style="background:rgba(255,255,255,.1);border-radius:10px;padding:9px 10px;backdrop-filter:blur(4px)">
            <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.5);margin-bottom:3px">Ativos</div>
            <div style="font-size:.88rem;font-weight:800;color:#7ef5a8">${dashFmt(accountTotal,'BRL')}</div>
          </div>
          <div style="background:rgba(255,255,255,.1);border-radius:10px;padding:9px 10px;backdrop-filter:blur(4px)">
            <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.5);margin-bottom:3px">Passivos</div>
            <div style="font-size:.88rem;font-weight:800;color:${totalPassivos>0?'#fca5a5':'rgba(255,255,255,.7)'}">−${dashFmt(totalPassivos,'BRL')}</div>
          </div>
          <div style="background:rgba(255,255,255,.1);border-radius:10px;padding:9px 10px;backdrop-filter:blur(4px)">
            <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.5);margin-bottom:3px">Endivid.</div>
            <div style="font-size:.88rem;font-weight:800;color:${accountTotal>0&&(totalPassivos/accountTotal)>0.5?'#fca5a5':accountTotal>0&&(totalPassivos/accountTotal)>0.2?'#fcd34d':'rgba(255,255,255,.8)'}">
              ${accountTotal > 0 ? (totalPassivos/accountTotal*100).toFixed(1) : '0.0'}%
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── CORPO ──────────────────────────────────────────────────── -->
    <div style="padding:18px 16px 0">

      <!-- ═══ CONTAS LÍQUIDAS ════════════════════════════════════════ -->
      ${accsLiquid.length ? `
      <div class="pat-section" style="margin-bottom:18px">
        ${_sectionHeader('liquid','💳','Contas', liquidTotal, '#1a6644')}
        <div id="pat-sec-liquid" class=""><div class="pat-body">
          ${accsLiquid.sort((a,b)=>Math.abs(toBRL(parseFloat(b.balance)||0,b.currency||'BRL'))-Math.abs(toBRL(parseFloat(a.balance)||0,a.currency||'BRL'))).map(a => {
            const bal    = parseFloat(a.balance)||0;
            const balBRL = toBRL(bal, a.currency||'BRL');
            return _accountRow(a, bal, balBRL, _pct(Math.abs(balBRL), ativosBase), a.currency||'BRL', a.color||'var(--accent)', `goToAccountTransactions('${a.id}');closeModal('patrimonioModal')`);
          }).join('')}
        </div></div>
      </div>` : ''}

      <!-- ═══ INVESTIMENTOS ══════════════════════════════════════════ -->
      ${accsInvest.length ? `
      <div class="pat-section" style="margin-bottom:18px">
        ${_sectionHeader('invest','📊','Investimentos', invTotal, '#1e5ba8')}
        <div id="pat-sec-invest" class=""><div class="pat-body">
          ${Object.keys(invByType).length > 0 ? `
            ${Object.entries(invByType).sort(([,a],[,b])=>b.total-a.total).map(([k,grp]) => {
              const emoji = _invTypeEmoji[k]||'📌';
              const label = _invTypeLabel[k]||k;
              const typePct = _pct(grp.total, ativosBase);
              return `
                <details style="border-radius:10px;overflow:hidden;background:var(--surface2);margin-bottom:3px">
                  <summary style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;list-style:none;-webkit-appearance:none">
                    <div style="width:34px;height:34px;border-radius:9px;background:#1e5ba822;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">${emoji}</div>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:.84rem;font-weight:700;color:var(--text)">${label}</div>
                      <div style="font-size:.68rem;color:var(--muted)">${grp.positions.length} ativo${grp.positions.length!==1?'s':''} · ${typePct}% do patrimônio</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                      <div style="font-size:.9rem;font-weight:800;font-family:var(--font-serif);color:var(--text)">${dashFmt(grp.total,'BRL')}</div>
                      <div style="font-size:.65rem;color:var(--muted);margin-top:1px">▾ expandir</div>
                    </div>
                  </summary>
                  ${_bar(typePct,'#1e5ba8')}
                  <div style="padding:4px 12px 10px;border-top:1px solid var(--border)">
                    ${grp.positions.sort((a,b)=>b._mv-a._mv).map(p => {
                      const mv      = p._mv || 0;
                      const cost    = (+(p.quantity||0)) * (+(p.avg_cost||0));
                      const pnl     = mv - cost;
                      const pnlPct  = cost > 0 ? (pnl/cost*100) : 0;
                      const isFX    = _isFX(p.currency);
                      const cur     = p.currency || 'BRL';
                      const posPct  = _pct(mv, ativosBase);
                      return `
                        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                          <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                              <span style="font-size:.84rem;font-weight:800;color:var(--text)">${esc(p.ticker)}</span>
                              ${isFX?`<span style="font-size:.62rem;font-weight:700;background:rgba(0,0,0,.07);border-radius:4px;padding:1px 5px;color:var(--muted)">${cur}</span>`:''}
                              <span style="font-size:.7rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px">${esc(p.name||'')}</span>
                            </div>
                            <div style="font-size:.67rem;color:var(--muted);margin-top:2px">${(+(p.quantity||0)).toLocaleString('pt-BR',{maximumFractionDigits:6})} un · PM ${dashFmt(+(p.avg_cost||0),cur)}</div>
                          </div>
                          <div style="text-align:right;flex-shrink:0">
                            <div style="font-size:.88rem;font-weight:800;font-family:var(--font-serif)">${dashFmt(mv,'BRL')}</div>
                            ${isFX?`<div style="font-size:.67rem;color:var(--muted)">${dashFmt(mv/Math.max(toBRL(1,cur),0.0001),cur)} ${cur}</div>`:''}
                            <div style="font-size:.67rem;color:${pnl>=0?'#16a34a':'#dc2626'};margin-top:1px">${pnl>=0?'▲':'▼'}${Math.abs(pnlPct).toFixed(1)}% ${pnl>=0?'+':''}${dashFmt(pnl,'BRL')}</div>
                          </div>
                        </div>`;
                    }).join('')}
                    <div style="display:flex;justify-content:flex-end;padding-top:6px">
                      <span style="font-size:.72rem;font-weight:700;color:#1e5ba8">${dashFmt(grp.total,'BRL')}</span>
                    </div>
                  </div>
                </details>`;
            }).join('')}
          ` : `
            ${accsInvest.map(a => {
              const bal    = (a._totalPortfolioBalance!=null)?a._totalPortfolioBalance:(parseFloat(a.balance)||0);
              const balBRL = toBRL(bal, a.currency||'BRL');
              return _accountRow(a, bal, balBRL, _pct(balBRL,ativosBase), a.currency||'BRL', a.color||'#1e5ba8', `goToAccountTransactions('${a.id}');closeModal('patrimonioModal')`);
            }).join('')}
          `}
        </div></div>
      </div>` : ''}

      <!-- ═══ CARTÕES COM SALDO POSITIVO ════════════════════════════ -->
      ${accsCard.some(a=>(parseFloat(a.balance)||0)>0) ? `
      <div class="pat-section" style="margin-bottom:18px">
        ${_sectionHeader('cards-pos','💳','Cartões com Saldo', Math.max(0,cardTotal), '#0284c7')}
        <div id="pat-sec-cards-pos" class=""><div class="pat-body">
          ${accsCard.filter(a=>(parseFloat(a.balance)||0)>0).map(a => {
            const bal    = parseFloat(a.balance)||0;
            const balBRL = toBRL(bal, a.currency||'BRL');
            return _accountRow(a, bal, balBRL, _pct(balBRL,ativosBase), a.currency||'BRL', a.color||'#0284c7', `goToAccountTransactions('${a.id}');closeModal('patrimonioModal')`);
          }).join('')}
        </div></div>
      </div>` : ''}

      <!-- ═══ PASSIVOS ═══════════════════════════════════════════════ -->
      ${totalPassivos > 0 ? `
      <div style="border-top:1px dashed var(--border);padding-top:16px;margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 2px 8px;border-bottom:2px solid rgba(220,38,38,.25);margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:.9rem">📉</span>
            <span style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--red,#dc2626)">Passivos</span>
            <span style="font-size:.65rem;color:var(--muted);background:rgba(220,38,38,.08);border-radius:4px;padding:2px 6px">${_pct(totalPassivos,ativosBase)}% dos ativos</span>
          </div>
          <span style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:var(--red,#dc2626)">−${dashFmt(totalPassivos,'BRL')}</span>
        </div>

        <!-- Faturas CC -->
        ${accsCard.some(a=>(parseFloat(a.balance)||0)<0) ? `
        <div style="margin-bottom:12px">
          <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px;padding-left:2px">Faturas em Aberto</div>
          ${accsCard.filter(a=>(parseFloat(a.balance)||0)<0).map(a => {
            const bal    = Math.abs(parseFloat(a.balance)||0);
            const balBRL = toBRL(bal, a.currency||'BRL');
            const isFX   = _isFX(a.currency||'BRL');
            const pct    = _pct(balBRL, ativosBase);
            return `
              <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:rgba(220,38,38,.05);border:1px solid rgba(220,38,38,.12);cursor:pointer;margin-bottom:3px;transition:background .12s"
                onclick="goToAccountTransactions('${a.id}');closeModal('patrimonioModal')"
                onmouseover="this.style.background='rgba(220,38,38,.1)'" onmouseout="this.style.background='rgba(220,38,38,.05)'">
                <div style="width:34px;height:34px;border-radius:9px;background:rgba(220,38,38,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">${_dashRenderIcon(a.icon,a.color,17)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</div>
                  <div style="font-size:.67rem;color:var(--muted)">Fatura em aberto${isFX?` · ${a.currency}`:''} · ${pct}% dos ativos</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:.9rem;font-weight:800;font-family:var(--font-serif);color:var(--red,#dc2626)">−${dashFmt(bal, a.currency||'BRL')}</div>
                  ${isFX?`<div style="font-size:.67rem;color:var(--muted)">= −${dashFmt(balBRL,'BRL')}</div>`:''}
                </div>
              </div>
              ${_bar(pct,'#dc2626')}`;
          }).join('')}
        </div>` : ''}

        <!-- Dívidas -->
        ${debts.length ? `
        <div>
          <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px;padding-left:2px">Dívidas Ativas</div>
          ${debts.map(d => {
            const bal    = parseFloat(d.current_balance??d.original_amount)||0;
            const balBRL = toBRL(bal, d.currency||'BRL');
            const orig   = parseFloat(d.original_amount)||0;
            const progPct = orig > 0 ? Math.max(0,Math.min(100,((orig-bal)/orig)*100)).toFixed(0) : null;
            const isFX   = _isFX(d.currency||'BRL');
            const pct    = _pct(balBRL, ativosBase);
            const sub    = [d.creditor?.name, _adjLabel[d.adjustment_type], d.fixed_rate?`${(+d.fixed_rate).toFixed(2)}% a.m.`:null].filter(Boolean).join(' · ');
            return `
              <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:rgba(220,38,38,.05);border:1px solid rgba(220,38,38,.12);margin-bottom:3px">
                <div style="width:34px;height:34px;border-radius:9px;background:rgba(220,38,38,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.9rem">💸</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name||'Dívida')}</div>
                  ${sub?`<div style="font-size:.67rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub)}</div>`:''}
                  ${progPct!==null?`
                  <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
                    <div style="flex:1;height:3px;border-radius:3px;background:var(--border);overflow:hidden">
                      <div style="height:100%;width:${progPct}%;background:var(--accent);border-radius:3px;transition:width .4s"></div>
                    </div>
                    <span style="font-size:.62rem;color:var(--muted);white-space:nowrap">${progPct}% quitado</span>
                  </div>`:''}
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:.9rem;font-weight:800;font-family:var(--font-serif);color:var(--red,#dc2626)">−${dashFmt(bal,d.currency||'BRL')}</div>
                  ${isFX?`<div style="font-size:.67rem;color:var(--muted)">= −${dashFmt(balBRL,'BRL')}</div>`:''}
                  <div style="font-size:.62rem;color:var(--muted)">${pct}% dos ativos</div>
                </div>
              </div>
              ${_bar(pct,'#dc2626')}`;
          }).join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- ═══ RODAPÉ LÍQUIDO ═════════════════════════════════════════ -->
      <div style="border-top:2px solid var(--border);margin-top:4px;padding-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span style="font-size:.8rem;font-weight:800;color:var(--text)">Patrimônio Líquido Total</span>
          <span style="font-size:1.2rem;font-weight:900;font-family:var(--font-serif);color:${totalBRL>=0?'var(--accent)':'var(--red,#dc2626)'}">${dashFmt(totalBRL,'BRL')}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:rgba(26,102,68,.07);border-radius:10px;padding:10px 12px">
            <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:3px">Maior ativo</div>
            ${(() => {
              const all = [...accsLiquid,...accsInvest,...accsCard.filter(a=>(parseFloat(a.balance)||0)>0)];
              const top = all.sort((a,b)=>toBRL(Math.abs(parseFloat(b.balance)||0),b.currency||'BRL')-toBRL(Math.abs(parseFloat(a.balance)||0),a.currency||'BRL'))[0];
              if (!top) return `<div style="font-size:.8rem;color:var(--muted)">—</div>`;
              const brl = toBRL(Math.abs(parseFloat(top.balance)||0),top.currency||'BRL');
              return `<div style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(top.name)}</div>
                      <div style="font-size:.7rem;color:var(--accent);font-weight:700">${dashFmt(brl,'BRL')}</div>`;
            })()}
          </div>
          <div style="background:${totalPassivos>0?'rgba(220,38,38,.06)':'rgba(26,102,68,.07)'};border-radius:10px;padding:10px 12px">
            <div style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:3px">
              ${totalPassivos>0?'Maior passivo':'Sem passivos'}
            </div>
            ${totalPassivos > 0 ? (() => {
              const top = [...debts].sort((a,b)=>toBRL(parseFloat(b.current_balance||b.original_amount)||0,b.currency||'BRL')-toBRL(parseFloat(a.current_balance||a.original_amount)||0,a.currency||'BRL'))[0];
              const topCard = accsCard.filter(a=>(parseFloat(a.balance)||0)<0).sort((a,b)=>Math.abs(parseFloat(b.balance)||0)-Math.abs(parseFloat(a.balance)||0))[0];
              const item = top || topCard;
              if (!item) return `<div style="font-size:.8rem;color:var(--muted)">—</div>`;
              const brl = top ? toBRL(parseFloat(top.current_balance||top.original_amount)||0,top.currency||'BRL') : toBRL(Math.abs(parseFloat(topCard.balance)||0),topCard.currency||'BRL');
              const name = top ? top.name : topCard.name;
              return `<div style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</div>
                      <div style="font-size:.7rem;color:var(--red,#dc2626);font-weight:700">−${dashFmt(brl,'BRL')}</div>`;
            })() : `<div style="font-size:.8rem;color:var(--accent);font-weight:600">✓ Patrimônio livre</div>`}
          </div>
        </div>
        <div style="font-size:.68rem;color:var(--muted);text-align:center">
          ${accs.length} conta${accs.length!==1?'s':''} · ${invPositions.length} posição${invPositions.length!==1?'ões':''} de investimento · ${debts.length} dívida${debts.length!==1?'s':''}
        </div>
      </div>

    </div><!-- /padding -->
  </div>`; // /container

  let modal = document.getElementById('patrimonioModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'patrimonioModal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) closeModal('patrimonioModal'); };
    modal.innerHTML = `<div class="modal" style="max-width:500px;max-height:88dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;padding:0;border-radius:18px"><div class="modal-handle"></div><div id="patrimonioModalBody"></div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('patrimonioModalBody').innerHTML = html;
  openModal('patrimonioModal');
}
window._openPatrimonioModal = _openPatrimonioModal;

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Orçamentos
══════════════════════════════════════════════════════════════════ */

let _dashBudgetChart = null;

async function _loadDashBudgetsCard() {
  const card = document.getElementById('dashCardBudgets');
  const body = document.getElementById('dashBudgetsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();
  if (prefs['budgets'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';
  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando orçamentos…</div>';

  try {
    const now = new Date();
    const y   = now.getFullYear();
    const m   = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

    // Fetch all budgets and filter client-side (compatible with all schema versions)
    // Excluir pausados do total — paused=true são standby e não contam
    const { data: allBudgets } = await famQ(
      sb.from('budgets').select('id,amount,category_id,budget_type,month,year,paused,categories(id,name,icon,color)')
    ).order('amount', { ascending: false });

    const bRows = (allBudgets || []).filter(b => {
      if (b.paused) return false; // pausados ficam fora do dashboard
      // year column may come as string or number depending on DB driver
      if (b.budget_type === 'annual') return String(b.year) === String(y);
      const bMonth = (b.month || '').slice(0, 7);
      return bMonth === `${y}-${m}`;
    });

    if (!bRows.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:20px 16px;color:var(--muted)">
          <div style="font-size:1.8rem;margin-bottom:6px">🎯</div>
          <div style="font-size:.83rem;font-weight:600">Nenhum orçamento para este mês</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('budgets')">Criar orçamento</button>
        </div>`;
      return;
    }

    const hasAnnual = bRows.some(b => b.budget_type === 'annual');

    // Fetch spending: current month for monthly budgets; YTD for annual budgets
    // We run two queries in parallel when annual budgets exist
    // Alinhar com módulo de orçamentos: sem filtro de status (inclui pending + confirmed)
    const txMonthQ = famQ(
      sb.from('transactions').select('category_id,amount,brl_amount,currency')
    ).gte('date', `${y}-${m}-01`).lte('date', `${y}-${m}-${String(lastDay).padStart(2,'0')}`).lt('amount', 0);

    const txYtdQ = hasAnnual
      ? famQ(sb.from('transactions').select('category_id,amount,brl_amount,currency'))
          .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`).lt('amount', 0)
      : Promise.resolve({ data: [] });

    const [{ data: txMonth }, { data: txYtd }] = await Promise.all([txMonthQ, txYtdQ]);

    const _sumBycat = (rows) => {
      // Usar amount diretamente como o módulo de orçamentos faz (igual ao buildRawSpending)
      const map = {};
      (rows || []).forEach(t => {
        if (!t.category_id) return;
        map[t.category_id] = (map[t.category_id] || 0) + Math.abs(parseFloat(t.amount) || 0);
      });
      return map;
    };
    const spentMonthBycat = _sumBycat(txMonth);
    const spentYtdBycat   = hasAnnual ? _sumBycat(txYtd) : spentMonthBycat;

    // Helper: soma categoria pai + todas as subcategorias (igual ao _categoryFamily do módulo)
    const _catFamily = (catId) => {
      const cats = state.categories || [];
      const ids = new Set([catId]);
      // Nível 1: filhos diretos
      cats.forEach(c => { if (c.parent_id === catId) ids.add(c.id); });
      // Nível 2: filhos dos filhos
      const lvl1 = new Set(ids);
      cats.forEach(c => { if (lvl1.has(c.parent_id) && c.id !== catId) ids.add(c.id); });
      return ids;
    };

    // Sort: most exceeded first, then by % used desc
    // Annual budgets use YTD spending; monthly use current-month spending
    const enriched = bRows.map(b => {
      const limit    = parseFloat(b.amount) || 0;
      const spentMap = b.budget_type === 'annual' ? spentYtdBycat : spentMonthBycat;
      // Somar hierarquia de subcategorias (igual ao módulo)
      const famIds = _catFamily(b.category_id);
      let spent = 0;
      famIds.forEach(cid => { spent += (spentMap[cid] || 0); });
      const pct  = limit > 0 ? (spent / limit) * 100 : 0;
      const over = spent > limit;
      return { ...b, limit, spent, pct, over };
    }).sort((a, b) => (b.over - a.over) || (b.pct - a.pct));

    const totalLimit  = enriched.reduce((s, b) => s + b.limit, 0);
    const totalSpent  = enriched.reduce((s, b) => s + b.spent, 0);
    const overallPct  = totalLimit > 0 ? Math.min((totalSpent / totalLimit) * 100, 100) : 0;
    const overCount   = enriched.filter(b => b.over).length;

    // Donut chart data
    const chartLabels = enriched.slice(0, 8).map(b => b.categories?.name || 'Sem categoria');
    const chartSpent  = enriched.slice(0, 8).map(b => b.spent);
    const chartColors = enriched.slice(0, 8).map((b, i) => {
      const base = b.categories?.color || ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669','#d97706','#0891b2'][i % 8];
      return b.over ? '#dc2626' : base;
    });

    // Build HTML
    let html = `
      <!-- KPI summary -->
      <div style="display:flex;align-items:stretch;gap:0;border-bottom:1px solid var(--border)">
        <div style="flex:1;padding:12px 16px;border-right:1px solid var(--border)">
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px">Gasto</div>
          <div style="font-size:1.15rem;font-weight:800;font-family:var(--font-serif);color:${totalSpent>totalLimit?'var(--red)':'var(--text)'}">${dashFmt(totalSpent,'BRL')}</div>
          <div style="font-size:.68rem;color:var(--muted)">de ${dashFmt(totalLimit,'BRL')}</div>
        </div>
        <div style="flex:1;padding:12px 16px;border-right:1px solid var(--border)">
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px">Uso geral</div>
          <div style="font-size:1.15rem;font-weight:800;font-family:var(--font-serif);color:${overallPct>=90?'var(--red)':overallPct>=70?'#b45309':'var(--accent)'}">${overallPct.toFixed(0)}%</div>
          <div style="font-size:.68rem;color:var(--muted)">${hasAnnual?'incl. YTD':'do mês'}</div>
        </div>
        <div style="flex:1;padding:12px 16px">
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px">Estourados</div>
          <div style="font-size:1.15rem;font-weight:800;font-family:var(--font-serif);color:${overCount>0?'var(--red)':'var(--accent)'}">${overCount}</div>
          <div style="font-size:.68rem;color:var(--muted)">de ${enriched.length} categoria${enriched.length!==1?'s':''}</div>
        </div>
      </div>

      <!-- Chart + bars side-by-side on wider screens -->
      <div style="display:flex;gap:0;align-items:flex-start">
        <div style="flex:0 0 120px;padding:12px 8px 8px 12px;display:flex;flex-direction:column;align-items:center;gap:4px">
          <canvas id="dashBudgetDonut" width="100" height="100" style="max-width:100px;max-height:100px"></canvas>
          <div style="font-size:.6rem;color:var(--muted);text-align:center;margin-top:2px">por categoria</div>
        </div>
        <div style="flex:1;padding:10px 14px 10px 6px;display:flex;flex-direction:column;gap:7px">`;

    enriched.slice(0, 6).forEach(b => {
      const icon    = b.categories?.icon || '📦';
      const name    = b.categories?.name || 'Sem categoria';
      const color   = b.over ? '#dc2626' : (b.categories?.color || 'var(--accent)');
      const barPct  = Math.min(b.pct, 100);
      const overage = b.over ? `+${dashFmt(b.spent - b.limit,'BRL')}` : '';
      const catIdSafe = (b.category_id||'').replace(/'/g,'');
      const nameSafe  = (name||'').replace(/'/g,'').replace(/"/g,'');
      html += `
          <div style="cursor:pointer;border-radius:7px;padding:4px 5px;margin:-4px -5px;transition:background .12s"
            onclick="_openBudgetTxModal('${catIdSafe}','${nameSafe}','${b.budget_type||'monthly'}')"
            onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:.75rem;font-weight:600;color:var(--text);display:flex;align-items:center;gap:4px">
                <span>${icon}</span>${esc(name)}${b.budget_type==='annual'?'<span style="font-size:.58rem;background:rgba(29,78,216,.1);color:#1d4ed8;border-radius:4px;padding:1px 4px;margin-left:3px">YTD</span>':''}${b.over?`<span style="font-size:.6rem;background:rgba(220,38,38,.12);color:#dc2626;border-radius:4px;padding:1px 4px;margin-left:2px">${esc(overage)}</span>`:''}
              </span>
              <span style="font-size:.7rem;color:${b.pct>=90?'var(--red)':'var(--muted)'};white-space:nowrap">${b.pct.toFixed(0)}% <span style="font-size:.6rem;opacity:.6">▶</span></span>
            </div>
            <div style="height:5px;border-radius:3px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${barPct}%;background:${color};border-radius:3px;transition:width .5s ease"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:2px">
              <span style="font-size:.62rem;color:var(--muted)">${dashFmt(b.spent,'BRL')}</span>
              <span style="font-size:.62rem;color:var(--muted)">${dashFmt(b.limit,'BRL')}</span>
            </div>
          </div>`;
    });

    if (enriched.length > 6) {
      html += `<div style="font-size:.72rem;color:var(--muted);text-align:center;padding:4px 0">… e mais ${enriched.length - 6} categoria${enriched.length-6!==1?'s':''}</div>`;
    }

    html += `
        </div>
      </div>
      <div style="padding:6px 14px 10px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="navigate('budgets')">Ver orçamentos completos →</button>
      </div>`;

    // Destroy previous chart BEFORE replacing innerHTML (avoids "canvas in use" error)
    if (_dashBudgetChart) { try { _dashBudgetChart.destroy(); } catch(_) {} _dashBudgetChart = null; }
    body.innerHTML = html;

    // Render donut chart
    const donutCanvas = document.getElementById('dashBudgetDonut');
    if (donutCanvas && typeof Chart !== 'undefined' && chartSpent.some(v => v > 0)) {
      _dashBudgetChart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: chartLabels,
          datasets: [{ data: chartSpent, backgroundColor: chartColors, borderColor: 'var(--surface)', borderWidth: 2 }],
        },
        options: {
          responsive: false,
          cutout: '62%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.label}: ${dashFmt(ctx.parsed,'BRL')}`,
              },
            },
          },
        },
      });
    }
  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ ${esc(e.message)}</div>`;
  }
}
window._loadDashBudgetsCard = _loadDashBudgetsCard;

// ── Modal: transações que compõem um orçamento ─────────────────────────────
async function _openBudgetTxModal(categoryId, categoryName, budgetType) {
  // Calcular período
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  const dateFrom = budgetType === 'annual' ? `${y}-01-01` : `${y}-${m}-01`;
  const dateTo   = budgetType === 'annual' ? `${y}-12-31` : `${y}-${m}-${String(lastDay).padStart(2,'0')}`;
  const period   = budgetType === 'annual' ? `Ano ${y}` : `${String(now.getMonth()+1).padStart(2,'0')}/${y}`;

  // Coletar ids da família de categorias (pai + filhos)
  const allCats = state.categories || [];
  const famIds = new Set([categoryId]);
  allCats.forEach(c => { if (c.parent_id === categoryId) famIds.add(c.id); });
  const lvl1 = new Set(famIds);
  allCats.forEach(c => { if (lvl1.has(c.parent_id)) famIds.add(c.id); });

  // Criar/reabrir modal
  document.getElementById('budgetTxModal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'budgetTxModal';
  overlay.style.zIndex = '10020';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;max-height:85dvh;display:flex;flex-direction:column">
      <div class="modal-handle"></div>
      <div class="modal-header" style="flex-shrink:0">
        <div>
          <div class="modal-title">${esc(categoryName)}</div>
          <div style="font-size:.7rem;color:var(--muted);margin-top:1px">Transações do orçamento · ${period}</div>
        </div>
        <button class="modal-close" onclick="document.getElementById('budgetTxModal')?.remove()">✕</button>
      </div>
      <div id="budgetTxBody" style="flex:1;overflow-y:auto;padding:14px 16px">
        <div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">⏳ Carregando…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = document.getElementById('budgetTxBody');
  try {
    const { data: txs, error } = await famQ(
      sb.from('transactions')
        .select('id,date,description,amount,currency,brl_amount,payees(name),accounts!transactions_account_id_fkey(name,icon,color)')
    ).in('category_id', [...famIds])
     .gte('date', dateFrom).lte('date', dateTo)
     .lt('amount', 0)
     .order('date', { ascending: false });

    if (error) throw error;
    if (!txs || !txs.length) {
      body.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:8px">📭</div>
        <div style="font-size:.85rem">Nenhuma transação neste período para este orçamento.</div>
      </div>`;
      return;
    }

    const total = txs.reduce((s, t) => s + Math.abs(parseFloat(t.amount)||0), 0);
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
        <span style="font-size:.75rem;color:var(--muted)">${txs.length} transaç${txs.length===1?'ão':'ões'}</span>
        <span style="font-size:.95rem;font-weight:800;font-family:var(--font-serif);color:var(--red,#dc2626)">−${dashFmt(total,'BRL')}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">`;

    txs.forEach(t => {
      const amt     = Math.abs(parseFloat(t.amount)||0);
      const payee   = t.payees?.name || '';
      const acct    = t.accounts?.name || '';
      const desc    = t.description || payee || '—';
      const sub     = [payee !== desc ? payee : '', acct].filter(Boolean).join(' · ');
      html += `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--surface2);cursor:pointer;transition:background .12s"
          onclick="document.getElementById('budgetTxModal')?.remove();editTransaction('${t.id}')"
          onmouseover="this.style.background='var(--bg2,rgba(0,0,0,.04))'" onmouseout="this.style.background='var(--surface2)'">
          <div style="flex:1;min-width:0">
            <div style="font-size:.83rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(desc)}</div>
            <div style="font-size:.67rem;color:var(--muted)">${fmtDate(t.date)}${sub ? ' · ' + esc(sub) : ''}</div>
          </div>
          <div style="font-size:.88rem;font-weight:700;font-family:var(--font-serif);color:var(--red,#dc2626);flex-shrink:0">−${dashFmt(amt,'BRL')}</div>
        </div>`;
    });
    html += `</div>`;
    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:.82rem">⚠️ ${esc(e.message)}</div>`;
  }
}
window._openBudgetTxModal = _openBudgetTxModal;

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Investimentos
══════════════════════════════════════════════════════════════════ */

let _dashInvChart = null;

async function _loadDashInvestmentsCard() {
  const card = document.getElementById('dashCardInvestments');
  const body = document.getElementById('dashInvestmentsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();

  if (prefs['investments'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';
  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando carteira…</div>';

  try {
    // Garantir que investimentos estão carregados — força reload se positions vazia
    if (typeof loadInvestments === 'function') {
      const needLoad = typeof _inv === 'undefined' || !_inv.loaded || (_inv.positions || []).length === 0;
      if (needLoad) {
        try { await loadInvestments(true); } catch(e) { console.warn('[inv card]', e?.message); }
      }
    }

    // Fallback: buscar posições direto do banco se _inv ainda vazio
    let positions = (typeof _inv !== 'undefined') ? (_inv.positions || []) : [];
    if (!positions.length && sb) {
      try {
        const { data: posData } = await famQ(
          sb.from('investment_positions').select('*')
        ).order('ticker');
        positions = (posData || []).filter(p => (+(p.quantity) || 0) > 0);
      } catch(e) { console.warn('[inv card] direct fetch:', e?.message); }
    }

    const totalMV = positions.length
      ? positions.reduce((s, p) => {
          const price = (p.currency && p.currency !== 'BRL')
            ? toBRL(+(p.current_price||0), p.currency)
            : +(p.current_price||0);
          return s + (+(p.quantity)||0) * price;
        }, 0)
      : (typeof invTotalPortfolioValue === 'function' ? invTotalPortfolioValue() : 0);

    if (!positions.length) {
      // Check if module is truly disabled or just empty
      const invModEnabled = (typeof isModuleEnabled === 'function') ? isModuleEnabled('investments') : false;
      body.innerHTML = invModEnabled
        ? `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
            <div style="font-size:2rem;margin-bottom:8px">📊</div>
            <div style="font-size:.83rem;font-weight:600">Nenhuma posição registrada</div>
            <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('investments')">Registrar investimento</button>
          </div>`
        : `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
            <div style="font-size:2rem;margin-bottom:8px">📈</div>
            <div style="font-size:.83rem;font-weight:600;color:var(--text2);margin-bottom:6px">Módulo de Investimentos</div>
            <div style="font-size:.78rem;line-height:1.5;margin-bottom:14px">Ative este módulo nas configurações da família.</div>
            <button class="btn btn-ghost btn-sm" onclick="navigate('settings')">Configurar módulo →</button>
          </div>`;
      return;
    }

    // Agrupamento por tipo
    const byType = {};
    positions.forEach(p => {
      const k = p.asset_type || 'outro';
      if (!byType[k]) byType[k] = { total: 0, count: 0 };
      const mv = (typeof _invMarketValue === 'function') ? _invMarketValue(p) : (+(p.quantity||0) * (+(p.current_price||p.avg_cost||0)));
      byType[k].total += mv;
      byType[k].count++;
    });

    const typeEmoji = { acao_br:'🇧🇷',fii:'🏢',etf_br:'📊',acao_us:'🇺🇸',etf_us:'📈',bdr:'🌐',fundo:'🏦',crypto:'₿',renda_fixa:'💰',outro:'📌' };
    const typeLabel = { acao_br:'Ações BR',fii:'FII',etf_br:'ETF BR',acao_us:'Ações US',etf_us:'ETF US',bdr:'BDR',fundo:'Fundos',crypto:'Cripto',renda_fixa:'Renda Fixa',outro:'Outros' };

    // KPI total + retorno
    const totalCost = positions.reduce((s,p) => s + (+(p.quantity||0) * (+(p.avg_cost||0))), 0);
    const pnl       = totalMV - totalCost;
    const pnlPct    = totalCost > 0 ? (pnl / totalCost * 100) : 0;

    // ── Individual positions by value descending ──
    const sortedPositions = [...positions]
      .map(p => {
        const price = (p.currency && p.currency !== 'BRL')
          ? toBRL(+(p.current_price||0), p.currency)
          : +(p.current_price||0);
        const mv    = (+(p.quantity)||0) * price;
        const cost  = (+(p.quantity)||0) * (+(p.avg_cost)||0);
        const pnlP  = mv - cost;
        const pnlPP = cost > 0 ? (pnlP / cost * 100) : 0;
        return { ...p, _mv: mv, _cost: cost, _pnl: pnlP, _pnlPct: pnlPP };
      })
      .filter(p => p._mv > 0)
      .sort((a, b) => b._mv - a._mv);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px 10px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(30,91,66,.06),transparent)">
        <div>
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Valor de mercado</div>
          <div style="font-size:1.35rem;font-weight:800;font-family:var(--font-serif);color:var(--accent);line-height:1.1">${dashFmt(totalMV,'BRL')}</div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:2px">${sortedPositions.length} posições</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.65rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em">Resultado total</div>
          <div style="font-size:.95rem;font-weight:800;color:${pnl>=0?'var(--accent)':'var(--red)'}">
            ${pnl>=0?'+':''}${dashFmt(pnl,'BRL')}
          </div>
          <div style="font-size:.7rem;font-weight:700;color:${pnlPct>=0?'var(--accent)':'var(--red)'}">
            ${pnlPct>=0?'▲':'▼'} ${Math.abs(pnlPct).toFixed(2)}%
          </div>
        </div>
      </div>`;

    // Chart + bars layout
    const sortedTypes = Object.entries(byType).sort(([,a],[,b]) => b.total - a.total);
    const typeColors  = ['#2a6049','#1d4ed8','#b45309','#7c3aed','#dc2626','#059669','#d97706','#0891b2','#be185d','#0369a1'];

    html += `
      <div style="display:flex;gap:0;align-items:flex-start">
        <div style="flex:0 0 120px;padding:12px 8px 8px 12px;display:flex;flex-direction:column;align-items:center;gap:4px">
          <canvas id="dashInvDonut" width="100" height="100" style="max-width:100px;max-height:100px"></canvas>
          <div style="font-size:.6rem;color:var(--muted);text-align:center;margin-top:2px">por tipo</div>
        </div>
        <div style="flex:1;padding:10px 14px 8px 6px;display:flex;flex-direction:column;gap:7px">`;

    sortedTypes.slice(0, 6).forEach(([k, grp], i) => {
      const pct   = totalMV > 0 ? (grp.total / totalMV * 100) : 0;
      const color = typeColors[i % typeColors.length];
      html += `
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:.74rem;font-weight:700;color:var(--text);display:flex;align-items:center;gap:5px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></span>
                ${typeEmoji[k]||'📌'} ${typeLabel[k]||k}
              </span>
              <span style="font-size:.72rem;font-weight:700;color:var(--text2);white-space:nowrap">${dashFmt(grp.total,'BRL')} <span style="color:var(--muted);font-weight:400">${pct.toFixed(1)}%</span></span>
            </div>
            <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
              <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};border-radius:3px;transition:width .4s ease"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:2px">
              <span style="font-size:.62rem;color:var(--muted)">${grp.count} ativo${grp.count!==1?'s':''}</span>
              <span style="font-size:.62rem;color:var(--muted)">${dashFmt(grp.total,'BRL')}</span>
            </div>
          </div>`;
    });

    html += `
        </div>
      </div>
      <div style="padding:6px 14px 10px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="navigate('investments')">Ver carteira completa →</button>
      </div>`;

    // ── Individual positions list ─────────────────────────────────────
    if (sortedPositions.length > 0) {
      html += `
        <div style="border-top:1px solid var(--border);padding:10px 14px 12px">
          <div style="font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">Posições</div>
          <div style="display:flex;flex-direction:column;gap:5px">`;
      sortedPositions.slice(0, 7).forEach(p => {
        html += `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--bg2);cursor:pointer"
              onclick="navigate('investments')">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:baseline;gap:5px">
                  <span style="font-size:.8rem;font-weight:800;color:var(--text)">${esc(p.ticker)}</span>
                  <span style="font-size:.66rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px">${esc(p.name||'')}</span>
                </div>
                <div style="font-size:.63rem;color:var(--muted)">${+(p.quantity)||0} un.</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:.82rem;font-weight:700;color:var(--text)">${dashFmt(p._mv,'BRL')}</div>
                <div style="font-size:.64rem;font-weight:700;color:${p._pnl>=0?'var(--accent)':'var(--red)'}">${p._pnl>=0?'+':''}${dashFmt(p._pnl,'BRL')}</div>
              </div>
            </div>`;
      });
      if (sortedPositions.length > 7) {
        html += `<div style="text-align:center;padding:5px 0;font-size:.7rem;color:var(--accent);cursor:pointer;font-weight:600" onclick="navigate('investments')">
          +${sortedPositions.length - 7} posições → ver carteira completa
        </div>`;
      }
      html += `</div></div>`;
    }

    // Destroy previous chart BEFORE replacing innerHTML
    if (_dashInvChart) { try { _dashInvChart.destroy(); } catch(_) {} _dashInvChart = null; }
    body.innerHTML = html;

    // Render donut
    const invCanvas = document.getElementById('dashInvDonut');
    if (invCanvas && typeof Chart !== 'undefined' && sortedTypes.length) {
      _dashInvChart = new Chart(invCanvas, {
        type: 'doughnut',
        data: {
          labels: sortedTypes.slice(0,6).map(([k]) => typeLabel[k]||k),
          datasets: [{
            data: sortedTypes.slice(0,6).map(([,g]) => g.total),
            backgroundColor: sortedTypes.slice(0,6).map((_,i) => typeColors[i%typeColors.length]),
            borderColor: 'var(--surface)',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: false,
          cutout: '62%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.label}: ${dashFmt(ctx.parsed,'BRL')}`,
              },
            },
          },
        },
      });
    }
  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ Erro ao carregar: ${esc(e.message)}</div>`;
  }
}
window._loadDashInvestmentsCard = _loadDashInvestmentsCard;

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD — Card de Sonhos
══════════════════════════════════════════════════════════════════ */

async function _loadDashDreamsCard() {
  const card = document.getElementById('dashCardDreams');
  const body = document.getElementById('dashDreamsBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();

  // Verificar se módulo dreams está habilitado para a família
  const modEnabled = (typeof isModuleEnabled === 'function')
    ? isModuleEnabled('dreams')
    : true;

  if (prefs['dreams'] === false) { card.style.display = 'none'; return; }

  if (!modEnabled) {
    body.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:8px">🌟</div>
      <div style="font-size:.83rem;font-weight:600;color:var(--text2);margin-bottom:6px">Módulo de Sonhos</div>
      <div style="font-size:.78rem;line-height:1.5;margin-bottom:14px">Ative este módulo nas configurações da família para acompanhar seus sonhos financeiros.</div>
      <button class="btn btn-ghost btn-sm" onclick="navigate('settings')">Configurar módulo →</button>
    </div>`;
    return;
  }

  body.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;font-size:.83rem">⏳ Carregando sonhos…</div>';

  try {
    // Carregar sonhos se não estiver no cache
    let dreams = [];
    if (typeof _drm !== 'undefined' && _drm.dreams?.length) {
      dreams = _drm.dreams.filter(d => d.status === 'active');
    } else {
      const { data } = await famQ(
        sb.from('dreams').select('*, dream_contributions(amount)').eq('status','active').order('priority').limit(5)
      );
      dreams = data || [];
    }

    if (!dreams.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:24px 16px;color:var(--muted)">
          <div style="font-size:2rem;margin-bottom:8px">🌟</div>
          <div style="font-size:.83rem;font-weight:600">Nenhum sonho ativo</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigate('dreams')">Criar meu primeiro sonho</button>
        </div>`;
      return;
    }

    const _dreamEmoji = { viagem:'✈️', automovel:'🚗', imovel:'🏠', cirurgia_plastica:'💉', estudos:'🎓', outro:'🌟' };

    // Total acumulado / total meta
    const totalMeta  = dreams.reduce((s,d) => s + (+(d.target_amount)||0), 0);
    const totalAcum  = dreams.reduce((s,d) => {
      const contribs = Array.isArray(d.dream_contributions) ? d.dream_contributions : (d._contributions || []);
      return s + contribs.reduce((cs, c) => cs + (+(c.amount)||0), 0);
    }, 0);
    const totalPct   = totalMeta > 0 ? Math.min(totalAcum / totalMeta * 100, 100) : 0;

    let html = `
      <div style="padding:14px 16px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">${dreams.length} sonho${dreams.length!==1?'s':''} ativo${dreams.length!==1?'s':''}</div>
          <div style="font-size:1rem;font-weight:800;font-family:var(--font-serif);color:var(--accent)">${dashFmt(totalAcum,'BRL')} de ${dashFmt(totalMeta,'BRL')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.72rem;color:var(--muted);margin-bottom:3px">${totalPct.toFixed(0)}% concluído</div>
          <div style="width:80px;height:6px;border-radius:3px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${totalPct.toFixed(1)}%;background:var(--accent);border-radius:3px;transition:width .6s ease"></div>
          </div>
        </div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:8px">`;

    dreams.slice(0, 4).forEach(d => {
      const contribs = Array.isArray(d.dream_contributions) ? d.dream_contributions : (d._contributions || []);
      const acum   = contribs.reduce((s,c) => s + (+(c.amount)||0), 0);
      const meta   = +(d.target_amount) || 0;
      const pct    = meta > 0 ? Math.min(acum / meta * 100, 100) : 0;
      const emoji  = _dreamEmoji[d.dream_type] || '🌟';
      const prioColor = d.priority === 1 ? 'var(--red)' : d.priority === 2 ? 'var(--amber)' : 'var(--muted)';

      html += `
        <div style="cursor:pointer" onclick="navigate('dreams')"
          onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:.9rem">${emoji}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:.82rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title||'—')}</span>
                <span style="font-size:.72rem;color:var(--muted);flex-shrink:0;margin-left:6px">${pct.toFixed(0)}%</span>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted)">
                <span>${dashFmt(acum,'BRL')} / ${dashFmt(meta,'BRL')}</span>
                <span style="color:${prioColor}">P${d.priority||1}</span>
              </div>
            </div>
          </div>
          <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
            <div style="height:100%;width:${pct.toFixed(1)}%;background:var(--accent);border-radius:2px;transition:width .5s ease"></div>
          </div>
        </div>`;
    });

    if (dreams.length > 4) {
      html += `<div style="font-size:.75rem;color:var(--muted);text-align:center;padding-top:4px">+ ${dreams.length - 4} sonho${dreams.length-4!==1?'s':''}</div>`;
    }

    html += `<div style="text-align:center;margin-top:4px">
      <button class="btn btn-ghost btn-sm" onclick="navigate('dreams')">Ver todos os sonhos →</button>
    </div></div>`;

    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div class="text-muted" style="text-align:center;padding:16px;font-size:.8rem">⚠️ Erro ao carregar: ${esc(e.message)}</div>`;
  }
}
window._loadDashDreamsCard = _loadDashDreamsCard;

window._loadDashDreamsCard = _loadDashDreamsCard;

// ── Card: Top Beneficiários e Fontes Pagadoras ────────────────────────────
async function _loadDashTopPayeesCard() {
  const card = document.getElementById('dashCardTopPayees');
  const body = document.getElementById('dashTopPayeesBody');
  if (!card || !body) return;

  const prefs = _dashGetPrefs();
  if (prefs['toppayees'] === false) { card.style.display = 'none'; return; }
  card.style.display = '';
  body.innerHTML = '<div class="dcard-loading">⏳ Carregando…</div>';

  try {
    const now  = new Date();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const mFrom = `${y}-${m}-01`;
    const mTo   = `${y}-${m}-${String(lastDay).padStart(2,'0')}`;
    const yFrom = `${y}-01-01`;
    const yTo   = `${y}-12-31`;

    // Fetch with full tx details needed for drill-down
    const _sel = 'id,date,description,amount,brl_amount,currency,payee_id,payees(id,name,type),categories(name,color)';
    const [{ data: txMonth }, { data: txYear }] = await Promise.all([
      famQ(sb.from('transactions').select(_sel))
        .gte('date', mFrom).lte('date', mTo).not('payee_id','is',null),
      famQ(sb.from('transactions').select(_sel))
        .gte('date', yFrom).lte('date', yTo).not('payee_id','is',null),
    ]);

    // Agregar por payee — guardar txs completas para drill-down
    const _aggregate = (rows) => {
      const exp = {}, inc = {};
      (rows || []).forEach(t => {
        const pid  = t.payee_id;
        const name = t.payees?.name || pid;
        const type = t.payees?.type || 'beneficiario';
        const amt  = Math.abs(parseFloat(t.brl_amount ?? t.amount) || 0);
        if (parseFloat(t.amount) < 0) {
          if (!exp[pid]) exp[pid] = { id: pid, name, type, total: 0, count: 0, txs: [] };
          exp[pid].total += amt; exp[pid].count++;
          exp[pid].txs.push(t);
        } else {
          if (!inc[pid]) inc[pid] = { id: pid, name, type, total: 0, count: 0, txs: [] };
          inc[pid].total += amt; inc[pid].count++;
          inc[pid].txs.push(t);
        }
      });
      const topExp = Object.values(exp).sort((a,b)=>b.total-a.total).slice(0,10);
      const topInc = Object.values(inc).sort((a,b)=>b.total-a.total).slice(0,5);
      return { topExp, topInc };
    };

    const month = _aggregate(txMonth);
    const year  = _aggregate(txYear);

    // Guardar dados para o drill-down (acesso pelo handler de click)
    window._dashPayeeDrillData = { month, year };

    const _payeeRow = (p, i, maxVal, isYear) => {
      const bar    = maxVal > 0 ? Math.min(p.total / maxVal * 100, 100).toFixed(1) : 0;
      const isInc  = p.type === 'fonte_pagadora';
      const color  = isInc ? '#16a34a' : 'var(--accent)';
      const scope  = isYear ? 'year' : 'month';
      const bucket = isInc  ? 'inc'   : 'exp';
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;
          cursor:pointer;transition:background .12s;margin:-2px -8px"
          onclick="_dashPayeeDrill('${esc(p.id)}','${scope}','${bucket}')"
          onmouseover="this.style.background='var(--surface2)'"
          onmouseout="this.style.background=''">
          <span style="font-size:.65rem;font-weight:700;color:var(--muted);width:14px;text-align:right;flex-shrink:0">${i+1}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
              <span style="font-size:.78rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${esc(p.name)}</span>
              <span style="font-size:.75rem;font-weight:700;color:${isInc?'#16a34a':'var(--text)'};white-space:nowrap;margin-left:6px">${isInc?'+':'−'}${dashFmt(p.total,'BRL')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:3px;border-radius:2px;background:var(--border);overflow:hidden">
                <div style="height:100%;width:${bar}%;background:${color};border-radius:2px;transition:width .5s"></div>
              </div>
              <span style="font-size:.6rem;color:var(--muted);flex-shrink:0">${p.count} tx</span>
            </div>
          </div>
          <span style="font-size:.7rem;color:var(--muted);flex-shrink:0">›</span>
        </div>`;
    };

    const _section = (title, items, isYear) => {
      if (!items.length) return '';
      const max = items[0]?.total || 1;
      return `
        <div style="margin-bottom:14px">
          <div style="font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
            color:var(--muted);margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--border)">${title}</div>
          ${items.map((p,i) => _payeeRow(p, i, max, isYear)).join('')}
        </div>`;
    };

    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid var(--border)">
        <div style="padding:10px 14px;border-right:1px solid var(--border)">
          <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px">Despesas/mês</div>
          <div style="font-size:1.05rem;font-weight:800;font-family:var(--font-serif)">${dashFmt(month.topExp.reduce((s,p)=>s+p.total,0),'BRL')}</div>
        </div>
        <div style="padding:10px 14px">
          <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px">Receitas/mês</div>
          <div style="font-size:1.05rem;font-weight:800;font-family:var(--font-serif);color:#16a34a">${dashFmt(month.topInc.reduce((s,p)=>s+p.total,0),'BRL')}</div>
        </div>
      </div>
      <div style="padding:12px 14px">
        ${_section(`Top 10 Beneficiários — ${String(now.getMonth()+1).padStart(2,'0')}/${y}`, month.topExp, false)}
        ${_section(`Top 5 Fontes Pagadoras — ${String(now.getMonth()+1).padStart(2,'0')}/${y}`, month.topInc, false)}
        ${_section(`Top 5 Beneficiários — Ano ${y}`, year.topExp.slice(0,5), true)}
        ${_section(`Top 5 Fontes Pagadoras — Ano ${y}`, year.topInc.slice(0,5), true)}
      </div>
      <div style="padding:2px 14px 10px;text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="navigate('reports');setTimeout(()=>setReportView&&setReportView('payees'),300)">
          Relatório completo →
        </button>
      </div>`;

    body.innerHTML = html;
  } catch(e) {
    body.innerHTML = `<div class="dcard-loading">⚠️ ${esc(e.message)}</div>`;
  }
}
window._loadDashTopPayeesCard = _loadDashTopPayeesCard;

// ── Drill-down: mostrar transações de um beneficiário/fonte ─────────────────
function _dashPayeeDrill(payeeId, scope, bucket) {
  const data   = window._dashPayeeDrillData;
  if (!data) return;

  const list   = data[scope][bucket === 'exp' ? 'topExp' : 'topInc'];
  const entry  = list.find(p => p.id === payeeId);
  if (!entry) return;

  const isInc  = bucket === 'inc';
  const color  = isInc ? '#16a34a' : '#dc2626';
  const total  = entry.total;
  const txs    = [...entry.txs].sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // Remove modal existente se houver
  document.getElementById('dashPayeeDrillModal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'dashPayeeDrillModal';
  overlay.style.zIndex = '10025';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const rows = txs.map(t => {
    const amt   = Math.abs(parseFloat(t.brl_amount ?? t.amount) || 0);
    const catColor = t.categories?.color || (isInc ? '#16a34a' : '#94a3b8');
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;
        border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s"
        onclick="overlay.remove();editTransaction('${t.id}')"
        onmouseover="this.style.background='var(--surface2)'"
        onmouseout="this.style.background=''">
        <div style="width:7px;height:7px;border-radius:50%;background:${catColor};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.83rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(t.description || entry.name || '—')}
          </div>
          <div style="font-size:.68rem;color:var(--muted)">
            ${fmtDate(t.date)}${t.categories?.name ? ' · ' + esc(t.categories.name) : ''}
          </div>
        </div>
        <span style="font-size:.88rem;font-weight:700;color:${color};flex-shrink:0;margin-left:8px">
          ${isInc ? '+' : '−'}${dashFmt(amt,'BRL')}
        </span>
      </div>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;max-height:85dvh;display:flex;flex-direction:column;padding:0;border-radius:16px">
      <div class="modal-handle"></div>
      <!-- Header -->
      <div style="padding:14px 16px 12px;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.95rem;font-weight:800;color:var(--text)">${esc(entry.name)}</div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:1px">
              ${txs.length} transaç${txs.length===1?'ão':'ões'} · ${scope === 'year' ? 'Ano ' + new Date().getFullYear() : 'Mês atual'}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.1rem;font-weight:900;font-family:var(--font-serif);color:${color}">
              ${isInc ? '+' : '−'}${dashFmt(total,'BRL')}
            </div>
            <button onclick="document.getElementById('dashPayeeDrillModal').remove()"
              style="font-size:.7rem;color:var(--muted);background:none;border:none;cursor:pointer;margin-top:2px">
              Fechar ✕
            </button>
          </div>
        </div>
        <!-- Barra de progresso (total desta entrada vs total do período) -->
        <div style="height:3px;border-radius:3px;background:var(--border);margin-top:10px;overflow:hidden">
          <div style="height:100%;width:100%;background:${color};border-radius:3px"></div>
        </div>
      </div>
      <!-- Lista de transações -->
      <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch">
        ${rows || '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.85rem">Nenhuma transação</div>'}
      </div>
    </div>`;

  // Corrigir o onclick das linhas (overlay não está no escopo do template literal)
  document.body.appendChild(overlay);

  // Rewire os cliques nas linhas para fechar o modal correto
  overlay.querySelectorAll('[onclick*="overlay.remove"]').forEach(el => {
    const txId = el.getAttribute('onclick').match(/editTransaction\('([^']+)'\)/)?.[1];
    if (txId) {
      el.removeAttribute('onclick');
      el.addEventListener('click', () => {
        overlay.remove();
        if (typeof editTransaction === 'function') editTransaction(txId);
      });
    }
  });
}
window._dashPayeeDrill = _dashPayeeDrill;

window._catColor                           = _catColor;
window._dashCustomSave                     = _dashCustomSave;
window._dashGetPrefs                       = _dashGetPrefs;
window._dashSavePrefs                      = _dashSavePrefs;
window._dashMoveCard                       = _dashMoveCard;
window._dashToggleCard                     = _dashToggleCard;
window._renderDashFavCategories            = _renderDashFavCategories;
window.closeCatDetail                      = closeCatDetail;
window.loadDashboard                       = loadDashboard;
window.loadDashboardRecent                 = loadDashboardRecent;
window.openDashCustomModal                 = openDashCustomModal;
