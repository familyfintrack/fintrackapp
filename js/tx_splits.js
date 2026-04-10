/* ═══════════════════════════════════════════════════════════════════════════
   TX SPLITS — Divisão de transação por categoria e por membro
   Dependências: state.categories, getFamilyMembers(), fmt(), getAmtField()
   Chamado pelo modal de transação (transactions.js)
═══════════════════════════════════════════════════════════════════════════ */

// ── Estado interno ────────────────────────────────────────────────────────
const _txSplit = {
  catRows: [],   // [{id, category_id, category_name, category_color, amount}]
  memRows: [],   // [{id, member_id, member_name, amount, pct}]
  memMode: 'value',  // 'value' | 'pct'
  activeTab: 'cat',
};
let _txSplitRowSeq = 0;

// ── Abertura da aba ───────────────────────────────────────────────────────
function txSplitTabOpened(ctx) {
  // ctx='sc' for scheduled modal, else TX modal
  const amtField = ctx === 'sc' ? 'scAmount' : 'txAmount';
  const txAmt = Math.abs(getAmtField(amtField) || 0);
  if (ctx === 'sc') {
    _scSplitRenderCat(txAmt);
    _scSplitRenderMem(txAmt);
    scSplitShowTab(_scSplit.activeTab || 'cat');
  } else {
    _txSplitRenderCat(txAmt);
    _txSplitRenderMem(txAmt);
    txSplitShowTab(_txSplit.activeTab);
  }
}

// ── Open split modal from tx modal ────────────────────────────────────────
function _openSplitModal() {
  // Read amount robustly: try el.value first, fallback to dataset.cents
  const el = document.getElementById('txAmount');
  let txAmt = 0;
  if (el) {
    const cents = parseInt(el.dataset?.cents || '0', 10) || 0;
    txAmt = cents > 0 ? cents / 100 : Math.abs(getAmtField('txAmount') || 0);
  }
  _txSplit.activeTab = 'cat';
  _txSplitRenderCatModal(txAmt);
  _txSplitRenderMemModal(txAmt);
  txSplitShowModalTab('cat');
  openModal('txSplitModal');
}
window._openSplitModal = _openSplitModal;

function txSplitShowModalTab(tab) {
  _txSplit.activeTab = tab;
  const cat = document.getElementById('txSplitModalCatPane');
  const mem = document.getElementById('txSplitModalMemPane');
  const btnCat = document.getElementById('txSplitModalTabCat');
  const btnMem = document.getElementById('txSplitModalTabMem');
  if (cat) cat.style.display = tab === 'cat' ? '' : 'none';
  if (mem) mem.style.display = tab === 'mem' ? '' : 'none';
  if (btnCat) btnCat.classList.toggle('active', tab === 'cat');
  if (btnMem) btnMem.classList.toggle('active', tab === 'mem');
}
window.txSplitShowModalTab = txSplitShowModalTab;

// Render category splits directly into modal pane
function _txSplitRenderCatModal(txAmt) {
  const container = document.getElementById('txCatSplitRowsM');
  if (!container) return;
  container.innerHTML = _txSplit.catRows.map(row => _txSplitCatRowHtml(row, txAmt, 'M')).join('');
  _txSplitUpdateCatTotals(txAmt, 'M');
}
// Render member splits directly into modal pane  
function _txSplitRenderMemModal(txAmt) {
  const container = document.getElementById('txMemSplitRowsM');
  if (!container) return;
  container.innerHTML = _txSplit.memRows.map(row => _txSplitMemRowHtml(row, txAmt)).join('');
  _txSplitUpdateMemTotals(txAmt, 'M');
}

window.txSplitTabOpened = txSplitTabOpened;

function txSplitShowTab(tab) {
  _txSplit.activeTab = tab;
  document.getElementById('txSplitCatPane').style.display = tab === 'cat' ? '' : 'none';
  document.getElementById('txSplitMemPane').style.display = tab === 'mem' ? '' : 'none';
  document.getElementById('txSplitTabCat').classList.toggle('active', tab === 'cat');
  document.getElementById('txSplitTabMem').classList.toggle('active', tab === 'mem');
}
window.txSplitShowTab = txSplitShowTab;

// ── CATEGORY SPLITS ───────────────────────────────────────────────────────

function txCatSplitAddRow(prefill) {
  const id = ++_txSplitRowSeq;
  _txSplit.catRows.push({
    id,
    category_id:    prefill?.category_id    || '',
    category_name:  prefill?.category_name  || '',
    category_color: prefill?.category_color || '#94a3b8',
    amount:         prefill?.amount         || 0,
  });
  _txSplitRenderCat();
  // Se o split modal estiver aberto, sincronizar
  const splitModal = document.getElementById('txSplitModal');
  if (splitModal && splitModal.classList.contains('open')) {
    const _el = document.getElementById('txAmount');
    const _c  = parseInt(_el?.dataset?.cents||'0',10)||0;
    const txAmt = _c > 0 ? _c/100 : Math.abs(getAmtField('txAmount')||0);
    if (typeof _txSplitRenderCatModal === 'function') _txSplitRenderCatModal(txAmt);
  }
  setTimeout(() => {
    const input = document.querySelector(`#txCatSplitRow_${id} .tx-split-amount-input`)
               || document.querySelector(`#txCatSplitRowM_${id} .tx-split-amount-input`);
    if (input) input.focus();
  }, 60);
}
window.txCatSplitAddRow = txCatSplitAddRow;

function txCatSplitRemoveRow(id) {
  _txSplit.catRows = _txSplit.catRows.filter(r => r.id !== id);
  _txSplitRenderCat();
  const splitModal = document.getElementById('txSplitModal');
  if (splitModal && splitModal.classList.contains('open')) {
    const txAmt = Math.abs(getAmtField('txAmount') || 0);
    if (typeof _txSplitRenderCatModal === 'function') _txSplitRenderCatModal(txAmt);
  }
}
window.txCatSplitRemoveRow = txCatSplitRemoveRow;

function txCatSplitPickCategory(rowId) {
  _txSplitPendingCatRowId = rowId;  // set BEFORE opening chooser
  if (typeof openCatChooser === 'function') {
    openCatChooser('tx', function(catId, catName, catColor) {
      _txSplitPendingCatRowId = rowId;  // ensure still set on callback
      if (typeof txCatSplitReceiveCategory === 'function')
        txCatSplitReceiveCategory(catId, catName, catColor || '#94a3b8');
    });
  } else {
    window._txSplitCatMode = rowId;
    toggleCatPicker('tx');
  }
}
window.txCatSplitPickCategory = txCatSplitPickCategory;

