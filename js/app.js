/* ═══════════════════════════════════════════════════════════════
   ENJC Sport Club v8
   New features (v7 → v8):
   1. Saved Team Rosters — save/load player lists per team so you
      don't retype them every match (Home → Saved Teams)
   2. Player Career Stats — aggregated runs/wickets/SR/economy
      across all stored matches (Home → Player Stats)
   3. Tournament Mode — group matches under a tournament, auto
      points table (2 pts win, 1 pt tie) (Home → Tournaments)
   4. Shareable Scorecard Image — canvas-generated PNG result
      card, shares via Web Share API or downloads (Summary → Image)

   Bugs fixed (v6 → v7):
   1. Match Plan PDF dropped typed team names — exportRosterPDF's
      getBlock() had a ternary/|| operator-precedence bug, so the
      PDF always printed literal "Team 1"/"Team 2" instead of the
      name typed in; Team 2 could even show "Team 1" wrongly.
   2. recordWicket() only checked all-out, never overs-completed
      or target-chased — so a wicket on the last ball of the last
      over (without being all-out) wrongly kept the innings going
      instead of ending it. Now uses isInningsOver() consistently.
   3. CRITICAL: target()/isChaseDone() relied on match.current and
      match.inning1 being the *same object* during innings 1 — once
      Firestore sync replaced S.match with a deserialized copy, the
      two became separate objects and inning1.runs froze at 0,
      making target()=1 and ending the innings on the very first
      scoring ball. Now target is explicitly null unless innings===2.

   Bugs fixed (earlier, v6):
   1. Team 1 only 1 ball then jumps to team 2 — checkInningsEnd
      called BEFORE addBall completes its own over logic
   2. Recent matches not showing — initSync overwrites history
      before localStorage loads; fixed with merge strategy
   3. Live share link not working — subscribeToMatch is async,
      unsub was not awaited; fixed with proper async chain
   4. Match plan (roster) page — new dedicated page with PDF export
   5. inning2 batters empty in PDF — current inn spread missing batters
   New features (v6):
   6. Match Plan page — team roster, positions, PDF export
   7. Toss selector before match start
═══════════════════════════════════════════════════════════════ */

import {
  subscribeToMatchHistory, subscribeToMatch,
  saveMatch as fbSave, deleteMatch as fbDelete, batchDeleteMatches
} from './firebase.js';

// ─── STATE ───────────────────────────────────────────────────
const S = {
  match:   null,
  history: JSON.parse(localStorage.getItem('enjc_matches') || '[]'),
  teams:   JSON.parse(localStorage.getItem('enjc_teams') || '[]'),
  tournaments: JSON.parse(localStorage.getItem('enjc_tournaments') || '[]'),
  sport:   'cricket'
};
function saveTeams()       { localStorage.setItem('enjc_teams', JSON.stringify(S.teams)); }
function saveTournaments() { localStorage.setItem('enjc_tournaments', JSON.stringify(S.tournaments)); }
let historyUnsub = null, matchUnsub = null, pendingDelete = null, isScorer = false;

// ─── UTILS ───────────────────────────────────────────────────
const $        = id => document.getElementById(id);
const oversStr = b  => `${Math.floor(b/6)}.${b%6}`;
const sr       = (r,b) => b===0 ? '0.0' : ((r/b)*100).toFixed(1);
const crr      = (r,b) => b===0 ? '0.0' : ((r/b)*6).toFixed(2);
const rrr      = (t,r,bl) => { const n=t-r; return (n<=0||bl<=0)?'0.0':((n/bl)*6).toFixed(2); };
const blLeft   = inn => inn.maxOvers*6 - inn.balls;
const target   = i1  => i1 ? i1.runs+1 : null;
const inits    = n   => n ? n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';
const activePage = () => { const p=document.querySelector('.page.active'); return p?p.id.replace('page-',''):''; };
const fmtDate  = ts  => { const d=new Date(ts); return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`; };

function showToast(msg) {
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}
function timeAgo(ts) {
  const d=Date.now()-ts, m=Math.floor(d/60000), h=Math.floor(d/3600000), dd=Math.floor(d/86400000);
  if(dd>0) return `${dd}d ago`; if(h>0) return `${h}h ago`; if(m>0) return `${m}m ago`; return 'Just now';
}

// ─── NAV ────────────────────────────────────────────────────
function nav(pageId) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  $('page-'+pageId)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
  $('live-pill').style.display =
    (pageId==='score'||pageId==='football') && S.match?.status==='live' ? 'flex' : 'none';
}

// ─── FIREBASE ────────────────────────────────────────────────
function setMatch(match, scorer=true) {
  S.match=match; isScorer=scorer;
  if(matchUnsub) { matchUnsub(); matchUnsub=null; }
  if(!match) return;

  const banner=$('sync-banner'), sp=$('page-score');
  scorer
    ? (banner.classList.add('hidden'), sp.classList.remove('viewer-mode'))
    : (banner.classList.remove('hidden'), sp.classList.add('viewer-mode'));

  // BUG3 FIX: subscribeToMatch returns a Promise<unsubscribe>
  subscribeToMatch(match.id, remote => {
    if(!remote) return;
    S.match=remote;
    const idx=S.history.findIndex(m=>m.id===remote.id);
    if(idx>=0) S.history[idx]=remote; else S.history.push(remote);
    const ap=activePage();
    if(ap==='score')    renderCricket();
    if(ap==='football') renderFootball();
    if(ap==='summary')  renderSummary();
  }, e=>{
    console.error('match sub error',e);
    showToast(e?.code==='permission-denied' ? '⚠️ Firestore blocked (check rules)' : '⚠️ Live sync error');
  }).then(unsub=>{ matchUnsub=unsub; });
}

function initSync() {
  if(historyUnsub) historyUnsub();
  // BUG2 FIX: merge remote with local — don't discard local-only matches
  subscribeToMatchHistory(remote => {
    // merge: remote wins for shared matches, keep local-only ones
    const remoteIds = new Set(remote.map(m=>m.id));
    const localOnly = S.history.filter(m=>!remoteIds.has(m.id));
    S.history = [...remote, ...localOnly].sort((a,b)=>b.id-a.id);
    localStorage.setItem('enjc_matches', JSON.stringify(S.history));
    pruneOld();
    if(activePage()==='home') renderDashboard();
    if(S.match?.id) {
      const open=S.history.find(m=>m.id===S.match.id);
      if(open) {
        S.match=open;
        const ap=activePage();
        if(ap==='score')    renderCricket();
        if(ap==='football') renderFootball();
        if(ap==='summary')  renderSummary();
      }
    }
  }, (e) => {
    console.warn('Firestore offline, using localStorage', e);
    if(!window.__syncErrShown) {
      window.__syncErrShown = true;
      showToast(e?.code==='permission-denied' ? '⚠️ Cross-device sync blocked (check Firestore rules)' : '⚠️ No live sync — saved on this phone only');
    }
    renderDashboard();
  })
    .then(unsub => { historyUnsub=unsub; });
}

// ─── DEEP LINK ───────────────────────────────────────────────
function checkDeepLink() {
  const watchId = new URLSearchParams(location.search).get('watch');
  if(!watchId) return;
  isScorer=false;
  // BUG3 FIX: handle async properly
  subscribeToMatch(Number(watchId), remote => {
    if(!remote) { showToast('Match not found'); return; }
    S.match=remote;
    $('sync-banner').classList.remove('hidden');
    if(remote.sport==='football') {
      $('football-entry').style.display='none';
      renderFootball(); nav('football');
    } else {
      $('page-score').classList.add('viewer-mode');
      renderCricket(); nav('score');
    }
  }, e=>console.error(e)).then(()=>{});
}

// ─── PRUNE ───────────────────────────────────────────────────
async function pruneOld() {
  const cut=Date.now()-365*24*60*60*1000;
  const old=S.history.filter(m=>m.id<cut).map(m=>m.id);
  S.history=S.history.filter(m=>m.id>=cut);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  if(old.length) try { await batchDeleteMatches(old); } catch(e){}
}

// ─── SAVE ────────────────────────────────────────────────────
async function saveMatch() {
  const m=S.match; if(!m) return;
  const idx=S.history.findIndex(x=>x.id===m.id);
  idx>=0 ? S.history[idx]=m : S.history.push(m);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  try { await fbSave(m); }
  catch(e) {
    console.warn('Offline, saved locally', e);
    if(!window.__syncErrShown) {
      window.__syncErrShown = true;
      showToast(e?.code==='permission-denied' ? '⚠️ Not synced to other phones (check Firestore rules)' : '⚠️ Saved on this phone only (offline)');
    }
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────
function computeHomeStats() {
  const totalMatches = S.history.length;
  const playerSet = new Set();
  S.teams.forEach(t=>t.players.forEach(p=>p&&playerSet.add(p.trim().toLowerCase())));
  S.history.forEach(m=>{
    (m.team1?.players||[]).forEach(p=>p&&playerSet.add(p.trim().toLowerCase()));
    (m.team2?.players||[]).forEach(p=>p&&playerSet.add(p.trim().toLowerCase()));
  });
  let boundaries=0;
  S.history.filter(m=>m.sport==='cricket').forEach(m=>{
    [m.inning1,m.inning2].filter(Boolean).forEach(inn=>{
      (inn.batters||[]).forEach(b=>{ boundaries += (b.fours||0)+(b.sixes||0); });
    });
  });
  return {totalMatches, players:playerSet.size, tournaments:S.tournaments.length, boundaries};
}

function renderHomeStats() {
  const cont=$('home-stats'); if(!cont) return;
  const s=computeHomeStats();
  cont.innerHTML=`
    <div class="stat-card"><div class="stat-num">${s.totalMatches}</div><div class="stat-lbl">Matches</div></div>
    <div class="stat-card"><div class="stat-num">${s.players}</div><div class="stat-lbl">Players</div></div>
    <div class="stat-card"><div class="stat-num">${s.tournaments}</div><div class="stat-lbl">Tournaments</div></div>
    <div class="stat-card"><div class="stat-num">${s.boundaries}</div><div class="stat-lbl">Boundaries</div></div>`;
}

function renderLiveMatchCard() {
  const slot=$('home-live-slot'); if(!slot) return;
  const live=S.history.find(m=>m.status==='live');
  if(!live) { slot.innerHTML=''; return; }
  let scoreHtml;
  if(live.sport==='cricket') {
    const inn=live.current||live.inning2||live.inning1;
    scoreHtml=inn?`${inn.runs}/${inn.wickets} <span style="font-size:11px;color:var(--text-3)">(${oversStr(inn.balls)} ov)</span>`:'—';
  } else {
    scoreHtml=`${live.goals1||0} – ${live.goals2||0}`;
  }
  slot.innerHTML=`
    <div class="live-match-card pop-in" onclick="window.resumeOrView(${live.id})">
      <div class="lmc-head">
        <span class="lmc-tag"><span class="live-dot"></span>Live Now</span>
        <span style="font-size:10px;color:var(--text-3)">${live.sport==='cricket'?'🏏':'⚽'}${live.venue?' · '+live.venue:''}</span>
      </div>
      <div class="lmc-teams">
        <span style="font-size:13px;color:var(--text)">${live.team1.name} vs ${live.team2.name}</span>
        <span class="lmc-score">${scoreHtml}</span>
      </div>
    </div>`;
}

function renderDashboard() {
  renderHomeStats();
  renderLiveMatchCard();
  const cont=$('match-list');
  const list=S.history.slice().sort((a,b)=>b.id-a.id);
  if(!list.length) {
    cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🏅</div>
      <div class="empty-text">No matches yet.<br>Tap Cricket or Football to start!</div></div>`;
    return;
  }
  cont.innerHTML=list.map(m=>{
    const icon=m.sport==='football'?'⚽':'🏏';
    let score='', res='';
    if(m.sport==='football') {
      score=`${m.goals1||0} – ${m.goals2||0}`;
      res=m.winner?`🏆 ${m.winner} won`:'⚡ In Progress';
    } else {
      const i1=m.inning1, i2=m.inning2;
      const s1=i1?`${i1.runs}/${i1.wickets}`:'—';
      const s2=i2?`${i2.runs}/${i2.wickets}`:'—';
      score=`${s1} vs ${s2}`;
      res=m.winner?`🏆 ${m.winner} won`:'⚡ In Progress';
    }
    return `<div class="match-card" onclick="window.resumeOrView(${m.id})">
      <div class="match-meta">
        <span class="match-format">${icon} ${m.sport==='football'?'Football':m.format+' Overs'} · ${fmtDate(m.id)}</span>
        <span style="font-size:10px;color:var(--text-3)">${timeAgo(m.id)}</span>
      </div>
      <div class="match-teams">
        <span class="mt-name">${m.team1.name}</span>
        <span class="mt-score" style="font-size:13px;flex:1.5;text-align:center">${score}</span>
        <span class="mt-name" style="text-align:right">${m.team2.name}</span>
      </div>
      <div class="match-result">${res}${m.venue?' · '+m.venue:''}</div>
    </div>`;
  }).join('');
}

