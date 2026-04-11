// ── Settings tab navigation (defined here so it works regardless of HTML version) ──
function cfgShowPane(paneId) {
  document.querySelectorAll('.cfg-pane').forEach(p => p.classList.remove('active'));
  // Support both class names (cfg-tab = new design, cfg-nav-item = legacy)
  document.querySelectorAll('.cfg-tab, .cfg-nav-item').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById(paneId);
  if (pane) pane.classList.add('active');
  const tab = paneId.replace('pane-', '');
  const btn = document.getElementById('cfgNavBtn-' + tab);
  if (btn) btn.classList.add('active');
  if (paneId === 'pane-avancado') {
    if (typeof initTranslationsAdmin === 'function') initTranslationsAdmin();
    // Auto-load demo selectors when advanced pane opens
    setTimeout(() => { try { _loadDemoSelectors(); } catch(_) {} }, 150);
  }
  if (paneId === 'pane-feedbacks' && typeof loadFeedbackReports === 'function') {
    loadFeedbackReports();
  }
  // Show danger zone only to family owner (not admin, not regular member)
  if (paneId === 'pane-familia') {
    const dangerZone = document.getElementById('familyDangerZone');
    if (dangerZone) {
      const isOwner = currentUser?.role === 'owner';  // family owner only, not global admin
      dangerZone.style.display = isOwner ? '' : 'none';
    }
  }
  // Scroll active tab into view on mobile
  if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}
window.cfgShowPane = cfgShowPane;

function _cfgApplyAdminNav() {
  const role = (typeof currentUser !== 'undefined') ? currentUser?.role : null;
  const isAdmin = role === 'admin' || role === 'owner';
  ['cfgNavBtn-familia','cfgNavBtn-aparencia','cfgNavBtn-avancado','cfgNavBtn-feedbacks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
}
window._cfgApplyAdminNav = _cfgApplyAdminNav;

async function _cfgUpdateFeedbackBadge() {
  try {
    const badge = document.getElementById('cfgFeedbackBadge');
    if (!badge || !window.sb) return;
    const { count } = await sb.from('app_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new');
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(_) {}
}
window._cfgUpdateFeedbackBadge = _cfgUpdateFeedbackBadge;


let _appSettingsCache = null; // in-memory cache after first load

async function loadAppSettings() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('app_settings').select('key, value').limit(200);
    if (error) throw error;
    _appSettingsCache = {};
    (data || []).forEach(row => { _appSettingsCache[row.key] = row.value; });
    // Merge feature flag overrides from localStorage.
    // Regra: localStorage TRUE vence DB FALSE para flags de módulo.
    // Isso garante que ativações feitas por owners (cuja escrita no DB pode ser
    // bloqueada por RLS em app_settings) não sejam revertidas no reload.
    const _featurePrefixes = ['prices_enabled_','grocery_enabled_','investments_enabled_','ai_insights_enabled_','debts_enabled_','backup_enabled_','snapshot_enabled_'];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && _featurePrefixes.some(p => k.startsWith(p))) {
        try {
          const v = localStorage.getItem(k);
          if (v !== null) {
            const lsVal = (v === 'true' || v === true);
            // localStorage true always wins; only fill if DB didn't return true
            if (lsVal || !_appSettingsCache.hasOwnProperty(k)) {
              _appSettingsCache[k] = lsVal;
            }
          }
        } catch {}
      }
    }
    // Apply logo override (if any)
    const logo = _appSettingsCache['app_logo_url'] || '';
    if (typeof setAppLogo === 'function') setAppLogo(logo);

    // Apply menu visibility (if configured)
    try { applyMenuVisibility(_getMenuVisibilityFromCache()); } catch {}
    // Apply settings visibility for non-admin users (runs after currentUser is set)
    // Will be re-applied in loadSettings() once page is open


    // Hydrate EmailJS config
    EMAILJS_CONFIG.serviceId  = _appSettingsCache['ej_service']  || '';
    EMAILJS_CONFIG.templateId = _appSettingsCache['ej_template'] || '';
    EMAILJS_CONFIG.scheduledTemplateId = _appSettingsCache['ej_sched_template'] || '';
    EMAILJS_CONFIG.publicKey  = _appSettingsCache['ej_key']      || '';
    // Hydrate masterPin
    const dbPin = _appSettingsCache['masterPin'];
    if (dbPin) localStorage.setItem('masterPin', dbPin); // keep local in sync
    // Hydrate auto-check config
    const dbAutoCheck = _appSettingsCache[AUTO_CHECK_CONFIG_KEY];
    if (dbAutoCheck) {
      // Auto-check config stored only in Supabase (family_settings)
    }
  } catch(e) {
    console.warn('loadAppSettings fallback to localStorage:', e.message);
    // Fallback: load from localStorage
    EMAILJS_CONFIG.serviceId  = _appSettingsCache?.['ej_service']  || '';
    EMAILJS_CONFIG.templateId = _appSettingsCache?.['ej_template'] || '';
    EMAILJS_CONFIG.publicKey  = _appSettingsCache?.['ej_key']      || '';
  }
  // Signal that app_settings are ready — lets modules do a cross-device restore pass
  try { document.dispatchEvent(new CustomEvent('appsettings:loaded')); } catch(_) {}
  // Sync module states from family_preferences table (new persistent store)
  // Non-blocking: runs after boot, re-applies module visibility with DB truth
  setTimeout(() => _seedModulesFromFamilyPreferences().catch(() => {}), 200);
}

// Reads family_preferences and seeds _familyFeaturesCache + _appSettingsCache.
// Called after loadAppSettings() finishes — guarantees DB truth wins over
// stale localStorage, without blocking the initial render.
async function _seedModulesFromFamilyPreferences() {
  if (!window.sb || !window.currentUser?.family_id) return;
  const fid = window.currentUser.family_id;
  try {
    // Try RPC first (SECURITY DEFINER — imune a RLS)
    let data = null;
    try {
      const { data: rpcRows, error: rpcErr } = await window.sb
        .rpc('get_family_preferences', { p_family_id: fid });
      if (!rpcErr && rpcRows && rpcRows.length > 0) data = rpcRows[0];
    } catch(_) {}
    // Fallback: direct SELECT (may be blocked by RLS for non-owners)
    if (!data) {
      const { data: row, error } = await window.sb
        .from('family_preferences').select('*').eq('family_id', fid).maybeSingle();
      if (!error && row) data = row;
    }

    // Additional path: read module flags from app_settings cache (written by saveAppSetting)
    // This works for ALL family members regardless of RLS on family_preferences
    const moduleKeys = ['ai_insights','ai_chat','debts','investments','grocery','prices','dreams','backup','snapshot'];
    const fromCache = {};
    moduleKeys.forEach(mod => {
      const k = mod + '_enabled_' + fid;
      if (window._appSettingsCache && k in window._appSettingsCache) {
        fromCache[mod] = !!window._appSettingsCache[k];
      } else {
        const ls = localStorage.getItem(k);
        if (ls !== null) fromCache[mod] = ls === 'true' || ls === true;
      }
    });

    // Merge: family_preferences wins if available, else use app_settings cache
    if (!data && Object.keys(fromCache).length === 0) return;
    // Build modMap: prefer family_preferences (authoritative), fall back to app_settings cache
    const modMap = {
      ai_insights: data ? data.module_ai_insights : fromCache['ai_insights'],
      ai_chat:     data ? data.module_ai_chat     : fromCache['ai_chat'],
      debts:       data ? data.module_debts       : fromCache['debts'],
      investments: data ? data.module_investments : fromCache['investments'],
      grocery:     data ? data.module_grocery     : fromCache['grocery'],
      prices:      data ? data.module_prices      : fromCache['prices'],
      dreams:      data ? data.module_dreams      : fromCache['dreams'],
    };
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    if (!window._appSettingsCache)    window._appSettingsCache    = {};
    let changed = false;
    Object.entries(modMap).forEach(([mod, enabled]) => {
      const key = mod + '_enabled_' + fid;
      const prev = window._appSettingsCache[key];
      const next = !!enabled;
      if (prev !== next) {
        window._appSettingsCache[key]    = next;
        window._familyFeaturesCache[key] = next;
        // Counter stored in Supabase only
        changed = true;
      }
    });
    if (!changed) return; // nothing to re-apply
    // Re-apply module visibility so nav items show/hide correctly
    ['applyInvestmentsFeature','applyDebtsFeature','applyDreamsFeature',
     'applyPricesFeature','applyGroceryFeature','applyAiInsightsFeature',
    ].forEach(fn => {
      if (typeof window[fn] === 'function') window[fn]().catch(() => {});
    });
  } catch(e) {
    console.warn('[_seedModulesFromFamilyPreferences]', e.message);
  }
}
window._seedModulesFromFamilyPreferences = _seedModulesFromFamilyPreferences;


// ── Real-time sync: module flag changes propagate to all active family members ─
function _initModuleFlagRealtimeSync() {
  if (!sb || !currentUser?.family_id) return;
  const fid = currentUser.family_id;
  const modulePrefixes = ['ai_insights_enabled_','ai_chat_enabled_','debts_enabled_',
    'investments_enabled_','grocery_enabled_','prices_enabled_','dreams_enabled_'];

  try {
    sb.channel('module_flags_' + fid)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'app_settings',
      }, (payload) => {
        const k = payload.new?.key || payload.old?.key || '';
        const isModuleFlag = modulePrefixes.some(p => k.startsWith(p) && k.endsWith(fid));
        if (!isModuleFlag) return;
        // Update caches
        const val = payload.eventType === 'DELETE' ? false : !!(payload.new?.value);
        if (!window._appSettingsCache) window._appSettingsCache = {};
        if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
        window._appSettingsCache[k] = val;
        window._familyFeaturesCache[k] = val;
        try { localStorage.setItem(k, String(val)); } catch(_) {}
        // Re-apply module visibility
        ['applyInvestmentsFeature','applyDebtsFeature','applyDreamsFeature',
         'applyPricesFeature','applyGroceryFeature','applyAiInsightsFeature',
        ].forEach(fn => {
          if (typeof window[fn] === 'function') window[fn]().catch(() => {});
        });
      })
      .subscribe();
  } catch(e) {
    console.warn('[_initModuleFlagRealtimeSync]', e.message);
  }
}
window._initModuleFlagRealtimeSync = _initModuleFlagRealtimeSync;


// ── Chaves de credenciais → sempre armazenadas por família no Supabase ────────
// Nunca vão para localStorage (dados sensíveis / compartilhados com a família)
const _FAMILY_SETTING_KEYS = new Set([
  'gemini_api_key',
  'gemini_model',
  'agent_n8n_webhook_url',
  'agent_n8n_secret_key',
  'tg_bot_name',
  'tg_link_token',
  'emailjs_service_id',
  'emailjs_template_id',
  'emailjs_public_key',
  // EmailJS legacy keys used in loadEmailJsConfig
  'ej_service',
  'ej_template',
  'ej_sched_template',
  'ej_key',
]);

// ── Helpers para family_settings table ───────────────────────────────────────
async function _famSettingGet(key) {
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid || !sb) return null;
  try {
    const { data, error } = await sb.from('family_settings')
      .select('value')
      .eq('family_id', fid)
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    try { return JSON.parse(data.value); } catch { return data.value; }
  } catch { return null; }
}

async function _famSettingSet(key, value) {
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid || !sb) return;
  const serialized = (value === null || value === undefined)
    ? null
    : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  try {
    await sb.from('family_settings')
      .upsert({ family_id: fid, key, value: serialized, updated_at: new Date().toISOString() },
               { onConflict: 'family_id,key' });
  } catch(e) {
    console.warn('[famSetting] set error:', e?.message);
  }
}

async function _famSettingDel(key) {
  const fid = typeof famId === 'function' ? famId() : null;
  if (!fid || !sb) return;
  try {
    await sb.from('family_settings').delete().eq('family_id', fid).eq('key', key);
  } catch {}
}

window._famSettingGet = _famSettingGet;
window._famSettingSet = _famSettingSet;
window._famSettingDel = _famSettingDel;

async function saveAppSetting(key, value) {
  // ── Credenciais de família → family_settings (Supabase), SEM localStorage ──
  if (_FAMILY_SETTING_KEYS.has(key) || key.startsWith('tg_link_token_')) {
    if (!_appSettingsCache) _appSettingsCache = {};
    _appSettingsCache[key] = value;
    await _famSettingSet(key, value);
    return;
  }

  // ── Cache em memória (sem localStorage para dados sensíveis) ──
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache[key] = value;
  if (!sb) return;

  // Detecta flag de módulo (ex: "debts_enabled_<uuid>")
  const m = String(key||'').match(/^(prices_enabled_|grocery_enabled_|backup_enabled_|snapshot_enabled_|investments_enabled_|debts_enabled_|ai_insights_enabled_|ai_chat_enabled_|dreams_enabled_)(.+)$/);
  const family_id = m ? m[2] : null;

  if (family_id) {
    try {
      const { error: rpcErr } = await sb.rpc('set_family_feature_flag', {
        p_family_id: family_id, p_key: key, p_value: !!value
      });
    } catch {}
    try {
      await sb.from('app_settings')
        .upsert({ key, value: !!value }, { onConflict: 'key' });
    } catch(e2) {
      console.warn('saveAppSetting module flag app_settings fallback:', e2?.message);
    }
    return;
  }

  // Config geral não sensível: app_settings (sem localStorage)
  try {
    const { error } = await sb.from('app_settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
  } catch(e) {
    console.warn('saveAppSetting DB error:', e.message);
  }
}

async function getAppSetting(key, defaultValue = null) {
  // ── Check memory cache first ──
  if (_appSettingsCache && key in _appSettingsCache) return _appSettingsCache[key];

  // ── Credentials → family_settings table ──
  if (_FAMILY_SETTING_KEYS.has(key) || key.startsWith('tg_link_token_')) {
    const val = await _famSettingGet(key);
    if (val !== null) {
      if (!_appSettingsCache) _appSettingsCache = {};
      _appSettingsCache[key] = val;
      return val;
    }
    // Migrate from localStorage if present (one-time migration for existing users)
    try {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) {
        const parsed = (() => { try { return JSON.parse(legacy); } catch { return legacy; } })();
        await _famSettingSet(key, parsed);
        localStorage.removeItem(key);  // clean up after migrating
        if (!_appSettingsCache) _appSettingsCache = {};
        _appSettingsCache[key] = parsed;
        return parsed;
      }
    } catch {}
    return defaultValue;
  }

  // ── General settings → app_settings table ──
  try {
    if (sb) {
      const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
      if (data?.value !== undefined && data?.value !== null) {
        if (!_appSettingsCache) _appSettingsCache = {};
        _appSettingsCache[key] = data.value;
        return data.value;
      }
    }
  } catch {}

  return defaultValue;
}

// ── Escrita direta de feature flag — bypassa RLS e tenta todos os caminhos ──
// Usado pelo toggle de módulos. Persiste em: localStorage → _appSettingsCache →
// _familyFeaturesCache → family_preferences (se disponível) → app_settings RPC/upsert.
async function saveModuleFlag(key, value, famId) {
  // 1. Cache em memória — efeito imediato na sessão (sem localStorage)
  if (!window._appSettingsCache) window._appSettingsCache = {};
  window._appSettingsCache[key] = value;
  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  window._familyFeaturesCache[key] = value;

  if (!window.sb) return; // sem conexão: salvo localmente, suficiente

  const modKey = key.replace(/_enabled_.*$/, ''); // ex: "debts"

  // 3. family_preferences (tabela nova — OWNER tem write via RLS)
  if (famId) {
    try {
      const col = 'module_' + modKey; // ex: "module_debts"
      const { error } = await sb.from('family_preferences')
        .upsert({ family_id: famId, [col]: !!value, updated_at: new Date().toISOString() },
                 { onConflict: 'family_id' });
      if (!error) {
        // Atualiza _fpCache diretamente (sync, sem await que pode retornar stale)
        if (window._fpCache && window._fpCache.modules) {
          window._fpCache.modules[modKey] = !!value;
        }
        // Dispara evento para que a UI reaja
        document.dispatchEvent(new CustomEvent('familyprefs:changed', {
          detail: { prefs: window._fpCache }
        }));
        return; // persistiu no caminho novo
      }
    } catch(_) {}
  }

  // 4. RPC set_family_feature_flag (SECURITY DEFINER — bypassa RLS)
  if (famId) {
    try {
      const { error } = await sb.rpc('set_family_feature_flag',
        { p_family_id: famId, p_key: key, p_value: !!value });
      if (!error) return;
    } catch(_) {}
  }

  // 5. RPCs SECURITY DEFINER (upsert_family_module e set_family_module)
  if (famId && modKey) {
    for (const rpcName of ['upsert_family_module', 'set_family_module']) {
      try {
        const { error } = await sb.rpc(rpcName,
          { p_family_id: famId, p_module: modKey, p_enabled: !!value });
        if (!error) return;
      } catch(_) {}
    }
  }

  // 6. Upsert direto em app_settings (pode falhar por RLS — best-effort)
  try {
    await sb.from('app_settings')
      .upsert({ key, value: !!value }, { onConflict: 'key' });
  } catch(_) {}

  // Mesmo que tudo falhe no DB, o valor está no localStorage.
  // Na próxima sessão loadAppSettings faz merge de localStorage → _appSettingsCache.
}
window.saveModuleFlag = saveModuleFlag;

// Força ativação/desativação de um módulo — caminho direto, sem cascade de erros
async function forceActivateModule(modKey, enabled, label) {
  const famId = window.currentUser?.family_id;
  if (!famId) { toast('Família não identificada', 'error'); return; }

  const key = modKey + '_enabled_' + famId;
  const nowOn = (enabled !== undefined) ? !!enabled : !window._familyFeaturesCache?.[key];

  await saveModuleFlag(key, nowOn, famId);

  // Aplica imediatamente na UI
  const applyMap = {
    prices:       'applyPricesFeature',
    grocery:      'applyGroceryFeature',
    investments:  'applyInvestmentsFeature',
    ai_insights:  'applyAiInsightsFeature',
    debts:        'applyDebtsFeature',
    dreams:       'applyDreamsFeature',
  };
  const applyFn = applyMap[modKey];
  if (applyFn && typeof window[applyFn] === 'function') {
    await window[applyFn]().catch(() => {});
  }

  const lbl = label || modKey;
  toast(nowOn ? `✓ ${lbl} ativado` : `${lbl} desativado`, 'success');
}
window.forceActivateModule = forceActivateModule;

function showEmailConfig() {
  // Populate fields with saved values
  loadShowAccessRequestSetting();
    document.getElementById('ejServiceId').value  = EMAILJS_CONFIG.serviceId;
  document.getElementById('ejTemplateId').value = EMAILJS_CONFIG.templateId;
  const stpl = document.getElementById('ejSchedTemplateId');
  if(stpl) stpl.value = EMAILJS_CONFIG.scheduledTemplateId || '';
  document.getElementById('ejPublicKey').value  = EMAILJS_CONFIG.publicKey;
  ejCheckStatus();
  openModal('emailjsModal');
}

function ejCheckStatus() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  const ok  = svc && tpl && key;
  const dot = document.getElementById('ejStatusDot');
  const txt = document.getElementById('ejStatusText');
  const sub = document.getElementById('ejSettingsSub');
  if(ok) {
    dot.className = 'ej-status-dot ej-status-ok';
    txt.textContent = '✓ Configurado — pronto para enviar';
    txt.style.color = 'var(--green)';
    if(sub) sub.textContent = `Configurado · ${svc}`;
  } else {
    dot.className = 'ej-status-dot ej-status-warn';
    txt.textContent = 'Preencha os três campos abaixo';
    txt.style.color = 'var(--muted)';
    if(sub) sub.textContent = 'Não configurado — clique para configurar';
  }
  const res = document.getElementById('ejTestResult');
  if(res) { res.className = 'ej-test-result'; res.textContent = ''; }
}

async function saveEmailJSConfig() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  if(!svc || !tpl || !key) {
    toast('Preencha todos os campos', 'error'); return;
  }
  EMAILJS_CONFIG.serviceId  = svc;
  EMAILJS_CONFIG.templateId = tpl;
  EMAILJS_CONFIG.scheduledTemplateId = stpl;
  EMAILJS_CONFIG.publicKey  = key;
  await saveAppSetting('ej_service',  svc);
  await saveAppSetting('ej_template', tpl);
  await saveAppSetting('ej_sched_template', stpl);
  await saveAppSetting('ej_key',      key);
  // ej_sched_template stored in family_settings via saveAppSetting
  ejCheckStatus();
  closeModal('emailjsModal');
  toast(t('toast.emailjs_saved'), 'success');
}

