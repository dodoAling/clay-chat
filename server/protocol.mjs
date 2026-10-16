/** Decode SSE independently of network chunk and UTF-8 boundaries. */
export async function* readSse(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(frame) {
    const lines = frame.split(/\r?\n/);
    return lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
  }
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = parse(frame);
      if (data) yield data;
    }
    if (buffer.length > 2_000_000) throw new Error('模型返回的数据块过大。');
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const data = parse(buffer);
    if (data) yield data;
  }
}

export function endpointFor(baseUrl, provider) {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 接口地址。');
  }
  const suffix = provider === 'anthropic' ? '/messages' : '/chat/completions';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname) pathname = '/v1';
  if (!pathname.endsWith(suffix)) pathname += suffix;
  url.pathname = pathname;
  url.hash = '';
  return url;
}

export function buildUpstream(input) {
  const { provider, baseUrl, model, apiKey, messages, systemPrompt = '' } = input;
  if (!['openai', 'anthropic'].includes(provider)) throw new Error('不支持的模型协议。');
  if (typeof model !== 'string' || !model.trim()) throw new Error('请在设置中填写模型 ID。');
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new Error('请在设置中填写接口地址。');
  if (typeof apiKey !== 'string' || apiKey.length > 8192) throw new Error('API Key 格式不正确。');
  if (typeof systemPrompt !== 'string' || systemPrompt.length > 20000) throw new Error('系统提示词过长。');
  if (!Array.isArray(messages) || !messages.length || messages.length > 1000 || messages.some(message =>
    !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
  )) throw new Error('对话内容格式不正确。');
  const cleanMessages = messages.map(({ role, content }) => ({ role, content }));
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const body = { model: model.trim(), messages: cleanMessages, stream: true };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body.max_tokens = 4096;
    if (systemPrompt.trim()) body.system = systemPrompt.trim();
  } else {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (systemPrompt.trim()) body.messages = [{ role: 'system', content: systemPrompt.trim() }, ...cleanMessages];
  }
  return { url: endpointFor(baseUrl, provider), headers, body };
}

export function normalizeEvent(data, provider) {
  if (data === '[DONE]') return { type: 'done' };
  const event = JSON.parse(data);
  if (event.error || event.type === 'error') {
    throw new Error(event.error?.message || '模型服务返回了错误。');
  }
  if (provider === 'anthropic') {
    if (event.type === 'message_stop') return { type: 'done' };
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return { type: 'delta', text: event.delta.text };
    }
    if (event.type === 'content_block_start' && event.content_block?.text) {
      return { type: 'delta', text: event.content_block.text };
    }
  } else {
    const choice = event.choices?.[0];
    if (choice?.delta?.content) return { type: 'delta', text: choice.delta.content };
    if (choice?.delta?.refusal) return { type: 'delta', text: choice.delta.refusal };
  }
  return null;
}
