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
function txSplitTabOpened() {
  const txAmt = Math.abs(getAmtField('txAmount') || 0);
  _txSplitRenderCat(txAmt);
  _txSplitRenderMem(txAmt);
  txSplitShowTab(_txSplit.activeTab);
}

// ── Open split modal from tx modal ────────────────────────────────────────
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
  container.innerHTML = _txSplit.catRows.map(row => _txSplitCatRowHtml(row, txAmt)).join('');
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
  // Foca no último input de valor
  setTimeout(() => {
    const inp = document.querySelector(`#txCatSplitRow_${id} .tx-split-amount-input`);
    if (inp) inp.focus();
  }, 50);
}
window.txCatSplitAddRow = txCatSplitAddRow;

function txCatSplitRemoveRow(id) {
  _txSplit.catRows = _txSplit.catRows.filter(r => r.id !== id);
  _txSplitRenderCat();
}
window.txCatSplitRemoveRow = txCatSplitRemoveRow;

function txCatSplitPickCategory(rowId) {
  // Abre o cat picker do modal principal — captura a escolha via callback
  _txSplitPendingCatRowId = rowId;
  toggleCatPicker(true); // passa flag para modo "split"
}
window.txCatSplitPickCategory = txCatSplitPickCategory;

// Chamado pelo catPicker quando está em modo split
let _txSplitPendingCatRowId = null;
function txCatSplitReceiveCategory(catId, catName, catColor) {
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
  row.amount = parseFloat(String(rawVal).replace(',', '.')) || 0;
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

  container.innerHTML = _txSplit.catRows.map(row => {
    const hascat = !!row.category_id;
    const dotStyle = hascat
      ? `background:${row.category_color};width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block`
      : 'display:none';
    const btnLabel = hascat
      ? `<span style="${dotStyle}"></span><span style="overflow:hidden;text-overflow:ellipsis">${esc(row.category_name)}</span>`
      : `<span style="color:var(--muted)">— Selecionar categoria —</span>`;
    const amtVal = row.amount > 0 ? row.amount.toFixed(2).replace('.', ',') : '';
    return `<div class="tx-split-row" id="txCatSplitRow_${row.id}">
      <div class="tx-split-row-left">
        <button type="button" class="tx-split-cat-btn" onclick="txCatSplitPickCategory(${row.id})"
          style="display:flex;align-items:center;gap:6px;width:100%;text-align:left;padding:5px 8px;background:var(--surface);border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;overflow:hidden;white-space:nowrap">
          ${btnLabel}
        </button>
      </div>
      <div class="tx-split-row-right">
        <input type="text" inputmode="decimal" class="tx-split-amount-input"
          placeholder="0,00" value="${amtVal}"
          onchange="txCatSplitUpdateAmount(${row.id},this.value)"
          oninput="txCatSplitUpdateAmount(${row.id},this.value)">
        <button type="button" class="tx-split-remove-btn" onclick="txCatSplitRemoveRow(${row.id})">✕</button>
      </div>
    </div>`;
  }).join('');

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
}
window.txMemSplitAddRow = txMemSplitAddRow;

function txMemSplitRemoveRow(id) {
  _txSplit.memRows = _txSplit.memRows.filter(r => r.id !== id);
  _txSplitRenderMem();
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
  container.innerHTML = _txSplit.memRows.map(row => {
    const dispVal = isPct
      ? (row.pct > 0 ? row.pct.toFixed(1) : '')
      : (row.amount > 0 ? row.amount.toFixed(2).replace('.', ',') : '');
    const placeholder = isPct ? '0,0%' : '0,00';
    return `<div class="tx-split-row" id="txMemSplitRow_${row.id}">
      <div class="tx-split-row-left">
        <select class="tx-split-mem-select" onchange="txMemSplitUpdateMember(${row.id},this.value)">
          <option value="">— Selecionar membro —</option>
          ${memberOpts}
        </select>
      </div>
      <div class="tx-split-row-right">
        <input type="text" inputmode="decimal" class="tx-split-amount-input"
          placeholder="${placeholder}" value="${dispVal}"
          style="width:80px"
          onchange="txMemSplitUpdateValue(${row.id},this.value)"
          oninput="txMemSplitUpdateValue(${row.id},this.value)">
        <button type="button" class="tx-split-remove-btn" onclick="txMemSplitRemoveRow(${row.id})">✕</button>
      </div>
    </div>`;
  }).join('');

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
