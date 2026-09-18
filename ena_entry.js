// ENA 机械入场状态机（浏览器版，与 scripts/lib/ena_entry.js 同源）
(function(){
'use strict';

// ═══ ENA 机械化入场状态机（09-18 哥规格）════════════════════════
// 1H 负责「买什么」· 15m 负责「什么时候买」· Trigger 负责「在哪个价格买」
//   NONE → 🟡 PRE_ENTRY → 🟢 ARMED → 🔥 TRIGGER → POSITION
//                                    ↘ ❌ CANCEL / ⏰ EXPIRED
// 老的三档观察线（EARLY/BUILDING/PRE-SIGNAL）不再推（见 engine LEGACY_WATCH）
const PRE = { q: 8.0, h: 80, en: 3, stages: ['TRENDING', 'RETEST'] };  // 回踩预备（1H 闸）
const BRK = { q: 8.0, h: 85, en: 4, stage: 'BREAKOUT' };               // 强突破（1H 闸）
const DIST_WAIT = 3.0;          // 15m 等待区：距 MA7 ≤3%
const PULL_MIN = 1.0, PULL_MAX = 4.0;   // 回撤幅度 1%~4%
const NO_CHASE = 5.0;           // 距 MA7 >5% → 直接 CANCEL（不许追高）
const BRK_DIST = 4.0;           // 突破单：距 MA7 ≤4%
const CHASE_ATR = 0.75;         // max_entry = 触发价 + 0.75×ATR(15m)
const VALID_MS = 30 * 60 * 1000; // 正式 ENTRY 有效 2 根 15m = 30min

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pctv = (a, b) => b ? (a - b) / b * 100 : 0;

function atr14(kl) {
  if (kl.length < 15) return null;
  const trs = [];
  for (let i = kl.length - 14; i < kl.length; i++) {
    const p = kl[i - 1] ? kl[i - 1].c : kl[i].o;
    trs.push(Math.max(kl[i].h - kl[i].l, Math.abs(kl[i].h - p), Math.abs(kl[i].l - p)));
  }
  return avg(trs);
}

// 15m 结构分析：回踩低点 / 回撤幅度 / 缩量 / 收复结构 / 确认K（Trigger）
function analyze(kl) {
  const L = kl.length, closes = kl.map(k => k.c);
  const price = closes[L - 1];
  const ma7 = [];
  for (let i = 6; i < L; i++) ma7.push(avg(closes.slice(i - 6, i + 1)));
  const maNow = ma7[ma7.length - 1], maPrev = ma7[ma7.length - 4] != null ? ma7[ma7.length - 4] : ma7[0];
  const dist15 = pctv(price, maNow), slope15 = pctv(maNow, maPrev);
  const W = Math.min(24, L - 2);
  const seg = kl.slice(-W);
  let lo = 0;
  seg.forEach((k, i) => { if (k.l <= seg[lo].l) lo = i; });
  const pbLow = seg[lo].l;
  const priorHigh = lo > 0 ? Math.max(...seg.slice(0, lo).map(k => k.h)) : Math.max(...seg.map(k => k.h));
  const depth = priorHigh ? (priorHigh - pbLow) / priorHigh * 100 : 0;
  const volBefore = avg(seg.slice(0, lo).map(k => k.v));
  const volPB = avg(seg.slice(lo).map(k => k.v));
  const volShrink = volBefore > 0 && volPB < volBefore * 0.9;
  const smallStruct = lo >= 3 ? Math.max(...seg.slice(lo - 3, lo).map(k => k.h)) : priorHigh;
  const reclaim = price > smallStruct;
  const structIntact = seg.slice(lo + 1).every(k => k.c >= pbLow);
  const maUp = slope15 >= -0.1;
  // 确认 K：回踩低点后第一根「收阳且收盘破前高」→ Trigger = 该 K 高点
  let trigger = null;
  for (let i = lo + 1; i < W - 1; i++) {
    const b = seg[i];
    if (b.c > b.o && b.c > seg[i - 1].h) { trigger = b.h; break; }
  }
  const cur = kl[L - 1];
  const fired = !!(trigger != null && cur.h > trigger && cur.c > trigger);
  // 强突破（15m）：收盘破前 8 根最高 + 量 > 20 根均量 ×1.5
  const prev8 = Math.max(...kl.slice(-9, -1).map(k => k.h));
  const vol20 = avg(kl.slice(-21, -1).map(k => k.v));
  const volStrong = vol20 > 0 && cur.v > vol20 * 1.5;
  const broke = cur.c > prev8;
  return { price, maNow, dist15, slope15, pbLow, priorHigh, depth, volShrink, smallStruct, reclaim, structIntact, maUp, trigger, fired, prev8, volStrong, broke, atr15: atr14(kl) };
}

const E5 = { NONE: 0, PRE_ENTRY: 3, ARMED: 4, TRIGGER: 5 };
const E5_LABEL = ['❌ 0/5 NO ENTRY', '⚪️ 1/5 TOO EARLY', '🟡 2/5 WATCH', '🟡 3/5 PRE-ENTRY', '🟢 4/5 ARMED', '🔥 5/5 ENTRY'];
function distLabel(d) { const a = Math.abs(d); return a <= 1 ? '🔥 很近' : a <= 2 ? '🟢 接近' : a <= 4 ? '🟡 等待' : '⚪️ 太远'; }

// 主判定：r = calcENA3 输出；kl15 = 15m K线；prev = 上一轮 entry 状态
function evalEntry(r, kl15, prev) {
  const a = analyze(kl15);
  const q = r.quality, h = r.health, st = r.stage, en = r.entry, dist = r.dist;
  const out = { state: 'NONE', kind: null, trigger: a.trigger, maxEntry: null, distPct: null, checks: {}, missing: [], note: '', a, ts: Date.now(), entry5: 0, e5Label: E5_LABEL[0] };
  if (st === 'EXTENDED' || st === 'DECAY' || h < 60) { out.note = `阶段 ${st} / 健康 ${h} → 不参与`; return out; }
  if (dist > NO_CHASE) { out.state = 'CANCEL'; out.note = `距 MA7 ${dist.toFixed(1)}% > ${NO_CHASE}% → 不许追高`; out.entry5 = 0; out.e5Label = E5_LABEL[0]; return out; }
  const rt1h = q >= PRE.q && h >= PRE.h && PRE.stages.includes(st) && en >= PRE.en;
  const br1h = q >= BRK.q && h >= BRK.h && st === BRK.stage && en >= BRK.en;
  if (!rt1h && !br1h) { out.note = `1H 未达门槛（Q${q.toFixed(1)}/H${h}/Entry${en}）`; out.entry5 = 1; out.e5Label = E5_LABEL[1]; return out; }
  // ⏰ 有效性 / 追价窗口（TRIGGER 后 30min 内且未超 max_entry）
  if (prev && prev.state === 'TRIGGER') {
    if (Date.now() - (prev.ts || 0) > VALID_MS) { out.state = 'EXPIRED'; out.kind = prev.kind; out.note = 'ENTRY 已过 30min 有效期 → 重新等结构'; return out; }
    if (prev.maxEntry && a.price > prev.maxEntry) { out.state = 'EXPIRED'; out.kind = prev.kind; out.note = `超过追价上限 ${prev.maxEntry} → ENTRY EXPIRED`; return out; }
  }
  // ❌ 入场失效（还没触发就坏了 → CANCEL，不等止损）
  if (prev && (prev.state === 'PRE_ENTRY' || prev.state === 'ARMED')) {
    if (!a.structIntact) { out.state = 'CANCEL'; out.kind = prev.kind; out.note = '15m 收盘跌破回踩低点'; return out; }
    if (h < 70) { out.state = 'CANCEL'; out.kind = prev.kind; out.note = `1H 健康度 ${h} < 70`; return out; }
    if (a.slope15 < 0) { out.state = 'CANCEL'; out.kind = prev.kind; out.note = 'MA7 斜率转负'; return out; }
  }
  // 🔥 强突破（允许直接追，但只能追第一小段）
  if (br1h && a.broke && a.volStrong && dist <= BRK_DIST) {
    out.kind = 'BREAKOUT';
    const trig = a.prev8;
    const maxE = trig + CHASE_ATR * (a.atr15 || 0);
    out.trigger = trig; out.maxEntry = +maxE.toFixed(8);
    out.checks = { 突破: true, 放量: true, 距MA7: true };
    if (a.price > maxE) { out.state = 'EXPIRED'; out.note = `现价已超追价上限 ${out.maxEntry}（=触发位+0.75ATR）`; return out; }
    out.state = 'TRIGGER';
    out.entry5 = 5; out.e5Label = E5_LABEL[5];
    return out;
  }
  // 🟢 回踩确认（默认买点）
  if (rt1h) {
    out.kind = 'RETEST';
    const c = {
      结构: a.structIntact,
      回踩: a.depth >= PULL_MIN && a.depth <= PULL_MAX && dist <= DIST_WAIT,
      缩量: a.volShrink,
      收复: a.reclaim,
      MA7: a.maUp
    };
    out.checks = c;
    out.missing = Object.keys(c).filter(k => !c[k]);
    if (a.trigger == null) out.missing = out.missing.concat(['确认K']);
    if (!out.missing.length && a.fired && a.trigger != null) {
      const maxE = a.trigger + CHASE_ATR * (a.atr15 || 0);
      out.maxEntry = +maxE.toFixed(8);
      if (a.price > maxE) { out.state = 'EXPIRED'; out.note = `现价已超追价上限 ${out.maxEntry}（=触发位+0.75ATR）`; return out; }
      out.state = 'TRIGGER';
      out.entry5 = 5; out.e5Label = E5_LABEL[5];
      return out;
    }
    if (!out.missing.length) { out.state = 'ARMED'; out.entry5 = 4; out.e5Label = E5_LABEL[4]; return out; }
    out.state = 'PRE_ENTRY'; out.entry5 = 3; out.e5Label = E5_LABEL[3];
    return out;
  }
  // 1H 达标但只够突破闸（还没突破）：先盯
  out.state = 'PRE_ENTRY'; out.entry5 = 3; out.e5Label = E5_LABEL[3];
  out.checks = { 突破: a.broke, 放量: a.volStrong, 距MA7: dist <= BRK_DIST };
  out.missing = Object.keys(out.checks).filter(k => !out.checks[k]);
  return out;
}

// Entry Distance：现价距 Trigger 还有多远
function entryDistance(trigger, price) {
  if (trigger == null || !price) return null;
  const d = pctv(trigger, price);
  return { pct: d, label: distLabel(d) };
}
var ENAEntry={evalEntry:evalEntry,analyze:analyze,entryDistance:entryDistance,distLabel:distLabel,E5:E5,E5_LABEL:E5_LABEL,PRE:PRE,BRK:BRK,DIST_WAIT:DIST_WAIT,NO_CHASE:NO_CHASE,VALID_MS:VALID_MS,CHASE_ATR:CHASE_ATR};
if(typeof window!=='undefined')window.ENAEntry=ENAEntry;
if(typeof module!=='undefined'&&module.exports)module.exports=ENAEntry;
})();
