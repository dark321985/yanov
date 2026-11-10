import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "../shared/contracts";

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string>;
  constructor(status: number, value: Partial<ApiError>) {
    super(value.message || "Не удалось выполнить запрос. Повторите попытку.");
    this.name = "ApiFailure";
    this.status = status;
    this.code = value.code || "REQUEST_FAILED";
    this.fields = value.fields ?? {};
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined
          ? {
              "Content-Type": "application/json",
              "X-Requested-With": "warehouse-admin",
            }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiFailure(0, {
      code: "NETWORK_ERROR",
      message:
        "Нет соединения с сервером. Проверьте подключение и повторите попытку.",
    });
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login")
      window.dispatchEvent(new Event("skladno:session-expired"));
    const error =
      typeof value === "object" && value !== null
        ? (value as Partial<ApiError>)
        : {};
    throw new ApiFailure(response.status, {
      code: typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      message:
        typeof error.message === "string"
          ? error.message
          : "Сервер не смог выполнить запрос. Повторите попытку.",
      fields:
        typeof error.fields === "object" && error.fields !== null
          ? error.fields
          : {},
    });
  }
  if (value === null)
    throw new ApiFailure(502, {
      code: "INVALID_RESPONSE",
      message: "Получен неожиданный ответ сервера. Обновите страницу.",
    });
  return value as T;
}

export function query(
  path: string,
  values: Record<string, string | number | boolean | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== undefined && value !== null)
      params.set(key, String(value));
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function useResource<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    let timeout = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      timeout = true;
      controller.abort();
    }, 20_000);
    void api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (timeout)
          setError(
            new Error("Сервер отвечает слишком долго. Попробуйте ещё раз."),
          );
        else if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure
              : new Error("Не удалось загрузить данные."),
          );
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [path, revision, refreshKey]);
  return { data, loading, error, reload };
}

export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inFlight = useRef(false);
  const clearError = useCallback(() => setError(null), []);
  const run = useCallback(
    async <T>(action: () => Promise<T>, success?: (value: T) => void) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const value = await action();
        success?.(value);
        return value;
      } catch (failure: unknown) {
        setError(
          failure instanceof Error
            ? failure
            : new Error("Не удалось сохранить изменения."),
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, run, clearError };
}
