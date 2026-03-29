import { create } from 'zustand';
import { generateId } from '@/lib/utils';

export type ArtifactType = 'code' | 'document' | 'table' | 'mermaid' | 'image';

export interface ArtifactVersion {
  content: string;
  timestamp: string;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  versions: ArtifactVersion[];
  messageId: string;
  createdAt: string;
}

interface ArtifactState {
  artifacts: Artifact[];
  activeArtifactId: string | null;
  panelOpen: boolean;

  addArtifact: (artifact: Omit<Artifact, 'id' | 'versions' | 'createdAt'>) => string;
  updateArtifact: (id: string, content: string) => void;
  setActive: (id: string | null) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  removeArtifactsForMessage: (messageId: string) => void;
}

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifacts: [],
  activeArtifactId: null,
  panelOpen: false,

  addArtifact: (artifact) => {
    const id = generateId();
    const now = new Date().toISOString();
    const newArtifact: Artifact = {
      ...artifact,
      id,
      versions: [{ content: artifact.content, timestamp: now }],
      createdAt: now,
    };
    set((s) => ({ artifacts: [...s.artifacts, newArtifact] }));
    return id;
  },

  updateArtifact: (id, content) => {
    set((s) => ({
      artifacts: s.artifacts.map((a) =>
        a.id === id
          ? {
              ...a,
              content,
              versions: [...a.versions, { content, timestamp: new Date().toISOString() }],
            }
          : a,
      ),
    }));
  },

  setActive: (id) => {
    set({ activeArtifactId: id });
    if (id && !get().panelOpen) set({ panelOpen: true });
  },

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false, activeArtifactId: null }),

  removeArtifactsForMessage: (messageId) => {
    set((s) => ({
      artifacts: s.artifacts.filter((a) => a.messageId !== messageId),
    }));
  },
}));
