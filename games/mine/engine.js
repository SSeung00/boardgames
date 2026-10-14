/* 금광 탐험 — 광부와 방해꾼이 몰래 섞여 굴을 파는 게임.
   길 카드로 입구에서 오른쪽 세 목표(금 1 · 석탄 2) 중 금까지 굴을 잇는다. 방해꾼은 들키지 않게 막는다.
   판 좌표: 입구 (0,0), 목표 (8,-2) (8,0) (8,2). x 는 오른쪽(동), y 는 아래(남)로 커진다.
   길 모양은 면 비트로 적는다: 북 1 · 동 2 · 남 4 · 서 8. c(가운데)가 false 면 막다른 길 — 굴이 지나가지 못한다. */
import { shuffle, shuffleWith, pick } from "../../core/rng.js";

const name = "금광 탐험";

/* ---------- 방향 · 판 크기 ---------- */
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];          // 북 동 남 서
const opp = d => (d + 2) & 3;
const rot180 = m => ((m << 2) | (m >> 2)) & 15;        // 180° 돌리기: 북↔남, 동↔서
const X0 = -4, X1 = 12, Y0 = -5, Y1 = 5;               // 카드를 놓을 수 있는 범위
const GW = X1 - X0 + 1, GH = Y1 - Y0 + 1, NC = GW * GH;
const inB = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;
const idx = (x, y) => (y - Y0) * GW + (x - X0);
const ix = i => i % GW + X0, iy = i => Math.floor(i / GW) + Y0;
const key = (x, y) => x + "," + y;
const NB = new Int16Array(NC * 4);                      // 이웃 칸 번호 (판 밖이면 -1)
for (let i = 0; i < NC; i++) for (let d = 0; d < 4; d++) {
  const x = ix(i) + DX[d], y = iy(i) + DY[d];
  NB[i * 4 + d] = inB(x, y) ? idx(x, y) : -1;
}
const START = idx(0, 0);
const GOAL_POS = [[8, -2], [8, 0], [8, 2]];
const GOAL_I = GOAL_POS.map(([x, y]) => idx(x, y));
const GOAL_NAME = ["위쪽", "가운데", "아래쪽"];
const FAR = 20;                                         // 닿을 길이 없을 때의 거리

/* ---------- 카드 (71장) ---------- */
const TOOLS = ["pick", "lamp", "cart"];
const TOOL_ICON = { pick: "⛏", lamp: "🔦", cart: "🛒" };
const TOOL_NAME = { pick: "곡괭이", lamp: "등불", cart: "수레" };
/* 받침에 따라 조사 고르기: josa("등불", "을", "를") → "등불을" */
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); };
export const CARDS = (() => {
  const C = [];
  // [면, 가운데 이어짐, 장수] — 길 44장 (이어진 길 35 + 막다른 길 9)
  const PATHS = [
    [15, 1, 5],   // 십자
    [7, 1, 5],    // ㅏ (북·동·남)
    [14, 1, 5],   // ㅜ (동·남·서)
    [5, 1, 5],    // 세로 직선
    [10, 1, 5],   // 가로 직선
    [6, 1, 5],    // ┌ (동·남)
    [12, 1, 5],   // ┐ (남·서)
    [4, 0, 1], [2, 0, 1], [5, 0, 1], [10, 0, 1], [15, 0, 1], [7, 0, 1], [14, 0, 1], [6, 0, 1], [12, 0, 1]   // 막다른 길
  ];
  for (const [e, c, k] of PATHS) for (let i = 0; i < k; i++) C.push({ t: "path", e, c: !!c });
  for (const tool of TOOLS) for (let i = 0; i < 3; i++) C.push({ t: "break", tool });       // 도구 고장 9
  for (const tool of TOOLS) for (let i = 0; i < 2; i++) C.push({ t: "fix", tools: [tool] }); // 수리 6
  for (const pair of [["pick", "lamp"], ["pick", "cart"], ["lamp", "cart"]]) C.push({ t: "fix", tools: pair }); // 둘 중 하나 수리 3
  for (let i = 0; i < 6; i++) C.push({ t: "map" });                                         // 지도 6
  for (let i = 0; i < 3; i++) C.push({ t: "rock" });                                        // 낙석 3
  return C;
})();
const NCARDS = CARDS.length;                           // 71

/* 역할 카드: [방해꾼, 광부] — 인원 + 1장, 한 장은 쓰지 않는다 */
const ROLE_SET = { 3: [1, 3], 4: [1, 4], 5: [2, 4], 6: [2, 5], 7: [3, 5], 8: [3, 6], 9: [3, 7], 10: [4, 7] };
const handSize = n => (n <= 5 ? 6 : n <= 7 ? 5 : 4);
const roleName = r => (r === "s" ? "방해꾼" : "광부");

/* ---------- 판 계산 (숫자 격자로 바꿔 빠르게) ----------
   k: 0 빈칸 · 1 입구 · 2 길 · 3 숨은 목표 · 4 공개된 목표 */
function grid(board) {
  const G = { k: new Int8Array(NC), e: new Int8Array(NC), c: new Int8Array(NC) };
  for (const kk in board) {
    const cell = board[kk], cm = kk.indexOf(","), i = idx(+kk.slice(0, cm), +kk.slice(cm + 1));
    if (cell.k === "s") { G.k[i] = 1; G.e[i] = 15; G.c[i] = 1; }
    else if (cell.k === "p") { G.k[i] = 2; G.e[i] = cell.e; G.c[i] = cell.c ? 1 : 0; }
    else if (cell.rev) { G.k[i] = 4; G.e[i] = cell.e; G.c[i] = 1; }
    else G.k[i] = 3;
  }
  return G;
}
const passable = (G, j) => { const k = G.k[j]; return k === 1 || k === 4 || (k === 2 && G.c[j] === 1); };

