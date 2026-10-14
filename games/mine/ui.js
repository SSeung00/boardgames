/* 금광 탐험 화면 — 위: 자리 · 정보 줄 · 가운데: 굴 판 (밀어서 이동, −/+ 확대) · 아래: 내 패와 버튼 */

const GOAL_NAME = ["위쪽", "가운데", "아래쪽"];
const TOOL_ICON = { pick: "⛏", lamp: "🔦", cart: "🛒" };
const TOOL_NAME = { pick: "곡괭이", lamp: "등불", cart: "수레" };
const ZOOMS = [28, 34, 40, 48, 56];
const rot180 = m => ((m << 2) | (m >> 2)) & 15;
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); };

/* 굴 그림 — 40×40 기준 SVG. 면 비트: 북 1 · 동 2 · 남 4 · 서 8. 막다른 길은 가운데가 돌무더기 */
const END = [[20, -3], [43, 20], [20, 43], [-3, 20]];
const STUB = [[20, 12], [28, 20], [20, 28], [12, 20]];
function tunnelSVG(e, c, extra = "") {
  let lines = "";
  for (let d = 0; d < 4; d++) if (e >> d & 1) {
    const [x2, y2] = END[d], [x1, y1] = c ? [20, 20] : STUB[d];
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  const rocks = c ? "" : `<g class="mn-rk"><circle cx="20" cy="20" r="8"/><circle cx="14.5" cy="16" r="4.6"/><circle cx="25.5" cy="23.5" r="4.2"/><circle cx="23" cy="14" r="3"/></g>`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><g class="mn-t0">${lines}</g><g class="mn-t1">${lines}</g>${rocks}${extra}</svg>`;
}
const COAL = `<g class="mn-coal"><circle cx="17" cy="21" r="4.2"/><circle cx="23.5" cy="18.5" r="3.6"/><circle cx="22" cy="24.5" r="3"/></g>`;
const GOLD = `<g class="mn-gold"><path d="M12 25l4-8h8l4 8z"/><path d="M15.5 18.5l2.5-5h4l2.5 5z"/></g>`;
const LADDER = `<g class="mn-lad"><path d="M15 11v18M25 11v18M15 15h10M15 20h10M15 25h10"/></g>`;

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "mn");
  wrap.innerHTML = `
    <div class="seatrow mn-seats" data-r="seats"></div>
    <div class="mn-bar">
      <span class="mn-info" data-r="info"></span>
      <button class="mn-role" data-r="role" aria-label="내 역할 보기"></button>
      <button class="mn-zb" data-r="res" hidden>결과</button>
      <span class="mn-zoom"><button class="mn-zb" data-z="-1" aria-label="축소">−</button><button class="mn-zb" data-z="1" aria-label="확대">+</button></span>
    </div>
    <div class="mn-mid">
      <div class="mn-frame" data-r="frame"><div class="mn-grid" data-r="grid"></div></div>
      <div class="mn-over" data-r="over" hidden></div>
    </div>
    <div class="dock mn-dock">
      <div class="hint" data-r="hint"></div>
      <div class="mn-hand" data-r="hand"></div>
      <div class="mn-acts" data-r="acts"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);

  let last = null;               // 마지막 msg
  let sel = null, rot = 0;       // 고른 카드 · 길 카드 방향
  let ghost = null;              // 놓을(무너뜨릴) 자리 {x, y}
  let zoom = 1, zoomSet = false;
  let roleOpen = false, roleT = 0;
  let overHidden = false;
  let prevGeo = null;            // 판 스크롤 유지용 {x0, y0, cs}
  let busy = false;
  const seen = new WeakSet();    // 이미 소리 · 애니메이션을 낸 이벤트 묶음

  /* ---------- 지금 고른 카드로 할 수 있는 일 ---------- */
  const myTurn = () => !!(last && ctx.myAsk("turn") && last.v.phase === "play");
  const selCard = () => (last && sel !== null ? last.v.hand.find(c => c.id === sel) || null : null);
  const brokenMe = v => v.broken[last.me].length > 0;
  function spotsFor(v, c, r) {               // 길 카드를 놓을 수 있는 자리
    if (!v.legal || !v.legal[c.id]) return [];
    return v.legal[c.id].filter(s => s[2] === r);
  }
  function breakTargets(v, c) {
    const out = [];
    for (let p = 0; p < v.n; p++) if (p !== last.me && !v.broken[p].includes(c.tool)) out.push(p);
    return out;
  }
  function fixTargets(v, c) {                // [{p, tool}]
    const out = [];
    for (let p = 0; p < v.n; p++) for (const t of c.tools) if (v.broken[p].includes(t)) out.push({ p, tool: t });
    return out;
  }
  const mapGoals = v => [0, 1, 2].filter(g => !v.goals[g].rev && !v.goals[g].kind);
  const rockCells = v => v.board.filter(b => b.k === "p");
  function usable(v, c) {
    if (c.t === "path") return !brokenMe(v) && v.legal && v.legal[c.id] && v.legal[c.id].length > 0;
    if (c.t === "break") return breakTargets(v, c).length > 0;
    if (c.t === "fix") return fixTargets(v, c).length > 0;
    if (c.t === "map") return mapGoals(v).length > 0;
    if (c.t === "rock") return rockCells(v).length > 0;
    return false;
  }

  function send(a) {
    if (busy) return;
    if (ctx.send(a)) { busy = true; sel = null; ghost = null; setTimeout(() => { busy = false; }, 600); }
    if (last) render(last, null);
  }

  /* ---------- 이벤트 효과 ---------- */
  function effects(m) {
    const me = m.me, marks = { fresh: new Set(), flip: new Set(), dust: [], hit: new Set() };
    for (const e of m.ev) {
      if (e.type === "path") { marks.fresh.add(e.x + "," + e.y); ctx.sound.place(); }
      else if (e.type === "reveal") { marks.flip.add(e.x + "," + e.y); e.gold ? ctx.sound.good() : ctx.sound.flip(); }
      else if (e.type === "break") { marks.hit.add(e.target); if (e.target === me) { ctx.sound.bad(); ctx.buzz(120); } else ctx.sound.chip(); }
      else if (e.type === "repair") { marks.hit.add(e.target); e.target === me ? ctx.sound.good() : ctx.sound.chip(); }
      else if (e.type === "rock") { marks.dust.push([e.x, e.y]); ctx.sound.pass(); }
      else if (e.type === "discard") ctx.sound.deal();
      else if (e.type === "map") {
        if (e.p === me && e.gold !== undefined) peekModal(e.goal, e.gold);
        else ctx.sound.flip();
      } else if (e.type === "round") {
        overHidden = false;
        if (e.round < m.v.rounds) (e.roles[me] === e.winner) ? ctx.sound.win() : ctx.sound.lose();   // 마지막 라운드는 결과 창이 소리를 낸다
      } else if (e.type === "newround") { roleOpen = false; overHidden = false; sel = null; ghost = null; ctx.sound.deal(); }
    }
    return marks;
  }
  function peekModal(g, gold) {
    ctx.sound.flip();
    ctx.modal((box, close) => {
      ctx.head(box, "지도 · 나만 아는 정보", `${GOAL_NAME[g]} 목표는 ${gold ? "금" : "석탄"}입니다`, "판의 목표 카드에 👁 표시를 해 두었습니다. 다른 사람은 내가 무엇을 봤는지 모릅니다.");
      box.appendChild(el("div", "mn-peekbig " + (gold ? "gold" : "coal"), tunnelSVG(gold ? 15 : 0, true, gold ? GOLD : COAL)));
      ctx.buttonRow(box, [{ label: "확인", primary: true, on: () => close() }]);
    });
  }

  /* ---------- 자리 ---------- */
  function seats(m, marks) {
    const v = m.v, box = R("seats"), c = selCard(), mt = myTurn();
    const pickable = new Set();
    if (mt && c && c.t === "break") breakTargets(v, c).forEach(p => pickable.add(p));
    if (mt && c && c.t === "fix") fixTargets(v, c).forEach(o => pickable.add(o.p));
    box.innerHTML = "";
    m.players.forEach((pl, p) => {
      const chip = el("button", "seatchip mn-chip" + (p === v.turn && v.phase === "play" ? " turn" : "") + (p === m.me ? " me" : "")
        + (pickable.has(p) ? " mn-pick" : "") + (marks && marks.hit.has(p) ? " mn-hit" : ""));
      chip.disabled = !pickable.has(p);
      const bk = v.broken[p].map(t => `<span class="mn-bk" title="${TOOL_NAME[t]} 고장">${TOOL_ICON[t]}</span>`).join("");
      const role = v.roles ? `<span class="mn-rtag ${v.roles[p]}">${v.roles[p] === "s" ? "방해꾼" : "광부"}</span>` : "";
      chip.innerHTML = `${avatarHTML(pl.name, p, "sm")}<span class="nm">${esc(pl.name)}</span>` +
        (pl.kind === "ai" ? '<span class="ai">AI</span>' : pl.kind === "away" ? '<span class="away">자리 비움</span>' : "") + role +
        `<span class="sub">🂠${v.sizes[p]}${bk ? " " + bk : ""} <span class="mn-g">💰${v.gold[p]}</span></span>`;
      chip.onclick = () => pickTarget(p);
      box.appendChild(chip);
    });
  }
  function pickTarget(p) {
    const v = last.v, c = selCard();
    if (!c || !myTurn()) return;
    if (c.t === "break") send({ break: c.id, target: p });
    else if (c.t === "fix") {
      const opts = fixTargets(v, c).filter(o => o.p === p);
      if (opts.length === 1) send({ repair: c.id, target: p, tool: opts[0].tool });
      else if (opts.length > 1) ctx.choose("어느 도구를 고칠까요?", "", opts.map(o => ({ value: o.tool, label: `${TOOL_ICON[o.tool]} ${TOOL_NAME[o.tool]}` })))
        .then(t => { if (t) send({ repair: c.id, target: p, tool: t }); });
    }
  }

  /* ---------- 정보 줄 · 역할 ---------- */
  function info(m) {
    const v = m.v;
    R("info").innerHTML = `<b>${v.round}</b>/${v.rounds} 라운드 · 덱 <b>${v.deck}</b>장`;
    const rb = R("role");
    rb.className = "mn-role" + (roleOpen ? " open " + v.role : "");
    rb.innerHTML = roleOpen ? (v.role === "s" ? "😈 방해꾼" : "⛏ 광부") : "🎭 내 역할";
    R("res").hidden = !(v.phase !== "play" && overHidden);
  }
  R("role").onclick = () => {
    roleOpen = !roleOpen;
    clearTimeout(roleT);
    if (roleOpen) roleT = setTimeout(() => { roleOpen = false; if (last) info(last); }, 4000);
    if (last) info(last);
  };
  R("res").onclick = () => { overHidden = false; if (last) render(last, null); };
  wrap.querySelectorAll("[data-z]").forEach(b => b.onclick = () => {
    zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom + +b.dataset.z));
    zoomSet = true;
    if (last) board(last, null);
  });

  /* ---------- 판 ---------- */
  function board(m, marks) {
    const v = m.v, b = v.bounds, frame = R("frame"), grid = R("grid");
    const cols = b.x1 - b.x0 + 1, rows = b.y1 - b.y0 + 1;
    if (!zoomSet && frame.clientWidth) {
      zoom = 0;
      for (let i = 0; i < ZOOMS.length; i++) if (cols * ZOOMS[i] <= frame.clientWidth - 6) zoom = i;
      zoom = Math.max(1, Math.min(zoom, 2));   // 34~40px — 작은 폰에서는 판만 옆으로 밀어 본다
      zoomSet = true;
    }
    const cs = ZOOMS[zoom];
    // 판이 왼쪽 · 위로 넓어지거나 확대가 바뀌어도 보던 곳이 그대로 보이게
    let keep = null;
    if (prevGeo && (prevGeo.x0 !== b.x0 || prevGeo.y0 !== b.y0 || prevGeo.cs !== cs)) {
      keep = { cx: (frame.scrollLeft + frame.clientWidth / 2) / prevGeo.cs + prevGeo.x0, cy: (frame.scrollTop + frame.clientHeight / 2) / prevGeo.cs + prevGeo.y0 };
    }
    const first = !prevGeo;
    prevGeo = { x0: b.x0, y0: b.y0, cs };
    grid.style.setProperty("--cs", cs + "px");
    grid.style.width = cols * cs + "px";
    grid.style.height = rows * cs + "px";
    const pos = (x, y) => `left:${(x - b.x0) * cs}px;top:${(y - b.y0) * cs}px`;
    const c = selCard(), mt = myTurn();
    let h = "";
    for (const t of v.board) {
      const kk = t.x + "," + t.y;
      let cls = "mn-c mn-tile", inner = "";
      if (t.k === "s") { cls += " mn-start"; inner = tunnelSVG(15, true, LADDER) + '<i class="mn-lbl">입구</i>'; }
      else if (t.k === "p") { inner = tunnelSVG(t.e, t.c); if (!t.c) cls += " dead"; }
      else {
        const gl = v.goals[t.g];
        if (t.rev) { cls += " mn-goal rev " + (t.gold ? "gold" : "coal"); inner = tunnelSVG(t.e, true, t.gold ? GOLD : COAL); }
        else {
          cls += " mn-goal down" + (gl.kind ? " " + gl.kind : "");
          inner = gl.kind && !gl.peek ? `<span class="mn-q">${gl.kind === "gold" ? "💰" : "⚫"}</span>`   // 라운드 끝: 모두 공개
            : `<span class="mn-q">?</span>` + (gl.peek ? `<span class="mn-peek">👁${gl.kind === "gold" ? "💰" : "⚫"}</span>` : "");
        }
      }
      if (v.last && v.last.x === t.x && v.last.y === t.y && v.last.t === "path") cls += " mn-last";
      if (marks && marks.fresh.has(kk)) cls += " mn-new";
      if (marks && marks.flip.has(kk)) cls += " mn-flip";
      h += `<div class="${cls}" style="${pos(t.x, t.y)}">${inner}</div>`;
    }
    if (marks) for (const [x, y] of marks.dust) h += `<div class="mn-c mn-dust" style="${pos(x, y)}"></div>`;
    // 고른 카드에 따라 누를 수 있는 칸
    if (mt && c) {
      if (c.t === "path" && !brokenMe(v)) {
        for (const [x, y] of spotsFor(v, c, rot)) h += `<button class="mn-c mn-spot${ghost && ghost.x === x && ghost.y === y ? " on" : ""}" style="${pos(x, y)}" data-x="${x}" data-y="${y}" aria-label="${x},${y} 에 놓기"></button>`;
        if (ghost) h += `<div class="mn-c mn-tile mn-ghost${c.c ? "" : " dead"}" style="${pos(ghost.x, ghost.y)}">${tunnelSVG(rot ? rot180(c.e) : c.e, c.c)}</div>`;
      } else if (c.t === "rock") {
        for (const t of rockCells(v)) h += `<button class="mn-c mn-spot rock${ghost && ghost.x === t.x && ghost.y === t.y ? " on" : ""}" style="${pos(t.x, t.y)}" data-x="${t.x}" data-y="${t.y}" aria-label="${t.x},${t.y} 무너뜨리기"></button>`;
      } else if (c.t === "map") {
        for (const g of mapGoals(v)) { const gl = v.goals[g]; h += `<button class="mn-c mn-spot map" style="${pos(gl.x, gl.y)}" data-g="${g}" aria-label="${GOAL_NAME[g]} 목표 보기"></button>`; }
      }
    }
    grid.innerHTML = h;
    if (keep) {
      frame.scrollLeft = (keep.cx - b.x0) * cs - frame.clientWidth / 2;
      frame.scrollTop = (keep.cy - b.y0) * cs - frame.clientHeight / 2;
    } else if (first) {
      frame.scrollLeft = 0;
      frame.scrollTop = Math.max(0, (0 - b.y0 + .5) * cs - frame.clientHeight / 2);
    }
  }
  R("grid").addEventListener("click", e => {
    const t = e.target.closest("[data-x],[data-g]");
    if (!t || !last || !myTurn()) return;
    const c = selCard();
    if (!c) return;
    if (t.dataset.g !== undefined) { if (c.t === "map") send({ map: c.id, goal: +t.dataset.g }); return; }
    const x = +t.dataset.x, y = +t.dataset.y;
    if (ghost && ghost.x === x && ghost.y === y) { confirm(); return; }   // 같은 칸을 한 번 더 → 확정
    ghost = { x, y };
    ctx.sound.tick();
    render(last, null);
  });
  function confirm() {
    const c = selCard();
    if (!c || !ghost) return;
    if (c.t === "path") send({ path: c.id, x: ghost.x, y: ghost.y, rot });
    else if (c.t === "rock") send({ rock: c.id, x: ghost.x, y: ghost.y });
  }

  /* ---------- 손패 ---------- */
  function cardFace(c, r) {
    if (c.t === "path") return `<span class="mn-mini${c.c ? "" : " dead"}" style="transform:rotate(${r}deg)">${tunnelSVG(c.e, c.c)}</span><small>${c.c ? "길" : "막힘"}</small>`;
    if (c.t === "break") return `<span class="mn-ic"><span class="mn-bk big">${TOOL_ICON[c.tool]}</span></span><small>${TOOL_NAME[c.tool]} 고장</small>`;
    if (c.t === "fix") return `<span class="mn-ic fix">${c.tools.map(t => TOOL_ICON[t]).join(c.tools.length > 1 ? "<i>/</i>" : "")}</span><small>${c.tools.length > 1 ? "둘 중 하나 수리" : TOOL_NAME[c.tools[0]] + " 수리"}</small>`;
    if (c.t === "map") return `<span class="mn-ic">🗺️</span><small>지도</small>`;
    return `<span class="mn-ic">🪨</span><small>낙석</small>`;
  }
  function hand(m) {
    const v = m.v, box = R("hand"), mt = myTurn();
    box.innerHTML = "";
    if (!v.hand.length) { box.innerHTML = `<div class="mn-empty">${v.phase === "play" ? "손패가 없습니다 — 라운드가 끝나길 기다려요" : ""}</div>`; return; }
    for (const c of v.hand) {
      const can = mt && usable(v, c);
      const b = el("button", "mn-card t-" + c.t + (c.id === sel ? " sel" : "") + (mt ? (can ? " can" : " dim") : ""), cardFace(c, c.id === sel ? rot : 0));
      b.setAttribute("aria-label", cardName(c));
      b.onclick = () => pickCard(c.id);
      box.appendChild(b);
    }
  }
  function cardName(c) {
    if (c.t === "path") return c.c ? "길 카드" : "막다른 길 카드";
    if (c.t === "break") return `${TOOL_NAME[c.tool]} 고장 카드`;
    if (c.t === "fix") return c.tools.map(t => TOOL_NAME[t]).join("·") + " 수리 카드";
    return c.t === "map" ? "지도 카드" : "낙석 카드";
  }
  function pickCard(id) {
    if (!myTurn()) { ctx.toast("지금은 내 차례가 아닙니다"); return; }
    if (sel === id) { sel = null; ghost = null; }
    else {
      sel = id; ghost = null;
      const c = selCard();
      if (c && c.t === "path") rot = spotsFor(last.v, c, 0).length || !spotsFor(last.v, c, 180).length ? 0 : 180;
    }
    ctx.sound.deal();
    render(last, null);
  }

  /* ---------- 아래 버튼 · 안내 ---------- */
  function dock(m) {
    const v = m.v, acts = R("acts"), mt = myTurn(), c = selCard(), names = m.players.map(p => p.name);
    acts.innerHTML = "";
    let hint = "";
    const btn = (label, cls, on, disabled) => {
      const b = el("button", "btn small " + (cls || ""), label);
      b.onclick = on; if (disabled) b.disabled = true;
      acts.appendChild(b);
      return b;
    };
    if (v.phase !== "play") hint = v.phase === "end" ? "라운드 끝 — 잠시 뒤 다음 라운드가 시작됩니다" : "게임 끝";
    else if (!mt) {
      hint = `<b>${esc(names[v.turn])}</b> 님 차례` + (brokenMe(v) ? " · 내 도구가 고장 나 있습니다" : "");
    } else if (!c) {
      hint = brokenMe(v) ? "<b>내 차례</b> — 도구가 고장 나 길은 못 놓아요. 수리 · 행동 카드를 내거나 한 장 버리세요"
        : "<b>내 차례</b> — 카드를 골라 내거나, 한 장 버리세요";
      btn("↻ 회전", "", null, true);
      btn("버리기", "", null, true);
    } else {
      const discard = () => send({ discard: c.id });
      if (c.t === "path") {
        const here = spotsFor(v, c, rot).length, other = spotsFor(v, c, rot ? 0 : 180).length;
        hint = brokenMe(v) ? "도구가 고장 나서 길을 놓을 수 없습니다 — 버릴 수는 있어요"
          : ghost ? "미리 보기 — 같은 칸을 한 번 더 누르거나 「놓기」"
            : here ? "놓을 자리(초록 칸)를 누르세요" + (c.e !== rot180(c.e) ? " · 「회전」으로 방향 바꾸기" : "")
              : other ? "이 방향으로는 놓을 곳이 없어요 — 「회전」을 눌러 보세요" : "이 카드를 놓을 곳이 없습니다 — 버릴 수 있어요";
        btn("↻ 회전", "", () => {
          rot = rot ? 0 : 180;
          if (ghost && !spotsFor(v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)) ghost = null;
          ctx.sound.tick();
          render(last, null);
        }, c.e === rot180(c.e) || brokenMe(v));
        btn("버리기", "", discard);
        btn("놓기", "primary", confirm, !ghost);
      } else if (c.t === "break") {
        const ts = breakTargets(v, c);
        hint = ts.length ? `${TOOL_ICON[c.tool]} ${josa(TOOL_NAME[c.tool], "을", "를")} 망가뜨릴 사람을 고르세요` : "망가뜨릴 수 있는 사람이 없습니다";
        for (const p of ts) btn(`${avatarHTML(names[p], p, "sm")} ${esc(names[p])}`, "mn-tg", () => send({ break: c.id, target: p }));
        btn("버리기", "", discard);
      } else if (c.t === "fix") {
        const os = fixTargets(v, c);
        hint = os.length ? "고칠 도구를 고르세요" : "고장 난 도구가 없습니다 — 버릴 수 있어요";
        for (const o of os) btn(`${avatarHTML(names[o.p], o.p, "sm")} ${o.p === m.me ? "나" : esc(names[o.p])} ${TOOL_ICON[o.tool]}`, "mn-tg", () => send({ repair: c.id, target: o.p, tool: o.tool }));
        btn("버리기", "", discard);
      } else if (c.t === "map") {
        const gs = mapGoals(v);
        hint = gs.length ? "몰래 볼 목표를 고르세요 (판의 목표를 눌러도 됩니다)" : "더 볼 목표가 없습니다 — 버릴 수 있어요";
        for (let g = 0; g < 3; g++) btn(`${GOAL_NAME[g]}`, "mn-tg", () => send({ map: c.id, goal: g }), !gs.includes(g));
        btn("버리기", "", discard);
      } else if (c.t === "rock") {
        hint = ghost ? "이 길을 무너뜨릴까요? 같은 칸을 한 번 더 누르거나 「무너뜨리기」" : "무너뜨릴 길(빨간 칸)을 고르세요";
        btn("버리기", "", discard);
        btn("무너뜨리기", "primary", confirm, !ghost);
      }
    }
    R("hint").innerHTML = hint;
  }

  /* ---------- 라운드 결과 ---------- */
  function overlay(m) {
    const v = m.v, box = R("over");
    if (v.phase === "play" || !v.res) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = overHidden;
    if (overHidden) return;
    const r = v.res, names = m.players.map(p => p.name);
    const rows = m.players.map((pl, p) => `<li class="${p === m.me ? "me" : ""}">${avatarHTML(pl.name, p, "sm")}<span class="nm">${esc(pl.name)}</span>
      <span class="mn-rtag ${v.roles[p]}">${v.roles[p] === "s" ? "😈 방해꾼" : "⛏ 광부"}</span>
      <span class="gain">${r.gains[p] ? "+" + r.gains[p] : "·"}</span><span class="tot">💰${v.gold[p]}</span></li>`).join("");
    box.innerHTML = `<div class="mn-ovbox ${r.winner}">
      <div class="eyebrow">${v.round}/${v.rounds} 라운드 결과</div>
      <h3>${r.winner === "m" ? "💰 광부 승리!" : "😈 방해꾼 승리!"}</h3>
      <p>${r.winner === "m" ? `<b>${esc(names[r.finisher])}</b> 님이 금맥을 열었습니다` : "금에 닿기 전에 카드가 바닥났습니다"} · 금은 <b>${GOAL_NAME[r.goldAt]}</b> 목표에</p>
      <ul>${rows}</ul>
      <div class="mn-ovfoot"><span>${v.phase === "end" ? "곧 다음 라운드 — 역할을 새로 나눕니다" : "최종 결과"}</span><button class="btn small" data-r="hideov">판 보기</button></div>
    </div>`;
    box.querySelector('[data-r="hideov"]').onclick = () => { overHidden = true; render(last, null); };
  }

  /* ---------- 그리기 ---------- */
  function render(m, marks) {
    // 고른 것 정리: 내 차례가 아니거나 손에 없는 카드면 풀기
    if (!myTurn()) { sel = null; ghost = null; }
    const c = selCard();
    if (sel !== null && !c) { sel = null; ghost = null; }
    if (c && ghost) {
      const okSpot = c.t === "path" ? spotsFor(m.v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)
        : c.t === "rock" ? rockCells(m.v).some(t => t.x === ghost.x && t.y === ghost.y) : false;
      if (!okSpot) ghost = null;
    }
    seats(m, marks); info(m); board(m, marks); hand(m); dock(m); overlay(m);
  }
  function update(m) {
    last = m;
    let marks = null;
    if (m.ev && m.ev.length && !seen.has(m.ev)) { seen.add(m.ev); marks = effects(m); }
    busy = false;
    render(m, marks);
  }

  function onResize() { if (last) render(last, null); }
  window.addEventListener("resize", onResize);
  return { update, destroy() { window.removeEventListener("resize", onResize); clearTimeout(roleT); root.innerHTML = ""; } };
}
