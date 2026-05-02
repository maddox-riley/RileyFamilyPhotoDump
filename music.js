// ============================================================
// Riley Family — Music Module
// Handles random song selection per weekly reveal, audio
// playback, fade in/out, and mute toggle.
//
// ADD YOUR SONGS: Place .mp4 audio files in the /music folder,
// then add their filenames to the MUSIC_FILES array below.
// ============================================================

window.Music = (() => {

  // ── Song list — update this when you add songs to /music ──
  const MUSIC_FILES = [
    'Brand New Lyrics - Ben Rector.mp3',
    'Great Night - Needtobreathe.mp3',
    'Tame Impala - The Less I Know The Better (Audio).mp3',
  ];

  // Fallback if no music files are defined
  const HAS_MUSIC = MUSIC_FILES.length > 0;

  const LS_SONG_KEY = 'riley_reveal_song_';
  let audio = null;
  let isMuted = false;
  let currentSong = null;
  let fadeInterval = null;

  // ── Song selection — one per week, persisted ──────────────

  function getSongForWeek(weekKey) {
    if (!HAS_MUSIC) return null;

    const storageKey = LS_SONG_KEY + weekKey;
    const stored = localStorage.getItem(storageKey);
    if (stored && MUSIC_FILES.includes(stored)) return stored;

    // Pick a new random song for this week
    const song = MUSIC_FILES[Math.floor(Math.random() * MUSIC_FILES.length)];
    localStorage.setItem(storageKey, song);
    return song;
  }

  // ── Audio control ─────────────────────────────────────────

  function createAudio(song) {
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    audio = new Audio(`music/${song}`);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';

    // Start at a random point in the song (leave at least 30s to play)
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && audio.duration > 60) {
        const maxStart = audio.duration - 30;
        audio.currentTime = Math.random() * maxStart;
      }
    }, { once: true });

    return audio;
  }

  function clearFade() {
    if (fadeInterval) {
      clearInterval(fadeInterval);
      fadeInterval = null;
    }
  }

  function fadeIn(targetVolume = 1, durationMs = 1000) {
    if (!audio) return;
    clearFade();
    const steps = 40;
    const stepMs = durationMs / steps;
    const stepVol = targetVolume / steps;
    audio.volume = 0;

    fadeInterval = setInterval(() => {
      if (!audio) { clearFade(); return; }
      const next = Math.min(audio.volume + stepVol, targetVolume);
      audio.volume = isMuted ? 0 : next;
      if (next >= targetVolume) clearFade();
    }, stepMs);
  }

  function fadeOut(durationMs = 800) {
    return new Promise((resolve) => {
      if (!audio) { resolve(); return; }
      clearFade();
      const startVol = audio.volume;
      const steps = 30;
      const stepMs = durationMs / steps;
      const stepVol = startVol / steps;

      fadeInterval = setInterval(() => {
        if (!audio) { clearFade(); resolve(); return; }
        const next = Math.max(audio.volume - stepVol, 0);
        audio.volume = next;
        if (next <= 0) {
          clearFade();
          audio.pause();
          resolve();
        }
      }, stepMs);
    });
  }

  // ── Public: start music for reveal ───────────────────────

  async function startReveal(weekKey) {
    currentSong = getSongForWeek(weekKey);
    if (!currentSong) return null; // No music configured

    createAudio(currentSong);

    try {
      await audio.play();
      fadeIn(1, 1000);
    } catch (e) {
      // Autoplay blocked — that's ok, user will interact with screen
      console.warn('Autoplay blocked:', e);
      // Try on next user gesture
      const tryPlay = async () => {
        try {
          await audio.play();
          fadeIn(1, 1000);
        } catch {}
        document.removeEventListener('click', tryPlay, { once: true });
      };
      document.addEventListener('click', tryPlay, { once: true });
    }

    return currentSong;
  }

  async function stopReveal() {
    await fadeOut(800);
    if (audio) {
      audio.src = '';
      audio = null;
    }
    currentSong = null;
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (audio) {
      audio.volume = isMuted ? 0 : 1;
    }
    return isMuted;
  }

  function getMuted() { return isMuted; }

  function getCurrentSong() { return currentSong; }

  function getDisplayName(filename) {
    if (!filename) return '';
    return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  }

  function hasMusicFiles() { return HAS_MUSIC; }

  // ── Public API ────────────────────────────────────────────
  return {
    startReveal,
    stopReveal,
    toggleMute,
    getMuted,
    getCurrentSong,
    getDisplayName,
    hasMusicFiles,
    getSongForWeek,
  };

})();
