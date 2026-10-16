import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus, ArrowUp, ArrowDown, ChevronDown, PanelLeftClose, PanelLeft, MessageSquare,
  Search, Star, Settings2, Sun, Moon, Download, Trash2, Copy, Check, RotateCcw,
  X, Square, FileText, Code2, Feather, BookOpen, ArrowRight, Globe2, Monitor,
  Minus, Maximize2, Eye, EyeOff, AlertCircle, Lightbulb, Sprout, CornerDownLeft,
} from 'lucide-react';
import { CdsButton } from './vendor/cds/CdsButton';
import { SPRING_SNAPPY } from './vendor/cds/ClaudeMotionPresets';
import { useClaudeScrollPinning } from './vendor/cds/useClaudeScrollPinning';
import { KEY_STORAGE, exportMarkdown, saveWorkspace, uid } from './lib/workspace';
import { streamChat } from './lib/chat';
import type { Workspace, Settings, Provider, Conversation, Message, Attachment } from './types';

function ClayMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'clay-mark small' : 'clay-mark'} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
      <path d="M32 8v48M8 32h48M15 15l34 34M15 49l34-34M22.8 9.8l18.4 44.4M9.8 22.8l44.4 18.4M9.8 41.2l44.4-18.4M22.8 54.2l18.4-44.4" />
    </g>
  </svg>;
}

