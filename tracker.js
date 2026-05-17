// ============================================================
// Riley Family — Dad Tracker Module
// Location status and per-day editable weekly schedule.
//
// Schedule data lives at Firebase: schedule/{weekKey}
// Format: { "1": "dallas", "3": "charlotte", … } (only overrides
// vs the CONFIG.APP.DAD_DALLAS_DAYS default are stored).
//
// Dad can tap any day in the schedule strip to toggle it.
// Family members see the strip read-only.
// ============================================================

window.Tracker = (() => {

  // ── Schedule helpers ──────────────────────────────────────

  function lsScheduleKey(weekKey) {
    return `riley_schedule_${weekKey}`;
  }

  // Build the default 7-day schedule from config (0=Sun … 6=Sat)
  function buildDefaultSchedule() {
    const s = {};
    for (let d = 0; d < 7; d++) {
      s[d] = CONFIG.APP.DAD_DALLAS_DAYS.includes(d) ? 'dallas' : 'charlotte';
    }
    return s;
  }

  // Merge stored overrides on top of the defaults
  function getWeekSchedule(weekKey) {
    const defaults = buildDefaultSchedule();
    try {
      const raw = localStorage.getItem(lsScheduleKey(weekKey));
      if (raw) {
        const overrides = JSON.parse(raw);
        // Keys come back as strings from JSON; cast to int
        const merged = Object.assign({}, defaults);
        Object.entries(overrides).forEach(([k, v]) => { merged[parseInt(k, 10)] = v; });
        return merged;
      }
    } catch {}
    return defaults;
  }

  // Save overrides to localStorage + Firebase and refresh UI
  async function setDayLocation(weekKey, dayIdx, loc) {
    const defaults = buildDefaultSchedule();

    // Read existing overrides
    let overrides = {};
    try {
      const raw = localStorage.getItem(lsScheduleKey(weekKey));
      if (raw) overrides = JSON.parse(raw);
    } catch {}

    // Only store non-default days
    if (loc === defaults[dayIdx]) {
      delete overrides[dayIdx];
    } else {
      overrides[dayIdx] = loc;
    }

    localStorage.setItem(lsScheduleKey(weekKey), JSON.stringify(overrides));
    if (window.Sync && Sync.isConfigured()) {
      Sync.set(`schedule/${weekKey}`, overrides);
    }

    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);

    // Refresh all UI
    renderScheduleStrip();
    const today = new Date().getDay();
    const currentLoc = getWeekSchedule(weekKey)[today];
    renderDadStatus(currentLoc);
    renderHomeDadStatus(currentLoc);
  }

  function getCurrentLocation() {
    const weekKey = App.getWeekKey();
    return getWeekSchedule(weekKey)[new Date().getDay()];
  }

  // ── Dynamic subtitle ──────────────────────────────────────
  // Looks ahead up to 7 days to find the next day the location changes.
  function getStatusSubtitle(schedule, today, loc) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (let i = 1; i <= 7; i++) {
      const d = (today + i) % 7;
      if (schedule[d] !== loc) {
        return loc === 'dallas'
          ? `Returns ${CONFIG.APP.HOME_CITY} ${dayNames[d]}`
          : `Leaves for ${CONFIG.APP.WORK_CITY} ${dayNames[d]}`;
      }
    }
    return '';
  }

  // ── Render dad status card (large) ───────────────────────
  function renderDadStatus(loc) {
    const card     = document.getElementById('dad-status-card');
    const headline = document.getElementById('dad-status-headline');
    const sub      = document.getElementById('dad-status-sub');
    const bgIcon   = document.getElementById('dad-status-bg-icon');
    const btnDal   = document.getElementById('btn-set-dallas');
    const btnClt   = document.getElementById('btn-set-charlotte');

    if (!card) return;

    const weekKey  = App.getWeekKey();
    const schedule = getWeekSchedule(weekKey);
    const today    = new Date().getDay();
    const subtitle = getStatusSubtitle(schedule, today, loc);

    if (loc === 'dallas') {
      card.className = 'dad-status-card dallas';
      if (headline) headline.textContent = `In ${CONFIG.APP.WORK_CITY} ✈️`;
      if (sub)      sub.textContent      = subtitle;
      if (bgIcon)   bgIcon.textContent   = '✈️';
    } else {
      card.className = 'dad-status-card charlotte';
      if (headline) headline.textContent = `In ${CONFIG.APP.HOME_CITY} 🏠`;
      if (sub)      sub.textContent      = subtitle;
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

    const weekKey  = App.getWeekKey();
    const schedule = getWeekSchedule(weekKey);
    const today    = new Date().getDay();
    const subtitle = getStatusSubtitle(schedule, today, loc);

    if (loc === 'dallas') {
      iconWrap.className = 'status-icon-wrap dallas';
      if (emoji) emoji.textContent = '✈️';
      if (title) title.textContent = `Dad is in ${CONFIG.APP.WORK_CITY}`;
      if (sub)   sub.textContent   = subtitle;
    } else {
      iconWrap.className = 'status-icon-wrap charlotte';
      if (emoji) emoji.textContent = '🏠';
      if (title) title.textContent = `Dad is in ${CONFIG.APP.HOME_CITY}`;
      if (sub)   sub.textContent   = subtitle;
    }
  }

  // ── Weekly schedule strip ─────────────────────────────────
  // Dad: each dot is tappable to toggle Dallas ↔ Charlotte.
  // Family: read-only.

  function renderScheduleStrip() {
    const strip = document.getElementById('schedule-strip');
    if (!strip) return;

    const weekKey   = App.getWeekKey();
    const schedule  = getWeekSchedule(weekKey);
    const today     = new Date().getDay();
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const isDad     = window.App && App.getCurrentMember() === 'Dad';

    strip.innerHTML = dayLabels.map((label, dayIdx) => {
      const loc       = schedule[dayIdx];
      const isDallas  = loc === 'dallas';
      const locClass  = isDallas ? 'dallas' : 'charlotte';
      const isToday   = dayIdx === today;
      const icon      = isDallas ? '✈️' : '🏠';
      const tapAttr   = isDad
        ? `data-day="${dayIdx}" data-loc="${loc}" title="${isDallas ? CONFIG.APP.WORK_CITY : CONFIG.APP.HOME_CITY} — tap to change"`
        : '';

      return `<div class="schedule-day">
        <span class="day-label${isToday ? ' today-label' : ''}">${label}</span>
        <div class="day-dot ${locClass}${isToday ? ' today' : ''}${isDad ? ' tappable' : ''}" ${tapAttr}>${icon}</div>
      </div>`;
    }).join('');

    // Wire tap handlers for Dad
    if (isDad) {
      strip.querySelectorAll('.day-dot[data-day]').forEach(dot => {
        dot.addEventListener('click', () => {
          const dayIdx     = parseInt(dot.dataset.day, 10);
          const currentLoc = dot.dataset.loc;
          const newLoc     = currentLoc === 'dallas' ? 'charlotte' : 'dallas';
          setDayLocation(weekKey, dayIdx, newLoc);
        });
      });
    }
  }

  // ── In-app notification banner ────────────────────────────
  let notifTimeout = null;

  function showInAppAlert(title, body) {
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

  // ── Show/hide Dad-only controls ───────────────────────────
  function applyDadMode() {
    const isDad      = App.getCurrentMember() === 'Dad';
    const toggle     = document.getElementById('dad-status-toggle');
    const inputs     = document.getElementById('dad-flight-inputs');
    const familyView = document.getElementById('dad-flight-family-view');

    if (toggle) toggle.style.display = isDad ? 'flex' : 'none';
    if (inputs) inputs.style.display = isDad ? 'flex' : 'none';

    // Re-render strip so tap targets appear / disappear
    renderScheduleStrip();

    // Family view: show saved flight numbers when not Dad
    if (familyView) {
      if (!isDad) {
        const saved   = Flight.loadFlightNumbers();
        const hasMon  = !!saved.monday;
        const hasFri  = !!saved.friday;
        if (hasMon || hasFri) {
          familyView.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${hasMon ? `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface-2);border-radius:var(--r-sm);">
                <span style="font-size:20px;">✈️</span>
                <div><div style="font-size:13px;color:var(--text-secondary);">Monday departure</div><div style="font-weight:700;">${saved.monday}</div></div>
              </div>` : ''}
              ${hasFri ? `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface-2);border-radius:var(--r-sm);">
                <span style="font-size:20px;">🏠</span>
                <div><div style="font-size:13px;color:var(--text-secondary);">Friday return</div><div style="font-weight:700;">${saved.friday}</div></div>
              </div>` : ''}
            </div>`;
        } else {
          familyView.innerHTML = `<div style="font-size:14px;color:var(--text-secondary);text-align:center;padding:12px 0;">
            Dad hasn't entered his flights yet this week.
          </div>`;
        }
      } else {
        familyView.innerHTML = '';
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const loc = getCurrentLocation();
    renderDadStatus(loc);
    renderHomeDadStatus(loc);
    renderScheduleStrip();
    applyDadMode();

    const weekKey = App.getWeekKey();

    if (window.Sync) {
      // Subscribe to schedule changes pushed by Dad from another device
      Sync.subscribe(`schedule/${weekKey}`, (overrides) => {
        // Persist overrides locally
        localStorage.setItem(lsScheduleKey(weekKey), JSON.stringify(overrides || {}));
        renderScheduleStrip();
        const today      = new Date().getDay();
        const currentLoc = getWeekSchedule(weekKey)[today];
        renderDadStatus(currentLoc);
        renderHomeDadStatus(currentLoc);
      });
    }

    // Wire the "I'm in Dallas / Charlotte" toggle buttons on the status card (Dad only)
    document.getElementById('btn-set-dallas')?.addEventListener('click', () => {
      setDayLocation(weekKey, new Date().getDay(), 'dallas');
    });
    document.getElementById('btn-set-charlotte')?.addEventListener('click', () => {
      setDayLocation(weekKey, new Date().getDay(), 'charlotte');
    });

    // Home card → navigate to dad tab
    document.getElementById('home-dad-card')?.addEventListener('click', () => {
      App.navigate('dad');
    });

    // Refresh status display once per minute (handles day rollover)
    setInterval(() => {
      const current = getCurrentLocation();
      renderDadStatus(current);
      renderHomeDadStatus(current);
      renderScheduleStrip();
    }, 60000);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    getCurrentLocation,
    showInAppAlert,
    applyDadMode,
    renderScheduleStrip,
  };

})();
