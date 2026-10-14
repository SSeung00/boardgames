/* 연결 — PeerJS(WebRTC). 서버 없이 방장 브라우저와 참가자들이 직접 연결된다.
   방장: hostRoom() → 방 코드. 참가자: joinRoom(code). 참가자는 끊기면 자동으로 다시 붙는다(같은 token → 자리 복귀). */
import { LS, stickyToast, toast } from "./ui.js";

const PREFIX = "bg-kr-v1-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const net = {
  peer: null, role: null, code: null, hostConn: null, joined: false,
  /* app.js 가 채운다 */
  on: { hostReady() { }, connection() { }, message() { }, hostLost() { }, entryError() { }, busy() { } }
};

export let token = LS.get("token");
if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); LS.set("token", token); }

function makeCode() { let s = ""; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
export const shareLink = code => location.href.split("#")[0] + "#" + code;
export function peerOK() {
  if (typeof window.Peer === "function") return true;
  net.on.entryError("연결 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.");
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
    if (net.role === "host") { toast("연결 서버와 잠시 끊겼습니다. 이미 들어온 사람과의 게임은 계속됩니다."); return; }
    net.on.busy(false); net.on.entryError("방을 만들지 못했습니다: " + (err.type || err.message));
  });
}

/* quiet: 게임 중 끊겨서 조용히 다시 붙는 시도 */
export function joinRoom(code, quiet, name) {
  if (!peerOK()) return;
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 5) { net.on.entryError("방 코드는 다섯 글자입니다."); return; }
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
    setTimeout(() => fail("방에 연결하지 못했습니다. 방장이 방을 열어 두었는지, 코드가 맞는지 확인하세요."), quiet ? 8000 : 15000);
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
    if (err.type === "peer-unavailable") return fail(`${code} 방을 찾지 못했습니다. 코드를 확인하거나, 방장이 방을 열어 두었는지 확인하세요.`);
    if (opened) return;
    fail("연결 오류: " + (err.type || err.message));
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
    stickyToast(`연결이 끊겨 다시 연결하는 중…${this.tries ? ` (${this.tries + 1}번째)` : ""}`);
    this.timer = setTimeout(() => { this.tries++; joinRoom(net.code, true); }, this.WAIT[this.tries]);
  },
  now() {
    if (!this.active) return this.start();
    clearTimeout(this.timer);
    joinRoom(net.code, true);
  },
  done() {
    if (this.active) toast("다시 연결되었습니다");
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

/* 화면 꺼짐 방지 — 방장 폰이 잠기면 게임이 멈추므로 대기실 · 게임 화면에서는 켜 둔다 */
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
