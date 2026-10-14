/* One Card screen
   Top: opponents row in turn order (me › … › me) — arrows · cards left · last action · bust risk · "Next"
   Middle: deck (cards left) · top card · "what can be played now" panel (suit to follow · attack stack · how to answer) · recent plays strip
   Bottom: my summary (cards · playable cards · distance to bust) · hint · my hand (two rows when large) · buttons
   Sizes come from the measured screen height — spare height makes the cards bigger (no dead space) */
import { cardHTML, cardName, isJoker, rankOf, suitOf, rankLabel, SUITS, SUIT_SYMBOL, SUIT_NAME } from "../../core/cards.js";
import { L, loc } from "../../core/i18n.js";

const NEED_SYM = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠♣", R: "♥♦" };
const REDS = { H: 1, D: 1, R: 1 };
const AV_COLORS = ["#c9774a", "#5f9e6e", "#5b84c4", "#b05f9a", "#c4a24a", "#4aa3a8", "#8a6fc4", "#c45b5b", "#7a8a5a", "#a87a4a"];   // same order as core/ui.js
/* Attack value (same rule as the engine — used for hint texts) */
const power = c => (c === "JB" ? 5 : c === "JC" ? 7 : rankOf(c) === 2 ? 2 : rankOf(c) === 1 ? (c === "S1" ? 5 : 3) : 0);
const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const place = n => L(`${n}등`, ordEn(n));

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "oc");
  wrap.innerHTML = `
    <div class="oc-opps" data-r="opps"></div>
    <div class="oc-table felt" data-r="table">
      <div class="oc-row">
        <button class="oc-deck" data-r="deck" aria-label="${L("카드 받기", "Draw a card")}"></button>
        <div class="oc-pile" data-r="pile"></div>
        <div class="oc-info" data-r="info"></div>
      </div>
      <div class="oc-recent" data-r="recent"></div>
      <div class="oc-log" data-r="log"></div>
      <div class="oc-flash" data-r="flash" aria-live="polite"></div>
    </div>
    <div class="dock oc-dock" data-r="dock">
      <div class="oc-me" data-r="me"></div>
      <div class="hint" data-r="hint"></div>
      <div class="oc-hand" data-r="hand"></div>
      <div class="actions">
        <button class="btn" data-r="draw">${L("1장 받기", "Draw 1")}</button>
        <button class="btn primary" data-r="play" disabled>${L("내기", "Play")}</button>
      </div>
    </div>
    <div class="oc-call" data-r="call" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;              // last msg received
  let sel = null;            // selected card
  let busyUntil = 0, busyAsk = 0;   // block double-sending to the same ask right after sending (released shortly if rejected)
  let fresh = [];            // cards just drawn — highlighted
  let topIn = false;         // the top discard just changed
  let hot = -1;              // player who just acted — name chip pops
  let cdT = 0, flashT = 0, busyT = 0, cdAsk = 0, cdEnd = 0, cdTotal = 1;
  let log = [], logEv = null;   // history inside the table instead of the one-line ticker (raw bilingual texts; newest shown first)
  let geo = { cw: 64, ch: 91, rows: 1, gap: 0, lift: 14 };   // my hand's card size (set by fit)

  const names = () => (M ? M.players.map(p => p.name) : []);
  const myPlay = () => !!(M && M.v.phase === "play" && ctx.myAsk("play"));
  const busy = () => { const a = ctx.myAsk(); return !!a && a.id === busyAsk && Date.now() < busyUntil; };
  function markBusy() {
    const a = ctx.myAsk();
    busyAsk = a ? a.id : 0;
    busyUntil = Date.now() + 1500;
    clearTimeout(busyT); busyT = setTimeout(render, 1600);
  }
  function nextOf(v, p) {
    const n = v.st.length;
    for (let k = 1; k <= n; k++) { const q = ((p + v.dir * k) % n + n) % n; if (v.st[q] === "in") return q; }
    return -1;
  }
  const tilt = c => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h % 25) - 12; };
  const sym = s => `<span class="${REDS[s] ? "oc-r" : "oc-k"}">${NEED_SYM[s] || SUIT_SYMBOL[s]}</span>`;
  const initial = p => esc([...String(names()[p] || "?")][0] || "?");
  const nCards = n => L(`${n}장`, `${n} card${n === 1 ? "" : "s"}`);

  /* Small card (rank above · suit below) — opponents row · recent strip */
  function mini(c, cls = "") {
    if (isJoker(c)) return `<span class="oc-mc jk${c === "JC" ? " red" : ""} ${cls}"><b>🃏</b><i>${c === "JC" ? L("컬러", "col") : L("흑백", "b/w")}</i></span>`;
    return `<span class="oc-mc${REDS[suitOf(c)] ? " red" : ""} ${cls}"><b>${rankLabel(rankOf(c))}</b><i>${SUIT_SYMBOL[suitOf(c)]}</i></span>`;
  }

  /* ---------- Rule math: what matches or answers right now ---------- */
  function defendText(v) {
    const t = v.top;
    if (t === "JC") return L("컬러 조커는 막을 수 없어요", "nothing (colour joker)");
    if (t === "JB") return L("컬러 조커로만 막아요", "colour joker only");
    const s = suitOf(t), r = rankOf(t);
    if (r === 2) return `2 · ${sym(s)}A · ${L("조커", "joker")}${v.set.three ? ` · ${sym(s)}3 ${L("막기", "cancels")}` : ""}`;
    if (t === "S1") return L("조커로만 막아요", "jokers only");
    return `A · ${L("조커", "joker")}`;
  }
  function matchText(v) {
    if (v.need) return `${sym(v.need)} ${L("만 · 조커", "only · joker")}`;
    return `${sym(suitOf(v.top))} ${L("또는", "or")} <b>${rankLabel(rankOf(v.top))}</b> · ${L("조커", "joker")}`;
  }
  function whyNot(v) {
    if (v.attack > 0) return L(`공격 +${v.attack} — 막을 수 있는 공격 카드만 낼 수 있어요`, `Attack +${v.attack} — only an attack card that answers it`);
    if (v.need) return L(`지금은 ${NEED_SYM[v.need]} 무늬나 조커만 낼 수 있어요`, `Only ${NEED_SYM[v.need]} or a joker can be played now`);
    return L("맨 위 카드와 무늬나 숫자가 같아야 해요", "Must match the top card's suit or rank");
  }

  /* ---------- Opponents row: me › A › B › C › me (‹ when reversed) ---------- */
  function opps() {
    const m = M, v = m.v, box = R("opps"), n = v.st.length, me = m.me;
    const playing = v.phase === "play";
    const nx = playing ? (v.call ? v.turn : nextOf(v, v.turn)) : -1;   // during the call window: who plays once it closes
    const order = [];
    for (let k = 1; k < n; k++) order.push((me + k) % n);
    const seq = [me, ...order, me];                       // arrow k sits between seq[k] and seq[k+1]
    const fw = v.dir > 0;
    // Light the arrow leading from the current player to the next one
    let liveArr = -1;
    if (playing && !v.call) for (let k = 0; k < seq.length - 1; k++) if ((fw ? seq[k] : seq[k + 1]) === v.turn) { liveArr = k; break; }
    const arr = k => `<span class="oc-arr${k === liveArr ? " on" : ""}">${fw ? "›" : "‹"}</span>`;
    const bust = v.set.bust;
    const meCap = L("나", "Me");
    let h = `<span class="oc-cap${liveArr === 0 ? " on" : ""}"><i>${meCap}</i>${fw ? "›" : "‹"}</span>`;
    order.forEach((p, i) => {
      const pl = m.players[p] || { name: "?" }, st = v.st[p], c = v.sizes[p];
      const turn = playing && !v.call && p === v.turn;
      const cls = ["oc-opp"];
      if (turn) cls.push("turn");
      if (st === "bust") cls.push("out");
      if (st === "done") cls.push("done");
      if (v.call && v.call.p === p) cls.push("calling");
      if (p === hot) cls.push("hot");
      let cnt, warn = "";
      if (st === "done") cnt = `<span class="oc-place">🏁 ${place(v.place[p])}</span>`;
      else if (st === "bust") cnt = `<span class="oc-place bad">💥 ${L("파산", "Bust")}</span>`;
      else {
        if (c <= 2) cls.push(c === 1 ? "one" : "two");
        cnt = `<b>${c}</b><small>${c === 1 ? L("장!", "card!") : L("장", "cards")}</small>`;
      }
      if (st === "in" && bust) {
        const left = bust - c;
        warn = left <= 4 ? `<span class="oc-risk">${L(`파산까지 ${left}`, `bust in ${left}`)}</span>`
          : `<span class="oc-bar"><i style="width:${Math.min(100, 100 * c / bust)}%"></i></span>`;
        if (left <= 4) cls.push("risk");
      }
      const a = v.act && v.act[p];
      const last = !a ? '<span class="oc-mc none"></span>' : a.c ? mini(a.c) :
        `<span class="oc-took${a.pen ? " pen" : ""}">+${a.d}</span>`;
      const tag = pl.kind === "ai" ? '<span class="oc-ai">AI</span>' : pl.kind === "away" ? `<span class="oc-ai away">${L("비움", "away")}</span>` : "";
      const badge = turn ? `<em class="oc-tag now">${L("차례", "Turn")}</em>` : p === nx && playing ? `<em class="oc-tag">${L("다음", "Next")}</em>` : "";
      h += `<div class="${cls.join(" ")}">${badge}
        <div class="oc-oh">${avatarHTML(pl.name, p, "sm")}${last}</div>
        <div class="oc-on">${esc(pl.name)}${tag}</div>
        <div class="oc-oc">${cnt}</div>${warn}</div>`;
      if (i < order.length - 1) h += arr(i + 1);
    });
    h += `<span class="oc-cap${liveArr === seq.length - 2 ? " on" : ""}">${fw ? "›" : "‹"}<i>${meCap}</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", order.length >= 4);
  }

  /* ---------- Middle ---------- */
  function table() {
    const m = M, v = m.v, mine = myPlay();
    // Deck
    const deck = R("deck");
    const label = mine ? (v.attack > 0 ? L(`${v.attack}장 받기`, `Draw ${v.attack}`) : v.again ? L("받고 끝내기", "Draw & end") : L("1장 받기", "Draw 1")) : L("더미", "Deck");
    deck.innerHTML = (v.deck ? `<span class="oc-stack">${cardHTML(null)}</span>` : `<span class="oc-empty">${L("비었음", "Empty")}</span>`) +
      `<span class="oc-cnt">${v.deck}</span><span class="oc-dlabel">${label}</span>`;
    deck.classList.toggle("can", mine && !busy());
    deck.classList.toggle("atk", mine && v.attack > 0);
    deck.disabled = !mine;
    deck.setAttribute("aria-label", mine ? label : L(`더미 ${v.deck}장`, `Deck: ${v.deck} cards`));

    // Discard pile (the two cards underneath sit at an angle)
    R("pile").innerHTML = v.under.slice(-2).map(c => `<div class="oc-under" style="--r:${tilt(c)}deg">${cardHTML(c)}</div>`).join("") +
      `<div class="oc-top${topIn ? " in" : ""}${v.attack > 0 ? " hot" : ""}">${cardHTML(v.top)}</div>`;
    topIn = false;

    // What can be played now — attack stack · suit to follow · K · normal
    const jk = L("조커", "joker");
    let h;
    if (v.phase !== "play") h = `<div class="oc-i-big">${L("끝", "End")}</div><div class="oc-i-sub">${L("게임 끝", "Game over")}</div>`;
    else if (v.attack > 0) h = `<div class="oc-i-lbl">${L("공격 누적", "Attack stack")}</div><div class="oc-i-big atk">+${v.attack}</div><div class="oc-i-sub">${L("막기", "Answer")}: ${defendText(v)}</div>`;
    else if (v.need) {
      const two = NEED_SYM[v.need].length > 1;
      h = `<div class="oc-i-lbl">${isJoker(v.top) ? L("조커 — 무늬 지정", "Joker — suits set") : L("7 — 무늬 바뀜", "7 — suit changed")}</div>` +
        `<div class="oc-i-big suit${two ? " two" : ""}${REDS[v.need] ? " red" : ""}">${NEED_SYM[v.need]}</div>` +
        `<div class="oc-i-sub">${L(`${two ? "두 무늬 중 하나" : loc(SUIT_NAME[v.need])}만 · 조커 가능`, `${two ? "Either suit" : `${loc(SUIT_NAME[v.need])} only`} · ${jk} OK`)}</div>`;
    }
    else h = `<div class="oc-i-lbl">${L("맞출 것", "Match")}</div><div class="oc-i-big match">${sym(suitOf(v.top))}<small>${L("또는", "or")}</small>${rankLabel(rankOf(v.top))}</div><div class="oc-i-sub">${L("무늬나 숫자 · 조커", "suit or rank · joker")}</div>`;
    if (v.again && v.phase === "play") h += `<div class="oc-i-k">${L("K — 한 장 더", "K — play again")}</div>`;
    const info = R("info");
    info.innerHTML = h;
    info.className = "oc-info" + (v.attack > 0 ? " atk" : v.need ? " need" : "");

    // Recently played cards (oldest → newest)
    const rec = (v.recent || []).slice(-5);
    R("recent").innerHTML = rec.length ? `<span class="oc-rl">${L("최근", "Recent")}</span>` + rec.map((r, i) =>
      `<span class="oc-ri${i === rec.length - 1 ? " now" : ""}">${mini(r.c)}${r.s ? `<em class="${REDS[r.s] ? "red" : ""}">→${SUIT_SYMBOL[r.s]}</em>` : ""}` +
      (r.p < 0 ? `<span class="oc-who first">${L("첫", "1st")}</span>` : `<span class="oc-who" style="--ac:${AV_COLORS[r.p % AV_COLORS.length]}">${initial(r.p)}</span>`) + `</span>`).join('<span class="oc-rarr">›</span>') : "";
    const lines = log.length ? log.slice(-5).reverse() : v.last ? [v.last] : [];
    R("log").innerHTML = lines.map(t => `<div>${esc(ctx.nameText(t))}</div>`).join("");
  }

  /* ---------- "One card!" call window ---------- */
  function callBox() {
    const m = M, v = m.v, box = R("call");
    clearInterval(cdT);
    if (!v.call || v.phase !== "play") { box.hidden = true; box.innerHTML = ""; return; }
    const owner = v.call.p, mine = owner === m.me, ask = ctx.myAsk("call");
    box.hidden = false;
    box.style.top = R("opps").offsetHeight + "px";
    box.className = "oc-call" + (mine ? " own" : "");
    box.innerHTML = `
      <div class="oc-callwho">${mine ? L("한 장 남았습니다!", "One card left!") : L(`<b>${esc(names()[owner])}</b> 님이 한 장!`, `<b>${esc(names()[owner])}</b> has one card!`)}</div>
      <button class="oc-callbtn${mine ? " own" : ""}" data-k="call"${ask ? "" : " disabled"}>
        <b>${L("원카드!", "One card!")}</b><small>${mine ? L("외치세요!", "Call it!") : L("잡기!", "Catch!")}</small></button>
      <div class="oc-cd"${ask && ask.ms ? "" : " hidden"}><i data-k="bar"></i><span data-k="sec"></span></div>
      ${!ask ? `<div class="oc-wait">${L("다른 사람을 기다리는 중…", "Waiting for the others…")}</div>` : !mine ? `<button class="oc-skip" data-k="skip">${L("넘어가기", "Skip")}</button>` : ""}`;
    const btn = box.querySelector('[data-k="call"]');
    btn.onclick = () => {
      if (busy() || !ctx.myAsk("call")) return;
      if (ctx.send({ call: true })) { markBusy(); btn.classList.add("hit"); btn.disabled = true; ctx.sound.chip(); ctx.buzz(40); }
    };
    const skip = box.querySelector('[data-k="skip"]');
    if (skip) skip.onclick = () => { if (!busy() && ctx.send({ call: false })) { markBusy(); skip.disabled = true; } };
    if (ask && ask.ms) {
      if (ask.id !== cdAsk) { cdAsk = ask.id; cdEnd = Date.now() + ask.ms; cdTotal = Math.max(ask.ms, 1); }   // the countdown carries on across re-renders
      const total = cdTotal, end = cdEnd;
      const bar = box.querySelector('[data-k="bar"]'), sec = box.querySelector('[data-k="sec"]');
      const tick = () => {
        const left = Math.max(0, end - Date.now());
        bar.style.width = (100 * left / total) + "%";
        sec.textContent = (left / 1000).toFixed(1);
        if (!left) clearInterval(cdT);
      };
      tick(); cdT = setInterval(tick, 100);
    }
  }

  /* ---------- My one-line summary ---------- */
  function meLine() {
    const m = M, v = m.v, me = m.me, mine = myPlay(), st = v.st[me], n = v.hand.length;
    const chips = [];
    if (st === "done") chips.push(`<span class="oc-chip good">🏁 ${place(v.place[me])}</span>`);
    else if (st === "bust") chips.push(`<span class="oc-chip bad">💥 ${L("파산", "Bust")}</span>`);
    else {
      chips.push(`<span class="oc-chip${n <= 2 ? " good" : ""}">${L(`내 패 <b>${n}</b>장`, `Hand <b>${n}</b>`)}</span>`);
      if (mine) {
        const k = v.legal.length;
        if (v.attack > 0) chips.push(k ? `<span class="oc-chip ok">${L(`막을 카드 <b>${k}</b>장`, `<b>${k}</b> can answer`)}</span>` : `<span class="oc-chip bad">${L("막을 카드 없음", "Nothing to answer")}</span>`);
        else chips.push(k ? `<span class="oc-chip ok">${L(`낼 수 있음 <b>${k}</b>장`, `<b>${k}</b> playable`)}</span>` : `<span class="oc-chip bad">${L("낼 카드 없음", "Nothing to play")}</span>`);
      } else if (v.phase === "play" && !v.call && nextOf(v, v.turn) === me) chips.push(`<span class="oc-chip gold">${L("다음이 내 차례", "You're next")}</span>`);
      if (v.set.bust) {
        const left = v.set.bust - n;
        chips.push(`<span class="oc-chip${left <= 4 ? " bad" : " dim"}">${L(`파산까지 <b>${left}</b>`, `Bust in <b>${left}</b>`)}</span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }

  /* ---------- My hand ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* As big as possible within the height budget: number of rows · card size */
  function handGeo(n, W, budget, cwMax) {
    const lift = 14, K = .4;                              // overlapped cards still show 40% of their width (at least 30px)
    let best = null;
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - lift) / (1 + .56 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + K * (per - 1)), W - 4 - 30 * (per - 1)) : W;
      const cw = Math.max(36, Math.floor(Math.min(cwMax, byH, byW)));
      // Add a row only if it makes the cards more than 12% bigger
      if (!best || cw > best.cw * 1.12) best = { rows, per, cw, ch: Math.round(cw * 1.42), lift };
      if (per <= 1) break;
    }
    const rest = budget - lift - best.ch;
    best.gap = best.rows > 1 ? Math.round(Math.min(best.ch + 6, Math.max(best.ch * .56, rest / (best.rows - 1)))) : 0;
    best.h = best.lift + best.ch + (best.rows - 1) * best.gap + 2;
    return best;
  }
  function hand() {
    const m = M, v = m.v, box = R("hand"), mine = myPlay();
    box.innerHTML = "";
    const cards = v.hand, n = cards.length;
    if (sel && (!mine || !v.legal.includes(sel))) sel = null;
    if (!n) return;                                       // out or bust — collapse the hand area (shown in the summary · hint)
    const W = box.clientWidth || 340, g = geo;
    box.style.setProperty("--cw", g.cw + "px");
    box.style.setProperty("--ch", g.ch + "px");
    const rows = [];
    for (let r = 0; r < g.rows; r++) rows.push(cards.slice(r * g.per, (r + 1) * g.per));
    let i = 0;
    rows.forEach((row, r) => {
      const xs = spread(row.length, W, g.cw, g.cw + 6);
      row.forEach((c, k) => {
        const can = mine && v.legal.includes(c);
        const cls = (mine ? (can ? "can" : "dim") : "") + (sel === c ? " sel" : "") + (fresh.includes(c) ? " new" : "");
        const b = el("button", "oc-card", cardHTML(c, cls));
        b.style.left = xs[k] + "px";
        b.style.top = (g.lift + r * g.gap) + "px";
        b.style.zIndex = String(++i);
        b.setAttribute("aria-label", cardName(c) + (can ? L(" (낼 수 있음)", " (playable)") : ""));
        b.onclick = () => tap(c);
        box.appendChild(b);
      });
    });
  }

  /* ---------- Fitting: share out the screen height ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth;
    if (!H || !W) { geo = handGeo(v.hand.length || 1, W || 340, 120, 60); return; }
    wrap.classList.toggle("tall", H >= 700);
    wrap.classList.toggle("short", H < 600);
    const hb = R("hand"), table = R("table");
    hb.style.height = "0px";
    const fixed = R("opps").offsetHeight + R("dock").offsetHeight + 8;   // includes the margins around the table
    const rest = Math.max(160, H - fixed);
    const hw = hb.clientWidth || W - 20;
    const n = v.hand.length;
    const cwMax = Math.min(hw / 3.4, Math.max(66, rest * .17));
    const feltMin = Math.max(150, rest * .36);
    if (n) {
      geo = handGeo(n, hw, Math.max(90, Math.min(rest * .6, rest - feltMin)), cwMax);
      hb.style.height = geo.h + "px";
    } else hb.style.height = "0px";
    // Table: the remaining height sets the top card and recent-strip sizes
    const fh = table.clientHeight, fw = table.clientWidth;
    const mw = Math.round(Math.max(22, Math.min(44, fh * .1, (fw - 80) / 5.6)));
    const recentH = mw * 1.38 + 20;
    const LH = 18;                                        // height of one history line
    let tc = Math.min(fh - recentH - (fh > 230 ? LH : 0) - 30, 230, (fw - 150) / (0.7 + .56));   // top card height (the deck is 0.8×)
    tc = Math.max(64, Math.floor(tc));
    table.style.setProperty("--tc", tc + "px");
    table.style.setProperty("--mw", mw + "px");
    // Show as many history lines as the spare height allows (up to 5)
    const lines = Math.max(0, Math.min(5, Math.floor((fh - tc - recentH - 34) / LH)));
    const lg = R("log");
    lg.style.height = lines * LH + "px";
    lg.hidden = !lines;
  }

  function tap(c) {
    const v = M.v;
    if (!myPlay() || busy()) return;
    if (!v.legal.includes(c)) { ctx.toast(whyNot(v)); ctx.sound.pass(); return; }
    if (sel === c) { play(c); return; }
    sel = c;
    ctx.sound.flip();
    hand(); buttons(); hint();
  }

  async function play(c) {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const a = { card: c };
    if (!isJoker(c) && rankOf(c) === 7) {
      const k = { S: 0, H: 0, D: 0, C: 0 };
      for (const x of M.v.hand) if (x !== c && !isJoker(x)) k[suitOf(x)]++;
      const s = await ctx.choose(L("무늬 바꾸기", "Change suit"),
        L(`${esc(cardName(c))} — 다음 사람이 낼 무늬를 고르세요`, `${esc(cardName(c))} — choose the suit the next player must play`),
        SUITS.map(s => ({ value: s, label: `<span class="oc-suit${s === "H" || s === "D" ? " red" : ""}">${SUIT_SYMBOL[s]}</span> ${esc(loc(SUIT_NAME[s]))}`,
          note: L(`내 패에 ${k[s]}장`, `${k[s]} in your hand`) })));
      if (!s) return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) { ctx.toast(L("차례가 지나갔습니다", "Your turn has passed")); return; }
      a.suit = s;
    }
    if (ctx.send(a)) { markBusy(); sel = null; fresh = []; ctx.sound.place(); render(); }
  }

  async function draw() {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const v = M.v;
    if (v.attack > 0 && v.legal.length) {
      const ok = await ctx.choose(L("공격 받기", "Take the attack"),
        L(`막을 수 있는 카드가 <b>${v.legal.length}장</b> 있습니다. 그래도 <b>${v.attack}장</b>을 받을까요?`,
          `You have <b>${nCards(v.legal.length)}</b> that can answer it. Draw <b>${v.attack}</b> anyway?`),
        [{ value: "take", label: L(`${v.attack}장 받기`, `Draw ${v.attack}`) }, { value: "", label: L("취소", "Cancel"), note: L("막을 카드를 고릅니다", "Pick a card to answer with") }]);
      if (ok !== "take") return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) return;
    }
    if (ctx.send({ draw: true })) { markBusy(); sel = null; ctx.sound.deal(); render(); }
  }
  R("deck").onclick = draw;
  R("draw").onclick = draw;
  R("play").onclick = () => { if (sel) play(sel); };

  /* ---------- Bottom buttons · hint ---------- */
  function buttons() {
    const v = M.v, mine = myPlay();
    const d = R("draw"), p = R("play");
    d.textContent = mine && v.attack > 0 ? L(`${v.attack}장 받기`, `Draw ${v.attack}`) : mine && v.again ? L("1장 받고 끝내기", "Draw 1 & end turn") : L("1장 받기", "Draw 1");
    d.classList.toggle("danger", mine && v.attack > 0);
    d.disabled = !mine || busy();
    p.disabled = !mine || busy() || !sel || !v.legal.includes(sel);
    p.textContent = sel ? L(`${cardName(sel)} 내기`, `Play ${cardName(sel)}`) : L("내기", "Play");
  }
  function hint() {
    const m = M, v = m.v, me = m.me, h = R("hint");
    const nm = names();
    let t, cls = "hint";
    if (v.phase === "over") t = L("게임 끝", "Game over");
    else if (v.call) t = v.call.p === me ? L("<b>원카드!</b> 버튼을 눌러 외치세요", "Press <b>One card!</b> to call it")
      : L(`<b>${esc(nm[v.call.p])}</b> 님이 한 장 — 먼저 누르면 잡아요!`, `<b>${esc(nm[v.call.p])}</b> has one card — press first to catch them!`);
    else if (myPlay()) {
      if (v.attack > 0) {
        cls += " oc-alert";
        const list = v.legal.map(c => esc(cardName(c))).join(" · ");
        t = v.legal.length ? L(`<b>공격 +${v.attack}</b> — 막기: ${list} (아니면 ${v.attack}장 받기)`, `<b>Attack +${v.attack}</b> — answer: ${list} (or draw ${v.attack})`)
          : L(`막을 카드가 없습니다 — <b>${v.attack}장</b>을 받으세요`, `Nothing can answer it — draw <b>${v.attack}</b>`);
      }
      else if (!v.legal.length) t = v.again ? L("이어서 낼 카드가 없습니다 — 1장 받고 끝내세요", "Nothing to follow with — draw 1 to end your turn")
        : L("낼 카드가 없습니다 — <b>1장 받기</b>", "Nothing to play — <b>Draw 1</b>");
      else if (sel) t = L(`<b>${esc(cardName(sel))}</b> — 한 번 더 누르거나 「내기」`, `<b>${esc(cardName(sel))}</b> — tap again or press "Play"`);
      else t = v.again ? L("<b>K</b> — 한 장 더 내세요 (없으면 1장 받기)", "<b>K</b> — play another card (or draw 1)")
        : L("<b>내 차례</b> — 초록 테두리 카드를 누르세요", "<b>Your turn</b> — tap a card with a green border");
    }
    else if (v.st[me] === "done") t = L(`카드를 다 냈습니다 — ${v.place[me]}등 🎉`, `You're out of cards — ${ordEn(v.place[me])} 🎉`);
    else if (v.st[me] === "bust") t = L("파산 — 구경 중", "Bust — watching");
    else t = L(`${esc(nm[v.turn] || "")} 님 차례`, `${esc(nm[v.turn] || "")}'s turn`) + (v.attack > 0 ? ` · <b>${L("공격", "Attack")} +${v.attack}</b>` : "");
    h.className = cls;
    h.innerHTML = t;
  }

  /* ---------- Events: sound · vibration · short flash ---------- */
  function flash(text, cls) {
    const f = R("flash");
    f.className = "oc-flash on " + (cls || "");
    f.textContent = text;
    clearTimeout(flashT);
    flashT = setTimeout(() => { f.className = "oc-flash"; }, 1400);
  }
  function events(m) {
    const v = m.v, me = m.me, nm = m.players.map(p => p.name);
    let snd = null, rank = 0;
    const want = (s, r) => { if (r >= rank) { snd = s; rank = r; } };
    for (const e of m.ev) {
      if (e.type === "play") {
        topIn = true; hot = e.p;
        if (e.block) { want("good", 3); flash(L("🛡️ 공격을 막았다!", "🛡️ Attack blocked!"), "good"); }
        else if (e.attack) {
          if (v.phase === "play" && v.turn === me && v.attack > 0) { want("bad", 4); ctx.buzz([90, 50, 90]); flash(L(`공격 +${v.attack}!`, `Attack +${v.attack}!`), "bad"); }
          else want("chip", 2);
        } else if (e.reverse) { want("pass", 2); flash(v.dir > 0 ? L("› 방향 바뀜 (순서대로)", "› Direction reversed (forward)") : L("‹ 방향 바뀜 (거꾸로)", "‹ Direction reversed (backward)")); }
        else if (e.skip === me) { want("pass", 3); flash(L("건너뜀 ⏭️", "Skipped ⏭️"), "bad"); }
        else if (e.suit) { want("place", 2); flash(`${L("무늬", "Suit")} → ${SUIT_SYMBOL[e.suit]} ${loc(SUIT_NAME[e.suit])}`, REDS[e.suit] ? "red" : "gold"); }
        else want("place", 1);
        if (e.p === me) fresh = [];
      } else if (e.type === "draw") {
        hot = e.p;
        if (e.p === me && e.cards) fresh = e.cards.slice();
        if (e.p === me && e.reason !== "pass" && e.n) want("bad", 3); else want("deal", 1);
      } else if (e.type === "shuffle") want("flip", 1);
      else if (e.type === "callOpen") {
        if (e.p === me) flash(L("한 장! 원카드를 외치세요", "One card! Call it!"), "gold");
      } else if (e.type === "call") {
        if (e.safe === true) { flash(`📣 ${L("원카드!", "One card!")} — ${nm[e.owner] || ""}`, "gold"); want(e.owner === me ? "good" : "chip", 3); }
        else if (e.safe === false) {
          flash(e.owner === me ? L("잡혔다! 1장 추가 😱", "Caught! +1 card 😱") : e.p === me ? L("잡았다! 🫵", "Got them! 🫵") : L(`${nm[e.p] || ""} 님이 잡았다!`, `${nm[e.p] || ""} caught them!`), e.owner === me ? "bad" : "good");
          if (e.owner === me) { want("bad", 4); ctx.buzz(120); } else want(e.p === me ? "good" : "chip", 3);
        }
      } else if (e.type === "out" && e.p === me) want("good", 4);
      else if (e.type === "bust") { want(e.p === me ? "lose" : "bad", 4); flash(L(`💥 ${nm[e.p] || ""} 님 파산`, `💥 ${nm[e.p] || ""} goes bust`), "bad"); }
    }
    if (snd && ctx.sound[snd]) ctx.sound[snd]();
  }

  function render() {
    if (!M) return;
    wrap.classList.toggle("en", L(false, true));
    opps(); table(); meLine(); hint(); buttons();
    fit();
    hand(); callBox();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // called again with the same msg: log · sounds only once
    M = m;
    if (again) { render(); return; }
    logEv = m.ev;
    for (const e of m.ev) if (e.text) log.push(e.text);
    if (log.length > 12) log.splice(0, log.length - 12);
    hot = -1;
    events(m);
    render();
  }

  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the recent-plays strip and last-action badges replace the one-line ticker
    destroy() {
      window.removeEventListener("resize", onResize);
      clearInterval(cdT); clearTimeout(flashT); clearTimeout(busyT);
      root.innerHTML = "";
    }
  };
}
