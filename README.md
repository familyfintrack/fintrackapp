# Family FinTrack — Developer & AI Reference Guide

> **Purpose:** Complete technical, functional, and database reference for developers and AI assistants.
> **Version:** _46 · April 2026 | **Author:** Décio Mattar Franchini
> **Stack:** Vanilla JS PWA · Supabase (PostgreSQL + Auth + Storage) · GitHub Pages

---

## Table of Contents

1. [What this app is](#1-what-this-app-is)
2. [Architecture overview](#2-architecture-overview)
3. [Runtime boot flow](#3-runtime-boot-flow)
4. [Script load order](#4-script-load-order)
5. [Global contracts](#5-global-contracts)
6. [Auth and user management](#6-auth-and-user-management)
7. [Multi-tenant model](#7-multi-tenant-model)
8. [Module responsibilities](#8-module-responsibilities)
9. [Database schema](#9-database-schema)
10. [FX multi-currency](#10-fx-multi-currency)
11. [Transactions](#11-transactions)
12. [Reports and PDF export](#12-reports-and-pdf-export)
13. [Scheduled transactions engine](#13-scheduled-transactions-engine)
14. [Import pipeline](#14-import-pipeline)
15. [Optional modules](#15-optional-modules)
16. [Setup wizard](#16-setup-wizard)
17. [Config keys](#17-config-keys)
18. [Logo pipeline](#18-logo-pipeline)
19. [Deploy GitHub Pages](#19-deploy-github-pages)
20. [Regression checklist](#20-regression-checklist)
21. [Known pitfalls](#21-known-pitfalls)
22. [Changelog _45 to _46](#22-changelog-_45-to-_46)

---

## 1. What this app is

**Family FinTrack** is a Progressive Web Application (PWA) for personal and family financial management.
It runs entirely in the browser — no backend server, no build step. Supabase acts as BaaS.

Core capabilities:
- Multi-user per family, full data isolation by `family_id`
- Accounts + Groups (multi-currency, IOF, credit card: `best_purchase_day`, `due_day`)
- **PIX multi-key:** up to 3 PIX keys per account (`pix_keys JSONB[]`), fallback to legacy `pix_key`
- Categories (hierarchical, typed: `despesa` / `receita` / `transferencia`)
- **IOF configurável:** `iof_category_id` + `iof_payee_id` stored in `app_settings`, bulk migration via `bulkUpdateIofCategory()` / `bulkUpdateIofPayee()`, IOF button in categories/payees UI
- Payees with contact data, CNPJ/CPF, and default category. **Panoramic view** (`openPayeeDetailModal`)
- Transactions (expense / income / transfer / card payment; pending / confirmed; tags; attachments)
- **TX Splits:** category split + member share per transaction, separate modal (`txSplitModal`), also available in scheduled transactions (`scCtxDivisao` pane)
- Budgets (monthly / annual per category with `auto_reset`)
- Scheduled transactions + auto-register engine + **SC Splits** + **currency-aware registration**
- **Convert TX → Scheduled v2:** two modes — keep original + create future, or replace original
- Foreign exchange rates via api.frankfurter.app (TTL 4h, cached in `app_settings`)
- Reports: categories, transactions, forecast, budgets, **beneficiários/fontes pagadoras**
- **Forecast sign-change indicators:** visual markers when account balance crosses zero
- Import pipeline: CSV, OFX, Nubank, Inter, Itau, XP, MoneyWiz + AI mapping
- Backup/restore (full JSONB snapshot per family in `app_backups`)
- Grocery lists + price history (optional, feature-flagged per family)
- Investment portfolio: positions, transactions, market price history (feature-flagged)
- Family composition: members as business entities (not necessarily app users)
- AI receipt parsing via Google Gemini Vision → price_history
- Orphan record scanner (19 referential integrity checks across all tables)
- Setup wizard for new families (manual trigger for admins in Settings)
- **Dashboard personalization v2:** drag-and-drop order, side-by-side pairs (`_pairs`), link button (🔗), "+" button on favorite account cards, Família chip in topbar

---

## 2. Architecture overview

```
browser/PWA
├── index.html          landing page (public)
├── login.html          authentication (standalone, loads auth.js only)
│   ├── fast redirect   checks localStorage for 'family-fintrack-auth' key FIRST
│   ├── bootApp         defined synchronously before any await (prevents blank-screen bug)
│   └── storageKey      must match app.js: 'family-fintrack-auth'
├── app.html            main SPA (~11,200 lines, 60+ JS modules)
├── reset-password.html password reset flow
└── js/*.js             60 modules (see §8)

Supabase
├── Auth     JWT + PKCE · Sessions · Magic Links · 2FA (email/Telegram)
├── DB       PostgreSQL + RLS (auth_uid column on app_users)
├── Storage  transaction attachments, receipt scans
└── Vault    telegram_bot_token stored securely
```

---

## 3. Runtime boot flow

```
login.html loads
  └─ <script> fast redirect: check localStorage['family-fintrack-auth']
  └─ auth.js loads → registerMagicLinkGate
  └─ boot IIFE:
      window.bootApp = () => location.replace('app.html')   ← SYNC, before any await
      await i18nInit()
      await sb.auth.getSession()
        ├─ session found → await window.bootApp()
        └─ no session   → showLoginScreen(), switchLoginTab('password')

app.html loads
  └─ app.js → tryAutoConnect()
      └─ sb = supabase.createClient(url, key, { storageKey: 'family-fintrack-auth' })
      └─ tryRestoreSession()
          └─ sb.auth.getSession() → _loadCurrentUserContext()
          └─ returns !!currentUser
      ├─ restored → hideLoginScreen → bootApp()
      └─ not restored → showLoginScreen() → location.replace('login.html')
```

**Critical:** `supabase.js` (login context) and `app.js` (app context) must both use `storageKey: 'family-fintrack-auth'` or the session lookup fails → redirect loop.

---

## 4. Script load order

`app.html` loads JS in this order (sequence matters for dependency resolution):

```
state, cursor, db, utils, settings, config, app, accounts, categories, payees,
transactions, budgets, fx_rates, dashboard, reports, payee_autocomplete,
ui_helpers, scheduled, attachments, iof, forecast, email, import, backup,
auth, admin, autocheck, auto_register, audit, receipt_ai, prices, grocery,
import_ai, family_members_composition, investments, orphan, wizard,
[+ agent, agent_capabilities, agent_engine, ai_insights, telemetry, …]
```

`login.html` only loads: `supabase.js`, `config.js`, `settings.js`, `autocheck.js`, `auto_register.js`, `auth.js`

---

## 5. Global contracts

| Symbol | Defined in | Purpose |
|---|---|---|
| `state{}` | `state.js` (`var`) | Shared mutable app state |
| `sb` | `supabase.js` / `app.js` | Supabase client (storageKey: 'family-fintrack-auth') |
| `currentUser` | `auth.js` | Logged-in user object |
| `famQ(query)` | `auth.js` | Adds `.eq('family_id', …)` filter |
| `famId()` | `auth.js` | Returns `currentUser.family_id` |
| `DB.*` | `db.js` | TTL-cached data access layer |
| `toast(msg, type)` | `utils.js` | Toast notifications |
| `fmt(val, cur)` | `utils.js` | Formats currency values |
| `fmtDate(str)` | `utils.js` | Formats ISO date → dd/mm/yyyy |
| `openModal(id)` | `utils.js` | Opens modal overlay |
| `closeModal(id)` | `utils.js` | Closes modal overlay |
| `getAmtField(id)` | `utils.js` | Reads formatted amount field |
| `setAmtField(id, v)` | `utils.js` | Sets formatted amount field |
| `navigate(page)` | `app.js` | SPA page navigation |
| `toBRL(v, cur)` | `fx_rates.js` | Converts amount to BRL |
| `ICON_META` | `ui_helpers.js` | Icon metadata registry |
| `_txSplitCatMode` | `tx_splits.js` | Cat picker routing for splits |
| `window.bootApp` | `login.html` / `app.js` | Post-login redirect handler |

---

## 6. Auth and user management

### Session storage
- Key: `family-fintrack-auth` in localStorage (set via `storageKey` in `createClient`)
- **Must be identical** in `supabase.js` (login context) and `app.js` (app context)

### Login flow
1. `doLogin()` → verifies `app_users.approved` → `_loadCurrentUserContext()` → `onLoginSuccess()` → `bootApp()`
2. `onLoginSuccess()` hides login screen, calls `bootApp()` (redirect in login context, app render in app context)
3. Magic link flow via `_registerMagicLinkGate` → same pipeline
4. 2FA via `doVerify2FA()` — robust try/catch, fallback redirect to `app.html`

### RLS architecture
- `app_users.auth_uid` = `auth.uid()` (populated on first login, fallback by email)
- Three `SECURITY DEFINER` functions: `ft_get_my_app_user_id()`, `ft_get_my_family_ids()`, `ft_is_admin()`
- All queries filtered by `family_id` via `famQ()`

---

## 7. Multi-tenant model

```
app_users (global registry)
  └─ family_members → families
       └─ transactions, accounts, categories, budgets, scheduled_transactions…
```

- `currentUser.families[]` = list of families user has access to
- `currentUser.family_id` = currently active family (switchable via topbar chip or user menu)
- `_pairs` in dashboard prefs = side-by-side card layout [[cardA, cardB], …]

---

## 8. Module responsibilities

| Module | Responsibility |
|---|---|
| `auth.js` | Authentication, session, user context, 2FA, login UI |
| `app.js` | Boot, routing (`navigate()`), topbar, permission gates |
| `state.js` | Global `state{}` object (accounts, categories, payees, …) |
| `db.js` | TTL cache (accounts 2min, categories 5min, payees 2min) |
| `accounts.js` | Account CRUD, PIX multi-key (`pix_keys[]`), account modal |
| `categories.js` | Category CRUD, IOF button (`setIofCategoryTarget`) |
| `payees.js` | Payee CRUD, IOF button (`setIofPayeeTarget`), panoramic view |
| `transactions.js` | TX list, filter (account badge), edit modal, convert→scheduled v2 |
| `tx_splits.js` | Split modal (`txSplitModal`), SC splits, cat/member split logic |
| `iof.js` | IOF detection, configurable category/payee, bulk migration |
| `scheduled.js` | Scheduled TXs, auto-register, SC splits pane, currency-aware registration |
| `forecast.js` | Cash-flow forecast, sign-change indicators (crossedToNeg/Pos) |
| `reports.js` | Reports: regular, transactions, forecast, budgets, **beneficiários** |
| `dashboard.js` | Dashboard cards, personalization (`_pairs`, `_dashToggleLink`), fav account "+" |
| `budgets.js` | Budget CRUD and progress tracking |
| `investments.js` | Investment portfolio (optional module) |
| `dreams.js` | Financial dreams / goals |
| `ui_helpers.js` | Category picker (fixed-pos), icon picker, split routing |
| `help.js` | In-app help center (client-side, no DB) |
| `supabase.js` | Bootstrap `sb` global for login context |

---

## 9. Database schema

### Key tables

| Table | Key columns |
|---|---|
| `app_users` | `id`, `auth_uid`, `family_id`, `role`, `two_fa_enabled`, `two_fa_channel`, `notify_login` |
| `families` | `id`, `name` |
| `family_members` | `user_id`, `family_id`, `role` |
| `accounts` | `id`, `family_id`, `name`, `type`, `currency`, `balance`, `iof_rate`, `pix_key`, `pix_keys` (JSONB) |
| `transactions` | `id`, `family_id`, `date`, `amount`, `brl_amount`, `currency`, `exchange_rate`, `account_id`, `category_id`, `payee_id`, `tags`, `status`, `is_transfer`, `is_card_payment`, `category_splits`, `member_shares` |
| `categories` | `id`, `family_id`, `name`, `type`, `color`, `icon`, `parent_id` |
| `payees` | `id`, `family_id`, `name`, `type` (`beneficiario` / `fonte_pagadora`), `category_id` |
| `budgets` | `id`, `family_id`, `category_id`, `amount`, `period`, `auto_reset` |
| `scheduled_transactions` | `id`, `family_id`, `type`, `amount`, `currency`, `fx_rate`, `category_splits`, `member_shares` |
| `scheduled_occurrences` | `id`, `scheduled_id`, `scheduled_date`, `execution_status`, `execution_token` |
| `app_settings` | `family_id`, `key`, `value` — incl. `iof_category_id`, `iof_payee_id` |

### RLS pattern
```sql
-- All queries use auth_uid (not app_users.id)
CREATE POLICY "family_isolation" ON transactions
  USING (family_id = ANY(ft_get_my_family_ids()));
```

---

## 10. FX multi-currency

- Rates fetched from `api.frankfurter.app` (TTL 4h, stored in `app_settings`)
- `toBRL(amount, currency)` converts any amount to BRL using cached rates
- Transactions store `amount` (native currency), `brl_amount` (converted), `currency`, `exchange_rate`
- **Scheduled TX currency:** `processScheduledOccurrence()` reads `sc.currency`, `sc.fx_rate` → writes `brl_amount` to created transaction
- IOF: calculated on `brl_amount` (not native amount)

---

## 11. Transactions

### Fields
```js
{
  amount,          // native currency (negative = expense)
  brl_amount,      // converted to BRL
  currency,        // ISO code
  exchange_rate,   // rate used
  category_splits, // [{category_id, category_name, amount}]
  member_shares,   // [{user_id, name, amount|pct}]
  tags,            // string[]
  status,          // 'confirmed' | 'pending'
  is_transfer,
  is_card_payment,
  transfer_to_account_id
}
```

### TX Splits (modal)
- Button `txSplitOpenBtn` → `_openSplitModal()` → renders `txSplitModal`
- Sub-tabs: **Por Categoria** (cat picker routing via `_txSplitCatMode`) and **Por Membro**
- `txSplitShowModalTab(tab)` switches sub-tabs
- `_txSplitRenderCatModal()` / `_txSplitRenderMemModal()` render rows into modal panes

### Account filter badge
- `txAccountBadge` / `txAccountBadgeLabel` — shows when account filter active
- `clearTxAccountFilter()` — clears account filter and reloads

### Convert → Scheduled v2
- `convertTxToScheduled(txId)` → opens `convertToScheduledModal`
- Two modes: `keep` (original stays) / `convert` (original deleted, saldo revertido)
- `ctsUpdateMode()` updates UI based on radio selection

---

## 12. Reports and PDF export

### Report views
| View | ID | Description |
|---|---|---|
| Análise | `reportRegularView` | Category bar chart + KPIs |
| Transações | `reportTxView` | Grouped transaction list |
| Previsão | `reportForecastView` | Cash flow forecast |
| Orçamentos | `reportBudgetView` | Budget progress |
| **Beneficiários** | `reportBeneficiariosView` | **New** — payee/source analytics |

### Beneficiários report
- `loadBeneficiariosReport()` / `rbtbInitFilters()` in `reports.js`
- Filters: period (month/quarter/year/last12/custom), accounts (multi), categories (multi), type, sort
- Drill-down: click payee → `rbtbDrill` panel with TX list
- `setReportView('beneficiarios')` — hides global filter bar, shows own filter panel

### setReportView
```js
setReportView(view)  // 'regular'|'transactions'|'forecast'|'budgets'|'beneficiarios'
```
- Hides `rptFilterWrap` for forecast/budgets/beneficiarios
- Updates active tab button

---

## 13. Scheduled transactions engine

### Auto-register
- `processScheduledOccurrence(sc, opts)` — creates transaction from scheduled
- **Currency-aware:** reads `sc.currency`, `sc.fx_rate` → writes `currency`, `brl_amount`, `exchange_rate`
- **SC Splits:** `category_splits` and `member_shares` from SC are propagated to created TX
- Idempotency via `execution_token` + `scheduled_occurrences.execution_status`

### SC Splits pane
- Tab: `scTabDivisao` → pane `scCtxDivisao` in scheduled modal
- Pane IDs: `scSplitCatPane`, `scCatSplitRows`, `scSplitMemPane`, `scMemSplitRows`, etc.
- JS: `scSplitShowTab()`, `scCatSplitAddRow()`, `scMemSplitAddRow()`, `scCatSplitReceiveCategory()`

### Convert TX → Scheduled v2
- `convertTxToScheduled(txId)` → modal `convertToScheduledModal`
- Mode `keep`: TX stays, schedule starts next occurrence
- Mode `convert`: TX deleted + balance reversed, schedule from original date
- `ctsUpdateMode()` — updates labels/warning/date based on mode radio

---

## 14. Import pipeline

OFX / CSV / bank-specific formats → normalize → `import_ai.js` for field mapping → preview → confirm insert.
Duplicate detection via date+amount+description hashing.

---

## 15. Optional modules

All gated by `app_settings` feature flags per family:

| Module | Key | Default |
|---|---|---|
| Grocery lists | `module_grocery_enabled` | false |
| Investments | `module_investments_enabled` | false |
| AI Insights | `module_ai_insights_enabled` | false |
| Price history | `module_prices_enabled` | false |

---

## 16. Setup wizard

8-step onboarding for new families. Triggered automatically when `currentUser.family_id` is null and role is not admin/owner. Manual trigger available in Settings → Wizard.

---

## 17. Config keys (`app_settings`)

| Key | Purpose |
|---|---|
| `iof_category_id` | Default category for IOF transactions |
| `iof_payee_id` | Default payee for IOF transactions |
| `fx_rates_cache` | Cached FX rates JSON |
| `fx_rates_ts` | Timestamp of last FX fetch |
| `emailjs_*` | EmailJS credentials for 2FA email |
| `telegram_bot_token` | Telegram bot (read from Vault) |
| `module_*_enabled` | Optional module feature flags |
| `dashboard_prefs_<uid>` | Per-user dashboard card order + `_pairs` |

---

## 18. Logo pipeline

- `logo_glow_soft.png` — primary logo (transparent bg, glow effect)
- Login page: `lgn-logo-img` CSS class — **131px desktop, 100px mobile** (base ×1.30)
- Reset password: `rp-logo-img` — **109px desktop, 83px mobile** (base ×1.30)
- Landing page: inline style `height:150px` + CSS fallback `height:90px` (+25%)

---

## 19. Deploy GitHub Pages

```bash
# 1. Build ZIP from fintrackapp-main/ directory
cd fintrackapp-main && zip -r ../deploy.zip . --exclude "*.DS_Store"

# 2. Push to gh-pages branch
# GitHub Pages serves from root or /docs

# Supabase Site URL must be: https://familyfintrack.github.io/fintrackapp/
# (or wherever the app is hosted)
```

---

## 20. Regression checklist

Before each release, verify:
- [ ] `storageKey: 'family-fintrack-auth'` in both `supabase.js` AND `app.js`
- [ ] `window.bootApp` defined **synchronously** at top of login.html boot IIFE
- [ ] `lang="pt-BR"` removed from all `input[type="date"]` (causes broken display on Windows/Chrome)
- [ ] `prevBal` captured **before** `runningBalance +=` in `forecast.js`
- [ ] `processScheduledOccurrence()` includes `currency`, `brl_amount`, `exchange_rate`
- [ ] All `scheduledItems.push()` include `sc_id: sc.id, scheduledId: sc.id`
- [ ] `renderReportTxTable()` renders `<div>` rows (not `<tr>`) into `div#reportTxBody`
- [ ] `iof.js` exports: `getIofCategoryId`, `getIofPayeeId`, `bulkUpdateIofCategory`, `bulkUpdateIofPayee`
- [ ] `categories.js` has IOF button (`cat-iof-btn`) and `setIofCategoryTarget()`
- [ ] `payees.js` has IOF button and `setIofPayeeTarget()`
- [ ] `txSplitModal` and `txSplitOpenBtn` present in `app.html`
- [ ] `scCtxDivisao` pane HTML with all split IDs present in `app.html`
- [ ] `acmAddPixKeyBtn` present in PIX section of account modal
- [ ] `ctsUpdateMode` exported from `transactions.js`
- [ ] Dashboard `_pairs` system and `dash-pair-wrap` CSS intact
- [ ] `txAccountBadge` and `clearTxAccountFilter()` intact in `transactions.js`
- [ ] `loginPanelMagic` and magic link tab present in `login.html`
- [ ] `FAMÍLIA:` label (`fx-bar-family-label`) present in `app.html`

---

## 21. Known pitfalls

| Pitfall | Cause | Fix |
|---|---|---|
| Login loop (login ↔ app) | `storageKey` mismatch between `supabase.js` and `app.js` | Keep both at `'family-fintrack-auth'` |
| Blank screen after F5 | `bootApp` defined after `await` — onAuthStateChange fires first | Define `window.bootApp` synchronously before any await |
| `// 09 07 2026` in date fields | `lang="pt-BR"` on `input[type="date"]` causes broken display on Windows Chrome | Remove `lang` attribute from all date inputs |
| Forecast never shows sign-change | `prevBal` set after `runningBalance +=` (always equal) | Capture `prevBal` before increment |
| SC splits pane empty | `scCtxDivisao` div missing from `app.html` (only tab button added) | Insert full pane HTML |
| IOF tx with wrong payee | `payee_id: null` hardcoded | Use `iofPayeeId` from `getIofPayeeId()` |
| Reports TX list broken HTML | `<tr>` elements injected into `<div>` | `renderReportTxTable()` must use `<div class="rpt-tx-row">` |
| `app.css !important` overrides | Mobile overrides in `@media` inside `app.css` silently win | Always check `app.css` for mobile TX layout |

---

## 22. Changelog _45 to _46

### Security / Auth
- `storageKey: 'family-fintrack-auth'` aligned between `supabase.js` and `app.js`
- `window.bootApp` defined synchronously in login.html boot IIFE (fixes blank screen / redirect loop)
- Fast redirect in `login.html` now checks `family-fintrack-auth` key first, falls back to `sb-*` keys
- `two_fa_enabled`, `two_fa_channel`, `notify_login` added to `app_users` select
- `_safeRedirectToApp` and `switchLoginTab('password')` restored in login boot
- Magic link tab (`loginPanelMagic`) preserved

### Transactions
- Account filter badge (`txAccountBadge`, `clearTxAccountFilter`) preserved
- TX split modal (`txSplitModal`, `txSplitOpenBtn`, `txCtxDivisao`) preserved
- **Convert → Scheduled v2:** two modes (keep / convert), `ctsUpdateMode()`, warning panel
- `renderReportTxTable()` uses `div`-based rows (not broken `<tr>` in `<div>`)

### Scheduled Transactions
- `processScheduledOccurrence()` now writes `currency`, `brl_amount`, `exchange_rate`
- Currency badge in Register Occurrence modal (`occAmountCurrencyLabel`)
- **SC Splits pane** (`scCtxDivisao`) with full HTML (cat + member split)
- `sc_id: sc.id` added to all `scheduledItems.push()` in `forecast.js`

### Forecast
- `prevBal` captured before `runningBalance +=` (sign-change now fires correctly)
- Visual indicators: cross-divider bars, row highlight, inline badge
- `openScheduledModal(sc_id)` restored as click action for scheduled items

### IOF
- Full configurable system restored: `getIofCategoryId/PayeeId`, `bulkUpdateIofCategory/Payee`
- Progress modal for bulk migration
- IOF button in categories (`setIofCategoryTarget`) and payees (`setIofPayeeTarget`)

### Accounts
- PIX multi-key: up to 3 keys (`pix_keys JSONB[]`), `_acmAddPixKey`, `_acmGetPixKeys`, `acmAddPixKeyBtn`
- Legacy `pix_key` string preserved for backward compatibility

### Dashboard
- `_pairs` system for side-by-side cards preserved
- **New:** `_dashToggleLink` / `_dashApplyLinkedCards` for parallel card layout
- **New:** "+" button on favorite account cards (`_dashFavAddTx`)
- **New:** "Ver relatório completo →" link in Top Payees card
- Red/green colors in Top Payees card (beneficiários=red, fontes=green)

### Reports
- **New:** Beneficiários report view (`reportBeneficiariosView`, `loadBeneficiariosReport`)
- `rptFilterWrap` id added for JS-controlled visibility
- `setReportView` updated to include `'beneficiarios'` case

### Visual / UX
- `lang="pt-BR"` removed from all `input[type="date"]` (fixes `// date` display on Windows)
- Logos: login +30% (131px desktop), landing +25% (150px), reset +30% (109px)
- `FAMÍLIA:` label preserved in FX bar

### Help center
- New sections: **IOF Internacional**, **Dashboard — Avançado**
- New articles: PIX multi-key, IOF configurável, Dashboard personalization, Família chip, Top Payees card, Beneficiários report, Forecast sign-change indicators, SC Splits, Convert → Scheduled, Currency in occurrences

