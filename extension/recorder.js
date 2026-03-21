/* recorder.js — Universal MediaRecorder for BugReel
 * Works in Chrome offscreen documents AND Firefox popup windows.
 *
 * Chrome tab mode:  streamId from tabCapture → getUserMedia({chromeMediaSource: 'tab'})
 * Chrome screen mode: getDisplayMedia() directly
 * Firefox (all modes): getDisplayMedia() — user selects source via browser picker
 */

let mediaRecorder = null;
let recordedChunks = [];
let captureStream = null;
let micStream = null;
let mixedStream = null;
let audioContext = null;
let maxDurationTimer = null;
let maxDurationRemaining = 0;

// Webcam PiP
let webcamStream = null;
let webcamVideo = null;
let pipCanvas = null;
let pipCtx = null;
let pipAnimationFrame = null;
let screenVideo = null;

// Mic preview
let micPreviewStream = null;
let micPreviewCtx = null;
let micPreviewAnalyser = null;
let micPreviewInterval = null;

// Live mic level during recording
let micLevelCtx = null;
let micLevelAnalyser = null;
let micLevelInterval = null;

// Upload state
let pendingServerUrl = '';
let pendingAuthor = '';
let pendingExtensionToken = '';
let pendingAutoUpload = null;

// Firefox recorder window timer
let recorderTimerInterval = null;

// Defaults — overridden by user settings from chrome.storage.local
let MAX_DURATION_MS = 10 * 60 * 1000;
let MAX_VIDEO_WIDTH = 1280;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'offscreen-start':
      startRecording(message.streamId, message.serverUrl, message.author, message.mode, message.micEnabled, message.systemAudioEnabled, message.extensionToken, message.maxDuration, message.videoQuality, message.webcamEnabled, message.webcamDeviceId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'offscreen-pause':
      pauseRecording();
      sendResponse({ success: true });
      return false;

    case 'offscreen-resume':
      resumeRecording();
      sendResponse({ success: true });
      return false;

    case 'offscreen-finish':
      console.log('[BugReel] Received offscreen-finish, autoUpload=' + !!message.autoUpload, 'mediaRecorder state=' + mediaRecorder?.state);
      if (message.autoUpload) {
        pendingAutoUpload = {
          urlEvents: message.urlEvents,
          consoleEvents: message.consoleEvents,
          actionEvents: message.actionEvents,
          manualMarkers: message.manualMarkers,
          metadata: message.metadata
        };
      } else {
        pendingAutoUpload = null;
      }
      finishRecording();
      sendResponse({ success: true });
      return false;

    case 'offscreen-upload':
      doUpload({ urlEvents: message.urlEvents, consoleEvents: message.consoleEvents, actionEvents: message.actionEvents, manualMarkers: message.manualMarkers, metadata: message.metadata, segments: message.segments })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'offscreen-discard':
      doDiscard()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'mic-preview-start':
      startMicPreview()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'mic-preview-stop':
      stopMicPreview();
      sendResponse({ success: true });
      return false;
  }
});

/* --- Mic Preview --- */

async function startMicPreview() {
  stopMicPreview();
  try {
    micPreviewStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    micPreviewCtx = new AudioContext();
    micPreviewAnalyser = micPreviewCtx.createAnalyser();
    micPreviewAnalyser.fftSize = 256;
    micPreviewAnalyser.smoothingTimeConstant = 0.5;
    micPreviewCtx.createMediaStreamSource(micPreviewStream).connect(micPreviewAnalyser);

    const dataArray = new Uint8Array(micPreviewAnalyser.frequencyBinCount);
    micPreviewInterval = setInterval(() => {
      micPreviewAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const level = Math.min(100, Math.round((sum / dataArray.length) * 1.5));
      chrome.runtime.sendMessage({ type: 'mic-level', level }).catch(() => {});
    }, 100);
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'mic-level', level: -1, error: e.message }).catch(() => {});
  }
}

function stopMicPreview() {
  if (micPreviewInterval) { clearInterval(micPreviewInterval); micPreviewInterval = null; }
  if (micPreviewStream) { micPreviewStream.getTracks().forEach(t => t.stop()); micPreviewStream = null; }
  if (micPreviewCtx) { micPreviewCtx.close().catch(() => {}); micPreviewCtx = null; }
  micPreviewAnalyser = null;
}

