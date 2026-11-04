import { useEffect, useRef, useState } from "react";

interface UseConversationSocketOptions {
  conversationId: string;
  accessToken: string | null;
}

export function useConversationSocket({
  conversationId,
  accessToken,
}: UseConversationSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!accessToken || !conversationId) {
      setConnected(false);
      return;
    }

    const baseUrl = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8000";

    const url = new URL(`${baseUrl}/ws/conversations/${conversationId}/`);

    url.searchParams.set("token", accessToken);

    const socket = new WebSocket(url.toString());
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      console.log("WebSocket connected");
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message: unknown = JSON.parse(event.data);
        console.log("WebSocket message:", message);
      } catch {
        console.error("Received invalid JSON from WebSocket");
      }
    };

    socket.onerror = () => {
      console.error("WebSocket connection error");
    };

    socket.onclose = (event) => {
      setConnected(false);
      console.log("WebSocket closed:", event.code, event.reason);
    };

    return () => {
      socket.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [conversationId, accessToken]);

  function sendMessage(payload: unknown) {
    const socket = socketRef.current;

    if (socket?.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected");
      return;
    }

    socket.send(JSON.stringify(payload));
  }

  return { connected, sendMessage };
}
