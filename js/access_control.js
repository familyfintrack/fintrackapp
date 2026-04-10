// ═══════════════════════════════════════════════════════════════════════════
//  access_control.js — Per-member module & account restrictions
//  Owner/admin can restrict which modules and accounts each member can use.
//  Restrictions are loaded once at login and cached in state.accessRestrictions
// ═══════════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────────
// state.accessRestrictions = { blockedModules: Set<string>, allowedAccountIds: Set<uuid>|null }
// null allowedAccountIds = no restriction (all accounts visible)

async function loadMyAccessRestrictions() {
  try {
    const { data, error } = await sb.rpc('get_my_access_restrictions');
    if (error || !data || !data.length) {
      state.accessRestrictions = { blockedModules: new Set(), allowedAccountIds: null };
      return;
    }
    const r = data[0];
    const blocked = new Set(
      Object.entries(r.blocked_modules || {})
        .filter(([, v]) => v === false || v === true && !v)
        .map(([k]) => k)
    );
    const allowedIds = Array.isArray(r.allowed_account_ids) && r.allowed_account_ids.length
      ? new Set(r.allowed_account_ids)
      : null;
    state.accessRestrictions = { blockedModules: blocked, allowedAccountIds: allowedIds };
    _applyAccessRestrictions();
  } catch(e) {
    console.warn('[AccessControl] load:', e?.message);
    state.accessRestrictions = { blockedModules: new Set(), allowedAccountIds: null };
  }
}

function _applyAccessRestrictions() {
  const r = state.accessRestrictions;
  if (!r) return;
  // Hide nav buttons for blocked modules
  r.blockedModules.forEach(mod => {
    const nav = document.getElementById(mod + 'Nav')
      || document.querySelector(`[data-nav="${mod}"]`);
    if (nav) nav.style.display = 'none';
  });
}

function isModuleAllowed(moduleName) {
  const r = state.accessRestrictions;
  if (!r) return true;
  return !r.blockedModules.has(moduleName);
}

function isAccountAllowed(accountId) {
  const r = state.accessRestrictions;
  if (!r || !r.allowedAccountIds) return true; // no restriction
  return r.allowedAccountIds.has(accountId);
}

// Filter accounts array to only allowed ones
function filterAllowedAccounts(accounts) {
  const r = state.accessRestrictions;
  if (!r || !r.allowedAccountIds) return accounts;
  return (accounts || []).filter(a => r.allowedAccountIds.has(a.id));
}

// ── MODULES LIST ────────────────────────────────────────────────────────────
const ACCESS_MODULES = [
  { key: 'transactions', label: 'Transações',           icon: '💸' },
  { key: 'accounts',     label: 'Contas',               icon: '🏦' },
  { key: 'reports',      label: 'Relatórios',           icon: '📊' },
  { key: 'budgets',      label: 'Orçamentos',           icon: '📋' },
  { key: 'scheduled',    label: 'Programados',          icon: '🗓️' },
  { key: 'receivables',  label: 'A Receber',            icon: '📬' },
  { key: 'categories',   label: 'Categorias',           icon: '🏷️' },
  { key: 'payees',       label: 'Beneficiários',        icon: '👤' },
  { key: 'investments',  label: 'Investimentos',        icon: '📈' },
  { key: 'debts',        label: 'Dívidas',              icon: '💳' },
  { key: 'dreams',       label: 'Sonhos',               icon: '🌟' },
  { key: 'grocery',      label: 'Lista de Mercado',     icon: '🛒' },
  { key: 'prices',       label: 'Preços',               icon: '🏷️' },
  { key: 'ai_insights',  label: 'IA Insights',          icon: '🤖' },
];

// ── OWNER UI ────────────────────────────────────────────────────────────────
// Cache of loaded restrictions { [familyId+userId]: { blockedModules, allowedAccountIds } }
const _acrCache = {};

async function openMemberAccessModal(familyId, userId, memberName) {
  // Build modal if not exists
  let modal = document.getElementById('memberAccessModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'memberAccessModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-box" id="memberAccessBox" style="max-width:520px;width:96vw"></div>';
    modal.onclick = e => { if (e.target === modal) closeMemberAccessModal(); };
    document.body.appendChild(modal);
  }
  const box = document.getElementById('memberAccessBox');
  box.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">⏳ Carregando…</div>';
  modal.style.display = 'flex';

  // Load current restrictions + accounts
  const cacheKey = familyId + '|' + userId;
  let existing = { blocked_modules: {}, allowed_account_ids: null };
  try {
    const { data } = await sb.from('family_member_restrictions')
      .select('blocked_modules,allowed_account_ids')
      .eq('family_id', familyId).eq('user_id', userId).maybeSingle();
    if (data) existing = data;
  } catch(_) {}

  const blocked = existing.blocked_modules || {};
  const allowedIds = existing.allowed_account_ids;

  // Load accounts for this family
  let accounts = [];
  try {
    const { data: accs } = await sb.from('accounts')
      .select('id,name,type,color,icon,currency')
      .eq('family_id', familyId).eq('active', true).eq('is_archived', false)
      .order('name');
    accounts = accs || [];
  } catch(_) {}

  _renderMemberAccessModal(box, familyId, userId, memberName, blocked, allowedIds, accounts);
}
window.openMemberAccessModal = openMemberAccessModal;

