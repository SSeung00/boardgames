/* 보석 상인 — 보석 토큰을 모아 개발 카드를 사고, 카드의 보너스(영구 할인)로 더 비싼 카드를 사며 점수를 쌓는다.
   카드 90장(1단계 40 · 2단계 30 · 3단계 20)과 귀인 10명은 이 놀이방이 직접 만든 표다.
   색 기호: w 다이아몬드 · b 사파이어 · g 에메랄드 · r 루비 · k 오닉스 · y 황금(만능). */
import { shuffle, randInt, shuffleWith } from "../../core/rng.js";

export const COLORS = ["w", "b", "g", "r", "k"];
export const ALL = [...COLORS, "y"];
export const CNAME = { w: "다이아몬드", b: "사파이어", g: "에메랄드", r: "루비", k: "오닉스", y: "황금" };
const MAX_TOK = 10, MAX_RES = 3, MAX_ROUNDS = 80, GOLD_N = 5;
const zero5 = () => ({ w: 0, b: 0, g: 0, r: 0, k: 0 });
const zero6 = () => ({ w: 0, b: 0, g: 0, r: 0, k: 0, y: 0 });
const tokSum = t => t.w + t.b + t.g + t.r + t.k + t.y;

/* ---------- 카드 표 ----------
   틀 하나 = [점수, 자기 색, +1, +2, +3, +4 번째 색의 비용]. 색 순서(w→b→g→r→k)를 한 칸씩 돌려
   다섯 색에 똑같이 적용한다 — 어느 색도 유리하지 않고, 색마다 요구되는 보석 총량이 같다. */
const TIERS = [
  [ // 1단계 (색마다 8장): 비용 합 3~5, 한 색 4개짜리만 1점
    [0, 0, 1, 1, 1, 1], [0, 0, 1, 1, 2, 0], [0, 0, 0, 1, 1, 1], [0, 0, 0, 0, 1, 2],
    [0, 0, 2, 0, 2, 1], [0, 1, 1, 0, 0, 2], [0, 0, 0, 3, 1, 1], [1, 0, 0, 0, 0, 4]
  ],
  [ // 2단계 (색마다 6장): 1~3점, 비용 합 5~8, 자기 색 6개짜리 3점
    [1, 0, 3, 2, 0, 2], [1, 2, 0, 0, 3, 3], [2, 0, 0, 0, 5, 0],
    [2, 0, 1, 4, 0, 2], [2, 0, 0, 3, 0, 5], [3, 6, 0, 0, 0, 0]
  ],
  [ // 3단계 (색마다 4장): 3~5점, 비용 합 7~13
    [3, 2, 3, 0, 4, 4], [4, 0, 7, 0, 0, 0], [4, 3, 0, 6, 0, 3], [5, 0, 0, 4, 6, 0]
  ]
];
export const CARDS = [];
TIERS.forEach((tpls, ti) => COLORS.forEach((c, ci) => tpls.forEach(tp => {
  const cost = zero5();
  for (let k = 0; k < 5; k++) cost[COLORS[(ci + k) % 5]] = tp[k + 1];
  CARDS.push({ id: CARDS.length, t: ti + 1, c, pt: tp[0], cost });
})));
const N_CARDS = CARDS.length;   // 90

/* 귀인 10명 (각 3점): 한 칸 건너 두 색 4+4 다섯 명, 세 색 3+3+3 다섯 명 */
const NOBLE_NAMES = ["왕비", "공작", "대상인", "선장", "대학자", "장군", "백작 부인", "왕자", "궁정 화가", "영주"];
export const NOBLES = [];
COLORS.forEach((c, i) => {
  const req = zero5(); req[c] = 4; req[COLORS[(i + 2) % 5]] = 4;
  NOBLES.push({ id: NOBLES.length, name: NOBLE_NAMES[NOBLES.length], req });
});
COLORS.forEach((c, i) => {
  const req = zero5(); req[c] = 3; req[COLORS[(i + 1) % 5]] = 3; req[COLORS[(i + 3) % 5]] = 3;
  NOBLES.push({ id: NOBLES.length, name: NOBLE_NAMES[NOBLES.length], req });
});

/* ---------- 계산 도우미 (화면도 같이 쓴다) ---------- */
/* 살 수 있으면 낼 보석 {w..y}, 아니면 null. 같은 색 보석을 먼저 쓰고 모자란 만큼 황금 */
export function payFor(tok, bon, card) {
  const pay = zero6();
  let gold = 0;
  for (const c of COLORS) {
    const need = Math.max(0, card.cost[c] - (bon[c] || 0));
    const use = Math.min(need, tok[c] || 0);
    pay[c] = use; gold += need - use;
  }
  if (gold > (tok.y || 0)) return null;
  pay.y = gold;
  return pay;
}
export const qualifies = (bon, N) => COLORS.every(c => (bon[c] || 0) >= N.req[c]);
const nobleRem = (bon, N) => { let r = 0; for (const c of COLORS) r += Math.max(0, N.req[c] - bon[c]); return r; };
const tokText = t => ALL.filter(c => t[c]).map(c => CNAME[c] + (t[c] > 1 ? ` ${t[c]}` : "")).join("·");

