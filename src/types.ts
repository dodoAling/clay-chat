export type Provider = 'demo' | 'openai' | 'anthropic';
export type Attachment = { id: string; name: string; text: string; size: number };
export type Message = {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: number;
  attachments?: Attachment[]; status?: 'complete' | 'streaming' | 'stopped' | 'error'; error?: string;
  demo?: boolean;
};
export type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number; pinned: boolean };
export type Settings = { provider: Provider; baseUrl: string; model: string; systemPrompt: string };
export type Workspace = { version: 1; conversations: Conversation[]; activeId: string | null; settings: Settings; theme: 'light' | 'dark' };
export type DesktopBridge = {
  isDesktop: boolean; platform: string;
  loadState: () => Promise<unknown>; saveState: (state: Workspace) => Promise<void>;
  loadSecret: () => Promise<string>; saveSecret: (value: string) => Promise<void>;
  exportFile: (name: string, content: string) => Promise<boolean>;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => void;
};
declare global { interface Window { clay?: DesktopBridge } }
