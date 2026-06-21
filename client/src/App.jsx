import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './index.css';

// ── Free OpenRouter models (verified live from openrouter.ai/api/v1/models) ──
const FREE_MODELS = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free',         label: 'Llama 3.3 70B  ·  Meta' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',          label: 'Nemotron 3 Super 120B  ·  NVIDIA' },
  { id: 'google/gemma-4-31b-it:free',                      label: 'Gemma 4 31B  ·  Google' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free',           label: 'Qwen3 80B  ·  Alibaba' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free',       label: 'Hermes 3 405B  ·  NousResearch' },
  { id: 'meta-llama/llama-3.2-3b-instruct:free',           label: 'Llama 3.2 3B  ·  Meta (fast)' },
  { id: 'openai/gpt-oss-20b:free',                         label: 'GPT-OSS 20B  ·  OpenAI' },
];

// ── Stage detection ───────────────────────────────────────────────────────────
const STAGES = [
  { id: 'planning',     label: 'Planning research strategy',    pct: 15 },
  { id: 'searching',    label: 'Searching & extracting sources', pct: 45 },
  { id: 'synthesizing', label: 'Synthesizing findings',          pct: 75 },
  { id: 'writing',      label: 'Writing report sections',        pct: 90 },
];

function detectStage(line) {
  if (/\[planning\]/i.test(line))     return 'planning';
  if (/\[searching\]|\[extracting\]/i.test(line)) return 'searching';
  if (/\[synthesizing\]/i.test(line)) return 'synthesizing';
  if (/\[writing\]/i.test(line))      return 'writing';
  return null;
}

