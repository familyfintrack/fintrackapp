/* ═══════════════════════════════════════════════════════════════════════
   INVESTMENTS MODULE — v1
   Tables: investment_positions, investment_transactions, investment_price_history
   Price API: brapi.dev (B3/FIIs/BDRs/Crypto) + Yahoo Finance fallback (US stocks)
   Activation: investments_enabled_{family_id} in app_settings
   Balance: account.balance += SUM(position.quantity × current_price_brl)
═══════════════════════════════════════════════════════════════════════ */

const ASSET_TYPES = [
  { value: 'acao_br',    label: 'Ação BR',       emoji: '🇧🇷', hint: 'Ex: PETR4, VALE3'    },
  { value: 'fii',        label: 'FII',           emoji: '🏢', hint: 'Ex: KNRI11, HGLG11'  },
  { value: 'etf_br',     label: 'ETF BR',        emoji: '📊', hint: 'Ex: BOVA11, IVVB11'  },
  { value: 'acao_us',    label: 'Ação US',       emoji: '🇺🇸', hint: 'Ex: AAPL, GOOGL'    },
  { value: 'etf_us',     label: 'ETF US',        emoji: '📈', hint: 'Ex: SPY, QQQ'        },
  { value: 'bdr',        label: 'BDR',           emoji: '🌐', hint: 'Ex: AAPL34, AMZO34'  },
  { value: 'fundo',      label: 'Fundo',         emoji: '🏦', hint: 'Fundo CDB/IPCA/CDI'  },
  { value: 'crypto',     label: 'Criptomoeda',   emoji: '₿',  hint: 'Ex: BTC, ETH'        },
  { value: 'renda_fixa', label: 'Renda Fixa',    emoji: '💰', hint: 'CDB, LCI, Tesouro'   },
  { value: 'outro',      label: 'Outro',         emoji: '📌', hint: 'Qualquer ativo'       },
];

// Corretoras conhecidas — combo com "Outro" para entrada livre
const KNOWN_BROKERS = [
  // Corretoras independentes
  'XP Investimentos', 'Clear', 'Rico', 'BTG Pactual Digital', 'Toro Investimentos',
  'Warren', 'Órama', 'Modal', 'NuInvest (Easynvest)', 'Avenue', 'Stake',
  'Inter Invest', 'Genial Investimentos', 'Guide Investimentos', 'Mirae Asset',
  'CM Capital', 'Ágora Investimentos', 'SWM', 'Vitreo', 'Kinea',
  // Bancos com plataforma de investimentos
  'Itaú', 'Bradesco', 'Banco do Brasil', 'Santander', 'Caixa',
  'Nubank', 'C6 Bank', 'Banco Inter', 'Sicoob', 'Sicredi',
  // Internacionais
  'Interactive Brokers', 'TD Ameritrade', 'Charles Schwab', 'Fidelity',
  'Binance', 'Coinbase', 'Kraken',
  'Outro',
];

