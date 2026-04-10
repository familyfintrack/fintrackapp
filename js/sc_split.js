// ════════════════════════════════════════════════════════════════════════════
// SC_SPLIT — Divisão de Transações Programadas
// Design standalone, independente de tx_splits.js
// ════════════════════════════════════════════════════════════════════════════

/* eslint-disable no-undef */

// ── State ────────────────────────────────────────────────────────────────────
const _scSplitState = {
  catRows:   [], // [{id, cat_id, cat_name, cat_color, cat_parent, amount, cents}]
  memRows:   [], // [{id, mem_id, mem_name, amount, cents, pct}]
  activeTab: 'cat',
  memMode:   'value', // 'value' | 'pct'
  totalAmt:  0,       // numeric total of the scheduled transaction
  seq:       0,
};

// ── BRL mask helpers ─────────────────────────────────────────────────────────
function _scSplAmtInput(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  if (!raw) { el.dataset.cents = '0'; el.value = ''; return; }
  const cents = parseInt(raw.slice(-13) || '0', 10);
  el.dataset.cents = String(cents);
  const r = Math.floor(cents / 100), c = cents % 100;
  el.value = r.toLocaleString('pt-BR') + ',' + String(c).padStart(2, '0');
  try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
}
function _scSplAmtBlur(el) {
  let cents = parseInt(el.dataset.cents || '0', 10);
  if (!cents) {
    const raw = el.value.replace(/\./g, '').replace(',', '.');
    cents = Math.round(Math.abs(parseFloat(raw) || 0) * 100);
    el.dataset.cents = String(cents);
  }
  if (!cents) { el.value = ''; return; }
  const r = Math.floor(cents / 100), c = cents % 100;
  el.value = r.toLocaleString('pt-BR') + ',' + String(c).padStart(2, '0');
}
function _scSplFmt(n) {
  if (!n) return 'R$ 0,00';
  return typeof fmt === 'function' ? fmt(n, 'BRL') : 'R$ ' + Math.abs(n).toFixed(2).replace('.', ',');
}
function _scSplCentsToNum(cents) { return Math.round(parseInt(cents || 0, 10)) / 100; }

// ── Open modal ───────────────────────────────────────────────────────────────
function openScSplitModal() {
  // Read total from the scheduled form
  const amt = Math.abs(getAmtField('scAmount') || 0);
  _scSplitState.totalAmt = amt;

  const infoBar = document.getElementById('scSplitTotalTx');
  if (infoBar) infoBar.textContent = _scSplFmt(amt);

  // Switch to active tab
  scSplitSwitchTab(_scSplitState.activeTab || 'cat');
  openModal('scSplitModal');
}
window.openScSplitModal = openScSplitModal;

// ── Tab switching ────────────────────────────────────────────────────────────
function scSplitSwitchTab(tab) {
  _scSplitState.activeTab = tab;
  const catPane = document.getElementById('scSplitPaneCat');
  const memPane = document.getElementById('scSplitPaneMem');
  const catBtn  = document.getElementById('scSplitBtnCat');
  const memBtn  = document.getElementById('scSplitBtnMem');

  const onStyle  = 'flex:1;padding:8px 10px;border-radius:9px;border:1.5px solid var(--accent);background:var(--accent);color:#fff;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s';
  const offStyle = 'flex:1;padding:8px 10px;border-radius:9px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text2);font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s';

  if (tab === 'cat') {
    if (catPane) catPane.style.display = '';
    if (memPane) memPane.style.display = 'none';
    if (catBtn)  catBtn.style.cssText = onStyle;
    if (memBtn)  memBtn.style.cssText = offStyle;
    _scSplRenderCatRows();
  } else {
    if (catPane) catPane.style.display = 'none';
    if (memPane) memPane.style.display = '';
    if (catBtn)  catBtn.style.cssText = offStyle;
    if (memBtn)  memBtn.style.cssText = onStyle;
    _scSplRenderMemRows();
  }
}
window.scSplitSwitchTab = scSplitSwitchTab;

// ── Clear all ─────────────────────────────────────────────────────────────────
function scSplitClear() {
  _scSplitState.catRows = [];
  _scSplitState.memRows = [];
  _scSplRenderCatRows();
  _scSplRenderMemRows();
}
window.scSplitClear = scSplitClear;

