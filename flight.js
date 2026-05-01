// ============================================================
// Riley Family — Flight Module
// AeroDataBox via RapidAPI — live flight tracking
// ============================================================

window.Flight = (() => {

  const LS_FLIGHTS_KEY = 'riley_flights_';
  let refreshTimers = {};

  // ── Week key ──────────────────────────────────────────────
  function getFlightStorageKey() {
    return LS_FLIGHTS_KEY + App.getWeekKey();
  }

  // ── Storage ───────────────────────────────────────────────
  function saveFlightNumbers(monFlight, friFlight) {
    const key = getFlightStorageKey();
    const data = { monday: monFlight.trim().toUpperCase(), friday: friFlight.trim().toUpperCase() };
    localStorage.setItem(key, JSON.stringify(data));
    return data;
  }

  function loadFlightNumbers() {
    try {
      const raw = localStorage.getItem(getFlightStorageKey());
      return raw ? JSON.parse(raw) : { monday: '', friday: '' };
    } catch { return { monday: '', friday: '' }; }
  }

  // ── API fetch ─────────────────────────────────────────────
  async function fetchFlightData(flightNumber) {
    const apiKey = CONFIG.RAPIDAPI_KEY;
    if (!apiKey || apiKey === 'YOUR_RAPIDAPI_KEY_HERE') {
      throw new Error('RapidAPI key not configured. Add your key to config.js.');
    }

    // AeroDataBox: get today's flight by flight number
    const today = new Date().toISOString().split('T')[0];
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${today}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': CONFIG.AERODATABOX_HOST,
      },
    });

    if (resp.status === 404) throw new Error('Flight not found for today.');
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`API error ${resp.status}${txt ? ': ' + txt : ''}`);
    }

    const data = await resp.json();
    // AeroDataBox returns an array; take the first result
    const flight = Array.isArray(data) ? data[0] : data;
    if (!flight) throw new Error('No flight data returned.');
    return normalizeFlight(flight, flightNumber);
  }

  // ── Normalize AeroDataBox response ───────────────────────
  function normalizeFlight(raw, flightNumber) {
    const dep = raw.departure || {};
    const arr = raw.arrival || {};
    const airline = raw.airline || {};
    const status = (raw.status || 'Unknown').toLowerCase();

    return {
      flightNumber: raw.number || flightNumber,
      airline: airline.name || '',
      status: mapStatus(status),
      rawStatus: status,

      departureAirport: dep.airport?.iata || dep.airport?.name || '---',
      departureCity: dep.airport?.municipalityName || '',
      scheduledDep: dep.scheduledTime?.utc || dep.scheduledTime?.local || null,
      actualDep: dep.revisedTime?.utc || dep.revisedTime?.local || null,
      depGate: dep.gate || '',
      depTerminal: dep.terminal || '',

      arrivalAirport: arr.airport?.iata || arr.airport?.name || '---',
      arrivalCity: arr.airport?.municipalityName || '',
      scheduledArr: arr.scheduledTime?.utc || arr.scheduledTime?.local || null,
      actualArr: arr.revisedTime?.utc || arr.revisedTime?.local || null,
      arrGate: arr.gate || '',
      arrTerminal: arr.terminal || '',

      progress: raw.greatCircleDistance ? estimateProgress(raw) : null,
      fetchedAt: Date.now(),
    };
  }

  function mapStatus(s) {
    if (s.includes('cancel')) return 'cancelled';
    if (s.includes('land') || s.includes('arrived')) return 'landed';
    if (s.includes('air') || s.includes('en route') || s.includes('departed')) return 'in-air';
    if (s.includes('board')) return 'boarding';
    if (s.includes('delay')) return 'delayed';
    return 'scheduled';
  }

  function estimateProgress(raw) {
    // Rough estimate based on scheduled times
    const dep = raw.departure?.scheduledTime?.utc;
    const arr = raw.arrival?.scheduledTime?.utc;
    if (!dep || !arr) return 0.5;
    const now = Date.now();
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
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { return '--:--'; }
  }

  function getDelay(scheduled, actual) {
    if (!scheduled || !actual) return 0;
    const diff = (new Date(actual) - new Date(scheduled)) / 60000; // minutes
    return Math.round(diff);
  }

  function formatCountdown(targetISO) {
    if (!targetISO) return '';
    const diff = new Date(targetISO) - Date.now();
    if (diff <= 0) return 'Now';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ── Render flight card ────────────────────────────────────
  function renderFlightCard(flight, label) {
    const depTime  = flight.actualDep || flight.scheduledDep;
    const arrTime  = flight.actualArr || flight.scheduledArr;
    const depDelay = getDelay(flight.scheduledDep, flight.actualDep);
    const arrDelay = getDelay(flight.scheduledArr, flight.actualArr);
    const isInAir  = flight.status === 'in-air';
    const progress = flight.progress || 0;

    const statusLabel = {
      'scheduled': 'Scheduled',
      'boarding':  'Boarding',
      'in-air':    'In Air ✈️',
      'landed':    'Landed ✅',
      'delayed':   'Delayed ⚠️',
      'cancelled': 'Cancelled ❌',
    }[flight.status] || flight.rawStatus;

    const planePos = Math.max(5, Math.min(95, progress * 100));

    let alertHtml = '';
    if (flight.status === 'cancelled') {
      alertHtml = `<div class="cancel-alert">⛔ Flight ${flight.flightNumber} has been CANCELLED</div>`;
    } else if (depDelay >= 15 || arrDelay >= 15) {
      const delayMin = Math.max(depDelay, arrDelay);
      alertHtml = `<div class="delay-alert">⚠️ Delayed by approximately ${delayMin} minutes</div>`;
    }

    // Countdown text
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

    // Flight arc SVG
    const arcSvg = `
      <svg viewBox="0 0 160 50" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:160px;overflow:visible;">
        <path class="flight-path-line" d="M 10,40 Q 80,2 150,40"/>
        ${isInAir ? `
          <text font-size="16" text-anchor="middle"
            style="offset-path:path('M 10,40 Q 80,2 150,40');offset-distance:${planePos}%;animation:plane-fly 3s ease-in-out infinite alternate;"
          >✈️</text>
          <circle cx="${10 + (planePos / 100) * 140}" cy="${40 - Math.sin((planePos / 100) * Math.PI) * 38 + 2}" r="4" fill="var(--blue)" opacity="0.7"/>
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
          Updated ${new Date(flight.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
        </div>
      </div>`;
  }

  // ── Auto-refresh ──────────────────────────────────────────
  function startAutoRefresh(flightKey, flightNumber, label, containerEl) {
    stopAutoRefresh(flightKey);

    async function doRefresh() {
      try {
        const flight = await fetchFlightData(flightNumber);
        containerEl.innerHTML = renderFlightCard(flight, label);

        // Trigger notification if just landed
        if (flight.status === 'landed') {
          const notifKey = `riley_notif_landed_${flightNumber}`;
          if (!sessionStorage.getItem(notifKey)) {
            sessionStorage.setItem(notifKey, '1');
            const city = flightNumber === loadFlightNumbers().monday
              ? CONFIG.APP.WORK_CITY
              : CONFIG.APP.HOME_CITY;
            window.Tracker?.showInAppAlert(`✈️ Landed!`, `Dad's flight has landed in ${city}.`);
          }
          stopAutoRefresh(flightKey); // No need to keep refreshing
        }

        // Stop refreshing if terminal status
        if (['cancelled', 'landed'].includes(flight.status)) {
          stopAutoRefresh(flightKey);
        }
      } catch (e) {
        console.warn('Flight refresh error:', e);
      }
    }

    refreshTimers[flightKey] = setInterval(doRefresh, 60000); // every 60s
  }

  function stopAutoRefresh(flightKey) {
    if (refreshTimers[flightKey]) {
      clearInterval(refreshTimers[flightKey]);
      delete refreshTimers[flightKey];
    }
  }

  // ── Public: track a flight and render into container ─────

  async function trackFlight(flightNumber, label, containerEl) {
    if (!flightNumber) return;

    containerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:16px;color:var(--text-secondary);">
        <span class="spinner"></span>
        <span>Fetching flight data…</span>
      </div>`;

    try {
      const flight = await fetchFlightData(flightNumber);
      containerEl.innerHTML = renderFlightCard(flight, label);

      // Start auto-refresh if flight is active
      if (['scheduled','boarding','in-air','delayed'].includes(flight.status)) {
        const key = `${flightNumber}_${label}`;
        startAutoRefresh(key, flightNumber, label, containerEl);

        // Update refresh indicator
        const ind = document.getElementById('flight-refresh-indicator');
        if (ind) ind.textContent = 'Auto-refreshing every 60s';
      }
    } catch (e) {
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

  // ── Init: restore saved flight numbers ───────────────────

  function init() {
    const saved = loadFlightNumbers();
    const monInput = document.getElementById('monday-flight-input');
    const friInput = document.getElementById('friday-flight-input');
    if (monInput && saved.monday) monInput.value = saved.monday;
    if (friInput && saved.friday) friInput.value = saved.friday;

    // Wire up buttons
    document.getElementById('track-monday-btn')?.addEventListener('click', () => {
      const num = monInput?.value?.trim().toUpperCase();
      if (!num) return;
      const fri = friInput?.value?.trim().toUpperCase() || '';
      saveFlightNumbers(num, fri);
      const area = document.getElementById('flight-status-area');
      trackFlight(num, 'Monday — Charlotte → Dallas', area);
    });

    document.getElementById('track-friday-btn')?.addEventListener('click', () => {
      const num = friInput?.value?.trim().toUpperCase();
      if (!num) return;
      const mon = monInput?.value?.trim().toUpperCase() || '';
      saveFlightNumbers(mon, num);
      const area = document.getElementById('flight-status-area');
      trackFlight(num, 'Friday — Dallas → Charlotte', area);
    });

    // Auto-track today's flight if saved
    if (saved.monday || saved.friday) {
      const today = new Date().getDay();
      const area = document.getElementById('flight-status-area');
      if (!area) return;

      // Monday departure (Mon = 1)
      if (today === 1 && saved.monday) {
        trackFlight(saved.monday, 'Monday — Charlotte → Dallas', area);
      }
      // Friday return (Fri = 5)
      else if (today === 5 && saved.friday) {
        trackFlight(saved.friday, 'Friday — Dallas → Charlotte', area);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────
  return { init, trackFlight, loadFlightNumbers, saveFlightNumbers };

})();
