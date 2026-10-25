import type { Workspace, Conversation, Message, Settings } from '../types';
export const STORAGE_KEY = 'clay-chat.workspace.v1';
export const KEY_STORAGE = 'clay-chat.session-key';
export const defaultSettings: Settings = { provider: 'demo', baseUrl: 'https://api.openai.com/v1', model: '', systemPrompt: '你是一位善于思考、表达清晰的 AI 助手。请优先使用中文回答，必要时使用 Markdown 排版。' };
export function emptyWorkspace(): Workspace {
  return { version: 1, conversations: [], activeId: null, settings: { ...defaultSettings }, theme: 'light', titlebar: 'auto' };
}
export function restoreWorkspace(value: unknown): Workspace {
  const fallback = emptyWorkspace();
  if (!value || typeof value !== 'object') return fallback;
  const data = value as Partial<Workspace>;
  const conversations = Array.isArray(data.conversations) ? data.conversations.filter((item): item is Conversation =>
    !!item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.messages) &&
    typeof item.updatedAt === 'number' && item.messages.every((message: Message) =>
      !!message && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
    )
  ).map(item => ({ ...item, messages: item.messages.map(message => ({ ...message, status: message.status === 'streaming' ? 'stopped' as const : message.status })) })) : [];
  const settings: Settings = {
    provider: ['demo', 'openai', 'anthropic'].includes(data.settings?.provider || '') ? data.settings!.provider : 'demo',
    baseUrl: typeof data.settings?.baseUrl === 'string' ? data.settings.baseUrl : fallback.settings.baseUrl,
    model: typeof data.settings?.model === 'string' ? data.settings.model : '',
    systemPrompt: typeof data.settings?.systemPrompt === 'string' ? data.settings.systemPrompt : fallback.settings.systemPrompt,
  };
  return { version: 1, conversations, settings, activeId: conversations.some(item => item.id === data.activeId) ? data.activeId! : null, theme: data.theme === 'dark' ? 'dark' : 'light', titlebar: ['auto', 'windows', 'macos'].includes(data.titlebar || '') ? data.titlebar : 'auto' };
}
export async function loadWorkspace(): Promise<Workspace> {
  try {
    const value = window.clay ? await window.clay.loadState() : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return restoreWorkspace(value);
  } catch { return emptyWorkspace(); }
}
export function saveWorkspace(state: Workspace): Promise<void> {
  if (window.clay) return window.clay.saveState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return Promise.resolve();
}
export function uid() { return crypto.randomUUID(); }
export function exportMarkdown(conversation: Conversation) {
  return `# ${conversation.title}\n\n${conversation.messages.map(message =>
    `## ${message.role === 'user' ? '你' : `Clay${message.demo ? '（演示）' : ''}`}\n\n${message.content}${message.attachments?.length ? '\n\n附件：' + message.attachments.map(file => file.name).join('、') : ''}${message.error ? `\n\n> ${message.error}` : ''}`
  ).join('\n\n---\n\n')}\n`;
}
