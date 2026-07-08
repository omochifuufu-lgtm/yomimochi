/* よみもち — 子ども向け読書記録アプリ（旧名: よみよみ きろく）
   データは端末内 (localStorage) に保存。サーバー不要・ログイン不要。

   ■ 全体の仕組み（1ファイル構成・ビルドなし）
   状態はグローバル `db` ただ1つ。変更したら save() で保存し、該当画面の
   render○○() を呼び直す、の繰り返し。フレームワークなし・素のDOM操作。
     db 変更 → save() → renderHome()/renderLibrary()/... で画面再描画

   ■ セクション目次（「==== 名前 ====」のバナーコメントで区切ってある）
     データ層          db・load()/save()・P()＝現在の子を返す（最重要）
     日付ヘルパー      期間判定（きょう/今週/今年）
     マスコット        mochiSVG()＝クレヨン風SVG生成・吹き出しセリフ
     画面遷移          nav(名前)＝ページ切替とタブ点灯
     ホーム描画        renderHome()
     ライブラリ        renderLibrary()＝ほんだな一覧
     本の詳細          openBook()/addSession()＝よんだ記録＋1
     感想モーダル      手書きCanvas・音声入力・文字入力の3モード
     バーコードスキャナー  BarcodeDetector（iOS Safari系は非対応な点に注意）
     本の情報を取得    lookupISBN()＝openBD→Google Books の順で照会
     手入力検索        タイトル検索（Google Books）
     目標設定          よむ目標の設定UI
     ユーティリティ    esc()＝HTMLエスケープ・toast()
     きょうだい        プロフィール追加/切替/削除
     ごほうびスタンプ  条件判定 evaluateStamps() とお祝い演出
     おうちの人へ      Amazonリンク生成・SNSシェア（収益導線はこの画面だけ）
     せってい・バックアップ  JSON書き出し/取り込み
     起動              load()→スタンプ再評価→マスコット描画→home表示

   ■ 触るまえに products/yomimochi/CLAUDE.md（開発ガイド）を必ず読むこと。
     壊しやすい不変条件（localStorageキー・移行処理・子ども向けUI原則）を
     まとめてある。 */

'use strict';

/* ============ データ層 ============ */
const STORE = 'yomiyomi.v1'; // 改名前からのキー。変えると既存ユーザーの記録が消えるため据え置き
const AVATARS = ['🐱','🐶','🐰','🐻','🦊','🐧','🦁','🐸','🐵','🦄','🐯','🐼'];
const db = {
  profiles: [],       // {id, name, avatar, books:[...], goal:{period,target}}
  currentId: null
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function newProfile(name, avatar) {
  return { id: uid(), name: name || 'わたし', avatar: avatar || AVATARS[0],
           books: [], goal: { period: 'year', target: 50 }, stamps: {} };
}

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { console.warn('load failed', e); }
  if (raw && raw.profiles && raw.profiles.length) {
    db.profiles = raw.profiles;
    db.currentId = raw.currentId && raw.profiles.some(p => p.id === raw.currentId)
      ? raw.currentId : raw.profiles[0].id;
  } else if (raw && raw.books) {
    // v1 (単一ユーザー) からの移行：既存の記録を最初の子に引き継ぐ
    const p = newProfile('わたし', AVATARS[0]);
    p.books = raw.books; if (raw.goal) p.goal = raw.goal;
    db.profiles = [p]; db.currentId = p.id;
  } else {
    const p = newProfile('わたし', AVATARS[0]);
    db.profiles = [p]; db.currentId = p.id;
  }
}
function save() { localStorage.setItem(STORE, JSON.stringify(db)); }

/* 現在選択中の子ども */
function P() { return db.profiles.find(p => p.id === db.currentId) || db.profiles[0]; }

/* ============ 日付ヘルパー ============ */
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
function inToday(iso)  { const t = startOfDay(new Date()); return new Date(iso) >= t; }
function inWeek(iso)   { const d = new Date(); d.setDate(d.getDate()-6); return new Date(iso) >= startOfDay(d); }
function inYear(iso)   { return new Date(iso).getFullYear() === new Date().getFullYear(); }
function inPeriod(iso, period) {
  if (period === 'week')  return inWeek(iso);
  if (period === 'month') { const d = new Date(); d.setMonth(d.getMonth()-1); return new Date(iso) >= d; }
  return inYear(iso);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
}

/* 全セッション（読み聞かせ1回 = 1冊カウント）を平坦化 */
function allSessions() {
  const out = [];
  P().books.forEach(b => (b.sessions||[]).forEach(s => out.push(s)));
  return out;
}

