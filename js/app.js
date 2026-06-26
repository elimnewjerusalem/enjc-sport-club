/* ═══════════════════════════════════════════════════════════════
   ENJC Sport Club — Game on Fire 🔥
   Cricket Scoring Engine — Bug Fixed v2
   Fixes:
   1. ES module scope — all functions exposed via window.*
   2. addBall not on window → onclick broken
   3. shareMatch duplicate removed from HTML
   4. openBatterSelect filter index mismatch
   5. checkInningsEnd — 2nd innings winner wrong team
   6. recordWicket — double ball count to allBalls fixed
   7. Firebase offline fallback + localStorage cache
   8. CSS text-3/text-4 tokens fixed in CSS
   9. undoLastBall — fresh innings never assigned (dead code) fixed
═══════════════════════════════════════════════════════════════ */

import { subscribeToMatchHistory, subscribeToMatch, saveMatch as saveMatchToFirestore } from './firebase.js';

// ─── STATE ────────────────────────────────────────────────────
let state = {
  match: null,
  history: JSON.parse(localStorage.getItem('enjc_matches') || '[]') // BUG7 FIX: local cache
};

let historyUnsub = null;
let matchUnsub = null;

function setMatch(match) {
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
    // BUG7 FIX: also sync to localStorage for offline
    localStorage.setItem('enjc_matches', JSON.stringify(matches));
    renderDashboard();
    if (state.match?.id) {
      const openMatch = matches.find(m => m.id === state.match.id);
      if (openMatch) {
        state.match = openMatch;
        if (document.getElementById('page-score').classList.contains('active')) renderScorecard();
        if (document.getElementById('page-summary').classList.contains('active')) renderSummary();
      }
    }
  }, error => {
    // BUG7 FIX: Firebase down → use localStorage silently
    console.warn('Firestore offline, using local cache:', error);
    renderDashboard();
  });
}

const defaultMatch = () => ({
  id: Date.now(),
  format: '5',
  team1: { name: 'Team A', players: [] },
  team2: { name: 'Team B', players: [] },
  innings: 1,
  batting: 1,
  inning1: null,
  inning2: null,
  current: null,
  status: 'setup'
});

const defaultInning = (battingTeam, bowlingTeam, maxOvers) => ({
  battingTeam,
  bowlingTeam,
  maxOvers: parseInt(maxOvers),
  runs: 0,
  wickets: 0,
  balls: 0,
  extras: { wide: 0, noBall: 0, bye: 0 },
  batters: [],
  bowlers: [],
  lastSix: [],
  allBalls: [],
  onStrike: null,
  nonStrike: null,
  currentBowler: null,
  overBalls: 0
});

// ─── CRICKET LOGIC ────────────────────────────────────────────
function oversStr(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}
function sr(runs, balls) {
  return balls === 0 ? '0.0' : ((runs / balls) * 100).toFixed(1);
}
function crr(runs, balls) {
  return balls === 0 ? '0.0' : ((runs / balls) * 6).toFixed(2);
}
function rrr(tgt, runs, bl) {
  const need = tgt - runs;
  if (need <= 0 || bl <= 0) return '0.0';
  return ((need / bl) * 6).toFixed(2);
}
function ballsLeft(inning) {
  return inning.maxOvers * 6 - inning.balls;
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
  // show live pill only on score page
  document.getElementById('live-pill').style.display =
    (pageId === 'score' && state.match?.status === 'live') ? 'flex' : 'none';
}

