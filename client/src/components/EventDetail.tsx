import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { SEVERITY_COLOR, SEVERITY_LABEL, getIconClass, type GeoEvent } from "../data/events";

interface Props {
  event: GeoEvent;
  onClose: () => void;
}

interface Message {
  role: "user" | "ai";
  content: string;
}

function formatAbsolute(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildEventContext(event: GeoEvent): string {
  const reportedAbs = formatAbsolute(event.updatedAt);
  const lines: string[] = [
    `Title: ${event.title}`,
    `Description: ${event.description}`,
    `Background: ${event.background}`,
    `Location: ${event.placeName ?? `${event.country} (${event.region})`}`,
    `Country: ${event.country}`,
    `Region: ${event.region}`,
    `Coordinates (lat, lng): ${event.lat.toFixed(4)}, ${event.lng.toFixed(4)}`,
    `Event type: ${event.type}`,
    `Category: ${event.category}`,
    `Severity: ${event.severity}`,
    `Primary source: ${event.source}`,
    `Primary source URL: ${event.sourceUrl}`,
    `Reported timestamp: ${event.updatedAt}${reportedAbs ? ` (${reportedAbs})` : ""}`,
    `Relative age: ${event.timestamp}`,
  ];
  if (event.mediaUrl) lines.push(`Media: ${event.mediaUrl}`);
  if (event.relatedArticles?.length) {
    lines.push(
      "",
      `Related articles (${event.relatedArticles.length}):`,
      ...event.relatedArticles.slice(0, 10).map((a, i) => {
        const meta = [a.domain, a.date].filter(Boolean).join(" · ");
        return `  [${i + 1}] ${a.title}${meta ? ` — ${meta}` : ""}\n      ${a.url}`;
      }),
    );
  }
  return lines.join("\n");
}

export function EventDetail({ event, onClose }: Props) {
  const [summary, setSummary] = useState("");
  const [summaryState, setSummaryState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [summaryError, setSummaryError] = useState<{ reason?: string; hint?: string } | null>(
    null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);

  const color = SEVERITY_COLOR[event.severity];
  const iconClass = getIconClass(event.type);
  const absolute = formatAbsolute(event.updatedAt);

  // Reset + kick off the auto-generated AI summary whenever the user picks a new event.
  useEffect(() => {
    setMessages([]);
    setInput("");
    setSummary("");
    setSummaryError(null);
    setSummaryState("loading");

    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;

    const prompt =
      `Provide a concise intelligence analyst briefing on this event.\n\n` +
      `1) One-sentence situation summary.\n` +
      `2) Who / what is involved and where.\n` +
      `3) Why this matters to the broader conflict or regional security picture — connect it to the ` +
      `larger strategic context (campaign objectives, adversary intent, escalation pathways, ` +
      `humanitarian/economic knock-on effects).\n` +
      `4) One short "watch for" line flagging the next indicator to monitor.\n\n` +
      `Write in 4 short paragraphs. Avoid speculation; say "unclear" when sources don't support a claim.`;

    (async () => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode: "summary",
            eventContext: buildEventContext(event),
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) {
          // Try to parse structured error { reason, hint } from /api/chat
          const info = await res.json().catch(() => null as unknown);
          const reason =
            info && typeof info === "object" && "reason" in info && typeof (info as { reason?: unknown }).reason === "string"
              ? (info as { reason: string }).reason
              : `Server responded ${res.status}`;
          const hint =
            info && typeof info === "object" && "hint" in info && typeof (info as { hint?: unknown }).hint === "string"
              ? (info as { hint: string }).hint
              : undefined;
          setSummaryError({ reason, hint });
          setSummaryState("error");
          return;
        }
        if (!res.body) throw new Error("no body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setSummary(text);
        }
        setSummaryState(text.trim() ? "ready" : "error");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setSummaryState("error");
      }
    })();

    return () => controller.abort();
  }, [event.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: input };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setStreaming(true);
    const aiMsg: Message = { role: "ai", content: "" };
    setMessages((p) => [...p, aiMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "chat",
          eventContext: buildEventContext(event),
          messages: [...messages, userMsg].map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.content,
          })),
        }),
      });
      if (!res.ok || !res.body) {
        // Try to surface the structured Gemini error so the user sees the real reason.
        const info = await res.json().catch(() => null as unknown);
        const reason =
          info && typeof info === "object" && "reason" in info && typeof (info as { reason?: unknown }).reason === "string"
            ? (info as { reason: string }).reason
            : `Request failed (${res.status})`;
        throw new Error(reason);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === "ai") last.content += chunk;
          return [...updated];
        });
      }
    } catch (err) {
      const reason =
        err instanceof Error && err.message
          ? err.message
          : "Gemini request failed. Check the server logs or your GEMINI_API_KEY in .env.";
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "ai") {
          last.content = `⚠️ ${reason}`;
        }
        return [...updated];
      });
    }
    setStreaming(false);
  };

  return (
    <div
      className="absolute top-12 left-0 bottom-0 w-[400px] z-25 flex flex-col fade-in"
      style={{ background: "rgba(13,17,23,0.99)", borderRight: "1px solid #30363d" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#21262d]">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconClass}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="4" fill="white" opacity="0.9" />
              </svg>
            </div>
            <div>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{
                  color,
                  background: `${color}18`,
                  border: `1px solid ${color}35`,
                }}
              >
                {SEVERITY_LABEL[event.severity]}
              </span>
              <span className="text-[10px] text-[#6e7681] ml-2">{event.type}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#6e7681] hover:text-[#e6edf3] transition-colors shrink-0 mt-0.5"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <h2 className="text-sm font-semibold text-[#e6edf3] leading-tight mb-1.5">
          {event.title}
        </h2>

        <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
          <span className="text-[11px] text-[#8b949e]">
            {event.placeName ?? event.country}
          </span>
          <span className="text-[11px] text-[#6e7681]">·</span>
          <span
            className="text-[11px] text-[#8b949e]"
            title={absolute ?? event.timestamp}
          >
            {event.timestamp}
            {absolute ? ` · ${absolute}` : ""}
          </span>
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#1f6feb] hover:text-[#388bfd] flex items-center gap-0.5"
          >
            {event.source}
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path
                d="M2 7L7 2M7 2H4M7 2V5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </a>
          {event.mediaUrl && (
            <a
              href={event.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[#d29922] hover:text-[#f0883e] flex items-center gap-0.5"
            >
              &#9654; Media
            </a>
          )}
        </div>
      </div>

      {/* Scrollable body: details → AI summary → related articles → chat log */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <Section title="Current Situation">
            <p className="text-[12px] text-[#c9d1d9] leading-relaxed">{event.description}</p>
          </Section>

          {event.background && (
            <Section title="Background">
              <p className="text-[12px] text-[#c9d1d9] leading-relaxed">{event.background}</p>
            </Section>
          )}

          <Section title="Details">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Region", event.region],
                ["Country", event.country],
                ["Category", event.category],
                ["Severity", event.severity],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#161b22] rounded p-2.5">
                  <p className="text-[10px] text-[#6e7681] mb-0.5">{k}</p>
                  <p className="text-[12px] text-[#e6edf3] font-medium capitalize">{v}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Auto-generated AI summary — "Why this matters" */}
          <Section
            title="AI Analyst Summary"
            accent={summaryState === "loading"}
          >
            <AiSummary summary={summary} state={summaryState} errorInfo={summaryError} />
          </Section>

          {/* Related article list (GDELT GEO clusters, etc.) */}
          {event.relatedArticles && event.relatedArticles.length > 0 && (
            <Section title={`Source Articles (${event.relatedArticles.length})`}>
              <ul className="space-y-1.5">
                {event.relatedArticles.map((a) => (
                  <li
                    key={a.url}
                    className="bg-[#161b22] rounded p-2.5 border border-[#21262d]"
                  >
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-[#c9d1d9] hover:text-[#e6edf3] leading-snug block"
                    >
                      {a.title}
                    </a>
                    <div className="flex items-center gap-2 mt-1">
                      {a.domain && (
                        <span className="text-[10px] text-[#6e7681]">{a.domain}</span>
                      )}
                      {a.date && (
                        <span className="text-[10px] text-[#6e7681]">{a.date}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Chat with AI Analyst">
            {messages.length === 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-[#8b949e] mb-2">
                  Ask a follow-up question about this event.
                </p>
                {[
                  "Who are the primary actors and their likely objectives?",
                  "How does this fit into the broader conflict trajectory?",
                  "What are the second-order effects for neighboring states?",
                  "What indicators would suggest escalation?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="w-full text-left text-[11px] text-[#388bfd] hover:text-[#58a6ff] hover:bg-[#1c2333] rounded px-3 py-1.5 transition-colors border border-[#21262d] hover:border-[#1f6feb]/50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[92%] rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                        msg.role === "user"
                          ? "bg-[#1f6feb] text-white whitespace-pre-wrap"
                          : "bg-[#161b22] text-[#c9d1d9] border border-[#21262d]"
                      }`}
                    >
                      {msg.content ? (
                        msg.role === "user" ? (
                          msg.content
                        ) : (
                          <MarkdownBlock text={msg.content} />
                        )
                      ) : (
                        <span className="text-[#6e7681] animate-pulse">Thinking...</span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* Pinned chat input */}
      <div className="p-3 border-t border-[#21262d] bg-[#0d1117]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask the analyst about this event..."
            className="flex-1 h-8 px-3 text-xs bg-[#161b22] text-[#e6edf3] border border-[#30363d] rounded placeholder-[#6e7681] focus:outline-none focus:border-[#1f6feb]"
            data-testid="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={streaming || !input.trim()}
            className="w-8 h-8 rounded flex items-center justify-center bg-[#1f6feb] text-white hover:bg-[#388bfd] disabled:opacity-40 transition-colors"
            data-testid="chat-send"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1 12L12 6.5L1 1V5.5L8.5 6.5L1 7.5V12Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div>
      <h3
        className={`text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${
          accent ? "text-[#388bfd]" : "text-[#8b949e]"
        }`}
      >
        {title}
        {accent && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#388bfd] animate-pulse" />
        )}
      </h3>
      {children}
    </div>
  );
}

function AiSummary({
  summary,
  state,
  errorInfo,
}: {
  summary: string;
  state: "idle" | "loading" | "ready" | "error";
  errorInfo?: { reason?: string; hint?: string } | null;
}) {
  if (state === "error") {
    const reason = errorInfo?.reason?.trim();
    const hint = errorInfo?.hint?.trim();
    return (
      <div className="bg-[#161b22] rounded p-3 border border-[#f85149]/40 text-[11px] leading-relaxed space-y-1">
        <p className="text-[#f85149] font-medium">AI summary unavailable</p>
        <p className="text-[#c9d1d9]">
          {reason ??
            "The server couldn't reach OpenAI. Check the server logs for details."}
        </p>
        {hint && <p className="text-[#8b949e]">{hint}</p>}
      </div>
    );
  }
  if (state === "loading" && !summary) {
    return (
      <div className="bg-[#161b22] rounded p-3 border border-[#21262d] space-y-2">
        <div className="h-2 bg-[#21262d] rounded animate-pulse w-5/6" />
        <div className="h-2 bg-[#21262d] rounded animate-pulse w-4/6" />
        <div className="h-2 bg-[#21262d] rounded animate-pulse w-3/6" />
      </div>
    );
  }
  return (
    <div className="bg-gradient-to-br from-[#0f1a2b] to-[#161b22] rounded p-3 border border-[#1f6feb]/30 text-[12px] text-[#c9d1d9] leading-relaxed">
      <MarkdownBlock text={summary} />
      {state === "loading" && (
        <span className="inline-block w-2 h-3 ml-0.5 align-middle bg-[#388bfd] animate-pulse" />
      )}
    </div>
  );
}

/**
 * Minimal dark-themed markdown renderer. We keep a narrow tag set and force
 * the element classes so Gemini's output (headers, lists, bold) renders
 * legibly inside the dark event panel.
 */
function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          h1: (props) => (
            <h1 className="text-[13px] font-semibold text-[#e6edf3] mt-2 mb-1" {...props} />
          ),
          h2: (props) => (
            <h2 className="text-[13px] font-semibold text-[#e6edf3] mt-2 mb-1" {...props} />
          ),
          h3: (props) => (
            <h3 className="text-[12px] font-semibold text-[#e6edf3] mt-2 mb-1" {...props} />
          ),
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          ul: (props) => <ul className="list-disc pl-4 mb-2 space-y-0.5" {...props} />,
          ol: (props) => <ol className="list-decimal pl-4 mb-2 space-y-0.5" {...props} />,
          li: (props) => <li className="leading-snug" {...props} />,
          strong: (props) => (
            <strong className="text-[#e6edf3] font-semibold" {...props} />
          ),
          em: (props) => <em className="text-[#c9d1d9]" {...props} />,
          code: (props) => (
            <code
              className="bg-[#21262d] text-[#e6edf3] rounded px-1 py-0.5 text-[11px]"
              {...props}
            />
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:text-[#79c0ff] underline"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-2 border-[#21262d]" />,
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-[#1f6feb] pl-2 my-2 text-[#8b949e]"
              {...props}
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
