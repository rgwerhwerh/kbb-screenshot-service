const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const app = express();
app.use(express.json({ limit: '10mb' }));

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

let browser;
async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });
  }
  return browser;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/screenshot', async (req, res) => {
  const { html, width = 1080, height = 1350, delay = 1500, format } = req.body;
  if (!html) return res.status(400).json({ error: 'html required' });
  let page;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    const buf = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: false });
    await page.close();
    if (format === 'base64') {
      return res.json({ image: buf.toString('base64'), size: buf.length });
    }
    res.set('Content-Type', 'image/jpeg');
    res.send(buf);
  } catch (err) {
    if (page) await page.close().catch(() => {});
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    console.error('Screenshot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Screenshot service on port ' + PORT));
