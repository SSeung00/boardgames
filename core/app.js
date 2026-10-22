/* App shell — home, lobby, game screen, results. Each game draws its own area via games/<id>/ui.js. */
import { GAMES, gameById } from "../games/registry.js";
import { Room, cleanName, aiName, savedRoom, forgetSavedRoom } from "./host.js";
import { net, token, hostRoom, joinRoom, Rejoin, sendConn, sendToHost, leaveNet, shareLink, Awake, lastRoom, forgetRoom, hostingHere, netLog } from "./net.js";
import {
  $, el, esc, prefs, savePrefs, sound, buzz, toast, modal, closeAllModals, head, buttonRow, choose, avatarHTML, avatarColor, setLooks, cleanLook
} from "./ui.js";
import { L, loc, lang, toggleLang, onLang } from "./i18n.js";
import { applyLook, openSettings, openProfile } from "./settings.js";
import {
  drawQR, shareInvite, shareLabel, inviteModal, emotePicker, showEmote, tallyHTML, confetti, recordGame, statsModal, installState, install, onInstallChange
} from "./social.js";

let room = null;              // only when I am the host (or playing solo)
let lobbyMsg = null;          // last lobby message, for re-rendering
let game = null;              // {id, run, ui, last, loading, mod}
let lastAskId = 0, overShown = 0, timerT = 0;
const logLines = [];          // raw (bilingual) texts; resolved when shown

/* ===================== Screens ===================== */
function show(name) {
  for (const s of ["home", "lobby", "game"]) $(s).hidden = s !== name;
  Awake.set(name !== "home");
  document.body.dataset.screen = name;
}
let entryErr = null;
function entryError(text) { entryErr = text || null; $("homeErr").textContent = loc(entryErr); }
function setBusy(on) { for (const id of ["bCreate", "bJoin", "bSolo"]) $(id).disabled = on; if (on) entryError(""); }
function needName() {
  const v = $("inName").value.trim();
  if (!v) { entryError({ ko: "다른 사람에게 보일 이름을 적어 주세요.", en: "Enter the name others will see." }); $("inName").focus(); return false; }
  prefs.name = cleanName(v); savePrefs(); net.name = prefs.name;
  return true;
}

/* Static texts in index.html carry data-ko / data-en (and data-ko-ph / data-en-ph for placeholders). */
function applyStatic() {
  document.documentElement.lang = lang;
  for (const e of document.querySelectorAll("[data-ko]")) e.textContent = L(e.dataset.ko, e.dataset.en);
  for (const e of document.querySelectorAll("[data-ko-ph]")) e.placeholder = L(e.dataset.koPh, e.dataset.enPh);
  for (const e of document.querySelectorAll("[data-ko-label]")) e.setAttribute("aria-label", L(e.dataset.koLabel, e.dataset.enLabel));
  for (const b of document.querySelectorAll(".langbtn")) b.textContent = lang === "ko" ? "🌐 EN" : "🌐 한";
  document.title = L("보드게임 놀이방", "Game Room");
  if (entryErr) $("homeErr").textContent = loc(entryErr);
}

/* ===================== Message delivery ===================== */
function deliver(pl, msg) {
  if (pl.local) Promise.resolve().then(() => onMessage(msg));    // my own screen: immediately
  else sendConn(pl.conn, msg);
}
function toHost(msg) {
  if (room) room.receive(0, msg);
  else sendToHost(msg);
}

net.on.hostReady = (code, reopen) => {
  const saved = reopen ? savedRoom(code) : null;
  room = new Room({ name: prefs.name, look: prefs.look, token, code, deliver, saved });
  if (!saved) room.lobby();
  else toast(L("방을 다시 열었습니다 — 친구들이 곧 자동으로 다시 들어옵니다", "Room reopened — your friends will reconnect automatically"));
};
net.on.connection = conn => {
  conn.on("data", msg => { if (room) room.onData(conn, msg); });
  conn.on("close", () => room && room.onClose(conn));
};
net.on.message = msg => onMessage(msg);
net.on.entryError = entryError;
net.on.busy = setBusy;
net.on.hostLost = () => {
  closeAllModals();
  modal((box, close) => {
    head(box, L("연결 끊김", "Disconnected"), L("방장과의 연결이 끊겼습니다", "Lost connection to the host"),
      L("여러 번 다시 연결해 봤지만 방장을 찾지 못했습니다. 방장의 화면이 꺼졌거나 다른 앱으로 넘어갔을 수 있습니다.",
        "Several reconnection attempts failed. The host's screen may be off or they may have switched apps."));
    buttonRow(box, [{ label: L("처음으로", "Home"), on: () => { close(); leaveRoom(); } },
                    { label: L("다시 시도", "Try again"), primary: true, on: () => { close(); Rejoin.start(); } }]);
  }, { dismissible: false });
};

