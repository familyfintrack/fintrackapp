// ════════════════════════════════════════════════════════════════════════════
// TWO_FA.JS — Dupla Autenticação por e-mail ou Telegram
// Fluxo:
//   1. Usuário loga normalmente (email + senha) em doLogin()
//   2. Se two_fa_enabled === true → interceptar login, gerar código OTP
//   3. Enviar código via canal configurado (email ou telegram)
//   4. Exibir tela de verificação no login screen
//   5. Usuário informa código → verificar → logar normalmente
//   6. "Confiar neste dispositivo por 30 dias" → salvar token no localStorage
// ════════════════════════════════════════════════════════════════════════════

const TWO_FA_TRUST_KEY_PREFIX = 'ft_2fa_trust_';
const TWO_FA_TRUST_DAYS       = 30;

// ── Verificar se o dispositivo está na lista de confiança ───────────────────
function _2faIsTrustedDevice(userId) {
  try {
    const raw = localStorage.getItem(TWO_FA_TRUST_KEY_PREFIX + userId);
    if (!raw) return false;
    const { token, expires } = JSON.parse(raw);
    return token && new Date(expires) > new Date();
  } catch(_) { return false; }
}

function _2faTrustDevice(userId) {
  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + TWO_FA_TRUST_DAYS);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(TWO_FA_TRUST_KEY_PREFIX + userId, JSON.stringify({ token, expires }));
  } catch(_) {}
}

function _2faClearTrust(userId) {
  try { localStorage.removeItem(TWO_FA_TRUST_KEY_PREFIX + userId); } catch(_) {}
}

// ── Gerar código OTP de 6 dígitos ──────────────────────────────────────────
function _2faGenerateCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, '0');
}

// ── Salvar código no banco (tabela two_fa_codes) ───────────────────────────
async function _2faSaveCode(userId, code, channel) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10);
  // Invalidar códigos anteriores não usados
  await sb.from('two_fa_codes')
    .update({ used: true })
    .eq('user_id', userId)
    .eq('used', false)
    .catch(() => {});
  const { error } = await sb.from('two_fa_codes').insert({
    user_id:    userId,
    code,
    channel,
    used:       false,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error('Erro ao salvar código 2FA: ' + error.message);
}

// ── Verificar código ────────────────────────────────────────────────────────
async function _2faVerifyCode(userId, inputCode) {
  const now = new Date().toISOString();
  const { data: rows } = await sb.from('two_fa_codes')
    .select('id, code, used, expires_at')
    .eq('user_id', userId)
    .eq('used', false)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1);

  const row = rows?.[0];
  if (!row) return { ok: false, reason: 'Código inválido ou expirado.' };
  if (row.code !== String(inputCode).trim()) return { ok: false, reason: 'Código incorreto.' };

  // Marcar como usado
  await sb.from('two_fa_codes').update({ used: true }).eq('id', row.id).catch(() => {});
  return { ok: true };
}

// ── Enviar código por e-mail via EmailJS ────────────────────────────────────
async function _2faSendByEmail(toEmail, userName, code) {
  const { autoCheckConfig } = await _getAutoCheckConfig().catch(() => ({ autoCheckConfig: {} }));
  const serviceId  = autoCheckConfig?.emailServiceId  || EMAILJS_CONFIG?.serviceId  || '';
  const publicKey  = autoCheckConfig?.emailPublicKey  || EMAILJS_CONFIG?.publicKey  || '';
  const templateId = autoCheckConfig?.emailTemplateId || EMAILJS_CONFIG?.scheduledTemplateId || EMAILJS_CONFIG?.templateId || '';

  if (!serviceId || !publicKey || !templateId) {
    throw new Error('EmailJS não configurado. Configure em Configurações → Automação → Email.');
  }

  const now = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const body = `<div style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e8f0">
    <div style="background:linear-gradient(135deg,#1e5c42,#2a6049);padding:22px 28px">
      <div style="font-size:11px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px">Family FinTrack · Segurança</div>
      <div style="font-size:20px;font-weight:700;color:#fff">🔐 Código de verificação</div>
    </div>
    <div style="padding:28px">
      <p style="font-size:14px;color:#374151;margin:0 0 20px">Olá, <strong>${userName}</strong>! Seu código de acesso é:</p>
      <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:14px;padding:22px;text-align:center;margin-bottom:20px">
        <div style="font-size:38px;font-weight:800;letter-spacing:10px;color:#15803d;font-family:monospace">${code}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:8px">Válido por 10 minutos · ${now}</div>
      </div>
      <p style="font-size:12px;color:#9ca3af;margin:0">Se você não tentou fazer login, ignore este e-mail e sua conta permanecerá segura.</p>
    </div>
  </div></div>`;

  emailjs.init(publicKey);
  await emailjs.send(serviceId, templateId, {
    to_email:       toEmail,
    report_subject: '[Family FinTrack] Seu código de verificação: ' + code,
    Subject:        '[Family FinTrack] Código de verificação: ' + code,
    month_year:     now,
    report_content: body,
  });
}

