/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';
import { getDataPath } from '@process/utils/utils';
import path from 'path';
import { extractTarGz, extractZip } from './cursorCliArchive';
import { CursorCliService, type CursorCliServiceDeps } from './cursorCliService';

export { CursorCliService, type CursorCliServiceDeps } from './cursorCliService';

/** Lives under the CLI-safe data dir so the launcher path has no spaces on macOS. */
export const getCursorCliRootDir = (): string => path.join(getDataPath(), 'managed-cli', 'cursor-agent');

export const createCursorCliService = (
  options: Pick<CursorCliServiceDeps, 'onProgress' | 'logger'> = {}
): CursorCliService =>
  new CursorCliService({
    rootDir: getCursorCliRootDir(),
    platform: process.platform,
    arch: process.arch,
    // Chromium networking honours the system proxy and certificate store.
    fetch: (url, init) => getPlatformServices().network.fetch(url, init),
    extractTarGz,
    extractZip,
    ...options,
  });
