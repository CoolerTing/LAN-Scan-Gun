const path = require('node:path');
const { InputWorker } = require('./input-worker.cjs');

class MacOSInput extends InputWorker {
  constructor(options = {}) {
    const executable = path.join(__dirname, 'bin', 'input-macos')
      .replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    super({ ...options, label: 'macOS', command: executable });
  }

  async send(value, enterAfterScan) {
    if (process.platform !== 'darwin') throw new Error('macOS 输入服务只能在 Mac 上运行。');
    await this.request({
      command: 'type', text: Buffer.from(value, 'utf8').toString('base64'), enter: enterAfterScan
    });
  }

  async getStatus() {
    try {
      const result = await this.request({ command: 'status' });
      return { supported: true, trusted: result.trusted };
    } catch (error) {
      return { supported: true, trusted: false, error: `macOS 输入服务不可用，请重新构建或安装程序：${error.message}` };
    }
  }

  async requestPermission() {
    const result = await this.request({ command: 'permission' });
    return { supported: true, trusted: result.trusted };
  }
}

module.exports = { MacOSInput };
