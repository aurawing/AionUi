/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * CursorSetupCard: paste a Cursor API key → AionUi verifies it, installs the
 * managed Cursor CLI when missing and points the builtin Cursor agent at it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const { message } = vi.hoisted(() => ({
  message: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: message };
});

const { bridge } = vi.hoisted(() => ({
  bridge: {
    cursorCli: {
      getStatus: { invoke: vi.fn() },
      install: { invoke: vi.fn() },
      verifyApiKey: { invoke: vi.fn() },
      installProgress: { on: vi.fn(() => () => {}) },
    },
    acpConversation: {
      getAgentOverrides: { invoke: vi.fn() },
      setAgentOverrides: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
  },
}));
vi.mock('@/common', () => ({ ipcBridge: bridge }));

import CursorSetupCard from '@renderer/pages/settings/AgentSettings/LocalAgents/CursorSetupCard';
import {
  describeCursorHealthIssue,
  findCursorAgent,
  maskApiKey,
  withCursorApiKey,
} from '@renderer/pages/settings/AgentSettings/LocalAgents/useCursorSetup';
import type { TFunction } from 'i18next';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const LAUNCHER = '/data/managed-cli/cursor-agent/bin/cursor-agent';

const makeAgent = (overrides: Partial<ManagedAgent> = {}): ManagedAgent =>
  ({
    id: 'a0dfb1ec',
    name: 'Cursor',
    backend: 'cursor',
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: false,
    status: 'missing',
    ...overrides,
  }) as ManagedAgent;

const status = (installed: boolean) => ({
  success: true,
  data: {
    supported: true,
    installed,
    version: installed ? '2026.09.26-dd393fe' : undefined,
    launcherPath: LAUNCHER,
    installing: false,
  },
});

const typeKeyAndConnect = (key: string) => {
  const field = screen.getByTestId('cursor-setup-api-key');
  const input = field instanceof HTMLInputElement ? field : (field.querySelector('input') as HTMLInputElement);
  fireEvent.change(input, { target: { value: key } });
  fireEvent.click(screen.getByTestId('cursor-setup-connect'));
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.cursorCli.installProgress.on.mockImplementation(() => () => {});
  bridge.cursorCli.getStatus.invoke.mockResolvedValue(status(false));
  bridge.acpConversation.getAgentOverrides.invoke.mockResolvedValue({
    env_override: [{ name: 'HTTPS_PROXY', value: 'http://proxy:8080' }],
  });
  bridge.cursorCli.verifyApiKey.invoke.mockResolvedValue({
    success: true,
    data: { status: 'valid', email: 'dev@example.com' },
  });
  bridge.cursorCli.install.invoke.mockImplementation(async () => {
    bridge.cursorCli.getStatus.invoke.mockResolvedValue(status(true));
    return { success: true, data: { version: '2026.09.26-dd393fe', launcherPath: LAUNCHER, updated: true } };
  });
  bridge.acpConversation.setAgentOverrides.invoke.mockResolvedValue(makeAgent({ status: 'online', installed: true }));
});

