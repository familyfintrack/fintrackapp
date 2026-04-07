/**
 * tags.js — Gestão global de Tags (Family FinTrack)
 *
 * Responsabilidades:
 *  - Listar todas as tags em uso com contagem de uso
 *  - Renomear tag: atualiza transactions + scheduled_transactions em batch
 *  - Excluir tag: remove de transactions + scheduled_transactions em batch
 *  - Criar tag: apenas valida/normaliza (tags existem quando vinculadas a TXs)
 *  - Invalida _tagsState.allTags após operações para forçar reload
 *
 * Riscos tratados:
 *  1. Supabase JS não tem array_replace nativo → batch fetch+update client-side
 *  2. Cache _tagsState em memória → invalidado após cada operação
 *  3. Filtro rptTag com tag deletada → reset do select após delete
 *  4. scheduled_transactions também armazena tags → atualizado em paralelo
 *  5. Operação parcial (falha no meio) → relatório de erros ao usuário
 *  6. Tag com espaços/maiúsculas inconsistentes → normalização antes de comparar
 */

// ── Estado ─────────────────────────────────────────────────────────────────
let _tagsPageState = {
  tags:    [],   // [{ name, tx_count, sched_count, total_count }]
  loading: false,
  search:  '',
};

// ── Inicialização ──────────────────────────────────────────────────────────

async function initTagsPage() {
  _tagsPageState.search = '';
  const searchEl = document.getElementById('tagsSearch');
  if (searchEl) searchEl.value = '';
  await _loadTagsList();
}

async function _loadTagsList() {
  _tagsPageState.loading = true;
  _renderTagsList();

  try {
    // Buscar tags de transactions
    const { data: txRows } = await famQ(
      sb.from('transactions').select('tags').not('tags', 'is', null)
    );
    // Buscar tags de scheduled_transactions
    const { data: scRows } = await famQ(
      sb.from('scheduled_transactions').select('tags').not('tags', 'is', null)
    );

    const txFreq    = {};
    const schedFreq = {};

    (txRows || []).forEach(r => {
      (r.tags || []).forEach(tag => {
        const k = (tag || '').trim();
        if (k) txFreq[k] = (txFreq[k] || 0) + 1;
      });
    });
    (scRows || []).forEach(r => {
      (r.tags || []).forEach(tag => {
        const k = (tag || '').trim();
        if (k) schedFreq[k] = (schedFreq[k] || 0) + 1;
      });
    });

    // Unir e ordenar por uso total
    const allNames = new Set([...Object.keys(txFreq), ...Object.keys(schedFreq)]);
    _tagsPageState.tags = [...allNames]
      .map(name => ({
        name,
        tx_count:    txFreq[name]    || 0,
        sched_count: schedFreq[name] || 0,
        total_count: (txFreq[name] || 0) + (schedFreq[name] || 0),
      }))
      .sort((a, b) => b.total_count - a.total_count || a.name.localeCompare(b.name, 'pt-BR'));

  } catch(e) {
    toast('Erro ao carregar tags: ' + (e.message || e), 'error');
    _tagsPageState.tags = [];
  }

  _tagsPageState.loading = false;
  _renderTagsList();
}

// ── Renderização ───────────────────────────────────────────────────────────

