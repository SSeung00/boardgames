/* 포커 — 노리밋 텍사스 홀덤. 돈이 아닌 놀이용 칩만 오간다.
   흐름: (step) 새 판 → 블라인드 → 베팅(pending) → (step) 플랍 · 턴 · 리버 → … → 쇼다운 → 결과 4.5초 → (step) 다음 판
   칩이 0 이 되면 탈락. 한 명만 남거나 정한 판 수를 다 치르면 끝.

   상태 S 의 칩: chips(앞에 놓인 칩) + put(이번 판에 낸 칩, 이번 거리 베팅 bet 포함) 의 합이 늘 처음 총액과 같다.
   팟은 put 에서 그때그때 계산한다 (buildPots) — 올인한 사람의 금액마다 사이드 팟이 나뉜다. */
import { shuffle, randInt } from "../../core/rng.js";
import { deck52, rankOf, cardName } from "../../core/cards.js";

const name = "포커";
export const STREETS = ["프리플랍", "플랍", "턴", "리버"];
export const HAND_NAMES = ["하이카드", "원페어", "투페어", "트리플", "스트레이트", "플러시", "풀하우스", "포카드", "스트레이트 플러시", "로열 플러시"];
const SIMS = { easy: 60, normal: 250, hard: 700 };   // AI 몬테카를로 횟수
const LEVEL_HANDS = 8;      // 블라인드가 오르는 간격 (판)
const FIXED_SAFETY = 100;   // 고정 블라인드 + 끝까지: 이 판 수가 지나면 블라인드가 오르기 시작한다 (끝나지 않는 게임 방지)
const MAX_HANDS = 600;      // 절대 상한 — 여기 닿으면 칩 순으로 끝 (실제로는 블라인드 때문에 훨씬 먼저 끝난다)
const MAX_LEVEL = 24;
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sum = a => { let s = 0; for (const x of a) s += x; return s; };

/* ===================== 족보 계산 =====================
   카드 정수: 숫자(0=2 … 12=A) * 4 + 무늬(0..3). 점수가 클수록 센 패.
   점수 = 족보(0~8) << 20 | 비교용 숫자들(4비트씩, 높은 자리부터) */
const SUIT_IX = { S: 0, H: 1, D: 2, C: 3 };
export const C2I = {};
export const I2C = [];
for (const c of deck52()) {
  const r = rankOf(c), i = (r === 1 ? 12 : r - 2) * 4 + SUIT_IX[c[0]];
  C2I[c] = i; I2C[i] = c;
}

/* 13비트 숫자 묶음 → 스트레이트 최고 숫자+1 (없으면 0), 높은 숫자 5개, 비트 수 */
const STR = new Uint8Array(8192), TOP5 = new Int32Array(8192), POP = new Uint8Array(8192);
for (let m = 0; m < 8192; m++) {
  let pc = 0, enc = 0;
  for (let r = 12; r >= 0; r--) if ((m >> r) & 1) { if (pc < 5) enc |= r << (16 - 4 * pc); pc++; }
  POP[m] = pc; TOP5[m] = enc;
  let s = 0;
  for (let t = 12; t >= 4; t--) if (((m >> (t - 4)) & 31) === 31) { s = t + 1; break; }
  if (!s && (m & 0x100F) === 0x100F) s = 4;            // A-2-3-4-5 (휠): 5 가 최고
  STR[m] = s;
}

const CNT = new Uint8Array(13);
/* 정수 카드 배열 cs 의 앞 n 장(5~7)으로 만들 수 있는 가장 센 패의 점수 */
export function evalInts(cs, n) {
  CNT.fill(0);
  let m0 = 0, m1 = 0, m2 = 0, m3 = 0;
  for (let i = 0; i < n; i++) {
    const c = cs[i], r = c >> 2, b = 1 << r;
    CNT[r]++;
    switch (c & 3) { case 0: m0 |= b; break; case 1: m1 |= b; break; case 2: m2 |= b; break; default: m3 |= b; }
  }
  // 7장 이하에서 플러시가 있으면 포카드 · 풀하우스는 있을 수 없다 → 플러시를 먼저 본다
  const fm = POP[m0] >= 5 ? m0 : POP[m1] >= 5 ? m1 : POP[m2] >= 5 ? m2 : POP[m3] >= 5 ? m3 : 0;
  if (fm) {
    const s = STR[fm];
    return s ? (8 << 20) | ((s - 1) << 16) : (5 << 20) | TOP5[fm];
  }
  const all = m0 | m1 | m2 | m3;
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = CNT[r];
    if (k === 4) q = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (q >= 0) return (7 << 20) | (q << 16) | ((TOP5[all & ~(1 << q)] >> 16) << 12);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return (6 << 20) | (t1 << 16) | (Math.max(t2, p1) << 12);
  const s = STR[all];
  if (s) return (4 << 20) | ((s - 1) << 16);
  if (t1 >= 0) return (3 << 20) | (t1 << 16) | ((TOP5[all & ~(1 << t1)] >> 4) & 0xFF00);
  if (p2 >= 0) return (2 << 20) | (p1 << 16) | (p2 << 12) | ((TOP5[all & ~(1 << p1) & ~(1 << p2)] >> 16) << 8);
  if (p1 >= 0) return (1 << 20) | (p1 << 16) | ((TOP5[all & ~(1 << p1)] >> 4) & 0xFFF0);
  return TOP5[all];
}
const T7 = new Int32Array(7);
export function ev7(a, b, c, d, e, f, g) {
  T7[0] = a; T7[1] = b; T7[2] = c; T7[3] = d; T7[4] = e; T7[5] = f; T7[6] = g;
  return evalInts(T7, 7);
}
export function evalCodes(codes) {
  const t = new Int32Array(codes.length);
  for (let i = 0; i < codes.length; i++) t[i] = C2I[codes[i]];
  return evalInts(t, codes.length);
}
export function handName(score) {
  const k = score >> 20;
  return k === 8 && ((score >> 16) & 15) === 12 ? HAND_NAMES[9] : HAND_NAMES[k];
}
/* 카드 코드 5~7장 → {score, name, best: 그 점수를 만드는 5장} */
export function bestHand(codes) {
  const score = evalCodes(codes), n = codes.length;
  if (n <= 5) return { score, name: handName(score), best: codes.slice() };
  const t = new Int32Array(5);
  for (let m = (1 << n) - 1; m >= 0; m--) {
    let k = 0;
    for (let i = 0; i < n; i++) if ((m >> i) & 1) { if (k < 5) t[k] = C2I[codes[i]]; k++; }
    if (k !== 5 || evalInts(t, 5) !== score) continue;
    return { score, name: handName(score), best: codes.filter((_, i) => (m >> i) & 1) };
  }
  return { score, name: handName(score), best: codes.slice(0, 5) };
}

/* ===================== AI 도우미: 첸 점수 · 프리플랍 표 · 몬테카를로 ===================== */
/* 첸 공식 (두 장의 대략적인 세기). 상대 '범위' 를 좁힐 때 쓴다 */
function chen(r1, r2, suited) {
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  const val = r => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let s = val(hi);
  if (hi === lo) return Math.max(5, s * 2);
  if (suited) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1;
  return Math.ceil(s);
}
const CH = new Int8Array(52 * 52);
const chenAll = [];
for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) if (a !== b) {
  CH[a * 52 + b] = chen(a >> 2, b >> 2, (a & 3) === (b & 3));
  if (a < b) chenAll.push(CH[a * 52 + b]);
}
chenAll.sort((x, y) => y - x);
const chenTop = frac => chenAll[Math.min(chenAll.length - 1, Math.floor(frac * chenAll.length))];
const RANGE_RAISE = chenTop(0.22);   // 프리플랍에 올린 사람: 상위 22% 정도의 패로 본다
const RANGE_CALL = chenTop(0.5);     // 돈을 넣고 따라온 사람: 상위 50%

