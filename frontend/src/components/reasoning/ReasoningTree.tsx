import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TreeNode } from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  nodes: TreeNode[];
}

// Custom node component
function TreeNodeComponent({ data }: { data: { label: string; score: number; thought?: string } }) {
  const scoreColor =
    data.score >= 0.7 ? 'text-green-400 border-green-500/30' :
    data.score >= 0.4 ? 'text-yellow-400 border-yellow-500/30' :
    'text-red-400 border-red-500/30';

  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2 shadow-md', scoreColor)} style={{ minWidth: 150, maxWidth: 220 }}>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{data.label}</span>
        <span className={cn('rounded-full bg-card px-1.5 py-0.5 text-[10px] font-mono font-bold', scoreColor)}>
          {data.score.toFixed(2)}
        </span>
      </div>
      {data.thought && (
        <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{data.thought}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  treeNode: TreeNodeComponent,
};

export function ReasoningTree({ nodes: treeNodes }: Props) {
  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // Group by level
    const levels: Record<number, TreeNode[]> = {};
    for (const n of treeNodes) {
      (levels[n.level] ||= []).push(n);
    }

    const levelKeys = Object.keys(levels).map(Number).sort();

    for (const level of levelKeys) {
      const nodesAtLevel = levels[level];
      const y = level * 120 + 50;

      nodesAtLevel.forEach((tn, i) => {
        const x = (i - (nodesAtLevel.length - 1) / 2) * 250 + 400;
        rfNodes.push({
          id: tn.id,
          type: 'treeNode',
          position: { x, y },
          data: {
            label: tn.id,
            score: tn.score,
            thought: tn.thought,
          },
        });

        if (tn.parent) {
          rfEdges.push({
            id: `${tn.parent}-${tn.id}`,
            source: tn.parent,
            target: tn.id,
            style: { stroke: 'hsl(var(--muted-foreground))' },
            animated: true,
          });
        }
      });
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [treeNodes]);

  if (treeNodes.length === 0) return null;

  return (
    <div className="h-64 w-full rounded-lg border border-border bg-card/50 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="hsl(var(--border))" />
        <Controls className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
      </ReactFlow>
    </div>
  );
}
