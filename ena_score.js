// ENA Trend Radar v2 — 核心计算模块
// 5 指标: 距MA7 / MA7 20根涨幅 / MA7单调性 / 末5根斜率 / 峰值回撤
// 输出: Quality(0-10) + Stage(枚举) + Entry(0-5) + Health(0-100) + Pullback(布尔)
// v2 变更: 指标去相关 / 区间化 / 趋势阶段 / 入场质量 / 健康度

function calcMA7(closes) {
  const ma7 = [];
  for (let i = 6; i < closes.length; i++) {
    let s = 0;
    for (let j = i - 6; j <= i; j++) s += closes[j];
    ma7.push(s / 7);
  }
  return ma7;
}

// 指标原始值
function calcIndicators(closes) {
  const ma7 = calcMA7(closes);
  const n = ma7.length;
  const price = closes[closes.length - 1];
  const curMA7 = ma7[n - 1];
  const dist = (price - curMA7) / curMA7 * 100;
  const gain = ma7[n - 21] > 0 ? (ma7[n - 1] - ma7[n - 21]) / ma7[n - 21] * 100 : 0;
  // 单调性: 最近20段中环比上涨比例
  const seg = ma7.slice(n - 21);
  let up = 0;
  for (let i = 1; i < seg.length; i++) if (seg[i] > seg[i - 1]) up++;
  const mono = up / (seg.length - 1) * 100;
  // 末5根斜率
  const slope = (ma7[n - 1] - ma7[n - 6]) / ma7[n - 6] * 100;
  // 峰值回撤
  const cseg = closes.slice(n - 20);
  const peak = Math.max(...cseg);
  const dd = (peak - cseg[cseg.length - 1]) / peak * 100;
  return { price, ma7, dist, gain, mono, slope, dd };
}

// ── ① Quality 0~10：趋势有多漂亮（去相关）──
function calcQuality(ind) {
  let q = 0;
  // 单调性 0~3（趋势连贯性）
  if (ind.mono >= 95) q += 3;
  else if (ind.mono >= 90) q += 2.5;
  else if (ind.mono >= 85) q += 2;
  else if (ind.mono >= 75) q += 1;
  // 末5斜率 0~3（2~8% 温和加速最佳；过陡降分）
  if (ind.slope >= 2 && ind.slope <= 8) q += 3;
  else if (ind.slope > 0 && ind.slope < 2) q += 1.5;
  else if (ind.slope > 8 && ind.slope <= 12) q += 1.5;
  else if (ind.slope > 12) q += 0.5;
  // 20根涨幅 0~2（区间化：强≠好买）
  if (ind.gain >= 15 && ind.gain <= 25) q += 2;
  else if (ind.gain >= 5 && ind.gain < 15) q += 1.5;
  else if (ind.gain > 25 && ind.gain <= 35) q += 1;
  else if (ind.gain > 35) q += 0.5;
  // 峰值回撤 0~2
  if (ind.dd <= 1) q += 2;
  else if (ind.dd <= 3) q += 1.5;
  else if (ind.dd <= 5) q += 0.5;
  return Math.round(q * 10) / 10;
}

// ── ② Stage：趋势阶段（枚举）──
function calcStage(ind) {
  if (ind.dist > 6 || ind.slope > 12 || ind.gain > 35) return 'OVEREXTENDED';  // 过热
  if (ind.slope < 0 || ind.mono < 60 || ind.dd > 5) return 'DECLINING';        // 衰退
  if (ind.dist <= 1.5 && ind.gain < 12) return 'STARTING';                     // 启动
  if (ind.dist <= 4 && ind.slope >= 2) return 'ACCELERATION';                  // 加速
  if (ind.dist > 4 || ind.gain >= 20) return 'MATURE';                         // 成熟
  return 'ACCELERATION';
}

