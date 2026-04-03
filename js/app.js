// PATCHED BOOT SAFE
async function bootAppSafe() {
  try {
    await bootApp();
    return true;
  } catch (e) {
    console.error('[boot]', e);
    return false;
  }
}