/* ============ マスコット「よみもち」 ============ */
// 白いおもちに青い蝶ネクタイのキャラクター。mood: happy / wow / sleepy
// SNSのおもちファミリー（もっちー・かねもち）と同じクレヨン風タッチ:
// 丸みのあるおもち型・太い黒の手描き線（feTurbulenceで揺らぎとザラつきを付与）
let mochiSeq = 0;
function mochiSVG(mood, size) {
  size = size || 100;
  const fid = 'crayon-' + (++mochiSeq); // フィルタidはページ内で重複させない
  const eyes = mood === 'sleepy'
    ? `<path d="M76 76 Q85 84 94 76" stroke="#232320" stroke-width="7" fill="none" stroke-linecap="round"/>
       <path d="M106 76 Q115 84 124 76" stroke="#232320" stroke-width="7" fill="none" stroke-linecap="round"/>`
    : `<circle cx="85" cy="75" r="8" fill="#232320"/><circle cx="115" cy="75" r="8" fill="#232320"/>`;
  const mouth = mood === 'sleepy'
    ? `<path d="M92 96 Q100 102 108 96" stroke="#232320" stroke-width="7" fill="none" stroke-linecap="round"/>`
    : `<path d="M85 92 Q100 88 115 92 Q112 112 100 112 Q88 112 85 92 Z" fill="#e8551b" stroke="#232320" stroke-width="5" stroke-linejoin="round"/>`;
  const spark = mood === 'wow'
    ? `<text x="14" y="40" font-size="30">✨</text><text x="152" y="34" font-size="30">✨</text>` : '';
  return `<svg viewBox="0 0 200 170" width="${size}" height="${Math.round(size*0.85)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <filter id="${fid}" x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.08" numOctaves="3" seed="8" result="wobble"/>
        <feDisplacementMap in="SourceGraphic" in2="wobble" scale="6" result="rough"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="grain"/>
        <feDisplacementMap in="rough" in2="grain" scale="2.5"/>
      </filter>
    </defs>
    ${spark}
    <g filter="url(#${fid})" transform="rotate(-2 100 95)">
      <path d="M28 112 Q24 64 66 42 Q104 22 146 40 Q178 56 176 100 Q174 134 140 145 Q100 154 62 147 Q32 141 28 112 Z"
        fill="#fbfaf5" stroke="#232320" stroke-width="10" stroke-linejoin="round"/>
      ${eyes}
      ${mouth}
      <g stroke="#232320" stroke-width="6" stroke-linejoin="round">
        <path d="M95 131 L71 121 Q67 131 71 143 Z" fill="#a9c8ef"/>
        <path d="M105 131 L129 121 Q133 131 129 143 Z" fill="#a9c8ef"/>
        <circle cx="100" cy="132" r="8" fill="#a9c8ef"/>
      </g>
    </g>
  </svg>`;
}

// 状況に応じた ひとこと（ホームの吹き出し）
function mascotGreeting() {
  const sess = allSessions();
  const today = sess.filter(inToday).length;
  const g = P().goal;
  const remain = g.target - sess.filter(s => inPeriod(s, g.period)).length;
  const h = new Date().getHours();
  if (today >= 3) return `きょう ${today}さつも よんだの！？ ものしりはかせだ〜！`;
  if (today > 0)  return `きょう ${today}さつ よんだね！ もう1さつ よんじゃう？`;
  if (remain > 0 && remain <= 3) return `もくひょうまで あと ${remain}さつ！ おうえんしてるよ！`;
  if (h < 10)  return 'おはよう！ きょうは どんな ほんを よむ？';
  if (h >= 19) return 'ねるまえに 1さつ、いっしょに よもう 🌙';
  return 'ぼく よみもち！ いっしょに ほんを よもう！';
}

/* ============ 画面遷移 ============ */
function nav(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.remove('hidden');
  if (name === 'home') renderHome();
  if (name === 'library') renderLibrary();
  if (name === 'stamps') renderStamps();
  if (name === 'parent') renderParent();
  if (name === 'scan') startScanner();
  else stopScanner();
  if (name === 'goal') renderGoalForm();
  // 下部タブの点灯（詳細ページは親タブを点灯）
  const tabFor = { home:'home', library:'library', scan:'scan', stamps:'stamps', parent:'parent', book:'library', goal:'home' };
  document.querySelectorAll('.tabbar .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.nav === tabFor[name]));
  window.scrollTo(0,0);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-nav]');
  if (t) nav(t.dataset.nav);
});

/* ============ ホーム描画 ============ */
function renderHome() {
  document.getElementById('mascot-bubble').textContent = mascotGreeting();
  const sess = allSessions();
  document.getElementById('lifetime-count').textContent = sess.length;
  document.getElementById('stat-today').textContent = sess.filter(inToday).length;
  document.getElementById('stat-week').textContent  = sess.filter(inWeek).length;
  document.getElementById('stat-year').textContent  = sess.filter(inYear).length;
  document.getElementById('stat-books').textContent = P().books.length;

  // スタンプの数
  const got = Object.keys(P().stamps || {}).length;
  document.getElementById('stamp-pill').textContent = got ? `${got}/${STAMPS.length}` : '';

  // 目標カード
  const g = P().goal;
  const done = sess.filter(s => inPeriod(s, g.period)).length;
  const pct = Math.min(100, Math.round(done / g.target * 100));
  const remain = Math.max(0, g.target - done);
  const periodLbl = { week:'1しゅうかん', month:'1かげつ', year:'1ねん' }[g.period];
  let msg;
  if (remain === 0) msg = '🎉 もくひょう たっせい！すごいね！';
  else msg = `あと ${remain}さつ で もくひょう たっせい！`;
  document.getElementById('goal-card').innerHTML = `
    <div class="goal-top">
      <span class="goal-title">🎯 ${periodLbl}の もくひょう</span>
      <span class="goal-frac">${done}<small> / ${g.target}さつ</small></span>
    </div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    <div class="goal-msg">${msg}</div>`;
  document.getElementById('goal-card').onclick = () => nav('goal');

  // 最近の本
  const recent = [...P().books]
    .filter(b => b.sessions && b.sessions.length)
    .sort((a,b) => lastSession(b) - lastSession(a))
    .slice(0, 8);
  const strip = document.getElementById('recent-list');
  strip.innerHTML = recent.length ? recent.map(bookCardHTML).join('')
    : `<div class="empty">${mochiSVG('sleepy', 70)}<br>まだ ほんが ないよ。<br>したの 📷 から はじめよう！</div>`;
  bindBookCards(strip);
}

