/* ═══════════════════════════════════════════════════════════════
   ENJC Sport Club — Game on Fire 🔥
   Cricket Scoring Engine v3
   New: sport grid home, custom overs, export JSON, delete match,
        1-year localStorage backup, tournament page nav
═══════════════════════════════════════════════════════════════ */

import { subscribeToMatchHistory, subscribeToMatch, saveMatch as saveMatchToFirestore, deleteMatch as deleteMatchFromFirestore, batchDeleteMatches } from './firebase.js';

// ─── STATE ────────────────────────────────────────────────────
let state = {
  match: null,
  history: JSON.parse(localStorage.getItem('enjc_matches') || '[]')
};
let historyUnsub  = null;
let matchUnsub    = null;
let pendingDelete = null;
let isScorer      = false; // true = the person scoring, false = viewer

// Deep link: ?watch=MATCHID opens scorecard in viewer mode
function checkDeepLink() {
  const params  = new URLSearchParams(location.search);
  const watchId = params.get('watch');
  if (!watchId) return;
  isScorer = false;
  document.getElementById('sync-banner').classList.remove('hidden');
  document.getElementById('page-score').classList.add('viewer-mode');
  // Subscribe directly to that match
  subscribeToMatch(Number(watchId), remote => {
    if (!remote) { showToast('Match not found'); return; }
    state.match = remote;
    renderScorecard();
    nav('score');
  }, e => console.error(e));
}

// ─── FIREBASE SYNC ────────────────────────────────────────────
function setMatch(match, scorer = true) {
  state.match = match;
  isScorer    = scorer;
  if (matchUnsub) matchUnsub();
  if (!match) return;

  // Show/hide viewer banner and scorer entry panel
  const banner = document.getElementById('sync-banner');
  const scorePage = document.getElementById('page-score');
  if (scorer) {
    banner.classList.add('hidden');
    scorePage.classList.remove('viewer-mode');
  } else {
    banner.classList.remove('hidden');
    scorePage.classList.add('viewer-mode');
  }

  matchUnsub = subscribeToMatch(match.id, remote => {
    if (!remote) return;
    state.match = remote;
    const idx = state.history.findIndex(m => m.id === remote.id);
    if (idx >= 0) state.history[idx] = remote;
    if (activePage() === 'score')   renderScorecard();
    if (activePage() === 'summary') renderSummary();
  }, e => console.error(e));
}

function initMatchSync() {
  if (historyUnsub) historyUnsub();
  historyUnsub = subscribeToMatchHistory(matches => {
    state.history = matches;
    localStorage.setItem('enjc_matches', JSON.stringify(matches));
    pruneOldMatches();
    if (activePage() === 'home') renderDashboard();
    if (state.match?.id) {
      const open = matches.find(m => m.id === state.match.id);
      if (open) {
        state.match = open;
        if (activePage() === 'score')   renderScorecard();
        if (activePage() === 'summary') renderSummary();
      }
    }
  }, e => { console.warn('Firestore offline, local cache used'); renderDashboard(); });
}

function activePage() {
  const p = document.querySelector('.page.active');
  return p ? p.id.replace('page-', '') : '';
}

// ─── 1-YEAR BACKUP PRUNE ─────────────────────────────────────
async function pruneOldMatches() {
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const old    = state.history.filter(m => m.id < cutoff).map(m => m.id);
  state.history = state.history.filter(m => m.id >= cutoff);
  localStorage.setItem('enjc_matches', JSON.stringify(state.history));
  // Also remove from Firestore so other users' dashboards stay clean
  if (old.length) {
    try { await batchDeleteMatches(old); }
    catch(e) { console.warn('Prune Firestore failed (offline?)', e.message); }
  }
}

// ─── MATCH DEFAULTS ───────────────────────────────────────────
const defaultMatch = () => ({
  id: Date.now(), sport: 'cricket', format: '5',
  team1: { name: 'Team A', players: [] },
  team2: { name: 'Team B', players: [] },
  innings: 1, inning1: null, inning2: null, current: null, status: 'setup'
});

const defaultInning = (battingTeam, bowlingTeam, maxOvers) => ({
  battingTeam, bowlingTeam, maxOvers: parseInt(maxOvers),
  runs: 0, wickets: 0, balls: 0,
  extras: { wide: 0, noBall: 0, bye: 0 },
  batters: [], bowlers: [], lastSix: [], allBalls: [],
  onStrike: null, nonStrike: null, currentBowler: null, overBalls: 0
});

