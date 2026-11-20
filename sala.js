document.addEventListener("DOMContentLoaded", () => {
 const $ = id => document.getElementById(id);
 const status = $("status");

 let peer = null, host = false, roomCode = "", myName = "", hostConn = null, clientId = "";
 let connections = [], state = null, timerId = null, heartbeatId = null, ended = false;
 let lastMyBidAt = 0; // Cooldown local de 3 segundos para dar lance
 let simTimerId = null, simSpeed = 1, simIndex = 0, simFinishedLocal = false;

 const PEER_PREFIX = "lf-futebol-v16-";
 const peerConfig = {
  debug: 0,
  config: {
   iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
   ]
  }
 };

 const formacoes = {
  "4-3-3":   [["PE","ATA","PD"], ["MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-2-3-1": [["ATA"], ["PE","MEI","PD"], ["VOL","VOL"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "4-4-2":   [["ATA","ATA"], ["MEI","MC","MC","MEI"], ["LE","ZAG","ZAG","LD"], ["GOL"]],
  "3-5-2":   [["ATA","ATA"], ["MEI","MC","VOL","MC","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]],
  "3-4-3":   [["PE","ATA","PD"], ["MC","MC","MEI","MEI"], ["ZAG","ZAG","ZAG"], ["GOL"]]
 };

 const nomesPosicao = {
  GOL: "Goleiro", LE: "Lateral Esquerdo", LD: "Lateral Direito", ZAG: "Zagueiro",
  VOL: "Volante", MC: "Meio-Campista", MEI: "Meia Ofensivo", PE: "Ponta Esquerdo",
  PD: "Ponta Direito", ATA: "Atacante / CA"
 };

 // POLIVALÊNCIA AMPLIADA NA DEFESA + PENALIDADES DE OVERALL POR POSIÇÃO E PERFIL DO JOGADOR
 const compatibilidade = {
  GOL: ["GOL"],
  LE:  ["LE", "LD", "ZAG", "VOL"],
  LD:  ["LD", "LE", "ZAG", "VOL"],
  ZAG: ["ZAG", "LE", "LD", "VOL"],
  VOL: ["VOL", "MC", "ZAG", "LE", "LD"],
  MC:  ["MC", "VOL", "MEI"],
  MEI: ["MEI", "MC", "PE", "PD"],
  PE:  ["PE", "MEI", "ATA", "PD"],
  PD:  ["PD", "MEI", "ATA", "PE"],
  ATA: ["ATA", "PE", "PD"]
 };

 const ordemPosicoesCiclo = [
  { label: "ATACANTE", posicoes: ["ATA"] },
  { label: "PONTA", posicoes: ["PE", "PD"] },
  { label: "MEIA", posicoes: ["MC", "MEI"] },
  { label: "VOLANTE", posicoes: ["VOL"] },
  { label: "ZAGUEIRO", posicoes: ["ZAG"] },
  { label: "LATERAL", posicoes: ["LE", "LD"] },
  { label: "GOLEIRO", posicoes: ["GOL"] }
 ];

 const fmt = n => "€ " + Math.round(n || 0).toLocaleString("pt-BR");
 function msg(t) { if ($("mensagem")) $("mensagem").textContent = t; }
 function message(txt, error=false){ if(status){ status.textContent = txt; status.style.color = error ? "#ffb4b4" : "#bfe5ff"; } }
 function makeCode(){ return String(Math.floor(100000 + Math.random() * 900000)); }
 function cleanName(v){ return (v || "").trim().slice(0, 18); }
 function clientKey(){
  let id = localStorage.getItem("lf-v16-client-id");
  if (!id) {
   id = "guest-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
   localStorage.setItem("lf-v16-client-id", id);
  }
  return id;
 }
 function playersList() { return typeof jogadores !== "undefined" ? jogadores : []; }
 const fotosJogadores = new Map();
 let jogadorFotoAtual = "";
 function carregarFotoJogador(nome) {
  const avatar = $("avatar");
  if (!avatar || jogadorFotoAtual === nome) return;
  jogadorFotoAtual = nome;
  avatar.classList.remove("v16-photo");
  avatar.style.backgroundImage = "";
  avatar.textContent = "⚽";
  if (fotosJogadores.has(nome)) {
   const url = fotosJogadores.get(nome);
   if (url) { avatar.style.backgroundImage = `url("${url}")`; avatar.classList.add("v16-photo"); avatar.textContent = ""; }
   return;
  }
  fetch("https://pt.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(nome))
   .then(r => r.ok ? r.json() : null)
   .then(data => {
    const url = data && data.thumbnail && data.thumbnail.source;
    fotosJogadores.set(nome, url || "");
    if (jogadorFotoAtual === nome && url) {
     avatar.style.backgroundImage = `url("${url}")`;
     avatar.classList.add("v16-photo");
     avatar.textContent = "";
    }
   }).catch(() => fotosJogadores.set(nome, ""));
 }
 function currentUserId() { return host ? "host" : clientId; }
 function myPlayer() { return state?.players?.[currentUserId()] || null; }

 // CÁLCULO DE OVERALL EFETIVO COM PENALIDADE POR IMPROVISO (DEPENDE DA POSIÇÃO E DO JOGADOR)
 function getEffectiveOverall(jogador, slotPos) {
  if (!jogador) return 0;
  const base = jogador.overall || 75;
  if (!slotPos || jogador.posicao === slotPos) return base;

  const pOrig = jogador.posicao;
  const ambidestro = jogador.pernaBoa === "Ambidestro";
  // Fator individual determinístico pelo nome (jogadores mais versáteis perdem 1 pt a menos)
  const versatilBonus = (jogador.nome.length % 2 === 0) ? 0 : 1;

  let penalty = 0;

  // Improvisos defensivos
  if ((pOrig === "LE" && slotPos === "LD") || (pOrig === "LD" && slotPos === "LE")) {
   penalty = ambidestro ? 1 : (3 - versatilBonus); // -2 ou -3
  } else if (pOrig === "ZAG" && (slotPos === "LE" || slotPos === "LD")) {
   penalty = 4 - versatilBonus; // -3 ou -4 (zagueiro na lateral)
  } else if ((pOrig === "LE" || pOrig === "LD") && slotPos === "ZAG") {
   penalty = 5 - versatilBonus; // -4 ou -5 (lateral na zaga)
  } else if (pOrig === "VOL" && slotPos === "ZAG") {
   penalty = 3 - versatilBonus; // -2 ou -3 (volante recuado para zagueiro)
  } else if (pOrig === "VOL" && (slotPos === "LE" || slotPos === "LD")) {
   penalty = 4 - versatilBonus; // -3 ou -4 (volante na lateral)
  } else if (pOrig === "ZAG" && slotPos === "VOL") {
   penalty = 4 - versatilBonus; // -3 ou -4 (zagueiro de primeiro volante)
  } else if ((pOrig === "LE" || pOrig === "LD") && slotPos === "VOL") {
   penalty = 3 - versatilBonus; // -2 ou -3
  } else if ((pOrig === "PE" && slotPos === "PD") || (pOrig === "PD" && slotPos === "PE")) {
   penalty = ambidestro ? 0 : (2 - versatilBonus);
  } else if ((pOrig === "MC" && slotPos === "VOL") || (pOrig === "VOL" && slotPos === "MC") || (pOrig === "MC" && slotPos === "MEI") || (pOrig === "MEI" && slotPos === "MC")) {
   penalty = 2 - versatilBonus;
  } else {
   penalty = 4 - versatilBonus;
  }

  return Math.max(50, base - Math.max(0, penalty));
 }

 // FORÇA EFETIVA DO TIME: SEMPRE DIVIDE POR 11 VAGAS + PENALIDADE POR TIME INCOMPLETO
 // Assim, um time com 4 craques (OVR ~90 -> 360/11 = 32.7) NUNCA ganha de um time completo de 11 jogadores (OVR ~78 -> 78.0)!
 function calcularForcaTime(playerObj) {
  if (!playerObj) return 0;
  const formacao = playerObj.formation || "4-3-3";
  const slots = getFormationSlots(formacao);
  const lineup = playerObj.lineup || {};
  let somaEfetiva = 0;
  let count = 0;

  slots.forEach(s => {
   const jog = lineup[s.id];
   if (jog) {
    somaEfetiva += getEffectiveOverall(jog, s.pos);
    count++;
   }
  });

  if (count === 0) return 0;
  // Média sobre os 11 lugares obrigatórios do campo
  const mediaSobreOnze = somaEfetiva / 11;
  // Penalidade extra de desorganização tática por vaga vazia (-2.5 por jogador faltando)
  const vagasVazias = Math.max(0, 11 - count);
  return Math.max(1, mediaSobreOnze - (vagasVazias * 2.5));
 }

 $("codigoSala").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
 });

 // TRANSMISSÃO SEGURA E SEM CRASH
 function safeSend(conn, payload) {
  if (!conn || !conn.open) return false;
  try {
   conn.send(JSON.parse(JSON.stringify(payload)));
   return true;
  } catch (err) {
   console.warn("Falha controlada ao enviar pacote:", err);
   return false;
  }
 }

 function broadcast(data) {
  connections = connections.filter(c => c && c.open);
  connections.forEach(c => safeSend(c, data));
 }

 function sendToHost(data) {
  if (host) {
   handleHostMessage(data, "host");
  } else if (hostConn && hostConn.open) {
   safeSend(hostConn, data);
  } else {
   message("Reconectando ao anfitrião...", true);
  }
 }

 function publish() {
  try {
   renderAll();
  } catch (e) {
   console.error("Erro na renderização local:", e);
  }
  if (host && state) {
   broadcast({ type: "state", state });
  }
 }

 // LOBBY
 function showLobbyRoom() {
  $("salaAtiva").classList.remove("escondido");
  $("codigoExibido").textContent = roomCode;
  $("avisoAnfitriao").textContent = host
   ? "Você é o anfitrião. Quando todos os participantes completarem 11 titulares, o leilão encerra e inicia a simulação automaticamente (você também pode iniciar quando quiser)."
   : "Conectado! Aguardando o anfitrião iniciar o leilão.";
  $("iniciarLeilao").classList.toggle("escondido", !host);
  renderLobbyPlayers();
 }

 function renderLobbyPlayers() {
  if (!state) return;
  $("listaParticipantes").innerHTML = "";
  Object.values(state.players || {}).forEach(p => {
   if (p.isBot) return;
   const li = document.createElement("li");
   li.textContent = p.name + (p.id === "host" ? " • Anfitrião" : "");
   $("listaParticipantes").appendChild(li);
  });
 }

 function setupHost() {
  state = {
   roomCode,
   players: {
    host: { id: "host", name: myName, budget: 500000000, roster: [], lineup: {}, formation: "4-3-3", lastBidTime: 0 }
   },
   auction: null,
   history: [],
   used: [],
   cycleIndex: 0,
   started: false,
   finished: false,
   paused: false,
   tournament: null,
   seconds: 10
  };

  peer = new Peer(PEER_PREFIX + roomCode, peerConfig);

  peer.on("open", () => {
   message("Sala criada! Código numérico: " + roomCode);
   showLobbyRoom();
   // Heartbeat leve a cada 4s para evitar queda silenciosa de WebRTC em navegadores inativos
   clearInterval(heartbeatId);
   heartbeatId = setInterval(() => {
    if (host && state) {
     broadcast({ type: "ping", ts: Date.now() });
    }
   }, 4000);
  });

  peer.on("connection", conn => {
   connections.push(conn);

   conn.on("data", data => {
    try {
     if (!data) return;
     if (data.type === "hello") {
      const id = data.clientId || conn.peer;
      const humanCount = Object.values(state.players).filter(p => !p.isBot).length;
      if (humanCount >= 16 && !state.players[id]) {
       safeSend(conn, { type: "error", message: "A sala já está cheia (máx. 16 jogadores)." });
       setTimeout(() => { try { conn.close(); } catch(e){} }, 300);
       return;
      }
      if (!state.players[id]) {
       state.players[id] = {
        id,
        name: cleanName(data.name) || "Jogador",
        budget: 500000000,
        roster: [],
        lineup: {},
        formation: "4-3-3",
        lastBidTime: 0
       };
      }
      conn.playerId = id;
      publish();
      safeSend(conn, { type: "state", state });
      message(state.players[id].name + " entrou na sala!");
     } else if (data.type === "requestSync") {
      safeSend(conn, { type: "state", state });
     } else {
      handleHostMessage(data, conn.playerId || conn.peer);
     }
    } catch (err) {
     console.error("Erro ao processar pacote no host:", err);
    }
   });

   conn.on("close", () => {
    connections = connections.filter(c => c !== conn);
    // O jogador permanece no estado da sala para permitir reconexão após oscilação.
    if (conn.playerId && state.players[conn.playerId]) {
     state.players[conn.playerId].disconnectedAt = Date.now();
     publish();
    }
   });

   conn.on("error", err => {
    console.warn("Erro na conexão de convidado:", err);
   });
  });

  peer.on("error", err => {
   if (err.type === "unavailable-id") {
    try { peer.destroy(); } catch(e){}
    roomCode = makeCode();
    setupHost();
   } else {
    message("Aviso de rede (" + err.type + "). Tentando manter sala ativa...", true);
   }
  });
 }

 $("criarSala").addEventListener("click", () => {
  if (peer) return;
  myName = cleanName($("nomeCriador").value);
  if (!myName) { message("Digite seu nome antes de criar a sala.", true); return; }
  host = true;
  roomCode = makeCode();
  localStorage.setItem("lf-v16-last-room", JSON.stringify({code: roomCode, name: myName, host: true}));
  message("Criando sala...");
  setupHost();
 });

 function connectClientToHost(isReconnect = false) {
  window.__lfV16Reconnect = () => connectClientToHost(true);
  if (!isReconnect) {
   clientId = clientKey();
  } else if (!clientId) {
   clientId = clientKey();
  }
  if (peer) {
   try { peer.destroy(); } catch(e){}
  }
  peer = new Peer(clientId, peerConfig);

  peer.on("open", () => {
   let connected = false;
   hostConn = peer.connect(PEER_PREFIX + roomCode, { reliable: true });

   hostConn.on("open", () => {
    connected = true;
    safeSend(hostConn, { type: "hello", name: myName, clientId });
    if ($("conexao")) $("conexao").textContent = "Conectado ao Anfitrião";
   });

   hostConn.on("data", data => {
    try {
     if (!data) return;
     if (data.type === "ping") return;
     if (data.type === "state") {
      const wasFinished = state?.finished;
      state = data.state;
      host = false;
      renderAll();
      if (state.finished && !wasFinished) {
       iniciarTransmissaoAoVivo();
      }
      if (!state.started) {
       message("Conectado com sucesso à sala " + roomCode + "!");
      }
     }
     if (data.type === "finishTournament") {
      const wasFinished = state?.finished;
      if (data.state) state = data.state;
      if (!state) state = { players: {}, finished: true };
      state.finished = true;
      state.auction = null;
      if (data.tournament) state.tournament = data.tournament;
      host = false;
      renderAll();
      if (!wasFinished) {
       iniciarTransmissaoAoVivo();
      }
     }
     if (data.type === "error") {
      message(data.message, true);
     }
    } catch (err) {
     console.error("Erro ao processar dados do anfitrião:", err);
    }
   });

   hostConn.on("close", () => {
    if ($("conexao")) $("conexao").textContent = "Conexão oscilou. Clique em Sincronizar Tela se precisar.";
   });

   hostConn.on("error", err => {
    console.warn("Oscilação P2P:", err);
   });

   setTimeout(() => {
    if (!connected && !isReconnect) {
     message("Sala não encontrada ou demorando a responder. Verifique o código de 6 números.", true);
     try { peer.destroy(); } catch(e){}
     peer = null;
    }
   }, 8000);
  });

  peer.on("error", err => {
   if (!isReconnect) {
    message("Não foi possível conectar (" + err.type + "). Verifique o número da sala.", true);
    try { peer.destroy(); } catch(e){}
    peer = null;
   }
  });
 }

 $("entrarSala").addEventListener("click", () => {
  if (peer) return;
  myName = cleanName($("nomeConvidado").value);
  roomCode = $("codigoSala").value.replace(/\D/g, "").trim();
  if (!myName || !/^\d{6}$/.test(roomCode)) {
   message("Informe seu nome e os 6 números do código da sala.", true);
   return;
  }
  localStorage.setItem("lf-v16-last-room", JSON.stringify({code: roomCode, name: myName, host: false}));
  message("Conectando à sala " + roomCode + "...");
  connectClientToHost(false);
 });

 document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !host && hostConn && hostConn.open) {
   safeSend(hostConn, { type: "requestSync" });
  }
 });

 // BOTÃO DE SINCRONIZAÇÃO MANUAL ANTI-TRAVAMENTO
 $("btnSincronizar").addEventListener("click", () => {
  if (host) {
   publish();
   msg("Estado sincronizado com todos os jogadores!");
  } else {
   if (hostConn && hostConn.open) {
    safeSend(hostConn, { type: "requestSync" });
    msg("Solicitando atualização ao anfitrião...");
   } else {
    msg("Reconectando à sala...");
    connectClientToHost(true);
   }
  }
 });

 $("copiarCodigo").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomCode); message("Código " + roomCode + " copiado!"); }
  catch(e) { message("Código da sala: " + roomCode); }
 });

 $("iniciarLeilao").addEventListener("click", () => {
  if (!host || !state) return;
  startAuction();
 });

 // RENDERIZAÇÃO GERAL
 function renderAll() {
  if (!state) return;

  if (!state.started) {
   $("telaLobby").classList.remove("escondido");
   $("telaJogo").classList.add("escondido");
   showLobbyRoom();
   return;
  }

  $("telaLobby").classList.add("escondido");
  $("telaJogo").classList.remove("escondido");
  renderGame();
 }

 function getFormationSlots(formacao) {
  const rows = formacoes[formacao] || formacoes["4-3-3"];
  const slots = [];
  let idx = 0;
  rows.forEach((row, rIdx) => {
   row.forEach((pos, cIdx) => { slots.push({ id: "slot-" + idx++, pos, row: rIdx, col: cIdx }); });
  });
  return slots;
 }

 function isCompatible(slotPos, playerPos) {
  return (compatibilidade[slotPos] || [slotPos]).includes(playerPos);
 }

 function countLineup(player) {
  if (!player || !player.lineup) return 0;
  return Object.keys(player.lineup).length;
 }

 function renderCampoVisual(me, containerId, interactive) {
  const formacaoAtual = me.formation || "4-3-3";
  const lineup = me.lineup || {};
  const rows = formacoes[formacaoAtual] || formacoes["4-3-3"];
  const campo = $(containerId);
  campo.innerHTML = "";
  let idx = 0;

  rows.forEach(row => {
   const line = document.createElement("div");
   line.className = "linha-jogadores";
   row.forEach(pos => {
    const slotId = "slot-" + idx++;
    const jog = lineup[slotId];
    const card = document.createElement("div");
    const isImprovisado = jog && jog.posicao !== pos;
    card.className = "card-jogador" + (jog ? (isImprovisado ? " improvisado" : "") : " vazio");
    if (!interactive) card.style.cursor = "default";

    if (jog) {
     const ovrEfetivo = getEffectiveOverall(jog, pos);
     const photoStyle = fotosJogadores.has(jog.nome) && fotosJogadores.get(jog.nome) ? `background-image:url('${fotosJogadores.get(jog.nome)}');background-size:cover;` : "";
     card.innerHTML = `
      <div class="fifa-card" style="${photoStyle}">
       <div class="fifa-ovr">${ovrEfetivo}</div>
       <div class="fifa-pos">${pos}</div>
       <div class="fifa-photo">${photoStyle ? "" : jog.nome[0]}</div>
       <div class="fifa-name">${jog.nome.split(" ").slice(-1)[0]}</div>
       <div class="fifa-full">${jog.nome}</div>
       ${isImprovisado ? '<div class="fifa-imp">IMP</div>' : ""}
      </div>`;
     // Trigger photo load if needed
     if (!fotosJogadores.has(jog.nome)) carregarFotoJogador(jog.nome);
    } else {
     card.innerHTML = `<div class="fifa-card empty"><div class="fifa-pos">${pos}</div><div class="fifa-photo">+</div><div class="fifa-name">Vaga</div></div>`;
    }

    if (interactive) {
     card.onclick = () => abrirModalVaga(slotId, pos);
    }
    line.appendChild(card);
   });
   campo.appendChild(line);
  });
 }

 function renderBancoVisual(me, containerId, interactive) {
  const lineup = me.lineup || {};
  const escaladosNomes = new Set(Object.values(lineup).map(j => j.nome));
  const banco = (me.roster || []).filter(j => !escaladosNomes.has(j.nome));
  const listaBanco = $(containerId);
  listaBanco.innerHTML = "";

  if (!banco.length) {
   listaBanco.innerHTML = `<p style="color:#8ca4bb;font-size:12px">Nenhum jogador aguardando no banco.</p>`;
  } else {
   banco.forEach(j => {
    const item = document.createElement("div");
    item.className = "item-banco";
    if (!interactive) item.style.cursor = "default";
    item.innerHTML = `<div><strong>${j.nome}</strong> <small style="color:#27aaff">(${j.posicao} • Perna: ${j.pernaBoa || "Direita"})</small></div><span>${j.overall} ⭐</span>`;
    if (interactive) {
     item.onclick = () => abrirModalJogadorParaVaga(j);
    }
    listaBanco.appendChild(item);
   });
  }
 }

 function atualizarBotoesLance() {
  const me = myPlayer();
  const a = state?.auction;
  if (!a || state.finished || state.paused || !me) {
   $("darLance").disabled = true;
   $("darLance5").disabled = true;
   $("darLance10").disabled = true;
   $("passar").disabled = true;
   $("darLance").textContent = "Dar lance (+ € 1.000.000)";
   return;
  }

  const agora = Date.now();
  const restanteMs = Math.max(0, 3000 - (agora - lastMyBidAt));
  const emCooldown = restanteMs > 0;

  if (emCooldown) {
   const segs = (restanteMs / 1000).toFixed(1);
   $("darLance").textContent = `Aguarde ${segs}s...`;
   $("darLance").disabled = true;
   $("darLance5").disabled = true;
   $("darLance10").disabled = true;
  } else {
   $("darLance").textContent = "Dar lance (+ € 1.000.000)";
   $("darLance").disabled = me.budget < (a.highestBid + 1000000);
   $("darLance5").disabled = me.budget < (a.highestBid + 5000000);
   $("darLance10").disabled = me.budget < (a.highestBid + 10000000);
  }
  $("passar").disabled = false;
 }

 // Loop contínuo leve de UI para atualizar o botão de cooldown de 3s suavemente
 setInterval(() => {
  if (state && state.started && !state.finished && !state.paused && state.auction) {
   atualizarBotoesLance();
  }
 }, 200);

 function renderGame() {
  $("roomLabel").textContent = "Sala " + roomCode;
  $("conexao").textContent = host ? "Anfitrião do Torneio" : "Conectado ao Anfitrião";

  const me = myPlayer();
  $("saldo").textContent = fmt(me?.budget);

  if (me) {
   const forcaMain = calcularForcaTime(me);
   $("titularesCount").textContent = countLineup(me);
   $("mediaOverallMain").textContent = forcaMain.toFixed(1);
   $("formacaoAtualLabel").textContent = me.formation || "4-3-3";
   renderCampoVisual(me, "campoJogadoresPrincipal", false);
   renderBancoVisual(me, "listaBancoPrincipal", false);
  }

  $("areaControleAnfitriao").classList.toggle("escondido", !host);
  if (host) {
   $("botaoPausaGlobal").textContent = state.paused ? "▶️ Retomar Leilão" : "⏸️ Pausar Leilão (Arrumar Time)";
  }

  if (state.paused && !state.finished) {
   const forcaModal = me ? calcularForcaTime(me) : 0;
   $("mediaOverallModal").textContent = forcaModal.toFixed(1);
   $("titularesModalCount").textContent = (me ? countLineup(me) : 0) + " / 11";
   $("modalPausaGlobal").classList.add("ativo");

   if (me) {
    const formacaoAtual = me.formation || "4-3-3";
    if ($("formacaoModal").value !== formacaoAtual) { $("formacaoModal").value = formacaoAtual; }
    renderCampoVisual(me, "campoJogadoresModal", true);
    renderBancoVisual(me, "listaBancoModal", true);
   }

   const areaRetomar = $("areaBotaoRetomar");
   areaRetomar.innerHTML = "";
   if (host) {
    const btnRet = document.createElement("button");
    btnRet.textContent = "▶️ Retomar Leilão (Salvar Alterações)";
    btnRet.style.width = "100%";
    btnRet.style.maxWidth = "420px";
    btnRet.style.background = "linear-gradient(90deg,#00b8ff,#007bd1)";
    btnRet.style.padding = "14px";
    btnRet.style.fontWeight = "bold";
    btnRet.style.borderRadius = "8px";
    btnRet.onclick = () => sendToHost({ type: "togglePause" });
    areaRetomar.appendChild(btnRet);
   } else {
    const pInfo = document.createElement("p");
    pInfo.style.color = "#ffaa00";
    pInfo.style.textAlign = "center";
    pInfo.style.fontWeight = "bold";
    pInfo.textContent = "Suas mudanças estão salvas! Aguardando o anfitrião retomar o leilão...";
    areaRetomar.appendChild(pInfo);
   }
  } else {
   $("modalPausaGlobal").classList.remove("ativo");
  }

  $("participantes").innerHTML = "";
  Object.values(state.players || {}).forEach(p => {
   if (p.isBot) return;
   const li = document.createElement("li");
   const esc = countLineup(p);
   const forca = calcularForcaTime(p).toFixed(1);
   li.textContent = `${p.name} — ${fmt(p.budget)} • Titulares: ${esc}/11 • Força: ${forca}`;
   $("participantes").appendChild(li);
  });

  $("historico").innerHTML = "";
  (state.history || []).slice(-10).reverse().forEach(item => {
   const li = document.createElement("li");
   li.textContent = item;
   $("historico").appendChild(li);
  });

  if (state.finished) {
   $("areaLeilao").classList.add("escondido");
   $("secTimePrincipal").classList.add("escondido");
   $("resultados").classList.remove("escondido");
   if (!simTimerId && !simFinishedLocal) {
    iniciarTransmissaoAoVivo();
   }
  } else {
   $("areaLeilao").classList.remove("escondido");
   $("secTimePrincipal").classList.remove("escondido");
   $("resultados").classList.add("escondido");
  }

  if (state.auction && !state.finished && !state.paused) {
   const a = state.auction;
   $("etiquetaCiclo").textContent = `JOGADOR EM LEILÃO • POSIÇÃO: ${a.cycleLabel || a.player.posicao}`;
   $("nomeJogador").textContent = a.player.nome;
   $("dadosJogador").textContent = `${nomesPosicao[a.player.posicao] || a.player.posicao} (${a.player.posicao}) • Perna: ${a.player.pernaBoa} • Overall ${a.player.overall}`;
   $("avatar").textContent = a.player.posicao === "GOL" ? "🧤" : "⚽";
   carregarFotoJogador(a.player.nome);
   $("maiorLance").textContent = fmt(a.highestBid);
   const bidder = state.players[a.highestBidder];
   $("maiorLicitante").textContent = bidder ? bidder.name : "Nenhum lance ainda (Começa em € 0)";
   $("timer").textContent = state.seconds + "s";
   atualizarBotoesLance();
  } else if (state.paused) {
   $("timer").textContent = "PAUSADO";
   atualizarBotoesLance();
  }
 }

 function tentarDarLance(incremento) {
  const agora = Date.now();
  if (agora - lastMyBidAt < 3000) {
   const falta = ((3000 - (agora - lastMyBidAt)) / 1000).toFixed(1);
   msg(`Aguarde ${falta}s para dar outro lance!`);
   return;
  }
  lastMyBidAt = agora;
  atualizarBotoesLance();
  sendToHost({ type: "bid", increment: incremento });
 }

 $("darLance").addEventListener("click", () => tentarDarLance(1000000));
 $("darLance5").addEventListener("click", () => tentarDarLance(5000000));
 $("darLance10").addEventListener("click", () => tentarDarLance(10000000));
 $("passar").addEventListener("click", () => msg("Você passou nesta rodada."));

 $("botaoPausaGlobal").addEventListener("click", () => {
  if (!host) return;
  sendToHost({ type: "togglePause" });
 });

 $("botaoEncerrarLeilao").addEventListener("click", () => {
  if (!host) return;
  if (confirm("Deseja encerrar o leilão e iniciar a simulação ao vivo agora?")) {
   sendToHost({ type: "finishAuction" });
  }
 });

 function abrirModalVaga(slotId, slotPos) {
  if (state.finished) return;
  const me = myPlayer();
  if (!me) return;

  const lineup = me.lineup || {};
  const atualNaVaga = lineup[slotId];
  const escaladosOutros = new Set(Object.entries(lineup).filter(([k]) => k !== slotId).map(([, v]) => v.nome));
  const compativeis = (me.roster || []).filter(j => isCompatible(slotPos, j.posicao) && !escaladosOutros.has(j.nome));

  $("posicaoSelecionada").textContent = `Vaga: ${nomesPosicao[slotPos] || slotPos} (${slotPos})`;
  const container = $("opcoesJogadores");
  container.innerHTML = "";

  if (atualNaVaga) {
   const btnRemover = document.createElement("button");
   btnRemover.className = "opcao-jogador secundario";
   btnRemover.innerHTML = `<strong>Remover ${atualNaVaga.nome}</strong><span>Mandar p/ Banco</span>`;
   btnRemover.onclick = () => { sendToHost({ type: "unassignSlot", slotId }); fecharModaisAux(); };
   container.appendChild(btnRemover);
  }

  if (!compativeis.length) {
   const p = document.createElement("p"); p.style.color = "#ffb4b4"; p.style.fontSize = "13px";
   p.textContent = "Sem jogadores compatíveis disponíveis no banco."; container.appendChild(p);
  } else {
   compativeis.forEach(j => {
    const ovrAjustado = getEffectiveOverall(j, slotPos);
    const diff = ovrAjustado - j.overall;
    const tagImp = diff < 0 ? ` <small style="color:#ffaa00">(Improvisado: ${ovrAjustado} ⭐)</small>` : "";
    const b = document.createElement("button"); b.className = "opcao-jogador";
    b.innerHTML = `<div><strong>${j.nome} (${j.posicao} • Perna: ${j.pernaBoa})</strong>${tagImp}</div><span>${ovrAjustado} ⭐</span>`;
    b.onclick = () => { sendToHost({ type: "assignSlot", slotId, playerName: j.nome }); fecharModaisAux(); };
    container.appendChild(b);
   });
  }
  $("modalJogadores").classList.add("ativo");
 }

 function abrirModalJogadorParaVaga(jogador) {
  if (state.finished) return;
  const me = myPlayer(); if (!me) return;
  const slots = getFormationSlots(me.formation || "4-3-3");
  const lineup = me.lineup || {};
  const slotsCompativeis = slots.filter(s => isCompatible(s.pos, jogador.posicao));

  $("jogadorParaEscalar").textContent = `${jogador.nome} (${jogador.posicao} • Perna: ${jogador.pernaBoa} • Base: ${jogador.overall} ⭐)`;
  const container = $("opcoesPosicoes"); container.innerHTML = "";

  if (!slotsCompativeis.length) {
   const p = document.createElement("p"); p.style.color = "#ffb4b4"; p.style.fontSize = "13px";
   p.textContent = "Nenhuma posição compatível na formação atual."; container.appendChild(p);
  } else {
   slotsCompativeis.forEach(s => {
    const ocupante = lineup[s.id];
    const ovrAjustado = getEffectiveOverall(jogador, s.pos);
    const diffText = ovrAjustado < jogador.overall ? ` • OVR na vaga: ${ovrAjustado} ⭐` : ` • OVR: ${ovrAjustado} ⭐`;
    const b = document.createElement("button"); b.className = "opcao-jogador";
    b.innerHTML = `<strong>${nomesPosicao[s.pos] || s.pos} (${s.pos})${diffText}</strong><span>${ocupante ? "Trocar " + ocupante.nome : "Vaga livre"}</span>`;
    b.onclick = () => { sendToHost({ type: "assignSlot", slotId: s.id, playerName: jogador.nome }); fecharModaisAux(); };
    container.appendChild(b);
   });
  }
  $("modalPosicoes").classList.add("ativo");
 }

 function fecharModaisAux() {
  $("modalJogadores").classList.remove("ativo");
  $("modalPosicoes").classList.remove("ativo");
 }

 $("fecharModal").onclick = fecharModaisAux;
 $("fecharModalPos").onclick = fecharModaisAux;
 window.onclick = e => {
  if (e.target === $("modalJogadores")) fecharModaisAux();
  if (e.target === $("modalPosicoes")) fecharModaisAux();
 };

 $("formacaoModal").addEventListener("change", e => {
  sendToHost({ type: "setFormation", formation: e.target.value });
 });

 // CONTROLE DE ABAS DE RESULTADOS
 window.mudarAbaResultados = function(aba) {
  const isMata = aba === 'matamata';
  $("btnTabMataMata").classList.toggle("ativa", isMata);
  $("btnTabArtilharia").classList.toggle("ativa", !isMata);
  $("conteudoMataMata").classList.toggle("escondido", !isMata);
  $("conteudoArtilharia").classList.toggle("escondido", isMata);
 };

 // SIMULAÇÃO DETALHADA COM EVENTOS GOL POR GOL, JOGO POR JOGO (ESTILO 7A0)
 function computeTournament() {
  const playersArr = Object.values(state.players || {}).filter(p => !p.isBot);
  let teams = playersArr.map(p => {
   const forcaReal = calcularForcaTime(p);
   const slots = getFormationSlots(p.formation || "4-3-3");
   const lineup = p.lineup || {};
   // Monta lista de titulares com overall efetivo e peso ofensivo para marcar gols
   const lineupArr = slots.map(s => {
    const j = lineup[s.id];
    if (!j) return null;
    return {
     nome: j.nome,
     posicao: s.pos,
     overall: getEffectiveOverall(j, s.pos)
    };
   }).filter(Boolean);

   return { id: p.id, name: p.name, forca: forcaReal, count: lineupArr.length, lineup: lineupArr };
  });

  const botNames = ["Craque Bot", "Tite Bot", "Guardiola Bot", "Ancelotti Bot", "Abel Bot", "Jürgen Bot", "Mourinho Bot", "Xavi Bot", "Klopp Bot", "Zidane Bot", "Cafu Bot", "Ronaldo Bot", "Pelé Bot", "Kaká Bot", "Ronaldinho Bot", "Zagallo Bot"];
  let bIdx = 0;
  while(teams.length < 16) {
   const botOvr = Math.floor(75 + Math.random() * 7);
   teams.push({ id: "bot-"+bIdx, name: botNames[bIdx++] + " (" + botOvr + ")", forca: botOvr, count: 11, lineup: [] });
  }
  teams.sort(() => Math.random() - 0.5);

  function escolherGoleador(teamObj) {
   if (!teamObj.lineup || teamObj.lineup.length === 0) return teamObj.name;
   // Atacantes, pontas e meias têm mais chance de fazer gol do que zagueiros/goleiros
   const pesos = { ATA: 6, PE: 5, PD: 5, MEI: 4, MC: 3, VOL: 2, LE: 1.5, LD: 1.5, ZAG: 1, GOL: 0.1 };
   let pool = [];
   teamObj.lineup.forEach(j => {
    const w = Math.max(1, Math.round((pesos[j.posicao] || 2) * 2));
    for (let k = 0; k < w; k++) pool.push(j.nome);
   });
   return pool[Math.floor(Math.random() * pool.length)];
  }

  function simulateMatch(t1, t2, faseNome, jogoLabel) {
   // Diferença de força real (considerando 11 vagas e penalidades de improviso)
   const diff = t1.forca - t2.forca;
   // Se um time tem 11 jogadores (força ~80) e outro tem 4 (força ~15), diff = +65 -> goleada garantida!
   const exp1 = Math.max(0.15, 1.35 + (diff * 0.14) + (Math.random() * 1.4 - 0.7));
   const exp2 = Math.max(0.15, 1.35 - (diff * 0.14) + (Math.random() * 1.4 - 0.7));

   const g1 = Math.max(0, Math.round(exp1));
   const g2 = Math.max(0, Math.round(exp2));

   let goals = [];
   let details1List = [];
   let details2List = [];

   for (let i = 0; i < g1; i++) {
    const min = Math.floor(2 + Math.random() * 88);
    const scorer = escolherGoleador(t1);
    goals.push({ minute: min, teamId: t1.id, teamName: t1.name, scorer });
   }
   for (let i = 0; i < g2; i++) {
    const min = Math.floor(2 + Math.random() * 88);
    const scorer = escolherGoleador(t2);
    goals.push({ minute: min, teamId: t2.id, teamName: t2.name, scorer });
   }

   // Ordena os gols cronologicamente pelo minuto da partida
   goals.sort((a, b) => a.minute - b.minute);

   goals.forEach(g => {
    if (g.teamId === t1.id) details1List.push(`${g.scorer} (${g.minute}')`);
    else details2List.push(`${g.scorer} (${g.minute}')`);
   });

   let winner = null;
   let penalties = false;
   if (g1 !== g2) {
    winner = g1 > g2 ? t1 : t2;
   } else {
    penalties = true;
    const probT1 = 0.5 + Math.max(-0.4, Math.min(0.4, diff * 0.03));
    winner = Math.random() < probT1 ? t1 : t2;
   }

   return {
    id: `${faseNome}-${jogoLabel}`,
    faseNome,
    jogoLabel,
    t1: { id: t1.id, name: t1.name, forca: t1.forca },
    t2: { id: t2.id, name: t2.name, forca: t2.forca },
    g1,
    g2,
    penalties,
    winner: { id: winner.id, name: winner.name, forca: winner.forca },
    score: penalties ? `${g1} × ${g2} (pên.)` : `${g1} × ${g2}`,
    details1: details1List.join(", "),
    details2: details2List.join(", "),
    goals
   };
  }

  let oitavas = [], vencedoresOitavas = [];
  for(let i=0; i<16; i+=2) {
   const res = simulateMatch(teams[i], teams[i+1], "Oitavas de Final", `Jogo ${i/2 + 1}/8`);
   oitavas.push(res);
   vencedoresOitavas.push(res.winner);
  }

  let quartas = [], vencedoresQuartas = [];
  for(let i=0; i<8; i+=2) {
   const res = simulateMatch(vencedoresOitavas[i], vencedoresOitavas[i+1], "Quartas de Final", `Jogo ${i/2 + 1}/4`);
   quartas.push(res);
   vencedoresQuartas.push(res.winner);
  }

  let semis = [], vencedoresSemis = [];
  for(let i=0; i<4; i+=2) {
   const res = simulateMatch(vencedoresQuartas[i], vencedoresQuartas[i+1], "Semifinal", `Jogo ${i/2 + 1}/2`);
   semis.push(res);
   vencedoresSemis.push(res.winner);
  }

  const finalRes = simulateMatch(vencedoresSemis[0], vencedoresSemis[1], "GRANDE FINAL", "Final Única");

  return { oitavas, quartas, semis, final: finalRes };
 }

 // MOTOR DE TRANSMISSÃO AO VIVO ESTILO 7A0 (JOGO POR JOGO, GOL POR GOL)
 function iniciarTransmissaoAoVivo() {
  if (!state || !state.tournament) {
   if (host) {
    state.tournament = computeTournament();
    publish();
   } else {
    return;
   }
  }

  clearInterval(simTimerId);
  simFinishedLocal = false;
  simSpeed = 1;
  $("btnAcelerarSim").textContent = "⏩ Velocidade: 1x";
  $("badgeLive").textContent = "🔴 AO VIVO";
  $("badgeLive").classList.remove("finalizado");

  const t = state.tournament;
  const allMatches = [...t.oitavas, ...t.quartas, ...t.semis, t.final];

  // Constrói fila cronológica de passos da transmissão (início de jogo, cada gol, fim de jogo)
  const timeline = [];
  allMatches.forEach((m, mIdx) => {
   timeline.push({ type: "start", matchIdx: mIdx, match: m, minute: 0, g1: 0, g2: 0 });
   let curG1 = 0, curG2 = 0;
   (m.goals || []).forEach(g => {
    if (g.teamId === m.t1.id) curG1++;
    else curG2++;
    timeline.push({
     type: "goal",
     matchIdx: mIdx,
     match: m,
     minute: g.minute,
     g1: curG1,
     g2: curG2,
     goal: g
    });
   });
   timeline.push({
    type: "end",
    matchIdx: mIdx,
    match: m,
    minute: 90,
    g1: m.g1,
    g2: m.g2
   });
  });

  const revealedMatches = new Set();
  const liveArtMap = {};
  const feed = $("feedEventos");
  feed.innerHTML = "";
  simIndex = 0;

  function renderArtilhariaParcial() {
   const tbody = $("corpoTabelaArtilheiros");
   if (!tbody) return;
   tbody.innerHTML = "";
   const arr = Object.values(liveArtMap).sort((a, b) => b.gols - a.gols);
   if (!arr.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#9fb4c9;text-align:center;">Nenhum gol marcado ainda na transmissão...</td></tr>`;
    return;
   }
   arr.forEach((art, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
     <td><strong>#${index + 1}</strong></td>
     <td style="color:#27aaff; font-weight:bold;">${art.nome}</td>
     <td>${art.time}</td>
     <td><strong style="color:#5ee0ae;">${art.gols} ⚽</strong></td>
    `;
    tbody.appendChild(tr);
   });
  }

  function appendFeed(texto, classe = "") {
   const div = document.createElement("div");
   div.className = "evento-item " + classe;
   div.textContent = texto;
   feed.prepend(div);
  }

  function processStep(step) {
   const m = step.match;
   $("faseAoVivo").textContent = `${m.faseNome} • ${m.jogoLabel}`;
   $("liveTime1").textContent = m.t1.name;
   $("liveTime2").textContent = m.t2.name;
   $("livePlacar").textContent = `${step.g1} × ${step.g2}`;
   $("liveMinuto").textContent = `⏱️ ${step.minute}'`;
   $("statusTransmissao").textContent = `${m.faseNome}: ${m.t1.name} × ${m.t2.name}`;

   if (step.type === "start") {
    appendFeed(`📢 [${m.faseNome}] Começa o jogo: ${m.t1.name} × ${m.t2.name}!`, "apito");
    renderMataMataBracket(revealedMatches, m.id);
   } else if (step.type === "goal") {
    const g = step.goal;
    appendFeed(`⚽ GOOOL! ${g.minute}' — ${g.scorer} (${g.teamName})! Placar: ${m.t1.name} ${step.g1} × ${step.g2} ${m.t2.name}`, "gol");
    if (!liveArtMap[g.scorer]) {
     liveArtMap[g.scorer] = { nome: g.scorer, time: g.teamName, gols: 0 };
    }
    liveArtMap[g.scorer].gols++;
    renderArtilhariaParcial();
   } else if (step.type === "end") {
    const penTxt = m.penalties ? ` (Venceu nos pênaltis: ${m.winner.name})` : "";
    appendFeed(`🏁 Fim de jogo! ${m.t1.name} ${m.g1} × ${m.g2} ${m.t2.name}${penTxt}`, "apito");
    revealedMatches.add(m.id);
    renderMataMataBracket(revealedMatches, null);
   }
  }

  function finishAllSimulation() {
   clearInterval(simTimerId);
   simTimerId = null;
   simFinishedLocal = true;
   $("badgeLive").textContent = "✅ TORNEIO ENCERRADO";
   $("badgeLive").classList.add("finalizado");
   $("statusTransmissao").textContent = `👑 CAMPEÃO DO TORNEIO: ${t.final.winner.name}!`;
   $("faseAoVivo").textContent = "GRANDE FINAL • RESULTADO OFICIAL";
   $("liveTime1").textContent = t.final.t1.name;
   $("liveTime2").textContent = t.final.t2.name;
   $("livePlacar").textContent = t.final.score;
   $("liveMinuto").textContent = "🏆 FIM DO CAMPEONATO";

   allMatches.forEach(m => revealedMatches.add(m.id));
   // Garante que todos os gols estejam na artilharia
   Object.keys(liveArtMap).forEach(k => delete liveArtMap[k]);
   allMatches.forEach(m => {
    (m.goals || []).forEach(g => {
     if (!liveArtMap[g.scorer]) liveArtMap[g.scorer] = { nome: g.scorer, time: g.teamName, gols: 0 };
     liveArtMap[g.scorer].gols++;
    });
   });
   renderArtilhariaParcial();
   renderMataMataBracket(revealedMatches, null);
  }

  $("btnAcelerarSim").onclick = () => {
   simSpeed = simSpeed === 1 ? 2 : (simSpeed === 2 ? 4 : 1);
   $("btnAcelerarSim").textContent = `⏩ Velocidade: ${simSpeed}x`;
   restartLoop();
  };

  $("btnPularSim").onclick = () => {
   while (simIndex < timeline.length) {
    processStep(timeline[simIndex++]);
   }
   finishAllSimulation();
  };

  renderMataMataBracket(revealedMatches, null);
  renderArtilhariaParcial();

  function restartLoop() {
   clearInterval(simTimerId);
   const intervalMs = Math.round(1300 / simSpeed);
   simTimerId = setInterval(() => {
    if (simIndex >= timeline.length) {
     finishAllSimulation();
     return;
    }
    processStep(timeline[simIndex++]);
   }, intervalMs);
  }

  // Dispara o primeiro evento imediatamente e inicia o loop
  if (timeline.length > 0) {
   processStep(timeline[simIndex++]);
   restartLoop();
  }
 }

 function renderMataMataBracket(revealedSet, activeMatchId) {
  if (!state || !state.tournament) return;
  const t = state.tournament;
  const container = $("bracketContainer");
  container.innerHTML = "";

  function createPhaseCol(title, matches) {
   const col = document.createElement("div");
   col.className = "fase-col";
   col.innerHTML = `<h3>${title}</h3>`;
   matches.forEach(m => {
    const isRevealed = !revealedSet || revealedSet.has(m.id);
    const isActive = activeMatchId && m.id === activeMatchId;
    const div = document.createElement("div");
    div.className = "jogo-mata" + (isActive ? " em-andamento" : "");

    if (!isRevealed) {
     div.innerHTML = `
      <div class="time-jogo"><span>${m.t1.name}</span><span>${isActive ? "🔴" : "-"}</span></div>
      <div class="time-jogo"><span>${m.t2.name}</span><span>${isActive ? "AO VIVO" : "-"}</span></div>
      <div class="gols-detalhe" style="color:#8ca4bb;">${isActive ? "⚽ Partida em andamento..." : "⏳ Aguardando início..."}</div>
     `;
    } else {
     const v1 = m.winner.id === m.t1.id ? "vencedor" : "";
     const v2 = m.winner.id === m.t2.id ? "vencedor" : "";
     div.innerHTML = `
      <div class="time-jogo ${v1}"><span>${m.t1.name}</span><span>${m.score.split("×")[0]}</span></div>
      <div class="time-jogo ${v2}"><span>${m.t2.name}</span><span>${m.score.split("×")[1] || ""}</span></div>
      <div class="gols-detalhe">⚽ ${m.t1.name}: ${m.details1 || "Nenhum"}</div>
      <div class="gols-detalhe">⚽ ${m.t2.name}: ${m.details2 || "Nenhum"}</div>
     `;
    }
    col.appendChild(div);
   });
   return col;
  }

  container.appendChild(createPhaseCol("⚡ Oitavas de Final", t.oitavas));
  container.appendChild(createPhaseCol("🔥 Quartas de Final", t.quartas));
  container.appendChild(createPhaseCol("⭐ Semifinais", t.semis));
  
  const finalCol = document.createElement("div");
  finalCol.className = "fase-col";
  finalCol.innerHTML = `<h3>🏆 GRANDE FINAL</h3>`;
  const fd = document.createElement("div");
  const finalRevealed = !revealedSet || revealedSet.has(t.final.id);
  const finalActive = activeMatchId && t.final.id === activeMatchId;
  fd.className = "jogo-mata" + (finalActive ? " em-andamento" : "");
  fd.style.border = "2px solid #5ee0ae";

  if (!finalRevealed) {
   fd.innerHTML = `
    <div style="color:#ffaa00;font-weight:bold;margin-bottom:6px;text-align:center">${finalActive ? "🔴 DECISÃO AO VIVO!" : "⏳ AGUARDANDO FINALISTAS"}</div>
    <div class="time-jogo"><span>${t.final.t1.name}</span></div>
    <div class="time-jogo"><span>${t.final.t2.name}</span></div>
   `;
  } else {
   const fv1 = t.final.winner.id === t.final.t1.id ? "vencedor" : "";
   const fv2 = t.final.winner.id === t.final.t2.id ? "vencedor" : "";
   fd.innerHTML = `
    <div style="color:#5ee0ae;font-weight:bold;margin-bottom:6px;text-align:center">👑 CAMPEÃO: ${t.final.winner.name}</div>
    <div class="time-jogo ${fv1}"><span>${t.final.t1.name}</span></div>
    <div class="time-jogo ${fv2}"><span>${t.final.t2.name}</span></div>
    <div style="text-align:center;margin-top:6px;color:#27aaff">Placar: ${t.final.score}</div>
    <div class="gols-detalhe">⚽ ${t.final.t1.name}: ${t.final.details1 || "Nenhum"}</div>
    <div class="gols-detalhe">⚽ ${t.final.t2.name}: ${t.final.details2 || "Nenhum"}</div>
   `;
  }
  finalCol.appendChild(fd);
  container.appendChild(finalCol);
 }

 // VERIFICA SE TODOS OS PARTICIPANTES HUMANOS JÁ FECHARAM 11 TITULARES
 function checkAllTeamsComplete() {
  if (!host || !state || state.finished || ended) return false;
  const humans = Object.values(state.players || {}).filter(p => !p.isBot);
  if (humans.length === 0) return false;
  const todosCompletos = humans.every(p => countLineup(p) >= 11);
  if (todosCompletos) {
   state.history.push("🎉 Todos os jogadores completaram seus 11 titulares! Iniciando simulação automaticamente...");
   finishAuction();
   return true;
  }
  return false;
 }

 function handleHostMessage(data, from) {
  if (!host || !state) return;
  const p = state.players[from]; if (!p) return;

  if (data.type === "togglePause") {
   state.paused = !state.paused;
   state.history.push(state.paused ? "⏸️ Anfitrião pausou o leilão para organizar times!" : "▶️ Anfitrião retomou o leilão!");
   publish();
   return;
  }

  if (data.type === "finishAuction") {
   finishAuction();
   return;
  }

  if (data.type === "bid") {
   if (state.paused || state.finished) return;
   const a = state.auction;
   if (!a) return;

   // Validação de cooldown de 3 segundos por jogador no servidor (anfitrião)
   const agora = Date.now();
   if (p.lastBidTime && (agora - p.lastBidTime) < 2800) {
    return;
   }

   const inc = data.increment || 1000000;
   const newBid = a.highestBid + inc;
   if (p.budget < newBid) return;

   p.lastBidTime = agora;
   a.highestBid = newBid;
   a.highestBidder = from;
   state.seconds = 10;
   state.history.push(`${p.name} deu lance de ${fmt(newBid)} em ${a.player.nome}`);
   publish();
   msg(`Novo lance de ${p.name}: ${fmt(newBid)}!`);
  }

  if (data.type === "setFormation") {
   if (!formacoes[data.formation]) return;
   p.formation = data.formation;
   const slots = getFormationSlots(p.formation);
   const old = Object.values(p.lineup || {});
   const newLineup = {};
   old.forEach(jog => {
    const free = slots.find(s => !newLineup[s.id] && isCompatible(s.pos, jog.posicao));
    if (free) newLineup[free.id] = jog;
   });
   p.lineup = newLineup;
   publish();
   checkAllTeamsComplete();
  }

  if (data.type === "assignSlot") {
   const slots = getFormationSlots(p.formation || "4-3-3");
   const target = slots.find(s => s.id === data.slotId);
   const jogador = (p.roster || []).find(j => j.nome === data.playerName);
   if (!target || !jogador || !isCompatible(target.pos, jogador.posicao)) return;

   p.lineup = p.lineup || {};
   Object.keys(p.lineup).forEach(k => { if (p.lineup[k]?.nome === jogador.nome) delete p.lineup[k]; });
   p.lineup[target.id] = jogador;
   publish();
   checkAllTeamsComplete();
  }

  if (data.type === "unassignSlot") {
   if (!p.lineup) return;
   delete p.lineup[data.slotId];
   publish();
  }
 }

 function autoPlace(playerObj, novoJogador) {
  const slots = getFormationSlots(playerObj.formation || "4-3-3");
  playerObj.lineup = playerObj.lineup || {};
  // Primeiro tenta vaga exata da posição do jogador
  let free = slots.find(s => !playerObj.lineup[s.id] && s.pos === novoJogador.posicao);
  // Se não houver vaga exata, tenta vaga compatível (improviso)
  if (!free) {
   free = slots.find(s => !playerObj.lineup[s.id] && isCompatible(s.pos, novoJogador.posicao));
  }
  if (free) playerObj.lineup[free.id] = novoJogador;
 }

 function pickNextPlayerInOrder() {
  const all = playersList().filter(j => !state.used.includes(j.nome));
  if (!all.length) return null;

  if (typeof state.cycleIndex !== "number") state.cycleIndex = 0;

  for (let attempts = 0; attempts < ordemPosicoesCiclo.length; attempts++) {
   const step = ordemPosicoesCiclo[state.cycleIndex % ordemPosicoesCiclo.length];
   state.cycleIndex = (state.cycleIndex + 1) % ordemPosicoesCiclo.length;

   const candidates = all.filter(j => step.posicoes.includes(j.posicao));
   if (candidates.length > 0) {
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return { player: chosen, cycleLabel: step.label };
   }
  }

  const fallback = all[Math.floor(Math.random() * all.length)];
  return { player: fallback, cycleLabel: fallback.posicao };
 }

 function nextPlayer() {
  if (!host || ended) return;
  if (state.paused) return;

  if (state.auction?.highestBidder) {
   const vencedor = state.players[state.auction.highestBidder];
   const j = state.auction.player;
   if (vencedor) {
    vencedor.budget -= state.auction.highestBid;
    const comprado = { ...j, valor: state.auction.highestBid };
    vencedor.roster.push(comprado);
    autoPlace(vencedor, comprado);
    state.history.push(`${vencedor.name} contratou ${j.nome} por ${fmt(state.auction.highestBid)}`);

    // Verifica se todos completaram 11 titulares logo após a contratação
    if (checkAllTeamsComplete()) return;
   }
  } else if (state.auction) {
   state.history.push(`Ninguém comprou ${state.auction.player.nome} (passou em branco)`);
  }

  const nextPick = pickNextPlayerInOrder();
  if (!nextPick) { finishAuction(); return; }

  state.used.push(nextPick.player.nome);
  state.auction = { player: nextPick.player, cycleLabel: nextPick.cycleLabel, highestBid: 0, highestBidder: null };
  state.seconds = 10;
  publish();
  msg(`Novo ${nextPick.cycleLabel} em leilão! Tempo: 10s`);

  clearInterval(timerId);
  timerId = setInterval(() => {
   if (!host || ended) return;
   if (state.paused) return;
   state.seconds--;
   publish();
   if (state.seconds <= 0) {
    clearInterval(timerId);
    nextPlayer();
   }
  }, 1000);
 }

 function finishAuction() {
  if (ended) return;
  clearInterval(timerId);
  ended = true;
  state.finished = true;
  state.paused = false;
  state.auction = null;
  state.tournament = computeTournament();

  broadcast({ type: "finishTournament", tournament: state.tournament, state });
  publish();
  iniciarTransmissaoAoVivo();
  msg("Leilão encerrado! Iniciando transmissão ao vivo do mata-mata.");
 }

 function startAuction() {
  if (!host) return;
  state.used = [];
  state.cycleIndex = 0;
  state.history = ["Leilão iniciado! Quando todos fecharem 11 titulares, o torneio começa automaticamente."];
  state.finished = false;
  state.paused = false;
  state.started = true;
  ended = false;
  simFinishedLocal = false;
  nextPlayer();
 }
});

