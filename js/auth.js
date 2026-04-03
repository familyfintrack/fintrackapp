// PATCHED BOOT
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[BOOT] starting...');
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;

    if (!session) {
      document.body.classList.remove('booting');
      showLoginScreen?.();
      return;
    }

    try {
      await bootApp();
      document.body.classList.remove('booting');
      hideLoginScreen?.();
    } catch (e) {
      console.error('[BOOT ERROR]', e);
      document.body.classList.remove('booting');
      showLoginScreen?.();
    }
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    document.body.classList.remove('booting');
    showLoginScreen?.();
  }
});