/* --- Recording --- */

async function startRecording(streamId, serverUrl, author, mode, micEnabled, systemAudioEnabled, extensionToken, maxDuration, videoQuality, webcamEnabled, webcamDeviceId) {
  pendingServerUrl = serverUrl;
  pendingAuthor = author;
  pendingExtensionToken = extensionToken || '';

  // Apply user settings (passed via message from background.js — chrome.storage is not available in offscreen)
  const maxDurationMin = maxDuration || 10;
  MAX_DURATION_MS = maxDurationMin * 60 * 1000;
  MAX_VIDEO_WIDTH = videoQuality === '1080p' ? 1920 : 1280;

  let hasMic = false;
  let hasSystemAudio = false;
  let hasWebcam = false;

  // Reuse mic stream from preview if available
  if (micEnabled && micPreviewStream && micPreviewStream.getAudioTracks().length > 0) {
    micStream = micPreviewStream;
    micPreviewStream = null;
    hasMic = true;
  }
  if (micPreviewInterval) { clearInterval(micPreviewInterval); micPreviewInterval = null; }
  if (micPreviewCtx) { micPreviewCtx.close().catch(() => {}); micPreviewCtx = null; }
  micPreviewAnalyser = null;

  // Get capture stream — branching by streamId presence
  if (streamId) {
    // Chrome tab capture: streamId from chrome.tabCapture.getMediaStreamId()
    if (systemAudioEnabled) {
      captureStream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
      });
    } else {
      captureStream = await navigator.mediaDevices.getUserMedia({
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
      });
    }
    hasSystemAudio = captureStream.getAudioTracks().length > 0;
  } else {
    // Screen/desktop capture via getDisplayMedia (Chrome desktop + all Firefox modes)
    const displayMediaOptions = {
      video: {
        displaySurface: 'monitor',    // Hint: prefer full-screen capture
      },
      audio: systemAudioEnabled,
      selfBrowserSurface: 'exclude',  // Don't offer current tab in picker
      monitorTypeSurfaces: 'include', // Ensure monitor surfaces appear in picker
      surfaceSwitching: 'include',    // Allow switching captured surface during recording
    };

    // CaptureController: prevent Chrome from stealing focus after screen selection (macOS fix)
    if (typeof CaptureController !== 'undefined') {
      const controller = new CaptureController();
      displayMediaOptions.controller = controller;
      captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      // Must call setFocusBehavior synchronously after getDisplayMedia resolves
      try { controller.setFocusBehavior('no-focus-change'); } catch (e) {
        console.warn('[BugReel] setFocusBehavior not supported:', e.message);
      }
    } else {
      captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    }
    hasSystemAudio = captureStream.getAudioTracks().length > 0;
  }

  // If mic wasn't reused from preview, try to get it fresh
  if (micEnabled && !hasMic) {
    // Check if any audio input device exists before requesting getUserMedia
    let hasAudioInput = true;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      hasAudioInput = devices.some(d => d.kind === 'audioinput' && d.deviceId !== '');
    } catch { /* assume available */ }

    if (hasAudioInput) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        hasMic = micStream.getAudioTracks().length > 0;
      } catch (e) {
        console.error('Mic capture failed:', e.message);
        micStream = null;
        hasMic = false;
      }
    } else {
      console.log('[BugReel] No audio input device found, skipping mic capture');
      hasMic = false;
    }
  }

  // Webcam capture for PiP overlay
  if (webcamEnabled) {
    try {
      const webcamConstraints = {
        video: webcamDeviceId
          ? { deviceId: { exact: webcamDeviceId }, width: { ideal: 200 }, height: { ideal: 200 } }
          : { width: { ideal: 200 }, height: { ideal: 200 } },
        audio: false
      };
      webcamStream = await navigator.mediaDevices.getUserMedia(webcamConstraints);
      hasWebcam = webcamStream.getVideoTracks().length > 0;
      console.log('[BugReel] Webcam captured for PiP overlay');
    } catch (e) {
      console.warn('[BugReel] Webcam capture failed:', e.message);
      webcamStream = null;
      hasWebcam = false;
    }
  }

  chrome.runtime.sendMessage({ type: 'audio-status', mic: hasMic, systemAudio: hasSystemAudio, webcam: hasWebcam }).catch(() => {});

  // Downscale video to max 1280px width
  const videoTrack = captureStream.getVideoTracks()[0];
  if (videoTrack) {
    const settings = videoTrack.getSettings();
    if (settings.width && settings.width > MAX_VIDEO_WIDTH) {
      const scale = MAX_VIDEO_WIDTH / settings.width;
      try {
        await videoTrack.applyConstraints({
          width: { max: MAX_VIDEO_WIDTH },
          height: { max: Math.round(settings.height * scale) }
        });
      } catch (e) {
        console.warn('Could not downscale video:', e.message);
      }
    }
  }

  // Determine the video track for recording: composite via canvas if webcam is active
  let finalVideoTrack;

  if (hasWebcam) {
    finalVideoTrack = await setupWebcamPiP(captureStream.getVideoTracks()[0]);
  } else {
    finalVideoTrack = captureStream.getVideoTracks()[0];
  }

  // Mix audio
  let combinedStream;
  const captureHasAudio = captureStream.getAudioTracks().length > 0;

  if (hasMic && captureHasAudio) {
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(captureStream).connect(dest);
    audioContext.createMediaStreamSource(micStream).connect(dest);
    mixedStream = new MediaStream([finalVideoTrack, dest.stream.getAudioTracks()[0]]);
    combinedStream = mixedStream;
  } else if (captureHasAudio) {
    combinedStream = new MediaStream([finalVideoTrack, ...captureStream.getAudioTracks()]);
  } else if (hasMic) {
    combinedStream = new MediaStream([finalVideoTrack, micStream.getAudioTracks()[0]]);
  } else {
    combinedStream = new MediaStream([finalVideoTrack]);
  }

  // MediaRecorder
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType: getSupportedMimeType(),
    videoBitsPerSecond: 1_500_000
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => handleRecordingFinished();

  mediaRecorder.start(1000);
  maxDurationRemaining = MAX_DURATION_MS;
  startMaxDurationTimer();

  // Start live mic level monitoring (sends mic-level messages to popup)
  if (micStream) {
    startMicLevelMonitor(micStream);
  }

  // Update visible timer in recorder window (Firefox popup mode)
  startRecorderWindowTimer();
  updateRecorderWindowUI('recording');
}

