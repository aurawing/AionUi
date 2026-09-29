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
BUN_INSTALL_ATTEMPTS="${BUN_INSTALL_ATTEMPTS:-3}"

# Keep precedence in sync with macPackKit.pickPackProxy.
apply_pack_proxy() {
  local proxy=""
  local key
  for key in AIONUI_PACK_PROXY ALL_PROXY all_proxy HTTPS_PROXY https_proxy HTTP_PROXY http_proxy; do
    proxy="${!key:-}"
    if [[ -n "${proxy}" ]]; then
      break
    fi
  done
  if [[ -z "${proxy}" ]]; then
    echo "未设置代理。下载 bun/Electron 慢时，先执行："
    echo "  export ALL_PROXY=http://127.0.0.1:10808"
    echo "  export HTTPS_PROXY=http://127.0.0.1:10808"
    echo "（Clash / V2RayN 混合端口 http:// 与 socks5:// 都可以；局域网代理要开「允许局域网」。）"
    echo
    return 0
  fi
  export ALL_PROXY="${proxy}"
  export all_proxy="${proxy}"
  export HTTPS_PROXY="${proxy}"
  export https_proxy="${proxy}"
  export HTTP_PROXY="${proxy}"
  export http_proxy="${proxy}"
  export ELECTRON_GET_USE_PROXY=true
  export GLOBAL_AGENT_HTTPS_PROXY="${proxy}"
  export GLOBAL_AGENT_HTTP_PROXY="${proxy}"
  export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
  export no_proxy="${NO_PROXY}"
  echo "使用代理: ${proxy}"
  echo
}

curl_fetch() {
  if [[ -n "${ALL_PROXY:-}" ]]; then
    curl -fsSL --proxy "${ALL_PROXY}" "$@"
  else
    curl -fsSL "$@"
  fi
}

bun_install_with_retry() {
  local attempt
  for attempt in $(seq 1 "${BUN_INSTALL_ATTEMPTS}"); do
    echo "bun install 第 ${attempt}/${BUN_INSTALL_ATTEMPTS} 次..."
    if "${BUN}" install --frozen-lockfile; then
      return 0
    fi
    echo "bun install 失败，5 秒后重试（常见于 Electron 下载被中断）。"
    sleep 5
  done
  echo "bun install 连续失败。请确认代理可访问 GitHub，并已设置 ELECTRON_MIRROR。"
  return 1
}

echo "AionUi macOS 一键打包"
echo "项目目录: ${ROOT}"
echo
apply_pack_proxy

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
  curl_fetch https://bun.sh/install | bash
  BUN="${HOME}/.bun/bin/bun"
fi

export PATH="$(dirname "${BUN}"):${PATH}"
export AIONUI_HUB_SKIP="${AIONUI_HUB_SKIP:-1}"
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

if [[ -d "${ELECTRON_CACHE_DIR}" ]]; then
  export ELECTRON_CACHE="${ELECTRON_CACHE_DIR}"
  echo "使用预置 Electron 缓存: ${ELECTRON_CACHE_DIR}"
fi

echo "使用 bun: ${BUN} ($("${BUN}" --version))"
echo "Electron 镜像: ${ELECTRON_MIRROR}"
echo
echo "正在安装 JS 依赖（首次需要网络；不能沿用 Windows 上的 node_modules）..."
bun_install_with_retry

echo
echo "开始打包 macOS 安装包（无公证证书时使用 ad-hoc 签名）..."
"${BUN}" run dist:mac

echo
echo "完成。安装包在: ${ROOT}/out"
if command -v open >/dev/null 2>&1; then
  open "${ROOT}/out"
fi
