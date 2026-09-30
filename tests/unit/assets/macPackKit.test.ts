import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

const kit = require('../../../scripts/packaging/macPackKit');
const { parseArgs, validateOptions } = require('../../../scripts/packaging/prepare-mac-kit');

describe('mac pack kit mapping', () => {
  it('maps Apple Silicon uname to the bun darwin aarch64 zip', () => {
    expect(kit.bunZipName('arm64')).toBe('bun-darwin-aarch64.zip');
    expect(kit.bunVendorDirName('arm64')).toBe('bun-arm64');
    expect(kit.bunDownloadUrl('1.2.23', 'arm64')).toBe(
      'https://github.com/oven-sh/bun/releases/download/bun-v1.2.23/bun-darwin-aarch64.zip'
    );
  });

  it('maps Intel uname to the bun darwin x64 zip', () => {
    expect(kit.bunZipName('x86_64')).toBe('bun-darwin-x64.zip');
    expect(kit.bunVendorDirName('x86_64')).toBe('bun-x86_64');
  });

  it('rejects an unknown macOS architecture', () => {
    expect(() => kit.bunZipName('riscv64')).toThrow(/Unsupported macOS architecture/);
  });

  it('prefers AIONUI_BUN_VERSION over the local bun version', () => {
    expect(
      kit.resolveBunVersion({
        env: { AIONUI_BUN_VERSION: 'v1.3.0' },
        localVersion: '1.2.23',
        fallback: '1.0.0',
      })
    ).toBe('1.3.0');
  });

  it('throws when no bun version can be resolved', () => {
    expect(() =>
      kit.resolveBunVersion({
        env: {},
        localVersion: '   ',
        fallback: '',
      })
    ).toThrow(/Unable to resolve a bun version/);
  });

  it('strips caret ranges from the Electron version in package.json', () => {
    expect(kit.parseElectronVersion('^37.10.3')).toBe('37.10.3');
    expect(kit.electronZipName('^37.10.3', 'arm64')).toBe('electron-v37.10.3-darwin-arm64.zip');
  });

  it('lists npmmirror then GitHub Electron URLs', () => {
    expect(kit.electronDownloadUrls('37.10.3', 'x64')).toEqual([
      'https://npmmirror.com/mirrors/electron/v37.10.3/electron-v37.10.3-darwin-x64.zip',
      'https://github.com/electron/electron/releases/download/v37.10.3/electron-v37.10.3-darwin-x64.zip',
    ]);
  });

  it('rejects Electron zips for an unknown arch', () => {
    expect(() => kit.electronZipName('37.10.3', 'ia32')).toThrow(/Unsupported Electron architecture/);
  });

  it('places kit files under vendor/mac-pack', () => {
    const paths = kit.kitPaths('/repo');
    expect(paths.vendorRoot).toBe(join('/repo', 'vendor', 'mac-pack'));
    expect(paths.electronCache).toBe(join('/repo', 'vendor', 'mac-pack', 'electron-cache'));
    expect(kit.bunBinaryPath('/repo', 'arm64')).toBe(join('/repo', 'vendor', 'mac-pack', 'bun-arm64', 'bun'));
  });

  it('treats truncated Electron zips as unusable', () => {
    expect(kit.isCompleteElectronZipSize(22_476_026)).toBe(false);
    expect(kit.isCompleteElectronZipSize(kit.MIN_ELECTRON_ZIP_BYTES)).toBe(true);
  });

  it('rejects zip entries that would write outside the extract dir', () => {
    expect(() => kit.assertSafeZipEntry('../evil')).toThrow(/unsafe zip entry/);
    expect(() => kit.assertSafeZipEntry('/tmp/evil')).toThrow(/unsafe zip entry/);
    expect(kit.assertSafeZipEntry('bun-darwin-aarch64/bun')).toBe('bun-darwin-aarch64/bun');
  });

  it('parses prepare-mac-kit flags', () => {
    expect(parseArgs(['--force', '--bun-only'])).toEqual({
      force: true,
      bunOnly: true,
      electronOnly: false,
    });
  });

  it('rejects combining --bun-only and --electron-only', () => {
    expect(() => validateOptions({ force: false, bunOnly: true, electronOnly: true })).toThrow(
      /only one of --bun-only or --electron-only/
    );
  });

  it('prefers AIONUI_PACK_PROXY over generic proxy env vars', () => {
    expect(
      kit.pickPackProxy({
        AIONUI_PACK_PROXY: 'socks5://127.0.0.1:10808',
        HTTPS_PROXY: 'http://127.0.0.1:10809',
      })
    ).toBe('socks5://127.0.0.1:10808');
  });

  it('returns empty when no pack proxy is configured', () => {
    expect(kit.pickPackProxy({})).toBe('');
    expect(kit.packProxyEnv('')).toEqual({});
  });

  it('exports bun/curl/electron proxy variables from one URL', () => {
    expect(kit.packProxyEnv('socks5://127.0.0.1:10808')).toMatchObject({
      ALL_PROXY: 'socks5://127.0.0.1:10808',
      HTTPS_PROXY: 'socks5://127.0.0.1:10808',
      ELECTRON_GET_USE_PROXY: 'true',
      GLOBAL_AGENT_HTTPS_PROXY: 'socks5://127.0.0.1:10808',
    });
  });

  it('strips the Developer ID Application prefix from CSC_NAME', () => {
    expect(kit.stripCscNamePrefix('Developer ID Application: Tianjin Shuyuan Technology Co.,Ltd. (4295LWG5D8)')).toBe(
      'Tianjin Shuyuan Technology Co.,Ltd. (4295LWG5D8)'
    );
  });

  it('leaves CSC_NAME unchanged when it has no certificate-type prefix', () => {
    expect(kit.stripCscNamePrefix('Tianjin Shuyuan Technology Co.,Ltd. (4295LWG5D8)')).toBe(
      'Tianjin Shuyuan Technology Co.,Ltd. (4295LWG5D8)'
    );
  });

  it('flags HTTP URLs that point at the usual SOCKS port', () => {
    expect(kit.looksLikeHttpOnSocksPort('http://192.168.3.7:10808')).toBe(true);
    expect(kit.looksLikeHttpOnSocksPort('socks5://192.168.3.7:10808')).toBe(false);
    expect(kit.looksLikeHttpOnSocksPort('http://192.168.3.7:10809')).toBe(false);
  });
});
