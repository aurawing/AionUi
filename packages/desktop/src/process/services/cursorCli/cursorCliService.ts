/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CursorApiKeyVerifyResult,
  CursorCliInstallProgressEvent,
  CursorCliInstallRequest,
  CursorCliInstallResult,
  CursorCliStatus,
} from '@/common/types/agent/cursorCli';
import { once } from 'events';
import fs from 'fs';
import path from 'path';
import {
  buildCursorCliDownloadUrl,
  buildCursorCliLauncher,
  CURSOR_ALLOWED_HOSTS,
  CURSOR_CLI_FALLBACK_VERSION,
  CURSOR_INSTALL_SCRIPT_URL,
  CURSOR_ME_URL,
  getCursorCliPaths,
  getCursorCliRequiredFiles,
  parseCursorCliManifest,
  parseCursorCliVersion,
  resolveCursorCliTarget,
  type CursorCliManifest,
  type CursorCliPaths,
  type CursorCliTarget,
} from './cursorCliLayout';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type CursorCliServiceDeps = {
  rootDir: string;
  platform: NodeJS.Platform;
  arch: string;
  fetch: FetchLike;
  extractTarGz: (archivePath: string, destDir: string) => Promise<void>;
  extractZip: (archivePath: string, destDir: string) => Promise<void>;
  onProgress?: (event: CursorCliInstallProgressEvent) => void;
  now?: () => number;
  logger?: Pick<Console, 'info' | 'warn'>;
};

type FetchAllowedOptions = {
  headers?: Record<string, string>;
  /** Time allowed until response headers arrive. */
  timeoutMs: number;
  signal?: AbortSignal;
};

const USER_AGENT = 'AionUi';
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_CONNECT_TIMEOUT_MS = 60_000;
/** Abort a download that has received no bytes for this long; slow links are fine, dead ones are not. */
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;
const PROGRESS_THROTTLE_MS = 250;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
};

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/**
 * Owns the AionUi-managed copy of the official Cursor CLI:
 *
 *   <root>/versions/<version>/   extracted `agent-cli-package`
 *   <root>/bin/cursor-agent[.cmd] stable launcher → active version
 *   <root>/current.json           active version manifest
 */
export class CursorCliService {
  readonly paths: CursorCliPaths;
  private readonly target: CursorCliTarget | null;
  private inflight: Promise<CursorCliInstallResult> | null = null;

  constructor(private readonly deps: CursorCliServiceDeps) {
    this.paths = getCursorCliPaths(deps.rootDir, deps.platform);
    this.target = resolveCursorCliTarget(deps.platform, deps.arch);
  }

  async getStatus(): Promise<CursorCliStatus> {
    const manifest = await this.readInstalledManifest();
    return {
      supported: this.target !== null,
      installed: manifest !== null,
      version: manifest?.version,
      installedAt: manifest?.installedAt || undefined,
      launcherPath: this.paths.launcherPath,
      installing: this.inflight !== null,
    };
  }

