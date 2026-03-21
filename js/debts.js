/* ═══════════════════════════════════════════════════════════════════════════
   DEBTS MODULE — Módulo de Dívidas · Family FinTrack
   Activation: debts_enabled_{family_id} in app_settings
   Scope: family-scoped, optional, fully isolated from account balances

   Architecture:
   - debts table (virtual liability account)
   - debt_ledger table (double-entry ledger per debt)
   - Amortization hook in saveTransaction() via onPayeeChange
   - BCB API integration for SELIC/IPCA/IGPM/CDI/Poupança
   - Scheduled update job with idempotency guard
═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Module state ─────────────────────────────────────────────────────────────
const _dbt = {
  loaded:   false,
  debts:    [],     // loaded debts for this family
  ledger:   {},     // { [debtId]: [entries] }
  updating: false,
};

// ── Index types ───────────────────────────────────────────────────────────────
const DEBT_INDEX_TYPES = [
  { code: 'fixed',    label: { pt: 'Juros Fixos',       en: 'Fixed Rate',     es: 'Tasa fija',    fr: 'Taux fixe' } },
  { code: 'selic',    label: { pt: 'SELIC',             en: 'SELIC',          es: 'SELIC',        fr: 'SELIC' } },
  { code: 'ipca',     label: { pt: 'IPCA',              en: 'IPCA',           es: 'IPCA',         fr: 'IPCA' } },
  { code: 'igpm',     label: { pt: 'IGPM',              en: 'IGPM',           es: 'IGPM',         fr: 'IGPM' } },
  { code: 'cdi',      label: { pt: 'CDI',               en: 'CDI',            es: 'CDI',          fr: 'CDI' } },
  { code: 'poupanca', label: { pt: 'Poupança',          en: 'Savings Rate',   es: 'Poupança',     fr: 'Épargne' } },
  { code: 'custom',   label: { pt: 'Manual / Outro',    en: 'Manual / Other', es: 'Manual / Otro',fr: 'Manuel / Autre' } },
];

const DEBT_PERIODICITIES = [
  { code: 'monthly',   label: { pt: 'Mensal',     en: 'Monthly',   es: 'Mensual',  fr: 'Mensuel' } },
  { code: 'quarterly', label: { pt: 'Trimestral', en: 'Quarterly', es: 'Trimestral',fr:'Trimestriel'} },
  { code: 'annual',    label: { pt: 'Anual',      en: 'Annual',    es: 'Anual',    fr: 'Annuel' } },
  { code: 'manual',    label: { pt: 'Manual',     en: 'Manual',    es: 'Manual',   fr: 'Manuel' } },
];

const DEBT_STATUSES = [
  { code: 'active',        label: { pt: 'Ativa',          en: 'Active',       es: 'Activa',        fr: 'Active' } },
  { code: 'settled',       label: { pt: 'Quitada',        en: 'Settled',      es: 'Saldada',       fr: 'Soldée' } },
  { code: 'suspended',     label: { pt: 'Suspensa',       en: 'Suspended',    es: 'Suspendida',    fr: 'Suspendue' } },
  { code: 'renegotiated',  label: { pt: 'Renegociada',    en: 'Renegotiated', es: 'Renegociada',   fr: 'Renégociée' } },
  { code: 'archived',      label: { pt: 'Arquivada',      en: 'Archived',     es: 'Archivada',     fr: 'Archivée' } },
];

const DEBT_ENTRY_TYPES = [
  { code: 'initial',     label: { pt: 'Abertura', en: 'Opening', es: 'Apertura', fr: 'Ouverture' } },
  { code: 'adjustment',  label: { pt: 'Atualização por Índice', en: 'Index Update', es: 'Actualización por índice', fr: 'Mise à jour d\'indice' } },
  { code: 'interest',    label: { pt: 'Juros Fixos', en: 'Fixed Interest', es: 'Interés fijo', fr: 'Intérêts fixes' } },
  { code: 'amortization',label: { pt: 'Amortização', en: 'Amortization', es: 'Amortización', fr: 'Amortissement' } },
  { code: 'manual',      label: { pt: 'Ajuste Manual', en: 'Manual Adjustment', es: 'Ajuste manual', fr: 'Ajustement manuel' } },
  { code: 'reversal',    label: { pt: 'Estorno', en: 'Reversal', es: 'Reversión', fr: 'Annulation' } },
  { code: 'settlement',  label: { pt: 'Quitação', en: 'Settlement', es: 'Liquidación', fr: 'Liquidation' } },
];

// ── BCB (Banco Central) API rates ─────────────────────────────────────────────
const BCB_SERIES = {
  selic:    11,    // SELIC meta (% a.a.)
  ipca:     433,   // IPCA acumulado 12m
  cdi:      4391,  // CDI diário
  poupanca: 195,   // Poupança mensal
  // IGPM — from FGV; BCB does not have a direct series; use 189 (IGPM mensal via BCB)
  igpm:     189,
};

// ── Helper: local lang ────────────────────────────────────────────────────────
function _dl(obj) {
  const lang = (typeof i18nGetLanguage === 'function') ? i18nGetLanguage() : 'pt';
  return obj[lang] || obj['pt'] || '';
}

// ── Feature flag ─────────────────────────────────────────────────────────────
async function isDebtsEnabled() {
  const fid = famId();
  if (!fid) return false;
  const cacheKey = 'debts_enabled_' + fid;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache)
    return !!window._familyFeaturesCache[cacheKey];
  const raw = await getAppSetting(cacheKey, false);
  const enabled = raw === true || raw === 'true';
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  window._familyFeaturesCache[cacheKey] = enabled;
  return enabled;
}

async function applyDebtsFeature() {
  const fid = famId();
  const navEl  = document.getElementById('debtsNav');
  const pageEl = document.getElementById('page-debts');
  if (!fid) {
    if (navEl) navEl.style.display = 'none';
    return;
  }
  const on = await isDebtsEnabled();
  if (navEl) { navEl.style.display = on ? '' : 'none'; navEl.dataset.featureControlled = '1'; }
  if (pageEl) pageEl.style.display = on ? '' : 'none';
  if (typeof _syncModulesSection === 'function') _syncModulesSection();
  if (on && !_dbt.loaded) await loadDebts();
}
window.applyDebtsFeature = applyDebtsFeature;

async function toggleFamilyDebts(familyId, enabled) {
  await saveAppSetting('debts_enabled_' + familyId, enabled);
  window._familyFeaturesCache = window._familyFeaturesCache || {};
  window._familyFeaturesCache['debts_enabled_' + familyId] = enabled;
  applyDebtsFeature().catch(() => {});
  toast(enabled ? t('dbt.enabled_toast') : t('dbt.disabled_toast'), 'success');
}
window.toggleFamilyDebts = toggleFamilyDebts;

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadDebts(force = false) {
  if (_dbt.loaded && !force) return;
  const { data, error } = await famQ(
    sb.from('debts')
      .select(`*, payees(id,name), creditor:payees!debts_creditor_payee_id_fkey(id,name)`)
  ).order('created_at', { ascending: false });
  if (error) { console.error('[debts] load error:', error.message); return; }
  _dbt.debts = data || [];
  _dbt.loaded = true;
}

async function loadDebtLedger(debtId) {
  const { data, error } = await sb
    .from('debt_ledger')
    .select('*')
    .eq('debt_id', debtId)
    .order('entry_date', { ascending: false });
  if (error) { console.error('[debts] ledger error:', error.message); return []; }
  _dbt.ledger[debtId] = data || [];
  return data || [];
}

// ── Current balance from ledger ───────────────────────────────────────────────
function _debtCurrentBalance(debt) {
  // Stored in debt.current_balance (updated after every ledger entry)
  return parseFloat(debt.current_balance || debt.original_amount || 0);
}

// ── Page init ─────────────────────────────────────────────────────────────────
async function loadDebtsPage() {
  if (!await isDebtsEnabled()) return;
  await loadDebts(true);
  renderDebtsPage();
}
window.loadDebtsPage = loadDebtsPage;

function renderDebtsPage() {
  const page = document.getElementById('page-debts');
  if (!page) return;

  const active   = _dbt.debts.filter(d => d.status === 'active');
  const totalActive = active.reduce((s, d) => s + _debtCurrentBalance(d), 0);

  page.innerHTML = `
<div class="page-inner">
  <!-- Header -->
  <div class="section-header mb-4">
    <span class="section-title">${t('dbt.title')}</span>
    <button class="btn btn-primary btn-sm" onclick="openDebtModal()">+ ${t('dbt.add')}</button>
  </div>

  <!-- KPI strip -->
  <div class="dbt-kpi-strip mb-4">
    <div class="dbt-kpi">
      <span class="dbt-kpi-label">${t('dbt.kpi_total_active')}</span>
      <span class="dbt-kpi-value">${fmt(totalActive)}</span>
    </div>
    <div class="dbt-kpi">
      <span class="dbt-kpi-label">${t('dbt.kpi_count')}</span>
      <span class="dbt-kpi-value">${active.length}</span>
    </div>
    <div class="dbt-kpi">
      <span class="dbt-kpi-label">${t('dbt.kpi_settled')}</span>
      <span class="dbt-kpi-value">${_dbt.debts.filter(d=>d.status==='settled').length}</span>
    </div>
  </div>

  <!-- Update all button -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button class="btn btn-ghost btn-sm" onclick="runDebtUpdateJob()" id="debtUpdateAllBtn">
      ↻ ${t('dbt.update_now')}
    </button>
  </div>

  <!-- List -->
  <div id="debtsList">
    ${_dbt.debts.length === 0
      ? `<div class="empty-state"><div class="es-icon">💳</div><p>${t('dbt.empty')}</p></div>`
      : _dbt.debts.map(d => _renderDebtCard(d)).join('')
    }
  </div>
</div>`;
}

function _renderDebtCard(d) {
  const balance = _debtCurrentBalance(d);
  const orig    = parseFloat(d.original_amount || 0);
  const pct     = orig > 0 ? Math.min(100, (1 - balance / orig) * 100) : 0;
  const statusObj = DEBT_STATUSES.find(s => s.code === d.status) || DEBT_STATUSES[0];
  const indexObj  = DEBT_INDEX_TYPES.find(i => i.code === d.adjustment_type) || DEBT_INDEX_TYPES[0];
  const statusColor = { active:'var(--red)', settled:'var(--green)', suspended:'var(--amber)', renegotiated:'#7c3aed', archived:'var(--muted)' }[d.status] || 'var(--muted)';

  return `
<div class="card mb-3 dbt-card" onclick="openDebtDetail('${d.id}')" style="cursor:pointer">
  <div class="dbt-card-header">
    <div>
      <div class="dbt-card-name">${esc(d.name)}</div>
      <div class="dbt-card-creditor">${esc(d.creditor?.name || d.creditor_name || '—')}</div>
    </div>
    <div style="text-align:right">
      <div class="dbt-card-balance">${fmt(balance, d.currency)}</div>
      <span class="dbt-badge" style="background:${statusColor}22;color:${statusColor}">${_dl(statusObj.label)}</span>
    </div>
  </div>
  <div class="dbt-progress-bar">
    <div class="dbt-progress-fill" style="width:${pct.toFixed(1)}%"></div>
  </div>
  <div class="dbt-card-meta">
    <span>${_dl(indexObj.label)}</span>
    <span>${t('dbt.original')}: ${fmt(orig, d.currency)}</span>
    <span>${t('dbt.amortized')}: ${fmt(orig - balance, d.currency)}</span>
  </div>
</div>`;
}

// ── Debt detail ───────────────────────────────────────────────────────────────
async function openDebtDetail(debtId) {
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;
  const ledger = await loadDebtLedger(debtId);

  const modal = document.getElementById('debtDetailModal');
  if (!modal) return;

  const balance  = _debtCurrentBalance(debt);
  const orig     = parseFloat(debt.original_amount || 0);
  const totalAdj = ledger.filter(e => ['adjustment','interest'].includes(e.entry_type)).reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const totalAmt = ledger.filter(e => e.entry_type==='amortization').reduce((s,e)=>s+Math.abs(parseFloat(e.amount||0)),0);
  const indexObj = DEBT_INDEX_TYPES.find(i => i.code === debt.adjustment_type) || DEBT_INDEX_TYPES[0];
  const perObj   = DEBT_PERIODICITIES.find(p => p.code === debt.periodicity) || DEBT_PERIODICITIES[0];

  document.getElementById('debtDetailBody').innerHTML = `
<div class="dbt-detail-grid">
  <!-- Left: info -->
  <div>
    <h3 class="dbt-detail-name">${esc(debt.name)}</h3>
    <div class="dbt-detail-creditor">
      <span class="dbt-detail-label">${t('dbt.creditor')}</span>
      <strong>${esc(debt.creditor?.name || '—')}</strong>
    </div>

    <div class="dbt-kpi-strip mt-3 mb-3" style="grid-template-columns:1fr 1fr">
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.original')}</span><span class="dbt-kpi-value">${fmt(orig, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.current_balance')}</span><span class="dbt-kpi-value" style="color:var(--red)">${fmt(balance, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.total_adjustments')}</span><span class="dbt-kpi-value">${fmt(totalAdj, debt.currency)}</span></div>
      <div class="dbt-kpi"><span class="dbt-kpi-label">${t('dbt.total_amortized')}</span><span class="dbt-kpi-value" style="color:var(--green)">${fmt(totalAmt, debt.currency)}</span></div>
    </div>

    <div class="dbt-meta-row"><span>${t('dbt.index_type')}</span><strong>${_dl(indexObj.label)}${debt.fixed_rate ? ' · ' + parseFloat(debt.fixed_rate).toFixed(2) + '% a.a.' : ''}</strong></div>
    <div class="dbt-meta-row"><span>${t('dbt.periodicity')}</span><strong>${_dl(perObj.label)}</strong></div>
    <div class="dbt-meta-row"><span>${t('dbt.start_date')}</span><strong>${fmtDate(debt.start_date)}</strong></div>
    ${debt.contract_ref ? `<div class="dbt-meta-row"><span>${t('dbt.contract_ref')}</span><strong>${esc(debt.contract_ref)}</strong></div>` : ''}
    ${debt.notes ? `<div class="dbt-meta-row"><span>${t('ui.notes')}</span><p style="margin:0;font-size:.8rem;color:var(--text2)">${esc(debt.notes)}</p></div>` : ''}

    <div class="mt-3" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="openDebtModal('${debt.id}')">✏️ ${t('ui.edit')}</button>
      <button class="btn btn-ghost btn-sm" onclick="_openDebtManualEntry('${debt.id}')">+ ${t('dbt.manual_entry')}</button>
      ${debt.status==='active' ? `<button class="btn btn-ghost btn-sm" onclick="_settleDebt('${debt.id}')" style="color:var(--green)">✓ ${t('dbt.settle')}</button>` : ''}
    </div>
  </div>

  <!-- Right: ledger -->
  <div>
    <h4 style="font-size:.8rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">${t('dbt.ledger')}</h4>
    <div class="dbt-ledger" id="debtLedger_${debt.id}">
      ${ledger.length === 0
        ? `<div style="text-align:center;color:var(--muted);padding:20px;font-size:.8rem">${t('dbt.no_entries')}</div>`
        : ledger.map(e => _renderLedgerEntry(e, debt.currency)).join('')
      }
    </div>
  </div>
</div>`;

  openModal('debtDetailModal');
}
window.openDebtDetail = openDebtDetail;

function _renderLedgerEntry(e, currency) {
  const typeObj = DEBT_ENTRY_TYPES.find(t => t.code === e.entry_type) || { label:{ pt:e.entry_type } };
  const isAmt   = parseFloat(e.amount||0);
  const color   = e.entry_type === 'amortization' ? 'var(--green)' : isAmt > 0 ? 'var(--red)' : 'var(--text)';
  const sign    = isAmt > 0 ? '+' : '';
  return `
<div class="dbt-ledger-entry">
  <div class="dbt-ledger-left">
    <div class="dbt-ledger-type">${_dl(typeObj.label)}</div>
    <div class="dbt-ledger-date">${fmtDate(e.entry_date)}${e.rate_applied ? ' · ' + parseFloat(e.rate_applied).toFixed(4) + '%' : ''}</div>
    ${e.description ? `<div class="dbt-ledger-desc">${esc(e.description)}</div>` : ''}
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div style="font-weight:700;color:${color}">${sign}${fmt(isAmt, currency)}</div>
    <div style="font-size:.7rem;color:var(--muted)">${t('dbt.balance')}: ${fmt(parseFloat(e.resulting_balance||0), currency)}</div>
  </div>
</div>`;
}

// ── Create / Edit Debt modal ──────────────────────────────────────────────────
function openDebtModal(debtId = null) {
  const modal = document.getElementById('debtFormModal');
  if (!modal) return;

  const debt = debtId ? _dbt.debts.find(d => d.id === debtId) : null;
  const isEdit = !!debt;

  // Populate payees for creditor select
  const payeeOptions = (state.payees || []).map(p =>
    `<option value="${p.id}" ${debt?.creditor_payee_id===p.id?'selected':''}>${esc(p.name)}</option>`
  ).join('');

  const indexOptions = DEBT_INDEX_TYPES.map(i =>
    `<option value="${i.code}" ${debt?.adjustment_type===i.code?'selected':''}>${_dl(i.label)}</option>`
  ).join('');

  const periodicityOptions = DEBT_PERIODICITIES.map(p =>
    `<option value="${p.code}" ${debt?.periodicity===p.code?'selected':''}>${_dl(p.label)}</option>`
  ).join('');

  const statusOptions = DEBT_STATUSES.map(s =>
    `<option value="${s.code}" ${debt?.status===s.code?'selected':''}>${_dl(s.label)}</option>`
  ).join('');

  document.getElementById('debtFormBody').innerHTML = `
<input type="hidden" id="debtFormId" value="${debtId||''}">
<div class="form-group">
  <label>${t('dbt.name')} *</label>
  <input class="form-input" id="debtFormName" value="${esc(debt?.name||'')}" placeholder="${t('dbt.name_placeholder')}">
</div>
<div class="form-group">
  <label>${t('dbt.creditor')} *</label>
  <div style="display:flex;gap:8px">
    <select class="form-select" id="debtFormCreditor" style="flex:1">
      <option value="">${t('ui.select')}…</option>
      ${payeeOptions}
    </select>
    <button class="btn btn-ghost btn-sm" onclick="openPayeeModal()" title="${t('dbt.add_creditor')}">+</button>
  </div>
</div>
<div class="form-row-2">
  <div class="form-group">
    <label>${t('dbt.original_amount')} *</label>
    <input class="form-input" id="debtFormAmount" type="number" step="0.01" min="0.01"
           value="${debt?.original_amount||''}">
  </div>
  <div class="form-group">
    <label>${t('ui.currency')}</label>
    <select class="form-select" id="debtFormCurrency">
      <option value="BRL" ${(!debt||debt.currency==='BRL')?'selected':''}>BRL R$</option>
      <option value="USD" ${debt?.currency==='USD'?'selected':''}>USD $</option>
      <option value="EUR" ${debt?.currency==='EUR'?'selected':''}>EUR €</option>
    </select>
  </div>
</div>
<div class="form-row-2">
  <div class="form-group">
    <label>${t('dbt.start_date')} *</label>
    <input class="form-input" id="debtFormStartDate" type="date"
           value="${debt?.start_date || new Date().toISOString().slice(0,10)}">
  </div>
  <div class="form-group">
    <label>${t('ui.status')}</label>
    <select class="form-select" id="debtFormStatus">${statusOptions}</select>
  </div>
</div>
<div class="form-row-2">
  <div class="form-group">
    <label>${t('dbt.index_type')} *</label>
    <select class="form-select" id="debtFormIndex" onchange="_onDebtIndexChange()">
      ${indexOptions}
    </select>
  </div>
  <div class="form-group">
    <label>${t('dbt.periodicity')}</label>
    <select class="form-select" id="debtFormPeriodicity">${periodicityOptions}</select>
  </div>
</div>
<div class="form-group" id="debtFixedRateGroup" style="${debt?.adjustment_type==='fixed'?'':'display:none'}">
  <label>${t('dbt.fixed_rate')} (% a.a.) *</label>
  <input class="form-input" id="debtFormFixedRate" type="number" step="0.01"
         value="${debt?.fixed_rate||''}">
</div>
<div class="form-group">
  <label>${t('dbt.contract_ref')}</label>
  <input class="form-input" id="debtFormContractRef" value="${esc(debt?.contract_ref||'')}">
</div>
<div class="form-group">
  <label>${t('ui.notes')}</label>
  <textarea class="form-input" id="debtFormNotes" rows="2">${esc(debt?.notes||'')}</textarea>
</div>`;

  document.getElementById('debtFormTitle').textContent = isEdit ? t('dbt.edit') : t('dbt.add');
  openModal('debtFormModal');
}
window.openDebtModal = openDebtModal;

function _onDebtIndexChange() {
  const val = document.getElementById('debtFormIndex')?.value;
  const grp = document.getElementById('debtFixedRateGroup');
  if (grp) grp.style.display = val === 'fixed' ? '' : 'none';
}
window._onDebtIndexChange = _onDebtIndexChange;

async function saveDebt() {
  const id       = document.getElementById('debtFormId').value;
  const name     = document.getElementById('debtFormName').value.trim();
  const creditor = document.getElementById('debtFormCreditor').value;
  const amount   = parseFloat(document.getElementById('debtFormAmount').value);
  const currency = document.getElementById('debtFormCurrency').value;
  const startDate= document.getElementById('debtFormStartDate').value;
  const status   = document.getElementById('debtFormStatus').value;
  const indexType= document.getElementById('debtFormIndex').value;
  const period   = document.getElementById('debtFormPeriodicity').value;
  const fixedRate= parseFloat(document.getElementById('debtFormFixedRate')?.value||'0') || null;
  const contractRef = document.getElementById('debtFormContractRef').value.trim();
  const notes    = document.getElementById('debtFormNotes').value.trim();

  if (!name)     { toast(t('dbt.err_name'), 'error'); return; }
  if (!creditor) { toast(t('dbt.err_creditor'), 'error'); return; }
  if (!amount || amount <= 0) { toast(t('dbt.err_amount'), 'error'); return; }
  if (!startDate) { toast(t('dbt.err_start_date'), 'error'); return; }
  if (indexType === 'fixed' && (!fixedRate || fixedRate <= 0)) { toast(t('dbt.err_fixed_rate'), 'error'); return; }

  const data = {
    name, creditor_payee_id: creditor, original_amount: amount, currency,
    start_date: startDate, status, adjustment_type: indexType, periodicity: period,
    fixed_rate: indexType === 'fixed' ? fixedRate : null,
    contract_ref: contractRef || null, notes: notes || null,
    family_id: famId(), updated_at: new Date().toISOString(),
  };

  let error, result;
  if (id) {
    ({ error } = await sb.from('debts').update(data).eq('id', id));
  } else {
    data.current_balance = amount; // initial balance = original amount
    ({ data: result, error } = await sb.from('debts').insert(data).select().single());
    // Create opening ledger entry
    if (!error && result) {
      await sb.from('debt_ledger').insert({
        debt_id: result.id,
        entry_date: startDate,
        entry_type: 'initial',
        description: t('dbt.entry_opening'),
        amount: amount,
        previous_balance: 0,
        resulting_balance: amount,
        source_type: 'manual',
        family_id: famId(),
        created_at: new Date().toISOString(),
      });
    }
  }

  if (error) { toast(t('dbt.err_save') + ': ' + error.message, 'error'); return; }
  toast(t('dbt.saved'), 'success');
  closeModal('debtFormModal');
  await loadDebts(true);
  renderDebtsPage();
}
window.saveDebt = saveDebt;

// ── Manual ledger entry ───────────────────────────────────────────────────────
function _openDebtManualEntry(debtId) {
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const typeOptions = DEBT_ENTRY_TYPES.filter(t => !['initial'].includes(t.code))
    .map(t => `<option value="${t.code}">${_dl(t.label)}</option>`).join('');

  document.getElementById('debtManualBody').innerHTML = `
<input type="hidden" id="debtManualDebtId" value="${debtId}">
<div class="form-group">
  <label>${t('dbt.entry_type')}</label>
  <select class="form-select" id="debtManualType">${typeOptions}</select>
</div>
<div class="form-group">
  <label>${t('ui.date')}</label>
  <input class="form-input" type="date" id="debtManualDate" value="${new Date().toISOString().slice(0,10)}">
</div>
<div class="form-group">
  <label>${t('ui.amount')} ${d => d.entry_type==='amortization'?'(positivo = reduz dívida)':''}</label>
  <input class="form-input" type="number" step="0.01" id="debtManualAmount">
</div>
<div class="form-group">
  <label>${t('ui.description')}</label>
  <input class="form-input" id="debtManualDesc">
</div>
<div class="form-group">
  <label>${t('dbt.rate_applied')} (%)</label>
  <input class="form-input" type="number" step="0.0001" id="debtManualRate">
</div>`;

  openModal('debtManualModal');
}
window._openDebtManualEntry = _openDebtManualEntry;

async function saveDebtManualEntry() {
  const debtId = document.getElementById('debtManualDebtId').value;
  const type   = document.getElementById('debtManualType').value;
  const date   = document.getElementById('debtManualDate').value;
  const rawAmt = parseFloat(document.getElementById('debtManualAmount').value);
  const desc   = document.getElementById('debtManualDesc').value.trim();
  const rate   = parseFloat(document.getElementById('debtManualRate').value) || null;

  if (!date || isNaN(rawAmt) || rawAmt === 0) { toast(t('dbt.err_entry'), 'error'); return; }

  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const prevBalance = _debtCurrentBalance(debt);
  // Amortization reduces debt (subtract), all others add
  const delta = type === 'amortization' ? -Math.abs(rawAmt) : Math.abs(rawAmt);
  const newBalance = Math.max(0, prevBalance + delta);

  const { error: ledgerErr } = await sb.from('debt_ledger').insert({
    debt_id: debtId, entry_date: date, entry_type: type,
    description: desc || _dl(DEBT_ENTRY_TYPES.find(t=>t.code===type)?.label||{pt:type}),
    amount: delta, rate_applied: rate,
    previous_balance: prevBalance, resulting_balance: newBalance,
    source_type: 'manual', family_id: famId(), created_at: new Date().toISOString(),
  });
  if (ledgerErr) { toast(t('dbt.err_save') + ': ' + ledgerErr.message, 'error'); return; }

  // Update debt current_balance
  await sb.from('debts').update({
    current_balance: newBalance,
    status: newBalance <= 0 ? 'settled' : debt.status,
    updated_at: new Date().toISOString(),
  }).eq('id', debtId);

  toast(t('dbt.entry_saved'), 'success');
  closeModal('debtManualModal');
  closeModal('debtDetailModal');
  await loadDebts(true);
  renderDebtsPage();
}
window.saveDebtManualEntry = saveDebtManualEntry;

// ── Settle debt ───────────────────────────────────────────────────────────────
async function _settleDebt(debtId) {
  if (!confirm(t('dbt.confirm_settle'))) return;
  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;
  const prevBalance = _debtCurrentBalance(debt);

  if (prevBalance > 0) {
    await sb.from('debt_ledger').insert({
      debt_id: debtId, entry_date: new Date().toISOString().slice(0,10),
      entry_type: 'settlement', description: t('dbt.entry_settlement'),
      amount: -prevBalance, previous_balance: prevBalance, resulting_balance: 0,
      source_type: 'manual', family_id: famId(), created_at: new Date().toISOString(),
    });
  }
  await sb.from('debts').update({ status: 'settled', current_balance: 0, updated_at: new Date().toISOString() }).eq('id', debtId);
  toast(t('dbt.settled_toast'), 'success');
  closeModal('debtDetailModal');
  await loadDebts(true);
  renderDebtsPage();
}
window._settleDebt = _settleDebt;

// ── BCB API rate fetch ────────────────────────────────────────────────────────
async function _fetchBcbRate(seriesId) {
  // BCB OLINDA API — last available value
  const url = `https://servicodados.ibge.gov.br/api/v3/`;
  const bcbUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados/ultimos/1?formato=json`;
  try {
    const resp = await fetch(bcbUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.length) return null;
    const item = json[0];
    return { date: item.data, rate: parseFloat(item.valor.replace(',', '.')) };
  } catch (e) {
    console.warn('[debts] BCB fetch failed for series', seriesId, e.message);
    return null;
  }
}

// ── Scheduled update job ──────────────────────────────────────────────────────
async function runDebtUpdateJob(manual = true) {
  if (_dbt.updating) { toast(t('dbt.update_running'), 'info'); return; }
  _dbt.updating = true;
  const btn = document.getElementById('debtUpdateAllBtn');
  if (btn) btn.disabled = true;

  try {
    await loadDebts(true);
    const active = _dbt.debts.filter(d => d.status === 'active' && d.adjustment_type !== 'custom');
    if (active.length === 0) { toast(t('dbt.no_active'), 'info'); return; }

    let updated = 0, failed = 0;
    const today = new Date().toISOString().slice(0, 10);
    const competencePeriod = today.slice(0, 7); // YYYY-MM

    for (const debt of active) {
      if (debt.periodicity === 'manual') continue;
      if (debt.adjustment_type === 'fixed') {
        // Fixed interest: compute monthly equivalent of annual rate
        const annualRate = parseFloat(debt.fixed_rate || 0);
        if (!annualRate) continue;
        const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
        const prevBalance = _debtCurrentBalance(debt);
        const interest = prevBalance * monthlyRate;

        // Idempotency: check if already posted for this period
        const { data: existing } = await sb.from('debt_ledger')
          .select('id').eq('debt_id', debt.id)
          .eq('competence_period', competencePeriod)
          .eq('entry_type', 'interest').maybeSingle();
        if (existing) continue;

        const newBalance = prevBalance + interest;
        await sb.from('debt_ledger').insert({
          debt_id: debt.id, entry_date: today, entry_type: 'interest',
          description: `${t('dbt.entry_interest')} ${annualRate}% a.a. (${(monthlyRate*100).toFixed(4)}% a.m.)`,
          amount: interest, rate_applied: monthlyRate * 100,
          previous_balance: prevBalance, resulting_balance: newBalance,
          competence_period: competencePeriod, source_type: 'auto',
          family_id: famId(), created_at: new Date().toISOString(),
        });
        await sb.from('debts').update({ current_balance: newBalance, updated_at: new Date().toISOString() }).eq('id', debt.id);
        updated++;
        continue;
      }

      // Index-based (BCB API)
      const seriesId = BCB_SERIES[debt.adjustment_type];
      if (!seriesId) continue;

      const rateData = await _fetchBcbRate(seriesId);
      if (!rateData) { failed++; continue; }

      // Idempotency: check if already posted for this period
      const { data: existing } = await sb.from('debt_ledger')
        .select('id').eq('debt_id', debt.id)
        .eq('competence_period', competencePeriod)
        .in('entry_type', ['adjustment', 'interest']).maybeSingle();
      if (existing) continue;

      const rate = rateData.rate;
      const prevBalance = _debtCurrentBalance(debt);
      const delta = prevBalance * (rate / 100);
      const newBalance = prevBalance + delta;

      await sb.from('debt_ledger').insert({
        debt_id: debt.id, entry_date: today, entry_type: 'adjustment',
        description: `${_dl(DEBT_INDEX_TYPES.find(i=>i.code===debt.adjustment_type)?.label||{pt:''})} ${rate}%`,
        amount: delta, rate_applied: rate,
        previous_balance: prevBalance, resulting_balance: newBalance,
        competence_period: competencePeriod,
        source_type: 'bcb_api',
        family_id: famId(), created_at: new Date().toISOString(),
      });
      await sb.from('debts').update({ current_balance: newBalance, updated_at: new Date().toISOString() }).eq('id', debt.id);
      updated++;
    }

    const msg = `${t('dbt.update_done')}: ${updated} ${t('dbt.updated')}${failed ? ', ' + failed + ' ' + t('dbt.failed') : ''}`;
    toast(msg, updated > 0 ? 'success' : 'info');
    await loadDebts(true);
    renderDebtsPage();
  } catch (e) {
    console.error('[debts] update job error:', e);
    toast(t('dbt.update_error'), 'error');
  } finally {
    _dbt.updating = false;
    if (btn) btn.disabled = false;
  }
}
window.runDebtUpdateJob = runDebtUpdateJob;

// ── Amortization hook — called when payee is selected in transaction form ─────
async function checkDebtAmortization(payeeId) {
  if (!payeeId || !await isDebtsEnabled()) return;
  if (!_dbt.loaded) await loadDebts();

  const activeDebts = _dbt.debts.filter(d =>
    d.creditor_payee_id === payeeId && d.status === 'active'
  );
  if (!activeDebts.length) return;

  // Show prompt banner inside tx modal
  let banner = document.getElementById('debtAmortizationBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'debtAmortizationBanner';
    banner.className = 'dbt-amort-banner';
    const memoGroup = document.getElementById('txMemo')?.closest('.form-group');
    if (memoGroup) memoGroup.parentNode.insertBefore(banner, memoGroup);
    else document.getElementById('txForm')?.appendChild(banner);
  }

  const debtOptions = activeDebts.map(d =>
    `<option value="${d.id}">${esc(d.name)} (${fmt(_debtCurrentBalance(d), d.currency)})</option>`
  ).join('');

  banner.innerHTML = `
<div class="dbt-amort-inner">
  <div class="dbt-amort-icon">💳</div>
  <div class="dbt-amort-body">
    <div class="dbt-amort-title">${t('dbt.amort_prompt_title')}</div>
    <div class="dbt-amort-sub">${t('dbt.amort_prompt_sub')}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <select class="form-select" id="debtAmortSelect" style="flex:1;min-width:150px">${debtOptions}</select>
      <button class="btn btn-primary btn-sm" onclick="_confirmAmortization()">✓ ${t('dbt.amort_confirm')}</button>
      <button class="btn btn-ghost btn-sm" onclick="_dismissAmortization()">${t('ui.no')}</button>
    </div>
  </div>
</div>`;
  banner.style.display = '';
}
window.checkDebtAmortization = checkDebtAmortization;

function _dismissAmortization() {
  const b = document.getElementById('debtAmortizationBanner');
  if (b) b.style.display = 'none';
  // Clear any stored amortization state
  window._pendingAmortDebtId = null;
}
window._dismissAmortization = _dismissAmortization;

function _confirmAmortization() {
  const debtId = document.getElementById('debtAmortSelect')?.value;
  if (!debtId) return;
  window._pendingAmortDebtId = debtId;

  // Auto-set category to "Amortização de Dívida"
  const amortCat = (state.categories || []).find(c =>
    c.name?.toLowerCase().includes('amortiza') || c.slug === 'amortizacao_divida'
  );
  if (amortCat && typeof setCatPickerValue === 'function') setCatPickerValue(amortCat.id);

  const b = document.getElementById('debtAmortizationBanner');
  if (b) b.innerHTML = `<div class="dbt-amort-banner-ok">✓ ${t('dbt.amort_linked')} — ${_dbt.debts.find(d=>d.id===debtId)?.name||''}</div>`;

  toast(t('dbt.amort_set'), 'info');
}
window._confirmAmortization = _confirmAmortization;

// Called after saveTransaction() successfully posts the expense leg
async function postDebtAmortizationEntry(txAmount, txDate, txId) {
  const debtId = window._pendingAmortDebtId;
  if (!debtId) return;
  window._pendingAmortDebtId = null;

  const debt = _dbt.debts.find(d => d.id === debtId);
  if (!debt) return;

  const prevBalance = _debtCurrentBalance(debt);
  const amortAmount = Math.abs(txAmount);
  const newBalance  = Math.max(0, prevBalance - amortAmount);

  await sb.from('debt_ledger').insert({
    debt_id: debtId, entry_date: txDate || new Date().toISOString().slice(0,10),
    entry_type: 'amortization',
    description: t('dbt.entry_amortization'),
    amount: -amortAmount, rate_applied: null,
    previous_balance: prevBalance, resulting_balance: newBalance,
    source_type: 'transaction', source_reference_id: txId || null,
    family_id: famId(), created_at: new Date().toISOString(),
  });

  await sb.from('debts').update({
    current_balance: newBalance,
    status: newBalance <= 0.01 ? 'settled' : debt.status,
    updated_at: new Date().toISOString(),
  }).eq('id', debtId);

  _dbt.loaded = false; // invalidate cache
  toast(t('dbt.amort_posted'), 'success');
}
window.postDebtAmortizationEntry = postDebtAmortizationEntry;

// ── SQL Migration (run in Supabase SQL Editor) ────────────────────────────────
window._DEBTS_SQL_MIGRATION = `
-- ══════════════════════════════════════════════════════════
-- DEBTS MODULE — SQL Migration
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Debts table (virtual liability accounts)
CREATE TABLE IF NOT EXISTS debts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  creditor_payee_id UUID NOT NULL REFERENCES payees(id),
  name              TEXT NOT NULL,
  original_amount   NUMERIC(18,2) NOT NULL CHECK (original_amount > 0),
  current_balance   NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'BRL',
  start_date        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','settled','suspended','renegotiated','archived')),
  adjustment_type   TEXT NOT NULL DEFAULT 'fixed'
    CHECK (adjustment_type IN ('fixed','selic','ipca','igpm','cdi','poupanca','custom')),
  periodicity       TEXT NOT NULL DEFAULT 'monthly'
    CHECK (periodicity IN ('monthly','quarterly','annual','manual')),
  fixed_rate        NUMERIC(10,6),
  spread            NUMERIC(10,6),
  contract_ref      TEXT,
  notes             TEXT,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debts_family    ON debts(family_id);
CREATE INDEX IF NOT EXISTS idx_debts_creditor  ON debts(creditor_payee_id);
CREATE INDEX IF NOT EXISTS idx_debts_status    ON debts(status);

-- 2. Debt ledger (immutable journal entries)
CREATE TABLE IF NOT EXISTS debt_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id             UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  entry_date          DATE NOT NULL,
  entry_type          TEXT NOT NULL
    CHECK (entry_type IN ('initial','adjustment','interest','amortization','manual','reversal','settlement')),
  description         TEXT,
  amount              NUMERIC(18,2) NOT NULL,
  rate_applied        NUMERIC(12,6),
  previous_balance    NUMERIC(18,2) NOT NULL,
  resulting_balance   NUMERIC(18,2) NOT NULL,
  competence_period   TEXT,           -- YYYY-MM for idempotency
  source_type         TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','auto','bcb_api','transaction','system')),
  source_reference_id UUID,           -- linked transaction id if from tx
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debt_ledger_debt   ON debt_ledger(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_family ON debt_ledger(family_id);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_date   ON debt_ledger(entry_date);

-- Idempotency: prevent duplicate auto-updates for same debt+period+type
CREATE UNIQUE INDEX IF NOT EXISTS uq_debt_ledger_period
  ON debt_ledger(debt_id, competence_period, entry_type)
  WHERE competence_period IS NOT NULL
    AND entry_type IN ('adjustment','interest');

-- 3. Row Level Security
ALTER TABLE debts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "debts_family_access"  ON debts;
CREATE POLICY "debts_family_access" ON debts
  FOR ALL TO authenticated
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
    UNION SELECT family_id FROM app_users WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "debt_ledger_family_access" ON debt_ledger;
CREATE POLICY "debt_ledger_family_access" ON debt_ledger
  FOR ALL TO authenticated
  USING (family_id IN (
    SELECT family_id FROM family_members WHERE user_id = auth.uid()
    UNION SELECT family_id FROM app_users WHERE id = auth.uid()
  ));

-- 4. Amortização de Dívida category (auto-insert if not present)
-- Run per-family as needed; or insert manually in categories table:
-- INSERT INTO categories (name, type, icon, color, family_id)
-- SELECT 'Amortização de Dívida', 'expense', '💳', '#c0392b', id FROM families
-- WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug='amortizacao_divida' AND family_id=families.id);

SELECT 'Migration OK — Debts module ready' AS status;
`;