function findMarket(S, id) {
  for (let t = 0; t < 3; t++) { const i = S.market[t].indexOf(id); if (i >= 0) return [t, i]; }
  return null;
}
function refill(S, t, i) {
  const d = S.decks[t];
  const id = d.length ? d.pop() : null;
  S.market[t][i] = id;
  if (id !== null) S.fresh.push(id);
}
function combos(arr, k) {
  const out = [];
  (function rec(i, cur) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1, cur); cur.pop(); }
  })(0, []);
  return out;
}
const isId = x => Number.isInteger(x) && x >= 0 && x < N_CARDS;

/* 지금 둘 수 있는 모든 행동 */
function legalMoves(S, p) {
  const P = S.players[p], out = [];
  const avail = COLORS.filter(c => S.bank[c] > 0);
  const k = Math.min(3, avail.length);
  if (k) for (const cs of combos(avail, k)) out.push({ take: Object.fromEntries(cs.map(c => [c, 1])) });
  for (const c of COLORS) if (S.bank[c] >= 4) out.push({ take: { [c]: 2 } });
  if (P.res.length < MAX_RES) {
    for (const row of S.market) for (const id of row) if (id !== null) out.push({ reserve: id });
    for (let t = 0; t < 3; t++) if (S.decks[t].length) out.push({ reserveDeck: t + 1 });
  }
  for (const row of S.market) for (const id of row) if (id !== null && payFor(P.tok, P.bon, CARDS[id])) out.push({ buy: id });
  for (const r of P.res) if (payFor(P.tok, P.bon, CARDS[r.id])) out.push({ buy: r.id });
  return out;
}
function hasMove(S, p) {
  const P = S.players[p];
  if (COLORS.some(c => S.bank[c] > 0)) return true;
  if (P.res.length < MAX_RES && (S.market.some(row => row.some(x => x !== null)) || S.decks.some(d => d.length))) return true;
  for (const row of S.market) for (const id of row) if (id !== null && payFor(P.tok, P.bon, CARDS[id])) return true;
  return P.res.some(r => payFor(P.tok, P.bon, CARDS[r.id]));
}

/* ---------- 차례 진행 ---------- */
function afterMain(S, p, ev) {
  if (tokSum(S.players[p].tok) > MAX_TOK) { S.sub = "discard"; return; }
  nobleCheck(S, p, ev);
}
function nobleCheck(S, p, ev) {
  const P = S.players[p];
  const q = S.nobles.filter(id => qualifies(P.bon, NOBLES[id]));
  if (q.length > 1) { S.sub = "noble"; return; }
  if (q.length === 1) visit(S, p, q[0], ev);
  endTurn(S, p, ev);
}
function visit(S, p, id, ev) {
  const P = S.players[p];
  S.nobles.splice(S.nobles.indexOf(id), 1);
  P.nobles.push(id); P.pts += 3;
  if (S.last && S.last.p === p) S.last.noble = id;
  ev.push({ type: "noble", p, noble: id, toast: true, text: `{${p}} 님에게 귀인 ‘${NOBLES[id].name}’이(가) 찾아왔습니다 (+3점)` });
}
function endTurn(S, p, ev) {
  S.sub = null;
  const P = S.players[p];
  if (!S.final && P.pts >= S.goal) {
    S.final = true; S.trigger = p;
    const lastOne = (S.start + S.n - 1) % S.n;
    ev.push({ type: "final", p, toast: true, text: p === lastOne ? `{${p}} 님이 ${P.pts}점에 닿았습니다!` : `{${p}} 님이 ${P.pts}점! 이번 바퀴를 마저 돌고 끝납니다` });
  }
  S.turns++;
  S.turn = (p + 1) % S.n;
  if (S.turn === S.start) {
    if (S.final) return finish(S, ev, "goal");
    S.round++;
    if (S.round > MAX_ROUNDS) return finish(S, ev, "rounds");
  }
}
function standings(S) {
  return S.players.map((P, p) => {
    const better = S.players.filter(Q => Q.pts > P.pts || (Q.pts === P.pts && Q.cards.length < P.cards.length)).length;
    return { p, rank: better + 1 };
  });
}
function finish(S, ev, why) {
  S.phase = "over"; S.sub = null; S.why = why;
  const top = standings(S).filter(x => x.rank === 1).map(x => `{${x.p}}`);
  const head = why === "stuck" ? "아무도 둘 수 없어 게임이 멈췄습니다 — " : why === "rounds" ? `${MAX_ROUNDS}바퀴가 지나 끝납니다 — ` : "게임 끝 — ";
  ev.push({ type: "over", text: head + (top.length > 1 ? `${top.join(", ")} 님 공동 1등` : `${top[0]} 님 승리!`) });
}

/* =====================================================================
   AI — 상태 S 를 바꾸지 않는다. 내 자리만 본뜬 작은 '상상 상태' s 위에서 행동을 굴려 보고
   잠재 가치 phi(s) 가 가장 큰 행동을 고른다.
   phi = 점수 + 보너스 가치 + 귀인 가능성 + (가까운 목표 카드 가치 × 할인율^남은 차례) + 보석 조금
   ===================================================================== */
