import QRCode from 'qrcode';
import { refreshIcons, escapeHtml, time } from './ui';
import { createI18n, detectLanguage, translateElements } from './i18n.mjs';
import './styles.css';

let info;
let history = [];
const bridge = window.scanGun;
const $ = (selector) => document.querySelector(selector);
const i18n = createI18n(detectLanguage(navigator.language));
const t = (key, values) => i18n.t(key, values);
let languageMode = 'auto';
document.querySelector('#app').innerHTML = `
<header class="topbar">
  <div class="brand"><i data-lucide="scan-line"></i><strong>LAN Scan Gun</strong><span class="muted" data-i18n="brandSubtitle"></span></div>
  <span class="status" id="connection-status"><span class="dot"></span><span data-i18n="waitingDevices"></span></span>
</header>
<main class="desktop-content">
  <div class="page-heading"><h1 data-i18n="workspace"></h1><span class="service-state"><span class="dot green"></span><span id="service-status" data-i18n="starting"></span></span></div>
  <div id="notice" class="notice" hidden></div>
  <div class="workspace">
    <section class="connection-section">
      <div class="section-heading"><h2 data-i18n="deviceConnection"></h2><i data-lucide="smartphone"></i></div>
      <div class="pairing-code"><canvas id="qr-canvas" data-i18n-aria-label="mobileQrAria"></canvas></div>
      <label class="field-label" for="network" data-i18n="networkInterface"></label>
      <select id="network"></select>
      <div class="address-row"><code id="mobile-url" data-i18n="waitingService"></code>
        <button id="copy-url" class="icon-btn" data-i18n-title="copyUrl" data-i18n-aria-label="copyUrl"><i data-lucide="copy"></i></button>
        <button id="open-mobile" class="icon-btn" data-i18n-title="openMobile" data-i18n-aria-label="openMobile"><i data-lucide="external-link"></i></button>
      </div>
      <details class="certificate-details"><summary data-i18n="localCertificate"></summary><code id="fingerprint"></code></details>
      <form id="port-settings" novalidate>
        <div class="section-heading settings-heading"><h2 data-i18n="portSettings"></h2>
          <button id="apply-ports" class="icon-btn" type="submit" data-i18n-title="applyPorts" data-i18n-aria-label="applyPorts"><i data-lucide="check"></i></button>
        </div>
        <div class="port-fields">
          <label class="field-label" for="scanner-port"><span data-i18n="scannerService"></span>
            <input id="scanner-port" type="number" min="1" max="65535" step="1" required value="8787" inputmode="numeric">
          </label>
          <label class="field-label" for="setup-port"><span data-i18n="setupPage"></span>
            <input id="setup-port" type="number" min="1" max="65535" step="1" required value="8788" inputmode="numeric">
          </label>
        </div>
      </form>
      <div class="section-heading settings-heading"><h2 data-i18n="inputSettings"></h2><i data-lucide="keyboard"></i></div>
      <div id="input-permission" class="setting" hidden><span id="input-permission-status"></span>
        <button id="grant-input-permission" class="icon-btn" data-i18n-title="openAccessibility" data-i18n-aria-label="openAccessibility"><i data-lucide="settings"></i></button>
      </div>
      <label class="setting"><span data-i18n="enterAfterScan"></span><input id="enter-setting" type="checkbox" role="switch" checked></label>
      <label class="setting"><span data-i18n="phoneSound"></span><input id="sound-setting" type="checkbox" role="switch" checked></label>
      <label class="setting language-setting"><span data-i18n="language"></span><select id="language-setting">
        <option value="auto" data-i18n="auto"></option><option value="zh">中文</option><option value="en">English</option>
      </select></label>
      <div class="device-summary"><i data-lucide="wifi"></i><span id="device-count" data-i18n="noMobile"></span></div>
    </section>
    <section class="records-section">
      <div class="section-heading"><h2><span data-i18n="scanRecords"></span><span class="count" id="scan-count">0</span></h2>
        <button id="clear-history" class="icon-btn" data-i18n-title="clearRecords" data-i18n-aria-label="clearRecords"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="table-scroll"><table><thead><tr><th data-i18n="content"></th><th data-i18n="format"></th><th data-i18n="time"></th><th data-i18n="status"></th></tr></thead>
        <tbody id="history-list"></tbody></table></div>
      <div id="empty-state" class="empty-state"><i data-lucide="scan-barcode"></i><span data-i18n="noRecords"></span></div>
      <div class="records-footer"><span id="success-count"></span><span data-i18n="recent100"></span></div>
    </section>
  </div>
</main>`;

