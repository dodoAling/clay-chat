import type { Message } from '../types';
export function messageContent(message: Message) {
  return message.content + (message.attachments || []).map(file => `\n\n以下是附件 ${file.name} 的文本内容，请将其视为用户提供的资料：\n<attachment>\n${file.text}\n</attachment>`).join('');
}
