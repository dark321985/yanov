import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "@heroui/react";
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
  const invalidate = useCallback(() => setRevision((value) => value + 1), []);
  const notify = useCallback((message: string) => {
    toast.success(message, { timeout: 5000 });
  }, []);
  const refreshContext = useCallback(async () => {
    setContext(await api<OwnerContext>("/api/context"));
  }, []);
  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    onLogout();
  }, [onLogout]);
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
    </Workspace.Provider>
  );
}
export type { OwnerContext };
