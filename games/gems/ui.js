/* 보석 상인 화면
   위(판): 상대 줄(점수 · 색별 보너스/보석 · 찜 · 방금 한 일) · 귀인(나와 상대가 몇 장 남았나) · 카드 3줄 · 은행 보석
   아래(dock): 안내(보석 고르는 중이면 취소/가져오기) · 내 상태 한 줄(점수 · 색별 보너스/보석 · 황금 · 찜 카드)
   계산은 화면이 한다 — 카드마다 「살 수 있음」 또는 색별로 모자란 개수와 「부족 N」, 보석을 고르는 동안에는
   가져온 뒤를 미리 계산해 보여 준다. 카드 크기는 남은 높이를 재서 정한다 (스크롤 없이 한 화면). */
import { COLORS, ALL, CNAME, payFor } from "./engine.js";

const ROMAN = ["", "Ⅰ", "Ⅱ", "Ⅲ"];
const tokSum = t => ALL.reduce((a, c) => a + (t[c] || 0), 0);
const qualifies = (bon, N) => COLORS.every(c => (bon[c] || 0) >= N.req[c]);
const nobleRem = (bon, N) => COLORS.reduce((a, c) => a + Math.max(0, N.req[c] - (bon[c] || 0)), 0);
const addTok = (a, b) => { const o = {}; for (const c of ALL) o[c] = (a[c] || 0) + (b[c] || 0); return o; };

/* 카드 한 장을 내 보너스 · 보석(tok)으로 따져 본다
   short: 색마다 모자란 개수(황금 쓰기 전), free: 보너스로 다 덮인 색, miss: 황금까지 써도 모자란 개수 */
function judge(bon, tok, C) {
  const short = {}, free = {};
  let tot = 0;
  for (const c of COLORS) {
    if (!C.cost[c]) continue;
    const need = Math.max(0, C.cost[c] - (bon[c] || 0));
    if (!need) { free[c] = 1; continue; }
    const s = Math.max(0, need - (tok[c] || 0));
    if (s) { short[c] = s; tot += s; }
  }
  const miss = Math.max(0, tot - (tok.y || 0));
  return { short, free, miss, ok: miss === 0, gold: Math.min(tot, tok.y || 0) };
}
/* 이 색 보너스가 하나 늘면 새로 찾아올 귀인 */
function nobleBy(nobles, bon, c) {
  const b2 = { ...bon }; b2[c] = (b2[c] || 0) + 1;
  return nobles.find(N => !qualifies(bon, N) && qualifies(b2, N)) || null;
}

/* 카드 한 장 (view 의 카드 객체 또는 {t, hidden})
   info: { j: judge 결과, marks: 색별 부족 표시 여부, tag: 가운데 배지 HTML, flags: 위쪽 가운데 작은 표시 HTML } */
