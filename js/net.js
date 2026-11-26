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
// 🔒 진행폰이 살아 있으면(최근 60초 안에 신호) 게임 중 게임판 버튼은 진행폰만 누를 수 있어요
let hostSeen = 0, lockOff = false;
const HOST_ALIVE_MS = 60000;
function hostAlive() { return !!hostPid && Date.now() - hostSeen < HOST_ALIVE_MS; }
// 팀마다 참가자 폰이 살아 있는지 (최근 60초 안에 신호). 차례 팀 폰이 있으면 주사위·스톱워치는 그 폰만
const teamSeen = {};
// ⏭️ 대신 하기: 팀 폰이 반응이 없으면 진행폰(없으면 게임판)이 그 팀 몫을 대신 눌러요. 그 팀 폰에서 다시 뭔가 누르면 저절로 돌아가요
const forced = {};
function teamAlive(i) { return !forced[String(i)] && Date.now() - (teamSeen[String(i)] || 0) < HOST_ALIVE_MS; }
window.__teamAlive = (i) => teamAlive(i);
// 🎮 진행폰이 없을 때 진행 버튼을 받을 팀: 지금 차례 팀 폰, 그 팀 폰이 없으면 다음 순서의 살아 있는 팀 폰
// ⚖️ 진행폰이 없을 때 사람이 판정하는 버튼(가위바위보 진 쪽, 제일 늦게 손 든 팀, 성공/실패 등)은
//    이번 미션에 안 걸린 팀 폰이 눌러요 (모두 걸렸으면 진행 버튼 받는 팀 폰 · 다 같이 보고 눌러요)
function judgeTeam() { const s = subTeam(); if (s == null) return null; const n = S.teams.length, inv = String(defTeams()).split(','); for (let k = 0; k < n; k++) { const i = (S.cur + k) % n; if (teamAlive(i) && !inv.includes(String(i))) return i; }
  const real = inv.filter((x) => /^\d+$/.test(x)); return real.length >= 2 && real.every((x) => teamAlive(x)) ? -1 : -2; } // -1: 걸린 팀들이 모두 폰이 있으면 같은 답을 골라야 정해져요 · -2: 미션 팀 혼자 판정하면 안 되니 게임판에서 다 같이 보고 눌러요
const judgeAll = () => String(defTeams()).split(',').filter((x) => x !== '' && teamAlive(x)).map(Number);
let jVotes = {}, jSeq = -1, jSplit = -1; const tapWin = {}; // ⚖️ 두 팀 합의 판정: 팀 → 고른 버튼
let rerollSeq = -1; // 진행폰 없을 때 '다른 조건으로'는 미션마다 한 번만
function subTeam() { if (hostAlive() || S.phase !== 'play' || !S.teams) return null; const n = S.teams.length; for (let k = 0; k < n; k++) { const i = (S.cur + k) % n; if (teamAlive(i)) return i; } return null; }
function takeover(i, on) { const k = String(i); if (on) forced[k] = Date.now(); else delete forced[k]; updLock(); schedule(); if (on && typeof toast === 'function' && S.teams && S.teams[+k]) toast(`⏭️ ${S.teams[+k].name} 몫은 잠시 진행폰·게임판에서 대신 눌러요`); }
// 📱 접속한 폰 목록 (폰마다: 팀, 들고 있는 사람 이름, 마지막 신호)
const phones = {};
const claims = {}; // 새 팀을 만든 폰 → 팀 번호 (폰이 자기 팀을 알 수 있게)
function notePhone(m) {
  if (!m || m.from !== 'player' || !m.pid) return;
  const p = phones[m.pid] || (phones[m.pid] = {});
  const tm = m.team != null ? String(m.team) : null, changed = p.team !== tm || (m.nick != null && p.nick !== String(m.nick).slice(0, 8)) || (m.t === 'hello' && !!m.ready !== !!p.ready) || !p.seen;
  const joinedNow = tm != null && p.team !== tm, readyNow = m.t === 'hello' && !!m.ready && !p.ready && tm != null;
  // 🔒 한 팀엔 폰 한 대: 이미 다른 폰이 1분 안에 신호를 보낸 팀이면 이 폰은 그 팀으로 인정하지 않아요
  if (tm != null) { const other = Object.entries(phones).find(([q, o]) => q !== m.pid && o.team === tm && !o.dup && Date.now() - (o.seen || 0) < HOST_ALIVE_MS); if (other) { p.dup = tm; p.dupAt = Date.now(); p.seen = Date.now(); schedule(); return; } }
  p.dup = null;
  p.team = tm; if (m.nick != null) p.nick = String(m.nick).slice(0, 8); if (m.t === 'hello') p.ready = !!m.ready; p.seen = Date.now();
  if (readyNow && !joinedNow && typeof toast === 'function' && S.phase === 'setup') { const n = teamNameAt(+tm); if (n) toast(`✅ ${n} 준비 완료!${p.nick ? ` (팀장 ${p.nick})` : ''}`); }
  if (joinedNow && typeof toast === 'function' && typeof joinFx !== 'function') { const n = teamNameAt(+tm); if (n) toast(/^[A-F]팀$|^\d+번$/.test(n) && S.phase === 'setup' ? `📱 새 팀 폰이 들어왔어요 (팀 이름 정하는 중)` : `📱 ${n} 폰이 들어왔어요${p.nick ? ` (팀장 ${p.nick})` : ''}`); }
  if (changed) { drawPhones(); schedule(); }
}
// 팀별 폰 상태: on = 1분 안에 신호, 늦어도 3분까지는 '신호 끊김'으로 보여 줘요
function phoneList() {
  const now = Date.now(), out = {};
  for (const [pid, p] of Object.entries(phones)) {
    const age = now - (p.seen || 0); if (age > 180000) continue;
    const k = p.team == null ? 'wait' : p.team;
    (out[k] = out[k] || []).push({ nick: p.nick || '', on: age < HOST_ALIVE_MS, ready: !!p.ready, k: tag(pid) });
  }
  return out;
}
// 시작 화면 위쪽: 접속한 폰 · 준비 완료 수 · 팀 안 정한 사람
const setupNames = () => (SOLO() ? (S.solo || []) : (S.setup || [])).map((t, i) => (t.name || '').trim() || (SOLO() ? `${i + 1}번` : `${'ABCDEF'[i]}팀`));
const teamNameAt = (i) => S.phase === 'setup' ? setupNames()[i] : (S.teams && S.teams[i] ? S.teams[i].name : '');
// 시작 화면 위쪽: 접속한 팀 · 준비 완료 · 팀 고르는 중
function drawPhoneSum(L) {
  const e = $('phoneSum'); if (!e) return;
  if (S.phase !== 'setup') { if (!e.hidden) e.hidden = true; return; }
  const names = setupNames(), joined = names.map((n, i) => ({ n, a: (L[String(i)] || []).filter((x) => x.on) })).filter((x) => x.a.length);
  const ready = joined.filter((x) => x.a.some((y) => y.ready)), picking = (L.wait || []).filter((x) => x.on).length;
  const who = joined.map((x) => { const nk = x.a.map((y) => y.nick).filter(Boolean)[0]; return `${x.n}${nk ? `(${nk})` : ''}${x.a.some((y) => y.ready) ? '✅' : ''}`; }).join(' · ');
  const t = !joined.length && !picking ? '📱 아직 접속한 팀이 없어요 · 팀장이 오른쪽 아래 QR을 찍으면 들어와요'
    : `📱 접속한 팀 ${joined.length}/${names.length} · ✅ 준비 ${ready.length}/${joined.length}` + (picking ? ` · 👀 팀 고르는 중 ${picking}대` : '') + (who ? `\n${who}` : '')
      + (joined.length && ready.length === joined.length ? '\n🎉 접속한 팀 모두 준비! ‘게임 시작’을 눌러요' : '');
  if (e.textContent !== t) e.textContent = t; if (e.hidden) e.hidden = false;
}
// 시작 화면 팀 칸: 접속 · 팀장 · 준비
const setupText = (arr) => { const on = (arr || []).filter((x) => x.on); if (!on.length) return arr && arr.length ? '📱 폰 신호 끊김' : '📱 폰 없음 (게임판에서 적어도 돼요)';
  const nk = on.map((x) => x.nick).filter(Boolean); return `📱 접속${nk.length ? ` · 👑 팀장 ${nk.join('·')}` : ''} · ${on.some((x) => x.ready) ? '✅ 준비 완료' : '⏳ 준비 중'}`; };
