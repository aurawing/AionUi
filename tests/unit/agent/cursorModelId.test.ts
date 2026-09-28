/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  advertisedCursorModelId,
  applyCursorFastPreference,
  catalogCursorModelId,
  cursorCatalogAdvertisesFast,
  formatCursorModelId,
  parseCursorModelId,
  resolveAcpModelOverride,
  sameCursorModelIgnoringFast,
} from '@/common/types/agent/cursorModelId';

describe('cursorModelId', () => {
  it('parses parameterized Cursor model ids', () => {
    expect(parseCursorModelId('composer-2.5[fast=true]')).toEqual({
      name: 'composer-2.5',
      params: { fast: 'true' },
    });
    expect(parseCursorModelId('grok-4.6[effort=high,fast=true]')).toEqual({
      name: 'grok-4.6',
      params: { effort: 'high', fast: 'true' },
    });
    expect(parseCursorModelId('default[]')).toEqual({ name: 'default', params: {} });
  });

  it('formats empty params as empty brackets like Cursor Auto', () => {
    expect(formatCursorModelId({ name: 'default', params: {} })).toBe('default[]');
  });

  it('turns Fast off without dropping other params', () => {
    expect(applyCursorFastPreference('grok-4.6[effort=high,fast=true]', false)).toBe(
      'grok-4.6[effort=high,fast=false]'
    );
    expect(applyCursorFastPreference('composer-2.5[fast=true]', false)).toBe('composer-2.5[fast=false]');
  });

  it('leaves models without a fast param unchanged', () => {
    expect(applyCursorFastPreference('default[]', false)).toBe('default[]');
    expect(applyCursorFastPreference('kimi-k2.7-code[]', true)).toBe('kimi-k2.7-code[]');
    expect(applyCursorFastPreference('glm-5.2[reasoning=high]', false)).toBe('glm-5.2[reasoning=high]');
    expect(applyCursorFastPreference('claude-opus', false)).toBe('claude-opus');
  });

  it('matches the same Cursor model when only fast differs', () => {
    expect(sameCursorModelIgnoringFast('grok-4.6[effort=high,fast=true]', 'grok-4.6[effort=high,fast=false]')).toBe(
      true
    );
    expect(sameCursorModelIgnoringFast('composer-2.5[fast=true]', 'composer-2.5[fast=false]')).toBe(true);
    expect(sameCursorModelIgnoringFast('grok-4.6[effort=high,fast=true]', 'grok-4.5[effort=high,fast=true]')).toBe(
      false
    );
  });

  it('maps a stored Fast-off id onto the advertised catalog row', () => {
    expect(
      catalogCursorModelId(
        ['composer-2.5[fast=true]', 'grok-4.6[effort=high,fast=true]'],
        'grok-4.6[effort=high,fast=false]'
      )
    ).toBe('grok-4.6[effort=high,fast=true]');
    expect(catalogCursorModelId(['claude-opus'], 'grok-4.6[effort=high,fast=false]')).toBeNull();
    expect(catalogCursorModelId([], 'composer-2.5[fast=false]')).toBe('composer-2.5[fast=false]');
  });

  it('maps a rewritten current id back to the advertised catalog row', () => {
    expect(
      advertisedCursorModelId(
        ['composer-2.5[fast=true]', 'grok-4.6[effort=high,fast=true]'],
        'grok-4.6[effort=high,fast=false]'
      )
    ).toBe('grok-4.6[effort=high,fast=true]');
  });

  it('detects a Cursor catalog that advertises Fast', () => {
    expect(cursorCatalogAdvertisesFast(['default[]', 'composer-2.5[fast=true]'])).toBe(true);
    expect(cursorCatalogAdvertisesFast(['claude-opus', 'gpt-5.2'])).toBe(false);
  });

  it('omits an unpicked ACP model unless Fast must be rewritten on the last id', () => {
    expect(
      resolveAcpModelOverride({
        selectedModelId: null,
        fallbackModelId: 'grok-4.6[effort=high,fast=true]',
        isAionrs: false,
        fastEnabled: false,
      })
    ).toBe('grok-4.6[effort=high,fast=false]');

    expect(
      resolveAcpModelOverride({
        selectedModelId: null,
        fallbackModelId: 'claude-opus',
        isAionrs: false,
        fastEnabled: false,
      })
    ).toBeUndefined();
  });

  it('rewrites a picked Cursor model and leaves aionrs models alone', () => {
    expect(
      resolveAcpModelOverride({
        selectedModelId: 'composer-2.5[fast=true]',
        isAionrs: false,
        fastEnabled: false,
      })
    ).toBe('composer-2.5[fast=false]');

    expect(
      resolveAcpModelOverride({
        selectedModelId: null,
        isAionrs: true,
        aionrsModel: 'gemini-3.1-pro-preview',
        fastEnabled: false,
      })
    ).toBe('gemini-3.1-pro-preview');
  });
});
