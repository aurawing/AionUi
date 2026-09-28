/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CursorCliInstallProgressEvent } from '@/common/types/agent/cursorCli';
import { CursorCliService, type CursorCliServiceDeps } from '@process/services/cursorCli/cursorCliService';
import { CURSOR_CLI_FALLBACK_VERSION } from '@process/services/cursorCli/cursorCliLayout';

const LATEST = '2026.10.01-abc1234';
const PACKAGE_BYTES = Buffer.alloc(4096, 7);

const tempDirs: string[] = [];
const makeRoot = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aionui-cursor-cli-'));
  tempDirs.push(dir);
  return path.join(dir, 'cursor-agent');
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const installScript = (version: string) =>
  `DOWNLOAD_URL="https://downloads.cursor.com/lab/${version}/\${OS}/\${ARCH}/agent-cli-package.tar.gz"`;

const withUrl = (res: Response, url: string): Response => {
  Object.defineProperty(res, 'url', { value: url });
  return res;
};

type FetchPlan = {
  script?: () => Response;
  archive?: () => Response;
  me?: () => Response;
};

const makeFetch = (plan: FetchPlan = {}) =>
  vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url === 'https://cursor.com/install') {
      return withUrl(plan.script?.() ?? new Response(installScript(LATEST)), url);
    }
    if (url.startsWith('https://downloads.cursor.com/lab/')) {
      return withUrl(
        plan.archive?.() ??
          new Response(PACKAGE_BYTES, { headers: { 'content-length': String(PACKAGE_BYTES.length) } }),
        url
      );
    }
    if (url === 'https://api.cursor.com/v1/me') {
      return withUrl(plan.me?.() ?? new Response('{}'), url);
    }
    throw new Error(`unexpected fetch ${url}`);
  });

const writeFakePackage = async (_archive: string, dest: string) => {
  for (const file of ['cursor-agent', 'node', 'index.js']) writeFileSync(path.join(dest, file), file);
};

const createService = (overrides: Partial<CursorCliServiceDeps> = {}) => {
  const events: CursorCliInstallProgressEvent[] = [];
  const fetch = overrides.fetch ?? makeFetch();
  const extractTarGz = overrides.extractTarGz ?? vi.fn(writeFakePackage);
  const service = new CursorCliService({
    rootDir: makeRoot(),
    platform: 'linux',
    arch: 'x64',
    fetch,
    extractTarGz,
    extractZip: vi.fn(writeFakePackage),
    onProgress: (event) => events.push(event),
    ...overrides,
  });
  return { service, events, fetch, extractTarGz };
};

const seedInstalledVersion = (service: CursorCliService, version: string) => {
  const versionDir = path.join(service.paths.versionsDir, version);
  mkdirSync(versionDir, { recursive: true });
  for (const file of ['cursor-agent', 'node', 'index.js']) writeFileSync(path.join(versionDir, file), file);
  writeFileSync(service.paths.manifestPath, JSON.stringify({ version, installedAt: 1 }));
};

