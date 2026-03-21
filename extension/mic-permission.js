// --- Permission buttons ---

const btnMic = document.getElementById('btn-mic');
const btnCam = document.getElementById('btn-cam');
const micError = document.getElementById('mic-error');
const camError = document.getElementById('cam-error');
const systemHint = document.getElementById('system-hint');

// Check existing permissions on load
(async () => {
  try {
    const mic = await navigator.permissions.query({ name: 'microphone' });
    if (mic.state === 'granted') markGranted(btnMic, 'mic');
  } catch {}
  try {
    const cam = await navigator.permissions.query({ name: 'camera' });
    if (cam.state === 'granted') markGranted(btnCam, 'cam');
  } catch {}
})();

function markGranted(btn, type) {
  btn.className = 'btn btn-granted';
  btn.textContent = 'Granted';
  btn.disabled = true;
  if (type === 'mic') chrome.storage.local.set({ micPermissionGranted: true });
  if (type === 'cam') chrome.storage.local.set({ webcamPermissionGranted: true });
}

// Microphone
btnMic.addEventListener('click', async () => {
  btnMic.disabled = true;
  btnMic.textContent = 'Requesting...';
  micError.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    markGranted(btnMic, 'mic');
  } catch (e) {
    btnMic.disabled = false;
    btnMic.textContent = 'Try again';
    btnMic.className = 'btn btn-primary';
    micError.textContent = e.message === 'Permission denied' ? 'Permission denied. Check system settings below.' : e.message;
    micError.style.display = '';
    systemHint.style.display = '';
  }
});

// Camera
btnCam.addEventListener('click', async () => {
  btnCam.disabled = true;
  btnCam.textContent = 'Requesting...';
  camError.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop());
    markGranted(btnCam, 'cam');
  } catch (e) {
    btnCam.disabled = false;
    btnCam.textContent = 'Try again';
    btnCam.className = 'btn btn-primary';
    camError.textContent = e.message === 'Permission denied' ? 'Permission denied. Check system settings below.' : e.message;
    camError.style.display = '';
    systemHint.style.display = '';
  }
});
