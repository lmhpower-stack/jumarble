// 게임판(노트북·TV)에서 돌아가는 연결 모듈
//   게임 진행은 게임판의 주류마블 앱이 그대로 한다.
//   이 모듈은 ① 지금 화면 상태를 폰들에 보내고 ② 폰에서 누른 버튼을 게임판에서 대신 눌러 준다.
// 메시지
//   게임판 → 폰 : { t:'state', ... }   (화면 요약: 차례, 팀 현황, 지금 카드, 누를 수 있는 버튼)
//   폰 → 게임판 : { t:'hello' }  /  { t:'cmd', op, rid?, value?, cell?, e?, w? }
import { createTransport } from './transport.js';
import { transportKind, WS_URL, FIREBASE } from './config.js';

const $ = (id) => document.getElementById(id);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let tp = null, room = null, ridN = 0, lastJson = '', timer = 0, seq = 0, firstWait = 0;
// 앱이 미션 타이머를 감싸 두었으므로, 통신은 원래 타이머를 써요 (카드가 닫혀도 화면 전송이 멈추지 않게)
const NT = window.__native || { setTimeout: window.setTimeout.bind(window), setInterval: window.setInterval.bind(window), clearTimeout: window.clearTimeout.bind(window) };
// 버튼 번호: 게임판을 새로 열 때마다 바뀌는 접두사(BOOT)를 붙여, 예전 화면에서 누른 버튼이 엉뚱한 버튼을 누르지 않게
const BOOT = Math.random().toString(36).slice(2, 6);
const rid = (el) => el.dataset.rid || (el.dataset.rid = BOOT + '-' + (++ridN));
// 카드마다 같이 쓰는 버튼(확인·미션·타이머·다른 조건)은 카드 번호(MSEQ)를 붙여서, 지난 카드의 '확인'이 다음 카드를 닫지 않게
const SHARED = { ok: 'mOk', act: 'mAct', timer: 'mTimer', reroll: 'mReroll' };
const srid = (k) => `${BOOT}-${k}-${typeof MSEQ !== 'undefined' ? MSEQ : 0}`;
// 진행폰은 한 대만: 처음 들어온 진행폰을 기억해요 (게임판 새로고침에도 유지)
let hostPid = null;
const throttle = {};
const hostKey = () => 'jumarble-host-' + room;
const tag = (pid) => { let h = 7; for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pid ? h.toString(36) : ''; };
const shown = (el) => el && !el.hidden && el.offsetParent !== null;

// 버튼이 누구 것인지: 가장 가까운 data-teams (팀 번호 목록 또는 'host'), 없으면 이 카드의 기본 참가 팀
function teamsOf(el, def) {
  const z = el.closest('[data-teams]');
  return z ? String(z.dataset.teams) : def;
}

// 미션 상자(mBox) 안을 폰에서 그릴 수 있는 블록 목록으로
function blocks(root, def) {
  const out = [];
  const walk = (node) => {
    for (const el of node.children) {
      if (!shown(el)) continue;
      if (el.tagName === 'BUTTON') {
        out.push({ k: 'btn', rid: rid(el), label: el.innerText.trim(), dis: el.disabled, cls: el.className, teams: teamsOf(el, def) });
      } else if (el.tagName === 'INPUT') {
        out.push({ k: 'in', rid: rid(el), ph: el.placeholder || '', teams: teamsOf(el, def), dis: el.disabled });
      } else if (el.classList.contains('wheel')) {
        out.push({ k: 'txt', cls: 'dice', text: el.classList.contains('done') ? '🎡 룰렛 멈췄어요! (게임판을 봐 주세요)' : '🎡 룰렛 (게임판에서 돌아가요)' });
      } else if (el instanceof SVGElement) {
        continue;
      } else if (el.classList.contains('mdice') || el.classList.contains('duel') && !el.querySelector('button')) {
        out.push({ k: 'txt', cls: 'dice', text: '🎲 (게임판을 봐 주세요)' });
      } else if (el.classList.contains('numgrid')) {
        out.push({ k: 'grid', teams: teamsOf(el, def), cls: el.className, btns: [...el.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.innerText.trim(), dis: b.disabled })) });
      } else if (el.children.length === 0 || ['cap', 'res', 'big-num', 'cd', 'oxq', 'react-st', 'react-score'].some((c) => el.classList.contains(c))) {
        const tx = el.innerText.trim();
        if (tx) out.push({ k: 'txt', cls: el.className, text: tx });
      } else walk(el);
    }
  };
  walk(root);
  return out;
}