describe('CursorCliService.install', () => {
  it('downloads the latest build, activates it behind the stable launcher and reports progress', async () => {
    const { service, events, fetch } = createService();

    const result = await service.install();

    expect(result).toEqual({ version: LATEST, launcherPath: service.paths.launcherPath, updated: true });
    expect(fetch).toHaveBeenCalledWith(
      `https://downloads.cursor.com/lab/${LATEST}/linux/x64/agent-cli-package.tar.gz`,
      expect.anything()
    );
    expect(readFileSync(service.paths.launcherPath, 'utf8')).toContain(`/../versions/${LATEST}/cursor-agent`);
    expect(JSON.parse(readFileSync(service.paths.manifestPath, 'utf8')).version).toBe(LATEST);
    expect(readdirSync(service.paths.downloadsDir)).toEqual([]);
    expect(readdirSync(service.paths.versionsDir)).toEqual([LATEST]);

    const phases = events.map((event) => event.phase);
    expect(phases[0]).toBe('resolving');
    expect(phases).toContain('downloading');
    expect(phases.slice(-2)).toEqual(['extracting', 'done']);
    expect(events.find((event) => event.phase === 'downloading' && event.percent === 100)?.totalBytes).toBe(
      PACKAGE_BYTES.length
    );

    await expect(service.getStatus()).resolves.toMatchObject({ supported: true, installed: true, version: LATEST });
  });

  it('shares one in-flight install between concurrent callers', async () => {
    const { service, extractTarGz } = createService();

    const [first, second] = await Promise.all([service.install(), service.install()]);

    expect(first).toBe(second);
    expect(extractTarGz).toHaveBeenCalledTimes(1);
  });

  it('skips the download when the latest build is already installed', async () => {
    const { service, extractTarGz } = createService();
    seedInstalledVersion(service, LATEST);

    await expect(service.install()).resolves.toMatchObject({ version: LATEST, updated: false });
    expect(extractTarGz).not.toHaveBeenCalled();
    expect(existsSync(service.paths.launcherPath)).toBe(true);
  });

  it('keeps the installed build when the latest version cannot be resolved', async () => {
    const fetch = makeFetch({ script: () => new Response('down', { status: 503 }) });
    const { service, extractTarGz } = createService({ fetch });
    seedInstalledVersion(service, '2026.01.01-old0001');

    await expect(service.install()).resolves.toMatchObject({ version: '2026.01.01-old0001', updated: false });
    expect(extractTarGz).not.toHaveBeenCalled();
  });

  it('falls back to the pinned build on a first install when cursor.com/install is unreachable', async () => {
    const fetch = makeFetch({ script: () => new Response('down', { status: 503 }) });
    const { service } = createService({ fetch });

    await expect(service.install()).resolves.toMatchObject({ version: CURSOR_CLI_FALLBACK_VERSION, updated: true });
  });

  it('replaces an older build and removes it', async () => {
    const { service } = createService();
    seedInstalledVersion(service, '2026.01.01-old0001');

    await service.install();

    expect(readdirSync(service.paths.versionsDir)).toEqual([LATEST]);
  });

  it('fails without activating anything when the download is rejected', async () => {
    const fetch = makeFetch({ archive: () => new Response('missing', { status: 404 }) });
    const { service, events } = createService({ fetch });

    await expect(service.install()).rejects.toThrow('Download failed: HTTP 404');
    expect(events.at(-1)).toMatchObject({ phase: 'error', message: 'Download failed: HTTP 404' });
    expect(existsSync(service.paths.launcherPath)).toBe(false);
    await expect(service.getStatus()).resolves.toMatchObject({ installed: false, installing: false });
  });

  it('refuses a download that was redirected to a non-Cursor host', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === 'https://cursor.com/install'
        ? withUrl(new Response(installScript(LATEST)), url)
        : withUrl(new Response(PACKAGE_BYTES), 'https://evil.example.com/pkg.tar.gz')
    );
    const { service } = createService({ fetch });

    await expect(service.install()).rejects.toThrow(/unexpected host: evil\.example\.com/);
  });

  it('rejects a truncated download', async () => {
    const fetch = makeFetch({
      archive: () => new Response(PACKAGE_BYTES, { headers: { 'content-length': String(PACKAGE_BYTES.length * 2) } }),
    });
    const { service } = createService({ fetch });

    await expect(service.install()).rejects.toThrow(/Download incomplete/);
  });

  it('rejects a package that is missing the runtime and cleans up the staging dir', async () => {
    const extractTarGz = vi.fn(async (_archive: string, dest: string) => {
      writeFileSync(path.join(dest, 'index.js'), '');
    });
    const { service } = createService({ extractTarGz });

    await expect(service.install()).rejects.toThrow('Cursor CLI package is missing cursor-agent, node');
    expect(readdirSync(service.paths.versionsDir)).toEqual([]);
  });

  it('rejects unsupported platforms up front', async () => {
    const { service, fetch } = createService({ arch: 'ia32' });

    await expect(service.install()).rejects.toThrow(/not available for linux\/ia32/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(service.getStatus()).resolves.toMatchObject({ supported: false, installed: false });
  });

  it('writes a Windows .cmd launcher that targets node.exe', async () => {
    const extractZip = vi.fn(async (_archive: string, dest: string) => {
      for (const file of ['node.exe', 'index.js']) writeFileSync(path.join(dest, file), file);
    });
    const { service } = createService({ platform: 'win32', extractZip });

    await service.install();

    expect(extractZip).toHaveBeenCalledTimes(1);
    expect(service.paths.launcherPath.endsWith('cursor-agent.cmd')).toBe(true);
    expect(readFileSync(service.paths.launcherPath, 'utf8')).toContain(`\\versions\\${LATEST}\\node.exe`);
  });
});

describe('CursorCliService.getStatus', () => {
  it('treats a manifest whose version directory was deleted as not installed', async () => {
    const { service } = createService();
    seedInstalledVersion(service, LATEST);
    rmSync(path.join(service.paths.versionsDir, LATEST), { recursive: true });

    await expect(service.getStatus()).resolves.toMatchObject({ installed: false, version: undefined });
  });
});

describe('CursorCliService.verifyApiKey', () => {
  it('returns the account behind a valid key and sends it as a bearer token', async () => {
    const fetch = makeFetch({
      me: () =>
        Response.json({
          apiKeyName: 'Team laptop',
          userEmail: 'dev@example.com',
          userFirstName: 'Ada',
          userLastName: 'Lovelace',
        }),
    });
    const { service } = createService({ fetch });

    await expect(service.verifyApiKey('  key_abc  ')).resolves.toEqual({
      status: 'valid',
      email: 'dev@example.com',
      name: 'Ada Lovelace',
      apiKeyName: 'Team laptop',
    });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key_abc');
  });

  it('reports a rejected key as invalid with the server message', async () => {
    const fetch = makeFetch({
      me: () => Response.json({ code: 'error', message: 'Invalid User API Key' }, { status: 401 }),
    });
    const { service } = createService({ fetch });

    await expect(service.verifyApiKey('key_bad')).resolves.toEqual({
      status: 'invalid',
      message: 'Invalid User API Key',
    });
  });

  it('reports server errors and network failures as unreachable', async () => {
    const serverError = createService({ fetch: makeFetch({ me: () => new Response('oops', { status: 502 }) }) });
    await expect(serverError.service.verifyApiKey('key_abc')).resolves.toEqual({
      status: 'unreachable',
      message: 'HTTP 502',
    });

    const offline = createService({ fetch: vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')) });
    await expect(offline.service.verifyApiKey('key_abc')).resolves.toEqual({
      status: 'unreachable',
      message: 'getaddrinfo ENOTFOUND',
    });
  });

  it('rejects an empty key without calling Cursor', async () => {
    const { service, fetch } = createService();

    await expect(service.verifyApiKey('   ')).resolves.toEqual({ status: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
