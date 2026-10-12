import QRCode from 'qrcode';
import { refreshIcons, escapeHtml, time } from './ui';
import './styles.css';

let info;
let history = [];
const bridge = window.scanGun;
const $ = (selector) => document.querySelector(selector);
document.querySelector('#app').innerHTML = `
<header class="topbar">
  <div class="brand"><i data-lucide="scan-line"></i><strong>LAN Scan Gun</strong><span class="muted">局域网扫码枪</span></div>
  <span class="status" id="connection-status"><span class="dot"></span>等待设备</span>
</header>
<main class="desktop-content">
  <div class="page-heading"><h1>扫码工作台</h1><span class="service-state"><span class="dot green"></span><span id="service-status">启动中</span></span></div>
  <div id="notice" class="notice" hidden></div>
  <div class="workspace">
    <section class="connection-section">
      <div class="section-heading"><h2>设备连接</h2><i data-lucide="smartphone"></i></div>
      <div class="pairing-code"><canvas id="qr-canvas" aria-label="移动设备连接二维码"></canvas></div>
      <label class="field-label" for="network">网络接口</label>
      <select id="network"></select>
      <div class="address-row"><code id="mobile-url">等待服务</code>
        <button id="copy-url" class="icon-btn" title="复制连接地址" aria-label="复制连接地址"><i data-lucide="copy"></i></button>
        <button id="open-mobile" class="icon-btn" title="打开连接页" aria-label="打开连接页"><i data-lucide="external-link"></i></button>
      </div>
      <details class="certificate-details"><summary>本地证书</summary><code id="fingerprint"></code></details>
      <form id="port-settings" novalidate>
        <div class="section-heading settings-heading"><h2>端口设置</h2>
          <button id="apply-ports" class="icon-btn" type="submit" title="应用并保存端口" aria-label="应用并保存端口"><i data-lucide="check"></i></button>
        </div>
        <div class="port-fields">
          <label class="field-label" for="scanner-port">扫码服务 (HTTPS/WSS)
            <input id="scanner-port" type="number" min="1" max="65535" step="1" required value="8787" inputmode="numeric">
          </label>
          <label class="field-label" for="setup-port">连接页 (HTTP)
            <input id="setup-port" type="number" min="1" max="65535" step="1" required value="8788" inputmode="numeric">
          </label>
        </div>
      </form>
      <div class="section-heading settings-heading"><h2>输入设置</h2><i data-lucide="keyboard"></i></div>
      <label class="setting"><span>扫码后回车</span><input id="enter-setting" type="checkbox" role="switch" checked></label>
      <label class="setting"><span>手机提示音</span><input id="sound-setting" type="checkbox" role="switch" checked></label>
      <div class="device-summary"><i data-lucide="wifi"></i><span id="device-count">暂无移动设备</span></div>
    </section>
    <section class="records-section">
      <div class="section-heading"><h2>扫描记录 <span class="count" id="scan-count">0</span></h2>
        <button id="clear-history" class="icon-btn" title="清空记录" aria-label="清空记录"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="table-scroll"><table><thead><tr><th>内容</th><th>码制</th><th>时间</th><th>状态</th></tr></thead>
        <tbody id="history-list"></tbody></table></div>
      <div id="empty-state" class="empty-state"><i data-lucide="scan-barcode"></i><span>暂无扫描记录</span></div>
      <div class="records-footer"><span id="success-count">0 次输入成功</span><span>最近 100 条</span></div>
    </section>
  </div>
</main>`;

