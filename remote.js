// 진행폰·참가폰: 게임판 화면 요약을 받아 그리고, 누른 버튼을 게임판으로 보낸다
import { createTransport } from './transport.js';
import { transportKind, WS_URL, FIREBASE } from './config.js';

const $ = (id) => document.getElementById(id);
let AC = null;
const unlockAudio = () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; } };
document.addEventListener('pointerdown', unlockAudio, { capture: true });
function buzz(p) {
  if (navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} return; }
  const arr = Array.isArray(p) ? p : [p]; if (!AC || (arr.length === 1 && arr[0] < 60)) return;
  try {
    let t = AC.currentTime;
    arr.forEach((d, i) => {
      if (i % 2 === 0) {
        const o = AC.createOscillator(), g = AC.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(AC.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(d, 300) / 1000);
        o.start(t); o.stop(t + Math.min(d, 300) / 1000 + 0.02);
      }
      t += d / 1000;
    });
  } catch (e) {}
}

const KEY = 'jumarble-remote';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
const qs = new URLSearchParams(location.search);
const qRoom = (qs.get('room') || '').toUpperCase();
let me = {
  room: qRoom || (saved.room || '').toUpperCase(),
  role: saved.role || '',
  team: saved.team ?? null,
  sub: !!saved.sub,
  pid: saved.pid || (Math.random().toString(36).slice(2) + Date.now().toString(36)),
  nick: saved.nick || '',
  wnick: saved.wnick || '',
  wnickSet: !!saved.wnickSet,
  fan: saved.fan ?? null
};
if (qRoom && saved.room && qRoom !== saved.room) { me.role = ''; me.team = null; me.sub = false; }
const tagOf = (pid) => { let h = 7; for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pid ? h.toString(36) : ''; };

let lastCur = null, wake = null, lastRollLog = null;
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function dieEl(n) { const d = document.createElement('div'); d.className = 'pdie'; for (let k = 1; k <= 9; k++) { const c = document.createElement('i'); if (PIPS[n] && PIPS[n].includes(k)) c.className = 'on'; d.appendChild(c); } return d; }
function dicePop(a, b, sum, dbl) {
  try {
    document.querySelectorAll('.dicepop').forEach((e) => e.remove());
    const o = document.createElement('div'); o.className = 'dicepop' + (dbl ? ' dbl' : '');
    const row = document.createElement('div'); row.className = 'dr'; row.append(dieEl(a), dieEl(b));
    const t = document.createElement('div'); t.className = 'ds'; t.textContent = dbl ? `${sum}칸! 🎉 더블` : `${sum}칸!`;
    o.append(row, t); document.body.appendChild(o);
    try { buzz(dbl ? [80, 50, 80, 50, 160] : [60]); } catch (e) {}
    setTimeout(() => o.remove(), 1700);
  } catch (e) {}
}

const QUIZ = [
  ['라거는 하면 발효, 에일은 상면 발효 맥주다', 'O'], ['IPA는 ‘인디아 페일 에일’의 줄임말이다', 'O'],
  ['흑맥주 기네스는 독일 맥주다', 'X'], ['샴페인은 프랑스 샹파뉴 지방 스파클링 와인에만 붙이는 이름이다', 'O'],
  ['레드 와인의 붉은색은 포도 껍질에서 나온다', 'O'], ['화이트 와인은 청포도로만 만들 수 있다', 'X'],
  ['사케는 쌀로 만든 술이다', 'O'], ['막걸리는 증류주다', 'X'],
  ['소주(燒酒)라는 이름은 ‘불로 끓여 내린 술’이라는 뜻이다', 'O'], ['데킬라는 블루 아가베로 만든다', 'O'],
  ['럼의 주원료는 감자다', 'X'], ['진의 대표적인 향은 주니퍼베리(노간주나무 열매)에서 나온다', 'O'],
  ['모히토에는 민트가 들어간다', 'O'], ['마티니의 기본 재료는 진과 베르무트다', 'O'],
  ['맥주의 쓴맛은 주로 홉에서 나온다', 'O'], ['포트 와인은 스페인 술이다', 'X'],
  ['코냑은 브랜디의 한 종류다', 'O'], ['브랜디는 보통 포도주를 증류해서 만든다', 'O'],
  ['샴페인은 병 안에서 2차 발효를 시켜 거품을 만든다', 'O'], ['로제 와인은 레드와 화이트 와인을 섞어서만 만든다', 'X'],
  ['독일 옥토버페스트는 10월 말에 시작한다', 'X'], ['바이젠은 밀을 넣어 만든 맥주다', 'O'],
  ['샹그리아는 와인에 과일을 넣어 만든 음료다', 'O'], ['청주와 사케는 원료가 전혀 다르다', 'X'],
  ['복분자주는 산딸기류 열매로 만든 술이다', 'O'], ['와인 병 바닥의 움푹 들어간 부분을 ‘펀트’라고 한다', 'O'],
  ['와인 코르크 마개는 코르크참나무 껍질로 만든다', 'O'], ['프로세코는 이탈리아 스파클링 와인이다', 'O'],
  ['깔루아 밀크에는 커피 리큐어가 들어간다', 'O'], ['‘브뤼(Brut)’ 샴페인은 ‘엑스트라 드라이’보다 덜 달다', 'O'],
  ['테킬라는 블루 아가베를 100% 써야만 테킬라라고 부를 수 있다', 'X'],
  ['카바는 스페인 스파클링 와인이다', 'O'], ['사케는 증류해서 만든 술이다', 'X']
];
const QUIZ_PARTY = [
  ['문어의 심장은 3개다', 'O'], ['북극곰의 피부는 흰색이다', 'X'],
  ['바나나는 나무가 아니라 풀이다', 'O'], ['펭귄은 남극에만 살고 북극엔 야생 펭귄이 없다', 'O'],
  ['토마토는 식물학적으로 과일에 속한다', 'O'], ['꿀은 유통기한이 사실상 없다', 'O'],
  ['세계에서 가장 넓은 나라는 러시아다', 'O'], ['상어는 뼈가 전부 연골로 되어 있다', 'O'],
  ['고래는 아가미로 숨을 쉰다', 'X'], ['우리나라 표준시는 일본 도쿄와 같다', 'O']
];
const QZ = { order: [], cur: null, picked: null, right: 0, total: 0, until: 0, pack: '' };
const getQuizPool = () => (S && S.pack && S.pack !== 'drinks') ? QUIZ_PARTY : QUIZ;
function nextQuiz() { const pool = getQuizPool(); if (!QZ.order.length || QZ.pack !== (S && S.pack || 'drinks')) { QZ.pack = (S && S.pack || 'drinks'); QZ.order = pool.map((_, i) => i).sort(() => Math.random() - 0.5); } QZ.cur = QZ.order.pop(); QZ.picked = null; }
function quizView() {
  const pool = getQuizPool();
  const turnKey = S.turnNo != null ? S.turnNo : S.cur;
  if (QZ.cur == null || QZ.pack !== (S && S.pack || 'drinks') || (QZ.picked != null && QZ.turn !== turnKey)) { nextQuiz(); }
  if (QZ.picked == null) QZ.turn = turnKey;
  const [q, a] = pool[QZ.cur] || pool[0];
  const qTitle = (S && S.pack && S.pack !== 'drinks') ? '🧠 기다리는 동안 상식 퀴즈' : '🧠 기다리는 동안 술 상식 (맥주·와인·칵테일)';
  const box = h('div', { class: 'panel quiz' }, h('p', { class: 'sec' }, `${qTitle} · 맞힌 개수 ${QZ.right}/${QZ.total}`), h('div', { class: 'card-d' }, q));
  if (QZ.picked == null) {
    box.append(h('div', { class: 'choice' }, ['O', 'X'].map((v) => h('button', { class: 'btn', style: 'font-size:22px', onclick: () => {
      QZ.picked = v; QZ.total++; const ok = v === a; if (ok) { QZ.right++; send({ op: 'quiz', ok: true }); }
      render();
    } }, v === 'O' ? '⭕' : '❌'))));
  } else box.append(h('p', { class: 'wait', style: `color:${QZ.picked === a ? '#13A36B' : '#D64545'};font-weight:700` }, QZ.picked === a ? `🎉 정답! (${a})` : `아쉽! 정답은 ${a}`), h('p', { class: 'small muted', style: 'margin:2px 0 0' }, '다음 문제는 다음 차례에 나와요'));
  box.append(h('p', { class: 'small muted', style: 'margin:6px 0 0' }, '맞힌 개수는 끝날 때 ‘🧠 술 상식 박사’ 시상에만 쓰여요'));
  return box;
}

const CHEER = ['👏', '🔥', '😂', '🍻', '😱', '🥃', '💪', '😭'];
let cheerAt = 0, saidAt = 0, sayOpen = false, watchEd = false; let lastGK = '', pauseArm = 0, lastWarn = '';

function sayBox(big) {
  const left = Math.max(0, 4 - Math.floor((Date.now() - saidAt) / 1000));
  const sendSay = (o) => { const n = Date.now(); if (n - saidAt < (o.txt != null ? 4000 : 2500)) return; saidAt = n; send({ op: 'say', ...o }); render(); setTimeout(render, 1600); setTimeout(render, 4100); };
  const body = h('div', {}, h('div', { class: 'saygrid' }, (S.phrases || []).map((t) => h('button', { class: 'btn', onclick: () => sendSay({ p: t }) }, t))));
  if (S.chatOn) {
    const inp = h('input', { type: 'text', maxlength: 20, placeholder: '직접 쓰기 (20자까지)', 'data-keep': '1', 'aria-label': '한마디 직접 쓰기', value: drafts.__say || '' });
    inp.oninput = () => { drafts.__say = inp.value; };
    const go = () => { const v = inp.value.trim(); if (!v) return; drafts.__say = ''; inp.value = ''; inp.blur(); sendSay({ txt: v }); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    body.append(h('div', { class: 'sayrow' }, inp, h('button', { class: 'btn', disabled: left > 0, onclick: go }, left > 0 ? `${left}초` : '보내기')));
  }
  if (Date.now() - saidAt < 1600) body.append(h('p', { class: 'small', style: 'margin:6px 0 0;color:#13A36B;font-weight:700;text-align:center' }, '✅ TV로 보냈어요!'));
  if (big) return h('div', { class: 'panel' }, h('p', { class: 'sec' }, '💬 한마디 → TV에 흘러가요'), body);
  const d = h('details', { class: 'saybox' }, h('summary', {}, '💬 한마디 보내기 (TV에 떠요)'), body);
  if (sayOpen) d.open = true; d.ontoggle = () => { sayOpen = d.open; };
  return d;
}

function watchView() {
  const out = [];
  const fanT = me.fan != null && S.teams && S.teams[me.fan] ? S.teams[me.fan] : null;
  if (watchEd || !me.wnickSet) {
    const nk = h('input', { type: 'text', maxlength: 8, placeholder: '닉네임 (선택, 8자)', 'data-keep': '1', value: me.wnick || '', 'aria-label': '닉네임' });
    nk.oninput = () => { me.wnick = nk.value.trim().slice(0, 8); save(); };
    nk.onkeydown = (e) => { if (e.key === 'Enter') nk.blur(); };
    out.push(h('div', { class: 'panel' }, h('p', { class: 'sec' }, '👀 관전자 · TV에 내 이름과 응원 팀 색으로 떠요'), nk,
      h('p', { class: 'small muted', style: 'margin:10px 0 4px' }, '어느 팀을 응원할까요?'),
      h('div', { class: 'saygrid' }, [...(S.teams || []).map((t, i) => h('button', { class: 'btn' + (me.fan === i ? ' on' : ''), style: `border:3px solid ${t.color}`, onclick: () => { me.fan = i; save(); hello(); render(); } }, t.name)),
        h('button', { class: 'btn' + (me.fan == null ? ' on' : ''), onclick: () => { me.fan = null; save(); hello(); render(); } }, '🤝 중립 (다 응원)')]),
      h('button', { class: 'big', style: 'width:100%;margin-top:10px', onclick: () => { me.wnickSet = true; watchEd = false; save(); hello(); render(); } }, '✅ 좋아요')));
  } else out.push(h('div', { class: 'panel watchme', style: fanT ? `border:3px solid ${fanT.color}` : '' }, h('span', {}, `👀 ${me.wnick || '관전자'} · ${fanT ? fanT.name + ' 응원' : '중립'}`), h('button', { class: 'btn', onclick: () => { watchEd = true; render(); } }, '바꾸기')));
  if (S.phase === 'setup') out.push(h('div', { class: 'panel wait' }, '⏳ 팀들이 준비 중이에요. 시작하면 여기서 응원해요'));
  else if (S.phase === 'play' && S.modal) out.push(h('div', { class: 'panel', style: 'text-align:center' }, h('div', { style: 'font-size:34px' }, S.modal.e || ''), h('div', { class: 'disp', style: 'font-size:22px' }, S.modal.t || ''), h('p', { class: 'small muted', style: 'margin:4px 0 0' }, S.modal.who || '')));
  if (S.phase === 'play' || S.phase === 'over') {
    out.push(h('div', { class: 'panel' }, h('p', { class: 'sec' }, '📣 응원 (연타하면 TV에서 크게 터져요)'), h('div', { class: 'cheerbig' }, CHEER.map((e) => h('button', { class: 'btn', 'aria-label': '응원 ' + e, onclick: () => { const n = Date.now(); if (n - cheerAt < 600) return; cheerAt = n; send({ op: 'cheer', e }); } }, e)))));
    out.push(sayBox(true));
  }
  return out;
}

function cheerBar() {
  return h('div', { class: 'cheerbar' }, CHEER.map((e) => h('button', { class: 'btn', 'aria-label': '응원 ' + e, onclick: () => { const n = Date.now(); if (n - cheerAt < 600) return; cheerAt = n; send({ op: 'cheer', e }); } }, e)));
}

let tp = null, S = null, connectedRoom = null;
let local = { sw: null, react: null };
const drafts = {}; let focusRid = null, tapGo = 0, lastDrink = '', lastNext = '', recOpen = -1, undoArm = 0; let lastMseq = -1;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const send = (cmd) => {
  if (tp) tp.send({
    t: 'cmd', from: me.role, team: me.role === 'watch' ? null : me.team, sub: !!me.sub,
    pid: me.pid, nick: me.nick, sq: S && S.seq || 0,
    ...(me.role === 'watch' ? { fan: me.fan, nick: me.wnick } : {}), ...cmd
  });
  try { buzz(15); } catch (e) {}
};
const isHost = () => me.role === 'host';
const sub = () => !isHost() && me.team != null && S.phase === 'play' && !S.hostOn && S.subTm === me.team;
const mine = (teams) => isHost() ? (teams === 'host' || (teams !== 'board' && String(teams || '').split(',').some((x) => x !== '' && !(S.teamsOn || []).includes(+x)))) : (String(teams || '').split(',').includes(String(me.team)) || (teams === 'host' && sub()));
const myTurn = () => S && S.cur === me.team;
const teamHasPhone = () => !!(S && (S.teamsOn || []).includes(S.cur));
const canTeamAct = () => (!isHost() && myTurn()) || (isHost() && !teamHasPhone());
let lastPassAsk = null;
let lastToast = -1, toastTimer = null;

function save() { try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) {} }
const hello = () => tp && tp.send({
  t: 'hello', from: me.role, pid: me.pid,
  team: me.role === 'player' ? me.team : null,
  sub: me.role === 'player' ? !!me.sub : false,
  nick: me.role === 'player' ? (me.nick || '') : me.role === 'watch' ? (me.wnick || '') : null,
  fan: me.role === 'watch' ? me.fan : null,
  ready: me.role === 'player' && !me.sub && !!me.ready
});

