import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, NotFoundException, ChecksumException, FormatException } from '@zxing/library';
import { refreshIcons } from './ui';
import {
  openCameraStream, stopStream, stopDecoderControls, cameraMetadata, cameraErrorMessage, createRequestId
} from './camera.mjs';
import './styles.css';

const $ = (selector) => document.querySelector(selector);
const token = new URLSearchParams(location.hash.slice(1)).get('token');
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
let cameraPhase = '未启动';

document.body.classList.add('mobile-shell');
$('#mobile-app').innerHTML = `<main class="mobile-app">
  <header class="mobile-top"><div class="brand"><i data-lucide="scan-line"></i><strong>LAN Scan Gun</strong></div>
    <span class="status" id="mobile-status"><span class="dot"></span>连接中</span></header>
  <div class="scanner-heading"><h1>移动扫码器</h1><span id="suffix-label">回车已开启</span></div>
  <div class="scanner-frame"><video id="preview" autoplay muted playsinline webkit-playsinline aria-label="扫码摄像头"></video>
    <div class="viewfinder"><span></span><span></span><span></span><span></span></div>
    <div class="camera-idle" id="camera-idle"><i data-lucide="camera"></i><span>摄像头未开启</span></div>
    <div class="scanner-message" id="scanner-message">等待连接</div>
  </div>
  <div class="camera-toolbar">
    <button id="start-scan" class="primary-btn"><i data-lucide="camera"></i><span>开启摄像头</span></button>
    <button id="switch-camera" class="icon-btn" title="切换镜头" aria-label="切换镜头" disabled><i data-lucide="switch-camera"></i></button>
    <button id="torch" class="icon-btn" title="手电筒" aria-label="手电筒" disabled><i data-lucide="flashlight"></i></button>
  </div>
  <div class="notice" id="error-box" role="alert" hidden></div>
  <section class="last-scan"><div class="section-heading"><h2>最近识别</h2><span class="result" id="send-status" role="status" aria-live="polite">等待扫码</span></div>
    <code id="last-scan-value">-</code>
    <ul id="recent-scans" class="recent-scans" aria-label="最近识别记录"></ul></section>
  <details class="manual-entry"><summary>手动发送</summary><form id="manual-form">
    <input id="manual-value" aria-label="待发送内容" placeholder="条码内容" maxlength="4096" required autocomplete="off">
    <button class="icon-btn" title="发送" aria-label="发送"><i data-lucide="send"></i></button>
  </form></details>
  <details class="camera-diagnostics"><summary>相机诊断</summary><pre id="camera-diagnostics"></pre></details>
</main>`;
refreshIcons();
function updateDiagnostics(cause) {
  if (cause) latestCameraError = `${cause.name || 'Error'}: ${cause.message || ''}`;
  $('#camera-diagnostics').textContent = [
    `页面：${location.origin}`,
    `安全上下文：${window.isSecureContext ? '是' : '否'}`,
    `相机接口：${navigator.mediaDevices?.getUserMedia ? '可用' : '不可用'}`,
    `步骤：${cameraPhase}`,
    `可枚举镜头：${cameras.length}`,
    `最近错误：${latestCameraError || '无'}`,
    `浏览器：${navigator.userAgent}`
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
    button.title = '再次发送到 PC';
    button.setAttribute('aria-label', `再次发送：${record.value}`);
    button.disabled = Boolean(pending) || !connected();
    const content = document.createElement('span');
    content.className = 'recent-scan-content';
    const value = document.createElement('code');
    value.textContent = record.value;
    const meta = document.createElement('span');
    meta.className = 'recent-scan-meta';
    meta.textContent = `${record.format} · ${new Date(record.time).toLocaleTimeString('zh-CN', { hour12: false })}`;
    content.append(value, meta);
    const status = document.createElement('span');
    status.className = `result ${record.status}`;
    status.textContent = { pending: '发送中', success: '已输入', error: '失败', unknown: '未确认', unsent: '未发送' }[record.status];
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
  $('#mobile-status').innerHTML = `<span class="dot"></span>${connected ? 'PC 在线' : '连接中断'}`;
  renderRecentScans();
}
function resetPending(message) {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.record.status = 'unknown';
  pending = null;
  $('#send-status').textContent = message;
  $('#send-status').className = 'result error';
  $('#scanner-message').textContent = message;
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
      soundEnabled = Boolean(message.settings.sound);
      $('#suffix-label').textContent = message.settings.enterAfterScan ? '回车已开启' : '不附加回车';
      if (message.type === 'state') {
        setStatus(true);
        $('#scanner-message').textContent = running ? '等待识别' : '已连接';
      }
    }
    if (message.type === 'ack' && pending?.id === message.id) {
      clearTimeout(pending.timer);
      pending.record.status = message.ok ? 'success' : 'error';
      pending = null;
      renderRecentScans();
      $('#send-status').textContent = message.ok ? '已输入 PC' : '输入失败';
      $('#send-status').className = `result ${message.ok ? 'success' : 'error'}`;
      if (message.ok) {
        $('#scanner-message').textContent = '输入成功';
        error();
        if (soundEnabled) beep();
        navigator.vibrate?.(60);
      } else {
        $('#scanner-message').textContent = '输入失败';
        error(message.error);
      }
    }
  });
  socket.addEventListener('close', (event) => {
    setStatus(false);
    if (pending) {
      resetPending('结果未确认');
      error('连接断开，PC 输入结果未确认。请核对目标窗口后再扫码，不会自动重发。');
    }
    if (event.code === 1008) { error('配对已失效，请重新扫描 PC 端二维码。'); return; }
    if (!stopping) reconnectTimer = setTimeout(connect, 2500);
  });
  socket.addEventListener('error', () => error('连接失败，请检查 PC 服务、证书信任和局域网。'));
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
    error('内容为空、过长或含控制字符，无法输入。'); return false;
  }
  if (!record) {
    record = { value, format, time: Date.now(), status: 'unsent' };
    recentScans.unshift(record);
    recentScans.length = Math.min(recentScans.length, 20);
  }
  $('#last-scan-value').textContent = value;
  if (!connected()) {
    renderRecentScans();
    error('PC 未连接，未发送内容。'); return false;
  }
  let id;
  try { id = createRequestId(); }
  catch (cause) { error(`无法生成发送编号：${cause.message}`); return false; }
  record.status = 'pending';
  error();
  pending = { id, record, timer: setTimeout(() => {
    resetPending('结果未确认');
    error('PC 未及时确认，请核对目标窗口。不会自动重复发送。');
  }, 20000) };
  $('#send-status').textContent = '发送中';
  $('#send-status').className = 'result pending';
  $('#scanner-message').textContent = '正在发送';
  renderRecentScans();
  try { socket.send(JSON.stringify({ type: 'scan', id, value, format })); }
  catch {
    resetPending('结果未确认');
    error('发送中断，请核对 PC 后再手动重发。');
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
  $('#start-scan').innerHTML = '<i data-lucide="camera"></i><span>开启摄像头</span>';
  $('#torch').disabled = true;
  $('#switch-camera').disabled = true;
  $('#torch').setAttribute('aria-pressed', 'false');
  $('#scanner-message').textContent = '摄像头已暂停';
  refreshIcons();
  cameraPhase = '已停止';
  updateDiagnostics();
}
async function startCamera() {
  if (starting) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    cameraPhase = '环境检查失败';
    updateDiagnostics();
    error('当前页面无法调用相机。请确认 HTTPS 证书受信任，并使用已允许相机权限的 Chrome 等独立浏览器打开。'); return;
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
      cameraPhase = `请求镜头（参数方案 ${attempt}/3）`;
      $('#scanner-message').textContent = attempt === 1 ? '正在请求摄像头' : '尝试兼容参数';
      updateDiagnostics();
    });
    if (generation !== cameraGeneration || stopping || document.hidden) {
      stopStream(stream);
      return;
    }
    cameraStream = stream;
    phase = 'preview';
    cameraPhase = '启动预览与扫码';
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
            cameraPhase = '扫码解码失败';
            updateDiagnostics(decodeError);
            error('视频解码失败，请查看相机诊断并更新或更换浏览器。');
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
    $('#scanner-message').textContent = '等待识别';
    $('#start-scan').innerHTML = '<i data-lucide="pause"></i><span>暂停扫码</span>';
    cameraPhase = '相机运行中';
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
    cameraPhase = phase === 'preview' ? '预览初始化失败' : '镜头请求失败';
    updateDiagnostics(cause);
    error(cameraErrorMessage(cause, phase));
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
  } catch { error('当前镜头不支持手电筒。'); }
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
updateDiagnostics();
if (!token) {
  setStatus(false); error('未找到配对信息，请扫描 PC 端二维码打开。');
} else connect();
