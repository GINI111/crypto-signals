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
