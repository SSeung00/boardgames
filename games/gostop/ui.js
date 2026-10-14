/* 고스톱 화면 — 위: 상대 정보판 · 가운데 펠트: 더미 + 바닥 (월별 묶음 격자, 남는 높이만큼 카드를 키운다) · 아래: 내 정보판 + 손패
   정보판(나 · 상대 모두): 점수 · 나기까지 남은 점수 · 광/띠/열끗/피/홍단/청단/초단/고도리 진행 · 피박/광박 위험 · 고/흔들 배수 · 마지막 차례.
   손패: 누르지 않아도 바닥에서 무엇을 먹는지 · 점수가 오르는지 · 상대 약을 막는지 · 흔들기/폭탄이 되는지 표시.
   한 번 누르면 고르고(결과 미리보기), 한 번 더 누르면 낸다. 진행 기록은 정보판에 직접 보이므로 위쪽 한 줄 기록(ticker)은 끈다. */
import { CARDS, hwHTML, monthOf, isBonus, cardName, groupOf, kindKey, kindLabel, SET_NAME, SET_CARDS } from "./cards.js";
import { scoreOf, settle } from "./engine.js";

const GROUPS = [["g", "광"], ["t", "띠"], ["y", "열끗"], ["p", "피"]];
const SETS = ["hong", "cheong", "cho", "go"];
const GWANG = ["1a", "3a", "8a", "11a", "12a"];
const OFFR = 0.27;                    // 바닥에서 같은 월 카드를 겹칠 때 내리는 간격 (카드 높이 비율)
const TK = { g: "광", hong: "홍", cheong: "청", cho: "초", rain: "띠", y: "열", go: "새", guk: "국", pp: "쌍", p: "피" };
const KPRI = { g: 9, hong: 7, cheong: 7, cho: 7, go: 7, guk: 5, y: 4, rain: 3, pp: 3, p: 1 };
const signed = x => (x > 0 ? "+" : "") + x;
const sameKind = (a, b) => CARDS[a].t === "p" && CARDS[b].t === "p" && CARDS[a].pv === CARDS[b].pv;
const SET_ITEM = /^(홍단|청단|초단|고도리|\d광|비삼광)$/;

