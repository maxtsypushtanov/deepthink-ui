import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { cn } from '@/lib/utils';

interface ConversationNodeData {
  label: string;
  conversationId?: string;
  [key: string]: unknown;
}

export const ConversationNode = memo(function ConversationNode({ data, selected }: NodeProps) {
  const d = data as unknown as ConversationNodeData;
  const selectConversation = useChatStore((s) => s.selectConversation);
  const closeCanvas = useCanvasStore((s) => s.closeCanvas);

  const handleClick = useCallback(() => {
    if (d.conversationId) {
      selectConversation(d.conversationId);
      closeCanvas();
    }
  }, [d.conversationId, selectConversation, closeCanvas]);

  return (
    <div
      onClick={handleClick}
      className={cn(
        'w-[220px] rounded-xl border bg-card px-3 py-2.5 shadow-sm cursor-pointer transition-all hover:shadow-md',
        selected ? 'border-foreground/30 shadow-md' : 'border-border',
        'border-l-2 border-l-muted-foreground/20',
      )}
    >
      <Handle type="target" position={Position.Top} className="canvas-handle" />
      <Handle type="source" position={Position.Bottom} className="canvas-handle" />
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <Handle type="source" position={Position.Right} className="canvas-handle" />

      <div className="flex items-start gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground leading-tight truncate">
            {d.label}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/50">
            Беседа
          </div>
        </div>
      </div>
    </div>
  );
});
