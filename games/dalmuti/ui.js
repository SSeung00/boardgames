/* 달무티 화면 — 폰 세로 기준
   위: 이름표 격자(진행 순서) — 계급 문장 · 남은 장 수 · 점수 · 이번 판 마지막 행동(작은 카드) · 패스 · 빠져나간 순위
   가운데(펠트): 지금 판의 카드(크게) · 낸 사람 · 받아칠 조건 · 이번 판 기록(판이 끝나면 지움 — 공정 규칙)
                 자리 뽑기 · 세금 · 라운드 결과는 같은 자리에 겹쳐 보여 준다
   아래: 내 계급 · 점수 · 순위 한 줄 / 안내 / 숫자별로 묶은 내 패 / 「패스」 · 고른 묶음(장수 조절) · 「내기」
   혁명 질문 · 돌려줄 카드 고르기는 당사자에게만 창으로. 크기는 화면 높이를 재서 정한다 (빈 공간 없이). */

const JESTER = 13;
const CARD_NAMES = ["달무티", "대주교", "남작부인", "수녀원장", "기사", "재봉사", "석공", "요리사", "양치기", "채석공", "소작농", "농노"];
const cardName = r => r === JESTER ? "광대" : CARD_NAMES[r - 1];
const TITLE_NAMES = ["평민", "대달무티", "소달무티", "상인", "소농노", "대농노"];
const TITLE_SHORT = ["평민", "대달", "소달", "상인", "소농", "대농"];
const TITLE_COLOR = ["#a39784", "#e2bd68", "#c3ccd8", "#9cc39a", "#c48c68", "#b5525c"];
const RANK_COLOR = {
  1: "#7d1128", 2: "#5b3a8c", 3: "#a8325e", 4: "#2a6a86", 5: "#33506e", 6: "#1c6f55",
  7: "#6b6257", 8: "#a9591f", 9: "#6f8a33", 10: "#4c5a66", 11: "#8a7320", 12: "#55663a", 13: "#9d1040"
};
const GLYPH = {
  1: '<path d="M4 8l3.6 3.6L12 4l4.4 7.6L20 8l-1.7 9H5.7z"/><rect x="5.4" y="18.2" width="13.2" height="2.4" rx=".7"/>',
  2: '<path d="M12 3c2.6 3.3 4.2 6.9 4.2 10.5V20H7.8v-6.5C7.8 9.9 9.4 6.3 12 3z"/>',
  3: '<path d="M12 3c1.6 1.4 2.4 3 2.4 4.6 0 1.5-.8 2.6-2.4 4-1.6-1.4-2.4-2.5-2.4-4C9.6 6 10.4 4.4 12 3z"/><path d="M12 11.6c2.6-2.4 5.4-1.6 5.4 1.2 0 1.8-1.8 3-5.4 3s-5.4-1.2-5.4-3c0-2.8 2.8-3.6 5.4-1.2z"/><rect x="11" y="15.6" width="2" height="5" rx=".6"/>',
  4: '<path d="M7 4h10v2.6a5 5 0 0 1-4 4.9V17h3.2v3H7.8v-3H11v-5.5a5 5 0 0 1-4-4.9z"/>',
  5: '<path d="M11 3h2v10.6h-2z"/><path d="M7.4 13.6h9.2v2H7.4z"/><path d="M11 15.6h2v4.2h-2z"/><circle cx="12" cy="20.6" r="1.4"/>',
  6: '<rect x="7.8" y="3.6" width="8.4" height="2.2" rx=".7"/><rect x="9.6" y="5.8" width="4.8" height="12.4" rx=".6"/><rect x="7.8" y="18.2" width="8.4" height="2.2" rx=".7"/>',
  7: '<rect x="3" y="5" width="18" height="4.2" rx=".6"/><rect x="3" y="10" width="8.4" height="4.2" rx=".6"/><rect x="12.6" y="10" width="8.4" height="4.2" rx=".6"/><rect x="3" y="15" width="18" height="4.2" rx=".6"/>',
  8: '<path d="M4 9.2h16v5.3A5.5 5.5 0 0 1 14.5 20h-5A5.5 5.5 0 0 1 4 14.5z"/><rect x="3" y="6.6" width="18" height="2.1" rx=".8"/><rect x="11" y="3.6" width="2" height="2.9" rx=".8"/>',
  9: '<path d="M11 21V9.6a4.6 4.6 0 0 1 9.2 0v1.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  10: '<path d="M2.8 9.6c6-4.4 12.6-4.4 18.4 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="11" y="6" width="2" height="15" rx=".8"/>',
  11: '<rect x="11.2" y="10" width="1.6" height="11" rx=".6"/><path d="M12 3.4c1.8 1.4 2.4 3.2 0 5.4-2.4-2.2-1.8-4 0-5.4z"/><path d="M8.2 7.2c2.2.6 3 2.2 2 4.8-2.4-.8-3-2.6-2-4.8z"/><path d="M15.8 7.2c1 2.2.4 4-2 4.8-1-2.6-.2-4.2 2-4.8z"/>',
  12: '<rect x="11" y="3" width="2" height="9" rx=".7"/><path d="M7.5 12h9v3.2c0 3-1.9 5.4-4.5 5.8-2.6-.4-4.5-2.8-4.5-5.8z"/>',
  13: '<path d="M12 6.6c-3.4 0-6.4 2.4-7.4 6.2L3.3 18l3.5-1.2L12 19l5.2-2.2 3.5 1.2-1.3-5.2c-1-3.8-4-6.2-7.4-6.2z"/><circle cx="3" cy="18.8" r="1.5"/><circle cx="21" cy="18.8" r="1.5"/><circle cx="12" cy="4.6" r="1.5"/>'
};
const CREST = { 0: GLYPH[11], 1: GLYPH[1], 2: GLYPH[2], 3: GLYPH[8], 4: GLYPH[11], 5: GLYPH[12] };
/* 계급 코드 (rules.js titleCode 와 같다) */
function titleCode(i, n) {
  if (i === 0) return 1;
  if (i === 1) return 2;
  if (i === n - 1) return 5;
  if (n > 3 && i === n - 2) return 4;
  return 3;
}
const label = r => r === JESTER ? "광대" : `${cardName(r)}(${r})`;

