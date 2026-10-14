/* 고스톱 (3명) · 맞고 (2명) — 화투 48장 + 보너스 피.
   한 차례: 손패 한 장 내기 (바닥에 같은 월이 있으면 짝) → 더미 맨 위 한 장 뒤집기 (역시 같은 월과 짝).
   먹은 패의 점수가 나기 점수(맞고 7점 · 고스톱 3점)를 넘으면 고 또는 스톱. 정한 판 수를 마치고 누적 점수로 순위.

   상태 S 의 주요 칸
     hands[p] 손패 · floor 바닥 · deck 더미 (맨 위 = 배열 끝) · caps[p] 먹은 패
     phase: "play" 낼 차례 | "choose" 바닥 두 장 중 고르기 | "gostop" 고/스톱 | "roundEnd" 판 정산 | "over"
     tp: 진행 중인 차례 (고르기 때문에 멈출 수 있다) · ch: 고르기 정보 · ppeok: {월: 뻑 낸 사람}
     go[p] 고 횟수 · goScore[p] 마지막 고 때 점수 · shook[p] 흔들기·폭탄 [{m, bomb}] · flips[p] 뒤집기만 하는 차례 수
     totals[p] 누적 점수 (합은 항상 0) · nagari 나가리 배수 · result 마지막 판 정산 */
import { shuffle, randInt } from "../../core/rng.js";
import { CARDS, DECK48, BONUS, SET_NAME, isCard, monthOf, isBonus, cardName, sortCards } from "./cards.js";

const name = "고스톱";
const TH = n => (n === 2 ? 7 : 3);                        // 나기 점수
const others = (S, p) => { const r = []; for (let q = 0; q < S.n; q++) if (q !== p) r.push(q); return r; };
const ofMonth = (arr, m) => arr.filter(x => monthOf(x) === m);
function removeIds(arr, ids) { for (const id of ids) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); } }
const turnsOf = (S, p) => S.hands[p].length + S.flips[p];
const anyTurns = S => S.hands.some((h, p) => h.length + S.flips[p] > 0);
const zeros = n => Array.from({ length: n }, () => 0);
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
/* 보통 피 두 장처럼 똑같은 두 장은 고를 필요가 없다 */
const sameKind = (a, b) => CARDS[a].t === "p" && CARDS[b].t === "p" && CARDS[a].pv === CARDS[b].pv;

/* ===================== 점수 ===================== */
/* gukAs: 9월 국진을 "y" 열끗 / "p" 쌍피 중 무엇으로 셀지 */
export function scoreCards(cards, gukAs) {
  let g = 0, rain = false, t = 0, y = 0, pi = 0;
  const sets = { hong: 0, cheong: 0, cho: 0, go: 0 };
  for (const id of cards) {
    const c = CARDS[id];
    if (c.t === "g") { g++; if (c.rain) rain = true; }
    else if (c.t === "t") { t++; if (c.set) sets[c.set]++; }
    else if (c.t === "y") { if (c.guk && gukAs === "p") pi += 2; else { y++; if (c.set) sets[c.set]++; } }
    else pi += c.pv;
  }
  const items = [];
  const gp = g >= 5 ? 15 : g === 4 ? 4 : g === 3 ? (rain ? 2 : 3) : 0;
  if (gp) items.push([g === 3 && rain ? "비삼광" : `${g}광`, gp]);
  let tp = t >= 5 ? t - 4 : 0;
  if (tp) items.push([`띠 ${t}장`, tp]);
  for (const k of ["hong", "cheong", "cho"]) if (sets[k] === 3) { tp += 3; items.push([SET_NAME[k], 3]); }
  let yp = y >= 5 ? y - 4 : 0;
  if (yp) items.push([`열끗 ${y}장`, yp]);
  if (sets.go === 3) { yp += 5; items.push(["고도리", 5]); }
  const pp = pi >= 10 ? pi - 9 : 0;
  if (pp) items.push([`피 ${pi}장`, pp]);
  return { g, t, y, pi, gp, tp, yp, pp, total: gp + tp + yp + pp, items, sets, guk: null };
}
/* 국진은 점수가 더 높아지는 쪽으로 자동 (같으면 열끗) */
export function scoreOf(cards) {
  if (!cards.includes("9a")) return scoreCards(cards, "y");
  const a = scoreCards(cards, "y"), b = scoreCards(cards, "p");
  if (b.total > a.total) { b.guk = "p"; return b; }
  a.guk = "y";
  return a;
}

/* 이긴 사람 w 가 지금 판을 끝낼 때의 정산 (S 를 바꾸지 않는다) */
export function settle(S, w) {
  const ws = scoreOf(S.caps[w]);
  const go = S.go[w], goMul = go >= 3 ? 2 ** (go - 2) : 1;
  const base = ws.total, pts = (base + go) * goMul;
  const shakes = S.shook[w].length;
  const meong = ws.y >= 7;
  const losers = [];
  for (const q of others(S, w)) {
    let lpi = 0, lg = 0;
    for (const id of S.caps[q]) {
      const c = CARDS[id];
      if (c.t === "p") lpi += c.pv;
      else if (c.guk) lpi += 2;                  // 진 사람의 국진은 피박을 면하는 쪽(쌍피)으로
      else if (c.t === "g") lg++;
    }
    const pibak = ws.pp > 0 && lpi < 6;
    const gwangbak = ws.gp > 0 && lg === 0;
    const mul = 2 ** shakes * S.nagari * (pibak ? 2 : 1) * (gwangbak ? 2 : 1) * (meong ? 2 : 1);
    losers.push({ p: q, pi: lpi, gwang: lg, pibak, gwangbak, meongbak: meong, mul, amount: pts * mul, pay: pts * mul, go: S.go[q], gobak: false, covered: false });
  }
  // 고박 (3명): 고를 불렀다 진 사람이 두 사람 몫을 모두 낸다
  if (S.n === 3) {
    const goers = losers.filter(l => l.go > 0);
    if (goers.length === 1) {
      const g = goers[0], o = losers.find(l => l !== g);
      g.pay = g.amount + o.amount; g.gobak = true; o.pay = 0; o.covered = true;
    }
  }
  const deltas = zeros(S.n);
  for (const l of losers) { deltas[l.p] -= l.pay; deltas[w] += l.pay; }
  return {
    kind: "win", round: S.round, winner: w,
    score: { gp: ws.gp, tp: ws.tp, yp: ws.yp, pp: ws.pp, total: ws.total, items: ws.items, g: ws.g, t: ws.t, y: ws.y, pi: ws.pi, guk: ws.guk },
    base, go, goMul, pts, shakes, nagari: S.nagari, losers, deltas
  };
}

