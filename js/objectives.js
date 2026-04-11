// ── Objetivos / Projetos — Monitoramento de gastos por objetivo ─────────────
// Escopo: família (family_id). Vinculável a transações (objective_id).

'use strict';

// ── Estado ───────────────────────────────────────────────────────────────────
let _objList   = [];
let _objLoaded = false;

// ── Helpers ──────────────────────────────────────────────────────────────────
const _objFamId = () => (typeof famId === 'function' ? famId() : null);
const _objFmt   = v  => (typeof fmt === 'function' ? fmt(v) : 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const _objEsc   = s  => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
const _objToast = (m,t) => (typeof toast === 'function' ? toast(m,t) : console.log(m));
const _objFmtDate = iso => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

// ── Status ───────────────────────────────────────────────────────────────────
function _objStatus(obj) {
  const today = new Date().toISOString().slice(0,10);
  if (obj.status === 'closed') return { label:'Encerrado', cls:'obj-status-closed',  icon:'🔒' };
  if (obj.end_date && today > obj.end_date) return { label:'Expirado',  cls:'obj-status-expired', icon:'⏰' };
  if (today < obj.start_date)              return { label:'Aguardando', cls:'obj-status-waiting', icon:'📅' };
  return { label:'Ativo', cls:'obj-status-active', icon:'🟢' };
}

// ── Carregar ─────────────────────────────────────────────────────────────────
async function loadObjectives(force = false) {
  if (_objLoaded && !force) return _objList;
  const fid = _objFamId();
  if (!fid) return [];
  try {
    const { data, error } = await sb.from('financial_objectives')
      .select('*').eq('family_id', fid).order('start_date', { ascending: false });
    if (error) throw error;
    _objList = data || [];
    _objLoaded = true;
    window._objList = _objList;
  } catch(e) { console.warn('[objectives]', e.message); _objList = []; }
  return _objList;
}

// ── Popular <select> de objetivos ────────────────────────────────────────────
async function populateObjectiveSelect(selectId, selectedId = null, includeEmpty = true) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  await loadObjectives();
  const today = new Date().toISOString().slice(0,10);
  const active = _objList.filter(o => o.status !== 'closed' && (!o.end_date || o.end_date >= today));
  let html = includeEmpty ? '<option value="">— Nenhum objetivo —</option>' : '';
  active.forEach(o => {
    const sel_ = o.id === selectedId ? ' selected' : '';
    html += `<option value="${o.id}"${sel_}>${_objEsc(o.icon||'🎯')} ${_objEsc(o.name)}</option>`;
  });
  if (selectedId && !active.find(o => o.id === selectedId)) {
    const found = _objList.find(o => o.id === selectedId);
    if (found) html += `<option value="${found.id}" selected>${_objEsc(found.icon||'🎯')} ${_objEsc(found.name)} (expirado)</option>`;
  }
  sel.innerHTML = html;
}

// ── Renderizar grade de objetivos ─────────────────────────────────────────────
async function renderObjectivesPage() {
  const container = document.getElementById('objectivesGrid');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">⏳ Carregando…</div>';
  await loadObjectives(true);

  if (!_objList.length) {
    // Set container to centered flex for empty state
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.minHeight = '320px';
    container.innerHTML = `
      <div class="obj-empty">
        <div class="obj-empty-icon">🎯</div>
        <div class="obj-empty-title">Nenhum objetivo criado</div>
        <div class="obj-empty-desc">Crie objetivos para monitorar gastos de projetos específicos — reformas, viagens, casamentos ou qualquer evento especial.</div>
        <button class="btn btn-primary" onclick="openObjectiveModal()" style="padding:11px 28px;font-size:.88rem">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar primeiro objetivo
        </button>
      </div>`;
    return;
  }
  container.style.cssText = '';  // Reset any inline overrides
  container.innerHTML = _objList.map(o => _renderObjectiveCard(o)).join('');
}

