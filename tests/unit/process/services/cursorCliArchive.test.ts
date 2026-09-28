/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractTarGz,
  extractZip,
  resolveEntryTarget,
  stripFirstComponent,
} from '@process/services/cursorCli/cursorCliArchive';

const tempDirs: string[] = [];
const makeTempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aionui-cursor-archive-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Minimal stored (uncompressed) zip writer; enough for yauzl to read. */
const buildZip = (entries: Array<{ name: string; content?: string }>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content ?? '', 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
};

describe('stripFirstComponent', () => {
  it('drops the top-level package folder like tar --strip-components=1', () => {
    expect(stripFirstComponent('dist-package/index.js')).toBe('index.js');
    expect(stripFirstComponent('dist-package\\node_modules\\a.js')).toBe('node_modules/a.js');
    expect(stripFirstComponent('dist-package/sub/')).toBe('sub/');
  });

  it('skips the folder itself and loose root files', () => {
    expect(stripFirstComponent('dist-package/')).toBeNull();
    expect(stripFirstComponent('README.txt')).toBeNull();
  });
});

describe('resolveEntryTarget', () => {
  it('resolves entries inside the destination', () => {
    const dest = makeTempDir();
    expect(resolveEntryTarget(dest, 'a/b.js')).toBe(path.join(dest, 'a', 'b.js'));
  });

  it('rejects entries that escape the destination', () => {
    const dest = makeTempDir();
    expect(() => resolveEntryTarget(dest, '../evil.txt')).toThrow(/Unsafe archive entry/);
    expect(() => resolveEntryTarget(dest, 'a/../../evil.txt')).toThrow(/Unsafe archive entry/);
  });
});

describe('extractZip', () => {
  it('extracts the package contents without the top-level folder', async () => {
    const dir = makeTempDir();
    const zipPath = path.join(dir, 'pkg.zip');
    writeFileSync(
      zipPath,
      buildZip([
        { name: 'dist-package/' },
        { name: 'dist-package/index.js', content: 'console.log(1)' },
        { name: 'dist-package/node_modules/dep/index.js', content: 'module.exports = 2' },
        { name: 'loose.txt', content: 'ignored' },
      ])
    );
    const dest = path.join(dir, 'out');
    mkdirSync(dest);

    await extractZip(zipPath, dest);

    expect(readFileSync(path.join(dest, 'index.js'), 'utf8')).toBe('console.log(1)');
    expect(readFileSync(path.join(dest, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 2');
    expect(existsSync(path.join(dest, 'loose.txt'))).toBe(false);
  });

  it('rejects path-traversal entries without writing outside the destination', async () => {
    const dir = makeTempDir();
    const zipPath = path.join(dir, 'evil.zip');
    writeFileSync(zipPath, buildZip([{ name: 'dist-package/../../escaped.txt', content: 'pwned' }]));
    const dest = path.join(dir, 'out');
    mkdirSync(dest);

    await expect(extractZip(zipPath, dest)).rejects.toThrow();
    expect(existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
  });

  it('rejects a file that is not a zip', async () => {
    const dir = makeTempDir();
    const zipPath = path.join(dir, 'broken.zip');
    writeFileSync(zipPath, 'not a zip');
    await expect(extractZip(zipPath, dir)).rejects.toThrow();
  });
});

describe.skipIf(process.platform === 'win32')('extractTarGz', () => {
  it('extracts with the system tar and keeps executable bits', async () => {
    const dir = makeTempDir();
    const src = path.join(dir, 'dist-package');
    mkdirSync(src);
    writeFileSync(path.join(src, 'cursor-agent'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
    const archive = path.join(dir, 'pkg.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, 'dist-package']);
    const dest = path.join(dir, 'out');
    mkdirSync(dest);

    await extractTarGz(archive, dest);

    const extracted = path.join(dest, 'cursor-agent');
    expect(readFileSync(extracted, 'utf8')).toContain('echo hi');
    expect(execFileSync(extracted).toString().trim()).toBe('hi');
  });

  it('rejects a corrupt archive', async () => {
    const dir = makeTempDir();
    const archive = path.join(dir, 'broken.tar.gz');
    writeFileSync(archive, 'not a tarball');
    await expect(extractTarGz(archive, dir)).rejects.toThrow();
  });
});