/* ===================== 판 준비 ===================== */
function deal(S) {
  const n = S.n, hn = n === 2 ? 10 : 7, fn = n === 2 ? 8 : 6;
  let deck, hands, floor, extra;
  for (let tries = 0; ; tries++) {
    deck = shuffle(S, [...DECK48, ...(S.bonus ? BONUS : [])]);
    hands = [];
    for (let p = 0; p < n; p++) hands.push(deck.splice(deck.length - hn, hn));
    floor = deck.splice(deck.length - fn, fn);
    extra = [];
    // 바닥에 깔린 보너스는 선이 가져가고, 그 자리는 더미에서 채운다
    for (let i = 0; i < floor.length; i++) while (isBonus(floor[i])) { extra.push(floor[i]); floor[i] = deck.pop(); }
    const cnt = {};
    for (const c of floor) cnt[monthOf(c)] = (cnt[monthOf(c)] || 0) + 1;
    if (!Object.values(cnt).some(k => k >= 4) || tries >= 40) break;   // 바닥에 같은 월 4장 → 다시 나누기
  }
  S.hands = hands; S.floor = floor; S.deck = deck;
  S.caps = hands.map(() => []);
  S.caps[S.leader].push(...extra);
  S.go = zeros(n); S.goScore = zeros(n); S.flips = zeros(n); S.shook = hands.map(() => []);
  S.ppeok = {}; S.tp = null; S.ch = null; S.last = null; S.result = null; S.shown = [];
  S.turn = S.leader; S.phase = "play";
  const ev = [{ type: "deal", round: S.round, leader: S.leader, text: `${S.round}판 시작 — {${S.leader}} 님이 선${S.nagari > 1 ? ` (나가리 ×${S.nagari})` : ""}` }];
  if (extra.length) ev.push({ type: "bonus", p: S.leader, card: extra[0], floor: true, text: `바닥의 보너스 피를 선인 {${S.leader}} 님이 가져갑니다` });
  // 총통: 손패에 같은 월 4장 → 바로 승리 (10점)
  for (let k = 0; k < n; k++) {
    const p = (S.leader + k) % n;
    for (let m = 1; m <= 12; m++) {
      const four = ofMonth(S.hands[p], m);
      if (four.length < 4) continue;
      const losers = others(S, p).map(q => ({ p: q, mul: S.nagari, amount: 10 * S.nagari, pay: 10 * S.nagari }));
      const deltas = zeros(n);
      for (const l of losers) { deltas[l.p] -= l.pay; deltas[p] += l.pay; }
      S.result = { kind: "chongtong", round: S.round, winner: p, m, cards: four, pts: 10, nagari: S.nagari, losers, deltas };
      S.shown.push(...four);
      for (let q = 0; q < n; q++) S.totals[q] += deltas[q];
      S.wins[p]++; S.leader = p; S.nagari = 1;
      S.phase = "roundEnd";
      ev.push({ type: "chongtong", p, m, cards: four, toast: true, text: `{${p}} 님 총통! (${m}월 4장) — 10점` });
      return ev;
    }
  }
  return ev;
}

/* ===================== 한 차례 ===================== */
function capture(S, tp, ids) {
  removeIds(S.floor, ids);
  S.caps[tp.p].push(...ids);
  tp.captured.push(...ids);
}
function stealPi(S, from, to) {
  const cap = S.caps[from];
  for (const want of [1, 2, 3]) for (let i = cap.length - 1; i >= 0; i--) {     // 보통 피 → 쌍피 → 쓰리피
    const c = CARDS[cap[i]];
    if (c.t === "p" && c.pv === want) { const [id] = cap.splice(i, 1); S.caps[to].push(id); return id; }
  }
  return null;
}
function ppeokTake(S, tp, m) {
  if (S.ppeok[m] !== undefined) { tp.steals++; tp.combos.push(S.ppeok[m] === tp.p ? "자뻑" : "뻑 먹기"); }
  delete S.ppeok[m];
}

/* 손에 든 보너스 피: 내 피로 가져가고 더미에서 한 장 받는다 (차례는 그대로) */
function playBonus(S, p, id) {
  removeIds(S.hands[p], [id]);
  S.caps[p].push(id);
  const drew = S.deck.length ? S.deck.pop() : null;
  if (drew) S.hands[p].push(drew);
  return [{ type: "bonus", p, card: id, drew, text: `{${p}} 님 ${cardName(id)} — 피로 가져가고 한 장 더 받음` }];
}

