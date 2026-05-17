// ============================================================
// Riley Family — Flight Module
// AeroDataBox via RapidAPI — live flight tracking
//
// Only Dad's device needs the RapidAPI key.
// After every fetch, the normalized flight object is pushed to
// Firebase at flightData/{weekKey}/{flightNumber} so all family
// devices can read live data without their own key.
// ============================================================

window.Flight = (() => {

  const LS_FLIGHTS_KEY = 'riley_flights_';
  let refreshTimers = {};

  // ── Helpers ───────────────────────────────────────────────
  function getWeekKey()     { return App.getWeekKey(); }
  function getStorageKey()  { return LS_FLIGHTS_KEY + getWeekKey(); }
  function fbDataPath(num)  { return `flightData/${getWeekKey()}/${num.replace(/\s+/g, '')}`; }

  function hasApiKey() {
    return !!(CONFIG.RAPIDAPI_KEY && CONFIG.RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE');
  }

  // ── Flight number storage (cross-device via Firebase) ─────
  function saveFlightNumbers(monFlight, friFlight) {
    const data = {
      monday: monFlight.trim().toUpperCase(),
      friday: friFlight.trim().toUpperCase(),
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(data));
    if (window.Sync) Sync.set('flights/' + getWeekKey(), data);
    return data;
  }

  function loadFlightNumbers() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      return raw ? JSON.parse(raw) : { monday: '', friday: '' };
    } catch { return { monday: '', friday: '' }; }
  }

  // ── Push fetched data to Firebase (for family devices) ───
  function pushFlightToFirebase(flightNumber, flight) {
    if (!window.Sync || !Sync.isConfigured()) return;
    Sync.set(fbDataPath(flightNumber), flight);
  }

  // ── API fetch ─────────────────────────────────────────────
  async function fetchFlightData(flightNumber) {
    if (!hasApiKey()) throw new Error('RapidAPI key not configured.');

    const today = new Date().toISOString().split('T')[0];
    const url   = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${today}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key':  CONFIG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': CONFIG.AERODATABOX_HOST,
      },
    });

    if (resp.status === 404) throw new Error('Flight not found for today.');
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`API error ${resp.status}${txt ? ': ' + txt : ''}`);
    }

    const data   = await resp.json();
    const flight = Array.isArray(data) ? data[0] : data;
    if (!flight) throw new Error('No flight data returned.');
    const normalized = normalizeFlight(flight, flightNumber);

    // Push to Firebase so family devices see it immediately
    pushFlightToFirebase(flightNumber, normalized);
    return normalized;
  }

  // ── Normalize AeroDataBox response ───────────────────────
  function normalizeFlight(raw, flightNumber) {
    const dep    = raw.departure || {};
    const arr    = raw.arrival   || {};
    const airline = raw.airline  || {};
    const status = (raw.status || 'Unknown').toLowerCase();

    return {
      flightNumber:     raw.number || flightNumber,
      airline:          airline.name || '',
      status:           mapStatus(status),
      rawStatus:        status,

      departureAirport: dep.airport?.iata || dep.airport?.name || '---',
      departureCity:    dep.airport?.municipalityName || '',
      scheduledDep:     dep.scheduledTime?.utc || dep.scheduledTime?.local || null,
      actualDep:        dep.revisedTime?.utc   || dep.revisedTime?.local   || null,
      depGate:          dep.gate     || '',
      depTerminal:      dep.terminal || '',

      arrivalAirport:   arr.airport?.iata || arr.airport?.name || '---',
      arrivalCity:      arr.airport?.municipalityName || '',
      scheduledArr:     arr.scheduledTime?.utc || arr.scheduledTime?.local || null,
      actualArr:        arr.revisedTime?.utc   || arr.revisedTime?.local   || null,
      arrGate:          arr.gate     || '',
      arrTerminal:      arr.terminal || '',

      progress:  raw.greatCircleDistance ? estimateProgress(raw) : null,
      fetchedAt: Date.now(),
    };
  }

  function mapStatus(s) {
    if (s.includes('cancel'))                              return 'cancelled';
    if (s.includes('land') || s.includes('arrived'))      return 'landed';
    if (s.includes('air') || s.includes('en route') || s.includes('departed')) return 'in-air';
    if (s.includes('board'))                              return 'boarding';
    if (s.includes('delay'))                              return 'delayed';
    return 'scheduled';
  }

  function estimateProgress(raw) {
    const dep = raw.departure?.scheduledTime?.utc;
    const arr = raw.arrival?.scheduledTime?.utc;
    if (!dep || !arr) return 0.5;
    const now   = Date.now();
    const depMs = new Date(dep).getTime();
    const arrMs = new Date(arr).getTime();
    if (now <= depMs) return 0;
    if (now >= arrMs) return 1;
    return (now - depMs) / (arrMs - depMs);
  }

  // ── Format helpers ────────────────────────────────────────
  function formatTime(isoString) {
    if (!isoString) return '--:--';
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return '--:--'; }
  }

  function getDelay(scheduled, actual) {
    if (!scheduled || !actual) return 0;
    return Math.round((new Date(actual) - new Date(scheduled)) / 60000);
  }

  function formatCountdown(targetISO) {
    if (!targetISO) return '';
    const diff = new Date(targetISO) - Date.now();
    if (diff <= 0) return 'Now';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ── Render flight card ────────────────────────────────────
  function renderFlightCard(flight, label) {
    const depTime  = flight.actualDep || flight.scheduledDep;
    const arrTime  = flight.actualArr || flight.scheduledArr;
    const depDelay = getDelay(flight.scheduledDep, flight.actualDep);
    const arrDelay = getDelay(flight.scheduledArr, flight.actualArr);
    const isInAir  = flight.status === 'in-air';
    const progress = flight.progress || 0;
    const planePos = Math.max(5, Math.min(95, progress * 100));

    const statusLabel = {
      'scheduled': 'Scheduled',
      'boarding':  'Boarding',
      'in-air':    'In Air ✈️',
      'landed':    'Landed ✅',
      'delayed':   'Delayed ⚠️',
      'cancelled': 'Cancelled ❌',
    }[flight.status] || flight.rawStatus;

    let alertHtml = '';
    if (flight.status === 'cancelled') {
      alertHtml = `<div class="cancel-alert">⛔ Flight ${flight.flightNumber} has been CANCELLED</div>`;
    } else if (depDelay >= 15 || arrDelay >= 15) {
      alertHtml = `<div class="delay-alert">⚠️ Delayed by approximately ${Math.max(depDelay, arrDelay)} minutes</div>`;
    }

    let countdownHtml = '';
    if (flight.status === 'scheduled' || flight.status === 'delayed') {
      const cd = formatCountdown(depTime);
      if (cd) countdownHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--text-secondary);">🕐 Departs in <strong>${cd}</strong>${flight.depGate ? ` · Gate ${flight.depGate}` : ''}</div>`;
    } else if (flight.status === 'boarding') {
      countdownHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--orange);font-weight:700;">🚶 Now Boarding${flight.depGate ? ` · Gate ${flight.depGate}` : ''}</div>`;
    } else if (flight.status === 'in-air') {
      const cd = formatCountdown(arrTime);
      if (cd) countdownHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--green);font-weight:600;">✈️ Arrives in <strong>${cd}</strong></div>`;
    } else if (flight.status === 'landed') {
      countdownHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--green);font-weight:700;">✅ Landed — ${flight.airline || 'Flight'} has arrived!</div>`;
    }

    const arcSvg = `
      <svg viewBox="0 0 160 50" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:160px;overflow:visible;">
        <path class="flight-path-line" d="M 10,40 Q 80,2 150,40"/>
        ${isInAir ? `
          <circle cx="${10 + (planePos / 100) * 140}" cy="${40 - Math.sin((planePos / 100) * Math.PI) * 38 + 2}" r="4" fill="var(--blue)" opacity="0.7"/>
          <text x="${10 + (planePos / 100) * 140}" y="${40 - Math.sin((planePos / 100) * Math.PI) * 38 - 6}" font-size="14" text-anchor="middle">✈️</text>
        ` : `
          <text x="80" y="20" font-size="14" text-anchor="middle">✈️</text>
        `}
      </svg>`;

    return `
      <div class="flight-card card" style="padding:0;">
        <div style="padding:10px 18px 4px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div class="flight-header">
          <div>
            <div class="flight-number">${flight.flightNumber}</div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">${flight.airline}</div>
          </div>
          <div class="flight-status-badge ${flight.status}">${statusLabel}</div>
        </div>
        ${alertHtml}
        <div class="flight-route">
          <div class="route-airport">
            <div class="airport-code">${flight.departureAirport}</div>
            <div class="airport-city">${flight.departureCity}</div>
            <div class="airport-time${depDelay >= 15 ? ' delayed' : ''}">${formatTime(flight.scheduledDep)}</div>
            ${flight.actualDep && depDelay >= 5 ? `<div class="airport-time" style="font-size:13px;color:var(--red);">${formatTime(flight.actualDep)}</div>` : ''}
          </div>
          <div class="route-arc">${arcSvg}</div>
          <div class="route-airport">
            <div class="airport-code">${flight.arrivalAirport}</div>
            <div class="airport-city">${flight.arrivalCity}</div>
            <div class="airport-time${arrDelay >= 15 ? ' delayed' : ''}">${formatTime(flight.scheduledArr)}</div>
            ${flight.actualArr && arrDelay >= 5 ? `<div class="airport-time" style="font-size:13px;color:var(--red);">${formatTime(flight.actualArr)}</div>` : ''}
          </div>
        </div>
        ${countdownHtml}
        <div class="flight-details-grid">
          <div class="flight-detail-item">
            <div class="detail-label">Dep Gate</div>
            <div class="detail-value">${flight.depGate || '—'}</div>
          </div>
          <div class="flight-detail-item">
            <div class="detail-label">Arr Gate</div>
            <div class="detail-value">${flight.arrGate || '—'}</div>
          </div>
          <div class="flight-detail-item">
            <div class="detail-label">Dep Terminal</div>
            <div class="detail-value">${flight.depTerminal || '—'}</div>
          </div>
          <div class="flight-detail-item">
            <div class="detail-label">Arr Terminal</div>
            <div class="detail-value">${flight.arrTerminal || '—'}</div>
          </div>
        </div>
        <div style="padding:10px 18px;font-size:11px;color:var(--text-tertiary);text-align:right;">
          Updated ${new Date(flight.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>`;
  }

  // ── Auto-refresh (Dad's device only) ─────────────────────
  function startAutoRefresh(flightKey, flightNumber, label, containerEl) {
    stopAutoRefresh(flightKey);

    async function doRefresh() {
      try {
        const flight = await fetchFlightData(flightNumber); // also pushes to Firebase
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(flight, label);

        // Alert when landed
        if (flight.status === 'landed') {
          const notifKey = `riley_notif_landed_${flightNumber}`;
          if (!sessionStorage.getItem(notifKey)) {
            sessionStorage.setItem(notifKey, '1');
            const city = flightNumber === loadFlightNumbers().monday
              ? CONFIG.APP.WORK_CITY
              : CONFIG.APP.HOME_CITY;
            window.Tracker?.showInAppAlert('✈️ Landed!', `Dad's flight has landed in ${city}.`);
          }
        }

        if (['cancelled', 'landed'].includes(flight.status)) {
          stopAutoRefresh(flightKey);
        }
      } catch (e) {
        console.warn('Flight refresh error:', e);
      }
    }

    refreshTimers[flightKey] = setInterval(doRefresh, 60000);
  }

  function stopAutoRefresh(flightKey) {
    if (refreshTimers[flightKey]) {
      clearInterval(refreshTimers[flightKey]);
      delete refreshTimers[flightKey];
    }
  }

  // ── Track a flight and render into container ──────────────
  // Dad's device: fetches from API → pushes to Firebase → auto-refreshes.
  // Family devices: reads from Firebase → subscribes for live updates.

  async function trackFlight(flightNumber, label, containerEl) {
    if (!flightNumber) return;

    const path = fbDataPath(flightNumber);

    // Subscribe to Firebase so this container updates whenever Dad's device
    // refreshes — works on both Dad's device and family devices.
    if (window.Sync && Sync.isConfigured()) {
      Sync.subscribe(path, (data) => {
        if (data && containerEl.isConnected) {
          containerEl.innerHTML = renderFlightCard(data, label);
        }
      });
    }

    if (hasApiKey()) {
      // Dad's device — call the API
      containerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:16px;color:var(--text-secondary);">
          <span class="spinner"></span>
          <span>Fetching flight data…</span>
        </div>`;

      try {
        const flight = await fetchFlightData(flightNumber); // pushes to Firebase inside
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(flight, label);

        if (['scheduled', 'boarding', 'in-air', 'delayed'].includes(flight.status)) {
          const key = `${flightNumber}_${label}`;
          startAutoRefresh(key, flightNumber, label, containerEl);
          const ind = document.getElementById('flight-refresh-indicator');
          if (ind) ind.textContent = 'Auto-refreshing every 60s';
        }
      } catch (e) {
        if (containerEl.isConnected) {
          containerEl.innerHTML = `
            <div class="error-banner">
              <span class="error-icon">⚠️</span>
              <div>
                <strong>Could not fetch flight data</strong><br/>
                <span style="font-size:13px;">${e.message}</span>
              </div>
            </div>`;
        }
      }

    } else {
      // Family device — read from Firebase cache; subscribe already handles live updates
      let cached = null;
      if (window.Sync && Sync.isConfigured()) {
        cached = await Sync.get(path);
      }

      if (cached) {
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(cached, label);
      } else {
        if (containerEl.isConnected) {
          containerEl.innerHTML = `
            <div style="font-size:14px;color:var(--text-secondary);text-align:center;padding:16px 0;">
              ✈️ Waiting for Dad to track his flight…
            </div>`;
        }
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const saved    = loadFlightNumbers();
    const weekKey  = getWeekKey();
    const monInput = document.getElementById('monday-flight-input');
    const friInput = document.getElementById('friday-flight-input');

    if (monInput && saved.monday) monInput.value = saved.monday;
    if (friInput && saved.friday) friInput.value = saved.friday;

    // Subscribe to flight number changes (cross-device)
    if (window.Sync) {
      Sync.subscribe('flights/' + weekKey, (data) => {
        if (!data) return;
        localStorage.setItem(getStorageKey(), JSON.stringify(data));
        if (monInput && data.monday) monInput.value = data.monday;
        if (friInput && data.friday) friInput.value = data.friday;
        if (window.Tracker) Tracker.applyDadMode();
      });
    }

    // Wire save/track buttons
    document.getElementById('track-monday-btn')?.addEventListener('click', () => {
      const num = monInput?.value?.trim().toUpperCase();
      if (!num) return;
      saveFlightNumbers(num, friInput?.value?.trim().toUpperCase() || '');
      const area = document.getElementById('flight-status-area');
      if (area) trackFlight(num, 'Monday — Charlotte → Dallas', area);
    });

    document.getElementById('track-friday-btn')?.addEventListener('click', () => {
      const num = friInput?.value?.trim().toUpperCase();
      if (!num) return;
      saveFlightNumbers(monInput?.value?.trim().toUpperCase() || '', num);
      const area = document.getElementById('flight-status-area');
      if (area) trackFlight(num, 'Friday — Dallas → Charlotte', area);
    });

    // Auto-track today's flight if numbers are saved
    const area = document.getElementById('flight-status-area');
    if (area && (saved.monday || saved.friday)) {
      const today = new Date().getDay();
      if (today === 1 && saved.monday) {
        trackFlight(saved.monday, 'Monday — Charlotte → Dallas', area);
      } else if (today === 5 && saved.friday) {
        trackFlight(saved.friday, 'Friday — Dallas → Charlotte', area);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────
  return { init, trackFlight, loadFlightNumbers, saveFlightNumbers };

})();