function onMessage(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === "lobby") return showLobby(msg);
  if (msg.t === "state") return onState(msg);
  if (msg.t === "error") { if (!msg.stale) { toast(loc(msg.text)); sound.bad(); } return; }
  if (msg.t === "reject") { entryError(msg.text); leaveNet(); forgetRoom(); setBusy(false); show("home"); renderResume(); return; }
  if (msg.t === "wait") return showWait(msg);
  if (msg.t === "emote") return showEmote(msg);
  if (msg.t === "closed") {
    leaveRoom();
    forgetRoom();
    renderResume();
    modal((box, close) => {
      head(box, "", L("방장이 방을 닫았습니다", "The host closed the room"), L("함께해 주셔서 고마워요!", "Thanks for playing!"));
      buttonRow(box, [{ label: L("확인", "OK"), primary: true, on: () => close() }]);
    });
  }
}

/* Leaving. Guests tell the host (bye). The host only ends the room via closeRoom(); simply closing the page keeps it
   saved so it can be reopened from the same link. */
function leaveRoom(bye) {
  closeAllModals();
  if (room) room.stop();
  room = null; lobbyMsg = null;
  unmountGame();
  if (bye) forgetRoom();
  leaveNet(bye);
  show("home");
  renderResume();
}
function closeRoom() {
  if (room) room.close();
  forgetRoom();
  setTimeout(() => leaveRoom(false), 300);
}
/* My own saved room. A reload of the hosting tab reopens it at once; from anywhere else, first try to join (it may still be
   open in another tab of this browser) and reopen it here only if nobody is hosting it. */
function reopenRoom(code) {
  if (hostingHere(code)) return hostRoom(code);
  joinRoom(code, false, prefs.name, () => hostRoom(code));
}
function confirmClose() {
  modal((box, close) => {
    head(box, "", L("방을 닫을까요?", "Close the room?"),
      L("모두의 게임이 끝나고 방이 사라집니다. 창을 그냥 닫으면 방은 남아 있어서 같은 링크로 다시 열 수 있습니다.",
        "Everyone's game ends and the room is gone. If you just close this page instead, the room is kept and can be reopened from the same link."));
    buttonRow(box, [{ label: L("취소", "Cancel"), on: () => close() },
                    { label: L("방 닫기", "Close room"), danger: true, on: () => { close(); closeRoom(); } }]);
  });
}

/* ===================== Home ===================== */
const playersLabel = E => L(`${E.players.min}~${E.players.max}인`, `${E.players.min}–${E.players.max} players`);
function renderHomeGames() {
  const box = $("homeGames");
  box.innerHTML = "";
  for (const g of GAMES) {
    const E = g.engine;
    const b = el("button", "gtile", `<span class="gicon">${E.icon}</span><b>${esc(loc(E.name))}</b><small>${playersLabel(E)}</small>`);
    b.onclick = () => showRules(E);
    box.appendChild(b);
  }
}
/* "Rejoin" card: my saved room (host) or the last room I joined (guest) */
function renderResume() {
  const box = $("homeResume");
  if (!box) return;
  box.innerHTML = "";
  if (net.role) return;
  const saved = savedRoom(), last = lastRoom();
  let card = null;
  if (saved) {
    const g = saved.game && gameById(saved.game.id);
    const what = g ? L(`${loc(g.engine.name)} 진행 중`, `${loc(g.engine.name)} in progress`) : L("대기실", "lobby");
    card = { title: L(`방 ${saved.code} 다시 열기`, `Reopen room ${saved.code}`), sub: L(`내가 만든 방 · ${what}`, `My room · ${what}`),
      go: () => { if (needName()) reopenRoom(saved.code); }, forget: () => { forgetSavedRoom(); forgetRoom(); renderResume(); } };
  } else if (last && last.role === "guest") {
    card = { title: L(`방 ${last.code} 다시 들어가기`, `Rejoin room ${last.code}`), sub: L("마지막으로 들어갔던 방", "The last room you joined"),
      go: () => { if (needName()) joinRoom(last.code, false, prefs.name); }, forget: () => { forgetRoom(); renderResume(); } };
  }
  if (!card) return;
  const c = el("div", "resume", `<button class="resume-go"><b>↩ ${esc(card.title)}</b><small>${esc(card.sub)}</small></button>` +
    `<button class="resume-x" aria-label="${L("지우기", "Dismiss")}">✕</button>`);
  c.querySelector(".resume-go").onclick = card.go;
  c.querySelector(".resume-x").onclick = card.forget;
  box.appendChild(c);
}
/* My avatar next to the name field, and the install link */
function renderHomeMe() {
  $("bLook").innerHTML = avatarHTML($("inName").value.trim() || "?", 0, "lg", cleanLook(prefs.look)) + `<i>✏️</i>`;
  const st = installState();
  $("bInstall").hidden = !(st === "ready" || st === "ios");
}
/* Edit my name and avatar. In a room, the host updates everyone's screen. */
function editProfile(roomName, seat) {
  openProfile((name, look) => {
    net.name = name;
    $("inName").value = name;
    renderHomeMe();
    if (net.role && (lobbyMsg || game)) toHost({ t: "profile", name, look });
  }, { name: roomName !== undefined ? roomName : $("inName").value.trim(), seat });
}
function showRules(E) {
  modal((box, close) => {
    head(box, playersLabel(E), `${E.icon} ${esc(loc(E.name))}`, esc(loc(E.blurb)));
    box.appendChild(el("div", "rules", loc(E.rules)));
    buttonRow(box, [{ label: L("닫기", "Close"), primary: true, on: () => close() }]);
  });
}

