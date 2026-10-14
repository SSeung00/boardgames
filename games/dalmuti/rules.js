/* 달무티 규칙 엔진 (ES 모듈) — C:\Users\user\dalmuti\web\engine.js 를 그대로 옮긴 것.
   규칙 · 난수 · 행동 번호가 원본과 한 줄씩 같아야 한다 (games/dalmuti/test_port.mjs 가 대조한다).
   원본을 고치면 이 파일도 같이 고칠 것. 화면 · 소리 · DOM 과 무관한 순수 규칙.

   카드는 개별 객체가 아니라 숫자별 장수로 다룬다. hands[p][r] = 플레이어 p 가 가진 숫자 r 카드 수.
   r = 1..12 는 일반 카드, r = 13 은 광대(와일드). 인덱스 0 은 쓰지 않는다. */

export const JESTER = 13;
export const TOTAL = r => r === JESTER ? 2 : r;
/* 계급 코드: 0 평민(첫 라운드) · 1 대달무티 · 2 소달무티 · 3 상인 · 4 소농노 · 5 대농노 */
export const T = { NONE: 0, GD: 1, LD: 2, MER: 3, LP: 4, GP: 5 };

/* ---------- 행동 목록 (고정 237개) ----------
   0 = 패스. 그다음 (숫자 r, 그 숫자 카드 k장, 광대 j장) 을 r → k → j 순으로, 끝에 광대만 1·2장. */
export const ACTIONS = [{ id: 0, pass: true, rank: 0, plain: 0, jesters: 0, count: 0 }];
for (let r = 1; r <= 12; r++)
  for (let k = 1; k <= r; k++)
    for (let j = 0; j <= 2; j++)
      ACTIONS.push({ id: ACTIONS.length, pass: false, rank: r, plain: k, jesters: j, count: k + j });
for (let j = 1; j <= 2; j++)
  ACTIONS.push({ id: ACTIONS.length, pass: false, rank: JESTER, plain: 0, jesters: j, count: j });
const ACTION_INDEX = new Map();
ACTIONS.forEach(a => ACTION_INDEX.set(a.rank * 100 + a.plain * 3 + a.jesters, a.id));
export function actionId(r, k, j) {
  const id = ACTION_INDEX.get(r * 100 + k * 3 + j);
  if (id === undefined) throw new Error(`없는 행동: ${r}/${k}/${j}`);
  return id;
}

/* ---------- 난수 (mulberry32) — 상태를 G.rs 에 담아 저장·재현이 가능하다 ----------
   원본과 같게 G.rs 를 부호 있는 32비트(| 0)로 둔다 (core/rng.js 와 같은 수열이지만 저장 형태가 다르다) */
export function rand(G) {
  G.rs = (G.rs + 0x6D2B79F5) | 0;
  let t = Math.imul(G.rs ^ (G.rs >>> 15), 1 | G.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffle(G, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(G) * (i + 1));
    const x = a[i]; a[i] = a[j]; a[j] = x;
  }
  return a;
}
export function newDeck() {
  const d = [];
  for (let r = 1; r <= 12; r++) for (let i = 0; i < r; i++) d.push(r);
  d.push(JESTER, JESTER);
  return d;
}
const zeros = n => new Array(n).fill(0);

export function titleCode(i, n) {
  if (i === 0) return T.GD;
  if (i === 1) return T.LD;
  if (i === n - 1) return T.GP;
  if (n > 3 && i === n - 2) return T.LP;
  return T.MER;
}