function simOf(S, p) {
  const P = S.players[p];
  return {
    tok: { ...P.tok }, bon: { ...P.bon }, pts: P.pts, res: P.res.map(r => r.id), ncards: P.cards.length,
    market: S.market.flat().filter(x => x !== null), nobles: S.nobles.slice(), bank: { ...S.bank }, decks: S.decks.map(d => d.length)
  };
}
const cloneSim = s => ({ tok: { ...s.tok }, bon: { ...s.bon }, pts: s.pts, res: s.res.slice(), ncards: s.ncards,
  market: s.market.slice(), nobles: s.nobles.slice(), bank: { ...s.bank }, decks: s.decks.slice() });

function makeCtx(S, p, level) {
  const maxPts = Math.max(...S.players.map(P => P.pts));
  const stage = Math.min(1, maxPts / S.goal);
  const ctx = {
    goal: S.goal, last: S.final, level,
    bw: 0.25 + 0.9 * (1 - stage),        // 보너스 한 장의 기본 가치(점수 단위) — 초반일수록 크다
    gam: 0.7, gn: 0.68, risk: 0.85, winB: 25, horizon: 10,
    race: level === "hard", oppRem: {}
  };
  if (ctx.race) for (const id of S.nobles) {
    let m = 99;
    S.players.forEach((Q, q) => { if (q !== p) m = Math.min(m, nobleRem(Q.bon, NOBLES[id])); });
    ctx.oppRem[id] = m;
  }
  return ctx;
}
/* 이 카드를 사기까지 보석 모으는 데 걸릴 차례 수 (어림) */
function turnsTo(card, s) {
  let def = 0, needTot = 0, lack = 0, slow = 0;
  const g = s.tok.y;
  for (const c of COLORS) {
    const need = Math.max(0, card.cost[c] - s.bon[c]);
    needTot += need;
    const d = Math.max(0, need - s.tok[c]);
    if (!d) continue;
    def += d;
    if (d > s.bank[c]) lack += d - s.bank[c];
    const per = s.bank[c] >= 4 ? 2 : 1;               // 한 차례에 그 색을 몇 개까지 가져올 수 있나
    slow = Math.max(slow, Math.ceil(Math.max(0, d - g) / per));
  }
  if (def <= g) return 0;
  let t = Math.max(Math.ceil((def - g) / 3), slow);
  if (lack > g) t += (lack - g) * 1.5;               // 은행에 없는 보석은 남이 돌려놓기를 기다려야 한다
  if (needTot > MAX_TOK) t += needTot - MAX_TOK + 1;  // 보석 10개로는 못 사는 카드 — 보너스가 더 필요하다
  return t;
}
function noblePot(bon, nobles, ctx) {
  let a = 0, b = 0, c3 = 0;
  for (const id of nobles) {
    const rem = nobleRem(bon, NOBLES[id]);
    let v = 3 * Math.pow(ctx.gn, rem);
    if (ctx.race && ctx.oppRem[id] < rem) v *= 0.45;   // 남이 더 가까운 귀인은 덜 쫓는다
    if (v > a) { c3 = b; b = a; a = v; } else if (v > b) { c3 = b; b = v; } else if (v > c3) c3 = v;
  }
  return a + 0.35 * b + 0.15 * c3;
}
function phi(s, ctx) {
  let nt = tokSum(s.tok);
  if (ctx.last) return s.pts * 10 - s.ncards * 0.05 + nt * 0.001;   // 마지막 차례: 점수만 (같으면 카드 적게)
  let v = s.pts + (s.pts >= ctx.goal ? ctx.winB + (s.pts - ctx.goal) : 0);
  let nb = 0;
  for (const c of COLORS) nb += s.bon[c];
  v += nb * ctx.bw;
  const np = noblePot(s.bon, s.nobles, ctx);
  v += np;
  const nd = {};
  for (const c of COLORS) { s.bon[c]++; nd[c] = noblePot(s.bon, s.nobles, ctx) - np; s.bon[c]--; }
  let t1 = 0, t2 = 0, t3 = 0;
  const consider = (id, risk) => {
    const C = CARDS[id], t = turnsTo(C, s);
    if (t > ctx.horizon) return;
    let val = C.pt + ctx.bw + nd[C.c];
    if (s.pts < ctx.goal && s.pts + C.pt >= ctx.goal) val += ctx.winB * 0.5;
    val *= Math.pow(ctx.gam, t + 1) * risk;
    if (val > t1) { t3 = t2; t2 = t1; t1 = val; } else if (val > t2) { t3 = t2; t2 = val; } else if (val > t3) t3 = val;
  };
  for (const id of s.market) consider(id, ctx.risk);
  for (const id of s.res) if (id >= 0) consider(id, 1);
  v += t1 + 0.4 * t2 + 0.2 * t3;
  v += nt * 0.1 + s.tok.y * 0.15 - s.res.length * 0.25;
  return v;
}
/* 10개를 넘는 만큼 덜 아까운 보석부터 버린다 (s 를 바꾼다) → 버린 것 */
function bestDiscard(s, k, ctx) {
  const d = zero6();
  for (let i = 0; i < k; i++) {
    let best = null, bv = -Infinity;
    for (const c of ALL) {
      if (!s.tok[c]) continue;
      s.tok[c]--; s.bank[c]++;
      const v = phi(s, ctx) - (c === "y" ? 0.5 : 0);
      s.tok[c]++; s.bank[c]--;
      if (v > bv) { bv = v; best = c; }
    }
    s.tok[best]--; s.bank[best]++; d[best]++;
  }
  return d;
}
function quickDiscard(s, k) {
  const d = zero6();
  for (let i = 0; i < k; i++) {
    let best = "y", bn = 0;
    for (const c of COLORS) if (s.tok[c] > bn) { bn = s.tok[c]; best = c; }
    s.tok[best]--; s.bank[best]++; d[best]++;
  }
  return d;
}
function simApply(s, a, ctx, quick) {
  if (a.take) {
    for (const c in a.take) { s.tok[c] += a.take[c]; s.bank[c] -= a.take[c]; }
  } else if (a.reserve !== undefined) {
    s.market.splice(s.market.indexOf(a.reserve), 1); s.res.push(a.reserve);
    if (s.bank.y > 0) { s.bank.y--; s.tok.y++; }
  } else if (a.reserveDeck !== undefined) {
    s.decks[a.reserveDeck - 1]--; s.res.push(-1);         // 무슨 카드가 나올지는 모른다
    if (s.bank.y > 0) { s.bank.y--; s.tok.y++; }
  } else if (a.buy !== undefined) {
    const C = CARDS[a.buy], pay = payFor(s.tok, s.bon, C);
    for (const c of ALL) { s.tok[c] -= pay[c]; s.bank[c] += pay[c]; }
    s.bon[C.c]++; s.pts += C.pt; s.ncards++;
    const i = s.market.indexOf(a.buy);
    if (i >= 0) s.market.splice(i, 1); else s.res.splice(s.res.indexOf(a.buy), 1);
  }
  const over = tokSum(s.tok) - MAX_TOK;
  if (over > 0) quick ? quickDiscard(s, over) : bestDiscard(s, over, ctx);
  const q = s.nobles.find(id => qualifies(s.bon, NOBLES[id]));
  if (q !== undefined) { s.nobles.splice(s.nobles.indexOf(q), 1); s.pts += 3; }
  return s;
}
function simMoves(s) {
  const out = [];
  const avail = COLORS.filter(c => s.bank[c] > 0), k = Math.min(3, avail.length);
  if (k) for (const cs of combos(avail, k)) out.push({ take: Object.fromEntries(cs.map(c => [c, 1])) });
  for (const c of COLORS) if (s.bank[c] >= 4) out.push({ take: { [c]: 2 } });
  for (const id of s.market) if (payFor(s.tok, s.bon, CARDS[id])) out.push({ buy: id });
  for (const id of s.res) if (id >= 0 && payFor(s.tok, s.bon, CARDS[id])) out.push({ buy: id });
  return out;
}
/* 막아야 할 카드: 다음 차례 안에 상대가 사서 승리 점수에 닿는(또는 hard: 크게 다가가는) 펼쳐진 카드 → 가산점 */
function threats(S, p, level) {
  const out = new Map();
  for (let k = 1; k < S.n; k++) {
    const q = (p + k) % S.n;
    if (S.final && (q === S.start || ((q - S.start + S.n) % S.n) < ((p - S.start + S.n) % S.n))) continue;   // 이번 판에 더 둘 차례가 없다
    const Q = S.players[q], wins = [], near = [];
    let winByRes = false;
    for (const r of Q.res) {
      if (r.blind) continue;                                            // 남의 비공개 찜은 모른다
      const C = CARDS[r.id];
      if (payFor(Q.tok, Q.bon, C) && Q.pts + C.pt + nobleGain(S, Q.bon, C.c) >= S.goal) winByRes = true;
    }
    for (const row of S.market) for (const id of row) {
      if (id === null) continue;
      const C = CARDS[id];
      if (!payFor(Q.tok, Q.bon, C)) continue;
      const gain = C.pt + nobleGain(S, Q.bon, C.c);
      if (Q.pts + gain >= S.goal) wins.push(id);
      else if (level === "hard" && gain >= 3 && Q.pts + gain >= S.goal - 3) near.push(id);
    }
    const w = (k === 1 ? 1 : 0.8);
    if (!winByRes) {
      if (wins.length === 1) out.set(wins[0], (out.get(wins[0]) || 0) + 9 * w);
      else if (wins.length > 1 && level !== "hard") for (const id of wins) out.set(id, (out.get(id) || 0) + 3 * w);
    }
    for (const id of near) out.set(id, (out.get(id) || 0) + 1.2 * w);
  }
  return out;
}
function nobleGain(S, bon, c) {
  const b2 = { ...bon }; b2[c]++;
  return S.nobles.some(id => !qualifies(bon, NOBLES[id]) && qualifies(b2, NOBLES[id])) ? 3 : 0;
}

