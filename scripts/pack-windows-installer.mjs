// Build the first per-user Windows installer from an assembled installed-layout
// candidate. electron-builder runs in --prepackaged mode: the candidate tree is
// already complete, so this step only wraps it in NSIS and must not repack or
// rename anything inside it.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { installedUpdateCacheDirName, installedUpdateFeed, installedUpdateYAML, installerPackageName } from '../dsh-electron/scripts/assemble-windows.mjs'
import { capture, ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, runNode, writeJSON } from './lib/build-util.mjs'

const EXECUTABLE = 'EduWork-Electron.exe'
const BUILDER_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'electron-builder')
const requireBuilder = createRequire(join(BUILDER_ROOT, 'package.json'))

function requireMatch(condition, message) {
  if (!condition) throw new Error(message)
}

export function verifyElectronBuilderVersion(upstreamLock, localVersion) {
  const lock = requireBuilder('js-yaml').load(upstreamLock)
  const resolved = lock?.importers?.['apps/desktop']?.devDependencies?.['electron-builder']?.version
  requireMatch(typeof resolved === 'string' && resolved, 'DSH apps/desktop resolved electron-builder version is missing from pnpm-lock.yaml')
  const upstreamVersion = resolved.match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\((?:@[^@/()\s]+\/)?[^@/()\s]+@[^()\s]+\))*$/)?.[1]
  requireMatch(upstreamVersion, 'DSH apps/desktop resolved electron-builder version is invalid in pnpm-lock.yaml')
  requireMatch(localVersion === upstreamVersion, `electron-builder version mismatch: EduWork locks ${localVersion}, DSH locks ${upstreamVersion}`)
}

export async function verifyElectronBuilderLock(upstream, electronBuilderCli) {
  const coreRoot = join(BUILDER_ROOT, '../..')
  const { sourceLock } = await readJSON(join(coreRoot, 'config/desktop-build.json'))
  const { commit } = await readJSON(join(coreRoot, sourceLock))
  const lock = await capture('git', ['-C', fullPath(upstream), 'show', `${commit}:pnpm-lock.yaml`])
  const { dependencies } = await readJSON(join(BUILDER_ROOT, 'package.json'))
  const expected = dependencies['electron-builder']
  verifyElectronBuilderVersion(lock, expected)
  const installed = (await runNode(electronBuilderCli, ['--version'], { capture: true })).stdout
  requireMatch(installed === expected, `electron-builder version differs from its lockfile: installed ${installed}, EduWork locks ${expected}`)
}

export function verifyInstalledCandidate({ desktop, release, receipt, appPackage, executableExists }) {
  requireMatch(desktop?.schemaVersion === 1 && desktop.shell === 'electron', 'Desktop identity is missing or unsupported')
  requireMatch(desktop.dataLayout === 'installed', 'Installer packaging requires an installed-layout candidate')
  requireMatch(release?.schemaVersion === 1 && release.shell === 'electron', 'Release identity is missing or unsupported')
  requireMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version ?? ''), 'Release version is invalid')
  requireMatch(desktop.productVersion === release.version, 'Product version differs between desktop identity and release')
  requireMatch(desktop.distribution === release.distribution, 'Distribution differs between desktop identity and release')
  requireMatch(desktop.productName === release.productName, 'Product name differs between desktop identity and release')
  requireMatch(/^[a-z0-9][a-z0-9-]*$/.test(desktop.distribution ?? ''), 'Distribution identifier is invalid')
  requireMatch(desktop.appId === `org.eduwork.${desktop.distribution}.electron`, 'Application identity does not match the distribution')
  requireMatch(desktop.sourceAlpha !== true, 'Source Alpha installers are not supported')
  requireMatch(executableExists, `Installed candidate is missing ${EXECUTABLE}`)
  requireMatch(appPackage?.version === release.version, 'Installed app manifest must carry the product version, not the DSH component version')
  requireMatch(receipt !== undefined, 'Installed-candidate receipt is required')
  requireMatch(receipt.kind === 'eduwork-windows-installed-candidate', 'Installed-candidate receipt kind is invalid')
  requireMatch(receipt.version === release.version && receipt.distribution === desktop.distribution, 'Installed-candidate receipt does not match the candidate')
  requireMatch(/^[a-f0-9]{40}$/.test(receipt.coreCommit ?? ''), 'Installed-candidate receipt has no source commit')
  requireMatch(receipt.checks?.installedAssembly === 'passed', 'Installed assembly has not passed')
}