function defTeams() {
  const modalOn = $('modal').classList.contains('on');
  if (modalOn && typeof recSel !== 'undefined' && recSel && recSel.only) return recSel.only.join(',');
  return String(S.cur);
}
function snapshot() {
  const modalOn = $('modal').classList.contains('on');
  const pickOn = $('pick').classList.contains('on');
  const taxiOn = $('taxibar').classList.contains('on');
  const overOn = shown($('over')) && S.phase === 'over';
  const spinOn = $('spin') && $('spin').classList.contains('on');
  let def = String(S.cur);
  if (modalOn && typeof recSel !== 'undefined' && recSel && recSel.only) def = recSel.only.join(',');
  const box = $('mBox');
  return {
    t: 'state', seq: ++seq, room, host: tag(hostPid), mseq: typeof MSEQ !== 'undefined' ? MSEQ : 0,
    phase: S.phase, juru: JURU(), solo: SOLO(), cur: S.cur, goal: S.goal || 3, cap: S.cap || 0,
    sub: $('subT') ? $('subT').textContent : '', log: $('log').textContent, cast: $('cast') ? $('cast').textContent : '', final: !!S.final,
    // 게임 시작 전에도 설정 중인 팀 목록을 보내서 미리 팀을 고를 수 있게
    teams: S.phase === 'setup' ? (SOLO() ? (S.solo || []) : (S.setup || [])).map((t, i) => ({ i, name: (t.name || '').trim() || (SOLO() ? `${i + 1}번` : `${'ABCDEF'[i]}팀`), color: COLORS[i % COLORS.length], mem: SOLO() ? '' : (t.mem || ''), drinks: 0, laps: 0, pos: 0, pass: 0, streak: 0 }))
      : (S.teams || []).map((t, i) => ({ i, name: t.name, color: t.color, mem: (t.members || []).join(' '), next: SOLO() ? '' : (typeof rotWho === 'function' ? rotWho(t) || '' : ''), drinks: t.drinks || 0, fire: typeof fireLv === 'function' ? fireLv(t) : 0, laps: t.laps || 0, pos: t.pos || 0,
      pass: t.pass || 0, streak: t.streak || 0, fin: !!t.fin, island: S.phase === 'play' ? onIsland(t) : false, lost: S.phase === 'play' ? lostT(t) : false })),
    roll: S.phase === 'play' && !busy && !$('rollBtn').disabled && !modalOn && !pickOn && !taxiOn,
    spin: spinOn ? $('spinLbl').textContent + ' ' + $('spinName').textContent : '',
    modal: modalOn ? {
      who: $('mWho').textContent, e: $('mEm').textContent, t: $('mT').textContent, d: $('mD').textContent,
      x: shown($('mX')) ? $('mX').textContent : '', q: shown($('mQ')) ? $('mQ').textContent : '',
      def, box: shown(box) ? blocks(box, def) : [],
      sw: box.dataset.sw || '', react: box.dataset.react || '',
      act: shown($('mAct')) ? { rid: srid('act'), label: $('mAct').textContent, dis: $('mAct').disabled } : null,
      reroll: shown($('mReroll')) ? srid('reroll') : null,
      timer: shown($('mTimer')) ? { rid: srid('timer'), label: $('mTimer').textContent } : null,
      rec: shown($('mRec')) ? { label: $('mRec').querySelector('span') ? $('mRec').querySelector('span').textContent : '',
        rows: [...$('mRecB').querySelectorAll('.recrow')].map((r) => ({ name: (r.querySelector('.rn') || r).textContent, off: r.classList.contains('off'), color: r.style.getPropertyValue('--c'),
          btns: [...r.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })) })),
        tgt: [...$('mRecT').querySelectorAll('.tgt')].map((r) => ({ label: (r.querySelector('span') || r).textContent, btns: [...r.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })) })) } : null,
      ok: { rid: srid('ok'), label: $('mOk').textContent, pending: $('mOk').classList.contains('pendingOk') }
    } : null,
    pick: pickOn ? { title: $('pickT').textContent, opts: [...$('pickOpts').querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.innerText.replace(/\n+/g, ' '), dis: b.disabled })) } : null,
    taxi: taxiOn ? { cells: [...document.querySelectorAll('.cell.taxiok')].map((c) => ({ i: +c.id.slice(1), label: (c.querySelector('.t') || c).textContent.trim() })) } : null,
    over: overOn ? { title: $('ovT').textContent, msg: $('ovMsg') ? $('ovMsg').textContent : '', rows: [...$('rank').children].map((r) => r.innerText.replace(/\n+/g, ' · ')) } : null
  };
}

