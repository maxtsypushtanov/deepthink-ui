/**
 * GToT Reasoning Tree — horizontal tree visualization.
 * Root nodes on the left, children expand to the right.
 * Nodes are colored by score; best path highlighted in gold.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Search, FileText, GitCommit, GitPullRequest, Terminal,
  CheckCircle, XCircle, Loader2, Star, ChevronRight,
} from 'lucide-react';
import type { GToTNode, PipelineEvent } from '@/types/pipeline';

// ── Config ──

const TOOL_ICON: Record<string, typeof Search> = {
  search_code: Search,
  get_file_contents: FileText,
  get_file: FileText,
  list_commits: GitCommit,
  search_issues: Search,
  list_issues: Search,
  create_pull_request: GitPullRequest,
};

function scoreColor(score: number | undefined): string {
  if (score === undefined) return 'border-border/40';
  if (score >= 0.8) return 'border-green-500/60';
  if (score >= 0.6) return 'border-yellow-500/60';
  return 'border-red-500/60';
}

function scoreBg(score: number | undefined): string {
  if (score === undefined) return 'bg-card/40';
  if (score >= 0.8) return 'bg-green-500/5';
  if (score >= 0.6) return 'bg-yellow-500/5';
  return 'bg-red-500/5';
}

function starCount(score: number): number {
  return Math.round(score * 5);
}

// ── Build tree from events ──

function buildTreeFromEvents(events: PipelineEvent[]): { nodes: Map<string, GToTNode>; roots: string[]; bestPath: Set<string>; complete: boolean } {
  const nodes = new Map<string, GToTNode>();
  const roots: string[] = [];
  let bestPath = new Set<string>();
  let complete = false;

  for (const e of events) {
    if (e.type === 'gtot_plan' && e.planned_nodes) {
      for (const n of e.planned_nodes) {
        nodes.set(n.id, {
          id: n.id,
          tool: n.tool,
          args: n.args,
          reasoning: n.reasoning,
          status: 'pending',
          children: [],
        });
        roots.push(n.id);
      }
    }

    if (e.type === 'gtot_node_start' && e.node_id) {
      const node = nodes.get(e.node_id);
      if (node) {
        node.status = 'running';
      } else {
        nodes.set(e.node_id, {
          id: e.node_id,
          tool: e.tool || 'unknown',
          args: {},
          reasoning: '',
          status: 'running',
          parent_id: e.parent_id,
          children: [],
        });
      }
    }

    if (e.type === 'gtot_node_result' && e.node_id) {
      const node = nodes.get(e.node_id);
      if (node) {
        node.status = 'completed';
        node.result_preview = e.result_preview;
        node.latency_ms = e.latency_ms;
        if (e.status === 'failed') node.status = 'failed';
      }
    }

    if (e.type === 'gtot_node_scored' && e.node_id) {
      const node = nodes.get(e.node_id);
      if (node) {
        node.score = e.score;
        node.score_reason = e.reason;
        node.status = 'scored';
      }
    }

    if (e.type === 'gtot_pruned' && e.node_id) {
      const node = nodes.get(e.node_id);
      if (node) {
        node.status = 'pruned';
        node.score = e.score;
        node.score_reason = e.reason;
      }
    }

    if (e.type === 'gtot_expand' && e.parent_id && e.new_nodes) {
      const parent = nodes.get(e.parent_id);
      for (const n of e.new_nodes) {
        nodes.set(n.id, {
          id: n.id,
          tool: n.tool,
          args: n.args,
          reasoning: n.reasoning,
          status: 'pending',
          parent_id: e.parent_id,
          children: [],
        });
        if (parent) parent.children.push(n.id);
      }
    }

    if (e.type === 'gtot_complete') {
      complete = true;
      if (e.best_path) bestPath = new Set(e.best_path);
    }
  }

  return { nodes, roots, bestPath, complete };
}

// ── Components ──

interface Props {
  events: PipelineEvent[];
}

export function ReasoningTreePanel({ events }: Props) {
  const { nodes, roots, bestPath, complete } = useMemo(
    () => buildTreeFromEvents(events),
    [events],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [nodes.size]);

  if (roots.length === 0) return null;

  return (
    <div className="ml-6 mt-1 mb-2 rounded-lg border border-border/30 bg-[#0a0a0f] overflow-hidden">
      <div
        ref={scrollRef}
        className="overflow-x-auto p-3"
      >
        <div className="flex gap-2 min-w-max">
          {roots.map((rootId) => (
            <TreeBranch
              key={rootId}
              nodeId={rootId}
              nodes={nodes}
              bestPath={bestPath}
              depth={0}
            />
          ))}
        </div>
      </div>

      {/* Summary bar */}
      {complete && (
        <div className="flex items-center gap-3 border-t border-border/20 px-3 py-1.5 text-[10px] text-muted-foreground/50">
          <span>{nodes.size} узлов</span>
          <span>Лучший путь: {bestPath.size} шагов</span>
        </div>
      )}
    </div>
  );
}

