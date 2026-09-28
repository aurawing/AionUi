/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  displayedCursorPermissionMode,
  pickCursorYoloApprovalOptionId,
  readCursorYoloMode,
  toCursorAcpMode,
  withCursorYoloModeOption,
} from '@/common/types/agent/cursorYolo';

const cursorModes = [
  { value: 'agent', label: 'Agent' },
  { value: 'plan', label: 'Plan' },
  { value: 'ask', label: 'Ask' },
];

describe('cursorYolo', () => {
  it('defaults off when storage is missing', () => {
    expect(readCursorYoloMode()).toBe(false);
  });

  it('injects a client-side YOLO option only for Cursor catalogs that have Agent', () => {
    expect(withCursorYoloModeOption('cursor', cursorModes, 'Auto-approve').map((mode) => mode.value)).toEqual([
      'agent',
      'plan',
      'ask',
      'yolo',
    ]);
    expect(withCursorYoloModeOption('claude', cursorModes).map((mode) => mode.value)).toEqual(['agent', 'plan', 'ask']);
    expect(withCursorYoloModeOption('cursor', [{ value: 'plan', label: 'Plan' }])).toEqual([
      { value: 'plan', label: 'Plan' },
    ]);
    expect(withCursorYoloModeOption('cursor', [])).toEqual([]);
  });

  it('does not duplicate YOLO and fills a missing description', () => {
    const injected = withCursorYoloModeOption('cursor', cursorModes);
    const withDescription = withCursorYoloModeOption('cursor', injected, 'Auto-approve');
    expect(withDescription[withDescription.length - 1]).toEqual({
      value: 'yolo',
      label: 'YOLO',
      description: 'Auto-approve',
    });
  });

  it('maps synthetic Cursor YOLO to ACP agent and leaves other backends alone', () => {
    expect(toCursorAcpMode('cursor', 'yolo')).toBe('agent');
    expect(toCursorAcpMode('cursor', 'plan')).toBe('plan');
    expect(toCursorAcpMode('aionrs', 'yolo')).toBe('yolo');
    expect(toCursorAcpMode('cursor', undefined)).toBeUndefined();
  });

  it('overlays YOLO on the picker only while Cursor is in Agent mode', () => {
    expect(displayedCursorPermissionMode('cursor', 'agent', true)).toBe('yolo');
    expect(displayedCursorPermissionMode('cursor', 'plan', true)).toBe('plan');
    expect(displayedCursorPermissionMode('cursor', 'agent', false)).toBe('agent');
    expect(displayedCursorPermissionMode('claude', 'agent', true)).toBe('agent');
  });

  it('prefers allow_always, then allow_once, and skips reject-only cards', () => {
    expect(
      pickCursorYoloApprovalOptionId([
        { option_id: 'reject-1', kind: 'reject_once', name: 'Reject' },
        { option_id: 'once-1', kind: 'allow_once', name: 'Allow once' },
        { option_id: 'always-1', kind: 'allow_always', name: 'Always allow' },
      ])
    ).toBe('always-1');
    expect(
      pickCursorYoloApprovalOptionId([
        { option_id: 'reject-1', kind: 'reject_once', name: 'Reject' },
        { option_id: 'once-1', kind: 'allow_once', name: 'Allow once' },
      ])
    ).toBe('once-1');
    expect(pickCursorYoloApprovalOptionId([{ option_id: 'reject-1', kind: 'reject_once', name: 'Reject' }])).toBeNull();
    expect(pickCursorYoloApprovalOptionId([])).toBeNull();
  });
});