function resumeOrView(id) {
  const m=S.history.find(x=>x.id===id); if(!m) return;
  setMatch(m);
  if(m.status==='done')          { renderSummary(); nav('summary'); }
  else if(m.sport==='football')  { renderFootball(); nav('football'); }
  else                           { renderCricket(); nav('score'); }
}

// ══════════════════════════════════════════════════════════════
//   MATCH PLAN — ROSTER PAGE
// ══════════════════════════════════════════════════════════════
function gotoMatchPlan() {
  renderMatchPlanPage();
  nav('plan');
}

function renderMatchPlanPage() {
  $('plan-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">📋 Match Plan</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Build your team roster · export as PDF</div>

    <div class="form-group">
      <label class="form-label">Venue / Match Name</label>
      <input class="form-input" id="plan-venue" placeholder="e.g. ENJC Ground, Tondiarpet"/>
    </div>
    <div class="form-group">
      <label class="form-label">Date</label>
      <input class="form-input" id="plan-date" type="date" value="${new Date().toISOString().split('T')[0]}"/>
    </div>

    ${renderRosterBlock('plan-team1','Team 1')}
    ${renderRosterBlock('plan-team2','Team 2')}

    <button class="start-btn" onclick="exportRosterPDF()" style="background:linear-gradient(135deg,var(--gold),#E8B84B)">
      📄 Export Match Plan PDF
    </button>
  `;
  // seed 11 rows each
  for(let i=0;i<11;i++) { addRosterRow('plan-team1'); addRosterRow('plan-team2'); }
}

function renderRosterBlock(id, label) {
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:14px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--gold-hi);margin-bottom:10px">${label}</div>
      <div class="form-group" style="margin-bottom:10px">
        <input class="form-input roster-team-name" data-block="${id}" placeholder="${label} name e.g. ENJC Lions"/>
      </div>
      <div style="display:grid;grid-template-columns:30px 1fr 90px;gap:6px;margin-bottom:6px;padding:0 2px">
        <span style="font-size:9px;color:var(--text-4)">#</span>
        <span style="font-size:9px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.05em">Player Name</span>
        <span style="font-size:9px;color:var(--text-4);text-transform:uppercase;letter-spacing:0.05em">Role</span>
      </div>
      <div id="${id}-rows"></div>
      <button onclick="addRosterRow('${id}')"
        style="margin-top:8px;background:var(--gold-dim);border:1px solid var(--gold-line);color:var(--gold-hi);border-radius:6px;padding:7px 14px;font-family:var(--font-display);font-size:13px;font-weight:600">
        + Add Player
      </button>
    </div>`;
}

function addRosterRow(blockId) {
  const cont=$(`${blockId}-rows`);
  const idx=cont.children.length+1;
  const row=document.createElement('div');
  row.className='roster-row';
  row.innerHTML=`
    <span class="player-num">${idx}</span>
    <input class="form-input roster-name" placeholder="Player ${idx}"
      style="padding:8px 10px;font-size:13px;flex:1"/>
    <select class="form-input roster-role"
      style="padding:8px 6px;font-size:12px;width:90px;flex-shrink:0">
      <option>Batter</option>
      <option>Bowler</option>
      <option>All-round</option>
      <option>WK</option>
      <option>Captain</option>
    </select>
    <button onclick="this.parentElement.remove();reindexRoster('${blockId}')"
      style="background:none;border:none;color:var(--text-3);font-size:16px;padding:0 4px">✕</button>
  `;
  cont.appendChild(row);
}

function reindexRoster(blockId) {
  $(`${blockId}-rows`).querySelectorAll('.player-num')
    .forEach((el,i)=>el.textContent=i+1);
}

function exportRosterPDF() {
  const venue = $('plan-venue').value.trim() || 'ENJC Ground';
  const dateVal = $('plan-date').value;
  const fmtD = dateVal ? new Date(dateVal).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : fmtDate(Date.now());

  function getBlock(blockId) {
    const name = $(`plan-content`).querySelector(`[data-block="${blockId}"]`)?.value.trim() || (blockId==='plan-team1'?'Team 1':'Team 2');
    const rows = [...$(`${blockId}-rows`).querySelectorAll('.roster-row')];
    return {
      name,
      players: rows.map((r,i)=>({
        num: i+1,
        name: r.querySelector('.roster-name').value.trim() || `Player ${i+1}`,
        role: r.querySelector('.roster-role').value
      }))
    };
  }

  const t1=getBlock('plan-team1'), t2=getBlock('plan-team2');
  const opener1=t1.players[0]?.name||'—', opener2=t2.players[0]?.name||'—';
  const last1=t1.players[t1.players.length-1]?.name||'—';
  const last2=t2.players[t2.players.length-1]?.name||'—';
  const captain1=t1.players.find(p=>p.role==='Captain')?.name||t1.players[0]?.name||'—';
  const captain2=t2.players.find(p=>p.role==='Captain')?.name||t2.players[0]?.name||'—';
  const wk1=t1.players.find(p=>p.role==='WK')?.name||'—';
  const wk2=t2.players.find(p=>p.role==='WK')?.name||'—';

  const pdfArea=$('pdf-area');
  pdfArea.innerHTML=`
    <div class="pdf-logo">🦁 ENJC Sports Club</div>
    <div class="pdf-title">📋 Match Plan & Team Roster</div>
    <div class="pdf-meta">${venue} · ${fmtD}</div>
    <div class="pdf-result">${t1.name} vs ${t2.name}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px">
      ${[t1,t2].map(team=>`
        <div>
          <div class="pdf-innings-title">${team.name}</div>
          <div style="font-size:10px;color:#666;margin-bottom:6px">
            Captain: <b>${team===t1?captain1:captain2}</b> · WK: <b>${team===t1?wk1:wk2}</b>
          </div>
          <table class="pdf-table" style="font-size:11px">
            <tr><th>#</th><th>Player</th><th>Role</th></tr>
            ${team.players.filter(p=>p.name).map(p=>`
              <tr>
                <td style="width:24px;text-align:center;color:#999">${p.num}</td>
                <td><b>${p.num===1?'★ ':p.num===team.players.length?'↓ ':''}</b>${p.name}</td>
                <td style="color:#888;font-size:10px">${p.role}</td>
              </tr>`).join('')}
          </table>
          <div style="font-size:10px;color:#888;margin-top:6px">
            ★ Opener · ↓ Last bat
          </div>
        </div>`).join('')}
    </div>

    <div class="pdf-innings-title" style="margin-top:16px">Batting Order Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${[{t:t1,c:captain1,w:wk1,o:opener1,l:last1},{t:t2,c:captain2,w:wk2,o:opener2,l:last2}].map(({t,c,w,o,l})=>`
        <div style="background:#FFF8E8;border-radius:6px;padding:10px;font-size:11px">
          <div style="font-weight:700;color:#A67010;margin-bottom:6px">${t.name}</div>
          <div>Opener: <b>${o}</b></div>
          <div>Captain: <b>${c}</b></div>
          <div>Wicket-keeper: <b>${w}</b></div>
          <div>Last bat: <b>${l}</b></div>
          <div style="color:#999;margin-top:4px">Total: ${t.players.filter(p=>p.name).length} players</div>
        </div>`).join('')}
    </div>

    <div class="pdf-footer">ENJC Sports Club Match Plan · ${fmtD} · Game on Fire 🔥</div>
  `;
  pdfArea.classList.remove('hidden');
  setTimeout(()=>{ window.print(); pdfArea.classList.add('hidden'); }, 200);
}

// ══════════════════════════════════════════════════════════════
//   MATCH SETUP — NEW GAME
// ══════════════════════════════════════════════════════════════
function gotoNewMatch(sport) {
  S.sport=sport;
  renderSetupPage(sport);
  nav('new');
}

function renderSetupPage(sport) {
  const isCricket = sport==='cricket';
  $('setup-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">
      ${isCricket?'🏏 New Cricket Match':'⚽ New Football Match'}
    </div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Set up teams, add players, then start</div>

    ${isCricket?`
    <div class="form-group">
      <label class="form-label">Format (Overs)</label>
      <div class="overs-grid">
        <button class="overs-btn selected" data-overs="5">5 ov</button>
        <button class="overs-btn" data-overs="10">10 ov</button>
        <button class="overs-btn" data-overs="20">20 ov</button>
        <button class="overs-btn" data-overs="50">50 ov</button>
        <button class="overs-btn" data-overs="custom">Custom</button>
      </div>
    </div>
    <div class="form-group hidden" id="custom-overs-group">
      <label class="form-label">Custom Overs (1–100)</label>
      <input class="form-input" id="custom-overs-input" type="number" min="1" max="100" placeholder="e.g. 15"/>
    </div>`:''}

    <div class="form-group">
      <label class="form-label">Venue <span style="color:var(--text-4)">(optional)</span></label>
      <input class="form-input" id="match-venue" placeholder="e.g. ENJC Ground, Tondiarpet"/>
    </div>

    <div class="form-group">
      <label class="form-label">Tournament <span style="color:var(--text-4)">(optional)</span></label>
      <select class="form-input" id="match-tournament">
        <option value="">— None —</option>
        ${S.tournaments.slice().reverse().map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </div>

    ${makeTeamBlock('team1','Team 1 / Batting First')}
    ${makeTeamBlock('team2','Team 2')}

    <!-- Toss -->
    <div class="form-group">
      <label class="form-label">Toss Won By</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="toss-btns">
        <button class="overs-btn" id="toss-t1" onclick="selectToss(1)">Team 1</button>
        <button class="overs-btn" id="toss-t2" onclick="selectToss(2)">Team 2</button>
      </div>
    </div>

    <button class="start-btn" onclick="startMatch()">START MATCH 🔥</button>
  `;

  setupData={overs:'5', toss:1};
  // seed 11 players each
  for(let i=0;i<11;i++) { addPlayerRow('team1'); addPlayerRow('team2'); }

  if(isCricket) {
    document.querySelectorAll('.overs-btn[data-overs]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        setupData.overs=btn.dataset.overs;
        document.querySelectorAll('.overs-btn[data-overs]').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        $('custom-overs-group')?.classList.toggle('hidden', btn.dataset.overs!=='custom');
      });
    });
  }

  // update toss button labels when team names change
  ['team1-name','team2-name'].forEach((id,i)=>{
    $(id)?.addEventListener('input', ()=>{
      const n=$(id).value.trim();
      $(`toss-t${i+1}`).textContent=n||`Team ${i+1}`;
    });
  });

  // saved team rosters
  populateTeamSelects();
  ['team1','team2'].forEach(team=>{
    $(`${team}-load-select`)?.addEventListener('change', e=>{
      loadSavedTeam(team, e.target.value);
      e.target.value='';
    });
  });
}

// ══════════════════════════════════════════════════════════════
//   SAVED TEAM ROSTERS
// ══════════════════════════════════════════════════════════════
function populateTeamSelects() {
  ['team1','team2'].forEach(team=>{
    const sel=$(`${team}-load-select`); if(!sel) return;
    sel.innerHTML = `<option value="">📂 Load saved team…</option>` +
      S.teams.map(t=>`<option value="${t.id}">${t.name} (${t.players.length})</option>`).join('');
  });
}

function loadSavedTeam(team, teamId) {
  if(!teamId) return;
  const t=S.teams.find(x=>String(x.id)===String(teamId)); if(!t) return;
  $(`${team}-name`).value=t.name;
  $(`${team}-players`).innerHTML='';
  t.players.forEach(()=>addPlayerRow(team));
  document.querySelectorAll(`.player-input[data-team="${team}"]`).forEach((inp,i)=>inp.value=t.players[i]||'');
  showToast(`Loaded "${t.name}" ✓`);
}

function saveCurrentAsTeam(team) {
  const name=$(`${team}-name`)?.value.trim();
  const players=[...document.querySelectorAll(`.player-input[data-team="${team}"]`)].map(i=>i.value.trim()).filter(Boolean);
  if(!name) { showToast('Enter team name first'); return; }
  if(players.length<2) { showToast('Add at least 2 players'); return; }
  const existing=S.teams.find(t=>t.name.toLowerCase()===name.toLowerCase());
  if(existing) existing.players=players;
  else S.teams.push({id:Date.now(),name,players});
  saveTeams(); populateTeamSelects();
  showToast(`Saved "${name}" ✓`);
}

// ══════════════════════════════════════════════════════════════
//   SAVED TEAMS — MANAGE PAGE
// ══════════════════════════════════════════════════════════════
function gotoTeamsMgr() { renderTeamsMgrPage(); nav('teamsmgr'); }

function renderTeamsMgrPage() {
  $('teamsmgr-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">🗂️ Saved Teams</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Reuse rosters when starting a new match</div>
    <div id="teams-list"></div>`;
  const cont=$('teams-list');
  if(!S.teams.length) {
    cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🗂️</div><div class="empty-text">No saved teams yet.<br>Save one while setting up a match!</div></div>`;
    return;
  }
  cont.innerHTML=S.teams.slice().reverse().map(t=>`
    <div class="match-card" style="cursor:default">
      <div class="match-teams">
        <span class="mt-name" style="font-size:15px;flex:1">${t.name}</span>
        <button onclick="deleteSavedTeam(${t.id})"
          style="background:rgba(220,38,38,0.08);color:var(--red);border:1px solid rgba(220,38,38,0.2);border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;flex-shrink:0">🗑 Delete</button>
      </div>
      <div class="match-result" style="color:var(--text-3)">${t.players.length} players · ${t.players.join(', ')}</div>
    </div>`).join('');
}

function deleteSavedTeam(id) {
  S.teams=S.teams.filter(t=>t.id!==id);
  saveTeams(); renderTeamsMgrPage();
  showToast('Team deleted');
}

function makeTeamBlock(team, label) {
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:14px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--gold-hi);margin-bottom:10px">${label}</div>
      <div class="form-group" style="margin-bottom:10px">
        <input class="form-input" id="${team}-name" placeholder="${team==='team1'?'Team 1 name':'Team 2 name'}"/>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <select class="form-input" id="${team}-load-select" style="flex:1;font-size:12px;padding:9px 8px">
          <option value="">📂 Load saved team…</option>
        </select>
        <button onclick="saveCurrentAsTeam('${team}')"
          style="background:var(--gold-dim);border:1px solid var(--gold-line);color:var(--gold-hi);border-radius:8px;padding:0 14px;font-family:var(--font-display);font-size:12px;font-weight:700;white-space:nowrap">💾 Save</button>
      </div>
      <div class="form-label" style="margin-bottom:6px">Players (opener → last bat)</div>
      <div id="${team}-players"></div>
      <button onclick="addPlayerRow('${team}')"
        style="margin-top:8px;background:var(--gold-dim);border:1px solid var(--gold-line);color:var(--gold-hi);border-radius:6px;padding:7px 14px;font-family:var(--font-display);font-size:13px;font-weight:600">
        + Add Player
      </button>
    </div>`;
}

let setupData = {overs:'5', toss:1};

function selectToss(team) {
  setupData.toss=team;
  $('toss-t1').classList.toggle('selected', team===1);
  $('toss-t2').classList.toggle('selected', team===2);
}

function addPlayerRow(team) {
  const cont=$(team+'-players');
  const idx=cont.children.length+1;
  const row=document.createElement('div');
  row.className='player-input-row';
  row.innerHTML=`
    <span class="player-num">${idx}</span>
    <input class="form-input player-input" data-team="${team}"
      placeholder="Player ${idx}" style="padding:9px 11px;font-size:13px;flex:1"/>
    <button onclick="this.parentElement.remove();reindexPlayers('${team}')"
      style="background:none;border:none;color:var(--text-3);font-size:16px;padding:0 6px">✕</button>
  `;
  cont.appendChild(row);
}

function reindexPlayers(team) {
  document.querySelectorAll(`.player-input[data-team="${team}"]`)
    .forEach((inp,i)=>inp.closest('.player-input-row').querySelector('.player-num').textContent=i+1);
}

// ─── START MATCH ─────────────────────────────────────────────
function startMatch() {
  const sport=S.sport;
  const t1name=$('team1-name').value.trim()||'Team A';
  const t2name=$('team2-name').value.trim()||'Team B';
  const venue=$('match-venue')?.value.trim()||'';
  const t1p=[...document.querySelectorAll('.player-input[data-team="team1"]')].map(i=>i.value.trim()).filter(Boolean);
  const t2p=[...document.querySelectorAll('.player-input[data-team="team2"]')].map(i=>i.value.trim()).filter(Boolean);

  if(t1p.length<2||t2p.length<2){ showToast('Minimum 2 players per team!'); return; }

  const match={
    id:Date.now(), sport,
    team1:{name:t1name,players:t1p},
    team2:{name:t2name,players:t2p},
    venue, status:'live', createdAt:Date.now(),
    tournamentId: $('match-tournament')?.value ? Number($('match-tournament').value) : null
  };

  if(sport==='cricket') {
    // BUG FIX custom overs: read BEFORE navigate
    let overs=setupData.overs;
    if(overs==='custom') {
      const v=parseInt($('custom-overs-input')?.value||'');
      if(!v||v<1||v>100){ showToast('Enter valid overs (1–100)'); return; }
      overs=String(v);
    }
    match.format=overs;
    match.innings=1;
    // BUG1 FIX: maxOvers stored as number so ball count works correctly
    match.inning1=mkInning('team1','team2',overs);
    match.inning2=null;
    match.current=match.inning1;
    setMatch(match);
    openBatterSelect('strike',()=>openBatterSelect('non-strike',()=>openBowlerSelect(()=>{
      saveMatch(); renderCricket(); nav('score');
    })));
  } else {
    match.goals1=0; match.goals2=0; match.half=1; match.minute=0; match.events=[];
    setMatch(match);
    saveMatch(); renderFootball(); nav('football');
  }
}

// ─── CRICKET DEFAULTS ────────────────────────────────────────
function mkInning(bt,bwt,ov) {
  return {
    battingTeam:bt, bowlingTeam:bwt,
    maxOvers:parseInt(ov),  // always number
    runs:0, wickets:0, balls:0,
    extras:{wide:0,noBall:0,bye:0},
    batters:[], bowlers:[], lastSix:[], allBalls:[],
    onStrike:null, nonStrike:null, currentBowler:null, overBalls:0
  };
}

// ─── MODALS ──────────────────────────────────────────────────
function openBatterSelect(type,cb) {
  const inn=S.match.current, team=S.match[inn.battingTeam];
  const used=inn.batters.filter(b=>!b.out).map(b=>b.idx);
  const avail=team.players.map((name,idx)=>({name,idx})).filter(p=>!used.includes(p.idx));
  if(!avail.length){ if(cb)cb(); return; }
  openSelectModal(
    type==='strike'?'Choose Batter (Strike)':'Choose Batter (Non-Strike)',
    avail.map(p=>p.name),
    name=>{
      const p=avail.find(x=>x.name===name); if(!p) return;
      type==='strike' ? inn.onStrike=p.idx : inn.nonStrike=p.idx;
      if(!inn.batters.find(b=>b.idx===p.idx))
        inn.batters.push({idx:p.idx,runs:0,balls:0,fours:0,sixes:0,out:false,dismissal:''});
      if(cb)cb();
    }
  );
}

function openBowlerSelect(cb) {
  const inn=S.match.current, team=S.match[inn.bowlingTeam];
  openSelectModal('Choose Bowler', team.players, name=>{
    const idx=team.players.indexOf(name);
    if(!inn.bowlers.find(b=>b.idx===idx))
      inn.bowlers.push({idx,overs:0,balls:0,runs:0,wickets:0,wides:0,noBalls:0});
    inn.currentBowler=idx;
    if(cb)cb();
  });
}

function openSelectModal(title,options,onSelect) {
  $('modal-title').textContent=title;
  $('modal-list').innerHTML=options.map(name=>
    `<div class="modal-item" onclick="window.selectModalItem('${name.replace(/'/g,"\\'")}')">
      <div class="player-ava" style="width:28px;height:28px;font-size:9px">${inits(name)}</div>${name}
    </div>`).join('');
  const m=$('select-modal'); m.classList.add('open'); m._cb=onSelect;
}

function selectModalItem(name) {
  const m=$('select-modal'); m.classList.remove('open'); m._cb?.(name);
}

function closeModal() {
  ['select-modal','wicket-modal','delete-modal'].forEach(id=>$(id)?.classList.remove('open'));
}

// ─── CRICKET SCORING ─────────────────────────────────────────
function addBall(type,runs) {
  const match=S.match; if(!match||match.status!=='live') return;
  const inn=match.current; if(!inn) return;

  const isWide=type==='wide', isNoBall=type==='noball';
  const isWicket=type==='wicket', isBye=type==='bye';
  const isLegal=!isWide&&!isNoBall;

  const bowler=inn.bowlers.find(b=>b.idx===inn.currentBowler);
  const striker=inn.batters.find(b=>b.idx===inn.onStrike);

  // runs
  if(isWide)       { inn.runs+=runs+1; inn.extras.wide++;  if(bowler){bowler.wides++;bowler.runs+=runs+1;} }
  else if(isNoBall){ inn.runs+=runs+1; inn.extras.noBall++; if(bowler){bowler.noBalls++;bowler.runs+=runs+1;} }
  else {
    inn.runs+=runs;
    if(!isWicket&&!isBye&&striker){ striker.runs+=runs; if(runs===4)striker.fours++; if(runs===6)striker.sixes++; }
    if(isBye) inn.extras.bye=(inn.extras.bye||0)+runs;
    if(bowler) bowler.runs+=runs;
  }

  // ball counts — legal only
  if(isLegal) {
    inn.balls++; inn.overBalls++;
    if(striker&&!isWicket) striker.balls++;
    if(bowler) bowler.balls++;
  }

  inn.allBalls.push({type,runs});
  inn.lastSix=inn.allBalls.slice(-6);

  // wicket — open modal, return; ball already counted above
  if(isWicket) { openWicketModal(); return; }

  // strike rotate on odd runs
  if(isLegal&&runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];

  // BUG1 FIX: check over complete FIRST, THEN checkInningsEnd
  // Previously checkInningsEnd was called inside the over block AND after — causing double trigger
  if(isLegal&&inn.overBalls===6) {
    inn.overBalls=0;
    if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    // check if innings ended (all overs done)
    if(isInningsOver()) { doInningsEnd(); return; }
    // not over — new bowler
    openBowlerSelect(()=>{ saveMatch(); renderCricket(); });
    return;
  }

  // mid-over: check target chased
  if(isChaseDone()) { doInningsEnd(); return; }

  saveMatch(); renderCricket();
}

// BUG1 FIX: separate innings-end checks, no double call
function isInningsOver() {
  const inn=S.match.current;
  // CRITICAL FIX: only innings 2 can have a chase target. Previously target()
  // relied on match.current and match.inning1 being the *same object* during
  // innings 1 (so the off-by-one math was always false) — but once Firestore
  // sync replaces S.match with a freshly-deserialized copy, current and
  // inning1 become separate objects and inning1.runs freezes at 0, making
  // target()=1 and falsely ending the innings on the very first scoring ball.
  const tgt = S.match.innings===2 ? target(S.match.inning1) : null;
  const allOut=inn.wickets>=Math.min(S.match[inn.battingTeam].players.length-1,10);
  return inn.balls>=inn.maxOvers*6 || allOut || (tgt!==null&&inn.runs>=tgt);
}
function isChaseDone() {
  const inn=S.match.current;
  const tgt = S.match.innings===2 ? target(S.match.inning1) : null;
  return tgt!==null && inn.runs>=tgt;
}

function doInningsEnd() {
  const match=S.match, inn=match.current;
  const tgt=match.innings===2?target(match.inning1):null;
  const chased=tgt!==null&&inn.runs>=tgt;

  if(match.innings===1) {
    // BUG5 FIX: spread inn deeply so batters/bowlers arrays are preserved
    match.inning1=JSON.parse(JSON.stringify(inn));
    match.inning2=mkInning('team2','team1',inn.maxOvers);
    match.current=match.inning2; match.innings=2;
    showToast(`Innings over! Target: ${inn.runs+1}`);
    saveMatch();
    setTimeout(()=>openBatterSelect('strike',()=>openBatterSelect('non-strike',()=>
      openBowlerSelect(()=>{ saveMatch(); renderCricket(); }))), 600);
  } else {
    // BUG5 FIX: deep copy inning2 too
    match.inning2=JSON.parse(JSON.stringify(inn));
    const i1=match.inning1, i2=match.inning2;
    if(chased) {
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name;
      match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else if(i1.runs>i2.runs) {
      match.winner=match.team1.name;
      match.result=`${match.team1.name} won by ${i1.runs-i2.runs} runs`;
    } else if(i2.runs>i1.runs) {
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name;
      match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else {
      match.winner=null; match.result='Match Tied! 🤝';
    }
    match.status='done'; match.current=null;
    saveMatch(); renderSummary(); nav('summary');
  }
}

function openWicketModal() {
  $('dismissal-list').innerHTML=
    ['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired']
    .map(d=>`<div class="modal-item" onclick="window.recordWicket('${d}')">${d}</div>`).join('');
  $('wicket-modal').classList.add('open');
}

function recordWicket(dismissal) {
  closeModal();
  const inn=S.match.current;
  const striker=inn.batters.find(b=>b.idx===inn.onStrike);
  if(striker){ striker.out=true; striker.dismissal=dismissal; }
  inn.wickets++;
  const bowler=inn.bowlers.find(b=>b.idx===inn.currentBowler);
  if(bowler&&dismissal!=='Run Out') bowler.wickets++;

  // BUG2 FIX: check all-out OR overs-completed OR target-chased — not just all-out,
  // otherwise a wicket on the last ball of the last over (without being all-out)
  // wrongly kept the innings going instead of ending it.
  if(isInningsOver()) { doInningsEnd(); return; }

  if(inn.overBalls===6) {
    inn.overBalls=0; if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    openBatterSelect('strike',()=>openBowlerSelect(()=>{ saveMatch(); renderCricket(); }));
  } else {
    openBatterSelect('strike',()=>{ saveMatch(); renderCricket(); });
  }
}

function undoLastBall() {
  const inn=S.match?.current;
  if(!inn||!inn.allBalls.length){ showToast('Nothing to undo'); return; }
  const last=inn.allBalls[inn.allBalls.length-1];
  const isWide=last.type==='wide', isNoBall=last.type==='noball';
  const isLegal=!isWide&&!isNoBall, isWicket=last.type==='wicket', isBye=last.type==='bye';

  if(isWide||isNoBall) {
    inn.runs-=(last.runs+1);
    if(isWide) inn.extras.wide=Math.max(0,inn.extras.wide-1);
    if(isNoBall) inn.extras.noBall=Math.max(0,inn.extras.noBall-1);
  } else {
    inn.runs-=last.runs;
    if(isBye) inn.extras.bye=Math.max(0,(inn.extras.bye||0)-last.runs);
    else if(!isWicket) {
      const s=inn.batters.find(b=>b.idx===inn.onStrike);
      if(s){ s.runs-=last.runs; if(last.runs===4)s.fours=Math.max(0,s.fours-1); if(last.runs===6)s.sixes=Math.max(0,s.sixes-1); }
    }
  }
  if(isLegal) {
    inn.balls=Math.max(0,inn.balls-1); inn.overBalls=Math.max(0,inn.overBalls-1);
    const s=inn.batters.find(b=>b.idx===inn.onStrike);
    if(s&&!isWicket) s.balls=Math.max(0,s.balls-1);
    const bw=inn.bowlers.find(b=>b.idx===inn.currentBowler);
    if(bw) bw.balls=Math.max(0,bw.balls-1);
  }
  if(isWicket) {
    inn.wickets=Math.max(0,inn.wickets-1);
    const lb=inn.batters.slice().reverse().find(b=>b.out);
    if(lb){ lb.out=false; lb.dismissal=''; }
  }
  if(isLegal&&last.runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
  inn.allBalls.pop(); inn.lastSix=inn.allBalls.slice(-6);
  showToast('↩ Undone'); saveMatch(); renderCricket();
}

// ─── CRICKET RENDER ──────────────────────────────────────────
function renderCricket() {
  const match=S.match; if(!match) return;
  const inn=match.current||match.inning2||match.inning1; if(!inn) return;
  const bt=match[inn.battingTeam], bwt=match[inn.bowlingTeam];
  const tgt=match.innings===2?target(match.inning1):null, innings=match.innings;

  $('sc-header-txt').textContent=`${bt.name} batting · ${innings===1?'1st':'2nd'} innings`;
  $('sc-target-badge').textContent=tgt?`🎯 Target ${tgt}`:'';
  $('sc-team1-name').textContent=match.team1.name;
  $('sc-team2-name').textContent=match.team2.name;

  const i1=match.inning1, i2=match.inning2;
  $('sc-score1').textContent=i1&&innings===2?`${i1.runs}`:innings===1?`${inn.runs}`:'—';
  $('sc-detail1').textContent=i1&&innings===2?`${i1.wickets} wkts`:innings===1?`${inn.wickets} wkts`:'';
  $('sc-score2').textContent=innings===2?`${inn.runs}`:'—';
  $('sc-detail2').textContent=innings===2?`${inn.wickets} wkts`:'';
  $('sc-score1').classList.toggle('batting',innings===1);
  $('sc-score2').classList.toggle('batting',innings===2);

  const pct=Math.min(100,(inn.balls/(inn.maxOvers*6))*100);
  $('sc-over-fill').style.width=pct+'%';
  $('sc-over-count').textContent=`${oversStr(inn.balls)} / ${inn.maxOvers}`;

  $('balls-row-inner').innerHTML=inn.lastSix.map(b=>{
    let cls='b-dot',lbl='·';
    if(b.type==='wicket'){cls='b-w';lbl='W';}
    else if(b.type==='wide'){cls='b-wd';lbl='Wd';}
    else if(b.type==='noball'){cls='b-wd';lbl='Nb';}
    else if(b.runs===4){cls='b-4';lbl='4';}
    else if(b.runs===6){cls='b-6';lbl='6';}
    else if(b.runs>0){cls='b-run';lbl=b.runs;}
    return `<div class="ball ${cls}">${lbl}</div>`;
  }).join('')||'<span style="font-size:10px;color:var(--text-3)">No balls yet</span>';

  const tb=$('target-bar');
  if(innings===2&&tgt){
    tb.classList.remove('hidden');
    const need=Math.max(0,tgt-inn.runs), bl=blLeft(inn);
    $('need-runs').textContent=`${need} runs`;
    $('need-rr').textContent=`🔥 RRR: ${rrr(tgt,inn.runs,bl)} · ${bl} balls left`;
    $('crr-val').textContent=crr(inn.runs,inn.balls);
  } else tb.classList.add('hidden');

  $('batter-rows').innerHTML=inn.batters.map(b=>{
    const name=bt.players[b.idx], isSt=b.idx===inn.onStrike, isNon=b.idx===inn.nonStrike;
    const role=b.out?`<span class="player-sub out">${b.dismissal||'Out'}</span>`:
                isSt?`<span class="player-sub strike">On strike ★</span>`:
                isNon?`<span class="player-sub">Non-striker</span>`:'';
    const av=b.out?'background:rgba(220,38,38,0.12);color:var(--red)':isSt?'':'background:rgba(29,78,216,0.1);color:var(--blue)';
    return `<div class="stats-row ${isSt?'on-strike':''} ${b.out?'out':''}">
      <div class="player-ava" style="${av}">${inits(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isSt?' ★':''}</div>${role}</div>
      <div class="stat-val ${isSt?'gold':''}">${b.runs}</div>
      <div class="stat-val">${b.balls}</div>
      <div class="stat-val">${b.fours}</div>
      <div class="stat-val ${isSt?'gold':''}">${sr(b.runs,b.balls)}</div>
    </div>`;
  }).join('')||`<div class="stats-row"><div class="player-name" style="color:var(--text-3);padding:4px 0">Select batter to begin</div></div>`;

  $('bowler-rows').innerHTML=inn.bowlers.map(b=>{
    const name=bwt.players[b.idx], isCur=b.idx===inn.currentBowler;
    const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1);
    return `<div class="stats-row ${isCur?'on-strike':''}">
      <div class="player-ava" style="background:rgba(109,40,217,0.1);color:var(--purple)">${inits(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isCur?' ⚡':''}</div></div>
      <div class="stat-val">${b.overs}.${b.balls%6}</div>
      <div class="stat-val">${b.runs}</div>
      <div class="stat-val">${b.wickets}</div>
      <div class="stat-val ${isCur?'gold':''}">${eco}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//   FOOTBALL
// ══════════════════════════════════════════════════════════════
function fbEvent(type,team) {
  const m=S.match; if(!m||m.status!=='live') return;
  openSelectModal(
    `${type==='goal'?'⚽ Who scored?':type==='yellow'?'🟨 Yellow card:':'🟥 Red card:'} (${team===1?m.team1.name:m.team2.name})`,
    team===1?m.team1.players:m.team2.players,
    name=>{
      m.events=m.events||[];
      m.events.push({type,team,player:name,minute:m.minute||0});
      if(type==='goal') team===1?m.goals1++:m.goals2++;
      saveMatch(); renderFootball();
    }
  );
}

function fbHalfTime() {
  const m=S.match; if(!m) return;
  m.half=2; m.minute=45;
  showToast('Half Time! 45 mins');
  saveMatch(); renderFootball();
}

function fbFullTime() {
  const m=S.match; if(!m) return;
  m.status='done'; m.minute=90;
  const g1=m.goals1||0, g2=m.goals2||0;
  if(g1>g2){ m.winner=m.team1.name; m.result=`${m.team1.name} won ${g1}–${g2}`; }
  else if(g2>g1){ m.winner=m.team2.name; m.result=`${m.team2.name} won ${g2}–${g1}`; }
  else { m.winner=null; m.result=`Draw ${g1}–${g2}`; }
  saveMatch(); renderSummary(); nav('summary');
}

function fbUndo() {
  const m=S.match; if(!m||!m.events?.length){ showToast('Nothing to undo'); return; }
  const last=m.events.pop();
  if(last.type==='goal') last.team===1?m.goals1--:m.goals2--;
  showToast('↩ Undone'); saveMatch(); renderFootball();
}

function renderFootball() {
  const m=S.match; if(!m) return;
  $('fb-team1-name').textContent=m.team1.name;
  $('fb-team2-name').textContent=m.team2.name;
  $('fb-score1').textContent=m.goals1||0;
  $('fb-score2').textContent=m.goals2||0;
  $('fb-t1-label').textContent=m.team1.name;
  $('fb-t2-label').textContent=m.team2.name;
  $('fb-half-badge').textContent=m.half===2?'2nd Half':'1st Half';
  const min=m.minute||0;
  $('fb-time-display').textContent=`${min}'`;
  $('fb-time-fill').style.width=Math.min(100,(min/90)*100)+'%';
  const events=m.events||[];
  $('fb-events').innerHTML=events.length?events.slice().reverse().map(e=>`
    <div class="stats-row" style="padding:6px 0">
      <div style="width:30px;text-align:center;font-size:16px">${e.type==='goal'?'⚽':e.type==='yellow'?'🟨':'🟥'}</div>
      <div style="flex:1"><div class="player-name">${e.player}</div><div class="player-sub">${e.team===1?m.team1.name:m.team2.name}</div></div>
      <div style="font-size:11px;color:var(--text-3)">${e.minute}'</div>
    </div>`).join('')
    :'<div style="color:var(--text-3);font-size:12px">No events yet</div>';
}

// ══════════════════════════════════════════════════════════════
//   SUMMARY
// ══════════════════════════════════════════════════════════════
function renderSummary() {
  const m=S.match; if(!m) return;
  $('winner-name').textContent=m.winner||'Tied! 🤝';
  $('winner-sub').textContent=m.result||'';

  if(m.sport==='football') {
    $('mom-card').style.display='none';
    $('summary-scorecards').innerHTML=`
      <div class="section">
        <div class="sec-label">Match Events</div>
        <div class="stats-card" style="padding:8px 10px">
          ${(m.events||[]).map(e=>`
            <div class="stats-row" style="padding:6px 0">
              <div style="width:30px;text-align:center;font-size:16px">${e.type==='goal'?'⚽':e.type==='yellow'?'🟨':'🟥'}</div>
              <div style="flex:1"><div class="player-name">${e.player}</div><div class="player-sub">${e.team===1?m.team1.name:m.team2.name}</div></div>
              <div style="font-size:11px;color:var(--text-3)">${e.minute}'</div>
            </div>`).join('')||'<div style="color:var(--text-3);font-size:12px;padding:4px 0">No events recorded</div>'}
        </div>
      </div>`;
    return;
  }

  // cricket
  $('mom-card').style.display='flex';
  const i1=m.inning1, i2=m.inning2;
  const allB=[...(i1?.batters||[]).map(b=>({...b,team:m.team1})),
              ...(i2?.batters||[]).map(b=>({...b,team:m.team2}))];
  const mom=allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a,null);
  if(mom) {
    const n=mom.team.players[mom.idx]||'—';
    $('mom-name').textContent=n;
    $('mom-stat').textContent=`${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}`;
    $('mom-ava').textContent=inits(n);
  }

  $('summary-scorecards').innerHTML=[
    {inn:i1,team:m.team1,bwt:m.team2},
    {inn:i2,team:m.team2,bwt:m.team1}
  ].filter(x=>x.inn).map(({inn,team,bwt})=>`
    <div class="section">
      <div class="sec-label">${team.name} — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} ov)</div>
      <div class="stats-card">
        <div class="stats-head">
          <div class="sh-name">Batter</div><div class="sh-stat">R</div><div class="sh-stat">B</div><div class="sh-stat">4s</div><div class="sh-stat">SR</div>
        </div>
        ${inn.batters.map(b=>{const n=team.players[b.idx]; return `<div class="stats-row ${b.out?'out':''}">
          <div class="player-ava" style="${b.out?'background:rgba(220,38,38,0.08);color:var(--red)':''}">${inits(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div><div class="player-sub ${b.out?'out':''}">${b.out?b.dismissal:'not out'}</div></div>
          <div class="stat-val gold">${b.runs}</div><div class="stat-val">${b.balls}</div><div class="stat-val">${b.fours}</div><div class="stat-val">${sr(b.runs,b.balls)}</div>
        </div>`;}).join('')}
        <div style="padding:5px 10px;font-size:10px;color:var(--text-3)">
          Extras: ${(inn.extras.wide||0)+(inn.extras.noBall||0)+(inn.extras.bye||0)} (Wd ${inn.extras.wide||0}, Nb ${inn.extras.noBall||0}, B ${inn.extras.bye||0})
        </div>
      </div>
      <div style="height:8px"></div>
      <div class="stats-card">
        <div class="stats-head">
          <div class="sh-name">Bowler</div><div class="sh-stat">O</div><div class="sh-stat">R</div><div class="sh-stat">W</div><div class="sh-stat">Eco</div>
        </div>
        ${inn.bowlers.map(b=>{const n=bwt.players[b.idx]; const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1); return `<div class="stats-row">
          <div class="player-ava" style="background:rgba(109,40,217,0.1);color:var(--purple)">${inits(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div></div>
          <div class="stat-val">${b.overs}.${b.balls%6}</div><div class="stat-val">${b.runs}</div><div class="stat-val gold">${b.wickets}</div><div class="stat-val">${eco}</div>
        </div>`;}).join('')}
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
//   PDF — FULL MATCH SUMMARY
// ══════════════════════════════════════════════════════════════
function exportPDF() {
  const m=S.match; if(!m) return;
  const d=fmtDate(m.id);
  let content=`
    <div class="pdf-logo">🦁 ENJC Sports Club</div>
    <div class="pdf-title">${m.sport==='football'?'⚽ Football':'🏏 Cricket'} Match Summary</div>
    <div class="pdf-meta">${m.team1.name} vs ${m.team2.name} · ${d}${m.venue?' · '+m.venue:''}</div>
    <div class="pdf-result">${m.result||'In Progress'}</div>`;

  if(m.sport==='cricket') {
    [m.inning1,m.inning2].filter(Boolean).forEach((inn,idx)=>{
      const team=idx===0?m.team1:m.team2;
      const bwt=idx===0?m.team2:m.team1;
      content+=`
        <div class="pdf-innings-title">${team.name} Innings — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} overs)</div>
        <table class="pdf-table">
          <tr><th>Batter</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          ${inn.batters.map(b=>`<tr>
            <td>${team.players[b.idx]}</td>
            <td style="font-size:10px;color:#666">${b.out?b.dismissal:'not out'}</td>
            <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td>
            <td>${sr(b.runs,b.balls)}</td>
          </tr>`).join('')}
          <tr style="background:#FFF8E8">
            <td colspan="7" style="font-size:10px;color:#888;padding:4px 6px">
              Extras: ${(inn.extras.wide||0)+(inn.extras.noBall||0)+(inn.extras.bye||0)}
              (Wd ${inn.extras.wide||0}, Nb ${inn.extras.noBall||0}, B ${inn.extras.bye||0})
              · Total: ${inn.runs}/${inn.wickets} in ${oversStr(inn.balls)} overs
            </td>
          </tr>
        </table>
        <table class="pdf-table" style="margin-top:6px">
          <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Eco</th></tr>
          ${inn.bowlers.map(b=>`<tr>
            <td>${bwt.players[b.idx]}</td>
            <td>${b.overs}.${b.balls%6}</td><td>0</td><td>${b.runs}</td>
            <td><b>${b.wickets}</b></td>
            <td>${b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1)}</td>
          </tr>`).join('')}
        </table>`;
    });
    // MoM
    const allB=[...(m.inning1?.batters||[]).map(b=>({...b,team:m.team1})),
                ...(m.inning2?.batters||[]).map(b=>({...b,team:m.team2}))];
    const mom=allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a,null);
    if(mom) {
      const n=mom.team.players[mom.idx];
      content+=`<div class="pdf-mom">⭐ Man of the Match: ${n} — ${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}</div>`;
    }
  } else {
    content+=`
      <div class="pdf-innings-title">Final Score: ${m.team1.name} ${m.goals1||0} – ${m.goals2||0} ${m.team2.name}</div>
      ${m.events?.length?`<table class="pdf-table">
        <tr><th>Event</th><th>Player</th><th>Team</th><th>Min</th></tr>
        ${m.events.map(e=>`<tr>
          <td>${e.type==='goal'?'⚽ Goal':e.type==='yellow'?'🟨 Yellow':'🟥 Red'}</td>
          <td>${e.player}</td><td>${e.team===1?m.team1.name:m.team2.name}</td><td>${e.minute}'</td>
        </tr>`).join('')}
      </table>`:'<p style="color:#888;font-size:12px">No events recorded</p>'}
      <div class="pdf-innings-title">Squads</div>
      <table class="pdf-table">
        <tr><th>${m.team1.name}</th><th>${m.team2.name}</th></tr>
        ${Array.from({length:Math.max(m.team1.players.length,m.team2.players.length)},(_,i)=>
          `<tr><td>${m.team1.players[i]||''}</td><td>${m.team2.players[i]||''}</td></tr>`).join('')}
      </table>`;
  }

  content+=`<div class="pdf-footer">Generated by ENJC Sports Club · Game on Fire 🔥 · ${d}</div>`;
  const pdfArea=$('pdf-area');
  pdfArea.innerHTML=content; pdfArea.classList.remove('hidden');
  setTimeout(()=>{ window.print(); pdfArea.classList.add('hidden'); },200);
}

// ─── SHARE ───────────────────────────────────────────────────
function shareMatch() {
  const m=S.match; if(!m) return;
  const base=location.origin+location.pathname;
  const watchUrl=m.status==='live'?`${base}?watch=${m.id}`:'';
  let text;
  if(m.sport==='football') {
    text=`🦁 ENJC Sports Club\n⚽ ${m.team1.name} vs ${m.team2.name}\n${m.team1.name} ${m.goals1||0} – ${m.goals2||0} ${m.team2.name}\n🏆 ${m.result||'In Progress'}${watchUrl?'\n📲 '+watchUrl:''}\n#ENJCSportsClub #GameOnFire`;
  } else {
    const i1=m.inning1, i2=m.inning2;
    text=`🦁 ENJC Sports Club\n⚔ ${m.team1.name} vs ${m.team2.name}\n🏏 ${m.team1.name}: ${i1?i1.runs+'/'+i1.wickets:'—'} (${i1?oversStr(i1.balls):'0'} ov)\n🏏 ${m.team2.name}: ${i2?i2.runs+'/'+i2.wickets:'—'} (${i2?oversStr(i2.balls):'0'} ov)\n🏆 ${m.result||'In Progress'}${watchUrl?'\n📲 '+watchUrl:''}\n#ENJCSportsClub #GameOnFire`;
  }
  if(navigator.share) navigator.share({title:'ENJC Sports Club',text,url:watchUrl||base});
  else navigator.clipboard.writeText(text).then(()=>showToast('Copied!'));
}

function shareLiveLink() {
  const m=S.match; if(!m||m.status!=='live'){ showToast('No live match running'); return; }
  const url=`${location.origin}${location.pathname}?watch=${m.id}`;
  if(navigator.share) navigator.share({title:`🔴 Watch live: ${m.team1.name} vs ${m.team2.name}`,url});
  else navigator.clipboard.writeText(url).then(()=>showToast('Live link copied!'));
}

// ─── DELETE ──────────────────────────────────────────────────
function deleteCurrentMatch() { if(!S.match) return; pendingDelete=S.match.id; $('delete-modal').classList.add('open'); }

async function confirmDelete() {
  closeModal(); if(!pendingDelete) return;
  S.history=S.history.filter(m=>m.id!==pendingDelete);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  try { await fbDelete(pendingDelete); } catch(e){ console.warn('Offline delete'); }
  pendingDelete=null; S.match=null;
  showToast('Match deleted'); renderDashboard(); nav('home');
}

// ══════════════════════════════════════════════════════════════
//   PLAYER CAREER STATS
// ══════════════════════════════════════════════════════════════
function computePlayerStats() {
  const bat={}, bowl={};
  S.history.filter(m=>m.sport==='cricket').forEach(m=>{
    [{inn:m.inning1,team:m.team1,bwt:m.team2},{inn:m.inning2,team:m.team2,bwt:m.team1}].forEach(({inn,team,bwt})=>{
      if(!inn) return;
      (inn.batters||[]).forEach(b=>{
        const n=team.players[b.idx]; if(!n) return;
        const s=bat[n]=bat[n]||{name:n,matches:new Set(),runs:0,balls:0,fours:0,sixes:0,hs:0,outs:0};
        s.matches.add(m.id); s.runs+=b.runs; s.balls+=b.balls; s.fours+=b.fours; s.sixes+=b.sixes;
        if(b.runs>s.hs) s.hs=b.runs;
        if(b.out) s.outs++;
      });
      (inn.bowlers||[]).forEach(b=>{
        const n=bwt.players[b.idx]; if(!n) return;
        const s=bowl[n]=bowl[n]||{name:n,matches:new Set(),wickets:0,runs:0,balls:0};
        s.matches.add(m.id); s.wickets+=b.wickets; s.runs+=b.runs; s.balls+=b.balls;
      });
    });
  });
  const batters=Object.values(bat).map(s=>({
    ...s, matches:s.matches.size,
    avg: s.outs?(s.runs/s.outs).toFixed(1):'—',
    sr: sr(s.runs,s.balls)
  })).sort((a,b)=>b.runs-a.runs);
  const bowlers=Object.values(bowl).map(s=>({
    ...s, matches:s.matches.size,
    overs: oversStr(s.balls),
    econ: s.balls?((s.runs/s.balls)*6).toFixed(1):'—'
  })).sort((a,b)=>b.wickets-a.wickets);
  return {batters,bowlers};
}

function gotoStats() { renderStatsPage(); nav('stats'); }

function renderStatsPage() {
  const {batters,bowlers}=computePlayerStats();
  $('stats-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">📊 Player Stats</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Career numbers across all cricket matches</div>

    <div class="sec-label">Top Run Scorers</div>
    <div class="stats-card" style="margin-bottom:16px">
      <div class="stats-head"><div class="sh-name">Player</div><div class="sh-stat">M</div><div class="sh-stat">R</div><div class="sh-stat">HS</div><div class="sh-stat">SR</div></div>
      ${batters.length?batters.map(p=>`
        <div class="stats-row">
          <div class="player-ava">${inits(p.name)}</div>
          <div style="flex:1"><div class="player-name">${p.name}</div><div class="player-sub">Avg ${p.avg} · ${p.fours}×4 ${p.sixes}×6</div></div>
          <div class="stat-val">${p.matches}</div><div class="stat-val gold">${p.runs}</div><div class="stat-val">${p.hs}</div><div class="stat-val">${p.sr}</div>
        </div>`).join(''):`<div style="padding:14px;font-size:12px;color:var(--text-3)">No data yet — play some matches!</div>`}
    </div>

    <div class="sec-label">Top Wicket Takers</div>
    <div class="stats-card">
      <div class="stats-head"><div class="sh-name">Player</div><div class="sh-stat">M</div><div class="sh-stat">W</div><div class="sh-stat">O</div><div class="sh-stat">Eco</div></div>
      ${bowlers.length?bowlers.map(p=>`
        <div class="stats-row">
          <div class="player-ava" style="background:rgba(109,40,217,0.1);color:var(--purple)">${inits(p.name)}</div>
          <div style="flex:1"><div class="player-name">${p.name}</div></div>
          <div class="stat-val">${p.matches}</div><div class="stat-val gold">${p.wickets}</div><div class="stat-val">${p.overs}</div><div class="stat-val">${p.econ}</div>
        </div>`).join(''):`<div style="padding:14px;font-size:12px;color:var(--text-3)">No data yet</div>`}
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//   TOURNAMENT MODE + POINTS TABLE
// ══════════════════════════════════════════════════════════════
function gotoTournaments() { renderTournamentsPage(); nav('tournaments'); }

function renderTournamentsPage() {
  $('tournaments-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">🏆 Tournaments</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Group matches together, track the points table</div>
    <div style="display:flex;gap:6px;margin-bottom:16px">
      <input class="form-input" id="new-tourney-name" placeholder="e.g. ENJC Summer Cup 2026" style="flex:1"/>
      <button onclick="createTournament()"
        style="background:var(--gold-dim);border:1px solid var(--gold-line);color:var(--gold-hi);border-radius:8px;padding:0 16px;font-family:var(--font-display);font-size:13px;font-weight:700;white-space:nowrap">+ Add</button>
    </div>
    <div id="tourney-list"></div>`;
  renderTourneyList();
}

function renderTourneyList() {
  const cont=$('tourney-list'); if(!cont) return;
  if(!S.tournaments.length) {
    cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">No tournaments yet.<br>Create one above!</div></div>`;
    return;
  }
  cont.innerHTML=S.tournaments.slice().reverse().map(t=>{
    const matches=S.history.filter(m=>m.tournamentId===t.id);
    return `<div class="match-card" onclick="viewTournament(${t.id})">
      <div class="match-meta"><span class="match-format">🏆 ${matches.length} match${matches.length!==1?'es':''}</span></div>
      <div class="match-teams"><span class="mt-name" style="font-size:15px">${t.name}</span></div>
    </div>`;
  }).join('');
}

function createTournament() {
  const name=$('new-tourney-name').value.trim();
  if(!name) { showToast('Enter tournament name'); return; }
  S.tournaments.push({id:Date.now(),name,createdAt:Date.now()});
  saveTournaments();
  $('new-tourney-name').value='';
  renderTourneyList();
  showToast('Tournament created ✓');
}

function viewTournament(id) {
  const t=S.tournaments.find(x=>x.id===id); if(!t) return;
  const matches=S.history.filter(m=>m.tournamentId===id && m.sport==='cricket');

  const table={};
  const touch=name=>table[name]=table[name]||{name,p:0,w:0,l:0,t:0,pts:0};
  matches.forEach(m=>{
    if(m.status!=='done') return;
    touch(m.team1.name); touch(m.team2.name);
    table[m.team1.name].p++; table[m.team2.name].p++;
    if(m.winner===null) {
      table[m.team1.name].t++; table[m.team2.name].t++;
      table[m.team1.name].pts+=1; table[m.team2.name].pts+=1;
    } else if(m.winner===m.team1.name) {
      table[m.team1.name].w++; table[m.team2.name].l++; table[m.team1.name].pts+=2;
    } else {
      table[m.team2.name].w++; table[m.team1.name].l++; table[m.team2.name].pts+=2;
    }
  });
  const rows=Object.values(table).sort((a,b)=>b.pts-a.pts);

  $('tournaments-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <button onclick="renderTournamentsPage()" style="background:none;border:none;color:var(--gold-hi);font-size:22px;padding:0 4px;font-family:var(--font-display)">←</button>
      <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--gold-hi)">${t.name}</div>
    </div>
    <div class="sec-label">Points Table</div>
    <div class="stats-card" style="margin-bottom:16px">
      <div class="stats-head"><div class="sh-name">Team</div><div class="sh-stat">P</div><div class="sh-stat">W</div><div class="sh-stat">L</div><div class="sh-stat">Pts</div></div>
      ${rows.length?rows.map(r=>`
        <div class="stats-row">
          <div style="flex:1"><div class="player-name">${r.name}</div>${r.t?`<div class="player-sub">${r.t} tied</div>`:''}</div>
          <div class="stat-val">${r.p}</div><div class="stat-val">${r.w}</div><div class="stat-val">${r.l}</div><div class="stat-val gold">${r.pts}</div>
        </div>`).join(''):`<div style="padding:14px;font-size:12px;color:var(--text-3)">No completed matches yet</div>`}
    </div>
    <div class="sec-label">Matches (${matches.length})</div>
    <div id="tourney-match-list"></div>`;

  const cont=$('tourney-match-list');
  if(!matches.length) {
    cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🏏</div><div class="empty-text">No matches added yet.<br>Pick this tournament when starting a new match.</div></div>`;
    return;
  }
  cont.innerHTML=matches.slice().sort((a,b)=>b.id-a.id).map(m=>{
    const i1=m.inning1, i2=m.inning2;
    const s1=i1?`${i1.runs}/${i1.wickets}`:'—', s2=i2?`${i2.runs}/${i2.wickets}`:'—';
    return `<div class="match-card" onclick="window.resumeOrView(${m.id})">
      <div class="match-meta"><span class="match-format">🏏 ${m.format} Overs · ${fmtDate(m.id)}</span></div>
      <div class="match-teams">
        <span class="mt-name">${m.team1.name}</span>
        <span class="mt-score" style="font-size:13px;flex:1.5;text-align:center">${s1} vs ${s2}</span>
        <span class="mt-name" style="text-align:right">${m.team2.name}</span>
      </div>
      <div class="match-result">${m.winner!==undefined&&m.status==='done'?(m.winner?'🏆 '+m.winner+' won':'🤝 Match Tied'):'⚡ In Progress'}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//   SHAREABLE SCORECARD IMAGE
// ══════════════════════════════════════════════════════════════
function shareScorecardImage() {
  const m=S.match; if(!m) return;
  const W=720,H=900;
  const canvas=document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');

  ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#F9F5EC'; ctx.fillRect(0,0,W,140);
  ctx.strokeStyle='#C9961A'; ctx.lineWidth=4; ctx.strokeRect(10,10,W-20,H-20);
  ctx.textAlign='center';

  ctx.fillStyle='#A67010'; ctx.font='bold 32px Rajdhani, sans-serif';
  ctx.fillText('🦁 ENJC SPORTS CLUB', W/2, 58);
  ctx.fillStyle='#8B7040'; ctx.font='600 13px Inter, sans-serif';
  ctx.fillText('GAME ON FIRE 🔥', W/2, 80);
  ctx.fillStyle='#5C4A10'; ctx.font='13px Inter, sans-serif';
  ctx.fillText(`${m.venue?m.venue+' · ':''}${fmtDate(m.id)}`, W/2, 102);

  let y=190;
  if(m.sport==='cricket') {
    const i1=m.inning1, i2=m.inning2;
    ctx.fillStyle='#1A1200'; ctx.font='bold 26px Rajdhani, sans-serif';
    ctx.fillText(m.team1.name, W/2, y);
    ctx.fillStyle='#A67010'; ctx.font='bold 52px Rajdhani, sans-serif';
    ctx.fillText(i1?`${i1.runs}/${i1.wickets}`:'—', W/2, y+58);
    ctx.fillStyle='#8B7040'; ctx.font='13px Inter, sans-serif';
    ctx.fillText(i1?`(${oversStr(i1.balls)} overs)`:'', W/2, y+80);

    ctx.fillStyle='#B8A070'; ctx.font='bold 18px Rajdhani, sans-serif';
    ctx.fillText('VS', W/2, y+115);

    y+=150;
    ctx.fillStyle='#1A1200'; ctx.font='bold 26px Rajdhani, sans-serif';
    ctx.fillText(m.team2.name, W/2, y);
    ctx.fillStyle='#A67010'; ctx.font='bold 52px Rajdhani, sans-serif';
    ctx.fillText(i2?`${i2.runs}/${i2.wickets}`:'—', W/2, y+58);
    ctx.fillStyle='#8B7040'; ctx.font='13px Inter, sans-serif';
    ctx.fillText(i2?`(${oversStr(i2.balls)} overs)`:'', W/2, y+80);
    y+=140;
  } else {
    ctx.fillStyle='#1A1200'; ctx.font='bold 24px Rajdhani, sans-serif';
    ctx.fillText(`${m.team1.name}  vs  ${m.team2.name}`, W/2, y);
    ctx.fillStyle='#A67010'; ctx.font='bold 58px Rajdhani, sans-serif';
    ctx.fillText(`${m.goals1||0}  –  ${m.goals2||0}`, W/2, y+70);
    y+=140;
  }

  ctx.fillStyle='#FFF8E8'; ctx.fillRect(60,y,W-120,50);
  ctx.strokeStyle='#C9961A'; ctx.lineWidth=1.5; ctx.strokeRect(60,y,W-120,50);
  ctx.fillStyle='#A67010'; ctx.font='bold 18px Rajdhani, sans-serif';
  ctx.fillText(m.result||'In Progress', W/2, y+32);
  y+=90;

  if(m.sport==='cricket') {
    const allB=[...(m.inning1?.batters||[]).map(b=>({...b,team:m.team1})),
                ...(m.inning2?.batters||[]).map(b=>({...b,team:m.team2}))];
    const mom=allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a,null);
    if(mom) {
      const n=mom.team.players[mom.idx]||'—';
      ctx.fillStyle='#C9961A'; ctx.font='600 12px Inter, sans-serif';
      ctx.fillText('⭐ MAN OF THE MATCH', W/2, y);
      ctx.fillStyle='#1A1200'; ctx.font='bold 22px Rajdhani, sans-serif';
      ctx.fillText(n, W/2, y+28);
      ctx.fillStyle='#5C4A10'; ctx.font='12px Inter, sans-serif';
      ctx.fillText(`${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}`, W/2, y+48);
    }
  }

  ctx.fillStyle='#B8A070'; ctx.font='11px Inter, sans-serif';
  ctx.fillText('Generated by ENJC Sports Club PWA', W/2, H-30);

  canvas.toBlob(blob=>{
    if(!blob) { showToast('Could not generate image'); return; }
    const file=new File([blob],`enjc-scorecard-${m.id}.png`,{type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})) {
      navigator.share({files:[file],title:'ENJC Sports Club',text:m.result||''}).catch(()=>{});
    } else {
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=`enjc-scorecard-${m.id}.png`; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      showToast('Image downloaded ✓');
    }
  },'image/png');
}

// ─── EXPOSE ──────────────────────────────────────────────────
Object.assign(window,{
  nav, gotoNewMatch, gotoMatchPlan, resumeOrView,
  addPlayerRow, reindexPlayers, addRosterRow, reindexRoster,
  selectToss, startMatch,
  addBall, selectModalItem, closeModal, recordWicket, undoLastBall,
  fbEvent, fbHalfTime, fbFullTime, fbUndo,
  shareMatch, shareLiveLink, exportPDF, exportRosterPDF, shareScorecardImage,
  deleteCurrentMatch, confirmDelete,
  gotoTeamsMgr, saveCurrentAsTeam, deleteSavedTeam,
  gotoStats,
  gotoTournaments, createTournament, viewTournament, renderTournamentsPage
});

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  pruneOld();
  checkDeepLink();
  nav('home');
  initSync();
  renderDashboard();

  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const p=item.dataset.page;
      if(p==='plan')     { gotoMatchPlan(); return; }
      if(p==='score')    { if(!S.match||S.match.sport!=='cricket'){showToast('Start a cricket match first!');return;} renderCricket(); }
      if(p==='football') { if(!S.match||S.match.sport!=='football'){showToast('Start a football match first!');return;} renderFootball(); }
      if(p==='home')     renderDashboard();
      if(p==='summary')  { if(S.match) renderSummary(); }
      nav(p);
    });
  });
});
