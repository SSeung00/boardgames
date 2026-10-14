/* 달무티 — 놀이방 엔진 모듈.
   규칙은 rules.js (원본 dalmuti/web/engine.js 를 그대로 옮긴 것) 가 집행하고, 이 파일은 놀이방 진행기(core/host.js)의
   pending / validate / apply / step 흐름에 맞춰 원본 온라인판(online.js 의 Host.run) 순서를 옮긴다.

   흐름: 자리 뽑기(step) → 딜(step) → [2라운드부터] 혁명 질문(후보에게만, 비밀) → 세금(상납 자동 → 달무티가 돌려줄 카드 고르기)
        → 플레이(현재 차례 한 사람) → 라운드 끝(순위 보여 주기, step) → 다음 라운드 … → 끝
   공정 규칙: 카드 카운터 없음 · 이번 판(트릭) 기록만 보여 준다 · 남의 세금 내용과 혁명 질문은 당사자에게만. */
import * as R from "./rules.js";
import * as AI from "./ai.js";

const { JESTER, T, ACTIONS } = R;
export const CARD_NAMES = ["달무티", "대주교", "남작부인", "수녀원장", "기사", "재봉사", "석공", "요리사", "양치기", "채석공", "소작농", "농노"];
export const cardName = r => r === JESTER ? "광대" : CARD_NAMES[r - 1];
export const TITLE_NAMES = ["평민", "대달무티", "소달무티", "상인", "소농노", "대농노"];
const TITLE_SHORT = ["평민", "대달", "소달", "상인", "소농", "대농"];

/* 학습된 정책(어려움 AI)은 350KB 라서 방장이 게임을 시작할 때만 따로 불러온다. 불러오기 전에는 휴리스틱 '어려움'을 쓴다. */
let POLICY = null, policyLoading = null;
export function loadLearned() {
  if (!policyLoading) {
    policyLoading = import("./policy.js")
      .then(m => (POLICY = AI.loadPolicy(m.default)))
      .catch(e => { console.warn("달무티 학습 정책을 불러오지 못했습니다", e); return null; });
  }
  return policyLoading;
}
export const policyReady = () => !!POLICY;
const HARD_TAU = 0.05;   // 원본 온라인판의 '어려움' 온도

/* ---------- 도우미 ---------- */
const sizes = G => G.hands.map((_, p) => R.handSize(G, p));
const label = r => r === JESTER ? "광대" : `${cardName(r)}(${r})`;

/* 행동 → 행동 번호. {id} 또는 {rank, plain, jesters} 또는 {pass:true}. 모양이 틀리면 null */
function toId(a) {
  if (!a || typeof a !== "object") return null;
  if (a.pass === true) return 0;
  if (a.id !== undefined) return Number.isInteger(a.id) && a.id >= 0 && a.id < ACTIONS.length ? a.id : null;
  const r = a.rank, k = a.plain === undefined ? 0 : a.plain, j = a.jesters === undefined ? 0 : a.jesters;
  if (![r, k, j].every(Number.isInteger)) return null;
  try { return R.actionId(r, k, j); } catch (e) { return null; }
}
function revoltCandidate(S) {
  const G = S.g;
  if (G.phase !== "revolution") return -1;
  return R.revolutionCandidate(G);
}
/* 혁명 질문을 받을 사람 (대농노는 묻지 않고 바로 대혁명 — 원본과 같다) */
function revoltAsk(S) {
  const c = revoltCandidate(S);
  return c >= 0 && S.g.titles[c] !== T.GP ? c : -1;
}
function curTax(S) {
  return S.tax && !S.tax.done && S.tax.stage === "return" ? S.tax.pairs[S.tax.i] : null;
}
function startTax(S) {
  const G = S.g;
  R.skipRevolution(G);
  S.tax = { pairs: R.taxPairs(G).map(x => ({ ...x, up: null, down: null })), i: 0, stage: "up", done: false };
  const t = S.tax.pairs.map(x => `{${x.peon}} → {${x.lord}} ${x.k}장`).join(", ");
  return [{ type: "taxStart", pairs: S.tax.pairs.map(x => ({ peon: x.peon, lord: x.lord, k: x.k })), text: `세금: ${t || "없음"}` }];
}
function doRevolt(S, c) {
  const G = S.g;
  const { great } = R.declareRevolution(G, c);
  S.trickLog = []; S.prevTrick = null;
  return [{
    type: "revolt", p: c, great, toast: true,
    text: great ? `대혁명! 대농노 {${c}} 님이 광대 2장을 펼쳤습니다 — 서열이 뒤집힙니다`
                : `혁명! {${c}} 님이 광대 2장을 펼쳤습니다 — 이번 라운드 세금 없음`
  }];
}
function dealRound(S) {
  const G = S.g;
  R.deal(G);
  S.tax = null; S.trickLog = []; S.prevTrick = null;
  const ev = [{ type: "deal", round: G.round, text: `라운드 ${G.round} / ${G.rounds} — 카드를 나눴습니다` }];
  if (G.phase === "play") ev.push({ type: "lead", p: R.current(G) });
  return ev;
}