function publish(force) {
  if (!tp) return;
  const snap = snapshot();
  const key = JSON.stringify({ ...snap, seq: 0 });
  if (!force && key === lastJson) return;
  lastJson = key;
  tp.send(snap);
}
// 화면이 계속 바뀌어도(스톱워치 등) 0.5초 안에는 꼭 한 번 보내요
function schedule() {
  const now = Date.now(); if (!firstWait) firstWait = now;
  NT.clearTimeout(timer);
  if (now - firstWait > 500) { firstWait = 0; publish(false); return; }
  timer = NT.setTimeout(() => { firstWait = 0; publish(false); }, 120);
}

// 폰에서 온 명령: 보낸 폰이 그 버튼을 누를 자격이 있는지 확인하고 대신 눌러 줘요
function run(c) {
  const isHost = c.from === 'host' && c.pid && c.pid === hostPid;
  const team = c.from === 'player' && c.team != null ? String(c.team) : null;
  const turn = () => team != null && String(S.cur) === team;
  const owns = (el) => {
    if (isHost) return true;
    if (team == null) return false;
    if (el.closest('#pickOpts')) return turn();
    if (!el.closest('#mBox')) return false; // 기록·확인·타이머 같은 진행 버튼은 진행폰만
    const o = teamsOf(el, defTeams());
    return o !== 'host' && o.split(',').includes(team);
  };
  const byRid = (r) => {
    const m = /^([a-z0-9]+)-(ok|act|timer|reroll)-(\d+)$/.exec(r || '');
    if (m) return m[1] === BOOT && +m[3] === (typeof MSEQ !== 'undefined' ? MSEQ : 0) ? $(SHARED[m[2]]) : null;
    return r ? document.querySelector(`[data-rid="${r}"]`) : null;
  };
  switch (c.op) {
    case 'click': case 'pick': { const el = byRid(c.rid); if (el && !el.disabled && shown(el) && owns(el)) el.click(); break; } // 닫힌 카드·남의 버튼은 무시
    case 'fill': {
      const el = byRid(c.rid);
      if (el && !el.disabled && shown(el) && owns(el)) { el.value = String(c.value || '').slice(0, 40); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      break;
    }
    case 'roll': if ((isHost || turn()) && !$('rollBtn').disabled && !busy && !$('modal').classList.contains('on')) $('rollBtn').click(); break;
    case 'taxi': { if (!(isHost || turn())) break; const el = $('c' + c.cell); if (el && el.classList.contains('taxiok')) el.click(); break; }
    case 'sw': { if (!(isHost || (team != null && defTeams().split(',').includes(team)))) break; const b = $('mBox'); if (b.__sw) b.__sw(+c.e); break; }
    case 'react': { if (!isHost) break; const b = $('mBox'); if (b.__react) b.__react(c.w === 1 ? 1 : 0); break; }
    case 'mute': if (isHost) $('muteBtn').click(); break;
    // 📣 익명 응원 (폰마다 0.7초에 한 번까지)
    case 'cheer': { const k = 'c' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 700) break; throttle[k] = now; if (typeof cheer === 'function') cheer(String(c.e || '')); return; }
    // 🧠 혼자 푸는 위스키 상식: 맞힌 개수만 팀에 쌓여요 (게임 승패와는 상관없음, 폰마다 8초에 한 번까지)
    case 'quiz': { if (team == null || S.phase !== 'play' || !c.ok) break; const k = 'q' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 8000) break; throttle[k] = now;
      const t = S.teams[+team]; if (t) { t.qz = (t.qz || 0) + 1; save(); } return; }
  }
  schedule();
}
function hello(m) {
  // 진행폰 자리가 비어 있으면 처음 인사한 진행폰이 차지해요
  if (m.from === 'host' && m.pid && !hostPid) { hostPid = m.pid; try { localStorage.setItem(hostKey(), hostPid); } catch (e) { /* 무시 */ } }
  publish(true);
}
function resetHost() { hostPid = null; try { localStorage.removeItem(hostKey()); } catch (e) { /* 무시 */ } publish(true); }