/* --- Webcam PiP compositing via Canvas --- */

async function setupWebcamPiP(screenTrack) {
  const PIP_DIAMETER = 150;
  const PIP_MARGIN = 20;

  // Get screen video dimensions
  const screenSettings = screenTrack.getSettings();
  const canvasWidth = screenSettings.width || 1280;
  const canvasHeight = screenSettings.height || 720;
  const fps = screenSettings.frameRate || 30;

  // Create canvas for compositing
  pipCanvas = document.createElement('canvas');
  pipCanvas.width = canvasWidth;
  pipCanvas.height = canvasHeight;
  pipCtx = pipCanvas.getContext('2d');

  // Create hidden video element for screen capture
  screenVideo = document.createElement('video');
  screenVideo.srcObject = new MediaStream([screenTrack]);
  screenVideo.muted = true;
  screenVideo.playsInline = true;
  await screenVideo.play();

  // Create hidden video element for webcam
  webcamVideo = document.createElement('video');
  webcamVideo.srcObject = webcamStream;
  webcamVideo.muted = true;
  webcamVideo.playsInline = true;
  await webcamVideo.play();

  // PiP position: bottom-left corner
  const pipX = PIP_MARGIN + PIP_DIAMETER / 2;
  const pipY = canvasHeight - PIP_MARGIN - PIP_DIAMETER / 2;
  const pipRadius = PIP_DIAMETER / 2;

  // Compositing render loop
  function drawFrame() {
    // Draw screen capture
    pipCtx.drawImage(screenVideo, 0, 0, canvasWidth, canvasHeight);

    // Draw webcam in a circular mask (bottom-left)
    if (webcamVideo.readyState >= 2) {
      pipCtx.save();

      // Draw circular border/shadow behind the webcam
      pipCtx.beginPath();
      pipCtx.arc(pipX, pipY, pipRadius + 3, 0, Math.PI * 2);
      pipCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      pipCtx.fill();

      // Clip to circle
      pipCtx.beginPath();
      pipCtx.arc(pipX, pipY, pipRadius, 0, Math.PI * 2);
      pipCtx.closePath();
      pipCtx.clip();

      // Draw webcam video — center-crop to square
      const ww = webcamVideo.videoWidth;
      const wh = webcamVideo.videoHeight;
      const side = Math.min(ww, wh);
      const sx = (ww - side) / 2;
      const sy = (wh - side) / 2;
      pipCtx.drawImage(
        webcamVideo,
        sx, sy, side, side,         // source: center-cropped square
        pipX - pipRadius, pipY - pipRadius, PIP_DIAMETER, PIP_DIAMETER  // dest: circle area
      );

      // Draw a subtle ring border
      pipCtx.beginPath();
      pipCtx.arc(pipX, pipY, pipRadius, 0, Math.PI * 2);
      pipCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      pipCtx.lineWidth = 2;
      pipCtx.stroke();

      pipCtx.restore();
    }

    pipAnimationFrame = requestAnimationFrame(drawFrame);
  }

  drawFrame();

  // Capture the canvas as a video track
  const canvasStream = pipCanvas.captureStream(fps);
  const compositeTrack = canvasStream.getVideoTracks()[0];
  console.log('[BugReel] Webcam PiP compositing started: ' + canvasWidth + 'x' + canvasHeight + '@' + fps + 'fps');
  return compositeTrack;
}

