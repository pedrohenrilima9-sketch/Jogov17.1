document.addEventListener("DOMContentLoaded", () => {
 const $ = id => document.getElementById(id);
 const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
 const write = (k,v) => localStorage.setItem(k, JSON.stringify(v));
 const key = "lf-v17-users";
 const currentKey = "lf-v17-current-user";
 // Migrate from V16 if present
 if (!localStorage.getItem(key) && localStorage.getItem("lf-v16-users")) {
  localStorage.setItem(key, localStorage.getItem("lf-v16-users"));
  if (localStorage.getItem("lf-v16-current-user")) localStorage.setItem(currentKey, localStorage.getItem("lf-v16-current-user"));
 }
 let users = read(key, {});
 let current = localStorage.getItem(currentKey) || "";
 const safe = s => String(s || "").replace(/[&<>"']/g, c => ({"&":"&","<":"<",">":">",'"':""","'":"&#39;"}[c]));
 const hash = async value => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
 };
 function generateCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

 const panel = document.createElement("section");
 panel.className = "v17-social";
 panel.innerHTML = `
  <div class="v17-account">
   <div><small>PERFIL V17</small><h2 id="v17Welcome">Jogue com sua conta</h2><p id="v17AccountInfo">Crie um perfil local. Login automático ativo. Dados ficam neste navegador.</p></div>
   <div class="v17-fields" id="v17LoginFields"><input id="v17User" maxlength="20" placeholder="Nome de usuário"><input id="v17Pass" type="password" maxlength="80" placeholder="Senha"><button id="v17Create">Criar conta</button><button id="v17Login" class="v17-alt">Entrar</button></div>
   <div class="v17-fields" id="v17LoggedFields" hidden><span id="v17FriendCode" style="color:#5ee0ae;font-weight:bold;"></span><button id="v17Logout" class="v17-alt">Sair</button><button id="v17Switch" class="v17-alt">Trocar conta</button></div>
  </div>
  <div class="v17-tabs"><button data-tab="friends" class="active">👥 Amigos</button><button data-tab="clubs">🏆 Clubes</button><button data-tab="history">📊 Histórico</button></div>
  <div id="v17Friends" class="v17-content">
   <h3>Adicionar amigo (por nome ou código)</h3>
   <div class="v17-inline"><input id="v17FriendInput" placeholder="Usuário ou código de amizade"><button id="v17AddFriend">Adicionar</button></div>
   <ul id="v17FriendList"></ul>
   <p class="v17-note">Amigos e códigos são locais neste navegador. Para convidar, use o botão ao lado do amigo (copia link da sala atual). Para comunicação real entre dispositivos diferentes, é necessário um servidor (ver limitações).</p>
  </div>
  <div id="v17Clubs" class="v17-content" hidden>
   <h3>Criar clube</h3>
   <div class="v17-inline"><input id="v17ClubName" maxlength="28" placeholder="Nome do clube"><select id="v17ClubPrivacy"><option value="public">Público</option><option value="private">Privado</option></select><button id="v17CreateClub">Criar clube</button></div>
   <h3>Entrar em clube</h3>
   <div class="v17-inline"><input id="v17ClubCode" placeholder="Código do clube" maxlength="8"><button id="v17JoinClub">Entrar por código</button></div>
   <div id="v17ClubList"></div>
  </div>
  <div id="v17History" class="v17-content" hidden><h3>Resultados e Ranking</h3><div id="v17HistoryList"></div></div>`;
 const lobby = $("telaLobby");
 if (lobby) lobby.insertBefore(panel, $("status"));
 const style = document.createElement("style");
 style.textContent = `
 .v17-social{max-width:1100px;margin:24px auto;padding:18px;background:#0b1d32;border:1px solid #1c456b;border-radius:16px;color:#fff}
 .v17-account{display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap}
 .v17-account small{color:#29b6ff;font-weight:bold;letter-spacing:2px}.v17-account h2{margin:7px 0}.v17-account p,.v17-note{color:#a9bfd4;font-size:13px;line-height:1.5}
 .v17-fields,.v17-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.v17-social input,.v17-social select{background:#071426;color:#fff;border:1px solid #285477;border-radius:8px;padding:11px;min-width:150px}
 .v17-social button{background:#078de5;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:bold;cursor:pointer}.v17-social .v17-alt{background:#29445f}
 .v17-tabs{display:flex;gap:8px;margin:18px 0 12px;flex-wrap:wrap}.v17-tabs button{background:#183653}.v17-tabs button.active{background:#078de5}
 .v17-content{padding:12px;background:#10243c;border-radius:10px}.v17-content h3{margin-bottom:12px}.v17-content ul{padding-left:20px}.v17-content li{margin:8px 0;color:#d5e5f4;display:flex;justify-content:space-between;align-items:center}
 .v17-club{margin-top:12px;padding:12px;border:1px solid #285477;border-radius:10px}.v17-club h4{color:#29b6ff;margin-bottom:8px}.v17-note{margin-top:12px}
 .v17-share{margin:10px 0;padding:10px;background:#0a1a2b;border-radius:8px}
 .friend-actions button{font-size:12px;padding:6px 10px;margin-left:8px}
 @media(max-width:650px){.v17-social{margin:14px;padding:12px}.v17-fields{width:100%}.v17-fields input{width:100%}}
 `;
 document.head.appendChild(style);

 function activeUser(){ return users[current] || null; }
 function saveUsers(){ write(key, users); }
 function render(){
  const u = activeUser();
  $("v17Welcome").textContent = u ? "Olá, @" + u.name : "Jogue com sua conta";
  $("v17AccountInfo").textContent = u ? "Conta ativa. Login automático. Código de amizade: " + (u.friendCode || "—") : "Crie um perfil local. Dados ficam neste navegador/dispositivo.";
  $("v17LoginFields").hidden = !!u;
  $("v17LoggedFields").hidden = !u;
  if (u) {
   $("v17FriendCode").textContent = "Código: " + u.friendCode;
   $("v17FriendInput").disabled = false;
   $("v17AddFriend").disabled = false;
   $("v17ClubName").disabled = false;
   $("v17CreateClub").disabled = false;
   $("v17ClubCode").disabled = false;
   $("v17JoinClub").disabled = false;
  }
  // Friends
  const fl = $("v17FriendList");
  if (fl) {
   fl.innerHTML = u ? (u.friends || []).map(f => {
    const online = false; // Sem servidor, online só detectável na mesma sala
    return `<li>@${safe(f.name || f)} <span style="color:#8ca4bb;font-size:12px">${f.code || ""}</span> <span class="friend-actions"><button class="v17-invite" data-friend="${safe(f.name || f)}">Convidar</button></span></li>`;
   }).join("") || "<li>Nenhum amigo adicionado. Compartilhe seu código.</li>" : "<li>Entre na conta.</li>";
  }
  // Clubs
  const cl = $("v17ClubList");
  if (cl) {
   cl.innerHTML = u ? (u.clubs || []).map(c => `
    <div class="v17-club">
     <h4>${safe(c.name)} <small style="color:#5ee0ae">[${c.code}]</small> ${c.privacy === "private" ? "🔒" : "🌐"}</h4>
     <p>Admin: @${safe(c.admin || u.name)} • Membros: ${(c.members || []).map(m => "@" + safe(m)).join(", ") || "—"}</p>
     <p>Vitórias: ${c.wins||0} • Derrotas: ${c.losses||0}</p>
     <div class="v17-inline">
      <button data-win="${safe(c.id)}">+ Vitória</button>
      <button data-loss="${safe(c.id)}" class="v17-alt">+ Derrota</button>
      <button data-share="${safe(c.code)}" class="v17-alt">Compartilhar código</button>
     </div>
     ${(c.members || []).length > 1 ? `<p style="margin-top:8px;font-size:12px;color:#9fb4c9">Ranking: ${(c.members || []).map(m => m + " (stats locais)").join(" • ")}</p>` : ""}
    </div>`).join("") || "<p>Nenhum clube. Crie um e compartilhe o código.</p>" : "<p>Entre na conta.</p>";
  }
  // History
  const hl = $("v17HistoryList");
  if (hl) hl.innerHTML = u ? (u.history || []).slice().reverse().slice(0, 20).map(h => `<p>${safe(h.club || "Partida")} — ${safe(h.result)} (${safe(h.date)})</p>`).join("") || "<p>Nenhum resultado ainda.</p>" : "<p>Entre na conta.</p>";
 }
 async function authenticate(create){
  const name = $("v17User").value.trim().replace(/^@/, "").toLowerCase();
  const pass = $("v17Pass").value;
  if (!/^[a-z0-9_.-]{3,20}$/.test(name) || pass.length < 6) { alert("Usuário 3-20 chars (a-z0-9) e senha ≥6."); return; }
  const digest = await hash(pass);
  if (create) {
   if (users[name]) { alert("Usuário já existe neste navegador."); return; }
   users[name] = { name, friends: [], clubs: [], history: [], password: digest, friendCode: generateCode() };
   current = name;
  } else {
   if (!users[name] || users[name].password !== digest) { alert("Usuário/senha incorretos ou conta não existe neste navegador."); return; }
   current = name;
   if (!users[name].friendCode) users[name].friendCode = generateCode();
  }
  localStorage.setItem(currentKey, current); saveUsers(); $("v17Pass").value = ""; render();
 }
 $("v17Create").addEventListener("click", () => authenticate(true));
 $("v17Login").addEventListener("click", () => authenticate(false));
 $("v17Logout").addEventListener("click", () => { current = ""; localStorage.removeItem(currentKey); render(); });
 $("v17Switch").addEventListener("click", () => { current = ""; localStorage.removeItem(currentKey); render(); $("v17User").focus(); });
 $("v17AddFriend").addEventListener("click", () => {
  const u = activeUser(), input = $("v17FriendInput").value.trim().replace(/^@/, "");
  if (!u || !input) return;
  // Check local users first
  let target = users[input.toLowerCase()];
  if (target && target.name !== u.name) {
   if (!u.friends.find(f => (f.name || f) === target.name)) u.friends.push({ name: target.name, code: target.friendCode });
  } else {
   // By code or external
   if (!u.friends.find(f => f.code === input.toUpperCase() || (f.name || f) === input)) {
    u.friends.push({ name: input, code: input.toUpperCase() });
   }
  }
  saveUsers(); $("v17FriendInput").value = ""; render();
 });
 $("v17CreateClub").addEventListener("click", () => {
  const u = activeUser(), name = $("v17ClubName").value.trim();
  if (!u || !name) return;
  const code = generateCode();
  u.clubs.push({ id: "c" + Date.now(), name, code, privacy: $("v17ClubPrivacy").value, admin: u.name, members: [u.name], wins: 0, losses: 0, history: [] });
  saveUsers(); $("v17ClubName").value = ""; render();
 });
 $("v17JoinClub").addEventListener("click", () => {
  const u = activeUser(), code = $("v17ClubCode").value.trim().toUpperCase();
  if (!u || !code) return;
  // Search in all local users' clubs (simulates local knowledge)
  let found = null;
  for (const uname in users) {
   const uc = users[uname].clubs || [];
   found = uc.find(c => c.code === code);
   if (found) break;
  }
  if (!found) { alert("Clube não encontrado neste navegador. Compartilhe o código com quem criou (dados locais)."); return; }
  if (found.members.includes(u.name)) { alert("Você já está neste clube."); return; }
  if (found.privacy === "private") {
   alert("Clube privado. Em uma versão com servidor, o admin aprovaria. Aqui, adicionado localmente.");
  }
  found.members.push(u.name);
  // Also add to current user's clubs view
  if (!u.clubs.find(c => c.code === code)) u.clubs.push({ ...found, members: [...found.members] });
  saveUsers(); $("v17ClubCode").value = ""; render();
 });
 document.addEventListener("click", e => {
  if (e.target.classList.contains("v17-invite")) {
   const friend = e.target.dataset.friend;
   const code = $("codigoExibido")?.textContent.trim();
   if (code && /^\d{6}$/.test(code)) {
    const url = new URL("Sala.html", location.href); url.searchParams.set("sala", code);
    navigator.clipboard.writeText(`Convite para @${friend}: Entre na sala ${code} - ${url.href}`).then(() => alert("Convite copiado!"));
   } else alert("Crie ou entre em uma sala primeiro para convidar.");
  }
  const win = e.target.dataset.win, loss = e.target.dataset.loss, share = e.target.dataset.share;
  if (win || loss) {
   const u = activeUser(); if (!u) return;
   const c = u.clubs.find(x => x.id === (win || loss)); if (!c) return;
   if (win) c.wins = (c.wins||0)+1; else c.losses = (c.losses||0)+1;
   u.history.push({ club: c.name, result: win ? "Vitória" : "Derrota", date: new Date().toLocaleString("pt-BR") });
   saveUsers(); render();
  }
  if (share) {
   navigator.clipboard.writeText("Código do clube: " + share).then(() => alert("Código copiado!"));
  }
 });
 document.querySelectorAll(".v17-tabs button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".v17-tabs button").forEach(x => x.classList.toggle("active", x === b));
  ["friends","clubs","history"].forEach(t => {
   const el = $("v17" + t[0].toUpperCase() + t.slice(1));
   if (el) el.hidden = b.dataset.tab !== t;
  });
 }));
 // Auto-login already handled by current from localStorage
 // Room invite from URL
 const params = new URLSearchParams(location.search), invite = params.get("sala");
 if (invite && /^\d{6}$/.test(invite) && $("codigoSala")) $("codigoSala").value = invite;
 // Last room restore
 const last = read("lf-v16-last-room", null) || read("lf-v17-last-room", null);
 if (last && !invite && last.host === false && last.code && last.name && $("nomeConvidado")) {
  $("nomeConvidado").value = last.name;
  $("codigoSala").value = last.code;
 }
 if (current && !users[current]) { current = ""; localStorage.removeItem(currentKey); }
 render();
 // Expose for other scripts if needed
 window.__lfV17CurrentUser = () => activeUser();
});