function _renderTagsList() {
  const container = document.getElementById('tagsListContainer');
  if (!container) return;

  if (_tagsPageState.loading) {
    container.innerHTML = `<div class="tag-mgr-empty">
      <div class="tag-mgr-empty-icon">⏳</div>
      <div class="tag-mgr-empty-text">Carregando tags…</div>
    </div>`;
    return;
  }

  const q = (_tagsPageState.search || '').trim().toLowerCase();
  const filtered = q
    ? _tagsPageState.tags.filter(t => t.name.toLowerCase().includes(q))
    : _tagsPageState.tags;

  // Update counter
  const countEl = document.getElementById('tagsCountBadge');
  if (countEl) countEl.textContent = `${_tagsPageState.tags.length} tag${_tagsPageState.tags.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    container.innerHTML = `<div class="tag-mgr-empty">
      <div class="tag-mgr-empty-icon">🏷️</div>
      <div class="tag-mgr-empty-text">${q ? `Nenhuma tag contém "${esc(q)}"` : 'Nenhuma tag criada ainda.<br>Tags são adicionadas ao lançar transações.'}</div>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(tag => `
    <div class="tag-mgr-row" data-tag="${esc(tag.name)}" id="tag-row-${esc(_tagRowId(tag.name))}">
      <div class="tag-mgr-chip">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
        <span class="tag-mgr-name" id="tag-name-${esc(_tagRowId(tag.name))}">${esc(tag.name)}</span>
      </div>
      <div class="tag-mgr-meta">
        <span class="tag-mgr-count" title="Transações com esta tag">
          ${tag.tx_count} transaç${tag.tx_count !== 1 ? 'ões' : 'ão'}
          ${tag.sched_count > 0 ? `<span class="tag-mgr-sched-badge">+${tag.sched_count} prog.</span>` : ''}
        </span>
      </div>
      <div class="tag-mgr-actions">
        <button class="tag-mgr-btn tag-mgr-btn-edit" title="Renomear tag"
          onclick="openTagRenameModal('${esc(tag.name).replace(/'/g, "\\'")}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Renomear
        </button>
        <button class="tag-mgr-btn tag-mgr-btn-delete" title="Excluir tag de todas as transações"
          onclick="openTagDeleteConfirm('${esc(tag.name).replace(/'/g, "\\'")}', ${tag.total_count})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          Excluir
        </button>
      </div>
    </div>`).join('');
}

function _tagRowId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ── Filtro de busca ────────────────────────────────────────────────────────

function tagsSearchFilter(value) {
  _tagsPageState.search = value || '';
  _renderTagsList();
}
window.tagsSearchFilter = tagsSearchFilter;

// ── Modal: Renomear ────────────────────────────────────────────────────────

function openTagRenameModal(tagName) {
  const modal = document.getElementById('tagRenameModal');
  if (!modal) return;
  const oldEl  = document.getElementById('tagRenameOldName');
  const newEl  = document.getElementById('tagRenameNewName');
  const countEl= document.getElementById('tagRenameCount');

  if (oldEl)   oldEl.textContent = tagName;
  if (newEl)   { newEl.value = tagName; newEl.focus(); setTimeout(() => { newEl.select(); }, 50); }

  const tag = _tagsPageState.tags.find(t => t.name === tagName);
  if (countEl) countEl.textContent = tag
    ? `Será renomeada em ${tag.tx_count} transaç${tag.tx_count !== 1 ? 'ões' : 'ão'}${tag.sched_count > 0 ? ` e ${tag.sched_count} programada${tag.sched_count !== 1 ? 's' : ''}` : ''}.`
    : '';

  openModal('tagRenameModal');

  // Enter no input confirma
  if (newEl) {
    newEl.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmTagRename(); }
      if (e.key === 'Escape') closeModal('tagRenameModal');
    };
  }
}
window.openTagRenameModal = openTagRenameModal;

async function confirmTagRename() {
  const oldName = document.getElementById('tagRenameOldName')?.textContent?.trim();
  const newName = document.getElementById('tagRenameNewName')?.value?.trim();

  if (!oldName || !newName) { toast('Nome inválido', 'error'); return; }
  if (oldName === newName)  { closeModal('tagRenameModal'); return; }

  // Verificar se novo nome já existe
  if (_tagsPageState.tags.some(t => t.name.toLowerCase() === newName.toLowerCase() && t.name !== oldName)) {
    toast(`A tag "${newName}" já existe. Excluir a original mesclará as duas.`, 'warning');
    return;
  }

  closeModal('tagRenameModal');
  await _performTagRename(oldName, newName);
}
window.confirmTagRename = confirmTagRename;

