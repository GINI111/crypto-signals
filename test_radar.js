// 用 puppeteer 渲染 ENA 雷达页面，检查错误和表格渲染
const puppeteer = require('/root/.openclaw/workspace/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('file:///tmp/crypto-signals/ena_radar.html', {waitUntil:'networkidle2', timeout:90000});
  // 等扫描完成
  await new Promise(r => setTimeout(r, 30000));
  const rows = await page.evaluate(() => document.querySelectorAll('#tbody tr').length);
  const status = await page.evaluate(() => document.getElementById('status').textContent);
  const firstRow = await page.evaluate(() => {
    const tr = document.querySelector('#tbody tr');
    return tr ? tr.innerText : '无';
  });
  console.log('表格行数:', rows);
  console.log('状态:', status);
  console.log('第一行:', firstRow.replace(/\n/g, ' | '));
  console.log('错误:', errors.length ? errors.slice(0,5) : '无');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
