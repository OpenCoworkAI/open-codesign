// when_to_use: Conversational AI / chat interface. Includes user / assistant
// bubbles, animated thinking dots with collapsible reasoning, tool-call card
// with collapsible output, and streaming bubble with typewriter cursor.
// Use when the brief asks for "chat", "conversation", "AI assistant",
// "agent UI", or "messaging".

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  accent: '#6366f1',
  userBg: '#6366f1',
  assistantBg: '#f4f4f5',
  fg: '#18181b',
} /*EDITMODE-END*/;

const DEMO_MESSAGES = [
  { id: 1, role: 'user', content: 'Can you help me write a Python function to parse CSV files?' },
  {
    id: 2,
    role: 'assistant',
    content: "Sure! Here's a clean utility using Python's built-in `csv` module:",
    code: `import csv\n\ndef parse_csv(filepath: str) -> list[dict]:\n    with open(filepath, newline='', encoding='utf-8') as f:\n        reader = csv.DictReader(f)\n        return list(reader)`,
  },
  {
    id: 3,
    role: 'tool',
    toolName: 'read_file',
    toolInput: '{ "path": "data/users.csv" }',
    toolOutput: 'name,email,role\nAlice,alice@co.com,admin\nBob,bob@co.com,member',
  },
  {
    id: 4,
    role: 'user',
    content: 'Nice. Can you also handle errors and support semicolon delimiters?',
  },
  {
    id: 5,
    role: 'thinking',
    content:
      'The user wants error handling and configurable delimiter. I should add a try/except block and a delimiter parameter defaulting to comma...',
  },
  {
    id: 6,
    role: 'streaming',
    content:
      "Absolutely — here's the improved version with error handling and a configurable `delimiter` param…",
  },
];

function ChatBubble({ msg }) {
  const isUser = msg.role === 'user';
  if (msg.role === 'thinking') return <ThinkingBubble content={msg.content} />;
  if (msg.role === 'tool') return <ToolCallCard msg={msg} />;
  if (msg.role === 'streaming') return <StreamingBubble content={msg.content} />;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#fff',
            marginTop: 2,
          }}
        >
          A
        </div>
      )}
      <div
        style={{
          maxWidth: '72%',
          padding: isUser ? '10px 16px' : '12px 16px',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isUser ? TWEAK_DEFAULTS.userBg : TWEAK_DEFAULTS.assistantBg,
          color: isUser ? '#fff' : TWEAK_DEFAULTS.fg,
          fontSize: 14,
          lineHeight: 1.55,
          fontFamily: 'Helvetica Neue, sans-serif',
        }}
      >
        {msg.code ? (
          <>
            <p style={{ margin: '0 0 10px' }}>{msg.content}</p>
            <div
              style={{
                background: '#18181b',
                borderRadius: 10,
                padding: '12px 14px',
                fontFamily: 'ui-monospace,monospace',
                fontSize: 12,
                color: '#e4e4e7',
                lineHeight: 1.6,
                whiteSpace: 'pre',
              }}
            >
              {msg.code}
            </div>
          </>
        ) : (
          msg.content
        )}
      </div>
      {isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#e4e4e7',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: '#71717a',
            marginTop: 2,
          }}
        >
          U
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#a1a1aa',
            animation: `chatDot 1.2s ${i * 0.2}s ease-in-out infinite`,
            display: 'inline-block',
          }}
        />
      ))}
      <style>
        {
          '@keyframes chatDot { 0%,80%,100% { transform: scale(1); opacity:.5 } 40% { transform: scale(1.3); opacity:1 } }'
        }
      </style>
    </span>
  );
}