// Chamado pelo catPicker quando está em modo split
let _txSplitPendingCatRowId = null;
function txCatSplitReceiveCategory(catId, catName, catColor) {
  const _cat=(state.categories||[]).find(c=>c.id===catId);
  const _parent=_cat?.parent_id?(state.categories||[]).find(c=>c.id===_cat.parent_id):null;
  if (_txSplitPendingCatRowId === null) return;
  const row = _txSplit.catRows.find(r => r.id === _txSplitPendingCatRowId);
  if (row) {
    row.category_id    = catId;
    row.category_name  = catName;
    row.category_color = catColor || '#94a3b8';
  }
  _txSplitPendingCatRowId = null;
  _txSplitRenderCat();
}
window.txCatSplitReceiveCategory = txCatSplitReceiveCategory;

function txCatSplitUpdateAmount(rowId, rawVal) {
  const row = _txSplit.catRows.find(r => r.id === rowId);
  if (!row) return;
  // Read from data-cents (set by BRL mask) if available; else parse the displayed value
  const el = document.querySelector(`#txCatSplitRow_${rowId} .tx-split-amount-input`) ||
             document.querySelector(`#txCatSplitRowM_${rowId} .tx-split-amount-input`);
  const cents = el ? parseInt(el.dataset.cents || '0', 10) : 0;
  row.amount = cents
    ? cents / 100
    : Math.abs(parseFloat(String(rawVal).replace(/\./g,'').replace(',','.')) || 0);
  _txSplitUpdateCatTotals();
}
window.txCatSplitUpdateAmount = txCatSplitUpdateAmount;

// Auto-distribui o restante pela última linha sem valor
function txCatSplitAutoFill() {
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  if (!txAmt || _txSplit.catRows.length < 2) return;
  const filled = _txSplit.catRows.slice(0, -1);
  const last   = _txSplit.catRows[_txSplit.catRows.length - 1];
  const used   = filled.reduce((s, r) => s + (r.amount || 0), 0);
  const rest   = Math.max(0, txAmt - used);
  last.amount  = Math.round(rest * 100) / 100;
  _txSplitRenderCat(txAmt);
}
window.txCatSplitAutoFill = txCatSplitAutoFill;


// Shared row HTML builder used by both inline and modal renders
function _txSplitCatRowHtml(row, txAmt, suffix) {
  suffix = suffix || '';
  const hascat = !!row.category_id;
  const dotStyle = hascat
    ? `background:${row.category_color};width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block`
    : 'display:none';
  // Show parent > child for subcategories
  let _catLabel = row.category_name;
  if (hascat && row.category_parent_name) {
    _catLabel = row.category_parent_name + '  ›  ' + row.category_name;
  }
  const btnLabel = hascat
    ? `<span style="${dotStyle}"></span><span style="overflow:hidden;text-overflow:ellipsis">${esc(_catLabel)}</span>`
    : `<span style="color:var(--muted)">— Selecionar categoria —</span>`;
  const _amtCents = Math.round((row.amount || 0) * 100);
  const amtVal = _amtCents > 0 ? Math.floor(_amtCents/100).toLocaleString('pt-BR') + ',' + String(_amtCents%100).padStart(2,'0') : '';
  const rowId = suffix ? `txCatSplitRow${suffix}_${row.id}` : `txCatSplitRow_${row.id}`;
  return `<div class="tx-split-row" id="${rowId}">
      <div class="tx-split-row-left">
        <button type="button" class="tx-split-cat-btn" onclick="txCatSplitPickCategory(${row.id})"
          style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;padding:7px 10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;cursor:pointer;font-size:.8rem;font-family:inherit;text-align:left;overflow:hidden">
          ${btnLabel}
        </button>
        <div class="amt-wrap" style="width:120px;flex-shrink:0">
          <input type="text" class="tx-split-amount-input" inputmode="numeric" placeholder="0,00"
            value="${amtVal}"
            data-cents="${_amtCents}"
            oninput="_txSplitAmtFmt(this);txCatSplitUpdateAmount(${row.id},this.value)"
            onblur="_txSplitAmtBlur(this);txCatSplitUpdateAmount(${row.id},this.value)"
            style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box;text-align:right">
        </div>
      </div>
      <button type="button" onclick="txCatSplitRemoveRow(${row.id})"
        style="padding:5px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;flex-shrink:0">✕</button>
    </div>`;
}

function _txSplitRenderCat(txAmt) {
  const container = document.getElementById('txCatSplitRows');
  const totalEl   = document.getElementById('txCatSplitTotal');
  if (!container) return;
  if (!txAmt) txAmt = Math.abs(getAmtField('txAmount') || 0);

  if (_txSplit.catRows.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:.8rem">Nenhuma divisão configurada.<br>Clique em "+ Adicionar categoria" para começar.</div>';
    if (totalEl) totalEl.style.display = 'none';
    _txSplitUpdateTabBadge();
    return;
  }

  container.innerHTML = _txSplit.catRows.map(row => _txSplitCatRowHtml(row, txAmt)).join('');
  _txSplitUpdateCatTotals(txAmt);
}

function _txSplitUpdateCatTotals(txAmt, suffix) {
  const sfx = suffix || '';
  if (!txAmt) txAmt = Math.abs(getAmtField('txAmount') || 0);
  const totalEl  = document.getElementById('txCatSplitTotal');
  const totalVal = document.getElementById('txCatSplitTotalVal');
  const txValEl  = document.getElementById('txCatSplitTxVal');
  const diffEl   = document.getElementById('txCatSplitDiff');
  if (!totalEl) return;

  if (_txSplit.catRows.length < 2) {
    totalEl.style.display = 'none';
    _txSplitUpdateTabBadge();
    return;
  }
  totalEl.style.display = '';

  const distributed = _txSplit.catRows.reduce((s, r) => s + (r.amount || 0), 0);
  const diff = txAmt - distributed;
  const absDiff = Math.abs(diff);

  if (totalVal) totalVal.textContent = typeof fmt === 'function' ? fmt(distributed) : distributed.toFixed(2);
  if (txValEl)  txValEl.textContent  = typeof fmt === 'function' ? fmt(txAmt) : txAmt.toFixed(2);

  if (diffEl) {
    if (absDiff < 0.005) {
      diffEl.innerHTML = '<span style="color:#16a34a;font-weight:700">✓ Valores conferem</span>';
    } else if (diff > 0) {
      diffEl.innerHTML = `<span style="color:#b45309;font-weight:700">Faltam ${typeof fmt === 'function' ? fmt(diff) : diff.toFixed(2)}</span>
        <button type="button" onclick="txCatSplitAutoFill()" style="margin-left:8px;font-size:.72rem;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">Auto-completar</button>`;
    } else {
      diffEl.innerHTML = `<span style="color:#dc2626;font-weight:700">Excedente: ${typeof fmt === 'function' ? fmt(absDiff) : absDiff.toFixed(2)}</span>`;
    }
  }
  _txSplitUpdateTabBadge();
}