export function mount(root, ctx) {
  const { el, esc } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "dm");
  wrap.innerHTML = `
    <div class="dm-seats" data-r="seats"></div>
    <div class="dm-table felt" data-r="table">
      <div class="dm-call" data-r="call" aria-live="polite"></div>
      <div class="dm-center" data-r="center"></div>
      <div class="dm-log" data-r="log"></div>
      <div class="dm-banner" data-r="banner" hidden></div>
    </div>
    <div class="dock dm-dock" data-r="dock">
      <button class="dm-me" data-r="me" aria-label="점수표 보기"></button>
      <div class="hint" data-r="hint"></div>
      <div class="dm-hand" data-r="hand"></div>
      <div class="dm-acts">
        <button class="btn dm-pass" data-r="pass">패스</button>
        <div class="dm-sel" data-r="sel"></div>
        <button class="btn primary dm-play" data-r="play" disabled>내기</button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;                 // 마지막 msg
  let sel = null;               // 고른 묶음 {rank, plain, jesters}
  let selAsk = 0;               // sel 을 고른 질문 번호 (차례가 바뀌면 지운다)
  let busyAsk = 0, busyUntil = 0, busyT = 0;
  let flashText = "", flashT = 0;
  let hot = new Set();          // 방금 행동한 사람 — 이름표 반짝
  let dealIn = false;           // 방금 카드를 받았다 — 손패 등장 효과
  let modalAsk = 0, modalClose = null, modalKind = "";
  let bannerT = 0, callText = "", callKind = "";   // callKind "trick": 다음 수가 나오면 지울 안내
  let geo = { cw: 52, rows: 1 };
  let landed = "";              // 마지막으로 내려앉는 효과를 보여 준 판 — 다시 그릴 때 효과를 되풀이하지 않는다

  const names = () => (M ? M.players.map(p => p.name) : []);
  const nm = p => esc(names()[p] || "?");
  const myPlayAsk = () => (M && M.v.phase === "play" ? ctx.myAsk("play") : null);
  const busy = () => { const a = ctx.myAsk(); return !!a && a.id === busyAsk && Date.now() < busyUntil; };
  function markBusy() {
    const a = ctx.myAsk();
    busyAsk = a ? a.id : 0; busyUntil = Date.now() + 1800;
    clearTimeout(busyT); busyT = setTimeout(render, 1900);
  }

  /* ---------- 카드 그리기 ---------- */
  function cardHTML(r, cls = "") {
    const j = r === JESTER;
    return `<span class="dm-card${j ? " jk" : ""} ${cls}" style="--rc:${RANK_COLOR[r]}"><span class="band"></span>` +
      `<span class="cn">${j ? "J" : r}</span><svg class="gl" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPH[r]}</svg>` +
      `<span class="rk">${j ? "광대" : r}</span><span class="tt">${j ? "와일드" : cardName(r)}</span></span>`;
  }
  const pip = r => `<i class="dm-pip" style="--rc:${RANK_COLOR[r]}">${r === JESTER ? "J" : r}</i>`;
  function pips(rank, plain, jesters, max = 4) {
    let s = "";
    const shown = Math.min(plain, max);
    for (let i = 0; i < shown; i++) s += pip(rank);
    if (plain > shown) s += `<i class="dm-pip more">+${plain - shown}</i>`;
    for (let i = 0; i < jesters; i++) s += pip(JESTER);
    return `<span class="dm-pips">${s}</span>`;
  }
  const crest = t => `<span class="dm-crest" style="--tc:${TITLE_COLOR[t]}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${CREST[t]}</svg></span>`;
  const playText = (rank, plain, jesters) => rank === JESTER ? `광대 ${jesters}장` : `${rank} ${cardName(rank)} ×${plain}${jesters ? ` + 광대 ${jesters}` : ""}`;

  /* ---------- 계산: 무엇을 낼 수 있나 ---------- */
  function groups(v) {
    const out = [];
    for (let r = 1; r <= 13; r++) if (v.hand[r] > 0) out.push(r);
    return out;
  }
  /* 숫자 r 묶음의 상태: {can, why} — 선이면 모두 가능, 따라갈 땐 r < 판 숫자 · 장수(광대 포함) 충분 */
  function groupState(v, r) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (!t) return { can: true };
    if (r === JESTER) return J ? { can: anyPlayable(v), why: "광대만은 선일 때만", aux: true } : { can: false };
    if (r >= t.rank) return { can: false, why: r === t.rank ? "같음" : "높음" };
    if (h[r] + J < t.count) return { can: false, why: "부족" };
    return { can: true };
  }
  function anyPlayable(v) {
    if (!v.trick) return true;
    const J = v.hand[JESTER];
    for (let r = 1; r < v.trick.rank && r <= 12; r++) if (v.hand[r] && v.hand[r] + J >= v.trick.count) return true;
    return false;
  }
  function legalSel(v, s) {
    if (!s) return false;
    const h = v.hand, t = v.trick;
    if (s.rank === JESTER) return !t && s.plain === 0 && s.jesters >= 1 && s.jesters <= h[JESTER];
    if (s.plain < 1 || s.plain > h[s.rank] || s.jesters < 0 || s.jesters > h[JESTER]) return false;
    if (!t) return true;
    return s.plain + s.jesters === t.count && s.rank < t.rank;
  }
  function whySel(v, s) {
    const t = v.trick, need = t ? t.count : 0;
    if (s.rank === JESTER) return "광대만으로는 선일 때만 낼 수 있습니다";
    if (t && s.rank >= t.rank) return `${t.rank}보다 낮은 숫자여야 합니다`;
    if (t && s.plain + s.jesters < need) return `${need}장이 필요합니다 — 광대 ${need - s.plain - s.jesters}장을 더하세요 (광대 묶음을 누르기)`;
    if (t && s.plain + s.jesters > need) return `${need}장만 낼 수 있습니다 — 장수를 줄이세요`;
    return "낼 수 없는 조합입니다";
  }
  /* 숫자 r 을 눌렀을 때 처음 고를 묶음 */
  function defaultSel(v, r) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (r === JESTER) return { rank: JESTER, plain: 0, jesters: J };
    if (!t) return { rank: r, plain: h[r], jesters: 0 };
    const plain = Math.min(h[r], t.count);
    const jesters = v.assist ? Math.min(J, t.count - plain) : 0;
    return { rank: r, plain, jesters };
  }

  /* ---------- 위: 이름표 ---------- */
  function seats() {
    const v = M.v, box = R("seats"), n = v.n;
    const cols = n <= 4 ? n : Math.ceil(n / 2);
    box.style.setProperty("--cols", cols);
    const order = v.seats;
    const drawn = v.draw && (v.phase === "deal" || v.phase === "draw") ? new Map(v.draw.draws.map(d => [d.p, d.rank])) : null;
    box.innerHTML = "";
    for (const p of order) {
      const pl = M.players[p] || { name: "?" }, t = v.titles[p], place = v.finish.indexOf(p);
      const turn = v.turn === p, out = place >= 0 && v.phase === "play";
      const la = v.phase === "play" ? v.lastAct[p] : null;
      let act = "";
      if (drawn && drawn.has(p)) act = `<span class="dm-drew">뽑음 ${pip(drawn.get(p))}</span>`;
      else if (v.phase === "roundEnd" || v.phase === "over") act = place >= 0 ? `<span class="dm-place">${place + 1}위 +${v.n - place}</span>` : "";
      else if (place >= 0) act = `<span class="dm-place">${place + 1}위 ✓</span>`;
      else if (turn) act = `<span class="dm-think">고민 중<b>…</b></span>`;
      else if (la && la.pass && v.passed[p]) act = `<span class="dm-passed">패스</span>`;
      else if (la && !la.pass) act = pips(la.rank, la.count - la.jesters, la.jesters, 3);
      else if (v.phase === "tax" && v.tax) {
        const x = v.tax.pairs.find(q => q.peon === p || q.lord === p);
        if (x) act = `<span class="dm-taxm">${x.peon === p ? `상납 ${x.k}` : `받음 ${x.k}`}</span>`;
      }
      const chip = el("div", "dm-seat" + (turn ? " turn" : "") + (p === M.me ? " me" : "") + (out ? " out" : "") + (hot.has(p) ? " hot" : ""));
      chip.style.setProperty("--tc", TITLE_COLOR[t]);
      const tag = pl.kind === "ai" ? '<span class="dm-tag">AI</span>' : pl.kind === "away" ? '<span class="dm-tag away">비움</span>' : "";
      const rev = v.reveal && v.reveal.p === p ? '<span class="dm-tag rev">광대2</span>' : "";
      chip.innerHTML =
        `<div class="l1">${crest(t)}<span class="nm">${esc(pl.name)}</span><span class="cnt" title="남은 카드">${v.sizes[p]}</span></div>` +
        `<div class="l2"><span class="ti">${TITLE_SHORT[t]}${tag}${rev}</span><span class="sc">${v.scores[p]}점</span></div>` +
        `<div class="l3">${act}</div>`;
      chip.setAttribute("aria-label", `${pl.name} ${TITLE_NAMES[t]}, 카드 ${v.sizes[p]}장, ${v.scores[p]}점`);
      box.appendChild(chip);
    }
  }

  /* ---------- 가운데: 판 ---------- */
  function center() {
    const v = M.v, c = R("center"), lg = R("log");
    c.className = "dm-center"; lg.innerHTML = "";
    if (v.phase === "draw" || v.phase === "deal") return drawView(c);
    if (v.phase === "tax") return taxView(c);
    if (v.phase === "roundEnd" || v.phase === "over") return standingsView(c);
    // 플레이
    const t = v.trick;
    if (t) {
      const key = [v.round, t.by, t.rank, t.plain, t.jesters, v.trickLog.length].join(":");
      const land = key !== landed; landed = key;
      c.innerHTML = `<div class="dm-trick${land ? " land" : ""}" data-r="trick">${trickCards(t)}</div>
        <div class="dm-who">${crest(v.titles[t.by])}<b>${nm(t.by)}</b> · ${esc(playText(t.rank, t.plain, t.jesters))}</div>
        <div class="dm-need">${v.turn === M.me ? "받아치려면" : "받아칠 조건"}: <b>${t.count}장</b> · <b>${t.rank}보다 낮은 숫자</b></div>`;
    } else {
      const pt = v.prevTrick;
      c.innerHTML = (pt ? `<div class="dm-trick prev" data-r="trick">${trickCards(pt)}</div>
          <div class="dm-who">${nm(pt.by)} 님이 판을 가져갔습니다</div>` : `<div class="dm-trick empty" data-r="trick"><span>빈 판</span></div>`) +
        `<div class="dm-need">새 판 — <b>${v.turn === M.me ? "내가" : nm(v.turn) + " 님이"}</b> 선 · 아무 숫자 몇 장이든</div>`;
    }
    // 이번 판 기록 (공정 규칙: 판이 끝나면 지운다)
    if (v.trickLog.length) {
      lg.innerHTML = `<span class="lab">이번 판</span>` + v.trickLog.slice(-8).map(e =>
        `<span class="ent${e.p === M.me ? " me" : ""}"><b>${nm(e.p)}</b>${e.pass ? '<i class="ps">패스</i>' : pips(e.rank, e.plain, e.jesters, 3)}</span>`).join("");
    }
    sizeTrick();
  }
  function trickCards(t) {
    const ranks = Array(t.plain).fill(t.rank).concat(Array(t.jesters).fill(JESTER));
    return ranks.map((r, i) => `<span class="slot" style="--i:${i};--rot:${((i % 2 ? 1 : -1) * (1.5 + (i * .9) % 3)).toFixed(1)}deg">${cardHTML(r)}</span>`).join("");
  }
  /* 판 카드 크기: 펠트에 남은 높이 · 폭으로 정한다 */
  function sizeTrick() {
    const tr = R("table").querySelector('[data-r="trick"]');
    if (!tr) return;
    const table = R("table"), c = R("center");
    const others = [...c.children].filter(x => x !== tr).reduce((a, x) => a + x.offsetHeight + 4, 0);
    const avH = table.clientHeight - R("call").offsetHeight - R("log").offsetHeight - others - 22;
    const W = table.clientWidth - 24;
    const k = tr.children.length || 1;
    let cw = Math.max(40, Math.min(W > 400 ? 128 : 112, avH / 1.42));
    // 겹치기: 너무 넓으면 간격을 줄인다
    let step = k > 1 ? Math.min(cw * .62, (W - cw) / (k - 1)) : 0;
    if (k > 1 && step < cw * .22) { cw = Math.max(36, W / (1 + (k - 1) * .3)); step = Math.min(cw * .62, (W - cw) / (k - 1)); }
    tr.style.setProperty("--cw", cw.toFixed(1) + "px");
    tr.style.setProperty("--step", step.toFixed(1) + "px");
    tr.style.width = (cw + step * (k - 1)).toFixed(1) + "px";
  }

  function drawView(c) {
    const v = M.v;
    if (!v.draw) { c.innerHTML = `<div class="dm-big">자리를 정합니다</div><div class="dm-need">한 장씩 뽑아 <b>가장 낮은 숫자</b>가 첫 선</div>`; return; }
    const first = v.draw.order[0];
    const items = v.draw.order.map((p, i) => {
      const r = v.draw.draws.find(d => d.p === p).rank;
      return `<div class="dm-dr${p === first ? " win" : ""}" style="--i:${i}">${cardHTML(r)}<b>${nm(p)}</b></div>`;
    }).join("");
    // 카드 크기: 한 줄(많으면 두 줄)에 들어가게
    const T = R("table"), per = v.n > 5 && T.clientWidth < 460 ? Math.ceil(v.n / 2) : v.n;
    const dw = Math.floor(Math.max(38, Math.min(76, (T.clientWidth - 24) / per - 8, (T.clientHeight - 110) / (per < v.n ? 2 : 1) / 1.42 - 20)));
    c.innerHTML = `<div class="dm-sub">자리 뽑기 — 낮은 숫자부터 앉습니다</div><div class="dm-draws" style="--cw:${dw}px; max-width:${per * (dw + 8) + 4}px">${items}</div>
      <div class="dm-need"><b>${nm(first)}</b> 님이 가장 낮은 카드로 첫 선</div>`;
  }

  function taxView(c) {
    const v = M.v, me = M.me;
    let html = `<div class="dm-sub">라운드 ${v.round} · 세금</div>`;
    if (!v.tax) {
      html += v.ask && v.ask.kind === "revolt"
        ? `<div class="dm-big">광대 2장이 내 손에!</div><div class="dm-need">혁명을 선언할지 고르세요</div>`
        : `<div class="dm-big dim">세금을 걷을 준비 중…</div>`;
      html += myTitleLine();
      c.innerHTML = html; return;
    }
    if (!v.tax.pairs.length) html += `<div class="dm-need">이번 라운드는 세금이 없습니다</div>`;
    v.tax.pairs.forEach((x, i) => {
      const st = x.downDone ? "끝" : x.upDone ? (v.tax.i === i ? "돌려줄 카드 고르는 중" : "") : "대기";
      const mine = x.peon === me || x.lord === me;
      const cards = mine ? `<div class="dm-txc">${x.up ? `<span>바친 카드</span>${x.up.map(r => cardHTML(r, "mini")).join("")}` : ""}${x.down ? `<span>돌려준 카드</span>${x.down.map(r => cardHTML(r, "mini")).join("")}` : ""}</div>` : "";
      html += `<div class="dm-tx${v.tax.i === i && !v.tax.done ? " now" : ""}${mine ? " mine" : ""}">
        <div class="row">${crest(v.titles[x.peon])}<b>${nm(x.peon)}</b><span class="arr">→ ${x.k}장 →</span>${crest(v.titles[x.lord])}<b>${nm(x.lord)}</b><span class="st">${st}</span></div>${cards}</div>`;
    });
    html += myTitleLine();
    c.innerHTML = html;
  }
  function myTitleLine() {
    const v = M.v, t = v.titles[M.me];
    return `<div class="dm-need">이번 라운드 내 계급: ${crest(t)}<b style="color:${TITLE_COLOR[t]}">${TITLE_NAMES[t]}</b></div>`;
  }

  /* 라운드 결과: 순위 · 얻은 점수 · 새 계급 · 다음 라운드 세금 */
  function standingsView(c) {
    const v = M.v, n = v.n, fin = v.finish, last = v.phase === "over" || v.round >= v.rounds;
    const rows = fin.map((p, i) => {
      const t = titleCode(i, n);
      return `<li class="${p === M.me ? "me" : ""}"><span class="md m${i + 1}">${i + 1}</span><b>${nm(p)}</b>
        <span class="nt" style="color:${TITLE_COLOR[t]}">${crest(t)}${TITLE_NAMES[t]}</span><span class="pt">+${n - i}</span><span class="tot">${v.scores[p] + (v.phase === "roundEnd" ? n - i : 0)}</span></li>`;
    }).join("");
    let tax = "";
    if (!last && fin.length === n) {
      const gp = fin[n - 1], gd = fin[0], lp = fin[n - 2], ld = fin[1];
      tax = `<div class="dm-need">다음 라운드 세금: <b>${nm(gp)}</b> → <b>${nm(gd)}</b> 2장 · <b>${nm(lp)}</b> → <b>${nm(ld)}</b> 1장</div>`;
    }
    c.className = "dm-center stand";
    c.innerHTML = `<div class="dm-sub">${last ? "마지막 라운드 결과" : `라운드 ${v.round} 결과 — 이 순서로 다음 라운드에 앉습니다`}</div>
      <ol class="dm-stand"><li class="hd"><span></span><span>이름</span><span>${last ? "계급" : "새 계급"}</span><span>점수</span><span>합계</span></li>${rows}</ol>${tax}`;
  }

  /* ---------- 위쪽 한 줄: 방금 일어난 중요한 일 ---------- */
  function call() {
    const v = M.v, box = R("call");
    let t = callText;
    if (!t) {
      if (v.phase === "play") t = v.reveal ? (v.reveal.great ? `대혁명 — ${nm(v.reveal.p)} 님이 서열을 뒤집었습니다` : `혁명 — ${nm(v.reveal.p)} 님 · 이번 라운드 세금 없음`) : `라운드 ${v.round} / ${v.rounds}`;
      else if (v.phase === "over") t = "게임 끝";
      else t = `라운드 ${v.round} / ${v.rounds}`;
    }
    box.innerHTML = t;
  }

  /* ---------- 아래: 내 줄 · 안내 · 손패 · 버튼 ---------- */
  function meLine() {
    const v = M.v, me = M.me, t = v.titles[me];
    const order = [...Array(v.n).keys()].sort((a, b) => v.scores[b] - v.scores[a]);
    const rank = order.findIndex(p => v.scores[p] === v.scores[me]) + 1;
    const place = v.finish.indexOf(me);
    R("me").innerHTML = `${crest(t)}<b class="ti" style="color:${TITLE_COLOR[t]}">${TITLE_NAMES[t]}</b>` +
      `<span class="it"><b>${v.scores[me]}</b>점 · ${rank}위</span>` +
      `<span class="it">라운드 <b>${v.round}</b>/${v.rounds}</span>` +
      `<span class="it">${place >= 0 && v.phase === "play" ? `<b>${place + 1}위</b> 탈출` : `내 패 <b>${v.sizes[me]}</b>장`}</span><span class="more">점수표 ›</span>`;
  }

  function hint() {
    const v = M.v, me = M.me, h = R("hint"), mine = myPlayAsk() && !busy();
    let t = "", cls = "hint";
    if (flashText) { t = flashText; cls += " dm-warn"; }
    else if (v.phase === "over") t = "게임 끝";
    else if (v.phase === "draw" || v.phase === "deal") t = "곧 카드를 나눕니다";
    else if (v.phase === "roundEnd") t = v.finish[0] === me ? "<b>1등!</b> 다음 라운드는 대달무티입니다 👑" : `라운드 끝 — 나는 <b>${v.finish.indexOf(me) + 1}위</b>`;
    else if (v.phase === "tax") {
      if (v.ask && v.ask.kind === "return") t = `<b>${nm(v.ask.peon)}</b> 님에게 돌려줄 카드 <b>${v.ask.k}장</b>을 고르세요`;
      else if (v.ask && v.ask.kind === "revolt") t = "<b>혁명</b>을 선언할지 고르세요 (15초)";
      else t = "세금 정산 중 — 잠시 기다리세요";
    } else if (v.phase === "play") {
      const tr = v.trick;
      if (v.finish.includes(me)) t = `<b>${v.finish.indexOf(me) + 1}위</b>로 빠져나왔습니다 — 다음 라운드 ${TITLE_NAMES[titleCode(v.finish.indexOf(me), v.n)]}`;
      else if (busy()) t = "보냈습니다…";
      else if (!mine) t = `${nm(v.turn)} 님 차례` + (tr ? ` · ${tr.count}장, ${tr.rank}보다 낮게` : " · 새 판의 선");
      else if (sel && legalSel(v, sel)) t = `<b>${esc(playText(sel.rank, sel.plain, sel.jesters))}</b> — 「내기」를 누르세요`;
      else if (sel) { t = esc(whySel(v, sel)); cls += " dm-warn"; }
      else if (tr && !anyPlayable(v)) { t = `${tr.count}장 · ${tr.rank}보다 낮은 묶음이 없습니다 — <b>패스</b>하세요`; cls += " dm-urge"; }
      else if (tr) t = `<b>${tr.count}장</b> · <b>${tr.rank}보다 낮은</b> 숫자를 누르거나 패스`;
      else t = "<b>선</b>입니다 — 낼 숫자를 누르세요" + (v.hand[JESTER] ? " (광대를 붙이려면 광대도 누르기)" : "");
    }
    h.className = cls; h.innerHTML = t;
  }

  function hand() {
    const v = M.v, box = R("hand"), mine = !!myPlayAsk() && !busy();
    const gs = groups(v);
    box.innerHTML = "";
    box.classList.toggle("xs", geo.cw < 46);
    box.style.setProperty("--cw", geo.cw + "px");
    box.style.setProperty("--cols", Math.ceil(gs.length / geo.rows) || 1);
    box.classList.toggle("empty", !gs.length);
    if (!gs.length) {
      const place = v.finish.indexOf(M.me);
      box.innerHTML = `<div class="dm-empty">${place >= 0 ? `${place + 1}위로 패를 다 털었습니다 🎉` : v.phase === "draw" || v.phase === "deal" ? "카드를 기다리는 중" : ""}</div>`;
      return;
    }
    gs.forEach((r, i) => {
      const cnt = v.hand[r], st = v.phase === "play" ? groupState(v, r) : { can: true };
      const picked = sel ? (r === JESTER ? sel.jesters : sel.rank === r ? sel.plain : 0) : 0;
      const b = el("button", "dm-grp" + (r === JESTER ? " jk" : "") + (mine && st.can && !st.aux ? " can" : "") + (mine && !st.can ? " dim" : "") +
        (picked ? " sel" : "") + (dealIn ? " in" : "") + (cnt >= 3 ? " s3" : cnt === 2 ? " s2" : ""));
      b.style.setProperty("--i", i);
      b.innerHTML = cardHTML(r) + `<span class="n">${cnt}</span>` +
        (picked ? `<span class="pk">${picked}장</span>` : mine && !st.can && st.why ? `<span class="why">${st.why}</span>` : "");
      b.setAttribute("aria-label", `${label(r)} ${cnt}장` + (picked ? `, ${picked}장 고름` : "") + (mine && !st.can ? " (낼 수 없음)" : ""));
      b.onclick = () => tap(r);
      box.appendChild(b);
    });
    dealIn = false;
  }

  function controls() {
    const v = M.v, mine = !!myPlayAsk() && !busy();
    const pass = R("pass"), play = R("play"), sb = R("sel");
    pass.disabled = !mine || !v.trick;
    pass.classList.toggle("dm-urgebtn", mine && !!v.trick && !anyPlayable(v) && !sel);
    const ok = mine && legalSel(v, sel);
    play.disabled = !ok;
    play.textContent = sel && ok ? `${sel.plain + sel.jesters}장 내기` : "내기";
    // 고른 묶음 · 장수 조절
    if (mine && sel) {
      const lo = stepRange(v, sel);
      const what = sel.rank === JESTER ? `${pip(JESTER)}×${sel.jesters}` : `${pip(sel.rank)}×${sel.plain}${sel.jesters ? ` +${pip(JESTER)}${sel.jesters}` : ""}`;
      sb.innerHTML = `<button class="st" data-d="-1" ${lo.min >= lo.cur ? "disabled" : ""} aria-label="한 장 덜">−</button><span class="cur">${what}</span>` +
        `<button class="st" data-d="1" ${lo.max <= lo.cur ? "disabled" : ""} aria-label="한 장 더">+</button>`;
      sb.querySelectorAll("button").forEach(b => b.onclick = () => stepSel(+b.dataset.d));
    } else sb.innerHTML = mine ? `<span class="none">숫자를 눌러 고르기</span>` : "";
  }
  /* 장수 조절 범위: 광대만이면 광대 수, 아니면 숫자 카드 수 (따라갈 땐 광대가 나머지를 채운다) */
  function stepRange(v, s) {
    const h = v.hand, J = h[JESTER], t = v.trick;
    if (s.rank === JESTER) return { min: 1, max: J, cur: s.jesters };
    if (!t) return { min: 1, max: h[s.rank], cur: s.plain };
    return { min: Math.max(1, t.count - J), max: Math.min(h[s.rank], t.count), cur: s.plain };
  }
  function stepSel(d) {
    const v = M.v;
    if (!sel) return;
    const r = stepRange(v, sel), nv = Math.max(r.min, Math.min(r.max, r.cur + d));
    if (sel.rank === JESTER) sel.jesters = nv;
    else {
      sel.plain = nv;
      if (v.trick && (v.assist || sel.jesters)) sel.jesters = Math.max(0, Math.min(v.hand[JESTER], v.trick.count - nv));
    }
    ctx.sound.deal();
    render();
  }

  function flash(text) {
    flashText = text;
    clearTimeout(flashT); flashT = setTimeout(() => { flashText = ""; if (M) hint(); }, 2200);
  }

  function tap(r) {
    const v = M.v, ask = myPlayAsk();
    if (v.phase !== "play") return;
    if (!ask) { flash(v.finish.includes(M.me) ? "이미 패를 다 털었습니다" : `${names()[v.turn] || ""} 님 차례입니다`); hint(); return; }
    if (busy()) return;
    selAsk = ask.id;
    const h = v.hand, t = v.trick, J = h[JESTER];
    if (r === JESTER) {
      if (sel && sel.rank !== JESTER) {
        // 고른 숫자에 광대 붙이기 · 떼기
        if (!t) sel.jesters = (sel.jesters + 1) % (J + 1);
        else {
          // 따라갈 때: 장수는 그대로, 광대를 하나 더 쓰고 숫자 카드를 하나 덜 (돌아가며)
          const opts = [];
          for (let j = 0; j <= J; j++) { const pl = t.count - j; if (pl >= 1 && pl <= h[sel.rank]) opts.push(j); }
          if (!opts.length) { flash("광대를 써도 장수를 맞출 수 없습니다"); render(); return; }
          const i = opts.indexOf(sel.jesters);
          sel.jesters = opts[(i + 1) % opts.length]; sel.plain = t.count - sel.jesters;
        }
      } else if (t) { flash("광대는 숫자 카드와 함께 내세요 — 숫자를 먼저 누르세요"); render(); return; }
      else sel = sel && sel.rank === JESTER ? null : defaultSel(v, JESTER);
      ctx.sound.flip();
      render();
      return;
    }
    if (sel && sel.rank === r) { sel = null; render(); return; }
    const st = groupState(v, r);
    if (!st.can) {
      flash(st.why === "부족" ? `${label(r)} ${h[r]}장${J ? ` + 광대 ${J}장` : ""}으로는 ${t.count}장을 맞출 수 없습니다`
        : `${label(r)}는 지금 판(${t.rank})보다 낮지 않습니다`);
      ctx.sound.pass();
      render();
      return;
    }
    sel = defaultSel(v, r);
    ctx.sound.flip();
    render();
  }
  function doPlay() {
    const v = M.v;
    if (!myPlayAsk() || busy() || !legalSel(v, sel)) return;
    if (ctx.send({ rank: sel.rank, plain: sel.plain, jesters: sel.jesters })) { markBusy(); sel = null; ctx.sound.place(); render(); }
  }
  function doPass() {
    if (!myPlayAsk() || busy() || !M.v.trick) return;
    if (ctx.send({ pass: true })) { markBusy(); sel = null; ctx.sound.pass(); render(); }
  }
  R("play").onclick = doPlay;
  R("pass").onclick = doPass;
  R("me").onclick = () => scoreTable();

  /* ---------- 창: 혁명 질문 · 돌려줄 카드 · 점수표 ---------- */
  const REVOLT_NOTE = {
    4: "나는 <b>소농노</b> — 선언하면 소달무티에게 바칠 가장 좋은 카드 1장을 지킵니다.",
    3: "나는 <b>상인</b> — 세금과는 무관하지만, 혁명은 두 달무티의 특권을 없앱니다.",
    2: "나는 <b>소달무티</b> — 선언하면 내가 받을 상납 1장도 사라집니다.",
    1: "나는 <b>대달무티</b> — 선언하면 내가 받을 상납 2장도 사라집니다."
  };
  function asks() {
    const v = M.v;
    const a = ctx.myAsk("revolt") || ctx.myAsk("return");
    const want = a && v.ask && v.ask.kind === a.kind ? a : null;
    if (modalClose && (!want || want.id !== modalAsk)) { const c = modalClose; modalClose = null; modalAsk = 0; c(); }
    if (!want || want.id === modalAsk) return;
    modalAsk = want.id; modalKind = want.kind;
    ctx.buzz([60, 80, 60]);
    if (want.kind === "revolt") revoltModal(want);
    else returnModal(want);
  }
  function revoltModal(ask) {
    const v = M.v;
    ctx.modal((box, close) => {
      modalClose = close;
      ctx.head(box, "혁명", "혁명을 선언할까요?",
        "광대 2장이 모두 내 손에 있습니다. 선언하면 <b>이번 라운드 세금이 전부 취소</b>되고 광대 2장이 모두에게 공개됩니다. 감추면 아무도 모릅니다. 15초 안에 고르지 않으면 감춘 것으로 합니다.");
      box.appendChild(el("div", "dm-mnote", (REVOLT_NOTE[v.ask.title] || "") + `<div class="dm-mcards">${cardHTML(JESTER)}${cardHTML(JESTER)}</div>`));
      ctx.buttonRow(box, [
        { label: "감춘다", on: () => { if (ctx.myAsk("revolt")) ctx.send({ revolt: false }); close(); } },
        { label: "혁명 선언!", primary: true, on: () => { if (ctx.myAsk("revolt")) ctx.send({ revolt: true }); ctx.sound.win(); close(); } }
      ]);
    }, { dismissible: false }).then(() => { if (modalAsk === ask.id) modalClose = null; });
  }
  function returnModal(ask) {
    const v = M.v, k = v.ask.k, peon = v.ask.peon, recv = v.ask.received;
    const pick = [];
    ctx.modal((box, close) => {
      modalClose = close;
      ctx.head(box, "세금", `${nm(peon)} 님에게 돌려줄 카드 ${k}장`,
        `${nm(peon)} 님이 가장 낮은 숫자 ${k}장을 바쳤습니다. 아무 카드나 ${k}장을 골라 돌려주세요. 시간이 다 되면 가장 약한 카드가 나갑니다.`);
      box.appendChild(el("div", "dm-recv", `<span>받은 카드</span>${recv.map(r => cardHTML(r, "mini")).join("")}`));
      const grid = el("div", "dm-rgrid"), picked = el("div", "dm-picked");
      box.appendChild(grid); box.appendChild(picked);
      const row = ctx.buttonRow(box, [
        { label: "가장 약한 카드로", on: () => send(weakest(v.hand, k)) },
        { label: "돌려주기", primary: true, disabled: true, on: () => send(pick.slice()) }
      ]);
      const give = row.querySelector(".btn.primary");
      function send(cards) { if (ctx.myAsk("return")) { ctx.send({ cards }); ctx.sound.chip(); } close(); }
      function draw() {
        grid.innerHTML = "";
        for (let r = 1; r <= 13; r++) {
          const have = v.hand[r]; if (!have) continue;
          const used = pick.filter(x => x === r).length;
          const b = el("button", "dm-rc" + (used ? " sel" : "") + (used >= have ? " full" : ""), cardHTML(r, "mini") + `<span class="n">${have - used}</span>`);
          b.disabled = used >= have || pick.length >= k;
          b.onclick = () => { pick.push(r); ctx.sound.flip(); draw(); };
          grid.appendChild(b);
        }
        picked.innerHTML = `<span>돌려줄 카드 ${pick.length}/${k}</span>` + pick.map((r, i) => `<button class="dm-pc" data-i="${i}" aria-label="${label(r)} 빼기">${cardHTML(r, "mini")}</button>`).join("");
        picked.querySelectorAll("button").forEach(b => b.onclick = () => { pick.splice(+b.dataset.i, 1); draw(); });
        give.disabled = pick.length !== k;
      }
      draw();
    }, { dismissible: false }).then(() => { if (modalAsk === ask.id) modalClose = null; });
  }
  function weakest(h, k) {
    const out = [];
    for (let r = 12; r >= 1 && out.length < k; r--) for (let c = h[r]; c > 0 && out.length < k; c--) out.push(r);
    for (let c = h[JESTER]; c > 0 && out.length < k; c--) out.push(JESTER);
    return out;
  }
  function scoreTable() {
    if (!M) return;
    const v = M.v, n = v.n;
    const order = [...Array(n).keys()].sort((a, b) => v.scores[b] - v.scores[a]);
    ctx.modal((box, close) => {
      ctx.head(box, `라운드 ${v.round} / ${v.rounds}`, "점수표", "라운드마다 1등 n점 … 꼴찌 1점. 칸의 글자는 그 라운드에서 얻은 계급입니다.");
      const hs = v.history;
      const head = `<tr><th></th><th>이름</th>${hs.map(h => `<th>${h.round}R</th>`).join("")}<th>합계</th></tr>`;
      const rows = order.map((p, i) => `<tr class="${p === M.me ? "me" : ""}"><td>${i + 1}</td><td class="nm"><span>${crest(v.titles[p])}${nm(p)}</span></td>` +
        hs.map(h => { const k = h.finish.indexOf(p), t = titleCode(k, n); return `<td style="color:${TITLE_COLOR[t]}">${h.points[k]}<small>${TITLE_SHORT[t]}</small></td>`; }).join("") +
        `<td class="tot">${v.scores[p]}</td></tr>`).join("");
      box.appendChild(el("div", "dm-scorewrap", `<table class="dm-score">${head}${rows}</table>`));
      if (!hs.length) box.appendChild(el("p", "", "아직 끝난 라운드가 없습니다."));
      ctx.buttonRow(box, [{ label: "닫기", primary: true, on: () => close() }]);
    });
  }

  /* ---------- 이벤트: 소리 · 반짝임 · 알림 ---------- */
  function events(m) {
    const v = m.v, me = m.me;
    hot = new Set();
    let snd = null, pr = 0;
    const want = (s, r) => { if (r >= pr) { snd = s; pr = r; } };
    for (const e of m.ev) {
      if (e.type === "play") { hot.add(e.p); want("place", 1); if (e.p === me) sel = null; if (callKind === "trick") { callText = ""; callKind = ""; } }
      else if (e.type === "pass") { hot.add(e.p); want("pass", 1); }
      else if (e.type === "trickEnd") { callKind = "trick"; callText = e.winner === me ? "판을 가져왔습니다 — <b>내가 선</b>" : `<b>${nm(e.winner)}</b> 님이 판을 가져감 · 새 판 선 <b>${e.leader === me ? "나" : nm(e.leader)}</b>`; want("flip", 1); }
      else if (e.type === "out") { callText = e.p === me ? `<b>${e.place}위</b>로 빠져나왔습니다 — ${TITLE_NAMES[e.title]}` : `<b>${nm(e.p)}</b> 님 ${e.place}위 — ${TITLE_NAMES[e.title]}`; if (e.p === me) { want(e.last ? "lose" : "good", 4); ctx.buzz(80); } else want("chip", 2); }
      else if (e.type === "draw") { callText = "자리 뽑기"; want("deal", 2); }
      else if (e.type === "deal") { callText = `라운드 ${e.round} — 카드를 나눴습니다`; dealIn = true; sel = null; want("deal", 2); }
      else if (e.type === "revolt") { callText = e.great ? `<b>대혁명!</b> ${nm(e.p)} 님 — 서열이 뒤집혔습니다` : `<b>혁명!</b> ${nm(e.p)} 님 — 세금 없음`; banner(e); want("win", 5); }
      else if (e.type === "revoltNo") { callText = "광대 2장을 감췄습니다 🤫"; }
      else if (e.type === "taxStart") callText = "세금을 걷습니다";
      else if (e.type === "tax") {
        hot.add(e.from); hot.add(e.to);
        const mine = e.from === me || e.to === me;
        callText = `<b>${nm(e.from)}</b> → <b>${nm(e.to)}</b> · ${e.n}장 ${e.dir === "up" ? "상납" : "하사"}` +
          (mine && e.ranks ? ` <span class="dm-callc">${e.ranks.map(r => pip(r)).join("")}</span>` : "");
        if (e.to === me) dealIn = false;
        want("chip", 2);
      } else if (e.type === "taxDone") callText = "세금 끝 — 플레이 시작";
      else if (e.type === "lead") { if (e.p !== me) callText = callText || `<b>${nm(e.p)}</b> 님이 선`; }
      else if (e.type === "roundEnd") { callText = `라운드 ${e.round} 끝`; want(e.finish[0] === me ? "win" : "good", 3); }
      else if (e.type === "round") callText = "";
    }
    if (snd && ctx.sound[snd]) ctx.sound[snd]();
  }
  function banner(e) {
    const b = R("banner");
    b.hidden = false;
    b.className = "dm-banner" + (e.great ? " great" : "");
    b.innerHTML = `<div><small>${e.great ? "GREAT REVOLUTION" : "REVOLUTION"}</small><b>${e.great ? "대혁명" : "혁명"}</b><span>${nm(e.p)} 님이 광대 2장을 펼쳤습니다<br>${e.great ? "서열이 통째로 뒤집힙니다" : "이번 라운드 세금은 없습니다"}</span></div>`;
    clearTimeout(bannerT); bannerT = setTimeout(() => { b.hidden = true; }, e.great ? 2600 : 2100);
  }

  /* ---------- 크기 맞추기 ---------- */
  function fit() {
    const v = M.v, H = wrap.clientHeight, W = wrap.clientWidth;
    const gn = groups(v).length, gs = gn || 1;
    const hb = R("hand");
    wrap.classList.toggle("short", H < 600);
    wrap.classList.toggle("tall", H >= 760);
    if (!H || !W) { geo = { cw: 46, rows: gs > 7 ? 2 : 1 }; return; }
    const hw = (hb.clientWidth || W - 20);
    const gap = 5;
    // 한 줄에 7묶음까지 (폭이 넓으면 더)
    const perRow = Math.max(5, Math.min(13, Math.floor((hw + gap) / (40 + gap))));
    let rows = gs > Math.min(7, perRow) ? 2 : 1;
    const cols = Math.ceil(gs / rows);
    const byW = (hw - (cols - 1) * gap - 6) / cols;
    // 높이: 이름표 · 내 줄 · 버튼을 뺀 나머지의 일부
    hb.style.height = "0px";
    const fixed = R("seats").offsetHeight + R("dock").offsetHeight;
    const rest = Math.max(200, H - fixed);
    const handMax = Math.max(84, Math.min(rest * .46, rest - 170));
    const byH = (handMax / rows - 8) / 1.42;
    const cw = Math.floor(Math.max(34, Math.min(rows === 1 ? 94 : 84, byW, byH)));
    geo = { cw, rows };
    // 카드가 없으면(자리 뽑기 · 다 털었을 때) 손패 자리를 줄여 판을 키운다
    hb.style.height = gn ? Math.ceil(rows * (cw * 1.42 + 8) + 2) + "px" : "40px";
  }

  function render() {
    if (!M) return;
    const a = myPlayAsk();
    if (!a || a.id !== selAsk) sel = null;          // 차례가 바뀌면 고른 묶음은 버린다
    if (sel && !(M.v.hand[sel.rank] > 0)) sel = null;
    seats(); call(); meLine(); hint(); controls();
    fit();
    hand();
    center();
  }
  function update(m) {
    M = m;
    events(m);
    render();
    hot = new Set();            // 반짝임은 이번 한 번만
    asks();
  }
  function onResize() { if (M) render(); }
  window.addEventListener("resize", onResize);

  return {
    update,
    ticker: false,            // 이번 판 기록 · 위 한 줄(call)이 진행 기록을 대신한다
    destroy() {
      window.removeEventListener("resize", onResize);
      clearTimeout(busyT); clearTimeout(flashT); clearTimeout(bannerT);
      if (modalClose) { try { modalClose(); } catch (e) { } }
      root.innerHTML = "";
    }
  };
}
