/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cursor ACP only advertises agent/plan/ask. Shell still asks for approval in
 * Agent mode. AionUi adds a client-side YOLO option that keeps the ACP session
 * on `agent` (so tools still run) and auto-confirms permission cards.
 */

import { CURSOR_AGENT_BACKEND } from './cursorCli';

type CursorModeOption = {
  value: string;
  label: string;
  description?: string;
};

const STORAGE_KEY = 'aionui.cursor.yoloMode';
const CHANGE_EVENT = 'aionui-cursor-yolo-mode';

/** Synthetic permission id shown in the AionUi mode picker. */
export const CURSOR_YOLO_MODE_ID = 'yolo';

/** Cursor ACP mode that still has tool/shell access. */
export const CURSOR_ACP_EXEC_MODE_ID = 'agent';

export const isCursorBackend = (backend: string | undefined): boolean => backend === CURSOR_AGENT_BACKEND;

export const isCursorYoloMode = (mode: string | null | undefined): boolean => mode === CURSOR_YOLO_MODE_ID;

export const readCursorYoloMode = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeCursorYoloMode = (enabled: boolean): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore quota / private-mode failures; in-memory UI state still updates.
  }
  try {
    globalThis.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // jsdom / non-window hosts.
  }
};

export const subscribeCursorYoloMode = (onChange: () => void): (() => void) => {
  globalThis.addEventListener(CHANGE_EVENT, onChange);
  globalThis.addEventListener('storage', onChange);
  return () => {
    globalThis.removeEventListener(CHANGE_EVENT, onChange);
    globalThis.removeEventListener('storage', onChange);
  };
};

export const rememberCursorYoloSelection = (backend: string | undefined, selectedMode: string): void => {
  if (!isCursorBackend(backend)) return;
  writeCursorYoloMode(isCursorYoloMode(selectedMode));
};

/** Mode id to send to ACP / conversation_overrides.permission. */
export const toCursorAcpMode = (backend: string | undefined, selectedMode: string | undefined): string | undefined => {
  if (!selectedMode) return selectedMode;
  if (isCursorBackend(backend) && isCursorYoloMode(selectedMode)) return CURSOR_ACP_EXEC_MODE_ID;
  return selectedMode;
};

export const displayedCursorPermissionMode = (
  backend: string | undefined,
  acpMode: string | null | undefined,
  yoloEnabled: boolean
): string | undefined => {
  if (isCursorBackend(backend) && yoloEnabled && (acpMode === CURSOR_ACP_EXEC_MODE_ID || isCursorYoloMode(acpMode))) {
    return CURSOR_YOLO_MODE_ID;
  }
  return acpMode ?? undefined;
};

export const withCursorYoloModeOption = (
  backend: string | undefined,
  modes: CursorModeOption[],
  yoloDescription?: string
): CursorModeOption[] => {
  if (!isCursorBackend(backend) || modes.length === 0) return modes;
  const existingYolo = modes.find((mode) => mode.value === CURSOR_YOLO_MODE_ID);
  if (existingYolo) {
    if (yoloDescription && !existingYolo.description) {
      return modes.map((mode) =>
        mode.value === CURSOR_YOLO_MODE_ID ? { ...mode, description: yoloDescription } : mode
      );
    }
    return modes;
  }
  if (!modes.some((mode) => mode.value === CURSOR_ACP_EXEC_MODE_ID)) return modes;
  return [...modes, { value: CURSOR_YOLO_MODE_ID, label: 'YOLO', description: yoloDescription }];
};

export const pickCursorYoloApprovalOptionId = (
  options: Array<{ option_id?: string; kind?: string; name?: string }>
): string | null => {
  const allowAlways = options.find((option) => option.kind === 'allow_always' && option.option_id);
  if (allowAlways?.option_id) return allowAlways.option_id;

  const allowOnce = options.find((option) => option.kind === 'allow_once' && option.option_id);
  if (allowOnce?.option_id) return allowOnce.option_id;

  const allowNamed = options.find((option) => {
    if (!option.option_id) return false;
    const token = `${option.option_id} ${option.name ?? ''}`.toLowerCase();
    return token.includes('allow') && !token.includes('reject') && !token.includes('deny');
  });
  return allowNamed?.option_id ?? null;
};
