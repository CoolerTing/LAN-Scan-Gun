# LAN Scan Gun

> Turn a phone into a wireless barcode scanner for Windows.
>
> 将手机变成 Windows 电脑的无线条码扫描枪。

LAN Scan Gun is a Windows desktop application plus a mobile web scanner. Scan a barcode or QR code with a phone, send the result over the local network, and type it into the currently focused Windows application. The app can optionally press `Enter` after each scan.

LAN Scan Gun 是一个“Windows 桌面端 + 手机网页扫码页”的局域网扫码工具。手机识别条码或二维码后，经局域网发送到电脑，并通过 Windows 输入接口写入当前获得焦点的软件。可选在每次扫码后自动追加回车。

## Features / 功能

- Scan barcodes and QR codes with a phone camera
- Send Unicode text over authenticated WSS
- Type into the active Windows application without using or modifying the clipboard
- Optional `Enter` after each scan
- Manual text sending from the phone
- Camera switching, pause/resume, torch control when supported
- Recent scan history on both desktop and mobile sides
- Delivery acknowledgements, ordered input, duplicate-request protection, and reconnect handling
- QR-code pairing with a short-lived local token
- Self-generated local CA certificate for HTTPS camera access
- Select the network interface when the computer has multiple network adapters
- Configure and persist the scanner and setup-page ports

- 手机摄像头扫描条码和二维码
- 通过带配对令牌校验的 WSS 局域网传输
- 不占用、不修改剪贴板，直接输入到当前激活的 Windows 软件
- 可选扫码后自动追加回车
- 手机端支持手动输入发送
- 支持切换镜头、暂停/继续扫码；兼容的设备支持手电筒
- 电脑端和手机端保留最近扫码记录
- 支持回执、顺序输入、重复请求保护和断线重连
- 使用二维码和临时配对令牌连接手机
- 自动生成本地 CA 证书，为手机摄像头提供 HTTPS 环境
- 多网卡电脑可选择手机实际访问的网络地址
- 扫码服务端口和连接页端口可配置并持久化

## How It Works / 工作方式

```text
Phone camera
    │  HTTPS + WebSocket
    ▼
LAN Scan Gun on Windows
    │  Windows SendInput
    ▼
Focused desktop application
```

电脑端默认启动两个服务：

| Service | Default port | Purpose |
| --- | ---: | --- |
| HTTPS / WSS scanner service | `8787` | Mobile scanner page and scan messages |
| HTTP setup page | `8788` | Certificate installation and pairing entry page |

The two ports must be different. Both can be changed from the desktop application.

两个端口必须不同，可在桌面程序中修改。扫码页面必须使用受信任的 HTTPS 地址，普通 HTTP 页面无法调用手机摄像头。

## Quick Start for Users / 用户快速开始

### 1. Start the Windows app / 启动 Windows 程序

Use a Windows installer, or run `Start-Windows.cmd` from the source package. The source-start method requires Node.js 22.12 or newer.

使用 Windows 安装包，或在源码目录双击 `Start-Windows.cmd`。从源码启动需要 Node.js 22.12 或更高版本。

### 2. Connect the phone and computer / 连接手机和电脑

1. Connect the phone and Windows computer to the same Wi-Fi or wired LAN.
2. In the desktop app, select the network address reachable from the phone.
3. Scan the QR code shown by the desktop app with Safari or Chrome.
4. On the setup page, compare the certificate fingerprint with the fingerprint shown on the desktop app.
5. Download and install the local CA certificate on the phone.

1. 让手机和 Windows 电脑连接到同一个 Wi-Fi 或有线局域网。
2. 在桌面程序中选择手机能够访问的网络地址。
3. 使用手机 Safari 或 Chrome 扫描桌面程序显示的二维码。
4. 在连接页核对手机显示的证书指纹与电脑端指纹是否一致。
5. 下载并安装电脑生成的本地 CA 证书。

### 3. Trust the certificate / 信任证书

- **iPhone / iPad:** Install the downloaded profile, then open `Settings > General > About > Certificate Trust Settings` and enable full trust for the certificate.
- **Android:** Search system settings for `Install certificate`, then install the downloaded CA certificate. The exact menu name varies by device manufacturer.

- **iPhone / iPad：**安装下载的描述文件，然后进入“设置 > 通用 > 关于本机 > 证书信任设置”，启用对该证书的完全信任。
- **Android：**在系统设置中搜索“安装证书”，选择下载的 CA 证书安装。不同品牌的菜单名称可能不同。

