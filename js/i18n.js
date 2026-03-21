/* ═══════════════════════════════════════════════════════════════════════════
   I18N SERVICE — Family FinTrack
   Sistema de internacionalização completo.

   Fluxo:
     1. Carrega do Supabase tabela `i18n_translations` (ou cache local)
     2. Escolhe idioma: user pref → browser → 'pt' (fallback)
     3. t(key, vars?) → string traduzida com interpolação {{var}}
     4. Troca de idioma: i18n.setLanguage(lang) → re-renderiza UI dinâmica

   Idiomas suportados de fábrica: pt (padrão), en, es, fr
   Novos idiomas: só adicionar coluna na tabela — zero mudanças no código.

   Dependências: sb (Supabase client via supabase.js), state (state.js)
   Deve ser carregado APÓS supabase.js e state.js, ANTES de app.js.
═══════════════════════════════════════════════════════════════════════════ */

// ── Constantes ──────────────────────────────────────────────────────────────
const I18N_DEFAULT_LANG   = 'pt';
const I18N_SUPPORTED      = ['pt', 'en', 'es', 'fr'];
const I18N_CACHE_KEY      = 'fintrack_i18n_cache';
const I18N_CACHE_LANG_KEY = 'fintrack_i18n_lang';
const I18N_CACHE_TTL_MS   = 60 * 60 * 1000; // 1h

// ── Estado interno ───────────────────────────────────────────────────────────
let _i18nLang  = I18N_DEFAULT_LANG;
let _i18nDict  = {};   // { 'key': 'translated string' }
let _i18nReady = false;
let _i18nReadyCallbacks = [];

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Traduz uma chave.
 * @param {string} key   e.g. "dashboard.title"
 * @param {Object} vars  e.g. { name: 'João', count: 3 }
 * @returns {string}
 */
function t(key, vars) {
  let str = _i18nDict[key];
  if (!str) str = _i18nFallback(key);
  if (!str) str = key; // último recurso: mostra a chave

  if (vars && typeof vars === 'object') {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : `{{${k}}}`
    );
  }
  return str;
}

/**
 * Inicializa o i18n: carrega traduções do banco/cache.
 * Chamado uma vez no boot do app.
 */
async function i18nInit() {
  try {
    // 1. Detecta idioma preferido
    const savedLang = localStorage.getItem(I18N_CACHE_LANG_KEY) || I18N_DEFAULT_LANG;
    _i18nLang = I18N_SUPPORTED.includes(savedLang) ? savedLang : I18N_DEFAULT_LANG;

    // 2. Tenta cache local válido
    const cached = _i18nReadCache(_i18nLang);
    if (cached) {
      _i18nDict  = cached;
      _i18nReady = true;
      _i18nRunCallbacks();
      // Revalida em background
      _i18nLoadFromDB(_i18nLang, true);
      return;
    }

    // 3. Carrega do banco
    await _i18nLoadFromDB(_i18nLang, false);

  } catch (e) {
    console.warn('[i18n] Init failed, using keys as fallback:', e.message);
    _i18nReady = true;
    _i18nRunCallbacks();
  }
}

/**
 * Muda o idioma do usuário e re-renderiza elementos marcados com data-i18n.
 * Persiste a preferência no localStorage E no perfil do usuário (Supabase).
 */
async function i18nSetLanguage(lang) {
  if (!I18N_SUPPORTED.includes(lang)) {
    console.warn('[i18n] Unsupported language:', lang);
    return;
  }
  _i18nLang = lang;
  localStorage.setItem(I18N_CACHE_LANG_KEY, lang);

  // Carrega novas traduções
  const cached = _i18nReadCache(lang);
  if (cached) {
    _i18nDict = cached;
  } else {
    await _i18nLoadFromDB(lang, false);
  }

  // Atualiza todos os elementos data-i18n na página
  i18nApplyToDOM();

  // Persiste no perfil do usuário (best-effort)
  if (window.sb && window.currentUser?.id) {
    try {
      await sb.from('app_users')
        .update({ preferred_language: lang })
        .eq('id', currentUser.id);
      if (window.currentUser) window.currentUser.preferred_language = lang;
    } catch(e) {
      console.warn('[i18n] Could not save language preference:', e.message);
    }
  }

  // Atualiza o html lang attribute
  document.documentElement.lang = _i18nLangToLocale(lang);

  // Dispara evento para que módulos possam re-renderizar
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
}

/**
 * Retorna o idioma atual.
 */
function i18nGetLanguage() { return _i18nLang; }

/**
 * Aplica traduções a todos os elementos com data-i18n na DOM.
 * Também aplica data-i18n-placeholder e data-i18n-title.
 */
function i18nApplyToDOM(root) {
  const scope = root || document;

  // Textos
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });

  // Placeholders
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });

  // Title/aria-label
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  // HTML content (use sparingly — XSS risk, only for trusted keys)
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });
}

