// 게임판(노트북·TV)에서 돌아가는 연결 모듈
import { createTransport } from './transport.js';
import { transportKind, WS_URL, FIREBASE } from './config.js';

const $ = (id) => document.getElementById(id);
const safeBoardFn = (name) => (typeof window !== 'undefined' && typeof window[name] === 'function') ? window[name] : null;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let tp = null, room = null, ridN = 0, lastJson = '', timer = 0, seq = 0, firstWait = 0;
const NT = window.__native || { setTimeout: window.setTimeout.bind(window), setInterval: window.setInterval.bind(window), clearTimeout: window.clearTimeout.bind(window) };
const BOOT = Math.random().toString(36).slice(2, 6);
const rid = (el) => el.dataset.rid || (el.dataset.rid = BOOT + '-' + (++ridN));
const SHARED = { ok: 'mOk', act: 'mAct', timer: 'mTimer', reroll: 'mReroll' };
const srid = (k) => `${BOOT}-${k}-${typeof MSEQ !== 'undefined' ? MSEQ : 0}`;

let hostPid = null;
let hostSeen = 0, lockOff = false;
const HOST_ALIVE_MS = 60000;
function hostAlive() { return !!hostPid && Date.now() - hostSeen < HOST_ALIVE_MS; }

const teamSeen = {};
const forced = {};
function teamAlive(i) { return !forced[String(i)] && Date.now() - (teamSeen[String(i)] || 0) < HOST_ALIVE_MS; }
window.__teamAlive = (i) => teamAlive(i);
window.__teamPhoneCount = (i) => Object.values(phones).filter((p) => p.team === String(i) && Date.now() - (p.seen || 0) < HOST_ALIVE_MS).length;

function judgeTeam() {
  const s = subTeam(); if (s == null) return null;
  const n = S.teams.length, inv = String(defTeams()).split(',');
  for (let k = 0; k < n; k++) { const i = (S.cur + k) % n; if (teamAlive(i) && !inv.includes(String(i))) return i; }
  const real = inv.filter((x) => /^\d+$/.test(x));
  return real.length >= 2 && real.every((x) => teamAlive(x)) ? -1 : -2;
}
const judgeAll = () => String(defTeams()).split(',').filter((x) => x !== '' && teamAlive(x)).map(Number);
let jVotes = {}, jSeq = -1, jSplit = -1; const tapWin = {};
let rerollSeq = -1;

function subTeam() {
  if (hostAlive() || S.phase !== 'play' || !S.teams) return null;
  const n = S.teams.length;
  for (let k = 0; k < n; k++) { const i = (S.cur + k) % n; if (teamAlive(i)) return i; }
  return null;
}
function takeover(i, on) {
  const k = String(i);
  if (on) forced[k] = Date.now(); else delete forced[k];
  updLock(); schedule();
  if (on && typeof toast === 'function' && S.teams && S.teams[+k]) toast(`⏭️ ${S.teams[+k].name} 몫은 잠시 진행폰·게임판에서 대신 눌러요`);
}

// 📱 접속한 폰 목록 (다인원 팀원 접속 지원)
const phones = {};
const claims = {};
function notePhone(m) {
  if (!m || m.from !== 'player' || !m.pid) return;
  const p = phones[m.pid] || (phones[m.pid] = {});
  const tm = m.team != null ? String(m.team) : null;
  const nk = m.nick != null ? String(m.nick).slice(0, 8) : p.nick;
  const isSub = m.sub != null ? !!m.sub : !!p.sub;
  const changed = p.team !== tm || p.nick !== nk || (m.t === 'hello' && !!m.ready !== !!p.ready) || !p.seen;
  const joinedNow = tm != null && p.team !== tm;
  const readyNow = m.t === 'hello' && !!m.ready && !p.ready && tm != null;

  p.dup = null;
  p.team = tm;
  if (m.nick != null) p.nick = nk;
  if (m.sub != null) p.sub = isSub;
  if (m.t === 'hello') p.ready = !!m.ready;
  p.seen = Date.now();

  if (readyNow && !joinedNow && !p.sub && typeof toast === 'function' && S.phase === 'setup') {
    const n = teamNameAt(+tm);
    if (n) toast(`✅ ${n} 준비 완료!${p.nick ? ` (팀장 ${p.nick})` : ''}`);
  }
  if (joinedNow && typeof toast === 'function' && typeof joinFx !== 'function') {
    const n = teamNameAt(+tm);
    if (n) toast(p.sub ? `🙋 ${n} 팀원 ${p.nick || ''} 합류!` : (/^[A-F]팀$|^\d+번$/.test(n) && S.phase === 'setup' ? `📱 새 팀 폰이 들어왔어요` : `📱 ${n} 폰이 들어왔어요${p.nick ? ` (${p.nick})` : ''}`));
  }
  if (changed) { drawPhones(); schedule(); }
}

function phoneList() {
  const now = Date.now(), out = {};
  for (const [pid, p] of Object.entries(phones)) {
    const age = now - (p.seen || 0); if (age > 180000) { delete phones[pid]; continue; }
    const k = p.team == null ? 'wait' : p.team;
    (out[k] = out[k] || []).push({ nick: p.nick || '', on: age < HOST_ALIVE_MS, ready: !!p.ready, sub: !!p.sub, k: tag(pid) });
  }
  return out;
}

const setupNames = () => (SOLO() ? (S.solo || []) : (S.setup || [])).map((t, i) => (t.name || '').trim() || (SOLO() ? `${i + 1}번` : `${'ABCDEF'[i]}팀`));
const teamNameAt = (i) => S.phase === 'setup' ? setupNames()[i] : (S.teams && S.teams[i] ? S.teams[i].name : '');