function playTurn(S, p, a) {
  const ev = [];
  const hand = S.hands[p];
  const tp = S.tp = { p, kind: "", m: 0, played: [], target: null, d: null, flipped: [], captured: [], combos: [], steals: 0, stolen: [] };
  if (a.flip) {
    S.flips[p]--;
    tp.kind = "flip";
  } else {
    const m = monthOf(a.card), F = ofMonth(S.floor, m);
    tp.m = m;
    if (a.bomb) {
      const mine = ofMonth(hand, m);
      removeIds(hand, mine);
      tp.played = mine.slice();
      S.floor.push(...mine);
      capture(S, tp, [...mine, ...F]);
      tp.kind = "bomb"; tp.steals++; tp.combos.push("폭탄");
      S.flips[p] += 2;
      S.shook[p].push({ m, bomb: true });
      ev.push({ type: "bomb", p, m, cards: mine.slice(), toast: true, text: `{${p}} 님 ${m}월 폭탄! 💣 (이기면 ×2)` });
    } else {
      removeIds(hand, [a.card]);
      tp.played = [a.card];
      S.floor.push(a.card);
      if (a.shake) {
        const show = [a.card, ...ofMonth(hand, m)];
        S.shook[p].push({ m, bomb: false });
        S.shown.push(...show);
        tp.combos.push("흔들기");
        ev.push({ type: "shake", p, m, cards: show, toast: true, text: `{${p}} 님 ${m}월 흔들기! (이기면 ×2)` });
      }
      if (F.length === 0) tp.kind = "lay";
      else if (F.length === 1) { tp.kind = "pair"; tp.target = F[0]; }
      else if (F.length === 2) {
        tp.kind = "pair2";
        if (sameKind(F[0], F[1])) tp.target = F[0];
        else { S.phase = "choose"; S.ch = { stage: "play", m, options: F.slice() }; }
      } else {
        tp.kind = "take4";
        capture(S, tp, [a.card, ...F]);
        ppeokTake(S, tp, m);
      }
    }
  }
  ev.push({ type: "play", p, cards: tp.played.slice(), kind: tp.kind });
  if (S.phase !== "choose") flipStage(S, ev);
  return ev;
}

function flipStage(S, ev) {
  const tp = S.tp, p = tp.p;
  while (S.deck.length && isBonus(S.deck[S.deck.length - 1])) {     // 뒤집은 보너스: 내 것으로 하고 다시 뒤집기
    const b = S.deck.pop();
    S.caps[p].push(b); tp.flipped.push(b); tp.captured.push(b);
    ev.push({ type: "flip", p, card: b, bonus: true });
  }
  if (!S.deck.length) return finishTurn(S, ev);
  const d = S.deck.pop(), md = monthOf(d);
  tp.d = d; tp.flipped.push(d);
  S.floor.push(d);
  ev.push({ type: "flip", p, card: d });
  if (md === tp.m && (tp.kind === "lay" || tp.kind === "pair" || tp.kind === "pair2")) {
    if (tp.kind === "lay") { capture(S, tp, [tp.played[0], d]); tp.steals++; tp.combos.push("쪽"); }
    else if (tp.kind === "pair") { tp.target = null; S.ppeok[md] = p; tp.combos.push("뻑"); }
    else { tp.target = null; capture(S, tp, ofMonth(S.floor, md)); tp.steals++; tp.combos.push("따닥"); }
    return finishTurn(S, ev);
  }
  const G = S.floor.filter(x => x !== d && monthOf(x) === md);
  if (G.length === 1) capture(S, tp, [d, G[0]]);
  else if (G.length === 2) {
    if (sameKind(G[0], G[1])) capture(S, tp, [d, G[0]]);
    else { S.phase = "choose"; S.ch = { stage: "flip", m: md, options: G.slice() }; return; }
  } else if (G.length === 3) {
    capture(S, tp, [d, ...G]);
    ppeokTake(S, tp, md);
  }
  finishTurn(S, ev);
}

/* 기록 한 줄: "{0} 님: 3월 홍단 → 8월 광 · 4장 먹음 · 쪽!" (→ 뒤는 뒤집은 패) */
function turnText(tp) {
  const parts = [];
  if (tp.kind === "flip") parts.push("(뒤집기만)");
  else if (tp.kind === "bomb") parts.push(`${tp.m}월 폭탄`);
  else parts.push(cardName(tp.played[0]));
  if (tp.flipped.length) parts.push(tp.flipped.map(cardName).join(" + "));      // 뒤집은 보너스 피도 함께
  let s = `{${tp.p}} 님: ${parts.join(" → ")}`;
  if (tp.captured.length) s += ` · ${tp.captured.length}장 먹음`;
  const combos = tp.combos.filter(c => c !== "흔들기" && c !== "폭탄");
  if (combos.length) s += ` · ${combos.join(" · ")}!`;
  if (tp.stolen.length) s += ` (피 ${tp.stolen.length}장 뺏음)`;
  return s;
}