async function _performTagRename(oldName, newName) {
  if (window.Cursor) Cursor.show('Renomeando tag…', 'save');
  let txUpdated = 0, scUpdated = 0, txErrors = 0, scErrors = 0;

  try {
    // ── 1. Transactions ────────────────────────────────────────────────────
    // Buscar todos os IDs de transações que contêm a tag antiga
    const { data: txRows, error: txFetchErr } = await famQ(
      sb.from('transactions')
        .select('id, tags')
        .contains('tags', [oldName])
    );
    if (txFetchErr) throw txFetchErr;

    // Atualizar em batches de 50
    const txBatches = _chunkArray(txRows || [], 50);
    for (const batch of txBatches) {
      const updates = batch.map(row => ({
        id:   row.id,
        tags: _replaceInArray(row.tags, oldName, newName),
      }));
      for (const u of updates) {
        const { error } = await famQ(
          sb.from('transactions').update({ tags: u.tags }).eq('id', u.id)
        );
        if (error) { txErrors++; } else { txUpdated++; }
      }
    }

    // ── 2. Scheduled transactions ──────────────────────────────────────────
    const { data: scRows, error: scFetchErr } = await famQ(
      sb.from('scheduled_transactions')
        .select('id, tags')
        .contains('tags', [oldName])
    );
    if (scFetchErr) throw scFetchErr;

    for (const row of scRows || []) {
      const { error } = await famQ(
        sb.from('scheduled_transactions')
          .update({ tags: _replaceInArray(row.tags, oldName, newName) })
          .eq('id', row.id)
      );
      if (error) { scErrors++; } else { scUpdated++; }
    }

    // ── 3. Invalidar caches ────────────────────────────────────────────────
    _invalidateTagCaches();

    // ── 4. Atualizar state.transactions em memória (evita reload completo) ─
    (state.transactions || []).forEach(t => {
      if (Array.isArray(t.tags) && t.tags.includes(oldName)) {
        t.tags = _replaceInArray(t.tags, oldName, newName);
      }
    });

    // ── 5. Feedback ───────────────────────────────────────────────────────
    const total = txUpdated + scUpdated;
    const errs  = txErrors + scErrors;
    if (errs > 0) {
      toast(`"${oldName}" → "${newName}": ${total} atualizadas, ${errs} erros. Recarregue e tente novamente.`, 'warning');
    } else {
      toast(`Tag renomeada: "${oldName}" → "${newName}" em ${total} registro${total !== 1 ? 's' : ''}.`, 'success');
    }

    await _loadTagsList();

  } catch(e) {
    toast('Erro ao renomear tag: ' + (e.message || e), 'error');
  } finally {
    if (window.Cursor) Cursor.hide();
  }
}

// ── Modal: Excluir ─────────────────────────────────────────────────────────

function openTagDeleteConfirm(tagName, totalCount) {
  const modal = document.getElementById('tagDeleteModal');
  if (!modal) return;
  const nameEl  = document.getElementById('tagDeleteName');
  const countEl = document.getElementById('tagDeleteCount');
  if (nameEl)  nameEl.textContent  = tagName;
  if (countEl) countEl.textContent = `Esta tag será removida de ${totalCount} registro${totalCount !== 1 ? 's' : ''}. Esta ação não pode ser desfeita.`;
  openModal('tagDeleteModal');
}
window.openTagDeleteConfirm = openTagDeleteConfirm;

async function confirmTagDelete() {
  const tagName = document.getElementById('tagDeleteName')?.textContent?.trim();
  if (!tagName) return;
  closeModal('tagDeleteModal');
  await _performTagDelete(tagName);
}
window.confirmTagDelete = confirmTagDelete;

async function _performTagDelete(tagName) {
  if (window.Cursor) Cursor.show('Excluindo tag…', 'save');
  let txUpdated = 0, scUpdated = 0, txErrors = 0, scErrors = 0;

  try {
    // ── 1. Transactions ────────────────────────────────────────────────────
    const { data: txRows, error: txFetchErr } = await famQ(
      sb.from('transactions')
        .select('id, tags')
        .contains('tags', [tagName])
    );
    if (txFetchErr) throw txFetchErr;

    for (const row of txRows || []) {
      const newTags = (row.tags || []).filter(t => t !== tagName);
      const { error } = await famQ(
        sb.from('transactions')
          .update({ tags: newTags.length ? newTags : null })
          .eq('id', row.id)
      );
      if (error) { txErrors++; } else { txUpdated++; }
    }

    // ── 2. Scheduled transactions ──────────────────────────────────────────
    const { data: scRows, error: scFetchErr } = await famQ(
      sb.from('scheduled_transactions')
        .select('id, tags')
        .contains('tags', [tagName])
    );
    if (scFetchErr) throw scFetchErr;

    for (const row of scRows || []) {
      const newTags = (row.tags || []).filter(t => t !== tagName);
      const { error } = await famQ(
        sb.from('scheduled_transactions')
          .update({ tags: newTags.length ? newTags : null })
          .eq('id', row.id)
      );
      if (error) { scErrors++; } else { scUpdated++; }
    }

    // ── 3. Invalidar caches e resetar filtros com essa tag ─────────────────
    _invalidateTagCaches();
    _resetActiveTagFilter(tagName);

    // ── 4. Atualizar state.transactions em memória ─────────────────────────
    (state.transactions || []).forEach(t => {
      if (Array.isArray(t.tags) && t.tags.includes(tagName)) {
        t.tags = t.tags.filter(x => x !== tagName);
        if (!t.tags.length) t.tags = null;
      }
    });

    const total = txUpdated + scUpdated;
    const errs  = txErrors + scErrors;
    if (errs > 0) {
      toast(`Tag "${tagName}" removida de ${total} registro${total !== 1 ? 's' : ''}, ${errs} erro${errs !== 1 ? 's' : ''}.`, 'warning');
    } else {
      toast(`Tag "${tagName}" excluída de ${total} registro${total !== 1 ? 's' : ''}.`, 'success');
    }

    await _loadTagsList();

  } catch(e) {
    toast('Erro ao excluir tag: ' + (e.message || e), 'error');
  } finally {
    if (window.Cursor) Cursor.hide();
  }
}

