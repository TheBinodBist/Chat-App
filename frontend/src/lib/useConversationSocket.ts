import useWebSocket, { ReadyState } from "react-use-websocket";

export function useConversationSocket(conversationId:string) {
  const socketUrl = conversationId
    ? `ws://localhost:8000/ws/conversations/${conversationId}/`
    : null;

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(
    socketUrl,
    {
      shouldReconnect: () => true,
      reconnectAttempts: 5,
      reconnectInterval: 3000,
      share: true,
    },
  );

  return {
    sendJsonMessage,
    lastJsonMessage,
    readyState,
    isConnected: readyState === ReadyState.OPEN,
  };
}
