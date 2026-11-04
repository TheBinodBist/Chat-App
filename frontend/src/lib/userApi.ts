import api from "#lib/axiosInstance";
import type { ApiUser } from "../components/chat/types";

const USER_ENDPOINT = "/users"; 

export async function getCurrentUser(): Promise<ApiUser> {
  const response = await api.get("/me/");
  return response.data;
}

export async function getUsers(): Promise<ApiUser[]> {
  const response = await api.get(`${USER_ENDPOINT}/`);
  const data = response.data;

  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;

  return [];
}
