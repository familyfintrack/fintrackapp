
// ══════════════════════════════════════════════════════════════════════════
//  AUDIT.JS — Histórico de auto-registros de transações programadas
//  Tabela: scheduled_run_logs (preenchida por auto_register.js)
//  Visível para TODOS os usuários autenticados (não apenas admin)
// ══════════════════════════════════════════════════════════════════════════

// Estado interno
const _auditState = {
  allRows:      [],   // todos os registros carregados do banco
  filtered:     [],   // após filtros locais
  searchTerm:   '',
  _lastStatus:  null,
  _lastMonth:   null,
  _monthsBuilt: false,
};

// ── Popula o select de meses com os últimos 13 meses ─────────────────────────
function _auditInitMonthFilter() {
  const sel = document.getElementById('auditMonthFilter');
  if (!sel || _auditState._monthsBuilt) return;
  _auditState._monthsBuilt = true;

  const now  = new Date();
  const opts = ['<option value="">Todos os meses</option>'];
  for (let i = 0; i < 13; i++) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const lbl = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    opts.push(`<option value="${val}"${i === 0 ? ' selected' : ''}>${lbl.charAt(0).toUpperCase() + lbl.slice(1)}</option>`);
  }
  sel.innerHTML = opts.join('');
  _auditState._lastMonth = sel.value;
}

// ── Entry point ─────────────────────────────────────────────────────────────
async function loadAuditLogs() {
  _auditInitMonthFilter();
  const body     = document.getElementById('auditBody');
  const countEl  = document.getElementById('auditCount');
  const footerEl = document.getElementById('auditFooterCount');
  const btn      = document.getElementById('auditRefreshBtn');

  if (btn) btn.disabled = true;
  if (body) body.innerHTML = `
    <tr><td colspan="7" style="text-align:center;padding:36px;color:var(--muted)">
      <div style="font-size:1.4rem;margin-bottom:8px">⏳</div>
      <div style="font-size:.85rem">Carregando registros…</div>
    </td></tr>`;

  try {
    if (!sb) { toast('Sem conexão com o banco', 'error'); return; }

    // Testa existência da tabela
    const { error: testErr } = await sb.from('scheduled_run_logs').select('id').limit(1);
    if (testErr) throw testErr;

    // Filtro de mês (se preenchido)
    const monthFilter = document.getElementById('auditMonthFilter')?.value || '';
    const statusFilter = document.getElementById('auditStatusFilter')?.value || '';

    let q = famQ(
      sb.from('scheduled_run_logs')
        .select('*, scheduled_transactions(description,frequency,type,category_id,categories:category_id(name))')
        .order('created_at', { ascending: false })
        .limit(500)
    );

    if (statusFilter) q = q.eq('status', statusFilter);
    if (monthFilter) {
      // filtra pelo mês da data agendada
      const [y, m] = monthFilter.split('-');
      const last = new Date(+y, +m, 0).getDate();
      q = q.gte('scheduled_date', `${y}-${m}-01`)
           .lte('scheduled_date', `${y}-${m}-${String(last).padStart(2,'0')}`);
    }

    const { data, error } = await q;
    if (error) throw error;

    _auditState.allRows = data || [];
    _updateAuditCounters(_auditState.allRows);
    _auditApplyLocalFilters();

    if (countEl) countEl.textContent = '';

  } catch (e) {
    console.warn('[audit]', e.message);
    const isMissing = /does not exist|relation|not found/i.test(e.message || '');
    if (body) body.innerHTML = isMissing
      ? `<tr><td colspan="7"><div style="margin:12px;padding:18px 20px;background:var(--amber-lt);border:1.5px solid var(--amber);border-radius:var(--r);font-size:.85rem;line-height:1.7">
          <div style="font-weight:700;color:var(--amber);margin-bottom:10px">⚠️ Tabela <code>scheduled_run_logs</code> não encontrada</div>
          <div style="color:var(--text2);margin-bottom:12px">Execute o SQL abaixo no <strong>Supabase SQL Editor</strong> para criar a tabela:</div>
          <pre id="auditMigrationSql" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;font-size:.7rem;overflow-x:auto;white-space:pre;color:var(--text);cursor:text;user-select:all">${_auditMigrationSql()}</pre>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="_copyAuditMigration()">📋 Copiar SQL</button>
            <button class="btn btn-ghost btn-sm" onclick="window.open('https://supabase.com/dashboard','_blank')">🔗 Supabase</button>
            <button class="btn btn-ghost btn-sm" onclick="loadAuditLogs()">↻ Tentar novamente</button>
          </div>
        </div></td></tr>`
      : `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--danger);font-size:.85rem">
          ⚠️ Erro: ${esc(e.message)}
          <br><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="loadAuditLogs()">↻ Tentar novamente</button>
        </td></tr>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Filtros locais (busca + status via contador) ─────────────────────────────
function _auditApplyLocalFilters() {
  const body     = document.getElementById('auditBody');
  const countEl  = document.getElementById('auditCount');
  const footerEl = document.getElementById('auditFooterCount');

  const search = (document.getElementById('auditSearch')?.value || '').toLowerCase().trim();
  _auditState.searchTerm = search;

  let rows = _auditState.allRows;

  if (search) {
    rows = rows.filter(r => {
      const desc   = (r.description || '').toLowerCase();
      const sched  = (r.scheduled_transactions?.description || '').toLowerCase();
      const cat    = (r.scheduled_transactions?.categories?.name || '').toLowerCase();
      return desc.includes(search) || sched.includes(search) || cat.includes(search);
    });
  }

  _auditState.filtered = rows;

  const total = rows.length;
  if (countEl) countEl.textContent = total > 0 ? `${total} registro${total !== 1 ? 's' : ''}` : '';
  if (footerEl) footerEl.textContent = total > 0 ? `${total} de ${_auditState.allRows.length} registros` : '';

  if (!total) {
    const msg = search || document.getElementById('auditStatusFilter')?.value || document.getElementById('auditMonthFilter')?.value
      ? 'Nenhum registro encontrado com esses filtros.'
      : 'Nenhum auto-registro ainda. Execute uma transação programada automática para ver os logs aqui.';
    if (body) body.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:48px;color:var(--muted)">
        <div style="font-size:2rem;margin-bottom:10px">📋</div>
        <div style="font-size:.85rem">${msg}</div>
      </td></tr>`;
    return;
  }

  if (body) body.innerHTML = rows.map(r => _auditRow(r)).join('');
}