async function keepAwake() { try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); hello(); } });

let helloIv = 0;
const bye = () => { try { if (tp && me.role) tp.send({ t: 'cmd', op: 'bye', from: me.role, team: me.team, pid: me.pid }); } catch (e) {} };
window.addEventListener('pagehide', bye);

async function connect() {
  if (connectedRoom === me.room && tp) return;
  if (tp) tp.close();
  connectedRoom = me.room;
  tp = await createTransport({ kind: transportKind() === 'none' ? 'local' : transportKind(), room: me.room, role: 'player', url: WS_URL, firebase: FIREBASE });
  tp.on((m) => { if (m && m.t === 'state' && (!m.room || m.room === me.room)) { const nb = m.boot && S && S.boot && m.boot !== S.boot; S = m; if (nb) hello(); checkTeams(); render(); } });
  tp.onStatus((st) => { $('dot').className = 'dot ' + st; if (st === 'online') hello(); });
  hello(); keepAwake();
  if (!helloIv) helloIv = setInterval(() => { if ((me.role === 'host' || me.role === 'player' || me.role === 'watch') && document.visibilityState === 'visible') hello(); }, 30000);
}

// ---------- 참가 화면 ----------
$('room').value = me.room;
$('room').oninput = () => { me.room = $('room').value.trim().toUpperCase(); };
$('asHost').onclick = async () => { if (!checkRoom()) return; me.role = 'host'; me.team = null; me.sub = false; save(); await connect(); goLive(); };
if (qs.get('as') === 'player') { const c = $('asHost').closest('.choice'); c.style.display = 'none'; if (c.previousElementSibling) c.previousElementSibling.style.display = 'none'; }
$('asPlayer').onclick = async () => { if (!checkRoom()) return; me.role = 'player'; save(); await connect(); $('teamPick').hidden = false; drawTeamPick(); };

let leaveArm = 0;
$('leave').onclick = (e) => {
  e.preventDefault();
  if (Date.now() - leaveArm > 3000) { leaveArm = Date.now(); const l = $('leave'), o = l.textContent; l.textContent = '한 번 더 누르면 나가요'; setTimeout(() => { l.textContent = o; }, 3000); return; } leaveArm = 0;
  bye();
  if (me.role === 'player' || me.role === 'watch') { me.role = 'player'; me.team = null; me.sub = false; me.sig = ''; me.ready = false; wantNew = false; joinStep = null; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; hello(); drawTeamPick(); return; }
  me.role = ''; me.team = null; me.sub = false; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = true;
};
function checkRoom() { if (!/^[A-Z0-9]{3,8}$/.test(me.room)) { alert('방 코드를 확인해 주세요'); return false; } return true; }

let wantNew = false;
let joinStep = null;

function drawTeamPick() {
  drawTeamPick0();
  if (S && S.teams && joinStep == null) {
    $('teamBtns').append(h('div', { style: 'grid-column:1/-1;margin-top:14px;border-top:1px dashed #ccc;padding-top:12px' },
      h('p', { class: 'small muted', style: 'margin:0 0 6px' }, '팀 소속 없이 구경만 할 땐 여기로! TV에 응원·한마디를 보내요'),
      h('button', { class: 'big', style: 'width:100%;background:#2B6CE0;color:#fff', onclick: () => { me.role = 'watch'; me.team = null; me.sub = false; wantNew = false; save(); goLive(); hello(); } }, '👀 관전자로 들어가기')));
  }
}

function drawTeamPick0() {
  const box = $('teamBtns'); box.innerHTML = '';
  const desc = $('teamPick').querySelector('p');
  if (!S || !S.teams) { box.append(h('p', { class: 'muted small' }, '게임판과 연결하는 중…')); return; }

  if (joinStep != null && S.teams[joinStep]) {
    const t = S.teams[joinStep];
    if (desc) desc.textContent = `${t.name} 팀원으로 합류합니다`;
    const wrap = h('div', { style: 'grid-column:1/-1' });
    const members = (t.mem || '').split(/[\s,]+/).filter(Boolean);
    const connectedNicks = ((S.phones || {})[String(t.i)] || []).filter((x) => x.on && x.nick).map((x) => x.nick);

    const enterAsMember = (nk) => {
      nk = nk.trim().slice(0, 8);
      if (!nk) { alert('이름을 입력하거나 선택해 주세요'); return; }
      me.team = t.i; me.sub = true; me.nick = nk; me.sig = S.phase === 'play' ? sigOf(S) : '';
      joinStep = null; wantNew = false; save();
      send({ op: 'jointeam', ti: t.i, nick: nk });
      goLive(); hello();
      try { buzz([80, 40, 80]); } catch (e) {}
    };

    if (members.length) {
      wrap.append(h('p', { class: 'small muted', style: 'margin:4px 0 8px' }, '👇 본인 이름을 누르세요'));
      const g = h('div', { class: 'choice', style: 'margin-bottom:12px' });
      members.forEach((m) => {
        const isTaken = connectedNicks.includes(m) && m !== me.nick;
        g.append(h('button', {
          class: 'btn' + (me.nick === m ? ' on' : ''),
          style: `border-color:${t.color};border-width:2px`,
          onclick: () => enterAsMember(m)
        }, isTaken ? `📱 ${m} (접속 중)` : m));
      });
      wrap.append(g);
    }

    const inp = h('input', { type: 'text', maxlength: 8, placeholder: members.length ? '명단에 없으면 이름 직접 입력' : '내 이름 입력 (예: 지수)', value: me.nick || '' });
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) enterAsMember(inp.value); };
    wrap.append(
      inp,
      h('button', { class: 'big', style: 'width:100%;margin-top:10px', onclick: () => enterAsMember(inp.value) }, `🙋 ${t.name} 팀원으로 합류`),
      h('button', { class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => { joinStep = null; drawTeamPick(); } }, '← 뒤로 가기')
    );
    box.append(wrap);
    return;
  }

  if (desc) desc.textContent = S.solo ? '나로 참가하거나 기존 칸을 고르세요' : '팀장(방 생성) 또는 팀원(기존 팀 합류)으로 들어갈 수 있어요';

  const joinLeader = (t) => {
    wantNew = false; me.team = t.i; me.sub = false; me.sig = S.phase === 'play' ? sigOf(S) : '';
    save(); goLive(); hello();
  };

  if (S.phase === 'setup') {
    box.append(h('div', { style: 'grid-column:1/-1' },
      h('button', { class: 'big', style: 'width:100%', disabled: wantNew, onclick: () => { wantNew = true; if (tp) tp.send({ t: 'cmd', from: 'player', team: null, pid: me.pid, op: 'newteam' }); drawTeamPick(); } }, wantNew ? '⏳ 팀 만드는 중…' : (S.solo ? '🙋 나로 참가하기' : '👑 팀장으로 우리 팀 만들기')),
      h('p', { class: 'small muted', style: 'margin:6px 0 12px' }, S.solo ? '누르면 내 칸이 생기고 이름을 적을 수 있어요' : '팀장 한 명이 팀을 만들고 팀원 이름을 적을 수 있어요')));

    if (S.teams.length && !S.solo) {
      box.append(h('p', { class: 'small', style: 'grid-column:1/-1;margin:6px 0 4px;font-weight:800;color:var(--tarp)' }, '🙋 팀원 개인 접속 · 우리 팀을 눌러 합류하세요'));
      S.teams.forEach((t) => {
        const cnt = ((S.phones || {})[String(t.i)] || []).filter((x) => x.on).length;
        box.append(h('button', { class: 'btn', style: `border-color:${t.color};border-width:3px`, onclick: () => { joinStep = t.i; drawTeamPick(); } },
          h('b', {}, t.name), h('br'), h('span', { class: 'small muted' }, `👥 팀원 합류${cnt ? ` (${cnt}대 접속)` : ''}`)));
      });

      box.append(h('p', { class: 'small muted', style: 'grid-column:1/-1;margin:12px 0 4px' }, '👑 팀장으로 들어가기 (팀 이름·명단 수정 권한)'));
      S.teams.forEach((t) => {
        box.append(h('button', { class: 'btn', style: `border-color:${t.color};font-size:15px;padding:8px`, onclick: () => joinLeader(t) },
          h('b', {}, t.name), h('br'), h('span', { class: 'small muted' }, t.mem || '팀장 입장')));
      });
    } else if (S.teams.length && S.solo) {
      S.teams.forEach((t) => {
        box.append(h('button', { class: 'btn', style: `border-color:${t.color};border-width:3px`, onclick: () => joinLeader(t) }, h('b', {}, t.name)));
      });
    }
    return;
  }

  if (!S.teams.length) { box.append(h('p', { class: 'muted small' }, '게임판에서 게임을 시작하면 팀 목록이 나와요…')); return; }
  S.teams.forEach((t) => {
    const cnt = ((S.phones || {})[String(t.i)] || []).filter((x) => x.on).length;
    box.append(h('button', { class: 'btn', style: `border-color:${t.color};border-width:3px`, onclick: () => { if (S.solo) joinLeader(t); else { joinStep = t.i; drawTeamPick(); } } },
      h('b', {}, t.name), h('br'), h('span', { class: 'small muted' }, S.solo ? '참가하기' : `🙋 팀원 합류${cnt ? ` (${cnt}대)` : ''}`)));
  });
}