// ===== V17: INTERACTIVE DECISIONS DURING SIMULATION =====
let decisionModal = null;
function showDecisionModal(options, onChoose) {
  if (decisionModal) decisionModal.remove();
  decisionModal = document.createElement("div");
  decisionModal.className = "modal ativo";
  decisionModal.style.zIndex = "100";
  decisionModal.innerHTML = `
    <div class="modal-conteudo" style="max-width:420px;text-align:center;">
      <h2 style="color:#27aaff;margin-bottom:12px;">Decisão na jogada!</h2>
      <p style="color:#b8cce0;margin-bottom:16px;">Escolha sua ação (resultado depende de atributos + sorte):</p>
      <div id="decisionOptions" style="display:grid;gap:10px;"></div>
    </div>`;
  document.body.appendChild(decisionModal);
  const cont = decisionModal.querySelector("#decisionOptions");
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt.label;
    btn.style.width = "100%";
    btn.onclick = () => {
      decisionModal.remove();
      decisionModal = null;
      onChoose(opt);
    };
    cont.appendChild(btn);
  });
}

function resolveAction(playerOvr, action, opponentOvr = 75) {
  const base = playerOvr / 100;
  const opp = opponentOvr / 100;
  const luck = Math.random() * 0.3 - 0.15;
  let chance = 0.5;
  if (action === "chutar") chance = 0.35 + base * 0.4 - opp * 0.2 + luck;
  else if (action === "passar") chance = 0.6 + base * 0.25 - opp * 0.1 + luck;
  else if (action === "driblar") chance = 0.45 + base * 0.3 - opp * 0.25 + luck;
  else if (action === "cruzar") chance = 0.4 + base * 0.2 + luck;
  else if (action === "desarmar") chance = 0.5 + base * 0.2 - opp * 0.15 + luck;
  else if (action === "bloquear") chance = 0.45 + base * 0.25 + luck;
  return Math.max(0.1, Math.min(0.9, chance));
}

// Hook into live feed for human players (simplified: occasionally during goals involving local player)
const originalProcessStep = window.processStep;
// Note: processStep is local inside iniciarTransmissaoAoVivo; for demo we expose a global trigger
window.__lfV17Decision = function(context, callback) {
  const me = typeof myPlayer === "function" ? myPlayer() : null;
  if (!me || me.isBot) { callback(null); return; }
  const options = context === "attack" ? [
    { label: "⚽ Chutar para o gol", action: "chutar" },
    { label: "🎯 Tocar para companheiro", action: "passar" },
    { label: "🌀 Driblar", action: "driblar" },
    { label: "↗️ Cruzar", action: "cruzar" }
  ] : [
    { label: "🛡️ Desarmar", action: "desarmar" },
    { label: "🚫 Bloquear chute", action: "bloquear" },
    { label: "👁️ Marcar", action: "marcar" }
  ];
  showDecisionModal(options, chosen => {
    const success = Math.random() < resolveAction(me.forca || 80, chosen.action);
    callback({ ...chosen, success });
  });
};

console.log("V17 interactive decision system loaded.");
