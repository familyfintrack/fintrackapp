/* ═══════════════════════════════════════════════════════════════════════════
   LOYALTY — Módulo de Programas de Fidelidade
   Gerencia pontos de programas como Smiles, Livelo, LATAM Pass, TudoAzul, etc.

   Tabelas:  loyalty_programs · loyalty_transactions
   Expõe:    loadLoyaltyPrograms, renderLoyaltySection,
             openLoyaltyModal, updateLoyaltyPoints,
             openLoyaltyStatement, openLoyaltyConvert, openLoyaltyPurchase,
             getLoyaltyBadgeHtml (usado por accounts.js)
═══════════════════════════════════════════════════════════════════════════ */

/* ── Catálogo de programas populares no Brasil ────────────────────────────── */
const LOYALTY_CATALOG = [
  { type:'smiles',       name:'Smiles (GOL)',         icon:'😊', color:'#FF6600',
    api_url:'https://developers.smiles.com.br', has_api:true,
    note:'API disponível via parceria GOL/Smiles' },
  { type:'latam_pass',   name:'LATAM Pass',           icon:'🌎', color:'#E31837',
    api_url:'https://developer.latam.com', has_api:true,
    note:'API disponível via portal LATAM Airlines' },
  { type:'livelo',       name:'Livelo',               icon:'🔴', color:'#B31017',
    api_url:'https://developers.livelo.com.br', has_api:true,
    note:'API via portal Livelo para parceiros' },
  { type:'tudoazul',     name:'TudoAzul (Azul)',      icon:'💙', color:'#0056A2',
    api_url:'https://api.azul.com.br', has_api:true,
    note:'API disponível via parceria Azul Linhas Aéreas' },
  { type:'esfera',       name:'Esfera (Santander)',   icon:'🟡', color:'#E5001E',
    api_url:null, has_api:false,
    note:'Sem API pública — consulta manual pelo app/site Santander' },
  { type:'clube_itau',   name:'Clube Itaú',           icon:'🔶', color:'#FF6600',
    api_url:null, has_api:false,
    note:'Sem API pública — dados via app Itaú' },
  { type:'multiplus',    name:'Multiplus (Livelo)',   icon:'🟠', color:'#F47920',
    api_url:null, has_api:false,
    note:'Migrado para Livelo — use o tipo Livelo' },
  { type:'azul_mais',    name:'Azul Mais (Azul)',     icon:'✈️', color:'#004F9F',
    api_url:null, has_api:false,
    note:'Programa premium da Azul — sem API pública' },
  { type:'dotz',         name:'Dotz',                icon:'🟤', color:'#8B4513',
    api_url:null, has_api:false,
    note:'Sem API pública' },
  { type:'stix',         name:'Stix (Grupo Pão)',     icon:'🟢', color:'#008000',
    api_url:null, has_api:false,
    note:'Programa Pão de Açúcar / Raízen — sem API pública' },
  { type:'custom',       name:'Personalizado',        icon:'⭐', color:'#f59e0b',
    api_url:null, has_api:false,
    note:'Programa personalizado' },
];

