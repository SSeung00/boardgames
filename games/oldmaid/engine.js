/* 도둑잡기 — 조커 1장을 섞은 53장. 같은 숫자 두 장은 버리고, 다음 사람의 패에서 한 장씩 뽑는다.
   패를 다 없앤 순서대로 순위, 마지막까지 조커를 든 사람이 꼴찌(도둑). */
import { shuffle } from "../../core/rng.js";
import { deck52, rankOf, isJoker, rankLabel } from "../../core/cards.js";

const name = "도둑잡기";

function nextWithCards(S, p) {
  for (let k = 1; k <= S.n; k++) { const q = (p + k) % S.n; if (S.hands[q].length) return q; }
  return -1;
}
/* 손패에서 짝을 모두 버린다 → 버린 숫자 목록 */
function dropPairs(hand) {
  const by = new Map();
  hand.forEach((c, i) => { if (!isJoker(c)) { const r = rankOf(c); (by.get(r) || by.set(r, []).get(r)).push(i); } });
  const drop = new Set(), ranks = [];
  for (const [r, idx] of by) for (let k = 0; k + 1 < idx.length; k += 2) { drop.add(idx[k]); drop.add(idx[k + 1]); ranks.push(r); }
  const kept = hand.filter((_, i) => !drop.has(i));
  hand.length = 0; hand.push(...kept);
  return ranks;
}
function settle(S, ev) {
  for (let p = 0; p < S.n; p++) if (!S.hands[p].length && !S.out.includes(p)) {
    S.out.push(p);
    ev.push({ type: "out", p, place: S.out.length, text: `{${p}} 님이 패를 다 털었습니다 (${S.out.length}등)` });
  }
  const left = S.hands.map((h, p) => h.length ? p : -1).filter(p => p >= 0);
  if (left.length <= 1) {
    S.phase = "over";
    S.loser = left.length ? left[0] : null;
    if (S.loser !== null) S.out.push(S.loser);
    ev.push({ type: "over", loser: S.loser, text: S.loser !== null ? `{${S.loser}} 님이 도둑! 조커를 끝까지 들고 있었습니다` : "게임 끝" });
    return;
  }
}