$("bCreate").onclick = () => { if (needName()) hostRoom(); };
/* Connection log, to see (or send) why joining failed */
$("bNetLog").onclick = () => modal((box, close) => {
  const text = netLog().join("\n");
  head(box, L("연결 기록", "Connection log"), L("최근 연결 시도", "Recent connection attempts"),
    L("들어가기가 안 될 때 이 내용을 복사해서 보내 주면 원인을 찾을 수 있습니다.", "If joining fails, copy this and send it so the cause can be found."));
  box.appendChild(el("pre", "netlog", esc(text || L("기록이 없습니다", "Nothing yet"))));
  buttonRow(box, [{ label: L("닫기", "Close"), on: () => close() },
                  { label: L("복사", "Copy"), primary: true, on: async () => {
                    try { await navigator.clipboard.writeText(text); toast(L("복사했습니다", "Copied")); }
                    catch (e) { prompt(L("이 내용을 복사하세요", "Copy this"), text); } } }]);
});
$("bSolo").onclick = () => {
  if (!needName()) return;
  net.role = "local";
  room = new Room({ name: prefs.name, look: prefs.look, token, code: null, deliver });
  room.lobby();
};
$("bLook").onclick = () => editProfile();
$("bSideOk").onclick = () => document.body.classList.add("side-ok");
$("inName").addEventListener("input", renderHomeMe);
$("bSettings").onclick = () => openSettings();
$("bStats").onclick = () => statsModal(GAMES);
$("bInstall").onclick = () => install();
onInstallChange(renderHomeMe);
$("bJoin").onclick = () => { if (needName()) joinRoom($("inCode").value, false, prefs.name); };
$("inCode").addEventListener("keydown", e => { if (e.key === "Enter") $("bJoin").click(); });

/* ===================== Lobby ===================== */
function segField(parent, label, values, current, onPick, fmt, disabled, note) {
  const f = el("div", "field");
  f.appendChild(el("span", "", esc(label)));
  const seg = el("div", "seg");
  for (const v of values) {
    const b = el("button", "", esc(fmt ? fmt(v) : v));
    b.setAttribute("aria-pressed", String(v === current));
    b.disabled = !!disabled;
    b.onclick = () => onPick(v);
    seg.appendChild(b);
  }
  f.appendChild(seg);
  if (note) f.appendChild(el("small", "note", esc(note)));
  parent.appendChild(f);
}

/* Names already shown in this room's lobby — newcomers get a short "just arrived" animation */
let lobbySeen = { code: null, names: new Set() };