/* ---------- 게임 생성 ---------- */
export function create(opt) {
  const n = opt.n;
  return {
    v: 1, n, rounds: opt.rounds, round: 1, rs: opt.seed | 0,
    seats: [...Array(n).keys()],          // 앉은 순서 = 진행 순서
    titles: zeros(n), scores: zeros(n),
    hands: [...Array(n)].map(() => zeros(14)),
    played: zeros(14),
    trick: null,                          // {rank, count, plain, jesters, by}
    turn: 0,                              // seats 의 인덱스
    passStreak: 0,
    passed: new Array(n).fill(false),
    finish: [],
    phase: "draw",                        // draw → deal → (revolution → tax) → play → roundEnd → … → over
    reveal: null,                         // {p, great} 혁명으로 광대 2장이 공개된 사람
    firstLeader: null,
    lastAct: new Array(n).fill(null)      // 이번 판에서 각자 마지막으로 한 행동 (화면 표시용)
  };
}

export const handSize = (G, p) => { let s = 0; for (let r = 1; r <= 13; r++) s += G.hands[p][r]; return s; };
export const current = G => G.seats[G.turn];
export const seatOf = (G, p) => G.seats.indexOf(p);
export function nextWithCards(G, fromSeat) {
  for (let step = 1; step <= G.n; step++) {
    const s = (fromSeat + step) % G.n;
    if (handSize(G, G.seats[s]) > 0) return s;
  }
  return -1;
}

/* ---------- 자리 뽑기: 한 장씩 뽑아 낮은 숫자부터 앉는다 (광대 13이 가장 약하다) ---------- */
export function seatingDraw(G) {
  const deck = shuffle(G, newDeck());
  const draws = [];
  for (let p = 0; p < G.n; p++) draws.push({ p, rank: deck[p], tie: rand(G) });
  const order = draws.slice().sort((a, b) => a.rank - b.rank || a.tie - b.tie).map(d => d.p);
  G.seats = order;
  G.firstLeader = order[0];
  G.phase = "deal";
  return { draws: draws.map(d => ({ p: d.p, rank: d.rank })), order };
}

/* ---------- 딜 ---------- */
function resetTrick(G) {
  G.trick = null;
  G.passStreak = 0;
  G.passed.fill(false);
  G.lastAct.fill(null);
}
export function deal(G) {
  for (let p = 0; p < G.n; p++) G.hands[p] = zeros(14);
  G.played = zeros(14);
  G.finish = [];
  G.reveal = null;
  resetTrick(G);
  if (G.round > 1) G.seats.forEach((p, i) => { G.titles[p] = titleCode(i, G.n); });
  else G.titles.fill(T.NONE);
  const deck = shuffle(G, newDeck());
  deck.forEach((r, i) => { G.hands[G.seats[i % G.n]][r]++; });
  if (G.round > 1) G.phase = "revolution";
  else toPlay(G);
}
export function toPlay(G) {
  G.phase = "play";
  const leader = G.round === 1 ? G.firstLeader : G.seats[0];
  G.turn = seatOf(G, leader);
  resetTrick(G);
}

/* ---------- 혁명 ---------- */
export function revolutionCandidate(G) {
  for (let p = 0; p < G.n; p++) if (G.hands[p][JESTER] === 2) return p;
  return -1;
}
export function declareRevolution(G, p) {
  const great = G.titles[p] === T.GP;
  G.reveal = { p, great };
  if (great) {
    G.seats.reverse();
    G.seats.forEach((q, i) => { G.titles[q] = titleCode(i, G.n); });
  }
  toPlay(G);
  return { great };
}
export function skipRevolution(G) { G.phase = "tax"; }

