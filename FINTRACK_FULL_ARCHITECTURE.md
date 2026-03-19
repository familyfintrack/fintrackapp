# FAMILY FINTRACK — FULL TECHNICAL ARCHITECTURE

> This document has been superseded by two updated files:
>
> - **README.md** — Complete technical, functional and database reference (786 lines, Markdown)
> - **FINTRACK_ARCHITECTURE.docx** — Professional formatted Word document with tables and diagrams
>
> Author: Décio Mattar Franchini | Version: _44 · March 2026

---

Please refer to README.md for the full content previously in this file.

The README.md covers all original sections plus new content added in versions _38–_44:

1. What this app is
2. Architecture overview
3. Runtime boot flow
4. Script load order (32 files, exact line counts)
5. Global contracts (sb, state, currentUser, famQ, DB)
6. Auth & user management (flows, roles, password reset)
7. Multi-tenant model (family_id, famQ, feature flags)
8. Module responsibilities (auth.js, transactions.js, reports.js, dashboard.js, wizard.js)
9. Database schema (all 20+ tables with columns)
10. FX / multi-currency
11. Transactions (types, transfer pair model, debounce)
12. Reports & PDF export (tag filter, grouped categories, chart capture fix)
13. Scheduled transactions engine
14. Import pipeline
15. Optional modules (feature flags)
16. Setup wizard (auto-trigger conditions, manual trigger)
17. Config keys (app_settings + localStorage)
18. Logo pipeline
19. Deploy (GitHub Pages)
20. Regression checklist
21. Known pitfalls
22. Changelog _37 → _44
