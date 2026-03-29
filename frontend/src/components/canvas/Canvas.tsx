import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { X, StickyNote, Lightbulb, LayoutGrid, MessagesSquare, Brain } from 'lucide-react';
import { useCanvasStore, type CanvasNode, type CanvasEdge } from '@/stores/canvasStore';
import { useChatStore } from '@/stores/chatStore';
import { api } from '@/lib/api';

import { IdeaNode } from './nodes/IdeaNode';
import { TopicNode } from './nodes/TopicNode';
import { ConversationNode } from './nodes/ConversationNode';
import { NoteNode } from './nodes/NoteNode';
import { ArtifactNode } from './nodes/ArtifactNode';

const nodeTypes: NodeTypes = {
  idea: IdeaNode,
  topic: TopicNode,
  conversation: ConversationNode,
  note: NoteNode,
  artifact: ArtifactNode,
};

// Convert store nodes to ReactFlow nodes
function toFlowNodes(storeNodes: CanvasNode[]): Node[] {
  return storeNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.title,
      content: n.content,
      color: n.color,
      confidence: n.confidence,
      conversationId: n.conversationId,
      artifactId: n.artifactId,
    },
  }));
}

// Convert store edges to ReactFlow edges
function toFlowEdges(storeEdges: CanvasEdge[]): Edge[] {
  return storeEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: true,
    style: { strokeDasharray: '5 3' },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
  }));
}

// Simple force-directed layout
function forceLayout(
  nodes: Node[],
  edges: Edge[],
  iterations = 50,
): Node[] {
  if (nodes.length === 0) return nodes;
  // Skip force layout for large graphs -- O(n^2) repulsion is too expensive
  if (nodes.length > 100) return nodes;
  // Reduce iterations for medium-sized graphs
  if (nodes.length > 50) iterations = 20;

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    positions.set(n.id, { ...n.position });
  }

  const REPULSION = 8000;
  const ATTRACTION = 0.005;
  const DAMPING = 0.9;
  const velocities = new Map<string, { vx: number; vy: number }>();
  for (const n of nodes) {
    velocities.set(n.id, { vx: 0, vy: 0 });
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions.get(nodes[i].id)!;
        const b = positions.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(30, Math.sqrt(dx * dx + dy * dy));
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        const va = velocities.get(nodes[i].id)!;
        const vb = velocities.get(nodes[j].id)!;
        va.vx += fx;
        va.vy += fy;
        vb.vx -= fx;
        vb.vy -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const force = dist * ATTRACTION;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      const va = velocities.get(edge.source)!;
      const vb = velocities.get(edge.target)!;
      va.vx += fx;
      va.vy += fy;
      vb.vx -= fx;
      vb.vy -= fy;
    }

    // Apply velocities with damping
    for (const n of nodes) {
      const pos = positions.get(n.id)!;
      const vel = velocities.get(n.id)!;
      vel.vx *= DAMPING;
      vel.vy *= DAMPING;
      pos.x += vel.vx;
      pos.y += vel.vy;
    }
  }

  // Center the layout
  let minX = Infinity, minY = Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
  }
  const offsetX = 100 - minX;
  const offsetY = 100 - minY;

  return nodes.map((n) => {
    const pos = positions.get(n.id)!;
    return { ...n, position: { x: pos.x + offsetX, y: pos.y + offsetY } };
  });
}

// Context menu state
interface ContextMenu {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  nodeId?: string;
  nodeType?: string;
  conversationId?: string;
}

