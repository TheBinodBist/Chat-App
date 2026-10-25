import type { ApiGroup, ChatMessage } from "../components/chat/types";
import api from "#lib/axiosInstance";


const CONVERSATION_ENDPOINT = "/conversations";
const MESSAGE_ENDPOINT = "/messages";

export async function createConversation(userId: string) {
  const response = await api.post(`${CONVERSATION_ENDPOINT}/create/`, {
    Conversation_type: "direct",
    member_ids: [userId],
  });

  return response.data;
}

export async function getMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const response = await api.get(
    `${MESSAGE_ENDPOINT}/${conversationId}/messages/`,
  );

  const data = response.data;

  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;

  return [];
}

export async function createMessage(
  conversationId: string,
  content: string,
): Promise<ChatMessage> {
  const response = await api.post(
    `${MESSAGE_ENDPOINT}/${conversationId}/messages/`,
    { content },
  );

  return response.data;
  
}


export async function getConversations(): Promise<ApiGroup[]> {
  const response = await api.get(`${CONVERSATION_ENDPOINT}/`);
  const data = response.data;
  return Array.isArray(data) ? data : (data.results ?? []);
}