// ─── UTILS ────────────────────────────────────────────────────
const oversStr = b => `${Math.floor(b/6)}.${b%6}`;
const sr  = (r,b) => b===0 ? '0.0' : ((r/b)*100).toFixed(1);
const crr = (r,b) => b===0 ? '0.0' : ((r/b)*6).toFixed(2);
const rrr = (t,r,bl) => { const n=t-r; return (n<=0||bl<=0) ? '0.0' : ((n/bl)*6).toFixed(2); };
const ballsLeft = inn => inn.maxOvers*6 - inn.balls;
const target    = i1  => i1 ? i1.runs+1 : null;
const initials  = n   => n ? n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── NAVIGATION ───────────────────────────────────────────────
function nav(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + pageId)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
  document.getElementById('live-pill').style.display =
    (pageId === 'score' && state.match?.status === 'live') ? 'flex' : 'none';
}

// ─── HOME ─────────────────────────────────────────────────────
function gotoNewMatch(sport) {
  initSetup();
  nav('new');
}

function gotoTournament() {
  nav('tournament');
}

function renderDashboard() {
  const cont = document.getElementById('match-list');
  const list = state.history.slice().reverse();
  if (list.length === 0) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">🏏</div>
      <div class="empty-text">No matches yet.<br>Tap <strong style="color:var(--gold)">Cricket</strong> to start scoring!</div></div>`;
    return;
  }
  cont.innerHTML = list.map(m => {
    const i1 = m.inning1, i2 = m.inning2;
    const s1 = i1 ? `${i1.runs}/${i1.wickets}` : '—';
    const s2 = i2 ? `${i2.runs}/${i2.wickets}` : '—';
    const res = m.winner ? `🏆 ${m.winner} won` : '⚡ In Progress';
    return `<div class="match-card" onclick="window.resumeOrView(${m.id})">
      <div class="match-meta">
        <span class="match-format">🏏 ${m.format} Overs · Cricket</span>
        <span style="font-size:10px;color:var(--text-3)">${timeAgo(m.id)}</span>
      </div>
      <div class="match-teams">
        <span class="mt-name">${m.team1.name}</span>
        <span class="mt-score">${s1}</span>
        <span class="mt-vs">vs</span>
        <span class="mt-score">${s2}</span>
        <span class="mt-name" style="text-align:right">${m.team2.name}</span>
      </div>
      <div class="match-result">${res}</div>
    </div>`;
  }).join('');
}

function timeAgo(ts) {
  const d=Date.now()-ts, m=Math.floor(d/60000), h=Math.floor(d/3600000), dd=Math.floor(d/86400000);
  if (dd>0) return `${dd}d ago`;
  if (h>0)  return `${h}h ago`;
  if (m>0)  return `${m}m ago`;
  return 'Just now';
}

function resumeOrView(id) {
  const m = state.history.find(x => x.id === id);
  if (!m) return;
  setMatch(m);
  if (m.status === 'done') { renderSummary(); nav('summary'); }
  else { renderScorecard(); nav('score'); }
}

// ─── SETUP ────────────────────────────────────────────────────
let setupData = { overs: '5' };

function initSetup() {
  document.getElementById('team1-name').value = '';
  document.getElementById('team2-name').value = '';
  setupData.overs = '5';
  document.querySelectorAll('.overs-btn').forEach(b => b.classList.toggle('selected', b.dataset.overs==='5'));
  document.getElementById('custom-overs-group').style.display = 'none';
  renderPlayerInputs('team1', 11);
  renderPlayerInputs('team2', 11);
}

function renderPlayerInputs(team, count) {
  document.getElementById(`${team}-players`).innerHTML =
    Array.from({length: count}, (_,i) =>
      `<div class="player-input-row">
        <span class="player-num">${i+1}</span>
        <input class="form-input player-input" data-team="${team}" data-idx="${i}"
          placeholder="Player ${i+1}" style="padding:9px 11px;font-size:13px;"/>
      </div>`).join('');
}

function startMatch() {
  let overs = setupData.overs;
  if (overs === 'custom') {
    const v = parseInt(document.getElementById('custom-overs-input').value);
    if (!v || v < 1 || v > 100) { showToast('Enter valid overs (1–100)'); return; }
    overs = String(v);
  }
  const t1name = document.getElementById('team1-name').value.trim() || 'Team A';
  const t2name = document.getElementById('team2-name').value.trim() || 'Team B';
  const t1p = [...document.querySelectorAll('.player-input[data-team="team1"]')].map(i=>i.value.trim()).filter(Boolean);
  const t2p = [...document.querySelectorAll('.player-input[data-team="team2"]')].map(i=>i.value.trim()).filter(Boolean);
  if (t1p.length < 2 || t2p.length < 2) { showToast('Minimum 2 players per team!'); return; }

  const match = defaultMatch();
  match.format  = overs;
  match.team1   = { name: t1name, players: t1p };
  match.team2   = { name: t2name, players: t2p };
  match.status  = 'live';
  match.inning1 = defaultInning('team1','team2', overs);
  match.current = match.inning1;
  match.innings = 1;

  setMatch(match);
  openBatterSelect('strike', () => openBatterSelect('non-strike', () => openBowlerSelect(() => {
    saveMatch(); renderScorecard(); nav('score');
  })));
}

// ─── MODALS ───────────────────────────────────────────────────
function openBatterSelect(type, cb) {
  const inn = state.match.current;
  const team = state.match[inn.battingTeam];
  const usedIdx = inn.batters.filter(b=>!b.out).map(b=>b.idx);
  const avail = team.players.map((name,idx)=>({name,idx})).filter(p=>!usedIdx.includes(p.idx));
  if (avail.length === 0) { if(cb) cb(); return; }
  const label = type==='strike' ? 'Choose Batter (Strike)' : 'Choose Batter (Non-Strike)';
  openSelectModal(label, avail.map(p=>p.name), name => {
    const p = avail.find(x=>x.name===name); if (!p) return;
    if (type==='strike') inn.onStrike = p.idx; else inn.nonStrike = p.idx;
    if (!inn.batters.find(b=>b.idx===p.idx))
      inn.batters.push({idx:p.idx, runs:0, balls:0, fours:0, sixes:0, out:false, dismissal:''});
    if (cb) cb();
  });
}

function openBowlerSelect(cb) {
  const inn = state.match.current;
  const team = state.match[inn.bowlingTeam];
  openSelectModal('Choose Bowler', team.players, name => {
    const idx = team.players.indexOf(name);
    if (!inn.bowlers.find(b=>b.idx===idx))
      inn.bowlers.push({idx, overs:0, balls:0, runs:0, wickets:0, wides:0, noBalls:0});
    inn.currentBowler = idx;
    if (cb) cb();
  });
}

function openSelectModal(title, options, onSelect) {
  const modal = document.getElementById('select-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-list').innerHTML = options.map(name =>
    `<div class="modal-item" onclick="window.selectModalItem('${name.replace(/'/g,"\\'")}')">
      <div class="player-ava" style="width:28px;height:28px;font-size:9px;">${initials(name)}</div>${name}
    </div>`).join('');
  modal.classList.add('open');
  modal._cb = onSelect;
}

function selectModalItem(name) {
  const m = document.getElementById('select-modal');
  m.classList.remove('open'); m._cb?.(name);
}

function closeModal() {
  ['select-modal','wicket-modal','delete-modal'].forEach(id =>
    document.getElementById(id).classList.remove('open'));
}

// ─── SCORING ──────────────────────────────────────────────────
function addBall(type, runs) {
  const match = state.match;
  if (!match || match.status !== 'live') return;
  const inn = match.current; if (!inn) return;

  const isWide   = type==='wide', isNoBall = type==='noball';
  const isWicket = type==='wicket', isBye = type==='bye';
  const isLegal  = !isWide && !isNoBall;

  const bowler  = inn.bowlers.find(b=>b.idx===inn.currentBowler);
  const striker = inn.batters.find(b=>b.idx===inn.onStrike);

  if (isWide)        { inn.runs+=runs+1; inn.extras.wide++; if(bowler){bowler.wides++;bowler.runs+=runs+1;} }
  else if (isNoBall) { inn.runs+=runs+1; inn.extras.noBall++; if(bowler){bowler.noBalls++;bowler.runs+=runs+1;} }
  else {
    inn.runs += runs;
    if (!isWicket && !isBye && striker) {
      striker.runs+=runs;
      if(runs===4) striker.fours++;
      if(runs===6) striker.sixes++;
    }
    if (isBye) inn.extras.bye=(inn.extras.bye||0)+runs;
    if (bowler) bowler.runs+=runs;
  }

  if (isLegal) {
    inn.balls++; inn.overBalls++;
    if(striker&&!isWicket) striker.balls++;
    if(bowler) bowler.balls++;
  }

  inn.allBalls.push({type,runs});
  inn.lastSix = inn.allBalls.slice(-6);

  if (isWicket) { openWicketModal(); return; }

  if (isLegal && runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];

  if (isLegal && inn.overBalls===6) {
    inn.overBalls=0; if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    checkInningsEnd();
    if (match.status==='live') { openBowlerSelect(()=>{saveMatch();renderScorecard();}); return; }
  }

  checkInningsEnd(); saveMatch(); renderScorecard();
}

function openWicketModal() {
  document.getElementById('dismissal-list').innerHTML =
    ['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired'].map(d=>
      `<div class="modal-item" onclick="window.recordWicket('${d}')">${d}</div>`).join('');
  document.getElementById('wicket-modal').classList.add('open');
}

function recordWicket(dismissal) {
  closeModal();
  const inn = state.match.current;
  const striker = inn.batters.find(b=>b.idx===inn.onStrike);
  if (striker) { striker.out=true; striker.dismissal=dismissal; }
  inn.wickets++;
  const bowler = inn.bowlers.find(b=>b.idx===inn.currentBowler);
  if (bowler && dismissal!=='Run Out') bowler.wickets++;

  const total = state.match[inn.battingTeam].players.length;
  if (inn.wickets >= Math.min(total-1,10)) { checkInningsEnd(true); return; }

  if (inn.overBalls===6) {
    inn.overBalls=0; if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    openBatterSelect('strike', ()=>openBowlerSelect(()=>{saveMatch();renderScorecard();}));
  } else {
    openBatterSelect('strike', ()=>{saveMatch();renderScorecard();});
  }
}

function checkInningsEnd(allOut=false) {
  const match = state.match, inn = match.current;
  const isOver = allOut || inn.balls >= inn.maxOvers*6;
  const tgt = target(match.inning1);
  const chased = tgt!==null && inn.runs>=tgt;
  if (!isOver && !chased) return;

  if (match.innings===1) {
    match.inning1 = {...inn};
    match.inning2 = defaultInning('team2','team1',inn.maxOvers);
    match.current = match.inning2; match.innings=2;
    showToast(`Innings over! Target: ${inn.runs+1}`);
    setTimeout(()=>openBatterSelect('strike',()=>openBatterSelect('non-strike',()=>
      openBowlerSelect(()=>{saveMatch();renderScorecard();}))),600);
  } else {
    match.inning2={...inn};
    const i1=match.inning1, i2=match.inning2;
    if (chased) {
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name; match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else if (i1.runs>i2.runs) {
      match.winner=match.team1.name; match.result=`${match.team1.name} won by ${i1.runs-i2.runs} runs`;
    } else if (i2.runs>i1.runs) {
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name; match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else {
      match.winner=null; match.result='Match Tied! 🤝';
    }
    match.status='done'; saveMatch(); renderSummary(); nav('summary');
  }
}

function undoLastBall() {
  const inn = state.match?.current;
  if (!inn||inn.allBalls.length===0) { showToast('Nothing to undo'); return; }
  const last = inn.allBalls[inn.allBalls.length-1];
  const isWide=last.type==='wide', isNoBall=last.type==='noball';
  const isLegal=!isWide&&!isNoBall, isWicket=last.type==='wicket', isBye=last.type==='bye';

  if (isWide||isNoBall) {
    inn.runs-=(last.runs+1);
    if(isWide) inn.extras.wide=Math.max(0,inn.extras.wide-1);
    if(isNoBall) inn.extras.noBall=Math.max(0,inn.extras.noBall-1);
  } else {
    inn.runs-=last.runs;
    if(isBye) inn.extras.bye=Math.max(0,(inn.extras.bye||0)-last.runs);
    else if(!isWicket) {
      const s=inn.batters.find(b=>b.idx===inn.onStrike);
      if(s){s.runs-=last.runs;if(last.runs===4)s.fours=Math.max(0,s.fours-1);if(last.runs===6)s.sixes=Math.max(0,s.sixes-1);}
    }
  }
  if(isLegal){
    inn.balls=Math.max(0,inn.balls-1); inn.overBalls=Math.max(0,inn.overBalls-1);
    const s=inn.batters.find(b=>b.idx===inn.onStrike);
    if(s&&!isWicket) s.balls=Math.max(0,s.balls-1);
    const bw=inn.bowlers.find(b=>b.idx===inn.currentBowler);
    if(bw) bw.balls=Math.max(0,bw.balls-1);
  }
  if(isWicket){
    inn.wickets=Math.max(0,inn.wickets-1);
    const lb=inn.batters.find(b=>b.out); if(lb){lb.out=false;lb.dismissal='';}
  }
  if(isLegal&&last.runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
  inn.allBalls.pop(); inn.lastSix=inn.allBalls.slice(-6);
  showToast('↩ Undone'); saveMatch(); renderScorecard();
}

// ─── RENDER SCORECARD ─────────────────────────────────────────
function renderScorecard() {
  const match=state.match; if(!match) return;
  const inn=match.current, bt=match[inn.battingTeam], bwt=match[inn.bowlingTeam];
  const tgt=target(match.inning1), innings=match.innings;

  document.getElementById('sc-header-txt').textContent = `${bt.name} batting · ${innings===1?'1st':'2nd'} innings`;
  document.getElementById('sc-target-badge').textContent = tgt ? `🎯 Target ${tgt}` : '';
  document.getElementById('sc-team1-name').textContent = match.team1.name;
  document.getElementById('sc-team2-name').textContent = match.team2.name;

  const i1=match.inning1, i2=match.inning2;
  document.getElementById('sc-score1').textContent = i1&&innings===2 ? `${i1.runs}` : innings===1 ? `${inn.runs}` : '—';
  document.getElementById('sc-detail1').textContent = i1&&innings===2 ? `${i1.wickets} wkts` : innings===1 ? `${inn.wickets} wkts` : '';
  document.getElementById('sc-score2').textContent = innings===2 ? `${inn.runs}` : '—';
  document.getElementById('sc-detail2').textContent = innings===2 ? `${inn.wickets} wkts` : '';
  document.getElementById('sc-score1').classList.toggle('batting', innings===1);
  document.getElementById('sc-score2').classList.toggle('batting', innings===2);

  const pct=Math.min(100,(inn.balls/(inn.maxOvers*6))*100);
  document.getElementById('sc-over-fill').style.width=pct+'%';
  document.getElementById('sc-over-count').textContent=`${oversStr(inn.balls)} / ${inn.maxOvers}`;

  document.getElementById('balls-row-inner').innerHTML = inn.lastSix.map(b=>{
    let cls='b-dot',lbl='·';
    if(b.type==='wicket'){cls='b-w';lbl='W';}
    else if(b.type==='wide'){cls='b-wd';lbl='Wd';}
    else if(b.type==='noball'){cls='b-wd';lbl='Nb';}
    else if(b.runs===4){cls='b-4';lbl='4';}
    else if(b.runs===6){cls='b-6';lbl='6';}
    else if(b.runs>0){cls='b-run';lbl=b.runs;}
    return `<div class="ball ${cls}">${lbl}</div>`;
  }).join('') || '<span style="font-size:10px;color:var(--text-3)">No balls yet</span>';

  const tb=document.getElementById('target-bar');
  if(innings===2&&tgt){
    tb.classList.remove('hidden');
    const need=Math.max(0,tgt-inn.runs), bl=ballsLeft(inn);
    document.getElementById('need-runs').textContent=`${need} runs`;
    document.getElementById('need-rr').textContent=`🔥 RRR: ${rrr(tgt,inn.runs,bl)} · ${bl} balls left`;
    document.getElementById('crr-val').textContent=crr(inn.runs,inn.balls);
  } else tb.classList.add('hidden');

  document.getElementById('batter-rows').innerHTML = inn.batters.map(b=>{
    const name=bt.players[b.idx], isSt=b.idx===inn.onStrike, isNon=b.idx===inn.nonStrike;
    const role=b.out?`<span class="player-sub out">${b.dismissal||'Out'}</span>`:isSt?`<span class="player-sub strike">On strike ★</span>`:isNon?`<span class="player-sub">Non-striker</span>`:'';
    const av=b.out?'background:rgba(220,38,38,0.12);color:var(--red)':isSt?'':'background:rgba(37,99,235,0.1);color:var(--blue)';
    return `<div class="stats-row ${isSt?'on-strike':''} ${b.out?'out':''}">
      <div class="player-ava" style="${av}">${initials(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isSt?' ★':''}</div>${role}</div>
      <div class="stat-val ${isSt?'gold':''}">${b.runs}</div>
      <div class="stat-val">${b.balls}</div>
      <div class="stat-val">${b.fours}</div>
      <div class="stat-val ${isSt?'gold':''}">${sr(b.runs,b.balls)}</div>
    </div>`;
  }).join('') || `<div class="stats-row"><div class="player-name" style="color:var(--text-3);padding:4px 0">Select batter to begin</div></div>`;

  document.getElementById('bowler-rows').innerHTML = inn.bowlers.map(b=>{
    const name=bwt.players[b.idx], isCur=b.idx===inn.currentBowler;
    const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1);
    return `<div class="stats-row ${isCur?'on-strike':''}">
      <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${initials(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isCur?' ⚡':''}</div></div>
      <div class="stat-val">${b.overs}.${b.balls%6}</div>
      <div class="stat-val">${b.runs}</div>
      <div class="stat-val">${b.wickets}</div>
      <div class="stat-val ${isCur?'gold':''}">${eco}</div>
    </div>`;
  }).join('');
}

// ─── RENDER SUMMARY ───────────────────────────────────────────
function renderSummary() {
  const match=state.match; if(!match) return;
  const i1=match.inning1, i2=match.inning2;
  document.getElementById('winner-name').textContent = match.winner||'Tied! 🤝';
  document.getElementById('winner-sub').textContent  = match.result||'';

  const allB=[...(i1?.batters||[]).map(b=>({...b,team:match.team1})),
              ...(i2?.batters||[]).map(b=>({...b,team:match.team2}))];
  const mom = allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a, null);
  if(mom){
    const n=mom.team.players[mom.idx]||'—';
    document.getElementById('mom-name').textContent=n;
    document.getElementById('mom-stat').textContent=`${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}`;
    document.getElementById('mom-ava').textContent=initials(n);
  }

  document.getElementById('summary-scorecards').innerHTML = [
    {inn:i1,team:match.team1,bwt:match.team2},
    {inn:i2,team:match.team2,bwt:match.team1}
  ].filter(x=>x.inn).map(({inn,team,bwt})=>`
    <div class="section">
      <div class="sec-label">${team.name} — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} ov)</div>
      <div class="stats-card">
        <div class="stats-head"><div class="sh-name">Batter</div><div class="sh-stat">R</div><div class="sh-stat">B</div><div class="sh-stat">4s</div><div class="sh-stat">SR</div></div>
        ${inn.batters.map(b=>{const n=team.players[b.idx];return `<div class="stats-row ${b.out?'out':''}">
          <div class="player-ava" style="${b.out?'background:rgba(220,38,38,0.08);color:var(--red)':''}">${initials(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div><div class="player-sub ${b.out?'out':''}">${b.out?b.dismissal:'not out'}</div></div>
          <div class="stat-val gold">${b.runs}</div><div class="stat-val">${b.balls}</div><div class="stat-val">${b.fours}</div><div class="stat-val">${sr(b.runs,b.balls)}</div>
        </div>`;}).join('')}
      </div>
      <div style="height:8px"></div>
      <div class="stats-card">
        <div class="stats-head"><div class="sh-name">Bowler</div><div class="sh-stat">O</div><div class="sh-stat">R</div><div class="sh-stat">W</div><div class="sh-stat">Eco</div></div>
        ${inn.bowlers.map(b=>{const n=bwt.players[b.idx];const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1);return `<div class="stats-row">
          <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${initials(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div></div>
          <div class="stat-val">${b.overs}.${b.balls%6}</div><div class="stat-val">${b.runs}</div><div class="stat-val gold">${b.wickets}</div><div class="stat-val">${eco}</div>
        </div>`;}).join('')}
      </div>
    </div>`).join('');
}

// ─── EXPORT ───────────────────────────────────────────────────
function exportMatch() {
  const m = state.match; if(!m) return;
  const blob = new Blob([JSON.stringify(m, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const d    = new Date(m.id);
  a.href = url;
  a.download = `ENJC_${m.team1.name}_vs_${m.team2.name}_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Match exported!');
}

