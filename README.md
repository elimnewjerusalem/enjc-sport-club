# 🔥 ENJC Sport Club — Game on Fire

Live cricket scorecard app for ENJC Sport Club. Mobile-first PWA.

## Features
- ✅ Full cricket scoring (runs, wickets, extras, overs)
- ✅ Live batter & bowler stats
- ✅ Last 6 balls display
- ✅ Target / RRR / CRR (2nd innings)
- ✅ Wicket dismissal types
- ✅ Match history (localStorage)
- ✅ Man of the Match
- ✅ Share scorecard
- ✅ Works offline (PWA)
- ✅ Installable on phone

## Deploy to GitHub Pages

1. Create new repo: `enjc-sport-club`
2. Push all files:
```bash
git init
git add .
git commit -m "🔥 ENJC Sport Club initial"
git remote add origin https://github.com/YOUR_USERNAME/enjc-sport-club.git
git push -u origin main
```
3. Go to repo Settings → Pages → Source: `main` branch → Save
4. Site live at: `https://YOUR_USERNAME.github.io/enjc-sport-club`

## File Structure
```
enjc-sport-club/
├── index.html        ← Full app (all pages)
├── css/
│   └── style.css     ← Design system
├── js/
│   └── app.js        ← Cricket engine + UI
├── manifest.json     ← PWA manifest
├── sw.js             ← Service worker (offline)
└── icons/            ← Add 192x192 and 512x512 icons
```

## Add Icons
Place your ENJC logo as:
- `icons/icon-192.png`
- `icons/icon-512.png`

## Coming Next
- [ ] Football scoring
- [ ] Volleyball scoring  
- [ ] Firebase realtime (friends watch live on their phone)
- [ ] Scorecard as image (share to WhatsApp)
- [ ] Player profiles & season stats