// ── MEMBER SPLITS ─────────────────────────────────────────────────────────

function txMemSplitSetMode(mode) {
  _txSplit.memMode = mode;
  document.getElementById('txMemSplitModeVal').classList.toggle('active', mode === 'value');
  document.getElementById('txMemSplitModePct').classList.toggle('active', mode === 'pct');
  _txSplitRenderMem();
}
window.txMemSplitSetMode = txMemSplitSetMode;

function txMemSplitAddRow(prefill) {
  const id = ++_txSplitRowSeq;
  _txSplit.memRows.push({
    id,
    member_id:   prefill?.member_id   || '',
    member_name: prefill?.member_name || '',
    amount:      prefill?.amount      || 0,
    pct:         prefill?.pct         || 0,
  });
  _txSplitRenderMem();
  setTimeout(() => {
    const inp = document.querySelector(`#txMemSplitRow_${id} .tx-split-amount-input`);
    if (inp) inp.focus();
  }, 50);
  const _sm = document.getElementById('txSplitModal');
  if (_sm && _sm.classList.contains('open')) {
    const _a = Math.abs(getAmtField('txAmount') || 0);
    if (typeof _txSplitRenderMemModal === 'function') _txSplitRenderMemModal(_a);
  }
}
window.txMemSplitAddRow = txMemSplitAddRow;

function txMemSplitRemoveRow(id) {
  _txSplit.memRows = _txSplit.memRows.filter(r => r.id !== id);
  _txSplitRenderMem();
  const _sm2 = document.getElementById('txSplitModal');
  if (_sm2 && _sm2.classList.contains('open')) {
    const _a2 = Math.abs(getAmtField('txAmount') || 0);
    if (typeof _txSplitRenderMemModal === 'function') _txSplitRenderMemModal(_a2);
  }
}
window.txMemSplitRemoveRow = txMemSplitRemoveRow;

function txMemSplitUpdateMember(rowId, memberId) {
  const row = _txSplit.memRows.find(r => r.id === rowId);
  if (!row) return;
  row.member_id = memberId;
  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const m = members.find(x => x.id === memberId);
  row.member_name = m ? m.name : '';
  _txSplitUpdateMemTotals();
}
window.txMemSplitUpdateMember = txMemSplitUpdateMember;

function txMemSplitUpdateValue(rowId, rawVal) {
  const row = _txSplit.memRows.find(r => r.id === rowId);
  if (!row) return;
  const v = parseFloat(String(rawVal).replace(',', '.')) || 0;
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  if (_txSplit.memMode === 'pct') {
    row.pct    = Math.min(100, Math.max(0, v));
    row.amount = txAmt > 0 ? Math.round(txAmt * row.pct / 100 * 100) / 100 : 0;
  } else {
    row.amount = v;
    row.pct    = txAmt > 0 ? Math.round(v / txAmt * 10000) / 100 : 0;
  }
  _txSplitUpdateMemTotals();
}
window.txMemSplitUpdateValue = txMemSplitUpdateValue;

// Distribui igualmente entre todos os membros
function txMemSplitEqualSplit() {
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  const n = _txSplit.memRows.length;
  if (!n || !txAmt) return;
  const each = Math.round(txAmt / n * 100) / 100;
  // Ajuste no último para garantir soma exata
  _txSplit.memRows.forEach((r, i) => {
    if (i < n - 1) {
      r.amount = each;
    } else {
      r.amount = Math.round((txAmt - each * (n - 1)) * 100) / 100;
    }
    r.pct = txAmt > 0 ? Math.round(r.amount / txAmt * 10000) / 100 : 0;
  });
  _txSplitRenderMem(txAmt);
}
window.txMemSplitEqualSplit = txMemSplitEqualSplit;

// Auto-completa o restante na última linha
function txMemSplitAutoFill() {
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  if (!txAmt || _txSplit.memRows.length < 2) return;
  const filled = _txSplit.memRows.slice(0, -1);
  const last   = _txSplit.memRows[_txSplit.memRows.length - 1];
  const used   = filled.reduce((s, r) => s + (r.amount || 0), 0);
  const rest   = Math.max(0, txAmt - used);
  last.amount  = Math.round(rest * 100) / 100;
  last.pct     = txAmt > 0 ? Math.round(rest / txAmt * 10000) / 100 : 0;
  _txSplitRenderMem(txAmt);
}
window.txMemSplitAutoFill = txMemSplitAutoFill;


// ── Shared member row HTML builder (TX modal + inline pane) ──────────────────
function _txSplitMemRowHtml(row, txAmt, suffix) {
  suffix = suffix || '';
  const isPct = _txSplit.memMode === 'pct';
  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  // Exclude members already selected in OTHER rows (each member only once)
  const usedIds = new Set(_txSplit.memRows.filter(r=>r.id!==row.id).map(r=>r.member_id).filter(Boolean));
  const memberOpts = members.map(m =>
    m.id === row.member_id
      ? `<option value="${m.id}" selected>${esc(m.name)}</option>`
      : usedIds.has(m.id)
        ? '' // already used in another row
        : `<option value="${m.id}">${esc(m.name)}</option>`
  ).join('');
  const _memCents = Math.round((row.amount || 0) * 100);
  const dispVal = isPct
    ? (row.pct > 0 ? row.pct.toFixed(1).replace('.', ',') : '')
    : (_memCents > 0 ? Math.floor(_memCents/100).toLocaleString('pt-BR') + ',' + String(_memCents%100).padStart(2,'0') : '');
  const placeholder = isPct ? '0,0%' : '0,00';
  const rowId = suffix ? `txMemSplitRow${suffix}_${row.id}` : `txMemSplitRow_${row.id}`;
  const updateFn = suffix ? `txMemSplitUpdateValue` : `txMemSplitUpdateValue`;
  const memberFn = `txMemSplitUpdateMember`;
  const removeFn = `txMemSplitRemoveRow`;
  return `<div class="tx-split-row" id="${rowId}">
    <div class="tx-split-row-left">
      <select class="tx-split-mem-select" onchange="${memberFn}(${row.id},this.value)"
        style="flex:1;padding:7px 10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;color:var(--text);font-family:inherit;cursor:pointer">
        <option value="">— Selecionar membro —</option>
        ${memberOpts}
      </select>
    </div>
    <div class="tx-split-row-right">
      <div class="amt-wrap" style="width:110px;flex-shrink:0">
        <input type="text" inputmode="decimal" class="tx-split-amount-input"
          placeholder="${placeholder}" value="${dispVal}"
          oninput="_txSplitAmtFmt(this);${updateFn}(${row.id},this.value)"
          onblur="_txSplitAmtBlur(this);${updateFn}(${row.id},this.value)"
          style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box;text-align:right">
      </div>
      <button type="button" onclick="${removeFn}(${row.id})"
        style="padding:5px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem;flex-shrink:0">✕</button>
    </div>
  </div>`;
}