const sigOf = (st) => (st && st.teams || []).map((t) => t.name).join('|');
function checkTeams() {
  if (wantNew && me.role === 'player' && S && S.phase === 'setup' && S.claims && S.claims[tagOf(me.pid)] != null && S.teams && S.teams[S.claims[tagOf(me.pid)]]) {
    wantNew = false; me.team = S.claims[tagOf(me.pid)]; me.sub = false; me.sig = ''; save(); setupEd = null; goLive(); hello(); try { buzz([100, 50, 100]); } catch (e) {}
  }
  if (me.role === 'player' && me.team == null && S && S.phase === 'play' && !$('live').hidden) { $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; drawTeamPick(); return; }
  if (me.role === 'player' && S && S.phase === 'play' && me.ready) { me.ready = false; hello(); }
  if (me.role === 'player' && me.team != null && S && S.phase === 'setup' && S.teams) {
    if (!S.teams[me.team]) { me.team = null; me.sub = false; me.sig = ''; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; drawTeamPick(); return; }
    if (me.sig) { me.sig = ''; save(); }
    return;
  }
  if (me.role !== 'player' || me.team == null || !S || S.phase !== 'play' || !S.teams || !S.teams.length) return;
  const sig = sigOf(S);
  if (!me.sig) { me.sig = sig; save(); return; }
  if (sig !== me.sig || !S.teams[me.team]) {
    me.team = null; me.sub = false; me.sig = ''; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; drawTeamPick();
    const n = $('teamPick').querySelector('p'); if (n) n.textContent = '팀 구성이 바뀌었어요. 우리 팀을 다시 골라 주세요';
  }
}
function goLive() { $('join').hidden = true; $('live').hidden = false; render(); }

// ---------- 메인 화면 ----------
const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16), L = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; return L > 0.45 ? '#1b1b1b' : '#fff'; };
let held = false, heldRender = false, heldT = 0;
document.addEventListener('pointerdown', () => { held = true; clearTimeout(heldT); heldT = setTimeout(rel, 1500); }, true);
function rel() { if (!held) return; held = false; clearTimeout(heldT); if (heldRender) { heldRender = false; setTimeout(render, 0); } }
document.addEventListener('pointerup', () => setTimeout(rel, 0), true); document.addEventListener('pointercancel', rel, true);

const MDONE_FLAG = () => (S && S.modal && S.modal.ok && S.modal.ok.pending) ? '1' : '0';
function render() {
  if (held) { heldRender = true; return; }
  if (S && S.mseq !== lastMseq) {
    lastMseq = S.mseq;
    local.sw = null; local.min = null; local.bet = null; local.react = null;
    for (const k of Object.keys(oxPick)) { if (!k.startsWith(S.mseq + ':')) delete oxPick[k]; }
    if (local.tap) { if (local.tap.q) send({ op: 'tap', n: local.tap.q }); clearInterval(local.tapIv); local.tap = null; }
  }
  if (!$('teamPick').hidden && $('live').hidden) drawTeamPick();
  if ($('live').hidden || !S) return;
  const myT = S.teams && S.teams[me.team];
  $('me').textContent = isHost() ? `🎮 진행폰 · ${S.room || me.room}` : me.role === 'watch' ? `👀 ${me.wnick || '관전자'}` : `📱 ${myT ? myT.name : '플레이어'}${me.nick ? ` · ${me.nick}` : ''}`;

  const mine0 = !isHost() && S.phase === 'play' && S.cur === me.team;
  document.body.classList.toggle('myturn', mine0);
  if (mine0 || S.phase !== 'play' || isHost()) document.body.classList.remove('nextturn');
  { const c = myT && /^#[0-9a-f]{6}$/i.test(myT.color) ? myT.color : '#e2571e'; document.documentElement.style.setProperty('--my', c); document.documentElement.style.setProperty('--myInk', inkOn(c)); document.body.style.boxShadow = mine0 ? `inset 0 0 0 5px ${c}` : ''; }
  if (mine0 && lastCur !== S.cur) { try { buzz([120, 60, 120]); } catch (e) {} }
  lastCur = S.phase === 'play' ? S.cur : null;

  const st = $('status'); st.innerHTML = '';
  if (isHost() && S.host && S.host !== tagOf(me.pid)) st.append(h('p', { class: 'warn' }, '⚠️ 이미 다른 진행폰이 연결돼 있어요. 이 폰의 버튼은 게임판에서 무시돼요.'));
  if (S.phase === 'setup') {
    st.append(h('p', { class: 'wait' }, !isHost() && myT ? (me.sub ? `🙋 ${myT.name} 팀원으로 합류 완료! 게임 시작을 기다려요` : '✏️ 팀 이름·팀원 적고 ✋ 준비 완료!') : '팀 폰에서 팀 이름·멤버를 적고, 게임판에서 ‘게임 시작’을 누르면 시작돼요'));
  } else if (S.teams && S.teams[S.cur] && S.phase === 'play') {
    const ct = S.teams[S.cur];
    const n = S.teams.length; let wait = null;
    if (!isHost() && myT && !mine0) {
      let k = 0, j = S.cur; while (k < n && j !== me.team) { j = (j + 1) % n; k++; }
      document.body.classList.toggle('nextturn', k === 1 && n > 1);
      wait = k > 0 && k < n ? (k === 1 ? '⏭️ 다음이 우리 차례! 미리 준비하세요' : `우리 차례까지 ${k}팀 남았어요`) : null;
      if (k === 1 && n > 1 && lastNext !== (S.turnNo || 0) + ':' + S.cur) { lastNext = (S.turnNo || 0) + ':' + S.cur; try { buzz([60, 60, 60]); } catch (e) {} }
    }
    if (!isHost() && me.role === 'player') {
      st.append(...[
        h('div', { class: 'disp', style: `font-size:${mine0 ? 34 : 22}px;color:${mine0 ? 'var(--myInk,#fff)' : ct.color};text-align:center` }, mine0 ? '🎲 우리 차례!' : `⏳ ${ct.name} 차례`),
        wait ? h('p', { class: 'small' + (/다음이 우리/.test(wait) ? ' nextup' : ''), style: 'text-align:center;margin:6px 0 0;font-weight:700' }, wait) : null
      ].filter(Boolean));
    } else {
      st.append(...[
        h('div', { class: 'disp', style: `font-size:${mine0 ? 30 : 22}px;color:${mine0 ? 'var(--myInk,#fff)' : ct.color};text-align:center` }, mine0 ? `🎲 우리 팀(${ct.name}) 차례예요!` : `🎲 ${ct.name} 차례`),
        wait ? h('p', { class: 'small' + (/다음이 우리/.test(wait) ? ' nextup' : ''), style: 'text-align:center;margin:4px 0 0;font-weight:700' }, wait) : null,
        h('p', { class: 'small muted', style: 'text-align:center;margin:4px 0 0' }, (S.modal || S.pick) && S.now ? S.now.replace(/^🎯 /, '') : (S.log || '')),
        S.cast ? h('p', { class: 'small cast', style: 'text-align:center;margin:4px 0 0;font-weight:700' }, S.cast) : null
      ].filter(Boolean));
    }
  }
  if (S.auto && !(S.warn && me.role === 'player' && S.warn.ti === me.team)) st.append(h('p', { class: 'small autoLine', style: 'text-align:center;margin:6px 0 0;font-weight:700' }, S.auto));
  st.hidden = !st.childNodes.length;

  if (lastToast === -1) lastToast = S.toast ? S.toast.n : 0;
  else if (S.toast && S.toast.n && S.toast.n !== lastToast) {
    lastToast = S.toast.n;
    let f = $('feed'); if (!f) { f = h('div', { id: 'feed' }); document.body.append(f); }
    const msg = S.toast.m || ''; const mineMsg = !isHost() && myT && msg.includes(myT.name);
    if (!isHost() && /폰이 들어왔어요|준비 완료!|합류!/.test(msg) && S.phase !== 'setup') {} else {
      const parts = msg.split('  ·  '); let tx = msg;
      if (parts.length > 2) { const mp = myT ? parts.filter((x) => x.includes(myT.name)) : []; const keep = mp.length ? mp : parts.slice(0, 1); tx = keep.join('  ·  ') + `  ·  외 ${parts.length - keep.length}건`; }
      f.textContent = tx; f.className = 'on' + (mineMsg ? ' mine' : '');
      if (mineMsg) { try { buzz([200, 80, 200]); } catch (e) {} }
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { f.className = ''; }, mineMsg ? 8000 : 5200);
    }
  }

  {
    const mm = !isHost() && myT && S.phase === 'play' ? String(S.log || '').match(/^(?:[^:]+:\s*)?(.+?): (\d) \+ (\d) = (\d+)(.*)$/) : null;
    if (mm && mm[1] === myT.name && lastRollLog !== S.log) { if (lastRollLog !== null) dicePop(+mm[2], +mm[3], +mm[4], /더블/.test(mm[5])); }
    if (S.log !== undefined) lastRollLog = S.log;
  }

  const main = $('main');
  if (S.phase === 'setup' && !isHost() && myT) {
    if (me.sub) memberSetupView(main, myT);
    else setupView(main, myT);
    renderTeams();
    return;
  }
  if (S.phase === 'setup' && !isHost() && !myT && me.role !== 'watch') { setupEd = null; $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; drawTeamPick(); return; }

  {
    const ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT' && ae.dataset.rid && main.contains(ae) && S.modal && (S.modal.box || []).some((b) => b.k === 'in' && b.rid === ae.dataset.rid && !b.dis)) {
      const tx = [...main.querySelectorAll('.txt')], bs = S.modal.box.filter((b) => b.k === 'txt' && !(S.modal.react && /react/.test(b.cls)));
      if (tx.length === bs.length) { bs.forEach((b, i) => { if (tx[i].textContent !== b.text) tx[i].textContent = b.text; }); renderTeams(); return; }
    }
  }
  {
    const gk = JSON.stringify([S.phase, S.cur, !!S.roll, S.mseq, MDONE_FLAG(), S.now, S.modal ? S.modal.t + '|' + (S.modal.box || []).length : '', S.pick ? S.pick.title : '', !!S.taxi, !!S.drink, !!S.over, !!S.paused, !!S.intro, S.subTm]);
    const ae = document.activeElement; const keep = ae && ae.tagName === 'INPUT' && ae.dataset.keep && main.contains(ae);
    if (keep && (me.role === 'watch' || gk === lastGK)) { renderTeams(); return; } lastGK = gk;
  }

  setupEd = null; main.innerHTML = '';
  if (lastFx === -1) lastFx = S.fx ? S.fx.n : 0;
  else if (S.fx && S.fx.n !== lastFx) { lastFx = S.fx.n; phoneFx(S.fx); }

  if (S.warn && me.role === 'player' && me.team != null && S.warn.ti === me.team && !S.paused) {
    const w = S.warn, k = `${w.id}|${w.st}`;
    if (k !== lastWarn) { lastWarn = k; try { buzz(w.st === 2 ? [400, 120, 400, 120, 400] : [200, 100, 200]); } catch (e) {} }
    main.append(h('div', { class: 'warnBanner' + (w.st === 2 ? ' hot' : '') }, w.st === 2 ? `⏰ ${w.left}초 뒤 앱이 우리 팀 대신 ${w.what === 'roll' ? '굴려요' : '골라요'}!` : `👋 우리 팀 차례예요! ${w.what === 'roll' ? '🎲 주사위를 굴려 주세요' : '아래 버튼을 눌러 주세요'}`));
  }
  if (S.intro && me.role !== 'watch') main.append(h('div', { class: 'panel' }, h('div', { class: 'disp', style: 'font-size:26px;text-align:center;color:#e2571e' }, '🎮 이렇게 해요'), ...S.intro.map((x) => h('p', { style: 'margin:8px 0;font-size:16px' }, x)),
    h('button', { class: 'big', style: 'width:100%', onclick: () => send({ op: 'introgo' }) }, '🍻 시작!')));
  if (S.paused) main.append(h('div', { class: 'panel', style: 'text-align:center' }, h('div', { style: 'font-size:56px' }, '⏸️'), h('div', { class: 'disp', style: 'font-size:28px' }, '잠시 멈춤'), h('p', { class: 'small muted' }, isHost() ? '아래 ‘▶ 계속하기’로 다시 시작해요' : !S.hostOn ? '준비되면 아무 팀 폰에서나 ‘▶ 계속하기’' : '진행폰에서 다시 시작해요'), (!isHost() && !S.hostOn && me.role !== 'watch') ? h('button', { class: 'big', style: 'width:100%', onclick: () => send({ op: 'pause', on: false }) }, '▶ 계속하기') : null));
  if (S.paused && !isHost() && me.role !== 'watch') { main.append(cheerBar()); renderTeams(); return; }

  if (S.drink) {
    const mineD = !isHost() && myT && (S.drink.ti ? S.drink.ti.includes(myT.i) : S.drink.l.some((x) => x.includes(myT.name)));
    if (mineD && lastDrink !== S.drink.l.join()) { try { buzz([300, 100, 300, 100, 300]); } catch (e) {} }
    lastDrink = S.drink.l.join();
    main.append(h('div', { class: 'panel drinkPanel', style: `text-align:center;${mineD ? 'background:#e2571e;color:#fff' : ''}` }, h('div', { class: 'disp', style: 'font-size:30px' }, S.drink.h),
      ...S.drink.l.map((x) => h('div', { style: 'font-size:20px;font-weight:800;margin:4px 0' }, x)), h('div', { class: 'disp', style: 'font-size:48px;margin:6px 0' }, S.drink.cd),
      (isHost() || mineD) ? h('button', { class: 'big', style: 'width:100%;background:#13A36B;color:#fff', onclick: () => send({ op: 'drinkdone' }) }, '✅ 다 마셨어요') : null));
  } else lastDrink = '';

  if (me.role === 'watch') { if (S.over) main.append(overView()); main.append(...watchView()); renderTeams(); return; }
  if (S.over) main.append(overView());
  else if (S.pick) main.append(pickView());
  else if (S.taxi) main.append(taxiView());
  else if (S.modal) main.append(cardView(S.modal));
  else if (S.spin) main.append(h('div', { class: 'panel wait' }, S.spin));
  else if (S.roll && canTeamAct() && !S.intro) {
    const isIsle = /탈출 주사위/.test(S.now || '');
    const curT = S.teams && S.teams[S.cur];
    const isTeq = curT && S.facOn && curT.fac === 'tequila' && !S.juru && !isIsle;
    main.append(h('div', { class: 'panel', style: 'text-align:center' },
      h('button', { class: 'big roll', onclick: () => doRoll() }, isIsle ? '🏝️ 더블 탈출 도전' : '🎲 굴리기'),
      isTeq ? h('button', { class: 'btn', disabled: !!curT.tequilaBoost, style: 'width:100%;margin-top:8px;border-color:#13A36B;color:#13A36B;font-weight:800', onclick: () => send({ op: 'tequilaboost' }) }, curT.tequilaBoost ? '🌵 데킬라 슬래머 장전 완료! (이동 2배)' : '🌵 데킬라 슬래머 (자진 1잔 원샷 → 이동 2배!)') : null,
      (isIsle && !S.juru) ? h('button', { class: 'btn', style: 'width:100%;margin-top:8px;border-color:#e2571e;color:#e2571e', onclick: () => send({ op: 'islepay' }) }, '🥃 1잔 마시고 즉시 탈출') : null,
      shakeOn ? h('p', { class: 'small', style: 'margin:8px 0 0;font-weight:700' }, '📱 폰을 흔들어도 굴러가요!')
        : shakeAsk ? h('button', { class: 'btn', style: 'margin-top:8px;font-size:14px;min-height:0;padding:8px 12px', onclick: askShake }, '📱 흔들어서 굴리기 켜기') : null));
  }
  else if (S.roll && isHost()) main.append(h('div', { class: 'panel wait' }, `🎲 ${S.teams[S.cur] ? S.teams[S.cur].name : '차례 팀'} 폰에서 굴려요`));
  else if (S.phase === 'play' && (isHost() || me.role !== 'player')) main.append(h('div', { class: 'panel wait' }, '👀 게임판을 봐 주세요'));
  else if (S.phase === 'play') { const st0 = $('status'); if (st0 && !st0.querySelector('.lookbd')) st0.append(h('p', { class: 'small muted lookbd', style: 'text-align:center;margin:6px 0 0' }, '👀 게임판을 봐 주세요')); }

  const nothing = !main.querySelector('button:not([disabled]),input:not([disabled])');
  if (!isHost() && S.phase === 'play' && !mine0 && !S.over && !S.modal && !S.pick && !S.taxi && nothing) { const qd = h('details', { class: 'extras quiz' }, h('summary', {}, (S.pack && S.pack !== 'drinks') ? '🧠 기다리는 동안 상식 퀴즈' : '🧠 기다리는 동안 술 상식 퀴즈'), quizView()); if (quizOpen) qd.open = true; qd.ontoggle = () => { quizOpen = qd.open; }; main.append(qd); }
  if (S.phase === 'play') {
    const ex = h('details', { class: 'extras' }, h('summary', {}, isHost() || S.hostOn ? '😀 응원 · 💬 한마디' : '😀 응원 · 💬 한마디 · ⏸️ 멈춤'), cheerBar(), sayBox(false),
      !isHost() && !S.hostOn && !S.paused ? h('div', { style: 'text-align:center;margin:6px 0' }, h('button', { class: 'btn' + (Date.now() - pauseArm < 3000 ? ' armed' : ''), style: 'font-size:13px;padding:6px 14px', onclick: () => { if (Date.now() - pauseArm < 3000) { pauseArm = 0; send({ op: 'pause', on: true }); return; } pauseArm = Date.now(); render(); setTimeout(render, 3100); } }, Date.now() - pauseArm < 3000 ? '⏸️ 한 번 더 누르면 멈춰요' : '⏸️ 잠시 멈춤 (화장실·안주 타임)')) : null);
    if (extrasOpen) ex.open = true; ex.ontoggle = () => { extrasOpen = ex.open; }; main.append(ex);
  }
  if (isHost() && S.phase === 'play' && S.now) main.prepend(h('div', { class: 'nowline' }, '📢 ' + S.now));
  if (isHost() && (S.phase === 'play' || S.phase === 'over') && S.mc) main.prepend(h('div', { class: 'mcline' }, h('div', { class: 'mch' }, '🎤 읽어 주세요'), h('div', { class: 'mct' }, S.mc)));
  if (isHost() && S.phase === 'play') main.append(h('div', { class: 'hostbar' },
    S.undo ? h('button', { class: 'btn' + (Date.now() - undoArm < 4000 ? ' armed' : ''), onclick: () => { if (Date.now() - undoArm < 4000) { undoArm = 0; send({ op: 'undo' }); return; } undoArm = Date.now(); render(); setTimeout(render, 4100); } }, Date.now() - undoArm < 4000 ? '↩️ 한 번 더 누르면 되돌려요' : '↩️ 방금 기록 되돌리기') : null,
    h('button', { class: 'btn', onclick: () => send({ op: 'pause', on: !S.paused }) }, S.paused ? '▶ 계속하기' : '⏸️ 잠시 멈춤'),
    h('button', { class: 'btn', onclick: () => send({ op: 'mute' }) }, '🔊 소리')));
  if (isHost() && S.phase === 'play') {
    const left = S.mcLeft == null ? 3 : S.mcLeft, ok = !!S.roll && left > 0 && !S.paused;
    const EV = [['cheers', '🍻 다 같이 건배'], ['boost', '🚀 꼴찌 팀 1칸 앞으로'], ...(S.juru ? [] : [['pass', '🛡️ 꼴찌 팀 면제권 +1']]), ['lucky', '🎰 행운의 팀 1칸 앞으로']];
    main.append(h('div', { class: 'panel mcev' }, h('p', { class: 'sec', style: 'margin:0 0 6px' }, `🎁 깜짝 이벤트 · 남은 ${left}번`),
      h('div', { class: 'mcgrid' }, EV.map(([k, l]) => h('button', { class: 'btn', disabled: !ok, onclick: () => { send({ op: 'mcev', ev: k }); try { buzz(40); } catch (e) {} } }, l))),
      h('p', { class: 'small muted', style: 'margin:6px 0 0' }, left <= 0 ? '이번 판 이벤트를 다 썼어요' : ok ? '분위기 처질 때 하나 눌러 주세요 · 게임판에 크게 떠요' : '주사위 굴릴 차례일 때 누를 수 있어요')));
  }

  if (S.modal) {
    const tb = main.querySelector('.tapbig') || [...main.querySelectorAll('.panel button:not([disabled]), .panel input:not([disabled])')].find((b) => !/다른 조건/.test(b.textContent || ''));
    const k = S.mseq + ':' + (tb ? (tb.className + tb.textContent).slice(0, 40) : '');
    if (tb && k !== lastScrollK) {
      lastScrollK = k;
      const all = [...main.querySelectorAll('.panel button:not([disabled]), .panel input:not([disabled]), .tapbig')].filter((b) => !/다른 조건|잠시 멈춤/.test(b.textContent || '') && !b.closest('.cheers'));
      const lastC = all.length ? all[all.length - 1] : tb, r0 = tb.getBoundingClientRect(), r1 = lastC.getBoundingClientRect();
      if (r1.bottom > innerHeight - 10 || r0.top < 0) { const top = scrollY + r0.top, bot = scrollY + r1.bottom; const want = bot - top < innerHeight - 40 ? bot - innerHeight + 30 : top - 20; scrollTo({ top: Math.max(0, want), behavior: 'smooth' }); }
    }
  }
  if (S.drink && lastDrinkScroll !== S.drink.h + (S.drink.l || []).join()) { lastDrinkScroll = S.drink.h + (S.drink.l || []).join(); const dp = main.querySelector('.drinkPanel'); if (dp) setTimeout(() => dp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30); }
  renderTeams();
}