// 게임 중 팀 카드 배지: 짧게
const chipText = (arr) => { const on = (arr || []).filter((x) => x.on); if (!arr || !arr.length) return '폰 없음'; if (!on.length) return '📵 끊김'; const nk = on.map((x) => x.nick).filter(Boolean); return `📱 ${nk.length ? nk.join('·') : '연결'}`; };
const phoneText = (arr) => { if (!arr || !arr.length) return '📱 폰 없음'; const on = arr.filter((x) => x.on), off = arr.length - on.length;
  const nm = on.map((x) => x.nick).filter(Boolean); return (on.length ? `📱 ${nm.length ? nm.join('·') + (on.length > nm.length ? ` 외 ${on.length - nm.length}대` : '') : on.length + '대'} 접속` : '📱 폰 신호 끊김') + (on.length && off ? ` · ${off}대 끊김` : ''); };
// 게임판: 설정 화면 팀 칸 · 게임 중 팀 카드에 폰 상태를 붙여요
const prevSt = {}; // 📱 팀별 지난 상태: '' 폰 없음 / on 연결 / off 끊김 → 바뀌면 게임판에 크게 알려요
function phoneFx(L) {
  if (typeof joinFx !== 'function') return;
  const names = S.phase === 'setup' ? setupNames() : (S.teams || []).map((t) => t.name);
  names.forEach((n, i) => { const arr = L[String(i)], st = arr && arr.some((x) => x.on) ? 'on' : arr && arr.length ? 'off' : '', was = prevSt[i] || ''; prevSt[i] = st; if (st === was) return;
    const col = S.phase === 'setup' ? '' : (S.teams[i] && S.teams[i].color) || '', nk = (arr || []).filter((x) => x.on).map((x) => x.nick).filter(Boolean).join('·');
    const nm = S.phase === 'setup' && /^[A-F]팀$|^\d+번$/.test(n) ? '새 팀' : n;
    joinFx.idx = S.phase === 'setup' ? null : i;
    if (st === 'on') joinFx(was === 'off' ? 'back' : 'join', nm, col, nk ? `팀장 ${nk}` : '');
    else if (was === 'on') joinFx('lost', nm, col, st === 'off' ? '1분 넘게 신호가 없어요' : '나갔어요'); });
}
window.__drawPhones = () => drawPhones();
function drawPhones() {
  if (!room) return;
  const L = phoneList(); drawPhoneSum(L); try { phoneFx(L); } catch (e) { /* 무시 */ }
  const put = (box, i) => { if (!box) return; let e = box.querySelector(':scope > .npPh'); if (!e) { e = document.createElement('div'); e.className = 'npPh'; box.appendChild(e); }
    const arr = L[String(i)]; const t = S.phase === 'setup' ? setupText(arr) : chipText(arr); if (e.textContent !== t) e.textContent = t; const c = arr && arr.some((x) => x.on) ? 'on' : arr && arr.length ? 'off' : ''; if (e.dataset.st !== c) e.dataset.st = c; };
  if (S.phase === 'setup') [...($('tlist') ? $('tlist').children : [])].forEach(put);
  else if ($('chips')) [...$('chips').children].forEach(put);
  const pl = $('npPhones');
  if (pl) { const names = S.phase === 'setup' ? setupNames() : (S.teams || []).map((t) => t.name);
    const key = names.map((n, i) => n + phoneText(L[String(i)]) + !!forced[String(i)]).join('|') + S.phase;
    if (pl.dataset.k !== key) { pl.dataset.k = key; pl.innerHTML = '';
      names.forEach((n, i) => { const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin:3px 0';
        const sp = document.createElement('span'); sp.textContent = `${n}: ${forced[String(i)] ? '⏭️ 대신 하는 중' : phoneText(L[String(i)])}`; row.appendChild(sp);
        const has = (L[String(i)] || []).some((x) => x.on);
        if (S.phase === 'play' && (has || forced[String(i)])) { const b = document.createElement('button'); b.className = 'ghost'; b.style.cssText = 'font-size:13px;padding:4px 10px';
          b.textContent = forced[String(i)] ? '📱 팀 폰에 돌려주기' : '⏭️ 대신 하기'; b.onclick = () => takeover(i, !forced[String(i)]); row.appendChild(b); }
        pl.appendChild(row); }); } }
}
let lastAlive = null;
function updLock() {
  const alive = hostAlive(); if (alive !== lastAlive) { lastAlive = alive; if (typeof schedule === 'function' && tp) schedule(); }
  const on = alive && !lockOff && typeof S !== 'undefined' && S.phase === 'play';
  document.body.classList.toggle('hostLock', on);
  document.body.classList.toggle('teamRoll', typeof S !== 'undefined' && S.phase === 'play' && teamAlive(S.cur) && !lockOff);
  const n = $('npHost'), nt = hostPid ? (hostAlive() ? '지금 진행폰: 연결됨' : '진행폰 신호 없음 (게임판에서 눌러도 돼요)') : '진행폰 없음 — 괜찮아요! 차례 팀 폰이 진행 버튼도 눌러요';
  if (n && n.textContent !== nt) n.textContent = nt;
  const lb = $('npLock'), lt = lockOff ? '🔒 다시 진행폰만 누르게 하기' : '🔓 게임판에서도 누르기'; if (lb && lb.textContent !== lt) lb.textContent = lt;
  try { drawPhones(); } catch (e) { /* 무시 */ }
}
const throttle = {};
const hostKey = () => 'jumarble-host-' + room;
const tag = (pid) => { let h = 7; for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pid ? h.toString(36) : ''; };
const shown = (el) => el && !el.hidden && el.offsetParent !== null;

