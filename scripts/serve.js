// Tiny zero-dependency static file server for local dev / playtesting.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8321;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  // Dev helper: POST a base64 data-URL to /shot to save a canvas capture to disk.
  if (req.method === 'POST' && req.url === '/shot') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(ROOT, 'scripts', 'shot.png'), Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
