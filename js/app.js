/* ═══════════════════════════════════════════════════════════════
   ENJC Sport Club v5 — Cricket + Football + PDF Export
   Bug fixes: custom overs, confirmDelete async, all phones sync
═══════════════════════════════════════════════════════════════ */

import {
  subscribeToMatchHistory, subscribeToMatch,
  saveMatch as fbSave, deleteMatch as fbDelete, batchDeleteMatches
} from './firebase.js';

// ─── STATE ────────────────────────────────────────────────────
const S = {
  match:   null,
  history: JSON.parse(localStorage.getItem('enjc_matches') || '[]'),
  sport:   'cricket'  // current new-match sport
};
let historyUnsub = null, matchUnsub = null, pendingDelete = null, isScorer = false;

// ─── UTILS ────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const oversStr = b => `${Math.floor(b/6)}.${b%6}`;
const sr  = (r,b) => b===0?'0.0':((r/b)*100).toFixed(1);
const crr = (r,b) => b===0?'0.0':((r/b)*6).toFixed(2);
const rrr = (t,r,bl)=>{ const n=t-r; return (n<=0||bl<=0)?'0.0':((n/bl)*6).toFixed(2); };
const blLeft = inn => inn.maxOvers*6 - inn.balls;
const target = i1 => i1 ? i1.runs+1 : null;
const inits  = n => n?n.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2):'?';
const activePage = () => { const p=document.querySelector('.page.active'); return p?p.id.replace('page-',''):''; };

function showToast(msg) {
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2200);
}

function fmtDate(ts) {
  const d=new Date(ts);
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function timeAgo(ts) {
  const d=Date.now()-ts, m=Math.floor(d/60000), h=Math.floor(d/3600000), dd=Math.floor(d/86400000);
  if(dd>0) return `${dd}d ago`; if(h>0) return `${h}h ago`; if(m>0) return `${m}m ago`; return 'Just now';
}

// ─── NAVIGATION ───────────────────────────────────────────────
function nav(pageId) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  $('page-'+pageId)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
  $('live-pill').style.display=(pageId==='score'||pageId==='football')&&S.match?.status==='live'?'flex':'none';
}

// ─── FIREBASE ─────────────────────────────────────────────────
function setMatch(match, scorer=true) {
  S.match=match; isScorer=scorer;
  if(matchUnsub) matchUnsub();
  if(!match) return;
  const banner=$('sync-banner'), sp=$('page-score');
  scorer?(banner.classList.add('hidden'),sp.classList.remove('viewer-mode'))
        :(banner.classList.remove('hidden'),sp.classList.add('viewer-mode'));
  matchUnsub = subscribeToMatch(match.id, remote=>{
    if(!remote) return;
    S.match=remote;
    const idx=S.history.findIndex(m=>m.id===remote.id);
    if(idx>=0) S.history[idx]=remote;
    const ap=activePage();
    if(ap==='score')    renderCricket();
    if(ap==='football') renderFootball();
    if(ap==='summary')  renderSummary();
  }, e=>console.error(e));
}

function initSync() {
  if(historyUnsub) historyUnsub();
  historyUnsub = subscribeToMatchHistory(matches=>{
    S.history=matches;
    localStorage.setItem('enjc_matches', JSON.stringify(matches));
    pruneOld();
    if(activePage()==='home') renderDashboard();
    if(S.match?.id){
      const open=matches.find(m=>m.id===S.match.id);
      if(open){ S.match=open; const ap=activePage(); if(ap==='score') renderCricket(); if(ap==='football') renderFootball(); if(ap==='summary') renderSummary(); }
    }
  }, ()=>{ console.warn('Firestore offline, using local'); renderDashboard(); });
}

// ─── DEEP LINK ────────────────────────────────────────────────
function checkDeepLink() {
  const watchId = new URLSearchParams(location.search).get('watch');
  if(!watchId) return;
  isScorer=false;
  subscribeToMatch(Number(watchId), remote=>{
    if(!remote){ showToast('Match not found'); return; }
    S.match=remote;
    if(remote.sport==='football'){ renderFootball(); nav('football'); }
    else { renderCricket(); nav('score'); }
    $('sync-banner').classList.remove('hidden');
    $('page-score').classList.add('viewer-mode');
    $('football-entry').style.display='none';
  }, e=>console.error(e));
}

// ─── PRUNE 1 YEAR ─────────────────────────────────────────────
async function pruneOld() {
  const cut=Date.now()-365*24*60*60*1000;
  const old=S.history.filter(m=>m.id<cut).map(m=>m.id);
  S.history=S.history.filter(m=>m.id>=cut);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  if(old.length) try{ await batchDeleteMatches(old); }catch(e){}
}

