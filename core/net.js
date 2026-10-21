/* Networking — PeerJS (WebRTC). The host's browser and the guests connect directly, without a server.
   Host: hostRoom() → room code (or hostRoom(code) to reopen a saved room). Guest: joinRoom(code).
   Guests reconnect automatically after a drop and keep waiting while the host reopens the room. */
import { LS, stickyToast, toast, steadySleep } from "./ui.js";
import { L, tx } from "./i18n.js";

const PREFIX = "bg-kr-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const net = {
  peer: null, role: null, code: null, hostConn: null, joined: false,
  /* filled in by app.js */
  on: { hostReady() { }, connection() { }, message() { }, hostLost() { }, entryError() { }, busy() { } }
};

/* Identity: one token per browser tab. A reload keeps it (sessionStorage), a new tab or another browser is a new person.
   (A browser-wide token made several tabs — or one phone opening the link twice — look like the same player.)
   People who come back from another browser are matched by name on the host. */
export const token = (() => {
  try {
    let t = sessionStorage.getItem("bg.tab");
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("bg.tab", t); }
    return t;
  } catch (e) { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
})();

/* The last room this device was in, for the "rejoin" card on the home screen */
const ROOM_TTL = 12 * 3600 * 1000;
export function rememberRoom(code, role) { LS.put("last", { code, role, at: Date.now() }); }
export function lastRoom() {
  const r = LS.json("last", null);
  return r && r.code && Date.now() - r.at < ROOM_TTL ? r : null;
}
export function forgetRoom() { LS.set("last", ""); }
/* This tab is the one that was hosting `code` (survives a reload, not a new tab) */
export function hostingHere(code) { try { return sessionStorage.getItem("bg.hosting") === code; } catch (e) { return false; } }

function makeCode() { let s = ""; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
export const shareLink = code => location.href.split("#")[0] + "#" + code;
export function peerOK() {
  if (typeof window.Peer === "function") return true;
  net.on.entryError(tx("연결 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.", "Couldn't load the connection module. Check your internet connection and reload."));
  return false;
}

/* reopen: the code of a saved room. Its id may still be held by the signalling server for a minute after the old page
   closed, so keep retrying instead of picking a new code. */
export function hostRoom(reopen, tries = 0) {
  if (!peerOK()) return;
  net.on.busy(true);
  const code = reopen || makeCode();
  const peer = new Peer(PREFIX + code, { debug: 0 });
  peer.on("open", () => {
    net.peer = peer; net.role = "host"; net.code = code;
    history.replaceState(null, "", "#" + code);
    stickyToast(null);
    rememberRoom(code, "host");
    try { sessionStorage.setItem("bg.hosting", code); } catch (e) { }
    net.on.busy(false);
    net.on.hostReady(code, !!reopen);
  });
  peer.on("connection", conn => net.on.connection(conn));
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    if (err.type === "unavailable-id") {
      peer.destroy();
      if (!reopen) return hostRoom(null);
      if (tries >= 45) {
        stickyToast(null); net.on.busy(false);
        net.on.entryError(tx(`방 ${code} 을(를) 다시 열지 못했습니다. 다른 창에서 이미 열려 있을 수 있습니다.`, `Couldn't reopen room ${code}. It may already be open in another window.`));
        return;
      }
      stickyToast(L(`방 ${code} 을(를) 다시 여는 중… (최대 2분)`, `Reopening room ${code}… (up to 2 min)`));
      setTimeout(() => hostRoom(reopen, tries + 1), 3000);
      return;
    }
    if (net.role === "host") { toast(L("연결 서버와 잠시 끊겼습니다. 이미 들어온 사람과의 게임은 계속됩니다.", "Lost the signalling server for a moment. Games with people already in the room continue.")); return; }
    net.on.busy(false); net.on.entryError(tx("방을 만들지 못했습니다: " + (err.type || err.message), "Couldn't create the room: " + (err.type || err.message)));
  });
}

/* quiet: a silent reconnection attempt after a drop.
   onMissing: called instead of showing an error when nobody is hosting the room (used to reopen my own saved room). */
export function joinRoom(code, quiet, name, onMissing) {
  if (!peerOK()) return;
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 5) { net.on.entryError(tx("방 코드는 다섯 글자입니다.", "Room codes have five characters.")); return; }
  if (!quiet) net.on.busy(true);
  if (name) net.name = name;
  const peer = new Peer(undefined, { debug: 0 });
  let opened = false, failed = false;
  const fail = (text, missing) => {
    if (opened || failed) return;
    failed = true;
    try { peer.destroy(); } catch (e) { }
    if (quiet) Rejoin.later();
    else if (missing && onMissing) { net.peer = null; net.role = null; net.hostConn = null; onMissing(); }
    else { net.on.busy(false); net.on.entryError(text); }
  };
  peer.on("open", () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    if (net.peer && net.peer !== peer) try { net.peer.destroy(); } catch (e) { }
    net.peer = peer; net.role = "guest"; net.code = code; net.hostConn = conn;
    setTimeout(() => fail(tx("방에 연결하지 못했습니다. 방장이 방을 열어 두었는지, 코드가 맞는지 확인하세요.", "Couldn't connect to the room. Check the code and that the host still has the room open."), true), quiet ? 8000 : 15000);
    conn.on("open", () => {
      if (failed) return;
      opened = true; net.joined = true; net.seen = Date.now();
      Rejoin.done();
      net.on.busy(false);
      history.replaceState(null, "", "#" + code);
      rememberRoom(code, "guest");
      conn.send({ t: "hello", name: net.name, token });
    });
    conn.on("data", msg => {
      if (net.hostConn !== conn) return;
      net.seen = Date.now();
      if (msg && msg.t === "pong") return;
      if (msg && msg.t === "hostgone") return Rejoin.start();     // the host's page is reloading or closing
      net.on.message(msg);
    });
    conn.on("close", () => { if (opened && net.hostConn === conn) Rejoin.start(); });
  });
  peer.on("disconnected", () => { if (opened) try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    if (err.type === "peer-unavailable") return fail(tx(`${code} 방을 찾지 못했습니다. 코드를 확인하거나, 방장이 방을 열어 두었는지 확인하세요.`, `Room ${code} not found. Check the code, or make sure the host still has the room open.`), true);
    if (opened) return;
    fail(tx("연결 오류: " + (err.type || err.message), "Connection error: " + (err.type || err.message)));
  });
}