function drawPhoneSum(L) {
  const e = $('phoneSum'); if (!e) return;
  if (S.phase !== 'setup') { if (!e.hidden) e.hidden = true; return; }
  const names = setupNames(), joined = names.map((n, i) => ({ n, a: (L[String(i)] || []).filter((x) => x.on) })).filter((x) => x.a.length);
  const ready = joined.filter((x) => x.a.some((y) => y.ready && !y.sub)), picking = (L.wait || []).filter((x) => x.on).length;
  const totalPhones = Object.values(phones).filter((p) => Date.now() - (p.seen || 0) < HOST_ALIVE_MS).length;
  const who = joined.map((x) => {
    const nks = x.a.map((y) => y.nick).filter(Boolean);
    return `${x.n}${nks.length ? `(${nks.join(',')})` : `(${x.a.length}대)`}${x.a.some((y) => y.ready && !y.sub) ? '✅' : ''}`;
  }).join(' · ');
  const t = !joined.length && !picking ? '📱 아직 접속한 폰이 없어요 · QR을 찍으면 들어와요'
    : `📱 접속 폰 ${totalPhones}대 · 팀 ${joined.length}/${names.length} · ✅ 준비 ${ready.length}/${joined.length}` + (picking ? ` · 👀 고르는 중 ${picking}대` : '') + (who ? `\n${who}` : '')
      + (joined.length && ready.length === joined.length ? '\n🎉 접속한 팀 모두 준비! ‘게임 시작’을 눌러요' : '');
  if (e.textContent !== t) e.textContent = t; if (e.hidden) e.hidden = false;
}

const setupText = (arr) => {
  const on = (arr || []).filter((x) => x.on);
  if (!on.length) return arr && arr.length ? '📱 폰 신호 끊김' : '📱 폰 없음 (게임판에서 적어도 돼요)';
  const nk = on.map((x) => x.nick).filter(Boolean);
  return `📱 ${on.length}대 접속${nk.length ? ` (${nk.join('·')})` : ''} · ${on.some((x) => x.ready && !x.sub) ? '✅ 준비 완료' : '⏳ 준비 중'}`;
};
const chipText = (arr) => {
  const on = (arr || []).filter((x) => x.on);
  if (!arr || !arr.length) return '폰 없음';
  if (!on.length) return '📵 끊김';
  return on.length > 1 ? `📱 ${on.length}대` : `📱 ${on[0].nick || '연결'}`;
};
const phoneText = (arr) => {
  if (!arr || !arr.length) return '📱 폰 없음';
  const on = arr.filter((x) => x.on), off = arr.length - on.length;
  const nm = on.map((x) => x.nick).filter(Boolean);
  return (on.length ? `📱 ${nm.length ? nm.join('·') + (on.length > nm.length ? ` 외 ${on.length - nm.length}대` : '') : on.length + '대'} 접속` : '📱 폰 신호 끊김') + (on.length && off ? ` · ${off}대 끊김` : '');
};

const prevSt = {};
function phoneFx(L) {
  if (typeof joinFx !== 'function') return;
  const names = S.phase === 'setup' ? setupNames() : (S.teams || []).map((t) => t.name);
  names.forEach((n, i) => {
    const arr = L[String(i)], st = arr && arr.some((x) => x.on) ? 'on' : arr && arr.length ? 'off' : '', was = prevSt[i] || '';
    prevSt[i] = st; if (st === was) return;
    const col = S.phase === 'setup' ? '' : (S.teams[i] && S.teams[i].color) || '';
    const nk = (arr || []).filter((x) => x.on).map((x) => x.nick).filter(Boolean).join('·');
    const nm = S.phase === 'setup' && /^[A-F]팀$|^\d+번$/.test(n) ? '새 팀' : n;
    joinFx.idx = S.phase === 'setup' ? null : i;
    if (st === 'on') joinFx(was === 'off' ? 'back' : 'join', nm, col, nk || '');
    else if (was === 'on') joinFx('lost', nm, col, st === 'off' ? '신호가 끊겼어요' : '나갔어요');
  });
}

window.__drawPhones = () => drawPhones();
function drawPhones() {
  if (!room) return;
  const L = phoneList(); drawPhoneSum(L); try { phoneFx(L); } catch (e) {}
  const put = (box, i) => {
    if (!box) return;
    let e = box.querySelector(':scope > .npPh');
    if (!e) { e = document.createElement('div'); e.className = 'npPh'; box.appendChild(e); }
    const arr = L[String(i)]; const t = S.phase === 'setup' ? setupText(arr) : chipText(arr);
    if (e.textContent !== t) e.textContent = t;
    const c = arr && arr.some((x) => x.on) ? 'on' : arr && arr.length ? 'off' : '';
    if (e.dataset.st !== c) e.dataset.st = c;
  };
  if (S.phase === 'setup') [...($('tlist') ? $('tlist').children : [])].forEach(put);
  else if ($('chips')) [...$('chips').children].forEach(put);
  const pl = $('npPhones');
  if (pl) {
    const names = S.phase === 'setup' ? setupNames() : (S.teams || []).map((t) => t.name);
    const key = names.map((n, i) => n + phoneText(L[String(i)]) + !!forced[String(i)]).join('|') + S.phase;
    if (pl.dataset.k !== key) {
      pl.dataset.k = key; pl.innerHTML = '';
      names.forEach((n, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin:3px 0';
        const sp = document.createElement('span'); sp.textContent = `${n}: ${forced[String(i)] ? '⏭️ 대신 하는 중' : phoneText(L[String(i)])}`; row.appendChild(sp);
        const has = (L[String(i)] || []).some((x) => x.on);
        if (S.phase === 'play' && (has || forced[String(i)])) {
          const b = document.createElement('button'); b.className = 'ghost'; b.style.cssText = 'font-size:13px;padding:4px 10px';
          b.textContent = forced[String(i)] ? '📱 팀 폰에 돌려주기' : '⏭️ 대신 하기'; b.onclick = () => takeover(i, !forced[String(i)]); row.appendChild(b);
        }
        pl.appendChild(row);
      });
    }
  }
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
  try { drawPhones(); } catch (e) {}
}

