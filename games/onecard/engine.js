/* 원카드 — 52장 + 흑백 · 컬러 조커 = 54장. 위 카드와 무늬나 숫자가 같은 카드를 한 장씩 낸다.
   공격 카드(2 · A · ♠A · 조커)는 벌칙이 쌓이고, 막지 못한 사람이 모두 가져간다.
   J 건너뛰기 · Q 방향 바꾸기 · K 한 장 더 · 7 무늬 바꾸기. 한 장 남으면 「원카드!」를 외쳐야 한다. */
import { shuffle, randInt } from "../../core/rng.js";
import { deck52, suitOf, rankOf, isJoker, cardName, SUITS, SUIT_SYMBOL } from "../../core/cards.js";

const name = "원카드";
const TOTAL = 54;
const MAX_MOVES = 3000;                                   // 이보다 길어지면 남은 카드 수로 순위를 정하고 끝낸다 (무한 반복 방지)
const NEED_LABEL = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠ · ♣", R: "♥ · ♦" };
const NEED_SET = { S: ["S"], H: ["H"], D: ["D"], C: ["C"], B: ["S", "C"], R: ["H", "D"] };
const CALL_P = {
  owner: { easy: .6, normal: .85, hard: .97 },            // 한 장 남은 사람이 외칠 확률
  other: { easy: .2, normal: .4, hard: .6 }               // 다른 사람이 잡으려 할 확률
};

/* ---------- 카드 성질 ---------- */
/* 공격 값: 2 → 2, A → 3, ♠A → 5, 흑백 조커 → 5, 컬러 조커 → 7. 공격 카드가 아니면 0 */
function power(c) {
  if (c === "JB") return 5;
  if (c === "JC") return 7;
  const r = rankOf(c);
  if (r === 2) return 2;
  if (r === 1) return c === "S1" ? 5 : 3;
  return 0;
}
const isPlain = c => !isJoker(c) && [3, 4, 5, 6, 8, 9, 10].includes(rankOf(c));
const top = S => S.discard[S.discard.length - 1];
const nm = c => cardName(c);

/* ---------- 자리 · 차례 ---------- */
const alive = (S, q) => S.st[q] === "in";
const aliveList = S => S.st.map((s, q) => (s === "in" ? q : -1)).filter(q => q >= 0);
function nextAlive(S, p, dir = S.dir) {
  for (let k = 1; k <= S.n; k++) { const q = ((p + dir * k) % S.n + S.n) % S.n; if (alive(S, q)) return q; }
  return -1;
}

/* 지금 c 를 낼 수 있는가 (손에 있는지는 따로 본다) */
function canPlay(S, c) {
  const t = top(S);
  if (S.attack > 0) {
    if (S.set.three && !isJoker(t) && rankOf(t) === 2 && !isJoker(c) && rankOf(c) === 3 && suitOf(c) === suitOf(t)) return true;
    const v = power(c);
    if (!v || v < power(t)) return false;
    return isJoker(c) || (!isJoker(t) && (suitOf(c) === suitOf(t) || rankOf(c) === rankOf(t)));
  }
  if (isJoker(c)) return true;
  if (S.need) return NEED_SET[S.need].includes(suitOf(c));
  return suitOf(c) === suitOf(t) || rankOf(c) === rankOf(t);
}
const legalCards = (S, p) => S.hands[p].filter(c => canPlay(S, c));
const needsSuit = c => !isJoker(c) && rankOf(c) === 7;

/* 원카드 창: 아직 결정하지 않은 사람들 (모든 자리) */
function callWaiting(S) {
  if (!S.call) return [];
  const out = [];
  for (let q = 0; q < S.n; q++) if (!S.call.skip.includes(q)) out.push(q);
  return out;
}

/* ---------- 카드 옮기기 ---------- */
/* 더미가 비면 버린 카드(맨 위 한 장 빼고)를 섞어 새 더미로 */
function refill(S, ev) {
  if (S.discard.length <= 1) return;
  const t = S.discard.pop();
  S.deck = shuffle(S, S.discard).concat(S.deck);
  S.discard = [t];
  // 섞여 들어간 카드는 다시 숨은 카드 — 최근 기록 · 마지막 행동에서도 지운다
  S.recent = S.recent.filter(r => r.c === t);
  S.act = S.act.map(a => (a && a.c && a.c !== t ? null : a));
  ev.push({ type: "shuffle", text: "버린 카드를 섞어 새 더미를 만들었습니다" });
}
/* p 가 n 장 받는다 — 모자라면 받을 수 있는 만큼만. 받은 카드 배열 */
function drawCards(S, p, n, ev) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!S.deck.length) refill(S, ev);
    if (!S.deck.length) break;
    got.push(S.deck.pop());
  }
  S.hands[p].push(...got);
  return got;
}

