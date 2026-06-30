export const STREAM_RECONNECTING_MESSAGE = '连接中断，正在尝试恢复…';
export const STREAM_RECOVERY_FAILED_MESSAGE = '连接中断，已尝试恢复；请刷新会话查看最新进度。';

export interface StreamRecoveryOwner {
  streamId: number;
  profile: string;
}

export interface ActiveStreamOwner extends StreamRecoveryOwner {
  sessionId?: string;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : '';
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`.trim();
  return String(err ?? '');
}

export function isRecoverableStreamTransportError(err: unknown, explicitAbort: boolean): boolean {
  if (explicitAbort) return false;
  const name = errorName(err).toLowerCase();
  const text = errorText(err).toLowerCase();
  if (name === 'aborterror') return true;
  // Browser fetch/stream transport failures are usually TypeError (WebKit
  // "Load failed", Chromium "Failed to fetch" / "fetch failed") or a native
  // DOMException. Do not classify arbitrary Error(message) text as recoverable:
  // client-sse throws generic Error objects for non-OK HTTP responses with the
  // server body, and those need to remain visible/actionable.
  if (name === 'typeerror') {
    return /(load failed|failed to fetch|networkerror|network error|network|fetch failed|body stream|stream read|readablestream|terminated|connection (?:lost|closed|reset)|socket hang up)/i.test(text);
  }
  if (name === 'networkerror') return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return /(networkerror|network error|network connection|body stream|stream read|readablestream|terminated|connection (?:lost|closed|reset))/i.test(text);
  }
  return false;
}

export function streamErrorMessage(err: unknown, opts: { explicitAbort: boolean; recoveryFailed?: boolean }): string {
  if (isRecoverableStreamTransportError(err, opts.explicitAbort)) {
    return opts.recoveryFailed ? STREAM_RECOVERY_FAILED_MESSAGE : STREAM_RECONNECTING_MESSAGE;
  }
  return err instanceof Error ? err.message : String(err);
}

export function shouldApplyStreamRecoveryUpdate(
  active: ActiveStreamOwner | null | undefined,
  recovery: StreamRecoveryOwner,
  aborted: boolean,
): boolean {
  return !aborted && !!active && active.streamId === recovery.streamId && active.profile === recovery.profile;
}
