/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversation_id });
    if (conversation && conversation.id) return conversation;
    return null;
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * A refetch 404/empty body is not proof the open conversation was deleted.
 * Keep the row the user is already viewing; only a first-load miss stays `null`.
 */
export const keepConversationOnRefetchMiss = (
  conversationId: string,
  current: TChatConversation | undefined,
  incoming: TChatConversation | null | undefined
): TChatConversation | null => {
  if (incoming?.id === conversationId) return incoming;
  if (current?.id === conversationId) return current;
  return null;
};

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