// ── Enviar código por Telegram ──────────────────────────────────────────────
async function _2faSendByTelegram(chatId, userName, code) {
  // Usa Edge Function ou bot token configurado
  const { error } = await sb.functions.invoke('send-profile-notification-test', {
    body: {
      channel:    'telegram',
      chat_id:    chatId,
      user_name:  userName,
      user_email: '',
      custom_message: `🔐 *Código de verificação Family FinTrack*\n\nOlá, ${userName}!\n\nSeu código de acesso é:\n\n*${code}*\n\nVálido por 10 minutos. Não compartilhe com ninguém.`,
    }
  });
  if (error) throw new Error('Falha ao enviar via Telegram: ' + error.message);
}

// ── Fluxo principal: interceptar login e verificar 2FA ──────────────────────
// Chamado por doLogin() após autenticação Supabase bem-sucedida.
// Retorna true se o 2FA foi iniciado (login pausado), false se não há 2FA.
async function check2FAAndProceed(authData, appUser, email, password) {
  // Buscar configuração 2FA do usuário
  const { data: userRow } = await sb
    .from('app_users')
    .select('id, name, two_fa_enabled, two_fa_channel, telegram_chat_id, whatsapp_number')
    .eq('email', email)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (!userRow?.two_fa_enabled) return false; // 2FA desativado — prosseguir normalmente

  const userId  = userRow.id;
  const channel = userRow.two_fa_channel || 'email';

  // Verificar se dispositivo já é confiável
  if (_2faIsTrustedDevice(userId)) return false; // Confiável — prosseguir

  // Gerar e enviar código
  const code = _2faGenerateCode();
  await _2faSaveCode(userId, code, channel);

  try {
    if (channel === 'telegram') {
      const chatId = userRow.telegram_chat_id;
      if (!chatId) throw new Error('Telegram Chat ID não configurado no seu perfil.');
      await _2faSendByTelegram(chatId, userRow.name || email, code);
    } else {
      await _2faSendByEmail(email, userRow.name || email, code);
    }
  } catch(e) {
    // Se falhar o envio, ainda mostrar a tela mas com aviso
    console.warn('[2FA] send error:', e.message);
    setTimeout(() => {
      const hint = document.getElementById('twoFaHint');
      if (hint) {
        hint.textContent = '⚠️ ' + e.message;
        hint.style.color = 'var(--red, #dc2626)';
      }
    }, 100);
  }

  // Armazenar contexto temporário para verificação
  window._2faContext = { userId, channel, authData, email, password };
  _show2FAScreen(channel, email, userRow.name || '');
  return true; // Login interceptado
}
window.check2FAAndProceed = check2FAAndProceed;

