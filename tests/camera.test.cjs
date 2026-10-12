const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../src/renderer/camera.mjs');
function failure(name) { return Object.assign(new Error(name), { name }); }

test('camera prefers rear lens, relaxes unsupported resolution and device constraints', async () => {
  const { openCameraStream } = await helpers;
  const attempts = [];
  const stream = {};
  const devices = { getUserMedia: async (constraints) => {
    attempts.push(constraints);
    if (attempts.length < 3) throw failure('OverconstrainedError');
    return stream;
  } };
  assert.equal(await openCameraStream(devices), stream);
  assert.deepEqual(attempts[0].video.facingMode, { ideal: 'environment' });
  assert.ok(attempts[0].video.width);
  assert.equal(attempts[1].video.width, undefined);
  assert.equal(attempts[2].video, true);
  attempts.length = 0;
  await openCameraStream(devices, 'obsolete-camera-id');
  assert.deepEqual(attempts[0].video.deviceId, { exact: 'obsolete-camera-id' });
  assert.equal(attempts[2].video, true);
});
test('camera retries device read errors but does not re-request denied permissions', async () => {
  const { openCameraStream } = await helpers;
  let calls = 0;
  const denied = failure('NotAllowedError');
  await assert.rejects(openCameraStream({ getUserMedia: async () => { calls++; throw denied; } }), denied);
  assert.equal(calls, 1);
  calls = 0;
  const stream = {};
  assert.equal(await openCameraStream({ getUserMedia: async () => {
    if (++calls === 1) throw failure('NotReadableError');
    return stream;
  } }), stream);
  assert.equal(calls, 2);
});
test('unsupported optional Android camera APIs do not close a running stream', async () => {
  const { cameraMetadata, stopStream } = await helpers;
  let stopped = 0;
  const track = {
    getSettings: () => { throw failure('NotSupportedError'); },
    getCapabilities: () => { throw failure('NotSupportedError'); },
    stop: () => stopped++
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const metadata = await cameraMetadata({ enumerateDevices: async () => { throw failure('SecurityError'); } }, stream);
  assert.deepEqual(metadata, { devices: [], torch: false, deviceId: '' });
  assert.equal(stopped, 0);
  stopStream(stream);
  assert.equal(stopped, 1);
});
test('older Android browsers can generate a fresh resend id without randomUUID', async () => {
  const { createRequestId } = await helpers;
  const ids = new Set();
  for (let count = 0; count < 20; count++) {
    const id = createRequestId({ getRandomValues: (bytes) => require('node:crypto').webcrypto.getRandomValues(bytes) });
    assert.match(id, /^[a-f0-9]{32}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 20);
});
test('optional camera enumeration cannot hold scanner startup indefinitely', async () => {
  const { cameraMetadata, stopDecoderControls } = await helpers;
  const stream = { getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'camera-1' }) }] };
  const metadata = await cameraMetadata({ enumerateDevices: () => new Promise(() => {}) }, stream, 5);
  assert.equal(metadata.deviceId, 'camera-1');
  assert.deepEqual(metadata.devices, []);
  assert.doesNotThrow(() => stopDecoderControls({ stop: () => { throw new Error('already stopped'); } }));
  stopDecoderControls({ stop: () => Promise.reject(new Error('torch no longer available')) });
  await new Promise((resolve) => setImmediate(resolve));
});
test('camera errors distinguish permission, occupied camera and preview failures', async () => {
  const { cameraErrorMessage } = await helpers;
  assert.match(cameraErrorMessage(failure('NotAllowedError')), /相机权限被拒绝/);
  assert.match(cameraErrorMessage(failure('NotReadableError')), /占用/);
  assert.match(cameraErrorMessage(failure('Error'), 'preview'), /视频预览/);
});
