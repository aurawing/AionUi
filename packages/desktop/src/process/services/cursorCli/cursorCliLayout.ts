/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';

/** Official install script; its body pins the current CLI build in the download URL. */
export const CURSOR_INSTALL_SCRIPT_URL = 'https://cursor.com/install';
export const CURSOR_DOWNLOAD_BASE_URL = 'https://downloads.cursor.com/lab';
export const CURSOR_ME_URL = 'https://api.cursor.com/v1/me';
export const CURSOR_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'cursor.com',
  'www.cursor.com',
  'downloads.cursor.com',
  'api.cursor.com',
]);

/** Known-good build used when cursor.com/install cannot be reached or parsed. */
export const CURSOR_CLI_FALLBACK_VERSION = '2026.09.26-dd393fe';

export type CursorCliOs = 'darwin' | 'linux' | 'windows';
export type CursorCliArch = 'x64' | 'arm64';
export type CursorCliArchive = 'tar.gz' | 'zip';

export type CursorCliTarget = {
  os: CursorCliOs;
  arch: CursorCliArch;
  archive: CursorCliArchive;
};

export type CursorCliPaths = {
  root: string;
  versionsDir: string;
  downloadsDir: string;
  launcherPath: string;
  manifestPath: string;
};

export type CursorCliManifest = {
  version: string;
  installedAt: number;
};

const OS_BY_PLATFORM: Partial<Record<NodeJS.Platform, CursorCliOs>> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

export const resolveCursorCliTarget = (platform: NodeJS.Platform, arch: string): CursorCliTarget | null => {
  const os = OS_BY_PLATFORM[platform];
  if (!os || (arch !== 'x64' && arch !== 'arm64')) return null;
  return { os, arch, archive: os === 'windows' ? 'zip' : 'tar.gz' };
};

// Versions become path segments and are interpolated into the launcher
// scripts, so only allow characters that are inert in cmd.exe and sh.
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,79}$/;

export const isValidCursorCliVersion = (version: string): boolean =>
  VERSION_PATTERN.test(version) && !version.includes('..');

export const parseCursorCliVersion = (installScript: string): string | null => {
  const version = /downloads\.cursor\.com\/lab\/([^/'"\s]+)\//.exec(installScript)?.[1];
  return version && isValidCursorCliVersion(version) ? version : null;
};

export const buildCursorCliDownloadUrl = (version: string, target: CursorCliTarget): string =>
  `${CURSOR_DOWNLOAD_BASE_URL}/${version}/${target.os}/${target.arch}/agent-cli-package.${target.archive}`;

export const getCursorCliPaths = (root: string, platform: NodeJS.Platform): CursorCliPaths => ({
  root,
  versionsDir: path.join(root, 'versions'),
  downloadsDir: path.join(root, 'downloads'),
  launcherPath: path.join(root, 'bin', platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent'),
  manifestPath: path.join(root, 'current.json'),
});

/** Files that must exist in an extracted version directory for it to be runnable. */
export const getCursorCliRequiredFiles = (platform: NodeJS.Platform): string[] =>
  platform === 'win32' ? ['node.exe', 'index.js'] : ['cursor-agent', 'node', 'index.js'];

/**
 * Stable launcher at `bin/cursor-agent[.cmd]` that forwards to the active
 * version, so the agent `command_override` never changes across updates.
 *
 * On Windows it calls the bundled node.exe directly instead of the package's
 * `cursor-agent.cmd`, which re-launches through PowerShell and breaks on
 * machines with a restrictive execution policy.
 */
export const buildCursorCliLauncher = (version: string, platform: NodeJS.Platform): string => {
  if (!isValidCursorCliVersion(version)) {
    throw new Error(`Invalid Cursor CLI version: ${version}`);
  }
  if (platform === 'win32') {
    const versionDir = `%~dp0..\\versions\\${version}`;
    return [
      '@echo off',
      'setlocal',
      'if not defined CURSOR_INVOKED_AS set "CURSOR_INVOKED_AS=cursor-agent.cmd"',
      'if not defined NODE_COMPILE_CACHE if defined LOCALAPPDATA set "NODE_COMPILE_CACHE=%LOCALAPPDATA%\\cursor-compile-cache"',
      `"${versionDir}\\node.exe" "${versionDir}\\index.js" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n');
  }
  return ['#!/bin/sh', `exec "$(dirname "$0")/../versions/${version}/cursor-agent" "$@"`, ''].join('\n');
};

export const parseCursorCliManifest = (raw: string): CursorCliManifest | null => {
  try {
    const parsed = JSON.parse(raw) as Partial<CursorCliManifest> | null;
    if (!parsed || typeof parsed.version !== 'string' || !isValidCursorCliVersion(parsed.version)) return null;
    const installedAt = typeof parsed.installedAt === 'number' ? parsed.installedAt : 0;
    return { version: parsed.version, installedAt };
  } catch {
    return null;
  }
};
