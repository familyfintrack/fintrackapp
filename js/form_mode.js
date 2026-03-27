// ── form_mode.js ─────────────────────────────────────────────────────────
// Controls "Abas por contexto" vs "Wizard passo a passo" for txModal and
// scheduledModal. Reads from user preference (localStorage + app_users).
// Exported globals: getTxFormMode(), initTxFormMode(), initScFormMode(),
//   switchTxTab(), switchScTab(), txWizardNext(), txWizardPrev(),
//   scWizardNext(), scWizardPrev(), selectFormMode()
// ─────────────────────────────────────────────────────────────────────────

// ── Preference helpers ────────────────────────────────────────────────────

function getTxFormMode() {
  try {
    // DB value (via currentUser) is authoritative — synced to localStorage on login
    if (window.currentUser?.preferred_form_mode) {
      return window.currentUser.preferred_form_mode === 'wizard' ? 'wizard' : 'tabs';
    }
    // Fallback: localStorage (covers pre-login render or missing column)
    const uid = window.currentUser?.id || 'local';
    const stored = localStorage.getItem(`pref_${uid}_global_form_mode`);
    return stored === 'wizard' ? 'wizard' : 'tabs';
  } catch(e) { return 'tabs'; }
}

function _persistFormMode(mode) {
  // localStorage sync only — DB is written by auth.js saveMyProfile via app_users column
  try {
    const uid = window.currentUser?.id || 'local';
    localStorage.setItem(`pref_${uid}_global_form_mode`, mode);
  } catch(e) {}
}

// Called from profile modal card clicks
function selectFormMode(mode) {
  const tabsBtn   = document.getElementById('formModeTabsBtn');
  const wizardBtn = document.getElementById('formModeWizardBtn');
  const hidden    = document.getElementById('myProfileFormMode');
  if (!tabsBtn || !wizardBtn) return;

  const accentBorder = '1.5px solid var(--accent)';
  const accentBg     = 'var(--accent-lt,#e8f2ee)';
  const neutralBorder= '1.5px solid var(--border)';

  if (mode === 'tabs') {
    tabsBtn.style.border      = accentBorder;
    tabsBtn.style.background  = accentBg;
    tabsBtn.querySelector('div').style.color = 'var(--accent)';
    wizardBtn.style.border    = neutralBorder;
    wizardBtn.style.background= 'transparent';
    wizardBtn.querySelector('div').style.color = 'var(--text2)';
  } else {
    wizardBtn.style.border    = accentBorder;
    wizardBtn.style.background= accentBg;
    wizardBtn.querySelector('div').style.color = 'var(--accent)';
    tabsBtn.style.border      = neutralBorder;
    tabsBtn.style.background  = 'transparent';
    tabsBtn.querySelector('div').style.color = 'var(--text2)';
  }
  if (hidden) hidden.value = mode;
}

// Called by auth.js loadMyProfile() to reflect current pref
function loadFormModeIntoProfile() {
  const mode = getTxFormMode();
  selectFormMode(mode);
}

// Hook into saveMyProfile — called after profile save succeeds
function _saveFormModeFromProfile() {
  const hidden = document.getElementById('myProfileFormMode');
  const mode   = hidden?.value || 'tabs';
  const uid    = window.currentUser?.id || 'local';
  try { localStorage.setItem(`pref_${uid}_global_form_mode`, mode); } catch(e) {}
  _persistFormMode(mode);
}

// ── Generic helpers ───────────────────────────────────────────────────────

function _showPane(paneId) {
  const el = document.getElementById(paneId);
  if (el) { el.style.display = ''; el.style.removeProperty('display'); el.style.display = 'block'; }
}
function _hidePane(paneId) {
  const el = document.getElementById(paneId);
  if (el) el.style.display = 'none';
}

function _allPanes(prefix) {
  // returns array of pane element ids belonging to a modal prefix (tx or sc)
  if (prefix === 'tx') return ['txCtxPrincipal','txCtxDetalhes','txCtxAnexo'];
  if (prefix === 'sc') return ['scCtxPrincipal','scCtxDetalhes','scCtxRecorrencia','scCtxNotificacoes'];
  return [];
}