const lastSession  = (b) => Math.max(0, ...(b.sessions||[]).map(s => +new Date(s)));
const firstSession = (b) => Math.min(...(b.sessions||[]).map(s => +new Date(s)));

function bookCardHTML(b) {
  const src = safeSrc(b.cover);
  const cover = src
    ? `<img class="cover" src="${src}" alt="">`
    : `<div class="cover">📕</div>`;
  const n = (b.sessions||[]).length;
  return `<div class="book-card" data-book="${b.id}">
    ${cover}
    <div class="bt">${esc(b.title)}</div>
    ${n ? `<span class="badge">${n}かい</span>` : ''}
  </div>`;
}
function bindBookCards(scope) {
  scope.querySelectorAll('[data-book]').forEach(el =>
    el.onclick = () => openBook(el.dataset.book));
}

/* ============ ライブラリ ============ */
let sortMode = 'recent';
function renderLibrary() {
  const grid = document.getElementById('library-grid');
  let books = [...P().books];
  if (sortMode === 'recent') books.sort((a,b) => lastSession(b) - lastSession(a));
  if (sortMode === 'count')  books.sort((a,b) => (b.sessions||[]).length - (a.sessions||[]).length);
  if (sortMode === 'title')  books.sort((a,b) => (a.title||'').localeCompare(b.title||'', 'ja'));
  grid.innerHTML = books.length ? books.map(bookCardHTML).join('')
    : `<div class="empty" style="grid-column:1/-1">${mochiSVG('sleepy', 70)}<br>ほんだなは からっぽ。<br>したの 📷 で スキャンしてね</div>`;
  bindBookCards(grid);
}
document.querySelectorAll('[data-sort]').forEach(c => c.onclick = () => {
  document.querySelectorAll('[data-sort]').forEach(x => x.classList.remove('active'));
  c.classList.add('active'); sortMode = c.dataset.sort; renderLibrary();
});

/* ============ 本の詳細 ============ */
let currentBookId = null;
function openBook(id) {
  currentBookId = id;
  const b = P().books.find(x => x.id === id);
  if (!b) return;
  const n = (b.sessions||[]).length;
  const coverSrc = safeSrc(b.cover);
  const cover = coverSrc ? `<img class="bd-cover" src="${coverSrc}">` : `<div class="bd-cover">📕</div>`;
  const dates = n ? `はじめて よんだ日： ${fmtDate(firstSession(b))}<br>さいきん よんだ日： ${fmtDate(lastSession(b))}` : 'まだ よんでいないよ';
  const memos = (b.memos||[]).slice().reverse().map(m => {
    let body = '';
    if (m.type === 'draw')  body = `<img src="${safeSrc(m.content)}">`;
    if (m.type === 'voice' || m.type === 'text') body = esc(m.content);
    const icon = { draw:'✏️', voice:'🎤', text:'📝' }[m.type];
    return `<div class="memo-item"><div class="when">${icon} ${fmtDate(m.date)}</div>${body}</div>`;
  }).join('');

  document.getElementById('book-detail').innerHTML = `
    <div class="bd-top">
      ${cover}
      <div>
        <div class="bd-title">${esc(b.title)}</div>
        <div class="bd-meta">${esc(b.authors||'')}</div>
        <div class="bd-meta">${esc(b.publisher||'')}</div>
      </div>
    </div>
    <div class="bd-counts">
      <div class="bd-count"><div class="n">${n}</div><div class="l">よみきかせ かいすう</div></div>
    </div>
    <div class="bd-dates">${dates}</div>
    <button class="big-btn read" id="read-btn">📖 よんだ！ (+1)</button>
    <button class="big-btn save" id="memo-btn">✏️ かんそうを かく</button>
    ${amazonEnabled() ? `<div class="parent-links">
      <a class="parent-link" id="buy-link">🛒 この本を かう <small>（おうちの人むけ）</small></a>
      ${b.authors ? `<a class="parent-link" id="author-link">✍️ この さくしゃの ほかの本</a>` : ''}
      <p class="affiliate-note">【PR】リンクはAmazonアソシエイトです</p>
    </div>` : ''}
    <h2 class="section-title">きろくした かんそう</h2>
    <div class="memo-list">${memos || '<div class="empty">まだ かんそうが ないよ</div>'}</div>
    <button class="ghost-btn" id="del-btn" style="color:#cdbfa8">この ほんを けす</button>
  `;
  document.getElementById('read-btn').onclick = () => addSession(id);
  document.getElementById('memo-btn').onclick = () => openMemo(id);
  const buyEl = document.getElementById('buy-link');
  if (buyEl) buyEl.onclick = () => window.open(amazonBookLink(b), '_blank', 'noopener');
  const authorEl = document.getElementById('author-link');
  if (authorEl) authorEl.onclick = () => window.open(amazonAuthorLink(b), '_blank', 'noopener');
  document.getElementById('del-btn').onclick = () => {
    if (confirm('この ほんの きろくを けしますか？')) {
      P().books = P().books.filter(x => x.id !== id); save(); nav('library');
    }
  };
  nav('book');
}

function addSession(id) {
  const b = P().books.find(x => x.id === id);
  b.sessions = b.sessions || [];
  b.sessions.push(new Date().toISOString());
  save();
  const n = b.sessions.length;
  toast(n === 1 ? '🎉 はじめて よんだね！' : `📚 ${n}かいめ！よくがんばったね`);
  celebrateGoalIfHit();
  openBook(id); // 再描画
  checkStamps(); // スタンプ獲得チェック
}