// ── Confirm ───────────────────────────────────────────────────────────────────
function scSplitConfirm() {
  const tab = _scSplitState.activeTab;
  const total = _scSplitState.totalAmt;

  if (tab === 'cat') {
    const dist = _scSplitState.catRows.reduce((s, r) => s + (r.amount || 0), 0);
    const diff = Math.abs(Math.round((total - dist) * 100));
    if (diff > 1) {
      toast(`Diferença de ${_scSplFmt(total - dist)} — ajuste os valores antes de confirmar.`, 'warning');
      return;
    }
  } else {
    const dist = _scSplitState.memMode === 'pct'
      ? _scSplitState.memRows.reduce((s, r) => s + (r.pct || 0), 0)
      : _scSplitState.memRows.reduce((s, r) => s + (r.amount || 0), 0);
    const expected = _scSplitState.memMode === 'pct' ? 100 : total;
    const diff = Math.abs(Math.round((expected - dist) * (_scSplitState.memMode === 'pct' ? 1 : 100)));
    if (diff > 1) {
      toast(_scSplitState.memMode === 'pct'
        ? `Total de percentuais: ${dist.toFixed(1)}% (esperado 100%).`
        : `Diferença de ${_scSplFmt(expected - dist)} — ajuste os valores.`, 'warning');
      return;
    }
  }
  closeModal('scSplitModal');
  toast('✔ Divisão configurada', 'success');
}
window.scSplitConfirm = scSplitConfirm;

// ── Export getters ────────────────────────────────────────────────────────────
function scSplitGetCatRows()  { return _scSplitState.catRows.filter(r => r.cat_id && r.amount > 0); }
function scSplitGetMemRows()  { return _scSplitState.memRows.filter(r => r.mem_id && (r.amount > 0 || r.pct > 0)); }
function scSplitHasData()     { return scSplitGetCatRows().length > 0 || scSplitGetMemRows().length > 0; }
window.scSplitGetCatRows = scSplitGetCatRows;
window.scSplitGetMemRows = scSplitGetMemRows;
window.scSplitHasData    = scSplitHasData;

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY ROWS
// ════════════════════════════════════════════════════════════════════════════

function scSplitAddCatRow() {
  _scSplitState.catRows.push({ id: ++_scSplitState.seq, cat_id:'', cat_name:'', cat_color:'#94a3b8', cat_parent:'', amount:0, cents:0 });
  _scSplRenderCatRows();
  // Auto-focus the new row's cat button after render
  setTimeout(() => {
    const rows = document.querySelectorAll('#scSplitCatRows .scs-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.scs-cat-btn')?.focus();
  }, 60);
}
window.scSplitAddCatRow = scSplitAddCatRow;

function scSplitRemoveCatRow(id) {
  _scSplitState.catRows = _scSplitState.catRows.filter(r => r.id !== id);
  _scSplRenderCatRows();
}
window.scSplitRemoveCatRow = scSplitRemoveCatRow;

function scSplitPickCat(rowId) {
  if (typeof openCatChooser !== 'function') return;
  openCatChooser('tx', (catId, catName, catColor) => {
    const row = _scSplitState.catRows.find(r => r.id === rowId);
    if (!row) return;
    row.cat_id    = catId   || '';
    row.cat_color = catColor || '#94a3b8';
    // Build "Parent › Child" label
    const cat    = (state.categories || []).find(c => c.id === catId);
    const parent = cat?.parent_id ? (state.categories || []).find(c => c.id === cat.parent_id) : null;
    row.cat_name   = catName || '';
    row.cat_parent = parent?.name || '';
    _scSplRenderCatRows();
  });
}
window.scSplitPickCat = scSplitPickCat;

function scSplitUpdateCatAmt(rowId, el) {
  const row = _scSplitState.catRows.find(r => r.id === rowId);
  if (!row) return;
  const cents = parseInt(el.dataset.cents || '0', 10);
  row.cents  = cents;
  row.amount = cents / 100;
  _scSplUpdateCatSummary();
}
window.scSplitUpdateCatAmt = scSplitUpdateCatAmt;

