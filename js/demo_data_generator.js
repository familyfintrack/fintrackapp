/* demo_data_generator.js ─────────────────────────────────────────────────────
 * Gerador de massa de dados para demonstração do Family FinTrack.
 * Gera 1 ano de transações realistas para uma família fictícia.
 * NÃO contém dados reais — todos fictícios.
 * Uso: chamado pelo painel admin via importDemoData(userId, familyId)
 * ─────────────────────────────────────────────────────────────────────────── */

/* ── Utilitário de RNG determinístico ──────────────────────────────────────── */
function _demoRng(seed = 42) {
  let s = seed;
  return {
    next() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; },
    int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; },
    pick(arr) { return arr[this.int(0, arr.length - 1)]; },
    pickN(arr, n) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=this.int(0,i);[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n); },
    float(min, max, dec=2) { return parseFloat((this.next()*(max-min)+min).toFixed(dec)); },
    bool(p=0.5) { return this.next() < p; },
  };
}

/* ── Gerador principal ──────────────────────────────────────────────────────── */
function generateDemoData() {
  const rng = _demoRng(2024);
  const now = new Date();
  const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear()-1);

  function uuid() {
    return 'demo-' + Math.random().toString(36).slice(2,10) + '-' + Math.random().toString(36).slice(2,10);
  }
  function dateStr(d) { return d.toISOString().slice(0,10); }
  function daysAgo(n) { const d=new Date(now); d.setDate(d.getDate()-n); return d; }
  function monthStart(offset=0) {
    const d=new Date(now.getFullYear(),now.getMonth()+offset,1);
    return dateStr(d);
  }

  /* ─ IDs ─────────────────────────────────────────────────────────────────── */
  const IDS = {
    // Contas
    acc_corrente: uuid(), acc_poupanca: uuid(), acc_visa: uuid(),
    acc_master: uuid(), acc_usd: uuid(), acc_salario: uuid(),
    // Grupos de contas
    grp_br: uuid(), grp_inter: uuid(),
    // Categorias — Despesas
    cat_alimentacao: uuid(), cat_mercado: uuid(), cat_restaurante: uuid(),
    cat_delivery: uuid(), cat_transporte: uuid(), cat_combustivel: uuid(),
    cat_uber: uuid(), cat_moradia: uuid(), cat_aluguel: uuid(),
    cat_condominio: uuid(), cat_manutencao: uuid(), cat_saude: uuid(),
    cat_farmacia: uuid(), cat_medico: uuid(), cat_plano: uuid(),
    cat_educacao: uuid(), cat_cursos: uuid(), cat_escola: uuid(),
    cat_lazer: uuid(), cat_streaming: uuid(), cat_assinaturas: uuid(),
    cat_academia: uuid(), cat_viagem: uuid(), cat_vestuario: uuid(),
    cat_eletronicos: uuid(), cat_utilidades: uuid(), cat_luz: uuid(),
    cat_agua: uuid(), cat_gas: uuid(), cat_internet: uuid(),
    cat_telefone: uuid(), cat_seguros: uuid(), cat_pet: uuid(),
    cat_cartao: uuid(),
    // Categorias — Receitas
    cat_salario: uuid(), cat_bonus: uuid(), cat_freelance: uuid(),
    cat_aluguel_rec: uuid(), cat_dividendos: uuid(), cat_reembolso: uuid(),
    // Beneficiários / Fontes
    pay_carrefour: uuid(), pay_extra: uuid(), pay_padoacucar: uuid(),
    pay_ifood: uuid(), pay_rappi: uuid(), pay_mcdonalds: uuid(),
    pay_subway: uuid(), pay_outback: uuid(), pay_dominos: uuid(),
    pay_netflix: uuid(), pay_spotify: uuid(), pay_globoplay: uuid(),
    pay_amazon: uuid(), pay_disney: uuid(), pay_hbo: uuid(),
    pay_claro: uuid(), pay_vivo: uuid(), pay_tim: uuid(),
    pay_cpfl: uuid(), pay_sabesp: uuid(), pay_comgas: uuid(),
    pay_smartfit: uuid(), pay_renner: uuid(), pay_hm: uuid(),
    pay_farmacia: uuid(), pay_unimed: uuid(), pay_amil: uuid(),
    pay_shell: uuid(), pay_ipiranga: uuid(), pay_uber: uuid(),
    pay_99: uuid(), pay_amazon_br: uuid(), pay_mercadolivre: uuid(),
    pay_banco_xp: uuid(), pay_nubank: uuid(), pay_sicredi: uuid(),
    pay_techcorp: uuid(), pay_freelance_mkt: uuid(), pay_imovel: uuid(),
    // Dreams / Objetivos
    dream_europa: uuid(), dream_carro: uuid(), dream_reserva: uuid(), dream_reforma: uuid(),
    // Dívidas
    debt_auto: uuid(), debt_emprestimo: uuid(),
    // Grocery list
    grocery_lista: uuid(),
    // Price items
    price_frango: uuid(), price_arroz: uuid(), price_feijao: uuid(),
    price_leite: uuid(), price_cafe: uuid(),
    // Price stores
    store_carrefour: uuid(), store_padoasucar: uuid(),
  };

  /* ─ Account Groups ────────────────────────────────────────────────────────*/
  const accountGroups = [
    { id: IDS.grp_br,    name:'Contas Brasil',       emoji:'🇧🇷', color:'#16a34a', currency:'BRL' },
    { id: IDS.grp_inter, name:'Contas Internacional', emoji:'🇺🇸', color:'#2563eb', currency:'USD' },
  ];

  /* ─ Accounts ──────────────────────────────────────────────────────────────*/
  const accounts = [
    { id:IDS.acc_corrente, name:'Conta Corrente Nubank',  type:'corrente',       currency:'BRL', color:'#8b5cf6', icon:'🏦', group_id:IDS.grp_br,    balance:12450.00, initial_balance:5000,  bank_name:'Nubank',  is_favorite:true },
    { id:IDS.acc_salario,  name:'Conta Salário Itaú',     type:'corrente',       currency:'BRL', color:'#f59e0b', icon:'💼', group_id:IDS.grp_br,    balance:3200.00,  initial_balance:0,     bank_name:'Itaú'    },
    { id:IDS.acc_poupanca, name:'Poupança Caixa',         type:'poupanca',       currency:'BRL', color:'#16a34a', icon:'🏦', group_id:IDS.grp_br,    balance:28750.00, initial_balance:20000, bank_name:'CEF',     is_favorite:true },
    { id:IDS.acc_visa,     name:'Cartão Visa Nubank',     type:'cartao_credito', currency:'BRL', color:'#8b5cf6', icon:'💳', group_id:IDS.grp_br,    balance:-4230.00, initial_balance:0,     bank_name:'Nubank',  card_brand:'Visa',  card_limit:15000, is_favorite:true },
    { id:IDS.acc_master,   name:'Cartão Mastercard XP',   type:'cartao_credito', currency:'BRL', color:'#ef4444', icon:'💳', group_id:IDS.grp_br,    balance:-1850.00, initial_balance:0,     bank_name:'XP',      card_brand:'Mastercard', card_limit:8000 },
    { id:IDS.acc_usd,      name:'Conta USD Wise',         type:'corrente',       currency:'USD', color:'#2563eb', icon:'🇺🇸', group_id:IDS.grp_inter, balance:1250.00,  initial_balance:1000,  bank_name:'Wise' },
  ];

  /* ─ Categories ────────────────────────────────────────────────────────────*/
  const categories = [
    // Despesas
    { id:IDS.cat_alimentacao, name:'Alimentação',    type:'despesa', color:'#f59e0b', icon:'🍔',  parent_id:null },
    { id:IDS.cat_mercado,     name:'Mercado',        type:'despesa', color:'#16a34a', icon:'🛒',  parent_id:IDS.cat_alimentacao },
    { id:IDS.cat_restaurante, name:'Restaurante',    type:'despesa', color:'#f97316', icon:'🍽️',  parent_id:IDS.cat_alimentacao },
    { id:IDS.cat_delivery,    name:'Delivery',       type:'despesa', color:'#ef4444', icon:'🛵',  parent_id:IDS.cat_alimentacao },
    { id:IDS.cat_transporte,  name:'Transporte',     type:'despesa', color:'#6366f1', icon:'🚗',  parent_id:null },
    { id:IDS.cat_combustivel, name:'Combustível',    type:'despesa', color:'#d97706', icon:'⛽',  parent_id:IDS.cat_transporte },
    { id:IDS.cat_uber,        name:'Uber/99',        type:'despesa', color:'#1d4ed8', icon:'🚕',  parent_id:IDS.cat_transporte },
    { id:IDS.cat_moradia,     name:'Moradia',        type:'despesa', color:'#7c3aed', icon:'🏠',  parent_id:null },
    { id:IDS.cat_aluguel,     name:'Aluguel',        type:'despesa', color:'#9333ea', icon:'🏡',  parent_id:IDS.cat_moradia },
    { id:IDS.cat_condominio,  name:'Condomínio',     type:'despesa', color:'#a855f7', icon:'🏢',  parent_id:IDS.cat_moradia },
    { id:IDS.cat_manutencao,  name:'Manutenção',     type:'despesa', color:'#ec4899', icon:'🔧',  parent_id:IDS.cat_moradia },
    { id:IDS.cat_saude,       name:'Saúde',          type:'despesa', color:'#ef4444', icon:'🏥',  parent_id:null },
    { id:IDS.cat_farmacia,    name:'Farmácia',       type:'despesa', color:'#dc2626', icon:'💊',  parent_id:IDS.cat_saude },
    { id:IDS.cat_medico,      name:'Médico',         type:'despesa', color:'#b91c1c', icon:'👨‍⚕️', parent_id:IDS.cat_saude },
    { id:IDS.cat_plano,       name:'Plano de Saúde', type:'despesa', color:'#f87171', icon:'🩺',  parent_id:IDS.cat_saude },
    { id:IDS.cat_educacao,    name:'Educação',       type:'despesa', color:'#0891b2', icon:'📚',  parent_id:null },
    { id:IDS.cat_cursos,      name:'Cursos Online',  type:'despesa', color:'#0e7490', icon:'💻',  parent_id:IDS.cat_educacao },
    { id:IDS.cat_escola,      name:'Escola/Faculdade',type:'despesa',color:'#155e75', icon:'🎓',  parent_id:IDS.cat_educacao },
    { id:IDS.cat_lazer,       name:'Lazer',          type:'despesa', color:'#7c3aed', icon:'🎬',  parent_id:null },
    { id:IDS.cat_streaming,   name:'Streaming',      type:'despesa', color:'#6d28d9', icon:'📺',  parent_id:IDS.cat_lazer },
    { id:IDS.cat_assinaturas, name:'Assinaturas',    type:'despesa', color:'#5b21b6', icon:'📱',  parent_id:IDS.cat_lazer },
    { id:IDS.cat_academia,    name:'Academia/Sport', type:'despesa', color:'#16a34a', icon:'🏋️',  parent_id:IDS.cat_lazer },
    { id:IDS.cat_viagem,      name:'Viagem',         type:'despesa', color:'#2563eb', icon:'✈️',  parent_id:null },
    { id:IDS.cat_vestuario,   name:'Vestuário',      type:'despesa', color:'#db2777', icon:'👗',  parent_id:null },
    { id:IDS.cat_eletronicos, name:'Eletrônicos',    type:'despesa', color:'#64748b', icon:'📱',  parent_id:null },
    { id:IDS.cat_utilidades,  name:'Utilidades',     type:'despesa', color:'#475569', icon:'⚡',  parent_id:null },
    { id:IDS.cat_luz,         name:'Energia Elétrica',type:'despesa',color:'#eab308', icon:'💡',  parent_id:IDS.cat_utilidades },
    { id:IDS.cat_agua,        name:'Água/Saneamento', type:'despesa',color:'#0ea5e9', icon:'💧',  parent_id:IDS.cat_utilidades },
    { id:IDS.cat_gas,         name:'Gás',            type:'despesa', color:'#f97316', icon:'🔥',  parent_id:IDS.cat_utilidades },
    { id:IDS.cat_internet,    name:'Internet/Telefone',type:'despesa',color:'#06b6d4',icon:'📡',  parent_id:IDS.cat_utilidades },
    { id:IDS.cat_seguros,     name:'Seguros',        type:'despesa', color:'#64748b', icon:'🛡️',  parent_id:null },
    { id:IDS.cat_pet,         name:'Pet',            type:'despesa', color:'#92400e', icon:'🐾',  parent_id:null },
    { id:IDS.cat_cartao,      name:'Pagamento Cartão',type:'despesa',color:'#334155', icon:'💳',  parent_id:null },
    // Receitas
    { id:IDS.cat_salario,     name:'Salário',        type:'receita', color:'#16a34a', icon:'💰',  parent_id:null },
    { id:IDS.cat_bonus,       name:'Bônus/PLR',      type:'receita', color:'#059669', icon:'🎯',  parent_id:IDS.cat_salario },
    { id:IDS.cat_freelance,   name:'Freelance',      type:'receita', color:'#0d9488', icon:'💻',  parent_id:null },
    { id:IDS.cat_aluguel_rec, name:'Aluguel Recebido',type:'receita',color:'#7c3aed', icon:'🏠',  parent_id:null },
    { id:IDS.cat_dividendos,  name:'Dividendos',     type:'receita', color:'#2563eb', icon:'📈',  parent_id:null },
    { id:IDS.cat_reembolso,   name:'Reembolso',      type:'receita', color:'#f59e0b', icon:'↩️',  parent_id:null },
  ];

  /* ─ Payees ────────────────────────────────────────────────────────────────*/
  const payees = [
    { id:IDS.pay_carrefour,   name:'Carrefour',        type:'beneficiario', icon:'🛒' },
    { id:IDS.pay_extra,       name:'Extra / GPA',      type:'beneficiario', icon:'🛒' },
    { id:IDS.pay_padoacucar,  name:'Pão de Açúcar',    type:'beneficiario', icon:'🛒' },
    { id:IDS.pay_ifood,       name:'iFood',            type:'beneficiario', icon:'🛵' },
    { id:IDS.pay_rappi,       name:'Rappi',            type:'beneficiario', icon:'🛵' },
    { id:IDS.pay_mcdonalds,   name:"McDonald's",       type:'beneficiario', icon:'🍔' },
    { id:IDS.pay_subway,      name:'Subway',           type:'beneficiario', icon:'🥪' },
    { id:IDS.pay_outback,     name:'Outback',          type:'beneficiario', icon:'🥩' },
    { id:IDS.pay_dominos,     name:"Domino's Pizza",   type:'beneficiario', icon:'🍕' },
    { id:IDS.pay_netflix,     name:'Netflix',          type:'beneficiario', icon:'📺' },
    { id:IDS.pay_spotify,     name:'Spotify',          type:'beneficiario', icon:'🎵' },
    { id:IDS.pay_globoplay,   name:'Globoplay',        type:'beneficiario', icon:'📺' },
    { id:IDS.pay_amazon,      name:'Amazon Prime',     type:'beneficiario', icon:'📦' },
    { id:IDS.pay_disney,      name:'Disney+',          type:'beneficiario', icon:'🎬' },
    { id:IDS.pay_hbo,         name:'Max (HBO)',         type:'beneficiario', icon:'🎬' },
    { id:IDS.pay_claro,       name:'Claro',            type:'beneficiario', icon:'📡' },
    { id:IDS.pay_vivo,        name:'Vivo / Telefônica', type:'beneficiario', icon:'📱' },
    { id:IDS.pay_cpfl,        name:'CPFL Energia',     type:'beneficiario', icon:'💡' },
    { id:IDS.pay_sabesp,      name:'Sabesp',           type:'beneficiario', icon:'💧' },
    { id:IDS.pay_comgas,      name:'Comgás',           type:'beneficiario', icon:'🔥' },
    { id:IDS.pay_smartfit,    name:'Smart Fit',        type:'beneficiario', icon:'🏋️' },
    { id:IDS.pay_renner,      name:'Renner',           type:'beneficiario', icon:'👗' },
    { id:IDS.pay_hm,          name:'H&M',              type:'beneficiario', icon:'👗' },
    { id:IDS.pay_farmacia,    name:'Droga Raia',       type:'beneficiario', icon:'💊' },
    { id:IDS.pay_unimed,      name:'Unimed',           type:'beneficiario', icon:'🏥' },
    { id:IDS.pay_shell,       name:'Shell',            type:'beneficiario', icon:'⛽' },
    { id:IDS.pay_uber,        name:'Uber',             type:'beneficiario', icon:'🚗' },
    { id:IDS.pay_99,          name:'99',               type:'beneficiario', icon:'🚕' },
    { id:IDS.pay_amazon_br,   name:'Amazon.com.br',    type:'beneficiario', icon:'📦' },
    { id:IDS.pay_mercadolivre,name:'Mercado Livre',    type:'beneficiario', icon:'🛍️' },
    // Fontes pagadoras
    { id:IDS.pay_techcorp,    name:'TechCorp Ltda',    type:'fonte_pagadora', icon:'🏢', cnpj_cpf:'12.345.678/0001-99' },
    { id:IDS.pay_freelance_mkt,name:'FreelanceMkt',   type:'fonte_pagadora', icon:'💻' },
    { id:IDS.pay_imovel,      name:'Imóvel Rua das Flores', type:'fonte_pagadora', icon:'🏠' },
  ];

  /* ─ Family Members ────────────────────────────────────────────────────────*/
  const familyMembers = [
    { name:'Ana Silva',    role:'owner', color:'#8b5cf6', icon:'👩' },
    { name:'Carlos Silva', role:'member',color:'#2563eb', icon:'👨' },
    { name:'Sofia Silva',  role:'member',color:'#ec4899', icon:'👧' },
  ];

  /* ─ Scheduled Transactions ────────────────────────────────────────────────*/
  const scheduled = [
    { description:'Salário TechCorp', type:'income',   amount:12500, frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_salario, payee_id:IDS.pay_techcorp, category_id:IDS.cat_salario, status:'active', auto_register:true, day_of_month:5 },
    { description:'Aluguel Apto',     type:'expense',  amount:-3200, frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_corrente, category_id:IDS.cat_aluguel, status:'active', auto_register:true, day_of_month:10 },
    { description:'Condomínio',       type:'expense',  amount:-650,  frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_corrente, category_id:IDS.cat_condominio, status:'active', auto_register:true, day_of_month:10 },
    { description:'Netflix',          type:'expense',  amount:-45.90,frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_visa,     payee_id:IDS.pay_netflix,    category_id:IDS.cat_streaming, status:'active', auto_register:true, day_of_month:15 },
    { description:'Spotify',          type:'expense',  amount:-21.90,frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_visa,     payee_id:IDS.pay_spotify,    category_id:IDS.cat_streaming, status:'active', auto_register:true, day_of_month:15 },
    { description:'Disney+',          type:'expense',  amount:-38.90,frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_visa,     payee_id:IDS.pay_disney,     category_id:IDS.cat_streaming, status:'active', auto_register:true, day_of_month:15 },
    { description:'Energia CPFL',     type:'expense',  amount:-280,  frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_corrente, payee_id:IDS.pay_cpfl,       category_id:IDS.cat_luz, status:'active', auto_register:true, day_of_month:20 },
    { description:'Água Sabesp',      type:'expense',  amount:-95,   frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_corrente, payee_id:IDS.pay_sabesp,     category_id:IDS.cat_agua, status:'active', auto_register:true, day_of_month:22 },
    { description:'Internet Claro',   type:'expense',  amount:-179.90,frequency:'monthly',start_date:monthStart(-12), account_id:IDS.acc_corrente, payee_id:IDS.pay_claro,      category_id:IDS.cat_internet, status:'active', auto_register:true, day_of_month:18 },
    { description:'Smart Fit',        type:'expense',  amount:-99.90,frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_visa,     payee_id:IDS.pay_smartfit,   category_id:IDS.cat_academia, status:'active', auto_register:true, day_of_month:1 },
    { description:'Plano Unimed Fam.', type:'expense', amount:-890,  frequency:'monthly', start_date:monthStart(-12), account_id:IDS.acc_corrente, payee_id:IDS.pay_unimed,     category_id:IDS.cat_plano, status:'active', auto_register:true, day_of_month:8 },
    { description:'Financiamento Carro HB20',type:'expense',amount:-1150,frequency:'monthly',start_date:monthStart(-36),account_id:IDS.acc_corrente,category_id:IDS.cat_seguros,status:'active',auto_register:true,day_of_month:15,end_date:monthStart(12) },
    { description:'Aluguel Recebido — Apto Centro',type:'income',amount:1800,frequency:'monthly',start_date:monthStart(-12),account_id:IDS.acc_corrente,payee_id:IDS.pay_imovel,category_id:IDS.cat_aluguel_rec,status:'active',auto_register:true,day_of_month:5 },
    // Futuras
    { description:'IPTU 2025 — Parcela',type:'expense',amount:-420,frequency:'monthly',start_date:monthStart(0),account_id:IDS.acc_corrente,category_id:IDS.cat_moradia,status:'active',auto_register:false,day_of_month:15,end_date:monthStart(6) },
    { description:'Viagem Europa Jul/25',type:'expense',amount:-2500,frequency:'once',start_date:monthStart(3),account_id:IDS.acc_corrente,category_id:IDS.cat_viagem,status:'active',auto_register:false },
    { description:'Freelance Projeto Web',type:'income',amount:4500,frequency:'once',start_date:monthStart(1),account_id:IDS.acc_corrente,payee_id:IDS.pay_freelance_mkt,category_id:IDS.cat_freelance,status:'active',auto_register:false },
    { description:'Bônus Anual TechCorp',type:'income',amount:18000,frequency:'yearly',start_date:monthStart(2),account_id:IDS.acc_salario,payee_id:IDS.pay_techcorp,category_id:IDS.cat_bonus,status:'active',auto_register:false,day_of_month:15 },
    { description:'Comgás',type:'expense',amount:-55,frequency:'monthly',start_date:monthStart(-12),account_id:IDS.acc_corrente,payee_id:IDS.pay_comgas,category_id:IDS.cat_gas,status:'active',auto_register:true,day_of_month:25 },
  ];

  /* ─ Transactions generator ────────────────────────────────────────────────*/
  const transactions = [];

  // Helper to add a tx
  function addTx(opts) {
    const d = opts.date || dateStr(daysAgo(rng.int(0,365)));
    transactions.push({
      id: uuid(),
      date: d,
      description: opts.description,
      amount: opts.amount,
      brl_amount: opts.brl_amount || opts.amount,
      currency: opts.currency || 'BRL',
      account_id: opts.account_id,
      payee_id: opts.payee_id || null,
      category_id: opts.category_id || null,
      status: opts.status || 'confirmed',
      is_transfer: opts.is_transfer || false,
      is_card_payment: opts.is_card_payment || false,
      type: opts.type || (opts.amount > 0 ? 'income' : 'expense'),
      notes: opts.notes || null,
    });
  }

  // Generate 12 months of recurring transactions
  for (let monthOffset = -11; monthOffset <= 0; monthOffset++) {
    const baseDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);

    // Salary (5th)
    const salDate = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 5));
    addTx({ date:salDate, description:'Salário TechCorp', amount:12500, account_id:IDS.acc_salario, payee_id:IDS.pay_techcorp, category_id:IDS.cat_salario, type:'income' });

    // Transfer salary to checking (6th)
    const trDate = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 6));
    addTx({ date:trDate, description:'Transferência Conta Salário → Corrente', amount:-10000, account_id:IDS.acc_salario, is_transfer:true, type:'transfer' });
    addTx({ date:trDate, description:'Transferência Conta Salário → Corrente', amount:10000,  account_id:IDS.acc_corrente, is_transfer:true, type:'transfer' });

    // Rent received (5th)
    addTx({ date:salDate, description:'Aluguel Recebido — Apto Centro', amount:1800, account_id:IDS.acc_corrente, payee_id:IDS.pay_imovel, category_id:IDS.cat_aluguel_rec, type:'income' });

    // Fixed expenses
    const d10 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 10));
    const d15 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 15));
    const d18 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 18));
    const d20 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 20));
    const d22 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 22));

    addTx({ date:d10, description:'Aluguel Apto Moema',    amount:-3200,   account_id:IDS.acc_corrente, category_id:IDS.cat_aluguel });
    addTx({ date:d10, description:'Condomínio',            amount:-650,    account_id:IDS.acc_corrente, category_id:IDS.cat_condominio });
    addTx({ date:d15, description:'Netflix',               amount:-45.90,  account_id:IDS.acc_visa, payee_id:IDS.pay_netflix, category_id:IDS.cat_streaming });
    addTx({ date:d15, description:'Spotify Família',       amount:-21.90,  account_id:IDS.acc_visa, payee_id:IDS.pay_spotify, category_id:IDS.cat_streaming });
    addTx({ date:d15, description:'Disney+',               amount:-38.90,  account_id:IDS.acc_visa, payee_id:IDS.pay_disney, category_id:IDS.cat_streaming });
    addTx({ date:d15, description:'Financiamento HB20',    amount:-1150,   account_id:IDS.acc_corrente, category_id:IDS.cat_seguros });
    addTx({ date:d18, description:'Internet Claro 1Gbps',  amount:-179.90, account_id:IDS.acc_corrente, payee_id:IDS.pay_claro, category_id:IDS.cat_internet });
    addTx({ date:d20, description:'Energia CPFL',          amount:-(rng.float(230,380)), account_id:IDS.acc_corrente, payee_id:IDS.pay_cpfl, category_id:IDS.cat_luz });
    addTx({ date:d22, description:'Água e Saneamento Sabesp', amount:-(rng.float(70,130)), account_id:IDS.acc_corrente, payee_id:IDS.pay_sabesp, category_id:IDS.cat_agua });

    const d8 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 8));
    addTx({ date:d8,  description:'Smart Fit',             amount:-99.90,  account_id:IDS.acc_visa, payee_id:IDS.pay_smartfit, category_id:IDS.cat_academia });
    addTx({ date:d8,  description:'Plano Unimed Família',  amount:-890,    account_id:IDS.acc_corrente, payee_id:IDS.pay_unimed, category_id:IDS.cat_plano });
    addTx({ date:d20, description:'Comgás',                amount:-(rng.float(40,80)),  account_id:IDS.acc_corrente, payee_id:IDS.pay_comgas, category_id:IDS.cat_gas });

    // Card payment (1st)
    const d1 = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
    const visaBill = rng.float(3500,6500);
    addTx({ date:d1, description:'Pgto Fatura Visa Nubank', amount:-visaBill, account_id:IDS.acc_corrente, is_card_payment:true, type:'card_payment' });
    addTx({ date:d1, description:'Pgto Fatura Mastercard XP', amount:-(rng.float(800,2000)), account_id:IDS.acc_corrente, is_card_payment:true, type:'card_payment' });

    // Weekly grocery (randomized)
    for (let week = 0; week < 4; week++) {
      const grocDay = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 7*week + rng.int(1,7)));
      const store = rng.pick([{id:IDS.pay_carrefour,name:'Carrefour'},{id:IDS.pay_extra,name:'Extra'},{id:IDS.pay_padoacucar,name:'Pão de Açúcar'}]);
      addTx({ date:grocDay, description:`Compras ${store.name}`, amount:-(rng.float(180,480)), account_id:IDS.acc_visa, payee_id:store.id, category_id:IDS.cat_mercado });
    }

    // Delivery 2-3x per week
    for (let d2 = 0; d2 < rng.int(5,10); d2++) {
      const delivDay = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28)));
      const del = rng.pick([{id:IDS.pay_ifood,name:'iFood'},{id:IDS.pay_rappi,name:'Rappi'}]);
      addTx({ date:delivDay, description:`Pedido ${del.name}`, amount:-(rng.float(35,95)), account_id:IDS.acc_visa, payee_id:del.id, category_id:IDS.cat_delivery });
    }

    // Restaurant 2-4x/month
    for (let r2 = 0; r2 < rng.int(2,4); r2++) {
      const restDay = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28)));
      const rest = rng.pick([{id:IDS.pay_outback,name:'Outback Steakhouse'},{id:IDS.pay_mcdonalds,name:"McDonald's"},{id:IDS.pay_subway,name:'Subway'},{id:IDS.pay_dominos,name:"Domino's"}]);
      addTx({ date:restDay, description:`Jantar ${rest.name}`, amount:-(rng.float(45,280)), account_id:rng.pick([IDS.acc_visa,IDS.acc_master]), payee_id:rest.id, category_id:IDS.cat_restaurante });
    }

    // Fuel 2-3x/month
    for (let f2 = 0; f2 < rng.int(2,3); f2++) {
      const fuelDay = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28)));
      addTx({ date:fuelDay, description:'Combustível Shell', amount:-(rng.float(120,280)), account_id:IDS.acc_visa, payee_id:IDS.pay_shell, category_id:IDS.cat_combustivel });
    }

    // Uber 3-5x/month
    for (let u2 = 0; u2 < rng.int(3,5); u2++) {
      const uberDay = dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28)));
      addTx({ date:uberDay, description:'Corrida Uber', amount:-(rng.float(12,65)), account_id:IDS.acc_visa, payee_id:IDS.pay_uber, category_id:IDS.cat_uber });
    }

    // Farmácia
    if (rng.bool(0.7)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Droga Raia', amount:-(rng.float(35,180)), account_id:IDS.acc_visa, payee_id:IDS.pay_farmacia, category_id:IDS.cat_farmacia });
    }

    // Amazon/MercadoLivre
    for (let a2 = 0; a2 < rng.int(0,3); a2++) {
      const mkt = rng.pick([{id:IDS.pay_amazon_br,name:'Amazon.com.br'},{id:IDS.pay_mercadolivre,name:'Mercado Livre'}]);
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:`Compra ${mkt.name}`, amount:-(rng.float(40,450)), account_id:IDS.acc_visa, payee_id:mkt.id, category_id:IDS.cat_eletronicos });
    }

    // Vestuário (quarterly)
    if (monthOffset % 3 === 0 || rng.bool(0.3)) {
      const cloth = rng.pick([{id:IDS.pay_renner,name:'Renner'},{id:IDS.pay_hm,name:'H&M'}]);
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:`Compras ${cloth.name}`, amount:-(rng.float(150,600)), account_id:IDS.acc_visa, payee_id:cloth.id, category_id:IDS.cat_vestuario });
    }

    // Savings transfer
    addTx({ date:d18, description:'Poupança mensal', amount:-1500, account_id:IDS.acc_corrente, is_transfer:true, type:'transfer' });
    addTx({ date:d18, description:'Poupança mensal', amount:1500,  account_id:IDS.acc_poupanca, is_transfer:true, type:'transfer' });

    // Médico (sporadic)
    if (rng.bool(0.4)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Consulta médica particular', amount:-(rng.float(200,400)), account_id:IDS.acc_corrente, payee_id:IDS.pay_unimed, category_id:IDS.cat_medico });
    }

    // Freelance income (sporadic)
    if (rng.bool(0.35)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Projeto freelance', amount:rng.float(800,4500), account_id:IDS.acc_corrente, payee_id:IDS.pay_freelance_mkt, category_id:IDS.cat_freelance, type:'income' });
    }

    // Dividend income (quarterly)
    if (monthOffset % 3 === -2 || monthOffset === 0) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 15)),
              description:'Dividendos ETF BOVA11', amount:rng.float(180,420), account_id:IDS.acc_poupanca, category_id:IDS.cat_dividendos, type:'income' });
    }

    // Travel expenses (2x/year)
    if (monthOffset === -6 || monthOffset === -1) {
      for (let t2 = 0; t2 < 5; t2++) {
        addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(8,22))),
                description: monthOffset===-6 ? 'Viagem Rio de Janeiro' : 'Viagem Gramado',
                amount:-(rng.float(200,800)), account_id:IDS.acc_visa, category_id:IDS.cat_viagem });
      }
      // Hotel
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), 10)),
              description:monthOffset===-6?'Hotel Rio Ipanema':'Pousada Serra Gaúcha',
              amount:-(rng.float(800,2200)), account_id:IDS.acc_visa, category_id:IDS.cat_viagem });
    }

    // Maintenance (sporadic)
    if (rng.bool(0.3)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Manutenção apartamento', amount:-(rng.float(150,600)), account_id:IDS.acc_corrente, category_id:IDS.cat_manutencao });
    }

    // Education
    if (rng.bool(0.5)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Curso Udemy / Alura', amount:-(rng.float(25,250)), account_id:IDS.acc_visa, category_id:IDS.cat_cursos });
    }

    // Pet expenses
    if (rng.bool(0.4)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(1,28))),
              description:'Vet / Pet Shop', amount:-(rng.float(80,350)), account_id:IDS.acc_corrente, category_id:IDS.cat_pet });
    }

    // Reimbursement (occasional)
    if (rng.bool(0.25)) {
      addTx({ date: dateStr(new Date(baseDate.getFullYear(), baseDate.getMonth(), rng.int(15,28))),
              description:'Reembolso despesas TechCorp', amount:rng.float(150,600), account_id:IDS.acc_corrente, payee_id:IDS.pay_techcorp, category_id:IDS.cat_reembolso, type:'income' });
    }
  }

  /* ─ Debts ─────────────────────────────────────────────────────────────────*/
  const debts = [
    {
      id: IDS.debt_auto,
      name: 'Financiamento Hyundai HB20',
      original_amount: 55200,
      current_balance: 32800,
      currency: 'BRL',
      status: 'active',
      fixed_rate: 1.49,
      adjustment_type: 'none',
      start_date: dateStr(daysAgo(540)),
      maturity_date: dateStr(new Date(now.getFullYear()+2, now.getMonth(), 15)),
      total_installments: 48,
      paid_installments: 18,
      notes: 'Financiamento 48x — parcela mensal R$ 1.150',
    },
    {
      id: IDS.debt_emprestimo,
      name: 'Empréstimo Pessoal Banco Inter',
      original_amount: 15000,
      current_balance: 8200,
      currency: 'BRL',
      status: 'active',
      fixed_rate: 2.29,
      adjustment_type: 'none',
      start_date: dateStr(daysAgo(270)),
      maturity_date: dateStr(new Date(now.getFullYear()+1, now.getMonth(), 1)),
      total_installments: 24,
      paid_installments: 9,
      notes: 'Empréstimo para reforma do apartamento',
    },
  ];

  /* ─ Dreams / Objetivos ───────────────────────────────────────────────────*/
  const dreams = [
    { id:IDS.dream_europa, title:'Viagem à Europa', description:'Roteiro 15 dias: Paris, Roma, Barcelona, Lisboa', dream_type:'viagem', target_amount:28000, currency:'BRL', target_date:dateStr(new Date(now.getFullYear()+1,6,1)), priority:1, current_amount:4500 },
    { id:IDS.dream_carro,  title:'Carro Novo — Toyota Corolla', description:'Substituir HB20 por um sedan mais confortável', dream_type:'bem', target_amount:140000, currency:'BRL', target_date:dateStr(new Date(now.getFullYear()+3,0,1)), priority:2, current_amount:12000 },
    { id:IDS.dream_reserva,title:'Fundo de Emergência 6 meses', description:'Meta: 6x renda mensal = R$ 75.000', dream_type:'reserva', target_amount:75000, currency:'BRL', target_date:dateStr(new Date(now.getFullYear()+1,11,31)), priority:1, current_amount:28750 },
    { id:IDS.dream_reforma,title:'Reforma Cozinha Americana', description:'Móveis planejados, granito e eletrodomésticos', dream_type:'reforma', target_amount:22000, currency:'BRL', target_date:dateStr(new Date(now.getFullYear(),9,1)), priority:3, current_amount:5000 },
  ];

  /* ─ Grocery List ──────────────────────────────────────────────────────────*/
  const groceryItems = [
    'Frango — 2kg', 'Arroz parboilizado 5kg', 'Feijão carioca 1kg', 'Macarrão espaguete',
    'Leite integral 12x1L', 'Café torrado 500g', 'Açúcar refinado 1kg', 'Óleo de soja 900ml',
    'Pão de forma integral', 'Ovos — dúzia', 'Manteiga 200g', 'Queijo mussarela 400g',
    'Iogurte grego 4x', 'Frutas da estação', 'Legumes para a semana', 'Detergente lava-louças',
    'Sabão em pó 1,6kg', 'Papel higiênico 16 rolos', 'Shampoo', 'Condicionador',
  ];
  const groceries = {
    list: { id:IDS.grocery_lista, name:'Lista Semanal', status:'active', notes:'Compras do mês — supermercado' },
    items: groceryItems.map((name,i) => ({ id:uuid(), list_id:IDS.grocery_lista, name, quantity:1, unit:'un', checked: i<6 })),
  };

  /* ─ Price Items & Stores ──────────────────────────────────────────────────*/
  const priceItems = [
    { id:IDS.price_frango, name:'Peito de Frango', unit:'kg',  category:'Carnes e Aves' },
    { id:IDS.price_arroz,  name:'Arroz Parboilizado 5kg', unit:'pct', category:'Grãos' },
    { id:IDS.price_feijao, name:'Feijão Carioca 1kg', unit:'pct', category:'Grãos' },
    { id:IDS.price_leite,  name:'Leite Integral 1L', unit:'L',  category:'Laticínios' },
    { id:IDS.price_cafe,   name:'Café Torrado Melitta 500g', unit:'pct', category:'Bebidas' },
  ];
  const priceStores = [
    { id:IDS.store_carrefour, name:'Carrefour Moema', address:'Av. Santo Amaro, 929', city:'São Paulo', state:'SP' },
    { id:IDS.store_padoasucar,name:'Pão de Açúcar Ibirapuera', address:'Av. Ibirapuera, 2907', city:'São Paulo', state:'SP' },
  ];
  // Price history (last 3 months, weekly)
  const priceHistory = [];
  [IDS.price_frango, IDS.price_arroz, IDS.price_feijao, IDS.price_leite, IDS.price_cafe].forEach(itemId => {
    const basePrices = { [IDS.price_frango]:19.90, [IDS.price_arroz]:24.90, [IDS.price_feijao]:8.90, [IDS.price_leite]:4.99, [IDS.price_cafe]:22.90 };
    const base = basePrices[itemId];
    [IDS.store_carrefour, IDS.store_padoasucar].forEach(storeId => {
      for (let week = 0; week < 12; week++) {
        priceHistory.push({
          id: uuid(), item_id: itemId, store_id: storeId,
          price: parseFloat((base * (1 + rng.float(-0.08,0.15))).toFixed(2)),
          date: dateStr(daysAgo(week * 7)),
          currency: 'BRL',
        });
      }
    });
  });

  /* ─ Budgets ───────────────────────────────────────────────────────────────*/
  const currMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const budgets = [
    { category_id:IDS.cat_mercado,     amount:1800, budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_delivery,    amount:400,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_restaurante, amount:600,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_combustivel, amount:500,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_lazer,       amount:800,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_vestuario,   amount:400,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_farmacia,    amount:200,  budget_type:'monthly', month:currMonth },
    { category_id:IDS.cat_viagem,      amount:2000, budget_type:'annual',  year:now.getFullYear() },
  ];

  return {
    accountGroups, accounts, categories, payees, familyMembers,
    scheduled, transactions, debts, dreams,
    groceries, priceItems, priceStores, priceHistory, budgets,
    _meta: {
      generated: new Date().toISOString(),
      version: '1.0',
      txCount: transactions.length,
      description: 'Família Demo — 1 ano de dados fictícios para demonstração do Family FinTrack',
    }
  };
}
window.generateDemoData = generateDemoData;