// ─── DASHBOARD ────────────────────────────────────────────────
function renderDashboard() {
  const cont = document.getElementById('match-list');
  const history = state.history.slice().reverse();

  if (history.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏏</div>
      <div class="empty-text">No matches yet.<br>Tap <strong style="color:var(--gold)">New Match</strong> to start scoring!</div>
    </div>`;
    return;
  }

  cont.innerHTML = history.map(m => {
    const i1 = m.inning1; const i2 = m.inning2;
    const winner = m.winner || '';
    const resultText = winner ? `🏆 ${winner} won` : '⚡ In Progress';
    const score1 = i1 ? `${i1.runs}/${i1.wickets}` : '—';
    const score2 = i2 ? `${i2.runs}/${i2.wickets}` : '—';
    return `<div class="match-card" onclick="window.resumeOrView(${m.id})">
      <div class="match-meta">
        <span class="match-format">${m.format} Overs · Cricket</span>
        <span style="font-size:10px;color:var(--text-3)">${timeAgo(m.id)}</span>
      </div>
      <div class="match-teams">
        <span class="mt-name">${m.team1.name}</span>
        <span class="mt-score">${score1}</span>
        <span class="mt-vs">vs</span>
        <span class="mt-score">${score2}</span>
        <span class="mt-name" style="text-align:right">${m.team2.name}</span>
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
  if (m.status === 'done') { renderSummary(); nav('summary'); }
  else { renderScorecard(); nav('score'); }
}

// ─── NEW MATCH SETUP ──────────────────────────────────────────
let setupData = { overs: '5' };

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
  match.format = overs;
  match.team1  = { name: t1name, players: t1players };
  match.team2  = { name: t2name, players: t2players };
  match.status = 'live';
  match.inning1 = defaultInning('team1', 'team2', overs);
  match.current = match.inning1;
  match.innings = 1;

  setMatch(match);
  openBatterSelect('strike', () => openBatterSelect('non-strike', () => openBowlerSelect(() => {
    saveMatch();
    renderScorecard();
    nav('score');
  })));
}

