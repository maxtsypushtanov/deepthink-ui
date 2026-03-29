import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

export interface CanvasNode {
  id: string;
  type: 'idea' | 'topic' | 'artifact' | 'conversation' | 'note';
  title: string;
  content: string;
  color?: string;
  confidence?: number; // 0.0-1.0, controls opacity/size
  conversationId?: string;
  artifactId?: string;
  position: { x: number; y: number };
  createdAt: string;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  isOpen: boolean;

  openCanvas: () => void;
  closeCanvas: () => void;
  toggleCanvas: () => void;

  addNode: (node: Omit<CanvasNode, 'id' | 'createdAt'>) => string;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;

  addEdge: (source: string, target: string, label?: string) => void;
  removeEdge: (id: string) => void;

  generateFromConversations: (
    conversations: Array<{ id: string; title: string }>,
    messages: Array<{ conversation_id: string; content: string; role: string }>,
  ) => void;

  generateFromNeuronMemory: () => Promise<void>;
  addFromMessage: (content: string, conversationId: string) => void;
}

// Common Russian/English stop-words for topic extraction
const STOP_WORDS = new Set([
  // Russian
  'и', 'в', 'на', 'с', 'по', 'не', 'что', 'это', 'как', 'а', 'то', 'все', 'он', 'она',
  'они', 'мы', 'вы', 'я', 'но', 'да', 'нет', 'из', 'за', 'от', 'до', 'для', 'при',
  'так', 'ещё', 'еще', 'уже', 'тоже', 'тут', 'там', 'его', 'её', 'их', 'этот', 'эта',
  'эти', 'тот', 'та', 'те', 'быть', 'был', 'была', 'было', 'были', 'будет', 'есть',
  'чтобы', 'если', 'когда', 'где', 'кто', 'чем', 'или', 'ли', 'же', 'бы', 'мне',
  'можно', 'нужно', 'надо', 'может', 'очень', 'более', 'себя', 'свой', 'свою',
  'только', 'потому', 'также', 'какой', 'какая', 'какие', 'каких', 'которые', 'который',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on',
  'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
  'but', 'and', 'or', 'if', 'while', 'about', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
  'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
]);