function uninstallDataInclude(distribution, cacheDir) {
  const dataSuffix = `\\EduWork\\${distribution}`
  const cacheSuffix = `\\${cacheDir}`
  const installSuffix = `\\Programs\\EduWork\\${distribution}`
  const rootSuffixLength = Math.max(dataSuffix.length, cacheSuffix.length)
  return [
    '!ifdef BUILD_UNINSTALLER',
    '!include LogicLib.nsh',
    '!include nsDialogs.nsh',
    '!include FileFunc.nsh',
    '',
    '!macro EduWorkUninstallGetOptions PARAMETERS OPTION RESULT',
    '  !if "${OPTION}" S== "--delete-app-data"',
    '    SetErrors',
    '  !else',
    '    !insertmacro GetOptionsCall `${PARAMETERS}` `${OPTION}` `${RESULT}`',
    '  !endif',
    '!macroend',
    '!define /redef GetOptions `!insertmacro EduWorkUninstallGetOptions`',
    '',
    'Var DeleteEduWorkUserData',
    'Var KeepEduWorkUserData',
    'Var EduWorkDataCheckbox',
    'Var EduWorkVerifiedInstDir',
    'Var EduWorkDataCleanupStage',
    'Var EduWorkDataCleanupError',
    '',
    '!macro customUnInit',
    '  Call un.ParseUninstallFlags',
    '!macroend',
    '',
    '!macro EduWorkUninstallArgsFunction',
    'Function un.ParseUninstallFlags',
    '  StrCpy $DeleteEduWorkUserData "0"',
    '  StrCpy $KeepEduWorkUserData "1"',
    '  System::Call \'kernel32::GetCommandLineW()p.r0\'',
    '  ${if} $0 == 0',
    '    Return',
    '  ${endif}',
    '  System::Call \'kernel32::lstrlenW(p r0)i.r2\'',
    '  ${if} $2 <= 0',
    '  ${orIf} $2 >= ${NSIS_MAX_STRLEN}',
    '    Return',
    '  ${endif}',
    '  System::Call \'kernel32::lstrcpynW(w .r5, p r0, i ${NSIS_MAX_STRLEN})p.r6\'',
    '  ${if} $6 = 0',
    '    Return',
    '  ${endif}',
    '  IntOp $3 $2 - 4',
    '  ${while} $3 >= 0',
    '    StrCpy $4 $5 4 $3',
    '    System::Call \'kernel32::CompareStringOrdinal(w r4, i 4, w " _?=", i 4, i 0)i.r6\'',
    '    ${if} $6 = 0',
    '      Return',
    '    ${elseif} $6 = 2',
    '      ${if} $3 = 0',
    '        Return',
    '      ${endif}',
    '      StrCpy $2 $3',
    '      StrCpy $5 $5 $2',
    '      ${break}',
    '    ${endif}',
    '    IntOp $3 $3 - 1',
    '  ${endWhile}',
    '  StrCpy $3 $0',
    '  StrCpy $7 0',
    '  StrCpy $8 0',
    '  ${while} $2 > 0',
    '    System::Call \'*$3(&i2 .r4)\'',
    '    ${if} $4 = 34',
    '      ${if} $8 = 34',
    '      ${orIf} $8 = 92',
    '        Return',
    '      ${endif}',
    '      IntOp $7 $7 ^ 1',
    '    ${elseif} $4 = 95',
    '    ${andIf} $2 >= 3',
    '      System::Call \'kernel32::CompareStringOrdinal(p r3, i 3, w "_?=", i 3, i 0)i.r6\'',
    '      ${if} $6 = 0',
    '      ${orIf} $6 = 2',
    '        Return',
    '      ${endif}',
    '    ${endif}',
    '    StrCpy $8 $4',
    '    System::Int64Op $3 + 2',
    '    Pop $3',
    '    IntOp $2 $2 - 1',
    '  ${endWhile}',
    '  ${if} $7 <> 0',
    '    Return',
    '  ${endif}',
    '  System::Call \'shell32::CommandLineToArgvW(w r5, *i .r1)p.r0\'',
    '  ${if} $0 == 0',
    '    Return',
    '  ${endif}',
    '  StrCpy $7 "0"',
    '  StrCpy $8 "0"',
    '  StrCpy $9 "0"',
    '  ${if} $1 < 1',
    '    StrCpy $9 "1"',
    '  ${endif}',
    '  StrCpy $2 $0',
    '  ${while} $1 > 1',
    '    System::Int64Op $2 + ${NSIS_PTR_SIZE}',
    '    Pop $2',
    '    IntOp $1 $1 - 1',
    '    System::Call \'*$2(p .r3)\'',
    '    ${if} $3 == 0',
    '      StrCpy $9 "1"',
    '      ${break}',
    '    ${endif}',
    '    System::Call \'kernel32::lstrlenW(p r3)i.r4\'',
    '    ${if} $4 >= ${NSIS_MAX_STRLEN}',
    '      StrCpy $9 "1"',
    '      ${break}',
    '    ${endif}',
    '    ${if} $4 >= 3',
    '      System::Call \'kernel32::CompareStringOrdinal(p r3, i 3, w "_?=", i 3, i 0)i.r6\'',
    '      ${if} $6 = 0',
    '      ${orIf} $6 = 2',
    '        StrCpy $9 "1"',
    '        ${break}',
    '      ${endif}',
    '    ${endif}',
    ...[
      { flag: '/KEEP_APP_DATA', ignoreCase: 1, target: '$9' },
      { flag: '--updated', ignoreCase: 1, target: '$9' },
      { flag: '/S', ignoreCase: 0, target: '$7' },
      { flag: '--eduwork-delete-user-data', ignoreCase: 0, target: '$8' },
    ].flatMap(({ flag, ignoreCase, target }) => [
      `    System::Call 'kernel32::CompareStringOrdinal(p r3, i -1, w "${flag}", i -1, i ${ignoreCase})i.r6'`,
      '    ${if} $6 = 0',
      '      StrCpy $9 "1"',
      '      ${break}',
      '    ${endif}',
      '    ${if} $6 = 2',
      `      StrCpy ${target} "1"`,
      '      ${continue}',
      '    ${endif}',
    ]),
    '  ${endWhile}',
    '  System::Call \'kernel32::LocalFree(p r0)p.r6\'',
    '  ${if} $6 == 0',
    '  ${andIf} $9 == "0"',
    '  ${andIfNot} ${isUpdated}',
    '    StrCpy $KeepEduWorkUserData "0"',
    '  ${endif}',
    '  ${if} $KeepEduWorkUserData == "0"',
    '  ${andIf} ${Silent}',
    '  ${andIf} $7 == "1"',
    '  ${andIf} $8 == "1"',
    '    StrCpy $DeleteEduWorkUserData "1"',
    '  ${endif}',
    '  ClearErrors',
    'FunctionEnd',
    '!macroend',
    '',
    '!macro customUnWelcomePage',
    '  !insertmacro MUI_UNPAGE_WELCOME',
    '  UninstPage custom un.PersonalDataPage un.PersonalDataPageLeave',
    '',
    '  Function un.PersonalDataPage',
    '    ${if} ${Silent}',
    '    ${orIf} $KeepEduWorkUserData == "1"',
    '      Abort',
    '    ${endif}',
    '    nsDialogs::Create 1018',
    '    Pop $0',
    '    ${if} $0 == error',
    '      StrCpy $DeleteEduWorkUserData "0"',
    '      Abort',
    '    ${endif}',
    '    GetDlgItem $0 $HWNDPARENT 1',
    '    ${if} $LANGUAGE == 2052',
    '      !insertmacro MUI_HEADER_TEXT "个人数据选项" "选择卸载时是否保留本机个人数据。"',
    '      SendMessage $0 ${WM_SETTEXT} 0 "STR:卸载(&U)"',
    '      StrCpy $1 "同时删除本机个人数据（会话记录、设置、模型凭据与内置工作区）"',
    `      StrCpy $2 "不勾选时将完整保留 %LOCALAPPDATA%${dataSuffix}，重新安装后可继续使用。勾选仅删除当前发行版的个人数据与更新缓存，不会删除电脑上其他位置的外部工作区文件，也不会影响其他发行版。"`,
    '    ${else}',
    '      !insertmacro MUI_HEADER_TEXT "Personal Data" "Choose whether to keep your local personal data during uninstallation."',
    '      SendMessage $0 ${WM_SETTEXT} 0 "STR:&Uninstall"',
    '      StrCpy $1 "Also delete local personal data (sessions, settings, credentials, and built-in workspaces)"',
    `      StrCpy $2 "Leave unchecked to keep %LOCALAPPDATA%${dataSuffix} for future reinstallation. Checking this removes only this edition's personal data and updater cache; external workspaces elsewhere on your PC and other editions are not touched."`,
    '    ${endif}',
    '    ${NSD_CreateCheckbox} 0u 0u 100% 28u "$1"',
    '    Pop $EduWorkDataCheckbox',
    '    ${NSD_AddStyle} $EduWorkDataCheckbox ${BS_MULTILINE}',
    '    ${if} $DeleteEduWorkUserData == "1"',
    '      ${NSD_SetState} $EduWorkDataCheckbox ${BST_CHECKED}',
    '    ${else}',
    '      ${NSD_SetState} $EduWorkDataCheckbox ${BST_UNCHECKED}',
    '    ${endif}',
    '    ${NSD_OnClick} $EduWorkDataCheckbox un.PersonalDataPageChanged',
    '    ${NSD_CreateLabel} 0u 38u 100% 94u "$2"',
    '    Pop $0',
    '    nsDialogs::Show',
    '  FunctionEnd',
    '',
    '  Function un.PersonalDataPageChanged',
    '    Pop $0',
    '    Call un.PersonalDataPageLeave',
    '  FunctionEnd',
    '',
    '  Function un.PersonalDataPageLeave',
    '    ${NSD_GetState} $EduWorkDataCheckbox $DeleteEduWorkUserData',
    '  FunctionEnd',
    '!macroend',
    '',
    '!macro EduWorkIfDeleteRequested',
    '  ${if} $DeleteEduWorkUserData == "1"',
    '  ${andIf} $KeepEduWorkUserData == "0"',
    '  ${andIfNot} ${isUpdated}',
    '!macroend',
    '',
    '!macro customUnInstall',
    '  !insertmacro EduWorkIfDeleteRequested',
    '    Call un.BindEduWorkInstall',
    '  ${endif}',
    '!macroend',
    '',
    '; No file associations are registered. This hook runs after stock program removal, on the progress page.',
    '!macro unregisterFileAssociations',
    '  !insertmacro EduWorkIfDeleteRequested',
    '    Call un.DeletePersonalData',
    '  ${endif}',
    '!macroend',
    '',
    'Function un.ExtendEduWorkPath',
    '  StrLen $2 $0',
    '  IntOp $2 $2 + $1',
    '  IntOp $2 $2 + 6',
    '  ${if} $2 >= ${NSIS_MAX_STRLEN}',
    '    StrCpy $2 206',
    '    Return',
    '  ${endif}',
    '  StrCpy $2 $0 2',
    '  ${if} $2 == "\\\\"',
    '    StrCpy $0 $0 "" 2',
    '    StrCpy $0 "\\\\?\\UNC\\$0"',
    '  ${else}',
    '    StrCpy $2 $0 2 1',
    '    ${if} $2 != ":\\"',
    '      StrCpy $2 123',
    '      Return',
    '    ${endif}',
    '    StrCpy $0 "\\\\?\\$0"',
    '  ${endif}',
    '  StrCpy $2 0',
    'FunctionEnd',
    '',
    '!macro EduWorkBindInstallFunction',
    'Function un.BindEduWorkInstall',
    '  StrCpy $EduWorkVerifiedInstDir ""',
    '  StrCpy $EduWorkDataCleanupError 13',
    '  ${if} $installMode != "CurrentUser"',
    '    Return',
    '  ${endif}',
    '  StrLen $2 $LOCALAPPDATA',
    `  IntOp $2 $2 + ${installSuffix.length}`,
    '  ${if} $2 >= ${NSIS_MAX_STRLEN}',
    '    StrCpy $EduWorkDataCleanupError 206',
    '    Return',
    '  ${endif}',
    `  System::Call 'kernel32::CompareStringOrdinal(w "$INSTDIR", i -1, w "$LOCALAPPDATA${installSuffix}", i -1, i 1)i.r2'`,
    '  ${if} $2 <> 2',
    '    Return',
    '  ${endif}',
    '  IntOp $3 ${NSIS_MAX_STRLEN} * 2',
    '  System::Call \'advapi32::RegGetValueW(p 0x80000001, w "${UNINSTALL_REGISTRY_KEY}", w "InstallLocation", i 0x10000002, p 0, w .r0, *i r3)i.r2\'',
    '  ${if} $2 != 0',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Return',
    '  ${endif}',
    '  StrCpy $1 $0 1 -1',
    '  ${while} $1 == "\\"',
    '    StrCpy $0 $0 -1',
    '    StrCpy $1 $0 1 -1',
    '  ${endWhile}',
    '  System::Call \'kernel32::CompareStringOrdinal(w "$0", i -1, w "$INSTDIR", i -1, i 1)i.r2\'',
    '  ${if} $2 <> 2',
    '    Return',
    '  ${endif}',
    '  StrCpy $0 $INSTDIR',
    `  StrCpy $1 ${EXECUTABLE.length + 1}`,
    '  Call un.ExtendEduWorkPath',
    '  ${if} $2 != 0',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Return',
    '  ${endif}',
    '  System::Call \'kernel32::GetFileAttributesW(w r0)i.r3 ?e\'',
    '  Pop $2',
    '  ${if} $3 == -1',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Return',
    '  ${endif}',
    '  IntOp $3 $3 & 0x410',
    '  ${if} $3 != 16',
    '    Return',
    '  ${endif}',
    `  System::Call 'kernel32::GetFileAttributesW(w "$0\\${EXECUTABLE}")i.r3 ?e'`,
    '  Pop $2',
    '  ${if} $3 == -1',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Return',
    '  ${endif}',
    '  IntOp $3 $3 & 0x410',
    '  ${if} $3 == 0',
    '    StrCpy $EduWorkVerifiedInstDir $INSTDIR',
    '  ${endif}',
    'FunctionEnd',
    '!macroend',
    '',
    '!macro EduWorkOpenEntry ACCESS',
    '  System::Call \'kernel32::CreateFileW(w r0, i ${ACCESS}, i 1, p 0, i 3, i 0x02200000, p 0)p.r1 ?e\'',
    '  Pop $2',
    '!macroend',
    '',
    'Function un.ReadEduWorkEntryAttributes',
    '  System::Alloc 8',
    '  Pop $5',
    '  ${if} $5 == 0',
    '    StrCpy $3 8',
    '    Return',
    '  ${endif}',
    '  System::Call \'kernel32::GetFileInformationByHandleEx(p r1, i 9, p r5, i 8)i.r3 ?e\'',
    '  Pop $2',
    '  ${if} $3 != 0',
    '    System::Call \'*$5(i .r2)\'',
    '    StrCpy $3 0',
    '  ${else}',
    '    StrCpy $3 $2',
    '  ${endif}',
    '  System::Free $5',
    'FunctionEnd',
    '',
    '!macro EduWorkRecordCleanupError CODE',
    '  ${if} $EduWorkDataCleanupError == 0',
    '    StrCpy $EduWorkDataCleanupError ${CODE}',
    '  ${endif}',
    '!macroend',
    '',
    'Function un.OpenEduWorkAncestor',
    '  !insertmacro EduWorkOpenEntry 1',
    '  ${if} $1 != -1',
    '    Call un.ReadEduWorkEntryAttributes',
    '    ${if} $3 == 0',
    '      IntOp $2 $2 & 0x410',
    '      ${if} $2 != 16',
    '        StrCpy $3 5',
    '      ${endif}',
    '    ${endif}',
    '    ${if} $3 != 0',
    '      System::Call \'kernel32::CloseHandle(p r1)\'',
    '      StrCpy $1 -1',
    '      StrCpy $2 $3',
    '    ${endif}',
    '  ${endif}',
    'FunctionEnd',
    '',
    'Function un.DeleteEduWorkTree',
    '  Push $0',
    '  Push $1',
    '  Push $2',
    '  Push $3',
    '  Push $4',
    '  Push $5',
    '  StrCpy $4 $0',
    '  !insertmacro EduWorkOpenEntry 0x10001',
    '  ${if} $1 == -1',
    '    ${if} $2 != 2',
    '    ${andIf} $2 != 3',
    '      !insertmacro EduWorkRecordCleanupError $2',
    '    ${endif}',
    '    Goto done',
    '  ${endif}',
    '  Call un.ReadEduWorkEntryAttributes',
    '  ${if} $3 != 0',
    '    !insertmacro EduWorkRecordCleanupError $3',
    '    Goto close',
    '  ${endif}',
    '  IntOp $3 $2 & 0x400',
    '  IntOp $5 $2 & 0x10',
    '  IntOp $2 $2 & 1',
    '  ${if} $3 != 0',
    '  ${andIf} $2 == 0',
    '    System::Call \'kernel32::CloseHandle(p r1)\'',
    '    ${if} $5 != 0',
    '      System::Call \'kernel32::RemoveDirectoryW(w r4)i.r3 ?e\'',
    '    ${else}',
    '      System::Call \'kernel32::DeleteFileW(w r4)i.r3 ?e\'',
    '    ${endif}',
    '    Pop $2',
    '    ${if} $3 == 0',
    '      !insertmacro EduWorkRecordCleanupError $2',
    '    ${endif}',
    '    Goto done',
    '  ${endif}',
    '  ${if} $3 == 0',
    '  ${andIf} $5 != 0',
    '    StrLen $5 $4',
    '    IntOp $5 $5 + 2',
    '    ${if} $5 >= ${NSIS_MAX_STRLEN}',
    '      !insertmacro EduWorkRecordCleanupError 206',
    '      Goto close',
    '    ${endif}',
    '    FindFirst $2 $3 "$4\\*"',
    '    ${while} $3 != ""',
    '      ${if} $3 != "."',
    '      ${andIf} $3 != ".."',
    '        StrLen $5 $4',
    '        StrLen $0 $3',
    '        IntOp $5 $5 + $0',
    '        IntOp $5 $5 + 1',
    '        ${if} $5 >= ${NSIS_MAX_STRLEN}',
    '          !insertmacro EduWorkRecordCleanupError 206',
    '        ${else}',
    '          StrCpy $0 "$4\\$3"',
    '          Call un.DeleteEduWorkTree',
    '        ${endif}',
    '      ${endif}',
    '      FindNext $2 $3',
    '    ${endWhile}',
    '    FindClose $2',
    '  ${endif}',
    '; Delete on the pinned handle, ignoring read-only without modifying hard-linked files.',
    '  System::Call \'kernel32::SetFileInformationByHandle(p r1, i 21, *i 0x13, i 4)i.r3 ?e\'',
    '  Pop $2',
    '  ${if} $3 == 0',
    '    !insertmacro EduWorkRecordCleanupError $2',
    '  ${endif}',
    'close:',
    '  System::Call \'kernel32::CloseHandle(p r1)\'',
    'done:',
    '  Pop $5',
    '  Pop $4',
    '  Pop $3',
    '  Pop $2',
    '  Pop $1',
    '  Pop $0',
    'FunctionEnd',
    '',
    '!macro customHeader',
    '  !insertmacro EduWorkUninstallArgsFunction',
    '  !insertmacro EduWorkBindInstallFunction',
    'Function un.DeletePersonalData',
    '  StrCpy $EduWorkDataCleanupStage "verify-install"',
    '  ${if} $EduWorkVerifiedInstDir == ""',
    '    Goto report',
    '  ${endif}',
    '  StrCpy $EduWorkDataCleanupError 13',
    '  ${if} $installMode != "CurrentUser"',
    '    Goto report',
    '  ${endif}',
    '  System::Call \'kernel32::CompareStringOrdinal(w "$EduWorkVerifiedInstDir", i -1, w "$INSTDIR", i -1, i 1)i.r2\'',
    '  ${if} $2 <> 2',
    '    Goto report',
    '  ${endif}',
    '  StrCpy $0 $EduWorkVerifiedInstDir',
    '  StrCpy $1 0',
    '  Call un.ExtendEduWorkPath',
    '  ${if} $2 != 0',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Goto report',
    '  ${endif}',
    '  System::Call \'kernel32::GetFileAttributesW(w r0)i.r3 ?e\'',
    '  Pop $2',
    '  ${if} $3 != -1',
    '    StrCpy $EduWorkDataCleanupError 183',
    '    Goto report',
    '  ${endif}',
    '  ${if} $2 != 2',
    '  ${andIf} $2 != 3',
    '    StrCpy $EduWorkDataCleanupError $2',
    '    Goto report',
    '  ${endif}',
    '  StrCpy $EduWorkDataCleanupStage "cleanup"',
    '  StrCpy $EduWorkDataCleanupError 0',
    '  StrCpy $0 $LOCALAPPDATA',
    `  StrCpy $1 ${rootSuffixLength}`,
    '  Call un.ExtendEduWorkPath',
    '  ${if} $2 != 0',
    '    !insertmacro EduWorkRecordCleanupError $2',
    '    Goto report',
    '  ${endif}',
    '  Call un.OpenEduWorkAncestor',
    '  ${if} $1 == -1',
    '    !insertmacro EduWorkRecordCleanupError $2',
    '    Goto report',
    '  ${endif}',
    '  StrCpy $6 $0',
    '  StrCpy $7 $1',
    '  StrCpy $0 "$6\\EduWork"',
    '  Call un.OpenEduWorkAncestor',
    '  ${if} $1 != -1',
    '    StrCpy $8 $1',
    `    StrCpy $0 "$6${dataSuffix}"`,
    '    Call un.DeleteEduWorkTree',
    '    System::Call \'kernel32::CloseHandle(p r8)\'',
    '    System::Call \'kernel32::RemoveDirectoryW(w "$6\\EduWork")i.r3 ?e\'',
    '    Pop $2',
    '    ${if} $3 == 0',
    '    ${andIf} $2 != 145',
    '    ${andIf} $2 != 2',
    '    ${andIf} $2 != 3',
    '      !insertmacro EduWorkRecordCleanupError $2',
    '    ${endif}',
    '  ${elseif} $2 != 2',
    '  ${andIf} $2 != 3',
    '    !insertmacro EduWorkRecordCleanupError $2',
    '  ${endif}',
    `  StrCpy $0 "$6${cacheSuffix}"`,
    '  Call un.DeleteEduWorkTree',
    '  System::Call \'kernel32::CloseHandle(p r7)\'',
    'report:',
    '  ${if} $EduWorkDataCleanupError != 0',
    '    ${if} $EduWorkDataCleanupStage == "verify-install"',
    '      ${if} $LANGUAGE == 2052',
    '        StrCpy $0 "未能确认当前用户的 EduWork 安装已被移除，已保留本机个人数据与更新缓存。"',
    '      ${else}',
    '        StrCpy $0 "Could not verify removal of the current user’s EduWork installation. Local personal data and updater cache were kept."',
    '      ${endif}',
    '    ${else}',
    '      ${if} $LANGUAGE == 2052',
    '        StrCpy $0 "EduWork 已卸载，但未能删除全部个人数据或更新缓存，部分数据可能仍保留在本机。"',
    '      ${else}',
    '        StrCpy $0 "EduWork was uninstalled, but some personal data or updater cache could not be removed and may remain on this PC."',
    '      ${endif}',
    '    ${endif}',
    '    DetailPrint "$0 [$EduWorkDataCleanupStage: Win32 $EduWorkDataCleanupError]"',
    '    MessageBox MB_OK|MB_ICONEXCLAMATION "$0$\\r$\\n[$EduWorkDataCleanupStage: Win32 $EduWorkDataCleanupError]" /SD IDOK',
    '    SetErrorLevel 1',
    '  ${endif}',
    '  ClearErrors',
    'FunctionEnd',
    '!macroend',
    '!endif',
  ].join('\n')
}