function celebrateGoalIfHit() {
  const g = P().goal;
  const done = allSessions().filter(s => inPeriod(s, g.period)).length;
  if (done === g.target) setTimeout(() => toast('🎯✨ もくひょう たっせい！おめでとう！'), 1400);
}

/* ============ 感想モーダル ============ */
let memoMode = 'draw', penColor = '#222';
const memoModal = document.getElementById('memo-modal');

function openMemo(bookId) {
  currentBookId = bookId;
  memoModal.classList.remove('hidden');
  setMemoMode('draw');
  resetCanvas();
  document.getElementById('text-memo').value = '';
  document.getElementById('voice-text').textContent = 'ここに こえが もじに なるよ';
}
function closeMemo() { memoModal.classList.add('hidden'); stopRec(); }

document.querySelectorAll('.memo-tab').forEach(t =>
  t.onclick = () => setMemoMode(t.dataset.memo));
function setMemoMode(mode) {
  memoMode = mode;
  document.querySelectorAll('.memo-tab').forEach(t => t.classList.toggle('active', t.dataset.memo === mode));
  ['draw','voice','text'].forEach(m =>
    document.getElementById('pane-'+m).classList.toggle('hidden', m !== mode));
}
document.getElementById('memo-cancel').onclick = closeMemo;
document.getElementById('memo-save').onclick = saveMemo;

function saveMemo() {
  const b = P().books.find(x => x.id === currentBookId);
  if (!b) return;
  b.memos = b.memos || [];
  let memo = null;
  if (memoMode === 'draw') {
    const canvas = document.getElementById('draw-canvas');
    if (!canvasHasInk) { toast('なにか かいてね ✏️'); return; }
    memo = { type:'draw', content: canvas.toDataURL('image/png'), date: new Date().toISOString() };
  } else if (memoMode === 'text') {
    const v = document.getElementById('text-memo').value.trim();
    if (!v) { toast('もじを いれてね 📝'); return; }
    memo = { type:'text', content: v, date: new Date().toISOString() };
  } else {
    const v = document.getElementById('voice-text').textContent.trim();
    if (!v || v === 'ここに こえが もじに なるよ') { toast('こえを ろくおんしてね 🎤'); return; }
    memo = { type:'voice', content: v, date: new Date().toISOString() };
  }
  b.memos.push(memo); save();
  closeMemo(); toast('✏️ かんそうを ほぞんしたよ'); openBook(b.id);
  checkStamps(); // スタンプ獲得チェック
}

/* ---- 手書きキャンバス ---- */
let canvasHasInk = false;
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');
function resetCanvas() {
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  canvasHasInk = false;
}
resetCanvas();
let drawing = false;
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const p = e.touches ? e.touches[0] : e;
  return { x: (p.clientX - r.left) * canvas.width / r.width,
           y: (p.clientY - r.top)  * canvas.height / r.height };
}
function startDraw(e){ drawing = true; const {x,y}=canvasPos(e); ctx.beginPath(); ctx.moveTo(x,y); e.preventDefault(); }
function moveDraw(e){
  if(!drawing) return;
  const {x,y}=canvasPos(e);
  ctx.strokeStyle = penColor; ctx.lineWidth = 6; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.lineTo(x,y); ctx.stroke(); canvasHasInk = true; e.preventDefault();
}
function endDraw(){ drawing = false; }
canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', moveDraw);
window.addEventListener('mouseup', endDraw);
canvas.addEventListener('touchstart', startDraw, {passive:false});
canvas.addEventListener('touchmove', moveDraw, {passive:false});
canvas.addEventListener('touchend', endDraw);
document.querySelectorAll('.pen-color').forEach(p => p.onclick = () => {
  penColor = p.dataset.color;
  document.querySelectorAll('.pen-color').forEach(x => x.classList.remove('active'));
  p.classList.add('active');
});
document.getElementById('draw-clear').onclick = resetCanvas;

/* ---- 音声（Web Speech API） ---- */
let recog = null, recording = false;
const recBtn = document.getElementById('rec-btn');
recBtn.onclick = () => recording ? stopRec() : startRec();
function startRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('この きかいは こえにゅうりょくが つかえません'); return; }
  recog = new SR();
  recog.lang = 'ja-JP'; recog.interimResults = true; recog.continuous = true;
  let finalText = '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr; else interim += tr;
    }
    document.getElementById('voice-text').textContent = (finalText + interim) || '…';
  };
  recog.onend = () => { recording = false; recBtn.classList.remove('on'); recBtn.textContent = '🎤 おして はなす'; };
  recog.start(); recording = true;
  recBtn.classList.add('on'); recBtn.textContent = '⏹ とめる（はなしちゅう）';
}
function stopRec() { if (recog && recording) recog.stop(); }

