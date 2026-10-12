const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const { WebSocket } = require('ws');
const { createScannerServer } = require('../electron/server.cjs');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    (url.startsWith('https:') ? https : http).get(url, options, (res) => {
      const chunks = [];
      res.on('data', (data) => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
async function connect(port, token, ca) {
  const socket = new WebSocket(`wss://127.0.0.1:${port}/ws?token=${token}`, { ca });
  const messages = [];
  const waiters = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiting = waiters[index];
      if (waiting.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiting.timer);
        waiting.resolve(message);
      }
    }
  });
  function wait(predicate) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Message timeout')), 3000);
      waiters.push({ predicate, resolve, timer });
    });
  }
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello' }));
  await wait((message) => message.type === 'state');
  return { socket, messages, wait };
}
test('LAN scanner: TLS, authentication, queue, settings, dedupe, failures', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-tests-'));
  const root = path.join(directory, 'public');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'mobile.html'), '<html>scanner</html>');
  const calls = [];
  const events = [];
  let active = 0;
  let peak = 0;
  const server = await createScannerServer({
    root, dataDir: directory, host: '127.0.0.1', port: 0, setupPort: 0,
    inject: async (value, enter) => {
      active++; peak = Math.max(active, peak);
      await delay(20);
      calls.push({ value, enter });
      active--;
      if (value === 'FAIL') throw new Error('Input blocked');
    },
    onEvent: (message) => events.push(message)
  });
  t.after(async () => { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const info = server.info();
  const caResponse = await request(`http://127.0.0.1:${info.setupPort}/certificate.cer`);
  const { X509Certificate } = require('node:crypto');
  const ca = new X509Certificate(caResponse.body).toString();
  const token = new URLSearchParams(new URL(info.mobileUrl).hash.slice(1)).get('token');
  assert.equal((await request(`https://127.0.0.1:${info.port}/mobile.html`, { ca })).status, 200);
  assert.equal((await request(`https://127.0.0.1:${info.port}/api/info`, { ca })).status, 403);
  assert.equal((await request(`https://127.0.0.1:${info.port}/%2e%2e%2fsecret`, { ca })).status, 403);
  const setup = (await request(`http://127.0.0.1:${info.setupPort}/setup`)).body.toString();
  assert.ok(!setup.includes(token), 'setup does not disclose the pairing token');
  assert.ok(setup.includes(info.fingerprint));
  await assert.rejects(new Promise((resolve, reject) => {
    const denied = new WebSocket(`wss://127.0.0.1:${info.port}/ws?token=wrong`, { ca });
    denied.once('open', () => { denied.close(); resolve(); });
    denied.once('error', reject);
  }));
  const first = await connect(info.port, token, ca);
  assert.equal(server.info().connectedDevices, 1);
  first.socket.send(JSON.stringify({ type: 'hello' }));
  await delay(20);
  assert.equal(server.info().connectedDevices, 1, 'hello cannot increment twice');
  const scan = { type: 'scan', id: 'scan-test-001', value: '  中文-123  ', format: 'QR_CODE' };
  first.socket.send(JSON.stringify(scan));
  first.socket.send(JSON.stringify(scan));
  assert.equal((await first.wait((message) => message.type === 'ack' && message.id === scan.id)).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].value, scan.value, 'whitespace is preserved');
  const second = await connect(info.port, token, ca);
  second.socket.send(JSON.stringify(scan));
  await second.wait((message) => message.type === 'ack' && message.id === scan.id);
  assert.equal(calls.length, 1, 'same scan id is not reinjected after reconnect');
  server.updateSettings({ enterAfterScan: false, sound: false });
  await second.wait((message) => message.type === 'settings' && message.settings.sound === false);
  for (let index = 0; index < 3; index++) {
    first.socket.send(JSON.stringify({ type: 'scan', id: `queue-test-${index}`, value: `item-${index}` }));
  }
  await first.wait((message) => message.type === 'ack' && message.id === 'queue-test-2');
  assert.equal(peak, 1, 'injections are serialized');
  assert.deepEqual(calls.slice(1).map((item) => item.enter), [false, false, false]);
  first.socket.send(JSON.stringify({ type: 'scan', id: 'scan-invalid', value: 'x\nx' }));
  assert.equal((await first.wait((message) => message.type === 'ack' && message.id === 'scan-invalid')).ok, false);
  assert.equal(calls.length, 4);
  first.socket.send(JSON.stringify({ type: 'scan', id: 'scan-failure', value: 'FAIL' }));
  const failed = await first.wait((message) => message.type === 'ack' && message.id === 'scan-failure');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Input blocked');
  assert.equal(server.history[0].status, 'error');
  first.socket.send(JSON.stringify({ type: 'scan', id: 'scan-after-fail', value: 'RECOVER' }));
  assert.equal((await first.wait((message) => message.type === 'ack' && message.id === 'scan-after-fail')).ok, true);
  const beforeResend = calls.length;
  first.socket.send(JSON.stringify({ ...scan, id: 'explicit-resend-001' }));
  assert.equal((await first.wait((message) => message.type === 'ack' && message.id === 'explicit-resend-001')).ok, true);
  assert.equal(calls.length, beforeResend + 1, 'a deliberate resend uses a fresh id and injects the same value again');
  assert.deepEqual(calls.at(-1), { value: scan.value, enter: false }, 'resend uses current PC Enter setting');
  server.clearHistory();
  assert.equal(server.history.length, 0);
  assert.ok(events.some((event) => event.type === 'history-cleared'));
  first.socket.close();
  second.socket.close();
  await delay(40);
  assert.equal(server.info().connectedDevices, 0);
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'lan-certificate.json')));
  assert.equal(persisted.fingerprint, info.fingerprint);
});

