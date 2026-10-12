const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const selfsigned = require('selfsigned');
const { WebSocketServer } = require('ws');
const { DEFAULT_PORTS, validatePorts } = require('./settings.cjs');

function getAddresses() {
  const entries = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses || []).filter((item) => item.family === 'IPv4' && !item.internal &&
      !item.address.startsWith('169.254.')).map((item) => ({ name, address: item.address })));
  return entries.length ? entries : [{ name: '本机', address: '127.0.0.1' }];
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
async function loadCertificate(dataDir, addresses) {
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = path.join(dataDir, 'lan-certificate.json');
  const ips = [...new Set(['127.0.0.1', ...addresses.map((item) => item.address)])].sort();
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (JSON.stringify(saved.ips) === JSON.stringify(ips) && saved.expires > Date.now() + 86400000) return saved;
  } catch {}
  const now = new Date();
  const expires = new Date(Date.now() + 180 * 86400000);
  const ca = await selfsigned.generate([{ name: 'commonName', value: 'LAN Scan Gun Local CA' }], {
    algorithm: 'sha256', keySize: 2048, notBeforeDate: now, notAfterDate: expires,
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
    ]
  });
  const leaf = await selfsigned.generate([{ name: 'commonName', value: 'LAN Scan Gun' }], {
    algorithm: 'sha256', keySize: 2048, notBeforeDate: now, notAfterDate: expires,
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))
      ] }
    ]
  });
  const saved = {
    ips, key: leaf.private, cert: leaf.cert, ca: ca.cert, expires: expires.getTime(),
    fingerprint: new crypto.X509Certificate(ca.cert).fingerprint256
  };
  fs.writeFileSync(filename, JSON.stringify(saved), { mode: 0o600 });
  return saved;
}
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.removeListener('listening', ready);
      const message = error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请选择其他端口。` :
        error.code === 'EACCES' ? `没有权限使用端口 ${port}，请选择其他端口。` : error.message;
      reject(new Error(message, { cause: error }));
    };
    const ready = () => {
      server.removeListener('error', failed);
      resolve(server.address().port);
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, host);
  });
}
function closeListener(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      for (const socket of server.scannerSockets || []) socket.destroy();
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
    for (const socket of server.scannerSockets) socket.destroy();
  });
}
function trackSockets(server) {
  server.scannerSockets = new Set();
  server.on('connection', (socket) => {
    server.scannerSockets.add(socket);
    socket.once('close', () => server.scannerSockets.delete(socket));
  });
  return server;
}

async function createScannerServer(options) {
  const addresses = getAddresses();
  let address = addresses[0].address;
  let settings = {
    enterAfterScan: options.settings?.enterAfterScan !== false,
    sound: options.settings?.sound !== false
  };
  const token = crypto.randomBytes(24).toString('hex');
  const certificate = await loadCertificate(options.dataDir, addresses);
  const history = [];
  const results = new Map();
  let queue = Promise.resolve();
  let queued = 0;
  let closing = false;
  let changingPorts;
  let securePort;
  let setupPort;
  const host = options.host || '0.0.0.0';
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
  };
  function serveScanner(req, res) {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    if (pathname === '/api/info') { res.writeHead(403).end('Forbidden'); return; }
    const filename = path.resolve(options.root, '.' + (pathname === '/' ? '/mobile.html' : pathname));
    const relative = path.relative(options.root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
    let stat;
    try { stat = fs.statSync(filename); } catch { res.writeHead(404).end('Not found'); return; }
    if (!stat.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=()'
    });
    fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  function mobileUrl() { return `https://${address}:${securePort}/mobile.html#token=${token}`; }
  function info() {
    return {
      mobileUrl: mobileUrl(), pairingUrl: `http://${address}:${setupPort}/setup#token=${token}`,
      lanIp: address, port: securePort, setupPort, fingerprint: certificate.fingerprint,
      running: secure.listening && setup.listening,
      connectedDevices: [...wss.clients].filter((client) => client.ready && client.readyState === 1).length
    };
  }
  function send(socket, payload) {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  }
  function emit(payload) {
    for (const socket of wss.clients) if (socket.ready) send(socket, payload);
    options.onEvent?.(payload);
  }
  function status() { emit({ type: 'status', connectedDevices: info().connectedDevices }); }
  function upgrade(req, socket, head) {
    if (closing) { socket.destroy(); return; }
    let url;
    try { url = new URL(req.url, 'https://localhost'); } catch { socket.destroy(); return; }
    const supplied = url.searchParams.get('token') || '';
    const origin = req.headers.origin;
    const acceptedOrigin = !origin || origin === `https://${req.headers.host}`;
    if (url.pathname !== '/ws' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token)) || !acceptedOrigin) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
  }
  function createSecureListener() {
    const listener = trackSockets(https.createServer({
      key: certificate.key,
      cert: `${certificate.cert.trim()}\n${certificate.ca.trim()}\n`
    }, serveScanner));
    listener.on('upgrade', upgrade);
    return listener;
  }
  let secure = createSecureListener();
  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.ready = false;
    socket.on('error', () => {});
    socket.on('pong', () => { socket.alive = true; });
    const helloTimer = setTimeout(() => { if (!socket.ready) socket.close(1008, 'hello required'); }, 5000);
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'invalid JSON'); return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'hello' && !socket.ready) {
        socket.ready = true;
        clearTimeout(helloTimer);
        send(socket, { type: 'state', settings });
        status();
        return;
      }
      if (!socket.ready || message.type !== 'scan') return;
      if (typeof message.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(message.id) ||
        typeof message.value !== 'string' || !message.value.length || message.value.length > 4096 ||
        /[\x00-\x1f\x7f]/.test(message.value)) {
        send(socket, { type: 'ack', id: message.id, ok: false, error: '内容为空、过长或含控制字符，已拒绝输入。' });
        return;
      }
      if (results.has(message.id)) { results.get(message.id).then((ack) => send(socket, ack)); return; }
      if (queued >= 20) {
        send(socket, { type: 'ack', id: message.id, ok: false, error: '输入队列已满，请稍后扫码。' });
        return;
      }
      queued += 1;
      const enter = settings.enterAfterScan;
      const scan = {
        id: message.id, value: message.value,
        format: typeof message.format === 'string' ? message.format.slice(0, 40) : 'Barcode',
        time: new Date().toISOString(), status: 'pending', enterAfterScan: enter
      };
      history.unshift(scan);
      if (history.length > 100) history.pop();
      emit({ type: 'scan', scan: { ...scan } });
      const task = queue.then(async () => {
        let ack;
        try {
          if (closing) throw new Error('扫码服务已关闭，已取消输入。');
          await options.inject(scan.value, enter);
          scan.status = 'success';
          ack = { type: 'ack', id: scan.id, ok: true };
        } catch (error) {
          scan.status = 'error';
          scan.error = error.message;
          ack = { type: 'ack', id: scan.id, ok: false, error: error.message };
        }
        queued -= 1;
        emit({ type: 'scan-update', scan: { ...scan } });
        return ack;
      });
      queue = task.then(() => undefined, () => undefined);
      results.set(message.id, task);
      if (results.size > 1000) results.delete(results.keys().next().value);
      task.then((ack) => send(socket, ack));
    });
    socket.on('close', () => { clearTimeout(helloTimer); if (socket.ready) status(); });
  });
  function serveSetup(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/certificate.cer') {
      const der = new crypto.X509Certificate(certificate.ca).raw;
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="LAN-Scan-Gun-CA.cer"',
        'Cache-Control': 'no-store'
      }).end(der);
      return;
    }
    if (!['/', '/setup'].includes(pathname)) { res.writeHead(404).end(); return; }
    const target = new URL(mobileUrl());
    target.hash = '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(`<!doctype html>
      <html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>连接扫码器</title><style>
      *{box-sizing:border-box}body{font:15px system-ui;margin:0;color:#20252a;background:#f5f6f7}
      main{max-width:560px;margin:auto;padding:32px 22px}h1{font-size:26px}p,li{line-height:1.8}
      a{display:block;padding:14px;margin:20px 0;background:#087e6b;color:white;text-align:center;text-decoration:none;border-radius:6px}
      code{display:block;font-size:11px;overflow-wrap:anywhere;padding:12px;background:#e5e9eb}
      </style><main><h1>连接 LAN Scan Gun</h1><p>首次连接需要信任这台电脑的本地证书，手机摄像头才能使用。</p>
      <a href="/certificate.cer">下载本地证书</a>
      <ol><li>先核对下方指纹与 PC 端显示一致。</li>
      <li>iPhone：设置 → 已下载描述文件 → 安装；再到 通用 → 关于本机 → 证书信任设置，启用本证书完全信任。</li>
      <li>Android：设置中搜索「安装证书」，选择 CA 证书并安装下载的文件。不同品牌路径可能不同。</li></ol>
      <code>${escapeHtml(certificate.fingerprint)}</code>
      <a id="continue">打开扫码页</a><p>仅信任你自己的电脑，用完可在系统设置删除本证书。请保持两台设备在同一局域网。</p>
      <script>const token=new URLSearchParams(location.hash.slice(1)).get('token');const link=document.querySelector('#continue');
      if(token){link.href=${JSON.stringify(target.href)}+'#token='+encodeURIComponent(token)}
      else{link.textContent='请重新扫描 PC 端连接二维码'}</script></main></html>`);
  }
  function createSetupListener() { return trackSockets(http.createServer(serveSetup)); }
  let setup = createSetupListener();
  try {
    securePort = await listen(secure, options.port ?? DEFAULT_PORTS.port, host);
    setupPort = await listen(setup, options.setupPort ?? DEFAULT_PORTS.setupPort, host);
  } catch (error) {
    await Promise.all([secure, setup].map(closeListener));
    wss.close();
    throw error;
  }
  async function changePorts(next) {
    const previous = { port: securePort, setupPort };
    const changes = [
      { old: secure, oldPort: securePort, port: next.port, create: createSecureListener },
      { old: setup, oldPort: setupPort, port: next.setupPort, create: createSetupListener }
    ].filter((item) => item.port !== item.oldPort);
    if (!changes.length) return info();
    let released = false;
    try {
      // Bind unoccupied new ports before touching the active service. Swaps reuse our own ports.
      for (const item of changes) {
        item.listener = item.create();
        if (![previous.port, previous.setupPort].includes(item.port)) {
          await listen(item.listener, item.port, host);
        }
      }
      if (closing) throw new Error('扫码服务已关闭。');
      if (next.port !== securePort) {
        for (const socket of wss.clients) socket.terminate();
      }
      released = true;
      await Promise.all(changes.map((item) => closeListener(item.old)));
      for (const item of changes) {
        if (!item.listener.listening) await listen(item.listener, item.port, host);
      }
      if (closing) throw new Error('扫码服务已关闭。');
      secure = changes.find((item) => item.old === secure)?.listener || secure;
      setup = changes.find((item) => item.old === setup)?.listener || setup;
      securePort = next.port;
      setupPort = next.setupPort;
      return info();
    } catch (error) {
      await Promise.all(changes.filter((item) => item.listener).map((item) => closeListener(item.listener)));
      if (released && !closing) {
        const restored = await Promise.allSettled(changes.map((item) => listen(item.old, item.oldPort, host)));
        if (restored.some((item) => item.status === 'rejected')) {
          throw new Error(`${error.message} 原端口恢复失败，请关闭占用端口的程序后重启。`);
        }
      }
      throw error;
    }
  }
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  return {
    history, info,
    async setPorts(ports) {
      const next = validatePorts(ports);
      if (closing) throw new Error('扫码服务已关闭。');
      if (changingPorts) throw new Error('端口正在切换，请稍后再试。');
      changingPorts = changePorts(next);
      try { return await changingPorts; }
      finally { changingPorts = undefined; }
    },
    setAddress(next) {
      if (!addresses.some((item) => item.address === next)) throw new Error('不可用的网卡地址。');
      address = next;
    },
    updateSettings(next) {
      settings = { enterAfterScan: Boolean(next.enterAfterScan), sound: Boolean(next.sound) };
      emit({ type: 'settings', settings });
    },
    clearHistory() { history.length = 0; emit({ type: 'history-cleared' }); },
    async close() {
      closing = true;
      clearInterval(heartbeat);
      if (changingPorts) await changingPorts.catch(() => {});
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      await Promise.all([secure, setup].map(closeListener));
    }
  };
}

module.exports = { createScannerServer, getAddresses };
