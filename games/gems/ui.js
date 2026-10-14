/* Gem Merchant screen
   Top (board): opponent rows (score · bonuses/gems per colour · reserves · last action) · nobles (how many cards I and each
   opponent still need) · 3 card rows · bank gems
   Bottom (dock): hint (Cancel / Take while picking gems) · my status line (score · bonuses/gems per colour · gold · reserved cards)
   The screen does the math — each card shows "Can buy" or the shortfall per colour plus "Need N"; while gems are being
   picked it previews the state after taking them. Card size is set from the measured free height (one screen, no scrolling). */
import { COLORS, ALL, CNAME, payFor } from "./engine.js";
import { L, loc } from "../../core/i18n.js";

const ROMAN = ["", "Ⅰ", "Ⅱ", "Ⅲ"];
const gname = c => loc(CNAME[c]);
/* English plural: pl(2, "gem") → "2 gems" */
const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const tokSum = t => ALL.reduce((a, c) => a + (t[c] || 0), 0);
const qualifies = (bon, N) => COLORS.every(c => (bon[c] || 0) >= N.req[c]);
const nobleRem = (bon, N) => COLORS.reduce((a, c) => a + Math.max(0, N.req[c] - (bon[c] || 0)), 0);
const addTok = (a, b) => { const o = {}; for (const c of ALL) o[c] = (a[c] || 0) + (b[c] || 0); return o; };

/* Evaluate one card against my bonuses and gems (tok)
   short: missing per colour (before gold), free: colours fully covered by bonuses, miss: still missing after gold */
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
/* The noble that would newly visit if this colour's bonus went up by one */
function nobleBy(nobles, bon, c) {
  const b2 = { ...bon }; b2[c] = (b2[c] || 0) + 1;
  return nobles.find(N => !qualifies(bon, N) && qualifies(b2, N)) || null;
}

/* One card (a card object from the view, or {t, hidden})
   info: { j: judge result, marks: show per-colour shortfall, tag: centre badge HTML, flags: small top-centre marks HTML } */