const throttle = {};
const hostKey = () => 'jumarble-host-' + room;
const tag = (pid) => { let h = 7; for (const c of String(pid || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return pid ? h.toString(36) : ''; };
const shown = (el) => el && !el.hidden && el.offsetParent !== null;

function isProgress(el) {
  if (!el || el.tagName !== 'BUTTON') return false;
  if (el.classList.contains('countbtn')) return true;
  const t = (el.innerText || el.textContent || '').trim();
  return /^(▶|❓|🧩|🔔|⏲|⏱|🔁 한 번 더|🎰 룰렛)/.test(t) || /(시작|공개|돌리기|외치기)$/.test(t);
}
function teamsOf(el, def) {
  if (el.dataset && el.dataset.teams) return String(el.dataset.teams);
  if (isProgress(el)) return 'host';
  const z = el.closest('[data-teams]');
  return z ? String(z.dataset.teams) : def;
}

function blocks(root, def) {
  const out = [];
  const walk = (node) => {
    for (const el of node.children) {
      if (!shown(el)) continue;
      if (el.tagName === 'BUTTON') {
        const tm = teamsOf(el, def); const secret = !!el.closest('.picked');
        out.push({ k: 'btn', rid: rid(el), label: el.innerText.trim() || el.textContent.trim(), dis: el.disabled, cls: secret ? el.className.replace(/\bsel[OX]\b/g, '').replace(/\s+/g, ' ').trim() : el.className, teams: tm, j: tm === 'host' && !isProgress(el) ? 1 : 0 });
      } else if (el.tagName === 'INPUT') {
        out.push({ k: 'in', rid: rid(el), ph: el.placeholder || '', teams: teamsOf(el, def), dis: el.disabled });
      } else if (el.classList.contains('wheel')) {
        out.push({ k: 'txt', cls: 'dice', text: el.classList.contains('done') ? '🎡 룰렛 멈췄어요! (게임판을 봐 주세요)' : '🎡 룰렛 (게임판에서 돌아가요)' });
      } else if (el instanceof SVGElement) {
        continue;
      } else if (el.classList.contains('mdice') || el.classList.contains('duel') && !el.querySelector('button')) {
        out.push({ k: 'txt', cls: 'dice', text: '🎲 (게임판을 봐 주세요)' });
      } else if (el.classList.contains('pchips')) {
        out.push({ k: 'txt', cls: 'cap pl', text: '👤 이번 선수: ' + [...el.querySelectorAll('.pchip')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' · ') });
      } else if (el.classList.contains('rvRow')) {
        out.push({ k: 'txt', cls: 'big-num rv', text: el.dataset.sum || '🎴 공개 중…' });
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
    t: 'state', seq: 0, room, host: tag(hostPid), hostOn: hostAlive(), subTm: subTeam(), judge: judgeTeam(), judgeAll: judgeTeam() === -1 ? judgeAll() : [], jv: jSeq === (typeof MSEQ !== 'undefined' ? MSEQ : 0) ? Object.keys(jVotes).map(Number) : [], boot: BOOT, dup: [], teamsOn: (S.teams || []).map((_, i) => i).filter(teamAlive), phones: phoneList(), forced: Object.keys(forced).map(Number), auto: autoTxt, now: window.__nowTxt || '', mc: hostAlive() && typeof mcText === 'function' ? mcText() : '', mcLeft: S.mcLeft == null ? 3 : S.mcLeft, claims: S.phase === 'setup' ? claims : {}, turnNo: S.turnNo || 0, paused: !!window.__paused, fx: window.__fx || null, intro: $('introFx') ? [...$('introFx').querySelectorAll('.in-l')].map((d) => d.textContent) : null, undo: $('undoBtn') && !$('undoBtn').hidden ? ($('undoBtn').title || '방금 기록') : '',
    drink: $('drinkFx') && !$('drinkFx').classList.contains('out') ? { ti: window.__drinkTi || [], h: $('drinkFx').querySelector('.dfx-h').textContent, l: [...$('drinkFx').querySelectorAll('.dfx-l div')].map((d) => d.textContent), cd: $('drinkFx').querySelector('.dfx-cd').textContent } : null, toast: window.__toast || null, mseq: typeof MSEQ !== 'undefined' ? MSEQ : 0,
    warn: autoWarn, wn: watchN(), chatOn: S.chatOn !== false, phrases: typeof SAY_PRESET !== 'undefined' ? SAY_PRESET : [],
    phase: S.phase, pack: S.pack || 'drinks', facOn: S.facOn !== false, factions: typeof FACTIONS !== 'undefined' ? FACTIONS : [], juru: JURU(), solo: SOLO(), cur: S.cur, goal: S.goal || 3, cap: S.cap || 0,
    sub: $('subT') ? $('subT').textContent : '', log: $('log').textContent, cast: $('cast') ? $('cast').textContent : '', final: !!S.final,
    teams: S.phase === 'setup' ? (SOLO() ? (S.solo || []) : (S.setup || [])).map((t, i) => ({ i, name: (t.name || '').trim() || (SOLO() ? `${i + 1}번` : `${'ABCDEF'[i]}팀`), color: COLORS[i % COLORS.length], mem: SOLO() ? '' : (t.mem || ''), fac: t.fac || '',
        facInfo: typeof getFaction === 'function' && getFaction(t.fac) ? getFaction(t.fac) : null, drinks: 0, laps: 0, pos: 0, pass: 0, streak: 0 }))
      : (S.teams || []).map((t, i) => ({ i, name: t.name, color: t.color, mem: (t.members || []).join(' '), next: SOLO() ? '' : (typeof rotWho === 'function' ? rotWho(t) || '' : ''), drinks: t.drinks || 0, fire: typeof fireLv === 'function' ? fireLv(t) : 0, laps: t.laps || 0, pos: t.pos || 0,
      pass: t.pass || 0, shards: t.shards || 0, mpass: t.mpass || {}, mshards: t.mshards || {}, fac: t.fac || '', smoked: t.smoked || 0, oakStack: t.oakStack || 0, curseStep: t.curseStep || 0, peatArmor: !!t.peatArmor,
      facInfo: typeof getFaction === 'function' && getFaction(t.fac) ? getFaction(t.fac) : null, out: t.out || {}, streak: t.streak || 0, fin: !!t.fin, pd: t.pd || {}, pstats: t.pstats || {}, cell: typeof cellAt === 'function' && cellAt(t.pos || 0) ? cellAt(t.pos || 0).t : '', lim: typeof CAP === 'function' && !S.juru ? CAP() : 0, island: S.phase === 'play' ? onIsland(t) : false, lost: S.phase === 'play' ? lostT(t) : false })),
    roll: S.phase === 'play' && !busy && !$('rollBtn').disabled && !modalOn && !pickOn && !taxiOn,
    spin: spinOn ? ($('spinName').classList.contains('wheelHost') ? $('spinLbl').textContent : $('spinLbl').textContent + ' ' + $('spinName').textContent) : '',
    modal: modalOn ? {
      who: $('mWho').textContent, e: $('mEm').dataset.e || $('mEm').textContent, t: $('mT').textContent, d: $('mD').dataset.full != null ? $('mD').dataset.full : $('mD').textContent, pl: (() => { const c = document.querySelector('#card .pchips.auto'); return c ? '👤 이번 선수: ' + [...c.querySelectorAll('.pchip')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' · ') : ''; })(),
      x: shown($('mX')) ? $('mX').textContent : '', q: shown($('mQ')) ? $('mQ').textContent : '',
      def, box: shown(box) ? blocks(box, def) : [],
      sw: box.dataset.sw || '', swh: box.dataset.swh || '', react: box.dataset.react || '', react2: box.dataset.react2 || '', tap: box.dataset.tap || '',
      minority: box.dataset.minority || '', timebomb: box.dataset.timebomb || '', relay: box.dataset.relay || '',
      relaySeats: (() => {
        if (!box.dataset.relay) return null;
        const seats = {};
        const now = Date.now();
        const byTeam = {};
        Object.entries(phones).forEach(([pid, p]) => {
          if (p.team != null && now - (p.seen || 0) < HOST_ALIVE_MS) {
            (byTeam[p.team] = byTeam[p.team] || []).push({ pid, sub: !!p.sub, seen: p.seen || 0 });
          }
        });
        Object.values(byTeam).forEach((arr) => {
          arr.sort((a, b) => (a.sub === b.sub ? 0 : a.sub ? 1 : -1));
          arr.forEach((item, idx) => {
            seats[tag(item.pid)] = idx === 0 ? 0 : 1 + ((idx - 1) % 3);
          });
        });
        return seats;
      })(),
      bets: (typeof recSel !== 'undefined' && recSel && recSel.only && recSel.only.length === 2 && !MDONE) ? recSel.only : null,
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
    over: overOn ? { title: $('ovT').textContent, msg: $('ovMsg') ? $('ovMsg').textContent : '', rep: $('repSummary') ? $('repSummary').innerText : '', rows: [...$('rank').children].map((r) => r.innerText.replace(/\n+/g, ' · ')), aw: [...document.querySelectorAll('#awards .awc')].map((d) => [...d.children].map((c) => c.textContent).join('|') || d.textContent) } : null
  };
}

function publish(force) {
  try { updLock(); } catch (e) {}
  if (!tp) return;
  const snap = snapshot();
  const key = JSON.stringify(snap);
  if (!force && key === lastJson) return;
  lastJson = key; snap.seq = ++seq;
  tp.send(snap);
}
function schedule() {
  const now = Date.now(); if (!firstWait) firstWait = now;
  NT.clearTimeout(timer);
  if (now - firstWait > 500) { firstWait = 0; publish(false); return; }
  timer = NT.setTimeout(() => { firstWait = 0; publish(false); }, 120);
}

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
function who(c, team) {
  if (c.from === 'watch') { const w = watchers[c.pid] || {}; let nk = w.nick || cleanNick(c.nick) || '관전자'; const sq = (x) => String(x || '').replace(/\s/g, '').toLowerCase(); if ((S.teams || []).some((t) => sq(t.name) === sq(nk))) nk = nk.slice(0, 6) + '(관전)'; return { fan: w.fan != null ? w.fan : fanOf(c.fan), nick: nk, watch: true }; }
  if (team != null && S.teams[+team]) {
    const pp = c.pid && phones[c.pid];
    const nk = (pp && pp.nick) || cleanNick(c.nick);
    return { fan: +team, nick: nk ? `${nk}(${S.teams[+team].name})` : S.teams[+team].name, watch: false };
  }
  return { fan: null, nick: '', watch: false };
}
function watchN() { const now = Date.now(); return Object.values(watchers).filter((w) => now - w.seen < 70000).length; }
function fanOf(f) { return f != null && f !== '' && S.teams && S.teams[+f] ? +f : null; }
function cleanNick(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8); }

// 🙋 팀원 합류 시 게임판의 팀원 명단(mem / members)에도 이름 자동 등록
function addMemberToTeam(ti, nick) {
  nick = cleanNick(nick);
  if (!nick || ti < 0) return;
  if (S.phase === 'setup' && !SOLO() && S.setup && S.setup[ti]) {
    const cur = (S.setup[ti].mem || '').split(/[\s,]+/).filter(Boolean);
    if (!cur.includes(nick)) {
      cur.push(nick);
      S.setup[ti].mem = cur.join(' ');
      save();
      const memIn = $('tlist') && $('tlist').querySelectorAll('.mem')[ti];
      if (memIn && document.activeElement !== memIn) memIn.value = S.setup[ti].mem;
    }
  } else if (S.phase === 'play' && !SOLO() && S.teams && S.teams[ti]) {
    const t = S.teams[ti];
    if (!(t.members || []).includes(nick)) {
      t.members = t.members || [];
      t.members.push(nick);
      t.cnt = t.cnt || [];
      t.cnt.push(0);
      save();
      if (typeof renderBoard === 'function') renderBoard();
    }
  }
}

function run(c) {
  if (c && c.from === 'watch' && !['cheer', 'say', 'bye'].includes(c.op)) return;
  if (c && c.sq != null && +c.sq > 0 && seq - +c.sq > 60 && !['hello', 'team', 'newteam', 'jointeam', 'rest', 'cheer', 'say', 'quiz', 'bye', 'bet', 'minority', 'passbomb', 'relay', 'islepay'].includes(c.op)) return;
  const isHost = c.from === 'host' && c.pid && c.pid === hostPid;
  const pp = c.pid && phones[c.pid];
  const team = c.from === 'player' && c.team != null && (!pp || pp.team == null || pp.team === String(c.team)) ? String(c.team) : null;
  const turn = () => team != null && String(S.cur) === team;
  const sub = team != null && String(subTeam()) === team;

  const owns = (el) => {
    if (el.closest('#mRecT .re') && el.dataset.team != null) { const own = String(el.dataset.team); return isHost ? !teamAlive(own) : team === own; }
    if (el.closest('#mRecB,#mRecT') && el.dataset.team != null) {
      const own = String(el.dataset.team), v = +el.dataset.v;
      if (isHost) return v <= 1 || !teamAlive(own);
      return team === own && v >= 1 && !!(recSel && recSel.st && recSel.st[+own] >= 1);
    }
    if (isHost && el.closest('#pickOpts')) return !teamAlive(S.cur);
    if (isHost) {
      if (!el.closest('#mBox')) return true;
      const o = teamsOf(el, defTeams());
      if (o === 'host') return true;
      if (o === 'board') return false;
      return o.split(',').some((x) => x !== '' && !teamAlive(x));
    }
    if (team == null) return false;
    if (team != null && !hostAlive() && el.closest('#mBox') && teamsOf(el, defTeams()) === 'host' && !isProgress(el)) { const jt = judgeTeam(); return jt === -1 ? judgeAll().includes(+team) : String(jt) === team; }
    if (sub && !el.closest('#pickOpts')) {
      if (el.id === 'mOk' && (el.classList.contains('pendingOk') || (typeof mPending === 'function' && mPending()) || passWaiting())) return false;
      if (!el.closest('#mBox')) return true;
      if (teamsOf(el, defTeams()) === 'host') return true;
    }
    if (el.closest('#pickOpts')) return turn();
    if (!el.closest('#mBox')) return false;
    const o = teamsOf(el, defTeams());
    return o !== 'host' && o.split(',').includes(team);
  };

  const byRid = (r) => {
    const m = /^([a-z0-9]+)-(ok|act|timer|reroll)-(\d+)$/.exec(r || '');
    if (m) return m[1] === BOOT && +m[3] === (typeof MSEQ !== 'undefined' ? MSEQ : 0) ? $(SHARED[m[2]]) : null;
    return r ? document.querySelector(`[data-rid="${r}"]`) : null;
  };

  switch (c.op) {
    case 'click': case 'pick': {
      const el = byRid(c.rid); if (!(el && !el.disabled && shown(el) && owns(el))) break;
      if (team != null && el.closest('#mRec')) { const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (passSeq !== ms) { passAns = {}; passSeq = ms; } passAns[team] = 1; }
      if (!isHost && /-reroll-/.test(c.rid || '')) { const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (rerollSeq === ms) break; rerollSeq = ms; }
      if (!isHost && team != null && !hostAlive() && el.closest('#mBox') && teamsOf(el, defTeams()) === 'host' && !isProgress(el) && judgeTeam() === -1) {
        const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (jSeq !== ms) { jVotes = {}; jSeq = ms; }
        jVotes[team] = c.rid; const all = judgeAll(), got = all.filter((x) => jVotes[String(x)]);
        if (got.length < all.length) { if (typeof toast === 'function') toast(`⚖️ ${tName(team)} 판정 완료 · 다른 팀도 같은 답을 고르면 정해져요`); schedule(); break; }
        const cnt = {}; got.forEach((x) => { const r = jVotes[String(x)]; cnt[r] = (cnt[r] || 0) + 1; });
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; jVotes = {};
        if (!(top && top[1] * 2 > all.length)) { jSplit = ms; if (typeof toast === 'function') toast('⚖️ 판정이 엇갈렸어요! 다 같이 보고 다시 고르거나 게임판에서 눌러 주세요'); schedule(); break; }
        const win = byRid(top[0]); if (win && !win.disabled && shown(win)) win.click(); break;
      }
      el.click(); break;
    }
    case 'fill': {
      const el = byRid(c.rid);
      if (el && !el.disabled && shown(el) && owns(el)) { el.value = String(c.value || '').slice(0, 40); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      break;
    }
    case 'roll': if (window.__paused) break; if ((turn() || (isHost && !teamAlive(S.cur))) && !$('rollBtn').disabled && !busy && !$('modal').classList.contains('on')) $('rollBtn').click(); break;
    case 'taxi': { if (!(turn() || (isHost && !teamAlive(S.cur)))) break; const el = $('c' + c.cell); if (el && el.classList.contains('taxiok')) el.click(); break; }
    case 'sw': { if (!(turn() || (isHost && !teamAlive(S.cur)))) break; const b = $('mBox'); if (+c.e < 0) { if (b.__swStart) b.__swStart(); } else if (b.__sw) b.__sw(+c.e); break; }
    case 'tap': {
      if (team == null) break; const b = $('mBox');
      if (!(b.__tap && (b.dataset.tap || b.dataset.tapLate || '').split(',').includes(team))) return;
      const now = Date.now(), w = tapWin[team] && now - tapWin[team].t < 1000 ? tapWin[team] : (tapWin[team] = { t: now, n: 0 });
      const n = Math.min(25, Math.max(0, +c.n || 0), 60 - w.n);
      const nk = (pp && pp.nick) || cleanNick(c.nick);
      if (n > 0) { w.n += n; b.__tap(+team, n, nk); } return;
    }
    case 'react2': { if (team == null) break; const b = $('mBox'); const nk = (pp && pp.nick) || cleanNick(c.nick); if (b.__react2) b.__react2(+team, +c.r, +c.ms, nk); return; }
    case 'minority': { if (team == null) break; const b = $('mBox'); if (b.__minority) b.__minority(c.pid, +team, +c.v); return; }
    case 'passbomb': { if (team == null) break; const b = $('mBox'); if (b.__passBomb) b.__passBomb(+c.to); return; }
    case 'relay': { if (team == null) break; const b = $('mBox'); if (b.__relay) b.__relay(+team, c.code); return; }
    case 'bet': {
      if (team == null || !c.pid) break;
      window.__bets = window.__bets || {};
      const nk = (pp && pp.nick) || cleanNick(c.nick);
      window.__bets[c.pid] = { ti: +team, nick: nk, pick: +c.pick };
      return;
    }
    case 'usememberpass': {
      if (team == null || typeof recSel === 'undefined' || !recSel || !recSel.st) break;
      const ti = +team, tm = S.teams && S.teams[ti];
      const nk = (pp && pp.nick) || cleanNick(c.nick);
      if (!tm || !nk || !tm.mpass || (tm.mpass[nk] || 0) < (+c.v === 3 ? 2 : 1)) break;
      recSel.st[ti] = +c.v === 3 ? 3 : 2;
      recSel.payer = recSel.payer || {};
      recSel.payer[ti] = nk;
      if (+c.v === 3) {
        const tgIdx = c.to != null ? +c.to : S.teams.findIndex((o, j) => j !== ti && !onIsland(o) && !lostT(o));
        recSel.tg[ti] = tgIdx >= 0 ? tgIdx : null;
      }
      const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0;
      if (passSeq !== ms) { passAns = {}; passSeq = ms; }
      passAns[String(ti)] = 1;
      if (typeof mDone === 'function') mDone();
      if (typeof drawRec === 'function') drawRec();
      if (typeof toast === 'function') {
        const targetWho = recSel.who && recSel.who[ti];
        toast(targetWho && targetWho !== nk
          ? `🛡️ ${tm.name} [${nk}]님이 [${targetWho}] 대신 개인 면제권 사용!`
          : `🛡️ ${tm.name} [${nk}]님 개인 면제권 ${+c.v === 3 ? '2개 반사' : '방어'} 선택!`);
      }
      break;
    }
    case 'islepay': {
      if (!(turn() || (isHost && !teamAlive(S.cur)))) break;
      const t = S.teams && S.teams[S.cur];
      if (t && t.isleTry && !$('rollBtn').disabled && !busy) {
        t.isle = false; t.isleTry = false; t.isleTurns = 0; t.skip = 0;
        if (JURU()) {
          // 많이 마시기 모드에서는 물 마시기 없으므로 즉시 탈출 미지원
          break;
        } else {
          const wn = SOLO() ? [] : drawWho(t, rotK(t));
          const who = wn.length ? (wn.length >= t.members.length && wn.length > 1 ? '전원' : wn.join('·')) : null;
          addDrink(S.cur, false, wn.length || null);
          if (wn.length) notePd(t, wn);
          const ln = SOLO() ? `🥃 ${t.name} 원샷 (무인도 탈출)` : who ? `🥃 ${t.name} ${who} 원샷 (무인도 탈출)` : `🥃 ${t.name} 걸린 사람 원샷 (무인도 탈출)`;
          if (typeof toast === 'function') toast(ln);
          if (typeof drinkFx === 'function') {
            busy = true; $('rollBtn').disabled = true;
            window.__drinkTi = [S.cur];
            window.__drinkP = drinkFx([ln], 0).then(() => { busy = false; $('rollBtn').disabled = false; schedule(); });
          }
        }
        save(); if (typeof renderBoard === 'function') renderBoard();
      }
      break;
    }
    case 'react': { if (!isHost && !sub) break; const b = $('mBox'); if (b.__react) b.__react(c.w === 1 ? 1 : 0); break; }
    case 'mute': if (isHost) $('muteBtn').click(); break;
    case 'start': {
      if (S.phase !== 'setup' || team == null || hostAlive()) break;
      const now = Date.now(), live = Object.values(phones).filter((p) => p.team != null && !p.sub && now - (p.seen || 0) < 60000);
      const notReady = live.filter((p) => !p.ready).map((p) => teamNameAt(+p.team)).filter(Boolean);
      if (notReady.length) { if (typeof toast === 'function') toast(`⏳ 아직 준비 안 된 팀: ${[...new Set(notReady)].join(', ')}`); break; }
      if ((SOLO() ? (S.solo || []).length : (S.setup || []).length) < 2) { if (typeof toast === 'function') toast(SOLO() ? '👥 2명 이상 있어야 시작할 수 있어요' : '👥 팀이 2개 이상 있어야 시작할 수 있어요'); break; }
      const b = $('startBtn'); if (b && !b.disabled) b.click(); break;
    }
    case 'again': { if (S.phase === 'over' && (isHost || (team != null && !hostAlive()))) { const b = $('againBtn'); if (b && !b.disabled) b.click(); } break; }
    case 'bye': {
      if (isHost) { hostSeen = 0; updLock(); }
      else if (c.pid && phones[c.pid]) {
        const oldT = phones[c.pid].team;
        delete phones[c.pid];
        if (oldT != null && !Object.values(phones).some((x) => x.team === oldT && Date.now() - (x.seen || 0) < HOST_ALIVE_MS)) teamSeen[oldT] = 0;
      }
      schedule(); break;
    }
    case 'introgo': if ((isHost || team != null) && typeof window.__introEnd === 'function') window.__introEnd(); break;
    case 'mcev': if (isHost && typeof mcEvent === 'function') mcEvent(String(c.ev || '')); break;
    case 'pause': if ((isHost || sub || (team != null && !hostAlive())) && typeof setPause === 'function') setPause(!!c.on); break;
    case 'undo': if (isHost && typeof undoRec === 'function') undoRec(); break;
    case 'drinkdone': {
      const df = $('drinkFx'); if (!df || typeof window.__drinkEnd !== 'function') break;
      if (isHost || (team != null && (window.__drinkTi || []).includes(+team))) window.__drinkEnd(); break;
    }
    case 'rest': {
      if (S.phase !== 'play' || SOLO()) break;
      const ti = isHost && c.ti != null ? +c.ti : (team != null ? +team : -1); const t = S.teams && S.teams[ti];
      if (!t || !(t.members || []).includes(String(c.m))) break;
      const wasGhost = typeof allRest === 'function' && allRest(t);
      t.out = t.out || {};
      if (c.on) t.out[String(c.m)] = 1; else delete t.out[String(c.m)];
      const nowGhost = typeof allRest === 'function' && allRest(t);
      if (!wasGhost && nowGhost && !JURU() && typeof toast === 'function') {
        toast(`👻 ${t.name} 전원 쉬기! 이제 유령 팀으로 장난 카드를 씁니다`);
      } else if (wasGhost && !nowGhost && !JURU() && typeof toast === 'function') {
        toast(`🎉 ${t.name} 복귀! 다시 일반 팀으로 돌아왔어요`);
      }
      save(); if (typeof renderBoard === 'function') renderBoard(); break;
    }
    case 'takeover': if (isHost && S.teams && S.teams[+c.ti]) takeover(+c.ti, !!c.on); break;
    case 'cheer': { const k = 'c' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 600) break; throttle[k] = now; if (typeof cheer === 'function') cheer(String(c.e || ''), who(c, team)); return; }
    case 'say': {
      const k = 's' + (c.pid || ''); const now = Date.now(); const free = c.txt != null;
      if (now - (throttle[k] || 0) < (free ? 4000 : 2500)) break; throttle[k] = now;
      let tx = free ? String(c.txt) : String(c.p || '');
      if (free) { if (S.chatOn === false) break; tx = typeof cleanSay === 'function' ? cleanSay(tx) : ''; } else if (typeof SAY_PRESET === 'undefined' || !SAY_PRESET.includes(tx)) break;
      if (!tx) break; if (typeof say === 'function') say(tx, who(c, team)); return;
    }
    case 'quiz': {
      if (team == null || S.phase !== 'play' || !c.ok) break;
      const k = 'q' + (c.pid || ''); const now = Date.now(); if (now - (throttle[k] || 0) < 8000) break; throttle[k] = now;
      const t = S.teams[+team]; if (t) { t.qz = (t.qz || 0) + 1; save(); } return;
    }
    case 'team': {
      if (S.phase !== 'setup' || team == null) break;
      if (pp && pp.sub) break;
      const arr = SOLO() ? S.solo : S.setup, i = +team, t = arr && arr[i];
      if (!t) break;
      t.name = String(c.name || '').replace(/\s+/g, ' ').slice(0, SOLO() ? 8 : 10);
      if (!SOLO()) t.mem = String(c.mem || '').slice(0, 80);
      if (c.fac !== undefined) t.fac = String(c.fac || '');
      save();
      const nm = $('tlist').querySelectorAll('.nm')[i], mem = $('tlist').querySelectorAll('.mem')[i], fs = $('tlist').querySelectorAll('.fac-sel')[i];
      if (nm && document.activeElement !== nm) nm.value = t.name;
      if (mem && !SOLO() && document.activeElement !== mem) mem.value = t.mem;
      if (fs && document.activeElement !== fs) fs.value = t.fac || '';
      break;
    }
    case 'jointeam': {
      const ti = c.ti != null ? +c.ti : -1;
      const nk = cleanNick(c.nick);
      if (ti >= 0 && nk) addMemberToTeam(ti, nk);
      if (c.pid && ti >= 0) {
        teamSeen[String(ti)] = Date.now();
        notePhone({ from: 'player', pid: c.pid, team: ti, nick: nk, sub: true, t: 'cmd' });
      }
      break;
    }
    case 'newteam': {
      if (S.phase !== 'setup' || !c.pid) break;
      if (claims[tag(c.pid)] != null && phones[c.pid] && phones[c.pid].team === String(claims[tag(c.pid)])) break;
      const solo = SOLO(), arr = solo ? S.solo : S.setup, L = phoneList();
      { const ci = claims[tag(c.pid)]; if (ci != null && arr[ci] && !(L[String(ci)] || []).some((x) => x.on && x.k !== tag(c.pid))) { notePhone({ from: 'player', pid: c.pid, team: ci, sub: false, t: 'cmd' }); schedule(); break; } }
      let i = arr.findIndex((t, j) => !(t.name || '').trim() && !(t.mem || '').trim() && !(L[String(j)] || []).some((x) => x.on));
      if (i < 0) { if (arr.length >= (solo ? 10 : 6)) break; arr.push(solo ? { name: '' } : { name: '', mem: '' }); i = arr.length - 1; }
      claims[tag(c.pid)] = i; const p = phones[c.pid] || (phones[c.pid] = {}); p.seen = Date.now(); p.sub = false;
      save(); const f = document.activeElement; renderSetup(); if (f && f !== document.body && f.focus && document.contains(f)) f.focus();
      notePhone({ from: 'player', pid: c.pid, team: i, sub: false, t: 'cmd' });
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

const AUTO_GO = 14000, AUTO_OK = 12000;
let autoEl = null, autoAt = 0, autoMs = 0, autoTxt = '', autoMax = 0;
const AUTO_TEAM = 22000, AUTO_TEAM_LIVE = 35000;
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
    if (b.classList.contains('swbtn')) return [b, teamAlive(S.cur) ? AUTO_TEAM_LIVE : AUTO_TEAM, null, `${tName(S.cur)} 대신 자동으로 스톱워치를 눌러요`, S.cur];
    if (teamsOf(b, '') === 'host' && isProgress(b)) return [b, AUTO_GO];
  }
  if (shown(box) && jSplit !== (typeof MSEQ !== 'undefined' ? MSEQ : 0)) { const jb = [...box.querySelectorAll('button')].filter((b) => shown(b) && !b.disabled && teamsOf(b, '') === 'host' && !isProgress(b) && !/^🔁/.test((b.textContent || '').trim())); if (jb.length) return [jb[0], AUTO_TEAM_LIVE, jb, '판정이 없어서 앱이 무작위로 골라요']; }
  const ok = $('mOk'); if (shown(ok) && !ok.disabled && typeof mPending === 'function' && !mPending()) { if (passWaiting()) return null; return [ok, AUTO_OK]; }
  if (shown(box)) {
    const tb = [...box.querySelectorAll('button')].filter((b) => shown(b) && !b.disabled && !b.classList.contains('react-pad') && !b.classList.contains('tappad') && !b.closest('[data-teams=board]'));
    const by = {}; tb.forEach((b) => { const o = teamsOf(b, defTeams()); if (o === 'host' || o === 'board' || !o) return; const k = o.split(',')[0]; (by[k] = by[k] || []).push(b); });
    const k = Object.keys(by)[0];
    if (k != null) return [by[k][0], teamAlive(k) ? AUTO_TEAM_LIVE : AUTO_TEAM, by[k], `${tName(k)} 대신 자동으로 골라요`, +k];
  }
  return null;
}

let passAns = {}, passSeq = -1, doneAt = 0, lastRk = '';
function passWaiting() {
  try {
    if (typeof recSel === 'undefined' || !recSel || !recSel.st || typeof MDONE === 'undefined' || !MDONE) return false;
    if (!doneAt || Date.now() - doneAt > 15000) return false;
    const ms = typeof MSEQ !== 'undefined' ? MSEQ : 0; if (passSeq !== ms) { passAns = {}; passSeq = ms; }
    return Object.keys(recSel.st).some((i) => recSel.st[i] >= 1 && (!recSel.only || recSel.only.includes(+i)) && S.teams[i] && (S.teams[i].pass || 0) > 0 && teamAlive(i) && !passAns[i]);
  } catch (e) { return false; }
}

function autoTick() {
  if (!room) return;
  {
    const mb = $('mBox');
    const rk = (typeof MDONE !== 'undefined' ? MDONE : '') + '|' + (typeof MSEQ !== 'undefined' ? MSEQ : '') + '|' + (mb ? [...mb.querySelectorAll('.res')].map((r) => r.textContent).join('').length : 0);
    if (rk !== lastRk) { lastRk = rk; if (typeof MDONE !== 'undefined' && MDONE) { autoEl = null; doneAt = Date.now(); } }
  }
  if (window.__paused) { if (autoEl) autoAt = Math.max(autoAt, Date.now() + 10000); autoMax = Math.max(autoMax, autoAt); setAuto(''); setWarn(null); return; }
  const c = autoCand(); const now = Date.now();
  if (!c) { autoEl = null; setAuto(''); setWarn(null); return; }
  if (c[0] !== autoEl || c[1] !== autoMs) { autoEl = c[0]; autoMs = c[1]; autoAt = now + c[1]; autoMax = now + c[1] * (c[2] !== undefined ? 1.5 : 3); }
  if (autoAt > autoMax) autoAt = autoMax;
  const left = Math.ceil((autoAt - now) / 1000);
  if (left <= 0) { const el = c[2] && c[2].length ? c[2][Math.floor(Math.random() * c[2].length)] : autoEl; autoEl = null; setAuto(''); setWarn(null); el.click(); return; }
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
  if (m.from === 'host' && m.pid && !hostPid) { hostPid = m.pid; try { localStorage.setItem(hostKey(), hostPid); } catch (e) {} }
  if (m.from === 'host' && m.pid && m.pid === hostPid) { hostSeen = Date.now(); updLock(); }
  publish(true);
}
function resetHost() { hostPid = null; hostSeen = 0; updLock(); try { localStorage.removeItem(hostKey()); } catch (e) {} publish(true); }

async function connect(code) {
  room = code;
  try { hostPid = localStorage.getItem(hostKey()); } catch (e) { hostPid = null; }
  const kind = transportKind() === 'none' ? 'local' : transportKind();
  tp = await createTransport({ kind, room, role: 'host', url: WS_URL, firebase: FIREBASE });
  tp.on((m) => {
    if (!m) return;
    notePhone(m); noteWatch(m);
    if (m.t === 'cmd' && m.from === 'player' && m.team != null && forced[String(m.team)] && !['cheer', 'quiz'].includes(m.op)) takeover(m.team, false);
    if (m.from === 'player' && m.team != null) {
      const k = String(m.team), was = teamAlive(k);
      teamSeen[k] = Date.now();
      if (!was) { updLock(); schedule(); }
    }
    if (m.t === 'hello') hello(m);
    else if (m.t === 'cmd') {
      if (m.from === 'host' && m.pid && !hostPid) hello(m);
      if (m.from === 'host' && m.pid && m.pid === hostPid) { hostSeen = Date.now(); updLock(); }
      run(m);
    }
  });
  NT.setInterval(updLock, 3000); NT.setInterval(updWatch, 5000); NT.setInterval(autoTick, 1000); NT.setInterval(schedule, 3000);
  tp.onStatus((st) => {
    const d = $('netDot'); if (d) d.dataset.st = st;
    if (st === 'online') publish(true);
    if (st === 'replaced' && typeof toast === 'function') toast('📡 다른 게임판이 이 방을 가져갔어요. 이 화면은 연결을 끊었어요');
  });
  document.body.classList.add('netOn');
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled', 'hidden', 'aria-pressed'] });
  if (kind !== 'firebase') NT.setInterval(() => publish(true), 5000);
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
      <h2>📱 폰으로 참가하기</h2><p>카메라로 QR을 찍고 우리 팀을 고르면 끝! · 팀장도, 팀원도 모두 들어올 수 있어요</p>
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
#modal.on~#netMini,#pick.on~#netMini,#help.on~#netMini{display:none}
@media (max-width:1099px){#netMini{display:none}}
.np-code{font-family:"Black Han Sans",sans-serif;font-size:44px;letter-spacing:8px;color:#e2571e;margin:6px 0}
.np-url{display:block;font-size:12px;word-break:break-all;color:#2b6ce0}.np-help{font-size:13px!important}
.np-x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:26px;cursor:pointer;color:#556}`;
document.head.appendChild(st);

addButton();
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom && /^[A-Z0-9]{3,8}$/.test(qRoom.toUpperCase())) connect(qRoom.toUpperCase()).catch((e) => console.error(e));