function aiTurn(S, p, level, rng) {
  const moves = legalMoves(S, p);
  if (level === "easy" && rng() < 0.2) {           // 쉬움: 가끔은 그냥 아무 보석이나
    const takes = moves.filter(a => a.take);
    if (takes.length) return takes[Math.floor(rng() * takes.length)];
  }
  const ctx = makeCtx(S, p, level), base = simOf(S, p);
  const block = level === "easy" ? new Map() : threats(S, p, level);
  const scored = moves.map(a => {
    const s = simApply(cloneSim(base), a, ctx, false);
    let v = phi(s, ctx);
    if (a.reserve !== undefined && block.has(a.reserve)) v += block.get(a.reserve) * (ctx.last ? 10 : 1);
    return { a, s, v };
  });
  if (level === "hard" && !ctx.last) {             // 어려움: 두 차례 앞을 본다 (내 다음 행동까지)
    scored.sort((x, y) => y.v - x.v);
    for (const x of scored.slice(0, 6)) {
      let v2 = -Infinity;
      for (const a2 of simMoves(x.s)) v2 = Math.max(v2, phi(simApply(cloneSim(x.s), a2, ctx, true), ctx));
      const bonus = x.a.reserve !== undefined && block.has(x.a.reserve) ? block.get(x.a.reserve) : 0;
      x.v = v2 === -Infinity ? x.v : 0.3 * (x.v - bonus) + 0.7 * v2 + bonus;
    }
    for (const x of scored.slice(6)) x.v -= 1000;
  }
  const noise = level === "easy" ? 2.5 : 0.04;
  let best = null, bv = -Infinity;
  for (const x of scored) { const v = x.v + rng() * noise; if (v > bv) { bv = v; best = x.a; } }
  return best;
}
function aiDiscard(S, p, level, rng) {
  const P = S.players[p], k = tokSum(P.tok) - MAX_TOK;
  const s = simOf(S, p);
  if (level === "easy" && rng() < 0.3) return { discard: quickDiscard(s, k) };
  return { discard: bestDiscard(s, k, makeCtx(S, p, level)) };
}
function aiNoble(S, p) {
  const q = S.nobles.filter(id => qualifies(S.players[p].bon, NOBLES[id]));
  // 다른 사람이 가장 가까이 와 있는 귀인을 데려온다 (빼앗기)
  let best = q[0], bm = 99;
  for (const id of q) {
    let m = 99;
    S.players.forEach((Q, k) => { if (k !== p) m = Math.min(m, nobleRem(Q.bon, NOBLES[id])); });
    if (m < bm) { bm = m; best = id; }
  }
  return { noble: best };
}