// Auto-format amount input as user types: 1234 → 1.234,00 style
function _txSplitAmtFmt(input) {
  let raw = input.value.replace(/[^\d,\.]/g, '').replace(',', '.').replace(/\.(?=.*\.)/g, '');
  input.value = raw;
}

function _txSplitRenderMem(txAmt) {
  const container = document.getElementById('txMemSplitRows');
  const totalEl   = document.getElementById('txMemSplitTotal');
  if (!container) return;
  if (!txAmt) txAmt = Math.abs(getAmtField('txAmount') || 0);

  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  const memberOpts = members.map(m =>
    `<option value="${m.id}">${esc(m.name)}</option>`
  ).join('');

  if (_txSplit.memRows.length === 0) {
    const quickBtns = members.length > 0
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          ${members.map(m =>
            `<button type="button" onclick="txMemSplitAddRow({member_id:'${m.id}',member_name:'${esc(m.name)}'})"
              style="padding:5px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:.76rem;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit">
              + ${esc(m.name)}
            </button>`
          ).join('')}
        </div>
        <button type="button" onclick="txMemSplitQuickAll()" style="margin-top:8px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit">
          ⚡ Dividir igualmente entre todos
        </button>`
      : '';
    container.innerHTML = `<div style="text-align:center;padding:16px 0;color:var(--muted);font-size:.8rem">Nenhuma divisão configurada.${quickBtns}</div>`;
    if (totalEl) totalEl.style.display = 'none';
    _txSplitUpdateTabBadge();
    return;
  }

  const isPct = _txSplit.memMode === 'pct';
  container.innerHTML = _txSplit.memRows.map(row => _txSplitMemRowHtml(row, txAmt)).join('');

  // Restore select values
  _txSplit.memRows.forEach(row => {
    const sel = document.querySelector(`#txMemSplitRow_${row.id} select`);
    if (sel && row.member_id) sel.value = row.member_id;
  });

  // Botão igualdade
  if (_txSplit.memRows.length >= 2) {
    container.insertAdjacentHTML('beforeend',
      `<button type="button" onclick="txMemSplitEqualSplit()" style="margin-top:6px;width:100%;padding:7px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:.75rem;font-weight:600;color:var(--accent);cursor:pointer;font-family:inherit">
        ⚖️ Distribuir igualmente
      </button>`);
  }

  _txSplitUpdateMemTotals(txAmt);
}

function txMemSplitQuickAll() {
  const members = typeof getFamilyMembers === 'function' ? getFamilyMembers() : [];
  if (!members.length) return;
  _txSplit.memRows = [];
  members.forEach(m => {
    const id = ++_txSplitRowSeq;
    _txSplit.memRows.push({ id, member_id: m.id, member_name: m.name, amount: 0, pct: 0 });
  });
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  _txSplitRenderMem(txAmt);
  txMemSplitEqualSplit();
}
window.txMemSplitQuickAll = txMemSplitQuickAll;

function _txSplitUpdateMemTotals(txAmt) {
  if (!txAmt) txAmt = Math.abs(getAmtField('txAmount') || 0);
  const totalEl  = document.getElementById('txMemSplitTotal');
  const totalVal = document.getElementById('txMemSplitTotalVal');
  const txValEl  = document.getElementById('txMemSplitTxVal');
  const diffEl   = document.getElementById('txMemSplitDiff');
  if (!totalEl) return;

  if (_txSplit.memRows.length < 2) {
    totalEl.style.display = 'none';
    _txSplitUpdateTabBadge();
    return;
  }
  totalEl.style.display = '';

  const distributed = _txSplit.memRows.reduce((s, r) => s + (r.amount || 0), 0);
  const diff = txAmt - distributed;
  const absDiff = Math.abs(diff);

  if (totalVal) totalVal.textContent = typeof fmt === 'function' ? fmt(distributed) : distributed.toFixed(2);
  if (txValEl)  txValEl.textContent  = typeof fmt === 'function' ? fmt(txAmt) : txAmt.toFixed(2);

  if (diffEl) {
    if (absDiff < 0.005) {
      diffEl.innerHTML = '<span style="color:#16a34a;font-weight:700">✓ Valores conferem</span>';
    } else if (diff > 0) {
      diffEl.innerHTML = `<span style="color:#b45309;font-weight:700">Faltam ${typeof fmt === 'function' ? fmt(diff) : diff.toFixed(2)}</span>
        <button type="button" onclick="txMemSplitAutoFill()" style="margin-left:8px;font-size:.72rem;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">Auto-completar</button>`;
    } else {
      diffEl.innerHTML = `<span style="color:#dc2626;font-weight:700">Excedente: ${typeof fmt === 'function' ? fmt(absDiff) : absDiff.toFixed(2)}</span>`;
    }
  }
  _txSplitUpdateTabBadge();
}

// ── Badge na aba Divisão ──────────────────────────────────────────────────
function _txSplitUpdateTabBadge() {
  const btn = document.getElementById('txTabDivisao');
  if (!btn) return;
  const hasCat = _txSplit.catRows.length >= 2;
  const hasMem = _txSplit.memRows.length >= 2;
  const active = hasCat || hasMem;
  if (active) {
    const n = (hasCat ? _txSplit.catRows.length : 0) + (hasMem ? _txSplit.memRows.length : 0);
    btn.innerHTML = `✂️ Divisão <span class="tx-split-indicator">${n}</span>`;
  } else {
    btn.innerHTML = '✂️ Divisão';
  }
}

// ── Leitura para salvar ───────────────────────────────────────────────────
function txSplitGetCategorySplits() {
  if (_txSplit.catRows.length < 2) return [];
  // Valida: todos devem ter categoria
  const valid = _txSplit.catRows.filter(r => r.category_id && r.amount > 0);
  if (valid.length < 2) return [];
  return valid.map(r => ({
    category_id:    r.category_id,
    category_name:  r.category_name,
    category_color: r.category_color,
    amount:         r.amount,
    pct:            0,  // calculado abaixo
  })).map((r, _, arr) => {
    const total = arr.reduce((s, x) => s + x.amount, 0);
    r.pct = total > 0 ? Math.round(r.amount / total * 10000) / 100 : 0;
    return r;
  });
}
window.txSplitGetCategorySplits = txSplitGetCategorySplits;