export function installerInclude(desktop) {
  requireMatch(/^[a-z0-9][a-z0-9-]*$/.test(desktop.distribution ?? ''), 'Distribution identifier is invalid')
  const cacheDir = installedUpdateCacheDirName(desktop.distribution)
  return [
    `!if "\${APP_INSTALLER_STORE_FILE}" S!= "${cacheDir}\\installer.exe"`,
    '  !error "NSIS installer cache path differs from the EduWork updater cache path"',
    '!endif',
    '',
    '; EduWork per-user install directory. customInit runs after the default',
    '; per-user path is computed and before any page or extraction uses it.',
    '!macro customInit',
    `  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\EduWork\\${desktop.distribution}"`,
    '!macroend',
    '',
    '; The stock install-mode page recomputes $INSTDIR for per-user installs,',
    '; which would discard the customInit value. Pin the mode and path here.',
    '!macro customInstallMode',
    '  StrCpy $installMode CurrentUser',
    '  SetShellVarContext current',
    `  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\EduWork\\${desktop.distribution}"`,
    '  Abort',
    '!macroend',
    '',
    '; Inventory tools and the updater read the public uninstall entry.',
    '!macro customInstall',
    '  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"',
    '!macroend',
    '',
    '; Updated assisted installs must skip the finish page before relaunching.',
    '!macro customFinishPage',
    '  Function RelaunchAfterUpdate',
    '    ${if} ${isUpdated}',
    '    ${andIf} ${isForceRun}',
    '      HideWindow',
    `      Exec '"$appExe" --updated'`,
    '      Abort',
    '    ${endif}',
    '  FunctionEnd',
    '  !define MUI_PAGE_CUSTOMFUNCTION_PRE RelaunchAfterUpdate',
    '  !insertmacro MUI_PAGE_FINISH',
    '!macroend',
    '',
    uninstallDataInclude(desktop.distribution, cacheDir),
    '',
  ].join('\n')
}

