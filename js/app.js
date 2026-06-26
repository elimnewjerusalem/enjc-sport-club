/* ═══════════════════════════════════════════════════════════════
   ENJC Sport Club — Game on Fire 🔥
   Cricket Scoring Engine
═══════════════════════════════════════════════════════════════ */

import { subscribeToMatchHistory, subscribeToMatch, saveMatch as saveMatchToFirestore } from './firebase.js';

// ─── STATE ────────────────────────────────────────────────────
let state = {
  match: null,
  history: []
};

let historyUnsub = null;
let matchUnsub = null;

function setMatch(match) {
  if (match && state.match?.id === match.id) {
    state.match = match;
    return;
  }

  state.match = match;
  if (matchUnsub) matchUnsub();

  if (match) {
    matchUnsub = subscribeToMatch(match.id, remoteMatch => {
      if (!remoteMatch) return;
      state.match = remoteMatch;

      const idx = state.history.findIndex(m => m.id === remoteMatch.id);
      if (idx >= 0) state.history[idx] = remoteMatch;

      if (document.getElementById('page-score').classList.contains('active')) renderScorecard();
      if (document.getElementById('page-summary').classList.contains('active')) renderSummary();
    }, error => console.error('Match subscription error', error));
  }
}

function initMatchSync() {
  if (historyUnsub) historyUnsub();
  historyUnsub = subscribeToMatchHistory(matches => {
    state.history = matches;
    renderDashboard();

    if (state.match?.id) {
      const openMatch = matches.find(m => m.id === state.match.id);
      if (openMatch) {
        state.match = openMatch;
        if (document.getElementById('page-score').classList.contains('active')) renderScorecard();
        if (document.getElementById('page-summary').classList.contains('active')) renderSummary();
      }
    }
  }, error => console.error('History subscription error', error));
}

const defaultMatch = () => ({
  id: Date.now(),
  format: '5',
  team1: { name: 'Team A', players: [] },
  team2: { name: 'Team B', players: [] },
  innings: 1,
  batting: 1,   // team index (1 or 2)
  inning1: null,
  inning2: null,
  current: null,
  status: 'setup'  // setup | live | innings_break | done
});

const defaultInning = (battingTeam, bowlingTeam, maxOvers) => ({
  battingTeam,
  bowlingTeam,
  maxOvers: parseInt(maxOvers),
  runs: 0,
  wickets: 0,
  balls: 0,         // legal balls
  extras: { wide: 0, noBall: 0, bye: 0 },
  batters: [],      // all who batted
  bowlers: [],
  lastSix: [],      // for display (max 6 entries)
  allBalls: [],     // full log
  onStrike: null,   // player index in batters[]
  nonStrike: null,
  currentBowler: null,
  overBalls: 0      // balls in current over (legal only)
});

// ─── CRICKET LOGIC ────────────────────────────────────────────
function overs(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
function sr(runs, balls) {
  return balls === 0 ? '0.0' : ((runs / balls) * 100).toFixed(1);
}
function crr(runs, balls) {
  return balls === 0 ? '0.0' : ((runs / balls) * 6).toFixed(2);
}
function rrr(target, runs, ballsLeft) {
  const need = target - runs;
  if (need <= 0 || ballsLeft <= 0) return '0.0';
  return ((need / ballsLeft) * 6).toFixed(2);
}
function totalOvers(inning) {
  return inning.maxOvers * 6;
}
function ballsLeft(inning) {
  return totalOvers(inning) - inning.balls;
}
function target(inning1) {
  return inning1 ? inning1.runs + 1 : null;
}

// ─── NAVIGATION ───────────────────────────────────────────────
function nav(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + pageId)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
}

