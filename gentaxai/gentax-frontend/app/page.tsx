"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  time: string;
  sources?: SourceItem[];
};

type SourceItem = {
  title?: string;
  url?: string;
  kind?: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

function escapeHtml(raw: string) {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
}

function renderMarkdown(raw: string) {
  const text = escapeHtml(raw).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const header = line.split("|").map((c) => c.trim()).filter(Boolean);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split("|").map((c) => c.trim()).filter(Boolean));
        i += 1;
      }
      out.push(
        `<div class="mdTableWrap"><table><thead><tr>${header.map((h) => `<th>${inlineMarkdown(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      out.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      out.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*[-=]{3,}\s*$/.test(line)) {
      out.push(`<hr class="mdDivider"/>`);
      i += 1;
      continue;
    }

    if (/^\s*####\s+/.test(line)) {
      out.push(`<h4>${inlineMarkdown(line.replace(/^\s*####\s+/, ""))}</h4>`);
      i += 1;
      continue;
    }
    if (/^\s*###\s+/.test(line)) {
      out.push(`<h3>${inlineMarkdown(line.replace(/^\s*###\s+/, ""))}</h3>`);
      i += 1;
      continue;
    }
    if (/^\s*##\s+/.test(line)) {
      out.push(`<h2>${inlineMarkdown(line.replace(/^\s*##\s+/, ""))}</h2>`);
      i += 1;
      continue;
    }
    if (/^\s*#\s+/.test(line)) {
      out.push(`<h1>${inlineMarkdown(line.replace(/^\s*#\s+/, ""))}</h1>`);
      i += 1;
      continue;
    }

    if (line.trim() === "") {
      out.push("<br/>");
      i += 1;
      continue;
    }

    out.push(`<p>${inlineMarkdown(line)}</p>`);
    i += 1;
  }

  return out.join("");
}

const STORAGE_KEY = "finpilot_sessions";

function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