export function Canvas() {
  const storeNodes = useCanvasStore((s) => s.nodes);
  const storeEdges = useCanvasStore((s) => s.edges);
  const closeCanvas = useCanvasStore((s) => s.closeCanvas);
  const addNodeToStore = useCanvasStore((s) => s.addNode);
  const updateNodePosition = useCanvasStore((s) => s.updateNodePosition);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const addEdgeToStore = useCanvasStore((s) => s.addEdge);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const generateFromConversations = useCanvasStore((s) => s.generateFromConversations);

  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const selectConversation = useChatStore((s) => s.selectConversation);

  const flowNodes = useMemo(() => toFlowNodes(storeNodes), [storeNodes]);
  const flowEdges = useMemo(() => toFlowEdges(storeEdges), [storeEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync store -> local state
  useEffect(() => {
    setNodes(toFlowNodes(storeNodes));
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(toFlowEdges(storeEdges));
  }, [storeEdges, setEdges]);

  // Auto-populate canvas: try Neuron knowledge graph first, fall back to conversations
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    const store = useCanvasStore.getState();
    if (store.nodes.length > 0) {
      autoPopulatedRef.current = true;
      return;
    }

    autoPopulatedRef.current = true;

    // Try Neuron memory graph first
    fetch('/api/neuron/knowledge-graph')
      .then((r) => r.json())
      .then((data) => {
        if (data.nodes && data.nodes.length > 1) {
          // Neuron has accumulated memory — show knowledge graph
          store.generateFromNeuronMemory();
        } else {
          // No memory yet — fall back to conversation-based graph
          fallbackToConversations(store);
        }
      })
      .catch(() => {
        fallbackToConversations(store);
      });

    function fallbackToConversations(store: ReturnType<typeof useCanvasStore.getState>) {
      const chatStore = useChatStore.getState();
      if (chatStore.conversations.length === 0) return;

      const recentConvs = chatStore.conversations.slice(0, 10);
      Promise.all(
        recentConvs.map(async (conv) => {
          try {
            const msgs = await api.getMessages(conv.id);
            return { conv, msgs };
          } catch {
            return { conv, msgs: [] };
          }
        }),
      ).then((results) => {
        if (useCanvasStore.getState().nodes.length > 0) return;

        const convData = results.map((r) => ({ id: r.conv.id, title: r.conv.title }));
        const allMessages = results.flatMap((r) =>
          r.msgs.map((m: any) => ({
            conversation_id: m.conversation_id,
            content: m.content,
            role: m.role,
          })),
        );
        store.generateFromConversations(convData, allMessages);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<any>(null);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Persist position changes to store
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          updateNodePosition(change.id, change.position);
        }
      }
    },
    [onNodesChange, updateNodePosition],
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      for (const change of changes) {
        if (change.type === 'remove') {
          removeEdge(change.id);
        }
      }
    },
    [onEdgesChange, removeEdge],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { strokeDasharray: '5 3' } }, eds));
      if (connection.source && connection.target) {
        addEdgeToStore(connection.source, connection.target);
      }
    },
    [setEdges, addEdgeToStore],
  );

  const addNoteAt = useCallback(
    (x: number, y: number) => {
      addNodeToStore({
        type: 'note',
        title: 'Новая заметка',
        content: '',
        position: { x, y },
      });
    },
    [addNodeToStore],
  );

  const addIdeaAt = useCallback(
    (x: number, y: number) => {
      addNodeToStore({
        type: 'idea',
        title: 'Новая идея',
        content: '',
        position: { x, y },
      });
    },
    [addNodeToStore],
  );

  // Double-click on empty canvas -> add note
  const handlePaneDoubleClick = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      if (!reactFlowInstance.current) return;
      const pos = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNoteAt(pos.x, pos.y);
    },
    [addNoteAt],
  );

  // Right-click context menu
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      if (!reactFlowInstance.current) return;
      const pos = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: pos.x,
        flowY: pos.y,
      });
    },
    [],
  );

  const handleNodeContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent, node: Node) => {
      event.preventDefault();
      const storeNode = storeNodes.find((n) => n.id === node.id);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: node.position.x,
        flowY: node.position.y,
        nodeId: node.id,
        nodeType: storeNode?.type,
        conversationId: storeNode?.conversationId,
      });
    },
    [storeNodes],
  );

  const handleAutoLayout = useCallback(() => {
    const laid = forceLayout(nodes, edges);
    setNodes(laid);
    // Persist positions
    for (const n of laid) {
      updateNodePosition(n.id, n.position);
    }
  }, [nodes, edges, setNodes, updateNodePosition]);

  const handleGenerate = useCallback(() => {
    generateFromConversations(
      conversations.map((c) => ({ id: c.id, title: c.title })),
      messages.map((m) => ({
        conversation_id: m.conversation_id,
        content: m.content,
        role: m.role,
      })),
    );
  }, [conversations, messages, generateFromConversations]);

  const handleGenerateKnowledgeGraph = useCallback(() => {
    useCanvasStore.getState().generateFromNeuronMemory();
  }, []);

  const handleAddNote = useCallback(() => {
    addNoteAt(200 + Math.random() * 300, 200 + Math.random() * 300);
  }, [addNoteAt]);

  const handleAddIdea = useCallback(() => {
    addIdeaAt(200 + Math.random() * 300, 200 + Math.random() * 300);
  }, [addIdeaAt]);

  // Context menu actions
  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      switch (action) {
        case 'add-note':
          addNoteAt(contextMenu.flowX, contextMenu.flowY);
          break;
        case 'add-idea':
          addIdeaAt(contextMenu.flowX, contextMenu.flowY);
          break;
        case 'delete':
          if (contextMenu.nodeId) removeNode(contextMenu.nodeId);
          break;
        case 'go-to-conversation':
          if (contextMenu.conversationId) {
            selectConversation(contextMenu.conversationId);
            closeCanvas();
          }
          break;
      }
      setContextMenu(null);
    },
    [contextMenu, addNoteAt, addIdeaAt, removeNode, selectConversation, closeCanvas],
  );

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCanvas();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [closeCanvas]);

  return (
    <div className="fixed inset-0 z-50 bg-background animate-fade-in" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onDoubleClick={handlePaneDoubleClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        onInit={(instance) => { reactFlowInstance.current = instance; }}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="canvas-flow"
        deleteKeyCode="Delete"
        defaultEdgeOptions={{
          animated: true,
          style: { strokeDasharray: '5 3' },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case 'idea': return 'hsl(45, 20%, 50%)';
              case 'topic': return 'hsl(0, 0%, 50%)';
              case 'conversation': return 'hsl(210, 10%, 50%)';
              case 'artifact': return 'hsl(260, 10%, 50%)';
              default: return 'hsl(0, 0%, 40%)';
            }
          }}
          maskColor="hsl(var(--background) / 0.85)"
        />

        {/* Toolbar */}
        <Panel position="top-center">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-card/95 backdrop-blur-sm px-2 py-1.5 shadow-lg">
            <span className="text-[13px] font-medium text-foreground px-2 select-none">
              Пространство мышления
            </span>
            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={handleAddNote}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <StickyNote className="h-3.5 w-3.5" />
              Заметка
            </button>
            <button
              onClick={handleAddIdea}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              Идея
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={handleGenerateKnowledgeGraph}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Brain className="h-3.5 w-3.5" />
              Граф знаний
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={handleAutoLayout}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Автолейаут
            </button>
            <button
              onClick={handleGenerate}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              Из бесед
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={closeCanvas}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Закрыть (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[60] min-w-[180px] rounded-xl border border-border bg-card shadow-xl p-1 animate-fade-in-scale"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.nodeId ? (
            <>
              <button
                onClick={() => handleContextAction('delete')}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Удалить
              </button>
              {contextMenu.nodeType === 'conversation' && contextMenu.conversationId && (
                <button
                  onClick={() => handleContextAction('go-to-conversation')}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  Перейти к беседе
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => handleContextAction('add-note')}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <StickyNote className="h-3.5 w-3.5" />
                Добавить заметку здесь
              </button>
              <button
                onClick={() => handleContextAction('add-idea')}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                Добавить идею здесь
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