function ThinkingBubble({ content }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: '#fff',
          marginTop: 2,
        }}
      >
        A
      </div>
      <div style={{ flex: 1 }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'none',
            border: '1px solid #e4e4e7',
            borderRadius: 20,
            padding: '6px 14px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            color: '#71717a',
          }}
        >
          <ThinkingDots />
          <span>Thinking…</span>
          <span
            style={{
              marginLeft: 2,
              fontSize: 9,
              transform: open ? 'rotate(180deg)' : 'none',
              display: 'inline-block',
              transition: 'transform .2s',
            }}
          >
            ▼
          </span>
        </button>
        {open && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 14px',
              background: '#fafafa',
              borderRadius: 10,
              border: '1px solid #e4e4e7',
              fontSize: 12,
              color: '#71717a',
              lineHeight: 1.6,
              fontStyle: 'italic',
              maxWidth: '72%',
            }}
          >
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ msg }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#f4f4f5',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          marginTop: 2,
        }}
      >
        🔧
      </div>
      <div style={{ flex: 1, maxWidth: '72%' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#fafafa',
            border: '1px solid #e4e4e7',
            borderRadius: 10,
            padding: '8px 14px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            color: '#52525b',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              background: '#fef3c7',
              color: '#92400e',
              padding: '1px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'ui-monospace,monospace',
            }}
          >
            {msg.toolName}
          </span>
          <span
            style={{
              color: '#a1a1aa',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {msg.toolInput}
          </span>
          <span
            style={{
              fontSize: 9,
              color: '#a1a1aa',
              transform: open ? 'rotate(180deg)' : 'none',
              display: 'inline-block',
              transition: 'transform .2s',
            }}
          >
            ▼
          </span>
        </button>
        {open && (
          <div
            style={{
              marginTop: 4,
              padding: '10px 14px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 10,
              fontFamily: 'ui-monospace,monospace',
              fontSize: 11,
              color: '#166534',
              lineHeight: 1.6,
              whiteSpace: 'pre',
            }}
          >
            {msg.toolOutput}
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingBubble({ content }) {
  const [displayed, setDisplayed] = React.useState('');
  React.useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(content.slice(0, i));
      if (i >= content.length) clearInterval(iv);
    }, 30);
    return () => clearInterval(iv);
  }, [content]);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: '#fff',
          marginTop: 2,
        }}
      >
        A
      </div>
      <div
        style={{
          maxWidth: '72%',
          padding: '12px 16px',
          borderRadius: '18px 18px 18px 4px',
          background: TWEAK_DEFAULTS.assistantBg,
          color: TWEAK_DEFAULTS.fg,
          fontSize: 14,
          lineHeight: 1.55,
          fontFamily: 'Helvetica Neue, sans-serif',
        }}
      >
        {displayed}
        {displayed.length < content.length && (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 14,
              background: TWEAK_DEFAULTS.accent,
              marginLeft: 2,
              verticalAlign: 'middle',
              animation: 'blink .7s step-start infinite',
            }}
          />
        )}
        <style>{'@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}'}</style>
      </div>
    </div>
  );
}

function ChatUI() {
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState(DEMO_MESSAGES);
  const bottomRef = React.useRef(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: demo file — effect intentionally re-runs on new messages to scroll into view
  React.useEffect(() => {
    if (bottomRef.current) bottomRef.current.parentNode.scrollTop = bottomRef.current.offsetTop;
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { id: Date.now(), role: 'user', content: input }]);
    setInput('');
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: 'streaming',
          content: 'Great question! Let me think through that for you…',
        },
      ]);
    }, 600);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        fontFamily: 'Helvetica Neue, sans-serif',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #f4f4f5',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: '#fff',
          }}
        >
          A
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b' }}>Assistant</div>
          <div
            style={{
              fontSize: 11,
              color: '#a1a1aa',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#22c55e',
                display: 'inline-block',
              }}
            />
            Online
          </div>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.map((msg) => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #f4f4f5',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            border: '1px solid #e4e4e7',
            borderRadius: 14,
            padding: '8px 14px',
            gap: 8,
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message…"
            rows={1}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: 14,
              color: '#18181b',
              lineHeight: 1.5,
              background: 'none',
            }}
          />
        </div>
        <button
          onClick={send}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: input.trim() ? TWEAK_DEFAULTS.accent : '#e4e4e7',
            border: 'none',
            cursor: input.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background .15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 7h12M7 1l6 6-6 6"
              stroke={input.trim() ? '#fff' : '#a1a1aa'}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  ChatBubble,
  ThinkingBubble,
  ThinkingDots,
  ToolCallCard,
  StreamingBubble,
  ChatUI,
});

function App() {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'stretch', background: '#e4e4e7' }}>
      <div style={{ width: 480, margin: '0 auto', boxShadow: '0 20px 60px rgba(0,0,0,.15)' }}>
        <ChatUI />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