/* 입구에서 끊기지 않은 굴로 갈 수 있는 칸 (막다른 길 · 숨은 목표는 지나가지 못한다) */
function reach(G) {
  const R = new Uint8Array(NC), q = [START];
  R[START] = 1;
  while (q.length) {
    const i = q.pop();
    for (let d = 0; d < 4; d++) {
      if (!(G.e[i] >> d & 1)) continue;
      const j = NB[i * 4 + d];
      if (j < 0 || R[j] || !passable(G, j) || !(G.e[j] >> opp(d) & 1)) continue;
      R[j] = 1; q.push(j);
    }
  }
  return R;
}

/* 길 카드(면 e)를 i 칸에 놓을 수 있나 → "" 이면 가능, 아니면 이유 */
function placeErr(G, R, i, e) {
  if (G.k[i]) return "이미 카드가 있는 자리입니다";
  let link = false;
  for (let d = 0; d < 4; d++) {
    const j = NB[i * 4 + d];
    if (j < 0) continue;
    const k = G.k[j];
    if (k === 0 || k === 3) continue;                   // 빈칸 · 숨은 목표는 어느 쪽이든 맞는다
    const mine = e >> d & 1, their = G.e[j] >> opp(d) & 1;
    if (mine !== their) return "옆 카드와 굴이 맞지 않습니다";
    if (mine && R[j]) link = true;
  }
  return link ? "" : "입구와 이어진 굴 끝에만 놓을 수 있습니다";
}

/* 굴 끝: 이어진 칸에서 열린 면 너머의 빈칸들 (길 카드는 여기에만 놓일 수 있다) */
function exits(G, R) {
  const out = [], seen = new Uint8Array(NC);
  for (let i = 0; i < NC; i++) if (R[i]) for (let d = 0; d < 4; d++) {
    if (!(G.e[i] >> d & 1)) continue;
    const j = NB[i * 4 + d];
    if (j >= 0 && !G.k[j] && !seen[j]) { seen[j] = 1; out.push(j); }
  }
  return out;
}

/* 목표마다 남은 거리 (카드 몇 장이 더 필요한지 어림): 목표 옆 빈칸에서 빈칸만 지나 굴 끝까지. 닿았으면 0.
   가장 짧은 길로 이어지는 굴 끝이 하나뿐이면(외길) 조금 더 먼 것으로 친다 — 막다른 길 하나로 막히기 쉬우니까 */
const dq = new Int16Array(NC), dd = new Int16Array(NC);
function dists(G, R) {
  const ex = exits(G, R);
  const D = [FAR, FAR, FAR];
  for (let g = 0; g < 3; g++) {
    const gi = GOAL_I[g];
    if (G.k[gi] === 4 && R[gi]) { D[g] = 0; continue; }
    dd.fill(0);
    let qn = 0, hit = false;
    for (let d = 0; d < 4; d++) {
      const j = NB[gi * 4 + d];
      if (j < 0) continue;
      if (R[j] && (G.e[j] >> opp(d) & 1)) { hit = true; break; }
      if (!G.k[j] && !dd[j]) { dd[j] = 1; dq[qn++] = j; }
    }
    if (hit) { D[g] = 0; continue; }
    for (let h = 0; h < qn; h++) {
      const i = dq[h];
      for (let d = 0; d < 4; d++) {
        const j = NB[i * 4 + d];
        if (j >= 0 && !G.k[j] && !dd[j]) { dd[j] = dd[i] + 1; dq[qn++] = j; }
      }
    }
    let best = FAR, width = 0;
    for (const j of ex) {
      const v = dd[j];
      if (!v) continue;
      if (v < best) { best = v; width = 1; } else if (v === best) width++;
    }
    D[g] = best < FAR ? best + .6 / width : FAR;
  }
  return D;
}

/* ---------- 라운드 ---------- */
function newRound(S) {
  S.round++;
  const [ns, nm] = ROLE_SET[S.n];
  const roles = shuffle(S, [...Array(ns).fill("s"), ...Array(nm).fill("m")]);
  S.roles = roles.slice(0, S.n);                        // 마지막 한 장은 아무도 모른다
  S.deck = shuffle(S, [...Array(NCARDS).keys()]);
  S.hands = [];
  const hs = handSize(S.n);
  for (let p = 0; p < S.n; p++) S.hands.push(S.deck.splice(S.deck.length - hs, hs));
  S.discard = [];
  S.broken = Array.from({ length: S.n }, () => []);
  S.peeks = Array.from({ length: S.n }, () => []);
  S.hist = [];
  const shapes = shuffle(S, [{ gold: true, e0: 15 }, { gold: false, e0: 9 }, { gold: false, e0: 12 }]);   // 석탄: ┘(북·서) · ┐(남·서)
  S.goals = GOAL_POS.map(([x, y], g) => ({ x, y, gold: shapes[g].gold, e0: shapes[g].e0, e: 0, rev: false }));
  S.board = { [key(0, 0)]: { k: "s" } };
  S.goals.forEach((gl, g) => { S.board[key(gl.x, gl.y)] = { k: "g", g }; });
  S.turn = S.nextStart % S.n;
  S.phase = "play";
  S.res = null;
  S.last = null;
}