  /** Concurrent callers share one install; the settings page may retry while a download is running. */
  install(request: CursorCliInstallRequest = {}): Promise<CursorCliInstallResult> {
    if (!this.inflight) {
      this.inflight = this.runInstall(request).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  async resolveLatestVersion(): Promise<string | null> {
    try {
      const res = await this.fetchAllowed(CURSOR_INSTALL_SCRIPT_URL, { timeoutMs: REQUEST_TIMEOUT_MS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const version = parseCursorCliVersion(await res.text());
      if (!version) throw new Error('version not found in install script');
      return version;
    } catch (err) {
      this.deps.logger?.warn('[cursor-cli] Failed to resolve latest version:', errorMessage(err));
      return null;
    }
  }

  async verifyApiKey(apiKey: string): Promise<CursorApiKeyVerifyResult> {
    const key = apiKey.trim();
    if (!key) return { status: 'invalid' };
    try {
      const res = await this.fetchAllowed(CURSOR_ME_URL, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      if (res.status === 401 || res.status === 403) {
        return { status: 'invalid', message: await this.readErrorMessage(res) };
      }
      if (!res.ok) return { status: 'unreachable', message: `HTTP ${res.status}` };
      const body = (await res.json()) as unknown;
      const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const name = [readString(record, 'userFirstName'), readString(record, 'userLastName')].filter(Boolean).join(' ');
      return {
        status: 'valid',
        email: readString(record, 'userEmail'),
        name: name || undefined,
        apiKeyName: readString(record, 'apiKeyName'),
      };
    } catch (err) {
      return { status: 'unreachable', message: errorMessage(err) };
    }
  }

  private async runInstall(request: CursorCliInstallRequest): Promise<CursorCliInstallResult> {
    const target = this.target;
    if (!target) {
      throw new Error(`Cursor CLI is not available for ${this.deps.platform}/${this.deps.arch}`);
    }

    this.emit({ phase: 'resolving' });
    const installed = await this.readInstalledManifest();
    const latest = await this.resolveLatestVersion();

    if (installed && !request.reinstall && (!latest || latest === installed.version)) {
      await this.writeLauncher(installed.version);
      this.emit({ phase: 'done', version: installed.version });
      return { version: installed.version, launcherPath: this.paths.launcherPath, updated: false };
    }

    const version = latest ?? CURSOR_CLI_FALLBACK_VERSION;
    const archivePath = path.join(this.paths.downloadsDir, `cursor-agent-${version}.${target.archive}`);
    const stagingDir = path.join(this.paths.versionsDir, `.staging-${version}-${this.now()}`);

    try {
      await fs.promises.mkdir(this.paths.downloadsDir, { recursive: true });
      await this.download(buildCursorCliDownloadUrl(version, target), archivePath, version);

      this.emit({ phase: 'extracting', version });
      await fs.promises.mkdir(stagingDir, { recursive: true });
      const extract = target.archive === 'zip' ? this.deps.extractZip : this.deps.extractTarGz;
      await extract(archivePath, stagingDir);
      await this.assertRunnable(stagingDir);

      const versionDir = path.join(this.paths.versionsDir, version);
      await fs.promises.rm(versionDir, { recursive: true, force: true });
      await fs.promises.rename(stagingDir, versionDir);

      await this.writeLauncher(version);
      const manifest: CursorCliManifest = { version, installedAt: this.now() };
      await fs.promises.writeFile(this.paths.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      await this.removeStaleVersions(version);
      this.emit({ phase: 'done', version });
      this.deps.logger?.info('[cursor-cli] Installed version', version);
      return { version, launcherPath: this.paths.launcherPath, updated: true };
    } catch (err) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      this.emit({ phase: 'error', version, message: errorMessage(err) });
      throw err;
    } finally {
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
    }
  }

  private async download(url: string, archivePath: string, version: string): Promise<void> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
        void reader?.cancel().catch(() => {});
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    };

    try {
      const res = await this.fetchAllowed(url, { timeoutMs: DOWNLOAD_CONNECT_TIMEOUT_MS, signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }
      reader = res.body.getReader();
      armStallTimer();
      await this.writeBody(res, reader, archivePath, version, armStallTimer);
    } catch (err) {
      if (stalled) throw new Error('Download stalled: no data received for 60 seconds', { cause: err });
      throw err;
    } finally {
      clearTimeout(stallTimer);
    }
  }

  private async writeBody(
    res: Response,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    archivePath: string,
    version: string,
    onChunk: () => void
  ): Promise<void> {
    const contentLength = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;
    let receivedBytes = 0;
    let lastEmitAt = 0;
    const emitDownloading = (force: boolean) => {
      const now = this.now();
      if (!force && now - lastEmitAt < PROGRESS_THROTTLE_MS) return;
      lastEmitAt = now;
      this.emit({
        phase: 'downloading',
        version,
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined,
      });
    };

    emitDownloading(true);
    const file = fs.createWriteStream(archivePath);
    const fileClosed = new Promise<void>((resolve, reject) => {
      file.on('close', resolve);
      file.on('error', reject);
    });
    fileClosed.catch(() => {});
    try {
      // Chunks must be read and written strictly in order.
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        onChunk();
        receivedBytes += value.byteLength;
        if (!file.write(Buffer.from(value))) {
          // eslint-disable-next-line no-await-in-loop
          await once(file, 'drain');
        }
        emitDownloading(false);
      }
    } finally {
      file.end();
      await fileClosed;
    }

    if (totalBytes && receivedBytes !== totalBytes) {
      throw new Error(`Download incomplete: received ${receivedBytes} of ${totalBytes} bytes`);
    }
    emitDownloading(true);
  }

  /** Follows redirects, then refuses to consume a response served from outside Cursor's own hosts. */
  private async fetchAllowed(url: string, options: FetchAllowedOptions): Promise<Response> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, options.timeoutMs);
    try {
      const res = await this.deps.fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        signal: controller.signal,
      });
      const finalHost = new URL(res.url || url).hostname;
      if (!CURSOR_ALLOWED_HOSTS.has(finalHost)) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`Refusing response from unexpected host: ${finalHost}`);
      }
      return res;
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`Request timed out: ${url}`, { cause: err });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readErrorMessage(res: Response): Promise<string | undefined> {
    try {
      const body = (await res.json()) as unknown;
      if (body && typeof body === 'object') return readString(body as Record<string, unknown>, 'message');
    } catch {
      // non-JSON error body
    }
    return undefined;
  }

  private async readInstalledManifest(): Promise<CursorCliManifest | null> {
    let manifest: CursorCliManifest | null;
    try {
      manifest = parseCursorCliManifest(await fs.promises.readFile(this.paths.manifestPath, 'utf8'));
    } catch {
      return null;
    }
    if (!manifest) return null;
    const versionDir = path.join(this.paths.versionsDir, manifest.version);
    const runnable = await Promise.all(
      getCursorCliRequiredFiles(this.deps.platform).map((file) => pathExists(path.join(versionDir, file)))
    );
    return runnable.every(Boolean) ? manifest : null;
  }

  private async assertRunnable(versionDir: string): Promise<void> {
    const files = getCursorCliRequiredFiles(this.deps.platform);
    const present = await Promise.all(files.map((file) => pathExists(path.join(versionDir, file))));
    const missing = files.filter((_, index) => !present[index]);
    if (missing.length > 0) {
      throw new Error(`Cursor CLI package is missing ${missing.join(', ')}`);
    }
  }

  private async writeLauncher(version: string): Promise<void> {
    const launcher = this.paths.launcherPath;
    await fs.promises.mkdir(path.dirname(launcher), { recursive: true });
    const content = buildCursorCliLauncher(version, this.deps.platform);
    const tempPath = `${launcher}.${this.now()}.tmp`;
    await fs.promises.writeFile(tempPath, content, { mode: 0o755 });
    try {
      await fs.promises.rename(tempPath, launcher);
    } catch {
      // Windows refuses to replace a .cmd that a running agent's cmd.exe holds open.
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      await fs.promises.writeFile(launcher, content, { mode: 0o755 });
    }
  }

  /** Best effort: a running agent keeps its old version's files locked on Windows. */
  private async removeStaleVersions(activeVersion: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.paths.versionsDir);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((name) => name !== activeVersion)
        .map((name) =>
          fs.promises.rm(path.join(this.paths.versionsDir, name), { recursive: true, force: true }).catch((err) => {
            this.deps.logger?.warn('[cursor-cli] Could not remove old version', name, errorMessage(err));
          })
        )
    );
  }

  private emit(event: CursorCliInstallProgressEvent): void {
    this.deps.onProgress?.(event);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
