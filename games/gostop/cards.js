/* 화투 카드 — 12달 × 4장 = 48장 + 보너스 피 2장. 엔진(Node)과 화면이 함께 쓴다 (DOM 을 쓰지 않는 문자열만).
   카드 코드: 월 숫자 + a~d (예: "1a" 송학 광, "12d" 비 쌍피). 보너스: "B2" 보너스 쌍피 · "B3" 보너스 쓰리피.
   종류 t: g 광 · t 띠 · y 열끗 · p 피.  pv: 피 장수 (피 1 · 쌍피 2 · 쓰리피 3)
   set: hong 홍단 · cheong 청단 · cho 초단 (띠),  go 고도리 (열끗).  rain: 비광 · 비띠.  guk: 9월 국진 (열끗 또는 쌍피) */

export const MONTH_NAME = ["", "송학", "매조", "벚꽃", "흑싸리", "난초", "모란", "홍싸리", "공산", "국화", "단풍", "오동", "비"];
export const MONTH_ART = ["", "🌲", "🌸", "🌸", "🌿", "🌱", "🌺", "🍂", "🌕", "🌼", "🍁", "🍃", "☔"];

const DEF = {
  1: ["g", "t:hong", "p", "p"],
  2: ["y:go", "t:hong", "p", "p"],
  3: ["g", "t:hong", "p", "p"],
  4: ["y:go", "t:cho", "p", "p"],
  5: ["y", "t:cho", "p", "p"],
  6: ["y", "t:cheong", "p", "p"],
  7: ["y", "t:cho", "p", "p"],
  8: ["g", "y:go", "p", "p"],
  9: ["y:guk", "t:cheong", "p", "p"],
  10: ["y", "t:cheong", "p", "p"],
  11: ["g", "pp", "p", "p"],
  12: ["g:rain", "y", "t:rain", "pp"]
};

export const CARDS = {};
export const DECK48 = [];
for (let m = 1; m <= 12; m++) DEF[m].forEach((spec, i) => {
  const id = m + "abcd"[i];
  const [t, x] = spec.split(":");
  const c = { id, m, i, t: t === "pp" ? "p" : t, pv: t === "pp" ? 2 : t === "p" ? 1 : 0, set: null, rain: false, guk: false, bonus: false };
  if (x === "rain") c.rain = true; else if (x === "guk") c.guk = true; else if (x) c.set = x;
  CARDS[id] = c;
  DECK48.push(id);
});
CARDS.B2 = { id: "B2", m: 0, i: 0, t: "p", pv: 2, set: null, rain: false, guk: false, bonus: true };
CARDS.B3 = { id: "B3", m: 0, i: 1, t: "p", pv: 3, set: null, rain: false, guk: false, bonus: true };
export const BONUS = ["B2", "B3"];

export const SET_NAME = { hong: "홍단", cheong: "청단", cho: "초단", go: "고도리" };
export const SET_CARDS = { hong: ["1b", "2b", "3b"], cheong: ["6b", "9b", "10b"], cho: ["4b", "5b", "7b"], go: ["2a", "4a", "8b"] };

export const isCard = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(CARDS, id);
export const monthOf = id => CARDS[id].m;
export const isBonus = id => isCard(id) && CARDS[id].bonus;

/* 정렬: 월 → 같은 월 안에서 a~d. 보너스는 맨 앞 (손에서 먼저 눈에 띄게) */
export const cardOrder = id => (CARDS[id].bonus ? -10 + CARDS[id].i : CARDS[id].m * 4 + CARDS[id].i);
export const sortCards = arr => arr.slice().sort((a, b) => cardOrder(a) - cardOrder(b));

/* 카드 하나의 짧은 종류 이름 */
export function kindLabel(id) {
  const c = CARDS[id];
  if (c.bonus) return c.pv === 3 ? "쓰리피" : "쌍피";
  if (c.t === "g") return c.rain ? "비광" : "광";
  if (c.t === "t") return c.set ? SET_NAME[c.set] : "띠";
  if (c.t === "y") return c.set === "go" ? "고도리" : c.guk ? "국진" : "열끗";
  return c.pv === 2 ? "쌍피" : "피";
}
export function cardName(id) {
  const c = CARDS[id];
  return c.bonus ? `보너스 ${kindLabel(id)}` : `${c.m}월 ${kindLabel(id)}`;
}

/* 먹은 패 묶음: g 광 · t 띠 · y 열끗 · p 피 (국진은 주인의 점수 계산에 따라 y 또는 p) */
export function groupOf(id, gukAs) {
  const c = CARDS[id];
  if (c.guk) return gukAs === "p" ? "p" : "y";
  return c.t;
}

/* ---------- 화면용 HTML (브라우저에서만 쓴다) ----------
   .hw 요소: 크기는 --cw/--ch 로 (기본 40×62). extra: 추가 클래스 (mini · sel · can · dim · in …) */
const MARK = { g: "광", hong: "", cheong: "", cho: "", rain: "", y: "열", go: "🐦", guk: "국", pp: "2", p: "" };
const LABEL = { g: "광", hong: "홍단", cheong: "청단", cho: "초단", rain: "띠", y: "열끗", go: "고도리", guk: "국진", pp: "쌍피", p: "피" };
export function kindKey(id) {
  const c = CARDS[id];
  if (c.t === "g") return "g";
  if (c.t === "t") return c.set || "rain";
  if (c.t === "y") return c.set === "go" ? "go" : c.guk ? "guk" : "y";
  return c.pv === 2 ? "pp" : "p";
}
export function hwHTML(id, extra = "") {
  if (!id) return `<div class="hw back ${extra}"><i></i></div>`;
  const c = CARDS[id];
  if (c.bonus) {
    return `<div class="hw bonus ${extra}" data-c="${id}" title="${cardName(id)}"><span class="hw-n">★</span><span class="hw-k">+${c.pv}</span>` +
      `<span class="hw-art">🎁</span><span class="hw-l">보너스</span></div>`;
  }
  const k = kindKey(id);
  const label = k === "g" && c.rain ? "비광" : LABEL[k];
  return `<div class="hw m${c.m} k-${k} ${extra}" data-c="${id}" title="${cardName(id)}"><span class="hw-n">${c.m}</span>` +
    `<span class="hw-k">${MARK[k]}</span><span class="hw-art">${MONTH_ART[c.m]}</span><span class="hw-l">${label}</span></div>`;
}
