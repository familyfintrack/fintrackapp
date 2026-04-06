/**
 * date.js — FinTrack Date & Time Utilities
 *
 * Regras:
 *  - EXIBIÇÃO: sempre 'pt-BR' com fuso do browser do usuário
 *  - CAMPO DATE (input[type=date]): sempre YYYY-MM-DD local (não UTC)
 *  - TIMESTAMPS p/ banco (created_at/updated_at): ISO 8601 com offset local
 *    ex: "2025-04-06T14:32:00-03:00" — Supabase aceita e preserva a hora correta
 *
 * Funções globais expostas:
 *   fmtDate(d)             → "06/04/2025"  (só data, qualquer input)
 *   fmtDatetime(d)         → "06/04/2025 14:32"
 *   fmtTime(d)             → "14:32"
 *   fmtDateShort(d)        → "06/04/25"
 *   fmtRelDate(d)          → "Hoje" / "Ontem" / "06/04/2025"
 *   todayISO()             → "2025-04-06"  (data LOCAL, não UTC)
 *   nowLocalISO()          → "2025-04-06T14:32:00-03:00"  (timestamp com offset)
 *   localISOTimestamp()    → alias de nowLocalISO() para updated_at / created_at
 *   dateOffsetISO(n)       → "2025-04-07" / "2025-04-05" (±n dias, local)
 *
 * FinTrackDateUtils namespace mantido para compatibilidade retroativa.
 */