// ─── DELETE ───────────────────────────────────────────────────
function deleteCurrentMatch() {
  if (!state.match) return;
  pendingDelete = state.match.id;
  document.getElementById('delete-modal').classList.add('open');
}

function confirmDelete() {
  closeModal();
  if (!pendingDelete) return;
  state.history = state.history.filter(m => m.id !== pendingDelete);
  localStorage.setItem('enjc_matches', JSON.stringify(state.history));
  // fire-and-forget Firestore delete (best effort)
  try { await deleteMatchFromFirestore(pendingDelete); }
  catch(e) { console.warn('Firestore delete failed (offline?), removed locally'); }
  pendingDelete = null;
  state.match = null;
  showToast('Match deleted');
  renderDashboard();
  nav('home');
}

// ─── SHARE ────────────────────────────────────────────────────
function shareMatch() {
  const m=state.match; if(!m) return;
  const i1=m.inning1, i2=m.inning2;
  const base = location.origin + location.pathname;
  const watchUrl = m.status === 'live' ? `${base}?watch=${m.id}` : '';
  const text = `🦁 ENJC Sports Club
⚔ ${m.team1.name} vs ${m.team2.name}
🏏 ${m.team1.name}: ${i1?i1.runs+'/'+i1.wickets:'—'} (${i1?oversStr(i1.balls):'0'} ov)
🏏 ${m.team2.name}: ${i2?i2.runs+'/'+i2.wickets:'—'} (${i2?oversStr(i2.balls):'0'} ov)
🏆 ${m.result||'In Progress'}${watchUrl ? '\n📲 Watch live: '+watchUrl : ''}
#ENJCSportsClub #GameOnFire`;
  if(navigator.share) navigator.share({title:'ENJC Sports Club',text,url:watchUrl||base});
  else navigator.clipboard.writeText(text).then(()=>showToast('Copied to clipboard!'));
}