describe('CursorSetupCard', () => {
  it('shows the unconfigured state and keeps connect disabled until a key is entered', async () => {
    render(<CursorSetupCard agent={makeAgent()} refreshCatalog={vi.fn()} />);

    expect(await screen.findByText('settings.cursorSetup.cliNotInstalled')).toBeInTheDocument();
    expect(screen.getByTestId('cursor-setup-status')).toHaveTextContent('settings.cursorSetup.statusUnconfigured');
    expect(screen.getByTestId('cursor-setup-connect')).toBeDisabled();
  });

  it('installs the CLI and saves the launcher + key while keeping other env overrides', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    render(<CursorSetupCard agent={makeAgent({ enabled: false })} refreshCatalog={refreshCatalog} />);
    await screen.findByText('settings.cursorSetup.cliNotInstalled');

    typeKeyAndConnect('  key_live_123  ');

    await waitFor(() => expect(message.success).toHaveBeenCalledWith('settings.cursorSetup.connectedAs'));
    expect(bridge.cursorCli.verifyApiKey.invoke).toHaveBeenCalledWith({ apiKey: 'key_live_123' });
    expect(bridge.cursorCli.install.invoke).toHaveBeenCalledTimes(1);
    expect(bridge.acpConversation.setAgentOverrides.invoke).toHaveBeenCalledWith({
      id: 'a0dfb1ec',
      command_override: LAUNCHER,
      env_override: [
        { name: 'HTTPS_PROXY', value: 'http://proxy:8080' },
        { name: 'CURSOR_API_KEY', value: 'key_live_123' },
      ],
    });
    expect(bridge.acpConversation.setAgentEnabled.invoke).toHaveBeenCalledWith({ id: 'a0dfb1ec', enabled: true });
    expect(refreshCatalog).toHaveBeenCalled();
  });

  it('does not install or save anything when Cursor rejects the key', async () => {
    bridge.cursorCli.verifyApiKey.invoke.mockResolvedValue({ success: true, data: { status: 'invalid' } });
    render(<CursorSetupCard agent={makeAgent()} refreshCatalog={vi.fn()} />);
    await screen.findByText('settings.cursorSetup.cliNotInstalled');

    typeKeyAndConnect('key_bad');

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('settings.cursorSetup.keyInvalid'));
    expect(bridge.cursorCli.install.invoke).not.toHaveBeenCalled();
    expect(bridge.acpConversation.setAgentOverrides.invoke).not.toHaveBeenCalled();
  });

  it('surfaces an install failure and leaves the agent untouched', async () => {
    bridge.cursorCli.install.invoke.mockResolvedValue({ success: false, msg: 'ENOSPC: no space left on device' });
    render(<CursorSetupCard agent={makeAgent()} refreshCatalog={vi.fn()} />);
    await screen.findByText('settings.cursorSetup.cliNotInstalled');

    typeKeyAndConnect('key_live_123');

    await waitFor(() => expect(message.error).toHaveBeenCalledWith('settings.cursorSetup.connectFailed'));
    expect(bridge.acpConversation.setAgentOverrides.invoke).not.toHaveBeenCalled();
  });

  it('saves a key it cannot verify and explains a failed Cursor session without pointing at CLI sign-in', async () => {
    bridge.cursorCli.verifyApiKey.invoke.mockResolvedValue({
      success: true,
      data: { status: 'unreachable', message: 'net::ERR_NAME_NOT_RESOLVED' },
    });
    bridge.acpConversation.setAgentOverrides.invoke.mockResolvedValue(
      makeAgent({ status: 'offline', installed: true, last_check_error_code: 'acp_init_failed' })
    );
    render(<CursorSetupCard agent={makeAgent()} refreshCatalog={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText('settings.cursorSetup.cliNotInstalled');

    typeKeyAndConnect('key_unverified_123');

    await waitFor(() => expect(message.warning).toHaveBeenCalledWith('settings.cursorSetup.sessionFailed'));
    expect(message.warning).toHaveBeenCalledWith('settings.cursorSetup.keyUnverified');
    expect(bridge.acpConversation.setAgentOverrides.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ command_override: LAUNCHER })
    );
  });

  it('keeps the reason visible on the card while the saved key does not work', async () => {
    bridge.cursorCli.getStatus.invoke.mockResolvedValue(status(true));
    bridge.acpConversation.getAgentOverrides.invoke.mockResolvedValue({
      command_override: LAUNCHER,
      env_override: [{ name: 'CURSOR_API_KEY', value: 'key_revoked_1234567890' }],
    });
    bridge.cursorCli.verifyApiKey.invoke.mockResolvedValue({ success: true, data: { status: 'invalid' } });

    render(
      <CursorSetupCard
        agent={makeAgent({ status: 'offline', installed: true, last_check_error_code: 'auth_required' })}
        refreshCatalog={vi.fn()}
      />
    );

    expect(await screen.findByTestId('cursor-setup-issue')).toHaveTextContent('settings.cursorSetup.sessionFailed');
    expect(screen.getByTestId('cursor-setup-status')).toHaveTextContent('settings.cursorSetup.statusOffline');
  });

  it('shows the connected account when a saved key drives the managed CLI', async () => {
    bridge.cursorCli.getStatus.invoke.mockResolvedValue(status(true));
    bridge.acpConversation.getAgentOverrides.invoke.mockResolvedValue({
      command_override: LAUNCHER,
      env_override: [{ name: 'CURSOR_API_KEY', value: 'key_live_1234567890' }],
    });

    render(<CursorSetupCard agent={makeAgent({ status: 'online', installed: true })} refreshCatalog={vi.fn()} />);

    expect(await screen.findByText('settings.cursorSetup.account')).toBeInTheDocument();
    expect(screen.getByTestId('cursor-setup-status')).toHaveTextContent('settings.cursorSetup.statusOnline');
    expect(screen.getByTestId('cursor-setup-cli-version')).toHaveTextContent('settings.cursorSetup.cliVersion');
    expect(screen.getByTestId('cursor-setup-remove')).toBeInTheDocument();
  });
});

describe('useCursorSetup helpers', () => {
  it('replaces only the Cursor key in env overrides', () => {
    const env = [
      { name: 'CURSOR_API_KEY', value: 'old' },
      { name: 'HTTPS_PROXY', value: 'http://proxy' },
    ];
    expect(withCursorApiKey(env, 'new')).toEqual([
      { name: 'HTTPS_PROXY', value: 'http://proxy' },
      { name: 'CURSOR_API_KEY', value: 'new' },
    ]);
    expect(withCursorApiKey(env, null)).toEqual([{ name: 'HTTPS_PROXY', value: 'http://proxy' }]);
  });

  it('masks keys without revealing short ones', () => {
    expect(maskApiKey('key_live_1234567890')).toBe('key_li••••7890');
    expect(maskApiKey('short')).toBe('••••••••');
  });

  it('uses the generic diagnostics for problems other than a rejected session', () => {
    const t = ((key: string) => key) as unknown as TFunction;
    expect(describeCursorHealthIssue(t, makeAgent({ last_check_error_code: 'command_not_found' }))).toBe(
      'settings.agentManagement.errorCodes.command_not_found'
    );
    expect(describeCursorHealthIssue(t, makeAgent({ last_check_error_code: 'health_check_failed' }))).toBe(
      'settings.cursorSetup.sessionFailed'
    );
    expect(describeCursorHealthIssue(t, makeAgent({ status: 'offline' }))).toBe(
      'settings.agentManagement.testConnectionOffline'
    );
  });

  it('only matches the builtin Cursor row', () => {
    const custom = makeAgent({ id: 'custom', agent_source: 'custom' });
    const builtin = makeAgent();
    expect(findCursorAgent([custom, builtin])).toBe(builtin);
    expect(findCursorAgent([custom])).toBeUndefined();
  });
});
