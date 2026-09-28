/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Managed Cursor CLI bridge: lets the Agent settings page install / update the
 * official `cursor-agent` package into the AionUi data dir and verify a Cursor
 * API key, so the builtin Cursor agent works without a separate install.
 */

import { ipcBridge } from '@/common';
import type { CursorCliInstallRequest } from '@/common/types/agent/cursorCli';
import log from 'electron-log';
import { createCursorCliService, type CursorCliService } from '../services/cursorCli';

const toMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function initCursorCliBridge(service?: CursorCliService): void {
  let cached = service ?? null;
  const getService = (): CursorCliService => {
    cached ??= createCursorCliService({
      onProgress: (event) => ipcBridge.cursorCli.installProgress.emit(event),
      logger: log,
    });
    return cached;
  };

  ipcBridge.cursorCli.getStatus.provider(async () => {
    try {
      return { success: true, data: await getService().getStatus() };
    } catch (err) {
      return { success: false, msg: toMessage(err) };
    }
  });

  ipcBridge.cursorCli.install.provider(async (request: CursorCliInstallRequest) => {
    try {
      return { success: true, data: await getService().install(request ?? {}) };
    } catch (err) {
      log.warn('[cursor-cli] Install failed:', toMessage(err));
      return { success: false, msg: toMessage(err) };
    }
  });

  ipcBridge.cursorCli.verifyApiKey.provider(async (request) => {
    try {
      return { success: true, data: await getService().verifyApiKey(request?.apiKey ?? '') };
    } catch (err) {
      return { success: false, msg: toMessage(err) };
    }
  });
}