function txSplitGetMemberShares() {
  if (_txSplit.memRows.length < 2) return [];
  const valid = _txSplit.memRows.filter(r => r.member_id && r.amount > 0);
  if (valid.length < 2) return [];
  return valid.map(r => ({
    member_id:   r.member_id,
    member_name: r.member_name,
    amount:      r.amount,
    pct:         r.pct,
  }));
}
window.txSplitGetMemberShares = txSplitGetMemberShares;

// ── Carregamento ao editar ────────────────────────────────────────────────
function txSplitLoad(categorySplits, memberShares) {
  // Reset
  _txSplit.catRows = [];
  _txSplit.memRows = [];
  _txSplitRowSeq = 0;

  // Carregar category_splits
  if (Array.isArray(categorySplits) && categorySplits.length >= 2) {
    categorySplits.forEach(s => {
      const id = ++_txSplitRowSeq;
      _txSplit.catRows.push({
        id,
        category_id:    s.category_id    || '',
        category_name:  s.category_name  || '',
        category_color: s.category_color || '#94a3b8',
        amount:         parseFloat(s.amount) || 0,
      });
    });
  }

  // Carregar member_shares
  if (Array.isArray(memberShares) && memberShares.length >= 2) {
    memberShares.forEach(s => {
      const id = ++_txSplitRowSeq;
      _txSplit.memRows.push({
        id,
        member_id:   s.member_id   || '',
        member_name: s.member_name || '',
        amount:      parseFloat(s.amount) || 0,
        pct:         parseFloat(s.pct)    || 0,
      });
    });
    // Detecta modo predominante
    const anyPct = memberShares.some(s => s.pct > 0 && Math.abs(s.amount - (Math.abs(getAmtField('txAmount')||0) * s.pct / 100)) < 0.02);
    if (anyPct) _txSplit.memMode = 'pct';
  }

  _txSplitUpdateTabBadge();
}
window.txSplitLoad = txSplitLoad;

// ── Reset ao abrir modal novo ─────────────────────────────────────────────
function txSplitReset() {
  _txSplit.catRows = [];
  _txSplit.memRows = [];
  _txSplit.memMode = 'value';
  _txSplit.activeTab = 'cat';
  _txSplitRowSeq = 0;
  _txSplitUpdateTabBadge();
}
window.txSplitReset = txSplitReset;

// ── Indicador na lista de transações ─────────────────────────────────────
// Retorna badge HTML se a tx tem splits
function txSplitBadgeHtml(tx) {
  const hasCat = Array.isArray(tx.category_splits) && tx.category_splits.length >= 2;
  const hasMem = Array.isArray(tx.member_shares)   && tx.member_shares.length >= 2;
  if (!hasCat && !hasMem) return '';
  const parts = [];
  if (hasCat) parts.push(`${tx.category_splits.length} cat.`);
  if (hasMem) parts.push(`${tx.member_shares.length} membros`);
  return `<span class="tx-split-indicator" title="Transação dividida">✂️ ${parts.join(' · ')}</span>`;
}
window.txSplitBadgeHtml = txSplitBadgeHtml;


function _openSplitModal() {
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  // Sync data from hidden container to modal containers
  // Re-render directly into modal pane IDs
  _txSplit.activeTab = 'cat';
  _txSplitRenderCatModal(txAmt);
  _txSplitRenderMemModal(txAmt);
  txSplitShowModalTab('cat');
  openModal('txSplitModal');
}

window._openSplitModal = _openSplitModal;

// ════════════════════════════════════════════════════════════════════════════
//  SC SPLITS — Divisão por categoria e membro para Transações Programadas
// ════════════════════════════════════════════════════════════════════════════
const _scSplit = { catRows:[], memRows:[], memMode:'value', activeTab:'cat' };
let _scSplitRowSeq = 0;
let _scSplitPendingCatRowId = null;

function scSplitShowTab(tab) {
  _scSplit.activeTab = tab;
  const cat=document.getElementById('scSplitCatPane'), mem=document.getElementById('scSplitMemPane');
  const cb=document.getElementById('scSplitTabCat'), mb=document.getElementById('scSplitTabMem');
  if(cat) cat.style.display = tab==='cat'?'':'none';
  if(mem) mem.style.display = tab==='mem'?'':'none';
  const on='flex:1;padding:7px 10px;font-size:.78rem;font-weight:600;border:1.5px solid var(--accent);border-radius:9px;background:var(--accent);color:#fff;cursor:pointer;font-family:inherit;transition:all .15s';
  const off='flex:1;padding:7px 10px;font-size:.78rem;font-weight:600;border:1.5px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text2);cursor:pointer;font-family:inherit;transition:all .15s';
  if(cb) cb.style.cssText = tab==='cat'?on:off;
  if(mb) mb.style.cssText = tab==='mem'?on:off;
}
window.scSplitShowTab = scSplitShowTab;

function scCatSplitAddRow(prefill) {
  const id = ++_scSplitRowSeq;
  _scSplit.catRows.push({ id, category_id:prefill?.category_id||'', category_name:prefill?.category_name||'', category_color:prefill?.category_color||'#94a3b8', amount:prefill?.amount||0 });
  _scSplitRenderCat();
  setTimeout(()=>{ const i=document.querySelector(`#scCatSplitRow_${id} .tx-split-amount-input`); if(i) i.focus(); },50);
}
window.scCatSplitAddRow = scCatSplitAddRow;

function scCatSplitRemoveRow(id) { _scSplit.catRows=_scSplit.catRows.filter(r=>r.id!==id); _scSplitRenderCat(); }
window.scCatSplitRemoveRow = scCatSplitRemoveRow;

function scCatSplitPickCategory(rowId) {
  _scSplitPendingCatRowId = rowId;  // set BEFORE opening chooser
  if (typeof openCatChooser === 'function') {
    openCatChooser('sc', function(catId, catName, catColor) {
      _scSplitPendingCatRowId = rowId;  // ensure still set on callback
      if (typeof scCatSplitReceiveCategory === 'function')
        scCatSplitReceiveCategory(catId, catName, catColor || '#94a3b8');
    });
  } else {
    window._scSplitCatMode = rowId;
    toggleCatPicker('tx');
  }
}
window.scCatSplitPickCategory = scCatSplitPickCategory;

function scCatSplitReceiveCategory(catId, catName, catColor) {
  const _scat=(state.categories||[]).find(c=>c.id===catId);
  const _sparent=_scat?.parent_id?(state.categories||[]).find(c=>c.id===_scat.parent_id):null;
  if (_scSplitPendingCatRowId === null) return;
  const row = _scSplit.catRows.find(r=>r.id===_scSplitPendingCatRowId);
  if (row) { row.category_id=catId; row.category_name=catName; row.category_color=catColor||'#94a3b8'; row.category_parent_name=_sparent?_sparent.name:null; }
  _scSplitPendingCatRowId = null;
  _scSplitRenderCat();
}
window.scCatSplitReceiveCategory = scCatSplitReceiveCategory;

