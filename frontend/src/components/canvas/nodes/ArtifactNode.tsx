import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileCode, FileText, Table, GitBranch, Image } from 'lucide-react';
import { useArtifactStore } from '@/stores/artifactStore';
import { cn } from '@/lib/utils';

const TYPE_ICONS = {
  code: FileCode,
  document: FileText,
  table: Table,
  mermaid: GitBranch,
  image: Image,
} as const;

interface ArtifactNodeData {
  label: string;
  artifactId?: string;
  artifactType?: string;
  [key: string]: unknown;
}

export const ArtifactNode = memo(function ArtifactNode({ data, selected }: NodeProps) {
  const d = data as unknown as ArtifactNodeData;
  const setActive = useArtifactStore((s) => s.setActive);
  const openPanel = useArtifactStore((s) => s.openPanel);

  const Icon = TYPE_ICONS[(d.artifactType as keyof typeof TYPE_ICONS) || 'document'] || FileText;

  const handleClick = useCallback(() => {
    if (d.artifactId) {
      setActive(d.artifactId);
      openPanel();
    }
  }, [d.artifactId, setActive, openPanel]);

  return (
    <div
      onClick={handleClick}
      className={cn(
        'w-[200px] rounded-xl border bg-card px-3 py-2.5 shadow-sm cursor-pointer transition-all hover:shadow-md',
        selected ? 'border-foreground/30 shadow-md' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Top} className="canvas-handle" />
      <Handle type="source" position={Position.Bottom} className="canvas-handle" />
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      <Handle type="source" position={Position.Right} className="canvas-handle" />

      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground/60 shrink-0" />
        <div className="text-[13px] font-medium text-foreground leading-tight truncate">
          {d.label}
        </div>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground/50 pl-6">
        Артефакт
      </div>
    </div>
  );
});
