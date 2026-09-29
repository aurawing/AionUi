#!/usr/bin/env node

/**
 * Prefetch macOS bun + Electron into vendor/mac-pack/ so a Mac can pack
 * without a manual bun/Electron install. JS deps still install via bun.lock
 * on the Mac (Windows node_modules cannot be reused).
 *
 * Usage:
 *   bun run prepare-mac-kit
 *   bun run prepare-mac-kit -- --bun-only
 *   bun run prepare-mac-kit -- --electron-only
 *   bun run prepare-mac-kit -- --force
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const kit = require('./macPackKit');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const USER_AGENT = 'AionUi-mac-pack-kit';

function parseArgs(argv) {
  return {
    force: argv.includes('--force'),
    bunOnly: argv.includes('--bun-only'),
    electronOnly: argv.includes('--electron-only'),
  };
}

function validateOptions(options) {
  if (options.bunOnly && options.electronOnly) {
    throw new Error('Use only one of --bun-only or --electron-only.');
  }
  return options;
}

function detectLocalBunVersion() {
  try {
    return execSync('bun --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const IDLE_TIMEOUT_MS = 60_000;

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function downloadFile(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }
    const request = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).href;
        downloadFile(next, destPath, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`HTTP ${status} for ${url}`));
        return;
      }
      ensureDir(path.dirname(destPath));
      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      let lastLog = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received - lastLog < 8 * 1024 * 1024) return;
        lastLog = received;
        const totalLabel = total > 0 ? formatMb(total) : '?';
        console.log(`  ${formatMb(received)} / ${totalLabel}`);
      });
      const out = fs.createWriteStream(destPath);
      pipeline(response, out)
        .then(() => {
          if (total > 0 && received !== total) {
            reject(new Error(`Incomplete download for ${url}: ${received} of ${total} bytes`));
            return;
          }
          resolve({ received, total });
        })
        .catch(reject);
    });
    request.setTimeout(IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`Idle timeout after ${IDLE_TIMEOUT_MS / 1000}s for ${url}`));
    });
    request.on('error', reject);
  });
}

async function downloadFirstAvailable(urls, destPath) {
  let lastError = null;
  for (const url of urls) {
    try {
      console.log(`Downloading ${url}`);
      await downloadFile(url, destPath);
      return url;
    } catch (error) {
      lastError = error;
      console.warn(`Failed: ${error.message}`);
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { force: true });
      }
    }
  }
  throw lastError || new Error('No download URLs provided.');
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError) {
        reject(openError);
        return;
      }
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        let relative;
        try {
          relative = kit.assertSafeZipEntry(entry.fileName);
        } catch (error) {
          reject(error);
          return;
        }
        const dest = path.join(destDir, relative);
        if (/\/$/.test(relative)) {
          ensureDir(dest);
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamError, readStream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          ensureDir(path.dirname(dest));
          const out = fs.createWriteStream(dest);
          pipeline(readStream, out)
            .then(() => zipfile.readEntry())
            .catch(reject);
        });
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

function findExtractedBun(extractDir) {
  const stack = [extractDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === 'bun') {
        return full;
      }
    }
  }
  throw new Error(`bun binary not found in ${extractDir}`);
}

async function prepareBun({ force, bunVersion, paths }) {
  for (const unameM of Object.keys(kit.BUN_TARGETS)) {
    const destBun = kit.bunBinaryPath(PROJECT_ROOT, unameM);
    if (!force && fs.existsSync(destBun)) {
      console.log(`Skip existing ${path.relative(PROJECT_ROOT, destBun)}`);
      continue;
    }
    const zipPath = path.join(paths.downloads, kit.bunZipName(unameM));
    await downloadFirstAvailable([kit.bunDownloadUrl(bunVersion, unameM)], zipPath);
    const extractDir = path.join(paths.downloads, `extract-${unameM}`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    ensureDir(extractDir);
    await extractZip(zipPath, extractDir);
    const extracted = findExtractedBun(extractDir);
    ensureDir(path.dirname(destBun));
    fs.copyFileSync(extracted, destBun);
    try {
      fs.chmodSync(destBun, 0o755);
    } catch {
      // Windows cannot apply Unix execute bits; pack-mac.sh chmod's on macOS.
    }
    console.log(`Wrote ${path.relative(PROJECT_ROOT, destBun)}`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

async function prepareElectron({ force, electronVersion, paths }) {
  ensureDir(paths.electronCache);
  for (const arch of kit.ELECTRON_ARCHS) {
    const zipName = kit.electronZipName(electronVersion, arch);
    const destPath = path.join(paths.electronCache, zipName);
    const existingSize = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    if (!force && kit.isCompleteElectronZipSize(existingSize)) {
      console.log(`Skip existing ${path.relative(PROJECT_ROOT, destPath)}`);
      continue;
    }
    if (fs.existsSync(destPath)) {
      console.warn(`Removing incomplete ${path.relative(PROJECT_ROOT, destPath)} (${existingSize} bytes)`);
      fs.rmSync(destPath, { force: true });
    }
    await downloadFirstAvailable(kit.electronDownloadUrls(electronVersion, arch), destPath);
    console.log(`Wrote ${path.relative(PROJECT_ROOT, destPath)}`);
  }
}

async function main() {
  const options = validateOptions(parseArgs(process.argv.slice(2)));
  const wantBun = !options.electronOnly;
  const wantElectron = !options.bunOnly;
  const paths = kit.kitPaths(PROJECT_ROOT);
  ensureDir(paths.vendorRoot);
  ensureDir(paths.downloads);

  const bunVersion = kit.resolveBunVersion({
    env: process.env,
    localVersion: detectLocalBunVersion(),
  });
  const electronVersion = kit.parseElectronVersion(require('../../package.json').devDependencies.electron);

  console.log(`Mac pack kit → ${path.relative(PROJECT_ROOT, paths.vendorRoot)}`);
  console.log(`bun ${bunVersion}; Electron ${electronVersion}`);

  if (wantBun) {
    await prepareBun({ force: options.force, bunVersion, paths });
  }
  if (wantElectron) {
    await prepareElectron({ force: options.force, electronVersion, paths });
  }

  console.log('');
  console.log('Done. Copy the whole repo (including vendor/mac-pack) to a Mac,');
  console.log('then double-click scripts/packaging/pack-mac.command');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  validateOptions,
  detectLocalBunVersion,
};
