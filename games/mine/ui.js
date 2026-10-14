/* 금광 탐험 화면 — 위: 이름표 격자(최대 2줄) · 내 정보 줄 · 목표까지 남은 칸
   가운데: 굴 판 (쓰는 영역에 맞춰 자동 확대 · 밀어서 이동 · −/+) · 그 아래 남는 높이는 이번 라운드 기록
   아래: 내 패(놓을 자리 수 · 못 내는 이유)와 버튼. 진행 기록을 직접 보여 주므로 위쪽 한 줄 기록(ticker)은 끈다. */

const GOAL_NAME = ["1번", "2번", "3번"];      // 판이 가로 · 세로로 보일 수 있어 위치 대신 번호 (엔진 글과 같다)
const TOOL_ICON = { pick: "⛏", lamp: "🔦", cart: "🛒" };
const TOOL_NAME = { pick: "곡괭이", lamp: "등불", cart: "수레" };
const ZF = [1, 1.3, 1.65, 2.1];                 // 맞춤 크기에 곱하는 확대 단계
const CS_MIN = 26, CS_MAX = 72;                 // 칸 크기 (px) — 맞춤이 이보다 작으면 판을 밀어서 본다
const LIM = { x0: -4, x1: 12, y0: -5, y1: 5 };  // 엔진의 판 범위
const rot180 = m => ((m << 2) | (m >> 2)) & 15;
const tp = m => ((m & 1) << 3) | ((m & 2) << 1) | ((m & 4) >> 1) | ((m & 8) >> 3);   // 세로 판: 북↔서 · 동↔남 (대각선 뒤집기)
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); };
const bk = (t, big) => `<span class="mn-bk${big ? " big" : ""}" title="${TOOL_NAME[t]} 고장">${TOOL_ICON[t]}</span>`;

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
    <div class="mn-seats" data-r="seats"></div>
    <div class="mn-bar">
      <button class="mn-role" data-r="role" aria-label="내 역할 보기"></button>
      <span class="mn-me" data-r="me"></span>
      <button class="mn-zb" data-r="res" hidden>결과</button>
    </div>
    <div class="mn-goals">
      <span class="mn-gl" data-r="goals"></span>
      <span class="mn-zoom"><button class="mn-zb" data-z="-1" aria-label="축소">−</button><button class="mn-zb" data-z="1" aria-label="확대">+</button></span>
    </div>
    <div class="mn-body" data-r="body">
      <div class="mn-mid" data-r="mid"><div class="mn-frame" data-r="frame"><div class="mn-grid" data-r="grid"></div></div></div>
      <div class="mn-log" data-r="log"></div>
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
  let sel = null, rot = 0;       // 고른 카드 · 길 카드 방향 (남의 차례에도 골라서 놓을 자리를 미리 볼 수 있다)
  let ghost = null;              // 놓을(무너뜨릴) 자리 {x, y}
  let zoomI = 0;                 // ZF 단계 (0 = 맞춤)
  let vert = null, vertW = 0;   // 세로 판인지 (기기 폭이 바뀔 때만 다시 고른다)
  let box = null, boxRound = -1; // 판에 보여 줄 범위 — 라운드 안에서는 넓어지기만 해서 화면이 덜 흔들린다
  let prevGeo = null;            // 판 스크롤 유지용 {x0, y0, cs}
  let focusNext = null;          // 다음 그리기에서 가운데로 가져올 칸 {x, y}
  let roleOpen = false, roleT = 0;
  let overHidden = false;
  let busy = false;
  const seen = new WeakSet();    // 이미 소리 · 애니메이션을 낸 이벤트 묶음

  /* ---------- 지금 고른 카드로 할 수 있는 일 ---------- */
  const myTurn = () => !!(last && ctx.myAsk("turn") && last.v.phase === "play");
  const selCard = () => (last && sel !== null ? last.v.hand.find(c => c.id === sel) || null : null);
  const brokenMe = v => v.broken[last.me].length > 0;
  const names = () => last.players.map(p => p.name);
  function spotsFor(v, c, r) {               // 길 카드를 놓을 수 있는 자리
    if (!v.legal || !v.legal[c.id]) return [];
    return v.legal[c.id].filter(s => s[2] === r);
  }
  const spotCount = (v, c) => new Set((v.legal && v.legal[c.id] || []).map(s => s[0] + "," + s[1])).size;
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
  /* 지금 낼 수 없는 이유 [카드에 쓸 짧은 말, 안내 줄에 쓸 긴 말] — 낼 수 있으면 null (버리기는 언제나 된다) */
  function why(v, c) {
    if (v.phase !== "play") return null;
    if (c.t === "path") {
      if (brokenMe(v)) return ["도구 고장", `도구가 부서져 길을 놓을 수 없음 (${v.broken[last.me].map(t => TOOL_ICON[t]).join("")}) — 수리 카드로 고치거나 버리세요`];
      if (!spotCount(v, c)) return ["놓을 곳 없음", "이 길 카드를 맞춰 놓을 굴 끝이 없음 — 버릴 수 있어요"];
    } else if (c.t === "break" && !breakTargets(v, c).length) return ["대상 없음", `다른 사람의 ${josa(TOOL_NAME[c.tool], "이", "가")} 모두 이미 고장 — 버릴 수 있어요`];
    else if (c.t === "fix" && !fixTargets(v, c).length) return ["고칠 것 없음", `${c.tools.map(t => TOOL_NAME[t]).join(" · ")} 고장 난 사람이 없음 — 버릴 수 있어요`];
    else if (c.t === "map" && !mapGoals(v).length) return ["볼 것 없음", "더 볼 목표가 없음 — 버릴 수 있어요"];
    else if (c.t === "rock" && !rockCells(v).length) return ["길 없음", "무너뜨릴 길 카드가 없음 — 버릴 수 있어요"];
    return null;
  }

  function send(a) {
    if (busy) return;
    if (ctx.send(a)) { busy = true; sel = null; ghost = null; setTimeout(() => { busy = false; }, 600); }
    if (last) render(last, null);
  }

  /* ---------- 행동 글 (이름표 배지 · 기록) ---------- */
  function actHTML(h, short) {        // short: 1 = 이름표 배지, 2 = 좁은 이름표 배지
    const nm = p => (p === last.me ? "나" : esc(names()[p] || "?"));
    if (h.t === "path") return h.dead ? `<span class="mn-k bad">${short ? "막힘 놓음" : "막다른 길을 놓음"}</span>` : `<span class="mn-k path">${short ? "길 놓음" : "굴을 팜"}</span>`;
    if (h.t === "rock") return h.gone === "dead" ? `<span class="mn-k fix">🪨 ${short ? "막힘 치움" : "낙석으로 막다른 길을 치움"}</span>`
      : `<span class="mn-k bad">🪨 ${short === 2 ? "낙석" : short ? "길 무너뜨림" : "낙석으로 길을 무너뜨림"}</span>`;
    if (h.t === "break") return `<span class="mn-k bad">${bk(h.tool)}${short === 2 ? "" : " 부숨"}→${nm(h.target)}</span>`;
    if (h.t === "fix") return `<span class="mn-k fix">🔧${TOOL_ICON[h.tool]}${short === 2 ? "" : " 고침"}→${h.target === h.p ? "자기" : nm(h.target)}</span>`;
    if (h.t === "map") return `<span class="mn-k map">🗺 ${GOAL_NAME[h.goal]}${short ? " 봄" : " 목표를 몰래 봄"}</span>`;
    return `<span class="mn-k">${short ? "버림" : "카드 한 장 버림"}</span>`;
  }
  const lastActOf = (v, p) => { for (let i = v.log.length - 1; i >= 0; i--) if (v.log[i].p === p) return v.log[i]; return null; };
  /* 아직 아무도 못 본 카드 (덱 · 남의 손 · 엎어 버린 카드) — 사람이 세지 않아도 되게 */
  function unseen(v) {
    const t = { path: 35, dead: 9, break: 9, fix: 9, map: 6, rock: 3 };
    for (const b of v.board) if (b.k === "p") t[b.c ? "path" : "dead"]--;
    for (const h of v.log) {
      if (h.t === "rock") { t.rock--; t[h.gone]--; }
      else if (h.t === "break" || h.t === "fix" || h.t === "map") t[h.t]--;
    }
    for (const c of v.hand) t[c.t === "path" ? (c.c ? "path" : "dead") : c.t]--;
    return t;
  }
  function sabRange(v) {
    const [ns, nm] = v.roleSet;
    const lo = Math.max(0, v.n - nm), hi = Math.min(ns, v.n);
    return lo === hi ? `${lo}명` : `${lo}~${hi}명`;
  }

  /* ---------- 이벤트 효과 ---------- */
  function effects(m) {
    const me = m.me, marks = { fresh: new Set(), flip: new Set(), dust: [], hit: new Set(), acted: new Set() };
    for (const e of m.ev) {
      if (e.p !== undefined) marks.acted.add(e.p);
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
      } else if (e.type === "newround") { roleOpen = false; overHidden = false; sel = null; ghost = null; zoomI = 0; ctx.sound.deal(); }
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

  /* ---------- 이름표: 이름 · 손패 · 금 · 고장 난 도구 · 마지막 행동 ---------- */
  function seats(m, marks) {
    const v = m.v, box = R("seats"), c = selCard(), mt = myTurn();
    const pickable = new Set();
    if (mt && c && c.t === "break") breakTargets(v, c).forEach(p => pickable.add(p));
    if (mt && c && c.t === "fix") fixTargets(v, c).forEach(o => pickable.add(o.p));
    const cols = v.n <= 5 ? v.n : Math.ceil(v.n / 2);   // 6명부터 두 줄
    box.style.setProperty("--cols", cols);
    box.classList.toggle("tight", cols >= 5);
    box.innerHTML = "";
    m.players.forEach((pl, p) => {
      const broken = v.broken[p];
      const chip = el("button", "mn-chip" + (p === v.turn && v.phase === "play" ? " turn" : "") + (p === m.me ? " me" : "")
        + (broken.length ? " bkn" : "") + (pickable.has(p) ? " mn-pick" : "") + (marks && marks.hit.has(p) ? " mn-hit" : "")
        + (marks && marks.acted.has(p) ? " mn-acted" : ""));
      const tag = pl.kind === "away" ? '<i class="away" title="자리 비움">💤</i>' : pl.kind === "ai" ? '<i class="ai">AI</i>' : "";
      let l3;
      if (v.roles) l3 = `<span class="mn-rtag ${v.roles[p]}">${v.roles[p] === "s" ? (cols >= 5 ? "방해꾼" : "😈 방해꾼") : (cols >= 5 ? "광부" : "⛏ 광부")}</span>` + (v.res && v.res.gains[p] ? `<b class="mn-gain">+${v.res.gains[p]}</b>` : "");
      else { const h = lastActOf(v, p); l3 = h ? actHTML(h, cols >= 5 ? 2 : 1) : '<span class="mn-k none">—</span>'; }
      chip.innerHTML = `<span class="l1">${avatarHTML(pl.name, p, "sm mn-av")}<b class="nm">${p === m.me ? "나" : esc(pl.name)}</b>${tag}</span>` +
        `<span class="l2"><span title="손패">🂠${v.sizes[p]}</span><span class="mn-g" title="모은 금">💰${v.gold[p]}</span>` +
        (broken.length ? `<span class="mn-tools" title="고장: ${broken.map(t => TOOL_NAME[t]).join(", ")}">${broken.map(t => bk(t)).join("")}</span>` : "") + `</span>` +
        `<span class="l3">${l3}</span>`;
      chip.setAttribute("aria-label", `${pl.name}: 손패 ${v.sizes[p]}장, 금 ${v.gold[p]}` + (broken.length ? `, 고장 ${broken.map(t => TOOL_NAME[t]).join(" ")}` : ""));
      chip.onclick = () => (pickable.has(p) ? pickTarget(p) : playerModal(p));
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
  /* 이름표를 누르면: 그 사람이 이번 라운드에 한 일 */
  function playerModal(p) {
    const v = last.v, pl = last.players[p], mine = v.log.filter(h => h.p === p);
    const cnt = k => mine.filter(k).length;
    const sum = [["굴", cnt(h => h.t === "path" && !h.dead)], ["막힘", cnt(h => h.t === "path" && h.dead)], ["낙석", cnt(h => h.t === "rock")],
      ["부숨", cnt(h => h.t === "break")], ["수리", cnt(h => h.t === "fix")], ["지도", cnt(h => h.t === "map")], ["버림", cnt(h => h.t === "discard")]]
      .filter(x => x[1]).map(x => `${x[0]} <b>${x[1]}</b>`).join(" · ");
    const got = v.log.filter(h => (h.t === "break" || h.t === "fix") && h.target === p && h.p !== p);
    ctx.modal(box => {
      ctx.head(box, "이번 라운드", `${avatarHTML(pl.name, p)} ${esc(pl.name)}${p === last.me ? " (나)" : ""}`,
        `손패 <b>${v.sizes[p]}</b>장 · 금 <b>${v.gold[p]}</b> · 도구 ${v.broken[p].length ? v.broken[p].map(t => bk(t)).join("") + " 고장" : "<b>정상</b>"}`);
      box.appendChild(el("div", "mn-psum", sum || "아직 한 일이 없습니다"));
      const ul = el("ul", "mn-plist");
      mine.slice().reverse().forEach(h => ul.appendChild(el("li", "", actHTML(h, false))));
      got.slice().reverse().forEach(h => ul.appendChild(el("li", "rcv", `${esc(names()[h.p])} 님이 ${h.t === "break" ? bk(h.tool) + " 부숨" : "🔧" + TOOL_ICON[h.tool] + " 고쳐 줌"}`)));
      if (mine.length || got.length) box.appendChild(ul);
    });
  }

  /* ---------- 내 정보 줄 · 역할 ---------- */
  function info(m) {
    const v = m.v, mb = v.broken[m.me];
    const rb = R("role");
    rb.className = "mn-role" + (roleOpen ? " open " + v.role : "");
    rb.innerHTML = roleOpen ? (v.role === "s" ? "😈 방해꾼" : "⛏ 광부") : "🎭 내 역할";
    R("me").innerHTML = (mb.length ? `<span class="mn-mytools bad">${mb.map(t => bk(t)).join("")} 고장</span>` : `<span class="mn-mytools ok">🛠 도구 정상</span>`) +
      `<span class="mn-g">💰<b>${v.gold[m.me]}</b></span><span><b>${v.round}</b>/${v.rounds}판</span><span>덱 <b>${v.deck}</b></span>`;
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
    const z = Math.max(0, Math.min(ZF.length - 1, zoomI + +b.dataset.z));
    if (z === zoomI) return;
    // 처음 확대할 때는 방금 놓인 카드 (없으면 입구) 쪽을 가운데로
    if (zoomI === 0 && last) { const v = last.v; focusNext = ghost || (v.last && v.last.x !== undefined ? { x: v.last.x, y: v.last.y } : { x: 0, y: 0 }); }
    zoomI = z;
    if (last) { goalsLine(last); board(last, null); }
  });

  /* ---------- 목표까지 남은 칸 (화면이 대신 센다) ---------- */
  function goalsLine(m) {
    const v = m.v;
    // 금일 수 있는 목표: 내가 금을 봤으면 그것만, 아니면 석탄으로 밝혀지지 않은 것
    const goldKnown = v.goals.findIndex(g => g.kind === "gold");
    const cand = g => (goldKnown >= 0 ? g === goldKnown : v.goals[g].kind !== "coal");
    let best = Infinity;
    for (let g = 0; g < 3; g++) if (cand(g) && v.need[g] !== null) best = Math.min(best, v.need[g]);
    let h = `<span class="lead">남은 칸</span>`;
    for (let g = 0; g < 3; g++) {
      const gl = v.goals[g], n = v.need[g];
      let mark = "", val;
      if (gl.rev) { mark = gl.kind === "gold" ? "💰" : "⚫"; val = gl.kind === "gold" ? "금!" : "석탄"; }
      else {
        if (gl.peek) mark = `👁${gl.kind === "gold" ? "💰" : "⚫"}`;
        else if (gl.kind) mark = gl.kind === "gold" ? "💰" : "⚫";
        else if (goldKnown < 0 && v.goals.filter(o => o.kind === "coal").length === 2) mark = "=💰";   // 나머지 둘이 석탄이면 금
        val = n === null ? "막힘" : `<b>${n}</b>`;
      }
      const cls = "mn-gp" + (!gl.rev && cand(g) && n === best ? " best" : "") + (gl.kind === "coal" ? " coal" : "") + (n === null && !gl.rev ? " cut" : "");
      h += `<span class="${cls}" title="${GOAL_NAME[g]} 목표: 입구와 이어진 굴 끝에서 최소 ${n === null ? "-" : n}장">${GOAL_NAME[g]}${mark} ${val}</span>`;
    }
    R("goals").innerHTML = h;
    wrap.querySelector('[data-z="-1"]').disabled = zoomI === 0;
    wrap.querySelector('[data-z="1"]').disabled = zoomI === ZF.length - 1;
  }

  /* ---------- 판 ---------- */
  function needBox(v) {                        // 입구 · 목표 · 놓인 카드 · 굴 끝이 모두 들어가는 가장 작은 범위
    let x0 = 0, x1 = 8, y0 = -2, y1 = 2;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const t of v.board) add(t.x, t.y);
    if (v.phase === "play") for (const [x, y] of v.front) add(x, y);
    return { x0: Math.max(LIM.x0, x0), x1: Math.min(LIM.x1, x1), y0: Math.max(LIM.y0, y0), y1: Math.min(LIM.y1, y1) };
  }
  function board(m, marks) {
    const v = m.v, frame = R("frame"), grid = R("grid"), mid = R("mid"), body = R("body");
    const nb = needBox(v);
    if (!box || boxRound !== v.round) { box = nb; prevGeo = null; }
    else box = { x0: Math.min(box.x0, nb.x0), x1: Math.max(box.x1, nb.x1), y0: Math.min(box.y0, nb.y0), y1: Math.max(box.y1, nb.y1) };
    boxRound = v.round;
    const b = box, ex = b.x1 - b.x0 + 1, ey = b.y1 - b.y0 + 1;   // 엔진 기준 가로 · 세로 칸 수
    // 칸 크기: 판 전체가 들어가는 가장 큰 크기 × 확대 단계.
    // 방향: 길쭉한 화면에서는 판을 세로로(입구 위 · 목표 아래) 돌리면 칸이 훨씬 커진다. 기기 폭이 바뀔 때만 다시 고른다
    const fw = frame.clientWidth - 4, fh = body.clientHeight - 8;   // 판 테두리 4 + 기록 위 여백 4
    if (vert === null && fw > 0 && fh > 0) vert = Math.min(fw / 5, fh / 10) >= 1.1 * Math.min(fw / 10, fh / 5);   // 라운드 시작 판(10×5) 기준
    const cols = vert ? ey : ex, rows = vert ? ex : ey;
    const fit = fw > 0 && fh > 0 ? Math.floor(Math.min(fw / cols, fh / rows)) : 34;
    const cs = Math.round(Math.max(CS_MIN, Math.min(CS_MAX, fit)) * ZF[zoomI]);
    const midH = Math.max(0, Math.min(body.clientHeight - 4, rows * cs + 4));
    mid.style.height = midH + "px";
    R("log").hidden = body.clientHeight - midH < 44;   // 기록이 한 줄도 안 들어가면 잘린 머리만 보이지 않게 숨긴다
    // 엔진 좌표(x, y) → 화면 칸 (세로 판이면 x 가 아래로, y 가 오른쪽으로)
    const sx = (x, y) => (vert ? y - b.y0 : x - b.x0), sy = (x, y) => (vert ? x - b.x0 : y - b.y0);
    const T = e => (vert ? tp(e) : e);
    // 판이 왼쪽 · 위로 넓어지거나 확대가 바뀌어도 보던 곳이 그대로 보이게 (보던 가운데 칸을 엔진 좌표로 기억)
    let keep = null;
    if (prevGeo && (prevGeo.x0 !== b.x0 || prevGeo.y0 !== b.y0 || prevGeo.cs !== cs || prevGeo.vert !== vert)) {
      const a = (frame.scrollLeft + frame.clientWidth / 2) / prevGeo.cs, d = (frame.scrollTop + frame.clientHeight / 2) / prevGeo.cs;
      keep = prevGeo.vert ? { x: d + prevGeo.x0 - .5, y: a + prevGeo.y0 - .5 } : { x: a + prevGeo.x0 - .5, y: d + prevGeo.y0 - .5 };
    }
    prevGeo = { x0: b.x0, y0: b.y0, cs, vert };
    grid.style.setProperty("--cs", cs + "px");
    grid.style.width = cols * cs + "px";
    grid.style.height = rows * cs + "px";
    grid.classList.toggle("vert", !!vert);
    const pos = (x, y) => `left:${sx(x, y) * cs}px;top:${sy(x, y) * cs}px`;
    const c = selCard(), mt = myTurn();
    let h = "";
    // 굴 끝: 입구와 이어진 열린 끝 — 길 카드는 여기에만 놓인다
    if (v.phase === "play") for (const [x, y] of v.front) h += `<div class="mn-c mn-front" style="${pos(x, y)}"></div>`;
    for (const t of v.board) {
      const kk = t.x + "," + t.y;
      let cls = "mn-c mn-tile", inner = "";
      if (t.k === "s") { cls += " mn-start"; inner = tunnelSVG(15, true, LADDER) + '<i class="mn-lbl">입구</i>'; }
      else if (t.k === "p") { inner = tunnelSVG(T(t.e), t.c); if (!t.c) cls += " dead"; }
      else {
        const gl = v.goals[t.g];
        if (t.rev) { cls += " mn-goal rev " + (t.gold ? "gold" : "coal"); inner = tunnelSVG(T(t.e), true, t.gold ? GOLD : COAL); }
        else {
          cls += " mn-goal down" + (gl.kind ? " " + gl.kind : "");
          inner = gl.kind && !gl.peek ? `<span class="mn-q">${gl.kind === "gold" ? "💰" : "⚫"}</span>`   // 라운드 끝: 모두 공개
            : `<span class="mn-q">?</span>` + (gl.peek ? `<span class="mn-peek">👁${gl.kind === "gold" ? "💰" : "⚫"}</span>` : "");
        }
        inner += `<i class="mn-gno">${t.g + 1}</i>`;
      }
      if (v.last && v.last.x === t.x && v.last.y === t.y && v.last.t === "path") cls += " mn-last";
      if (marks && marks.fresh.has(kk)) cls += " mn-new";
      if (marks && marks.flip.has(kk)) cls += " mn-flip";
      h += `<div class="${cls}" style="${pos(t.x, t.y)}">${inner}</div>`;
    }
    if (marks) for (const [x, y] of marks.dust) h += `<div class="mn-c mn-dust" style="${pos(x, y)}"></div>`;
    // 고른 카드에 따라 누를 수 있는 칸 (남의 차례면 흐린 미리 보기)
    if (c && v.phase === "play") {
      const pre = mt ? "" : " pre";
      if (c.t === "path" && !brokenMe(v)) {
        for (const [x, y] of spotsFor(v, c, rot)) h += `<button class="mn-c mn-spot${pre}${ghost && ghost.x === x && ghost.y === y ? " on" : ""}" style="${pos(x, y)}" data-x="${x}" data-y="${y}" aria-label="여기에 놓기"></button>`;
        if (ghost && mt) h += `<div class="mn-c mn-tile mn-ghost${c.c ? "" : " dead"}" style="${pos(ghost.x, ghost.y)}">${tunnelSVG(T(rot ? rot180(c.e) : c.e), c.c)}</div>`;
      } else if (c.t === "rock") {
        for (const t of rockCells(v)) h += `<button class="mn-c mn-spot rock${pre}${ghost && ghost.x === t.x && ghost.y === t.y ? " on" : ""}" style="${pos(t.x, t.y)}" data-x="${t.x}" data-y="${t.y}" aria-label="이 길 무너뜨리기"></button>`;
      } else if (c.t === "map") {
        for (const g of mapGoals(v)) { const gl = v.goals[g]; h += `<button class="mn-c mn-spot map${pre}" style="${pos(gl.x, gl.y)}" data-g="${g}" aria-label="${GOAL_NAME[g]} 목표 보기"></button>`; }
      }
    }
    grid.innerHTML = h;
    const center = (x, y) => {
      frame.scrollLeft = (sx(x, y) + .5) * cs - frame.clientWidth / 2;
      frame.scrollTop = (sy(x, y) + .5) * cs - frame.clientHeight / 2;
    };
    if (focusNext) { center(focusNext.x, focusNext.y); focusNext = null; }
    else if (keep) center(keep.x, keep.y);
  }
  R("grid").addEventListener("click", e => {
    const t = e.target.closest("[data-x],[data-g]");
    if (!t || !last) return;
    const c = selCard();
    if (!c) return;
    if (!myTurn()) { ctx.toast("내 차례가 되면 놓을 수 있어요"); return; }
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

  /* ---------- 이번 라운드 기록 (판 아래 남는 높이) ---------- */
  function logPanel(m) {
    const v = m.v, box = R("log"), nm = names();
    let h = `<div class="mn-lstick"><div class="mn-lhead"><span>${v.round}라운드 기록</span><span>방해꾼 <b>${sabRange(v)}</b> · 역할 카드 ${v.roleSet[0] + v.roleSet[1]}장 중 ${v.n}장</span></div>`;
    const u = unseen(v);
    h += `<div class="mn-lseen" title="덱 · 남의 손 · 엎어 버린 카드 중에 남은 것">안 나온 카드 · 길 <b>${u.path}</b> · 막힘 <b>${u.dead}</b> · 고장 <b>${u.break}</b> · 수리 <b>${u.fix}</b> · 지도 <b>${u.map}</b> · 낙석 <b>${u.rock}</b></div></div>`;
    if (!v.log.length) {
      h += `<div class="mn-lempty">입구에서 금까지 굴을 이으세요. 초록 점선 칸이 지금 굴 끝입니다.<br>도구가 하나라도 고장 나면 길 카드를 놓을 수 없습니다.</div>`;
    } else {
      h += "<ol>";
      for (let i = v.log.length - 1; i >= 0; i--) {
        const x = v.log[i];
        const role = v.roles ? `<span class="mn-rtag ${v.roles[x.p]}">${v.roles[x.p] === "s" ? "방해꾼" : "광부"}</span>` : "";
        h += `<li class="${x.p === m.me ? "me" : ""}">${avatarHTML(nm[x.p], x.p, "sm mn-av")}<b>${x.p === m.me ? "나" : esc(nm[x.p])}</b>${role}${actHTML(x, false)}</li>`;
      }
      h += "</ol>";
    }
    box.innerHTML = h;
  }

  /* ---------- 손패 ---------- */
  function cardFace(c, r) {
    if (c.t === "path") return `<span class="mn-mini${c.c ? "" : " dead"}" style="transform:rotate(${r}deg)">${tunnelSVG(vert ? tp(c.e) : c.e, c.c)}</span><small>${c.c ? "길" : "막힘"}</small>`;
    if (c.t === "break") return `<span class="mn-ic">${bk(c.tool, true)}</span><small>고장</small>`;
    if (c.t === "fix") return `<span class="mn-ic fix">🔧${c.tools.map(t => TOOL_ICON[t]).join(c.tools.length > 1 ? "<i>/</i>" : "")}</span><small>${c.tools.length > 1 ? "하나 수리" : "수리"}</small>`;
    if (c.t === "map") return `<span class="mn-ic">🗺️</span><small>지도</small>`;
    return `<span class="mn-ic">🪨</span><small>낙석</small>`;
  }
  function hand(m) {
    const v = m.v, box = R("hand"), mt = myTurn();
    // 카드 크기는 처음 손패 수로 고정 — 덱이 떨어져 손패가 줄어도 판 크기가 흔들리지 않게
    box.style.setProperty("--hn", v.n <= 5 ? 6 : v.n <= 7 ? 5 : 4);
    box.innerHTML = "";
    if (!v.hand.length) { box.innerHTML = `<span class="mn-card mn-ph"></span><div class="mn-empty">${v.phase === "play" ? "손패가 없습니다 — 라운드가 끝나길 기다려요" : ""}</div>`; return; }
    for (const c of v.hand) {
      const no = why(v, c);
      const b = el("button", "mn-card t-" + c.t + (c.id === sel ? " sel" : "") + (no ? " dim" : mt ? " can" : ""), cardFace(c, c.id === sel ? rot : 0));
      if (no) b.insertAdjacentHTML("beforeend", `<em class="mn-why">${no[0]}</em>`);
      else if (c.t === "path" && v.phase === "play") b.insertAdjacentHTML("beforeend", `<em class="mn-cnt" title="놓을 수 있는 자리">${spotCount(v, c)}</em>`);
      b.setAttribute("aria-label", cardName(c) + (no ? ` — ${no[0]}` : ""));
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
    if (!last || last.v.phase !== "play") return;
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
    const v = m.v, acts = R("acts"), mt = myTurn(), c = selCard(), nm = names();
    acts.innerHTML = "";
    let hint = "";
    const btn = (label, cls, on, disabled) => {
      const b = el("button", "btn small " + (cls || ""), label);
      b.onclick = on; if (disabled) b.disabled = true;
      acts.appendChild(b);
      return b;
    };
    const no = c ? why(v, c) : null;
    if (v.phase !== "play") hint = v.phase === "end" ? "라운드 끝 — 잠시 뒤 다음 라운드가 시작됩니다" : "게임 끝";
    else if (!mt) {
      hint = `<b>${esc(nm[v.turn])}</b> 님 차례` + (c ? (no ? ` · ${no[1]}` : c.t === "path" ? ` · 미리 보기: 놓을 자리 <b>${spotCount(v, c)}</b>곳` : " · 카드를 골라 두었어요")
        : brokenMe(v) ? " · 내 도구가 고장 나 있습니다" : " · 카드를 눌러 놓을 자리를 미리 볼 수 있어요");
      btn("↻ 회전", "", () => { rot = rot ? 0 : 180; ctx.sound.tick(); render(last, null); }, !c || c.t !== "path" || c.e === rot180(c.e) || !!no);
      btn("버리기", "", null, true);
    } else if (!c) {
      hint = brokenMe(v) ? `<b>내 차례</b> — 도구가 부서져 길은 못 놓아요 (${v.broken[m.me].map(t => bk(t)).join("")}). 수리 · 행동 카드를 내거나 한 장 버리세요`
        : "<b>내 차례</b> — 카드를 골라 내거나, 한 장 버리세요";
      btn("↻ 회전", "", null, true);
      btn("버리기", "", null, true);
    } else {
      const discard = () => send({ discard: c.id });
      if (c.t === "path") {
        const here = spotsFor(v, c, rot).length, other = spotsFor(v, c, rot ? 0 : 180).length, sym = c.e === rot180(c.e);
        hint = no ? no[1]
          : ghost ? "미리 보기 — 같은 칸을 한 번 더 누르거나 「놓기」"
            : here ? `놓을 자리 <b>${here}</b>곳 — 초록 칸을 누르세요` + (!sym && other ? ` · 「회전」하면 ${other}곳` : "")
              : `이 방향으로는 놓을 곳이 없어요 — 「회전」하면 <b>${other}</b>곳`;
        btn("↻ 회전", "", () => {
          rot = rot ? 0 : 180;
          if (ghost && !spotsFor(v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)) ghost = null;
          ctx.sound.tick();
          render(last, null);
        }, sym || brokenMe(v));
        btn("버리기", "", discard);
        btn("놓기", "primary", confirm, !ghost);
      } else if (c.t === "break") {
        const ts = breakTargets(v, c);
        hint = ts.length ? `${TOOL_ICON[c.tool]} ${josa(TOOL_NAME[c.tool], "을", "를")} 망가뜨릴 사람을 고르세요 (이름표를 눌러도 됩니다)` : no[1];
        btn("버리기", "mn-dis", discard);                  // 대상이 많아 옆으로 밀려도 버리기는 늘 보이게 맨 앞에
        for (const p of ts) btn(`${avatarHTML(nm[p], p, "sm")} ${esc(nm[p])}`, "mn-tg", () => send({ break: c.id, target: p }));
      } else if (c.t === "fix") {
        const os = fixTargets(v, c);
        hint = os.length ? "고칠 도구를 고르세요" : no[1];
        btn("버리기", "mn-dis", discard);
        for (const o of os) btn(`${avatarHTML(nm[o.p], o.p, "sm")} ${o.p === m.me ? "나" : esc(nm[o.p])} ${TOOL_ICON[o.tool]}`, "mn-tg", () => send({ repair: c.id, target: o.p, tool: o.tool }));
      } else if (c.t === "map") {
        const gs = mapGoals(v);
        hint = gs.length ? "몰래 볼 목표를 고르세요 (판의 목표를 눌러도 됩니다)" : no[1];
        btn("버리기", "mn-dis", discard);
        for (let g = 0; g < 3; g++) btn(`${GOAL_NAME[g]} 목표`, "mn-tg", () => send({ map: c.id, goal: g }), !gs.includes(g));
      } else if (c.t === "rock") {
        hint = no ? no[1] : ghost ? "이 길을 무너뜨릴까요? 같은 칸을 한 번 더 누르거나 「무너뜨리기」" : `무너뜨릴 길(빨간 칸 ${rockCells(v).length}곳)을 고르세요`;
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
    const r = v.res, nm = names();
    const rows = m.players.map((pl, p) => `<li class="${p === m.me ? "me" : ""}">${avatarHTML(pl.name, p, "sm")}<span class="nm">${esc(pl.name)}</span>
      <span class="mn-rtag ${v.roles[p]}">${v.roles[p] === "s" ? "😈 방해꾼" : "⛏ 광부"}</span>
      <span class="gain">${r.gains[p] ? "+" + r.gains[p] : "·"}</span><span class="tot">💰${v.gold[p]}</span></li>`).join("");
    box.innerHTML = `<div class="mn-ovbox ${r.winner}">
      <div class="eyebrow">${v.round}/${v.rounds} 라운드 결과</div>
      <h3>${r.winner === "m" ? "💰 광부 승리!" : "😈 방해꾼 승리!"}</h3>
      <p>${r.winner === "m" ? `<b>${esc(nm[r.finisher])}</b> 님이 금맥을 열었습니다` : "금에 닿기 전에 카드가 바닥났습니다"} · 금은 <b>${GOAL_NAME[r.goldAt]}</b> 목표에</p>
      <ul>${rows}</ul>
      <div class="mn-ovfoot"><span>${v.phase === "end" ? "곧 다음 라운드 — 역할을 새로 나눕니다" : "최종 결과"}</span><button class="btn small" data-r="hideov">판 보기</button></div>
    </div>`;
    box.querySelector('[data-r="hideov"]').onclick = () => { overHidden = true; render(last, null); };
  }

  /* ---------- 그리기 ---------- */
  function render(m, marks) {
    // 고른 것 정리: 라운드 밖이거나 손에 없는 카드면 풀기. 남의 차례에는 미리 보기만 (놓을 칸 고르기는 풀기)
    if (m.v.phase !== "play") { sel = null; ghost = null; }
    if (!myTurn()) ghost = null;
    const c = selCard();
    if (sel !== null && !c) { sel = null; ghost = null; }
    if (c && ghost) {
      const okSpot = c.t === "path" ? spotsFor(m.v, c, rot).some(s => s[0] === ghost.x && s[1] === ghost.y)
        : c.t === "rock" ? rockCells(m.v).some(t => t.x === ghost.x && t.y === ghost.y) : false;
      if (!okSpot) ghost = null;
    }
    // 판 크기는 남은 높이로 정하므로 위 · 아래를 먼저 그린다
    seats(m, marks); info(m); goalsLine(m); hand(m); dock(m); logPanel(m);
    const was = vert;
    board(m, marks);
    if (vert !== was) hand(m);                 // 판 방향이 정해지면 손패 그림도 같은 방향으로
    overlay(m);
  }
  function update(m) {
    last = m;
    let marks = null;
    if (m.ev && m.ev.length && !seen.has(m.ev)) { seen.add(m.ev); marks = effects(m); }
    busy = false;
    render(m, marks);
  }

  function onResize() {
    if (window.innerWidth !== vertW) { vertW = window.innerWidth; vert = null; }   // 주소창이 숨는 정도의 높이 변화로는 방향을 바꾸지 않는다
    if (last) render(last, null);
  }
  vertW = window.innerWidth;
  window.addEventListener("resize", onResize);
  return { update, ticker: false, destroy() { window.removeEventListener("resize", onResize); clearTimeout(roleT); root.innerHTML = ""; } };
}