function showLobby(msg) {
  lobbyMsg = msg; waitMsg = null;
  closeAllModals();
  unmountGame();
  show("lobby");
  setLooks(msg.players);
  const sh = $("lobbySheet"), isHost = msg.you === 0, st = msg.settings, local = !msg.code;
  const E = gameById(st.game).engine;
  const me = msg.players[msg.you] || { name: prefs.name };
  sh.innerHTML = "";
  sh.appendChild(topButtons(!local));
  if (local) {
    sh.insertAdjacentHTML("beforeend", `<div class="eyebrow">${L("혼자 하기", "Solo")}</div><h2>${L("AI 와 한 판", "Play against AI")}</h2>` +
      `<p>${L("게임을 고르고 시작하세요. 빈자리는 모두 AI 가 앉습니다.", "Pick a game and start. AI players fill every empty seat.")}</p>`);
  } else {
    sh.insertAdjacentHTML("beforeend", `<div class="eyebrow">${L(`대기실 · 방 ${esc(msg.code)}`, `Lobby · room ${esc(msg.code)}`)}</div>` +
      `<h2>${isHost ? L("친구를 부르세요", "Invite your friends") : L("방장을 기다리는 중", "Waiting for the host")}</h2>` +
      `<p>${isHost
        ? L("방장의 화면이 게임을 진행합니다 — <b>게임하는 동안 이 화면을 켜 둔 채로</b> 두세요.", "The host's screen runs the game — <b>keep this screen on while playing</b>.")
        : L("잠깐 다른 앱에 다녀와도 자동으로 다시 연결됩니다.", "If you switch apps for a moment, you will reconnect automatically.")}</p>`);
  }

  // Me: big card with my avatar, name and short message
  const card = el("div", "mecard", `${avatarHTML(me.name, msg.you, "xl", me.look || null)}<div class="me-t"><b>${esc(me.name)}</b>` +
    `<span class="me-tags">${isHost && !local ? `<span class="tag host">${L("방장", "Host")}</span>` : ""}<span class="tag me">${L("나", "Me")}</span></span>` +
    (me.look && me.look.m ? `<small>“${esc(me.look.m)}”</small>` : `<small class="faint">${L("이름과 얼굴을 꾸며 보세요", "Change your name and avatar")}</small>`) +
    `</div><button class="btn small me-edit">✏️ ${L("꾸미기", "Edit")}</button>`);
  card.onclick = () => editProfile(me.name, msg.you);
  sh.appendChild(card);

  if (!local) {
    // Invite: QR code (tap for a big one), the code, and the link
    const link = shareLink(msg.code);
    const inv = el("div", "invite", `<button class="qr mini" aria-label="${L("QR 크게 보기", "Show a big QR code")}"></button>` +
      `<div class="inv-mid"><small>${L("방 코드", "Room code")}</small><b>${esc(msg.code)}</b>` +
      `<span class="inv-hint">${L("QR을 누르면 크게 보여요", "Tap the QR code to enlarge")}</span></div>`);
    const q = inv.querySelector(".qr");
    drawQR(q, link);
    q.onclick = () => inviteModal(link, msg.code);
    const sb = el("button", "btn small primary inv-send", esc(shareLabel()));
    sb.onclick = () => shareInvite(link, msg.code);
    inv.querySelector(".inv-mid").appendChild(sb);
    sh.appendChild(inv);

    // Everyone else: who is here
    if (lobbySeen.code !== msg.code) lobbySeen = { code: msg.code, names: null };
    const others = msg.players.map((p, i) => ({ ...p, i })).filter(p => p.i !== msg.you);
    const humans0 = msg.players.length, ai0 = Math.max(0, (msg.seats || humans0) - humans0);
    sh.appendChild(el("div", "eyebrow mt", L(`함께하는 사람 · ${others.length}명`, `Here with you · ${others.length}`)));
    const crowd = el("div", "crowd");
    for (const p of others) {
      const isNew = lobbySeen.names && !lobbySeen.names.has(p.name);
      const sub = p.away ? `<small class="away">${L("재접속 중", "Reconnecting")}</small>`
        : p.host ? `<small class="host">👑 ${L("방장", "Host")}</small>`
        : p.look && p.look.m ? `<small>“${esc(p.look.m)}”</small>` : `<small class="in">${L("들어옴", "Joined")}</small>`;
      crowd.appendChild(el("div", "pal" + (p.away ? " away" : "") + (isNew ? " new" : ""), `${avatarHTML(p.name, p.i, "xl", p.look || null)}<b>${esc(p.name)}</b>${sub}`));
    }
    if (ai0) crowd.appendChild(el("div", "pal ghost", `<span class="av xl ghost-av"><i>🤖</i></span><b>${L(`AI ${ai0}명`, `${ai0} AI`)}</b><small>${L("빈자리", "empty seats")}</small>`));
    if (!others.length) crowd.appendChild(el("div", "crowd-empty", isHost
      ? L("아직 아무도 없어요. QR을 보여 주거나 링크를 보내 친구를 불러 보세요.", "Nobody yet. Show the QR code or send the link to invite friends.")
      : L("방장을 기다리는 중…", "Waiting for the host…")));
    sh.appendChild(crowd);
    lobbySeen.names = new Set(msg.players.map(p => p.name));
  }
  if (msg.tally && msg.tally.length) {
    sh.appendChild(el("div", "eyebrow mt", L("오늘의 점수판", "Tonight's scoreboard")));
    sh.insertAdjacentHTML("beforeend", tallyHTML(msg.tally, me.name));
    sh.appendChild(el("small", "set-note", esc(L("1등 3점 · 2등 2점 · 3등 1점, 방을 닫을 때까지 쌓입니다.", "1st 3 pts · 2nd 2 · 3rd 1, kept until the room is closed."))));
  }

  // Game picker
  sh.appendChild(el("div", "eyebrow mt", L("게임", "Game")));
  const grid = el("div", "ggrid");
  for (const g of GAMES) {
    const G = g.engine;
    const ok = msg.players.length <= G.players.max;
    const b = el("button", "gtile" + (g.id === st.game ? " on" : ""), `<span class="gicon">${G.icon}</span><b>${esc(loc(G.name))}</b><small>${playersLabel(G)}</small>`);
    b.disabled = !isHost || !ok;
    b.onclick = () => toHost({ t: "setting", key: "game", value: g.id });
    grid.appendChild(b);
  }
  sh.appendChild(grid);
  const about = el("div", "about", `<b>${E.icon} ${esc(loc(E.name))}</b> — ${esc(loc(E.blurb))} <button class="linkbtn">${L("규칙 보기", "Rules")}</button>`);
  about.querySelector("button").onclick = () => showRules(E);
  sh.appendChild(about);

  const humans = msg.players.length, seats = msg.seats || humans, ai = Math.max(0, seats - humans);
  const tooMany = humans > E.players.max;
  const seatVals = local ? [] : ["auto"];
  for (let k = Math.max(E.players.min, humans); k <= E.players.max; k++) seatVals.push(k);
  const aiNote = ai ? L(`AI ${ai}명`, `${ai} AI`) : L("AI 없음", "no AI");
  segField(sh, L("인원", "Players"), seatVals, st.seats, v => toHost({ t: "setting", key: "seats", value: v }),
    v => v === "auto" ? L("자동", "Auto") : L(v + "명", String(v)), !isHost,
    tooMany ? L(`이 게임은 최대 ${E.players.max}명입니다 — 다른 게임을 고르세요`, `This game allows at most ${E.players.max} players — pick another game`)
      : local ? L(`나 + AI ${ai}명`, `you + ${ai} AI`)
      : L(`사람 ${humans}명 + ${aiNote} = ${seats}명`, `${humans} ${humans > 1 ? "people" : "person"} + ${aiNote} = ${seats} seats`) +
        (st.seats === "auto" ? L(` · 자동: 최소 인원(${E.players.min}명)까지만 AI 로 채웁니다`, ` · Auto: AI only fills up to the minimum (${E.players.min})`) : ""));
  segField(sh, L("AI 수준", "AI level"), ["easy", "normal", "hard"], st.level, v => toHost({ t: "setting", key: "level", value: v }),
    v => ({ easy: L("쉬움", "Easy"), normal: L("보통", "Normal"), hard: L("어려움", "Hard") })[v], !isHost);
  segField(sh, L("제한 시간", "Turn timer"), [15, 30, 60, 0], st.timer, v => toHost({ t: "setting", key: "timer", value: v }),
    v => v ? L(v + "초", v + "s") : L("없음", "Off"), !isHost);
  if (!local) segField(sh, L("연결이 끊긴 사람", "If someone drops out"), ["ai", "wait"], st.away === "wait" ? "wait" : "ai",
    v => toHost({ t: "setting", key: "away", value: v }), v => v === "ai" ? L("20초 뒤 AI 가 대신", "AI after 20 s") : L("돌아올 때까지 기다리기", "Wait for them"), !isHost,
    st.away === "wait" ? L("그 사람 차례에서 게임이 멈춥니다. 방장은 언제든 「AI 에게 맡기기」를 누를 수 있습니다.", "The game pauses at their turn. The host can press \"Let AI play\" at any time.")
      : L("돌아오면 언제든 자리를 되찾습니다.", "They get their seat back whenever they return."));
  for (const s of E.settings || []) {
    segField(sh, loc(s.label), s.values, st.opts[s.key], v => toHost({ t: "setting", key: "opt." + s.key, value: v }),
      v => (s.labels ? loc(s.labels[s.values.indexOf(v)]) : v), !isHost, loc(s.note));
  }

  const row = el("div", "row split");
  const leave = el("button", "btn" + (isHost && !local ? " danger" : ""), local ? L("처음으로", "Home") : isHost ? L("방 닫기", "Close room") : L("나가기", "Leave"));
  leave.onclick = local ? () => leaveRoom(false) : isHost ? confirmClose : () => leaveRoom(true);
  row.appendChild(leave);
  if (isHost) {
    const start = el("button", "btn primary", L(`시작하기 (${seats}명)`, `Start (${seats} players)`));
    start.disabled = tooMany;
    start.onclick = () => toHost({ t: "start" });
    row.appendChild(start);
  } else row.appendChild(el("div", "waiting", `<span class="dot"></span>${L("방장이 시작하기를 기다리는 중", "Waiting for the host to start")}`));
  sh.appendChild(row);
}