async function connect(code) {
  room = code;
  try { hostPid = localStorage.getItem(hostKey()); } catch (e) { hostPid = null; }
  const kind = transportKind() === 'none' ? 'local' : transportKind();
  tp = await createTransport({ kind, room, role: 'host', url: WS_URL, firebase: FIREBASE });
  tp.on((m) => { if (!m) return; if (m.t === 'hello') hello(m); else if (m.t === 'cmd') { if (m.from === 'host' && m.pid && !hostPid) hello(m); run(m); } });
  tp.onStatus((st) => { const d = $('netDot'); if (d) d.dataset.st = st; if (st === 'online') publish(true);
    if (st === 'replaced' && typeof toast === 'function') toast('📡 다른 게임판이 이 방을 가져갔어요. 이 화면은 연결을 끊었어요'); });
  document.body.classList.add('netOn');
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'hidden', 'aria-pressed'] });
  if (kind !== 'firebase') NT.setInterval(() => publish(true), 5000); // 늦게 들어온 폰을 위해 가끔 전체 다시 보내기 (Firebase는 상태를 저장해 두므로 필요 없음)
  publish(true);
  showQR(); miniQR();
}

function remoteURL(as) {
  const u = new URL('remote.html', location.href);
  u.searchParams.set('room', room);
  if (as) u.searchParams.set('as', as);
  const t = new URLSearchParams(location.search).get('t');
  if (t) u.searchParams.set('t', t);
  return u.href;
}

