import type { components } from "./schema";

type Models = components["schemas"];
export type Event = Models["Event"];
export type Overview = Models["Overview"];
export type EventStatus = Models["Status"];
export type Action = Models["Action"];
export type CreateEvent = Models["CreateEvent"];
export type Postcard = Models["Postcard"];
export type Associations = Models["AssociationView"];
export type Credentials = { adminToken?: string; queryToken?: string };

export const STATUS_LABELS: Record<EventStatus, string> = {
  needs_info: "待补充",
  pending_review: "待审核",
  processing: "处理中",
  pending_acceptance: "待验收",
  closed: "已结案",
  rejected: "已驳回",
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: Models["ErrorInfo"],
  ) {
    super(detail.message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  credentials: Credentials = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (credentials.adminToken)
    headers.set("Authorization", `Bearer ${credentials.adminToken}`);
  if (credentials.queryToken)
    headers.set("X-Visitor-Token", credentials.queryToken);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, {
      code: "network_error",
      message: "暂时连不上服务，请稍后重试。",
      retryable: true,
      details: [],
    });
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? {
        code: "network_error",
        message: "服务暂不可用，请稍后重试",
        retryable: true,
        details: [],
      },
    );
  }
  return data as T;
}

export const api = {
  createPostcard: (body: Models["CreatePostcard"]) =>
    request<Models["CreatedPostcard"]>("/postcards", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  postcard: (id: string, queryToken: string) =>
    request<Postcard>(
      `/postcards/${encodeURIComponent(id)}`,
      {},
      { queryToken },
    ),
  overview: () => request<Overview>("/overview"),
  login: (username: string, password: string) =>
    request<Models["Session"]>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: (credentials: Credentials) =>
    request<void>("/auth/logout", { method: "POST" }, credentials),
  upload: (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return request<Models["UploadResponse"]>("/uploads", {
      method: "POST",
      body,
    });
  },
  createEvent: (body: CreateEvent) =>
    request<Models["CreatedEvent"]>("/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  event: (id: string, credentials: Credentials) =>
    request<Event>(`/events/${encodeURIComponent(id)}`, {}, credentials),
  events: (
    credentials: Credentials,
    filters: {
      status?: EventStatus;
      point_id?: string;
      assignee?: string;
      is_demo?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) query.set(key, String(value));
    return request<Models["EventList"]>(`/events?${query}`, {}, credentials);
  },
  action: (id: string, action: Action, credentials: Credentials) =>
    request<Event>(
      `/events/${encodeURIComponent(id)}/actions`,
      { method: "POST", body: JSON.stringify(action) },
      credentials,
    ),
  analyze: (
    id: string,
    kind: "report" | "resolution",
    credentials: Credentials,
  ) =>
    request<Event>(
      `/events/${encodeURIComponent(id)}/analysis`,
      { method: "POST", body: JSON.stringify({ kind }) },
      credentials,
    ),
  proof: (id: string, credentials: Credentials) =>
    request<Models["ProofView"]>(
      `/events/${encodeURIComponent(id)}/proof`,
      { method: "POST" },
      credentials,
    ),
  associations: (id: string, credentials: Credentials) =>
    request<Associations>(`/events/${encodeURIComponent(id)}/associations`, {}, credentials),
  merge: (id: string, body: Models["MergeRequest"], credentials: Credentials) =>
    request<Event>(`/events/${encodeURIComponent(id)}/merge`, {
      method: "POST", body: JSON.stringify(body),
    }, credentials),
  unmerge: (id: string, body: Models["UnmergeRequest"], credentials: Credentials) =>
    request<Event>(`/events/${encodeURIComponent(id)}/unmerge`, {
      method: "POST", body: JSON.stringify(body),
    }, credentials),
};