/* ---------- 순위 · 끝 ---------- */
function finish(S, p, ev) {
  S.st[p] = "done";
  S.done.push(p);
  S.place[p] = S.done.length;
  S.note[p] = S.set.end === "first" ? "1등 — 카드를 다 냄" : `${S.place[p]}등 — 카드를 다 냄`;
  if (S.set.end === "first") { endGame(S, ev, `{${p}} 님이 카드를 다 냈습니다! 1등 🎉`); return; }
  ev.push({ type: "out", p, place: S.place[p], text: `{${p}} 님이 카드를 다 냈습니다 (${S.place[p]}등)` });
  if (aliveList(S).length <= 1) endGame(S, ev);
}
/* 파산: 손패가 기준 이상이면 탈락 — 남은 사람 중 꼴찌. 카드는 더미 밑으로 */
function bustCheck(S, p, ev) {
  if (!S.set.bust || S.hands[p].length < S.set.bust || !alive(S, p)) return false;
  const k = S.hands[p].length;
  S.st[p] = "bust";
  S.busted.push(p);
  S.place[p] = S.n - S.busted.length + 1;
  S.note[p] = `파산 (${k}장)`;
  S.deck = shuffle(S, S.hands[p].splice(0)).concat(S.deck);
  ev.push({ type: "bust", p, n: k, text: `{${p}} 님 파산! (${k}장) — 탈락` });
  if (aliveList(S).length <= 1) endGame(S, ev);
  else if (S.turn === p) { S.turn = nextAlive(S, p); S.again = false; }
  return true;
}
/* 게임 끝: 남은 사람은 카드가 적은 순 (같으면 같은 순위) */
function endGame(S, ev, text) {
  S.phase = "over";
  S.call = null;
  S.again = false;
  const rest = aliveList(S), base = S.done.length + 1;
  for (const q of rest) {
    S.place[q] = base + rest.filter(o => S.hands[o].length < S.hands[q].length).length;
    S.note[q] = rest.length === 1 && base === 1 ? "1등 — 끝까지 살아남음" : `남은 카드 ${S.hands[q].length}장`;
  }
  if (!text) {
    if (rest.length === 1 && base === 1) text = `{${rest[0]}} 님만 남았습니다 — 1등 🎉`;
    else if (rest.length === 1) text = `게임 끝 — {${rest[0]}} 님이 마지막까지 남았습니다`;
    else text = "게임 끝";
  }
  ev.push({ type: "over", text });
}

/* 되풀이 감지: 더미가 빈 채로 똑같은 판(손패 · 버린 카드 · 차례)이 세 번 나오면 끝없이 도는 판이다 */
function repeated(S) {
  if (S.deck.length) { S.seen = {}; return false; }
  const sig = S.hands.map(h => h.slice().sort().join("")).join("|") + "/" + S.discard.join("") + "/" + [S.turn, S.dir, S.attack, S.need, S.again].join(",");
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 16777619);
  const key = (h >>> 0).toString(36);
  if (Object.keys(S.seen).length > 400) S.seen = {};
  S.seen[key] = (S.seen[key] || 0) + 1;
  return S.seen[key] >= 3;
}