/* ============ バーコードスキャナー ============ */
let scanStream = null, scanLoop = null, detector = null;
async function startScanner() {
  const status = document.getElementById('scan-status');
  const video = document.getElementById('cam');
  document.getElementById('search-results').innerHTML = '';
  // iPhone等のバーコード非対応ブラウザでは、読み取れないカメラを出さず名前検索へ誘導する
  if (!('BarcodeDetector' in window)) {
    document.querySelector('#page-scan .scanner').classList.add('hidden');
    document.querySelector('#page-scan .section-title').textContent = '🔍 ほんを さがそう';
    document.querySelector('#page-scan .bubble').textContent = 'この スマホは カメラよみとりが つかえないの。ほんの なまえで さがしてね！';
    document.querySelector('#page-scan .manual > .hint').classList.add('hidden');
    status.textContent = '👇 ほんの なまえか、うらの すうじ（978で はじまる）で さがせるよ';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream; await video.play();
    status.textContent = 'バーコードを わくに あわせてね';
    if ('BarcodeDetector' in window) {
      detector = new BarcodeDetector({ formats: ['ean_13'] });
      scanTick();
    }
  } catch (e) {
    status.textContent = '📷 カメラが つかえません。すうじで にゅうりょくしてね';
  }
}
async function scanTick() {
  const video = document.getElementById('cam');
  if (!scanStream) return;
  try {
    const codes = await detector.detect(video);
    const hit = codes.find(c => /^97[89]/.test(c.rawValue));
    if (hit) { stopScanner(); lookupISBN(hit.rawValue); return; }
  } catch (e) {}
  scanLoop = requestAnimationFrame(scanTick);
}
function stopScanner() {
  if (scanLoop) cancelAnimationFrame(scanLoop), scanLoop = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

/* ============ 本の情報を取得 ============ */
// Google Books は config.js のAPIキーを付けて呼ぶ（キーなし共有枠はクォータ枯渇で不安定）
function gbKey() {
  const k = window.YOMI_CONFIG && YOMI_CONFIG.googleBooksKey;
  return k ? '&key=' + encodeURIComponent(k) : '';
}

// openBD (日本の書籍, 無料, APIキー不要) → Google Books フォールバック
async function lookupISBN(isbn) {
  isbn = isbn.replace(/[^0-9X]/gi, '');
  const status = document.getElementById('scan-status');
  if (status) status.textContent = '🔍 ほんを さがしています…';
  // 既に登録済みなら開く
  const existing = P().books.find(b => b.isbn === isbn);
  if (existing) { toast('もう ほんだなに あるよ！'); openBook(existing.id); return; }
  try {
    const r = await fetch('https://api.openbd.jp/v1/get?isbn=' + isbn);
    const data = await r.json();
    if (data && data[0]) {
      const s = data[0].summary;
      return addBook({
        isbn, title: s.title || '（なまえ ふめい）',
        authors: s.author || '', publisher: s.publisher || '',
        pubdate: s.pubdate || '', cover: s.cover || ''
      });
    }
  } catch (e) { console.warn(e); }
  // フォールバック
  try {
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + gbKey());
    const data = await r.json();
    if (data.items && data.items[0]) return addBook(fromGoogle(data.items[0], isbn));
  } catch (e) {}
  toast('みつからなかった… てにゅうりょくしてね');
  if (status) status.textContent = 'みつかりませんでした。すうじか なまえで さがしてね';
}

function fromGoogle(item, isbn) {
  const v = item.volumeInfo || {};
  return {
    isbn: isbn || (v.industryIdentifiers && v.industryIdentifiers[0].identifier) || '',
    title: v.title || '（なまえ ふめい）',
    authors: (v.authors || []).join('、'),
    publisher: v.publisher || '',
    pubdate: v.publishedDate || '',
    cover: (v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail) || '').replace('http:','https:')
  };
}

function addBook(info) {
  const book = { id: uid(), addedDate: new Date().toISOString(), sessions: [], memos: [], ...info };
  P().books.unshift(book); save();
  toast('📕 「' + book.title + '」を ついか！');
  openBook(book.id);
  checkStamps(); // 本だな冊数のスタンプチェック
  return book;
}

/* ============ 手入力検索 ============ */
document.getElementById('isbn-go').onclick = () => {
  const v = document.getElementById('isbn-input').value.trim();
  if (v) lookupISBN(v);
};
document.getElementById('title-go').onclick = searchByTitle;
document.getElementById('title-input').addEventListener('keydown', e => { if (e.key==='Enter') searchByTitle(); });

