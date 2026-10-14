/* 포커 화면 — 위: 상대 자리판(이름 · 칩 · 이번 거리 베팅 · 마지막 행동 · D/SB/BB · 차례와 남은 시간)
   가운데 펠트: 공용 카드 5장(내 패를 만드는 카드는 금색) · 팟 · 이번 판 행동 기록 (판이 끝나면 결과)
   아래: 내 패 · 칩 · 지금 족보 · 드로우 / 계산 줄(콜 · 콜 후 팟 · 팟 오즈 · 대략적인 승률) / 행동 버튼
   화면 크기는 .pk 와 펠트의 실제 높이(컨테이너 단위)에 맞춰 카드 · 글자를 키운다 — 빈 공간을 남기지 않는다.
   레이즈는 아래 판에서 금액을 고르고 「확인」 을 한 번 더 눌러야 나간다. 올인 콜 · 체크 가능한데 폴드도 두 번 눌러 확인. */
import { cardHTML } from "../../core/cards.js";
import { bestHand, evalCodes, C2I, ev7, preflopEq, preflopPct } from "./engine.js";

const STREETS = ["프리플랍", "플랍", "턴", "리버"];
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANK = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const RN = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];   // 엔진 숫자 번호(0=2 … 12=A) → 글자
const fmt = n => Number(n || 0).toLocaleString("ko-KR");
const label = c => (RANK[+c.slice(1)] || c.slice(1)) + SUIT[c[0]];
const red = c => c[0] === "H" || c[0] === "D";
const ridx = c => { const r = +c.slice(1); return r === 1 ? 12 : r - 2; };
const mini = (c, extra = "") => `<span class="pk-mini${red(c) ? " red" : ""}${extra ? " " + extra : ""}">${label(c)}</span>`;
const pct = x => `${Math.round(x * 100)}%`;
const EQ_KEY = "bg.poker.eq";        // 대략적인 승률 보이기 (localStorage)
const LSget = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const LSset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const SHORT_ST = ["프", "플", "턴", "리"];
const ACT_WORD = { fold: "폴드", check: "체크", call: "콜", bet: "벳", raise: "레이즈", allin: "올인", sb: "SB", bb: "BB" };