function cardHTML(C, extra = "", info = null) {
  if (!C) return `<div class="gm-card gm-none ${extra}"></div>`;
  if (C.hidden) return `<div class="gm-card gm-back t${C.t} ${extra}"><b>${ROMAN[C.t]}</b><small>${L("비공개", "Hidden")}</small></div>`;
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
    (C.blind ? `<span class="gm-blind">${L("비공개", "Hidden")}</span>` : "") + `</div>`;
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
  let sel = {}, selAsk = 0;          // gems picked from the bank (tied to that turn's ask id)
  let sheet = null;                  // open bottom sheet {close, fill}
  let sub = null;                    // open discard / noble dialog {id, close}
  let pulse = {}, pulseMe = {}, pop = new Set();   // motion for this message only (bank · my gems · new cards)

  const nameOf = p => (M && M.players[p] ? M.players[p].name : "?");
  const nobleName = N => esc(loc(N.name));
  const myTurn = () => !!ctx.myAsk("turn");

  /* ---------------- Sizing: measure the screen height once per change ----------------
     Board height = screen − bottom dock. Opponent rows, nobles and bank start at base size; cards get the remaining height.
     If the cards are capped by the width, spare height goes to opponent rows, nobles, bank and card height (no empty band). */
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
    let oh = 40, nh = 50, tks = 36;            // opponent rows are tap targets too, so at least 40px
    const dw = Math.round(Math.max(26, Math.min(34, W * 0.085)));
    const cwMax = Math.min((W - dw - 4 * gap) / 4, 110);
    const rowsFor = ch => 3 * ch + 2 * gap;
    const fixed = () => nOpp * oh + (nOpp - 1) * 3 + nh + tks + 8;
    let avail = inner - fixed(), ch, cw = cwMax;
    if (avail >= rowsFor(cwMax * 1.42)) {
      // cards are capped by the width — share out the spare height
      let spare = avail - rowsFor(cwMax * 1.42);
      const dOh = Math.min(14, spare * 0.3 / nOpp); oh += dOh; spare -= dOh * nOpp;
      const dNh = Math.min(26, spare * 0.4); nh += dNh; spare -= dNh;
      const dTk = Math.min(10, spare * 0.3); tks += dTk; spare -= dTk;
      avail = inner - fixed();
      ch = Math.min((avail - 2 * gap) / 3, cwMax * 1.7);
      vgap = Math.max(gap, Math.min(10, (avail - 3 * ch) / 4));   // anything left widens the row gaps a little
    } else {
      ch = Math.max(40, (avail - 2 * gap) / 3);
      if (ch < cw * 0.98) cw = ch / 0.98;          // too flat: narrow the cards
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

  /* ---------------- Drawing ---------------- */
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

  /* Does q get another turn this game (in the final round, only up to the starting seat) */
  function hasTurnLeft(q) {
    const v = M.v, n = v.players.length;
    if (v.phase !== "play") return false;
    if (!v.final) return true;
    const pos = x => (x - v.start + n) % n;
    return pos(q) >= pos(v.turn);
  }
  /* Opponents who could reach the target next turn → {q: [card ids…]} (face-up and public reserved cards, noble 3 pts included) */
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

  /* Opponents: in turn order starting after me. Everything important is visible without tapping */
  function drawSeats(T) {
    const v = M.v, box = R("seats");
    box.innerHTML = "";
    const n = v.players.length;
    box.className = "gm-opps n" + (n - 1);
    for (let k = 1; k < n; k++) {
      const q = (M.me + k) % n, P = v.players[q], pl0 = M.players[q] || { name: "?" };
      const turn = q === v.turn && v.phase === "play", thr = T[q];
      const nt = tokSum(P.tok), left = v.goal - P.pts;
      const row = el("button", "gm-opp" + (turn ? " turn" : "") + (thr ? " threat" : ""));
      const cells = COLORS.map(c => `<span class="gm-oc"><i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i>` +
        `<i class="gm-tk gm-${c}${P.tok[c] ? "" : " zero"}">${P.tok[c]}</i></span>`).join("") +
        `<span class="gm-oc"><i class="gm-bon gm-blank"></i><i class="gm-tk gm-y${P.tok.y ? "" : " zero"}">${P.tok.y}</i></span>`;
      const gemsB = `<b class="${nt >= 9 ? "hi" : ""}">${nt}</b>`;
      const l2 = thr ? `<span class="gm-warn">⚠ ${L(`다음 차례 ${v.goal}점 가능`, `Can hit ${v.goal} next turn`)}</span>`
        : left <= 0 ? `<span class="gm-good">${L(`${v.goal}점 달성`, `Reached ${v.goal}`)}</span>`
        : L(`${v.goal}까지 <b>${left}</b> · 보석 ${gemsB}`, `<b>${left}</b> to ${v.goal} · gems ${gemsB}`) + (P.nobles.length ? ` · 👑${P.nobles.length}` : "");
      row.innerHTML = `<span class="gm-oav">${avatarHTML(pl0.name, q, "sm")}` +
          (pl0.kind === "ai" ? '<span class="gm-tag">AI</span>' : pl0.kind === "away" ? `<span class="gm-tag away">${L("비움", "Away")}</span>` : "") +
          (q === v.start ? `<i class="gm-first" title="${L("첫 차례", "First player")}">${L("선", "1st")}</i>` : "") + `</span>` +
        `<b class="gm-opt">${P.pts}</b>` +
        `<span class="gm-onm"><span class="gm-l1"><span class="nm">${esc(pl0.name)}</span>${didHTML(q)}</span><span class="gm-l2">${l2}</span></span>` +
        `<span class="gm-ocols">${cells}</span>` +
        `<span class="gm-ores${P.res.length ? "" : " zero"}"><small>${L("찜", "Res")}</small><b>${P.res.length}</b></span>`;
      row.setAttribute("aria-label", L(`${pl0.name} ${P.pts}점, 카드 ${P.ncards}장, 보석 ${nt}개, 찜 ${P.res.length}장${thr ? ", 다음 차례에 승리 점수 가능" : ""}`,
        `${pl0.name}: ${P.pts} points, ${pl(P.ncards, "card")}, ${pl(nt, "gem")}, ${P.res.length} reserved${thr ? ", can reach the target next turn" : ""}`));
      row.onclick = () => openPlayer(q);
      box.appendChild(row);
    }
  }
  /* Small badge next to the name of whoever just acted */
  function didHTML(q) {
    const last = M.v.last;
    if (!last || last.p !== q || M.v.phase !== "play") return "";
    let t = "";
    const goldPip = last.gold ? '<i class="gm-pip gm-y"></i>' : "";
    if (last.type === "take") t = pips(last.take);
    else if (last.type === "buy") t = `${last.cv ? gemHTML(last.cv.c, "sm") : ""}${L("구매", "Buy")}${last.cv && last.cv.pt ? ` <b>+${last.cv.pt}</b>` : ""}`;
    else if (last.type === "reserve") t = `${last.cv ? gemHTML(last.cv.c, "sm") : ""}${L("찜", "Res")}${goldPip}`;
    else if (last.type === "reserveDeck") t = `${ROMAN[last.tier]} ${L("몰래 찜", "Blind res")}${goldPip}`;
    else if (last.type === "pass") t = L("넘김", "Pass");
    if (last.discard) t += ` <span class="gm-dsc">−${tokSum(last.discard)}</span>`;
    if (last.noble !== undefined) t += " 👑";
    return t ? `<span class="gm-did">${t}</span>` : "";
  }

  /* Nobles: how many bonuses I still need, and how many each opponent needs */
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
      const mine = rem === 0 ? L("조건 충족", "Ready") : L(`${rem}장 남음`, `${rem} to go`);
      const b = el("button", "gm-noble" + (rem <= 2 || (rem === best && rem <= 4) ? " near" : "") + (rem === best ? " best" : ""),
        `<span class="gm-nt"><b>3</b><span class="gm-req">${reqs}</span></span><span class="gm-nme">${mine}</span><span class="gm-nop">${opp}</span>`);
      b.setAttribute("aria-label", L(`귀인 ${loc(N.name)}, 나는 ${mine}`, `Noble ${loc(N.name)}, me: ${mine}`));
      b.onclick = () => openNoble(N.id);
      box.appendChild(b);
    });
  }

  /* Card rows: each card shows whether I can buy it and the shortfall per colour; while picking gems, as if taken */
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
      deck.setAttribute("aria-label", L(`${t}단계 더미 ${v.decks[ti]}장`, `Tier ${t} deck, ${pl(v.decks[ti], "card")}`));
      deck.setAttribute("data-tier", t);
      deck.onclick = () => openDeck(t);
      row.appendChild(deck);
      for (const C of v.market[ti]) {
        if (!C) { row.appendChild(el("div", "gm-card gm-none")); continue; }
        const info = cardInfo(C, P, tokNow, tokAfter, picking, thrBy[C.id]);
        const cls = info.cls + (v.fresh.includes(C.id) ? " fresh" : "") + (pop.has(C.id) ? " pop" : "") + (mine || v.phase !== "play" ? "" : " idle");
        const b = el("button", "gm-cbtn", cardHTML(C, cls, info));
        b.setAttribute("aria-label", L(`${t}단계 ${gname(C.c)} 카드 ${C.pt}점, ${info.say}`, `Tier ${t} ${gname(C.c)} card, ${C.pt} pts, ${info.say}`));
        b.setAttribute("data-id", C.id);
        b.onclick = () => openCard(C.id);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }
  /* Display info for one card (badge · top marks · classes · spoken text) */
  function cardInfo(C, P, tokNow, tokAfter, picking, thr) {
    const v = M.v;
    const now = judge(P.bon, tokNow, C);
    const j = picking ? judge(P.bon, tokAfter, C) : now;
    const nob = nobleBy(v.nobles, P.bon, C.c);
    const win = v.phase === "play" && P.pts < v.goal && P.pts + C.pt + (nob ? 3 : 0) >= v.goal;
    let tag, cls, say;
    if (v.phase !== "play") return { j, tag: "", flags: "", cls: "", say: "", marks: false };
    if (now.ok) {
      tag = `<span class="gm-tag2 ok">${win ? L(`사면 ${v.goal}점!`, `Wins with ${v.goal}!`) : L("살 수 있음", "Can buy")}</span>`;
      cls = "can" + (win ? " win" : ""); say = L("살 수 있음", "can buy");
    } else if (picking && j.ok) {
      tag = `<span class="gm-tag2 will">${L("가져오면 ✓", "If taken ✓")}</span>`; cls = "will";
      say = L("고른 보석을 가져오면 살 수 있음", "buyable after taking the picked gems");
    } else {
      tag = `<span class="gm-tag2 no">${L(`부족 ${j.miss}`, `Need ${j.miss}`)}</span>`; cls = "cant";
      say = L(`보석 ${j.miss}개 부족`, `${pl(j.miss, "gem")} short`);
    }
    let flags = "";
    if (nob) flags += `<i class="gm-fl nob" title="${L("사면 귀인", "Brings a noble")}">👑</i>`;
    if (thr) for (const q of thr) flags += `<i class="gm-fl thr" title="${esc(L(`${nameOf(q)} 님이 사면 승리 점수`, `${nameOf(q)} reaches the target by buying this`))}">⚠${esc([...nameOf(q)][0] || "?")}</i>`;
    // per-colour shortfall only on nearly affordable cards (3 or fewer short) — marking far cards too is harder to read
    return { j, tag, flags, cls: cls + (!j.ok && j.miss > 3 ? " far" : ""), say, marks: !j.ok && j.miss <= 3 };
  }

  function drawBank() {
    const v = M.v, box = R("bank"), mine = myTurn();
    box.innerHTML = "";
    for (const c of ALL) {
      const s = sel[c] || 0, left = v.bank[c] - s;
      const b = el("button", `gm-tok gm-${c}` + (s ? " sel" : "") + (left <= 0 ? " empty" : "") + (pulse[c] ? " pulse" : "") + (mine && c !== "y" ? " live" : ""),
        `${chipHTML(c)}<b class="gm-n">${left}</b>${s ? `<em>+${s}</em>` : ""}`);
      b.setAttribute("aria-label", L(`${gname(c)} ${v.bank[c]}개${s ? `, ${s}개 고름` : ""}`, `${gname(c)}: ${v.bank[c]} left${s ? `, ${s} picked` : ""}`));
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
    if (v.phase === "over") hint.innerHTML = L("게임 끝", "Game over");
    else if (ask && ask.kind === "discard") hint.innerHTML = L(`<b>보석이 10개를 넘었습니다</b> — 돌려놓을 보석을 고르세요`, `<b>Over 10 gems</b> — choose gems to return`);
    else if (ask && ask.kind === "noble") hint.innerHTML = L(`<b>귀인 여럿이 찾아왔습니다</b> — 한 명을 고르세요`, `<b>Several nobles qualify</b> — choose one`);
    else if (ask) {
      if (!picking) {
        const nb = buyable(P, P.tok);
        hint.innerHTML = (v.final ? L("<b>마지막 차례!</b> ", "<b>Last turn!</b> ") : L("<b>내 차례</b> · ", "<b>Your turn</b> · ")) +
          (nb ? L(`지금 살 수 있는 카드 <b>${nb}장</b>`, `you can buy <b>${pl(nb, "card")}</b>`) : L("보석을 고르거나 카드를 누르세요", "pick gems or tap a card"));
      } else {
        const ck = selCheck(), after = tokSum(P.tok) + tokSum(sel);
        const gain = buyable(P, addTok(P.tok, sel)) - buyable(P, P.tok);
        hint.innerHTML = ck.msg + (gain > 0 ? L(` · 가져오면 <b class="gm-gw">${gain}장</b> 더 살 수 있음`, ` · then <b class="gm-gw">${gain} more</b> buyable`) : "") +
          (after > 10 ? ` · <span class="gm-badt">${L(`${after - 10}개 반납`, `return ${after - 10}`)}</span>` : "");
      }
    } else {
      const who = M.pending && M.pending[0] ? M.pending[0].p : v.turn;
      const doing = v.sub === "discard" ? L(" — 보석 돌려놓는 중", " — returning gems") : v.sub === "noble" ? L(" — 귀인 고르는 중", " — choosing a noble") : "";
      hint.innerHTML = L(`<b>${esc(nameOf(who))}</b> 님 차례`, `<b>${esc(nameOf(who))}</b>'s turn`) + doing +
        (v.final ? ` · <span class="gm-final">${L("마지막 바퀴", "Final round")}</span>` : L(` · ${v.round}바퀴째`, ` · round ${v.round}`));
    }
    bar.appendChild(hint);
    if (picking) {
      const ck = selCheck();
      const cancel = el("button", "btn small", L("취소", "Cancel"));
      cancel.onclick = () => { sel = {}; ctx.sound.tick(); draw(); };
      const ok = el("button", "btn small primary", `${L("가져오기", "Take")} <span class="gm-pips">${pips(sel)}</span>`);
      ok.disabled = !ck.ok;
      ok.onclick = () => {
        if (!selCheck().ok) return;
        const a = { take: { ...sel } };
        if (ctx.send(a)) { sel = {}; draw(); }
      };
      bar.append(cancel, ok);
    }
    bar.className = "gm-bar" + (picking ? " picking" : "");

    // My status line: score/target · bonuses (squares) and gems (circles) per colour · gold · reserved cards
    const box = R("me");
    box.innerHTML = "";
    const turnNow = v.phase === "play" && v.turn === me;
    const nt = tokSum(P.tok), left = v.goal - P.pts;
    const score = el("button", "gm-score" + (turnNow ? " turn" : ""),
      `<span><b>${P.pts}</b><small>/${v.goal}</small></span><i>${left > 0 ? L(`${left}점 남음`, `${left} to go`) : L("달성!", "Reached!")}</i>` +
      `<i class="${nt > 10 ? "over" : nt >= 9 ? "hi" : ""}">${L("보석", "Gems")} ${nt}/10</i>`);
    score.setAttribute("aria-label", L(`내 점수 ${P.pts}점, 목표까지 ${Math.max(0, left)}점, 보석 ${nt}개 — 눌러서 내 정보 보기`,
      `My score ${P.pts}, ${Math.max(0, left)} to the target, ${pl(nt, "gem")} — tap for my details`));
    score.onclick = () => openPlayer(me);
    box.appendChild(score);
    const myDid = didHTML(me);
    if (myDid) box.appendChild(el("div", "gm-medid", `<small>${L("나", "Me")}</small>${myDid}`));
    const cols = el("div", "gm-cols");
    const after = ask && ask.kind === "turn" && Object.keys(sel).length ? sel : {};
    for (const c of ALL) {
      const col = el("div", "gm-col" + (pulseMe[c] ? " pulse" : ""));
      col.innerHTML = (c === "y" ? `<i class="gm-bon gm-none">${L("만능", "Wild")}</i>` : `<i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i>`) +
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
      b.setAttribute("aria-label", L(`찜한 ${C.t}단계 ${gname(C.c)} 카드, ${now.ok ? "살 수 있음" : `보석 ${j.miss}개 부족`}`,
        `Reserved tier ${C.t} ${gname(C.c)} card, ${now.ok ? "can buy" : `${pl(j.miss, "gem")} short`}`));
      b.setAttribute("data-id", C.id);
      b.onclick = () => openCard(C.id);
      res.appendChild(b);
    }
    box.appendChild(res);
  }
  /* With gems d discarded, the sum of shortfalls over all cards (nearer cards weigh more) */
  function lackScore(P, d) {
    const tok = {};
    for (const c of ALL) tok[c] = P.tok[c] - (d[c] || 0);
    let v = 0;
    const add = C => { if (C && !C.hidden) { const m = judge(P.bon, tok, C).miss; v += Math.min(m, 6) * (m <= 2 ? 2 : 1); } };
    M.v.market.forEach(row => row.forEach(add));
    P.res.forEach(C => { add(C); add(C); });     // my reserved cards count double
    return v;
  }
  /* Number of cards affordable with tok (face-up + my reserves) */
  function buyable(P, tok) {
    let k = 0;
    for (const row of M.v.market) for (const C of row) if (C && judge(P.bon, tok, C).ok) k++;
    for (const C of P.res) if (!C.hidden && judge(P.bon, tok, C).ok) k++;
    return k;
  }

  /* ---------------- Picking gems from the bank ---------------- */
  function selCheck() {
    const v = M.v, ks = Object.keys(sel);
    if (!ks.length) return { ok: false, msg: L("가져올 보석을 누르세요", "Tap gems to take") };
    if (ks.length === 1 && sel[ks[0]] === 2) return { ok: true, msg: L(`<b>${gname(ks[0])} 2개</b>`, `<b>2 ${gname(ks[0])}</b>`) };
    const avail = COLORS.filter(c => v.bank[c] > 0).length, need = Math.min(3, avail);
    if (ks.length < need) {
      const more = need - ks.length;
      return { ok: false, msg: L(`서로 다른 색 ${need}개 · <b>${more}개 더</b>`, `${need} different colours · <b>${more} more</b>`) +
        (ks.length === 1 && v.bank[ks[0]] >= 4 ? L(" (같은 색 한 번 더 = 2개)", " (tap again for 2)") : "") };
    }
    return { ok: true, msg: `<b>${ks.map(gname).join("·")}</b>` + (need < 3 ? L(` (남은 색이 ${avail}가지)`, ` (only ${pl(avail, "colour")} left)`) : "") };
  }
  function tapToken(c) {
    if (!M || M.v.phase !== "play") return;
    if (!myTurn()) {
      const ask = ctx.myAsk();
      ctx.toast(ask ? L("먼저 지금 할 일을 마치세요", "Finish your current step first") : L("내 차례에 가져올 수 있습니다", "You can take gems on your turn"));
      return;
    }
    const v = M.v;
    if (c === "y") { ctx.toast(L("황금은 카드를 찜할 때 1개씩 받습니다", "You get 1 Gold when you reserve a card")); return; }
    const ks = Object.keys(sel), n = sel[c] || 0;
    if (n === 2) delete sel[c];
    else if (n === 1) {
      if (ks.length === 1 && v.bank[c] >= 4) sel[c] = 2;
      else {
        if (ks.length === 1) ctx.toast(L(`같은 색 2개는 4개 이상 남았을 때만 (${gname(c)} ${v.bank[c]}개)`, `2 of a colour only when 4+ are left (${gname(c)}: ${v.bank[c]})`));
        delete sel[c];
      }
    } else {
      if (v.bank[c] <= 0) { ctx.toast(L(`${gname(c)} 보석이 남아 있지 않습니다`, `No ${gname(c)} gems left`)); return; }
      if (ks.some(k => sel[k] === 2)) for (const k of ks) sel[k] = 1;   // 2 of one colour → tapping another switches to different colours
      else if (ks.length >= 3) { ctx.toast(L("서로 다른 색은 3개까지입니다", "Up to 3 different colours")); return; }
      sel[c] = 1;
    }
    ctx.sound.tick();
    draw();
  }

  /* ---------------- Bottom sheets ---------------- */
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
  /* A button plus a one-line reason below it */
  function actBtn(label, primary, reason, enabled, on) {
    const w = el("div", "gm-bw");
    const b = el("button", "btn" + (primary ? " primary" : ""), label);
    b.disabled = !enabled;
    b.onclick = on;
    w.appendChild(b);
    if (reason) w.appendChild(el("small", enabled ? "" : "gm-bad", reason));
    return w;
  }
  const notTurn = () => L("내 차례에만 할 수 있습니다", "Only on your turn");
  const resFullT = () => L("찜은 3장까지입니다", "You can reserve at most 3");
  /* Reason line under a reserve button when it is allowed */
  function reserveWhy(v, P) {
    const after = tokSum(P.tok) + (v.bank.y > 0 ? 1 : 0);
    return (v.bank.y > 0 ? L("황금 1개를 받습니다", "You get 1 Gold") : L("황금이 없어 카드만 찜합니다", "No Gold left — card only")) +
      (after > 10 ? L(` · 보석 ${after - 10}개 돌려놓기`, ` · return ${pl(after - 10, "gem")}`) : "");
  }

  function openCard(id) {
    openSheet((inner, close) => {
      const found = locate(id);
      if (!found) return false;
      const v = M.v, P = v.players[M.me], C = found.C, mine = found.where === "res";
      const ask = ctx.myAsk(), turn = !!(ask && ask.kind === "turn");
      const pay = payFor(P.tok, P.bon, C);
      const cn = gname(C.c);
      // cost breakdown per colour
      let rows = "", shortTot = 0, goldLeft = P.tok.y;
      const shortBy = {};
      for (const c of COLORS) {
        if (!C.cost[c]) continue;
        const need = Math.max(0, C.cost[c] - P.bon[c]), use = Math.min(need, P.tok[c]), short = need - use;
        const g = Math.min(short, goldLeft), lack = short - g;     // gold only as far as it goes; anything still missing is red
        goldLeft -= g;
        shortTot += short; if (short) shortBy[c] = short;
        rows += `<div class="gm-payrow"><i class="gm-dot gm-${c}">${C.cost[c]}</i>` +
          `<span class="gm-calc">${P.bon[c] ? L(`보너스 −${Math.min(P.bon[c], C.cost[c])}`, `bonus −${Math.min(P.bon[c], C.cost[c])}`) : L("보너스 없음", "no bonus")} → <b>${need}</b></span>` +
          `<span class="gm-with">${use ? `${chipHTML(c, undefined, "xs")}×${use}` : ""}${g ? ` ${chipHTML("y", undefined, "xs")}×${g}` : ""}` +
          `${lack ? ` <span class="gm-lack">${L(`부족 ${lack}`, `need ${lack}`)}</span>` : ""}${!need ? L("공짜", "free") : ""}</span></div>`;
      }
      let sum;
      if (pay) {
        const total = tokSum(pay);
        sum = total
          ? L(`낼 보석 <b>${total}개</b> ${pips(pay)}${pay.y ? ` (황금 ${pay.y}개 포함)` : ""} — 은행으로 돌아갑니다`,
            `Pay <b>${pl(total, "gem")}</b> ${pips(pay)}${pay.y ? ` (incl. ${pay.y} Gold)` : ""} — they go back to the bank`)
          : L("보너스만으로 <b>공짜</b>입니다!", "<b>Free</b> with your bonuses alone!");
      } else {
        const miss = shortTot - P.tok.y;
        const lacks = Object.keys(shortBy).map(c => `${gname(c)} ${shortBy[c]}`).join(" · ");
        sum = L(`<span class="gm-bad">보석 <b>${miss}개</b>가 모자랍니다</span> — 부족: ${lacks}${P.tok.y ? ` (황금 ${P.tok.y}개를 써도)` : ""}`,
          `<span class="gm-bad"><b>${pl(miss, "gem")}</b> short</span> — missing: ${lacks}${P.tok.y ? ` (even using ${P.tok.y} Gold)` : ""}`);
      }
      // nobles that would visit if bought
      const bon2 = { ...P.bon }; bon2[C.c]++;
      const nob = v.nobles.filter(N => !qualifies(P.bon, N) && qualifies(bon2, N));
      inner.innerHTML = `<div class="eyebrow">${L(`${C.t}단계 카드`, `Tier ${C.t} card`)}${mine ? L(" · 내가 찜한 카드", " · reserved by me") + (C.blind ? L(" (비공개)", " (hidden)") : "") : ""}</div>
        <div class="gm-stop">${cardHTML(C, "lg")}
          <div class="gm-stxt"><h2>${gemHTML(C.c)} ${L(`${cn} 카드`, `${cn} card`)}${C.pt ? L(` · ${C.pt}점`, ` · ${C.pt} pts`) : ""}</h2>
          <p>${L(`사면 <b>${cn} 보너스 +1</b> — 앞으로 ${cn} 비용이 늘 1 줄어듭니다.`, `Buying it gives <b>+1 ${cn} bonus</b> — every ${cn} cost is 1 less from now on.`)}${C.pt ? "" : L(" 점수는 없습니다.", " No points.")}</p>
          ${nob.length ? `<p class="gm-good">👑 ${L(`사면 귀인 ‘${nobleName(nob[0])}’이(가) 찾아옵니다 (+3점)`, `Buying it brings the ${nobleName(nob[0])} (+3 pts)`)}</p>` : ""}</div></div>
        <div class="gm-pay">${rows}</div><div class="gm-paysum">${sum}</div>`;
      const btns = el("div", "gm-sbtns");
      if (!mine) {
        const resFull = P.res.length >= 3;
        const why = !turn ? notTurn() : resFull ? resFullT() : reserveWhy(v, P);
        btns.appendChild(actBtn(L("찜하기", "Reserve"), false, why, turn && !resFull, () => { if (ctx.send({ reserve: C.id })) close(); }));
      }
      const whyBuy = !turn ? notTurn() : pay ? (C.pt ? L(`+${C.pt}점`, `+${C.pt} pts`) : L("보너스 +1", "+1 bonus")) : L("보석이 모자랍니다", "Not enough gems");
      btns.appendChild(actBtn(L("사기", "Buy"), true, whyBuy, turn && !!pay, () => { if (ctx.send({ buy: C.id })) close(); }));
      inner.appendChild(btns);
    });
  }

  function openDeck(t) {
    openSheet((inner, close) => {
      const v = M.v, P = v.players[M.me], n = v.decks[t - 1];
      const ask = ctx.myAsk(), turn = !!(ask && ask.kind === "turn");
      inner.innerHTML = `<div class="eyebrow">${L(`${t}단계 더미`, `Tier ${t} deck`)}</div>
        <div class="gm-stop"><div class="gm-deck big t${t}${n ? "" : " empty"}"><b>${ROMAN[t]}</b><small>${L(`${n}장`, pl(n, "card"))}</small></div>
        <div class="gm-stxt"><h2>${L("맨 위 카드를 몰래 찜하기", "Secretly reserve the top card")}</h2>
        <p>${L(`남은 카드 <b>${n}장</b>. 무슨 카드인지는 찜한 뒤에 <b>나만</b> 볼 수 있고, 다른 사람에게는 ‘${t}단계 비공개 카드’로 보입니다.`,
          `<b>${pl(n, "card")}</b> left. After reserving, <b>only you</b> can see which card it is; others see a ‘hidden tier ${t} card’.`)}</p></div></div>`;
      const btns = el("div", "gm-sbtns");
      const why = !turn ? notTurn() : !n ? L("더미가 비었습니다", "The deck is empty") : P.res.length >= 3 ? resFullT() : reserveWhy(v, P);
      btns.appendChild(actBtn(L("몰래 찜하기", "Reserve secretly"), true, why, turn && n > 0 && P.res.length < 3, () => { if (ctx.send({ reserveDeck: t })) close(); }));
      inner.appendChild(btns);
    });
  }

  function openPlayer(q) {
    openSheet(inner => {
      const v = M.v, P = v.players[q], pl0 = M.players[q] || { name: "?" };
      const bons = COLORS.map(c => `<span class="gm-pcol"><i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i><small>${gname(c)}</small></span>`).join("");
      const toks = ALL.map(c => `<span class="gm-pcol">${chipHTML(c, P.tok[c], "sm" + (P.tok[c] ? "" : " zero"))}<small>${gname(c)}</small></span>`).join("");
      const res = P.res.length
        ? P.res.map(C => `<div class="gm-rescell">${cardHTML(C)}${C.hidden ? `<small>${L(`${C.t}단계 비공개 카드`, `Hidden tier ${C.t} card`)}</small>` : ""}</div>`).join("")
        : `<span class="gm-none-t">${L("없음", "None")}</span>`;
      const role = q === M.me ? L("나", "You") : q === v.start ? L("첫 차례", "First player") : L("상대", "Opponent");
      const nobles = P.nobles.length ? L(` · 귀인 `, ` · Nobles `) + P.nobles.map(N => "👑 " + nobleName(N)).join(", ") : "";
      inner.innerHTML = `<div class="eyebrow">${role}${q === v.turn && v.phase === "play" ? L(" · 지금 차례", " · playing now") : ""}</div>
        <div class="gm-phead">${avatarHTML(pl0.name, q, "lg")}<h2>${esc(pl0.name)} <span class="gm-big">${L(`${P.pts}점`, `${P.pts} pts`)}</span></h2></div>
        <p>${L(`카드 <b>${P.ncards}장</b> · 보석 <b>${tokSum(P.tok)}/10</b>`, `Cards <b>${P.ncards}</b> · Gems <b>${tokSum(P.tok)}/10</b>`)}${nobles}</p>
        <div class="gm-sec">${L("보너스 (가진 카드)", "Bonuses (cards owned)")}</div><div class="gm-prow">${bons}</div>
        <div class="gm-sec">${L("보석", "Gems")}</div><div class="gm-prow">${toks}</div>
        <div class="gm-sec">${L(`찜한 카드 ${P.res.length}/3`, `Reserved ${P.res.length}/3`)}</div><div class="gm-prow gm-resrow">${res}</div>`;
    });
  }

  function openNoble(id) {
    openSheet(inner => {
      const v = M.v, N = v.nobles.find(x => x.id === id);
      if (!N) return false;
      const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}">${N.req[c]}</i>`).join("");
      const rows = v.players.map((P, q) => {
        const rem = COLORS.reduce((a, c) => a + Math.max(0, N.req[c] - P.bon[c]), 0);
        return `<div class="gm-nrow">${avatarHTML(nameOf(q), q, "sm")}<span>${q === M.me ? L("나", "You") : esc(nameOf(q))}</span>` +
          `<span class="gm-nprog">${COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}${P.bon[c] >= N.req[c] ? " ok" : " zero"}">${Math.min(P.bon[c], N.req[c])}</i>`).join("")}</span>` +
          `<small>${rem ? L(`${rem}장 남음`, `${rem} to go`) : L("조건 충족", "Ready")}</small></div>`;
      }).join("");
      inner.innerHTML = `<div class="eyebrow">${L("귀인 · 3점", "Noble · 3 pts")}</div>
        <div class="gm-stop"><div class="gm-noble big"><b>3</b><span class="gm-req">${reqs}</span></div>
        <div class="gm-stxt"><h2>👑 ${nobleName(N)}</h2><p>${L("이 색의 <b>카드 보너스</b>가 조건만큼 모이면 차례 끝에 찾아와 3점을 줍니다 (보석 토큰은 세지 않습니다).",
          "When your <b>card bonuses</b> in these colours meet the requirement, this noble visits at the end of your turn for 3 points (gem tokens don't count).")}</p></div></div>
        <div class="gm-sec">${L("모두의 진행", "Everyone's progress")}</div>${rows}`;
    });
  }

  /* ---------------- Discard / noble choice (opens automatically when it's my decision) ---------------- */
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
      ctx.head(box, L("보석 10개 초과", "Over 10 gems"), L(`보석 ${need}개를 돌려놓으세요`, `Return ${pl(need, "gem")}`),
        L(`지금 ${total}개 — 10개까지만 가질 수 있습니다.`, `You have ${total} — you may keep at most 10.`));
      const list = el("div", "gm-disc");
      box.appendChild(list);
      const left = el("div", "gm-dleft");
      box.appendChild(left);
      const btnRow = ctx.buttonRow(box, [
        { label: L("추천대로", "Suggest"), on: () => {
          // gems least needed by face-up and reserved cards first (smallest rise in total shortfall; ties: most plentiful colour, gold last)
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
        { label: L("돌려놓기", "Return"), primary: true, on: () => {
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
          r.innerHTML = `${chipHTML(c, P.tok[c] - d[c], "sm")}<span class="gm-dname">${gname(c)}<small>${L(`${P.tok[c]}개 중`, `of ${P.tok[c]}`)}</small></span>`;
          const minus = el("button", "gm-step", "−"), plus = el("button", "gm-step", "+");
          minus.disabled = !d[c];
          plus.disabled = d[c] >= P.tok[c] || tokSum(d) >= need;
          minus.setAttribute("aria-label", L(`${gname(c)} 하나 덜 돌려놓기`, `Return one less ${gname(c)}`));
          plus.setAttribute("aria-label", L(`${gname(c)} 하나 더 돌려놓기`, `Return one more ${gname(c)}`));
          minus.onclick = () => { d[c]--; ctx.sound.tick(); draw2(); };
          plus.onclick = () => { d[c]++; ctx.sound.tick(); draw2(); };
          r.append(minus, el("b", "gm-dn", String(d[c])), plus);
          list.appendChild(r);
        }
        const s = tokSum(d);
        const keep = {};
        for (const c of ALL) keep[c] = P.tok[c] - d[c];
        const nb = buyable(P, keep), nb0 = buyable(P, P.tok);
        left.innerHTML = (s === need ? L(`<b>${need}개</b> 다 골랐습니다 ${pips(d)}`, `All <b>${need}</b> chosen ${pips(d)}`)
          : L(`<b>${need - s}개</b> 더 고르세요 ${pips(d)}`, `Choose <b>${need - s}</b> more ${pips(d)}`)) +
          `<br><small>${L(`이대로면 살 수 있는 카드 <b>${nb}장</b>`, `Then you can buy <b>${pl(nb, "card")}</b>`)}` +
          `${nb < nb0 ? ` <span class="gm-badt">${L(`(지금보다 ${nb0 - nb}장 줄어듦)`, `(${nb0 - nb} fewer than now)`)}</span>` : ""}</small>`;
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
      ctx.head(box, L("귀인 방문", "Noble visit"), L("어느 귀인을 모실까요?", "Which noble will you host?"),
        L("조건을 채운 귀인이 여럿입니다. 이번 차례에는 한 명만 모실 수 있고, 나머지는 다음 기회에.",
          "You qualify for several nobles. Only one can visit this turn; the others may come later."));
      const list = el("div", "choices");
      for (const N of q) {
        const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}">${N.req[c]}</i>`).join("");
        const b = el("button", "choice gm-nchoice", `<b>👑 ${nobleName(N)} · ${L("3점", "3 pts")}</b><span class="gm-req">${reqs}</span>`);
        b.onclick = () => { ctx.send({ noble: N.id }); close(); };
        list.appendChild(b);
      }
      box.appendChild(list);
    }, { dismissible: false }).then(() => { if (sub === token) sub = null; });
  }

  return {
    update,
    ticker: false,     // what just happened shows as badges next to names — hide the one-line ticker and give its height to the board
    destroy() {
      if (ro) ro.disconnect(); else window.removeEventListener("resize", fit);
      closeSheet(); if (sub) { const s = sub; sub = null; s.close(); } root.innerHTML = "";
    }
  };
}
