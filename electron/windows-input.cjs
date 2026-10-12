const path = require('node:path');
const { InputWorker } = require('./input-worker.cjs');

class WindowsInput extends InputWorker {
  constructor(options = {}) {
    const script = path.join(__dirname, 'input.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    super({
      ...options, label: 'Windows', command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
    });
  }

  async send(value, enterAfterScan) {
    if (process.platform !== 'win32') throw new Error('当前是非 Windows 环境，不能向系统光标输入。');
    await this.request({
      text: Buffer.from(value, 'utf8').toString('base64'), enter: enterAfterScan
    });
  }
}

module.exports = { WindowsInput };
