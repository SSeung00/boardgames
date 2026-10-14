/* 도둑잡기 화면 — 위: 자리들 · 가운데: 뽑힐 사람의 뒷면 카드 · 아래: 내 패 */
import { cardHTML, rankLabel } from "../../core/cards.js";

export function mount(root, ctx) {
  const { el, esc, avatarHTML } = ctx;
  root.innerHTML = "";
  const wrap = el("div", "om");
  wrap.innerHTML = `
    <div class="seatrow" data-r="seats"></div>
    <div class="om-table felt">
      <div class="om-who" data-r="who"></div>
      <div class="om-fan" data-r="fan"></div>
      <div class="om-note" data-r="note"></div>
      <div class="om-pile" data-r="pile"></div>
    </div>
    <div class="dock">
      <div class="hint" data-r="hint"></div>
      <div class="om-hand" data-r="hand"></div>
    </div>`;
  root.appendChild(wrap);
  const R = k => wrap.querySelector(`[data-r="${k}"]`);
  let lastDrawn = null, busy = false;

  function seats(m) {
    const v = m.v, box = R("seats");
    box.innerHTML = "";
    m.players.forEach((pl, p) => {
      const out = v.out.indexOf(p);
      const chip = el("div", "seatchip" + (p === v.turn && v.phase === "play" ? " turn" : "") + (p === m.me ? " me" : "") + (out >= 0 ? " out" : ""));
      chip.innerHTML = `${avatarHTML(pl.name, p, "sm")}<span class="nm">${esc(pl.name)}</span>` +
        (pl.kind === "ai" ? '<span class="ai">AI</span>' : pl.kind === "away" ? '<span class="away">자리 비움</span>' : "") +
        `<span class="sub">${out >= 0 ? (p === v.loser ? "🃏 도둑" : `${out + 1}등`) : `🂠 ${v.sizes[p]}`}</span>`;
      box.appendChild(chip);
    });
  }

  function update(m) {
    lastMsg = m;
    const v = m.v, me = m.me;
    seats(m);
    const myTurn = !!ctx.myAsk("draw");
    const names = m.players.map(p => p.name);
    // 가운데: 뽑힐 사람의 패
    const fan = R("fan");
    fan.innerHTML = "";
    if (v.phase === "play" && v.victim >= 0) {
      R("who").innerHTML = myTurn
        ? `<b>${esc(names[v.victim])}</b> 님의 패에서 한 장을 뽑으세요`
        : `${esc(names[v.turn])} 님이 <b>${esc(v.victim === me ? "내" : names[v.victim] + " 님의")}</b> 패에서 뽑는 중`;
      const n = v.sizes[v.victim];
      const pos = spread(n, fan.clientWidth || 320, 64, 70);
      for (let i = 0; i < n; i++) {
        const c = el("button", "om-back" + (myTurn ? " can" : ""), cardHTML(null));
        c.style.left = pos[i] + "px";
        c.style.setProperty("--rot", ((i - (n - 1) / 2) * 3) + "deg");
        c.disabled = !myTurn;
        c.setAttribute("aria-label", `${i + 1}번째 카드 뽑기`);
        c.onclick = () => {
          if (busy) return;
          busy = true; c.classList.add("picked");
          ctx.sound.flip();
          setTimeout(() => { ctx.send({ i }); busy = false; }, 220);
        };
        fan.appendChild(c);
      }
    } else {
      R("who").textContent = "";
    }
    R("pile").innerHTML = `버린 카드 <b>${v.discards}</b>장`;

    // 방금 일어난 일
    const ev = m.ev.filter(e => e.type === "draw").pop();
    if (ev) {
      let t;
      if (ev.to === me) t = ev.card ? `${ev.joker ? "앗, 조커를 뽑았습니다! 🃏" : "뽑은 카드: <b>" + esc(cardLabel(ev.card)) + "</b>"}${ev.paired ? ` → 짝이 맞아 버렸습니다` : ""}` : "";
      else if (ev.from === me) t = ev.card ? `${esc(names[ev.to])} 님이 내 <b>${esc(cardLabel(ev.card))}</b>${ev.joker ? " (조커!) 😆" : ""}를 가져갔습니다` : "";
      else t = `${esc(names[ev.to])} 님이 ${esc(names[ev.from])} 님의 카드를 뽑았습니다${ev.paired ? ` — 짝 (${rankLabel(ev.paired)})` : ""}`;
      R("note").innerHTML = t;
      lastDrawn = ev.to === me && ev.card && !ev.paired ? ev.card : null;
      if (ev.to === me || ev.from === me) ev.joker ? (ev.to === me ? ctx.sound.bad() : ctx.sound.good()) : ctx.sound.place();
      else ctx.sound.deal();
    }
    if (m.ev.some(e => e.type === "out" && e.p === me)) ctx.sound.good();

    // 내 패
    const hand = R("hand");
    hand.innerHTML = "";
    if (!v.hand.length) hand.innerHTML = `<div class="om-empty">${v.out.includes(me) ? "패를 다 털었습니다! 🎉" : ""}</div>`;
    const hp = spread(v.hand.length, hand.clientWidth || 320, 56, 60);
    v.hand.forEach((c, i) => {
      const d = el("div", "om-card", cardHTML(c, (c === lastDrawn ? "new" : "") + (c === "JC" ? " jk" : "")));
      d.style.left = hp[i] + "px";
      hand.appendChild(d);
    });
    R("hint").innerHTML = v.phase === "over" ? "게임 끝" : myTurn ? "<b>내 차례</b> — 가운데 카드 중 하나를 누르세요"
      : v.hand.includes("JC") ? "조커를 들고 있습니다… 들키지 마세요 🤫" : `내 패 ${v.hand.length}장`;
  }

  /* n 장을 폭 W 안에 겹쳐 놓을 때 각 카드의 왼쪽 위치 */
  function spread(n, W, cw, maxStep) {
    if (!n) return [];
    const step = n > 1 ? Math.min(maxStep, (W - 16 - cw) / (n - 1)) : 0;
    const start = (W - (step * (n - 1) + cw)) / 2;
    return Array.from({ length: n }, (_, i) => start + i * step);
  }
  window.addEventListener("resize", onResize);
  let lastMsg = null;
  function onResize() { if (lastMsg) { const ev = lastMsg.ev; lastMsg = { ...lastMsg, ev: [] }; update(lastMsg); lastMsg.ev = ev; } }

  function cardLabel(c) {
    if (c === "JC") return "조커";
    const s = { S: "♠", H: "♥", D: "♦", C: "♣" }[c[0]];
    return s + rankLabel(+c.slice(1));
  }

  return { update, destroy() { window.removeEventListener("resize", onResize); root.innerHTML = ""; } };
}
