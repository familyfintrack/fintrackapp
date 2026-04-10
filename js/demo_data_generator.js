// ════════════════════════════════════════════════════════════════════════════
// FAMILY FINTRACK — DEMO DATA GENERATOR v2
// Gera dados realistas para demonstração — 18 meses de histórico
// Estratégia: datas relativas ao dia de hoje (sempre "recentes")
// ════════════════════════════════════════════════════════════════════════════

/* eslint-disable no-undef */

function generateDemoData() {
  const NOW = new Date();
  const Y   = NOW.getFullYear();
  const M   = NOW.getMonth(); // 0-based

  /* ── Helpers ──────────────────────────────────────────────────────────── */
  let _uid = 1;
  function uid() { return 'demo-' + String(++_uid).padStart(6,'0'); }
  function d(year, month1, day) { return `${year}-${String(month1).padStart(2,'0')}-${String(day).padStart(2,'0')}`; }
  function ago(days) {
    const dt = new Date(NOW); dt.setDate(dt.getDate() - days); return dt.toISOString().slice(0,10);
  }
  function mth(offset, day) {
    // offset: months before today (0=this month, 1=last month, …)
    const dt = new Date(Y, M - offset, day);
    return dt.toISOString().slice(0,10);
  }
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pick(lo, hi) { return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100; }

  /* ── IDs ──────────────────────────────────────────────────────────────── */
  // Contas
  const A_NUBANK   = uid(), A_ITAU    = uid(), A_BRADESCO = uid();
  const A_VISA_NU  = uid(), A_MASTER  = uid(), A_POUPANCA = uid();
  const A_USD      = uid(), A_DINHEIRO= uid();
  const GRP_BR     = uid(), GRP_CARDS = uid();

  // Categorias — Pais
  const C_ALIM = uid(), C_TRANSP = uid(), C_MORAD  = uid(), C_SAUDE  = uid();
  const C_EDUC = uid(), C_LAZER  = uid(), C_COMP   = uid(), C_ASSIN  = uid();
  const C_FIN  = uid(), C_PET    = uid(), C_VIAGEM = uid(), C_RECEITA= uid();
  const C_INVEST=uid(), C_TRANSF = uid();

  // Categorias — Filhas
  const C_MERCADO   = uid(), C_REST     = uid(), C_DELIVERY  = uid(), C_PADARIA  = uid();
  const C_COMB      = uid(), C_UBER     = uid(), C_ONIBUS    = uid(), C_ESTACION = uid();
  const C_ALUGUEL   = uid(), C_CONDO    = uid(), C_LUZ       = uid(), C_AGUA     = uid();
  const C_INTERNET  = uid(), C_MANUT    = uid();
  const C_FARMACIA  = uid(), C_MEDICO   = uid(), C_PLANO     = uid(), C_ACADEMIA = uid();
  const C_ESCOLA    = uid(), C_CURSOS   = uid(), C_MATERIAL  = uid();
  const C_NETFLIX   = uid(), C_SPOTIFY  = uid(), C_GAMES     = uid(), C_CINEMA   = uid();
  const C_ROUPAS    = uid(), C_ELETRO   = uid(), C_CASA      = uid();
  const C_AMAZON    = uid(), C_SOFTWARE = uid(), C_ADOBE     = uid();
  const C_SALARIO   = uid(), C_FREELA   = uid(), C_RENDA_EXTRA=uid();
  const C_REND_INV  = uid(), C_DIVIDENDO= uid();
  const C_PET_COMER = uid(), C_PET_VET  = uid();
  const C_HOTEL     = uid(), C_PASSAGEM = uid(), C_PASSEIO   = uid();
  const C_CARTAO_PG = uid(), C_RESERVA  = uid(), C_APLICACAO = uid();

  // Beneficiários
  const P_EXTRA  = uid(), P_CARREFOUR=uid(), P_ATACADAO= uid(), P_HORTIFRUTI=uid();
  const P_MCDONALD=uid(), P_OUTBACK  =uid(), P_COCO_BAM=uid(), P_SUSHI     =uid();
  const P_IFOOD  = uid(), P_RAPPI    = uid();
  const P_SHELL  = uid(), P_IPIRANGA =uid(), P_POSTO_BR=uid();
  const P_UBER   = uid(), P_99       = uid(), P_BUS     =uid();
  const P_NETFLIX= uid(), P_SPOTIFY  =uid(), P_DISNEY  =uid(), P_HBO      =uid();
  const P_AMAZON = uid(), P_STEAM    =uid(), P_APPLE   =uid();
  const P_FARMCV = uid(), P_DROGA5   =uid(), P_UNIMED  =uid(), P_EINSTEIN  =uid();
  const P_ESCOLA1= uid(), P_ALURA    =uid(), P_UDEMY   =uid();
  const P_EMPRESA= uid(), P_EMPRESA2 =uid();
  const P_ZARA   = uid(), P_RENNER   =uid(), P_SHOPTIME=uid();
  const P_PET    = uid(), P_VET      =uid();
  const P_AIRBNB = uid(), P_LATAM    =uid(), P_BOOKING =uid();
  const P_ENEL   = uid(), P_SABESP   =uid(), P_CLARO   =uid(), P_VIVO    =uid();
  const P_CONSULT= uid(), P_DESIGN   =uid(), P_DEV_FELA=uid();

  /* ── Account Groups ───────────────────────────────────────────────────── */
  const accountGroups = [
    { id: GRP_BR,    name: 'Brasil',   icon: '🇧🇷', color: '#009c3b', currency: 'BRL' },
    { id: GRP_CARDS, name: 'Cartões',  icon: '💳', color: '#1A1F71', currency: 'BRL' },
  ];

  /* ── Accounts ─────────────────────────────────────────────────────────── */
  const accounts = [
    { id:A_NUBANK,   name:'Nubank Conta',      type:'corrente',       currency:'BRL', icon:'nubank',    color:'#820AD1', group_id:GRP_BR,    is_favorite:true,  initial_balance: 3200  },
    { id:A_ITAU,     name:'Itaú Corrente',      type:'corrente',       currency:'BRL', icon:'itau',      color:'#FF6600', group_id:GRP_BR,    is_favorite:true,  initial_balance: 8500  },
    { id:A_BRADESCO, name:'Bradesco Conta',     type:'corrente',       currency:'BRL', icon:'bradesco',  color:'#CC092F', group_id:GRP_BR,    is_favorite:false, initial_balance: 1800  },
    { id:A_VISA_NU,  name:'Nubank Roxinho',     type:'cartao_credito', currency:'BRL', icon:'nubank',    color:'#820AD1', group_id:GRP_CARDS, is_favorite:true,  initial_balance: 0, due_day:5,  card_limit:8000  },
    { id:A_MASTER,   name:'Itaú Mastercard',    type:'cartao_credito', currency:'BRL', icon:'itau',      color:'#FF6600', group_id:GRP_CARDS, is_favorite:false, initial_balance: 0, due_day:10, card_limit:12000 },
    { id:A_POUPANCA, name:'Poupança Itaú',      type:'poupanca',       currency:'BRL', icon:'itau',      color:'#F5A623', group_id:GRP_BR,    is_favorite:false, initial_balance:22000  },
    { id:A_USD,      name:'Wise USD',           type:'corrente',       currency:'USD', icon:'wise',      color:'#9FE870', group_id:GRP_BR,    is_favorite:false, initial_balance: 1500  },
    { id:A_DINHEIRO, name:'Carteira',           type:'dinheiro',       currency:'BRL', icon:'emoji-💵',  color:'#2a6049', group_id:GRP_BR,    is_favorite:false, initial_balance:  400  },
  ];

  /* ── Categories ───────────────────────────────────────────────────────── */
  const cats = [
    // Pais
    {id:C_ALIM,   name:'Alimentação',    type:'despesa',     icon:'🍽️', color:'#f59e0b', parent_id:null},
    {id:C_TRANSP, name:'Transporte',     type:'despesa',     icon:'🚗', color:'#3b82f6', parent_id:null},
    {id:C_MORAD,  name:'Moradia',        type:'despesa',     icon:'🏠', color:'#8b5cf6', parent_id:null},
    {id:C_SAUDE,  name:'Saúde',          type:'despesa',     icon:'❤️', color:'#ef4444', parent_id:null},
    {id:C_EDUC,   name:'Educação',       type:'despesa',     icon:'📚', color:'#06b6d4', parent_id:null},
    {id:C_LAZER,  name:'Lazer',          type:'despesa',     icon:'🎭', color:'#ec4899', parent_id:null},
    {id:C_COMP,   name:'Compras',        type:'despesa',     icon:'🛍️', color:'#f97316', parent_id:null},
    {id:C_ASSIN,  name:'Assinaturas',    type:'despesa',     icon:'📡', color:'#6366f1', parent_id:null},
    {id:C_FIN,    name:'Financeiro',     type:'despesa',     icon:'💰', color:'#10b981', parent_id:null},
    {id:C_PET,    name:'Pet',            type:'despesa',     icon:'🐾', color:'#84cc16', parent_id:null},
    {id:C_VIAGEM, name:'Viagem',         type:'despesa',     icon:'✈️', color:'#0ea5e9', parent_id:null},
    {id:C_RECEITA,name:'Renda',          type:'receita',     icon:'💵', color:'#22c55e', parent_id:null},
    {id:C_INVEST, name:'Investimentos',  type:'receita',     icon:'📈', color:'#a855f7', parent_id:null},
    {id:C_TRANSF, name:'Transferência',  type:'transferencia',icon:'🔄',color:'#94a3b8', parent_id:null},
    // Filhas — Alimentação
    {id:C_MERCADO,  name:'Supermercado', type:'despesa',icon:'🛒',color:'#fbbf24', parent_id:C_ALIM},
    {id:C_REST,     name:'Restaurante',  type:'despesa',icon:'🍽️',color:'#f59e0b', parent_id:C_ALIM},
    {id:C_DELIVERY, name:'Delivery',     type:'despesa',icon:'🛵',color:'#f97316', parent_id:C_ALIM},
    {id:C_PADARIA,  name:'Padaria/Café', type:'despesa',icon:'☕',color:'#92400e', parent_id:C_ALIM},
    // Filhas — Transporte
    {id:C_COMB,     name:'Combustível',  type:'despesa',icon:'⛽',color:'#3b82f6', parent_id:C_TRANSP},
    {id:C_UBER,     name:'Uber/Táxi',    type:'despesa',icon:'🚕',color:'#2563eb', parent_id:C_TRANSP},
    {id:C_ONIBUS,   name:'Ônibus/Metrô', type:'despesa',icon:'🚌',color:'#1d4ed8', parent_id:C_TRANSP},
    {id:C_ESTACION, name:'Estacionamento',type:'despesa',icon:'🅿️',color:'#7c3aed', parent_id:C_TRANSP},
    // Filhas — Moradia
    {id:C_ALUGUEL,  name:'Aluguel',      type:'despesa',icon:'🏠',color:'#8b5cf6', parent_id:C_MORAD},
    {id:C_CONDO,    name:'Condomínio',   type:'despesa',icon:'🏢',color:'#7c3aed', parent_id:C_MORAD},
    {id:C_LUZ,      name:'Energia',      type:'despesa',icon:'⚡',color:'#f59e0b', parent_id:C_MORAD},
    {id:C_AGUA,     name:'Água',         type:'despesa',icon:'💧',color:'#06b6d4', parent_id:C_MORAD},
    {id:C_INTERNET, name:'Internet/TV',  type:'despesa',icon:'📱',color:'#6366f1', parent_id:C_MORAD},
    {id:C_MANUT,    name:'Manutenção',   type:'despesa',icon:'🔧',color:'#78716c', parent_id:C_MORAD},
    // Filhas — Saúde
    {id:C_FARMACIA, name:'Farmácia',     type:'despesa',icon:'💊',color:'#ef4444', parent_id:C_SAUDE},
    {id:C_MEDICO,   name:'Consultas',    type:'despesa',icon:'🩺',color:'#dc2626', parent_id:C_SAUDE},
    {id:C_PLANO,    name:'Plano de Saúde',type:'despesa',icon:'❤️',color:'#b91c1c', parent_id:C_SAUDE},
    {id:C_ACADEMIA, name:'Academia',     type:'despesa',icon:'🏋️',color:'#f97316', parent_id:C_SAUDE},
    // Filhas — Educação
    {id:C_ESCOLA,   name:'Escola/Facul', type:'despesa',icon:'🎓',color:'#0284c7', parent_id:C_EDUC},
    {id:C_CURSOS,   name:'Cursos Online',type:'despesa',icon:'💻',color:'#0ea5e9', parent_id:C_EDUC},
    {id:C_MATERIAL, name:'Material',     type:'despesa',icon:'📝',color:'#38bdf8', parent_id:C_EDUC},
    // Filhas — Lazer
    {id:C_NETFLIX,  name:'Netflix',      type:'despesa',icon:'🎬',color:'#dc2626', parent_id:C_LAZER},
    {id:C_SPOTIFY,  name:'Spotify',      type:'despesa',icon:'🎵',color:'#22c55e', parent_id:C_LAZER},
    {id:C_GAMES,    name:'Games',        type:'despesa',icon:'🎮',color:'#7c3aed', parent_id:C_LAZER},
    {id:C_CINEMA,   name:'Cinema/Teatro',type:'despesa',icon:'🎭',color:'#ec4899', parent_id:C_LAZER},
    // Filhas — Compras
    {id:C_ROUPAS,   name:'Roupas/Calç.', type:'despesa',icon:'👗',color:'#f97316', parent_id:C_COMP},
    {id:C_ELETRO,   name:'Eletrônicos',  type:'despesa',icon:'📱',color:'#6366f1', parent_id:C_COMP},
    {id:C_CASA,     name:'Casa/Decoração',type:'despesa',icon:'🛋️',color:'#78716c', parent_id:C_COMP},
    // Filhas — Assinaturas
    {id:C_AMAZON,   name:'Amazon Prime', type:'despesa',icon:'📦',color:'#f59e0b', parent_id:C_ASSIN},
    {id:C_SOFTWARE, name:'Software/SaaS',type:'despesa',icon:'💾',color:'#6366f1', parent_id:C_ASSIN},
    {id:C_ADOBE,    name:'Adobe CC',     type:'despesa',icon:'🎨',color:'#f97316', parent_id:C_ASSIN},
    // Filhas — Renda
    {id:C_SALARIO,  name:'Salário',      type:'receita',icon:'💵',color:'#16a34a', parent_id:C_RECEITA},
    {id:C_FREELA,   name:'Freelance',    type:'receita',icon:'💻',color:'#15803d', parent_id:C_RECEITA},
    {id:C_RENDA_EXTRA,name:'Renda Extra',type:'receita',icon:'💸',color:'#22c55e', parent_id:C_RECEITA},
    // Filhas — Investimentos
    {id:C_REND_INV, name:'Rend. Investimentos',type:'receita',icon:'📈',color:'#a855f7', parent_id:C_INVEST},
    {id:C_DIVIDENDO,name:'Dividendos',   type:'receita',icon:'🏦',color:'#9333ea', parent_id:C_INVEST},
    // Filhas — Pet
    {id:C_PET_COMER,name:'Ração/Pet Shop',type:'despesa',icon:'🐶',color:'#84cc16', parent_id:C_PET},
    {id:C_PET_VET,  name:'Veterinário',  type:'despesa',icon:'🩺',color:'#65a30d', parent_id:C_PET},
    // Filhas — Viagem
    {id:C_HOTEL,    name:'Hotel/Acomod.',type:'despesa',icon:'🏨',color:'#0ea5e9', parent_id:C_VIAGEM},
    {id:C_PASSAGEM, name:'Passagens',    type:'despesa',icon:'✈️',color:'#0284c7', parent_id:C_VIAGEM},
    {id:C_PASSEIO,  name:'Passeios/Tour',type:'despesa',icon:'🗺️',color:'#38bdf8', parent_id:C_VIAGEM},
    // Filhas — Financeiro
    {id:C_CARTAO_PG,name:'Pgto. Cartão', type:'despesa',icon:'💳',color:'#10b981', parent_id:C_FIN},
    {id:C_RESERVA,  name:'Reserva Emer.',type:'despesa',icon:'🏦',color:'#059669', parent_id:C_FIN},
    {id:C_APLICACAO,name:'Aplicações',   type:'despesa',icon:'📊',color:'#047857', parent_id:C_FIN},
  ];

  /* ── Payees ───────────────────────────────────────────────────────────── */
  const payees = [
    {id:P_EXTRA,    name:'Extra Supermercados',  type:'beneficiario', category_id:C_MERCADO },
    {id:P_CARREFOUR,name:'Carrefour',            type:'beneficiario', category_id:C_MERCADO },
    {id:P_ATACADAO, name:'Atacadão',             type:'beneficiario', category_id:C_MERCADO },
    {id:P_HORTIFRUTI,name:'Hortifruti',          type:'beneficiario', category_id:C_MERCADO },
    {id:P_MCDONALD, name:"McDonald's",           type:'beneficiario', category_id:C_REST    },
    {id:P_OUTBACK,  name:'Outback Steakhouse',   type:'beneficiario', category_id:C_REST    },
    {id:P_COCO_BAM, name:'Coco Bambu',           type:'beneficiario', category_id:C_REST    },
    {id:P_SUSHI,    name:'Sushi Royal',          type:'beneficiario', category_id:C_REST    },
    {id:P_IFOOD,    name:'iFood',                type:'beneficiario', category_id:C_DELIVERY},
    {id:P_RAPPI,    name:'Rappi',                type:'beneficiario', category_id:C_DELIVERY},
    {id:P_SHELL,    name:'Shell',                type:'beneficiario', category_id:C_COMB    },
    {id:P_IPIRANGA, name:'Ipiranga',             type:'beneficiario', category_id:C_COMB    },
    {id:P_POSTO_BR, name:'Posto BR',             type:'beneficiario', category_id:C_COMB    },
    {id:P_UBER,     name:'Uber',                 type:'beneficiario', category_id:C_UBER    },
    {id:P_99,       name:'99 Táxi',              type:'beneficiario', category_id:C_UBER    },
    {id:P_BUS,      name:'SPTrans / Metro',      type:'beneficiario', category_id:C_ONIBUS  },
    {id:P_NETFLIX,  name:'Netflix',              type:'beneficiario', category_id:C_NETFLIX },
    {id:P_SPOTIFY,  name:'Spotify',              type:'beneficiario', category_id:C_SPOTIFY },
    {id:P_DISNEY,   name:'Disney+',              type:'beneficiario', category_id:C_LAZER   },
    {id:P_HBO,      name:'Max (HBO)',            type:'beneficiario', category_id:C_LAZER   },
    {id:P_AMAZON,   name:'Amazon',               type:'beneficiario', category_id:C_AMAZON  },
    {id:P_STEAM,    name:'Steam',                type:'beneficiario', category_id:C_GAMES   },
    {id:P_APPLE,    name:'Apple',                type:'beneficiario', category_id:C_SOFTWARE},
    {id:P_FARMCV,   name:'Farmácias CV',         type:'beneficiario', category_id:C_FARMACIA},
    {id:P_DROGA5,   name:'Droga Raia',           type:'beneficiario', category_id:C_FARMACIA},
    {id:P_UNIMED,   name:'Unimed',               type:'beneficiario', category_id:C_PLANO   },
    {id:P_EINSTEIN, name:'Hospital Einstein',    type:'beneficiario', category_id:C_MEDICO  },
    {id:P_ESCOLA1,  name:'Colégio Objetivo',     type:'beneficiario', category_id:C_ESCOLA  },
    {id:P_ALURA,    name:'Alura',                type:'beneficiario', category_id:C_CURSOS  },
    {id:P_UDEMY,    name:'Udemy',                type:'beneficiario', category_id:C_CURSOS  },
    {id:P_EMPRESA,  name:'Empresa ABC Ltda',     type:'fonte_pagadora',category_id:C_SALARIO},
    {id:P_EMPRESA2, name:'Cliente XYZ',          type:'fonte_pagadora',category_id:C_FREELA },
    {id:P_ZARA,     name:'Zara',                 type:'beneficiario', category_id:C_ROUPAS  },
    {id:P_RENNER,   name:'Renner',               type:'beneficiario', category_id:C_ROUPAS  },
    {id:P_SHOPTIME, name:'Shoptime / Americanas',type:'beneficiario', category_id:C_ELETRO  },
    {id:P_PET,      name:'Pet Center',           type:'beneficiario', category_id:C_PET_COMER},
    {id:P_VET,      name:'Clínica Vet Animal',   type:'beneficiario', category_id:C_PET_VET },
    {id:P_AIRBNB,   name:'Airbnb',               type:'beneficiario', category_id:C_HOTEL   },
    {id:P_LATAM,    name:'LATAM Airlines',       type:'beneficiario', category_id:C_PASSAGEM},
    {id:P_BOOKING,  name:'Booking.com',          type:'beneficiario', category_id:C_HOTEL   },
    {id:P_ENEL,     name:'Enel Energia',         type:'beneficiario', category_id:C_LUZ     },
    {id:P_SABESP,   name:'Sabesp',               type:'beneficiario', category_id:C_AGUA    },
    {id:P_CLARO,    name:'Claro Internet',       type:'beneficiario', category_id:C_INTERNET},
    {id:P_VIVO,     name:'Vivo Fibra',           type:'beneficiario', category_id:C_INTERNET},
    {id:P_CONSULT,  name:'Projeto Consultoria',  type:'fonte_pagadora',category_id:C_FREELA },
    {id:P_DESIGN,   name:'Studio Design Co.',    type:'fonte_pagadora',category_id:C_FREELA },
    {id:P_DEV_FELA, name:'DevFreela BR',         type:'fonte_pagadora',category_id:C_FREELA },
  ];

  /* ── Family Members ───────────────────────────────────────────────────── */
  const familyMembers = [
    { name:'Carlos',  role:'user',   color:'#2563eb', icon:'👨' },
    { name:'Mariana', role:'user',   color:'#db2777', icon:'👩' },
    { name:'Sofia',   role:'viewer', color:'#16a34a', icon:'👧' },
  ];

  /* ── Transactions ─────────────────────────────────────────────────────── */
  // Helper to create a transaction
  function tx(date, desc, amount, account_id, category_id, payee_id, opts = {}) {
    const status = opts.status || (Math.random() > 0.08 ? 'confirmed' : 'pending');
    return {
      id: uid(),
      date,
      description: desc,
      amount,
      account_id,
      category_id:  category_id || null,
      payee_id:     payee_id    || null,
      is_transfer:  opts.is_transfer  || false,
      is_card_payment: opts.is_card_payment || false,
      transfer_to_account_id: opts.transfer_to || null,
      status,
      currency: opts.currency || 'BRL',
      brl_amount: opts.brl_amount || null,
      memo: opts.memo || null,
    };
  }

  const transactions = [];
  // Salary — 18 months
  for (let i = 0; i < 18; i++) {
    transactions.push(tx(mth(i, 5),  'Salário ABC Ltda',         8500,  A_ITAU,    C_SALARIO, P_EMPRESA));
    transactions.push(tx(mth(i, 5),  'Vale Refeição',             900,  A_ITAU,    C_RENDA_EXTRA, P_EMPRESA));
  }
  // Freelance — irregular
  const freelanceDates = [mth(1,15),mth(2,22),mth(4,8),mth(6,18),mth(8,3),mth(10,25),mth(12,11),mth(14,7),mth(16,20)];
  const freelanceAmts  = [3200, 1800, 4500, 2100, 3800, 1500, 2700, 5000, 1900];
  const freelancePayers= [P_EMPRESA2, P_CONSULT, P_DESIGN, P_DEV_FELA, P_EMPRESA2, P_CONSULT, P_DESIGN, P_DEV_FELA, P_CONSULT];
  for (let i = 0; i < freelanceDates.length; i++) {
    transactions.push(tx(freelanceDates[i], 'Projeto freelance', freelanceAmts[i], A_NUBANK, C_FREELA, freelancePayers[i]));
  }
  // Fixed expenses — 18 months
  for (let i = 0; i < 18; i++) {
    transactions.push(tx(mth(i, 8),  'Aluguel',                 -2800, A_ITAU,    C_ALUGUEL,  null));
    transactions.push(tx(mth(i,10),  'Condomínio',               -480, A_ITAU,    C_CONDO,    null));
    transactions.push(tx(mth(i,15),  'Enel Energia',             -220, A_ITAU,    C_LUZ,      P_ENEL));
    transactions.push(tx(mth(i,18),  'Sabesp — Água e Esgoto',    -98, A_ITAU,    C_AGUA,     P_SABESP));
    transactions.push(tx(mth(i,20),  'Claro Internet 500mb',     -149, A_NUBANK,  C_INTERNET, P_CLARO,  {status:'confirmed'}));
    transactions.push(tx(mth(i, 5),  'Unimed — Plano de Saúde',  -890, A_ITAU,    C_PLANO,    P_UNIMED));
    transactions.push(tx(mth(i, 7),  'Netflix Premium',           -55, A_VISA_NU, C_NETFLIX,  P_NETFLIX,{status:'confirmed'}));
    transactions.push(tx(mth(i, 7),  'Spotify Family',            -27, A_VISA_NU, C_SPOTIFY,  P_SPOTIFY,{status:'confirmed'}));
    transactions.push(tx(mth(i, 7),  'Disney+ Anual',             -37, A_VISA_NU, C_LAZER,    P_DISNEY, {status:'confirmed'}));
    transactions.push(tx(mth(i, 8),  'Amazon Prime',              -22, A_VISA_NU, C_AMAZON,   P_AMAZON, {status:'confirmed'}));
  }
  // Academia — 15 months
  for (let i = 0; i < 15; i++) {
    transactions.push(tx(mth(i, 5), 'Smart Fit — Mensalidade', -119, A_NUBANK, C_ACADEMIA, null));
  }
  // Adobe CC — 12 months
  for (let i = 0; i < 12; i++) {
    transactions.push(tx(mth(i,12), 'Adobe Creative Cloud', -264, A_VISA_NU, C_ADOBE, null));
  }
  // Apple Services — 14 months
  for (let i = 0; i < 14; i++) {
    transactions.push(tx(mth(i,12), 'Apple One', -65, A_VISA_NU, C_SOFTWARE, P_APPLE));
  }

  // ── Supermercado — ~3x/mês x 18 meses
  const superPayees = [P_EXTRA, P_CARREFOUR, P_ATACADAO, P_HORTIFRUTI];
  const superAmts   = [-420,-380,-290,-340,-310,-260,-450,-395,-375,-280,-330,-410,-290,-360,-320,-270,-440,-385];
  for (let i = 0; i < 18; i++) {
    transactions.push(tx(mth(i, 4), 'Compras semana — supermercado', superAmts[i % superAmts.length], A_VISA_NU, C_MERCADO, superPayees[i%4]));
    transactions.push(tx(mth(i,14), 'Compras quinzena', -(220 + (i%3)*30), A_VISA_NU, C_MERCADO, superPayees[(i+1)%4]));
    transactions.push(tx(mth(i,26), 'Hortifruti / feirinha', -(80 + (i%5)*15), A_DINHEIRO, C_MERCADO, P_HORTIFRUTI));
  }

  // ── Restaurante — ~4x/mês x 18 meses
  const restPayees = [P_OUTBACK, P_COCO_BAM, P_SUSHI, P_MCDONALD];
  for (let i = 0; i < 18; i++) {
    for (let r = 0; r < 4; r++) {
      const day = [6, 13, 20, 27][r];
      const baseAmts = [280, 340, 190, 95];
      transactions.push(tx(mth(i, day), `Almoço / Jantar — ${['Outback','Coco Bambu','Sushi Royal',"McDonald's"][r]}`, -(baseAmts[r] + (i%4)*10), A_VISA_NU, C_REST, restPayees[r]));
    }
  }

  // ── Delivery — ~6x/mês x 18 meses
  for (let i = 0; i < 18; i++) {
    for (let d_ = 0; d_ < 6; d_++) {
      const day = [3, 8, 12, 17, 22, 27][d_];
      const amt = -(55 + Math.floor(Math.random() * 60));
      const p   = d_ % 2 === 0 ? P_IFOOD : P_RAPPI;
      transactions.push(tx(mth(i, day), `Delivery — ${d_%2===0?'iFood':'Rappi'}`, amt, A_VISA_NU, C_DELIVERY, p));
    }
  }

  // ── Padaria/Café — ~8x/mês x 18 meses
  for (let i = 0; i < 18; i++) {
    for (let c_ = 0; c_ < 8; c_++) {
      const day = [2, 4, 7, 11, 15, 19, 23, 28][c_];
      transactions.push(tx(mth(i, day), 'Café da manhã / padaria', -(18 + (c_%3)*8), A_DINHEIRO, C_PADARIA, null));
    }
  }

  // ── Combustível — ~3x/mês x 16 meses
  const postosAmts = [-180,-210,-195,-185,-220,-170,-200,-190,-215,-175,-205,-195,-180,-210,-185,-200];
  for (let i = 0; i < 16; i++) {
    const postos = [P_SHELL, P_IPIRANGA, P_POSTO_BR];
    for (let j = 0; j < 3; j++) {
      transactions.push(tx(mth(i, [5, 15, 25][j]), 'Combustível — abastecimento', postosAmts[(i*3+j) % postosAmts.length], A_ITAU, C_COMB, postos[j]));
    }
  }

  // ── Uber — ~8x/mês x 18 meses
  for (let i = 0; i < 18; i++) {
    for (let u = 0; u < 8; u++) {
      const day = [2, 5, 8, 12, 15, 19, 23, 27][u];
      const amt = -(15 + Math.floor(Math.random() * 35));
      const p   = u % 5 === 0 ? P_99 : P_UBER;
      transactions.push(tx(mth(i, day), `Corrida ${p===P_UBER?'Uber':'99'}`, amt, A_NUBANK, C_UBER, p));
    }
  }

  // ── Ônibus / VT — ~20x/mês x 18 meses
  for (let i = 0; i < 18; i++) {
    for (let b = 0; b < 5; b++) {
      transactions.push(tx(mth(i, [3,8,13,18,23][b]), 'Recarga VT / Metrô', -(40 + (b%3)*20), A_NUBANK, C_ONIBUS, P_BUS));
    }
  }

  // ── Roupas — ~2x/mês x 14 meses
  for (let i = 0; i < 14; i++) {
    const roupa = [P_ZARA, P_RENNER][i%2];
    const amt1  = -(180 + (i%5)*40);
    const amt2  = -(120 + (i%4)*25);
    transactions.push(tx(mth(i, 10), `Roupas — ${i%2===0?'Zara':'Renner'}`, amt1, A_VISA_NU, C_ROUPAS, roupa));
    transactions.push(tx(mth(i, 22), 'Roupas / calçados', amt2, A_MASTER, C_ROUPAS, roupa));
  }

  // ── Eletrônicos / Casa — ~1x/2meses
  const eletroTx = [
    [mth(1,15),  'Fone JBL Tune 510 BT',         -289, A_MASTER,  C_ELETRO,  P_SHOPTIME],
    [mth(3, 8),  'Ventilador Mondial',            -199, A_VISA_NU, C_CASA,    P_AMAZON  ],
    [mth(5,20),  'Teclado mecânico',              -320, A_MASTER,  C_ELETRO,  P_SHOPTIME],
    [mth(7,12),  'Kit organização cozinha',       -145, A_VISA_NU, C_CASA,    P_AMAZON  ],
    [mth(9, 5),  'Monitor 24" LG',                -940, A_ITAU,    C_ELETRO,  P_SHOPTIME],
    [mth(11,18), 'Cadeira gamer',                 -680, A_MASTER,  C_CASA,    P_SHOPTIME],
    [mth(13,10), 'SSD Samsung 1TB',               -420, A_MASTER,  C_ELETRO,  P_AMAZON  ],
    [mth(15, 8), 'Suporte para notebook',          -89, A_VISA_NU, C_CASA,    P_AMAZON  ],
    [mth(17, 3), 'Câmera GoPro Hero 11',         -1890, A_ITAU,    C_ELETRO,  P_SHOPTIME],
  ];
  for (const [date, desc, amt, acc, cat, pay] of eletroTx) {
    transactions.push(tx(date, desc, amt, acc, cat, pay));
  }

  // ── Saúde ──
  const saudeTx = [
    [mth(1,10), 'Farmácia CV — remédios',   -85, A_NUBANK, C_FARMACIA, P_FARMCV],
    [mth(2,18), 'Consulta dermatologista', -280, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(3, 5), 'Droga Raia — vitaminas',   -65, A_NUBANK, C_FARMACIA, P_DROGA5],
    [mth(4,22), 'Exames laboratoriais',    -195, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(5,11), 'Farmácia — antibiótico',   -45, A_NUBANK, C_FARMACIA, P_FARMCV],
    [mth(6,15), 'Consulta ortopedista',    -350, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(7, 8), 'Droga Raia — suplementos', -98, A_NUBANK, C_FARMACIA, P_DROGA5],
    [mth(8,20), 'Consulta ginecologista',  -280, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(9, 3), 'Farmácia CV — rotina',     -62, A_NUBANK, C_FARMACIA, P_FARMCV],
    [mth(10,16),'Exames de rotina',         -220, A_ITAU,  C_MEDICO,   P_EINSTEIN],
    [mth(11,25),'Droga Raia — remédios',    -78, A_NUBANK, C_FARMACIA, P_DROGA5],
    [mth(12, 9),'Consulta psicológica',    -200, A_ITAU,   C_MEDICO,   null],
    [mth(13,14),'Farmácia — prescrição',    -55, A_NUBANK, C_FARMACIA, P_FARMCV],
    [mth(14,21),'Exames cardio',           -380, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(15, 7),'Droga Raia — vitamina D',  -42, A_NUBANK, C_FARMACIA, P_DROGA5],
    [mth(16,18),'Consulta dermatologista', -280, A_ITAU,   C_MEDICO,   P_EINSTEIN],
    [mth(17,12),'Farmácia CV — mensal',     -72, A_NUBANK, C_FARMACIA, P_FARMCV],
  ];
  for (const [date, desc, amt, acc, cat, pay] of saudeTx) {
    transactions.push(tx(date, desc, amt, acc, cat, pay));
  }

  // ── Educação ──
  const educTx = [
    [mth(1,10), 'Alura — plano anual',           -1200, A_VISA_NU, C_CURSOS,  P_ALURA  ],
    [mth(2,18), 'Udemy — curso Python avançado',   -48, A_VISA_NU, C_CURSOS,  P_UDEMY  ],
    [mth(3,22), 'Colégio Objetivo — mensalidade', -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(4,22), 'Colégio Objetivo — mensalidade', -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(5,22), 'Colégio Objetivo — mensalidade', -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(6,22), 'Colégio Objetivo — mensalidade', -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(7,22), 'Colégio Objetivo — mensalidade', -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(4, 5), 'Udemy — Machine Learning',         -35, A_VISA_NU, C_CURSOS,  P_UDEMY  ],
    [mth(6,12), 'Material escolar — início de ano',-280, A_ITAU,    C_MATERIAL,null     ],
    [mth(8, 5), 'Udemy — React Native',             -29, A_VISA_NU, C_CURSOS,  P_UDEMY  ],
    [mth(9,22), 'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(10,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(11,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(12,15),'Alura — renovação plano',        -1200, A_VISA_NU, C_CURSOS,  P_ALURA  ],
    [mth(13,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(14,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(15, 8),'Udemy — AWS Cloud',                -49, A_VISA_NU, C_CURSOS,  P_UDEMY  ],
    [mth(16,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
    [mth(17,22),'Colégio Objetivo — mensalidade',  -980, A_ITAU,    C_ESCOLA,  P_ESCOLA1],
  ];
  for (const [date, desc, amt, acc, cat, pay] of educTx) {
    transactions.push(tx(date, desc, amt, acc, cat, pay));
  }

  // ── Pet ──
  for (let i = 0; i < 18; i++) {
    transactions.push(tx(mth(i,10), 'Ração / petiscos — Bob', -(120+(i%3)*20), A_NUBANK, C_PET_COMER, P_PET));
    if (i % 3 === 0) transactions.push(tx(mth(i,20), 'Consulta veterinária', -220, A_ITAU, C_PET_VET, P_VET));
    if (i % 6 === 0) transactions.push(tx(mth(i,20), 'Vacinas e vermífugo', -180, A_ITAU, C_PET_VET, P_VET));
  }

  // ── Viagens ──
  const viagensTx = [
    [mth(2,10),  'LATAM — voo SP→RJ',              -580, A_ITAU,    C_PASSAGEM, P_LATAM  ],
    [mth(2,12),  'Airbnb Rio de Janeiro',           -920, A_VISA_NU, C_HOTEL,    P_AIRBNB ],
    [mth(2,12),  'Passeio Cristo Redentor',          -80, A_DINHEIRO,C_PASSEIO,  null     ],
    [mth(2,13),  'Passeio Pão de Açúcar',            -95, A_DINHEIRO,C_PASSEIO,  null     ],
    [mth(8,15),  'LATAM — voo SP→Floripa',          -720, A_ITAU,    C_PASSAGEM, P_LATAM  ],
    [mth(8,17),  'Booking — Pousada Jurerê',       -1400, A_MASTER,  C_HOTEL,    P_BOOKING],
    [mth(8,17),  'Passeio ilha',                    -120, A_DINHEIRO,C_PASSEIO,  null     ],
    [mth(13,5),  'LATAM — voo SP→Natal',            -840, A_ITAU,    C_PASSAGEM, P_LATAM  ],
    [mth(13,7),  'Airbnb Natal (7 noites)',        -2100, A_VISA_NU, C_HOTEL,    P_AIRBNB ],
    [mth(13,7),  'Passeio dunas',                   -180, A_DINHEIRO,C_PASSEIO,  null     ],
    [mth(13,9),  'Passeio buggy',                   -220, A_DINHEIRO,C_PASSEIO,  null     ],
  ];
  for (const [date, desc, amt, acc, cat, pay] of viagensTx) {
    transactions.push(tx(date, desc, amt, acc, cat, pay));
  }

  // ── Games e lazer ──
  for (let i = 0; i < 14; i++) {
    if (i % 3 === 0) transactions.push(tx(mth(i,15), 'Steam — jogo novo', -(50+(i%4)*15), A_VISA_NU, C_GAMES, P_STEAM));
    if (i % 4 === 0) transactions.push(tx(mth(i,20), 'Cinema com família', -(80+(i%3)*10), A_NUBANK, C_CINEMA, null));
  }

  // ── Transferências entre contas ──
  for (let i = 0; i < 12; i++) {
    transactions.push(tx(mth(i,3), `Transferência Itaú → Nubank`, -2000, A_ITAU, C_TRANSF, null, {is_transfer:true, transfer_to:A_NUBANK}));
    transactions.push(tx(mth(i,3), `Transferência Itaú → Nubank`,  2000, A_NUBANK, C_TRANSF, null, {is_transfer:true}));
    if (i % 3 === 0) {
      transactions.push(tx(mth(i,28), 'Poupança — depósito mensal', -1500, A_ITAU, C_RESERVA, null, {is_transfer:true, transfer_to:A_POUPANCA}));
      transactions.push(tx(mth(i,28), 'Poupança — depósito mensal',  1500, A_POUPANCA, C_RESERVA, null, {is_transfer:true}));
    }
  }

  // ── Estacionamento — ~4x/mês x 14 meses ──
  for (let i = 0; i < 14; i++) {
    for (let e = 0; e < 4; e++) {
      transactions.push(tx(mth(i, [5,12,19,26][e]), 'Estacionamento', -(12+(e%3)*5), A_DINHEIRO, C_ESTACION, null));
    }
  }

  // ── Manutenção casa ──
  const manutTx = [
    [mth(3,10),  'Encanador — vazamento',          -320, A_ITAU,  C_MANUT, null],
    [mth(6,15),  'Pintura sala de estar',          -1800, A_ITAU,  C_MANUT, null],
    [mth(9,20),  'Eletricista — tomadas',            -280, A_ITAU, C_MANUT, null],
    [mth(12,5),  'Conserto ar-condicionado',         -420, A_ITAU, C_MANUT, null],
    [mth(15,18), 'Impermeabilização banheiro',       -980, A_ITAU, C_MANUT, null],
  ];
  for (const [date, desc, amt, acc, cat, pay] of manutTx) {
    transactions.push(tx(date, desc, amt, acc, cat, pay));
  }

  // ── Renda investimentos ──
  for (let i = 0; i < 18; i++) {
    transactions.push(tx(mth(i,15), 'Rendimento CDB/Selic', +(180+(i%6)*22), A_POUPANCA, C_REND_INV, null));
    if (i % 2 === 0) transactions.push(tx(mth(i,20), 'Dividendos ações', +(320+(i%4)*55), A_ITAU, C_DIVIDENDO, null));
  }

  // ── Pagamentos de cartão ──
  for (let i = 0; i < 18; i++) {
    // Nubank card payment
    const nuAmt = 1800 + (i%8)*150;
    transactions.push(tx(mth(i,10), 'Pgto. Nubank Roxinho', -nuAmt, A_ITAU, C_CARTAO_PG, null, {is_card_payment:true, transfer_to:A_VISA_NU}));
    transactions.push(tx(mth(i,10), 'Pgto. Nubank Roxinho',  nuAmt, A_VISA_NU, C_CARTAO_PG, null, {is_card_payment:true}));
    // Itaú master card payment (less frequent)
    if (i % 2 === 0) {
      const maAmt = 2200 + (i%6)*200;
      transactions.push(tx(mth(i,15), 'Pgto. Itaú Mastercard', -maAmt, A_ITAU, C_CARTAO_PG, null, {is_card_payment:true, transfer_to:A_MASTER}));
      transactions.push(tx(mth(i,15), 'Pgto. Itaú Mastercard',  maAmt, A_MASTER, C_CARTAO_PG, null, {is_card_payment:true}));
    }
  }

  /* ── Scheduled Transactions ───────────────────────────────────────────── */
  function sc(desc, amount, account_id, category_id, payee_id, frequency, start_date, opts={}) {
    return { id:uid(), description:desc, amount, account_id, category_id, payee_id,
             frequency, start_date, status:'active', type: opts.type||'expense',
             auto_confirm: opts.auto_confirm !== false, memo: opts.memo||null };
  }
  const scheduled = [
    sc('Aluguel',              -2800, A_ITAU,    C_ALUGUEL,  null,      'monthly', mth(12,8),  {type:'expense'}),
    sc('Condomínio',            -480, A_ITAU,    C_CONDO,    null,      'monthly', mth(12,10), {type:'expense'}),
    sc('Enel Energia',          -220, A_ITAU,    C_LUZ,      P_ENEL,    'monthly', mth(12,15), {type:'expense'}),
    sc('Sabesp — Água',          -98, A_ITAU,    C_AGUA,     P_SABESP,  'monthly', mth(12,18), {type:'expense'}),
    sc('Claro Internet',        -149, A_NUBANK,  C_INTERNET, P_CLARO,   'monthly', mth(12,20), {type:'expense'}),
    sc('Unimed Saúde',          -890, A_ITAU,    C_PLANO,    P_UNIMED,  'monthly', mth(12, 5), {type:'expense'}),
    sc('Netflix Premium',        -55, A_VISA_NU, C_NETFLIX,  P_NETFLIX, 'monthly', mth(12, 7), {type:'expense'}),
    sc('Spotify Family',         -27, A_VISA_NU, C_SPOTIFY,  P_SPOTIFY, 'monthly', mth(12, 7), {type:'expense'}),
    sc('Amazon Prime',           -22, A_VISA_NU, C_AMAZON,   P_AMAZON,  'monthly', mth(12, 8), {type:'expense'}),
    sc('Smart Fit Academia',    -119, A_NUBANK,  C_ACADEMIA, null,      'monthly', mth(12, 5), {type:'expense'}),
    sc('Salário ABC Ltda',      8500, A_ITAU,    C_SALARIO,  P_EMPRESA, 'monthly', mth(12, 5), {type:'income'}),
    sc('Vale Refeição',          900, A_ITAU,    C_RENDA_EXTRA, P_EMPRESA,'monthly',mth(12,5), {type:'income'}),
    sc('Colégio Objetivo',      -980, A_ITAU,    C_ESCOLA,   P_ESCOLA1, 'monthly', mth(12,22), {type:'expense'}),
    sc('Alura Plano Anual',    -1200, A_VISA_NU, C_CURSOS,   P_ALURA,   'annual',  mth(12,10), {type:'expense'}),
    sc('Poupança — reserva',   -1500, A_ITAU,    C_RESERVA,  null,      'monthly', mth(12,28), {type:'transfer', auto_confirm:false}),
  ];

  /* ── Budgets ──────────────────────────────────────────────────────────── */
  const thisMonth = `${Y}-${String(M+1).padStart(2,'0')}`;
  const budgets = [
    {id:uid(), month:thisMonth, category_id:C_ALIM,    amount:1500, auto_reset:true,  notes:'Alimentação total'},
    {id:uid(), month:thisMonth, category_id:C_MERCADO, amount: 900, auto_reset:true,  notes:'Supermercado'},
    {id:uid(), month:thisMonth, category_id:C_REST,    amount: 350, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_DELIVERY,amount: 250, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_TRANSP,  amount: 700, auto_reset:true,  notes:'Total transporte'},
    {id:uid(), month:thisMonth, category_id:C_COMB,    amount: 300, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_LAZER,   amount: 400, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_SAUDE,   amount: 600, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_EDUC,    amount:2200, auto_reset:true,  notes:'Escola + cursos'},
    {id:uid(), month:thisMonth, category_id:C_COMP,    amount: 500, auto_reset:true,  notes:null},
    {id:uid(), month:thisMonth, category_id:C_MORAD,   amount:4000, auto_reset:true,  notes:'Moradia total'},
    {id:uid(), month:thisMonth, category_id:C_PET,     amount: 200, auto_reset:true,  notes:'Bob'},
  ];

  /* ── Dreams ───────────────────────────────────────────────────────────── */
  const dreams = [
    { id:uid(), title:'Carro Novo — Corolla', type:'automovel', target_amount:120000, current_amount:28000,
      deadline:`${Y+3}-06-01`, status:'active', priority:1, notes:'Toyota Corolla XEi 2027', icon:'🚗' },
    { id:uid(), title:'Apartamento Próprio', type:'imovel', target_amount:380000, current_amount:62000,
      deadline:`${Y+6}-01-01`, status:'active', priority:2, notes:'3 quartos, até 500k', icon:'🏠' },
    { id:uid(), title:'Viagem Disney Orlando', type:'viagem', target_amount:35000, current_amount:8500,
      deadline:`${Y+2}-07-01`, status:'active', priority:3, notes:'Família toda — 10 dias', icon:'✈️' },
    { id:uid(), title:'Reserva de Emergência', type:'outro', target_amount:60000, current_amount:22000,
      deadline:`${Y+2}-12-01`, status:'active', priority:4, notes:'6 meses de despesas', icon:'🏦' },
  ];

  /* ── Price Items & Stores ─────────────────────────────────────────────── */
  const priceCatFood = uid(), priceCatHig = uid(), priceCatBev = uid();
  const priceItems = [
    {id:uid(), name:'Arroz Branco 5kg — Camil',          description:'Arroz branco tipo 1',   unit:'kg',  category_id:priceCatFood},
    {id:uid(), name:'Feijão Carioca 1kg — Camil',        description:'Feijão tipo 1',         unit:'kg',  category_id:priceCatFood},
    {id:uid(), name:'Azeite Extra Virgem 500ml',         description:'Azeite Gallo',          unit:'ml',  category_id:priceCatFood},
    {id:uid(), name:'Leite Integral 1L — Parmalat',      description:'Caixa longa vida',      unit:'L',   category_id:priceCatBev },
    {id:uid(), name:'Refrigerante Coca 2L',              description:'Garrafa PET',           unit:'L',   category_id:priceCatBev },
    {id:uid(), name:'Shampoo Pantene 400ml',             description:'Hidratação',            unit:'ml',  category_id:priceCatHig },
    {id:uid(), name:'Papel Higiênico 16un — Neve',       description:'Folha dupla',           unit:'un',  category_id:priceCatHig },
    {id:uid(), name:'Detergente Ypê 500ml',              description:'Neutro',                unit:'ml',  category_id:priceCatHig },
    {id:uid(), name:'Gasolina Comum',                    description:'Por litro',             unit:'L',   category_id:null        },
    {id:uid(), name:'Gasolina Aditivada',                description:'Por litro',             unit:'L',   category_id:null        },
  ];
  const priceStores = [
    {id:uid(), name:'Extra — Av. Paulista',   address:'Av. Paulista, 1000'},
    {id:uid(), name:'Carrefour — Tatuapé',    address:'Rua Tatuapé, 500'},
    {id:uid(), name:'Atacadão — Santo André', address:'Av. Industrial, 100'},
    {id:uid(), name:'Posto Shell — Rebouças', address:'Av. Rebouças, 300'},
  ];
  const priceHistory = [];
  // Generate some price history entries
  const baseStore = priceStores[0].id;
  const items = priceItems.slice(0,5);
  const basePrices = [25.90, 8.99, 32.90, 6.49, 12.90];
  for (let m_ = 0; m_ < 8; m_++) {
    for (let idx_ = 0; idx_ < items.length; idx_++) {
      const variation = 1 + (Math.random() - 0.5) * 0.15;
      priceHistory.push({
        id:      uid(),
        item_id: items[idx_].id,
        store_id: m_ % 2 === 0 ? baseStore : priceStores[1].id,
        price:   Math.round(basePrices[idx_] * variation * 100) / 100,
        date:    mth(m_, 10 + m_%5),
        qty:     1,
      });
    }
  }

  /* ── Grocery List ─────────────────────────────────────────────────────── */
  const groceries = {
    list: { id: uid(), name: 'Compras semana — modelo', type: 'generic', status: 'active' },
    items: [
      {id:uid(), list_id:'__replace__', name:'Arroz Camil 5kg',        quantity:1, unit:'pct', checked:false, estimated_price:25.90},
      {id:uid(), list_id:'__replace__', name:'Feijão carioca 1kg',     quantity:2, unit:'pct', checked:false, estimated_price:8.99},
      {id:uid(), list_id:'__replace__', name:'Frango inteiro',         quantity:2, unit:'kg',  checked:false, estimated_price:18.90},
      {id:uid(), list_id:'__replace__', name:'Ovos (bandeja 30)',       quantity:1, unit:'un',  checked:false, estimated_price:28.50},
      {id:uid(), list_id:'__replace__', name:'Leite integral 1L',      quantity:6, unit:'un',  checked:false, estimated_price:6.49},
      {id:uid(), list_id:'__replace__', name:'Pão de forma integral',  quantity:2, unit:'pct', checked:false, estimated_price:9.90},
      {id:uid(), list_id:'__replace__', name:'Azeite extra virgem',    quantity:1, unit:'un',  checked:false, estimated_price:32.90},
      {id:uid(), list_id:'__replace__', name:'Tomate',                 quantity:1, unit:'kg',  checked:false, estimated_price:7.90},
      {id:uid(), list_id:'__replace__', name:'Alface crespa',          quantity:2, unit:'un',  checked:false, estimated_price:3.50},
      {id:uid(), list_id:'__replace__', name:'Detergente Ypê 500ml',   quantity:3, unit:'un',  checked:false, estimated_price:4.50},
      {id:uid(), list_id:'__replace__', name:'Shampoo Pantene',        quantity:1, unit:'un',  checked:false, estimated_price:19.90},
      {id:uid(), list_id:'__replace__', name:'Papel higiênico 16un',   quantity:1, unit:'pct', checked:true,  estimated_price:32.90},
    ],
  };

  /* ── Debts ────────────────────────────────────────────────────────────── */
  const debts = [
    { id:uid(), description:'Financiamento Carro (Toyota Corolla)', creditor:'Toyota Financial Services',
      original_amount:65000, current_balance:42000, interest_rate:1.2, index_type:'prefixado',
      start_date:mth(14,1), due_date:mth(-36,1), installment_count:60, installments_paid:14,
      installment_amount:1340, status:'active', notes:'Parcelas vencem todo dia 1' },
    { id:uid(), description:'Empréstimo pessoal CAIXA', creditor:'Caixa Econômica Federal',
      original_amount:15000, current_balance:7800, interest_rate:2.1, index_type:'prefixado',
      start_date:mth(8,15), due_date:mth(-16,15), installment_count:24, installments_paid:8,
      installment_amount:780, status:'active', notes:null },
  ];

  return {
    accountGroups,
    accounts,
    categories: cats,
    payees,
    familyMembers,
    transactions,
    scheduled,
    budgets,
    dreams,
    priceItems,
    priceStores,
    priceHistory,
    groceries,
    debts,
    _meta: {
      txCount:     transactions.length,
      catCount:    cats.length,
      payeeCount:  payees.length,
      schedCount:  scheduled.length,
    },
  };
}

window.generateDemoData = generateDemoData;
