/* Host side: the room (lobby, connections) and the game runner.
   The host's browser runs the rules engine and sends each person only their own view.

   Game engine contract (default export of games/<id>/engine.js) — full description in games/README.md
     setup({n, seed, settings}) → state S (plain JSON-serializable object)
     pending(S) → [{p, kind, time?, secret?}]  who must decide now (empty = automatic progress)
     validate(S, p, a) → true | error text (bilingual tx object or string)
     apply(S, p, a) → events
     step(S) → events                    when pending is empty (next round, etc.)
     delay(S) → ms                       wait before step
     timeout(S, p, kind) → action        when the time limit runs out
     ai(S, p, {level, rng}) → action
     view(S, p) → what that person may see
     filterEvent(ev, p, S) → ev | redacted copy | null   (optional)
     over(S) → bool,  results(S) → [{p, rank, score, note}]
*/
import { GAMES, gameById } from "../games/registry.js";
import { LS, toast, sound } from "./ui.js";
import { L, tx } from "./i18n.js";

/* AI seat names. The host picks the Korean name; each viewer's screen shows it in their own language (see aiName). */
export const AI_NAMES = [["다람쥐", "Squirrel"], ["너구리", "Raccoon"], ["부엉이", "Owl"], ["고양이", "Cat"], ["여우", "Fox"],
  ["판다", "Panda"], ["수달", "Otter"], ["펭귄", "Penguin"], ["고슴도치", "Hedgehog"], ["토끼", "Rabbit"]];
const AI_EN = new Map(AI_NAMES);
export const aiName = (name, lang) => (lang === "en" && AI_EN.has(name) ? AI_EN.get(name) : name);

/* The host's clock — a worker timer, so the game keeps running even when browsers throttle hidden tabs. */
export const hostSleep = (() => {
  try {
    const src = "onmessage = e => setTimeout(() => postMessage(e.data), e.data.ms);";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    const waits = new Map();
    let n = 0;
    w.onmessage = e => { const f = waits.get(e.data.id); if (f) { waits.delete(e.data.id); f(); } };
    return ms => new Promise(r => { const id = ++n; waits.set(id, r); w.postMessage({ id, ms }); });
  } catch (e) { return ms => new Promise(r => setTimeout(r, ms)); }
})();

export const cleanName = s => (String(s || "").replace(/\s+/g, " ").trim().slice(0, 10)) || L("손님", "Guest");

export class Room {
  /* deliver(player, msg): send a message to a person (app.js handles connection vs. local delivery) */
  constructor({ name, token, code, deliver }) {
    this.code = code;              // null = solo (AI only)
    this.deliver = deliver;
    this.players = [{ name: cleanName(name), token, kind: "human", local: true, online: true, conn: null }];
    const saved = LS.json("room", {});
    this.settings = Object.assign({ game: GAMES[0].id, seats: 0, level: "normal", timer: 30, opts: {} }, saved);
    if (!gameById(this.settings.game)) this.settings.game = GAMES[0].id;
    this.fixSettings();
    this.runner = null;
  }
  get engine() { return gameById(this.settings.game).engine; }
  humans() { return this.players.filter(p => p.kind === "human"); }

  fixSettings() {
    const E = this.engine, st = this.settings, h = this.humans().length;
    if (!st.seats || st.seats < E.players.min || st.seats > E.players.max) st.seats = E.players.default;
    if (st.seats < h) st.seats = Math.min(E.players.max, h);
    st.opts = st.opts || {};
    const o = {};
    for (const s of E.settings || []) o[s.key] = s.values.includes(st.opts[s.key]) ? st.opts[s.key] : s.default;
    st.opts = o;
  }

  /* ----- Connections ----- */
  hello(conn, msg) {
    const name = cleanName(msg.name);
    const back = this.players.findIndex(x => !x.local && x.kind === "human" && x.token === msg.token);
    if (back >= 0) {
      const pl = this.players[back];
      if (pl.conn && pl.conn !== conn) try { pl.conn.close(); } catch (e) { }
      pl.conn = conn; pl.online = true;
      if (this.runner) this.runner.presence(back, tx(`{${back}} 님이 다시 들어왔습니다`, `{${back}} is back`));
      else this.lobby();
      return;
    }
    const reject = text => { try { conn.send({ t: "reject", text }); } catch (e) { } setTimeout(() => { try { conn.close(); } catch (e) { } }, 600); };
    if (this.runner) return reject(tx("이미 게임이 진행 중인 방입니다. 이번 게임이 끝나면 들어올 수 있습니다.",
      "A game is already in progress in this room. You can join when it ends."));
    const max = Math.max(...GAMES.map(g => g.engine.players.max));
    if (this.players.length >= max) return reject(tx(`방이 꽉 찼습니다 (최대 ${max}명).`, `The room is full (max ${max}).`));
    this.players.push({ name, token: msg.token, kind: "human", conn, local: false, online: true });
    this.fixSettings();
    toast(L(`${name} 님이 들어왔습니다`, `${name} joined`)); sound.join();
    this.lobby();
  }
  onClose(conn) {
    const p = this.players.findIndex(x => x.conn === conn);
    if (p < 0) return;
    const pl = this.players[p];
    pl.conn = null; pl.online = false;
    if (!this.runner) {
      this.players.splice(p, 1);
      toast(L(`${pl.name} 님이 나갔습니다`, `${pl.name} left`));
      this.lobby();
      return;
    }
    this.runner.presence(p, tx(`{${p}} 님의 연결이 끊겼습니다 — 돌아올 때까지 AI 가 대신 둡니다`,
      `{${p}} disconnected — AI plays for them until they're back`));
  }
  sendTo(p, msg) {
    const pl = this.players[p];
    if (pl && pl.kind === "human") this.deliver(pl, msg);
  }
  /* A message from a person */
  receive(p, msg) {
    if (!msg || !msg.t) return;
    const isHost = this.players[p] && this.players[p].local;
    if (msg.t === "act") { if (this.runner) this.runner.receive(p, msg); return; }
    if (!isHost) return;
    if (msg.t === "setting") return this.setSetting(msg.key, msg.value);
    if (msg.t === "start") return this.start();
    if (msg.t === "again") return this.start();
    if (msg.t === "lobby") return this.backToLobby();
  }

