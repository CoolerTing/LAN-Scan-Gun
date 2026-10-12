import ApplicationServices
import Carbon
import Foundation

struct InputError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func isTrusted() -> Bool {
    AXIsProcessTrusted() && CGPreflightPostEventAccess()
}

func focusedApplication() throws -> pid_t {
    var application: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(
        AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &application
    )
    guard result == .success, let application = application else {
        throw InputError(message: "没有可录入的激活窗口，请先将光标放到目标软件。")
    }
    var pid: pid_t = 0
    guard AXUIElementGetPid(application as! AXUIElement, &pid) == .success, pid > 0 else {
        throw InputError(message: "无法确定目标窗口，请重新激活目标软件。")
    }
    return pid
}

func ensureSafeTarget(_ pid: pid_t) throws {
    guard isTrusted() else {
        throw InputError(message: "请在 macOS 系统设置 > 隐私与安全性 > 辅助功能中授权 LAN Scan Gun（源码运行时可能显示 Electron 或 input-macos），然后重启程序。")
    }
    guard !IsSecureEventInputEnabled() else {
        throw InputError(message: "系统处于安全输入模式，请退出密码输入框或关闭安全输入后重试。")
    }
    let modifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand, .maskSecondaryFn]
    guard CGEventSource.flagsState(.combinedSessionState).intersection(modifiers).isEmpty else {
        throw InputError(message: "扫码时请松开 Shift、Control、Option、Command 和 Fn 键。")
    }
    guard try focusedApplication() == pid else {
        throw InputError(message: "激活窗口已改变，已停止输入；请核对目标内容后再手动重试。")
    }
}

func keyPair(_ units: [UniChar], key: CGKeyCode = 0) throws -> [CGEvent] {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false) else {
        throw InputError(message: "无法创建 macOS 键盘事件。")
    }
    for event in [down, up] {
        event.flags = []
        if !units.isEmpty {
            units.withUnsafeBufferPointer {
                event.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress!)
            }
        }
    }
    return [down, up]
}

func typeText(_ text: String, enter: Bool) throws {
    guard !text.isEmpty, text.utf16.count <= 4096,
          !text.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
        throw InputError(message: "内容为空、过长或含控制字符，已拒绝输入。")
    }
    guard isTrusted() else {
        throw InputError(message: "尚未获得辅助功能权限，请在桌面端输入设置中打开 macOS 授权设置。")
    }
    let pid = try focusedApplication()
    try ensureSafeTarget(pid)
    var pairs: [[CGEvent]] = []
    var chunk: [UniChar] = []
    // Keep surrogate pairs intact and bound the text carried by each keyboard event.
    for scalar in text.unicodeScalars {
        let units = Array(String(scalar).utf16)
        if chunk.count + units.count > 20 {
            pairs.append(try keyPair(chunk))
            chunk.removeAll(keepingCapacity: true)
        }
        chunk.append(contentsOf: units)
    }
    if !chunk.isEmpty { pairs.append(try keyPair(chunk)) }
    if enter { pairs.append(try keyPair([], key: 36)) }
    for pair in pairs {
        try ensureSafeTarget(pid)
        for event in pair { event.postToPid(pid) }
        // Allow the target's event loop to consume each pair without flooding it.
        usleep(5000)
    }
}

while let line = readLine() {
    var id = ""
    var response: [String: Any]
    do {
        guard let data = line.data(using: .utf8),
              let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let requestID = request["id"] as? String else {
            throw InputError(message: "无效输入请求。")
        }
        id = requestID
        switch request["command"] as? String {
        case "status":
            response = ["id": id, "ok": true, "trusted": isTrusted()]
        case "permission":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            _ = CGRequestPostEventAccess()
            response = ["id": id, "ok": true, "trusted": isTrusted()]
        case "type":
            guard let encoded = request["text"] as? String,
                  let data = Data(base64Encoded: encoded),
                  let text = String(data: data, encoding: .utf8),
                  let enter = request["enter"] as? Bool else {
                throw InputError(message: "无效文本输入请求。")
            }
            try typeText(text, enter: enter)
            response = ["id": id, "ok": true]
        default:
            throw InputError(message: "未知输入命令。")
        }
    } catch {
        response = ["id": id, "ok": false, "error": error.localizedDescription]
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
}