export default function Home() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    show: boolean;
    type: "success" | "error";
    msg: string;
  }>({ show: false, type: "success", msg: "" });

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const sessionId = useMemo(() => "s_" + Date.now(), []);

  const quickPrompts = [
    "Compare old vs new tax regime for salaried person in table format",
    "How to calculate GST for a small business with example",
    "Best deductions under section 80C and 80D",
    "ITR filing due dates and late fee rules-2026",
    "Latest TDS rates with practical checklist",
    "Compare large cap Indian stocks for 3 year horizon in a table",
  ];

  // Load sessions from localStorage on mount
  useEffect(() => {
    setSessions(loadSessions());
    if (typeof window !== "undefined") {
      setSpeechSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ show: true, type, msg });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3200);
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      showToast("Speech recognition not supported", "error");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    setIsListening(true);

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      setMessage((finalTranscript + interim).trim());
    };

    recognition.onerror = () => {
      setIsListening(false);
      showToast("Voice capture failed", "error");
    };

    recognition.onend = () => {
      setIsListening(false);
      if (finalTranscript.trim()) {
        showToast("Voice captured successfully");
      }
    };

    recognition.start();
  }

  function saveCurrentSession(updatedMessages: ChatMessage[], sid: string | null) {
    setSessions((prev) => {
      const title =
        updatedMessages.find((m) => m.role === "user")?.content.slice(0, 50) || "New Chat";
      let updated: ChatSession[];
      const existing = prev.find((s) => s.id === sid);
      if (existing) {
        updated = prev.map((s) =>
          s.id === sid
            ? { ...s, messages: updatedMessages, title, updatedAt: new Date().toISOString() }
            : s
        );
      } else {
        const newSession: ChatSession = {
          id: sid || sessionId,
          title,
          messages: updatedMessages,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        updated = [newSession, ...prev];
      }
      saveSessions(updated);
      return updated;
    });
  }

  async function sendMessage(customText?: string) {
    const text = (customText ?? message).trim();
    if (!text || loading) return;

    const now = new Date().toISOString();
    const currentSessionId = activeSessionId || sessionId;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, time: now },
    ];

    setMessages(newMessages);
    setMessage("");
    setLoading(true);
    setIsTyping(true);

    if (!activeSessionId) setActiveSessionId(currentSessionId);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: currentSessionId }),
      });

      const raw = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(raw.slice(0, 120));
      }

      if (!res.ok) {
        throw new Error(data?.detail || data?.error || `Error ${res.status}`);
      }

      setTimeout(() => {
        setIsTyping(false);
        const finalMessages: ChatMessage[] = [
          ...newMessages,
          {
            role: "assistant",
            content: data.answer || "No response received.",
            time: new Date().toISOString(),
            sources: data.sources || [],
          },
        ];
        setMessages(finalMessages);
        saveCurrentSession(finalMessages, currentSessionId);
      }, 450);
    } catch (err: any) {
      setIsTyping(false);
      showToast(err.message || "Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setMessages([]);
    setActiveSessionId(null);
    showToast("New chat started");
  }

  function loadSession(session: ChatSession) {
    setMessages(session.messages);
    setActiveSessionId(session.id);
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      saveSessions(updated);
      return updated;
    });
    if (activeSessionId === id) {
      setMessages([]);
      setActiveSessionId(null);
    }
    setDeleteConfirm(null);
    showToast("Chat deleted");
  }

  function exportChat() {
    if (messages.length === 0) return showToast("No messages to export", "error");

    const title = "FinPilot AI — Chat Export";
    const dateLabel = new Date().toLocaleString();
    const sessionLabel = activeSessionId || sessionId;

    const rowsHtml = messages
      .map((m) => {
        const who = m.role === "user" ? "You" : "FinPilot AI";
        const time = new Date(m.time).toLocaleString();
        const content =
          m.role === "assistant" ? renderMarkdown(m.content) : `<pre>${escapeHtml(m.content)}</pre>`;
        return `
          <section class="msg ${m.role}">
            <div class="meta">
              <div class="who">${escapeHtml(who)}</div>
              <div class="time">${escapeHtml(time)}</div>
            </div>
            <div class="content">${content}</div>
          </section>
        `;
      })
      .join("");

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { margin: 18mm; }
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; }
            h1 { font-size: 18px; margin: 0 0 6px; }
            .sub { color: #475569; font-size: 12px; margin-bottom: 16px; }
            .msg { padding: 12px 12px; border: 1px solid #e2e8f0; border-radius: 10px; margin: 0 0 10px; }
            .msg.user { background: #f8fafc; }
            .msg.assistant { background: #ffffff; }
            .meta { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
            .who { font-weight: 700; font-size: 12px; }
            .time { color: #64748b; font-size: 12px; }
            .content { font-size: 13px; line-height: 1.65; }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; }
            code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
            h2 { font-size: 15px; margin: 10px 0 6px; }
            h3 { font-size: 13px; margin: 10px 0 6px; }
            h4 { font-size: 12px; margin: 10px 0 6px; }
            p { margin: 6px 0; }
            ul, ol { margin: 6px 0 6px 18px; padding: 0; }
            hr { border: none; height: 1px; background: #e2e8f0; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
            th { background: #f8fafc; }
            a { color: #1d4ed8; text-decoration: none; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(title)}</h1>
          <div class="sub">Session: ${escapeHtml(sessionLabel)} • Exported: ${escapeHtml(dateLabel)}</div>
          ${rowsHtml}
          <script>
            window.onload = () => {
              setTimeout(() => window.print(), 150);
            };
          </script>
        </body>
      </html>`;

    // Avoid popups: render into a hidden iframe and trigger print dialog.
    // User can then "Save as PDF" from the browser print UI.
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.setAttribute("aria-hidden", "true");

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        // cleanup after a short delay (let print dialog open)
        setTimeout(() => iframe.remove(), 1500);
      }
    };

    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      showToast("Could not export PDF in this browser", "error");
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    showToast("Export ready (choose Save as PDF)");
  }

  function clearAllHistory() {
    if (confirm("Delete all chat history?")) {
      localStorage.removeItem(STORAGE_KEY);
      setSessions([]);
      setMessages([]);
      setActiveSessionId(null);
      showToast("All history cleared");
    }
  }

  function groupSessionsByDate(sessions: ChatSession[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const groups: { label: string; items: ChatSession[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Last 7 Days", items: [] },
      { label: "Older", items: [] },
    ];

    for (const s of sessions) {
      const d = new Date(s.updatedAt);
      d.setHours(0, 0, 0, 0);
      if (d >= today) groups[0].items.push(s);
      else if (d >= yesterday) groups[1].items.push(s);
      else if (d >= weekAgo) groups[2].items.push(s);
      else groups[3].items.push(s);
    }

    return groups.filter((g) => g.items.length > 0);
  }

  const grouped = groupSessionsByDate(sessions);

  return (
    <>
      <div className="app">
        {/* Ambient color bleeds — Dumroo style */}
        <div className="ambientTopLeft" />
        <div className="ambientBottomRight" />

        {/* Sidebar */}
        <aside className={`sidebar ${sidebarOpen ? "sidebarOpen" : "sidebarClosed"}`}>
          <div className="sidebarHeader">
            <div className="brand">
              <div className="brandIcon">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="14" fill="url(#gradIcon)" opacity="0.9"/>
                  <path d="M16 8L20 14H12L16 8Z" fill="white" opacity="0.9"/>
                  <rect x="14" y="14" width="4" height="10" rx="1" fill="white" opacity="0.9"/>
                  <defs>
                    <linearGradient id="gradIcon" x1="4" y1="4" x2="28" y2="28">
                      <stop offset="0%" style={{stopColor: '#3b82f6'}} />
                      <stop offset="100%" style={{stopColor: '#1d4ed8'}} />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              {sidebarOpen && (
                <div>
                  <div className="brandName">FinPilot AI</div>
                  <div className="brandSub">Financial Intelligence</div>
                </div>
              )}
            </div>
            <button className="collapseBtn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                {sidebarOpen
                  ? <path d="M11 8L6 3l-1 1 4 4-4 4 1 1z"/>
                  : <path d="M5 8l5-5 1 1L7 8l4 4-1 1z"/>}
              </svg>
            </button>
          </div>

          {sidebarOpen && (
            <>
              <button className="newChatBtn" onClick={newChat}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                New Chat
              </button>

              <div className="historyList">
                {sessions.length === 0 ? (
                  <div className="emptyHistory">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                    </svg>
                    <p>No chats yet</p>
                    <span>Start a conversation to see history here</span>
                  </div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.label} className="historyGroup">
                      <div className="historyGroupLabel">{group.label}</div>
                      {group.items.map((session) => (
                        <div
                          key={session.id}
                          className={`historyItem ${activeSessionId === session.id ? "historyItemActive" : ""}`}
                          onClick={() => loadSession(session)}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{flexShrink: 0}}>
                            <path d="M14 10a2 2 0 01-2 2H4l-3 3V4a2 2 0 012-2h9a2 2 0 012 2v6z"/>
                          </svg>
                          <span className="historyTitle">{session.title}</span>
                          {deleteConfirm === session.id ? (
                            <div className="deleteConfirm" onClick={(e) => e.stopPropagation()}>
                              <button className="deleteYes" onClick={() => deleteSession(session.id)}>✓</button>
                              <button className="deleteNo" onClick={() => setDeleteConfirm(null)}>✕</button>
                            </div>
                          ) : (
                            <button
                              className="deleteBtn"
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(session.id); }}
                              title="Delete"
                            >
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M6 2h4a1 1 0 011 1H5a1 1 0 011-1zM2 4h12l-1 10H3L2 4zm3 2v6h1V6H5zm3 0v6h1V6H8zm3 0v6h1V6h-1z"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              {sessions.length > 0 && (
                <button className="clearHistoryBtn" onClick={clearAllHistory}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M6 2h4a1 1 0 011 1H5a1 1 0 011-1zM2 4h12l-1 10H3L2 4zm3 2v6h1V6H5zm3 0v6h1V6H8zm3 0v6h1V6h-1z"/>
                  </svg>
                  Clear all history
                </button>
              )}
            </>
          )}
        </aside>

        {/* Main Content */}
        <div className="mainWrapper">
          <header className="topbar">
            <div className="topbarLeft">
              {!sidebarOpen && (
                <div className="topBrand">
                  <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="14" fill="url(#gradIcon2)" opacity="0.9"/>
                    <path d="M16 8L20 14H12L16 8Z" fill="white" opacity="0.9"/>
                    <rect x="14" y="14" width="4" height="10" rx="1" fill="white" opacity="0.9"/>
                    <defs>
                      <linearGradient id="gradIcon2" x1="4" y1="4" x2="28" y2="28">
                        <stop offset="0%" style={{stopColor: '#3b82f6'}} />
                        <stop offset="100%" style={{stopColor: '#1d4ed8'}} />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className="brandName">FinPilot AI</span>
                </div>
              )}
              <div className="topbarDivider" />
              <div className="topbarSubtitle">Private Financial Intelligence Assistant</div>
            </div>

            <div className="topActions">
              <button className="btnGhost" onClick={exportChat}>
                <span className="btnEmoji">📥</span>
                Export
              </button>
              <button className="btnPrimary" onClick={newChat}>
                <span className="btnEmoji">✨</span>
                New Chat
              </button>
            </div>
          </header>

          <main className="main">
            <section className="chat">
              {messages.length === 0 ? (
                <div className="empty">
                  <div className="heroGlow"></div>
                  <div className="heroLogo">
                    <div className="heroLogoText">
                      <span className="logoFin">FIN</span><span className="logoPilot">PILOT</span>
                    </div>
                    <div className="heroSubLabel">AI</div>
                  </div>
                  <p className="heroDesc">
                    Ask finance related questions in plain language. Get expert-level answers
                    with structured tables, practical action points, and clear source references.
                  </p>

                  <div className="promptRow">
                    {quickPrompts.map((q) => (
                      <button key={q} className="prompt" onClick={() => sendMessage(q)}>
                        <div className="promptIcon">→</div>
                        <div className="promptText">{q}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((m, i) => (
                    <div key={i} className={`row ${m.role === "user" ? "rowUser" : "rowBot"}`}>
                      <div className={`bubble ${m.role === "user" ? "bubbleUser" : "bubbleBot"}`}>
                        <div
                          className="text"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                        />
                        {m.role === "assistant" &&
                          (m.sources?.filter((s) => s.kind !== "rag_pdf").length ?? 0) > 0 && (
                          <div className="sources">
                            <div className="sourceTitle">
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{marginRight: '6px'}}>
                                <path d="M8 1l2 5h5l-4 3 2 5-5-3-5 3 2-5-4-3h5z"/>
                              </svg>
                              Sources
                            </div>
                            <div className="sourceList">
                              {m.sources
                                ?.filter((source) => source.kind !== "rag_pdf")
                                .filter(
                                  (source, index, arr) =>
                                    arr.findIndex(
                                      (s) =>
                                        (s.url || "").trim().toLowerCase() ===
                                          (source.url || "").trim().toLowerCase() &&
                                        (s.title || "").trim().toLowerCase() ===
                                          (source.title || "").trim().toLowerCase()
                                    ) === index
                                )
                                .map((source, index) => (
                                <a
                                  key={`${source.title}-${index}`}
                                  className="sourcePill"
                                  href={source.url || "#"}
                                  target={source.url ? "_blank" : undefined}
                                  rel={source.url ? "noopener noreferrer" : undefined}
                                >
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12a5 5 0 110-10 5 5 0 010 10z"/>
                                  </svg>
                                  {source.title || "Reference"}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="time">
                          {new Date(m.time).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  ))}

                  {isTyping && (
                    <div className="row rowBot">
                      <div className="bubble bubbleBot">
                        <div className="typing">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </section>

            <section className="composer">
              <div className="composerInner">
                {speechSupported && (
                  <button
                    className={`voiceBtn ${isListening ? "voiceActive" : ""}`}
                    onClick={startVoiceInput}
                    disabled={loading || isListening}
                    title="Voice input"
                  >
                    <span className="voiceEmoji">🎤</span>
                  </button>
                )}
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Think through this problem..."
                  maxLength={1200}
                  className="input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <div className="charCount">{message.length}/1200</div>
                <button
                  className="sendBtn"
                  disabled={!message.trim() || loading}
                  onClick={() => sendMessage()}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1 8l14-6-6 14-2-6-6-2z"/>
                  </svg>
                </button>
              </div>
            </section>
          </main>
        </div>

        <div className={`toast ${toast.show ? "toastShow" : ""} ${toast.type === "error" ? "toastErr" : "toastOk"}`}>
          <div className="toastDot" />
          <span>{toast.msg}</span>
        </div>
      </div>

      <style jsx>{`
        :global(*, *::before, *::after) {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :global(html, body) {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #09090f;
        }

        .app {
          display: flex;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background: #09090f;
          position: relative;
        }

        /* Dumroo ambient bleeds rendered as fixed divs */
        .ambientTopLeft {
          position: fixed;
          top: -160px;
          left: -120px;
          width: 600px;
          height: 500px;
          background: radial-gradient(ellipse at center, rgba(200, 100, 15, 0.38) 0%, rgba(160, 70, 10, 0.18) 40%, transparent 70%);
          pointer-events: none;
          z-index: 0;
          filter: blur(60px);
        }

        .ambientBottomRight {
          position: fixed;
          bottom: -160px;
          right: -120px;
          width: 620px;
          height: 520px;
          background: radial-gradient(ellipse at center, rgba(15, 55, 160, 0.42) 0%, rgba(10, 40, 120, 0.20) 40%, transparent 70%);
          pointer-events: none;
          z-index: 0;
          filter: blur(70px);
        }

        /* ===== SIDEBAR ===== */
        .sidebar {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: rgba(6, 6, 12, 0.92);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          transition: width 0.3s ease;
          overflow: hidden;
          flex-shrink: 0;
          z-index: 10;
          position: relative;
        }

        .sidebarOpen {
          width: 280px;
        }

        .sidebarClosed {
          width: 60px;
        }

        .sidebarHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          flex-shrink: 0;
          min-height: 64px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          overflow: hidden;
          min-width: 0;
        }

        .brandIcon {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.5));
        }

        .brandName {
          font-size: 16px;
          font-weight: 800;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          white-space: nowrap;
          letter-spacing: -0.3px;
        }

        .brandSub {
          font-size: 10px;
          color: rgba(148, 163, 184, 0.7);
          white-space: nowrap;
          margin-top: 1px;
        }

        .collapseBtn {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(148, 163, 184, 0.8);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .collapseBtn:hover {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.3);
          color: #60a5fa;
        }

        .newChatBtn {
          margin: 12px 12px 8px;
          padding: 10px 14px;
          border-radius: 10px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border: 1px solid rgba(59, 130, 246, 0.5);
          color: white;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          flex-shrink: 0;
        }

        .newChatBtn:hover {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
          transform: translateY(-1px);
        }

        .historyList {
          flex: 1;
          overflow-y: auto;
          padding: 4px 8px;
        }

        .historyList::-webkit-scrollbar {
          width: 4px;
        }

        .historyList::-webkit-scrollbar-track {
          background: transparent;
        }

        .historyList::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.3);
          border-radius: 10px;
        }

        .emptyHistory {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 16px;
          text-align: center;
          gap: 8px;
          color: rgba(100, 116, 139, 0.8);
        }

        .emptyHistory p {
          font-size: 13px;
          font-weight: 600;
          color: rgba(148, 163, 184, 0.7);
          margin: 4px 0 0;
        }

        .emptyHistory span {
          font-size: 11px;
          color: rgba(100, 116, 139, 0.6);
          line-height: 1.5;
        }

        .historyGroup {
          margin-bottom: 8px;
        }

        .historyGroupLabel {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: rgba(100, 116, 139, 0.6);
          padding: 8px 6px 4px;
        }

        .historyItem {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
          color: rgba(148, 163, 184, 0.85);
          font-size: 13px;
          position: relative;
          min-width: 0;
          border: 1px solid transparent;
        }

        .historyItem:hover {
          background: rgba(59, 130, 246, 0.08);
          color: rgba(226, 232, 240, 0.95);
          border-color: rgba(59, 130, 246, 0.15);
        }

        .historyItemActive {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          border-color: rgba(59, 130, 246, 0.3);
        }

        .historyTitle {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12.5px;
        }

        .deleteBtn {
          opacity: 0;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: rgba(239, 68, 68, 0.7);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          flex-shrink: 0;
        }

        .historyItem:hover .deleteBtn {
          opacity: 1;
        }

        .deleteBtn:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: rgba(239, 68, 68, 0.4);
          color: #ef4444;
        }

        .deleteConfirm {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }

        .deleteYes, .deleteNo {
          width: 22px;
          height: 22px;
          border-radius: 5px;
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          transition: all 0.15s;
        }

        .deleteYes {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #ef4444;
        }

        .deleteYes:hover {
          background: rgba(239, 68, 68, 0.35);
        }

        .deleteNo {
          background: rgba(100, 116, 139, 0.1);
          border: 1px solid rgba(100, 116, 139, 0.2);
          color: rgba(148, 163, 184, 0.8);
        }

        .deleteNo:hover {
          background: rgba(100, 116, 139, 0.2);
        }

        .clearHistoryBtn {
          margin: 8px 12px 12px;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(239, 68, 68, 0.07);
          border: 1px solid rgba(239, 68, 68, 0.15);
          color: rgba(239, 68, 68, 0.6);
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .clearHistoryBtn:hover {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.3);
          color: rgba(239, 68, 68, 0.85);
        }

        /* ===== MAIN WRAPPER ===== */
        .mainWrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          height: 100vh;
          overflow: hidden;
        }

        /* ===== TOPBAR ===== */
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          height: 60px;
          flex-shrink: 0;
          background: rgba(9, 9, 15, 0.75);
          backdrop-filter: blur(28px) saturate(140%);
          -webkit-backdrop-filter: blur(28px) saturate(140%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03),
                      0 4px 20px rgba(0, 0, 0, 0.3);
          position: relative;
          z-index: 5;
        }

        .topbarLeft {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .topbarDivider {
          width: 1px;
          height: 20px;
          background: rgba(255, 255, 255, 0.1);
          flex-shrink: 0;
        }

        .topbarSubtitle {
          font-size: 12px;
          color: rgba(148, 163, 184, 0.55);
          letter-spacing: 0.3px;
          font-weight: 400;
          white-space: nowrap;
        }

        .topBrand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .topActions {
          display: flex;
          gap: 10px;
        }

        .btnGhost,
        .btnPrimary {
          padding: 9px 18px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s ease;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .btnEmoji {
          font-size: 14px;
        }

        .btnGhost {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: rgba(226, 232, 240, 0.9);
        }

        .btnGhost:hover {
          background: rgba(255, 255, 255, 0.10);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
        }

        .btnPrimary {
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border: 1px solid rgba(59, 130, 246, 0.4);
          color: white;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
        }

        .btnPrimary:hover {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.45);
          transform: translateY(-1px);
        }

        /* ===== MAIN CONTENT ===== */
        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 16px 24px 20px;
          gap: 16px;
        }

        .chat {
          flex: 1;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
          z-index: 1;
        }

        .empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 40px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .heroGlow {
          position: absolute;
          top: 40%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 600px;
          height: 400px;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
          filter: blur(60px);
          pointer-events: none;
        }

        .heroLogo {
          margin: 0 0 28px;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .heroLogoText {
          font-size: 68px;
          font-weight: 900;
          letter-spacing: 3px;
          line-height: 1.1;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 0 12px;
          white-space: nowrap;
          overflow: visible;
        }

        .logoFin {
          color: #f59e0b;
          text-shadow: 0 0 50px rgba(245, 158, 11, 0.5), 0 0 20px rgba(245, 158, 11, 0.3);
        }

        .logoPilot {
          color: rgba(248, 250, 252, 0.97);
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.12);
        }

        .heroSubLabel {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 5px;
          color: rgba(96, 165, 250, 0.6);
          text-transform: uppercase;
        }

        .heroDesc {
          margin: 0 auto 36px;
          max-width: 600px;
          color: rgba(148, 163, 184, 0.85);
          line-height: 1.7;
          font-size: 15px;
          position: relative;
        }

        .promptRow {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
          max-width: 960px;
          width: 100%;
          position: relative;
        }

        .prompt {
          padding: 16px 20px;
          border-radius: 12px;
          text-align: left;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.25s ease;
          font-size: 13px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.07);
          color: rgba(226, 232, 240, 0.85);
          display: flex;
          align-items: center;
          gap: 10px;
          backdrop-filter: blur(10px);
        }

        .promptIcon {
          font-size: 16px;
          color: #60a5fa;
          transition: transform 0.25s ease;
          flex-shrink: 0;
        }

        .promptText {
          flex: 1;
          line-height: 1.4;
        }

        .prompt:hover {
          transform: translateY(-2px);
          background: rgba(59, 130, 246, 0.08);
          border-color: rgba(59, 130, 246, 0.25);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
          color: rgba(226, 232, 240, 0.95);
        }

        .prompt:hover .promptIcon {
          transform: translateX(3px);
        }

        .messages {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }

        .messages::-webkit-scrollbar { width: 6px; }
        .messages::-webkit-scrollbar-track { background: rgba(30, 41, 59, 0.2); border-radius: 10px; }
        .messages::-webkit-scrollbar-thumb { background: rgba(59, 130, 246, 0.35); border-radius: 10px; }
        .messages::-webkit-scrollbar-thumb:hover { background: rgba(59, 130, 246, 0.55); }

        .row {
          display: flex;
          margin-bottom: 18px;
          animation: slideIn 0.35s ease;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .rowUser { justify-content: flex-end; }
        .rowBot { justify-content: flex-start; }

        .bubble {
          max-width: 78%;
          padding: 16px 22px;
          border-radius: 16px;
        }

        .bubbleUser {
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.3);
          border: 1px solid rgba(96, 165, 250, 0.25);
        }

        .bubbleBot {
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.07);
          color: rgba(226, 232, 240, 0.95);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
        }

        .text {
          word-wrap: break-word;
          font-size: 14.5px;
          line-height: 1.7;
        }

        .text :global(h1), .text :global(h2), .text :global(h3), .text :global(h4) {
          margin: 14px 0 8px;
          font-weight: 700;
          color: #60a5fa;
        }

        .bubbleUser .text :global(h1),
        .bubbleUser .text :global(h2),
        .bubbleUser .text :global(h3),
        .bubbleUser .text :global(h4) { color: white; }

        .text :global(p) { margin: 8px 0; }
        .text :global(ul), .text :global(ol) { margin: 8px 0 8px 24px; }

        .text :global(code) {
          padding: 2px 6px;
          border-radius: 5px;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12.5px;
        }

        .bubbleBot .text :global(code) {
          background: rgba(59, 130, 246, 0.12);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.18);
        }

        .bubbleUser .text :global(code) {
          background: rgba(255, 255, 255, 0.18);
          color: white;
        }

        .text :global(.mdTableWrap) {
          overflow-x: auto;
          border-radius: 12px;
          margin: 14px 0;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(0, 0, 0, 0.4);
        }

        .text :global(table) {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 13.5px;
        }

        .text :global(th), .text :global(td) {
          padding: 12px 16px;
          border: none;
          text-align: left;
          border-bottom: 1px solid rgba(59, 130, 246, 0.12);
        }

        .text :global(th) {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.22) 0%, rgba(29, 78, 216, 0.22) 100%);
          font-weight: 700;
          color: #60a5fa;
          text-transform: uppercase;
          font-size: 11.5px;
          letter-spacing: 0.7px;
          border-bottom: 2px solid rgba(59, 130, 246, 0.35);
        }

        .text :global(th:first-child) { border-top-left-radius: 12px; }
        .text :global(th:last-child) { border-top-right-radius: 12px; }
        .text :global(tbody tr) { background: rgba(15, 23, 42, 0.5); transition: all 0.15s; }
        .text :global(tbody tr:nth-child(even)) { background: rgba(30, 41, 59, 0.4); }
        .text :global(tbody tr:hover) { background: rgba(59, 130, 246, 0.1); }
        .text :global(tbody tr:last-child td:first-child) { border-bottom-left-radius: 12px; }
        .text :global(tbody tr:last-child td:last-child) { border-bottom-right-radius: 12px; }
        .text :global(tbody tr:last-child td) { border-bottom: none; }
        .text :global(td) { color: rgba(226, 232, 240, 0.95); }
        .text :global(a) { color: #60a5fa; text-decoration: underline; text-underline-offset: 2px; }

        .text :global(.mdDivider) {
          border: none;
          height: 1px;
          margin: 16px 0;
          background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.45), transparent);
        }

        .sources {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid rgba(59, 130, 246, 0.18);
        }

        .sourceTitle {
          font-size: 11px;
          font-weight: 700;
          color: #60a5fa;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .sourceList { display: flex; flex-wrap: wrap; gap: 8px; }

        .sourcePill {
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 11.5px;
          background: rgba(59, 130, 246, 0.12);
          color: #60a5fa;
          text-decoration: none;
          border: 1px solid rgba(59, 130, 246, 0.25);
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .sourcePill:hover {
          background: rgba(59, 130, 246, 0.22);
          border-color: rgba(59, 130, 246, 0.45);
          transform: translateY(-1px);
          box-shadow: 0 3px 10px rgba(59, 130, 246, 0.25);
        }

        .time {
          margin-top: 8px;
          font-size: 10.5px;
          opacity: 0.5;
          letter-spacing: 0.2px;
        }

        .typing {
          display: flex;
          gap: 5px;
          align-items: center;
          height: 18px;
        }

        .typing span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #60a5fa;
          animation: pulse 1.4s infinite ease-in-out;
          box-shadow: 0 0 6px rgba(96, 165, 250, 0.5);
        }

        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes pulse {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-5px); opacity: 1; }
        }

        /* ===== COMPOSER ===== */
        .composer {
          flex-shrink: 0;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(32px) saturate(160%);
          -webkit-backdrop-filter: blur(32px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5),
                      inset 0 1px 0 rgba(255, 255, 255, 0.07);
          padding: 8px;
          position: relative;
          z-index: 1;
        }

        .composerInner {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .voiceBtn {
          padding: 10px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #60a5fa;
          cursor: pointer;
          transition: all 0.25s;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }

        .voiceBtn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.10);
          border-color: rgba(255, 255, 255, 0.22);
          box-shadow: 0 3px 10px rgba(59, 130, 246, 0.25);
        }

        .voiceBtn:disabled { opacity: 0.35; cursor: not-allowed; }

        .voiceActive {
          background: rgba(251, 191, 36, 0.15);
          border-color: rgba(251, 191, 36, 0.35);
          animation: voicePulse 1.5s infinite;
        }

        @keyframes voicePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(251, 191, 36, 0); }
        }

        .input {
          flex: 1;
          min-height: 24px;
          max-height: 110px;
          resize: none;
          border: none;
          background: transparent;
          outline: none;
          font-size: 14.5px;
          line-height: 1.6;
          font-family: inherit;
          color: rgba(226, 232, 240, 0.95);
        }

        .input::placeholder { color: rgba(148, 163, 184, 0.55); }

        .charCount {
          font-size: 10.5px;
          color: rgba(148, 163, 184, 0.45);
          font-weight: 600;
          letter-spacing: 0.2px;
          flex-shrink: 0;
        }

        .sendBtn {
          padding: 10px 14px;
          border-radius: 10px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          border: 1px solid rgba(59, 130, 246, 0.45);
          color: white;
          cursor: pointer;
          transition: all 0.25s;
          box-shadow: 0 3px 12px rgba(59, 130, 246, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .sendBtn:hover:not(:disabled) {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          box-shadow: 0 5px 16px rgba(59, 130, 246, 0.45);
          transform: translateY(-1px);
        }

        .sendBtn:disabled { opacity: 0.28; cursor: not-allowed; }

        /* ===== TOAST ===== */
        .toast {
          position: fixed;
          left: 50%;
          bottom: -120px;
          transform: translateX(-50%);
          padding: 14px 22px;
          border-radius: 14px;
          display: flex;
          gap: 10px;
          align-items: center;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          opacity: 0;
          z-index: 200;
          min-width: 280px;
          background: rgba(15, 15, 20, 0.97);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 36px rgba(0, 0, 0, 0.7);
          color: rgba(226, 232, 240, 0.95);
          font-size: 13.5px;
        }

        .toastShow { bottom: 28px; opacity: 1; }

        .toastDot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);
          flex-shrink: 0;
        }

        .toastErr .toastDot {
          background: #ef4444;
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
        }

        /* ===== RESPONSIVE ===== */
        @media (max-width: 768px) {
          .sidebar {
            position: absolute;
            z-index: 50;
            height: 100vh;
            box-shadow: 4px 0 24px rgba(0,0,0,0.5);
          }

          .sidebarClosed { width: 0; }

          .main { padding: 12px 16px 16px; }

          .topbar { padding: 0 16px; }

          .bubble { max-width: 90%; }

          .promptRow { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}