import { create } from "zustand";

import { getConversations } from "#lib/messageApi";
import { getUsers } from "#lib/userApi";
import type { ApiGroup, ApiUser, Conversation } from "../components/chat/types";

/* ---------- Helpers ---------- */

const AVATAR_COLORS = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-fuchsia-500",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-slate-500";
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  if (parts.length === 0) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? "";
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

function userDisplayName(user: ApiUser): string {
  const full = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return full || user.username || user.email || `User ${user.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (isRecord(value)) {
    const id = value.id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }

  return null;
}

function memberUserId(member: unknown): string | null {
  if (!isRecord(member)) return toId(member);
  if ("user" in member) return toId(member.user);
  if ("user_id" in member) return toId(member.user_id);
  return toId(member.id);
}

/* ---------- Store ---------- */

type ChatState = {
  currentUserId: string | null;
  meAliases: string[];
  users: Conversation[];
  groups: Conversation[];
  selectedKey: string | null;
  loading: boolean;
  loaded: boolean;
  error: string;
  search: string;

  fetchConversations: (currentUserId?: string) => Promise<void>;
  setSearch: (search: string) => void;
  selectConversation: (key: string | null) => void;
  setConversationId: (key: string, conversationId: string) => void;
  reset: () => void;
};

const initialState = {
  currentUserId: null,
  meAliases: [] as string[],
  users: [] as Conversation[],
  groups: [] as Conversation[],
  selectedKey: null,
  loading: false,
  loaded: false,
  error: "",
  search: "",
};

export const useChatStore = create<ChatState>()((set, get) => ({
  ...initialState,

  fetchConversations: async (currentUserId) => {
    if (get().loading) return;

    const resolvedId = currentUserId ?? get().currentUserId;

    if (!resolvedId) {
      set({ loaded: true, error: "Missing current user id." });
      return;
    }

    const me = String(resolvedId);
    set({ loading: true, error: "", currentUserId: me });

    try {
      const [apiUsers, apiConversations]: [ApiUser[], ApiGroup[]] =
        await Promise.all([getUsers(), getConversations()]);

      const directByUser = new Map<string, string>();
      const groups: Conversation[] = [];

      for (const c of apiConversations) {
        if (c.Conversation_type === "group") {
          const name =
            c.display_name?.trim() || c.name?.trim() || "Unnamed group";
          const count = c.members_count ?? c.members?.length ?? 0;
          const id = String(c.id);

          groups.push({
            key: `group:${id}`,
            kind: "group",
            apiId: id,
            conversationId: id,
            name,
            subtitle: `${count} ${count === 1 ? "member" : "members"}`,
            initials: initialsFor(name),
            color: colorFor(`group:${id}`),
          });
          continue;
        }

        const otherId = (c.members ?? [])
          .map(memberUserId)
          .find((id) => id !== null && id !== me);

        if (otherId) directByUser.set(otherId, String(c.id));
      }

      const users = apiUsers
        .filter((u) => String(u.id) !== me)
        .map((u): Conversation => {
          const id = String(u.id);
          const name = userDisplayName(u);

          return {
            key: `user:${id}`,
            kind: "user",
            apiId: id,
            conversationId: directByUser.get(id),
            name,
            initials: initialsFor(name),
            color: colorFor(`user:${id}`),
          };
        });

      const meUser = apiUsers.find((u) => String(u.id) === me);
      const meAliases = [me, meUser?.username, meUser?.email]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase());

      set({ users, groups, meAliases });
    } catch (err) {
      console.error("Failed to load sidebar:", err);
      set({ error: "Failed to load conversations." });
    } finally {
      set({ loading: false, loaded: true });
    }
  },

  setSearch: (search) => set({ search }),

  selectConversation: (key) => set({ selectedKey: key }),

  setConversationId: (key, conversationId) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.key === key ? { ...u, conversationId } : u,
      ),
    })),

  reset: () => set({ ...initialState }),
}));
