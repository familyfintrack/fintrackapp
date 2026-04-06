// ── Objetivos / Projetos — Monitoramento de gastos por objetivo ─────────────
// Escopo: família (family_id). Vinculável a transações (objective_id).
// Tabelas: financial_objectives, transactions.objective_id (coluna nova)

'use strict';

// ── Estado ──────────────────────────────────────────────────────────────────
let _objList   = [];   // cache dos objetivos da família
let _objLoaded = false;

// ── Helpers ─────────────────────────────────────────────────────────────────
function _objFamId() { return (typeof famId === 'function' ? famId() : null); }

function _objFmt(v) {
  return typeof fmt === 'function'
    ? fmt(v)
    : 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function _objEsc(s) {
  return (typeof esc === 'function' ? esc : (x => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')))(s);
}

function _objToast(msg, type) {
  if (typeof toast === 'function') toast(msg, type);
  else console.log(msg);
}

// ── Formatar data BR ─────────────────────────────────────────────────────────
function _objFmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ── Status do objetivo ───────────────────────────────────────────────────────
function _objStatus(obj) {
  const today = new Date().toISOString().slice(0, 10);
  if (obj.status === 'closed') return { label: 'Encerrado', cls: 'obj-status-closed', icon: '🔒' };
  if (obj.end_date && today > obj.end_date) return { label: 'Expirado', cls: 'obj-status-expired', icon: '⏰' };
  if (today < obj.start_date) return { label: 'Aguardando início', cls: 'obj-status-waiting', icon: '📅' };
  return { label: 'Ativo', cls: 'obj-status-active', icon: '🟢' };
}

// ── Carregar objetivos da família ────────────────────────────────────────────
async function loadObjectives(force = false) {
  if (_objLoaded && !force) return _objList;
  const fid = _objFamId();
  if (!fid) return [];
  try {
    const { data, error } = await sb.from('financial_objectives')
      .select('*')
      .eq('family_id', fid)
      .order('start_date', { ascending: false });
    if (error) throw error;
    _objList   = data || [];
    _objLoaded = true;
  } catch (e) {
    console.warn('[objectives] load error', e.message);
    _objList = [];
  }
  return _objList;
}

// ── Popular seletor de objetivos em qualquer select ──────────────────────────
async function populateObjectiveSelect(selectId, selectedId = null, includeEmpty = true) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  await loadObjectives();
  const today = new Date().toISOString().slice(0, 10);
  const active = _objList.filter(o => o.status !== 'closed' && (!o.end_date || o.end_date >= today));
  let html = includeEmpty ? '<option value="">— Nenhum objetivo —</option>' : '';
  active.forEach(o => {
    const selected = o.id === selectedId ? ' selected' : '';
    html += `<option value="${o.id}"${selected}>${_objEsc(o.icon || '🎯')} ${_objEsc(o.name)}</option>`;
  });
  // Se o selectedId está num objetivo inativo/expirado, incluir também
  if (selectedId && !active.find(o => o.id === selectedId)) {
    const found = _objList.find(o => o.id === selectedId);
    if (found) html += `<option value="${found.id}" selected>${_objEsc(found.icon || '🎯')} ${_objEsc(found.name)} (expirado)</option>`;
  }
  sel.innerHTML = html;
}

// ── Renderizar página de objetivos ───────────────────────────────────────────
async function renderObjectivesPage() {
  const container = document.getElementById('objectivesGrid');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:.85rem">⏳ Carregando objetivos…</div>';
  await loadObjectives(true);

  if (!_objList.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 24px">
        <div style="font-size:3rem;margin-bottom:12px">🎯</div>
        <div style="font-weight:700;font-size:1rem;color:var(--text);margin-bottom:6px">Nenhum objetivo criado</div>
        <div style="font-size:.83rem;color:var(--muted);margin-bottom:20px">Crie um objetivo para monitorar gastos de um projeto específico</div>
        <button class="btn btn-primary" onclick="openObjectiveModal()">+ Novo Objetivo</button>
      </div>`;
    return;
  }

  container.innerHTML = _objList.map(o => _renderObjectiveCard(o)).join('');
}

// ── Card de objetivo ─────────────────────────────────────────────────────────
function _renderObjectiveCard(o) {
  const st = _objStatus(o);
  const budget = o.budget_limit ? _objFmt(o.budget_limit) : null;
  return `
  <div class="obj-card" onclick="openObjectiveDetail('${o.id}')">
    <div class="obj-card-header">
      <div class="obj-card-icon">${o.icon || '🎯'}</div>
      <div class="obj-card-info">
        <div class="obj-card-name">${_objEsc(o.name)}</div>
        <div class="obj-card-dates">${_objFmtDate(o.start_date)} → ${o.end_date ? _objFmtDate(o.end_date) : 'sem prazo'}</div>
      </div>
      <span class="obj-status-badge ${st.cls}">${st.icon} ${st.label}</span>
    </div>
    ${o.description ? `<div class="obj-card-desc">${_objEsc(o.description)}</div>` : ''}
    ${budget ? `<div class="obj-card-budget">Limite: <strong>${budget}</strong></div>` : ''}
    <div class="obj-card-footer">
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openObjectiveModal('${o.id}')">✏️ Editar</button>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openObjectiveDetail('${o.id}')">📊 Ver gastos</button>
    </div>
  </div>`;
}

// ── Modal: criar/editar objetivo ─────────────────────────────────────────────
async function openObjectiveModal(id = null) {
  let obj = null;
  if (id) {
    obj = _objList.find(o => o.id === id);
    if (!obj) {
      const { data } = await sb.from('financial_objectives').select('*').eq('id', id).single();
      obj = data;
    }
  }

  const modal = document.getElementById('objectiveModal');
  if (!modal) return;

  document.getElementById('objModalTitle').textContent = obj ? 'Editar Objetivo' : 'Novo Objetivo';
  document.getElementById('objId').value          = obj?.id || '';
  document.getElementById('objName').value        = obj?.name || '';
  document.getElementById('objIcon').value        = obj?.icon || '🎯';
  document.getElementById('objDescription').value = obj?.description || '';
  document.getElementById('objStartDate').value   = obj?.start_date || new Date().toISOString().slice(0, 10);
  document.getElementById('objEndDate').value     = obj?.end_date || '';
  document.getElementById('objBudgetLimit').value = obj?.budget_limit ? String(obj.budget_limit).replace('.', ',') : '';
  document.getElementById('objStatus').value      = obj?.status || 'active';

  if (typeof setAmtField === 'function' && obj?.budget_limit) {
    setAmtField('objBudgetLimit', obj.budget_limit);
  }

  openModal('objectiveModal');
}

// ── Salvar objetivo ──────────────────────────────────────────────────────────
async function saveObjective() {
  const id        = document.getElementById('objId').value || null;
  const name      = document.getElementById('objName').value.trim();
  const icon      = document.getElementById('objIcon').value.trim() || '🎯';
  const desc      = document.getElementById('objDescription').value.trim();
  const startDate = document.getElementById('objStartDate').value;
  const endDate   = document.getElementById('objEndDate').value || null;
  const limitRaw  = document.getElementById('objBudgetLimit').value.replace(/\./g, '').replace(',', '.');
  const limit     = parseFloat(limitRaw) || null;
  const status    = document.getElementById('objStatus').value || 'active';

  if (!name) { _objToast('Informe um nome para o objetivo.', 'error'); return; }
  if (!startDate) { _objToast('Informe a data de início.', 'error'); return; }
  if (endDate && endDate < startDate) { _objToast('A data final não pode ser anterior à data inicial.', 'error'); return; }

  const btn = document.getElementById('objSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    const payload = {
      family_id:    _objFamId(),
      name,
      icon,
      description:  desc || null,
      start_date:   startDate,
      end_date:     endDate,
      budget_limit: limit,
      status,
      updated_at:   new Date().toISOString(),
    };

    let err;
    if (id) {
      ({ error: err } = await sb.from('financial_objectives').update(payload).eq('id', id));
    } else {
      payload.created_at = new Date().toISOString();
      ({ error: err } = await sb.from('financial_objectives').insert(payload));
    }
    if (err) throw err;

    closeModal('objectiveModal');
    _objLoaded = false;
    await renderObjectivesPage();
    // Atualizar seletores que possam estar abertos
    await populateObjectiveSelect('txObjectiveId');
    _objToast(id ? 'Objetivo atualizado.' : 'Objetivo criado!', 'success');
  } catch (e) {
    _objToast('Erro ao salvar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

// ── Excluir objetivo ─────────────────────────────────────────────────────────
async function deleteObjective(id) {
  if (!id) return;
  const obj = _objList.find(o => o.id === id);
  const nm  = obj?.name || 'este objetivo';
  if (!confirm(`Excluir "${nm}"?\n\nAs transações vinculadas perderão o vínculo, mas não serão excluídas.`)) return;
  try {
    // Desvincular transações
    await sb.from('transactions').update({ objective_id: null }).eq('objective_id', id);
    const { error } = await sb.from('financial_objectives').delete().eq('id', id);
    if (error) throw error;
    _objLoaded = false;
    closeModal('objectiveDetailModal');
    await renderObjectivesPage();
    _objToast('Objetivo excluído.', 'success');
  } catch (e) {
    _objToast('Erro ao excluir: ' + e.message, 'error');
  }
}

// ── Detalhe do objetivo: gastos por categoria, beneficiário, membro ──────────
async function openObjectiveDetail(id) {
  const modal = document.getElementById('objectiveDetailModal');
  if (!modal) return;

  const obj = _objList.find(o => o.id === id) || {};
  document.getElementById('objDetailTitle').textContent   = `${obj.icon || '🎯'} ${obj.name || '—'}`;
  document.getElementById('objDetailPeriod').textContent  =
    `${_objFmtDate(obj.start_date)} → ${obj.end_date ? _objFmtDate(obj.end_date) : 'sem prazo'}`;

  const body = document.getElementById('objDetailBody');
  body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted)">⏳ Carregando…</div>';
  openModal('objectiveDetailModal');

  try {
    // Buscar todas as transações vinculadas a este objetivo
    const { data: txs, error } = await sb.from('transactions')
      .select('*, accounts(name,currency), payees(name), categories(name,color,icon), family_composition(name,avatar_emoji)')
      .eq('objective_id', id)
      .eq('family_id', _objFamId())
      .order('date', { ascending: false });
    if (error) throw error;

    const list = txs || [];

    // Totais globais
    const totalExp = list.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalInc = list.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const saldo    = totalInc - totalExp;

    // Por categoria
    const byCat = {};
    list.forEach(t => {
      const k = t.categories?.name || 'Sem categoria';
      if (!byCat[k]) byCat[k] = { color: t.categories?.color || 'var(--muted)', icon: t.categories?.icon || '📦', total: 0, count: 0 };
      byCat[k].total += Math.abs(t.amount);
      byCat[k].count++;
    });

    // Por beneficiário
    const byPayee = {};
    list.forEach(t => {
      const k = t.payees?.name || 'Sem beneficiário';
      if (!byPayee[k]) byPayee[k] = { total: 0, count: 0 };
      byPayee[k].total += Math.abs(t.amount);
      byPayee[k].count++;
    });

    // Por membro
    const byMember = {};
    list.forEach(t => {
      const members = t.family_composition ? [t.family_composition] : [];
      if (!members.length) {
        const k = 'Sem membro';
        if (!byMember[k]) byMember[k] = { emoji: '👤', total: 0, count: 0 };
        byMember[k].total += Math.abs(t.amount);
        byMember[k].count++;
      } else {
        members.forEach(m => {
          const k = m.name;
          if (!byMember[k]) byMember[k] = { emoji: m.avatar_emoji || '👤', total: 0, count: 0 };
          byMember[k].total += Math.abs(t.amount);
          byMember[k].count++;
        });
      }
    });

    const budgetBar = obj.budget_limit
      ? (() => {
          const pct = Math.min(100, (totalExp / obj.budget_limit) * 100);
          const over = totalExp > obj.budget_limit;
          return `
          <div class="obj-detail-budget-bar-wrap">
            <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-bottom:4px">
              <span>Gasto: <strong style="color:var(--text)">${_objFmt(totalExp)}</strong></span>
              <span>Limite: <strong style="color:var(--text)">${_objFmt(obj.budget_limit)}</strong></span>
            </div>
            <div class="obj-budget-track">
              <div class="obj-budget-fill ${over ? 'obj-budget-over' : ''}" style="width:${pct}%"></div>
            </div>
            ${over ? `<div style="font-size:.72rem;color:var(--red);margin-top:4px;font-weight:700">⚠️ Limite excedido em ${_objFmt(totalExp - obj.budget_limit)}</div>` : ''}
          </div>`;
        })()
      : '';

    const renderBreakdown = (data, label, keyFn, valFn) => {
      const sorted = Object.entries(data).sort((a, b) => b[1].total - a[1].total);
      if (!sorted.length) return '';
      return `
      <div class="obj-detail-section">
        <div class="obj-detail-section-title">${label}</div>
        ${sorted.map(([k, v]) => `
          <div class="obj-breakdown-row">
            <span class="obj-breakdown-label">${keyFn(k, v)}</span>
            <span class="obj-breakdown-meta">${v.count} transação${v.count !== 1 ? 'ões' : ''}</span>
            <span class="obj-breakdown-value">${_objFmt(v.total)}</span>
          </div>`).join('')}
      </div>`;
    };

    const recentRows = list.slice(0, 8).map(t => {
      const sign  = t.amount >= 0 ? '+' : '-';
      const color = t.amount >= 0 ? 'var(--green)' : 'var(--red)';
      return `
      <tr>
        <td style="color:var(--muted);font-size:.72rem;white-space:nowrap">${_objFmtDate(t.date)}</td>
        <td style="font-size:.8rem">${_objEsc(t.description || '—')}</td>
        <td style="font-size:.75rem;color:var(--muted)">${_objEsc(t.payees?.name || '—')}</td>
        <td style="text-align:right;font-weight:700;color:${color};white-space:nowrap">${sign}${_objFmt(Math.abs(t.amount))}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
    <div class="obj-detail-kpis">
      <div class="obj-kpi">
        <div class="obj-kpi-label">Despesas</div>
        <div class="obj-kpi-value" style="color:var(--red)">${_objFmt(totalExp)}</div>
      </div>
      <div class="obj-kpi">
        <div class="obj-kpi-label">Receitas</div>
        <div class="obj-kpi-value" style="color:var(--green)">${_objFmt(totalInc)}</div>
      </div>
      <div class="obj-kpi">
        <div class="obj-kpi-label">Saldo</div>
        <div class="obj-kpi-value" style="color:${saldo >= 0 ? 'var(--green)' : 'var(--red)'}">${_objFmt(saldo)}</div>
      </div>
      <div class="obj-kpi">
        <div class="obj-kpi-label">Transações</div>
        <div class="obj-kpi-value">${list.length}</div>
      </div>
    </div>

    ${budgetBar}

    ${renderBreakdown(byCat, '📦 Por categoria',
        (k, v) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:50%;background:${v.color};display:inline-block"></span>${_objEsc(k)}</span>`,
        () => {}
      )}

    ${renderBreakdown(byPayee, '🏪 Por beneficiário',
        (k) => _objEsc(k),
        () => {}
      )}

    ${renderBreakdown(byMember, '👥 Por membro',
        (k, v) => `${v.emoji} ${_objEsc(k)}`,
        () => {}
      )}

    ${list.length ? `
    <div class="obj-detail-section">
      <div class="obj-detail-section-title">🕒 Transações recentes</div>
      <div class="table-wrap" style="border-radius:var(--r-sm);border:1px solid var(--border);overflow:hidden">
        <table style="font-size:.82rem;width:100%">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Data</th>
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;font-weight:700;color:var(--muted);text-transform:uppercase">Descrição</th>
            <th style="padding:7px 10px;text-align:left;font-size:.65rem;font-weight:700;color:var(--muted);text-transform:uppercase">Beneficiário</th>
            <th style="padding:7px 10px;text-align:right;font-size:.65rem;font-weight:700;color:var(--muted);text-transform:uppercase">Valor</th>
          </tr></thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>
      ${list.length > 8 ? `<div style="text-align:center;margin-top:8px;font-size:.75rem;color:var(--muted)">… e mais ${list.length - 8} transações</div>` : ''}
    </div>` : ''}

    <div style="display:flex;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-ghost" onclick="openObjectiveModal('${id}')">✏️ Editar</button>
      <button class="btn btn-ghost" style="color:var(--red)" onclick="deleteObjective('${id}')">🗑️ Excluir</button>
    </div>`;

  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);padding:16px">Erro ao carregar: ${_objEsc(e.message)}</div>`;
  }
}

// ── SQL Migration (executar uma vez) ─────────────────────────────────────────
async function runObjectivesMigration() {
  // Verifica se a tabela já existe
  const { error: checkErr } = await sb.from('financial_objectives').select('id').limit(1);
  if (!checkErr) return true; // já existe

  try {
    const sql = `
      -- Tabela de objetivos financeiros
      CREATE TABLE IF NOT EXISTS financial_objectives (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        name         text NOT NULL,
        icon         text DEFAULT '🎯',
        description  text,
        start_date   date NOT NULL,
        end_date     date,
        budget_limit numeric(14,2),
        status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
        created_at   timestamptz DEFAULT now(),
        updated_at   timestamptz DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_financial_objectives_family ON financial_objectives(family_id);
      CREATE INDEX IF NOT EXISTS idx_financial_objectives_status ON financial_objectives(status);

      -- RLS
      ALTER TABLE financial_objectives ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "family_objectives_policy" ON financial_objectives;
      CREATE POLICY "family_objectives_policy" ON financial_objectives
        USING (family_id IN (
          SELECT family_id FROM app_users WHERE id = auth.uid()
        ));

      -- Coluna objective_id em transactions
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS objective_id uuid REFERENCES financial_objectives(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_transactions_objective ON transactions(objective_id) WHERE objective_id IS NOT NULL;
    `;
    const { error } = await sb.rpc('exec_sql', { sql });
    if (error) {
      console.warn('[objectives] migration via rpc failed, will try direct insert test:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[objectives] migration error:', e.message);
    return false;
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
window.runObjectivesMigration  = runObjectivesMigration;
window._objList                = _objList;
