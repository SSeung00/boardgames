/* 원카드 화면 — 위: 자리(장 수 · 차례 · 방향) · 가운데: 더미 · 버린 카드 · 무늬/공격 표시 · 아래: 내 패와 버튼 */
import { cardHTML, cardName, isJoker, rankOf, suitOf, SUITS, SUIT_SYMBOL, SUIT_NAME } from "../../core/cards.js";

const NEED_SYM = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠♣", R: "♥♦" };
const REDS = { H: 1, D: 1, R: 1 };

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "oc");
  wrap.innerHTML = `
    <div class="seatrow oc-seats" data-r="seats"></div>
    <div class="oc-table felt" data-r="table">
      <div class="oc-ring" data-r="ring" aria-hidden="true"></div>
      <div class="oc-mid">
        <button class="oc-deck" data-r="deck" aria-label="카드 받기"></button>
        <div class="oc-pile" data-r="pile"></div>
      </div>
      <div class="oc-badges" data-r="badges"></div>
      <div class="oc-last" data-r="last"></div>
      <div class="oc-call" data-r="call" hidden></div>
      <div class="oc-flash" data-r="flash" aria-live="polite"></div>
    </div>
    <div class="dock">
      <div class="hint" data-r="hint"></div>
      <div class="oc-hand" data-r="hand"></div>
      <div class="actions">
        <button class="btn" data-r="draw">1장 받기</button>
        <button class="btn primary" data-r="play" disabled>내기</button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  // 진행 방향 고리 (시계 방향 그림 — 거꾸로면 좌우를 뒤집는다)
  R("ring").innerHTML = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.4">
    <circle cx="50" cy="50" r="42" stroke-dasharray="7 6"/>
    <path d="M45 3 L57 8 L45 13 Z M55 87 L43 92 L55 97 Z" fill="currentColor" stroke="none"/></svg>`;

  let M = null;              // 마지막으로 받은 msg
  let sel = null;            // 고른 카드
  let busyUntil = 0, busyAsk = 0;   // 보낸 직후 같은 질문에 두 번 보내기 막기 (거절되면 잠시 뒤 풀린다)
  let fresh = [];            // 방금 받은 카드 — 반짝 표시
  let topIn = false;         // 버린 카드 맨 위가 막 바뀌었다
  let cdT = 0, flashT = 0, busyT = 0, cdAsk = 0, cdEnd = 0, cdTotal = 1;

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
  /* 버린 카드 밑장의 기울기 — 카드마다 늘 같게 */
  const tilt = c => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h % 25) - 12; };
  const needText = (v) => {
    if (!v.need) return "";
    if (v.need === "B") return "♠ · ♣ 만";
    if (v.need === "R") return "♥ · ♦ 만";
    return `${SUIT_SYMBOL[v.need]} (으)로 바뀜`;
  };
  function whyNot(v) {
    if (v.attack > 0) return `공격 +${v.attack} — 막을 수 있는 공격 카드만 낼 수 있어요`;
    if (v.need) return `지금은 ${NEED_SYM[v.need]} 무늬나 조커만 낼 수 있어요`;
    return "맨 위 카드와 무늬나 숫자가 같아야 해요";
  }

  /* ---------- 자리 ---------- */
  function seats() {
    const m = M, v = m.v, box = R("seats");
    box.innerHTML = "";
    const d = el("div", "oc-dirchip", v.dir > 0 ? "↻" : "↺");
    d.title = v.dir > 0 ? "순서대로 진행" : "거꾸로 진행";
    box.appendChild(d);
    const playing = v.phase === "play";
    const nx = playing ? nextOf(v, v.turn) : -1;
    m.players.forEach((pl, p) => {
      const st = v.st[p], n = v.sizes[p];
      const turn = playing && !v.call && p === v.turn;
      const chip = el("div", "seatchip oc-seat" + (turn ? " turn" : "") + (p === m.me ? " me" : "") + (st !== "in" ? " out" : "") +
        (v.call && v.call.p === p ? " oc-calling" : "") + (st === "in" && n === 1 ? " oc-one" : ""));
      const tag = pl.kind === "ai" ? '<span class="ai">AI</span>' : pl.kind === "away" ? '<span class="away">자리 비움</span>' : "";
      const sub = st === "done" ? `🏁 ${v.place[p]}등` : st === "bust" ? "💥 파산" : n === 1 ? "🂠 1장!" : `🂠 ${n}`;
      chip.innerHTML = `${avatarHTML(pl.name, p, "sm")}<span class="oc-st"><span class="nm">${esc(pl.name)}</span>` +
        `<span class="sub">${tag}${sub}</span></span>${p === nx && !turn && playing ? '<em class="oc-nx">다음</em>' : ""}`;
      box.appendChild(chip);
    });
  }

  /* ---------- 가운데 ---------- */
  function table() {
    const m = M, v = m.v, mine = myPlay();
    R("ring").classList.toggle("rev", v.dir < 0);

    // 더미
    const deck = R("deck");
    const label = mine ? (v.attack > 0 ? `${v.attack}장 받기` : v.again ? "받고 끝내기" : "1장 받기") : "더미";
    deck.innerHTML = (v.deck ? `<span class="oc-stack">${cardHTML(null, "lg")}</span>` : '<span class="oc-empty">비었음</span>') +
      `<span class="oc-cnt">${v.deck}</span><span class="oc-dlabel">${label}</span>`;
    deck.classList.toggle("can", mine && !busy());
    deck.classList.toggle("atk", mine && v.attack > 0);
    deck.disabled = !mine;
    deck.setAttribute("aria-label", mine ? label : `더미 ${v.deck}장`);

    // 버린 카드
    const pile = R("pile");
    pile.innerHTML = v.under.map(c => `<div class="oc-under" style="--r:${tilt(c)}deg">${cardHTML(c)}</div>`).join("") +
      `<div class="oc-top${topIn ? " in" : ""}${v.attack > 0 ? " hot" : ""}">${cardHTML(v.top)}</div>` +
      `<span class="oc-pcnt">${v.pile}장</span>`;
    topIn = false;

    // 표시: 공격 · 무늬 · K
    let b = "";
    if (v.attack > 0) b += `<span class="oc-atk">공격 +${v.attack}</span>`;
    if (v.need) b += `<span class="oc-need${REDS[v.need] ? " red" : ""}"><i>${NEED_SYM[v.need]}</i>${esc(needText(v))}</span>`;
    if (v.again && v.phase === "play") b += '<span class="oc-again">K — 한 장 더</span>';
    R("badges").innerHTML = b;
    R("last").textContent = v.last ? ctx.nameText(v.last) : "";
  }

  /* ---------- 원카드 창 ---------- */
  function callBox() {
    const m = M, v = m.v, box = R("call");
    clearInterval(cdT);
    if (!v.call || v.phase !== "play") { box.hidden = true; box.innerHTML = ""; return; }
    const owner = v.call.p, mine = owner === m.me, ask = ctx.myAsk("call");
    box.hidden = false;
    box.className = "oc-call" + (mine ? " own" : "");
    box.innerHTML = `
      <div class="oc-callwho">${mine ? "한 장 남았습니다!" : `<b>${esc(names()[owner])}</b> 님이 한 장!`}</div>
      <button class="oc-callbtn${mine ? " own" : ""}" data-k="call"${ask ? "" : " disabled"}>
        <b>원카드!</b><small>${mine ? "외치세요!" : "잡기!"}</small></button>
      <div class="oc-cd"${ask && ask.ms ? "" : " hidden"}><i data-k="bar"></i><span data-k="sec"></span></div>
      ${!ask ? '<div class="oc-wait">다른 사람을 기다리는 중…</div>' : !mine ? '<button class="oc-skip" data-k="skip">넘어가기</button>' : ""}`;
    const btn = box.querySelector('[data-k="call"]');
    btn.onclick = () => {
      if (busy() || !ctx.myAsk("call")) return;
      if (ctx.send({ call: true })) { markBusy(); btn.classList.add("hit"); btn.disabled = true; ctx.sound.chip(); ctx.buzz(40); }
    };
    const skip = box.querySelector('[data-k="skip"]');
    if (skip) skip.onclick = () => { if (!busy() && ctx.send({ call: false })) { markBusy(); skip.disabled = true; } };
    if (ask && ask.ms) {
      if (ask.id !== cdAsk) { cdAsk = ask.id; cdEnd = Date.now() + ask.ms; cdTotal = Math.max(ask.ms, 1); }   // 다시 그려도 시계는 이어진다
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

  /* ---------- 내 패 ---------- */
  /* n 장을 폭 W 안에 겹쳐 놓을 때 각 카드의 왼쪽 위치 */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 8 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  function hand() {
    const m = M, v = m.v, box = R("hand"), mine = myPlay();
    box.innerHTML = "";
    const cards = v.hand, n = cards.length;
    if (sel && (!mine || !v.legal.includes(sel))) sel = null;
    if (!n) {
      const st = v.st[m.me];
      box.style.height = "84px";
      box.innerHTML = `<div class="oc-none">${st === "done" ? `카드를 다 냈습니다! 🎉 (${v.place[m.me]}등)` : st === "bust" ? "파산했습니다 — 구경 중 💥" : ""}</div>`;
      return;
    }
    const W = box.clientWidth || 340;
    const cw = W < 370 ? 54 : 60, ch = Math.round(cw * 1.42);
    const rows = n > 12 ? 2 : 1, per = Math.ceil(n / rows), gap = Math.round(ch * .5);
    box.style.height = (ch + 14 + (rows - 1) * gap) + "px";
    box.style.setProperty("--cw", cw + "px");
    box.style.setProperty("--ch", ch + "px");
    const xs = [spread(per, W, cw, cw + 4), spread(n - per, W, cw, cw + 4)];
    cards.forEach((c, i) => {
      const row = i < per ? 0 : 1, k = row ? i - per : i;
      const can = mine && v.legal.includes(c);
      const cls = (mine ? (can ? "can" : "dim") : "") + (sel === c ? " sel" : "") + (fresh.includes(c) ? " new" : "");
      const b = el("button", "oc-card", cardHTML(c, cls));
      b.style.left = xs[row][k] + "px";
      b.style.top = (12 + row * gap) + "px";
      b.style.zIndex = String(i + 1);
      b.setAttribute("aria-label", cardName(c) + (can ? " (낼 수 있음)" : ""));
      b.onclick = () => tap(c);
      box.appendChild(b);
    });
  }

  function tap(c) {
    const v = M.v;
    if (!myPlay() || busy()) return;
    if (!v.legal.includes(c)) { ctx.toast(whyNot(v)); ctx.sound.pass(); return; }
    if (sel === c) { play(c); return; }
    sel = c;
    ctx.sound.flip();
    hand(); buttons();
  }

  async function play(c) {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const a = { card: c };
    if (!isJoker(c) && rankOf(c) === 7) {
      const k = { S: 0, H: 0, D: 0, C: 0 };
      for (const x of M.v.hand) if (x !== c && !isJoker(x)) k[suitOf(x)]++;
      const s = await ctx.choose("무늬 바꾸기", `${esc(cardName(c))} — 다음 사람이 낼 무늬를 고르세요`,
        SUITS.map(s => ({ value: s, label: `<span class="oc-suit${s === "H" || s === "D" ? " red" : ""}">${SUIT_SYMBOL[s]}</span> ${SUIT_NAME[s]}`, note: `내 패에 ${k[s]}장` })));
      if (!s) return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) { ctx.toast("차례가 지나갔습니다"); return; }
      a.suit = s;
    }
    if (ctx.send(a)) { markBusy(); sel = null; fresh = []; ctx.sound.place(); render(); }
  }

  async function draw() {
    const ask = ctx.myAsk("play");
    if (!ask || busy()) return;
    const v = M.v;
    if (v.attack > 0 && v.legal.length) {
      const ok = await ctx.choose("공격 받기", `막을 수 있는 카드가 있습니다. 그래도 <b>${v.attack}장</b>을 받을까요?`,
        [{ value: "take", label: `${v.attack}장 받기` }, { value: "", label: "취소", note: "막을 카드를 고릅니다" }]);
      if (ok !== "take") return;
      const now = ctx.myAsk("play");
      if (!now || now.id !== ask.id) return;
    }
    if (ctx.send({ draw: true })) { markBusy(); sel = null; ctx.sound.deal(); render(); }
  }
  R("deck").onclick = draw;
  R("draw").onclick = draw;
  R("play").onclick = () => { if (sel) play(sel); };

  /* ---------- 아래 버튼 · 안내 ---------- */
  function buttons() {
    const v = M.v, mine = myPlay();
    const d = R("draw"), p = R("play");
    d.textContent = mine && v.attack > 0 ? `패널티 ${v.attack}장 받기` : mine && v.again ? "1장 받고 끝내기" : "1장 받기";
    d.classList.toggle("danger", mine && v.attack > 0);
    d.disabled = !mine || busy();
    p.disabled = !mine || busy() || !sel || !v.legal.includes(sel);
    p.textContent = sel ? `${cardName(sel)} 내기` : "내기";
  }
  function hint() {
    const m = M, v = m.v, me = m.me, h = R("hint");
    const nm = names();
    let t;
    if (v.phase === "over") t = "게임 끝";
    else if (v.call) t = v.call.p === me ? "<b>원카드!</b> 버튼을 눌러 외치세요" : `<b>${esc(nm[v.call.p])}</b> 님이 한 장 — 먼저 누르면 잡아요!`;
    else if (myPlay()) {
      if (v.attack > 0) t = v.legal.length ? `<b>공격 +${v.attack}</b> — 막을 카드를 내거나 ${v.attack}장 받기` : `막을 카드가 없습니다 — <b>${v.attack}장</b>을 받으세요`;
      else if (!v.legal.length) t = v.again ? "이어서 낼 카드가 없습니다 — 1장 받고 끝내세요" : "낼 카드가 없습니다 — <b>1장 받기</b>";
      else if (sel) t = `<b>${esc(cardName(sel))}</b> — 한 번 더 누르거나 「내기」`;
      else t = v.again ? "<b>K</b> — 한 장 더 내세요 (없으면 1장 받기)" : "<b>내 차례</b> — 낼 카드를 누르세요";
    }
    else if (v.st[me] === "done") t = `카드를 다 냈습니다 — ${v.place[me]}등 🎉`;
    else if (v.st[me] === "bust") t = "파산 — 구경 중";
    else {
      const who = nm[v.turn] || "";
      t = `${esc(who)} 님 차례` + (v.attack > 0 ? ` · 공격 +${v.attack}` : "") + ` · 내 패 ${v.hand.length}장`;
    }
    h.innerHTML = t;
  }

  /* ---------- 이벤트: 소리 · 진동 · 짧은 알림 ---------- */
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
        topIn = true;
        if (e.block) { want("good", 3); flash("🛡️ 공격을 막았다!", "good"); }
        else if (e.attack) {
          if (v.phase === "play" && v.turn === me && v.attack > 0) { want("bad", 4); ctx.buzz([90, 50, 90]); flash(`공격 +${v.attack}!`, "bad"); }
          else want("chip", 2);
        } else if (e.reverse) { want("pass", 2); flash(v.dir > 0 ? "↻ 방향 바뀜" : "↺ 방향 바뀜"); }
        else if (e.skip === me) { want("pass", 3); flash("건너뜀 ⏭️", "bad"); }
        else want("place", 1);
        if (e.p === me) fresh = [];
      } else if (e.type === "draw") {
        if (e.p === me && e.cards) fresh = e.cards.slice();
        if (e.p === me && e.reason !== "pass" && e.n) want("bad", 3); else want("deal", 1);
      } else if (e.type === "shuffle") want("flip", 1);
      else if (e.type === "callOpen") {
        if (e.p === me) flash("한 장! 원카드를 외치세요", "gold");
      } else if (e.type === "call") {
        if (e.safe === true) { flash(`📣 원카드! — ${nm[e.owner] || ""}`, "gold"); want(e.owner === me ? "good" : "chip", 3); }
        else if (e.safe === false) {
          flash(e.owner === me ? "잡혔다! 1장 추가 😱" : e.p === me ? "잡았다! 🫵" : `${nm[e.p] || ""} 님이 잡았다!`, e.owner === me ? "bad" : "good");
          if (e.owner === me) { want("bad", 4); ctx.buzz(120); } else want(e.p === me ? "good" : "chip", 3);
        }
      } else if (e.type === "out" && e.p === me) want("good", 4);
      else if (e.type === "bust") { want(e.p === me ? "lose" : "bad", 4); flash(`💥 ${nm[e.p] || ""} 님 파산`, "bad"); }
    }
    if (snd && ctx.sound[snd]) ctx.sound[snd]();
  }

  function render() {
    if (!M) return;
    seats(); table(); callBox(); hand(); buttons(); hint();
  }
  function update(m) {
    M = m;
    events(m);
    render();
  }

  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    destroy() {
      window.removeEventListener("resize", onResize);
      clearInterval(cdT); clearTimeout(flashT); clearTimeout(busyT);
      root.innerHTML = "";
    }
  };
}