function toggleEjKey() {
  const inp = document.getElementById('ejPublicKey');
  const btn = document.getElementById('ejKeyToggle');
  if(inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
  else                        { inp.type = 'password'; btn.textContent = '👁'; }
}

function copyEjField(id) {
  const val = document.getElementById(id)?.value;
  if(!val) return;
  navigator.clipboard.writeText(val).then(()=>toast(t('toast.copied'),'success'));
}

async function testEmailJSConnection() {
  const svc = document.getElementById('ejServiceId').value.trim();
  const tpl = document.getElementById('ejTemplateId').value.trim();
  const schedTplEl = document.getElementById('ejSchedTemplateId');
  const stpl = schedTplEl ? schedTplEl.value.trim() : '';
  const key = document.getElementById('ejPublicKey').value.trim();
  if(!svc || !tpl || !key) { toast('Preencha todos os campos primeiro','error'); return; }
  const btn = document.getElementById('ejTestBtn');
  const res = document.getElementById('ejTestResult');
  btn.disabled = true; btn.textContent = '⏳ Testando...';
  res.className = 'ej-test-result'; res.textContent = '';
  try {
    emailjs.init(key);
    // Send a real test email to verify credentials (uses template with minimal params)
    const testEmail = document.getElementById('ejServiceId').value.includes('@')
      ? svc : (currentUser?.email || 'teste@fintrack.app');
    await emailjs.send(svc, tpl, {
      to_email:       testEmail,
      from_name:      'J.F. Family FinTrack',
      subject:        'FinTrack — Teste de conexão ✅',
      message:        'Este é um e-mail de teste enviado pelo JF Family FinTrack para confirmar que a configuração do EmailJS está correta. Se recebeu este e-mail, está tudo funcionando!',
      report_period:  'Teste — ' + new Date().toLocaleDateString('pt-BR'),
      report_view:    'Teste de conexão',
      report_income:  'R$ 1.000,00',
      report_expense: 'R$ 800,00',
      report_balance: 'R$ 200,00',
      report_count:   '5',
      pdf_url:        'https://exemplo.com/relatorio-teste.pdf',
      pdf_name:       'FinTrack_Relatorio_Teste.pdf',
    });
    res.textContent = '✅ Conexão bem-sucedida! Verifique sua caixa de entrada.';
    res.className   = 'ej-test-result ej-test-ok';
    toast(t('toast.email_sent'), 'success');
  } catch(e) {
    res.textContent = '❌ Erro: ' + (e.text || e.message || JSON.stringify(e));
    res.className   = 'ej-test-result ej-test-err';
    toast('Falha no teste: ' + (e.text || e.message), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Testar conexão';
  }
}

// Init status indicator on load
function initEmailJSStatus() {
  if(!EMAILJS_CONFIG.serviceId) return;
  const sub = document.getElementById('ejSettingsSub');
  if(sub) sub.textContent = `Configurado · ${EMAILJS_CONFIG.serviceId}`;
}


// (Lock screen removed; keep only master PIN storage for settings.)

// ── PIN Screen logic ─────────────────────────────────────────
const DEFAULT_MASTER_PIN = '191291';

function getMasterPin() {
  const v = localStorage.getItem('masterPin') || localStorage.getItem('masterpin');
  return (v && String(v).trim()) ? String(v).trim() : DEFAULT_MASTER_PIN;
}


// Ensure Supabase client is available using saved credentials.
// (Needed so the app can boot after unlocking from the PIN screen.)
function ensureSupabaseClient() {
  // Prefer an already initialized client
  if (sb) return sb;

  // Prefer bundled constants (js/config.js), fallback to previously saved credentials
  const url = (window.SUPABASE_URL || '').trim() || localStorage.getItem('sb_url');
  const key = (window.SUPABASE_ANON_KEY || '').trim() || localStorage.getItem('sb_key');

  if (!url || !key) return null;

  // Keep localStorage in sync so the rest of the app (and older code paths) keep working
  try {
    if (localStorage.getItem('sb_url') !== url) localStorage.setItem('sb_url', url);
    if (localStorage.getItem('sb_key') !== key) localStorage.setItem('sb_key', key);
  } catch (e) {
    // localStorage can fail in private mode; non-fatal
  }

  try {
    sb = supabase.createClient(url, key);
    return sb;
  } catch (e) {
    console.error('Supabase client init failed:', e);
    return null;
  }
}


function initPinScreen() {
  // Lock screen removed: always proceed without PIN
  try { const ps = document.getElementById('pinScreen'); if(ps) ps.style.display='none'; } catch(e){}
  _pinUnlocked = true;
  clearAutoLockTimer();
  // If Supabase credentials exist, boot app; otherwise show setup screen
  const url = localStorage.getItem('sb_url');
  const key = localStorage.getItem('sb_key');
  if(url && key){
    ensureSupabaseClient();
    bootApp();
  } else {
    const setup = document.getElementById('setupScreen');
    if(setup) setup.style.display='flex';
  }
}

function onPinKeyboard(e) {
  if(_pinUnlocked) {
    document.removeEventListener('keydown', onPinKeyboard);
    return;
  }
  if(e.key >= '0' && e.key <= '9') pinKey(parseInt(e.key));
  if(e.key === 'Backspace') pinDel();
}

function pinKey(digit) {
  if(_pinUnlocked) return;
  if(_pinBuffer.length >= 6) return;
  _pinBuffer += digit;
  renderPinDots();
  // Haptic feedback on mobile
  if(navigator.vibrate) navigator.vibrate(20);
  if(_pinBuffer.length === 6) {
    setTimeout(checkPin, 120);
  }
}

function pinDel() {
  if(_pinBuffer.length > 0) {
    _pinBuffer = _pinBuffer.slice(0, -1);
    renderPinDots();
  }
}

function renderPinDots() {
  for(let i = 0; i < 6; i++) {
    const dot = document.getElementById('pd'+i);
    if(dot) {
      dot.classList.toggle('filled', i < _pinBuffer.length);
      dot.classList.remove('error');
    }
  }
}

function checkPin() {
  const entered = _pinBuffer;
  const correct = getMasterPin();
  if(entered === correct) {
    // Success! Animate dots green then unlock
    for(let i = 0; i < 6; i++) {
      const dot = document.getElementById('pd'+i);
      if(dot) { dot.classList.add('filled'); dot.style.background='#7ddc9e'; }
    }
    setTimeout(unlockApp, 380);
  } else {
    // Error — shake and show message
    for(let i = 0; i < 6; i++) {
      const dot = document.getElementById('pd'+i);
      if(dot) { dot.classList.remove('filled'); dot.classList.add('error'); }
    }
    const card = document.querySelector('.pin-card');
    if(card) { card.classList.add('pin-shake'); setTimeout(()=>card.classList.remove('pin-shake'),400); }
    const msg = document.getElementById('pinErrorMsg');
    if(msg) { msg.textContent = 'PIN incorreto. Tente novamente.'; setTimeout(()=>msg.textContent='',2500); }
    if(navigator.vibrate) navigator.vibrate([60,40,60]);
    _pinBuffer = '';
    setTimeout(renderPinDots, 300);
  }
}

async function unlockApp() {
  _pinUnlocked = true;
  document.removeEventListener('keydown', onPinKeyboard);
  const pinScreen = document.getElementById('pinScreen');
  pinScreen.style.opacity = '0';
  pinScreen.style.transition = 'opacity .35s ease';
  setTimeout(() => { pinScreen.style.display = 'none'; pinScreen.style.opacity = ''; }, 350);
  // Carregar dados após PIN correto
  const client = ensureSupabaseClient();
  if(client) {
    await bootApp();
  } else {
    // Sem credenciais/supabase client — pedir configuração
    setTimeout(() => {
      document.getElementById('setupScreen').style.display = 'flex';
    }, 400);
  }
  // Iniciar timer de auto-lock
  resetAutoLockTimer();
  document.addEventListener('click', resetAutoLockTimer, { passive: true });
  document.addEventListener('touchstart', resetAutoLockTimer, { passive: true });
  document.addEventListener('keydown', resetAutoLockTimer, { passive: true });
}



// ── Change PIN modal ──────────────────────────────────────────
let _pinModalStep = 1;
let _pinModalNew = '';

function openChangePinModal() {
  _pinModalStep = 1;
  _pinModalNew = '';
  // Clear all inputs
  for(let s=1;s<=3;s++) for(let i=0;i<6;i++) {
    const el = document.getElementById(`cp${s}_${i}`);
    if(el) el.value = '';
  }
  ['pinStep1Error','pinStep3Error'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='';});
  // Show step 1
  for(let s=1;s<=3;s++) {
    const el = document.getElementById('pinStep'+s);
    if(el) el.classList.toggle('active', s===1);
  }
  document.getElementById('pinStepBtn').textContent = 'Próximo';
  openModal('changePinModal');
  setTimeout(()=>document.getElementById('cp1_0')?.focus(), 200);
}

function pinModalInput(step, idx) {
  const el = document.getElementById(`cp${step}_${idx}`);
  if(!el) return;
  // Only allow digits
  el.value = el.value.replace(/\D/g,'').slice(-1);
  if(el.value && idx < 5) {
    const next = document.getElementById(`cp${step}_${idx+1}`);
    if(next) next.focus();
  }
  // Auto-advance when all 6 filled
  if(idx === 5 && el.value) {
    const full = Array.from({length:6},(_,i)=>document.getElementById(`cp${step}_${i}`)?.value||'').join('');
    if(full.length === 6) {
      // Brief delay so user sees last digit
      setTimeout(()=>advancePinStep(), 150);
    }
  }
}

function advancePinStep() {
  const getStepVal = s => Array.from({length:6},(_,i)=>document.getElementById(`cp${s}_${i}`)?.value||'').join('');

  if(_pinModalStep === 1) {
    const entered = getStepVal(1);
    if(entered.length < 6){toast('Digite os 6 dígitos','error');return;}
    if(entered !== getMasterPin()){
      document.getElementById('pinStep1Error').textContent = 'PIN atual incorreto.';
      for(let i=0;i<6;i++){const el=document.getElementById(`cp1_${i}`);if(el)el.value='';}
      document.getElementById('cp1_0')?.focus();
      return;
    }
    _pinModalStep = 2;
    document.getElementById('pinStep1').classList.remove('active');
    document.getElementById('pinStep2').classList.add('active');
    document.getElementById('cp2_0')?.focus();

  } else if(_pinModalStep === 2) {
    const entered = getStepVal(2);
    if(entered.length < 6){toast('Digite os 6 dígitos','error');return;}
    _pinModalNew = entered;
    _pinModalStep = 3;
    document.getElementById('pinStep2').classList.remove('active');
    document.getElementById('pinStep3').classList.add('active');
    document.getElementById('pinStepBtn').textContent = 'Salvar PIN';
    document.getElementById('cp3_0')?.focus();

  } else if(_pinModalStep === 3) {
    const confirm = getStepVal(3);
    if(confirm.length < 6){toast('Digite os 6 dígitos','error');return;}
    if(confirm !== _pinModalNew){
      document.getElementById('pinStep3Error').textContent = 'Os PINs não coincidem. Tente novamente.';
      for(let i=0;i<6;i++){const el=document.getElementById(`cp3_${i}`);if(el)el.value='';}
      document.getElementById('cp3_0')?.focus();
      return;
    }
    // Save new PIN
    localStorage.setItem('masterPin', _pinModalNew);
    localStorage.removeItem('masterpin');
    saveAppSetting('masterPin', _pinModalNew); // persist to DB
    toast('Masterpin alterado com sucesso! 🔐','success');
    closeModal('changePinModal');
  }
}

// ── Settings page ─────────────────────────────────────────────
function loadSettings() {
  loadAutoCheckConfig();
  const url = localStorage.getItem('sb_url') || '';
  const statusEl = document.getElementById('supabaseStatusLabel');
  if (statusEl && url) {
    const domain = url.replace('https://','').split('.')[0];
    statusEl.textContent = `Conectado · ${domain}.supabase.co`;
    statusEl.style.color = 'var(--green)';
  }
  const tl = document.getElementById('topbarLogoImg');
  const pt = document.getElementById('pageTitle');
  if (tl && pt) { tl.style.display='none'; pt.style.display=''; }
  if (typeof initLogoSettings === 'function') initLogoSettings();

  const isAdmin = (currentUser?.role==='admin');

  // DB Backup section — admin only
  const dbBackupSec = document.getElementById('dbBackupSection');
  if (dbBackupSec) {
    dbBackupSec.style.display = isAdmin ? '' : 'none';
    if (isAdmin) loadDbBackups();
  }

  // IA settings
  if (typeof initAiSettings === 'function') initAiSettings();

  // Telegram bot token
  if (typeof loadTelegramBotTokenUI === 'function') loadTelegramBotTokenUI();




  // Canais de notificação — carregar estado ao abrir settings
  if (typeof loadNotifChannelSettings === 'function') loadNotifChannelSettings().catch(() => {});

  // Apply admin nav tabs
  if (typeof _cfgApplyAdminNav === 'function') _cfgApplyAdminNav();

  // Seções admin-only (new design uses *2 IDs, legacy IDs kept for JS compat)
  const adminSections = ['settingsVisibilitySection', 'userMgmtSection2', 'normalizeNamesSection',
                         'orphanScanSection', 'orphanScanSection2', 'translationsSection2', 'logoSettingsSection2'];
  adminSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });

  if (isAdmin) {
    // Admin: inicializar formulários das novas seções
    initSettingsVisibilityForm();
    initServiceRoleKeySection();
    try { _loadNormalizeNamesInfo().catch(()=>{}); } catch {}
    // Translations admin (admin only)
    if (typeof initTranslationsAdmin === 'function') {
      initTranslationsAdmin();
    }
    // Show translations section for admin
    const transSection = document.getElementById('translationsSection');
    if (transSection) transSection.style.display = '';
  } else {
    // Usuário comum: aplicar restrições de visibilidade definidas pelo admin
    applySettingsVisibility();
  }
}



/* ══════════════════════════════════════════════════════════════════
   IMPORT ENGINE v3 — Rebuilt from scratch
   Supports: MoneyWiz, Nubank, Inter, Itaú, XP, Generic CSV/XLSX
══════════════════════════════════════════════════════════════════ */


function initLogoSettings() {
  // Admin-only section: show/hide
  const isAdmin = (currentUser?.role==='admin');
  const sec = document.getElementById('logoSettingsSection2') || document.getElementById('logoSettingsSection');
  if(sec) sec.style.display = isAdmin ? '' : 'none';
  if(!isAdmin) return;

  const urlEl = document.getElementById('appLogoUrl');
  const fileEl = document.getElementById('appLogoFile');
  const previewEl = document.getElementById('appLogoPreview');

  const cur = getAppSetting('app_logo_url','');
  if(urlEl && cur) urlEl.value = cur;
  if(previewEl && cur) previewEl.src = cur;

  if(fileEl) {
    fileEl.onchange = async () => {
      const f = fileEl.files && fileEl.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result;
        if(urlEl) urlEl.value = dataUrl;
        if(previewEl) previewEl.src = dataUrl;
      };
      reader.readAsDataURL(f);
    };
  }
}

async function saveAppLogo() {
  const isAdmin = (currentUser?.role==='admin');
  if(!isAdmin) { toast('Apenas admin pode alterar o logotipo','warning'); return; }

  const urlEl = document.getElementById('appLogoUrl');
  const val = (urlEl?.value || '').trim();
  if(!val) { toast('Informe uma URL ou selecione um arquivo','warning'); return; }

  await saveAppSetting('app_logo_url', val);
  if(typeof setAppLogo === 'function') setAppLogo(val);
  const previewEl = document.getElementById('appLogoPreview');
  if(previewEl) previewEl.src = val;
  toast('Logotipo atualizado','success');
}

async function resetAppLogo() {
  const isAdmin = (currentUser?.role==='admin');
  if(!isAdmin) { toast('Apenas admin pode alterar o logotipo','warning'); return; }

  await saveAppSetting('app_logo_url', '');
  if(typeof setAppLogo === 'function') setAppLogo('');
  const urlEl = document.getElementById('appLogoUrl');
  const previewEl = document.getElementById('appLogoPreview');
  if(urlEl) urlEl.value = '';
  if(previewEl) previewEl.src = (typeof APP_LOGO_URL !== 'undefined' ? APP_LOGO_URL : (typeof DEFAULT_LOGO_URL !== 'undefined' ? DEFAULT_LOGO_URL : ''));
  toast('Logotipo restaurado','success');
}

// ── Cursor image URL settings ─────────────────────────────────────────────────
const CURSOR_IMG_SETTING = 'cursor_img_url';
const CURSOR_IMG_DEFAULT = 'logocursor.png';

async function loadCursorImgSetting() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) return;
  const val = await getAppSetting(CURSOR_IMG_SETTING, CURSOR_IMG_DEFAULT);
  const el = document.getElementById('cursorImgUrl');
  if (el) el.value = val || CURSOR_IMG_DEFAULT;
}

async function saveCursorImgUrl() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) { toast('Apenas administradores podem alterar esta configuração', 'warning'); return; }
  const el  = document.getElementById('cursorImgUrl');
  const val = (el?.value || '').trim() || CURSOR_IMG_DEFAULT;
  await saveAppSetting(CURSOR_IMG_SETTING, val);
  // Apply immediately to the cursor module
  if (typeof window._setCursorLogoSrc === 'function') window._setCursorLogoSrc(val);
  toast('✓ Imagem do cursor salva', 'success');
}
window.saveCursorImgUrl = saveCursorImgUrl;

async function resetCursorImgUrl() {
  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'owner');
  if (!isAdmin) { toast('Apenas administradores podem alterar esta configuração', 'warning'); return; }
  await saveAppSetting(CURSOR_IMG_SETTING, CURSOR_IMG_DEFAULT);
  const el = document.getElementById('cursorImgUrl');
  if (el) el.value = CURSOR_IMG_DEFAULT;
  if (typeof window._setCursorLogoSrc === 'function') window._setCursorLogoSrc(CURSOR_IMG_DEFAULT);
  toast('↺ Cursor restaurado para o padrão', 'success');
}
window.resetCursorImgUrl = resetCursorImgUrl;


// ─────────────────────────────────────────────
// User Preferences (per screen)
// ─────────────────────────────────────────────
function _prefKey(screen, key){
  const uid = currentUser?.id || 'local';
  return `pref_${uid}_${screen}_${key}`;
}

function getUserPreference(screen, key){
  try{
    const raw = localStorage.getItem(_prefKey(screen,key));
    if(raw===null || raw===undefined) return null;
    return raw==='true' ? true : raw==='false' ? false : raw;
  }catch(e){ return null; }
}

async function setUserPreference(screen, key, value){
  try{ localStorage.setItem(_prefKey(screen,key), String(value)); }catch(e){}
  // Best-effort persistence in DB (optional)
  try{
    if(!sb || !currentUser?.id) return;
    const prefs = {};
    prefs[key]=value;
    await sb.from('user_preferences').insert({
      user_id: currentUser.id,
      screen,
      preferences: prefs,
      created_at: new Date().toISOString()
    });
  }catch(e){
    // ignore if table missing / RLS blocks
  }
}

function loadTxCompactPreference(){
  const el = document.getElementById('txCompactToggle');
  if(!el) return;
  const pref = getUserPreference('transactions','compact_view');
  const isCompact = pref===true || pref==='true' || localStorage.getItem('tx_compact_view')==='1';
  el.checked = !!isCompact;
  const knob = document.getElementById('txCompactKnob');
  if(knob){
    knob.style.background = isCompact ? 'var(--accent)' : '#ccc';
    document.getElementById('txCompactStyle')?.remove();
    const st = document.createElement('style');
    st.id='txCompactStyle';
    st.textContent = `#txCompactKnob::before{transform:translateX(${isCompact?20:0}px)}`;
    document.head.appendChild(st);
  }
  document.body.classList.toggle('tx-compact', !!isCompact);
}

async function saveTxCompactPreference(){
  const el = document.getElementById('txCompactToggle');
  const isCompact = !!el?.checked;
  localStorage.setItem('tx_compact_view', isCompact ? '1':'0');
  await setUserPreference('transactions','compact_view', isCompact);
  loadTxCompactPreference();
  // Re-render if on transactions/dashboard
  try{
    if(state.currentPage==='transactions') renderTransactions();
    if(state.currentPage==='dashboard') loadDashboardRecent();
  }catch(e){}
}


// ── Menu Visibility (admin configurable) ───────────────────────────────
const DEFAULT_MENU_VISIBILITY = {
  dashboard: true,
  transactions: true,
  accounts: true,
  reports: true,
  budgets: true,
  scheduled: true,
  categories: true,
  payees: true,
  import: true,
  audit: true,
  settings: true,
  // grocery e prices são controlados por feature flag — omitidos intencionalmente
};

function _getMenuVisibilityFromCache() {
  // app_settings key
  let v = (_appSettingsCache && _appSettingsCache['menu_visibility']) || null;
  if (!v) {
    // fallback localStorage
    const raw = localStorage.getItem('menu_visibility');
    if (raw) { try { v = JSON.parse(raw); } catch {} }
  }
  if (!v || typeof v !== 'object') v = {};
  return { ...DEFAULT_MENU_VISIBILITY, ...v };
}

function applyMenuVisibility(vis) {
  if (!vis || typeof vis !== 'object') vis = _getMenuVisibilityFromCache();

  // Keys admin can toggle — querySelectorAll('[data-nav="key"]') hits
  // sidebar nav-items, topbar icon buttons, and bottom nav tabs all at once.
  const STANDARD_KEYS = [
    'dashboard', 'transactions', 'accounts', 'reports', 'budgets',
    'scheduled', 'categories', 'payees', 'import',
    'grocery', 'prices',
  ];

  STANDARD_KEYS.forEach(key => {
    const show = vis[key] !== false; // default true when not explicitly set
    document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
      // grocery/prices são controlados por feature flag — não sobrescrever
      if (el.dataset && (el.dataset.featureControlled === '1' || el.dataset.featureControlled === 'true')) return;
      el.style.display = show ? '' : 'none';
    });
  });

  // settings/telemetry: admin-only. audit: visível para todos.
  // If currentUser is not ready yet, auth.js updateUserUI() will call us again.
  if (typeof currentUser !== 'undefined' && currentUser) {
    const isAdmin = !!(currentUser.can_admin);

    ['settings', 'telemetry'].forEach(key => {
      const wantVisible = vis[key] !== false;
      document.querySelectorAll('[data-nav="' + key + '"]').forEach(el => {
        const show = isAdmin && wantVisible;
        if (el.tagName === 'BUTTON' && el.id && el.id.includes('Topbar')) {
          el.classList.toggle('admin-visible', show);
        } else {
          el.style.display = show ? '' : 'none';
        }
      });
    });

    // audit: sempre visível para todos os autenticados
    document.querySelectorAll('[data-nav="audit"]').forEach(el => { el.style.display = ''; });

    // adminNavSection wrapper: visível se settings ou telemetry estiver visível
    const adminSec = document.getElementById('adminNavSection');
    if (adminSec) {
      const anyAdmin = ['settings', 'telemetry'].some(key => vis[key] !== false);
      adminSec.style.display = (isAdmin && anyAdmin) ? '' : 'none';
    }
  }
}

function _renderMenuVisibilityForm() {
  const wrap = document.getElementById('menuVisibilityForm');
  const hint = document.getElementById('menuVisibilityHint');
  if (!wrap) return;
  const vis = _getMenuVisibilityFromCache();

  const items = [
    ['dashboard',   'Dashboard'],
    ['transactions','Transações'],
    ['accounts',    'Contas'],
    ['reports',     'Relatórios'],
    ['budgets',     'Orçamentos'],
    ['scheduled',   'Programados'],
    ['categories',  'Categorias'],
    ['payees',      'Beneficiários'],
    ['import',      'Importar'],
    ['audit',       'Auditoria'],
    ['settings',    'Configurações (admin)'],
  ];

  wrap.innerHTML = items.map(([key,label]) => {
    const checked = vis[key] ? 'checked' : '';
    const disabled = (key==='audit' || key==='settings') ? '' : '';
    return `<label style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)">
      <input type="checkbox" id="mv_${key}" ${checked} ${disabled} style="transform:scale(1.1)">
      <span style="font-size:.95rem">${label}</span>
    </label>`;
  }).join('');

  if (hint) hint.textContent = 'Dica: se você ocultar uma página, ainda poderá acessá-la via URL/atalhos internos, mas ela não aparece no menu.';
}

async function saveMenuVisibility() {
  const vis = {};
  Object.keys(DEFAULT_MENU_VISIBILITY).forEach(k => {
    const cb = document.getElementById('mv_' + k);
    if (cb) vis[k] = !!cb.checked;
  });
  await saveAppSetting('menu_visibility', vis);
  // refresh cache and apply
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['menu_visibility'] = vis;
  applyMenuVisibility(vis);
  toast('Menu atualizado ✓', 'success');
}

async function resetMenuVisibility() {
  await saveAppSetting('menu_visibility', DEFAULT_MENU_VISIBILITY);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['menu_visibility'] = DEFAULT_MENU_VISIBILITY;
  _renderMenuVisibilityForm();
  applyMenuVisibility(DEFAULT_MENU_VISIBILITY);
  toast('Menu restaurado ✓', 'success');
}

// ═══════════════════════════════════════════════════════════════════
// CONTROLE DE VISIBILIDADE DAS CONFIGURAÇÕES (admin → usuários comuns)
// ═══════════════════════════════════════════════════════════════════
// ── Configurações: expand/collapse section ──────────────────────────
function toggleCfgSection(bodyId) {
  // Legacy accordion toggle — no-op in new tabbed design
  // Translations lazy-init still needed
  if (bodyId === 'cfgSec_i18n') {
    if (typeof initTranslationsAdmin === 'function') initTranslationsAdmin();
  }
}


const DEFAULT_SETTINGS_VISIBILITY = {
  currentUser:   true,   // Dados do usuário (sempre visível — bloqueado)
  supabase:      false,  // Conexão Supabase
  emailjs:       false,  // Configuração de e-mail
  masterPin:     false,  // PIN master
  aiSettings:    true,   // IA / Receitas
  menuItems:     false,  // Itens do menu
  autoCheck:     false,  // Automação programados
  appLogo:       false,  // Logo do app
  dbBackup:      false,  // Backup do banco
};

// IDs das sections no HTML indexadas pela chave
const SETTINGS_SECTION_IDS = {
  currentUser:  'currentUserSection',
  supabase:     null,   // inline — tratado à parte
  emailjs:      null,   // inline — tratado à parte
  masterPin:    null,   // inline — tratado à parte
  aiSettings:   null,   // inline — tratado à parte
  menuItems:    'menuVisibilitySection',
  autoCheck:    null,   // seção de automação — identificada pelo grupo
  appLogo:      'logoSettingsSection',
  dbBackup:     'dbBackupSection',
};

const SETTINGS_VIS_LABELS = {
  currentUser:  { label: 'Perfil do usuário',         locked: true  },
  supabase:     { label: 'Conexão Supabase'                          },
  emailjs:      { label: 'Configuração de e-mail (EmailJS)'         },
  masterPin:    { label: 'PIN master de segurança'                   },
  aiSettings:   { label: 'Inteligência Artificial (receitas)'        },
  menuItems:    { label: 'Visibilidade dos itens de menu'            },
  autoCheck:    { label: 'Automação de transações programadas'       },
  appLogo:      { label: 'Logo do aplicativo'                        },
  dbBackup:     { label: 'Backup do banco de dados'                  },
};

