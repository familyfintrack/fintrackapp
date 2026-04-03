// ===== PATCHED AUTH.JS (SAFE WRAPPER) =====

// Garantir funções globais mesmo que implementações originais existam
function safeCall(fn){
  try { return fn && fn(); } catch(e){ console.error(e); }
}

// Expor funções no window (mesmo que já existam)
window.doLogin = window.doLogin || function(){ console.warn('doLogin not implemented'); };
window.doSignup = window.doSignup || function(){};
window.doForgot = window.doForgot || function(){};
window.doReset = window.doReset || function(){};
window.doChangePwd = window.doChangePwd || function(){};

// Bind de eventos resiliente
document.addEventListener('DOMContentLoaded', () => {
  console.log('[AUTH PATCH] Binding login events');

  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');

  if (btn) {
    btn.onclick = () => safeCall(window.doLogin);
  }

  if (password) {
    password.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') safeCall(window.doLogin);
    });
  }
});

// Proteção contra null
function safeShowError(){
  const el = document.getElementById('loginError');
  if (el && el.style) el.style.display = 'block';
}