// ─── SAVE ─────────────────────────────────────────────────────
async function saveMatch() {
  const m=S.match; if(!m) return;
  const idx=S.history.findIndex(x=>x.id===m.id);
  idx>=0?S.history[idx]=m:S.history.push(m);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  try{ await fbSave(m); }catch(e){ console.warn('Offline, saved locally'); }
}

// ─── HOME DASHBOARD ───────────────────────────────────────────
function renderDashboard() {
  const cont=$('match-list');
  const list=S.history.slice().sort((a,b)=>b.id-a.id);
  if(!list.length){
    cont.innerHTML=`<div class="empty-state"><div class="empty-icon">🏅</div><div class="empty-text">No matches yet.<br>Tap Cricket or Football to start!</div></div>`;
    return;
  }
  cont.innerHTML=list.map(m=>{
    const icon=m.sport==='football'?'⚽':'🏏';
    let score='', res='';
    if(m.sport==='football'){
      score=`${m.goals1||0} – ${m.goals2||0}`;
      res=m.winner?`🏆 ${m.winner} won`:'⚡ In Progress';
    } else {
      const i1=m.inning1,i2=m.inning2;
      score=`${i1?i1.runs+'/'+i1.wickets:'—'} vs ${i2?i2.runs+'/'+i2.wickets:'—'}`;
      res=m.winner?`🏆 ${m.winner} won`:'⚡ In Progress';
    }
    return `<div class="match-card" onclick="window.resumeOrView(${m.id})">
      <div class="match-meta">
        <span class="match-format">${icon} ${m.sport==='football'?'Football':m.format+' Overs · Cricket'}</span>
        <span style="font-size:10px;color:var(--text-3)">${timeAgo(m.id)}</span>
      </div>
      <div class="match-teams">
        <span class="mt-name">${m.team1.name}</span>
        <span class="mt-score" style="font-size:14px">${score}</span>
        <span class="mt-name" style="text-align:right">${m.team2.name}</span>
      </div>
      <div class="match-result">${res}</div>
    </div>`;
  }).join('');
}

function resumeOrView(id) {
  const m=S.history.find(x=>x.id===id); if(!m) return;
  setMatch(m);
  if(m.status==='done'){ renderSummary(); nav('summary'); }
  else if(m.sport==='football'){ renderFootball(); nav('football'); }
  else { renderCricket(); nav('score'); }
}

// ══════════════════════════════════════════════════════════════
//  MATCH PLANNING — setup page rendered by JS
// ══════════════════════════════════════════════════════════════
function gotoNewMatch(sport) {
  S.sport=sport;
  renderSetupPage(sport);
  nav('new');
}

function renderSetupPage(sport) {
  const isCricket=sport==='cricket';
  $('setup-content').innerHTML=`
    <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--gold-hi);margin-bottom:4px">
      ${isCricket?'🏏 Cricket Match':'⚽ Football Match'}
    </div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:18px">Match planning — add players before starting</div>

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
      <label class="form-label">Venue / Match Name <span style="color:var(--text-4)">(optional)</span></label>
      <input class="form-input" id="match-venue" placeholder="e.g. ENJC Ground, Tondiarpet"/>
    </div>

    <div style="background:var(--bg-2);border:0.5px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:14px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--gold);margin-bottom:10px">Team 1</div>
      <div class="form-group" style="margin-bottom:10px">
        <input class="form-input" id="team1-name" placeholder="Team 1 name e.g. ENJC Lions"/>
      </div>
      <div class="form-label" style="margin-bottom:6px">Players</div>
      <div id="team1-players"></div>
      <button onclick="addPlayerRow('team1')" style="margin-top:8px;background:var(--gold-dim);border:0.5px solid var(--gold-line);color:var(--gold);border-radius:6px;padding:7px 14px;font-family:var(--font-display);font-size:13px;font-weight:600">+ Add Player</button>
    </div>

    <div style="background:var(--bg-2);border:0.5px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:14px">
      <div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--gold);margin-bottom:10px">Team 2</div>
      <div class="form-group" style="margin-bottom:10px">
        <input class="form-input" id="team2-name" placeholder="Team 2 name e.g. Chennai Kings"/>
      </div>
      <div class="form-label" style="margin-bottom:6px">Players</div>
      <div id="team2-players"></div>
      <button onclick="addPlayerRow('team2')" style="margin-top:8px;background:var(--gold-dim);border:0.5px solid var(--gold-line);color:var(--gold);border-radius:6px;padding:7px 14px;font-family:var(--font-display);font-size:13px;font-weight:600">+ Add Player</button>
    </div>

    <button class="start-btn" onclick="startMatch()">START MATCH 🔥</button>
  `;

  // seed 11 rows for cricket, 11 for football
  const count=isCricket?11:11;
  for(let i=0;i<count;i++){ addPlayerRow('team1'); addPlayerRow('team2'); }

  // wire overs buttons after render
  if(isCricket){
    setupData={overs:'5'};
    document.querySelectorAll('.overs-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        setupData.overs=btn.dataset.overs;
        document.querySelectorAll('.overs-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        const cg=$('custom-overs-group');
        if(cg) cg.classList.toggle('hidden', btn.dataset.overs!=='custom');
      });
    });
  }
}