function classifyLog(line) {
  if (/error|failed|exception|traceback/i.test(line)) return 'error';
  if (/warning|warn/i.test(line))  return 'warn';
  if (/success|complete|done|saved/i.test(line)) return 'success';
  if (/searching for|found \d+ results|searching \(\d/i.test(line)) return 'search';
  if (/extracting content from|extracted \d+/i.test(line)) return 'extract';
  if (/http request|primp:response/i.test(line)) return 'network';
  return 'info';
}

function formatLogLine(raw) {
  return raw
    .replace(/^INFO:|^WARNING:|^ERROR:|^DEBUG:/i, '')
    .replace(/^src\.[^:]+:/i, '')
    .replace(/^__main__:/i, '')
    .trim();
}

const LOG_PREFIXES = {
  error:   '✗ Error',  warn:    '⚠ Warn',
  success: '✓ Done',   search:  '⌕ Search',
  extract: '⇩ Extract', network: '◉ Net',
  info:    '· Info',
};

function buildLogEntry(rawLine) {
  const type = classifyLog(rawLine);
  if (type === 'network' && !/200|404|429/.test(rawLine)) return null;
  const text = formatLogLine(rawLine);
  if (!text || text.length < 4) return null;
  return { type, prefix: LOG_PREFIXES[type] || '·', text, raw: rawLine };
}

// ── Metrics extraction ────────────────────────────────────────────────────────
function computeMetrics(logs, report, durationMs) {
  let searches = 0, pagesExtracted = 0, sourcesFound = 0, findings = 0;
  for (const { raw } of logs) {
    const foundMatch   = raw.match(/Found (\d+) results for/i);
    const extractMatch = raw.match(/Extracted (\d+) characters from/i);
    const findingsMatch = raw.match(/Extracted (\d+) key findings/i);
    const searchMatch  = raw.match(/Searching \((\d+)\/\d+\)/i);
    if (foundMatch)    sourcesFound   += parseInt(foundMatch[1]);
    if (extractMatch)  pagesExtracted++;
    if (findingsMatch) findings        = parseInt(findingsMatch[1]);
    if (searchMatch)   searches        = Math.max(searches, parseInt(searchMatch[1]));
  }
  const wordCount = report ? report.split(/\s+/).length : 0;
  const minutes   = durationMs ? (durationMs / 60000).toFixed(1) : '–';
  return { searches, pagesExtracted, sourcesFound, findings, wordCount, minutes };
}

// ── How To Use Page ───────────────────────────────────────────────────────────
function HowToUsePage() {
  const steps = [
    {
      num: '01',
      title: 'Create a free OpenRouter account',
      body: 'Go to openrouter.ai and sign up for a free account. No credit card is required to start.',
      link: { href: 'https://openrouter.ai', label: 'Sign up at openrouter.ai →' },
      accent: '#60A5FA',
    },
    {
      num: '02',
      title: 'Generate your free API key',
      body: 'After logging in, go to openrouter.ai/keys and click "Create Key". Give it any name and copy the key — it starts with sk-or-…',
      link: { href: 'https://openrouter.ai/keys', label: 'Go to openrouter.ai/keys →' },
      accent: '#3DD68C',
    },
    {
      num: '03',
      title: 'Paste your key in the sidebar',
      body: 'Back in this app, paste your sk-or-… key into the "OpenRouter API Key" field in the left sidebar. It is saved locally in your browser.',
      accent: '#A78BFA',
    },
    {
      num: '04',
      title: 'Choose a free model',
      body: 'Pick any model from the "Model" dropdown. All listed models are 100% free on OpenRouter — no billing needed. Larger models produce deeper reports.',
      accent: '#F59E0B',
    },
    {
      num: '05',
      title: 'Enter your research topic & go!',
      body: 'Type any topic into the search bar at the bottom and press Enter. The agent will autonomously plan, search the web, synthesize findings, and generate a full cited report in minutes.',
      accent: '#3DD68C',
    },
  ];

  const faqs = [
    { q: 'Is this really free?', a: 'Yes. OpenRouter offers free-tier access to several capable open-source models with no credit card required.' },
    { q: 'Is my API key safe?', a: 'Your key is stored only in your browser\'s localStorage. It is never sent to any third-party server — only to OpenRouter\'s own API via this app.' },
    { q: 'Why is the report taking a while?', a: 'Deep research is multi-step: planning → searching → extracting → synthesizing → writing. Free model rate limits can add some wait time. Larger models are slower but produce richer results.' },
    { q: 'Can I use a paid model?', a: 'Yes! Any OpenRouter model ID works. Just select "Custom" (or edit the URL) and paste any model ID from openrouter.ai/models.' },
  ];

  return (
    <div className="howto-page">
      <div className="howto-hero">
        <div className="howto-badge">Setup Guide</div>
        <h1>Get started in 5 minutes</h1>
        <p>Deep Research Agent uses OpenRouter to access powerful AI models for free. Here's how to set it up.</p>
      </div>

      <div className="howto-steps">
        {steps.map(s => (
          <div className="howto-step" key={s.num}>
            <div className="howto-step-num" style={{ color: s.accent, borderColor: s.accent + '33' }}>{s.num}</div>
            <div className="howto-step-body">
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {s.link && (
                <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="howto-link">
                  {s.link.label}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="howto-faq">
        <h2>Frequently asked questions</h2>
        <div className="faq-grid">
          {faqs.map(f => (
            <div className="faq-card" key={f.q}>
              <h4>{f.q}</h4>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="howto-models">
        <h2>Available free models</h2>
        <p className="howto-models-sub">All models below are confirmed free on OpenRouter as of June 2025.</p>
        <div className="models-table">
          <div className="models-row models-header">
            <span>Model</span>
            <span>Provider</span>
            <span>Best for</span>
          </div>
          {[
            ['Llama 3.3 70B', 'Meta', 'Balanced quality + speed'],
            ['Nemotron 3 Super 120B', 'NVIDIA', 'Deep, nuanced research'],
            ['Gemma 4 31B', 'Google', 'Structured reports'],
            ['Qwen3 80B', 'Alibaba', 'Technical topics'],
            ['Hermes 3 405B', 'NousResearch', 'Highest quality (slower)'],
            ['GPT-OSS 20B', 'OpenAI', 'Fast responses'],
            ['Llama 3.2 3B', 'Meta', 'Quick drafts (fastest)'],
          ].map(([name, provider, best]) => (
            <div className="models-row" key={name}>
              <span className="model-name-cell">{name}</span>
              <span>{provider}</span>
              <span className="model-best-cell">{best}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MetricsBar ────────────────────────────────────────────────────────────────
function MetricsBar({ metrics }) {
  const items = [
    { label: 'Queries Run',     value: metrics.searches       || '–', icon: '⌕' },
    { label: 'Pages Extracted', value: metrics.pagesExtracted || '–', icon: '⇩' },
    { label: 'Sources Indexed', value: metrics.sourcesFound   || '–', icon: '◉' },
    { label: 'Key Findings',    value: metrics.findings       || '–', icon: '◆' },
    { label: 'Report Words',    value: (metrics.wordCount || 0).toLocaleString(), icon: '📄' },
    { label: 'Total Time',      value: metrics.minutes + ' min', icon: '⏱' },
  ];
  return (
    <div className="metrics-bar">
      {items.map(item => (
        <div className="metric-card" key={item.label}>
          <span className="metric-icon">{item.icon}</span>
          <span className="metric-value">{item.value}</span>
          <span className="metric-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── ProgressPanel ─────────────────────────────────────────────────────────────
function ProgressPanel({ stageId, pct, logs, traceOpen, setTraceOpen }) {
  const stageIdx = STAGES.findIndex(s => s.id === stageId);
  const logEndRef = useRef(null);
  useEffect(() => {
    if (traceOpen && logEndRef.current)
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [logs, traceOpen]);

  return (
    <div className="progress-panel">
      <div className="progress-panel-header">
        <span className="progress-title">Researching…</span>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="progress-pct">{pct}%</span>
      </div>

      <div className="stage-list">
        {STAGES.map((s, i) => {
          const state = i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending';
          return (
            <div className="stage-row" key={s.id}>
              <div className={`stage-icon ${state}`}>
                {state === 'done' ? '✓' : state === 'active' ? <span className="pulsing">●</span> : '○'}
              </div>
              <span className={`stage-label ${state}`}>{s.label}</span>
            </div>
          );
        })}
      </div>

      <button className="trace-toggle" onClick={() => setTraceOpen(o => !o)}>
        <svg style={{ transform: traceOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {traceOpen ? 'Hide' : 'Show'} live traces
        <span className="trace-count">{logs.length}</span>
      </button>

      {traceOpen && (
        <div className="trace-panel">
          {logs.map((entry, i) => (
            <div key={i} className={`trace-line trace-${entry.type}`}>
              <span className="trace-prefix">{entry.prefix}</span>
              <span className="trace-text">{entry.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}

// ── ReportView ────────────────────────────────────────────────────────────────
function ReportView({ topic, content }) {
  const wordCount = content.split(/\s+/).length.toLocaleString();
  const handleCopy = () => navigator.clipboard.writeText(content);
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${topic.replace(/\s+/g, '_')}_report.md` });
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div>
      <div className="report-body">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</ReactMarkdown>
      </div>
      <div className="report-actions">
        <button className="action-btn" onClick={handleCopy}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>Copy Markdown
        </button>
        <button className="action-btn" onClick={handleDownload}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>Download .md
        </button>
        <span className="word-count">{wordCount} words</span>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions, setSessions]   = useState([]);
  const [activeId, setActiveId]   = useState(null);
  const [input, setInput]         = useState('');
  const [status, setStatus]       = useState('idle');
  const [stageId, setStageId]     = useState('planning');
  const [progress, setProgress]   = useState(0);
  const [logs, setLogs]           = useState([]);
  const [traceOpen, setTraceOpen] = useState(true);
  const [metrics, setMetrics]     = useState(null);
  const [view, setView]           = useState('chat'); // 'chat' | 'howto'

  // Settings — persisted in localStorage
  const [apiKey, setApiKey]           = useState(() => localStorage.getItem('or_api_key') || '');
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('or_model') || FREE_MODELS[0].id
  );
  const [showKey, setShowKey] = useState(false);

  const chatBodyRef = useRef(null);
  const textareaRef = useRef(null);
  const esRef       = useRef(null);

  const activeSession = sessions.find(s => s.id === activeId);

  // Persist settings
  useEffect(() => { localStorage.setItem('or_api_key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('or_model', selectedModel); }, [selectedModel]);

  useEffect(() => {
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [sessions, activeId, status, logs]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  const startNewSession = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setActiveId(null); setInput(''); setStatus('idle'); setLogs([]); setMetrics(null);
    setView('chat');
  };

  const handleSubmit = () => {
    if (!input.trim() || status === 'working') return;
    if (!apiKey.trim()) { alert('Please enter your OpenRouter API key in the sidebar first.'); return; }
    const topic = input.trim();
    setInput('');
    const id = Date.now().toString();
    const t0 = Date.now();
    setSessions(prev => [{ id, topic, report: null, error: null }, ...prev]);
    setActiveId(id);
    setStatus('working');
    setStageId('planning');
    setProgress(10);
    setLogs([]);
    setMetrics(null);
    setTraceOpen(true);
    setView('chat');

    const url = `/api/research/stream?topic=${encodeURIComponent(topic)}&apiKey=${encodeURIComponent(apiKey)}&model=${encodeURIComponent(selectedModel)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('log', (e) => {
      const { line } = JSON.parse(e.data);
      const detected = detectStage(line);
      if (detected) {
        const s = STAGES.find(s => s.id === detected);
        if (s) { setStageId(s.id); setProgress(s.pct); }
      }
      const entry = buildLogEntry(line);
      if (entry) setLogs(prev => [...prev, entry]);
    });

    es.addEventListener('done', (e) => {
      const { report } = JSON.parse(e.data);
      const durationMs = Date.now() - t0;
      setProgress(100);
      setSessions(prev => prev.map(s => s.id === id ? { ...s, report } : s));
      setStatus('done');
      setLogs(prev => { setMetrics(computeMetrics(prev, report, durationMs)); return prev; });
      es.close();
    });

    es.addEventListener('error', (e) => {
      let msg = 'Connection lost or research failed';
      try { msg = JSON.parse(e.data).message; } catch {}
      setSessions(prev => prev.map(s => s.id === id ? { ...s, error: msg } : s));
      setStatus('error');
      es.close();
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const topbarTitle = view === 'howto' ? 'Setup & Usage Guide' : (activeSession?.topic ?? 'New Research');
  const statusLabel = { idle: 'Ready', working: 'Researching', done: 'Complete', error: 'Error' }[status];
  const statusClass = { idle: 'idle', working: 'working', done: 'done', error: 'idle' }[status];
  const canResearch = apiKey.trim().length > 0;

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                <line x1="11" y1="8" x2="11" y2="14"></line>
                <line x1="8" y1="11" x2="14" y2="11"></line>
              </svg>
            </div>
            <span className="brand-name">Deep Research Agent</span>
          </div>
          <button className="new-chat-btn" onClick={startNewSession}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Research
          </button>
        </div>

        {/* ── Navigation ── */}
        <div className="sidebar-nav">
          <button className={`nav-btn ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Research
          </button>
          <button className={`nav-btn ${view === 'howto' ? 'active' : ''}`} onClick={() => setView('howto')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            How to Use
          </button>
        </div>

        {sessions.length > 0 && view === 'chat' && (
          <>
            <div className="sidebar-section-label">History</div>
            <div className="history-list">
              {sessions.map(s => (
                <div key={s.id} className={`history-item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => setActiveId(s.id)}>
                  <span className="history-item-title">{s.topic}</span>
                  <span className="history-item-meta">
                    {s.report ? `${s.report.split(/\s+/).length.toLocaleString()} words` : s.error ? 'Failed' : 'In progress…'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Settings panel ── */}
        <div className="settings-panel">
          <div className="settings-label">OpenRouter API Key</div>
          <div className="api-key-field">
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="sk-or-v1-…"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className={`api-key-input ${apiKey ? (apiKey.startsWith('sk-or') ? 'valid' : 'warn') : ''}`}
              spellCheck={false}
            />
            <button className="show-key-btn" onClick={() => setShowKey(v => !v)} title={showKey ? 'Hide key' : 'Show key'}>
              {showKey
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              }
            </button>
          </div>
          {!apiKey && (
            <a href="#" className="settings-hint" onClick={e => { e.preventDefault(); setView('howto'); }}>
              No key? Get one free →
            </a>
          )}
          {apiKey && !apiKey.startsWith('sk-or') && (
            <span className="settings-warn">Key should start with sk-or-…</span>
          )}

          <div className="settings-label" style={{ marginTop: 14 }}>Model</div>
          <select className="model-select" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
            {FREE_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <div className="settings-hint-static">All models are free on OpenRouter</div>
        </div>

        <div className="sidebar-footer">
          <div className="model-badge">
            <div className={`model-dot ${canResearch ? '' : 'inactive'}`} />
            <span>{canResearch ? 'OpenRouter · Ready' : 'API key required'}</span>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="main">
        <div className="topbar">
          <span className="topbar-title">{topbarTitle}</span>
          <div className={`status-chip ${view === 'howto' ? 'idle' : statusClass}`}>
            {status === 'working' && view === 'chat' && <div className="spinner" style={{ width: 10, height: 10 }} />}
            {view === 'howto' ? 'Guide' : statusLabel}
          </div>
        </div>

        {/* ── How To Use View ── */}
        {view === 'howto' && (
          <div className="chat-body">
            <div className="messages-container">
              <HowToUsePage />
            </div>
          </div>
        )}

        {/* ── Chat / Research View ── */}
        {view === 'chat' && (
          <>
            <div className="chat-body" ref={chatBodyRef}>
              {!activeSession && (
                <div className="hero">
                  <div className="hero-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      <line x1="11" y1="8" x2="11" y2="14"></line>
                      <line x1="8" y1="11" x2="14" y2="11"></line>
                    </svg>
                  </div>
                  <h1>Deep Research Agent</h1>
                  <p>Autonomous multi-agent intelligence that plans, searches, synthesizes, and writes comprehensive cited reports — in minutes.</p>
                  {!canResearch && (
                    <div className="hero-warning">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Enter your OpenRouter API key in the sidebar to start.&nbsp;
                      <button className="hero-link-btn" onClick={() => setView('howto')}>How to get one →</button>
                    </div>
                  )}
                  <div className="capability-chips">
                    <span className="chip">◆ Strategic Planning</span>
                    <span className="chip">◆ Web Search</span>
                    <span className="chip">◆ Credibility Scoring</span>
                    <span className="chip">◆ AI Synthesis</span>
                    <span className="chip">◆ Report Writing</span>
                  </div>
                </div>
              )}

              {activeSession && (
                <div className="messages-container">
                  <div className="message user">
                    <div className="message-inner">{activeSession.topic}</div>
                  </div>

                  <div className="message agent">
                    <div className="agent-header">
                      <div className="agent-avatar">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          <line x1="11" y1="8" x2="11" y2="14"></line>
                          <line x1="8" y1="11" x2="14" y2="11"></line>
                        </svg>
                      </div>
                      Research Agent
                    </div>

                    {!activeSession.report && !activeSession.error && (
                      <ProgressPanel stageId={stageId} pct={progress} logs={logs}
                        traceOpen={traceOpen} setTraceOpen={setTraceOpen} />
                    )}

                    {activeSession.error && (
                      <div className="error-card">
                        <strong>Research failed</strong>
                        <p>{activeSession.error}</p>
                      </div>
                    )}

                    {activeSession.report && (
                      <>
                        {metrics && <MetricsBar metrics={metrics} />}
                        {logs.length > 0 && (
                          <details className="completed-trace">
                            <summary>View research traces ({logs.length} events)</summary>
                            <div className="trace-panel trace-panel-compact">
                              {logs.map((entry, i) => (
                                <div key={i} className={`trace-line trace-${entry.type}`}>
                                  <span className="trace-prefix">{entry.prefix}</span>
                                  <span className="trace-text">{entry.text}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        <ReportView topic={activeSession.topic} content={activeSession.report} />
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="input-area">
              <div style={{ width: '100%', maxWidth: 960, padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className={`input-shell ${!canResearch ? 'disabled' : ''}`}>
                  <textarea ref={textareaRef} rows={1} value={input}
                    onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder={canResearch ? 'Enter a research topic…' : 'Add your API key in the sidebar to start…'}
                    disabled={status === 'working' || !canResearch} />
                  <div className="input-toolbar">
                    <span className="char-hint">Enter to send &middot; Shift+Enter to add a newline</span>
                    <button className="send-btn" onClick={handleSubmit}
                      disabled={!input.trim() || status === 'working' || !canResearch}>
                      {status === 'working'
                        ? <div className="spinner" />
                        : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                      }
                    </button>
                  </div>
                </div>
                <div className="disclaimer">AI can make mistakes. Verify important information.</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