// ── Clique nos KPI counters para filtrar por status ──────────────────────────
function auditSetStatus(status) {
  const sel = document.getElementById('auditStatusFilter');
  if (sel) {
    sel.value = status;
    loadAuditLogs();
  }
}
window.auditSetStatus = auditSetStatus;

// ── Atualiza contadores dos KPI cards ────────────────────────────────────────
function _updateAuditCounters(data) {
  const total     = data.length;
  const confirmed = data.filter(r => r.status === 'confirmed').length;
  const pending   = data.filter(r => r.status === 'pending').length;
  const errors    = data.filter(r => r.status === 'error').length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('auditCntTotal',     total);
  set('auditCntConfirmed', confirmed);
  set('auditCntPending',   pending);
  set('auditCntError',     errors);
}

// ── Renderiza uma linha da tabela ────────────────────────────────────────────
function _auditRow(r) {
  const amount = r.amount ?? 0;
  const date   = r.scheduled_date || r.created_at;

  // Badge de status
  const statusBadge = {
    confirmed: `<span class="audit-status-badge audit-ok">✅ Confirmada</span>`,
    pending:   `<span class="audit-status-badge audit-pending">⏳ Pendente</span>`,
    error:     `<span class="audit-status-badge audit-error">❌ Erro</span>`,
  }[r.status || 'confirmed'] || `<span class="audit-status-badge audit-ok">✅ Confirmada</span>`;

  // Descrição principal: prioriza scheduled_transactions.description, fallback para r.description
  const schedTx  = r.scheduled_transactions;
  const mainDesc = schedTx?.description || r.description || '—';
  const runDesc  = (r.description && r.description !== mainDesc) ? r.description : null;
  const catName  = schedTx?.categories?.name || null;

  // Frequência do programado
  const freqLabel = schedTx?.frequency
    ? { once:'Único', weekly:'Semanal', biweekly:'Quinzenal', monthly:'Mensal',
        bimonthly:'Bimestral', quarterly:'Trimestral', semiannual:'Semestral',
        annual:'Anual', custom:'Custom' }[schedTx.frequency] || schedTx.frequency
    : '—';

  // Tipo do programado
  const typeIcon = {
    expense: '💸', income: '💰', transfer: '↔️', card_payment: '💳'
  }[schedTx?.type || ''] || '';

  // Botão de link para a transação
  const txLink = r.transaction_id
    ? `<button class="btn btn-ghost btn-sm" onclick="openTxDetail('${r.transaction_id}')"
        style="font-size:.72rem;padding:3px 8px" title="Ver transação">🔍 Ver</button>`
    : `<span style="color:var(--muted);font-size:.78rem">—</span>`;

  const createdAt = r.created_at
    ? new Date(r.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '—';

  return `<tr class="audit-tr-${r.status || 'confirmed'}">
    <td style="white-space:nowrap;font-size:.82rem;color:var(--text2)">${fmtDate(date)}</td>
    <td style="max-width:260px">
      <div style="font-weight:600;font-size:.875rem;color:var(--text)">${typeIcon} ${esc(mainDesc)}</div>
      ${catName ? `<div style="font-size:.72rem;color:var(--accent);margin-top:1px">📁 ${esc(catName)}</div>` : ''}
      ${runDesc  ? `<div style="font-size:.72rem;color:var(--muted);margin-top:1px">${esc(runDesc)}</div>` : ''}
    </td>
    <td style="font-size:.78rem;color:var(--muted);white-space:nowrap">${freqLabel}</td>
    <td>${statusBadge}</td>
    <td style="text-align:right;white-space:nowrap;font-weight:700"
        class="${amount >= 0 ? 'amount-pos' : 'amount-neg'}">${fmt(amount)}</td>
    <td style="font-size:.74rem;color:var(--muted);white-space:nowrap">${createdAt}</td>
    <td style="text-align:center">${txLink}</td>
  </tr>`;
}

// ── Funções de filtro chamadas pela UI ───────────────────────────────────────
function filterAuditLogs() {
  // statusFilter e monthFilter requerem nova query; search é local
  const status = document.getElementById('auditStatusFilter')?.value || '';
  const month  = document.getElementById('auditMonthFilter')?.value  || '';

  // Se mudou status ou mês, recarrega do servidor; senão filtra localmente
  const needsReload = status !== _auditState._lastStatus || month !== _auditState._lastMonth;
  _auditState._lastStatus = status;
  _auditState._lastMonth  = month;

  if (needsReload) {
    loadAuditLogs();
  } else {
    _auditApplyLocalFilters();
  }
}

// ── SQL de migration ─────────────────────────────────────────────────────────
function _auditMigrationSql() {
  return `CREATE TABLE IF NOT EXISTS public.scheduled_run_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID REFERENCES public.families(id) ON DELETE CASCADE,
  scheduled_id   UUID REFERENCES public.scheduled_transactions(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  scheduled_date DATE,
  status         TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed','pending','error')),
  amount         NUMERIC(14,2),
  description    TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srl_family  ON public.scheduled_run_logs(family_id);
CREATE INDEX IF NOT EXISTS idx_srl_created ON public.scheduled_run_logs(created_at DESC);
ALTER TABLE public.scheduled_run_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "srl_family_access" ON public.scheduled_run_logs;
CREATE POLICY "srl_family_access" ON public.scheduled_run_logs
  USING (
    family_id IN (SELECT family_id FROM public.family_members WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('admin','owner'))
  );`.replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _copyAuditMigration() {
  const sql = _auditMigrationSql().replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  navigator.clipboard.writeText(sql)
    .then(() => toast('SQL copiado!', 'success'))
    .catch(() => toast('Selecione o texto acima e copie manualmente', 'info'));
}