// ─── DASHBOARD ────────────────────────────────────────────────
function renderDashboard() {
  const cont = document.getElementById('match-list');
  const history = state.history.slice().reverse();

  if (state.match && state.match.status === 'live') {
    // show resume card
  }

  if (history.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏏</div>
      <div class="empty-text">No matches yet.<br>Tap <strong style="color:var(--gold)">New Match</strong> to start scoring!</div>
    </div>`;
    return;
  }

  cont.innerHTML = history.map(m => {
    const i1 = m.inning1; const i2 = m.inning2;
    const t1 = m.team1.name; const t2 = m.team2.name;
    const winner = m.winner || '';
    const resultText = winner ? `🏆 ${winner} won` : '⚡ In Progress';
    const score1 = i1 ? `${i1.runs}/${i1.wickets}` : '—';
    const score2 = i2 ? `${i2.runs}/${i2.wickets}` : '—';
    return `<div class="match-card" onclick="resumeOrView(${m.id})">
      <div class="match-meta">
        <span class="match-format">${m.format} Overs · Cricket</span>
        <span style="font-size:10px;color:var(--text-3)">${timeAgo(m.id)}</span>
      </div>
      <div class="match-teams">
        <span class="mt-name">${t1}</span>
        <span class="mt-score">${score1}</span>
        <span class="mt-vs">vs</span>
        <span class="mt-score">${score2}</span>
        <span class="mt-name" style="text-align:right">${t2}</span>
      </div>
      <div class="match-result">${resultText}</div>
    </div>`;
  }).join('');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

function resumeOrView(id) {
  const m = state.history.find(x => x.id === id);
  if (!m) return;
  setMatch(m);
  if (m.status === 'done') {
    renderSummary();
    nav('summary');
  } else {
    renderScorecard();
    nav('score');
  }
}

// ─── NEW MATCH SETUP ──────────────────────────────────────────
let setupData = { overs: '5', team1Players: [], team2Players: [] };

function initSetup() {
  document.getElementById('team1-name').value = '';
  document.getElementById('team2-name').value = '';
  setupData.overs = '5';
  document.querySelectorAll('.overs-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.overs === '5');
  });
  renderPlayerInputs('team1', 11);
  renderPlayerInputs('team2', 11);
}

function renderPlayerInputs(team, count) {
  const cont = document.getElementById(`${team}-players`);
  cont.innerHTML = Array.from({length: count}, (_, i) =>
    `<div class="player-input-row">
      <span class="player-num">${i+1}</span>
      <input class="form-input player-input" data-team="${team}" data-idx="${i}"
        placeholder="Player ${i+1}" style="padding:9px 11px;font-size:13px;" />
    </div>`
  ).join('');
}

function startMatch() {
  const t1name = document.getElementById('team1-name').value.trim() || 'Team A';
  const t2name = document.getElementById('team2-name').value.trim() || 'Team B';
  const overs  = setupData.overs;

  const t1players = [...document.querySelectorAll('.player-input[data-team="team1"]')]
    .map(i => i.value.trim()).filter(Boolean);
  const t2players = [...document.querySelectorAll('.player-input[data-team="team2"]')]
    .map(i => i.value.trim()).filter(Boolean);

  if (t1players.length < 2 || t2players.length < 2) {
    showToast('Minimum 2 players per team!'); return;
  }

  const match = defaultMatch();
  match.format  = overs;
  match.team1   = { name: t1name, players: t1players };
  match.team2   = { name: t2name, players: t2players };
  match.status  = 'live';

  // start inning 1 — team1 bats
  match.inning1 = defaultInning('team1', 'team2', overs);
  match.current = match.inning1;
  match.innings = 1;

  // open strike batter selection
  setMatch(match);
  openBatterSelect('strike', () => openBatterSelect('non-strike', () => openBowlerSelect(() => {
    saveMatch();
    renderScorecard();
    nav('score');
  })));
}

// ─── BATTER / BOWLER SELECTION MODALS ────────────────────────
function openBatterSelect(type, cb) {
  const inn = state.match.current;
  const battingTeam = state.match[inn.battingTeam];
  const alreadyIn = [inn.onStrike, inn.nonStrike].filter(x => x !== null);
  const available = battingTeam.players
    .filter((_, i) => !alreadyIn.includes(i))
    .map((name, i) => ({ name, idx: battingTeam.players.indexOf(name) }));

  const label = type === 'strike' ? 'Choose Opening Batter (Strike)' : 'Choose Opening Batter (Non-Strike)';
  openSelectModal(label, available.map(p => p.name), (chosenName) => {
    const idx = battingTeam.players.indexOf(chosenName);
    if (type === 'strike') {
      inn.onStrike = idx;
      if (!inn.batters.find(b => b.idx === idx)) {
        inn.batters.push({ idx, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
      }
    } else {
      inn.nonStrike = idx;
      if (!inn.batters.find(b => b.idx === idx)) {
        inn.batters.push({ idx, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
      }
    }
    cb();
  });
}

function openBowlerSelect(cb) {
  const inn = state.match.current;
  const bowlingTeam = state.match[inn.bowlingTeam];
  openSelectModal('Choose Bowler', bowlingTeam.players, (chosenName) => {
    const idx = bowlingTeam.players.indexOf(chosenName);
    if (!inn.bowlers.find(b => b.idx === idx)) {
      inn.bowlers.push({ idx, overs: 0, balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0 });
    }
    inn.currentBowler = idx;
    if (cb) cb();
  });
}

function openSelectModal(title, options, onSelect) {
  const modal = document.getElementById('select-modal');
  document.getElementById('modal-title').textContent = title;
  const list = document.getElementById('modal-list');
  list.innerHTML = options.map(name =>
    `<div class="modal-item" onclick="selectModalItem('${name.replace(/'/g,"\\'")}')">
      <div class="player-ava" style="width:28px;height:28px;font-size:9px;">${initials(name)}</div>
      ${name}
    </div>`
  ).join('');
  modal.classList.add('open');
  modal._cb = onSelect;
}

function selectModalItem(name) {
  const modal = document.getElementById('select-modal');
  modal.classList.remove('open');
  modal._cb?.(name);
}

function closeModal() {
  document.getElementById('select-modal').classList.remove('open');
  document.getElementById('wicket-modal').classList.remove('open');
}

// ─── SCORING ──────────────────────────────────────────────────
function addBall(type, runs) {
  const match = state.match;
  if (!match || match.status !== 'live') return;
  const inn = match.current;
  if (!inn) return;

  const isWide = type === 'wide';
  const isNoBall = type === 'noball';
  const isWicket = type === 'wicket';
  const isBye = type === 'bye';
  const isLegal = !isWide && !isNoBall;

  const bowler = inn.bowlers.find(b => b.idx === inn.currentBowler);
  const striker = inn.batters.find(b => b.idx === inn.onStrike);

  // runs
  inn.runs += runs;
  if (isWide)  { inn.extras.wide++; inn.runs++; bowler.wides++; bowler.runs += runs + 1; }
  else if (isNoBall) { inn.extras.noBall++; inn.runs++; bowler.noBalls++; bowler.runs += runs + 1; }
  else {
    if (!isWicket && !isBye) {
      striker.runs += runs;
      if (runs === 4) striker.fours++;
      if (runs === 6) striker.sixes++;
    }
    bowler.runs += runs;
  }

  // balls
  if (isLegal) {
    inn.balls++;
    inn.overBalls++;
    if (striker) striker.balls++;
    bowler.balls++;
  }

  // last 6 display
  let ballEntry = { type, runs };
  inn.lastSix.push(ballEntry);
  if (inn.lastSix.length > 6) inn.lastSix.shift();
  inn.allBalls.push(ballEntry);

  // wicket
  if (isWicket) {
    openWicketModal();
    return;
  }

  // strike rotate on odd runs
  if (isLegal && runs % 2 !== 0) {
    const tmp = inn.onStrike;
    inn.onStrike = inn.nonStrike;
    inn.nonStrike = tmp;
  }

  // over complete
  if (inn.overBalls === 6) {
    inn.overBalls = 0;
    bowler.overs++;
    // rotate strike at end of over
    const tmp = inn.onStrike;
    inn.onStrike = inn.nonStrike;
    inn.nonStrike = tmp;
    // new bowler
    openBowlerSelect(() => { saveMatch(); renderScorecard(); });
    return;
  }

  // innings over?
  checkInningsEnd();
  saveMatch();
  renderScorecard();
}

function openWicketModal() {
  const inn = state.match.current;
  const team = state.match[inn.bowlingTeam];
  const wm = document.getElementById('wicket-modal');
  document.getElementById('dismissal-list').innerHTML =
    ['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired'].map(d =>
      `<div class="modal-item" onclick="recordWicket('${d}')">${d}</div>`
    ).join('');
  wm.classList.add('open');
}

function recordWicket(dismissal) {
  closeModal();
  const inn = state.match.current;
  const striker = inn.batters.find(b => b.idx === inn.onStrike);
  if (striker) { striker.out = true; striker.dismissal = dismissal; }
  inn.wickets++;

  const bowler = inn.bowlers.find(b => b.idx === inn.currentBowler);
  if (bowler && dismissal !== 'Run Out') bowler.wickets++;

  // add ball count
  inn.balls++;
  inn.overBalls++;
  if (striker) striker.balls++;
  if (bowler) bowler.balls++;

  inn.lastSix.push({ type: 'wicket', runs: 0 });
  if (inn.lastSix.length > 6) inn.lastSix.shift();

  // check all out
  const totalPlayers = state.match[inn.battingTeam].players.length;
  if (inn.wickets >= totalPlayers - 1 || inn.wickets >= 10) {
    checkInningsEnd(true);
    return;
  }

  // new batter
  openBatterSelect('strike', () => {
    if (inn.overBalls === 6) {
      inn.overBalls = 0;
      const bwl = inn.bowlers.find(b => b.idx === inn.currentBowler);
      if (bwl) bwl.overs++;
      openBowlerSelect(() => { saveMatch(); renderScorecard(); });
    } else {
      saveMatch(); renderScorecard();
    }
  });
}

function checkInningsEnd(allOut = false) {
  const match = state.match;
  const inn = match.current;
  const maxBalls = inn.maxOvers * 6;
  const isOver = allOut || inn.balls >= maxBalls;
  const tgt = target(match.inning1);
  const chased = tgt && inn.runs >= tgt;

  if (!isOver && !chased) return;

  if (match.innings === 1) {
    // start inning 2
    match.inning1 = inn;
    match.inning2 = defaultInning('team2', 'team1', inn.maxOvers);
    match.current = match.inning2;
    match.innings = 2;
    showToast(`Innings over! Target: ${inn.runs + 1}`);
    setTimeout(() => {
      openBatterSelect('strike', () => openBatterSelect('non-strike', () => openBowlerSelect(() => {
        saveMatch(); renderScorecard();
      })));
    }, 800);
  } else {
    // match done
    match.inning2 = inn;
    const i1 = match.inning1;
    const i2 = match.inning2;
    const t1 = match.team1.name;
    const t2 = match.team2.name;

    if (i2.runs > i1.runs) {
      const wktsLeft = (state.match[i2.battingTeam === 'team1' ? 'team1' : 'team2'].players.length - 1) - i2.wickets;
      match.winner = match.team2.name;
      match.result = `${match.team2.name} won by ${wktsLeft} wickets`;
    } else if (i1.runs > i2.runs) {
      match.winner = match.team1.name;
      match.result = `${match.team1.name} won by ${i1.runs - i2.runs} runs`;
    } else {
      match.winner = null;
      match.result = 'Match Tied!';
    }
    match.status = 'done';
    saveMatch();
    renderSummary();
    nav('summary');
  }
}

function undoLastBall() {
  const inn = state.match?.current;
  if (!inn || inn.allBalls.length === 0) { showToast('Nothing to undo'); return; }
  // simple undo — re-init from allBalls
  const balls = inn.allBalls.slice(0, -1);
  // rebuild innings from scratch
  const fresh = defaultInning(inn.battingTeam, inn.bowlingTeam, inn.maxOvers);
  fresh.onStrike = inn.onStrike;
  fresh.nonStrike = inn.nonStrike;
  fresh.currentBowler = inn.currentBowler;
  // re-add all players
  const battingTeam = state.match[inn.battingTeam];
  const bowlingTeam = state.match[inn.bowlingTeam];
  [inn.onStrike, inn.nonStrike].filter(x=>x!==null).forEach(idx => {
    fresh.batters.push({ idx, runs:0, balls:0, fours:0, sixes:0, out:false, dismissal:'' });
  });
  fresh.bowlers.push({ idx: inn.currentBowler, overs:0, balls:0, runs:0, wickets:0, wides:0, noBalls:0 });

  // re-simulate — simple approach: just restore last state
  state.match.current = inn;
  inn.allBalls.pop();
  inn.lastSix = inn.allBalls.slice(-6);
  showToast('Last ball undone');
  saveMatch();
  renderScorecard();
}

// ─── RENDER SCORECARD ─────────────────────────────────────────
function renderScorecard() {
  const match = state.match;
  if (!match) return;
  const inn = match.current;
  const battingTeam = match[inn.battingTeam];
  const bowlingTeam = match[inn.bowlingTeam];
  const tgt = target(match.inning1);
  const innings = match.innings;

  // header
  document.getElementById('sc-header-txt').textContent =
    `${battingTeam.name} batting · ${innings === 1 ? '1st' : '2nd'} innings`;
  document.getElementById('sc-target-badge').textContent =
    tgt ? `🎯 Target ${tgt}` : '';

  // scores
  const batting = match.inning1 || inn;
  const bowling = match.inning2 || null;

  document.getElementById('sc-team1-name').textContent = match.team1.name;
  document.getElementById('sc-team2-name').textContent = match.team2.name;

  const i1 = match.inning1;
  const i2 = match.inning2;

  document.getElementById('sc-score1').textContent = i1 ? `${i1.runs}` : (innings === 1 ? `${inn.runs}` : '—');
  document.getElementById('sc-detail1').textContent = i1 ? `${i1.wickets} wkts` : (innings === 1 ? `${inn.wickets} wkts` : '');
  document.getElementById('sc-score2').textContent = i2 ? `${i2.runs}` : (innings === 2 ? `${inn.runs}` : '—');
  document.getElementById('sc-detail2').textContent = i2 ? `${i2.wickets} wkts` : (innings === 2 ? `${inn.wickets} wkts` : '');

  // batting team score gets gold color
  if (innings === 1) {
    document.getElementById('sc-score1').classList.add('batting');
    document.getElementById('sc-score2').classList.remove('batting');
  } else {
    document.getElementById('sc-score2').classList.add('batting');
    document.getElementById('sc-score1').classList.remove('batting');
  }

  // overs
  const pct = Math.min(100, (inn.balls / (inn.maxOvers * 6)) * 100);
  document.getElementById('sc-over-fill').style.width = pct + '%';
  document.getElementById('sc-over-count').textContent = `${overs(inn.balls)} / ${inn.maxOvers}`;

  // last 6 balls
  const ballColors = { dot:'b-dot', run:'b-run', wide:'b-wd', noball:'b-wd', wicket:'b-w', bye:'b-run', 4:'b-4', 6:'b-6' };
  const ballLabels = { dot:'·', wide:'Wd', noball:'Nb', wicket:'W', bye:'B' };
  const ballsHtml = inn.lastSix.map(b => {
    let cls = 'b-dot', label = '·';
    if (b.type === 'wicket') { cls = 'b-w'; label = 'W'; }
    else if (b.type === 'wide') { cls = 'b-wd'; label = 'Wd'; }
    else if (b.type === 'noball') { cls = 'b-wd'; label = 'Nb'; }
    else if (b.runs === 4) { cls = 'b-4'; label = '4'; }
    else if (b.runs === 6) { cls = 'b-6'; label = '6'; }
    else if (b.runs > 0) { cls = 'b-run'; label = b.runs; }
    return `<div class="ball ${cls}">${label}</div>`;
  }).join('');
  document.getElementById('balls-row-inner').innerHTML = ballsHtml || '<span style="font-size:10px;color:var(--text-4)">No balls yet</span>';

  // target bar
  const targetBar = document.getElementById('target-bar');
  if (innings === 2 && tgt) {
    targetBar.classList.remove('hidden');
    const need = Math.max(0, tgt - inn.runs);
    const bl = ballsLeft(inn);
    document.getElementById('need-runs').textContent = `${need} runs`;
    document.getElementById('need-rr').textContent = `🔥 RRR: ${rrr(tgt, inn.runs, bl)} · ${bl} balls left`;
    document.getElementById('crr-val').textContent = crr(inn.runs, inn.balls);
  } else {
    targetBar.classList.add('hidden');
  }

  // batters
  const batterHtml = inn.batters.map(b => {
    const name = battingTeam.players[b.idx];
    const isStrike = b.idx === inn.onStrike;
    const isNon = b.idx === inn.nonStrike;
    const init = initials(name);
    const role = b.out ? `<span class="player-sub out">${b.dismissal || 'Out'}</span>`
                      : isStrike ? `<span class="player-sub strike">On strike ★</span>`
                      : isNon ? `<span class="player-sub">Non-striker</span>` : '';
    const avaColor = b.out ? 'background:rgba(239,68,68,0.1);color:#F87171'
                           : isStrike ? '' : 'background:rgba(96,165,250,0.12);color:var(--blue)';
    return `<div class="stats-row ${isStrike?'on-strike':''} ${b.out?'out':''}">
      <div class="player-ava" style="${avaColor}">${init}</div>
      <div style="flex:1"><div class="player-name">${name}${isStrike?' ★':''}</div>${role}</div>
      <div class="stat-val ${isStrike?'gold':''}">${b.runs}</div>
      <div class="stat-val">${b.balls}</div>
      <div class="stat-val">${b.fours}</div>
      <div class="stat-val ${isStrike?'gold':''}">${sr(b.runs, b.balls)}</div>
    </div>`;
  }).join('') || `<div class="stats-row"><div class="player-name" style="color:var(--text-3);padding:4px 0">Select batter to begin</div></div>`;
  document.getElementById('batter-rows').innerHTML = batterHtml;

  // bowler
  const bowlerHtml = inn.bowlers.map(b => {
    const name = bowlingTeam.players[b.idx];
    const isCurrent = b.idx === inn.currentBowler;
    return `<div class="stats-row ${isCurrent?'on-strike':''}">
      <div class="player-ava" style="background:rgba(168,85,247,0.12);color:var(--purple)">${initials(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isCurrent?' ⚡':''}</div></div>
      <div class="stat-val">${b.overs}.${b.balls % 6}</div>
      <div class="stat-val">${b.runs}</div>
      <div class="stat-val">${b.wickets}</div>
      <div class="stat-val ${isCurrent?'gold':''}">${b.balls === 0 ? '—' : ((b.runs/b.balls)*6).toFixed(1)}</div>
    </div>`;
  }).join('');
  document.getElementById('bowler-rows').innerHTML = bowlerHtml;
}

// ─── SUMMARY ──────────────────────────────────────────────────
function renderSummary() {
  const match = state.match;
  if (!match) return;
  const i1 = match.inning1;
  const i2 = match.inning2;

  document.getElementById('winner-name').textContent = match.winner || 'Tied!';
  document.getElementById('winner-sub').textContent = match.result || '';

  // MoM — top run scorer
  const allBatters = [...(i1?.batters || []), ...(i2?.batters || [])];
  let mom = allBatters.reduce((a, b) => b.runs > (a?.runs || 0) ? b : a, null);
  if (mom) {
    const battingTeam = match[i1?.battingTeam || 'team1'];
    const momName = battingTeam.players[mom.idx] || '—';
    document.getElementById('mom-name').textContent = momName;
    document.getElementById('mom-stat').textContent = `${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs, mom.balls)}`;
    document.getElementById('mom-ava').textContent = initials(momName);
  }

  // summary scorecard
  const summaryHtml = [
    { inn: i1, team: match.team1, bowlingTeam: match.team2 },
    { inn: i2, team: match.team2, bowlingTeam: match.team1 }
  ].filter(x => x.inn).map(({ inn, team, bowlingTeam }) => `
    <div class="section">
      <div class="sec-label">${team.name} — ${inn.runs}/${inn.wickets} (${overs(inn.balls)} ov)</div>
      <div class="stats-card">
        <div class="stats-head">
          <div class="sh-name">Batter</div>
          <div class="sh-stat">R</div><div class="sh-stat">B</div>
          <div class="sh-stat">4s</div><div class="sh-stat">SR</div>
        </div>
        ${inn.batters.map(b => {
          const name = team.players[b.idx];
          return `<div class="stats-row ${b.out?'out':''}">
            <div class="player-ava" style="${b.out?'background:rgba(239,68,68,0.08);color:#F87171':''}">
              ${initials(name)}</div>
            <div style="flex:1">
              <div class="player-name">${name}</div>
              <div class="player-sub ${b.out?'out':''}">${b.out ? b.dismissal : 'not out'}</div>
            </div>
            <div class="stat-val gold">${b.runs}</div>
            <div class="stat-val">${b.balls}</div>
            <div class="stat-val">${b.fours}</div>
            <div class="stat-val">${sr(b.runs,b.balls)}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="height:8px"></div>
      <div class="stats-card">
        <div class="stats-head">
          <div class="sh-name">Bowler</div>
          <div class="sh-stat">O</div><div class="sh-stat">R</div>
          <div class="sh-stat">W</div><div class="sh-stat">Eco</div>
        </div>
        ${inn.bowlers.map(b => {
          const name = bowlingTeam.players[b.idx];
          return `<div class="stats-row">
            <div class="player-ava" style="background:rgba(168,85,247,0.1);color:var(--purple)">${initials(name)}</div>
            <div style="flex:1"><div class="player-name">${name}</div></div>
            <div class="stat-val">${b.overs}.${b.balls%6}</div>
            <div class="stat-val">${b.runs}</div>
            <div class="stat-val gold">${b.wickets}</div>
            <div class="stat-val">${b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1)}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
  document.getElementById('summary-scorecards').innerHTML = summaryHtml;
}

// ─── STORAGE ──────────────────────────────────────────────────
async function saveMatch() {
  const match = state.match;
  if (!match) return;
  const idx = state.history.findIndex(m => m.id === match.id);
  if (idx >= 0) state.history[idx] = match;
  else state.history.push(match);

  try {
    await saveMatchToFirestore(match);
  } catch (err) {
    console.error('Failed to save match to Firestore', err);
    showToast('Unable to save match. Check your connection.');
  }
}

// ─── UTILS ────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}
function shareMatch() {
  const m = state.match;
  if (!m) return;
  const i1 = m.inning1, i2 = m.inning2;
  const text = `🦁 ENJC Sports Club\n⚔ ${m.team1.name} vs ${m.team2.name}\n🏏 ${m.team1.name}: ${i1?i1.runs+'/'+i1.wickets:'—'} (${i1?Math.floor(i1.balls/6)+'.'+i1.balls%6:'0'} ov)\n🏏 ${m.team2.name}: ${i2?i2.runs+'/'+i2.wickets:'—'} (${i2?Math.floor(i2.balls/6)+'.'+i2.balls%6:'0'} ov)\n🏆 ${m.result||'In Progress'}\n#ENJCSportsClub #GameOnFire`;
  if (navigator.share) navigator.share({ title: 'ENJC Sports Club', text });
  else navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

const appApi = {
  nav,
  startMatch,
  openBatterSelect,
  openBowlerSelect,
  selectModalItem,
  recordWicket,
  undoLastBall,
  resumeOrView,
  closeModal,
  shareMatch
};
Object.assign(window, appApi);

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  nav('home');
  initMatchSync();
  renderDashboard();

  // nav clicks
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const p = item.dataset.page;
      if (p === 'new') { initSetup(); nav('new'); return; }
      if (p === 'score' && !state.match) { showToast('Start a match first!'); return; }
      if (p === 'score') { renderScorecard(); }
      if (p === 'home') { renderDashboard(); }
      nav(p);
    });
  });

  // overs buttons
  document.querySelectorAll('.overs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setupData.overs = btn.dataset.overs;
      document.querySelectorAll('.overs-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
});
