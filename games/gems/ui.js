/* 보석 상인 화면
   위(판): 상대 줄 · 귀인 · 카드 3줄(3단계가 맨 위, 줄마다 더미 + 4장) · 은행 보석 6가지
   아래(dock): 안내 · 내 점수 · 보너스/보석 · 찜 카드 · (보석 고르는 중이면) 취소/가져오기, 아니면 방금 일어난 일.
   카드를 누르면 아래에서 올라오는 창에서 「사기」 · 「찜하기」, 은행 보석을 누르면 골라 담고 「가져오기」. */
import { COLORS, ALL, CNAME, payFor } from "./engine.js";

const ROMAN = ["", "Ⅰ", "Ⅱ", "Ⅲ"];
const tokSum = t => ALL.reduce((a, c) => a + (t[c] || 0), 0);
const qualifies = (bon, N) => COLORS.every(c => (bon[c] || 0) >= N.req[c]);

/* 카드 한 장 (view 의 카드 객체 또는 {t, hidden}) */
function cardHTML(C, extra = "") {
  if (!C) return `<div class="gm-card gm-none ${extra}"></div>`;
  if (C.hidden) return `<div class="gm-card gm-back t${C.t} ${extra}"><b>${ROMAN[C.t]}</b><small>비공개</small></div>`;
  const cost = COLORS.filter(c => C.cost[c] > 0).map(c => `<i class="gm-dot gm-${c}">${C.cost[c]}</i>`).join("");
  return `<div class="gm-card gm-${C.c} t${C.t}${C.blind ? " blind" : ""} ${extra}">` +
    `<span class="gm-pt">${C.pt || ""}</span><span class="gm-gem gm-${C.c}"><i></i></span>` +
    `<span class="gm-art gm-${C.c}"></span><span class="gm-cost">${cost}</span>` +
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
      <div class="gm-seats" data-r="seats"></div>
      <div class="gm-nobles" data-r="nobles"></div>
      <div class="gm-rows" data-r="rows"></div>
      <div class="gm-bank" data-r="bank"></div>
    </div>
    <div class="dock gm-dock">
      <div class="hint" data-r="hint"></div>
      <div class="gm-me" data-r="me"></div>
      <div class="gm-foot" data-r="foot"></div>
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
    drawSeats(); drawNobles(); drawRows(); drawBank(); drawDock();
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

  /* 상대들: 내 다음 사람부터 차례 순서대로 */
  function drawSeats() {
    const v = M.v, box = R("seats");
    box.innerHTML = "";
    const n = v.players.length;
    for (let k = 1; k < n; k++) {
      const q = (M.me + k) % n, P = v.players[q], pl = M.players[q] || { name: "?" };
      const chip = el("button", "seatchip gm-seat" + (q === v.turn && v.phase === "play" ? " turn" : ""));
      chip.innerHTML = `<span class="gm-av">${avatarHTML(pl.name, q, "sm")}` +
        (pl.kind === "ai" ? '<span class="ai">AI</span>' : pl.kind === "away" ? '<span class="away">비움</span>' : "") + `</span>` +
        `<span class="gm-st"><span class="nm">${esc(pl.name)}</span>` +
        `<span class="gm-minis"><i class="gm-mi pt">${P.pts}</i><i class="gm-mi cd">${P.ncards}</i><i class="gm-mi tk">${tokSum(P.tok)}</i>` +
        (P.res.length ? `<i class="gm-mi rs">${P.res.length}</i>` : "") + `</span></span>` +
        (q === v.start ? '<i class="gm-first" title="첫 차례">선</i>' : "") + didHTML(q);
      chip.setAttribute("aria-label", `${pl.name} ${P.pts}점, 카드 ${P.ncards}장, 보석 ${tokSum(P.tok)}개`);
      chip.onclick = () => openPlayer(q);
      box.appendChild(chip);
    }
  }
  /* 방금 행동한 사람의 이름표에 붙는 작은 말풍선 */
  function didHTML(q) {
    const L = M.v.last;
    if (!L || L.p !== q || q === M.me || M.v.phase !== "play") return "";
    let t = "";
    if (L.type === "take") t = pips(L.take);
    else if (L.type === "buy") t = `구매${L.cv && L.cv.pt ? ` +${L.cv.pt}` : ""}`;
    else if (L.type === "reserve" || L.type === "reserveDeck") t = "찜";
    else if (L.type === "pass") t = "넘김";
    if (L.noble !== undefined) t += " 👑";
    return t ? `<span class="gm-did">${t}</span>` : "";
  }

  function drawNobles() {
    const v = M.v, box = R("nobles"), P = v.players[M.me];
    box.innerHTML = "";
    for (const N of v.nobles) {
      const rem = COLORS.reduce((a, c) => a + Math.max(0, N.req[c] - P.bon[c]), 0);
      const reqs = COLORS.filter(c => N.req[c]).map(c => `<i class="gm-bon gm-${c}${P.bon[c] >= N.req[c] ? " ok" : ""}">${N.req[c]}</i>`).join("");
      const b = el("button", "gm-noble" + (rem <= 2 ? " near" : ""), `<b>3</b><span class="gm-req">${reqs}</span>`);
      b.setAttribute("aria-label", `귀인 ${N.name}`);
      b.onclick = () => openNoble(N.id);
      box.appendChild(b);
    }
    const info = el("div", "gm-info");
    info.innerHTML = (v.final ? '<span class="gm-final">마지막 바퀴</span>' : `<span>${v.round}바퀴째</span>`) +
      `<span>목표 <b>${v.goal}</b>점</span>`;
    box.appendChild(info);
  }

  function drawRows() {
    const v = M.v, box = R("rows"), P = v.players[M.me], mine = myTurn();
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
        const can = mine && payFor(P.tok, P.bon, C);
        const cls = (can ? "can" : "") + (v.fresh.includes(C.id) ? " fresh" : "") + (pop.has(C.id) ? " pop" : "");
        const b = el("button", "gm-cbtn", cardHTML(C, cls));
        b.setAttribute("aria-label", `${t}단계 ${CNAME[C.c]} 카드 ${C.pt}점`);
        b.setAttribute("data-id", C.id);
        b.onclick = () => openCard(C.id);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
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
    // 안내
    let h;
    if (v.phase === "over") h = "게임 끝";
    else if (ask && ask.kind === "discard") h = `<b>보석이 10개를 넘었습니다</b> — 돌려놓을 보석을 고르세요`;
    else if (ask && ask.kind === "noble") h = `<b>귀인 여럿이 찾아왔습니다</b> — 한 명을 고르세요`;
    else if (ask) {
      const ck = selCheck();
      if (!Object.keys(sel).length) h = v.final ? "<b>마지막 차례!</b> 점수를 최대한 올리세요" : "<b>내 차례</b> · 보석을 고르거나 카드를 누르세요";
      else {
        const after = tokSum(P.tok) + tokSum(sel);
        h = ck.msg + (after > 10 ? ` · 받으면 ${after}개 → <b>${after - 10}개 반납</b>` : "");
      }
    } else {
      const who = M.pending && M.pending[0] ? M.pending[0].p : v.turn;
      const doing = v.sub === "discard" ? " — 보석 돌려놓는 중" : v.sub === "noble" ? " — 귀인 고르는 중" : "";
      h = `<b>${esc(nameOf(who))}</b> 님 차례${doing}` + (v.final ? " · 마지막 바퀴" : "");
    }
    R("hint").innerHTML = h;

    // 내 상태: 점수 · 보너스/보석 · 찜
    const box = R("me");
    box.innerHTML = "";
    const turnNow = v.phase === "play" && v.turn === me;
    const nt = tokSum(P.tok);
    const score = el("button", "gm-score" + (turnNow ? " turn" : ""),
      `<b>${P.pts}</b><small>/${v.goal}점</small><i class="${nt > 10 ? "over" : ""}">보석${nt}</i>`);
    score.setAttribute("aria-label", `내 점수 ${P.pts}점, 보석 ${nt}개 — 눌러서 내 정보 보기`);
    score.onclick = () => openPlayer(me);
    box.appendChild(score);
    const cols = el("div", "gm-cols");
    for (const c of ALL) {
      const col = el("div", "gm-col" + (pulseMe[c] ? " pulse" : ""));
      col.innerHTML = (c === "y" ? `<i class="gm-bon gm-none">만능</i>` : `<i class="gm-bon gm-${c}${P.bon[c] ? "" : " zero"}">${P.bon[c]}</i>`) +
        chipHTML(c, P.tok[c], "sm" + (P.tok[c] ? "" : " zero"));
      cols.appendChild(col);
    }
    box.appendChild(cols);
    const res = el("div", "gm-myres");
    for (let i = 0; i < 3; i++) {
      const C = P.res[i];
      if (!C) { res.appendChild(el("span", "gm-rslot")); continue; }
      const can = ask && ask.kind === "turn" && payFor(P.tok, P.bon, C);
      const b = el("button", "gm-cbtn", cardHTML(C, "mini" + (can ? " can" : "")));
      b.setAttribute("aria-label", `찜한 ${C.t}단계 ${CNAME[C.c]} 카드`);
      b.setAttribute("data-id", C.id);
      b.onclick = () => openCard(C.id);
      res.appendChild(b);
    }
    box.appendChild(res);

    // 아래 줄: 고르는 중이면 버튼, 아니면 방금 일어난 일
    const foot = R("foot");
    foot.innerHTML = "";
    if (ask && ask.kind === "turn" && Object.keys(sel).length) {
      const ck = selCheck();
      foot.className = "gm-foot actions";
      const cancel = el("button", "btn", "취소");
      cancel.onclick = () => { sel = {}; ctx.sound.tick(); draw(); };
      const ok = el("button", "btn primary", `가져오기 <span class="gm-pips">${pips(sel)}</span>`);
      ok.disabled = !ck.ok;
      ok.onclick = () => {
        if (!selCheck().ok) return;
        const a = { take: { ...sel } };
        if (ctx.send(a)) { sel = {}; draw(); }
      };
      foot.append(cancel, ok);
    } else {
      foot.className = "gm-foot";
      foot.innerHTML = lastHTML();
    }
  }

  /* 방금 일어난 일 한 줄 */
  function lastHTML() {
    const L = M.v.last;
    if (!L) return `<div class="gm-last dim">${M.v.phase === "play" ? `${esc(nameOf(M.v.start))} 님부터 시작합니다` : ""}</div>`;
    const who = L.p === M.me ? "나" : esc(nameOf(L.p));
    let d = "";
    const cardTxt = cv => cv ? `${cv.t}단계 ${gemHTML(cv.c, "sm")}${CNAME[cv.c]}${cv.pt ? ` <b>${cv.pt}점</b>` : ""}` : "";
    if (L.type === "take") d = `보석 가져옴 ${pips(L.take)}`;
    else if (L.type === "buy") d = `${L.from === "res" ? "찜한 " : ""}${cardTxt(L.cv)} 카드 구매`;
    else if (L.type === "reserve") d = `${cardTxt(L.cv)} 카드 찜${L.gold ? ` + ${chipHTML("y", undefined, "xs")}` : ""}`;
    else if (L.type === "reserveDeck") d = `${L.tier}단계 더미에서 ${L.cv ? cardTxt(L.cv) + " 카드 " : ""}몰래 찜${L.gold ? ` + ${chipHTML("y", undefined, "xs")}` : ""}`;
    else if (L.type === "pass") d = "할 수 있는 게 없어 넘김";
    if (L.discard) d += ` · 돌려놓음 ${pips(L.discard)}`;
    if (L.noble !== undefined) d += " · 👑 귀인 방문";
    return `<div class="gm-last">${avatarHTML(L.p === M.me ? nameOf(M.me) : nameOf(L.p), L.p, "sm")}<span><b>${who}</b> ${d}</span></div>`;
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
      let rows = "", shortTot = 0;
      const shortBy = {};
      for (const c of COLORS) {
        if (!C.cost[c]) continue;
        const need = Math.max(0, C.cost[c] - P.bon[c]), use = Math.min(need, P.tok[c]), short = need - use;
        shortTot += short; if (short) shortBy[c] = short;
        rows += `<div class="gm-payrow"><i class="gm-dot gm-${c}">${C.cost[c]}</i>` +
          `<span class="gm-calc">${P.bon[c] ? `보너스 −${Math.min(P.bon[c], C.cost[c])}` : "보너스 없음"} → <b>${need}</b></span>` +
          `<span class="gm-with">${use ? `${chipHTML(c, undefined, "xs")}×${use}` : ""}${short ? ` ${chipHTML("y", undefined, "xs")}×${short}` : ""}${!need ? "공짜" : ""}</span></div>`;
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
      const P = M.v.players[M.me], total = tokSum(P.tok), need = total - 10;
      const d = {};
      for (const c of ALL) d[c] = 0;
      ctx.head(box, "보석 10개 초과", `보석 ${need}개를 돌려놓으세요`, `지금 ${total}개 — 10개까지만 가질 수 있습니다. 돌려놓은 보석은 은행으로 갑니다.`);
      const list = el("div", "gm-disc");
      box.appendChild(list);
      const left = el("div", "gm-dleft");
      box.appendChild(left);
      const btnRow = ctx.buttonRow(box, [
        { label: "많은 색부터", on: () => {
          for (const c of ALL) d[c] = 0;
          for (let i = 0; i < need; i++) {
            let best = null;
            for (const c of COLORS) if (P.tok[c] - d[c] > 0 && (!best || P.tok[c] - d[c] > P.tok[best] - d[best])) best = c;
            d[best || "y"]++;
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
        left.innerHTML = s === need ? `<b>${need}개</b> 다 골랐습니다 ${pips(d)}` : `<b>${need - s}개</b> 더 고르세요 ${pips(d)}`;
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
    destroy() { closeSheet(); if (sub) { const s = sub; sub = null; s.close(); } root.innerHTML = ""; }
  };
}