export default {
  id: "oldmaid",
  name,
  icon: "🃏",
  blurb: "짝을 버리고 옆 사람 패를 한 장씩 뽑아요. 마지막까지 조커를 든 사람이 도둑!",
  players: { min: 2, max: 8, default: 4 },
  settings: [],
  rules: `<ul>
    <li>카드 52장에 <b>조커 1장</b>을 섞어 모두 나눠 줍니다.</li>
    <li>손에 같은 숫자 두 장이 있으면 짝으로 버립니다 (자동).</li>
    <li>내 차례에는 <b>다음 사람</b>의 패에서 안 보이는 카드 한 장을 뽑습니다. 짝이 맞으면 버립니다.</li>
    <li>패를 먼저 다 없앤 순서대로 순위가 정해지고, <b>마지막까지 조커를 든 사람</b>이 집니다.</li>
  </ul>`,

  setup({ n, seed }) {
    const S = { n, rs: seed >>> 0, hands: [], out: [], phase: "play", turn: 0, loser: null, discards: 0, last: null, round: 0 };
    const deck = shuffle(S, [...deck52(), "JC"]);
    for (let p = 0; p < n; p++) S.hands.push([]);
    deck.forEach((c, i) => S.hands[i % n].push(c));
    for (const h of S.hands) S.discards += dropPairs(h).length * 2;
    S.turn = Math.floor(S.rs % n);
    const ev = [];
    settle(S, ev);
    if (S.phase === "play" && !S.hands[S.turn].length) S.turn = nextWithCards(S, S.turn);
    for (const h of S.hands) shuffle(S, h);
    return S;
  },

  pending(S) {
    if (S.phase !== "play") return [];
    return [{ p: S.turn, kind: "draw" }];
  },

  validate(S, p, a) {
    if (S.phase !== "play" || p !== S.turn) return "지금은 내 차례가 아닙니다";
    const v = nextWithCards(S, p);
    if (!a || !Number.isInteger(a.i) || a.i < 0 || a.i >= S.hands[v].length) return "뽑을 카드를 고르세요";
    return true;
  },

  apply(S, p, a) {
    const v = nextWithCards(S, p);
    const [card] = S.hands[v].splice(a.i, 1);
    const hand = S.hands[p];
    hand.push(card);
    const ranks = dropPairs(hand);
    S.discards += ranks.length * 2;
    S.last = { from: v, to: p, paired: ranks.length ? ranks[0] : null };
    const ev = [{ type: "draw", from: v, to: p, i: a.i, card, paired: ranks.length ? ranks[0] : null, joker: isJoker(card),
      text: `{${p}} 님이 {${v}} 님의 카드를 뽑았습니다` + (ranks.length ? ` — 짝! (${rankLabel(ranks[0])})` : "") }];
    settle(S, ev);
    if (S.phase === "play") {
      S.turn = nextWithCards(S, p);
      shuffle(S, S.hands[nextWithCards(S, S.turn)]);   // 뽑힐 사람의 패는 매번 섞여 있다
    }
    return ev;
  },

  /* 뽑은 카드는 뽑은 사람과 뽑힌 사람만 안다 (짝이 맞아 버린 숫자는 모두가 본다) */
  filterEvent(ev, p) {
    if (ev.type === "draw" && p !== ev.from && p !== ev.to) return { ...ev, card: null, joker: null };
    return ev;
  },

  timeout(S, p) { return { i: 0 }; },
  ai(S, p, { rng }) {
    const v = nextWithCards(S, p);
    return { i: Math.floor(rng() * S.hands[v].length) };
  },
  thinkTime() { return 600 + Math.random() * 600; },

  view(S, p) {
    const victim = S.phase === "play" ? nextWithCards(S, S.turn) : -1;
    const mine = p >= 0 ? S.hands[p].slice().sort((a, b) => (isJoker(a) ? 99 : rankOf(a)) - (isJoker(b) ? 99 : rankOf(b)) || a.localeCompare(b)) : [];
    return {
      phase: S.phase, turn: S.turn, victim, sizes: S.hands.map(h => h.length), out: S.out.slice(), loser: S.loser,
      discards: S.discards, last: S.last, hand: mine,
      status: S.phase === "over" ? "게임 끝" : (p === S.turn ? "내 차례 — 한 장 뽑으세요" : "")
    };
  },

  over(S) { return S.phase === "over"; },
  results(S) {
    return S.out.map((p, i) => ({ p, rank: i + 1, note: p === S.loser ? "도둑 (조커)" : `${i + 1}번째로 탈출` }));
  },

  /* 테스트용: 아무 규칙 맞는 행동 */
  randomAction(S, p, rng) { return this.ai(S, p, { rng }); },
  leak(S, p, v) {
    const mine = S.hands[p].slice().sort().join();
    if (v.hand.slice().sort().join() !== mine) return "내 패가 아닌 카드가 view 에 있음";
    const others = new Set(S.hands.flatMap((h, q) => q === p ? [] : h));
    if (JSON.stringify(v).match(/"[SHDC]\d{1,2}"|"JC"/g)?.some(c => others.has(c.slice(1, -1)))) return "남의 카드가 view 에 있음";
    return true;
  },
  check(S) {
    const total = S.hands.reduce((a, h) => a + h.length, 0) + S.discards;
    if (total !== 53) return `카드 수가 맞지 않음 ${total}`;
    for (const h of S.hands) {
      const seen = new Set();
      for (const c of h) if (!isJoker(c)) { const r = rankOf(c); if (seen.has(r)) return "손에 짝이 남아 있음"; seen.add(r); }
    }
    return true;
  }
};