let lastReAsk = '', lastScrollK = '', lastDrinkScroll = '', extrasOpen = false, quizOpen = false;

function restChip(t, n, pd) {
  const out = !!(t.out && t.out[n]);
  return h('button', {
    class: 'chip' + (pd[n] ? ' d' : '') + (out ? ' rest' : ''), type: 'button',
    onclick: () => {
      const on = !out;
      if (on && (t.mem || '').split(/[\s,]+/).filter(Boolean).every((m) => m === n || (t.out && t.out[m]))) { if (!confirmRest(n)) return; }
      send({ op: 'rest', ti: t.i, m: n, on }); t.out = t.out || {}; if (on) t.out[n] = 1; else delete t.out[n]; renderTeams();
    }
  }, `${out ? '😴 ' : ''}${n}${pd[n] ? ` ${S.juru ? '🍻' : '🥃'}${pd[n]}` : ''}${!S.juru && t.mpass && t.mpass[n] ? ` 🛡️${t.mpass[n]}` : ''}${!S.juru && t.mshards && t.mshards[n] ? ` 🧩${t.mshards[n]}` : ''}${out ? ' 쉬는 중' : ''}`);
}
let restArm = 0, restOpen = false;
const alertMsg = (t) => phoneFx({ t, k: 'info', teams: [] });
function confirmRest(n) { const now = Date.now(); if (now - restArm < 4000) { restArm = 0; return true; } restArm = now; alertMsg(`${n}까지 쉬면 팀 전원 쉬기 → 👻 유령 팀으로 전환됩니다! 한 번 더 누르면 적용`); return false; }

function drinkGauge(t) {
  const lim = t.lim || S.cap || 0, n = t.drinks || 0;
  if (S.juru || !lim) return h('span', {}, S.juru ? `🍻 ${n}잔` : `🥃 한 잔 ${n}`);
  const left = lim - n, g = h('span', { class: 'gauge' + (left <= 1 ? ' hot' : left <= 2 ? ' warm' : '') }, h('span', { class: 'gl' }, `🥃 ${n}/${lim}`));
  const bar = h('span', { class: 'gb' }); for (let k = 0; k < lim; k++) bar.append(h('i', { class: k < n ? 'on' : '' })); g.append(bar); return g;
}
function shields(n, big, sh) {
  if (S.juru) return null; n = n || 0; sh = sh || 0;
  const shTxt = sh ? ` 🧩${sh}/4` : '';
  if (!n && !sh) return big ? h('span', { class: 'shd zero' }, '🛡️ 0') : null;
  if (!n && sh) return h('span', { class: 'shd' }, `🛡️ 0${shTxt}`);
  return h('span', { class: 'shd' }, '🛡️'.repeat(Math.min(n, 4)) + (n > 4 ? `+${n - 4}` : '') + shTxt, n >= 2 ? h('span', { class: 'rf' }, big ? '🔁 반사 가능' : '🔁') : null);
}
function raceTrack() {
  const G = Math.max(1, S.goal || 3) * 24, ts = (S.teams || []);
  const tr = h('div', { class: 'race' }, h('span', { class: 'rs' }, '출발'), h('span', { class: 're' }, '🏁'));
  const lane = h('div', { class: 'lane' }); tr.append(lane);
  const pos = ts.map((t) => ({ t, p: Math.min(1, ((t.laps || 0) * 24 + (t.pos || 0)) / G) }));
  let mo = 0; const placed = [];
  pos.forEach(({ t, p }) => {
    let same = 0; while (placed.some((o) => o.l === same && Math.abs(o.p - p) < 0.17)) same++;
    placed.push({ p, l: same }); mo = Math.max(mo, same);
    lane.append(h('span', { class: 'rd' + (t.i === me.team ? ' me' : '') + (t.i === S.cur ? ' cur' : ''), style: `left:${(p * 100).toFixed(1)}%;--c:${t.color};--o:${same}`, title: t.name }, t.name.slice(0, 2)));
  });
  tr.style.paddingTop = (32 + mo * 22) + 'px'; return tr;
}

