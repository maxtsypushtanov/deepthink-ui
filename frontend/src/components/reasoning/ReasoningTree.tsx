import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TreeNode } from '@/types';
import { cn } from '@/lib/utils';

// ── Layout constants ──

const NODE_WIDTH = 260;
const NODE_HEIGHT = 72;
const H_GAP = 28;       // min horizontal gap between sibling cards
const V_GAP = 48;       // min vertical gap between levels
const PADDING_X = 40;   // left/right canvas padding
const PADDING_Y = 32;   // top canvas padding

interface Props {
  nodes: TreeNode[];
}

// ── Custom node component ──

function TreeNodeComponent({ data }: { data: { label: string; score: number; thought?: string; level: number } }) {
  const scoreColor =
    data.score >= 0.7 ? 'text-green-400' :
    data.score >= 0.4 ? 'text-yellow-400' :
    'text-red-400';

  const levelColors = ['border-blue-500/40', 'border-purple-500/40', 'border-orange-500/40', 'border-green-500/40'];
  const levelColor = levelColors[data.level % levelColors.length];

  return (
    <div
      className={cn('rounded-lg border bg-card px-3 py-2 shadow-md', levelColor)}
      style={{ width: NODE_WIDTH, position: 'relative', zIndex: 2 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{data.label}</span>
        {data.score !== 0.5 && (
          <span className={cn('rounded-full bg-card px-1.5 py-0.5 text-[10px] font-mono font-bold', scoreColor)}>
            {data.score.toFixed(2)}
          </span>
        )}
      </div>
      {data.thought && (
        <p className="mt-1 text-[10px] text-muted-foreground line-clamp-3" title={data.thought}>
          {data.thought}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  treeNode: TreeNodeComponent,
};

// ── Tree layout algorithm ──

interface LayoutNode {
  id: string;
  treeNode: TreeNode;
  children: LayoutNode[];
  x: number;
  y: number;
  subtreeWidth: number;
}

/**
 * Bottom-up tree layout:
 * 1. Build a tree of LayoutNodes from flat TreeNode list
 * 2. Compute subtree widths (leaf = NODE_WIDTH, parent = sum of children + gaps)
 * 3. Assign positions top-down: each parent centered over its children
 */
function layoutTree(treeNodes: TreeNode[]): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  if (treeNodes.length === 0) return { positions: new Map(), width: 0, height: 0 };

  // Index by id
  const byId = new Map<string, TreeNode>();
  for (const n of treeNodes) byId.set(n.id, n);

  // Build tree structure
  const layoutById = new Map<string, LayoutNode>();
  for (const n of treeNodes) {
    layoutById.set(n.id, { id: n.id, treeNode: n, children: [], x: 0, y: 0, subtreeWidth: 0 });
  }
  const roots: LayoutNode[] = [];
  for (const n of treeNodes) {
    const ln = layoutById.get(n.id)!;
    if (n.parent && layoutById.has(n.parent)) {
      layoutById.get(n.parent)!.children.push(ln);
    } else {
      roots.push(ln);
    }
  }

  // 1. Compute subtree widths bottom-up
  function computeWidth(node: LayoutNode): number {
    if (node.children.length === 0) {
      node.subtreeWidth = NODE_WIDTH;
      return NODE_WIDTH;
    }
    let total = 0;
    for (const child of node.children) {
      total += computeWidth(child);
    }
    total += (node.children.length - 1) * H_GAP;
    node.subtreeWidth = Math.max(NODE_WIDTH, total);
    return node.subtreeWidth;
  }

  // Virtual root to handle multiple roots uniformly
  let totalRootWidth = 0;
  for (const root of roots) {
    totalRootWidth += computeWidth(root);
  }
  totalRootWidth += Math.max(0, roots.length - 1) * H_GAP;

  // 2. Assign positions top-down
  function assignPositions(node: LayoutNode, left: number, depth: number): void {
    node.y = PADDING_Y + depth * (NODE_HEIGHT + V_GAP);
    // Center the node within its allocated subtree band
    node.x = left + (node.subtreeWidth - NODE_WIDTH) / 2;

    let childLeft = left;
    for (const child of node.children) {
      assignPositions(child, childLeft, depth + 1);
      childLeft += child.subtreeWidth + H_GAP;
    }
  }

  let curLeft = PADDING_X;
  for (const root of roots) {
    assignPositions(root, curLeft, 0);
    curLeft += root.subtreeWidth + H_GAP;
  }

  // Collect positions
  const positions = new Map<string, { x: number; y: number }>();
  let maxX = 0;
  let maxY = 0;
  function collect(node: LayoutNode): void {
    positions.set(node.id, { x: node.x, y: node.y });
    maxX = Math.max(maxX, node.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT);
    for (const child of node.children) collect(child);
  }
  for (const root of roots) collect(root);

  return { positions, width: maxX + PADDING_X, height: maxY + PADDING_Y };
}

// ── Component ──

export function ReasoningTree({ nodes: treeNodes }: Props) {
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // Group by level for labeling & best-branch detection
    const levels: Record<number, TreeNode[]> = {};
    for (const n of treeNodes) {
      (levels[n.level] ||= []).push(n);
    }

    // Run layout
    const { positions } = layoutTree(treeNodes);

    for (const tn of treeNodes) {
      const pos = positions.get(tn.id);
      if (!pos) continue;

      const indexAtLevel = (levels[tn.level]?.indexOf(tn) ?? 0) + 1;

      rfNodes.push({
        id: tn.id,
        type: 'treeNode',
        position: { x: pos.x, y: pos.y },
        data: {
          label: tn.thought ? tn.thought.slice(0, 40) + (tn.thought.length > 40 ? '...' : '') : `Подход ${tn.level + 1}.${indexAtLevel}`,
          score: tn.score,
          thought: tn.thought,
          level: tn.level,
        },
        zIndex: 2,
      });

      if (tn.parent) {
        const isBest = tn.score === Math.max(...(levels[tn.level] || []).map(n => n.score));
        rfEdges.push({
          id: `${tn.parent}-${tn.id}`,
          source: tn.parent,
          target: tn.id,
          label: isBest ? '★ лучший' : '',
          labelStyle: { fill: 'hsl(var(--foreground))', fontSize: 12 },
          style: {
            stroke: isBest ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
            strokeWidth: isBest ? 2 : 1,
          },
          animated: isBest,
          zIndex: 0,
        });
      }
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [treeNodes]);

  if (treeNodes.length === 0) return null;

  return (
    <div className="w-full rounded-lg border border-border bg-card overflow-hidden" style={{ height: Math.max(350, treeNodes.length * 60 + 150) }}>
      <div className="flex items-center gap-3 px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border">
        <span>Дерево рассуждений</span>
        <span className="text-muted-foreground/50">|</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" /> &gt; 0.7
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" /> 0.4–0.7
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-400" /> &lt; 0.4
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[10px]">★</span> лучшая ветвь
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        style={{ background: 'transparent', zIndex: 0 }}
      >
        <Background gap={20} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
        <Controls
          showInteractive={false}
          className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground"
        />
      </ReactFlow>
    </div>
  );
}
