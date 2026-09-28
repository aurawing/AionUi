/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cursor ACP model ids are parameterized:
 * `composer-2.5[fast=true]`, `grok-4.6[effort=high,fast=true]`.
 * Cursor CLI documents bracket overrides such as
 * `claude-opus-4-8[context=1m,effort=high,fast=false]`.
 */

const STORAGE_KEY = 'aionui.cursor.fastMode';

export type CursorModelIdParts = {
  name: string;
  params: Record<string, string>;
};

export const parseCursorModelId = (modelId: string): CursorModelIdParts => {
  const trimmed = modelId.trim();
  const match = trimmed.match(/^([^[\]]+)(?:\[(.*)\])?$/);
  if (!match) return { name: trimmed, params: {} };

  const name = match[1] ?? trimmed;
  const raw = match[2]?.trim() ?? '';
  const params: Record<string, string> = {};
  if (!raw) return { name, params };

  for (const entry of raw.split(',')) {
    const token = entry.trim();
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq).trim();
    const value = token.slice(eq + 1).trim();
    if (key) params[key] = value;
  }
  return { name, params };
};

export const formatCursorModelId = (parts: CursorModelIdParts): string => {
  const keys = Object.keys(parts.params);
  if (keys.length === 0) return `${parts.name}[]`;
  const body = keys.map((key) => `${key}=${parts.params[key]}`).join(',');
  return `${parts.name}[${body}]`;
};

export const cursorModelAdvertisesFast = (modelId: string): boolean =>
  Object.prototype.hasOwnProperty.call(parseCursorModelId(modelId).params, 'fast');

export const cursorCatalogAdvertisesFast = (modelIds: Array<{ id: string } | string>): boolean =>
  modelIds.some((entry) => cursorModelAdvertisesFast(typeof entry === 'string' ? entry : entry.id));

export const isCursorFastEnabledInId = (modelId: string): boolean => parseCursorModelId(modelId).params.fast === 'true';

export const sameCursorModelIgnoringFast = (left: string, right: string): boolean => {
  const a = parseCursorModelId(left);
  const b = parseCursorModelId(right);
  if (a.name !== b.name) return false;
  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  for (const key of keys) {
    if (key === 'fast') continue;
    if (a.params[key] !== b.params[key]) return false;
  }
  return true;
};

export const advertisedCursorModelId = (
  availableIds: string[],
  currentId: string | null | undefined
): string | null | undefined => {
  if (!currentId) return currentId;
  return availableIds.find((id) => sameCursorModelIgnoringFast(id, currentId)) ?? currentId;
};

/** Catalog row for a stored id, matching even when only `fast` differs. */
export const catalogCursorModelId = (availableIds: string[], currentId: string | null | undefined): string | null => {
  if (!currentId) return null;
  if (availableIds.length === 0) return currentId;
  return availableIds.find((id) => sameCursorModelIgnoringFast(id, currentId)) ?? null;
};

/**
 * Rewrite a Cursor model id so Fast matches `fastEnabled`.
 * Models that never advertise a `fast` param (Auto, Kimi, GLM, …) are unchanged.
 */
export const applyCursorFastPreference = (modelId: string, fastEnabled: boolean): string => {
  const parts = parseCursorModelId(modelId);
  if (!Object.prototype.hasOwnProperty.call(parts.params, 'fast')) return modelId;
  const next = fastEnabled ? 'true' : 'false';
  if (parts.params.fast === next) return modelId;
  return formatCursorModelId({ ...parts, params: { ...parts.params, fast: next } });
};

export const readCursorFastMode = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeCursorFastMode = (fastEnabled: boolean): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, fastEnabled ? 'true' : 'false');
  } catch {
    // Ignore quota / private-mode failures; in-memory UI state still updates.
  }
};

/**
 * ACP create payload: only override the model when the user picked one, or when
 * we must rewrite a stored last-model id to turn Fast off/on.
 */
export const resolveAcpModelOverride = (params: {
  selectedModelId: string | null;
  fallbackModelId?: string;
  isAionrs: boolean;
  aionrsModel?: string;
  fastEnabled: boolean;
}): string | undefined => {
  if (params.isAionrs) return params.selectedModelId || params.aionrsModel || undefined;

  if (params.selectedModelId) {
    return applyCursorFastPreference(params.selectedModelId, params.fastEnabled);
  }

  if (!params.fallbackModelId) return undefined;
  const rewritten = applyCursorFastPreference(params.fallbackModelId, params.fastEnabled);
  return rewritten === params.fallbackModelId ? undefined : rewritten;
};
