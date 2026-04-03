// SAFE AUTH.JS

window.doLogin = async function(){
  console.log('[LOGIN CLICK]');
};

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('loginBtn');
  const pwd = document.getElementById('loginPassword');

  if(btn){
    btn.onclick = () => window.doLogin();
  }

  if(pwd){
    pwd.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){
        window.doLogin();
      }
    });
  }

  document.body.classList.remove('booting');
});
