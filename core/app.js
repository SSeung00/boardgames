/* 화면 껍데기 — 첫 화면 · 대기실 · 게임 화면 · 결과. 게임별 화면은 games/<id>/ui.js 가 그린다. */
import { GAMES, gameById } from "../games/registry.js";
import { Room, cleanName } from "./host.js";
import { net, token, hostRoom, joinRoom, Rejoin, sendConn, sendToHost, leaveNet, shareLink, Awake } from "./net.js";
import {
  $, el, esc, LS, prefs, savePrefs, sound, buzz, toast, modal, closeAllModals, head, buttonRow, choose, avatarHTML, avatarColor
} from "./ui.js";

let room = null;              // 방장 · 혼자 하기일 때만
let lobbyMsg = null;          // 마지막 대기실 정보
let game = null;              // {id, ui, last, root}
let lastAskId = 0, overShown = 0, timerT = 0;
const logLines = [];

/* ===================== 화면 전환 ===================== */
function show(name) {
  for (const s of ["home", "lobby", "game"]) $(s).hidden = s !== name;
  Awake.set(name !== "home");
  document.body.dataset.screen = name;
}
function entryError(text) { $("homeErr").textContent = text || ""; }
function setBusy(on) { for (const id of ["bCreate", "bJoin", "bSolo"]) $(id).disabled = on; if (on) entryError(""); }
function needName() {
  const v = $("inName").value.trim();
  if (!v) { entryError("다른 사람에게 보일 이름을 적어 주세요."); $("inName").focus(); return false; }
  prefs.name = cleanName(v); savePrefs(); net.name = prefs.name;
  return true;
}

/* ===================== 메시지 배달 ===================== */
function deliver(pl, msg) {
  if (pl.local) Promise.resolve().then(() => onMessage(msg));    // 내 화면에는 바로
  else sendConn(pl.conn, msg);
}
function toHost(msg) {
  if (room) room.receive(0, msg);
  else sendToHost(msg);
}

net.on.hostReady = code => {
  room = new Room({ name: prefs.name, token, code, deliver });
  room.lobby();
};
net.on.connection = conn => {
  conn.on("data", msg => {
    if (!room) return;
    if (msg && msg.t === "hello") return room.hello(conn, msg);
    const p = room.players.findIndex(x => x.conn === conn);
    if (p >= 0) room.receive(p, msg);
  });
  conn.on("close", () => room && room.onClose(conn));
};
net.on.message = msg => onMessage(msg);
net.on.entryError = entryError;
net.on.busy = setBusy;
net.on.hostLost = () => {
  closeAllModals();
  modal((box, close) => {
    head(box, "연결 끊김", "방장과의 연결이 끊겼습니다", "여러 번 다시 연결해 봤지만 방장을 찾지 못했습니다. 방장의 화면이 꺼졌거나 다른 앱으로 넘어갔을 수 있습니다.");
    buttonRow(box, [{ label: "처음으로", on: () => { close(); leaveRoom(); } },
                    { label: "다시 시도", primary: true, on: () => { close(); Rejoin.start(); } }]);
  }, { dismissible: false });
};

function onMessage(msg) {
  if (!msg || !msg.t) return;
  if (msg.t === "lobby") return showLobby(msg);
  if (msg.t === "state") return onState(msg);
  if (msg.t === "error") { if (!msg.stale) { toast(msg.text); sound.bad(); } return; }
  if (msg.t === "reject") { entryError(msg.text); leaveNet(); setBusy(false); show("home"); return; }
}

function leaveRoom() {
  closeAllModals();
  if (room && room.runner) room.runner.stop();
  room = null; lobbyMsg = null;
  unmountGame();
  leaveNet();
  show("home");
}