// ── Pullback：强趋势中的健康回踩 ──
// 最近5根曾触及/跌破MA7 → 现重新站回MA7上方 → MA7斜率未破坏 → 距MA7<1.5%
function detectPullback(closes, ma7) {
  const n = closes.length;
  if (n < 30) return false;
  let dipped = false;
  for (let i = Math.max(0, n - 6); i < n; i++) {
    if (closes[i] < ma7[i]) dipped = true;
  }
  const ma7Up = ma7[n - 1] > ma7[n - 4];
  const backAbove = closes[n - 1] > ma7[n - 1];
  const dist = (closes[n - 1] - ma7[n - 1]) / ma7[n - 1] * 100;
  return dipped && ma7Up && backAbove && dist < 1.5;
}

// ── ③ Entry 0~5：现在是不是好入场点 ──
function calcEntry(ind, pullback) {
  let e = 0;
  // 距离 0~2（0.5~3% 最佳区）
  if (ind.dist >= 0.5 && ind.dist <= 3) e += 2;
  else if (ind.dist >= 0 && ind.dist < 0.5) e += 1;
  else if (ind.dist > 3 && ind.dist <= 4) e += 1;
  // 回撤健康 0~1
  if (ind.dd <= 2) e += 1;
  // 单调性 0~1
  if (ind.mono >= 90) e += 1;
  // 斜率温和 0~1
  if (ind.slope >= 2 && ind.slope <= 8) e += 1;
  // 健康回踩奖励
  if (pullback) e += 1;
  return Math.min(5, e);
}

// ── ④ Health 0~100：趋势健康度 ──
function calcHealth(ind) {
  let h = 100;
  h -= (100 - ind.mono) * 0.4;          // 单调性不足
  if (ind.dd > 1) h -= (ind.dd - 1) * 5; // 回撤加深
  if (ind.dist > 4) h -= (ind.dist - 4) * 4; // 过度偏离
  if (ind.slope > 8) h -= (ind.slope - 8) * 3; // 过度加速
  if (ind.slope < 0) h -= 15;            // 斜率转负
  if (ind.gain > 30) h -= (ind.gain - 30); // 涨幅过大
  return Math.max(0, Math.min(100, Math.round(h)));
}

// ── 汇总 v2 ──
function calcENA2(closes) {
  if (!closes || closes.length < 30) return null;
  const ind = calcIndicators(closes);
  const quality = calcQuality(ind);
  const stage = calcStage(ind);
  const pullback = detectPullback(closes, ind.ma7);
  const entry = calcEntry(ind, pullback);
  const health = calcHealth(ind);
  return { quality, stage, entry, health, pullback, ind };
}

