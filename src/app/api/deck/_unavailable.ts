export function isKnownUnavailableError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /does not currently expose/i.test(msg)
    || /failed with 404\b/i.test(msg)
    || /\bHTTP 404\b/i.test(msg);
}

export function statusForUnexpectedError(err: unknown): number {
  const direct = (err as { status?: unknown })?.status;
  if (typeof direct === 'number' && direct >= 400 && direct < 600) return direct;
  const msg = err instanceof Error ? err.message : String(err);
  const parsed = /(?:failed with|HTTP) (\d{3})\b/.exec(msg)?.[1];
  const status = parsed ? Number(parsed) : 502;
  return status >= 400 && status < 600 ? status : 502;
}