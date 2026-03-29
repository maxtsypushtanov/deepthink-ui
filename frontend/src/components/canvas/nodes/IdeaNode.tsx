import { memo, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { cn } from '@/lib/utils';

interface IdeaNodeData {
  label: string;
  content: string;
  color?: string;
  [key: string]: unknown;
}

export const IdeaNode = memo(function IdeaNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as IdeaNodeData;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(d.label);
  const [content, setContent] = useState(d.content);
  const updateNode = useCanvasStore((s) => s.updateNode);

  const handleSave = useCallback(() => {
    setEditing(false);
    updateNode(id, { title, content });
  }, [id, title, content, updateNode]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className={cn(
        'w-[200px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-shadow',
        selected ? 'border-foreground/30 shadow-md' : 'border-border',
        d.color ? '' : 'border-l-2 border-l-yellow-600/40',
      )}
      style={d.color ? { borderLeftColor: d.color, borderLeftWidth: 2 } : undefined}
    >
      <Handle type="target" position={Position.Top} className="canvas-handle" />
      <Handle type="source" position={Position.Bottom} className="canvas-handle" />
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <Handle type="source" position={Position.Right} className="canvas-handle" />

      {editing ? (
        <div className="space-y-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="w-full bg-transparent text-[13px] font-semibold text-foreground outline-none border-b border-border pb-1"
            placeholder="Название"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleSave}
            rows={3}
            className="w-full bg-transparent text-[11px] text-muted-foreground outline-none resize-none"
            placeholder="Описание идеи..."
          />
        </div>
      ) : (
        <>
          <div className="text-[13px] font-semibold text-foreground leading-tight truncate">
            {d.label}
          </div>
          {d.content && (
            <div className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-3">
              {d.content}
            </div>
          )}
        </>
      )}
    </div>
  );
});