export function installerProject({ desktop, release, electronVersion, artifactsDir, icon, includePath }) {
  requireMatch(/^\d+\.\d+\.\d+/.test(electronVersion ?? ''), 'Electron runtime version is invalid')
  const feed = installedUpdateFeed(desktop.updates)
  const channel = release.version.includes('-dev.') ? 'dev' : 'latest'
  const publish = feed?.provider === 'generic' ? { provider: 'generic', url: feed.url, channel } : feed ? { ...feed, channel } : null
  return {
    packageJSON: {
      name: installerPackageName(desktop.distribution),
      productName: desktop.productName,
      version: release.version,
      description: 'EduWork desktop application',
      author: { name: 'EduWork' },
      license: 'MulanPSL-2.0 AND MIT',
      private: true,
    },
    config: {
      appId: desktop.appId,
      productName: desktop.productName,
      executableName: EXECUTABLE.replace(/\.exe$/i, ''),
      electronVersion,
      copyright: `Copyright © ${new Date().getFullYear()} EduWork`,
      directories: { output: artifactsDir },
      win: { target: ['nsis'], icon },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: false,
        allowToChangeInstallationDirectory: false,
        createDesktopShortcut: false,
        createStartMenuShortcut: true,
        runAfterFinish: false,
        uninstallDisplayName: desktop.productName,
        deleteAppDataOnUninstall: false,
        differentialPackage: publish !== null,
        installerLanguages: ['zh_CN', 'en_US'],
        installerIcon: icon,
        uninstallerIcon: icon,
        include: includePath,
        artifactName: `${desktop.productName}-Setup-${release.version}-\${arch}.\${ext}`,
      },
      publish,
    },
  }
}

