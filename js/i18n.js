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

  // ── Common UI labels ─────────────────────────────────────────────────────
  'ui.save':          {pt:'Salvar',         en:'Save',           es:'Guardar',          fr:'Enregistrer'},
  'ui.cancel':        {pt:'Cancelar',       en:'Cancel',         es:'Cancelar',         fr:'Annuler'},
  'ui.close':         {pt:'Fechar',         en:'Close',          es:'Cerrar',           fr:'Fermer'},
  'ui.add':           {pt:'Adicionar',      en:'Add',            es:'Agregar',          fr:'Ajouter'},
  'ui.edit':          {pt:'Editar',         en:'Edit',           es:'Editar',           fr:'Modifier'},
  'ui.delete':        {pt:'Excluir',        en:'Delete',         es:'Eliminar',         fr:'Supprimer'},
  'ui.confirm':       {pt:'Confirmar',      en:'Confirm',        es:'Confirmar',        fr:'Confirmer'},
  'ui.search':        {pt:'Buscar',         en:'Search',         es:'Buscar',           fr:'Rechercher'},
  'ui.filter':        {pt:'Filtrar',        en:'Filter',         es:'Filtrar',          fr:'Filtrer'},
  'ui.export':        {pt:'Exportar',       en:'Export',         es:'Exportar',         fr:'Exporter'},
  'ui.import':        {pt:'Importar',       en:'Import',         es:'Importar',         fr:'Importer'},
  'ui.back':          {pt:'Voltar',         en:'Back',           es:'Volver',           fr:'Retour'},
  'ui.new':           {pt:'Novo',           en:'New',            es:'Nuevo',            fr:'Nouveau'},
  'ui.new_f':         {pt:'Nova',           en:'New',            es:'Nueva',            fr:'Nouvelle'},
  'ui.loading':       {pt:'Carregando…',   en:'Loading…',       es:'Cargando…',        fr:'Chargement…'},
  'ui.yes':           {pt:'Sim',            en:'Yes',            es:'Sí',               fr:'Oui'},
  'ui.no':            {pt:'Não',            en:'No',             es:'No',               fr:'Non'},
  'ui.total':         {pt:'Total',          en:'Total',          es:'Total',            fr:'Total'},
  'ui.all':           {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'ui.all_f':         {pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'ui.none':          {pt:'Nenhum',         en:'None',           es:'Ninguno',          fr:'Aucun'},
  'ui.optional':      {pt:'Opcional',       en:'Optional',       es:'Opcional',         fr:'Optionnel'},
  'ui.required':      {pt:'Obrigatório',    en:'Required',       es:'Obligatorio',      fr:'Obligatoire'},
  'ui.today':         {pt:'Hoje',           en:'Today',          es:'Hoy',              fr:"Aujourd'hui"},
  'ui.month':         {pt:'Mês',            en:'Month',          es:'Mes',              fr:'Mois'},
  'ui.year':          {pt:'Ano',            en:'Year',           es:'Año',              fr:'Année'},
  'ui.date':          {pt:'Data',           en:'Date',           es:'Fecha',            fr:'Date'},
  'ui.name':          {pt:'Nome',           en:'Name',           es:'Nombre',           fr:'Nom'},
  'ui.description':   {pt:'Descrição',      en:'Description',    es:'Descripción',      fr:'Description'},
  'ui.amount':        {pt:'Valor',          en:'Amount',         es:'Monto',            fr:'Montant'},
  'ui.balance':       {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'ui.actions':       {pt:'Ações',          en:'Actions',        es:'Acciones',         fr:'Actions'},
  'ui.status':        {pt:'Status',         en:'Status',         es:'Estado',           fr:'Statut'},
  'ui.type':          {pt:'Tipo',           en:'Type',           es:'Tipo',             fr:'Type'},
  'ui.category':      {pt:'Categoria',      en:'Category',       es:'Categoría',        fr:'Catégorie'},
  'ui.account':       {pt:'Conta',          en:'Account',        es:'Cuenta',           fr:'Compte'},
  'ui.payee':         {pt:'Beneficiário',   en:'Payee',          es:'Beneficiario',     fr:'Bénéficiaire'},
  'ui.notes':         {pt:'Observações',    en:'Notes',          es:'Notas',            fr:'Notes'},
  'ui.currency':      {pt:'Moeda',          en:'Currency',       es:'Moneda',           fr:'Devise'},
  'ui.manage':        {pt:'Gerenciar',      en:'Manage',         es:'Gestionar',        fr:'Gérer'},
  'ui.details':       {pt:'Detalhes',       en:'Details',        es:'Detalles',         fr:'Détails'},
  'ui.select':        {pt:'Selecione',      en:'Select',         es:'Seleccione',       fr:'Sélectionner'},
  'ui.period':        {pt:'Período',        en:'Period',         es:'Período',          fr:'Période'},
  'ui.preview':       {pt:'Prévia',         en:'Preview',        es:'Vista previa',     fr:'Aperçu'},
  'ui.generate':      {pt:'Gerar',          en:'Generate',       es:'Generar',          fr:'Générer'},
  'ui.send':          {pt:'Enviar',         en:'Send',           es:'Enviar',           fr:'Envoyer'},
  'ui.view_all':      {pt:'Ver tudo',       en:'View all',       es:'Ver todo',         fr:'Voir tout'},

  // ── Transactions ──────────────────────────────────────────────────────────
  'tx.title':         {pt:'Lançamentos',    en:'Transactions',   es:'Transacciones',    fr:'Transactions'},
  'tx.income':        {pt:'Receita',        en:'Income',         es:'Ingreso',          fr:'Revenu'},
  'tx.expense':       {pt:'Despesa',        en:'Expense',        es:'Gasto',            fr:'Dépense'},
  'tx.transfer':      {pt:'Transferência',  en:'Transfer',       es:'Transferencia',    fr:'Virement'},
  'tx.all_months':    {pt:'Todos os meses', en:'All months',     es:'Todos los meses',  fr:'Tous les mois'},
  'tx.all_accounts':  {pt:'Todas as contas',en:'All accounts',   es:'Todas las cuentas',fr:'Tous les comptes'},
  'tx.all_categories':{pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'tx.all_payees':    {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'tx.all_types':     {pt:'Todos os tipos', en:'All types',      es:'Todos los tipos',  fr:'Tous les types'},
  'tx.confirmed':     {pt:'Confirmadas',    en:'Confirmed',      es:'Confirmadas',      fr:'Confirmées'},
  'tx.pending':       {pt:'Pendentes',      en:'Pending',        es:'Pendientes',       fr:'En attente'},
  'tx.empty':         {pt:'Nenhuma transação encontrada',en:'No transactions found',es:'No se encontraron transacciones',fr:'Aucune transaction trouvée'},
  'tx.col_date':      {pt:'Data ⇅',         en:'Date ⇅',         es:'Fecha ⇅',          fr:'Date ⇅'},
  'tx.col_desc':      {pt:'Descrição',      en:'Description',    es:'Descripción',      fr:'Description'},
  'tx.col_account':   {pt:'Conta',          en:'Account',        es:'Cuenta',           fr:'Compte'},
  'tx.col_amount':    {pt:'Valor',          en:'Amount',         es:'Monto',            fr:'Montant'},
  'tx.col_actions':   {pt:'Ações',          en:'Actions',        es:'Acciones',         fr:'Actions'},
  'tx.prev_page':     {pt:'‹ Anterior',     en:'‹ Previous',     es:'‹ Anterior',       fr:'‹ Précédent'},
  'tx.next_page':     {pt:'Próxima ›',      en:'Next ›',         es:'Siguiente ›',      fr:'Suivant ›'},
  'tx.new':           {pt:'+ Nova Transação',en:'+ New Transaction',es:'+ Nueva transacción',fr:'+ Nouvelle transaction'},
  'tx.income_tab':    {pt:'+ Receita',      en:'+ Income',       es:'+ Ingreso',        fr:'+ Revenu'},
  'tx.expense_tab':   {pt:'+ Despesa',      en:'+ Expense',      es:'+ Gasto',          fr:'+ Dépense'},
  'tx.transfer_tab':  {pt:'+ Transferência',en:'+ Transfer',     es:'+ Transferencia',  fr:'+ Virement'},

  // ── Accounts ──────────────────────────────────────────────────────────────
  'acct.title':       {pt:'Contas',         en:'Accounts',       es:'Cuentas',          fr:'Comptes'},
  'acct.new':         {pt:'Nova Conta',     en:'New Account',    es:'Nueva cuenta',     fr:'Nouveau compte'},
  'acct.balance':     {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'acct.empty':       {pt:'Nenhuma conta encontrada',en:'No accounts found',es:'No se encontraron cuentas',fr:'Aucun compte trouvé'},
  'acct.no_group':    {pt:'Sem grupo',      en:'No group',       es:'Sin grupo',        fr:'Sans groupe'},
  'acct.total':       {pt:'Total:',         en:'Total:',         es:'Total:',           fr:'Total:'},
  'acct.group_new':   {pt:'Novo Grupo',     en:'New Group',      es:'Nuevo grupo',      fr:'Nouveau groupe'},

  // ── Dashboard ─────────────────────────────────────────────────────────────
  'dash.income':      {pt:'Receitas',       en:'Income',         es:'Ingresos',         fr:'Revenus'},
  'dash.expense':     {pt:'Despesas',       en:'Expenses',       es:'Gastos',           fr:'Dépenses'},
  'dash.balance':     {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'dash.all_accounts':{pt:'Todas as contas',en:'All accounts',   es:'Todas las cuentas',fr:'Tous les comptes'},
  'dash.all_members': {pt:'Família (todos)',en:'Family (all)',   es:'Familia (todos)',   fr:'Famille (tous)'},
  'dash.recent_tx':   {pt:'Lançamentos Recentes',en:'Recent Transactions',es:'Transacciones recientes',fr:'Transactions récentes'},
  'dash.fav_cats':    {pt:'Categorias Favoritas',en:'Favorite Categories',es:'Categorías favoritas',fr:'Catégories favorites'},
  'dash.empty_tx':    {pt:'Nenhuma transação',en:'No transactions',es:'Sin transacciones',fr:'Aucune transaction'},
  'dash.view_all':    {pt:'Ver tudo →',     en:'View all →',     es:'Ver todo →',       fr:'Voir tout →'},
  'dash.manage':      {pt:'Gerenciar',      en:'Manage',         es:'Gestionar',        fr:'Gérer'},

  // ── Reports ───────────────────────────────────────────────────────────────
  'rpt.income':       {pt:'Receitas',       en:'Income',         es:'Ingresos',         fr:'Revenus'},
  'rpt.expense':      {pt:'Despesas',       en:'Expenses',       es:'Gastos',           fr:'Dépenses'},
  'rpt.balance':      {pt:'Saldo',          en:'Balance',        es:'Saldo',            fr:'Solde'},
  'rpt.transactions': {pt:'Transações',     en:'Transactions',   es:'Transacciones',    fr:'Transactions'},
  'rpt.avg_ticket':   {pt:'Ticket médio',   en:'Avg ticket',     es:'Ticket promedio',  fr:'Ticket moyen'},
  'rpt.all':          {pt:'Todas',          en:'All',            es:'Todas',            fr:'Toutes'},
  'rpt.all_m':        {pt:'Todos',          en:'All',            es:'Todos',            fr:'Tous'},
  'rpt.period_month': {pt:'Mês',            en:'Month',          es:'Mes',              fr:'Mois'},
  'rpt.period_quarter':{pt:'Trimestre',     en:'Quarter',        es:'Trimestre',        fr:'Trimestre'},
  'rpt.period_year':  {pt:'Ano',            en:'Year',           es:'Año',              fr:'Année'},
  'rpt.period_last12':{pt:'Últimos 12 meses',en:'Last 12 months',es:'Últimos 12 meses', fr:'12 derniers mois'},
  'rpt.period_custom':{pt:'Personalizado',  en:'Custom',         es:'Personalizado',    fr:'Personnalisé'},
  'rpt.by_category':  {pt:'Por Categoria',  en:'By Category',    es:'Por categoría',    fr:'Par catégorie'},
  'rpt.by_month':     {pt:'Por Mês',        en:'By Month',       es:'Por mes',          fr:'Par mois'},
  'rpt.forecast':     {pt:'Previsão',       en:'Forecast',       es:'Previsión',        fr:'Prévision'},

  // ── Budgets ───────────────────────────────────────────────────────────────
  'bgt.title':        {pt:'Orçamentos',     en:'Budgets',        es:'Presupuestos',     fr:'Budgets'},
  'bgt.new':          {pt:'Novo Orçamento', en:'New Budget',     es:'Nuevo presupuesto',fr:'Nouveau budget'},
  'bgt.used':         {pt:'Utilizado',      en:'Used',           es:'Utilizado',        fr:'Utilisé'},
  'bgt.remaining':    {pt:'Restante',       en:'Remaining',      es:'Restante',         fr:'Restant'},
  'bgt.empty':        {pt:'Nenhum orçamento definido',en:'No budgets defined',es:'Sin presupuestos definidos',fr:'Aucun budget défini'},
  'bgt.over':         {pt:'Excedido',       en:'Over budget',    es:'Excedido',         fr:'Dépassé'},

  // ── Categories ────────────────────────────────────────────────────────────
  'cat.title':        {pt:'Categorias',     en:'Categories',     es:'Categorías',       fr:'Catégories'},
  'cat.new':          {pt:'Nova Categoria', en:'New Category',   es:'Nueva categoría',  fr:'Nouvelle catégorie'},
  'cat.parent':       {pt:'Categoria Pai',  en:'Parent Category',es:'Categoría padre',  fr:'Catégorie parente'},
  'cat.empty':        {pt:'Nenhuma categoria',en:'No categories',es:'Sin categorías',   fr:'Aucune catégorie'},
  'cat.income_cats':  {pt:'Categorias de Receita',en:'Income categories',es:'Categorías de ingreso',fr:'Catégories de revenu'},
  'cat.expense_cats': {pt:'Categorias de Despesa',en:'Expense categories',es:'Categorías de gasto',fr:'Catégories de dépense'},

  // ── Payees ────────────────────────────────────────────────────────────────
  'pay.title':        {pt:'Beneficiários',  en:'Payees',         es:'Beneficiarios',    fr:'Bénéficiaires'},
  'pay.new':          {pt:'Novo Beneficiário',en:'New Payee',    es:'Nuevo beneficiario',fr:'Nouveau bénéficiaire'},
  'pay.empty':        {pt:'Nenhum beneficiário',en:'No payees',  es:'Sin beneficiarios',fr:'Aucun bénéficiaire'},

  // ── Scheduled ─────────────────────────────────────────────────────────────
  'sch.title':        {pt:'Programados',    en:'Scheduled',      es:'Programados',      fr:'Programmés'},
  'sch.new':          {pt:'Novo Programado',en:'New Scheduled',  es:'Nuevo programado', fr:'Nouveau programmé'},
  'sch.empty':        {pt:'Nenhum lançamento programado',en:'No scheduled transactions',es:'Sin transacciones programadas',fr:'Aucune transaction programmée'},
  'sch.freq_daily':   {pt:'Diário',         en:'Daily',          es:'Diario',           fr:'Quotidien'},
  'sch.freq_weekly':  {pt:'Semanal',        en:'Weekly',         es:'Semanal',          fr:'Hebdomadaire'},
  'sch.freq_monthly': {pt:'Mensal',         en:'Monthly',        es:'Mensual',          fr:'Mensuel'},
  'sch.freq_yearly':  {pt:'Anual',          en:'Annual',         es:'Anual',            fr:'Annuel'},
  'sch.upcoming':     {pt:'Próximos',       en:'Upcoming',       es:'Próximos',         fr:'À venir'},
  'sch.overdue':      {pt:'Atrasados',      en:'Overdue',        es:'Atrasados',        fr:'En retard'},

  // ── Settings ──────────────────────────────────────────────────────────────
  'cfg.title':        {pt:'Configurações',  en:'Settings',       es:'Configuración',    fr:'Paramètres'},
  'cfg.profile':      {pt:'Perfil',         en:'Profile',        es:'Perfil',           fr:'Profil'},
  'cfg.family':       {pt:'Família',        en:'Family',         es:'Familia',          fr:'Famille'},
  'cfg.security':     {pt:'Segurança',      en:'Security',       es:'Seguridad',        fr:'Sécurité'},
  'cfg.language':     {pt:'Idioma',         en:'Language',       es:'Idioma',           fr:'Langue'},
  'cfg.theme':        {pt:'Tema',           en:'Theme',          es:'Tema',             fr:'Thème'},
  'cfg.notifications':{pt:'Notificações',   en:'Notifications',  es:'Notificaciones',   fr:'Notifications'},
  'cfg.modules':      {pt:'Módulos',        en:'Modules',        es:'Módulos',          fr:'Modules'},
  'cfg.backup':       {pt:'Backup',         en:'Backup',         es:'Respaldo',         fr:'Sauvegarde'},
  'cfg.ai':           {pt:'Inteligência Artificial',en:'Artificial Intelligence',es:'Inteligencia Artificial',fr:'Intelligence Artificielle'},

  // ── Months (short) ────────────────────────────────────────────────────────
  'month.jan':        {pt:'Jan',  en:'Jan',  es:'Ene',  fr:'Jan'},
  'month.feb':        {pt:'Fev',  en:'Feb',  es:'Feb',  fr:'Fév'},
  'month.mar':        {pt:'Mar',  en:'Mar',  es:'Mar',  fr:'Mar'},
  'month.apr':        {pt:'Abr',  en:'Apr',  es:'Abr',  fr:'Avr'},
  'month.may':        {pt:'Mai',  en:'May',  es:'May',  fr:'Mai'},
  'month.jun':        {pt:'Jun',  en:'Jun',  es:'Jun',  fr:'Juin'},
  'month.jul':        {pt:'Jul',  en:'Jul',  es:'Jul',  fr:'Juil'},
  'month.aug':        {pt:'Ago',  en:'Aug',  es:'Ago',  fr:'Août'},
  'month.sep':        {pt:'Set',  en:'Sep',  es:'Sep',  fr:'Sep'},
  'month.oct':        {pt:'Out',  en:'Oct',  es:'Oct',  fr:'Oct'},
  'month.nov':        {pt:'Nov',  en:'Nov',  es:'Nov',  fr:'Nov'},
  'month.dec':        {pt:'Dez',  en:'Dec',  es:'Dic',  fr:'Déc'},

  // ── Days (short) ──────────────────────────────────────────────────────────
  'day.sun':          {pt:'Dom',  en:'Sun',  es:'Dom',  fr:'Dim'},
  'day.mon':          {pt:'Seg',  en:'Mon',  es:'Lun',  fr:'Lun'},
  'day.tue':          {pt:'Ter',  en:'Tue',  es:'Mar',  fr:'Mar'},
  'day.wed':          {pt:'Qua',  en:'Wed',  es:'Mié',  fr:'Mer'},
  'day.thu':          {pt:'Qui',  en:'Thu',  es:'Jue',  fr:'Jeu'},
  'day.fri':          {pt:'Sex',  en:'Fri',  es:'Vie',  fr:'Ven'},
  'day.sat':          {pt:'Sáb',  en:'Sat',  es:'Sáb',  fr:'Sam'},

  // ── Modals & Forms ────────────────────────────────────────────────────────
  'form.account':     {pt:'Conta',             en:'Account',          es:'Cuenta',            fr:'Compte'},
  'form.category':    {pt:'Categoria',          en:'Category',         es:'Categoría',         fr:'Catégorie'},
  'form.payee':       {pt:'Beneficiário / Fonte',en:'Payee / Source', es:'Beneficiario / Fuente',fr:'Bénéficiaire / Source'},
  'form.date':        {pt:'Data',               en:'Date',             es:'Fecha',              fr:'Date'},
  'form.amount':      {pt:'Valor',              en:'Amount',           es:'Monto',              fr:'Montant'},
  'form.description': {pt:'Descrição',          en:'Description',      es:'Descripción',        fr:'Description'},
  'form.notes':       {pt:'Observações',        en:'Notes',            es:'Notas',              fr:'Notes'},
  'form.origin':      {pt:'Conta Origem',       en:'Origin Account',   es:'Cuenta origen',      fr:'Compte source'},
  'form.destination': {pt:'Conta Destino',      en:'Destination Account',es:'Cuenta destino',   fr:'Compte destination'},
  'form.password':    {pt:'Senha',              en:'Password',         es:'Contraseña',         fr:'Mot de passe'},
  'form.new_password':{pt:'Nova Senha',         en:'New Password',     es:'Nueva contraseña',   fr:'Nouveau mot de passe'},
  'form.confirm_pwd': {pt:'Confirmar Senha',    en:'Confirm Password', es:'Confirmar contraseña',fr:'Confirmer le mot de passe'},
  'form.email':       {pt:'E-mail',             en:'Email',            es:'Correo',             fr:'E-mail'},
  'form.name':        {pt:'Nome',               en:'Name',             es:'Nombre',             fr:'Nom'},

  // ── Topbar / profile ──────────────────────────────────────────────────────
  'topbar.my_profile':{pt:'Meu Perfil',         en:'My Profile',       es:'Mi perfil',          fr:'Mon profil'},
  'topbar.change_pwd':{pt:'Alterar senha',      en:'Change password',  es:'Cambiar contraseña', fr:'Changer le mot de passe'},
  'topbar.manage_fam':{pt:'Gerenciar minha família',en:'Manage my family',es:'Gestionar mi familia',fr:'Gérer ma famille'},
  'topbar.logout':    {pt:'Sair',               en:'Sign out',         es:'Salir',              fr:'Se déconnecter'},

  // ── AI Insights ───────────────────────────────────────────────────────────
  'ai.analysis':      {pt:'Análise',            en:'Analysis',         es:'Análisis',           fr:'Analyse'},
  'ai.chat':          {pt:'Chat',               en:'Chat',             es:'Chat',               fr:'Chat'},
  'ai.analyze_btn':   {pt:'Analisar',           en:'Analyze',          es:'Analizar',           fr:'Analyser'},
  'ai.all_members':   {pt:'Todos os membros',   en:'All members',      es:'Todos los miembros', fr:'Tous les membres'},
  'ai.all_accounts':  {pt:'Todas as contas',    en:'All accounts',     es:'Todas las cuentas',  fr:'Tous les comptes'},
  'ai.all_payees':    {pt:'Todos os beneficiários',en:'All payees',    es:'Todos los beneficiarios',fr:'Tous les bénéficiaires'},

  // ── Prices ────────────────────────────────────────────────────────────────
  'px.title':         {pt:'Gestão de Preços',   en:'Price Management', es:'Gestión de precios', fr:'Gestion des prix'},
  'px.search':        {pt:'Buscar no catálogo de preços',en:'Search price catalog',es:'Buscar en el catálogo',fr:'Rechercher dans le catalogue'},
  'px.new_item':      {pt:'Novo Item',           en:'New Item',         es:'Nuevo artículo',     fr:'Nouvel article'},
  'px.avg_price':     {pt:'Preço médio',         en:'Avg price',        es:'Precio promedio',    fr:'Prix moyen'},
  'px.last_price':    {pt:'Último',              en:'Latest',           es:'Último',             fr:'Dernier'},
  'px.records':       {pt:'Registros',           en:'Records',          es:'Registros',          fr:'Enregistrements'},

  // ── Investments ───────────────────────────────────────────────────────────
  'inv.title':        {pt:'Carteira de Investimentos',en:'Investment Portfolio',es:'Cartera de inversiones',fr:"Portefeuille d'investissements"},
  'inv.empty':        {pt:'Nenhum investimento',en:'No investments',    es:'Sin inversiones',    fr:'Aucun investissement'},

  // ── Import / Backup ───────────────────────────────────────────────────────
  'imp.title':        {pt:'Importar / Backup',  en:'Import / Backup',  es:'Importar / Respaldo',fr:'Importer / Sauvegarde'},
  'imp.backup_now':   {pt:'Fazer Backup',        en:'Backup Now',       es:'Hacer respaldo',     fr:'Sauvegarder'},
  'imp.restore':      {pt:'Restaurar',           en:'Restore',          es:'Restaurar',          fr:'Restaurer'},

  // ── Forecast ──────────────────────────────────────────────────────────────
  'fc.title':         {pt:'Previsão de Caixa',  en:'Cash Flow Forecast', es:'Previsión de caja',  fr:'Prévision de trésorerie'},
  'fc.loading':       {pt:'Carregando previsão…',en:'Loading forecast…', es:'Cargando previsión…',fr:'Chargement…'},
  'fc.date':          {pt:'Data',               en:'Date',               es:'Fecha',              fr:'Date'},
  'fc.description':   {pt:'Descrição',          en:'Description',        es:'Descripción',        fr:'Description'},
  'fc.amount':        {pt:'Valor',              en:'Amount',             es:'Monto',              fr:'Montant'},
  'fc.balance':       {pt:'Saldo',              en:'Balance',            es:'Saldo',              fr:'Solde'},
  'fc.period_total':  {pt:'Total do período',   en:'Period total',       es:'Total del período',  fr:'Total de la période'},
  'fc.final_balance': {pt:'Saldo final previsto',en:'Projected balance', es:'Saldo final previsto',fr:'Solde final prévu'},
  'fc.current_balance':{pt:'Saldo atual:',      en:'Current balance:',   es:'Saldo actual:',      fr:'Solde actuel :'},
  'fc.empty':         {pt:'Nenhuma transação neste período',en:'No transactions in this period',es:'Sin transacciones en este período',fr:'Aucune transaction dans cette période'},
  'fc.txs_in_period': {pt:'transação no período',en:'transaction in period',es:'transacción en el período',fr:'transaction dans la période'},
  'fc.txs_in_period_pl':{pt:'transações no período',en:'transactions in period',es:'transacciones en el período',fr:'transactions dans la période'},

  // ── Investments ───────────────────────────────────────────────────────────
  'inv.empty':        {pt:'Nenhuma conta de investimentos', en:'No investment accounts', es:'Sin cuentas de inversión', fr:"Aucun compte d'investissement"},
  'inv.asset_code':   {pt:'Código do Ativo',    en:'Asset Code',         es:'Código del activo',  fr:'Code actif'},
  'inv.current_price':{pt:'Cotação Atual',      en:'Current Price',      es:'Cotización actual',  fr:'Cours actuel'},
  'inv.avg_cost':     {pt:'Custo Médio',        en:'Average Cost',       es:'Costo promedio',     fr:'Coût moyen'},
  'inv.total_cost':   {pt:'Custo Total',        en:'Total Cost',         es:'Costo total',        fr:'Coût total'},
  'inv.evolution':    {pt:'Evolução do Investimento',en:'Investment Evolution',es:'Evolución de la inversión',fr:"Évolution de l'investissement"},
  'inv.history':      {pt:'Histórico de Movimentações',en:'Transaction History',es:'Historial de movimientos',fr:'Historique des mouvements'},
  'inv.active':       {pt:'Ativo',              en:'Active',             es:'Activo',             fr:'Actif'},

  // ── Scheduled ─────────────────────────────────────────────────────────────
  'sch.upcoming_label':{pt:'Próximos lançamentos',en:'Upcoming entries', es:'Próximos lanzamientos',fr:'Prochaines entrées'},
  'sch.past_due':     {pt:'Vencido',            en:'Past due',           es:'Vencido',            fr:'Échu'},
  'sch.next_date':    {pt:'Próxima data',       en:'Next date',          es:'Próxima fecha',      fr:'Prochaine date'},
  'sch.frequency':    {pt:'Frequência',         en:'Frequency',          es:'Frecuencia',         fr:'Fréquence'},
  'sch.register':     {pt:'Registrar',          en:'Register',           es:'Registrar',          fr:'Enregistrer'},
  'sch.skip':         {pt:'Pular',              en:'Skip',               es:'Omitir',             fr:'Ignorer'},

  // ── Common status / feedback ──────────────────────────────────────────────
  'status.active':    {pt:'Ativo',              en:'Active',             es:'Activo',             fr:'Actif'},
  'status.inactive':  {pt:'Inativo',            en:'Inactive',           es:'Inactivo',           fr:'Inactif'},
  'status.pending':   {pt:'Pendente',           en:'Pending',            es:'Pendiente',          fr:'En attente'},
  'status.confirmed': {pt:'Confirmado',         en:'Confirmed',          es:'Confirmado',         fr:'Confirmé'},
  'status.cancelled': {pt:'Cancelado',          en:'Cancelled',          es:'Cancelado',          fr:'Annulé'},
  'status.approved':  {pt:'Aprovado',           en:'Approved',           es:'Aprobado',           fr:'Approuvé'},
  'status.waiting':   {pt:'Aguardando',         en:'Waiting',            es:'Esperando',          fr:'En attente'},
  'status.loading':   {pt:'Carregando…',       en:'Loading…',           es:'Cargando…',          fr:'Chargement…'},
  'status.saving':    {pt:'Salvando…',         en:'Saving…',            es:'Guardando…',         fr:'Enregistrement…'},
  'status.processing':{pt:'Processando…',      en:'Processing…',        es:'Procesando…',        fr:'Traitement…'},
  'status.error':     {pt:'Erro',              en:'Error',              es:'Error',              fr:'Erreur'},
  'status.success':   {pt:'Sucesso',           en:'Success',            es:'Éxito',              fr:'Succès'},

  // ── Auth / User management ────────────────────────────────────────────────
  'auth.cancel':      {pt:'Cancelar',          en:'Cancel',             es:'Cancelar',           fr:'Annuler'},
  'auth.close':       {pt:'Fechar',            en:'Close',              es:'Cerrar',             fr:'Fermer'},
  'auth.loading':     {pt:'Carregando…',      en:'Loading…',           es:'Cargando…',          fr:'Chargement…'},
  'auth.access_released':{pt:'Acesso liberado como',en:'Access granted as',es:'Acceso otorgado como',fr:'Accès accordé comme'},
  'auth.invite_origin':{pt:'Convite de origem:',en:'Invite origin:',   es:'Origen de invitación:',fr:"Origine de l'invitation :"},
  'auth.actions':     {pt:'Ações',            en:'Actions',            es:'Acciones',           fr:'Actions'},
  'auth.only_owners': {pt:'Apenas owners podem gerenciar famílias.',en:'Only owners can manage families.',es:'Solo los propietarios pueden gestionar familias.',fr:'Seuls les propriétaires peuvent gérer les familles.'},
  'auth.later':       {pt:'Depois',           en:'Later',              es:'Después',            fr:'Plus tard'},
  'auth.attention':   {pt:'Atenção:',         en:'Attention:',         es:'Atención:',          fr:'Attention :'},
  'auth.destination': {pt:'Destino (será sobrescrito)',en:'Destination (will be overwritten)',es:'Destino (será sobreescrito)',fr:'Destination (sera écrasé)'},
  'auth.settings':    {pt:'Configurações',    en:'Settings',           es:'Configuración',      fr:'Paramètres'},
  'auth.enter_ft':    {pt:'Acessar o Family FinTrack →',en:'Enter Family FinTrack →',es:'Acceder a Family FinTrack →',fr:'Accéder à Family FinTrack →'},

  // ── Backup / Import ───────────────────────────────────────────────────────
  'bkp.backup':       {pt:'Backup',           en:'Backup',             es:'Respaldo',           fr:'Sauvegarde'},
  'bkp.restore':      {pt:'Restaurar',        en:'Restore',            es:'Restaurar',          fr:'Restaurer'},
  'bkp.download':     {pt:'Baixar',           en:'Download',           es:'Descargar',          fr:'Télécharger'},
  'bkp.upload':       {pt:'Enviar',           en:'Upload',             es:'Subir',              fr:'Envoyer'},
  'bkp.created_at':   {pt:'Criado em',        en:'Created at',         es:'Creado el',          fr:'Créé le'},
  'bkp.size':         {pt:'Tamanho',          en:'Size',               es:'Tamaño',             fr:'Taille'},

  // ── Grocery ───────────────────────────────────────────────────────────────
  'groc.title':       {pt:'Lista de Mercado', en:'Grocery List',       es:'Lista de compras',   fr:'Liste de courses'},
  'groc.add_item':    {pt:'Adicionar item',   en:'Add item',           es:'Agregar artículo',   fr:'Ajouter un article'},
  'groc.empty':       {pt:'Lista vazia',      en:'Empty list',         es:'Lista vacía',        fr:'Liste vide'},
  'groc.checked':     {pt:'Marcados',         en:'Checked',            es:'Marcados',           fr:'Cochés'},
  'groc.unit':        {pt:'Unidade',          en:'Unit',               es:'Unidad',             fr:'Unité'},
  'groc.qty':         {pt:'Qtd',              en:'Qty',                es:'Cant.',              fr:'Qté'},

  // ── Reports extended ──────────────────────────────────────────────────────
  'rpt.no_data':      {pt:'Sem dados para o período',en:'No data for period',es:'Sin datos para el período',fr:'Pas de données pour la période'},
  'rpt.download_pdf': {pt:'Baixar PDF',       en:'Download PDF',       es:'Descargar PDF',      fr:'Télécharger PDF'},
  'rpt.export_csv':   {pt:'Exportar CSV',     en:'Export CSV',         es:'Exportar CSV',       fr:'Exporter CSV'},
  'rpt.col_date':     {pt:'Data',             en:'Date',               es:'Fecha',              fr:'Date'},
  'rpt.col_desc':     {pt:'Descrição',        en:'Description',        es:'Descripción',        fr:'Description'},
  'rpt.col_account':  {pt:'Conta',            en:'Account',            es:'Cuenta',             fr:'Compte'},
  'rpt.col_category': {pt:'Categoria',        en:'Category',           es:'Categoría',          fr:'Catégorie'},
  'rpt.col_payee':    {pt:'Beneficiário',     en:'Payee',              es:'Beneficiario',       fr:'Bénéficiaire'},
  'rpt.col_amount':   {pt:'Valor',            en:'Amount',             es:'Monto',              fr:'Montant'},
  'rpt.total':        {pt:'Total',            en:'Total',              es:'Total',              fr:'Total'},

  // ── Wizard ────────────────────────────────────────────────────────────────
  'wiz.next':         {pt:'Próximo →',        en:'Next →',             es:'Siguiente →',        fr:'Suivant →'},
  'wiz.prev':         {pt:'← Anterior',       en:'← Back',             es:'← Anterior',         fr:'← Précédent'},
  'wiz.finish':       {pt:'Concluir',         en:'Finish',             es:'Finalizar',          fr:'Terminer'},
  'wiz.skip':         {pt:'Pular',            en:'Skip',               es:'Omitir',             fr:'Ignorer'},
  'wiz.welcome':      {pt:'Bem-vindo!',       en:'Welcome!',           es:'¡Bienvenido!',       fr:'Bienvenue !'},
  'wiz.setup_family': {pt:'Configurar Família',en:'Set Up Family',     es:'Configurar familia', fr:'Configurer la famille'},

  // ── AI Insights extended ──────────────────────────────────────────────────
  'ai.period_from':   {pt:'De',              en:'From',               es:'Desde',              fr:'Du'},
  'ai.period_to':     {pt:'Até',             en:'To',                 es:'Hasta',              fr:'Au'},
  'ai.export':        {pt:'Exportar análise',en:'Export analysis',    es:'Exportar análisis',  fr:"Exporter l'analyse"},
  'ai.summary':       {pt:'Resumo do período',en:'Period summary',    es:'Resumen del período',fr:'Résumé de la période'},
  'ai.income_label':  {pt:'Receitas',        en:'Income',             es:'Ingresos',           fr:'Revenus'},
  'ai.expense_label': {pt:'Despesas',        en:'Expenses',           es:'Gastos',             fr:'Dépenses'},
  'ai.net_label':     {pt:'Resultado Líquido',en:'Net Result',        es:'Resultado neto',     fr:'Résultat net'},
  'ai.top_categories':{pt:'Gastos por Categoria',en:'Expenses by Category',es:'Gastos por categoría',fr:'Dépenses par catégorie'},
  'ai.top_payees':    {pt:'Top Beneficiários',en:'Top Payees',        es:'Principales beneficiarios',fr:'Principaux bénéficiaires'},
  'ai.by_member':     {pt:'Gastos por Membro',en:'Expenses by Member',es:'Gastos por miembro', fr:'Dépenses par membre'},
  'ai.monthly_trend': {pt:'Tendência Mensal', en:'Monthly Trend',     es:'Tendencia mensual',  fr:'Tendance mensuelle'},
  'ai.recommendations':{pt:'Recomendações',  en:'Recommendations',    es:'Recomendaciones',    fr:'Recommandations'},
  'ai.savings':       {pt:'Oportunidades de Economia',en:'Savings Opportunities',es:'Oportunidades de ahorro',fr:"Opportunités d'économies"},
  'ai.anomalies':     {pt:'Anomalias Detectadas',en:'Detected Anomalies',es:'Anomalías detectadas',fr:'Anomalies détectées'},
  'ai.alerts':        {pt:'Alertas de Fluxo de Caixa',en:'Cash Flow Alerts',es:'Alertas de flujo de caja',fr:'Alertes de trésorerie'},
  'ai.chat_placeholder':{pt:'Pergunte sobre suas finanças…',en:'Ask about your finances…',es:'Pregunta sobre tus finanzas…',fr:'Posez une question sur vos finances…'},
  'ai.chat_send':     {pt:'Enviar',          en:'Send',               es:'Enviar',             fr:'Envoyer'},
  'ai.chat_clear':    {pt:'Limpar chat',     en:'Clear chat',         es:'Limpiar chat',       fr:'Effacer le chat'},
  'ai.empty':         {pt:'Configure a chave Gemini para usar AI Insights',en:'Configure Gemini key to use AI Insights',es:'Configure la clave Gemini para usar AI Insights',fr:'Configurez la clé Gemini pour utiliser AI Insights'},

  // ── Direct text translations (reverse-map engine) ─────────────────────────
  // Keys match the PT text directly — used by _i18nWalkTextNodes()
  // Common UI
  'Cancelar':           {pt:'Cancelar',          en:'Cancel',            es:'Cancelar',           fr:'Annuler'},
  'Salvar':             {pt:'Salvar',             en:'Save',              es:'Guardar',            fr:'Enregistrer'},
  'Fechar':             {pt:'Fechar',             en:'Close',             es:'Cerrar',             fr:'Fermer'},
  'Adicionar':          {pt:'Adicionar',          en:'Add',               es:'Agregar',            fr:'Ajouter'},
  'Editar':             {pt:'Editar',             en:'Edit',              es:'Editar',             fr:'Modifier'},
  'Excluir':            {pt:'Excluir',            en:'Delete',            es:'Eliminar',           fr:'Supprimer'},
  'Confirmar':          {pt:'Confirmar',          en:'Confirm',           es:'Confirmar',          fr:'Confirmer'},
  'Buscar':             {pt:'Buscar',             en:'Search',            es:'Buscar',             fr:'Rechercher'},
  'Voltar':             {pt:'Voltar',             en:'Back',              es:'Volver',             fr:'Retour'},
  'Novo':               {pt:'Novo',               en:'New',               es:'Nuevo',              fr:'Nouveau'},
  'Nova':               {pt:'Nova',               en:'New',               es:'Nueva',              fr:'Nouvelle'},
  'Exportar':           {pt:'Exportar',           en:'Export',            es:'Exportar',           fr:'Exporter'},
  'Hoje':               {pt:'Hoje',               en:'Today',             es:'Hoy',                fr:"Aujourd'hui"},
  'Total':              {pt:'Total',              en:'Total',             es:'Total',              fr:'Total'},
  'Todos':              {pt:'Todos',              en:'All',               es:'Todos',              fr:'Tous'},
  'Todas':              {pt:'Todas',              en:'All',               es:'Todas',              fr:'Toutes'},
  'Saldo':              {pt:'Saldo',              en:'Balance',           es:'Saldo',              fr:'Solde'},
  'Valor':              {pt:'Valor',              en:'Amount',            es:'Monto',              fr:'Montant'},
  'Data':               {pt:'Data',               en:'Date',              es:'Fecha',              fr:'Date'},
  'Nome':               {pt:'Nome',               en:'Name',              es:'Nombre',             fr:'Nom'},
  'Tipo':               {pt:'Tipo',               en:'Type',              es:'Tipo',               fr:'Type'},
  'Moeda':              {pt:'Moeda',              en:'Currency',          es:'Moneda',             fr:'Devise'},
  'Categoria':          {pt:'Categoria',          en:'Category',          es:'Categoría',          fr:'Catégorie'},
  'Conta':              {pt:'Conta',              en:'Account',           es:'Cuenta',             fr:'Compte'},
  'Senha':              {pt:'Senha',              en:'Password',          es:'Contraseña',         fr:'Mot de passe'},
  'Idioma':             {pt:'Idioma',             en:'Language',          es:'Idioma',             fr:'Langue'},
  'Família':            {pt:'Família',            en:'Family',            es:'Familia',            fr:'Famille'},
  'Perfil':             {pt:'Perfil',             en:'Profile',           es:'Perfil',             fr:'Profil'},
  'Segurança':          {pt:'Segurança',          en:'Security',          es:'Seguridad',          fr:'Sécurité'},
  'Ativo':              {pt:'Ativo',              en:'Active',            es:'Activo',             fr:'Actif'},
  'Ativos':             {pt:'Ativos',             en:'Active',            es:'Activos',            fr:'Actifs'},
  'Sim':                {pt:'Sim',                en:'Yes',               es:'Sí',                 fr:'Oui'},
  'Não':                {pt:'Não',                en:'No',                es:'No',                 fr:'Non'},
  'Enviar':             {pt:'Enviar',             en:'Send',              es:'Enviar',             fr:'Envoyer'},
  'Copiar':             {pt:'Copiar',             en:'Copy',              es:'Copiar',             fr:'Copier'},
  'Gerenciar':          {pt:'Gerenciar',          en:'Manage',            es:'Gestionar',          fr:'Gérer'},
  'Detalhes':           {pt:'Detalhes',           en:'Details',           es:'Detalles',           fr:'Détails'},
  'Histórico':          {pt:'Histórico',          en:'History',           es:'Historial',          fr:'Historique'},
  'Ações':              {pt:'Ações',              en:'Actions',           es:'Acciones',           fr:'Actions'},
  'Observações':        {pt:'Observações',        en:'Notes',             es:'Notas',              fr:'Notes'},
  'Descrição':          {pt:'Descrição',          en:'Description',       es:'Descripción',        fr:'Description'},
  'Sair':               {pt:'Sair',               en:'Sign out',          es:'Salir',              fr:'Se déconnecter'},
  'Ver tudo →':         {pt:'Ver tudo →',         en:'View all →',        es:'Ver todo →',         fr:'Voir tout →'},
  // Transactions
  'Lançamentos':        {pt:'Lançamentos',        en:'Transactions',      es:'Transacciones',      fr:'Transactions'},
  'Receita':            {pt:'Receita',            en:'Income',            es:'Ingreso',            fr:'Revenu'},
  'Despesa':            {pt:'Despesa',            en:'Expense',           es:'Gasto',              fr:'Dépense'},
  'Transferência':      {pt:'Transferência',      en:'Transfer',          es:'Transferencia',      fr:'Virement'},
  'Receitas':           {pt:'Receitas',           en:'Income',            es:'Ingresos',           fr:'Revenus'},
  'Despesas':           {pt:'Despesas',           en:'Expenses',          es:'Gastos',             fr:'Dépenses'},
  'Todos os meses':     {pt:'Todos os meses',     en:'All months',        es:'Todos los meses',    fr:'Tous les mois'},
  'Todas as contas':    {pt:'Todas as contas',    en:'All accounts',      es:'Todas las cuentas',  fr:'Tous les comptes'},
  'Confirmadas':        {pt:'Confirmadas',        en:'Confirmed',         es:'Confirmadas',        fr:'Confirmées'},
  'Pendentes':          {pt:'Pendentes',          en:'Pending',           es:'Pendientes',         fr:'En attente'},
  'Conta Origem':       {pt:'Conta Origem',       en:'Source Account',    es:'Cuenta origen',      fr:'Compte source'},
  'Conta Destino':      {pt:'Conta Destino',      en:'Destination',       es:'Cuenta destino',     fr:'Compte destination'},
  'Nova Transação':     {pt:'Nova Transação',     en:'New Transaction',   es:'Nueva transacción',  fr:'Nouvelle transaction'},
  // Accounts
  'Nova Conta':         {pt:'Nova Conta',         en:'New Account',       es:'Nueva cuenta',       fr:'Nouveau compte'},
  'Sem grupo':          {pt:'Sem grupo',           en:'No group',          es:'Sin grupo',          fr:'Sans groupe'},
  'Total:':             {pt:'Total:',              en:'Total:',            es:'Total:',             fr:'Total:'},
  'Saldo inicial':      {pt:'Saldo inicial',       en:'Initial balance',   es:'Saldo inicial',      fr:'Solde initial'},
  'Corrente':           {pt:'Corrente',            en:'Checking',          es:'Corriente',          fr:'Courant'},
  'Poupança':           {pt:'Poupança',            en:'Savings',           es:'Ahorros',            fr:'Épargne'},
  'Cartão':             {pt:'Cartão',              en:'Card',              es:'Tarjeta',            fr:'Carte'},
  'Dinheiro':           {pt:'Dinheiro',            en:'Cash',              es:'Efectivo',           fr:'Espèces'},
  // Categories
  'Nova Categoria':     {pt:'Nova Categoria',      en:'New Category',      es:'Nueva categoría',    fr:'Nouvelle catégorie'},
  'Categoria Pai':      {pt:'Categoria Pai',       en:'Parent Category',   es:'Categoría padre',    fr:'Catégorie parente'},
  'Favoritar':          {pt:'Favoritar',           en:'Favorite',          es:'Favorito',           fr:'Favori'},
  'Editar Categoria':   {pt:'Editar Categoria',    en:'Edit Category',     es:'Editar categoría',   fr:'Modifier catégorie'},
  // Payees
  'Beneficiário':       {pt:'Beneficiário',        en:'Payee',             es:'Beneficiario',       fr:'Bénéficiaire'},
  'Beneficiários':      {pt:'Beneficiários',       en:'Payees',            es:'Beneficiarios',      fr:'Bénéficiaires'},
  'Ambos':              {pt:'Ambos',               en:'Both',              es:'Ambos',              fr:'Les deux'},
  'Pendente':           {pt:'Pendente',            en:'Pending',           es:'Pendiente',          fr:'En attente'},
  // Scheduled
  'Atrasado':           {pt:'Atrasado',            en:'Overdue',           es:'Atrasado',           fr:'En retard'},
  'Concluído':          {pt:'Concluído',           en:'Completed',         es:'Completado',         fr:'Terminé'},
  'Diário':             {pt:'Diário',              en:'Daily',             es:'Diario',             fr:'Quotidien'},
  'Semanal':            {pt:'Semanal',             en:'Weekly',            es:'Semanal',            fr:'Hebdomadaire'},
  'Mensal':             {pt:'Mensal',              en:'Monthly',           es:'Mensual',            fr:'Mensuel'},
  'Bimestral':          {pt:'Bimestral',           en:'Bimonthly',         es:'Bimestral',          fr:'Bimestriel'},
  'Trimestral':         {pt:'Trimestral',          en:'Quarterly',         es:'Trimestral',         fr:'Trimestriel'},
  'Semestral':          {pt:'Semestral',           en:'Semiannual',        es:'Semestral',          fr:'Semestriel'},
  'Anual':              {pt:'Anual',               en:'Annual',            es:'Anual',              fr:'Annuel'},
  // Reports
  'Ticket médio':       {pt:'Ticket médio',        en:'Avg ticket',        es:'Ticket promedio',    fr:'Ticket moyen'},
  'Por Categoria':      {pt:'Por Categoria',       en:'By Category',       es:'Por categoría',      fr:'Par catégorie'},
  'Por Mês':            {pt:'Por Mês',             en:'By Month',          es:'Por mes',            fr:'Par mois'},
  'Previsão':           {pt:'Previsão',            en:'Forecast',          es:'Previsión',          fr:'Prévision'},
  'Mês atual':          {pt:'Mês atual',           en:'Current month',     es:'Mes actual',         fr:'Mois en cours'},
  'Trimestre':          {pt:'Trimestre',           en:'Quarter',           es:'Trimestre',          fr:'Trimestre'},
  'Ano atual':          {pt:'Ano atual',           en:'Current year',      es:'Año actual',         fr:'Année en cours'},
  'Personalizado':      {pt:'Personalizado',       en:'Custom',            es:'Personalizado',      fr:'Personnalisé'},
  // Budgets
  'Utilizado':          {pt:'Utilizado',           en:'Used',              es:'Utilizado',          fr:'Utilisé'},
  'Restante':           {pt:'Restante',            en:'Remaining',         es:'Restante',           fr:'Restant'},
  'Excedido':           {pt:'Excedido',            en:'Over budget',       es:'Excedido',           fr:'Dépassé'},
  // Settings
  'Configurações':      {pt:'Configurações',       en:'Settings',          es:'Configuración',      fr:'Paramètres'},
  'Ativar':             {pt:'Ativar',              en:'Enable',            es:'Activar',            fr:'Activer'},
  'Desativar':          {pt:'Desativar',           en:'Disable',           es:'Desactivar',         fr:'Désactiver'},
  'Módulos':            {pt:'Módulos',             en:'Modules',           es:'Módulos',            fr:'Modules'},
  // Investments
  'Compra':             {pt:'Compra',              en:'Buy',               es:'Compra',             fr:'Achat'},
  'Venda':              {pt:'Venda',               en:'Sell',              es:'Venta',              fr:'Vente'},
  'Custo':              {pt:'Custo',               en:'Cost',              es:'Costo',              fr:'Coût'},
  'Cotação':            {pt:'Cotação',             en:'Quote',             es:'Cotización',         fr:'Cours'},
  // Prices
  'Preço médio':        {pt:'Preço médio',         en:'Avg price',         es:'Precio promedio',    fr:'Prix moyen'},
  'Último':             {pt:'Último',              en:'Latest',            es:'Último',             fr:'Dernier'},
  'Registros':          {pt:'Registros',           en:'Records',           es:'Registros',          fr:'Enregistrements'},
  // AI
  'Análise':            {pt:'Análise',             en:'Analysis',          es:'Análisis',           fr:'Analyse'},
  'Analisar':           {pt:'Analisar',            en:'Analyze',           es:'Analizar',           fr:'Analyser'},
  'Todos os membros':   {pt:'Todos os membros',    en:'All members',       es:'Todos los miembros', fr:'Tous les membres'},
  // Months full
  'Janeiro':            {pt:'Janeiro',             en:'January',           es:'Enero',              fr:'Janvier'},
  'Fevereiro':          {pt:'Fevereiro',           en:'February',          es:'Febrero',            fr:'Février'},
  'Março':              {pt:'Março',               en:'March',             es:'Marzo',              fr:'Mars'},
  'Abril':              {pt:'Abril',               en:'April',             es:'Abril',              fr:'Avril'},
  'Maio':               {pt:'Maio',                en:'May',               es:'Mayo',               fr:'Mai'},
  'Junho':              {pt:'Junho',               en:'June',              es:'Junio',              fr:'Juin'},
  'Julho':              {pt:'Julho',               en:'July',              es:'Julio',              fr:'Juillet'},
  'Agosto':             {pt:'Agosto',              en:'August',            es:'Agosto',             fr:'Août'},
  'Setembro':           {pt:'Setembro',            en:'September',         es:'Septiembre',         fr:'Septembre'},
  'Outubro':            {pt:'Outubro',             en:'October',           es:'Octubre',            fr:'Octobre'},
  'Novembro':           {pt:'Novembro',            en:'November',          es:'Noviembre',          fr:'Novembre'},
  'Dezembro':           {pt:'Dezembro',            en:'December',          es:'Diciembre',          fr:'Décembre'},
  // Forecast
  'Saldo final prev.':  {pt:'Saldo final prev.',   en:'Projected balance',  es:'Saldo final prev.',  fr:'Solde final prévu'},
  'Total do período':   {pt:'Total do período',    en:'Period total',       es:'Total del período',  fr:'Total de la période'},
  'Saldo atual:':       {pt:'Saldo atual:',        en:'Current balance:',   es:'Saldo actual:',      fr:'Solde actuel:'},

  // ── Complete UI translations added ─────────────────────────────────────────
  '% do Grupo': {pt:'% do Grupo', en:'% of group', es:'% del grupo', fr:'% du groupe'},
  'A cada': {pt:'A cada', en:'Every', es:'Cada', fr:'Chaque'},
  'Abra uma lista primeiro.': {pt:'Abra uma lista primeiro.', en:'Open a list first.', es:'Abra una lista primero.', fr:'Ouvrez d\'abord une liste.'},
  'Abrir': {pt:'Abrir', en:'Open', es:'Abrir', fr:'Ouvrir'},
  'Abrir lista': {pt:'Abrir lista', en:'Open list', es:'Abrir lista', fr:'Ouvrir la liste'},
  'Adicionar à lista de compras': {pt:'Adicionar à lista de compras', en:'Add to shopping list', es:'Agregar a la lista de compras', fr:'Ajouter à la liste de courses'},
  'Adicione os membros para personalizar o app.': {pt:'Adicione os membros para personalizar o app.', en:'Add members to personalize the app.', es:'Añada miembros para personalizar la app.', fr:'Ajoutez des membres pour personnaliser l\'app.'},
  'Admin (acesso total)': {pt:'Admin (acesso total)', en:'Admin (full access)', es:'Admin (acceso total)', fr:'Admin (accès total)'},
  'Administrador': {pt:'Administrador', en:'Administrator', es:'Administrador', fr:'Administrateur'},
  'Admins e owners sempre veem todas as configurações.': {pt:'Admins e owners sempre veem todas as configurações.', en:'Admins and owners always see all settings.', es:'Los admins y propietarios siempre ven toda la configuración.', fr:'Les admins et propriétaires voient toujours tous les paramètres.'},
  'Adulto': {pt:'Adulto', en:'Adult', es:'Adulto', fr:'Adulte'},
  'Adultos': {pt:'Adultos', en:'Adults', es:'Adultos', fr:'Adultes'},
  'Adultos podem ter acesso ao app. Você pode convidar agora ou depois.': {pt:'Adultos podem ter acesso ao app. Você pode convidar agora ou depois.', en:'Adults can have app access. You can invite now or later.', es:'Los adultos pueden tener acceso a la app. Puede invitar ahora o después.', fr:'Les adultes peuvent avoir accès à l\'app. Vous pouvez inviter maintenant ou plus tard.'},
  'Agora': {pt:'Agora', en:'Now', es:'Ahora', fr:'Maintenant'},
  'Agrupar por categoria': {pt:'Agrupar por categoria', en:'Group by category', es:'Agrupar por categoría', fr:'Grouper par catégorie'},
  'Agrupar por estabelecimento': {pt:'Agrupar por estabelecimento', en:'Group by store', es:'Agrupar por establecimiento', fr:'Grouper par établissement'},
  'Aguardando registro': {pt:'Aguardando registro', en:'Awaiting registration', es:'Esperando registro', fr:'En attente d\'enregistrement'},
  'Aguarde…': {pt:'Aguarde…', en:'Please wait…', es:'Espere…', fr:'Veuillez patienter…'},
  'Ajuste de saldo / Consolidação': {pt:'Ajuste de saldo / Consolidação', en:'Balance adjustment / Consolidation', es:'Ajuste de saldo / Consolidación', fr:'Ajustement de solde / Consolidation'},
  'Alterar': {pt:'Alterar', en:'Change', es:'Cambiar', fr:'Modifier'},
  'Alterar Masterpin': {pt:'Alterar Masterpin', en:'Change Masterpin', es:'Cambiar Masterpin', fr:'Changer le Masterpin'},
  'Alternar sinal': {pt:'Alternar sinal', en:'Toggle sign', es:'Alternar signo', fr:'Inverser le signe'},
  'Amanhã': {pt:'Amanhã', en:'Tomorrow', es:'Mañana', fr:'Demain'},
  'Analisar & Prévia →': {pt:'Analisar & Prévia →', en:'Analyze & Preview →', es:'Analizar y vista previa →', fr:'Analyser et aperçu →'},
  'Anexo': {pt:'Anexo', en:'Attachment', es:'Adjunto', fr:'Pièce jointe'},
  'Anexo (PDF ou imagem)': {pt:'Anexo (PDF ou imagem)', en:'Attachment (PDF or image)', es:'Adjunto (PDF o imagen)', fr:'Pièce jointe (PDF ou image)'},
  'Anos': {pt:'Anos', en:'Years', es:'Años', fr:'Ans'},
  'Análise Geral': {pt:'Análise Geral', en:'General Analysis', es:'Análisis general', fr:'Analyse générale'},
  'Apenas admin pode alterar o logotipo': {pt:'Apenas admin pode alterar o logotipo', en:'Only admin can change the logo', es:'Solo el admin puede cambiar el logo', fr:'Seul l\'admin peut changer le logo'},
  'Aplicar': {pt:'Aplicar', en:'Apply', es:'Aplicar', fr:'Appliquer'},
  'Arrastar': {pt:'Arrastar', en:'Drag', es:'Arrastrar', fr:'Glisser'},
  'Arrastar para reordenar': {pt:'Arrastar para reordenar', en:'Drag to reorder', es:'Arrastrar para reordenar', fr:'Faire glisser pour réorganiser'},
  'Ativar módulo': {pt:'Ativar módulo', en:'Enable module', es:'Activar módulo', fr:'Activer le module'},
  'Atualizar': {pt:'Atualizar', en:'Update', es:'Actualizar', fr:'Mettre à jour'},
  'Auditoria': {pt:'Auditoria', en:'Audit', es:'Auditoría', fr:'Audit'},
  'Auditoria (admin)': {pt:'Auditoria (admin)', en:'Audit (admin)', es:'Auditoría (admin)', fr:'Audit (admin)'},
  'Auditoria de Auto-registros': {pt:'Auditoria de Auto-registros', en:'Auto-registration audit', es:'Auditoría de registros automáticos', fr:'Audit d\'auto-enregistrement'},
  'Automação de Programados': {pt:'Automação de Programados', en:'Scheduled automation', es:'Automatización de programados', fr:'Automatisation des programmés'},
  'Automação de transações programadas': {pt:'Automação de transações programadas', en:'Scheduled transaction automation', es:'Automatización de transacciones programadas', fr:'Automatisation des transactions programmées'},
  'Automático': {pt:'Automático', en:'Automatic', es:'Automático', fr:'Automatique'},
  'Avançado': {pt:'Avançado', en:'Advanced', es:'Avanzado', fr:'Avancé'},
  'Avisar com antecedência': {pt:'Avisar com antecedência', en:'Notify in advance', es:'Avisar con anticipación', fr:'Avertir à l\'avance'},
  'Ação BR': {pt:'Ação BR', en:'Brazilian stock', es:'Acción BR', fr:'Action brésilienne'},
  'Ação US': {pt:'Ação US', en:'US stock', es:'Acción US', fr:'Action américaine'},
  'Backup automático de dados': {pt:'Backup automático de dados', en:'Automatic data backup', es:'Copia de seguridad automática', fr:'Sauvegarde automatique des données'},
  'Backup do banco de dados': {pt:'Backup do banco de dados', en:'Database backup', es:'Copia de seguridad de base de datos', fr:'Sauvegarde de la base de données'},
  'Barras': {pt:'Barras', en:'Bars', es:'Barras', fr:'Barres'},
  'Beneficiário excluído': {pt:'Beneficiário excluído', en:'Payee deleted', es:'Beneficiario eliminado', fr:'Bénéficiaire supprimé'},
  'Beneficiário vinculado': {pt:'Beneficiário vinculado', en:'Linked payee', es:'Beneficiario vinculado', fr:'Bénéficiaire lié'},
  'Beneficiários & Fontes Pagadoras': {pt:'Beneficiários & Fontes Pagadoras', en:'Payees & Payers', es:'Beneficiarios y pagadores', fr:'Bénéficiaires et payeurs'},
  'Beneficiários únicos encontrados.': {pt:'Beneficiários únicos encontrados.', en:'Unique payees found.', es:'Beneficiarios únicos encontrados.', fr:'Bénéficiaires uniques trouvés.'},
  'Básico': {pt:'Básico', en:'Basic', es:'Básico', fr:'Basique'},
  'CDB, LCI, Tesouro': {pt:'CDB, LCI, Tesouro', en:'CDB, LCI, Treasury', es:'CDB, LCI, Tesoro', fr:'CDB, LCI, Trésor'},
  'CEP': {pt:'CEP', en:'ZIP', es:'Código postal', fr:'Code postal'},
  'CNPJ': {pt:'CNPJ', en:'Tax ID', es:'NIF', fr:'SIRET'},
  'CNPJ / CPF': {pt:'CNPJ / CPF', en:'Tax ID / CPF', es:'NIF / CPF', fr:'SIRET / CPF'},
  'CNPJ/CPF': {pt:'CNPJ/CPF', en:'Tax ID/CPF', es:'NIF/CPF', fr:'SIRET/CPF'},
  'CPF': {pt:'CPF', en:'CPF', es:'CPF', fr:'CPF'},
  'Campo obrigatório': {pt:'Campo obrigatório', en:'Required field', es:'Campo obligatorio', fr:'Champ obligatoire'},
  'Carregar': {pt:'Carregar', en:'Load', es:'Cargar', fr:'Charger'},
  'Carregar ao entrar': {pt:'Carregar ao entrar', en:'Load on login', es:'Cargar al entrar', fr:'Charger à la connexion'},
  'Carteira': {pt:'Carteira', en:'Wallet', es:'Cartera', fr:'Portefeuille'},
  'Cartão de Crédito': {pt:'Cartão de Crédito', en:'Credit card', es:'Tarjeta de crédito', fr:'Carte de crédit'},
  'Cashflow 6 meses + gráfico de despesas': {pt:'Cashflow 6 meses + gráfico de despesas', en:'6-month cashflow + expense chart', es:'Flujo de caja 6 meses + gráfico de gastos', fr:'Trésorerie 6 mois + graphique des dépenses'},
  'Categoria Padrão': {pt:'Categoria Padrão', en:'Default Category', es:'Categoría predeterminada', fr:'Catégorie par défaut'},
  'Categoria excluída': {pt:'Categoria excluída', en:'Category deleted', es:'Categoría eliminada', fr:'Catégorie supprimée'},
  'Categoria padrão': {pt:'Categoria padrão', en:'Default category', es:'Categoría predeterminada', fr:'Catégorie par défaut'},
  'Categoria salva!': {pt:'Categoria salva!', en:'Category saved!', es:'¡Categoría guardada!', fr:'Catégorie enregistrée !'},
  'Catálogo de preços': {pt:'Catálogo de preços', en:'Price catalog', es:'Catálogo de precios', fr:'Catalogue de prix'},
  'Chave': {pt:'Chave', en:'Key', es:'Clave', fr:'Clé'},
  'Chave API Google Gemini': {pt:'Chave API Google Gemini', en:'Google Gemini API Key', es:'Clave API de Google Gemini', fr:'Clé API Google Gemini'},
  'Cidade': {pt:'Cidade', en:'City', es:'Ciudad', fr:'Ville'},
  'Colar': {pt:'Colar', en:'Paste', es:'Pegar', fr:'Coller'},
  'Comprado': {pt:'Comprado', en:'Purchased', es:'Comprado', fr:'Acheté'},
  'Conciliadas': {pt:'Conciliadas', en:'Reconciled', es:'Conciliadas', fr:'Rapprochées'},
  'Conectar': {pt:'Conectar', en:'Connect', es:'Conectar', fr:'Connecter'},
  'Config': {pt:'Config', en:'Config', es:'Config', fr:'Config'},
  'Configurações de IA': {pt:'Configurações de IA', en:'AI Settings', es:'Configuración de IA', fr:'Paramètres d\'IA'},
  'Confirmada': {pt:'Confirmada', en:'Confirmed', es:'Confirmada', fr:'Confirmée'},
  'Confirmar Nova Senha': {pt:'Confirmar Nova Senha', en:'Confirm New Password', es:'Confirmar nueva contraseña', fr:'Confirmer le nouveau mot de passe'},
  'Confirmar senha': {pt:'Confirmar senha', en:'Confirm password', es:'Confirmar contraseña', fr:'Confirmer le mot de passe'},
  'Conta & Segurança': {pt:'Conta & Segurança', en:'Account & Security', es:'Cuenta y seguridad', fr:'Compte et sécurité'},
  'Conta Corrente': {pt:'Conta Corrente', en:'Checking account', es:'Cuenta corriente', fr:'Compte courant'},
  'Conta Destino *': {pt:'Conta Destino *', en:'Destination account *', es:'Cuenta destino *', fr:'Compte destination *'},
  'Conta Investimento': {pt:'Conta Investimento', en:'Investment account', es:'Cuenta de inversión', fr:'Compte d\'investissement'},
  'Conta Origem *': {pt:'Conta Origem *', en:'Source account *', es:'Cuenta origen *', fr:'Compte source *'},
  'Conta Poupança': {pt:'Conta Poupança', en:'Savings account', es:'Cuenta de ahorros', fr:'Compte épargne'},
  'Conta de origem': {pt:'Conta de origem', en:'Source account', es:'Cuenta de origen', fr:'Compte source'},
  'Conta destino': {pt:'Conta destino', en:'Destination account', es:'Cuenta destino', fr:'Compte destination'},
  'Conta destino padrão:': {pt:'Conta destino padrão:', en:'Default destination account:', es:'Cuenta destino predeterminada:', fr:'Compte destination par défaut:'},
  'Conta padrão (se não informada na linha):': {pt:'Conta padrão (se não informada na linha):', en:'Default account (if not set in row):', es:'Cuenta predeterminada (si no está en la fila):', fr:'Compte par défaut (si non défini dans la ligne):'},
  'Conta, categoria, beneficiário': {pt:'Conta, categoria, beneficiário', en:'Account, category, payee', es:'Cuenta, categoría, beneficiario', fr:'Compte, catégorie, bénéficiaire'},
  'Continuar': {pt:'Continuar', en:'Continue', es:'Continuar', fr:'Continuer'},
  'Continuar →': {pt:'Continuar →', en:'Continue →', es:'Continuar →', fr:'Continuer →'},
  'Convidar': {pt:'Convidar', en:'Invite', es:'Invitar', fr:'Inviter'},
  'Convite': {pt:'Convite', en:'Invitation', es:'Invitación', fr:'Invitation'},
  'Cor': {pt:'Cor', en:'Color', es:'Color', fr:'Couleur'},
  'Corretora': {pt:'Corretora', en:'Broker', es:'Corredor', fr:'Courtier'},
  'Cotação atualizada': {pt:'Cotação atualizada', en:'Quote updated', es:'Cotización actualizada', fr:'Cours mis à jour'},
  'Criança': {pt:'Criança', en:'Child', es:'Niño', fr:'Enfant'},
  'Crianças': {pt:'Crianças', en:'Children', es:'Niños', fr:'Enfants'},
  'Criar': {pt:'Criar', en:'Create', es:'Crear', fr:'Créer'},
  'Criar Lista': {pt:'Criar Lista', en:'Create List', es:'Crear lista', fr:'Créer une liste'},
  'Criar Usuário': {pt:'Criar Usuário', en:'Create User', es:'Crear usuario', fr:'Créer un utilisateur'},
  'Crie uma conta do tipo Investimentos primeiro': {pt:'Crie uma conta do tipo Investimentos primeiro', en:'Create an investment account first', es:'Cree primero una cuenta de inversiones', fr:'Créez d\'abord un compte investissements'},
  'Criptomoeda': {pt:'Criptomoeda', en:'Cryptocurrency', es:'Criptomoneda', fr:'Cryptomonnaie'},
  'Câmbio': {pt:'Câmbio', en:'Exchange rate', es:'Tipo de cambio', fr:'Taux de change'},
  'Código': {pt:'Código', en:'Code', es:'Código', fr:'Code'},
  'Data de fim': {pt:'Data de fim', en:'End date', es:'Fecha de fin', fr:'Date de fin'},
  'Data de início': {pt:'Data de início', en:'Start date', es:'Fecha de inicio', fr:'Date de début'},
  'Data de início *': {pt:'Data de início *', en:'Start date *', es:'Fecha de inicio *', fr:'Date de début *'},
  'Dentro do orçamento': {pt:'Dentro do orçamento', en:'Within budget', es:'Dentro del presupuesto', fr:'Dans le budget'},
  'Desconectar': {pt:'Desconectar', en:'Disconnect', es:'Desconectar', fr:'Déconnecter'},
  'Desmarcar tudo': {pt:'Desmarcar tudo', en:'Unmark all', es:'Desmarcar todo', fr:'Tout décocher'},
  'Despesas por Categoria': {pt:'Despesas por Categoria', en:'Expenses by Category', es:'Gastos por categoría', fr:'Dépenses par catégorie'},
  'Despesas por categoria': {pt:'Despesas por categoria', en:'Expenses by category', es:'Gastos por categoría', fr:'Dépenses par catégorie'},
  'Detalhamento por Categoria': {pt:'Detalhamento por Categoria', en:'Category Breakdown', es:'Desglose por categoría', fr:'Détail par catégorie'},
  'Detalhes da transação': {pt:'Detalhes da transação', en:'Transaction details', es:'Detalles de transacción', fr:'Détails de la transaction'},
  'Dias': {pt:'Dias', en:'Days', es:'Días', fr:'Jours'},
  'Distribuição por Categoria': {pt:'Distribuição por Categoria', en:'Distribution by Category', es:'Distribución por categoría', fr:'Distribution par catégorie'},
  'Distribuição por Conta': {pt:'Distribuição por Conta', en:'Distribution by Account', es:'Distribución por cuenta', fr:'Distribution par compte'},
  'Editar Beneficiário': {pt:'Editar Beneficiário', en:'Edit Payee', es:'Editar beneficiario', fr:'Modifier le bénéficiaire'},
  'Editar Conta': {pt:'Editar Conta', en:'Edit Account', es:'Editar cuenta', fr:'Modifier le compte'},
  'Editar Grupo': {pt:'Editar Grupo', en:'Edit Group', es:'Editar grupo', fr:'Modifier le groupe'},
  'Editar Orçamento': {pt:'Editar Orçamento', en:'Edit Budget', es:'Editar presupuesto', fr:'Modifier le budget'},
  'Editar Programado': {pt:'Editar Programado', en:'Edit Scheduled', es:'Editar programado', fr:'Modifier le programmé'},
  'Editar Transação': {pt:'Editar Transação', en:'Edit Transaction', es:'Editar transacción', fr:'Modifier la transaction'},
  'Edite a categoria para mudar seu pai': {pt:'Edite a categoria para mudar seu pai', en:'Edit the category to change its parent', es:'Edite la categoría para cambiar su padre', fr:'Modifiez la catégorie pour changer son parent'},
  'Endereço': {pt:'Endereço', en:'Address', es:'Dirección', fr:'Adresse'},
  'Erro ao carregar': {pt:'Erro ao carregar', en:'Error loading', es:'Error al cargar', fr:'Erreur lors du chargement'},
  'Erro ao excluir': {pt:'Erro ao excluir', en:'Error deleting', es:'Error al eliminar', fr:'Erreur lors de la suppression'},
  'Erro ao salvar': {pt:'Erro ao salvar', en:'Error saving', es:'Error al guardar', fr:'Erreur lors de l\'enregistrement'},
  'Estabelecimento': {pt:'Estabelecimento', en:'Store', es:'Establecimiento', fr:'Établissement'},
  'Estabelecimentos': {pt:'Estabelecimentos', en:'Stores', es:'Establecimientos', fr:'Établissements'},
  'Estado': {pt:'Estado', en:'State', es:'Estado', fr:'État'},
  'Etiqueta': {pt:'Etiqueta', en:'Tag', es:'Etiqueta', fr:'Étiquette'},
  'Etiquetas': {pt:'Etiquetas', en:'Tags', es:'Etiquetas', fr:'Étiquettes'},
  'Evolução Mensal': {pt:'Evolução Mensal', en:'Monthly Trend', es:'Evolución mensual', fr:'Évolution mensuelle'},
  'Evolução das categorias marcadas': {pt:'Evolução das categorias marcadas', en:'Tracked categories trend', es:'Evolución de categorías seguidas', fr:'Évolution des catégories suivies'},
  'Excluir Categoria': {pt:'Excluir Categoria', en:'Delete Category', es:'Eliminar categoría', fr:'Supprimer la catégorie'},
  'Excluir Conta': {pt:'Excluir Conta', en:'Delete Account', es:'Eliminar cuenta', fr:'Supprimer le compte'},
  'Excluir Grupo': {pt:'Excluir Grupo', en:'Delete Group', es:'Eliminar grupo', fr:'Supprimer le groupe'},
  'Excluir Orçamento': {pt:'Excluir Orçamento', en:'Delete Budget', es:'Eliminar presupuesto', fr:'Supprimer le budget'},
  'Excluir Transação': {pt:'Excluir Transação', en:'Delete Transaction', es:'Eliminar transacción', fr:'Supprimer la transaction'},
  'Excluída': {pt:'Excluída', en:'Deleted', es:'Eliminada', fr:'Supprimée'},
  'Exportar PDF': {pt:'Exportar PDF', en:'Export PDF', es:'Exportar PDF', fr:'Exporter PDF'},
  'Família preferida': {pt:'Família preferida', en:'Preferred family', es:'Familia preferida', fr:'Famille préférée'},
  'Fatura do cartão': {pt:'Fatura do cartão', en:'Card bill', es:'Factura de tarjeta', fr:'Facture de carte'},
  'Favoritas': {pt:'Favoritas', en:'Favorites', es:'Favoritas', fr:'Favoris'},
  'Fechar lista': {pt:'Fechar lista', en:'Close list', es:'Cerrar lista', fr:'Fermer la liste'},
  'Fluxo de Caixa': {pt:'Fluxo de Caixa', en:'Cash Flow', es:'Flujo de caja', fr:'Flux de trésorerie'},
  'Fluxo de Caixa e Gráficos': {pt:'Fluxo de Caixa e Gráficos', en:'Cash Flow & Charts', es:'Flujo de caja y gráficos', fr:'Flux de trésorerie et graphiques'},
  'Fonte pagadora': {pt:'Fonte pagadora', en:'Payer', es:'Fuente pagadora', fr:'Source de paiement'},
  'Foto': {pt:'Foto', en:'Photo', es:'Foto', fr:'Photo'},
  'Foto de perfil': {pt:'Foto de perfil', en:'Profile photo', es:'Foto de perfil', fr:'Photo de profil'},
  'Fundo': {pt:'Fundo', en:'Fund', es:'Fondo', fr:'Fonds'},
  'Grupo': {pt:'Grupo', en:'Group', es:'Grupo', fr:'Groupe'},
  'Grupo de contas': {pt:'Grupo de contas', en:'Account group', es:'Grupo de cuentas', fr:'Groupe de comptes'},
  'Grupo removido': {pt:'Grupo removido', en:'Group removed', es:'Grupo eliminado', fr:'Groupe supprimé'},
  'Grupo salvo!': {pt:'Grupo salvo!', en:'Group saved!', es:'¡Grupo guardado!', fr:'Groupe enregistré !'},
  'Histórico recente de lançamentos': {pt:'Histórico recente de lançamentos', en:'Recent transaction history', es:'Historial reciente de transacciones', fr:'Historique récent des transactions'},
  'IOF': {pt:'IOF', en:'IOF', es:'IOF', fr:'IOF'},
  'Imagem': {pt:'Imagem', en:'Image', es:'Imagen', fr:'Image'},
  'Inativos': {pt:'Inativos', en:'Inactive', es:'Inactivos', fr:'Inactifs'},
  'Informe o nome': {pt:'Informe o nome', en:'Enter the name', es:'Ingrese el nombre', fr:'Saisissez le nom'},
  'Integração com EmailJS': {pt:'Integração com EmailJS', en:'EmailJS integration', es:'Integración con EmailJS', fr:'Intégration EmailJS'},
  'Item adicionado': {pt:'Item adicionado', en:'Item added', es:'Artículo agregado', fr:'Article ajouté'},
  'Itens sem equivalência no catálogo de preços': {pt:'Itens sem equivalência no catálogo de preços', en:'Items without price catalog match', es:'Artículos sin equivalencia en el catálogo', fr:'Articles sans correspondance dans le catalogue'},
  'Limite': {pt:'Limite', en:'Limit', es:'Límite', fr:'Limite'},
  'Limpar': {pt:'Limpar', en:'Clear', es:'Limpiar', fr:'Effacer'},
  'Linhas': {pt:'Linhas', en:'Lines', es:'Líneas', fr:'Lignes'},
  'Logo': {pt:'Logo', en:'Logo', es:'Logo', fr:'Logo'},
  'Lucro/Prejuízo': {pt:'Lucro/Prejuízo', en:'Profit/Loss', es:'Ganancia/Pérdida', fr:'Profit/Perte'},
  'Marcar como confirmada': {pt:'Marcar como confirmada', en:'Mark as confirmed', es:'Marcar como confirmada', fr:'Marquer comme confirmée'},
  'Marcar como pendente': {pt:'Marcar como pendente', en:'Mark as pending', es:'Marcar como pendiente', fr:'Marquer comme en attente'},
  'Marcar tudo': {pt:'Marcar tudo', en:'Mark all', es:'Marcar todo', fr:'Tout cocher'},
  'Membro': {pt:'Membro', en:'Member', es:'Miembro', fr:'Membre'},
  'Membros': {pt:'Membros', en:'Members', es:'Miembros', fr:'Membres'},
  'Membros da família': {pt:'Membros da família', en:'Family members', es:'Miembros de la familia', fr:'Membres de la famille'},
  'Memo': {pt:'Memo', en:'Memo', es:'Memo', fr:'Mémo'},
  'Meses': {pt:'Meses', en:'Months', es:'Meses', fr:'Mois'},
  'Minha família': {pt:'Minha família', en:'My family', es:'Mi familia', fr:'Ma famille'},
  'Minhas Contas': {pt:'Minhas Contas', en:'My Accounts', es:'Mis cuentas', fr:'Mes comptes'},
  'Modo de câmbio': {pt:'Modo de câmbio', en:'Exchange mode', es:'Modo de cambio', fr:'Mode de change'},
  'Mês corrente': {pt:'Mês corrente', en:'Current month', es:'Mes corriente', fr:'Mois en cours'},
  'Módulos da Família': {pt:'Módulos da Família', en:'Family Modules', es:'Módulos de familia', fr:'Modules de la famille'},
  'Na lista': {pt:'Na lista', en:'In list', es:'En lista', fr:'Dans la liste'},
  'Nenhum beneficiário encontrado': {pt:'Nenhum beneficiário encontrado', en:'No payees found', es:'No se encontraron beneficiarios', fr:'Aucun bénéficiaire trouvé'},
  'Nenhum grupo criado ainda.': {pt:'Nenhum grupo criado ainda.', en:'No groups created yet.', es:'Aún no se han creado grupos.', fr:'Aucun groupe créé pour l\'instant.'},
  'Nenhum registro encontrado': {pt:'Nenhum registro encontrado', en:'No records found', es:'No se encontraron registros', fr:'Aucun enregistrement trouvé'},
  'Nenhuma': {pt:'Nenhuma', en:'None', es:'Ninguna', fr:'Aucune'},
  'Nenhuma categoria encontrada': {pt:'Nenhuma categoria encontrada', en:'No categories found', es:'No se encontraron categorías', fr:'Aucune catégorie trouvée'},
  'Nenhuma transação no período': {pt:'Nenhuma transação no período', en:'No transactions in period', es:'Sin transacciones en el período', fr:'Aucune transaction dans la période'},
  'Nenhuma transação para este filtro': {pt:'Nenhuma transação para este filtro', en:'No transactions for this filter', es:'Sin transacciones para este filtro', fr:'Aucune transaction pour ce filtre'},
  'Nome atualizado': {pt:'Nome atualizado', en:'Name updated', es:'Nombre actualizado', fr:'Nom mis à jour'},
  'Nome de exibição': {pt:'Nome de exibição', en:'Display name', es:'Nombre de visualización', fr:'Nom d\'affichage'},
  'Notas': {pt:'Notas', en:'Notes', es:'Notas', fr:'Notes'},
  'Nova lista': {pt:'Nova lista', en:'New list', es:'Nueva lista', fr:'Nouvelle liste'},
  'Nova subcategoria': {pt:'Nova subcategoria', en:'New subcategory', es:'Nueva subcategoría', fr:'Nouvelle sous-catégorie'},
  'Novo Estabelecimento': {pt:'Novo Estabelecimento', en:'New Store', es:'Nuevo establecimiento', fr:'Nouvel établissement'},
  'Nunca': {pt:'Nunca', en:'Never', es:'Nunca', fr:'Jamais'},
  'Ontem': {pt:'Ontem', en:'Yesterday', es:'Ayer', fr:'Hier'},
  'Orçamento': {pt:'Orçamento', en:'Budget', es:'Presupuesto', fr:'Budget'},
  'Outro': {pt:'Outro', en:'Other', es:'Otro', fr:'Autre'},
  'Outros': {pt:'Outros', en:'Others', es:'Otros', fr:'Autres'},
  'Overdue': {pt:'Overdue', en:'Overdue', es:'Atrasado', fr:'En retard'},
  'Padrão': {pt:'Padrão', en:'Default', es:'Predeterminado', fr:'Par défaut'},
  'Pagamento de fatura': {pt:'Pagamento de fatura', en:'Bill payment', es:'Pago de factura', fr:'Paiement de facture'},
  'Papel': {pt:'Papel', en:'Role', es:'Rol', fr:'Rôle'},
  'Pausado': {pt:'Pausado', en:'Paused', es:'Pausado', fr:'En pause'},
  'País': {pt:'País', en:'Country', es:'País', fr:'Pays'},
  'Pendente de aprovação': {pt:'Pendente de aprovação', en:'Pending approval', es:'Pendiente de aprobación', fr:'En attente d\'approbation'},
  'Percentual': {pt:'Percentual', en:'Percentage', es:'Porcentaje', fr:'Pourcentage'},
  'Personalizar Dashboard': {pt:'Personalizar Dashboard', en:'Customize Dashboard', es:'Personalizar panel', fr:'Personnaliser le tableau de bord'},
  'Pessoa física': {pt:'Pessoa física', en:'Individual', es:'Persona física', fr:'Particulier'},
  'Pessoa jurídica': {pt:'Pessoa jurídica', en:'Company', es:'Empresa', fr:'Société'},
  'Pizza': {pt:'Pizza', en:'Pie', es:'Torta', fr:'Camembert'},
  'Preço': {pt:'Preço', en:'Price', es:'Precio', fr:'Prix'},
  'Preço médio de custo': {pt:'Preço médio de custo', en:'Average cost price', es:'Precio promedio de costo', fr:'Prix de revient moyen'},
  'Preço unitário': {pt:'Preço unitário', en:'Unit price', es:'Precio unitario', fr:'Prix unitaire'},
  'Programar': {pt:'Programar', en:'Schedule', es:'Programar', fr:'Programmer'},
  'Proprietário': {pt:'Proprietário', en:'Owner', es:'Propietario', fr:'Propriétaire'},
  'Próxima execução': {pt:'Próxima execução', en:'Next run', es:'Próxima ejecución', fr:'Prochaine exécution'},
  'Quantidade': {pt:'Quantidade', en:'Quantity', es:'Cantidad', fr:'Quantité'},
  'Quantidade de cotas': {pt:'Quantidade de cotas', en:'Number of units', es:'Cantidad de unidades', fr:'Nombre d\'unités'},
  'Quinzenal': {pt:'Quinzenal', en:'Biweekly', es:'Quincenal', fr:'Bimensuel'},
  'Recarregar': {pt:'Recarregar', en:'Reload', es:'Recargar', fr:'Recharger'},
  'Receitas por Categoria': {pt:'Receitas por Categoria', en:'Income by Category', es:'Ingresos por categoría', fr:'Revenus par catégorie'},
  'Receitas por categoria': {pt:'Receitas por categoria', en:'Income by category', es:'Ingresos por categoría', fr:'Revenus par catégorie'},
  'Reconciliada': {pt:'Reconciliada', en:'Reconciled', es:'Conciliada', fr:'Rapprochée'},
  'Registrar Compra com IA': {pt:'Registrar Compra com IA', en:'Register purchase with AI', es:'Registrar compra con IA', fr:'Enregistrer l\'achat avec IA'},
  'Registrar agora': {pt:'Registrar agora', en:'Register now', es:'Registrar ahora', fr:'Enregistrer maintenant'},
  'Registrar preço': {pt:'Registrar preço', en:'Record price', es:'Registrar precio', fr:'Enregistrer le prix'},
  'Remover': {pt:'Remover', en:'Remove', es:'Eliminar', fr:'Supprimer'},
  'Remover foto': {pt:'Remover foto', en:'Remove photo', es:'Quitar foto', fr:'Supprimer la photo'},
  'Renda Fixa': {pt:'Renda Fixa', en:'Fixed income', es:'Renta fija', fr:'Revenu fixe'},
  'Renda Variável': {pt:'Renda Variável', en:'Variable income', es:'Renta variable', fr:'Revenu variable'},
  'Rendimento': {pt:'Rendimento', en:'Yield', es:'Rendimiento', fr:'Rendement'},
  'Rentabilidade': {pt:'Rentabilidade', en:'Return', es:'Rentabilidad', fr:'Rendement'},
  'Repetir': {pt:'Repetir', en:'Repeat', es:'Repetir', fr:'Répéter'},
  'Repetições': {pt:'Repetições', en:'Repetitions', es:'Repeticiones', fr:'Répétitions'},
  'Restaurar Backup': {pt:'Restaurar Backup', en:'Restore backup', es:'Restaurar respaldo', fr:'Restaurer la sauvegarde'},
  'Resumo do Período': {pt:'Resumo do Período', en:'Period Summary', es:'Resumen del período', fr:'Résumé de la période'},
  'Rosca': {pt:'Rosca', en:'Donut', es:'Rosca', fr:'Anneau'},
  'Saldo Brasileiro (BRL)': {pt:'Saldo Brasileiro (BRL)', en:'Brazilian Balance (BRL)', es:'Saldo brasileño (BRL)', fr:'Solde brésilien (BRL)'},
  'Saldo atual': {pt:'Saldo atual', en:'Current balance', es:'Saldo actual', fr:'Solde actuel'},
  'Saldo da conta': {pt:'Saldo da conta', en:'Account balance', es:'Saldo de cuenta', fr:'Solde du compte'},
  'Saldo final': {pt:'Saldo final', en:'Final balance', es:'Saldo final', fr:'Solde final'},
  'Saldo previsto': {pt:'Saldo previsto', en:'Projected balance', es:'Saldo previsto', fr:'Solde prévu'},
  'Salvo': {pt:'Salvo', en:'Saved', es:'Guardado', fr:'Enregistré'},
  'Salvo com sucesso': {pt:'Salvo com sucesso', en:'Saved successfully', es:'Guardado con éxito', fr:'Enregistré avec succès'},
  'Selecionar': {pt:'Selecionar', en:'Select', es:'Seleccionar', fr:'Sélectionner'},
  'Selecione a categoria destino': {pt:'Selecione a categoria destino', en:'Select target category', es:'Seleccione la categoría destino', fr:'Sélectionnez la catégorie cible'},
  'Sem beneficiário': {pt:'Sem beneficiário', en:'No payee', es:'Sin beneficiario', fr:'Sans bénéficiaire'},
  'Sem categoria': {pt:'Sem categoria', en:'No category', es:'Sin categoría', fr:'Sans catégorie'},
  'Sem data de fim': {pt:'Sem data de fim', en:'No end date', es:'Sin fecha de fin', fr:'Sans date de fin'},
  'Sem subcategorias': {pt:'Sem subcategorias', en:'No subcategories', es:'Sin subcategorías', fr:'Aucune sous-catégorie'},
  'Sem transações': {pt:'Sem transações', en:'No transactions', es:'Sin transacciones', fr:'Aucune transaction'},
  'Semanas': {pt:'Semanas', en:'Weeks', es:'Semanas', fr:'Semaines'},
  'Sempre': {pt:'Sempre', en:'Always', es:'Siempre', fr:'Toujours'},
  'Sempre visível': {pt:'Sempre visível', en:'Always visible', es:'Siempre visible', fr:'Toujours visible'},
  'Senha atual': {pt:'Senha atual', en:'Current password', es:'Contraseña actual', fr:'Mot de passe actuel'},
  'Sincronizar': {pt:'Sincronizar', en:'Sync', es:'Sincronizar', fr:'Synchroniser'},
  'Site': {pt:'Site', en:'Website', es:'Sitio web', fr:'Site web'},
  'Subcategoria': {pt:'Subcategoria', en:'Subcategory', es:'Subcategoría', fr:'Sous-catégorie'},
  'Subcategorias': {pt:'Subcategorias', en:'Subcategories', es:'Subcategorías', fr:'Sous-catégories'},
  'Subtotal': {pt:'Subtotal', en:'Subtotal', es:'Subtotal', fr:'Sous-total'},
  'Tag': {pt:'Tag', en:'Tag', es:'Etiqueta', fr:'Étiquette'},
  'Tags': {pt:'Tags', en:'Tags', es:'Etiquetas', fr:'Étiquettes'},
  'Taxa de câmbio': {pt:'Taxa de câmbio', en:'Exchange rate', es:'Tipo de cambio', fr:'Taux de change'},
  'Telefone': {pt:'Telefone', en:'Phone', es:'Teléfono', fr:'Téléphone'},
  'Tema claro': {pt:'Tema claro', en:'Light theme', es:'Tema claro', fr:'Thème clair'},
  'Tema escuro': {pt:'Tema escuro', en:'Dark theme', es:'Tema oscuro', fr:'Thème sombre'},
  'Testar': {pt:'Testar', en:'Test', es:'Probar', fr:'Tester'},
  'Teste': {pt:'Teste', en:'Test', es:'Prueba', fr:'Test'},
  'Ticker': {pt:'Ticker', en:'Ticker', es:'Símbolo', fr:'Symbole'},
  'Tipo de categoria': {pt:'Tipo de categoria', en:'Category type', es:'Tipo de categoría', fr:'Type de catégorie'},
  'Todas as categorias': {pt:'Todas as categorias', en:'All categories', es:'Todas las categorías', fr:'Toutes les catégories'},
  'Token': {pt:'Token', en:'Token', es:'Token', fr:'Token'},
  'Total em BRL': {pt:'Total em BRL', en:'Total in BRL', es:'Total en BRL', fr:'Total en BRL'},
  'Transação': {pt:'Transação', en:'Transaction', es:'Transacción', fr:'Transaction'},
  'Transações Programadas': {pt:'Transações Programadas', en:'Scheduled Transactions', es:'Transacciones programadas', fr:'Transactions programmées'},
  'Transferências': {pt:'Transferências', en:'Transfers', es:'Transferencias', fr:'Virements'},
  'URL': {pt:'URL', en:'URL', es:'URL', fr:'URL'},
  'Usuário': {pt:'Usuário', en:'User', es:'Usuario', fr:'Utilisateur'},
  'Valor atual': {pt:'Valor atual', en:'Current value', es:'Valor actual', fr:'Valeur actuelle'},
  'Ver': {pt:'Ver', en:'View', es:'Ver', fr:'Voir'},
  'Ver histórico': {pt:'Ver histórico', en:'View history', es:'Ver historial', fr:'Voir l\'historique'},
  'Ver mais': {pt:'Ver mais', en:'View more', es:'Ver más', fr:'Voir plus'},
  'Vincular transferência': {pt:'Vincular transferência', en:'Link transfer', es:'Vincular transferencia', fr:'Lier le virement'},
  'Visualizador': {pt:'Visualizador', en:'Viewer', es:'Visualizador', fr:'Lecteur'},
  'WhatsApp': {pt:'WhatsApp', en:'WhatsApp', es:'WhatsApp', fr:'WhatsApp'},
  'registros': {pt:'registros', en:'records', es:'registros', fr:'enregistrements'},
  'saldo final prev.': {pt:'saldo final prev.', en:'projected balance', es:'saldo final prev.', fr:'solde final prévu'},
  'transação': {pt:'transação', en:'transaction', es:'transacción', fr:'transaction'},
  'transações': {pt:'transações', en:'transactions', es:'transacciones', fr:'transactions'},
  'Ícone': {pt:'Ícone', en:'Icon', es:'Ícono', fr:'Icône'},
  'Última conta usada:': {pt:'Última conta usada:', en:'Last account used:', es:'Última cuenta usada:', fr:'Dernier compte utilisé:'},
  'Última execução': {pt:'Última execução', en:'Last run', es:'Última ejecución', fr:'Dernière exécution'},
  'Último preço': {pt:'Último preço', en:'Last price', es:'Último precio', fr:'Dernier prix'},

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
  const isDoc = (scope === document);

  // 1. data-i18n explicit keys (highest priority, exact mapping)
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

  // 2. Placeholders
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key);
  });

  // 3. Title/aria-label
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  // 4. HTML content
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });

  // 5. Text-node engine — translates ALL visible text in the DOM
  //    by matching against the PT→key reverse map.
  //    Only runs when language is not PT (no-op for default language).
  if (_i18nLang !== 'pt') {
    // For full document: scope to app shell (skip login screen)
    const walkRoot = isDoc
      ? (document.getElementById('mainApp') || document.getElementById('sidebar') || scope)
      : scope;
    _i18nWalkTextNodes(walkRoot);
    // Also walk sidebar explicitly (it's outside mainApp)
    if (isDoc) {
      const sb = document.getElementById('sidebar');
      if (sb) _i18nWalkTextNodes(sb);
    }
  }
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


// ── Reverse-map text-node engine ─────────────────────────────────────────────
// Maps Portuguese text → translation key, built from _I18N_BUILTIN at runtime.
// This allows translating ALL rendered content — JS innerHTML, static HTML,
// without requiring data-i18n on every element.
let _i18nReverseMap = null; // { 'pt text': 'key' }

function _i18nBuildReverseMap() {
  _i18nReverseMap = {};
  for (const [key, langs] of Object.entries(_I18N_BUILTIN)) {
    const ptText = langs.pt;
    if (ptText) _i18nReverseMap[ptText.trim()] = key;
  }
}

/**
 * Translate a single text string using the builtin dict.
 * Falls back to returning the original string if not found.
 */
function _i18nTranslateText(text) {
  if (_i18nLang === 'pt') return text; // no-op for Portuguese
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 1. Try direct dict lookup (DB translations)
  if (_i18nDict[trimmed]) return text.replace(trimmed, _i18nDict[trimmed]);

  // 2. Try reverse map (PT text → key → translation)
  if (!_i18nReverseMap) _i18nBuildReverseMap();
  const key = _i18nReverseMap[trimmed];
  if (key) {
    const entry = _I18N_BUILTIN[key];
    if (entry) {
      const translated = entry[_i18nLang] || entry['pt'];
      if (translated) return text.replace(trimmed, translated);
    }
  }

  return text; // untranslatable — return original
}

/**
 * Walk all visible text nodes in an element tree and translate them.
 * Skips: scripts, styles, inputs, SVGs, code, elements with data-i18n-skip.
 */
function _i18nWalkTextNodes(root) {
  if (!root || _i18nLang === 'pt') return;
  if (!_i18nReverseMap) _i18nBuildReverseMap();

  const SKIP_TAGS = new Set(['SCRIPT','STYLE','INPUT','TEXTAREA','SELECT','OPTION','CODE','PRE','SVG','PATH','USE','SYMBOL','CANVAS','NOSCRIPT']);
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-i18n-skip],[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,svg')) return NodeFilter.FILTER_REJECT;
        const text = node.textContent.trim();
        if (!text || text.length < 2) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  for (const n of nodes) {
    const original = n.textContent;
    const translated = _i18nTranslateText(original);
    if (translated !== original) n.textContent = translated;
  }
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