  /* ----- Lobby ----- */
  publicPlayers() {
    return this.players.map((pl, i) => ({ name: pl.name, kind: pl.kind === "ai" ? "ai" : (pl.online ? "human" : "away"), host: i === 0 && pl.kind === "human" }));
  }
  lobby() {
    const list = this.humans().map((pl, i) => ({ name: pl.name, host: i === 0 }));
    this.humans().forEach((pl, i) => this.deliver(pl, { t: "lobby", you: i, code: this.code, players: list, settings: this.settings }));
  }
  setSetting(key, value) {
    if (this.runner) return;
    if (key === "game") { if (!gameById(value)) return; this.settings.game = value; this.settings.seats = 0; this.settings.opts = {}; }
    else if (key === "seats" || key === "level" || key === "timer") this.settings[key] = value;
    else if (key.startsWith("opt.")) this.settings.opts[key.slice(4)] = value;
    this.fixSettings();
    LS.put("room", this.settings);
    this.lobby();
  }
  start() {
    if (this.runner && !this.runner.finished) return;
    this.fixSettings();
    const E = this.engine, st = this.settings;
    const humans = this.humans().filter(p => p.local || p.online);
    if (humans.length > E.players.max) { toast(L(`이 게임은 최대 ${E.players.max}명입니다`, `This game allows at most ${E.players.max} players`)); return; }
    const n = Math.max(st.seats, humans.length, E.players.min);
    const taken = new Set(humans.map(h => h.name));
    const pool = AI_NAMES.map(x => x[0]).filter(x => !taken.has(x)).sort(() => Math.random() - .5);
    this.players = humans.slice();
    for (let i = 0; this.players.length < n; i++) this.players.push({ name: pool[i] || `AI ${i + 1}`, kind: "ai", online: true });
    if (this.runner) this.runner.stop();
    this.runner = new Runner(this, E, st);
    this.runner.run();
  }
  backToLobby() {
    if (this.runner) this.runner.stop();
    this.runner = null;
    this.players = this.players.filter(p => p.kind === "human" && (p.local || p.online));
    this.fixSettings();
    this.lobby();
  }
}

/* One game: pending → (ask the person | AI) → apply → send each person their view */
class Runner {
  constructor(room, engine, settings) {
    this.room = room; this.E = engine; this.settings = JSON.parse(JSON.stringify(settings));
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.S = engine.setup({ n: room.players.length, seed, settings: this.settings.opts });
    this.seq = 0; this.askSeq = 0; this.asks = new Map(); this.alive = true; this.finished = false;
    this.kick = null; this.outbox = [];
    this.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // lets clients redraw on "play again"
  }
  stop() { this.alive = false; for (const a of this.asks.values()) a.cancel(); this.asks.clear(); if (this.kick) this.kick({ kick: true }); }

  /* Presence changed: rebuild that person's question (human ↔ AI stand-in) */
  presence(p, text) {
    const a = this.asks.get(p);
    if (a) { a.cancel(); this.asks.delete(p); }
    this.outbox.push({ type: "notice", text });
    if (this.finished) this.broadcast();
    if (this.kick) this.kick({ kick: true });
  }

  receive(p, msg) {
    const a = this.asks.get(p);
    if (!a || !a.human || a.id !== msg.id) { this.room.sendTo(p, { t: "error", text: tx("지금은 둘 차례가 아닙니다", "It's not your turn"), stale: true }); return; }
    const bad = tx("규칙에 맞지 않는 수입니다", "That move isn't allowed");
    let ok;
    try { ok = this.E.validate(this.S, p, msg.a); } catch (e) { ok = bad; }
    if (ok !== true) { this.room.sendTo(p, { t: "error", text: ok || bad }); return; }
    a.resolve({ p, id: a.id, action: msg.a });
  }

