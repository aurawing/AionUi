/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);
const EXTRACT_TIMEOUT_MS = 10 * 60_000;

/** Mirrors `tar --strip-components=1`: drops the archive's top-level folder (`dist-package/`). */
export const stripFirstComponent = (entryName: string): string | null => {
  const normalized = entryName.replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  if (slash < 0) return null;
  return normalized.slice(slash + 1) || null;
};

export const resolveEntryTarget = (destDir: string, relativeName: string): string => {
  const target = path.resolve(destDir, relativeName);
  const rel = path.relative(destDir, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Unsafe archive entry: ${relativeName}`);
  }
  return target;
};

/** Uses the system tar (always present on macOS and Linux) so file modes survive extraction. */
export const extractTarGz = async (archivePath: string, destDir: string): Promise<void> => {
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir, '--strip-components=1'], {
    timeout: EXTRACT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
};

const openZip = (archivePath: string): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });

const openEntryStream = (zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> =>
  new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });

const writeZipEntry = async (zip: yauzl.ZipFile, entry: yauzl.Entry, destDir: string): Promise<void> => {
  const relativeName = stripFirstComponent(entry.fileName);
  if (!relativeName) return;
  const target = resolveEntryTarget(destDir, relativeName);
  if (relativeName.endsWith('/')) {
    await fs.promises.mkdir(target, { recursive: true });
    return;
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const mode = (entry.externalFileAttributes >>> 16) & 0o777;
  const source = await openEntryStream(zip, entry);
  await pipeline(source, fs.createWriteStream(target, mode ? { mode } : undefined));
};

/** Windows packages are zips; Windows' own tar.exe may be shadowed by Git's GNU tar, so extract in-process. */
export const extractZip = async (archivePath: string, destDir: string): Promise<void> => {
  const zip = await openZip(archivePath);
  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      try {
        zip.close();
      } catch {
        // already closed by yauzl
      }
      reject(err);
    };
    zip.on('error', fail);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      writeZipEntry(zip, entry, destDir).then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
};