// Module state
const _inv = {
  positions:    [],   // investment_positions rows
  transactions: [],   // investment_transactions rows
  loaded:       false,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function _invAccounts() {
  return (state.accounts || []).filter(a => a.type === 'investimento');
}

function _invBrlPrice(pos) {
  // Convert current_price to BRL using app FX rates
  if (!pos.current_price) return 0;
  if (!pos.currency || pos.currency === 'BRL') return +pos.current_price;
  return toBRL(+pos.current_price, pos.currency);
}

function _invMarketValue(pos) {
  return (+(pos.quantity) || 0) * _invBrlPrice(pos);
}

function _invCost(pos) {
  return (+(pos.quantity) || 0) * (+(pos.avg_cost) || 0);
}

function _invReturn(pos) {
  const mv   = _invMarketValue(pos);
  const cost = _invCost(pos);
  if (!cost) return 0;
  return (mv - cost) / cost * 100;
}

function _invAssetType(value) {
  return ASSET_TYPES.find(t => t.value === value) || ASSET_TYPES.at(-1);
}

// Total market value of all positions for a given account_id
function invAccountMarketValue(accountId) {
  return _inv.positions
    .filter(p => p.account_id === accountId && (+(p.quantity) || 0) > 0)
    .reduce((s, p) => s + _invMarketValue(p), 0);
}

// Total market value across ALL investment accounts for this family
function invTotalPortfolioValue() {
  return _inv.positions
    .filter(p => (+(p.quantity) || 0) > 0)
    .reduce((s, p) => s + _invMarketValue(p), 0);
}

// ── Data load ───────────────────────────────────────────────────────────────

async function loadInvestments(force = false) {
  if (!sb || !famId()) return;
  if (!force && _inv.loaded) return;

  try {
    const [posRes, txRes] = await Promise.all([
      famQ(sb.from('investment_positions')
        .select('*')
      ).order('ticker'),
      famQ(sb.from('investment_transactions')
        .select('*, investment_positions(ticker,name,asset_type)')
      ).order('date', { ascending: false }),
    ]);

    _inv.positions    = posRes.data    || [];
    _inv.transactions = txRes.data     || [];
    _inv.loaded       = true;

    // Augment account balances with market value
    _invAugmentAccountBalances();
  } catch (e) {
    console.warn('[investments] load error:', e.message);
  }
}

function _invAugmentAccountBalances() {
  // Called after loadInvestments() and after DB.accounts.load()
  // Adds market value of positions to each investment account's balance
  _invAccounts().forEach(acc => {
    const mv = invAccountMarketValue(acc.id);
    acc._investmentMarketValue = mv; // store separately for display
    // Don't double-add: subtract transaction amounts already counted
    // The transactions that bought assets already debited the cash from the account,
    // so we add back the current market value of those positions
    const invested = _inv.positions
      .filter(p => p.account_id === acc.id && (+(p.quantity) || 0) > 0)
      .reduce((s, p) => s + _invCost(p), 0);
    // balance = cash_balance + (market_value - cost_basis)  →  unrealised gain
    // cash_balance is initial_balance + sum(transactions) which already deducted the cost
    acc._unrealisedPnL = mv - invested;
    // The "true" balance the user sees = what's in cash + what positions are worth
    acc._totalPortfolioBalance = acc.balance + mv;
  });
}

// ── Page render ─────────────────────────────────────────────────────────────

async function loadInvestmentsPage() {
  if (!sb) return;
  await loadInvestments();
  _renderInvestmentsPage();
}

function _renderInvestmentsPage() {
  const container = document.getElementById('investmentsContent');
  if (!container) return;

  const invAccs = _invAccounts();
  if (!invAccs.length) {
    container.innerHTML = `
      <div class="empty-state" style="text-align:center;padding:48px 20px">
        <div style="font-size:3rem;margin-bottom:12px">📊</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--text)">Nenhuma conta de investimentos</div>
        <p style="font-size:.85rem;color:var(--muted);margin:8px 0 20px">
          Para usar o módulo de investimentos, crie uma conta do tipo <strong>Investimentos</strong>.
        </p>
        <button class="btn btn-primary" onclick="openAccountModal();closeModal&&closeModal('accountModal')">
          + Criar conta de investimentos
        </button>
      </div>`;
    return;
  }

  const totalMV     = invTotalPortfolioValue();
  const totalCost   = _inv.positions.reduce((s,p)=>(+(p.quantity)>0 ? s+_invCost(p) : s), 0);
  const totalReturn = totalCost ? (totalMV - totalCost) / totalCost * 100 : 0;
  const totalPnL    = totalMV - totalCost;
  const isPnLPos    = totalPnL >= 0;

  // Asset type distribution for mini bar
  const byType = {};
  _inv.positions.filter(p=>+(p.quantity)>0).forEach(p=>{
    const k = p.asset_type || 'outro';
    byType[k] = (byType[k]||0) + _invMarketValue(p);
  });
  const typeBar = totalMV > 0 ? Object.entries(byType)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>{
      const t = _invAssetType(k);
      const pct = (v/totalMV*100).toFixed(1);
      const colors = {acao_br:'#2a6049',fii:'#7c3aed',etf_br:'#0891b2',acao_us:'#dc2626',etf_us:'#ea580c',bdr:'#d97706',crypto:'#f59e0b',renda_fixa:'#16a34a',outro:'#94a3b8'};
      const col = colors[k]||'#94a3b8';
      return `<div title="${t.emoji} ${t.label}: ${pct}% (${fmt(v)})" style="flex:${pct};background:${col};min-width:3px"></div>`;
    }).join('') : '';

  container.innerHTML = `
    <!-- Portfolio hero header -->
    <div class="inv-hero">
      <div class="inv-hero-main">
        <div class="inv-hero-label">Valor de Mercado Total</div>
        <div class="inv-hero-value">${fmt(totalMV)}</div>
        <div class="inv-hero-pnl ${isPnLPos ? 'pos' : 'neg'}">
          ${isPnLPos ? '▲' : '▼'} ${isPnLPos ? '+' : ''}${fmt(totalPnL)}
          <span class="inv-hero-pct">(${isPnLPos?'+':''}${totalReturn.toFixed(2)}%)</span>
          <span class="inv-hero-cost">vs custo ${fmt(totalCost)}</span>
        </div>
      </div>
      <div class="inv-hero-kpis">
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Posições abertas</div>
          <div class="inv-kpi-value">${_inv.positions.filter(p=>+(p.quantity)>0).length}</div>
        </div>
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Contas</div>
          <div class="inv-kpi-value">${invAccs.length}</div>
        </div>
        <div class="inv-kpi-card">
          <div class="inv-kpi-label">Custo médio</div>
          <div class="inv-kpi-value">${fmt(totalCost)}</div>
        </div>
      </div>
      ${typeBar ? `
      <div class="inv-type-bar-wrap">
        <div class="inv-type-bar">${typeBar}</div>
        <div class="inv-type-bar-legend">
          ${Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>{
            const t = _invAssetType(k);
            const pct = (v/totalMV*100).toFixed(1);
            const colors = {acao_br:'#2a6049',fii:'#7c3aed',etf_br:'#0891b2',acao_us:'#dc2626',etf_us:'#ea580c',bdr:'#d97706',crypto:'#f59e0b',renda_fixa:'#16a34a',outro:'#94a3b8'};
            return `<span class="inv-legend-item"><span style="background:${colors[k]||'#94a3b8'}"></span>${t.emoji} ${t.label} ${pct}%</span>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- Actions bar -->
    <div class="inv-actions-bar">
      <div class="inv-actions-left">
        <button class="btn btn-primary" onclick="openInvTransactionModal()">+ Movimentação</button>
      </div>
      <div class="inv-actions-right">
        <button class="btn btn-ghost" id="invUpdatePricesBtn" onclick="updateAllPrices()">🔄 Cotações</button>
        <span id="invPriceUpdateStatus" class="inv-price-update-status"></span>
      </div>
    </div>

    <!-- Performance charts section -->
    <div class="inv-charts-section">
      <div class="inv-chart-card" id="invPerfChartCard">
        <div class="inv-chart-header">
          <span class="inv-chart-title">📈 Evolução da Carteira</span>
          <span class="inv-chart-sub" id="invPerfChartPeriod"></span>
        </div>
        <div class="inv-chart-wrap" style="height:220px">
          <canvas id="invPortfolioChart"></canvas>
        </div>
      </div>
      <div class="inv-chart-card" id="invAllocChartCard">
        <div class="inv-chart-header">
          <span class="inv-chart-title">🥧 Alocação por Tipo de Ativo</span>
        </div>
        <div class="inv-chart-wrap" style="height:220px">
          <canvas id="invAllocationChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Per-account portfolios -->
    ${invAccs.map(acc => _renderPortfolioCard(acc)).join('')}
  `;

  // Render charts asynchronously after DOM is ready
  requestAnimationFrame(() => {
    renderInvAllocationChart();
    renderInvPerformanceChart().catch(() => {});
  });
}

function _renderPortfolioCard(acc) {
  const positions = _inv.positions.filter(p => p.account_id === acc.id && (+(p.quantity) || 0) > 0);
  const mv        = invAccountMarketValue(acc.id);
  const cost      = positions.reduce((s,p) => s + _invCost(p), 0);
  const pnl       = mv - cost;
  const ret       = cost ? pnl / cost * 100 : 0;
  // Cash available = account balance (transactions already deducted purchases)
  const cash      = +(acc.balance) || 0;

  // Group by asset type
  const byType = {};
  positions.forEach(p => {
    const k = p.asset_type || 'outro';
    if (!byType[k]) byType[k] = [];
    byType[k].push(p);
  });

  const typeRows = Object.entries(byType).map(([type, ps]) => {
    const t = _invAssetType(type);
    const typeRows = ps.map(p => _renderPositionRow(p, mv)).join('');
    return `
      <div class="inv-type-group">
        <div class="inv-type-label">${t.emoji} ${t.label}</div>
        ${typeRows}
      </div>`;
  }).join('');

  return `
    <div class="card inv-portfolio-card">
      <div class="inv-portfolio-header">
        <div class="inv-portfolio-header-left">
          <div class="inv-portfolio-account-name">${esc(acc.name)}</div>
          <div class="inv-portfolio-meta">
            <span class="inv-portfolio-meta-item">💵 Caixa: <strong>${fmt(cash, acc.currency)}</strong></span>
            <span class="inv-portfolio-meta-item">📊 Mercado: <strong>${fmt(mv)}</strong></span>
          </div>
        </div>
        <div class="inv-portfolio-pnl ${pnl>=0?'pos':'neg'}">
          <div class="inv-portfolio-pnl-amt">${pnl>=0?'+':''}${fmt(pnl)}</div>
          <div class="inv-portfolio-pnl-pct">${ret>=0?'+':''}${ret.toFixed(2)}%</div>
        </div>
      </div>
      ${positions.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--muted);font-size:.83rem">
             Sem posições abertas.
             <a href="#" onclick="event.preventDefault();openInvTransactionModal('${acc.id}')">Registrar compra</a>
           </div>`
        : `<div class="inv-positions-table">
             <div class="inv-pos-header">
               <span>Ativo</span><span>Qtd</span><span>Custo Médio</span>
               <span>Preço Atual</span><span>Valor</span><span>Retorno</span><span></span>
             </div>
             ${typeRows}
           </div>`
      }
    </div>`;
}

function _renderPositionRow(p, totalMV) {
  const mv   = _invMarketValue(p);
  const cost = +p.avg_cost || 0;
  const cur  = _invBrlPrice(p);
  const ret  = cost ? (cur - cost) / cost * 100 : 0;
  const pct  = totalMV ? mv / totalMV * 100 : 0;
  const t    = _invAssetType(p.asset_type);
  const stale= p.price_updated_at
    ? (Date.now() - new Date(p.price_updated_at).getTime()) > 24*60*60*1000
    : true;

  return `
    <div class="inv-pos-row" id="invPos-${p.id}">
      <div class="inv-pos-name">
        <span class="inv-pos-ticker">${esc(p.ticker)}</span>
        <span class="inv-pos-desc">${esc(p.name || '')} <span class="inv-pos-type-badge">${t.emoji} ${t.label}</span></span>
      </div>
      <span class="inv-pos-cell">${(+(p.quantity)).toFixed(4).replace(/\.?0+$/, '') || '0'}</span>
      <span class="inv-pos-cell">${fmt(cost)}</span>
      <span class="inv-pos-cell ${stale ? 'inv-price-stale' : ''}">
        ${cur ? fmt(cur, p.currency) : '—'}${stale ? ' <span title="Cotação desatualizada" style="font-size:.8rem">⚠️</span>' : ''}
      </span>
      <span class="inv-pos-cell">
        <div style="font-weight:700">${fmt(mv)}</div>
        <div class="inv-pos-alloc-wrap"><div class="inv-pos-alloc-bar" style="width:${Math.min(pct,100).toFixed(1)}%"></div><span class="inv-pos-alloc-pct">${pct.toFixed(1)}%</span></div>
      </span>
      <span class="inv-pos-return ${ret >= 0 ? 'pos' : 'neg'}">
        ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%
      </span>
      <span class="inv-pos-actions">
        <button class="btn-icon" onclick="openInvPositionDetail('${p.id}')" title="Histórico">📋</button>
        <button class="btn-icon" onclick="openInvTransactionModal(null,'${p.id}')" title="Nova movimentação">+</button>
        <button class="btn-icon" onclick="openInvBalanceModal('${p.id}')" title="Informar saldo atual" style="font-size:.8rem">💰</button>
      </span>
    </div>`;
}

// ── Price update ────────────────────────────────────────────────────────────

async function updateAllPrices() {
  const btn    = document.getElementById('invUpdatePricesBtn');
  const status = document.getElementById('invPriceUpdateStatus');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Atualizando…'; }

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar Cotações'; }
    return;
  }

  // Group by API to use
  const brapi   = positions.filter(p => ['acao_br','fii','etf_br','bdr'].includes(p.asset_type));
  const usStocks= positions.filter(p => ['acao_us','etf_us'].includes(p.asset_type));
  const crypto  = positions.filter(p => p.asset_type === 'crypto');
  const manual  = positions.filter(p => p.asset_type === 'renda_fixa' || p.asset_type === 'outro');

  let updated = 0, failed = 0;
  const today = todayISO();

  // 1 — B3 / FIIs / BDRs via brapi.dev
  if (brapi.length) {
    try {
      if (status) status.textContent = `Buscando B3 (${brapi.length} ativos)…`;
      const tickers = brapi.map(p => p.ticker).join(',');
      const res  = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(tickers)}?token=anonymous`);
      const json = await res.json();
      for (const q of (json.results || [])) {
        const pos = brapi.find(p => p.ticker.toUpperCase() === q.symbol?.toUpperCase());
        if (!pos || !q.regularMarketPrice) continue;
        await _invSavePrice(pos, q.regularMarketPrice, 'BRL', today, 'api');
        updated++;
      }
    } catch(e) { console.warn('[inv] brapi error:', e.message); failed += brapi.length; }
  }

  // 2 — US stocks / ETFs via Yahoo Finance (no auth, CORS-free endpoint)
  for (const pos of usStocks) {
    try {
      if (status) status.textContent = `Buscando ${pos.ticker}…`;
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pos.ticker)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(8000) }
      );
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) {
        await _invSavePrice(pos, price, 'USD', today, 'api');
        updated++;
      } else { failed++; }
    } catch(e) { console.warn(`[inv] yahoo ${pos.ticker}:`, e.message); failed++; }
  }

  // 3 — Crypto via CoinGecko free API
  if (crypto.length) {
    try {
      if (status) status.textContent = `Buscando cripto (${crypto.length} ativos)…`;
      // Build CoinGecko IDs from ticker
      const COIN_IDS = { BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',
        ADA:'cardano',XRP:'ripple',MATIC:'matic-network',DOT:'polkadot',
        AVAX:'avalanche-2',LINK:'chainlink',LTC:'litecoin',DOGE:'dogecoin' };
      for (const pos of crypto) {
        const coinId = COIN_IDS[pos.ticker.toUpperCase()];
        if (!coinId) { failed++; continue; }
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=brl`,
          { signal: AbortSignal.timeout(8000) }
        );
        const j = await r.json();
        const price = j?.[coinId]?.brl;
        if (price) {
          await _invSavePrice(pos, price, 'BRL', today, 'api');
          updated++;
        } else { failed++; }
      }
    } catch(e) { console.warn('[inv] coingecko error:', e.message); failed += crypto.length; }
  }

  // 4 — Manual / renda fixa: show count
  if (manual.length) {
    if (status) status.textContent = `${manual.length} ativo(s) precisam de atualização manual.`;
  }

  // Persist to DB + reload
  await loadInvestments(true);
  _invAugmentAccountBalances();
  _renderInvestmentsPage();

  const msg = `✅ ${updated} cotação${updated!==1?'ões':''} atualizada${updated!==1?'s':''}`
    + (failed ? ` · ⚠️ ${failed} falha${failed!==1?'s':''}` : '');
  if (status) status.textContent = msg;
  toast(msg, failed ? 'warning' : 'success');

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Atualizar Cotações'; }
}

async function _invSavePrice(pos, price, currency, date, source) {
  // Update position current_price
  await sb.from('investment_positions').update({
    current_price:    price,
    currency:         currency,
    price_updated_at: localISOTimestamp(),
    updated_at:       localISOTimestamp(),
  }).eq('id', pos.id);

  // Upsert price history
  await sb.from('investment_price_history').upsert({
    position_id: pos.id,
    family_id:   pos.family_id,
    date,
    price,
    currency,
    source,
  }, { onConflict: 'position_id,date' });

  // Update local state
  const local = _inv.positions.find(p => p.id === pos.id);
  if (local) { local.current_price = price; local.currency = currency; }
}

// ── Transaction modal (buy / sell) ──────────────────────────────────────────

// Modos do modal de transacao de investimento
// 'buysell'  — Compra/Venda com Qtd + Preco unitario (padrao)
// 'simple'   — Apenas valor total investido (sem qtd/preco)
// 'tax'      — Registrar taxa ou imposto sobre o ativo
let _invTxModalMode = 'buysell';

function _invSetModalMode(mode) {
  _invTxModalMode = mode;
  const isBuySell = mode === 'buysell';
  const isSimple  = mode === 'simple';
  const isTax     = mode === 'tax';

  // Tabs
  document.getElementById('invModeTabBuySell')?.classList.toggle('active', isBuySell);
  document.getElementById('invModeTabSimple')?.classList.toggle('active', isSimple);
  document.getElementById('invModeTabTax')?.classList.toggle('active', isTax);

  // Secoes de modo
  const secBuySell = document.getElementById('invSecBuySell');
  const secSimple  = document.getElementById('invSecSimple');
  const secTax     = document.getElementById('invSecTax');
  if (secBuySell) secBuySell.style.display = isBuySell ? '' : 'none';
  if (secSimple)  secSimple.style.display  = isSimple  ? '' : 'none';
  if (secTax)     secTax.style.display     = isTax     ? '' : 'none';

  // Corretora/fundo: apenas em Compra/Venda
  const secBroker = document.getElementById('invSecCommonBroker');
  if (secBroker) secBroker.style.display = isBuySell ? '' : 'none';

  // Botao salvar
  const btn = document.getElementById('invTxSaveBtn');
  if (btn) {
    if (isTax)     { btn.textContent = '💾 Registrar Taxa/Imposto'; btn.onclick = saveInvTax; }
    else if (isSimple) { btn.textContent = '💾 Registrar Aporte';   btn.onclick = saveInvSimple; }
    else           {
      const txType = document.getElementById('invTxType')?.value || 'buy';
      btn.textContent = txType === 'sell' ? '💾 Registrar Venda' : '💾 Registrar Compra';
      btn.onclick = saveInvTransaction;
    }
  }
}
window._invSetModalMode = _invSetModalMode;

function openInvTransactionModal(accountId = null, positionId = null) {
  document.getElementById('invTxModal')?.remove();
  _invTxModalMode = 'buysell';

  const invAccs = _invAccounts();
  if (!invAccs.length) {
    toast('Crie uma conta do tipo Investimentos primeiro', 'error'); return;
  }

  const pos     = positionId ? _inv.positions.find(p => p.id === positionId) : null;
  const accOpts = invAccs.map(a =>
    `<option value="${a.id}" ${(accountId && a.id === accountId) || (!accountId && !pos) ? '' : ''}>
      ${esc(a.name)}</option>`
  ).join('');
  const typeOpts = ASSET_TYPES.map(t =>
    `<option value="${t.value}">${t.emoji} ${t.label} — ${t.hint}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'invTxModal';
  modal.style.zIndex = '10010';
  modal.innerHTML = `
  <div class="modal" style="max-width:500px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title" id="invTxModalTitle">Registrar Movimentação</span>
      <button class="modal-close" onclick="closeModal('invTxModal')">✕</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="invTxPositionId" value="${positionId || ''}">
      <input type="hidden" id="invTxType" value="buy">

      <!-- Campos comuns: conta, data, ticker, tipo ativo, nome -->
      <div class="form-grid" style="margin-bottom:4px">
        <div class="form-group">
          <label>Conta de Investimentos *</label>
          <select id="invTxAccount" onchange="_invOnAccountChange()">${accOpts}</select>
        </div>
        <div class="form-group">
          <label>Data *</label>
          <input type="date" id="invTxDate" value="${todayISO()}">
        </div>
        <div class="form-group">
          <label>Código do Ativo *</label>
          <input type="text" id="invTxTicker" placeholder="Ex: PETR4, BTC, AAPL"
            value="${pos ? pos.ticker : ''}"
            oninput="this.value=this.value.toUpperCase()" style="text-transform:uppercase">
        </div>
        <div class="form-group" id="invTxTypeGroup" ${pos ? 'style="display:none"' : ''}>
          <label>Tipo de Ativo *</label>
          <select id="invTxAssetType">${typeOpts}</select>
        </div>
        <div class="form-group full">
          <label>Nome / Descrição</label>
          <input type="text" id="invTxName" placeholder="Nome do ativo (opcional)"
            value="${pos ? esc(pos.name || '') : ''}">
        </div>
      </div>

      <!-- Tabs de modo -->
      <div class="tab-bar mb-4" style="margin-top:8px">
        <button class="tab active" id="invModeTabBuySell" onclick="_invSetModalMode('buysell')">📥 Compra / Venda</button>
        <button class="tab" id="invModeTabSimple"  onclick="_invSetModalMode('simple')">💵 Valor Total</button>
        <button class="tab" id="invModeTabTax"     onclick="_invSetModalMode('tax')">🏛️ Taxa / Imposto</button>
      </div>

      <!-- SECAO: Compra / Venda -->
      <div id="invSecBuySell">
        <div class="tab-bar mb-4" style="margin-bottom:12px">
          <button class="tab active" id="invTxBuyTab"  onclick="_invSetTxType('buy')">📥 Compra</button>
          <button class="tab"        id="invTxSellTab" onclick="_invSetTxType('sell')">📤 Venda</button>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Quantidade *</label>
            <input type="text" id="invTxQty" inputmode="decimal" placeholder="0"
              oninput="_invCalcTotal();_invFmtQty(this)" onblur="_invFmtQtyBlur(this)">
          </div>
          <div class="form-group">
            <label>Preço Unitário (BRL) *</label>
            <input type="text" id="invTxPrice" inputmode="decimal" placeholder="0,00"
              oninput="_invFmtPrice(this)" onblur="_invFmtPriceBlur(this)">
          </div>
          <div class="form-group full">
            <div style="display:flex;justify-content:space-between;align-items:center;
              padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border)">
              <span style="font-size:.82rem;font-weight:600">Total da operação:</span>
              <span id="invTxTotal" style="font-size:1rem;font-weight:700;color:var(--accent)">R$ 0,00</span>
            </div>
            <div id="invTxCashWarning" style="display:none;font-size:.78rem;color:var(--amber,#b45309);margin-top:6px;
              padding:6px 10px;background:rgba(245,158,11,.1);border-radius:6px">
              ⚠️ Saldo em caixa insuficiente para esta compra.
            </div>
          </div>
        </div>
      </div>

      <!-- SECAO: Valor Total (modo simplificado) -->
      <div id="invSecSimple" style="display:none">
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:var(--r-sm);border-left:3px solid var(--accent)">
          Informe apenas o valor total aportado. O app registra o aporte sem controle de quantidade/preço unitário —
          ideal para fundos, previdência ou quando você só quer acompanhar o saldo total.
        </div>
        <div class="form-grid">
          <div class="form-group full">
            <label>Valor Total Aportado (BRL) *</label>
            <input type="text" id="invSimpleTotal" inputmode="decimal" placeholder="0,00"
              style="font-size:1.1rem;font-weight:700;text-align:right"
              oninput="_invFmtBalanceInput(this)" onblur="_invFmtPriceBlur(this)">
          </div>
          <div class="form-group full">
            <label>Observação</label>
            <input type="text" id="invSimpleNotes" placeholder="Estratégia, aporte programado…">
          </div>
        </div>
      </div>

      <!-- SECAO: Taxa / Imposto -->
      <div id="invSecTax" style="display:none">
        <div style="font-size:.8rem;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:var(--r-sm);border-left:3px solid var(--amber,#b45309)">
          Registre taxas de administração, corretagem, IOF, IR sobre rendimentos ou qualquer encargo sobre este ativo.
          O valor será debitado da conta de investimentos.
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Tipo de Encargo *</label>
            <select id="invTaxType">
              <option value="taxa_adm">Taxa de Administração</option>
              <option value="corretagem">Corretagem</option>
              <option value="iof">IOF</option>
              <option value="ir">IR sobre Rendimento</option>
              <option value="emolumentos">Emolumentos / B3</option>
              <option value="custódia">Taxa de Custódia</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="form-group">
            <label>Valor (BRL) *</label>
            <input type="text" id="invTaxAmount" inputmode="decimal" placeholder="0,00"
              style="text-align:right"
              oninput="_invFmtBalanceInput(this)" onblur="_invFmtPriceBlur(this)">
          </div>
          <div class="form-group full">
            <label>Descrição / Detalhamento</label>
            <input type="text" id="invTaxNotes" placeholder="Ex: IR retido na fonte — competência Mar/2026">
          </div>
        </div>
      </div>

      <!-- Campos comuns: corretora, fundo, observacao (apenas em Compra/Venda) -->
      <div id="invSecCommonBroker">
        <div class="form-grid" style="margin-top:8px">
          <div class="form-group">
            <label>Corretora</label>
            <select id="invTxBroker" onchange="_invOnBrokerChange()">
              <option value="">— Selecionar —</option>
            </select>
          </div>
          <div class="form-group" id="invTxBrokerOtherGroup" style="display:none">
            <label>Nome da Corretora</label>
            <input type="text" id="invTxBrokerOther" placeholder="Nome da corretora…">
          </div>
          <div class="form-group full" id="invFundoPanel" style="display:none">
            <div style="background:linear-gradient(135deg,rgba(30,92,66,.08),rgba(42,96,73,.05));border:1px solid rgba(42,96,73,.2);border-radius:10px;padding:12px 14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                <div style="font-size:.8rem;font-weight:700;color:var(--accent)">🤖 Enriquecer com IA</div>
                <button type="button" onclick="_invEnrichFundoAI()" id="invFundoAiBtn"
                  style="font-size:.72rem;font-weight:700;padding:4px 12px;border-radius:20px;border:1.5px solid var(--accent);background:var(--accent-lt);color:var(--accent);cursor:pointer;font-family:var(--font-sans)">
                  🔍 Identificar Fundo
                </button>
              </div>
              <div id="invFundoAiResult" style="font-size:.78rem;color:var(--muted);line-height:1.55">
                Informe o código do ativo (ex: KDIF11, HGBS11) e clique em Identificar Fundo para buscar dados via IA.
              </div>
              <div id="invFundoIndexador" style="display:none;margin-top:8px">
                <label style="font-size:.75rem;font-weight:600;color:var(--text2);display:block;margin-bottom:4px">Indexador</label>
                <select id="invFundoIndexadorSel" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface);color:var(--text)">
                  <option value="">— Selecionar —</option>
                  <option value="CDI">CDI</option>
                  <option value="IPCA">IPCA</option>
                  <option value="IGP-M">IGP-M</option>
                  <option value="Selic">Selic</option>
                  <option value="INPC">INPC</option>
                  <option value="Prefixado">Prefixado</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>
          </div>
          <div class="form-group full">
            <label>Observação</label>
            <input type="text" id="invTxNotes" placeholder="Estratégia, notas…">
          </div>
        </div>
      </div>

      <div id="invTxError" style="display:none;color:var(--red);font-size:.8rem;margin-top:8px;
        padding:8px 12px;background:#fff5f5;border:1px solid #fca5a5;border-radius:var(--r-sm)"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invTxModal')">Cancelar</button>
      <button class="btn btn-primary" id="invTxSaveBtn" onclick="saveInvTransaction()">
        💾 Registrar Compra
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  // Populate broker select
  const brokerSel = document.getElementById('invTxBroker');
  if (brokerSel) {
    KNOWN_BROKERS.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      brokerSel.appendChild(opt);
    });
    // Prefill from position notes if it contains a known broker
    if (pos?.notes) {
      const found = KNOWN_BROKERS.find(b => pos.notes.toLowerCase().includes(b.toLowerCase()));
      if (found) brokerSel.value = found;
    }
  }
  if (accountId) document.getElementById('invTxAccount').value = accountId;
  if (pos) {
    const assetType = pos.asset_type || 'outro';
    document.getElementById('invTxAssetType').value = assetType;
    _invToggleFundoPanel(assetType);
  }
  // Wire assetType change to show/hide fundo panel
  document.getElementById('invTxAssetType')?.addEventListener('change', function() {
    _invToggleFundoPanel(this.value);
  });
}

// ── Toggle fundo enrichment panel ──
function _invToggleFundoPanel(assetType) {
  const panel = document.getElementById('invFundoPanel');
  if (panel) panel.style.display = (assetType === 'fundo') ? '' : 'none';
}

// ── Broker "Outro" toggle ──
function _invOnBrokerChange() {
  const sel = document.getElementById('invTxBroker');
  const otherGrp = document.getElementById('invTxBrokerOtherGroup');
  if (otherGrp) otherGrp.style.display = sel?.value === 'Outro' ? '' : 'none';
}
window._invOnBrokerChange = _invOnBrokerChange;

// ── Formatação automática de qty / price ──────────────────────────────────
function _invFmtQty(el) {
  let v = el.value.replace(/[^\d.,]/g, '');
  el.value = v;
}
function _invFmtQtyBlur(el) {
  const v = parseFloat(el.value.replace(',', '.'));
  if (!isNaN(v) && v > 0) el.value = v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

// Mascara de preco: entrada automatica de 2 casas decimais (estilo centavos).
// Conforme o usuario digita: "1" -> "0,01"; "12" -> "0,12"; "123" -> "1,23"
function _invFmtPrice(el) {
  const raw = el.value.replace(/\D/g, '');
  if (!raw) { el.value = ''; _invCalcTotal(); return; }
  const cents = parseInt(raw, 10);
  el.value = (cents / 100).toFixed(2).replace('.', ',');
  _invCalcTotal();
}
function _invFmtPriceBlur(el) {
  const raw = el.value.replace(',', '.');
  const v = parseFloat(raw);
  if (!isNaN(v) && v > 0) {
    el.value = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
// Leitura segura do campo de preco (suporta "1.234,56" e "1234,56")
function _invReadPrice(el) {
  if (!el) return 0;
  return parseFloat(el.value.replace(/\./g, '').replace(',', '.')) || 0;
}
window._invFmtQty = _invFmtQty;
window._invFmtQtyBlur = _invFmtQtyBlur;
window._invFmtPrice = _invFmtPrice;
window._invFmtPriceBlur = _invFmtPriceBlur;

// ── Enriquecer fundo com Gemini ──
async function _invEnrichFundoAI() {
  const ticker = document.getElementById('invTxTicker')?.value?.trim()?.toUpperCase();
  const btn    = document.getElementById('invFundoAiBtn');
  const result = document.getElementById('invFundoAiResult');
  const indexPanel = document.getElementById('invFundoIndexador');

  if (!ticker) { toast('Informe o código do ativo primeiro', 'warning'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
  if (result) result.textContent = '🔍 Consultando IA…';

  try {
    const key = typeof _invGetGeminiKey === 'function' ? await _invGetGeminiKey() : null;
    if (!key) throw new Error('Chave Gemini não configurada. Configure em Configurações → IA.');

    const prompt = `Você é um especialista em investimentos brasileiros.
Dado o código de ativo "${ticker}", identifique:
1. Nome completo do fundo/ativo
2. Tipo (FII, Fundo de Investimento, ETF, CDB, etc.)
3. Indexador principal se for pós-fixado (CDI, IPCA, IGP-M, Selic, Prefixado, ou N/A)
4. Breve descrição (1 frase)
5. Gestora/Administradora (se conhecida)

Responda APENAS em JSON no formato:
{"name":"","type":"","indexador":"CDI|IPCA|IGP-M|Selic|Prefixado|N/A","description":"","gestora":""}`;

    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!resp.ok) throw new Error('Gemini API: ' + resp.status);
    const raw = await resp.json();
    const text = raw.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);

    // Preencher campos do formulário
    if (data.name) {
      const nameEl = document.getElementById('invTxName');
      if (nameEl && !nameEl.value) nameEl.value = data.name;
    }

    // Mostrar resultado
    if (result) {
      result.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <div><strong>${esc(data.name || ticker)}</strong></div>
          ${data.type        ? `<div style="color:var(--muted)">📋 ${esc(data.type)}</div>` : ''}
          ${data.gestora     ? `<div style="color:var(--muted)">🏦 ${esc(data.gestora)}</div>` : ''}
          ${data.description ? `<div style="color:var(--muted);font-style:italic">${esc(data.description)}</div>` : ''}
        </div>`;
    }

    // Pré-selecionar indexador
    if (data.indexador && data.indexador !== 'N/A') {
      if (indexPanel) indexPanel.style.display = '';
      const sel = document.getElementById('invFundoIndexadorSel');
      if (sel) {
        const match = Array.from(sel.options).find(o => o.value === data.indexador);
        if (match) sel.value = data.indexador;
      }
    }

  } catch(e) {
    if (result) result.textContent = '⚠️ ' + (e.message || 'Erro ao consultar IA');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Identificar Fundo'; }
  }
}
window._invEnrichFundoAI = _invEnrichFundoAI;

