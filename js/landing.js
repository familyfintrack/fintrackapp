/* ═══════════════════════════════════════════════════════
   Family FinTrack — Landing Page JS
   Forest Luxury theme · Vibe Coding + IA
═══════════════════════════════════════════════════════ */

const SUPA_URL = 'https://wkiytjwuztnytygpxooe.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndraXl0and1enRueXR5Z3B4b29lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODc3NzUsImV4cCI6MjA4Nzg2Mzc3NX0.Z3fyYRDobzarCEdqkobTjQQd1J9HAUR2CCdnBbLC0QA';
const _sb = supabase.createClient(SUPA_URL, SUPA_KEY);
const _ej = { serviceId:'', templateId:'', publicKey:'' };

/* ── EmailJS config from app_settings ── */
(async () => {
  try {
    const { data } = await _sb
      .from('app_settings')
      .select('key,value')
      .in('key', ['ej_service', 'ej_template', 'ej_sched_template', 'ej_key']);
    if (data) {
      data.forEach(r => {
        if (r.key === 'ej_service')                          _ej.serviceId  = String(r.value || '');
        if (r.key === 'ej_template' && !_ej.templateId)     _ej.templateId = String(r.value || '');
        if (r.key === 'ej_sched_template' && !_ej.templateId) _ej.templateId = String(r.value || '');
        if (r.key === 'ej_key')                              _ej.publicKey  = String(r.value || '');
      });
      if (_ej.publicKey) emailjs.init(_ej.publicKey);
    }
  } catch(e) { console.debug('[landing] EJ init:', e.message); }
})();

/* ── Particle Canvas ── */
(function () {
  const canvas = document.getElementById('pc');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];
  const COLORS = [
    'rgba(42,96,73,', 'rgba(61,122,94,', 'rgba(90,158,128,',
    'rgba(201,168,76,', 'rgba(125,191,158,'
  ];

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  class P {
    constructor() { this.reset(true); }
    reset(init) {
      this.x  = Math.random() * W;
      this.y  = init ? Math.random() * H : H + 10;
      this.r  = Math.random() * 1.8 + 0.4;
      this.vx = (Math.random() - 0.5) * 0.22;
      this.vy = -(Math.random() * 0.45 + 0.12);
      this.alpha = 0;
      this.ta = Math.random() * 0.45 + 0.06;
      this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.life = 0;
      this.ml = Math.random() * 320 + 180;
    }
    update() {
      this.x += this.vx; this.y += this.vy; this.life++;
      const t = this.life / this.ml;
      if (t < 0.15)      this.alpha = this.ta * (t / 0.15);
      else if (t > 0.75) this.alpha = this.ta * (1 - (t - 0.75) / 0.25);
      else               this.alpha = this.ta;
      if (this.life >= this.ml) this.reset(false);
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = this.color + this.alpha + ')';
      ctx.fill();
    }
  }

  for (let i = 0; i < 90; i++) particles.push(new P());

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  }
  loop();
})();

/* ── Nav scroll ── */
window.addEventListener('scroll', () => {
  document.getElementById('nav')?.classList.toggle('sc', window.scrollY > 60);
}, { passive: true });

/* ── Smooth scroll for anchor links ── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

/* ── Scroll reveal ── */
const ro = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.rv').forEach(el => ro.observe(el));

/* ── Feature cards stagger on reveal ── */
const fro = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const cards = entry.target.querySelectorAll('.fc');
      cards.forEach((c, i) => {
        setTimeout(() => {
          c.style.opacity = '1';
          c.style.transform = 'translateY(0)';
        }, i * 70);
      });
      fro.unobserve(entry.target);
    }
  });
}, { threshold: 0.05 });

const fgrid = document.querySelector('.fgrid');
if (fgrid) {
  fgrid.querySelectorAll('.fc').forEach(c => {
    c.style.opacity = '0';
    c.style.transform = 'translateY(28px)';
    c.style.transition = 'opacity .65s ease, transform .65s ease, box-shadow .38s, border-color .38s, transform .38s cubic-bezier(.25,.46,.45,.94)';
  });
  fro.observe(fgrid);
}

