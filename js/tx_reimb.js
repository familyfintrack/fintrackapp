// ════════════════════════════════════════════════════════════════════════════
// TX_REIMB — Vínculo de Reembolsos (Transações e Programados)
// ════════════════════════════════════════════════════════════════════════════
/* eslint-disable no-undef */

// ── Estado ──────────────────────────────────────────────────────────────────
const _reimb = {
  // contexto atual: quem está pedindo vínculo
  mode:         null,   // 'tx' | 'sc'
  originId:     null,   // tx.id ou sc.id da transação origem
  originDesc:   '',     // descrição para exibir no modal
  originAmount: 0,      // valor da origem
  // vínculo já existente (se editando)
  existingId:   null,   // id do registro tx_reimbursements
  linkedTxId:   null,   // reimbursement_tx_id já vinculado
};

// ── Abrir modal de vínculo de reembolso ─────────────────────────────────────
async function openReimbModal(mode, originId) {
  if (!mode || !originId) return;
  _reimb.mode     = mode;
  _reimb.originId = originId;

  // Descobrir descrição e valor da origem
  if (mode === 'tx') {
    const tx = (state.transactions || []).find(t => t.id === originId);
    _reimb.originDesc   = tx?.description || '';
    _reimb.originAmount = Math.abs(parseFloat(tx?.amount) || 0);
  } else {
    const sc = (state.scheduled || []).find(s => s.id === originId);
    _reimb.originDesc   = sc?.description || '';
    _reimb.originAmount = Math.abs(parseFloat(sc?.amount) || 0);
  }

  // Verificar se já existe vínculo
  _reimb.existingId = null;
  _reimb.linkedTxId = null;
  try {
    const col = mode === 'tx' ? 'origin_tx_id' : 'origin_sc_id';
    const { data } = await famQ(
      sb.from('tx_reimbursements').select('*')
    ).eq(col, originId).neq('status','cancelled').limit(1);
    if (data && data.length) {
      _reimb.existingId = data[0].id;
      _reimb.linkedTxId = data[0].reimbursement_tx_id;
    }
  } catch(e) { console.warn('[reimb] check existing:', e?.message); }

  await _reimbRender();
  openModal('reimbModal');
}
window.openReimbModal = openReimbModal;