// Helper para buscar chave Gemini
async function _invGetGeminiKey() {
  if (typeof _appSettingsCache !== 'undefined' && _appSettingsCache?.gemini_key) {
    return _appSettingsCache.gemini_key;
  }
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key','gemini_key').maybeSingle();
    return data?.value || null;
  } catch(_) { return null; }
}

function _invSetTxType(type) {
  document.getElementById('invTxType').value = type;
  document.getElementById('invTxBuyTab').classList.toggle('active', type === 'buy');
  document.getElementById('invTxSellTab').classList.toggle('active', type === 'sell');
  const btn = document.getElementById('invTxSaveBtn');
  if (btn) btn.textContent = type === 'buy' ? '💾 Registrar Compra' : '💾 Registrar Venda';
  _invCalcTotal();
}

function _invOnAccountChange() {
  _invCalcTotal();
}

function _invCalcTotal() {
  const qty   = parseFloat(document.getElementById('invTxQty')?.value?.replace(',','.')) || 0;
  const price = _invReadPrice(document.getElementById('invTxPrice'));
  const total = qty * price;
  const el    = document.getElementById('invTxTotal');
  if (el) el.textContent = fmt(total);

  // Cash warning for buys
  const type  = document.getElementById('invTxType')?.value;
  const accId = document.getElementById('invTxAccount')?.value;
  const warn  = document.getElementById('invTxCashWarning');
  if (warn && type === 'buy' && accId) {
    const acc   = _invAccounts().find(a => a.id === accId);
    const cash  = acc ? (+(acc.balance) || 0) : 0;
    warn.style.display = (total > 0 && cash < total) ? '' : 'none';
  }
}

