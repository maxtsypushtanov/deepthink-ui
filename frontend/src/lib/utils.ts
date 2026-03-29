import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffH < 24 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Strip LLM meta-text and internal reasoning from assistant content for display */
export function cleanAssistantContent(text: string): string {
  let cleaned = text;

  // Phase 1: Strip <thinking>...</thinking> blocks
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  cleaned = cleaned.replace(/<thinking>/g, '').replace(/<\/thinking>/g, '');

  // Phase 2: Strip line-level English reasoning patterns
  const linePatterns = [
    /^(?:User says|User'?s? (?:question|message|request|input))[\s:].*$/gim,
    /^(?:Thinking|Let me think|Analyzing|Processing)[\s:].*$/gim,
    /^(?:I need to|I should|I will|I'll|Let me|We need to|We should|According to)[\s].*$/gim,
    /^(?:The user|This user|They want|They're asking)[\s].*$/gim,
    /^(?:OK so|Okay so|Alright,|Hmm,|Wait,)[\s].*$/gim,
    /^(?:Based on the (?:instructions|guidelines|rules|context))[\s,].*$/gim,
    /^(?:My (?:task|job|role|goal) (?:is|here))[\s].*$/gim,
    /^(?:System|Instructions?|Context|Note to self)[\s:].*$/gim,
    /^\[(?:THINKING|REASONING|ANALYSIS|РАССУЖДЕНИЕ|INTERNAL)\].*$/gim,
    // Russian system prompt leak patterns
    /^(?:Пользователь (?:\w+\s+)?(?:задал|задает|задаёт|спрашивает|хочет|просит|написал|интересуется))[\s].*$/gim,
    /^(?:Согласно (?:системной |моей |внутренней )?(?:инструкции|промпту|правилам|указаниям))[\s:,].*$/gim,
    /^(?:В (?:моих |системных )?(?:инструкциях|правилах|промпте|указаниях))[\s:,].*$/gim,
    /^(?:Мне (?:указано|велено|предписано|запрещено|нужно|следует))[\s].*$/gim,
    /^(?:Необходимо (?:подтвердить|следовать|ответить|соблюдать))[\s].*$/gim,
    /^(?:Моя (?:задача|роль|функция|цель) (?:—|–|-|:))[\s].*$/gim,
    /^\d+\.\s+(?:Я (?:НЕ|не|—)|Ответ (?:должен|следует)).*$/gim,
    // Universal numbered planning: "1. Определение:", "4. Планирование:", etc.
    /^\d+\.\s*[А-ЯA-Z][а-яa-z]+(?:\s+[а-яa-z]+)?:.*$/gm,
    // Analysis headers
    /^(?:Анализ|План (?:ответа|действий)|Рассуждение|Ход мысли|Контекст|Логика ответа)[\s:].*$/gm,
    // Numbered meta-reasoning
    /^\d+\.\s*(?:В памяти|Текущее сообщение|Поскольку|Исходя из|Учитывая|Из контекста|Из профиля|Пользователь (?:является|упомин|интересу|ранее)).*$/gm,
    /.*(?:системн(?:ой|ая|ые) инструкци|системн(?:ый|ого) промпт|установленн(?:ым|ые) правилам).*$/gim,
  ];
  for (const p of linePatterns) {
    cleaned = cleaned.replace(p, '');
  }

  // Phase 3: Strip leading English REASONING block before Cyrillic answer
  // Only strip if it looks like internal reasoning, not legitimate English content
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(cleaned);
  if (hasCyrillic) {
    const lines = cleaned.split('\n');
    let firstCyrIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() && /[а-яА-ЯёЁ]/.test(lines[i])) {
        firstCyrIdx = i;
        break;
      }
    }
    if (firstCyrIdx > 0) {
      const prefix = lines.slice(0, firstCyrIdx).join('\n').trim();
      // Only strip if prefix looks like reasoning (contains reasoning indicators)
      const isReasoning = /\b(user|thinking|analyze|according|guidelines|instructions|need to|should|let me|step \d)/i.test(prefix);
      if (prefix && !/[а-яА-ЯёЁ]/.test(prefix) && isReasoning) {
        cleaned = lines.slice(firstCyrIdx).join('\n');
      }
    }
  }

  // Strip standalone JSON blocks that look like internal model output
  cleaned = cleaned.replace(/^\s*\{[\s\S]*?"(?:spec|plan|code_changes|issues|decision)"[\s\S]*?\}\s*$/gm, '');
  // Strip "Return JSON accordingly" and similar instructions
  cleaned = cleaned.replace(/^(?:Return|Output|Respond with|Generate|Provide)[\s].*(?:JSON|json|accordingly|format).*$/gim, '');

  // Phase 4: Convert <br> tags to newlines
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');

  // Phase 5: Strip fake image links (not data: URIs and not real URLs from generation pipeline)
  cleaned = cleaned.replace(/!\[([^\]]*)\]\((?!data:)(?!https?:\/\/)[^)]*\)/g, '');

  // Phase 6: Clean up whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

export function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