async function searchByTitle() {
  const q = document.getElementById('title-input').value.trim();
  if (!q) return;
  const box = document.getElementById('search-results');
  box.innerHTML = '<div class="hint">さがしています…</div>';
  try {
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) + '&maxResults=8&langRestrict=ja' + gbKey());
    const data = await r.json();
    if (data.error) { box.innerHTML = '<div class="hint">こんでいるみたい… すこし まってから もういちど ためしてね</div>'; return; }
    if (!data.items) { box.innerHTML = '<div class="hint">みつかりませんでした</div>'; return; }
    box.innerHTML = data.items.map((it, i) => {
      const v = it.volumeInfo || {};
      const img = (v.imageLinks && v.imageLinks.smallThumbnail || '').replace('http:','https:');
      window.__sr = window.__sr || {}; window.__sr[i] = fromGoogle(it);
      return `<div class="sr-item" data-sr="${i}">
        ${img ? `<img src="${img}">` : '<div style="width:40px;height:56px;background:#eee;border-radius:6px"></div>'}
        <div><div class="t">${esc(v.title||'')}</div><div class="a">${esc((v.authors||[]).join('、'))}</div></div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-sr]').forEach(el =>
      el.onclick = () => addBook(window.__sr[el.dataset.sr]));
  } catch (e) { box.innerHTML = '<div class="hint">エラーが おきました</div>'; }
}

/* ============ 目標設定 ============ */
function renderGoalForm() {
  document.querySelectorAll('#goal-period button').forEach(b =>
    b.classList.toggle('active', b.dataset.period === P().goal.period));
  document.getElementById('goal-target').value = P().goal.target;
}
document.querySelectorAll('#goal-period button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#goal-period button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
});
document.getElementById('goal-minus').onclick = () => stepGoal(-1);
document.getElementById('goal-plus').onclick  = () => stepGoal(1);
function stepGoal(d) {
  const inp = document.getElementById('goal-target');
  inp.value = Math.max(1, (parseInt(inp.value)||0) + d);
}
document.getElementById('goal-save').onclick = () => {
  const period = document.querySelector('#goal-period button.active').dataset.period;
  const target = Math.max(1, parseInt(document.getElementById('goal-target').value) || 1);
  P().goal = { period, target }; save();
  toast('🎯 もくひょうを セットしたよ！');
  checkStamps(); // 目標変更で達成スタンプが出ることがある
  nav('home');
};

/* ============ ユーティリティ ============ */
function esc(s) { return (s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// 外部由来のURLを src 属性に入れる前の無害化（https と data:image のみ許可。バックアップ取込やAPI応答の細工対策）
function safeSrc(u) {
  u = String(u || '');
  return (u.startsWith('https://') || u.startsWith('data:image/')) ? esc(u) : '';
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden'); requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 2200);
}

/* ============ きょうだい（プロフィール） ============ */
let pickedAvatar = AVATARS[0];
const profileModal = document.getElementById('profile-modal');

function renderWho() {
  const p = P();
  document.getElementById('who-avatar').textContent = p.avatar;
  document.getElementById('who-name').textContent = p.name;
}

function openProfileModal() {
  renderProfileList();
  renderAvatarGrid();
  document.getElementById('new-name').value = '';
  profileModal.classList.remove('hidden');
}
function closeProfileModal() { profileModal.classList.add('hidden'); }

function renderProfileList() {
  const list = document.getElementById('profile-list');
  list.innerHTML = db.profiles.map(p => {
    const n = p.books.reduce((s, b) => s + (b.sessions ? b.sessions.length : 0), 0);
    const active = p.id === db.currentId;
    const canDel = db.profiles.length > 1;
    return `<div class="profile-row ${active ? 'active' : ''}" data-pid="${p.id}">
      <span class="pa">${p.avatar}</span>
      <span class="pn">${esc(p.name)}</span>
      <span class="pc">${n}さつ</span>
      ${active ? '<span class="check">✓</span>'
               : (canDel ? `<button class="pdel" data-del="${p.id}">🗑</button>` : '')}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-pid]').forEach(row => row.onclick = (e) => {
    if (e.target.closest('[data-del]')) return;
    switchProfile(row.dataset.pid);
  });
  list.querySelectorAll('[data-del]').forEach(btn => btn.onclick = (e) => {
    e.stopPropagation(); deleteProfile(btn.dataset.del);
  });
}

function renderAvatarGrid() {
  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = AVATARS.map(a =>
    `<button data-av="${a}" class="${a === pickedAvatar ? 'active' : ''}">${a}</button>`).join('');
  grid.querySelectorAll('[data-av]').forEach(b => b.onclick = () => {
    pickedAvatar = b.dataset.av; renderAvatarGrid();
  });
}

function switchProfile(id) {
  db.currentId = id; save();
  renderWho(); closeProfileModal();
  toast(P().avatar + ' ' + P().name + 'に きりかえたよ');
  nav('home');
}

function addProfile() {
  const name = document.getElementById('new-name').value.trim() || 'なまえなし';
  const p = newProfile(name, pickedAvatar);
  db.profiles.push(p); db.currentId = p.id; save();
  pickedAvatar = AVATARS[0];
  renderWho(); closeProfileModal();
  toast(p.avatar + ' ' + p.name + 'を ついかしたよ！');
  nav('home');
}

function deleteProfile(id) {
  const p = db.profiles.find(x => x.id === id);
  if (!p) return;
  if (!confirm(p.name + 'の きろくを ぜんぶ けしますか？')) return;
  db.profiles = db.profiles.filter(x => x.id !== id);
  if (db.currentId === id) db.currentId = db.profiles[0].id;
  save(); renderWho(); renderProfileList();
}