function renderTeams() {
  const tb = $('teams'); tb.innerHTML = '';
  if (S.phase === 'setup') {
    (S.teams || []).forEach((t) => tb.append(h('div', { class: 'tm' + (t.i === me.team ? ' me' : ''), style: `--c:${t.color}` }, h('b', {}, t.name), h('br'), h('span', { class: 'small muted' }, S.solo ? (t.i === me.team ? '나' : '') : (t.mem ? `👥 ${t.mem.split(/[\s,]+/).filter(Boolean).length}명 · ${t.mem}` : '멤버 아직 없음')), isHost() ? phoneLine(t.i) : null)));
    return;
  }
  if (S.phase === 'play' && (S.teams || []).length > 1) tb.append(raceTrack());
  const myT = !isHost() && me.team != null ? S.teams[me.team] : null;
  if (myT) {
    const pd = myT.pd || {}, mem = (myT.mem || '').split(/[\s,]+/).filter(Boolean);
    const left = myT.lim ? Math.max(0, myT.lim - myT.drinks) : null;
    tb.append(h('div', { class: 'myteam', style: `--c:${myT.color}` },
      h('div', { class: 'mt-h' }, h('b', {}, `🏠 ${myT.facInfo ? myT.facInfo.e + ' ' : ''}${myT.name}`, myT.i === S.cur && S.phase === 'play' ? h('span', { class: 'turnb' }, '🎲 차례') : null), h('span', {}, myT.cell ? `📍 ${myT.cell}` : '')),
      myT.facInfo ? h('div', { class: 'small', style: 'margin:2px 0 6px;color:#e2571e;font-weight:800' }, `🏷️ ${myT.facInfo.nick}${S.facOn ? ' · ' + myT.facInfo.desc : ''}`) : null,
      h('div', { class: 'mt-s' },
        h('span', {}, `🏁 ${Math.min(myT.laps, S.goal)}/${S.goal}바퀴`),
        myT.lost ? h('span', {}, '👻 유령 모드') : drinkGauge(myT),
        (!S.juru && !S.solo && myT.mpass && me.nick)
          ? h('span', { class: 'shd' }, `🛡️ 내 면제권 ${myT.mpass[me.nick] || 0}개${myT.mshards && myT.mshards[me.nick] ? ` (🧩${myT.mshards[me.nick]}/4)` : ''} · 팀 합계 ${myT.pass || 0}`)
          : shields(myT.pass, true, myT.shards),
        left != null && !myT.lost && left <= 2 ? h('span', { class: 'warn' }, `⚠️ ${left}번 더 걸리면 탈락`) : null),
      (() => {
        const myName = me.nick || (S.solo ? myT.name : '');
        const st = myName && myT.pstats && myT.pstats[myName];
        if (!st) return null;
        const badges = [];
        if (st.react) badges.push(`⚡ 최고 ${st.react}ms`);
        if (st.tap) badges.push(`👆 연타 ${st.tap}회`);
        if (st.sw != null) badges.push(`🎯 오차 ${st.sw.toFixed(2)}초`);
        if (st.bet) badges.push(`🔮 예측 ${st.bet}적중`);
        if (!badges.length) return null;
        return h('div', { class: 'small', style: 'margin-top:6px;padding:4px 8px;border-radius:8px;background:rgba(226,87,30,.1);color:#e2571e;font-weight:800' }, `🏅 ${myName} 개인 기록: ${badges.join(' · ')}`);
      })(),
      mem.length ? h('div', { class: 'mt-m' }, mem.map((n) => restChip(myT, n, pd))) : null,
      mem.length > 1 && !S.solo && S.phase === 'play' ? h('div', { class: 'mt-hint' }, '😴 이름을 누르면 쉬기 ↔ 복귀') : null));
  }
  if (isHost() && S.phase === 'play') {
    (S.teams || []).forEach((t) => {
      const arr = (S.phones || {})[String(t.i)] || [], f = (S.forced || []).includes(t.i), on = arr.some((x) => x.on);
      tb.append(h('div', { class: 'tmrow' + (t.i === S.cur ? ' cur' : ''), style: `--c:${t.color}` },
        h('b', {}, t.name, t.i === S.cur ? h('span', { class: 'turnb' }, '🎲') : null),
        h('span', {}, `🏁${Math.min(t.laps, S.goal)}/${S.goal}${t.fin ? ' 골인' : ''}`),
        S.juru ? h('span', {}, `🍻${t.drinks}`) : (t.lost ? h('span', {}, '👻유령') : drinkGauge(t)),
        shields(t.pass, false, t.shards),
        h('span', { class: 'pst ' + (f ? 'f' : on ? 'on' : arr.length ? 'off' : 'none') }, f ? '⏭️ 대신 중' : on ? `📱${arr.filter((x) => x.on).length}` : arr.length ? '📵' : '폰 없음'),
        (on || f) ? h('button', { class: 'btn tko', onclick: () => send({ op: 'takeover', ti: t.i, on: !f }) }, f ? '돌려주기' : '대신') : null));
    });
    const anyMem = (S.teams || []).some((t) => (t.mem || '').trim());
    if (anyMem && !S.solo) {
      const rd = h('details', { class: 'extras' }, h('summary', {}, '😴 팀원 쉬기 관리'), ...(S.teams || []).filter((t) => (t.mem || '').trim()).map((t) => h('div', { class: 'mt-m hostrest', style: `border-left:5px solid ${t.color};padding-left:8px;margin:6px 0` }, h('b', { style: 'margin-right:6px' }, t.name), (t.mem || '').split(/[\s,]+/).filter(Boolean).map((n) => restChip(t, n, t.pd || {})))));
      if (restOpen) rd.open = true; rd.ontoggle = () => { restOpen = rd.open; }; tb.append(rd);
    }
    return;
  }
  if (!isHost()) {
    (S.teams || []).filter((t) => !myT || t.i !== myT.i).forEach((t) => tb.append(h('div', { class: 'tmrow' + (t.i === S.cur && S.phase === 'play' ? ' cur' : ''), style: `--c:${t.color}` },
      h('b', {}, `${t.facInfo ? t.facInfo.e + ' ' : ''}${t.name}`, t.facInfo ? h('span', { class: 'small muted', style: 'font-weight:600;margin-left:4px' }, `(${t.facInfo.nick})`) : null, t.i === S.cur && S.phase === 'play' ? h('span', { class: 'turnb' }, '🎲') : null),
      h('span', {}, `🏁${Math.min(t.laps, S.goal)}/${S.goal}${t.fin ? ' 골인' : ''}`),
      S.juru ? h('span', {}, `🍻${t.drinks}${t.fire ? '🔥'.repeat(t.fire) : ''}`) : (t.lost ? h('span', {}, '👻유령') : drinkGauge(t)),
      shields(t.pass, false, t.shards), t.island ? h('span', {}, '🏝️') : null)));
    return;
  }
}

const phoneTxt = (arr) => {
  if (!arr || !arr.length) return '📱 폰 없음 (진행폰이 대신)';
  const on = arr.filter((x) => x.on), nm = on.map((x) => x.nick ? x.nick + (S.phase === 'setup' && x.ready && !x.sub ? '✅' : '') : '').filter(Boolean);
  if (!on.length) return '📱 신호 끊김 (진행폰이 대신)';
  return `📱 ${nm.length ? nm.join('·') + (on.length > nm.length ? ` 외 ${on.length - nm.length}대` : '') : on.length + '대'} 접속` + (arr.length > on.length ? ` · ${arr.length - on.length}대 끊김` : '');
};
function phoneLine(i) {
  const arr = (S.phones || {})[String(i)] || [], f = (S.forced || []).includes(i), on = arr.some((x) => x.on);
  const st = f ? '⏭️ 진행폰이 대신 하는 중' : phoneTxt(arr);
  const wrap = h('div', { class: 'small', style: `margin-top:4px;font-weight:700;color:${f ? '#B7791F' : on ? '#13A36B' : '#8a96a3'}` }, st);
  if (S.phase === 'play' && (on || f)) wrap.append(' ', h('button', { class: 'btn', style: 'font-size:12px;min-height:0;padding:3px 8px;margin-top:4px', onclick: () => send({ op: 'takeover', ti: i, on: !f }) }, f ? '📱 돌려주기' : '⏭️ 대신 하기'));
  return wrap;
}

function readyBtn() {
  const b = h('button', { class: 'big' + (me.ready ? ' on' : ''), style: `width:100%;margin-top:12px;${me.ready ? 'background:#13A36B;color:#fff' : ''}` }, me.ready ? '✅ 준비 완료! (누르면 취소)' : '✋ 준비 완료 누르기');
  b.onclick = () => { me.ready = !me.ready; hello(); b.textContent = me.ready ? '✅ 준비 완료! (누르면 취소)' : '✋ 준비 완료 누르기'; b.style.background = me.ready ? '#13A36B' : ''; b.style.color = me.ready ? '#fff' : ''; try { buzz(30); } catch (e) {} };
  return b;
}
function startBtn() {
  return h('button', { class: 'btn', style: 'width:100%;margin-top:8px', onclick: () => { if (!me.ready) { me.ready = true; hello(); } send({ op: 'start' }); try { buzz(30); } catch (e) {} } }, '🚀 게임 시작 (모두 준비되면)');
}

function memberSetupView(main, myT) {
  main.innerHTML = '';
  const mem = (myT.mem || '').split(/[\s,]+/).filter(Boolean);
  main.append(h('div', { class: 'panel', style: `border-top:6px solid ${myT.color}` },
    h('div', { class: 'disp', style: 'font-size:24px;text-align:center' }, `${myT.name} · ${me.nick}`),
    h('p', { class: 'wait' }, '✅ 팀원으로 합류 완료!\n팀장이 준비 완료를 누르고 게임이 시작될 때까지 기다려 주세요.'),
    mem.length ? h('p', { class: 'small muted', style: 'text-align:center' }, `현재 팀원: ${mem.join(', ')}`) : null));
}