/* ---------- 행동 처리 ---------- */
function doPlay(S, p, a, ev) {
  const c = a.card, hand = S.hands[p];
  hand.splice(hand.indexOf(c), 1);
  const wasAttack = S.attack > 0, before = aliveList(S).length;
  S.discard.push(c);
  if (!isJoker(c)) S.miss[p] = S.miss[p].filter(s => s !== suitOf(c));
  const r = isJoker(c) ? 0 : rankOf(c), v = power(c);
  const e = { type: "play", p, card: c, attack: 0, text: "" };
  if (wasAttack && r === 3) {                                   // 3으로 2 막기 — 벌칙이 모두 사라진다
    S.attack = 0; S.need = null;
    e.block = true;
    e.text = `{${p}} 님이 ${nm(c)}(으)로 공격을 막았습니다! 🛡️`;
  } else if (v) {
    S.attack += v;
    S.need = c === "JB" ? "B" : c === "JC" ? "R" : null;
    e.attack = S.attack;
    e.text = wasAttack ? `{${p}} 님이 ${nm(c)}(으)로 받아쳤습니다! (누적 ${S.attack}장)` : `{${p}} 님이 ${nm(c)} 공격! (누적 ${S.attack}장)`;
  } else {
    S.need = r === 7 ? a.suit : null;
    if (r === 7) { e.suit = a.suit; e.text = `{${p}} 님이 ${nm(c)} — 무늬를 ${SUIT_SYMBOL[a.suit]}(으)로 바꿨습니다`; }
    else e.text = `{${p}} 님이 ${nm(c)}을(를) 냈습니다`;
  }
  ev.push(e);
  S.recent.push(r === 7 ? { p, c, s: a.suit } : { p, c });
  if (S.recent.length > 6) S.recent.shift();
  S.act[p] = { c };
  if (!hand.length) { finish(S, p, ev); if (S.phase !== "play") return; }

  // 다음 차례
  if (r === 13 && alive(S, p)) {
    S.again = true; S.turn = p;
    e.text += " — 한 장 더!";
  } else {
    S.again = false;
    if (r === 12) { S.dir = -S.dir; e.reverse = true; }
    let t = nextAlive(S, p);
    if (r === 11 || (r === 12 && before <= 2)) {
      e.skip = t;
      if (r === 11) e.text += ` — {${t}} 님 건너뜀`;
      t = nextAlive(S, t);
    }
    if (r === 12) e.text += before <= 2 ? " — 방향 바꿈 (둘이라 한 번 더)" : " — 방향이 바뀝니다";
    S.turn = t;
  }
  // 한 장 남았으면 원카드 외치기 창
  if (S.set.call && hand.length === 1 && alive(S, p)) {
    S.call = { p, skip: [] };
    ev.push({ type: "callOpen", p });
  }
}

function doDraw(S, p, ev) {
  const pen = S.attack, want = pen > 0 ? pen : 1;
  if (!pen) for (const s of NEED_SET[S.need] || [suitOf(top(S))]) if (SUITS.includes(s) && !S.miss[p].includes(s)) S.miss[p].push(s);
  const got = drawCards(S, p, want, ev);
  if (pen >= 3) S.miss[p] = [];
  S.attack = 0;
  S.again = false;
  let text;
  if (!got.length) text = `{${p}} 님이 넘겼습니다 (받을 카드가 없음)`;
  else if (pen) text = `{${p}} 님이 공격을 받아 ${got.length}장을 가져갔습니다`;
  else text = `{${p}} 님이 카드를 한 장 받았습니다`;
  ev.push({ type: "draw", p, n: got.length, cards: got, reason: pen ? "penalty" : "pass", text });
  S.act[p] = { d: got.length, pen: pen > 0 };
  bustCheck(S, p, ev);
  if (S.phase === "play") S.turn = nextAlive(S, p);
}

function doCall(S, p, a, ev) {
  const o = S.call.p;
  if (a.call) {
    S.call = null;
    if (p === o) { ev.push({ type: "call", p, owner: o, safe: true, text: `{${o}} 님: "원카드!" 📣` }); return; }
    const got = drawCards(S, o, 1, ev);
    ev.push({ type: "call", p, owner: o, safe: false, text: `{${p}} 님이 {${o}} 님을 잡았습니다! {${o}} 님 ${got.length}장 추가` });
    ev.push({ type: "draw", p: o, n: got.length, cards: got, reason: "catch" });
    S.act[o] = { d: got.length, pen: true, catch: true };
    bustCheck(S, o, ev);
    return;
  }
  S.call.skip.push(p);
  if (!callWaiting(S).length) {
    S.call = null;
    ev.push({ type: "call", p: -1, owner: o, safe: null, text: `원카드 — 아무도 {${o}} 님을 잡지 못했습니다` });
  }
}