// ── Utilitários internos ───────────────────────────────────────────────────

function _replaceInArray(arr, oldVal, newVal) {
  if (!Array.isArray(arr)) return arr;
  const seen = new Set();
  const result = [];
  arr.forEach(item => {
    const replaced = item === oldVal ? newVal : item;
    const key = replaced.toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(replaced); }
  });
  return result;
}

function _chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Invalida os caches de autocomplete de tags nas transações */
function _invalidateTagCaches() {
  if (typeof _tagsState !== 'undefined') {
    _tagsState.allTags     = [];
    _tagsState.similarTags = [];
  }
  // Invalidar cache DB se existir
  if (typeof DB !== 'undefined' && typeof DB.bust === 'function') {
    try { DB.bust('transactions'); } catch(_) {}
  }
}

/** Resetar o filtro de tags em Reports se a tag deletada estiver selecionada */
function _resetActiveTagFilter(deletedTag) {
  try {
    const rptTagEl = document.getElementById('rptTag');
    if (rptTagEl && rptTagEl.value === deletedTag) {
      rptTagEl.value = '';
      if (typeof loadCurrentReport === 'function') loadCurrentReport();
    }
  } catch(_) {}
}

// ── Sugestão automática de tags ao selecionar categoria ───────────────────
// Dicionário de tags semânticas por nome de categoria (pt-BR, case-insensitive match)
const _TAG_SUGGESTIONS_BY_CATEGORY = {
  // Alimentação
  'alimentação':    ['mercado', 'restaurante', 'delivery', 'lanche', 'café'],
  'supermercado':   ['mercado', 'essencial', 'mensal'],
  'restaurante':    ['restaurante', 'refeição', 'trabalho'],
  'delivery':       ['delivery', 'ifood', 'impulso'],
  'lanche':         ['lanche', 'café', 'impulso'],

  // Transporte
  'transporte':     ['combustível', 'uber', 'ônibus', 'manutenção'],
  'combustível':    ['combustível', 'carro', 'mensal'],
  'estacionamento': ['estacionamento', 'carro', 'trabalho'],
  'manutenção':     ['manutenção', 'carro', 'revisão'],
  'pedágio':        ['pedágio', 'viagem', 'carro'],

  // Saúde
  'saúde':          ['farmácia', 'consulta', 'exame', 'plano-saúde'],
  'farmácia':       ['farmácia', 'medicamento'],
  'consulta':       ['consulta', 'médico', 'particular'],
  'plano de saúde': ['plano-saúde', 'mensal', 'essencial'],
  'academia':       ['academia', 'saúde', 'mensal'],

  // Moradia
  'moradia':        ['aluguel', 'condomínio', 'fixo', 'essencial'],
  'aluguel':        ['aluguel', 'mensal', 'fixo', 'essencial'],
  'condomínio':     ['condomínio', 'mensal', 'fixo'],
  'energia':        ['energia', 'conta', 'mensal'],
  'água':           ['água', 'conta', 'mensal'],
  'internet':       ['internet', 'assinatura', 'mensal'],
  'telefone':       ['telefone', 'conta', 'mensal'],

  // Lazer
  'lazer':          ['lazer', 'entretenimento', 'fim-de-semana'],
  'streaming':      ['streaming', 'assinatura', 'mensal'],
  'cinema':         ['cinema', 'lazer', 'fim-de-semana'],
  'viagem':         ['viagem', 'férias', 'planejado'],
  'esporte':        ['esporte', 'saúde', 'mensal'],

  // Educação
  'educação':       ['educação', 'mensalidade', 'investimento'],
  'escola':         ['escola', 'mensalidade', 'mensal'],
  'curso':          ['curso', 'educação', 'investimento'],
  'livro':          ['livro', 'educação'],

  // Finanças
  'investimento':   ['investimento', 'reserva', 'mensal'],
  'poupança':       ['poupança', 'reserva', 'mensal'],
  'financiamento':  ['financiamento', 'mensal', 'fixo'],
  'seguro':         ['seguro', 'mensal', 'essencial'],

  // Pets
  'pet':            ['pet', 'veterinário', 'ração'],
  'veterinário':    ['veterinário', 'pet', 'saúde'],

  // Vestuário
  'vestuário':      ['roupa', 'compra', 'impulso'],
  'roupas':         ['roupa', 'compra'],

  // Receitas comuns
  'salário':        ['salário', 'mensal', 'renda-principal'],
  'freelance':      ['freelance', 'renda-extra', 'variável'],
  'aluguel recebido': ['aluguel', 'renda-passiva', 'mensal'],
  'dividendos':     ['dividendos', 'investimento', 'renda-passiva'],
};