/* Joined during a game: wait for the next one */
let waitMsg = null;
function showWait(msg) {
  waitMsg = msg; lobbyMsg = null;
  closeAllModals();
  unmountGame();
  show("lobby");
  const sh = $("lobbySheet"), E = gameById(msg.game).engine;
  setLooks(localPlayers(msg.players));
  sh.innerHTML = "";
  sh.appendChild(topButtons(false));
  sh.insertAdjacentHTML("beforeend", `<div class="eyebrow">${L("대기 중", "Waiting")}</div>` +
    `<h2>${L("게임 진행 중", "Game in progress")}</h2>` +
    `<p>${L(`<b>${E.icon} ${esc(loc(E.name))}</b> — 이번 판이 끝나고 방장이 다음 판을 시작하면 함께합니다. 이 화면을 켜 둔 채로 기다려 주세요.`,
            `<b>${E.icon} ${esc(loc(E.name))}</b> — you'll join when this game ends and the host starts the next one. Keep this screen open.`)}</p>`);
  const ul = el("ul", "plist");
  msg.players.forEach((p, i) => ul.appendChild(el("li", "", `${avatarHTML(p.kind === "ai" ? aiName(p.name, lang) : p.name, i)}<span class="nm">${esc(p.kind === "ai" ? aiName(p.name, lang) : p.name)}</span>` +
    (p.kind === "ai" ? '<span class="tag">AI</span>' : "") + (p.host ? `<span class="tag host">${L("방장", "Host")}</span>` : ""))));
  for (const n of msg.waiting || []) ul.appendChild(el("li", "", `${avatarHTML(n, 9)}<span class="nm">${esc(n)}</span><span class="tag me">${L("대기", "Waiting")}</span>`));
  sh.appendChild(ul);
  const row = el("div", "row split");
  const leave = el("button", "btn", L("나가기", "Leave"));
  leave.onclick = () => leaveRoom(true);
  row.appendChild(leave);
  row.appendChild(el("div", "waiting", `<span class="dot"></span>${L("다음 판을 기다리는 중", "Waiting for the next game")}`));
  sh.appendChild(row);
}

function langButton() {
  const b = el("button", "langbtn", lang === "ko" ? "🌐 EN" : "🌐 한");
  b.setAttribute("aria-label", L("언어 바꾸기", "Change language"));
  b.onclick = toggleLang;
  return b;
}
/* Top right of the lobby: language, reactions (online), settings */
function topButtons(online) {
  const box = el("div", "topbtns");
  box.appendChild(langButton());
  if (online) {
    const e = el("button", "roundbtn", "😀");
    e.setAttribute("aria-label", L("반응 보내기", "Send a reaction"));
    e.onclick = () => emotePicker(e, id => toHost({ t: "emote", e: id }));
    box.appendChild(e);
  }
  const s = el("button", "roundbtn", "⚙️");
  s.setAttribute("aria-label", L("설정", "Settings"));
  s.onclick = () => openSettings();
  box.appendChild(s);
  return box;
}

/* ===================== Game screen ===================== */
const cssLoaded = new Set();
function loadCSS(href) {
  if (!href || cssLoaded.has(href)) return;
  cssLoaded.add(href);
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}
function unmountGame() {
  if (game && game.ui && game.ui.destroy) try { game.ui.destroy(); } catch (e) { console.error(e); }
  game = null;
  $("stage").innerHTML = "";
  logLines.length = 0;
  $("ticker").textContent = "";
  $("ticker").hidden = false;
  clearInterval(timerT);
  $("timer").style.width = "0";
}

function myAsk(kind) {
  const m = game && game.last;
  if (!m) return null;
  return m.pending.find(a => a.p === m.me && (!kind || a.kind === kind)) || null;
}

function makeCtx() {
  return {
    get me() { return game && game.last ? game.last.me : 0; },
    get players() { return game && game.last ? game.last.players : []; },
    send(action) {
      const a = myAsk();
      if (!a) { toast(L("지금은 둘 차례가 아닙니다", "It's not your turn")); return false; }
      toHost({ t: "act", id: a.id, a: action });
      return true;
    },
    myAsk, sound, buzz, toast, modal, choose, el, esc, avatarHTML, avatarColor, head, buttonRow, L, loc,
    get lang() { return lang; },
    nameText: t => nameText(t, game && game.last ? game.last.players : [])
  };
}
function mountUI(g) {
  g.ui = g.mod.mount($("stage"), makeCtx());
  // A game that shows its own history hides the one-line ticker to gain height.
  $("ticker").hidden = g.ui.ticker === false;
}

async function onState(msg) {
  if (!game || game.id !== msg.game || game.run !== msg.run) {
    unmountGame();
    show("game");
    const g = gameById(msg.game);
    loadCSS(g.css);
    game = { id: msg.game, run: msg.run, ui: null, last: null, loading: null, mod: null };
    renderTitle();
    overShown = 0; lastAskId = 0;
    $("bEmote").hidden = net.role === "local";
    const cur = game;
    cur.loading = import(g.ui).then(mod => { cur.mod = mod; mountUI(cur); });
  }
  const g = game;
  await g.loading;
  if (game !== g) return;
  msg.rawPlayers = msg.players;
  msg.players = localPlayers(msg.rawPlayers);
  setLooks(msg.players);
  g.last = msg;
  for (const e of msg.ev) {
    if (!e.text) continue;
    if (e.type === "notice" || e.toast) toast(nameText(e.text, msg.players));
    pushLog(e.text, msg.players);
  }
  try { g.ui.update(msg); } catch (e) { console.error(e); }
  renderShell(msg);
}
/* AI seat names are shown in the viewer's language */
const localPlayers = list => list.map(p => (p.kind === "ai" ? { ...p, name: aiName(p.name, lang) } : p));
function renderTitle() {
  if (!game) return;
  const E = gameById(game.id).engine;
  $("gTitle").textContent = `${E.icon} ${loc(E.name)}`;
}

/* Engines don't know player names — replace {3} in event texts with seat 3's name. Accepts bilingual objects. */
export function nameText(text, players) {
  return loc(text).replace(/\{(\d+)\}/g, (_, i) => (players[+i] ? players[+i].name : "?"));
}
function pushLog(text, players) {
  logLines.push({ text, players });
  if (logLines.length > 120) logLines.shift();
  $("ticker").textContent = nameText(text, players);
}

function renderShell(m) {
  const mine = m.pending.find(a => a.p === m.me);
  const names = m.players.map(p => p.name);
  let status = m.v && m.v.status ? nameText(m.v.status, m.players) : "";
  if (!status) {
    if (m.over) status = L("게임 끝", "Game over");
    else if (mine) status = L("내 차례", "Your turn");
    else if (m.pending.length) status = L(`${names[m.pending[0].p]} 님 차례`, `${names[m.pending[0].p]}'s turn`);
  }
  const away = m.pending.find(a => a.away);
  if (away && !mine) status = L(`${names[away.p]} 님 재접속 기다리는 중…`, `Waiting for ${names[away.p]} to reconnect…`);
  $("gStatus").textContent = status;
  // "Wait for them" rooms: the host can hand a missing player's seat to the AI
  const awayBar = $("awayBar"), waiting = room && !m.over && m.settings.away === "wait" ? m.pending.filter(a => a.away) : [];
  awayBar.hidden = !waiting.length;
  awayBar.innerHTML = "";
  for (const a of waiting) {
    const row = el("div", "awayrow", `<span>${avatarHTML(names[a.p], a.p, "sm")} ${esc(L(`${names[a.p]} 님을 기다리는 중`, `Waiting for ${names[a.p]}`))}</span>`);
    const b = el("button", "btn small", L("AI 에게 맡기기", "Let AI play"));
    b.onclick = () => toHost({ t: "takeover", p: a.p });
    row.appendChild(b);
    awayBar.appendChild(row);
  }
  document.body.classList.toggle("myturn", !!mine);
  if (mine && mine.id !== lastAskId) {
    lastAskId = mine.id;
    if (!(m.v && m.v.quietAsk)) { sound.turn(); buzz(60); }
  }
  // Timer bar: my time if it's my turn, otherwise the first pending player's.
  clearInterval(timerT);
  const bar = $("timer");
  const a = mine || m.pending[0];
  if (a && a.ms > 0) {
    const end = Date.now() + a.ms, total = a.total || (m.settings.timer || 30) * 1000;
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      bar.style.width = (100 * Math.min(1, left / total)) + "%";
      bar.classList.toggle("low", left < 6000);
      bar.classList.toggle("mine", !!mine);
      if (!left) clearInterval(timerT);
    };
    tick(); timerT = setInterval(tick, 250);
  } else bar.style.width = "0";
  if (m.over && overShown !== m.seq) { overShown = m.seq; setTimeout(() => showResults(m), 900); }
}

