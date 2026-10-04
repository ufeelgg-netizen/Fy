async function api(url, options={}) {
  const r = await fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  let data={}; try{data=await r.json()}catch{}
  if(!r.ok) throw new Error(data.error||"REQUEST_FAILED");
  return data;
}
function showError(e){const x=document.querySelector(".error");if(x)x.textContent=e.message}
async function login(e){
  e.preventDefault();
  try{await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:e.target.email.value,password:e.target.password.value})});location.href="/dashboard.html"}catch(err){showError(err)}
}
async function register(e){
  e.preventDefault();
  try{await api("/api/auth/register",{method:"POST",body:JSON.stringify({email:e.target.email.value,password:e.target.password.value,displayName:e.target.displayName.value,mode:e.target.mode.value})});location.href="/dashboard.html"}catch(err){showError(err)}
}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.href="/"}
async function loadMe(){try{const d=await api("/api/me");return d.user}catch{return null}}
