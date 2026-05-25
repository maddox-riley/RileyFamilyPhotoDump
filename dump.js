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

  // Media viewer state (shared between reveal carousel and My Uploads)
  let mediaViewerVisuals  = [];
  let mediaViewerItemIdx  = 0;
  let myUploadsVisuals    = [];

  // Auto-clear state (media clears 24 h after reveal is first opened)
  let autoClearTimeout           = null;
  let revealOpenedMarkedForWeek  = null; // prevents re-marking within the same session

  // ── Timing helpers ────────────────────────────────────────
  function canUpload() {
    const now = new Date();
    const day = now.getDay();
    const h   = now.getHours();
    // Mon (1) or Tue (2) anytime, or Wed (3) before noon
    return day === 1 || day === 2 || (day === 3 && h < 12);
  }

  function getRevealTime() {
    const weekStart = App.getWeekKey(); // e.g. "2026-04-28"
    // Default: weekStart + 7 days at midnight
    const revealDate = new Date(weekStart + 'T00:00:00');
    revealDate.setDate(revealDate.getDate() + 7);

    // Apply custom reveal hour / minute if set via dev modal
    try {
      const raw = localStorage.getItem('riley_sync_config__revealTime');
      if (raw) {
        const val = JSON.parse(raw);
        if (val && typeof val.hour === 'number' && typeof val.minute === 'number') {
          revealDate.setHours(val.hour, val.minute, 0, 0);
        }
      }
    } catch {}

    return revealDate.getTime();
  }

  function isRevealUnlocked() {
    // Check if dev force-unlocked for all devices via Sync
    const forced = localStorage.getItem('riley_sync_config__revealForced');
    if (forced) { try { if (JSON.parse(forced) === true) return true; } catch {} }
    return Date.now() >= getRevealTime();
  }

  function getTimeUntilReveal() {
    return Math.max(0, getRevealTime() - Date.now());
  }

  function formatTimeLeft(ms) {
    if (ms <= 0) return '0d 00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const d  = Math.floor(totalSec / 86400);
    const hh = Math.floor((totalSec % 86400) / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    const time = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${d}d ${time}`;
  }

  function getWeekDateRange() {
    const weekStart = App.getWeekKey(); // ISO date e.g. "2026-04-28"
    const start = new Date(weekStart + 'T00:00:00');
    const end   = new Date(start);
    end.setDate(start.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
  }

  // ── Save media to IndexedDB (+ Firebase Storage if configured) ──
  async function saveMediaItem(blob, type, filename, mimeType) {
    await openDB();
    const weekKey  = App.getWeekKey();
    const uploader = App.getCurrentMember();

    // Block duplicate uploads: same uploader + same filename this week
    if (filename) {
      const existing = await getWeekMedia(weekKey);
      if (existing.some(m => m.uploader === uploader && m.filename === filename)) {
        console.warn('Duplicate upload skipped:', filename);
        return;
      }
    }
    // Unique key so other devices can deduplicate on sync
    const localKey = `${uploader}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const item = {
      weekKey, uploader, type, localKey,
      data: blob,
      filename: filename || `${type}-${Date.now()}`,
      mimeType: mimeType || blob.type,
      timestamp: Date.now(),
    };
    // Capture the auto-generated id so we can update the record later
    const itemId = await idbPut(STORE_MEDIA, item);
    item.id = itemId;
    vibrate(10);

    // Upload to Cloudinary + write metadata to Firebase so all other devices get it
    if (window.Sync && Sync.isConfigured() && Sync.isMediaConfigured()) {
      (async () => {
        try {
          const downloadURL = await Sync.uploadMedia(blob);
          await Sync.set(`media/${weekKey}/${localKey}`, {
            uploader, type, localKey, downloadURL,
            filename: item.filename,
            mimeType: item.mimeType,
            timestamp: item.timestamp,
          });
          // Update local idb record with downloadURL so AI can use it directly
          item.downloadURL = downloadURL;
          await idbPut(STORE_MEDIA, item);
          console.log('Media synced ✓', localKey);
        } catch (e) {
          console.warn('Media sync upload failed:', e);
          if (window.Tracker) Tracker.showInAppAlert(
            '⚠️ Sync failed',
            e.message || 'Could not upload to cloud. Check Cloudinary preset name and Firebase rules.'
          );
        }
      })();
    } else if (window.Sync && !Sync.isConfigured()) {
      console.warn('Sync skipped — Firebase not configured');
    } else if (window.Sync && !Sync.isMediaConfigured()) {
      console.warn('Sync skipped — Cloudinary not configured');
    }

    await refreshDumpUI();
    await refreshHomeStats();
  }

  // ── Get all media for week (deduplicated) ────────────────
  async function getWeekMedia(weekKey) {
    await openDB();
    const items = await idbGetAllByIndex(STORE_MEDIA, 'weekKey', weekKey);
    // Deduplicate by localKey (same idb record stored twice)
    // AND by uploader+filename (same photo selected twice from camera roll)
    const seenKeys      = new Set();
    const seenFilenames = new Set();
    return items.filter(item => {
      if (item.localKey) {
        if (seenKeys.has(item.localKey)) return false;
        seenKeys.add(item.localKey);
      }
      if (item.filename && item.uploader) {
        const fk = `${item.uploader}::${item.filename}`;
        if (seenFilenames.has(fk)) return false;
        seenFilenames.add(fk);
      }
      return true;
    });
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
      const allVisuals = [...photos, ...videos];
      myUploadsVisuals = allVisuals;
      html += `<div class="media-grid">`;
      allVisuals.forEach((item, i) => {
        const url = item._blobURL || (item._blobURL = blobURL(item.data));
        if (item.type === 'photo') {
          html += `<div class="media-thumb" data-upload-idx="${i}"><img src="${url}" loading="lazy" /><span class="media-type-badge">📷</span></div>`;
        } else {
          html += `<div class="media-thumb" data-upload-idx="${i}">
            <video src="${url}" muted playsinline preload="metadata"></video>
            <span class="media-type-badge">🎥</span>
            <div class="play-overlay-sm">▶</div>
          </div>`;
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

    // Wire tap-to-view on all media thumbs (photos and videos)
    content.querySelectorAll('[data-upload-idx]').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const idx = parseInt(thumb.dataset.uploadIdx, 10);
        openMediaViewer(myUploadsVisuals, idx);
      });
    });
  }

  // ── Render contributors ───────────────────────────────────
  async function renderContributors() {
    const weekKey = App.getWeekKey();
    const all     = await getWeekMedia(weekKey);
    const grouped = groupByMember(all);
    const list    = document.getElementById('contributors-list');
    if (!list) return;

    const memberEmojis = { Dad: '👨', Mom: '👩', Maddox: '👦', Dylan: '👧' };
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
    const memberEmojis = { Dad: '👨', Mom: '👩', Maddox: '👦', Dylan: '👧' };
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
      if (isRevealUnlocked()) statusTxt.textContent = 'Reveal ready • Keep uploading for next week!';
      else {
        // Build a human-readable reveal time label
        const revealMs = getRevealTime();
        const revealDt = new Date(revealMs);
        const dayName  = revealDt.toLocaleDateString('en-US', { weekday: 'short' });
        const timePart = revealDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        statusTxt.textContent = `Uploading for Week ${weekNum} • Reveal ${dayName} ${timePart}`;
      }
    }
  }

  function updateDumpSections() {
    const uploadSec = document.getElementById('dump-upload-section');
    const revealSec = document.getElementById('dump-reveal-section');

    // Always show uploads
    uploadSec?.classList.remove('hidden');

    // Show reveal button only after Wednesday noon
    if (isRevealUnlocked()) {
      revealSec?.classList.remove('hidden');
    } else {
      revealSec?.classList.add('hidden');
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
        document.getElementById('home-countdown-state')?.classList.add('hidden');
        document.getElementById('home-reveal-state')?.classList.remove('hidden');
        clearInterval(countdownInterval);
        updateDumpSections();
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
    if (Date.now() < revealEnabledAt) return;

    const weekKey = App.getWeekKey();
    const allMedia = await getWeekMedia(weekKey);
    const grouped  = groupByMember(allMedia);

    // ── Pre-generate all AI summaries before opening ──────────
    // This way every card shows its summary instantly — no spinners during the reveal.
    if (window.AI) {
      const hasMembersWithMedia = CONFIG.APP.MEMBERS.some(m => (grouped[m] || []).length > 0);
      if (hasMembersWithMedia) {
        // Show loading state on whichever reveal buttons are visible
        const revealBtns = ['home-start-reveal-btn', 'dump-start-reveal-btn']
          .map(id => document.getElementById(id)).filter(Boolean);

        revealBtns.forEach(btn => {
          btn.dataset.origHtml = btn.innerHTML;
          btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;border-color:rgba(255,255,255,0.3);border-top-color:white;"></span> Preparing reveal…';
          btn.style.pointerEvents = 'none';
          btn.style.opacity = '0.8';
        });

        const membersWithMedia = CONFIG.APP.MEMBERS.filter(m => (grouped[m] || []).length > 0);
        const total = membersWithMedia.length + 1;

        await AI.generateAllSummaries(weekKey, grouped, (done, _total) => {
          revealBtns.forEach(btn => {
            btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;border-color:rgba(255,255,255,0.3);border-top-color:white;"></span> Preparing… ${done}/${total}`;
          });
        });

        revealBtns.forEach(btn => {
          btn.innerHTML = btn.dataset.origHtml || '🎬 Start the Weekly Reveal';
          btn.style.pointerEvents = '';
          btn.style.opacity = '';
        });
      }
    }

    vibrate([10, 50, 10]);
    const overlay = document.getElementById('reveal-overlay');
    overlay.classList.remove('hidden');

    // Start music
    const songFile = await Music.startReveal(weekKey);
    updateMusicUI(songFile);

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

    // Record first-open timestamp so all devices auto-clear 24 h later
    markRevealOpened(weekKey);
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
        const photos  = items.filter(m => m.type === 'photo');
        const videos  = items.filter(m => m.type === 'video');
        const visuals = [...photos, ...videos];
        // Pre-create and cache blob URLs so carousel + viewer share the same URL objects
        visuals.forEach(v => { if (!v._blobURL && v.data instanceof Blob) v._blobURL = URL.createObjectURL(v.data); });
        cards.push({ type: 'member', member, items, memberIdx: idx % 4, visuals });
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

      // Wire carousel interactions for member cards
      if (card.type === 'member' && card.visuals && card.visuals.length > 0) {
        const carousel = div.querySelector('.media-carousel');
        if (carousel) {
          // Prevent carousel touch from triggering card-level swipe navigation
          carousel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
          carousel.addEventListener('touchend',   (e) => e.stopPropagation(), { passive: true });
          carousel.addEventListener('click',      (e) => e.stopPropagation());
        }
        // Tap item → open media viewer
        div.querySelectorAll('.carousel-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            openMediaViewer(card.visuals, parseInt(item.dataset.itemidx, 10));
          });
        });
      }
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
      const emojis  = { Dad: '👨', Mom: '👩', Maddox: '👦', Dylan: '👧' };
      const visuals = card.visuals || [...photos, ...videos];

      // Build swipeable carousel showing ALL visuals
      let mediaHtml = '';
      if (visuals.length > 0) {
        const thumbs = visuals.map((item, i) => {
          const url = item._blobURL || blobURL(item.data);
          if (!item._blobURL) item._blobURL = url;
          if (item.type === 'photo') {
            return `<div class="carousel-item" data-itemidx="${i}">
              <img class="carousel-thumb" src="${url}" loading="lazy" />
            </div>`;
          } else {
            return `<div class="carousel-item" data-itemidx="${i}">
              <video class="carousel-thumb" src="${url}" muted playsinline preload="metadata"></video>
              <div class="play-overlay">▶</div>
            </div>`;
          }
        }).join('');

        const label = [
          photos.length > 0 ? `${photos.length} photo${photos.length !== 1 ? 's' : ''}` : '',
          videos.length > 0 ? `${videos.length} video${videos.length !== 1 ? 's' : ''}` : '',
        ].filter(Boolean).join(' & ');

        mediaHtml = `
          <div class="media-carousel">
            <div class="carousel-scroll">${thumbs}</div>
            <div class="carousel-counter">📸 ${label} · tap to view full size</div>
          </div>`;
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
      el.innerHTML = result?.summary || `${card.member} had a great week! 🌟`;
    } catch (e) {
      console.error(`Summary error for ${card.member}:`, e.message);
      if (e.message.includes('not configured')) {
        el.innerHTML = `<em style="opacity:0.6;font-size:13px;">OpenAI key not set — enter it via the dev menu (long-press title).</em>`;
      } else {
        // Show actual error so it's visible during debugging
        el.innerHTML = `<em style="opacity:0.6;font-size:12px;">⚠️ ${e.message}</em>`;
      }
    }
  }

  async function generateMomentCard(weekKey, grouped, cardIdx) {
    const el = document.getElementById('reveal-moment-text');
    if (!el) return;
    try {
      const result = await AI.pickFamilyMoment(weekKey, grouped);
      el.innerHTML = result?.explanation || 'A week full of real moments from the people who matter most. 💙';
    } catch (e) {
      console.error('Moment card error:', e.message);
      el.innerHTML = e.message.includes('not configured')
        ? `<em style="opacity:0.6;font-size:12px;">OpenAI key not set.</em>`
        : `<em style="opacity:0.6;font-size:12px;">⚠️ ${e.message}</em>`;
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

  // ── Media viewer (full-screen photo / video viewer) ───────

  function openMediaViewer(visuals, startIdx = 0) {
    mediaViewerVisuals = visuals;
    mediaViewerItemIdx = startIdx;
    renderMediaViewerItem();
    document.getElementById('media-viewer')?.classList.remove('hidden');
    vibrate(6);
  }

  function renderMediaViewerItem() {
    const item = mediaViewerVisuals[mediaViewerItemIdx];
    if (!item) return;

    const content = document.getElementById('media-viewer-content');
    const counter = document.getElementById('media-viewer-counter');
    const prev    = document.getElementById('media-viewer-prev');
    const next    = document.getElementById('media-viewer-next');

    if (content) {
      // Pause any previous video
      content.querySelector('video')?.pause();
      const url = item._blobURL || (item._blobURL = blobURL(item.data));
      if (item.type === 'photo') {
        content.innerHTML = `<img src="${url}" alt="Photo" />`;
      } else {
        content.innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
      }
    }

    if (counter) {
      if (mediaViewerVisuals.length > 1) {
        counter.textContent = `${mediaViewerItemIdx + 1} / ${mediaViewerVisuals.length}`;
        counter.style.display = '';
      } else {
        counter.style.display = 'none';
      }
    }

    if (prev) prev.style.display = mediaViewerItemIdx > 0 ? '' : 'none';
    if (next) next.style.display = mediaViewerItemIdx < mediaViewerVisuals.length - 1 ? '' : 'none';
  }

  function closeMediaViewer() {
    const viewer = document.getElementById('media-viewer');
    if (!viewer) return;
    // Stop any playing video before hiding
    viewer.querySelector('video')?.pause();
    document.getElementById('media-viewer-content').innerHTML = '';
    viewer.classList.add('hidden');
  }

  function wireMediaViewer() {
    const viewer = document.getElementById('media-viewer');
    if (!viewer) return;

    document.getElementById('media-viewer-close')?.addEventListener('click', closeMediaViewer);
    // Tap the backdrop (not the content) to close
    viewer.addEventListener('click', (e) => {
      if (e.target === viewer || e.target.id === 'media-viewer-bg') closeMediaViewer();
    });

    document.getElementById('media-viewer-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaViewerItemIdx > 0) { mediaViewerItemIdx--; renderMediaViewerItem(); vibrate(6); }
    });
    document.getElementById('media-viewer-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mediaViewerItemIdx < mediaViewerVisuals.length - 1) { mediaViewerItemIdx++; renderMediaViewerItem(); vibrate(6); }
    });

    // Swipe left/right within the viewer
    let tvStartX = 0;
    viewer.addEventListener('touchstart', (e) => { tvStartX = e.touches[0].clientX; }, { passive: true });
    viewer.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - tvStartX;
      if (Math.abs(dx) < 40) return;
      if (dx < 0 && mediaViewerItemIdx < mediaViewerVisuals.length - 1) { mediaViewerItemIdx++; renderMediaViewerItem(); vibrate(6); }
      else if (dx > 0 && mediaViewerItemIdx > 0) { mediaViewerItemIdx--; renderMediaViewerItem(); vibrate(6); }
    }, { passive: true });
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
    let didSwipe = false;

    // ── Tap: left half = back, right half = forward (Instagram Stories) ──
    overlay.addEventListener('click', (e) => {
      if (didSwipe) { didSwipe = false; return; } // swipe already handled it
      if (e.target.closest('#reveal-close-btn')) return;
      if (e.target.closest('#reveal-music-ctrl')) return;
      if (e.target.tagName === 'AUDIO') return;

      const leftHalf = e.clientX < window.innerWidth / 2;
      if (leftHalf && currentCard > 0) {
        showCard(currentCard - 1);
      } else {
        advanceCard();
      }
    });

    // ── Swipe support ─────────────────────────────────────────
    overlay.addEventListener('touchstart', (e) => {
      revealTouchStartX = e.touches[0].clientX;
      didSwipe = false;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - revealTouchStartX;
      if (Math.abs(dx) > 50) {
        didSwipe = true; // suppress the subsequent click
        if (dx < 0) advanceCard();                              // swipe left  → next
        else if (currentCard > 0) showCard(currentCard - 1);   // swipe right → back
      }
    }, { passive: true });

    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeReveal();
    });
  }

  // ── Sync media from Cloudinary (pull items uploaded on other devices) ──
  function subscribeMediaSync(weekKey) {
    if (!window.Sync || !Sync.isConfigured() || !Sync.isMediaConfigured()) return;

    Sync.subscribe(`media/${weekKey}`, async (allRemote) => {
      if (!allRemote) return;
      await openDB();
      const existing = await getWeekMedia(weekKey);

      // Build a map by localKey so we can look up existing items quickly
      const byLocalKey = {};
      existing.forEach(m => { if (m.localKey) byLocalKey[m.localKey] = m; });

      let added = 0;
      for (const meta of Object.values(allRemote)) {
        if (!meta?.localKey || !meta?.downloadURL) continue;

        const existingItem = byLocalKey[meta.localKey];

        if (existingItem) {
          // Item already in IndexedDB — backfill downloadURL if missing
          // (items synced before the downloadURL fix won't have it)
          if (!existingItem.downloadURL) {
            existingItem.downloadURL = meta.downloadURL;
            await idbPut(STORE_MEDIA, existingItem);
          }
          continue;
        }

        // Brand new item — download blob from Cloudinary and store
        try {
          const resp = await fetch(meta.downloadURL);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          await idbPut(STORE_MEDIA, {
            weekKey,
            uploader:    meta.uploader,
            type:        meta.type,
            localKey:    meta.localKey,
            data:        blob,
            downloadURL: meta.downloadURL,
            filename:    meta.filename,
            mimeType:    meta.mimeType,
            timestamp:   meta.timestamp,
          });
          byLocalKey[meta.localKey] = { localKey: meta.localKey };
          added++;
        } catch (e) {
          console.warn('Media sync: failed to download item', meta.localKey, e);
        }
      }
      if (added > 0) {
        await refreshDumpUI();
        await refreshHomeStats();
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    await openDB();
    const weekKey = App.getWeekKey();

    // Subscribe to cross-device media sync for this week
    subscribeMediaSync(weekKey);

    // Subscribe to clear-media signal from dev modal
    if (window.Sync && Sync.isConfigured()) {
      Sync.subscribe('config/clearMedia', async (data) => {
        if (!data?.weekKey || data.weekKey !== weekKey) return;
        // Avoid re-processing the same clear event
        const processedKey = `riley_clearMedia_${data.weekKey}`;
        const lastCleared = parseInt(localStorage.getItem(processedKey) || '0');
        if (data.clearedAt <= lastCleared) return;
        localStorage.setItem(processedKey, String(data.clearedAt));
        await clearWeekMediaLocal(data.weekKey);
      });

      // Subscribe to reveal-opened timestamp → schedules 24 h auto-clear on every device.
      // Firebase fires the callback immediately with the current value on subscribe,
      // so this also catches the case where the device was offline when the reveal opened.
      Sync.subscribe('config/revealOpenedAt', (data) => {
        scheduleAutoClear(data);
      });
    }

    await refreshDumpUI();
    startCountdown();
    wireRevealInteractions();
    wireMediaViewer();
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

  // ── Developer utilities ───────────────────────────────────

  // Clear media locally on this device only
  async function clearWeekMediaLocal(weekKey) {
    await openDB();
    const items = await idbGetAllByIndex(STORE_MEDIA, 'weekKey', weekKey);
    for (const item of items) {
      await idbDelete(STORE_MEDIA, item.id);
    }
    await refreshDumpUI();
    await refreshHomeStats();
  }

  // Clear media on ALL devices by writing a signal to Firebase.
  // Pass weekKeyOverride to clear a specific week (e.g. from auto-clear after 24 h).
  async function clearWeekMedia(weekKeyOverride) {
    const weekKey = weekKeyOverride || App.getWeekKey();
    await clearWeekMediaLocal(weekKey);
    // Signal all other devices to clear too
    if (window.Sync && Sync.isConfigured()) {
      await Sync.set('config/clearMedia', { weekKey, clearedAt: Date.now() });
    }
    // Also clear AI summary cache for this week
    if (window.AI) AI.clearWeekCache(weekKey);
  }

  // ── Auto-clear: media deletes itself 24 h after reveal first opens ──

  // Called by startReveal(). Writes a first-open timestamp to Firebase once
  // per week so every device can schedule its own 24 h countdown.
  async function markRevealOpened(weekKey) {
    if (revealOpenedMarkedForWeek === weekKey) return; // already handled this session
    revealOpenedMarkedForWeek = weekKey;

    if (!window.Sync || !Sync.isConfigured()) return;
    try {
      // Only write if this week hasn't been marked yet — first device wins
      const existing = await Sync.get('config/revealOpenedAt');
      if (existing && existing.weekKey === weekKey) return;
      await Sync.set('config/revealOpenedAt', { weekKey, openedAt: Date.now() });
    } catch (e) {
      console.warn('markRevealOpened failed:', e);
    }
  }

  // Called by the revealOpenedAt subscription (fires immediately on subscribe +
  // on every update). Schedules or fires the clear at the right moment.
  function scheduleAutoClear(data) {
    if (!data || !data.weekKey || !data.openedAt) return;

    // Only act on the reveal week that matches the current dump week
    if (data.weekKey !== App.getWeekKey()) return;

    // Skip if already cleared this week on this device
    if (localStorage.getItem(`riley_autoClear_${data.weekKey}`)) return;

    const AUTO_CLEAR_DELAY = 24 * 60 * 60 * 1000; // 24 hours
    const elapsed   = Date.now() - data.openedAt;
    const remaining = AUTO_CLEAR_DELAY - elapsed;

    clearTimeout(autoClearTimeout);

    if (remaining <= 0) {
      handleAutoClear(data.weekKey);
    } else {
      const hrs = (remaining / 3600000).toFixed(1);
      console.log(`Auto-clear scheduled in ${hrs} h`);
      autoClearTimeout = setTimeout(() => handleAutoClear(data.weekKey), remaining);
    }
  }

  async function handleAutoClear(weekKey) {
    const processedKey = `riley_autoClear_${weekKey}`;
    if (localStorage.getItem(processedKey)) return; // prevent double-fire
    localStorage.setItem(processedKey, Date.now().toString());

    console.log('Auto-clearing media — 24 h since recap opened.');
    try {
      await clearWeekMedia(weekKey);
    } catch (e) {
      console.warn('Auto-clear failed:', e);
    }

    if (window.Tracker) {
      Tracker.showInAppAlert('Recap expired 🗑️', 'This week\'s photos have been cleared. New uploads open Monday!');
    }
  }

  function forceReveal() {
    revealEnabledAt = 0;
    // Sync the force flag so all devices show the reveal button
    if (window.Sync) Sync.set('config/revealForced', true);
    updateDumpSections();
    startReveal();
  }

  function refreshScheduleUI() {
    updateDumpHeader();
    updateDumpSections();
    startCountdown();
    // Re-check home state
    if (isRevealUnlocked()) {
      document.getElementById('home-countdown-state')?.classList.add('hidden');
      document.getElementById('home-reveal-state')?.classList.remove('hidden');
    } else {
      document.getElementById('home-countdown-state')?.classList.remove('hidden');
      document.getElementById('home-reveal-state')?.classList.add('hidden');
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
    clearWeekMedia,
    forceReveal,
    refreshScheduleUI,
  };

})();
