// 진행폰·플레이어 폰: 게임판 화면 요약을 받아 그리고, 누른 버튼을 게임판으로 보낸다
import { createTransport } from './transport.js';
import { transportKind, WS_URL, FIREBASE } from './config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'jumarble-remote';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
const qs = new URLSearchParams(location.search);
const qRoom = (qs.get('room') || '').toUpperCase();
let me = { room: qRoom || (saved.room || '').toUpperCase(), role: saved.role || '', team: saved.team ?? null,
  pid: saved.pid || (Math.random().toString(36).slice(2) + Date.now().toString(36)) };
// 다른 방 QR을 찍고 들어왔으면 예전 역할·팀은 잊어요
if (qRoom && saved.room && qRoom !== saved.room) { me.role = ''; me.team = null; }
const tagOf = (pid) => { let h = 7; for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pid ? h.toString(36) : ''; };
let lastCur = null, wake = null;
// 🧠 혼자 푸는 위스키 상식 (게임 OX 퀴즈와 겹치지 않는 별도 문제, 게임 승패 영향 없음)
const QUIZ = [
  ['스카치위스키는 스코틀랜드에서 최소 3년 이상 숙성해야 한다', 'O'], ['버번은 옥수수를 51% 이상 써서 만든다', 'O'],
  ['버번은 속을 태운 새 오크통에서 숙성한다', 'O'], ['‘싱글 몰트’는 한 개의 통에서만 숙성했다는 뜻이다', 'X'],
  ['싱글 몰트 스카치는 한 증류소에서 맥아 보리로 만든다', 'O'], ['숙성 연수 표기는 병 속 가장 어린 원액 기준이다', 'O'],
  ['위스키는 병에 담긴 뒤에도 계속 숙성된다', 'X'], ['‘엔젤스 셰어’는 숙성 중 증발로 사라지는 위스키를 말한다', 'O'],
  ['아일라 섬 위스키는 피트(스모키) 향으로 유명하다', 'O'], ['테네시 위스키는 숯으로 거르는 과정을 거친다', 'O'],
  ['아이리시 위스키는 전통적으로 세 번 증류하는 경우가 많다', 'O'], ['‘캐스크 스트렝스’는 물을 타지 않고 통 도수 그대로 병입한 것이다', 'O'],
  ['스카치위스키의 최소 도수는 40%다', 'O'], ['버번은 켄터키주에서만 만들 수 있다', 'X'],
  ['미국 라이 위스키는 호밀을 51% 이상 쓴다', 'O'], ['피트는 석탄의 한 종류다', 'X'],
  ['셰리 캐스크는 스페인 셰리 와인을 담았던 통이다', 'O'], ['블렌디드 스카치는 몰트와 그레인 위스키를 섞어 만든다', 'O'],
  ['‘드램’은 위스키 한 잔을 부르는 말이다', 'O'], ['스페이사이드는 스코틀랜드에서 증류소가 가장 많이 모인 지역이다', 'O'],
  ['구리로 만든 단식 증류기를 ‘팟 스틸’이라고 한다', 'O'], ['스카치에는 캐러멜 색소를 넣는 것이 허용된다', 'O'],
  ['버번에는 캐러멜 색소를 넣을 수 있다', 'X'], ['몰팅은 보리를 싹틔웠다가 말리는 과정이다', 'O'],
  ['더운 곳일수록 숙성이 빨리 진행되는 편이다', 'O'], ['잉글랜드에서 숙성해도 ‘스카치’라고 부를 수 있다', 'X'],
  ['그레인 위스키는 보리만으로 만든다', 'X'], ['위스키 통은 주로 소나무로 만든다', 'X'],
  ['버번의 최소 숙성 기간은 10년이다', 'X'], ['나이 표기가 없는(NAS) 위스키는 숙성을 전혀 안 한 술이다', 'X'],
  ['위스키 향을 맡는 단계를 ‘노즈’라고 한다', 'O'], ['하이볼은 위스키에 탄산수를 섞은 음료다', 'O']];
