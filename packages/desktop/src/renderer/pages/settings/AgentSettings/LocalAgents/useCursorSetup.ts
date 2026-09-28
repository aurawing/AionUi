/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  CURSOR_AGENT_BACKEND,
  CURSOR_API_KEY_ENV,
  type CursorCliInstallProgressEvent,
  type CursorCliStatus,
} from '@/common/types/agent/cursorCli';
import { formatManagedAgentDiagnosticMessage, type ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { Message } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type EnvOverride = { name: string; value: string };
type BridgeResult<T> = { success: boolean; data?: T; msg?: string };

export type CursorSetupAction = 'connect' | 'update' | 'remove';
export type CursorAccount = { email?: string; name?: string };

export const findCursorAgent = (agents: ManagedAgent[]): ManagedAgent | undefined =>
  agents.find((agent) => agent.backend === CURSOR_AGENT_BACKEND && agent.agent_source === 'builtin');

export const withCursorApiKey = (env: EnvOverride[], apiKey: string | null): EnvOverride[] => {
  const rest = env.filter((entry) => entry.name !== CURSOR_API_KEY_ENV);
  return apiKey ? [...rest, { name: CURSOR_API_KEY_ENV, value: apiKey }] : rest;
};

export const maskApiKey = (apiKey: string): string =>
  apiKey.length <= 12 ? '••••••••' : `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}`;

// The generic guidance for these codes tells users to sign in through the CLI,
// which the managed setup deliberately never asks for.
const CURSOR_SESSION_ERROR_CODES = new Set([
  'acp_init_failed',
  'auth_required',
  'health_check_failed',
  'session_send_failed',
]);

export const describeCursorHealthIssue = (t: TFunction, agent: ManagedAgent): string =>
  agent.last_check_error_code && CURSOR_SESSION_ERROR_CODES.has(agent.last_check_error_code)
    ? t('settings.cursorSetup.sessionFailed')
    : formatManagedAgentDiagnosticMessage(t, agent) ||
      t('settings.agentManagement.testConnectionOffline', { name: agent.name });

const unwrap = <T>(result: BridgeResult<T>): T => {
  if (!result?.success || result.data === undefined) throw new Error(result?.msg || 'Unknown error');
  return result.data;
};

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type UseCursorSetupParams = {
  agent: ManagedAgent | undefined;
  refreshCatalog: () => Promise<unknown>;
};

/**
 * One-click Cursor setup: verifies the API key, installs the managed CLI when
 * missing, then points the builtin Cursor agent at the managed launcher with
 * `CURSOR_API_KEY` in its env overrides. Other env overrides are preserved.
 */
export const useCursorSetup = ({ agent, refreshCatalog }: UseCursorSetupParams) => {
  const { t } = useTranslation();
  const agentId = agent?.id;
  const [cliStatus, setCliStatus] = useState<CursorCliStatus | null>(null);
  const [commandOverride, setCommandOverride] = useState<string | undefined>();
  const [envOverride, setEnvOverride] = useState<EnvOverride[]>([]);
  const [account, setAccount] = useState<CursorAccount | null>(null);
  const [progress, setProgress] = useState<CursorCliInstallProgressEvent | null>(null);
  const [pendingAction, setPendingAction] = useState<CursorSetupAction | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const savedApiKey = envOverride.find((entry) => entry.name === CURSOR_API_KEY_ENV)?.value || null;
  const usesManagedCli = Boolean(cliStatus?.launcherPath && commandOverride === cliStatus.launcherPath);

  const loadOverrides = useCallback(async (id: string) => {
    const overrides = await ipcBridge.acpConversation.getAgentOverrides.invoke({ id });
    setCommandOverride(overrides.command_override || undefined);
    setEnvOverride(overrides.env_override ?? []);
    return overrides;
  }, []);

  const loadCliStatus = useCallback(async () => {
    const status = unwrap(await ipcBridge.cursorCli.getStatus.invoke());
    setCliStatus(status);
    return status;
  }, []);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [overrides] = await Promise.all([loadOverrides(agentId), loadCliStatus()]);
        const key = overrides.env_override?.find((entry) => entry.name === CURSOR_API_KEY_ENV)?.value;
        if (!key) return;
        const verified = unwrap(await ipcBridge.cursorCli.verifyApiKey.invoke({ apiKey: key }));
        if (!cancelled && verified.status === 'valid') setAccount({ email: verified.email, name: verified.name });
      } catch (err) {
        if (!cancelled) setLoadError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, loadCliStatus, loadOverrides]);

  useEffect(() => ipcBridge.cursorCli.installProgress.on(setProgress), []);

  const runExclusive = useCallback(async (action: CursorSetupAction, task: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(action);
    try {
      await task();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
      setProgress(null);
    }
  }, []);

  const reportHealth = useCallback(
    (result: ManagedAgent, email?: string) => {
      if (result.status === 'online') {
        Message.success(email ? t('settings.cursorSetup.connectedAs', { email }) : t('settings.cursorSetup.connected'));
        return;
      }
      Message.warning(describeCursorHealthIssue(t, result));
    },
    [t]
  );

  const installCli = useCallback(async (reinstall = false) => {
    const result = unwrap(await ipcBridge.cursorCli.install.invoke({ reinstall }));
    const status = unwrap(await ipcBridge.cursorCli.getStatus.invoke());
    setCliStatus(status);
    return result;
  }, []);

  const connect = useCallback(
    (rawApiKey: string): Promise<boolean> => {
      const apiKey = rawApiKey.trim();
      let connected = false;
      return runExclusive('connect', async () => {
        if (!agent || !apiKey) return;
        try {
          const verified = unwrap(await ipcBridge.cursorCli.verifyApiKey.invoke({ apiKey }));
          if (verified.status === 'invalid') {
            Message.error(t('settings.cursorSetup.keyInvalid'));
            return;
          }
          if (verified.status === 'unreachable') {
            Message.warning(t('settings.cursorSetup.keyUnverified', { error: verified.message ?? '' }));
          }

          const status = await loadCliStatus();
          const launcherPath = status.installed ? status.launcherPath : (await installCli()).launcherPath;

          const current = await ipcBridge.acpConversation.getAgentOverrides.invoke({ id: agent.id });
          const result = await ipcBridge.acpConversation.setAgentOverrides.invoke({
            id: agent.id,
            command_override: launcherPath,
            env_override: withCursorApiKey(current.env_override ?? [], apiKey),
          });
          if (agent.enabled === false) {
            await ipcBridge.acpConversation.setAgentEnabled.invoke({ id: agent.id, enabled: true });
          }
          await loadOverrides(agent.id);
          await refreshCatalog();

          const email = verified.status === 'valid' ? verified.email : undefined;
          setAccount(verified.status === 'valid' ? { email, name: verified.name } : null);
          reportHealth(result, email);
          connected = true;
        } catch (err) {
          console.error('[cursor-setup] connect failed:', err);
          Message.error(t('settings.cursorSetup.connectFailed', { error: errorText(err) }));
        }
      }).then(() => connected);
    },
    [agent, installCli, loadCliStatus, loadOverrides, refreshCatalog, reportHealth, runExclusive, t]
  );

  const updateCli = useCallback(
    () =>
      runExclusive('update', async () => {
        try {
          const result = await installCli();
          if (!result.updated) {
            Message.info(t('settings.cursorSetup.alreadyLatest', { version: result.version }));
            return;
          }
          Message.success(t('settings.cursorSetup.updated', { version: result.version }));
          if (agent && usesManagedCli) {
            await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
            await refreshCatalog();
          }
        } catch (err) {
          console.error('[cursor-setup] update failed:', err);
          Message.error(t('settings.cursorSetup.installFailed', { error: errorText(err) }));
        }
      }),
    [agent, installCli, refreshCatalog, runExclusive, t, usesManagedCli]
  );

  const removeKey = useCallback(
    () =>
      runExclusive('remove', async () => {
        if (!agent) return;
        try {
          const current = await ipcBridge.acpConversation.getAgentOverrides.invoke({ id: agent.id });
          const ownsCommand = Boolean(cliStatus && current.command_override === cliStatus.launcherPath);
          await ipcBridge.acpConversation.setAgentOverrides.invoke({
            id: agent.id,
            command_override: ownsCommand ? null : current.command_override,
            env_override: withCursorApiKey(current.env_override ?? [], null),
          });
          await loadOverrides(agent.id);
          await refreshCatalog();
          setAccount(null);
          Message.success(t('settings.cursorSetup.removed'));
        } catch (err) {
          console.error('[cursor-setup] remove failed:', err);
          Message.error(t('settings.cursorSetup.removeFailed', { error: errorText(err) }));
        }
      }),
    [agent, cliStatus, loadOverrides, refreshCatalog, runExclusive, t]
  );

  return {
    cliStatus,
    savedApiKey,
    usesManagedCli,
    account,
    progress,
    pendingAction,
    loadError,
    connect,
    updateCli,
    removeKey,
  };
};