function finishTurn(S, ev) {
  const tp = S.tp, p = tp.p;
  S.phase = "play"; S.ch = null;
  if (tp.target) { capture(S, tp, [tp.played[0], tp.target]); tp.target = null; }
  for (const k of Object.keys(S.ppeok)) if (ofMonth(S.floor, +k).length !== 3) delete S.ppeok[k];
  if (!S.floor.length && anyTurns(S)) { tp.steals++; tp.combos.push("쓸"); }     // 마지막 차례의 쓸은 없음
  for (const q of others(S, p)) for (let k = 0; k < tp.steals; k++) {
    const c = stealPi(S, q, p);
    if (c) tp.stolen.push({ from: q, card: c });
  }
  S.last = { p, kind: tp.kind, m: tp.m, played: tp.played, flipped: tp.flipped, captured: tp.captured, combos: tp.combos, stolen: tp.stolen };
  ev.push({ type: "turn", ...JSON.parse(JSON.stringify(S.last)), text: turnText(tp) });
  S.tp = null;
  const sc = scoreOf(S.caps[p]).total;
  if (sc >= TH(S.n) && sc > S.goScore[p]) {
    S.turn = p;
    if (turnsOf(S, p) > 0) { S.phase = "gostop"; return; }
    ev.push(...endRound(S, p, "auto"));          // 더 낼 패가 없으면 자동 스톱
    return;
  }
  if (!anyTurns(S)) { ev.push(...endRound(S, null)); return; }
  nextTurn(S, p);
}

function nextTurn(S, p) {
  for (let k = 1; k <= S.n; k++) {
    const q = (p + k) % S.n;
    if (turnsOf(S, q) > 0) { S.turn = q; S.phase = "play"; return; }
  }
}

function endRound(S, w, how) {
  S.phase = "roundEnd"; S.tp = null; S.ch = null;
  if (w === null) {
    S.nagari *= 2;
    S.result = { kind: "nagari", round: S.round, nagari: S.nagari, deltas: zeros(S.n) };
    return [{ type: "nagari", toast: true, text: `나가리! 다음 판은 점수 ×${S.nagari}` }];
  }
  const R = settle(S, w);
  R.how = how;
  S.result = R;
  for (let q = 0; q < S.n; q++) S.totals[q] += R.deltas[q];
  S.wins[w]++;
  S.leader = w; S.nagari = 1;
  return [{ type: "roundEnd", winner: w, gain: R.deltas[w], toast: true,
    text: `{${w}} 님 ${how === "auto" ? "났습니다" : "스톱"}! ${R.pts}점 → 모두 합해 ${R.deltas[w]}점 받음` }];
}

/* 손패 기준으로 흔들기 · 폭탄이 되는 월 */
function specials(S, p) {
  const r = { shake: [], bomb: [] };
  for (let m = 1; m <= 12; m++) {
    const k = ofMonth(S.hands[p], m).length, f = ofMonth(S.floor, m).length;
    if (k >= 3 && f === 1) r.bomb.push(m);
    if (k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m)) r.shake.push(m);
  }
  return r;
}