document.getElementById('who-btn').onclick = openProfileModal;
document.getElementById('profile-close').onclick = closeProfileModal;
document.getElementById('profile-add').onclick = addProfile;
document.getElementById('new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addProfile(); });

/* ============ ごほうび スタンプ ============ */
// 条件はすべて「いまの子」のデータから計算できる値だけで判定する
const STAMPS = [
  { id:'first',   emoji:'🌱', title:'はじめの 1さつ',     hint:'1さつ よむと もらえる',        test:s => s.reads >= 1 },
  { id:'r5',      emoji:'📚', title:'5さつ よんだ',        hint:'ぜんぶで 5さつ',               test:s => s.reads >= 5 },
  { id:'r10',     emoji:'🎒', title:'10さつ よんだ',       hint:'ぜんぶで 10さつ',              test:s => s.reads >= 10 },
  { id:'r25',     emoji:'🏫', title:'25さつ よんだ',       hint:'ぜんぶで 25さつ',              test:s => s.reads >= 25 },
  { id:'r50',     emoji:'🌟', title:'50さつ よんだ',       hint:'ぜんぶで 50さつ',              test:s => s.reads >= 50 },
  { id:'r100',    emoji:'👑', title:'100さつ よんだ',      hint:'ぜんぶで 100さつ',             test:s => s.reads >= 100 },
  { id:'re5',     emoji:'🔁', title:'おなじ本 5かい',      hint:'おなじ本を 5かい よむ',        test:s => s.maxRe >= 5 },
  { id:'re10',    emoji:'💖', title:'だいすきな本 10かい', hint:'おなじ本を 10かい よむ',       test:s => s.maxRe >= 10 },
  { id:'memo1',   emoji:'✏️', title:'はじめての かんそう', hint:'かんそうを 1こ かく',          test:s => s.memos >= 1 },
  { id:'memo10',  emoji:'📝', title:'かんそう 10こ',       hint:'かんそうを 10こ かく',         test:s => s.memos >= 10 },
  { id:'shelf10', emoji:'📖', title:'本だな 10さつ',       hint:'ちがう本を 10さつ あつめる',   test:s => s.distinct >= 10 },
  { id:'goal',    emoji:'🎯', title:'もくひょう たっせい', hint:'もくひょうの かずを よむ',     test:s => s.goalHit },
];

function profileStats(p) {
  let reads = 0, memos = 0, maxRe = 0;
  const allSess = [];
  p.books.forEach(b => {
    const n = (b.sessions || []).length;
    reads += n; if (n > maxRe) maxRe = n;
    memos += (b.memos || []).length;
    (b.sessions || []).forEach(s => allSess.push(s));
  });
  const goalDone = allSess.filter(s => inPeriod(s, p.goal.period)).length;
  return { reads, memos, maxRe, distinct: p.books.length, goalHit: goalDone >= p.goal.target };
}

// 新しく獲得したスタンプの配列を返す（記録もする）
function evaluateStamps(p) {
  p.stamps = p.stamps || {};
  const s = profileStats(p);
  const newly = [];
  STAMPS.forEach(st => {
    if (!p.stamps[st.id] && st.test(s)) {
      p.stamps[st.id] = new Date().toISOString();
      newly.push(st);
    }
  });
  if (newly.length) save();
  return newly;
}

// 行動のあとに呼ぶ：新規ゲットがあればお祝い
function checkStamps() {
  const newly = evaluateStamps(P());
  if (newly.length) showStampCelebration(newly);
}

let stampQueue = [];
function showStampCelebration(list) {
  stampQueue = list.slice();
  showNextStamp();
}
function showNextStamp() {
  const modal = document.getElementById('stamp-modal');
  if (!stampQueue.length) { modal.classList.add('hidden'); return; }
  const st = stampQueue.shift();
  document.getElementById('celebrate-emoji').textContent = st.emoji;
  document.getElementById('celebrate-sub').textContent = '「' + st.title + '」';
  modal.classList.remove('hidden');
}
document.getElementById('celebrate-ok').onclick = showNextStamp;

function renderStamps() {
  const p = P();
  evaluateStamps(p); // 開いたタイミングでも最新化（既存データの取りこぼし防止）
  const earned = STAMPS.filter(st => p.stamps[st.id]).length;
  document.getElementById('stamp-progress').textContent = `${earned} / ${STAMPS.length} こ あつめたよ！`;
  document.getElementById('stamp-grid').innerHTML = STAMPS.map(st => {
    const got = p.stamps[st.id];
    return got
      ? `<div class="stamp got"><div class="se">${st.emoji}</div><div class="st">${st.title}</div><div class="sd">${fmtDate(got)}</div></div>`
      : `<div class="stamp locked"><div class="se">${st.emoji}</div><div class="st">？？？</div><div class="sd">${st.hint}</div></div>`;
  }).join('');
}

/* ============ おうちの人へ（収益導線・シェア） ============ */
function amzCfg() { return (window.YOMI_CONFIG && YOMI_CONFIG.amazon) || {}; }
function amazonEnabled() { return amzCfg().enabled !== false; }

// ISBN-13(978始まり) → ISBN-10。書籍は ISBN-10 がそのまま Amazon の ASIN になる
function isbn13to10(isbn13) {
  if (!isbn13 || !/^978\d{10}$/.test(isbn13)) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}
function amazonBookLink(book) {
  const c = amzCfg();
  const dom = c.domain || 'www.amazon.co.jp';
  const i10 = isbn13to10(book.isbn);
  if (i10) return `https://${dom}/dp/${i10}/` + (c.tag ? '?tag=' + encodeURIComponent(c.tag) : '');
  const q = encodeURIComponent(book.isbn || book.title || '');
  return `https://${dom}/s?k=${q}` + (c.tag ? '&tag=' + encodeURIComponent(c.tag) : '');
}
function amazonBrowseLink() {
  const c = amzCfg();
  const dom = c.domain || 'www.amazon.co.jp';
  return `https://${dom}/s?k=${encodeURIComponent('絵本 児童書')}` + (c.tag ? '&tag=' + encodeURIComponent(c.tag) : '');
}
function amazonAuthorLink(book) {
  const c = amzCfg();
  const dom = c.domain || 'www.amazon.co.jp';
  // openBDの著者欄は「作／◯◯ 絵／◯◯」等があるので最初の1人の名前部分だけ使う
  const first = (book.authors || '').split(/[、,，・]/)[0].replace(/[（(].*?[）)]/g, '').replace(/^(作|絵|文|さく|え|ぶん|著|訳)[：:／/]?/, '').trim();
  return `https://${dom}/s?k=${encodeURIComponent(first + ' 絵本')}` + (c.tag ? '&tag=' + encodeURIComponent(c.tag) : '');
}

// SNSシェア
function appShareUrl() { return (window.YOMI_CONFIG && YOMI_CONFIG.appUrl) || location.href; }
function achievementText() {
  const p = P();
  const reads = allSessions().length;
  return `${p.avatar}${p.name}は いままで ${reads}さつ よみました！📚✨ #よみもち`;
}
function copyText(t) {
  if (navigator.clipboard) { navigator.clipboard.writeText(t).catch(() => {}); return; }
  const ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}
async function doShare(text) {
  const url = appShareUrl();
  if (navigator.share) {
    try { await navigator.share({ title: 'よみもち', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyText(text + '\n' + url);
  toast('📋 シェア文を コピーしたよ');
}
function shareVia(kind, text) {
  const url = appShareUrl();
  const full = text + '\n' + url;
  if (kind === 'line') window.open('https://line.me/R/msg/text/?' + encodeURIComponent(full), '_blank', 'noopener');
  else if (kind === 'x') window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url), '_blank', 'noopener');
  else { copyText(full); toast('📋 リンクを コピーしたよ'); }
}

function renderParent() {
  const p = P();
  const reads = allSessions().length;
  document.getElementById('share-summary').innerHTML =
    `${p.avatar} <b>${esc(p.name)}</b>は いままで <b>${reads}</b>さつ よみました！`;
  document.getElementById('amazon-card').style.display = amazonEnabled() ? '' : 'none';
  document.getElementById('affiliate-note').textContent =
    '【PR】Amazonのアソシエイトとして、よみもちは適格販売により収入を得ています。';

  // よく読んでいる本（回数トップ3）→ 買い足し導線
  const card = document.getElementById('rebuy-card');
  const top = [...p.books]
    .filter(b => b.sessions && b.sessions.length >= 2)
    .sort((a, b) => b.sessions.length - a.sessions.length)
    .slice(0, 3);
  if (!amazonEnabled() || !top.length) { card.style.display = 'none'; }
  else {
    card.style.display = '';
    document.getElementById('rebuy-list').innerHTML = top.map((b, i) => `
      <div class="rebuy-item">
        ${safeSrc(b.cover) ? `<img src="${safeSrc(b.cover)}" alt="">` : '<div class="rb-ph">📕</div>'}
        <div class="rb-info">
          <div class="rb-t">${esc(b.title)}</div>
          <div class="rb-c">${b.sessions.length}かい よんでいます</div>
        </div>
        <button class="mini-btn" data-rebuy="${i}">かう</button>
      </div>`).join('');
    document.querySelectorAll('[data-rebuy]').forEach(btn =>
      btn.onclick = () => window.open(amazonBookLink(top[btn.dataset.rebuy]), '_blank', 'noopener'));
  }
}

document.getElementById('share-native').onclick = () => doShare(achievementText());
document.querySelectorAll('[data-share]').forEach(b =>
  b.onclick = () => shareVia(b.dataset.share, achievementText()));
document.getElementById('browse-amazon').onclick = () => window.open(amazonBrowseLink(), '_blank', 'noopener');
document.getElementById('celebrate-share').onclick = () => doShare(achievementText());

/* ============ せってい・バックアップ ============ */
const settingsModal = document.getElementById('settings-modal');

function openSettings() {
  const totalBooks = db.profiles.reduce((s, p) => s + p.books.length, 0);
  const totalReads = db.profiles.reduce((s, p) =>
    s + p.books.reduce((t, b) => t + (b.sessions ? b.sessions.length : 0), 0), 0);
  document.getElementById('backup-summary').innerHTML =
    `いま： おともだち ${db.profiles.length}にん ／ ほん ${totalBooks}さつ ／ よみきかせ ${totalReads}かい`;
  settingsModal.classList.remove('hidden');
}
function closeSettings() { settingsModal.classList.add('hidden'); }

function exportData() {
  const payload = {
    app: 'yomimochi', // 旧 'yomiyomi-kiroku'。取り込み側はこの値を見ないため旧バックアップも復元可
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { profiles: db.profiles, currentId: db.currentId }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const a = document.createElement('a');
  a.href = url; a.download = `yomimochi-backup-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('📤 バックアップを かきだしたよ！');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { toast('⚠️ ファイルを よめませんでした'); return; }

    // 形式チェック：本アプリの書き出し or 生の {profiles}
    const data = (parsed && parsed.data) ? parsed.data : parsed;
    if (!data || !Array.isArray(data.profiles) || data.profiles.length === 0) {
      toast('⚠️ よみもちの バックアップでは ないみたい');
      return;
    }
    const n = data.profiles.length;
    const books = data.profiles.reduce((s, p) => s + ((p.books && p.books.length) || 0), 0);
    if (!confirm(`バックアップ（おともだち ${n}にん・ほん ${books}さつ）に もどします。\nいまの きろくは うわがきされます。よろしいですか？`)) return;

    // 取り込み（最低限の正規化）
    db.profiles = data.profiles.map(p => ({
      id: p.id || uid(),
      name: p.name || 'なまえなし',
      avatar: p.avatar || AVATARS[0],
      books: Array.isArray(p.books) ? p.books : [],
      goal: (p.goal && p.goal.period && p.goal.target) ? p.goal : { period: 'year', target: 50 },
      stamps: (p.stamps && typeof p.stamps === 'object') ? p.stamps : {}
    }));
    db.currentId = data.currentId && db.profiles.some(p => p.id === data.currentId)
      ? data.currentId : db.profiles[0].id;
    save();
    renderWho(); closeSettings(); nav('home');
    toast('📥 バックアップから もどしたよ！');
  };
  reader.readAsText(file);
}

document.getElementById('settings-btn').onclick = openSettings;
document.getElementById('settings-close').onclick = closeSettings;
document.getElementById('export-btn').onclick = exportData;
document.getElementById('import-btn').onclick = () => document.getElementById('import-file').click();
document.getElementById('import-file').onchange = (e) => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = ''; // 同じファイルを連続で選べるようにリセット
};

/* ============ 起動 ============ */
load();
db.profiles.forEach(p => evaluateStamps(p)); // 既存データのスタンプを反映（お祝いはしない）
document.querySelectorAll('.mochi').forEach(el =>
  el.innerHTML = mochiSVG(el.dataset.mood || 'happy', Number(el.dataset.size) || 100));
renderWho();
nav('home');
