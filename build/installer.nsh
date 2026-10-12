; The default electron-builder check scans every process below $INSTDIR.
; That also matches the uninstaller while the uninstaller is running.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    StrCpy $R0 1
    ${if} $IsPowerShellAvailable == 0
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "$$target = [IO.Path]::GetFullPath('$INSTDIR\${APP_EXECUTABLE_FILENAME}'); $$found = Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $pid -and $$_.ExecutablePath -and ([IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target) }; if ($$found) { exit 0 } else { exit 1 }"`
      Pop $R0
    ${else}
      nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
      Pop $R0
    ${endIf}

    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
      ${else}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK closeApp
        Quit
      ${endIf}

      closeApp:
      DetailPrint "$(appClosing)"
      StrCpy $R0 1
      ${if} $IsPowerShellAvailable == 0
        nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -Command "$$target = [IO.Path]::GetFullPath('$INSTDIR\${APP_EXECUTABLE_FILENAME}'); Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -ne $pid -and $$_.ExecutablePath -and ([IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
        Pop $R0
      ${else}
        nsExec::Exec `"$CmdPath" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $pid"`
        Pop $R0
      ${endIf}
      Sleep 500
    ${endIf}
  ${endIf}
!macroend