function cardHTML(C, extra = "", info = null) {
  if (!C) return `<div class="gm-card gm-none ${extra}"></div>`;
  if (C.hidden) return `<div class="gm-card gm-back t${C.t} ${extra}"><b>${ROMAN[C.t]}</b><small>비공개</small></div>`;
  const j = info && info.j;
  const cost = COLORS.filter(c => C.cost[c] > 0).map(c => {
    const s = j && info.marks && j.short[c], f = j && j.free[c];
    return `<i class="gm-dot gm-${c}${f ? " free" : ""}">${C.cost[c]}${s ? `<sup>−${s}</sup>` : ""}</i>`;
  }).join("");
  return `<div class="gm-card gm-${C.c} t${C.t}${C.blind ? " blind" : ""} ${extra}">` +
    `<span class="gm-pt">${C.pt || ""}</span><span class="gm-gem gm-${C.c}"><i></i></span>` +
    `<span class="gm-art gm-${C.c}"></span>` +
    (info && info.flags ? `<span class="gm-flags">${info.flags}</span>` : "") +
    (info && info.tag ? info.tag : "") +
    `<span class="gm-cost">${cost}</span>` +
    (C.blind ? '<span class="gm-blind">비공개</span>' : "") + `</div>`;
}
const gemHTML = (c, extra = "") => `<span class="gm-gem gm-${c} ${extra}"><i></i></span>`;
const chipHTML = (c, n, extra = "") => `<span class="gm-chip gm-${c} ${extra}">${n !== undefined ? `<b>${n}</b>` : ""}</span>`;
const pips = t => ALL.map(c => `<i class="gm-pip gm-${c}"></i>`.repeat(t[c] || 0)).join("");

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "gm");
  wrap.innerHTML = `
    <div class="gm-board felt">
      <div class="gm-opps" data-r="seats"></div>
      <div class="gm-nobles" data-r="nobles"></div>
      <div class="gm-rows" data-r="rows"></div>
      <div class="gm-bank" data-r="bank"></div>
    </div>
    <div class="dock gm-dock">
      <div class="gm-bar" data-r="bar"></div>
      <div class="gm-me" data-r="me"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null, seenMsg = null;
  let sel = {}, selAsk = 0;          // 은행에서 고른 보석 (그 차례의 ask id 에 묶는다)
  let sheet = null;                  // 열린 아래 창 {close, fill}
  let sub = null;                    // 열린 버리기 · 귀인 창 {id, close}
  let pulse = {}, pulseMe = {}, pop = new Set();   // 이번 소식에만 보여 줄 움직임 (은행 · 내 보석 · 새 카드)

  const nameOf = p => (M && M.players[p] ? M.players[p].name : "?");
  const myTurn = () => !!ctx.myAsk("turn");

  /* ---------------- 크기: 화면 높이를 재서 한 번에 정한다 ----------------
     판 높이 = 화면 − 아래 조작 영역. 상대 줄 · 귀인 · 은행은 기본 크기로 두고 남는 높이를 카드에 준다.
     카드가 폭에 막혀 더 못 커지면 남는 높이를 상대 줄 · 귀인 · 은행 · 카드 세로 비율에 나눠 준다 (빈 띠가 생기지 않게). */
  let fitKey = "";
  function fit() {
    if (!M) return;
    const board = wrap.firstElementChild, dock = wrap.lastElementChild;
    const W = board.clientWidth - 8, stageH = wrap.clientHeight;
    if (W <= 0 || stageH <= 0) return;
    const nOpp = M.v.players.length - 1;
    const tall = stageH >= 700;
    wrap.style.setProperty("--mys", (tall ? 28 : stageH >= 620 ? 26 : 24) + "px");
    const boardH = stageH - dock.offsetHeight - 4;
    const gap = W < 360 ? 4 : 5;
    let vgap = gap;
    const inner = boardH - 9 - 12;
    let oh = 40, nh = 50, tks = 36;            // 상대 줄도 누르는 곳이라 40px 이상
    const dw = Math.round(Math.max(26, Math.min(34, W * 0.085)));
    const cwMax = Math.min((W - dw - 4 * gap) / 4, 110);
    const rowsFor = ch => 3 * ch + 2 * gap;
    const fixed = () => nOpp * oh + (nOpp - 1) * 3 + nh + tks + 8;
    let avail = inner - fixed(), ch, cw = cwMax;
    if (avail >= rowsFor(cwMax * 1.42)) {
      // 카드는 폭에 막혔다 — 남는 높이를 나눠 준다
      let spare = avail - rowsFor(cwMax * 1.42);
      const dOh = Math.min(14, spare * 0.3 / nOpp); oh += dOh; spare -= dOh * nOpp;
      const dNh = Math.min(26, spare * 0.4); nh += dNh; spare -= dNh;
      const dTk = Math.min(10, spare * 0.3); tks += dTk; spare -= dTk;
      avail = inner - fixed();
      ch = Math.min((avail - 2 * gap) / 3, cwMax * 1.7);
      vgap = Math.max(gap, Math.min(10, (avail - 3 * ch) / 4));   // 그래도 남으면 줄 사이를 조금 띄운다
    } else {
      ch = Math.max(40, (avail - 2 * gap) / 3);
      if (ch < cw * 0.98) cw = ch / 0.98;          // 너무 납작하면 폭을 줄인다
    }
    const key = [W, stageH, nOpp, Math.floor(cw), Math.floor(ch), Math.floor(vgap)].join();
    if (key === fitKey) return;
    fitKey = key;
    const set = (k, x) => wrap.style.setProperty(k, Math.floor(x) + "px");
    set("--cw", cw); set("--chh", ch); set("--dw", dw); set("--rg", gap); set("--rgv", vgap);
    set("--oh", oh); set("--nh", nh); set("--tks", tks);
    wrap.style.setProperty("--fs", oh >= 48 ? "1.12" : oh >= 44 ? "1.08" : "1");
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  if (ro) ro.observe(wrap);
  else window.addEventListener("resize", fit);

  /* ---------------- 그리기 ---------------- */
  function update(m) {
    M = m;
    const ask = ctx.myAsk("turn");
    if (!ask || ask.id !== selAsk) { sel = {}; selAsk = ask ? ask.id : 0; }
    if (m !== seenMsg) { seenMsg = m; effects(m); }
    draw();
    pulse = {}; pulseMe = {}; pop = new Set();
    syncSub();
    if (sheet) sheet.fill();
  }
  function draw() {
    if (!M) return;
    const T = threats();
    drawSeats(T); drawNobles(); drawRows(T); drawBank(); drawDock();
    fit();
  }

  function effects(m) {
    let placed = false;
    const mark = (e, t) => { for (const c in t) if (t[c]) { pulse[c] = 1; if (e.p === m.me) pulseMe[c] = 1; } };
    for (const e of m.ev || []) {
      if (e.type === "take") { ctx.sound.chip(); mark(e, e.take); }
      else if (e.type === "buy") { ctx.sound.place(); mark(e, e.pay); placed = true; }
      else if (e.type === "reserve" || e.type === "reserveDeck") { ctx.sound.flip(); if (e.gold) mark(e, { y: 1 }); placed = e.type === "reserve" || placed; }
      else if (e.type === "discard") { ctx.sound.chip(); mark(e, e.discard); }
      else if (e.type === "noble") { if (e.p === m.me) { ctx.sound.good(); ctx.buzz(80); } else ctx.sound.deal(); }
      else if (e.type === "final") ctx.sound.turn();
      else if (e.type === "pass") ctx.sound.pass();
    }
    if (placed) pop = new Set(m.v.fresh);
  }

  /* 이번 판에 q 가 한 번 더 둘 수 있나 (마지막 바퀴면 시작 자리 앞까지만) */
  function hasTurnLeft(q) {
    const v = M.v, n = v.players.length;
    if (v.phase !== "play") return false;
    if (!v.final) return true;
    const pos = x => (x - v.start + n) % n;
    return pos(q) >= pos(v.turn);
  }
  /* 다음 차례에 승리 점수에 닿을 수 있는 상대 → {q: [카드 id…]} (펼쳐진 카드 · 공개된 찜 카드, 귀인 3점 포함) */
  function threats() {
    const v = M.v, out = {};
    v.players.forEach((Q, q) => {
      if (q === M.me || Q.pts >= v.goal || !hasTurnLeft(q)) return;
      const ids = [];
      const look = C => {
        if (!C || C.hidden || !payFor(Q.tok, Q.bon, C)) return;
        if (Q.pts + C.pt + (nobleBy(v.nobles, Q.bon, C.c) ? 3 : 0) >= v.goal) ids.push(C.id);
      };
      v.market.forEach(row => row.forEach(look));
      Q.res.forEach(look);
      if (ids.length) out[q] = ids;
    });
    return out;
  }

  /* 상대들: 내 다음 사람부터 차례 순서대로. 누르지 않아도 핵심이 다 보이게 */
  function drawSeats(T) {
    const v = M.v, box = R("seats");
    box.innerHTML = "";
    const n = v.players.length;
    box.className = "gm-opps n" + (n - 1);
    for (let k = 1; k < n; k++) {
      const q = (M.me + k) % n, P = v.players[q], pl = M.players[q] || { name: "?" };
      const turn = q === v.turn && v.phase === "play", thr = T[q];
      const nt = tokSum(P.tok), left = v.goal - P.pts;
      const row = el("button", "gm-opp" + (turn ? " turn" : "") + (thr ? " threat" : ""));
      const cells = COLORS.map(c => `<span class="gm-oc"><i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i>` +
        `<i class="gm-tk gm-${c}${P.tok[c] ? "" : " zero"}">${P.tok[c]}</i></span>`).join("") +
        `<span class="gm-oc"><i class="gm-bon gm-blank"></i><i class="gm-tk gm-y${P.tok.y ? "" : " zero"}">${P.tok.y}</i></span>`;
      const l2 = thr ? `<span class="gm-warn">⚠ 다음 차례 ${v.goal}점 가능</span>`
        : left <= 0 ? `<span class="gm-good">${v.goal}점 달성</span>`
        : `${v.goal}까지 <b>${left}</b> · 보석 <b class="${nt >= 9 ? "hi" : ""}">${nt}</b>${P.nobles.length ? ` · 👑${P.nobles.length}` : ""}`;
      row.innerHTML = `<span class="gm-oav">${avatarHTML(pl.name, q, "sm")}` +
          (pl.kind === "ai" ? '<span class="gm-tag">AI</span>' : pl.kind === "away" ? '<span class="gm-tag away">비움</span>' : "") +
          (q === v.start ? '<i class="gm-first" title="첫 차례">선</i>' : "") + `</span>` +
        `<b class="gm-opt">${P.pts}</b>` +
        `<span class="gm-onm"><span class="gm-l1"><span class="nm">${esc(pl.name)}</span>${didHTML(q)}</span><span class="gm-l2">${l2}</span></span>` +
        `<span class="gm-ocols">${cells}</span>` +
        `<span class="gm-ores${P.res.length ? "" : " zero"}"><small>찜</small><b>${P.res.length}</b></span>`;
      row.setAttribute("aria-label", `${pl.name} ${P.pts}점, 카드 ${P.ncards}장, 보석 ${nt}개, 찜 ${P.res.length}장${thr ? ", 다음 차례에 승리 점수 가능" : ""}`);
      row.onclick = () => openPlayer(q);
      box.appendChild(row);
    }
  }
  /* 방금 행동한 사람 이름 옆에 붙는 작은 배지 */
  function didHTML(q) {
    const L = M.v.last;
    if (!L || L.p !== q || M.v.phase !== "play") return "";
    let t = "";
    if (L.type === "take") t = pips(L.take);
    else if (L.type === "buy") t = `${L.cv ? gemHTML(L.cv.c, "sm") : ""}구매${L.cv && L.cv.pt ? ` <b>+${L.cv.pt}</b>` : ""}`;
    else if (L.type === "reserve") t = `${L.cv ? gemHTML(L.cv.c, "sm") : ""}찜${L.gold ? '<i class="gm-pip gm-y"></i>' : ""}`;
    else if (L.type === "reserveDeck") t = `${ROMAN[L.tier]} 몰래 찜${L.gold ? '<i class="gm-pip gm-y"></i>' : ""}`;
    else if (L.type === "pass") t = "넘김";
    if (L.discard) t += ` <span class="gm-dsc">−${tokSum(L.discard)}</span>`;
    if (L.noble !== undefined) t += " 👑";
    return t ? `<span class="gm-did">${t}</span>` : "";
  }

  /* 귀인: 내가 몇 장 남았는지 + 상대마다 몇 장 남았는지 */
  function drawNobles() {
    const v = M.v, box = R("nobles"), P = v.players[M.me], n = v.players.length;
    box.innerHTML = "";
    const rems = v.nobles.map(N => nobleRem(P.bon, N));
    const best = Math.min(...rems);
    v.nobles.forEach((N, i) => {
      const rem = rems[i];
      const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}${P.bon[c] >= N.req[c] ? " ok" : ""}">${N.req[c]}</i>`).join("");
      let opp = "";
      for (let k = 1; k < n; k++) {
        const q = (M.me + k) % n, r = nobleRem(v.players[q].bon, N);
        opp += `<span class="gm-np${r <= 1 ? " hot" : ""}">${avatarHTML(nameOf(q), q, "gm-avx")}${r || "✓"}</span>`;
      }
      const mine = rem === 0 ? "조건 충족" : `${rem}장 남음`;
      const b = el("button", "gm-noble" + (rem <= 2 || (rem === best && rem <= 4) ? " near" : "") + (rem === best ? " best" : ""),
        `<span class="gm-nt"><b>3</b><span class="gm-req">${reqs}</span></span><span class="gm-nme">${mine}</span><span class="gm-nop">${opp}</span>`);
      b.setAttribute("aria-label", `귀인 ${N.name}, 나는 ${mine}`);
      b.onclick = () => openNoble(N.id);
      box.appendChild(b);
    });
  }

  /* 카드 줄: 카드마다 살 수 있는지 · 색별로 모자란 개수를 표시. 보석을 고르는 중이면 가져온 뒤 기준 */
  function drawRows(T) {
    const v = M.v, box = R("rows"), P = v.players[M.me], mine = myTurn();
    const picking = mine && Object.keys(sel).length > 0;
    const tokNow = P.tok, tokAfter = picking ? addTok(P.tok, sel) : P.tok;
    const thrBy = {};
    for (const q in T) for (const id of T[q]) (thrBy[id] = thrBy[id] || []).push(+q);
    box.innerHTML = "";
    for (let ti = 2; ti >= 0; ti--) {
      const t = ti + 1, row = el("div", "gm-row");
      const deck = el("button", `gm-deck t${t}` + (v.decks[ti] ? "" : " empty"), `<b>${ROMAN[t]}</b><small>${v.decks[ti]}</small>`);
      deck.setAttribute("aria-label", `${t}단계 더미 ${v.decks[ti]}장`);
      deck.setAttribute("data-tier", t);
      deck.onclick = () => openDeck(t);
      row.appendChild(deck);
      for (const C of v.market[ti]) {
        if (!C) { row.appendChild(el("div", "gm-card gm-none")); continue; }
        const info = cardInfo(C, P, tokNow, tokAfter, picking, thrBy[C.id]);
        const cls = info.cls + (v.fresh.includes(C.id) ? " fresh" : "") + (pop.has(C.id) ? " pop" : "") + (mine || v.phase !== "play" ? "" : " idle");
        const b = el("button", "gm-cbtn", cardHTML(C, cls, info));
        b.setAttribute("aria-label", `${t}단계 ${CNAME[C.c]} 카드 ${C.pt}점, ${info.say}`);
        b.setAttribute("data-id", C.id);
        b.onclick = () => openCard(C.id);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }
  /* 카드 한 장의 표시 정보 (배지 · 위쪽 표시 · 클래스 · 읽어 줄 말) */
  function cardInfo(C, P, tokNow, tokAfter, picking, thr) {
    const v = M.v;
    const now = judge(P.bon, tokNow, C);
    const j = picking ? judge(P.bon, tokAfter, C) : now;
    const nob = nobleBy(v.nobles, P.bon, C.c);
    const win = v.phase === "play" && P.pts < v.goal && P.pts + C.pt + (nob ? 3 : 0) >= v.goal;
    let tag, cls, say;
    if (v.phase !== "play") return { j, tag: "", flags: "", cls: "", say: "", marks: false };
    if (now.ok) {
      tag = `<span class="gm-tag2 ok">${win ? `사면 ${v.goal}점!` : "살 수 있음"}</span>`;
      cls = "can" + (win ? " win" : ""); say = "살 수 있음";
    } else if (picking && j.ok) {
      tag = `<span class="gm-tag2 will">가져오면 ✓</span>`; cls = "will"; say = "고른 보석을 가져오면 살 수 있음";
    } else {
      tag = `<span class="gm-tag2 no">부족 ${j.miss}</span>`; cls = "cant"; say = `보석 ${j.miss}개 부족`;
    }
    let flags = "";
    if (nob) flags += `<i class="gm-fl nob" title="사면 귀인">👑</i>`;
    if (thr) for (const q of thr) flags += `<i class="gm-fl thr" title="${esc(nameOf(q))} 님이 사면 승리 점수">⚠${esc([...nameOf(q)][0] || "?")}</i>`;
    // 색별로 모자란 개수는 거의 살 수 있는 카드(3개 이하 부족)에만 — 먼 카드까지 다 표시하면 오히려 읽기 어렵다
    return { j, tag, flags, cls: cls + (!j.ok && j.miss > 3 ? " far" : ""), say, marks: !j.ok && j.miss <= 3 };
  }

  function drawBank() {
    const v = M.v, box = R("bank"), mine = myTurn();
    box.innerHTML = "";
    for (const c of ALL) {
      const s = sel[c] || 0, left = v.bank[c] - s;
      const b = el("button", `gm-tok gm-${c}` + (s ? " sel" : "") + (left <= 0 ? " empty" : "") + (pulse[c] ? " pulse" : "") + (mine && c !== "y" ? " live" : ""),
        `${chipHTML(c)}<b class="gm-n">${left}</b>${s ? `<em>+${s}</em>` : ""}`);
      b.setAttribute("aria-label", `${CNAME[c]} ${v.bank[c]}개${s ? `, ${s}개 고름` : ""}`);
      b.setAttribute("data-c", c);
      b.onclick = () => tapToken(c);
      box.appendChild(b);
    }
  }

  function drawDock() {
    const v = M.v, me = M.me, P = v.players[me], ask = ctx.myAsk();
    const bar = R("bar");
    bar.innerHTML = "";
    const picking = ask && ask.kind === "turn" && Object.keys(sel).length;
    const hint = el("div", "hint gm-hint");
    if (v.phase === "over") hint.innerHTML = "게임 끝";
    else if (ask && ask.kind === "discard") hint.innerHTML = `<b>보석이 10개를 넘었습니다</b> — 돌려놓을 보석을 고르세요`;
    else if (ask && ask.kind === "noble") hint.innerHTML = `<b>귀인 여럿이 찾아왔습니다</b> — 한 명을 고르세요`;
    else if (ask) {
      if (!picking) {
        const nb = buyable(P, P.tok);
        hint.innerHTML = (v.final ? "<b>마지막 차례!</b> " : "<b>내 차례</b> · ") +
          (nb ? `지금 살 수 있는 카드 <b>${nb}장</b>` : "보석을 고르거나 카드를 누르세요");
      } else {
        const ck = selCheck(), after = tokSum(P.tok) + tokSum(sel);
        const gain = buyable(P, addTok(P.tok, sel)) - buyable(P, P.tok);
        hint.innerHTML = ck.msg + (gain > 0 ? ` · 가져오면 <b class="gm-gw">${gain}장</b> 더 살 수 있음` : "") +
          (after > 10 ? ` · <span class="gm-badt">${after - 10}개 반납</span>` : "");
      }
    } else {
      const who = M.pending && M.pending[0] ? M.pending[0].p : v.turn;
      const doing = v.sub === "discard" ? " — 보석 돌려놓는 중" : v.sub === "noble" ? " — 귀인 고르는 중" : "";
      hint.innerHTML = `<b>${esc(nameOf(who))}</b> 님 차례${doing}` + (v.final ? ' · <span class="gm-final">마지막 바퀴</span>' : ` · ${v.round}바퀴째`);
    }
    bar.appendChild(hint);
    if (picking) {
      const ck = selCheck();
      const cancel = el("button", "btn small", "취소");
      cancel.onclick = () => { sel = {}; ctx.sound.tick(); draw(); };
      const ok = el("button", "btn small primary", `가져오기 <span class="gm-pips">${pips(sel)}</span>`);
      ok.disabled = !ck.ok;
      ok.onclick = () => {
        if (!selCheck().ok) return;
        const a = { take: { ...sel } };
        if (ctx.send(a)) { sel = {}; draw(); }
      };
      bar.append(cancel, ok);
    }
    bar.className = "gm-bar" + (picking ? " picking" : "");

    // 내 상태 한 줄: 점수/목표 · 색별 보너스(네모)와 보석(동그라미) · 황금 · 찜 카드
    const box = R("me");
    box.innerHTML = "";
    const turnNow = v.phase === "play" && v.turn === me;
    const nt = tokSum(P.tok), left = v.goal - P.pts;
    const score = el("button", "gm-score" + (turnNow ? " turn" : ""),
      `<span><b>${P.pts}</b><small>/${v.goal}</small></span><i>${left > 0 ? `${left}점 남음` : "달성!"}</i><i class="${nt > 10 ? "over" : nt >= 9 ? "hi" : ""}">보석 ${nt}/10</i>`);
    score.setAttribute("aria-label", `내 점수 ${P.pts}점, 목표까지 ${Math.max(0, left)}점, 보석 ${nt}개 — 눌러서 내 정보 보기`);
    score.onclick = () => openPlayer(me);
    box.appendChild(score);
    const myDid = didHTML(me);
    if (myDid) box.appendChild(el("div", "gm-medid", `<small>나</small>${myDid}`));
    const cols = el("div", "gm-cols");
    const after = ask && ask.kind === "turn" && Object.keys(sel).length ? sel : {};
    for (const c of ALL) {
      const col = el("div", "gm-col" + (pulseMe[c] ? " pulse" : ""));
      col.innerHTML = (c === "y" ? `<i class="gm-bon gm-none">만능</i>` : `<i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i>`) +
        chipHTML(c, P.tok[c] + (after[c] || 0), "sm" + (P.tok[c] || after[c] ? "" : " zero") + (after[c] ? " plus" : ""));
      cols.appendChild(col);
    }
    box.appendChild(cols);
    const res = el("div", "gm-myres");
    const tokA = addTok(P.tok, after);
    for (let i = 0; i < 3; i++) {
      const C = P.res[i];
      if (!C) { res.appendChild(el("span", "gm-rslot")); continue; }
      const j = judge(P.bon, tokA, C), now = judge(P.bon, P.tok, C);
      const tag = now.ok ? '<span class="gm-mtag ok">✓</span>' : j.ok ? '<span class="gm-mtag will">✓</span>' : `<span class="gm-mtag no">−${j.miss}</span>`;
      const b = el("button", "gm-cbtn gm-rbtn", cardHTML(C, "mini" + (now.ok ? " can" : j.ok ? " will" : "") + (ask && ask.kind === "turn" ? "" : " idle")) + tag);
      b.setAttribute("aria-label", `찜한 ${C.t}단계 ${CNAME[C.c]} 카드, ${now.ok ? "살 수 있음" : `보석 ${j.miss}개 부족`}`);
      b.setAttribute("data-id", C.id);
      b.onclick = () => openCard(C.id);
      res.appendChild(b);
    }
    box.appendChild(res);
  }
  /* 버릴 보석 d 를 빼고 남은 보석으로, 카드마다 모자란 개수의 합 (가까운 카드일수록 무겁게) */
  function lackScore(P, d) {
    const tok = {};
    for (const c of ALL) tok[c] = P.tok[c] - (d[c] || 0);
    let v = 0;
    const add = C => { if (C && !C.hidden) { const m = judge(P.bon, tok, C).miss; v += Math.min(m, 6) * (m <= 2 ? 2 : 1); } };
    M.v.market.forEach(row => row.forEach(add));
    P.res.forEach(C => { add(C); add(C); });     // 내 찜 카드는 두 배로
    return v;
  }
  /* tok 으로 살 수 있는 카드 수 (펼쳐진 카드 + 내 찜) */
  function buyable(P, tok) {
    let k = 0;
    for (const row of M.v.market) for (const C of row) if (C && judge(P.bon, tok, C).ok) k++;
    for (const C of P.res) if (!C.hidden && judge(P.bon, tok, C).ok) k++;
    return k;
  }

  /* ---------------- 은행 보석 고르기 ---------------- */
  function selCheck() {
    const v = M.v, ks = Object.keys(sel);
    if (!ks.length) return { ok: false, msg: "가져올 보석을 누르세요" };
    if (ks.length === 1 && sel[ks[0]] === 2) return { ok: true, msg: `<b>${CNAME[ks[0]]} 2개</b>` };
    const avail = COLORS.filter(c => v.bank[c] > 0).length, need = Math.min(3, avail);
    if (ks.length < need) {
      const more = need - ks.length;
      return { ok: false, msg: `서로 다른 색 ${need}개 · <b>${more}개 더</b>` + (ks.length === 1 && v.bank[ks[0]] >= 4 ? " (같은 색 한 번 더 = 2개)" : "") };
    }
    return { ok: true, msg: `<b>${ks.map(c => CNAME[c]).join("·")}</b>` + (need < 3 ? ` (남은 색이 ${avail}가지)` : "") };
  }
  function tapToken(c) {
    if (!M || M.v.phase !== "play") return;
    if (!myTurn()) {
      const ask = ctx.myAsk();
      ctx.toast(ask ? "먼저 지금 할 일을 마치세요" : "내 차례에 가져올 수 있습니다");
      return;
    }
    const v = M.v;
    if (c === "y") { ctx.toast("황금은 카드를 찜할 때 1개씩 받습니다"); return; }
    const ks = Object.keys(sel), n = sel[c] || 0;
    if (n === 2) delete sel[c];
    else if (n === 1) {
      if (ks.length === 1 && v.bank[c] >= 4) sel[c] = 2;
      else {
        if (ks.length === 1) ctx.toast(`같은 색 2개는 4개 이상 남았을 때만 (${CNAME[c]} ${v.bank[c]}개)`);
        delete sel[c];
      }
    } else {
      if (v.bank[c] <= 0) { ctx.toast(`${CNAME[c]} 보석이 남아 있지 않습니다`); return; }
      if (ks.some(k => sel[k] === 2)) for (const k of ks) sel[k] = 1;   // 같은 색 2개 → 다른 색을 누르면 서로 다른 색 고르기로
      else if (ks.length >= 3) { ctx.toast("서로 다른 색은 3개까지입니다"); return; }
      sel[c] = 1;
    }
    ctx.sound.tick();
    draw();
  }

  /* ---------------- 아래에서 올라오는 창 ---------------- */
  function openSheet(fill) {
    closeSheet();
    const token = {};
    sheet = token;
    ctx.modal((box, close) => {
      box.classList.add("gm-sheet");
      if (box.parentElement) box.parentElement.classList.add("gm-scrim");
      const inner = el("div", "gm-sheet-in");
      box.appendChild(inner);
      token.close = close;
      token.fill = () => { if (!M) return; inner.innerHTML = ""; if (fill(inner, close) === false) close(); };
      token.fill();
    }).then(() => { if (sheet === token) sheet = null; });
  }
  function closeSheet() { const s = sheet; sheet = null; if (s && s.close) s.close(); }

  function locate(id) {
    const v = M.v;
    for (let ti = 0; ti < 3; ti++) for (const C of v.market[ti]) if (C && C.id === id) return { C, where: "market" };
    for (const C of v.players[M.me].res) if (!C.hidden && C.id === id) return { C, where: "res" };
    return null;
  }
  /* 버튼 + 그 아래 이유 한 줄 */
  function actBtn(label, primary, reason, enabled, on) {
    const w = el("div", "gm-bw");
    const b = el("button", "btn" + (primary ? " primary" : ""), label);
    b.disabled = !enabled;
    b.onclick = on;
    w.appendChild(b);
    if (reason) w.appendChild(el("small", enabled ? "" : "gm-bad", reason));
    return w;
  }

  function openCard(id) {
    openSheet((inner, close) => {
      const L = locate(id);
      if (!L) return false;
      const v = M.v, P = v.players[M.me], C = L.C, mine = L.where === "res";
      const ask = ctx.myAsk(), turn = !!(ask && ask.kind === "turn");
      const pay = payFor(P.tok, P.bon, C);
      // 색마다 비용 계산
      let rows = "", shortTot = 0, goldLeft = P.tok.y;
      const shortBy = {};
      for (const c of COLORS) {
        if (!C.cost[c]) continue;
        const need = Math.max(0, C.cost[c] - P.bon[c]), use = Math.min(need, P.tok[c]), short = need - use;
        const g = Math.min(short, goldLeft), lack = short - g;     // 황금은 있는 만큼만, 그래도 모자라면 빨간 숫자
        goldLeft -= g;
        shortTot += short; if (short) shortBy[c] = short;
        rows += `<div class="gm-payrow"><i class="gm-dot gm-${c}">${C.cost[c]}</i>` +
          `<span class="gm-calc">${P.bon[c] ? `보너스 −${Math.min(P.bon[c], C.cost[c])}` : "보너스 없음"} → <b>${need}</b></span>` +
          `<span class="gm-with">${use ? `${chipHTML(c, undefined, "xs")}×${use}` : ""}${g ? ` ${chipHTML("y", undefined, "xs")}×${g}` : ""}` +
          `${lack ? ` <span class="gm-lack">부족 ${lack}</span>` : ""}${!need ? "공짜" : ""}</span></div>`;
      }
      let sum;
      if (pay) {
        const total = tokSum(pay);
        sum = total ? `낼 보석 <b>${total}개</b> ${pips(pay)}${pay.y ? ` (황금 ${pay.y}개 포함)` : ""} — 은행으로 돌아갑니다` : "보너스만으로 <b>공짜</b>입니다!";
      } else {
        const miss = shortTot - P.tok.y;
        sum = `<span class="gm-bad">보석 <b>${miss}개</b>가 모자랍니다</span> — 부족: ${Object.keys(shortBy).map(c => `${CNAME[c]} ${shortBy[c]}`).join(" · ")}${P.tok.y ? ` (황금 ${P.tok.y}개를 써도)` : ""}`;
      }
      // 사면 찾아올 귀인
      const bon2 = { ...P.bon }; bon2[C.c]++;
      const nob = v.nobles.filter(N => !qualifies(P.bon, N) && qualifies(bon2, N));
      inner.innerHTML = `<div class="eyebrow">${C.t}단계 카드${mine ? " · 내가 찜한 카드" + (C.blind ? " (비공개)" : "") : ""}</div>
        <div class="gm-stop">${cardHTML(C, "lg")}
          <div class="gm-stxt"><h2>${gemHTML(C.c)} ${CNAME[C.c]} 카드${C.pt ? ` · ${C.pt}점` : ""}</h2>
          <p>사면 <b>${CNAME[C.c]} 보너스 +1</b> — 앞으로 ${CNAME[C.c]} 비용이 늘 1 줄어듭니다.${C.pt ? "" : " 점수는 없습니다."}</p>
          ${nob.length ? `<p class="gm-good">👑 사면 귀인 ‘${esc(nob[0].name)}’이(가) 찾아옵니다 (+3점)</p>` : ""}</div></div>
        <div class="gm-pay">${rows}</div><div class="gm-paysum">${sum}</div>`;
      const btns = el("div", "gm-sbtns");
      if (!mine) {
        const resFull = P.res.length >= 3;
        const after = tokSum(P.tok) + (v.bank.y > 0 ? 1 : 0);
        const why = !turn ? "내 차례에만 할 수 있습니다" : resFull ? "찜은 3장까지입니다"
          : (v.bank.y > 0 ? "황금 1개를 받습니다" : "황금이 없어 카드만 찜합니다") + (after > 10 ? ` · 보석 ${after - 10}개 돌려놓기` : "");
        btns.appendChild(actBtn("찜하기", false, why, turn && !resFull, () => { if (ctx.send({ reserve: C.id })) close(); }));
      }
      const whyBuy = !turn ? "내 차례에만 할 수 있습니다" : pay ? (C.pt ? `+${C.pt}점` : "보너스 +1") : "보석이 모자랍니다";
      btns.appendChild(actBtn("사기", true, whyBuy, turn && !!pay, () => { if (ctx.send({ buy: C.id })) close(); }));
      inner.appendChild(btns);
    });
  }

  function openDeck(t) {
    openSheet((inner, close) => {
      const v = M.v, P = v.players[M.me], n = v.decks[t - 1];
      const ask = ctx.myAsk(), turn = !!(ask && ask.kind === "turn");
      inner.innerHTML = `<div class="eyebrow">${t}단계 더미</div>
        <div class="gm-stop"><div class="gm-deck big t${t}${n ? "" : " empty"}"><b>${ROMAN[t]}</b><small>${n}장</small></div>
        <div class="gm-stxt"><h2>맨 위 카드를 몰래 찜하기</h2>
        <p>남은 카드 <b>${n}장</b>. 무슨 카드인지는 찜한 뒤에 <b>나만</b> 볼 수 있고, 다른 사람에게는 ‘${t}단계 비공개 카드’로 보입니다.</p></div></div>`;
      const btns = el("div", "gm-sbtns");
      const after = tokSum(P.tok) + (v.bank.y > 0 ? 1 : 0);
      const why = !turn ? "내 차례에만 할 수 있습니다" : !n ? "더미가 비었습니다" : P.res.length >= 3 ? "찜은 3장까지입니다"
        : (v.bank.y > 0 ? "황금 1개를 받습니다" : "황금이 없어 카드만 찜합니다") + (after > 10 ? ` · 보석 ${after - 10}개 돌려놓기` : "");
      btns.appendChild(actBtn("몰래 찜하기", true, why, turn && n > 0 && P.res.length < 3, () => { if (ctx.send({ reserveDeck: t })) close(); }));
      inner.appendChild(btns);
    });
  }

  function openPlayer(q) {
    openSheet(inner => {
      const v = M.v, P = v.players[q], pl = M.players[q] || { name: "?" };
      const bons = COLORS.map(c => `<span class="gm-pcol"><i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i><small>${CNAME[c]}</small></span>`).join("");
      const toks = ALL.map(c => `<span class="gm-pcol">${chipHTML(c, P.tok[c], "sm" + (P.tok[c] ? "" : " zero"))}<small>${CNAME[c]}</small></span>`).join("");
      const res = P.res.length ? P.res.map(C => `<div class="gm-rescell">${cardHTML(C)}${C.hidden ? `<small>${C.t}단계 비공개 카드</small>` : ""}</div>`).join("") : '<span class="gm-none-t">없음</span>';
      inner.innerHTML = `<div class="eyebrow">${q === M.me ? "나" : q === v.start ? "첫 차례" : "상대"}${q === v.turn && v.phase === "play" ? " · 지금 차례" : ""}</div>
        <div class="gm-phead">${avatarHTML(pl.name, q, "lg")}<h2>${esc(pl.name)} <span class="gm-big">${P.pts}점</span></h2></div>
        <p>카드 <b>${P.ncards}장</b> · 보석 <b>${tokSum(P.tok)}/10</b>${P.nobles.length ? ` · 귀인 ${P.nobles.map(N => "👑 " + esc(N.name)).join(", ")}` : ""}</p>
        <div class="gm-sec">보너스 (가진 카드)</div><div class="gm-prow">${bons}</div>
        <div class="gm-sec">보석</div><div class="gm-prow">${toks}</div>
        <div class="gm-sec">찜한 카드 ${P.res.length}/3</div><div class="gm-prow gm-resrow">${res}</div>`;
    });
  }

  function openNoble(id) {
    openSheet(inner => {
      const v = M.v, N = v.nobles.find(x => x.id === id);
      if (!N) return false;
      const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}">${N.req[c]}</i>`).join("");
      const rows = v.players.map((P, q) => {
        const rem = COLORS.reduce((a, c) => a + Math.max(0, N.req[c] - P.bon[c]), 0);
        return `<div class="gm-nrow">${avatarHTML(nameOf(q), q, "sm")}<span>${q === M.me ? "나" : esc(nameOf(q))}</span>` +
          `<span class="gm-nprog">${COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}${P.bon[c] >= N.req[c] ? " ok" : " zero"}">${Math.min(P.bon[c], N.req[c])}</i>`).join("")}</span>` +
          `<small>${rem ? `${rem}장 남음` : "조건 충족"}</small></div>`;
      }).join("");
      inner.innerHTML = `<div class="eyebrow">귀인 · 3점</div>
        <div class="gm-stop"><div class="gm-noble big"><b>3</b><span class="gm-req">${reqs}</span></div>
        <div class="gm-stxt"><h2>👑 ${esc(N.name)}</h2><p>이 색의 <b>카드 보너스</b>가 조건만큼 모이면 차례 끝에 찾아와 3점을 줍니다 (보석 토큰은 세지 않습니다).</p></div></div>
        <div class="gm-sec">모두의 진행</div>${rows}`;
    });
  }

  /* ---------------- 버리기 · 귀인 고르기 (내가 해야 할 때 자동으로 열림) ---------------- */
  function syncSub() {
    const ask = ctx.myAsk();
    const want = ask && (ask.kind === "discard" || ask.kind === "noble") ? ask : null;
    if (sub && (!want || sub.id !== want.id)) { const s = sub; sub = null; s.close(); }
    if (want && !sub) { closeSheet(); want.kind === "discard" ? openDiscard(want) : openNobleChoice(want); }
  }
  function openDiscard(ask) {
    const token = { id: ask.id };
    sub = token;
    ctx.modal((box, close) => {
      token.close = close;
      box.classList.add("gm-dmodal");
      const P = M.v.players[M.me], total = tokSum(P.tok), need = total - 10;
      const d = {};
      for (const c of ALL) d[c] = 0;
      ctx.head(box, "보석 10개 초과", `보석 ${need}개를 돌려놓으세요`, `지금 ${total}개 — 10개까지만 가질 수 있습니다.`);
      const list = el("div", "gm-disc");
      box.appendChild(list);
      const left = el("div", "gm-dleft");
      box.appendChild(left);
      const btnRow = ctx.buttonRow(box, [
        { label: "추천대로", on: () => {
          // 펼쳐진 카드 · 내 찜 카드에 덜 필요한 보석부터 (모자란 개수 합이 가장 적게 늘도록, 같으면 많은 색부터 · 황금은 마지막)
          for (const c of ALL) d[c] = 0;
          for (let i = 0; i < need; i++) {
            let best = null, bv = Infinity;
            for (const c of ALL) {
              if (P.tok[c] - d[c] <= 0) continue;
              d[c]++;
              const v = lackScore(P, d) + (c === "y" ? 0.5 : 0) - (P.tok[c] - d[c]) * 0.01;
              d[c]--;
              if (v < bv) { bv = v; best = c; }
            }
            d[best]++;
          }
          ctx.sound.tick(); draw2();
        } },
        { label: "돌려놓기", primary: true, on: () => {
          if (tokSum(d) !== need) return;
          ctx.send({ discard: { ...d } });
          close();
        } }
      ]);
      const okBtn = btnRow.lastChild;
      function draw2() {
        list.innerHTML = "";
        for (const c of ALL) {
          if (!P.tok[c]) continue;
          const r = el("div", "gm-drow");
          r.innerHTML = `${chipHTML(c, P.tok[c] - d[c], "sm")}<span class="gm-dname">${CNAME[c]}<small>${P.tok[c]}개 중</small></span>`;
          const minus = el("button", "gm-step", "−"), plus = el("button", "gm-step", "+");
          minus.disabled = !d[c];
          plus.disabled = d[c] >= P.tok[c] || tokSum(d) >= need;
          minus.onclick = () => { d[c]--; ctx.sound.tick(); draw2(); };
          plus.onclick = () => { d[c]++; ctx.sound.tick(); draw2(); };
          r.append(minus, el("b", "gm-dn", String(d[c])), plus);
          list.appendChild(r);
        }
        const s = tokSum(d);
        const keep = {};
        for (const c of ALL) keep[c] = P.tok[c] - d[c];
        const nb = buyable(P, keep), nb0 = buyable(P, P.tok);
        left.innerHTML = (s === need ? `<b>${need}개</b> 다 골랐습니다 ${pips(d)}` : `<b>${need - s}개</b> 더 고르세요 ${pips(d)}`) +
          `<br><small>이대로면 살 수 있는 카드 <b>${nb}장</b>${nb < nb0 ? ` <span class="gm-badt">(지금보다 ${nb0 - nb}장 줄어듦)</span>` : ""}</small>`;
        okBtn.disabled = s !== need;
      }
      draw2();
    }, { dismissible: false }).then(() => { if (sub === token) sub = null; });
  }
  function openNobleChoice(ask) {
    const token = { id: ask.id };
    sub = token;
    ctx.modal((box, close) => {
      token.close = close;
      const v = M.v, P = v.players[M.me];
      const q = v.nobles.filter(N => qualifies(P.bon, N));
      ctx.head(box, "귀인 방문", "어느 귀인을 모실까요?", "조건을 채운 귀인이 여럿입니다. 이번 차례에는 한 명만 모실 수 있고, 나머지는 다음 기회에.");
      const list = el("div", "choices");
      for (const N of q) {
        const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}">${N.req[c]}</i>`).join("");
        const b = el("button", "choice gm-nchoice", `<b>👑 ${esc(N.name)} · 3점</b><span class="gm-req">${reqs}</span>`);
        b.onclick = () => { ctx.send({ noble: N.id }); close(); };
        list.appendChild(b);
      }
      box.appendChild(list);
    }, { dismissible: false }).then(() => { if (sub === token) sub = null; });
  }

  return {
    update,
    ticker: false,     // 방금 일어난 일은 이름표 옆 배지로 보여 준다 — 위쪽 한 줄 기록은 숨기고 그 높이를 판에 쓴다
    destroy() {
      if (ro) ro.disconnect(); else window.removeEventListener("resize", fit);
      closeSheet(); if (sub) { const s = sub; sub = null; s.close(); } root.innerHTML = "";
    }
  };
}
