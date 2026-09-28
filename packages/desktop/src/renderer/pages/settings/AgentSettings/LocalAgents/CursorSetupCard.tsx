/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CURSOR_API_KEYS_URL, type CursorCliInstallProgressEvent } from '@/common/types/agent/cursorCli';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import { resolveAgentAvatar, useAgentLogos } from '@/renderer/utils/model/agentLogo';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Avatar, Button, Input, Popconfirm, Progress, Tag, Typography } from '@arco-design/web-react';
import { LinkOne, Robot } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { maskApiKey, useCursorSetup } from './useCursorSetup';

type CursorSetupCardProps = {
  agent: ManagedAgent;
  refreshCatalog: () => Promise<unknown>;
};

type CardStatus = 'installing' | 'online' | 'offline' | 'unchecked' | 'unconfigured';

const STATUS_TAG: Record<CardStatus, { color: string; labelKey: string }> = {
  installing: { color: 'arcoblue', labelKey: 'settings.cursorSetup.statusInstalling' },
  online: { color: 'green', labelKey: 'settings.cursorSetup.statusOnline' },
  offline: { color: 'orange', labelKey: 'settings.cursorSetup.statusOffline' },
  unchecked: { color: 'gray', labelKey: 'settings.cursorSetup.statusUnchecked' },
  unconfigured: { color: 'gray', labelKey: 'settings.cursorSetup.statusUnconfigured' },
};

const formatMegabytes = (bytes?: number): string => `${((bytes ?? 0) / 1024 / 1024).toFixed(1)} MB`;

const describeProgress = (t: TFunction, progress: CursorCliInstallProgressEvent): string => {
  switch (progress.phase) {
    case 'resolving':
      return t('settings.cursorSetup.progressResolving');
    case 'downloading':
      return progress.totalBytes
        ? t('settings.cursorSetup.progressDownloading', {
            received: formatMegabytes(progress.receivedBytes),
            total: formatMegabytes(progress.totalBytes),
          })
        : t('settings.cursorSetup.progressDownloadingUnknown', { received: formatMegabytes(progress.receivedBytes) });
    case 'extracting':
      return t('settings.cursorSetup.progressExtracting');
    default:
      return '';
  }
};

const secondaryButtonClass =
  '!h-30px !rounded-8px !border-border-2 !bg-base !px-10px !text-12px !font-500 !text-t-primary hover:!border-border-1 hover:!bg-fill-1';

/**
 * Setup surface for the builtin Cursor agent: paste a Cursor API key and
 * AionUi downloads and wires up the official Cursor CLI itself.
 */
