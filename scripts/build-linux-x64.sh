#!/usr/bin/env bash
# Build one EduWork linux-x64 archive on the current x64 machine.
# The package runs on Ubuntu 22.04 and newer glibc systems. It is not part of
# the Windows+macOS publication gate and does not publish an update feed.
#
#   scripts/build-linux-x64.sh <version>
#   scripts/build-linux-x64.sh 0.4.1-dev.20261004.1
set -euo pipefail
cd "$(dirname "$0")/.."
version=${1:?用法：build-linux-x64.sh <版本，例如 0.4.1-dev.20261004.1>}
[[ $(node -p process.arch) == x64 ]] || { echo "当前 Node 不是 x64" >&2; exit 1; }
command -v pwsh >/dev/null || { echo "需要 PowerShell 7（pwsh）" >&2; exit 1; }
command -v cmake >/dev/null || { echo "需要 cmake，用于编译随包 whisper-cli" >&2; exit 1; }
command -v gnome-keyring-daemon >/dev/null || { echo "需要 gnome-keyring，桌面验收要用系统密钥环" >&2; exit 1; }
command -v dbus-run-session >/dev/null || { echo "需要 dbus-run-session" >&2; exit 1; }
if [[ -z ${EDUWORK_LINUX_KEYRING:-} ]]; then
  export EDUWORK_LINUX_KEYRING=1
  export XDG_DATA_HOME=$(mktemp -d "${TMPDIR:-/tmp}/eduwork-keyring.XXXXXX")
  exec dbus-run-session -- bash -c '
    set -euo pipefail
    printf "%s\n" eduwork-build | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    while IFS= read -r line; do
      case "$line" in
        *=*) export "$line" ;;
      esac
    done < <(printf "%s\n" eduwork-build | gnome-keyring-daemon --start --components=secrets --daemonize)
    exec "$@"
  ' bash "$0" "$@"
fi
export SELECTED_PLATFORMS=linux
export PUBLISH_RELEASE=false
export RELEASE_NOTES_APPROVED=false
unset RELEASE_NOTES || true
out=${BUILD_ROOT:-$HOME/eduwork-build}/linux-x64
if [[ -e $out ]]; then
  echo "输出目录已存在，换一个 BUILD_ROOT 或删掉 $out" >&2
  exit 1
fi
if [[ -z ${DISPLAY:-} ]]; then
  exec xvfb-run -a pwsh -NoProfile -File scripts/build-desktop-candidate.ps1 -CoreRoot . -EditionRoot . -Version "$version" -Output "$out"
fi
pwsh -NoProfile -File scripts/build-desktop-candidate.ps1 -CoreRoot . -EditionRoot . -Version "$version" -Output "$out"