/* 시드 난수 (표 계산용) */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 몬테카를로 승률: 내 두 장 h · 보이는 공용 카드 board(정수), 상대 nOpp 명. 비기면 나눠 센다.
   thr[o] 가 있으면 o 번째 상대의 패를 첸 점수 thr 이상으로 (몇 번 다시 뽑아) 좁힌다. S 와 무관 */
const DECK = new Int32Array(52), USED = new Uint8Array(52), BRD = new Int32Array(5);
export function mcEquity(h, board, nOpp, sims, rng, thr) {
  if (nOpp <= 0) return 1;
  USED.fill(0);
  USED[h[0]] = 1; USED[h[1]] = 1;
  for (const c of board) USED[c] = 1;
  let nd = 0;
  for (let c = 0; c < 52; c++) if (!USED[c]) DECK[nd++] = c;
  const nb = board.length;
  for (let i = 0; i < nb; i++) BRD[i] = board[i];
  const h0 = h[0], h1 = h[1];
  let win = 0;
  for (let s = 0; s < sims; s++) {
    let top = nd;
    for (let i = nb; i < 5; i++) {
      const j = (rng() * top) | 0; top--;
      const t = DECK[j]; DECK[j] = DECK[top]; DECK[top] = t; BRD[i] = t;
    }
    const my = ev7(h0, h1, BRD[0], BRD[1], BRD[2], BRD[3], BRD[4]);
    let lost = false, ties = 0;
    for (let o = 0; o < nOpp; o++) {
      let a, b, tries = 0;
      for (;;) {
        let j = (rng() * top) | 0; top--;
        a = DECK[j]; DECK[j] = DECK[top]; DECK[top] = a;
        j = (rng() * top) | 0; top--;
        b = DECK[j]; DECK[j] = DECK[top]; DECK[top] = b;
        if (!thr || !thr[o] || tries >= 4 || CH[a * 52 + b] >= thr[o]) break;
        top += 2; tries++;                       // 범위 밖이면 되돌리고 다시 뽑기
      }
      const os = ev7(a, b, BRD[0], BRD[1], BRD[2], BRD[3], BRD[4]);
      if (os > my) { lost = true; break; }
      if (os === my) ties++;
    }
    if (!lost) win += 1 / (ties + 1);
  }
  return win / sims;
}

/* 프리플랍 승률 표: 169가지 두 장 × 상대 1~7명 (무작위 패 상대). 미리 계산해 둔 값 (×1000, 3자리씩).
   클래스 번호: 페어/오프수트 = 높은숫자*13+낮은숫자, 수티드 = 낮은숫자*13+높은숫자 */
const PRE_TXT =
  "502353369379376379403423449475500530572322536387397398402410435461484509541581329353565416412419427440465492519547588341365380604430437443454475501527560599343358380400632455460476492507538564600349363387401423662479490510525541574609371373395417431446691509524541564581622388402408428446467478719542557577600625418427437443459478496513752575591617646442450460471477497514534550775605626654476483490501506515536551571582800635662507512523535542550559581596608616823669546559567578578590598607627636646653852" +
  "308236249253253244257275287304321352388199335266271267265263278294312332357396203223367293284282284287301319341366406215238252400298299302300308328352375416208226246264431318320321327333358381412202222248263287464340342346355366391422219223244264286300501358366374387401431228237245264286310326538387394408421446245257266274289310336355575420431447467263274281290296320342363389612443460482288294304314329331350375401414648473495309318327341351360370394414432446689505353360372382381392404413444454467483733" +
  "221182188198188186190204217230240262293139239201213204200197210222232248270301147169261226223217214215227241257276309155171188288237233229231230249264282319146165180201315251248249252256268288311142159179195212345265267269272278295325153158175194211228379284288289298309334161168173193212225252410311311317327348176179188192210234253278451338344358369184194201206215233258278308493357366385199209216222227241262285310326537382400221228236242254261272291325339352584416254263275278273290300312341349368384636" +
  "175150156162154149157162174183198211241110190170177169164162168180189201217251117130204186184177174173184194205226254121135150223200194190186190198210227260110128144157247212207203206209221238255110123138154168268222217222226224247265115118135149167186294234240241244250273123129133148165184201327261259266273283133138144150164183207226362284291298309142149155162164181201224251402301308323156162166171179186206226255269449324341172179182189197204212234267278294496356202207214219215226234248277292304325557" +
  "159130134140133127132137149157166182208089161148152146141137146150162171184212098108170164158153150149154165175192214101113127182171168165158158170178195222091107119134203178175176171173187199218086101112128141220191189190189189205225092096109124142154239202204206206210230099099105120133152166266226224227233242106111115116135151170193299251251257268114119122127133150167186213334262270279126131134138144149170188215229377285296139143145155161165173193228234250429311162169175181175182192203231244258279492" +
  "143118121127117112117121129137146158186078144132139130125120126134140151164185085092154149139138131129134143152166188086099110162153147140138136146157169198078091102113173160155151152151162174191073083096112123186168161164165165181200078080092104120130202176183178183187201081084087099114128141225194198201204210090091096099111123146163252218224232236095099103104111124141158185285230237244104107112115121125142158185199325251260113116122126134141146163193202219372276138142148154146154160170197211225243434" +
  "132107111114107101105109117123132144160068136120124118113109110119126136147167072081136135125121118113122129138147171075088098144138133128125124130141150172067081091102153144139137134136145156168061072084099108163152148148146147156172064067080091102116176162163159159165178068072072084099110124193174178177180189073076083084096110125143215197198205209082085087087093107123141161248209212219088091094099101107120139162170281228236098101105110112116126139170179193326251119122124132124132138147171180200215389";
const PRE = new Float32Array(169 * 8).fill(-1);
const PCT = new Float32Array(169 * 8).fill(-1);
if (PRE_TXT.length === 169 * 7 * 3) {
  for (let k = 1; k <= 7; k++) for (let c = 0; c < 169; c++) PRE[c * 8 + k] = +PRE_TXT.substr(((k - 1) * 169 + c) * 3, 3) / 1000;
}
export function handClass(a, b) {
  const r0 = a >> 2, r1 = b >> 2, hi = Math.max(r0, r1), lo = Math.min(r0, r1);
  return (a & 3) === (b & 3) ? lo * 13 + hi : hi * 13 + lo;
}
const classWeight = c => { const hi = Math.floor(c / 13), lo = c % 13; return hi === lo ? 6 : hi < lo ? 4 : 12; };
export function preflopEq(a, b, nOpp) {
  const cls = handClass(a, b), k = cls * 8 + nOpp;
  if (PRE[k] < 0) {                          // 표가 없으면 그 자리에서 계산 (느리지만 한 번뿐)
    const hi = Math.max(a >> 2, b >> 2), lo = Math.min(a >> 2, b >> 2), suited = (a & 3) === (b & 3);
    PRE[k] = mcEquity([hi * 4, lo * 4 + (suited ? 0 : 1)], [], nOpp, 1500, seeded(k + 1), null);
  }
  return PRE[k];
}
/* 같은 인원에서 이 패가 상위 몇 % 인가 (1 = 최고). 1326가지 조합의 비중으로 센다 */
export function preflopPct(a, b, nOpp) {
  const cls = handClass(a, b), k = cls * 8 + nOpp;
  if (PCT[k] < 0) {
    const eqs = [];
    for (let c = 0; c < 169; c++) {
      const hi = Math.floor(c / 13), lo = c % 13;
      const x = hi === lo ? hi * 4 : hi > lo ? hi * 4 : lo * 4, y = hi === lo ? lo * 4 + 1 : hi > lo ? lo * 4 + 1 : hi * 4;
      eqs.push(preflopEq(x, y, nOpp));
    }
    for (let c = 0; c < 169; c++) {
      let below = 0;
      for (let d = 0; d < 169; d++) {
        if (eqs[d] < eqs[c]) below += classWeight(d);
        else if (eqs[d] === eqs[c]) below += classWeight(d) / 2;
      }
      PCT[c * 8 + nOpp] = below / 1326;
    }
  }
  return PCT[k];
}

