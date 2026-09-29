#!/bin/bash
# Double-click in Finder on macOS to pack AionUi.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "${DIR}/pack-mac.sh"
status=$?
echo
if [[ "${status}" -eq 0 ]]; then
  echo "打包结束。窗口可关闭。"
else
  echo "打包失败（退出码 ${status}）。请把上面的报错发回来。"
fi
echo
read -r -p "按回车关闭窗口..." _ || true
exit "${status}"