const CursorSetupCard: React.FC<CursorSetupCardProps> = ({ agent, refreshCatalog }) => {
  const { t } = useTranslation();
  const logos = useAgentLogos();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const {
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
  } = useCursorSetup({ agent, refreshCatalog });

  const configured = Boolean(savedApiKey && usesManagedCli);
  const isInstalling = Boolean(progress && progress.phase !== 'done' && progress.phase !== 'error');
  const cardStatus: CardStatus = isInstalling
    ? 'installing'
    : !configured
      ? 'unconfigured'
      : agent.status === 'online'
        ? 'online'
        : agent.status === 'unchecked'
          ? 'unchecked'
          : 'offline';

  const avatar = resolveAgentAvatar(logos, { icon: agent.avatar || agent.icon, backend: agent.backend });
  const unsupported = cliStatus?.supported === false;

  const handleConnect = async () => {
    if (await connect(apiKeyInput)) setApiKeyInput('');
  };

  return (
    <div
      data-testid='cursor-setup-card'
      className='flex flex-col gap-12px rounded-12px border border-solid border-border-2 bg-2 p-12px md:rounded-16px md:p-16px'
    >
      <div className='flex items-start gap-12px'>
        <Avatar
          size={32}
          shape='square'
          style={{ flexShrink: 0, backgroundColor: avatar.kind === 'image' ? 'transparent' : 'var(--color-fill-2)' }}
        >
          {avatar.kind === 'image' ? (
            <ThemedLogo
              src={avatar.value}
              alt={agent.name}
              style={{ width: 32, height: 32, objectFit: 'contain', color: 'var(--text-primary)' }}
            />
          ) : (
            <Robot theme='outline' size='18' />
          )}
        </Avatar>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-8px'>
            <Typography.Text className='text-14px font-medium text-t-primary'>
              {t('settings.cursorSetup.title')}
            </Typography.Text>
            <Tag data-testid='cursor-setup-status' size='small' color={STATUS_TAG[cardStatus].color}>
              {t(STATUS_TAG[cardStatus].labelKey)}
            </Tag>
          </div>
          <Typography.Text className='mt-2px block text-12px leading-18px text-t-tertiary'>
            {t('settings.cursorSetup.description')}
          </Typography.Text>
        </div>
      </div>

      {unsupported ? (
        <Typography.Text className='block text-12px text-warning-6'>
          {t('settings.cursorSetup.unsupportedPlatform')}
        </Typography.Text>
      ) : (
        <>
          <div className='flex flex-col gap-8px md:flex-row md:items-center'>
            <Input.Password
              data-testid='cursor-setup-api-key'
              className='min-w-0 flex-1'
              visibilityToggle
              autoComplete='off'
              value={apiKeyInput}
              onChange={setApiKeyInput}
              onPressEnter={() => void handleConnect()}
              disabled={pendingAction !== null}
              placeholder={
                savedApiKey
                  ? t('settings.cursorSetup.replaceKeyPlaceholder', { key: maskApiKey(savedApiKey) })
                  : t('settings.cursorSetup.apiKeyPlaceholder')
              }
            />
            <Button
              data-testid='cursor-setup-connect'
              type='primary'
              className='!h-32px !rounded-8px'
              loading={pendingAction === 'connect'}
              disabled={!apiKeyInput.trim() || (pendingAction !== null && pendingAction !== 'connect')}
              onClick={() => void handleConnect()}
            >
              {t('settings.cursorSetup.connect')}
            </Button>
          </div>

          {isInstalling && progress ? (
            <div data-testid='cursor-setup-progress' className='flex flex-col gap-4px'>
              <Progress percent={Math.round(progress.percent ?? 0)} showText={false} strokeWidth={6} />
              <Typography.Text className='text-12px text-t-tertiary'>{describeProgress(t, progress)}</Typography.Text>
            </div>
          ) : null}

          <div className='flex flex-wrap items-center justify-between gap-8px'>
            <div className='flex min-w-0 flex-wrap items-center gap-x-12px gap-y-4px text-12px text-t-tertiary'>
              <span data-testid='cursor-setup-cli-version'>
                {cliStatus?.installed
                  ? t('settings.cursorSetup.cliVersion', { version: cliStatus.version })
                  : t('settings.cursorSetup.cliNotInstalled')}
              </span>
              {account?.email ? <span>{t('settings.cursorSetup.account', { email: account.email })}</span> : null}
              {loadError ? <span className='text-warning-6'>{loadError}</span> : null}
            </div>
            <div className='flex flex-shrink-0 flex-wrap items-center gap-8px'>
              <Button
                type='text'
                size='small'
                icon={<LinkOne theme='outline' size='12' />}
                className='!px-4px !text-12px'
                onClick={() => void openExternalUrl(CURSOR_API_KEYS_URL).catch(console.error)}
              >
                {t('settings.cursorSetup.getApiKey')}
              </Button>
              {cliStatus?.installed ? (
                <Button
                  data-testid='cursor-setup-update'
                  size='small'
                  type='outline'
                  className={secondaryButtonClass}
                  loading={pendingAction === 'update'}
                  disabled={pendingAction !== null && pendingAction !== 'update'}
                  onClick={() => void updateCli()}
                >
                  {t('settings.cursorSetup.checkUpdate')}
                </Button>
              ) : null}
              {savedApiKey ? (
                <Popconfirm
                  title={t('settings.cursorSetup.removeConfirm')}
                  onOk={() => void removeKey()}
                  disabled={pendingAction !== null}
                >
                  <Button
                    data-testid='cursor-setup-remove'
                    size='small'
                    type='outline'
                    status='danger'
                    className='!h-30px !rounded-8px !px-10px !text-12px'
                    loading={pendingAction === 'remove'}
                    disabled={pendingAction !== null && pendingAction !== 'remove'}
                  >
                    {t('settings.cursorSetup.removeKey')}
                  </Button>
                </Popconfirm>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CursorSetupCard;
