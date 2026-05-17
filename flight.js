// ============================================================
// Riley Family — Flight Module
// AeroDataBox via RapidAPI — tracks any flight on any day.
//
// Two slots: Departure and Return. Each stores a flight number
// and a date so the API query targets the right day.
//
// Only Dad's device needs the RapidAPI key. After every fetch
// the normalized result is pushed to Firebase so all family
// devices see live status without their own key.
// ============================================================

window.Flight = (() => {

  const LS_KEY    = 'riley_flights2_'; // version 2 key avoids old format collision
  let refreshTimers = {};

  // ── Helpers ───────────────────────────────────────────────
  function getWeekKey()    { return App.getWeekKey(); }
  function getStorageKey() { return LS_KEY + getWeekKey(); }
  function fbDataPath(num) { return `flightData/${getWeekKey()}/${num.replace(/\s+/g, '')}`; }
  function todayISO()      { return new Date().toISOString().split('T')[0]; }

  function hasApiKey() {
    return !!(CONFIG.RAPIDAPI_KEY && CONFIG.RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE');
  }

  // ── Flight data storage ───────────────────────────────────
  // Format: { outbound: {num, date} | null, return: {num, date} | null }

  function saveFlightData(outboundNum, outboundDate, returnNum, returnDate) {
    const data = {
      outbound: outboundNum ? { num: outboundNum.trim().toUpperCase(), date: outboundDate || todayISO() } : null,
      return:   returnNum   ? { num: returnNum.trim().toUpperCase(),   date: returnDate   || todayISO() } : null,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(data));
    if (window.Sync) Sync.set('flights/' + getWeekKey(), data);
    return data;
  }

  function loadFlightData() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return { outbound: null, return: null };
      const parsed = JSON.parse(raw);
      // Migrate old format { monday: 'AA704', friday: 'WN123' }
      if (typeof parsed.monday === 'string' || typeof parsed.friday === 'string') {
        return {
          outbound: parsed.monday ? { num: parsed.monday, date: null } : null,
          return:   parsed.friday ? { num: parsed.friday, date: null } : null,
        };
      }
      return parsed;
    } catch { return { outbound: null, return: null }; }
  }

  // Keep loadFlightNumbers as an alias used by tracker.js
  function loadFlightNumbers() {
    const d = loadFlightData();
    return {
      monday: d.outbound?.num || '',
      friday: d.return?.num   || '',
      outbound: d.outbound,
      return:   d.return,
    };
  }

  // ── Local flight data cache (Dad's device) ───────────────
  function saveFdCache(num, flight) {
    try { localStorage.setItem(`riley_fdc_${num}`, JSON.stringify(flight)); } catch {}
  }
  function loadFdCache(num) {
    try { const r = localStorage.getItem(`riley_fdc_${num}`); return r ? JSON.parse(r) : null; } catch { return null; }
  }

  // ── Push to Firebase ──────────────────────────────────────
  function pushFlightToFirebase(num, flight) {
    if (!window.Sync || !Sync.isConfigured()) return;
    saveFdCache(num, flight);
    Sync.set(fbDataPath(num), flight);
  }

  // ── API fetch ─────────────────────────────────────────────
  async function fetchFlightData(flightNumber, date) {
    if (!hasApiKey()) throw new Error('RapidAPI key not configured.');
    const queryDate = date || todayISO();
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${queryDate}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key':  CONFIG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': CONFIG.AERODATABOX_HOST,
      },
    });

    if (resp.status === 404) throw new Error(`No flight found for ${flightNumber} on ${queryDate}.`);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`API error ${resp.status}${txt ? ': ' + txt : ''}`);
    }

    const data   = await resp.json();
    const flight = Array.isArray(data) ? data[0] : data;
    if (!flight) throw new Error('No flight data returned.');
    const normalized = normalizeFlight(flight, flightNumber);
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
      progress:         raw.greatCircleDistance ? estimateProgress(raw) : null,
      fetchedAt:        Date.now(),
    };
  }

  function mapStatus(s) {
    if (s.includes('cancel'))                                           return 'cancelled';
    if (s.includes('land') || s.includes('arrived'))                   return 'landed';
    if (s.includes('air') || s.includes('en route') || s.includes('departed')) return 'in-air';
    if (s.includes('board'))                                           return 'boarding';
    if (s.includes('delay'))                                           return 'delayed';
    return 'scheduled';
  }

  function estimateProgress(raw) {
    const dep = raw.departure?.scheduledTime?.utc;
    const arr = raw.arrival?.scheduledTime?.utc;
    if (!dep || !arr) return 0.5;
    const now = Date.now(), depMs = new Date(dep).getTime(), arrMs = new Date(arr).getTime();
    if (now <= depMs) return 0;
    if (now >= arrMs) return 1;
    return (now - depMs) / (arrMs - depMs);
  }

  // ── Format helpers ────────────────────────────────────────
  function formatTime(iso) {
    if (!iso) return '--:--';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); }
    catch { return '--:--'; }
  }

  function getDelay(scheduled, actual) {
    if (!scheduled || !actual) return 0;
    return Math.round((new Date(actual) - new Date(scheduled)) / 60000);
  }

  function formatCountdown(targetISO) {
    if (!targetISO) return '';
    const diff = new Date(targetISO) - Date.now();
    if (diff <= 0) return 'Now';
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    try {
      return new Date(isoDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch { return isoDate; }
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
      'scheduled': 'Scheduled', 'boarding': 'Boarding',
      'in-air':    'In Air ✈️', 'landed':   'Landed ✅',
      'delayed':   'Delayed ⚠️', 'cancelled': 'Cancelled ❌',
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
          <circle cx="${10 + (planePos/100)*140}" cy="${40 - Math.sin((planePos/100)*Math.PI)*38+2}" r="4" fill="var(--blue)" opacity="0.7"/>
          <text x="${10 + (planePos/100)*140}" y="${40 - Math.sin((planePos/100)*Math.PI)*38-6}" font-size="14" text-anchor="middle">✈️</text>
        ` : `<text x="80" y="20" font-size="14" text-anchor="middle">✈️</text>`}
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
          <div class="flight-detail-item"><div class="detail-label">Dep Gate</div><div class="detail-value">${flight.depGate || '—'}</div></div>
          <div class="flight-detail-item"><div class="detail-label">Arr Gate</div><div class="detail-value">${flight.arrGate || '—'}</div></div>
          <div class="flight-detail-item"><div class="detail-label">Dep Terminal</div><div class="detail-value">${flight.depTerminal || '—'}</div></div>
          <div class="flight-detail-item"><div class="detail-label">Arr Terminal</div><div class="detail-value">${flight.arrTerminal || '—'}</div></div>
        </div>
        <div style="padding:10px 18px;font-size:11px;color:var(--text-tertiary);text-align:right;">
          Updated ${new Date(flight.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>`;
  }

  // ── Auto-refresh (Dad's device only) ─────────────────────
  function startAutoRefresh(key, num, date, label, containerEl) {
    stopAutoRefresh(key);
    async function doRefresh() {
      try {
        const flight = await fetchFlightData(num, date);
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(flight, label);
        if (flight.status === 'landed') {
          const notifKey = `riley_notif_landed_${num}`;
          if (!sessionStorage.getItem(notifKey)) {
            sessionStorage.setItem(notifKey, '1');
            window.Tracker?.showInAppAlert('✈️ Landed!', `${num} has arrived!`);
          }
        }
        if (['cancelled', 'landed'].includes(flight.status)) stopAutoRefresh(key);
      } catch (e) { console.warn('Flight refresh error:', e); }
    }
    refreshTimers[key] = setInterval(doRefresh, 60000);
  }

  function stopAutoRefresh(key) {
    if (refreshTimers[key]) { clearInterval(refreshTimers[key]); delete refreshTimers[key]; }
  }

  // ── Track a single flight slot ────────────────────────────
  async function trackFlight(num, date, label, containerEl) {
    if (!num) return;
    const path = fbDataPath(num);

    // Subscribe so the card live-updates whenever Dad's device refreshes
    if (window.Sync && Sync.isConfigured()) {
      Sync.subscribe(path, (data) => {
        if (data && containerEl.isConnected) containerEl.innerHTML = renderFlightCard(data, label);
      });
    }

    if (hasApiKey()) {
      containerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:16px;color:var(--text-secondary);">
          <span class="spinner"></span><span>Fetching ${num}…</span>
        </div>`;
      try {
        const flight = await fetchFlightData(num, date);
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(flight, label);
        if (['scheduled', 'boarding', 'in-air', 'delayed'].includes(flight.status)) {
          startAutoRefresh(`${num}_${label}`, num, date, label, containerEl);
          const ind = document.getElementById('flight-refresh-indicator');
          if (ind) ind.textContent = 'Auto-refreshing every 60s';
        }
      } catch (e) {
        if (containerEl.isConnected) {
          containerEl.innerHTML = `
            <div class="error-banner">
              <span class="error-icon">⚠️</span>
              <div><strong>Could not fetch flight data</strong><br/>
              <span style="font-size:13px;">${e.message}</span></div>
            </div>`;
        }
      }
    } else {
      // Family device: read from Firebase
      let cached = null;
      if (window.Sync && Sync.isConfigured()) cached = await Sync.get(path);
      if (cached) {
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(cached, label);
      } else if (containerEl.isConnected) {
        const dateStr = date ? ` · ${formatDate(date)}` : '';
        containerEl.innerHTML = `
          <div style="font-size:14px;color:var(--text-secondary);text-align:center;padding:16px 0;">
            ✈️ <strong>${num}</strong>${dateStr} — tracking data loading…
          </div>`;
      }
    }
  }

  // ── Show all saved flights ────────────────────────────────
  function autoTrackSavedFlights(flightData) {
    const area = document.getElementById('flight-status-area');
    if (!area) return;

    const slots = [
      flightData?.outbound ? { ...flightData.outbound, label: 'Departure' }   : null,
      flightData?.return   ? { ...flightData.return,   label: 'Return Flight' } : null,
    ].filter(Boolean);

    if (slots.length === 0) return;

    // Build a container for each slot
    area.innerHTML = slots.map((_, i) =>
      `<div id="flight-slot-${i}" style="${i > 0 ? 'margin-top:12px;' : ''}"></div>`
    ).join('');

    slots.forEach((slot, i) => {
      const el = document.getElementById(`flight-slot-${i}`);
      if (el) trackFlight(slot.num, slot.date, slot.label, el);
    });
  }

  // ── Clear flight UI on this device ───────────────────────
  function clearFlightUI() {
    const outEl  = document.getElementById('outbound-flight-input');
    const outDt  = document.getElementById('outbound-flight-date');
    const retEl  = document.getElementById('return-flight-input');
    const retDt  = document.getElementById('return-flight-date');
    const area   = document.getElementById('flight-status-area');
    const fv     = document.getElementById('dad-flight-family-view');
    const ind    = document.getElementById('flight-refresh-indicator');

    if (outEl) outEl.value = '';
    if (outDt) outDt.value = '';
    if (retEl) retEl.value = '';
    if (retDt) retDt.value = '';
    if (area)  area.innerHTML = '';
    if (fv)    fv.innerHTML   = '';
    if (ind)   ind.textContent = '';
  }

  // ── Clear all flight tracking (dev tool) ──────────────────
  async function clearFlightTracking() {
    const weekKey = getWeekKey();
    const saved   = loadFlightData();

    Object.keys(refreshTimers).forEach(k => stopAutoRefresh(k));
    localStorage.removeItem(getStorageKey());
    [saved.outbound?.num, saved.return?.num].filter(Boolean).forEach(num => {
      localStorage.removeItem(`riley_fdc_${num}`);
    });

    if (window.Sync && Sync.isConfigured()) {
      await Sync.remove(`flightData/${weekKey}`);
      await Sync.remove(`flights/${weekKey}`);
    }
    clearFlightUI();
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const saved   = loadFlightData();
    const weekKey = getWeekKey();
    const today   = todayISO();

    const outNumEl  = document.getElementById('outbound-flight-input');
    const outDateEl = document.getElementById('outbound-flight-date');
    const retNumEl  = document.getElementById('return-flight-input');
    const retDateEl = document.getElementById('return-flight-date');

    // Populate inputs
    if (outNumEl  && saved.outbound?.num)  outNumEl.value  = saved.outbound.num;
    if (outDateEl) outDateEl.value = saved.outbound?.date || today;
    if (retNumEl  && saved.return?.num)    retNumEl.value  = saved.return.num;
    if (retDateEl) retDateEl.value = saved.return?.date   || today;

    // On Dad's device: re-push last known data to Firebase on startup
    if (hasApiKey()) {
      [saved.outbound?.num, saved.return?.num].filter(Boolean).forEach(num => {
        const cached = loadFdCache(num);
        if (cached) pushFlightToFirebase(num, cached);
      });
    }

    // Subscribe to flight data changes (cross-device)
    if (window.Sync) {
      Sync.subscribe('flights/' + weekKey, (data) => {
        if (!data) { clearFlightUI(); return; }
        localStorage.setItem(getStorageKey(), JSON.stringify(data));
        if (outNumEl  && data.outbound?.num)  outNumEl.value  = data.outbound.num;
        if (outDateEl && data.outbound?.date) outDateEl.value = data.outbound.date;
        if (retNumEl  && data.return?.num)    retNumEl.value  = data.return.num;
        if (retDateEl && data.return?.date)   retDateEl.value = data.return.date;
        if (window.Tracker) Tracker.applyDadMode();
        autoTrackSavedFlights(data);
      });
    }

    // Wire Save buttons
    document.getElementById('track-outbound-btn')?.addEventListener('click', () => {
      const num  = outNumEl?.value?.trim().toUpperCase();
      const date = outDateEl?.value || today;
      if (!num) return;
      const current = loadFlightData();
      const updated = saveFlightData(num, date, current.return?.num || '', current.return?.date || '');
      const area = document.getElementById('flight-status-area');
      if (area) autoTrackSavedFlights(updated);
    });

    document.getElementById('track-return-btn')?.addEventListener('click', () => {
      const num  = retNumEl?.value?.trim().toUpperCase();
      const date = retDateEl?.value || today;
      if (!num) return;
      const current = loadFlightData();
      const updated = saveFlightData(current.outbound?.num || '', current.outbound?.date || '', num, date);
      const area = document.getElementById('flight-status-area');
      if (area) autoTrackSavedFlights(updated);
    });

    // Auto-show on load for all devices and profiles
    autoTrackSavedFlights(saved);
  }

  // ── Public API ────────────────────────────────────────────
  return { init, trackFlight, loadFlightNumbers, loadFlightData, saveFlightData, clearFlightTracking };

})();
