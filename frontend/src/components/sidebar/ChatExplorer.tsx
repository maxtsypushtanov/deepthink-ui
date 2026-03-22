import { useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useChatStore } from '@/stores/chatStore';
import type { Conversation, Folder } from '@/types';
import { cn } from '@/lib/utils';
import {
  Folder as FolderIcon,
  FolderOpen,
  MessageSquare,
  ChevronRight,
  Trash2,
  Pencil,
  FolderPlus,
  GripVertical,
  Check,
  X,
} from 'lucide-react';

// ── Draggable Conversation Item ──

function ConversationItem({
  conv,
  isActive,
  collapsed,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  isActive: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `conv-${conv.id}`,
    data: { type: 'conversation', conversation: conv },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
      onClick={onSelect}
    >
      <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
        <GripVertical className="h-3 w-3" />
      </div>
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{conv.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-auto hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}

// ── Folder Item ──

function FolderItem({
  folder,
  conversations,
  childFolders,
  allFolders,
  allConversations,
  activeId,
  collapsed,
  onSelectConversation,
  onDeleteConversation,
  onRename,
  onDelete,
  onCreateSubfolder,
}: {
  folder: Folder;
  conversations: Conversation[];
  childFolders: Folder[];
  allFolders: Folder[];
  allConversations: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onCreateSubfolder: (parentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: `folder-${folder.id}`,
    data: { type: 'folder', folder },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleRename = () => {
    if (editName.trim() && editName !== folder.name) {
      onRename(folder.id, editName.trim());
    }
    setEditing(false);
  };

  const itemCount = conversations.length + childFolders.length;

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
          'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          isOver && 'bg-accent/70 ring-1 ring-primary/30',
          collapsed && 'justify-center px-0',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
          <GripVertical className="h-3 w-3" />
        </div>
        {!collapsed && (
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        )}
        {expanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5 shrink-0" />
        )}
        {!collapsed && (
          editing ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="w-full rounded border border-border bg-background px-1 py-0 text-sm"
              />
              <button onClick={handleRename} className="text-green-500 hover:text-green-400">
                <Check className="h-3 w-3" />
              </button>
              <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <>
              <span className="truncate">{folder.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">{itemCount}</span>
              <div className="hidden items-center gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateSubfolder(folder.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title="Новая подпапка"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditName(folder.name);
                    setEditing(true);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title="Переименовать"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(folder.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  title="Удалить"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </>
          )
        )}
      </div>

      {expanded && !collapsed && (
        <div className="ml-4 border-l border-border/50 pl-1">
          {childFolders.map((cf) => (
            <FolderItem
              key={cf.id}
              folder={cf}
              conversations={allConversations.filter((c) => c.folder_id === cf.id)}
              childFolders={allFolders.filter((f) => f.parent_folder_id === cf.id)}
              allFolders={allFolders}
              allConversations={allConversations}
              activeId={activeId}
              collapsed={collapsed}
              onSelectConversation={onSelectConversation}
              onDeleteConversation={onDeleteConversation}
              onRename={onRename}
              onDelete={onDelete}
              onCreateSubfolder={onCreateSubfolder}
            />
          ))}
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={activeId === conv.id}
              collapsed={collapsed}
              onSelect={() => onSelectConversation(conv.id)}
              onDelete={() => onDeleteConversation(conv.id)}
            />
          ))}
          {conversations.length === 0 && childFolders.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/50">Пусто</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ChatExplorer ──

export function ChatExplorer({ collapsed }: { collapsed: boolean }) {
  const conversations = useChatStore((s) => s.conversations);
  const folders = useChatStore((s) => s.folders);
  const activeId = useChatStore((s) => s.activeConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const loadFolders = useChatStore((s) => s.loadFolders);
  const createFolder = useChatStore((s) => s.createFolder);
  const renameFolder = useChatStore((s) => s.renameFolder);
  const deleteFolder = useChatStore((s) => s.deleteFolder);
  const moveConversation = useChatStore((s) => s.moveConversation);
  const moveFolder = useChatStore((s) => s.moveFolder);

  const [dragActive, setDragActive] = useState<string | null>(null);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActive(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActive(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeData = active.data.current;
      const overId = over.id as string;

      if (activeData?.type === 'conversation') {
        const conv = activeData.conversation as Conversation;
        if (overId.startsWith('folder-')) {
          const folderId = overId.replace('folder-', '');
          moveConversation(conv.id, folderId);
        } else if (overId === 'root-drop') {
          moveConversation(conv.id, null);
        }
      } else if (activeData?.type === 'folder') {
        const folder = activeData.folder as Folder;
        if (overId.startsWith('folder-')) {
          const parentId = overId.replace('folder-', '');
          if (parentId !== folder.id) {
            moveFolder(folder.id, parentId);
          }
        } else if (overId === 'root-drop') {
          moveFolder(folder.id, null);
        }
      }
    },
    [moveConversation, moveFolder],
  );

  const handleCreateFolder = useCallback(
    (parentId?: string) => {
      createFolder('Новая папка', parentId ?? null);
    },
    [createFolder],
  );

  // Root level items
  const rootFolders = folders.filter((f) => !f.parent_folder_id);
  const rootConversations = conversations.filter((c) => !c.folder_id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && (
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Чаты
            </span>
            <button
              onClick={() => handleCreateFolder()}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Новая папка"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {rootFolders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            conversations={conversations.filter((c) => c.folder_id === folder.id)}
            childFolders={folders.filter((f) => f.parent_folder_id === folder.id)}
            allFolders={folders}
            allConversations={conversations}
            activeId={activeId}
            collapsed={collapsed}
            onSelectConversation={(id) => selectConversation(id)}
            onDeleteConversation={(id) => deleteConversation(id)}
            onRename={(id, name) => renameFolder(id, name)}
            onDelete={(id) => deleteFolder(id)}
            onCreateSubfolder={(parentId) => handleCreateFolder(parentId)}
          />
        ))}

        {rootConversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isActive={activeId === conv.id}
            collapsed={collapsed}
            onSelect={() => selectConversation(conv.id)}
            onDelete={() => deleteConversation(conv.id)}
          />
        ))}
      </div>

      <DragOverlay>
        {dragActive ? (
          <div className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm shadow-lg">
            {dragActive.startsWith('folder-') ? (
              <span className="flex items-center gap-1.5">
                <FolderIcon className="h-3.5 w-3.5" /> Перемещение папки
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Перемещение чата
              </span>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
