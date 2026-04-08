
// ── IOF Settings — categoria e beneficiário padrão (por família) ─────────────
const IOF_CAT_KEY   = 'iof_category_id';
const IOF_PAYEE_KEY = 'iof_payee_id';

async function getIofCategoryId() {
  // Try in-memory cache first
  if (window._iofCatId !== undefined) return window._iofCatId;
  const val = await (typeof getAppSetting === 'function'
    ? getAppSetting(IOF_CAT_KEY, null)
    : Promise.resolve(null));
  window._iofCatId = val || null;
  return window._iofCatId;
}

async function getIofPayeeId() {
  if (window._iofPayeeId !== undefined) return window._iofPayeeId;
  const val = await (typeof getAppSetting === 'function'
    ? getAppSetting(IOF_PAYEE_KEY, null)
    : Promise.resolve(null));
  window._iofPayeeId = val || null;
  return window._iofPayeeId;
}

async function setIofCategoryId(id) {
  window._iofCatId = id || null;
  if (typeof saveAppSetting === 'function') await saveAppSetting(IOF_CAT_KEY, id || '');
}

async function setIofPayeeId(id) {
  window._iofPayeeId = id || null;
  if (typeof saveAppSetting === 'function') await saveAppSetting(IOF_PAYEE_KEY, id || '');
}

// ── Bulk-update IOF transactions to new category ────────────────────────────
async function bulkUpdateIofCategory(newCatId) {
  await _showIofBulkProgress('categoria');
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    if (!fid) throw new Error('Família não identificada');

    // Count IOF transactions tagged with 'IOF'
    const { data: txs, error } = await sb
      .from('transactions')
      .select('id')
      .eq('family_id', fid)
      .contains('tags', ['IOF']);
    if (error) throw error;

    const total = (txs || []).length;
    _updateIofBulkProgress(0, total, 'Iniciando…');
    if (!total) {
      _updateIofBulkProgress(0, 0, 'Nenhuma transação de IOF encontrada.');
      await new Promise(r => setTimeout(r, 1200));
      _closeIofBulkProgress();
      return;
    }

    // Update in batches of 50
    const ids = txs.map(t => t.id);
    const batchSize = 50;
    let done = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const { error: updErr } = await sb
        .from('transactions')
        .update({ category_id: newCatId, updated_at: new Date().toISOString() })
        .in('id', batch)
        .eq('family_id', fid);
      if (updErr) throw updErr;
      done += batch.length;
      _updateIofBulkProgress(done, total, `Atualizando… ${done}/${total}`);
    }

    _updateIofBulkProgress(total, total, `✅ ${total} transação${total!==1?'s':''} atualizada${total!==1?'s':''}`);
    await new Promise(r => setTimeout(r, 1500));
    _closeIofBulkProgress();
    if (typeof toast === 'function') toast(`IOF: ${total} transaç${total!==1?'ões':'ão'} movida${total!==1?'s':''} para nova categoria`, 'success');

  } catch(e) {
    _updateIofBulkProgress(0, 0, '❌ Erro: ' + (e.message || e));
    await new Promise(r => setTimeout(r, 2500));
    _closeIofBulkProgress();
    if (typeof toast === 'function') toast('Erro ao atualizar IOF: ' + e.message, 'error');
  }
}

// ── Bulk-update IOF transactions to new payee ────────────────────────────────
async function bulkUpdateIofPayee(newPayeeId) {
  await _showIofBulkProgress('beneficiário');
  try {
    const fid = typeof famId === 'function' ? famId() : null;
    if (!fid) throw new Error('Família não identificada');

    const { data: txs, error } = await sb
      .from('transactions')
      .select('id')
      .eq('family_id', fid)
      .contains('tags', ['IOF']);
    if (error) throw error;

    const total = (txs || []).length;
    _updateIofBulkProgress(0, total, 'Iniciando…');
    if (!total) {
      _updateIofBulkProgress(0, 0, 'Nenhuma transação de IOF encontrada.');
      await new Promise(r => setTimeout(r, 1200));
      _closeIofBulkProgress();
      return;
    }

    const ids = txs.map(t => t.id);
    const batchSize = 50;
    let done = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const { error: updErr } = await sb
        .from('transactions')
        .update({ payee_id: newPayeeId || null, updated_at: new Date().toISOString() })
        .in('id', batch)
        .eq('family_id', fid);
      if (updErr) throw updErr;
      done += batch.length;
      _updateIofBulkProgress(done, total, `Atualizando… ${done}/${total}`);
    }

    _updateIofBulkProgress(total, total, `✅ ${total} transação${total!==1?'s':''} atualizada${total!==1?'s':''}`);
    await new Promise(r => setTimeout(r, 1500));
    _closeIofBulkProgress();
    if (typeof toast === 'function') toast(`IOF: ${total} transaç${total!==1?'ões':'ão'} movida${total!==1?'s':''} para novo beneficiário`, 'success');

  } catch(e) {
    _updateIofBulkProgress(0, 0, '❌ Erro: ' + (e.message || e));
    await new Promise(r => setTimeout(r, 2500));
    _closeIofBulkProgress();
    if (typeof toast === 'function') toast('Erro ao atualizar IOF: ' + e.message, 'error');
  }
}