/* ── Waitlist submit ── */
async function handleWl(e) {
  e.preventDefault();
  const name  = document.getElementById('wlN').value.trim();
  const email = document.getElementById('wlE').value.trim().toLowerCase();
  const phone = document.getElementById('wlP').value.trim();
  const role  = document.getElementById('wlR').value;
  const btn   = document.getElementById('wlBtn');
  const btnT  = document.getElementById('wlBT');
  const errEl = document.getElementById('wlErr');

  if (!name || !email) return;

  btn.disabled = true;
  btnT.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Cadastrando…';
  errEl.style.display = 'none';

  try {
    /* 1. Insert into waitlist table */
    const { error: dbErr } = await _sb.from('waitlist').insert({
      name,
      email,
      whatsapp: phone || null,
      role,
      source:   'landing',
      status:   'pending',
      created_at: new Date().toISOString(),
    });

    if (dbErr) {
      if (dbErr.code === '23505')
        throw new Error('Este e-mail já está na lista! 🎉 Você já está dentro!');
      throw new Error(dbErr.message);
    }

    const fn = name.split(' ')[0];

    /* 2. Send confirmation email via EmailJS */
    if (_ej.serviceId && _ej.templateId && _ej.publicKey) {
      try {
        await emailjs.send(_ej.serviceId, _ej.templateId, {
          to_email:       email,
          report_subject: '[Family FinTrack] ✨ Você está na lista de espera!',
          Subject:        '[Family FinTrack] Bem-vindo à lista exclusiva!',
          month_year:     new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
          report_content: buildConfirmEmail(fn, email, role),
        });
      } catch (ejErr) {
        console.warn('[landing] EmailJS send failed:', ejErr.message);
      }
    }

    /* 3. Show success state */
    document.getElementById('sNm').textContent = fn;
    document.getElementById('sEm').textContent = email;
    document.getElementById('wlFrm').style.display = 'none';
    document.getElementById('wlSuc').style.display  = 'flex';

  } catch (err) {
    errEl.textContent   = '⚠️ ' + (err.message || 'Erro ao cadastrar. Tente novamente.');
    errEl.style.display = 'block';
    btn.disabled        = false;
    btnT.innerHTML      = '✨ Garantir meu lugar na lista';
  }
}

