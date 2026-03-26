import type { Conversation, Message, Folder } from '@/types';

export const API_BASE = import.meta.env.VITE_API_URL || '';

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
  listConversations: (): Promise<Conversation[]> => fetchJSON<Conversation[]>('/api/conversations'),

  createConversation: (title = 'Новый чат'): Promise<Conversation> =>
    fetchJSON<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getMessages: (cid: string): Promise<Message[]> => fetchJSON<Message[]>(`/api/conversations/${cid}/messages`),

  updateConversation: (cid: string, title: string): Promise<Conversation> =>
    fetchJSON<Conversation>(`/api/conversations/${cid}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (cid: string): Promise<void> =>
    fetchJSON<void>(`/api/conversations/${cid}`, { method: 'DELETE' }),

  moveConversation: (cid: string, folderId: string | null): Promise<Conversation> =>
    fetchJSON<Conversation>(`/api/conversations/${cid}/folder`, {
      method: 'PUT',
      body: JSON.stringify({ folder_id: folderId }),
    }),

  // ── Folders ──

  listFolders: (): Promise<Folder[]> => fetchJSON<Folder[]>('/api/folders'),

  createFolder: (name: string, parentFolderId?: string | null): Promise<Folder> =>
    fetchJSON<Folder>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent_folder_id: parentFolderId ?? null }),
    }),

  renameFolder: (fid: string, name: string): Promise<Folder> =>
    fetchJSON<Folder>(`/api/folders/${fid}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  deleteFolder: (fid: string): Promise<void> =>
    fetchJSON<void>(`/api/folders/${fid}`, { method: 'DELETE' }),

  moveFolder: (fid: string, parentFolderId: string | null): Promise<Folder> =>
    fetchJSON<Folder>(`/api/folders/${fid}/move`, {
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
};

export async function* streamChat(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<{ event: string; data: any }> {
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Stream failed' }));
    throw new Error(err.detail);
  }

  if (!resp.body) {
    throw new Error('Response body is null');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          yield { event: currentEvent, data };
          currentEvent = 'message';
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}