function _renderObjectiveCard(o) {
  const st = _objStatus(o);

  // Budget progress bar
  let budgetHtml = '';
  if (o.budget_limit && o.budget_limit > 0) {
    const spent = o._spent || 0;  // enriched by loadObjectives if available
    const pct   = Math.min(100, (spent / o.budget_limit) * 100).toFixed(1);
    const over  = spent > o.budget_limit;
    const _pctSpan = over
      ? '<span style="color:var(--red);font-weight:700">⚠ ' + pct + '%</span>'
      : '<span>' + pct + '%</span>';
    const _fillCls = over ? 'obj-card-budget-fill over' : 'obj-card-budget-fill';
    budgetHtml = '<div class="obj-card-budget">' +
      '<div class="obj-card-budget-label">' +
        '<span>Limite: <strong>' + _objFmt(o.budget_limit) + '</strong></span>' +
        _pctSpan +
      '</div>' +
      '<div class="obj-card-budget-track">' +
        '<div class="' + _fillCls + '" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>';
  }

  const dateRange = o.end_date
    ? (_objFmtDate(o.start_date) + ' → ' + _objFmtDate(o.end_date))
    : ('A partir de ' + _objFmtDate(o.start_date));
  const descHtml = o.description
    ? '<div class="obj-card-desc">' + _objEsc(o.description) + '</div>'
    : '';
  const calIcon = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

  return (
    '<div class="obj-card" data-status="' + (o.status||'active') + '" data-id="' + o.id + '"' +
      ' onclick="openObjectiveDetail(\'' + o.id + '\')">' +
      '<div class="obj-card-header">' +
        '<div class="obj-card-icon">' + (o.icon||'🎯') + '</div>' +
        '<div class="obj-card-info">' +
          '<div class="obj-card-name">' + _objEsc(o.name) + '</div>' +
          '<div class="obj-card-dates">' + calIcon + ' ' + _objEsc(dateRange) + '</div>' +
        '</div>' +
        '<span class="obj-status-badge ' + st.cls + '">' + st.icon + ' ' + st.label + '</span>' +
      '</div>' +
      descHtml +
      budgetHtml +
      '<div class="obj-card-footer">' +
        '<button class="btn" onclick="event.stopPropagation();openObjectiveModal(\'' + o.id + '\')">✏️ Editar</button>' +
        '<button class="btn" onclick="event.stopPropagation();openObjectiveDetail(\'' + o.id + '\')">📊 Ver gastos</button>' +
      '</div>' +
    '</div>'
  );
}

// ── Ícones disponíveis para seleção ──────────────────────────────────────────
const OBJ_ICONS = [
  '🎯','🏠','✈️','🚗','💒','🎓','💻','📱','🏋️','🎸',
  '🍕','🌴','🎉','🏖️','🛍️','💊','🐶','🌱','⚽','🎭',
  '🔧','🎨','📚','💡','🌍','🏗️','🚀','💰','🏦','🛒',
  '👶','💍','🎂','🏥','🚢','🎮','📷','🎵','🌅','🔑',
];

// ── Abrir modal de criação/edição ────────────────────────────────────────────
async function openObjectiveModal(id = null) {
  // Guard: verify modal exists in DOM before proceeding
  const modal = document.getElementById('objectiveModal');
  if (!modal) {
    console.error('[objectives] #objectiveModal not found in DOM');
    if (typeof toast === 'function') toast('Erro interno: modal não encontrado', 'error');
    return;
  }

  try {
    let obj = null;
    if (id) {
      obj = _objList.find(o => o.id === id);
      if (!obj && typeof sb !== 'undefined') {
        const { data } = await sb.from('financial_objectives').select('*').eq('id', id).single();
        obj = data;
      }
    }

    // Safe element setter helper
    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ''; };
    const setText = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val ?? ''; };

    setText('objModalTitle', obj ? 'Editar Objetivo' : 'Novo Objetivo');
    setVal('objId',          obj?.id || '');
    setVal('objName',        obj?.name || '');
    setVal('objDescription', obj?.description || '');
    setVal('objStartDate',   obj?.start_date || new Date().toISOString().slice(0,10));
    setVal('objEndDate',     obj?.end_date || '');
    setVal('objStatus',      obj?.status || 'active');

    // Icon picker
    const currentIcon = obj?.icon || '🎯';
    setText('objIconDisplay', currentIcon);
    setVal('objIconValue', currentIcon);
    _renderIconPicker(currentIcon);

    // Limit field with ATM formatting
    const limitEl = document.getElementById('objBudgetLimit');
    if (limitEl) {
      if (obj?.budget_limit) {
        if (typeof setAmtField === 'function') {
          setAmtField('objBudgetLimit', obj.budget_limit);
        } else {
          limitEl.value = obj.budget_limit.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        }
      } else {
        limitEl.value = '';
        limitEl.dataset.cents = '0';
      }
    }

    // Clear AI feedback
    const aiFeedback = document.getElementById('objAiIconFeedback');
    if (aiFeedback) aiFeedback.style.display = 'none';

    openModal('objectiveModal');

  } catch(e) {
    console.error('[objectives] openObjectiveModal error:', e);
    if (typeof toast === 'function') toast('Erro ao abrir modal: ' + e.message, 'error');
  }
}

