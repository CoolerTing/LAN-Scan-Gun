import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { refreshIcons } from './ui';
import { createI18n, detectLanguage, translateElements } from './i18n.mjs';
import {
  openCameraStream, stopStream, stopDecoderControls, cameraMetadata, cameraErrorMessage, createRequestId
} from './camera.mjs';
import './styles.css';

const $ = (selector) => document.querySelector(selector);
const token = new URLSearchParams(location.hash.slice(1)).get('token');
const i18n = createI18n(detectLanguage(new URLSearchParams(location.search).get('lang') || navigator.language));
const t = (key, values) => i18n.t(key, values);
let socket;
let reconnectTimer;
let reader;
let controls;
let cameraStream;
let cameraIndex = -1;
let cameras = [];
let running = false;
let starting = false;
let pending = null;
let lastValue = '';
let lastSeenAt = 0;
let soundEnabled = true;
let audio;
let stopping = false;
let cameraGeneration = 0;
const recentScans = [];
let latestCameraError = '';
let cameraPhase = 'notStarted';
let cameraAttempt = 1;

document.body.classList.add('mobile-shell');
$('#mobile-app').innerHTML = `<main class="mobile-app">
  <header class="mobile-top"><div class="brand"><i data-lucide="scan-line"></i><strong>LAN Scan Gun</strong></div>
    <span class="status" id="mobile-status"><span class="dot"></span><span data-i18n="waitingConnection"></span></span></header>
  <div class="scanner-heading"><h1 data-i18n="mobileScanner"></h1><span id="suffix-label" data-i18n="enterEnabled"></span></div>
  <div class="scanner-frame"><video id="preview" autoplay muted playsinline webkit-playsinline data-i18n-aria-label="camera"></video>
    <div class="viewfinder"><span></span><span></span><span></span><span></span></div>
    <div class="camera-idle" id="camera-idle"><i data-lucide="camera"></i><span data-i18n="cameraOff"></span></div>
    <div class="scanner-message" id="scanner-message" data-i18n="waitingConnection"></div>
  </div>
  <div class="camera-toolbar">
    <button id="start-scan" class="primary-btn"><i data-lucide="camera"></i><span data-i18n="startCamera"></span></button>
    <button id="switch-camera" class="icon-btn" data-i18n-title="switchCamera" data-i18n-aria-label="switchCamera" disabled><i data-lucide="switch-camera"></i></button>
    <button id="torch" class="icon-btn" data-i18n-title="flashlight" data-i18n-aria-label="flashlight" disabled><i data-lucide="flashlight"></i></button>
  </div>
  <div class="notice" id="error-box" role="alert" hidden></div>
  <section class="last-scan"><div class="section-heading"><h2 data-i18n="recentScans"></h2><span class="result" id="send-status" data-i18n="waitingScan" role="status" aria-live="polite"></span></div>
    <code id="last-scan-value">-</code>
    <ul id="recent-scans" class="recent-scans" data-i18n-aria-label="recentScanRecords"></ul></section>
  <details class="manual-entry"><summary data-i18n="manualSend"></summary><form id="manual-form">
    <input id="manual-value" data-i18n-aria-label="valueToSend" data-i18n-placeholder="barcodeContent" maxlength="4096" required autocomplete="off">
    <button class="icon-btn" data-i18n-title="send" data-i18n-aria-label="send"><i data-lucide="send"></i></button>
  </form></details>
  <details class="camera-diagnostics"><summary data-i18n="cameraDiagnostics"></summary><pre id="camera-diagnostics"></pre></details>
</main>`;
refreshIcons();
function applyLanguage(language) {
  i18n.setLanguage(language);
  document.documentElement.lang = i18n.language === 'zh' ? 'zh-CN' : 'en';
  document.title = t('mobileScanner');
  translateElements(document, t);
  $('#start-scan span').textContent = t(running ? 'pauseScan' : 'startCamera');
  if (socket) {
    $('#mobile-status').innerHTML = `<span class="dot"></span>${t(connected() ? 'pcOnline' : 'connectionLost')}`;
  } else {
    $('#mobile-status').innerHTML = `<span class="dot"></span>${t('waitingConnection')}`;
  }
  renderRecentScans();
  updateDiagnostics();
}
function setLabel(selector, key) {
  $(selector).dataset.i18n = key;
  $(selector).textContent = t(key);
}
function updateDiagnostics(cause) {
  if (cause) latestCameraError = `${cause.name || 'Error'}: ${cause.message || ''}`;
  $('#camera-diagnostics').textContent = [
    `${t('page')}: ${location.origin}`,
    `${t('secureContext')}: ${t(window.isSecureContext ? 'yes' : 'no')}`,
    `${t('cameraApi')}: ${t(navigator.mediaDevices?.getUserMedia ? 'available' : 'unavailable')}`,
    `${t('phase')}: ${t(cameraPhase, { attempt: cameraAttempt })}`,
    `${t('cameras')}: ${cameras.length}`,
    `${t('recentError')}: ${latestCameraError || t('none')}`,
    `${t('browser')}: ${navigator.userAgent}`
  ].join('\n');
}
function connected() {
  return socket?.readyState === WebSocket.OPEN && $('#mobile-status').classList.contains('connected');
}
function renderRecentScans() {
  $('#recent-scans').textContent = '';
  for (const record of recentScans) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recent-scan-button';
    button.title = t('resendPc');
    button.setAttribute('aria-label', t('resend', { value: record.value }));
    button.disabled = Boolean(pending) || !connected();
    const content = document.createElement('span');
    content.className = 'recent-scan-content';
    const value = document.createElement('code');
    value.textContent = record.value;
    const meta = document.createElement('span');
    meta.className = 'recent-scan-meta';
    meta.textContent = `${record.format} · ${new Date(record.time).toLocaleTimeString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false })}`;
    content.append(value, meta);
    const status = document.createElement('span');
    status.className = `result ${record.status}`;
    status.textContent = { pending: t('sending'), success: t('statusEntered'), error: t('statusFailed'), unknown: t('unconfirmed'), unsent: t('unsent') }[record.status];
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'send');
    button.append(content, status, icon);
    button.addEventListener('click', () => send(record.value, record.format, record));
    item.append(button);
    $('#recent-scans').append(item);
  }
  refreshIcons();
}
function error(text = '') { $('#error-box').hidden = !text; $('#error-box').textContent = text; }
function setStatus(connected) {
  $('#mobile-status').classList.toggle('connected', connected);
  $('#mobile-status').innerHTML = `<span class="dot"></span>${connected ? t('pcOnline') : t('connectionLost')}`;
  renderRecentScans();
}
function resetPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.record.status = 'unknown';
  pending = null;
  setLabel('#send-status', 'unknownResult');
  $('#send-status').className = 'result error';
  setLabel('#scanner-message', 'unknownResult');
  renderRecentScans();
}
function connect() {
  if (!token || stopping) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello' })));
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'state' || message.type === 'settings') {
      if (message.settings.language) applyLanguage(message.settings.language);
      soundEnabled = Boolean(message.settings.sound);
      setLabel('#suffix-label', message.settings.enterAfterScan ? 'enterEnabled' : 'noEnter');
      if (message.type === 'state') {
        setStatus(true);
        setLabel('#scanner-message', running ? 'scanning' : 'connected');
      }
    }
    if (message.type === 'ack' && pending?.id === message.id) {
      clearTimeout(pending.timer);
      pending.record.status = message.ok ? 'success' : 'error';
      pending = null;
      renderRecentScans();
      setLabel('#send-status', message.ok ? 'inputToPc' : 'inputFailed');
      $('#send-status').className = `result ${message.ok ? 'success' : 'error'}`;
      if (message.ok) {
        setLabel('#scanner-message', 'inputSuccess');
        error();
        if (soundEnabled) beep();
        navigator.vibrate?.(60);
      } else {
        setLabel('#scanner-message', 'inputFailed');
        error(message.error);
      }
    }
  });
  socket.addEventListener('close', (event) => {
    setStatus(false);
    if (pending) {
      resetPending();
      error(t('disconnectedNoAck'));
    }
    if (event.code === 1008) { error(t('pairingExpired')); return; }
    if (!stopping) reconnectTimer = setTimeout(connect, 2500);
  });
  socket.addEventListener('error', () => error(t('connectionFailed')));
}
function beep() {
  if (!audio) return;
  audio.resume().catch(() => {});
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 1100;
  gain.gain.setValueAtTime(0.12, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.12);
}
function send(value, format, record) {
  if (pending) return false;
  if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    error(t('emptyOrInvalid')); return false;
  }
  if (!record) {
    record = { value, format, time: Date.now(), status: 'unsent' };
    recentScans.unshift(record);
    recentScans.length = Math.min(recentScans.length, 20);
  }
  $('#last-scan-value').textContent = value;
  if (!connected()) {
    renderRecentScans();
    error(t('pcNotConnected')); return false;
  }
  let id;
  try { id = createRequestId(); }
  catch (cause) { error(t('requestIdFailed', { message: cause.message })); return false; }
  record.status = 'pending';
  error();
  pending = { id, record, timer: setTimeout(() => {
    resetPending();
    error(t('timeoutNoAck'));
  }, 20000) };
  setLabel('#send-status', 'sending');
  $('#send-status').className = 'result pending';
  setLabel('#scanner-message', 'sendingNow');
  renderRecentScans();
  try { socket.send(JSON.stringify({ type: 'scan', id, value, format })); }
  catch {
    resetPending();
    error(t('sendInterrupted'));
    return false;
  }
  return true;
}
function stopCamera() {
  cameraGeneration += 1;
  stopDecoderControls(controls);
  stopStream(cameraStream);
  stopStream($('#preview').srcObject);
  cameraStream = null;
  controls = null;
  running = false;
  $('#preview').srcObject = null;
  $('#camera-idle').hidden = false;
  $('#start-scan').innerHTML = `<i data-lucide="camera"></i><span data-i18n="startCamera">${t('startCamera')}</span>`;
  $('#torch').disabled = true;
  $('#switch-camera').disabled = true;
  $('#torch').setAttribute('aria-pressed', 'false');
  setLabel('#scanner-message', 'cameraPaused');
  refreshIcons();
  cameraPhase = 'diagnosticStopped';
  updateDiagnostics();
}
async function startCamera() {
  if (starting) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    cameraPhase = 'diagnosticCaptureFailed';
    updateDiagnostics();
    error(t('cameraUnsupported')); return;
  }
  starting = true;
  $('#start-scan').disabled = true;
  error();
  latestCameraError = '';
  const generation = ++cameraGeneration;
  let phase = 'capture';
  let stream;
  let newControls;
  try {
    reader ||= new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 250, tryPlayVideoTimeout: 15000
    });
    lastValue = '';
    lastSeenAt = 0;
    const selectedDevice = cameras[cameraIndex]?.deviceId;
    stream = await openCameraStream(navigator.mediaDevices, selectedDevice, (attempt) => {
      cameraAttempt = attempt;
      cameraPhase = 'diagnosticStepCapture';
      setLabel('#scanner-message', attempt === 1 ? 'cameraStarting' : 'compatibleCamera');
      updateDiagnostics();
    });
    if (generation !== cameraGeneration || stopping || document.hidden) {
      stopStream(stream);
      return;
    }
    cameraStream = stream;
    phase = 'preview';
    cameraPhase = 'diagnosticStart';
    updateDiagnostics();
    $('#preview').muted = true;
    $('#preview').autoplay = true;
    newControls = await reader.decodeFromStream(stream, $('#preview'), (result, decodeError) => {
      if (generation !== cameraGeneration) return;
      if (!result) {
        if (decodeError && !(decodeError instanceof NotFoundException) &&
          !(decodeError instanceof ChecksumException) && !(decodeError instanceof FormatException)) {
          Promise.resolve().then(() => {
            if (generation !== cameraGeneration) return;
            stopCamera();
            cameraPhase = 'decodeFailed';
            updateDiagnostics(decodeError);
            error(t('videoDecodeFailed'));
          });
          return;
        }
        if (Date.now() - lastSeenAt > 1200) lastValue = '';
        return;
      }
      lastSeenAt = Date.now();
      const value = result.getText();
      if (value === lastValue) return;
      if (pending || !connected()) return;
      if (send(value, BarcodeFormat[result.getBarcodeFormat()] || 'Barcode')) lastValue = value;
    });
    if (generation !== cameraGeneration || stopping || document.hidden) {
      stopDecoderControls(newControls);
      stopStream(stream);
      return;
    }
    controls = newControls;
    running = true;
    $('#camera-idle').hidden = true;
    setLabel('#scanner-message', 'scanning');
    $('#start-scan').innerHTML = `<i data-lucide="pause"></i><span data-i18n="pauseScan">${t('pauseScan')}</span>`;
    cameraPhase = 'diagnosticRunning';
    const metadata = await cameraMetadata(navigator.mediaDevices, stream);
    if (generation !== cameraGeneration) return;
    cameras = metadata.devices;
    cameraIndex = cameras.findIndex((item) => item.deviceId === metadata.deviceId);
    $('#switch-camera').disabled = cameras.length < 2;
    $('#torch').disabled = !metadata.torch;
    updateDiagnostics();
    refreshIcons();
  } catch (cause) {
    stopDecoderControls(newControls);
    stopStream(stream);
    stopCamera();
    cameraPhase = phase === 'preview' ? 'diagnosticPreviewFailed' : 'diagnosticRequestFailed';
    updateDiagnostics(cause);
    error(cameraErrorMessage(cause, phase, i18n.language));
  } finally {
    starting = false;
    $('#start-scan').disabled = false;
  }
}
$('#start-scan').addEventListener('click', () => {
  if (running) { stopCamera(); return; }
  // Start the camera directly from the tap; audio is optional and must never block it.
  void startCamera();
  const Audio = window.AudioContext || window.webkitAudioContext;
  try {
    if (Audio && !audio) audio = new Audio();
    audio?.resume().catch(() => {});
  } catch { audio = null; }
});
$('#switch-camera').addEventListener('click', async () => {
  if (starting || cameras.length < 2) return;
  cameraIndex = (cameraIndex + 1) % cameras.length;
  stopCamera(); await startCamera();
});
$('#torch').addEventListener('click', async () => {
  const enabled = $('#torch').getAttribute('aria-pressed') !== 'true';
  try {
    await $('#preview').srcObject.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: enabled }] });
    $('#torch').setAttribute('aria-pressed', String(enabled));
  } catch { error(t('flashlightUnsupported')); }
});
$('#manual-form').addEventListener('submit', (event) => {
  event.preventDefault(); send($('#manual-value').value, 'Manual');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (running || starting)) stopCamera();
});
window.addEventListener('pagehide', () => {
  stopping = true; clearTimeout(reconnectTimer); stopCamera(); socket?.close();
});
applyLanguage(i18n.language);
if (!token) {
  setStatus(false); error(t('notPaired'));
} else connect();
