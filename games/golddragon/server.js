'use strict';
// Host server: serves the browser game to every device on the home Wi-Fi and keeps the one true game state.
// No packages to install: only Node.js built-ins.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const G = require('./game');

const PORT = Number(process.env.PORT) || 8080;
const SAVE = process.env.SAVE_FILE || path.join(__dirname, 'save.json');
const PUBLIC = path.join(__dirname, 'public');
const AUTO_DELAY = Number(process.env.AUTO_DELAY ?? 900); // ms between monster turns so everyone can follow
const rng = Math.random;

let state = G.newGame();
try {
  state = JSON.parse(fs.readFileSync(SAVE, 'utf8'));
  console.log('💾 저장된 모험을 불러왔어요.');
} catch {
  /* first run */
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(SAVE + '.tmp', JSON.stringify(state), (err) => {
      if (!err) fs.rename(SAVE + '.tmp', SAVE, () => {});
    });
  }, 300);
}

const clients = new Set(); // { res, pid }
function broadcast() {
  for (const c of clients) c.res.write(`data: ${JSON.stringify(view(c.pid))}\n\n`);
  save();
}
function view(pid) {
  const v = G.view(state, pid);
  const online = new Set([...clients].map((c) => c.pid));
  v.heroes.forEach((h) => { h.online = state.heroes.some((s) => s.id === h.id && online.has(s.owner)); });
  v.viewers = clients.size;
  return v;
}

let autoTimer = null;
function pump() {
  if (autoTimer || !G.needsAuto(state)) return;
  autoTimer = setTimeout(() => {
    autoTimer = null;
    G.autoStep(state, rng);
    broadcast();
    pump();
  }, AUTO_DELAY);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    const pid = url.searchParams.get('pid') || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const c = { res, pid };
    clients.add(c);
    req.on('close', () => { clients.delete(c); broadcast(); });
    broadcast();
    return;
  }
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let a;
      try { a = JSON.parse(body); } catch { a = {}; }
      if (G.needsAuto(state) && a.type !== 'restart') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '몬스터 차례예요. 잠시만 기다려 주세요.' }));
        return;
      }
      let error;
      try { error = G.act(state, rng, String(a.pid || ''), a); } catch (e) { console.error(e); error = '문제가 생겼어요: ' + e.message; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
      broadcast();
      pump();
    });
    return;
  }
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 20000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n🐉 황금 용의 던전 서버가 켜졌어요!\n');
  console.log(`   이 PC에서:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   다른 PC·핸드폰:   http://${ip}:${PORT}`);
  console.log('\n   같은 와이파이에 연결된 기기의 브라우저 주소창에 위 주소를 입력하세요.');
  console.log('   이 창을 닫으면 게임이 꺼져요 (진행 상황은 자동 저장돼요).\n');
  pump();
  if (process.argv.includes('--open') && process.platform === 'win32') require('child_process').exec(`start "" "http://localhost:${PORT}"`);
});
