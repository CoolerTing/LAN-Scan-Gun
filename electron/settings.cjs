const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORTS = { port: 8787, setupPort: 8788 };

function validatePorts(ports) {
  if (!ports || ![ports.port, ports.setupPort].every((value) =>
    Number.isInteger(value) && value >= 1 && value <= 65535)) {
    throw new Error('端口号必须是 1–65535 之间的整数。');
  }
  if (ports.port === ports.setupPort) throw new Error('扫码服务与连接页不能使用同一个端口。');
  return { port: ports.port, setupPort: ports.setupPort };
}

function normalizeSettings(saved = {}) {
  let ports;
  try { ports = validatePorts({ port: saved.port ?? DEFAULT_PORTS.port, setupPort: saved.setupPort ?? DEFAULT_PORTS.setupPort }); }
  catch { ports = { ...DEFAULT_PORTS }; }
  return { enterAfterScan: saved.enterAfterScan !== false, sound: saved.sound !== false, ...ports };
}

function readSettings(filename) {
  try { return normalizeSettings(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
  catch { return normalizeSettings(); }
}

function writeSettings(filename, settings) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { DEFAULT_PORTS, validatePorts, normalizeSettings, readSettings, writeSettings };