let setupData={overs:'5'};

function addPlayerRow(team) {
  const cont=$(team+'-players');
  const idx=cont.children.length+1;
  const row=document.createElement('div');
  row.className='player-input-row';
  row.innerHTML=`
    <span class="player-num">${idx}</span>
    <input class="form-input player-input" data-team="${team}"
      placeholder="${S.sport==='football'?'Player '+idx+' (optional)':'Player '+idx}"
      style="padding:9px 11px;font-size:13px;flex:1"/>
    <button onclick="this.parentElement.remove();reindexPlayers('${team}')"
      style="background:none;border:none;color:var(--text-3);font-size:16px;padding:0 6px;line-height:1">✕</button>
  `;
  cont.appendChild(row);
}

function reindexPlayers(team) {
  document.querySelectorAll(`.player-input[data-team="${team}"]`)
    .forEach((inp,i)=>inp.closest('.player-input-row').querySelector('.player-num').textContent=i+1);
}

// ─── START MATCH ──────────────────────────────────────────────
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
    venue, status:'live',
    createdAt:Date.now()
  };

  if(sport==='cricket'){
    // BUG FIX: custom overs — read value here, not inside defaultInning
    let overs=setupData.overs;
    if(overs==='custom'){
      const v=parseInt($('custom-overs-input')?.value||'');
      if(!v||v<1||v>100){ showToast('Enter valid overs (1–100)'); return; }
      overs=String(v);
    }
    match.format=overs;
    match.innings=1;
    match.inning1=mkInning('team1','team2',overs);
    match.inning2=null;
    match.current=match.inning1;
    setMatch(match);
    openBatterSelect('strike',()=>openBatterSelect('non-strike',()=>openBowlerSelect(()=>{
      saveMatch(); renderCricket(); nav('score');
    })));
  } else {
    // football
    match.goals1=0; match.goals2=0;
    match.half=1; match.minute=0;
    match.events=[];
    setMatch(match);
    saveMatch(); renderFootball(); nav('football');
  }
}

// ─── CRICKET DEFAULTS ─────────────────────────────────────────
function mkInning(bt,bwt,ov){
  return {
    battingTeam:bt, bowlingTeam:bwt, maxOvers:parseInt(ov),
    runs:0, wickets:0, balls:0,
    extras:{wide:0,noBall:0,bye:0},
    batters:[], bowlers:[], lastSix:[], allBalls:[],
    onStrike:null, nonStrike:null, currentBowler:null, overBalls:0
  };
}

// ─── CRICKET MODALS ───────────────────────────────────────────
function openBatterSelect(type,cb){
  const inn=S.match.current, team=S.match[inn.battingTeam];
  const used=inn.batters.filter(b=>!b.out).map(b=>b.idx);
  const avail=team.players.map((name,idx)=>({name,idx})).filter(p=>!used.includes(p.idx));
  if(!avail.length){ if(cb)cb(); return; }
  openSelectModal(type==='strike'?'Choose Batter (Strike)':'Choose Batter (Non-Strike)',
    avail.map(p=>p.name), name=>{
      const p=avail.find(x=>x.name===name); if(!p) return;
      type==='strike'?inn.onStrike=p.idx:inn.nonStrike=p.idx;
      if(!inn.batters.find(b=>b.idx===p.idx))
        inn.batters.push({idx:p.idx,runs:0,balls:0,fours:0,sixes:0,out:false,dismissal:''});
      if(cb)cb();
    });
}

function openBowlerSelect(cb){
  const inn=S.match.current, team=S.match[inn.bowlingTeam];
  openSelectModal('Choose Bowler', team.players, name=>{
    const idx=team.players.indexOf(name);
    if(!inn.bowlers.find(b=>b.idx===idx))
      inn.bowlers.push({idx,overs:0,balls:0,runs:0,wickets:0,wides:0,noBalls:0});
    inn.currentBowler=idx;
    if(cb)cb();
  });
}

function openSelectModal(title, options, onSelect){
  const modal=$('select-modal');
  $('modal-title').textContent=title;
  $('modal-list').innerHTML=options.map(name=>
    `<div class="modal-item" onclick="window.selectModalItem('${name.replace(/'/g,"\\'")}')">
      <div class="player-ava" style="width:28px;height:28px;font-size:9px">${inits(name)}</div>${name}
    </div>`).join('');
  modal.classList.add('open'); modal._cb=onSelect;
}