/* 입구와 이어진 굴이 숨은 목표에 닿았으면 뒤집는다 (석탄은 닿은 쪽이 열리게 돌린다). 금이 나오면 true */
function revealReached(S, ev) {
  let gold = false;
  for (;;) {
    const G = grid(S.board), R = reach(G);
    let any = false;
    for (let g = 0; g < 3; g++) {
      const gl = S.goals[g];
      if (gl.rev) continue;
      const gi = GOAL_I[g], sides = [];
      for (let d = 0; d < 4; d++) { const j = NB[gi * 4 + d]; if (j >= 0 && R[j] && (G.e[j] >> opp(d) & 1)) sides.push(d); }
      if (!sides.length) continue;
      const fit = m => sides.filter(d => m >> d & 1).length;
      let e = gl.e0, rot = 0;
      if (fit(rot180(e)) > fit(e)) { e = rot180(e); rot = 180; }
      gl.e = e; gl.rev = true;
      Object.assign(S.board[key(gl.x, gl.y)], { rev: true, e, c: true, rot });
      ev.push({ type: "reveal", g, x: gl.x, y: gl.y, gold: gl.gold, e, rot,
        text: gl.gold ? `💰 ${GOAL_NAME[g]} 목표는 금이었습니다!` : `${GOAL_NAME[g]} 목표는 석탄이었습니다 ⚫`, toast: gl.gold });
      if (gl.gold) gold = true;
      any = true;
    }
    if (!any || gold) return gold;
  }
}

function endRound(S, winner, finisher, ev) {
  const gains = Array(S.n).fill(0);
  const sabs = [];
  S.roles.forEach((r, p) => { if (r === "s") sabs.push(p); });
  if (winner === "m") S.roles.forEach((r, p) => { if (r === "m") gains[p] = p === finisher ? 3 : 2; });
  else { const per = sabs.length === 1 ? 4 : sabs.length <= 3 ? 3 : 2; for (const p of sabs) gains[p] = per; }
  gains.forEach((g, p) => { S.gold[p] += g; });
  S.roleHist.forEach((h, p) => h.push(S.roles[p]));
  S.phase = "end";
  S.nextStart = (finisher + 1) % S.n;
  const goldAt = S.goals.findIndex(gl => gl.gold);
  S.res = { winner, gains, finisher, goldAt };
  ev.push({ type: "round", winner, finisher, gains, roles: S.roles.slice(), goldAt, round: S.round,
    text: winner === "m" ? `광부 승리! {${finisher}} 님이 금맥을 열었습니다`
      : sabs.length ? "카드가 모두 떨어졌습니다 — 방해꾼 승리!" : "카드가 모두 떨어졌습니다 — 이번 판엔 방해꾼이 없었습니다", toast: true });
}

/* 다음 차례: 손패가 남은 다음 사람. 아무도 없으면 라운드 끝 (방해꾼 승리) */
function advance(S, p, ev) {
  for (let k = 1; k <= S.n; k++) {
    const q = (p + k) % S.n;
    if (S.hands[q].length) { S.turn = q; return; }
  }
  endRound(S, "s", p, ev);
}

function actionKey(a) {
  if (!a || typeof a !== "object") return null;
  const ks = ["path", "break", "repair", "map", "rock", "discard"].filter(k => a[k] !== undefined);
  return ks.length === 1 ? ks[0] : null;
}

/* ---------- AI ---------- */
const LEVELS = {
  easy: { noise: 3.5, rand: .3, sneaky: 0, mapBonus: 0 },
  normal: { noise: 2.5, rand: .05, sneaky: .3, mapBonus: 1 },
  hard: { noise: .3, rand: 0, sneaky: .35, mapBonus: 2 }
};
const ed = (D, w) => w[0] * D[0] + w[1] * D[1] + w[2] * D[2];
const noise = (rng, s) => (s ? (rng() + rng() + rng() - 1.5) * s * 1.15 : 0);

/* o 가 아는 목표 정보 → 금일 가능성 w. pub 이면 공개된 것만 (모두가 아는 정보) */
function belief(S, o, pub) {
  const known = S.goals.map((gl, g) => (gl.rev || (!pub && o >= 0 && S.peeks[o].includes(g)) ? gl.gold : null));
  const w = [0, 0, 0];
  const gi = known.indexOf(true);
  const unk = [0, 1, 2].filter(g => known[g] === null);
  if (gi >= 0) w[gi] = 1;
  else for (const g of unk) w[g] = 1 / unk.length;
  return { w, known, sure: gi >= 0 || unk.length === 1 };
}

/* 공개된 행동으로 짐작한 의심 점수 (클수록 방해꾼 같다). o 의 입장 — 내 역할 · 내가 본 지도는 써도 된다 */
function suspicion(S, o, w) {
  const help = new Array(S.n).fill(0);
  for (const h of S.hist) {
    if (h.t !== "path" && h.t !== "rock") continue;
    let v = w[0] * h.dg[0] + w[1] * h.dg[1] + w[2] * h.dg[2];
    if (h.dead) v -= 1.5;
    help[h.p] += v;
  }
  const t1 = help.map(v => Math.max(-2, Math.min(2, v / 2)));
  const myRole = o >= 0 ? S.roles[o] : null;
  for (const h of S.hist) {
    if (h.t === "break") {
      let v = -1.2 * t1[h.target];
      if (h.target === o) v += myRole === "m" ? -3 : 1.5;   // 나(광부)를 부쉈다면 수상하다
      help[h.p] += v;
    } else if (h.t === "fix" && h.target !== h.p) {
      let v = t1[h.target];
      if (h.target === o && myRole === "m") v += 1.5;
      help[h.p] += v;
    }
  }
  return help.map(v => -v);
}

