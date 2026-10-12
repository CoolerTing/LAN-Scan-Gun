const copy = {
  zh: {
    title: '连接 LAN Scan Gun',
    intro: '首次连接需要信任这台电脑的本地证书，手机摄像头才能使用。',
    download: '下载本地证书',
    verify: '先核对下方指纹与 PC 端显示一致。',
    iphone: 'iPhone：设置 → 已下载描述文件 → 安装；再到 通用 → 关于本机 → 证书信任设置，启用本证书完全信任。',
    android: 'Android：设置中搜索「安装证书」，选择下载的 CA 证书安装。不同品牌的菜单名称可能不同。',
    open: '打开扫码页',
    note: '仅信任你自己的电脑，用完可在系统设置删除本证书。请保持两台设备在同一局域网。',
    rescan: '请重新扫描 PC 端连接二维码'
  },
  en: {
    title: 'Connect LAN Scan Gun',
    intro: 'Trust this computer\'s local certificate before using the phone camera.',
    download: 'Download local certificate',
    verify: 'Verify that the fingerprint below matches the one shown on the PC.',
    iphone: 'iPhone: install the downloaded profile, then enable full trust under Settings > General > About > Certificate Trust Settings.',
    android: 'Android: search Settings for "install certificate" and install the downloaded CA certificate. Menu names vary by device.',
    open: 'Open scanner',
    note: 'Only trust your own computer. Remove this certificate from system settings when you are done, and keep both devices on the same LAN.',
    rescan: 'Scan the PC connection QR code again'
  }
};

function renderSetupPage(language, fingerprint, targetUrl) {
  const text = copy[language] || copy.en;
  const target = new URL(targetUrl);
  target.hash = '';
  target.searchParams.set('lang', language);
  return `<!doctype html>
    <html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${text.title}</title><style>
    *{box-sizing:border-box}body{font:15px system-ui;margin:0;color:#20252a;background:#f5f6f7}
    main{max-width:560px;margin:auto;padding:32px 22px}h1{font-size:26px}p,li{line-height:1.8}
    a{display:block;padding:14px;margin:20px 0;background:#087e6b;color:white;text-align:center;text-decoration:none;border-radius:6px}
    code{display:block;font-size:11px;overflow-wrap:anywhere;padding:12px;background:#e5e9eb}
    </style><main><h1>${text.title}</h1><p>${text.intro}</p>
    <a href="/certificate.cer">${text.download}</a>
    <ol><li>${text.verify}</li><li>${text.iphone}</li><li>${text.android}</li></ol>
    <code>${fingerprint}</code><a id="continue">${text.open}</a><p>${text.note}</p>
    <script>const token=new URLSearchParams(location.hash.slice(1)).get('token');const link=document.querySelector('#continue');
    if(token){link.href=${JSON.stringify(target.href)}+'#token='+encodeURIComponent(token)}
    else{link.textContent=${JSON.stringify(text.rescan)}}</script></main></html>`;
}

module.exports = { renderSetupPage };