// 버튼이 누구 것인지: 가장 가까운 data-teams (팀 번호 목록 또는 'host'), 없으면 이 카드의 기본 참가 팀
// 진행용 버튼(시작·공개·돌리기·셋 세기·레버)은 진행자만: 진행폰, 없으면 게임판. 참가자 폰엔 우리 팀이 고르는 버튼만
function isProgress(el) {
  if (!el || el.tagName !== 'BUTTON') return false;
  if (el.classList.contains('countbtn')) return true;
  const t = (el.innerText || el.textContent || '').trim();
  return /^(▶|❓|🧩|🔔|⏲|⏱|🔁 한 번 더|🎰 룰렛)/.test(t) || /(시작|공개|돌리기|외치기)$/.test(t); // 주사위·잭팟 레버는 참가자(차례 팀) 몫
}
function teamsOf(el, def) {
  if (el.dataset && el.dataset.teams) return String(el.dataset.teams); // 버튼에 직접 붙은 주인이 먼저 (예: 룰렛은 차례 팀)
  if (isProgress(el)) return 'host';
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
        const tm = teamsOf(el, def); const secret = !!el.closest('.picked'); // OX처럼 몰래 고르는 중이면 누가 뭘 골랐는지 폰으로 안 보내요
        out.push({ k: 'btn', rid: rid(el), label: el.innerText.trim() || el.textContent.trim(), dis: el.disabled, cls: secret ? el.className.replace(/\bsel[OX]\b/g, '').replace(/\s+/g, ' ').trim() : el.className, teams: tm, j: tm === 'host' && !isProgress(el) ? 1 : 0 });
      } else if (el.tagName === 'INPUT') {
        out.push({ k: 'in', rid: rid(el), ph: el.placeholder || '', teams: teamsOf(el, def), dis: el.disabled });
      } else if (el.classList.contains('wheel')) {
        out.push({ k: 'txt', cls: 'dice', text: el.classList.contains('done') ? '🎡 룰렛 멈췄어요! (게임판을 봐 주세요)' : '🎡 룰렛 (게임판에서 돌아가요)' });
      } else if (el instanceof SVGElement) {
        continue;
      } else if (el.classList.contains('mdice') || el.classList.contains('duel') && !el.querySelector('button')) {
        out.push({ k: 'txt', cls: 'dice', text: '🎲 (게임판을 봐 주세요)' });
      } else if (el.classList.contains('pchips')) { // 👤 이번 선수 칩은 폰에 한 줄로
        out.push({ k: 'txt', cls: 'cap pl', text: '👤 이번 선수: ' + [...el.querySelectorAll('.pchip')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' · ') });
      } else if (el.classList.contains('rvRow')) {
        out.push({ k: 'txt', cls: 'big-num rv', text: el.dataset.sum || '🎴 공개 중…' }); // 🎴 카드 공개는 폰에 한 줄로
      } else if (el.classList.contains('numgrid')) {
        out.push({ k: 'grid', teams: teamsOf(el, def), j: teamsOf(el, def) === 'host' ? 1 : 0, cls: el.className, btns: [...el.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.innerText.trim(), dis: b.disabled })) });
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
    t: 'state', seq: 0, room, host: tag(hostPid), hostOn: hostAlive(), subTm: subTeam(), judge: judgeTeam(), judgeAll: judgeTeam() === -1 ? judgeAll() : [], jv: jSeq === (typeof MSEQ !== 'undefined' ? MSEQ : 0) ? Object.keys(jVotes).map(Number) : [], boot: BOOT, dup: Object.entries(phones).filter(([, o]) => o.dup != null && Date.now() - (o.dupAt || 0) < 60000).map(([q]) => tag(q)), teamsOn: (S.teams || []).map((_, i) => i).filter(teamAlive), phones: phoneList(), forced: Object.keys(forced).map(Number), auto: autoTxt, now: window.__nowTxt || '', mc: hostAlive() && typeof mcText === 'function' ? mcText() : '', mcLeft: S.mcLeft == null ? 3 : S.mcLeft, claims: S.phase === 'setup' ? claims : {}, turnNo: S.turnNo || 0, paused: !!window.__paused, fx: window.__fx || null, intro: $('introFx') ? [...$('introFx').querySelectorAll('.in-l')].map((d) => d.textContent) : null, undo: $('undoBtn') && !$('undoBtn').hidden ? ($('undoBtn').title || '방금 기록') : '',
    drink: $('drinkFx') && !$('drinkFx').classList.contains('out') ? { ti: window.__drinkTi || [], h: $('drinkFx').querySelector('.dfx-h').textContent, l: [...$('drinkFx').querySelectorAll('.dfx-l div')].map((d) => d.textContent), cd: $('drinkFx').querySelector('.dfx-cd').textContent } : null, toast: window.__toast || null, mseq: typeof MSEQ !== 'undefined' ? MSEQ : 0,
    warn: autoWarn, wn: watchN(), chatOn: S.chatOn !== false, phrases: typeof SAY_PRESET !== 'undefined' ? SAY_PRESET : [],
    phase: S.phase, juru: JURU(), solo: SOLO(), cur: S.cur, goal: S.goal || 3, cap: S.cap || 0,
    sub: $('subT') ? $('subT').textContent : '', log: $('log').textContent, cast: $('cast') ? $('cast').textContent : '', final: !!S.final,
    // 게임 시작 전에도 설정 중인 팀 목록을 보내서 미리 팀을 고를 수 있게
    teams: S.phase === 'setup' ? (SOLO() ? (S.solo || []) : (S.setup || [])).map((t, i) => ({ i, name: (t.name || '').trim() || (SOLO() ? `${i + 1}번` : `${'ABCDEF'[i]}팀`), color: COLORS[i % COLORS.length], mem: SOLO() ? '' : (t.mem || ''), drinks: 0, laps: 0, pos: 0, pass: 0, streak: 0 }))
      : (S.teams || []).map((t, i) => ({ i, name: t.name, color: t.color, mem: (t.members || []).join(' '), next: SOLO() ? '' : (typeof rotWho === 'function' ? rotWho(t) || '' : ''), drinks: t.drinks || 0, fire: typeof fireLv === 'function' ? fireLv(t) : 0, laps: t.laps || 0, pos: t.pos || 0,
      pass: t.pass || 0, out: t.out || {}, streak: t.streak || 0, fin: !!t.fin, pd: t.pd || {}, cell: typeof cellAt === 'function' && cellAt(t.pos || 0) ? cellAt(t.pos || 0).t : '', lim: typeof CAP === 'function' && !S.juru ? CAP() : 0, island: S.phase === 'play' ? onIsland(t) : false, lost: S.phase === 'play' ? lostT(t) : false })),
    roll: S.phase === 'play' && !busy && !$('rollBtn').disabled && !modalOn && !pickOn && !taxiOn,
    spin: spinOn ? ($('spinName').classList.contains('wheelHost') ? $('spinLbl').textContent : $('spinLbl').textContent + ' ' + $('spinName').textContent) : '',
    modal: modalOn ? {
      who: $('mWho').textContent, e: $('mEm').textContent, t: $('mT').textContent, d: $('mD').textContent,
      x: shown($('mX')) ? $('mX').textContent : '', q: shown($('mQ')) ? $('mQ').textContent : '',
      def, box: shown(box) ? blocks(box, def) : [],
      sw: box.dataset.sw || '', swh: box.dataset.swh || '', react: box.dataset.react || '', react2: box.dataset.react2 || '', tap: box.dataset.tap || '',
      act: shown($('mAct')) ? { rid: srid('act'), label: $('mAct').textContent, dis: $('mAct').disabled } : null,
      reroll: shown($('mReroll')) ? srid('reroll') : null,
      timer: shown($('mTimer')) ? { rid: srid('timer'), label: $('mTimer').textContent } : null,
      rec: shown($('mRec')) ? { label: $('mRec').querySelector('span') ? $('mRec').querySelector('span').textContent : '',
        rows: [...$('mRecB').querySelectorAll('.recrow')].map((r) => ({ name: (r.querySelector('.rn') || r).textContent, off: r.classList.contains('off'), color: r.style.getPropertyValue('--c'),
          ti: (() => { const b = r.querySelector('button[data-team]'); return b ? +b.dataset.team : null; })(),
          btns: [...r.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.textContent, on: b.getAttribute('aria-pressed') === 'true', v: b.dataset.v != null ? +b.dataset.v : null })) })),
        re: [...$('mRecT').querySelectorAll('.re')].map((r) => ({ label: (r.querySelector('span') || r).textContent, ti: (() => { const b = r.querySelector('button[data-team]'); return b ? +b.dataset.team : null; })(), btns: [...r.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.textContent, on: b.getAttribute('aria-pressed') === 'true' })) })),
        tgt: [...$('mRecT').querySelectorAll('.tgt')].map((r) => ({ label: (r.querySelector('span') || r).textContent, ti: (() => { const b = r.querySelector('button[data-team]'); return b ? +b.dataset.team : null; })(), btns: [...r.querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.textContent, on: b.getAttribute('aria-pressed') === 'true', v: 3 })) })) } : null,
      ok: { rid: srid('ok'), label: $('mOk').textContent, pending: $('mOk').classList.contains('pendingOk') || (typeof mPending === 'function' && mPending()) || passWaiting() }
    } : null,
    pick: pickOn ? { title: $('pickT').textContent, opts: [...$('pickOpts').querySelectorAll('button')].map((b) => ({ rid: rid(b), label: b.innerText.replace(/\n+/g, ' '), dis: b.disabled })) } : null,
    taxi: taxiOn ? { cells: [...document.querySelectorAll('.cell.taxiok')].map((c) => ({ i: +c.id.slice(1), label: (c.querySelector('.t') || c).textContent.trim() })) } : null,
    over: overOn ? { title: $('ovT').textContent, msg: $('ovMsg') ? $('ovMsg').textContent : '', rows: [...$('rank').children].map((r) => r.innerText.replace(/\n+/g, ' · ')), aw: [...document.querySelectorAll('#awards .awc')].map((d) => [...d.children].map((c) => c.textContent).join('|') || d.textContent) } : null
  };
}