/* ===================== AI ===================== */
function profile(S, q) {
  const pr = { g: 0, t: 0, y: 0, pi: 0, sets: { hong: 0, cheong: 0, cho: 0, go: 0 }, dead: { hong: false, cheong: false, cho: false, go: false } };
  for (const id of S.caps[q]) {
    const c = CARDS[id];
    if (c.t === "g") pr.g++;
    else if (c.t === "t") { pr.t++; if (c.set) pr.sets[c.set]++; }
    else if (c.t === "y") { pr.y++; if (c.set) pr.sets[c.set]++; }
    else pr.pi += c.pv;
  }
  for (const r of others(S, q)) for (const id of S.caps[r]) { const s = CARDS[id].set; if (s) pr.dead[s] = true; }
  return pr;
}
/* 카드 한 장이 그 사람에게 얼마나 값진가 (대략 '점수' 단위). aware: 약 · 단 · 고도리 진행을 따지는지 */
function cardVal(pr, id, aware) {
  const c = CARDS[id];
  const perPi = pr.pi >= 7 ? 0.95 : pr.pi < 5 ? 0.8 : 0.65;
  if (c.t === "p") return c.pv * perPi;
  if (c.t === "g") {
    if (!aware) return 2.2;
    let v = 2 + [0.3, 1, 3, 1.5, 6][Math.min(4, pr.g)];
    if (c.rain && pr.g < 3) v -= 0.8;
    return v;
  }
  let v = c.t === "t" ? 0.7 : 0.8;
  if (aware) {
    if ((c.t === "t" ? pr.t : pr.y) >= 4) v += 0.8;
    if (c.set && !pr.dead[c.set]) v += (c.set === "go" ? [1, 2, 5] : [0.8, 1.5, 3.3])[pr.sets[c.set]] || 0;
  }
  if (c.guk) v = Math.max(v, 2 * perPi);
  return v;
}
/* 곧 날 것 같은 정도 (상대 견제용) */
function potential(S, q) {
  const pr = profile(S, q);
  let v = 0;
  for (const k of ["hong", "cheong", "cho"]) if (pr.sets[k] === 2 && !pr.dead[k]) v += 1.5;
  if (pr.sets.go === 2 && !pr.dead.go) v += 2.5;
  if (pr.g === 2) v += 1.2;
  if (pr.pi >= 8) v += 1;
  if (pr.y >= 4) v += 0.5;
  if (pr.t >= 4) v += 0.5;
  return v;
}
function aiCtx(S, p, level) {
  const aware = level !== "easy", block = level === "hard";
  const me = profile(S, p);
  const opp = others(S, p).map(q => profile(S, q));
  const seen = zeros(13);
  for (const id of S.hands[p]) seen[monthOf(id)]++;
  for (const id of S.floor) seen[monthOf(id)]++;
  for (const cap of S.caps) for (const id of cap) seen[monthOf(id)]++;
  let U = S.deck.length;
  for (const q of others(S, p)) U += S.hands[q].length;
  return {
    aware, block,
    my: id => cardVal(me, id, aware),
    opp: id => Math.max(0, ...opp.map(pr => cardVal(pr, id, true))),
    unseen: seen.map((k, m) => (m ? Math.max(0, 4 - k) : 0)),
    U: Math.max(1, U), nOpp: S.n - 1, nextHand: S.hands[(p + 1) % S.n].length, stealV: 0.9
  };
}
/* 손패 한 장(또는 폭탄)을 냈을 때의 기대 이득 — 뒤집기는 쪽 · 뻑 · 따닥 확률만 가볍게 본다 */
function evalPlay(S, p, X, id, mode) {
  const m = monthOf(id), F = ofMonth(S.floor, m), mine = ofMonth(S.hands[p], m);
  const u = X.unseen[m], pFlip = u / X.U, steal = X.stealV * X.nOpp;
  const take = ids => ids.reduce((a, x) => a + X.my(x) + (X.block ? 0.4 * X.opp(x) : 0), 0);
  if (mode === "bomb") return take([...mine, ...F]) + steal + 3.5;
  let v;
  if (F.length === 0) {
    const pOpp = Math.min(1, u * X.nextHand / X.U);              // 다음 사람이 이 월을 들고 있을 확률 (대략)
    const keep = mine.length >= 2 ? 0.3 : 1;                      // 같은 월이 손에 더 있으면 되찾을 수 있다
    const loss = X.block ? X.opp(id) : X.aware ? 0.5 * X.my(id) + 0.3 : 0.3;
    v = -0.5 + pFlip * (X.my(id) + steal) - keep * pOpp * loss * 0.7;
  } else if (F.length === 1) {
    const g = take([id, F[0]]);
    v = g - pFlip * g;                                            // 뻑 위험
  } else if (F.length === 2) {
    const [a, b] = F.slice().sort((x, y) => X.my(y) - X.my(x));
    v = take([id, a]) + pFlip * (take([b]) + steal);
    if (X.block && u > 0) v -= 0.3 * X.opp(b);                    // 남긴 한 장을 상대가 먹을 수 있다
  } else {
    v = take([id, ...F]) + (S.ppeok[m] !== undefined ? steal : 0);
  }
  if (mode === "shake") v += X.aware ? 1.5 : 0.5;
  return v;
}
function aiPlay(S, p, level, rng) {
  const hand = S.hands[p];
  const b = hand.find(isBonus);
  if (b) return { bonus: b };
  const X = aiCtx(S, p, level);
  const noise = level === "easy" ? 2.5 : level === "normal" ? 0.6 : 0.2;
  let best = null, bv = -Infinity;
  const consider = (a, v) => { v += (rng() - 0.5) * noise; if (v > bv) { bv = v; best = a; } };
  for (const id of hand) {
    const m = monthOf(id), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
    if (k >= 3 && f === 1) consider({ card: id, bomb: true }, evalPlay(S, p, X, id, "bomb") - (level === "easy" ? 2 : 0));
    const shake = k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m) && (level !== "easy" || rng() < 0.5);
    consider(shake ? { card: id, shake: true } : { card: id }, evalPlay(S, p, X, id, shake ? "shake" : "plain"));
  }
  if (S.flips[p] > 0) consider({ flip: true }, hand.length ? 0.2 : 1e6);
  return best;
}
function aiChoose(S, p, level, rng) {
  const X = aiCtx(S, p, level);
  let best = S.ch.options[0], bv = -Infinity;
  for (const id of S.ch.options) {
    const v = X.my(id) + (X.block ? 0.5 * X.opp(id) : 0) + (level === "easy" ? rng() * 1.5 : 0);
    if (v > bv) { bv = v; best = id; }
  }
  return { take: best };
}
function aiGo(S, p, level) {
  if (level === "easy") return { go: false };
  const th = TH(S.n), left = turnsOf(S, p);
  if (left < 2) return { go: false };
  const threat = Math.max(...others(S, p).map(q => scoreOf(S.caps[q]).total + potential(S, q)));
  if (level === "normal") return { go: left >= 3 && S.go[p] < 3 && threat <= th - (S.n === 2 ? 3 : 2) };
  // 어려움: 상대 위협 · 고박(3명이면 지면 두 사람 몫) · 지금 받을 점수(배수)를 함께 본다.
  // 시험 대국에서는 2장 이상 남았을 때 과감히 고 하는 쪽이 이득이었다 (맞고는 고박이 없다).
  const now = settle(S, p).deltas[p];
  const margin = S.n === 3 ? 1 : 2;                                  // 3명: 고박이 있어 상대 견제를 더 엄하게
  if (now >= th * 12 && left <= 3) return { go: false };             // 배수가 이미 아주 크면 지킨다
  if (S.n === 3 && now >= th * 6 && threat >= th - 2) return { go: false };
  return { go: threat <= th - margin };
}