function randomAct(S, p, rng) {
  const hand = S.hands[p];
  if (rng() < .12) return { discard: pick(rng, hand) };
  let G = null, R = null, ex = null;
  for (const id of shuffleWith(rng, hand.slice())) {
    const C = CARDS[id];
    if (C.t === "path") {
      if (S.broken[p].length) continue;
      if (!G) { G = grid(S.board); R = reach(G); ex = exits(G, R); }
      const opts = [];
      for (const rot of [0, 180]) {
        const e = rot ? rot180(C.e) : C.e;
        for (const i of ex) if (!placeErr(G, R, i, e)) opts.push({ path: id, x: ix(i), y: iy(i), rot });
      }
      if (opts.length) return pick(rng, opts);
    } else if (C.t === "break") {
      const ts = [];
      for (let t = 0; t < S.n; t++) if (t !== p && !S.broken[t].includes(C.tool)) ts.push(t);
      if (ts.length) return { break: id, target: pick(rng, ts) };
    } else if (C.t === "fix") {
      const opts = [];
      for (let t = 0; t < S.n; t++) for (const tool of C.tools) if (S.broken[t].includes(tool)) opts.push({ repair: id, target: t, tool });
      if (opts.length) return pick(rng, opts);
    } else if (C.t === "map") {
      const gs = [0, 1, 2].filter(g => !S.goals[g].rev && !S.peeks[p].includes(g));
      if (gs.length) return { map: id, goal: pick(rng, gs) };
    } else if (C.t === "rock") {
      const cells = Object.keys(S.board).filter(k => S.board[k].k === "p");
      if (cells.length) { const [x, y] = pick(rng, cells).split(",").map(Number); return { rock: id, x, y }; }
    }
  }
  return { discard: pick(rng, hand) };
}

function aiAct(S, p, level, rng) {
  const L = LEVELS[level] || LEVELS.normal;
  const hand = S.hands[p];
  if (rng() < L.rand) return randomAct(S, p, rng);
  const mine = S.roles[p] === "m";
  const bel = belief(S, p, false), w = bel.w, pw = belief(S, p, true).w;
  const G = grid(S.board), R0 = reach(G), D0 = dists(G, R0), ex = exits(G, R0);
  const ed0 = ed(D0, w), ped0 = ed(D0, pw);
  const sus = suspicion(S, p, w);                       // 내 입장의 의심 (클수록 방해꾼 같다)
  const pubSus = suspicion(S, -1, pw);                  // 모두가 보는 의심 — 방해꾼이 자기가 얼마나 들켰는지 어림
  const pubTrust = pubSus.map(v => Math.max(-2, Math.min(2, -v / 2)));
  // 방해꾼의 태도: 광부가 금에 가까울수록 대놓고 막는다. 수준에 따라 가끔은 의심을 덜 사는 수를 고른다
  // (AI 끼리 시험해 보면 너무 숨는 방해꾼은 오히려 진다 — 아무것도 안 하는 사람도 결국 의심받기 때문)
  let near = FAR;                                       // 금일 수도 있는 목표 중 가장 가까운 것까지의 거리
  for (let g = 0; g < 3; g++) if (w[g] > 0) near = Math.min(near, D0[g]);
  let aggr = 1, stealth = 1;
  if (near <= 2.7) { aggr = 2; stealth = 0; } else if (near <= 4.7) { aggr = 1.2; stealth = .35; }
  stealth *= L.sneaky;
  if (pubSus[p] > 2.5) stealth *= .3;                   // 이미 들켰다면 숨길 것이 없다
  if (S.deck.length < S.n) stealth *= .5;               // 막판
  const expo = 3.5 * stealth;                           // 의심 1점을 살 때 치르는 값
  const broken = S.broken[p].length > 0;
  const order = t => (t - p + S.n) % S.n;               // 나 다음으로 몇 번째에 두는지
  const cands = [];
  const add = (a, s) => cands.push({ a, s: s + noise(rng, L.noise) });
  const seenShape = new Set();

  for (const id of hand) {
    const C = CARDS[id];
    // 버리기: 카드를 들고 있을 가치를 뺀다 (방해꾼은 막다른 길 · 낙석 · 고장 카드를 아껴 둔다)
    let keep = 2;
    if (C.t === "path") keep = mine ? (C.c ? (broken ? 1.5 : 3) : 0) : (C.c ? 1 : 3.5);
    else if (C.t === "break") keep = mine ? 2 : 3.5;
    else if (C.t === "map") keep = bel.sure ? 0 : 2.5;
    else if (C.t === "rock") keep = mine ? 1.5 : 3;
    else if (C.t === "fix") keep = mine ? 2 : 1.5;
    add({ discard: id }, -2 - keep);

    if (C.t === "path") {
      if (broken) continue;
      const sig = C.e * 2 + (C.c ? 1 : 0);
      if (seenShape.has(sig)) continue;
      seenShape.add(sig);
      for (const rot of C.e === rot180(C.e) ? [0] : [0, 180]) {
        const e = rot ? rot180(C.e) : C.e;
        for (const i of ex) {
          if (placeErr(G, R0, i, e)) continue;
          G.k[i] = 2; G.e[i] = e; G.c[i] = C.c ? 1 : 0;
          const D = dists(G, reach(G));
          G.k[i] = 0; G.e[i] = 0; G.c[i] = 0;
          const gain = ed0 - ed(D, w), pgain = ped0 - ed(D, pw);
          let hit = 0, coal = 0;                          // 이 수로 숨은 목표가 뒤집힐 때 그게 금일 가능성 · 내가 아는 석탄을 공개하는지
          for (let g = 0; g < 3; g++) if (!S.goals[g].rev && D[g] === 0) { hit += w[g]; if (bel.known[g] === false) coal++; }
          let s;
          if (mine) s = 10 * gain + 60 * hit + 2 * coal - (C.c ? 0 : 4) - (gain <= 0 ? 3 : 0);
          else {
            // 이득: 금에서 멀어지게. 값: 남들이 보기에 굴을 망친 만큼 의심을 산다.
            // 내가 아는 석탄 쪽으로 파면 착해 보이지만, 실제로 뒤집으면 광부들에게 정보를 주니 끝까지는 가지 않는다
            const exposure = Math.max(0, -pgain) + (C.c ? 0 : 1.5);
            s = -10 * gain * aggr - expo * exposure + (pgain > 0 && gain <= .25 ? (2 + 2 * stealth) * pgain : 0) - 80 * hit - 8 * coal;
          }
          add({ path: id, x: ix(i), y: iy(i), rot }, s);
        }
      }
    } else if (C.t === "break") {
      for (let t = 0; t < S.n; t++) {
        if (t === p || S.broken[t].includes(C.tool)) continue;
        const already = S.broken[t].length > 0, soon = (S.n - order(t)) / S.n;
        let s;
        if (mine) s = 3 * (sus[t] - 2.5) + (already ? -2 : 1.5) + soon;   // 꽤 수상할 때만
        else {
          const trust = Math.max(-2, Math.min(2, -sus[t] / 2));   // 광부 같은 사람일수록 막을 값어치가 크다
          s = (1.5 + 2 * trust) * aggr + (already ? -2 : 1.2) + 3 * soon * aggr - expo * Math.max(0, 1.2 * pubTrust[t]);
        }
        add({ break: id, target: t }, s);
      }
    } else if (C.t === "fix") {
      for (let t = 0; t < S.n; t++) for (const tool of C.tools) {
        if (!S.broken[t].includes(tool)) continue;
        const full = S.broken[t].length === 1;
        let s;
        if (mine) s = t === p ? (full ? 7 : 3) : (sus[t] < -.5 ? 3 - sus[t] + (full ? 1 : 0) : -2 - sus[t]);
        else s = t === p ? (full ? 5 : 2) : (sus[t] > 1 ? 1 + sus[t] - expo * Math.max(0, -pubTrust[t]) : -3);
        add({ repair: id, target: t, tool }, s);
      }
    } else if (C.t === "map") {
      if (bel.sure) continue;
      for (let g = 0; g < 3; g++) {
        if (bel.known[g] !== null) continue;
        const s = (mine ? 4 : 3.5) + (ed0 <= 5 ? 6 : 2) + L.mapBonus + (g === 1 ? .6 : 0);
        add({ map: id, goal: g }, s);
      }
    } else if (C.t === "rock") {
      for (let i = 0; i < NC; i++) {
        if (G.k[i] !== 2) continue;
        const e = G.e[i], c = G.c[i];
        G.k[i] = 0; G.e[i] = 0; G.c[i] = 0;
        const D = dists(G, reach(G));
        G.k[i] = 2; G.e[i] = e; G.c[i] = c;
        const gain = ed0 - ed(D, w), pgain = ped0 - ed(D, pw);
        const s = mine ? 10 * gain - 2 : -10 * gain * aggr - 1 - expo * Math.max(0, -pgain);
        add({ rock: id, x: ix(i), y: iy(i) }, s);
      }
    }
  }
  cands.sort((a, b) => b.s - a.s);
  return cands[0].a;
}

