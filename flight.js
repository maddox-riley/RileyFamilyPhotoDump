// ============================================================
// Riley Family — Flight Module
// AeroDataBox via RapidAPI — tracks any flight by number.
//
// Two slots: Departure and Return. Enter any flight number.
// Dad's device (with RapidAPI key) fetches live data and pushes
// it to Firebase. All family devices read from Firebase.
// ============================================================

window.Flight = (() => {

  const LS_KEY = 'riley_flights2_';
  let refreshTimers = {};

  // ── Helpers ───────────────────────────────────────────────
  function getWeekKey()    { return App.getWeekKey(); }
  function getStorageKey() { return LS_KEY + getWeekKey(); }
  function fbDataPath(num) { return `flightData/${getWeekKey()}/${num.replace(/\s+/g, '')}`; }
  function todayISO()      { return new Date().toISOString().split('T')[0]; }

  function hasApiKey() {
    return !!(CONFIG.RAPIDAPI_KEY && CONFIG.RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE');
  }

  // ── Normalize any stored format → {outbound, return} ─────
  // Handles old {monday, friday} format from Firebase during transition.
  function normalizeFlightData(data) {
    if (!data) return { outbound: null, return: null };
    if ('outbound' in data || 'return' in data) return data;
    // Old format
    if (data.monday || data.friday) {
      return {
        outbound: data.monday ? { num: data.monday } : null,
        return:   data.friday ? { num: data.friday } : null,
      };
    }
    return { outbound: null, return: null };
  }

  // ── Storage ───────────────────────────────────────────────
  function saveFlightData(outboundNum, returnNum) {
    const data = {
      outbound: outboundNum ? { num: outboundNum.trim().toUpperCase() } : null,
      return:   returnNum   ? { num: returnNum.trim().toUpperCase() }   : null,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(data));
    if (window.Sync) Sync.set('flights/' + getWeekKey(), data);
    return data;
  }

  function loadFlightData() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      return raw ? normalizeFlightData(JSON.parse(raw)) : { outbound: null, return: null };
    } catch { return { outbound: null, return: null }; }
  }

  // Alias for tracker.js compatibility
  function loadFlightNumbers() {
    const d = loadFlightData();
    return {
      outbound: d.outbound,
      return:   d.return,
      monday:   d.outbound?.num || '',
      friday:   d.return?.num   || '',
    };
  }

  // ── Local cache (Dad's device) — re-pushed on startup ────
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

  // ── API fetch (always today's date) ───────────────────────
  async function fetchFlightData(flightNumber) {
    if (!hasApiKey()) throw new Error('no_key');
    const url = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${todayISO()}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key':  CONFIG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': CONFIG.AERODATABOX_HOST,
      },
    });
    if (resp.status === 404) throw new Error(`${flightNumber} not found for today.`);
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
    if (s.includes('cancel'))                                                    return 'cancelled';
    if (s.includes('land') || s.includes('arrived'))                             return 'landed';
    if (s.includes('air') || s.includes('en route') || s.includes('departed'))  return 'in-air';
    if (s.includes('board'))                                                     return 'boarding';
    if (s.includes('delay'))                                                     return 'delayed';
    return 'scheduled';
  }

  function estimateProgress(raw) {
    const dep = raw.departure?.scheduledTime?.utc;
    const arr = raw.arrival?.scheduledTime?.utc;
    if (!dep || !arr) return 0.5;
    const now = Date.now(), d = new Date(dep).getTime(), a = new Date(arr).getTime();
    return now <= d ? 0 : now >= a ? 1 : (now - d) / (a - d);
  }

  // ── Format helpers ────────────────────────────────────────
  function fmt(iso) {
    if (!iso) return '--:--';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); }
    catch { return '--:--'; }
  }
  function delay(s, a) { return (!s || !a) ? 0 : Math.round((new Date(a) - new Date(s)) / 60000); }
  function countdown(iso) {
    if (!iso) return '';
    const d = new Date(iso) - Date.now();
    if (d <= 0) return 'Now';
    const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // ── Render flight card ────────────────────────────────────
  function renderFlightCard(flight, label) {
    const depTime  = flight.actualDep || flight.scheduledDep;
    const arrTime  = flight.actualArr || flight.scheduledArr;
    const depDelay = delay(flight.scheduledDep, flight.actualDep);
    const arrDelay = delay(flight.scheduledArr, flight.actualArr);
    const isInAir  = flight.status === 'in-air';
    const prog     = Math.max(5, Math.min(95, (flight.progress || 0) * 100));

    const statusLabel = {
      scheduled: 'Scheduled', boarding: 'Boarding',
      'in-air':  'In Air ✈️', landed:   'Landed ✅',
      delayed:   'Delayed ⚠️', cancelled: 'Cancelled ❌',
    }[flight.status] || flight.rawStatus;

    let alertHtml = '';
    if (flight.status === 'cancelled') {
      alertHtml = `<div class="cancel-alert">⛔ ${flight.flightNumber} has been CANCELLED</div>`;
    } else if (depDelay >= 15 || arrDelay >= 15) {
      alertHtml = `<div class="delay-alert">⚠️ Delayed approximately ${Math.max(depDelay, arrDelay)} minutes</div>`;
    }

    let cdHtml = '';
    if (flight.status === 'scheduled' || flight.status === 'delayed') {
      const cd = countdown(depTime);
      if (cd) cdHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--text-secondary);">🕐 Departs in <strong>${cd}</strong>${flight.depGate ? ` · Gate ${flight.depGate}` : ''}</div>`;
    } else if (flight.status === 'boarding') {
      cdHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--orange);font-weight:700;">🚶 Now Boarding${flight.depGate ? ` · Gate ${flight.depGate}` : ''}</div>`;
    } else if (flight.status === 'in-air') {
      const cd = countdown(arrTime);
      if (cd) cdHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--green);font-weight:600;">✈️ Arrives in <strong>${cd}</strong></div>`;
    } else if (flight.status === 'landed') {
      cdHtml = `<div style="padding:10px 18px;font-size:13px;color:var(--green);font-weight:700;">✅ Landed — ${flight.airline || 'Flight'} has arrived!</div>`;
    }

    const arc = `
      <svg viewBox="0 0 160 50" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:160px;overflow:visible;">
        <path class="flight-path-line" d="M 10,40 Q 80,2 150,40"/>
        ${isInAir
          ? `<circle cx="${10+(prog/100)*140}" cy="${40-Math.sin((prog/100)*Math.PI)*38+2}" r="4" fill="var(--blue)" opacity="0.7"/>
             <text x="${10+(prog/100)*140}" y="${40-Math.sin((prog/100)*Math.PI)*38-6}" font-size="14" text-anchor="middle">✈️</text>`
          : `<text x="80" y="20" font-size="14" text-anchor="middle">✈️</text>`}
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
            <div class="airport-time${depDelay >= 15 ? ' delayed' : ''}">${fmt(flight.scheduledDep)}</div>
            ${flight.actualDep && depDelay >= 5 ? `<div class="airport-time" style="font-size:13px;color:var(--red);">${fmt(flight.actualDep)}</div>` : ''}
          </div>
          <div class="route-arc">${arc}</div>
          <div class="route-airport">
            <div class="airport-code">${flight.arrivalAirport}</div>
            <div class="airport-city">${flight.arrivalCity}</div>
            <div class="airport-time${arrDelay >= 15 ? ' delayed' : ''}">${fmt(flight.scheduledArr)}</div>
            ${flight.actualArr && arrDelay >= 5 ? `<div class="airport-time" style="font-size:13px;color:var(--red);">${fmt(flight.actualArr)}</div>` : ''}
          </div>
        </div>
        ${cdHtml}
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

  // ── Auto-refresh (Dad's device) ───────────────────────────
  function startAutoRefresh(key, num, label, el) {
    stopAutoRefresh(key);
    async function tick() {
      try {
        const f = await fetchFlightData(num);
        if (el.isConnected) el.innerHTML = renderFlightCard(f, label);
        if (f.status === 'landed') {
          const k = `riley_notif_landed_${num}`;
          if (!sessionStorage.getItem(k)) {
            sessionStorage.setItem(k, '1');
            window.Tracker?.showInAppAlert('✈️ Landed!', `${num} has arrived!`);
          }
        }
        if (['cancelled', 'landed'].includes(f.status)) stopAutoRefresh(key);
      } catch (e) { console.warn('Flight refresh:', e); }
    }
    refreshTimers[key] = setInterval(tick, 60000);
  }

  function stopAutoRefresh(key) {
    if (refreshTimers[key]) { clearInterval(refreshTimers[key]); delete refreshTimers[key]; }
  }

  // ── Track one flight slot ─────────────────────────────────
  async function trackFlight(num, label, containerEl) {
    if (!num) return;
    const path = fbDataPath(num);

    // Subscribe so the card updates live when Dad's device pushes new data
    if (window.Sync && Sync.isConfigured()) {
      Sync.subscribe(path, (data) => {
        if (data && containerEl.isConnected) containerEl.innerHTML = renderFlightCard(data, label);
      });
    }

    if (hasApiKey()) {
      // Dad's device: fetch from API
      containerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:16px;color:var(--text-secondary);">
          <span class="spinner"></span><span>Fetching ${num}…</span>
        </div>`;
      try {
        const f = await fetchFlightData(num);
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(f, label);
        if (['scheduled', 'boarding', 'in-air', 'delayed'].includes(f.status)) {
          startAutoRefresh(`${num}_${label}`, num, label, containerEl);
          const ind = document.getElementById('flight-refresh-indicator');
          if (ind) ind.textContent = 'Live · updates every 60s';
        }
      } catch (e) {
        if (!containerEl.isConnected) return;
        if (e.message === 'no_key') {
          containerEl.innerHTML = `
            <div class="error-banner">
              <span class="error-icon">🔑</span>
              <div><strong>RapidAPI key not configured</strong><br/>
              <span style="font-size:13px;">Long-press "Riley Family" → Update API Keys to add your key.</span></div>
            </div>`;
        } else {
          containerEl.innerHTML = `
            <div class="error-banner">
              <span class="error-icon">⚠️</span>
              <div><strong>Could not fetch ${num}</strong><br/>
              <span style="font-size:13px;">${e.message}</span></div>
            </div>`;
        }
      }
    } else {
      // Family device: read from Firebase; subscribe handles live updates
      let cached = null;
      if (window.Sync && Sync.isConfigured()) cached = await Sync.get(path);
      if (cached) {
        if (containerEl.isConnected) containerEl.innerHTML = renderFlightCard(cached, label);
      } else if (containerEl.isConnected) {
        containerEl.innerHTML = `
          <div style="font-size:14px;color:var(--text-secondary);text-align:center;padding:16px 0;">
            ✈️ Waiting for live data on <strong>${num}</strong>…
          </div>`;
      }
    }
  }

  // ── Render all saved flight slots ─────────────────────────
  function renderAllFlights(rawData) {
    const area = document.getElementById('flight-status-area');
    if (!area) return;

    const data  = normalizeFlightData(rawData);
    const slots = [
      data?.outbound?.num ? { num: data.outbound.num, label: 'Departure'     } : null,
      data?.return?.num   ? { num: data.return.num,   label: 'Return Flight' } : null,
    ].filter(Boolean);

    if (slots.length === 0) { area.innerHTML = ''; return; }

    // Build a stable container per slot keyed by flight number so async
    // fetches always write into the correct (connected) element.
    area.innerHTML = slots.map(s =>
      `<div id="fslot-${s.num}" style="margin-top:${slots.indexOf(s) > 0 ? '12px' : '0'}"></div>`
    ).join('');

    slots.forEach(s => {
      const el = document.getElementById(`fslot-${s.num}`);
      if (el) trackFlight(s.num, s.label, el);
    });
  }

  // ── Clear flight UI ───────────────────────────────────────
  function clearFlightUI() {
    ['outbound-flight-input', 'return-flight-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const area = document.getElementById('flight-status-area');
    const fv   = document.getElementById('dad-flight-family-view');
    const ind  = document.getElementById('flight-refresh-indicator');
    if (area) area.innerHTML = '';
    if (fv)   fv.innerHTML   = '';
    if (ind)  ind.textContent = '';
  }

  // ── Clear all tracking (dev tool) ─────────────────────────
  async function clearFlightTracking() {
    const wk    = getWeekKey();
    const saved = loadFlightData();
    Object.keys(refreshTimers).forEach(stopAutoRefresh);
    localStorage.removeItem(getStorageKey());
    [saved.outbound?.num, saved.return?.num].filter(Boolean).forEach(n => {
      localStorage.removeItem(`riley_fdc_${n}`);
    });
    if (window.Sync && Sync.isConfigured()) {
      await Sync.remove(`flightData/${wk}`);
      await Sync.remove(`flights/${wk}`);
    }
    clearFlightUI();
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const saved   = loadFlightData();
    const weekKey = getWeekKey();

    // Populate inputs
    const outEl = document.getElementById('outbound-flight-input');
    const retEl = document.getElementById('return-flight-input');
    if (outEl && saved.outbound?.num) outEl.value = saved.outbound.num;
    if (retEl && saved.return?.num)   retEl.value = saved.return.num;

    // Re-push last-known flight data to Firebase on startup (Dad's device only)
    if (hasApiKey()) {
      [saved.outbound?.num, saved.return?.num].filter(Boolean).forEach(num => {
        const cached = loadFdCache(num);
        if (cached) pushFlightToFirebase(num, cached);
      });
    }

    // Subscribe to flight number changes — fires immediately with current value
    // and again whenever Dad saves a new number on any device.
    if (window.Sync) {
      Sync.subscribe('flights/' + weekKey, (data) => {
        if (!data) { clearFlightUI(); return; }
        const norm = normalizeFlightData(data);
        localStorage.setItem(getStorageKey(), JSON.stringify(norm));
        if (outEl && norm.outbound?.num) outEl.value = norm.outbound.num;
        if (retEl && norm.return?.num)   retEl.value = norm.return.num;
        if (window.Tracker) Tracker.applyDadMode();
        renderAllFlights(norm);
      });
    } else {
      // No Firebase — render from local data
      renderAllFlights(saved);
    }

    // Wire Track buttons
    document.getElementById('track-outbound-btn')?.addEventListener('click', () => {
      const num = outEl?.value?.trim().toUpperCase();
      if (!num) return;
      const cur     = loadFlightData();
      const updated = saveFlightData(num, cur.return?.num || '');
      renderAllFlights(updated);
    });

    document.getElementById('track-return-btn')?.addEventListener('click', () => {
      const num = retEl?.value?.trim().toUpperCase();
      if (!num) return;
      const cur     = loadFlightData();
      const updated = saveFlightData(cur.outbound?.num || '', num);
      renderAllFlights(updated);
    });
  }

  // ── Public API ────────────────────────────────────────────
  return { init, trackFlight, loadFlightNumbers, loadFlightData, saveFlightData, clearFlightTracking };

})();