/* ---------- 세금 ---------- */
export function taxPairs(G) {
  const by = t => G.seats.find(p => G.titles[p] === t);
  const out = [];
  const gp = by(T.GP), gd = by(T.GD), lp = by(T.LP), ld = by(T.LD);
  if (gp !== undefined && gd !== undefined && gp !== gd) out.push({ peon: gp, lord: gd, k: 2 });
  if (lp !== undefined && ld !== undefined && lp !== ld) out.push({ peon: lp, lord: ld, k: 1 });
  return out;
}
/* 농노는 가장 낮은 숫자부터 바친다 — 광대는 13이라 사실상 바칠 일이 없다 */
export function tribute(G, peon, k) {
  const out = [];
  for (let r = 1; r <= 13 && out.length < k; r++)
    for (let c = G.hands[peon][r]; c > 0 && out.length < k; c--) out.push(r);
  return out;
}
/* 달무티 기본 하사: 가장 약한 일반 카드부터, 광대는 마지막까지 쥔다 */
export function giveBackDefault(G, lord, k) {
  const out = [];
  for (let r = 12; r >= 1 && out.length < k; r--)
    for (let c = G.hands[lord][r]; c > 0 && out.length < k; c--) out.push(r);
  for (let c = G.hands[lord][JESTER]; c > 0 && out.length < k; c--) out.push(JESTER);
  return out;
}
export function transfer(G, from, to, ranks) {
  const need = zeros(14);
  ranks.forEach(r => need[r]++);
  for (let r = 1; r <= 13; r++) if (need[r] > G.hands[from][r]) throw new Error("가진 것보다 많이 넘길 수 없다");
  ranks.forEach(r => { G.hands[from][r]--; G.hands[to][r]++; });
}
export function finishTax(G) { toPlay(G); }

/* ---------- 합법수 ---------- */
export function legal(G) {
  const p = current(G), h = G.hands[p], J = h[JESTER], out = [];
  if (!G.trick) {
    for (let r = 1; r <= 12; r++)
      for (let k = 1; k <= h[r]; k++)
        for (let j = 0; j <= J; j++) out.push(actionId(r, k, j));
    for (let j = 1; j <= J; j++) out.push(actionId(JESTER, 0, j));
    return out;
  }
  out.push(0);
  const t = G.trick;
  for (let r = 1; r < t.rank && r <= 12; r++)
    for (let k = 1; k <= h[r] && k <= t.count; k++) {
      const j = t.count - k;
      if (j <= J) out.push(actionId(r, k, j));
    }
  return out;
}
export function isLegal(G, id) {
  const a = ACTIONS[id], h = G.hands[current(G)];
  if (!a) return false;
  if (a.pass) return !!G.trick;
  if (a.rank !== JESTER && h[a.rank] < a.plain) return false;
  if (h[JESTER] < a.jesters) return false;
  if (!G.trick) return true;
  return a.rank !== JESTER && a.count === G.trick.count && a.rank < G.trick.rank;
}

/* ---------- 한 수 두기 ---------- */
export function act(G, id) {
  if (G.phase !== "play") throw new Error("지금은 낼 차례가 아니다");
  if (!isLegal(G, id)) throw new Error("규칙에 맞지 않는 수: " + id);
  const p = current(G), a = ACTIONS[id];
  const ev = { player: p, id, type: a.pass ? "pass" : "play" };

  if (a.pass) {
    G.passStreak++;
    G.passed[p] = true;
    G.lastAct[p] = { pass: true };
  } else {
    if (a.rank !== JESTER) { G.hands[p][a.rank] -= a.plain; G.played[a.rank] += a.plain; }
    G.hands[p][JESTER] -= a.jesters;
    G.played[JESTER] += a.jesters;
    G.trick = { rank: a.rank, count: a.count, plain: a.plain, jesters: a.jesters, by: p };
    G.passStreak = 0;
    G.passed.fill(false);
    G.lastAct[p] = { rank: a.rank, count: a.count, jesters: a.jesters };
    if (handSize(G, p) === 0) {
      G.finish.push(p);
      ev.finished = G.finish.length;
    }
  }

  const holders = G.seats.filter(q => handSize(G, q) > 0);
  if (holders.length <= 1) {
    if (holders.length === 1) { G.finish.push(holders[0]); ev.last = holders[0]; }
    G.phase = "roundEnd";
    ev.roundEnd = true;
    return ev;
  }
  if (G.trick) {
    const owner = G.trick.by, ownerHas = handSize(G, owner) > 0;
    // 공식 룰: 마지막에 낸 사람을 뺀 전원이 연속으로 패스하면 판이 끝난다
    if (G.passStreak >= holders.length - (ownerHas ? 1 : 0)) {
      const ws = seatOf(G, owner);
      G.turn = ownerHas ? ws : nextWithCards(G, ws);
      ev.trickEnd = { winner: owner, leader: G.seats[G.turn] };
      resetTrick(G);
      return ev;
    }
  }
  G.turn = nextWithCards(G, G.turn);
  return ev;
}