  makeAsk(x) {
    const id = ++this.askSeq, pl = this.room.players[x.p];
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const ask = { id, p: x.p, kind: x.kind, secret: !!x.secret, promise, deadline: 0, total: 0, human: false, cancelled: false };
    ask.resolve = v => { if (!ask.cancelled) { ask.cancelled = true; resolve(v); } };
    ask.cancel = () => { ask.cancelled = true; };
    const level = this.settings.level;
    if (pl.kind === "human" && pl.online) {
      ask.human = true;
      const sec = x.time !== undefined ? x.time : this.settings.timer;
      if (sec) {
        ask.deadline = Date.now() + sec * 1000; ask.total = sec * 1000;
        hostSleep(sec * 1000).then(() => {
          if (ask.cancelled) return;
          let a;
          try { a = this.E.timeout(this.S, x.p, x.kind); } catch (e) { a = this.E.ai(this.S, x.p, { level: "easy", rng: Math.random }); }
          ask.resolve({ p: x.p, id, action: a, timeout: true });
        });
      }
    } else {
      const think = x.think !== undefined ? x.think : (this.E.thinkTime ? this.E.thinkTime(this.S, x.p, x.kind) : 700 + Math.random() * 700);
      hostSleep(think).then(() => {
        if (ask.cancelled) return;
        let a;
        try { a = this.E.ai(this.S, x.p, { level, rng: Math.random }); }
        catch (e) { console.error(e); a = this.E.timeout(this.S, x.p, x.kind); }
        ask.resolve({ p: x.p, id, action: a, ai: true });
      });
    }
    return ask;
  }

  syncAsks(pend) {
    const want = new Map(pend.map(x => [x.p, x]));
    for (const [p, a] of this.asks) if (!want.has(p) || want.get(p).kind !== a.kind) { a.cancel(); this.asks.delete(p); }
    for (const x of pend) if (!this.asks.has(x.p)) this.asks.set(x.p, this.makeAsk(x));
  }

  broadcast() {
    const evs = this.outbox; this.outbox = [];
    this.seq++;
    const over = this.E.over(this.S);
    const results = over ? this.E.results(this.S) : null;
    const asks = [...this.asks.values()].map(a => ({ p: a.p, kind: a.kind, id: a.id, secret: a.secret, total: a.total, ms: a.deadline ? Math.max(0, a.deadline - Date.now()) : 0 }));
    const players = this.room.publicPlayers();
    this.room.players.forEach((pl, p) => {
      if (pl.kind !== "human") return;
      const v = this.E.view(this.S, p);
      const ev = evs.map(e => (this.E.filterEvent ? this.E.filterEvent(e, p, this.S) : e)).filter(Boolean);
      const pending = asks.filter(a => !a.secret || a.p === p).map(({ secret, ...a }) => a);
      this.room.sendTo(p, { t: "state", run: this.runId, seq: this.seq, game: this.E.id, me: p, v, ev, pending, players, settings: this.settings, over, results });
    });
  }

  async run() {
    try {
      while (this.alive && !this.E.over(this.S)) {
        const pend = this.E.pending(this.S);
        if (!pend.length) {
          this.syncAsks([]);
          this.broadcast();
          await hostSleep(this.E.delay ? this.E.delay(this.S) : 1200);
          if (!this.alive) return;
          if (!this.E.pending(this.S).length && !this.E.over(this.S)) this.outbox.push(...(this.E.step(this.S) || []));
          continue;
        }
        this.syncAsks(pend);
        this.broadcast();
        const kick = new Promise(r => { this.kick = r; });
        const r = await Promise.race([kick, ...[...this.asks.values()].map(a => a.promise)]);
        this.kick = null;
        if (!this.alive) return;
        if (r.kick) continue;
        const a = this.asks.get(r.p);
        if (!a || a.id !== r.id) continue;
        this.asks.delete(r.p);
        let ok = true;
        try { ok = this.E.validate(this.S, r.p, r.action); } catch (e) { ok = String(e); }
        if (ok !== true) {                              // an AI / timeout action was illegal: engine bug. Log it and fall back.
          console.error("illegal automatic action", this.E.id, r, ok);
          r.action = this.E.timeout(this.S, r.p, a.kind);
          if (this.E.validate(this.S, r.p, r.action) !== true) throw new Error(`${this.E.id}: fallback action is illegal too`);
        }
        const evs = this.E.apply(this.S, r.p, r.action) || [];
        if (r.timeout) this.outbox.push({ type: "notice", text: tx(`{${r.p}} 님 시간 초과`, `{${r.p}} ran out of time`) });
        this.outbox.push(...evs);
      }
      if (!this.alive) return;
      this.finished = true;
      this.syncAsks([]);
      this.broadcast();
    } catch (e) {
      console.error(e);
      this.outbox.push({ type: "notice", text: tx("게임 진행 중 오류가 났습니다: " + (e.message || e), "Something went wrong in the game: " + (e.message || e)) });
      this.finished = true;
      this.broadcast();
    }
  }
}