let setupEd = null, setupTm = 0;
function setupView(main, myT) {
  const solo = !!S.solo;
  if (!setupEd || setupEd.team !== me.team || setupEd.solo !== solo || !main.contains(setupEd.el)) {
    const nm = h('input', { type: 'text', maxlength: solo ? 8 : 10, placeholder: solo ? '내 이름' : '팀 이름 (예: 피트파)', 'aria-label': solo ? '내 이름' : '팀 이름' });
    const mem = solo ? null : h('textarea', { rows: 3, maxlength: 80, placeholder: '팀원 이름을 띄어쓰기로, 나도 포함 (예: 지수 민호 하늘)', 'aria-label': '팀 멤버' });
    const cnt = h('p', { class: 'small muted', style: 'margin:4px 0 0' });
    const ok = h('p', { class: 'small', style: 'margin:8px 0 0;color:#13A36B;font-weight:700;min-height:1.3em' });
    const push = () => { if (setupEd) setupEd.last = Date.now(); clearTimeout(setupTm); setupTm = setTimeout(() => { send({ op: 'team', name: nm.value, mem: mem ? mem.value : '' }); ok.textContent = '✓ 게임판에 반영됐어요'; }, 350); ok.textContent = ''; upd(); };
    const upd = () => { if (mem) { const n = mem.value.split(/[\s,]+/).filter(Boolean).length; cnt.textContent = n ? `👥 등록된 멤버 ${n}명 · 선수 자동 로테이션` : '멤버를 적으면 미션마다 앱이 선수를 골라줘요 (생략 가능)'; } };
    nm.oninput = push;
    if (mem) mem.oninput = () => { push(); if (nk && !nk.dataset.touched) { const f = mem.value.split(/[\s,]+/).filter(Boolean)[0] || ''; if (f !== nk.value) { nk.value = f.slice(0, 8); me.nick = nk.value; save(); clearTimeout(nk._t); nk._t = setTimeout(hello, 400); } } };
    nm.value = myT.name; if (mem) mem.value = myT.mem || '';
    const nk = solo ? null : h('input', { type: 'text', maxlength: 8, placeholder: '팀장 이름 (예: 지수)', 'aria-label': '이 폰을 든 사람 이름' });
    if (nk) { nk.value = me.nick || ''; nk.oninput = () => { nk.dataset.touched = '1'; me.nick = nk.value.trim().slice(0, 8); save(); clearTimeout(nk._t); nk._t = setTimeout(hello, 400); }; }
    if (solo) { me.nick = ''; save(); }
    const facSel = (S.factions && S.factions.length) ? h('select', {
      style: 'width:100%;font:inherit;font-size:15px;padding:10px;border-radius:12px;border:2px solid var(--tarp);background:var(--bg);color:var(--ink);font-weight:700;margin-top:4px',
      onchange: (e) => {
        const fid = e.target.value;
        const f = (S.factions || []).find((x) => x.id === fid);
        if (f && !nm.value.trim()) nm.value = f.name.slice(0, solo ? 8 : 10);
        send({ op: 'team', name: nm.value, mem: mem ? mem.value : '', fac: fid });
        ok.textContent = '✓ 파벌 캐릭터가 반영됐어요';
      }
    }, [
      h('option', { value: '' }, '🎭 주종별 파벌 캐릭터 선택 (별칭·능력)'),
      ...S.factions.map((f) => h('option', { value: f.id, selected: myT.fac === f.id }, `${f.e} ${f.name} (${f.nick}) · ${f.passive}`))
    ]) : null;
    const curFac = (S.factions || []).find((x) => x.id === myT.fac);
    const facDesc = curFac ? h('div', { class: 'small', style: 'margin-top:6px;padding:8px 10px;border-radius:10px;background:rgba(226,87,30,.1);color:#e2571e;font-weight:700' }, `${curFac.e} 별칭: ${curFac.nick} · 능력: ${curFac.desc}`) : null;
    const el = h('div', { class: 'panel setupEd' }, h('p', { class: 'sec' }, solo ? '✏️ 내 이름' : '✏️ 우리 팀 이름'), nm,
      facSel ? h('p', { class: 'sec', style: 'margin-top:12px' }, '🎭 주종 파벌 캐릭터 (별칭 · 고유 능력)') : null, facSel, facDesc,
      mem ? h('p', { class: 'sec', style: 'margin-top:12px' }, '👥 팀원 이름 (직접 적거나 팀원이 폰으로 합류하면 자동 추가)') : null, mem, cnt,
      nk ? h('p', { class: 'sec', style: 'margin-top:12px' }, '👑 팀장 (이 폰)') : null, nk, ok, readyBtn(), startBtn(), h('p', { class: 'small muted', style: 'margin:6px 0 0;text-align:center' }, '다 모이면 게임판이나 아래 ‘🚀 게임 시작’으로 시작해요'));
    main.innerHTML = ''; main.append(el);
    setupEd = { el, nm, mem, team: me.team, solo, last: 0 }; upd();
    return;
  }
  const E = setupEd, typing = document.activeElement === E.nm || document.activeElement === E.mem || document.activeElement === (E.el.querySelector('input[aria-label="이 폰을 든 사람 이름"]')) || Date.now() - (E.last || 0) < 2000;
  if (!typing) {
    if (E.nm.value !== myT.name && (myT.name || '').trim()) E.nm.value = myT.name;
    if (E.mem && E.mem.value.trim() !== (myT.mem || '').trim()) E.mem.value = myT.mem || '';
  }
}

