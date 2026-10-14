/* 도둑잡기 화면
   위: 상대 줄 — 자리 순서대로, 카드가 넘어가는 방향 화살표(‹) · 남은 장 수 · 탈출 순위
   가운데: 「누가 누구의 패에서 뽑는 중」 + 뽑힐 사람의 뒷면 카드(내 차례면 크게) · 짝 맞은 카드 잠깐 보여 주기 · 진행 기록
   아래: 내 요약(장 수 · 조커 · 짝 맞을 확률) · 안내 · 내 패
   크기는 화면 높이를 재서 정한다 — 남는 높이는 카드를 키우는 데 쓴다 */
import { cardHTML, rankLabel, rankOf, isJoker } from "../../core/cards.js";

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
  let log = [];
  let geo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 }, fgeo = { cw: 60, ch: 85, rows: 1, per: 1, gap: 0 };

  const names = () => (M ? M.players.map(p => p.name) : []);
  const cardLabel = c => (c === "JC" ? "조커" : ({ S: "♠", H: "♥", D: "♦", C: "♣" })[c[0]] + rankLabel(+c.slice(1)));
  /* 숫자만 보이는 카드 (무늬는 모름) — 남이 맞춘 짝 */
  const rankCard = r => `<div class="pc om-rk"><span class="pc-corner">${rankLabel(r)}</span><span class="pc-mid">${rankLabel(r)}</span></div>`;
  function nextWith(v, p) {
    const n = v.sizes.length;
    for (let k = 1; k <= n; k++) { const q = (p + k) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }
  function prevWith(v, p) {                                   // p 의 패에서 뽑는 사람
    const n = v.sizes.length;
    for (let k = 1; k < n; k++) { const q = (p - k + n) % n; if (v.sizes[q] > 0) return q; }
    return -1;
  }

  /* ---------- 상대 줄: 카드는 오른쪽 사람에게서 왼쪽 사람으로 넘어간다 (나 ‹ A ‹ B ‹ 나) ---------- */
  function opps() {
    const m = M, v = m.v, me = m.me, n = v.sizes.length, box = R("opps");
    const playing = v.phase === "play";
    const order = [];
    for (let k = 1; k < n; k++) order.push((me + k) % n);
    const seq = [me, ...order, me];
    // 지금 뽑는 줄: 뽑힐 사람(victim) → 뽑는 사람(turn). 사이에 끝난 사람이 있어도 그 구간 화살표를 모두 켠다
    const live = new Set();
    if (playing && v.victim >= 0) {
      const a = seq.indexOf(v.turn), b = seq.indexOf(v.victim, a + 1);
      if (a >= 0 && b > a) for (let k = a; k < b; k++) live.add(k);
    }
    const arr = k => `<span class="om-arr${live.has(k) ? " on" : ""}">‹</span>`;
    let h = `<span class="om-cap${live.has(0) ? " on" : ""}"><i>나</i>‹</span>`;
    order.forEach((p, i) => {
      const pl = m.players[p] || { name: "?" }, c = v.sizes[p], o = v.out.indexOf(p);
      const cls = ["om-opp"];
      if (playing && p === v.turn) cls.push("turn");
      if (playing && p === v.victim) cls.push("victim");
      if (o >= 0) cls.push(p === v.loser ? "loser" : "done");
      const tag = pl.kind === "ai" ? '<span class="om-ai">AI</span>' : pl.kind === "away" ? '<span class="om-ai away">비움</span>' : "";
      const badge = playing && p === v.turn ? '<em class="om-tag now">뽑는 중</em>' : playing && p === v.victim ? '<em class="om-tag vic">뽑힘</em>' : "";
      const cnt = o >= 0 ? (p === v.loser ? '<span class="om-place bad">🃏 도둑</span>' : `<span class="om-place">🏁 ${o + 1}등</span>`)
        : `<b>${c}</b><small>장</small>`;
      h += `<div class="${cls.join(" ")}">${badge}${tag}${avatarHTML(pl.name, p, "sm")}<div class="om-on">${esc(pl.name)}</div><div class="om-oc">${cnt}</div></div>`;
      if (i < order.length - 1) h += arr(i + 1);
    });
    h += `<span class="om-cap${live.has(seq.length - 2) ? " on" : ""}">‹<i>나</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", order.length >= 5);
  }

  /* ---------- 가운데 ---------- */
  function table() {
    const m = M, v = m.v, me = m.me, nm = names();
    const myTurn = !!ctx.myAsk("draw");
    const who = R("who"), fan = R("fan");
    if (v.phase === "play" && v.victim >= 0) {
      const t = v.turn, x = v.victim;
      const side = (p, role) => `<span class="om-side ${role}">${avatarHTML(nm[p], p, "lg")}<b>${p === me ? "나" : esc(nm[p])}</b><small>${v.sizes[p]}장</small></span>`;
      who.innerHTML = side(t, "drawer") + `<span class="om-flow"><i>뽑기</i><span>◀ 🂠 ◀</span></span>` + side(x, "victim");
      who.classList.toggle("mine", myTurn);
      who.classList.toggle("me-victim", x === me);
    } else {
      who.innerHTML = v.phase === "over" ? `<span class="om-over">게임 끝 — ${v.loser !== null && v.loser !== undefined ? `<b>${esc(nm[v.loser])}</b> 님이 도둑 🃏` : ""}</span>` : "";
    }
    R("pile").innerHTML = `버린 짝<b>${v.discards / 2}</b>쌍`;
    const lines = log.length ? log.slice(-5).reverse() : [];
    R("log").innerHTML = lines.map(t => `<div>${t}</div>`).join("");
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
      const xs = spread(cnt, W - 16, g.cw, g.cw + 8).map(x => x + 8);   // 기울어진 바깥 카드가 판 밖으로 나가지 않게 여백
      for (let k = 0; k < cnt; k++, i++) {
        const idx = i;
        const c = el("button", "om-back" + (myTurn ? " can" : ""), cardHTML(null));
        c.style.left = xs[k] + "px";
        c.style.top = (8 + r * g.gap) + "px";
        c.style.setProperty("--rot", (cnt > 1 && g.rows === 1 ? (k - (cnt - 1) / 2) * Math.min(2, 8 / cnt) : 0) + "deg");
        c.disabled = !myTurn;
        c.setAttribute("aria-label", `${idx + 1}번째 카드 뽑기`);
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

  /* ---------- 내 요약 · 안내 ---------- */
  function meLine() {
    const m = M, v = m.v, me = m.me, nm = names();
    const chips = [];
    const o = v.out.indexOf(me);
    if (o >= 0) chips.push(me === v.loser ? '<span class="om-chip bad">🃏 도둑</span>' : `<span class="om-chip good">🏁 ${o + 1}등 탈출</span>`);
    else {
      chips.push(`<span class="om-chip">내 패 <b>${v.hand.length}</b>장</span>`);
      if (v.hand.includes("JC")) chips.push('<span class="om-chip bad">🃏 조커 있음</span>');
      if (v.phase === "play") {
        const vic = nextWith(v, me), thief = prevWith(v, me);
        if (ctx.myAsk("draw") && v.gone) {
          // 짝 맞을 확률: 내 숫자마다 남이 든 같은 숫자 = 3 - 버려진 장 수. 남의 카드 전체에 고르게 있다고 보고 어림
          let T = 0;
          v.sizes.forEach((s, q) => { if (q !== me) T += s; });
          let hit = 0;
          for (const c of v.hand) if (!isJoker(c)) hit += Math.max(0, 3 - (v.gone[rankOf(c)] || 0));
          if (T > 0) {
            const pp = Math.min(100, Math.round(100 * hit / T));
            chips.push(`<span class="om-chip ok">짝 맞을 확률 ${T === v.sizes[vic] ? "" : "약 "}<b>${pp}%</b></span>`);
            if (!v.hand.includes("JC")) chips.push(`<span class="om-chip dim">조커 ${T === v.sizes[vic] ? "" : "약 "}${Math.round(100 / T)}%</span>`);
          }
        } else if (vic >= 0 && vic !== me) chips.push(`<span class="om-chip dim">내가 뽑을 곳 <b>${esc(nm[vic])}</b></span>`);
        if (thief >= 0 && thief !== me && !ctx.myAsk("draw")) chips.push(`<span class="om-chip dim">날 뽑는 사람 <b>${esc(nm[thief])}</b></span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }
  function hint() {
    const m = M, v = m.v, me = m.me, nm = names(), h = R("hint");
    const myTurn = !!ctx.myAsk("draw");
    let t;
    if (v.phase === "over") t = me === v.loser ? "조커를 끝까지 들고 있었습니다… 🃏" : "게임 끝";
    else if (myTurn) t = `<b>내 차례</b> — ${esc(nm[v.victim])} 님의 카드 한 장을 누르세요`;
    else if (v.out.includes(me)) t = "패를 다 털었습니다 — 구경 중 🎉";
    else if (v.victim === me) t = `<b>${esc(nm[v.turn])}</b> 님이 <b>내 패</b>에서 뽑는 중…` + (v.hand.includes("JC") ? " 조커를 가져가라! 🤞" : "");
    else t = `${esc(nm[v.turn])} 님이 ${esc(nm[v.victim])} 님의 패에서 뽑는 중`;
    h.innerHTML = t;
  }

  /* ---------- 내 패 ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* budget 높이 · W 폭 안에서 n 장을 가장 크게 (minVis: 겹쳐도 보일 최소 폭) */
  function cardGeo(n, W, budget, cwMax, minVis, top, more = 1.12) {
    let best = null;
    n = Math.max(1, n);
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - top) / (1 + .55 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + .38 * (per - 1)), W - 4 - minVis * (per - 1)) : W;
      const cw = Math.max(30, Math.floor(Math.min(cwMax, byH, byW)));
      if (!best || cw > best.cw * more) best = { rows, per, cw, ch: Math.round(cw * 1.42) };   // 줄을 늘려 카드가 more 배 넘게 커질 때만
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
    if (!v.hand.length) return;                           // 다 털었으면 패 자리는 접는다 (요약 · 안내 줄에 표시)
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

  /* ---------- 크기 맞추기 ---------- */
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
    // 판: 뽑을 카드 크기 (내 차례면 크게 — 누르기 쉽게)
    const fh = table.clientHeight, fw = table.clientWidth - 16;
    const whoH = R("who").offsetHeight;
    const LH = 18;
    const fanBudget = Math.max(70, fh - whoH - LH - 34);
    const vn = v.phase === "play" && v.victim >= 0 ? v.sizes[v.victim] : 0;
    const myTurn = !!ctx.myAsk("draw");
    // 뒷면 카드는 한 줄이 자연스럽다 — 너무 촘촘할 때만 두 줄
    fgeo = cardGeo(vn, fw - 16, fanBudget, Math.min(fw / (myTurn ? 3 : 3.6), myTurn ? 120 : 96), myTurn ? 34 : 18, 8, 1.6);
    const fan = R("fan");
    fan.style.height = (vn ? fgeo.h : 0) + "px";
    const lines = Math.max(0, Math.min(5, Math.floor((fh - whoH - (vn ? fgeo.h : 0) - 26) / LH)));
    const lg = R("log");
    lg.style.height = lines * LH + "px";
    lg.hidden = !lines;
  }

  /* ---------- 이벤트: 기록 · 짝 보여 주기 · 소리 ---------- */
  function showPair(cards) {
    const box = R("pair");
    box.innerHTML = `<div class="om-pairin"><b>짝!</b><div class="om-pc">${cards.join("")}</div><small>짝 맞은 카드 — 버림</small></div>`;
    box.hidden = false;
    box.classList.remove("on"); void box.offsetWidth; box.classList.add("on");
    clearTimeout(pairT);
    pairT = setTimeout(() => { box.hidden = true; box.classList.remove("on"); }, 1900);
  }
  function events(m) {
    const v = m.v, me = m.me, nm = m.players.map(p => p.name);
    lastDrawn = null;
    for (const e of m.ev) {
      if (e.type === "draw") {
        let t;
        if (e.to === me) {
          t = e.joker ? "앗, <b>조커</b>를 뽑았습니다! 🃏" : `<b>${esc(nm[e.from])}</b> 님에게서 <b>${esc(cardLabel(e.card))}</b>을(를) 뽑았습니다`;
          if (e.paired) t += " → 짝! 버렸습니다";
          lastDrawn = e.card && !e.paired ? e.card : null;
        } else if (e.from === me) {
          t = `<b>${esc(nm[e.to])}</b> 님이 내 <b>${esc(cardLabel(e.card))}</b>을(를) 가져갔습니다${e.joker ? " — 조커 넘김! 😆" : ""}${e.paired ? ` (짝 ${rankLabel(e.paired)})` : ""}`;
        } else t = `${esc(nm[e.to])} 님이 ${esc(nm[e.from])} 님의 카드를 뽑았습니다${e.paired ? ` — <b>짝 ${rankLabel(e.paired)}</b>` : ""}`;
        log.push(t);
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
        log.push(`🏁 <b>${esc(e.p === me ? "나" : nm[e.p])}</b> 탈출 — ${e.place}등`);
        if (e.p === me) ctx.sound.good();
      } else if (e.type === "over") {
        log.push(e.loser !== null && e.loser !== undefined ? `🃏 <b>${esc(nm[e.loser])}</b> 님이 도둑!` : "게임 끝");
      }
    }
    if (log.length > 12) log.splice(0, log.length - 12);
  }

  function render() {
    if (!M) return;
    opps(); table(); meLine(); hint();
    fit();
    fanCards(); hand();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // 같은 msg 로 다시 불려도 기록 · 소리는 한 번만
    M = m;
    if (!again) { logEv = m.ev; events(m); }
    render();
    prevHand = m.v.hand.slice();
  }
  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // 판 안의 진행 기록이 위쪽 한 줄 기록을 대신한다
    destroy() { window.removeEventListener("resize", onResize); clearTimeout(pairT); root.innerHTML = ""; }
  };
}