function extractTopics(texts: string[]): Map<string, number> {
  const wordCounts = new Map<string, number>();

  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    const seen = new Set<string>();
    for (const word of words) {
      if (!seen.has(word)) {
        seen.add(word);
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }
  }

  // Keep words that appear in at least 2 texts
  const topics = new Map<string, number>();
  for (const [word, count] of wordCounts) {
    if (count >= 2) {
      topics.set(word, count);
    }
  }
  return topics;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      isOpen: false,

      openCanvas: () => set({ isOpen: true }),
      closeCanvas: () => set({ isOpen: false }),
      toggleCanvas: () => set((s) => ({ isOpen: !s.isOpen })),

      addNode: (node) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newNode: CanvasNode = { ...node, id, createdAt: now };
        set((s) => ({ nodes: [...s.nodes, newNode] }));
        return id;
      },

      updateNode: (id, updates) => {
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
        }));
      },

      removeNode: (id) => {
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        }));
      },

      updateNodePosition: (id, position) => {
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
        }));
      },

      addEdge: (source, target, label) => {
        const existing = get().edges.find(
          (e) => e.source === source && e.target === target,
        );
        if (existing) return;
        const id = generateId();
        set((s) => ({ edges: [...s.edges, { id, source, target, label }] }));
      },

      removeEdge: (id) => {
        set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
      },

      generateFromConversations: (conversations, messages) => {
        if (conversations.length === 0) return;

        // Group messages by conversation
        const msgByConv = new Map<string, string[]>();
        for (const msg of messages) {
          if (msg.role === 'user') {
            const arr = msgByConv.get(msg.conversation_id) || [];
            arr.push(msg.content);
            msgByConv.set(msg.conversation_id, arr);
          }
        }

        // Place conversations in a circle
        const cx = 400;
        const cy = 400;
        const radius = Math.max(250, conversations.length * 40);
        const newNodes: CanvasNode[] = [];
        const newEdges: CanvasEdge[] = [];

        conversations.forEach((conv, i) => {
          const angle = (2 * Math.PI * i) / conversations.length - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          newNodes.push({
            id: `conv-${conv.id}`,
            type: 'conversation',
            title: conv.title || 'Беседа',
            content: '',
            conversationId: conv.id,
            position: { x, y },
            createdAt: new Date().toISOString(),
          });
        });

        // Extract shared topics
        const allTexts: string[] = [];
        const textToConvIds = new Map<string, string[]>();

        for (const conv of conversations) {
          const texts = msgByConv.get(conv.id) || [];
          const combined = texts.join(' ');
          if (combined.trim()) {
            allTexts.push(combined);
            // Track which conversations contributed
            for (const [word] of extractTopics([combined])) {
              const convIds = textToConvIds.get(word) || [];
              convIds.push(conv.id);
              textToConvIds.set(word, convIds);
            }
          }
        }

        const topics = extractTopics(allTexts);

        // Sort by frequency, take top 15
        const topTopics = [...topics.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15);

        // Place topic nodes near center
        topTopics.forEach(([topic], i) => {
          const angle = (2 * Math.PI * i) / topTopics.length;
          const r = Math.max(80, topTopics.length * 15);
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const nodeId = `topic-${topic}`;

          newNodes.push({
            id: nodeId,
            type: 'topic',
            title: topic,
            content: '',
            position: { x, y },
            createdAt: new Date().toISOString(),
          });

          // Connect conversations that mention this topic
          const relatedConvIds = textToConvIds.get(topic) || [];
          for (const convId of relatedConvIds) {
            newEdges.push({
              id: generateId(),
              source: `conv-${convId}`,
              target: nodeId,
            });
          }
        });

        set({ nodes: newNodes, edges: newEdges });
      },

      generateFromNeuronMemory: async () => {
        const resp = await fetch('/api/neuron/knowledge-graph');
        if (!resp.ok) return;
        const data = await resp.json();

        if (!data.nodes || data.nodes.length <= 1) return;

        // Layout: user in center, categories in inner ring, memories in outer ring, topics scattered
        const centerX = 600;
        const centerY = 400;
        const newNodes: CanvasNode[] = [];
        const newEdges: CanvasEdge[] = [];

        const categoryNodes = data.nodes.filter((n: any) => n.type === 'category');
        const memoryNodes = data.nodes.filter((n: any) => n.type === 'memory');
        const topicNodes = data.nodes.filter((n: any) => n.type === 'topic');
        const userNode = data.nodes.find((n: any) => n.type === 'user');

        // User at center
        if (userNode) {
          newNodes.push({
            id: userNode.id,
            type: 'idea',
            title: userNode.title,
            content: 'Центр графа знаний Нейрона',
            position: { x: centerX, y: centerY },
            createdAt: new Date().toISOString(),
          });
        }

        // Categories in inner ring
        const categoryAngles: Record<string, number> = {};
        categoryNodes.forEach((cat: any, i: number) => {
          const angle = (i / categoryNodes.length) * Math.PI * 2 - Math.PI / 2;
          categoryAngles[cat.id] = angle;
          const radius = 250;
          newNodes.push({
            id: cat.id,
            type: 'topic',
            title: cat.title,
            content: '',
            position: {
              x: centerX + Math.cos(angle) * radius,
              y: centerY + Math.sin(angle) * radius,
            },
            createdAt: new Date().toISOString(),
          });
        });

        // Memory items in outer ring, grouped by category
        const memsByCat: Record<string, any[]> = {};
        for (const e of data.edges) {
          if (typeof e.source === 'string' && e.source.startsWith('cat_')) {
            if (!memsByCat[e.source]) memsByCat[e.source] = [];
            const mem = memoryNodes.find((n: any) => n.id === e.target);
            if (mem) memsByCat[e.source].push(mem);
          }
        }

        for (const [catId, mems] of Object.entries(memsByCat)) {
          const baseAngle = categoryAngles[catId] || 0;
          const spread = Math.PI * 0.4;
          (mems as any[]).forEach((mem: any, i: number) => {
            const count = (mems as any[]).length;
            const angle = baseAngle - spread / 2 + (spread / Math.max(count - 1, 1)) * i;
            const radius = 450 + (i % 2) * 60;
            newNodes.push({
              id: mem.id,
              type: 'note',
              title: mem.title,
              content: mem.content,
              confidence: mem.confidence ?? 1.0,
              position: {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
              },
              createdAt: new Date().toISOString(),
            });
          });
        }

        // Topics scattered around outer ring
        topicNodes.forEach((topic: any, i: number) => {
          const angle = (i / Math.max(topicNodes.length, 1)) * Math.PI * 2;
          const radius = 600 + (i % 3) * 40;
          newNodes.push({
            id: topic.id,
            type: 'topic',
            title: topic.title,
            content: topic.content || '',
            position: {
              x: centerX + Math.cos(angle) * radius,
              y: centerY + Math.sin(angle) * radius,
            },
            createdAt: new Date().toISOString(),
          });
        });

        // Edges
        for (const e of data.edges) {
          newEdges.push({
            id: generateId(),
            source: e.source,
            target: e.target,
            label: e.label,
          });
        }

        set({ nodes: newNodes, edges: newEdges });
      },

      addFromMessage: (content, conversationId) => {
        const { nodes } = get();
        // Place near center, with a slight offset based on existing count
        const offset = nodes.length * 30;
        const x = 200 + (offset % 600);
        const y = 200 + Math.floor(offset / 600) * 120;

        const title =
          content.length > 50 ? content.slice(0, 50) + '...' : content;

        get().addNode({
          type: 'note',
          title,
          content,
          conversationId,
          position: { x, y },
        });
      },
    }),
    {
      name: 'deepthink-canvas',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
    },
  ),
);