/* ===================== 엔진 ===================== */
export default {
  id: "gostop",
  name,
  icon: "🎴",
  blurb: "화투 짝 맞추기! 2명은 맞고, 3명은 고스톱. 점수가 나면 고? 스톱?",
  players: { min: 2, max: 3, default: 3 },
  settings: [
    { key: "rounds", label: "판 수", values: [5, 10], labels: ["5판", "10판"], default: 5, note: "누적 점수로 순위를 정합니다" },
    { key: "bonus", label: "보너스 피", values: [2, 0], labels: ["2장", "없음"], default: 2, note: "보너스 쌍피 1장 + 쓰리피 1장" }
  ],
  rules: `
    <h4>인원과 패</h4>
    <ul>
      <li><b>2명 = 맞고</b>: 손패 10장 · 바닥 8장 · <b>7점</b>부터 날 수 있습니다.</li>
      <li><b>3명 = 고스톱</b>: 손패 7장 · 바닥 6장 · <b>3점</b>부터 날 수 있습니다.</li>
      <li>화투 48장 (설정에 따라 <b>보너스 피</b> 2장: 쌍피 1 · 쓰리피 1). 바닥에 같은 월 4장이 깔리면 다시 나눕니다.</li>
      <li><b>총통</b>: 처음 받은 손패에 같은 월 4장 → 그 판은 바로 승리 (10점).</li>
    </ul>
    <h4>한 차례</h4>
    <ul>
      <li>손패 한 장을 냅니다. 바닥에 같은 월이 1장이면 짝, 2장이면 <b>하나를 골라</b> 짝, 3장이면 4장을 모두 먹습니다. 없으면 바닥에 놓입니다.</li>
      <li>이어서 더미 맨 위 한 장을 뒤집어 같은 방식으로 짝을 맞춥니다.</li>
      <li><b>쪽</b>: 낸 패가 짝이 없었는데 뒤집은 패가 같은 월 → 2장을 먹고 상대마다 피 1장씩 뺏기.</li>
      <li><b>뻑</b>: 낸 패로 1장과 짝을 맞췄는데 뒤집은 패도 같은 월 → 3장 모두 바닥에 남습니다. 나중에 그 월 마지막 패로 4장을 먹으면 피 1장씩 뺏기 (바닥에 처음부터 3장이 깔린 것은 뺏기 없음).</li>
      <li><b>따닥</b>: 바닥 2장에 같은 월을 내고 4번째를 뒤집음 → 4장 + 피 1장씩.</li>
      <li><b>쓸</b>: 내 차례 뒤 바닥이 비면 피 1장씩 (판의 마지막 차례는 제외).</li>
      <li><b>흔들기</b>: 같은 월 3장을 들고 바닥에 그 월이 없을 때, 그중 한 장을 내며 선언 → 이기면 ×2.</li>
      <li><b>폭탄</b>: 같은 월 3장을 들고 바닥에 나머지 1장이 있으면 3장을 한꺼번에 내 4장을 먹고 피 1장씩 뺏기, 이기면 ×2. 손패가 2장 줄어드는 대신 <b>뒤집기만 하는 차례</b>가 2번 생깁니다 (아무 때나 사용).</li>
      <li><b>보너스 피</b>: 손에 있으면 아무 때나 내서 내 피로 가져가고 더미에서 한 장을 받은 뒤, 원래대로 한 장을 냅니다. 뒤집다 나오면 내 것이 되고 한 장 더 뒤집습니다. 처음 바닥에 깔리면 선이 가져갑니다.</li>
      <li>피를 뺏을 때는 보통 피부터, 없으면 쌍피(그다음 쓰리피)를 가져옵니다.</li>
    </ul>
    <h4>점수 (먹은 패로 늘 자동 계산)</h4>
    <ul>
      <li><b>광</b>: 3광 3점 (비광이 끼면 2점) · 4광 4점 · 5광 15점.</li>
      <li><b>띠</b>: 5장 1점, 1장마다 +1. <b>홍단</b>(1·2·3월) · <b>청단</b>(6·9·10월) · <b>초단</b>(4·5·7월) 각 3점. 12월 비띠는 장수에만 듭니다.</li>
      <li><b>열끗</b>: 5장 1점, 1장마다 +1. <b>고도리</b>(2·4·8월 새) 5점.</li>
      <li><b>피</b>: 10장 1점, 1장마다 +1. 쌍피는 2장, 보너스 쓰리피는 3장으로 셉니다.</li>
      <li><b>9월 국진</b>: 열끗 또는 쌍피 — 점수가 더 높아지는 쪽으로 자동 (같으면 열끗). 진 사람의 국진은 피박을 면하는 쪽(쌍피)으로 셉니다.</li>
    </ul>
    <h4>고 · 스톱</h4>
    <ul>
      <li>내 차례가 끝났을 때 점수가 나기 점수 이상이고 마지막으로 고를 부를 때보다 높으면 <b>고</b> 또는 <b>스톱</b>을 고릅니다.</li>
      <li><b>고</b>: 판을 계속합니다. 1고 +1점, 2고 +2점, 3고부터는 (점수 + 고 횟수)에 ×2, 4고 ×4, 5고 ×8…</li>
      <li><b>스톱</b>: 이번 판을 이기고 끝냅니다. 더 낼 패가 없으면 자동으로 스톱됩니다.</li>
      <li>모두 패를 다 낼 때까지 아무도 스톱하지 못하면 <b>나가리</b> — 점수 없이 다음 판은 ×2 (연속이면 계속 곱해집니다).</li>
    </ul>
    <h4>정산 (진 사람마다)</h4>
    <ul>
      <li>낼 점수 = 이긴 사람 점수(고 포함) × 아래 배수들.</li>
      <li><b>흔들기 · 폭탄</b>: 이긴 사람이 한 번 할 때마다 ×2 (진 사람의 흔들기는 셈하지 않음).</li>
      <li><b>피박</b>: 이긴 사람이 피로 점수를 냈고 진 사람 피가 6장 미만 (0장 포함) → ×2.</li>
      <li><b>광박</b>: 이긴 사람이 광으로 점수를 냈고 진 사람 광이 0장 → ×2.</li>
      <li><b>멍박</b>: 이긴 사람 열끗 7장 이상 → ×2.</li>
      <li><b>고박</b> (3명): 고를 불렀다가 진 사람이 두 사람 몫을 혼자 모두 냅니다 (진 두 사람이 모두 고를 불렀으면 각자 냄). 맞고에는 고박이 없습니다.</li>
      <li>나가리 다음 판에는 나가리 배수가 곱해집니다.</li>
    </ul>
    <h4>여러 판</h4>
    <ul>
      <li>정한 판 수(5 · 10판)를 하고 <b>누적 점수</b>로 순위를 정합니다. 첫 판 선은 무작위, 그다음은 이긴 사람이 선 (나가리면 그대로).</li>
    </ul>`,

  setup({ n, seed, settings = {} }) {
    const S = {
      n, rs: seed >>> 0,
      bonus: settings.bonus === 0 ? 0 : 2,
      rounds: [5, 10].includes(settings.rounds) ? settings.rounds : 5,
      round: 1, totals: zeros(n), wins: zeros(n), nagari: 1, leader: 0
    };
    S.leader = randInt(S, n);
    deal(S);
    return S;
  },

  pending(S) {
    if (S.phase === "play" || S.phase === "choose" || S.phase === "gostop") return [{ p: S.turn, kind: S.phase }];
    return [];
  },

  validate(S, p, a) {
    if (!this.pending(S).some(x => x.p === p)) return "지금은 내 차례가 아닙니다";
    if (!a || typeof a !== "object") return "행동을 고르세요";
    if (S.phase === "gostop") return typeof a.go === "boolean" ? true : "고 또는 스톱을 고르세요";
    if (S.phase === "choose") return S.ch && S.ch.options.includes(a.take) ? true : "가져갈 바닥 카드를 고르세요";
    const hand = S.hands[p];
    if (a.flip) return S.flips[p] > 0 ? true : "뒤집기만 하는 차례가 없습니다";
    if (a.bonus !== undefined) return isBonus(a.bonus) && hand.includes(a.bonus) ? true : "그 보너스 피가 손에 없습니다";
    if (!isCard(a.card) || !hand.includes(a.card)) return "손에 없는 카드입니다";
    if (isBonus(a.card)) return "보너스 피는 따로 냅니다";
    const m = monthOf(a.card), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
    if (a.bomb && a.shake) return "폭탄과 흔들기는 함께 할 수 없습니다";
    if (a.bomb && !(k >= 3 && f === 1)) return "폭탄은 같은 월 3장을 들고 바닥에 나머지 1장이 있을 때만 됩니다";
    if (a.shake && !(k >= 3 && f === 0)) return "흔들기는 같은 월 3장을 들고 바닥에 그 월이 없을 때만 됩니다";
    if (a.shake && S.shook[p].some(x => x.m === m)) return "이미 흔든 월입니다";
    return true;
  },

  apply(S, p, a) {
    if (S.phase === "gostop") {
      if (a.go) {
        S.go[p]++;
        S.goScore[p] = scoreOf(S.caps[p]).total;
        const ev = [{ type: "go", p, go: S.go[p], toast: true, text: `{${p}} 님 ${S.go[p]}고!` }];
        nextTurn(S, p);
        return ev;
      }
      return endRound(S, p, "stop");
    }
    if (S.phase === "choose") {
      const ch = S.ch, tp = S.tp, ev = [];
      S.ch = null; S.phase = "play";
      if (ch.stage === "play") { tp.target = a.take; flipStage(S, ev); }
      else { capture(S, tp, [tp.d, a.take]); finishTurn(S, ev); }
      return ev;
    }
    // validate 와 같은 순서로 해석한다 (뒤집기 → 보너스 → 카드)
    if (a.flip) return playTurn(S, p, { flip: true });
    if (a.bonus !== undefined) return playBonus(S, p, a.bonus);
    return playTurn(S, p, { card: a.card, bomb: !!a.bomb, shake: !!a.shake });
  },

  step(S) {
    if (S.phase !== "roundEnd") return [];
    if (S.round >= S.rounds) { S.phase = "over"; return [{ type: "over", text: "모든 판이 끝났습니다" }]; }
    S.round++;
    return deal(S);
  },

  delay(S) { return S.phase === "roundEnd" ? (S.result && S.result.kind === "nagari" ? 4000 : 5500) : 1200; },

  /* 손에 든 보너스 피 다음에 받은 카드는 본인만 안다 */
  filterEvent(ev, p) {
    if (ev.type === "bonus" && ev.drew && p !== ev.p) return { ...ev, drew: null };
    return ev;
  },

  timeout(S, p) {
    if (S.phase === "choose") return aiChoose(S, p, "normal", () => 0.5);
    if (S.phase === "gostop") return { go: false };
    return aiPlay(S, p, "normal", () => 0.5);
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.phase === "choose") return aiChoose(S, p, level, rng);
    if (S.phase === "gostop") return aiGo(S, p, level);
    return aiPlay(S, p, level, rng);
  },
  thinkTime(S, p, kind) {
    if (kind === "choose") return 450 + Math.random() * 300;
    if (kind === "gostop") return 900 + Math.random() * 600;
    return 800 + Math.random() * 600;
  },

  view(S, p) {
    const me = Number.isInteger(p) && p >= 0 && p < S.n ? p : -1;
    const scores = S.caps.map(c => {
      const s = scoreOf(c);
      return { total: s.total, gp: s.gp, tp: s.tp, yp: s.yp, pp: s.pp, g: s.g, t: s.t, y: s.y, pi: s.pi, items: s.items, guk: s.guk, sets: s.sets };
    });
    let status = "";
    if (S.phase === "over") status = "게임 끝";
    else if (S.phase === "roundEnd") {
      const r = S.result;
      status = r && r.kind === "nagari" ? `${S.round}판 나가리 — 다음 판 ×${S.nagari}` : r && r.kind === "chongtong" ? `${S.round}판 총통!` : `${S.round}판 끝 — 곧 다음 판`;
    } else if (S.turn === me) {
      status = S.phase === "choose" ? "가져갈 카드를 고르세요" : S.phase === "gostop" ? "고? 스톱?"
        : S.hands[me].length ? "내 차례 — 낼 카드를 고르세요" : "내 차례 — 패를 뒤집으세요";
    }
    const copy = x => (x ? JSON.parse(JSON.stringify(x)) : null);
    return {
      phase: S.phase, round: S.round, rounds: S.rounds, n: S.n, th: TH(S.n), turn: S.turn, leader: S.leader,
      deck: S.deck.length, floor: sortCards(S.floor), ppeok: Object.keys(S.ppeok).map(Number),
      caps: S.caps.map(sortCards), scores, sizes: S.hands.map(h => h.length), flips: S.flips.slice(),
      go: S.go.slice(), goScore: S.goScore.slice(), shook: S.shook.map(a => a.map(x => ({ m: x.m, bomb: x.bomb }))),
      totals: S.totals.slice(), wins: S.wins.slice(), nagari: S.nagari,
      ch: S.phase === "choose" && S.ch ? { stage: S.ch.stage, m: S.ch.m, options: S.ch.options.slice() } : null,
      cur: S.tp ? { p: S.tp.p, played: S.tp.played.slice(), flipped: S.tp.flipped.slice() } : null,
      last: copy(S.last), result: copy(S.result),
      hand: me >= 0 ? sortCards(S.hands[me]) : [],
      can: me >= 0 ? specials(S, me) : null,
      preview: me >= 0 && S.phase === "gostop" && S.turn === me ? settle(S, me) : null,
      status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.totals.map((t, p) => ({
      p, rank: 1 + S.totals.filter(x => x > t).length, score: t,
      note: `${t > 0 ? "+" : ""}${t}점 · ${S.wins[p]}승`
    })).sort((a, b) => a.rank - b.rank);
  },

  /* ---------- 시험용 ---------- */
  randomAction(S, p, rng) {
    if (S.phase === "choose") return { take: pick(rng, S.ch.options) };
    if (S.phase === "gostop") return { go: rng() < 0.5 };
    const hand = S.hands[p], acts = [];
    for (const id of hand) {
      if (isBonus(id)) { acts.push({ bonus: id }); continue; }
      const m = monthOf(id), k = ofMonth(hand, m).length, f = ofMonth(S.floor, m).length;
      acts.push({ card: id });
      if (k >= 3 && f === 1) acts.push({ card: id, bomb: true });
      if (k >= 3 && f === 0 && !S.shook[p].some(x => x.m === m)) acts.push({ card: id, shake: true });
    }
    if (S.flips[p] > 0) acts.push({ flip: true });
    return pick(rng, acts);
  },
  check(S) {
    const all = [...S.hands.flat(), ...S.floor, ...S.deck, ...S.caps.flat()];
    const want = 48 + (S.bonus ? 2 : 0);
    if (all.length !== want) return `카드 수가 맞지 않음 ${all.length} ≠ ${want}`;
    const seen = new Set();
    for (const id of all) {
      if (!isCard(id)) return `모르는 카드 ${id}`;
      if (seen.has(id)) return `카드 중복 ${id}`;
      seen.add(id);
    }
    if (!S.bonus && (seen.has("B2") || seen.has("B3"))) return "보너스 없음인데 보너스 피가 있음";
    if (S.totals.reduce((a, b) => a + b, 0) !== 0) return "누적 점수의 합이 0 이 아님";
    if (S.floor.some(isBonus)) return "바닥에 보너스 피가 있음";
    if (S.phase === "choose") {
      if (!S.tp || !S.ch || S.ch.options.length !== 2 || !S.ch.options.every(c => S.floor.includes(c))) return "고르기 상태가 이상함";
      return true;
    }
    if (S.tp) return "차례가 끝났는데 진행 정보가 남음";
    for (let m = 1; m <= 12; m++) if (ofMonth(S.floor, m).length > 3) return `바닥에 ${m}월 4장`;
    for (const k of Object.keys(S.ppeok)) if (ofMonth(S.floor, +k).length !== 3) return `뻑 표시가 맞지 않음 (${k}월)`;
    // 더미의 일반 카드 수 = 남은 차례 수 (손의 보너스는 바꿔 받을 한 장을 더 쓴다) → 더미가 모자라는 일이 없다
    const dn = S.deck.filter(c => !isBonus(c)).length;
    let need = 0;
    for (let p = 0; p < S.n; p++) need += S.hands[p].length + S.hands[p].filter(isBonus).length + S.flips[p];
    if (dn !== need) return `더미 수가 맞지 않음 (일반 ${dn}장, 필요 ${need}장)`;
    if ((S.phase === "play" || S.phase === "gostop") && turnsOf(S, S.turn) <= 0) return "차례인 사람에게 낼 패가 없음";
    if (S.phase === "over" && S.round !== S.rounds) return "판 수가 맞지 않음";
    return true;
  },
  leak(S, p, v) {
    const hidden = new Set(S.deck);
    S.hands.forEach((h, q) => { if (q !== p) for (const id of h) hidden.add(id); });
    for (const id of S.shown || []) hidden.delete(id);
    let bad = null;
    const walk = x => {
      if (bad) return;
      if (typeof x === "string") { if (hidden.has(x)) bad = x; }
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    };
    walk(v);
    if (bad) return `숨은 카드 ${bad} 가 보임`;
    if (JSON.stringify(sortCards(S.hands[p])) !== JSON.stringify(v.hand)) return "내 패가 맞지 않음";
    if (typeof v.deck !== "number") return "더미가 숫자가 아님";
    return true;
  },
  stepLimit: 20000
};
