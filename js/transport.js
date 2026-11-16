// 통신 계층: 이것만 바꾸면 배포 방식이 바뀐다
//
// 메시지 규약
//   진행폰 → 참가자: { t:'state', state }            (게임 상태 전체, 비밀 정답 제외)
//   참가자 → 진행폰: { t:'hello', pid }               (접속, 최신 상태 요청)
//                   { t:'join', pid, name, teamId }   (참가/팀 변경)
//                   { t:'input', pid, value }         (미션 버튼)
//                   { t:'decide', pid, itemId, mode, target }  (벌주: drink | shield | reflect)
//                   { t:'roll', pid }                 (우리 팀 차례에 주사위)
//                   { t:'leave', pid }
//
// createTransport({ kind, room, role, url, firebase }) → { kind, send(msg), on(fn), onStatus(fn), close() }
//   kind: 'local'    같은 기기의 탭끼리 (BroadcastChannel) — 개발/테스트용
//         'ws'       직접 운영하는 서버 (server/server.js)
//         'firebase' GitHub Pages 같은 정적 호스팅 + Firebase Realtime Database
//         'none'     통신 없이 진행폰 혼자 (한 폰 모드)

function emitter() {
  const fns = new Set();
  return {
    on(f) { fns.add(f); return () => fns.delete(f); },
    emit(v) { for (const f of fns) { try { f(v); } catch (e) { console.error(e); } } }
  };
}

export async function createTransport(opts) {
  const kind = opts.kind || 'local';
  if (kind === 'none') return noneTransport();
  if (kind === 'local') return localTransport(opts);
  if (kind === 'ws') return wsTransport(opts);
  if (kind === 'firebase') return firebaseTransport(opts);
  throw new Error('알 수 없는 통신 방식: ' + kind);
}

function noneTransport() {
  const ev = emitter(), st = emitter();
  setTimeout(() => st.emit('solo'), 0);
  return { kind: 'none', send() {}, on: ev.on, onStatus: st.on, close() {} };
}

function localTransport({ room, role }) {
  const ch = new BroadcastChannel('jumarble:' + room);
  const ev = emitter(), st = emitter();
  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === role) return;
    ev.emit(m.msg);
  };
  setTimeout(() => st.emit('online'), 0);
  return {
    kind: 'local',
    send(msg) { ch.postMessage({ from: role, msg }); },
    on: ev.on, onStatus: st.on,
    close() { ch.close(); }
  };
}

function wsTransport({ room, role, url }) {
  const ev = emitter(), st = emitter();
  const base = url || (typeof location !== 'undefined' ? location.origin.replace(/^http/, 'ws') + '/ws' : '');
  let ws, closed = false, retry = 500;
  const queue = [];
  function open() {
    ws = new WebSocket(`${base}?room=${encodeURIComponent(room)}&role=${role}`);
    ws.onopen = () => {
      retry = 500;
      st.emit('online');
      while (queue.length) ws.send(queue.shift());
    };
    ws.onmessage = (e) => { try { ev.emit(JSON.parse(e.data)); } catch { /* 무시 */ } };
    ws.onclose = (e) => {
      // 4000 = 다른 게임판이 이 방을 가져감 → 서로 쫓아내기를 반복하지 않게 다시 연결하지 않아요
      if (e && e.code === 4000) { closed = true; st.emit('replaced'); return; }
      st.emit('offline');
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 8000)));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* 무시 */ } };
  }
  open();
  return {
    kind: 'ws',
    send(msg) {
      const d = JSON.stringify(msg);
      if (ws && ws.readyState === 1) ws.send(d);
      else if (msg.t !== 'cmd') { queue.push(d); if (queue.length > 50) queue.shift(); } // 끊긴 동안 누른 버튼은 나중에 한꺼번에 보내지 않아요
    },
    on: ev.on, onStatus: st.on,
    close() { closed = true; try { ws.close(); } catch { /* 무시 */ } }
  };
}

// Firebase Realtime Database
//   rooms/{room}/state  : 진행폰이 덮어쓰는 최신 상태 (JSON 문자열)
//   rooms/{room}/inbox  : 참가자가 push 하는 입력, 진행폰이 읽고 지움
// RTDB는 빈 객체/배열을 저장하지 않아서 메시지를 JSON 문자열로 감싼다
const FIREBASE_VERSION = '10.12.2';
async function firebaseTransport({ room, role, firebase }) {
  if (!firebase || !firebase.databaseURL) throw new Error('config.js 에 Firebase 설정(databaseURL)이 없어요');
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp, getApps } = await import(`${base}/firebase-app.js`);
  const fdb = await import(`${base}/firebase-database.js`);
  const app = getApps()[0] || initializeApp(firebase);
  const db = fdb.getDatabase(app);
  const path = `rooms/${room}`;
  const ev = emitter(), st = emitter();
  const offs = [];
  offs.push(fdb.onValue(fdb.ref(db, '.info/connected'), (snap) => st.emit(snap.val() ? 'online' : 'offline')));
  if (role === 'host') {
    offs.push(fdb.onChildAdded(fdb.ref(db, `${path}/inbox`), (snap) => {
      const v = snap.val();
      fdb.remove(snap.ref);
      try { ev.emit(JSON.parse(v.json)); } catch { /* 무시 */ }
    }));
    return {
      kind: 'firebase',
      send(msg) {
        if (msg.t === 'state') fdb.set(fdb.ref(db, `${path}/state`), { json: JSON.stringify(msg), at: fdb.serverTimestamp() });
      },
      on: ev.on, onStatus: st.on,
      close() { offs.forEach((f) => f()); }
    };
  }
  offs.push(fdb.onValue(fdb.ref(db, `${path}/state`), (snap) => {
    const v = snap.val();
    if (v && v.json) { try { ev.emit(JSON.parse(v.json)); } catch { /* 무시 */ } }
  }));
  return {
    kind: 'firebase',
    send(msg) { fdb.push(fdb.ref(db, `${path}/inbox`), { json: JSON.stringify(msg), at: fdb.serverTimestamp() }); },
    on: ev.on, onStatus: st.on,
    close() { offs.forEach((f) => f()); }
  };
}