function qrSVG(url, px) {
  if (!window.qrcode) return null;
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount() + 4; return qr.createSvgTag({ cellSize: Math.max(2, Math.floor(px / n)), margin: 2 });
}
function showQR() {
  let o = $('netPanel');
  if (!o) {
    o = document.createElement('div');
    o.id = 'netPanel';
    o.innerHTML = `<div class="np-box"><button class="np-x" aria-label="닫기">×</button>
      <h2>📱 폰으로 참가하기</h2><p>카메라로 QR을 찍고 우리 팀을 고르면 끝!</p>
      <div id="netQR"></div><div class="np-code"></div><a class="np-url" target="_blank" rel="noopener"></a>
      <details class="np-host"><summary>🎮 진행자 폰 연결 (진행자만)</summary><div id="netQRh"></div><p class="np-help">진행폰은 한 대만 들어올 수 있어요. 처음 들어온 폰이 진행폰이 돼요.</p>
        <button class="ghost" id="npReset">🔁 진행폰 바꾸기</button> <span id="npHost"></span></details></div>`;
    document.body.appendChild(o);
    o.querySelector('.np-x').onclick = () => o.classList.remove('on');
    o.onclick = (e) => { if (e.target === o) o.classList.remove('on'); };
    o.querySelector('#npReset').onclick = () => { resetHost(); o.querySelector('#npHost').textContent = '비웠어요. 새 진행폰이 들어오면 돼요'; };
  }
  const url = remoteURL('player');
  o.querySelector('.np-code').textContent = room;
  const a = o.querySelector('.np-url'); a.href = url; a.textContent = url.replace(/^https?:\/\//, '');
  const big = Math.min(420, Math.floor(Math.min(innerWidth, innerHeight) * 0.5));
  const q = $('netQR'); const svg = qrSVG(url, big); q.innerHTML = svg || '(QR을 만들지 못했어요. 주소를 직접 알려 주세요)';
  const qh = $('netQRh'); qh.innerHTML = qrSVG(remoteURL('host'), 180) || '';
  o.querySelector('#npHost').textContent = hostPid ? '지금 진행폰: 연결됨' : '아직 진행폰 없음';
  o.classList.add('on');
}
// 게임 중에도 늦게 온 사람이 들어올 수 있게 구석에 작은 QR
function miniQR() {
  let m = $('netMini');
  if (!m) { m = document.createElement('button'); m.id = 'netMini'; m.title = '폰 연결 QR 크게 보기'; m.onclick = showQR; document.body.appendChild(m); }
  m.innerHTML = (qrSVG(remoteURL('player'), 120) || '') + `<b>${room}</b>`;
}

function newCode() { let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }

function addButton() {
  const help = $('helpBtn');
  const b = document.createElement('button');
  b.className = 'ghost'; b.id = 'netBtn';
  b.innerHTML = '📡 폰 연결 <i id="netDot"></i>';
  help.parentNode.insertBefore(b, help);
  b.onclick = async () => {
    if (!room) {
      const code = newCode();
      const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u);
      try { await connect(code); } catch (e) { alert('연결 실패: ' + e.message); room = null; }
    } else showQR();
  };
}

const st = document.createElement('style');
st.textContent = `#netDot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#bbb;margin-left:4px;vertical-align:middle}
#netDot[data-st=online]{background:#13A36B}#netDot[data-st=offline]{background:#D64545}
#netPanel{position:fixed;inset:0;background:rgba(10,30,40,.55);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
#netPanel.on{display:flex}
.np-box{position:relative;background:#fff;color:#1d2b33;border-radius:22px;padding:22px 20px;max-width:520px;width:100%;max-height:calc(100vh - 32px);overflow:auto;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.np-box h2{margin:0 0 4px;font-family:"Black Han Sans",sans-serif;font-size:24px}.np-box p{margin:4px 0 12px;font-size:14px;color:#556}
#netQR,#netQRh{display:flex;justify-content:center;margin:8px 0}
.np-host{margin-top:10px;font-size:14px;color:#556;text-align:center}.np-host summary{cursor:pointer;font-weight:700}
#netMini{position:fixed;right:12px;bottom:12px;z-index:30;background:#fff;border:0;border-radius:14px;padding:6px 6px 4px;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font:inherit}
#netMini b{font-family:"Black Han Sans",sans-serif;font-size:18px;letter-spacing:3px;color:#e2571e}
#netPanel.on~#netMini{display:none}
#modal.on~#netMini,#pick.on~#netMini,#help.on~#netMini{display:none} /* 카드가 열려 있으면 구석 QR이 버튼을 가리지 않게 숨김 */
@media (max-width:1099px){#netMini{display:none}}
.np-code{font-family:"Black Han Sans",sans-serif;font-size:44px;letter-spacing:8px;color:#e2571e;margin:6px 0}
.np-url{display:block;font-size:12px;word-break:break-all;color:#2b6ce0}.np-help{font-size:13px!important}
.np-x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:26px;cursor:pointer;color:#556}`;
document.head.appendChild(st);

addButton();
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom && /^[A-Z0-9]{3,8}$/.test(qRoom.toUpperCase())) connect(qRoom.toUpperCase()).catch((e) => console.error(e));
