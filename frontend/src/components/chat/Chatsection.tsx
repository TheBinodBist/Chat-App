import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Video,
} from "lucide-react";

import { Button } from "#components/ui/button";
import { Input } from "#components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#components/ui/tooltip";

import { useChatStore } from "#lib/chatStore";
import { SIGNAL_BLUE } from "#lib/constants";
import {
  createConversation,
  createMessage,
  getMessages,
} from "#lib/messageApi";
import { cn } from "#lib/utils";

import ConversationAvatar from "./ConversationAvatar";
import type { ChatMessage, Conversation } from "./types";

/* WhatsApp-style palette. Change the colors here. */
const WA_GREEN = "bg-[#00A884] text-white hover:bg-[#008f72]";

const TINT = {
  green: "text-[#00A884] hover:bg-[#00A884]/10 hover:text-[#00A884]",
  blue: "text-[#53BDEB] hover:bg-[#53BDEB]/10 hover:text-[#53BDEB]",
  amber: "text-[#F5A623] hover:bg-[#F5A623]/10 hover:text-[#F5A623]",
};

const WS_BASE_URL = (
  import.meta.env.VITE_WS_URL as string | undefined
)?.replace(/\/+$/, "");

function isSentByMe(sender: unknown, meAliases: string[]): boolean {
  if (meAliases.length === 0) return false;

  const candidates: unknown[] =
    typeof sender === "object" && sender !== null
      ? [
          (sender as Record<string, unknown>).id,
          (sender as Record<string, unknown>).username,
          (sender as Record<string, unknown>).email,
        ]
      : [sender];

  return candidates.some(
    (value) =>
      (typeof value === "string" || typeof value === "number") &&
      meAliases.includes(String(value).toLowerCase()),
  );
}

/**
 * Adds a message to the list, or skips/replaces it if the id already exists.
 * The same message can arrive twice (REST response + WebSocket broadcast),
 * so ids are compared as strings to avoid number-vs-string mismatches.
 */
function mergeMessage(
  list: ChatMessage[],
  msg: ChatMessage,
  overwrite = false,
): ChatMessage[] {
  const index = list.findIndex((item) => String(item.id) === String(msg.id));

  if (index === -1) return [...list, msg];
  if (!overwrite) return list;

  const next = list.slice();
  next[index] = msg;
  return next;
}

type SocketStatus = "idle" | "connecting" | "open" | "closed";

const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Small native WebSocket hook with exponential-backoff reconnect.
 * Pass `null` to stay disconnected. Changing `url` closes the old socket
 * and opens a new one.
 */
function useChatSocket(
  url: string | null,
  onMessage: (event: MessageEvent) => void,
): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      setStatus("connecting");
      socket = new WebSocket(url);

      socket.onopen = () => {
        attempts = 0;
        setStatus("open");
      };

      socket.onmessage = (event) => onMessageRef.current(event);

      socket.onerror = () => {
        console.error("WebSocket connection error");
      };

      socket.onclose = () => {
        if (disposed) return;
        setStatus("closed");

        if (attempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** attempts, 15000);
          attempts += 1;
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);

      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [url]);

  return status;
}

