$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScannerInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public MOUSEINPUT mi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION data; }
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    static INPUT Key(ushort vk, ushort scan, uint flags) {
        var item = new INPUT();
        item.type = 1;
        item.data.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
        return item;
    }
    public static void Type(string text, bool enter) {
        var target = GetForegroundWindow();
        if (target == IntPtr.Zero) throw new Exception("No active input window.");
        int[] modifiers = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
        foreach (int key in modifiers)
            if ((GetAsyncKeyState(key) & 0x8000) != 0)
                throw new Exception("Release modifier keys and retry.");
        var keys = new INPUT[text.Length * 2 + (enter ? 2 : 0)];
        int index = 0;
        foreach (char ch in text) {
            keys[index++] = Key(0, ch, 0x0004);
            keys[index++] = Key(0, ch, 0x0004 | 0x0002);
        }
        if (enter) {
            keys[index++] = Key(0x0D, 0, 0);
            keys[index++] = Key(0x0D, 0, 0x0002);
        }
        if (GetForegroundWindow() != target) throw new Exception("Active window changed.");
        uint sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT)));
        if (sent != keys.Length)
            throw new Exception("Input blocked or partially accepted. Check target permissions before retry.");
    }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
    $id = ""
    try {
        $request = $line | ConvertFrom-Json
        $id = [string]$request.id
        $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($request.text))
        [ScannerInput]::Type($text, [bool]$request.enter)
        [Console]::WriteLine((@{ id = $id; ok = $true } | ConvertTo-Json -Compress))
    } catch {
        [Console]::WriteLine((@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
    }
}
