import { ipcBridge } from '@/common';
import { joinPath } from '@/common/chat/chatLib';
import { LoadingTwo } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';

const CURSOR_PROJECTS_SEGMENT = '/.cursor/projects/';

export const toPosixLocalPath = (value: string): string => {
  const withoutScheme = value.replace(/^file:\/\/\/?/i, '');
  const posix = withoutScheme.replace(/\\/g, '/');
  return /^\/[A-Za-z]:\//.test(posix) ? posix.slice(1) : posix;
};

/**
 * Cursor CLI writes generated images under `~/.cursor/projects/<slug>/`, which
 * is outside the AionUI conversation workspace. Use that project directory as
 * the fs sandbox so `/api/fs/image-base64` can read the file without a 403.
 */
export const resolveLocalImageFsWorkspace = (
  absolutePath: string,
  conversationWorkspace?: string
): string | undefined => {
  const posix = toPosixLocalPath(absolutePath);
  const cursorIdx = posix.toLowerCase().indexOf(CURSOR_PROJECTS_SEGMENT);
  if (cursorIdx >= 0) {
    const after = posix.slice(cursorIdx + CURSOR_PROJECTS_SEGMENT.length);
    const slug = after.split('/')[0];
    if (slug) {
      return posix.slice(0, cursorIdx + CURSOR_PROJECTS_SEGMENT.length + slug.length);
    }
  }
  return conversationWorkspace || undefined;
};

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className }) => {
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(src);
  // Resolve relative image paths (e.g. ![](./chart.png)) against the conversation
  // workspace = the agent cwd, and pass it as the fs sandbox workspace. Outside a
  // conversation (settings markdown) there is no workspace, so the src is sent
  // through unchanged — matching the previous default root of ''.
  const root = useConversationContextSafe()?.workspace ?? '';

  const posixSrc = useMemo(() => {
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) return src;
    return toPosixLocalPath(src);
  }, [src]);

  const absolutePath = useMemo(() => {
    if (!root) return posixSrc;
    if (
      posixSrc.startsWith('http') ||
      posixSrc.startsWith('data:') ||
      posixSrc.startsWith('/') ||
      posixSrc.startsWith('file:') ||
      posixSrc.startsWith('blob:') ||
      /^[A-Za-z]:/.test(posixSrc)
    ) {
      return posixSrc;
    }
    return joinPath(root, posixSrc);
  }, [posixSrc, root]);

  const fsWorkspace = useMemo(
    () => resolveLocalImageFsWorkspace(absolutePath, root || undefined),
    [absolutePath, root]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const read = (workspace?: string) => ipcBridge.fs.getImageBase64.invoke({ path: absolutePath, workspace });

    void (async () => {
      try {
        let base64: string | null;
        try {
          base64 = await read(fsWorkspace);
        } catch (error) {
          const canRetryWithoutWorkspace =
            typeof fsWorkspace === 'string' && fsWorkspace.toLowerCase().includes(CURSOR_PROJECTS_SEGMENT);
          if (!canRetryWithoutWorkspace) throw error;
          base64 = await read(undefined);
        }
        if (cancelled) return;
        if (base64) setUrl(base64);
      } catch (error) {
        if (!cancelled) {
          console.error('[LocalImageView] Failed to load image:', {
            path: absolutePath,
            error,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absolutePath, fsWorkspace]);
  if (loading)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LoadingTwo
          className='loading'
          style={{ display: 'flex' }}
          theme='outline'
          size='14'
          fill={iconColors.primary}
          strokeWidth={2}
        />
        <span>{alt}</span>
      </span>
    );
  return <img src={url} alt={alt} className={className} />;
};

export default LocalImageView;