/* Base UI tooltips use `render`, not Radix's `asChild`. */
function HeaderAction({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("rounded-full", className)}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type ResolvedConversation = {
  key: string;
  id: string;
};

type ConversationCreateResponse = {
  id?: string | number;
  conversation_id?: string | number;
  conversation?: {
    id?: string | number;
    conversation_id?: string | number;
  };
};

type SocketPayload = {
  type?: string;
  id?: string | number;
  conversation_id?: string | number;
  message?: string;
  created_at?: string;
  sender?: unknown;
  sender_id?: unknown;
};

export default function ChatSection() {
  const users = useChatStore((s) => s.users);
  const groups = useChatStore((s) => s.groups);
  const selectedKey = useChatStore((s) => s.selectedKey);
  const meAliases = useChatStore((s) => s.meAliases);

  const conversation = useMemo(
    () =>
      [...groups, ...users].find((item) => item.key === selectedKey) ?? null,
    [groups, users, selectedKey],
  );

  const [resolved, setResolved] = useState<ResolvedConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConversationRef = useRef<string | null>(null);

  // Always a string (or null) so it is safe to use as an effect dependency.
  const conversationId: string | null = (() => {
    const id =
      conversation?.conversationId ??
      (conversation?.kind === "group" ? conversation.apiId : null) ??
      (resolved?.key === selectedKey ? resolved.id : null);

    return id === null || id === undefined || String(id) === ""
      ? null
      : String(id);
  })();

  activeConversationRef.current = conversationId;

  /* ---------------------------- WebSocket ---------------------------- */

  // `null` means "don't connect". When conversationId changes, the old
  // socket is closed and a new one is opened automatically.
  // If your Django consumer needs auth, append it here, e.g. `?token=${token}`
  // (browsers cannot send an Authorization header on a WebSocket).
  const socketUrl =
    conversationId && WS_BASE_URL
      ? `${WS_BASE_URL}/ws/conversations/${conversationId}/`
      : null;

  const handleSocketMessage = (event: MessageEvent) => {
    let data: SocketPayload;

    try {
      data = JSON.parse(event.data) as SocketPayload;
    } catch {
      return;
    }

    if (data.type === "error") {
      setError(data.message ?? "Something went wrong.");
      return;
    }

    if (data.type !== "message") return;

    // Ignore anything that belongs to a conversation we are no longer viewing.
    if (
      data.conversation_id !== undefined &&
      String(data.conversation_id) !== activeConversationRef.current
    ) {
      return;
    }

    const incoming = {
      id: data.id,
      content: data.message,
      created_at: data.created_at ?? new Date().toISOString(),
      is_mine: isSentByMe(data.sender ?? data.sender_id, meAliases),
    } as ChatMessage;

    setMessages((previous) => mergeMessage(previous, incoming));
  };

  const socketStatus = useChatSocket(socketUrl, handleSocketMessage);

  /* ------------------------ Open / resolve chat ------------------------ */

  useEffect(() => {
    let active = true;

    setMessages([]);
    setMessage("");
    setError("");
    setResolved(null);

    if (!conversation) {
      setOpening(false);
      setLoading(false);
      return;
    }

    const selectedConversation: Conversation = conversation;

    if (
      selectedConversation.kind === "group" ||
      selectedConversation.conversationId
    ) {
      setOpening(false);
      return;
    }

    setOpening(true);

    async function openDirectConversation() {
      try {
        const data = (await createConversation(
          String(selectedConversation.apiId),
        )) as ConversationCreateResponse;

        const rawId =
          data.id ??
          data.conversation_id ??
          data.conversation?.id ??
          data.conversation?.conversation_id;

        if (
          rawId === undefined ||
          rawId === null ||
          String(rawId).length === 0
        ) {
          console.error("Unexpected conversation API response:", data);
          throw new Error("The API did not return a conversation UUID.");
        }

        if (active) {
          setResolved({
            key: selectedConversation.key,
            id: String(rawId),
          });
        }
      } catch (err) {
        console.error("Failed to open conversation:", err);

        if (active) {
          setError(
            "Could not open this chat. Check the conversation API and try again.",
          );
        }
      } finally {
        if (active) {
          setOpening(false);
        }
      }
    }

    void openDirectConversation();

    return () => {
      active = false;
    };
  }, [
    selectedKey,
    conversation?.key,
    conversation?.apiId,
    conversation?.kind,
    conversation?.conversationId,
  ]);

  // Declared after the reset effect above so this error is not wiped by it.
  useEffect(() => {
    if (conversationId && !WS_BASE_URL) {
      setError("WebSocket URL is not configured (VITE_WS_URL).");
    }
  }, [conversationId]);

  /* --------------------------- Load history --------------------------- */

  useEffect(() => {
    let active = true;

    setMessages([]);
    setLoading(false);

    if (!conversationId) return;

    const id = conversationId;

    async function fetchMessages() {
      setLoading(true);

      try {
        const history = await getMessages(id);

        if (active) {
          // Keep any live messages that arrived over the socket while the
          // history request was still in flight.
          setMessages((live) =>
            live.reduce((acc, item) => mergeMessage(acc, item), history),
          );
          setError("");
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);

        if (active) {
          setError("Failed to load messages.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void fetchMessages();

    return () => {
      active = false;
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, loading, opening]);

  /* ----------------------------- Sending ----------------------------- */

  const sendMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const content = message.trim();

    if (!content || sending) return;

    if (!conversationId) {
      setError(
        opening
          ? "Opening conversation. Please wait..."
          : "This chat has no conversation ID yet.",
      );
      return;
    }

    const targetConversationId = conversationId;

    setSending(true);
    setError("");

    try {
      const newMessage = await createMessage(targetConversationId, content);

      if (activeConversationRef.current === targetConversationId) {
        // overwrite: the REST response is the source of truth for `is_mine`
        // if the socket echo got here first.
        setMessages((prev) => mergeMessage(prev, newMessage, true));
        setMessage((current) => (current === content ? "" : current));
      }
    } catch (err) {
      console.error("Failed to send message:", err);

      if (activeConversationRef.current === targetConversationId) {
        setError("Failed to send message. Please try again.");
      }
    } finally {
      setSending(false);
    }
  };

  /* ------------------------------ Render ------------------------------ */

  if (!conversation) {
    return (
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full text-white shadow-sm",
              SIGNAL_BLUE,
            )}
          >
            <MessageCircle className="h-9 w-9" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Connectly</h2>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Select a conversation to start messaging your friends and groups.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Fixed conversation header */}
      <header className="z-10 flex h-[72px] shrink-0 items-center gap-3 border-b bg-card px-3 sm:px-5">
        <ConversationAvatar Conversation={conversation} className="h-10 w-10" />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold sm:text-base">
            {conversation.name}
          </h2>

          {conversation.subtitle && (
            <p className="truncate text-xs text-muted-foreground">
              {conversation.subtitle}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <HeaderAction label="Video call" className={TINT.green}>
            <Video className="h-5 w-5" />
          </HeaderAction>

          <HeaderAction label="Voice call" className={TINT.green}>
            <Phone className="h-5 w-5" />
          </HeaderAction>

          <HeaderAction label="Search messages" className={TINT.blue}>
            <Search className="h-5 w-5" />
          </HeaderAction>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="More options"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {conversationId && socketStatus === "closed" && (
        <div
          role="status"
          className="shrink-0 bg-amber-100 px-4 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Reconnecting…
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#EFEAE2] dark:bg-[#0B141A]">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-3 py-5 sm:px-6 sm:py-6">
          {opening ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Opening conversation...
              </p>
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Loading messages...
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
              <ConversationAvatar
                Conversation={conversation}
                className="h-20 w-20"
                textClassName="text-2xl"
                iconClassName="h-9 w-9"
              />

              <h3 className="text-lg font-semibold">{conversation.name}</h3>

              <p className="max-w-xs text-sm text-muted-foreground">
                {conversationId
                  ? "No messages yet. Say hello 👋"
                  : "Open a conversation to start messaging."}
              </p>
            </div>
          ) : (
            <div className="mt-auto flex w-full flex-col gap-2">
              {messages.map((msg) => {
                const isMine = msg.is_mine === true;

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex w-full",
                      isMine ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] break-words rounded-2xl px-4 py-2.5 shadow-sm sm:max-w-[75%]",
                        isMine
                          ? "rounded-br-md bg-[#D9FDD3] text-[#111B21] dark:bg-[#005C4B] dark:text-[#E9EDEF]"
                          : "rounded-bl-md bg-white text-[#111B21] dark:bg-[#202C33] dark:text-[#E9EDEF]",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">
                        {msg.content}
                      </p>

                      <p className="mt-1 text-right text-[10px] text-[#667781] dark:text-[#8696A0]">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-center text-sm text-red-500">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={sendMessage}
        className="z-10 shrink-0 border-t bg-card px-3 py-3 sm:px-5 sm:py-4"
      >
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10 shrink-0 rounded-full sm:h-11 sm:w-11",
              TINT.blue,
            )}
            aria-label="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </Button>

          <div className="relative min-w-0 flex-1">
            <Input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                opening ? "Opening conversation..." : "Send a message"
              }
              disabled={opening || !conversationId || sending}
              className="h-11 rounded-full border-0 bg-muted pl-4 pr-12 shadow-none focus-visible:ring-1"
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full",
                TINT.amber,
              )}
              aria-label="Emoji"
            >
              <Smile className="h-5 w-5" />
            </Button>
          </div>

          {message.trim() ? (
            <Button
              type="submit"
              size="icon"
              disabled={sending || opening || !conversationId}
              className={cn("h-11 w-11 shrink-0 rounded-full", WA_GREEN)}
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className={cn("h-11 w-11 shrink-0 rounded-full", WA_GREEN)}
              aria-label="Voice message"
            >
              <Mic className="h-5 w-5" />
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