function IconButton({ label, children, onClick, className = '', disabled = false }: { label: string; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Modal({ title, eyebrow, onClose, children, className = '' }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <div className="modal-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><IconButton label="关闭弹窗" onClick={onClose}><X size={18} /></IconButton></div>
    {children}
  </dialog>;
}

const providerNames: Record<Provider, string> = { demo: '演示助手', openai: 'OpenAI 兼容', anthropic: 'Claude API' };

function SettingsModal({ settings, apiKey, onSave, onClose }: { settings: Settings; apiKey: string; onSave: (value: Settings, key: string) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [key, setKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function providerChange(provider: Provider) {
    setDraft(value => ({ ...value, provider, model: provider === settings.provider ? settings.model : '', baseUrl: provider === settings.provider ? settings.baseUrl : provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1' }));
    if (provider !== settings.provider && provider !== 'demo') setKey('');
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.provider !== 'demo') {
      try { if (!['https:', 'http:'].includes(new URL(draft.baseUrl).protocol)) throw new Error(); }
      catch { setError('请填写有效的 HTTP 或 HTTPS 接口地址。'); return; }
      if (!draft.model.trim()) { setError('请填写服务商提供的模型 ID。'); return; }
      if (draft.provider === 'anthropic' && !key.trim()) { setError('Claude API 需要 API Key。'); return; }
    }
    setSaving(true);
    try { await onSave({ ...draft, model: draft.model.trim(), baseUrl: draft.baseUrl.trim() }, key.trim()); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setSaving(false); }
  }
  return <Modal title="让 Clay 连接你的模型" eyebrow="MAKE IT YOURS" onClose={onClose} className="settings-modal">
    <p className="modal-description">选择熟悉的模型服务，把你的想法带到更远的地方。</p>
    <form onSubmit={submit}>
      <span className="field-label">连接方式</span>
      <div className="provider-options" role="group" aria-label="模型协议">
        {(['demo', 'openai', 'anthropic'] as Provider[]).map(provider => <button key={provider} type="button" aria-pressed={draft.provider === provider} className={draft.provider === provider ? 'selected' : ''} onClick={() => providerChange(provider)}>
          {provider === 'demo' ? <Sprout size={17} /> : provider === 'openai' ? <Globe2 size={17} /> : <ClayMark small />}
          <span>{providerNames[provider]}</span>{draft.provider === provider && <Check size={14} />}
        </button>)}
      </div>
      {draft.provider === 'demo' ? <div className="demo-explanation"><Lightbulb size={20} /><div><strong>先体验，再连接</strong><p>演示模式在本地播放预设回复，方便体验界面、会话和 Markdown。真实 AI 对话需要连接模型服务。</p></div></div> : <div className="connection-fields">
        <label className="field-label" htmlFor="base-url">接口地址 <span>Base URL</span></label>
        <input id="base-url" type="url" value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} required placeholder="https://your-provider.example/v1" spellCheck={false} />
        <p className="field-hint">支持服务商的 API 地址，也支持本地 Ollama 等兼容服务。</p>
        <label className="field-label" htmlFor="model-id">模型 ID</label>
        <input id="model-id" value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} required placeholder="填写服务商提供的完整模型名称" spellCheck={false} />
        <label className="field-label" htmlFor="api-key">API Key {draft.provider === 'openai' && <span>本地服务可留空</span>}</label>
        <div className="secret-field"><input id="api-key" type={showKey ? 'text' : 'password'} value={key} onChange={event => setKey(event.target.value)} placeholder="输入你的 API Key" autoComplete="off" spellCheck={false} /><IconButton label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton></div>
        <p className="field-hint">{window.clay ? 'Key 使用系统加密保存在此设备。' : 'Key 仅保留在当前浏览器标签页，关闭后自动清除。'}</p>
        <details className="advanced-settings"><summary>系统提示词 <ChevronDown size={14} /></summary><textarea aria-label="系统提示词" rows={4} value={draft.systemPrompt} onChange={event => setDraft({ ...draft, systemPrompt: event.target.value })} maxLength={20000} /></details>
      </div>}
      {error && <p className="form-error" role="alert"><AlertCircle size={15} />{error}</p>}
      <div className="modal-actions"><span><Monitor size={14} /> 网页与桌面，共用体验</span><CdsButton type="submit" variant="primary" size="lg" className="primary-action" isLoading={saving}>保存设置 <ArrowRight size={16} /></CdsButton></div>
    </form>
  </Modal>;
}

type ComposerProps = { busy: boolean; settings: Settings; onSend: (text: string, files: Attachment[]) => void; onStop: () => void; onSettings: () => void; notify: (message: string) => void; suggestion: { text: string; id: number } | null };
function Composer({ busy, settings, onSend, onStop, onSettings, notify, suggestion }: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => { if (suggestion) { setText(suggestion.text); textarea.current?.focus(); } }, [suggestion]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(180, textarea.current.scrollHeight)}px`; } }, [text]);
  function send() {
    if (busy || (!text.trim() && !attachments.length)) return;
    onSend(text.trim(), attachments);
    setText(''); setAttachments([]);
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const incoming: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (attachments.length + incoming.length >= 4) { notify('每条消息最多添加 4 个文本附件。'); break; }
      if (file.size > 200_000) { notify(`${file.name} 超过 200 KB，请选择更小的文本文件。`); continue; }
      try {
        const content = await file.text();
        if (content.includes('\0')) { notify(`${file.name} 不是可读取的文本文件。`); continue; }
        incoming.push({ id: uid(), name: file.name, size: file.size, text: content });
      } catch { notify(`无法读取 ${file.name}。`); }
    }
    setAttachments(previous => [...previous, ...incoming].slice(0, 4));
    if (fileInput.current) fileInput.current.value = '';
  }
  return <div className="composer-wrap">
    <form className={`composer ${busy ? 'is-busy' : ''}`} onSubmit={event => { event.preventDefault(); send(); }}>
      {attachments.length > 0 && <div className="composer-attachments">{attachments.map(file => <span className="attachment-chip" key={file.id}><FileText size={14} /><span>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setAttachments(attachments.filter(item => item.id !== file.id))}><X size={12} /></button></span>)}</div>}
      <textarea ref={textarea} aria-label="消息输入框" placeholder="有什么想法？从这里开始…" value={text} onChange={event => setText(event.target.value)} rows={2} maxLength={150000} disabled={busy}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} />
      <div className="composer-toolbar"><div className="composer-tools">
        <IconButton label="添加文本附件" onClick={() => fileInput.current?.click()} disabled={busy}><Plus size={20} /></IconButton>
        <span className="tool-divider" />
        <button type="button" className="model-button" onClick={onSettings} disabled={busy}><span className={`model-dot ${settings.provider !== 'demo' ? 'live' : ''}`} /><span>{settings.provider === 'demo' ? '演示助手' : settings.model || '选择模型'}</span><ChevronDown size={13} /></button>
      </div><div className="composer-send"><span className="enter-hint"><CornerDownLeft size={12} /> 发送</span>{busy ? <CdsButton type="button" size="icon" variant="secondary" className="stop-button" aria-label="停止生成" onClick={onStop}><Square size={15} fill="currentColor" /></CdsButton> : <CdsButton type="submit" size="icon" variant="primary" className="send-button" aria-label="发送消息" disabled={!text.trim() && !attachments.length}><ArrowUp size={19} strokeWidth={2.3} /></CdsButton>}</div></div>
      <input ref={fileInput} type="file" className="hidden-input" aria-label="选择文本文件" multiple accept=".txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.log,.sql,.sh,.rs,.go,.java,.c,.cpp" onChange={event => void addFiles(event.target.files)} />
    </form>
    <p className="composer-caption">{settings.provider === 'demo' ? <>当前为离线演示。<button onClick={onSettings}>连接你的模型 <ArrowRight size={11} /></button></> : <>AI 的回答可能有误，请核实重要信息。</>}<span className="shortcut-hint">Shift + Enter 换行</span></p>
  </div>;
}

function CodeFence({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="code-fence"><div className="code-heading"><span><Code2 size={13} /> CODE</span><button type="button" aria-label="复制代码" onClick={async () => {
    try { await navigator.clipboard.writeText(ref.current?.textContent || ''); setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  }}>{copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制代码</>}</button></div><pre ref={ref}>{children}</pre></div>;
}

function MessageView({ message, onCopy, onRetry, last, busy }: { message: Message; onCopy: () => void; onRetry: () => void; last: boolean; busy: boolean }) {
  if (message.role === 'user') return <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SNAPPY} className="message user-message" aria-label="你的消息"><div className="user-bubble">{message.content && <p>{message.content}</p>}{message.attachments?.map(file => <span className="message-attachment" key={file.id}><FileText size={14} />{file.name}</span>)}</div></motion.article>;
  return <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SNAPPY} className="message assistant-message" aria-label="助手消息">
    <div className="assistant-label"><ClayMark small /><strong>Clay</strong>{message.demo && <span className="demo-label">演示</span>}{message.status === 'streaming' && <span className="typing-label">正在回复<span className="breathing-dot" /></span>}</div>
    <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <CodeFence>{children}</CodeFence>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '外部图片'}]</span> }}>{message.content}</ReactMarkdown>{!message.content && message.status === 'streaming' && <span className="thinking-dots" aria-label="等待回复"><i /><i /><i /></span>}</div>
    {message.error && <div className="message-error" role="alert"><AlertCircle size={15} /><span>{message.error}</span></div>}
    {message.status === 'stopped' && <p className="message-stopped">已停止生成</p>}
    {message.status !== 'streaming' && <div className="message-actions"><IconButton label="复制回复" onClick={onCopy} disabled={!message.content}><Copy size={14} /></IconButton>{last && <IconButton label="重新生成" onClick={onRetry} disabled={busy}><RotateCcw size={14} /></IconButton>}</div>}
  </motion.article>;
}

const suggestions = [
  { icon: Feather, label: '写得更好', subtitle: '让表达更清晰，也更动人', prompt: '帮我润色一段文字，让表达更清晰自然。请先问我文字的内容、读者和期望的语气。', color: 'terracotta' },
  { icon: Code2, label: '把想法变成代码', subtitle: '从一个小想法开始构建', prompt: '我想开发一个小工具，请先帮我梳理需求，再制定一个最小可行版本的开发计划。', color: 'sage' },
  { icon: Lightbulb, label: '理清思路', subtitle: '拆解问题，找到下一步', prompt: '我有一个还不够清晰的想法，想请你通过提问帮我梳理目标、约束和下一步行动。', color: 'ochre' },
  { icon: BookOpen, label: '一起学点新东西', subtitle: '把复杂的知识讲简单', prompt: '我想学习一个新领域。请先问我的学习主题和基础，再用通俗的例子帮我入门。', color: 'slate' },
];

export default function App({ initialState, initialKey }: { initialState: Workspace; initialKey: string }) {
  const [state, setState] = useState(initialState);
  const [apiKey, setApiKey] = useState(initialKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ text: string; id: number } | null>(null);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageFailed = useRef(false);
  const active = state.conversations.find(item => item.id === state.activeId);
  const busy = streamingId !== null;
  const messages = active?.messages || [];
  const scroller = useClaudeScrollPinning([messages.length, messages.at(-1)?.content]);
  const notify = useCallback((message: string) => {
    setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.theme === 'dark' ? '#20201e' : '#f7f6f2');
  }, [state.theme]);
  useEffect(() => {
    try { void saveWorkspace(state).catch(() => { if (!storageFailed.current) { storageFailed.current = true; notify('本地保存失败，请导出重要对话后检查磁盘空间。'); } }); }
    catch { if (!storageFailed.current) { storageFailed.current = true; notify('浏览器存储空间不足，请导出重要对话。'); } }
  }, [state, notify]);
  useEffect(() => () => { abortRef.current?.abort(); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const newChat = useCallback(() => {
    stop(); setState(previous => ({ ...previous, activeId: null })); setSuggestion(null); setSidebarOpen(false); setFilter('all');
  }, [stop]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); newChat(); }
    };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  }, [newChat]);
  useEffect(() => { if (state.activeId) requestAnimationFrame(() => scroller.scrollToBottom()); }, [state.activeId]);

  async function generate(threadId: string, history: Message[]) {
    if (abortRef.current) return;
    const controller = new AbortController(); abortRef.current = controller; setStreamingId(threadId);
    const assistant: Message = { id: uid(), role: 'assistant', content: '', createdAt: Date.now(), status: 'streaming', demo: state.settings.provider === 'demo' };
    setState(previous => ({ ...previous, conversations: previous.conversations.map(item => item.id === threadId ? { ...item, messages: [...history, assistant], updatedAt: Date.now() } : item) }));
    const update = (patch: Partial<Message>) => setState(previous => ({ ...previous, conversations: previous.conversations.map(item => item.id === threadId ? { ...item, messages: item.messages.map(message => message.id === assistant.id ? { ...message, ...patch } : message) } : item) }));
    let content = '';
    try {
      await streamChat(state.settings, apiKey, history.filter(message => !message.error), controller.signal, text => { content += text; update({ content }); });
      update({ status: 'complete' });
    } catch (error) {
      if (controller.signal.aborted) update({ status: 'stopped' });
      else update({ status: 'error', error: error instanceof Error ? error.message : '连接失败，请检查模型设置后重试。' });
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setStreamingId(null); }
    }
  }

  function send(text: string, files: Attachment[]) {
    if (abortRef.current) return;
    const user: Message = { id: uid(), role: 'user', content: text, attachments: files, createdAt: Date.now() };
    const threadId = active?.id || uid();
    const history = [...(active?.messages || []), user];
    if (!active) {
      const thread: Conversation = { id: threadId, title: (text || files[0]?.name || '新对话').replace(/\s+/g, ' ').slice(0, 28), messages: [user], updatedAt: Date.now(), pinned: false };
      setState(previous => ({ ...previous, activeId: threadId, conversations: [thread, ...previous.conversations] }));
    }
    void generate(threadId, history);
  }
  function retry() {
    if (!active || busy) return;
    const lastUser = active.messages.findLastIndex(message => message.role === 'user');
    if (lastUser >= 0) void generate(active.id, active.messages.slice(0, lastUser + 1));
  }
  async function copy(content: string) {
    try { await navigator.clipboard.writeText(content); notify('已复制到剪贴板'); } catch { notify('无法访问剪贴板，请手动选择文字复制。'); }
  }
  async function exportActive() {
    if (!active) return;
    const name = `${active.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.md`;
    const content = exportMarkdown(active);
    try {
      if (window.clay) { if (await window.clay.exportFile(name, content)) notify('对话已导出'); }
      else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('对话已导出');
      }
    } catch { notify('导出失败，请重试。'); }
  }
  function togglePin(id: string) { setState(previous => ({ ...previous, conversations: previous.conversations.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item) })); }
  function selectThread(id: string) { setState(previous => ({ ...previous, activeId: id })); setSidebarOpen(false); setSearchOpen(false); }
  const listed = [...state.conversations].filter(item => filter === 'all' || item.pinned).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  const results = state.conversations.filter(item => item.title.toLowerCase().includes(query.toLowerCase()) || item.messages.some(message => message.content.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt);
  return <div className={`app-shell ${window.clay ? 'desktop-shell' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    {window.clay && <div className="desktop-titlebar" data-tauri-drag-region><span data-tauri-drag-region><ClayMark small /> Clay Chat</span><div><IconButton label="最小化窗口" onClick={() => window.clay?.windowControl('minimize')}><Minus size={15} /></IconButton><IconButton label="最大化窗口" onClick={() => window.clay?.windowControl('maximize')}><Maximize2 size={13} /></IconButton><IconButton label="关闭窗口" className="window-close" onClick={() => window.clay?.windowControl('close')}><X size={16} /></IconButton></div></div>}
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="收起导航" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand"><button className="brand-button" onClick={newChat} aria-label="Clay Chat 首页"><span className="brand-icon"><ClayMark small /></span><span>clay<span className="brand-light"> chat</span></span></button><IconButton label="收起侧边栏" className="collapse-button" onClick={() => { setSidebarCollapsed(true); setSidebarOpen(false); }}><PanelLeftClose size={17} /></IconButton></div>
      <p className="workspace-label">PERSONAL WORKSPACE</p>
      <button className="new-chat-button" onClick={newChat}><Plus size={18} /><span>开启新对话</span><kbd>Ctrl N</kbd></button>
      <nav className="main-nav" aria-label="主导航"><button onClick={() => { setSearchOpen(true); setSidebarOpen(false); }}><Search size={17} /><span>搜索对话</span><kbd>Ctrl K</kbd></button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}><MessageSquare size={17} /><span>所有对话</span><span className="nav-count">{state.conversations.length}</span></button><button className={filter === 'pinned' ? 'active' : ''} onClick={() => setFilter('pinned')}><Star size={17} /><span>我的收藏</span>{state.conversations.some(item => item.pinned) && <span className="nav-count">{state.conversations.filter(item => item.pinned).length}</span>}</button></nav>
      <div className="conversation-heading"><span>{filter === 'pinned' ? '收藏的对话' : '最近对话'}</span><span>{listed.length ? '仅存于本地' : ''}</span></div>
      <div className="conversation-list">{listed.length ? listed.map(item => <div key={item.id} className={`conversation-item ${item.id === state.activeId ? 'selected' : ''}`}>
        <button className="conversation-link" onClick={() => selectThread(item.id)}>{streamingId === item.id ? <span className="breathing-dot" /> : item.pinned ? <Star size={13} className="pinned-star" /> : <MessageSquare size={13} />}<span>{item.title}</span></button><div className="conversation-tools"><IconButton label={item.pinned ? '取消收藏' : '收藏对话'} onClick={() => togglePin(item.id)}><Star size={13} fill={item.pinned ? 'currentColor' : 'none'} /></IconButton><IconButton label="删除对话" onClick={() => setDeleteId(item.id)}><Trash2 size={13} /></IconButton></div>
      </div>) : <div className="sidebar-empty"><span className="empty-line" /><p>{filter === 'pinned' ? '把值得留住的想法收藏起来' : '好想法，总有一个开始。'}</p><span>{filter === 'pinned' ? '点击对话旁的星标即可收藏' : '你的对话会出现在这里'}</span></div>}</div>
      <div className="sidebar-bottom"><button className="connect-card" onClick={() => setSettingsOpen(true)}><span className="connect-icon"><Sprout size={19} /></span><strong>你的模型，你的空间</strong><p>连接熟悉的 AI，开始新的可能。</p><span className="connect-cta">设置模型连接 <ArrowRight size={13} /></span></button><div className="sidebar-controls"><button onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>设置</span></button><IconButton label={state.theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setState(previous => ({ ...previous, theme: previous.theme === 'light' ? 'dark' : 'light' }))}>{state.theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</IconButton></div><div className="workspace-profile"><span className="profile-avatar">C</span><div><strong>本地工作空间</strong><span>留一点空间，给下一个想法</span></div><span className="local-indicator" title="数据保存在此设备" /></div></div>
    </aside>
    <main className="main-workspace">
      <header className="workspace-header"><div className="breadcrumbs"><IconButton label="展开侧边栏" className="expand-button" onClick={() => { setSidebarCollapsed(false); setSidebarOpen(true); }}><PanelLeft size={18} /></IconButton><span>个人空间</span><span className="breadcrumb-slash">/</span><strong>{active?.title || '新对话'}</strong></div><div className="header-actions"><button className={`connection-badge ${state.settings.provider !== 'demo' ? 'configured' : ''}`} onClick={() => setSettingsOpen(true)}><span />{state.settings.provider === 'demo' ? '演示模式' : '模型已配置'}</button>{active && <><IconButton label={active.pinned ? '取消收藏当前对话' : '收藏当前对话'} onClick={() => togglePin(active.id)}><Star size={16} fill={active.pinned ? 'currentColor' : 'none'} /></IconButton><IconButton label="导出对话" onClick={() => void exportActive()}><Download size={17} /></IconButton></>}</div></header>
      {!active ? <div className="welcome-scroll"><motion.section className="welcome" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SNAPPY}>
        <div className="welcome-kicker"><span className="kicker-line" /> A LITTLE SPACE FOR BIG IDEAS <span className="kicker-line" /></div>
        <div className="hero-mark"><ClayMark /></div>
        <h1>给想法一点<span>生长的空间<span className="hero-period">。</span></span></h1>
        <p className="welcome-description">写作、编程、思考，或者只是聊聊。<br className="mobile-break" />每个好想法，都值得被认真对待。</p>
        <Composer key="new" busy={busy} settings={state.settings} onSend={send} onStop={stop} onSettings={() => setSettingsOpen(true)} notify={notify} suggestion={suggestion} />
        <div className="suggestion-heading"><span>从一点灵感开始</span><span className="suggestion-rule" /><span>或写下任何你想聊的</span></div>
        <div className="suggestion-grid">{suggestions.map(item => <button key={item.label} className="suggestion-card" onClick={() => setSuggestion({ text: item.prompt, id: Date.now() })}><span className={`suggestion-icon ${item.color}`}><item.icon size={20} strokeWidth={1.6} /></span><span className="suggestion-text"><strong>{item.label}</strong><span>{item.subtitle}</span></span><ArrowUp size={15} className="suggestion-arrow" /></button>)}</div>
        <p className="welcome-footnote"><span className="tiny-flower">✳</span> 少一点干扰，多一点专注。</p>
      </motion.section></div> : <div className="chat-layout"><div className="message-scroll" ref={scroller.containerRef} onScroll={scroller.handleScroll} onWheel={scroller.markUserInput} onTouchStart={scroller.markUserInput} onKeyDown={event => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) scroller.markUserInput(); }} tabIndex={0} aria-label="对话内容"><div className="message-column">{messages.map((message, index) => <MessageView key={message.id} message={message} onCopy={() => void copy(message.content)} onRetry={retry} last={index === messages.length - 1} busy={busy} />)}</div></div>{scroller.showJumpControl && <button className="jump-button" onClick={() => scroller.scrollToBottom(true)}><ArrowDown size={15} />回到最新</button>}<div className="chat-composer"><Composer key={active.id} busy={busy} settings={state.settings} onSend={send} onStop={stop} onSettings={() => setSettingsOpen(true)} notify={notify} suggestion={null} /></div></div>}
      <footer className="workspace-footer"><span><span className="footer-dot" /> 为专注而设计 <span className="footer-separator">·</span> Open Claude UI</span><span>{window.clay ? <Monitor size={12} /> : <Globe2 size={12} />} {window.clay ? 'DESKTOP' : 'WEB'} <span className="version-label">v0.1</span></span></footer>
    </main>
    {settingsOpen && <SettingsModal settings={state.settings} apiKey={apiKey} onClose={() => setSettingsOpen(false)} onSave={async (settings, key) => {
      setState(previous => ({ ...previous, settings })); setApiKey(key);
      try { if (window.clay) await window.clay.saveSecret(key); else sessionStorage.setItem(KEY_STORAGE, key); }
      catch { notify('设置已保存。Key 无法持久保存，仅在当前会话中使用。'); return; }
      notify(settings.provider === 'demo' ? '已切换到演示模式' : '模型设置已保存，可以开始对话');
    }} />}
    {searchOpen && <Modal title="找到那个想法" eyebrow="SEARCH YOUR SPACE" onClose={() => { setSearchOpen(false); setQuery(''); }} className="search-modal"><div className="search-field"><Search size={19} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索对话标题或内容…" aria-label="搜索对话" /></div><div className="search-results">{results.length ? results.map(item => <button key={item.id} onClick={() => selectThread(item.id)}><MessageSquare size={17} /><span><strong>{item.title}</strong><span>{item.messages.find(message => message.role === 'user')?.content.slice(0, 90) || '文本附件对话'}</span></span><ArrowRight size={15} /></button>) : <div className="search-empty"><Search size={25} /><p>{query ? '没有找到相关对话，换个关键词试试。' : '开始第一段对话后，就能在这里找到它。'}</p></div>}</div></Modal>}
    {deleteId && <Modal title="删除这段对话？" onClose={() => setDeleteId(null)} className="confirm-modal"><p className="modal-description">对话将从此设备移除。需要保留的内容，可以先导出。</p><div className="confirm-actions"><CdsButton onClick={() => setDeleteId(null)}>保留对话</CdsButton><CdsButton variant="danger" onClick={() => { if (deleteId === streamingId) stop(); setState(previous => ({ ...previous, conversations: previous.conversations.filter(item => item.id !== deleteId), activeId: previous.activeId === deleteId ? null : previous.activeId })); setDeleteId(null); notify('对话已删除'); }}>删除对话</CdsButton></div></Modal>}
    <AnimatePresence>{toast && <motion.div key={toast} className="toast" role="status" style={{ x: '-50%' }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={SPRING_SNAPPY}><Check size={16} /><span>{toast}</span></motion.div>}</AnimatePresence>
  </div>;
}