/* ===================== 내 패 계산 (공개 정보 + 내 카드만) ===================== */
/* 지금 족보: {name, detail, core: 족보를 이루는 카드, board: 공용 카드만으로 된 패인지} */
function madeHand(hole, board) {
  const h = bestHand([...hole, ...board]), k = h.score >> 20;
  const a = (h.score >> 16) & 15, b = (h.score >> 12) & 15;
  let detail = "", core;
  switch (k) {
    case 0: detail = `${RN[a]} 하이`; break;
    case 1: case 3: case 7: detail = RN[a]; break;
    case 2: case 6: detail = `${RN[a]}·${RN[b]}`; break;
    case 4: case 5: detail = `${RN[a]} 하이`; break;
    case 8: detail = a === 12 ? "" : `${RN[a]} 하이`; break;
  }
  if (k === 0) core = [h.best.reduce((x, y) => (ridx(y) > ridx(x) ? y : x))];
  else if (k === 1 || k === 3 || k === 7) core = h.best.filter(c => ridx(c) === a);
  else if (k === 2) core = h.best.filter(c => ridx(c) === a || ridx(c) === b);
  else core = h.best.slice();
  const onBoard = k > 0 && !hole.some(c => core.includes(c));
  return { k, score: h.score, name: h.name, detail, core, onBoard };
}
/* 드로우: 다음 한 장으로 스트레이트 이상(지금보다 센 족보)이 되는 카드 수. 공용 카드만으로 되는 경우는 뺀다 */
function drawsOf(hole, board, k, known) {
  if (board.length < 3 || board.length > 4) return [];
  const used = new Set([...hole, ...board, ...known]);
  const cnt = {};
  for (const s of "SHDC") for (let r = 1; r <= 13; r++) {
    const c = s + r;
    if (used.has(c)) continue;
    const k2 = evalCodes([...hole, ...board, c]) >> 20;
    if (k2 < 4 || k2 <= k) continue;
    if (board.length === 4 && (evalCodes([...board, c]) >> 20) >= k2) continue;
    const key = k2 >= 6 && k < 6 ? 6 : k2;           // 지금 풀하우스 아래면 '풀하우스 이상' 으로 묶는다
    cnt[key] = (cnt[key] || 0) + 1;
  }
  const NM = { 4: "스트레이트", 5: "플러시", 6: "풀하우스 이상", 7: "포카드", 8: "스트레이트 플러시" };
  return Object.keys(cnt).sort((x, y) => y - x).map(x => ({ name: NM[x], n: cnt[x] }));
}
/* 프리플랍 두 장 설명 */
function preDesc(hole) {
  const [x, y] = hole, rx = ridx(x), ry = ridx(y), hi = Math.max(rx, ry), lo = Math.min(rx, ry);
  const suited = x[0] === y[0], gap = hi - lo, pair = hi === lo;
  const two = `${RN[hi]}·${RN[lo]}`;
  if (pair) return { name: "포켓 페어", detail: two };
  if (suited && (gap === 1 || (hi === 12 && lo === 0))) return { name: "수딧 커넥터", detail: two };
  if (gap === 1) return { name: "커넥터", detail: two };
  if (suited) return { name: "수딧", detail: two };
  return { name: hi >= 9 && lo >= 8 ? "하이 카드 두 장" : "오프수트", detail: two };
}
/* 대략적인 승률: 남은 상대의 패는 무작위 (공개된 패는 그대로), 남은 공용 카드도 무작위로 sims 번 */
function equityMC(hole, board, opps, sims) {
  const used = new Uint8Array(52), h = hole.map(c => C2I[c]), b = board.map(c => C2I[c]);
  for (const c of [...h, ...b]) used[c] = 1;
  const known = opps.map(o => (o ? o.map(c => C2I[c]) : null));
  for (const o of known) if (o) for (const c of o) used[c] = 1;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const B = new Array(5), nd = deck.length;
  let win = 0;
  for (let s = 0; s < sims; s++) {
    let top = nd;
    const draw = () => { const j = (Math.random() * top) | 0; top--; const t = deck[j]; deck[j] = deck[top]; deck[top] = t; return t; };
    for (let i = 0; i < 5; i++) B[i] = i < b.length ? b[i] : draw();
    const my = ev7(h[0], h[1], B[0], B[1], B[2], B[3], B[4]);
    let lost = false, ties = 0;
    for (const o of known) {
      const a1 = o ? o[0] : draw(), a2 = o ? o[1] : draw();
      const os = ev7(a1, a2, B[0], B[1], B[2], B[3], B[4]);
      if (os > my) { lost = true; break; }
      if (os === my) ties++;
    }
    if (!lost) win += 1 / (ties + 1);
  }
  return win / sims;
}

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "pk");
  wrap.innerHTML = `
    <div class="pk-opps" data-r="opps"></div>
    <div class="pk-table felt" data-r="table">
      <div class="pk-info" data-r="info"></div>
      <div class="pk-board" data-r="board"></div>
      <div class="pk-mid" data-r="mid"></div>
      <div class="pk-log" data-r="log"></div>
    </div>
    <div class="dock pk-dock" data-r="dock">
      <div class="pk-me" data-r="me"></div>
      <div class="pk-calc" data-r="calc"></div>
      <div class="hint" data-r="hint"></div>
      <div class="pk-raise" data-r="raise" hidden>
        <div class="pk-rhead"><span data-r="rlabel">레이즈</span><b data-r="ramt"></b></div>
        <div class="pk-rinfo" data-r="rinfo"></div>
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
  let showEq = LSget(EQ_KEY) !== "0";
  let eqCache = { key: "", val: 0 };
  let mine = null;              // 지금 내 패 계산 결과 (renderMe 에서 만들고 판 · 계산 줄이 같이 쓴다)

  /* ---------- 도우미 ---------- */
  const names = () => m.players.map(p => p.name);
  const nameOf = q => (q === m.me ? "나" : names()[q] || "?");
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
  const actClass = a => (/^(벳|레이즈)/.test(a) ? "raise" : a === "콜" ? "call" : a === "체크" ? "check" : a === "올인" ? "allin" : a === "폴드" ? "fold" : "");
  /* 지금 판에 남아 있는 상대 (폴드 · 탈락 아님). 공개된 패가 있으면 함께 */
  function liveOpps() {
    const v = m.v, out = [];
    v.seats.forEach((s, q) => { if (q !== m.me && s.inHand && !s.fold && !s.out) out.push(s.cards || null); });
    return out;
  }

  /* ---------- 위: 상대 자리판 ---------- */
  function renderOpps() {
    const v = m.v, n = m.players.length, box = R("opps");
    const order = [];
    for (let k = 1; k < n; k++) order.push((m.me + k) % n);
    const no = order.length;
    const cols = no <= 3 ? no : no === 4 ? 4 : no <= 6 ? 3 : 4;
    const solo = no === 1;
    box.className = `pk-opps c${cols}${no >= 5 ? " r2" : ""}${no === 4 ? " n4" : ""}`;
    wrap.classList.toggle("pk-many", no >= 5);
    box.innerHTML = "";
    const last = lastHere(v), wins = winnersOf(last);
    for (const q of order) {
      const s = v.seats[q], pl = m.players[q], active = v.turn === q;
      const d = el("div", "seatchip pk-seat" + (active ? " turn" : "") + (s.out ? " out" : "") + (s.fold ? " pk-fold" : "") +
        (s.allin && !s.fold ? " pk-allin" : "") + (wins.has(q) ? " pk-win" : ""));
      const show = last ? last.shows.find(x => x.p === q) : null;
      // 상태 · 마지막 행동 (이번 거리)
      let st;
      if (s.out) st = '<span class="pk-ab out">탈락</span>';
      else if (active) st = `<span class="pk-tm" data-tm="${q}">생각 중…</span>`;
      else if (show) st = `<span class="pk-ab hand${wins.has(q) ? " won" : ""}">${show.hand}</span>`;
      else if (last) st = wins.has(q) ? '<span class="pk-ab won">승리</span>' : s.fold ? '<span class="pk-ab fold">폴드</span>' : "";
      else if (s.fold) st = '<span class="pk-ab fold">폴드</span>';
      else if (s.allin) st = '<span class="pk-ab allin">올인</span>';
      else if (s.act) {
        // 베팅 금액은 옆의 금색 칩에 나오므로 배지에는 행동 이름만
        const word = s.bet > 0 ? s.act.split(" ")[0] : s.act;
        st = `<span class="pk-ab ${actClass(s.act)}">${esc(word)}</span>`;
      } else st = "";
      // 오른쪽 아래: 이번 거리 베팅, 판이 끝나면 얻은 칩
      let right = "";
      if (last && last.delta[q]) right = `<b class="pk-dl ${last.delta[q] > 0 ? "up" : "down"}">${last.delta[q] > 0 ? "+" : ""}${fmt(last.delta[q])}</b>`;
      else if (s.bet > 0) right = `<span class="pk-bet${pops.has(q) ? " pop" : ""}">${fmt(s.bet)}</span>`;
      const live = s.inHand && !s.fold && !s.out && v.phase !== "over";
      const best = show ? show.best : [];
      let cards;
      if (solo) cards = s.cards ? s.cards.map(c => cardHTML(c, "pk-oc" + (wins.has(q) && best.includes(c) ? " pk-hl" : ""))).join("")
        : live ? cardHTML(null, "pk-oc") + cardHTML(null, "pk-oc") : "";
      else cards = s.cards ? s.cards.map(c => mini(c, wins.has(q) && best.includes(c) ? "hl" : "")).join("")
        : live ? '<span class="pk-back"></span><span class="pk-back"></span>' : "";
      d.innerHTML = `<div class="pk-s1">${avatarHTML(pl.name, q, "sm")}<span class="nm">${esc(pl.name)}</span>` +
        (pl.kind === "away" ? '<span class="away">비움</span>' : "") + `<span class="pk-bs">${badges(q)}</span></div>` +
        `<div class="pk-s2"><span class="pk-stk">${s.out ? "-" : fmt(s.chips)}</span><span class="pk-hc">${cards}</span></div>` +
        `<div class="pk-s3"><span class="pk-st">${st}</span><span class="pk-rt2">${right}</span></div>` +
        `<div class="pk-hist">${histHTML(q)}</div>` +
        (active ? `<div class="pk-tbar"><i data-tb="${q}"></i></div>` : "");
      box.appendChild(d);
    }
    fitHist();
  }
  /* 자리마다 이번 판 행동 순서 (오래된 것 → 새것). 거리가 바뀌는 곳에 거리 첫 글자 */
  function histHTML(q) {
    const v = m.v;
    if (!v.log || !v.hand) return "";
    let h = "", prev = -1;
    for (const e of v.log) {
      if (e.p !== q) continue;
      const w = (ACT_WORD[e.a] || e.a) + (e.a === "fold" || e.a === "check" || e.a === "call" ? "" : " " + fmt(e.to));
      h += `<span class="pk-he" data-st="${e.st}">${e.st !== prev ? `<i>${SHORT_ST[e.st]}</i>` : ""}<span class="${e.a}">${w}</span></span>`;
      prev = e.st;
    }
    return h;
  }
  /* 자리판 폭을 넘으면 오래된 것부터 지운다 (새것이 늘 보이게) */
  function fitHist() {
    for (const h of R("opps").querySelectorAll(".pk-hist")) {
      let guard = 30;
      while (h.children.length > 1 && h.scrollWidth > h.clientWidth + 1 && guard--) {
        h.removeChild(h.firstElementChild);
        const f = h.firstElementChild;
        if (f && !f.querySelector("i")) f.insertAdjacentHTML("afterbegin", `<i>${SHORT_ST[+f.dataset.st] || ""}</i>`);
        h.classList.add("cut");
      }
    }
  }

  /* ---------- 가운데: 펠트 ---------- */
  function renderTable() {
    const v = m.v, last = lastHere(v);
    wrap.classList.toggle("pk-ended", !!last);
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

    // 공용 카드 5칸 — 판이 끝나면 이긴 패, 진행 중이면 내 패를 만드는 카드를 금색으로
    const board = R("board");
    const fresh = boardSeen.hand === v.hand ? boardSeen.len : 0;
    boardSeen = { hand: v.hand, len: v.board.length };
    let hl = null, dimRest = false;
    if (last && last.showdown && last.pots.length) {
      const w = last.pots[0].winners[0].p;
      hl = (last.shows.find(x => x.p === w) || {}).best || null;
      dimRest = true;
    } else if (!last && mine && mine.core && !mine.fold) hl = mine.core;
    let bh = "";
    for (let i = 0; i < 5; i++) {
      const c = v.board[i];
      if (!c) { bh += '<div class="pk-slot"></div>'; continue; }
      const cls = (i >= fresh ? "pk-new" : "") + (hl ? (hl.includes(c) ? " pk-hl" : dimRest ? " dim" : "") : "");
      bh += cardHTML(c, cls);
    }
    board.innerHTML = bh;
    if (fresh < v.board.length) board.querySelectorAll(".pk-new").forEach((x, i) => x.style.animationDelay = (i * 0.12) + "s");

    // 아래: 판 결과 · 또는 팟
    const mid = R("mid");
    if (last) { mid.innerHTML = resultHTML(last, `${last.hand}번째 판 결과`); R("log").innerHTML = ""; return; }
    if (!v.hand) { mid.innerHTML = '<div class="pk-line">카드를 섞는 중…</div>'; R("log").innerHTML = ""; return; }
    let h = `<div class="pk-pot"><span class="pk-chipico"></span>팟 <b>${fmt(v.potTotal)}</b>` +
      (v.curBet > 0 && v.phase === "bet" ? `<span class="pk-cur">현재 베팅 ${fmt(v.curBet)}</span>` : "") + `</div>`;
    if (v.pots.length > 1) h += `<div class="pk-side">${v.pots.map((x, i) => `${i ? "사이드" + (v.pots.length > 2 ? " " + i : "") : "메인"} <b>${fmt(x.amount)}</b>`).join(" · ")}</div>`;
    if (v.runout) h += '<div class="pk-runout">올인! 남은 카드를 펼칩니다</div>';
    mid.innerHTML = h;
    renderLog();
  }

  /* 이번 판 행동 기록 — 새것부터, 거리가 바뀌는 곳에 거리 이름 */
  function renderLog() {
    const v = m.v, box = R("log"), log = v.log || [];
    let h = "", prev = -1;
    const list = log.slice(-14).reverse();
    list.forEach((e, i) => {
      if (e.st !== prev) h += `<span class="pk-lgst">${STREETS[e.st]}</span>`;
      prev = e.st;
      const w = ACT_WORD[e.a] || e.a;
      const amtTxt = e.a === "fold" || e.a === "check" ? "" : ` ${fmt(e.to)}`;
      h += `<span class="pk-lg ${e.a}${i === 0 ? " new" : ""}${e.p === m.me ? " me" : ""}"><b>${esc(nameOf(e.p))}</b> ${w}${amtTxt}</span>`;
    });
    box.innerHTML = h;
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

  /* ---------- 내 패 계산 ---------- */
  function analyze() {
    const v = m.v, my = v.my;
    mine = null;
    if (!my || !my.hole || v.phase === "over") return;
    const s = v.seats[m.me];
    if (s.out || !s.inHand) return;
    const opps = liveOpps();
    const known = opps.filter(Boolean).flat();
    const r = { fold: s.fold, nOpp: opps.length, eq: null };
    if (v.board.length >= 3) {
      const mh = madeHand(my.hole, v.board);
      Object.assign(r, mh);
      r.draws = s.fold ? [] : drawsOf(my.hole, v.board, mh.k, known);
    } else {
      Object.assign(r, preDesc(my.hole), { core: null, pre: true });
      if (opps.length) {
        const a = C2I[my.hole[0]], b = C2I[my.hole[1]], no = Math.min(7, opps.length);
        r.top = Math.max(1, Math.round((1 - preflopPct(a, b, no)) * 100));
      }
    }
    // 대략적인 승률 — 같은 상황이면 다시 계산하지 않는다 (숫자가 흔들리지 않게)
    if (!s.fold && opps.length && !lastHere(v)) {
      const key = `${v.hand}|${my.hole}|${v.board}|${opps.map(o => (o ? o.join("") : "?")).join(",")}`;
      if (eqCache.key !== key) {
        let eq;
        if (v.board.length === 0 && !known.length) eq = preflopEq(C2I[my.hole[0]], C2I[my.hole[1]], Math.min(7, opps.length));
        else eq = equityMC(my.hole, v.board, opps, 300);
        eqCache = { key, val: eq };
      }
      r.eq = eqCache.val;
    }
    mine = r;
  }

  /* ---------- 아래: 내 패 ---------- */
  function renderMe() {
    const v = m.v, my = v.my, box = R("me");
    if (!my) { box.innerHTML = ""; return; }
    const s = v.seats[m.me], last = lastHere(v), wins = winnersOf(last);
    const shown = last && last.shows.find(x => x.p === m.me);
    const dealt = pops.has("deal");
    const core = !last && mine && mine.core ? mine.core : null;
    let cards;
    if (my.hole) cards = my.hole.map(c => cardHTML(c, (s.fold ? "dim" : "") + (dealt ? " pk-deal" : "") +
      ((shown && wins.has(m.me) && shown.best.includes(c)) || (core && !s.fold && core.includes(c)) ? " pk-hl" : ""))).join("");
    else cards = `<div class="pk-nohole">${s.out ? "탈락" : v.phase === "over" ? "" : "다음 판부터"}</div>`;
    // 지금 족보 · 드로우
    let made = "", sub = "";
    if (s.out) made = "";
    else if (s.fold && my.hole) made = '<span class="pk-folded">폴드</span>';
    else if (shown) made = `<span class="pk-mk">결과</span><b class="${wins.has(m.me) ? "pk-good" : ""}">${shown.hand}</b>`;
    else if (last) made = wins.has(m.me) ? '<b class="pk-good">이겼습니다</b>' : "";
    else if (mine) {
      made = `<span class="pk-mk">${mine.pre ? "내 패" : "현재"}</span><b>${mine.name}</b>${mine.detail ? `<span class="pk-dt">(${mine.detail})</span>` : ""}`;
      if (mine.pre && mine.top) sub = `시작 패 순위 ${mine.top <= 50 ? "상위" : "하위"} <b>${mine.top <= 50 ? mine.top : 100 - mine.top + 1}%</b> (상대 ${mine.nOpp}명 기준)`;
      else if (mine.onBoard) sub = "공용 카드로 된 패 — 다른 사람도 같이 가집니다";
      if (mine.draws && mine.draws.length) sub = (sub ? sub + " · " : "") + "다음 카드로 " + mine.draws.map(d => `${d.name} <b>${d.n}장</b>`).join(" · ");
    }
    const delta = last ? last.delta[m.me] : 0;
    box.innerHTML = `<div class="pk-hole">${cards}</div>
      <div class="pk-mine">
        <div class="pk-mystk"><b>${fmt(my.chips)}</b><small>칩</small>${badges(m.me)}${delta ? `<span class="pk-delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${fmt(delta)}</span>` : ""}</div>
        <div class="pk-mysub">${my.bet ? `<span>베팅 <b class="pk-bet${pops.has(m.me) ? " pop" : ""}">${fmt(my.bet)}</b></span>` : ""}${my.put && !last ? `<span>이번 판 ${fmt(my.put)}</span>` : ""}${s.allin && !s.fold && !last ? '<span class="pk-ab allin">올인</span>' : ""}</div>
        <div class="pk-made">${made}</div>
        ${sub ? `<div class="pk-draw">${sub}</div>` : ""}
      </div>`;
  }

  /* ---------- 계산 줄: 콜 · 콜 후 팟 · 팟 오즈 · 대략적인 승률 ---------- */
  function renderCalc() {
    const v = m.v, my = v.my, box = R("calc");
    const s = my ? v.seats[m.me] : null;
    const on = my && s && mine && !s.fold && !s.out && (v.phase === "bet" || v.phase === "deal");
    box.hidden = !on;
    if (!on) { box.innerHTML = ""; return; }
    const toCall = s.allin ? 0 : my.toCall, callAmt = s.allin ? 0 : my.callAmt;
    const after = v.potTotal + callAmt, odds = callAmt > 0 ? callAmt / after : 0;
    const cell = (k, val, cls = "", extra = "") => `<div class="pk-cc ${cls}"${extra}><small>${k}</small><b>${val}</b></div>`;
    let h = "";
    if (s.allin) h += cell("내 상태", "올인", "allin");
    else h += toCall > 0 ? cell("콜", fmt(callAmt), "call") : cell("콜", "0 · 체크", "free");
    h += cell(toCall > 0 ? "콜 후 팟" : "팟", fmt(after));
    h += cell("팟 오즈", toCall > 0 ? pct(odds) : "—", "", toCall > 0 ? ' title="콜 금액 ÷ 콜 후 팟"' : "");
    let eqTxt = "보기 ▸", cls = "eq off";
    if (showEq && mine.eq !== null) {
      eqTxt = pct(mine.eq);
      cls = "eq" + (toCall > 0 ? (mine.eq >= odds ? " good" : " bad") : "");
    } else if (showEq) eqTxt = "—";
    h += `<button class="pk-cc ${cls}" data-r="eqbtn" aria-pressed="${showEq}"><small>대략적인 승률</small><b>${eqTxt}</b></button>`;
    box.innerHTML = h;
    R("eqbtn").onclick = () => { showEq = !showEq; LSset(EQ_KEY, showEq ? "1" : "0"); renderCalc(); };
  }

  /* ---------- 행동 버튼 · 안내 ---------- */
  function renderActions() {
    const v = m.v, my = v.my, ask = myAsk();
    const s = my ? v.seats[m.me] : null;
    const kinds = ask && my ? my.kinds : [];
    R("dock").classList.toggle("pk-act", !!ask);
    wrap.classList.toggle("pk-raising", panel);
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
      hint = toCall > 0 ? `<b>내 차례</b> — 콜 ${fmt(callAmt)} · 레이즈 · 폴드 ${t}` : `<b>내 차례</b> — 체크하거나 ${v.curBet === 0 ? "벳" : "레이즈"}하세요 ${t}`;
    } else if (s.fold) hint = "폴드했습니다 — 이번 판은 구경";
    else if (s.allin) hint = "올인! 결과를 기다리는 중";
    else if (v.turn >= 0) hint = `<b>${esc(names()[v.turn])}</b> 님 차례 <span class="pk-tm" data-tm="${v.turn}"></span>`;
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
  /* 레이즈 크기 = (총액 − 지금 베팅) ÷ 콜 후 팟. ½ 팟 버튼이 50% */
  const potShare = x => { const v = m.v, my = v.my, base = v.potTotal + my.callAmt; return base > 0 ? (x - v.curBet) / base : 0; };
  function renderPanel() {
    const v = m.v, my = v.my;
    if (!my) return;
    const sl = R("slider");
    sl.min = my.minTo; sl.max = my.maxTo; sl.step = 1; sl.value = amt;
    sl.disabled = my.minTo >= my.maxTo;
    const all = amt >= my.maxTo, word = v.curBet === 0 ? "벳" : "레이즈";
    const add = amt - my.bet;
    R("rlabel").innerHTML = all ? "올인 <small>가진 칩 전부 · 이번 거리 총액</small>" : `${word} <small>이번 거리 총액</small>`;
    R("ramt").textContent = fmt(amt);
    R("rinfo").innerHTML = `칩 <b>${fmt(add)}</b> 더 냄 · 팟의 <b>${Math.round(potShare(amt) * 100)}%</b> · 낸 뒤 팟 <b>${fmt(v.potTotal + add)}</b> · 남는 칩 <b>${fmt(my.chips - add)}</b>`;
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

  /* 차례인 사람의 남은 시간 — 글자(⏱ 12초)와 자리판 아래 막대 */
  function startTick() {
    clearInterval(tickT);
    const v = m.v;
    if (v.turn < 0) return;
    const pe = m.pending.find(a => a.p === v.turn);
    const end = pe && pe.ms > 0 ? Date.now() + pe.ms : 0;
    const total = pe && (pe.total || (m.settings && m.settings.timer ? m.settings.timer * 1000 : 0));
    const paint = () => {
      const left = end ? Math.max(0, end - Date.now()) : 0, s = Math.ceil(left / 1000);
      for (const t of wrap.querySelectorAll(`[data-tm="${v.turn}"]`)) {
        if (!end) { t.textContent = v.turn === m.me ? "" : "생각 중…"; continue; }
        t.textContent = `⏱ ${s}초`;
        t.classList.toggle("low", s <= 5);
      }
      for (const b of wrap.querySelectorAll(`[data-tb="${v.turn}"]`)) {
        b.style.width = end && total ? `${Math.min(100, 100 * left / total)}%` : "100%";
        b.classList.toggle("low", !!end && s <= 5);
        b.classList.toggle("think", !end);
      }
    };
    paint();
    if (end) tickT = setInterval(paint, 250);
  }

  function update(msg) {
    m = msg;
    const ask = ctx.myAsk("bet");
    const id = ask ? ask.id : 0;
    if (id !== askId) { askId = id; panel = false; armed = ""; busy = false; clearTimeout(busyT); }
    effects(msg.ev || []);
    analyze();
    renderOpps();
    renderTable();
    renderMe();
    renderCalc();
    renderActions();
    startTick();
  }

  return {
    update,
    ticker: false,               // 펠트에 이번 판 기록을 직접 보여 주므로 위쪽 한 줄 기록은 숨긴다
    destroy() { clearInterval(tickT); clearTimeout(busyT); clearTimeout(armT); root.innerHTML = ""; }
  };
}