/* ── Confirmation email HTML ── */
function buildConfirmEmail(firstName, email, role) {
  const roleLabels = {
    personal: 'Uso pessoal',
    family:   'Família completa',
    business: 'Empreendedor',
    curious:  'Curioso sobre IA',
  };
  const roleLabel = roleLabels[role] || role;

  return `
<div style="font-family:'Outfit',Arial,sans-serif;background:#0a1409;padding:0;margin:0">
<div style="max-width:580px;margin:0 auto;background:#0a1409">

  <!-- Header -->
  <div style="background:linear-gradient(160deg,#0d2318 0%,#1a3a28 45%,#0d2318 100%);padding:52px 40px 44px;text-align:center;border-bottom:1px solid rgba(42,96,73,.28)">
    <div style="width:72px;height:72px;background:linear-gradient(135deg,#2a6049,#5a9e80);border-radius:20px;display:inline-flex;align-items:center;justify-content:center;font-size:2.2rem;margin-bottom:24px;box-shadow:0 8px 32px rgba(42,96,73,.35)">&#x1F49A;</div>
    <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:10px;font-weight:700">Family FinTrack &nbsp;&middot;&nbsp; Beta Privado</div>
    <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:700;color:#fff;margin:0;line-height:1.2">Você está na lista! &#x1F389;</h1>
    <div style="width:48px;height:2px;background:linear-gradient(90deg,#c9a84c,#e8c56d);border-radius:2px;margin:22px auto 0"></div>
  </div>

  <!-- Body -->
  <div style="background:#0d1f12;padding:42px 40px;border-bottom:1px solid rgba(42,96,73,.15)">
    <p style="font-size:17px;color:rgba(255,255,255,.82);margin:0 0 18px;line-height:1.65;font-family:Georgia,serif">
      Olá, <strong style="color:#c9a84c">${firstName}</strong>! &#x1F44B;
    </p>
    <p style="font-size:14px;color:rgba(255,255,255,.52);margin:0 0 32px;line-height:1.85">
      Seu cadastro na lista de espera do <strong style="color:#5a9e80">Family FinTrack</strong> foi confirmado com sucesso. Você é agora um candidato oficial ao nosso programa de beta testadores exclusivos.
    </p>

    <!-- Status card -->
    <div style="background:linear-gradient(135deg,#0a1a0e,#162e20);border:1px solid rgba(42,96,73,.35);border-radius:18px;padding:30px;text-align:center;margin-bottom:28px">
      <div style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.28);margin-bottom:12px;font-weight:700">Status do seu cadastro</div>
      <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#c9a84c;margin-bottom:8px">Na Lista de Espera &#x2713;</div>
      <div style="font-size:12px;color:rgba(255,255,255,.32)">Convites enviados em ordem de cadastro</div>
    </div>

    <!-- Info cards -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:30px">
      <div style="flex:1;min-width:160px;background:rgba(42,96,73,.1);border:1px solid rgba(42,96,73,.2);border-radius:12px;padding:14px 16px">
        <div style="font-size:9px;color:rgba(255,255,255,.28);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px">Perfil</div>
        <div style="font-size:13px;color:rgba(255,255,255,.75);font-weight:700">${roleLabel}</div>
      </div>
      <div style="flex:1;min-width:160px;background:rgba(42,96,73,.1);border:1px solid rgba(42,96,73,.2);border-radius:12px;padding:14px 16px">
        <div style="font-size:9px;color:rgba(255,255,255,.28);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px">Acesso</div>
        <div style="font-size:13px;color:rgba(255,255,255,.75);font-weight:700">Por convite exclusivo</div>
      </div>
    </div>

    <!-- IA highlight -->
    <div style="background:rgba(201,168,76,.06);border-left:3px solid #c9a84c;border-radius:0 12px 12px 0;padding:18px 22px;margin-bottom:26px">
      <div style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.8">
        &#x2728; <strong style="color:#c9a84c">100% Vibe Coded com IA</strong> &mdash; este app foi criado inteiramente em parceria com Claude (Anthropic), Gemini e GPT. Nenhuma linha de código foi escrita manualmente. É a prova viva de que o futuro do software já chegou, e você vai fazer parte desta história.
      </div>
    </div>

    <!-- Features preview -->
    <div style="margin-bottom:28px">
      <div style="font-size:11px;color:rgba(255,255,255,.3);font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">O que espera por você</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${[
          ['🤖','IA Financeira com Gemini AI','Insights, previsões e chat em linguagem natural'],
          ['📱','Leitura de Recibos por IA','Fotografe e pronto — dados preenchidos automaticamente'],
          ['🔮','Forecast 90 dias','Previsão de fluxo de caixa calculada por IA'],
          ['👨‍👩‍👧‍👦','Gestão Familiar Completa','Multi-usuário, perfis e permissões individuais'],
          ['📅','Transações Programadas','Registro automático com notificação no Telegram'],
          ['💹','Carteira de Investimentos','Cotações em tempo real e gráficos automáticos'],
        ].map(([icon, title, desc]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid rgba(42,96,73,.12);vertical-align:top;width:32px;font-size:1.1rem">${icon}</td>
          <td style="padding:10px 12px 10px 8px;border-bottom:1px solid rgba(42,96,73,.12);vertical-align:top">
            <div style="font-size:13px;font-weight:700;color:rgba(255,255,255,.78);margin-bottom:2px">${title}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.38);line-height:1.5">${desc}</div>
          </td>
        </tr>`).join('')}
      </table>
    </div>

    <p style="font-size:13px;color:rgba(255,255,255,.32);text-align:center;margin:0;line-height:1.75">
      Assim que seu convite estiver pronto, enviaremos<br>um email com todas as instruções de acesso.<br><br>
      Até breve, <strong style="color:rgba(255,255,255,.6)">${firstName}</strong>! &#x1F680;
    </p>
  </div>

  <!-- Footer -->
  <div style="padding:26px 40px;text-align:center;background:#0a1409">
    <div style="font-size:11px;color:rgba(255,255,255,.18);line-height:1.85">
      Family FinTrack &nbsp;&middot;&nbsp; Beta Privado &nbsp;&middot;&nbsp; 2025<br>
      Desenvolvido com &#x2764;&#xFE0F; via Vibe Coding &nbsp;&middot;&nbsp; Claude &middot; Gemini &middot; GPT<br>
      <span style="opacity:.6">Supabase &middot; EmailJS &middot; Uma experiência imersiva em IA</span>
    </div>
  </div>

</div>
</div>`;
}