export async function packWindowsInstaller({ candidate, output, installedReceipt, electronBuilderCli, icon }) {
  requireMatch(typeof installedReceipt === 'string' && installedReceipt.length > 0, 'Installed-candidate receipt is required')
  candidate = fullPath(candidate)
  output = fullPath(output)
  icon = fullPath(icon)
  electronBuilderCli = fullPath(electronBuilderCli)
  requireMatch(!await pathExists(output), 'Installer output must be a new directory')
  const desktop = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  const release = await readJSON(join(candidate, 'release.json'))
  const appPackage = await readJSON(join(candidate, 'resources/app/package.json'))
  const electronVersion = (await readFile(join(candidate, 'version'), 'utf8')).trim()
  const receipt = await readJSON(fullPath(installedReceipt))
  verifyInstalledCandidate({ desktop, release, receipt, appPackage, executableExists: await isFile(join(candidate, EXECUTABLE)) })
  requireMatch(await isFile(icon), 'Installer icon is missing')
  requireMatch(await isFile(electronBuilderCli), 'electron-builder CLI is missing')

  const staging = join(output, 'installer-project')
  const artifacts = join(output, 'artifacts')
  await ensureDir(staging)
  await ensureDir(artifacts)
  const includePath = join(staging, 'installer.nsh')
  await writeFile(includePath, installerInclude(desktop))
  const project = installerProject({ desktop, release, electronVersion, artifactsDir: artifacts, icon, includePath })
  const updateConfig = join(candidate, 'resources/app-update.yml')
  if (project.config.publish) {
    requireMatch(await readFile(updateConfig, 'utf8') === installedUpdateYAML(project.config.publish, desktop.distribution), 'Packaged update source differs from installer configuration')
  } else {
    requireMatch(!await pathExists(updateConfig), 'Installer without a publish source must not declare an update feed')
  }
  await writeJSON(join(staging, 'package.json'), project.packageJSON)
  const configPath = join(staging, 'electron-builder.json')
  await writeJSON(configPath, project.config)

  const args = ['--win', 'nsis', '--x64', '--prepackaged', candidate, '--projectDir', staging,
    '--config', configPath, '--publish', 'never']
  await runNode(electronBuilderCli, args, { cwd: staging, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })

  const expected = `${desktop.productName}-Setup-${release.version}-x64.exe`
  const artifact = join(artifacts, expected)
  requireMatch(await isFile(artifact), `Installer artifact is missing: ${expected}`)
  const bytes = await readFile(artifact)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(`${artifact}.sha256`, `${sha256} *${expected}\n`)
  const updateArtifacts = []
  if (project.config.publish) {
    const channelFile = `${project.config.publish.channel}.yml`
    const channelBytes = await readFile(join(artifacts, channelFile))
    const metadata = requireBuilder('js-yaml').load(channelBytes.toString('utf8'))
    const digest = createHash('sha512').update(bytes).digest('base64')
    requireMatch(metadata?.version === release.version && metadata.path === expected && metadata.sha512 === digest,
      'Installer update metadata differs from the packaged installer')
    requireMatch(Array.isArray(metadata.files) && metadata.files.length === 1
      && metadata.files[0]?.url === expected && metadata.files[0].sha512 === digest && metadata.files[0].size === bytes.length,
      'Installer channel file does not identify the packaged installer')
    for (const file of [channelFile, `${expected}.blockmap`]) {
      const contents = file === channelFile ? channelBytes : await readFile(join(artifacts, file))
      requireMatch(contents.length > 0, `Installer update artifact is empty: ${file}`)
      updateArtifacts.push({ file, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') })
    }
  }
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-windows-installer-candidate',
    version: release.version,
    coreCommit: receipt.coreCommit,
    distribution: desktop.distribution,
    appId: desktop.appId,
    productName: desktop.productName,
    executableName: EXECUTABLE,
    installDir: `%LOCALAPPDATA%\\Programs\\EduWork\\${desktop.distribution}`,
    dataDir: `%LOCALAPPDATA%\\EduWork\\${desktop.distribution}`,
    artifact: { file: expected, bytes: bytes.length, sha256 },
    updateArtifacts,
    publication: 'artifact-only',
    checks: { installedAssembly: 'passed', installerBuilt: 'passed', install: 'not-run', import: 'not-run', uninstall: 'not-run', reinstall: 'not-run' },
  }
  await writeJSON(join(output, 'installer-candidate-receipt.json'), result)
  console.log(`Windows installer assembled: ${artifact}`)
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, 'installed-receipt': { type: 'string' },
    'electron-builder-cli': { type: 'string' }, icon: { type: 'string' }, upstream: { type: 'string' },
  } })
  if (!values.candidate || !values.output || !values['installed-receipt'] || !values['electron-builder-cli'] || !values.icon || !values.upstream) {
    throw new Error('Use --candidate <installed candidate root> --installed-receipt <json> --output <new directory> --electron-builder-cli <cli.js> --icon <icon.ico> --upstream <pinned DSH checkout>')
  }
  await verifyElectronBuilderLock(values.upstream, values['electron-builder-cli'])
  await packWindowsInstaller({
    candidate: values.candidate,
    output: values.output,
    installedReceipt: values['installed-receipt'],
    electronBuilderCli: values['electron-builder-cli'],
    icon: values.icon,
  })
}
