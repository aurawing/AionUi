/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for the AionUi-managed Cursor CLI (`cursor-agent`).
 *
 * The main process downloads the official Cursor CLI package into the AionUi
 * data directory and exposes a stable launcher path. The renderer points the
 * builtin Cursor agent row at that launcher via `command_override` and stores
 * the user's API key as a `CURSOR_API_KEY` env override, so users never have
 * to install or log in to Cursor themselves.
 */

/** Env var the Cursor CLI reads for headless (API key) authentication. */
export const CURSOR_API_KEY_ENV = 'CURSOR_API_KEY';

/** Backend id of the builtin Cursor agent row seeded by aioncore. */
export const CURSOR_AGENT_BACKEND = 'cursor';

/** Dashboard page where users create Cursor user API keys. */
export const CURSOR_API_KEYS_URL = 'https://cursor.com/dashboard/api';

export type CursorCliStatus = {
  /** False when Cursor publishes no CLI build for this OS / CPU architecture. */
  supported: boolean;
  installed: boolean;
  version?: string;
  /** Epoch milliseconds of the last successful install. */
  installedAt?: number;
  /** Stable launcher to use as the agent `command_override`; survives CLI updates. */
  launcherPath: string;
  /** True while an install or update is in flight. */
  installing: boolean;
};

export type CursorCliInstallRequest = {
  /** Re-download even when the latest version is already installed. */
  reinstall?: boolean;
};

export type CursorCliInstallResult = {
  version: string;
  launcherPath: string;
  /** False when the latest version was already installed and nothing was downloaded. */
  updated: boolean;
};

export type CursorCliInstallPhase = 'resolving' | 'downloading' | 'extracting' | 'done' | 'error';

export type CursorCliInstallProgressEvent = {
  phase: CursorCliInstallPhase;
  version?: string;
  receivedBytes?: number;
  totalBytes?: number;
  /** 0–100, only present while downloading with a known content length. */
  percent?: number;
  message?: string;
};

export type CursorApiKeyVerifyRequest = {
  apiKey: string;
};

/**
 * `unreachable` means the key could not be checked (offline, proxy, 5xx);
 * callers may still save it and rely on the agent health check.
 */
export type CursorApiKeyVerifyResult =
  | { status: 'valid'; email?: string; name?: string; apiKeyName?: string }
  | { status: 'invalid'; message?: string }
  | { status: 'unreachable'; message?: string };
