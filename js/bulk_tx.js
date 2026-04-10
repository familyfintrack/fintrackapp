
// ── BRL amount mask for bulk entry ──────────────────────────────────────────
function _bulkAmtInput(input, rowId) {
  const rawDigits = input.value.replace(/[^0-9]/g, '');
  if (!rawDigits) { input.dataset.cents = '0'; input.value = ''; bulkTxSetField(rowId, 'amount', ''); return; }
  const cents = parseInt(rawDigits.slice(-13) || '0', 10);
  input.dataset.cents = String(cents);
  const reais = Math.floor(cents / 100);
  const centsOnly = cents % 100;
  input.value = reais.toLocaleString('pt-BR') + ',' + String(centsOnly).padStart(2, '0');
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(_) {}
  // Store numeric value in the row
  bulkTxSetField(rowId, 'amount', String(cents / 100));
}
window._bulkAmtInput = _bulkAmtInput;

// Format a numeric amount as BRL string for display in the bulk table
function _bulkFmtAmt(amount) {
  const v = parseFloat(String(amount).replace(',', '.')) || 0;
  if (!v) return '';
  const cents = Math.round(v * 100);
  return Math.floor(cents/100).toLocaleString('pt-BR') + ',' + String(cents%100).padStart(2,'0');
}


// ════════════════════════════════════════════════════════════════════════════
// BULK TRANSACTION ENTRY — lançamento em massa de transações
// ════════════════════════════════════════════════════════════════════════════

const _bulkTx = {
  rows: [],
  seq:  0,
};

// ── Open the bulk entry modal ─────────────────────────────────────────────
function openBulkTxModal() {
  _bulkTx.rows = [];
  _bulkTx.seq  = 0;
  _bulkRenderRows();
  openModal('bulkTxModal');
  // Add 3 starter rows
  bulkTxAddRow();
  bulkTxAddRow();
  bulkTxAddRow();
}
window.openBulkTxModal = openBulkTxModal;

// ── Add a blank row ───────────────────────────────────────────────────────
function bulkTxAddRow(prefill) {
  const id = ++_bulkTx.seq;
  const today = typeof localDateStr === 'function' ? localDateStr() : new Date().toISOString().slice(0,10);
  _bulkTx.rows.push({
    id,
    date:        prefill?.date        || today,
    description: prefill?.description || '',
    amount:      prefill?.amount      || '',
    type:        prefill?.type        || 'expense',
    account_id:  prefill?.account_id  || (state.accounts?.[0]?.id || ''),
    category_id: prefill?.category_id || '',
    category_name: prefill?.category_name || '',
    payee_id:    prefill?.payee_id    || '',
    payee_name:  prefill?.payee_name  || '',
    status:      prefill?.status      || 'confirmed',
    _error:      null,
    _done:       false,
  });
  _bulkRenderRows();
  // Focus the last row's description
  setTimeout(() => {
    const rows = document.querySelectorAll('.bulk-tx-row');
    const lastRow = rows[rows.length-1];
    if (lastRow) lastRow.querySelector('input[data-field="description"]')?.focus();
  }, 50);
}
window.bulkTxAddRow = bulkTxAddRow;

// ── Remove a row ──────────────────────────────────────────────────────────
function bulkTxRemoveRow(id) {
  _bulkTx.rows = _bulkTx.rows.filter(r => r.id !== id);
  _bulkRenderRows();
}
window.bulkTxRemoveRow = bulkTxRemoveRow;

// ── Update a cell ─────────────────────────────────────────────────────────
function bulkTxSetField(id, field, value) {
  const row = _bulkTx.rows.find(r => r.id === id);
  if (!row) return;
  row[field] = value;
  // Amount is stored as a numeric string (from _bulkAmtInput)
  if (field === 'amount') {
    // Accept both formatted "1.500,00" and plain "1500" or "15.00"
    const raw = String(value).replace(/[^0-9,.]/g, '');
    const num = parseFloat(raw.replace(/\./g,'').replace(',','.')) || 0;
    row.amount = num > 0 ? String(num) : '';
  }
  _bulkUpdateTotals();
}
window.bulkTxSetField = bulkTxSetField;

// ── Pick category for a row ───────────────────────────────────────────────
function bulkTxPickCat(rowId) {
  if (typeof openCatChooser !== 'function') return;
  openCatChooser('tx', (catId, catName, catColor) => {
    const row = _bulkTx.rows.find(r => r.id === rowId);
    if (!row) return;
    row.category_id   = catId   || '';
    row.category_name = catName || '';
    _bulkRenderRows();
  });
}
window.bulkTxPickCat = bulkTxPickCat;

