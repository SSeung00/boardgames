/* Old Maid screen
   Top: opponents row in seat order, arrows showing which way cards move (‹) · cards left · finishing place
   Middle: "who is drawing from whom" + the face-down cards of the player being drawn from (large on my turn) · brief pair reveal · history
   Bottom: my summary (cards · joker · pair odds) · hint · my hand
   Sizes come from the measured screen height — spare height makes the cards bigger */
import { cardHTML, rankLabel, rankOf, isJoker } from "../../core/cards.js";
import { L } from "../../core/i18n.js";

const ordEn = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const place = n => L(`${n}등`, ordEn(n));

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "om");
  wrap.innerHTML = `
    <div class="om-opps" data-r="opps"></div>
    <div class="om-table felt" data-r="table">
      <div class="om-who" data-r="who"></div>
      <div class="om-fan" data-r="fan"></div>
      <div class="om-log" data-r="log"></div>
      <div class="om-pile" data-r="pile"></div>
      <div class="om-pair" data-r="pair" hidden></div>
    </div>
    <div class="dock om-dock" data-r="dock">
      <div class="om-me" data-r="me"></div>
      <div class="hint" data-r="hint"></div>
      <div class="om-hand" data-r="hand"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  let M = null, busy = false, lastDrawn = null, prevHand = [], logEv = null, pairT = 0;
  let log = [];              // history lines as functions → HTML, built in the current language at render time
  let geo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 }, fgeo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 };

  const names = () => (M ? M.players.map(p => p.name) : []);
  const cardLabel = c => (c === "JC" ? L("조커", "Joker") : ({ S: "♠", H: "♥", D: "♦", C: "♣" })[c[0]] + rankLabel(+c.slice(1)));
  /* A card showing only its rank (suit unknown) — pairs matched by others */
  const rankCard = r => `<div class="pc om-rk"><span class="pc-corner">${rankLabel(r)}</span><span class="pc-mid">${rankLabel(r)}</span></div>`;
  function nextWith(v, p) {
    const n = v.sizes.length;
    for (let k = 1; k <= n; k++) { const q = (p + k) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }
  function prevWith(v, p) {                                   // the player who draws from p's hand
    const n = v.sizes.length;
    for (let k = 1; k < n; k++) { const q = (p - k + n) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }

  /* ---------- Opponents row: cards move from the right-hand player to the left (me ‹ A ‹ B ‹ me) ---------- */
  function opps() {
    const m = M, v = m.v, me = m.me, n = v.sizes.length, box = R("opps");
    const playing = v.phase === "play";
    const order = [];
    for (let k = 1; k < n; k++) order.push((me + k) % n);
    const seq = [me, ...order, me];
    // The live draw: victim → drawer. Light every arrow in between, even past players who are already out
    const live = new Set();
    if (playing && v.victim >= 0) {
      const a = seq.indexOf(v.turn), b = seq.indexOf(v.victim, a + 1);
      if (a >= 0 && b > a) for (let k = a; k < b; k++) live.add(k);
    }
    const arr = k => `<span class="om-arr${live.has(k) ? " on" : ""}">‹</span>`;
    const meCap = L("나", "Me");
    let h = `<span class="om-cap${live.has(0) ? " on" : ""}"><i>${meCap}</i>‹</span>`;
    order.forEach((p, i) => {
      const pl = m.players[p] || { name: "?" }, c = v.sizes[p], o = v.out.indexOf(p);
      const cls = ["om-opp"];
      if (playing && p === v.turn) cls.push("turn");
      if (playing && p === v.victim) cls.push("victim");
      if (o >= 0) cls.push(p === v.loser ? "loser" : "done");
      const tag = pl.kind === "ai" ? '<span class="om-ai">AI</span>' : pl.kind === "away" ? `<span class="om-ai away">${L("비움", "away")}</span>` : "";
      const badge = playing && p === v.turn ? `<em class="om-tag now">${L("뽑는 중", "Drawing")}</em>` : playing && p === v.victim ? `<em class="om-tag vic">${L("뽑힘", "Target")}</em>` : "";
      const cnt = o >= 0 ? (p === v.loser ? `<span class="om-place bad">🃏 ${L("도둑", order.length >= 5 ? "Maid" : "Old Maid")}</span>` : `<span class="om-place">🏁 ${place(o + 1)}</span>`)
        : `<b>${c}</b><small>${L("장", c === 1 ? "card" : "cards")}</small>`;
      h += `<div class="${cls.join(" ")}">${badge}${tag}${avatarHTML(pl.name, p, "sm")}<div class="om-on">${esc(pl.name)}</div><div class="om-oc">${cnt}</div></div>`;
      if (i < order.length - 1) h += arr(i + 1);
    });
    h += `<span class="om-cap${live.has(seq.length - 2) ? " on" : ""}">‹<i>${meCap}</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", order.length >= 5);
  }

  /* ---------- Middle ---------- */
  function table() {
    const m = M, v = m.v, me = m.me, nm = names();
    const myTurn = !!ctx.myAsk("draw");
    const who = R("who"), fan = R("fan");
    if (v.phase === "play" && v.victim >= 0) {
      const t = v.turn, x = v.victim;
      const side = (p, role) => `<span class="om-side ${role}">${avatarHTML(nm[p], p, "lg")}<b>${p === me ? L("나", "Me") : esc(nm[p])}</b>` +
        `<small>${L(`${v.sizes[p]}장`, `${v.sizes[p]} card${v.sizes[p] === 1 ? "" : "s"}`)}</small></span>`;
      who.innerHTML = side(t, "drawer") + `<span class="om-flow"><i>${L("뽑기", "draws from")}</i><span>◀ 🂠 ◀</span></span>` + side(x, "victim");
      who.classList.toggle("mine", myTurn);
      who.classList.toggle("me-victim", x === me);
    } else {
      const lost = v.loser !== null && v.loser !== undefined;
      who.innerHTML = v.phase === "over" ? `<span class="om-over">${L("게임 끝", "Game over")} — ${lost ? L(`<b>${esc(nm[v.loser])}</b> 님이 도둑 🃏`, `<b>${esc(nm[v.loser])}</b> is the Old Maid 🃏`) : ""}</span>` : "";
    }
    R("pile").innerHTML = L(`버린 짝<b>${v.discards / 2}</b>쌍`, `Pairs<b>${v.discards / 2}</b>out`);
    const lines = log.length ? log.slice(-5).reverse() : [];
    R("log").innerHTML = lines.map(f => `<div>${f()}</div>`).join("");
    fan.innerHTML = "";
  }
  function fanCards() {
    const m = M, v = m.v, fan = R("fan");
    fan.innerHTML = "";
    if (v.phase !== "play" || v.victim < 0) return;
    const myTurn = !!ctx.myAsk("draw");
    const n = v.sizes[v.victim], W = fan.clientWidth || 320, g = fgeo;
    fan.style.setProperty("--cw", g.cw + "px");
    fan.style.setProperty("--ch", g.ch + "px");
    let i = 0;
    for (let r = 0; r < g.rows; r++) {
      const cnt = Math.min(g.per, n - r * g.per);
      const xs = spread(cnt, W - 16, g.cw, g.cw + 8).map(x => x + 8);   // margin so tilted outer cards stay inside the table
      for (let k = 0; k < cnt; k++, i++) {
        const idx = i;
        const c = el("button", "om-back" + (myTurn ? " can" : ""), cardHTML(null));
        c.style.left = xs[k] + "px";
        c.style.top = (8 + r * g.gap) + "px";
        c.style.setProperty("--rot", (cnt > 1 && g.rows === 1 ? (k - (cnt - 1) / 2) * Math.min(2, 8 / cnt) : 0) + "deg");
        c.disabled = !myTurn;
        c.setAttribute("aria-label", L(`${idx + 1}번째 카드 뽑기`, `Draw card ${idx + 1}`));
        c.onclick = () => {
          if (busy || !ctx.myAsk("draw")) return;
          busy = true; c.classList.add("picked");
          ctx.sound.flip();
          setTimeout(() => { ctx.send({ i: idx }); busy = false; }, 220);
        };
        fan.appendChild(c);
      }
    }
  }

  /* ---------- My summary · hint ---------- */
  function meLine() {
    const m = M, v = m.v, me = m.me, nm = names();
    const chips = [];
    const o = v.out.indexOf(me);
    if (o >= 0) chips.push(me === v.loser ? `<span class="om-chip bad">🃏 ${L("도둑", "Old Maid")}</span>` : `<span class="om-chip good">🏁 ${L(`${o + 1}등 탈출`, `Out ${ordEn(o + 1)}`)}</span>`);
    else {
      chips.push(`<span class="om-chip">${L(`내 패 <b>${v.hand.length}</b>장`, `Hand <b>${v.hand.length}</b>`)}</span>`);
      if (v.hand.includes("JC")) chips.push(`<span class="om-chip bad">🃏 ${L("조커 있음", "Joker in hand")}</span>`);
      if (v.phase === "play") {
        const vic = nextWith(v, me), thief = prevWith(v, me);
        if (ctx.myAsk("draw") && v.gone) {
          // Pair odds: for each of my ranks, others hold 3 - (discarded of that rank). Rough estimate assuming they're spread evenly over everyone else's cards
          let T = 0;
          v.sizes.forEach((s, q) => { if (q !== me) T += s; });
          let hit = 0;
          for (const c of v.hand) if (!isJoker(c)) hit += Math.max(0, 3 - (v.gone[rankOf(c)] || 0));
          if (T > 0) {
            const pp = Math.min(100, Math.round(100 * hit / T));
            const ex = T === v.sizes[vic];
            chips.push(`<span class="om-chip ok">${L(`짝 맞을 확률 ${ex ? "" : "약 "}<b>${pp}%</b>`, `Pair chance ${ex ? "" : "~"}<b>${pp}%</b>`)}</span>`);
            if (!v.hand.includes("JC")) chips.push(`<span class="om-chip dim">${L(`조커 ${ex ? "" : "약 "}`, `Joker ${ex ? "" : "~"}`)}${Math.round(100 / T)}%</span>`);
          }
        } else if (vic >= 0 && vic !== me) chips.push(`<span class="om-chip dim">${L(`내가 뽑을 곳 <b>${esc(nm[vic])}</b>`, `Draw from <b>${esc(nm[vic])}</b>`)}</span>`);
        if (thief >= 0 && thief !== me && !ctx.myAsk("draw")) chips.push(`<span class="om-chip dim">${L(`날 뽑는 사람 <b>${esc(nm[thief])}</b>`, `Drawn by <b>${esc(nm[thief])}</b>`)}</span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }
  function hint() {
    const m = M, v = m.v, me = m.me, nm = names(), h = R("hint");
    const myTurn = !!ctx.myAsk("draw");
    let t;
    if (v.phase === "over") t = me === v.loser ? L("조커를 끝까지 들고 있었습니다… 🃏", "You were left holding the joker… 🃏") : L("게임 끝", "Game over");
    else if (myTurn) t = L(`<b>내 차례</b> — ${esc(nm[v.victim])} 님의 카드 한 장을 누르세요`, `<b>Your turn</b> — tap one of ${esc(nm[v.victim])}'s cards`);
    else if (v.out.includes(me)) t = L("패를 다 털었습니다 — 구경 중 🎉", "You're out of cards — watching 🎉");
    else if (v.victim === me) t = L(`<b>${esc(nm[v.turn])}</b> 님이 <b>내 패</b>에서 뽑는 중…`, `<b>${esc(nm[v.turn])}</b> is drawing from <b>your hand</b>…`) +
      (v.hand.includes("JC") ? L(" 조커를 가져가라! 🤞", " Take the joker! 🤞") : "");
    else t = L(`${esc(nm[v.turn])} 님이 ${esc(nm[v.victim])} 님의 패에서 뽑는 중`, `${esc(nm[v.turn])} is drawing from ${esc(nm[v.victim])}'s hand`);
    h.innerHTML = t;
  }

  /* ---------- My hand ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* Fit n cards as large as possible within height budget and width W (minVis: minimum visible width when overlapped) */
  function cardGeo(n, W, budget, cwMax, minVis, top, more = 1.12) {
    let best = null;
    n = Math.max(1, n);
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - top) / (1 + .55 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + .38 * (per - 1)), W - 4 - minVis * (per - 1)) : W;
      const cw = Math.max(30, Math.floor(Math.min(cwMax, byH, byW)));
      if (!best || cw > best.cw * more) best = { rows, per, cw, ch: Math.round(cw * 1.42) };   // add a row only if cards grow by more than `more`×
      if (per <= 1) break;
    }
    const rest = budget - top - best.ch;
    best.gap = best.rows > 1 ? Math.round(Math.min(best.ch + 6, Math.max(best.ch * .55, rest / (best.rows - 1)))) : 0;
    best.h = top + best.ch + (best.rows - 1) * best.gap + 2;
    return best;
  }
  function hand() {
    const m = M, v = m.v, box = R("hand");
    box.innerHTML = "";
    if (!v.hand.length) return;                           // out of cards — collapse the hand area (shown in the summary · hint)
    const W = box.clientWidth || 340, g = geo;
    box.style.setProperty("--cw", g.cw + "px");
    box.style.setProperty("--ch", g.ch + "px");
    let i = 0;
    for (let r = 0; r < g.rows; r++) {
      const row = v.hand.slice(r * g.per, (r + 1) * g.per);
      const xs = spread(row.length, W, g.cw, g.cw + 6);
      row.forEach((c, k) => {
        const d = el("div", "om-card", cardHTML(c, (c === lastDrawn ? "new" : "") + (c === "JC" ? " jk" : "")));
        d.style.left = xs[k] + "px";
        d.style.top = (12 + r * g.gap) + "px";
        d.style.zIndex = String(++i);
        box.appendChild(d);
      });
    }
  }

  /* ---------- Fitting ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth;
    wrap.classList.toggle("tall", H >= 700);
    const hb = R("hand"), table = R("table");
    hb.style.height = "0px";
    const fixed = R("opps").offsetHeight + R("dock").offsetHeight + 8;
    const rest = Math.max(180, H - fixed);
    const hw = hb.clientWidth || W - 20;
    const n = v.hand.length;
    if (n) {
      geo = cardGeo(n, hw, Math.max(80, Math.min(rest * .45, rest - 200)), Math.min(hw / 3.4, Math.max(60, rest * .18)), 26, 12);
      hb.style.height = geo.h + "px";
    } else hb.style.height = "0px";
    // Table: size of the cards to draw from (bigger on my turn — easier to tap)
    const fh = table.clientHeight, fw = table.clientWidth - 16;
    const whoH = R("who").offsetHeight;
    const LH = 18;
    const fanBudget = Math.max(70, fh - whoH - LH - 34);
    const vn = v.phase === "play" && v.victim >= 0 ? v.sizes[v.victim] : 0;
    const myTurn = !!ctx.myAsk("draw");
    // Face-down cards look best in one row — use two only when they get too crowded
    fgeo = cardGeo(vn, fw - 16, fanBudget, Math.min(fw / (myTurn ? 3 : 3.6), myTurn ? 120 : 96), myTurn ? 34 : 18, 8, 1.6);
    const fan = R("fan");
    fan.style.height = (vn ? fgeo.h : 0) + "px";
    const lines = Math.max(0, Math.min(5, Math.floor((fh - whoH - (vn ? fgeo.h : 0) - 26) / LH)));
    const lg = R("log");
    lg.style.height = lines * LH + "px";
    lg.hidden = !lines;
  }

  /* ---------- Events: history · pair reveal · sound ---------- */
  function showPair(cards) {
    const box = R("pair");
    box.innerHTML = `<div class="om-pairin"><b>${L("짝!", "Pair!")}</b><div class="om-pc">${cards.join("")}</div><small>${L("짝 맞은 카드 — 버림", "Matched pair — discarded")}</small></div>`;
    box.hidden = false;
    box.classList.remove("on"); void box.offsetWidth; box.classList.add("on");
    clearTimeout(pairT);
    pairT = setTimeout(() => { box.hidden = true; box.classList.remove("on"); }, 1900);
  }
  function events(m) {
    const me = m.me, nm = m.players.map(p => p.name);
    lastDrawn = null;
    for (const e of m.ev) {
      if (e.type === "draw") {
        const pr = e.paired ? rankLabel(e.paired) : "";
        if (e.to === me) {
          log.push(() => (e.joker ? L("앗, <b>조커</b>를 뽑았습니다! 🃏", "Oops — you drew the <b>joker</b>! 🃏")
            : L(`<b>${esc(nm[e.from])}</b> 님에게서 <b>${esc(cardLabel(e.card))}</b>을(를) 뽑았습니다`, `You drew <b>${esc(cardLabel(e.card))}</b> from <b>${esc(nm[e.from])}</b>`)) +
            (e.paired ? L(" → 짝! 버렸습니다", " → a pair! Discarded") : ""));
          lastDrawn = e.card && !e.paired ? e.card : null;
        } else if (e.from === me) {
          log.push(() => L(`<b>${esc(nm[e.to])}</b> 님이 내 <b>${esc(cardLabel(e.card))}</b>을(를) 가져갔습니다`, `<b>${esc(nm[e.to])}</b> took your <b>${esc(cardLabel(e.card))}</b>`) +
            (e.joker ? L(" — 조커 넘김! 😆", " — joker gone! 😆") : "") + (pr ? L(` (짝 ${pr})`, ` (pair of ${pr})`) : ""));
        } else log.push(() => L(`${esc(nm[e.to])} 님이 ${esc(nm[e.from])} 님의 카드를 뽑았습니다`, `${esc(nm[e.to])} drew from ${esc(nm[e.from])}`) +
          (pr ? ` — <b>${L(`짝 ${pr}`, `pair of ${pr}`)}</b>` : ""));
        if (e.paired) {
          let cards;
          if (e.to === me && e.card) {
            const mate = prevHand.find(c => !isJoker(c) && rankOf(c) === e.paired && c !== e.card);
            cards = [mate ? cardHTML(mate) : rankCard(e.paired), cardHTML(e.card)];
          } else if (e.from === me && e.card) cards = [rankCard(e.paired), cardHTML(e.card)];
          else cards = [rankCard(e.paired), rankCard(e.paired)];
          showPair(cards);
        }
        if (e.to === me || e.from === me) e.joker ? (e.to === me ? ctx.sound.bad() : ctx.sound.good()) : ctx.sound.place();
        else ctx.sound.deal();
      } else if (e.type === "out") {
        log.push(() => `🏁 <b>${esc(e.p === me ? L("나", "You") : nm[e.p])}</b> ${L(`탈출 — ${e.place}등`, `${e.p === me ? "are" : "is"} out — ${ordEn(e.place)}`)}`);
        if (e.p === me) ctx.sound.good();
      } else if (e.type === "over") {
        log.push(() => (e.loser !== null && e.loser !== undefined ? L(`🃏 <b>${esc(nm[e.loser])}</b> 님이 도둑!`, `🃏 <b>${esc(nm[e.loser])}</b> is the Old Maid!`) : L("게임 끝", "Game over")));
      }
    }
    if (log.length > 12) log.splice(0, log.length - 12);
  }

  function render() {
    if (!M) return;
    wrap.classList.toggle("en", L(false, true));
    opps(); table(); meLine(); hint();
    fit();
    fanCards(); hand();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // called again with the same msg: log · sounds only once
    M = m;
    if (!again) { logEv = m.ev; events(m); }
    render();
    prevHand = m.v.hand.slice();
  }
  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // the in-table history replaces the one-line ticker
    destroy() { window.removeEventListener("resize", onResize); clearTimeout(pairT); root.innerHTML = ""; }
  };
}