// ── 旧版 calcENA（兼容，供监控推送使用）──
function scoreDistMA7(price, ma7) {
  const dist = (price - ma7) / ma7 * 100;
  let score;
  if (price < ma7) score = 0;
  else if (dist <= 1) score = 1;
  else if (dist <= 4) score = 3;
  else if (dist <= 6) score = 2;
  else if (dist <= 8) score = 1;
  else score = 0;
  return { score, dist };
}
function scoreMA7Gain(ma7) {
  const n = ma7.length;
  const start = ma7[n - 21], end = ma7[n - 1];
  const gain = (end - start) / start * 100;
  let score;
  if (gain < 5) score = 0;
  else if (gain < 10) score = 1;
  else if (gain < 20) score = 2;
  else if (gain <= 35) score = 3;
  else score = 2;
  return { score, gain };
}
function scoreMonotonic(ma7) {
  const n = ma7.length;
  const seg = ma7.slice(n - 21);
  let up = 0;
  for (let i = 1; i < seg.length; i++) if (seg[i] > seg[i - 1]) up++;
  const ratio = up / (seg.length - 1) * 100;
  let score;
  if (ratio >= 95) score = 2;
  else if (ratio >= 85) score = 1.5;
  else if (ratio >= 75) score = 1;
  else score = 0;
  return { score, ratio };
}
function scoreSlope5(ma7) {
  const n = ma7.length;
  const start = ma7[n - 6], end = ma7[n - 1];
  const slope = (end - start) / start * 100;
  let score;
  if (slope <= 2) score = 1;
  else if (slope <= 6) score = 2;
  else if (slope <= 9) score = 1.5;
  else if (slope <= 12) score = 1;
  else score = 0;
  return { score, slope };
}
function scoreDrawdown(closes) {
  const n = closes.length;
  const seg = closes.slice(n - 20);
  const peak = Math.max(...seg);
  const cur = seg[seg.length - 1];
  const dd = (peak - cur) / peak * 100;
  let score;
  if (dd <= 1) score = 2;
  else if (dd <= 3) score = 1;
  else if (dd <= 5) score = 0.5;
  else score = 0;
  return { score, dd };
}
function calcENA(closes) {
  if (!closes || closes.length < 30) return null;
  const ma7 = calcMA7(closes);
  const price = closes[closes.length - 1];
  const curMA7 = ma7[ma7.length - 1];
  const d1 = scoreDistMA7(price, curMA7);
  const d2 = scoreMA7Gain(ma7);
  const d3 = scoreMonotonic(ma7);
  const d4 = scoreSlope5(ma7);
  const d5 = scoreDrawdown(closes);
  const total = d1.score + d2.score + d3.score + d4.score + d5.score;
  let level = '⚪️ 普通';
  if (total >= 10.5) level = '🔥 S级趋势';
  else if (total >= 8.5) level = '🟡 A级趋势';
  return { total, level, parts: { d1, d2, d3, d4, d5 } };
}

if (typeof module !== 'undefined') module.exports = {
  calcENA, calcENA2, calcIndicators, calcQuality, calcStage, calcEntry, calcHealth,
  detectPullback, calcMA7, scoreDistMA7, scoreMA7Gain, scoreMonotonic, scoreSlope5, scoreDrawdown
};
if (typeof window !== 'undefined') window.ENAScore = {
  calcENA, calcENA2, calcIndicators, calcQuality, calcStage, calcEntry, calcHealth,
  detectPullback, calcMA7
};

// ═══════════════════════════════════════════════════════
// V3.1 交易计划生成器（评分器 → 计划生成器）
// 三权分离：Quality 选币 / Entry 选时机 / SL-TP 管风险
// ═══════════════════════════════════════════════════════

// ── 7 阶段模型 ──
// STARTING → ACCUMULATION → TRENDING → BREAKOUT → RETEST → BREAKOUT AGAIN → EXTENDED → DECAY
function calcStageV31(ind, pullback) {
  if (ind.dist > 6 || ind.slope > 12 || ind.gain > 35) return 'EXTENDED';   // 过热延伸
  if (ind.slope < 0 || ind.mono < 60 || ind.dd > 5) return 'DECAY';         // 趋势失效
  if (pullback) return 'RETEST';                                            // 强趋势健康回踩（独立状态）
  if (ind.dist <= 1.5 && ind.gain < 12 && ind.slope >= 0) return 'STARTING';   // 刚启动
  if (ind.dist <= 3 && ind.slope < 2 && ind.gain < 15) return 'ACCUMULATION';  // 蓄势整理
  if (ind.slope >= 2 && ind.dist > 4) return 'BREAKOUT';                    // 突破上行（偏离MA7渐大）
  return 'TRENDING';                                                        // 健康上行（2<dist≤4）
}

// ── Entry Risk（追高风险）──
function calcEntryRisk(ind, stage, health) {
  if (stage === 'EXTENDED' || stage === 'DECAY' || ind.dist > 6 || health < 60) return 'HIGH';
  if (ind.dist > 4 || ind.slope > 8 || health < 75 || ind.gain > 25) return 'MED';
  return 'LOW';
}

