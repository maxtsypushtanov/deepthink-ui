import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Check, X, Loader2, Brain, FileCode, ListChecks, MessageSquare } from 'lucide-react';

// ── Types ──

type NodeStatus = 'thinking' | 'done' | 'failed';

interface TreeNode {
  id: string;
  label: string;
  icon: string;
  status: NodeStatus;
  content: string;
  isThinking: boolean; // content from <thinking> tags
  children: TreeNode[];
}

interface Props {
  agentColor: string;
  agentIcon: string;
  agentLabel: string;
  status: 'pending' | 'running' | 'done';
  rawOutput: string | null;
}

// ── Parse raw LLM output into a tree ──

function parseOutputToTree(
  raw: string,
  agentIcon: string,
  agentLabel: string,
  status: 'pending' | 'running' | 'done',
): TreeNode[] {
  if (!raw) return [];

  const nodes: TreeNode[] = [];
  let nodeId = 0;

  // Extract <thinking>...</thinking> blocks
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinkingContent = thinkingMatch?.[1]?.trim() ?? '';
  const answerContent = raw.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();

  // If there's thinking content, parse it into child nodes
  if (thinkingContent) {
    const thinkingChildren: TreeNode[] = [];
    const steps = splitIntoSteps(thinkingContent);

    for (const step of steps) {
      thinkingChildren.push({
        id: `t-${nodeId++}`,
        label: extractStepLabel(step),
        icon: '\u{1F4AD}', // 💭
        status: 'done',
        content: step,
        isThinking: true,
        children: [],
      });
    }

    nodes.push({
      id: `thinking-${nodeId++}`,
      label: 'Рассуждения',
      icon: '\u{1F9E0}', // 🧠
      status: 'done',
      content: '',
      isThinking: true,
      children: thinkingChildren,
    });
  }

  // Parse the answer portion
  if (answerContent) {
    const answerNodes = parseAnswerContent(answerContent, nodeId);
    nodes.push(...answerNodes);
  }

  // If still running and no nodes yet, show a thinking indicator
  if (status === 'running' && nodes.length === 0) {
    nodes.push({
      id: 'loading',
      label: 'Анализирую...',
      icon: '\u{1F50D}', // 🔍
      status: 'thinking',
      content: '',
      isThinking: false,
      children: [],
    });
  }

  return nodes;
}

function splitIntoSteps(text: string): string[] {
  // Split by numbered steps (1. 2. 3.) or double newlines
  const numbered = text.split(/(?=^\d+\.\s)/m).filter((s) => s.trim());
  if (numbered.length > 1) return numbered;
  const paragraphs = text.split(/\n{2,}/).filter((s) => s.trim());
  if (paragraphs.length > 1) return paragraphs;
  return [text];
}