function _scSplRenderCatRows() {
  const container = document.getElementById('scSplitCatRows');
  if (!container) return;
  const total = _scSplitState.totalAmt;

  if (!_scSplitState.catRows.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.8rem">Nenhuma linha. Clique em "+ Adicionar categoria".</div>';
    _scSplUpdateCatSummary();
    return;
  }

  container.innerHTML = _scSplitState.catRows.map(row => {
    const hasCat   = !!row.cat_id;
    const label    = hasCat
      ? (row.cat_parent
          ? `<span style="background:${row.cat_color};width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.cat_parent)} › ${esc(row.cat_name)}</span>`
          : `<span style="background:${row.cat_color};width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.cat_name)}</span>`)
      : `<span style="color:var(--muted)">— Selecionar categoria —</span>`;
    const cents    = row.cents || 0;
    const amtFmt   = cents > 0 ? Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0') : '';

    return `<div class="scs-row" id="scsCatRow_${row.id}" style="display:flex;align-items:center;gap:8px;padding:6px 0">
      <button type="button" class="scs-cat-btn" onclick="scSplitPickCat(${row.id})"
        style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--surface2);border:1.5px solid ${hasCat?'var(--accent)':'var(--border)'};border-radius:9px;cursor:pointer;font-size:.8rem;font-family:inherit;text-align:left;overflow:hidden">
        ${label}
      </button>
      <div style="width:115px;flex-shrink:0;position:relative">
        <input type="text" inputmode="numeric" placeholder="0,00"
          value="${amtFmt}" data-cents="${cents}"
          oninput="_scSplAmtInput(this);scSplitUpdateCatAmt(${row.id},this)"
          onblur="_scSplAmtBlur(this);scSplitUpdateCatAmt(${row.id},this)"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;background:var(--surface);color:var(--text);font-family:var(--font-serif,monospace);text-align:right;box-sizing:border-box">
      </div>
      <button type="button" onclick="scSplitRemoveCatRow(${row.id})"
        style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.9rem;padding:4px;border-radius:6px;flex-shrink:0;transition:background .12s"
        onmouseover="this.style.background='rgba(220,38,38,.1)';this.style.color='#dc2626'"
        onmouseout="this.style.background='none';this.style.color='var(--muted)'">✕</button>
    </div>`;
  }).join('');

  _scSplUpdateCatSummary();
}

