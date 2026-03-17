/* content-script-actions.js — user action tracking synced to recording timeline */

(() => {
  let isRecording = false;

  try {
    chrome.storage.local.get('extensionState', (r) => {
      isRecording = r?.extensionState === 'recording';
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.extensionState) {
        isRecording = changes.extensionState.newValue === 'recording';
      }
    });
  } catch { return; }

  function send(eventType, data) {
    if (!isRecording) return;
    try {
      chrome.runtime.sendMessage({ type: 'action-event', eventType, ...data }).catch(() => {});
    } catch {}
  }

  /* --- Element identification --- */

  function getCSSPath(el, maxDepth) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < maxDepth) {
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      let seg = cur.tagName.toLowerCase();
      const classes = [...(cur.classList || [])]
        .filter(c => c.length > 1 && c.length < 25 && !/^(ng-|v-[a-z0-9]{5,}|_[a-z0-9]{4,}|js-)/.test(c))
        .slice(0, 2);
      if (classes.length) seg += '.' + classes.join('.');
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ').slice(0, 120);
  }

  function getInfo(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const role = el.getAttribute('role') || '';
    const ariaLabel = (el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 60);
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = (text.trim() || el.textContent?.trim() || '').slice(0, 80);
    return { tag, id, role, ariaLabel, text, path: getCSSPath(el, 4) };
  }

  /* --- Click tracking --- */

  const CLICKABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary']);
  let lastClick = { time: 0, path: '' };

  document.addEventListener('click', (e) => {
    if (!isRecording) return;
    let el = e.target;
    let cur = el;
    while (cur && cur !== document.body) {
      if (CLICKABLE.has(cur.tagName.toLowerCase()) || cur.getAttribute('role') || cur.hasAttribute('onclick')) {
        el = cur; break;
      }
      cur = cur.parentElement;
    }
    const info = getInfo(el);
    if (!info) return;
    const now = Date.now();
    if (now - lastClick.time < 400 && lastClick.path === info.path) return;
    lastClick = { time: now, path: info.path };
    send('click', info);
  }, true);

  /* --- Modal / dialog tracking --- */

  const visibleModals = new WeakSet();

  function isModal(el) {
    if (!el || el.nodeType !== 1) return false;
    const role = el.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /\b(modal|dialog|popup|drawer|sheet|lightbox)\b/i.test(cls);
  }

  function isVisible(el) {
    try {
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 20;
    } catch { return false; }
  }

  function getModalTitle(el) {
    const h = el.querySelector('[role="heading"],h1,h2,h3,h4,.modal-title,.dialog-title');
    return h ? h.textContent.trim().slice(0, 80) : '';
  }

  function openModal(el) {
    if (visibleModals.has(el) || !isVisible(el)) return;
    visibleModals.add(el);
    const info = getInfo(el);
    if (info) send('modal_open', { ...info, text: getModalTitle(el) || info.text });
  }

  function closeModal(el) {
    if (!visibleModals.has(el)) return;
    visibleModals.delete(el);
    const info = getInfo(el);
    if (info) send('modal_close', info);
  }

  const observer = new MutationObserver((mutations) => {
    if (!isRecording) return;
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isModal(node)) openModal(node);
        node.querySelectorAll('[role="dialog"],[role="alertdialog"]').forEach(openModal);
      }
      for (const node of mut.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (isModal(node)) closeModal(node);
      }
      if (mut.type === 'attributes' && isModal(mut.target)) {
        isVisible(mut.target) ? openModal(mut.target) : closeModal(mut.target);
      }
    }
  });

  try {
    observer.observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open']
    });
  } catch {}

  /* --- Text selection --- */

  let selectionTimer = null;
  document.addEventListener('mouseup', () => {
    if (!isRecording) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      // Only meaningful selections: 3+ chars, not just whitespace
      if (text.length < 3 || text.length > 300) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const el = container.nodeType === 3 ? container.parentElement : container;
      send('text_select', {
        tag: el?.tagName?.toLowerCase() || '',
        id: el?.id ? '#' + el.id : '',
        role: el?.getAttribute?.('role') || '',
        ariaLabel: '',
        text: text.slice(0, 150),
        path: getCSSPath(el, 3),
      });
    }, 300);
  });

  /* --- Form submit --- */

  document.addEventListener('submit', (e) => {
    if (!isRecording) return;
    const form = e.target;
    let action = '';
    try { action = new URL(form.action, location.href).pathname; } catch {}
    send('form_submit', {
      tag: 'form',
      id: form.id ? '#' + form.id : '',
      role: '',
      ariaLabel: form.getAttribute('aria-label') || '',
      text: form.getAttribute('aria-label') || form.id || action,
      path: getCSSPath(form, 3),
      action,
      method: (form.method || 'GET').toUpperCase()
    });
  }, true);

})();
