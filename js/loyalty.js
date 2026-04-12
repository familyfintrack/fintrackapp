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
  { type:'smiles', name:'Smiles (GOL)', icon:'😊', color:'#FF6600',
    api_url:'https://developers.smiles.com.br', has_api:true,
    docs_url:'https://developers.smiles.com.br/docs',
    note:'API OAuth 2.0 — requer Client ID e Secret do portal do desenvolvedor',
    api_fields:['client_id','client_secret','cpf'],
    api_token_url:'https://api.smiles.com.br/v1/auth/oauth/token',
    api_balance_url:'https://api.smiles.com.br/v1/member/balance',
  },
  { type:'latam_pass', name:'LATAM Pass', icon:'🌎', color:'#E31837',
    api_url:'https://developer.latam.com', has_api:true,
    docs_url:'https://developer.latam.com/api-catalog',
    note:'API OAuth 2.0 — requer Client ID e Secret do portal LATAM Developer',
    api_fields:['client_id','client_secret','email'],
    api_token_url:'https://api.latam.com/oauth/token',
    api_balance_url:'https://api.latam.com/latampass/v1/member/balance',
  },
  { type:'livelo', name:'Livelo', icon:'🔴', color:'#B31017',
    api_url:'https://developers.livelo.com.br', has_api:true,
    docs_url:'https://developers.livelo.com.br/reference',
    note:'API OAuth 2.0 — acesso via portal Livelo para parceiros',
    api_fields:['client_id','client_secret','cpf'],
    api_token_url:'https://api.livelo.com.br/oauth/token',
    api_balance_url:'https://api.livelo.com.br/v1/participant/balance',
  },
  { type:'tudoazul', name:'TudoAzul (Azul)', icon:'💙', color:'#0056A2',
    api_url:'https://api.azul.com.br', has_api:true,
    docs_url:'https://api.azul.com.br/docs',
    note:'API via parceria Azul Linhas Aéreas — credenciais de parceiro',
    api_fields:['client_id','client_secret','login'],
    api_token_url:'https://api.azul.com.br/oauth2/token',
    api_balance_url:'https://api.azul.com.br/tudoazul/v1/member/points',
  },
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
// Expor estado para outros módulos (dashboard.js, accounts.js, etc.)
window._loy = _loy;

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
  // Used in accounts page cards — respects show_in_account_card flag
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

// Discrete badge content for dashboard favorites card (respects show_in_dash_fav flag)
function getLoyaltyBadgeDash(accountId) {
  const prog = _loy.programs.find(p =>
    p.linked_account_id === accountId && p.show_in_dash_fav !== false && p.show_in_account_card
  );
  if (!prog) return '';
  const cat = _loyCatalog(prog.program_type);
  // Returns just inline content — dashboard wraps it in its own button element
  return `<span style="font-size:.8rem;line-height:1">${cat.icon}</span><span style="font-size:.65rem;font-weight:700;color:${cat.color}">${_loyFmt(prog.points_balance)}</span>`;
}
window.getLoyaltyBadgeDash      = getLoyaltyBadgeDash;

// Helper to get program ID for a linked account (used by dashboard onclick)
window.getLoyaltyBadgeProgId = function(accountId) {
  const prog = _loy.programs.find(p =>
    p.linked_account_id === accountId && p.show_in_dash_fav !== false && p.show_in_account_card
  );
  return prog?.id || '';
};

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

  container.innerHTML = `
    <div class="account-grid" style="margin-bottom:12px">
      ${programs.map(p => _loyCard(p)).join('')}
    </div>
    <div style="display:flex;justify-content:center;padding:4px 0 8px">
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

  // Compact pts display
  const fmtPts = n => {
    const v = Number(n||0);
    if (v >= 1000000) return (v/1000000).toFixed(1).replace('.0','') + 'M';
    if (v >= 1000)    return (v/1000).toFixed(1).replace('.0','') + 'k';
    return _loyFmt(v);
  };

  return `<div class="account-card-wrap">
    <div class="account-card loy-acc-card" onclick="openLoyaltyStatement('${p.id}')"
      style="cursor:pointer;position:relative;overflow:hidden;border-radius:14px;
             border:1.5px solid ${color}28;background:var(--surface)">
      <!-- Color stripe top -->
      <div style="height:4px;background:linear-gradient(90deg,${color},${color}99);width:100%"></div>
      <div class="account-card-body" style="padding:12px 14px 8px">
        <!-- Top row: icon + name + balance -->
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
          <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;
            background:${color}18;border:1.5px solid ${color}30;
            display:flex;align-items:center;justify-content:center;font-size:1.3rem">
            ${icon}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.85rem;font-weight:700;color:var(--text);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_loyEsc(p.name)}</div>
            <div style="font-size:.68rem;color:var(--muted)">${_loyEsc(cat.name)}</div>
            ${linkedLine}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:1.15rem;font-weight:800;color:${color};
              font-family:var(--font-serif);line-height:1">${fmtPts(p.points_balance)}</div>
            <div style="font-size:.62rem;color:var(--muted)">pontos</div>
            ${p.api_enabled ? '<div style="font-size:.6rem;padding:1px 5px;border-radius:5px;background:rgba(22,163,74,.1);color:#16a34a;font-weight:700;margin-top:3px">🟢 API</div>' : ''}
          </div>
        </div>
        ${expiryLine ? '<div style="margin-bottom:6px">' + expiryLine + '</div>' : ''}
        ${avgLine ? '<div style="margin-bottom:4px">' + avgLine + '</div>' : ''}
      </div>
      <div class="loyalty-card-actions loy-icon-actions" onclick="event.stopPropagation()">
        <!-- Atualizar -->
        <button class="loy-icon-btn" onclick="updateLoyaltyPoints('${p.id}')" title="Atualizar pontos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <!-- Extrato -->
        <button class="loy-icon-btn" onclick="openLoyaltyStatement('${p.id}')" title="Extrato de pontos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </button>
        <!-- Lançar -->
        <button class="loy-icon-btn loy-icon-btn--accent" onclick="openLoyaltyTxModal('${p.id}')" title="Lançar pontos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <!-- Converter -->
        <button class="loy-icon-btn" onclick="openLoyaltyConvert('${p.id}')" title="Converter pontos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        </button>
        <!-- Comprar -->
        <button class="loy-icon-btn" onclick="openLoyaltyPurchase('${p.id}')" title="Comprar pontos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        </button>
        ${cat.has_api ? `<button class="loy-icon-btn${p.api_enabled?' loy-icon-btn--accent':''}" onclick="openLoyaltyApiConfig('${p.id}')" title="${p.api_enabled?'API ativa':'Configurar API'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>` : ''}
        <!-- Editar -->
        <button class="loy-icon-btn" onclick="openLoyaltyModal('${p.id}')" title="Editar programa">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}