/* ---------- 보이는 정보 ---------- */
const cardV = id => (id === null || id === undefined ? null : { id, t: CARDS[id].t, c: CARDS[id].c, pt: CARDS[id].pt, cost: { ...CARDS[id].cost } });
const nobleV = id => ({ id, name: NOBLES[id].name, req: { ...NOBLES[id].req } });

export default {
  id: "gems",
  name: "보석 상인",
  icon: "💎",
  blurb: "보석을 모아 카드를 사고, 카드 보너스로 점점 싸게! 귀인을 모시고 먼저 승리 점수에 닿으세요.",
  players: { min: 2, max: 4, default: 3 },
  settings: [
    { key: "goal", label: "승리 점수", values: [15, 21], labels: ["15점", "21점"], default: 15, note: "누군가 닿으면 그 바퀴를 마저 돌고 끝납니다" }
  ],
  rules: `<ul>
    <li>보석은 다섯 가지 — <b>다이아몬드</b>(흰색) · <b>사파이어</b>(파랑) · <b>에메랄드</b>(초록) · <b>루비</b>(빨강) · <b>오닉스</b>(검정), 그리고 만능인 <b>황금</b>. 색마다 2인 4개 · 3인 5개 · 4인 7개, 황금은 5개.</li>
    <li>카드는 1~3단계로 나뉘어 단계마다 4장씩 펼쳐져 있습니다. 카드마다 <b>점수</b>(왼쪽 위), <b>보너스 보석</b>(오른쪽 위), <b>비용</b>(아래)이 있습니다.</li>
    <li>내 차례에는 다음 중 <b>하나만</b> 합니다.
      <ul>
        <li><b>서로 다른 색 3개</b> 가져오기 (남은 색이 3가지보다 적을 때만 그만큼)</li>
        <li><b>같은 색 2개</b> 가져오기 — 그 색이 <b>4개 이상</b> 남아 있을 때만</li>
        <li><b>찜하기</b> — 펼쳐진 카드 또는 더미 맨 위 카드(남에게는 안 보임)를 가져다 두고, 황금이 남아 있으면 1개 받습니다. 찜은 <b>3장까지</b></li>
        <li><b>사기</b> — 펼쳐진 카드나 내가 찜한 카드. 가진 카드의 <b>보너스만큼 그 색 비용이 줄고</b>, 모자란 만큼 황금을 씁니다. 낸 보석은 은행으로 돌아가고 빈자리는 더미에서 채웁니다</li>
      </ul></li>
    <li>보석은 <b>10개까지</b>만 가질 수 있습니다. 넘으면 차례 끝에 10개가 되도록 고른 보석을 돌려놓습니다.</li>
    <li>보너스가 <b>귀인</b>의 조건(4+4 또는 3+3+3)을 채우면 차례 끝에 귀인이 찾아옵니다 (<b>3점</b>, 한 차례에 한 명 — 여럿이면 고릅니다).</li>
    <li>누군가 <b>승리 점수</b>에 닿으면 그 바퀴를 마저 돌아 모두 같은 횟수를 둔 뒤 끝납니다. 점수가 높은 순서, 같으면 <b>산 카드가 적은</b> 사람이 앞섭니다.</li>
  </ul>
  <h4>우리 규칙</h4>
  <ul>
    <li>살 때는 같은 색 보석을 먼저 쓰고 모자란 만큼만 황금을 씁니다 (자동 계산).</li>
    <li>할 수 있는 행동이 하나도 없으면 차례를 넘깁니다. 모두가 한 바퀴 내내 넘기거나 ${MAX_ROUNDS}바퀴가 지나면 그때 점수로 끝냅니다.</li>
  </ul>`,
  stepLimit: 5000,

  setup({ n, seed, settings }) {
    const goal = settings && [15, 21].includes(settings.goal) ? settings.goal : 15;
    const per = n <= 2 ? 4 : n === 3 ? 5 : 7;
    const S = {
      n, rs: seed >>> 0, goal, per, phase: "play", sub: null, turn: 0, start: 0, round: 1, turns: 0,
      final: false, trigger: -1, passes: 0, why: null, fresh: [], last: null,
      bank: { w: per, b: per, g: per, r: per, k: per, y: GOLD_N },
      decks: [], market: [], nobles: [], nobleN: n + 1, players: []
    };
    for (let t = 1; t <= 3; t++) S.decks.push(shuffle(S, CARDS.filter(c => c.t === t).map(c => c.id)));
    S.market = S.decks.map(d => [d.pop(), d.pop(), d.pop(), d.pop()]);
    S.nobles = shuffle(S, NOBLES.map(x => x.id)).slice(0, n + 1);
    for (let p = 0; p < n; p++) S.players.push({ tok: zero6(), bon: zero5(), cards: [], res: [], nobles: [], pts: 0 });
    S.start = randInt(S, n);
    S.turn = S.start;
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    if (S.sub) return [{ p: S.turn, kind: S.sub }];
    if (!hasMove(S, S.turn)) return [];          // 둘 수가 없으면 step 에서 넘긴다
    return [{ p: S.turn, kind: "turn" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== S.turn) return "지금은 내 차례가 아닙니다";
    if (!a || typeof a !== "object") return "행동을 고르세요";
    const P = S.players[p];
    if (S.sub === "discard") {
      const d = a.discard;
      if (!d || typeof d !== "object") return "돌려놓을 보석을 고르세요";
      let sum = 0;
      for (const c in d) {
        if (!ALL.includes(c)) return "알 수 없는 보석입니다";
        const x = d[c];
        if (!Number.isInteger(x) || x < 0) return "개수가 잘못되었습니다";
        if (x > P.tok[c]) return `${CNAME[c]} 보석이 그만큼 없습니다`;
        sum += x;
      }
      const need = tokSum(P.tok) - MAX_TOK;
      if (sum !== need) return `보석 ${need}개를 돌려놓아야 합니다`;
      return true;
    }
    if (S.sub === "noble") {
      if (!S.nobles.includes(a.noble) || !qualifies(P.bon, NOBLES[a.noble])) return "모실 수 있는 귀인을 고르세요";
      return true;
    }
    const keys = Object.keys(a).filter(k => ["take", "reserve", "reserveDeck", "buy"].includes(k));
    if (keys.length !== 1) return "행동 하나를 고르세요";
    if (keys[0] === "take") {
      const t = a.take;
      if (!t || typeof t !== "object") return "가져올 보석을 고르세요";
      const cs = Object.keys(t);
      if (!cs.length) return "가져올 보석을 고르세요";
      for (const c of cs) {
        if (c === "y") return "황금은 카드를 찜할 때만 받습니다";
        if (!COLORS.includes(c)) return "알 수 없는 보석입니다";
        if (!Number.isInteger(t[c]) || t[c] < 1) return "개수가 잘못되었습니다";
      }
      if (cs.length === 1 && t[cs[0]] === 2) {
        if (S.bank[cs[0]] < 4) return `같은 색 2개는 4개 이상 남아 있을 때만 가져올 수 있습니다 (${CNAME[cs[0]]} ${S.bank[cs[0]]}개)`;
        return true;
      }
      if (cs.some(c => t[c] !== 1)) return "서로 다른 색 3개 또는 같은 색 2개만 가져올 수 있습니다";
      for (const c of cs) if (S.bank[c] < 1) return `${CNAME[c]} 보석이 남아 있지 않습니다`;
      const avail = COLORS.filter(c => S.bank[c] > 0).length, need = Math.min(3, avail);
      if (cs.length !== need) return need === 3 ? "서로 다른 색 3개를 고르세요" : `남은 색이 ${avail}가지라 서로 다른 색 ${need}개를 가져옵니다`;
      return true;
    }
    if (keys[0] === "reserve") {
      if (!isId(a.reserve) || !findMarket(S, a.reserve)) return "펼쳐진 카드만 찜할 수 있습니다";
      if (P.res.length >= MAX_RES) return "찜은 3장까지입니다";
      return true;
    }
    if (keys[0] === "reserveDeck") {
      const t = a.reserveDeck;
      if (![1, 2, 3].includes(t)) return "더미를 고르세요";
      if (!S.decks[t - 1].length) return "더미가 비었습니다";
      if (P.res.length >= MAX_RES) return "찜은 3장까지입니다";
      return true;
    }
    const id = a.buy;
    if (!isId(id) || (!findMarket(S, id) && !P.res.some(r => r.id === id))) return "펼쳐진 카드나 내가 찜한 카드만 살 수 있습니다";
    if (!payFor(P.tok, P.bon, CARDS[id])) return "보석이 모자랍니다";
    return true;
  },

  apply(S, p, a) {
    const P = S.players[p], ev = [];
    if (S.sub === "discard") {
      const d = zero6();
      for (const c of ALL) { const x = a.discard[c] | 0; if (x) { P.tok[c] -= x; S.bank[c] += x; d[c] = x; } }
      if (S.last && S.last.p === p) S.last.discard = d;
      ev.push({ type: "discard", p, discard: d, text: `{${p}} 님이 보석 ${tokSum(d)}개를 돌려놓았습니다 (${tokText(d)})` });
      S.sub = null;
      nobleCheck(S, p, ev);
      return ev;
    }
    if (S.sub === "noble") {
      visit(S, p, a.noble, ev);
      endTurn(S, p, ev);
      return ev;
    }
    S.passes = 0; S.fresh = [];
    if (a.take) {
      const t = zero6();
      for (const c in a.take) { P.tok[c] += a.take[c]; S.bank[c] -= a.take[c]; t[c] = a.take[c]; }
      S.last = { p, type: "take", take: t };
      ev.push({ type: "take", p, take: t, text: `{${p}} 님이 보석을 가져왔습니다 — ${tokText(t)}` });
    } else if (a.reserve !== undefined) {
      const [t, i] = findMarket(S, a.reserve), C = CARDS[a.reserve];
      P.res.push({ id: a.reserve, blind: false });
      refill(S, t, i);
      const gold = S.bank.y > 0;
      if (gold) { S.bank.y--; P.tok.y++; }
      S.last = { p, type: "reserve", card: a.reserve, gold };
      ev.push({ type: "reserve", p, card: a.reserve, gold, text: `{${p}} 님이 ${C.t}단계 ${CNAME[C.c]} 카드${C.pt ? `(${C.pt}점)` : ""}를 찜했습니다${gold ? " · 황금 1개" : ""}` });
    } else if (a.reserveDeck !== undefined) {
      const t = a.reserveDeck, id = S.decks[t - 1].pop();
      P.res.push({ id, blind: true });
      const gold = S.bank.y > 0;
      if (gold) { S.bank.y--; P.tok.y++; }
      S.last = { p, type: "reserveDeck", tier: t, card: id, gold };
      ev.push({ type: "reserveDeck", p, tier: t, card: id, gold, text: `{${p}} 님이 ${t}단계 더미에서 한 장을 몰래 찜했습니다${gold ? " · 황금 1개" : ""}` });
    } else {
      const id = a.buy, C = CARDS[id], pay = payFor(P.tok, P.bon, C);
      for (const c of ALL) { P.tok[c] -= pay[c]; S.bank[c] += pay[c]; }
      const m = findMarket(S, id);
      if (m) refill(S, m[0], m[1]);
      else P.res.splice(P.res.findIndex(r => r.id === id), 1);
      P.cards.push(id); P.bon[C.c]++; P.pts += C.pt;
      S.last = { p, type: "buy", card: id, pay, from: m ? "market" : "res" };
      ev.push({ type: "buy", p, card: id, pay, from: m ? "market" : "res",
        text: `{${p}} 님이 ${m ? "" : "찜해 둔 "}${C.t}단계 ${CNAME[C.c]} 카드를 샀습니다${C.pt ? ` (+${C.pt}점)` : ""}` });
    }
    afterMain(S, p, ev);
    return ev;
  },

  /* pending 이 빈 경우는 '둘 수 있는 행동이 없음' 뿐 — 넘긴다 */
  step(S) {
    if (S.phase !== "play" || S.sub) return [];
    const p = S.turn, ev = [{ type: "pass", p, text: `{${p}} 님은 할 수 있는 행동이 없어 차례를 넘깁니다` }];
    S.fresh = [];
    S.last = { p, type: "pass" };
    S.passes++;
    if (S.passes >= S.n) { finish(S, ev, "stuck"); return ev; }
    endTurn(S, p, ev);
    return ev;
  },
  delay() { return 900; },

  timeout(S, p, kind) {
    if (kind === "discard") return aiDiscard(S, p, "normal", () => 0.5);
    if (kind === "noble") return aiNoble(S, p);
    return aiTurn(S, p, "normal", () => 0.5);
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.sub === "discard") return aiDiscard(S, p, level, rng);
    if (S.sub === "noble") return aiNoble(S, p);
    return aiTurn(S, p, level, rng);
  },
  thinkTime(S, p, kind) { return kind === "turn" ? 700 + Math.random() * 700 : 500 + Math.random() * 300; },

  view(S, p) {
    const last = S.last && S.last.type === "reserveDeck" && S.last.p !== p ? { ...S.last, card: null } : S.last;
    return {
      phase: S.phase, turn: S.turn, start: S.start, goal: S.goal, final: S.final, trigger: S.trigger, round: S.round,
      maxRounds: MAX_ROUNDS, sub: S.sub, why: S.why,
      bank: { ...S.bank },
      decks: S.decks.map(d => d.length),
      market: S.market.map(row => row.map(cardV)),          // [0] = 1단계
      nobles: S.nobles.map(nobleV),
      players: S.players.map((P, q) => ({
        pts: P.pts, tok: { ...P.tok }, bon: { ...P.bon }, ncards: P.cards.length,
        nobles: P.nobles.map(nobleV),
        res: P.res.map(r => (q === p || !r.blind) ? { ...cardV(r.id), blind: r.blind } : { t: CARDS[r.id].t, hidden: true })
      })),
      fresh: S.fresh.slice(),
      last: last ? { ...JSON.parse(JSON.stringify(last)), cv: isId(last.card) ? cardV(last.card) : null } : null,
      status: S.phase === "over" ? "게임 끝"
        : p === S.turn ? (S.sub === "discard" ? "보석 돌려놓기" : S.sub === "noble" ? "귀인 고르기" : S.final ? "내 차례 — 마지막 차례!" : "내 차례") : ""
    };
  },

  /* 더미에서 몰래 찜한 카드는 본인만 안다 */
  filterEvent(ev, p) {
    if (ev.type === "reserveDeck" && p !== ev.p) return { ...ev, card: null };
    return ev;
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return standings(S).map(({ p, rank }) => {
      const P = S.players[p];
      return { p, rank, score: P.pts, note: `카드 ${P.cards.length}장${P.nobles.length ? ` · 귀인 ${P.nobles.length}` : ""}` };
    });
  },

  /* ---------- 시험용 ---------- */
  randomAction(S, p, rng, kind) {
    const P = S.players[p];
    if (S.sub === "discard") {
      const d = zero6(), bag = [];
      for (const c of ALL) for (let i = 0; i < P.tok[c]; i++) bag.push(c);
      shuffleWith(rng, bag);
      for (let i = 0; i < tokSum(P.tok) - MAX_TOK; i++) d[bag[i]]++;
      return { discard: d };
    }
    if (S.sub === "noble") {
      const q = S.nobles.filter(id => qualifies(P.bon, NOBLES[id]));
      return { noble: q[Math.floor(rng() * q.length)] };
    }
    const moves = legalMoves(S, p);
    const buys = moves.filter(a => a.buy !== undefined);
    if (buys.length && rng() < 0.5) return buys[Math.floor(rng() * buys.length)];
    return moves[Math.floor(rng() * moves.length)];
  },
  check(S) {
    for (const c of ALL) {
      let t = S.bank[c];
      if (t < 0) return `은행 ${c} 가 음수`;
      for (const P of S.players) { if (P.tok[c] < 0) return `${c} 보석이 음수`; t += P.tok[c]; }
      const init = c === "y" ? GOLD_N : S.per;
      if (t !== init) return `${CNAME[c]} 총수 ${t} ≠ ${init}`;
    }
    const seen = new Set();
    let dup = null;
    const add = id => { if (!isId(id) || seen.has(id)) dup = id; seen.add(id); };
    S.decks.forEach(d => d.forEach(add));
    S.market.forEach((row, t) => row.forEach(id => { if (id !== null) { add(id); if (CARDS[id].t !== t + 1) dup = `단계 ${id}`; } }));
    for (const P of S.players) { P.cards.forEach(add); P.res.forEach(r => add(r.id)); }
    if (dup !== null) return `카드 중복 · 이상: ${dup}`;
    if (seen.size !== N_CARDS) return `카드 수 ${seen.size} ≠ ${N_CARDS}`;
    for (let t = 0; t < 3; t++) if (S.market[t].length !== 4 || (S.market[t].includes(null) && S.decks[t].length)) return `${t + 1}단계 빈자리를 채우지 않음`;
    const nb = new Set(S.nobles);
    for (const P of S.players) P.nobles.forEach(id => nb.add(id));
    if (nb.size !== S.nobleN || S.nobles.length + S.players.reduce((a, P) => a + P.nobles.length, 0) !== S.nobleN) return "귀인 수가 맞지 않음";
    for (let q = 0; q < S.n; q++) {
      const P = S.players[q];
      if (P.res.length > MAX_RES) return `찜 ${P.res.length}장`;
      if (tokSum(P.tok) > MAX_TOK && !(S.sub === "discard" && S.turn === q)) return `${q}번 보석 ${tokSum(P.tok)}개 (10개 초과)`;
      const bon = zero5(); let pts = 3 * P.nobles.length;
      for (const id of P.cards) { bon[CARDS[id].c]++; pts += CARDS[id].pt; }
      if (COLORS.some(c => bon[c] !== P.bon[c])) return "보너스 계산이 틀림";
      if (pts !== P.pts) return `점수 ${P.pts} ≠ ${pts}`;
    }
    return true;
  },
  leak(S, p, v) {
    const hidden = new Set();
    S.decks.forEach(d => d.forEach(id => hidden.add(id)));
    S.players.forEach((P, q) => { if (q !== p) P.res.forEach(r => { if (r.blind) hidden.add(r.id); }); });
    let bad = null;
    (function walk(o, path) {
      if (bad || !o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
      if (typeof o.id === "number" && o.cost && hidden.has(o.id)) { bad = `${path}: 숨은 카드 ${o.id}`; return; }
      if (typeof o.card === "number" && hidden.has(o.card)) { bad = `${path}.card: 숨은 카드 ${o.card}`; return; }
      for (const k in o) walk(o[k], `${path}.${k}`);
    })(v, "view");
    if (bad) return bad;
    if (!Array.isArray(v.decks) || v.decks.some(x => typeof x !== "number")) return "더미 순서가 보임";
    for (let q = 0; q < S.n; q++) {
      if (q === p) continue;
      const blind = S.players[q].res.filter(r => r.blind).length;
      const shown = v.players[q].res.filter(r => r.hidden).length;
      if (blind !== shown) return `${q}번의 비공개 찜 ${blind}장 ≠ 가린 ${shown}장`;
    }
    return true;
  }
};