### 4. Scan / 开始扫码

1. Tap **Open Scanner** on the setup page.
2. Tap **Start camera** and allow camera access.
3. In the desktop app, choose whether to append `Enter`.
4. Focus the target Windows application and place the text cursor where the scan should be entered.
5. Scan a barcode or QR code.

1. 在连接页点击“打开扫码页”。
2. 点击“开启摄像头”，允许浏览器使用相机。
3. 在电脑端设置是否追加回车。
4. 切换到目标 Windows 软件，并将光标放到录入位置。
5. 对准条码或二维码扫码。

The mobile page reports success only after the Windows side acknowledges the input. A timeout or disconnect does not automatically resend the same scan, which avoids accidental duplicate entries.

手机端只有收到电脑输入回执后才显示成功。超时或断线时不会自动重复发送，以降低重复录入风险。

## Installation and Development / 安装与开发

### Requirements / 环境要求

- Windows 10/11 x64 for full functionality
- Node.js 22.12 or newer for source development
- Windows PowerShell 5.1, included with supported Windows versions
- A phone and computer on the same LAN

完整功能需要 Windows 10/11 x64；源码开发需要 Node.js 22.12 或更高版本。安装包运行时不需要 Node.js。

### Run from source / 从源码启动

```powershell
npm ci
npm test
npm start
```

`npm start` and `npm run dev` build the renderer first, then launch Electron.

`npm start` 和 `npm run dev` 会先构建前端资源，再启动 Electron。

On Windows, you can also double-click:

- `Start-Windows.cmd`: install dependencies when needed and start the app
- `Build-Windows.cmd`: install dependencies, run tests, and build the installer

在 Windows 上也可以直接双击：

- `Start-Windows.cmd`：必要时安装依赖并启动程序
- `Build-Windows.cmd`：安装依赖、运行测试并生成安装包

### Build the Windows installer / 打包 Windows 安装包

```powershell
npm run dist
```

The NSIS installer is written to `outputs/windows/`. Build on Windows for the most reliable result. The installer is not code-signed by default; sign it before public distribution.

NSIS 安装包输出到 `outputs/windows/`。建议在 Windows 上执行打包。默认未进行代码签名，公开分发前请自行签名并完成 Windows 实机验收。

### Preview the UI on macOS or Linux / 在 macOS 或 Linux 预览界面

```bash
npm run build
npm run preview
```

Open `https://127.0.0.1:8787/index.html`. Preview mode is for UI and service testing only; it cannot inject text into the operating-system cursor.

打开 `https://127.0.0.1:8787/index.html`。预览模式仅用于界面和服务测试，不能向操作系统当前光标输入文字。

## Port Configuration / 端口设置

The desktop app exposes two fields:

- **Scanner service (HTTPS/WSS):** defaults to `8787`
- **Setup page (HTTP):** defaults to `8788`

Enter two different integers from `1` to `65535`, then apply the change. The service switches immediately and remembers the values after restart.

桌面程序提供两个端口输入框：

- **扫码服务（HTTPS/WSS）：**默认 `8787`
- **连接页（HTTP）：**默认 `8788`

输入 `1` 到 `65535` 之间的两个不同整数并应用。服务会立即切换，重启后仍会使用保存的端口。

After changing ports:

1. Scan the updated QR code again on the phone.
2. Allow the new TCP ports through Windows Firewall on the private LAN.
3. Do not expose these ports to the public Internet or configure router port forwarding.

修改端口后，需要重新扫描更新后的二维码，并在 Windows 防火墙中允许专用网络使用新的 TCP 端口。不要将端口暴露到公网，也不要配置路由器端口映射。

If a new port is occupied, the application keeps the existing service running and reports the error. Changing only the setup-page port does not disconnect an already connected scanner.

如果新端口已被占用，程序会保留原服务并显示错误。只修改连接页端口时，已经在线的扫码设备不会断开。

## Security and Limitations / 安全与限制

- The QR code contains a pairing token. Treat it like a temporary password and do not share it with untrusted devices.
- The local CA certificate is generated for this computer and is stored in the Electron user-data directory. It is valid for 180 days and may be regenerated when the local IP addresses change.
- Only install and trust the certificate generated by your own computer. Remove it from the phone when it is no longer needed.
- The target Windows application must be focused while the scan is sent.
- A normal-permission app cannot inject input into an elevated administrator window. Run both applications at compatible privilege levels.
- Secure desktops, some games, and specialized input controls may reject simulated Unicode keyboard input.
- Scan values containing control characters are rejected; the maximum accepted value is 4096 characters. Leading and trailing spaces are preserved.
- “Input succeeded” means Windows accepted the keyboard event. It does not mean the target business application has saved the value.

