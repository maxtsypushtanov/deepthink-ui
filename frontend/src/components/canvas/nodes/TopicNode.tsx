import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface TopicNodeData {
  label: string;
  confidence?: number;
  [key: string]: unknown;
}

export const TopicNode = memo(function TopicNode({ data, selected }: NodeProps) {
  const d = data as unknown as TopicNodeData;
  const confidence = (d.confidence as number) ?? 1.0;
  const opacity = 0.4 + confidence * 0.6;

  return (
    <div
      style={{ opacity }}
      className={cn(
        'rounded-full border bg-muted/60 px-3.5 py-1.5 text-xs text-muted-foreground transition-all',
        selected ? 'border-foreground/30 shadow-md' : 'border-border/60',
      )}
    >
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <Handle type="source" position={Position.Right} className="canvas-handle" />

      <span className="select-none whitespace-nowrap">{d.label}</span>
    </div>
  );
});