test('LAN scanner: custom ports rebind URLs and preserve the active service on conflicts', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-port-tests-'));
  const root = path.join(directory, 'public');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'mobile.html'), '<html>scanner</html>');
  const calls = [];
  const server = await createScannerServer({
    root, dataDir: directory, host: '127.0.0.1', port: 0, setupPort: 0,
    inject: async (value) => { await delay(25); calls.push(value); }
  });
  t.after(async () => { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const original = server.info();
  const caResponse = await request(`http://127.0.0.1:${original.setupPort}/certificate.cer`);
  const { X509Certificate } = require('node:crypto');
  const ca = new X509Certificate(caResponse.body).toString();
  const token = new URL(original.mobileUrl).hash;
  const tokenValue = new URLSearchParams(token.slice(1)).get('token');
  const first = await connect(original.port, tokenValue, ca);
  const scan = { type: 'scan', id: 'before-port-change', value: 'KEEP-HISTORY' };
  first.socket.send(JSON.stringify(scan));
  await first.wait((message) => message.type === 'ack' && message.id === scan.id);
  const nextPort = await freePort();
  let nextSetupPort = await freePort();
  while (nextSetupPort === nextPort) nextSetupPort = await freePort();
  const disconnected = new Promise((resolve) => first.socket.once('close', resolve));
  const changed = await server.setPorts({ port: nextPort, setupPort: nextSetupPort });
  await disconnected;

  assert.equal(changed.port, nextPort);
  assert.equal(changed.setupPort, nextSetupPort);
  assert.equal(new URL(changed.mobileUrl).port, String(nextPort));
  assert.equal(new URL(changed.pairingUrl).port, String(nextSetupPort));
  assert.equal(new URL(changed.mobileUrl).hash, token, 'port changes keep the pairing token');
  assert.equal(changed.fingerprint, original.fingerprint, 'changing ports keeps the certificate');
  assert.equal(server.history[0].value, scan.value);
  assert.equal((await request(`https://127.0.0.1:${nextPort}/mobile.html`, { ca })).status, 200);
  const setup = (await request(`http://127.0.0.1:${nextSetupPort}/setup`)).body.toString();
  assert.ok(setup.includes(`https://${changed.lanIp}:${nextPort}/mobile.html`));
  const second = await connect(nextPort, tokenValue, ca);
  second.socket.send(JSON.stringify(scan));
  await second.wait((message) => message.type === 'ack' && message.id === scan.id);
  assert.equal(calls.length, 1, 'scan dedupe survives a port switch');
  await server.setPorts({ port: nextPort, setupPort: nextSetupPort });
  assert.equal(second.socket.readyState, WebSocket.OPEN, 'unchanged ports keep WebSocket connections');

  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const occupiedPort = occupied.address().port;
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  await assert.rejects(server.setPorts({ port: occupiedPort, setupPort: nextSetupPort }), /已被占用/);
  assert.deepEqual(
    { port: server.info().port, setupPort: server.info().setupPort },
    { port: nextPort, setupPort: nextSetupPort },
    'a bind conflict keeps the old ports active'
  );
  assert.equal((await request(`https://127.0.0.1:${nextPort}/mobile.html`, { ca })).status, 200);
  assert.equal(second.socket.readyState, WebSocket.OPEN, 'conflicts do not disconnect the existing scanner');

  // A failure on the second listener must also release the staged first listener.
  const stagedPort = await freePort();
  await assert.rejects(server.setPorts({ port: stagedPort, setupPort: occupiedPort }), /已被占用/);
  const released = net.createServer();
  await new Promise((resolve, reject) => {
    released.once('error', reject);
    released.listen(stagedPort, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => released.close(resolve));

  const setupOnly = await freePort();
  await server.setPorts({ port: nextPort, setupPort: setupOnly });
  assert.equal(second.socket.readyState, WebSocket.OPEN, 'changing only HTTP preserves WSS');
  const pendingChange = server.setPorts({ port: setupOnly, setupPort: nextPort });
  await assert.rejects(server.setPorts({ port: nextPort, setupPort: setupOnly }), /正在切换/);
  const swapped = await pendingChange;
  assert.equal(swapped.port, setupOnly);
  assert.equal(swapped.setupPort, nextPort);
  assert.equal((await request(`https://127.0.0.1:${setupOnly}/mobile.html`, { ca })).status, 200);
  assert.equal((await request(`http://127.0.0.1:${nextPort}/setup`)).status, 200);
  const third = await connect(swapped.port, tokenValue, ca);
  third.socket.send(JSON.stringify({ ...scan, id: 'after-port-change' }));
  assert.equal((await third.wait((message) => message.type === 'ack' && message.id === 'after-port-change')).ok, true);
  assert.equal(calls.length, 2);
  for (const ports of [
    { port: 0, setupPort: nextPort }, { port: nextPort, setupPort: nextPort },
    { port: 65536, setupPort: nextPort }, { port: 1.2, setupPort: nextPort }
  ]) await assert.rejects(server.setPorts(ports));

  // A failed startup must not leave its HTTPS listener occupying a port.
  const startupPort = await freePort();
  await assert.rejects(createScannerServer({
    root, dataDir: directory, host: '127.0.0.1', port: startupPort, setupPort: occupiedPort,
    inject: async () => {}
  }), /已被占用/);
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(startupPort, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
});