/* ===================== 첫 화면 ===================== */
function renderHomeGames() {
  const box = $("homeGames");
  box.innerHTML = "";
  for (const g of GAMES) {
    const E = g.engine;
    const b = el("button", "gtile", `<span class="gicon">${E.icon}</span><b>${esc(E.name)}</b><small>${E.players.min}~${E.players.max}인</small>`);
    b.onclick = () => showRules(E);
    box.appendChild(b);
  }
}
function showRules(E) {
  modal((box, close) => {
    head(box, `${E.players.min}~${E.players.max}인`, `${E.icon} ${esc(E.name)}`, esc(E.blurb));
    box.appendChild(el("div", "rules", E.rules || ""));
    buttonRow(box, [{ label: "닫기", primary: true, on: () => close() }]);
  });
}

$("bCreate").onclick = () => { if (needName()) hostRoom(); };
$("bSolo").onclick = () => {
  if (!needName()) return;
  net.role = "local";
  room = new Room({ name: prefs.name, token, code: null, deliver });
  room.lobby();
};
$("bJoin").onclick = () => { if (needName()) joinRoom($("inCode").value, false, prefs.name); };
$("inCode").addEventListener("keydown", e => { if (e.key === "Enter") $("bJoin").click(); });

/* ===================== 대기실 ===================== */
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
  if (note) f.appendChild(el("small", "note", note));
  parent.appendChild(f);
}

