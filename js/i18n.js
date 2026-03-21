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


// ── Dicionário embutido — funciona sem banco de dados ────────────────────────
// Garante que os labels do nav e da tela de login aparecem traduzidos mesmo
// quando a tabela i18n_translations ainda não existe no Supabase.
// Formato: { chave: { pt, en, es, fr } }
const _I18N_BUILTIN = {
  // Navegação
  'nav.dashboard':        {pt:'Início',        en:'Home',          es:'Inicio',          fr:'Accueil'},
  'nav.transactions':     {pt:'Transações',    en:'Transactions',  es:'Transacciones',   fr:'Transactions'},
  'nav.accounts':         {pt:'Contas',        en:'Accounts',      es:'Cuentas',         fr:'Comptes'},
  'nav.reports':          {pt:'Relatórios',    en:'Reports',       es:'Informes',        fr:'Rapports'},
  'nav.budgets':          {pt:'Orçamentos',    en:'Budgets',       es:'Presupuestos',    fr:'Budgets'},
  'nav.categories':       {pt:'Categorias',    en:'Categories',    es:'Categorías',      fr:'Catégories'},
  'nav.payees':           {pt:'Beneficiários', en:'Payees',        es:'Beneficiarios',   fr:'Bénéficiaires'},
  'nav.scheduled':        {pt:'Programados',   en:'Scheduled',     es:'Programados',     fr:'Programmés'},
  'nav.grocery':          {pt:'Mercado',       en:'Grocery',       es:'Mercado',         fr:'Courses'},
  'nav.prices':           {pt:'Preços',        en:'Prices',        es:'Precios',         fr:'Prix'},
  'nav.investments':      {pt:'Investimentos', en:'Investments',   es:'Inversiones',     fr:'Investissements'},
  'nav.ai_insights':      {pt:'AI Insights',   en:'AI Insights',   es:'Perspectivas IA', fr:'Aperçus IA'},
  'nav.more':             {pt:'Mais',          en:'More',          es:'Más',             fr:'Plus'},
  // Seções do sidebar
  'nav.section_main':     {pt:'Principal',     en:'Main',          es:'Principal',       fr:'Principal'},
  'nav.section_analysis': {pt:'Análise',       en:'Analysis',      es:'Análisis',        fr:'Analyse'},
  'nav.section_planning': {pt:'Planejamento',  en:'Planning',      es:'Planificación',   fr:'Planification'},
  'nav.section_data':     {pt:'Cadastros',     en:'Records',       es:'Registros',       fr:'Enregistrements'},
  'nav.section_modules':  {pt:'Módulos',       en:'Modules',       es:'Módulos',         fr:'Modules'},
  // Autenticação
  'auth.tagline':          {pt:'Família inteligente, Finanças sob controle', en:'Smart family, Finances under control', es:'Familia inteligente, Finanzas bajo control', fr:'Famille intelligente, Finances maîtrisées'},
  'auth.login_tab_pwd':    {pt:'🔑 Senha',      en:'🔑 Password',   es:'🔑 Contraseña',   fr:'🔑 Mot de passe'},
  'auth.login_tab_magic':  {pt:'✉️ Link por E-mail', en:'✉️ Email Link', es:'✉️ Enlace por correo', fr:'✉️ Lien par e-mail'},
  'auth.label_email':      {pt:'E-mail',        en:'Email',         es:'Correo',          fr:'E-mail'},
  'auth.label_password':   {pt:'Senha',         en:'Password',      es:'Contraseña',      fr:'Mot de passe'},
  'auth.remember_me':      {pt:'Lembrar meu e-mail e senha', en:'Remember my email and password', es:'Recordar mi correo y contraseña', fr:'Se souvenir de mon e-mail et mot de passe'},
  'auth.btn_enter':        {pt:'Entrar',        en:'Sign In',       es:'Ingresar',        fr:'Se connecter'},
  'auth.forgot_password':  {pt:'Esqueci minha senha', en:'Forgot my password', es:'Olvidé mi contraseña', fr:'Mot de passe oublié'},
  'auth.no_account':       {pt:'Não tem conta?', en:'No account?',  es:'¿No tienes cuenta?', fr:'Pas de compte ?'},
  'auth.request_access':   {pt:'Solicitar acesso', en:'Request access', es:'Solicitar acceso', fr:"Demander l\'accès"},
  'auth.btn_send_link':    {pt:'✉️ Enviar Link de Acesso', en:'✉️ Send Access Link', es:'✉️ Enviar enlace', fr:'✉️ Envoyer le lien'},
  'auth.btn_send_recovery':{pt:'Enviar Link de Recuperação', en:'Send Recovery Link', es:'Enviar enlace de recuperación', fr:'Envoyer le lien de récupération'},
  'auth.btn_set_password': {pt:'Salvar Nova Senha', en:'Save New Password', es:'Guardar nueva contraseña', fr:'Enregistrer le mot de passe'},
  'auth.btn_set_enter':    {pt:'Definir Senha e Entrar', en:'Set Password & Sign In', es:'Definir contraseña e ingresar', fr:'Définir le mot de passe et se connecter'},
  // Cadastro
  'register.btn_submit':   {pt:'Enviar Solicitação', en:'Submit Request', es:'Enviar solicitud', fr:'Envoyer la demande'},
  // Títulos de páginas
  'page.dashboard':        {pt:'Dashboard',     en:'Dashboard',     es:'Panel',           fr:'Tableau de bord'},
  'page.transactions':     {pt:'Transações',    en:'Transactions',  es:'Transacciones',   fr:'Transactions'},
  'page.accounts':         {pt:'Contas',        en:'Accounts',      es:'Cuentas',         fr:'Comptes'},
  'page.reports':          {pt:'Relatórios',    en:'Reports',       es:'Informes',        fr:'Rapports'},
  'page.budgets':          {pt:'Orçamentos',    en:'Budgets',       es:'Presupuestos',    fr:'Budgets'},
  'page.categories':       {pt:'Categorias',    en:'Categories',    es:'Categorías',      fr:'Catégories'},
  'page.payees':           {pt:'Beneficiários', en:'Payees',        es:'Beneficiarios',   fr:'Bénéficiaires'},
  'page.scheduled':        {pt:'Programados',   en:'Scheduled',     es:'Programados',     fr:'Programmés'},
  'page.investments':      {pt:'Investimentos', en:'Investments',   es:'Inversiones',     fr:'Investissements'},
  'page.prices':           {pt:'Preços',        en:'Prices',        es:'Precios',         fr:'Prix'},
  'page.ai_insights':      {pt:'🤖 AI Insights', en:'🤖 AI Insights', es:'🤖 Perspectivas IA', fr:'🤖 Aperçus IA'},
  'page.grocery':          {pt:'🛒 Mercado',    en:'🛒 Grocery',    es:'🛒 Mercado',       fr:'🛒 Courses'},
  'page.import':           {pt:'Importar / Backup', en:'Import / Backup', es:'Importar / Respaldo', fr:'Importer / Sauvegarde'},
  'page.settings':         {pt:'Configurações', en:'Settings',      es:'Configuración',   fr:'Paramètres'},
  'page.translations':     {pt:'Traduções',     en:'Translations',  es:'Traducciones',    fr:'Traductions'},
};

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
  // Fallback 1: dicionário embutido (funciona sem banco)
  if (!str) {
    const entry = _I18N_BUILTIN[key];
    if (entry) str = entry[_i18nLang] || entry['pt'] || null;
  }
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

  // Textos — só atualiza se tradução encontrada (preserva texto original)
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    let str = _i18nDict[key];
    if (!str) {
      const entry = _I18N_BUILTIN[key];
      if (entry) str = entry[_i18nLang] || entry['pt'] || null;
    }
    if (str) el.textContent = str;
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

// Auto-aplicar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    i18nApplyToDOM(document);
    i18nOnReady(() => i18nApplyToDOM(document));
  }, 0);
});

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