// ── Renderizar conteúdo do modal ─────────────────────────────────────────────
async function _reimbRender() {
  const body = document.getElementById('reimbModalBody');
  if (!body) return;

  body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando…</div>`;

  // Buscar candidatos a reembolso:
  // - transações do tipo income (receita), confirmadas ou pendentes
  // - que ainda não estejam vinculadas como reimbursement_tx_id em outro registro
  let candidates = [];
  try {
    const alreadyLinked = new Set();
    // Busca reembolsos existentes para exclusão
    const { data: linked } = await famQ(
      sb.from('tx_reimbursements').select('reimbursement_tx_id')
    ).neq('status','cancelled').not('reimbursement_tx_id','is',null);
    (linked || []).forEach(r => { if (r.reimbursement_tx_id) alreadyLinked.add(r.reimbursement_tx_id); });
    // Se já tem vínculo atual, não excluímos ele da lista (para poder re-selecionar)
    if (_reimb.linkedTxId) alreadyLinked.delete(_reimb.linkedTxId);

    // Busca transações receita (income)
    const { data: txData } = await famQ(
      sb.from('transactions')
        .select('id,date,description,amount,currency,brl_amount,account_id,status,payee_id,category_id')
    ).gt('amount', 0).not('is_transfer', 'is', null)
      .in('status', ['confirmed','pending'])
      .order('date', { ascending: false })
      .limit(200);

    candidates = (txData || [])
      .filter(t => !t.is_transfer && !t.is_card_payment && !alreadyLinked.has(t.id))
      .slice(0, 150);
  } catch(e) { console.warn('[reimb] load candidates:', e?.message); }

  // Também buscar programados do tipo income como opção futura
  let scCandidates = [];
  try {
    const alreadyLinkedSc = new Set();
    const { data: linkedSc } = await famQ(
      sb.from('tx_reimbursements').select('origin_sc_id')
    ).neq('status','cancelled').not('origin_sc_id','is',null);
    (linkedSc || []).forEach(r => { if (r.origin_sc_id) alreadyLinkedSc.add(r.origin_sc_id); });

    scCandidates = (state.scheduled || [])
      .filter(s => s.type === 'income' && s.status === 'active' && !alreadyLinkedSc.has(s.id));
  } catch(e) {}

  _reimbRenderBody(body, candidates, scCandidates);
}

function _reimbRenderBody(body, candidates, scCandidates) {
  const fmtAmt = (amt, cur) => typeof dashFmt === 'function' ? dashFmt(Math.abs(+amt||0), cur||'BRL') : 'R$ '+(Math.abs(+amt||0)).toFixed(2);
  const fmtDate = d => d ? d.split('-').reverse().join('/') : '';
  const linked = _reimb.linkedTxId;

  // Encontrar conta name helper
  const accName = id => (state.accounts||[]).find(a=>a.id===id)?.name || '';

  body.innerHTML = `
  <div style="padding:0">

    <!-- Cabeçalho contextual -->
    <div style="padding:12px 16px;background:var(--surface2);border-bottom:1px solid var(--border)">
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px">
        Vinculando reembolso de:
      </div>
      <div style="font-size:.9rem;font-weight:800;color:var(--text)">${esc(_reimb.originDesc||'—')}</div>
      ${_reimb.originAmount>0?`<div style="font-size:.78rem;color:var(--muted)">Valor: <strong>${fmtAmt(_reimb.originAmount)}</strong></div>`:''}
      ${linked?`<div style="margin-top:6px;padding:5px 9px;background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.25);border-radius:7px;font-size:.73rem;color:#16a34a;font-weight:700">
        ✔ Já vinculado — selecione outro para substituir ou clique em Remover
      </div>`:''}
    </div>

    <!-- Busca -->
    <div style="padding:10px 14px;border-bottom:1px solid var(--border)">
      <div style="position:relative">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
          style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted)">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="text" id="reimbSearch" placeholder="Buscar por descrição, valor ou data…"
          oninput="_reimbFilterList(this.value)"
          style="width:100%;padding:8px 10px 8px 30px;border:1.5px solid var(--border);border-radius:9px;
            font-size:.83rem;background:var(--surface);color:var(--text);font-family:inherit;box-sizing:border-box">
      </div>
    </div>

    <!-- Lista de transações receita -->
    <div id="reimbList" style="max-height:320px;overflow-y:auto;-webkit-overflow-scrolling:touch">
      ${candidates.length === 0 && scCandidates.length === 0
        ? `<div style="padding:24px;text-align:center;color:var(--muted);font-size:.82rem">
            Nenhuma receita disponível para vincular como reembolso.
           </div>`
        : ''}

      ${candidates.length > 0 ? `
      <div style="padding:6px 14px 2px;background:var(--surface2);border-bottom:1px solid var(--border)">
        <span style="font-size:.65rem;font-weight:700;text-transform:uppercase;color:var(--muted)">
          ✅ Transações registradas (receitas)
        </span>
      </div>
      ${candidates.map(t => {
        const isLinked = t.id === linked;
        const amt = typeof toBRL === 'function' ? toBRL(+t.amount||0, t.currency||'BRL') : (+t.amount||0);
        return `<div class="reimb-item" data-id="${t.id}" data-type="tx"
          data-search="${(t.description||'').toLowerCase()} ${t.date||''} ${String(Math.abs(+t.amount||0))}"
          onclick="selectReimbItem('${t.id}','tx')"
          style="display:flex;align-items:center;gap:10px;padding:9px 14px;
            cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s;
            background:${isLinked?'rgba(22,163,74,.06)':''}"
          onmouseover="this.style.background='var(--surface2)'"
          onmouseout="this.style.background=''">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:.84rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${esc(t.description||'—')}
              </span>
              ${isLinked?'<span style="font-size:.65rem;background:#16a34a;color:#fff;padding:1px 6px;border-radius:10px;flex-shrink:0">vinculado</span>':''}
              ${t.status==='pending'?'<span style="font-size:.65rem;background:rgba(245,158,11,.15);color:#d97706;padding:1px 5px;border-radius:6px;flex-shrink:0">⏳</span>':''}
            </div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:1px">
              ${fmtDate(t.date)}${accName(t.account_id)?' · '+esc(accName(t.account_id)):''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:#16a34a">
              + ${fmtAmt(amt)}
            </div>
          </div>
        </div>`;
      }).join('')}` : ''}

      ${scCandidates.length > 0 ? `
      <div style="padding:6px 14px 2px;background:var(--surface2);border-bottom:1px solid var(--border)">
        <span style="font-size:.65rem;font-weight:700;text-transform:uppercase;color:var(--muted)">
          ⏰ Programados futuros (receitas)
        </span>
      </div>
      ${scCandidates.map(sc => `
        <div class="reimb-item" data-id="${sc.id}" data-type="sc_income"
          data-search="${(sc.description||'').toLowerCase()} ${String(Math.abs(+sc.amount||0))}"
          onclick="selectReimbItem('${sc.id}','sc_income')"
          style="display:flex;align-items:center;gap:10px;padding:9px 14px;
            cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s"
          onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='var(--surface)'">
          <div style="flex:1;min-width:0">
            <div style="font-size:.84rem;font-weight:700;color:var(--text)">${esc(sc.description||'—')}</div>
            <div style="font-size:.68rem;color:var(--muted)">Programado · ${sc.frequency||''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.88rem;font-weight:800;font-family:var(--font-serif);color:#16a34a">
              + ${fmtAmt(Math.abs(+sc.amount||0))}
            </div>
            <div style="font-size:.63rem;color:var(--muted)">futuro</div>
          </div>
        </div>`).join('')}` : ''}
    </div>

    <!-- Rodapé -->
    <div style="padding:10px 14px;display:flex;gap:8px;border-top:1px solid var(--border)">
      ${linked?`<button class="btn btn-ghost btn-sm" onclick="_reimbRemoveLink()"
        style="color:#dc2626;border-color:rgba(220,38,38,.3)">
        🗑 Remover vínculo
      </button>`:''}
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('reimbModal')">Cancelar</button>
    </div>
  </div>`;

  // Guarda candidatos para filtro
  window._reimbCandidates = candidates;
  window._reimbScCandidates = scCandidates;
}

// ── Filtrar lista ao digitar ──────────────────────────────────────────────────
function _reimbFilterList(q) {
  const items = document.querySelectorAll('#reimbList .reimb-item');
  const lq = (q || '').toLowerCase().trim();
  items.forEach(el => {
    const search = (el.dataset.search || '').toLowerCase();
    el.style.display = !lq || search.includes(lq) ? '' : 'none';
  });
}
window._reimbFilterList = _reimbFilterList;

// ── Selecionar item para vincular ─────────────────────────────────────────────
async function selectReimbItem(itemId, itemType) {
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid) return;

  const originCol    = _reimb.mode === 'tx' ? 'origin_tx_id' : 'origin_sc_id';
  const originVal    = _reimb.originId;

  try {
    if (_reimb.existingId) {
      // Atualizar vínculo existente
      const updateData = { updated_at: new Date().toISOString() };
      if (itemType === 'tx') {
        updateData.reimbursement_tx_id = itemId;
        updateData.status = 'linked';
      } else {
        // programado futuro como origem do reembolso — mantém pending
        updateData.status = 'pending';
        updateData.reimbursement_tx_id = null;
      }
      const { error } = await sb.from('tx_reimbursements')
        .update(updateData).eq('id', _reimb.existingId);
      if (error) throw error;
    } else {
      // Criar novo vínculo
      const insertData = {
        family_id: fid,
        [originCol]: originVal,
        status: itemType === 'tx' ? 'linked' : 'pending',
        expected_amount: _reimb.originAmount || null,
      };
      if (itemType === 'tx') {
        insertData.reimbursement_tx_id = itemId;
      }
      const { error } = await sb.from('tx_reimbursements').insert(insertData);
      if (error) throw error;
    }

    closeModal('reimbModal');
    // Atualiza badge no botão do modal de origem
    _reimbUpdateBadge(_reimb.mode, originVal, true);
    toast('✔ Reembolso vinculado', 'success');
  } catch(e) {
    toast('Erro ao vincular: ' + (e?.message || e), 'error');
  }
}
window.selectReimbItem = selectReimbItem;

// ── Remover vínculo ───────────────────────────────────────────────────────────
async function _reimbRemoveLink() {
  if (!_reimb.existingId) return;
  try {
    const { error } = await sb.from('tx_reimbursements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', _reimb.existingId);
    if (error) throw error;
    closeModal('reimbModal');
    _reimbUpdateBadge(_reimb.mode, _reimb.originId, false);
    toast('Vínculo de reembolso removido', 'info');
  } catch(e) {
    toast('Erro ao remover: ' + (e?.message || e), 'error');
  }
}
window._reimbRemoveLink = _reimbRemoveLink;

// ── Atualizar badge no botão de origem ───────────────────────────────────────
function _reimbUpdateBadge(mode, originId, hasLink) {
  if (mode === 'tx') {
    const btn = document.getElementById('txReimbBtn');
    if (btn) {
      btn.style.borderColor = hasLink ? 'var(--accent)' : '';
      btn.style.background  = hasLink ? 'var(--accent-lt,rgba(42,96,73,.08))' : '';
      btn.style.color       = hasLink ? 'var(--accent)' : '';
      btn.title = hasLink ? 'Reembolso vinculado — clique para alterar' : 'Vincular reembolso';
      btn.innerHTML = hasLink
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> 🔗 Vinculado`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Reembolso`;
    }
  } else if (mode === 'sc') {
    const btn = document.getElementById('scReimbBtn');
    if (btn) {
      btn.style.borderColor = hasLink ? 'var(--accent)' : '';
      btn.style.background  = hasLink ? 'var(--accent-lt,rgba(42,96,73,.08))' : '';
      btn.style.color       = hasLink ? 'var(--accent)' : '';
    }
  }
}

// ── Verificar vínculo ao abrir modal de transação ────────────────────────────
async function checkReimbOnOpen(txId) {
  if (!txId) {
    // nova transação — esconde botão reembolso (só mostra se despesa)
    return;
  }
  const btn = document.getElementById('txReimbBtn');
  if (!btn) return;
  try {
    const { data } = await famQ(
      sb.from('tx_reimbursements').select('id,status,reimbursement_tx_id')
    ).eq('origin_tx_id', txId).neq('status','cancelled').limit(1);
    const hasLink = data && data.length > 0;
    _reimbUpdateBadge('tx', txId, hasLink);
  } catch(e) {}
}
window.checkReimbOnOpen = checkReimbOnOpen;

// ── Verificar vínculo ao abrir modal de programado ───────────────────────────
async function checkReimbOnScOpen(scId) {
  if (!scId) return;
  const btn = document.getElementById('scReimbBtn');
  if (!btn) return;
  try {
    const { data } = await famQ(
      sb.from('tx_reimbursements').select('id,status')
    ).eq('origin_sc_id', scId).neq('status','cancelled').limit(1);
    const hasLink = data && data.length > 0;
    _reimbUpdateBadge('sc', scId, hasLink);
  } catch(e) {}
}
window.checkReimbOnScOpen = checkReimbOnScOpen;

window.openReimbModal      = openReimbModal;
window.selectReimbItem     = selectReimbItem;
window._reimbRemoveLink    = _reimbRemoveLink;
window._reimbFilterList    = _reimbFilterList;