/* ── Estado do módulo ─────────────────────────────────────────────────────── */
const _loy = {
  programs:    [],    // loyalty_programs rows
  loaded:      false,
  loading:     false,
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function _loyFamId() {
  return (typeof famId === 'function') ? famId() : currentUser?.family_id;
}

function _loyEsc(s) {
  return (typeof esc === 'function') ? esc(s)
    : String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _loyFmt(pts) {
  return Number(pts||0).toLocaleString('pt-BR');
}

function _loyFmtBrl(v) {
  return (typeof fmt === 'function') ? fmt(Math.abs(+v||0), 'BRL')
    : 'R$\u00a0' + Math.abs(+v||0).toFixed(2).replace('.',',');
}

function _loyToast(msg, type='success') {
  if (typeof toast === 'function') toast(msg, type);
  else alert(msg);
}

function _loyProgram(id) {
  return _loy.programs.find(p => p.id === id) || null;
}

function _loyCatalog(type) {
  return LOYALTY_CATALOG.find(c => c.type === type) || LOYALTY_CATALOG.find(c => c.type === 'custom');
}

/* ── Carregamento ─────────────────────────────────────────────────────────── */
async function loadLoyaltyPrograms() {
  const fid = _loyFamId();
  if (!fid || !sb) return [];
  if (_loy.loading) return _loy.programs;
  _loy.loading = true;
  try {
    const { data, error } = await famQ(
      sb.from('loyalty_programs').select('*')
    ).order('created_at', { ascending: true });
    if (error) throw error;
    _loy.programs = data || [];
    _loy.loaded   = true;
    return _loy.programs;
  } catch (e) {
    console.warn('[loyalty] loadLoyaltyPrograms:', e.message);
    _loy.programs = [];
    return [];
  } finally {
    _loy.loading = false;
  }
}
window.loadLoyaltyPrograms = loadLoyaltyPrograms;

/* ── Badge de pontos para card de conta ───────────────────────────────────── */
function getLoyaltyBadgeHtml(accountId) {
  const prog = _loy.programs.find(p =>
    p.linked_account_id === accountId && p.show_in_account_card
  );
  if (!prog) return '';
  const cat = _loyCatalog(prog.program_type);
  return `<div class="loyalty-pts-badge" onclick="event.stopPropagation();openLoyaltyStatement('${prog.id}')" title="${_loyEsc(prog.name)} — clique para ver extrato" style="display:flex;align-items:center;gap:5px;background:${cat.color}18;border:1px solid ${cat.color}40;border-radius:20px;padding:2px 9px;cursor:pointer;margin-top:3px;width:fit-content">
    <span style="font-size:.8rem">${cat.icon}</span>
    <span style="font-size:.7rem;font-weight:700;color:${cat.color}">${_loyFmt(prog.points_balance)} pts</span>
    <span style="font-size:.6rem;color:var(--muted)">${_loyEsc(prog.name)}</span>
  </div>`;
}
window.getLoyaltyBadgeHtml = getLoyaltyBadgeHtml;

/* ── Seção de programas na página de Contas ──────────────────────────────── */
async function renderLoyaltySection() {
  const container = document.getElementById('loyaltySectionWrap');
  if (!container) return;

  await loadLoyaltyPrograms();
  const programs = _loy.programs;

  if (!programs.length) {
    container.innerHTML = `
      <div class="loyalty-empty">
        <div style="font-size:2rem">⭐</div>
        <div style="font-size:.88rem;font-weight:700;color:var(--text);margin-top:8px">Nenhum programa cadastrado</div>
        <div style="font-size:.78rem;color:var(--muted);margin-top:4px">Adicione Smiles, Livelo, LATAM Pass e outros programas de fidelidade.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="openLoyaltyModal('')">
          + Cadastrar programa
        </button>
      </div>`;
    return;
  }

  container.innerHTML = programs.map(p => _loyCard(p)).join('') + `
    <div style="display:flex;justify-content:center;padding:8px 0">
      <button class="btn btn-ghost btn-sm" onclick="openLoyaltyModal('')">+ Adicionar programa</button>
    </div>`;
}
window.renderLoyaltySection = renderLoyaltySection;

function _loyCard(p) {
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;
  const icon  = p.icon  || cat.icon;
  const linked = p.linked_account_id
    ? (state.accounts||[]).find(a => a.id === p.linked_account_id)
    : null;

  const avgLine = p.avg_purchase_value
    ? `<div style="font-size:.68rem;color:var(--muted)">Milheiro médio: ${_loyFmtBrl(p.avg_purchase_value * 1000 / 1000)} / 1000 pts</div>`
    : '';
  const linkedLine = linked
    ? `<div style="font-size:.68rem;color:var(--muted)">🔗 Vinculado: ${_loyEsc(linked.name)}</div>`
    : '<div style="font-size:.68rem;color:var(--muted)">Stand-alone (sem vínculo)</div>';
  const expiryLine = p.points_expiry_date
    ? `<div style="font-size:.68rem;color:#d97706;font-weight:600">⏳ Vence: ${p.points_expiry_date.split('-').reverse().join('/')}</div>`
    : '';

  return `<div class="loyalty-card" style="border-left:4px solid ${color}">
    <div class="loyalty-card-top">
      <div class="loyalty-card-icon" style="background:${color}18;color:${color};font-size:1.5rem">${icon}</div>
      <div class="loyalty-card-info">
        <div class="loyalty-card-name">${_loyEsc(p.name)}</div>
        <div class="loyalty-card-type">${_loyEsc(cat.name)}</div>
        ${linkedLine}${avgLine}${expiryLine}
      </div>
      <div class="loyalty-card-balance" style="color:${color}">
        <div class="loyalty-pts-value">${_loyFmt(p.points_balance)}</div>
        <div class="loyalty-pts-label">pontos</div>
      </div>
    </div>
    <div class="loyalty-card-actions">
      <button class="loyalty-action-btn" onclick="updateLoyaltyPoints('${p.id}')" title="Atualizar pontos">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Atualizar
      </button>
      <button class="loyalty-action-btn" onclick="openLoyaltyStatement('${p.id}')" title="Extrato de pontos">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Extrato
      </button>
      <button class="loyalty-action-btn" onclick="openLoyaltyConvert('${p.id}')" title="Converter pontos em crédito">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        Converter
      </button>
      <button class="loyalty-action-btn" onclick="openLoyaltyPurchase('${p.id}')" title="Comprar pontos">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        Comprar
      </button>
      <button class="loyalty-action-btn" onclick="openLoyaltyModal('${p.id}')" title="Editar programa">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Editar
      </button>
    </div>
  </div>`;
}

/* ── Modal: criar / editar programa ─────────────────────────────────────────*/
async function openLoyaltyModal(id) {
  let prog = id ? _loyProgram(id) : null;
  const isNew = !prog;

  if (!prog) {
    prog = {
      id:'', name:'', icon:'⭐', color:'#f59e0b', program_type:'custom',
      linked_account_id:null, points_balance:0, points_expiry_date:'',
      show_in_account_card:true, notes:'',
    };
  }

  // Catalog picker HTML
  const catalogHtml = LOYALTY_CATALOG.map(c => `
    <div class="loy-prog-chip ${prog.program_type===c.type?'loy-prog-chip--active':''}"
         onclick="_loyPickCatalog('${c.type}','${c.icon}','${c.color}','${_loyEsc(c.name)}')"
         title="${c.has_api?'✅ API disponível':'⚠️ Sem API pública'}">
      <span style="font-size:1.2rem">${c.icon}</span>
      <span style="font-size:.72rem;font-weight:600">${_loyEsc(c.name)}</span>
    </div>`).join('');

  // Accounts select
  const acctOptions = (state.accounts||[])
    .filter(a => a.type !== 'programa_fidelidade')
    .map(a => `<option value="${a.id}" ${prog.linked_account_id===a.id?'selected':''}>${_loyEsc(a.name)}</option>`)
    .join('');

  const html = `
  <div class="modal-overlay open" id="loyaltyProgramModal" onclick="if(event.target===this)closeModal('loyaltyProgramModal')">
    <div class="modal" style="max-width:580px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">${isNew?'Novo Programa de Fidelidade':'Editar Programa'}</span>
        <button class="modal-close" onclick="closeModal('loyaltyProgramModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:16px">
        <input type="hidden" id="loyProgId" value="${prog.id}">

        <!-- Programa predefinido -->
        <div>
          <label style="font-size:.78rem;font-weight:700;color:var(--text2);display:block;margin-bottom:8px">Programa</label>
          <div class="loy-prog-chips" id="loyProgChips">${catalogHtml}</div>
        </div>

        <!-- Nome + ícone + cor -->
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end">
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Nome do programa *</label>
            <input type="text" id="loyProgName" class="form-input" value="${_loyEsc(prog.name)}"
              placeholder="Ex: Smiles, Livelo, LATAM Pass…" style="margin-top:4px">
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Ícone</label>
            <input type="text" id="loyProgIcon" class="form-input" value="${_loyEsc(prog.icon)}"
              placeholder="⭐" maxlength="4" style="margin-top:4px;width:64px;text-align:center;font-size:1.2rem">
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Cor</label>
            <input type="color" id="loyProgColor" value="${prog.color}"
              style="margin-top:4px;width:48px;height:38px;border-radius:8px;border:1px solid var(--border);padding:2px;cursor:pointer">
          </div>
        </div>

        <!-- Conta vinculada -->
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Conta vinculada <span style="font-size:.7rem;color:var(--muted)">(opcional — exibe pontos junto ao saldo)</span></label>
          <select id="loyLinkedAccount" class="form-input" style="margin-top:4px">
            <option value="">— Nenhuma (stand-alone) —</option>
            ${acctOptions}
          </select>
        </div>

        <!-- Saldo inicial + validade -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Saldo inicial de pontos</label>
            <input type="number" id="loyInitBalance" class="form-input" value="${prog.points_balance||0}"
              min="0" step="1" style="margin-top:4px" placeholder="0">
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Validade dos pontos</label>
            <input type="date" id="loyExpiry" class="form-input" value="${prog.points_expiry_date||''}"
              style="margin-top:4px">
          </div>
        </div>

        <!-- Mostrar no card -->
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
          <input type="checkbox" id="loyShowCard" ${prog.show_in_account_card?'checked':''} style="accent-color:var(--accent);width:16px;height:16px">
          <div>
            <div style="font-size:.84rem;font-weight:600;color:var(--text)">Exibir pontos no card da conta vinculada</div>
            <div style="font-size:.73rem;color:var(--muted)">Quando vinculado, mostra o saldo de pontos junto ao card da conta</div>
          </div>
        </label>

        <!-- Notas -->
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Observações</label>
          <textarea id="loyNotes" class="form-input" rows="2" style="margin-top:4px;resize:vertical"
            placeholder="Regras, taxa de acúmulo, parceiros…">${_loyEsc(prog.notes||'')}</textarea>
        </div>

        <!-- Aviso API -->
        <div id="loyApiNote" style="font-size:.74rem;color:var(--muted);padding:8px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
          ℹ️ A integração com APIs dos programas será configurável em versão futura. Por enquanto os pontos são atualizados manualmente.
        </div>
      </div>
      <div class="modal-footer">
        ${!isNew?`<button class="btn btn-ghost btn-sm" style="color:#dc2626;margin-right:auto" onclick="_loyDelete('${prog.id}')">🗑️ Excluir</button>`:''}
        <button class="btn btn-ghost btn-sm" onclick="closeModal('loyaltyProgramModal')">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="_loySaveProgram()">💾 Salvar</button>
      </div>
    </div>
  </div>`;

  document.getElementById('loyaltyProgramModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLoyaltyModal = openLoyaltyModal;

function _loyPickCatalog(type, icon, color, name) {
  const nameEl  = document.getElementById('loyProgName');
  const iconEl  = document.getElementById('loyProgIcon');
  const colorEl = document.getElementById('loyProgColor');
  if (nameEl && !nameEl.value) nameEl.value = name;
  if (iconEl)  iconEl.value  = icon;
  if (colorEl) colorEl.value = color;
  // Update chip selection
  document.querySelectorAll('.loy-prog-chip').forEach(el => {
    el.classList.toggle('loy-prog-chip--active',
      el.querySelector('span:last-child')?.textContent?.trim() === name);
  });
  // Store type
  document.getElementById('loyProgId')?.setAttribute('data-type', type);
}
window._loyPickCatalog = _loyPickCatalog;

async function _loySaveProgram() {
  const id      = document.getElementById('loyProgId')?.value?.trim();
  const name    = document.getElementById('loyProgName')?.value?.trim();
  const icon    = document.getElementById('loyProgIcon')?.value?.trim() || '⭐';
  const color   = document.getElementById('loyProgColor')?.value || '#f59e0b';
  const typeEl  = document.getElementById('loyProgId')?.getAttribute('data-type');
  const type    = typeEl || (id ? (_loyProgram(id)?.program_type || 'custom') : 'custom');
  const linked  = document.getElementById('loyLinkedAccount')?.value || null;
  const pts     = parseInt(document.getElementById('loyInitBalance')?.value||0, 10);
  const expiry  = document.getElementById('loyExpiry')?.value || null;
  const showCard= document.getElementById('loyShowCard')?.checked ?? true;
  const notes   = document.getElementById('loyNotes')?.value?.trim() || '';

  if (!name) { _loyToast('Informe o nome do programa.', 'error'); return; }

  const fid = _loyFamId();
  if (!fid) { _loyToast('Erro: família não identificada.', 'error'); return; }

  const payload = {
    family_id: fid,
    name, icon, color,
    program_type:          type,
    linked_account_id:     linked || null,
    show_in_account_card:  showCard,
    points_expiry_date:    expiry || null,
    notes:                 notes || null,
    updated_at:            new Date().toISOString(),
  };

  try {
    let error;
    if (id) {
      ({ error } = await sb.from('loyalty_programs').update(payload).eq('id', id));
    } else {
      payload.points_balance = pts;
      payload.created_at     = new Date().toISOString();
      const res = await sb.from('loyalty_programs').insert(payload).select().single();
      error = res.error;
      if (!error && pts > 0) {
        // Create initial earn transaction
        await sb.from('loyalty_transactions').insert({
          family_id: fid, program_id: res.data.id,
          type: 'adjust', points: pts, description: 'Saldo inicial',
          date: new Date().toISOString().slice(0,10),
        });
      }
    }
    if (error) throw error;
    _loyToast(id ? '✅ Programa atualizado!' : '✅ Programa cadastrado!', 'success');
    closeModal('loyaltyProgramModal');
    _loy.loaded = false;
    await loadLoyaltyPrograms();
    renderLoyaltySection();
    // Refresh account cards to show badge
    if (typeof renderAccounts === 'function') renderAccounts();
  } catch(e) {
    _loyToast('Erro ao salvar: ' + e.message, 'error');
  }
}
window._loySaveProgram = _loySaveProgram;

async function _loyDelete(id) {
  if (!confirm('Excluir este programa de fidelidade? Todas as transações de pontos serão removidas.')) return;
  try {
    const { error } = await sb.from('loyalty_programs').delete().eq('id', id);
    if (error) throw error;
    _loyToast('Programa excluído.', 'info');
    closeModal('loyaltyProgramModal');
    _loy.loaded = false;
    await loadLoyaltyPrograms();
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();
  } catch(e) {
    _loyToast('Erro ao excluir: ' + e.message, 'error');
  }
}
window._loyDelete = _loyDelete;

/* ── Modal: atualizar pontos ─────────────────────────────────────────────── */
function updateLoyaltyPoints(id) {
  const p = _loyProgram(id);
  if (!p) return;
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;

  const html = `
  <div class="modal-overlay open" id="loyaltyUpdateModal" onclick="if(event.target===this)closeModal('loyaltyUpdateModal')">
    <div class="modal" style="max-width:420px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">${p.icon} Atualizar Pontos — ${_loyEsc(p.name)}</span>
        <button class="modal-close" onclick="closeModal('loyaltyUpdateModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:16px">
        <input type="hidden" id="loyUpdId" value="${id}">

        <!-- Saldo atual -->
        <div style="background:${color}14;border:1px solid ${color}30;border-radius:12px;padding:14px;text-align:center">
          <div style="font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Saldo atual</div>
          <div style="font-size:1.8rem;font-weight:800;color:${color};margin-top:2px">${_loyFmt(p.points_balance)}</div>
          <div style="font-size:.72rem;color:var(--muted)">pontos</div>
        </div>

        <!-- Modo de atualização -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px" id="loyUpdModeGroup">
          <button class="loyalty-mode-btn active" onclick="_loySetUpdMode('total',this)" style="--loy-mode-color:${color}">
            📊 Saldo total
          </button>
          <button class="loyalty-mode-btn" onclick="_loySetUpdMode('add',this)" style="--loy-mode-color:${color}">
            ➕ Acréscimo
          </button>
          <button class="loyalty-mode-btn" onclick="_loySetUpdMode('sub',this)" style="--loy-mode-color:${color}">
            ➖ Dedução
          </button>
        </div>
        <input type="hidden" id="loyUpdMode" value="total">

        <!-- Valor de pontos -->
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)" id="loyUpdLabel">Novo saldo total</label>
          <input type="number" id="loyUpdPoints" class="form-input" value="${p.points_balance}"
            min="0" step="1" style="margin-top:6px;font-size:1.1rem;font-weight:700" placeholder="0">
        </div>

        <!-- Descrição -->
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Descrição</label>
          <input type="text" id="loyUpdDesc" class="form-input" value="Atualização manual"
            style="margin-top:4px" placeholder="Origem dos pontos…">
        </div>

        <!-- Previsão de resultado -->
        <div id="loyUpdPreview" style="font-size:.8rem;color:var(--muted);text-align:center;padding:6px;background:var(--surface2);border-radius:8px">
          —
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('loyaltyUpdateModal')">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="_loyConfirmUpdate()">💾 Confirmar</button>
      </div>
    </div>
  </div>`;

  document.getElementById('loyaltyUpdateModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);

  // Live preview
  const upd = document.getElementById('loyUpdPoints');
  if (upd) upd.addEventListener('input', _loyUpdatePreview);
  _loyUpdatePreview();
}
window.updateLoyaltyPoints = updateLoyaltyPoints;

function _loySetUpdMode(mode, btn) {
  document.querySelectorAll('.loyalty-mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('loyUpdMode').value = mode;
  const prog = _loyProgram(document.getElementById('loyUpdId')?.value);
  const labels = { total:'Novo saldo total', add:'Pontos a acrescentar', sub:'Pontos a deduzir' };
  const el = document.getElementById('loyUpdLabel');
  if (el) el.textContent = labels[mode] || '';
  if (mode !== 'total' && prog) {
    document.getElementById('loyUpdPoints').value = 0;
  } else if (mode === 'total' && prog) {
    document.getElementById('loyUpdPoints').value = prog.points_balance;
  }
  _loyUpdatePreview();
}
window._loySetUpdMode = _loySetUpdMode;

function _loyUpdatePreview() {
  const id   = document.getElementById('loyUpdId')?.value;
  const mode = document.getElementById('loyUpdMode')?.value || 'total';
  const val  = parseInt(document.getElementById('loyUpdPoints')?.value || 0, 10);
  const prev = document.getElementById('loyUpdPreview');
  const prog = _loyProgram(id);
  if (!prev || !prog) return;
  let newBal;
  if (mode === 'total') newBal = val;
  else if (mode === 'add') newBal = prog.points_balance + val;
  else newBal = Math.max(0, prog.points_balance - val);
  const diff = newBal - prog.points_balance;
  const diffStr = diff > 0 ? `+${_loyFmt(diff)}` : _loyFmt(diff);
  prev.innerHTML = `Novo saldo: <strong>${_loyFmt(newBal)} pts</strong> <span style="color:${diff>=0?'#16a34a':'#dc2626'}">(${diffStr})</span>`;
}
window._loyUpdatePreview = _loyUpdatePreview;

async function _loyConfirmUpdate() {
  const id   = document.getElementById('loyUpdId')?.value;
  const mode = document.getElementById('loyUpdMode')?.value || 'total';
  const val  = parseInt(document.getElementById('loyUpdPoints')?.value || 0, 10);
  const desc = document.getElementById('loyUpdDesc')?.value?.trim() || 'Atualização manual';
  const prog = _loyProgram(id);
  if (!prog) return;

  let newBal, deltaPoints;
  if (mode === 'total') {
    newBal      = val;
    deltaPoints = val - prog.points_balance;
  } else if (mode === 'add') {
    newBal      = prog.points_balance + val;
    deltaPoints = val;
  } else {
    deltaPoints = -Math.min(val, prog.points_balance);
    newBal      = prog.points_balance + deltaPoints;
  }

  try {
    const { error: upd } = await sb.from('loyalty_programs').update({
      points_balance: newBal, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (upd) throw upd;

    await sb.from('loyalty_transactions').insert({
      family_id:   _loyFamId(),
      program_id:  id,
      type:        'adjust',
      points:      deltaPoints,
      description: desc,
      date:        new Date().toISOString().slice(0,10),
    });

    _loyToast(`✅ Saldo atualizado: ${_loyFmt(newBal)} pts`, 'success');
    closeModal('loyaltyUpdateModal');
    const idx = _loy.programs.findIndex(p => p.id === id);
    if (idx >= 0) _loy.programs[idx].points_balance = newBal;
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();
  } catch(e) {
    _loyToast('Erro: ' + e.message, 'error');
  }
}
window._loyConfirmUpdate = _loyConfirmUpdate;

/* ── Modal: extrato de pontos ────────────────────────────────────────────── */
async function openLoyaltyStatement(id) {
  const p = _loyProgram(id);
  if (!p) return;
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;

  // Create shell while loading
  document.getElementById('loyaltyStatementModal')?.remove();
  const html = `
  <div class="modal-overlay open" id="loyaltyStatementModal" onclick="if(event.target===this)closeModal('loyaltyStatementModal')">
    <div class="modal" style="max-width:580px;max-height:90dvh;display:flex;flex-direction:column">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">${p.icon} Extrato — ${_loyEsc(p.name)}</span>
        <button class="modal-close" onclick="closeModal('loyaltyStatementModal')">✕</button>
      </div>
      <div class="modal-body" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:14px">
        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div style="background:${color}14;border:1px solid ${color}30;border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:.65rem;text-transform:uppercase;font-weight:700;color:var(--muted)">Saldo atual</div>
            <div style="font-size:1.1rem;font-weight:800;color:${color}">${_loyFmt(p.points_balance)}</div>
            <div style="font-size:.62rem;color:var(--muted)">pontos</div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:.65rem;text-transform:uppercase;font-weight:700;color:var(--muted)">Tipo</div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text)">${cat.icon} ${_loyEsc(cat.name)}</div>
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center" id="loyStmtAvgCard">
            <div style="font-size:.65rem;text-transform:uppercase;font-weight:700;color:var(--muted)">Custo médio</div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text)" id="loyStmtAvgVal">—</div>
            <div style="font-size:.62rem;color:var(--muted)">por 1000 pts</div>
          </div>
        </div>
        <!-- Transações -->
        <div id="loyStmtBody"><div style="text-align:center;padding:32px;color:var(--muted)">⏳ Carregando…</div></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="updateLoyaltyPoints('${id}');closeModal('loyaltyStatementModal')">🔄 Atualizar</button>
        <button class="btn btn-ghost btn-sm" onclick="openLoyaltyConvert('${id}');closeModal('loyaltyStatementModal')">↔ Converter</button>
        <button class="btn btn-ghost btn-sm" onclick="closeModal('loyaltyStatementModal')">Fechar</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Load transactions
  try {
    const { data, error } = await sb.from('loyalty_transactions')
      .select('*').eq('program_id', id).order('date', { ascending:false }).limit(100);
    if (error) throw error;

    const txs = data || [];
    const avgEl = document.getElementById('loyStmtAvgVal');
    if (avgEl && p.avg_purchase_value) {
      avgEl.textContent = _loyFmtBrl(p.avg_purchase_value * 1000 / 1000);
    }

    const typeLabel = { earn:'Acúmulo', redeem:'Resgate', buy:'Compra', convert_out:'Conversão', adjust:'Ajuste', expire:'Expiração' };
    const typeColor = { earn:'#16a34a', redeem:'#dc2626', buy:'#2563eb', convert_out:'#7c3aed', adjust:'#d97706', expire:'#9ca3af' };

    const body = document.getElementById('loyStmtBody');
    if (!body) return;

    if (!txs.length) {
      body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.84rem">Nenhuma movimentação registrada.</div>';
      return;
    }

    body.innerHTML = txs.map(t => {
      const tc = typeColor[t.type] || '#6b7280';
      const tl = typeLabel[t.type]  || t.type;
      const pts = +t.points;
      const ptsStr = pts > 0 ? `+${_loyFmt(pts)}` : _loyFmt(pts);
      const brlLine = t.total_brl ? `<span style="font-size:.65rem;color:var(--muted)"> · ${_loyFmtBrl(t.total_brl)}</span>` : '';
      const unitLine = t.unit_value_brl ? ` <span style="font-size:.62rem;color:var(--muted)">(${_loyFmtBrl(t.unit_value_brl)}/1000 pts)</span>` : '';
      const ds = t.date ? t.date.split('-').reverse().join('/') : '—';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="width:6px;height:6px;border-radius:50%;background:${tc};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${_loyEsc(t.description||tl)}
          </div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:1px">
            <span style="background:${tc}18;color:${tc};font-weight:700;border-radius:4px;padding:1px 5px">${tl}</span>
            · ${ds}${unitLine}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.88rem;font-weight:800;color:${pts>=0?'#16a34a':'#dc2626'}">${ptsStr} pts</div>
          ${brlLine}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    const b = document.getElementById('loyStmtBody');
    if (b) b.innerHTML = `<div style="color:#dc2626;padding:16px;text-align:center;font-size:.82rem">❌ ${_loyEsc(e.message)}</div>`;
  }
}
window.openLoyaltyStatement = openLoyaltyStatement;

/* ── Modal: converter pontos → crédito financeiro ───────────────────────── */
function openLoyaltyConvert(id) {
  const p = _loyProgram(id);
  if (!p) return;
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;

  const acctOptions = (state.accounts||[])
    .filter(a => a.type !== 'programa_fidelidade')
    .map(a => `<option value="${a.id}">${_loyEsc(a.name)}</option>`)
    .join('');

  const html = `
  <div class="modal-overlay open" id="loyaltyConvertModal" onclick="if(event.target===this)closeModal('loyaltyConvertModal')">
    <div class="modal" style="max-width:420px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">↔ Converter Pontos — ${_loyEsc(p.name)}</span>
        <button class="modal-close" onclick="closeModal('loyaltyConvertModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <input type="hidden" id="loyConvId" value="${id}">

        <div style="background:${color}14;border:1px solid ${color}30;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.7rem;color:var(--muted)">Saldo disponível</div>
          <div style="font-size:1.5rem;font-weight:800;color:${color}">${_loyFmt(p.points_balance)} pts</div>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Pontos a converter *</label>
          <input type="number" id="loyConvPoints" class="form-input" min="1" max="${p.points_balance}"
            value="${Math.floor(p.points_balance/2)}" style="margin-top:4px"
            oninput="_loyConvPreview()">
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Valor do crédito (R$) *</label>
          <input type="number" id="loyConvBrl" class="form-input" min="0.01" step="0.01"
            placeholder="0,00" style="margin-top:4px" oninput="_loyConvPreview()">
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Destino do crédito *</label>
          <select id="loyConvAccount" class="form-input" style="margin-top:4px">
            <option value="">— Selecione a conta —</option>
            ${acctOptions}
          </select>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Tipo de crédito</label>
          <select id="loyConvType" class="form-input" style="margin-top:4px">
            <option value="credit_bill">Crédito na fatura do cartão</option>
            <option value="credit_account">Crédito direto na conta</option>
            <option value="cashback">Cashback</option>
            <option value="voucher">Voucher / Vale</option>
          </select>
        </div>

        <div id="loyConvRateInfo" style="font-size:.76rem;color:var(--muted);background:var(--surface2);border-radius:8px;padding:8px;text-align:center">
          Informe os campos acima para ver a taxa de conversão.
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Descrição</label>
          <input type="text" id="loyConvDesc" class="form-input" value="Conversão de pontos em crédito" style="margin-top:4px">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('loyaltyConvertModal')">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="_loyConfirmConvert()">✅ Converter</button>
      </div>
    </div>
  </div>`;

  document.getElementById('loyaltyConvertModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  _loyConvPreview();
}
window.openLoyaltyConvert = openLoyaltyConvert;

function _loyConvPreview() {
  const pts  = parseInt(document.getElementById('loyConvPoints')?.value || 0, 10);
  const brl  = parseFloat(document.getElementById('loyConvBrl')?.value || 0);
  const info = document.getElementById('loyConvRateInfo');
  if (!info) return;
  if (pts > 0 && brl > 0) {
    const rate = (brl / pts * 1000).toFixed(4);
    info.innerHTML = `Taxa de conversão: <strong>${_loyFmtBrl(+rate)}</strong> por 1000 pts`;
  } else {
    info.textContent = 'Informe os campos acima para ver a taxa de conversão.';
  }
}
window._loyConvPreview = _loyConvPreview;

async function _loyConfirmConvert() {
  const id      = document.getElementById('loyConvId')?.value;
  const pts     = parseInt(document.getElementById('loyConvPoints')?.value || 0, 10);
  const brl     = parseFloat(document.getElementById('loyConvBrl')?.value || 0);
  const acctId  = document.getElementById('loyConvAccount')?.value;
  const desc    = document.getElementById('loyConvDesc')?.value?.trim() || 'Conversão de pontos';
  const prog    = _loyProgram(id);

  if (!prog) return;
  if (pts <= 0)    { _loyToast('Informe os pontos a converter.', 'error'); return; }
  if (brl <= 0)    { _loyToast('Informe o valor do crédito em R$.', 'error'); return; }
  if (!acctId)     { _loyToast('Selecione a conta de destino.', 'error'); return; }
  if (pts > prog.points_balance) { _loyToast('Pontos insuficientes.', 'error'); return; }

  try {
    const fid     = _loyFamId();
    const today   = new Date().toISOString().slice(0,10);
    const newBal  = prog.points_balance - pts;
    const unitVal = brl / pts * 1000;

    // 1. Create financial transaction (income/credit)
    const { data:txData, error:txErr } = await sb.from('transactions').insert({
      family_id: fid, account_id: acctId, date: today,
      description: desc, amount: brl, status: 'confirmed',
      is_transfer: false,
    }).select().single();
    if (txErr) throw txErr;

    // 2. Update loyalty balance
    const { error:updErr } = await sb.from('loyalty_programs').update({
      points_balance: newBal, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (updErr) throw updErr;

    // 3. Record loyalty transaction
    await sb.from('loyalty_transactions').insert({
      family_id: fid, program_id: id,
      type: 'convert_out', points: -pts,
      unit_value_brl: unitVal, total_brl: brl,
      description: desc, date: today,
      reference_account_id: acctId,
      financial_tx_id: txData?.id || null,
    });

    _loyToast(`✅ ${_loyFmt(pts)} pts convertidos → ${_loyFmtBrl(brl)}`, 'success');
    closeModal('loyaltyConvertModal');
    const idx = _loy.programs.findIndex(p => p.id === id);
    if (idx >= 0) _loy.programs[idx].points_balance = newBal;
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();
    if (typeof loadTransactions === 'function') loadTransactions();
  } catch(e) {
    _loyToast('Erro: ' + e.message, 'error');
  }
}
window._loyConfirmConvert = _loyConfirmConvert;

/* ── Modal: comprar pontos ───────────────────────────────────────────────── */
function openLoyaltyPurchase(id) {
  const p = _loyProgram(id);
  if (!p) return;
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;

  const acctOptions = (state.accounts||[])
    .filter(a => a.type !== 'programa_fidelidade')
    .map(a => `<option value="${a.id}">${_loyEsc(a.name)}</option>`)
    .join('');

  const avgInfo = p.avg_purchase_value
    ? `Histórico: ${_loyFmtBrl(p.avg_purchase_value)} / 1000 pts`
    : 'Sem histórico de compra ainda';

  const html = `
  <div class="modal-overlay open" id="loyaltyPurchaseModal" onclick="if(event.target===this)closeModal('loyaltyPurchaseModal')">
    <div class="modal" style="max-width:420px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">🛒 Comprar Pontos — ${_loyEsc(p.name)}</span>
        <button class="modal-close" onclick="closeModal('loyaltyPurchaseModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
        <input type="hidden" id="loyBuyId" value="${id}">

        <div style="background:${color}14;border:1px solid ${color}30;border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:.7rem;color:var(--muted)">Saldo atual</div>
          <div style="font-size:1.5rem;font-weight:800;color:${color}">${_loyFmt(p.points_balance)} pts</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:4px">${avgInfo}</div>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Pontos a comprar *</label>
          <input type="number" id="loyBuyPoints" class="form-input" min="1"
            placeholder="Ex: 10000" style="margin-top:4px" oninput="_loyBuyPreview()">
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Valor pago (R$) *</label>
          <input type="number" id="loyBuyBrl" class="form-input" min="0.01" step="0.01"
            placeholder="0,00" style="margin-top:4px" oninput="_loyBuyPreview()">
        </div>

        <div id="loyBuyRateInfo" style="font-size:.76rem;color:var(--muted);background:var(--surface2);border-radius:8px;padding:8px;text-align:center">
          —
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Débitar da conta</label>
          <select id="loyBuyAccount" class="form-input" style="margin-top:4px">
            <option value="">— Não débitar (registro apenas) —</option>
            ${acctOptions}
          </select>
        </div>

        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Descrição</label>
          <input type="text" id="loyBuyDesc" class="form-input" value="Compra de pontos" style="margin-top:4px">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="closeModal('loyaltyPurchaseModal')">Cancelar</button>
        <button class="btn btn-primary btn-sm" onclick="_loyConfirmPurchase()">✅ Comprar</button>
      </div>
    </div>
  </div>`;

  document.getElementById('loyaltyPurchaseModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLoyaltyPurchase = openLoyaltyPurchase;

function _loyBuyPreview() {
  const pts  = parseInt(document.getElementById('loyBuyPoints')?.value || 0, 10);
  const brl  = parseFloat(document.getElementById('loyBuyBrl')?.value || 0);
  const info = document.getElementById('loyBuyRateInfo');
  if (!info) return;
  if (pts > 0 && brl > 0) {
    const milheiro = (brl / pts * 1000).toFixed(4);
    info.innerHTML = `Custo do milheiro: <strong>${_loyFmtBrl(+milheiro)} / 1000 pts</strong>`;
  } else {
    info.textContent = '—';
  }
}
window._loyBuyPreview = _loyBuyPreview;

async function _loyConfirmPurchase() {
  const id      = document.getElementById('loyBuyId')?.value;
  const pts     = parseInt(document.getElementById('loyBuyPoints')?.value || 0, 10);
  const brl     = parseFloat(document.getElementById('loyBuyBrl')?.value || 0);
  const acctId  = document.getElementById('loyBuyAccount')?.value || null;
  const desc    = document.getElementById('loyBuyDesc')?.value?.trim() || 'Compra de pontos';
  const prog    = _loyProgram(id);

  if (!prog) return;
  if (pts <= 0) { _loyToast('Informe os pontos a comprar.', 'error'); return; }
  if (brl <= 0) { _loyToast('Informe o valor pago.', 'error'); return; }

  try {
    const fid     = _loyFamId();
    const today   = new Date().toISOString().slice(0,10);
    const newBal  = prog.points_balance + pts;
    const unitVal = brl / pts * 1000; // BRL per 1000 points

    // Update avg purchase value (weighted average)
    const prevBuys = await sb.from('loyalty_transactions')
      .select('points, unit_value_brl')
      .eq('program_id', id).eq('type', 'buy');
    let newAvg = unitVal;
    if (!prevBuys.error && prevBuys.data?.length) {
      const totalPts  = prevBuys.data.reduce((s,t)=>s+Math.abs(+t.points),0) + pts;
      const weightedSum = prevBuys.data.reduce((s,t)=>s+(Math.abs(+t.points)*(+t.unit_value_brl||0)),0) + pts*unitVal;
      newAvg = totalPts > 0 ? weightedSum / totalPts : unitVal;
    }

    // 1. Optional: create financial debit
    let finTxId = null;
    if (acctId) {
      const { data:txData, error:txErr } = await sb.from('transactions').insert({
        family_id: fid, account_id: acctId, date: today,
        description: desc, amount: -brl, status: 'confirmed', is_transfer: false,
      }).select().single();
      if (txErr) throw txErr;
      finTxId = txData?.id || null;
    }

    // 2. Update loyalty balance + avg
    const { error:updErr } = await sb.from('loyalty_programs').update({
      points_balance: newBal, avg_purchase_value: newAvg,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (updErr) throw updErr;

    // 3. Record loyalty transaction
    await sb.from('loyalty_transactions').insert({
      family_id: fid, program_id: id,
      type: 'buy', points: pts,
      unit_value_brl: unitVal, total_brl: brl,
      description: desc, date: today,
      reference_account_id: acctId || null,
      financial_tx_id: finTxId,
    });

    _loyToast(`✅ ${_loyFmt(pts)} pts comprados por ${_loyFmtBrl(brl)}`, 'success');
    closeModal('loyaltyPurchaseModal');
    const idx = _loy.programs.findIndex(p => p.id === id);
    if (idx >= 0) { _loy.programs[idx].points_balance = newBal; _loy.programs[idx].avg_purchase_value = newAvg; }
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();
    if (typeof loadTransactions === 'function') loadTransactions();
  } catch(e) {
    _loyToast('Erro: ' + e.message, 'error');
  }
}
window._loyConfirmPurchase = _loyConfirmPurchase;

/* ── Init: carrega ao abrir página de contas ─────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Will be called by accounts page navigation
});
