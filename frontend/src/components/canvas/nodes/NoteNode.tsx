import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { cn } from '@/lib/utils';

interface NoteNodeData {
  label: string;
  content: string;
  confidence?: number;
  [key: string]: unknown;
}

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NoteNodeData;
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(d.content || d.label);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateNode = useCanvasStore((s) => s.updateNode);

  useEffect(() => {
    setContent(d.content || d.label);
  }, [d.content, d.label]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleSave = useCallback(() => {
    setEditing(false);
    const title = content.length > 50 ? content.slice(0, 50) + '...' : content;
    updateNode(id, { title, content });
  }, [id, content, updateNode]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  // Confidence-based opacity: 1.0 = full, 0.3 = nearly invisible
  const confidence = d.confidence ?? 1.0;
  const opacity = 0.4 + confidence * 0.6; // range: 0.4 to 1.0

  return (
    <div
      onDoubleClick={handleDoubleClick}
      style={{ opacity }}
      className={cn(
        'w-[180px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-all',
        selected ? 'border-foreground/30 shadow-md' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Top} className="canvas-handle" />
      <Handle type="source" position={Position.Bottom} className="canvas-handle" />
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <Handle type="source" position={Position.Right} className="canvas-handle" />

      {editing ? (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleSave();
          }}
          rows={4}
          className="w-full bg-transparent text-[12px] text-foreground outline-none resize-none leading-relaxed"
          placeholder="Заметка..."
        />
      ) : (
        <div className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap line-clamp-6">
          {d.content || d.label || 'Пустая заметка'}
        </div>
      )}
    </div>
  );
});
