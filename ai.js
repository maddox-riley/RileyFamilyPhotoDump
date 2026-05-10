// ============================================================
// Riley Family — AI Module (OpenAI API)
// Generates member summaries and picks the Family Moment.
//
// Summaries are pre-generated before the reveal opens, then
// saved to Firebase so every device reads the same result —
// no API key needed on family members' devices.
// ============================================================

window.AI = (() => {

  const CACHE_PREFIX  = 'riley_ai_summary_';
  const FIREBASE_PATH = 'summaries'; // {weekKey}/{member}

  // ── Local cache ───────────────────────────────────────────

  function lsCacheKey(weekKey, member) {
    return `${CACHE_PREFIX}${weekKey}_${member}`;
  }

  function getLsCache(weekKey, member) {
    try {
      const raw = localStorage.getItem(lsCacheKey(weekKey, member));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setLsCache(weekKey, member, data) {
    try { localStorage.setItem(lsCacheKey(weekKey, member), JSON.stringify(data)); } catch {}
  }

  function momentLsKey(weekKey) { return `${CACHE_PREFIX}${weekKey}_MOMENT`; }

  // ── Firebase cache (shared across all devices) ────────────

  async function getRemote(weekKey, member) {
    if (!window.Sync || !Sync.isConfigured()) return null;
    try { return await Sync.get(`${FIREBASE_PATH}/${weekKey}/${member}`); } catch { return null; }
  }

  async function setRemote(weekKey, member, data) {
    if (!window.Sync || !Sync.isConfigured()) return;
    try { await Sync.set(`${FIREBASE_PATH}/${weekKey}/${member}`, data); } catch {}
  }

  // ── Image resize — shrink photos before sending to OpenAI ─
  // Full-res blobs can be 3–8 MB each; resizing to 800px keeps
  // the request under ~200 KB per image without losing detail.

  async function resizeBlob(blob, maxPx = 800) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // ── OpenAI API call ───────────────────────────────────────

  async function callOpenAI(messages, systemPrompt = '') {
    const apiKey = CONFIG.OPENAI_API_KEY;
    if (!apiKey) throw new Error('not configured');

    const allMessages = [];
    if (systemPrompt) allMessages.push({ role: 'system', content: systemPrompt });
    allMessages.push(...messages);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:      CONFIG.OPENAI_MODEL,
        max_tokens: CONFIG.OPENAI_MAX_TOKENS,
        messages:   allMessages,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${resp.status}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  // ── Generate member summary ───────────────────────────────
  // Cache order: localStorage → Firebase → OpenAI

  async function generateMemberSummary(weekKey, member, mediaItems) {
    // 1. Local cache (instant)
    const local = getLsCache(weekKey, member);
    if (local) return local;

    // 2. Firebase cache (another device may have already generated it)
    const remote = await getRemote(weekKey, member);
    if (remote) {
      setLsCache(weekKey, member, remote);
      return remote;
    }

    // 3. Generate with OpenAI
    if (!CONFIG.OPENAI_API_KEY) throw new Error('not configured');

    const photos = mediaItems.filter(m => m.type === 'photo');
    const videos = mediaItems.filter(m => m.type === 'video');
    const voices = mediaItems.filter(m => m.type === 'voice');

    // Resize up to 5 photos and include as vision content
    const content = [];
    const photoLimit = Math.min(photos.length, 5);
    for (let i = 0; i < photoLimit; i++) {
      try {
        const dataURL = await resizeBlob(photos[i].data, 800);
        if (dataURL) content.push({ type: 'image_url', image_url: { url: dataURL, detail: 'low' } });
      } catch {}
    }

    const mediaDesc = [
      photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : '',
      videos.length > 0 ? `${videos.length} video${videos.length > 1 ? 's' : ''}` : '',
      voices.length > 0 ? `${voices.length} voice recording${voices.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ');

    const textPrompt = `Family member: ${member}
Shared this week: ${mediaDesc}

Study the photos carefully. Write a 3–4 sentence personal recap of ${member}'s week.
Rules:
- Start with "${member}" by name
- Describe what you ACTUALLY SEE in the images — specific food, places, activities, objects, expressions
- If you see a meal, name it. If you see a location, describe it. If you see an activity, describe exactly what's happening.
- Do NOT use generic phrases like "amazing week", "great memories", or "quality time"
- Each sentence must reference something literally visible in the photos
Output ONLY the recap sentences, nothing else.`;

    content.push({ type: 'text', text: textPrompt });

    const systemPrompt = `You write warm, specific weekly recaps for the Riley Family photo dump app.
Your recaps are grounded in what is literally visible in the photos — real food, real places, real activities.
Never be generic. Every sentence should describe something a viewer can actually see in the images.`;

    const summary = await callOpenAI(
      [{ role: 'user', content: content.length > 1 ? content : textPrompt }],
      systemPrompt
    );

    const result = { summary, generatedAt: Date.now() };
    setLsCache(weekKey, member, result);
    setRemote(weekKey, member, result); // push to Firebase for all other devices
    return result;
  }

  // ── Pick Family Moment of the Week ───────────────────────

  async function pickFamilyMoment(weekKey, allMediaByMember) {
    // 1. Local cache
    const localRaw = localStorage.getItem(momentLsKey(weekKey));
    if (localRaw) { try { return JSON.parse(localRaw); } catch {} }

    // 2. Firebase cache
    const remote = await getRemote(weekKey, '_MOMENT');
    if (remote) {
      localStorage.setItem(momentLsKey(weekKey), JSON.stringify(remote));
      return remote;
    }

    // 3. Generate with OpenAI
    if (!CONFIG.OPENAI_API_KEY) throw new Error('not configured');

    const content = [];
    const photosByMember = [];

    for (const [member, items] of Object.entries(allMediaByMember)) {
      const photos = items.filter(m => m.type === 'photo');
      if (photos.length === 0) continue;
      photosByMember.push({ member, count: photos.length });
      // Up to 2 resized photos per member
      for (let i = 0; i < Math.min(2, photos.length); i++) {
        try {
          const dataURL = await resizeBlob(photos[i].data, 800);
          if (dataURL) content.push({ type: 'image_url', image_url: { url: dataURL, detail: 'low' } });
        } catch {}
      }
    }

    const membersDesc = photosByMember.map(p => `${p.member} (${p.count} photo${p.count > 1 ? 's' : ''})`).join(', ');

    content.push({
      type: 'text',
      text: `Photos this week from: ${membersDesc}.

Look at ALL the photos above. Pick the single most memorable, funny, or heartwarming one.
Write 2–3 sentences about it:
1. Describe exactly what is happening in the photo (who, what, where — be specific)
2. Explain why this moment stands out this week
Start by describing what is literally visible. Do NOT be generic. Output ONLY the sentences.`,
    });

    const systemPrompt = `You pick the single best photo moment from the Riley Family's week.
Be specific: name the person, describe the scene, mention real details you can see.
Never use generic language. Make the family feel like you actually looked at their photos.`;

    let explanation = null;
    try {
      explanation = await callOpenAI(
        [{ role: 'user', content: content.length > 1 ? content : (content[0]?.text || '') }],
        systemPrompt
      );
    } catch (e) {
      console.warn('Family moment generation failed:', e);
    }

    const result = { explanation, generatedAt: Date.now() };
    localStorage.setItem(momentLsKey(weekKey), JSON.stringify(result));
    setRemote(weekKey, '_MOMENT', result);
    return result;
  }

  // ── Pre-generate ALL summaries before reveal opens ────────
  // Runs member summaries + moment in parallel.
  // onProgress(done, total) called as each completes.

  async function generateAllSummaries(weekKey, groupedMedia, onProgress) {
    const members = CONFIG.APP.MEMBERS.filter(m => (groupedMedia[m] || []).length > 0);
    let done = 0;
    const total = members.length + 1; // members + moment

    await Promise.all([
      ...members.map(async (member) => {
        try { await generateMemberSummary(weekKey, member, groupedMedia[member] || []); } catch {}
        done++;
        if (onProgress) onProgress(done, total);
      }),
      (async () => {
        try { await pickFamilyMoment(weekKey, groupedMedia); } catch {}
        done++;
        if (onProgress) onProgress(done, total);
      })(),
    ]);
  }

  // ── Clear cache for a week ────────────────────────────────

  function clearWeekCache(weekKey) {
    CONFIG.APP.MEMBERS.forEach(member => {
      localStorage.removeItem(lsCacheKey(weekKey, member));
    });
    localStorage.removeItem(momentLsKey(weekKey));
    if (window.Sync && Sync.isConfigured()) {
      Sync.remove(`${FIREBASE_PATH}/${weekKey}`);
    }
  }

  // ── Public API ────────────────────────────────────────────
  return { generateMemberSummary, pickFamilyMoment, generateAllSummaries, clearWeekCache };

})();