function _renderMemberAccessModal(box, familyId, userId, memberName, blocked, allowedIds, accounts) {
  const escN = s => String(s||'').replace(/"/g,'&quot;');

  const moduleRows = ACCESS_MODULES.map(m => {
    const isBlocked = blocked[m.key] === false;
    return `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;
        border-bottom:1px solid var(--border);cursor:pointer;user-select:none"
        title="${isBlocked ? 'Bloqueado' : 'Permitido'}">
      <input type="checkbox" class="mac-mod-chk" data-key="${m.key}" ${!isBlocked ? 'checked' : ''}
        style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0">
      <span style="font-size:1rem;flex-shrink:0">${m.icon}</span>
      <span style="font-size:.85rem;font-weight:600;color:var(--text);flex:1">${m.label}</span>
      <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:10px;
        background:${!isBlocked ? '#dcfce7' : '#fee2e2'};
        color:${!isBlocked ? '#15803d' : '#dc2626'}">
        ${!isBlocked ? '✓ Permitido' : '✗ Bloqueado'}
      </span>
    </label>`;
  }).join('');

  const noAccRestriction = !allowedIds;
  const accRows = accounts.map(a => {
    const allowed = noAccRestriction || allowedIds.includes(a.id);
    const typeIcon = { checking:'🏦', savings:'💰', credit:'💳', investment:'📈', cash:'💵' }[a.type] || '🏦';
    return `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;
        border-bottom:1px solid var(--border);cursor:pointer;user-select:none">
      <input type="checkbox" class="mac-acc-chk" data-id="${a.id}" ${allowed ? 'checked' : ''}
        style="width:15px;height:15px;accent-color:var(--accent);flex-shrink:0">
      <span style="width:28px;height:28px;border-radius:8px;background:${a.color||'var(--accent)'}22;
        border:1.5px solid ${a.color||'var(--accent)'}40;display:flex;align-items:center;
        justify-content:center;font-size:.85rem;flex-shrink:0">${a.icon||typeIcon}</span>
      <span style="font-size:.85rem;font-weight:600;color:var(--text);flex:1">${escN(a.name)}</span>
      <span style="font-size:.7rem;color:var(--muted)">${a.currency||'BRL'}</span>
    </label>`;
  }).join('');

  box.innerHTML = `
    <div class="modal-header" style="padding:16px 20px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:10px;background:var(--accent-lt);
          display:flex;align-items:center;justify-content:center;font-size:1.1rem">🔐</div>
        <div>
          <div style="font-size:.95rem;font-weight:800;color:var(--text)">Controle de Acesso</div>
          <div style="font-size:.75rem;color:var(--muted)">${escN(memberName)}</div>
        </div>
      </div>
      <button onclick="closeMemberAccessModal()" class="modal-close">✕</button>
    </div>
    <div style="padding:16px 20px;overflow-y:auto;max-height:65vh">

      <!-- Modules -->
      <div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
            color:var(--accent)">🧩 Módulos</div>
          <div style="display:flex;gap:6px">
            <button onclick="_macToggleAll('mod',true)"
              style="font-family:var(--font-sans);font-size:.68rem;padding:3px 9px;
                border:1px solid var(--border);border-radius:7px;cursor:pointer;
                background:var(--surface2);color:var(--text)">Liberar tudo</button>
            <button onclick="_macToggleAll('mod',false)"
              style="font-family:var(--font-sans);font-size:.68rem;padding:3px 9px;
                border:1px solid var(--border);border-radius:7px;cursor:pointer;
                background:var(--surface2);color:var(--text)">Bloquear tudo</button>
          </div>
        </div>
        <div id="macModuleList">${moduleRows}</div>
      </div>

      <!-- Accounts -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;
            color:var(--accent)">🏦 Contas Visíveis</div>
          <div style="display:flex;gap:6px">
            <button onclick="_macToggleAll('acc',true)"
              style="font-family:var(--font-sans);font-size:.68rem;padding:3px 9px;
                border:1px solid var(--border);border-radius:7px;cursor:pointer;
                background:var(--surface2);color:var(--text)">Todas</button>
            <button onclick="_macToggleAll('acc',false)"
              style="font-family:var(--font-sans);font-size:.68rem;padding:3px 9px;
                border:1px solid var(--border);border-radius:7px;cursor:pointer;
                background:var(--surface2);color:var(--text)">Nenhuma</button>
          </div>
        </div>
        <div style="font-size:.75rem;color:var(--muted);margin-bottom:8px;
          background:var(--surface2);border-radius:8px;padding:8px 10px">
          💡 Desmarque contas que este membro <strong>não deve visualizar</strong>.
          Transações dessas contas ficam ocultas para ele.
        </div>
        ${accounts.length
          ? '<div id="macAccountList">' + accRows + '</div>'
          : '<div style="color:var(--muted);font-size:.8rem;padding:10px 0">Nenhuma conta cadastrada.</div>'}
      </div>
    </div>

    <div class="modal-footer" style="padding:14px 20px;border-top:1px solid var(--border);
      display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeMemberAccessModal()" class="btn btn-ghost">Cancelar</button>
      <button onclick="saveMemberAccess('${familyId}','${userId}')" class="btn btn-primary"
        id="macSaveBtn">💾 Salvar restrições</button>
    </div>

    <input type="hidden" id="macFamilyId" value="${familyId}">
    <input type="hidden" id="macUserId"   value="${userId}">
  `;

  // Update badge color when checkbox changes
  box.querySelectorAll('.mac-mod-chk').forEach(chk => {
    chk.addEventListener('change', function() {
      const badge = this.closest('label').querySelector('span:last-child');
      if (badge) {
        badge.style.background = this.checked ? '#dcfce7' : '#fee2e2';
        badge.style.color      = this.checked ? '#15803d' : '#dc2626';
        badge.textContent      = this.checked ? '✓ Permitido' : '✗ Bloqueado';
      }
    });
  });
}

function _macToggleAll(type, checked) {
  const cls = type === 'mod' ? '.mac-mod-chk' : '.mac-acc-chk';
  document.querySelectorAll('#memberAccessBox ' + cls).forEach(chk => {
    chk.checked = checked;
    chk.dispatchEvent(new Event('change'));
  });
}
window._macToggleAll = _macToggleAll;

async function saveMemberAccess(familyId, userId) {
  const btn = document.getElementById('macSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  // Read module checkboxes
  const blockedModules = {};
  document.querySelectorAll('#memberAccessBox .mac-mod-chk').forEach(chk => {
    if (!chk.checked) blockedModules[chk.dataset.key] = false;
  });

  // Read account checkboxes
  const allAccChks = document.querySelectorAll('#memberAccessBox .mac-acc-chk');
  let allowedAccountIds = null;
  if (allAccChks.length > 0) {
    const checked = [...allAccChks].filter(c => c.checked).map(c => c.dataset.id);
    const total   = allAccChks.length;
    // If all accounts are checked = no restriction (null)
    allowedAccountIds = checked.length === total ? null : checked;
  }

  try {
    const { error } = await sb.from('family_member_restrictions').upsert({
      family_id:          familyId,
      user_id:            userId,
      blocked_modules:    blockedModules,
      allowed_account_ids: allowedAccountIds,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'family_id,user_id' });

    if (error) throw error;

    const modCount  = Object.keys(blockedModules).length;
    const accCount  = allowedAccountIds ? allowedAccountIds.length : null;
    const summary   = [
      modCount  > 0 ? modCount + ' módulo' + (modCount>1?'s':'') + ' bloqueado' + (modCount>1?'s':'') : null,
      accCount !== null ? accCount + ' conta' + (accCount!==1?'s':'') + ' visível' + (accCount!==1?'s':'') : null,
    ].filter(Boolean).join(', ') || 'sem restrições';

    toast('✅ Restrições salvas: ' + summary, 'success');
    closeMemberAccessModal();
  } catch(e) {
    toast('Erro: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar restrições'; }
  }
}
window.saveMemberAccess = saveMemberAccess;

function closeMemberAccessModal() {
  const modal = document.getElementById('memberAccessModal');
  if (modal) modal.style.display = 'none';
}
window.closeMemberAccessModal = closeMemberAccessModal;

// ── Public API ──────────────────────────────────────────────────────────────
window.loadMyAccessRestrictions = loadMyAccessRestrictions;
window.isModuleAllowed          = isModuleAllowed;
window.isAccountAllowed         = isAccountAllowed;
window.filterAllowedAccounts    = filterAllowedAccounts;