function _scSplUpdateCatSummary() {
  const summaryEl = document.getElementById('scSplitCatSummary');
  const distEl    = document.getElementById('scSplitCatDist');
  const diffEl    = document.getElementById('scSplitCatDiff');
  if (!summaryEl) return;

  const rows  = _scSplitState.catRows;
  const total = _scSplitState.totalAmt;
  if (rows.length < 2) { summaryEl.style.display = 'none'; return; }

  const dist = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const diff = total - dist;
  summaryEl.style.display = '';
  if (distEl) distEl.textContent = _scSplFmt(dist);
  if (diffEl) {
    const ok = Math.abs(Math.round(diff * 100)) <= 1;
    diffEl.style.color = ok ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
    diffEl.textContent = ok ? '✔ Total confere!' : (diff > 0 ? `Faltam ${_scSplFmt(diff)}` : `Excesso de ${_scSplFmt(-diff)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MEMBER ROWS
// ════════════════════════════════════════════════════════════════════════════

function scSplitAddMemRow() {
  _scSplitState.memRows.push({ id: ++_scSplitState.seq, mem_id:'', mem_name:'', amount:0, cents:0, pct:0 });
  _scSplRenderMemRows();
}
window.scSplitAddMemRow = scSplitAddMemRow;

function scSplitRemoveMemRow(id) {
  _scSplitState.memRows = _scSplitState.memRows.filter(r => r.id !== id);
  _scSplRenderMemRows();
}
window.scSplitRemoveMemRow = scSplitRemoveMemRow;

function scSplitSetMemMode(mode) {
  _scSplitState.memMode = mode;
  const valBtn = document.getElementById('scSplitMemModeValBtn');
  const pctBtn = document.getElementById('scSplitMemModePctBtn');
  const onS  = 'padding:5px 14px;border-radius:7px;border:1.5px solid var(--accent);background:var(--accent);color:#fff;font-size:.76rem;font-weight:700;cursor:pointer;font-family:inherit';
  const offS = 'padding:5px 14px;border-radius:7px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text2);font-size:.76rem;font-weight:700;cursor:pointer;font-family:inherit';
  if (valBtn) valBtn.style.cssText = mode === 'value' ? onS : offS;
  if (pctBtn) pctBtn.style.cssText = mode === 'pct'   ? onS : offS;
  _scSplRenderMemRows();
}
window.scSplitSetMemMode = scSplitSetMemMode;

function scSplitUpdateMemAmt(rowId, el) {
  const row = _scSplitState.memRows.find(r => r.id === rowId);
  if (!row) return;
  if (_scSplitState.memMode === 'pct') {
    const raw = el.value.replace(/[^0-9.,]/g,'').replace(',','.');
    row.pct = Math.min(100, Math.abs(parseFloat(raw) || 0));
    const total = _scSplitState.totalAmt;
    row.amount = total > 0 ? Math.round(row.pct / 100 * total * 100) / 100 : 0;
    row.cents  = Math.round(row.amount * 100);
  } else {
    const cents = parseInt(el.dataset.cents || '0', 10);
    row.cents  = cents;
    row.amount = cents / 100;
    const total = _scSplitState.totalAmt;
    row.pct = total > 0 ? Math.round(row.amount / total * 10000) / 100 : 0;
  }
  _scSplUpdateMemSummary();
}
window.scSplitUpdateMemAmt = scSplitUpdateMemAmt;

function scSplitUpdateMember(rowId, memId) {
  const row = _scSplitState.memRows.find(r => r.id === rowId);
  if (!row) return;
  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const mem = members.find(m => m.id === memId);
  row.mem_id   = memId;
  row.mem_name = mem?.name || '';
}
window.scSplitUpdateMember = scSplitUpdateMember;

function _scSplRenderMemRows() {
  const container = document.getElementById('scSplitMemRows');
  if (!container) return;
  const members  = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const usedIds  = new Set(_scSplitState.memRows.map(r => r.mem_id).filter(Boolean));
  const isPct    = _scSplitState.memMode === 'pct';
  const total    = _scSplitState.totalAmt;

  if (!_scSplitState.memRows.length) {
    // Show quick-add buttons for each member
    const quickBtns = members.map(m =>
      `<button type="button" onclick="scSplitQuickAddMem('${m.id}','${esc(m.name)}')"
        style="padding:6px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:.76rem;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit">
        ${m.avatar_emoji || '👤'} + ${esc(m.name)}</button>`).join('');
    const equalBtn = members.length > 1
      ? `<button type="button" onclick="scSplitEqualSplit()" style="margin-top:6px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit">⚡ Dividir igualmente (${members.length} membros)</button>`
      : '';
    container.innerHTML = `<div style="text-align:center;padding:10px 0;color:var(--muted);font-size:.8rem;margin-bottom:8px">Adicione membros abaixo:</div><div style="display:flex;flex-wrap:wrap;gap:6px">${quickBtns}</div>${equalBtn}`;
    _scSplUpdateMemSummary();
    return;
  }

  container.innerHTML = _scSplitState.memRows.map(row => {
    // Build member select — exclude members already in other rows
    const opts = members.map(m => {
      const disabled = usedIds.has(m.id) && m.id !== row.mem_id;
      return `<option value="${m.id}" ${m.id === row.mem_id ? 'selected' : ''} ${disabled ? 'disabled style="color:var(--muted)"' : ''}>${m.avatar_emoji || '👤'} ${esc(m.name)}</option>`;
    }).join('');

    const cents = row.cents || 0;
    const amtFmt = isPct
      ? (row.pct > 0 ? row.pct.toFixed(1).replace('.', ',') + ' %' : '')
      : (cents > 0 ? Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0') : '');

    return `<div class="scs-row" id="scsMemRow_${row.id}" style="display:flex;align-items:center;gap:8px;padding:5px 0">
      <select onchange="scSplitUpdateMember(${row.id},this.value)"
        style="flex:1;padding:8px 10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;color:var(--text);font-family:inherit;cursor:pointer">
        <option value="">— Selecionar membro —</option>
        ${opts}
      </select>
      <div style="width:115px;flex-shrink:0">
        <input type="text" inputmode="${isPct?'decimal':'numeric'}" placeholder="${isPct?'0,0 %':'0,00'}"
          value="${amtFmt}" ${!isPct ? `data-cents="${cents}"` : ''}
          oninput="${isPct?'scSplitUpdateMemAmt('+row.id+',this)':'_scSplAmtInput(this);scSplitUpdateMemAmt('+row.id+',this)'}"
          onblur="${isPct?'':'_scSplAmtBlur(this);scSplitUpdateMemAmt('+row.id+',this)'}"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;background:var(--surface);color:var(--text);font-family:var(--font-serif,monospace);text-align:right;box-sizing:border-box">
      </div>
      <button type="button" onclick="scSplitRemoveMemRow(${row.id})"
        style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.9rem;padding:4px;border-radius:6px;flex-shrink:0;transition:background .12s"
        onmouseover="this.style.background='rgba(220,38,38,.1)';this.style.color='#dc2626'"
        onmouseout="this.style.background='none';this.style.color='var(--muted)'">✕</button>
    </div>`;
  }).join('');

  _scSplUpdateMemSummary();
}

function scSplitQuickAddMem(memId, memName) {
  const already = _scSplitState.memRows.find(r => r.mem_id === memId);
  if (already) return;
  _scSplitState.memRows.push({ id: ++_scSplitState.seq, mem_id: memId, mem_name: memName, amount: 0, cents: 0, pct: 0 });
  _scSplRenderMemRows();
}
window.scSplitQuickAddMem = scSplitQuickAddMem;

function scSplitEqualSplit() {
  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const total   = _scSplitState.totalAmt;
  _scSplitState.memRows = [];
  const each    = members.length ? Math.round(total / members.length * 100) / 100 : 0;
  const eCents  = Math.round(each * 100);
  members.forEach((m, i) => {
    _scSplitState.memRows.push({
      id: ++_scSplitState.seq,
      mem_id: m.id, mem_name: m.name,
      amount: i < members.length - 1 ? each : Math.round((total - each * (members.length - 1)) * 100) / 100,
      cents:  i < members.length - 1 ? eCents : Math.round((total - each * (members.length - 1)) * 100),
      pct:    Math.round(100 / members.length * 10) / 10,
    });
  });
  _scSplRenderMemRows();
}
window.scSplitEqualSplit = scSplitEqualSplit;

function _scSplUpdateMemSummary() {
  const summaryEl = document.getElementById('scSplitMemSummary');
  const distEl    = document.getElementById('scSplitMemDist');
  const diffEl    = document.getElementById('scSplitMemDiff');
  if (!summaryEl) return;

  const rows  = _scSplitState.memRows;
  const total = _scSplitState.totalAmt;
  const isPct = _scSplitState.memMode === 'pct';
  if (rows.length < 2) { summaryEl.style.display = 'none'; return; }

  const dist     = isPct ? rows.reduce((s,r)=>s+(r.pct||0),0) : rows.reduce((s,r)=>s+(r.amount||0),0);
  const expected = isPct ? 100 : total;
  const diff     = expected - dist;
  summaryEl.style.display = '';
  if (distEl) distEl.textContent = isPct ? dist.toFixed(1) + ' %' : _scSplFmt(dist);
  if (diffEl) {
    const ok = Math.abs(Math.round(diff * (isPct ? 10 : 100))) <= (isPct ? 1 : 1);
    diffEl.style.color = ok ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
    diffEl.textContent = ok ? '✔ Total confere!' : (isPct ? `Faltam ${diff.toFixed(1)}%` : (diff > 0 ? `Faltam ${_scSplFmt(diff)}` : `Excesso de ${_scSplFmt(-diff)}`));
  }
}

// ── Reset when scheduled modal opens ─────────────────────────────────────────
function _scSplitReset() {
  _scSplitState.catRows  = [];
  _scSplitState.memRows  = [];
  _scSplitState.activeTab= 'cat';
  _scSplitState.memMode  = 'value';
  _scSplitState.totalAmt = 0;
}

// Hook into scheduled modal open — reset split state
const _origOpenScheduledModal = typeof window.openScheduledModal === 'function' ? window.openScheduledModal : null;
window._scSplitReset = _scSplitReset;
