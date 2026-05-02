// ============================================================
// Riley Family — Core App Module
// Handles auth, routing, tab navigation, and init
// ============================================================

window.App = (() => {

  const LS_MEMBER_KEY = 'riley_current_member';
  let currentMember   = null;
  let activeTab       = 'home';

  // ── Week key (Monday date as YYYY-MM-DD) ──────────────────
  function getWeekKey() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const mon = new Date(now);
    mon.setDate(diff);
    mon.setHours(0, 0, 0, 0);
    return mon.toISOString().split('T')[0];
  }

  // ── Member management ─────────────────────────────────────
  function getCurrentMember() { return currentMember; }

  function setMember(name) {
    currentMember = name;
    localStorage.setItem(LS_MEMBER_KEY, name);
    updateHeaderUser(name);
    closeSettings();
    if (document.getElementById('screen-auth').classList.contains('active')) {
      showMainApp();
    }
    // Re-apply member-specific UI (Dad controls, etc.)
    if (window.Tracker) Tracker.applyDadMode();
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  }

  function getSavedMember() {
    return localStorage.getItem(LS_MEMBER_KEY);
  }

  function logout() {
    localStorage.removeItem(LS_MEMBER_KEY);
    currentMember = null;
    showAuth();
  }

  // ── Header ────────────────────────────────────────────────
  function updateHeaderUser(name) {
    const nameEl    = document.getElementById('header-user-name');
    const initEl    = document.getElementById('user-avatar-initials');
    const greetName = document.getElementById('greeting-name');

    if (nameEl)  nameEl.textContent  = name;
    if (initEl)  initEl.textContent  = name ? name[0].toUpperCase() : '?';

    const hour = new Date().getHours();
    const tod  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    document.getElementById('greeting-time').textContent = tod;
    if (greetName) greetName.textContent = `${tod}, ${name}! 👋`;
  }

  function updateGreetingDate() {
    const el = document.getElementById('greeting-date');
    if (!el) return;
    const now  = new Date();
    const opts = { weekday: 'long', month: 'long', day: 'numeric' };
    el.textContent = now.toLocaleDateString('en-US', opts);

    // Also update home dump week label
    const wl = document.getElementById('home-dump-week-label');
    if (wl) {
      const wn = getISOWeekNumber(now);
      wl.textContent = `Week ${wn}`;
    }
  }

  function getISOWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  // ── Screen transitions ────────────────────────────────────
  function showAuth() {
    document.getElementById('screen-auth').classList.add('active');
    document.getElementById('screen-main').classList.remove('active');
  }

  function showMainApp() {
    const auth = document.getElementById('screen-auth');
    const main = document.getElementById('screen-main');
    auth.classList.remove('active');
    updateGreetingDate();
    // rAF ensures auth fade-out paints before main fades in
    requestAnimationFrame(() => {
      main.classList.add('active');
      // Allow reveal after transition completes
      setTimeout(() => { if (window.Dump) Dump.enableReveal(); }, 600);
    });
  }

  // ── Tab navigation ────────────────────────────────────────
  function navigate(tabId) {
    if (activeTab === tabId) return;
    activeTab = tabId;

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tabId}`)?.classList.add('active');

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });

    if (navigator.vibrate) navigator.vibrate(6);
  }

  // ── Settings modal ────────────────────────────────────────
  function openSettings() {
    const modal = document.getElementById('settings-modal');
    const grid  = document.getElementById('settings-member-grid');
    if (!modal || !grid) return;

    const memberEmojis = { Dad: '👨', Mom: '👩', Maddox: '🧒', Dylan: '👦' };
    const colors = { Dad: '#007AFF', Mom: '#FF2D55', Maddox: '#34C759', Dylan: '#AF52DE' };

    grid.innerHTML = CONFIG.APP.MEMBERS.map(name => `
      <button class="settings-member-btn ${name === currentMember ? 'current' : ''}"
              data-member="${name}">
        <span style="font-size:22px;">${memberEmojis[name] || '👤'}</span>
        <span>${name}</span>
        ${name === currentMember ? '<span style="margin-left:auto;font-size:12px;color:var(--blue);">✓ You</span>' : ''}
      </button>
    `).join('');

    grid.querySelectorAll('.settings-member-btn').forEach(btn => {
      btn.addEventListener('click', () => setMember(btn.dataset.member));
    });

    modal.classList.remove('hidden');
  }

  function closeSettings() {
    document.getElementById('settings-modal')?.classList.add('hidden');
  }

  // ── PWA Service Worker ────────────────────────────────────
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW registered:', reg.scope);
      }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ── PWA "Add to Home Screen" prompt ──────────────────────
  let installPromptEvent = null;

  function listenForInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      installPromptEvent = e;
      // Could show a subtle "Add to Home Screen" button here
    });
  }

  // ── URL tab routing ───────────────────────────────────────
  function applyURLRouting() {
    const params = new URLSearchParams(window.location.search);
    const tab    = params.get('tab');
    if (tab && ['home', 'dump', 'dad'].includes(tab)) {
      navigate(tab);
    }
  }

  // ── Developer modal ───────────────────────────────────────
  function openDevModal() {
    const modal = document.getElementById('dev-modal');
    if (!modal) return;
    const revealDay  = document.getElementById('dev-reveal-day');
    const revealHour = document.getElementById('dev-reveal-hour');
    if (revealDay)  revealDay.value  = CONFIG.APP.REVEAL_DAY;
    if (revealHour) revealHour.value = CONFIG.APP.REVEAL_HOUR;
    modal.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([10, 50, 10, 50, 10]);
  }

  function closeDevModal() {
    document.getElementById('dev-modal')?.classList.add('hidden');
  }

  function wireDevModal() {
    document.getElementById('dev-backdrop')?.addEventListener('click', closeDevModal);
    document.getElementById('dev-close-btn')?.addEventListener('click', closeDevModal);

    document.getElementById('dev-clear-media-btn')?.addEventListener('click', async () => {
      if (!confirm('Clear all media for this week? This cannot be undone on this device.')) return;
      await Dump.clearWeekMedia();
      closeDevModal();
      Tracker.showInAppAlert('Media cleared', "This week's media has been removed from this device.");
    });

    document.getElementById('dev-save-schedule-btn')?.addEventListener('click', async () => {
      const day  = parseInt(document.getElementById('dev-reveal-day')?.value);
      const hour = parseInt(document.getElementById('dev-reveal-hour')?.value);
      if (isNaN(day) || isNaN(hour) || hour < 0 || hour > 23) return;
      CONFIG.APP.REVEAL_DAY  = day;
      CONFIG.APP.REVEAL_HOUR = hour;
      await Sync.set('config/revealSchedule', { day, hour });
      Dump.refreshScheduleUI();
      closeDevModal();
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day];
      Tracker.showInAppAlert('Schedule saved', `Reveal set to ${dayName} at ${hour}:00 — synced to all devices.`);
    });

    document.getElementById('dev-force-reveal-btn')?.addEventListener('click', () => {
      closeDevModal();
      Dump.forceReveal();
    });
  }

  // ── Long-press on title → Developer modal ─────────────────
  function wireLongPressTitle() {
    const el = document.getElementById('app-title');
    if (!el) return;
    let timer = null;

    const cancel = () => clearTimeout(timer);

    el.addEventListener('touchstart', () => {
      timer = setTimeout(openDevModal, 800);
    }, { passive: true });
    el.addEventListener('touchend',  cancel, { passive: true });
    el.addEventListener('touchmove', cancel, { passive: true });

    // Desktop support
    el.addEventListener('mousedown', () => { timer = setTimeout(openDevModal, 800); });
    el.addEventListener('mouseup',   cancel);
    el.addEventListener('mouseleave', cancel);
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    registerServiceWorker();
    listenForInstallPrompt();

    // Init sync first so config overrides are available before modules init
    await Sync.init();

    // Load reveal schedule override from sync
    const schedOverride = await Sync.get('config/revealSchedule');
    if (schedOverride) {
      if (typeof schedOverride.day  === 'number') CONFIG.APP.REVEAL_DAY  = schedOverride.day;
      if (typeof schedOverride.hour === 'number') CONFIG.APP.REVEAL_HOUR = schedOverride.hour;
    }

    // Auth check
    const saved = getSavedMember();
    if (saved && CONFIG.APP.MEMBERS.includes(saved)) {
      currentMember = saved;
      updateHeaderUser(saved);
      showMainApp();
    } else {
      showAuth();
    }

    // Wire auth cards — use event delegation for robustness
    document.getElementById('screen-auth').addEventListener('click', (e) => {
      const card = e.target.closest('.member-card');
      if (card?.dataset.member) setMember(card.dataset.member);
    });

    // Wire nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => navigate(item.dataset.tab));
    });

    // Wire header user button → settings
    document.getElementById('header-user-btn')?.addEventListener('click', openSettings);
    document.getElementById('settings-backdrop')?.addEventListener('click', closeSettings);
    document.getElementById('settings-close-btn')?.addEventListener('click', closeSettings);

    // Apply URL routing
    applyURLRouting();

    // Wire developer modal and long press
    wireDevModal();
    wireLongPressTitle();

    // Init feature modules (order matters)
    await Dump.init();
    Tracker.init();
    Flight.init();

    // Handle back button / swipe-back to close reveal
    window.addEventListener('popstate', () => {
      const overlay = document.getElementById('reveal-overlay');
      if (!overlay.classList.contains('hidden')) {
        Dump.startReveal; // no-op: just close it
      }
    });

    // Refresh date/greeting every minute
    setInterval(updateGreetingDate, 60000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API ────────────────────────────────────────────
  return {
    getWeekKey,
    getCurrentMember,
    setMember,
    logout,
    navigate,
    openSettings,
    closeSettings,
  };

})();