function showLobby(msg) {
  lobbyMsg = msg;
  closeAllModals();
  unmountGame();
  show("lobby");
  const sh = $("lobbySheet"), isHost = msg.you === 0, st = msg.settings, local = !msg.code;
  const E = gameById(st.game).engine;
  sh.innerHTML = "";
  if (local) {
    sh.insertAdjacentHTML("beforeend", `<div class="eyebrow">혼자 하기</div><h2>AI 와 한 판</h2><p>게임을 고르고 시작하세요. 빈자리는 모두 AI 가 앉습니다.</p>`);
  } else {
    sh.insertAdjacentHTML("beforeend", `<div class="eyebrow">대기실</div><h2>${isHost ? "친구를 부르세요" : "방장을 기다리는 중"}</h2>
      <p>${isHost ? "방장의 화면이 게임을 진행합니다 — <b>게임하는 동안 이 화면을 켜 둔 채로</b> 두세요." : "잠깐 다른 앱에 다녀와도 자동으로 다시 연결됩니다."}</p>`);
    const box = el("div", "codebox", `<div><small>방 코드</small><b>${esc(msg.code)}</b></div>`);
    const canShare = typeof navigator.share === "function" && matchMedia("(pointer:coarse)").matches;
    const b = el("button", "btn", canShare ? "초대 링크 보내기" : "초대 링크 복사");
    b.onclick = async () => {
      const link = shareLink(msg.code);
      if (canShare) {
        try { await navigator.share({ title: "보드게임 놀이방", text: `같이 해요! 방 코드 ${msg.code}`, url: link }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      try { await navigator.clipboard.writeText(link); toast("초대 링크를 복사했습니다"); }
      catch (e) { prompt("이 링크를 복사해 보내세요", link); }
    };
    box.appendChild(b);
    sh.appendChild(box);
    const ul = el("ul", "plist");
    msg.players.forEach((p, i) => ul.appendChild(el("li", "", `${avatarHTML(p.name, i)}<span class="nm">${esc(p.name)}</span>` +
      (p.host ? '<span class="tag host">방장</span>' : "") + (i === msg.you ? '<span class="tag me">나</span>' : ""))));
    sh.appendChild(ul);
  }

  // 게임 고르기
  sh.appendChild(el("div", "eyebrow mt", "게임"));
  const grid = el("div", "ggrid");
  for (const g of GAMES) {
    const G = g.engine;
    const ok = msg.players.length <= G.players.max;
    const b = el("button", "gtile" + (g.id === st.game ? " on" : ""), `<span class="gicon">${G.icon}</span><b>${esc(G.name)}</b><small>${G.players.min}~${G.players.max}인</small>`);
    b.disabled = !isHost || !ok;
    b.onclick = () => toHost({ t: "setting", key: "game", value: g.id });
    grid.appendChild(b);
  }
  sh.appendChild(grid);
  const about = el("div", "about", `<b>${E.icon} ${esc(E.name)}</b> — ${esc(E.blurb)} <button class="linkbtn">규칙 보기</button>`);
  about.querySelector("button").onclick = () => showRules(E);
  sh.appendChild(about);

  const humans = msg.players.length;
  const seatVals = []; for (let k = Math.max(E.players.min, humans); k <= E.players.max; k++) seatVals.push(k);
  segField(sh, "인원", seatVals, st.seats, v => toHost({ t: "setting", key: "seats", value: v }), v => v + "명", !isHost,
    st.seats > humans ? `AI ${st.seats - humans}명이 함께합니다` : "");
  segField(sh, "AI 수준", ["easy", "normal", "hard"], st.level, v => toHost({ t: "setting", key: "level", value: v }),
    v => ({ easy: "쉬움", normal: "보통", hard: "어려움" })[v], !isHost);
  segField(sh, "제한 시간", [15, 30, 60, 0], st.timer, v => toHost({ t: "setting", key: "timer", value: v }), v => v ? v + "초" : "없음", !isHost);
  for (const s of E.settings || []) {
    segField(sh, s.label, s.values, st.opts[s.key], v => toHost({ t: "setting", key: "opt." + s.key, value: v }),
      v => (s.labels ? s.labels[s.values.indexOf(v)] : v), !isHost, s.note);
  }

  const row = el("div", "row split");
  const leave = el("button", "btn", local ? "처음으로" : "나가기");
  leave.onclick = leaveRoom;
  row.appendChild(leave);
  if (isHost) {
    const start = el("button", "btn primary", `시작하기 (${st.seats}명)`);
    start.onclick = () => toHost({ t: "start" });
    row.appendChild(start);
  } else row.appendChild(el("div", "waiting", '<span class="dot"></span>방장이 시작하기를 기다리는 중'));
  sh.appendChild(row);
}

/* ===================== 게임 화면 ===================== */
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

async function onState(msg) {
  if (!game || game.id !== msg.game || game.run !== msg.run) {
    unmountGame();
    show("game");
    const g = gameById(msg.game);
    loadCSS(g.css);
    game = { id: msg.game, run: msg.run, ui: null, last: null, loading: null };
    $("gTitle").textContent = `${g.engine.icon} ${g.engine.name}`;
    overShown = 0; lastAskId = 0;
    game.loading = import(g.ui).then(mod => {
      const ctx = {
        get me() { return game && game.last ? game.last.me : 0; },
        get players() { return game && game.last ? game.last.players : []; },
        send(action) {
          const a = myAsk();
          if (!a) { toast("지금은 둘 차례가 아닙니다"); return false; }
          toHost({ t: "act", id: a.id, a: action });
          return true;
        },
        myAsk, sound, buzz, toast, modal, choose, el, esc, avatarHTML, avatarColor, head, buttonRow,
        nameText: t => nameText(t, game && game.last ? game.last.players : [])
      };
      game.ui = mod.mount($("stage"), ctx);
      // 게임이 직접 진행 기록을 보여 주면 위쪽 한 줄 기록은 숨겨 화면을 넓힌다
      $("ticker").hidden = game.ui.ticker === false;
    });
  }
  const g = game;
  await g.loading;
  if (game !== g) return;
  g.last = msg;
  for (const e of msg.ev) {
    if (!e.text) continue;
    const text = nameText(e.text, msg.players);
    if (e.type === "notice" || e.toast) toast(text);
    pushLog(text);
  }
  try { g.ui.update(msg); } catch (e) { console.error(e); }
  renderShell(msg);
}

/* 엔진은 이름을 모른다 — 이벤트 문장의 {3} 을 3번 자리 사람 이름으로 바꾼다 */
export function nameText(text, players) {
  return String(text).replace(/\{(\d+)\}/g, (_, i) => (players[+i] ? players[+i].name : "?"));
}
function pushLog(text) {
  logLines.push(text);
  if (logLines.length > 120) logLines.shift();
  $("ticker").textContent = text;
}

function renderShell(m) {
  const mine = m.pending.find(a => a.p === m.me);
  const names = m.players.map(p => p.name);
  let status = m.v && m.v.status ? nameText(m.v.status, m.players) : "";
  if (!status) {
    if (m.over) status = "게임 끝";
    else if (mine) status = "내 차례";
    else if (m.pending.length) status = `${names[m.pending[0].p]} 님 차례`;
  }
  $("gStatus").textContent = status;
  document.body.classList.toggle("myturn", !!mine);
  if (mine && mine.id !== lastAskId) {
    lastAskId = mine.id;
    if (!(m.v && m.v.quietAsk)) { sound.turn(); buzz(60); }
  }
  // 시간 막대: 내 차례면 내 시간, 아니면 첫 번째로 기다리는 사람의 시간
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
  const isHost = !!room;
  modal((box, close) => {
    head(box, "게임 끝", meRank === 1 ? "1등입니다! 🎉" : `${meRank || "-"}등`, "");
    const ul = el("ul", "results");
    for (const r of res) {
      ul.appendChild(el("li", r.p === m.me ? "me" : "", `<span class="medal r${r.rank}">${r.rank}</span>${avatarHTML(m.players[r.p].name, r.p)}` +
        `<span class="t"><b>${esc(m.players[r.p].name)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ""}</span><span class="v">${r.score === undefined ? "" : esc(typeof r.score === "number" ? r.score.toLocaleString() : r.score)}</span>`));
    }
    box.appendChild(ul);
    if (isHost) buttonRow(box, [{ label: "대기실로", on: () => { close(); toHost({ t: "lobby" }); } }, { label: "한 판 더", primary: true, on: () => { close(); toHost({ t: "again" }); } }]);
    else box.appendChild(el("div", "waiting", '<span class="dot"></span>방장이 다음 게임을 고르는 중'));
  });
}

/* 상단 버튼 */
$("bRules").onclick = () => { if (game) showRules(gameById(game.id).engine); };
$("bLog").onclick = () => modal(box => {
  head(box, "기록", "지난 진행", "");
  const ul = el("ul", "loglist");
  for (const t of logLines.slice().reverse()) ul.appendChild(el("li", "", esc(t)));
  box.appendChild(ul);
});
$("bSound").onclick = () => { prefs.sound = !prefs.sound; savePrefs(); renderSound(); if (prefs.sound) sound.join(); };
function renderSound() { $("bSound").setAttribute("aria-pressed", String(prefs.sound)); $("bSound").textContent = prefs.sound ? "🔊" : "🔇"; }
$("bLeave").onclick = () => {
  const isHost = !!room;
  modal((box, close) => {
    head(box, "", "나가시겠어요?", isHost && net.role === "host" ? "방장이 나가면 모두의 게임이 끝납니다." : "");
    const btns = [{ label: "계속하기", on: () => close() }];
    if (isHost) btns.push({ label: "대기실로", on: () => { close(); toHost({ t: "lobby" }); } });
    btns.push({ label: "나가기", danger: true, on: () => { close(); leaveRoom(); } });
    buttonRow(box, btns);
  });
};
document.addEventListener("pointerdown", () => sound.wake(), true);
window.addEventListener("beforeunload", e => { if (net.role === "host" && room && room.runner && !room.runner.finished) { e.preventDefault(); e.returnValue = ""; } });

// 테스트용 창구
window.BG = { get room() { return room; }, get game() { return game; }, get net() { return net; }, dropForTest() { try { net.hostConn.close(); } catch (e) { } } };

/* ===================== 시작 ===================== */
renderHomeGames();
renderSound();
$("inName").value = prefs.name || "";
net.name = prefs.name;
const hashCode = (location.hash || "").replace("#", "").toUpperCase().replace(/[^A-Z0-9]/g, "");
show("home");
if (hashCode.length === 5) {
  $("inCode").value = hashCode;
  if (prefs.name) joinRoom(hashCode, false, prefs.name);
  else { entryError("이름을 적고 「들어가기」를 누르세요."); $("inName").focus(); }
}