/* ---------- 라운드 정산 ---------- */
export function endRound(G) {
  const points = G.finish.map((p, i) => G.n - i);
  G.finish.forEach((p, i) => { G.scores[p] += G.n - i; });
  const summary = { round: G.round, finish: G.finish.slice(), points };
  G.seats = G.finish.slice();
  G.seats.forEach((p, i) => { G.titles[p] = titleCode(i, G.n); });
  G.round++;
  G.phase = G.round > G.rounds ? "over" : "deal";
  return summary;
}

/* ---------- 학습된 AI 용 인코딩 (원본 · python/dalmuti/engine.py 와 같아야 한다) ---------- */
export const OBS = 104, ACT = 21;
export function encodeObs(G, p) {
  const f = new Array(OBS).fill(0), h = G.hands[p], n = G.n;
  let o = 0;
  for (let r = 1; r <= 13; r++) f[o++] = h[r] / TOTAL(r);
  for (let r = 1; r <= 13; r++) f[o++] = G.played[r] / TOTAL(r);
  for (let r = 1; r <= 13; r++) f[o++] = (TOTAL(r) - G.played[r] - h[r]) / TOTAL(r);
  f[o + (G.trick ? G.trick.rank : 0)] = 1; o += 14;
  f[o++] = G.trick ? G.trick.count / 10 : 0;
  const me = seatOf(G, p);
  if (G.trick) f[o + (seatOf(G, G.trick.by) - me + n) % n] = 1;
  o += 8;
  for (let rel = 1; rel <= 7; rel++) {
    if (rel < n) {
      const q = G.seats[(me + rel) % n], s = handSize(G, q);
      f[o] = s / 20; f[o + 1] = s === 0 ? 1 : 0; f[o + 2] = G.passed[q] ? 1 : 0;
    }
    o += 3;
  }
  f[o + (n - 4)] = 1; o += 5;
  f[o + G.titles[p]] = 1; o += 6;
  if (G.reveal) f[o + (seatOf(G, G.reveal.p) - me + n) % n] = 1;
  o += 8;
  f[o++] = G.passStreak / 8;
  f[o++] = handSize(G, p) / 20;
  return f;
}
export function encodeAct(G, p, id) {
  const a = ACTIONS[id], f = new Array(ACT).fill(0), h = G.hands[p];
  if (a.pass) { f[0] = 1; return f; }
  f[a.rank] = 1;
  f[14] = a.count / 10;
  f[15] = a.plain / 12;
  f[16] = a.jesters / 2;
  const after = handSize(G, p) - a.count;
  f[17] = after / 20;
  f[18] = after === 0 ? 1 : 0;
  f[19] = a.rank === JESTER ? 0 : (h[a.rank] - a.plain) / 12;
  f[20] = G.trick ? 0 : 1;
  return f;
}

export const clone = G => JSON.parse(JSON.stringify(G));

const api = {
  JESTER, TOTAL, T, ACTIONS, OBS, ACT,
  actionId, rand, shuffle, newDeck, titleCode,
  create, clone, handSize, current, seatOf, nextWithCards,
  seatingDraw, deal, toPlay,
  revolutionCandidate, declareRevolution, skipRevolution,
  taxPairs, tribute, giveBackDefault, transfer, finishTax,
  legal, isLegal, act, endRound,
  encodeObs, encodeAct
};
export default api;
