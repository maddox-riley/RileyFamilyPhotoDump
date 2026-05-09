// ============================================================
// Riley Family — AI Module (OpenAI API)
// Generates member summaries and picks the Family Moment
// ============================================================

window.AI = (() => {

  const CACHE_PREFIX = 'riley_ai_summary_';

  // ── Helpers ───────────────────────────────────────────────

  function cacheKey(weekKey, member) {
    return `${CACHE_PREFIX}${weekKey}_${member}`;
  }

  function getCached(weekKey, member) {
    try {
      const raw = localStorage.getItem(cacheKey(weekKey, member));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function setCache(weekKey, member, data) {
    try {
      localStorage.setItem(cacheKey(weekKey, member), JSON.stringify(data));
    } catch (e) {
      console.warn('AI cache write failed:', e);
    }
  }

  function momentCacheKey(weekKey) {
    return `${CACHE_PREFIX}${weekKey}_MOMENT`;
  }

  // Convert a Blob to base64 data URL
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Core API call (OpenAI chat completions) ───────────────

  async function callOpenAI(messages, systemPrompt = '') {
    const apiKey = CONFIG.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_OPENAI_API_KEY_HERE') {
      throw new Error('OpenAI API key not configured. Add your key to config.js.');
    }

    const allMessages = [];
    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }
    allMessages.push(...messages);

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.OPENAI_MODEL,
        max_tokens: CONFIG.OPENAI_MAX_TOKENS,
        messages: allMessages,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${resp.status}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // ── Generate member summary ───────────────────────────────

  async function generateMemberSummary(weekKey, member, mediaItems) {
    // Return cached if available
    const cached = getCached(weekKey, member);
    if (cached) return cached;

    const photos = mediaItems.filter(m => m.type === 'photo');
    const videos = mediaItems.filter(m => m.type === 'video');
    const voices = mediaItems.filter(m => m.type === 'voice');

    // Build message content array (OpenAI vision format)
    const content = [];

    // Add up to 4 photos as inline images
    const photoLimit = Math.min(photos.length, 4);
    for (let i = 0; i < photoLimit; i++) {
      try {
        const dataURL = await blobToBase64(photos[i].data);
        content.push({
          type: 'image_url',
          image_url: { url: dataURL, detail: 'low' },
        });
      } catch (e) {
        console.warn('Could not convert photo to base64:', e);
      }
    }

    // Build text description
    let desc = `Family member: ${member}\n`;
    desc += `Media shared this week: ${photos.length} photo(s), ${videos.length} video(s), ${voices.length} voice recording(s).\n`;
    if (videos.length > 0) desc += `They also shared ${videos.length} video(s) this week.\n`;
    if (voices.length > 0) desc += `They recorded ${voices.length} voice message(s) this week.\n`;

    content.push({ type: 'text', text: desc });

    const systemPrompt = `You are a warm, friendly family assistant writing short summaries for a weekly family photo dump app called "Riley Family".
Write a 2–3 sentence summary describing what this family member was up to this week based on their shared media.
Be specific about what you can see in the photos. Keep it warm, positive, and personal.
Use "they" pronouns unless the member is clearly "Dad" or "Mom".
Do not mention the number of photos/videos — focus on the activities and moments visible.
Response should be ONLY the summary sentences, no titles or labels.`;

    let summary;
    if (content.length === 1) {
      // No photos — just send the text description
      summary = await callOpenAI([{ role: 'user', content: desc }], systemPrompt);
    } else {
      summary = await callOpenAI([{ role: 'user', content }], systemPrompt);
    }

    const result = { summary, generatedAt: Date.now() };
    setCache(weekKey, member, result);
    return result;
  }

  // ── Pick Family Moment of the Week ───────────────────────

  async function pickFamilyMoment(weekKey, allMediaByMember) {
    // Return cached if available
    const cached = localStorage.getItem(momentCacheKey(weekKey));
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }

    const lines = [];
    const content = [];

    for (const [member, items] of Object.entries(allMediaByMember)) {
      const photos = items.filter(m => m.type === 'photo');
      lines.push(`${member}: ${items.length} total items (${photos.length} photos, ${items.filter(m=>m.type==='video').length} videos, ${items.filter(m=>m.type==='voice').length} voices)`);

      // Add up to 2 photos per member
      for (let i = 0; i < Math.min(2, photos.length); i++) {
        try {
          const dataURL = await blobToBase64(photos[i].data);
          content.push({
            type: 'image_url',
            image_url: { url: dataURL, detail: 'low' },
          });
        } catch {}
      }
    }

    content.push({
      type: 'text',
      text: `Family overview:\n${lines.join('\n')}\n\nLook at the photos above and choose the most memorable, heartwarming, or standout moment from this week. Explain in 2-3 sentences why this is the Family Moment of the Week. Be specific about what you see. Format: just the explanation, no labels or titles.`,
    });

    const systemPrompt = `You are a warm family assistant helping the Riley family celebrate their weekly memories. Pick the most special photo moment and describe why it stands out in 2-3 warm, heartfelt sentences. Be specific about what you observe.`;

    let explanation;
    try {
      if (content.length > 1) {
        explanation = await callOpenAI([{ role: 'user', content }], systemPrompt);
      } else {
        explanation = await callOpenAI([{ role: 'user', content: content[0].text }], systemPrompt);
      }
    } catch (e) {
      explanation = 'A special week full of shared memories with the people who matter most. 💙';
    }

    const result = { explanation, generatedAt: Date.now() };
    localStorage.setItem(momentCacheKey(weekKey), JSON.stringify(result));
    return result;
  }

  // ── Clear cache for a week ────────────────────────────────

  function clearWeekCache(weekKey) {
    CONFIG.APP.MEMBERS.forEach(member => {
      localStorage.removeItem(cacheKey(weekKey, member));
    });
    localStorage.removeItem(momentCacheKey(weekKey));
  }

  // ── Public API ────────────────────────────────────────────
  return {
    generateMemberSummary,
    pickFamilyMoment,
    clearWeekCache,
  };

})();
