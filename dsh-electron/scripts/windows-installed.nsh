!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var eduworkSourceRoot
!ifdef BUILD_UNINSTALLER
  Var eduworkDeleteData
!else
  Var eduworkVerifyUpdate
!endif

!macro eduworkTools
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\eduwork"
  File /oname=node.exe "${EDUWORK_INSTALLER_NODE}"
  File /oname=installed-files.cjs "${EDUWORK_INSTALLER_WORKER}"
!macroend

!macro eduworkCheckResult MESSAGE
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}$\r$\n$R1" /SD IDOK
    !ifndef BUILD_UNINSTALLER
      Call dshCleanupDirectories
    !endif
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  !macro InstallerPublishStage STAGE
    !if ${STAGE} == 2
      Call eduworkRecordStartupAttempt
    !else if ${STAGE} == 3
      Call eduworkVerifyUpdatedStartup
    !endif
  !macroend
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !define DSH_INSTALLER_LOG_DIR "$LOCALAPPDATA\EduWork\installer-logs\${EDUWORK_DISTRIBUTION}"
    !include "${EDUWORK_DIRECTORY_INCLUDE}"
    Function eduworkRecordStartupAttempt
      ${If} $eduworkVerifyUpdate != "1"
        Return
      ${EndIf}
      ClearErrors
      CreateDirectory "$dshDirectoryLogDirectory"
      FileOpen $R9 "$dshDirectoryLogDirectory\startup-recovery.txt" w
      ${IfNot} ${Errors}
        FileWriteUTF16LE /BOM $R9 "正在安装并确认新版启动。$\r$\n安装目录：$dshFinalDirectory$\r$\n旧版保留目录：$dshOldDirectory$\r$\n新版暂存目录：$dshNewDirectory$\r$\n"
        FileClose $R9
        ${IfNot} ${Errors}
          Return
        ${EndIf}
      ${EndIf}
      Call dshCleanupDirectories
      MessageBox MB_OK|MB_ICONSTOP "无法保存更新恢复记录，安装已停止。"
      SetErrorLevel 2
      Quit
    FunctionEnd
    Function eduworkVerifyUpdatedStartup
      ${If} $eduworkVerifyUpdate != "1"
        Return
      ${EndIf}
      ${If} $dshOldMoved != "1"
        Call dshCleanupDirectories
        MessageBox MB_OK|MB_ICONSTOP "无法保留上一版程序，更新已停止。"
        SetErrorLevel 2
        Quit
      ${EndIf}
      StrCpy $dshRecoveryStopped "1"
      !insertmacro eduworkTools
      nsExec::ExecToStack /TIMEOUT=180000 '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action verify-startup --distribution "${EDUWORK_DISTRIBUTION}" --program-root "$dshFinalDirectory"'
      Pop $R0
      Pop $R1
      ${If} $R0 == "0"
        SetOutPath "$dshFinalDirectory"
        Return
      ${EndIf}
      StrCpy $R2 "更新未完成，保留了程序目录。请先关闭新版及后台任务，再按恢复记录核对旧版位置。"
      ${If} $R0 == "10"
        SetOutPath $PLUGINSDIR
        # The candidate has run. Park it instead of recursively deleting its files.
        !insertmacro dshDirectoryOperation "$dshFinalDirectory" "$dshNewDirectory" $dshDirectoryError "park-unhealthy"
        ${If} $dshDirectoryError == 0
          !insertmacro dshDirectoryOperation "$dshOldDirectory" "$dshFinalDirectory" $dshRestoreError "restore"
          ${If} $dshRestoreError == 0
            StrCpy $R2 "新版未完成启动，已恢复上一版程序。请从开始菜单重新打开 EduWork。"
          ${EndIf}
        ${EndIf}
      ${EndIf}
      ClearErrors
      FileOpen $R9 "$dshDirectoryLogDirectory\startup-recovery.txt" a
      ${IfNot} ${Errors}
        FileSeek $R9 0 END
        FileWriteUTF16LE $R9 "$R2$\r$\n$R1$\r$\n目录切换错误：$dshDirectoryError / $dshRestoreError$\r$\n"
        FileClose $R9
      ${EndIf}
      MessageBox MB_OK|MB_ICONSTOP "$R2$\r$\n个人数据仍在原数据目录。$\r$\n恢复记录：$dshDirectoryLogDirectory\startup-recovery.txt"
      SetErrorLevel 2
      Quit
    FunctionEnd
    Function eduworkCheckTarget
      !insertmacro eduworkTools
      nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action check-program --distribution "${EDUWORK_DISTRIBUTION}" --program-root "$INSTDIR"'
      !insertmacro eduworkCheckResult "安装目录不可用。请重新运行安装程序并选择另一个程序目录；旧便携版不要覆盖，安装后再迁入数据。"
    FunctionEnd
    Function eduworkBeforeFiles
      Call instFilesPre
      Call eduworkCheckTarget
    FunctionEnd
  !endif
!macroend