function showResults(m) {
  if (!game || game.last !== m) return;
  const res = (m.results || []).slice().sort((a, b) => a.rank - b.rank);
  const meRank = (res.find(r => r.p === m.me) || {}).rank;
  meRank === 1 ? sound.win() : sound.lose();
  if (meRank === 1) confetti();
  recordGame(game.id, m.run, meRank, m.players.length);
  const isHost = !!room;
  const ordinal = n => (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
  modal((box, close) => {
    head(box, L("게임 끝", "Game over"),
      meRank === 1 ? L("1등입니다! 🎉", "You won! 🎉") : (meRank ? L(`${meRank}등`, `${meRank}${ordinal(meRank)} place`) : "-"), "");
    const ul = el("ul", "results");
    for (const r of res) {
      const note = r.note ? nameText(r.note, m.players) : "";
      ul.appendChild(el("li", r.p === m.me ? "me" : "", `<span class="medal r${r.rank}">${r.rank}</span>${avatarHTML(m.players[r.p].name, r.p)}` +
        `<span class="t"><b>${esc(m.players[r.p].name)}</b>${note ? `<small>${esc(note)}</small>` : ""}</span>` +
        `<span class="v">${r.score === undefined ? "" : esc(typeof r.score === "number" ? r.score.toLocaleString() : loc(r.score))}</span>`));
    }
    box.appendChild(ul);
    // After the second game of the evening, the running scoreboard too
    if (m.tally && m.tally.some(t => t.games > 1)) {
      box.appendChild(el("div", "eyebrow mt", L("오늘의 점수판", "Tonight's scoreboard")));
      box.insertAdjacentHTML("beforeend", tallyHTML(m.tally, m.players[m.me] && m.players[m.me].name));
    }
    if (isHost) buttonRow(box, [{ label: L("대기실로", "Back to lobby"), on: () => { close(); toHost({ t: "lobby" }); } },
                                { label: L("한 판 더", "Play again"), primary: true, on: () => { close(); toHost({ t: "again" }); } }]);
    else box.appendChild(el("div", "waiting", `<span class="dot"></span>${L("방장이 다음 게임을 고르는 중", "The host is choosing the next game")}`));
  });
}

/* Header buttons */
$("bRules").onclick = () => { if (game) showRules(gameById(game.id).engine); };
$("bLog").onclick = () => modal(box => {
  head(box, L("기록", "Log"), L("지난 진행", "What happened"), "");
  const ul = el("ul", "loglist");
  for (const x of logLines.slice().reverse()) ul.appendChild(el("li", "", esc(nameText(x.text, x.players))));
  box.appendChild(ul);
});
$("bEmote").onclick = () => emotePicker($("bEmote"), id => toHost({ t: "emote", e: id }));
/* Menu: invite, settings, sound, and leaving */
$("bMenu").onclick = () => {
  const isHost = !!room, online = net.role === "host" || net.role === "guest";
  modal((box, close) => {
    head(box, "", L("메뉴", "Menu"),
      isHost && net.role === "host" ? L("「방 닫기」를 누르면 모두의 게임이 끝납니다. 창을 그냥 닫으면 방은 남아 있어 같은 링크로 다시 열 수 있습니다.",
                          "\"Close room\" ends the game for everyone. If you just close this page, the room is kept and can be reopened from the same link.")
        : !isHost ? L("나가면 AI 가 대신 둡니다. 같은 링크와 같은 이름으로 다시 들어오면 자리를 되찾습니다.", "If you leave, AI plays for you. Rejoin with the same link and name to take your seat back.") : "");
    const list = el("div", "choices");
    const item = (label, on) => { const b = el("button", "choice", `<b>${label}</b>`); b.onclick = on; list.appendChild(b); };
    if (online && net.code) item(L("📨 친구 초대 (QR · 링크)", "📨 Invite friends (QR · link)"), () => { close(); inviteModal(shareLink(net.code), net.code); });
    item(L("⚙️ 설정 (테마 · 카드 · 화면 크기)", "⚙️ Settings (theme · cards · screen size)"), () => { close(); openSettings(); });
    item(prefs.sound ? L("🔇 소리 끄기", "🔇 Sound off") : L("🔊 소리 켜기", "🔊 Sound on"),
      () => { prefs.sound = !prefs.sound; savePrefs(); close(); if (prefs.sound) sound.join(); toast(prefs.sound ? L("소리 켬", "Sound on") : L("소리 끔", "Sound off")); });
    box.appendChild(list);
    const btns = [{ label: L("계속하기", "Keep playing"), on: () => close() }];
    if (isHost) btns.push({ label: L("대기실로", "Back to lobby"), on: () => { close(); toHost({ t: "lobby" }); } });
    if (isHost && net.role === "host") btns.push({ label: L("방 닫기", "Close room"), danger: true, on: () => { close(); closeRoom(); } });
    else btns.push({ label: L("나가기", "Leave"), danger: true, on: () => { close(); leaveRoom(!isHost); } });
    buttonRow(box, btns);
  });
};
for (const b of document.querySelectorAll(".langbtn")) b.onclick = toggleLang;

/* Language switch: re-render whatever is on screen. */
onLang(() => {
  applyStatic();
  renderHomeGames();
  renderHomeMe();
  if (!$("lobby").hidden && lobbyMsg) showLobby(lobbyMsg);
  else if (!$("lobby").hidden && waitMsg) showWait(waitMsg);
  renderResume();
  if (game && game.mod && game.last) {
    try { if (game.ui && game.ui.destroy) game.ui.destroy(); } catch (e) { console.error(e); }
    $("stage").innerHTML = "";
    game.last.players = localPlayers(game.last.rawPlayers || game.last.players);
    mountUI(game);
    renderTitle();
    try { game.ui.update({ ...game.last, ev: [] }); } catch (e) { console.error(e); }
    renderShell(game.last);
    const t = logLines[logLines.length - 1];
    $("ticker").textContent = t ? nameText(t.text, t.players) : "";
  }
});

document.addEventListener("pointerdown", () => sound.wake(), true);
window.addEventListener("beforeunload", e => { if (net.role === "host" && room && room.runner && !room.runner.finished) { e.preventDefault(); e.returnValue = ""; } });

// Read-only hooks for testing
window.BG = { get room() { return room; }, get game() { return game; }, get net() { return net; }, dropForTest() { try { net.hostConn.close(); } catch (e) { } } };

/* ===================== Start ===================== */
applyLook();
applyStatic();
renderHomeGames();
$("inName").value = prefs.name || "";
renderHomeMe();
net.name = prefs.name;
/* Offline copy of the site (solo play without internet) — always fetches fresh files when online, see sw.js */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
}
const hashCode = (location.hash || "").replace("#", "").toUpperCase().replace(/[^A-Z0-9]/g, "");
show("home");
renderResume();
if (hashCode.length === 5) {
  $("inCode").value = hashCode;
  if (savedRoom(hashCode) && (prefs.name || hostingHere(hashCode))) reopenRoom(hashCode);   // my own room: reopen it where it left off
  else if (prefs.name) joinRoom(hashCode, false, prefs.name);
  else { entryError({ ko: "이름을 적고 「들어가기」를 누르세요.", en: "Enter your name and press Join." }); $("inName").focus(); }
}