// ── Render the table body ─────────────────────────────────────────────────
function _bulkRenderRows() {
  const tbody = document.getElementById('bulkTxTbody');
  if (!tbody) return;

  const accounts  = state.accounts  || [];
  const categories= state.categories|| [];

  if (!_bulkTx.rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted);font-size:.83rem">
      Nenhuma linha. Clique em "➕ Adicionar linha" para começar.
    </td></tr>`;
    _bulkUpdateTotals();
    return;
  }

  const acctOpts = accounts.map(a =>
    `<option value="${a.id}">${esc(a.name)}</option>`
  ).join('');

  tbody.innerHTML = _bulkTx.rows.map(row => {
    const isDone  = row._done;
    const isError = !!row._error;
    const rowCls  = isDone ? 'bulk-row-done' : isError ? 'bulk-row-error' : '';
    const catLabel = row.category_name
      ? `<span style="color:var(--text);font-size:.78rem">${esc(row.category_name)}</span>`
      : `<span style="color:var(--muted);font-size:.78rem">— cat —</span>`;

    return `<tr class="bulk-tx-row ${rowCls}" data-bulk-id="${row.id}">
      <td class="bulk-td-type">
        <select class="bulk-cell-select" onchange="bulkTxSetField(${row.id},'type',this.value)"
          style="background:${row.type==='income'?'rgba(22,163,74,.1)':row.type==='expense'?'rgba(220,38,38,.08)':'rgba(59,130,246,.08)'}">
          <option value="expense" ${row.type==='expense'?'selected':''}>💸 Desp.</option>
          <option value="income"  ${row.type==='income' ?'selected':''}>💰 Rec.</option>
          <option value="transfer"${row.type==='transfer'?'selected':''}>🔄 Transf.</option>
        </select>
      </td>
      <td class="bulk-td-date">
        <input type="date" class="bulk-cell-input" value="${row.date}"
          onchange="bulkTxSetField(${row.id},'date',this.value)">
      </td>
      <td class="bulk-td-desc">
        <input type="text" class="bulk-cell-input" data-field="description"
          value="${esc(row.description)}" placeholder="Descrição…"
          oninput="bulkTxSetField(${row.id},'description',this.value)"
          onkeydown="if(event.key==='Tab'&&!event.shiftKey&&event.target.closest('tr')===document.querySelectorAll('.bulk-tx-row')[document.querySelectorAll('.bulk-tx-row').length-1]){event.preventDefault();bulkTxAddRow();}">
      </td>
      <td class="bulk-td-amt">
        <input type="text" class="bulk-cell-input bulk-cell-amt" inputmode="numeric"
          value="${_bulkFmtAmt(row.amount)}" placeholder="0,00"
          data-cents="${Math.round((parseFloat(row.amount)||0)*100)}"
          oninput="_bulkAmtInput(this,${row.id})">
      </td>
      <td class="bulk-td-acct">
        <select class="bulk-cell-select" onchange="bulkTxSetField(${row.id},'account_id',this.value)">
          ${acctOpts.replace(`value="${row.account_id}"`,`value="${row.account_id}" selected`)}
        </select>
      </td>
      <td class="bulk-td-cat">
        <button type="button" class="bulk-cell-cat-btn" onclick="bulkTxPickCat(${row.id})">
          ${catLabel}
        </button>
      </td>
      <td class="bulk-td-status">
        <select class="bulk-cell-select" onchange="bulkTxSetField(${row.id},'status',this.value)">
          <option value="confirmed" ${row.status==='confirmed'?'selected':''}>✅ Conf.</option>
          <option value="pending"   ${row.status==='pending'  ?'selected':''}>⏳ Pend.</option>
        </select>
      </td>
      <td class="bulk-td-del">
        ${isDone ? '✅' : isError
          ? `<span title="${esc(row._error)}" style="color:#dc2626;cursor:help;font-size:.8rem">⚠️</span>`
          : `<button type="button" class="bulk-del-btn" onclick="bulkTxRemoveRow(${row.id})" title="Remover linha">✕</button>`
        }
      </td>
    </tr>`;
  }).join('');

  _bulkUpdateTotals();
}

// ── Update the summary totals row ─────────────────────────────────────────
function _bulkUpdateTotals() {
  const totalEl = document.getElementById('bulkTxTotalCount');
  const amtEl   = document.getElementById('bulkTxTotalAmt');
  if (!totalEl) return;
  const count = _bulkTx.rows.length;
  const total = _bulkTx.rows.reduce((s, r) => {
    const v = parseFloat(String(r.amount).replace(',','.')) || 0;
    return s + (r.type === 'income' ? v : r.type === 'expense' ? -v : 0);
  }, 0);
  totalEl.textContent = count + (count === 1 ? ' linha' : ' linhas');
  if (amtEl) {
    const fmtFn = typeof fmt === 'function' ? fmt : (n) => 'R$ '+Math.abs(n).toFixed(2);
    amtEl.textContent = (total >= 0 ? '+' : '-') + fmtFn(Math.abs(total), 'BRL');
    amtEl.style.color = total >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)';
  }
}

// ── Execute bulk save ─────────────────────────────────────────────────────
async function executeBulkTxSave() {
  const rows = _bulkTx.rows.filter(r => !r._done);
  if (!rows.length) {
    toast('Nenhuma linha para salvar.', 'warning');
    return;
  }

  // Validate required fields
  const invalid = rows.filter(r => !r.date || !r.amount || parseFloat(String(r.amount).replace(',','.')) <= 0);
  if (invalid.length) {
    toast(`${invalid.length} linha(s) sem data ou valor. Corrija antes de salvar.`, 'error');
    invalid.forEach(r => {
      const el = document.querySelector(`[data-bulk-id="${r.id}"]`);
      if (el) el.classList.add('bulk-row-error');
    });
    return;
  }

  const btn   = document.getElementById('bulkTxSaveBtn');
  const prog  = document.getElementById('bulkTxProgress');
  const bar   = document.getElementById('bulkTxProgressBar');
  const label = document.getElementById('bulkTxProgressLabel');
  if (btn)  { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }
  if (prog) prog.style.display = '';

  let saved = 0;
  let errors = 0;
  const fid = typeof famId === 'function' ? famId() : null;

  for (const row of rows) {
    const pct = Math.round(((saved + errors) / rows.length) * 100);
    if (bar)   bar.style.width = pct + '%';
    if (label) label.textContent = `${saved + errors}/${rows.length} — ${row.description || 'sem descrição'}`;

    try {
      const amount = parseFloat(String(row.amount).replace(',','.'));
      const signedAmt = row.type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
      const _isTransfer   = row.type === 'transfer' || row.type === 'card_payment';
      const _isCardPayment = row.type === 'card_payment';
      const txData = {
        family_id:            fid,
        account_id:           row.account_id,
        category_id:          row.category_id || null,
        description:          row.description || (_isTransfer ? 'Transferência' : row.type === 'income' ? 'Receita' : 'Despesa'),
        amount:               signedAmt,
        brl_amount:           typeof toBRL === 'function' ? toBRL(signedAmt, 'BRL') : signedAmt,
        date:                 row.date,
        status:               row.status || 'confirmed',
        is_transfer:          _isTransfer,
        is_card_payment:      _isCardPayment,
        currency:             'BRL',
        created_at:           new Date().toISOString(),
      };
      const { error } = await sb.from('transactions').insert(txData);
      if (error) throw error;
      row._done  = true;
      saved++;
    } catch(e) {
      row._error = e.message || 'Erro desconhecido';
      errors++;
    }
    _bulkRenderRows();
    await new Promise(r => setTimeout(r, 40)); // small delay so progress is visible
  }

  if (bar)   bar.style.width = '100%';
  if (label) label.textContent = `Concluído: ${saved} salvas, ${errors} erros`;

  if (saved > 0) {
    toast(`✅ ${saved} transação(ões) salva(s)${errors ? `, ⚠️ ${errors} erro(s)` : ''}`, errors ? 'warning' : 'success');
    // Refresh state
    if (typeof DB !== 'undefined' && DB._cache) DB._cache = {};
    if (state.currentPage === 'transactions' && typeof loadTransactions === 'function') loadTransactions();
    if (state.currentPage === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
  }

  if (!errors) {
    // All saved — close modal after 1.5s
    setTimeout(() => closeModal('bulkTxModal'), 1500);
  }

  if (btn) { btn.disabled = false; btn.textContent = errors ? `↻ Tentar novamente (${errors} erros)` : '✅ Concluído'; }
}
window.executeBulkTxSave = executeBulkTxSave;