/**
 * Registra callback para quando as traduções estiverem prontas.
 */
function i18nOnReady(cb) {
  if (_i18nReady) { cb(); return; }
  _i18nReadyCallbacks.push(cb);
}

/**
 * Retorna lista de idiomas disponíveis com labels.
 */
function i18nGetAvailableLanguages() {
  return [
    { code: 'pt', label: 'Português', flag: '🇧🇷' },
    { code: 'en', label: 'English',   flag: '🇺🇸' },
    { code: 'es', label: 'Español',   flag: '🇪🇸' },
    { code: 'fr', label: 'Français',  flag: '🇫🇷' },
  ];
}

// ── Admin API (usado pelo painel de traduções) ────────────────────────────────

/** Carrega TODAS as traduções de TODOS os idiomas (para o admin). */
async function i18nAdminLoadAll() {
  const { data, error } = await sb
    .from('i18n_translations')
    .select('*')
    .order('key_name');
  if (error) throw error;
  return data || [];
}

/** Salva / atualiza uma linha de tradução. */
async function i18nAdminSave(row) {
  // row: { key_name, section, pt, en, es, fr, description }
  const { data, error } = await sb
    .from('i18n_translations')
    .upsert(row, { onConflict: 'key_name' })
    .select()
    .single();
  if (error) throw error;
  // Invalida cache de todos os idiomas
  I18N_SUPPORTED.forEach(lang => _i18nClearCache(lang));
  return data;
}

/** Deleta uma chave de tradução. */
async function i18nAdminDelete(keyName) {
  const { error } = await sb
    .from('i18n_translations')
    .delete()
    .eq('key_name', keyName);
  if (error) throw error;
  I18N_SUPPORTED.forEach(lang => _i18nClearCache(lang));
}

/** Força recarga do cache do idioma atual. */
async function i18nReload() {
  _i18nClearCache(_i18nLang);
  await _i18nLoadFromDB(_i18nLang, false);
  i18nApplyToDOM();
}

// ── Internos ─────────────────────────────────────────────────────────────────

async function _i18nLoadFromDB(lang, background) {
  if (!window.sb) return;
  try {
    const col = lang === 'pt' ? 'default_text' : lang;
    const { data, error } = await sb
      .from('i18n_translations')
      .select(`key_name,${col}`)
      .order('key_name');

    if (error) throw error;

    const dict = {};
    (data || []).forEach(row => {
      const text = row[col] || row['default_text'] || row['key_name'];
      if (text) dict[row.key_name] = text;
    });

    _i18nDict = dict;
    _i18nWriteCache(lang, dict);

    if (!background) {
      _i18nReady = true;
      _i18nRunCallbacks();
    }
  } catch(e) {
    console.warn('[i18n] DB load failed:', e.message);
    if (!background) {
      _i18nReady = true;
      _i18nRunCallbacks();
    }
  }
}

function _i18nFallback(key) {
  // Se o dicionário atual não tem a chave, tenta pt
  // (para os casos onde pt é o padrão e outros idiomas têm lacunas)
  return null;
}

function _i18nReadCache(lang) {
  try {
    const raw = localStorage.getItem(`${I18N_CACHE_KEY}_${lang}`);
    if (!raw) return null;
    const { ts, dict } = JSON.parse(raw);
    if (Date.now() - ts > I18N_CACHE_TTL_MS) { localStorage.removeItem(`${I18N_CACHE_KEY}_${lang}`); return null; }
    return dict;
  } catch { return null; }
}

function _i18nWriteCache(lang, dict) {
  try {
    localStorage.setItem(`${I18N_CACHE_KEY}_${lang}`, JSON.stringify({ ts: Date.now(), dict }));
  } catch(e) {
    console.warn('[i18n] Cache write failed:', e.message);
  }
}

function _i18nClearCache(lang) {
  localStorage.removeItem(`${I18N_CACHE_KEY}_${lang}`);
}

function _i18nRunCallbacks() {
  _i18nReadyCallbacks.forEach(cb => { try { cb(); } catch(e) { console.warn(e); } });
  _i18nReadyCallbacks = [];
}

function _i18nLangToLocale(lang) {
  return { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR' }[lang] || lang;
}

// Expõe globalmente
window.t               = t;
window.i18nInit        = i18nInit;
window.i18nSetLanguage = i18nSetLanguage;
window.i18nGetLanguage = i18nGetLanguage;
window.i18nApplyToDOM  = i18nApplyToDOM;
window.i18nOnReady     = i18nOnReady;
window.i18nGetAvailableLanguages = i18nGetAvailableLanguages;
window.i18nAdminLoadAll = i18nAdminLoadAll;
window.i18nAdminSave    = i18nAdminSave;
window.i18nAdminDelete  = i18nAdminDelete;
window.i18nReload       = i18nReload;
