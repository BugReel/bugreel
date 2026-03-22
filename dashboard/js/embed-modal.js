/**
 * BugReel — Embed Code Generator Modal
 *
 * Usage (from recording.html):
 *   import { showEmbedModal } from '../js/embed-modal.js';
 *   showEmbedModal(recordingId);
 */

const MODAL_ID = 'embedModal';

/**
 * Show the embed code modal for a given recording.
 */
export function showEmbedModal(recordingId) {
  // Remove any existing modal
  const existing = document.getElementById(MODAL_ID);
  if (existing) existing.remove();

  const baseUrl = location.origin;
  const embedUrl = `${baseUrl}/embed/${encodeURIComponent(recordingId)}`;
  const iframeCode = `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="border-radius:8px;"></iframe>`;

  const modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'embed-modal-overlay';
  modal.innerHTML = `
    <div class="embed-modal">
      <div class="embed-modal-header">
        <h3>Embed Video</h3>
        <button class="embed-modal-close" id="embedClose" title="Close">&times;</button>
      </div>

      <div class="embed-modal-body">
        <!-- Preview -->
        <div class="embed-preview">
          <iframe src="${embedUrl}" width="100%" height="220" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="border-radius:6px;"></iframe>
        </div>

        <!-- Embed code -->
        <label class="embed-label">Embed code</label>
        <div class="embed-code-wrap">
          <textarea class="embed-code" id="embedCode" readonly rows="3">${escapeHTMLAttr(iframeCode)}</textarea>
          <button class="embed-copy-btn" id="embedCopy" title="Copy to clipboard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>

        <!-- Options -->
        <div class="embed-options">
          <label class="embed-option">
            <input type="checkbox" id="embedAutoplay"> Autoplay (muted)
          </label>
          <div class="embed-option">
            <label for="embedStart">Start at (seconds)</label>
            <input type="number" id="embedStart" min="0" step="1" value="0" class="embed-input-num">
          </div>
          <label class="embed-option">
            <input type="checkbox" id="embedBranding" checked> Show ${window.__branding?.name || 'BugReel'} branding
          </label>
        </div>

        <!-- Direct link -->
        <label class="embed-label" style="margin-top:12px;">Direct link</label>
        <div class="embed-code-wrap">
          <input class="embed-code embed-link" id="embedLink" readonly value="${escapeHTMLAttr(embedUrl)}">
          <button class="embed-copy-btn" id="embedCopyLink" title="Copy link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Inject styles if not already present
  injectStyles();

  // --- Event listeners ---

  // Close
  const closeBtn = document.getElementById('embedClose');
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', handleEsc);

  // Copy embed code
  document.getElementById('embedCopy').addEventListener('click', () => {
    copyToClipboard(document.getElementById('embedCode').value, document.getElementById('embedCopy'));
  });

  // Copy direct link
  document.getElementById('embedCopyLink').addEventListener('click', () => {
    copyToClipboard(document.getElementById('embedLink').value, document.getElementById('embedCopyLink'));
  });

  // Options → update code
  document.getElementById('embedAutoplay').addEventListener('change', () => updateEmbedCode(recordingId));
  document.getElementById('embedStart').addEventListener('input', () => updateEmbedCode(recordingId));
  document.getElementById('embedBranding').addEventListener('change', () => updateEmbedCode(recordingId));

  // Focus the code for easy selection
  requestAnimationFrame(() => {
    modal.classList.add('visible');
    document.getElementById('embedCode').select();
  });
}

/**
 * Rebuild embed code from current option values.
 */
function updateEmbedCode(recordingId) {
  const baseUrl = location.origin;
  const autoplay = document.getElementById('embedAutoplay').checked;
  const start = parseInt(document.getElementById('embedStart').value) || 0;
  const branding = document.getElementById('embedBranding').checked;

  let embedUrl = `${baseUrl}/embed/${encodeURIComponent(recordingId)}`;
  const params = [];
  if (autoplay) params.push('autoplay=1');
  if (start > 0) params.push(`start=${start}`);
  if (!branding) params.push('branding=0');
  if (params.length) embedUrl += '?' + params.join('&');

  const iframeCode = `<iframe src="${embedUrl}" width="100%" height="400" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="border-radius:8px;"></iframe>`;

  document.getElementById('embedCode').value = iframeCode;
  document.getElementById('embedLink').value = embedUrl;

  // Update preview iframe src
  const previewIframe = document.querySelector('.embed-preview iframe');
  if (previewIframe) {
    previewIframe.src = embedUrl;
  }
}

function closeModal() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  modal.classList.remove('visible');
  document.removeEventListener('keydown', handleEsc);
  setTimeout(() => modal.remove(), 200);
}

function handleEsc(e) {
  if (e.key === 'Escape') closeModal();
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function escapeHTMLAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Inject embed modal styles (only once).
 */
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .embed-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;
      backdrop-filter: blur(4px);
    }
    .embed-modal-overlay.visible { opacity: 1; }

    .embed-modal {
      background: var(--surface, #151d30);
      border: 1px solid var(--border, #334155);
      border-radius: var(--radius-lg, 12px);
      width: 560px;
      max-width: 95vw;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }

    .embed-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border, #334155);
    }
    .embed-modal-header h3 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text, #f1f5f9);
    }
    .embed-modal-close {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--text3, #64748b);
      font-size: 1.3rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .embed-modal-close:hover {
      background: var(--surface2, #1e2d48);
      color: var(--text, #f1f5f9);
    }

    .embed-modal-body {
      padding: 20px;
    }

    .embed-preview {
      margin-bottom: 16px;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
      border: 1px solid var(--border, #334155);
    }

    .embed-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text2, #94a3b8);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .embed-code-wrap {
      position: relative;
      margin-bottom: 12px;
    }
    .embed-code {
      width: 100%;
      background: var(--bg, #060a14);
      border: 1px solid var(--border, #334155);
      border-radius: var(--radius, 8px);
      color: var(--text2, #94a3b8);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.75rem;
      padding: 10px 40px 10px 12px;
      resize: none;
      line-height: 1.5;
    }
    .embed-code:focus {
      outline: none;
      border-color: var(--blue, #3b82f6);
    }
    .embed-link {
      padding: 8px 40px 8px 12px;
    }

    .embed-copy-btn {
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      background: transparent;
      border: none;
      color: var(--text3, #64748b);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s;
    }
    .embed-copy-btn:hover {
      color: var(--text, #f1f5f9);
      background: var(--surface2, #1e2d48);
    }

    .embed-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 0;
    }
    .embed-option {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text2, #94a3b8);
    }
    .embed-option input[type="checkbox"] {
      accent-color: var(--blue, #3b82f6);
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .embed-input-num {
      width: 70px;
      background: var(--bg, #060a14);
      border: 1px solid var(--border, #334155);
      border-radius: var(--radius, 8px);
      color: var(--text, #f1f5f9);
      padding: 4px 8px;
      font-size: 0.85rem;
      margin-left: auto;
    }
    .embed-input-num:focus {
      outline: none;
      border-color: var(--blue, #3b82f6);
    }
  `;
  document.head.appendChild(style);
}
