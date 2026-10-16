import type { Message, Settings } from '../types';
import { messageContent } from './message';
import { streamNativeChat } from './desktop';

function demoAnswer(input: string) {
  const notice = '> **离线演示** · 以下为预设内容，没有调用大模型。连接你的模型后，即可获得针对问题的真实回复。\n\n';
  if (/代码|编程|程序|函数|code|react|python|开发/i.test(input)) return notice +
    '## 从一个小而完整的版本开始\n\n把需求拆成 **输入、处理、输出**，先跑通一条完整流程，再逐步扩展。\n\n```typescript\ntype Idea = { title: string; done: boolean };\n\nfunction nextStep(ideas: Idea[]) {\n  return ideas.find(idea => !idea.done);\n}\n```\n\n1. 明确用户要完成的任务。\n2. 写出最小可运行的实现。\n3. 用真实场景验证，再打磨细节。\n\n这是 Markdown 和代码排版的演示。你可以在左下角的 **设置** 中连接模型，继续讨论你的具体需求。';
  if (/写|文章|文案|邮件|表达/i.test(input)) return notice +
    '## 好的表达，从一个清晰的想法开始\n\n先问自己三个问题：\n\n- **写给谁？** 确定读者和他们关心的事。\n- **想说什么？** 用一句话写下核心观点。\n- **希望发生什么？** 给读者一个明确的下一步。\n\n> 把复杂留给思考，把清晰留给表达。\n\n可以试试这个结构：**提出问题 → 给出观点 → 用例子说明 → 邀请行动**。\n\n连接模型后，我就能根据你的内容协助起草、润色和调整语气。';
  return notice +
    '## 给想法一个开始的地方\n\n欢迎来到 **Clay Chat**。这是一个同时支持网页和桌面的 AI 对话工作台。\n\n你可以在这里体验：\n\n- 流式消息与 Markdown 排版\n- 本地会话保存、搜索与收藏\n- 文本附件与对话导出\n- 浅色和深色主题\n\n### 下一步\n\n打开 **设置 → 模型连接**，选择协议，填写接口地址和模型 ID。保存后再次发送消息，就会调用你自己的模型服务。\n\n你的这条消息已保存在当前对话中，可以随时回来继续。';
}

export async function streamChat(settings: Settings, apiKey: string, messages: Message[], signal: AbortSignal, onDelta: (text: string) => void) {
  if (settings.provider === 'demo') {
    const text = demoAnswer(messages.at(-1)?.content || '');
    for (let position = 0; position < text.length; position += 6) {
      signal.throwIfAborted();
      onDelta(text.slice(position, position + 6));
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 16);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    return;
  }
  if (window.clay) {
    return streamNativeChat(settings, apiKey, messages, signal, onDelta);
  }
  const response = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ...settings, apiKey, messages: messages.filter(message => message.content || message.attachments?.length).map(message => ({ role: message.role, content: messageContent(message) })) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `连接失败（HTTP ${response.status}）`);
  }
  if (!response.body) throw new Error('当前浏览器不支持流式响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const event = JSON.parse(data.slice(6));
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'delta') onDelta(event.text);
        if (event.type === 'done') completed = true;
      }
      if (done) break;
    }
    if (!completed) throw new Error('连接中断，已保留收到的内容。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