/**
 * Sugerir tags baseado na categoria selecionada.
 * Chamada pelo hook em ui_helpers.js após setCatPickerValue('tx').
 * Só adiciona tags se o campo de tags estiver vazio (não sobrescreve escolhas do usuário).
 */
function _tagsSuggestForCategory(categoryId) {
  try {
    // Só atua no contexto do formulário de transação
    if (!document.getElementById('txTagsChips')) return;
    // Se já há tags no campo, não sobrescrever
    if (typeof _tagsState !== 'undefined' && _tagsState.tags && _tagsState.tags.length > 0) return;

    const cat = (state.categories || []).find(c => c.id === categoryId);
    if (!cat) return;

    // Procurar por nome da categoria ou do pai
    const catNameLow = (cat.name || '').toLowerCase();
    const parent = cat.parent_id
      ? (state.categories || []).find(c => c.id === cat.parent_id)
      : null;
    const parentNameLow = (parent?.name || '').toLowerCase();

    let suggestions = null;
    // Tentar nome exato da subcategoria primeiro
    for (const [key, tags] of Object.entries(_TAG_SUGGESTIONS_BY_CATEGORY)) {
      if (catNameLow.includes(key) || key.includes(catNameLow)) {
        suggestions = tags;
        break;
      }
    }
    // Fallback: nome da categoria pai
    if (!suggestions && parentNameLow) {
      for (const [key, tags] of Object.entries(_TAG_SUGGESTIONS_BY_CATEGORY)) {
        if (parentNameLow.includes(key) || key.includes(parentNameLow)) {
          suggestions = tags;
          break;
        }
      }
    }

    if (!suggestions || !suggestions.length) return;

    // Mostrar sugestões como chips clicáveis abaixo do campo de tags
    const sugEl = document.getElementById('txTagsSuggestions');
    if (!sugEl) return;

    const html = `<div class="tags-sug-section">✨ Tags sugeridas para ${esc(cat.name)}</div>` +
      suggestions.slice(0, 5).map(tag =>
        `<div class="tags-sug-item" data-tag="${esc(tag)}" onclick="_tagsAdd('${esc(tag)}')">`+
        `<span style="font-size:.8rem">🏷</span>`+
        `<span class="tags-sug-tag">${esc(tag)}</span>`+
        `<span class="tags-sug-count">sugerida</span>`+
        `</div>`
      ).join('');

    sugEl.innerHTML = html;
    sugEl.style.display = '';

    // Auto-fechar sugestões após 4s se usuário não interagir
    setTimeout(() => {
      if (sugEl.style.display !== 'none') {
        if (typeof _tagsHideSuggestions === 'function') _tagsHideSuggestions();
      }
    }, 4000);
  } catch(_) {}
}
window._tagsSuggestForCategory = _tagsSuggestForCategory;

// ── Exports ────────────────────────────────────────────────────────────────

window.initTagsPage          = initTagsPage;
window.openTagRenameModal    = openTagRenameModal;
window.confirmTagRename      = confirmTagRename;
window.openTagDeleteConfirm  = openTagDeleteConfirm;
window.confirmTagDelete      = confirmTagDelete;
window.tagsSearchFilter      = tagsSearchFilter;
