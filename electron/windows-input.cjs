const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

class WindowsInput {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }

  start() {
    const script = path.join(__dirname, 'input.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    this.worker = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const worker = this.worker;
    let diagnostic = '';
    worker.stderr.on('data', (data) => { diagnostic = (diagnostic + data).slice(-1500); });
    readline.createInterface({ input: worker.stdout }).on('line', (line) => {
      let result;
      try { result = JSON.parse(line); } catch { return; }
      const waiting = this.pending.get(result.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(result.id);
      if (result.ok) waiting.resolve();
      else waiting.reject(new Error(result.error || 'Windows 拒绝输入，请检查目标窗口权限。'));
    });
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      if (this.worker === worker) this.worker = null;
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(error);
      }
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', () => fail(new Error(diagnostic || 'Windows 输入进程已退出。')));
  }

  async send(value, enterAfterScan) {
    if (this.closed) throw new Error('Windows 输入服务已关闭。');
    if (process.platform !== 'win32') throw new Error('当前是非 Windows 环境，不能向系统光标输入。');
    if (!this.worker) this.start();
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Windows 输入超时；请检查目标窗口，不要立即重复发送。'));
        this.worker?.kill();
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      const payload = { id, text: Buffer.from(value, 'utf8').toString('base64'), enter: enterAfterScan };
      this.worker.stdin.write(JSON.stringify(payload) + '\n', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() { this.closed = true; this.worker?.kill(); }
}

module.exports = { WindowsInput };