// ── Exibir tela de verificação 2FA ─────────────────────────────────────────
function _show2FAScreen(channel, email, userName) {
  const ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'flex';

  // Ocultar todos os painéis do login
  ['loginFormArea','forgotPwdArea','registerFormArea','pendingApprovalArea',
   'changePwdArea','recoveryPwdArea','twoFaArea'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Criar/mostrar painel 2FA
  let area = document.getElementById('twoFaArea');
  if (!area) {
    area = document.createElement('div');
    area.id = 'twoFaArea';
    const card = document.querySelector('.ls-card');
    if (card) card.appendChild(area);
  }

  const channelLabel = channel === 'telegram' ? 'Telegram' : 'e-mail';
  const channelIcon  = channel === 'telegram' ? '💬' : '📧';
  const maskedDest   = channel === 'telegram'
    ? 'seu Telegram'
    : email.replace(/(.{2})[^@]*(@.*)/, '$1***$2');

  area.innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:2.8rem;margin-bottom:10px">🔐</div>
      <div class="ls-card-title" style="font-size:1.3rem">Verificação em duas etapas</div>
      <div class="ls-card-sub" style="margin-bottom:0">
        ${channelIcon} Enviamos um código de 6 dígitos para <strong>${maskedDest}</strong>
      </div>
    </div>
    <div class="ls-field-group">
      <label class="ls-label">Código de verificação</label>
      <div class="ls-input-wrap" style="justify-content:center">
        <input type="text" id="twoFaCode" class="ls-input"
          placeholder="000000" maxlength="6" inputmode="numeric"
          autocomplete="one-time-code"
          style="text-align:center;font-size:1.5rem;font-weight:800;letter-spacing:8px"
          onkeydown="if(event.key==='Enter')verify2FA()"
          oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)">
      </div>
      <div id="twoFaHint" style="font-size:.74rem;color:var(--muted);margin-top:5px;text-align:center">
        O código expira em 10 minutos
      </div>
    </div>

    <label class="ls-remember" style="margin:14px 0">
      <input type="checkbox" id="twoFaTrust">
      <span class="ls-check-box"></span>
      <span>Confiar neste dispositivo por ${TWO_FA_TRUST_DAYS} dias</span>
    </label>

    <button onclick="verify2FA()" id="twoFaVerifyBtn" class="ls-btn-primary">
      <span>Verificar e Entrar</span>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>

    <div id="twoFaError" class="ls-error" style="display:none"></div>

    <div style="text-align:center;margin-top:16px">
      <button onclick="_resend2FACode()" id="twoFaResendBtn" class="ls-link" style="font-size:.8rem">
        Reenviar código
      </button>
      <span class="ls-muted" style="margin:0 8px">·</span>
      <button onclick="_cancel2FA()" class="ls-link ls-link--bold" style="color:var(--muted)">
        Cancelar
      </button>
    </div>
  `;

  area.style.display = '';
  setTimeout(() => document.getElementById('twoFaCode')?.focus(), 100);
}

// ── Verificar código inserido ───────────────────────────────────────────────
async function verify2FA() {
  const ctx    = window._2faContext;
  const code   = document.getElementById('twoFaCode')?.value?.trim();
  const errEl  = document.getElementById('twoFaError');
  const btn    = document.getElementById('twoFaVerifyBtn');
  const trust  = document.getElementById('twoFaTrust')?.checked;

  if (errEl) errEl.style.display = 'none';
  if (!code || code.length !== 6) {
    if (errEl) { errEl.textContent = 'Informe o código de 6 dígitos.'; errEl.style.display = ''; }
    return;
  }
  if (!ctx?.userId) { if (errEl) { errEl.textContent = 'Sessão expirada. Faça login novamente.'; errEl.style.display = ''; } return; }

  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = '⏳ Verificando...'; }

  try {
    const result = await _2faVerifyCode(ctx.userId, code);
    if (!result.ok) {
      if (errEl) { errEl.textContent = result.reason; errEl.style.display = ''; }
      if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Verificar e Entrar'; }
      return;
    }

    // Código válido — confiar dispositivo se solicitado
    if (trust) _2faTrustDevice(ctx.userId);

    // Limpar contexto
    window._2faContext = null;

    // Continuar o fluxo de login normalmente
    const area = document.getElementById('twoFaArea');
    if (area) area.style.display = 'none';

    await _loadCurrentUserContext(ctx.authData);
    await onLoginSuccess();

  } catch(e) {
    if (errEl) { errEl.textContent = 'Erro: ' + (e.message || e); errEl.style.display = ''; }
    if (btn) { btn.disabled = false; btn.querySelector('span').textContent = 'Verificar e Entrar'; }
  }
}
window.verify2FA = verify2FA;

// ── Reenviar código ─────────────────────────────────────────────────────────
async function _resend2FACode() {
  const ctx = window._2faContext;
  if (!ctx) return;
  const btn = document.getElementById('twoFaResendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Reenviando...'; }
  try {
    const code = _2faGenerateCode();
    await _2faSaveCode(ctx.userId, code, ctx.channel);
    const { data: userRow } = await sb.from('app_users')
      .select('name, telegram_chat_id').eq('id', ctx.userId).maybeSingle();
    if (ctx.channel === 'telegram') {
      await _2faSendByTelegram(userRow?.telegram_chat_id || '', userRow?.name || '', code);
    } else {
      await _2faSendByEmail(ctx.email, userRow?.name || '', code);
    }
    const hint = document.getElementById('twoFaHint');
    if (hint) { hint.textContent = '✅ Novo código enviado! Expira em 10 minutos.'; hint.style.color = 'var(--accent)'; }
  } catch(e) {
    const hint = document.getElementById('twoFaHint');
    if (hint) { hint.textContent = '⚠️ Falha ao reenviar: ' + e.message; hint.style.color = 'var(--red)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reenviar código'; }
  }
}
window._resend2FACode = _resend2FACode;

// ── Cancelar 2FA e voltar ao login ──────────────────────────────────────────
function _cancel2FA() {
  window._2faContext = null;
  const area = document.getElementById('twoFaArea');
  if (area) { area.style.display = 'none'; area.innerHTML = ''; }
  try { sb?.auth?.signOut().catch(()=>{}); } catch(_) {}
  showLoginFormArea();
}
window._cancel2FA = _cancel2FA;


// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO 2FA — painel no perfil do usuário
// ════════════════════════════════════════════════════════════════════════════

async function load2FASettingsIntoProfile() {
  const wrap = document.getElementById('myProfile2FAWrap');
  if (!wrap) return;
  if (!currentUser?.email) return;

  try {
    const { data: row } = await sb.from('app_users')
      .select('id, two_fa_enabled, two_fa_channel, telegram_chat_id')
      .eq('email', currentUser.email)
      .maybeSingle();

    const enabled  = !!row?.two_fa_enabled;
    const channel  = row?.two_fa_channel || 'email';
    const hasTg    = !!(currentUser?.telegram_chat_id || row?.telegram_chat_id);

    const isTrusted = _2faIsTrustedDevice(row?.id || currentUser?.id || '');

    wrap.innerHTML = `
      <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:18px 20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div>
            <div style="font-size:.9rem;font-weight:700;color:var(--text)">🔐 Verificação em duas etapas</div>
            <div style="font-size:.74rem;color:var(--muted);margin-top:2px">Proteção extra ao fazer login</div>
          </div>
          <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;gap:8px">
            <input type="checkbox" id="profile2FAEnabled" ${enabled?'checked':''} style="opacity:0;width:0;height:0;position:absolute"
              onchange="_toggle2FASetting(this.checked)">
            <div id="profile2FAToggle" style="width:46px;height:26px;border-radius:13px;background:${enabled?'var(--accent)':'var(--border2)'};padding:3px;transition:background .25s;cursor:pointer" onclick="document.getElementById('profile2FAEnabled').click()">
              <div style="width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);transition:transform .25s;transform:${enabled?'translateX(20px)':'translateX(0)'}"></div>
            </div>
            <span style="font-size:.84rem;font-weight:600;color:var(--text)">${enabled?'Ativado':'Desativado'}</span>
          </label>
        </div>

        <div id="profile2FAOptions" style="display:${enabled?'':'none'}">
          <div style="font-size:.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Canal de envio</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            <label style="flex:1;min-width:120px;cursor:pointer">
              <input type="radio" name="profile2FAChannel" value="email" ${channel==='email'?'checked':''} style="opacity:0;position:absolute">
              <div class="_2fa-channel-pill ${channel==='email'?'active':''}" id="pill2FAEmail" onclick="_select2FAChannel('email')">
                📧 E-mail
              </div>
            </label>
            <label style="flex:1;min-width:120px;cursor:pointer;${hasTg?'':'opacity:.4;pointer-events:none'}" title="${hasTg?'':'Configure seu Telegram Chat ID no perfil primeiro'}">
              <input type="radio" name="profile2FAChannel" value="telegram" ${channel==='telegram'?'checked':''} style="opacity:0;position:absolute" ${hasTg?'':'disabled'}>
              <div class="_2fa-channel-pill ${channel==='telegram'?'active':''}" id="pill2FATelegram" onclick="${hasTg?"_select2FAChannel('telegram')":''}">
                💬 Telegram${hasTg?'':' (configure Chat ID)'}
              </div>
            </label>
          </div>

          ${isTrusted ? `
          <div style="background:var(--green-lt);border:1px solid var(--green,#16a34a);border-radius:8px;padding:10px 12px;font-size:.78rem;color:var(--text2);display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>✅ Este dispositivo está na lista de confiança (${TWO_FA_TRUST_DAYS} dias)</span>
            <button onclick="_clear2FATrust()" style="background:none;border:none;color:var(--red,#dc2626);cursor:pointer;font-size:.76rem;font-weight:700;flex-shrink:0">Revogar</button>
          </div>` : `
          <div style="font-size:.76rem;color:var(--muted)">💡 Ao verificar, você pode confiar neste dispositivo por ${TWO_FA_TRUST_DAYS} dias.</div>`}
        </div>

        <div id="profile2FAStatus" style="font-size:.74rem;margin-top:8px"></div>
      </div>
    `;

    // CSS para os pills
    if (!document.getElementById('_2faProfileStyle')) {
      const s = document.createElement('style');
      s.id = '_2faProfileStyle';
      s.textContent = `
        ._2fa-channel-pill {
          border: 1.5px solid var(--border2);
          border-radius: 10px;
          padding: 10px 14px;
          text-align: center;
          font-size: .84rem;
          font-weight: 600;
          color: var(--text2);
          background: var(--surface);
          transition: all .18s ease;
          cursor: pointer;
        }
        ._2fa-channel-pill.active {
          border-color: var(--accent);
          background: var(--accent-lt);
          color: var(--accent);
        }
        ._2fa-channel-pill:hover:not(.active) {
          border-color: var(--accent);
          background: var(--surface2);
        }
      `;
      document.head.appendChild(s);
    }

  } catch(e) {
    console.warn('[2FA] load settings:', e.message);
  }
}
window.load2FASettingsIntoProfile = load2FASettingsIntoProfile;

async function _toggle2FASetting(enabled) {
  const toggle  = document.getElementById('profile2FAToggle');
  const pill    = toggle?.querySelector('div');
  const label   = toggle?.nextElementSibling;
  const options = document.getElementById('profile2FAOptions');
  const status  = document.getElementById('profile2FAStatus');

  if (toggle) toggle.style.background = enabled ? 'var(--accent)' : 'var(--border2)';
  if (pill)   pill.style.transform    = enabled ? 'translateX(20px)' : 'translateX(0)';
  if (label)  label.textContent       = enabled ? 'Ativado' : 'Desativado';
  if (options) options.style.display  = enabled ? '' : 'none';

  try {
    const { error } = await sb.from('app_users')
      .update({ two_fa_enabled: enabled })
      .eq('email', currentUser.email);
    if (error) throw error;
    if (status) {
      status.textContent = enabled ? '✅ 2FA ativado com sucesso.' : '2FA desativado.';
      status.style.color = enabled ? 'var(--accent)' : 'var(--muted)';
      setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    }
  } catch(e) {
    if (status) { status.textContent = '⚠️ Erro: ' + e.message; status.style.color = 'var(--red)'; }
  }
}
window._toggle2FASetting = _toggle2FASetting;

function _select2FAChannel(channel) {
  document.querySelectorAll('._2fa-channel-pill').forEach(p => p.classList.remove('active'));
  document.getElementById(`pill2FA${channel === 'email' ? 'Email' : 'Telegram'}`)?.classList.add('active');
  document.querySelectorAll('input[name="profile2FAChannel"]').forEach(r => {
    r.checked = r.value === channel;
  });
  sb.from('app_users').update({ two_fa_channel: channel }).eq('email', currentUser.email)
    .then(({ error }) => {
      if (!error) {
        const status = document.getElementById('profile2FAStatus');
        if (status) {
          status.textContent = `Canal atualizado: ${channel === 'telegram' ? 'Telegram' : 'E-mail'}`;
          status.style.color = 'var(--accent)';
          setTimeout(() => { if (status) status.textContent = ''; }, 2500);
        }
      }
    }).catch(() => {});
}
window._select2FAChannel = _select2FAChannel;

function _clear2FATrust() {
  const uid = currentUser?.app_user_id || currentUser?.id;
  if (uid) _2faClearTrust(uid);
  toast('Confiança deste dispositivo revogada. Próximo login exigirá verificação.', 'info');
  load2FASettingsIntoProfile();
}
window._clear2FATrust = _clear2FATrust;