// ── Progress modal ────────────────────────────────────────────────────────────
function _showIofBulkProgress(type) {
  document.getElementById('iofBulkModal')?.remove();
  const m = document.createElement('div');
  m.className = 'modal-overlay open';
  m.id = 'iofBulkModal';
  m.style.zIndex = '10030';
  m.innerHTML = `
    <div class="modal" style="max-width:380px;padding:24px">
      <div class="modal-handle"></div>
      <div style="text-align:center">
        <div style="font-size:1.5rem;margin-bottom:8px">🔄</div>
        <div style="font-weight:800;font-size:.95rem;color:var(--text);margin-bottom:4px">Atualizando IOF</div>
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:16px">Transferindo histórico de transações para o novo ${type}</div>
        <div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;margin-bottom:10px">
          <div id="iofBulkBar" style="height:100%;border-radius:4px;background:var(--accent);width:0%;transition:width .3s ease"></div>
        </div>
        <div id="iofBulkLabel" style="font-size:.78rem;color:var(--muted)">Iniciando…</div>
      </div>
    </div>`;
  document.body.appendChild(m);
  return Promise.resolve();
}

function _updateIofBulkProgress(done, total, label) {
  const bar = document.getElementById('iofBulkBar');
  const lbl = document.getElementById('iofBulkLabel');
  const pct = total > 0 ? Math.round((done / total) * 100) : 100;
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = label;
}

function _closeIofBulkProgress() {
  const m = document.getElementById('iofBulkModal');
  if (m) { m.classList.remove('open'); setTimeout(() => m.remove(), 300); }
}

window.getIofCategoryId    = getIofCategoryId;
window.getIofPayeeId       = getIofPayeeId;
window.setIofCategoryId    = setIofCategoryId;
window.setIofPayeeId       = setIofPayeeId;
window.bulkUpdateIofCategory = bulkUpdateIofCategory;
window.bulkUpdateIofPayee    = bulkUpdateIofPayee;

function toggleAccountIof() {
  const isBR = document.getElementById('accountIsBrazilian').checked;
  document.getElementById('accountIofRateGroup').style.display = isBR ? '' : 'none';
}

function onAccountTypeChange() {
  const type = document.getElementById('accountType').value;
  document.getElementById('accountIofConfig').style.display = type === 'cartao_credito' ? '' : 'none';
}

function checkAccountIofConfig(accountId, txCurrency) {
  const iofGroup = document.getElementById('txIofGroup');
  if(!iofGroup) return;
  if(!accountId) { iofGroup.style.display='none'; return; }
  const acct = state.accounts.find(a=>a.id===accountId);
  if(!acct) { iofGroup.style.display='none'; return; }

  const accountCurrency = acct.currency || 'BRL';
  const selectedTxCur = txCurrency || _getTxSelectedCurrency?.() || accountCurrency;
  const currenciesDiffer = selectedTxCur !== accountCurrency;

  // Show IOF when: cartão de crédito E (cartão brasileiro OU moedas diferentes)
  if(acct.type==='cartao_credito' && (acct.is_brazilian || currenciesDiffer)) {
    iofGroup.style.display = '';
    // Auto-marcar quando moedas diferem (Feature 2)
    const cb = document.getElementById('txIsInternational');
    if(cb && currenciesDiffer && !cb.checked) {
      cb.checked = true;
    }
    updateIofMirror();
  } else {
    iofGroup.style.display = 'none';
    const cb = document.getElementById('txIsInternational');
    if(cb) cb.checked = false;
    const info = document.getElementById('txIofMirrorInfo');
    if(info) info.classList.remove('visible');
  }
}

// Feature 3: busca ou sugere criação da categoria "Impostos"
async function _getOrSuggestImpostosCategory() {
  // Busca em state.categories
  const cat = (state.categories||[]).find(c =>
    c.name?.toLowerCase() === 'impostos' && !c.parent_id
  );
  if(cat) return cat.id;

  // Não existe — sugere criação
  const criar = confirm('Categoria "Impostos" não encontrada.\nDeseja criá-la agora para classificar o IOF?');
  if(!criar) return null;

  const {data, error} = await sb.from('categories').insert({
    name: 'Impostos',
    color: '#dc2626',
    icon: '🏛️',
    family_id: famId(),
    updated_at: new Date().toISOString()
  }).select().single();

  if(error) { toast('Erro ao criar categoria Impostos: '+error.message,'error'); return null; }
  // Atualiza state local
  state.categories = state.categories || [];
  state.categories.push(data);
  toast('Categoria "Impostos" criada!','success');
  return data.id;
}

function toggleIofIntl() {
  const cb = document.getElementById('txIsInternational');
  cb.checked = !cb.checked;
  updateIofMirror();
}