// Share just the live watch link (for WhatsApp quick share)
function shareLiveLink() {
  const m = state.match; if(!m||m.status!=='live') { showToast('No live match'); return; }
  const url = `${location.origin}${location.pathname}?watch=${m.id}`;
  if(navigator.share) navigator.share({title:'Watch live 🔴 '+m.team1.name+' vs '+m.team2.name, url});
  else navigator.clipboard.writeText(url).then(()=>showToast('Live link copied!'));
}

// ─── SAVE ─────────────────────────────────────────────────────
async function saveMatch() {
  const m=state.match; if(!m) return;
  const idx=state.history.findIndex(x=>x.id===m.id);
  if(idx>=0) state.history[idx]=m; else state.history.push(m);
  localStorage.setItem('enjc_matches', JSON.stringify(state.history));
  try { await saveMatchToFirestore(m); }
  catch(e) { console.warn('Firestore save failed (offline?), saved locally'); }
}

// ─── EXPOSE TO window (ES module fix) ─────────────────────────
Object.assign(window, {
  nav, gotoNewMatch, gotoTournament, resumeOrView, shareLiveLink,
  startMatch, addBall, selectModalItem, closeModal,
  recordWicket, undoLastBall, shareMatch, exportMatch,
  deleteCurrentMatch, confirmDelete
});

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  pruneOldMatches();
  checkDeepLink();
  nav('home');
  initMatchSync();
  renderDashboard();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const p = item.dataset.page;
      if (p==='score') {
        if(!state.match){showToast('Start a match first!');return;}
        renderScorecard();
      }
      if (p==='home')    renderDashboard();
      if (p==='summary') { if(state.match) renderSummary(); }
      nav(p);
    });
  });

  document.querySelectorAll('.overs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setupData.overs = btn.dataset.overs;
      document.querySelectorAll('.overs-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('custom-overs-group').style.display =
        btn.dataset.overs==='custom' ? 'block' : 'none';
    });
  });
});