function selectModalItem(name){
  const m=$('select-modal'); m.classList.remove('open'); m._cb?.(name);
}

function closeModal(){
  ['select-modal','wicket-modal','delete-modal'].forEach(id=>$(id).classList.remove('open'));
}

// ─── CRICKET SCORING ──────────────────────────────────────────
function addBall(type,runs){
  const match=S.match; if(!match||match.status!=='live') return;
  const inn=match.current; if(!inn) return;

  const isWide=type==='wide', isNoBall=type==='noball';
  const isWicket=type==='wicket', isBye=type==='bye';
  const isLegal=!isWide&&!isNoBall;

  const bowler=inn.bowlers.find(b=>b.idx===inn.currentBowler);
  const striker=inn.batters.find(b=>b.idx===inn.onStrike);

  if(isWide)      { inn.runs+=runs+1; inn.extras.wide++; if(bowler){bowler.wides++;bowler.runs+=runs+1;} }
  else if(isNoBall){ inn.runs+=runs+1; inn.extras.noBall++; if(bowler){bowler.noBalls++;bowler.runs+=runs+1;} }
  else {
    inn.runs+=runs;
    if(!isWicket&&!isBye&&striker){
      striker.runs+=runs;
      if(runs===4)striker.fours++;
      if(runs===6)striker.sixes++;
    }
    if(isBye) inn.extras.bye=(inn.extras.bye||0)+runs;
    if(bowler) bowler.runs+=runs;
  }

  if(isLegal){
    inn.balls++; inn.overBalls++;
    if(striker&&!isWicket) striker.balls++;
    if(bowler) bowler.balls++;
  }

  inn.allBalls.push({type,runs});
  inn.lastSix=inn.allBalls.slice(-6);

  if(isWicket){ openWicketModal(); return; }

  if(isLegal&&runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];

  if(isLegal&&inn.overBalls===6){
    inn.overBalls=0; if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    checkInningsEnd();
    if(match.status==='live'){ openBowlerSelect(()=>{saveMatch();renderCricket();}); return; }
  }

  checkInningsEnd(); saveMatch(); renderCricket();
}

function openWicketModal(){
  $('dismissal-list').innerHTML=
    ['Bowled','Caught','LBW','Run Out','Stumped','Hit Wicket','Retired']
    .map(d=>`<div class="modal-item" onclick="window.recordWicket('${d}')">${d}</div>`).join('');
  $('wicket-modal').classList.add('open');
}