const oxPick = {};
function cardView(m) {
  const p = h('div', { class: 'panel' });
  const myT0 = !isHost() && S.teams && S.teams[me.team];
  if (myT0 && myT0.smoked > 0) {
    p.classList.add('smoked-card');
    p.append(h('div', { style: 'background:#1e242a;color:#ffd84d;padding:12px;border-radius:12px;text-align:center;font-weight:800;margin-bottom:8px;border:2px solid #ffd84d' }, '🌫️ 피트 연막탄 중독! 내 차례 주사위를 굴릴 때까지 화면이 흐려집니다!'));
  }
  const isGoldCard = /황금카드/.test(m.who || '') || m.e === '🃏';
  p.append(h('div', { class: 'who', style: isGoldCard ? 'color:#d99b00;font-weight:800' : '' }, isGoldCard ? '✨ 황금카드 · ' + (m.who || '') : m.who), h('div', { class: 'card-e' }, m.e), h('div', { class: 'card-t', style: isGoldCard ? 'color:#b87d00' : '' }, m.t));

  let amISelected = false, otherMemberSelected = '';
  if (!isHost() && S.teams && S.teams[me.team]) {
    const myT = S.teams[me.team];
    const txt = (m.pl || '') + ' ' + (m.d || '') + ' ' + (m.x || '');
    const members = (myT.mem || '').split(/[\s,]+/).filter(Boolean);
    const ppl = members.filter((n) => n && txt.includes(n));
    if (ppl.length && !/전원/.test(m.x || '')) {
      if (me.nick && ppl.includes(me.nick)) {
        amISelected = true;
        p.append(h('div', { class: 'involve' }, `🙋 내가 나갈 차례예요! (${me.nick}) 직접 눌러 주세요!`));
      } else {
        otherMemberSelected = ppl.join('·');
        p.append(h('div', { class: 'involve soft' }, `👀 우리 팀 ${otherMemberSelected} 선수가 플레이 중!${!me.sub ? ' (팀장 백업 조작 가능)' : ''}`));
      }
    } else if (S.cur !== me.team && (txt.includes(myT.name) || (m.who || '').includes(myT.name))) {
      p.append(h('div', { class: 'involve soft' }, '🙋 우리 팀도 걸린 미션이에요'));
    }
  }

  if (m.pl) p.append(h('div', { class: 'txt cap pl', style: 'font-weight:800;text-align:center;margin:6px 0' }, m.pl));
  {
    const game = !isHost() && !!(m.q || (m.box || []).length);
    if (m.d && !game) p.append(h('div', { class: 'card-d' }, m.d));
    if (isHost()) { if (m.x) p.append(h('div', { class: 'card-x' }, m.x)); }
    else if ((game && m.d) || m.x) p.append(h('details', { class: 'cardmore' }, h('summary', {}, game ? 'ℹ️ 미션 설명 보기' : 'ℹ️ 자세히'), game && m.d ? h('div', { class: 'card-d' }, m.d) : null, m.x ? h('div', { class: 'card-x' }, m.x) : null));
  }
  if (m.reroll && (isHost() || sub())) p.append(h('div', { style: 'text-align:center;margin-top:6px' }, h('button', { class: 'btn', style: 'font-size:13px;min-height:0;padding:6px 10px', onclick: () => send({ op: 'click', rid: m.reroll }) }, '🎲 다른 조건으로')));
  if (m.q) p.append(h('div', { class: 'oxq' }, m.q));
  let acted = false;

  // 🤫 소수결 눈치 게임
  if (m.minority && !isHost() && me.team != null) {
    const M = JSON.parse(m.minority);
    if (M.teams.includes(me.team)) {
      if (!local.min || local.min.seq !== M.seq) local.min = { seq: M.seq, pick: null };
      const box = h('div', { style: 'margin:10px 0;text-align:center' },
        h('p', { class: 'sec' }, S.juru ? '🤫 남몰래 숫자 선택 (최소 선택 팀 🍻한 잔!)' : '🤫 남몰래 숫자 선택 (최다 한 잔 / 최소 🧩조각+1!)'),
        h('div', { class: 'choice', style: 'grid-template-columns:repeat(3,1fr)' }, [1, 2, 3].map((v) =>
          h('button', {
            class: 'btn' + (local.min.pick === v ? ' on' : ''),
            style: 'font-size:28px;min-height:68px',
            disabled: local.min.pick != null,
            onclick: () => { local.min.pick = v; send({ op: 'minority', v }); render(); }
          }, String(v))
        )),
        local.min.pick != null ? h('p', { class: 'small', style: 'color:#13A36B;font-weight:700;margin-top:6px' }, `✅ ${local.min.pick}번 선택 완료! 공개를 기다리세요`) : null
      );
      p.append(box); acted = true;
    }
  }

  // 💣 전원 시한폭탄 돌리기
  if (m.timebomb && !isHost() && me.team != null) {
    const TB = JSON.parse(m.timebomb);
    const iHold = TB.holder === me.team;
    const box = h('div', { style: `margin:10px 0;padding:14px;border-radius:16px;text-align:center;${iHold ? 'background:#d62828;color:#fff' : 'background:var(--bg)'}` });
    if (iHold) {
      try { buzz([120, 60, 120]); } catch (e) {}
      box.append(
        h('div', { class: 'disp', style: 'font-size:28px;margin-bottom:6px' }, '💣 내 손에 폭탄이!! 빨리 넘기세요!'),
        h('div', { class: 'choice' }, (S.teams || []).filter((t) => TB.teams.includes(t.i) && t.i !== me.team).map((t) =>
          h('button', { class: 'btn', style: 'background:#fff;color:#1d2b33;border:0', onclick: () => send({ op: 'passbomb', to: t.i }) }, `💣 ${t.name}에게 던지기`)
        ))
      );
    } else {
      const hTeam = S.teams && S.teams[TB.holder];
      box.append(h('div', { class: 'disp', style: 'font-size:22px' }, TB.blind ? '❓ 암전! 어디에 폭탄이 있을까?!' : `💣 현재 폭탄: ${hTeam ? hTeam.name : ''}`));
    }
    p.append(box); acted = true;
  }

  // 🔐 릴레이 암호 해독
  if (m.relay && !isHost() && me.team != null) {
    const RL = JSON.parse(m.relay);
    const code = RL.codes && RL.codes[me.team];
    if (code) {
      const seat = m.relaySeats && m.relaySeats[tagOf(me.pid)] != null ? m.relaySeats[tagOf(me.pid)] : 1;
      const box = h('div', { style: 'margin:10px 0;padding:12px;border-radius:14px;background:var(--bg);text-align:center' });
      if (!me.sub) {
        // 팀장: 입력 패드 + 본인의 첫 번째 힌트 숫자
        const d1 = code[0];
        const inp = h('input', { type: 'text', maxlength: 4, inputMode: 'numeric', placeholder: '4자리 암호 입력', style: 'text-align:center;font-size:24px;letter-spacing:6px;margin-top:8px' });
        const subBtn = h('button', { class: 'big', style: 'margin-top:8px', onclick: () => { if (inp.value.trim().length === 4) { send({ op: 'relay', code: inp.value.trim() }); inp.value = ''; } } }, '🔓 암호 해독 제출');
        box.append(
          h('p', { class: 'sec' }, '👑 팀장 화면 · 팀원들에게 숫자를 물어보세요!'),
          h('div', { style: 'font-size:18px;font-weight:800;color:#e2571e' }, `내 힌트: 첫 번째 자리 = [ ${d1} ]`),
          inp, subBtn
        );
      } else {
        // 팀원: 자기 순번에 해당하는 암호 자리 표시
        const pos = Math.max(1, seat % 4);
        const digit = code[pos];
        const ordTxt = ['첫 번째', '두 번째', '세 번째', '네 번째'][pos];
        box.append(
          h('p', { class: 'sec' }, '🙋 팀장에게 내 숫자를 큰 소리로 외치세요!'),
          h('div', { class: 'disp', style: 'font-size:44px;color:#e2571e;margin:8px 0' }, `${ordTxt}: ${digit}`)
        );
      }
      p.append(box); acted = true;
    }
  }

  // 🔮 구경꾼 승자 예측 베팅 (1:1 대결 중 참여하지 않은 나머지 팀/개인)
  if (m.bets && !isHost() && me.team != null && !m.bets.includes(me.team)) {
    const [tA, tB] = m.bets.map((i) => S.teams && S.teams[i]).filter(Boolean);
    if (tA && tB) {
      if (!local.bet || local.bet.seq !== S.mseq) local.bet = { seq: S.mseq, pick: null };
      p.append(h('div', { class: 'passpick', style: 'margin-top:10px' },
        h('p', { class: 'sec' }, '🔮 승자 예측 (적중 시 🧩 방패 조각 +1 · 4개 모이면 🛡️ 면제권!)'),
        h('div', { class: 'choice' }, [tA, tB].map((tm) =>
          h('button', {
            class: 'btn' + (local.bet.pick === tm.i ? ' on' : ''),
            style: `border-color:${tm.color};border-width:3px`,
            disabled: local.bet.pick != null,
            onclick: () => { local.bet.pick = tm.i; send({ op: 'bet', pick: tm.i }); render(); }
          }, `🏆 ${tm.name} 승`)
        )),
        local.bet.pick != null ? h('p', { class: 'small', style: 'text-align:center;color:#13A36B;font-weight:700;margin:6px 0 0' }, '✅ 예측 완료! 결과를 지켜보세요') : null
      ));
      acted = true;
    }
  }

  if (m.tap && !isHost() && m.tap.split(',').includes(String(me.team))) {
    if (!local.tap) { local.tap = { n: 0, q: 0 }; local.tapIv = setInterval(() => { if (local.tap && local.tap.q) { send({ op: 'tap', n: local.tap.q }); local.tap.q = 0; } }, 200); }
    const L = local.tap; const cnt = h('div', { class: 'txt big-num' }, String(L.n));
    const pad = h('button', { class: 'tapbig' }, '👆 연타!');
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); L.n++; L.q++; cnt.textContent = String(L.n); try { buzz(8); } catch (er) {} });
    p.append(h('p', { class: 'sec' }, '5초! 내 폰에서 최대한 많이 누르세요'), cnt, pad); acted = true;
  } else if (local.tap) { if (local.tap.q) send({ op: 'tap', n: local.tap.q }); clearInterval(local.tapIv); local.tap = null; }

  const canPlayerControl = !me.sub || amISelected || !otherMemberSelected;

  if (m.sw && canTeamAct() && canPlayerControl) { p.append(stopwatchView(+m.sw, +m.swh || 0)); acted = true; }
  else if (m.sw) p.append(h('p', { class: 'wait' }, `⏱️ ${otherMemberSelected || '선수'}가 폰으로 재는 중! 게임판을 보세요`));
  else if (m.react2 && !isHost() && JSON.parse(m.react2).t.includes(me.team) && canPlayerControl) { p.append(react2View(JSON.parse(m.react2))); acted = true; }
  else if (m.react) {
    if (isHost() || sub()) { p.append(reactView(JSON.parse(m.react))); acted = true; }
    else p.append(h('p', { class: 'wait' }, '⚡ 순발력 대결 중! 게임판을 보세요'));
  } else local.sw = null;
  if (!m.react) local.react = null;

  const skipLocal = (b) => (m.sw && /시작|멈춤/.test(b.label)) || (m.react && (b.cls || '').includes('react-pad') || (m.react && /판 시작/.test(b.label)));
  let jNote = false, prevIn = false;
  for (const b of m.box) {
    const afterIn = prevIn; prevIn = b.k === 'in';
    if (afterIn && b.k === 'btn' && /^(입력|확인|제출)$/.test(b.label)) continue;
    if (b.k === 'txt') { if (m.sw && canTeamAct() && /big-num/.test(b.cls || '')) continue; if (!(m.react && /react/.test(b.cls))) p.append(h('div', { class: 'txt ' + (b.cls || '') }, b.text)); continue; }
    const okMine = b.j && !isHost() ? (!S.hostOn && me.team != null && (S.judge === me.team || (S.judge === -1 && (S.judgeAll || []).includes(me.team)))) : mine(b.teams);
    if (b.j && !okMine && !isHost() && !S.hostOn && S.judge === -2 && !jNote) { jNote = true; p.append(h('p', { class: 'sec' }, '⚖️ 판정할 다른 팀 폰이 없어요 · 게임판에서 다 같이 보고 눌러요')); }
    if (!okMine || skipLocal(b)) continue;
    if (!acted && !isHost()) p.append(h('p', { class: 'sec' }, b.j ? (S.judge === -1 ? ((S.jv || []).includes(me.team) ? '⚖️ 우리 팀은 골랐어요 · 상대 팀도 같은 답을 고르면 정해져요' : '⚖️ 두 팀이 같은 답을 골라야 정해져요 · 다 같이 보고 눌러요') : '⚖️ 진행폰 연결 없이도 우리 팀이 판정해요 · 다 같이 보고 눌러요') : '👇 우리 팀이 눌러요'));
    acted = true;
    if (b.k === 'btn') p.append(h('div', { style: 'margin:6px 0' }, h('button', { class: 'btn ' + (b.cls || '').replace(/ghost|cbtn|btn fill/g, '').replace(isHost() ? /selO|selX/g : /$^/, '') + (oxPick[S.mseq + ':' + b.teams] === b.rid ? ' selO' : ''), style: 'width:100%', disabled: b.dis, onclick: () => { if (/^[⭕❌]$/.test(b.label)) { oxPick[S.mseq + ':' + b.teams] = b.rid; } send({ op: 'click', rid: b.rid }); } }, b.label.replace(/👉 (.+?) 대표에게 폰 넘기기/, '👉 $1 선택하기'))));
    else if (b.k === 'grid') p.append(h('div', { class: 'grid' }, b.btns.map((x) => h('button', { class: 'btn', disabled: x.dis, onclick: () => send({ op: 'click', rid: x.rid }) }, x.label))));
    else if (b.k === 'in') {
      const i = h('input', { type: 'text', placeholder: b.ph, disabled: b.dis, enterkeyhint: 'done', autocomplete: 'off' }); i.dataset.rid = b.rid;
      i.value = drafts[b.rid] || '';
      i.oninput = () => { drafts[b.rid] = i.value; };
      i.onfocus = () => { focusRid = b.rid; }; i.onblur = () => { if (focusRid === b.rid) focusRid = null; };
      if (focusRid === b.rid) setTimeout(() => { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0);
      const go = () => { if (i.value.trim()) { send({ op: 'fill', rid: b.rid, value: i.value.trim() }); i.value = ''; drafts[b.rid] = ''; } };
      i.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } };
      p.append(i, h('button', { class: 'big', style: 'margin-top:8px', disabled: b.dis, onmousedown: (e) => e.preventDefault(), ontouchstart: () => { tapGo = Date.now(); go(); }, onclick: () => { if (Date.now() - tapGo > 800) go(); } }, '입력'));
    }
  }
  if (m.act && (isHost() || sub())) { p.append(h('div', { style: 'margin:8px 0' }, h('button', { class: 'btn', style: 'width:100%', disabled: m.act.dis, onclick: () => send({ op: 'click', rid: m.act.rid }) }, m.act.label))); acted = true; }
  if (m.timer && (isHost() || sub())) p.append(h('div', { style: 'margin:6px 0' }, h('button', { class: 'btn', style: 'width:100%', onclick: () => send({ op: 'click', rid: m.timer.rid }) }, m.timer.label)));

  if (!isHost() && m.rec) {
    const r = (m.rec.rows || []).find((x) => x.ti === me.team && !x.off);
    const st = r && r.btns.find((b) => b.on);
    const myT_rec = S.teams && S.teams[me.team];
    const isPerMember = !S.solo && !S.juru && myT_rec && myT_rec.mpass && me.nick;
    if (r && st && st.v >= 1 && r.btns.some((b) => b.v >= 2)) {
      if (isPerMember) {
        const myP = myT_rec.mpass[me.nick] || 0;
        const rescueLbl = otherMemberSelected && otherMemberSelected !== me.nick
          ? `🛡️ 내 면제권으로 [${otherMemberSelected}] 대신 막아주기`
          : '🛡️ 내 면제권 쓰기';
        const box = h('div', { class: 'passpick' },
          h('p', { class: 'sec' }, `🛡️ ${otherMemberSelected && otherMemberSelected !== me.nick ? `우리 팀 [${otherMemberSelected}] 원샷 위기!` : '내가 마실 차례!'} (내 면제권: ${myP}개)`),
          myP >= 1
            ? h('div', { class: 'seg' }, [
                h('button', { class: 'btn' + (st.v === 1 ? ' on' : ''), onclick: () => { const b1 = r.btns.find((b) => b.v === 1); if (b1) send({ op: 'click', rid: b1.rid }); } }, '🥃 안 쓸게요'),
                h('button', { class: 'btn' + (st.v === 2 ? ' on' : ''), onclick: () => send({ op: 'usememberpass', v: 2 }) }, rescueLbl),
                myP >= 2 ? h('button', { class: 'btn' + (st.v === 3 ? ' on' : ''), onclick: () => send({ op: 'usememberpass', v: 3 }) }, '🔁 내 면제권 2개로 반사') : null
              ].filter(Boolean))
            : h('p', { class: 'small muted', style: 'text-align:center;margin:4px 0' }, '😢 내 개인 면제권이 없어요! 면제권 있는 팀원에게 살려달라고 부탁해 보세요!'));
        const tg = (m.rec.tgt || []).find((x) => x.ti === me.team);
        if (tg && st.v === 3) box.append(h('p', { class: 'sec' }, '🔁 한 잔 떠넘길 팀'), h('div', { class: 'seg' }, tg.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'usememberpass', v: 3, to: +b.label || S.teams.findIndex((t) => t.name === b.label) }) }, b.label))));
        p.append(box); acted = true;
      } else {
        const box = h('div', { class: 'passpick', style: 'border:2px solid #f2b705;border-radius:14px;padding:10px;background:rgba(242,183,5,.08)' }, h('p', { class: 'sec', style: 'color:#b87d00;font-weight:800' }, '🛡️ 우리 팀이 마실 차례! 면제권 쓸까요?'),
          h('div', { class: 'seg' }, r.btns.filter((b) => b.v >= 1).map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.v === 1 ? '🥃 그냥 마실게요' : b.label === '🛡️ 면제권' ? '🛡️ 면제권 쓰기' : '🔁 반사 (면제권 2개)'))));
        const tg = (m.rec.tgt || []).find((x) => x.ti === me.team);
        if (tg && st.v === 3) box.append(h('p', { class: 'sec' }, '🔁 한 잔 떠넘길 팀'), h('div', { class: 'seg' }, tg.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label))));
        p.append(box); acted = true;
      }
      if (lastPassAsk !== S.mseq) { lastPassAsk = S.mseq; try { buzz([150, 60, 150]); } catch (e) {} }
    }
  }
  if (!isHost() && m.rec && (m.rec.re || []).length) {
    const rr = (m.rec.re || []).filter((x) => x.ti === me.team).pop();
    if (rr) {
      p.append(h('div', { class: 'passpick reflectme' }, h('p', { class: 'sec' }, rr.label),
        h('div', { class: 'seg' }, rr.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label)))));
      acted = true; if (lastReAsk !== S.mseq + ':' + rr.label) { lastReAsk = S.mseq + ':' + rr.label; try { buzz([200, 80, 200, 80, 200]); } catch (e) {} }
    }
  }
  if (isHost()) {
    if (m.rec) {
      const teamPhone = (ti) => ti != null && (S.teamsOn || []).includes(ti);
      const rows = (m.rec.rows || []).filter((r) => !r.off);
      if (rows.length) {
        const sum = h('div', { class: 'recsum' }, rows.map((r) => { const on = r.btns.find((b) => b.on); return h('div', { class: 'rs', style: `--c:${/^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '#888'}` }, h('b', {}, r.name), h('span', {}, on ? on.label : '아직 결과 없음')); }));
        const det = h('details', { class: 'recfix' }, h('summary', {}, '✏️ 결과 고치기 (앱 판정이 틀렸을 때만)'));
        if (recOpen === S.mseq) det.open = true;
        det.addEventListener('toggle', () => { recOpen = det.open ? S.mseq : -1; });
        for (const r of rows) {
          const tp = teamPhone(r.ti), bs = r.btns.filter((b) => !(tp && b.v >= 2));
          const pick = tp && r.btns.some((b) => b.v >= 2) ? h('span', { class: 'small muted' }, (r.btns.find((b) => b.on && b.v >= 2) ? '📱 팀이 ' + r.btns.find((b) => b.on).label + ' 선택' : '📱 면제권은 팀 폰에서')) : null;
          det.append(h('div', { class: 'recrow', style: `--c:${/^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '#888'}` }, h('b', {}, r.name),
            h('div', { class: 'seg' }, bs.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label))), pick));
        }
        for (const r of m.rec.tgt || []) { if (teamPhone(r.ti)) continue; det.append(h('div', { class: 'recrow' }, h('b', {}, r.label), h('div', { class: 'seg' }, r.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label))))); }
        if (m.ok && m.ok.pending) p.append(h('p', { class: 'sec' }, '📋 결과는 미션이 끝나면 나와요'), det);
        else p.append(h('p', { class: 'sec' }, '📋 이번 결과'), sum, det);
      }
    }
    p.append(h('button', { class: 'big' + (m.ok.pending ? ' pending' : ''), style: 'margin-top:12px', onclick: () => send({ op: 'click', rid: m.ok.rid }) }, m.ok.label));
  } else if (sub()) {
    const okShow = !m.ok.pending && !(m.box || []).some((b) => b.k === 'txt' && /rvCd|\brv\b/.test(b.cls || '') && /공개 중|^\d$|공개!/.test(b.text || ''));
    if (okShow) p.append(h('p', { class: 'small muted', style: 'text-align:center;margin:10px 0 0' }, S.cur === me.team ? '🎮 진행폰 연결 없이도 우리 팀이 진행 버튼도 눌러요' : `🎮 진행폰도 ${S.teams[S.cur] ? S.teams[S.cur].name : '차례 팀'} 폰도 없어서 우리 팀이 진행 버튼을 대신 눌러요`));
    const revealing = (m.box || []).some((b) => b.k === 'txt' && /rvCd|\brv\b/.test(b.cls || '') && /공개 중|^\d$|공개!/.test(b.text || ''));
    if (okShow && !revealing) p.append(h('button', { class: 'big', style: 'margin-top:8px', onclick: () => send({ op: 'click', rid: m.ok.rid }) }, m.ok.label));
  } else if (!acted) p.append(h('p', { class: 'wait' }, '👀 지금은 누를 게 없어요. 게임판을 봐 주세요'));
  return p;
}