function publish(force) {
  try { updLock(); } catch (e) { /* 무시 */ }
  if (!tp) return;
  const snap = snapshot();
  const key = JSON.stringify(snap);
  if (!force && key === lastJson) return;
  lastJson = key; snap.seq = ++seq; // 실제로 보낸 것만 번호를 올려요 (가만히 있는 화면에서 번호만 오르면 폰 버튼이 무시돼요)
  tp.send(snap);
}
// 화면이 계속 바뀌어도(스톱워치 등) 0.5초 안에는 꼭 한 번 보내요
function schedule() {
  const now = Date.now(); if (!firstWait) firstWait = now;
  NT.clearTimeout(timer);
  if (now - firstWait > 500) { firstWait = 0; publish(false); return; }
  timer = NT.setTimeout(() => { firstWait = 0; publish(false); }, 120);
}

// 👀 관전자: 팀 없이 들어와서 응원·한마디만 보내요 (게임 버튼은 하나도 못 눌러요)
const watchers = {};
function noteWatch(m) {
  if (!m || m.from !== 'watch' || !m.pid) return;
  const was = watchN(); const isNew = !watchers[m.pid] || Date.now() - (watchers[m.pid].seen || 0) > 70000; const w = watchers[m.pid] || (watchers[m.pid] = {});
  w.nick = cleanNick(m.nick); w.fan = fanOf(m.fan); w.seen = Date.now();
  if (m.op === 'bye') delete watchers[m.pid];
  else if (isNew && typeof joinFx === 'function') { const f = fanOf(m.fan); joinFx('watch', w.nick || '', f != null ? S.teams[f].color : '', f != null ? `${S.teams[f].name} 응원` : ''); }
  if (watchN() !== was) { schedule(); updWatch(); }
}
function updWatch() { const c = $('watchChip'); if (c) { const n = watchN(); c.textContent = n ? `👀 관전 ${n}` : ''; } }
function who(c, team) { // 보낸 사람 표시: 관전자는 닉네임·응원 팀, 팀 폰은 그 팀
  if (c.from === 'watch') { const w = watchers[c.pid] || {}; let nk = w.nick || cleanNick(c.nick) || '관전자'; const sq = (x) => String(x || '').replace(/\s/g, '').toLowerCase(); if ((S.teams || []).some((t) => sq(t.name) === sq(nk))) nk = nk.slice(0, 6) + '(관전)'; return { fan: w.fan != null ? w.fan : fanOf(c.fan), nick: nk, watch: true }; } // 👀 팀 이름과 같은 닉네임은 (관전)을 붙여 헷갈리지 않게
  if (team != null && S.teams[+team]) return { fan: +team, nick: S.teams[+team].name, watch: false };
  return { fan: null, nick: '', watch: false };
}
function watchN() { const now = Date.now(); return Object.values(watchers).filter((w) => now - w.seen < 70000).length; }
function fanOf(f) { return f != null && f !== '' && S.teams && S.teams[+f] ? +f : null; }
function cleanNick(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8); }
// 폰에서 온 명령: 보낸 폰이 그 버튼을 누를 자격이 있는지 확인하고 대신 눌러 줘요
function run(c) {
  if (c && c.from === 'watch' && !['cheer', 'say', 'bye'].includes(c.op)) return; // 관전자는 응원·한마디만
  if (c && c.sq != null && +c.sq > 0 && seq - +c.sq > 60 && !['hello', 'team', 'newteam', 'rest', 'cheer', 'say', 'quiz', 'bye'].includes(c.op)) return; // 📶 끊겼다 다시 붙은 폰이 한참 전에 누른 버튼은 무시
  const isHost = c.from === 'host' && c.pid && c.pid === hostPid;
  const pp = c.pid && phones[c.pid];
  const team = c.from === 'player' && c.team != null && !(pp && pp.dup === String(c.team)) && (!pp || pp.team == null || pp.team === String(c.team)) ? String(c.team) : null; // 다른 폰이 잡은 팀·폰이 속이는 팀 번호는 무시
  const turn = () => team != null && String(S.cur) === team;
  // 🎮 진행폰이 없으면(접속 안 했거나 1분 넘게 신호 없음) 지금 차례인 팀 폰이 진행 버튼(▶ 시작·확인 등)을 대신 눌러요
  const sub = team != null && String(subTeam()) === team;
  const owns = (el) => {
    // 🛡️ 면제권·🔁 반사는 마실 팀 폰에서 (그 팀 폰이 없을 때만 진행폰). 안 마심/마심 기록은 진행폰
    if (el.closest('#mRecT .re') && el.dataset.team != null) { const own = String(el.dataset.team); return isHost ? !teamAlive(own) : team === own; } // 🔁 되받아치기는 반사당한 팀 폰에서
    if (el.closest('#mRecB,#mRecT') && el.dataset.team != null) {
      const own = String(el.dataset.team), v = +el.dataset.v;
      if (isHost) return v <= 1 || !teamAlive(own);
      return team === own && v >= 1 && !!(recSel && recSel.st && recSel.st[+own] >= 1); // 우리 팀이 마시게 된 뒤에만 (면제권·반사 고르기)
    }
    if (isHost && el.closest('#pickOpts')) return !teamAlive(S.cur); // ±1칸·카드·상자 고르기는 차례 팀 폰 (그 팀 폰이 없을 때만 진행폰)
    if (isHost) { // 진행폰은 진행 버튼만. 팀 버튼은 그 팀 폰이 하나도 없을 때만 대신 눌러요
      if (!el.closest('#mBox')) return true;
      const o = teamsOf(el, defTeams());
      if (o === 'host') return true;
      if (o === 'board') return false;
      return o.split(',').some((x) => x !== '' && !teamAlive(x));
    }
    if (team == null) return false;
    if (team != null && !hostAlive() && el.closest('#mBox') && teamsOf(el, defTeams()) === 'host' && !isProgress(el)) { const jt = judgeTeam(); return jt === -1 ? judgeAll().includes(+team) : String(jt) === team; } // ⚖️ 판정은 안 걸린 팀 폰 (없으면 걸린 팀들 합의)
    if (sub && !el.closest('#pickOpts')) { if (el.id === 'mOk' && (el.classList.contains('pendingOk') || (typeof mPending === 'function' && mPending()) || passWaiting())) return false; /* 자기 미션 건너뛰기는 안 돼요 · 다른 팀이 면제권 고르는 중에도 기다려요 */ if (!el.closest('#mBox')) return true; if (teamsOf(el, defTeams()) === 'host') return true; }
    if (el.closest('#pickOpts')) return turn();
    if (!el.closest('#mBox')) return false; // 기록·확인·타이머 같은 진행 버튼은 진행폰만 (진행폰이 없으면 게임판에서)
    const o = teamsOf(el, defTeams());
    return o !== 'host' && o.split(',').includes(team);
  };
  const byRid = (r) => {
    const m = /^([a-z0-9]+)-(ok|act|timer|reroll)-(\d+)$/.exec(r || '');
    if (m) return m[1] === BOOT && +m[3] === (typeof MSEQ !== 'undefined' ? MSEQ : 0) ? $(SHARED[m[2]]) : null;
    return r ? document.querySelector(`[data-rid="${r}"]`) : null;
  };
  switch (c.op) {
    case 'click': case 'pick': { const el = byRid(c.rid); if (!(el && !el.disabled && shown(el) && owns(el))) break; // 닫힌 카드·남의 버튼은 무시
      if (team != null && el.closest('#mRec')) { const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (passSeq !== ms) { passAns = {}; passSeq = ms; } passAns[team] = 1; } // 🛡️ 면제권 고르기 답함
      if (!isHost && /-reroll-/.test(c.rid || '')) { const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (rerollSeq === ms) break; rerollSeq = ms; }
      if (!isHost && team != null && !hostAlive() && el.closest('#mBox') && teamsOf(el, defTeams()) === 'host' && !isProgress(el) && judgeTeam() === -1) {
        const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (jSeq !== ms) { jVotes = {}; jSeq = ms; }
        jVotes[team] = c.rid; const all = judgeAll(), got = all.filter((x) => jVotes[String(x)]);
        if (got.length < all.length) { if (typeof toast === 'function') toast(`⚖️ ${tName(team)} 판정 완료 · 다른 팀도 같은 답을 고르면 정해져요`); schedule(); break; }
        const cnt = {}; got.forEach((x) => { const r = jVotes[String(x)]; cnt[r] = (cnt[r] || 0) + 1; });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; jVotes = {};
        if (!(top && top[1] * 2 > all.length)) { jSplit = ms; if (typeof toast === 'function') toast('⚖️ 판정이 엇갈렸어요! 다 같이 보고 다시 고르거나 게임판에서 눌러 주세요'); schedule(); break; }
        const win = byRid(top[0]); if (win && !win.disabled && shown(win)) win.click(); break; // 👥 3팀 이상이면 다수결
      }
      el.click(); break; }
    case 'fill': {
      const el = byRid(c.rid);
      if (el && !el.disabled && shown(el) && owns(el)) { el.value = String(c.value || '').slice(0, 40); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      break;
    }
    case 'roll': if (window.__paused) break; if ((turn() || (isHost && !teamAlive(S.cur))) && !$('rollBtn').disabled && !busy && !$('modal').classList.contains('on')) $('rollBtn').click(); break;
    case 'taxi': { if (!(turn() || (isHost && !teamAlive(S.cur)))) break; const el = $('c' + c.cell); if (el && el.classList.contains('taxiok')) el.click(); break; }
    case 'sw': { if (!(turn() || (isHost && !teamAlive(S.cur)))) break; const b = $('mBox'); if (+c.e < 0) { if (b.__swStart) b.__swStart(); } else if (b.__sw) b.__sw(+c.e); break; }
    case 'tap': { if (team == null) break; const b = $('mBox'); if (!(b.__tap && (b.dataset.tap || b.dataset.tapLate || '').split(',').includes(team))) return;
      const now = Date.now(), w = tapWin[team] && now - tapWin[team].t < 1000 ? tapWin[team] : (tapWin[team] = { t: now, n: 0 }); const n = Math.min(25, Math.max(0, +c.n || 0), 25 - w.n); // 👆 1초에 25번까지만 (여럿이 같이 눌러도 넉넉하게)
      if (n > 0) { w.n += n; b.__tap(+team, n); } return; }
    case 'react2': { if (team == null) break; const b = $('mBox'); if (b.__react2) b.__react2(+team, +c.r, +c.ms); return; }
    case 'react': { if (!isHost && !sub) break; const b = $('mBox'); if (b.__react) b.__react(c.w === 1 ? 1 : 0); break; }
    case 'mute': if (isHost) $('muteBtn').click(); break;
    // 🚀 진행폰 없이 시작: 접속한 팀 폰이 모두 '준비 완료'면 팀 폰에서 게임 시작
    case 'start': {
      if (S.phase !== 'setup' || team == null || hostAlive()) break;
      const now = Date.now(), live = Object.values(phones).filter((p) => p.team != null && now - (p.seen || 0) < 60000);
      const notReady = live.filter((p) => !p.ready).map((p) => teamNameAt(+p.team)).filter(Boolean);
      if (notReady.length) { if (typeof toast === 'function') toast(`⏳ 아직 준비 안 된 팀: ${[...new Set(notReady)].join(', ')}`); break; }
      if ((SOLO() ? (S.solo || []).length : (S.setup || []).length) < 2) { if (typeof toast === 'function') toast(SOLO() ? '👥 2명 이상 있어야 시작할 수 있어요' : '👥 팀이 2개 이상 있어야 시작할 수 있어요'); break; }
      const b = $('startBtn'); if (b && !b.disabled) b.click(); break;
    }
    // 🔁 게임이 끝난 뒤 '같은 팀으로 한 판 더': 진행폰, 또는 진행폰이 없으면 아무 팀 폰에서
    case 'again': { if (S.phase === 'over' && (isHost || (team != null && !hostAlive()))) { const b = $('againBtn'); if (b && !b.disabled) b.click(); } break; }
    case 'bye': { if (isHost) { hostSeen = 0; updLock(); } else if (team != null) { teamSeen[team] = 0; if (pp) pp.seen = 0; } schedule(); break; } // 나가기·창 닫기
    case 'introgo': if ((isHost || team != null) && typeof window.__introEnd === 'function') window.__introEnd(); break;
    // 🎤 진행폰 전용 깜짝 이벤트 (한 판 3번 · 주사위 기다릴 때만)
    case 'mcev': if (isHost && typeof mcEvent === 'function') mcEvent(String(c.ev || '')); break;
    case 'pause': if ((isHost || sub || (team != null && !hostAlive())) && typeof setPause === 'function') setPause(!!c.on); break; // 진행폰이 없으면 아무 팀이나 멈춤·계속
    case 'undo': if (isHost && typeof undoRec === 'function') undoRec(); break;
    case 'drinkdone': { const df = $('drinkFx'); if (!df || typeof window.__drinkEnd !== 'function') break;
      if (isHost || (team != null && (window.__drinkTi || []).includes(+team))) window.__drinkEnd(); break; } // 🥃 '다 마셨어요'는 마시는 팀(번호로 비교)·진행 폰만
    // 😴 팀원 쉬기: 팀 폰(자기 팀)이나 진행폰에서 팀원 한 명을 벌주 뽑기에서 빼거나 다시 넣어요
    case 'rest': {
      if (S.phase !== 'play' || SOLO()) break; const ti = isHost && c.ti != null ? +c.ti : (team != null ? +team : -1); const t = S.teams && S.teams[ti];
      if (!t || !(t.members || []).includes(String(c.m))) break; t.out = t.out || {};
      if (c.on) t.out[String(c.m)] = 1; else delete t.out[String(c.m)];
      save(); if (typeof renderBoard === 'function') renderBoard(); break;
    }
    case 'takeover': if (isHost && S.teams && S.teams[+c.ti]) takeover(+c.ti, !!c.on); break;
    // 📣 익명 응원 (폰마다 0.7초에 한 번까지)
    case 'cheer': { const k = 'c' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 600) break; throttle[k] = now; if (typeof cheer === 'function') cheer(String(c.e || ''), who(c, team)); return; }
    // 💬 한마디 (정해진 말) · ✍️ 직접 쓴 글 (관전자 글씨가 켜져 있을 때만, 20자까지)
    case 'say': { const k = 's' + (c.pid || ''); const now = Date.now(); const free = c.txt != null;
      if (now - (throttle[k] || 0) < (free ? 4000 : 2500)) break; throttle[k] = now;
      let tx = free ? String(c.txt) : String(c.p || '');
      if (free) { if (S.chatOn === false) break; tx = typeof cleanSay === 'function' ? cleanSay(tx) : ''; } else if (typeof SAY_PRESET === 'undefined' || !SAY_PRESET.includes(tx)) break;
      if (!tx) break; if (typeof say === 'function') say(tx, who(c, team)); return; }
    // 🧠 혼자 푸는 위스키 상식: 맞힌 개수만 팀에 쌓여요 (게임 승패와는 상관없음, 폰마다 8초에 한 번까지)
    case 'quiz': { if (team == null || S.phase !== 'play' || !c.ok) break; const k = 'q' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 8000) break; throttle[k] = now;
      const t = S.teams[+team]; if (t) { t.qz = (t.qz || 0) + 1; save(); } return; }
    // ✏️ 게임 시작 전: 팀 폰에서 우리 팀 이름·멤버를 적어요 (자기 팀만)
    case 'team': {
      if (S.phase !== 'setup' || team == null) break;
      const arr = SOLO() ? S.solo : S.setup, i = +team, t = arr && arr[i];
      if (!t) break;
      t.name = String(c.name || '').replace(/\s+/g, ' ').slice(0, SOLO() ? 8 : 10);
      if (!SOLO()) t.mem = String(c.mem || '').slice(0, 80);
      save();
      const nm = $('tlist').querySelectorAll('.nm')[i], mem = $('tlist').querySelectorAll('.mem')[i];
      if (nm && document.activeElement !== nm) nm.value = t.name;
      if (mem && !SOLO() && document.activeElement !== mem) mem.value = t.mem;
      break;
    }
    // ➕ 게임 시작 전: 폰에서 팀(개인전은 사람) 칸을 하나 더 만들어요
    // 👑 팀장 폰: 새 팀 만들기 → 비어 있는 팀 칸(이름·멤버·폰 없음)을 먼저 쓰고, 없으면 칸을 하나 더 만들어요
    case 'newteam': {
      if (S.phase !== 'setup' || !c.pid) break;
      if (claims[tag(c.pid)] != null && phones[c.pid] && phones[c.pid].team === String(claims[tag(c.pid)])) break;
      const solo = SOLO(), arr = solo ? S.solo : S.setup, L = phoneList();
      { const ci = claims[tag(c.pid)]; if (ci != null && arr[ci] && !(L[String(ci)] || []).some((x) => x.on && x.k !== tag(c.pid))) { notePhone({ from: 'player', pid: c.pid, team: ci, t: 'cmd' }); schedule(); break; } } // 나갔다가 다시 '팀 만들기'면 예전 칸으로
      let i = arr.findIndex((t, j) => !(t.name || '').trim() && !(t.mem || '').trim() && !(L[String(j)] || []).some((x) => x.on));
      if (i < 0) { if (arr.length >= (solo ? 10 : 6)) break; arr.push(solo ? { name: '' } : { name: '', mem: '' }); i = arr.length - 1; }
      claims[tag(c.pid)] = i; const p = phones[c.pid] || (phones[c.pid] = {}); p.seen = Date.now();
      save(); const f = document.activeElement; renderSetup(); if (f && f !== document.body && f.focus && document.contains(f)) f.focus();
      notePhone({ from: 'player', pid: c.pid, team: i, t: 'cmd' });
      break;
    }
    case 'addteam': {
      if (S.phase !== 'setup' || !$('addT') || $('addT').hidden) break;
      const k = 'a' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 1500) break; throttle[k] = now;
      const f = document.activeElement; $('addT').click(); if (f && f !== document.body && f.focus) f.focus(); else if (document.activeElement) document.activeElement.blur();
      break;
    }
  }
  schedule();
}
// ⏩ 자동 진행: 진행 버튼(시작·공개·미션 시작)은 12초, 결과가 다 나온 카드의 '확인'은 20초 동안 아무도 안 누르면 저절로 눌러요
//    (진행폰을 든 사람이 잠깐 자리를 비워도 게임이 멈추지 않게. 누가 카드 안을 누르면 시간이 다시 처음부터)
const AUTO_GO = 12000, AUTO_OK = 12000; // 결과 확인도 12초 (아무도 안 누를 때 한 차례가 너무 길어서)
let autoEl = null, autoAt = 0, autoMs = 0, autoTxt = '', autoMax = 0;
// 🤖 멈춤 방지: 팀이 눌러야 하는 것(주사위·고르기·미션 버튼)도 오래 아무도 안 누르면 앱이 대신 (팀 폰이 끊겼으면 20초, 연결돼 있으면 45초)
const AUTO_TEAM = 20000, AUTO_TEAM_LIVE = 30000; // 폰이 있는 팀은 30초 (10초 지나면 경고, 마지막 10초는 카운트다운)
const tName = (i) => (S.teams && S.teams[+i] ? S.teams[+i].name : '');
function autoCand() {
  if (S.phase !== 'play') return null;
  if (!$('modal').classList.contains('on')) {
    if ($('pick').classList.contains('on')) { const os = [...$('pickOpts').querySelectorAll('button')].filter((b) => !b.disabled && shown(b)); if (os.length) return [os[0], teamAlive(S.cur) ? AUTO_TEAM_LIVE : AUTO_TEAM, os, `${tName(S.cur)} 대신 자동으로 골라요`, S.cur]; return null; }
    if ($('taxibar').classList.contains('on')) { const cs = [...document.querySelectorAll('.cell.taxiok')]; if (cs.length) return [cs[0], teamAlive(S.cur) ? AUTO_TEAM_LIVE : AUTO_TEAM, cs, `${tName(S.cur)} 대신 자동으로 택시 칸을 골라요`, S.cur]; return null; }
    const rb = $('rollBtn'); if (rb && !rb.disabled && !busy && shown(rb) && !$('drinkFx') && !$('introFx')) return [rb, teamAlive(S.cur) ? AUTO_TEAM_LIVE : AUTO_TEAM, null, `${tName(S.cur)} 대신 자동으로 굴려요`, S.cur];
    return null;
  }
  const act = $('mAct'); if (shown(act) && !act.disabled) return [act, AUTO_GO];
  const box = $('mBox');
  if (shown(box)) for (const b of box.querySelectorAll('button')) {
    if (!shown(b) || b.disabled) continue; const t = (b.textContent || '').trim();
    if (/^🔁/.test(t)) continue;
    if (b.classList.contains('swbtn')) return [b, teamAlive(S.cur) ? AUTO_TEAM_LIVE : AUTO_TEAM, null, `${tName(S.cur)} 대신 자동으로 스톱워치를 눌러요`, S.cur]; // ⏱️ 팀 폰이 있으면 45초 기다려요 (게임판이 12초 만에 혼자 시작하지 않게)
    if (teamsOf(b, '') === 'host' && isProgress(b)) return [b, AUTO_GO];
  }
  // ⚖️ 사람이 판정하는 버튼은 순서대로 누르지 않고, 오래(30초) 아무도 안 고르면 앱이 무작위로 골라요
  if (shown(box) && jSplit !== (typeof MSEQ !== 'undefined' ? MSEQ : 0)) { const jb = [...box.querySelectorAll('button')].filter((b) => shown(b) && !b.disabled && teamsOf(b, '') === 'host' && !isProgress(b) && !/^🔁/.test((b.textContent || '').trim())); if (jb.length) return [jb[0], AUTO_TEAM_LIVE, jb, '판정이 없어서 앱이 무작위로 골라요']; }
  const ok = $('mOk'); if (shown(ok) && !ok.disabled && typeof mPending === 'function' && !mPending()) { if (passWaiting()) return null; return [ok, AUTO_OK]; }
  // 팀 버튼(게임판 패드·글자 입력 제외)을 오래 안 누르면 그 팀 대신 하나 골라요
  if (shown(box)) {
    const tb = [...box.querySelectorAll('button')].filter((b) => shown(b) && !b.disabled && !b.classList.contains('react-pad') && !b.classList.contains('tappad') && !b.closest('[data-teams=board]'));
    const by = {}; tb.forEach((b) => { const o = teamsOf(b, defTeams()); if (o === 'host' || o === 'board' || !o) return; const k = o.split(',')[0]; (by[k] = by[k] || []).push(b); });
    const k = Object.keys(by)[0];
    if (k != null) return [by[k][0], teamAlive(k) ? AUTO_TEAM_LIVE : AUTO_TEAM, by[k], `${tName(k)} 대신 자동으로 골라요`, +k];
  }
  return null;
}
// 🛡️ 마시게 된 팀이 면제권을 가지고 있고 폰이 있으면, 고를 때까지(최대 15초) 확인을 기다려요
let passAns = {}, passSeq = -1, doneAt = 0, lastRk = '';
function passWaiting() {
  try { if (typeof recSel === 'undefined' || !recSel || !recSel.st || typeof MDONE === 'undefined' || !MDONE) return false;
    if (!doneAt || Date.now() - doneAt > 15000) return false; const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (passSeq !== ms) { passAns = {}; passSeq = ms; }
    return Object.keys(recSel.st).some((i) => recSel.st[i] >= 1 && (!recSel.only || recSel.only.includes(+i)) && S.teams[i] && (S.teams[i].pass || 0) > 0 && teamAlive(i) && !passAns[i]); } catch (e) { return false; }
}
function autoTick() {
  if (!room) return;
  { const mb = $('mBox'); const rk = (typeof MDONE !== 'undefined' ? MDONE : '') + '|' + (typeof MSEQ !== 'undefined' ? MSEQ : '') + '|' + (mb ? [...mb.querySelectorAll('.res')].map((r) => r.textContent).join('').length : 0);
    if (rk !== lastRk) { lastRk = rk; if (typeof MDONE !== 'undefined' && MDONE) { autoEl = null; doneAt = Date.now(); } } } // 결과가 새로 나오면 자동 확인 시계를 처음부터 (결과를 12초는 보게)
  if (window.__paused) { if (autoEl) autoAt = Math.max(autoAt, Date.now() + 10000); autoMax = Math.max(autoMax, autoAt); setAuto(''); setWarn(null); return; }
  const c = autoCand(); const now = Date.now();
  if (!c) { autoEl = null; setAuto(''); setWarn(null); return; }
  if (c[0] !== autoEl || c[1] !== autoMs) { autoEl = c[0]; autoMs = c[1]; autoAt = now + c[1]; autoMax = now + c[1] * (c[2] !== undefined ? 1.5 : 3); }
  if (autoAt > autoMax) autoAt = autoMax; // 누가 계속 눌러도 최대 3배 시간 뒤엔 넘어가요
  const left = Math.ceil((autoAt - now) / 1000);
  if (left <= 0) { const el = c[2] && c[2].length ? c[2][Math.floor(Math.random() * c[2].length)] : autoEl; autoEl = null; setAuto(''); setWarn(null); el.click(); return; }
  // 📣 폰이 있는 팀이 한참 안 누르면: 10초 지나면 그 팀 폰에 경고(진동), 마지막 10초는 카운트다운 경고
  const live = c[4] != null && c[1] === AUTO_TEAM_LIVE && teamAlive(String(c[4]));
  const wst = live ? (left <= 10 ? 2 : left <= 20 ? 1 : 0) : 0;
  setWarn(wst ? { id: autoMax, ti: +c[4], st: wst, left, what: /굴려요/.test(c[3] || '') ? 'roll' : 'pick' } : null);
  setAuto(left <= 10 ? (c[3] ? `🤖 ${left}초 뒤 ${c[3]}` : `⏩ ${left}초 뒤 자동으로 ‘${(c[0].textContent || '').trim().slice(0, 18)}’`) : wst === 1 ? `👋 ${tName(c[4])} 차례예요! 팀 폰에서 눌러 주세요` : '');
}
let autoWarn = null, warnKey = '';
function setWarn(w) { const k = w ? `${w.ti}|${w.st}|${w.st === 2 ? w.left : ''}` : ''; if (k === warnKey) { if (w) autoWarn.left = w.left; return; } warnKey = k; autoWarn = w; schedule(); }
function setAuto(t) {
  if (t === autoTxt) return; autoTxt = t;
  let n = $('autoNote'); if (!n) { n = document.createElement('div'); n.id = 'autoNote'; document.body.appendChild(n); }
  n.textContent = t; n.hidden = !t; schedule();
}
document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('#modal') && autoEl && !e.target.closest('#mOk')) autoAt = Date.now() + autoMs; }, true);
function hello(m) {
  // 진행폰 자리가 비어 있으면 처음 인사한 진행폰이 차지해요
  if (m.from === 'host' && m.pid && !hostPid) { hostPid = m.pid; try { localStorage.setItem(hostKey(), hostPid); } catch (e) { /* 무시 */ } }
  if (m.from === 'host' && m.pid && m.pid === hostPid) { hostSeen = Date.now(); updLock(); }
  publish(true);
}
function resetHost() { hostPid = null; hostSeen = 0; updLock(); try { localStorage.removeItem(hostKey()); } catch (e) { /* 무시 */ } publish(true); }