function TreeBranch({
  nodeId,
  nodes,
  bestPath,
  depth,
}: {
  nodeId: string;
  nodes: Map<string, GToTNode>;
  bestPath: Set<string>;
  depth: number;
}) {
  const node = nodes.get(nodeId);
  if (!node) return null;

  const isBest = bestPath.has(nodeId);
  const childIds = node.children;

  return (
    <div className="flex items-start gap-1.5 animate-fade-in" style={{ animationDelay: `${depth * 80}ms` }}>
      <TreeNodeCard node={node} isBest={isBest} />

      {childIds.length > 0 && (
        <div className="flex items-center gap-1">
          <ChevronRight className={cn(
            'h-3 w-3 shrink-0',
            isBest ? 'text-yellow-400' : 'text-border/40',
          )} strokeWidth={1.5} />
          <div className="flex flex-col gap-1.5">
            {childIds.map((cid) => (
              <TreeBranch
                key={cid}
                nodeId={cid}
                nodes={nodes}
                bestPath={bestPath}
                depth={depth + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TreeNodeCard({ node, isBest }: { node: GToTNode; isBest: boolean }) {
  const [showDetail, setShowDetail] = useState(false);
  const ToolIcon = TOOL_ICON[node.tool] || Terminal;

  const isPruned = node.status === 'pruned';
  const isRunning = node.status === 'running';

  return (
    <div
      onClick={() => setShowDetail(!showDetail)}
      className={cn(
        'w-44 shrink-0 rounded-md border px-2 py-1.5 text-[10px] cursor-pointer transition-all',
        scoreColor(node.score),
        scoreBg(node.score),
        isPruned && 'opacity-40 border-border/20 bg-card/10',
        isRunning && 'animate-pulse',
        isBest && 'ring-1 ring-yellow-400/40 shadow-[0_0_8px_rgba(250,204,21,0.15)]',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin text-cyan-400" strokeWidth={1.5} />
        ) : node.status === 'failed' ? (
          <XCircle className="h-3 w-3 text-red-400" strokeWidth={1.5} />
        ) : isPruned ? (
          <XCircle className="h-3 w-3 text-gray-600" strokeWidth={1.5} />
        ) : (
          <ToolIcon className="h-3 w-3 text-cyan-400" strokeWidth={1.5} />
        )}
        <span className={cn('font-mono font-medium truncate', isPruned ? 'text-gray-600 line-through' : 'text-cyan-400')}>
          {node.tool}
        </span>

        {/* Score badge */}
        {node.score !== undefined && !isPruned && (
          <span className={cn(
            'ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-bold',
            node.score >= 0.8 ? 'bg-green-500/20 text-green-400' :
            node.score >= 0.6 ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400',
          )}>
            {node.score.toFixed(1)}
          </span>
        )}
      </div>

      {/* Stars */}
      {node.score !== undefined && !isPruned && (
        <div className="flex gap-0.5 mt-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={cn(
                'h-2 w-2',
                i < starCount(node.score!) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700',
              )}
              strokeWidth={1.5}
            />
          ))}
          {node.latency_ms !== undefined && (
            <span className="ml-auto text-[8px] text-muted-foreground/40">
              {node.latency_ms > 1000 ? `${(node.latency_ms / 1000).toFixed(1)}s` : `${Math.round(node.latency_ms)}ms`}
            </span>
          )}
        </div>
      )}

      {/* Result preview */}
      {node.result_preview && !showDetail && (
        <div className="mt-1 text-muted-foreground/50 truncate">
          {node.result_preview.slice(0, 60)}
        </div>
      )}

      {/* Expanded detail */}
      {showDetail && (
        <div className="mt-1.5 space-y-1">
          {node.reasoning && (
            <div className="text-muted-foreground/40 italic">{node.reasoning}</div>
          )}
          {node.result_preview && (
            <div className="rounded bg-[#0d1117] p-1.5 font-mono text-[9px] text-gray-500 max-h-20 overflow-y-auto whitespace-pre-wrap">
              {node.result_preview}
            </div>
          )}
          {node.score_reason && (
            <div className="text-muted-foreground/40">
              Score: {node.score_reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