function scCatSplitUpdateAmount(rowId, rawVal) {
  const row = _scSplit.catRows.find(r => r.id === rowId);
  if (!row) return;
  const el = document.querySelector(`#scCatSplitRow_${rowId} .tx-split-amount-input`);
  const cents = el ? parseInt(el.dataset.cents || '0', 10) : 0;
  row.amount = cents
    ? cents / 100
    : Math.abs(parseFloat(String(rawVal).replace(/\./g,'').replace(',','.')) || 0);
  _scSplitUpdateCatTotals_SC();
}window.scCatSplitUpdateAmount = scCatSplitUpdateAmount;

function scCatSplitAutoFill() {
  const a=Math.abs(getAmtField('scAmount')||0);
  if(!a||_scSplit.catRows.length<2) return;
  const used=_scSplit.catRows.slice(0,-1).reduce((s,r)=>s+(r.amount||0),0);
  _scSplit.catRows[_scSplit.catRows.length-1].amount=Math.round(Math.max(0,a-used)*100)/100;
  _scSplitRenderCat(a);
}
window.scCatSplitAutoFill = scCatSplitAutoFill;

function _scSplitRenderCat(scAmt) {
  const container=document.getElementById('scCatSplitRows');
  const totalEl=document.getElementById('scCatSplitTotal');
  if(!container) return;
  if(!scAmt) scAmt=Math.abs(getAmtField('scAmount')||0);
  if(!_scSplit.catRows.length) {
    container.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted);font-size:.8rem">Nenhuma divisão. Clique em "+ Adicionar categoria".</div>';
    if(totalEl) totalEl.style.display='none'; return;
  }
  container.innerHTML=_scSplit.catRows.map(row=>{
    const has=!!row.category_id;
    const _catDisplayName = has?(row.category_parent_name?row.category_parent_name+'  ›  '+row.category_name:row.category_name):'';
    const lbl=has?`<span style="background:${row.category_color};width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block"></span><span style="overflow:hidden;text-overflow:ellipsis">${esc(_catDisplayName)}</span>`:`<span style="color:var(--muted)">— Selecionar categoria —</span>`;
    const _scCents=Math.round((row.amount||0)*100);
    const av=_scCents>0?Math.floor(_scCents/100).toLocaleString('pt-BR')+','+String(_scCents%100).padStart(2,'0'):'';
    return `<div class="tx-split-row" id="scCatSplitRow_${row.id}"><div class="tx-split-row-left"><button type="button" class="tx-split-cat-btn" onclick="scCatSplitPickCategory(${row.id})" style="display:flex;align-items:center;gap:6px;width:100%;text-align:left;padding:5px 8px;background:var(--surface);border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;overflow:hidden;white-space:nowrap">${lbl}</button></div><div class="tx-split-row-right"><input type="text" inputmode="decimal" class="tx-split-amount-input" placeholder="0,00" value="${av}" data-cents="${_scCents}" oninput="_txSplitAmtFmt(this);scCatSplitUpdateAmount(${row.id},this.value)" onblur="_txSplitAmtBlur(this);scCatSplitUpdateAmount(${row.id},this.value)"><button type="button" class="tx-split-remove-btn" onclick="scCatSplitRemoveRow(${row.id})">✕</button></div></div>`;
  }).join('');
  _scSplitUpdateCatTotals_SC(scAmt);
}

function _scSplitUpdateCatTotals_SC(scAmt) {
  if(!scAmt) scAmt=Math.abs(getAmtField('scAmount')||0);
  const te=document.getElementById('scCatSplitTotal'), tv=document.getElementById('scCatSplitTotalVal'), tx=document.getElementById('scCatSplitTxVal'), di=document.getElementById('scCatSplitDiff');
  if(!te) return;
  if(_scSplit.catRows.length<2){te.style.display='none';return;}
  te.style.display='';
  const dist=_scSplit.catRows.reduce((s,r)=>s+(r.amount||0),0), diff=scAmt-dist, abs=Math.abs(diff);
  if(tv) tv.textContent=typeof fmt==='function'?fmt(dist):dist.toFixed(2);
  if(tx) tx.textContent=typeof fmt==='function'?fmt(scAmt):scAmt.toFixed(2);
  if(di) di.innerHTML=abs<0.005?'<span style="color:#16a34a;font-weight:700">✓ Valores conferem</span>':diff>0?`<span style="color:#b45309;font-weight:700">Faltam ${typeof fmt==='function'?fmt(diff):diff.toFixed(2)}</span><button type="button" onclick="scCatSplitAutoFill()" style="margin-left:8px;font-size:.72rem;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">Auto-completar</button>`:`<span style="color:#dc2626;font-weight:700">Excedente: ${typeof fmt==='function'?fmt(abs):abs.toFixed(2)}</span>`;
}

function scMemSplitSetMode(mode) {
  _scSplit.memMode=mode;
  const on='flex:1;padding:6px;font-size:.74rem;font-weight:600;border:1.5px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-family:inherit';
  const off='flex:1;padding:6px;font-size:.74rem;font-weight:600;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text2);cursor:pointer;font-family:inherit';
  const vb=document.getElementById('scMemSplitModeVal'), pb=document.getElementById('scMemSplitModePct');
  if(vb) vb.style.cssText=mode==='value'?on:off;
  if(pb) pb.style.cssText=mode==='pct'?on:off;
  _scSplitRenderMem();
}
window.scMemSplitSetMode = scMemSplitSetMode;

function scMemSplitAddRow(prefill) {
  const id=++_scSplitRowSeq;
  _scSplit.memRows.push({id,member_id:prefill?.member_id||'',member_name:prefill?.member_name||'',amount:prefill?.amount||0,pct:prefill?.pct||0});
  _scSplitRenderMem();
  setTimeout(()=>{const i=document.querySelector(`#scMemSplitRow_${id} .tx-split-amount-input`);if(i)i.focus();},50);
}
window.scMemSplitAddRow = scMemSplitAddRow;

function scMemSplitRemoveRow(id) { _scSplit.memRows=_scSplit.memRows.filter(r=>r.id!==id); _scSplitRenderMem(); }
window.scMemSplitRemoveRow = scMemSplitRemoveRow;

function scMemSplitUpdateMember(rowId,memberId) {
  const row=_scSplit.memRows.find(r=>r.id===rowId); if(!row) return;
  row.member_id=memberId;
  const m=(typeof getFamilyMembers==='function'?getFamilyMembers():[]).find(x=>x.id===memberId);
  row.member_name=m?m.name:'';
  _scSplitUpdateMemTotals_SC();
}
window.scMemSplitUpdateMember = scMemSplitUpdateMember;