function updateStatus(count) {
  $('#connection-status').classList.toggle('connected', count > 0);
  $('#connection-status').innerHTML = `<span class="dot"></span>${count > 0 ? `${count} 台设备在线` : '等待设备'}`;
  $('#device-count').textContent = count > 0 ? `${count} 台移动设备已连接` : '暂无移动设备';
}
function renderHistory() {
  $('#scan-count').textContent = history.length;
  $('#empty-state').hidden = history.length > 0;
  $('#success-count').textContent = `${history.filter((item) => item.status === 'success').length} 次输入成功`;
  $('#history-list').innerHTML = history.map((item) => `<tr>
    <td class="scan-value">${escapeHtml(item.value)}${item.error ? `<span class="scan-error">${escapeHtml(item.error)}</span>` : ''}</td>
    <td>${escapeHtml(item.format)}</td><td class="time-cell">${time(item.time)}</td>
    <td><span class="result ${item.status}">${{ pending: '输入中', success: '已输入', error: '失败' }[item.status] || '已收到'}</span></td>
  </tr>`).join('');
}
async function renderConnection() {
  $('#mobile-url').textContent = info.pairingUrl.replace(/#.*$/, '');
  $('#fingerprint').textContent = info.fingerprint;
  $('#scanner-port').value = info.port;
  $('#setup-port').value = info.setupPort;
  if (bridge) $('#service-status').textContent = info.running === false ?
    '服务异常 · 请重启' : `服务运行中 · ${info.port} / ${info.setupPort}`;
  await QRCode.toCanvas($('#qr-canvas'), info.pairingUrl, {
    width: 232, margin: 2, color: { dark: '#182b27', light: '#ffffff' }
  });
}
function notice(text) {
  $('#notice').hidden = !text;
  $('#notice').textContent = text;
}
async function initialize() {
  refreshIcons();
  if (!bridge) {
    info = {
      pairingUrl: `${location.protocol}//${location.hostname}:8788/setup#token=preview-only`,
      port: 8787, setupPort: 8788,
      fingerprint: '预览模式：请在 Windows 桌面端连接真实设备。'
    };
    $('#network').innerHTML = `<option>界面预览</option>`;
    $('#service-status').textContent = '预览模式';
    notice('当前是网页预览。系统光标输入和设备配对需要 Windows 桌面端。');
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
  $('#service-status').textContent = `服务运行中 · ${info.port} / ${info.setupPort}`;
  $('#network').innerHTML = info.addresses.map((item) =>
    `<option value="${escapeHtml(item.address)}">${escapeHtml(item.name)} · ${escapeHtml(item.address)}</option>`).join('');
  $('#network').value = info.lanIp;
  $('#enter-setting').checked = info.settings.enterAfterScan;
  $('#sound-setting').checked = info.settings.sound;
  updateStatus(info.connectedDevices);
  if (info.platform !== 'win32') notice('当前为非 Windows 环境。连接和扫码可测试，但系统光标输入仅支持 Windows。');
  await renderConnection();
  renderHistory();
  $('#network').addEventListener('change', async () => {
    try { info = { ...info, ...await bridge.selectAddress($('#network').value) }; await renderConnection(); }
    catch (error) { notice(error.message); }
  });
  $('#copy-url').addEventListener('click', async () => {
    await bridge.copyUrl();
    $('#copy-url').title = '已复制';
    setTimeout(() => { $('#copy-url').title = '复制连接地址'; }, 1500);
  });
  $('#open-mobile').addEventListener('click', () => bridge.openMobileUrl());
  $('#clear-history').addEventListener('click', () => bridge.clearHistory());
  $('#port-settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    const port = $('#scanner-port').valueAsNumber;
    const setupPort = $('#setup-port').valueAsNumber;
    if (!$('#port-settings').checkValidity()) {
      notice('端口号必须是 1–65535 之间的整数。');
      return;
    }
    if (port === setupPort) {
      notice('扫码服务与连接页不能使用同一个端口。');
      return;
    }
    if (port === info.port && setupPort === info.setupPort) {
      notice('端口未改变。');
      return;
    }
    const controls = ['#scanner-port', '#setup-port', '#apply-ports', '#network', '#copy-url', '#open-mobile'];
    controls.forEach((selector) => { $(selector).disabled = true; });
    try {
      info = { ...info, ...await bridge.setPorts({ port, setupPort }) };
      updateStatus(info.connectedDevices);
      await renderConnection();
      notice('端口已保存。请用移动设备重新扫描二维码连接，并在 Windows 防火墙放行新端口。');
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
    }
    if (message.type === 'history-cleared') { history = []; renderHistory(); }
  });
}
initialize().catch((error) => notice(`初始化失败：${error.message}`));