const E = {
  id: "dalmuti",
  name: "달무티",
  icon: "👑",
  blurb: "계급 사회 카드 게임. 같은 숫자를 같은 장수로, 더 낮은 숫자로 덮어 먼저 털면 다음 라운드의 왕이 됩니다.",
  players: { min: 4, max: 8, default: 6 },
  settings: [
    { key: "rounds", label: "라운드", values: [3, 5, 8], labels: ["3판", "5판", "8판"], default: 5, note: "라운드마다 n·n-1·…·1 점. 총점으로 순위" },
    { key: "assist", label: "묶음 도우미", values: [true, false], labels: ["허용", "끄기"], default: true,
      note: "켜면 숫자 묶음을 누를 때 필요한 광대까지 알아서 붙입니다" }
  ],
  rules: `<ul>
    <li>카드는 <b>1(달무티)부터 12(농노)까지</b> 숫자만큼 있고(1은 1장, 12는 12장) <b>광대 2장</b>을 더해 80장입니다. <b>숫자가 낮을수록 셉니다.</b></li>
    <li>첫 라운드는 한 장씩 뽑아 <b>가장 낮은 카드를 뽑은 사람</b>부터 앉고 선을 잡습니다.</li>
    <li>선은 <b>같은 숫자 여러 장</b>을 원하는 만큼 냅니다. 다음 사람은 <b>같은 장수</b>로 <b>더 낮은 숫자</b>를 내거나 패스합니다. 패스해도 다음에 다시 낼 수 있습니다.</li>
    <li><b>광대</b>는 다른 숫자와 함께 내면 그 숫자로 칩니다. 광대만 내면 13(가장 약함)입니다.</li>
    <li>마지막에 낸 사람을 뺀 모두가 연달아 패스하면 판이 끝나고, 마지막에 낸 사람이 새 판의 선이 됩니다.</li>
    <li>패를 먼저 턴 순서대로 <b>대달무티 · 소달무티 · 상인 · 소농노 · 대농노</b>가 되고, 그 순서로 다음 라운드에 앉습니다. 점수는 1등 n점, 2등 n-1점 … 꼴찌 1점.</li>
    <li><b>세금</b>(2라운드부터): 대농노는 가장 낮은 숫자 2장을 대달무티에게, 소농노는 1장을 소달무티에게 바칩니다. 달무티는 아무 카드나 같은 장수를 돌려줍니다.</li>
    <li><b>혁명</b>: 카드를 받은 뒤 광대 2장을 모두 가진 사람은 혁명을 선언할 수 있습니다 — 그 라운드 세금이 없어집니다. 대농노가 선언하면 <b>대혁명</b>: 서열이 통째로 뒤집힙니다 (대농노는 항상 선언).</li>
    <li>공정 규칙: 남의 패 · 남의 세금 내용은 보이지 않고, <b>낸 카드 기록은 판마다 지워집니다</b> (카드 카운터 없음). 혁명 질문은 당사자만 봅니다.</li>
  </ul>`,

  setup({ n, seed, settings = {} }) {
    const rounds = [3, 5, 8].includes(settings.rounds) ? settings.rounds : 5;
    const S = {
      n, rounds, assist: settings.assist !== false,
      g: R.create({ n, rounds, seed: seed | 0 }),
      draw: null,          // 자리 뽑기 결과 {draws:[{p,rank}], order}
      tax: null,           // {pairs:[{peon,lord,k,up,down}], i, stage:"up"|"return", done}
      trickLog: [],        // 이번 판(트릭)에서 일어난 일 — 판이 끝나면 지운다 (공정 규칙)
      prevTrick: null,     // 방금 끝난 판 {rank,plain,jesters,count,by,leader} — 다음 수까지 보여 준다
      history: []          // 라운드 결과 [{round, finish, points}]
    };
    loadLearned();         // 방장 쪽에서만 불린다 — 첫 AI 차례 전까지 여유가 충분하다
    return S;
  },

  pending(S) {
    const G = S.g;
    if (G.phase === "play") return [{ p: R.current(G), kind: "play" }];
    if (G.phase === "revolution") {
      const c = revoltAsk(S);
      return c >= 0 ? [{ p: c, kind: "revolt", secret: true, time: 15 }] : [];
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      return x ? [{ p: x.lord, kind: "return", time: 30 }] : [];
    }
    return [];
  },

  validate(S, p, a) {
    const G = S.g;
    if (!a || typeof a !== "object") return "행동이 올바르지 않습니다";
    if (G.phase === "play") {
      if (p !== R.current(G)) return "지금은 내 차례가 아닙니다";
      const id = toId(a);
      if (id === null) return "낼 카드를 고르세요";
      if (R.isLegal(G, id)) return true;
      const A = ACTIONS[id], h = G.hands[p];
      if (A.pass) return "선은 패스할 수 없습니다 — 아무 조합이나 내세요";
      if ((A.rank !== JESTER && h[A.rank] < A.plain) || h[JESTER] < A.jesters) return "가진 카드보다 많이 낼 수 없습니다";
      const t = G.trick;
      if (A.rank === JESTER) return "광대만으로는 선일 때만 낼 수 있습니다";
      return `${t.count}장, ${t.rank}보다 낮은 숫자를 내야 합니다`;
    }
    if (G.phase === "revolution") {
      if (p !== revoltAsk(S)) return "지금은 내 차례가 아닙니다";
      if (typeof a.revolt !== "boolean") return "혁명 여부를 고르세요";
      return true;
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      if (!x || p !== x.lord) return "지금은 내 차례가 아닙니다";
      const c = a.cards;
      if (!Array.isArray(c) || c.length !== x.k) return `돌려줄 카드 ${x.k}장을 고르세요`;
      if (!c.every(r => Number.isInteger(r) && r >= 1 && r <= 13)) return "카드가 올바르지 않습니다";
      const need = new Array(14).fill(0);
      c.forEach(r => need[r]++);
      for (let r = 1; r <= 13; r++) if (need[r] > G.hands[p][r]) return "가진 카드만 돌려줄 수 있습니다";
      return true;
    }
    return "지금은 둘 차례가 아닙니다";
  },

  apply(S, p, a) {
    const G = S.g;
    if (G.phase === "revolution") {
      if (a.revolt) return doRevolt(S, p);
      // 감춘 사실은 본인만 안다
      return [{ type: "revoltNo", p, only: p }, ...startTax(S)];
    }
    if (G.phase === "tax") {
      const x = curTax(S);
      R.transfer(G, x.lord, x.peon, a.cards);
      x.down = a.cards.slice();
      S.tax.i++; S.tax.stage = "up";
      return [{ type: "tax", dir: "down", from: x.lord, to: x.peon, n: x.k, ranks: a.cards.slice(), text: `{${x.lord}} 님이 {${x.peon}} 님에게 ${x.k}장을 돌려주었습니다` }];
    }
    // 플레이
    const id = toId(a), A = ACTIONS[id], before = G.trick;
    const r = R.act(G, id);
    const ev = [];
    if (A.pass) {
      S.trickLog.push({ p, pass: true });
      ev.push({ type: "pass", p });
    } else {
      S.prevTrick = null;
      S.trickLog.push({ p, rank: A.rank, plain: A.plain, jesters: A.jesters });
      ev.push({ type: "play", p, rank: A.rank, plain: A.plain, jesters: A.jesters, count: A.count, lead: !before });
    }
    if (r.finished) {
      const t = R.titleCode(r.finished - 1, G.n);
      ev.push({ type: "out", p, place: r.finished, title: t, text: `{${p}} 님이 ${r.finished}번째로 패를 털었습니다 — ${TITLE_NAMES[t]}` });
    }
    if (r.last !== undefined) {
      ev.push({ type: "out", p: r.last, place: G.n, title: T.GP, last: true, text: `{${r.last}} 님이 마지막까지 남았습니다 — 대농노` });
    }
    if (r.trickEnd) {
      const t = A.pass ? before : G.trick;
      S.prevTrick = t ? { rank: t.rank, plain: t.plain, jesters: t.jesters, count: t.count, by: t.by, leader: r.trickEnd.leader } : null;
      S.trickLog = [];
      ev.push({ type: "trickEnd", winner: r.trickEnd.winner, leader: r.trickEnd.leader });
    }
    if (r.roundEnd) {
      ev.push({ type: "roundEnd", round: G.round, finish: G.finish.slice(), text: `라운드 ${G.round} 끝 — 1등 {${G.finish[0]}} 님` });
    }
    return ev;
  },

  step(S) {
    const G = S.g;
    switch (G.phase) {
      case "draw": {
        const r = R.seatingDraw(G);
        S.draw = r;
        return [{ type: "draw", draws: r.draws, order: r.order,
          text: `자리 뽑기 — 가장 낮은 카드(${label(r.draws.find(d => d.p === r.order[0]).rank)})를 뽑은 {${r.order[0]}} 님이 첫 선` }];
      }
      case "deal": return dealRound(S);
      case "revolution": {
        const c = revoltCandidate(S);
        if (c >= 0) return doRevolt(S, c);          // 대농노는 늘 대혁명 (pending 에 없으므로 여기로 온다)
        return startTax(S);
      }
      case "tax": {
        const tx = S.tax;
        if (tx.i < tx.pairs.length) {
          const x = tx.pairs[tx.i];
          const up = R.tribute(G, x.peon, x.k);
          R.transfer(G, x.peon, x.lord, up);
          x.up = up; tx.stage = "return";
          return [{ type: "tax", dir: "up", from: x.peon, to: x.lord, n: x.k, ranks: up.slice(), text: `{${x.peon}} 님이 {${x.lord}} 님에게 ${x.k}장을 바쳤습니다` }];
        }
        tx.done = true;
        R.finishTax(G);
        S.trickLog = []; S.prevTrick = null;
        return [{ type: "taxDone" }, { type: "lead", p: R.current(G) }];
      }
      case "roundEnd": {
        const sum = R.endRound(G);
        S.history.push({ round: sum.round, finish: sum.finish, points: sum.points });
        const ev = [{ type: "round", ...sum }];
        if (G.phase === "deal") ev.push(...dealRound(S));
        else ev.push({ type: "over", text: "게임 끝" });
        return ev;
      }
    }
    return [];
  },

  delay(S) {
    const G = S.g;
    switch (G.phase) {
      case "draw": return 700;
      case "deal": return 4800;                                  // 자리 뽑기 결과를 보여 준다
      case "revolution": return 1400 + Math.random() * 1200;     // 혁명 후보가 있든 없든 비슷한 시간 (광대 2장의 존재를 숨긴다)
      case "tax": return S.tax && S.tax.i < S.tax.pairs.length ? 1300 : 1100;
      case "roundEnd": return 5500;                              // 라운드 순위 · 새 계급 보여 주기
    }
    return 800;
  },

  timeout(S, p, kind) {
    const G = S.g;
    if (kind === "revolt") return { revolt: false };
    if (kind === "return") { const x = curTax(S); return { cards: R.giveBackDefault(G, p, x ? x.k : 0) }; }
    // 따라갈 땐 패스, 선이면 무난한 수 (원본과 같다)
    if (G.trick) return { pass: true };
    return { id: AI.normal(G, p, () => 0.99) };
  },

  ai(S, p, { level = "normal", rng = Math.random } = {}) {
    const G = S.g;
    if (G.phase === "revolution") return { revolt: AI.revolt(G, p, rng) };
    if (G.phase === "tax") { const x = curTax(S); return { cards: R.giveBackDefault(G, p, x.k) }; }
    if (level === "hard" && POLICY) return { id: AI.learned(G, p, POLICY, HARD_TAU, rng) };
    return { id: AI.choose(G, p, level, rng) };
  },

  thinkTime(S, p, kind) {
    if (kind === "revolt") return 1400 + Math.random() * 1200;
    if (kind === "return") return 900 + Math.random() * 500;
    return 650 + Math.random() * 550;
  },

  view(S, p) {
    const G = S.g, phase = G.phase === "revolution" ? "tax" : G.phase;
    const me = p >= 0 && p < G.n;
    let ask = null;
    if (me && G.phase === "revolution" && revoltAsk(S) === p) ask = { kind: "revolt", title: G.titles[p] };
    const x = curTax(S);
    if (me && x && x.lord === p) ask = { kind: "return", k: x.k, peon: x.peon, received: x.up.slice() };
    const tax = S.tax ? {
      i: S.tax.i, stage: S.tax.stage, done: S.tax.done,
      pairs: S.tax.pairs.map(t => {
        const mine = t.peon === p || t.lord === p;
        return { peon: t.peon, lord: t.lord, k: t.k, upDone: !!t.up, downDone: !!t.down, up: mine && t.up ? t.up.slice() : null, down: mine && t.down ? t.down.slice() : null };
      })
    } : null;
    const turn = G.phase === "play" ? R.current(G) : -1;
    return {
      me: p, n: G.n, phase, round: Math.min(G.round, G.rounds), rounds: G.rounds, assist: S.assist,
      seats: G.seats.slice(), titles: G.titles.slice(), scores: G.scores.slice(), sizes: sizes(G),
      finish: G.finish.slice(), passed: G.passed.slice(), lastAct: G.lastAct.slice(),
      trick: G.trick ? { ...G.trick } : null, prevTrick: S.prevTrick, trickLog: S.trickLog.slice(),
      turn, reveal: G.reveal, draw: S.draw, tax, ask,
      hand: me ? G.hands[p].slice() : new Array(14).fill(0),
      history: S.history,
      status: statusFor(S, p, turn, ask)
    };
  },

  filterEvent(ev, p) {
    if (ev.only !== undefined && ev.only !== p) return null;
    if (ev.type === "tax" && p !== ev.from && p !== ev.to) return { ...ev, ranks: null };
    return ev;
  },

  over(S) { return S.g.phase === "over"; },

  results(S) {
    const G = S.g, last = G.seats;   // 동점이면 마지막 라운드 순위가 앞선 사람
    const order = [...Array(G.n).keys()].sort((a, b) => G.scores[b] - G.scores[a] || last.indexOf(a) - last.indexOf(b));
    return order.map((p, i) => ({
      p, rank: i + 1, score: G.scores[p],
      note: "라운드별: " + S.history.map(h => TITLE_SHORT[R.titleCode(h.finish.indexOf(p), G.n)]).join(" → ")
    }));
  },

  /* ---------- 시험용 ---------- */
  randomAction(S, p, rng, kind) {
    const G = S.g;
    if (G.phase === "revolution") return { revolt: rng() < 0.5 };
    if (G.phase === "tax") {
      const x = curTax(S), pool = [];
      for (let r = 1; r <= 13; r++) for (let c = 0; c < G.hands[p][r]; c++) pool.push(r);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      return { cards: pool.slice(0, x.k) };
    }
    const ids = R.legal(G), id = ids[Math.floor(rng() * ids.length)], A = ACTIONS[id], f = rng();
    if (A.pass) return f < 0.5 ? { pass: true } : { id: 0 };
    return f < 0.5 ? { id } : { rank: A.rank, plain: A.plain, jesters: A.jesters };
  },

  check(S) {
    const G = S.g;
    const dealt = G.phase !== "draw" && G.phase !== "deal";   // 자리 뽑기 직후(deal)까지는 아무도 카드가 없다
    for (let r = 1; r <= 13; r++) {
      let s = G.played[r];
      for (let p = 0; p < G.n; p++) { if (G.hands[p][r] < 0) return `음수 카드 p${p} r${r}`; s += G.hands[p][r]; }
      const want = dealt ? R.TOTAL(r) : 0;
      if (s !== want) return `숫자 ${r} 카드 수가 맞지 않음: ${s} (기대 ${want})`;
    }
    let total = 0;
    for (let p = 0; p < G.n; p++) total += R.handSize(G, p);
    for (let r = 1; r <= 13; r++) total += G.played[r];
    if (total !== (dealt ? 80 : 0)) return `카드 총수 ${total}`;
    // 점수: 라운드 기록의 합과 같아야 하고, 끝난 라운드마다 n(n+1)/2 점이 나간다
    const sum = new Array(G.n).fill(0);
    for (const h of S.history) {
      if (h.finish.length !== G.n || new Set(h.finish).size !== G.n) return `라운드 ${h.round} 순위가 이상함`;
      for (let i = 0; i < G.n; i++) {
        if (h.points[i] !== G.n - i) return `라운드 ${h.round} ${i + 1}등 점수 ${h.points[i]}`;
        sum[h.finish[i]] += h.points[i];
      }
    }
    if (sum.some((s, q) => s !== G.scores[q])) return `점수가 라운드 기록과 다름 ${G.scores} vs ${sum}`;
    if (S.history.length !== G.round - 1) return `라운드 기록 수 ${S.history.length} ≠ ${G.round - 1}`;
    const tot = G.scores.reduce((a, b) => a + b, 0);
    if (tot !== S.history.length * G.n * (G.n + 1) / 2) return `점수 총합 ${tot}`;
    if (new Set(G.finish).size !== G.finish.length) return "같은 사람이 두 번 빠져나감";
    if (G.phase === "play") {
      for (const q of G.finish) if (R.handSize(G, q)) return `빠져나간 p${q} 에게 카드가 남음`;
      if (!R.handSize(G, R.current(G))) return "카드 없는 사람의 차례";
    }
    return true;
  },

  leak(S, p, v) {
    const G = S.g;
    const ALLOWED = ["me", "n", "phase", "round", "rounds", "assist", "seats", "titles", "scores", "sizes", "finish", "passed", "lastAct",
      "trick", "prevTrick", "trickLog", "turn", "reveal", "draw", "tax", "ask", "hand", "history", "status"];
    for (const k of Object.keys(v)) if (!ALLOWED.includes(k)) return `알 수 없는 view 항목 ${k}`;
    if (JSON.stringify(v.hand) !== JSON.stringify(G.hands[p])) return "내 패가 view 와 다름";
    if (JSON.stringify(v).includes('"hands"') || JSON.stringify(v).includes('"played"')) return "남의 패 / 나온 카드 집계가 view 에 있음";
    if (v.tax) for (const t of v.tax.pairs) if (t.peon !== p && t.lord !== p && (t.up || t.down)) return "남의 세금 내용이 보임";
    if (v.ask) {
      if (v.ask.kind === "revolt" && revoltAsk(S) !== p) return "남의 혁명 질문이 보임";
      if (v.ask.kind === "return" && (!curTax(S) || curTax(S).lord !== p)) return "남의 하사 질문이 보임";
    }
    if (G.phase === "revolution" && revoltAsk(S) !== p && v.status !== "세금을 걷을 준비 중…") return "혁명 후보 여부가 상태 줄로 드러남";
    return true;
  },
  stepLimit: 30000
};

function statusFor(S, p, turn, ask) {
  const G = S.g, rd = `${Math.min(G.round, G.rounds)}/${G.rounds}R`;
  switch (G.phase) {
    case "draw": return "자리 뽑기 준비";
    case "deal": return "자리를 정했습니다 — 곧 카드를 나눕니다";
    case "revolution": return ask ? "광대 2장! 혁명을 선언할까요?" : "세금을 걷을 준비 중…";
    case "tax": {
      const x = curTax(S);
      if (x) return x.lord === p ? `돌려줄 카드 ${x.k}장을 고르세요` : `{${x.lord}} 님이 돌려줄 카드를 고르는 중`;
      return `${rd} · 세금`;
    }
    case "play": {
      if (turn !== p) return `${rd} · {${turn}} 님 차례`;
      const t = G.trick;
      return t ? `${rd} · 내 차례 — ${t.count}장, ${t.rank}보다 낮게` : `${rd} · 내 차례 — 선 (아무 조합)`;
    }
    case "roundEnd": return `라운드 ${G.round} 끝 — 1등 {${G.finish[0]}} 님`;
    case "over": return "게임 끝";
  }
  return "";
}

export default E;
