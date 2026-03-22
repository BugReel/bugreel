import { Router } from 'express';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { getBrandingConfig } from './settings.js';

const router = Router();

/**
 * GET /embed/:id — Serve a minimal embeddable video player page.
 *
 * Query params:
 *   ?autoplay=1   — auto-play the video on load
 *   ?start=30     — start playback at 30 seconds
 *   ?branding=0   — hide the BugReel logo
 */
router.get('/embed/:id', (req, res) => {
  const db = getDB();
  // Support both recording ID and share_token (UUID)
  let recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(req.params.id);
  }

  if (!recording) {
    return res.status(404).send(embedErrorPage('Recording not found'));
  }

  const card = db.prepare('SELECT title, summary FROM cards WHERE recording_id = ?').get(recording.id);

  const autoplay = req.query.autoplay === '1';
  const startTime = parseFloat(req.query.start) || 0;
  const showBranding = req.query.branding !== '0';

  const title = card?.title || recording.id;
  // Always use recording.id for video src (authenticated API endpoint)
  const videoSrc = `/api/recordings/${encodeURIComponent(recording.id)}/video`;

  // Remove X-Frame-Options to allow embedding
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Load CTA buttons for this recording
  const ctaButtons = db.prepare('SELECT * FROM cta_buttons WHERE recording_id = ? AND enabled = 1 ORDER BY created_at ASC').all(recording.id);

  const branding = getBrandingConfig();
  res.send(embedPage({ title, videoSrc, autoplay, startTime, showBranding, recordingId: recording.id, branding, ctaButtons }));
});

/**
 * GET /embed/:id/code — Return embed HTML snippet for a recording.
 * Uses share_token in the embed URL to prevent ID enumeration.
 */
router.get('/embed/:id/code', (req, res) => {
  const db = getDB();
  let recording = db.prepare('SELECT id, share_token FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    recording = db.prepare('SELECT id, share_token FROM recordings WHERE share_token = ?').get(req.params.id);
  }

  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const baseUrl = config.dashboardUrl || `${req.protocol}://${req.get('host')}`;
  // Use share_token in public embed URLs to prevent enumeration
  const publicId = recording.share_token || recording.id;
  const embedUrl = `${baseUrl}/embed/${encodeURIComponent(publicId)}`;

  const iframe = `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="border-radius:8px;"></iframe>`;

  res.json({
    embed_url: embedUrl,
    iframe,
    recording_id: recording.id,
    share_token: recording.share_token,
  });
});

/**
 * Generate the full embed HTML page with inline CSS and JS.
 */
function embedPage({ title, videoSrc, autoplay, startTime, showBranding, recordingId, branding = {}, ctaButtons = [] }) {
  const escapedTitle = escapeHTML(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapedTitle} — BugReel</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#060a14;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}

.embed-wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}