/* ===================== 상태 도우미 ===================== */
const live = (S, q) => S.inHand[q] && !S.folded[q];          // 이번 판에 아직 남은 사람
const canAct = (S, q) => live(S, q) && !S.allin[q];          // 아직 베팅할 수 있는 사람
function nextSeat(S, from, pred) {
  for (let k = 1; k <= S.n; k++) { const q = (from + k) % S.n; if (pred(q)) return q; }
  return -1;
}
const nextAlive = (S, from) => nextSeat(S, from, q => S.chips[q] > 0);
const isOut = (S, q) => S.out.some(o => o.p === q);

function levelFor(S, h) {
  let lv = 0;
  if (S.opt.blinds === "up") lv = Math.floor((h - 1) / LEVEL_HANDS);
  else if (!S.opt.hands && h > FIXED_SAFETY) lv = Math.floor((h - FIXED_SAFETY - 1) / LEVEL_HANDS) + 1;
  return Math.min(lv, MAX_LEVEL);
}
function nextLevelHand(S) {
  if (S.opt.blinds === "up") return S.level >= MAX_LEVEL ? 0 : (S.level + 1) * LEVEL_HANDS + 1;
  if (!S.opt.hands && S.handNo > FIXED_SAFETY - LEVEL_HANDS) return FIXED_SAFETY + S.level * LEVEL_HANDS + 1;
  return 0;
}

/* p 가 지금 할 수 있는 것 (차례가 아니어도 '미리 보기' 로 쓴다) */
function legalInfo(S, p) {
  const stack = S.chips[p], bet = S.bet[p], cur = S.curBet;
  const toCall = Math.max(0, cur - bet), callAmt = Math.min(toCall, stack), maxTo = bet + stack;
  let others = 0;
  for (let q = 0; q < S.n; q++) if (q !== p && canAct(S, q)) others++;
  // 이미 행동한 사람은 그 뒤로 '완전한 레이즈' 만큼 오르지 않았으면 다시 올릴 수 없다 (모자란 올인은 베팅을 다시 열지 않는다)
  const reopen = S.acted[p] < 0 || cur - S.acted[p] >= S.minRaise;
  const me = canAct(S, p);
  const canRaise = me && stack > toCall && others > 0 && reopen;
  const minTo = Math.min(cur + S.minRaise, maxTo);
  const kinds = [];
  if (me) {
    kinds.push("fold", toCall > 0 ? "call" : "check");
    if (canRaise) kinds.push("raise", "allin");
    else if (toCall > 0 && callAmt === stack) kinds.push("allin");
  }
  return { stack, bet, toCall, callAmt, maxTo, minTo, canRaise, reopen, others, kinds };
}
function raiseBlock(L) {
  if (L.stack <= L.toCall) return "칩이 모자라 더 올릴 수 없습니다";
  if (!L.others) return "다른 사람이 모두 올인해서 더 올릴 수 없습니다";
  if (!L.reopen) return "모자란 올인은 베팅을 다시 열지 않습니다 — 콜하거나 폴드하세요";
  return "지금은 올릴 수 없습니다";
}

/* 다음에 행동할 사람 (from 다음 자리부터). 없으면 -1 → 이번 거리 베팅 끝 */
function nextToAct(S, from) {
  let liveN = 0, only = -1;
  for (let q = 0; q < S.n; q++) if (canAct(S, q)) { liveN++; only = q; }
  if (!liveN) return -1;
  if (liveN === 1 && S.bet[only] >= S.curBet) return -1;      // 나머지가 모두 올인 — 더 베팅할 상대가 없다
  return nextSeat(S, from, q => canAct(S, q) && (S.acted[q] < 0 || S.bet[q] < S.curBet));
}

