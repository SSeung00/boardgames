/* 포커 화면 — 위: 상대 자리 · 가운데 펠트: 공용 카드 5장 · 팟 · 마지막 행동 (판이 끝나면 결과) · 아래: 내 패와 행동 버튼
   레이즈는 아래 판에서 금액을 고르고 「확인」 을 한 번 더 눌러야 나간다. 올인 콜 · 체크 가능한데 폴드도 두 번 눌러 확인. */
import { cardHTML } from "../../core/cards.js";

const STREETS = ["프리플랍", "플랍", "턴", "리버"];
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const fmt = n => Number(n || 0).toLocaleString("ko-KR");
const label = c => (RANK[+c.slice(1)] || c.slice(1)) + SUIT[c[0]];
const red = c => c[0] === "H" || c[0] === "D";
const mini = (c, extra = "") => `<span class="pk-mini${red(c) ? " red" : ""}${extra ? " " + extra : ""}">${label(c)}</span>`;

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "pk");
  wrap.innerHTML = `
    <div class="pk-opps" data-r="opps"></div>
    <div class="pk-table felt">
      <div class="pk-info" data-r="info"></div>
      <div class="pk-board" data-r="board"></div>
      <div class="pk-mid" data-r="mid"></div>
    </div>
    <div class="dock pk-dock" data-r="dock">
      <div class="pk-me" data-r="me"></div>
      <div class="hint" data-r="hint"></div>
      <div class="pk-raise" data-r="raise" hidden>
        <div class="pk-rhead"><span data-r="rlabel">레이즈</span><b data-r="ramt"></b></div>
        <div class="pk-rslide">
          <button class="pk-step" data-r="minus" aria-label="줄이기">−</button>
          <input type="range" data-r="slider" aria-label="금액">
          <button class="pk-step" data-r="plus" aria-label="늘리기">+</button>
        </div>
        <div class="pk-quick" data-r="quick"></div>
        <div class="actions">
          <button class="btn" data-r="rcancel">취소</button>
          <button class="btn primary" data-r="rok">확인</button>
        </div>
      </div>
      <div class="actions" data-r="acts">
        <button class="btn" data-r="fold">폴드</button>
        <button class="btn" data-r="call">체크</button>
        <button class="btn primary" data-r="raiseBtn">레이즈</button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let m = null;                 // 마지막 msg
  let askId = 0;                // 지금 내 결정 번호
  let busy = false, busyT = 0;  // 보낸 직후 잠깐 잠금 (두 번 누르기 방지)
  let panel = false, amt = 0;   // 레이즈 판
  let armed = "", armT = 0;     // 두 번 눌러 확인할 버튼
  let tickT = 0;
  let boardSeen = { hand: 0, len: 0 };
  let pops = new Set();         // 방금 칩을 낸 자리 (애니메이션)

  /* ---------- 도우미 ---------- */
  const names = () => m.players.map(p => p.name);
  const myAsk = () => (busy ? null : ctx.myAsk("bet"));
  const lastHere = v => (v.last && v.last.hand === v.hand && (v.phase === "end" || v.phase === "over") ? v.last : null);
  function winnersOf(last) {
    const s = new Set();
    if (last) for (const pot of last.pots) for (const w of pot.winners) s.add(w.p);
    return s;
  }
  function badges(q) {
    const v = m.v;
    if (!v.hand || v.phase === "over") return "";
    let h = "";
    if (q === v.button) h += '<i class="pk-b d">D</i>';
    if (q === v.sbSeat) h += '<i class="pk-b">SB</i>';
    if (q === v.bbSeat) h += '<i class="pk-b">BB</i>';
    return h;
  }
  function actText(la) {
    if (!la) return "";
    const nm = esc(names()[la.p] || "?");
    const w = { fold: "폴드", check: "체크", call: `콜 ${fmt(la.amount)}`, bet: `벳 ${fmt(la.to)}`, raise: `레이즈 ${fmt(la.to)}`, allin: `올인! ${fmt(la.to)}` }[la.a] || "";
    return `<b>${nm}</b> 님 ${w}`;
  }

  /* ---------- 위: 상대 자리 ---------- */
  function renderOpps() {
    const v = m.v, n = m.players.length, box = R("opps");
    const order = [];
    for (let k = 1; k < n; k++) order.push((m.me + k) % n);
    const cols = order.length <= 4 ? order.length : Math.ceil(order.length / 2);
    box.style.gridTemplateColumns = `repeat(${Math.max(1, cols)}, minmax(0, 1fr))`;
    box.classList.toggle("pk-dense", cols >= 4);
    box.innerHTML = "";
    const last = lastHere(v), wins = winnersOf(last);
    for (const q of order) {
      const s = v.seats[q], pl = m.players[q], active = v.turn === q;
      const d = el("div", "seatchip pk-seat" + (active ? " turn" : "") + (s.out ? " out" : "") + (s.fold ? " pk-fold" : "") +
        (s.allin ? " pk-allin" : "") + (wins.has(q) ? " pk-win" : ""));
      let st;
      if (s.out) st = "탈락";
      else if (active) st = `<span class="pk-tm" data-tm="${q}">생각 중…</span>`;
      else if (last && last.delta[q] > 0) st = `<b class="pk-plus">+${fmt(last.delta[q])}</b>`;
      else if (s.fold) st = "폴드";
      else if (s.allin) st = '<b class="pk-ai">올인</b>';
      else st = esc(s.act || "");
      const live = s.inHand && !s.fold && !s.out && v.phase !== "over";
      const best = last ? (last.shows.find(x => x.p === q) || {}).best || [] : [];
      const cards = s.cards ? s.cards.map(c => mini(c, wins.has(q) && best.includes(c) ? "hl" : "")).join("")
        : live ? '<span class="pk-back"></span><span class="pk-back"></span>' : "";
      d.innerHTML = `<div class="pk-s1">${avatarHTML(pl.name, q, "sm")}<span class="nm">${esc(pl.name)}</span>` +
        (pl.kind === "away" ? '<span class="away">비움</span>' : "") + `${badges(q)}</div>` +
        `<div class="pk-s2"><span class="pk-stk">${fmt(s.chips)}</span>${s.bet > 0 ? `<span class="pk-bet${pops.has(q) ? " pop" : ""}">${fmt(s.bet)}</span>` : ""}</div>` +
        `<div class="pk-s3"><span class="pk-st">${st}</span><span class="pk-hc">${cards}</span></div>`;
      box.appendChild(d);
    }
  }

  /* ---------- 가운데: 펠트 ---------- */
  function renderTable() {
    const v = m.v, last = lastHere(v);
    // 윗줄: 판 · 블라인드 · 거리
    let info = "";
    if (v.hand) {
      const k = v.nextUp ? v.nextUp - v.hand : 0;
      info = `<span class="pk-lv">${v.limit ? `${v.hand}/${v.limit}판` : `${v.hand}번째 판`} · 블라인드 <b>${fmt(v.sb)}/${fmt(v.bb)}</b>` +
        (k > 0 ? ` · ${k === 1 ? "다음 판" : k + "판 뒤"} ↑` : "") + `</span>`;
      if (v.phase === "bet" || v.phase === "deal") info += `<b class="pk-street">${STREETS[v.street]}</b>`;
      if (v.last && !last) info += '<button class="pk-lastbtn" data-r="lastbtn">지난 판</button>';
    }
    R("info").innerHTML = info;
    const lb = R("lastbtn");
    if (lb) lb.onclick = () => showLast();

    // 공용 카드 5칸
    const board = R("board");
    const fresh = boardSeen.hand === v.hand ? boardSeen.len : 0;
    boardSeen = { hand: v.hand, len: v.board.length };
    let hl = null;
    if (last && last.showdown && last.pots.length) {
      const w = last.pots[0].winners[0].p;
      hl = (last.shows.find(x => x.p === w) || {}).best || null;
    }
    let bh = "";
    for (let i = 0; i < 5; i++) {
      const c = v.board[i];
      if (!c) { bh += '<div class="pk-slot"></div>'; continue; }
      const cls = (i >= fresh ? "pk-new" : "") + (hl ? (hl.includes(c) ? " pk-hl" : " dim") : "");
      bh += cardHTML(c, cls);
    }
    board.innerHTML = bh;
    if (fresh < v.board.length) board.querySelectorAll(".pk-new").forEach((x, i) => x.style.animationDelay = (i * 0.12) + "s");

    // 아래: 판 결과 · 또는 팟과 마지막 행동
    const mid = R("mid");
    if (last) { mid.innerHTML = resultHTML(last, `${last.hand}번째 판 결과`); return; }
    if (!v.hand) { mid.innerHTML = '<div class="pk-line">카드를 섞는 중…</div>'; return; }
    let h = `<div class="pk-pot"><span class="pk-chipico"></span>팟 <b>${fmt(v.potTotal)}</b></div>`;
    if (v.pots.length > 1) h += `<div class="pk-side">${v.pots.map((x, i) => `${i ? "사이드" + (v.pots.length > 2 ? " " + i : "") : "메인"} ${fmt(x.amount)}`).join(" · ")}</div>`;
    if (v.runout) h += '<div class="pk-runout">올인! 남은 카드를 펼칩니다</div>';
    h += `<div class="pk-line">${actText(v.lastAct)}</div>`;
    mid.innerHTML = h;
  }

  function resultHTML(last, title) {
    const nm = names(), wins = winnersOf(last);
    let h = `<div class="pk-res"><div class="pk-rt">${esc(title)}</div>`;
    for (const pot of last.pots) {
      h += `<div class="pk-prow"><span class="pk-pl">${pot.label} <b>${fmt(pot.amount)}</b></span><span class="pk-pw">` +
        pot.winners.map(w => `<span class="pk-wn">${avatarHTML(nm[w.p], w.p, "sm")}<b>${esc(nm[w.p])}</b> +${fmt(w.amount)}</span>`).join("") +
        (pot.hand ? `<em>${pot.hand}${pot.winners.length > 1 ? " · 나눔" : ""}</em>` : "") + `</span></div>`;
    }
    if (last.shows.length) {
      h += '<div class="pk-shows">';
      for (const s of last.shows) {
        const won = wins.has(s.p);
        h += `<div class="pk-show${won ? " win" : ""}${s.p === m.me ? " me" : ""}">${avatarHTML(nm[s.p], s.p, "sm")}<span class="nm">${esc(nm[s.p])}</span>` +
          `<span class="pk-cards">${s.cards.map(c => cardHTML(c, "sm" + (won && s.best.includes(c) ? " pk-hl" : ""))).join("")}</span>` +
          `<span class="pk-hn">${s.hand}</span></div>`;
      }
      h += "</div>";
    } else h += '<div class="pk-nosd">모두 폴드 — 패를 보이지 않고 가져갑니다</div>';
    if (last.bust.length) h += `<div class="pk-bust">💥 ${last.bust.map(q => esc(nm[q])).join(", ")} 님 탈락</div>`;
    return h + "</div>";
  }

  function showLast() {
    const last = m && m.v.last;
    if (!last) return;
    ctx.modal(box => {
      ctx.head(box, "지난 판", `${last.hand}번째 판 결과`, "");
      const b = el("div", "pk-board pk-mboard", last.board.map(c => cardHTML(c, "sm")).join("") || "");
      box.appendChild(b);
      box.appendChild(el("div", "pk-mres", resultHTML(last, "")));
    });
  }

  /* ---------- 아래: 내 패 ---------- */
  function renderMe() {
    const v = m.v, my = v.my, box = R("me");
    if (!my) { box.innerHTML = ""; return; }
    const s = v.seats[m.me], last = lastHere(v), wins = winnersOf(last);
    const mine = last && last.shows.find(x => x.p === m.me);
    const dealt = pops.has("deal");
    let cards;
    if (my.hole) cards = my.hole.map(c => cardHTML(c, "lg" + (s.fold ? " dim" : "") + (dealt ? " pk-deal" : "") + (mine && wins.has(m.me) && mine.best.includes(c) ? " pk-hl" : ""))).join("");
    else cards = `<div class="pk-nohole">${s.out ? "탈락" : v.phase === "over" ? "" : "다음 판부터"}</div>`;
    let made = "";
    if (s.fold && my.hole) made = '<span class="pk-folded">폴드</span>';
    else if (mine) made = `<span class="${wins.has(m.me) ? "pk-good" : ""}">${mine.hand}</span>`;
    else if (my.made && !s.out) made = my.made.name;
    const delta = last ? last.delta[m.me] : 0;
    box.innerHTML = `<div class="pk-hole">${cards}</div>
      <div class="pk-mine">
        <div class="pk-mystk"><b>${fmt(my.chips)}</b><small>칩</small>${badges(m.me)}${delta ? `<span class="pk-delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${fmt(delta)}</span>` : ""}</div>
        <div class="pk-mysub">${my.bet ? `베팅 <b class="pk-bet${pops.has(m.me) ? " pop" : ""}">${fmt(my.bet)}</b>` : ""}${my.put && !last ? `<span>이번 판 ${fmt(my.put)}</span>` : ""}</div>
        <div class="pk-made">${made}</div>
      </div>`;
  }

  /* ---------- 행동 버튼 · 안내 ---------- */
  function renderActions() {
    const v = m.v, my = v.my, ask = myAsk();
    const s = my ? v.seats[m.me] : null;
    const kinds = ask && my ? my.kinds : [];
    R("dock").classList.toggle("pk-act", !!ask);
    R("dock").classList.toggle("pk-raising", panel);
    R("acts").hidden = panel;
    R("raise").hidden = !panel;
    const fold = R("fold"), call = R("call"), raise = R("raiseBtn");
    const toCall = my ? my.toCall : 0, callAmt = my ? my.callAmt : 0;
    const callAll = my && toCall > 0 && callAmt >= my.chips && my.chips > 0;
    fold.textContent = armed === "fold" ? "정말 폴드?" : "폴드";
    fold.classList.toggle("danger", armed === "fold");
    call.textContent = toCall > 0 ? (callAll ? (armed === "call" ? `올인 콜 확인` : `올인 콜 ${fmt(callAmt)}`) : `콜 ${fmt(callAmt)}`) : "체크";
    call.classList.toggle("danger", armed === "call");
    raise.textContent = ask && my && my.canRaise && my.minTo >= my.maxTo ? "올인" : v.phase === "bet" && v.curBet === 0 ? "벳" : "레이즈";
    fold.disabled = !kinds.includes("fold");
    call.disabled = !(kinds.includes("call") || kinds.includes("check"));
    raise.disabled = !kinds.includes("raise");

    let hint;
    if (v.phase === "over") hint = "게임 끝";
    else if (!my || !s || s.out) hint = s && s.out ? "탈락했습니다 — 끝까지 구경할 수 있어요" : "구경 중";
    else if (v.phase === "start") hint = "카드를 섞는 중…";
    else if (v.phase === "end") hint = "다음 판을 준비하는 중…";
    else if (ask) {
      const t = `<span class="pk-tm" data-tm="${m.me}"></span>`;
      hint = toCall > 0
        ? `<b>내 차례</b> — 콜 ${fmt(callAmt)} · 팟 ${fmt(v.potTotal)} <small>(팟 대비 ${Math.round(100 * callAmt / (v.potTotal + callAmt))}%)</small> ${t}`
        : `<b>내 차례</b> — 체크하거나 ${v.curBet === 0 ? "벳" : "레이즈"}하세요 ${t}`;
    } else if (s.fold) hint = "폴드했습니다 — 이번 판은 구경";
    else if (s.allin) hint = "올인! 결과를 기다리는 중";
    else if (v.turn >= 0) hint = `${esc(names()[v.turn])} 님 차례${toCall > 0 ? ` · 내가 낼 칩 <b>${fmt(callAmt)}</b>` : ""}`;
    else hint = v.runout ? "올인 — 남은 카드를 펼치는 중" : "다음 카드를 펼치는 중";
    R("hint").innerHTML = hint;
    if (panel) renderPanel();
  }

  /* ---------- 레이즈 판 ---------- */
  function quick() {
    const v = m.v, my = v.my, potAfter = v.potTotal + my.callAmt;
    const clamp = x => Math.max(my.minTo, Math.min(my.maxTo, Math.round(x / v.sb) * v.sb));
    return [["최소", my.minTo], ["½ 팟", clamp(v.curBet + potAfter / 2)], ["팟", clamp(v.curBet + potAfter)], ["올인", my.maxTo]];
  }
  function setAmt(x) {
    const v = m.v, my = v.my;
    if (x >= my.maxTo) amt = my.maxTo;
    else amt = Math.max(my.minTo, Math.min(my.maxTo, x));
    renderPanel();
  }
  function renderPanel() {
    const v = m.v, my = v.my;
    if (!my) return;
    const sl = R("slider");
    sl.min = my.minTo; sl.max = my.maxTo; sl.step = 1; sl.value = amt;
    sl.disabled = my.minTo >= my.maxTo;
    const all = amt >= my.maxTo, word = v.curBet === 0 ? "벳" : "레이즈";
    R("rlabel").innerHTML = all ? "올인 <small>(가진 칩 전부)</small>" : `${word} <small>이번 거리 총액 · 칩 ${fmt(amt - my.bet)} 더 냄</small>`;
    R("ramt").textContent = fmt(amt);
    const ok = R("rok");
    ok.textContent = all ? `올인 ${fmt(amt)} 확인` : `${word} ${fmt(amt)} 확인`;
    ok.classList.toggle("pk-allok", all);
    const q = R("quick");
    q.innerHTML = "";
    for (const [t, x] of quick()) {
      const b = el("button", "pk-qb" + (x === amt ? " on" : ""), `${t}<small>${fmt(x)}</small>`);
      b.onclick = () => setAmt(x);
      q.appendChild(b);
    }
  }
  R("slider").addEventListener("input", e => {
    const v = m.v, my = v.my;
    let x = +e.target.value;
    if (x < my.maxTo) x = Math.round(x / v.sb) * v.sb;
    setAmt(Math.max(my.minTo, x));
  });
  R("minus").onclick = () => setAmt(amt - m.v.bb);
  R("plus").onclick = () => setAmt(amt + m.v.bb);
  R("rcancel").onclick = () => { panel = false; renderActions(); };
  R("rok").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    send(amt >= my.maxTo ? { a: "allin" } : { a: "raise", to: amt });
  };

  function arm(k) {
    armed = k;
    clearTimeout(armT);
    armT = setTimeout(() => { armed = ""; if (m) renderActions(); }, 2500);
    ctx.buzz(20);
    renderActions();
  }
  function send(a) {
    if (!ctx.send(a)) return;
    busy = true; panel = false; armed = "";
    clearTimeout(busyT);
    busyT = setTimeout(() => { busy = false; if (m) renderActions(); }, 1500);   // 거절되면 다시 누를 수 있게
    if (a.a === "fold") ctx.sound.pass(); else if (a.a === "check") ctx.sound.tick(); else ctx.sound.chip();
    renderActions();
  }
  R("fold").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    if (my.toCall === 0 && armed !== "fold") return arm("fold");      // 공짜로 볼 수 있는데 폴드?
    send({ a: "fold" });
  };
  R("call").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk()) return;
    if (my.toCall === 0) return send({ a: "check" });
    if (my.callAmt >= my.chips && armed !== "call") return arm("call");  // 올인 콜은 한 번 더
    send({ a: "call" });
  };
  R("raiseBtn").onclick = () => {
    const my = m && m.v.my;
    if (!my || !myAsk() || !my.canRaise) return;
    panel = true; armed = "";
    amt = my.minTo;
    renderActions();
  };

  /* ---------- 소리 · 애니메이션 ---------- */
  function effects(evs) {
    pops = new Set();
    let chip = false, deal = false, flip = false, pass = false, tick = false, good = false, bad = false;
    for (const e of evs) {
      if (e.type === "act") {
        if (e.a !== "fold" && e.a !== "check") pops.add(e.p);
        if (e.p === m.me) continue;                     // 내 행동 소리는 누를 때 이미 냈다
        if (e.a === "fold") pass = true; else if (e.a === "check") tick = true; else chip = true;
      } else if (e.type === "hand") { deal = true; pops.add("deal"); }
      else if (e.type === "street" || e.type === "reveal" || e.type === "show") flip = true;
      else if (e.type === "win") { if (e.p === m.me) good = true; else chip = true; }
      else if (e.type === "bust" && e.p === m.me) bad = true;
      else if (e.type === "refund") chip = true;
    }
    if (bad) { ctx.sound.bad(); ctx.buzz(120); }
    else if (good) ctx.sound.good();
    else if (flip) ctx.sound.flip();
    else if (chip) ctx.sound.chip();
    else if (pass) ctx.sound.pass();
    else if (tick) ctx.sound.tick();
    if (deal) { ctx.sound.deal(); setTimeout(() => ctx.sound.deal(), 130); setTimeout(() => ctx.sound.deal(), 260); }
  }

  /* 차례인 사람의 남은 시간 */
  function startTick() {
    clearInterval(tickT);
    const v = m.v;
    if (v.turn < 0) return;
    const pe = m.pending.find(a => a.p === v.turn);
    const end = pe && pe.ms > 0 ? Date.now() + pe.ms : 0;
    const paint = () => {
      for (const t of wrap.querySelectorAll(`[data-tm="${v.turn}"]`)) {
        if (!end) { t.textContent = v.turn === m.me ? "" : "생각 중…"; continue; }
        const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        t.textContent = `⏱ ${s}초`;
        t.classList.toggle("low", s <= 5);
      }
    };
    paint();
    if (end) tickT = setInterval(paint, 500);
  }

  function update(msg) {
    m = msg;
    const ask = ctx.myAsk("bet");
    const id = ask ? ask.id : 0;
    if (id !== askId) { askId = id; panel = false; armed = ""; busy = false; clearTimeout(busyT); }
    effects(msg.ev || []);
    renderOpps();
    renderTable();
    renderMe();
    renderActions();
    startTick();
  }

  return {
    update,
    destroy() { clearInterval(tickT); clearTimeout(busyT); clearTimeout(armT); root.innerHTML = ""; }
  };
}
