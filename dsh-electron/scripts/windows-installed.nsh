!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var eduworkSourceRoot
!ifdef BUILD_UNINSTALLER
  Var eduworkDeleteData
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

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !define DSH_INSTALLER_LOG_DIR "$LOCALAPPDATA\EduWork\installer-logs\${EDUWORK_DISTRIBUTION}"
    !include "${EDUWORK_DIRECTORY_INCLUDE}"
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
  nsExec::ExecToStack '"$PLUGINSDIR\eduwork\node.exe" "$PLUGINSDIR\eduwork\installed-files.cjs" --action check-program --distribution "${EDUWORK_DISTRIBUTION}" --program-root "$INSTDIR"'
  !insertmacro eduworkCheckResult "程序目录含其他文件或链接，已停止操作。请先将个人文件和工作区移出程序目录。"
!macroend

!macro customInstall
  !insertmacro dshFinishDirectories
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
!macroend
