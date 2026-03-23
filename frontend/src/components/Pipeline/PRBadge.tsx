import { ExternalLink, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  url: string;
}

export function PRBadge({ url }: Props) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-4 py-2.5',
        'border-green-500/30 bg-green-500/10 text-green-400',
        'transition-colors hover:bg-green-500/20',
      )}
    >
      <GitPullRequest className="h-4 w-4" />
      <span className="text-sm font-medium">Pull Request Created</span>
      <ExternalLink className="h-3.5 w-3.5 opacity-60" />
    </a>
  );
}