function _getSettingsVisibility() {
  const stored = _appSettingsCache?.['settings_visibility'];
  if (stored && typeof stored === 'object') return { ...DEFAULT_SETTINGS_VISIBILITY, ...stored };
  try {
    const ls = localStorage.getItem('settings_visibility');
    if (ls) return { ...DEFAULT_SETTINGS_VISIBILITY, ...JSON.parse(ls) };
  } catch {}
  return { ...DEFAULT_SETTINGS_VISIBILITY };
}

function initSettingsVisibilityForm() {
  const wrap = document.getElementById('settingsVisibilityForm');
  if (!wrap) return;
  const vis = _getSettingsVisibility();

  wrap.innerHTML = Object.entries(SETTINGS_VIS_LABELS).map(([key, cfg]) => {
    const checked = vis[key] ? 'checked' : '';
    const locked  = cfg.locked ? 'disabled title="Sempre visível"' : '';
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);cursor:${cfg.locked ? 'default' : 'pointer'}">
      <input type="checkbox" id="sv_${key}" ${checked} ${locked} style="transform:scale(1.1)">
      <span style="font-size:.85rem;flex:1">${cfg.label}</span>
      ${cfg.locked ? '<span style="font-size:.72rem;color:var(--muted)">sempre</span>' : ''}
    </label>`;
  }).join('');

  const hint = document.getElementById('settingsVisibilityHint');
  if (hint) hint.textContent = 'Admins e owners sempre veem todas as configurações.';
}

async function saveSettingsVisibility() {
  const vis = {};
  Object.keys(DEFAULT_SETTINGS_VISIBILITY).forEach(k => {
    const cb = document.getElementById('sv_' + k);
    vis[k] = cb ? !!cb.checked : DEFAULT_SETTINGS_VISIBILITY[k];
  });
  vis.currentUser = true; // always locked
  await saveAppSetting('settings_visibility', vis);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['settings_visibility'] = vis;
  applySettingsVisibility(vis);
  toast('Configuração de acesso salva ✓', 'success');
}

async function resetSettingsVisibility() {
  await saveAppSetting('settings_visibility', DEFAULT_SETTINGS_VISIBILITY);
  if (!_appSettingsCache) _appSettingsCache = {};
  _appSettingsCache['settings_visibility'] = DEFAULT_SETTINGS_VISIBILITY;
  initSettingsVisibilityForm();
  applySettingsVisibility(DEFAULT_SETTINGS_VISIBILITY);
  toast('Visibilidade restaurada ao padrão ✓', 'success');
}

// Aplica a visibilidade das seções para usuário não-admin
function applySettingsVisibility(vis) {
  const isAdmin = (currentUser?.role === 'admin');
  if (isAdmin) return; // admins veem tudo — não aplica restrição

  vis = vis || _getSettingsVisibility();

  // Sections com ID direto
  const direct = {
    menuItems: 'menuVisibilitySection',
    appLogo:   'logoSettingsSection',
    dbBackup:  'dbBackupSection',
  };
  Object.entries(direct).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = vis[key] ? '' : 'none';
  });

  // Seções inline: controlar por grupo-label ou settings-section pai
  // Mapear cada settings-section pela presença de elementos-chave
  document.querySelectorAll('.settings-section').forEach(sec => {
    // Conexão Supabase
    if (sec.querySelector('#supabaseStatusLabel') && !vis.supabase)
      sec.style.display = 'none';
    // EmailJS
    if (sec.querySelector('#ejServiceId') && !vis.emailjs)
      sec.style.display = 'none';
    // PIN master
    if (sec.querySelector('#masterPin') && !vis.masterPin)
      sec.style.display = 'none';
    // IA
    if (sec.querySelector('#aiApiKeyInput, #geminiKeyInput, [id*="aiKey"], [id*="gemini"]') && !vis.aiSettings)
      sec.style.display = 'none';
    // Automação
    if (sec.querySelector('#autoCheckEnabled') && !vis.autoCheck)
      sec.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE FLAGS / VISIBILIDADE POR USUÁRIO
// ═══════════════════════════════════════════════════════════════════

function currentUserFeatureEnabled(featureKey, fallback = true) {
  return fallback;
}

async function applyUserFeatureFlags() {
  try { await applyPricesFeature?.(); } catch {}
  try { await applyGroceryFeature?.(); } catch {}
  try { await applyInvestmentsFeature?.(); } catch {}
  try { await applyAiInsightsFeature?.(); } catch {}
  try { await applyDebtsFeature?.(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// LINK DA ESCOLA — configuração e aplicação
// ═══════════════════════════════════════════════════════════════════


// ── Standalone Funcionalidades section (cfg-section dedicated to feature toggles) ──
function initFamModulesStandalone() {
  const wrap    = document.getElementById('cfgSec_features_wrap');
  const pills   = document.getElementById('famModulesPillsStandalone');
  const msgEl   = document.getElementById('famModulesMsg');
  if (!wrap || !pills) return;

  // Mostra seção para qualquer usuário autenticado com família
  // (ativação real é feita via openModuleActivationPanel que não depende de role)
  const isOwnerOrAdmin = currentUser?.can_admin || currentUser?.can_manage_family ||
                         currentUser?.role === 'owner' || currentUser?.role === 'admin';

  const famId = currentUser?.family_id
             || (typeof window.famId === 'function' ? window.famId() : null)
             || null;

  if (!famId) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const keys = [
    { key: 'prices_enabled_'      + famId, label: 'Preços',          emoji: '🏷️', applyFn: 'applyPricesFeature',       desc: 'Gestão de preços e lista de compras' },
    { key: 'grocery_enabled_'     + famId, label: 'Mercado',          emoji: '🛒', applyFn: 'applyGroceryFeature',      desc: 'Lista de mercado e compras' },
    { key: 'investments_enabled_' + famId, label: 'Investimentos',    emoji: '📈', applyFn: 'applyInvestmentsFeature',  desc: 'Carteira de investimentos (requer conta do tipo Investimentos)' },
    { key: 'ai_insights_enabled_' + famId, label: 'AI Insights',      emoji: '🤖', applyFn: 'applyAiInsightsFeature',   desc: 'Análise financeira e chat com IA Gemini (requer chave API)' },
    { key: 'debts_enabled_'       + famId, label: 'Dívidas',          emoji: '💳', applyFn: 'applyDebtsFeature',        desc: 'Controle e evolução de dívidas' },
    { key: 'dreams_enabled_'      + famId, label: 'Sonhos',           emoji: '🌟', applyFn: 'applyDreamsFeature',       desc: 'GPS financeiro — transforme objetivos em metas com IA' },
    { key: 'backup_enabled_'      + famId, label: 'Backup',           emoji: '☁️', applyFn: null,                       desc: 'Backup automático de dados' },
    { key: 'snapshot_enabled_'    + famId, label: 'Snapshot',         emoji: '📸', applyFn: null,                       desc: 'Snapshots periódicos do estado financeiro' },
  ];

  function renderCards() {
    const fc = window._familyFeaturesCache || {};
    // Cards sempre clicáveis — openModuleActivationPanel não depende de role
    pills.innerHTML = keys.map(({ key, label, emoji, applyFn, desc }) => {
      const on = fc[key] !== undefined ? !!fc[key] : (key.includes('backup') || key.includes('snapshot'));
      return `
        <div class="inv-kpi-card" style="cursor:pointer;transition:box-shadow .15s;${on ? 'border-color:var(--accent);background:var(--accent-lt)' : ''}"
             onclick="openModuleActivationPanel()"
             title="Gerenciar módulos da família">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:1.3rem">${emoji}</span>
            <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:20px;
              background:${on ? 'var(--accent)' : 'var(--surface2)'};
              color:${on ? '#fff' : 'var(--muted)'}">
              ${on ? '● Ativo' : '○ Inativo'}
            </span>
          </div>
          <div style="font-size:.85rem;font-weight:700;color:var(--text);margin-bottom:3px">${label}</div>
          <div style="font-size:.72rem;color:var(--muted);line-height:1.4">${desc}</div>
        </div>`;
    }).join('');
  }

  // Load cache and render — usa family_prefs service (novo) com fallback app_settings (legado)
  (async () => {
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    const allModuleKeys = keys.map(k => k.key);

    try {
      // 1. Tenta carregar via centralized service (family_preferences table)
      if (typeof getFamilyPreferences === 'function') {
        const prefs = await getFamilyPreferences();
        if (prefs && prefs.modules) {
          // prefs.modules = { debts: bool, prices: bool, ... }
          // Mapeia para o formato legado de cache
          keys.forEach(({ key }) => {
            const modKey = key.replace(/_enabled_.*$/, '');
            if (modKey in prefs.modules) {
              window._familyFeaturesCache[key] = !!(prefs.modules[modKey]);
            }
          });
          renderCards();
          return; // pronto — não precisa ir ao app_settings
        }
      }
    } catch(_) {}

    // 2. Fallback: app_settings legado
    try {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', allModuleKeys);
      allModuleKeys.forEach(k => {
        const row = (data || []).find(r => r.key === k);
        if (row) {
          window._familyFeaturesCache[k] = (row.value === true || row.value === 'true');
        } else {
          const local = localStorage.getItem(k);
          window._familyFeaturesCache[k] = local === 'true' || local === true
            ? true
            : (k.includes('backup') || k.includes('snapshot'));
        }
      });
    } catch(_) {}
    renderCards();
  })();
}


// ── Módulos da família na página de Configurações ──────────────────
function initFamModulesRow() {
  const row = document.getElementById('famModulesRow');
  const pills = document.getElementById('famModulesPills');
  if (!row || !pills) return;

  const isOwnerOrAdmin = currentUser?.can_admin || currentUser?.can_manage_family ||
                         currentUser?.role === 'owner' || currentUser?.role === 'admin';
  if (!isOwnerOrAdmin) { row.style.display = 'none'; return; }

  const famId = currentUser?.family_id;
  if (!famId) { row.style.display = 'none'; return; }

  row.style.display = '';

  const keys = [
    { key: 'prices_enabled_'  + famId, label: 'Preços',       emoji: '🏷️', applyFn: 'applyPricesFeature'      },
    { key: 'grocery_enabled_' + famId, label: 'Mercado',      emoji: '🛒', applyFn: 'applyGroceryFeature'     },
    { key: 'investments_enabled_' + famId, label: 'Investimentos', emoji: '📈', applyFn: 'applyInvestmentsFeature' },
    { key: 'ai_insights_enabled_' + famId, label: 'AI Insights',  emoji: '🤖', applyFn: 'applyAiInsightsFeature'  },
    { key: 'debts_enabled_'   + famId, label: 'Dívidas', emoji: '💳', applyFn: 'applyDebtsFeature' },
    { key: 'backup_enabled_'  + famId, label: 'Backup',       emoji: '☁️', applyFn: null },
    { key: 'snapshot_enabled_'+ famId, label: 'Snapshot',     emoji: '📸', applyFn: null },
  ];

  function renderPills() {
    const fc = window._familyFeaturesCache || {}; // always read live reference
    pills.innerHTML = keys.map(({ key, label, emoji, applyFn }) => {
      const on = fc[key] !== undefined ? !!fc[key] : (key.includes('backup')||key.includes('snapshot'));
      return `<button class="fam-mod-pill ${on?'on':''}"
        onclick="_cfgToggleModule('${key}','${famId}','${label}','${applyFn||''}')"
        title="${on?'Desativar':'Ativar'} ${label}">
        ${emoji} ${label}
        <span class="fam-mod-dot">${on?'●':'○'}</span>
      </button>`;
    }).join('');
  }

  // Carrega módulos via family_prefs (novo) com fallback app_settings
  (async () => {
    if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
    const allRowKeys = keys.map(k => k.key);

    try {
      if (typeof getFamilyPreferences === 'function') {
        const prefs = await getFamilyPreferences();
        if (prefs && prefs.modules) {
          keys.forEach(({ key }) => {
            const modKey = key.replace(/_enabled_.*$/, '');
            if (modKey in prefs.modules) {
              window._familyFeaturesCache[key] = !!(prefs.modules[modKey]);
            }
          });
          renderPills();
          return;
        }
      }
    } catch(_) {}

    // Fallback: app_settings legado
    try {
      const { data } = await sb.from('app_settings')
        .select('key,value')
        .in('key', allRowKeys);
      allRowKeys.forEach(k => {
        const row = (data || []).find(r => r.key === k);
        if (row) {
          window._familyFeaturesCache[k] = (row.value === true || row.value === 'true');
        } else {
          const local = localStorage.getItem(k);
          window._familyFeaturesCache[k] = local === 'true'
            ? true : (k.includes('backup') || k.includes('snapshot'));
        }
      });
    } catch {}
    renderPills();
  })();
}

async function _cfgToggleModule(key, famId, label, applyFn) {
  // Access control: apenas OWNER ou admin pode ativar/desativar módulos
  if (typeof canModifyPreferences === 'function' && !canModifyPreferences()) {
    toast(typeof t === 'function' ? t('auth.only_owners') : 'Apenas owners podem gerenciar módulos.', 'warning');
    return;
  }

  if (!window._familyFeaturesCache) window._familyFeaturesCache = {};
  const wasOn = !!window._familyFeaturesCache[key];
  const nowOn = !wasOn;

  // ── Atualização otimista SÍNCRONA (todos os caches ao mesmo tempo) ─────────
  // Garante que qualquer leitura subsequente (isDebtsEnabled, etc.) veja o
  // novo valor ANTES de qualquer await, mesmo se o DB falhar depois.
  window._familyFeaturesCache[key] = nowOn;
  if (typeof _appSettingsCache !== 'undefined' && _appSettingsCache !== null) {
    _appSettingsCache[key] = nowOn;
  }
  // localStorage: persistência garantida que sobrevive reload
  // (loadAppSettings() lê e merge isso no boot)
  try { localStorage.setItem(key, String(nowOn)); } catch(_) {}

  // Aplica imediatamente sem esperar DB (UX responsivo)
  if (applyFn && typeof window[applyFn] === 'function') {
    window[applyFn]().catch(() => {});
  }
  toast(nowOn ? `✓ ${label} ativado` : `${label} desativado`, 'success');

  // ── Persistência no banco via saveModuleFlag (tenta todos os caminhos) ──────
  saveModuleFlag(key, nowOn, famId).catch(() => {
    // Silencioso: localStorage já persistiu, UI já foi atualizada
  });
}
/* ══════════════════════════════════════════════════════════════════
   SERVICE ROLE KEY — armazenada só em localStorage, nunca no banco
   Usada para criar sbAdmin client com auth.admin.updateUserById
══════════════════════════════════════════════════════════════════ */

function initServiceRoleKeySection() {
  const isAdmin = (currentUser?.role === 'admin');
  const row = document.getElementById('serviceRoleRow');
  if (!row) return;
  row.style.display = isAdmin ? '' : 'none';
  if (!isAdmin) return;

  // SECURITY: Remove any previously stored service key immediately
  const hadKey = !!localStorage.getItem('sb_service_key');
  localStorage.removeItem('sb_service_key');

  const inp  = document.getElementById('serviceRoleKeyInput');
  const stat = document.getElementById('serviceRoleKeyStatus');
  if (inp)  inp.value = '';
  if (stat) {
    if (hadKey) {
      stat.innerHTML = '🔐 Chave anterior removida por segurança. O reset de senha usa RPC <code>set_user_password</code> (SECURITY DEFINER) — sem necessidade de armazenar a Service Role Key no navegador.';
      stat.style.color = 'var(--amber)';
    } else {
      stat.innerHTML = 'Reset de senha via RPC <code>set_user_password</code>. A Service Role Key não deve ser armazenada no navegador.';
      stat.style.color = 'var(--muted)';
    }
  }
  // Nullify sbAdmin so it's never initialized from stored key
  if (typeof initSbAdmin === 'function') initSbAdmin();

  // Show security migration prompt
  _initSecurityStatus();
}

async function _initSecurityStatus() {
  const el = document.getElementById('securityStatusPanel');
  if (!el) return;
  el.style.display = '';

  // Check if RLS is active by trying a cross-family query
  let rlsOk = null;
  try {
    const { data, error } = await sb.from('scheduled_transactions').select('id').limit(1);
    rlsOk = !error;
  } catch(_) { rlsOk = false; }

  const hasSvcKey = !!localStorage.getItem('sb_service_key');
  const hasPwd    = !!(localStorage.getItem('ft_remember_me') &&
                      JSON.parse(atob(localStorage.getItem('ft_remember_me') || 'e30=')).password);

  const items = [
    { ok: !hasSvcKey, label: 'Service Role Key não armazenada no browser',    fix: 'Já corrigido nesta versão.' },
    { ok: !hasPwd,    label: 'Senha não armazenada no localStorage',           fix: 'Já corrigido nesta versão.' },
    { ok: true,       label: 'Senhas usam PBKDF2 (migração automática no login)', fix: '' },
    { ok: rlsOk,      label: 'RLS ativo nas tabelas do banco',
      fix: 'Execute o SQL em <strong>SECURITY_RLS.sql</strong> no Supabase SQL Editor.' },
  ];

  el.innerHTML = `
    <div style="font-weight:700;font-size:.85rem;margin-bottom:10px;color:var(--text)">🔐 Status de Segurança</div>
    ${items.map(i => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1rem;flex-shrink:0">${i.ok ? '✅' : '⚠️'}</span>
        <div style="min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:${i.ok ? 'var(--text)' : 'var(--amber)'}">${i.label}</div>
          ${!i.ok && i.fix ? `<div style="font-size:.75rem;color:var(--muted);margin-top:2px">${i.fix}</div>` : ''}
        </div>
      </div>`).join('')}
    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="copySecurityRlsSql()">
      📋 Copiar SQL de segurança (RLS)
    </button>`;
}

async function copySecurityRlsSql() {
  try {
    const resp = await fetch('SECURITY_RLS.sql');
    const sql  = await resp.text();
    await navigator.clipboard.writeText(sql);
    toast('✅ SQL copiado! Cole no Supabase SQL Editor.', 'success');
  } catch(e) {
    toast('Não foi possível copiar. Baixe o arquivo SECURITY_RLS.sql manualmente.', 'warning');
  }
}

function saveServiceRoleKey() {
  // SECURITY: Service Role Key must NEVER be stored client-side.
  // Use the admin-reset-password Edge Function instead.
  const stat = document.getElementById('serviceRoleKeyStatus');
  const inp  = document.getElementById('serviceRoleKeyInput');
  if (inp) inp.value = '';
  if (stat) {
    stat.innerHTML = '🚫 Por segurança, a Service Role Key não pode ser salva no navegador. Use a <strong>Edge Function admin-reset-password</strong> — o reset de senha funciona via RPC sem necessidade desta chave.';
    stat.style.color = 'var(--red)';
  }
  // Remove any previously stored key
  localStorage.removeItem('sb_service_key');
  toast('⚠️ Service Role Key não armazenada — veja as instruções abaixo.', 'warning');
}

function clearServiceRoleKey() {
  localStorage.removeItem('sb_service_key');
  const inp  = document.getElementById('serviceRoleKeyInput');
  const stat = document.getElementById('serviceRoleKeyStatus');
  if (inp)  inp.value = '';
  if (stat) { stat.textContent = 'Chave removida — reset de senha usará e-mail de recuperação.'; stat.style.color = 'var(--muted)'; }
  toast('Service Role Key removida', 'info');
  if (typeof initSbAdmin === 'function') initSbAdmin();
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE NOMES — admin only
// Funções: _loadNormalizeNamesInfo, openNormalizeNamesPreview, runNormalizeNames
// ══════════════════════════════════════════════════════════════════════════════

async function _loadNormalizeNamesInfo() {
  const lastRunEl = document.getElementById('normalizeNamesLastRun');
  const hintEl    = document.getElementById('normalizeNamesCronHint');
  try {
    const val = await getAppSetting('normalize_names_last_run', null);
    if (val && typeof val === 'object' && val.ran_at) {
      const d = new Date(val.ran_at);
      const fmt = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
                + ' às '
                + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      if (lastRunEl) {
        lastRunEl.style.display = '';
        lastRunEl.innerHTML =
          `✅ Última execução: <strong>${fmt}</strong> — ` +
          `${val.payees_updated || 0} beneficiário(s) e ${val.cats_updated || 0} categoria(s) normalizados.`;
      }
    }
  } catch {}

  // Check pg_cron availability
  if (hintEl) {
    try {
      const { data } = await sb.rpc('normalize_names_cron_active').catch(() => ({ data: null }));
      hintEl.style.display = data ? 'none' : '';
    } catch { hintEl.style.display = ''; }
  }
}

async function openNormalizeNamesPreview() {
  openModal('normalizeNamesPreviewModal');
  const listEl     = document.getElementById('nnPreviewList');
  const payeeCount = document.getElementById('nnPreviewPayeeCount');
  const catCount   = document.getElementById('nnPreviewCatCount');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando prévia...</div>';

  try {
    const { data, error } = await sb
      .from('normalize_names_preview')
      .select('*')
      .order('tabela')
      .order('nome_atual');
    if (error) throw error;

    const rows   = data || [];
    const payees = rows.filter(r => r.tabela === 'beneficiário');
    const cats   = rows.filter(r => r.tabela === 'categoria');
    if (payeeCount) payeeCount.textContent = payees.length;
    if (catCount)   catCount.textContent   = cats.length;

    if (!rows.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:.85rem">✅ Todos os nomes já estão normalizados!</div>';
      return;
    }

    const rowHtml = r => `
      <div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px;
                  padding:8px 12px;border-bottom:1px solid var(--border2);font-size:.8rem;align-items:center">
        <span style="font-size:.7rem;background:var(--surface2);border-radius:4px;
                     padding:2px 6px;text-align:center;color:var(--muted)">
          ${r.tabela === 'beneficiário' ? '👥' : '🏷️'} ${r.tabela}
        </span>
        <span style="color:var(--muted);text-decoration:line-through;
                     overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(r.nome_atual)}">${esc(r.nome_atual)}</span>
        <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${esc(r.nome_normalizado)}">${esc(r.nome_normalizado)}</span>
      </div>`;

    listEl.innerHTML =
      `<div style="display:grid;grid-template-columns:90px 1fr 1fr;gap:8px;
                   padding:8px 12px;background:var(--surface2);
                   font-size:.7rem;font-weight:700;text-transform:uppercase;
                   letter-spacing:.06em;color:var(--muted)">
         <span>Tipo</span><span>Atual</span><span>Normalizado</span>
       </div>` + rows.map(rowHtml).join('');
  } catch (e) {
    if (listEl) listEl.innerHTML =
      `<div style="padding:16px;background:#fef2f2;border-radius:var(--r-sm);font-size:.82rem;color:#991b1b">
         ❌ Erro: ${esc(e.message)}<br><br>
         Execute <code>migration_normalize_names.sql</code> no Supabase primeiro.
       </div>`;
  }
}

async function runNormalizeNames() {
  if (currentUser?.role !== 'admin') {
    toast('Apenas administradores podem executar esta função.', 'error');
    return;
  }
  const btn = document.getElementById('normalizeNamesRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Executando...'; }
  try {
    const { data, error } = await sb.rpc('run_normalize_names');
    if (error) {
      if (error.code === '42883' || error.message?.includes('function')) {
        toast('⚠️ Execute migration_normalize_names.sql no Supabase primeiro.', 'warning');
        return;
      }
      throw error;
    }
    const p = data?.payees_updated || 0;
    const c = data?.cats_updated   || 0;
    const total = p + c;
    if (total === 0) {
      toast('✅ Todos os nomes já estão normalizados!', 'success');
    } else {
      toast(`✅ ${total} nome(s) normalizado(s): ${p} beneficiário(s), ${c} categoria(s).`, 'success');
    }
    await _loadNormalizeNamesInfo();
    if (typeof loadPayees     === 'function') await loadPayees().catch(()=>{});
    if (typeof loadCategories === 'function') await loadCategories().catch(()=>{});
    if (typeof populateSelects === 'function') populateSelects();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Executar agora'; }
  }
}

/* ══════════════════════════════════════════════════════════════════
   TELEMETRY DASHBOARD  (admin only)
   Página completa: abas Visão Geral / Usuários / Famílias
   Filtros: período + família + usuário (interligados)
══════════════════════════════════════════════════════════════════ */

// ── Estado interno do dashboard ───────────────────────────────────────────────
const _telDash = {
  rawRows:    [],          // todos os rows do período (sem filtro)
  filtered:   [],          // rows após aplicar filtros de família/usuário
  allUsers:   [],          // [{id, name, email}] de app_users
  allFams:    [],          // [{id, name}] de families
  userSort:   { col: 'events', dir: 'desc' },
  famSort:    { col: 'events', dir: 'desc' },
  activeTab:  'overview',
  charts:     { daily: null, pages: null },
};

// ── Entry point chamado pelo navigate() ──────────────────────────────────────
async function loadTelemetryDashboard() {
  if (!currentUser?.can_admin) return;
  if (typeof sb === 'undefined' || !sb) return;

  const days   = parseInt(document.getElementById('telPeriod')?.value || '30', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since  = cutoff.toISOString();

  // Loading state
  const kpiEl = document.getElementById('telKpis');
  if (kpiEl) kpiEl.innerHTML = '<div style="grid-column:1/-1" class="tel-empty"><div class="tel-empty-icon" style="animation:tel-shimmer 1.5s infinite">⏳</div><div class="tel-empty-text">Carregando dados…</div></div>';

  // ── COUNT exato + metadados em paralelo ───────────────────────────────────
  const [telCountRes, usersRes, famsRes] = await Promise.all([
    sb.from('app_telemetry')
      .select('*', { count: 'exact', head: true })
      .gte('ts', since),
    sb.from('app_users').select('id,name,email,role').order('name'),
    sb.from('families').select('id,name').order('name'),
  ]);

  const totalReal = telCountRes.count ?? 0;
  _telDash.totalReal = totalReal;

  // Atualiza loading com progresso
  if (kpiEl) kpiEl.innerHTML = `<div style="grid-column:1/-1" class="tel-empty"><div class="tel-empty-icon" style="animation:tel-shimmer 1.5s infinite">⏳</div><div class="tel-empty-text">Carregando ${totalReal.toLocaleString('pt-BR')} eventos…</div></div>`;

  // ── Busca TODOS os eventos via paginação (Supabase limita 1000/request) ───
  const PAGE_SIZE = 1000;
  const allRows = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    const { data, error } = await sb
      .from('app_telemetry')
      .select('event_type,page,ts,user_id,family_id,device_type,device_browser,device_os,payload')
      .gte('ts', since)
      .order('ts', { ascending: false })
      .range(from, to);

    if (error) {
      if (kpiEl) kpiEl.innerHTML = `<div style="grid-column:1/-1;color:var(--danger);font-size:.82rem;padding:8px">Erro: ${error.message}</div>`;
      return;
    }

    if (data && data.length > 0) {
      allRows.push(...data);
      hasMore = data.length === PAGE_SIZE; // se retornou menos que PAGE_SIZE, acabou
    } else {
      hasMore = false;
    }

    page++;

    // Atualiza progresso visualmente a cada página
    if (hasMore && kpiEl) {
      kpiEl.innerHTML = `<div style="grid-column:1/-1" class="tel-empty"><div class="tel-empty-icon" style="animation:tel-shimmer 1.5s infinite">⏳</div><div class="tel-empty-text">Carregando… ${allRows.length.toLocaleString('pt-BR')} / ${totalReal.toLocaleString('pt-BR')} eventos</div></div>`;
    }
  }

  _telDash.rawRows  = allRows;
  _telDash.allUsers = usersRes.data || [];
  _telDash.allFams  = famsRes.data  || [];

  // ── Popular selects de filtro ─────────────────────────────────────────────
  _telPopulateFilterSelects();

  // ── Aplicar filtros e renderizar ──────────────────────────────────────────
  _telApplyFilters();
}
window.loadTelemetryDashboard = loadTelemetryDashboard;

// ── Popula os selects de família e usuário com os dados reais ─────────────────
function _telPopulateFilterSelects() {
  const _esc = s => String(s||'').replace(/</g,'&lt;');

  // Famílias presentes nos dados + lista completa
  const famsInData = new Set(_telDash.rawRows.filter(r => r.family_id).map(r => r.family_id));
  const famSel = document.getElementById('telFilterFamily');
  if (famSel) {
    famSel.innerHTML = '<option value="">Todas as famílias</option>' +
      _telDash.allFams
        .filter(f => famsInData.has(f.id))
        .map(f => `<option value="${f.id}">${_esc(f.name)}</option>`)
        .join('');
  }

  // Usuários presentes nos dados
  const usersInData = new Set(_telDash.rawRows.filter(r => r.user_id).map(r => r.user_id));
  const userSel = document.getElementById('telFilterUser');
  if (userSel) {
    // Build name from events for users not found in app_users
    const evtUserMap = _telBuildUserMap(_telDash.rawRows);
    const knownIds = new Set(_telDash.allUsers.map(u => u.id));
    const extraUsers = [...usersInData]
      .filter(uid => !knownIds.has(uid))
      .map(uid => ({ id: uid, name: evtUserMap[uid]?._name || null, email: evtUserMap[uid]?._email || null }))
      .filter(u => u.name || u.email);
    const allUsersForFilter = [
      ..._telDash.allUsers.filter(u => usersInData.has(u.id)),
      ...extraUsers,
    ];
    userSel.innerHTML = '<option value="">Todos os usuários</option>' +
      allUsersForFilter
        .map(u => `<option value="${u.id}">${_esc(u.name || u.email || u.id.slice(0,8))}</option>`)
        .join('');
  }
}

// ── Aplica filtros e re-renderiza tudo ────────────────────────────────────────
function _telApplyFilters() {
  const famFilter  = document.getElementById('telFilterFamily')?.value  || '';
  const userFilter = document.getElementById('telFilterUser')?.value    || '';

  // Filtrar usuários disponíveis baseado na família selecionada
  if (famFilter) {
    const usersInFam = new Set(
      _telDash.rawRows.filter(r => r.family_id === famFilter && r.user_id).map(r => r.user_id)
    );
    const userSel = document.getElementById('telFilterUser');
    if (userSel) {
      const cur = userSel.value;
      userSel.innerHTML = '<option value="">Todos os usuários</option>' +
        _telDash.allUsers
          .filter(u => usersInFam.has(u.id))
          .map(u => `<option value="${u.id}">${u.name || u.email}</option>`)
          .join('');
      if (cur && usersInFam.has(cur)) userSel.value = cur;
    }
  } else {
    _telPopulateFilterSelects();
    const userSel = document.getElementById('telFilterUser');
    if (userSel && userFilter) userSel.value = userFilter;
  }

  // Aplicar filtros aos dados
  _telDash.filtered = _telDash.rawRows.filter(r => {
    if (famFilter  && r.family_id !== famFilter)  return false;
    if (userFilter && r.user_id   !== userFilter) return false;
    return true;
  });

  // Re-renderizar aba ativa
  _telRenderCurrentTab();
}
window._telApplyFilters = _telApplyFilters;

// ── Controle de abas ──────────────────────────────────────────────────────────
function _telSetTab(tab) {
  _telDash.activeTab = tab;
  ['overview','users','families','landing'].forEach(t => {
    const pane = document.getElementById('telPane_' + t);
    const btn  = document.getElementById('telTab_'  + t);
    if (!pane || !btn) return;
    const active = t === tab;
    pane.style.display = active ? '' : 'none';
    btn.classList.toggle('active', active);
  });
  _telRenderCurrentTab();
}
window._telSetTab = _telSetTab;

function _telRenderCurrentTab() {
  const rows = _telDash.filtered;
  if (!rows) return;
  const days = parseInt(document.getElementById('telPeriod')?.value || '30', 10);

  if (_telDash.activeTab === 'overview') {
    if (!rows.length) { _telRenderEmpty(); return; }
    _telRenderKpis(rows, days, _telDash.totalReal);
    _telRenderDailyChart(rows, days);
    _telRenderPagesChart(rows);
    _telRenderEventTypes(rows);
    _telRenderDevices(rows);
    _telRenderErrors(rows);
    _telRenderAiCalls(rows);
  } else if (_telDash.activeTab === 'users') {
    _telRenderUsersTable(rows);
  } else if (_telDash.activeTab === 'families') {
    _telRenderFamiliesTable(rows);
  } else if (_telDash.activeTab === 'landing') {
    _telRenderLandingTab(rows);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const _telEsc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const _telFamName   = id => _telDash.allFams.find(f => f.id === id)?.name || '—';
// _telUserName/_telUserEmail: lookup by app_users.id first, then fall back to data embedded in events
const _telUserName  = (id, evtMap) => {
  const u = _telDash.allUsers.find(u => u.id === id);
  if (u) return u.name || u.email || '—';
  const em = evtMap ? evtMap[id] : null;
  return em?._name || em?._email || '—';
};
const _telUserEmail = (id, evtMap) => {
  const u = _telDash.allUsers.find(u => u.id === id);
  if (u) return u.email || '';
  const em = evtMap ? evtMap[id] : null;
  return em?._email || '';
};

function _telRenderEmpty() {
  const kpi = document.getElementById('telKpis');
  if (kpi) kpi.innerHTML = `<div class="tel-empty" style="grid-column:1/-1">
    <div class="tel-empty-icon">📭</div>
    <div class="tel-empty-text">Nenhum dado encontrado para os filtros selecionados.</div>
  </div>`;
  ['telEventTypes','telDevices','telErrors','telAiCalls'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">—</div>';
  });
}

// ── KPI cards ─────────────────────────────────────────────────────────────────
function _telRenderKpis(rows, days, totalReal) {
  const total     = totalReal ?? rows.length;
  const users     = new Set(rows.filter(r => r.user_id).map(r => r.user_id)).size;
  const families  = new Set(rows.filter(r => r.family_id).map(r => r.family_id)).size;
  const errors    = rows.filter(r => r.event_type === 'error' || r.event_type === 'uncaught').length;
  const aiCalls   = rows.filter(r => r.event_type === 'ai_call').length;
  const pageViews = rows.filter(r => r.event_type === 'page_view').length;
  const perDay    = days > 0 ? (total / days).toFixed(1) : '—';

  const kpiEl = document.getElementById('telKpis');
  if (!kpiEl) return;

  kpiEl.innerHTML = [
    { v: total.toLocaleString('pt-BR'),     lb: 'Total eventos',   icon: '📊' },
    { v: pageViews.toLocaleString('pt-BR'), lb: 'Page views',      icon: '👁️' },
    { v: users.toLocaleString('pt-BR'),     lb: 'Usuários únicos', icon: '👤' },
    { v: families.toLocaleString('pt-BR'),  lb: 'Famílias ativas', icon: '🏠' },
    { v: perDay,                            lb: 'Eventos / dia',   icon: '📈' },
    { v: aiCalls.toLocaleString('pt-BR'),   lb: 'Chamadas IA',     icon: '🤖' },
    { v: errors.toLocaleString('pt-BR'),    lb: 'Erros',           icon: '🔴', danger: errors > 0 },
  ].map(c => `<div class="tel-kpi-card${c.danger ? ' danger' : ''}">
    <span class="tel-kpi-icon">${c.icon}</span>
    <span class="tel-kpi-val${c.danger ? ' danger' : ''}">${c.v}</span>
    <span class="tel-kpi-lbl">${c.lb}</span>
  </div>`).join('');

  // Ocultar aviso de truncamento (não há mais truncamento)
  const warnEl = document.getElementById('telTruncWarn');
  if (warnEl) warnEl.style.display = 'none';
}

// ── Daily chart ───────────────────────────────────────────────────────────────
function _telRenderDailyChart(rows, days) {
  const canvas = document.getElementById('telDailyChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0,10)] = 0;
  }
  rows.forEach(r => { const day = (r.ts||'').slice(0,10); if (day in buckets) buckets[day]++; });

  const labels = Object.keys(buckets).map(d => { const [,m,dd] = d.split('-'); return `${dd}/${m}`; });
  const values = Object.values(buckets);
  const maxVal = Math.max(...values, 1);

  if (_telDash.charts.daily) { _telDash.charts.daily.destroy(); _telDash.charts.daily = null; }
  _telDash.charts.daily = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: values.map(v => `rgba(31,107,79,${0.3 + 0.6*(v/maxVal)})`),
        borderColor: 'rgba(31,107,79,.8)',
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: t => t[0].label, label: t => `${t.raw} eventos` } } },
      scales: {
        x: { ticks: { font: { size: 9 }, maxTicksLimit: days > 30 ? 10 : 15, color: '#888' }, grid: { display: false } },
        y: { ticks: { font: { size: 9 }, color: '#888' }, grid: { color: 'rgba(128,128,128,.08)' }, beginAtZero: true },
      }
    }
  });
}