function stopWebcamPiP() {
  if (pipAnimationFrame) {
    cancelAnimationFrame(pipAnimationFrame);
    pipAnimationFrame = null;
  }
  if (screenVideo) {
    screenVideo.pause();
    screenVideo.srcObject = null;
    screenVideo = null;
  }
  if (webcamVideo) {
    webcamVideo.pause();
    webcamVideo.srcObject = null;
    webcamVideo = null;
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  pipCanvas = null;
  pipCtx = null;
}

function pauseRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  mediaRecorder.pause();
  clearMaxDurationTimer();
  stopMicLevelMonitor();
  stopRecorderWindowTimer();
  updateRecorderWindowUI('paused');
}

function resumeRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'paused') return;
  mediaRecorder.resume();
  startMaxDurationTimer();
  if (micStream) startMicLevelMonitor(micStream);
  startRecorderWindowTimer();
  updateRecorderWindowUI('recording');
}

function finishRecording() {
  clearMaxDurationTimer();
  stopMicLevelMonitor();
  stopRecorderWindowTimer();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    releaseStreams();
  }
}

/* --- Live mic level during recording --- */

function startMicLevelMonitor(stream) {
  stopMicLevelMonitor();
  try {
    micLevelCtx = new AudioContext();
    micLevelAnalyser = micLevelCtx.createAnalyser();
    micLevelAnalyser.fftSize = 256;
    micLevelAnalyser.smoothingTimeConstant = 0.5;
    micLevelCtx.createMediaStreamSource(stream).connect(micLevelAnalyser);
    const dataArray = new Uint8Array(micLevelAnalyser.frequencyBinCount);
    micLevelInterval = setInterval(() => {
      micLevelAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const level = Math.min(100, Math.round((sum / dataArray.length) * 1.5));
      chrome.runtime.sendMessage({ type: 'mic-level', level }).catch(() => {});
    }, 100);
  } catch (e) {
    console.warn('[BugReel] Mic level monitor failed:', e.message);
  }
}

function stopMicLevelMonitor() {
  if (micLevelInterval) { clearInterval(micLevelInterval); micLevelInterval = null; }
  if (micLevelCtx) { micLevelCtx.close().catch(() => {}); micLevelCtx = null; }
  micLevelAnalyser = null;
}

function releaseStreams() {
  stopMicLevelMonitor();
  stopWebcamPiP();
  if (captureStream) { captureStream.getTracks().forEach(t => t.stop()); captureStream = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (mixedStream) { mixedStream.getTracks().forEach(t => t.stop()); mixedStream = null; }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  if (micPreviewStream) { micPreviewStream.getTracks().forEach(t => t.stop()); micPreviewStream = null; }
  if (micPreviewInterval) { clearInterval(micPreviewInterval); micPreviewInterval = null; }
  if (micPreviewCtx) { micPreviewCtx.close().catch(() => {}); micPreviewCtx = null; }
  micPreviewAnalyser = null;
}

function startMaxDurationTimer() {
  clearMaxDurationTimer();
  maxDurationTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      finishRecording();
      chrome.runtime.sendMessage({ type: 'recording-stopped-max' }).catch(() => {});
    }
  }, maxDurationRemaining);
}

