const API_BASE = import.meta.env.VITE_API_URL || '';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return resp.json();
}

// ── Conversations ──

export const api = {
  listConversations: () => fetchJSON<any[]>('/api/conversations'),

  createConversation: (title = 'Новый чат') =>
    fetchJSON<any>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getMessages: (cid: string) => fetchJSON<any[]>(`/api/conversations/${cid}/messages`),

  updateConversation: (cid: string, title: string) =>
    fetchJSON<any>(`/api/conversations/${cid}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (cid: string) =>
    fetchJSON<any>(`/api/conversations/${cid}`, { method: 'DELETE' }),

  moveConversation: (cid: string, folderId: string | null) =>
    fetchJSON<any>(`/api/conversations/${cid}/folder`, {
      method: 'PUT',
      body: JSON.stringify({ folder_id: folderId }),
    }),

  // ── Folders ──

  listFolders: () => fetchJSON<any[]>('/api/folders'),

  createFolder: (name: string, parentFolderId?: string | null) =>
    fetchJSON<any>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent_folder_id: parentFolderId ?? null }),
    }),

  renameFolder: (fid: string, name: string) =>
    fetchJSON<any>(`/api/folders/${fid}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  deleteFolder: (fid: string) =>
    fetchJSON<any>(`/api/folders/${fid}`, { method: 'DELETE' }),

  moveFolder: (fid: string, parentFolderId: string | null) =>
    fetchJSON<any>(`/api/folders/${fid}/move`, {
      method: 'PUT',
      body: JSON.stringify({ parent_folder_id: parentFolderId }),
    }),

  // ── Settings ──

  getProviders: () => fetchJSON<any[]>('/api/settings/providers'),

  saveProvider: (data: { provider: string; api_key: string; base_url?: string; enabled?: boolean }) =>
    fetchJSON<any>('/api/settings/providers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listModels: (provider: string) => fetchJSON<any[]>(`/api/models/${provider}`),

  // ── Chat (SSE) ──

  chatStream: (body: Record<string, unknown>): EventSource => {
    // We use fetch + ReadableStream instead of EventSource for POST
    // This is handled in the hook
    throw new Error('Use useChatStream hook instead');
  },
};

export async function* streamChat(
  body: Record<string, unknown>,
): AsyncGenerator<{ event: string; data: any }> {
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Stream failed' }));
    throw new Error(err.detail);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = 'message';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          yield { event: currentEvent, data };
        } catch {
          // skip malformed
        }
      }
    }
  }
}
