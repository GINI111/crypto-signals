// 用真实数据验证 ENA 打分
const { calcENA } = require('/tmp/crypto-signals/ena_score.js');

async function getKlines(symbol, interval = '1h', limit = 40) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  const j = await r.json();
  return j.map(k => +k[4]);  // close
}

async function main() {
  const coins = ['STX', 'NEIRO', 'FET', 'ADA', 'CRV', 'BTC', 'ETH', 'XRP', 'ONT', 'GALA', 'WIF', 'NEO'];
  console.log('币种        ENA分  等级      距MA7    20根涨幅  单调性   末5斜率  峰值回撤');
  console.log('-'.repeat(90));
  for (const c of coins) {
    try {
      const closes = await getKlines(c);
      const r = calcENA(closes);
      if (!r) { console.log(c, '数据不足'); continue; }
      const p = r.parts;
      console.log(
        c.padEnd(10),
        r.total.toFixed(1).padEnd(5),
        r.level.padEnd(10),
        `${p.distMA7.score}/${p.distMA7.dist.toFixed(1)}%`.padEnd(10),
        `${p.gain20.score}/${p.gain20.gain.toFixed(1)}%`.padEnd(12),
        `${p.mono.score}/${p.mono.ratio.toFixed(0)}%`.padEnd(10),
        `${p.slope5.score}/${p.slope5.slope.toFixed(1)}%`.padEnd(10),
        `${p.dd.score}/${p.dd.dd.toFixed(1)}%`
      );
    } catch (e) { console.log(c, '错误', e.message); }
    await new Promise(r => setTimeout(r, 200));
  }
}
main();