const QZ = { order: [], cur: null, picked: null, right: 0, total: 0, until: 0 };
function nextQuiz() { if (!QZ.order.length) QZ.order = QUIZ.map((_, i) => i).sort(() => Math.random() - 0.5); QZ.cur = QZ.order.pop(); QZ.picked = null; }
function quizView() {
  if (QZ.cur == null) nextQuiz();
  const [q, a] = QUIZ[QZ.cur];
  const box = h('div', { class: 'panel quiz' }, h('p', { class: 'sec' }, `🧠 기다리는 동안 위스키 상식 · 맞힌 개수 ${QZ.right}/${QZ.total}`), h('div', { class: 'card-d' }, q));
  if (QZ.picked == null) {
    box.append(h('div', { class: 'choice' }, ['O', 'X'].map((v) => h('button', { class: 'btn', style: 'font-size:22px', onclick: () => {
      QZ.picked = v; QZ.total++; const ok = v === a; if (ok) { QZ.right++; send({ op: 'quiz', ok: true }); }
      setTimeout(() => { nextQuiz(); render(); }, 2200); render(); } }, v === 'O' ? '⭕' : '❌'))));
  } else box.append(h('p', { class: 'wait', style: `color:${QZ.picked === a ? '#13A36B' : '#D64545'};font-weight:700` }, QZ.picked === a ? `🎉 정답! (${a})` : `아쉽! 정답은 ${a}`));
  box.append(h('p', { class: 'small muted', style: 'margin:6px 0 0' }, '맞힌 개수는 끝날 때 ‘🧠 위스키 박사’ 시상에만 쓰여요'));
  return box;
}
const CHEER = ['👏', '🔥', '😂', '🍻', '😱', '🥃'];
let cheerAt = 0;
function cheerBar() {
  return h('div', { class: 'cheerbar' }, CHEER.map((e) => h('button', { class: 'btn', 'aria-label': '응원 ' + e, onclick: () => { const n = Date.now(); if (n - cheerAt < 700) return; cheerAt = n; send({ op: 'cheer', e }); } }, e)));
}
let tp = null, S = null, connectedRoom = null;
let local = { sw: null, react: null }; // 폰 안에서 직접 재는 미니게임 상태
const drafts = {}; let focusRid = null; // 화면이 새로 그려져도 입력 중인 글자를 지키기

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e[k] = v; else if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const send = (cmd) => { if (tp) tp.send({ t: 'cmd', from: me.role, team: me.team, pid: me.pid, ...cmd }); try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* 무시 */ } };
const isHost = () => me.role === 'host';
const mine = (teams) => isHost() ? teams !== 'board' : String(teams || '').split(',').includes(String(me.team));
const myTurn = () => S && S.cur === me.team;
function save() { try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* 무시 */ } }
const hello = () => tp && tp.send({ t: 'hello', from: me.role, pid: me.pid });
// 게임 중에 화면이 꺼지지 않게
async function keepAwake() { try { if ('wakeLock' in navigator && !wake && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); hello(); } });

async function connect() {
  if (connectedRoom === me.room && tp) return;
  if (tp) tp.close();
  connectedRoom = me.room;
  tp = await createTransport({ kind: transportKind() === 'none' ? 'local' : transportKind(), room: me.room, role: 'player', url: WS_URL, firebase: FIREBASE });
  tp.on((m) => { if (m && m.t === 'state' && (!m.room || m.room === me.room)) { S = m; checkTeams(); render(); } });
  tp.onStatus((st) => { $('dot').className = 'dot ' + st; if (st === 'online') hello(); });
  hello(); keepAwake();
}