function extractStepLabel(step: string): string {
  // First line, truncated
  const firstLine = step.split('\n')[0].replace(/^\d+\.\s*/, '').trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

function parseAnswerContent(text: string, startId: number): TreeNode[] {
  const nodes: TreeNode[] = [];
  let nodeId = startId;

  // Extract code blocks
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before code block
    const before = text.slice(lastIndex, match.index).trim();
    if (before) {
      const steps = splitIntoSteps(before);
      for (const step of steps) {
        nodes.push({
          id: `a-${nodeId++}`,
          label: extractStepLabel(step),
          icon: '\u{1F4CB}', // 📋
          status: 'done',
          content: step,
          isThinking: false,
          children: [],
        });
      }
    }

    // Code block
    const lang = match[1] || 'code';
    nodes.push({
      id: `code-${nodeId++}`,
      label: `Код (${lang})`,
      icon: '\u{1F4BB}', // 💻
      status: 'done',
      content: match[2].trim(),
      isThinking: false,
      children: [],
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    const steps = splitIntoSteps(remaining);
    for (const step of steps) {
      nodes.push({
        id: `a-${nodeId++}`,
        label: extractStepLabel(step),
        icon: '\u{1F4CB}', // 📋
        status: 'done',
        content: step,
        isThinking: false,
        children: [],
      });
    }
  }

  // If we parsed nothing, put everything as one node
  if (nodes.length === 0 && text.trim()) {
    nodes.push({
      id: `a-${nodeId++}`,
      label: extractStepLabel(text),
      icon: '\u{2705}', // ✅
      status: 'done',
      content: text,
      isThinking: false,
      children: [],
    });
  }

  return nodes;
}

// ── Tree Node Component ──

function TreeNodeView({
  node,
  depth,
  agentColor,
  isLast,
}: {
  node: TreeNode;
  depth: number;
  agentColor: string;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(!node.isThinking && depth < 2);
  const hasChildren = node.children.length > 0;
  const hasContent = node.content.length > 0;
  const isExpandable = hasChildren || hasContent;
  const isCodeNode = node.id.startsWith('code-');

  return (
    <div className="animate-fade-in" style={{ animationDelay: `${depth * 50}ms` }}>
      <div className="flex items-start">
        {/* Tree connector lines */}
        <div className="flex shrink-0 items-center pt-1.5" style={{ width: depth > 0 ? 20 : 0 }}>
          {depth > 0 && (
            <div className="relative h-full w-5">
              <div className={cn(
                'absolute left-0 top-0 h-3 w-px',
                node.status === 'thinking' ? agentColor.replace('text-', 'bg-') : 'bg-border',
              )} />
              <div className={cn(
                'absolute left-0 top-3 h-px w-3',
                node.status === 'thinking' ? agentColor.replace('text-', 'bg-') : 'bg-border',
              )} />
              {!isLast && (
                <div className="absolute left-0 top-3 bottom-0 w-px bg-border" />
              )}
            </div>
          )}
        </div>

        {/* Node content */}
        <div className="min-w-0 flex-1">
          <button
            onClick={() => isExpandable && setExpanded(!expanded)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
              isExpandable && 'hover:bg-accent/20 cursor-pointer',
              !isExpandable && 'cursor-default',
              node.status === 'done' && depth > 1 && 'opacity-80',
            )}
          >
            {/* Status indicator */}
            <StatusIcon status={node.status} agentColor={agentColor} />

            {/* Expand/collapse chevron */}
            {isExpandable ? (
              expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )
            ) : (
              <div className="w-3" />
            )}

            {/* Icon */}
            <span className="shrink-0">{node.icon}</span>

            {/* Label */}
            <span className={cn(
              'truncate font-medium',
              node.isThinking ? 'text-muted-foreground italic' : 'text-foreground/90',
              node.status === 'thinking' && agentColor,
            )}>
              {node.label}
            </span>
          </button>

          {/* Expanded content */}
          {expanded && (
            <div className="ml-7 mt-0.5">
              {hasContent && (
                <div className={cn(
                  'rounded-md border px-2.5 py-2 text-xs',
                  isCodeNode
                    ? 'border-border/50 bg-[#0d1117] font-mono text-gray-300 overflow-x-auto whitespace-pre'
                    : node.isThinking
                      ? 'border-border/30 bg-card/30 text-muted-foreground italic whitespace-pre-wrap'
                      : 'border-border/30 bg-card/50 text-foreground/80 whitespace-pre-wrap',
                )}>
                  {node.content}
                </div>
              )}

              {/* Render children */}
              {hasChildren && (
                <div className="mt-1">
                  {node.children.map((child, i) => (
                    <TreeNodeView
                      key={child.id}
                      node={child}
                      depth={depth + 1}
                      agentColor={agentColor}
                      isLast={i === node.children.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status, agentColor }: { status: NodeStatus; agentColor: string }) {
  if (status === 'thinking') {
    return (
      <div className={cn('h-2 w-2 shrink-0 rounded-full animate-pulse', agentColor.replace('text-', 'bg-'))} />
    );
  }
  if (status === 'done') {
    return <Check className="h-3 w-3 shrink-0 text-green-400" />;
  }
  return <X className="h-3 w-3 shrink-0 text-red-400" />;
}

// ── Main ReasoningTreeView ──

export function ReasoningTreeView({ agentColor, agentIcon, agentLabel, status, rawOutput }: Props) {
  const nodes = useMemo(
    () => parseOutputToTree(rawOutput ?? '', agentIcon, agentLabel, status),
    [rawOutput, agentIcon, agentLabel, status],
  );

  if (status === 'pending') return null;

  if (nodes.length === 0 && status === 'running') {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
        <Loader2 className={cn('h-3.5 w-3.5 animate-spin', agentColor)} />
        <span>Запуск агента...</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-1 py-1">
      {nodes.map((node, i) => (
        <TreeNodeView
          key={node.id}
          node={node}
          depth={0}
          agentColor={agentColor}
          isLast={i === nodes.length - 1}
        />
      ))}
    </div>
  );
}