/* 카드 한 장을 글자 크기 패로 (마지막 차례 기록용) */
function tok(id) {
  const c = CARDS[id];
  if (c.bonus) return `<span class="gs-tk t-b" title="${cardName(id)}"><b>★</b>+${c.pv}</span>`;
  const k = kindKey(id);
  return `<span class="gs-tk m${c.m} t-${k}" title="${cardName(id)}"><b>${c.m}</b>${k === "g" && c.rain ? "비" : TK[k]}</span>`;
}

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "gs");
  wrap.innerHTML = `
    <div class="gs-opps" data-r="opps"></div>
    <div class="gs-table felt" data-r="table">
      <div class="gs-floor" data-r="floor"></div>
      <div class="gs-pick" data-r="pick" hidden></div>
      <div class="gs-banner" data-r="banner"></div>
    </div>
    <div class="gs-p gs-mine" data-r="mine" role="button" tabindex="0" aria-label="내 정보 · 먹은 패 보기"></div>
    <div class="gs-dock">
      <div class="gs-hint" data-r="hint"></div>
      <div class="gs-hand" data-r="hand"></div>
    </div>
    <div class="gs-over" data-r="over" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;                 // 마지막 msg
  let A = null;                 // 화면이 계산해 둔 것 (analyze)
  let sel = null;               // 고른 손패
  let sentId = 0;               // 이미 답을 보낸 질문 id (두 번 보내지 않도록)
  let playAsk = 0;              // 마지막으로 본 내 「낼 차례」 질문 id
  let gsBox = null;             // 열린 고/스톱 창 {id, close}
  let hiddenRound = 0;          // 결과판을 닫은 판
  let prevFloor = null, prevHand = null, prevMine = null;
  let lastBy = {}, lastKey = "", lastRound = 0;     // 사람마다 마지막 차례 (정보판에 표시)
  const anim = new Set();       // 방금 나타난 카드 (짧은 등장 애니메이션)
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const name = p => (M && M.players[p] ? M.players[p].name : "?");
  const who = p => (M && p === M.me ? "나" : esc(name(p)));
  const open = kind => { const a = ctx.myAsk(kind); return a && a.id !== sentId ? a : null; };
  const live = v => ["play", "choose", "gostop"].includes(v.phase);

  R("mine").onclick = () => { if (M) showCaps(M.me); };

  /* ---------------- 상태 ---------------- */
  function update(m) {
    const fresh = m !== M;
    M = m;
    const v = m.v;
    if (!v || !v.caps) return;
    if (fresh) {
      const mine = v.caps[m.me] || [];
      anim.clear();
      for (const c of v.floor) if (prevFloor && !prevFloor.has(c)) anim.add(c);
      for (const c of v.hand) if (prevHand && !prevHand.has(c)) anim.add(c);
      for (const c of mine) if (prevMine && !prevMine.has(c)) anim.add(c);
      if (!prevFloor) for (const c of v.floor) anim.add(c);
      prevFloor = new Set(v.floor); prevHand = new Set(v.hand); prevMine = new Set(mine);
      if (anim.size) later(() => anim.clear(), 800);
      if (v.round !== lastRound) { lastRound = v.round; lastBy = {}; lastKey = ""; }
      if (v.last) { const k = JSON.stringify(v.last); if (k !== lastKey) { lastKey = k; lastBy[v.last.p] = v.last; } }
      events(m);
    }
    if (sel && !v.hand.includes(sel)) sel = null;
    const pa = open("play");
    if (pa && pa.id !== playAsk) { playAsk = pa.id; sel = null; }     // 새 차례: 미리 골라 둔 카드는 풀어 준다
    render();
  }

  /* 사람이 머릿속으로 세던 것을 모두 미리 계산한다 */
  function analyze(v, me) {
    const n = v.n, th = v.th;
    const owner = {};
    v.caps.forEach((cap, q) => cap.forEach(id => { owner[id] = q; }));
    const fake = { n, round: v.round, caps: v.caps, go: v.go, shook: v.shook, nagari: v.nagari };
    const P = [];
    for (let q = 0; q < n; q++) {
      const sc = v.scores[q], cap = v.caps[q];
      let lpi = 0, lg = 0;                                  // 진 사람 기준 (국진은 쌍피로) — 피박 · 광박 판정과 같게
      for (const id of cap) { const c = CARDS[id]; if (c.t === "p") lpi += c.pv; else if (c.guk) lpi += 2; else if (c.t === "g") lg++; }
      const sets = {};
      for (const s of SETS) {
        const have = SET_CARDS[s].filter(id => owner[id] === q).length;
        const dead = SET_CARDS[s].some(id => owner[id] !== undefined && owner[id] !== q);
        sets[s] = { have, dead, done: have === 3, near: have === 2 && !dead, miss: SET_CARDS[s].filter(id => owner[id] === undefined) };
      }
      const missG = GWANG.filter(id => owner[id] === undefined);
      const goal = v.go[q] ? Math.max(th, v.goScore[q] + 1) : th;
      const goMul = v.go[q] >= 3 ? 2 ** (v.go[q] - 2) : 1;
      P.push({
        q, sc, lpi, lg, sets, missG, rain: cap.includes("12a"), goal, need: Math.max(0, goal - sc.total),
        mul: 2 ** v.shook[q].length * goMul * v.nagari, goMul,
        stop: sc.total >= goal ? settle(fake, q) : null      // 이번 차례가 끝날 때 나는 점수면 받을/낼 점수
      });
    }
    // 위험: q 가 진다면 — 다른 사람이 피 · 광 · 열끗으로 앞서 갈 때만 경고 (판 처음부터 늘 켜져 있으면 소음)
    for (const p of P) {
      const o = P.filter(x => x !== p);
      p.pibak = p.lpi < 6 && o.some(x => x.sc.pi >= 6);
      p.gwangbak = p.lg === 0 && o.some(x => x.sc.g >= 2);
      p.meong = o.some(x => x.sc.y >= 6);
    }
    // 바닥 · 손패 카드 중 누군가의 약을 완성하는 카드 (1장 남은 약)
    const need = new Map();               // id → [{q, label}]
    const add = (id, q, label) => { if (!need.has(id)) need.set(id, []); need.get(id).push({ q, label }); };
    for (const p of P) {
      for (const s of SETS) if (p.sets[s].near) for (const id of p.sets[s].miss) add(id, p.q, SET_NAME[s]);
      if (p.sc.g === 2) for (const id of p.missG) add(id, p.q, "3광");
    }
    const threat = id => (need.get(id) || []).filter(x => x.q !== me);
    const mineNeed = id => (need.get(id) || []).filter(x => x.q === me);
    return { P, need, threat, mineNeed, owner };
  }

  /* 손패 한 장을 내면 (뒤집기 전까지) 어떻게 되는지 */
  function handInfo(v, c) {
    const me = M.me, P = A.P[me], caps = v.caps[me];
    if (isBonus(c)) return { kind: "bonus", tag: "보너스", tcls: "good", can: true, gains: [] };
    const m = monthOf(c), F = v.floor.filter(x => monthOf(x) === m);
    const bomb = !!(v.can && v.can.bomb.includes(m)), shake = !!(v.can && v.can.shake.includes(m));
    let kind, gains = [], alt = null;
    const gain = ids => scoreOf([...caps, ...ids]).total;
    if (bomb) { kind = "bomb"; gains = [...v.hand.filter(x => monthOf(x) === m), ...F]; }
    else if (!F.length) kind = "lay";
    else if (F.length === 1) { kind = "pair"; gains = [c, F[0]]; }
    else if (F.length === 2) {
      if (sameKind(F[0], F[1])) { kind = "pair"; gains = [c, F[0]]; }
      else {
        kind = "pair2";
        const val = x => gain([c, x]) * 100 + (A.threat(x).length ? 50 : 0) + KPRI[kindKey(x)];
        const [b, o] = val(F[0]) >= val(F[1]) ? [F[0], F[1]] : [F[1], F[0]];
        gains = [c, b]; alt = o;
      }
    } else { kind = "take4"; gains = [c, ...F]; }
    const after = gains.length ? scoreOf([...caps, ...gains]) : P.sc;
    const delta = after.total - P.sc.total;
    const done = after.items.map(x => x[0]).filter(l => SET_ITEM.test(l) && !P.sc.items.some(y => y[0] === l));
    const blocks = [];
    for (const id of gains) for (const t of A.threat(id)) blocks.push(`${who(t.q)} ${t.label}`);
    const gives = kind === "lay" ? A.threat(c).map(t => `${who(t.q)} ${t.label}`) : [];
    let tag = "", tcls = "";
    if (bomb) { tag = "💣폭탄"; tcls = "bomb"; }
    else if (done.length) { tag = done[0] + "!"; tcls = "gold"; }
    else if (delta > 0) { tag = `+${delta}점`; tcls = "gold"; }
    else if (blocks.length) { tag = "막기"; tcls = "block"; }
    else if (kind === "pair") { const k = kindKey(gains[1]); tag = k === "g" && CARDS[gains[1]].rain ? "비광" : kindLabel(gains[1]); tcls = KPRI[k] >= 4 ? "good" : ""; }
    else if (kind === "pair2") tag = "택1";
    else if (kind === "take4") { tag = v.ppeok.includes(m) ? "뻑먹기" : "4장"; tcls = "good"; }
    else if (gives.length) { tag = "⚠내줌"; tcls = "bad"; }
    return { kind, m, F, gains, alt, bomb, shake, after, delta, done, blocks, gives, tag, tcls, can: F.length > 0 };
  }

  /* ---------------- 그리기 ---------------- */
  function render() {
    if (!M) return;
    const v = M.v;
    A = analyze(v, M.me);
    const W = wrap.clientWidth || 360, H = wrap.clientHeight || 600;
    wrap.classList.toggle("short", H < 600);
    wrap.classList.toggle("tall", H > 740);
    wrap.classList.toggle("p3", v.n >= 3);
    renderOpps(); renderMine(H); renderHint(); renderOver();
    const cells = floorCells(v);
    const lay = layout(W, cells);          // 남은 높이를 손패와 바닥이 나눠 갖는다 (둘 다 가능한 크게)
    renderHand(lay);
    renderTable(cells, lay.fl);
    const g = open("gostop");
    if (g) openGoStop(g); else closeGoStop();
  }

  /* 정보판 한 사람 몫 (나 · 상대 공통) */
  function panelHTML(q) {
    const v = M.v, me = M.me, isMe = q === me, pl = M.players[q] || { name: "?" }, P = A.P[q], sc = P.sc;
    // 1줄: 이름 · 상태 꼬리표 · 나기까지 · 점수
    const tags = [];
    if (pl.kind === "ai") tags.push('<span class="gs-tg ai">AI</span>');
    else if (pl.kind === "away") tags.push('<span class="gs-tg away">자리 비움</span>');
    if (v.leader === q && live(v)) tags.push('<span class="gs-tg">선</span>');
    if (!isMe) tags.push(`<span class="gs-tg" title="손패">손 ${v.sizes[q]}</span>`);
    if (v.flips[q]) tags.push(`<span class="gs-tg" title="뒤집기만 하는 차례">뒤집기 ${v.flips[q]}</span>`);
    if (v.go[q]) tags.push(`<span class="gs-tg go">${v.go[q]}고${P.goMul > 1 ? ` ×${P.goMul}` : ""}</span>`);
    if (v.shook[q].length) {
      const sh = v.shook[q], ic = sh.map(s => (s.bomb ? "💣" : "흔들")).filter((x, i, a) => a.indexOf(x) === i).join("·");
      tags.push(`<span class="gs-tg sh" title="${sh.map(s => `${s.m}월 ${s.bomb ? "폭탄" : "흔들기"}`).join(", ")}">${ic} ×${2 ** sh.length}</span>`);
    }
    let needT;
    if (P.stop) needT = isMe ? `<span class="gs-need ok">스톱 시 +${P.stop.deltas[q]}</span>`
      : `<span class="gs-need bad">지금 나면 나 −${-P.stop.deltas[me] || 0}</span>`;
    else needT = `<span class="gs-need${P.need <= 2 ? (isMe ? " ok" : " warn") : ""}">${v.go[q] ? "다음 고/스톱" : "나기"}까지 <b>${P.need}</b>점</span>`;
    const head = `<div class="gs-ph">${isMe ? "" : avatarHTML(pl.name, q, "sm")}<b class="nm">${isMe ? "나" : esc(pl.name)}</b>${tags.join("")}` +
      `<span class="gs-sp"></span>${live(v) ? needT : ""}<span class="gs-score"><b>${sc.total}</b>점</span></div>`;

    // 2줄: 진행 칸 8개
    const near = isMe ? "good" : "warn";
    const ti = (label, val, cls, title) => `<div class="gs-ti ${cls}" title="${esc(title || "")}"><small>${label}</small><b>${val}</b></div>`;
    const t = [];
    const g = sc.g, gNear = g === 2 && P.missG.length;
    t.push(ti(P.rain ? "광☂" : "광", g >= 3 ? `${g}<i>+${sc.gp}</i>` : `${g}/3`, (g >= 3 ? "done" : gNear ? near : g ? "" : "zero") + (P.gwangbak ? " bak" : ""),
      `광 ${g}장${P.rain ? " (비광 포함 — 3광이면 2점)" : ""}${P.gwangbak ? " · 광박 위험" : ""}`));
    t.push(ti("띠", sc.t >= 5 ? `${sc.t}<i>+${sc.t - 4}</i>` : `${sc.t}/5`, sc.t >= 5 ? "done" : sc.t === 4 ? near : sc.t ? "" : "zero", `띠 ${sc.t}장`));
    t.push(ti("열끗", sc.y >= 5 ? `${sc.y}<i>+${sc.y - 4}</i>` : `${sc.y}/5`, sc.y >= 5 ? "done" : sc.y === 4 ? near : sc.y ? "" : "zero",
      `열끗 ${sc.y}장${sc.guk === "y" ? " (국진 포함)" : ""}`));
    t.push(ti("피", sc.pi >= 10 ? `${sc.pi}<i>+${sc.pp}</i>` : `${sc.pi}/10`, (sc.pi >= 10 ? "done" : sc.pi === 9 ? near : sc.pi ? "" : "zero") + (P.pibak ? " bak" : ""),
      `피 ${sc.pi}장 (쌍피 2 · 쓰리피 3${sc.guk === "p" ? " · 국진 쌍피" : ""})${P.pibak ? " · 피박 위험" : ""}`));
    for (const s of SETS) {
      const st = P.sets[s];
      t.push(st.done ? ti(SET_NAME[s], `✓<i>+${s === "go" ? 5 : 3}</i>`, "done", `${SET_NAME[s]} 완성`)
        : st.dead ? ti(SET_NAME[s], `✕`, "dead", `${SET_NAME[s]} — 다른 사람이 이미 한 장을 먹어 불가`)
        : ti(SET_NAME[s], `${st.have}/3`, st.near ? near : st.have ? "" : "zero",
          st.near ? `${SET_NAME[s]} 1장 남음: ${st.miss.map(cardName).join(", ")}` : `${SET_NAME[s]} ${st.have}/3`));
    }

    // 3줄: 마지막 차례 · 위험 · 누적
    const cur = v.cur && v.cur.p === q ? v.cur : null;
    const L = cur ? null : lastBy[q];
    let mv;
    if (cur) mv = `${cur.played.length ? cur.played.map(tok).join("") : "<em>뒤집기</em>"}${cur.flipped.length ? `<i>→</i>${cur.flipped.map(tok).join("")}` : ""}<em>…</em>`;
    else if (L) mv = moveHTML(L, me);
    else mv = `<em class="gs-faint">${live(v) ? "아직 안 냄" : ""}</em>`;
    const fresh = (cur || (v.last && L === lastBy[v.last.p] && v.last.p === q)) ? " fresh" : "";
    const dg = [];
    const dcls = isMe ? "gs-dg" : "gs-dg opp";
    if (P.pibak) dg.push(`<span class="${dcls}" title="${isMe ? "상대가 피로 나면 ×2" : "내가 피로 나면 ×2"}">피박 위험: 피 ${P.lpi}</span>`);
    if (P.gwangbak) dg.push(`<span class="${dcls}" title="광으로 나면 ×2">광박 위험</span>`);
    if (P.meong && isMe) dg.push(`<span class="${dcls}" title="상대 열끗 7장 이상으로 나면 ×2">멍박 주의</span>`);
    const foot = `<div class="gs-pf"><span class="gs-lm${fresh}">${mv}</span>${dg.join("")}<span class="gs-tot">누적 <b>${signed(v.totals[q])}</b></span></div>`;
    return head + `<div class="gs-tiles">${t.join("")}</div>` + foot;
  }

  function moveHTML(L, me) {
    let s = "";
    if (L.kind === "flip") s += "<em>뒤집기</em>";
    else if (L.kind === "bomb") s += `<em>💣</em>${L.played.map(tok).join("")}`;
    else s += L.played.map(tok).join("");
    if (L.flipped.length) s += `<i>→</i>${L.flipped.map(tok).join("")}`;
    s += L.captured.length ? `<span class="got">+${L.captured.length}장</span>` : `<span class="miss">못 먹음</span>`;
    const combos = L.combos.filter(c => c !== "흔들기" && c !== "폭탄");
    if (combos.length) s += `<span class="cb">${combos.join("·")}!</span>`;
    if (L.stolen.length) {
      const fromMe = L.stolen.filter(x => x.from === me).length;
      s += L.p === me ? `<span class="got">피 ${L.stolen.length}장 뺏음</span>` : fromMe ? `<span class="bad">내 피 −${fromMe}</span>` : `<span class="cb">피 ${L.stolen.length}장 뺏음</span>`;
    }
    return s;
  }

  function renderOpps() {
    const v = M.v, me = M.me, box = R("opps");
    box.innerHTML = "";
    for (let k = 1; k < v.n; k++) {
      const q = (me + k) % v.n;
      const b = el("div", "gs-p gs-opp" + (live(v) && v.turn === q ? " turn" : ""), panelHTML(q));
      b.setAttribute("role", "button");
      b.setAttribute("aria-label", `${name(q)} 님 먹은 패 보기`);
      b.onclick = () => showCaps(q);
      box.appendChild(b);
    }
  }

  function renderMine(H) {
    const v = M.v, me = M.me, sc = v.scores[me], box = R("mine");
    box.className = "gs-p gs-mine" + (live(v) && v.turn === me ? " turn" : "");
    box.innerHTML = panelHTML(me);
    if (H < 690 || !v.caps[me].length) return;                     // 작은 화면: 먹은 패 그림은 눌러서 본다 (진행 칸에 장수가 다 있다)
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[me]) groups[groupOf(c, sc.guk)].push(c);
    const piles = el("div", "gs-piles");
    for (const [k] of GROUPS) {
      const cs = groups[k];
      piles.appendChild(el("div", `gs-pc p-${k}`, cs.map(c => hwHTML(c, "mini" + (anim.has(c) ? " in" : ""))).join("") || '<span class="gs-faint">—</span>'));
    }
    box.appendChild(piles);
    // 겹치기: 묶음 폭에 맞춰 카드 간격을 줄인다
    const first = piles.querySelector(".hw"), cw = first ? first.offsetWidth : 20;
    for (const pc of piles.children) {
      const cards = pc.querySelectorAll(".hw"), k = cards.length;
      if (k < 2) continue;
      const W = pc.clientWidth || 70;
      const step = Math.min(cw + 2, (W - cw) / (k - 1));
      for (let i = 1; i < k; i++) cards[i].style.marginLeft = (step - cw) + "px";
    }
  }

  /* 바닥 칸: 더미 + 월별 묶음 (+ 고른 패가 놓일 빈자리) */
  function floorCells(v) {
    const byM = new Map();
    for (const c of v.floor) { const m = monthOf(c); if (!byM.has(m)) byM.set(m, []); byM.get(m).push(c); }
    const selM = sel && !isBonus(sel) ? monthOf(sel) : 0;
    const cells = [{ deck: true, d: 1 }];
    for (const m of [...byM.keys()].sort((a, b) => a - b)) cells.push({ m, cs: byM.get(m), d: byM.get(m).length });
    if (selM && !byM.has(selM)) cells.push({ ghost: selM, d: 1 });
    return cells;
  }

  /* 손패 줄 수 · 카드 크기와 바닥 카드 크기를 함께 정한다: 둘 중 작은 쪽이 가장 커지게 */
  function layout(W, cells) {
    const v = M.v, hand = R("hand"), table = R("table");
    hand.style.height = "0px";
    const T0 = table.clientHeight || 300, Wf = table.clientWidth || W - 12;    // 손패 높이가 0 일 때 펠트 높이
    const depths = cells.map(x => x.d);
    const count = v.hand.length + (v.flips[M.me] ? 1 : 0);
    const tagH = 14, gap = 5;
    if (!count) return { rows: 1, per: 1, hc: 40, hh: 44, fl: floorLayout(depths, Wf, T0 - 44, W) };
    let best = null;
    for (let rows = 1; rows <= Math.min(3, count); rows++) {
      const per = Math.ceil(count / rows);
      if (rows > 1 && Math.ceil(count / (rows - 1)) === per) continue;
      const byW = Math.floor((W - 12 - (per - 1) * gap) / per);
      for (let hc = Math.min(byW, 84); hc >= 28; hc -= 2) {
        const hh = rows * (Math.ceil(hc * 1.55) + tagH) + (rows - 1) * gap;
        const fl = floorLayout(depths, Wf, T0 - hh, W);
        const s = Math.min(hc, fl.cw) + 0.01 * (hc + fl.cw) - (rows - 1) * 2;     // 같으면 한 줄이 보기 편하다
        if (!best || s > best.s) best = { rows, per, hc, hh, fl, s };
      }
    }
    if (!best) { const hc = 28; best = { rows: 1, per: count, hc, hh: Math.ceil(hc * 1.55) + tagH, fl: null }; best.fl = floorLayout(depths, Wf, T0 - best.hh, W); }
    best.fl.cw = Math.max(24, Math.floor(best.fl.cw));
    return best;
  }

  function renderTable(cells, L) {
    const v = M.v, me = M.me, fl = R("floor");
    const selM = sel && !isBonus(sel) ? monthOf(sel) : 0;
    const ask = open("choose");
    const opts = ask && v.ch ? v.ch.options : [];
    const cur = new Set(v.cur ? [...v.cur.played, ...v.cur.flipped] : []);
    const handM = new Set(v.hand.filter(c => !isBonus(c)).map(monthOf));
    const cw = L.cw, ch = Math.round(cw * 1.55), off = Math.round(ch * OFFR);
    R("table").style.setProperty("--fw", cw + "px");
    R("table").style.setProperty("--fh", ch + "px");
    fl.style.gridTemplateColumns = `repeat(${L.c}, ${cw}px)`;
    fl.innerHTML = "";
    for (const x of cells) {
      if (x.deck) {
        fl.appendChild(el("div", "gs-stack gs-deck", `<div class="hw back"><i></i></div><div class="gs-dk"><b>${v.deck || "끝"}</b><small>${v.round}/${v.rounds}판</small>` +
          `${v.nagari > 1 ? `<span class="gs-nag">×${v.nagari}</span>` : ""}</div>`));
        continue;
      }
      if (x.ghost) { fl.appendChild(el("div", "gs-stack ghost", `<span>${x.ghost}월<br>여기에</span>`)); continue; }
      const mm = x.m, cs = x.cs;
      const st = el("div", "gs-stack" + (mm === selM ? " match" : "") + (handM.has(mm) ? " hm" : "") + (v.ppeok.includes(mm) ? " ppeok" : ""));
      st.style.height = (ch + (cs.length - 1) * off) + "px";
      cs.forEach((c, i) => {
        const cls = [];
        if (anim.has(c)) cls.push("in");
        if (mm === selM) cls.push("can");
        if (opts.includes(c)) cls.push("pick");
        if (cur.has(c)) cls.push("cur");
        const thr = A.threat(c), mn = A.mineNeed(c);
        const d = el("div", "gs-fc", hwHTML(c, cls.join(" ")) +
          (thr.length ? `<span class="gs-mk bad" title="${esc(thr.map(t => `${name(t.q)} ${t.label}`).join(", "))} 완성 패">!</span>`
            : mn.length ? `<span class="gs-mk good" title="내 ${esc(mn.map(t => t.label).join(", "))} 완성 패">★</span>` : ""));
        d.style.top = i * off + "px";
        if (opts.includes(c)) { d.classList.add("tap"); d.onclick = () => send({ take: c }, "choose"); }
        st.appendChild(d);
      });
      if (v.ppeok.includes(mm)) st.insertAdjacentHTML("beforeend", '<span class="gs-pk">뻑</span>');
      fl.appendChild(st);
    }

    // 고르기: 큰 카드 두 장 + 고르면 어떻게 되는지
    const pk = R("pick");
    if (opts.length) {
      pk.hidden = false;
      const x = v.ch.stage === "play" ? (v.cur && v.cur.played[0]) : (v.cur && v.cur.flipped[v.cur.flipped.length - 1]);
      const base = A.P[me].sc;
      pk.innerHTML = `<div class="gs-pick-t">${v.ch.stage === "play" ? "낸" : "뒤집은"} ${v.ch.m}월 패로 <b>가져갈 카드</b>를 고르세요</div><div class="gs-pick-c"></div>`;
      const row = pk.querySelector(".gs-pick-c");
      for (const c of opts) {
        const after = scoreOf([...v.caps[me], ...(x ? [x] : []), c]);
        const done = after.items.map(i => i[0]).filter(l => SET_ITEM.test(l) && !base.items.some(y => y[0] === l));
        const delta = after.total - base.total;
        const thr = A.threat(c);
        const note = done.length ? `<em class="gold">${done.join("·")} 완성 +${delta}</em>` : delta > 0 ? `<em class="gold">+${delta}점</em>`
          : thr.length ? `<em class="block">${esc(thr.map(t => `${name(t.q)} ${t.label}`).join(", "))} 막기</em>` : "";
        const b = el("button", "gs-pbtn", hwHTML(c, "lg") + `<small>${esc(cardName(c))}</small>${note}`);
        b.onclick = () => send({ take: c }, "choose");
        row.appendChild(b);
      }
    } else pk.hidden = true;
  }

  /* 바닥 격자: 줄 수를 바꿔 보며 카드가 가장 커지는 배치 */
  function floorLayout(depths, Wf, Hf, W) {
    const gx = 6, gy = 8, px = 8, py = 9, cap = Math.min(112, Math.floor((W - 28) / 3.4));
    let best = null;
    for (let r = 1; r <= Math.min(4, depths.length); r++) {
      const c = Math.ceil(depths.length / r), rows = Math.ceil(depths.length / c);
      const byW = (Wf - 2 * px - (c - 1) * gx) / c;
      let units = 0;
      for (let i = 0; i < rows; i++) units += 1.55 * (1 + (Math.max(...depths.slice(i * c, (i + 1) * c)) - 1) * OFFR);
      const byH = (Hf - 2 * py - (rows - 1) * gy) / units;
      const cw = Math.min(byW, byH);
      if (!best || cw > best.cw + 0.5) best = { c, rows, cw };
    }
    best.cw = Math.min(best.cw, cap);
    return best;
  }

  function renderHand(lay) {
    const v = M.v, me = M.me, hand = R("hand");
    const ask = open("play");
    const flips = v.flips[me] || 0;
    const count = v.hand.length + (flips ? 1 : 0);
    hand.innerHTML = "";
    const cw = lay.hc, per = lay.per;
    hand.style.setProperty("--hw", cw + "px");
    hand.style.height = lay.hh + "px";
    if (!count) {
      hand.style.maxWidth = "none";
      hand.innerHTML = `<div class="gs-faint gs-nohand">${["roundEnd", "over"].includes(v.phase) ? "" : "손패를 다 냈습니다"}</div>`;
      return;
    }
    hand.style.maxWidth = (per * cw + (per - 1) * 5) + "px";
    for (const c of v.hand) {
      const I = handInfo(v, c);
      const cls = [];
      if (c === sel) cls.push("sel");
      if (I.can) cls.push("can");
      if (anim.has(c)) cls.push("in");
      const sp = I.bomb ? "" : I.shake ? '<span class="gs-sb">흔들</span>' : "";
      const b = el("button", "gs-hc" + (I.can ? "" : " nm"), hwHTML(c, cls.join(" ")) + sp + `<span class="gs-ht ${I.tcls}">${I.tag || "&nbsp;"}</span>`);
      b.setAttribute("aria-label", cardName(c) + (I.tag ? ` — ${I.tag}` : ""));
      b.onclick = () => tap(c);
      hand.appendChild(b);
    }
    if (flips) {
      const b = el("button", "gs-hc gs-flip", `<div class="hw back${ask ? " can" : ""}"><i></i></div><span class="gs-fl">뒤집기<br>×${flips}</span><span class="gs-ht">&nbsp;</span>`);
      b.setAttribute("aria-label", "패 뒤집기만 하기");
      b.onclick = () => { if (open("play")) send({ flip: true }, "play"); else ctx.toast("내 차례에 누르세요"); };
      hand.appendChild(b);
    }
  }

  /* 고른 카드를 내면 어떻게 되는지 — 점수 변화까지 */
  function describe(v, c) {
    if (isBonus(c)) return `${esc(cardName(c))} — 내면 바로 내 피(+${CARDS[c].pv})가 되고 한 장 더 받습니다`;
    const I = handInfo(v, c), m = I.m, F = I.F;
    let t;
    if (I.bomb) t = `<b>💣 폭탄</b> 가능 — ${m}월 4장 + 상대마다 피 1장`;
    else if (I.kind === "lay") t = `${m}월은 바닥에 없어 깔립니다` + (I.shake ? " · <b>흔들기</b> 가능" : "");
    else if (I.kind === "pair") t = `바닥 ${esc(cardName(I.gains[1]))}와 짝`;
    else if (I.kind === "pair2") t = `${esc(kindLabel(F[0]))}·${esc(kindLabel(F[1]))} 중 골라 먹기`;
    else t = v.ppeok.includes(m) ? "뻑 3장 모두 먹고 피 뺏기" : `${m}월 3장 모두 먹기`;
    if (I.delta > 0) {
      const P = A.P[M.me], now = P.sc.total, aft = I.after.total;
      t += ` → <b class="gold">${I.done.length ? I.done.join("·") + " 완성 " : ""}+${I.delta}점</b> (${now}→${aft}${aft >= P.goal ? " · 날 수 있음" : ""})`;
    }
    if (I.blocks.length) t += ` · <b class="block">${esc(I.blocks.join(", "))} 막기</b>`;
    if (I.gives.length) t += ` · <b class="bad">⚠ ${esc(I.gives.join(", "))} 재료를 내줌</b>`;
    return t;
  }

  function renderHint() {
    const v = M.v, me = M.me, h = R("hint");
    let t;
    if (v.phase === "over") t = "게임 끝";
    else if (v.phase === "roundEnd") t = v.round >= v.rounds ? "마지막 판이 끝났습니다" : "곧 다음 판이 시작됩니다";
    else if (open("choose")) t = "<b>가져갈 바닥 카드</b>를 고르세요";
    else if (open("gostop")) t = "<b>고? 스톱?</b>";
    else if (open("play")) t = sel ? `<b>다시 누르면 냄</b> · ${describe(v, sel)}`
      : v.hand.length ? "<b>내 차례</b> — 낼 카드를 누르세요 (아래 글씨: 먹는 패 · 점수)" : "<b>내 차례</b> — 「뒤집기」를 누르세요";
    else if (sel) t = describe(v, sel);
    else if (v.turn === me) t = "…";
    else t = `${esc(name(v.turn))} 님 ${v.phase === "choose" ? "카드 고르는 중" : v.phase === "gostop" ? "고/스톱 고민 중" : "차례"} — 손패를 눌러 미리 볼 수 있습니다`;
    h.innerHTML = `<span>${t}</span>`;
  }

  /* ---------------- 판 결과 ---------------- */
  function renderOver() {
    const v = M.v, box = R("over"), r = v.result;
    if (!r || !["roundEnd", "over"].includes(v.phase) || hiddenRound === r.round) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = resultHTML(v, r) + `<div class="gs-ofoot"><small>${v.phase === "over" || v.round >= v.rounds ? "마지막 판이었습니다" : "잠시 후 다음 판"}</small><button class="btn small">닫기</button></div>`;
    box.querySelector(".gs-ofoot button").onclick = () => { hiddenRound = r.round; box.hidden = true; };
  }
  function resultHTML(v, r) {
    const me = M.me;
    let h = `<div class="eyebrow">${r.round}판 결과</div>`;
    if (r.kind === "nagari") {
      h += `<h3>나가리</h3><p>아무도 스톱하지 못했습니다. 다음 판 점수는 <b>×${r.nagari}</b></p>`;
    } else if (r.kind === "chongtong") {
      h += `<h3>${r.winner === me ? "총통! 🎉" : `${who(r.winner)} 님 총통!`}</h3><div class="gs-rcards">${r.cards.map(c => hwHTML(c, "md")).join("")}</div>` +
        `<p>${r.m}월 4장 — <b>10점</b>${r.nagari > 1 ? ` × 나가리 ${r.nagari}` : ""}</p>` + payHTML(r);
    } else {
      const s = r.score;
      h += `<h3>${r.winner === me ? "이겼습니다! 🎉" : `${who(r.winner)} 님 승리`}${r.how === "auto" ? " <small>(패를 다 내서 자동 스톱)</small>" : ""}</h3>`;
      h += `<div class="gs-items">${s.items.map(([l, p]) => `<span>${esc(l)} <b>${p}</b></span>`).join("")}</div>`;
      let calc = `${r.base}점`;
      if (r.go) calc += ` + ${r.go}고 ${r.go}점`;
      if (r.goMul > 1) calc = `(${calc}) × ${r.goMul} (${r.go}고)`;
      h += `<p class="gs-calc">${calc} = <b>${r.pts}점</b></p>`;
      const mul = [];
      if (r.shakes) mul.push(`흔들기·폭탄 ×${2 ** r.shakes}`);
      if (r.nagari > 1) mul.push(`나가리 ×${r.nagari}`);
      if (mul.length) h += `<p class="gs-calc">모두에게: ${mul.join(" · ")}</p>`;
      h += payHTML(r);
    }
    h += `<div class="gs-totals">${M.players.map((pl, p) => `<span class="${p === me ? "me" : ""}">${who(p)} <b>${signed(v.totals[p])}</b>` +
      `${r.deltas && r.deltas[p] ? `<small>(${signed(r.deltas[p])})</small>` : ""}</span>`).join("")}</div>`;
    return h;
  }
  function payHTML(r) {
    if (!r.losers || !r.losers.length) return "";
    const rows = r.losers.map(l => {
      const t = [];
      if (l.pibak) t.push(`피박 ×2 <small>(피 ${l.pi})</small>`);
      if (l.gwangbak) t.push("광박 ×2");
      if (l.meongbak) t.push("멍박 ×2");
      if (l.gobak) t.push("고박 — 두 사람 몫");
      if (l.covered) t.push("고박 덕에 면제");
      const calc = l.mul > 1 && !l.covered ? `<small class="gs-pcalc">${l.amount / l.mul}×${l.mul}</small>` : "";
      return `<tr><td>${who(l.p)}</td><td>${t.map(x => `<span class="gs-mul">${x}</span>`).join("") || '<span class="gs-faint">배수 없음</span>'}</td><td class="pay">${calc}−${l.pay}</td></tr>`;
    }).join("");
    return `<table class="gs-pay"><tbody>${rows}</tbody></table>`;
  }

  /* ---------------- 고 · 스톱 창 ---------------- */
  function openGoStop(ask) {
    if (gsBox && gsBox.id === ask.id) return;
    closeGoStop();
    const v = M.v, me = M.me, sc = v.scores[me], pv = v.preview;
    const entry = { id: ask.id, close: null };
    gsBox = entry;
    ctx.sound.good();
    ctx.modal((box, close) => {
      entry.close = close;
      const goN = v.go[me] + 1;
      ctx.head(box, v.go[me] ? `${v.go[me]}고 하는 중` : "났습니다!", `${sc.total}점 — 고? 스톱?`,
        sc.items.map(([l, p]) => `${esc(l)} ${p}점`).join(" · "));
      const stopGain = pv ? pv.deltas[me] : 0;
      const lines = [];
      if (pv) {
        const mults = pv.losers.map(l => {
          const t = [l.pibak && "피박", l.gwangbak && "광박", l.meongbak && "멍박", l.gobak && "고박"].filter(Boolean);
          return `${who(l.p)} −${l.pay}${t.length ? ` (${t.join("·")})` : ""}`;
        });
        lines.push(`<li><b>스톱</b>: 지금 끝내고 <b>${stopGain}점</b>을 받습니다 — ${mults.join(", ")}</li>`);
      }
      lines.push(`<li><b>${goN}고</b>: 판을 계속합니다. ${goN <= 2 ? `+${goN}점` : `점수에 ×${2 ** (goN - 2)}`} — 다음에 점수가 더 나야 다시 고/스톱을 고를 수 있습니다.</li>`);
      // 상대 위협: 점수 · 1장 남은 약
      const thr = [];
      for (const P of A.P) {
        if (P.q === me) continue;
        const near = SETS.filter(s => P.sets[s].near).map(s => SET_NAME[s]);
        if (P.sc.g === 2 && P.missG.length) near.push("3광");
        thr.push(`${who(P.q)} ${P.sc.total}점 (나기까지 ${P.need})${near.length ? ` · <b>${near.join("·")} 1장 남음</b>` : ""}`);
      }
      lines.push(`<li>상대: ${thr.join(" / ")}</li>`);
      lines.push(`<li>상대가 먼저 나면 내가 집니다${v.n === 3 ? " — <b>고박</b>: 두 사람 몫을 혼자 냅니다" : ""}. 아무도 못 나면 나가리.</li>`);
      lines.push(`<li>내 남은 패 ${v.hand.length + (v.flips[me] || 0)}장 · 더미 ${v.deck}장</li>`);
      box.appendChild(el("ul", "gs-golist", lines.join("")));
      ctx.buttonRow(box, [
        { label: "스톱", on: () => { if (send({ go: false }, "gostop")) close(); } },
        { label: `${goN}고!`, primary: true, on: () => { if (send({ go: true }, "gostop")) close(); } }
      ]);
    }, { dismissible: false }).then(() => { if (gsBox === entry) gsBox = null; });
  }
  function closeGoStop() {
    if (gsBox) { const b = gsBox; gsBox = null; if (b.close) b.close(null); }
  }

  /* ---------------- 먹은 패 보기 ---------------- */
  function showCaps(q) {
    const v = M.v, sc = v.scores[q];
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[q]) groups[groupOf(c, sc.guk)].push(c);
    const pts = { g: sc.gp, t: sc.tp, y: sc.yp, p: sc.pp };
    ctx.modal(box => {
      ctx.head(box, "먹은 패", `${q === M.me ? "나" : esc(name(q))} — ${sc.total}점`,
        sc.items.length ? sc.items.map(([l, p]) => `${esc(l)} ${p}점`).join(" · ") : "아직 점수가 없습니다");
      for (const [k, label] of GROUPS) {
        const cs = groups[k];
        const guk = sc.guk && cs.includes("9a") ? ` <small>(9월 국진을 ${k === "p" ? "쌍피" : "열끗"}로 셈)</small>` : "";
        box.insertAdjacentHTML("beforeend", `<div class="gs-mg"><div class="gs-mgh">${label} ${k === "p" ? `${sc.pi}장 <small>(쌍피 2 · 쓰리피 3)</small>` : `${cs.length}장`}` +
          ` · <b>${pts[k]}점</b>${guk}</div>` +
          `<div class="gs-mgc">${cs.map(c => hwHTML(c, "md")).join("") || '<span class="gs-faint">없음</span>'}</div></div>`);
      }
    });
  }

  /* ---------------- 행동 보내기 ---------------- */
  function tap(c) {
    if (sel !== c) { sel = c; render(); return; }
    if (!open("play")) { ctx.toast("아직 내 차례가 아닙니다"); return; }
    play(c);
  }
  async function play(c) {
    const v = M.v;
    if (isBonus(c)) { send({ bonus: c }, "play"); return; }
    const m = monthOf(c);
    let a = { card: c };
    if (v.can && v.can.bomb.includes(m)) {
      const r = await ctx.choose(`${m}월 폭탄?`, `${m}월 3장을 들고 있고 바닥에 나머지 1장이 있습니다.`, [
        { value: "bomb", label: "💣 폭탄 — 3장을 한꺼번에", note: "4장을 다 먹고 상대마다 피 1장씩 · 이기면 ×2 · 뒤집기만 하는 차례 2번" },
        { value: "one", label: "한 장만 내기", note: "바닥의 1장과 짝" }]);
      if (!r) return;
      if (r === "bomb") a.bomb = true;
    } else if (v.can && v.can.shake.includes(m)) {
      const r = await ctx.choose(`${m}월 흔들기?`, `${m}월 3장을 들고 있습니다. 흔들면 3장을 모두에게 보여 주고, 이 판을 이기면 점수 ×2.`, [
        { value: "shake", label: "흔들고 내기", note: "이기면 ×2" },
        { value: "one", label: "그냥 내기" }]);
      if (!r) return;
      if (r === "shake") a.shake = true;
    }
    send(a, "play");
  }
  function send(a, kind) {
    const ask = open(kind);
    if (!ask) return false;
    if (!ctx.send(a)) return false;
    sentId = ask.id; sel = null;
    render();
    return true;
  }

  /* ---------------- 이벤트: 소리 · 큰 글씨 ---------------- */
  let bannerT = 0;
  function banner(text, cls = "") {
    const b = R("banner");
    b.innerHTML = `<b class="${cls}">${esc(text)}</b>`;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.innerHTML = ""; }, 1500);
  }
  function events(m) {
    const me = m.me, S = ctx.sound;
    for (const e of m.ev || []) {
      if (e.type === "deal") S.deal();
      else if (e.type === "play") S.place();
      else if (e.type === "flip") later(() => S.flip(), 230);
      else if (e.type === "bonus" && !e.floor) { if (e.p === me) S.good(); }
      else if (e.type === "turn") {
        if (e.captured.length) later(() => S.deal(), 430);
        const robbed = e.stolen.some(s => s.from === me);
        if (e.combos.length) {
          banner(e.combos.join(" · ") + "!", e.p === me ? "good" : robbed ? "bad" : "");
          later(() => (e.p === me ? S.good() : robbed ? S.bad() : S.chip()), 520);
          if (e.p === me) ctx.buzz(40);
        }
      } else if (e.type === "go") { banner(`${e.go}고!`, "go"); S.chip(); }
      else if (e.type === "roundEnd") { banner(e.winner === me ? "스톱! 승리" : "스톱!", e.winner === me ? "good" : "bad"); later(() => (e.winner === me ? S.good() : S.bad()), 300); }
      else if (e.type === "nagari") { banner("나가리", ""); S.pass(); }
      else if (e.type === "chongtong") { banner("총통!", e.p === me ? "good" : "bad"); later(() => (e.p === me ? S.good() : S.bad()), 300); }
    }
  }

  let lastW = 0, lastH = 0;
  function onResize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; render(); }
  }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,                 // 마지막 차례는 각 정보판에 직접 보인다
    destroy() {
      window.removeEventListener("resize", onResize);
      for (const t of timers) clearTimeout(t);
      clearTimeout(bannerT);
      closeGoStop();
      root.innerHTML = "";
    }
  };
}