async function saveInvTransaction() {
  const btn     = document.getElementById('invTxSaveBtn');
  const errEl   = document.getElementById('invTxError');
  const type    = document.getElementById('invTxType').value;
  const accId   = document.getElementById('invTxAccount').value;
  const date    = document.getElementById('invTxDate').value;
  const ticker  = document.getElementById('invTxTicker').value.trim().toUpperCase();
  const assetT  = document.getElementById('invTxAssetType').value;
  const name    = document.getElementById('invTxName').value.trim();
  const qtyRaw  = parseFloat(document.getElementById('invTxQty').value.replace(',','.'));
  const priceRaw= _invReadPrice(document.getElementById('invTxPrice'));
  const notesRaw  = document.getElementById('invTxNotes').value.trim();
  const brokerSel = document.getElementById('invTxBroker')?.value || '';
  const brokerOth = document.getElementById('invTxBrokerOther')?.value?.trim() || '';
  const broker    = brokerSel === 'Outro' ? brokerOth : brokerSel;
  const indexador = document.getElementById('invFundoIndexadorSel')?.value || '';
  const notes     = [notesRaw, broker ? `Corretora: ${broker}` : '', indexador ? `Indexador: ${indexador}` : '']
    .filter(Boolean).join(' · ') || '';
  const posId   = document.getElementById('invTxPositionId').value;

  if (errEl) errEl.style.display = 'none';

  if (!accId)          { _invShowErr('Selecione a conta'); return; }
  if (!date)           { _invShowErr('Informe a data'); return; }
  if (!ticker)         { _invShowErr('Informe o código do ativo'); return; }
  if (!qtyRaw || qtyRaw <= 0)   { _invShowErr('Informe a quantidade'); return; }
  if (!priceRaw|| priceRaw <= 0){ _invShowErr('Informe o preço unitário'); return; }

  const total = qtyRaw * priceRaw;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    // 1. Upsert position
    let position = posId
      ? _inv.positions.find(p => p.id === posId)
      : _inv.positions.find(p => p.account_id === accId && p.ticker === ticker);

    if (!position) {
      // New position
      const { data: newPos, error: posErr } = await sb.from('investment_positions').insert({
        family_id:   famId(),
        account_id:  accId,
        ticker,
        asset_type:  assetT,
        name:        name || ticker,
        quantity:    0,
        avg_cost:    0,
        currency:    ['acao_us','etf_us'].includes(assetT) ? 'USD' : 'BRL',
      }).select().single();
      if (posErr) throw posErr;
      position = newPos;
      _inv.positions.push(position);
    }

    // 2. Update avg_cost and quantity
    const oldQty   = +(position.quantity) || 0;
    const oldCost  = +(position.avg_cost)  || 0;
    let   newQty, newAvgCost;

    if (type === 'buy') {
      newQty     = oldQty + qtyRaw;
      // Weighted average cost
      newAvgCost = newQty > 0
        ? (oldQty * oldCost + qtyRaw * priceRaw) / newQty
        : priceRaw;
    } else {
      // Sell — reduce qty, avg_cost unchanged (FIFO/average cost same result)
      if (qtyRaw > oldQty + 0.00001) { _invShowErr(`Quantidade insuficiente (disponível: ${oldQty})`); return; }
      newQty     = Math.max(0, oldQty - qtyRaw);
      newAvgCost = oldCost; // avg_cost stays the same on sells
    }

    const posUpdatePayload = {
      quantity:   newQty,
      avg_cost:   newAvgCost,
      name:       name || position.name || ticker,
      asset_type: assetT || position.asset_type,
      updated_at: localISOTimestamp(),
    };
    // Persistir corretora nas notas da posição (sem sobrescrever se já existir)
    if (broker && !position.notes?.includes(broker)) {
      posUpdatePayload.notes = [position.notes, `Corretora: ${broker}`].filter(Boolean).join(' · ');
    }
    const { error: updErr } = await sb.from('investment_positions').update(posUpdatePayload).eq('id', position.id);
    if (updErr) throw updErr;

    // 3. Create financial transaction (debit for buy, credit for sell)
    const txAmount = type === 'buy' ? -total : total;
    const txDesc   = `${type === 'buy' ? 'Compra' : 'Venda'}: ${ticker} ${qtyRaw}x @ ${fmt(priceRaw)}`;
    const { data: txData, error: txErr } = await sb.from('transactions').insert({
      family_id:   famId(),
      account_id:  accId,
      date,
      description: txDesc,
      amount:      txAmount,
      category_id: null,
      memo:        notes || null,
      status:      'confirmed',
      is_transfer: false,
    }).select().single();
    if (txErr) throw txErr;

    // 4. Record investment transaction
    await sb.from('investment_transactions').insert({
      family_id:   famId(),
      position_id: position.id,
      account_id:  accId,
      tx_id:       txData.id,
      type,
      quantity:    qtyRaw,
      unit_price:  priceRaw,
      total_brl:   total,
      date,
      notes:       notes || null,
    });

    // 5. Record price in history
    const today = todayISO();
    await sb.from('investment_price_history').upsert({
      position_id: position.id,
      family_id:   famId(),
      date:        date || today,
      price:       priceRaw,
      currency:    position.currency || 'BRL',
      source:      'manual',
    }, { onConflict: 'position_id,date' });

    toast(`✅ ${type === 'buy' ? 'Compra' : 'Venda'} de ${ticker} registrada!`, 'success');
    closeModal('invTxModal');

    // Reload
    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    if (state.currentPage === 'accounts') renderAccounts?.();
    if (state.currentPage === 'dashboard') loadDashboard?.();

  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar');
    if (btn) { btn.disabled = false; btn.textContent = type === 'buy' ? '💾 Registrar Compra' : '💾 Registrar Venda'; }
  }
}