function scMemSplitUpdateValue(rowId,v) {
  const row=_scSplit.memRows.find(r=>r.id===rowId); if(!row) return;
  const n=parseFloat(String(v).replace(/\./g,'').replace(',','.'))||0, a=Math.abs(getAmtField('scAmount')||0);
  if(_scSplit.memMode==='pct'){row.pct=Math.min(100,Math.max(0,n));row.amount=a>0?Math.round(a*row.pct/100*100)/100:0;}
  else{row.amount=n;row.pct=a>0?Math.round(n/a*10000)/100:0;}
  _scSplitUpdateMemTotals_SC();
}
window.scMemSplitUpdateValue = scMemSplitUpdateValue;

function scMemSplitEqualSplit() {
  const a=Math.abs(getAmtField('scAmount')||0), n=_scSplit.memRows.length;
  if(!n||!a) return;
  const each=Math.round(a/n*100)/100;
  _scSplit.memRows.forEach((r,i)=>{r.amount=i<n-1?each:Math.round((a-each*(n-1))*100)/100;r.pct=a>0?Math.round(r.amount/a*10000)/100:0;});
  _scSplitRenderMem(a);
}
window.scMemSplitEqualSplit = scMemSplitEqualSplit;

function scMemSplitAutoFill() {
  const a=Math.abs(getAmtField('scAmount')||0); if(!a||_scSplit.memRows.length<2) return;
  const used=_scSplit.memRows.slice(0,-1).reduce((s,r)=>s+(r.amount||0),0);
  const last=_scSplit.memRows[_scSplit.memRows.length-1];
  last.amount=Math.round(Math.max(0,a-used)*100)/100; last.pct=a>0?Math.round(last.amount/a*10000)/100:0;
  _scSplitRenderMem(a);
}
window.scMemSplitAutoFill = scMemSplitAutoFill;

function _scSplitRenderMem(scAmt) {
  const container=document.getElementById('scMemSplitRows'), totalEl=document.getElementById('scMemSplitTotal');
  if(!container) return;
  if(!scAmt) scAmt=Math.abs(getAmtField('scAmount')||0);
  const members=typeof getFamilyMembers==='function'?getFamilyMembers():[];
  const opts=members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if(!_scSplit.memRows.length) {
    const qb=members.length?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${members.map(m=>`<button type="button" onclick="scMemSplitAddRow({member_id:'${m.id}',member_name:'${esc(m.name)}'})" style="padding:5px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:.76rem;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit">+ ${esc(m.name)}</button>`).join('')}</div><button type="button" onclick="scMemSplitEqualSplit()" style="margin-top:8px;width:100%;padding:8px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit">⚡ Dividir igualmente</button>`:'';
    container.innerHTML=`<div style="text-align:center;padding:16px 0;color:var(--muted);font-size:.8rem">Nenhuma divisão.${qb}</div>`;
    if(totalEl) totalEl.style.display='none'; return;
  }
  const isVal=_scSplit.memMode==='value';
  container.innerHTML=_scSplit.memRows.map(row=>{
    const isVal=_scSplit.memMode==='value';
    const members=typeof getFamilyMembers==='function'?getFamilyMembers():[];
    const _usedIds=new Set(_scSplit.memRows.filter(r=>r.id!==row.id).map(r=>r.member_id).filter(Boolean));
    const opts=members.map(m=>m.id===row.member_id?`<option value="${m.id}" selected>${esc(m.name)}</option>`:_usedIds.has(m.id)?'': `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    const dv=isVal?(row.amount>0?row.amount.toFixed(2).replace('.',','):''):(row.pct>0?row.pct.toFixed(1).replace('.',','):'');
    const ph=isVal?'0,00':'0,0%';
    return `<div class="tx-split-row" id="scMemSplitRow_${row.id}">
      <div class="tx-split-row-left">
        <select class="tx-split-member-select" onchange="scMemSplitUpdateMember(${row.id},this.value)"
          style="flex:1;padding:7px 10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;color:var(--text);font-family:inherit">
          <option value="">— Selecionar membro —</option>${opts}
        </select>
      </div>
      <div class="tx-split-row-right">
        <div class="amt-wrap" style="width:110px;flex-shrink:0">
          <input type="text" inputmode="decimal" class="tx-split-amount-input"
            placeholder="${ph}" value="${dv}"
            oninput="_txSplitAmtFmt(this)"
            onchange="scMemSplitUpdateValue(${row.id},this.value)"
            style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:9px;font-size:.8rem;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box;text-align:right">
        </div>
        <button type="button" onclick="scMemSplitRemoveRow(${row.id})"
          style="padding:5px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.9rem">✕</button>
      </div>
    </div>`;
  }).join('');
  _scSplit.memRows.forEach(r=>{const s=document.querySelector(`#scMemSplitRow_${r.id} select`);if(s&&r.member_id)s.value=r.member_id;});
  _scSplitUpdateMemTotals_SC(scAmt);
}

function _scSplitUpdateMemTotals_SC(scAmt) {
  if(!scAmt) scAmt=Math.abs(getAmtField('scAmount')||0);
  const te=document.getElementById('scMemSplitTotal'),tv=document.getElementById('scMemSplitTotalVal'),tx=document.getElementById('scMemSplitTxVal'),di=document.getElementById('scMemSplitDiff');
  if(!te) return;
  if(_scSplit.memRows.length<2){te.style.display='none';return;}
  te.style.display='';
  const dist=_scSplit.memRows.reduce((s,r)=>s+(r.amount||0),0),diff=scAmt-dist,abs=Math.abs(diff);
  if(tv) tv.textContent=typeof fmt==='function'?fmt(dist):dist.toFixed(2);
  if(tx) tx.textContent=typeof fmt==='function'?fmt(scAmt):scAmt.toFixed(2);
  if(di) di.innerHTML=abs<0.005?'<span style="color:#16a34a;font-weight:700">✓ Valores conferem</span>':diff>0?`<span style="color:#b45309;font-weight:700">Faltam ${typeof fmt==='function'?fmt(diff):diff.toFixed(2)}</span><button type="button" onclick="scMemSplitAutoFill()" style="margin-left:8px;font-size:.72rem;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit">Auto-completar</button>`:`<span style="color:#dc2626;font-weight:700">Excedente: ${typeof fmt==='function'?fmt(abs):abs.toFixed(2)}</span>`;
}

function scSplitGetCategorySplits() { return _scSplit.catRows.filter(r=>r.category_id&&r.amount>0).map(r=>({category_id:r.category_id,amount:r.amount})); }