function clearMaxDurationTimer() {
  if (maxDurationTimer) { clearTimeout(maxDurationTimer); maxDurationTimer = null; }
}

async function handleRecordingFinished() {
  console.log('[BugReel] handleRecordingFinished: chunks=' + recordedChunks.length);
  updateRecorderWindowUI('saving');

  if (recordedChunks.length === 0) {
    releaseStreams();
    chrome.runtime.sendMessage({ type: 'upload-error', error: 'No data recorded' }).catch(() => {});
    return;
  }

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  recordedChunks = [];
  console.log('[BugReel] Blob created: ' + (blob.size / 1048576).toFixed(1) + 'MB');

  try {
    if (pendingAutoUpload) {
      console.log('[BugReel] Direct upload (no IDB)...');
      updateRecorderWindowUI('uploading');
      const extras = pendingAutoUpload;
      pendingAutoUpload = null;
      await directUpload(blob, extras);
    } else {
      try {
        await saveRecordingBlob(blob, {
          serverUrl: pendingServerUrl,
          author: pendingAuthor,
          timestamp: Date.now(),
          size: blob.size,
        });
        console.log('[BugReel] Blob saved to IDB OK');
        chrome.runtime.sendMessage({ type: 'blob-saved', fileSize: blob.size }).catch(() => {});
      } catch (e) {
        console.error('[BugReel] Failed to save blob:', e);
        chrome.runtime.sendMessage({ type: 'upload-error', error: 'Failed to save: ' + e.message }).catch(() => {});
      }
    }
  } finally {
    mediaRecorder = null;
    releaseStreams();
  }
}

async function directUpload(blob, extras) {
  console.log('[BugReel] directUpload: blob=' + (blob.size / 1048576).toFixed(1) + 'MB, url=' + pendingServerUrl + '/api/upload');
  const formData = new FormData();
  formData.append('video', blob, `recording-${Date.now()}.webm`);
  formData.append('author', pendingAuthor || 'unknown');
  if (extras.urlEvents) formData.append('url_events', extras.urlEvents);
  if (extras.consoleEvents) formData.append('console_events', extras.consoleEvents);
  if (extras.actionEvents) formData.append('action_events', extras.actionEvents);
  if (extras.manualMarkers) formData.append('manual_markers', extras.manualMarkers);
  if (extras.metadata) formData.append('metadata', extras.metadata);

  chrome.runtime.sendMessage({ type: 'upload-started' }).catch(() => {});

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        console.log('[BugReel] Upload progress:', percent + '%');
        chrome.runtime.sendMessage({ type: 'upload-progress', percent, loaded: e.loaded, total: e.total }).catch(() => {});
        updateRecorderWindowUI('uploading', percent);
      }
    };
    xhr.onload = () => {
      console.log('[BugReel] XHR onload: status=' + xhr.status);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          console.log('[BugReel] Direct upload done:', result.id);
          chrome.runtime.sendMessage({ type: 'upload-done', recordingId: result.id || 'unknown' }).catch(() => {});
          resolve();
        } catch (e) { reject(new Error('Invalid server response')); }
      } else {
        const err = `Server error ${xhr.status}: ${xhr.responseText?.slice(0, 200)}`;
        console.error('[BugReel] Upload server error:', err);
        chrome.runtime.sendMessage({ type: 'upload-error', error: err }).catch(() => {});
        reject(new Error(err));
      }
    };
    xhr.onerror = () => {
      chrome.runtime.sendMessage({ type: 'upload-error', error: 'Network error' }).catch(() => {});
      reject(new Error('Network error'));
    };
    xhr.open('POST', `${pendingServerUrl}/api/upload`);
    if (pendingExtensionToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${pendingExtensionToken}`);
    }
    xhr.send(formData);
  });
}

/* --- Upload with progress --- */

async function doUpload(extras = {}) {
  const data = await loadRecordingBlob();
  if (!data || !data.blob) {
    chrome.runtime.sendMessage({ type: 'upload-error', error: 'No recording found' }).catch(() => {});
    return;
  }

  const { blob, serverUrl, author } = data;
  const formData = new FormData();
  formData.append('video', blob, `recording-${Date.now()}.webm`);
  formData.append('author', author || 'unknown');
  if (extras.urlEvents) formData.append('url_events', extras.urlEvents);
  if (extras.consoleEvents) formData.append('console_events', extras.consoleEvents);
  if (extras.actionEvents) formData.append('action_events', extras.actionEvents);
  if (extras.manualMarkers) formData.append('manual_markers', extras.manualMarkers);
  if (extras.metadata) formData.append('metadata', extras.metadata);
  if (extras.segments) formData.append('segments', JSON.stringify(extras.segments));

  // Get token from storage before starting upload
  let uploadToken = '';
  try {
    const stored = await new Promise(resolve => chrome.storage.local.get('extensionToken', resolve));
    uploadToken = stored.extensionToken || '';
  } catch {}

  chrome.runtime.sendMessage({ type: 'upload-started' }).catch(() => {});

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        chrome.runtime.sendMessage({ type: 'upload-progress', percent, loaded: e.loaded, total: e.total }).catch(() => {});
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          await deleteRecordingBlob();
          chrome.runtime.sendMessage({
            type: 'upload-done',
            recordingId: result.id || result.recordingId || 'unknown'
          }).catch(() => {});
          resolve();
        } catch (e) {
          reject(new Error('Invalid server response'));
        }
      } else {
        const err = `Server error ${xhr.status}: ${xhr.statusText}`;
        chrome.runtime.sendMessage({ type: 'upload-error', error: err }).catch(() => {});
        reject(new Error(err));
      }
    };

    xhr.onerror = () => {
      const err = 'Network error during upload';
      chrome.runtime.sendMessage({ type: 'upload-error', error: err }).catch(() => {});
      reject(new Error(err));
    };

    xhr.open('POST', `${serverUrl}/api/upload`);
    if (uploadToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${uploadToken}`);
    }
    xhr.send(formData);
  });
}