function _invShowErr(msg) {
  const errEl = document.getElementById('invTxError');
  if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
}

// ── Position detail (history) ───────────────────────────────────────────────

async function openInvPositionDetail(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;

  const txs = _inv.transactions.filter(t => t.position_id === positionId);
  const { data: history } = await sb.from('investment_price_history')
    .select('*').eq('position_id', positionId)
    .order('date', { ascending: false }).limit(90);

  document.getElementById('invDetailModal')?.remove();

  const t = _invAssetType(pos.asset_type);
  const mv   = _invMarketValue(pos);
  const cost = _invCost(pos);
  const pnl  = mv - cost;
  const ret  = cost ? pnl / cost * 100 : 0;

  const txRows = txs.map(tx => `
    <tr>
      <td style="padding:6px 8px">${fmtDate(tx.date)}</td>
      <td style="padding:6px 8px;text-align:center"><span class="badge" style="background:${tx.type==='buy'?'#dcfce7':'#fee2e2'};color:${tx.type==='buy'?'#15803d':'#b91c1c'}">${tx.type==='buy'?'Compra':'Venda'}</span></td>
      <td style="padding:6px 8px;text-align:right">${(+(tx.quantity)).toFixed(4)}</td>
      <td style="padding:6px 8px;text-align:right">${fmt(tx.unit_price)}</td>
      <td style="padding:6px 8px;text-align:right" class="${tx.type==='buy'?'amount-neg':'amount-pos'}">${tx.type==='buy'?'-':'+'}${fmt(tx.total_brl)}</td>
      <td style="padding:6px 4px;text-align:center;white-space:nowrap">
        <button onclick="openEditInvTransaction('${tx.id}')"
          title="Editar movimentacao"
          style="background:none;border:none;cursor:pointer;font-size:.85rem;color:var(--muted);padding:2px 5px;border-radius:6px;transition:all .15s"
          onmouseover="this.style.color='var(--accent)';this.style.background='var(--accent-lt)'"
          onmouseout="this.style.color='var(--muted)';this.style.background='none'">✏️</button>
        <button onclick="deleteInvTransaction('${tx.id}','${pos.id}')"
          title="Excluir movimentacao"
          style="background:none;border:none;cursor:pointer;font-size:.85rem;color:var(--muted);padding:2px 5px;border-radius:6px;transition:all .15s"
          onmouseover="this.style.color='var(--danger,#dc2626)';this.style.background='rgba(220,38,38,.08)'"
          onmouseout="this.style.color='var(--muted)';this.style.background='none'">🗑️</button>
      </td>
    </tr>`).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'invDetailModal';
  modal.style.zIndex = '10010';
  modal.innerHTML = `
  <div class="modal" style="max-width:560px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title">${t.emoji} ${esc(pos.ticker)} — ${esc(pos.name || pos.ticker)}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="deleteInvPosition('${positionId}')"
          style="font-family:var(--font-sans);font-size:.72rem;font-weight:700;color:var(--danger,#dc2626);background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:6px 12px;cursor:pointer;transition:all .2s"
          onmouseover="this.style.background='rgba(220,38,38,.15)'" onmouseout="this.style.background='rgba(220,38,38,.08)'">
          🗑️ Excluir
        </button>
        <button class="modal-close" onclick="closeModal('invDetailModal')">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <!-- KPIs -->
      <div class="inv-summary-cards" style="margin-bottom:16px">
        <div class="inv-kpi-card"><div class="inv-kpi-label">Posição</div>
          <div class="inv-kpi-value">${(+(pos.quantity)).toFixed(4)} ${esc(pos.ticker)}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Custo Médio</div>
          <div class="inv-kpi-value">${fmt(+(pos.avg_cost))}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Cotação Atual</div>
          <div class="inv-kpi-value">${_invBrlPrice(pos) ? fmt(_invBrlPrice(pos)) : '—'}</div></div>
        <div class="inv-kpi-card"><div class="inv-kpi-label">Resultado</div>
          <div class="inv-kpi-value ${pnl>=0?'amount-pos':'amount-neg'}">
            ${pnl>=0?'+':''}${fmt(pnl)} (${ret.toFixed(2)}%)</div></div>
      </div>

      <!-- Manual price update for renda_fixa / outro -->
      ${['renda_fixa','outro'].includes(pos.asset_type) ? `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;
        padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm)">
        <span style="font-size:.82rem;font-weight:600;flex:1">Atualizar cotação manualmente:</span>
        <input type="text" id="invManualPrice" value="${pos.current_price || ''}"
          style="width:120px;padding:6px 10px" inputmode="decimal" placeholder="0,00">
        <button class="btn btn-primary btn-sm" onclick="updateManualPrice('${pos.id}')">Salvar</button>
      </div>` : ''}

      <!-- Gain/Loss Chart -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:.82rem;font-weight:700">Evolução do Investimento</div>
        <span id="invChartNoData" style="display:none;font-size:.73rem;color:var(--muted)">Sem histórico de preços</span>
      </div>
      <div style="position:relative;height:150px;margin-bottom:16px;background:var(--surface2);border-radius:var(--r-sm);overflow:hidden">
        <canvas id="invGainLossChart" style="width:100%;height:100%"></canvas>
      </div>
      <!-- Transaction history -->
      <div style="font-size:.82rem;font-weight:700;margin-bottom:8px">Histórico de Movimentações</div>
      ${txRows ? `<table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface2)">
          <th style="padding:6px 8px;text-align:left">Data</th>
          <th>Tipo</th><th>Qtd</th><th>Preço</th><th>Total</th><th></th>
        </tr></thead>
        <tbody>${txRows}</tbody>
      </table>` : '<div style="color:var(--muted);font-size:.82rem">Nenhuma movimentação registrada.</div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invDetailModal')">Fechar</button>
      <button class="btn btn-primary" onclick="closeModal('invDetailModal');openInvTransactionModal(null,'${pos.id}')">
        + Nova Movimentação
      </button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function updateManualPrice(positionId) {
  const val = parseFloat(document.getElementById('invManualPrice')?.value?.replace(',','.'));
  if (!val || val <= 0) { toast('Preço inválido', 'error'); return; }
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;
  const today = todayISO();
  await _invSavePrice(pos, val, 'BRL', today, 'manual');
  await loadInvestments(true);
  _invAugmentAccountBalances();
  closeModal('invDetailModal');
  _renderInvestmentsPage();
  toast('Cotação atualizada', 'success');
}

// ── Module activation ───────────────────────────────────────────────────────

async function applyInvestmentsFeature() {
  const famId_ = famId();
  const navEl   = document.getElementById('investmentsNav');
  const pageEl  = document.getElementById('page-investments');

  if (!famId_) {
    if (navEl) navEl.style.display = 'none';
    if (pageEl) pageEl.style.display = 'none';
    if (typeof _syncModulesSection === 'function') _syncModulesSection();
    return;
  }

  let enabled = false;
  const cacheKey = 'investments_enabled_' + famId_;
  if (window._familyFeaturesCache && cacheKey in window._familyFeaturesCache) {
    enabled = !!window._familyFeaturesCache[cacheKey];
  } else {
    const raw = await getAppSetting(cacheKey, false);
    enabled = raw === true || raw === 'true';
    window._familyFeaturesCache = window._familyFeaturesCache || {};
    window._familyFeaturesCache[cacheKey] = enabled;
  }

  if (navEl) {
    navEl.style.display = enabled ? '' : 'none';
    navEl.dataset.featureControlled = '1';
  }
  if (pageEl) pageEl.style.display = enabled ? '' : 'none';
  if (typeof _syncModulesSection === 'function') _syncModulesSection();

  if (enabled) {
    await loadInvestments();
    _invAugmentAccountBalances();
  }
}

// Called from accounts.js after recalculating balances
function invPostBalanceHook() {
  if (_inv.loaded) _invAugmentAccountBalances();
}



// ── Portfolio performance chart (page-level) ────────────────────────────────
async function renderInvPerformanceChart() {
  const cvId = 'invPortfolioChart';
  const cv = document.getElementById(cvId);
  if (!cv) return;

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) { cv.style.display = 'none'; return; }

  // Collect all price history for current positions
  let allHistory = [];
  try {
    const posIds = positions.map(p => p.id);
    // Fetch up to 90 days of price history across all positions
    const { data: hist } = await famQ(
      sb.from('investment_price_history')
        .select('position_id,date,price,currency')
    ).in('position_id', posIds)
      .order('date', { ascending: true })
      .limit(5000);
    allHistory = hist || [];
  } catch(e) {
    console.warn('[inv] perf chart history:', e.message);
    cv.style.display = 'none'; return;
  }

  if (!allHistory.length) { cv.style.display = 'none'; return; }

  // Group by date — compute total portfolio market value at each date
  const dateMap = {};
  allHistory.forEach(h => {
    const pos = positions.find(p => p.id === h.position_id);
    if (!pos) return;
    const qty = +(pos.quantity) || 0;
    const price = +(h.price) || 0;
    const mv = qty * price;
    if (!dateMap[h.date]) dateMap[h.date] = 0;
    dateMap[h.date] += mv;
  });

  const sortedDates = Object.keys(dateMap).sort();
  if (sortedDates.length < 2) { cv.style.display = 'none'; return; }

  const labels = sortedDates.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(dt).replace('.','');
  });
  const values = sortedDates.map(d => +dateMap[d].toFixed(2));

  const totalCost = positions.reduce((s, p) => s + _invCost(p), 0);
  const first = values[0];
  const last  = values[values.length - 1];
  const isPos = last >= totalCost;

  const G = '#22c55e', R = '#ef4444';
  const lineColor = isPos ? G : R;
  const fillColor = isPos ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)';

  // Destroy existing
  if (cv._chart) { try { cv._chart.destroy(); } catch(_) {} }

  const fmt_ = v => 'R$ ' + (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  cv.style.display = '';
  cv._chart = new Chart(cv.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Valor de Mercado',
          data: values,
          borderColor: lineColor,
          backgroundColor: fillColor,
          borderWidth: 2.5,
          pointRadius: values.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          fill: 'origin',
          tension: 0.35,
        },
        {
          label: 'Custo Total',
          data: sortedDates.map(() => +totalCost.toFixed(2)),
          borderColor: 'rgba(100,116,139,.5)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [6, 3],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt_(ctx.parsed.y)}`,
            afterBody: items => {
              const mv = items[0]?.parsed.y;
              if (mv == null) return;
              const diff = mv - totalCost;
              const pct  = totalCost ? (diff / totalCost * 100).toFixed(2) : '—';
              const sign = diff >= 0 ? '+' : '';
              return [``, ` P&L: ${sign}${fmt_(diff)} (${sign}${pct}%)`];
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: {
            font: { size: 10 },
            callback: v => 'R$ ' + (+v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }),
          },
          grid: { color: 'rgba(0,0,0,.04)' },
        },
      },
    },
  });
}

