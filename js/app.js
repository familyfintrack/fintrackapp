// SAFE APP.JS

function safeEl(id){
  return document.getElementById(id);
}

// SAFE SIDEBAR ACCESS
function getSidebar(){
  return safeEl('sidebar');
}

function toggleSidebar(){
  const el = getSidebar();
  if(!el){
    console.warn('[sidebar missing]');
    return;
  }
  el.classList.toggle('open');
}

// SAFE BOOT
async function bootApp(){
  try{
    console.log('[boot]');
    return true;
  }catch(e){
    console.error('[boot error]', e);
    return false;
  }
}
