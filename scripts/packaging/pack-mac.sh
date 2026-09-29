#!/usr/bin/env bash
# One-click macOS pack: use vendored bun/Electron when present, otherwise bootstrap bun.
# Must run on macOS. Windows node_modules cannot be reused.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "请在 Mac 上运行此脚本（当前系统不是 macOS）。"
  echo "在 Windows 上请先执行: bun run prepare-mac-kit"
  echo "然后把整个项目（含 vendor/mac-pack）拷到 Mac，再双击 pack-mac.command。"
  exit 1
fi

ARCH="$(uname -m)"
VENDOR_BUN="${ROOT}/vendor/mac-pack/bun-${ARCH}/bun"
ELECTRON_CACHE_DIR="${ROOT}/vendor/mac-pack/electron-cache"

echo "AionUi macOS 一键打包"
echo "项目目录: ${ROOT}"
echo

if ! xcode-select -p >/dev/null 2>&1; then
  echo "未检测到 Xcode Command Line Tools（编译原生模块和打 dmg 需要它，无法随项目拷贝）。"
  echo "即将弹出苹果的安装窗口。装完后请再运行一次本脚本。"
  xcode-select --install || true
  exit 1
fi

resolve_bun() {
  if [[ -f "${VENDOR_BUN}" ]]; then
    chmod +x "${VENDOR_BUN}" 2>/dev/null || true
    if [[ -x "${VENDOR_BUN}" ]]; then
      printf '%s' "${VENDOR_BUN}"
      return 0
    fi
  fi
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  if [[ -x "${HOME}/.bun/bin/bun" ]]; then
    printf '%s' "${HOME}/.bun/bin/bun"
    return 0
  fi
  return 1
}

BUN="$(resolve_bun || true)"
if [[ -z "${BUN}" ]]; then
  echo "未找到 bun，正在从 https://bun.sh/install 安装到 ~/.bun （无需手动点装）。"
  curl -fsSL https://bun.sh/install | bash
  BUN="${HOME}/.bun/bin/bun"
fi

export PATH="$(dirname "${BUN}"):${PATH}"
export AIONUI_HUB_SKIP="${AIONUI_HUB_SKIP:-1}"
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"

if [[ -d "${ELECTRON_CACHE_DIR}" ]]; then
  export ELECTRON_CACHE="${ELECTRON_CACHE_DIR}"
  echo "使用预置 Electron 缓存: ${ELECTRON_CACHE_DIR}"
fi

echo "使用 bun: ${BUN} ($("${BUN}" --version))"
echo
echo "正在安装 JS 依赖（首次需要网络；不能沿用 Windows 上的 node_modules）..."
"${BUN}" install --frozen-lockfile

echo
echo "开始打包 macOS 安装包（无公证证书时使用 ad-hoc 签名）..."
"${BUN}" run dist:mac

echo
echo "完成。安装包在: ${ROOT}/out"
if command -v open >/dev/null 2>&1; then
  open "${ROOT}/out"
fi
