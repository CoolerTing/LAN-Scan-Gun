const path = require('node:path');
const { createScannerServer } = require('./server.cjs');
createScannerServer({
  root: path.join(__dirname, '..', 'dist'),
  dataDir: path.join(__dirname, '..', 'work', 'preview-certificate'),
  inject: async () => { throw new Error('预览模式不会向系统光标输入，请在 Windows 桌面端运行。'); }
}).then((server) => {
  console.log('Desktop preview: https://127.0.0.1:8787/index.html');
  console.log('Phone setup:', server.info().pairingUrl);
  process.on('SIGINT', async () => { await server.close(); process.exit(); });
  process.on('SIGTERM', async () => { await server.close(); process.exit(); });
}).catch((error) => { console.error(error); process.exitCode = 1; });
