const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { InputWorker } = require('../electron/input-worker.cjs');
const { WindowsInput } = require('../electron/windows-input.cjs');
const { MacOSInput } = require('../electron/macos-input.cjs');
const { createInput } = require('../electron/input.cjs');

function fakeWorker() {
  const worker = new EventEmitter();
  worker.stdout = new PassThrough();
  worker.stderr = new PassThrough();
  worker.payloads = [];
  worker.killed = false;
  worker.stdin = new Writable({
    write(data, _encoding, callback) {
      worker.payloads.push(JSON.parse(data.toString()));
      callback();
    }
  });
  worker.kill = () => { worker.killed = true; };
  worker.reply = (result) => worker.stdout.write(JSON.stringify(result) + '\n');
  return worker;
}

test('input factory selects a native backend and explicitly rejects unsupported platforms', async () => {
  assert.ok(createInput('win32') instanceof WindowsInput);
  assert.ok(createInput('darwin') instanceof MacOSInput);
  const unsupported = createInput('linux');
  assert.deepEqual(await unsupported.getStatus(), { supported: false, trusted: false });
  await assert.rejects(unsupported.send('TEST', true), /仅支持 Windows 和 macOS/);
  unsupported.close();
});

test('input worker waits for matching acknowledgements, preserves errors, and reuses the process', async (t) => {
  const worker = fakeWorker();
  let starts = 0;
  const input = new InputWorker({
    command: 'helper', label: 'test', spawnWorker: () => { starts++; return worker; }
  });
  t.after(() => input.close());
  const first = input.request({ text: 'first', enter: false });
  const second = input.request({ text: 'second', enter: true });
  worker.stdout.write('not JSON\n');
  worker.reply({ id: 'unknown', ok: true });
  worker.reply({ id: worker.payloads[1].id, ok: false, error: 'Permission denied' });
  await assert.rejects(second, /Permission denied/);
  worker.reply({ id: worker.payloads[0].id, ok: true });
  await first;
  assert.equal(starts, 1);
  assert.equal(input.pending.size, 0);
});

test('input timeouts cancel all in-flight requests and stale exits cannot break a new worker', async (t) => {
  const workers = [];
  const input = new InputWorker({
    command: 'helper', label: 'test', timeout: 20,
    spawnWorker: () => { const worker = fakeWorker(); workers.push(worker); return worker; }
  });
  t.after(() => input.close());
  const first = assert.rejects(input.request({ command: 'type' }), /输入超时/);
  const second = assert.rejects(input.request({ command: 'status' }), /输入超时/);
  await Promise.all([first, second]);
  assert.equal(workers[0].killed, true);
  assert.equal(input.pending.size, 0);
  const recovery = input.request({ command: 'status' });
  workers[0].emit('exit', 1);
  workers[1].reply({ id: workers[1].payloads[0].id, ok: true, trusted: true });
  assert.equal((await recovery).trusted, true);
});

test('input close and process failures reject requests without leaving pending timers', async () => {
  for (const failure of ['close', 'exit', 'error', 'stdin-error']) {
    const worker = fakeWorker();
    const input = new InputWorker({ command: 'helper', label: 'test', spawnWorker: () => worker });
    const result = assert.rejects(input.request({ command: 'type' }), /关闭|退出|broken/);
    if (failure === 'close') input.close();
    if (failure === 'exit') worker.emit('exit', 1);
    if (failure === 'error') worker.emit('error', new Error('broken'));
    if (failure === 'stdin-error') worker.stdin.emit('error', new Error('broken pipe'));
    await result;
    assert.equal(input.pending.size, 0);
    input.close();
    await assert.rejects(input.request({}), /已关闭/);
  }
});

test('native wrappers keep Unicode, whitespace and Enter independent from permission checks', async (t) => {
  const Constructor = process.platform === 'win32' ? WindowsInput : MacOSInput;
  if (!['win32', 'darwin'].includes(process.platform)) return t.skip('Native platform wrapper');
  const worker = fakeWorker();
  const input = new Constructor({ spawnWorker: () => worker });
  t.after(() => input.close());
  for (const enter of [false, true]) {
    const value = '  中文-🙂-123  ';
    const send = input.send(value, enter);
    const payload = worker.payloads.at(-1);
    assert.equal(Buffer.from(payload.text, 'base64').toString('utf8'), value);
    assert.equal(payload.enter, enter);
    worker.reply({ id: payload.id, ok: true });
    await send;
  }
  if (input instanceof MacOSInput) {
    const status = input.getStatus();
    const payload = worker.payloads.at(-1);
    assert.equal(payload.command, 'status');
    worker.reply({ id: payload.id, ok: true, trusted: false });
    assert.deepEqual(await status, { supported: true, trusted: false });
    const permission = input.requestPermission();
    const request = worker.payloads.at(-1);
    assert.equal(request.command, 'permission');
    worker.reply({ id: request.id, ok: true, trusted: true });
    assert.deepEqual(await permission, { supported: true, trusted: true });
  }
});

test('missing macOS helper is reported as unavailable, never trusted', async () => {
  const input = new MacOSInput({ spawnWorker: () => { throw new Error('ENOENT'); } });
  assert.match((await input.getStatus()).error, /不可用.*ENOENT/);
  input.close();
});

test('compiled macOS helper responds to status and rejects invalid text without posting events', async (t) => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const executable = path.join(__dirname, '../electron/bin/input-macos');
  if (!fs.existsSync(executable)) return t.skip('Run npm run build to compile the helper');
  const worker = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let diagnostics = '';
  worker.stdout.on('data', (data) => { output += data; });
  worker.stderr.on('data', (data) => { diagnostics += data; });
  const exited = new Promise((resolve, reject) => {
    worker.on('error', reject);
    worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error(diagnostics || `Exit ${code}`)));
  });
  t.after(() => worker.kill());
  const requests = [
    { id: 'status', command: 'status' },
    { id: 'invalid', command: 'type', text: '!', enter: true },
    { id: 'empty', command: 'type', text: '', enter: false },
    { id: 'control', command: 'type', text: Buffer.from('a\nb').toString('base64'), enter: true },
    { id: 'long', command: 'type', text: Buffer.from('A'.repeat(4097)).toString('base64'), enter: true },
    { id: 'unknown', command: 'unknown' }
  ];
  worker.stdin.end(requests.map((item) => JSON.stringify(item)).join('\n') + '\n');
  await exited;
  const results = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(results.length, requests.length);
  assert.equal(results[0].ok, true);
  assert.equal(typeof results[0].trusted, 'boolean');
  for (const result of results.slice(1)) {
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  }
});