/* ---------- AI ---------- */
function suitCounts(cards) {
  const k = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of cards) if (!isJoker(c)) k[suitOf(c)]++;
  return k;
}
/* 7 로 바꿀 무늬: 내가 가장 많이 든 무늬 (어려움: 다음 사람이 없는 듯한 무늬를 조금 더 쳐 준다) */
function bestSuit(S, p, rest, level, rng, nx) {
  const k = suitCounts(rest);
  let best = SUITS[Math.floor(rng() * 4)], bs = -1;
  for (const s of SUITS) {
    let sc = k[s] * 2 + rng() * .5;
    if (level === "hard" && nx >= 0 && S.miss[nx].includes(s)) sc += 1.5;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

/* 어려움 전용 — 카드 세기: 내가 못 본 카드(남의 패 + 더미) 중 q 가 h 장을 들고 있다고 보고,
   받아칠 카드가 m 장일 때 q 가 하나도 없을 확률 */
const ALL = [...deck52(), "JB", "JC"];
function unseenOf(S, p) {
  const seen = new Set(S.hands[p].concat(S.discard));
  return ALL.filter(c => !seen.has(c));
}
function pNone(U, m, h) {
  let pr = 1;
  for (let i = 0; i < h && pr > 0; i++) pr *= U - i > 0 ? Math.max(0, U - m - i) / (U - i) : 0;
  return pr;
}
/* c 를 낸 뒤 다음 사람이 낼 수 있는 카드 (공격이면 받아칠 카드) */
function answers(unseen, c, suit, attack, three) {
  if (power(c)) {
    const v = power(c);
    return unseen.filter(x => (power(x) >= v && (isJoker(x) || (!isJoker(c) && (suitOf(x) === suitOf(c) || rankOf(x) === rankOf(c))))) ||
      (three && !isJoker(c) && rankOf(c) === 2 && !isJoker(x) && rankOf(x) === 3 && suitOf(x) === suitOf(c))).length;
  }
  const need = isJoker(c) ? null : rankOf(c) === 7 ? suit : null;
  return unseen.filter(x => isJoker(x) || (need ? suitOf(x) === need : suitOf(x) === suitOf(c) || rankOf(x) === rankOf(c))).length;
}
const urgency = h => (h <= 1 ? 4 : h <= 2 ? 2.5 : h <= 4 ? 1.4 : 1);

function aiPlay(S, p, level, rng) {
  const hand = S.hands[p];
  const plays = legalCards(S, p);
  const nx = nextAlive(S, p);
  const nxN = nx >= 0 ? S.hands[nx].length : 99;
  const hard = level === "hard";
  const unseen = hard ? unseenOf(S, p) : null;
  const suitFor = c => (level === "easy" ? SUITS[Math.floor(rng() * 4)] : bestSuit(S, p, hand.filter(x => x !== c), level, rng, nx));
  const act = (c, suit) => (needsSuit(c) ? { card: c, suit: suit || suitFor(c) } : { card: c });
  /* 어려움: c 를 냈을 때 다음 사람이 막혀서 받게 될 장수의 기댓값 (그 사람이 거의 다 냈으면 더 크게) */
  const squeeze = (c, suit) => {
    if (!hard || nx < 0) return 0;
    const v = power(c), A = S.attack + v;
    const pr = pNone(unseen.length, answers(unseen, c, suit, A, S.set.three), nxN);
    let g = pr * (v ? A : 1) * urgency(nxN);
    if (v && aliveList(S).length === 2) g -= (1 - pr) * A * .4;      // 둘이면 막힌 공격이 나에게 돌아온다
    return g;
  };

  // 공격을 받는 중: 막거나 받는다
  if (S.attack > 0) {
    if (!plays.length) return { draw: true };
    if (level === "easy") return rng() < .5 ? act(plays[Math.floor(rng() * plays.length)]) : { draw: true };
    const block = plays.find(c => !isJoker(c) && rankOf(c) === 3);
    const hits = plays.filter(c => power(c) > 0);
    if (!hits.length) return act(block);
    if (hard && block && hand.length > 1 && aliveList(S).length === 2 && S.attack >= 4) return act(block);   // 둘이면 넘긴 공격이 돌아온다 — 끊는다
    if (!hard && block && hand.length > 1 && rng() < .3) return act(block);
    if (hard && nxN <= 2) {                                    // 거의 다 낸 사람에게는 가장 막기 어려운 카드로 넘긴다
      hits.sort((a, b) => squeeze(b) - squeeze(a));
      return act(hits[0]);
    }
    hits.sort((a, b) => power(a) - power(b) || (isJoker(a) - isJoker(b)));   // 가장 약한 카드로 넘기고 센 카드는 아낀다
    return act(hits[0]);
  }

  if (!plays.length) return { draw: true };
  if (level === "easy") return act(plays[Math.floor(rng() * plays.length)]);

  const k = suitCounts(hand);
  const prev = nextAlive(S, p, -S.dir);
  const prevN = prev >= 0 ? S.hands[prev].length : 99;
  let best = plays[0], bestSuit7 = null, bs = -Infinity;
  for (const c of plays) {
    const r = isJoker(c) ? 0 : rankOf(c), v = power(c), rest = hand.filter(x => x !== c);
    let s = isJoker(c) ? 0 : k[suitOf(c)];                 // 많이 든 무늬부터 턴다
    let suit7 = null;
    if (r === 7) {                                           // 7: 바꿀 무늬까지 함께 고른다
      suit7 = suitFor(c);
      if (hard) {
        const kr = suitCounts(rest);
        let b = -Infinity;
        for (const su of SUITS) { const x = kr[su] * 1.2 + squeeze(c, su) * 2; if (x > b) { b = x; suit7 = su; } }
      }
    }
    // 어려움: 다음 사람이 받아칠 카드를 들고 있을 확률 (J 면 그다음 사람, K 면 내가 또 낸다)
    if (hard && !v && r !== 13 && r !== 11 && !(r === 12 && aliveList(S).length > 2)) s += squeeze(c, suit7) * 2;
    if (v) {                                                 // 공격 카드 · 조커는 막을 때를 위해 아낀다
      s -= isJoker(c) ? 8 : v * 1.2;
      if (nxN <= 2) s += 10 + v;                             // 다음 사람이 거의 다 냈으면 공격
      else if (nxN <= 4) s += 2;
      if (hand.length <= 3) s += 3;
    }
    if (r === 13) {                                          // K: 이어서 낼 카드가 있으면 이득
      const follow = rest.filter(x => isJoker(x) || suitOf(x) === suitOf(c) || rankOf(x) === 13);
      s += follow.length ? 6 : -1;
    }
    if (r === 7 && hand.length > 2) s -= 3;                  // 7 은 막혔을 때 쓰려고 아낀다
    if (rest.length === 1 && isJoker(rest[0])) s += 6;       // 마지막 한 장은 조커로 남긴다
    if (rest.length === 1 && isJoker(c)) s -= 8;
    if (hard) {
      if (!isJoker(c) && r !== 7 && S.miss[nx] && S.miss[nx].includes(suitOf(c))) s += 3;  // 다음 사람이 없는 무늬
      if (r === 11) s += nxN <= 2 ? 8 : nxN <= 4 ? 2 : 0;    // J: 거의 다 낸 사람 건너뛰기
      if (r === 12) s += prevN > nxN + 1 ? 4 : prevN + 1 < nxN ? -3 : 0;   // Q: 카드 많은 쪽으로 차례를 돌린다
      if (v && nxN <= 2 && power(c) >= 5) s += 3;
      // 쉬운 무늬 넘겨주지 않기: 다음 사람이 방금 낸 무늬(많이 들었을 법한)는 피한다
      if (!isJoker(c) && S.lastSuit[nx] === suitOf(c) && r !== 7) s -= 1.5;
    }
    s += rng() * .6;
    if (s > bs) { bs = s; best = c; bestSuit7 = suit7; }
  }
  return act(best, bestSuit7);
}

/* ---------- 규칙 설명 ---------- */
const rules = `<ul>
  <li>카드 52장에 <b>흑백 조커 · 컬러 조커</b>를 더한 54장. 처음에 7장(또는 5장)씩 나누고, 더미에서 한 장을 펼칩니다 (3·4·5·6·8·9·10 이 나올 때까지 넘깁니다). 첫 차례는 무작위.</li>
  <li>내 차례에는 맨 위 카드와 <b>무늬나 숫자가 같은 카드</b> 한 장을 냅니다. <b>조커</b>는 공격받는 중이 아니면 아무 때나 낼 수 있습니다.</li>
  <li>낼 카드가 없거나 내고 싶지 않으면 <b>1장 받고</b> 차례를 넘깁니다 (받은 카드는 그 차례에 낼 수 없음).</li>
</ul>
<h4>공격 카드</h4>
<ul>
  <li><b>2</b> → 2장 · <b>A</b> → 3장 · <b>♠A</b> → 5장 · <b>흑백 조커</b> → 5장 · <b>컬러 조커</b> → 7장. 내면 벌칙이 그만큼 쌓입니다.</li>
  <li>공격받은 사람은 <b>맨 위 공격 카드보다 값이 같거나 큰 공격 카드</b>로 받아칠 수 있습니다 — 단 맨 위 카드와 <b>무늬나 숫자가 같거나 조커</b>여야 합니다. 벌칙이 더해져 다음 사람에게 넘어갑니다.</li>
  <li>예: ♥2 위에 ♥A·♠2·조커 가능 / A 위에 2 는 불가 / 흑백 조커 위에는 컬러 조커만 / 컬러 조커는 못 막음.</li>
  <li><b>3으로 2 막기</b>(설정): 맨 위가 2일 때 <b>같은 무늬의 3</b>을 내면 쌓인 벌칙이 모두 사라지고 그 3 위에서 평소처럼 이어갑니다.</li>
  <li>막지 못하거나 막지 않으면 <b>쌓인 장수를 모두 받고</b> 차례가 끝납니다.</li>
  <li>흑백 조커 다음에는 <b>♠·♣</b>, 컬러 조커 다음에는 <b>♥·♦</b> 카드만 낼 수 있습니다 (숫자 상관없음, 조커는 가능).</li>
</ul>
<h4>특수 카드</h4>
<ul>
  <li><b>7</b> 무늬 바꾸기: 다음 사람이 낼 무늬를 정합니다 (그 무늬나 조커만 낼 수 있음).</li>
  <li><b>J</b> 다음 사람 건너뛰기 · <b>Q</b> 방향 바꾸기 (둘이 할 때는 J 와 같음) · <b>K</b> 한 장 더 내기 (낼 카드가 없으면 1장 받고 끝).</li>
</ul>
<h4>원카드 · 파산 · 끝</h4>
<ul>
  <li><b>원카드 외치기</b>(설정): 카드가 <b>한 장</b> 남으면 모두에게 「원카드!」 버튼이 4초 동안 뜹니다. 본인이 먼저 누르면 무사, <b>다른 사람이 먼저 누르면 잡혀서 1장</b>을 받습니다. 아무도 안 누르면 그냥 넘어갑니다.</li>
  <li>더미가 떨어지면 버린 카드(맨 위 한 장 빼고)를 섞어 새 더미를 만듭니다. 그래도 없으면 받을 수 있는 만큼만 받습니다.</li>
  <li><b>파산</b>(설정): 손패가 15장(또는 20장) 이상이 되면 탈락 — 남은 사람 중 꼴찌가 되고 카드는 더미 밑으로 갑니다.</li>
  <li><b>끝</b>(설정): 「1등이 나오면 끝」이면 누군가 카드를 다 내는 순간 끝나고, 나머지는 남은 카드가 적은 순 (같으면 같은 순위). 「꼴찌까지」면 한 명만 남을 때까지 계속합니다.</li>
  <li>마지막 카드가 특수 · 공격 카드여도 다 낸 것으로 칩니다 (공격은 다음 사람에게 넘어감).</li>
  <li>더미가 바닥난 채 <b>똑같은 판이 세 번 되풀이</b>되거나 판이 너무 길어지면(3000수), 그 자리에서 남은 카드 수로 순위를 정합니다.</li>
</ul>`;

export default {
  id: "onecard",
  name,
  icon: "🎴",
  blurb: "무늬나 숫자를 맞춰 내고, 공격 카드로 벌칙을 떠넘겨요. 한 장 남으면 원카드!",
  players: { min: 2, max: 6, default: 4 },
  settings: [
    { key: "hand", label: "시작 장수", values: [5, 7], labels: ["5장", "7장"], default: 7 },
    { key: "three", label: "3으로 2 막기", values: [true, false], labels: ["켬", "끔"], default: true, note: "2 위에 같은 무늬 3을 내면 공격이 사라집니다" },
    { key: "call", label: "원카드 외치기", values: [true, false], labels: ["켬", "끔"], default: true, note: "한 장 남았을 때 먼저 누르기 — 남이 먼저 누르면 1장" },
    { key: "bust", label: "파산", values: [0, 15, 20], labels: ["끔", "15장", "20장"], default: 20, note: "손패가 이만큼 되면 탈락" },
    { key: "end", label: "끝나는 때", values: ["first", "all"], labels: ["1등이 나오면", "꼴찌까지"], default: "first", note: "꼴찌까지는 한 명만 남을 때까지 — 사람이 많으면 꽤 오래 걸립니다" }
  ],
  rules,
  stepLimit: 60000,

  setup({ n, seed, settings = {} }) {
    const pickSet = (k, vals, d) => (vals.includes(settings[k]) ? settings[k] : d);
    const set = {
      hand: pickSet("hand", [5, 7], 7), three: pickSet("three", [true, false], true), call: pickSet("call", [true, false], true),
      bust: pickSet("bust", [0, 15, 20], 20), end: pickSet("end", ["first", "all"], "first")
    };
    const S = {
      n, rs: seed >>> 0, set, deck: [], discard: [], hands: [], st: [], place: [], note: [], miss: [], lastSuit: [],
      done: [], busted: [], recent: [], act: [], dir: 1, turn: 0, attack: 0, need: null, again: false, call: null, phase: "play", moves: 0, last: "", seen: {}
    };
    S.deck = shuffle(S, [...deck52(), "JB", "JC"]);
    for (let p = 0; p < n; p++) { S.hands.push([]); S.st.push("in"); S.place.push(0); S.note.push(""); S.miss.push([]); S.lastSuit.push(null); S.act.push(null); }
    for (let i = 0; i < set.hand; i++) for (let p = 0; p < n; p++) S.hands[p].push(S.deck.pop());
    do S.discard.push(S.deck.pop()); while (!isPlain(top(S)) && S.deck.length);
    S.recent.push({ p: -1, c: top(S) });                  // 첫 카드 (p: -1)
    S.turn = randInt(S, n);
    S.last = `첫 카드 ${nm(top(S))} — {${S.turn}} 님부터`;
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    if (S.call) return callWaiting(S).map(p => ({ p, kind: "call", time: 4 }));
    return [{ p: S.turn, kind: "play" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play") return "게임이 끝났습니다";
    if (!a || typeof a !== "object") return "행동을 고르세요";
    if (S.call) {
      if (!callWaiting(S).includes(p)) return "원카드 결과를 기다리는 중입니다";
      if (typeof a.call !== "boolean") return "「원카드!」 버튼을 누르세요";
      return true;
    }
    if (p !== S.turn) return "지금은 내 차례가 아닙니다";
    if (a.draw === true) return true;
    if (typeof a.card !== "string") return "낼 카드를 고르세요";
    if (!S.hands[p].includes(a.card)) return "내 손에 없는 카드입니다";
    if (!canPlay(S, a.card)) {
      if (S.attack > 0) return `공격 중입니다 — 막을 수 있는 카드만 낼 수 있습니다 (아니면 ${S.attack}장 받기)`;
      if (S.need) return `지금은 ${NEED_LABEL[S.need]} 무늬(또는 조커)만 낼 수 있습니다`;
      return "맨 위 카드와 무늬나 숫자가 같아야 합니다";
    }
    if (needsSuit(a.card) && !SUITS.includes(a.suit)) return "바꿀 무늬를 고르세요";
    return true;
  },

  apply(S, p, a) {
    const ev = [];
    if (S.call) doCall(S, p, a, ev);
    else {
      S.moves++;
      if (a.draw) doDraw(S, p, ev);
      else { doPlay(S, p, a, ev); if (!isJoker(a.card)) S.lastSuit[p] = suitOf(a.card); }
      if (S.phase === "play" && S.moves >= MAX_MOVES) endGame(S, ev, "너무 길어져서 남은 카드 수로 순위를 정합니다");
      else if (S.phase === "play" && !S.call && repeated(S)) endGame(S, ev, "같은 판이 계속 되풀이되어 남은 카드 수로 순위를 정합니다");
    }
    const t = ev.filter(e => e.text).pop();
    if (t) S.last = t.text;
    return ev;
  },

  step() { return []; },
  delay() { return 600; },

  /* 받은 카드는 받은 사람만 본다 */
  filterEvent(ev, p) {
    if (ev.type === "draw" && ev.p !== p) return { ...ev, cards: null };
    return ev;
  },

  timeout(S, p, kind) {
    if (kind === "call" || S.call) return { call: false };
    return { draw: true };
  },
  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    if (S.call) {
      const P = (p === S.call.p ? CALL_P.owner : CALL_P.other)[level] ?? .5;
      return { call: rng() < P };
    }
    return aiPlay(S, p, level, rng);
  },
  thinkTime(S, p, kind) {
    if (kind === "call" && S.call) return p === S.call.p ? 500 + Math.random() * 1500 : 900 + Math.random() * 2600;
    if (S.attack > 0) return 800 + Math.random() * 700;
    return 650 + Math.random() * 650;
  },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const myTurn = S.phase === "play" && !S.call && S.turn === me;
    const order = c => (isJoker(c) ? 400 + (c === "JC" ? 1 : 0) : SUITS.indexOf(suitOf(c)) * 100 + (rankOf(c) === 1 ? 14 : rankOf(c)));
    const hand = me >= 0 ? S.hands[me].slice().sort((a, b) => order(a) - order(b)) : [];
    let status = "";
    if (S.phase === "over") status = "게임 끝";
    else if (S.call) status = S.call.p === me ? "한 장 남았습니다 — 원카드!" : callWaiting(S).includes(me) ? "원카드 — 먼저 누르면 잡습니다!" : "원카드 — 결과를 기다리는 중";
    else if (myTurn) status = S.attack > 0 ? `공격 +${S.attack} — 막거나 받으세요` : S.again ? "K — 한 장 더 내세요" : "내 차례 — 낼 카드를 고르세요";
    else if (me >= 0 && S.st[me] === "done") status = "카드를 다 냈습니다 — 구경 중";
    else if (me >= 0 && S.st[me] === "bust") status = "파산 — 구경 중";
    return {
      phase: S.phase, turn: S.turn, dir: S.dir, top: top(S), under: S.discard.slice(-4, -1),
      need: S.need, attack: S.attack, again: S.again, deck: S.deck.length, pile: S.discard.length,
      sizes: S.hands.map(h => h.length), st: S.st.slice(), place: S.place.slice(), hand,
      legal: myTurn ? legalCards(S, me) : [],
      call: S.call ? { p: S.call.p, waiting: callWaiting(S).includes(me) } : null,
      recent: S.recent.map(r => ({ ...r })),          // 최근에 낸 카드 (오래된 것부터, 섞이면 비워짐)
      act: S.act.map(a => (a ? { ...a } : null)),      // 사람마다 마지막 행동: {c} 냄 · {d, pen, catch?} 받음
      last: S.last, set: { ...S.set }, status
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.place.map((rank, p) => ({ p, rank, note: S.note[p] }));
  },

  /* ---------- 시험용 ---------- */
  randomAction(S, p, rng, kind) {
    if (S.call) return { call: rng() < .3 };
    const plays = legalCards(S, p);
    if (plays.length && rng() < .85) {
      const c = plays[Math.floor(rng() * plays.length)];
      return needsSuit(c) ? { card: c, suit: SUITS[Math.floor(rng() * 4)] } : { card: c };
    }
    return { draw: true };
  },
  check(S) {
    const all = [...S.deck, ...S.discard, ...S.hands.flat()];
    if (all.length !== TOTAL) return `카드 수가 맞지 않음 ${all.length} (더미 ${S.deck.length} · 버림 ${S.discard.length})`;
    if (new Set(all).size !== TOTAL) return "같은 카드가 두 번 있음";
    if (!S.discard.length) return "버린 카드 더미가 비었음";
    if (!Number.isInteger(S.attack) || S.attack < 0) return `벌칙 값 이상 ${S.attack}`;
    const t = top(S);
    if (S.attack > 0 && !power(t)) return `공격 중인데 맨 위가 공격 카드가 아님 ${t}`;
    if (isJoker(t) ? S.need !== (t === "JB" ? "B" : "R") : rankOf(t) === 7 ? !SUITS.includes(S.need) : S.need !== null) return `무늬 지정 이상 ${t} ${S.need}`;
    for (let q = 0; q < S.n; q++) if (S.st[q] !== "in" && S.hands[q].length) return `${q}번은 끝났는데 카드가 남음`;
    if (S.phase === "play") {
      if (!alive(S, S.turn)) return `차례(${S.turn})가 게임에 없는 사람`;
      if (aliveList(S).length < 2) return "남은 사람이 둘 미만인데 진행 중";
      if (S.again && S.attack) return "K 한 장 더 중에 공격";
      if (S.call && (S.hands[S.call.p].length !== 1 || !alive(S, S.call.p))) return "원카드 창 주인의 카드가 한 장이 아님";
      if (S.set.end === "first" && S.done.length) return "1등이 나왔는데 끝나지 않음";
    } else {
      const ranks = S.place.filter(r => r < 1 || r > S.n);
      if (ranks.length) return `순위 이상 ${S.place}`;
    }
    if (S.set.bust) for (let q = 0; q < S.n; q++) if (alive(S, q) && S.hands[q].length >= S.set.bust) return `${q}번 파산 처리 안 됨`;
    return true;
  },
  leak(S, p, v) {
    const hidden = new Set(S.deck);
    S.hands.forEach((h, q) => { if (q !== p) h.forEach(c => hidden.add(c)); });
    const bad = [];
    (function walk(x) {
      if (typeof x === "string") { if (hidden.has(x)) bad.push(x); }
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x).forEach(walk);
    })(v);
    if (bad.length) return `숨은 카드 노출: ${bad.slice(0, 5).join(",")}`;
    if (v.hand.length !== S.hands[p].length) return "내 패 장수가 다름";
    return true;
  }
};