function updateIofMirror() {
  const cb = document.getElementById('txIsInternational');
  const info = document.getElementById('txIofMirrorInfo');
  if(!cb || !info) return;
  if(!cb.checked) { info.classList.remove('visible'); return; }

  const accountId = document.getElementById('txAccountId').value;
  const acct = state.accounts.find(a=>a.id===accountId);
  const rate = acct?.iof_rate || 3.38;

  // Usa brl_amount quando há conversão (moedas diferentes)
  const accountCurrency = acct?.currency || 'BRL';
  const txCur = _getTxSelectedCurrency?.() || accountCurrency;
  const currenciesDiffer = txCur !== accountCurrency;

  let baseAmount, baseLabel;
  if(currenciesDiffer) {
    // Base = valor já convertido para moeda da conta
    const fxRate = parseFloat(document.getElementById('txCurrencyRate')?.value?.replace(',','.'));
    const rawAmt = Math.abs(getAmtField('txAmount') || 0);
    baseAmount = (fxRate > 0) ? rawAmt * fxRate : rawAmt;
    baseLabel = `${fmt(rawAmt, txCur)} × câmbio = ${fmt(baseAmount, accountCurrency)}`;
  } else {
    baseAmount = Math.abs(getAmtField('txAmount') || 0);
    baseLabel = fmt(baseAmount, accountCurrency);
  }

  const iofVal = baseAmount * rate / 100;
  // Resolve configured cat/payee names for display
  const _iofCatName = (() => {
    const cid = window._iofCatId;
    if (cid) { const c = (state.categories||[]).find(c=>c.id===cid); return c?.name||'Configurada'; }
    const fallback = (state.categories||[]).find(c=>c.name?.toLowerCase()==='impostos'&&!c.parent_id);
    return fallback?.name || 'Impostos';
  })();
  const _iofPayeeName = (() => {
    const pid = window._iofPayeeId;
    if (!pid) return null;
    const p = (state.payees||window._payeesCache||[]).find(p=>p.id===pid);
    return p?.name || null;
  })();
  info.innerHTML = `
    <strong>🧾 IOF calculado automaticamente:</strong><br>
    Base: <strong>${baseLabel}</strong> × ${rate}% = IOF de <strong style="color:var(--amber)">${fmt(iofVal, accountCurrency)}</strong><br>
    Será criada uma transação adicional de <strong style="color:var(--red)">−${fmt(iofVal, accountCurrency)}</strong>
    com categoria <strong>${_iofCatName}</strong>${_iofPayeeName ? ` e beneficiário <strong>${_iofPayeeName}</strong>` : ''}.
  `;
  info.classList.add('visible');
}

async function createIofMirrorTx(originalData, originalTxId) {
  try {
    const accountId = originalData.account_id;
    const acct = state.accounts.find(a=>a.id===accountId);
    if (!accountId || !acct) throw new Error('Conta da transação original não encontrada.');
    const rate = Number(acct?.iof_rate || 3.38);

    // Base do IOF: se há brl_amount (moeda diferente), usa ele; senão usa amount
    const accountCurrency = acct.currency || 'BRL';
    const base = (originalData.brl_amount != null && Math.abs(Number(originalData.brl_amount)) > 0)
      ? Math.abs(Number(originalData.brl_amount))
      : Math.abs(Number(originalData.amount) || 0);
    const iofAmount = base * rate / 100;
    if (!iofAmount) return null;

    // Usa categoria e beneficiário configurados nas settings, com fallback para 'Impostos'
    let iofCatId = await getIofCategoryId();
    if (!iofCatId) iofCatId = await _getOrSuggestImpostosCategory();
    const iofPayeeId = await getIofPayeeId();

    const iofData = {
      date: originalData.date,
      description: `IOF – ${originalData.description || 'compra internacional'}`,
      amount: -Math.abs(iofAmount),
      currency: accountCurrency,
      brl_amount: accountCurrency !== 'BRL' ? null : -Math.abs(iofAmount),
      account_id: accountId,
      payee_id: iofPayeeId || null,
      category_id: iofCatId || null,
      memo: `IOF ${rate}% sobre compra internacional: ${originalData.description || ''}. Tx original: ${originalTxId}`,
      tags: ['IOF','internacional'],
      is_transfer: false,
      is_card_payment: false,
      status: originalData.status || 'confirmed',
      updated_at: new Date().toISOString(),
      family_id: originalData.family_id || famId() || null,
    };
    const { data, error } = await sb.from('transactions').insert(iofData).select().single();
    if(error) throw error;
    toast(`IOF de ${fmt(iofAmount, accountCurrency)} lançado automaticamente!`, 'success');
    return data;
  } catch(e) {
    toast('Erro ao criar IOF: ' + e.message, 'error');
    return null;
  }
}

// Also wire amount/desc changes to update IOF preview
document.addEventListener('DOMContentLoaded', () => {
  ['txAmount','txDesc'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', ()=>{ if(document.getElementById('txIsInternational')?.checked) updateIofMirror(); });
  });
  // Wire account type change
  const accType = document.getElementById('accountType');
  if(accType) accType.addEventListener('change', onAccountTypeChange);
});

/* ═══════════════════════════════════════════════════════════════
   FORECAST REPORT
═══════════════════════════════════════════════════════════════ */
