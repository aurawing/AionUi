/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCursorCliDownloadUrl,
  buildCursorCliLauncher,
  getCursorCliPaths,
  isValidCursorCliVersion,
  parseCursorCliManifest,
  parseCursorCliVersion,
  resolveCursorCliTarget,
} from '@process/services/cursorCli/cursorCliLayout';

const INSTALL_SCRIPT_SNIPPET = [
  'ARCH="$(uname -m)"',
  'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.09.26-dd393fe/${OS}/${ARCH}/agent-cli-package.tar.gz"',
].join('\n');

describe('resolveCursorCliTarget', () => {
  it('maps supported platforms to Cursor download segments and archive types', () => {
    expect(resolveCursorCliTarget('darwin', 'arm64')).toEqual({ os: 'darwin', arch: 'arm64', archive: 'tar.gz' });
    expect(resolveCursorCliTarget('linux', 'x64')).toEqual({ os: 'linux', arch: 'x64', archive: 'tar.gz' });
    expect(resolveCursorCliTarget('win32', 'x64')).toEqual({ os: 'windows', arch: 'x64', archive: 'zip' });
    expect(resolveCursorCliTarget('win32', 'arm64')).toEqual({ os: 'windows', arch: 'arm64', archive: 'zip' });
  });

  it('returns null for platforms and CPU architectures Cursor does not ship', () => {
    expect(resolveCursorCliTarget('linux', 'ia32')).toBeNull();
    expect(resolveCursorCliTarget('freebsd', 'x64')).toBeNull();
  });
});

describe('parseCursorCliVersion', () => {
  it('extracts the pinned build from the official install script', () => {
    expect(parseCursorCliVersion(INSTALL_SCRIPT_SNIPPET)).toBe('2026.09.26-dd393fe');
  });

  it('returns null when the script has no download URL or the version is unsafe', () => {
    expect(parseCursorCliVersion('#!/bin/sh\necho hello')).toBeNull();
    expect(parseCursorCliVersion('https://downloads.cursor.com/lab/1.0&calc/linux')).toBeNull();
    expect(parseCursorCliVersion('https://downloads.cursor.com/lab/../linux')).toBeNull();
  });
});

describe('isValidCursorCliVersion', () => {
  it('accepts both historical Cursor version formats', () => {
    expect(isValidCursorCliVersion('2026.09.26-dd393fe')).toBe(true);
    expect(isValidCursorCliVersion('2026.9.3-12-30-45-abc123')).toBe(true);
  });

  it('rejects characters that are meaningful to cmd.exe, sh or paths', () => {
    for (const bad of ['', '..', 'a/b', 'a\\b', '1.0 beta', '1%PATH%', '1"x', '-rf', 'v1..2']) {
      expect(isValidCursorCliVersion(bad)).toBe(false);
    }
  });
});

describe('buildCursorCliDownloadUrl', () => {
  it('builds the per-platform package URL', () => {
    expect(buildCursorCliDownloadUrl('2026.09.26-dd393fe', { os: 'windows', arch: 'x64', archive: 'zip' })).toBe(
      'https://downloads.cursor.com/lab/2026.09.26-dd393fe/windows/x64/agent-cli-package.zip'
    );
  });
});

describe('getCursorCliPaths', () => {
  const root = path.join(tmpdir(), 'managed-cli', 'cursor-agent');

  it('uses a .cmd launcher on win32 so aioncore spawns it through cmd.exe', () => {
    const paths = getCursorCliPaths(root, 'win32');
    expect(paths.launcherPath).toBe(path.join(root, 'bin', 'cursor-agent.cmd'));
    expect(paths.versionsDir).toBe(path.join(root, 'versions'));
  });

  it('uses an extensionless launcher on macOS and Linux', () => {
    const paths = getCursorCliPaths(root, 'darwin');
    expect(paths.launcherPath).toBe(path.join(root, 'bin', 'cursor-agent'));
    expect(paths.manifestPath).toBe(path.join(root, 'current.json'));
  });
});

describe('buildCursorCliLauncher', () => {
  it('runs the bundled node.exe directly on Windows instead of going through PowerShell', () => {
    const script = buildCursorCliLauncher('2026.09.26-dd393fe', 'win32');
    expect(script).toContain(
      '"%~dp0..\\versions\\2026.09.26-dd393fe\\node.exe" "%~dp0..\\versions\\2026.09.26-dd393fe\\index.js" %*'
    );
    expect(script).not.toMatch(/powershell/i);
    expect(script.split('\r\n')[0]).toBe('@echo off');
  });

  it('execs the versioned launcher relative to its own location on Unix', () => {
    const script = buildCursorCliLauncher('2026.09.26-dd393fe', 'linux');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('exec "$(dirname "$0")/../versions/2026.09.26-dd393fe/cursor-agent" "$@"');
  });

  it('refuses to interpolate an unsafe version into a script', () => {
    expect(() => buildCursorCliLauncher('1 & del *', 'win32')).toThrow(/Invalid Cursor CLI version/);
  });
});

describe('parseCursorCliManifest', () => {
  it('reads a valid manifest', () => {
    expect(parseCursorCliManifest('{"version":"2026.09.26-dd393fe","installedAt":42}')).toEqual({
      version: '2026.09.26-dd393fe',
      installedAt: 42,
    });
  });

  it('returns null for corrupt JSON or an unsafe version', () => {
    expect(parseCursorCliManifest('{not json')).toBeNull();
    expect(parseCursorCliManifest('{"version":"../../etc"}')).toBeNull();
    expect(parseCursorCliManifest('null')).toBeNull();
  });
});