/* 칩 묶음 amt[] (사람마다 낸 칩) → 팟 목록. 금액 경계마다 나누고, 자격(폴드 안 한 사람)이 같으면 합친다 */
function buildPots(S, amt) {
  const caps = [...new Set(amt.filter(x => x > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const cap of caps) {
    let amount = 0;
    const elig = [];
    for (let q = 0; q < S.n; q++) {
      const c = Math.min(amt[q], cap) - prev;
      if (c > 0) amount += c;
      if (live(S, q) && amt[q] >= cap) elig.push(q);
    }
    const last = pots[pots.length - 1];
    if (last && last.elig.length === elig.length && last.elig.every((q, i) => q === elig[i])) { last.amount += amount; last.cap = cap; }
    else pots.push({ amount, elig, lo: prev, cap });
    prev = cap;
  }
  return pots;
}

function putChips(S, p, amt) {
  S.chips[p] -= amt; S.bet[p] += amt; S.put[p] += amt;
  if (S.chips[p] === 0) S.allin[p] = true;
}

/* 아무도 받지 않은 베팅은 돌려준다 (가장 많이 낸 사람이 두 번째보다 많이 낸 만큼) */
function refundUncalled(S, ev) {
  let top = -1, hi = 0, second = 0;
  for (let q = 0; q < S.n; q++) {
    if (S.put[q] > hi) { second = hi; hi = S.put[q]; top = q; }
    else if (S.put[q] > second) second = S.put[q];
  }
  if (top < 0) return;
  const back = Math.min(hi - second, S.bet[top]);
  if (back <= 0) return;
  S.put[top] -= back; S.bet[top] -= back; S.chips[top] += back;
  if (S.chips[top] > 0) S.allin[top] = false;
  ev.push({ type: "refund", p: top, amount: back, text: `{${top}} 님에게 받지 않은 베팅 ${fmt(back)} 칩을 돌려줍니다` });
}

/* ===================== 판 진행 ===================== */
function startHand(S, ev) {
  S.handNo++;
  const lv = levelFor(S, S.handNo), up = lv > S.level;
  S.level = lv; S.sb = 10 * 2 ** lv; S.bb = 20 * 2 ** lv;
  const n = S.n;
  let alive = 0;
  for (let q = 0; q < n; q++) if (S.chips[q] > 0) alive++;
  S.button = nextAlive(S, S.button);
  if (alive === 2) { S.sbSeat = S.button; S.bbSeat = nextAlive(S, S.button); }     // 둘이면 버튼이 SB
  else { S.sbSeat = nextAlive(S, S.button); S.bbSeat = nextAlive(S, S.sbSeat); }
  S.inHand = S.chips.map(c => c > 0);
  S.folded = Array(n).fill(false); S.allin = Array(n).fill(false);
  S.bet = Array(n).fill(0); S.put = Array(n).fill(0); S.acted = Array(n).fill(-1);
  S.pfr = Array(n).fill(false); S.vpip = Array(n).fill(false); S.acts = Array(n).fill("");
  S.start = S.chips.slice();
  S.board = []; S.shown = null; S.street = 0; S.raises = 0; S.lastAct = null; S.runout = false;
  S.deck = shuffle(S, deck52());
  S.hole = S.inHand.map(x => (x ? [] : null));
  for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) { const q = (S.sbSeat + i) % n; if (S.inHand[q]) S.hole[q].push(S.deck.pop()); }
  ev.push({ type: "hand", hand: S.handNo, button: S.button, sb: S.sb, bb: S.bb, text: `— ${S.handNo}번째 판 · 블라인드 ${fmt(S.sb)}/${fmt(S.bb)} —` });
  if (up) ev.push({ type: "notice", text: `블라인드가 ${fmt(S.sb)}/${fmt(S.bb)} 로 올랐습니다` });
  putChips(S, S.sbSeat, Math.min(S.sb, S.chips[S.sbSeat]));
  putChips(S, S.bbSeat, Math.min(S.bb, S.chips[S.bbSeat]));
  // 이번 판 행동 기록 (화면이 자리마다 · 펠트에 '방금 일어난 일' 로 보여 준다)
  S.log = [{ st: 0, p: S.sbSeat, a: "sb", to: S.bet[S.sbSeat] }, { st: 0, p: S.bbSeat, a: "bb", to: S.bet[S.bbSeat] }];
  S.curBet = S.bb;        // 빅 블라인드가 모자라게 올인했어도 다른 사람은 빅 블라인드 전액을 맞춰야 한다
  S.minRaise = S.bb;
  S.phase = "bet";
  S.turn = nextToAct(S, S.bbSeat);
  if (S.turn < 0) closeRound(S, ev);
}

/* 이번 거리 베팅이 끝남 → 칩을 팟으로 모으고, 다음 카드를 기다린다 (step) */
function closeRound(S, ev) {
  refundUncalled(S, ev);
  S.bet.fill(0);
  S.turn = -1;
  S.phase = "deal";
  let can = 0;
  for (let q = 0; q < S.n; q++) if (canAct(S, q)) can++;
  if (can <= 1 && S.street < 3 && !S.runout) {
    // 더 베팅할 사람이 없다 (올인) → 남은 사람들의 패를 공개하고 나머지 카드를 펼친다
    S.runout = true;
    S.shown = {};
    const shows = [];
    for (let q = 0; q < S.n; q++) if (live(S, q)) { S.shown[q] = S.hole[q].slice(); shows.push({ p: q, cards: S.hole[q].slice() }); }
    ev.push({ type: "reveal", shows, text: "올인 — 패를 공개하고 남은 카드를 펼칩니다" });
  }
}

function dealStreet(S, ev) {
  S.street++;
  const cards = [];
  for (let i = 0; i < (S.street === 1 ? 3 : 1); i++) cards.push(S.deck.pop());
  S.board.push(...cards);
  S.bet.fill(0); S.acted.fill(-1);
  S.curBet = 0; S.minRaise = S.bb; S.raises = 0;
  for (let q = 0; q < S.n; q++) if (canAct(S, q)) S.acts[q] = "";
  ev.push({ type: "street", street: S.street, cards, text: `${STREETS[S.street]}: ${cards.map(cardName).join(" ")}` });
  const nx = nextToAct(S, S.button);           // 버튼 다음 사람부터 (둘이면 BB 가 먼저)
  if (nx >= 0) { S.phase = "bet"; S.turn = nx; }
  else { S.phase = "deal"; S.turn = -1; }
}

/* 판 정산. showdown=false 면 한 명만 남아 패를 보이지 않고 가져간다 */
function settle(S, ev, showdown) {
  const n = S.n, won = Array(n).fill(0), scores = Array(n).fill(-1), shows = [];
  const order = [];
  for (let k = 1; k <= n; k++) order.push((S.button + k) % n);           // 버튼 왼쪽부터
  if (showdown) {
    for (const q of order) if (live(S, q)) {
      const h = bestHand([...S.hole[q], ...S.board]);
      scores[q] = h.score;
      shows.push({ p: q, cards: S.hole[q].slice(), hand: h.name, best: h.best });
      ev.push({ type: "show", p: q, cards: S.hole[q].slice(), hand: h.name, text: `{${q}} 님 ${S.hole[q].map(cardName).join(" ")} — ${h.name}` });
    }
    S.shown = Object.fromEntries(shows.map(s => [s.p, s.cards]));
  }
  const pots = buildPots(S, S.put), res = [];
  const named = pots.filter(x => x.elig.length).length > 1;
  let idx = 0;
  for (const pot of pots) {
    if (!pot.elig.length) {                       // 받을 사람이 없는 칩 → 낸 사람에게 돌려준다
      for (let q = 0; q < n; q++) { const c = Math.min(S.put[q], pot.cap) - pot.lo; if (c > 0) won[q] += c; }
      continue;
    }
    let best = -1;
    for (const q of pot.elig) best = Math.max(best, scores[q]);
    const winners = showdown ? order.filter(q => pot.elig.includes(q) && scores[q] === best) : order.filter(q => pot.elig.includes(q));
    const share = Math.floor(pot.amount / winners.length), rem = pot.amount - share * winners.length;
    const label = named ? (idx === 0 ? "메인 팟" : `사이드 팟 ${idx}`) : "팟";
    idx++;
    const ws = winners.map((q, j) => ({ p: q, amount: share + (j < rem ? 1 : 0) }));   // 남는 칩은 버튼 왼쪽 승자부터
    for (const w of ws) won[w.p] += w.amount;
    const hand = showdown ? handName(best) : null;
    res.push({ label, amount: pot.amount, winners: ws, hand });
    for (const w of ws) {
      const where = named ? `${label}에서 ` : "";
      const tail = hand ? ` (${hand}${ws.length > 1 ? ", 나눠 가짐" : ""})` : "";
      ev.push({ type: "win", p: w.p, amount: w.amount, pot: label, hand, split: ws.length > 1, text: `{${w.p}} 님이 ${where}${fmt(w.amount)} 칩을 가져갔습니다${tail}` });
    }
  }
  for (let q = 0; q < n; q++) { S.chips[q] += won[q]; S.put[q] = 0; S.bet[q] = 0; }
  const busted = [];
  for (let q = 0; q < n; q++) if (S.inHand[q] && S.chips[q] === 0) busted.push(q);
  busted.sort((a, b) => S.start[a] - S.start[b]);      // 같은 판에 떨어지면 적게 들고 시작한 사람이 먼저 탈락
  for (const q of busted) {
    S.out.push({ p: q, hand: S.handNo, start: S.start[q] });
    ev.push({ type: "bust", p: q, text: `{${q}} 님 탈락` });
  }
  S.last = {
    hand: S.handNo, showdown: !!showdown, board: S.board.slice(), shows, pots: res,
    delta: S.chips.map((c, q) => c - S.start[q]), bust: busted
  };
  S.phase = "end"; S.turn = -1;
}

function finish(S, ev) {
  S.phase = "over"; S.turn = -1;
  const alive = [];
  for (let q = 0; q < S.n; q++) if (S.chips[q] > 0) alive.push(q);
  ev.push({ type: "over", text: alive.length === 1 ? `{${alive[0]}} 님이 모든 칩을 차지했습니다! 🏆` : `${S.handNo}판을 모두 마쳤습니다 — 칩이 가장 많은 사람이 이깁니다` });
}

/* ===================== AI ===================== */
function aiAction(S, p, level, rng) {
  const L = legalInfo(S, p);
  const easy = level === "easy", hard = level === "hard";
  const check = { a: "check" }, call = { a: "call" }, fold = { a: "fold" };
  const passive = L.toCall > 0 ? call : check;
  const giveUp = L.toCall > 0 ? fold : check;
  const unit = S.sb;
  const raiseTo = x => {
    if (!L.canRaise) return passive;
    let to = Math.round(x / unit) * unit;
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    if (to >= L.maxTo || (L.maxTo - to) < S.bb * 2 || to - L.bet > L.stack * 0.7) return { a: "allin" };   // 거의 다 걸 거면 올인
    return { a: "raise", to };
  };
  const hole = S.hole[p].map(c => C2I[c]), board = S.board.map(c => C2I[c]);
  const opps = [];
  for (let q = 0; q < S.n; q++) if (q !== p && live(S, q)) opps.push(q);
  const nOpp = opps.length;
  const pot = sum(S.put), bb = S.bb, stack = L.stack, callAmt = L.callAmt;
  const potOdds = callAmt > 0 ? callAmt / (pot + callAmt) : 0;
  // 이번 거리에서 내 뒤에 행동할 사람 수 (자리 · 포지션)
  const first = S.street === 0 ? (S.bbSeat + 1) % S.n : (S.button + 1) % S.n;
  const ord = q => (q - first + S.n) % S.n;
  let after = 0;
  for (const q of opps) if (canAct(S, q) && ord(q) > ord(p)) after++;

  // 실수: 쉬움은 가끔 엉뚱하게
  if (easy && rng() < 0.07) {
    const r = rng();
    if (r < 0.45) return passive;
    if (r < 0.75) return giveUp;
    return L.canRaise ? raiseTo(L.minTo) : passive;
  }

  /* ---------- 프리플랍: 미리 계산한 표 ---------- */
  if (S.street === 0) {
    const eq = preflopEq(hole[0], hole[1], nOpp);
    let pct = preflopPct(hole[0], hole[1], nOpp) + (rng() - 0.5) * (easy ? 0.2 : hard ? 0.04 : 0.08);
    const raised = S.curBet > bb;
    const stackBB = (stack + L.bet) / bb;
    // 칩이 적으면: 올인 아니면 폴드
    if (!easy && stackBB <= (hard ? 13 : 10)) {
      if (!raised) {
        const range = hard ? (after <= 1 ? 0.55 : after <= 3 ? 0.4 : 0.3) : 0.3;
        if (pct >= 1 - range) return L.canRaise ? { a: "allin" } : passive;
        return giveUp;
      }
      const eqA = eq * (1 - 0.12 * Math.min(2, S.raises));
      if (eqA >= potOdds + 0.03 || pct >= 0.93) return L.canRaise && pct >= 0.9 ? { a: "allin" } : passive;
      return giveUp;
    }
    let limpers = 0;
    for (const q of opps) if (q !== S.bbSeat && S.bet[q] >= bb) limpers++;
    if (!raised) {
      // 아무도 안 올렸다: 오픈 레이즈 · 림프 · 체크 · 폴드
      let range = after >= 5 ? 0.14 : after === 4 ? 0.18 : after === 3 ? 0.24 : after === 2 ? 0.32 : after === 1 ? 0.45 : 0.5;
      if (nOpp === 1) range = 0.6;                         // 둘이 할 때는 넓게
      if (hard) range *= after <= 2 ? 1.2 : 1.05;
      if (easy) range = 0.08;
      range = Math.max(0, range - 0.04 * limpers);
      if (pct >= 1 - range) {
        const size = (hard ? 2.2 + rng() * 0.8 : 3) * bb + limpers * bb;
        return raiseTo(size);
      }
      if (L.toCall === 0) return check;                    // 빅 블라인드: 공짜로 본다
      if (easy && pct >= 0.35) return call;                // 쉬움: 아무 패나 따라 들어간다
      if (p === S.sbSeat && callAmt <= bb / 2 && pct >= (hard ? 0.45 : 0.55)) return call;
      if (!easy && limpers && pct >= 0.7 && callAmt <= bb) return call;
      return fold;
    }
    // 누가 올렸다
    const raiseBB = S.curBet / bb;
    let three = easy ? 0.02 : hard ? 0.07 : 0.05;
    if (S.raises >= 2) three /= 2;
    if (pct >= 1 - three && L.canRaise) return raiseTo(S.curBet * (S.raises >= 2 ? 2.4 : 3) + limpers * bb);
    if (hard && S.raises === 1 && after <= 1 && pct >= 0.55 && pct < 0.75 && rng() < 0.08 && L.canRaise) return raiseTo(S.curBet * 3);   // 가끔 블러프 3벳
    let range = easy ? 0.5 : hard ? 0.24 : 0.2;
    range /= 1 + 0.5 * (S.raises - 1) + Math.max(0, raiseBB - 4) * 0.08;
    if (p === S.bbSeat && S.raises === 1) range += 0.12;                     // 빅 블라인드 방어
    if (hard && after === 0) range += 0.04;
    const eqA = eq * (easy ? 1 : 1 - 0.1 * Math.min(3, S.raises));
    if (callAmt >= stack * 0.4 && !easy) range = Math.min(range, 0.1);        // 큰돈이면 좋은 패만
    if (pct >= 1 - range && eqA >= potOdds - (easy ? 0.1 : 0.02)) return passive;
    return giveUp;
  }

  /* ---------- 플랍 이후: 몬테카를로 ---------- */
  const thr = easy ? null : opps.map(q => (S.pfr[q] ? RANGE_RAISE : S.vpip[q] ? RANGE_CALL : 0));
  let eq = mcEquity(hole, board, nOpp, SIMS[level] || SIMS.normal, rng, thr);
  eq = Math.min(1, Math.max(0, eq + (rng() - 0.5) * (easy ? 0.16 : hard ? 0.03 : 0.06)));
  const vb = 0.25 + 0.75 / (nOpp + 1);                 // 밸류 벳 기준 (둘이면 0.625)
  const strong = 0.45 + 0.6 / (nOpp + 1);              // 크게 올릴 기준 (둘이면 0.75)
  const inPos = after === 0;
  const river = S.street === 3;
  const betSize = frac => raiseTo(L.bet + pot * frac);

  if (L.toCall === 0) {
    if (eq >= strong) {
      if (easy && rng() < 0.5) return check;
      if (!easy && !river && rng() < (hard ? 0.2 : 0.12) && !inPos) return check;    // 가끔 슬로플레이
      return betSize(hard ? 0.75 + rng() * 0.25 : 0.66);
    }
    if (eq >= vb) {
      if (easy) return rng() < 0.35 ? betSize(0.5) : check;
      return rng() < (inPos ? 0.85 : 0.65) ? betSize(hard ? 0.5 + rng() * 0.2 : 0.5) : check;
    }
    if (!easy && S.street === 1 && S.pfr[p] && nOpp <= 2 && rng() < (hard ? 0.6 : 0.45)) return betSize(0.5);   // 컨티뉴에이션 벳
    if (hard && !river && nOpp <= 2 && eq >= 0.3 && rng() < (inPos ? 0.45 : 0.3)) return betSize(0.55 + rng() * 0.15);   // 세미 블러프
    if (hard && river && nOpp <= 2 && inPos && eq < 0.3 && rng() < 0.16) return betSize(0.6 + rng() * 0.3);   // 블러프
    return check;
  }

  // 베팅을 받았다
  const betFrac = callAmt / Math.max(1, pot - callAmt);
  const eqA = easy ? eq : eq * (1 - 0.22 * Math.min(1.2, betFrac));     // 크게 걸수록 상대 패가 세다고 본다
  const margin = easy ? -0.08 : hard ? (river ? 0.03 : 0) : 0.03;
  if (eqA >= potOdds + margin) {
    if (eqA >= strong && L.canRaise && rng() < (easy ? 0.25 : hard ? 0.8 : 0.65)) {
      return raiseTo(S.curBet + (pot + callAmt) * (hard ? 0.7 + rng() * 0.3 : 0.75));
    }
    if (!easy && stack - callAmt < pot * 0.35 && eqA >= potOdds + 0.1 && L.canRaise) return { a: "allin" };   // 남는 칩이 적으면 그냥 다 건다
    return call;
  }
  if (hard && !river && S.street === 1 && eq >= 0.35 && nOpp === 1 && L.canRaise && rng() < 0.1) {
    return raiseTo(S.curBet * 3);                     // 드로우로 체크레이즈 세미 블러프
  }
  return fold;
}

/* ===================== 엔진 ===================== */
export default {
  id: "poker",
  name,
  icon: "♠️",
  blurb: "노리밋 텍사스 홀덤. 두 장과 공용 카드 다섯 장으로 가장 센 패를! (놀이용 칩만)",
  players: { min: 2, max: 8, default: 5 },
  settings: [
    { key: "chips", label: "시작 칩", values: [1000, 2000], labels: ["1,000", "2,000"], default: 1000, note: "블라인드는 10/20 부터 시작합니다" },
    { key: "blinds", label: "블라인드 상승", values: ["fixed", "up"], labels: ["고정", "8판마다 2배"], default: "up", note: "오를수록 게임이 빨리 끝납니다" },
    { key: "hands", label: "판 수 제한", values: [20, 40, 0], labels: ["20판", "40판", "한 명 남을 때까지"], default: 0, note: "판 수를 다 치르면 칩이 많은 순서로 순위" }
  ],
  rules: `<ul>
    <li><b>노리밋 텍사스 홀덤</b>입니다. 돈이 아닌 놀이용 칩만 오갑니다.</li>
    <li>각자 두 장을 받고, 가운데에 공용 카드가 <b>플랍(3장) → 턴(1장) → 리버(1장)</b> 순서로 펼쳐집니다. 내 두 장과 공용 다섯 장 중 <b>가장 센 5장</b>으로 겨룹니다.</li>
    <li>버튼(D) 왼쪽이 스몰 블라인드(SB), 그 다음이 빅 블라인드(BB)를 냅니다. <b>둘이 할 때</b>는 버튼이 SB 를 내고 프리플랍에 먼저, 플랍부터는 BB 가 먼저 행동합니다.</li>
    <li>행동: <b>폴드 · 체크 · 콜 · 벳/레이즈 · 올인</b>. 벳은 최소 빅 블라인드, 레이즈는 <b>이번 거리에서 직전에 올린 폭 이상</b> 더 올려야 합니다.</li>
    <li>모자란 금액으로 올인해 올린 경우(완전한 레이즈가 아님)에는, 이미 행동한 사람은 콜이나 폴드만 할 수 있습니다.</li>
    <li>올인한 사람은 자기가 낸 만큼까지만 각자에게서 가져갈 수 있어 <b>사이드 팟</b>이 생깁니다. 아무도 받지 않은 베팅은 돌려줍니다.</li>
    <li>더 베팅할 사람이 없으면(올인) 남은 사람들의 패를 공개하고 나머지 카드를 펼칩니다.</li>
    <li>쇼다운에서는 남은 사람 모두 패를 공개합니다. 폴드한 패는 공개하지 않습니다. 같은 패면 나누고, 남는 칩은 버튼 왼쪽에 가까운 승자가 가져갑니다. 모두 폴드하면 마지막 한 명이 패를 보이지 않고 가져갑니다.</li>
    <li>족보: 하이카드 &lt; 원페어 &lt; 투페어 &lt; 트리플 &lt; 스트레이트 &lt; 플러시 &lt; 풀하우스 &lt; 포카드 &lt; 스트레이트 플러시 &lt; 로열 플러시. A-2-3-4-5 도 스트레이트입니다.</li>
    <li>블라인드 상승: 8판마다 두 배 (10/20 → 20/40 → …). 고정을 골라도 '한 명 남을 때까지' 면 100판 뒤부터는 8판마다 오릅니다.</li>
    <li>칩이 0 이 되면 탈락합니다. 버튼은 칩이 있는 사람 사이에서만 돕니다.</li>
    <li>화면 도우미: 내 패의 현재 족보와 그 패를 만드는 카드(금색 테두리), 콜 금액 · 콜 후 팟 · <b>팟 오즈</b>(콜 금액 ÷ 콜 후 팟 — 이길 확률이 이보다 높으면 콜이 길게 보아 이득)를 계산해 보여 줍니다. <b>대략적인 승률</b>은 남은 상대들의 패를 무작위로 가정한 어림값이며, 눌러서 숨길 수 있습니다.</li>
    <li>순위: 끝까지 남은 사람이 1등, 나머지는 늦게 탈락할수록 높습니다 (같은 판에 함께 떨어지면 그 판을 더 많은 칩으로 시작한 사람이 위). 판 수 제한이 끝나면 칩이 많은 순서입니다.</li>
  </ul>`,

  setup({ n, seed, settings = {} }) {
    const chips = [1000, 2000].includes(settings.chips) ? settings.chips : 1000;
    const S = {
      n, rs: seed >>> 0,
      opt: { chips, blinds: settings.blinds === "fixed" ? "fixed" : "up", hands: [0, 20, 40].includes(settings.hands) ? settings.hands : 0 },
      total: chips * n, chips: Array(n).fill(chips), out: [],
      handNo: 0, level: 0, sb: 10, bb: 20, button: 0, sbSeat: -1, bbSeat: -1,
      phase: "start", street: 0, turn: -1, curBet: 0, minRaise: 20, raises: 0, runout: false,
      deck: [], hole: Array(n).fill(null), board: [], shown: null,
      inHand: Array(n).fill(false), folded: Array(n).fill(false), allin: Array(n).fill(false),
      bet: Array(n).fill(0), put: Array(n).fill(0), start: Array(n).fill(chips), acted: Array(n).fill(-1),
      pfr: Array(n).fill(false), vpip: Array(n).fill(false), acts: Array(n).fill(""),
      lastAct: null, last: null, log: []
    };
    S.button = (randInt(S, n) + n - 1) % n;     // 첫 판에 한 칸 옮겨 가므로 무작위 자리의 바로 앞
    return S;
  },

  pending(S) {
    return S.phase === "bet" ? [{ p: S.turn, kind: "bet" }] : [];
  },

  validate(S, p, a) {
    if (S.phase !== "bet" || p !== S.turn) return "지금은 내 차례가 아닙니다";
    if (!a || typeof a !== "object" || typeof a.a !== "string") return "행동을 고르세요";
    if (!canAct(S, p)) return "이번 판에서는 더 할 수 있는 행동이 없습니다";
    const L = legalInfo(S, p);
    switch (a.a) {
      case "fold": return true;
      case "check": return L.toCall === 0 ? true : `${fmt(L.toCall)} 칩을 더 내야 해서 체크할 수 없습니다 — 콜하거나 폴드하세요`;
      case "call": return L.toCall > 0 ? true : "더 낼 칩이 없습니다 — 체크하세요";
      case "raise": {
        if (!Number.isInteger(a.to)) return "올릴 금액을 정하세요";
        if (!L.canRaise) return raiseBlock(L);
        if (a.to > L.maxTo) return `가진 칩보다 많이 걸 수 없습니다 (최대 ${fmt(L.maxTo)})`;
        if (a.to <= S.curBet) return "지금 베팅보다 많이 걸어야 합니다";
        if (a.to < L.minTo) return S.curBet === 0 ? `최소 벳은 ${fmt(L.minTo)} 입니다` : `최소 ${fmt(L.minTo)} 까지 올려야 합니다`;
        return true;
      }
      case "allin":
        if (L.stack <= 0) return "걸 칩이 없습니다";
        if (L.maxTo > S.curBet && !L.canRaise) return raiseBlock(L);
        return true;
    }
    return "알 수 없는 행동입니다";
  },

  apply(S, p, a) {
    const ev = [];
    const L = legalInfo(S, p);
    let kind = a.a;
    if (kind === "raise" && a.to >= L.maxTo) kind = "allin";
    let text, amt = 0;
    if (kind === "fold") {
      S.folded[p] = true; S.acts[p] = "폴드";
      text = `{${p}} 님 폴드`;
    } else if (kind === "check") {
      S.acted[p] = S.curBet; S.acts[p] = "체크";
      text = `{${p}} 님 체크`;
    } else if (kind === "call" || (kind === "allin" && L.maxTo <= S.curBet)) {
      amt = L.callAmt;
      putChips(S, p, amt);
      S.acted[p] = S.curBet;
      if (S.street === 0) S.vpip[p] = true;
      kind = S.allin[p] ? "allin" : "call";
      S.acts[p] = S.allin[p] ? "올인" : "콜";
      text = S.allin[p] ? `{${p}} 님 올인! (콜 ${fmt(amt)})` : `{${p}} 님 콜 ${fmt(amt)}`;
    } else {
      const to = kind === "allin" ? L.maxTo : a.to;
      const opening = S.curBet === 0;
      amt = to - S.bet[p];
      putChips(S, p, amt);
      const inc = to - S.curBet;
      if (inc >= S.minRaise) S.minRaise = inc;           // 완전한 레이즈 — 다음 최소 레이즈 폭
      S.curBet = to; S.raises++;
      S.acted[p] = to;
      if (S.street === 0) { S.vpip[p] = true; S.pfr[p] = true; }
      if (S.allin[p]) kind = "allin"; else kind = opening ? "bet" : "raise";
      S.acts[p] = S.allin[p] ? "올인" : `${opening ? "벳" : "레이즈"} ${fmt(to)}`;
      text = S.allin[p] ? `{${p}} 님 올인! (${fmt(to)})` : `{${p}} 님 ${opening ? "벳" : "레이즈"} ${fmt(to)}`;
    }
    S.lastAct = { p, a: kind, amount: amt, to: S.bet[p] };
    (S.log || (S.log = [])).push({ st: S.street, p, a: kind, to: S.bet[p] });
    ev.push({ type: "act", p, a: kind, amount: amt, to: S.bet[p], text });
    let left = 0, last = -1;
    for (let q = 0; q < S.n; q++) if (live(S, q)) { left++; last = q; }
    if (left === 1) {
      refundUncalled(S, ev);
      settle(S, ev, false);
      return ev;
    }
    const nx = nextToAct(S, p);
    if (nx >= 0) S.turn = nx;
    else closeRound(S, ev);
    return ev;
  },

  step(S) {
    const ev = [];
    if (S.phase === "start") startHand(S, ev);
    else if (S.phase === "deal") {
      if (S.street >= 3) settle(S, ev, true);
      else dealStreet(S, ev);
    } else if (S.phase === "end") {
      let alive = 0;
      for (let q = 0; q < S.n; q++) if (S.chips[q] > 0) alive++;
      if (alive <= 1 || (S.opt.hands && S.handNo >= S.opt.hands) || S.handNo >= MAX_HANDS) finish(S, ev);
      else startHand(S, ev);
    }
    return ev;
  },

  delay(S) {
    if (S.phase === "start") return 600;
    if (S.phase === "deal") return S.runout ? 1600 : 900;
    if (S.phase === "end") return S.last && S.last.showdown ? 4500 : 3000;
    return 800;
  },

  timeout(S, p) {
    return S.curBet - S.bet[p] > 0 ? { a: "fold" } : { a: "check" };
  },

  ai(S, p, { level, rng }) {
    return aiAction(S, p, level, rng);
  },
  thinkTime(S) {
    return S.street === 0 ? 650 + Math.random() * 700 : 900 + Math.random() * 900;
  },

  view(S, p) {
    const me = p >= 0 && p < S.n ? p : -1;
    const playing = S.phase === "bet" || S.phase === "deal";
    const collected = S.put.map((x, q) => x - S.bet[q]);
    const pots = buildPots(S, collected).map(x => ({ amount: x.amount, elig: x.elig }));
    const seats = [];
    for (let q = 0; q < S.n; q++) {
      seats.push({
        chips: S.chips[q], bet: S.bet[q], put: S.put[q], fold: S.folded[q], allin: S.allin[q],
        out: isOut(S, q), inHand: S.inHand[q], act: S.acts[q],
        cards: S.shown && S.shown[q] ? S.shown[q].slice() : null
      });
    }
    let my = null;
    if (me >= 0) {
      const L = legalInfo(S, me);
      const hole = S.hole[me] ? S.hole[me].slice() : null;
      const made = hole && S.board.length >= 3 && S.phase !== "over" ? bestHand([...hole, ...S.board]) : null;
      my = {
        hole, chips: S.chips[me], bet: S.bet[me], put: S.put[me],
        toCall: playing ? L.toCall : 0, callAmt: playing ? L.callAmt : 0, minTo: L.minTo, maxTo: L.maxTo, canRaise: L.canRaise,
        kinds: S.phase === "bet" && S.turn === me ? L.kinds : [],
        made: made ? { name: made.name, best: made.best } : null
      };
    }
    let status = "";
    if (S.phase === "over") status = "게임 끝";
    else if (S.phase === "start") status = "카드를 섞는 중";
    else if (S.phase === "end") status = `${S.handNo}번째 판 결과`;
    else if (S.phase === "deal") status = S.runout ? "올인 — 카드를 펼치는 중" : S.street >= 3 ? "쇼다운" : `${STREETS[S.street + 1]} 펼치는 중`;
    else if (S.turn === me && my) status = my.toCall > 0 ? `내 차례 — 콜 ${fmt(my.callAmt)}` : "내 차례 — 체크 또는 벳";
    return {
      phase: S.phase, hand: S.handNo, limit: S.opt.hands, blinds: S.opt.blinds, level: S.level, sb: S.sb, bb: S.bb,
      nextUp: nextLevelHand(S), button: S.button, sbSeat: S.sbSeat, bbSeat: S.bbSeat,
      street: S.street, board: S.board.slice(), seats, pots, potTotal: sum(S.put),
      curBet: S.curBet, minRaise: S.minRaise, turn: S.phase === "bet" ? S.turn : -1, runout: S.runout,
      lastAct: S.lastAct, log: (S.log || []).slice(-24), my, last: S.last, status
    };
  },

  over(S) { return S.phase === "over"; },

  results(S) {
    const alive = [];
    for (let q = 0; q < S.n; q++) if (!isOut(S, q)) alive.push(q);
    alive.sort((a, b) => S.chips[b] - S.chips[a]);
    const outs = S.out.slice().sort((a, b) => b.hand - a.hand || b.start - a.start);
    const list = [
      ...alive.map(q => ({ p: q, key: "a" + S.chips[q], score: S.chips[q], note: alive.length === 1 ? "모든 칩을 차지했습니다" : `칩 ${fmt(S.chips[q])}` })),
      ...outs.map(o => ({ p: o.p, key: `o${o.hand}.${o.start}`, score: 0, note: `${o.hand}번째 판에서 탈락` }))
    ];
    let rank = 0;
    return list.map((x, i) => {
      if (i === 0 || x.key !== list[i - 1].key) rank = i + 1;
      return { p: x.p, rank, score: x.score, note: x.note };
    });
  },

  /* ---------- 시험용 ---------- */
  stepLimit: 120000,

  randomAction(S, p, rng) {
    const L = legalInfo(S, p);
    const opts = [];
    if (L.toCall > 0) { opts.push([0.2, { a: "fold" }], [0.42, { a: "call" }]); }
    else { opts.push([0.03, { a: "fold" }], [0.5, { a: "check" }]); }
    if (L.canRaise) {
      opts.push([0.14, { a: "raise", to: L.minTo }]);
      opts.push([0.12, { a: "raise", to: L.minTo + Math.floor(rng() * (L.maxTo - L.minTo + 1)) }]);
      opts.push([0.03, { a: "allin" }]);
    } else if (L.kinds.includes("allin")) opts.push([0.05, { a: "allin" }]);
    let r = rng() * sum(opts.map(o => o[0]));
    for (const [w, a] of opts) { if ((r -= w) < 0) return a; }
    return opts[0][1];
  },

  check(S) {
    const tot = sum(S.chips) + sum(S.put);
    if (tot !== S.total) return `칩 총합이 맞지 않음 ${tot} ≠ ${S.total}`;
    for (let q = 0; q < S.n; q++) {
      for (const k of ["chips", "put", "bet"]) {
        if (!Number.isInteger(S[k][q]) || S[k][q] < 0) return `${q}번 ${k} 값 이상: ${S[k][q]}`;
      }
      if (S.bet[q] > S.put[q]) return `${q}번 이번 거리 베팅이 이번 판 낸 칩보다 큼`;
      if (isOut(S, q) && S.chips[q] !== 0) return `탈락한 ${q}번에게 칩이 있음`;
    }
    if (S.phase === "bet" || S.phase === "deal") {
      const all = [...S.deck, ...S.board];
      for (const h of S.hole) if (h) all.push(...h);
      if (all.length !== 52 || new Set(all).size !== 52) return `카드 수가 맞지 않음 (${all.length})`;
      if (S.board.length !== [0, 3, 4, 5][S.street]) return "공용 카드 수가 거리와 맞지 않음";
      for (let q = 0; q < S.n; q++) {
        if (S.allin[q] && S.chips[q] !== 0) return `${q}번 올인인데 칩이 남음`;
        if (live(S, q) && S.chips[q] === 0 && !S.allin[q]) return `${q}번 칩이 없는데 올인 표시가 없음`;
        if (!S.inHand[q] && (S.put[q] || S.hole[q])) return `판에 없는 ${q}번이 칩이나 카드를 가짐`;
        if (S.inHand[q] && (!S.hole[q] || S.hole[q].length !== 2)) return `${q}번 손패가 두 장이 아님`;
      }
      if (S.curBet < Math.max(...S.bet)) return "현재 베팅이 가장 큰 베팅보다 작음";
      // 사이드 팟: 합계 · 자격이 포개지는지 · 빈 팟 없음
      const col = S.put.map((x, q) => x - S.bet[q]);
      const pots = buildPots(S, col);
      if (sum(pots.map(x => x.amount)) !== sum(col)) return "팟 합계가 맞지 않음";
      for (let i = 0; i < pots.length; i++) {
        if (pots[i].amount <= 0) return "빈 팟";
        if (!pots[i].elig.length) return "받을 사람이 없는 팟";
        if (i && !pots[i].elig.every(q => pots[i - 1].elig.includes(q))) return "사이드 팟 자격이 포개지지 않음";
      }
      // 지난 거리까지 모은 칩: 올인 안 한 남은 사람들은 모두 같고, 올인한 사람은 그보다 많지 않다
      let M = -1;
      for (let q = 0; q < S.n; q++) if (canAct(S, q)) { if (M < 0) M = col[q]; else if (col[q] !== M) return "남은 사람들이 낸 칩이 다름"; }
      if (M >= 0) for (let q = 0; q < S.n; q++) if (live(S, q) && S.allin[q] && col[q] > M) return "올인한 사람이 더 많이 냄 (돌려주기 누락)";
      if (S.phase === "bet") {
        if (!canAct(S, S.turn)) return "차례인 사람이 행동할 수 없음";
        if (S.acted[S.turn] >= 0 && S.bet[S.turn] >= S.curBet) return "할 일이 없는 사람에게 차례가 감";
      }
      if (S.phase === "deal" && sum(S.bet)) return "거리가 끝났는데 베팅이 남음";
    }
    if (S.phase === "end" || S.phase === "over") {
      if (sum(S.put)) return "판이 끝났는데 낸 칩이 남음";
    }
    if (S.shown) for (const q of Object.keys(S.shown)) if (!live(S, +q)) return "폴드한 사람의 패가 공개됨";
    if (S.last && S.last.hand === S.handNo && S.phase === "end") {
      for (const s of S.last.shows) {
        if (!live(S, s.p)) return "폴드한 사람의 패가 공개됨";
        if (s.cards.join() !== S.hole[s.p].join()) return "공개한 패가 실제와 다름";
      }
      if (S.last.shows.length && !S.last.showdown) return "쇼다운이 아닌데 패 공개";
    }
    return true;
  },

  leak(S, p, v) {
    if (JSON.stringify(v).includes('"deck"')) return "덱 정보가 들어 있음";
    const allowed = new Set(S.board);
    if (S.hole[p]) for (const c of S.hole[p]) allowed.add(c);
    if (S.shown) for (const q of Object.keys(S.shown)) for (const c of S.shown[q]) allowed.add(c);
    const RE = /^[SHDC](1[0-3]|[1-9])$/;
    let bad = null;
    const walk = (x, key) => {
      if (bad || key === "last") return;
      if (typeof x === "string") { if (RE.test(x) && !allowed.has(x)) bad = x; return; }
      if (Array.isArray(x)) { for (const y of x) walk(y); return; }
      if (x && typeof x === "object") for (const k of Object.keys(x)) walk(x[k], k);
    };
    walk(v);
    if (bad) return `남의 카드 ${bad} 가 보임`;
    // 지난 판 요약은 쇼다운에서 공개된 패만 담는다 (엔진 상태와 그대로 같아야 함)
    if (JSON.stringify(v.last) !== JSON.stringify(S.last)) return "지난 판 요약이 상태와 다름";
    if (v.last && !v.last.showdown && v.last.shows.length) return "쇼다운 없이 패가 공개됨";
    return true;
  }
};
