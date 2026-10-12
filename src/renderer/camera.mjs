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

export function cameraErrorMessage(error, phase = 'capture') {
  const name = error?.name || 'Error';
  const messages = {
    NotAllowedError: '相机权限被拒绝。请检查平板系统的浏览器相机权限、本站相机权限，以及 HTTPS 证书信任。若从微信或其他应用打开，请改用 Chrome 等独立浏览器。',
    PermissionDeniedError: '相机权限被拒绝，请检查系统和浏览器的相机权限。',
    SecurityError: '浏览器安全策略阻止相机。请使用受信任的 HTTPS，并在独立浏览器打开。',
    NotReadableError: '相机无法读取，可能被其他应用占用或驱动异常。请关闭其他相机应用，重新开启浏览器后再试。',
    TrackStartError: '相机无法启动，请关闭其他相机应用后重试。',
    NotFoundError: '没有找到可用镜头，请检查平板摄像头是否可用。',
    DevicesNotFoundError: '没有找到可用镜头，请检查平板摄像头是否可用。',
    OverconstrainedError: '当前镜头参数不受支持，基础参数也未能打开相机。',
    ConstraintNotSatisfiedError: '当前镜头参数不受支持，基础参数也未能打开相机。',
    NotSupportedError: '当前浏览器不支持此相机接口，请更新或更换独立浏览器。'
  };
  const detail = messages[name] || (phase === 'preview'
    ? '相机已获取，但视频预览或扫码初始化失败，请更新或更换浏览器。'
    : '相机启动失败，请查看下方相机诊断。');
  return `${detail} [${name}]`;
}

export function createRequestId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