// ---------- 참가 화면 ----------
$('room').value = me.room;
$('room').oninput = () => { me.room = $('room').value.trim().toUpperCase(); };
$('asHost').onclick = async () => { if (!checkRoom()) return; me.role = 'host'; me.team = null; save(); await connect(); goLive(); };
// QR에서 바로 들어온 경우: 플레이어는 곧장 팀 고르기로, 진행자 QR은 진행폰으로
if (qs.get('as') === 'player') { const c = $('asHost').closest('.choice'); c.style.display = 'none'; if (c.previousElementSibling) c.previousElementSibling.style.display = 'none'; }
$('asPlayer').onclick = async () => { if (!checkRoom()) return; me.role = 'player'; save(); await connect(); $('teamPick').hidden = false; drawTeamPick(); };
$('leave').onclick = (e) => { e.preventDefault(); me.role = ''; me.team = null; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = true; };
function checkRoom() { if (!/^[A-Z0-9]{3,8}$/.test(me.room)) { alert('방 코드를 확인해 주세요'); return false; } return true; }
function drawTeamPick() {
  const box = $('teamBtns'); box.innerHTML = '';
  if (!S || !S.teams || !S.teams.length) { box.append(h('p', { class: 'muted small' }, '게임판에서 게임을 시작하면 팀 목록이 나와요…')); return; }
  S.teams.forEach((t) => box.append(h('button', { class: 'btn', style: `border-color:${t.color};border-width:3px`, onclick: () => { me.team = t.i; me.sig = sigOf(S); save(); goLive(); } },
    h('b', {}, t.name), t.mem ? h('br') : null, t.mem ? h('span', { class: 'small muted' }, t.mem) : null)));
}
// 팀 구성이 바뀐 새 게임이면(팀 이름·순서가 다르면) 팀을 다시 고르게 해요 (예전 번호로 엉뚱한 팀 버튼이 보이지 않게)
const sigOf = (st) => (st && st.teams || []).map((t) => t.name).join('|');
function checkTeams() {
  if (me.role !== 'player' || me.team == null || !S || S.phase !== 'play' || !S.teams || !S.teams.length) return;
  const sig = sigOf(S);
  if (!me.sig) { me.sig = sig; save(); return; }
  if (sig !== me.sig || !S.teams[me.team]) { me.team = null; me.sig = ''; save(); $('live').hidden = true; $('join').hidden = false; $('teamPick').hidden = false; drawTeamPick();
    const n = $('teamPick').querySelector('p'); if (n) n.textContent = '팀 구성이 바뀌었어요. 우리 팀을 다시 골라 주세요'; }
}
function goLive() { $('join').hidden = true; $('live').hidden = false; render(); }

