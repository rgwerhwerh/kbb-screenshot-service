const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const https = require('https');
const http = require('http');
const { URL } = require('url');
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

function uploadToWP(buf, wpBase, wpAuth, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----WPUpload' + Date.now();
    const CRLF = '
';
    const header = Buffer.from(
      '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + CRLF +
      'Content-Type: image/jpeg' + CRLF + CRLF
    );
    const footer = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);
    const body = Buffer.concat([header, buf, footer]);
    const parsed = new URL(wpBase + '/wp-json/wp/v2/media');
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Authorization': wpAuth,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.source_url) resolve(json.source_url);
          else reject(new Error('WP upload failed: ' + data.slice(0, 200)));
        } catch(e) { reject(new Error('WP parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/screenshot', async (req, res) => {
  const { html, width = 1080, height = 1350, delay = 1500, format, wpBase, wpAuth, filename } = req.body;
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
    // If WP credentials provided, upload directly and return URL
    if (wpBase && wpAuth && filename) {
      const url = await uploadToWP(buf, wpBase, wpAuth, filename);
      return res.json({ source_url: url, size: buf.length });
    }
    // Return base64 JSON (safe for n8n)
    if (format === 'base64') {
      return res.json({ image: buf.toString('base64'), size: buf.length });
    }
    res.set('Content-Type', 'image/jpeg');
    res.send(buf);
  } catch (err) {
    if (page) await page.close().catch(() => {});
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Screenshot service on port ' + PORT));
