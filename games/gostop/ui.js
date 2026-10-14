/* 고스톱 화면 — 위: 상대 (1~2명) · 가운데 펠트: 더미 · 방금 낸 패 · 바닥 (월별로 겹쳐 쌓기) · 아래: 내가 먹은 패 + 손패
   손패를 한 번 누르면 고르고(바닥의 같은 월이 빛남), 한 번 더 누르면 낸다. 흔들기 · 폭탄이 되면 작은 창으로 묻는다. */
import { CARDS, hwHTML, monthOf, isBonus, cardName, groupOf, SET_NAME } from "./cards.js";

const GROUPS = [["g", "광"], ["t", "띠"], ["y", "열끗"], ["p", "피"]];
const OFF = 15;                       // 바닥에서 같은 월 카드를 겹칠 때 아래로 내리는 간격(px)
const signed = x => (x > 0 ? "+" : "") + x;

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "gs");
  wrap.innerHTML = `
    <div class="gs-opps" data-r="opps"></div>
    <div class="gs-table felt" data-r="table">
      <div class="gs-top">
        <div class="gs-deck" data-r="deck"></div>
        <div class="gs-lastmv" data-r="lastmv"></div>
        <div class="gs-info" data-r="info"></div>
      </div>
      <div class="gs-floor" data-r="floor"></div>
      <div class="gs-pick" data-r="pick" hidden></div>
      <div class="gs-banner" data-r="banner"></div>
    </div>
    <div class="gs-mine" data-r="mine" role="button" tabindex="0" aria-label="내가 먹은 패 보기"></div>
    <div class="dock">
      <div class="hint" data-r="hint"></div>
      <div class="gs-hand" data-r="hand"></div>
    </div>
    <div class="gs-over" data-r="over" hidden></div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let M = null;                 // 마지막 msg
  let sel = null;               // 고른 손패
  let sentId = 0;               // 이미 답을 보낸 질문 id (두 번 보내지 않도록)
  let playAsk = 0;              // 마지막으로 본 내 「낼 차례」 질문 id
  let gsBox = null;             // 열린 고/스톱 창 {id, close}
  let hiddenRound = 0;          // 결과판을 닫은 판
  let prevFloor = null, prevHand = null, prevMine = null;
  const anim = new Set();       // 방금 나타난 카드 (짧은 등장 애니메이션)
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const name = p => (M && M.players[p] ? M.players[p].name : "?");
  const who = p => (M && p === M.me ? "나" : esc(name(p)));
  const open = kind => { const a = ctx.myAsk(kind); return a && a.id !== sentId ? a : null; };

  R("mine").onclick = () => { if (M) showCaps(M.me); };

  /* ---------------- 그리기 ---------------- */
  function update(m) {
    const fresh = m !== M;
    M = m;
    const v = m.v;
    if (!v || !v.caps) return;
    if (fresh) {
      const mine = v.caps[m.me] || [];
      anim.clear();
      for (const c of v.floor) if (prevFloor && !prevFloor.has(c)) anim.add(c);
      for (const c of v.hand) if (prevHand && !prevHand.has(c)) anim.add(c);
      for (const c of mine) if (prevMine && !prevMine.has(c)) anim.add(c);
      if (!prevFloor) for (const c of v.floor) anim.add(c);
      prevFloor = new Set(v.floor); prevHand = new Set(v.hand); prevMine = new Set(mine);
      if (anim.size) later(() => anim.clear(), 800);
      events(m);
    }
    if (sel && !v.hand.includes(sel)) sel = null;
    const pa = open("play");
    if (pa && pa.id !== playAsk) { playAsk = pa.id; sel = null; }     // 새 차례: 미리 골라 둔 카드는 풀어 준다 (바닥이 바뀌었을 수 있다)
    render();
  }

  function render() {
    if (!M) return;
    renderOpps(); renderTable(); renderMine(); renderHand(); renderHint(); renderOver();
    const g = open("gostop");
    if (g) openGoStop(g); else closeGoStop();
  }

  function renderOpps() {
    const v = M.v, me = M.me, box = R("opps");
    box.innerHTML = "";
    for (let k = 1; k < v.n; k++) {
      const q = (me + k) % v.n, pl = M.players[q] || { name: "?" }, sc = v.scores[q];
      const turn = ["play", "choose", "gostop"].includes(v.phase) && v.turn === q;
      const tags = [`<span class="gs-tag" title="손패">🂠 ${v.sizes[q]}</span>`];
      if (v.flips[q]) tags.push(`<span class="gs-tag">뒤집기 ${v.flips[q]}</span>`);
      if (v.go[q]) tags.push(`<span class="gs-tag go">${v.go[q]}고</span>`);
      for (const s of v.shook[q]) tags.push(`<span class="gs-tag sh">${s.bomb ? "💣" : "흔들"} ${s.m}월</span>`);
      const b = el("div", "gs-opp" + (turn ? " turn" : ""));
      b.setAttribute("role", "button");
      b.innerHTML = `<div class="gs-oh">${avatarHTML(pl.name, q, "sm")}<b class="nm">${esc(pl.name)}</b>` +
        (pl.kind === "ai" ? '<span class="ai">AI</span>' : pl.kind === "away" ? '<span class="away">자리 비움</span>' : "") +
        `${tags.join("")}<span class="gs-sc"><b>${sc.total}</b>점</span></div>` +
        `<div class="gs-og">${chips(v, q)}<span class="gs-tot">누적 ${signed(v.totals[q])}</span></div>`;
      b.onclick = () => showCaps(q);
      box.appendChild(b);
    }
  }
  /* 상대가 먹은 패: 종류별 장수 + 곧 날 것 같은 약 경고 */
  function chips(v, q) {
    const sc = v.scores[q];
    const out = [["g", "광", sc.g], ["t", "띠", sc.t], ["y", "열", sc.y], ["p", "피", sc.pi]]
      .map(([k, l, c]) => `<span class="gs-chip c-${k}${c ? "" : " zero"}">${l} <b>${c}</b></span>`);
    const dead = set => v.caps.some((cap, r) => r !== q && cap.some(id => CARDS[id].set === set));
    const warn = [];
    for (const s of ["hong", "cheong", "cho", "go"]) if (sc.sets[s] === 2 && !dead(s)) warn.push(`${SET_NAME[s]} 2/3`);
    if (sc.g === 2) warn.push("광 2/3");
    if (warn.length) out.push(`<span class="gs-chip warn">⚠ ${warn.join(" · ")}</span>`);
    return out.join("");
  }

  function renderTable() {
    const v = M.v, me = M.me;
    R("deck").innerHTML = v.deck ? `${hwHTML(null, "sm")}<b>${v.deck}</b>` : `<span class="gs-dim">더미 끝</span>`;
    R("info").innerHTML = `<b>${v.round}</b>/${v.rounds}판` + (v.nagari > 1 ? `<span class="gs-nag">나가리 ×${v.nagari}</span>` : "") +
      `<small>${v.th}점 나기</small>`;
    // 방금 (또는 지금 진행 중인) 차례
    const src = v.cur || v.last, lm = R("lastmv");
    if (src) {
      const cs = src.played.map(c => hwHTML(c, "sm")).join("") + (src.flipped.length ? `<i>→</i>${src.flipped.map(c => hwHTML(c, "sm")).join("")}` : "");
      const got = !v.cur && v.last && v.last.captured.length ? `<span class="got">+${v.last.captured.length}</span>` : v.cur ? '<span class="got wait">…</span>' : "";
      lm.innerHTML = `<span class="who">${who(src.p)}</span><span class="cs">${src.played.length ? "" : "<em>뒤집기</em>"}${cs}</span>${got}`;
    } else lm.innerHTML = "";

    // 바닥: 월별로 겹쳐 쌓기
    const fl = R("floor");
    fl.innerHTML = "";
    const byM = new Map();
    for (const c of v.floor) { const m = monthOf(c); if (!byM.has(m)) byM.set(m, []); byM.get(m).push(c); }
    const selM = sel && !isBonus(sel) ? monthOf(sel) : 0;
    const ask = open("choose");
    const opts = ask && v.ch ? v.ch.options : [];
    const cur = new Set(v.cur ? [...v.cur.played, ...v.cur.flipped] : []);
    const months = [...byM.keys()].sort((a, b) => a - b);
    if (selM && !byM.has(selM)) months.push(-selM);          // 낼 카드가 놓일 빈자리 표시
    for (const mm of months) {
      if (mm < 0) { fl.appendChild(el("div", "gs-stack ghost", `<span>${-mm}월<br>여기에</span>`)); continue; }
      const cs = byM.get(mm);
      const st = el("div", "gs-stack" + (mm === selM ? " match" : "") + (v.ppeok.includes(mm) ? " ppeok" : ""));
      st.style.height = `calc(var(--ch) + ${(cs.length - 1) * OFF}px)`;
      cs.forEach((c, i) => {
        const cls = [];
        if (anim.has(c)) cls.push("in");
        if (mm === selM) cls.push("can");
        if (opts.includes(c)) cls.push("pick");
        if (cur.has(c)) cls.push("cur");
        const d = el("div", "gs-fc", hwHTML(c, cls.join(" ")));
        d.style.top = i * OFF + "px";
        if (opts.includes(c)) { d.classList.add("tap"); d.onclick = () => send({ take: c }, "choose"); }
        st.appendChild(d);
      });
      if (v.ppeok.includes(mm)) st.insertAdjacentHTML("beforeend", '<span class="gs-pk">뻑</span>');
      fl.appendChild(st);
    }
    if (!v.floor.length && !selM) fl.innerHTML = '<div class="gs-dim">바닥이 비었습니다</div>';

    // 고르기: 큰 카드 두 장
    const pk = R("pick");
    if (opts.length) {
      pk.hidden = false;
      pk.innerHTML = `<div class="gs-pick-t">${v.ch.stage === "play" ? "낸" : "뒤집은"} ${v.ch.m}월 패로 <b>가져갈 카드</b>를 고르세요</div><div class="gs-pick-c"></div>`;
      const row = pk.querySelector(".gs-pick-c");
      for (const c of opts) {
        const b = el("button", "gs-pbtn", hwHTML(c, "lg") + `<small>${esc(cardName(c))}</small>`);
        b.onclick = () => send({ take: c }, "choose");
        row.appendChild(b);
      }
    } else pk.hidden = true;
  }

  function renderMine() {
    const v = M.v, me = M.me, sc = v.scores[me], box = R("mine");
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[me]) groups[groupOf(c, sc.guk)].push(c);
    const tags = (v.go[me] ? `<span class="gs-tag go">${v.go[me]}고</span>` : "") +
      v.shook[me].map(s => `<span class="gs-tag sh">${s.bomb ? "💣" : "흔들"} ${s.m}월</span>`).join("");
    const turn = ["play", "choose", "gostop"].includes(v.phase) && v.turn === me;
    box.className = "gs-mine" + (turn ? " turn" : "");
    box.innerHTML = `<div class="gs-mh"><b class="gs-my">${sc.total}<small>점</small></b>` +
      `<span class="gs-brk">광 ${sc.gp} · 띠 ${sc.tp} · 열끗 ${sc.yp} · 피 ${sc.pp}</span>${tags}` +
      `<span class="gs-tot">누적 ${signed(v.totals[me])}</span></div><div class="gs-piles"></div>`;
    const piles = box.querySelector(".gs-piles");
    for (const [k, label] of GROUPS) {
      const cs = groups[k], count = k === "p" ? sc.pi : cs.length;
      const p = el("div", `gs-pile p-${k}`, `<div class="gs-pc">${cs.map(c => hwHTML(c, "mini" + (anim.has(c) ? " in" : ""))).join("")}</div>` +
        `<span class="gs-pl">${label} <b>${count}</b></span>`);
      piles.appendChild(p);
    }
    // 겹치기: 묶음 폭에 맞춰 카드 간격을 줄인다
    for (const pc of piles.querySelectorAll(".gs-pc")) {
      const cards = pc.children, k = cards.length;
      if (k < 2) continue;
      const W = pc.clientWidth || 70, cw = 20;
      const step = Math.min(cw + 2, (W - cw) / (k - 1));
      for (let i = 1; i < k; i++) cards[i].style.marginLeft = (step - cw) + "px";
    }
  }

  function renderHand() {
    const v = M.v, me = M.me, hand = R("hand");
    const ask = open("play");
    const flips = v.flips[me] || 0;
    const count = v.hand.length + (flips ? 1 : 0);
    hand.innerHTML = "";
    if (!count) {
      hand.style.gridTemplateColumns = "1fr";
      hand.innerHTML = `<div class="gs-dim gs-nohand">${["roundEnd", "over"].includes(v.phase) ? "" : "손패를 다 냈습니다"}</div>`;
      return;
    }
    const W = hand.clientWidth || 340, tall = (wrap.clientHeight || 0) > 680;
    const per = count <= 7 ? count : Math.ceil(count / 2);            // 8장 이상이면 두 줄
    const cw = Math.max(34, Math.min(count > 7 ? (tall ? 52 : 46) : (tall ? 58 : 54), Math.floor((W - (per - 1) * 5) / per)));
    hand.style.setProperty("--hw", cw + "px");
    hand.style.gridTemplateColumns = `repeat(${per}, ${cw}px)`;
    for (const c of v.hand) {
      const m = isBonus(c) ? 0 : monthOf(c);
      const matches = m ? v.floor.filter(x => monthOf(x) === m).length : 0;
      const sp = m && v.can ? (v.can.bomb.includes(m) ? "💣" : v.can.shake.includes(m) ? "흔들" : "") : "";
      const cls = [];
      if (c === sel) cls.push("sel");
      if (ask && (matches || isBonus(c))) cls.push("can");
      if (anim.has(c)) cls.push("in");
      const b = el("button", "gs-hc", hwHTML(c, cls.join(" ")) + (sp ? `<span class="gs-sp">${sp}</span>` : ""));
      b.setAttribute("aria-label", cardName(c));
      b.onclick = () => tap(c);
      hand.appendChild(b);
    }
    if (flips) {
      const b = el("button", "gs-hc gs-flip", `<div class="hw back${ask ? " can" : ""}"><i></i></div><span class="gs-fl">뒤집기<br>×${flips}</span>`);
      b.setAttribute("aria-label", "패 뒤집기만 하기");
      b.onclick = () => { if (open("play")) send({ flip: true }, "play"); else ctx.toast("내 차례에 누르세요"); };
      hand.appendChild(b);
    }
  }

  /* 고른 카드를 내면 어떻게 되는지 */
  function describe(v, c) {
    if (isBonus(c)) return `${esc(cardName(c))} — 내면 바로 내 피가 되고 한 장 더 받습니다`;
    const m = monthOf(c), F = v.floor.filter(x => monthOf(x) === m);
    let t;
    if (v.can && v.can.bomb.includes(m)) t = `${m}월 3장 + 바닥 1장 — <b>폭탄</b> 가능`;
    else if (!F.length) t = `바닥에 ${m}월이 없어 그대로 깔립니다` + (v.can && v.can.shake.includes(m) ? " (흔들기 가능)" : "");
    else if (F.length === 1) t = `바닥 ${esc(cardName(F[0]))}와 짝`;
    else if (F.length === 2) t = `바닥 ${m}월 2장 중 하나를 골라 먹습니다`;
    else t = v.ppeok.includes(m) ? `뻑 3장을 모두 먹고 피를 뺏습니다!` : `${m}월 3장을 모두 먹습니다!`;
    return t;
  }

  function renderHint() {
    const v = M.v, me = M.me, h = R("hint");
    let t;
    if (v.phase === "over") t = "게임 끝";
    else if (v.phase === "roundEnd") t = v.round >= v.rounds ? "마지막 판이 끝났습니다" : "곧 다음 판이 시작됩니다";
    else if (open("choose")) t = "<b>가져갈 바닥 카드</b>를 고르세요";
    else if (open("gostop")) t = "<b>고? 스톱?</b>";
    else if (open("play")) t = sel ? `${describe(v, sel)} — <b>한 번 더 누르면 냅니다</b>` : v.hand.length ? "<b>내 차례</b> — 낼 카드를 누르세요" : "<b>내 차례</b> — 「뒤집기」를 누르세요";
    else if (sel) t = describe(v, sel);
    else if (v.turn === me) t = "…";
    else t = `${esc(name(v.turn))} 님 ${v.phase === "choose" ? "카드 고르는 중" : v.phase === "gostop" ? "고/스톱 고민 중" : "차례"}`;
    h.innerHTML = t;
  }

  /* ---------------- 판 결과 ---------------- */
  function renderOver() {
    const v = M.v, box = R("over"), r = v.result;
    if (!r || !["roundEnd", "over"].includes(v.phase) || hiddenRound === r.round) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = resultHTML(v, r) + `<div class="gs-ofoot"><small>${v.phase === "over" || v.round >= v.rounds ? "마지막 판이었습니다" : "잠시 후 다음 판"}</small><button class="btn small">닫기</button></div>`;
    box.querySelector(".gs-ofoot button").onclick = () => { hiddenRound = r.round; box.hidden = true; };
  }
  function resultHTML(v, r) {
    const me = M.me;
    let h = `<div class="eyebrow">${r.round}판 결과</div>`;
    if (r.kind === "nagari") {
      h += `<h3>나가리</h3><p>아무도 스톱하지 못했습니다. 다음 판 점수는 <b>×${r.nagari}</b></p>`;
    } else if (r.kind === "chongtong") {
      h += `<h3>${r.winner === me ? "총통! 🎉" : `${who(r.winner)} 님 총통!`}</h3><div class="gs-rcards">${r.cards.map(c => hwHTML(c, "md")).join("")}</div>` +
        `<p>${r.m}월 4장 — <b>10점</b>${r.nagari > 1 ? ` × 나가리 ${r.nagari}` : ""}</p>` + payHTML(r);
    } else {
      const s = r.score;
      h += `<h3>${r.winner === me ? "이겼습니다! 🎉" : `${who(r.winner)} 님 승리`}${r.how === "auto" ? " <small>(패를 다 내서 자동 스톱)</small>" : ""}</h3>`;
      h += `<div class="gs-items">${s.items.map(([l, p]) => `<span>${esc(l)} <b>${p}</b></span>`).join("")}</div>`;
      let calc = `${r.base}점`;
      if (r.go) calc += ` + ${r.go}고 ${r.go}점`;
      if (r.goMul > 1) calc = `(${calc}) × ${r.goMul} (${r.go}고)`;
      h += `<p class="gs-calc">${calc} = <b>${r.pts}점</b></p>`;
      const mul = [];
      if (r.shakes) mul.push(`흔들기·폭탄 ×${2 ** r.shakes}`);
      if (r.nagari > 1) mul.push(`나가리 ×${r.nagari}`);
      if (mul.length) h += `<p class="gs-calc">모두에게: ${mul.join(" · ")}</p>`;
      h += payHTML(r);
    }
    h += `<div class="gs-totals">${M.players.map((pl, p) => `<span class="${p === me ? "me" : ""}">${who(p)} <b>${signed(v.totals[p])}</b>` +
      `${r.deltas && r.deltas[p] ? `<small>(${signed(r.deltas[p])})</small>` : ""}</span>`).join("")}</div>`;
    return h;
  }
  function payHTML(r) {
    if (!r.losers || !r.losers.length) return "";
    const rows = r.losers.map(l => {
      const t = [];
      if (l.pibak) t.push("피박 ×2");
      if (l.gwangbak) t.push("광박 ×2");
      if (l.meongbak) t.push("멍박 ×2");
      if (l.gobak) t.push("고박 — 두 사람 몫");
      if (l.covered) t.push("고박 덕에 면제");
      return `<tr><td>${who(l.p)}</td><td>${t.map(x => `<span class="gs-mul">${x}</span>`).join("") || '<span class="gs-dim">배수 없음</span>'}</td><td class="pay">−${l.pay}</td></tr>`;
    }).join("");
    return `<table class="gs-pay"><tbody>${rows}</tbody></table>`;
  }

  /* ---------------- 고 · 스톱 창 ---------------- */
  function openGoStop(ask) {
    if (gsBox && gsBox.id === ask.id) return;
    closeGoStop();
    const v = M.v, me = M.me, sc = v.scores[me], pv = v.preview;
    const entry = { id: ask.id, close: null };
    gsBox = entry;
    ctx.sound.good();
    ctx.modal((box, close) => {
      entry.close = close;
      const goN = v.go[me] + 1;
      ctx.head(box, v.go[me] ? `${v.go[me]}고 하는 중` : "났습니다!", `${sc.total}점 — 고? 스톱?`,
        sc.items.map(([l, p]) => `${esc(l)} ${p}점`).join(" · "));
      const stopGain = pv ? pv.deltas[me] : 0;
      const lines = [];
      if (pv) {
        const mults = pv.losers.map(l => {
          const t = [l.pibak && "피박", l.gwangbak && "광박", l.meongbak && "멍박", l.gobak && "고박"].filter(Boolean);
          return `${who(l.p)} −${l.pay}${t.length ? ` (${t.join("·")})` : ""}`;
        });
        lines.push(`<li><b>스톱</b>: 지금 끝내고 <b>${stopGain}점</b>을 받습니다 — ${mults.join(", ")}</li>`);
      }
      lines.push(`<li><b>${goN}고</b>: 판을 계속합니다. ${goN <= 2 ? `+${goN}점` : `점수에 ×${2 ** (goN - 2)}`} — 다음에 점수가 더 나야 다시 고/스톱을 고를 수 있습니다.</li>`);
      lines.push(`<li>상대가 먼저 나면 내가 집니다${v.n === 3 ? " — <b>고박</b>: 두 사람 몫을 혼자 냅니다" : ""}. 아무도 못 나면 나가리.</li>`);
      lines.push(`<li>내 남은 패 ${v.hand.length + (v.flips[me] || 0)}장 · 더미 ${v.deck}장</li>`);
      box.appendChild(el("ul", "gs-golist", lines.join("")));
      ctx.buttonRow(box, [
        { label: "스톱", on: () => { if (send({ go: false }, "gostop")) close(); } },
        { label: `${goN}고!`, primary: true, on: () => { if (send({ go: true }, "gostop")) close(); } }
      ]);
    }, { dismissible: false }).then(() => { if (gsBox === entry) gsBox = null; });
  }
  function closeGoStop() {
    if (gsBox) { const b = gsBox; gsBox = null; if (b.close) b.close(null); }
  }

  /* ---------------- 먹은 패 보기 ---------------- */
  function showCaps(q) {
    const v = M.v, sc = v.scores[q];
    const groups = { g: [], t: [], y: [], p: [] };
    for (const c of v.caps[q]) groups[groupOf(c, sc.guk)].push(c);
    const pts = { g: sc.gp, t: sc.tp, y: sc.yp, p: sc.pp };
    ctx.modal(box => {
      ctx.head(box, "먹은 패", `${q === M.me ? "나" : esc(name(q))} — ${sc.total}점`,
        sc.items.length ? sc.items.map(([l, p]) => `${esc(l)} ${p}점`).join(" · ") : "아직 점수가 없습니다");
      for (const [k, label] of GROUPS) {
        const cs = groups[k];
        const guk = sc.guk && cs.includes("9a") ? ` <small>(9월 국진을 ${k === "p" ? "쌍피" : "열끗"}로 셈)</small>` : "";
        box.insertAdjacentHTML("beforeend", `<div class="gs-mg"><div class="gs-mgh">${label} ${k === "p" ? `${sc.pi}장 <small>(쌍피 2 · 쓰리피 3)</small>` : `${cs.length}장`}` +
          ` · <b>${pts[k]}점</b>${guk}</div>` +
          `<div class="gs-mgc">${cs.map(c => hwHTML(c, "md")).join("") || '<span class="gs-dim">없음</span>'}</div></div>`);
      }
    });
  }

  /* ---------------- 행동 보내기 ---------------- */
  function tap(c) {
    if (sel !== c) { sel = c; render(); return; }
    if (!open("play")) { ctx.toast("아직 내 차례가 아닙니다"); return; }
    play(c);
  }
  async function play(c) {
    const v = M.v;
    if (isBonus(c)) { send({ bonus: c }, "play"); return; }
    const m = monthOf(c);
    let a = { card: c };
    if (v.can && v.can.bomb.includes(m)) {
      const r = await ctx.choose(`${m}월 폭탄?`, `${m}월 3장을 들고 있고 바닥에 나머지 1장이 있습니다.`, [
        { value: "bomb", label: "💣 폭탄 — 3장을 한꺼번에", note: "4장을 다 먹고 상대마다 피 1장씩 · 이기면 ×2 · 뒤집기만 하는 차례 2번" },
        { value: "one", label: "한 장만 내기", note: "바닥의 1장과 짝" }]);
      if (!r) return;
      if (r === "bomb") a.bomb = true;
    } else if (v.can && v.can.shake.includes(m)) {
      const r = await ctx.choose(`${m}월 흔들기?`, `${m}월 3장을 들고 있습니다. 흔들면 3장을 모두에게 보여 주고, 이 판을 이기면 점수 ×2.`, [
        { value: "shake", label: "흔들고 내기", note: "이기면 ×2" },
        { value: "one", label: "그냥 내기" }]);
      if (!r) return;
      if (r === "shake") a.shake = true;
    }
    send(a, "play");
  }
  function send(a, kind) {
    const ask = open(kind);
    if (!ask) return false;
    if (!ctx.send(a)) return false;
    sentId = ask.id; sel = null;
    render();
    return true;
  }

  /* ---------------- 이벤트: 소리 · 큰 글씨 ---------------- */
  let bannerT = 0;
  function banner(text, cls = "") {
    const b = R("banner");
    b.innerHTML = `<b class="${cls}">${esc(text)}</b>`;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => { b.innerHTML = ""; }, 1500);
  }
  function events(m) {
    const me = m.me, S = ctx.sound;
    for (const e of m.ev) {
      if (e.type === "deal") S.deal();
      else if (e.type === "play") S.place();
      else if (e.type === "flip") later(() => S.flip(), 230);
      else if (e.type === "bonus" && !e.floor) { if (e.p === me) S.good(); }
      else if (e.type === "turn") {
        if (e.captured.length) later(() => S.deal(), 430);
        const robbed = e.stolen.some(s => s.from === me);
        if (e.combos.length) {
          banner(e.combos.join(" · ") + "!", e.p === me ? "good" : robbed ? "bad" : "");
          later(() => (e.p === me ? S.good() : robbed ? S.bad() : S.chip()), 520);
          if (e.p === me) ctx.buzz(40);
        }
      } else if (e.type === "go") { banner(`${e.go}고!`, "go"); S.chip(); }
      else if (e.type === "roundEnd") { banner(e.winner === me ? "스톱! 승리" : "스톱!", e.winner === me ? "good" : "bad"); later(() => (e.winner === me ? S.good() : S.bad()), 300); }
      else if (e.type === "nagari") { banner("나가리", ""); S.pass(); }
      else if (e.type === "chongtong") { banner("총통!", e.p === me ? "good" : "bad"); later(() => (e.p === me ? S.good() : S.bad()), 300); }
    }
  }

  let lastW = 0;
  function onResize() { const w = wrap.clientWidth; if (w !== lastW) { lastW = w; render(); } }
  window.addEventListener("resize", onResize);

  return {
    update,
    destroy() {
      window.removeEventListener("resize", onResize);
      for (const t of timers) clearTimeout(t);
      clearTimeout(bannerT);
      closeGoStop();
      root.innerHTML = "";
    }
  };
}
