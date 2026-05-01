// ============================================================
// Riley Family — Photo Dump Module
// Handles IndexedDB media storage, upload UI, contributors,
// countdown timer, and the full Spotify Wrapped–style reveal.
// ============================================================

window.Dump = (() => {

  // ── IndexedDB setup ───────────────────────────────────────
  const DB_NAME    = 'RileyFamilyDB';
  const DB_VERSION = 1;
  const STORE_MEDIA   = 'media';
  const STORE_REVEALS = 'reveals';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_MEDIA)) {
          const s = d.createObjectStore(STORE_MEDIA, { keyPath: 'id', autoIncrement: true });
          s.createIndex('weekKey',  'weekKey',  { unique: false });
          s.createIndex('uploader', 'uploader', { unique: false });
        }
        if (!d.objectStoreNames.contains(STORE_REVEALS)) {
          d.createObjectStore(STORE_REVEALS, { keyPath: 'weekKey' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction([storeName], mode).objectStore(storeName);
  }

  function idbGet(store, key) {
    return new Promise((res, rej) => {
      const r = store.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function idbGetAll(store) {
    return new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function idbGetAllByIndex(storeName, indexName, value) {
    return new Promise((res, rej) => {
      const store = tx(storeName).index(indexName);
      const r = store.getAll(value);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function idbPut(storeName, item) {
    return new Promise((res, rej) => {
      const store = tx(storeName, 'readwrite');
      const r = store.put(item);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function idbDelete(storeName, key) {
    return new Promise((res, rej) => {
      const store = tx(storeName, 'readwrite');
      const r = store.delete(key);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }

  // ── State ─────────────────────────────────────────────────
  let revealEnabledAt   = 0; // timestamp after which startReveal() is allowed
  let countdownInterval = null;
  let mediaRecorder = null;
  let audioChunks   = [];
  let recordingInterval = null;
  let recordingSeconds  = 0;
  let isRecording = false;

  // ── Timing helpers ────────────────────────────────────────
  function canUpload() {
    const now = new Date();
    const day = now.getDay();
    const h   = now.getHours();
    // Mon (1) or Tue (2) anytime, or Wed (3) before noon
    return day === 1 || day === 2 || (day === 3 && h < 12);
  }

  function isRevealUnlocked() {
    const now = new Date();
    const day = now.getDay();
    const h   = now.getHours();
    // Wed noon onwards, or Thu–Sun
    return (day === 3 && h >= 12) || day === 4 || day === 5 || day === 6 || day === 0;
  }

  function getTimeUntilReveal() {
    const now = new Date();
    const day = now.getDay();
    const h   = now.getHours();
    const nextWed = new Date(now);
    let daysUntil = ((3 - day + 7) % 7);
    if (daysUntil === 0 && h >= 12) daysUntil = 7;
    nextWed.setDate(now.getDate() + daysUntil);
    nextWed.setHours(12, 0, 0, 0);
    return nextWed - now;
  }

  function formatTimeLeft(ms) {
    if (ms <= 0) return '00:00:00';
    const s  = Math.floor(ms / 1000);
    const m  = Math.floor(s / 60);
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const ss = s % 60;
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }

  function getWeekDateRange() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(now);
    mon.setDate(diff); mon.setHours(0,0,0,0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    return `${mon.toLocaleDateString('en-US', opts)} – ${sun.toLocaleDateString('en-US', opts)}`;
  }

  // ── Save media to IndexedDB ───────────────────────────────
  async function saveMediaItem(blob, type, filename, mimeType) {
    await openDB();
    const weekKey  = App.getWeekKey();
    const uploader = App.getCurrentMember();
    const item = {
      weekKey, uploader, type,
      data: blob,
      filename: filename || `${type}-${Date.now()}`,
      mimeType: mimeType || blob.type,
      timestamp: Date.now(),
    };
    await idbPut(STORE_MEDIA, item);
    vibrate(10);
    await refreshDumpUI();
    await refreshHomeStats();
  }

  // ── Get all media for week ────────────────────────────────
  async function getWeekMedia(weekKey) {
    await openDB();
    return idbGetAllByIndex(STORE_MEDIA, 'weekKey', weekKey);
  }

  async function getMyMedia(weekKey) {
    const all = await getWeekMedia(weekKey);
    return all.filter(m => m.uploader === App.getCurrentMember());
  }

  // ── Group media by member ─────────────────────────────────
  function groupByMember(items) {
    const map = {};
    CONFIG.APP.MEMBERS.forEach(m => { map[m] = []; });
    items.forEach(item => {
      if (map[item.uploader]) map[item.uploader].push(item);
      else map[item.uploader] = [item];
    });
    return map;
  }

  // ── Blob → object URL (revoked after use) ─────────────────
  function blobURL(blob) {
    return URL.createObjectURL(blob);
  }

  // ── Recording helpers ─────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks  = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: mimeType });
        const ext  = mimeType.includes('mp4') ? 'm4a' : 'webm';
        await saveMediaItem(blob, 'voice', `voice-${Date.now()}.${ext}`, mimeType);
        stopRecordingUI();
      };
      mediaRecorder.start(100);
      isRecording = true;
      startRecordingUI();
    } catch (e) {
      alert(`Could not access microphone: ${e.message}`);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
  }

  function getSupportedMimeType() {
    const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function startRecordingUI() {
    const btn = document.getElementById('upload-voice-btn');
    const ind = document.getElementById('recording-indicator');
    const label = document.getElementById('voice-btn-label');
    if (btn) btn.classList.add('recording');
    if (ind) ind.classList.remove('hidden');
    if (label) label.textContent = 'Stop';
    recordingSeconds = 0;
    const timer = document.getElementById('recording-timer');
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = recordingSeconds % 60;
      if (timer) timer.textContent = `${m}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  function stopRecordingUI() {
    const btn = document.getElementById('upload-voice-btn');
    const ind = document.getElementById('recording-indicator');
    const label = document.getElementById('voice-btn-label');
    if (btn) btn.classList.remove('recording');
    if (ind) ind.classList.add('hidden');
    if (label) label.textContent = 'Voice';
    clearInterval(recordingInterval);
    recordingInterval = null;
  }

  // ── Haptics ───────────────────────────────────────────────
  function vibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // ── Render my uploads ─────────────────────────────────────
  async function renderMyUploads() {
    const weekKey = App.getWeekKey();
    const items   = await getMyMedia(weekKey);
    const content = document.getElementById('my-uploads-content');
    const count   = document.getElementById('my-uploads-count');
    if (!content) return;

    if (count) count.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

    if (items.length === 0) {
      content.innerHTML = `<div class="empty-state" style="padding:24px 0;">
        <span class="empty-icon">📭</span>
        <p>Nothing uploaded yet this week.<br/>Be the first to share something!</p>
      </div>`;
      return;
    }

    const photos = items.filter(m => m.type === 'photo');
    const videos = items.filter(m => m.type === 'video');
    const voices = items.filter(m => m.type === 'voice');
    let html = '';

    if (photos.length > 0 || videos.length > 0) {
      html += `<div class="media-grid">`;
      [...photos, ...videos].slice(0, 9).forEach(item => {
        const url = blobURL(item.data);
        if (item.type === 'photo') {
          html += `<div class="media-thumb"><img src="${url}" loading="lazy" /><span class="media-type-badge">📷</span></div>`;
        } else {
          html += `<div class="media-thumb"><video src="${url}" muted playsinline></video><span class="media-type-badge">🎥</span></div>`;
        }
      });
      html += `</div>`;
    }

    if (voices.length > 0) {
      voices.forEach(item => {
        const url = blobURL(item.data);
        const dur = ''; // Duration not easily available without decoding
        html += `<div class="voice-item" style="margin-top:8px;">
          <span class="voice-icon">🎙️</span>
          <div class="voice-info">
            <div class="voice-name">${item.filename}</div>
            <div class="voice-dur">${new Date(item.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          <audio controls src="${url}" style="height:32px;width:120px;"></audio>
        </div>`;
      });
    }

    content.innerHTML = html;
  }

  // ── Render contributors ───────────────────────────────────
  async function renderContributors() {
    const weekKey = App.getWeekKey();
    const all     = await getWeekMedia(weekKey);
    const grouped = groupByMember(all);
    const list    = document.getElementById('contributors-list');
    if (!list) return;

    const memberEmojis = { Dad: '👨', Mom: '👩', Maddox: '🧒', Dylan: '👦' };
    const colors = { Dad: '#007AFF', Mom: '#FF2D55', Maddox: '#34C759', Dylan: '#AF52DE' };

    list.innerHTML = CONFIG.APP.MEMBERS.map(member => {
      const items  = grouped[member] || [];
      const hasAny = items.length > 0;
      const photos = items.filter(m => m.type === 'photo').length;
      const videos = items.filter(m => m.type === 'video').length;
      const voices = items.filter(m => m.type === 'voice').length;
      const countStr = hasAny
        ? [photos && `${photos}📷`, videos && `${videos}🎥`, voices && `${voices}🎙️`].filter(Boolean).join(' ')
        : 'No uploads yet';

      return `<div class="contributor-row">
        <div class="contributor-avatar" style="background:${colors[member]}22;">
          ${memberEmojis[member] || '👤'}
        </div>
        <span class="contributor-name">${member}</span>
        <span class="contributor-count">${countStr}</span>
        ${hasAny
          ? `<div class="contributor-check">✓</div>`
          : `<div class="contributor-empty"></div>`}
      </div>`;
    }).join('');

    // Also update home pills
    renderHomePills(grouped);
  }

  function renderHomePills(grouped) {
    const pillsEl = document.getElementById('home-contrib-pills');
    if (!pillsEl) return;
    const memberEmojis = { Dad: '👨', Mom: '👩', Maddox: '🧒', Dylan: '👦' };
    pillsEl.innerHTML = CONFIG.APP.MEMBERS.map(m => {
      const has = (grouped[m] || []).length > 0;
      return `<span style="
        padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600;
        background:${has ? 'rgba(52,199,89,0.15)' : 'var(--surface-2)'};
        color:${has ? 'var(--green)' : 'var(--text-secondary)'};
        border:1px solid ${has ? 'rgba(52,199,89,0.3)' : 'transparent'};
      ">${memberEmojis[m]} ${m} ${has ? '✓' : ''}</span>`;
    }).join('');
  }

  // ── Refresh all dump UI ───────────────────────────────────
  async function refreshDumpUI() {
    await renderContributors();
    await renderMyUploads();
    updateDumpHeader();
    updateDumpSections();
  }

  function updateDumpHeader() {
    const weekLabel = document.getElementById('dump-week-label');
    const dateRange = document.getElementById('dump-date-range');
    const statusTxt = document.getElementById('dump-status-text');

    const weekNum = getISOWeekNumber(new Date());
    if (weekLabel) weekLabel.textContent = `Week ${weekNum}`;
    if (dateRange) dateRange.textContent = getWeekDateRange();

    if (statusTxt) {
      if (canUpload()) statusTxt.textContent = 'Upload window open • Closes Wednesday noon';
      else if (isRevealUnlocked()) statusTxt.textContent = 'Reveal unlocked! New uploads open Monday.';
      else statusTxt.textContent = 'Upload window closed until Monday';
    }
  }

  function updateDumpSections() {
    const uploadSec  = document.getElementById('dump-upload-section');
    const revealSec  = document.getElementById('dump-reveal-section');
    const lockedSec  = document.getElementById('dump-locked-section');

    if (canUpload()) {
      uploadSec?.classList.remove('hidden');
      revealSec?.classList.add('hidden');
      lockedSec?.classList.add('hidden');
    } else if (isRevealUnlocked()) {
      uploadSec?.classList.add('hidden');
      revealSec?.classList.remove('hidden');
      lockedSec?.classList.remove('hidden');
    } else {
      // Between Sunday and Monday (edge case)
      uploadSec?.classList.add('hidden');
      revealSec?.classList.add('hidden');
      lockedSec?.classList.remove('hidden');
    }
  }

  // ── Home stats ────────────────────────────────────────────
  async function refreshHomeStats() {
    const weekKey = App.getWeekKey();
    const all = await getWeekMedia(weekKey);
    document.getElementById('home-stat-photos').textContent = all.filter(m=>m.type==='photo').length;
    document.getElementById('home-stat-videos').textContent = all.filter(m=>m.type==='video').length;
    document.getElementById('home-stat-voices').textContent = all.filter(m=>m.type==='voice').length;
  }

  // ── Countdown timer ───────────────────────────────────────
  function startCountdown() {
    const el = document.getElementById('home-countdown-timer');
    if (!el) return;

    function tick() {
      if (isRevealUnlocked()) {
        // Switch home card to reveal state
        document.getElementById('home-countdown-state')?.classList.add('hidden');
        document.getElementById('home-reveal-state')?.classList.remove('hidden');
        clearInterval(countdownInterval);
        return;
      }
      el.textContent = formatTimeLeft(getTimeUntilReveal());
    }
    clearInterval(countdownInterval);
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function getISOWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  // ════════════════════════════════════════════════════════════
  //  REVEAL
  // ════════════════════════════════════════════════════════════

  let revealCards   = [];
  let currentCard   = 0;
  let revealTouchStartX = 0;

  async function startReveal() {
    // Guard: ignore accidental clicks within 800ms of the reveal becoming available
    // (prevents click-through from the auth screen transition on first login)
    if (Date.now() < revealEnabledAt) return;
    vibrate([10, 50, 10]);
    const overlay = document.getElementById('reveal-overlay');
    overlay.classList.remove('hidden');

    // Start music
    const weekKey = App.getWeekKey();
    const songFile = await Music.startReveal(weekKey);
    updateMusicUI(songFile);

    // Load all media for this week
    const allMedia = await getWeekMedia(weekKey);
    const grouped  = groupByMember(allMedia);

    // Build card data
    const cards = buildRevealCards(weekKey, allMedia, grouped);
    revealCards  = cards;
    currentCard  = 0;

    // Render
    buildRevealDOM(cards);
    buildProgressBar(cards.length);
    showCard(0);

    // Fade overlay in
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  function buildRevealCards(weekKey, allMedia, grouped) {
    const photos = allMedia.filter(m=>m.type==='photo').length;
    const videos = allMedia.filter(m=>m.type==='video').length;
    const voices = allMedia.filter(m=>m.type==='voice').length;
    const weekNum = getISOWeekNumber(new Date());
    const dateRange = getWeekDateRange();

    const cards = [
      { type: 'title',   weekNum, dateRange },
      { type: 'stats',   photos, videos, voices, total: allMedia.length },
    ];

    CONFIG.APP.MEMBERS.forEach((member, idx) => {
      const items = grouped[member] || [];
      if (items.length > 0) {
        cards.push({ type: 'member', member, items, memberIdx: idx % 4 });
      }
    });

    cards.push({ type: 'moment', weekKey, grouped });
    cards.push({ type: 'closing' });
    return cards;
  }

  function buildRevealDOM(cards) {
    const container = document.getElementById('reveal-cards-container');
    container.innerHTML = '';

    cards.forEach((card, idx) => {
      const div = document.createElement('div');
      div.className = `reveal-card ${getCardClass(card)}`;
      div.id = `reveal-card-${idx}`;
      div.innerHTML = buildCardHTML(card, idx);
      container.appendChild(div);
    });
  }

  function getCardClass(card) {
    if (card.type === 'title')   return 'card-title';
    if (card.type === 'stats')   return 'card-stats';
    if (card.type === 'member')  return `card-member-${card.memberIdx}`;
    if (card.type === 'moment')  return 'card-moment';
    if (card.type === 'closing') return 'card-closing';
    return '';
  }

  function buildCardHTML(card, idx) {
    if (card.type === 'title') {
      return `
        <div class="card-decoration">
          <span class="star" style="top:15%;left:10%;animation-delay:0s;">⭐</span>
          <span class="star" style="top:25%;right:12%;animation-delay:0.4s;">✨</span>
          <span class="star" style="bottom:30%;left:15%;animation-delay:0.8s;">💫</span>
        </div>
        <div class="reveal-eyebrow">Weekly Family Dump</div>
        <div class="reveal-headline">The Riley Family</div>
        <div class="reveal-headline" style="font-size:clamp(22px,5vw,36px);margin-top:6px;opacity:0.85;">Week ${card.weekNum}</div>
        <div class="reveal-sub">${card.dateRange}</div>
        <div style="margin-top:32px;font-size:32px;animation:bounceIn 0.7s var(--ease-spring) 0.7s both;">🏠❤️</div>`;
    }

    if (card.type === 'stats') {
      return `
        <div class="reveal-eyebrow">This week, your family shared</div>
        <div style="display:flex;flex-direction:column;gap:18px;width:100%;max-width:320px;margin:0 auto;">
          <div style="display:flex;align-items:center;gap:20px;animation:fadeUp 0.6s ease 0.2s both;">
            <span style="font-size:48px;">📷</span>
            <div>
              <div class="reveal-stat-number">${card.photos}</div>
              <div style="font-size:16px;color:rgba(255,255,255,0.7);font-weight:500;">photo${card.photos!==1?'s':''}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:20px;animation:fadeUp 0.6s ease 0.4s both;">
            <span style="font-size:48px;">🎥</span>
            <div>
              <div class="reveal-stat-number">${card.videos}</div>
              <div style="font-size:16px;color:rgba(255,255,255,0.7);font-weight:500;">video${card.videos!==1?'s':''}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:20px;animation:fadeUp 0.6s ease 0.6s both;">
            <span style="font-size:48px;">🎙️</span>
            <div>
              <div class="reveal-stat-number">${card.voices}</div>
              <div style="font-size:16px;color:rgba(255,255,255,0.7);font-weight:500;">voice recording${card.voices!==1?'s':''}</div>
            </div>
          </div>
        </div>`;
    }

    if (card.type === 'member') {
      const photos  = card.items.filter(m => m.type === 'photo');
      const videos  = card.items.filter(m => m.type === 'video');
      const voices  = card.items.filter(m => m.type === 'voice');
      const emojis  = { Dad: '👨', Mom: '👩', Maddox: '🧒', Dylan: '👦' };

      // Build media strip HTML
      let mediaHtml = '';
      const visuals = [...photos, ...videos].slice(0, 6);
      if (visuals.length > 0) {
        const thumbs = visuals.map(item => {
          const url = blobURL(item.data);
          if (item.type === 'photo') {
            return `<img class="reveal-thumb" src="${url}" loading="lazy" />`;
          } else {
            return `<video class="reveal-thumb" src="${url}" muted playsinline style="object-fit:cover;"></video>`;
          }
        }).join('');
        mediaHtml = `<div class="reveal-media-strip">${thumbs}</div>`;
      }

      return `
        <div class="reveal-emoji-big">${emojis[card.member] || '👤'}</div>
        <div class="reveal-member-name">${card.member}</div>
        ${mediaHtml}
        <div class="reveal-member-summary" id="reveal-summary-${idx}">
          <span class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:white;"></span>
          <span style="margin-left:8px;opacity:0.7;font-size:14px;">Generating summary…</span>
        </div>`;
    }

    if (card.type === 'moment') {
      return `
        <div class="reveal-emoji-big">🏆</div>
        <div class="reveal-eyebrow">Family Moment of the Week</div>
        <div class="reveal-headline" style="font-size:clamp(26px,6vw,40px);">The Standout Moment</div>
        <div class="reveal-member-summary" id="reveal-moment-text" style="margin-top:20px;">
          <span class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:white;"></span>
          <span style="margin-left:8px;opacity:0.7;font-size:14px;">Picking this week's moment…</span>
        </div>`;
    }

    if (card.type === 'closing') {
      return `
        <div class="reveal-emoji-big" style="font-size:80px;">💙</div>
        <div class="reveal-headline">See you next week</div>
        <div class="reveal-sub">The Riley Family</div>
        <div style="margin-top:40px;font-size:15px;color:rgba(255,255,255,0.6);animation:fadeUp 0.6s ease 0.8s both;">
          New dump opens Monday ✨
        </div>`;
    }

    return '';
  }

  function buildProgressBar(count) {
    const prog = document.getElementById('reveal-progress');
    if (!prog) return;
    prog.innerHTML = Array.from({ length: count }, (_, i) =>
      `<div class="progress-segment pending" id="prog-${i}"><div class="progress-segment-fill"></div></div>`
    ).join('');
  }

  function updateProgressBar(idx) {
    revealCards.forEach((_, i) => {
      const seg = document.getElementById(`prog-${i}`);
      if (!seg) return;
      seg.className = 'progress-segment ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
      seg.innerHTML = '<div class="progress-segment-fill"></div>';
    });
  }

  async function showCard(idx) {
    const prev = document.getElementById(`reveal-card-${currentCard}`);
    const next = document.getElementById(`reveal-card-${idx}`);
    if (!next) return;

    if (prev && prev !== next) {
      prev.classList.remove('active');
      prev.classList.add('exit');
      setTimeout(() => prev.classList.remove('exit'), 450);
    }

    next.classList.add('active');
    currentCard = idx;
    updateProgressBar(idx);

    // Generate AI content if needed
    const card = revealCards[idx];
    const weekKey = App.getWeekKey();

    if (card.type === 'member') {
      generateMemberSummaryForCard(card, idx, weekKey);
    }
    if (card.type === 'moment') {
      const grouped = {};
      revealCards.filter(c => c.type === 'member').forEach(c => { grouped[c.member] = c.items; });
      generateMomentCard(weekKey, grouped, idx);
    }
    if (card.type === 'closing') {
      // Fade music out
      setTimeout(() => Music.stopReveal(), 3000);
    }

    vibrate(8);
  }

  async function generateMemberSummaryForCard(card, cardIdx, weekKey) {
    const el = document.getElementById(`reveal-summary-${cardIdx}`);
    if (!el) return;
    try {
      const result = await AI.generateMemberSummary(weekKey, card.member, card.items);
      el.innerHTML = result.summary || 'Had a great week! 🌟';
    } catch (e) {
      el.innerHTML = e.message.includes('not configured')
        ? `<em style="opacity:0.6;font-size:13px;">Add Anthropic API key to config.js for AI summaries</em>`
        : `Had an amazing week with the family! 🌟`;
    }
  }

  async function generateMomentCard(weekKey, grouped, cardIdx) {
    const el = document.getElementById('reveal-moment-text');
    if (!el) return;
    try {
      const result = await AI.pickFamilyMoment(weekKey, grouped);
      el.innerHTML = result.explanation || 'A wonderful week of family memories 💙';
    } catch (e) {
      el.innerHTML = 'Another beautiful week of memories shared by the Riley family. 💙';
    }
  }

  function advanceCard() {
    if (currentCard < revealCards.length - 1) {
      showCard(currentCard + 1);
    }
  }

  function closeReveal() {
    const overlay = document.getElementById('reveal-overlay');
    overlay.classList.remove('visible');
    Music.stopReveal();
    setTimeout(() => overlay.classList.add('hidden'), 400);
  }

  function updateMusicUI(songFile) {
    const nameEl = document.getElementById('music-name-display');
    const muteBtn = document.getElementById('mute-toggle-btn');
    const ctrl = document.getElementById('reveal-music-ctrl');

    if (!songFile) {
      ctrl?.classList.add('hidden');
      return;
    }
    ctrl?.classList.remove('hidden');
    if (nameEl) nameEl.textContent = Music.getDisplayName(songFile);
    if (muteBtn) {
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const muted = Music.toggleMute();
        muteBtn.textContent = muted ? '🔇' : '🔊';
        vibrate(6);
      });
    }
  }

  function wireRevealInteractions() {
    const overlay = document.getElementById('reveal-overlay');
    const closeBtn = document.getElementById('reveal-close-btn');

    // Tap to advance
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('#reveal-close-btn')) return;
      if (e.target.closest('#reveal-music-ctrl')) return;
      if (e.target.tagName === 'AUDIO') return;
      advanceCard();
    });

    // Swipe support
    overlay.addEventListener('touchstart', (e) => {
      revealTouchStartX = e.touches[0].clientX;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - revealTouchStartX;
      if (dx < -50) advanceCard();               // swipe left = next
      if (dx > 80 && currentCard > 0) showCard(currentCard - 1); // swipe right = back
    }, { passive: true });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeReveal();
    });
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await openDB();
    await refreshDumpUI();
    startCountdown();
    wireRevealInteractions();
    await refreshHomeStats();

    // Update home card state
    if (isRevealUnlocked()) {
      document.getElementById('home-countdown-state')?.classList.add('hidden');
      document.getElementById('home-reveal-state')?.classList.remove('hidden');
    }

    // Wire upload buttons
    document.getElementById('upload-photo-btn')?.addEventListener('click', () => {
      document.getElementById('photo-input')?.click();
    });
    document.getElementById('upload-video-btn')?.addEventListener('click', () => {
      document.getElementById('video-input')?.click();
    });
    document.getElementById('upload-voice-btn')?.addEventListener('click', () => {
      if (isRecording) { stopRecording(); }
      else { startRecording(); }
    });

    document.getElementById('photo-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        await saveMediaItem(file, 'photo', file.name, file.type);
      }
      e.target.value = '';
    });

    document.getElementById('video-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        await saveMediaItem(file, 'video', file.name, file.type);
      }
      e.target.value = '';
    });

    // Start reveal buttons — with an 800ms guard to prevent click-through from auth transition
    revealEnabledAt = Date.now() + 800;
    ['dump-start-reveal-btn', 'home-start-reveal-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => startReveal());
    });

    // Storage warning
    checkStorageUsage();
  }

  async function checkStorageUsage() {
    if (!navigator.storage?.estimate) return;
    const { usage, quota } = await navigator.storage.estimate();
    const usedMB = (usage / 1024 / 1024).toFixed(0);
    const limitMB = CONFIG.STORAGE.WARN_MB;
    if (usage > limitMB * 1024 * 1024) {
      console.warn(`Storage usage: ${usedMB}MB — consider clearing old weeks.`);
    }
  }

  // ── Public API ────────────────────────────────────────────
  function enableReveal() { revealEnabledAt = 0; }

  return {
    init,
    startReveal,
    enableReveal,
    refreshDumpUI,
    refreshHomeStats,
    isRevealUnlocked,
    canUpload,
    getWeekDateRange,
  };

})();
