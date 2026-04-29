export interface StreamCallbacks {
  onStatus?: (status: string, data?: unknown) => void;
  onDelta?: (delta: string) => void;
  onEvent?: (event: string, data: unknown) => void;
  onDone?: (data: unknown) => void;
  onError?: (message: string) => void;
}

export async function streamChat(payload: Record<string, unknown>, callbacks: StreamCallbacks, signal?: AbortSignal) {
  const res = await fetch('/api/deck/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await res.text() || `Stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleBlock = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch {}
    callbacks.onEvent?.(event, data);
    if (event === 'status') callbacks.onStatus?.(typeof data === 'object' && data && 'phase' in data ? String((data as any).phase) : raw, data);
    if (event === 'delta') callbacks.onDelta?.(typeof data === 'object' && data && 'delta' in data ? String((data as any).delta) : raw);
    if (event === 'done') callbacks.onDone?.(data);
    if (event === 'error') callbacks.onError?.(typeof data === 'object' && data && 'error' in data ? String((data as any).error) : raw);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    parts.forEach(handleBlock);
  }
  if (buffer.trim()) handleBlock(buffer);
}
