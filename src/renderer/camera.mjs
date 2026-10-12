import { createI18n } from './i18n.mjs';

const retryableErrors = new Set([
  'OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotReadableError',
  'TrackStartError', 'NotFoundError', 'DevicesNotFoundError', 'NotSupportedError', 'TypeError'
]);

export async function openCameraStream(mediaDevices, deviceId, onAttempt = () => {}) {
  const selected = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
  const attempts = [
    { audio: false, video: { ...selected, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { audio: false, video: selected },
    { audio: false, video: true }
  ];
  for (let index = 0; index < attempts.length; index++) {
    onAttempt(index + 1);
    try {
      return await mediaDevices.getUserMedia(attempts[index]);
    } catch (error) {
      if (!retryableErrors.has(error.name) || index === attempts.length - 1) throw error;
    }
  }
}

export function stopStream(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

export function stopDecoderControls(controls) {
  try { Promise.resolve(controls?.stop()).catch(() => {}); } catch {}
}

export async function cameraMetadata(mediaDevices, stream, timeoutMs = 1500) {
  let devices = [];
  let torch = false;
  const track = stream?.getVideoTracks()[0];
  let deviceId = '';
  // Some Android browsers expose these methods but throw when they are called.
  try { deviceId = track?.getSettings?.().deviceId || ''; } catch {}
  try { torch = Boolean(track?.getCapabilities?.().torch); } catch {}
  let timer;
  try {
    const enumeration = Promise.resolve().then(() => mediaDevices.enumerateDevices());
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); });
    devices = (await Promise.race([enumeration, timeout])).filter((item) => item.kind === 'videoinput');
  } catch {} finally { clearTimeout(timer); }
  return { devices, torch, deviceId };
}

export function cameraErrorMessage(error, phase = 'capture', language = 'zh') {
  const { t } = createI18n(language);
  const name = error?.name || 'Error';
  const messages = {
    NotAllowedError: 'cameraPermissionDenied',
    PermissionDeniedError: 'cameraPermission',
    SecurityError: 'cameraSecurity',
    NotReadableError: 'cameraOccupied',
    TrackStartError: 'cameraStartFailed',
    NotFoundError: 'cameraMissing',
    DevicesNotFoundError: 'cameraMissing',
    OverconstrainedError: 'cameraConstraints',
    ConstraintNotSatisfiedError: 'cameraConstraints',
    NotSupportedError: 'cameraApiUnsupported'
  };
  const detail = t(messages[name] || (phase === 'preview' ? 'cameraPreviewFailed' : 'cameraFailed'));
  return `${detail} [${name}]`;
}

export function createRequestId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
