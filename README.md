# LAN Scan Gun

[简体中文](README.zh-CN.md)

> Turn a phone into a wireless barcode scanner for Windows.

LAN Scan Gun is a Windows desktop application plus a mobile web scanner. Scan a barcode or QR code with a phone, send the result over the local network, and type it into the currently focused Windows application. The app can optionally press `Enter` after each scan.

## Features

- Scan barcodes and QR codes with a phone camera
- Send Unicode text over authenticated WSS
- Type into the active Windows application without using or modifying the clipboard
- Optional `Enter` after each scan
- Manual text sending from the phone
- Camera switching, pause/resume, and torch control when supported
- Recent scan history on both desktop and mobile sides
- Delivery acknowledgements, ordered input, duplicate-request protection, and reconnect handling
- QR-code pairing with a short-lived local token
- Self-generated local CA certificate for HTTPS camera access
- Network-interface selection for computers with multiple adapters
- Configurable and persistent scanner/setup-page ports

## How It Works

```text
Phone camera
    |  HTTPS + WebSocket
    v
LAN Scan Gun on Windows
    |  Windows SendInput
    v
Focused desktop application
```

The desktop app starts two services by default:

| Service | Default port | Purpose |
| --- | ---: | --- |
| HTTPS / WSS scanner service | `8787` | Mobile scanner page and scan messages |
| HTTP setup page | `8788` | Certificate installation and pairing entry page |

The two ports must be different. Both can be changed from the desktop application. The scanner page must use a trusted HTTPS address because normal HTTP LAN pages cannot access the phone camera.

## Quick Start for Users

### 1. Start the Windows App

Use a Windows installer, or run `Start-Windows.cmd` from the source package. The source-start method requires Node.js 22.12 or newer.

### 2. Connect the Phone and Computer

1. Connect the phone and Windows computer to the same Wi-Fi or wired LAN.
2. In the desktop app, select the network address reachable from the phone.
3. Scan the QR code shown by the desktop app with Safari or Chrome.
4. On the setup page, compare the certificate fingerprint with the fingerprint shown on the desktop app.
5. Download and install the local CA certificate on the phone.

### 3. Trust the Certificate

- **iPhone / iPad:** Install the downloaded profile, then open `Settings > General > About > Certificate Trust Settings` and enable full trust for the certificate.
- **Android:** Search system settings for `Install certificate`, then install the downloaded CA certificate. The exact menu name varies by device manufacturer.

### 4. Scan

1. Tap **Open Scanner** on the setup page.
2. Tap **Start camera** and allow camera access.
3. In the desktop app, choose whether to append `Enter`.
4. Focus the target Windows application and place the text cursor where the scan should be entered.
5. Scan a barcode or QR code.

The mobile page reports success only after the Windows side acknowledges the input. A timeout or disconnect does not automatically resend the same scan, which avoids accidental duplicate entries.

## Installation and Development

### Requirements

- Windows 10/11 x64 for full functionality
- Node.js 22.12 or newer for source development
- Windows PowerShell 5.1, included with supported Windows versions
- A phone and computer on the same LAN

An installed app does not require Node.js.

### Run from Source

```powershell
npm ci
npm test
npm start
```

`npm start` and `npm run dev` build the renderer first, then launch Electron.

On Windows, you can also double-click:

- `Start-Windows.cmd`: install dependencies when needed and start the app
- `Build-Windows.cmd`: install dependencies, run tests, and build the installer

### Build the Windows Installer

```powershell
npm run dist
```

The NSIS installer is written to `outputs/windows/`. Build on Windows for the most reliable result. The installer is not code-signed by default; sign it before public distribution.

### Preview the UI on macOS or Linux

```bash
npm run build
npm run preview
```

Open `https://127.0.0.1:8787/index.html`. Preview mode is for UI and service testing only; it cannot inject text into the operating-system cursor.

## Port Configuration

The desktop app exposes two fields:

- **Scanner service (HTTPS/WSS):** defaults to `8787`
- **Setup page (HTTP):** defaults to `8788`

Enter two different integers from `1` to `65535`, then apply the change. The service switches immediately and remembers the values after restart.

After changing ports:

1. Scan the updated QR code again on the phone.
2. Allow the new TCP ports through Windows Firewall on the private LAN.
3. Do not expose these ports to the public Internet or configure router port forwarding.

If a new port is occupied, the application keeps the existing service running and reports the error. Changing only the setup-page port does not disconnect an already connected scanner.

## Security and Limitations

- The QR code contains a pairing token. Treat it like a temporary password and do not share it with untrusted devices.
- The local CA certificate is generated for this computer and is stored in the Electron user-data directory. It is valid for 180 days and may be regenerated when the local IP addresses change.
- Only install and trust the certificate generated by your own computer. Remove it from the phone when it is no longer needed.
- The target Windows application must be focused while the scan is sent.
- A normal-permission app cannot inject input into an elevated administrator window. Run both applications at compatible privilege levels.
- Secure desktops, some games, and specialized input controls may reject simulated Unicode keyboard input.
- Scan values containing control characters are rejected; the maximum accepted value is 4096 characters. Leading and trailing spaces are preserved.
- “Input succeeded” means Windows accepted the keyboard event. It does not mean the target business application has saved the value.

## Troubleshooting

### The Camera Cannot Start

1. Open the scanner in a standalone Safari or Chrome browser, not an in-app WebView.
2. Confirm the phone browser and the current HTTPS site both have camera permission.
3. Confirm the certificate is installed and fully trusted.
4. Close other applications that may be using the camera.
5. Refresh the mobile page after updating the desktop app.
6. Check the **Camera diagnostics** section at the bottom of the mobile page.

### The Phone Cannot Connect

- Confirm both devices are on the same LAN.
- Confirm the selected desktop network address is reachable from the phone.
- Re-scan the desktop QR code after restarting the app or changing ports.
- Check Windows Firewall for the actual scanner and setup-page ports.
- Make sure the phone trusts the certificate fingerprint shown by the desktop app.

### Text Is Not Entered

- Focus the target window and place the cursor before scanning.
- Try a normal-permission text editor first.
- Do not hold `Ctrl`, `Alt`, `Shift`, or the Windows key while scanning.
- Check the desktop history and the mobile acknowledgement status.
- If the result timed out, verify the target text before scanning again; automatic resend is intentionally disabled.

## Project Structure

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

## Testing

```bash
npm test
```

The test suite covers settings validation, certificate and WebSocket behavior, pairing-token validation, scan deduplication, ordered input, acknowledgements, camera fallback behavior, and barcode decoding.

Automated tests do not replace final acceptance on a real Windows machine, phone camera, network, and target business application.

## License

This project is released under the [MIT License](LICENSE).