// ── TX MODAL ─────────────────────────────────────────────────────────────

var _txCurrentStep = 0;
var _txTotalSteps  = 3; // Principal, Detalhes, Anexo

function initTxFormMode() {
  const mode    = getTxFormMode();
  const tabBar  = document.getElementById('txContextTabBar');
  const wzSteps = document.getElementById('txWizardSteps');
  const wzNav   = document.getElementById('txWizardNav');
  const saveBtn = document.getElementById('txSaveBtn');
  const panes   = _allPanes('tx');

  // Always reset to first pane
  _txCurrentStep = 0;
  panes.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i === 0 ? '' : 'none';
  });

  if (mode === 'tabs') {
    if (tabBar)  tabBar.style.display = 'flex';
    if (wzSteps) wzSteps.style.display = 'none';
    if (wzNav)   wzNav.style.display  = 'none';
    if (saveBtn) saveBtn.style.display = '';
    // Reset active tab highlight
    document.querySelectorAll('#txContextTabBar .tx-ctx-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
  } else {
    // Wizard
    if (tabBar)  tabBar.style.display = 'none';
    if (wzSteps) { wzSteps.style.display = ''; _txRenderWizardSteps(); }
    if (wzNav)   { wzNav.style.display = 'flex'; _txRenderWizardNav(); }
    if (saveBtn) saveBtn.style.display = 'none';
  }
}

function switchTxTab(paneId, btnEl) {
  _allPanes('tx').forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
  document.querySelectorAll('#txContextTabBar .tx-ctx-tab').forEach(btn => {
    btn.classList.toggle('active', btn === btnEl);
  });
}

function _txRenderWizardSteps() {
  const bar = document.getElementById('txWzStepsBar');
  if (!bar) return;
  bar.querySelectorAll('.wz-step').forEach((el, i) => {
    el.classList.remove('active','done');
    if (i < _txCurrentStep) el.classList.add('done');
    else if (i === _txCurrentStep) el.classList.add('active');
  });
}

function _txRenderWizardNav() {
  const prev  = document.getElementById('txWzPrev');
  const next  = document.getElementById('txWzNext');
  const save  = document.getElementById('txSaveBtn');
  const label = document.getElementById('txWzStepLabel');
  if (!prev || !next || !save) return;
  const labels = ['Passo 1 de 3','Passo 2 de 3','Passo 3 de 3'];
  if (label) label.textContent = labels[_txCurrentStep] || '';
  prev.style.display = _txCurrentStep > 0 ? '' : 'none';
  const isLast = _txCurrentStep >= _txTotalSteps - 1;
  next.style.display = isLast ? 'none' : '';
  save.style.display = isLast ? '' : 'none';
}

function txWizardNext() {
  if (_txCurrentStep >= _txTotalSteps - 1) return;
  // hide current
  const cur = _allPanes('tx')[_txCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _txCurrentStep++;
  // show next
  const nxt = _allPanes('tx')[_txCurrentStep];
  if (nxt) document.getElementById(nxt).style.display = '';
  _txRenderWizardSteps();
  _txRenderWizardNav();
  // scroll to top
  const body = document.querySelector('#txModal .modal-body');
  if (body) body.scrollTop = 0;
}

function txWizardPrev() {
  if (_txCurrentStep <= 0) return;
  const cur = _allPanes('tx')[_txCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _txCurrentStep--;
  const prv = _allPanes('tx')[_txCurrentStep];
  if (prv) document.getElementById(prv).style.display = '';
  _txRenderWizardSteps();
  _txRenderWizardNav();
  const body = document.querySelector('#txModal .modal-body');
  if (body) body.scrollTop = 0;
}

// ── SCHEDULED MODAL ───────────────────────────────────────────────────────

var _scCurrentStep = 0;
var _scTotalSteps  = 4; // Principal, Detalhes, Recorrência, Notificações

function initScFormMode() {
  const mode    = getTxFormMode();
  const tabBar  = document.getElementById('scContextTabBar');
  const wzSteps = document.getElementById('scWizardSteps');
  const wzNav   = document.getElementById('scWizardNav');
  const saveBtn = document.getElementById('scSaveBtn');
  const panes   = _allPanes('sc');

  _scCurrentStep = 0;
  panes.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i === 0 ? '' : 'none';
  });

  if (mode === 'tabs') {
    if (tabBar)  tabBar.style.display = 'flex';
    if (wzSteps) wzSteps.style.display = 'none';
    if (wzNav)   wzNav.style.display  = 'none';
    if (saveBtn) saveBtn.style.display = '';
    document.querySelectorAll('#scContextTabBar .tx-ctx-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0);
    });
  } else {
    if (tabBar)  tabBar.style.display = 'none';
    if (wzSteps) { wzSteps.style.display = ''; _scRenderWizardSteps(); }
    if (wzNav)   { wzNav.style.display = 'flex'; _scRenderWizardNav(); }
    if (saveBtn) saveBtn.style.display = 'none';
  }
}

