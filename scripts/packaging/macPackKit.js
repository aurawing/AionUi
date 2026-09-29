/**
 * Mac packaging kit helpers (pure mapping + zip safety).
 * Used by prepare-mac-kit.js and unit tests.
 */

const DEFAULT_BUN_VERSION = '1.2.23';

const BUN_TARGETS = {
  arm64: {
    unameM: 'arm64',
    zipName: 'bun-darwin-aarch64.zip',
    vendorDir: 'bun-arm64',
  },
  x86_64: {
    unameM: 'x86_64',
    zipName: 'bun-darwin-x64.zip',
    vendorDir: 'bun-x86_64',
  },
};

const ELECTRON_ARCHS = ['arm64', 'x64'];
const MIN_ELECTRON_ZIP_BYTES = 40 * 1024 * 1024;

function stripVersionPrefix(value) {
  return String(value || '')
    .trim()
    .replace(/^bun-v/i, '')
    .replace(/^v/i, '')
    .replace(/^[\^~>=<\s]+/, '');
}

function resolveBunVersion({ env = {}, localVersion = '', fallback = DEFAULT_BUN_VERSION } = {}) {
  const fromEnv = stripVersionPrefix(env.AIONUI_BUN_VERSION);
  if (fromEnv) return fromEnv;
  const fromLocal = stripVersionPrefix(localVersion);
  if (fromLocal) return fromLocal;
  const fromFallback = stripVersionPrefix(fallback);
  if (fromFallback) return fromFallback;
  throw new Error('Unable to resolve a bun version for the Mac pack kit.');
}

function parseElectronVersion(raw) {
  const version = stripVersionPrefix(raw);
  if (!version) {
    throw new Error('Unable to parse Electron version from package.json.');
  }
  return version;
}

function bunTarget(unameM) {
  const key = String(unameM || '').trim();
  const target = BUN_TARGETS[key];
  if (!target) {
    throw new Error(`Unsupported macOS architecture: ${unameM || '(empty)'}`);
  }
  return target;
}

function bunZipName(unameM) {
  return bunTarget(unameM).zipName;
}

function bunVendorDirName(unameM) {
  return bunTarget(unameM).vendorDir;
}

function bunDownloadUrl(version, unameM) {
  const bunVersion = stripVersionPrefix(version);
  if (!bunVersion) {
    throw new Error('bun version is required.');
  }
  return `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/${bunZipName(unameM)}`;
}

function electronZipName(version, electronArch) {
  const electronVersion = parseElectronVersion(version);
  if (!ELECTRON_ARCHS.includes(electronArch)) {
    throw new Error(`Unsupported Electron architecture: ${electronArch || '(empty)'}`);
  }
  return `electron-v${electronVersion}-darwin-${electronArch}.zip`;
}

function electronGithubUrl(version, electronArch) {
  const electronVersion = parseElectronVersion(version);
  const zip = electronZipName(electronVersion, electronArch);
  return `https://github.com/electron/electron/releases/download/v${electronVersion}/${zip}`;
}

function electronMirrorUrl(version, electronArch) {
  const electronVersion = parseElectronVersion(version);
  const zip = electronZipName(electronVersion, electronArch);
  return `https://npmmirror.com/mirrors/electron/v${electronVersion}/${zip}`;
}

function electronDownloadUrls(version, electronArch) {
  // npmmirror first: GitHub Electron zips often stall from China.
  return [electronMirrorUrl(version, electronArch), electronGithubUrl(version, electronArch)];
}

function kitPaths(projectRoot) {
  const root = String(projectRoot || '').trim();
  if (!root) {
    throw new Error('projectRoot is required.');
  }
  const vendorRoot = require('path').join(root, 'vendor', 'mac-pack');
  return {
    vendorRoot,
    bunRoot: require('path').join(vendorRoot, 'bun'),
    electronCache: require('path').join(vendorRoot, 'electron-cache'),
    downloads: require('path').join(vendorRoot, 'downloads'),
  };
}

function bunBinaryPath(projectRoot, unameM) {
  const path = require('path');
  return path.join(kitPaths(projectRoot).vendorRoot, bunVendorDirName(unameM), 'bun');
}

function isCompleteElectronZipSize(bytes) {
  return Number(bytes) >= MIN_ELECTRON_ZIP_BYTES;
}

const PACK_PROXY_ENV_KEYS = [
  'AIONUI_PACK_PROXY',
  'ALL_PROXY',
  'all_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
];

function pickPackProxy(env = {}) {
  for (const key of PACK_PROXY_ENV_KEYS) {
    const value = String(env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function looksLikeHttpOnSocksPort(proxy) {
  return /^https?:\/\/[^/\s]+:10808(?:\/|$)/i.test(String(proxy || '').trim());
}

function packProxyEnv(proxy) {
  const value = String(proxy || '').trim();
  if (!value) {
    return {};
  }
  return {
    ALL_PROXY: value,
    all_proxy: value,
    HTTPS_PROXY: value,
    https_proxy: value,
    HTTP_PROXY: value,
    http_proxy: value,
    ELECTRON_GET_USE_PROXY: 'true',
    GLOBAL_AGENT_HTTPS_PROXY: value,
    GLOBAL_AGENT_HTTP_PROXY: value,
  };
}

function assertSafeZipEntry(entryName) {
  const name = String(entryName || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || name.includes('..')) {
    throw new Error(`Refusing unsafe zip entry: ${entryName}`);
  }
  return name;
}

module.exports = {
  BUN_TARGETS,
  DEFAULT_BUN_VERSION,
  ELECTRON_ARCHS,
  MIN_ELECTRON_ZIP_BYTES,
  assertSafeZipEntry,
  bunBinaryPath,
  bunDownloadUrl,
  bunTarget,
  bunVendorDirName,
  bunZipName,
  electronDownloadUrls,
  electronGithubUrl,
  electronMirrorUrl,
  electronZipName,
  isCompleteElectronZipSize,
  kitPaths,
  looksLikeHttpOnSocksPort,
  PACK_PROXY_ENV_KEYS,
  packProxyEnv,
  parseElectronVersion,
  pickPackProxy,
  resolveBunVersion,
  stripVersionPrefix,
};