!macro customInstallerDirectoryFailed
  CreateDirectory "$dshDirectoryLogDirectory"
  CopyFiles /SILENT "$PLUGINSDIR\directory-operations.log" "$dshDirectoryLogDirectory\directory-operations.log"
  MessageBox MB_OK|MB_ICONSTOP "程序目录切换失败，请保留现场，不要删除旧目录。$\r$\n安装目录：$dshFinalDirectory$\r$\n保留目录：$dshOldDirectory$\r$\n恢复错误：$dshRestoreError$\r$\n日志：$dshDirectoryLogDirectory" /SD IDOK
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE eduworkBeforeFiles
!macroend

!macro customInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/MIGRATE_FROM=" $eduworkSourceRoot
  ${If} ${Errors}
    StrCpy $eduworkSourceRoot ""
  ${EndIf}
  ${If} $eduworkSourceRoot != ""
    IfFileExists "$INSTDIR\data\*.*" 0 +2
      StrCpy $INSTDIR "$INSTDIR-installed"
  ${EndIf}
  ${If} ${Silent}
    Call eduworkCheckTarget
  ${EndIf}
!macroend

; Never taskkill: the application must finish its tasks and close the Host itself.
!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    StrCpy $eduworkSourceRoot ""
  !endif
  !insertmacro eduworkTools
  StrCpy $R2 ""
  ${If} ${isUpdated}
    StrCpy $R2 "--wait"
  ${EndIf}
  !ifdef BUILD_UNINSTALLER
    StrCpy $R2 "$R2 --uninstall"
  !endif
  ${If} $eduworkSourceRoot == ""
    nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action check-running --program-root "$INSTDIR" $R2'
  ${Else}
    nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action check-running --program-root "$INSTDIR" --source-root "$eduworkSourceRoot" $R2'
  ${EndIf}
  !insertmacro eduworkCheckResult "请先正常退出 EduWork 和它的后台任务，再重新运行安装或卸载程序。个人数据已保留。"
  nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action check-program --distribution "${EDUWORK_DISTRIBUTION}" --program-root "$INSTDIR" $R2'
  !insertmacro eduworkCheckResult "程序目录含其他文件或链接，已停止操作。请先将个人文件和工作区移出程序目录。"
  !ifndef BUILD_UNINSTALLER
    ${If} ${isUpdated}
    ${AndIf} ${isForceRun}
    ${AndIf} ${Silent}
    ${AndIf} $eduworkSourceRoot == ""
      System::Call 'shell32::IsUserAnAdmin() i.r0'
      ${If} $0 != 0
      ${OrIf} $installMode != "CurrentUser"
        Call dshCleanupDirectories
        MessageBox MB_OK|MB_ICONSTOP "请用当前安装用户的普通权限启动 EduWork 后再更新。"
        SetErrorLevel 2
        Quit
      ${EndIf}
      ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $R0 != $INSTDIR
      ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        Call dshCleanupDirectories
        MessageBox MB_OK|MB_ICONSTOP "无法确认当前安装位置，更新已停止。请从已安装的 EduWork 检查更新。"
        SetErrorLevel 2
        Quit
      ${EndIf}
      StrCpy $eduworkVerifyUpdate "1"
    ${EndIf}
  !endif
!macroend

!macro customInstall
  # COM uses the exact executable even when the installation path contains spaces.
  WriteRegStr HKCU "Software\Classes\CLSID\${EDUWORK_TOAST_CLSID}\LocalServer32" "ServerExecutable" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !insertmacro dshFinishDirectories
  ${If} $eduworkVerifyUpdate == "1"
    ClearErrors
    FileOpen $R9 "$dshDirectoryLogDirectory\startup-recovery.txt" a
    ${IfNot} ${Errors}
      FileSeek $R9 0 END
      FileWriteUTF16LE $R9 "新版启动确认通过，更新完成。$\r$\n"
      FileClose $R9
    ${EndIf}
    !insertmacro quitSuccess
  ${EndIf}
  ${If} $eduworkSourceRoot != ""
    nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action remember-source --distribution "${EDUWORK_DISTRIBUTION}" --program-root "$INSTDIR" --source-root "$eduworkSourceRoot"'
    !insertmacro eduworkCheckResult "程序已安装，旧目录尚未迁入；旧数据已保留。请先解决数据目录冲突，再迁移或使用“导入历史数据”。"
  ${EndIf}
!macroend

!macro customUnInit
  StrCpy $eduworkDeleteData "0"
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONQUESTION "是否同时删除此用户的 ${EDUWORK_DISTRIBUTION} 个人数据？$\r$\n$\r$\n选“否”将保留会话、附件、记忆、设置和凭据，重新安装后可继续使用。$\r$\n选“是”只清除此发行版的个人数据；外部工作区和旧便携版副本仍保留。" IDNO eduworkKeepData
    StrCpy $eduworkDeleteData "1"
    eduworkKeepData:
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} $eduworkDeleteData == "1"
  ${AndIfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action remove-data --distribution "${EDUWORK_DISTRIBUTION}"'
    !insertmacro eduworkCheckResult "数据目录仍在使用或归属无法确认，已停止卸载并保留数据。"
  ${EndIf}
  ${IfNot} ${isUpdated}
    ReadRegStr $R0 HKCU "Software\Classes\CLSID\${EDUWORK_TOAST_CLSID}\LocalServer32" "ServerExecutable"
    ${If} $R0 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DeleteRegKey HKCU "Software\Classes\CLSID\${EDUWORK_TOAST_CLSID}"
    ${EndIf}
  ${EndIf}
!macroend
