/* Legacy bundle shim.
   The full payee autocomplete implementation now lives in js/utils.js.
   This file is intentionally kept as a harmless no-op so existing script tags
   do not break, but it no longer redeclares global state like `payeeAC`. */
console.info('[payee_autocomplete] legacy bundle skipped: implementation loaded from utils.js');