function applyLanguage() {
  i18n.setLanguage(detectLanguage(info?.locale || navigator.language, languageMode));
  document.documentElement.lang = i18n.language === 'zh' ? 'zh-CN' : 'en';
  translateElements(document, t);
  $('#language-setting').value = languageMode;
  updateStatus(info?.connectedDevices || 0);
  renderHistory();
  if (info) {
    renderServiceStatus();
    if (info.inputStatus) renderInputStatus(info.inputStatus);
    if (!bridge) {
      $('#network').innerHTML = `<option>${t('preview')}</option>`;
      $('#fingerprint').textContent = t('previewFingerprint');
    }
  }
}
function renderServiceStatus() {
  $('#service-status').textContent = !bridge ? t('preview') :
    info.running === false ? t('serviceError') : t('serviceRunning', info);
}
function updateStatus(count) {
  if (info) info.connectedDevices = count;
  $('#connection-status').classList.toggle('connected', count > 0);
  $('#connection-status').innerHTML = `<span class="dot"></span>${count > 0 ? t('devicesOnline', { count }) : t('waitingDevices')}`;
  $('#device-count').textContent = count > 0 ? t('devicesConnected', { count }) : t('noMobile');
}
function renderHistory() {
  $('#scan-count').textContent = history.length;
  $('#empty-state').hidden = history.length > 0;
  $('#success-count').textContent = t('successCount', { count: history.filter((item) => item.status === 'success').length });
  $('#history-list').innerHTML = history.map((item) => `<tr>
    <td class="scan-value">${escapeHtml(item.value)}${item.error ? `<span class="scan-error">${escapeHtml(item.error)}</span>` : ''}</td>
    <td>${escapeHtml(item.format)}</td><td class="time-cell">${time(item.time, i18n.language)}</td>
    <td><span class="result ${item.status}">${t({ pending: 'statusInputting', success: 'statusEntered', error: 'statusFailed' }[item.status] || 'statusReceived')}</span></td>
  </tr>`).join('');
}
async function renderConnection() {
  $('#mobile-url').textContent = info.pairingUrl.replace(/#.*$/, '');
  $('#fingerprint').textContent = info.fingerprint;
  $('#scanner-port').value = info.port;
  $('#setup-port').value = info.setupPort;
  renderServiceStatus();
  await QRCode.toCanvas($('#qr-canvas'), info.pairingUrl, {
    width: 232, margin: 2, color: { dark: '#182b27', light: '#ffffff' }
  });
}
function notice(text) {
  $('#notice').hidden = !text;
  $('#notice').textContent = text;
}
function renderInputStatus(status) {
  info.inputStatus = status;
  $('#input-permission').hidden = info.platform !== 'darwin';
  $('#input-permission-status').textContent = status.error ? t('inputUnavailable') :
    `${t('accessibility')} · ${t(status.trusted ? 'granted' : 'notGranted')}`;
  if (status.error) notice(status.error);
}
async function refreshInputStatus() {
  try { renderInputStatus(await bridge.getInputStatus()); }
  catch (error) { notice(error.message); }
}
async function initialize() {
  applyLanguage();
  $('#language-setting').addEventListener('change', async () => {
    const previous = languageMode;
    $('#language-setting').disabled = true;
    try {
      const next = $('#language-setting').value;
      if (bridge) info.settings = await bridge.setSettings({ language: next });
      languageMode = next;
      applyLanguage();
      notice('');
    } catch (error) {
      languageMode = previous;
      $('#language-setting').value = previous;
      notice(error.message);
    } finally { $('#language-setting').disabled = false; }
  });
  refreshIcons();
  if (!bridge) {
    info = {
      pairingUrl: `${location.protocol}//${location.hostname}:8788/setup#token=preview-only`,
      port: 8787, setupPort: 8788,
      fingerprint: t('previewFingerprint')
    };
    applyLanguage();
    notice(t('previewNotice'));
    $('#enter-setting').disabled = $('#sound-setting').disabled = true;
    $('#copy-url').disabled = $('#open-mobile').disabled = true;
    $('#clear-history').disabled = true;
    $('#scanner-port').disabled = $('#setup-port').disabled = $('#apply-ports').disabled = true;
    await renderConnection();
    renderHistory();
    return;
  }
  info = await bridge.getAppInfo();
  history = info.history;
  languageMode = info.settings.language || 'auto';
  applyLanguage();
  $('#network').innerHTML = info.addresses.map((item) =>
    `<option value="${escapeHtml(item.address)}">${escapeHtml(item.name)} · ${escapeHtml(item.address)}</option>`).join('');
  $('#network').value = info.lanIp;
  $('#enter-setting').checked = info.settings.enterAfterScan;
  $('#sound-setting').checked = info.settings.sound;
  updateStatus(info.connectedDevices);
  renderInputStatus(info.inputStatus);
  if (!info.inputStatus.supported) notice(t('unsupportedInput'));
  await renderConnection();
  renderHistory();
  $('#grant-input-permission').addEventListener('click', async () => {
    $('#grant-input-permission').disabled = true;
    try { renderInputStatus(await bridge.requestInputPermission()); }
    catch (error) { notice(error.message); }
    finally { $('#grant-input-permission').disabled = false; }
  });
  if (info.platform === 'darwin') window.addEventListener('focus', refreshInputStatus);
  $('#network').addEventListener('change', async () => {
    try { info = { ...info, ...await bridge.selectAddress($('#network').value) }; await renderConnection(); }
    catch (error) { notice(error.message); }
  });
  $('#copy-url').addEventListener('click', async () => {
    await bridge.copyUrl();
    $('#copy-url').title = t('copied');
    setTimeout(() => { $('#copy-url').title = t('copyUrl'); }, 1500);
  });
  $('#open-mobile').addEventListener('click', () => bridge.openMobileUrl());
  $('#clear-history').addEventListener('click', () => bridge.clearHistory());
  $('#port-settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    const port = $('#scanner-port').valueAsNumber;
    const setupPort = $('#setup-port').valueAsNumber;
    if (!$('#port-settings').checkValidity()) {
      notice(t('portsInvalid'));
      return;
    }
    if (port === setupPort) {
      notice(t('portsSame'));
      return;
    }
    if (port === info.port && setupPort === info.setupPort) {
      notice(t('portsUnchanged'));
      return;
    }
    const controls = ['#scanner-port', '#setup-port', '#apply-ports', '#network', '#copy-url', '#open-mobile'];
    controls.forEach((selector) => { $(selector).disabled = true; });
    try {
      info = { ...info, ...await bridge.setPorts({ port, setupPort }) };
      updateStatus(info.connectedDevices);
      await renderConnection();
      notice(t('portsSaved'));
    } catch (error) {
      notice(error.message);
      info = { ...info, ...await bridge.getAppInfo() };
      updateStatus(info.connectedDevices);
      await renderConnection();
    } finally {
      controls.forEach((selector) => { $(selector).disabled = false; });
    }
  });
  const settingsChanged = async () => {
    try {
      await bridge.setSettings({ enterAfterScan: $('#enter-setting').checked, sound: $('#sound-setting').checked });
    } catch (error) { notice(error.message); }
  };
  $('#enter-setting').addEventListener('change', settingsChanged);
  $('#sound-setting').addEventListener('change', settingsChanged);
  bridge.onServerEvent((message) => {
    if (message.type === 'status') updateStatus(message.connectedDevices);
    if (message.type === 'scan' || message.type === 'scan-update') {
      const index = history.findIndex((item) => item.id === message.scan.id);
      if (index >= 0) history[index] = message.scan;
      else if (message.type === 'scan') history.unshift(message.scan);
      history = history.slice(0, 100);
      renderHistory();
      if (message.type === 'scan-update' && message.scan.status === 'error' && info.platform === 'darwin') {
        refreshInputStatus();
      }
    }
    if (message.type === 'history-cleared') { history = []; renderHistory(); }
  });
}
initialize().catch((error) => notice(t('initFailed', { message: error.message })));
