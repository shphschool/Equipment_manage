// ============ 客户端 API 封装 ============

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 会话过期或未登录：跳转登录页
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError((data as { error?: string }).error ?? `请求失败 (${res.status})`, res.status);
  }
  return data as T;
}

/** multipart/form-data（文件上传），浏览器自动生成 boundary */
async function reqForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", cache: "no-store", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new ApiError((data as { error?: string }).error ?? `请求失败 (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => req<T>(url),
  post: <T>(url: string, body: unknown) =>
    req<T>(url, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    req<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(url: string) => req<T>(url, { method: "DELETE" }),
  postForm: <T>(url: string, form: FormData) => reqForm<T>(url, form),
};
