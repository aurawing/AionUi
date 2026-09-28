/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readCursorFastMode, writeCursorFastMode } from '@/common/types/agent/cursorModelId';
import { readCursorYoloMode, subscribeCursorYoloMode, writeCursorYoloMode } from '@/common/types/agent/cursorYolo';
import { useCallback, useEffect, useState } from 'react';

/**
 * Shared Fast-mode preference for Cursor parameterized model ids.
 * Missing storage is treated as off.
 */
export const useCursorFastMode = () => {
  const [fastEnabled, setFastEnabledState] = useState(readCursorFastMode);

  const setFastEnabled = useCallback((enabled: boolean) => {
    setFastEnabledState(enabled);
    writeCursorFastMode(enabled);
  }, []);

  return { fastEnabled, setFastEnabled };
};

/** Shared YOLO preference for Cursor ACP permission cards. Missing storage is off. */
export const useCursorYoloMode = () => {
  const [yoloEnabled, setYoloEnabledState] = useState(readCursorYoloMode);

  useEffect(() => subscribeCursorYoloMode(() => setYoloEnabledState(readCursorYoloMode())), []);

  const setYoloEnabled = useCallback((enabled: boolean) => {
    writeCursorYoloMode(enabled);
    setYoloEnabledState(enabled);
  }, []);

  return { yoloEnabled, setYoloEnabled };
};