// ---------- 메인 화면 ----------
function render() {
  if (!$('teamPick').hidden && $('live').hidden) drawTeamPick();
  if ($('live').hidden || !S) return;
  const myT = S.teams && S.teams[me.team];
  $('me').textContent = isHost() ? `🎮 진행폰 · ${S.room || me.room}` : `📱 ${myT ? myT.name : '플레이어'} · ${S.room || me.room}`;
  // 우리 차례가 되면 화면을 팀 색으로 칠하고 한 번 진동
  const mine0 = !isHost() && S.phase === 'play' && S.cur === me.team;
  document.body.classList.toggle('myturn', mine0); document.documentElement.style.setProperty('--my', myT && /^#[0-9a-f]{3,8}$/i.test(myT.color) ? myT.color : '#e2571e');
  if (mine0 && lastCur !== S.cur) { try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* 무시 */ } }
  lastCur = S.phase === 'play' ? S.cur : null;
  // 상태
  const st = $('status'); st.innerHTML = '';
  if (isHost() && S.host && S.host !== tagOf(me.pid)) st.append(h('p', { class: 'warn' }, '⚠️ 이미 다른 진행폰이 연결돼 있어요. 이 폰의 버튼은 게임판에서 무시돼요. 게임판의 ‘📡 → 진행폰 바꾸기’를 누르거나, 나가기 후 플레이어로 들어오세요.'));
  if (S.phase === 'setup') st.append(h('p', { class: 'wait' }, '게임판에서 팀을 정하고 ‘게임 시작’을 누르면 시작돼요'));
  else if (S.teams && S.teams[S.cur] && S.phase === 'play') {
    const ct = S.teams[S.cur];
    const n = S.teams.length; let wait = null;
    if (!isHost() && myT && !mine0) { let k = 0, j = S.cur; while (k < n && j !== me.team) { j = (j + 1) % n; k++; } wait = k > 0 && k < n ? `우리 차례까지 ${k}팀 남았어요` : null; }
    st.append(...[h('div', { class: 'disp', style: `font-size:${mine0 ? 30 : 22}px;color:${mine0 ? '#fff' : ct.color};text-align:center` }, mine0 ? `🎲 우리 팀(${ct.name}) 차례예요!` : `🎲 ${ct.name} 차례`),
      wait ? h('p', { class: 'small', style: 'text-align:center;margin:4px 0 0;font-weight:700' }, wait) : null, h('p', { class: 'small muted', style: 'text-align:center;margin:4px 0 0' }, S.log || ''), S.cast ? h('p', { class: 'small', style: 'text-align:center;margin:4px 0 0;color:#e2571e;font-weight:700' }, S.cast) : null].filter(Boolean));
  }
  // 본문
  const main = $('main'); main.innerHTML = '';
  if (S.over) main.append(overView());
  else if (S.pick) main.append(pickView());
  else if (S.taxi) main.append(taxiView());
  else if (S.modal) main.append(cardView(S.modal));
  else if (S.spin) main.append(h('div', { class: 'panel wait' }, S.spin));
  else if (S.roll && (isHost() || myTurn())) main.append(h('div', { class: 'panel' }, h('button', { class: 'big roll', onclick: () => send({ op: 'roll' }) }, '🎲 굴리기')));
  else if (S.phase === 'play') main.append(h('div', { class: 'panel wait' }, '👀 게임판을 봐 주세요'));
  // 대기 중이면 위스키 상식, 게임 중엔 언제나 익명 응원
  const nothing = !main.querySelector('button:not([disabled]),input:not([disabled])');
  if (!isHost() && S.phase === 'play' && !mine0 && !S.over && nothing) main.append(quizView());
  if (S.phase === 'play') main.append(cheerBar());
  if (isHost() && S.phase === 'play') main.append(h('div', { style: 'text-align:right;margin-top:6px' }, h('button', { class: 'btn', style: 'font-size:13px;min-height:0;padding:6px 10px', onclick: () => send({ op: 'mute' }) }, '🔊 게임판 소리 켜기/끄기')));
  // 팀 현황
  const tb = $('teams'); tb.innerHTML = '';
  (S.teams || []).forEach((t) => tb.append(h('div', { class: 'tm' + (t.i === me.team ? ' me' : '') + (S.juru && t.fire ? ' fire f' + t.fire : ''), style: `--c:${t.color}` },
    h('b', {}, t.name), h('br'), `🏁 ${Math.min(t.laps, S.goal)}/${S.goal}바퀴${t.fin ? ' 골인' : ''} · `,
    S.juru ? h('span', { class: 'nw' }, `🍻 ${t.drinks}잔${t.fire ? ' ' + '🔥'.repeat(t.fire) : ''}`) : (t.lost ? '💧 패배' : `🥃 ${t.drinks}${S.cap ? '/' + S.cap : ''}`),
    !S.juru && t.pass ? ` · 🛡️${t.pass}` : '', t.island ? ' · 🏝️' : '', t.streak >= 2 ? ` · ${S.juru ? '⚡' : '🔥'}${t.streak}연승` : '', t.next ? h('br') : null, t.next ? h('span', { class: 'small muted' }, `🎯 다음 걸린 사람: ${t.next}`) : null)));
}

