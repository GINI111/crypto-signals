// ENA Trend Score 核心计算模块
// 5 指标: 距MA7 / MA7 20根涨幅 / MA7单调性 / 末5根斜率 / 峰值回撤 → 0~12分
// 数据: 1H klines (需要 ~30 根)

// ── 指标1: 距 MA7 距离 (0~3分) ──
function scoreDistMA7(price, ma7) {
  const dist = (price - ma7) / ma7 * 100;   // +% 表示在 MA7 上方
  let score;
  if (price < ma7) score = 0;
  else if (dist <= 1) score = 1;
  else if (dist <= 4) score = 3;
  else if (dist <= 6) score = 2;
  else if (dist <= 8) score = 1;
  else score = 0;
  return { score, dist };
}

// ── 指标2: MA7 最近 20 根累计涨幅 (0~3分) ──
function scoreMA7Gain(ma7) {
  // ma7: 数组，取倒数第21根到倒数第1根（20根区间）
  const n = ma7.length;
  const start = ma7[n - 21], end = ma7[n - 1];
  const gain = (end - start) / start * 100;
  let score;
  if (gain < 5) score = 0;
  else if (gain < 10) score = 1;
  else if (gain < 20) score = 2;
  else if (gain <= 35) score = 3;
  else score = 2;   // >35% 降分（可能趋势末端）
  return { score, gain };
}

// ── 指标3: MA7 单调性 (0~2分) ──
function scoreMonotonic(ma7) {
  // 最近 20 根中，环比上涨的比例
  const n = ma7.length;
  const seg = ma7.slice(n - 21);   // 20 段
  let up = 0;
  for (let i = 1; i < seg.length; i++) if (seg[i] > seg[i-1]) up++;
  const ratio = up / (seg.length - 1) * 100;
  let score;
  if (ratio >= 95) score = 2;
  else if (ratio >= 85) score = 1.5;
  else if (ratio >= 75) score = 1;
  else score = 0;
  return { score, ratio };
}

// ── 指标4: 最近 5 根斜率 (0~2分) ──
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

// ── 指标5: 从峰值回撤 (0~2分) ──
function scoreDrawdown(closes) {
  // 最近 20 根收盘价 vs 期间峰值
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

// ── 汇总: ENA Score 0~12 ──
function calcENA(closes) {
  if (!closes || closes.length < 30) return null;
  // MA7
  const ma7 = [];
  for (let i = 6; i < closes.length; i++) {
    let s = 0;
    for (let j = i - 6; j <= i; j++) s += closes[j];
    ma7.push(s / 7);
  }
  const price = closes[closes.length - 1];
  const curMA7 = ma7[ma7.length - 1];

  const d1 = scoreDistMA7(price, curMA7);
  const d2 = scoreMA7Gain(ma7);
  const d3 = scoreMonotonic(ma7);
  const d4 = scoreSlope5(ma7);
  const d5 = scoreDrawdown(closes);

  const total = d1.score + d2.score + d3.score + d4.score + d5.score;

  // 等级
  let level = '⚪️ 普通';
  if (total >= 10.5) level = '🔥 S级趋势';
  else if (total >= 8.5) level = '🟡 A级趋势';

  return {
    total,
    level,
    parts: {
      distMA7: d1, gain20: d2, mono: d3, slope5: d4, dd: d5
    }
  };
}

// 供 Node 测试导出
if (typeof module !== 'undefined') module.exports = { calcENA, scoreDistMA7, scoreMA7Gain, scoreMonotonic, scoreSlope5, scoreDrawdown };