// ─── BATTER / BOWLER MODALS ───────────────────────────────────
function openBatterSelect(type, cb) {
  const inn = state.match.current;
  const battingTeam = state.match[inn.battingTeam];

  // BUG4 FIX: collect already-in player INDICES properly
  const alreadyInIdx = inn.batters
    .filter(b => !b.out)
    .map(b => b.idx);

  const available = battingTeam.players
    .map((name, idx) => ({ name, idx }))
    .filter(p => !alreadyInIdx.includes(p.idx));

  if (available.length === 0) {
    showToast('All batters used!');
    if (cb) cb(); // force continue so innings can end
    return;
  }

  const label = type === 'strike' ? 'Choose Batter (Strike)' : 'Choose Batter (Non-Strike)';
  openSelectModal(label, available.map(p => p.name), (chosenName) => {
    // BUG4 FIX: find idx from available list, not re-indexOf (avoids duplicates)
    const chosen = available.find(p => p.name === chosenName);
    if (!chosen) return;
    const idx = chosen.idx;

    if (type === 'strike') inn.onStrike = idx;
    else inn.nonStrike = idx;

    if (!inn.batters.find(b => b.idx === idx)) {
      inn.batters.push({ idx, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
    }
    if (cb) cb();
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
    `<div class="modal-item" onclick="window.selectModalItem('${name.replace(/'/g, "\\'")}')">
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

  const isWide   = type === 'wide';
  const isNoBall = type === 'noball';
  const isWicket = type === 'wicket';
  const isBye    = type === 'bye';
  const isLegal  = !isWide && !isNoBall;

  const bowler  = inn.bowlers.find(b => b.idx === inn.currentBowler);
  const striker = inn.batters.find(b => b.idx === inn.onStrike);

  // runs accounting
  if (isWide) {
    inn.runs += runs + 1;
    inn.extras.wide++;
    if (bowler) { bowler.wides++; bowler.runs += runs + 1; }
  } else if (isNoBall) {
    inn.runs += runs + 1;
    inn.extras.noBall++;
    if (bowler) { bowler.noBalls++; bowler.runs += runs + 1; }
  } else {
    if (!isWicket && !isBye && striker) {
      striker.runs += runs;
      if (runs === 4) striker.fours++;
      if (runs === 6) striker.sixes++;
    }
    if (isBye) inn.extras.bye = (inn.extras.bye || 0) + runs;
    inn.runs += runs;
    if (bowler) bowler.runs += runs;
  }

  // ball count (legal deliveries only)
  if (isLegal) {
    inn.balls++;
    inn.overBalls++;
    if (striker) striker.balls++;
    if (bowler) bowler.balls++;
  }

  // ball log — BUG6 FIX: only push here, NOT again in recordWicket
  const ballEntry = { type, runs };
  inn.allBalls.push(ballEntry);
  inn.lastSix = inn.allBalls.slice(-6);

  // wicket — open modal, return early (saveMatch happens after dismissal chosen)
  if (isWicket) {
    openWicketModal();
    return;
  }

  // strike rotation on odd runs (legal only)
  if (isLegal && runs % 2 !== 0) {
    [inn.onStrike, inn.nonStrike] = [inn.nonStrike, inn.onStrike];
  }

  // over complete
  if (isLegal && inn.overBalls === 6) {
    inn.overBalls = 0;
    if (bowler) bowler.overs++;
    [inn.onStrike, inn.nonStrike] = [inn.nonStrike, inn.onStrike]; // rotate at end of over
    checkInningsEnd();
    if (match.status === 'live') {
      openBowlerSelect(() => { saveMatch(); renderScorecard(); });
      return;
    }
  }

  checkInningsEnd();
  saveMatch();
  renderScorecard();
}

function openWicketModal() {
  document.getElementById('dismissal-list').innerHTML =
    ['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired'].map(d =>
      `<div class="modal-item" onclick="window.recordWicket('${d}')">${d}</div>`
    ).join('');
  document.getElementById('wicket-modal').classList.add('open');
}

function recordWicket(dismissal) {
  closeModal();
  const inn = state.match.current;
  const striker = inn.batters.find(b => b.idx === inn.onStrike);
  if (striker) { striker.out = true; striker.dismissal = dismissal; }
  inn.wickets++;

  const bowler = inn.bowlers.find(b => b.idx === inn.currentBowler);
  if (bowler && dismissal !== 'Run Out') bowler.wickets++;
  // BUG6 FIX: ball count already added in addBall() — do NOT add again here

  // all out check
  const totalPlayers = state.match[inn.battingTeam].players.length;
  if (inn.wickets >= Math.min(totalPlayers - 1, 10)) {
    checkInningsEnd(true);
    return;
  }

  // over complete after wicket?
  if (inn.overBalls === 6) {
    inn.overBalls = 0;
    if (bowler) bowler.overs++;
    [inn.onStrike, inn.nonStrike] = [inn.nonStrike, inn.onStrike];
    openBatterSelect('strike', () =>
      openBowlerSelect(() => { saveMatch(); renderScorecard(); })
    );
  } else {
    openBatterSelect('strike', () => { saveMatch(); renderScorecard(); });
  }
}

function checkInningsEnd(allOut = false) {
  const match = state.match;
  const inn = match.current;
  const maxBalls = inn.maxOvers * 6;
  const isOver   = allOut || inn.balls >= maxBalls;
  const tgt      = target(match.inning1);
  const chased   = tgt !== null && inn.runs >= tgt;

  if (!isOver && !chased) return;

  if (match.innings === 1) {
    match.inning1 = { ...inn };
    // BUG5 FIX: inning2 — team2 bats, team1 bowls (always, regardless of toss flip)
    match.inning2 = defaultInning('team2', 'team1', inn.maxOvers);
    match.current = match.inning2;
    match.innings = 2;
    showToast(`Innings over! Target: ${inn.runs + 1}`);
    setTimeout(() => {
      openBatterSelect('strike', () => openBatterSelect('non-strike', () =>
        openBowlerSelect(() => { saveMatch(); renderScorecard(); })
      ));
    }, 600);
  } else {
    // match done
    match.inning2 = { ...inn };
    const i1 = match.inning1;
    const i2 = match.inning2;

    if (chased) {
      // BUG5 FIX: wickets left = team2 players - 1 - wickets fallen
      const wktsLeft = match.team2.players.length - 1 - i2.wickets;
      match.winner = match.team2.name;
      match.result = `${match.team2.name} won by ${wktsLeft} wicket${wktsLeft !== 1 ? 's' : ''}`;
    } else if (i1.runs > i2.runs) {
      match.winner = match.team1.name;
      match.result = `${match.team1.name} won by ${i1.runs - i2.runs} runs`;
    } else if (i2.runs > i1.runs) {
      const wktsLeft = match.team2.players.length - 1 - i2.wickets;
      match.winner = match.team2.name;
      match.result = `${match.team2.name} won by ${wktsLeft} wicket${wktsLeft !== 1 ? 's' : ''}`;
    } else {
      match.winner = null;
      match.result = 'Match Tied! 🤝';
    }
    match.status = 'done';
    saveMatch();
    renderSummary();
    nav('summary');
  }
}

// BUG9 FIX: undoLastBall — properly revert last ball from state
function undoLastBall() {
  const inn = state.match?.current;
  if (!inn || inn.allBalls.length === 0) { showToast('Nothing to undo'); return; }

  const last = inn.allBalls[inn.allBalls.length - 1];
  const isWide   = last.type === 'wide';
  const isNoBall = last.type === 'noball';
  const isLegal  = !isWide && !isNoBall;
  const isWicket = last.type === 'wicket';
  const isBye    = last.type === 'bye';

  // reverse runs
  if (isWide || isNoBall) {
    inn.runs -= (last.runs + 1);
    if (isWide) inn.extras.wide = Math.max(0, inn.extras.wide - 1);
    if (isNoBall) inn.extras.noBall = Math.max(0, inn.extras.noBall - 1);
  } else {
    inn.runs -= last.runs;
    if (isBye) inn.extras.bye = Math.max(0, (inn.extras.bye || 0) - last.runs);
    else if (!isWicket) {
      const striker = inn.batters.find(b => b.idx === inn.onStrike);
      if (striker) {
        striker.runs -= last.runs;
        if (last.runs === 4) striker.fours = Math.max(0, striker.fours - 1);
        if (last.runs === 6) striker.sixes = Math.max(0, striker.sixes - 1);
      }
    }
  }

  // reverse ball counts
  if (isLegal) {
    inn.balls = Math.max(0, inn.balls - 1);
    inn.overBalls = Math.max(0, inn.overBalls - 1);
    const striker = inn.batters.find(b => b.idx === inn.onStrike);
    if (striker && !isWicket) striker.balls = Math.max(0, striker.balls - 1);
    const bowler = inn.bowlers.find(b => b.idx === inn.currentBowler);
    if (bowler) bowler.balls = Math.max(0, bowler.balls - 1);
  }

  // reverse wicket
  if (isWicket) {
    inn.wickets = Math.max(0, inn.wickets - 1);
    const lastBatter = inn.batters.find(b => b.out);
    if (lastBatter) { lastBatter.out = false; lastBatter.dismissal = ''; }
  }

  // reverse strike rotation
  if (isLegal && last.runs % 2 !== 0) {
    [inn.onStrike, inn.nonStrike] = [inn.nonStrike, inn.onStrike];
  }

  inn.allBalls.pop();
  inn.lastSix = inn.allBalls.slice(-6);

  showToast('↩ Undone');
  saveMatch();
  renderScorecard();
}

// ─── RENDER SCORECARD ─────────────────────────────────────────
function renderScorecard() {
  const match = state.match;
  if (!match) return;
  const inn = match.current;
  const battingTeam  = match[inn.battingTeam];
  const bowlingTeam  = match[inn.bowlingTeam];
  const tgt          = target(match.inning1);
  const innings      = match.innings;

  document.getElementById('sc-header-txt').textContent =
    `${battingTeam.name} batting · ${innings === 1 ? '1st' : '2nd'} innings`;
  document.getElementById('sc-target-badge').textContent =
    tgt ? `🎯 Target ${tgt}` : '';

  document.getElementById('sc-team1-name').textContent = match.team1.name;
  document.getElementById('sc-team2-name').textContent = match.team2.name;

  const i1 = match.inning1;
  const i2 = match.inning2;

  document.getElementById('sc-score1').textContent =
    i1 && innings === 2 ? `${i1.runs}` : (innings === 1 ? `${inn.runs}` : '—');
  document.getElementById('sc-detail1').textContent =
    i1 && innings === 2 ? `${i1.wickets} wkts` : (innings === 1 ? `${inn.wickets} wkts` : '');
  document.getElementById('sc-score2').textContent =
    innings === 2 ? `${inn.runs}` : '—';
  document.getElementById('sc-detail2').textContent =
    innings === 2 ? `${inn.wickets} wkts` : '';

  document.getElementById('sc-score1').classList.toggle('batting', innings === 1);
  document.getElementById('sc-score2').classList.toggle('batting', innings === 2);

  // overs progress
  const pct = Math.min(100, (inn.balls / (inn.maxOvers * 6)) * 100);
  document.getElementById('sc-over-fill').style.width = pct + '%';
  document.getElementById('sc-over-count').textContent = `${oversStr(inn.balls)} / ${inn.maxOvers}`;

  // last 6 balls
  const ballsHtml = inn.lastSix.map(b => {
    let cls = 'b-dot', label = '·';
    if (b.type === 'wicket') { cls = 'b-w';  label = 'W'; }
    else if (b.type === 'wide')   { cls = 'b-wd'; label = 'Wd'; }
    else if (b.type === 'noball') { cls = 'b-wd'; label = 'Nb'; }
    else if (b.runs === 4) { cls = 'b-4'; label = '4'; }
    else if (b.runs === 6) { cls = 'b-6'; label = '6'; }
    else if (b.runs > 0)   { cls = 'b-run'; label = b.runs; }
    return `<div class="ball ${cls}">${label}</div>`;
  }).join('');
  document.getElementById('balls-row-inner').innerHTML =
    ballsHtml || '<span style="font-size:10px;color:var(--text-3)">No balls yet</span>';

  // target bar
  const targetBar = document.getElementById('target-bar');
  if (innings === 2 && tgt) {
    targetBar.classList.remove('hidden');
    const need = Math.max(0, tgt - inn.runs);
    const bl   = ballsLeft(inn);
    document.getElementById('need-runs').textContent = `${need} runs`;
    document.getElementById('need-rr').textContent   = `🔥 RRR: ${rrr(tgt, inn.runs, bl)} · ${bl} balls left`;
    document.getElementById('crr-val').textContent   = crr(inn.runs, inn.balls);
  } else {
    targetBar.classList.add('hidden');
  }

  // batters table
  document.getElementById('batter-rows').innerHTML = inn.batters.map(b => {
    const name      = battingTeam.players[b.idx];
    const isStrike  = b.idx === inn.onStrike;
    const isNon     = b.idx === inn.nonStrike;
    const role      = b.out
      ? `<span class="player-sub out">${b.dismissal || 'Out'}</span>`
      : isStrike ? `<span class="player-sub strike">On strike ★</span>`
      : isNon    ? `<span class="player-sub">Non-striker</span>` : '';
    const avaStyle  = b.out
      ? 'background:rgba(220,38,38,0.12);color:var(--red)'
      : isStrike ? '' : 'background:rgba(37,99,235,0.1);color:var(--blue)';
    return `<div class="stats-row ${isStrike ? 'on-strike' : ''} ${b.out ? 'out' : ''}">
      <div class="player-ava" style="${avaStyle}">${initials(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isStrike ? ' ★' : ''}</div>${role}</div>
      <div class="stat-val ${isStrike ? 'gold' : ''}">${b.runs}</div>
      <div class="stat-val">${b.balls}</div>
      <div class="stat-val">${b.fours}</div>
      <div class="stat-val ${isStrike ? 'gold' : ''}">${sr(b.runs, b.balls)}</div>
    </div>`;
  }).join('') || `<div class="stats-row"><div class="player-name" style="color:var(--text-3);padding:4px 0">Select batter to begin</div></div>`;

  // bowlers table
  document.getElementById('bowler-rows').innerHTML = inn.bowlers.map(b => {
    const name      = bowlingTeam.players[b.idx];
    const isCurrent = b.idx === inn.currentBowler;
    const eco       = b.balls === 0 ? '—' : ((b.runs / b.balls) * 6).toFixed(1);
    return `<div class="stats-row ${isCurrent ? 'on-strike' : ''}">
      <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${initials(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isCurrent ? ' ⚡' : ''}</div></div>
      <div class="stat-val">${b.overs}.${b.balls % 6}</div>
      <div class="stat-val">${b.runs}</div>
      <div class="stat-val">${b.wickets}</div>
      <div class="stat-val ${isCurrent ? 'gold' : ''}">${eco}</div>
    </div>`;
  }).join('');
}

// ─── SUMMARY ──────────────────────────────────────────────────
function renderSummary() {
  const match = state.match;
  if (!match) return;
  const i1 = match.inning1;
  const i2 = match.inning2;

  document.getElementById('winner-name').textContent = match.winner || 'Tied! 🤝';
  document.getElementById('winner-sub').textContent  = match.result || '';

  // MoM — highest runs across both innings
  const allBatters = [
    ...(i1?.batters || []).map(b => ({ ...b, team: match.team1 })),
    ...(i2?.batters || []).map(b => ({ ...b, team: match.team2 }))
  ];
  const mom = allBatters.reduce((a, b) => b.runs > (a?.runs || -1) ? b : a, null);
  if (mom) {
    const momName = mom.team.players[mom.idx] || '—';
    document.getElementById('mom-name').textContent = momName;
    document.getElementById('mom-stat').textContent = `${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs, mom.balls)}`;
    document.getElementById('mom-ava').textContent  = initials(momName);
  }

  // full scorecard
  document.getElementById('summary-scorecards').innerHTML = [
    { inn: i1, team: match.team1, bowlingTeam: match.team2 },
    { inn: i2, team: match.team2, bowlingTeam: match.team1 }
  ].filter(x => x.inn).map(({ inn, team, bowlingTeam }) => `
    <div class="section">
      <div class="sec-label">${team.name} — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} ov)</div>
      <div class="stats-card">
        <div class="stats-head">
          <div class="sh-name">Batter</div>
          <div class="sh-stat">R</div><div class="sh-stat">B</div>
          <div class="sh-stat">4s</div><div class="sh-stat">SR</div>
        </div>
        ${inn.batters.map(b => {
          const name = team.players[b.idx];
          return `<div class="stats-row ${b.out ? 'out' : ''}">
            <div class="player-ava" style="${b.out ? 'background:rgba(220,38,38,0.08);color:var(--red)' : ''}">${initials(name)}</div>
            <div style="flex:1">
              <div class="player-name">${name}</div>
              <div class="player-sub ${b.out ? 'out' : ''}">${b.out ? b.dismissal : 'not out'}</div>
            </div>
            <div class="stat-val gold">${b.runs}</div>
            <div class="stat-val">${b.balls}</div>
            <div class="stat-val">${b.fours}</div>
            <div class="stat-val">${sr(b.runs, b.balls)}</div>
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
          const eco = b.balls === 0 ? '—' : ((b.runs/b.balls)*6).toFixed(1);
          return `<div class="stats-row">
            <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${initials(name)}</div>
            <div style="flex:1"><div class="player-name">${name}</div></div>
            <div class="stat-val">${b.overs}.${b.balls%6}</div>
            <div class="stat-val">${b.runs}</div>
            <div class="stat-val gold">${b.wickets}</div>
            <div class="stat-val">${eco}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

// ─── SAVE (Firestore + localStorage fallback) ─────────────────
async function saveMatch() {
  const match = state.match;
  if (!match) return;
  const idx = state.history.findIndex(m => m.id === match.id);
  if (idx >= 0) state.history[idx] = match;
  else state.history.push(match);

  // BUG7 FIX: always write to localStorage immediately
  localStorage.setItem('enjc_matches', JSON.stringify(state.history));

  try {
    await saveMatchToFirestore(match);
  } catch (err) {
    // silent — localStorage has it, Firestore will sync when back online
    console.warn('Firestore save failed (offline?), data saved locally:', err.message);
  }
}

// ─── SHARE ────────────────────────────────────────────────────
function shareMatch() {
  const m = state.match;
  if (!m) return;
  const i1 = m.inning1, i2 = m.inning2;
  const text = `🦁 ENJC Sports Club\n⚔ ${m.team1.name} vs ${m.team2.name}\n🏏 ${m.team1.name}: ${i1 ? i1.runs+'/'+i1.wickets : '—'} (${i1 ? oversStr(i1.balls) : '0'} ov)\n🏏 ${m.team2.name}: ${i2 ? i2.runs+'/'+i2.wickets : '—'} (${i2 ? oversStr(i2.balls) : '0'} ov)\n🏆 ${m.result || 'In Progress'}\n#ENJCSportsClub #GameOnFire`;
  if (navigator.share) navigator.share({ title: 'ENJC Sports Club', text });
  else navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

// ─── UTILS ────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── BUG1 FIX: Expose all functions to window (ES module scope fix) ──
Object.assign(window, {
  nav, startMatch, resumeOrView,
  addBall,             // BUG2 FIX: was missing from window
  selectModalItem, closeModal,
  recordWicket, undoLastBall,
  shareMatch           // BUG3 FIX: one source of truth
});

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  nav('home');
  initMatchSync();
  renderDashboard();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const p = item.dataset.page;
      if (p === 'new')   { initSetup(); nav('new'); return; }
      if (p === 'score') {
        if (!state.match) { showToast('Start a match first!'); return; }
        renderScorecard();
      }
      if (p === 'home')    renderDashboard();
      if (p === 'summary') { if (state.match) renderSummary(); }
      nav(p);
    });
  });

  document.querySelectorAll('.overs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setupData.overs = btn.dataset.overs;
      document.querySelectorAll('.overs-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
});
