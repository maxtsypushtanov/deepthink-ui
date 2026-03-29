import { useArtifactStore, type ArtifactType } from '@/stores/artifactStore';
import { cn } from '@/lib/utils';

const TYPE_EMOJI: Record<ArtifactType, string> = {
  code: '\u{1F4C4}',
  document: '\u{1F4DD}',
  table: '\u{1F4CA}',
  mermaid: '\u{1F500}',
  image: '\u{1F5BC}',
};

const MAX_VISIBLE = 5;

export function ArtifactList() {
  const artifacts = useArtifactStore((s) => s.artifacts);
  const panelOpen = useArtifactStore((s) => s.panelOpen);
  const setActive = useArtifactStore((s) => s.setActive);

  // Only show when panel is closed and there are artifacts
  if (panelOpen || artifacts.length === 0) return null;

  const visible = artifacts.slice(-MAX_VISIBLE);
  const overflow = artifacts.length - MAX_VISIBLE;

  return (
    <div className="fixed bottom-4 right-4 z-20 flex flex-col items-end gap-1 animate-fade-in">
      {overflow > 0 && (
        <button
          onClick={() => {
            const first = artifacts[0];
            if (first) setActive(first.id);
          }}
          className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted transition-colors shadow-sm"
        >
          +{overflow} ещё
        </button>
      )}
      {visible.map((artifact) => (
        <button
          key={artifact.id}
          onClick={() => setActive(artifact.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5',
            'text-[12px] text-foreground hover:bg-muted transition-colors shadow-sm',
            'max-w-[220px] truncate',
          )}
        >
          <span>{TYPE_EMOJI[artifact.type]}</span>
          <span className="truncate">{artifact.title}</span>
        </button>
      ))}
    </div>
  );
}
