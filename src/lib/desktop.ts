import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Settings, Message } from '../types';
import { messageContent } from './message';

export function installDesktopBridge() {
  if (!isTauri()) return;
  let saves = Promise.resolve();
  window.clay = {
    isDesktop: true, platform: navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Macintosh') ? 'darwin' : 'other',
    loadState: () => invoke('load_workspace'),
    saveState: state => { saves = saves.catch(() => {}).then(() => invoke<void>('save_workspace', { workspace: state })); return saves; },
    loadSecret: () => invoke('load_secret'),
    saveSecret: value => invoke('save_secret', { value }),
    exportFile: (name, content) => invoke('export_markdown', { name, content }),
    windowControl: action => {
      const window = getCurrentWindow();
      const operation = action === 'minimize' ? window.minimize() : action === 'maximize' ? window.toggleMaximize() : saves.catch(() => {}).then(() => window.close());
      void operation.catch(console.error);
    },
  };
}

export async function streamNativeChat(settings: Settings, apiKey: string, messages: Message[], signal: AbortSignal, onDelta: (text: string) => void) {
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const channel = new Channel<{ type: 'delta' | 'done'; text?: string }>();
  channel.onmessage = event => { if (!signal.aborted && event.type === 'delta' && event.text) onDelta(event.text); };
  const cancel = () => { void invoke('cancel_chat', { requestId }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('chat_stream', { requestId, onEvent: channel, input: { ...settings, apiKey, messages: messages.filter(message => message.content || message.attachments?.length).map(message => ({ role: message.role, content: messageContent(message) })) } });
    signal.throwIfAborted();
  } catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
  finally { signal.removeEventListener('abort', cancel); }
}
