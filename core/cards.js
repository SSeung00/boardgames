/* 트럼프 카드 (도둑잡기 · 원카드 · 포커 공용).
   카드 코드: 무늬 한 글자 + 숫자. S 스페이드 · H 하트 · D 다이아 · C 클럽, 1=A … 11=J 12=Q 13=K.
   조커: "JB" 흑백 조커, "JC" 컬러 조커. */

export const SUITS = ["S", "H", "D", "C"];
export const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME = { S: "스페이드", H: "하트", D: "다이아", C: "클럽" };
export const RANK_LABEL = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export const suitOf = c => c[0];
export const rankOf = c => (c[0] === "J" && (c[1] === "B" || c[1] === "C") ? 0 : +c.slice(1));
export const isJoker = c => c === "JB" || c === "JC";
export const isRed = c => c[0] === "H" || c[0] === "D" || c === "JC";
export const rankLabel = r => RANK_LABEL[r] || String(r);

export function deck52() {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push(s + r);
  return d;
}

export function cardName(c) {
  if (c === "JB") return "흑백 조커";
  if (c === "JC") return "컬러 조커";
  return SUIT_SYMBOL[c[0]] + rankLabel(rankOf(c));
}

/* 화면용 HTML — 브라우저에서만 쓴다. size: "" | "sm" | "lg", extra: 추가 클래스 */
export function cardHTML(c, extra = "") {
  if (!c) return `<div class="pc back ${extra}"></div>`;
  if (isJoker(c)) {
    return `<div class="pc joker ${c === "JC" ? "red" : "black"} ${extra}" data-c="${c}">` +
      `<span class="pc-corner">JOKER</span><span class="pc-mid">🃏</span><span class="pc-sub">${c === "JC" ? "컬러" : "흑백"}</span></div>`;
  }
  const s = c[0], r = rankOf(c);
  return `<div class="pc ${isRed(c) ? "red" : "black"} ${extra}" data-c="${c}">` +
    `<span class="pc-corner">${rankLabel(r)}<i>${SUIT_SYMBOL[s]}</i></span>` +
    `<span class="pc-mid">${SUIT_SYMBOL[s]}</span>` +
    `<span class="pc-corner br">${rankLabel(r)}<i>${SUIT_SYMBOL[s]}</i></span></div>`;
}

export function cardEl(c, extra) {
  const t = document.createElement("template");
  t.innerHTML = cardHTML(c, extra);
  return t.content.firstChild;
}