- 二维码包含配对令牌，应视为临时密码，不要分享给不可信设备。
- 本地 CA 证书由当前电脑生成，保存在 Electron 用户数据目录中，有效期为 180 天；本机 IP 地址变化时也可能重新生成。
- 只安装和信任自己电脑生成的证书，不再使用时请从手机中删除。
- 发送扫码结果时，目标 Windows 软件必须处于激活状态。
- 普通权限程序不能向管理员权限窗口注入输入，请让两个程序使用兼容的权限级别。
- 安全桌面、部分游戏和特殊输入控件可能拒绝模拟的 Unicode 键盘事件。
- 含控制字符的扫码内容会被拒绝，最大长度为 4096 个字符；首尾空格会保留。
- “输入成功”只表示 Windows 接受了键盘事件，不代表目标业务软件已经保存数据。

## Troubleshooting / 常见问题

### The camera cannot start / 无法启动摄像头

1. Open the scanner in a standalone Safari or Chrome browser, not an in-app WebView.
2. Confirm the phone browser and the current HTTPS site both have camera permission.
3. Confirm the certificate is installed and fully trusted.
4. Close other applications that may be using the camera.
5. Refresh the mobile page after updating the desktop app.
6. Check the **Camera diagnostics** section at the bottom of the mobile page.

1. 使用独立的 Safari 或 Chrome 打开扫码页，不要使用其他应用内置的 WebView。
2. 检查手机系统和当前 HTTPS 站点是否都允许浏览器使用相机。
3. 确认本地证书已安装并被完全信任。
4. 关闭其他可能占用摄像头的应用。
5. 更新桌面程序后刷新手机页面。
6. 查看手机页面底部的“相机诊断”信息。

### The phone cannot connect / 手机无法连接

- Confirm both devices are on the same LAN.
- Confirm the selected desktop network address is reachable from the phone.
- Re-scan the desktop QR code after restarting the app or changing ports.
- Check Windows Firewall for the actual scanner and setup-page ports.
- Make sure the phone trusts the certificate fingerprint shown by the desktop app.

- 确认手机和电脑在同一个局域网。
- 确认电脑端选择的网络地址能被手机访问。
- 重启程序或修改端口后，重新扫描电脑端二维码。
- 检查 Windows 防火墙是否放行实际使用的扫码服务端口和连接页端口。
- 确认手机信任的证书指纹与电脑端显示的一致。

### Text is not entered / 没有输入到目标软件

- Focus the target window and place the cursor before scanning.
- Try a normal-permission text editor first.
- Do not hold `Ctrl`, `Alt`, `Shift`, or the Windows key while scanning.
- Check the desktop history and the mobile acknowledgement status.
- If the result timed out, verify the target text before scanning again; automatic resend is intentionally disabled.

- 扫码前先激活目标窗口并放置光标。
- 先用普通权限的文本编辑器测试。
- 扫码时不要按住 `Ctrl`、`Alt`、`Shift` 或 Windows 键。
- 检查电脑端历史记录和手机端回执状态。
- 如果发送超时，先核对目标软件内容，再手动重新扫码；程序不会自动重发。

## Project Structure / 项目结构

```text
electron/              Electron main process, LAN server, Windows input
src/renderer/          Desktop and mobile renderer source
tests/                 Node.js test suite
dist/                  Generated frontend build output
Start-Windows.cmd      Source startup helper for Windows
Build-Windows.cmd      Windows test and installer build helper
LICENSE                MIT license
```

`dist/`, `work/`, `node_modules/`, and generated Windows installers are build artifacts and are excluded from Git by default.

## Testing / 测试

```bash
npm test
```

The test suite covers settings validation, certificate and WebSocket behavior, pairing-token validation, scan deduplication, ordered input, acknowledgements, camera fallback behavior, and barcode decoding.

测试覆盖设置校验、证书与 WebSocket 行为、配对令牌校验、扫码去重、顺序输入、输入回执、相机参数降级和条码解码。

Automated tests do not replace final acceptance on a real Windows machine, phone camera, network, and target business application.

自动化测试不能替代真实 Windows 电脑、手机摄像头、局域网和目标业务软件上的最终验收。

## License / 许可证

This project is released under the [MIT License](LICENSE).

本项目采用 [MIT License](LICENSE) 开源。
