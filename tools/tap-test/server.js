// tools/tap-test/server.js — THROWAWAY field tool for OQ4 (tap-rate test). Not product code.
// Run: node server.js   → phone opens http://<this-machine-ip>:8090   → summary at /summary
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8090);
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const HEADER = 'iso_timestamp,station,action,device_id,seq,ref_seq,received_at\n';
const STATIONS = ['Tandoor', 'Paye', 'Chanay'];
const ACTIONS = ['START', 'DONE', 'UNDO'];

const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function readRows() {
  return fs.readdirSync(DATA).filter((f) => /^taps-.*\.csv$/.test(f)).sort()
    .flatMap((f) => fs.readFileSync(path.join(DATA, f), 'utf8').trim().split('\n').slice(1))
    .filter(Boolean)
    .map((l) => {
      const [ts, station, action, device, seq, ref] = l.split(',');
      return { ts, station, action, device, seq: Number(seq), ref: ref ? Number(ref) : null };
    });
}

const seen = new Set(readRows().map((r) => `${r.device}:${r.seq}`)); // dedupe retried uploads

function save(taps) {
  const now = new Date().toISOString();
  let added = 0;
  for (const t of Array.isArray(taps) ? taps : []) {
    const d = new Date(t.ts);
    const device = String(t.device || '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
    const key = `${device}:${t.seq}`;
    if (isNaN(d) || !device || !Number.isInteger(t.seq) || seen.has(key)) continue;
    if (!STATIONS.includes(t.station) || !ACTIONS.includes(t.action)) continue;
    const file = path.join(DATA, `taps-${day(d)}.csv`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER);
    const ref = Number.isInteger(t.ref) ? t.ref : '';
    fs.appendFileSync(file, [d.toISOString(), t.station, t.action, device, t.seq, ref, now].join(',') + '\n');
    seen.add(key);
    added++;
  }
  return added;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : '-');

function summary() {
  const rows = readRows();
  const undone = new Set(rows.filter((r) => r.action === 'UNDO').map((r) => `${r.device}:${r.ref}`));
  const taps = rows.filter((r) => r.action !== 'UNDO' && !undone.has(`${r.device}:${r.seq}`));
  const groups = {};
  for (const r of taps) (groups[`${day(new Date(r.ts))}|${r.station}`] ??= []).push(r);

  const out = Object.keys(groups).sort().map((k) => {
    const [date, station] = k.split('|');
    const list = groups[k].sort((a, b) => a.ts.localeCompare(b.ts));
    const open = []; const gaps = []; const perMin = {};
    let doneNoStart = 0;
    for (const r of list) {
      perMin[r.ts.slice(0, 16)] = (perMin[r.ts.slice(0, 16)] || 0) + 1;
      if (r.action === 'START') open.push(new Date(r.ts));
      else if (open.length) gaps.push((new Date(r.ts) - open.shift()) / 1000); // FIFO pairing
      else doneNoStart++;
    }
    gaps.sort((a, b) => a - b);
    const fmt = (s) => (s === '-' ? '-' : `${Math.round(s / 60 * 10) / 10} min`);
    return {
      date, station,
      starts: list.filter((r) => r.action === 'START').length,
      dones: list.filter((r) => r.action === 'DONE').length,
      unmatched_starts: open.length, done_without_start: doneNoStart,
      median_gap: fmt(pct(gaps, 0.5)), p90_gap: fmt(pct(gaps, 0.9)),
      peak_taps_per_min: Math.max(0, ...Object.values(perMin)),
      undos: rows.filter((r) => r.action === 'UNDO' && day(new Date(r.ts)) === date && r.station === station).length,
    };
  });

  const cols = ['date', 'station', 'starts', 'dones', 'unmatched_starts', 'done_without_start', 'median_gap', 'p90_gap', 'peak_taps_per_min', 'undos'];
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tap Summary</title><style>body{font-family:system-ui;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;font-size:14px}</style>
<h2>Tap test summary</h2><p>Undone taps excluded. START→DONE paired first-in-first-out per station per day.</p>
<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>
${out.map((r) => `<tr>${cols.map((c) => `<td>${r[c]}</td>`).join('')}</tr>`).join('\n')}</table>`;
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Tap Test</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;flex-direction:column;height:100vh}
select{font-size:26px;padding:8px;margin:8px}
.b{flex:1;margin:8px;border:0;border-radius:16px;font-size:44px;font-weight:bold;color:#fff;line-height:1.3}
.b:active{opacity:.5}#s{background:#1a8f3a}#d{background:#c0392b}
#u{font-size:20px;padding:10px;margin:0 8px;background:#555;color:#fff;border:0;border-radius:10px}
#log{font-size:17px;padding:6px 12px;min-height:6.5em}#q{font-size:14px;padding:0 12px 8px}
</style></head><body>
<select id="st"><option value="Tandoor">تندور / Tandoor</option><option value="Paye">پائے / Paye</option><option value="Chanay">چنے / Chanay</option></select>
<button class="b" id="s">شروع<br>START</button>
<button class="b" id="d">مکمل<br>DONE</button>
<button id="u">واپس / UNDO last</button>
<div id="log"></div><div id="q"></div>
<script>
function get(k,d){try{var v=localStorage.getItem(k);return v===null?d:JSON.parse(v);}catch(e){return d;}}
function put(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
var dev=get('dev',null);if(!dev){dev=Math.random().toString(36).slice(2,10);put('dev',dev);}
var queue=get('queue',[]),recent=get('recent',[]),busy=false;
var st=document.getElementById('st');st.value=get('station','Tandoor');
st.onchange=function(){put('station',st.value);};
function tap(action,ref){
  var seq=get('seq',0)+1;put('seq',seq);
  var t={ts:new Date().toISOString(),station:st.value,action:action,device:dev,seq:seq,ref:ref};
  queue.push(t);put('queue',queue);
  if(action==='UNDO')recent.shift();else{recent.unshift(t);recent=recent.slice(0,5);}
  put('recent',recent);if(navigator.vibrate)navigator.vibrate(action==='UNDO'?[40,40,40]:70);
  render();flush();
}
function render(){
  document.getElementById('log').innerHTML=recent.map(function(t){
    return new Date(t.ts).toLocaleTimeString()+' &nbsp; '+t.station+' &nbsp; <b>'+t.action+'</b>';}).join('<br>');
  var q=document.getElementById('q');
  q.textContent=queue.length?('Not uploaded yet: '+queue.length+' (will retry)'):'All uploaded ✓';
  q.style.color=queue.length?'#f39c12':'#2ecc71';
}
function flush(){
  if(busy||!queue.length)return;busy=true;var batch=queue.slice();
  fetch('/tap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)})
    .then(function(r){if(r.ok){queue=queue.slice(batch.length);put('queue',queue);}})
    .catch(function(){}).then(function(){busy=false;render();});
}
document.getElementById('s').onclick=function(){tap('START',null);};
document.getElementById('d').onclick=function(){tap('DONE',null);};
document.getElementById('u').onclick=function(){if(recent.length)tap('UNDO',recent[0].seq);};
setInterval(flush,3000);render();flush();
</script></body></html>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/tap') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let added = 0;
      try { added = save(JSON.parse(body)); } catch { /* bad payload: drop it */ }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ added }));
    });
    return;
  }
  const html = req.url.startsWith('/summary') ? summary() : PAGE;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
}).listen(PORT, '0.0.0.0', () => console.log(`tap-test on :${PORT}  (summary: /summary, data: ${DATA})`));