// ── Renderizar picker de ícones ───────────────────────────────────────────────
function _renderIconPicker(selected) {
  const picker = document.getElementById('objIconPicker');
  if (!picker) return;
  picker.innerHTML = OBJ_ICONS.map(icon =>
    `<button type="button" class="obj-icon-opt${icon===selected?' obj-icon-opt--sel':''}"
      onclick="selectObjIcon('${icon}')" title="${icon}">${icon}</button>`
  ).join('');
}

function selectObjIcon(icon) {
  document.getElementById('objIconDisplay').textContent = icon;
  document.getElementById('objIconValue').value = icon;
  document.querySelectorAll('.obj-icon-opt').forEach(b =>
    b.classList.toggle('obj-icon-opt--sel', b.textContent === icon));
}

// ── Sugerir ícone com Gemini ──────────────────────────────────────────────────
async function suggestObjIconWithAI() {
  const name = document.getElementById('objName')?.value?.trim();
  const desc = document.getElementById('objDescription')?.value?.trim();
  const btn  = document.getElementById('objAiIconBtn');
  const fb   = document.getElementById('objAiIconFeedback');

  if (!name) { _objToast('Preencha o nome do objetivo antes de sugerir um ícone.', 'warning'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  if (fb)  { fb.style.display = 'none'; }

  try {
    const apiKey = await getAppSetting('gemini_api_key', '').catch(() => '');
    if (!apiKey) throw new Error('Chave Gemini não configurada em Configurações → IA');

    const prompt = `Você é um assistente que sugere emojis para objetivos financeiros.
Nome do objetivo: "${name}"${desc ? `\nDescrição: "${desc}"` : ''}

Responda APENAS com um único emoji que represente melhor este objetivo.
Escolha entre emojis comuns como: 🎯 🏠 ✈️ 🚗 💒 🎓 💻 📱 🏋️ 🎸 🍕 🌴 🎉 🏖️ 🛍️ 🔧 🎨 📚 💡 🌍 🏗️ 🚀 💰 🏦 🛒 👶 💍 🎂 🏥 🚢 🎮 📷 🎵
Responda somente com o emoji, sem texto adicional.`;

    // Use configured model; geminiRetryFetch handles 429/503 and thinkingConfig
    const _cfgModel = (typeof getGeminiModel === 'function') ? await getGeminiModel() : 'gemini-2.5-flash';
    const _objUrl = `https://generativelanguage.googleapis.com/v1beta/models/${_cfgModel}:generateContent?key=${apiKey}`;
    const data = await geminiRetryFetch(_objUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 16, temperature: 0.4 },
    });
    const raw  = _parseGeminiText(data)?.trim() || '';
    // Extrair o primeiro emoji da resposta
    const emojiMatch = raw.match(/\p{Emoji}/u);
    const suggested  = emojiMatch ? emojiMatch[0] : '🎯';

    selectObjIcon(suggested);
    if (fb) {
      fb.textContent = `IA sugeriu: ${suggested}`;
      fb.style.display = 'block';
      fb.style.color = 'var(--accent)';
    }
  } catch(e) {
    if (fb) {
      fb.textContent = e.message;
      fb.style.display = 'block';
      fb.style.color = 'var(--red)';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ IA'; }
  }
}

// ── Salvar objetivo ───────────────────────────────────────────────────────────
async function saveObjective() {
  const id        = document.getElementById('objId').value || null;
  const name      = document.getElementById('objName').value.trim();
  const icon      = document.getElementById('objIconValue').value || '🎯';
  const desc      = document.getElementById('objDescription').value.trim();
  const startDate = document.getElementById('objStartDate').value;
  const endDate   = document.getElementById('objEndDate').value || null;
  const status    = document.getElementById('objStatus').value || 'active';

  // Leitura do limite com ATM
  let limit = null;
  if (typeof getAmtField === 'function') {
    const raw = getAmtField('objBudgetLimit');
    limit = raw && Math.abs(raw) > 0 ? Math.abs(raw) : null;
  } else {
    const rawStr = document.getElementById('objBudgetLimit')?.value
      .replace(/\./g,'').replace(',','.') || '';
    limit = parseFloat(rawStr) || null;
  }

  if (!name)      { _objToast('Informe um nome para o objetivo.', 'error'); return; }
  if (!startDate) { _objToast('Informe a data de início.', 'error');         return; }
  if (endDate && endDate < startDate) { _objToast('Data final não pode ser anterior à inicial.', 'error'); return; }

  const btn = document.getElementById('objSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    const fid = _objFamId();
    if (!fid) throw new Error('Usuário sem família definida.');

    const payload = {
      family_id:    fid,
      name, icon,
      description:  desc || null,
      start_date:   startDate,
      end_date:     endDate,
      budget_limit: limit,
      status,
      updated_at:   new Date().toISOString(),
    };

    let err;
    if (id) {
      ({ error: err } = await sb.from('financial_objectives').update(payload).eq('id', id).eq('family_id', fid));
    } else {
      payload.created_at = new Date().toISOString();
      ({ error: err } = await sb.from('financial_objectives').insert(payload));
    }
    if (err) throw err;

    closeModal('objectiveModal');
    _objLoaded = false;
    await renderObjectivesPage();
    if (typeof populateObjectiveSelect === 'function') populateObjectiveSelect('txObjectiveId').catch(()=>{});
    _objToast(id ? 'Objetivo atualizado.' : 'Objetivo criado! 🎯', 'success');
  } catch(e) {
    let msg = e.message || String(e);
    if (msg.includes('row-level security') || msg.includes('violates row-level')) {
      const rlsSQL = [
        'DROP POLICY IF EXISTS "family_objectives" ON financial_objectives;',
        'DROP POLICY IF EXISTS "fobj_sel" ON financial_objectives;',
        'DROP POLICY IF EXISTS "fobj_ins" ON financial_objectives;',
        'DROP POLICY IF EXISTS "fobj_upd" ON financial_objectives;',
        'DROP POLICY IF EXISTS "fobj_del" ON financial_objectives;',
        'ALTER TABLE financial_objectives ENABLE ROW LEVEL SECURITY;',
        'CREATE POLICY "fobj_sel" ON financial_objectives FOR SELECT USING (family_id IN (SELECT fm.family_id FROM family_members fm JOIN app_users u ON u.id = fm.user_id WHERE u.auth_uid = auth.uid()));',
        'CREATE POLICY "fobj_ins" ON financial_objectives FOR INSERT WITH CHECK (family_id IN (SELECT fm.family_id FROM family_members fm JOIN app_users u ON u.id = fm.user_id WHERE u.auth_uid = auth.uid()));',
        'CREATE POLICY "fobj_upd" ON financial_objectives FOR UPDATE USING (family_id IN (SELECT fm.family_id FROM family_members fm JOIN app_users u ON u.id = fm.user_id WHERE u.auth_uid = auth.uid())) WITH CHECK (family_id IN (SELECT fm.family_id FROM family_members fm JOIN app_users u ON u.id = fm.user_id WHERE u.auth_uid = auth.uid()));',
        'CREATE POLICY "fobj_del" ON financial_objectives FOR DELETE USING (family_id IN (SELECT fm.family_id FROM family_members fm JOIN app_users u ON u.id = fm.user_id WHERE u.auth_uid = auth.uid()));',
      ].join('\n');
      console.error('[objectives RLS] SQL to fix:\n' + rlsSQL);
      _objToast('Erro de permissão (RLS) — execute o SQL de correção no Supabase (veja console)', 'error');
    } else {
      _objToast('Erro ao salvar: ' + msg, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

// ── Excluir objetivo ──────────────────────────────────────────────────────────
async function deleteObjective(id) {
  if (!id) return;
  const obj = _objList.find(o => o.id === id);
  if (!confirm(`Excluir "${obj?.name||'este objetivo'}"?\n\nAs transações vinculadas perderão o vínculo, mas não serão excluídas.`)) return;
  try {
    await sb.from('transactions').update({ objective_id: null }).eq('objective_id', id);
    const { error } = await sb.from('financial_objectives').delete().eq('id', id);
    if (error) throw error;
    _objLoaded = false;
    closeModal('objectiveDetailModal');
    await renderObjectivesPage();
    _objToast('Objetivo excluído.', 'success');
  } catch(e) { _objToast('Erro ao excluir: ' + e.message, 'error'); }
}

// ── Detalhe: gastos por categoria, beneficiário, membro ──────────────────────
async function openObjectiveDetail(id) {
  const modal = document.getElementById('objectiveDetailModal');
  if (!modal) return;

  const obj = _objList.find(o => o.id === id) || {};
  document.getElementById('objDetailTitle').textContent  = `${obj.icon||'🎯'} ${obj.name||'—'}`;
  document.getElementById('objDetailPeriod').textContent =
    `${_objFmtDate(obj.start_date)} → ${obj.end_date ? _objFmtDate(obj.end_date) : 'sem prazo'}`;

  const body = document.getElementById('objDetailBody');
  body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando…</div>';
  openModal('objectiveDetailModal');

  try {
    const { data: txs, error } = await sb.from('transactions')
      .select('*, accounts!transactions_account_id_fkey(name,currency), payees(name), categories(name,color,icon), family_composition(name,avatar_emoji)')
      .eq('objective_id', id).eq('family_id', _objFamId())
      .order('date', { ascending: false });
    if (error) throw error;

    const list     = txs || [];
    const totalExp = list.filter(t => t.amount < 0).reduce((s,t) => s + Math.abs(t.amount), 0);
    const totalInc = list.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0);
    const saldo    = totalInc - totalExp;

    const byCat = {}, byPayee = {}, byMember = {};
    list.forEach(t => {
      const ck = t.categories?.name || 'Sem categoria';
      if (!byCat[ck]) byCat[ck] = { color: t.categories?.color||'var(--muted)', total:0, count:0 };
      byCat[ck].total += Math.abs(t.amount); byCat[ck].count++;

      const pk = t.payees?.name || 'Sem beneficiário';
      if (!byPayee[pk]) byPayee[pk] = { total:0, count:0 };
      byPayee[pk].total += Math.abs(t.amount); byPayee[pk].count++;

      const mk = t.family_composition?.name || 'Sem membro';
      if (!byMember[mk]) byMember[mk] = { emoji: t.family_composition?.avatar_emoji||'👤', total:0, count:0 };
      byMember[mk].total += Math.abs(t.amount); byMember[mk].count++;
    });

    const budgetBar = obj.budget_limit ? (() => {
      const pct  = Math.min(100, (totalExp / obj.budget_limit) * 100);
      const over = totalExp > obj.budget_limit;
      return `<div class="obj-detail-budget-bar-wrap">
        <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-bottom:5px">
          <span>Gasto: <strong style="color:${over?'var(--red)':'var(--text)'}">${_objFmt(totalExp)}</strong></span>
          <span>Limite: <strong style="color:var(--text)">${_objFmt(obj.budget_limit)}</strong></span>
        </div>
        <div class="obj-budget-track">
          <div class="obj-budget-fill${over?' obj-budget-over':''}" style="width:${pct}%"></div>
        </div>
        ${over?`<div style="font-size:.72rem;color:var(--red);margin-top:5px;font-weight:700">⚠️ Excedido em ${_objFmt(totalExp - obj.budget_limit)}</div>`:''}
      </div>`;
    })() : '';

    const renderSection = (data, label, keyFn) => {
      const sorted = Object.entries(data).sort((a,b) => b[1].total - a[1].total);
      if (!sorted.length) return '';
      return `<div class="obj-detail-section">
        <div class="obj-detail-section-title">${label}</div>
        ${sorted.map(([k,v]) => `
          <div class="obj-breakdown-row">
            <span class="obj-breakdown-label">${keyFn(k,v)}</span>
            <span class="obj-breakdown-meta">${v.count} lanç.</span>
            <span class="obj-breakdown-value">${_objFmt(v.total)}</span>
          </div>`).join('')}
      </div>`;
    };

    const recentRows = list.slice(0,8).map(t => {
      const sign  = t.amount >= 0 ? '+' : '-';
      const color = t.amount >= 0 ? 'var(--green)' : 'var(--red)';
      return `<tr>
        <td style="color:var(--muted);font-size:.72rem;white-space:nowrap">${_objFmtDate(t.date)}</td>
        <td style="font-size:.8rem">${_objEsc(t.description||'—')}</td>
        <td style="font-size:.75rem;color:var(--muted)">${_objEsc(t.payees?.name||'—')}</td>
        <td style="text-align:right;font-weight:700;color:${color};white-space:nowrap">${sign}${_objFmt(Math.abs(t.amount))}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
    <div class="obj-detail-kpis">
      <div class="obj-kpi"><div class="obj-kpi-label">Despesas</div><div class="obj-kpi-value" style="color:var(--red)">${_objFmt(totalExp)}</div></div>
      <div class="obj-kpi"><div class="obj-kpi-label">Receitas</div><div class="obj-kpi-value" style="color:var(--green)">${_objFmt(totalInc)}</div></div>
      <div class="obj-kpi"><div class="obj-kpi-label">Saldo</div><div class="obj-kpi-value" style="color:${saldo>=0?'var(--green)':'var(--red)'}">${_objFmt(saldo)}</div></div>
      <div class="obj-kpi"><div class="obj-kpi-label">Transações</div><div class="obj-kpi-value">${list.length}</div></div>
    </div>
    ${budgetBar}
    ${renderSection(byCat,  '📦 Por categoria',   (k,v) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:50%;background:${v.color};display:inline-block"></span>${_objEsc(k)}</span>`)}
    ${renderSection(byPayee,'🏪 Por beneficiário', (k)   => _objEsc(k))}
    ${renderSection(byMember,'👥 Por membro',      (k,v) => `${v.emoji} ${_objEsc(k)}`)}
    ${list.length ? `<div class="obj-detail-section">
      <div class="obj-detail-section-title">🕒 Últimas transações</div>
      <div class="table-wrap" style="border-radius:var(--r-sm);border:1px solid var(--border);overflow:hidden">
        <table style="font-size:.82rem;width:100%">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;color:var(--muted);text-transform:uppercase;font-weight:700">Data</th>
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;color:var(--muted);text-transform:uppercase;font-weight:700">Descrição</th>
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;color:var(--muted);text-transform:uppercase;font-weight:700">Beneficiário</th>
            <th style="padding:7px 10px;text-align:right;font-size:.65rem;color:var(--muted);text-transform:uppercase;font-weight:700">Valor</th>
          </tr></thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>
      ${list.length>8?`<div style="text-align:center;margin-top:8px;font-size:.75rem;color:var(--muted)">… e mais ${list.length-8} transações</div>`:''}
    </div>` : ''}
    <div style="display:flex;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-ghost" onclick="openObjectiveModal('${id}')">✏️ Editar</button>
      <button class="btn btn-ghost" style="color:var(--red)" onclick="deleteObjective('${id}')">🗑️ Excluir</button>
    </div>`;

  } catch(e) {
    body.innerHTML = `<div style="color:var(--red);padding:16px">Erro: ${_objEsc(e.message)}</div>`;
  }
}

// ── Exports globais ──────────────────────────────────────────────────────────
window.loadObjectives          = loadObjectives;
window.populateObjectiveSelect = populateObjectiveSelect;
window.renderObjectivesPage    = renderObjectivesPage;
window.openObjectiveModal      = openObjectiveModal;
window.saveObjective           = saveObjective;
window.deleteObjective         = deleteObjective;
window.openObjectiveDetail     = openObjectiveDetail;
window.selectObjIcon           = selectObjIcon;
window.suggestObjIconWithAI    = suggestObjIconWithAI;
window._objList                = _objList;
