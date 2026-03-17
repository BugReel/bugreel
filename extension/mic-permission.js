const btn = document.getElementById('btn-allow');
const contentEl = document.getElementById('content');
const errorEl = document.getElementById('error');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Requesting...';
  errorEl.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    contentEl.innerHTML = '<p class="success">Microphone access granted!</p><p>You can close this tab and use the extension.</p>';
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Try again';
    errorEl.textContent = e.message || 'Permission denied';
    errorEl.style.display = '';
  }
});