function cardView(m) {
  const p = h('div', { class: 'panel' });
  p.append(h('div', { class: 'who' }, m.who), h('div', { class: 'card-e' }, m.e), h('div', { class: 'card-t' }, m.t));
  if (m.d) p.append(h('div', { class: 'card-d' }, m.d));
  if (m.x) p.append(h('div', { class: 'card-x' }, m.x));
  if (m.reroll && isHost()) p.append(h('div', { style: 'text-align:center;margin-top:6px' }, h('button', { class: 'btn', style: 'font-size:13px;min-height:0;padding:6px 10px', onclick: () => send({ op: 'click', rid: m.reroll }) }, '🎲 다른 조건으로')));
  if (m.q) p.append(h('div', { class: 'oxq' }, m.q));
  let acted = false;
  // 폰에서 직접 하는 미니게임
  if (m.sw && (isHost() || mine(m.def))) { p.append(stopwatchView(+m.sw)); acted = true; }
  else if (m.react) {
    if (isHost()) { p.append(reactView(JSON.parse(m.react))); acted = true; }
    else p.append(h('p', { class: 'wait' }, '⚡ 진행폰 한 대로 순발력 대결 중!'));
  } else local.sw = null;
  if (!m.react) local.react = null;
  // 미션 상자
  const skipLocal = (b) => (m.sw && /시작|멈춤/.test(b.label)) || (m.react && (b.cls || '').includes('react-pad') || (m.react && /판 시작/.test(b.label)));
  for (const b of m.box) {
    if (b.k === 'txt') { if (!(m.react && /react/.test(b.cls))) p.append(h('div', { class: 'txt ' + (b.cls || '') }, b.text)); continue; }
    if (!mine(b.teams) || skipLocal(b)) continue;
    acted = true;
    if (b.k === 'btn') p.append(h('div', { style: 'margin:6px 0' }, h('button', { class: 'btn ' + (b.cls || '').replace(/ghost|cbtn|btn fill/g, '').replace(isHost() ? /selO|selX/g : /$^/, ''), style: 'width:100%', disabled: b.dis, onclick: () => send({ op: 'click', rid: b.rid }) }, b.label.replace(/👉 (.+?) 대표에게 폰 넘기기/, '👉 $1 선택하기'))));
    else if (b.k === 'grid') p.append(h('div', { class: 'grid' }, b.btns.map((x) => h('button', { class: 'btn', disabled: x.dis, onclick: () => send({ op: 'click', rid: x.rid }) }, x.label))));
    else if (b.k === 'in') {
      const i = h('input', { type: 'text', placeholder: b.ph, disabled: b.dis });
      i.value = drafts[b.rid] || '';
      i.oninput = () => { drafts[b.rid] = i.value; };
      i.onfocus = () => { focusRid = b.rid; }; i.onblur = () => { if (focusRid === b.rid) focusRid = null; };
      if (focusRid === b.rid) setTimeout(() => { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 0);
      const go = () => { if (i.value.trim()) { send({ op: 'fill', rid: b.rid, value: i.value.trim() }); i.value = ''; drafts[b.rid] = ''; } };
      i.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      p.append(i, h('button', { class: 'big', style: 'margin-top:8px', disabled: b.dis, onclick: go }, '입력'));
    }
  }
  if (m.act && isHost()) { p.append(h('div', { style: 'margin:8px 0' }, h('button', { class: 'btn', style: 'width:100%', disabled: m.act.dis, onclick: () => send({ op: 'click', rid: m.act.rid }) }, m.act.label))); acted = true; }
  if (m.timer && isHost()) p.append(h('div', { style: 'margin:6px 0' }, h('button', { class: 'btn', style: 'width:100%', onclick: () => send({ op: 'click', rid: m.timer.rid }) }, m.timer.label)));
  if (isHost()) {
    if (m.rec) {
      p.append(h('p', { class: 'sec' }, m.rec.label));
      for (const r of m.rec.rows || []) {
        p.append(h('div', { class: 'recrow' + (r.off ? ' off' : ''), style: `--c:${/^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '#888'}` }, h('b', {}, r.name),
          r.off ? h('span', { class: 'small muted' }, '관련 없음') : h('div', { class: 'seg' }, r.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label)))));
      }
      for (const r of m.rec.tgt || []) p.append(h('div', { class: 'recrow' }, h('b', {}, r.label), h('div', { class: 'seg' }, r.btns.map((b) => h('button', { class: 'btn' + (b.on ? ' on' : ''), onclick: () => send({ op: 'click', rid: b.rid }) }, b.label)))));
    }
    p.append(h('button', { class: 'big' + (m.ok.pending ? ' pending' : ''), style: 'margin-top:12px', onclick: () => send({ op: 'click', rid: m.ok.rid }) }, m.ok.label));
  } else if (!acted) p.append(h('p', { class: 'wait' }, '👀 지금은 누를 게 없어요. 게임판을 봐 주세요'));
  return p;
}