// ── Financial formatting for split inputs ────────────────────────────────────
// Called oninput: strips non-numeric, keeps one decimal point
function _txSplitAmtFmt(input) {
  const raw = input.value;
  // Allow typing: digits, comma, period
  const cleaned = raw.replace(/[^\d,.]/g, '');
  input.value = cleaned;
}

// Called onblur: format as 2 decimal places
function _txSplitAmtBlur(input) {
  const raw = input.value.replace(',', '.').replace(/[^\d.]/g, '');
  const num = parseFloat(raw);
  if (!isNaN(num) && num > 0) {
    input.value = num.toFixed(2).replace('.', ',');
  }
}
window._txSplitAmtFmt  = _txSplitAmtFmt;
window._txSplitAmtBlur = _txSplitAmtBlur;

// ── Split total validation: called when user closes the split modal ──────────
async function _txSplitValidateTotal(type) {
  // type: 'cat' | 'mem'
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  if (!txAmt) return true; // no amount to validate against

  let splitTotal = 0;
  if (type === 'cat') {
    splitTotal = _txSplit.catRows.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
  } else {
    splitTotal = _txSplit.memRows.reduce((s,r) => s + (parseFloat(r.amount)||0), 0);
  }

  if (splitTotal === 0) return true; // no rows filled — skip validation
  const diff = Math.abs(txAmt - splitTotal);
  if (diff < 0.01) return true; // match within 1 cent — OK

  const label = type === 'cat' ? 'categorias' : 'membros';
  const diffFmt = diff.toFixed(2).replace('.', ',');
  const splitFmt = splitTotal.toFixed(2).replace('.', ',');
  const txFmt = txAmt.toFixed(2).replace('.', ',');

  return new Promise(resolve => {
    // Build confirmation dialog
    document.querySelectorAll('#txSplitValidationDlg').forEach(m=>m.remove());
    const dlg = document.createElement('div');
    dlg.id = 'txSplitValidationDlg';
    dlg.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    dlg.innerHTML = `<div style="background:var(--surface);border-radius:16px;padding:22px 24px;max-width:400px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.25)">
      <div style="font-size:1rem;font-weight:800;color:var(--text);margin-bottom:10px">⚠️ Total não confere</div>
      <div style="font-size:.85rem;color:var(--text2);line-height:1.6;margin-bottom:16px">
        A soma dos ${label} é <strong>R$ ${splitFmt}</strong>,
        mas o valor da transação é <strong>R$ ${txFmt}</strong>
        (diferença de <strong style="color:#dc2626">R$ ${diffFmt}</strong>).
        <br><br>O que deseja fazer?
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button style="padding:10px;background:var(--accent);color:#fff;border:none;border-radius:10px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit"
          onclick="document.getElementById('txSplitValidationDlg').remove();window._splitValidResolve('replace')">
          Substituir valor da TX por R$ ${splitFmt}
        </button>
        <button style="padding:10px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:10px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit"
          onclick="document.getElementById('txSplitValidationDlg').remove();window._splitValidResolve('fix')">
          Ajustar a distribuição (ficar no modal)
        </button>
        <button style="padding:10px;background:none;color:var(--muted);border:none;font-size:.82rem;cursor:pointer;font-family:inherit"
          onclick="document.getElementById('txSplitValidationDlg').remove();window._splitValidResolve('ignore')">
          Ignorar e salvar assim mesmo
        </button>
      </div>
    </div>`;
    document.body.appendChild(dlg);

    window._splitValidResolve = function(choice) {
      if (choice === 'replace') {
        // Update the TX amount field with the split total
        const amt = type === 'cat'
          ? _txSplit.catRows.reduce((s,r)=>s+(parseFloat(r.amount)||0),0)
          : _txSplit.memRows.reduce((s,r)=>s+(parseFloat(r.amount)||0),0);
        try {
          // Set the TX amount to match the split total
          const txAmtInput = document.getElementById('txAmount');
          if (txAmtInput) {
            // Preserve sign
            const isNeg = (getAmtField('txAmount')||0) < 0;
            const newVal = isNeg ? -amt : amt;
            if (typeof setAmtField === 'function') setAmtField('txAmount', newVal);
          }
        } catch(_){}
        resolve(true);
      } else if (choice === 'fix') {
        resolve(false); // stay in modal
      } else {
        resolve(true); // ignore, save anyway
      }
    };
  });
}
window._txSplitValidateTotal = _txSplitValidateTotal;


// Called by "Confirmar Divisão" button — validates totals before closing
async function _txSplitConfirmAndClose() {
  const activeTab = _txSplit.activeTab || 'cat';
  const hasCat = _txSplit.catRows.some(r => r.amount > 0);
  const hasMem = _txSplit.memRows.some(r => r.amount > 0 || r.pct > 0);

  let ok = true;
  if (hasCat) {
    ok = await _txSplitValidateTotal('cat');
    if (!ok) return; // user chose to fix distribution
  }
  if (hasMem && ok) {
    ok = await _txSplitValidateTotal('mem');
    if (!ok) return;
  }
  closeModal('txSplitModal');
}
window._txSplitConfirmAndClose = _txSplitConfirmAndClose;

window.scSplitGetCategorySplits = scSplitGetCategorySplits;

function scSplitGetMemberShares() { return _scSplit.memRows.filter(r=>r.member_id&&r.amount>0).map(r=>({member_id:r.member_id,amount:r.amount,pct:r.pct})); }
window.scSplitGetMemberShares = scSplitGetMemberShares;

function scSplitLoad(cats, mems) {
  _scSplit.catRows=[]; _scSplit.memRows=[]; _scSplitRowSeq=0;
  if(Array.isArray(cats)) cats.forEach(s=>{const c=(state.categories||[]).find(x=>x.id===s.category_id),id=++_scSplitRowSeq;_scSplit.catRows.push({id,category_id:s.category_id||'',category_name:c?c.name:'',category_color:c?(c.color||'#94a3b8'):'#94a3b8',amount:parseFloat(s.amount)||0});});
  if(Array.isArray(mems)){const members=typeof getFamilyMembers==='function'?getFamilyMembers():[];mems.forEach(s=>{const m=members.find(x=>x.id===s.member_id),id=++_scSplitRowSeq;_scSplit.memRows.push({id,member_id:s.member_id||'',member_name:m?m.name:'',amount:parseFloat(s.amount)||0,pct:parseFloat(s.pct)||0});});if(_scSplit.memRows.some(r=>r.pct>0))_scSplit.memMode='pct';}
}
window.scSplitLoad = scSplitLoad;

function scSplitReset() { _scSplit.catRows=[]; _scSplit.memRows=[]; _scSplit.memMode='value'; _scSplit.activeTab='cat'; _scSplitRowSeq=0; }
window.scSplitReset = scSplitReset;
