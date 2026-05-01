// ============================================================
// Riley Family — Dad Tracker Module
// Location status, weekly schedule, and notifications
// ============================================================

window.Tracker = (() => {

  const LS_STATUS_KEY = 'riley_dad_status';
  const LS_STATUS_OVERRIDE = 'riley_dad_status_override';

  // ── Location helpers ──────────────────────────────────────
  function getAutoLocation() {
    const day = new Date().getDay(); // 0=Sun … 6=Sat
    return CONFIG.APP.DAD_DALLAS_DAYS.includes(day) ? 'dallas' : 'charlotte';
  }

  function getCurrentLocation() {
    // Manual override takes precedence
    const override = localStorage.getItem(LS_STATUS_OVERRIDE);
    if (override) return override;
    return getAutoLocation();
  }

  function setLocation(loc) {
    localStorage.setItem(LS_STATUS_OVERRIDE, loc);
    renderDadStatus(loc);
    renderHomeDadStatus(loc);
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
  }

  function clearOverride() {
    localStorage.removeItem(LS_STATUS_OVERRIDE);
  }

  // ── Render dad status card (large) ───────────────────────
  function renderDadStatus(loc) {
    const card   = document.getElementById('dad-status-card');
    const headline = document.getElementById('dad-status-headline');
    const sub    = document.getElementById('dad-status-sub');
    const bgIcon = document.getElementById('dad-status-bg-icon');
    const btnDal = document.getElementById('btn-set-dallas');
    const btnClt = document.getElementById('btn-set-charlotte');

    if (!card) return;

    if (loc === 'dallas') {
      card.className = 'dad-status-card dallas';
      if (headline) headline.textContent = `In ${CONFIG.APP.WORK_CITY} ✈️`;
      if (sub)      sub.textContent      = 'Returns Charlotte Friday evening';
      if (bgIcon)   bgIcon.textContent   = '✈️';
    } else {
      card.className = 'dad-status-card charlotte';
      if (headline) headline.textContent = `In ${CONFIG.APP.HOME_CITY} 🏠`;
      if (sub)      sub.textContent      = 'Leaves for Dallas Monday morning';
      if (bgIcon)   bgIcon.textContent   = '🏠';
    }

    if (btnDal) btnDal.classList.toggle('selected', loc === 'dallas');
    if (btnClt) btnClt.classList.toggle('selected', loc === 'charlotte');
  }

  // ── Render home mini status ───────────────────────────────
  function renderHomeDadStatus(loc) {
    const iconWrap = document.getElementById('home-status-icon-wrap');
    const emoji    = document.getElementById('home-status-emoji');
    const title    = document.getElementById('home-status-title');
    const sub      = document.getElementById('home-status-sub');

    if (!iconWrap) return;

    if (loc === 'dallas') {
      iconWrap.className = 'status-icon-wrap dallas';
      if (emoji) emoji.textContent = '✈️';
      if (title) title.textContent = `Dad is in ${CONFIG.APP.WORK_CITY}`;
      if (sub)   sub.textContent   = 'Back Friday evening';
    } else {
      iconWrap.className = 'status-icon-wrap charlotte';
      if (emoji) emoji.textContent = '🏠';
      if (title) title.textContent = `Dad is in ${CONFIG.APP.HOME_CITY}`;
      if (sub)   sub.textContent   = 'Leaves Monday morning';
    }
  }

  // ── Weekly schedule strip ─────────────────────────────────
  function renderScheduleStrip() {
    const strip = document.getElementById('schedule-strip');
    if (!strip) return;

    const today     = new Date().getDay();
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    strip.innerHTML = dayLabels.map((label, dayIdx) => {
      const isDallas    = CONFIG.APP.DAD_DALLAS_DAYS.includes(dayIdx);
      const locClass    = isDallas ? 'dallas' : 'charlotte';
      const todayClass  = dayIdx === today ? 'today' : '';
      const icon        = isDallas ? '✈️' : '🏠';

      return `<div class="schedule-day">
        <span class="day-label">${label}</span>
        <div class="day-dot ${locClass} ${todayClass}" title="${isDallas ? CONFIG.APP.WORK_CITY : CONFIG.APP.HOME_CITY}">${icon}</div>
      </div>`;
    }).join('');
  }

  // ── In-app notification banner ────────────────────────────
  let notifTimeout = null;

  function showInAppAlert(title, body) {
    // Remove existing banner
    const existing = document.querySelector('.in-app-notification');
    if (existing) existing.remove();
    clearTimeout(notifTimeout);

    const banner = document.createElement('div');
    banner.className = 'in-app-notification';
    banner.innerHTML = `
      <span class="notif-icon">✈️</span>
      <div class="notif-text">
        <h4>${title}</h4>
        <p>${body}</p>
      </div>`;
    document.getElementById('app').appendChild(banner);

    notifTimeout = setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-120%)';
      banner.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => banner.remove(), 320);
    }, 5000);
  }

  // ── Web Push notifications ────────────────────────────────
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications.');
      return false;
    }

    if (Notification.permission === 'granted') return true;

    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showInAppAlert('Not supported', 'Push notifications are not supported in this browser.');
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      updateNotifBadge('Denied');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const vapidKey = CONFIG.VAPID_PUBLIC_KEY;

      if (!vapidKey || vapidKey === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
        // Fallback: just use Notification API without push subscription
        updateNotifBadge('On (local only)');
        new Notification('Riley Family', {
          body: '✅ Notifications enabled! You\'ll get alerts when Dad\'s flights update.',
          icon: '/icons/icon.svg',
        });
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // NOTE: In a real deployment, send `subscription` to your server here
      // so it can push notifications using the Web Push Protocol.
      console.log('Push subscription:', JSON.stringify(subscription));

      updateNotifBadge('On');
      showInAppAlert('Notifications on!', 'You\'ll be notified when Dad\'s flights update.');
    } catch (e) {
      console.error('Push subscription failed:', e);
      updateNotifBadge('Failed');
      showInAppAlert('Could not enable', e.message);
    }
  }

  function updateNotifBadge(text) {
    const badge = document.getElementById('notif-status-badge');
    if (badge) {
      badge.textContent = text;
      badge.style.color = text === 'On' || text.startsWith('On') ? 'var(--green)' : 'var(--text-secondary)';
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  }

  // ── Check current notification permission ─────────────────
  function syncNotifState() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') updateNotifBadge('On (local only)');
    if (Notification.permission === 'denied')  updateNotifBadge('Denied');
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const loc = getCurrentLocation();
    renderDadStatus(loc);
    renderHomeDadStatus(loc);
    renderScheduleStrip();
    syncNotifState();

    // Wire toggle buttons
    document.getElementById('btn-set-dallas')?.addEventListener('click', () => setLocation('dallas'));
    document.getElementById('btn-set-charlotte')?.addEventListener('click', () => setLocation('charlotte'));

    // Home card → navigate to dad tab
    document.getElementById('home-dad-card')?.addEventListener('click', () => {
      App.navigate('dad');
    });

    // Notifications
    document.getElementById('enable-notif-btn')?.addEventListener('click', () => subscribeToPush());

    // Auto-update location suggestion on new day
    // (runs a lightweight check every minute)
    setInterval(() => {
      if (!localStorage.getItem(LS_STATUS_OVERRIDE)) {
        const auto = getAutoLocation();
        renderDadStatus(auto);
        renderHomeDadStatus(auto);
        renderScheduleStrip();
      }
    }, 60000);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    getCurrentLocation,
    setLocation,
    clearOverride,
    showInAppAlert,
    getAutoLocation,
  };

})();