async function doDiscard() {
  clearMaxDurationTimer();
  stopRecorderWindowTimer();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordedChunks = [];
  releaseStreams();
  await deleteRecordingBlob();
}

/* --- Recorder window UI (Firefox popup mode) --- */

function startRecorderWindowTimer() {
  stopRecorderWindowTimer();
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;
  timerEl.style.display = '';
  const startTime = Date.now();
  recorderTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

function stopRecorderWindowTimer() {
  if (recorderTimerInterval) { clearInterval(recorderTimerInterval); recorderTimerInterval = null; }
}

function updateRecorderWindowUI(status, percent) {
  const label = document.getElementById('label');
  const dot = document.getElementById('dot');
  if (!label) return;

  switch (status) {
    case 'recording':
      label.textContent = 'Recording';
      label.className = 'label';
      if (dot) { dot.style.background = '#dc2626'; dot.style.animationPlayState = 'running'; dot.className = 'dot rec'; }
      break;
    case 'paused':
      label.textContent = 'Paused';
      label.className = 'label';
      if (dot) { dot.style.background = '#f59e0b'; dot.style.animationPlayState = 'paused'; }
      break;
    case 'saving':
      label.textContent = 'Saving...';
      label.className = 'label';
      break;
    case 'uploading':
      label.textContent = percent ? `Uploading ${percent}%` : 'Uploading...';
      label.className = 'label';
      break;
    case 'waiting':
      label.textContent = 'Preparing...';
      label.className = 'label';
      if (dot) dot.className = 'dot waiting';
      break;
  }
}

function getScreenCaptureErrorHint(errorMessage) {
  const isMac = navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Macintosh');
  const msg = errorMessage || '';

  if (isMac && (msg.includes('not found') || msg.includes('NotFound'))) {
    return 'Firefox does not have screen recording access on macOS.\n\n' +
      '1. Open: System Settings → Privacy & Security → Screen Recording\n' +
      '2. Enable the toggle for Firefox\n' +
      '3. Restart Firefox\n' +
      '4. Click "Retry"';
  }
  if (msg.includes('transient activation') || msg.includes('user gesture')) {
    return 'Click the button below to start recording.';
  }
  if (msg.includes('NotAllowed') || msg.includes('denied')) {
    return 'You cancelled screen selection. Click the button below and select a screen or tab to record.';
  }
  return 'Error: ' + msg;
}

/* --- Helpers --- */

function getSupportedMimeType() {
  for (const mime of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}

/* --- Cleanup on unload (offscreen closed externally, tab closed, etc.) --- */
window.addEventListener('pagehide', () => {
  releaseStreams();
  stopMicPreview();
});

/* --- Signal readiness to background (Chrome offscreen flow) --- */
chrome.runtime.sendMessage({ type: 'recorder-ready' }).catch(() => {});

/* --- Firefox: autonomous start via storage params --- */
(async function firefoxAutoStart() {
  const result = await chrome.storage.local.get('recorderParams');
  if (!result.recorderParams) return; // Chrome offscreen mode — wait for messages

  const params = result.recorderParams;
  await chrome.storage.local.remove('recorderParams');

  const label = document.getElementById('label');
  const hint = document.getElementById('hint');

  console.log('[BugReel] Firefox recorder tab: auto-starting capture...');
  if (label) label.textContent = 'Requesting screen access...';
  if (hint) hint.textContent = 'Select what you want to record in the browser dialog.';

  // Try getDisplayMedia directly — page is active/focused, Firefox should allow it
  try {
    await startRecording(
      params.streamId || null,
      params.serverUrl,
      params.author,
      params.mode,
      params.micEnabled,
      params.systemAudioEnabled,
      params.extensionToken,
      undefined, // maxDuration — use default
      undefined, // videoQuality — use default
      params.webcamEnabled,
      params.webcamDeviceId
    );
    console.log('[BugReel] Firefox recording started successfully');
    chrome.runtime.sendMessage({ type: 'firefox-recording-started' }).catch(() => {});
    if (label) label.textContent = 'Recording';
    if (hint) hint.textContent = 'Recording in progress. Do not close this tab!';

    // Auto-switch to previous tab so recorder doesn't block the user
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = tabs.find(t => t.active);
      const prevTab = tabs.filter(t => !t.active && !t.url?.startsWith('moz-extension://')).pop();
      if (prevTab) {
        await chrome.tabs.update(prevTab.id, { active: true });
      }
    } catch {}
    // Minimize title to show recording status
    document.title = 'REC - BugReel';
  } catch (e) {
    console.error('[BugReel] Firefox auto-start failed:', e.message, '— showing fallback button');
    if (label) label.textContent = 'Screen access needed';
    if (hint) { hint.textContent = getScreenCaptureErrorHint(e.message); hint.style.whiteSpace = 'pre-line'; }
    showFallbackButton(params, label, hint);
  }
})();

function showFallbackButton(params, label, hint) {
  const btn = document.createElement('button');
  btn.textContent = 'Start Screen Recording';
  btn.style.cssText = 'margin-top:16px;padding:12px 28px;border:none;border-radius:10px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Requesting...';
    if (label) label.textContent = 'Requesting screen access...';

    try {
      await startRecording(
        params.streamId || null,
        params.serverUrl,
        params.author,
        params.mode,
        params.micEnabled,
        params.systemAudioEnabled,
        params.extensionToken,
        undefined, // maxDuration
        undefined, // videoQuality
        params.webcamEnabled,
        params.webcamDeviceId
      );
      chrome.runtime.sendMessage({ type: 'firefox-recording-started' }).catch(() => {});
      if (label) label.textContent = 'Recording';
      if (hint) { hint.style.whiteSpace = ''; hint.textContent = 'Recording in progress. Switch to another tab.\nDo not close this tab!'; }
      btn.style.display = 'none';
    } catch (e) {
      console.error('[BugReel] Firefox recording failed:', e);
      btn.disabled = false;
      btn.textContent = 'Try Again';
      if (label) label.textContent = 'Screen access needed';
      if (hint) { hint.textContent = getScreenCaptureErrorHint(e.message); hint.style.whiteSpace = 'pre-line'; }
      chrome.runtime.sendMessage({ type: 'recording-failed' }).catch(() => {});
    }
  });

  // Append button below existing hint text
  const wrapper = document.createElement('div');
  wrapper.style.textAlign = 'center';
  wrapper.appendChild(btn);
  hint?.parentNode?.appendChild(wrapper);
}