// ── Allocation donut chart ───────────────────────────────────────────────────
function renderInvAllocationChart() {
  const cvId = 'invAllocationChart';
  const cv = document.getElementById(cvId);
  if (!cv) return;

  const positions = _inv.positions.filter(p => +(p.quantity) > 0);
  if (!positions.length) { cv.style.display = 'none'; return; }

  const COLORS = {
    acao_br: '#2a6049', fii: '#7c3aed', etf_br: '#0891b2',
    acao_us: '#dc2626', etf_us: '#ea580c', bdr: '#d97706',
    crypto: '#f59e0b', renda_fixa: '#16a34a', outro: '#94a3b8',
  };

  // Group by asset type
  const byType = {};
  const totalMV = positions.reduce((s, p) => s + _invMarketValue(p), 0);
  positions.forEach(p => {
    const k = p.asset_type || 'outro';
    byType[k] = (byType[k] || 0) + _invMarketValue(p);
  });

  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(([k]) => _invAssetType(k).label);
  const data   = entries.map(([, v]) => +v.toFixed(2));
  const colors = entries.map(([k]) => COLORS[k] || '#94a3b8');

  if (cv._chart) { try { cv._chart.destroy(); } catch(_) {} }
  cv.style.display = '';

  const fmtShort = v => 'R$ ' + (+v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

  cv._chart = new Chart(cv.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: 'var(--surface, #fff)',
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 11 },
            padding: 10,
            boxWidth: 12,
            generateLabels: chart => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: `${label} ${(data[i] / totalMV * 100).toFixed(1)}%`,
                fillStyle: ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${fmtShort(ctx.parsed)} (${(ctx.parsed / totalMV * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

function _renderInvGainLossChart(pos, history) {
  const cv=document.getElementById('invGainLossChart');
  const nd=document.getElementById('invChartNoData');
  if(!cv) return;
  const hist=[...history].sort((a,b)=>a.date.localeCompare(b.date));
  if(!hist.length){if(nd)nd.style.display='';cv.style.display='none';return;}
  if(nd)nd.style.display='none'; cv.style.display='';
  if(cv._ci){try{cv._ci.destroy();}catch(_){}}
  const cost=_invCost(pos), qty=+(pos.quantity)||0, cur=pos.currency||'BRL';
  const fC=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:cur,notation:'compact'}).format(v);
  const fF=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:cur}).format(v);
  const labels=hist.map(h=>{const d=new Date(h.date+'T12:00:00');return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(d).replace('.','');});
  const mvData=hist.map(h=>+(h.price)*qty);
  const pnlData=mvData.map(mv=>mv-cost);
  const lp=pnlData[pnlData.length-1]??0;
  const G='rgba(22,163,74,.85)',R='rgba(192,57,43,.85)',GL='rgba(22,163,74,.15)',RL='rgba(192,57,43,.12)';
  cv._ci=new Chart(cv.getContext('2d'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Valor Mercado',data:mvData,borderColor:G,backgroundColor:'transparent',borderWidth:2,pointRadius:hist.length>40?0:2,fill:false,tension:.35,order:1},
      {label:'Custo',data:hist.map(()=>cost),borderColor:'rgba(100,116,139,.6)',backgroundColor:'transparent',borderWidth:1.5,borderDash:[5,3],pointRadius:0,fill:false,order:2},
      {label:'Ganho/Perda',data:pnlData,borderColor:lp>=0?G:R,backgroundColor:lp>=0?GL:RL,borderWidth:1.5,pointRadius:0,fill:'origin',tension:.35,order:3},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:10,padding:8}},
        tooltip:{callbacks:{label:c=>{const v=c.parsed.y;return ` ${c.dataset.label}: ${v>=0?'+':''}${fF(v)}`;}}}
      },
      scales:{
        x:{ticks:{font:{size:9},maxTicksLimit:8},grid:{display:false}},
        y:{ticks:{font:{size:9},callback:fC},grid:{color:'rgba(0,0,0,.05)'}}
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXCLUIR POSIÇÃO DE INVESTIMENTO
// ══════════════════════════════════════════════════════════════════════════════
// ── Excluir transação de investimento ──────────────────────────────────────
async function deleteInvTransaction(txId, positionId) {
  if (!confirm('Excluir esta movimentação? O saldo e o custo médio da posição serão recalculados.')) return;

  try {
    // Buscar a transação de investimento
    const invTx = _inv.transactions.find(t => t.id === txId);
    if (!invTx) throw new Error('Movimentação não encontrada em cache.');

    const pos = _inv.positions.find(p => p.id === positionId);
    if (!pos) throw new Error('Posição não encontrada.');

    // Recalcular qty e avg_cost sem esta transação
    const remaining = _inv.transactions.filter(t =>
      t.position_id === positionId && t.id !== txId
    );

    let recalcQty = 0;
    let recalcCost = 0;
    let totalCostValue = 0;

    // Replay das transações restantes em ordem cronológica
    remaining
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .forEach(t => {
        if (t.type === 'buy') {
          const newQty = recalcQty + t.quantity;
          recalcCost = newQty > 0
            ? (recalcQty * recalcCost + t.quantity * t.unit_price) / newQty
            : t.unit_price;
          recalcQty = newQty;
        } else {
          recalcQty = Math.max(0, recalcQty - t.quantity);
          // avg_cost unchanged on sells
        }
      });

    // Excluir investment_transaction
    const { error: invTxErr } = await sb.from('investment_transactions').delete().eq('id', txId);
    if (invTxErr) throw invTxErr;

    // Excluir transactions financeira vinculada (se existir)
    if (invTx.tx_id) {
      try { await sb.from('transactions').delete().eq('id', invTx.tx_id); } catch(_) {}
    }

    // Atualizar position
    const { error: posErr } = await sb.from('investment_positions').update({
      quantity:   recalcQty,
      avg_cost:   recalcCost,
      updated_at: localISOTimestamp(),
    }).eq('id', positionId);
    if (posErr) throw posErr;

    toast('✓ Movimentação excluída e posição recalculada', 'success');

    // Recarregar e re-renderizar
    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();

    // Reabrir detail modal se estava aberto
    closeModal('invDetailModal');
    setTimeout(() => openInvPositionDetail(positionId), 300);

  } catch(e) {
    toast('Erro ao excluir: ' + (e.message || e), 'error');
  }
}
// ── Atualizar saldo total do ativo ──────────────────────────────────────────
// O usuario informa o saldo financeiro atual (R$) da posicao.
// O app calcula o preco unitario implicito = saldoInformado / quantity
// e registra como novo current_price no historico.
function openInvBalanceModal(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;
  const t      = _invAssetType(pos.asset_type);
  const mv     = _invMarketValue(pos);
  const cost   = _invCost(pos);
  const qty    = +(pos.quantity) || 0;
  const curPnl = mv - cost;

  document.getElementById('invBalanceModal')?.remove();
  const d = document.createElement('div');
  d.className = 'modal-overlay open';
  d.id = 'invBalanceModal';
  d.style.zIndex = '10015';
  d.innerHTML = `
  <div class="modal" style="max-width:420px"><div class="modal-handle"></div>
    <div class="modal-header">
      <span class="modal-title">${t.emoji} Atualizar Saldo — ${esc(pos.ticker)}</span>
      <button class="modal-close" onclick="closeModal('invBalanceModal')">✕</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--surface2);border-radius:var(--r-sm);padding:12px 14px;margin-bottom:16px;font-size:.83rem;line-height:1.7">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Posição atual:</span> <strong>${qty.toLocaleString('pt-BR',{maximumFractionDigits:6})} ${esc(pos.ticker)}</strong></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Custo total:</span> <strong>${fmt(cost)}</strong></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Valor de mercado atual:</span> <strong>${mv ? fmt(mv) : '—'}</strong></div>
      </div>
      <div class="form-group">
        <label style="font-weight:700">Saldo atual da posição (R$) *</label>
        <input type="text" id="invBalanceInput" inputmode="decimal" placeholder="0,00"
          style="font-size:1.1rem;font-weight:700;text-align:right"
          oninput="_invFmtBalanceInput(this)" onblur="_invFmtPriceBlur(this)">
        <div style="font-size:.75rem;color:var(--muted);margin-top:4px">
          Informe o valor financeiro total atual desta posição.
        </div>
      </div>
      <div id="invBalancePreview" style="display:none;margin-top:12px;padding:12px 14px;border-radius:var(--r-sm);border:1px solid var(--border);font-size:.83rem;line-height:1.8"></div>
      <div id="invBalanceErr" style="display:none;color:var(--danger,#dc2626);font-size:.8rem;margin-top:8px;padding:8px 12px;background:#fff5f5;border:1px solid #fca5a5;border-radius:var(--r-sm)"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('invBalanceModal')">Cancelar</button>
      <button class="btn btn-primary" id="invBalanceSaveBtn" onclick="saveInvBalance('${positionId}')">
        💾 Consolidar Saldo
      </button>
    </div>
  </div>`;
  document.body.appendChild(d);
  setTimeout(() => document.getElementById('invBalanceInput')?.focus(), 80);
}
window.openInvBalanceModal = openInvBalanceModal;

function _invFmtBalanceInput(el) {
  const raw = el.value.replace(/\D/g, '');
  if (!raw) { el.value = ''; _invUpdateBalancePreview(); return; }
  el.value = (parseInt(raw, 10) / 100).toFixed(2).replace('.', ',');
  _invUpdateBalancePreview();
}
window._invFmtBalanceInput = _invFmtBalanceInput;

function _invUpdateBalancePreview() {
  const preview = document.getElementById('invBalancePreview');
  if (!preview) return;
  const rawVal = document.getElementById('invBalanceInput')?.value || '';
  const newBalance = parseFloat(rawVal.replace(/\./g,'').replace(',','.')) || 0;
  // Find the position via the save button's onclick attribute
  const btn = document.getElementById('invBalanceSaveBtn');
  if (!btn) return;
  const posId = btn.getAttribute('onclick').match(/'([^']+)'/)?.[1];
  const pos = posId ? _inv.positions.find(p => p.id === posId) : null;
  if (!pos || newBalance <= 0) { preview.style.display = 'none'; return; }
  const qty    = +(pos.quantity) || 0;
  const cost   = _invCost(pos);
  const pnl    = newBalance - cost;
  const pct    = cost ? (pnl / cost * 100) : 0;
  const newPrice = qty > 0 ? newBalance / qty : 0;
  const pnlColor = pnl >= 0 ? 'var(--green,#16a34a)' : 'var(--danger,#dc2626)';
  preview.style.display = '';
  preview.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px;font-size:.85rem">Resumo da consolidação:</div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Novo preço unitário calculado:</span><strong>${fmt(newPrice)}</strong></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Ganho / Perda:</span>
      <strong style="color:${pnlColor}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} (${pct.toFixed(2)}%)</strong></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Novo valor de mercado:</span><strong>${fmt(newBalance)}</strong></div>
  `;
}

async function saveInvBalance(positionId) {
  const btn    = document.getElementById('invBalanceSaveBtn');
  const errEl  = document.getElementById('invBalanceErr');
  const rawVal = document.getElementById('invBalanceInput')?.value || '';
  const newBalance = parseFloat(rawVal.replace(/\./g,'').replace(',','.')) || 0;

  if (errEl) errEl.style.display = 'none';
  if (!newBalance || newBalance <= 0) {
    if (errEl) { errEl.textContent = 'Informe um saldo valido maior que zero.'; errEl.style.display = ''; }
    return;
  }

  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) return;
  const qty = +(pos.quantity) || 0;
  if (qty <= 0) {
    if (errEl) { errEl.textContent = 'Esta posicao tem quantidade zero — registre uma compra primeiro.'; errEl.style.display = ''; }
    return;
  }

  const newPrice = newBalance / qty;
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const today = todayISO();
    await _invSavePrice(pos, newPrice, pos.currency || 'BRL', today, 'manual');
    toast(`Saldo de ${esc(pos.ticker)} consolidado: ${fmt(newBalance)}`, 'success');
    closeModal('invBalanceModal');
    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    if (state.currentPage === 'dashboard') loadDashboard?.();
  } catch(e) {
    if (errEl) { errEl.textContent = e.message || 'Erro ao salvar'; errEl.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = 'Consolidar Saldo'; }
  }
}
window.saveInvBalance = saveInvBalance;

// ── Editar transacao de investimento ───────────────────────────────────────
// Abre o mesmo modal de nova transacao pre-preenchido com os dados existentes.
// Ao salvar: reverte o efeito da transacao original na posicao (replay sem ela)
// e aplica a nova versao — mantendo avg_cost e qty corretos.
async function openEditInvTransaction(txId) {
  const invTx = _inv.transactions.find(t => t.id === txId);
  if (!invTx) { toast('Movimentação não encontrada', 'error'); return; }
  const pos = _inv.positions.find(p => p.id === invTx.position_id);
  if (!pos) { toast('Posição não encontrada', 'error'); return; }

  let linkedTxNotes = '';
  if (invTx.tx_id) {
    const { data: linked } = await sb.from('transactions').select('memo').eq('id', invTx.tx_id).maybeSingle();
    linkedTxNotes = linked?.memo || '';
  }

  closeModal('invDetailModal');
  openInvTransactionModal(invTx.account_id, pos.id);

  await new Promise(r => setTimeout(r, 80));

  const modal = document.getElementById('invTxModal');
  if (!modal) return;

  // Titulo
  const titleEl = modal.querySelector('#invTxModalTitle');
  if (titleEl) titleEl.textContent = 'Editar Movimentação';

  // Garantir modo Compra/Venda
  _invSetModalMode('buysell');
  // Esconder tabs de modo (nao faz sentido trocar de modo na edicao)
  const modeTabs = modal.querySelector('.tab-bar');
  if (modeTabs) modeTabs.style.display = 'none';

  _invSetTxType(invTx.type);

  const dateEl = document.getElementById('invTxDate');
  if (dateEl) dateEl.value = invTx.date || '';

  const tickerEl = document.getElementById('invTxTicker');
  if (tickerEl) { tickerEl.value = pos.ticker; tickerEl.readOnly = true; tickerEl.style.opacity = '.6'; }

  const nameEl = document.getElementById('invTxName');
  if (nameEl) nameEl.value = pos.name || pos.ticker;

  const assetEl = document.getElementById('invTxAssetType');
  if (assetEl) { assetEl.value = pos.asset_type || 'outro'; _invToggleFundoPanel(assetEl.value); }

  const qtyEl = document.getElementById('invTxQty');
  if (qtyEl) qtyEl.value = (+(invTx.quantity)).toLocaleString('pt-BR', { maximumFractionDigits: 6 });

  const priceEl = document.getElementById('invTxPrice');
  if (priceEl) {
    const pv = +(invTx.unit_price) || 0;
    priceEl.value = pv.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const notesEl = document.getElementById('invTxNotes');
  if (notesEl) notesEl.value = invTx.notes || linkedTxNotes || '';

  // Substituir o botao salvar por versao sem onclick no HTML (evita double-fire)
  const oldBtn = document.getElementById('invTxSaveBtn');
  if (oldBtn) {
    const newBtn = oldBtn.cloneNode(true);
    newBtn.textContent = '💾 Salvar Edição';
    newBtn.removeAttribute('onclick');
    newBtn.addEventListener('click', () => saveEditInvTransaction(txId, pos.id));
    oldBtn.replaceWith(newBtn);
  }

  _invCalcTotal();
}
window.openEditInvTransaction = openEditInvTransaction;

// ── Salvar aporte em modo Valor Total (simplificado) ──────────────────────
// Registra o valor aportado como 1 unidade a preco = valor total.
// Isso preserva a logica de avg_cost/qty sem exigir qtd do usuario.
async function saveInvSimple() {
  const btn    = document.getElementById('invTxSaveBtn');
  const errEl  = document.getElementById('invTxError');
  const accId  = document.getElementById('invTxAccount')?.value;
  const date   = document.getElementById('invTxDate')?.value;
  const ticker = document.getElementById('invTxTicker')?.value?.trim()?.toUpperCase();
  const assetT = document.getElementById('invTxAssetType')?.value;
  const name   = document.getElementById('invTxName')?.value?.trim();
  const rawVal = document.getElementById('invSimpleTotal')?.value || '';
  const total  = parseFloat(rawVal.replace(/\./g,'').replace(',','.')) || 0;
  const notes  = document.getElementById('invSimpleNotes')?.value?.trim() || '';

  if (errEl) errEl.style.display = 'none';
  if (!accId)   { _invShowErr('Selecione a conta'); return; }
  if (!date)    { _invShowErr('Informe a data'); return; }
  if (!ticker)  { _invShowErr('Informe o código do ativo'); return; }
  if (total <= 0) { _invShowErr('Informe o valor total aportado'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    const posId = document.getElementById('invTxPositionId')?.value;
    let position = posId
      ? _inv.positions.find(p => p.id === posId)
      : _inv.positions.find(p => p.account_id === accId && p.ticker === ticker);

    if (!position) {
      const { data: newPos, error: posErr } = await sb.from('investment_positions').insert({
        family_id:  famId(), account_id: accId, ticker,
        asset_type: assetT, name: name || ticker,
        quantity: 0, avg_cost: 0, currency: 'BRL',
      }).select().single();
      if (posErr) throw posErr;
      position = newPos;
      _inv.positions.push(position);
    }

    // Registrar como 1 unidade ao preco = total (avg_cost acumula corretamente)
    const oldQty  = +(position.quantity) || 0;
    const oldCost = +(position.avg_cost)  || 0;
    const newQty  = oldQty + 1;
    const newAvgCost = (oldQty * oldCost + total) / newQty;

    const { error: updErr } = await sb.from('investment_positions').update({
      quantity: newQty, avg_cost: newAvgCost,
      name: name || position.name || ticker,
      asset_type: assetT || position.asset_type,
      updated_at: localISOTimestamp(),
    }).eq('id', position.id);
    if (updErr) throw updErr;

    // Transacao financeira
    const txDesc = `Aporte: ${ticker} — ${fmt(total)}`;
    const { data: txData, error: txErr } = await sb.from('transactions').insert({
      family_id: famId(), account_id: accId, date,
      description: txDesc, amount: -total,
      memo: notes || null, status: 'confirmed', is_transfer: false,
    }).select().single();
    if (txErr) throw txErr;

    // investment_transaction com qty=1, unit_price=total
    await sb.from('investment_transactions').insert({
      family_id: famId(), position_id: position.id, account_id: accId,
      tx_id: txData.id, type: 'buy',
      quantity: 1, unit_price: total, total_brl: total,
      date, notes: (notes ? notes + ' · ' : '') + '[aporte simplificado]',
    });

    await _invSavePrice(position, total, 'BRL', date, 'manual');

    toast(`✅ Aporte de ${fmt(total)} em ${ticker} registrado!`, 'success');
    closeModal('invTxModal');
    await loadInvestments(true);
    DB.accounts.bust(); await DB.accounts.load(true);
    _invAugmentAccountBalances(); _renderInvestmentsPage();
    if (state.currentPage === 'dashboard') loadDashboard?.();
  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Registrar Aporte'; }
  }
}
window.saveInvSimple = saveInvSimple;

// ── Salvar taxa ou imposto sobre investimento ──────────────────────────────
async function saveInvTax() {
  const btn    = document.getElementById('invTxSaveBtn');
  const errEl  = document.getElementById('invTxError');
  const accId  = document.getElementById('invTxAccount')?.value;
  const date   = document.getElementById('invTxDate')?.value;
  const ticker = document.getElementById('invTxTicker')?.value?.trim()?.toUpperCase();
  const taxType = document.getElementById('invTaxType')?.value;
  const rawVal  = document.getElementById('invTaxAmount')?.value || '';
  const amount  = parseFloat(rawVal.replace(/\./g,'').replace(',','.')) || 0;
  const notes   = document.getElementById('invTaxNotes')?.value?.trim() || '';

  if (errEl) errEl.style.display = 'none';
  if (!accId)   { _invShowErr('Selecione a conta'); return; }
  if (!date)    { _invShowErr('Informe a data'); return; }
  if (!ticker)  { _invShowErr('Informe o código do ativo'); return; }
  if (amount <= 0) { _invShowErr('Informe o valor da taxa/imposto'); return; }

  const TAX_LABELS = {
    taxa_adm: 'Taxa de Administração', corretagem: 'Corretagem',
    iof: 'IOF', ir: 'IR sobre Rendimento',
    emolumentos: 'Emolumentos/B3', custódia: 'Taxa de Custódia', outro: 'Encargo',
  };
  const label = TAX_LABELS[taxType] || 'Taxa';

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }

  try {
    // Apenas debita da conta — nao altera qty/avg_cost da posicao
    const txDesc = `${label}: ${ticker}${notes ? ' — ' + notes : ''}`;
    const { error: txErr } = await sb.from('transactions').insert({
      family_id: famId(), account_id: accId, date,
      description: txDesc, amount: -amount,
      memo: notes || null, status: 'confirmed', is_transfer: false,
    });
    if (txErr) throw txErr;

    toast(`✅ ${label} de ${fmt(amount)} registrada em ${ticker}!`, 'success');
    closeModal('invTxModal');
    DB.accounts.bust(); await DB.accounts.load(true);
    _invAugmentAccountBalances(); _renderInvestmentsPage();
    if (state.currentPage === 'dashboard') loadDashboard?.();
  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Registrar Taxa/Imposto'; }
  }
}
window.saveInvTax = saveInvTax;

async function saveEditInvTransaction(originalTxId, positionId) {
  const btn    = document.getElementById('invTxSaveBtn');
  const type   = document.getElementById('invTxType').value;
  const date   = document.getElementById('invTxDate').value;
  const qtyRaw = parseFloat(document.getElementById('invTxQty').value.replace(',','.'));
  const priceRaw = _invReadPrice(document.getElementById('invTxPrice'));
  const notesRaw = document.getElementById('invTxNotes').value.trim();
  const brokerSel = document.getElementById('invTxBroker')?.value || '';
  const brokerOth = document.getElementById('invTxBrokerOther')?.value?.trim() || '';
  const broker    = brokerSel === 'Outro' ? brokerOth : brokerSel;
  const notes     = [notesRaw, broker ? `Corretora: ${broker}` : ''].filter(Boolean).join(' · ') || '';

  if (!date)              { _invShowErr('Informe a data'); return; }
  if (isNaN(qtyRaw) || qtyRaw <= 0)    { _invShowErr('Informe a quantidade'); return; }
  if (!priceRaw || priceRaw <= 0){ _invShowErr('Informe o preço unitário'); return; }

  const total = qtyRaw * priceRaw;
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

  try {
    const originalInvTx = _inv.transactions.find(t => t.id === originalTxId);
    if (!originalInvTx) throw new Error('Movimentacao original nao encontrada.');

    // Replay de todas as transacoes EXCETO a que esta sendo editada
    const remaining = _inv.transactions
      .filter(t => t.position_id === positionId && t.id !== originalTxId)
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Construir a versao editada como objeto temporario
    const editedTx = { type, date, quantity: qtyRaw, unit_price: priceRaw };

    // Inserir a tx editada na ordem cronologica correta
    const allTxs = [...remaining, editedTx].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Recalcular qty e avg_cost
    let recalcQty = 0, recalcCost = 0;
    for (const t of allTxs) {
      if (t.type === 'buy') {
        const newQty = recalcQty + t.quantity;
        recalcCost = newQty > 0
          ? (recalcQty * recalcCost + t.quantity * t.unit_price) / newQty
          : t.unit_price;
        recalcQty = newQty;
      } else {
        recalcQty = Math.max(0, recalcQty - t.quantity);
      }
    }

    // 1. Atualizar investment_transaction
    const { error: invTxErr } = await sb.from('investment_transactions').update({
      type, date,
      quantity:   qtyRaw,
      unit_price: priceRaw,
      total_brl:  total,
      notes:      notes || null,
    }).eq('id', originalTxId);
    if (invTxErr) throw invTxErr;

    // 2. Atualizar transacao financeira vinculada (se existir)
    if (originalInvTx.tx_id) {
      const txAmount = type === 'buy' ? -total : total;
      const txDesc   = `${type === 'buy' ? 'Compra' : 'Venda'}: ${_inv.positions.find(p=>p.id===positionId)?.ticker || ''} ${qtyRaw}x @ ${fmt(priceRaw)}`;
      try {
        await sb.from('transactions').update({
          date, amount: txAmount, description: txDesc, memo: notes || null,
        }).eq('id', originalInvTx.tx_id);
      } catch(_) {}
    }

    // 3. Atualizar posicao com valores recalculados
    const { error: posErr } = await sb.from('investment_positions').update({
      quantity:   recalcQty,
      avg_cost:   recalcCost,
      updated_at: localISOTimestamp(),
    }).eq('id', positionId);
    if (posErr) throw posErr;

    // 4. Atualizar historico de preco na data
    const pos2 = _inv.positions.find(p => p.id === positionId);
    if (pos2) await _invSavePrice(pos2, priceRaw, pos2.currency || 'BRL', date, 'manual');

    toast('Movimentacao atualizada com sucesso!', 'success');
    closeModal('invTxModal');

    await loadInvestments(true);
    DB.accounts.bust();
    await DB.accounts.load(true);
    _invAugmentAccountBalances();
    _renderInvestmentsPage();
    setTimeout(() => openInvPositionDetail(positionId), 300);

  } catch(e) {
    _invShowErr(e.message || 'Erro ao salvar edicao');
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Edicao'; }
  }
}
window.saveEditInvTransaction = saveEditInvTransaction;

window.deleteInvTransaction = deleteInvTransaction;

async function deleteInvPosition(positionId) {
  const pos = _inv.positions.find(p => p.id === positionId);
  if (!pos) { toast('Posição não encontrada', 'error'); return; }

  // Two-step confirmation — critical financial data
  const step1 = await new Promise(resolve => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10020;display:flex;align-items:center;justify-content:center;padding:24px';
    d.innerHTML = `
      <div style="background:var(--surface);border-radius:var(--r-lg);padding:28px 24px;max-width:380px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.3)">
        <div style="font-size:1.5rem;text-align:center;margin-bottom:14px">⚠️</div>
        <div style="font-family:var(--font-serif);font-size:1.1rem;font-weight:600;color:var(--text);text-align:center;margin-bottom:10px">Excluir posição?</div>
        <div style="font-size:.85rem;color:var(--muted);text-align:center;margin-bottom:6px">
          <strong>${esc(pos.ticker)}</strong> — ${esc(pos.name || pos.ticker)}
        </div>
        <div style="font-size:.78rem;color:var(--danger,#dc2626);text-align:center;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.15);border-radius:8px;padding:10px;margin-bottom:20px">
          Isso também excluirá todas as transações e histórico de preços desta posição. Ação irreversível.
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="this.closest('[style*=fixed]').remove();window._invDelResolve(false)"
            style="flex:1;padding:11px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--surface);font-family:var(--font-sans);font-size:.88rem;cursor:pointer">Cancelar</button>
          <button onclick="this.closest('[style*=fixed]').remove();window._invDelResolve(true)"
            style="flex:1;padding:11px;border-radius:var(--r-sm);border:none;background:var(--danger,#dc2626);color:#fff;font-family:var(--font-sans);font-size:.88rem;font-weight:700;cursor:pointer">Excluir</button>
        </div>
      </div>`;
    window._invDelResolve = resolve;
    document.body.appendChild(d);
  });
  delete window._invDelResolve;
  if (!step1) return;

  try {
    // Delete in order: price history → transactions → position
    await sb.from('investment_price_history').delete().eq('position_id', positionId);
    await sb.from('investment_transactions').delete().eq('position_id', positionId);
    const { error } = await sb.from('investment_positions').delete().eq('id', positionId);
    if (error) throw error;

    toast(`✓ Posição ${pos.ticker} excluída com sucesso.`, 'success');
    closeModal('invDetailModal');
    await loadInvestments(true);
    _renderInvestmentsPage();
  } catch(e) {
    toast('Erro ao excluir: ' + e.message, 'error');
  }
}
window.deleteInvPosition = deleteInvPosition;

// ── Expor funções públicas no window ──────────────────────────────────────────
window._invBrlPrice                        = _invBrlPrice;
window._invMarketValue                     = _invMarketValue;
window.applyInvestmentsFeature             = applyInvestmentsFeature;
window.invTotalPortfolioValue              = invTotalPortfolioValue;
window.loadInvestments                     = loadInvestments;
