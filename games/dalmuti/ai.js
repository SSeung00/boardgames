/* 달무티 AI — C:\Users\user\dalmuti\web\ai.js 를 ES 모듈로 옮긴 것.
   다른 점 하나: 원본은 난수를 E.rand(G) 로 뽑아 게임 상태를 바꾸지만, 놀이방 규약상 AI 는 상태를 바꾸면 안 되므로
   난수 함수 rnd() 를 따로 받는다. 같은 난수열을 주면 원본과 같은 수를 둔다 (test_port.mjs 가 대조한다). */
import * as E from "./rules.js";
const { JESTER, TOTAL } = E;

/* 쉬움 — 이길 수 있으면 무조건 가장 약한 카드로 받아치고, 선일 땐 아무 묶음이나 낸다 */
export function easy(G, p, rnd) {
  const h = G.hands[p], J = h[JESTER];
  if (!G.trick) {
    const ranks = [];
    for (let r = 1; r <= 12; r++) if (h[r] > 0) ranks.push(r);
    if (!ranks.length) return E.actionId(JESTER, 0, J);
    const r = ranks[Math.floor(rnd() * ranks.length)];
    return E.actionId(r, h[r], 0);
  }
  const c = followCands(G, p);
  return c.length ? E.actionId(c[0].r, c[0].own, c[0].uj) : 0;
}

/* 같은 장수로 받아칠 수 있는 후보. 광대를 덜 쓰고, 약한 숫자부터, 묶음을 덜 깨는 순 */
export function followCands(G, p) {
  const h = G.hands[p], J = h[JESTER], need = G.trick.count, limit = G.trick.rank;
  const out = [];
  for (let r = 1; r < limit && r <= 12; r++) {
    if (!h[r]) continue;
    const own = Math.min(h[r], need), uj = need - own;
    if (uj > J) continue;
    out.push({ r, own, uj, breaks: h[r] - own });
  }
  out.sort((a, b) => a.uj - b.uj || b.r - a.r || a.breaks - b.breaks);
  return out;
}

/* 보통 — 약한 큰 묶음부터 털고, 2 이하 카드와 광대는 아낀다 */
export function normal(G, p, rnd) {
  const h = G.hands[p], J = h[JESTER], size = E.handSize(G, p);
  if (!G.trick) {
    for (let r = 1; r <= 12; r++) if (h[r] > 0 && h[r] + J === size) return E.actionId(r, h[r], J);
    let best = 0;
    for (let r = 1; r <= 12; r++)
      if (h[r] > 0 && (!best || h[r] > h[best] || (h[r] === h[best] && r > best))) best = r;
    if (!best) return E.actionId(JESTER, 0, J);
    const j = (J > 0 && size - h[best] <= J + 1) ? J : 0;
    return E.actionId(best, h[best], j);
  }
  const c = followCands(G, p);
  if (!c.length) return 0;
  const pick = c[0], need = G.trick.count, id = E.actionId(pick.r, pick.own, pick.uj);
  if (size - need === 0) return id;
  if (pick.r <= 2 && size > 5 && need <= 2) return 0;
  if (pick.uj > 0 && size > 7 && rnd() < 0.55) return 0;
  return id;
}