// ── 入场分类（与 Quality 彻底分离）──
const STAGE_V31_LABEL = {
  STARTING: '🆕 STARTING', ACCUMULATION: '🧠 ACCUMULATION', TRENDING: '🟢 TRENDING',
  BREAKOUT: '🔥 BREAKOUT', RETEST: '↩️ RETEST', EXTENDED: '⚠️ EXTENDED', DECAY: '🔴 DECAY'
};
const STAGE_V31_ORDER = ['STARTING', 'ACCUMULATION', 'TRENDING', 'BREAKOUT', 'RETEST', 'EXTENDED', 'DECAY'];

function classifyEntry(q, h, stage, dist) {
  const bad = stage === 'EXTENDED' || stage === 'DECAY';
  if (bad || h < 60) return { cls: 'NO', label: '🔴 NO ENTRY', pct: '0%', note: '⛔ 不买：阶段不佳/健康度不足，Quality再高也不追' };
  if (stage === 'RETEST' && q >= 7.5 && h >= 75)
    return { cls: 'RETEST', label: '🟢 BUY ON RETEST', pct: '100%', note: '回踩确认：结构未破+缩量企稳，标准仓位' };
  if (stage === 'BREAKOUT' && q >= 8 && h >= 85 && dist <= 5)
    return { cls: 'BREAKOUT', label: '🔥 BREAKOUT ENTRY', pct: '50%', note: '突破追入：仓位减半，破位即走' };
  if ((stage === 'STARTING' || stage === 'ACCUMULATION') && q >= 8 && dist <= 3)
    return { cls: 'EARLY', label: '🟡 EARLY ENTRY', pct: '25%', note: '早期试仓：突破确认后再加' };
  return { cls: 'WAIT', label: '🟡 WAIT RETEST', pct: '0%', note: '趋势成立，等回踩至MA7再进（届时推RETEST）' };
}

