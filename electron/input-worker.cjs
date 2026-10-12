const { spawn } = require('node:child_process');
const readline = require('node:readline');

class InputWorker {
  constructor({ command, args = [], label, timeout = 15000, spawnWorker = spawn }) {
    Object.assign(this, { command, args, label, timeout, spawnWorker });
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }

  start() {
    const worker = this.spawnWorker(this.command, this.args, {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    this.worker = worker;
    let diagnostic = '';
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      if (this.worker === worker) this.worker = null;
      for (const [id, waiting] of this.pending) {
        if (waiting.worker !== worker) continue;
        clearTimeout(waiting.timer);
        this.pending.delete(id);
        waiting.reject(error);
      }
    };
    worker.failInput = fail;
    worker.stderr.on('data', (data) => { diagnostic = (diagnostic + data).slice(-1500); });
    readline.createInterface({ input: worker.stdout }).on('line', (line) => {
      let result;
      try { result = JSON.parse(line); } catch { return; }
      const waiting = this.pending.get(result.id);
      if (!waiting || waiting.worker !== worker) return;
      clearTimeout(waiting.timer);
      this.pending.delete(result.id);
      if (result.ok) waiting.resolve(result);
      else waiting.reject(new Error(result.error || `${this.label} 拒绝输入，请检查目标窗口权限。`));
    });
    worker.on('error', fail);
    worker.stdin.on('error', fail);
    worker.on('exit', () => fail(new Error(diagnostic || `${this.label} 输入进程已退出。`)));
    return worker;
  }

  request(payload) {
    if (this.closed) return Promise.reject(new Error(`${this.label} 输入服务已关闭。`));
    let worker;
    try { worker = this.worker || this.start(); }
    catch (error) { return Promise.reject(error); }
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.failInput(new Error(`${this.label} 输入超时；请检查目标窗口，不要立即重复发送。`));
        worker.kill();
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer, worker });
      worker.stdin.write(JSON.stringify({ ...payload, id }) + '\n', (error) => {
        if (!error) return;
        worker.failInput(error);
        worker.kill();
      });
    });
  }

  close() {
    this.closed = true;
    const worker = this.worker;
    worker?.failInput(new Error(`${this.label} 输入服务已关闭。`));
    worker?.kill();
  }
}

module.exports = { InputWorker };
