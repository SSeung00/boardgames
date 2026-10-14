/* 원카드 화면
   위: 상대 줄 — 차례 순서대로(나 › … › 나) 화살표 · 남은 장 수 · 마지막 행동 · 파산 위험 · 「다음」
   가운데: 더미(남은 장 수) · 맨 위 카드 · 「지금 낼 수 있는 것」 안내(무늬 지정 · 공격 누적 · 막는 법) · 최근 낸 카드 줄
   아래: 내 요약(장 수 · 낼 수 있는 카드 · 파산까지) · 안내 · 내 패(많으면 두 줄) · 버튼
   크기는 화면 높이를 재서 정한다 — 남는 높이는 카드를 키우는 데 쓴다 (빈 공간 없이) */
import { cardHTML, cardName, isJoker, rankOf, suitOf, rankLabel, SUITS, SUIT_SYMBOL, SUIT_NAME } from "../../core/cards.js";

const NEED_SYM = { S: "♠", H: "♥", D: "♦", C: "♣", B: "♠♣", R: "♥♦" };
const REDS = { H: 1, D: 1, R: 1 };
const AV_COLORS = ["#c9774a", "#5f9e6e", "#5b84c4", "#b05f9a", "#c4a24a", "#4aa3a8", "#8a6fc4", "#c45b5b", "#7a8a5a", "#a87a4a"];   // core/ui.js 와 같은 순서
/* 공격 값 (엔진과 같은 규칙 — 안내 문장용) */
const power = c => (c === "JB" ? 5 : c === "JC" ? 7 : rankOf(c) === 2 ? 2 : rankOf(c) === 1 ? (c === "S1" ? 5 : 3) : 0);

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "oc");
  wrap.innerHTML = `
    <div class="oc-opps" data-r="opps"></div>
    <div class="oc-table felt" data-r="table">
      <div class="oc-row">
        <button class="oc-deck" data-r="deck" aria-label="카드 받기"></button>
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
        <button class="btn" data-r="draw">1장 받기</button>
        <button class="btn primary" data-r="play" disabled>내기</button>
      </div>
    </div>
    <div class="oc-call" data-r="call" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;              // 마지막으로 받은 msg
  let sel = null;            // 고른 카드
  let busyUntil = 0, busyAsk = 0;   // 보낸 직후 같은 질문에 두 번 보내기 막기 (거절되면 잠시 뒤 풀린다)
  let fresh = [];            // 방금 받은 카드 — 반짝 표시
  let topIn = false;         // 버린 카드 맨 위가 막 바뀌었다
  let hot = -1;              // 방금 행동한 사람 — 이름표 반짝
  let cdT = 0, flashT = 0, busyT = 0, cdAsk = 0, cdEnd = 0, cdTotal = 1;
  let log = [], logEv = null;   // 진행 기록 (위쪽 한 줄 기록 대신 판 안에 — 최근 것이 위)
  let geo = { cw: 64, ch: 91, rows: 1, gap: 0, lift: 14 };   // 내 패 크기 (fit 이 정한다)

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

  /* 작은 카드 (숫자 위 · 무늬 아래) — 상대 줄 · 최근 줄 */
  function mini(c, cls = "") {
    if (isJoker(c)) return `<span class="oc-mc jk${c === "JC" ? " red" : ""} ${cls}"><b>🃏</b><i>${c === "JC" ? "컬러" : "흑백"}</i></span>`;
    return `<span class="oc-mc${REDS[suitOf(c)] ? " red" : ""} ${cls}"><b>${rankLabel(rankOf(c))}</b><i>${SUIT_SYMBOL[suitOf(c)]}</i></span>`;
  }

  /* ---------- 규칙 계산: 지금 무엇으로 맞추거나 막을 수 있나 ---------- */
  function defendText(v) {
    const t = v.top;
    if (t === "JC") return "컬러 조커는 막을 수 없어요";
    if (t === "JB") return "컬러 조커로만 막아요";
    const s = suitOf(t), r = rankOf(t);
    if (r === 2) return `2 · ${sym(s)}A · 조커${v.set.three ? ` · ${sym(s)}3 막기` : ""}`;
    if (t === "S1") return "조커로만 막아요";
    return "A · 조커";
  }
  function matchText(v) {
    if (v.need) return `${sym(v.need)} 만 · 조커`;
    return `${sym(suitOf(v.top))} 또는 <b>${rankLabel(rankOf(v.top))}</b> · 조커`;
  }
  function whyNot(v) {
    if (v.attack > 0) return `공격 +${v.attack} — 막을 수 있는 공격 카드만 낼 수 있어요`;
    if (v.need) return `지금은 ${NEED_SYM[v.need]} 무늬나 조커만 낼 수 있어요`;
    return "맨 위 카드와 무늬나 숫자가 같아야 해요";
  }

  /* ---------- 상대 줄: 나 › A › B › C › 나 (거꾸로면 ‹) ---------- */
  function opps() {
    const m = M, v = m.v, box = R("opps"), n = v.st.length, me = m.me;
    const playing = v.phase === "play";
    const nx = playing ? (v.call ? v.turn : nextOf(v, v.turn)) : -1;   // 원카드 창 중에는 창이 닫히면 낼 사람
    const order = [];
    for (let k = 1; k < n; k++) order.push((me + k) % n);
    const seq = [me, ...order, me];                       // 화살표 k 는 seq[k] 와 seq[k+1] 사이
    const fw = v.dir > 0;
    // 지금 차례인 사람에서 다음 사람으로 가는 화살표에 불을 켠다
    let liveArr = -1;
    if (playing && !v.call) for (let k = 0; k < seq.length - 1; k++) if ((fw ? seq[k] : seq[k + 1]) === v.turn) { liveArr = k; break; }
    const arr = k => `<span class="oc-arr${k === liveArr ? " on" : ""}">${fw ? "›" : "‹"}</span>`;
    const bust = v.set.bust;
    let h = `<span class="oc-cap${liveArr === 0 ? " on" : ""}"><i>나</i>${fw ? "›" : "‹"}</span>`;
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
      if (st === "done") cnt = `<span class="oc-place">🏁 ${v.place[p]}등</span>`;
      else if (st === "bust") cnt = `<span class="oc-place bad">💥 파산</span>`;
      else {
        if (c <= 2) cls.push(c === 1 ? "one" : "two");
        cnt = `<b>${c}</b><small>${c === 1 ? "장!" : "장"}</small>`;
      }
      if (st === "in" && bust) {
        const left = bust - c;
        warn = left <= 4 ? `<span class="oc-risk">파산까지 ${left}</span>`
          : `<span class="oc-bar"><i style="width:${Math.min(100, 100 * c / bust)}%"></i></span>`;
        if (left <= 4) cls.push("risk");
      }
      const a = v.act && v.act[p];
      const last = !a ? '<span class="oc-mc none"></span>' : a.c ? mini(a.c) :
        `<span class="oc-took${a.pen ? " pen" : ""}">+${a.d}</span>`;
      const tag = pl.kind === "ai" ? '<span class="oc-ai">AI</span>' : pl.kind === "away" ? '<span class="oc-ai away">비움</span>' : "";
      const badge = turn ? '<em class="oc-tag now">차례</em>' : p === nx && playing ? '<em class="oc-tag">다음</em>' : "";
      h += `<div class="${cls.join(" ")}">${badge}
        <div class="oc-oh">${avatarHTML(pl.name, p, "sm")}${last}</div>
        <div class="oc-on">${esc(pl.name)}${tag}</div>
        <div class="oc-oc">${cnt}</div>${warn}</div>`;
      if (i < order.length - 1) h += arr(i + 1);
    });
    h += `<span class="oc-cap${liveArr === seq.length - 2 ? " on" : ""}">${fw ? "›" : "‹"}<i>나</i></span>`;
    box.innerHTML = h;
    box.classList.toggle("many", order.length >= 4);
  }

  /* ---------- 가운데 ---------- */
  function table() {
    const m = M, v = m.v, mine = myPlay();
    // 더미
    const deck = R("deck");
    const label = mine ? (v.attack > 0 ? `${v.attack}장 받기` : v.again ? "받고 끝내기" : "1장 받기") : `더미`;
    deck.innerHTML = (v.deck ? `<span class="oc-stack">${cardHTML(null)}</span>` : '<span class="oc-empty">비었음</span>') +
      `<span class="oc-cnt">${v.deck}</span><span class="oc-dlabel">${label}</span>`;
    deck.classList.toggle("can", mine && !busy());
    deck.classList.toggle("atk", mine && v.attack > 0);
    deck.disabled = !mine;
    deck.setAttribute("aria-label", mine ? label : `더미 ${v.deck}장`);

    // 버린 카드 (밑 두 장은 비스듬히)
    R("pile").innerHTML = v.under.slice(-2).map(c => `<div class="oc-under" style="--r:${tilt(c)}deg">${cardHTML(c)}</div>`).join("") +
      `<div class="oc-top${topIn ? " in" : ""}${v.attack > 0 ? " hot" : ""}">${cardHTML(v.top)}</div>`;
    topIn = false;

    // 지금 낼 수 있는 것 — 공격 누적 · 무늬 지정 · K · 평소
    let h;
    if (v.phase !== "play") h = `<div class="oc-i-big">끝</div><div class="oc-i-sub">게임 끝</div>`;
    else if (v.attack > 0) h = `<div class="oc-i-lbl">공격 누적</div><div class="oc-i-big atk">+${v.attack}</div><div class="oc-i-sub">막기: ${defendText(v)}</div>`;
    else if (v.need) h = `<div class="oc-i-lbl">${isJoker(v.top) ? "조커 — 무늬 지정" : "7 — 무늬 바뀜"}</div><div class="oc-i-big suit${REDS[v.need] ? " red" : ""}">${NEED_SYM[v.need]}</div><div class="oc-i-sub">${NEED_SYM[v.need].length > 1 ? "두 무늬 중 하나" : SUIT_NAME[v.need]}만 · 조커 가능</div>`;
    else h = `<div class="oc-i-lbl">맞출 것</div><div class="oc-i-big match">${sym(suitOf(v.top))}<small>또는</small>${rankLabel(rankOf(v.top))}</div><div class="oc-i-sub">무늬나 숫자 · 조커</div>`;
    if (v.again && v.phase === "play") h += '<div class="oc-i-k">K — 한 장 더</div>';
    const info = R("info");
    info.innerHTML = h;
    info.className = "oc-info" + (v.attack > 0 ? " atk" : v.need ? " need" : "");

    // 최근에 낸 카드 (오래된 것 → 최근)
    const rec = (v.recent || []).slice(-5);
    R("recent").innerHTML = rec.length ? `<span class="oc-rl">최근</span>` + rec.map((r, i) =>
      `<span class="oc-ri${i === rec.length - 1 ? " now" : ""}">${mini(r.c)}${r.s ? `<em class="${REDS[r.s] ? "red" : ""}">→${SUIT_SYMBOL[r.s]}</em>` : ""}` +
      (r.p < 0 ? '<span class="oc-who first">첫</span>' : `<span class="oc-who" style="--ac:${AV_COLORS[r.p % AV_COLORS.length]}">${initial(r.p)}</span>`) + `</span>`).join('<span class="oc-rarr">›</span>') : "";
    const lines = log.length ? log.slice(-5).reverse() : v.last ? [ctx.nameText(v.last)] : [];
    R("log").innerHTML = lines.map(t => `<div>${esc(t)}</div>`).join("");
  }

  /* ---------- 원카드 창 ---------- */
  function callBox() {
    const m = M, v = m.v, box = R("call");
    clearInterval(cdT);
    if (!v.call || v.phase !== "play") { box.hidden = true; box.innerHTML = ""; return; }
    const owner = v.call.p, mine = owner === m.me, ask = ctx.myAsk("call");
    box.hidden = false;
    box.style.top = R("opps").offsetHeight + "px";
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

  /* ---------- 내 요약 한 줄 ---------- */
  function meLine() {
    const m = M, v = m.v, me = m.me, mine = myPlay(), st = v.st[me], n = v.hand.length;
    const chips = [];
    if (st === "done") chips.push(`<span class="oc-chip good">🏁 ${v.place[me]}등</span>`);
    else if (st === "bust") chips.push('<span class="oc-chip bad">💥 파산</span>');
    else {
      chips.push(`<span class="oc-chip${n <= 2 ? " good" : ""}">내 패 <b>${n}</b>장</span>`);
      if (mine) {
        const k = v.legal.length;
        if (v.attack > 0) chips.push(k ? `<span class="oc-chip ok">막을 카드 <b>${k}</b>장</span>` : `<span class="oc-chip bad">막을 카드 없음</span>`);
        else chips.push(k ? `<span class="oc-chip ok">낼 수 있음 <b>${k}</b>장</span>` : `<span class="oc-chip bad">낼 카드 없음</span>`);
      } else if (v.phase === "play" && !v.call && nextOf(v, v.turn) === me) chips.push('<span class="oc-chip gold">다음이 내 차례</span>');
      if (v.set.bust) {
        const left = v.set.bust - n;
        chips.push(`<span class="oc-chip${left <= 4 ? " bad" : " dim"}">파산까지 <b>${left}</b></span>`);
      }
    }
    R("me").innerHTML = chips.join("");
  }

  /* ---------- 내 패 ---------- */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 4 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  /* 쓸 수 있는 높이 budget 안에서 가장 크게: 줄 수 · 카드 크기 */
  function handGeo(n, W, budget, cwMax) {
    const lift = 14, K = .4;                              // 겹친 카드도 폭의 40% (최소 30px) 는 보이게
    let best = null;
    for (let rows = 1; rows <= 4; rows++) {
      const per = Math.ceil(n / rows);
      const byH = (budget - lift) / (1 + .56 * (rows - 1)) / 1.42;
      const byW = per > 1 ? Math.min(W / (1 + K * (per - 1)), W - 4 - 30 * (per - 1)) : W;
      const cw = Math.max(36, Math.floor(Math.min(cwMax, byH, byW)));
      // 줄을 늘려 카드가 12% 넘게 커질 때만 줄을 늘린다
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
    if (!n) return;                                       // 다 냈거나 파산 — 패 자리는 접는다 (요약 · 안내 줄에 표시)
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
        b.setAttribute("aria-label", cardName(c) + (can ? " (낼 수 있음)" : ""));
        b.onclick = () => tap(c);
        box.appendChild(b);
      });
    });
  }

  /* ---------- 크기 맞추기: 화면 높이를 나눠 갖는다 ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth;
    if (!H || !W) { geo = handGeo(v.hand.length || 1, W || 340, 120, 60); return; }
    wrap.classList.toggle("tall", H >= 700);
    wrap.classList.toggle("short", H < 600);
    const hb = R("hand"), table = R("table");
    hb.style.height = "0px";
    const fixed = R("opps").offsetHeight + R("dock").offsetHeight + 8;   // 판 바깥 여백 포함
    const rest = Math.max(160, H - fixed);
    const hw = hb.clientWidth || W - 20;
    const n = v.hand.length;
    const cwMax = Math.min(hw / 3.4, Math.max(66, rest * .17));
    const feltMin = Math.max(150, rest * .36);
    if (n) {
      geo = handGeo(n, hw, Math.max(90, Math.min(rest * .6, rest - feltMin)), cwMax);
      hb.style.height = geo.h + "px";
    } else hb.style.height = "0px";
    // 판: 남은 높이로 맨 위 카드 · 최근 줄 크기를 정한다
    const fh = table.clientHeight, fw = table.clientWidth;
    const mw = Math.round(Math.max(22, Math.min(44, fh * .1, (fw - 80) / 5.6)));
    const recentH = mw * 1.38 + 20;
    const LH = 18;                                        // 기록 한 줄 높이
    let tc = Math.min(fh - recentH - (fh > 230 ? LH : 0) - 30, 230, (fw - 150) / (0.7 + .56));   // 맨 위 카드 높이 (더미는 0.8배)
    tc = Math.max(64, Math.floor(tc));
    table.style.setProperty("--tc", tc + "px");
    table.style.setProperty("--mw", mw + "px");
    // 남는 높이만큼 진행 기록 줄을 보여 준다 (최대 5줄)
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
      const ok = await ctx.choose("공격 받기", `막을 수 있는 카드가 <b>${v.legal.length}장</b> 있습니다. 그래도 <b>${v.attack}장</b>을 받을까요?`,
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
    d.textContent = mine && v.attack > 0 ? `${v.attack}장 받기` : mine && v.again ? "1장 받고 끝내기" : "1장 받기";
    d.classList.toggle("danger", mine && v.attack > 0);
    d.disabled = !mine || busy();
    p.disabled = !mine || busy() || !sel || !v.legal.includes(sel);
    p.textContent = sel ? `${cardName(sel)} 내기` : "내기";
  }
  function hint() {
    const m = M, v = m.v, me = m.me, h = R("hint");
    const nm = names();
    let t, cls = "hint";
    if (v.phase === "over") t = "게임 끝";
    else if (v.call) t = v.call.p === me ? "<b>원카드!</b> 버튼을 눌러 외치세요" : `<b>${esc(nm[v.call.p])}</b> 님이 한 장 — 먼저 누르면 잡아요!`;
    else if (myPlay()) {
      if (v.attack > 0) {
        cls += " oc-alert";
        t = v.legal.length ? `<b>공격 +${v.attack}</b> — 막기: ${v.legal.map(c => esc(cardName(c))).join(" · ")} (아니면 ${v.attack}장 받기)`
          : `막을 카드가 없습니다 — <b>${v.attack}장</b>을 받으세요`;
      }
      else if (!v.legal.length) t = v.again ? "이어서 낼 카드가 없습니다 — 1장 받고 끝내세요" : "낼 카드가 없습니다 — <b>1장 받기</b>";
      else if (sel) t = `<b>${esc(cardName(sel))}</b> — 한 번 더 누르거나 「내기」`;
      else t = v.again ? "<b>K</b> — 한 장 더 내세요 (없으면 1장 받기)" : `<b>내 차례</b> — 초록 테두리 카드를 누르세요`;
    }
    else if (v.st[me] === "done") t = `카드를 다 냈습니다 — ${v.place[me]}등 🎉`;
    else if (v.st[me] === "bust") t = "파산 — 구경 중";
    else t = `${esc(nm[v.turn] || "")} 님 차례` + (v.attack > 0 ? ` · <b>공격 +${v.attack}</b>` : "");
    h.className = cls;
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
        topIn = true; hot = e.p;
        if (e.block) { want("good", 3); flash("🛡️ 공격을 막았다!", "good"); }
        else if (e.attack) {
          if (v.phase === "play" && v.turn === me && v.attack > 0) { want("bad", 4); ctx.buzz([90, 50, 90]); flash(`공격 +${v.attack}!`, "bad"); }
          else want("chip", 2);
        } else if (e.reverse) { want("pass", 2); flash(v.dir > 0 ? "› 방향 바뀜 (순서대로)" : "‹ 방향 바뀜 (거꾸로)"); }
        else if (e.skip === me) { want("pass", 3); flash("건너뜀 ⏭️", "bad"); }
        else if (e.suit) { want("place", 2); flash(`무늬 → ${SUIT_SYMBOL[e.suit]} ${SUIT_NAME[e.suit]}`, REDS[e.suit] ? "red" : "gold"); }
        else want("place", 1);
        if (e.p === me) fresh = [];
      } else if (e.type === "draw") {
        hot = e.p;
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
    opps(); table(); meLine(); hint(); buttons();
    fit();
    hand(); callBox();
  }
  function update(m) {
    const again = m === M || m.ev === logEv;             // 같은 msg 로 다시 불려도 기록 · 소리는 한 번만
    M = m;
    if (again) { render(); return; }
    logEv = m.ev;
    for (const e of m.ev) if (e.text) log.push(ctx.nameText(e.text));
    if (log.length > 12) log.splice(0, log.length - 12);
    hot = -1;
    events(m);
    render();
  }

  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,           // 최근 낸 카드 줄 · 마지막 행동 배지가 진행 기록을 대신한다
    destroy() {
      window.removeEventListener("resize", onResize);
      clearInterval(cdT); clearTimeout(flashT); clearTimeout(busyT);
      root.innerHTML = "";
    }
  };
}