/* 어려움 — 나온 카드를 세어 "아무도 못 받아칠 수"를 알고, 선을 지키며 털어 나간다 */
export function hard(G, p) {
  const h = G.hands[p], J = h[JESTER], size = E.handSize(G, p);
  const unseen = new Array(14).fill(0);
  for (let r = 1; r <= 13; r++) unseen[r] = TOTAL(r) - G.played[r] - h[r];
  const uJ = unseen[JESTER];
  const beatable = (r, c) => {
    for (let q = 1; q < r && q <= 12; q++) if (unseen[q] > 0 && unseen[q] + uJ >= c) return true;
    return false;
  };
  let minOther = 99;
  for (const q of G.seats) if (q !== p) { const s = E.handSize(G, q); if (s > 0 && s < minOther) minOther = s; }

  if (!G.trick) {
    const ranks = [];
    for (let r = 1; r <= 12; r++) if (h[r] > 0) ranks.push(r);
    if (!ranks.length) return E.actionId(JESTER, 0, J);
    if (ranks.length === 1) return E.actionId(ranks[0], h[ranks[0]], J);
    const safe = ranks.filter(r => !beatable(r, h[r]));
    if (ranks.length === 2 && safe.length) return E.actionId(safe[0], h[safe[0]], 0);
    if (minOther <= 2) {
      // 누군가 곧 나간다 — 장수가 큰 묶음으로 따라오기 어렵게 막는다
      let best = ranks[0];
      for (const r of ranks) if (h[r] > h[best] || (h[r] === h[best] && r > best)) best = r;
      if (h[best] > minOther) return E.actionId(best, h[best], 0);
    }
    const weak = ranks.filter(r => safe.indexOf(r) < 0);
    const pool = weak.length ? weak : ranks;
    const r = pool[pool.length - 1];
    return E.actionId(r, h[r], 0);
  }

  const need = G.trick.count, limit = G.trick.rank, cands = [];
  for (let r = 1; r < limit && r <= 12; r++) {
    if (!h[r]) continue;
    const own = Math.min(h[r], need), uj = need - own;
    if (uj > J) continue;
    let cost = (13 - r) + uj * 6 + (h[r] - own > 0 ? 2 : 0);
    if (!beatable(r, need)) cost -= 3;
    if (size - need === 0) cost = -100;
    cands.push({ r, own, uj, cost });
  }
  if (!cands.length) return 0;
  cands.sort((a, b) => a.cost - b.cost || b.r - a.r);
  const c = cands[0];
  const danger = minOther <= need || minOther <= 2;
  const limitCost = danger ? 99 : (size > 6 ? 9 : 14);
  if (c.cost > limitCost) return 0;
  return E.actionId(c.r, c.own, c.uj);
}

/* ---------- 학습된 정책 (Q 네트워크) ----------
   정책: {obs, act, layers:[{in,out,w,b}]} (w, b 는 float32 base64) — policy.js */
function b64f32(s) {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
export function loadPolicy(raw) {
  if (!raw || !raw.layers) return null;
  if (raw.obs !== E.OBS || raw.act !== E.ACT) return null;    // 인코딩이 바뀌었으면 쓰지 않는다
  return {
    meta: raw.meta || {}, layers: raw.layers.map(L => ({
      in: L.in, out: L.out,
      w: typeof L.w === "string" ? b64f32(L.w) : Float32Array.from(L.w),
      b: typeof L.b === "string" ? b64f32(L.b) : Float32Array.from(L.b)
    }))
  };
}
export function qValue(policy, x) {
  let h = x;
  policy.layers.forEach((L, li) => {
    const o = new Float32Array(L.out);
    for (let j = 0; j < L.out; j++) o[j] = L.b[j];
    for (let i = 0; i < L.in; i++) {
      const xi = h[i];
      if (xi === 0) continue;
      const row = i * L.out;
      for (let j = 0; j < L.out; j++) o[j] += xi * L.w[row + j];
    }
    if (li < policy.layers.length - 1) for (let j = 0; j < L.out; j++) if (o[j] < 0) o[j] = 0;
    h = o;
  });
  return h[0];
}
/* 학습된 AI. tau(온도)가 0 이면 늘 최선의 수, 클수록 덜 좋은 수도 섞어 둔다 */
export function learned(G, p, policy, tau, rnd) {
  const ids = E.legal(G);
  if (ids.length === 1) return ids[0];
  const obs = E.encodeObs(G, p);
  const qs = ids.map(id => qValue(policy, obs.concat(E.encodeAct(G, p, id))));
  let bi = 0;
  for (let i = 1; i < qs.length; i++) if (qs[i] > qs[bi]) bi = i;
  if (!tau || tau <= 0) return ids[bi];
  const w = qs.map(q => Math.exp((q - qs[bi]) / tau));
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (let i = 0; i < ids.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
  return ids[bi];
}

export function choose(G, p, level, rnd, policy) {
  if (level === "rl" && policy) return learned(G, p, policy, 0, rnd);
  if (level === "easy") return easy(G, p, rnd);
  if (level === "hard") return hard(G, p);
  return normal(G, p, rnd);
}

/* 혁명: 대농노는 잃을 게 없으니 무조건, 소농노는 세금을 지키니 선언, 상인은 반반, 달무티는 안 한다 */
export function revolt(G, p, rnd) {
  const t = G.titles[p];
  if (t === E.T.GP || t === E.T.LP) return true;
  if (t === E.T.MER) return rnd() < 0.6;
  return false;
}