function recordWicket(dismissal){
  closeModal();
  const inn=S.match.current;
  const striker=inn.batters.find(b=>b.idx===inn.onStrike);
  if(striker){striker.out=true;striker.dismissal=dismissal;}
  inn.wickets++;
  const bowler=inn.bowlers.find(b=>b.idx===inn.currentBowler);
  if(bowler&&dismissal!=='Run Out') bowler.wickets++;

  const total=S.match[inn.battingTeam].players.length;
  if(inn.wickets>=Math.min(total-1,10)){ checkInningsEnd(true); return; }

  if(inn.overBalls===6){
    inn.overBalls=0; if(bowler) bowler.overs++;
    [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
    openBatterSelect('strike',()=>openBowlerSelect(()=>{saveMatch();renderCricket();}));
  } else {
    openBatterSelect('strike',()=>{saveMatch();renderCricket();});
  }
}

function checkInningsEnd(allOut=false){
  const match=S.match, inn=match.current;
  const isOver=allOut||inn.balls>=inn.maxOvers*6;
  const tgt=target(match.inning1);
  const chased=tgt!==null&&inn.runs>=tgt;
  if(!isOver&&!chased) return;

  if(match.innings===1){
    match.inning1={...inn};
    match.inning2=mkInning('team2','team1',inn.maxOvers);
    match.current=match.inning2; match.innings=2;
    showToast(`Innings over! Target: ${inn.runs+1}`);
    setTimeout(()=>openBatterSelect('strike',()=>openBatterSelect('non-strike',()=>
      openBowlerSelect(()=>{saveMatch();renderCricket();}))),600);
  } else {
    match.inning2={...inn};
    const i1=match.inning1, i2=match.inning2;
    if(chased){
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name; match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else if(i1.runs>i2.runs){
      match.winner=match.team1.name; match.result=`${match.team1.name} won by ${i1.runs-i2.runs} runs`;
    } else if(i2.runs>i1.runs){
      const wl=match.team2.players.length-1-i2.wickets;
      match.winner=match.team2.name; match.result=`${match.team2.name} won by ${wl} wicket${wl!==1?'s':''}`;
    } else {
      match.winner=null; match.result='Match Tied! 🤝';
    }
    match.status='done'; saveMatch(); renderSummary(); nav('summary');
  }
}

function undoLastBall(){
  const inn=S.match?.current;
  if(!inn||!inn.allBalls.length){ showToast('Nothing to undo'); return; }
  const last=inn.allBalls[inn.allBalls.length-1];
  const isWide=last.type==='wide', isNoBall=last.type==='noball';
  const isLegal=!isWide&&!isNoBall, isWicket=last.type==='wicket', isBye=last.type==='bye';

  if(isWide||isNoBall){
    inn.runs-=(last.runs+1);
    if(isWide) inn.extras.wide=Math.max(0,inn.extras.wide-1);
    if(isNoBall) inn.extras.noBall=Math.max(0,inn.extras.noBall-1);
  } else {
    inn.runs-=last.runs;
    if(isBye) inn.extras.bye=Math.max(0,(inn.extras.bye||0)-last.runs);
    else if(!isWicket){
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
    const lb=inn.batters.slice().reverse().find(b=>b.out);
    if(lb){lb.out=false;lb.dismissal='';}
  }
  if(isLegal&&last.runs%2!==0) [inn.onStrike,inn.nonStrike]=[inn.nonStrike,inn.onStrike];
  inn.allBalls.pop(); inn.lastSix=inn.allBalls.slice(-6);
  showToast('↩ Undone'); saveMatch(); renderCricket();
}

// ─── CRICKET RENDER ───────────────────────────────────────────
function renderCricket(){
  const match=S.match; if(!match) return;
  const inn=match.current, bt=match[inn.battingTeam], bwt=match[inn.bowlingTeam];
  const tgt=target(match.inning1), innings=match.innings;

  $('sc-header-txt').textContent=`${bt.name} batting · ${innings===1?'1st':'2nd'} innings`;
  $('sc-target-badge').textContent=tgt?`🎯 Target ${tgt}`:'';
  $('sc-team1-name').textContent=match.team1.name;
  $('sc-team2-name').textContent=match.team2.name;

  const i1=match.inning1,i2=match.inning2;
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
    const need=Math.max(0,tgt-inn.runs),bl=blLeft(inn);
    $('need-runs').textContent=`${need} runs`;
    $('need-rr').textContent=`🔥 RRR: ${rrr(tgt,inn.runs,bl)} · ${bl} balls left`;
    $('crr-val').textContent=crr(inn.runs,inn.balls);
  } else tb.classList.add('hidden');

  $('batter-rows').innerHTML=inn.batters.map(b=>{
    const name=bt.players[b.idx],isSt=b.idx===inn.onStrike,isNon=b.idx===inn.nonStrike;
    const role=b.out?`<span class="player-sub out">${b.dismissal||'Out'}</span>`:isSt?`<span class="player-sub strike">On strike ★</span>`:isNon?`<span class="player-sub">Non-striker</span>`:'';
    const av=b.out?'background:rgba(220,38,38,0.12);color:var(--red)':isSt?'':'background:rgba(37,99,235,0.1);color:var(--blue)';
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
    const name=bwt.players[b.idx],isCur=b.idx===inn.currentBowler;
    const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1);
    return `<div class="stats-row ${isCur?'on-strike':''}">
      <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${inits(name)}</div>
      <div style="flex:1"><div class="player-name">${name}${isCur?' ⚡':''}</div></div>
      <div class="stat-val">${b.overs}.${b.balls%6}</div>
      <div class="stat-val">${b.runs}</div>
      <div class="stat-val">${b.wickets}</div>
      <div class="stat-val ${isCur?'gold':''}">${eco}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  FOOTBALL ENGINE
// ══════════════════════════════════════════════════════════════
function fbEvent(type, team){
  const m=S.match; if(!m||m.status!=='live') return;
  const minute=m.minute||0;
  const playerList=team===1?m.team1.players:m.team2.players;

  openSelectModal(`${type==='goal'?'⚽ Who scored?':type==='yellow'?'🟨 Yellow card?':'🟥 Red card?'} (${team===1?m.team1.name:m.team2.name})`,
    playerList, name=>{
      m.events=m.events||[];
      m.events.push({type,team,player:name,minute});
      if(type==='goal') team===1?m.goals1++:m.goals2++;
      saveMatch(); renderFootball();
    });
}

function fbHalfTime(){
  const m=S.match; if(!m) return;
  m.half=2; m.minute=45;
  showToast('Half Time! 45 mins');
  $('fb-half-badge').textContent='2nd Half';
  saveMatch(); renderFootball();
}

function fbFullTime(){
  const m=S.match; if(!m) return;
  m.status='done'; m.minute=90;
  const g1=m.goals1||0, g2=m.goals2||0;
  if(g1>g2){ m.winner=m.team1.name; m.result=`${m.team1.name} won ${g1}–${g2}`; }
  else if(g2>g1){ m.winner=m.team2.name; m.result=`${m.team2.name} won ${g2}–${g1}`; }
  else { m.winner=null; m.result=`Draw ${g1}–${g2}`; }
  saveMatch(); renderSummary(); nav('summary');
}

function fbUndo(){
  const m=S.match; if(!m||!m.events?.length){ showToast('Nothing to undo'); return; }
  const last=m.events.pop();
  if(last.type==='goal') last.team===1?m.goals1--:m.goals2--;
  showToast('↩ Undone'); saveMatch(); renderFootball();
}

function renderFootball(){
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
  $('fb-events').innerHTML=events.length?events.slice().reverse().map(e=>{
    const icon=e.type==='goal'?'⚽':e.type==='yellow'?'🟨':'🟥';
    const tname=e.team===1?m.team1.name:m.team2.name;
    return `<div class="stats-row" style="padding:6px 0">
      <div style="width:30px;text-align:center;font-size:16px">${icon}</div>
      <div style="flex:1"><div class="player-name">${e.player}</div><div class="player-sub">${tname}</div></div>
      <div style="font-size:11px;color:var(--text-3)">${e.minute}'</div>
    </div>`;
  }).join(''):'<div style="color:var(--text-3);font-size:12px">No events yet</div>';
}

// ══════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════
function renderSummary(){
  const match=S.match; if(!match) return;
  $('winner-name').textContent=match.winner||'Tied! 🤝';
  $('winner-sub').textContent=match.result||'';

  if(match.sport==='football'){
    $('mom-card').style.display='none';
    $('summary-scorecards').innerHTML=`
      <div class="section">
        <div class="sec-label">Match Events</div>
        <div class="stats-card" style="padding:8px 10px">
          ${(match.events||[]).map(e=>`
            <div class="stats-row" style="padding:6px 0">
              <div style="width:30px;text-align:center;font-size:16px">${e.type==='goal'?'⚽':e.type==='yellow'?'🟨':'🟥'}</div>
              <div style="flex:1"><div class="player-name">${e.player}</div><div class="player-sub">${e.team===1?match.team1.name:match.team2.name}</div></div>
              <div style="font-size:11px;color:var(--text-3)">${e.minute}'</div>
            </div>`).join('')||'<div style="color:var(--text-3);font-size:12px;padding:4px 0">No events recorded</div>'}
        </div>
      </div>
      <div class="section">
        <div class="sec-label">Squads</div>
        <div class="stats-card">
          ${[match.team1,match.team2].map(t=>`
            <div class="stats-row" style="flex-wrap:wrap;gap:4px;padding:8px 10px">
              <div style="width:100%;font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--gold);margin-bottom:4px">${t.name}</div>
              ${t.players.map(p=>`<span style="font-size:11px;color:var(--text-2);background:var(--bg-3);border-radius:4px;padding:2px 7px">${p}</span>`).join('')}
            </div>`).join('<div class="divider"></div>')}
        </div>
      </div>`;
    return;
  }

  // cricket summary
  $('mom-card').style.display='flex';
  const i1=match.inning1, i2=match.inning2;
  const allB=[...(i1?.batters||[]).map(b=>({...b,team:match.team1})),
              ...(i2?.batters||[]).map(b=>({...b,team:match.team2}))];
  const mom=allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a,null);
  if(mom){
    const n=mom.team.players[mom.idx]||'—';
    $('mom-name').textContent=n;
    $('mom-stat').textContent=`${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}`;
    $('mom-ava').textContent=inits(n);
  }

  $('summary-scorecards').innerHTML=[
    {inn:i1,team:match.team1,bwt:match.team2},
    {inn:i2,team:match.team2,bwt:match.team1}
  ].filter(x=>x.inn).map(({inn,team,bwt})=>`
    <div class="section">
      <div class="sec-label">${team.name} — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} ov)</div>
      <div class="stats-card">
        <div class="stats-head"><div class="sh-name">Batter</div><div class="sh-stat">R</div><div class="sh-stat">B</div><div class="sh-stat">4s</div><div class="sh-stat">SR</div></div>
        ${inn.batters.map(b=>{const n=team.players[b.idx];return `<div class="stats-row ${b.out?'out':''}">
          <div class="player-ava" style="${b.out?'background:rgba(220,38,38,0.08);color:var(--red)':''}">${inits(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div><div class="player-sub ${b.out?'out':''}">${b.out?b.dismissal:'not out'}</div></div>
          <div class="stat-val gold">${b.runs}</div><div class="stat-val">${b.balls}</div><div class="stat-val">${b.fours}</div><div class="stat-val">${sr(b.runs,b.balls)}</div>
        </div>`;}).join('')}
        <div style="padding:6px 10px;font-size:10px;color:var(--text-3)">Extras: ${(inn.extras.wide||0)+(inn.extras.noBall||0)+(inn.extras.bye||0)} (Wd ${inn.extras.wide||0}, Nb ${inn.extras.noBall||0}, B ${inn.extras.bye||0})</div>
      </div>
      <div style="height:8px"></div>
      <div class="stats-card">
        <div class="stats-head"><div class="sh-name">Bowler</div><div class="sh-stat">O</div><div class="sh-stat">R</div><div class="sh-stat">W</div><div class="sh-stat">Eco</div></div>
        ${inn.bowlers.map(b=>{const n=bwt.players[b.idx];const eco=b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1);return `<div class="stats-row">
          <div class="player-ava" style="background:rgba(124,58,237,0.1);color:var(--purple)">${inits(n)}</div>
          <div style="flex:1"><div class="player-name">${n}</div></div>
          <div class="stat-val">${b.overs}.${b.balls%6}</div><div class="stat-val">${b.runs}</div><div class="stat-val gold">${b.wickets}</div><div class="stat-val">${eco}</div>
        </div>`;}).join('')}
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  PDF EXPORT — browser print
// ══════════════════════════════════════════════════════════════
function exportPDF(){
  const m=S.match; if(!m) return;
  const pdfArea=$('pdf-area');
  const d=new Date(m.id);
  const dateStr=`${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;

  let content=`
    <div class="pdf-logo">🦁 ENJC Sports Club</div>
    <div class="pdf-title">${m.sport==='football'?'⚽ Football':'🏏 Cricket'} Match Summary</div>
    <div class="pdf-meta">${m.team1.name} vs ${m.team2.name} · ${dateStr}${m.venue?' · '+m.venue:''}</div>
    <div class="pdf-result">${m.result||'In Progress'}</div>`;

  if(m.sport==='cricket'){
    const i1=m.inning1, i2=m.inning2;
    [i1,i2].filter(Boolean).forEach((inn,idx)=>{
      const team=idx===0?m.team1:m.team2;
      const bwt=idx===0?m.team2:m.team1;
      content+=`
        <div class="pdf-innings-title">${team.name} Innings — ${inn.runs}/${inn.wickets} (${oversStr(inn.balls)} overs)</div>
        <table class="pdf-table">
          <tr><th>Batter</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          ${inn.batters.map(b=>`<tr>
            <td>${team.players[b.idx]}</td>
            <td style="font-size:10px">${b.out?b.dismissal:'not out'}</td>
            <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td>
            <td>${sr(b.runs,b.balls)}</td>
          </tr>`).join('')}
          <tr><td colspan="7" style="font-size:10px;color:#888;padding:4px 6px">
            Extras: ${(inn.extras.wide||0)+(inn.extras.noBall||0)+(inn.extras.bye||0)} (Wd ${inn.extras.wide||0}, Nb ${inn.extras.noBall||0}, B ${inn.extras.bye||0})
          </td></tr>
        </table>
        <table class="pdf-table" style="margin-top:8px">
          <tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Eco</th></tr>
          ${inn.bowlers.map(b=>`<tr>
            <td>${bwt.players[b.idx]}</td>
            <td>${b.overs}.${b.balls%6}</td><td>${b.runs}</td>
            <td><b>${b.wickets}</b></td>
            <td>${b.balls===0?'—':((b.runs/b.balls)*6).toFixed(1)}</td>
          </tr>`).join('')}
        </table>`;
    });
    // MoM
    const allB=[...(i1?.batters||[]).map(b=>({...b,team:m.team1})),
                ...(i2?.batters||[]).map(b=>({...b,team:m.team2}))];
    const mom=allB.reduce((a,b)=>b.runs>(a?.runs||-1)?b:a,null);
    if(mom){
      const n=mom.team.players[mom.idx];
      content+=`<div class="pdf-mom">⭐ Man of the Match: ${n} — ${mom.runs} runs (${mom.balls} balls) · SR ${sr(mom.runs,mom.balls)}</div>`;
    }
  } else {
    // football PDF
    content+=`<div class="pdf-innings-title">Final Score: ${m.team1.name} ${m.goals1||0} – ${m.goals2||0} ${m.team2.name}</div>`;
    if(m.events?.length){
      content+=`<table class="pdf-table"><tr><th>Event</th><th>Player</th><th>Team</th><th>Min</th></tr>
        ${m.events.map(e=>`<tr>
          <td>${e.type==='goal'?'⚽ Goal':e.type==='yellow'?'🟨 Yellow':'🟥 Red'}</td>
          <td>${e.player}</td><td>${e.team===1?m.team1.name:m.team2.name}</td><td>${e.minute}'</td>
        </tr>`).join('')}</table>`;
    }
    content+=`<div class="pdf-innings-title">Squads</div>
      <table class="pdf-table"><tr><th>${m.team1.name}</th><th>${m.team2.name}</th></tr>
      ${Array.from({length:Math.max(m.team1.players.length,m.team2.players.length)},(_,i)=>
        `<tr><td>${m.team1.players[i]||''}</td><td>${m.team2.players[i]||''}</td></tr>`).join('')}
      </table>`;
  }

  content+=`<div class="pdf-footer">Generated by ENJC Sports Club · Game on Fire 🔥 · ${dateStr}</div>`;
  pdfArea.innerHTML=content;
  pdfArea.classList.remove('hidden');
  setTimeout(()=>{ window.print(); pdfArea.classList.add('hidden'); },200);
}

// ─── SHARE ────────────────────────────────────────────────────
function shareMatch(){
  const m=S.match; if(!m) return;
  const base=location.origin+location.pathname;
  const watchUrl=m.status==='live'?`${base}?watch=${m.id}`:'';
  let text;
  if(m.sport==='football'){
    text=`🦁 ENJC Sports Club\n⚽ ${m.team1.name} vs ${m.team2.name}\n${m.team1.name} ${m.goals1||0} – ${m.goals2||0} ${m.team2.name}\n🏆 ${m.result||'In Progress'}${watchUrl?'\n📲 Watch live: '+watchUrl:''}\n#ENJCSportsClub #GameOnFire`;
  } else {
    const i1=m.inning1,i2=m.inning2;
    text=`🦁 ENJC Sports Club\n⚔ ${m.team1.name} vs ${m.team2.name}\n🏏 ${m.team1.name}: ${i1?i1.runs+'/'+i1.wickets:'—'} (${i1?oversStr(i1.balls):'0'} ov)\n🏏 ${m.team2.name}: ${i2?i2.runs+'/'+i2.wickets:'—'} (${i2?oversStr(i2.balls):'0'} ov)\n🏆 ${m.result||'In Progress'}${watchUrl?'\n📲 Watch live: '+watchUrl:''}\n#ENJCSportsClub #GameOnFire`;
  }
  if(navigator.share) navigator.share({title:'ENJC Sports Club',text,url:watchUrl||base});
  else navigator.clipboard.writeText(text).then(()=>showToast('Copied!'));
}