// ── Pages chart ───────────────────────────────────────────────────────────────
function _telRenderPagesChart(rows) {
  const canvas = document.getElementById('telPagesChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const counts = {};
  rows.filter(r => r.event_type === 'page_view' && r.page)
      .forEach(r => { counts[r.page] = (counts[r.page]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  if (!sorted.length) { canvas.parentElement.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:20px 0;text-align:center">—</div>'; return; }

  const palette = ['rgba(99,102,241,.7)','rgba(59,130,246,.7)','rgba(16,185,129,.7)','rgba(245,158,11,.7)','rgba(239,68,68,.7)','rgba(139,92,246,.7)','rgba(20,184,166,.7)','rgba(249,115,22,.7)'];
  if (_telDash.charts.pages) { _telDash.charts.pages.destroy(); _telDash.charts.pages = null; }
  _telDash.charts.pages = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: sorted.map(([k])=>k), datasets: [{ data: sorted.map(([,v])=>v), backgroundColor: palette, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, boxWidth: 10, padding: 6, color: '#888' } } } }
  });
}

// ── Event types ───────────────────────────────────────────────────────────────
function _telRenderEventTypes(rows) {
  const el = document.getElementById('telEventTypes'); if (!el) return;
  const counts = {}; rows.forEach(r => { counts[r.event_type||'unknown'] = (counts[r.event_type||'unknown']||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const total = rows.length;
  const LABELS = { page_view:'📄 Page view', page_time:'⏱️ Tempo em tela', operation:'⚙️ Operação', error:'🔴 Erro', ai_call:'🤖 IA', metric:'📐 Métrica', toast:'💬 Toast', uncaught:'💥 Erro não capturado' };
  const COLORS = { page_view:'var(--accent)', page_time:'#3b82f6', operation:'#f59e0b', error:'#ef4444', ai_call:'#8b5cf6', metric:'#14b8a6', toast:'#6b7280', uncaught:'#dc2626' };
  el.innerHTML = sorted.map(([type, count]) => {
    const pct = ((count/total)*100).toFixed(1);
    const color = COLORS[type] || 'var(--accent)';
    return `<div class="tel-bar-row">
      <span class="tel-bar-label">${LABELS[type]||type}</span>
      <div class="tel-bar-track"><div class="tel-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="tel-bar-val">${count.toLocaleString('pt-BR')}</span>
      <span class="tel-bar-pct">${pct}%</span>
    </div>`;
  }).join('');
}

// ── Devices ───────────────────────────────────────────────────────────────────
function _telRenderDevices(rows) {
  const el = document.getElementById('telDevices'); if (!el) return;
  const byType={}, byBrowser={}, byOs={};
  rows.forEach(r => {
    if (r.device_type)    byType[r.device_type]       = (byType[r.device_type]||0)+1;
    if (r.device_browser) byBrowser[r.device_browser] = (byBrowser[r.device_browser]||0)+1;
    if (r.device_os)      byOs[r.device_os]           = (byOs[r.device_os]||0)+1;
  });
  const total = rows.length;
  const rg = (title, map) => {
    const s = Object.entries(map).sort((a,b)=>b[1]-a[1]);
    if (!s.length) return '';
    return `<div class="tel-device-group-title">${title}</div>` +
      s.map(([k,v]) => { const p=((v/total)*100).toFixed(1);
        return `<div class="tel-bar-row">
          <span class="tel-bar-label">${k}</span>
          <div class="tel-bar-track"><div class="tel-bar-fill" style="width:${p}%"></div></div>
          <span class="tel-bar-pct">${p}%</span>
        </div>`;
      }).join('');
  };
  el.innerHTML = rg('Tipo', byType) + rg('Navegador', byBrowser) + rg('Sistema', byOs);
}

// ── Recent errors ─────────────────────────────────────────────────────────────
function _telRenderErrors(rows) {
  const el = document.getElementById('telErrors'); if (!el) return;
  const errors = rows.filter(r => r.event_type === 'error' || r.event_type === 'uncaught' || r.event_type === 'unhandled_promise').slice(0, 30);
  if (!errors.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">✅ Nenhum erro no período</div>'; return; }

  const _evtMap = _telBuildUserMap(rows);

  el.innerHTML = `<div class="tel-error-list">
    ${errors.map((r, i) => {
      const d   = (r.ts||'').slice(0,16).replace('T',' ');
      const usr = r.user_id ? _telUserName(r.user_id, _evtMap) : '—';
      const email = r.user_id ? _telUserEmail(r.user_id) : '';
      const msg = r.payload?.message || r.payload?.source || r.payload?.error_msg || '';
      const file = r.payload?.file ? ` @ ${r.payload.file}` : '';
      const line = r.payload?.line ? `:${r.payload.line}` : '';
      const shortMsg = msg.slice(0, 90) + (msg.length > 90 ? '…' : '');
      const fullPayload = JSON.stringify(r.payload || {}, null, 2);
      // Build the Claude prompt for this error
      const claudePrompt = `Encontrei este erro no app FintTrack:

**Tipo:** ${r.event_type}
**Data:** ${d}
**Usuário:** ${usr}${email ? ` (${email})` : ''}
**Página:** ${r.page || '—'}

**Mensagem:** ${msg || '—'}
**Arquivo:** ${r.payload?.file || '—'}${line}

**Payload completo:**
\`\`\`json
${fullPayload}
\`\`\`

Por favor, analise o erro e sugira a correção.`;

      return `<div class="tel-error-item" id="telErr-${i}">
        <div class="tel-error-header" onclick="_telToggleError(${i})">
          <div class="tel-error-main">
            <span class="tel-error-type">${_telEsc(r.event_type)}</span>
            <span class="tel-error-msg" title="${_telEsc(msg)}">${_telEsc(shortMsg || '(sem mensagem)')}</span>
          </div>
          <div class="tel-error-meta">
            <span class="tel-error-date">${d}</span>
            <span class="tel-error-user" title="${_telEsc(email)}">${_telEsc(usr)}</span>
            <span class="tel-error-toggle" id="telErrArrow-${i}">▼</span>
          </div>
        </div>
        <div class="tel-error-detail" id="telErrDetail-${i}" style="display:none">
          <div class="tel-error-detail-grid">
            <div><span class="tel-error-dl">Página</span><span class="tel-error-dd">${_telEsc(r.page || '—')}</span></div>
            <div><span class="tel-error-dl">Arquivo</span><span class="tel-error-dd">${_telEsc((r.payload?.file||'—') + line)}</span></div>
            <div><span class="tel-error-dl">Dispositivo</span><span class="tel-error-dd">${_telEsc([r.device_type, r.device_os, r.device_browser].filter(Boolean).join(' / ') || '—')}</span></div>
            <div><span class="tel-error-dl">Sessão</span><span class="tel-error-dd" style="font-family:monospace;font-size:.7rem">${_telEsc(r.session_id?.slice(0,12)||'—')}</span></div>
          </div>
          <div class="tel-error-payload-label">Payload completo:</div>
          <pre class="tel-error-payload">${_telEsc(fullPayload)}</pre>
          <div class="tel-error-actions">
            <button class="tel-copy-btn" onclick="event.stopPropagation();_telCopyErrorToClipboard(${i})" data-payload="${_telEsc(claudePrompt).replace(/"/g,'&quot;')}">
              📋 Copiar para o Claude
            </button>
            <span class="tel-copy-confirm" id="telCopyOk-${i}" style="display:none;color:var(--green);font-size:.75rem">✓ Copiado!</span>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function _telToggleError(i) {
  const detail = document.getElementById('telErrDetail-' + i);
  const arrow  = document.getElementById('telErrArrow-' + i);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  detail.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}

function _telCopyErrorToClipboard(i) {
  const btn = document.querySelector(`#telErr-${i} .tel-copy-btn`);
  const payload = btn?.getAttribute('data-payload') || '';
  // Decode HTML entities
  const decoded = payload.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  navigator.clipboard.writeText(decoded).then(() => {
    const ok = document.getElementById('telCopyOk-' + i);
    if (ok) { ok.style.display = 'inline'; setTimeout(() => { ok.style.display = 'none'; }, 2500); }
  }).catch(() => {
    // Fallback: select text
    const pre = document.querySelector(`#telErr-${i} .tel-error-payload`);
    if (pre) {
      const range = document.createRange();
      range.selectNode(pre);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });
}

// ── AI calls ──────────────────────────────────────────────────────────────────
function _telRenderAiCalls(rows) {
  const el = document.getElementById('telAiCalls'); if (!el) return;
  const ai = rows.filter(r => r.event_type === 'ai_call');
  if (!ai.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.78rem;padding:4px 0">Nenhuma chamada de IA registrada</div>'; return; }
  const byFeature = {};
  let totalIn=0, totalOut=0, totalMs=0, errors=0;
  ai.forEach(r => {
    const f = r.payload?.feature || 'desconhecida';
    if (!byFeature[f]) byFeature[f] = { count:0, tokensIn:0, tokensOut:0, errors:0 };
    byFeature[f].count++;
    byFeature[f].tokensIn  += r.payload?.tokens_in  || 0;
    byFeature[f].tokensOut += r.payload?.tokens_out || 0;
    if (r.payload?.success === false) { byFeature[f].errors++; errors++; }
    totalIn  += r.payload?.tokens_in  || 0;
    totalOut += r.payload?.tokens_out || 0;
    totalMs  += r.payload?.latency_ms || 0;
  });
  const avgMs = ai.length ? Math.round(totalMs/ai.length) : 0;
  el.innerHTML = `
    <div class="tel-ai-grid">
      <div class="tel-ai-stat">
        <span class="tel-ai-stat-val">${ai.length.toLocaleString('pt-BR')}</span>
        <span class="tel-ai-stat-lbl">Total chamadas</span>
      </div>
      <div class="tel-ai-stat">
        <span class="tel-ai-stat-val">${(totalIn+totalOut).toLocaleString('pt-BR')}</span>
        <span class="tel-ai-stat-lbl">Tokens totais</span>
      </div>
      <div class="tel-ai-stat">
        <span class="tel-ai-stat-val">${avgMs}ms</span>
        <span class="tel-ai-stat-lbl">Latência média</span>
      </div>
      <div class="tel-ai-stat">
        <span class="tel-ai-stat-val" style="${errors>0?'color:#ef4444':''}">${errors}</span>
        <span class="tel-ai-stat-lbl">Erros</span>
      </div>
    </div>
    <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border)">
      <table style="width:100%;border-collapse:collapse;font-size:.79rem">
        <thead>
          <tr style="background:var(--surface2)">
            <th style="padding:8px 10px;text-align:left;font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Feature</th>
            <th style="padding:8px 10px;text-align:right;font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Calls</th>
            <th style="padding:8px 10px;text-align:right;font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Tokens ↑</th>
            <th style="padding:8px 10px;text-align:right;font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Tokens ↓</th>
            <th style="padding:8px 10px;text-align:right;font-size:.67rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Erros</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(byFeature).sort((a,b)=>b[1].count-a[1].count).map(([f,s]) =>
            `<tr style="border-top:1px solid var(--border)">
              <td style="padding:8px 10px;color:var(--text);font-weight:500">${f}</td>
              <td style="padding:8px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums">${s.count}</td>
              <td style="padding:8px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums">${s.tokensIn.toLocaleString('pt-BR')}</td>
              <td style="padding:8px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums">${s.tokensOut.toLocaleString('pt-BR')}</td>
              <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;${s.errors>0?'color:#ef4444;font-weight:700':'color:var(--muted)'}">${s.errors||'—'}</td>
            </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   ABA USUÁRIOS
══════════════════════════════════════════════════════════════════ */

// Constrói o mapa de dados por usuário a partir dos rows filtrados
function _telBuildUserMap(rows) {
  const map = {};
  rows.forEach(r => {
    const uid = r.user_id; if (!uid) return;
    if (!map[uid]) map[uid] = { events:0, pages:0, errors:0, ai:0, ops:0, sessions:new Set(), lastSeen:r.ts, family_id:r.family_id, pageCount:{}, opCount:{}, _name:null, _email:null };
    map[uid].events++;
    // Capture name/email from payload._u (stored since telemetry v2)
    if (!map[uid]._name  && r.payload?._u?.name)  map[uid]._name  = r.payload._u.name;
    if (!map[uid]._email && r.payload?._u?.email) map[uid]._email = r.payload._u.email;
    if (r.event_type === 'page_view')               { map[uid].pages++; map[uid].pageCount[r.page||'?'] = (map[uid].pageCount[r.page||'?']||0)+1; }
    if (r.event_type === 'error' || r.event_type === 'uncaught') map[uid].errors++;
    if (r.event_type === 'ai_call')                 map[uid].ai++;
    if (r.event_type === 'operation')               { map[uid].ops++; const op = r.payload?.operation||'?'; map[uid].opCount[op] = (map[uid].opCount[op]||0)+1; }
    if ((r.ts||'') > (map[uid].lastSeen||''))        map[uid].lastSeen = r.ts;
    // session heuristic: user_id + day
    map[uid].sessions.add(uid + (r.ts||'').slice(0,10));
  });
  return map;
}

function _telRenderUsersTable(rows) {
  const body = document.getElementById('telUsersBody'); if (!body) return;
  const map = _telBuildUserMap(rows);
  let entries = Object.entries(map).map(([id, s]) => ({ id, ...s, sessions: s.sessions.size, name: _telUserName(id, map), email: _telUserEmail(id, map), famName: _telFamName(s.family_id) }));

  // Sort
  const { col, dir } = _telDash.userSort;
  const colMap = { name:'name', family:'famName', events:'events', sessions:'sessions', pages:'pages', errors:'errors', last:'lastSeen' };
  entries.sort((a, b) => {
    const av = a[colMap[col]||col] || 0, bv = b[colMap[col]||col] || 0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (bv - av);
    return dir === 'desc' ? cmp : -cmp;
  });

  if (!entries.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Nenhum dado para os filtros selecionados</td></tr>'; return; }

  body.innerHTML = entries.map(u => `
    <tr onclick="_telOpenUserDetail('${u.id}')">
      <td style="padding:9px 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="tel-avatar" style="width:28px;height:28px;font-size:.75rem">${(_telEsc(u.name)||'?')[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:.82rem;color:var(--text)">${_telEsc(u.name)}</div>
            <div style="font-size:.71rem;color:var(--muted)">${_telEsc(u.email)}</div>
          </div>
        </div>
      </td>
      <td style="padding:9px 10px;color:var(--muted);font-size:.8rem" class="tel-hide-xs">${_telEsc(u.famName)}</td>
      <td style="padding:9px 10px;text-align:right;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${u.events.toLocaleString('pt-BR')}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums" class="tel-hide-sm">${u.pages}</td>
      <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums">${u.errors>0?`<span class="tel-badge-danger">${u.errors}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap" class="tel-hide-sm">${(u.lastSeen||'').slice(0,10)}</td>
    </tr>`).join('');
}

function _telSortUsers(col) {
  if (_telDash.userSort.col === col) {
    _telDash.userSort.dir = _telDash.userSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _telDash.userSort = { col, dir: 'desc' };
  }
  // Update sort indicators
  ['name','family','events','sessions','pages','errors','last'].forEach(c => {
    const el = document.getElementById('telUserSort_' + c);
    if (!el) return;
    el.textContent = c === col ? (_telDash.userSort.dir === 'desc' ? '↓' : '↑') : '';
  });
  _telRenderUsersTable(_telDash.filtered);
}
window._telSortUsers = _telSortUsers;

function _telFilterUsersTable(q) {
  const body = document.getElementById('telUsersBody'); if (!body) return;
  const rows = body.querySelectorAll('tr');
  const lq = q.toLowerCase();
  rows.forEach(r => {
    r.style.display = (!lq || r.textContent.toLowerCase().includes(lq)) ? '' : 'none';
  });
}
window._telFilterUsersTable = _telFilterUsersTable;

function _telOpenUserDetail(uid) {
  const map = _telBuildUserMap(_telDash.filtered);
  const u = map[uid]; if (!u) return;

  const name  = _telUserName(uid, map);
  const email = _telUserEmail(uid, map);

  document.getElementById('telUserDetailAvatar').textContent = (name||'?')[0].toUpperCase();
  document.getElementById('telUserDetailName').textContent   = name;
  document.getElementById('telUserDetailMeta').textContent   = email + (u.family_id ? ' · ' + _telFamName(u.family_id) : '');

  document.getElementById('telUserDetailKpis').innerHTML = [
    { v: u.events,                   lb: 'Eventos',     icon: '📊' },
    { v: u.sessions.size||u.sessions, lb: 'Sessões',    icon: '🔁' },
    { v: u.pages,                    lb: 'Page views',  icon: '👁️' },
    { v: u.ai,                       lb: 'Chamadas IA', icon: '🤖' },
    { v: u.errors,                   lb: 'Erros',       icon: '🔴', danger: u.errors > 0 },
  ].map(c => `<div class="tel-kpi-card${c.danger?' danger':''}">
    <span class="tel-kpi-icon">${c.icon}</span>
    <span class="tel-kpi-val${c.danger?' danger':''}">${typeof c.v==='number'?c.v.toLocaleString('pt-BR'):c.v}</span>
    <span class="tel-kpi-lbl">${c.lb}</span>
  </div>`).join('');

  // Pages
  const pages = Object.entries(u.pageCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telUserDetailPages').innerHTML = pages.length
    ? pages.map(([p,cnt]) => `<div class="tel-detail-row"><span style="color:var(--text)">${_telEsc(p)}</span><span style="color:var(--muted);font-size:.78rem">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  // Ops
  const ops = Object.entries(u.opCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telUserDetailOps').innerHTML = ops.length
    ? ops.map(([op,cnt]) => `<div class="tel-detail-row"><span style="color:var(--text)">${_telEsc(op)}</span><span style="color:var(--muted);font-size:.78rem">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  document.getElementById('telUserDetail').style.display = '';
  document.getElementById('telUserDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window._telOpenUserDetail = _telOpenUserDetail;

function _telCloseUserDetail() { document.getElementById('telUserDetail').style.display = 'none'; }
window._telCloseUserDetail = _telCloseUserDetail;

/* ══════════════════════════════════════════════════════════════════
   ABA FAMÍLIAS
══════════════════════════════════════════════════════════════════ */

function _telBuildFamMap(rows) {
  const map = {};
  rows.forEach(r => {
    const fid = r.family_id; if (!fid) return;
    if (!map[fid]) map[fid] = { events:0, pages:0, errors:0, ai:0, users:new Set(), lastSeen:r.ts, pageCount:{} };
    map[fid].events++;
    if (r.event_type === 'page_view')                { map[fid].pages++; map[fid].pageCount[r.page||'?'] = (map[fid].pageCount[r.page||'?']||0)+1; }
    if (r.event_type === 'error' || r.event_type === 'uncaught') map[fid].errors++;
    if (r.event_type === 'ai_call')                  map[fid].ai++;
    if (r.user_id) map[fid].users.add(r.user_id);
    if ((r.ts||'') > (map[fid].lastSeen||''))         map[fid].lastSeen = r.ts;
  });
  return map;
}

function _telRenderFamiliesTable(rows) {
  const body = document.getElementById('telFamiliesBody'); if (!body) return;
  const map = _telBuildFamMap(rows);
  let entries = Object.entries(map).map(([id, s]) => ({ id, ...s, users: s.users.size, name: _telFamName(id) }));

  const { col, dir } = _telDash.famSort;
  const colMap = { name:'name', events:'events', users:'users', pages:'pages', errors:'errors', ai:'ai', last:'lastSeen' };
  entries.sort((a,b) => {
    const av = a[colMap[col]||col]||0, bv = b[colMap[col]||col]||0;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : (bv-av);
    return dir === 'desc' ? cmp : -cmp;
  });

  if (!entries.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">Nenhum dado para os filtros selecionados</td></tr>'; return; }

  body.innerHTML = entries.map(f => `
    <tr onclick="_telOpenFamilyDetail('${f.id}')">
      <td style="padding:9px 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="tel-avatar" style="width:28px;height:28px;font-size:.8rem">🏠</div>
          <span style="font-weight:600;font-size:.83rem;color:var(--text)">${_telEsc(f.name)}</span>
        </div>
      </td>
      <td style="padding:9px 10px;text-align:right;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${f.events.toLocaleString('pt-BR')}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums" class="tel-hide-sm">${f.users}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums" class="tel-hide-sm">${f.pages.toLocaleString('pt-BR')}</td>
      <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums">${f.errors>0?`<span class="tel-badge-danger">${f.errors}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted)" class="tel-hide-sm">${f.ai||'—'}</td>
      <td style="padding:9px 10px;text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap" class="tel-hide-xs">${(f.lastSeen||'').slice(0,10)}</td>
    </tr>`).join('');
}

function _telSortFamilies(col) {
  if (_telDash.famSort.col === col) {
    _telDash.famSort.dir = _telDash.famSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _telDash.famSort = { col, dir: 'desc' };
  }
  ['name','events','users','pages','errors','ai','last'].forEach(c => {
    const el = document.getElementById('telFamSort_' + c);
    if (!el) return;
    el.textContent = c === col ? (_telDash.famSort.dir === 'desc' ? '↓' : '↑') : '';
  });
  _telRenderFamiliesTable(_telDash.filtered);
}
window._telSortFamilies = _telSortFamilies;

function _telFilterFamiliesTable(q) {
  const body = document.getElementById('telFamiliesBody'); if (!body) return;
  const lq = q.toLowerCase();
  body.querySelectorAll('tr').forEach(r => { r.style.display = (!lq || r.textContent.toLowerCase().includes(lq)) ? '' : 'none'; });
}
window._telFilterFamiliesTable = _telFilterFamiliesTable;

function _telOpenFamilyDetail(fid) {
  const map = _telBuildFamMap(_telDash.filtered);
  const f = map[fid]; if (!f) return;

  document.getElementById('telFamilyDetailName').textContent = _telFamName(fid);
  document.getElementById('telFamilyDetailMeta').textContent = `${f.users.size||f.users} usuário(s) ativo(s) no período`;

  document.getElementById('telFamilyDetailKpis').innerHTML = [
    { v: f.events,              lb: 'Eventos',     icon: '📊' },
    { v: f.users.size||f.users, lb: 'Usuários',    icon: '👥' },
    { v: f.pages,               lb: 'Page views',  icon: '👁️' },
    { v: f.ai,                  lb: 'Chamadas IA', icon: '🤖' },
    { v: f.errors,              lb: 'Erros',       icon: '🔴', danger: f.errors > 0 },
  ].map(c => `<div class="tel-kpi-card${c.danger?' danger':''}">
    <span class="tel-kpi-icon">${c.icon}</span>
    <span class="tel-kpi-val${c.danger?' danger':''}">${typeof c.v==='number'?c.v.toLocaleString('pt-BR'):c.v}</span>
    <span class="tel-kpi-lbl">${c.lb}</span>
  </div>`).join('');

  // Usuários ativos
  const famRows = _telDash.filtered.filter(r => r.family_id === fid && r.user_id);
  const userCounts = {};
  famRows.forEach(r => { userCounts[r.user_id] = (userCounts[r.user_id]||0)+1; });
  const topUsers = Object.entries(userCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telFamilyDetailUsers').innerHTML = topUsers.length
    ? topUsers.map(([uid, cnt]) => `<div class="tel-detail-row">
        <span style="color:var(--text)">${_telEsc(_telUserName(uid, map))}</span>
        <span style="color:var(--muted);font-size:.78rem">${cnt} eventos</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  // Páginas
  const pages = Object.entries(f.pageCount).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('telFamilyDetailPages').innerHTML = pages.length
    ? pages.map(([p,cnt]) => `<div class="tel-detail-row"><span style="color:var(--text)">${_telEsc(p)}</span><span style="color:var(--muted);font-size:.78rem">${cnt}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:.78rem">—</div>';

  document.getElementById('telFamilyDetail').style.display = '';
  document.getElementById('telFamilyDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window._telOpenFamilyDetail = _telOpenFamilyDetail;

function _telCloseFamilyDetail() { document.getElementById('telFamilyDetail').style.display = 'none'; }
window._telCloseFamilyDetail = _telCloseFamilyDetail;


// === PERIODICITY COLORS ===
function getPeriodColor(period) {
  switch((period||'').toLowerCase()) {
    case 'daily': return '#2ecc71';
    case 'weekly': return '#3498db';
    case 'monthly': return '#f39c12';
    case 'yearly': return '#9b59b6';
    default: return '#1F6B4F';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   TELEMETRIA — Exclusão de registros
   ══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   TELEMETRIA — Exclusão de registros (sem confirm() nativo — PWA safe)
   ══════════════════════════════════════════════════════════════════════════ */

window.openTelemetryDeleteModal = function() {
  // Reset para step 1
  _telDelGoStep(1);
  const allRadio = document.getElementById('telDelScopeAll');
  if (allRadio) allRadio.checked = true;
  document.getElementById('telDelPeriodOpts').style.display = 'none';
  document.getElementById('telDelTypeOpts').style.display   = 'none';
  // Highlight "Tudo" como selecionado
  ['All','Period','Type'].forEach(s => {
    const lbl = document.getElementById(`telDelScope${s}_lbl`);
    if (lbl) lbl.style.borderColor = s === 'All' ? 'var(--accent)' : 'var(--border)';
  });
  openModal('telDeleteModal');
  // Calcula preview após abrir
  _telDelUpdatePreview();
};

function _telDelGoStep(n) {
  [1,2,3].forEach(i => {
    const el = document.getElementById(`telDelStep${i}`);
    if (el) el.style.display = i === n ? 'flex' : 'none';
  });
  // Botão fechar: ocultar durante progresso
  const closeBtn = document.getElementById('telDelCloseBtn');
  if (closeBtn) closeBtn.style.display = n === 3 ? 'none' : '';
}

window._telDelScopeChange = function() {
  const scope = document.querySelector('input[name="telDelScope"]:checked')?.value;
  document.getElementById('telDelPeriodOpts').style.display = scope === 'period' ? '' : 'none';
  document.getElementById('telDelTypeOpts').style.display   = scope === 'type'   ? '' : 'none';
  ['All','Period','Type'].forEach(s => {
    const lbl = document.getElementById(`telDelScope${s}_lbl`);
    if (lbl) lbl.style.borderColor = scope === s.toLowerCase() ? 'var(--accent)' : 'var(--border)';
  });
  _telDelUpdatePreview();
};

window._telDelSetQuick = function(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const dateEl = document.getElementById('telDelBeforeDate');
  if (dateEl) dateEl.value = d.toISOString().slice(0, 10);
  _telDelUpdatePreview();
};

window._telDelUpdatePreview = async function() {
  const scope   = document.querySelector('input[name="telDelScope"]:checked')?.value || 'all';
  const preview = document.getElementById('telDelPreview');
  const btn     = document.getElementById('telDelConfirmBtn');
  if (!preview) return;

  preview.innerHTML = '<span style="color:var(--muted)">⏳ Calculando…</span>';
  if (btn) btn.disabled = true;

  try {
    let query = sb.from('app_telemetry').select('*', { count: 'exact', head: true });
    if (scope === 'period') {
      const before = document.getElementById('telDelBeforeDate')?.value;
      if (!before) {
        preview.innerHTML = '<span style="color:var(--muted)">Selecione uma data.</span>';
        return;
      }
      query = query.lt('ts', before + 'T00:00:00.000Z');
    } else if (scope === 'type') {
      const evType = document.getElementById('telDelEventType')?.value;
      if (evType) query = query.eq('event_type', evType);
    }

    const { count, error } = await query;
    if (error) throw error;

    const n = (count || 0).toLocaleString('pt-BR');
    if (!count || count === 0) {
      preview.innerHTML = '<span style="color:var(--muted)">Nenhum registro encontrado.</span>';
    } else {
      const scopeLabel = scope === 'all'    ? 'todos os registros'
                       : scope === 'period' ? `registros anteriores a <b>${document.getElementById('telDelBeforeDate')?.value}</b>`
                       : `registros do tipo <b>"${document.getElementById('telDelEventType')?.value}"</b>`;
      preview.innerHTML = `<strong style="color:var(--danger,#dc2626);font-size:.9rem">${n}</strong> <span style="color:var(--text)">registro(s)</span> serão excluídos — ${scopeLabel}.`;
      if (btn) btn.disabled = false;
    }
  } catch(e) {
    preview.innerHTML = `<span style="color:var(--danger)">Erro ao calcular: ${e.message}</span>`;
  }
};

window._telDelShowConfirm = function() {
  const scope = document.querySelector('input[name="telDelScope"]:checked')?.value || 'all';
  const confirmText = document.getElementById('telDelConfirmText');
  const preview = document.getElementById('telDelPreview');
  if (confirmText && preview) {
    confirmText.innerHTML = preview.innerHTML;
  }
  // Atualizar texto do botão conforme escopo
  const execBtn = document.getElementById('telDelExecuteBtn');
  if (execBtn) {
    execBtn.textContent = scope === 'all' ? 'Sim, excluir tudo' : 'Sim, confirmar exclusão';
  }
  _telDelGoStep(2);
};

window._telDelBackToStep1 = function() {
  _telDelGoStep(1);
};

// Atualiza o spinner circular e a barra de progresso
function _telDelSetProgress(pct, label, sub) {
  // Círculo: circumference = 2π×42 ≈ 264
  const circumference = 264;
  const offset = circumference - (pct / 100) * circumference;
  const circle = document.getElementById('telDelProgressCircle');
  const pctEl  = document.getElementById('telDelProgressPct');
  const bar    = document.getElementById('telDelProgressBar');
  const lblEl  = document.getElementById('telDelProgressLabel');
  const subEl  = document.getElementById('telDelProgressSub');
  if (circle) circle.style.strokeDashoffset = offset;
  if (pctEl)  pctEl.textContent  = Math.round(pct) + '%';
  if (bar)    bar.style.width    = pct + '%';
  if (label && lblEl) lblEl.textContent = label;
  if (sub   && subEl) subEl.textContent  = sub;
}

window.executeTelemetryDelete = async function() {
  const scope = document.querySelector('input[name="telDelScope"]:checked')?.value || 'all';

  // Vai para step de progresso
  _telDelGoStep(3);
  _telDelSetProgress(0, 'Iniciando exclusão…', 'Aguarde, não feche o app');

  try {
    // Fase 1: contar total para calcular progresso real
    _telDelSetProgress(5, 'Contando registros…', '');
    let countQuery = sb.from('app_telemetry').select('*', { count: 'exact', head: true });
    if (scope === 'period') {
      const before = document.getElementById('telDelBeforeDate')?.value;
      countQuery = countQuery.lt('ts', before + 'T00:00:00.000Z');
    } else if (scope === 'type') {
      const evType = document.getElementById('telDelEventType')?.value;
      countQuery = countQuery.eq('event_type', evType);
    }
    const { count: totalToDelete } = await countQuery;
    const total = totalToDelete || 0;

    _telDelSetProgress(15,
      `Excluindo ${total.toLocaleString('pt-BR')} registros…`,
      'Chamando RPC no banco de dados…'
    );

    // Simula progresso visual durante a chamada RPC (que é atômica)
    // O progresso vai de 15% → 90% durante a espera
    let simPct = 15;
    const simInterval = setInterval(() => {
      simPct = Math.min(simPct + (Math.random() * 8 + 2), 88);
      _telDelSetProgress(simPct,
        `Excluindo ${total.toLocaleString('pt-BR')} registros…`,
        `${Math.round(simPct)}% concluído…`
      );
    }, 400);

    // Fase 2: executar RPC
    const params = { p_scope: scope };
    if (scope === 'period') {
      const before = document.getElementById('telDelBeforeDate')?.value;
      if (!before) throw new Error('Data não selecionada.');
      params.p_before = before + 'T00:00:00.000Z';
    } else if (scope === 'type') {
      const evType = document.getElementById('telDelEventType')?.value;
      if (!evType) throw new Error('Tipo de evento não selecionado.');
      params.p_event_type = evType;
    }

    const { data: deleted, error } = await sb.rpc('delete_telemetry', params);
    clearInterval(simInterval);

    if (error) throw error;

    // Fase 3: concluído
    const n = (deleted || total || 0).toLocaleString('pt-BR');
    _telDelSetProgress(100, `✅ ${n} registro(s) excluído(s)!`, 'Operação concluída com sucesso');

    // Mudar cor do círculo para verde
    const circle = document.getElementById('telDelProgressCircle');
    if (circle) circle.style.stroke = '#16a34a';
    const pctEl = document.getElementById('telDelProgressPct');
    if (pctEl) { pctEl.textContent = '✓'; pctEl.style.color = '#16a34a'; }
    const bar = document.getElementById('telDelProgressBar');
    if (bar) bar.style.background = '#16a34a';

    await new Promise(r => setTimeout(r, 1200));
    closeModal('telDeleteModal');
    toast(`✅ ${n} registro(s) de telemetria excluído(s).`, 'success');
    await loadTelemetryDashboard();

  } catch(e) {
    _telDelSetProgress(0, '❌ Erro ao excluir', e.message);
    const circle = document.getElementById('telDelProgressCircle');
    if (circle) { circle.style.stroke = 'var(--danger,#dc2626)'; circle.style.strokeDashoffset = '264'; }
    await new Promise(r => setTimeout(r, 2000));
    _telDelGoStep(1);
    toast('Erro ao excluir: ' + e.message, 'error');
  }
};

// Listeners para atualização de preview em tempo real
document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('telDelBeforeDate');
  if (dateEl) dateEl.addEventListener('change', window._telDelUpdatePreview);
  const typeEl = document.getElementById('telDelEventType');
  if (typeEl) typeEl.addEventListener('change', window._telDelUpdatePreview);
});

/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURAÇÃO: Exibir link "Solicitar Acesso" na tela de login
══════════════════════════════════════════════════════════════════════════ */

// Carrega o estado do toggle ao abrir settings
async function loadShowAccessRequestSetting() {
  const toggle = document.getElementById('cfgShowAccessRequest');
  if (!toggle) return;
  try {
    const raw = await getAppSetting('show_access_request', 'true');
    const enabled = raw === true || raw === 'true' || raw === 1;
    toggle.checked = enabled;
  } catch(e) {
    toggle.checked = true; // default: mostrar
  }
}

// Salva e aplica imediatamente
window.saveShowAccessRequest = async function(enabled) {
  await saveAppSetting('show_access_request', enabled ? 'true' : 'false');
  // Persist to localStorage so anon users see the correct state before login
  try { localStorage.setItem('ft_show_access_request', enabled ? 'true' : 'false'); } catch(_) {}
  _applyAccessRequestVisibility(enabled);
  toast(enabled ? '✓ Link de acesso ativado' : '✓ Link de acesso ocultado', 'success');
};

function _applyAccessRequestVisibility(enabled) {
  // Hide the entire wrap (button + "Não tem conta?" text) as one unit
  const wrap = document.getElementById('loginRequestAccessWrap');
  if (wrap) { wrap.style.display = enabled ? '' : 'none'; return; }
  // Fallback: hide button + sibling text individually
  const btn = document.getElementById('loginRequestAccessBtn');
  if (btn) btn.style.display = enabled ? '' : 'none';
  const parent = btn?.parentElement;
  if (parent) {
    parent.querySelectorAll('span[data-i18n="auth.no_account"]')
      .forEach(t => { t.style.display = enabled ? '' : 'none'; });
  }
}

// Apply on page load (called by auth.js after settings load)
async function initAccessRequestVisibility() {
  try {
    const raw     = await getAppSetting('show_access_request', 'true');
    const enabled = raw === true || raw === 'true' || raw === 1 || raw === null;
    _applyAccessRequestVisibility(enabled);
  } catch(e) {
    // Default: show
    _applyAccessRequestVisibility(true);
  }
}
window.initAccessRequestVisibility = initAccessRequestVisibility;

/* ══════════════════════════════════════════════════════════════════════════
   TELEMETRIA — Aba Landing Page
══════════════════════════════════════════════════════════════════════════ */
function _telRenderLandingTab(allRows) {
  const el = document.getElementById('telLandingContent');
  if (!el) return;

  // Filter to landing source events only
  const rows = allRows.filter(r =>
    r.page === 'landing' ||
    (r.payload && (r.payload.source === 'landing' || r.payload.page === 'landing'))
  );

  // Also fetch from DB if needed — landing events may not be in current filter window
  // Use allRows for now + also fetch landing-specific from DB
  _telRenderLandingContent(el, rows);
}

async function _telRenderLandingContent(el, cachedRows) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">⏳ Carregando…</div>';

  // Fetch landing events from DB (last 90 days regardless of current period filter)
  let landingRows = cachedRows.filter(r =>
    r.page === 'landing' ||
    (r.payload && r.payload.source === 'landing')
  );

  // Try to load more from DB if we have few cached rows
  if (landingRows.length < 20) {
    try {
      const since90 = new Date(); since90.setDate(since90.getDate() - 90);
      const { data } = await sb.from('app_telemetry')
        .select('event_type,ts,payload,device_type,device_browser')
        .eq('page', 'landing')
        .gte('ts', since90.toISOString())
        .order('ts', { ascending: false })
        .limit(500);
      if (data && data.length > landingRows.length) landingRows = data;
    } catch(e) { /* use cached */ }
  }

  // Also load waitlist stats
  let waitlistStats = { total: 0, pending: 0, invited: 0 };
  try {
    const { data: wl } = await sb.from('waitlist').select('status,created_at,role');
    if (wl) {
      waitlistStats.total   = wl.length;
      waitlistStats.pending = wl.filter(r => r.status === 'pending').length;
      waitlistStats.invited = wl.filter(r => r.status === 'invited').length;
      waitlistStats.roles   = wl.reduce((acc, r) => { acc[r.role] = (acc[r.role]||0)+1; return acc; }, {});
    }
  } catch(e) {}

  const pageViews   = landingRows.filter(r => r.event_type === 'page_view').length;
  const submits     = landingRows.filter(r => r.event_type === 'waitlist_submit').length;
  const invites     = landingRows.filter(r => r.event_type === 'invite_sent').length;
  const scrollRows  = landingRows.filter(r => r.event_type === 'scroll_depth');
  const scroll50    = scrollRows.filter(r => r.payload?.depth >= 50).length;
  const scroll75    = scrollRows.filter(r => r.payload?.depth >= 75).length;
  const convRate    = pageViews > 0 ? ((submits / pageViews) * 100).toFixed(1) : '—';
  const scroll50pct = pageViews > 0 ? ((scroll50 / pageViews) * 100).toFixed(0) : '—';

  // Device breakdown
  const devices = {};
  landingRows.forEach(r => {
    const d = r.device_type || 'unknown';
    devices[d] = (devices[d]||0) + 1;
  });

  // Daily visits (last 14 days)
  const dailyMap = {};
  for (let i=13; i>=0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    dailyMap[d.toISOString().slice(0,10)] = 0;
  }
  landingRows.filter(r => r.event_type === 'page_view').forEach(r => {
    const day = (r.ts||'').slice(0,10);
    if (day in dailyMap) dailyMap[day]++;
  });

  const roleLabels = { family:'Família', couple:'Casal', personal:'Individual', business:'Empreendedor', curious:'Curioso IA' };

  el.innerHTML = `
    <!-- KPI cards -->
    <div class="tel-kpi-grid" style="margin-bottom:20px">
      ${[
        { v: pageViews.toLocaleString('pt-BR'), lb: 'Visitas totais',      icon: '👁️' },
        { v: waitlistStats.total.toLocaleString('pt-BR'), lb: 'Na lista de espera', icon: '📋' },
        { v: waitlistStats.invited.toLocaleString('pt-BR'), lb: 'Convidados',     icon: '✉️' },
        { v: submits.toLocaleString('pt-BR'),  lb: 'Cadastros registrados', icon: '✅' },
        { v: convRate + '%',                   lb: 'Taxa de conversão',     icon: '📈' },
        { v: scroll50pct + '%',                lb: 'Leram 50%+ da página',  icon: '📜' },
        { v: invites.toLocaleString('pt-BR'),  lb: 'Indicações enviadas',   icon: '🔗' },
      ].map(c => `<div class="tel-kpi-card">
        <span class="tel-kpi-icon">${c.icon}</span>
        <span class="tel-kpi-val">${c.v}</span>
        <span class="tel-kpi-lbl">${c.lb}</span>
      </div>`).join('')}
    </div>

    <!-- Dois painéis lado a lado -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">

      <!-- Perfis na lista de espera -->
      <div class="tel-section">
        <div class="tel-section-title"><span class="tel-section-title-dot"></span>Perfis na lista de espera</div>
        ${waitlistStats.total === 0
          ? '<div class="tel-empty"><div class="tel-empty-icon">📋</div><div class="tel-empty-text">Nenhum cadastro ainda</div></div>'
          : Object.entries(waitlistStats.roles || {}).sort((a,b)=>b[1]-a[1]).map(([role, n]) => {
              const pct = ((n / waitlistStats.total) * 100).toFixed(0);
              return `<div class="tel-bar-row">
                <span class="tel-bar-label">${roleLabels[role]||role}</span>
                <div class="tel-bar-track"><div class="tel-bar-fill" style="width:${pct}%"></div></div>
                <span class="tel-bar-val">${n}</span>
              </div>`;
            }).join('')}
      </div>

      <!-- Dispositivos dos visitantes -->
      <div class="tel-section">
        <div class="tel-section-title"><span class="tel-section-title-dot"></span>Dispositivos dos visitantes</div>
        ${Object.keys(devices).length === 0
          ? '<div class="tel-empty"><div class="tel-empty-icon">📱</div><div class="tel-empty-text">Sem dados de dispositivo</div></div>'
          : Object.entries(devices).sort((a,b)=>b[1]-a[1]).map(([dev, n]) => {
              const total = Object.values(devices).reduce((s,v)=>s+v,0);
              const pct = total > 0 ? ((n/total)*100).toFixed(0) : 0;
              const icon = dev==='mobile' ? '📱' : dev==='desktop' ? '🖥️' : '❓';
              return `<div class="tel-bar-row">
                <span class="tel-bar-label">${icon} ${dev}</span>
                <div class="tel-bar-track"><div class="tel-bar-fill" style="width:${pct}%"></div></div>
                <span class="tel-bar-val">${pct}%</span>
              </div>`;
            }).join('')}
      </div>
    </div>

    <!-- Visitas diárias (últimos 14 dias) -->
    <div class="tel-section">
      <div class="tel-section-title"><span class="tel-section-title-dot"></span>Visitas à landing — últimos 14 dias</div>
      ${Object.values(dailyMap).every(v=>v===0)
        ? '<div class="tel-empty"><div class="tel-empty-icon">📊</div><div class="tel-empty-text">Nenhuma visita registrada no período</div></div>'
        : `<div style="display:flex;align-items:flex-end;gap:4px;height:80px;padding:8px 0">
            ${Object.entries(dailyMap).map(([day, count]) => {
              const maxV = Math.max(...Object.values(dailyMap), 1);
              const h = Math.round((count/maxV)*64);
              const label = day.slice(5).replace('-','/');
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px" title="${day}: ${count} visita(s)">
                <div style="width:100%;max-width:28px;background:var(--accent);border-radius:4px 4px 0 0;height:${h}px;min-height:${count>0?2:0}px;transition:height .3s"></div>
                <span style="font-size:.5rem;color:var(--muted);transform:rotate(-45deg);white-space:nowrap">${label}</span>
              </div>`;
            }).join('')}
          </div>`}
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   CONTROLE DE CANAIS DE NOTIFICAÇÃO — Painel Admin
   Persiste em app_settings como flags booleanas por família
   Chaves: notify_email_enabled, notify_whatsapp_enabled, notify_telegram_enabled
══════════════════════════════════════════════════════════════════ */

const _NOTIF_CHANNEL_KEYS = {
  email:    'notify_email_enabled',
  whatsapp: 'notify_whatsapp_enabled',
  telegram: 'notify_telegram_enabled',
};

// ── Salvar flag de canal ──
async function saveNotifChannelSetting(channel, enabled) {
  const key = _NOTIF_CHANNEL_KEYS[channel];
  if (!key) return;

  // Atualizar UI de label imediatamente
  _updateNotifChannelLabel(channel, enabled);

  // Persistir
  try {
    await saveAppSetting(key, enabled);
    try { localStorage.setItem(key, String(enabled)); } catch(_) {}
    // Aplicar visibilidade nos formulários abertos
    _applyNotifChannelVisibility();
    toast(enabled ? `Canal ${channel} ativado` : `Canal ${channel} desativado`, 'success');
  } catch(e) {
    toast('Erro ao salvar: ' + e.message, 'error');
  }
}

// ── Atualizar label do toggle ──
function _updateNotifChannelLabel(channel, enabled) {
  const labelMap = { email: 'notifEmailLabel', whatsapp: 'notifWhatsappLabel', telegram: 'notifTelegramLabel' };
  const el = document.getElementById(labelMap[channel]);
  if (el) {
    el.textContent = enabled ? 'Ativo' : 'Inativo';
    el.style.color = enabled ? 'var(--accent)' : 'var(--muted)';
  }
}

// ── Carregar estados dos canais (ao abrir settings) ──
async function loadNotifChannelSettings() {
  const defaults = { email: true, whatsapp: true, telegram: true };
  const result   = { ...defaults };

  // Tentar do cache primeiro
  for (const [ch, key] of Object.entries(_NOTIF_CHANNEL_KEYS)) {
    const lsVal = localStorage.getItem(key);
    if (lsVal !== null) result[ch] = lsVal !== 'false' && lsVal !== '0';
  }

  // Buscar do banco
  try {
    const keys = Object.values(_NOTIF_CHANNEL_KEYS);
    const { data } = await sb.from('app_settings').select('key,value').in('key', keys);
    (data || []).forEach(row => {
      const ch = Object.entries(_NOTIF_CHANNEL_KEYS).find(([,k]) => k === row.key)?.[0];
      if (ch) {
        const val = row.value === true || row.value === 'true' || row.value === 1;
        result[ch] = val;
        try { localStorage.setItem(row.key, String(val)); } catch(_) {}
      }
    });
  } catch(_) {}

  // Aplicar na UI
  for (const [ch, enabled] of Object.entries(result)) {
    const chkMap = { email: 'notifEmailEnabled', whatsapp: 'notifWhatsappEnabled', telegram: 'notifTelegramEnabled' };
    const chk = document.getElementById(chkMap[ch]);
    if (chk) chk.checked = enabled;
    _updateNotifChannelLabel(ch, enabled);
  }

  _applyNotifChannelVisibility();
  return result;
}

// ── Ler estado atual de um canal ──
function isNotifChannelEnabled(channel) {
  const key = _NOTIF_CHANNEL_KEYS[channel];
  if (!key) return true;
  const lsVal = localStorage.getItem(key);
  if (lsVal !== null) return lsVal !== 'false' && lsVal !== '0';
  return true; // default: ativo
}

// ── Aplicar visibilidade dos canais em toda a UI ──
function _applyNotifChannelVisibility() {
  const emailOn    = isNotifChannelEnabled('email');
  const whatsappOn = isNotifChannelEnabled('whatsapp');
  const telegramOn = isNotifChannelEnabled('telegram');

  // ── Programados: linhas de canal ──
  const sel = (id, attr) => document.getElementById(id) || document.querySelector(`[${attr}]`);
  const emailSec    = sel('scNotifyEmailRow',    'data-notif-channel="email"');
  const whatsappSec = sel('scNotifyWhatsappRow', 'data-notif-channel="whatsapp"');
  const telegramSec = sel('scNotifyTelegramRow', 'data-notif-channel="telegram"');
  if (emailSec)    emailSec.style.display    = emailOn    ? '' : 'none';
  if (whatsappSec) whatsappSec.style.display = whatsappOn ? '' : 'none';
  if (telegramSec) telegramSec.style.display = telegramOn ? '' : 'none';

  // ── Perfil: linhas de canal nas notificações de transação ──
  const profEmailRow = document.getElementById('profNotifyTxEmailRow');
  const profWaRow    = document.getElementById('profNotifyTxWaRow');
  const profTgRow    = document.getElementById('profNotifyTxTgRow');
  if (profEmailRow) profEmailRow.style.display = emailOn    ? '' : 'none';
  if (profWaRow)    profWaRow.style.display    = whatsappOn ? '' : 'none';
  if (profTgRow)    profTgRow.style.display    = telegramOn ? '' : 'none';

  // Se channel desativado, também desmarcar o checkbox (não salvar — apenas UI)
  if (!emailOn    && profEmailRow) { const c = document.getElementById('myProfileNotifyTxEmail'); if (c) c.checked = false; }
  if (!whatsappOn && profWaRow)    { const c = document.getElementById('myProfileNotifyTxWa');   if (c) c.checked = false; }
  if (!telegramOn && profTgRow)    { const c = document.getElementById('myProfileNotifyTxTg');   if (c) c.checked = false; }

  // ── Perfil: campos de contato (WA number, Telegram Chat ID) ──
  const waProfileRow = document.getElementById('myProfileWhatsappRow');
  const tgProfileRow = document.getElementById('myProfileTelegramRow');
  if (waProfileRow) waProfileRow.style.display = whatsappOn ? '' : 'none';
  if (tgProfileRow) tgProfileRow.style.display = telegramOn ? '' : 'none';

  // ── Canal 2FA: esconder Telegram se desativado ──
  const tgChanLabel = document.getElementById('twoFaChanTgLabel');
  if (tgChanLabel) tgChanLabel.style.display = telegramOn ? '' : 'none';

  // ── Transações: botões de notificação por canal ──
  // Se canal desativado, esconder opções de notificação em transações
  document.querySelectorAll('[data-notif-channel]').forEach(el => {
    const ch = el.dataset.notifChannel;
    const on = ch === 'email' ? emailOn : ch === 'whatsapp' ? whatsappOn : telegramOn;
    el.style.display = on ? '' : 'none';
  });
}

// Carregar ao navegar para settings
const _origCfgShowPane = window.cfgShowPane;
if (typeof window.cfgShowPane === 'function') {
  const _origFn = window.cfgShowPane;
  window.cfgShowPane = function(paneId) {
    _origFn(paneId);
    if (paneId === 'pane-geral' || paneId === 'pane-auto') {
      loadNotifChannelSettings().catch(() => {});
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   2FA — Gerenciamento no perfil do usuário
══════════════════════════════════════════════════════════════════ */

// ── Mostrar/esconder painel de opções 2FA ──
function _toggle2FAPanel(enabled) {
  const panel = document.getElementById('myProfile2faPanel');
  if (panel) panel.style.display = enabled ? '' : 'none';
  // Show test section when enabling, hide when disabling
  const testSection = document.getElementById('profile2faSection');
  if (testSection) testSection.style.display = enabled ? '' : 'none';
  // Remove stale confirm box when toggling off
  if (!enabled) document.getElementById('twoFaSetupConfirmBox')?.remove();
}

// ── Carregar estado 2FA atual no modal de perfil ──
function _load2FAIntoProfile() {
  if (!currentUser?.email) return;
  sb.from('app_users')
    .select('two_fa_enabled, two_fa_channel, telegram_chat_id, email')
    .eq('email', currentUser.email)
    .maybeSingle()
    .then(({ data }) => {
      if (!data) return;
      const enabled = !!data.two_fa_enabled;
      const channel = data.two_fa_channel || 'email';
      const hasTg   = !!data.telegram_chat_id;

      // ── Sync currentUser so saveMyProfile() detects no change ───────────
      if (currentUser) {
        currentUser.two_fa_enabled = enabled;
        currentUser.two_fa_channel = channel;
      }

      const chk = document.getElementById('myProfile2faEnabled');
      if (chk) chk.checked = enabled;
      _toggle2FAPanel(enabled);

      const testSection = document.getElementById('profile2faSection');
      if (testSection && enabled) {
        const statusEl = document.getElementById('profile2faStatus');
        if (statusEl) {
          statusEl.textContent = '✓ 2FA já ativo. Clique em "Testar 2FA" para revalidar o canal.';
          statusEl.style.color = '#16a34a';
          statusEl.style.display = '';
        }
      }

      const chanEl = document.getElementById(channel === 'telegram' ? 'twoFaChanTelegram' : 'twoFaChanEmail');
      if (chanEl) chanEl.checked = true;

      // Hint email
      const emailHint = document.getElementById('twoFaEmailHint');
      if (emailHint) emailHint.textContent = `Código enviado para ${data.email}`;

      // Hint telegram
      const tgHint = document.getElementById('twoFaTgHint');
      if (tgHint) {
        tgHint.textContent = hasTg
          ? 'Chat ID configurado ✓'
          : 'Configure o Chat ID em Notificações primeiro';
      }
      // Desabilitar opção telegram se não tem chat_id
      const tgLabel = document.getElementById('twoFaChanTgLabel');
      if (tgLabel) {
        tgLabel.style.opacity = hasTg ? '1' : '.45';
        const tgRadio = document.getElementById('twoFaChanTelegram');
        if (tgRadio) tgRadio.disabled = !hasTg;
      }
    })
    .catch(() => {});
}


// ── Salvar configurações 2FA (chamado junto com saveMyProfile) ──
async function _save2FASettings(appUserId) {
  const enabled  = !!(document.getElementById('myProfile2faEnabled')?.checked);
  const chanEmail = document.getElementById('twoFaChanEmail');
  const chanTg    = document.getElementById('twoFaChanTelegram');
  const channel  = (chanTg?.checked && !chanTg?.disabled) ? 'telegram' : 'email';

  const { error } = await sb.from('app_users').update({
    two_fa_enabled: enabled,
    two_fa_channel: channel,
  }).eq('id', appUserId);

  if (error) throw new Error('Erro ao salvar 2FA: ' + error.message);
}

/* ══════════════════════════════════════════════════════════════════
   TELEGRAM — Vincular Chat ID via Deep Link (URL+token)
   Fluxo:
   1. Gerar token único → salvar em app_settings com user_id e TTL
   2. Abrir link t.me/BotName?start=TOKEN no Telegram
   3. Bot recebe /start TOKEN, obtém chat_id, chama webhook/RPC
   4. Poll em localStorage por resultado (ou via Supabase realtime)
══════════════════════════════════════════════════════════════════ */

let _tgLinkPollInterval = null;
let _tgLinkCountdownInterval = null;

async function openTelegramLinkFlow() {
  const btn      = document.getElementById('tgLinkFlowBtn');
  const status   = document.getElementById('tgLinkStatus');
  const progress = document.getElementById('tgLinkProgress');
  const bar      = document.getElementById('tgLinkProgressBar');
  const countdown= document.getElementById('tgLinkCountdown');

  // Clear any previous poll
  if (_tgLinkPollInterval)    clearInterval(_tgLinkPollInterval);
  if (_tgLinkCountdownInterval) clearInterval(_tgLinkCountdownInterval);

  if (btn)    { btn.disabled = true; btn.textContent = '⏳ Gerando link...'; }
  if (status) { status.textContent = ''; status.style.color = 'var(--muted)'; }
  if (progress) progress.style.display = 'none';

  try {
    // 1. Token único de 32 hex chars
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    // 2. Salvar token em app_settings (lido pelo bot ao receber /start TOKEN)
    const userId = currentUser?.app_user_id || currentUser?.id;
    try {
      await sb.from('app_settings').upsert({
        key:   'tg_link_token_' + token,
        value: JSON.stringify({ user_id: userId, expires_at: expiresAt, used: false }),
      }, { onConflict: 'key' });
    } catch(dbErr) {
      console.warn('[TgLink] token save failed:', dbErr?.message);
      // Continue anyway — may still work via bot direct lookup
    }

    // 3. Buscar nome do bot configurado (fallback: FamilyFintrack_bot)
    let botName = 'FamilyFintrack_bot';
    try {
      const { data: botRow } = await sb.from('app_settings')
        .select('value').eq('key', 'tg_bot_name').maybeSingle();
      if (botRow?.value) botName = String(botRow.value).replace(/^@/, '');
    } catch(_) {}

    // 4. Abrir Telegram
    const tgUrl = `https://t.me/${botName}?start=${token}`;
    window.open(tgUrl, '_blank');

    if (btn) { btn.disabled = false; btn.textContent = '✈️ Abrir novamente'; }
    if (status) status.textContent = `📱 Abriu @${botName} — envie /start ou toque em Iniciar no bot.`;

    // 5. Mostrar barra de progresso + countdown
    if (progress) progress.style.display = '';
    const POLL_MAX = 120;
    let elapsed = 0;
    if (bar)      { bar.style.transition = 'none'; bar.style.width = '0%'; }
    if (countdown) countdown.textContent = POLL_MAX;

    // Animate bar smoothly
    setTimeout(() => {
      if (bar) { bar.style.transition = `width ${POLL_MAX}s linear`; bar.style.width = '100%'; }
    }, 100);

    // Countdown seconds
    _tgLinkCountdownInterval = setInterval(() => {
      elapsed += 1;
      if (countdown) countdown.textContent = Math.max(0, POLL_MAX - elapsed);
    }, 1000);

    // 6. Poll a cada 3s por até 2min
    _tgLinkPollInterval = setInterval(async () => {
      if (elapsed >= POLL_MAX) {
        clearInterval(_tgLinkPollInterval);
        clearInterval(_tgLinkCountdownInterval);
        if (progress) progress.style.display = 'none';
        if (status) {
          status.textContent = '⏱ Tempo esgotado. Use o @userinfobot abaixo para obter o ID manualmente.';
          status.style.color = '#d97706';
        }
        return;
      }

      try {
        const { data: tokenRow } = await sb.from('app_settings')
          .select('value')
          .eq('key', 'tg_link_token_' + token)
          .maybeSingle();

        if (!tokenRow) return; // Ainda não respondeu

        let payload;
        try {
          payload = typeof tokenRow.value === 'string'
            ? JSON.parse(tokenRow.value) : tokenRow.value;
        } catch(_) { return; }

        if (payload?.chat_id) {
          // ✅ Chat ID recebido do bot!
          clearInterval(_tgLinkPollInterval);
          clearInterval(_tgLinkCountdownInterval);
          if (progress) progress.style.display = 'none';
          if (bar) { bar.style.transition = 'none'; bar.style.width = '100%'; bar.style.background = 'var(--accent)'; }

          const chatId = String(payload.chat_id);

          // Preencher campo
          const inp = document.getElementById('myProfileTelegramChatId');
          if (inp) inp.value = chatId;

          // Persistir em app_users
          if (currentUser?.app_user_id) {
            try {
              await sb.from('app_users')
                .update({ telegram_chat_id: chatId })
                .eq('id', currentUser.app_user_id);
              currentUser.telegram_chat_id = chatId;
            } catch(_) {}
          }

          // Limpar token usado
          try { await sb.from('app_settings').delete().eq('key', 'tg_link_token_' + token); } catch(_) {}

          if (status) {
            status.textContent = '✅ Chat ID ' + chatId + ' vinculado!';
            status.style.color = 'var(--accent)';
          }
          toast('✅ Telegram vinculado com sucesso! Chat ID: ' + chatId, 'success');
          if (typeof _load2FAIntoProfile === 'function') _load2FAIntoProfile();
        }
      } catch(_) { /* ignora erros de rede no poll */ }
    }, 3000);

  } catch(e) {
    clearInterval(_tgLinkPollInterval);
    clearInterval(_tgLinkCountdownInterval);
    if (progress) progress.style.display = 'none';
    if (status) { status.textContent = 'Erro: ' + e.message; status.style.color = 'var(--red)'; }
    if (btn) { btn.disabled = false; btn.textContent = '✈️ Abrir @FamilyFintrack_bot'; }
    console.error('[TgLink]', e);
  }
}


// ── Expor funções públicas no window ──────────────────────────────────────────
window._applyNotifChannelVisibility        = _applyNotifChannelVisibility;

// ════════════════════════════════════════════════════════════════════════════
//  DEMO DATA IMPORT — Importador de massa de dados de demonstração
//  Uso exclusivo do administrador global
// ════════════════════════════════════════════════════════════════════════════

async function importDemoData(userId, familyId, progressCb) {
  if (!userId || !familyId) throw new Error('Usuário e família são obrigatórios.');
  const log = (msg, pct) => { console.log(`[DemoImport] ${msg}`); if (progressCb) progressCb(msg, pct); };
  const errors = [];

  if (typeof generateDemoData !== 'function') throw new Error('Gerador não disponível. Verifique demo_data_generator.js.');
  const data = generateDemoData();
  log(`Dados gerados: ${data._meta.txCount} transações, ${data._meta.catCount} categorias`, 3);

  // ── Column whitelists — only send columns that exist in each table ────────
  const COLS = {
    account_groups: ['id','name','emoji','color','currency','family_id','created_at'],
    accounts:       ['id','name','type','currency','initial_balance','icon','color',
                     'group_id','is_favorite','due_day','best_purchase_day','card_limit',
                     'notes','family_id','created_at'],
    categories:     ['id','name','type','parent_id','icon','color','family_id','created_at'],
    payees:         ['id','name','type','default_category_id','notes','family_id','created_at'],
    budgets:        ['id','month','category_id','amount','auto_reset','notes','family_id','created_at'],
    scheduled_transactions: ['id','description','type','amount','currency','account_id',
                     'transfer_to_account_id','payee_id','category_id','memo','tags',
                     'status','start_date','frequency','auto_register','auto_confirm',
                     'family_id','created_at'],
    debts:          ['id','name','creditor_payee_id','original_amount','current_balance','currency',
                     'adjustment_type','periodicity','start_date','status','notes','family_id','created_at'],
    dreams:         ['id','title','dream_type','target_amount','target_date',
                     'status','priority','description','family_id','created_by','created_at','updated_at'],
    price_items:    ['id','name','description','unit','category_id','family_id','created_at'],
    price_stores:   ['id','name','address','family_id','created_at'],
    price_history:  ['id','item_id','store_id','unit_price','purchased_at','quantity','family_id','created_at'],
    grocery_lists:  ['id','name','status','family_id','created_at'],
    grocery_items:  ['id','list_id','name','qty','unit','checked','suggested_price','family_id','created_at'],
    investment_positions: ['id','family_id','account_id','ticker','asset_type','name',
                     'quantity','avg_cost','current_price','currency','notes','created_at'],
    financial_objectives: ['id','family_id','name','icon','description','start_date',
                     'end_date','budget_limit','status','created_at','updated_at'],
    transactions:   ['id','date','description','amount','brl_amount','account_id',
                     'category_id','payee_id','is_transfer','is_card_payment',
                     'transfer_to_account_id','status','currency','memo',
                     'family_id','created_at','updated_at'],
  };

  function pick(row, cols) {
    const out = {};
    cols.forEach(c => { if (c in row) out[c] = row[c]; });
    return out;
  }

  // ── Helper: insert in batches, collect per-table results ────────────────────
  const tableResults = {}; // { tableName: { sent, ok, errors: [] } }

  // Tables where name+family_id must be unique — use upsert to skip duplicates
  const UPSERT_TABLES = new Set([
    'account_groups','accounts','payees','price_stores',
    'categories',
  ]);

  async function ins(table, rows, label, batchSize = 50) {
    if (!rows || !rows.length) {
      tableResults[table] = { label, sent: 0, ok: 0, errors: [] };
      log(`${label}: 0 (skipped)`, null);
      return 0;
    }
    const cols = COLS[table];
    const enriched = rows.map(r => {
      const base = { ...r, family_id: familyId, created_at: r.created_at || new Date().toISOString() };
      return cols ? pick(base, cols) : base;
    });
    tableResults[table] = { label, sent: rows.length, ok: 0, errors: [] };
    let ok = 0;
    const useUpsert = UPSERT_TABLES.has(table);
    for (let i = 0; i < enriched.length; i += batchSize) {
      const batch = enriched.slice(i, i + batchSize);
      let error;
      if (useUpsert) {
        // ON CONFLICT DO NOTHING — tries id first, falls back to insert-ignore on duplicate
        ({ error } = await sb.from(table).upsert(batch, { onConflict: 'id', ignoreDuplicates: true }));
        if (!error) {
          // Success (inserted or skipped duplicate) — count all as ok
          ok += batch.length; tableResults[table].ok += batch.length;
          continue;
        }
        if (error.message?.includes('duplicate') || error.code === '23505') {
          // Conflict on unique constraint other than id — row-by-row fallback
          let rowOk = 0;
          for (const row of batch) {
            const { error: re } = await sb.from(table).insert(row);
            if (!re || re.code === '23505' || re.message?.includes('duplicate')) rowOk++;
          }
          ok += rowOk; tableResults[table].ok += rowOk;
          continue;
        }
      } else {
        ({ error } = await sb.from(table).insert(batch));
        if (!error) { ok += batch.length; tableResults[table].ok += batch.length; continue; }
      }
      if (error) {
        // Last resort: upsert already tried above; just record the error
        if (useUpsert) {
          // Already handled row-by-row above, but if we're here upsert succeeded with error
        }
        const msg = `Batch ${Math.floor(i/batchSize)+1}: ${error.message}`;
        console.warn('[DemoImport]', table, msg);
        tableResults[table].errors.push(msg);
        errors.push(`${table}: ${msg}`);
      } else {
        ok += batch.length;
        tableResults[table].ok += batch.length;
      }
    }
    log(`${label}: ${ok}/${rows.length}`, null);
    return ok;
  }

  // ── 1. Account Groups ─────────────────────────────────────────────────────
  log('Criando grupos de contas…', 8);
  await ins('account_groups', data.accountGroups, 'Grupos');

  // Build group ID map immediately after insert (before accounts need it)
  const groupIdMap = await buildIdMap('account_groups', data.accountGroups, 'name');
  console.log('[DemoImport] groupIdMap entries:', Object.keys(groupIdMap).length);

  // ── 2. Accounts (with remapped group_id, row-by-row to handle FK gracefully) ──
  log('Criando contas…', 14);
  {
    let accountsInserted = 0;
    const accountErrors = [];
    for (const a of data.accounts) {
      const realGroupId = a.group_id ? (groupIdMap[a.group_id] || null) : null;
      const acctRow = {
        ...a, family_id: familyId,
        group_id: realGroupId,
        created_at: a.created_at || new Date().toISOString(),
      };
      // Remove columns not in schema
      const cols = ['id','name','type','currency','initial_balance','icon','color',
                    'group_id','is_favorite','due_day','best_purchase_day','card_limit',
                    'notes','family_id','created_at'];
      const row = Object.fromEntries(cols.filter(c => c in acctRow).map(c => [c, acctRow[c]]));

      let { error: ae } = await sb.from('accounts').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      if (!ae) { accountsInserted++; continue; }

      // Duplicate name constraint → account already exists with different id → count as success
      if (ae.code === '23505' || ae.message?.includes('duplicate') || ae.message?.includes('unique')) {
        accountsInserted++;
        continue;
      }

      // FK error on group_id → retry without group_id
      if (ae.message?.includes('group_id') || ae.message?.includes('accounts_group_id')) {
        const rowNoGroup = { ...row }; delete rowNoGroup.group_id;
        const { error: ae2 } = await sb.from('accounts').upsert(rowNoGroup, { onConflict: 'id', ignoreDuplicates: true });
        if (!ae2) { accountsInserted++; continue; }
        // If still duplicate, account exists
        if (ae2.code === '23505' || ae2.message?.includes('duplicate')) { accountsInserted++; continue; }
        ae = ae2;
      }
      accountErrors.push(a.name + ': ' + ae.message);
    }
    tableResults['accounts'] = { label: 'Contas', sent: data.accounts.length, ok: accountsInserted, errors: accountErrors.slice(0,2) };
    if (accountErrors.length) errors.push('accounts: ' + accountErrors[0]);
    log('Contas: ' + accountsInserted + '/' + data.accounts.length, null);
  }

  // ── 3. Categories (parents first) ─────────────────────────────────────────
  log('Criando categorias…', 20);
  await ins('categories', data.categories.filter(c => !c.parent_id),  'Cats (pais)');
  await ins('categories', data.categories.filter(c =>  c.parent_id), 'Cats (filhas)');

  // ── 4. Payees ─────────────────────────────────────────────────────────────
  log('Criando beneficiários…', 27);
  // Remap category_id → default_category_id
  await ins('payees', data.payees.map(p => ({
    ...p,
    default_category_id: p.category_id || p.default_category_id || null,
  })), 'Beneficiários');

  // ── 5. Family Members ─────────────────────────────────────────────────────
  log('Criando membros…', 32);
  for (const m of data.familyMembers) {
    const { error } = await sb.from('family_members').insert({
      family_id: familyId, user_id: userId,
      name: m.name, role: m.role || 'viewer',
      color: m.color, icon: m.icon,
      created_at: new Date().toISOString(),
    });
    if (error && !error.message.includes('duplicate')) {
      errors.push(`family_member ${m.name}: ${error.message}`);
    }
  }

  // ── 5b. Build ID remap tables — CRITICAL for FK consistency ──────────────
  // When upsert skips a duplicate (family+name exists), the DB keeps the OLD uuid.
  // Transactions/scheduled reference the NEW demo UUIDs → FK fails.
  // Fix: query actual IDs by name after insert, remap all FKs.
  log('Mapeando IDs reais do banco…', 35);

  // Helper: query name→id for a table
  // Tries with family_id first; falls back to no filter if empty (handles global tables)
  async function buildIdMap(table, demoRows, nameCol) {
    const names = demoRows.map(r => r[nameCol]).filter(Boolean);
    if (!names.length) return {};
    try {
      // Try with family_id filter
      let { data: rows, error: mapErr } = await sb.from(table)
        .select('id,' + nameCol)
        .eq('family_id', familyId)
        .in(nameCol, names);
      if (mapErr || !rows?.length) {
        // Fallback: query without family_id (table may not have the column)
        const { data: rows2 } = await sb.from(table)
          .select('id,' + nameCol)
          .in(nameCol, names);
        rows = rows2 || [];
      }
      const byName = {};
      (rows || []).forEach(r => { byName[r[nameCol]] = r.id; });
      const map = {};
      let mapped = 0;
      demoRows.forEach(r => {
        if (r[nameCol] && byName[r[nameCol]]) { map[r.id] = byName[r[nameCol]]; mapped++; }
      });
      console.log('[DemoImport] buildIdMap', table + ':', mapped + '/' + demoRows.length, 'mapped', JSON.stringify(map).slice(0,120));
      return map;
    } catch(e) {
      console.warn('[DemoImport] buildIdMap exception', table, ':', e.message);
      return {};
    }
  }

  const accIdMap  = await buildIdMap('accounts',   data.accounts,    'name');
  const payIdMap  = await buildIdMap('payees',      data.payees,      'name');
  const catIdMap  = await buildIdMap('categories',  data.categories,  'name');
  log('Mapas de IDs prontos', 36);

  // Patch payees.default_category_id now that catIdMap is available
  const payeesWithCat = data.payees.filter(p => p.category_id || p.default_category_id);
  if (payeesWithCat.length && Object.keys(payIdMap).length) {
    for (const p of payeesWithCat) {
      const realPayeeId  = payIdMap[p.id];
      const demoCatId    = p.category_id || p.default_category_id;
      const realCatId    = demoCatId ? remap(catIdMap, demoCatId) : null;
      if (realPayeeId && realCatId && realCatId !== demoCatId) {
        try {
          await sb.from('payees')
            .update({ default_category_id: realCatId })
            .eq('id', realPayeeId)
            .eq('family_id', familyId);
        } catch(_) {}
      }
    }
  }

  // Remap helper: translate demo UUID → actual DB UUID (or keep original if already ok)
  function remap(map, id) { return (id && map[id]) ? map[id] : id; }

  // ── 6. Transactions ───────────────────────────────────────────────────────
  log('Importando transações…', 37);
  const txTotal = data.transactions.length;
  let txOk = 0;
  const txCols = COLS['transactions'];
  for (let i = 0; i < txTotal; i += 100) {
    const batch = data.transactions.slice(i, i + 100).map(t => {
      const base = {
        ...t,
        family_id:  familyId,
        // Remap account/payee/category to actual DB IDs
        account_id:            remap(accIdMap,  t.account_id),
        transfer_to_account_id: t.transfer_to_account_id ? remap(accIdMap, t.transfer_to_account_id) : null,
        payee_id:              remap(payIdMap,  t.payee_id),
        category_id:           remap(catIdMap,  t.category_id),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        brl_amount: t.brl_amount ?? (typeof toBRL === 'function' ? toBRL(t.amount, t.currency || 'BRL') : t.amount),
      };
      return pick(base, txCols);
    });
    const { error } = await sb.from('transactions').insert(batch);
    if (error) {
      errors.push('transactions batch ' + (Math.floor(i/100)+1) + ': ' + error.message);
      console.error('[DemoImport]', error.message, error);
    } else {
      txOk += batch.length;
    }
    log('Transações: ' + Math.min(i+100,txTotal) + '/' + txTotal + '…', 37 + Math.round(Math.min(i+100,txTotal)/txTotal*32));
  }
  log('Transações: ' + txOk + '/' + txTotal + ' inseridas', 69);

  // ── 7. Scheduled ─────────────────────────────────────────────────────────
  log('Criando programados…', 71);
  // Remap account/payee/category IDs and skip rows whose account doesn't exist
  const scheduledRemapped = data.scheduled.map(sc => ({
    ...sc,
    account_id:            remap(accIdMap, sc.account_id),
    transfer_to_account_id: sc.transfer_to_account_id ? remap(accIdMap, sc.transfer_to_account_id) : null,
    payee_id:              remap(payIdMap,  sc.payee_id),
    category_id:           remap(catIdMap,  sc.category_id),
    start_date:    sc.start_date || new Date().toISOString().slice(0,10),
    auto_register: sc.auto_register ?? false,
    auto_confirm:  sc.auto_confirm ?? true,
  }));
  await ins('scheduled_transactions', scheduledRemapped, 'Programados', 20);

  // ── 8. Budgets ───────────────────────────────────────────────────────────
  log('Criando orçamentos…', 74);
  await ins('budgets', data.budgets.map(b => ({
    ...b,
    // DB column is date type — needs YYYY-MM-DD, not YYYY-MM
    month: b.month && b.month.length === 7 ? b.month + '-01' : b.month,
  })), 'Orçamentos');

  // ── 9. Debts ─────────────────────────────────────────────────────────────
  log('Criando dívidas…', 77);
  // debts: creditor_payee_id is NOT NULL — create creditor payees on-the-fly
  log('Criando dívidas…', 77);
  {
    const debtData = data.debts || [];
    if (!debtData.length) {
      tableResults['debts'] = { label: 'Dívidas', sent: 0, ok: 0, errors: [] };
    } else {
      const debtCols = ['id','name','creditor_payee_id','original_amount',
        'current_balance','currency','interest_rate','min_payment','due_day',
        'status','start_date','notes','family_id','created_at'];
      let debtOk = 0; const debtErrors = [];

      for (const d of debtData) {
        // Try to get/create a creditor payee
        // Use any payee from payIdMap as creditor placeholder
        const payeeIds = Object.values(payIdMap);
        let creditorId = payeeIds.length > 0 ? payeeIds[0] : null;

        if (!creditorId) {
          try {
            const { data: anyP } = await sb.from('payees')
              .select('id').eq('family_id', familyId).limit(1).maybeSingle();
            if (anyP?.id) creditorId = anyP.id;
          } catch(_) {}
        }

        if (!creditorId) { debtErrors.push(d.name + ': sem credor disponível'); continue; }

        const debtRow = {};
        debtCols.forEach(c => { if (c in d) debtRow[c] = d[c]; });
        debtRow.family_id         = familyId;
        debtRow.creditor_payee_id = creditorId;
        debtRow.currency          = debtRow.currency || 'BRL';
        debtRow.created_at        = debtRow.created_at || new Date().toISOString();
        // Remove undefined values
        Object.keys(debtRow).forEach(k => { if (debtRow[k] === undefined) delete debtRow[k]; });

        const { error: de } = await sb.from('debts').upsert(debtRow, { onConflict: 'id', ignoreDuplicates: true });
        if (!de) { debtOk++; }
        else if (de.code === '23505' || de.message?.includes('duplicate')) { debtOk++; }
        else debtErrors.push(d.name + ': ' + de.message.slice(0, 60));
      }
      tableResults['debts'] = { label: 'Dívidas', sent: debtData.length, ok: debtOk, errors: debtErrors.slice(0,2) };
      if (debtErrors.length) errors.push('debts: ' + debtErrors[0]);
      log('Dívidas: ' + debtOk + '/' + debtData.length, null);
    }
  }

  // ── 10. Dreams ───────────────────────────────────────────────────────────
  log('Criando objetivos…', 80);
  // dreams: created_by must match auth.uid() for RLS
  // Fetch the actual auth.uid() from Supabase session (most reliable)
  // Always use the CURRENT SESSION auth.uid() for dreams.created_by
  // RLS checks auth.uid() = created_by — only the logged-in user can insert.
  let dreamsAuthUid = null;
  try {
    const { data: { user: _au } } = await sb.auth.getUser();
    dreamsAuthUid = _au?.id || null;
  } catch(_) {}
  // Fallback chain
  if (!dreamsAuthUid && typeof currentUser !== 'undefined') {
    dreamsAuthUid = currentUser?.auth_uid || currentUser?.supabase_uid || null;
  }
  if (!dreamsAuthUid) {
    // Last resort: read directly from supabase session
    const _sess = sb.auth?.currentSession?.()?.data?.session;
    dreamsAuthUid = _sess?.user?.id || userId;
  }
  console.log('[DemoImport] dreams auth_uid:', dreamsAuthUid);
  // Try inserting dreams row-by-row (RLS requires auth.uid() match on created_by)
  {
    const dreamRows = data.dreams.map(dr => ({
      ...pick({
        ...dr,
        created_by:  dreamsAuthUid,
        dream_type:  dr.dream_type || dr.type || 'outro',
        target_date: dr.target_date || dr.deadline || null,
        updated_at:  new Date().toISOString(),
        family_id:   familyId,
        status:      dr.status || 'active',
        priority:    dr.priority || 1,
        title:       dr.title || dr.name || 'Objetivo',
        target_amount: dr.target_amount || dr.goal_amount || 0,
      }, ['id','title','description','target_amount','dream_type',
          'target_date','priority','status','created_by','family_id',
          'updated_at','created_at']),
    }));
    let dreamOk = 0;
    const dreamErrors = [];
    for (const row of dreamRows) {
      // Try with current auth.uid() as created_by
      const tryRow = { ...row, created_by: dreamsAuthUid };
      const { error: de } = await sb.from('dreams').insert(tryRow);
      if (!de) { dreamOk++; continue; }
      // If RLS blocks, try strategies
      if (de.code === '42501' || de.message?.includes('policy') || de.message?.includes('row-level')) {
        // Strategy 2: null created_by
        const { error: de2 } = await sb.from('dreams').insert({ ...tryRow, created_by: null });
        if (!de2) { dreamOk++; continue; }
        // Strategy 3: strip demo UUID, let DB auto-generate id
        const { id: _skip, ...rowNoId } = tryRow;
        const { error: de3 } = await sb.from('dreams').insert({ ...rowNoId, created_by: dreamsAuthUid });
        if (!de3) { dreamOk++; continue; }
        // Strategy 4: try with family_id and auth_uid explicitly from current session
        try {
          const { data: { user: _au } } = await sb.auth.getUser();
          if (_au?.id && _au.id !== dreamsAuthUid) {
            const { error: de4 } = await sb.from('dreams').insert({ ...rowNoId, created_by: _au.id });
            if (!de4) { dreamOk++; continue; }
          }
        } catch(_) {}
        // Strategy 5: the RLS policy may require the family_id to be in the
        // logged-in user's authorized families. Try with explicit family_id only.
        try {
          const { id: _id2, created_by: _cb2, ...bareRow } = rowNoId;
          const { error: de5 } = await sb.from('dreams').insert({
            ...bareRow,
            family_id:  familyId,
            created_by: dreamsAuthUid,
          });
          if (!de5) { dreamOk++; continue; }
        } catch(_) {}
        dreamErrors.push(de.message.slice(0, 80));
      } else {
        dreamErrors.push(de.message.slice(0, 80));
      }
    }
    tableResults['dreams'] = { label: 'Sonhos', sent: dreamRows.length, ok: dreamOk, errors: dreamErrors.slice(0,2) };
    if (dreamErrors.length) errors.push('dreams: ' + dreamErrors[0]);
    log('Sonhos: ' + dreamOk + '/' + dreamRows.length, null);
  }

  // ── 11. Investment Positions ─────────────────────────────────────────────
  log('Criando carteira de investimentos…', 81);
  if (data.investments && data.investments.length) {
    const accIdMapLocal = await buildIdMap('accounts', data.accounts, 'name');
    let invOk = 0; const invErrors = [];
    for (const inv of data.investments) {
      try {
        const realAccId = accIdMapLocal[data.accounts.find(a => a.id === inv.account_id)?.name] || inv.account_id;
        const invRow = {
          id:            inv.id,
          family_id:     familyId,
          account_id:    realAccId,
          ticker:        inv.ticker || null,
          asset_type:    inv.type   || 'acao',
          name:          inv.name,
          quantity:      inv.quantity  || 0,
          avg_cost:      inv.purchase_price || 0,
          current_price: inv.current_price  || inv.purchase_price || 0,
          currency:      'BRL',
          notes:         inv.notes || null,
          created_at:    new Date().toISOString(),
        };
        const { error: ie } = await sb.from('investment_positions')
          .upsert(invRow, { onConflict: 'id', ignoreDuplicates: true });
        if (!ie || ie.code === '23505') invOk++;
        else {
          // Try without id (let DB generate)
          const { id: _skip, ...rowNoId } = invRow;
          const { error: ie2 } = await sb.from('investment_positions').insert(rowNoId);
          if (!ie2) invOk++;
          else invErrors.push(inv.name + ': ' + ie2.message.slice(0,60));
        }
      } catch(e_) { invErrors.push(inv.name + ': ' + e_.message.slice(0,60)); }
    }
    tableResults['investment_positions'] = { label: 'Investimentos', sent: data.investments.length, ok: invOk, errors: invErrors.slice(0,2) };
    if (invErrors.length) errors.push('investments: ' + invErrors[0]);
    log('Investimentos: ' + invOk + '/' + data.investments.length, null);
  }

  // ── 11b. Financial Objectives ─────────────────────────────────────────────
  log('Criando objetivos financeiros…', 82);
  if (data.financialObjectives && data.financialObjectives.length) {
    let objOk = 0; const objErrors = [];
    const now = new Date().toISOString();
    for (const obj of data.financialObjectives) {
      const objRow = {
        id:           obj.id,
        family_id:    familyId,
        name:         obj.name,
        icon:         obj.icon  || '🎯',
        description:  obj.notes || null,
        start_date:   new Date().toISOString().slice(0,10),
        end_date:     obj.target_date || null,
        budget_limit: obj.target_amount || null,
        status:       obj.status || 'active',
        created_at:   now,
        updated_at:   now,
      };
      const { error: oe } = await sb.from('financial_objectives')
        .upsert(objRow, { onConflict: 'id', ignoreDuplicates: true });
      if (!oe || oe.code === '23505') objOk++;
      else {
        const { id: _skip, ...rowNoId } = objRow;
        const { error: oe2 } = await sb.from('financial_objectives').insert(rowNoId);
        if (!oe2) objOk++;
        else objErrors.push(obj.name + ': ' + oe2.message.slice(0,60));
      }
    }
    tableResults['financial_objectives'] = { label: 'Objetivos Financeiros', sent: data.financialObjectives.length, ok: objOk, errors: objErrors.slice(0,2) };
    if (objErrors.length) errors.push('objectives: ' + objErrors[0]);
    log('Objetivos: ' + objOk + '/' + data.financialObjectives.length, null);
  }

  // ── 12. Prices ───────────────────────────────────────────────────────────
  log('Criando preços…', 83);
  // price_items.category_id references a grocery-specific category (not transaction categories)
  // These demo UUIDs (priceCatFood, etc.) are ephemeral and not in catIdMap → always null
  const validPriceItems = data.priceItems.map(pi => ({
    ...pi,
    category_id: null,  // price items have their own category system, not tied to transaction categories
  }));
  // price_items has unique constraint on (family_id, name) — handle per-row
  // Must enrich with family_id before upsert (ins() not used here)
  {
    const piCols = COLS['price_items'] || ['id','name','description','unit','category_id','family_id','created_at'];
    let piOk = 0; const piErrs = [];
    for (const pi of validPriceItems) {
      // Enrich: add family_id and created_at, pick only valid columns
      const piRow = {};
      piCols.forEach(c => { if (c in pi) piRow[c] = pi[c]; });
      piRow.family_id  = familyId;
      piRow.created_at = piRow.created_at || new Date().toISOString();

      // Attempt 1: upsert with category_id
      let { error: pie } = await sb.from('price_items')
        .upsert(piRow, { onConflict: 'family_id,name', ignoreDuplicates: true });

      // FK violation on category_id → retry without it
      if (pie?.message?.includes('category_id') || pie?.message?.includes('price_items_category')) {
        const piRowNoCat = { ...piRow, category_id: null };
        const { error: pie2 } = await sb.from('price_items')
          .upsert(piRowNoCat, { onConflict: 'family_id,name', ignoreDuplicates: true });
        pie = pie2;
      }

      if (!pie) { piOk++; continue; }
      if (pie.message?.includes('duplicate') || pie.code === '23505') { piOk++; continue; }
      piErrs.push(pi.name + ': ' + pie.message);
    }
    tableResults['price_items'] = { label: 'Itens de preço', sent: validPriceItems.length, ok: piOk, errors: piErrs.slice(0,2) };
    if (piErrs.length) errors.push('price_items: ' + piErrs[0]);
    log('Itens de preço: ' + piOk + '/' + validPriceItems.length, null);
  }
  await ins('price_stores', data.priceStores, 'Lojas');

  // Build actual ID maps for price_items and price_stores after insert
  const piIdMap = await buildIdMap('price_items',  data.priceItems,  'name');
  const psIdMap = await buildIdMap('price_stores',  data.priceStores, 'name');

  await ins('price_history', data.priceHistory
    .map(ph => ({
      ...ph,
      item_id:      remap(piIdMap, ph.item_id),
      store_id:     remap(psIdMap, ph.store_id),
      purchased_at: ph.purchased_at || ph.date,
      unit_price:   ph.unit_price   || ph.price,
      quantity:     ph.quantity     || ph.qty || 1,
      date:         undefined, price: undefined, qty: undefined,
    }))
    .filter(ph => ph.item_id),   // skip entries with no resolvable item
    'Histórico');

  // ── 12. Grocery ──────────────────────────────────────────────────────────
  log('Criando mercado…', 88);
  const grocery = data.groceries;
  // grocery_lists: 'type' col doesn't exist; status must be 'open' (not 'active')
  const glRaw = { ...grocery.list, family_id: familyId, created_at: new Date().toISOString(),
    status: 'open' };  // DB check constraint: status IN ('open','done',...)
  delete glRaw.type;
  const glBase = pick(glRaw, COLS['grocery_lists'].filter(c => c !== 'type'));
  const { error: glErr } = await sb.from('grocery_lists').upsert(glBase, { onConflict: 'id', ignoreDuplicates: true });
  if (!glErr) {
    await ins('grocery_items', grocery.items.map(x => ({
      ...x,
      list_id:         grocery.list.id,
      qty:             x.qty || x.quantity || 1,
      suggested_price: x.suggested_price || x.estimated_price || null,
      quantity:        undefined, estimated_price: undefined,
    })), 'Itens mercado');
  } else {
    errors.push(`grocery_list: ${glErr.message}`);
    console.warn('[DemoImport] grocery_list:', glErr.message);
  }

  // ── Track grocery manually since it uses a direct insert ────────────────
  if (!tableResults['grocery_lists']) {
    tableResults['grocery_lists'] = { label: 'Lista de mercado', sent: 1, ok: glErr ? 0 : 1, errors: glErr ? [glErr.message] : [] };
  }

  const errSummary = errors.length > 0 ? ` (${errors.length} erro${errors.length>1?'s':''})` : '';
  log(`Importação concluída!${errSummary}`, 100);

  return {
    success: true,
    txCount: txOk,
    errors,
    tableResults,
    message: `${txOk} transações, ${data.categories.length} categorias, ${data.payees.length} beneficiários.${errSummary}`,
  };
}
window.importDemoData = importDemoData;


// ── Demo Data UI Controller ──────────────────────────────────────────────────

// ── deleteAllFamilyData: wipe all data for current family ───────────────────
async function deleteAllFamilyData() {
  const fid = typeof famId === 'function' ? famId() : null;
  const fname = (state.families||[]).find(f=>f.id===fid)?.name || 'família atual';

  if (!fid) { toast('Nenhuma família ativa.', 'warning'); return; }

  // Only family owner can delete all data
  // Only the family owner (role='owner' in family_members) can delete all data
  // Global 'admin' is NOT allowed here — this is a family management action
  const isOwner = currentUser?.role === 'owner';
  if (!isOwner) {
    toast('Apenas o proprietário da família pode excluir todos os dados.', 'error');
    return;
  }

  // Two-step confirmation
  const confirm1 = await new Promise(res => {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML=`<div style="background:var(--surface);border-radius:18px;padding:28px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="font-size:2.5rem;text-align:center;margin-bottom:12px">⚠️</div>
      <div style="font-size:1rem;font-weight:800;color:var(--text);text-align:center;margin-bottom:8px">Excluir todos os dados?</div>
      <div style="font-size:.84rem;color:var(--muted);text-align:center;line-height:1.6;margin-bottom:20px">
        Você está prestes a excluir <strong>TODOS</strong> os dados da família <strong>${esc(fname)}</strong>:<br>
        transações, contas, categorias, orçamentos, programados,
        <strong>beneficiários e fontes pagadoras</strong>,
        <strong>dívidas e lançamentos de dívidas</strong>,
        objetivos, preços, lista de supermercado,
        programas de fidelidade e membros.<br><br>
        <span style="color:#dc2626;font-weight:700">Esta ação é irreversível.</span>
      </div>
      <div style="display:flex;gap:10px">
        <button id="_delConfCancelBtn" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
        <button id="_delConfBtn" style="flex:1;padding:12px;border-radius:10px;border:none;background:#dc2626;color:#fff;font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit">Sim, excluir tudo</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_delConfCancelBtn').onclick = () => { overlay.remove(); res(false); };
    overlay.querySelector('#_delConfBtn').onclick = () => { overlay.remove(); res(true); };
  });
  if (!confirm1) return;

  // Second confirmation — type family name
  const typedName = window.prompt(`Para confirmar, digite o nome da família:
"${fname}"`);
  if (typedName?.trim() !== fname.trim()) {
    toast('Nome incorreto — exclusão cancelada.', 'error');
    return;
  }

  // Progress overlay
  const prog = document.createElement('div');
  prog.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  prog.innerHTML=`<div style="background:var(--surface);border-radius:18px;padding:28px;max-width:400px;width:100%">
    <div style="font-size:1rem;font-weight:800;color:var(--text);margin-bottom:16px;text-align:center">🗑️ Excluindo dados…</div>
    <div id="_delProgStatus" style="font-size:.82rem;color:var(--muted);margin-bottom:10px;text-align:center">Iniciando…</div>
    <div style="height:10px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:8px">
      <div id="_delProgBar" style="height:100%;width:0%;background:#dc2626;border-radius:6px;transition:width .4s ease"></div>
    </div>
    <div id="_delProgPct" style="font-size:.75rem;color:var(--muted);text-align:center">0%</div>
  </div>`;
  document.body.appendChild(prog);

  const setProgress = (msg, pct) => {
    const s=document.getElementById('_delProgStatus'); if(s) s.textContent=msg;
    const b=document.getElementById('_delProgBar');    if(b) b.style.width=pct+'%';
    const p=document.getElementById('_delProgPct');    if(p) p.textContent=pct+'%';
  };

  try {
    const tables=[
      // Telemetria / logs
      ['app_telemetry',              3],
      // AI insights
      ['ai_insight_recommendations', 5],
      ['ai_insight_snapshots',       7],
      // Prices
      ['price_history',             10],
      // Grocery
      ['grocery_items',             12],
      ['grocery_lists',             14],
      ['price_stores',              16],
      ['price_items',               18],
      // Loyalty — deve vir antes de accounts (linked_account_id)
      ['loyalty_transactions',      21],
      ['loyalty_programs',          23],
      // Debts — deve vir antes de accounts e payees
      ['debt_ledger',               26],
      ['debts',                     29],
      // Dreams / objectives
      ['dream_items',               32],
      ['dream_contributions',       35],
      ['dreams',                    38],
      ['financial_objectives',      40],
      // Investments
      ['investment_price_history',  43],
      ['investment_transactions',   46],
      ['investment_positions',      49],
      // Scheduled
      ['scheduled_occurrences',     52],
      ['scheduled_run_logs',        55],
      ['scheduled_transactions',    58],
      // Budgets
      ['budgets',                   61],
      // Receivables
      ['scheduled_ar_records',      63],
      // Transactions — deve vir antes de accounts, payees e categories
      ['transactions',              67],
      // Accounts + groups
      ['accounts',                  71],
      ['account_groups',            74],
      // Beneficiários e fontes pagadoras — após transactions e scheduled
      ['payees',                    78],
      // Categorias — após transactions e budgets
      ['categories',                82],
      // Family structure — por último
      ['family_composition',        86],
      ['family_members',            92],
      // NOTE: app_settings NÃO é deletado — contém config do sistema
      // (EmailJS, flags de módulo, etc.) que deve persistir entre resets
    ];

    for (const [table, pct] of tables) {
      setProgress(`Excluindo ${table}…`, pct);
      try {
        const { error } = await sb.from(table).delete().eq('family_id', fid);
        if (error) console.warn(`[deleteAll] ${table}:`, error.message);
      } catch(err) {
        console.warn(`[deleteAll] ${table} exception:`, err?.message);
      }
    }

    setProgress('Finalizando…', 98);
    await new Promise(r=>setTimeout(r,400));
    prog.remove();

    toast('✅ Todos os dados da família foram removidos com sucesso.', 'success');

    // Clear ALL in-memory state caches
    if (typeof state !== 'undefined') {
      state.transactions=[]; state.accounts=[]; state.categories=[];
      state.payees=[]; state.budgets=[]; state.dreams=[]; state.debts=[];
      state.groups=[]; state.familyMembers=[]; state.scheduled=[];
      state._scFiltered=null;
    }
    if (typeof DB !== 'undefined') {
      if (DB._cache) DB._cache={};
      if (DB.accounts?.invalidate) DB.accounts.invalidate();
      if (DB.categories?.invalidate) DB.categories.invalidate();
    }
    // Clear module-level caches
    if (typeof _dbt !== 'undefined') { _dbt.debts=[]; _dbt.loaded=false; }
    if (typeof _drm !== 'undefined') { _drm.dreams=[]; _drm.loaded=false; }
    if (typeof _loy !== 'undefined') { _loy.programs=[]; _loy.loaded=false; }

    await new Promise(r => setTimeout(r, 600));
    toast('🔄 Recarregando…', 'info');
    // Full page reload ensures all modules start fresh
    setTimeout(() => { window.location.reload(); }, 800);

  } catch(e) {
    prog.remove();
    toast('Erro ao excluir dados: '+(e.message||e), 'error');
    console.error('[deleteAllFamilyData]', e);
  }
}
window.deleteAllFamilyData = deleteAllFamilyData;

async function _loadDemoSelectors() {
  const famSel  = document.getElementById('demoFamilySelect');
  const userSel = document.getElementById('demoUserSelect');
  if (!famSel) return;

  famSel.innerHTML = '<option value="">⏳ Carregando…</option>';
  try {
    // ── Buscar apenas famílias marcadas como is_demo = true ────────────────
    let families = [];

    // 1. Tentar via RPC get_demo_families (SECURITY DEFINER)
    try {
      const { data: rpcData, error: rpcErr } = await sb.rpc('get_demo_families');
      if (!rpcErr && Array.isArray(rpcData)) {
        families = rpcData;
      }
    } catch(_) {}

    // 2. Fallback: query direta com filtro is_demo
    if (!families.length) {
      try {
        const { data, error } = await sb.from('families')
          .select('id,name,is_demo')
          .eq('is_demo', true)
          .order('name');
        if (!error) families = data || [];
      } catch(_) {}
    }

    // 3. Se ainda vazio, mostrar aviso instrutivo
    if (!families.length) {
      famSel.innerHTML = '<option value="">⚠️ Nenhuma família marcada como demo</option>';
      if (userSel) userSel.innerHTML = '<option value="">— Selecione uma família primeiro —</option>';
      // Show hint
      const hint = document.getElementById('demoFamilyHint');
      if (hint) {
        hint.style.display = '';
        hint.innerHTML = '⚠️ Nenhuma família está marcada como <strong>Demonstração</strong>. ' +
          'Acesse <strong>Configurações → Usuários → Famílias</strong>, edite uma família e ative a flag 🎭 Demo.';
      }
      return;
    }

    // Hide hint if families found
    const hint = document.getElementById('demoFamilyHint');
    if (hint) hint.style.display = 'none';

    famSel.innerHTML = '<option value="">— Selecionar família demo —</option>'
      + families.map(f => `<option value="${f.id}">🎭 ${esc(f.name)}</option>`).join('');
    famSel.onchange = () => _loadDemoUsers(famSel.value);
    // Auto-select if only one demo family
    if (families.length === 1) {
      famSel.value = families[0].id;
      _loadDemoUsers(families[0].id);
    }
  } catch(e) {
    famSel.innerHTML = `<option value="">Erro: ${e.message}</option>`;
    console.error('[_loadDemoSelectors]', e);
  }
}

async function _loadDemoUsers(familyId) {
  const userSel = document.getElementById('demoUserSelect');
  if (!userSel) return;
  if (!familyId) { userSel.innerHTML = '<option value="">— Selecione uma família primeiro —</option>'; return; }

  userSel.innerHTML = '<option value="">⏳ Carregando usuários…</option>';
  try {
    const { data: members, error } = await sb.from('app_users')
      .select('id,name,email,family_id')
      .eq('family_id', familyId)
      .order('name');
    if (error) throw error;
    const list = members || [];
    userSel.innerHTML = '<option value="">— Selecionar usuário —</option>'
      + list.map(u => `<option value="${u.id}">${esc(u.name||u.email||u.id)}</option>`).join('');
    // Auto-select current user if in this family
    if (currentUser && currentUser.family_id === familyId) {
      const me = list.find(u => u.id === currentUser.id);
      if (me) userSel.value = me.id;
    } else if (list.length === 1) {
      userSel.value = list[0].id;
    }
  } catch(e) {
    userSel.innerHTML = `<option value="">Erro: ${e.message}</option>`;
    console.error('[_loadDemoUsers]', e);
  }
}


// ── Purge all family data before demo import ─────────────────────────────
async function _purgeFamilyForDemo(fid) {
  if (!fid) return;
  const tables = [
    'ai_insight_recommendations','ai_insight_snapshots',
    'price_history','grocery_items','grocery_lists','price_stores','price_items',
    'debt_ledger','debts','dream_items','dream_contributions','dreams',
    'investment_price_history','investment_transactions','investment_positions',
    'scheduled_occurrences','scheduled_run_logs','scheduled_ar_records','scheduled_transactions',
    'budgets','financial_objectives',
    'transactions','accounts','account_groups',
    'categories','payees','family_composition',
  ];
  for (const table of tables) {
    try { await sb.from(table).delete().eq('family_id', fid); }
    catch(e) { console.warn('[purgeDemo]', table, e?.message); }
  }
  console.log('[purgeDemo] Done:', fid);
}

async function _startDemoImport() {
  const familyId = document.getElementById('demoFamilySelect')?.value;
  const userId   = document.getElementById('demoUserSelect')?.value;
  const btn      = document.getElementById('demoImportBtn');
  const progress = document.getElementById('demoImportProgress');
  const statusEl = document.getElementById('demoImportStatus');
  const pctEl    = document.getElementById('demoImportPct');
  const barEl    = document.getElementById('demoImportBar');
  const resultEl = document.getElementById('demoImportResult');

  if (!familyId) { toast('Selecione uma família.','warning'); return; }
  if (!userId)   { toast('Selecione um usuário.','warning'); return; }

  const fam = document.getElementById('demoFamilySelect')?.options[document.getElementById('demoFamilySelect').selectedIndex]?.text;
  const usr = document.getElementById('demoUserSelect')?.options[document.getElementById('demoUserSelect').selectedIndex]?.text;

  if (!confirm(`⚠️ ATENÇÃO: Importar dados demo para:\n\nFamília: ${fam}\nUsuário: ${usr}\n\nEsta ação VAI APAGAR todos os dados existentes desta família antes de importar os dados de demonstração. Continuar?`)) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Importando…'; }
  if (progress) progress.style.display = '';
  if (resultEl) resultEl.style.display = 'none';

  try {
    // ── STEP 0: Purge existing family data ────────────────────────────
    if (statusEl) statusEl.textContent = '🗑️ Removendo dados existentes…';
    if (barEl) barEl.style.width = '2%';
    await _purgeFamilyForDemo(familyId);
    if (statusEl) statusEl.textContent = '✅ Dados removidos. Importando dados demo…';
    if (barEl) barEl.style.width = '5%';

    const result = await importDemoData(userId, familyId, (msg, pct) => {
      if (statusEl) statusEl.textContent = msg;
      if (pct !== null && barEl) barEl.style.width = pct + '%';
      if (pct !== null && pctEl) pctEl.textContent = pct + '%';
    });

    if (barEl) barEl.style.width = '100%';

    // ── Build per-table summary ──────────────────────────────────────────
    const tr = result.tableResults || {};
    const tableOrder = [
      ['account_groups','Grupos de contas'],['accounts','Contas'],
      ['categories','Categorias'],['payees','Beneficiários'],
      ['transactions','Transações'],['scheduled_transactions','Programados'],
      ['budgets','Orçamentos'],['debts','Dívidas'],['dreams','Sonhos'],
      ['price_items','Itens de preço'],['price_stores','Lojas'],
      ['price_history','Histórico de preços'],['grocery_lists','Lista mercado'],
      ['grocery_items','Itens mercado'],
    ];

    const totalSent = Object.values(tr).reduce((s,t) => s + (t.sent||0), 0);
    const totalOk   = Object.values(tr).reduce((s,t) => s + (t.ok||0), 0);
    const hasErrors = result.errors && result.errors.length > 0;

    const rows = tableOrder.map(([key, label]) => {
      const t = tr[key];
      if (!t) return '';
      const icon = t.errors?.length ? '❌' : t.ok === 0 && t.sent === 0 ? '⚪' : '✅';
      const errMsg = t.errors?.length ? `<div style="font-size:.67rem;color:#dc2626;margin-top:2px">${esc(t.errors[0])}</div>` : '';
      return `<tr>
        <td style="padding:5px 8px;font-size:.77rem;color:var(--text)">${icon} ${esc(label)}</td>
        <td style="padding:5px 8px;font-size:.77rem;text-align:right;color:var(--muted)">${t.sent}</td>
        <td style="padding:5px 8px;font-size:.77rem;text-align:right;font-weight:700;color:${t.ok===t.sent?'#16a34a':t.ok>0?'#d97706':'#dc2626'}">${t.ok}</td>
        <td style="padding:5px 8px;font-size:.73rem;color:#dc2626">${t.errors?.length||''}</td>
      </tr>` + (errMsg ? `<tr><td colspan="4" style="padding:0 8px 6px 28px">${errMsg}</td></tr>` : '');
    }).join('');

    if (resultEl) {
      resultEl.style.display = '';
      resultEl.style.background = hasErrors ? '#fff7ed' : '#f0fdf4';
      resultEl.style.border = `1px solid ${hasErrors?'#fed7aa':'#bbf7d0'}`;
      resultEl.style.color = 'var(--text)';
      resultEl.style.padding = '12px 14px';
      resultEl.style.borderRadius = '10px';
      resultEl.innerHTML = `
        <div style="font-weight:800;font-size:.88rem;margin-bottom:10px;color:${hasErrors?'#c2410c':'#166534'}">
          ${hasErrors?'⚠️':'✅'} ${hasErrors?'Importação com avisos':'Importação concluída!'}
        </div>
        <table style="width:100%;border-collapse:collapse;background:var(--surface);border-radius:8px;overflow:hidden;border:1px solid var(--border)">
          <thead>
            <tr style="background:var(--surface2)">
              <th style="padding:6px 8px;font-size:.68rem;font-weight:700;color:var(--muted);text-align:left;text-transform:uppercase">Tabela</th>
              <th style="padding:6px 8px;font-size:.68rem;font-weight:700;color:var(--muted);text-align:right;text-transform:uppercase">Gerado</th>
              <th style="padding:6px 8px;font-size:.68rem;font-weight:700;color:var(--muted);text-align:right;text-transform:uppercase">Inserido</th>
              <th style="padding:6px 8px;font-size:.68rem;font-weight:700;color:var(--muted);text-align:center;text-transform:uppercase">Erros</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:var(--surface2);border-top:1.5px solid var(--border)">
              <td style="padding:6px 8px;font-size:.77rem;font-weight:800">Total</td>
              <td style="padding:6px 8px;font-size:.77rem;font-weight:800;text-align:right">${totalSent}</td>
              <td style="padding:6px 8px;font-size:.77rem;font-weight:800;text-align:right;color:${hasErrors?'#d97706':'#16a34a'}">${totalOk}</td>
              <td style="padding:6px 8px;font-size:.77rem;font-weight:800;text-align:center;color:${hasErrors?'#dc2626':'#9ca3af'}">${result.errors?.length||0}</td>
            </tr>
          </tfoot>
        </table>
        ${hasErrors ? `<div style="margin-top:8px;font-size:.72rem;color:#c2410c">Veja o console do navegador para detalhes dos erros.</div>` : ''}`;
    }
    toast(hasErrors ? '⚠️ Importação concluída com avisos' : '✅ Dados demo importados!', hasErrors ? 'warning' : 'success');

  } catch(e) {
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.style.background = '#fee2e2';
      resultEl.style.border = '1px solid #fca5a5';
      resultEl.style.color = '#991b1b';
      resultEl.innerHTML = `❌ Erro: ${esc(e.message||String(e))}`;
    }
    toast('Erro na importação: ' + (e.message||e), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎭 Gerar e Importar Dados Demo'; }
  }
}
window._loadDemoSelectors = _loadDemoSelectors;
window._loadDemoUsers     = _loadDemoUsers;
window._startDemoImport   = _startDemoImport;

window._load2FAIntoProfile                 = _load2FAIntoProfile;
window.advancePinStep                      = advancePinStep;
window.clearServiceRoleKey                 = clearServiceRoleKey;
window.copyEjField                         = copyEjField;
window.ensureSupabaseClient                = ensureSupabaseClient;
window.getAppSetting                       = getAppSetting;
window.getMasterPin                        = getMasterPin;
window.getUserPreference                   = getUserPreference;
window.initEmailJSStatus                   = initEmailJSStatus;
window.isNotifChannelEnabled               = isNotifChannelEnabled;
window.loadAppSettings                     = loadAppSettings;
window.loadNotifChannelSettings            = loadNotifChannelSettings;
window.loadSettings                        = loadSettings;
window.openNormalizeNamesPreview           = openNormalizeNamesPreview;
window.openTelegramLinkFlow                = openTelegramLinkFlow;
window.resetAppLogo                        = resetAppLogo;
window.runNormalizeNames                   = runNormalizeNames;
window.saveAppLogo                         = saveAppLogo;
window.saveAppSetting                      = saveAppSetting;
window.saveEmailJSConfig                   = saveEmailJSConfig;
window.saveServiceRoleKey                  = saveServiceRoleKey;
window.showEmailConfig                     = showEmailConfig;
window.testEmailJSConnection               = testEmailJSConnection;
window.toggleEjKey                         = toggleEjKey;
