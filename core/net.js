/* Networking — PeerJS (WebRTC). The host's browser and the guests connect directly, without a server.
   Host: hostRoom() → room code. Guest: joinRoom(code). Guests reconnect automatically after a drop (same token → same seat). */
import { LS, stickyToast, toast } from "./ui.js";
import { L, tx } from "./i18n.js";

const PREFIX = "bg-kr-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const net = {
  peer: null, role: null, code: null, hostConn: null, joined: false,
  /* filled in by app.js */
  on: { hostReady() { }, connection() { }, message() { }, hostLost() { }, entryError() { }, busy() { } }
};

export let token = LS.get("token");
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); LS.set("token", token); }

function makeCode() { let s = ""; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
export const shareLink = code => location.href.split("#")[0] + "#" + code;
export function peerOK() {
  if (typeof window.Peer === "function") return true;
  net.on.entryError(tx("연결 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.", "Couldn't load the connection module. Check your internet connection and reload."));
  return false;
}

export function hostRoom() {
  if (!peerOK()) return;
  net.on.busy(true);
  const code = makeCode();
  const peer = new Peer(PREFIX + code, { debug: 0 });
  peer.on("open", () => {
    net.peer = peer; net.role = "host"; net.code = code;
    history.replaceState(null, "", "#" + code);
    net.on.busy(false);
    net.on.hostReady(code);
  });
  peer.on("connection", conn => net.on.connection(conn));
  peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    if (err.type === "unavailable-id") { peer.destroy(); hostRoom(); return; }
    if (net.role === "host") { toast(L("연결 서버와 잠시 끊겼습니다. 이미 들어온 사람과의 게임은 계속됩니다.", "Lost the signalling server for a moment. Games with people already in the room continue.")); return; }
    net.on.busy(false); net.on.entryError(tx("방을 만들지 못했습니다: " + (err.type || err.message), "Couldn't create the room: " + (err.type || err.message)));
  });
}

/* quiet: a silent reconnection attempt after a drop during a game */
export function joinRoom(code, quiet, name) {
  if (!peerOK()) return;
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 5) { net.on.entryError(tx("방 코드는 다섯 글자입니다.", "Room codes have five characters.")); return; }
  if (!quiet) net.on.busy(true);
  const peer = new Peer(undefined, { debug: 0 });
  let opened = false, failed = false;
  const fail = text => {
    if (opened || failed) return;
    failed = true;
    try { peer.destroy(); } catch (e) { }
    if (quiet) Rejoin.later();
    else { net.on.busy(false); net.on.entryError(text); }
  };
  peer.on("open", () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
    if (net.peer && net.peer !== peer) try { net.peer.destroy(); } catch (e) { }
    net.peer = peer; net.role = "guest"; net.code = code; net.hostConn = conn;
    setTimeout(() => fail(tx("방에 연결하지 못했습니다. 방장이 방을 열어 두었는지, 코드가 맞는지 확인하세요.", "Couldn't connect to the room. Check the code and that the host still has the room open.")), quiet ? 8000 : 15000);
    conn.on("open", () => {
      if (failed) return;
      opened = true; net.joined = true;
      Rejoin.done();
      net.on.busy(false);
      history.replaceState(null, "", "#" + code);
      conn.send({ t: "hello", name: name || net.name, token });
    });
    conn.on("data", msg => { if (net.hostConn === conn) net.on.message(msg); });
    conn.on("close", () => { if (opened && net.hostConn === conn) Rejoin.start(); });
  });
  peer.on("disconnected", () => { if (opened) try { peer.reconnect(); } catch (e) { } });
  peer.on("error", err => {
    if (err.type === "peer-unavailable") return fail(tx(`${code} 방을 찾지 못했습니다. 코드를 확인하거나, 방장이 방을 열어 두었는지 확인하세요.`, `Room ${code} not found. Check the code, or make sure the host still has the room open.`));
    if (opened) return;
    fail(tx("연결 오류: " + (err.type || err.message), "Connection error: " + (err.type || err.message)));
  });
}

export const Rejoin = {
  active: false, tries: 0, timer: 0,
  WAIT: [300, 1000, 2000, 3000, 5000, 5000, 8000, 8000, 10000, 10000, 15000],
  start() {
    if (net.role !== "guest" || this.active) return;
    this.active = true; this.tries = 0;
    net.hostConn = null;
    try { if (net.peer) net.peer.destroy(); } catch (e) { }
    this.later();
  },
  later() {
    if (!this.active) return;
    clearTimeout(this.timer);
    if (this.tries >= this.WAIT.length) { this.active = false; stickyToast(null); net.on.hostLost(); return; }
    stickyToast(L(`연결이 끊겨 다시 연결하는 중…${this.tries ? ` (${this.tries + 1}번째)` : ""}`, `Connection lost — reconnecting…${this.tries ? ` (try ${this.tries + 1})` : ""}`));
    this.timer = setTimeout(() => { this.tries++; joinRoom(net.code, true); }, this.WAIT[this.tries]);
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

export function leaveNet() {
  Rejoin.stop();
  try { if (net.peer) net.peer.destroy(); } catch (e) { }
  net.peer = null; net.role = null; net.hostConn = null; net.joined = false; net.code = null;
  history.replaceState(null, "", location.pathname + location.search);
}

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
