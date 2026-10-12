const { WindowsInput } = require('./windows-input.cjs');
const { MacOSInput } = require('./macos-input.cjs');

function createInput(platform = process.platform) {
  if (platform === 'win32') return new WindowsInput();
  if (platform === 'darwin') return new MacOSInput();
  return {
    getStatus: async () => ({ supported: false, trusted: false }),
    send: async () => { throw new Error('系统光标输入仅支持 Windows 和 macOS。'); },
    close() {}
  };
}

module.exports = { createInput };
