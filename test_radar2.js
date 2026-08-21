// 验证详情视图
const puppeteer = require('/root/.openclaw/workspace/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/root/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
    headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file:///tmp/crypto-signals/ena_radar.html', {waitUntil:'networkidle2', timeout:90000});
  await new Promise(r => setTimeout(r, 25000));
  // 点击第一行
  await page.evaluate(() => document.querySelector('#tbody tr').click());
  await new Promise(r => setTimeout(r, 8000));
  const detail = await page.evaluate(() => {
    const d = document.getElementById('detail');
    return d.style.display === 'block' ? d.innerText.slice(0, 500) : '未显示';
  });
  console.log('=== 详情视图 ===');
  console.log(detail);
  console.log('\n错误:', errors.length ? errors : '无');
  // 截图
  await page.screenshot({path: '/tmp/ena_radar_shot.png', fullPage: false});
  console.log('截图已保存 /tmp/ena_radar_shot.png');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
