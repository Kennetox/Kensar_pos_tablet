export type ApiClientConfig = {
  getBaseUrl: () => string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
};

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const base = config.getBaseUrl().replace(/\/$/, '');
    const url = `${base}${path}`;
    const token = config.getToken();
    const headers = new Headers(init?.headers ?? {});

    if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const res = await fetch(url, {
      ...init,
      headers,
    });

    if (!res.ok) {
      let detail: string | undefined;
      try {
        const payload = await res.json();
        detail = typeof payload?.detail === 'string' ? payload.detail : undefined;
      } catch {
        detail = undefined;
      }

      if ((res.status === 401 || res.status === 403) && token) {
        config.onUnauthorized?.();
      }

      throw new ApiError(detail ?? `Error ${res.status}`, res.status, detail);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: 'POST',
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      }),
  };
}