// ── ATR(14) ──
function calcATR(kl, n) {
  n = n || 14;
  if (!kl || kl.length < n + 1) return null;
  const trs = [];
  for (let i = kl.length - n; i < kl.length; i++) {
    const h = kl[i].h, l = kl[i].l, pc = kl[i - 1] ? kl[i - 1].c : kl[i].o;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// ── 结构低点：最近 n 根 15m 最低价（回踩结构/早期结构用）───
function structLow(kl, n) {
  n = n || 24;
  const slice = kl.slice(-n);
  return Math.min(...slice.map(x => x.l));
}

// ── 交易计划 V3.1 ──
// ctx: {type:'RETEST'|'BREAKOUT'|'EARLY', refPrice, breakoutLevel?, kl15}
// SL 公式：回踩=回踩低点-0.4ATR / 突破=突破位-0.6ATR / 早期=结构低点-0.5ATR
// 风险边界：2.5%~10%（超10% 放弃）
function calcPlanV31(ctx) {
  const kl15 = ctx.kl15;
  if (!kl15 || kl15.length < 30) return null;
  const atr = calcATR(kl15, 14);
  if (!atr || atr <= 0) return null;
  const entry = ctx.refPrice || kl15[kl15.length - 1].c;
  let sl;
  if (ctx.type === 'RETEST') {
    const pl = ctx.pullbackLow || structLow(kl15, 24);
    sl = pl - 0.4 * atr;
  } else if (ctx.type === 'BREAKOUT') {
    const bl = ctx.breakoutLevel || structLow(kl15, 24) + atr * 2;
    sl = bl - 0.6 * atr;
  } else { // EARLY
    const sl0 = structLow(kl15, 30);
    sl = sl0 - 0.5 * atr;
  }
  const riskPct = (entry - sl) / entry * 100;
  if (riskPct < 2.5) { sl = entry * (1 - 0.025); }        // 最小风险 2.5%
  if (riskPct > 10) return { valid: false, reason: '风险>10% 放弃交易（不扩大止损）', entry, sl, riskPct };
  const r = entry - sl;
  return {
    valid: true, entry: +entry.toFixed(6), sl: +sl.toFixed(6),
    riskPct: +((entry - sl) / entry * 100).toFixed(1),
    tp1: +(entry + r).toFixed(6), tp2: +(entry + 2 * r).toFixed(6),
    r: +r.toFixed(6), atr: +atr.toFixed(6),
    // 分批：TP1 20% / TP2 30% / 50% trailing；TP1后 SL=Entry+0.1R
    ladder: [
      { at: '+1R', act: 'TP1 卖20%', sl: 'Entry+0.1R' },
      { at: '+1.5R', act: 'SL→Entry+0.7R', sl: '' },
      { at: '+2R', act: 'TP2 卖30%', sl: 'SL→Entry+1R' },
      { at: '+3R', act: 'SL→Entry+2R', sl: '' },
      { at: '+4R', act: 'SL→Entry+3R', sl: '' }
    ],
    trail: 'max(最高价-2ATR, 结构低点-0.2ATR) 取高者',
    timeStop: ctx.type === 'RETEST' ? '8~12 × 15m' : (ctx.type === 'BREAKOUT' ? '6~8 × 15m' : '12~16 × 15m')
  };
}

// ── V3.1 汇总：评分 + 阶段 + 入场分类 + 风险 ──
// kl1h: 1h klines（[{c,h,l,...}]）评分用；kl15: 15m klines 计划用（可空）
function calcENA3(kl1h, kl15, opts) {
  if (!kl1h || kl1h.length < 30) return null;
  opts = opts || {};
  const closes1h = kl1h.map(x => x.c);
  const ind = calcIndicators(closes1h);
  const quality = calcQuality(ind);
  const pullback = detectPullback(closes1h, ind.ma7);
  const stage = calcStageV31(ind, pullback);
  const health = calcHealth(ind);
  const entryScore = calcEntry(ind, pullback);
  const entryRisk = calcEntryRisk(ind, stage, health);
  const dist = ind.dist;
  const ec = classifyEntry(quality, health, stage, dist);
  const plan = (kl15 && ec.cls !== 'NO' && ec.cls !== 'WAIT')
    ? calcPlanV31(Object.assign({ kl15 }, opts.planCtx || {}))
    : null;
  return {
    quality, health, stage, stageLabel: STAGE_V31_LABEL[stage],
    entry: entryScore, pullback,
    entryRisk, entryClass: ec, dist,
    ind: { dist: ind.dist, slope: ind.slope, gain: ind.gain, mono: ind.mono, dd: ind.dd },
    plan, ts: Date.now()
  };
}

const V31 = {
  calcStageV31, calcEntryRisk, classifyEntry, calcPlanV31, calcENA3, calcATR, structLow,
  STAGE_V31_LABEL, STAGE_V31_ORDER
};
if (typeof module !== 'undefined' && module.exports) Object.assign(module.exports, V31);
if (typeof window !== 'undefined' && window.ENAScore) Object.assign(window.ENAScore, V31);

// ═══════════════════════════════════════════════════════
// V3.2 持仓生命周期（入场后管理）：趋势失效退出 + 重新入场
// 用户方案落地：5 失效信号 ≥2 WARNING / ≥3 EXIT；
// 止损后 Quality≥7.5+Health≥70+站回MA7+破局部高+量恢复 → SECOND ENTRY
// ═══════════════════════════════════════════════════════
// ctx: { kl1h, kl15, pullbackLow?, entryType? }
// 返回: { level:'OK'|'WARNING'|'EXIT', count, sig:{s1..s5}, reasons:[], ind }
function calcExitSignal(ctx) {
  if (!ctx || !ctx.kl1h || ctx.kl1h.length < 30 || !ctx.kl15 || ctx.kl15.length < 30) return null;
  const closes1h = ctx.kl1h.map(x => x.c);
  const ind = calcIndicators(closes1h);
  const health = calcHealth(ind);
  const ma7now = ind.ma7[ind.ma7.length - 1];
  const price1h = closes1h[closes1h.length - 1];
  const kl15 = ctx.kl15;
  const closes15 = kl15.map(x => x.c);
  const price15 = closes15[closes15.length - 1];
  const sig = {}, reasons = [];

  // S1: 跌破结构低点（回踩低点/15m 24根最低）
  const structLow = ctx.pullbackLow || Math.min(...kl15.slice(-24).map(x => x.l));
  sig.s1 = price15 < structLow;
  if (sig.s1) reasons.push('跌破结构低点/回踩低点');

  // S2: 1H 价格跌回 MA7 下方
  sig.s2 = price1h < ma7now;
  if (sig.s2) reasons.push('1H 跌回 MA7 下方');

  // S3: MA7 斜率转负（末5根）
  sig.s3 = ind.slope < 0;
  if (sig.s3) reasons.push('MA7 斜率转负');

  // S4: Health < 60
  sig.s4 = health < 60;
  if (sig.s4) reasons.push(`Health ${health} < 60`);

  // S5: Smart Money 流出（量价代理：近12根15m 下跌量 > 上涨量×1.3 = 卖压主导出货特征）
  let upV = 0, dnV = 0;
  for (const k of kl15.slice(-12)) { if (k.c >= k.o) upV += k.v; else dnV += k.v; }
  sig.s5 = dnV > upV * 1.3 && upV > 0;
  if (sig.s5) reasons.push(`量价出货（下跌量 ${(dnV / (upV || 1)).toFixed(1)}x 上涨量）`);

  const count = [sig.s1, sig.s2, sig.s3, sig.s4, sig.s5].filter(Boolean).length;
  return {
    level: count >= 3 ? 'EXIT' : (count >= 2 ? 'WARNING' : 'OK'),
    count, sig, reasons,
    health, price15, structLow,
    pnlPct: ctx.entryPrice ? (price15 / ctx.entryPrice - 1) * 100 : null,
    ind: { dist: ind.dist, slope: ind.slope }
  };
}

// 重新入场判定（止损/退出后）：ctx = { kl1h, kl15 }
// 返回: { level:'SECOND ENTRY'|'RE-ENTRY WATCH'|'NO', quality, health, aboveMA7, broke, volBack }
function calcReentry(ctx) {
  if (!ctx || !ctx.kl1h || ctx.kl1h.length < 30 || !ctx.kl15 || ctx.kl15.length < 30) return null;
  const closes1h = ctx.kl1h.map(x => x.c);
  const ind = calcIndicators(closes1h);
  const quality = calcQuality(ind);
  const health = calcHealth(ind);
  const ma7now = ind.ma7[ind.ma7.length - 1];
  const kl15 = ctx.kl15;
  const closes15 = kl15.map(x => x.c);
  const price = closes15[closes15.length - 1];
  const aboveMA7 = price > ma7now;
  const localHigh = Math.max(...closes15.slice(-25, -1));
  const broke = price > localHigh;
  const vols = kl15.map(x => x.v);
  const vNow = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const vPrev = vols.slice(-8, -3).reduce((a, b) => a + b, 0) / 5;
  const volBack = vPrev > 0 && vNow / vPrev >= 1.2;   // Volume 恢复 ≥1.2x
  const base = quality >= 7.5 && health >= 70;
  let level = 'NO';
  if (base && aboveMA7 && broke && volBack) level = 'SECOND ENTRY';
  else if (base && (aboveMA7 || broke)) level = 'RE-ENTRY WATCH';
  return { level, quality, health, aboveMA7, broke, volBack, price, ma7now };
}

if (typeof module !== 'undefined' && module.exports) Object.assign(module.exports, { calcExitSignal, calcReentry });
if (typeof window !== 'undefined' && window.ENAScore) Object.assign(window.ENAScore, { calcExitSignal, calcReentry });