function pickView() {
  const can = isHost() || myTurn();
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, S.pick.title),
    can ? h('div', { class: 'choice' }, S.pick.opts.map((o) => h('button', { class: 'btn', disabled: o.dis, onclick: () => send({ op: 'pick', rid: o.rid }) }, o.label)))
      : h('p', { class: 'wait' }, '보물상자를 고르는 중…'));
}
function taxiView() {
  const can = isHost() || myTurn();
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, '🚕 어디로 갈까요?'),
    can ? h('div', { class: 'choice' }, S.taxi.cells.map((c) => h('button', { class: 'btn', onclick: () => send({ op: 'taxi', cell: c.i }) }, `${c.i}번 · ${c.label}`)))
      : h('p', { class: 'wait' }, '택시 목적지를 고르는 중…'));
}
function overView() {
  return h('div', { class: 'panel' }, h('div', { class: 'card-t' }, S.over.title), h('p', { class: 'card-d' }, S.over.msg),
    h('ol', {}, S.over.rows.map((r) => h('li', { style: 'margin:4px 0' }, r))));
}

// ⏱️ 스톱워치: 폰에서 직접 재고 결과(초)만 보냄 (통신 지연 영향 없음)
function stopwatchView(target) {
  if (!local.sw) local.sw = { t0: 0, done: false, txt: '0.00' };
  const L = local.sw;
  const num = h('div', { class: 'txt big-num' }, L.txt);
  const bt = h('button', { class: 'big', disabled: L.done }, L.done ? '기록 완료' : L.t0 ? '■ 멈춤' : '▶ 시작');
  const tick = () => { if (!L.t0 || L.done) return; L.txt = ((performance.now() - L.t0) / 1000).toFixed(2); num.textContent = L.txt; L.raf = requestAnimationFrame(tick); };
  bt.onclick = () => {
    if (!L.t0) { L.t0 = performance.now(); bt.textContent = '■ 멈춤'; tick(); return; }
    L.done = true; cancelAnimationFrame(L.raf); const e = (performance.now() - L.t0) / 1000; L.txt = e.toFixed(2) + '초'; num.textContent = L.txt; bt.disabled = true; bt.textContent = '기록 완료';
    send({ op: 'sw', e: Math.round(e * 1000) / 1000 });
  };
  if (L.t0 && !L.done) requestAnimationFrame(tick);
  return h('div', {}, h('p', { class: 'sec' }, `정확히 ${target}.00초에 멈추기!`), num, bt);
}

// ⚡ 순발력 대결: 진행폰 한 대에서 3판 2선승, 최종 승자만 보냄
function reactView([nA, nB, cA, cB]) {
  if (!local.react) local.react = { sc: [0, 0], round: 0, phase: 'idle', t0: 0, tm: 0, msg: '3판 2선승! 준비되면 시작', done: false };
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
  const start = () => { R.round++; R.phase = 'wait'; R.msg = `${R.round}판 · 🔴 기다리세요…`; draw();
    R.tm = setTimeout(() => { R.phase = 'go'; R.t0 = performance.now(); R.msg = '🟢 지금!'; draw(); }, 1500 + Math.random() * 3000); };
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

// 저장된 방이 있으면 바로 다시 연결
save();
const asQ = qs.get('as');
if (asQ === 'host' && me.room && !me.role) { me.role = 'host'; me.team = null; save(); }
if (asQ === 'player' && me.room && !me.role) { me.role = 'player'; save(); }
if (me.room && me.role) connect().then(() => { if (me.role === 'host' || me.team != null) goLive(); else { $('teamPick').hidden = false; drawTeamPick(); } });