async function connect(code) {
  room = code;
  try { hostPid = localStorage.getItem(hostKey()); } catch (e) { hostPid = null; }
  const kind = transportKind() === 'none' ? 'local' : transportKind();
  tp = await createTransport({ kind, room, role: 'host', url: WS_URL, firebase: FIREBASE });
  tp.on((m) => { if (!m) return; notePhone(m); noteWatch(m); if (m.t === 'cmd' && m.from === 'player' && m.team != null && forced[String(m.team)] && !['cheer', 'quiz'].includes(m.op)) takeover(m.team, false); if (m.from === 'player' && m.team != null && !(phones[m.pid] && phones[m.pid].dup)) { const k = String(m.team), was = teamAlive(k); teamSeen[k] = Date.now(); if (!was) { updLock(); schedule(); } } if (m.t === 'hello') hello(m); else if (m.t === 'cmd') { if (m.from === 'host' && m.pid && !hostPid) hello(m); if (m.from === 'host' && m.pid && m.pid === hostPid) { hostSeen = Date.now(); updLock(); } run(m); } });
  NT.setInterval(updLock, 3000); NT.setInterval(updWatch, 5000); NT.setInterval(autoTick, 1000); NT.setInterval(schedule, 3000); // 폰이 말없이 끊겨 판정·진행 폰이 바뀌면 3초 안에 알려요 (내용이 같으면 안 보내요)
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
      <h2>📱 폰으로 참가하기</h2><p>카메라로 QR을 찍고 우리 팀을 고르면 끝! · 팀장이 아니면 <b>👀 관전자</b>로 들어와서 응원해요</p>
      <div id="netQR"></div><div class="np-code"></div><a class="np-url" target="_blank" rel="noopener"></a>
      <p class="np-help" style="font-weight:700;margin-top:10px">지금 접속한 폰</p><div id="npPhones" class="np-help" style="margin:0"></div><p class="np-help">팀 폰이 반응이 없어서 게임이 멈추면 ‘⏭️ 대신 하기’를 눌러요. 그 팀 몫을 진행폰(없으면 게임판)에서 누를 수 있게 되고, 그 팀 폰에서 다시 누르면 저절로 돌아가요.</p>
      <details class="np-host"><summary>🎮 진행자 폰 연결 (선택 · 없어도 돼요)</summary><div id="netQRh"></div><p class="np-help">진행폰은 한 대만 들어올 수 있어요. 처음 들어온 폰이 진행폰이 돼요.</p>
        <button class="ghost" id="npReset">🔁 진행폰 바꾸기</button> <span id="npHost"></span>
        <p class="np-help">진행폰이 연결돼 있으면 게임 중에는 게임판 버튼이 잠기고 진행폰으로만 진행해요. 진행폰 신호가 1분 동안 없으면 저절로 풀려요.</p>
        <button class="ghost" id="npLock">🔓 게임판에서도 누르기</button></details></div>`;
    document.body.appendChild(o);
    o.querySelector('.np-x').onclick = () => o.classList.remove('on');
    o.onclick = (e) => { if (e.target === o) o.classList.remove('on'); };
    o.querySelector('#npReset').onclick = () => { resetHost(); o.querySelector('#npHost').textContent = '비웠어요. 새 진행폰이 들어오면 돼요'; };
    o.querySelector('#npLock').onclick = () => { lockOff = !lockOff; updLock(); };
  }
  const url = remoteURL('player');
  o.querySelector('.np-code').textContent = room;
  const a = o.querySelector('.np-url'); a.href = url; a.textContent = url.replace(/^https?:\/\//, '');
  const big = Math.min(420, Math.floor(Math.min(innerWidth, innerHeight) * 0.5));
  const q = $('netQR'); const svg = qrSVG(url, big); q.innerHTML = svg || '(QR을 만들지 못했어요. 주소를 직접 알려 주세요)';
  const qh = $('netQRh'); qh.innerHTML = qrSVG(remoteURL('host'), 180) || '';
  updLock();
  o.classList.add('on');
}
// 게임 중에도 늦게 온 사람이 들어올 수 있게 구석에 작은 QR
function miniQR() {
  let m = $('netMini');
  if (!m) { m = document.createElement('button'); m.id = 'netMini'; m.title = '폰 연결 QR 크게 보기'; m.onclick = showQR; document.body.appendChild(m); }
  m.innerHTML = (qrSVG(remoteURL('player'), 120) || '') + `<b>${room}</b><i id="watchChip"></i>`; updWatch();
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
const lockCss = document.createElement('style');
lockCss.textContent = `body.teamRoll #rollBtn,body.teamRoll #mBox .swbtn,body.teamRoll #pick .opts,body.teamRoll .board .cell.taxiok,body.hostLock #rollBtn,body.hostLock #boostBtn,body.hostLock #mOk,body.hostLock #mBox button,body.hostLock #mBox input,body.hostLock #mRecB button,body.hostLock .tcard .minus,body.hostLock #pick .opts,body.hostLock #pick button,body.hostLock .board .cell,body.hostLock #modal .card button{pointer-events:none}
body.hostLock #rollBtn,body.hostLock #mOk,body.teamRoll #rollBtn{opacity:.75}
body.hostLock #modal #mBox .react-pad,body.hostLock #modal #mBox .reactgo,body.hostLock #modal #mBox .tappad{pointer-events:auto}
#lockNote{top:58px!important;bottom:auto!important;display:none;position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:60;background:rgba(20,30,40,.82);color:#fff;font-size:14px;font-weight:700;padding:6px 14px;border-radius:999px;pointer-events:none}
body.hostLock #lockNote{display:block}
@media (min-width:1241px) and (max-width:1440px){#lockNote{left:calc(50% - 130px)!important}#autoNote{left:calc(50% - 130px)!important}}
@media (min-width:901px) and (max-width:1240px){#lockNote{top:156px!important}#autoNote{top:auto!important;bottom:100px!important}}
@media (min-width:901px) and (max-width:1099px){body:has(#modal.on) #autoNote{top:8px!important;bottom:auto!important}}
@media (max-width:900px){#lockNote{top:auto!important;bottom:58px!important;font-size:13px}#autoNote{top:auto!important;bottom:96px!important;font-size:14px!important}}`;
document.head.appendChild(lockCss);
{ const ln = document.createElement('div'); ln.id = 'lockNote'; ln.textContent = '🎮 진행폰으로 진행 중 · 게임판 버튼은 잠겨 있어요'; document.body.appendChild(ln); }
st.textContent = `#setup .npPh{font-size:15px}
#autoNote{position:fixed;left:50%;top:98px;transform:translateX(-50%);z-index:80;background:#1f2a33;color:#ffd84d;font-weight:700;font-size:16px;padding:6px 16px;border-radius:999px;pointer-events:none}
#chips .npPh{position:absolute;top:7px;right:38px;display:inline-flex;align-items:center;gap:6px;font-size:15px;font-weight:800;color:#8a96a3;margin:0;padding:3px 10px 3px 8px;border-radius:999px;background:#eef1f4;max-width:55%;overflow:hidden;white-space:nowrap}
#chips.many .npPh{font-size:0;gap:0;padding:5px}#chips.many .npPh::before{width:12px;height:12px}
#chips .npPh::before{content:'';width:10px;height:10px;border-radius:50%;background:#b5bec8;flex:none}
#chips .npPh[data-st=on]{color:#0d7f53;background:#dff6ea}#chips .npPh[data-st=on]::before{background:#13A36B;box-shadow:0 0 0 0 rgba(19,163,107,.7);animation:npPulse 1.6s infinite}
#chips .npPh[data-st=off]{color:#c23636;background:#ffe3e3}#chips .npPh[data-st=off]::before{background:#D64545;animation:npBlink 1s infinite}
@keyframes npPulse{70%{box-shadow:0 0 0 8px rgba(19,163,107,0)}100%{box-shadow:0 0 0 0 rgba(19,163,107,0)}}@keyframes npBlink{50%{opacity:.25}}
.npPh{font-size:13px;font-weight:700;color:#8a96a3;margin-top:4px}.npPh[data-st=on]{color:#13A36B}.npPh[data-st=off]{color:#D64545}
#netDot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#bbb;margin-left:4px;vertical-align:middle}
#netDot[data-st=online]{background:#13A36B}#netDot[data-st=offline]{background:#D64545}
#netPanel{position:fixed;inset:0;background:rgba(10,30,40,.55);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}
#netPanel.on{display:flex}
.np-box{position:relative;background:#fff;color:#1d2b33;border-radius:22px;padding:22px 20px;max-width:520px;width:100%;max-height:calc(100vh - 32px);overflow:auto;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.np-box h2{margin:0 0 4px;font-family:"Black Han Sans",sans-serif;font-size:24px}.np-box p{margin:4px 0 12px;font-size:14px;color:#556}
#netQR,#netQRh{display:flex;justify-content:center;margin:8px 0}
.np-host{margin-top:10px;font-size:14px;color:#556;text-align:center}.np-host summary{cursor:pointer;font-weight:700}
#netMini{position:fixed;right:12px;bottom:12px;z-index:30;background:#fff;border:0;border-radius:14px;padding:6px 6px 4px;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font:inherit}
#netMini i{font-style:normal;font-size:12px;font-weight:800;color:#555}#netMini i:empty{display:none}
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