/* Guest auto-reconnect. Quick tries first (a phone that switched apps), then a slow phase that keeps waiting while the
   host reopens the room (their page may have reloaded), for up to 10 minutes. */
export const Rejoin = {
  active: false, tries: 0, timer: 0, since: 0,
  QUICK: [300, 1000, 2000, 3000, 5000, 5000],
  SLOW: 8000, LIMIT: 10 * 60 * 1000,
  start() {
    if (net.role !== "guest" || this.active) return;
    this.active = true; this.tries = 0; this.since = Date.now();
    net.hostConn = null;
    try { if (net.peer) net.peer.destroy(); } catch (e) { }
    this.later();
  },
  later() {
    if (!this.active) return;
    clearTimeout(this.timer);
    if (Date.now() - this.since > this.LIMIT) { this.active = false; stickyToast(null); net.on.hostLost(); return; }
    const quick = this.tries < this.QUICK.length;
    stickyToast(quick
      ? L(`연결이 끊겨 다시 연결하는 중…${this.tries ? ` (${this.tries + 1}번째)` : ""}`, `Connection lost — reconnecting…${this.tries ? ` (try ${this.tries + 1})` : ""}`)
      : L("방장을 기다리는 중… 방장이 방을 다시 열면 자동으로 이어집니다", "Waiting for the host… you'll rejoin automatically when the room reopens"));
    this.timer = setTimeout(() => { this.tries++; joinRoom(net.code, true); }, quick ? this.QUICK[this.tries] : this.SLOW);
  },
  now() {
    if (!this.active) return this.start();
    clearTimeout(this.timer);
    joinRoom(net.code, true);
  },
  done() {
    if (this.active) toast(L("다시 연결되었습니다", "Reconnected"));
    this.active = false; this.tries = 0; clearTimeout(this.timer); stickyToast(null);
  },
  stop() { this.active = false; clearTimeout(this.timer); stickyToast(null); }
};

export function sendConn(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { } }
export function sendToHost(msg) { if (net.hostConn && net.hostConn.open) net.hostConn.send(msg); }

/* bye: tell the host this was on purpose (frees the lobby seat at once instead of waiting for a timeout) */
export function leaveNet(bye) {
  Rejoin.stop();
  const peer = net.peer;
  if (bye && net.role === "guest") sendToHost({ t: "bye" });
  setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) { } }, bye ? 250 : 0);
  try { sessionStorage.removeItem("bg.hosting"); } catch (e) { }
  net.peer = null; net.role = null; net.hostConn = null; net.joined = false; net.code = null;
  history.replaceState(null, "", location.pathname + location.search);
}

/* Heartbeat: guests ping the host every few seconds (the host drops silent guests), and reconnect when the host has
   been silent too long. Pages also say goodbye when they close or reload, so nobody waits for WebRTC to notice. */
(async () => {
  for (;;) {
    await steadySleep(3000);
    if (net.role !== "guest" || !net.joined || Rejoin.active) continue;
    sendToHost({ t: "ping" });
    if (Date.now() - (net.seen || 0) > 15000) Rejoin.start();
  }
})();
window.addEventListener("pagehide", () => {
  if (net.role === "guest") sendToHost({ t: "gone" });
  else if (net.role === "host" && net.peer) for (const c of Object.values(net.peer.connections || {}).flat()) sendConn(c, { t: "hostgone" });
});

/* Keep the screen awake in the lobby and during games — if the host's phone locks, the game pauses */
export const Awake = {
  lock: null, want: false,
  async set(on) {
    this.want = on;
    try {
      if (on && !this.lock && navigator.wakeLock && document.visibilityState === "visible") {
        this.lock = await navigator.wakeLock.request("screen");
        this.lock.addEventListener("release", () => { this.lock = null; });
      } else if (!on && this.lock) { await this.lock.release(); this.lock = null; }
    } catch (e) { this.lock = null; }
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Awake.want) Awake.set(true);
  if (net.role === "guest" && net.joined && !(net.hostConn && net.hostConn.open)) Rejoin.now();
  if (net.role === "host" && net.peer && net.peer.disconnected) try { net.peer.reconnect(); } catch (e) { }
});