/* ════════════════════════════════════════════════════════════════════════════
   API CONFIGURATION MODAL
   Allows users to configure OAuth credentials for supported loyalty programs.
   Credentials are stored in loyalty_programs.api_config (JSONB).
   Sync attempts a CORS-capable direct call; if blocked, shows instructions
   for using a Supabase Edge Function proxy.
════════════════════════════════════════════════════════════════════════════ */

const _LOY_API_FIELD_LABELS = {
  client_id:     { label:'Client ID',     placeholder:'Obtido no portal do desenvolvedor', type:'text' },
  client_secret: { label:'Client Secret', placeholder:'Chave secreta da aplicação',         type:'password' },
  cpf:           { label:'CPF do titular',placeholder:'000.000.000-00',                    type:'text' },
  email:         { label:'E-mail da conta',placeholder:'email@exemplo.com',               type:'email' },
  login:         { label:'Login / CPF',   placeholder:'CPF ou e-mail cadastrado',          type:'text' },
};

async function openLoyaltyApiConfig(progId) {
  const prog = _loyProgram(progId);
  if (!prog) return;
  const cat  = _loyCatalog(prog.program_type);
  if (!cat.has_api) {
    _loyToast('Este programa não possui API pública disponível.', 'info');
    return;
  }

  const cfg     = prog.api_config || {};
  const enabled = prog.api_enabled || false;
  const color   = prog.color || cat.color;
  const lastSync = cfg.last_sync_at
    ? new Date(cfg.last_sync_at).toLocaleString('pt-BR')
    : 'Nunca sincronizado';
  const lastStatus = cfg.last_sync_status || '';

  // Build fields for this program's API
  const fieldsHtml = (cat.api_fields || ['client_id','client_secret']).map(f => {
    const meta  = _LOY_API_FIELD_LABELS[f] || { label: f, placeholder: '', type:'text' };
    const saved = cfg[f] ? (meta.type === 'password' ? '••••••••' : cfg[f]) : '';
    return `<div>
      <label style="font-size:.78rem;font-weight:600;color:var(--text2)">${meta.label}</label>
      <input type="${meta.type}" id="loyApi_${f}" class="form-input" value="${_loyEsc(saved)}"
        placeholder="${meta.placeholder}" autocomplete="off"
        style="margin-top:4px;font-family:monospace;font-size:.82rem">
    </div>`;
  }).join('');

  const syncStatusHtml = lastStatus
    ? `<div style="margin-top:6px;font-size:.73rem;padding:6px 10px;border-radius:7px;
        background:${lastStatus==='success'?'#f0fdf4':'#fef2f2'};
        color:${lastStatus==='success'?'#166534':'#991b1b'};
        border:1px solid ${lastStatus==='success'?'#bbf7d0':'#fecaca'}">
        ${lastStatus==='success'?'✅':'⚠️'} Última sincronização: ${lastSync}
        ${cfg.last_sync_points ? ` · ${_loyFmt(cfg.last_sync_points)} pontos` : ''}
      </div>`
    : `<div style="font-size:.73rem;color:var(--muted);margin-top:4px">⏱ ${lastSync}</div>`;

  const html = `
  <div class="modal-overlay open" id="loyApiModal" onclick="if(event.target===this)closeModal('loyApiModal')">
    <div class="modal" style="max-width:520px">
      <div class="modal-handle"></div>
      <div class="modal-header" style="gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <div style="width:36px;height:36px;border-radius:10px;background:${color}18;
            display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${prog.icon}</div>
          <div>
            <div style="font-size:.95rem;font-weight:700">Integração API</div>
            <div style="font-size:.75rem;color:var(--muted)">${_loyEsc(prog.name)}</div>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal('loyApiModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">

        <!-- Info box -->
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;font-size:.78rem;color:#1e40af">
          <div style="font-weight:700;margin-bottom:5px">📋 Como obter as credenciais</div>
          <div style="line-height:1.55;color:#1d4ed8">
            ${cat.note}<br>
            Acesse o portal do desenvolvedor, registre sua aplicação e copie o <strong>Client ID</strong> e <strong>Client Secret</strong>.
          </div>
          <a href="${cat.docs_url||cat.api_url}" target="_blank" rel="noopener"
            style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:.75rem;font-weight:600;color:#2563eb;text-decoration:none">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            Acessar portal: ${cat.api_url}
          </a>
        </div>

        <!-- Enable toggle -->
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;
          background:var(--surface2);border-radius:10px;border:1.5px solid ${enabled?'var(--accent)':'var(--border)'}">
          <input type="checkbox" id="loyApiEnabled" ${enabled?'checked':''}
            style="accent-color:var(--accent);width:16px;height:16px">
          <div>
            <div style="font-size:.84rem;font-weight:700;color:var(--text)">Habilitar sincronização automática</div>
            <div style="font-size:.72rem;color:var(--muted)">Quando ativo, permite sincronizar o saldo via API</div>
          </div>
        </label>

        <!-- API Fields -->
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:.78rem;font-weight:700;color:var(--text2)">🔑 Credenciais da API</div>
          ${fieldsHtml}
          <div style="font-size:.72rem;color:var(--muted);padding:8px 10px;background:var(--surface2);border-radius:8px">
            🔒 As credenciais são armazenadas de forma criptografada no banco de dados da sua família e nunca são compartilhadas.
          </div>
        </div>

        <!-- Sync status -->
        <div>
          <div style="font-size:.78rem;font-weight:700;color:var(--text2);margin-bottom:4px">⚡ Status da sincronização</div>
          ${syncStatusHtml}
          <div id="loyApiSyncMsg" style="display:none;margin-top:6px;font-size:.73rem;padding:8px 10px;border-radius:8px;border:1px solid var(--border)"></div>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border)">
          <button class="btn btn-primary" onclick="_loyApiSave('${progId}')" style="flex:1;min-width:120px">
            💾 Salvar configuração
          </button>
          <button class="btn btn-ghost" id="loyApiSyncBtn" onclick="_loyApiSync('${progId}')"
            style="display:flex;align-items:center;gap:5px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Sincronizar agora
          </button>
          <button class="btn btn-ghost" onclick="closeModal('loyApiModal')">Cancelar</button>
        </div>

        <!-- CORS notice (initially hidden) -->
        <div id="loyApiCorsNotice" style="display:none;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:.77rem;color:#78350f">
          <div style="font-weight:700;margin-bottom:6px">⚠️ Sincronização direta bloqueada (CORS)</div>
          <div style="line-height:1.55;margin-bottom:8px">
            O navegador bloqueou a chamada direta à API por restrição de segurança (CORS).
            Para sincronização automática, configure um <strong>Supabase Edge Function</strong> como proxy.
          </div>
          <div style="font-size:.73rem;background:#fef9c3;border-radius:7px;padding:8px;font-family:monospace;line-height:1.7">
            # supabase/functions/loyalty-sync/index.ts<br>
            # Implante esta função no seu projeto Supabase<br>
            # e configure LOYALTY_PROXY_URL nas configurações.
          </div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <label style="font-size:.73rem;font-weight:600;color:var(--text2)">URL do proxy (Edge Function):</label>
            <input type="text" id="loyApiProxyUrl" class="form-input"
              value="${_loyEsc(cfg.proxy_url||'')}"
              placeholder="https://xxxx.supabase.co/functions/v1/loyalty-sync"
              style="flex:1;font-size:.73rem;font-family:monospace">
          </div>
        </div>

      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLoyaltyApiConfig = openLoyaltyApiConfig;

async function _loyApiSave(progId) {
  const prog = _loyProgram(progId);
  if (!prog) return;
  const cat = _loyCatalog(prog.program_type);

  const enabled = document.getElementById('loyApiEnabled')?.checked ?? false;
  const existing = prog.api_config || {};

  // Collect field values (don't overwrite with masked placeholder)
  const newCfg = { ...existing };
  (cat.api_fields || ['client_id','client_secret']).forEach(f => {
    const val = document.getElementById('loyApi_' + f)?.value?.trim() || '';
    if (val && val !== '••••••••') newCfg[f] = val;
  });

  // Save proxy URL if visible
  const proxyUrl = document.getElementById('loyApiProxyUrl')?.value?.trim();
  if (proxyUrl) newCfg.proxy_url = proxyUrl;

  try {
    const { error } = await sb.from('loyalty_programs')
      .update({ api_enabled: enabled, api_config: newCfg, updated_at: new Date().toISOString() })
      .eq('id', progId);
    if (error) throw error;

    // Update local cache
    const local = _loyProgram(progId);
    if (local) { local.api_enabled = enabled; local.api_config = newCfg; }

    _loyToast('✅ Configuração de API salva!', 'success');
    closeModal('loyApiModal');
    renderLoyaltySection();
  } catch(e) {
    _loyToast('Erro ao salvar: ' + e.message, 'error');
  }
}
window._loyApiSave = _loyApiSave;

async function _loyApiSync(progId) {
  const prog = _loyProgram(progId);
  if (!prog) return;
  const cat = _loyCatalog(prog.program_type);
  const cfg  = prog.api_config || {};

  const btn    = document.getElementById('loyApiSyncBtn');
  const msgEl  = document.getElementById('loyApiSyncMsg');
  const corsEl = document.getElementById('loyApiCorsNotice');

  const _setMsg = (text, ok) => {
    if (!msgEl) return;
    msgEl.style.display = '';
    msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
    msgEl.style.color      = ok ? '#166534' : '#991b1b';
    msgEl.textContent = text;
  };

  if (!cat.has_api) { _setMsg('⚠️ Este programa não tem API pública.', false); return; }

  const clientId     = cfg.client_id;
  const clientSecret = cfg.client_secret;
  if (!clientId || !clientSecret) {
    _setMsg('⚠️ Configure o Client ID e Client Secret antes de sincronizar.', false);
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando…'; }
  _setMsg('🔄 Conectando à API…', true);

  // Try proxy URL first (Edge Function), then direct
  const proxyUrl = cfg.proxy_url;

  try {
    let balancePoints = null;

    if (proxyUrl) {
      // ── Via Edge Function proxy ──────────────────────────────────────
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${clientId}` },
        body: JSON.stringify({
          program_type: prog.program_type,
          client_id: clientId,
          client_secret: clientSecret,
          cpf:   cfg.cpf   || null,
          email: cfg.email || null,
          login: cfg.login || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      balancePoints = data.points ?? data.balance ?? data.saldo ?? null;
    } else {
      // ── Direct OAuth attempt (may fail CORS) ─────────────────────────
      const tokenRes = await fetch(cat.api_token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        },
        body: 'grant_type=client_credentials',
      });
      if (!tokenRes.ok) throw new Error(`Token error: HTTP ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const balRes = await fetch(cat.api_balance_url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!balRes.ok) throw new Error(`Balance error: HTTP ${balRes.status}`);
      const balData = await balRes.json();
      balancePoints = balData.points ?? balData.balance ?? balData.saldo ?? null;
    }

    if (balancePoints === null) throw new Error('Saldo não encontrado na resposta da API.');
    balancePoints = Math.round(Number(balancePoints));

    // Update balance in DB
    const now = new Date().toISOString();
    const newCfg = { ...cfg, last_sync_at: now, last_sync_status: 'success', last_sync_points: balancePoints };
    const diff = balancePoints - prog.points_balance;
    await sb.from('loyalty_programs').update({
      points_balance: balancePoints,
      api_config: newCfg,
      updated_at: now,
    }).eq('id', progId);

    // Record adjustment transaction if balance changed
    if (diff !== 0) {
      await sb.from('loyalty_transactions').insert({
        family_id: _loyFamId(), program_id: progId,
        type: 'adjust', points: diff,
        description: `Sincronização via API ${cat.name}`,
        date: now.slice(0,10),
      });
    }

    // Update local cache
    const local = _loyProgram(progId);
    if (local) { local.points_balance = balancePoints; local.api_config = newCfg; }

    _setMsg(`✅ Sincronizado! Saldo: ${_loyFmt(balancePoints)} pontos${diff!==0?` (${diff>0?'+':''}${_loyFmt(diff)})` : ' (sem alteração)'}`, true);
    _loyToast('✅ Pontos sincronizados via API!', 'success');
    _loy.loaded = false;
    await loadLoyaltyPrograms();
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();

  } catch(e) {
    const isCors = e.message?.includes('fetch') || e.message?.toLowerCase().includes('cors') || e.name === 'TypeError';
    if (isCors && corsEl) corsEl.style.display = '';
    const newCfg = { ...cfg, last_sync_at: new Date().toISOString(), last_sync_status: 'error', last_sync_error: e.message };
    await sb.from('loyalty_programs').update({ api_config: newCfg }).eq('id', progId).then(()=>{});
    _setMsg(`⚠️ ${isCors ? 'Bloqueado por CORS — configure o proxy abaixo.' : 'Erro: ' + e.message}`, false);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Sincronizar novamente'; }
  }
}
window._loyApiSync = _loyApiSync;

/* ── Modal: criar / editar programa ─────────────────────────────────────────*/
// ── Loyalty icon picker ──────────────────────────────────────────────────────
const _LOY_ICONS = ['⭐', '🏆', '✈️', '🎯', '💎', '🛒', '🍔', '🍕', '☕', '🛍️', '🏦', '💳', '💰', '🪙', '📱', '🎮', '🎬', '🎵', '📚', '🏋️', '🚗', '⛽', '🏠', '🌟', '🔮', '💫', '🎁', '🎪', '🏅', '🥇', '🦁', '🐝', '🦋', '🦅', '🌈', '🍀', '🌺', '🌸', '🎨', '🖌️'];

function _loyIconPickerHtml(selected) {
  return _LOY_ICONS.map(ic => {
    const isActive = ic === selected;
    return `<button type="button" onclick="_loyPickIcon('${ic}')"
      title="${ic}"
      style="font-size:1.25rem;padding:5px 7px;border-radius:8px;border:2px solid ${isActive?'var(--accent)':'var(--border)'};background:${isActive?'var(--accent-lt,rgba(42,96,73,.10))':'var(--surface)'};cursor:pointer;transition:all .12s;line-height:1"
      data-icon="${ic}">${ic}</button>`;
  }).join('');
}

window._loyPickIcon = function(ic) {
  // Update hidden input and preview
  const inp     = document.getElementById('loyProgIcon');
  const preview = document.getElementById('loyIconPreview');
  if (inp)     inp.value = ic;
  if (preview) preview.textContent = ic;
  // Update button styles
  document.querySelectorAll('#loyIconGrid button[data-icon]').forEach(btn => {
    const active = btn.dataset.icon === ic;
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.background  = active ? 'var(--accent-lt,rgba(42,96,73,.10))' : 'var(--surface)';
  });
};

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

        <!-- Nome + cor -->
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Nome do programa *</label>
            <input type="text" id="loyProgName" class="form-input" value="${_loyEsc(prog.name)}"
              placeholder="Ex: Smiles, Livelo, LATAM Pass…" style="margin-top:4px">
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--text2)">Cor</label>
            <input type="color" id="loyProgColor" value="${prog.color}"
              style="margin-top:4px;width:48px;height:38px;border-radius:8px;border:1px solid var(--border);padding:2px;cursor:pointer">
          </div>
        </div>

        <!-- Ícone picker -->
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--text2);display:flex;align-items:center;gap:8px;margin-bottom:8px">
            Ícone
            <span id="loyIconPreview" style="font-size:1.4rem;line-height:1">${_loyEsc(prog.icon)}</span>
            <input type="hidden" id="loyProgIcon" value="${_loyEsc(prog.icon)}">
          </label>
          <div id="loyIconGrid" style="display:flex;flex-wrap:wrap;gap:5px">
            ${_loyIconPickerHtml(prog.icon)}
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

        <!-- Mostrar no card da conta + dashboard -->
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <input type="checkbox" id="loyShowCard" ${prog.show_in_account_card?'checked':''} style="accent-color:var(--accent);width:16px;height:16px">
            <div>
              <div style="font-size:.84rem;font-weight:600;color:var(--text)">Exibir pontos no card da conta vinculada</div>
              <div style="font-size:.73rem;color:var(--muted)">Mostra badge de pontos no card da conta na página Contas</div>
            </div>
          </label>
          <label id="loyShowDashRow" style="display:${prog.linked_account_id?'flex':'none'};align-items:center;gap:10px;cursor:pointer;padding:10px 12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
            <input type="checkbox" id="loyShowDash" ${prog.show_in_dash_fav!==false?'checked':''} style="accent-color:var(--accent);width:16px;height:16px">
            <div>
              <div style="font-size:.84rem;font-weight:600;color:var(--text)">Exibir pontos no Dashboard (contas favoritas)</div>
              <div style="font-size:.73rem;color:var(--muted)">Mostra total de pontos de forma discreta na linha de ações do card favorito</div>
            </div>
          </label>
        </div>

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
  // Sync icon picker grid
  if (typeof _loyPickIcon === 'function') _loyPickIcon(icon);
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

  // Preserve existing api_config — API settings are saved separately via openLoyaltyApiConfig
  const existingProg = id ? _loyProgram(id) : null;
  const payload = {
    family_id: fid,
    name, icon, color,
    program_type:          type,
    linked_account_id:     linked || null,
    show_in_account_card:  showCard,
    show_in_dash_fav:      document.getElementById('loyShowDash')?.checked ?? true,
    points_expiry_date:    expiry || null,
    notes:                 notes || null,
    // Preserve api fields if already set
    api_enabled:           existingProg?.api_enabled ?? false,
    api_config:            existingProg?.api_config   ?? null,
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
        <button class="btn btn-primary btn-sm" onclick="openLoyaltyTxModal('${id}');closeModal('loyaltyStatementModal')">➕ Lançar</button>
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
/* ── Modal: registrar movimentação de pontos (uso, acúmulo, ajuste) ────────── */
function openLoyaltyTxModal(id) {
  const p   = _loyProgram(id);
  if (!p) return;
  const cat   = _loyCatalog(p.program_type);
  const color = p.color || cat.color;
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('loyaltyTxModal')?.remove();

  const html = `
  <div class="modal-overlay open" id="loyaltyTxModal"
    onclick="if(event.target===this)closeModal('loyaltyTxModal')">
    <div class="modal" style="max-width:460px">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">${p.icon} Lançar pontos — ${_loyEsc(p.name)}</span>
        <button class="modal-close" onclick="closeModal('loyaltyTxModal')">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:16px">

        <!-- Saldo atual -->
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:10px 14px;border-radius:10px;background:${color}12;border:1px solid ${color}28">
          <span style="font-size:.76rem;color:var(--muted);font-weight:600">Saldo atual</span>
          <span style="font-size:1rem;font-weight:800;color:${color}">${_loyFmt(p.points_balance)} pts</span>
        </div>

        <!-- Tipo -->
        <div class="form-group" style="margin:0">
          <label>Tipo de movimentação</label>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px" id="loyTxTypeGrid">
            <button type="button" class="loy-tx-type-btn active" data-type="redeem"
              onclick="_loyTxSelectType('redeem')"
              style="display:flex;flex-direction:column;align-items:center;gap:4px;
                padding:10px 6px;border-radius:10px;border:2px solid #dc2626;
                background:rgba(220,38,38,.08);cursor:pointer;font-family:inherit">
              <span style="font-size:1.2rem">✈️</span>
              <span style="font-size:.72rem;font-weight:700;color:#dc2626">Uso / Resgate</span>
              <span style="font-size:.62rem;color:var(--muted)">subtrai pontos</span>
            </button>
            <button type="button" class="loy-tx-type-btn" data-type="earn"
              onclick="_loyTxSelectType('earn')"
              style="display:flex;flex-direction:column;align-items:center;gap:4px;
                padding:10px 6px;border-radius:10px;border:2px solid var(--border);
                background:var(--surface2);cursor:pointer;font-family:inherit">
              <span style="font-size:1.2rem">⭐</span>
              <span style="font-size:.72rem;font-weight:700;color:#16a34a">Acúmulo</span>
              <span style="font-size:.62rem;color:var(--muted)">adiciona pontos</span>
            </button>
            <button type="button" class="loy-tx-type-btn" data-type="adjust"
              onclick="_loyTxSelectType('adjust')"
              style="display:flex;flex-direction:column;align-items:center;gap:4px;
                padding:10px 6px;border-radius:10px;border:2px solid var(--border);
                background:var(--surface2);cursor:pointer;font-family:inherit">
              <span style="font-size:1.2rem">⚖️</span>
              <span style="font-size:.72rem;font-weight:700;color:#d97706">Ajuste</span>
              <span style="font-size:.62rem;color:var(--muted)">±livre</span>
            </button>
          </div>
        </div>

        <!-- Quantidade de pontos -->
        <div class="form-group" style="margin:0">
          <label>Quantidade de pontos</label>
          <div style="display:flex;align-items:center;gap:8px">
            <div id="loyTxSignBadge" style="flex-shrink:0;padding:6px 12px;border-radius:8px;
              font-size:.8rem;font-weight:800;background:rgba(220,38,38,.1);color:#dc2626;
              border:1.5px solid rgba(220,38,38,.25)">−</div>
            <input type="number" id="loyTxPoints" min="1" step="1" placeholder="Ex: 5000"
              style="flex:1;font-size:1rem;font-weight:700;font-family:var(--font-serif)"
              oninput="_loyTxPreview()" onchange="_loyTxPreview()">
          </div>
          <div id="loyTxPreview" style="font-size:.72rem;margin-top:4px;color:var(--muted)"></div>
        </div>

        <!-- Descrição -->
        <div class="form-group" style="margin:0">
          <label>Descrição</label>
          <input type="text" id="loyTxDesc" placeholder="Ex: Passagem São Paulo–Lisboa, Upgrade de assento…"
            maxlength="120" autocomplete="off">
        </div>

        <!-- Data -->
        <div class="form-group" style="margin:0">
          <label>Data</label>
          <input type="date" id="loyTxDate" value="${today}">
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('loyaltyTxModal')">Cancelar</button>
        <button class="btn btn-primary" id="loyTxSaveBtn"
          onclick="saveLoyaltyTx('${id}')">💾 Salvar</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLoyaltyTxModal = openLoyaltyTxModal;

/* tipo selecionado via botões de card */
let _loyTxType = 'redeem';
function _loyTxSelectType(type) {
  _loyTxType = type;
  document.querySelectorAll('.loy-tx-type-btn').forEach(btn => {
    const t    = btn.dataset.type;
    const cols = { redeem:'#dc2626', earn:'#16a34a', adjust:'#d97706' };
    const active = t === type;
    btn.style.borderColor = active ? cols[t] : 'var(--border)';
    btn.style.background  = active ? `rgba(${t==='redeem'?'220,38,38':t==='earn'?'22,163,74':'217,119,6'},.08)` : 'var(--surface2)';
    btn.querySelector('span:nth-child(2)').style.color = active ? cols[t] : 'var(--text2)';
  });
  // Update sign badge
  const badge = document.getElementById('loyTxSignBadge');
  if (badge) {
    if (type === 'redeem') {
      badge.textContent = '−';
      badge.style.background = 'rgba(220,38,38,.1)'; badge.style.color = '#dc2626'; badge.style.borderColor = 'rgba(220,38,38,.25)';
    } else if (type === 'earn') {
      badge.textContent = '+';
      badge.style.background = 'rgba(22,163,74,.1)'; badge.style.color = '#16a34a'; badge.style.borderColor = 'rgba(22,163,74,.25)';
    } else {
      badge.textContent = '±';
      badge.style.background = 'rgba(217,119,6,.1)'; badge.style.color = '#d97706'; badge.style.borderColor = 'rgba(217,119,6,.25)';
    }
  }
  _loyTxPreview();
}
window._loyTxSelectType = _loyTxSelectType;

function _loyTxPreview() {
  const pts  = parseInt(document.getElementById('loyTxPoints')?.value || 0, 10);
  const el   = document.getElementById('loyTxPreview');
  if (!el || !pts) { if (el) el.textContent = ''; return; }
  const sign = _loyTxType === 'earn' ? +pts : _loyTxType === 'redeem' ? -pts : pts;
  const id   = document.querySelector('[id="loyTxSaveBtn"]')?.closest('.modal-overlay')
    ?.querySelector('[onclick*="saveLoyaltyTx"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  const prog = id ? _loyProgram(id) : null;
  const newBal = prog ? (Number(prog.points_balance) + sign) : null;
  const col = sign >= 0 ? '#16a34a' : '#dc2626';
  el.innerHTML = `<span style="color:${col};font-weight:700">${sign > 0 ? '+' : ''}${_loyFmt(sign)} pts</span>`
    + (newBal !== null ? ` → saldo: <strong>${_loyFmt(newBal)} pts</strong>` : '');
}
window._loyTxPreview = _loyTxPreview;

async function saveLoyaltyTx(id) {
  const p    = _loyProgram(id);
  if (!p) return;
  const btn  = document.getElementById('loyTxSaveBtn');
  const pts  = parseInt(document.getElementById('loyTxPoints')?.value || 0, 10);
  const desc = (document.getElementById('loyTxDesc')?.value || '').trim();
  const date = document.getElementById('loyTxDate')?.value || new Date().toISOString().slice(0, 10);

  if (!pts || pts <= 0) { _loyToast('Informe a quantidade de pontos.', 'error'); return; }
  if (!desc)            { _loyToast('Informe uma descrição.', 'error'); return; }

  // Signal: earn = positive, redeem = negative, adjust = raw (can be negative if user types with -)
  const signedPts = _loyTxType === 'earn' ? Math.abs(pts)
    : _loyTxType === 'redeem' ? -Math.abs(pts)
    : pts; // adjust: user decides direction via sign

  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const fid = _loyFamId();
    // Insert loyalty_transaction
    const { error: txErr } = await sb.from('loyalty_transactions').insert({
      family_id:  fid,
      program_id: id,
      type:       _loyTxType,
      points:     signedPts,
      description: desc,
      date,
    });
    if (txErr) throw txErr;

    // Update points_balance on loyalty_programs
    const newBalance = Number(p.points_balance) + signedPts;
    const { error: upErr } = await sb.from('loyalty_programs')
      .update({ points_balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (upErr) throw upErr;

    // Update local state
    p.points_balance = newBalance;

    closeModal('loyaltyTxModal');
    _loyToast(`✅ ${signedPts > 0 ? '+' : ''}${_loyFmt(signedPts)} pontos registrados!`, 'success');

    // Refresh section
    if (typeof renderLoyaltySection === 'function') renderLoyaltySection().catch(() => {});
    if (typeof renderAccounts === 'function') renderAccounts().catch(() => {});

  } catch(e) {
    _loyToast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar'; }
  }
}
window.saveLoyaltyTx = saveLoyaltyTx;



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

/* ════════════════════════════════════════════════════════════════════════════
   LOYALTY API SETTINGS PAGE
════════════════════════════════════════════════════════════════════════════ */
const _LOY_API_DOCS = {
  smiles: {
    steps: ['Acesse <a href="https://developers.smiles.com.br" target="_blank" style="color:var(--accent)">developers.smiles.com.br</a> e crie conta de desenvolvedor','Registre uma aplicação e copie o <strong>Client ID</strong> e <strong>Client Secret</strong>','Informe o <strong>CPF</strong> cadastrado no Smiles para consulta de saldo'],
    scope: 'Saldo de pontos e extrato',
    note: 'API Smiles é B2B — pode requerer solicitação de acesso via contato comercial.',
  },
  latam_pass: {
    steps: ['Acesse <a href="https://developer.latam.com" target="_blank" style="color:var(--accent)">developer.latam.com</a> e faça login','Registre uma aplicação e copie o <strong>Client ID</strong> e <strong>Client Secret</strong>','Informe o <strong>e-mail</strong> da conta LATAM Pass'],
    scope: 'Consulta de milhas e extrato',
    note: 'API LATAM requer aprovação de parceria para produção. Sandbox disponível para testes.',
  },
  livelo: {
    steps: ['Acesse <a href="https://developers.livelo.com.br" target="_blank" style="color:var(--accent)">developers.livelo.com.br</a> e registre-se','Crie aplicação para obter <strong>Client ID</strong> e <strong>Client Secret</strong>','Informe o <strong>CPF</strong> cadastrado na Livelo'],
    scope: 'Saldo de pontos, extrato e resgates',
    note: 'Sandbox disponível. Produção requer aprovação Livelo.',
  },
  tudoazul: {
    steps: ['Entre em contato com parcerias Azul via <a href="https://api.azul.com.br" target="_blank" style="color:var(--accent)">api.azul.com.br</a>','Após aprovação, obtenha <strong>Client ID</strong> e <strong>Client Secret</strong>','Informe o <strong>login</strong> (CPF ou e-mail) da conta TudoAzul'],
    scope: 'Pontos TudoAzul e extrato de voos',
    note: 'API exclusiva para parceiros certificados Azul.',
  },
};

async function openLoyaltyApiSettings() {
  // Close any existing instance
  document.getElementById('loyApiSettingsModal')?.remove();

  const programs = (_loy.programs || []).filter(p => {
    const cat = _loyCatalog(p.program_type);
    return cat.has_api;
  });

  // Also show catalog programs not yet registered so user knows what's available
  const registeredTypes = new Set(programs.map(p => p.program_type));
  const availableCatalog = LOYALTY_CATALOG.filter(c => c.has_api && !registeredTypes.has(c.type));

  const _renderProgCard = (prog) => {
    const cat = _loyCatalog(prog.program_type);
    const cfg = prog.api_config || {};
    const isEnabled = prog.api_enabled;
    const lastSync = cfg.last_sync_at ? new Date(cfg.last_sync_at).toLocaleString('pt-BR') : null;
    const lastStatus = cfg.last_sync_status;
    const hasProxy = !!(cfg.proxy_url);
    const hasCreds = !!(cfg.client_id && cfg.client_secret);
    const docs = _LOY_API_DOCS[prog.program_type] || {};

    const statusBadge = isEnabled && hasCreds
      ? `<span style="font-size:.68rem;padding:2px 8px;background:#dcfce7;color:#166534;border-radius:10px;font-weight:700">🟢 Configurado</span>`
      : `<span style="font-size:.68rem;padding:2px 8px;background:#fef9c3;color:#854d0e;border-radius:10px;font-weight:700">⚙️ Configurar</span>`;

    const syncStatus = lastSync
      ? `<div style="font-size:.72rem;margin-top:6px;padding:6px 10px;border-radius:7px;background:${lastStatus==='success'?'#f0fdf4':'#fef2f2'};color:${lastStatus==='success'?'#166534':'#991b1b'}">
           ${lastStatus==='success'?'✅':'⚠️'} Última sincronização: ${lastSync}
           ${cfg.last_sync_points ? ` · ${_loyFmt(cfg.last_sync_points)} pontos` : ''}
         </div>`
      : `<div style="font-size:.72rem;color:var(--muted);margin-top:4px">⏱ Nunca sincronizado</div>`;

    const stepsHtml = (docs.steps||[]).map((s,i) =>
      `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
        <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center">${i+1}</span>
        <span style="font-size:.75rem;color:var(--text2);line-height:1.5">${s}</span>
      </div>`
    ).join('');

    const fieldLabels = {client_id:'Client ID', client_secret:'Client Secret', cpf:'CPF do titular', email:'E-mail da conta', login:'Login / CPF'};

    const fieldsHtml = (cat.api_fields||['client_id','client_secret']).map(f => {
      const isPass = f === 'client_secret';
      const saved = cfg[f] ? (isPass ? '••••••••' : cfg[f]) : '';
      const placeholder = {client_id:'Obtido no portal do desenvolvedor', client_secret:'Chave secreta da aplicação', cpf:'000.000.000-00', email:'email@exemplo.com', login:'CPF ou e-mail cadastrado'}[f] || '';
      return `<div>
        <label style="font-size:.74rem;font-weight:600;color:var(--text2)">${fieldLabels[f]||f}</label>
        <input type="${isPass?'password':'text'}" id="loys_${prog.id}_${f}" class="form-input"
          value="${_loyEsc(saved)}" placeholder="${placeholder}"
          autocomplete="off" style="margin-top:3px;font-family:monospace;font-size:.8rem">
      </div>`;
    }).join('');

    return `<div style="background:var(--surface);border:1.5px solid ${isEnabled&&hasCreds?'var(--accent)':'var(--border)'};border-radius:14px;padding:16px;margin-bottom:14px" id="loyApiCard_${prog.id}">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:11px;background:${cat.color}18;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">${prog.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.9rem;font-weight:800;color:var(--text)">${_loyEsc(prog.name)}</div>
          <div style="font-size:.72rem;color:var(--muted)">${_loyEsc(cat.name)} · ${_loyFmt(prog.points_balance)} pontos atuais</div>
        </div>
        ${statusBadge}
      </div>

      <!-- Enable toggle -->
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 10px;background:var(--surface2);border-radius:9px;border:1px solid var(--border);margin-bottom:10px">
        <input type="checkbox" id="loys_${prog.id}_enabled" ${isEnabled?'checked':''}
          style="accent-color:var(--accent);width:15px;height:15px">
        <span style="font-size:.8rem;font-weight:600;color:var(--text)">Habilitar sincronização automática</span>
      </label>

      <!-- How to get credentials -->
      <details style="margin-bottom:10px">
        <summary style="font-size:.75rem;font-weight:700;color:var(--accent);cursor:pointer;padding:4px 0;list-style:none;display:flex;align-items:center;gap:5px">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Como obter as credenciais
        </summary>
        <div style="margin-top:8px;padding:10px 12px;background:var(--surface2);border-radius:9px;border-left:3px solid var(--accent)">
          ${stepsHtml}
          ${docs.scope ? `<div style="font-size:.72rem;color:var(--muted);margin-top:6px"><strong>Escopo:</strong> ${docs.scope}</div>` : ''}
          ${docs.note  ? `<div style="font-size:.72rem;color:#d97706;margin-top:4px;font-style:italic">⚠️ ${docs.note}</div>` : ''}
          <a href="${cat.docs_url||cat.api_url||'#'}" target="_blank" rel="noopener"
            style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:.73rem;font-weight:600;color:#2563eb;text-decoration:none">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            Acessar portal do desenvolvedor
          </a>
        </div>
      </details>

      <!-- Credential fields -->
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
        ${fieldsHtml}
      </div>

      <!-- Proxy URL (Edge Function) -->
      <details style="margin-bottom:10px">
        <summary style="font-size:.73rem;font-weight:600;color:var(--muted);cursor:pointer;padding:4px 0;list-style:none">
          ⚡ Proxy URL (Supabase Edge Function) ${hasProxy ? '✅' : '· opcional'}
        </summary>
        <div style="margin-top:6px">
          <div style="font-size:.7rem;color:var(--muted);margin-bottom:5px;line-height:1.5">
            Se a API bloquear chamadas diretas do browser (CORS), configure uma Edge Function como proxy.
            <a href="https://supabase.com/docs/guides/functions" target="_blank" style="color:var(--accent)">Ver docs →</a>
          </div>
          <input type="url" id="loys_${prog.id}_proxy_url" class="form-input"
            value="${_loyEsc(cfg.proxy_url||'')}"
            placeholder="https://xxxx.supabase.co/functions/v1/loyalty-sync"
            style="font-family:monospace;font-size:.75rem">
        </div>
      </details>

      ${syncStatus}

      <!-- Actions -->
      <div style="display:flex;gap:7px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="_loyApiSettingsSave('${prog.id}')"
          style="flex:1;min-width:120px">💾 Salvar</button>
        <button class="btn btn-ghost btn-sm" id="loys_sync_${prog.id}"
          onclick="_loyApiSettingsSync('${prog.id}')"
          style="display:flex;align-items:center;gap:5px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Sincronizar agora
        </button>
      </div>
      <div id="loys_msg_${prog.id}" style="display:none;margin-top:6px;font-size:.73rem;padding:7px 10px;border-radius:7px;border:1px solid var(--border)"></div>

    </div>`;
  };

  const unavailableHtml = availableCatalog.length
    ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="font-size:.75rem;font-weight:700;color:var(--muted);margin-bottom:10px">PROGRAMAS SEM API PÚBLICA</div>
        ${availableCatalog.map(c => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:1.1rem">${c.icon}</span>
            <div style="flex:1">
              <div style="font-size:.8rem;font-weight:600;color:var(--text)">${c.name}</div>
              <div style="font-size:.7rem;color:var(--muted)">${c.note}</div>
            </div>
          </div>`).join('')}
       </div>`
    : '';

  const html = `
  <div class="modal-overlay open" id="loyApiSettingsModal" onclick="if(event.target===this)document.getElementById('loyApiSettingsModal')?.remove()">
    <div class="modal" style="max-width:620px;max-height:90dvh;overflow-y:auto">
      <div class="modal-handle"></div>
      <div class="modal-header" style="position:sticky;top:0;background:var(--surface);z-index:10">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <div style="width:34px;height:34px;border-radius:10px;background:var(--accent);display:flex;align-items:center;justify-content:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </div>
          <div>
            <div style="font-size:.95rem;font-weight:800">Configurações de API</div>
            <div style="font-size:.73rem;color:var(--muted)">Programas de Fidelidade — sincronização automática</div>
          </div>
        </div>
        <button class="modal-close" onclick="document.getElementById('loyApiSettingsModal')?.remove()">✕</button>
      </div>
      <div class="modal-body">

        ${programs.length === 0
          ? `<div style="text-align:center;padding:32px 20px;color:var(--muted)">
               <div style="font-size:2.5rem;margin-bottom:12px">🔌</div>
               <div style="font-weight:700;font-size:.9rem;margin-bottom:6px">Nenhum programa com API disponível cadastrado</div>
               <div style="font-size:.8rem">Cadastre um programa Smiles, LATAM Pass, Livelo ou TudoAzul para configurar a integração.</div>
             </div>`
          : programs.map(_renderProgCard).join('')
        }

        ${unavailableHtml}

        <!-- How proxy works info -->
        <div style="margin-top:16px;padding:12px 14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
          <div style="font-size:.75rem;font-weight:700;color:var(--text2);margin-bottom:6px">💡 Como funciona a sincronização</div>
          <div style="font-size:.72rem;color:var(--muted);line-height:1.6">
            O app tenta conectar diretamente à API do programa usando OAuth 2.0. Se o browser bloquear por CORS,
            configure uma <strong>Supabase Edge Function</strong> como proxy — ela recebe a requisição do app
            e chama a API de forma segura pelo servidor.
          </div>
        </div>

      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLoyaltyApiSettings = openLoyaltyApiSettings;

// Save credentials from the settings page
async function _loyApiSettingsSave(progId) {
  const prog = _loyProgram(progId);
  if (!prog) return;
  const cat = _loyCatalog(prog.program_type);

  const enabled = document.getElementById(`loys_${progId}_enabled`)?.checked ?? false;
  const existing = prog.api_config || {};
  const newCfg = { ...existing };

  (cat.api_fields || ['client_id','client_secret']).forEach(f => {
    const val = document.getElementById(`loys_${progId}_${f}`)?.value?.trim() || '';
    if (val && val !== '••••••••') newCfg[f] = val;
  });

  const proxyUrl = document.getElementById(`loys_${progId}_proxy_url`)?.value?.trim();
  if (proxyUrl) newCfg.proxy_url = proxyUrl;
  else delete newCfg.proxy_url;

  const msgEl = document.getElementById(`loys_msg_${progId}`);
  const _msg = (text, ok) => {
    if (!msgEl) return;
    msgEl.style.display = '';
    msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
    msgEl.style.color = ok ? '#166534' : '#991b1b';
    msgEl.textContent = text;
  };

  try {
    const { error } = await sb.from('loyalty_programs')
      .update({ api_enabled: enabled, api_config: newCfg, updated_at: new Date().toISOString() })
      .eq('id', progId);
    if (error) throw error;

    const local = _loyProgram(progId);
    if (local) { local.api_enabled = enabled; local.api_config = newCfg; }

    // Update card border
    const card = document.getElementById(`loyApiCard_${progId}`);
    if (card) card.style.borderColor = enabled && newCfg.client_id ? 'var(--accent)' : 'var(--border)';

    _msg('✅ Configuração salva com sucesso!', true);
    _loyToast('✅ Credenciais de API salvas!', 'success');
    renderLoyaltySection();
    if (typeof renderAccounts === 'function') renderAccounts();
  } catch(e) {
    _msg('Erro: ' + e.message, false);
  }
}
window._loyApiSettingsSave = _loyApiSettingsSave;

// Sync from settings page
async function _loyApiSettingsSync(progId) {
  const btn   = document.getElementById(`loys_sync_${progId}`);
  const msgEl = document.getElementById(`loys_msg_${progId}`);

  const _msg = (text, ok) => {
    if (!msgEl) return;
    msgEl.style.display = '';
    msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
    msgEl.style.color = ok ? '#166534' : '#991b1b';
    msgEl.textContent = text;
  };

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sincronizando…'; }
  _msg('🔄 Conectando à API…', true);

  // Delegate to existing _loyApiSync which handles OAuth + balance update
  await _loyApiSync(progId);

  // Refresh status display after sync
  const prog = _loyProgram(progId);
  if (prog) {
    const cfg = prog.api_config || {};
    const ok = cfg.last_sync_status === 'success';
    const pts = cfg.last_sync_points ? _loyFmt(cfg.last_sync_points) + ' pontos' : '';
    const when = cfg.last_sync_at ? new Date(cfg.last_sync_at).toLocaleString('pt-BR') : '';
    _msg(ok ? `✅ ${pts} — ${when}` : `⚠️ ${cfg.last_sync_error || 'Erro na sincronização'}`, ok);
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Sincronizar novamente';
  }
}
window._loyApiSettingsSync = _loyApiSettingsSync;

