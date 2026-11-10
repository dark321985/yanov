import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api } from "./api";

interface OwnerContext {
  today: string;
  timezone: string;
  businessName: string;
  environment: "development" | "production" | "test";
}
interface WorkspaceContext extends OwnerContext {
  revision: number;
  invalidate: () => void;
  notify: (message: string) => void;
  refreshContext: () => Promise<void>;
  logout: () => Promise<void>;
}
const Workspace = createContext<WorkspaceContext | null>(null);
export function useWorkspace() {
  const value = useContext(Workspace);
  if (!value) throw new Error("Workspace is missing.");
  return value;
}
export function WorkspaceProvider({
  children,
  initial,
  onLogout,
}: {
  children: ReactNode;
  initial: OwnerContext;
  onLogout: () => void;
}) {
  const [context, setContext] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const invalidate = useCallback(() => setRevision((value) => value + 1), []);
  const notify = useCallback((message: string) => setToast(message), []);
  const refreshContext = useCallback(async () => {
    setContext(await api<OwnerContext>("/api/context"));
  }, []);
  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    onLogout();
  }, [onLogout]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible")
        void refreshContext().catch(() => {});
    };
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(() => {
      void refreshContext().catch(() => {});
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.clearInterval(timer);
    };
  }, [refreshContext]);
  return (
    <Workspace.Provider
      value={{
        ...context,
        revision,
        invalidate,
        notify,
        refreshContext,
        logout,
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          <span className="toast__tick" aria-hidden="true">
            ✓
          </span>
          {toast}
          <button
            type="button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </Workspace.Provider>
  );
}
export type { OwnerContext };