function pickView() {
  const can = canTeamAct();
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, S.pick.title),
    can ? h('div', { class: 'choice' }, S.pick.opts.map((o) => h('button', { class: 'btn', disabled: o.dis, onclick: () => send({ op: 'pick', rid: o.rid }) }, o.label)))
      : h('p', { class: 'wait' }, '보물상자를 고르는 중…'));
}
function taxiView() {
  const can = canTeamAct();
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, '🚕 어디로 갈까요?'),
    can ? h('div', { class: 'choice' }, S.taxi.cells.map((c) => h('button', { class: 'btn', onclick: () => send({ op: 'taxi', cell: c.i }) }, `${c.i}번 · ${c.label}`)))
      : h('p', { class: 'wait' }, '택시 목적지를 고르는 중…'));
}

let againArm = 0;
function overView() {
  const canAgain = isHost() || (me.team != null && !S.hostOn);
  const againLbl = S.solo ? '같은 사람들로 한 판 더' : '같은 팀으로 한 판 더';
  const againArmLbl = S.solo ? '한 번 더 누르면 같은 사람들로 다시 시작' : '한 번 더 누르면 같은 팀으로 다시 시작';
  const again = canAgain ? h('button', { class: 'big' + (Date.now() - againArm < 4000 ? ' armed' : ''), style: 'width:100%;margin-top:12px', onclick: (e) => { if (Date.now() - againArm < 4000) { againArm = 0; send({ op: 'again' }); e.target.textContent = '⏳ 시작하는 중…'; } else { againArm = Date.now(); e.target.textContent = againArmLbl; setTimeout(() => { if (againArm && Date.now() - againArm >= 4000) render(); }, 4100); } } }, Date.now() - againArm < 4000 ? againArmLbl : '🔁 ' + againLbl) : null;
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, S.over.title), h('p', { class: 'card-d' }, S.over.msg),
    S.over.rep ? h('pre', { style: 'background:var(--bg);border:2px dashed var(--tarp);border-radius:12px;padding:10px;font:inherit;font-size:13px;white-space:pre-wrap;margin:8px 0' }, S.over.rep) : null,
    h('ol', {}, S.over.rows.map((r) => h('li', { style: 'margin:4px 0' }, r))),
    (S.over.aw || []).length ? h('p', { class: 'sec', style: 'margin-top:12px' }, '🏅 오늘의 상') : null,
    ...(S.over.aw || []).map((a) => { const [k, v, why] = a.split('|'); return h('div', { style: 'background:var(--bg);border-radius:12px;padding:8px 12px;margin:6px 0' }, v ? [h('div', { style: 'color:#e2571e;font-weight:800' }, k), h('div', { style: 'font-weight:800;font-size:18px' }, v), why ? h('div', { class: 'small muted' }, why) : null] : k); }), again);
}

function stopwatchView(target, hideAt) {
  if (!local.sw || local.sw.ms !== S.mseq) {
    if (local.sw && local.sw.raf) cancelAnimationFrame(local.sw.raf);
    local.sw = { ms: S.mseq, t0: 0, done: false, txt: '0.00', raf: 0 };
  }
  const L = local.sw;
  const num = h('div', { class: 'txt big-num' }, L.txt);
  const bt = h('button', { class: 'big', disabled: L.done }, L.done ? '기록 완료' : L.t0 ? '■ 멈춤' : '▶ 시작');
  const tick = () => { if (!L.t0 || L.done) return; const e = (performance.now() - L.t0) / 1000; L.txt = hideAt && e >= hideAt ? '?.??' : e.toFixed(2); num.textContent = L.txt; L.raf = requestAnimationFrame(tick); };
  bt.onclick = () => {
    if (!L.t0) { L.t0 = performance.now(); bt.textContent = '■ 멈춤'; tick(); send({ op: 'sw', e: -1 }); return; }
    L.done = true; cancelAnimationFrame(L.raf); const e = (performance.now() - L.t0) / 1000; L.txt = e.toFixed(2) + '초'; num.textContent = L.txt; bt.disabled = true; bt.textContent = '기록 완료';
    send({ op: 'sw', e: Math.round(e * 1000) / 1000 });
  };
  if (L.t0 && !L.done) requestAnimationFrame(tick);
  return h('div', {}, h('p', { class: 'sec' }, `정확히 ${target}.00초에 멈추기! (±0.12초)${hideAt ? ` · ${hideAt}초 뒤 숫자가 사라져요` : ''}`), num, bt);
}

let lastFx = -1;
function phoneFx(f) {
  const mineF = !isHost() && me.team != null && (f.teams || []).includes(me.team);
  let o = $('pfx'); if (!o) { o = h('div', { id: 'pfx' }); document.body.append(o); }
  o.textContent = f.t || ''; o.style.setProperty('--c', /^#[0-9a-f]{3,8}$/i.test(f.c || '') ? f.c : '#e2571e'); o.className = 'on ' + (f.k || '') + (mineF ? ' mine' : '');
  clearTimeout(o._t); o._t = setTimeout(() => { o.className = ''; }, 1600);
  if (mineF) { try { buzz(f.k === 'gain' ? [80, 40, 80] : [200, 80, 200]); } catch (e) {} }
}

let shakeOn = false, shakeAsk = false, lastShake = 0, rollSent = 0;
const doRoll = () => { const n = Date.now(); if (n - rollSent < 1500) return; rollSent = n; send({ op: 'roll' }); try { buzz([40, 30, 40, 30, 80]); } catch (e) {} };
function onMotion(e) {
  const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (Math.abs(g - 9.8) < 14) return;
  const n = Date.now(); if (n - lastShake < 1200) return; lastShake = n;
  if (S && S.roll && canTeamAct() && !isHost()) doRoll();
}
function startShake() { if (shakeOn) return; window.addEventListener('devicemotion', onMotion); shakeOn = true; shakeAsk = false; }
function askShake() { try { DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') startShake(); render(); }).catch(() => { shakeAsk = false; render(); }); } catch (e) { shakeAsk = false; render(); } }
if (typeof DeviceMotionEvent !== 'undefined') { if (typeof DeviceMotionEvent.requestPermission === 'function') shakeAsk = true; else startShake(); }

let r2 = null;
function react2View(R) {
  const key = R.seq + ':' + R.r;
  if (!r2 || r2.key !== key) {
    if (r2) clearTimeout(r2.tm);
    const el = h('div', { class: 'r2' }), msg = h('div', { class: 'r2-msg' }, '🔴 기다리세요…'), pad = h('button', { class: 'r2-pad wait' }, '손가락 대기');
    el.append(h('p', { class: 'sec' }, `⚡ ${R.r}판 · 초록이 되면 누르기!`), msg, pad);
    r2 = { key, el, msg, pad, phase: 'wait', t0: 0, sent: false, tm: 0 };
    const S2 = r2;
    if (R.fake) {
      setTimeout(() => { if (S2.sent || S2.phase !== 'wait') return; pad.style.background = '#2B6CE0'; pad.textContent = '🔵 누르지 마!'; msg.textContent = '🔵 파랑! 함정입니다!'; try { buzz(30); } catch (e) {} }, R.fake);
    }
    S2.tm = setTimeout(() => { if (S2.sent) return; S2.phase = 'go'; S2.t0 = performance.now(); pad.style.background = ''; pad.className = 'r2-pad go'; pad.textContent = '지금!'; msg.textContent = '🟢 지금!'; try { buzz(60); } catch (e) {} }, R.d);
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); if (S2.sent) return; S2.sent = true; clearTimeout(S2.tm);
      if (S2.phase !== 'go') { send({ op: 'react2', r: R.r, ms: -1 }); pad.className = 'r2-pad bad'; pad.textContent = '🚫 부정출발'; msg.textContent = '초록 전에 눌렀어요!'; return; }
      const ms = Math.round(performance.now() - S2.t0); send({ op: 'react2', r: R.r, ms }); pad.className = 'r2-pad done'; pad.textContent = `⚡ ${ms}ms`; msg.textContent = '기록 보냄! 게임판을 봐요';
    });
  }
  return r2.el;
}

function reactView([nA, nB, cA, cB]) {
  if (!local.react || local.react.ms !== S.mseq) local.react = { ms: S.mseq, sc: [0, 0], round: 0, phase: 'idle', t0: 0, tm: 0, msg: '3판 2선승! 준비되면 시작', done: false };
  const R = local.react;
  const wrap = h('div', {});
  const draw = () => {
    wrap.innerHTML = '';
    const stt = h('div', { class: 'rst ' + (R.phase === 'wait' ? 'wait' : R.phase === 'go' ? 'go' : '') }, R.msg);
    const pad = (k, n, c) => h('button', { class: 'pad', style: `--c:${c}`, disabled: R.phase === 'idle' || R.done, onclick: () => hit(k) }, n);
    wrap.append(h('div', { class: 'disp', style: 'text-align:center;font-size:24px' }, `${nA} ${R.sc[0]} : ${R.sc[1]} ${nB}`), stt);
    if (!R.done && R.phase === 'idle') wrap.append(h('button', { class: 'big', style: 'margin:8px 0', onclick: start }, `▶ ${R.round + 1}판 시작`));
    wrap.append(h('div', { class: 'choice', style: 'margin-top:8px' }, pad(0, nA, cA), pad(1, nB, cB)));
  };
  const start = () => {
    R.round++; R.phase = 'wait'; R.msg = `${R.round}판 · 🔴 기다리세요…`; draw();
    R.tm = setTimeout(() => { R.phase = 'go'; R.t0 = performance.now(); R.msg = '🟢 지금!'; draw(); }, 1500 + Math.random() * 3000);
  };
  const hit = (k) => {
    if (R.done || R.phase === 'idle') return;
    let w;
    if (R.phase === 'wait') { clearTimeout(R.tm); w = 1 - k; R.msg = `🚫 ${k ? nB : nA} 부정출발!`; }
    else { w = k; R.msg = `⚡ ${k ? nB : nA} ${Math.round(performance.now() - R.t0)}ms!`; }
    R.sc[w]++; R.phase = 'idle';
    if (R.sc[w] >= 2) { R.done = true; R.msg += ` → 🏆 ${w ? nB : nA} 최종 승리!`; send({ op: 'react', w }); }
    draw();
  };
  draw();
  return wrap;
}

save();
const asQ = qs.get('as');
if (asQ === 'host' && me.room && !me.role) { me.role = 'host'; me.team = null; me.sub = false; save(); }
if (asQ === 'player' && me.room && !me.role) { me.role = 'player'; save(); }
if (me.room && me.role) connect().then(() => { if (me.role === 'host' || me.role === 'watch' || me.team != null) goLive(); else { $('teamPick').hidden = false; drawTeamPick(); } });
