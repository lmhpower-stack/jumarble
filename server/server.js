// 직접 운영하는 서버: 정적 파일 + WebSocket 방 중계
//   node server/server.js  → http://localhost:8080
// 게임 규칙은 진행폰이 판단하고, 서버는 메시지만 전달한다
//   진행폰 메시지 → 같은 방 참가자 전원 (마지막 state 는 저장해 두었다가 새로 들어온 사람에게 전송)
//   참가자 메시지 → 같은 방 진행폰
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8080);
const MAX_MSG = 256 * 1024;
const ROOM_RE = /^[A-Z0-9]{3,8}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
const BLOCKED = ['server', 'node_modules', 'tools', '.git'];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    const top = path.relative(ROOT, file).split(path.sep)[0];
    if (!file.startsWith(ROOT + path.sep) || BLOCKED.includes(top)) { res.writeHead(404); return res.end('not found'); }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const rooms = new Map(); // code → { host, players:Set, last, timer }
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });

function roomOf(code) {
  let r = rooms.get(code);
  if (!r) { r = { host: null, players: new Set(), last: null, timer: null }; rooms.set(code, r); }
  clearTimeout(r.timer);
  return r;
}
function maybeCleanup(code, r) {
  if (r.host || r.players.size) return;
  r.timer = setTimeout(() => rooms.delete(code), 6 * 60 * 60 * 1000); // 아무도 없으면 6시간 뒤 삭제
}

wss.on('error', (e) => console.error('ws 오류:', e.message));
process.on('uncaughtException', (e) => console.error('예상 못 한 오류(서버는 계속 돌아가요):', e.message));
const MAX_ROOMS = 200;
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const code = (q.get('room') || '').toUpperCase();
  const role = q.get('role') === 'host' ? 'host' : 'player';
  if (!ROOM_RE.test(code)) return ws.close(4001, 'bad room');
  if (!rooms.has(code) && rooms.size >= MAX_ROOMS) return ws.close(4002, 'too many rooms');
  const r = roomOf(code);
  ws.isAlive = true;
  // 잘못된·너무 큰 메시지가 와도 서버 전체가 죽지 않게 그 연결만 끊어요
  ws.on('error', () => { try { ws.terminate(); } catch { /* 무시 */ } });
  ws.on('pong', () => (ws.isAlive = true));

  if (role === 'host') {
    if (r.host && r.host !== ws) r.host.close(4000, 'replaced');
    r.host = ws;
  } else {
    r.players.add(ws);
    if (r.last) ws.send(r.last);
  }

  ws.on('message', (data) => {
    const txt = data.toString();
    if (ws === r.host) {
      let m;
      try { m = JSON.parse(txt); } catch { return; }
      if (m.t === 'state') r.last = txt;
      for (const p of r.players) if (p.readyState === 1) p.send(txt);
    } else if (r.host && r.host.readyState === 1) {
      r.host.send(txt);
    }
  });

  ws.on('close', () => {
    if (r.host === ws) r.host = null;
    r.players.delete(ws);
    maybeCleanup(code, r);
  });
});

// 끊긴 연결 정리
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(PORT, () => console.log(`주류마블 서버: http://localhost:${PORT}  (같은 와이파이의 폰은 http://<이 PC IP>:${PORT})`));