/* ---------- 엔진 ---------- */
export default {
  id: "mine",
  name,
  icon: "⛏️",
  blurb: "굴을 이어 금을 캐세요. 그런데 우리 중에 방해꾼이 숨어 있다!",
  players: { min: 3, max: 10, default: 5 },
  settings: [
    { key: "rounds", label: "라운드", values: [1, 3], labels: ["1라운드", "3라운드"], default: 3, note: "라운드마다 역할을 새로 나눕니다" }
  ],
  rules: `<ul>
    <li>모두 몰래 <b>역할</b>을 받습니다. <b>광부</b>는 입구에서 금까지 굴을 잇고, <b>방해꾼</b>은 들키지 않게 막습니다.
      역할 카드는 인원보다 한 장 많아 한 장은 아무도 모릅니다 (방해꾼·광부: 3명 1·3, 4명 1·4, 5명 2·4, 6명 2·5, 7명 3·5, 8명 3·6, 9명 3·7, 10명 4·7).</li>
    <li>판 왼쪽에 <b>입구</b>, 8칸 오른쪽에 뒤집힌 <b>목표 3장</b>(금 1 · 석탄 2)이 2칸 간격으로 있습니다.</li>
    <li>내 차례에는 카드 <b>한 장을 내거나</b>, 한 장을 <b>엎어 버립니다</b>. 그다음 덱이 남았으면 한 장 뽑습니다. 손패: 3~5명 6장, 6~7명 5장, 8~10명 4장.</li>
  </ul>
  <h4>길 카드 (44장, 막다른 길 9장 포함)</h4>
  <ul>
    <li>이미 놓인 카드 옆에 놓되, <b>맞닿는 모든 면이 맞아야</b> 합니다 (굴↔굴, 벽↔벽). 뒤집힌 목표는 어느 쪽과도 맞는 것으로 칩니다.</li>
    <li>새 카드는 <b>입구에서 끊기지 않은 굴</b>로 이어져야 합니다. 막다른 길(돌무더기)은 굴이 지나가지 못합니다.</li>
    <li>카드는 <b>180° 돌려</b> 놓을 수 있습니다.</li>
    <li>굴이 목표에 닿으면 뒤집습니다. 석탄이면 닿은 쪽으로 굴이 열리게 돌려 놓고, 거기서 계속 팔 수 있습니다. <b>금</b>이 나오면 광부 승리!</li>
  </ul>
  <h4>행동 카드 (27장)</h4>
  <ul>
    <li><b>도구 고장</b> ⛏ 곡괭이 · 🔦 등불 · 🛒 수레 (각 3장): 다른 사람의 도구를 망가뜨립니다. 이미 고장 난 도구는 또 고장 낼 수 없습니다. <b>고장 난 도구가 하나라도 있으면 길 카드를 놓을 수 없습니다.</b></li>
    <li><b>수리</b> (도구마다 2장 + 두 도구 중 하나를 고치는 카드 3장): 나나 다른 사람의 고장 난 도구 하나를 고칩니다.</li>
    <li><b>지도</b> (6장): 목표 하나를 나만 몰래 봅니다. <b>낙석</b> (3장): 입구 · 목표를 뺀 길 카드 한 장을 치웁니다.</li>
    <li>덱과 모든 손패가 떨어질 때까지 금에 닿지 못하면 <b>방해꾼 승리</b>.</li>
  </ul>
  <h4>점수 (우리 규칙)</h4>
  <ul>
    <li>광부 승리: 금을 연 광부 <b>3금</b>, 나머지 광부 <b>2금</b>씩. (방해꾼이 금을 열었다면 광부 모두 2금씩.)</li>
    <li>방해꾼 승리: 방해꾼이 1명이면 <b>4금</b>, 2~3명이면 <b>3금</b>씩, 4명이면 <b>2금</b>씩.</li>
    <li>라운드마다 역할을 새로 받고, 라운드를 끝낸 사람의 다음 사람부터 시작합니다. 마지막 라운드가 끝나면 금이 가장 많은 사람이 1등.</li>
  </ul>`,

  setup({ n, seed, settings }) {
    const rounds = settings && settings.rounds === 1 ? 1 : 3;
    const S = { n, rs: seed >>> 0, rounds, round: 0, phase: "play", gold: Array(n).fill(0), roleHist: Array.from({ length: n }, () => []), nextStart: 0 };
    S.nextStart = Math.floor((seed >>> 0) % n);
    newRound(S);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    return [{ p: S.turn, kind: "turn" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== S.turn) return "지금은 내 차례가 아닙니다";
    const k = actionKey(a);
    if (!k) return "낼 카드를 한 장 고르세요";
    const id = a[k];
    if (!Number.isInteger(id) || !S.hands[p].includes(id)) return "손에 없는 카드입니다";
    const C = CARDS[id];
    if (k === "discard") return true;
    if (k === "path") {
      if (C.t !== "path") return "길 카드가 아닙니다";
      if (S.broken[p].length) return "도구가 고장 나서 길을 놓을 수 없습니다";
      if (a.rot !== 0 && a.rot !== 180) return "카드 방향이 잘못되었습니다";
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !inB(a.x, a.y)) return "놓을 수 없는 자리입니다";
      const G = grid(S.board);
      const err = placeErr(G, reach(G), idx(a.x, a.y), a.rot ? rot180(C.e) : C.e);
      return err || true;
    }
    if (k === "break") {
      if (C.t !== "break") return "도구 고장 카드가 아닙니다";
      if (!Number.isInteger(a.target) || a.target < 0 || a.target >= S.n) return "고장 낼 사람을 고르세요";
      if (a.target === p) return "내 도구는 고장 낼 수 없습니다";
      if (S.broken[a.target].includes(C.tool)) return `이미 ${josa(TOOL_NAME[C.tool], "이", "가")} 고장 난 사람입니다`;
      return true;
    }
    if (k === "repair") {
      if (C.t !== "fix") return "수리 카드가 아닙니다";
      if (!Number.isInteger(a.target) || a.target < 0 || a.target >= S.n) return "고칠 사람을 고르세요";
      if (!C.tools.includes(a.tool)) return "이 카드로 고칠 수 없는 도구입니다";
      if (!S.broken[a.target].includes(a.tool)) return "고장 나지 않은 도구입니다";
      return true;
    }
    if (k === "map") {
      if (C.t !== "map") return "지도 카드가 아닙니다";
      if (![0, 1, 2].includes(a.goal)) return "볼 목표를 고르세요";
      if (S.goals[a.goal].rev) return "이미 공개된 목표입니다";
      if (S.peeks[p].includes(a.goal)) return "이미 확인한 목표입니다";
      return true;
    }
    if (k === "rock") {
      if (C.t !== "rock") return "낙석 카드가 아닙니다";
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return "무너뜨릴 길을 고르세요";
      const cell = S.board[key(a.x, a.y)];
      if (!cell || cell.k !== "p") return "입구 · 목표가 아닌 길 카드만 무너뜨릴 수 있습니다";
      return true;
    }
    return "알 수 없는 행동입니다";
  },

  apply(S, p, a) {
    const ev = [];
    const k = actionKey(a), id = a[k], C = CARDS[id];
    S.hands[p].splice(S.hands[p].indexOf(id), 1);
    if (k === "discard") {
      S.discard.push(id);
      S.hist.push({ p, t: "discard" });
      S.last = { p, t: "discard" };
      ev.push({ type: "discard", p, text: `{${p}} 님이 카드 한 장을 엎어 버렸습니다` });
    } else if (k === "path" || k === "rock") {
      const G0 = grid(S.board), D0 = dists(G0, reach(G0));
      const kk = key(a.x, a.y);
      if (k === "path") {
        const e = a.rot ? rot180(C.e) : C.e;
        S.board[kk] = { k: "p", id, e, c: C.c, rot: a.rot };
        ev.push({ type: "path", p, x: a.x, y: a.y, id, e, c: C.c, rot: a.rot,
          text: C.c ? `{${p}} 님이 굴을 팠습니다` : `{${p}} 님이 막다른 길을 놓았습니다` });
      } else {
        S.discard.push(id, S.board[kk].id);
        delete S.board[kk];
        ev.push({ type: "rock", p, x: a.x, y: a.y, text: `{${p}} 님이 낙석으로 굴 하나를 무너뜨렸습니다` });
      }
      const G1 = grid(S.board), D1 = dists(G1, reach(G1));
      S.hist.push({ p, t: k, dead: k === "path" && !C.c, dg: D0.map((d, g) => d - D1[g]) });
      S.last = { p, t: k, x: a.x, y: a.y };
      if (k === "path" && revealReached(S, ev)) { endRound(S, "m", p, ev); return ev; }
    } else if (k === "break") {
      S.broken[a.target].push(C.tool);
      S.discard.push(id);
      S.hist.push({ p, t: "break", target: a.target });
      S.last = { p, t: "break", target: a.target, tool: C.tool };
      ev.push({ type: "break", p, target: a.target, tool: C.tool,
        text: `{${p}} 님이 {${a.target}} 님의 ${josa(TOOL_NAME[C.tool], "을", "를")} 망가뜨렸습니다 ${TOOL_ICON[C.tool]}` });
    } else if (k === "repair") {
      S.broken[a.target].splice(S.broken[a.target].indexOf(a.tool), 1);
      S.discard.push(id);
      S.hist.push({ p, t: "fix", target: a.target });
      S.last = { p, t: "fix", target: a.target, tool: a.tool };
      ev.push({ type: "repair", p, target: a.target, tool: a.tool,
        text: a.target === p ? `{${p}} 님이 자기 ${josa(TOOL_NAME[a.tool], "을", "를")} 고쳤습니다 ${TOOL_ICON[a.tool]}`
          : `{${p}} 님이 {${a.target}} 님의 ${josa(TOOL_NAME[a.tool], "을", "를")} 고쳐 주었습니다 ${TOOL_ICON[a.tool]}` });
    } else if (k === "map") {
      S.peeks[p].push(a.goal);
      S.discard.push(id);
      S.hist.push({ p, t: "map" });
      S.last = { p, t: "map", goal: a.goal };
      ev.push({ type: "map", p, goal: a.goal, gold: S.goals[a.goal].gold,
        text: `{${p}} 님이 지도로 ${GOAL_NAME[a.goal]} 목표를 몰래 보았습니다 🗺️` });
    }
    if (S.deck.length) S.hands[p].push(S.deck.pop());
    advance(S, p, ev);
    return ev;
  },

  /* 지도로 본 목표의 정체는 본 사람만 */
  filterEvent(ev, p) {
    if (ev.type === "map" && p !== ev.p) { const { gold, ...rest } = ev; return rest; }
    return ev;
  },

  step(S) {
    if (S.phase !== "end") return [];
    if (S.round >= S.rounds) {
      S.phase = "over";
      return [{ type: "over", text: "게임 끝 — 금을 가장 많이 모은 사람이 이깁니다" }];
    }
    newRound(S);
    return [{ type: "newround", round: S.round, text: `${S.round}라운드 시작 — 역할을 새로 나눴습니다`, toast: true }];
  },
  delay(S) { return S.phase === "end" ? 6000 : 800; },

  /* 시간 초과: 손패 중 한 장을 엎어 버린다 (S 를 바꾸지 않고 고른다) */
  timeout(S, p) {
    const h = S.hands[p];
    return { discard: h[(S.rs >>> 0) % Math.max(1, h.length)] };
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.phase !== "play" || p !== S.turn || !S.hands[p].length) return this.timeout(S, p);
    const a = aiAct(S, p, level, rng);
    return this.validate(S, p, a) === true ? a : this.timeout(S, p);
  },
  thinkTime() { return 800 + Math.random() * 700; },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const open = S.phase !== "play";
    const known = me >= 0 ? S.peeks[me] : [];
    const board = [];
    let bx0 = 0, bx1 = 8, by0 = -2, by1 = 2;
    for (const kk in S.board) {
      const cell = S.board[kk], [x, y] = kk.split(",").map(Number);
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      if (cell.k === "g") {
        const gl = S.goals[cell.g];
        board.push(gl.rev ? { x, y, k: "g", g: cell.g, rev: true, e: gl.e, gold: gl.gold } : { x, y, k: "g", g: cell.g });
      } else if (cell.k === "s") board.push({ x, y, k: "s", e: 15, c: true });
      else board.push({ x, y, k: "p", id: cell.id, e: cell.e, c: cell.c });
    }
    const goals = S.goals.map((gl, g) => ({ x: gl.x, y: gl.y, rev: gl.rev,
      kind: gl.rev || open || known.includes(g) ? (gl.gold ? "gold" : "coal") : null, peek: !gl.rev && known.includes(g) }));
    const hand = me >= 0 ? S.hands[me].map(id => ({ id, ...CARDS[id] })) : [];
    // 내 차례면 길 카드마다 놓을 수 있는 자리 [x, y, rot]
    let legal = null;
    if (me === S.turn && S.phase === "play" && !S.broken[me].length) {
      legal = {};
      const G = grid(S.board), R = reach(G), ex = exits(G, R);
      for (const c of hand) if (c.t === "path") {
        const list = [];
        for (const rot of [0, 180]) {
          const e = rot ? rot180(c.e) : c.e;
          for (const i of ex) if (!placeErr(G, R, i, e)) list.push([ix(i), iy(i), rot]);
        }
        legal[c.id] = list;
      }
    }
    const status = S.phase === "over" ? "게임 끝"
      : S.phase === "end" ? (S.res.winner === "m" ? "광부 승리! 다음 라운드 준비 중" : "방해꾼 승리! 다음 라운드 준비 중")
      : me === S.turn ? "내 차례 — 카드 한 장을 내거나 버리세요" : "";
    return {
      phase: S.phase, round: S.round, rounds: S.rounds, turn: S.turn, n: S.n,
      deck: S.deck.length, sizes: S.hands.map(h => h.length), broken: S.broken.map(b => b.slice()), gold: S.gold.slice(),
      role: me >= 0 ? S.roles[me] : null,
      roles: open ? S.roles.slice() : null,
      res: open ? S.res : null,
      board, goals, hand, legal, last: S.last,
      bounds: { x0: Math.max(X0, bx0 - 1), x1: Math.min(X1, bx1 + 1), y0: Math.max(Y0, by0 - 1), y1: Math.min(Y1, by1 + 1) },
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.gold.map((g, p) => ({ p, rank: 1 + S.gold.filter(x => x > g).length, score: `${g}금`,
      note: S.roleHist[p].map(roleName).join(" · ") }));
  },

  /* ---------- 시험용 ---------- */
  randomAction(S, p, rng) { return randomAct(S, p, rng); },
  check(S) {
    const ids = [...S.deck, ...S.discard];
    for (const h of S.hands) ids.push(...h);
    for (const kk in S.board) {
      const c = S.board[kk];
      if (c.k !== "p") continue;
      ids.push(c.id);
      const C = CARDS[c.id];
      if (!C || C.t !== "path") return `판에 길이 아닌 카드 ${c.id}`;
      if ((c.rot ? rot180(C.e) : C.e) !== c.e || C.c !== c.c) return `판 카드 모양이 다름 ${kk}`;
    }
    if (ids.length !== NCARDS) return `카드 수가 맞지 않음 ${ids.length}`;
    if (new Set(ids).size !== NCARDS) return "카드 중복";
    for (const id of ids) if (!Number.isInteger(id) || id < 0 || id >= NCARDS) return `잘못된 카드 번호 ${id}`;
    const st = S.board[key(0, 0)];
    if (!st || st.k !== "s") return "입구가 없음";
    for (let g = 0; g < 3; g++) {
      const c = S.board[key(...GOAL_POS[g])];
      if (!c || c.k !== "g" || c.g !== g || !!c.rev !== S.goals[g].rev) return `목표 ${g} 자리 이상`;
    }
    for (const kk in S.board) { const [x, y] = kk.split(",").map(Number); if (!inB(x, y)) return `판 밖 카드 ${kk}`; }
    // 입구 · 길 카드끼리는 맞닿은 면이 항상 맞아야 한다 (공개된 석탄은 먼저 놓인 이웃과 안 맞을 수 있어 뺀다)
    const G = grid(S.board);
    for (let i = 0; i < NC; i++) {
      if (G.k[i] !== 1 && G.k[i] !== 2) continue;
      for (const d of [1, 2]) {
        const j = NB[i * 4 + d];
        if (j < 0 || (G.k[j] !== 1 && G.k[j] !== 2)) continue;
        if ((G.e[i] >> d & 1) !== (G.e[j] >> opp(d) & 1)) return `면이 맞지 않는 이웃 (${ix(i)},${iy(i)})`;
      }
    }
    if (S.phase === "play") {
      const R = reach(G);
      for (let g = 0; g < 3; g++) {
        if (S.goals[g].rev) continue;
        for (let d = 0; d < 4; d++) { const j = NB[GOAL_I[g] * 4 + d]; if (j >= 0 && R[j] && (G.e[j] >> opp(d) & 1)) return `굴이 닿았는데 목표 ${g} 가 안 뒤집힘`; }
      }
      if (S.goals.some(gl => gl.rev && gl.gold)) return "금이 나왔는데 라운드가 계속됨";
      if (!S.hands[S.turn].length) return "손패 없는 사람의 차례";
    }
    for (let p = 0; p < S.n; p++) {
      const b = S.broken[p];
      if (new Set(b).size !== b.length) return `${p}번 도구가 두 번 고장`;
      if (b.some(t => !TOOLS.includes(t))) return "잘못된 도구";
      if (S.hands[p].length > handSize(S.n)) return `${p}번 손패가 너무 많음`;
    }
    const [ns, nm] = ROLE_SET[S.n], sabs = S.roles.filter(r => r === "s").length;
    if (S.roles.length !== S.n || sabs > ns || S.n - sabs > nm) return "역할 수 이상";
    const total = S.gold.reduce((a, b) => a + b, 0);
    if (total < 0 || total > 4 * S.n * S.rounds) return "금 합계 이상";
    return true;
  },
  leak(S, p, v) {
    if (v.hands || v.peeks || v.hist || Array.isArray(v.deck)) return "숨은 정보 필드가 보임";
    const a = S.hands[p].slice().sort((x, y) => x - y).join(), b = (v.hand || []).map(c => c.id).sort((x, y) => x - y).join();
    if (a !== b) return "내 손패가 아닌 카드가 보임";
    if (S.phase === "play") {
      if (v.roles || v.res) return "라운드 중에 모든 역할이 보임";
      if (v.role !== S.roles[p]) return "내 역할이 틀림";
      for (let g = 0; g < 3; g++) {
        const gl = S.goals[g];
        if (gl.rev || S.peeks[p].includes(g)) continue;
        if (v.goals[g].kind !== null) return `모르는 목표 ${g} 의 정체가 보임`;
        const cell = v.board.find(c => c.k === "g" && c.g === g);
        if (!cell || cell.gold !== undefined || cell.e !== undefined) return `숨은 목표 ${g} 의 모양이 보임`;
      }
    }
    return true;
  },
  stepLimit: 5000
};