(function (global) {

  // ── Helpers internos ───────────────────────────────────────────────────────

  function _getUserLocale() {
    return document?.documentElement?.lang || navigator?.language || 'pt-BR';
  }

  /**
   * Converte qualquer input em Date sem bug de UTC.
   * - "2025-04-06"           → interpreta como meio-dia local (evita off-by-one em UTC-)
   * - "2025-04-06T14:32:00Z" → Date nativo (UTC, convertido para local automaticamente)
   * - Date object             → clonado
   */
  function _toDate(input) {
    if (!input) return null;
    if (input instanceof Date) return isNaN(input) ? null : new Date(input);
    if (typeof input === 'string') {
      // Só data (YYYY-MM-DD) — usar meio-dia local para evitar off-by-one
      if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return new Date(input + 'T12:00:00');
      }
    }
    const d = new Date(input);
    return isNaN(d) ? null : d;
  }

  // ── Formatação de exibição ─────────────────────────────────────────────────

  /**
   * "06/04/2025" — formato brasileiro padrão (só data)
   * Aceita: "2025-04-06", Date, ISO timestamp
   */
  function fmtDate(d) {
    if (!d) return '—';
    // Fast path para strings YYYY-MM-DD (evita criar Date, zero risco de timezone)
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
      const [y, m, day] = d.slice(0, 10).split('-');
      return `${day}/${m}/${y}`;
    }
    const dt = _toDate(d);
    if (!dt) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(dt);
  }

  /**
   * "06/04/2025 14:32" — data + hora local do usuário
   * Para created_at / updated_at que vêm do banco como ISO UTC.
   * O browser converte automaticamente para o fuso local.
   */
  function fmtDatetime(d) {
    if (!d) return '—';
    const dt = _toDate(d);
    if (!dt) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(dt);
  }

  /**
   * "14:32" — só hora local
   */
  function fmtTime(d) {
    if (!d) return '—';
    const dt = _toDate(d);
    if (!dt) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit', minute: '2-digit',
    }).format(dt);
  }

  /**
   * "06/04/25" — formato curto (ano 2 dígitos)
   */
  function fmtDateShort(d) {
    if (!d) return '—';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
      const [y, m, day] = d.slice(0, 10).split('-');
      return `${day}/${m}/${y.slice(2)}`;
    }
    const dt = _toDate(d);
    if (!dt) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    }).format(dt);
  }

  /**
   * "Hoje" / "Ontem" / "06/04/2025"
   */
  function fmtRelDate(d) {
    if (!d) return '—';
    const todayStr = todayISO();
    const dt = _toDate(d);
    if (!dt) return '—';
    const inputStr = typeof d === 'string' ? d.slice(0, 10)
      : `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    if (inputStr === todayStr) return 'Hoje';
    const yesterday = dateOffsetISO(-1);
    if (inputStr === yesterday) return 'Ontem';
    return fmtDate(d);
  }

  /**
   * "Mês de Ano" — "Abril de 2025"
   */
  function fmtMonthYear(d) {
    const dt = _toDate(d) || new Date();
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'long', year: 'numeric',
    }).format(dt);
  }

  /**
   * "Abr/25" — mês abreviado
   */
  function fmtMonthShort(d) {
    const dt = _toDate(d) || new Date();
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'short', year: '2-digit',
    }).format(dt).replace('.', '');
  }

  // ── Data atual (LOCAL, sem bug de UTC) ────────────────────────────────────

  /**
   * "2025-04-06" — data local do usuário (YYYY-MM-DD)
   * Use isto em vez de todayISO()
   */
  function todayISO() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
  }

  /**
   * "2025-04-06T14:32:05-03:00" — timestamp ISO com offset local
   * Use isto em vez de localISOTimestamp() para updated_at / created_at
   * O Supabase (PostgreSQL timestamptz) aceita e armazena corretamente.
   */
  function nowLocalISO() {
    const n  = new Date();
    const off = -n.getTimezoneOffset(); // minutos positivos = UTC+
    const sign = off >= 0 ? '+' : '-';
    const hh   = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
    const mm   = String(Math.abs(off) % 60).padStart(2, '0');
    const pad  = v => String(v).padStart(2, '0');
    return (
      `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` +
      `T${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}` +
      `${sign}${hh}:${mm}`
    );
  }

  /** Alias explícito para uso em campos updated_at / created_at */
  const localISOTimestamp = nowLocalISO;

  /**
   * Data com offset de dias: dateOffsetISO(1) = amanhã, dateOffsetISO(-1) = ontem
   */
  function dateOffsetISO(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /**
   * "2025-04" — mês atual LOCAL (YYYY-MM), sem bug de UTC
   * Use em vez de new Date().toISOString().slice(0,7)
   */
  function todayMonthISO() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
  }

  /**
   * Converte um objeto Date para string YYYY-MM-DD usando hora LOCAL
   * Seguro mesmo quando o Date foi criado com setDate() (pode ter hora 00:00 em UTC-)
   * Use em vez de someDate.toISOString().slice(0,10)
   */
  function dateToLocalISO(d) {
    if (!d || !(d instanceof Date) || isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // ── Namespace retrocompatível ──────────────────────────────────────────────
  global.FinTrackDateUtils = {
    getUserLocale:    _getUserLocale,
    formatUserDate:   fmtDate,
    formatUserDateTime: fmtDatetime,
    formatMonthYear:  fmtMonthYear,
    getTodayLocalISO: todayISO,
    todayISO,
    nowLocalISO,
    localISOTimestamp,
    dateOffsetISO,
    todayMonthISO,
    dateToLocalISO,
    fmtDate,
    fmtDatetime,
    fmtTime,
    fmtDateShort,
    fmtRelDate,
    fmtMonthYear,
    fmtMonthShort,
  };

  // Expor como globals para uso direto em todos os módulos
  global.fmtDate          = fmtDate;
  global.fmtDatetime      = fmtDatetime;
  global.fmtTime          = fmtTime;
  global.fmtDateShort     = fmtDateShort;
  global.fmtRelDate       = fmtRelDate;
  global.fmtMonthYear     = fmtMonthYear;
  global.fmtMonthShort    = fmtMonthShort;
  global.todayISO         = todayISO;
  global.nowLocalISO      = nowLocalISO;
  global.localISOTimestamp = localISOTimestamp;
  global.dateOffsetISO    = dateOffsetISO;
  global.todayMonthISO    = todayMonthISO;
  global.dateToLocalISO   = dateToLocalISO;

})(window);
