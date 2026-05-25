// ============================================================
// Riley Family — AI Module (OpenAI API)
// Generates member summaries and picks the Family Moment.
//
// Images are passed to OpenAI as Cloudinary URLs (not base64)
// so HEIC/HEIF photos from iPhones work correctly — Cloudinary
// auto-converts them to JPEG that OpenAI can fetch directly.
//
// Summaries are pre-generated before the reveal opens, then
// saved to Firebase so every device reads the same result.
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

  // ── Build image content for a media item ─────────────────
  // Prefers Cloudinary URL (works with HEIC/HEIF, no base64 overhead).
  // Falls back to blob → canvas resize → base64 JPEG for local-only items.

  async function imageContentForItem(item) {
    // 1. Cloudinary URL available — use it directly
    if (item.downloadURL) {
      return { type: 'image_url', image_url: { url: item.downloadURL, detail: 'low' } };
    }

    // 2. Local blob — resize to JPEG via canvas (may fail for HEIC on some browsers)
    if (item.data instanceof Blob) {
      try {
        const dataURL = await resizeBlob(item.data, 800);
        if (dataURL) return { type: 'image_url', image_url: { url: dataURL, detail: 'low' } };
      } catch {}
    }

    return null; // couldn't get an image
  }

  // Resize a blob to max maxPx on longest side, return JPEG base64 data URL.
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
    // 1. Local cache — only use if it has valid content (not a stale failed result)
    const local = getLsCache(weekKey, member);
    if (local?.summary) return local;

    // 2. Firebase — another device may have already generated it
    const remote = await getRemote(weekKey, member);
    if (remote?.summary) {
      setLsCache(weekKey, member, remote);
      return remote;
    }

    // 3. Generate with OpenAI
    if (!CONFIG.OPENAI_API_KEY) throw new Error('not configured');

    const photos = mediaItems.filter(m => m.type === 'photo');
    const videos = mediaItems.filter(m => m.type === 'video');
    const voices = mediaItems.filter(m => m.type === 'voice');

    // Build vision content — up to 20 photos (Cloudinary URL preferred)
    const content = [];
    const photoLimit = Math.min(photos.length, 20);
    for (let i = 0; i < photoLimit; i++) {
      const imgContent = await imageContentForItem(photos[i]);
      if (imgContent) content.push(imgContent);
    }

    const mediaDesc = [
      photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : '',
      videos.length > 0 ? `${videos.length} video${videos.length > 1 ? 's' : ''}` : '',
      voices.length > 0 ? `${voices.length} voice recording${voices.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ');

    const hasImages = content.length > 0;

    const textPrompt = hasImages
      ? `Family member: ${member}. They shared ${mediaDesc} this week.

Study the photos above carefully. Write a 3–4 sentence personal recap.
Rules:
- Start with "${member}" by name (e.g. "${member} spent time…" or "${member} was spotted…")
- Describe SPECIFIC things you can see: exact food, places, clothing, expressions, objects, settings
- If you see a meal, name it. If you see a place, describe it. If you see an activity, be precise.
- Do NOT use phrases like "amazing week", "quality time", "great memories", "cherished moments"
- Each sentence must describe something literally visible in the photos
Output ONLY the recap sentences.`
      : `Family member: ${member}. They shared ${mediaDesc} this week.

Write a warm 2–3 sentence personal recap about ${member}'s week.
Start with "${member}" by name. Be warm and specific to this family member's personality and role.
Output ONLY the recap sentences.`;

    content.push({ type: 'text', text: textPrompt });

    const systemPrompt = `You write warm, specific weekly recaps for the Riley Family photo dump app.
When photos are provided, every sentence must reference something literally visible in the images.
Be vivid and personal. Never use generic filler phrases.`;

    const summary = await callOpenAI(
      [{ role: 'user', content: hasImages ? content : textPrompt }],
      systemPrompt
    );

    const result = { summary, generatedAt: Date.now() };
    setLsCache(weekKey, member, result);
    setRemote(weekKey, member, result); // push to Firebase for all other devices
    return result;
  }

  // ── Pick Family Moment of the Week ───────────────────────

  async function pickFamilyMoment(weekKey, allMediaByMember) {
    // 1. Local cache — only use if it has valid content (skip stale null results)
    const localRaw = localStorage.getItem(momentLsKey(weekKey));
    if (localRaw) {
      try {
        const parsed = JSON.parse(localRaw);
        if (parsed?.explanation) return parsed;
        // explanation is null = old failed attempt; fall through to Firebase
      } catch {}
    }

    // 2. Firebase cache
    const remote = await getRemote(weekKey, '_MOMENT');
    if (remote?.explanation) {
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
      // Up to 2 photos per member
      for (let i = 0; i < Math.min(2, photos.length); i++) {
        const imgContent = await imageContentForItem(photos[i]);
        if (imgContent) content.push(imgContent);
      }
    }

    const membersDesc = photosByMember
      .map(p => `${p.member} (${p.count} photo${p.count > 1 ? 's' : ''})`)
      .join(', ');

    const hasImages = content.length > 0;

    const textPrompt = hasImages
      ? `Photos this week from: ${membersDesc}.

Look at ALL the photos. Pick the single best one — the most fun, heartwarming, or interesting.
Write ONE short photo caption (max 12 words) that describes exactly what you see.
Format: just like an Instagram caption — specific, vivid, no fluff.
Examples: "Maddox's team huddling before the big game ⚽" or "Dad's giant dessert at The Yard 🍨"
Output ONLY the caption. Nothing else.`
      : `The Riley Family shared memories this week: ${membersDesc}.
Write one short, warm caption (max 12 words) for the standout family moment.
Output ONLY the caption.`;

    content.push({ type: 'text', text: textPrompt });

    const systemPrompt = `You write short, specific photo captions for the Riley Family's weekly photo dump.
Pick the single best photo and describe exactly what you see in 12 words or fewer.
Be vivid and specific. Never be generic. Output only the caption — no preamble.`;

    // If OpenAI fails, throw so other devices can try — never save a null result
    const explanation = await callOpenAI(
      [{ role: 'user', content: hasImages ? content : textPrompt }],
      systemPrompt
    );

    if (!explanation) throw new Error('OpenAI returned empty response');

    const result = { explanation, generatedAt: Date.now() };
    localStorage.setItem(momentLsKey(weekKey), JSON.stringify(result));
    setRemote(weekKey, '_MOMENT', result);
    return result;
  }

  // ── Pre-generate ALL summaries before reveal opens ────────
  // Tries every member (not just those with local media) so Firebase
  // summaries from other devices are always fetched.
  // onProgress(done, total) called as each completes.

  async function generateAllSummaries(weekKey, groupedMedia, onProgress) {
    // Always try all members — those without local media still check Firebase
    const members = CONFIG.APP.MEMBERS;
    let done = 0;
    const total = members.length + 1; // members + moment

    await Promise.all([
      ...members.map(async (member) => {
        try {
          await generateMemberSummary(weekKey, member, groupedMedia[member] || []);
        } catch (e) {
          console.warn(`Summary for ${member} failed:`, e.message);
        }
        done++;
        if (onProgress) onProgress(done, total);
      }),
      (async () => {
        try {
          await pickFamilyMoment(weekKey, groupedMedia);
        } catch (e) {
          console.warn('Moment generation failed:', e.message);
        }
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
