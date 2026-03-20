/**
 * utils.js — Helper functions loaded after db.js and before app.js.
 * Contains only helpers that are not defined elsewhere in the load chain.
 * 
 * NOTE: populateSelects, toast, fmt, esc, openModal etc. are defined in
 * reports.js (always loaded). Do NOT redefine them here.
 */

// _accountOptions and _buildCategoryFilterOptions are also defined in reports.js
// as canonical source. These aliases here allow utils.js to be used independently
// if ever needed, but reports.js definitions take precedence (loaded first at pos 14).