function switchScTab(paneId, btnEl) {
  _allPanes('sc').forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === paneId ? '' : 'none';
  });
  document.querySelectorAll('#scContextTabBar .tx-ctx-tab').forEach(btn => {
    btn.classList.toggle('active', btn === btnEl);
  });
}

function _scRenderWizardSteps() {
  const bar = document.getElementById('scWzStepsBar');
  if (!bar) return;
  bar.querySelectorAll('.wz-step').forEach((el, i) => {
    el.classList.remove('active','done');
    if (i < _scCurrentStep) el.classList.add('done');
    else if (i === _scCurrentStep) el.classList.add('active');
  });
}

function _scRenderWizardNav() {
  const prev  = document.getElementById('scWzPrev');
  const next  = document.getElementById('scWzNext');
  const save  = document.getElementById('scSaveBtn');
  const label = document.getElementById('scWzStepLabel');
  if (!prev || !next || !save) return;
  const labels = ['Passo 1 de 4','Passo 2 de 4','Passo 3 de 4','Passo 4 de 4'];
  if (label) label.textContent = labels[_scCurrentStep] || '';
  prev.style.display = _scCurrentStep > 0 ? '' : 'none';
  const isLast = _scCurrentStep >= _scTotalSteps - 1;
  next.style.display = isLast ? 'none' : '';
  save.style.display = isLast ? '' : 'none';
}

function scWizardNext() {
  if (_scCurrentStep >= _scTotalSteps - 1) return;
  const cur = _allPanes('sc')[_scCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _scCurrentStep++;
  const nxt = _allPanes('sc')[_scCurrentStep];
  if (nxt) document.getElementById(nxt).style.display = '';
  _scRenderWizardSteps();
  _scRenderWizardNav();
  const body = document.querySelector('#scheduledModal .modal-body');
  if (body) body.scrollTop = 0;
}

function scWizardPrev() {
  if (_scCurrentStep <= 0) return;
  const cur = _allPanes('sc')[_scCurrentStep];
  if (cur) document.getElementById(cur).style.display = 'none';
  _scCurrentStep--;
  const prv = _allPanes('sc')[_scCurrentStep];
  if (prv) document.getElementById(prv).style.display = '';
  _scRenderWizardSteps();
  _scRenderWizardNav();
  const body = document.querySelector('#scheduledModal .modal-body');
  if (body) body.scrollTop = 0;
}

// expose globals
window.getTxFormMode           = getTxFormMode;
window.initTxFormMode          = initTxFormMode;
window.initScFormMode          = initScFormMode;
window.switchTxTab             = switchTxTab;
window.switchScTab             = switchScTab;
window.txWizardNext            = txWizardNext;
window.txWizardPrev            = txWizardPrev;
window.scWizardNext            = scWizardNext;
window.scWizardPrev            = scWizardPrev;
window.selectFormMode          = selectFormMode;
window.loadFormModeIntoProfile = loadFormModeIntoProfile;
window._saveFormModeFromProfile= _saveFormModeFromProfile;