video{width:100%;height:100%;object-fit:contain;background:#000;outline:none}
video::cue{background:rgba(0,0,0,.75);color:#fff;font-size:14px;border-radius:2px}

/* Subtitle toggle */
.btn-cc{font-size:11px;font-weight:700;line-height:1;padding:2px 4px !important;letter-spacing:.5px;border:1.5px solid currentColor !important;border-radius:3px !important;opacity:.5}
.btn-cc.active{opacity:1;color:#3b82f6;border-color:#3b82f6 !important}

/* Custom controls overlay */
.controls{position:absolute;bottom:0;left:0;right:0;padding:8px 12px;background:linear-gradient(transparent,rgba(0,0,0,.85));display:flex;align-items:center;gap:8px;opacity:0;transition:opacity .25s;z-index:10}
.embed-wrap:hover .controls,
.embed-wrap.controls-visible .controls{opacity:1}
.embed-wrap.paused .controls{opacity:1}

.controls button{background:none;border:none;color:#f1f5f9;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .15s}
.controls button:hover{background:rgba(255,255,255,.15)}
.controls button svg{width:18px;height:18px}

/* Progress bar */
.progress-wrap{flex:1;height:4px;background:rgba(255,255,255,.2);border-radius:2px;cursor:pointer;position:relative;transition:height .15s}
.progress-wrap:hover{height:6px}
.progress-fill{height:100%;background:#3b82f6;border-radius:2px;width:0%;pointer-events:none;transition:none}
.progress-buffer{position:absolute;top:0;left:0;height:100%;background:rgba(255,255,255,.1);border-radius:2px;pointer-events:none}

/* Time */
.time-display{font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;min-width:60px;user-select:none}

/* Volume */
.volume-wrap{display:flex;align-items:center;gap:4px}
.volume-slider{width:60px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;cursor:pointer;position:relative}
.volume-fill{height:100%;background:#f1f5f9;border-radius:2px;pointer-events:none}

/* Branding */
.branding{position:absolute;top:8px;left:10px;display:flex;align-items:center;gap:5px;opacity:0;transition:opacity .25s;z-index:10;text-decoration:none;color:rgba(255,255,255,.5);font-size:10px;font-weight:600;letter-spacing:.3px}
.branding:hover{color:rgba(255,255,255,.8)}
.embed-wrap:hover .branding{opacity:1}
.branding svg{width:14px;height:14px}

/* Big play button (initial state) */
.big-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(59,130,246,.85);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:20;transition:transform .15s,background .15s;backdrop-filter:blur(4px)}
.big-play:hover{transform:translate(-50%,-50%) scale(1.08);background:rgba(59,130,246,1)}
.big-play svg{width:28px;height:28px;margin-left:3px}
.big-play.hidden{display:none}

/* Fullscreen */
.embed-wrap:fullscreen video,.embed-wrap:-webkit-full-screen video{width:100%;height:100%}

/* CTA overlay */
.cta-overlay{position:absolute;bottom:60px;left:50%;transform:translateX(-50%);z-index:15;display:none;animation:ctaFadeIn .3s ease}
.cta-overlay.visible{display:block}
.cta-btn{display:inline-block;padding:10px 24px;border-radius:6px;font-weight:600;font-size:14px;text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s}
.cta-btn:hover{transform:scale(1.05);box-shadow:0 4px 16px rgba(0,0,0,.3)}
.cta-dismiss{position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;border:none;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center}
@keyframes ctaFadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
</style>
</head>
<body>
<div class="embed-wrap${autoplay ? '' : ' paused'}" id="wrap">

  ${showBranding ? (() => {
    const logoUrl = branding.logo_url;
    const logoLink = branding.logo_link || 'https://bugreel.io';
    if (logoUrl) {
      return `<a class="branding" href="${escapeHTML(logoLink)}" target="_blank" rel="noopener"><img src="${escapeHTML(logoUrl)}" alt="" style="height:18px;max-width:120px;object-fit:contain;vertical-align:middle;"></a>`;
    }
    return `<a class="branding" href="${escapeHTML(logoLink)}" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
    BugReel
  </a>`;
  })() : ''}

  <video id="video" preload="metadata" playsinline${autoplay ? ' autoplay muted' : ''}>
    <source src="${videoSrc}" type="video/webm">
    <track kind="captions" src="/api/recordings/${recordingId}/subtitles.vtt" srclang="auto" label="Captions" default>
  </video>

  <button class="big-play${autoplay ? ' hidden' : ''}" id="bigPlay">
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
  </button>

  <div class="controls">
    <button id="btnPlay" title="Play/Pause">
      <svg id="iconPlay" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      <svg id="iconPause" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
    </button>

    <div class="progress-wrap" id="progress">
      <div class="progress-buffer" id="progressBuffer"></div>
      <div class="progress-fill" id="progressFill"></div>
    </div>

    <span class="time-display" id="timeDisplay">0:00 / 0:00</span>

    <div class="volume-wrap">
      <button id="btnMute" title="Mute">
        <svg id="iconVolume" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
        <svg id="iconMuted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
      </button>
      <div class="volume-slider" id="volumeSlider">
        <div class="volume-fill" id="volumeFill" style="width:100%"></div>
      </div>
    </div>

    <button id="btnCC" class="btn-cc active" title="Captions">CC</button>

    <button id="btnFullscreen" title="Fullscreen">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
    </button>
  </div>

  ${ctaButtons.length > 0 ? ctaButtons.map((cta, i) => `
  <div class="cta-overlay" id="ctaOverlay${i}" data-position="${escapeHTML(cta.position)}" data-show-at="${cta.show_at_seconds ?? ''}">
    <a class="cta-btn" href="${escapeHTML(cta.url)}" target="_blank" rel="noopener" style="background:${escapeHTML(cta.bg_color)};color:${escapeHTML(cta.text_color)}">${escapeHTML(cta.label)}</a>
    <button class="cta-dismiss" onclick="this.parentElement.classList.remove('visible')">&times;</button>
  </div>`).join('') : ''}
</div>

<script>
(function() {
  var video = document.getElementById('video');
  var wrap = document.getElementById('wrap');
  var bigPlay = document.getElementById('bigPlay');
  var btnPlay = document.getElementById('btnPlay');
  var iconPlay = document.getElementById('iconPlay');
  var iconPause = document.getElementById('iconPause');
  var progress = document.getElementById('progress');
  var progressFill = document.getElementById('progressFill');
  var progressBuffer = document.getElementById('progressBuffer');
  var timeDisplay = document.getElementById('timeDisplay');
  var btnMute = document.getElementById('btnMute');
  var iconVolume = document.getElementById('iconVolume');
  var iconMuted = document.getElementById('iconMuted');
  var volumeSlider = document.getElementById('volumeSlider');
  var volumeFill = document.getElementById('volumeFill');
  var btnFullscreen = document.getElementById('btnFullscreen');
  var btnCC = document.getElementById('btnCC');

  var startTime = ${startTime};
  var hideTimer = null;

  // Set start time
  if (startTime > 0) {
    video.addEventListener('loadedmetadata', function() {
      video.currentTime = startTime;
    }, { once: true });
  }

  function fmt(s) {
    s = Math.floor(s || 0);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function updatePlayIcons() {
    var playing = !video.paused && !video.ended;
    iconPlay.style.display = playing ? 'none' : '';
    iconPause.style.display = playing ? '' : 'none';
    bigPlay.classList.toggle('hidden', playing);
    wrap.classList.toggle('paused', !playing);
  }

  function updateProgress() {
    if (video.duration) {
      progressFill.style.width = (video.currentTime / video.duration * 100) + '%';
      timeDisplay.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    }
  }

  function updateBuffer() {
    if (video.buffered.length > 0 && video.duration) {
      var end = video.buffered.end(video.buffered.length - 1);
      progressBuffer.style.width = (end / video.duration * 100) + '%';
    }
  }

  function togglePlay() {
    if (video.paused || video.ended) {
      video.play();
    } else {
      video.pause();
    }
  }

  function showControls() {
    wrap.classList.add('controls-visible');
    clearTimeout(hideTimer);
    if (!video.paused) {
      hideTimer = setTimeout(function() { wrap.classList.remove('controls-visible'); }, 2500);
    }
  }

  // Events
  video.addEventListener('play', updatePlayIcons);
  video.addEventListener('pause', updatePlayIcons);
  video.addEventListener('ended', updatePlayIcons);
  video.addEventListener('timeupdate', updateProgress);
  video.addEventListener('progress', updateBuffer);

  bigPlay.addEventListener('click', function() {
    video.muted = false;
    togglePlay();
  });

  btnPlay.addEventListener('click', togglePlay);

  video.addEventListener('click', togglePlay);

  // Progress seek
  progress.addEventListener('click', function(e) {
    var rect = progress.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  });

  // Mute toggle
  btnMute.addEventListener('click', function() {
    video.muted = !video.muted;
    iconVolume.style.display = video.muted ? 'none' : '';
    iconMuted.style.display = video.muted ? '' : 'none';
    volumeFill.style.width = video.muted ? '0%' : (video.volume * 100) + '%';
  });

  // Volume slider
  volumeSlider.addEventListener('click', function(e) {
    var rect = volumeSlider.getBoundingClientRect();
    var vol = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.volume = vol;
    video.muted = vol === 0;
    volumeFill.style.width = (vol * 100) + '%';
    iconVolume.style.display = video.muted ? 'none' : '';
    iconMuted.style.display = video.muted ? '' : 'none';
  });

  // Fullscreen
  btnFullscreen.addEventListener('click', function() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrap.requestFullscreen().catch(function() {
        // Fallback for older browsers
        if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      });
    }
  });

  // Mouse move → show controls
  wrap.addEventListener('mousemove', showControls);
  wrap.addEventListener('mouseleave', function() {
    if (!video.paused) {
      hideTimer = setTimeout(function() { wrap.classList.remove('controls-visible'); }, 800);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    if (e.key === 'f') { btnFullscreen.click(); }
    if (e.key === 'm') { btnMute.click(); }
    if (e.key === 'c') { btnCC.click(); }
    if (e.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); }
    if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
  });

  // Subtitle toggle
  btnCC.addEventListener('click', function() {
    var track = video.textTracks[0];
    if (track) {
      var showing = track.mode === 'showing';
      track.mode = showing ? 'hidden' : 'showing';
      btnCC.classList.toggle('active', !showing);
    }
  });
  // Hide CC button if no subtitles available
  video.addEventListener('loadedmetadata', function() {
    var track = video.textTracks[0];
    if (!track) { btnCC.style.display = 'none'; return; }
    // Check if track loaded successfully
    track.addEventListener('error', function() { btnCC.style.display = 'none'; });
    // Also check via cuechange — if no cues after load, hide
    if (track.mode === 'disabled') track.mode = 'showing';
  }, { once: true });

  // CTA overlay logic
  var ctaOverlays = document.querySelectorAll('.cta-overlay');
  if (ctaOverlays.length > 0) {
    var ctaShown = {};

    video.addEventListener('ended', function() {
      ctaOverlays.forEach(function(el, i) {
        if (el.dataset.position === 'end') el.classList.add('visible');
      });
    });

    video.addEventListener('play', function() {
      ctaOverlays.forEach(function(el, i) {
        if (el.dataset.position === 'start' && !ctaShown['start_' + i]) {
          ctaShown['start_' + i] = true;
          el.classList.add('visible');
          setTimeout(function() { el.classList.remove('visible'); }, 5000);
        }
      });
    });

    video.addEventListener('timeupdate', function() {
      ctaOverlays.forEach(function(el, i) {
        if (el.dataset.position === 'custom' && el.dataset.showAt && !ctaShown['custom_' + i]) {
          var showAt = parseFloat(el.dataset.showAt);
          if (video.currentTime >= showAt) {
            ctaShown['custom_' + i] = true;
            el.classList.add('visible');
          }
        }
      });
    });
  }
})();
</script>
</body>
</html>`;
}

/**
 * Simple error page for embed.
 */
function embedErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Error — BugReel</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#060a14;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center}
.error{text-align:center}
.error svg{width:48px;height:48px;margin-bottom:12px;color:#64748b}
.error p{font-size:14px}
</style>
</head>
<body>
<div class="error">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
  <p>${escapeHTML(message)}</p>
</div>
</body>
</html>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default router;