function shareLiveLink(){
  const m=S.match; if(!m||m.status!=='live'){ showToast('No live match'); return; }
  const url=`${location.origin}${location.pathname}?watch=${m.id}`;
  if(navigator.share) navigator.share({title:`Watch live 🔴 ${m.team1.name} vs ${m.team2.name}`,url});
  else navigator.clipboard.writeText(url).then(()=>showToast('Live link copied!'));
}

// ─── DELETE ───────────────────────────────────────────────────
function deleteCurrentMatch(){ if(!S.match) return; pendingDelete=S.match.id; $('delete-modal').classList.add('open'); }

async function confirmDelete(){
  closeModal(); if(!pendingDelete) return;
  S.history=S.history.filter(m=>m.id!==pendingDelete);
  localStorage.setItem('enjc_matches',JSON.stringify(S.history));
  try{ await fbDelete(pendingDelete); }catch(e){ console.warn('Firestore delete offline'); }
  pendingDelete=null; S.match=null;
  showToast('Match deleted'); renderDashboard(); nav('home');
}

// ─── EXPOSE ───────────────────────────────────────────────────
Object.assign(window,{
  nav, gotoNewMatch, resumeOrView,
  addPlayerRow, reindexPlayers, startMatch,
  addBall, selectModalItem, closeModal, recordWicket, undoLastBall,
  fbEvent, fbHalfTime, fbFullTime, fbUndo,
  shareMatch, shareLiveLink, exportPDF,
  deleteCurrentMatch, confirmDelete
});

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  pruneOld();
  checkDeepLink();
  nav('home');
  initSync();
  renderDashboard();

  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const p=item.dataset.page;
      if(p==='score'){ if(!S.match||S.match.sport!=='cricket'){showToast('Start a cricket match first!');return;} renderCricket(); }
      if(p==='football'){ if(!S.match||S.match.sport!=='football'){showToast('Start a football match first!');return;} renderFootball(); }
      if(p==='home') renderDashboard();
      if(p==='summary'){ if(S.match) renderSummary(); }
      nav(p);
    });
  });
});