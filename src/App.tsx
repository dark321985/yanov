import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Link,
  NavLink,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  createBrowserRouter,
  useLocation,
} from "react-router-dom";
import { Button } from "@heroui/react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { api, useMutation, useResource } from "./api";
import { WorkspaceProvider, useWorkspace } from "./context";
import type { OwnerContext } from "./context";
import { date } from "./format";
import {
  Badge,
  Confirm,
  Empty,
  ErrorNotice,
  Field,
  FieldErrorsProvider,
  Loading,
} from "./components/ui";
const ClientsPage = lazy(() =>
  import("./pages/entities").then((page) => ({ default: page.ClientsPage })),
);
const ClientDetailPage = lazy(() =>
  import("./pages/entities").then((page) => ({
    default: page.ClientDetailPage,
  })),
);
const WarehousesPage = lazy(() =>
  import("./pages/entities").then((page) => ({ default: page.WarehousesPage })),
);
const WarehouseDetailPage = lazy(() =>
  import("./pages/entities").then((page) => ({
    default: page.WarehouseDetailPage,
  })),
);
const LeasesPage = lazy(() =>
  import("./pages/entities").then((page) => ({ default: page.LeasesPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/finance").then((page) => ({ default: page.DashboardPage })),
);
const LeaseDetailPage = lazy(() =>
  import("./pages/finance").then((page) => ({ default: page.LeaseDetailPage })),
);
const PaymentsPage = lazy(() =>
  import("./pages/finance").then((page) => ({ default: page.PaymentsPage })),
);
const ReportsPage = lazy(() =>
  import("./pages/finance").then((page) => ({ default: page.ReportsPage })),
);
const SchedulePage = lazy(() =>
  import("./pages/finance").then((page) => ({ default: page.SchedulePage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/settings").then((page) => ({
    default: page.NotificationsPage,
  })),
);
const PasswordPage = lazy(() =>
  import("./pages/settings").then((page) => ({ default: page.PasswordPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/settings").then((page) => ({ default: page.SettingsPage })),
);

function WarehouseMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 32 32"
      fill="none"
    >
      <path
        d="M5 13 16 6l11 7v13H5V13Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11 26V15h10v11M11 19h10M11 23h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark">
        <WarehouseMark />
      </span>
      <span>
        <strong>
          складно<span className="brand__period">.</span>
        </strong>
        {!compact && <small>Управление арендой</small>}
      </span>
    </div>
  );
}

function AuthGate() {
  const auth = useResource<{ authenticated: boolean; needsSetup: boolean }>(
    "/api/auth/status",
  );
  useEffect(() => {
    window.addEventListener("skladno:session-expired", auth.reload);
    return () =>
      window.removeEventListener("skladno:session-expired", auth.reload);
  }, [auth.reload]);
  if (auth.loading)
    return (
      <div className="boot-screen">
        <Brand />
        <Loading label="Открываем рабочее пространство…" />
      </div>
    );
  if (auth.error)
    return (
      <div className="boot-screen">
        <Brand />
        <div className="boot-error">
          <ErrorNotice error={auth.error} retry={auth.reload} />
        </div>
      </div>
    );
  if (!auth.data?.authenticated)
    return (
      <Login
        needsSetup={auth.data?.needsSetup ?? false}
        onLogin={auth.reload}
      />
    );
  return <WorkspaceBoot onLogout={auth.reload} />;
}
function WorkspaceBoot({ onLogout }: { onLogout: () => void }) {
  const resource = useResource<OwnerContext>("/api/context");
  if (resource.loading)
    return (
      <div className="boot-screen">
        <Brand />
        <Loading />
      </div>
    );
  if (resource.error || !resource.data)
    return (
      <div className="boot-screen">
        <Brand />
        <div className="boot-error">
          <ErrorNotice
            error={
              resource.error ??
              new Error("Не удалось открыть рабочее пространство.")
            }
            retry={resource.reload}
          />
          <Button
            variant="ghost"
            onPress={() => {
              void api("/api/auth/logout", { method: "POST", body: {} })
                .then(onLogout)
                .catch(onLogout);
            }}
          >
            Вернуться ко входу
          </Button>
        </div>
      </div>
    );
  return (
    <WorkspaceProvider initial={resource.data} onLogout={onLogout}>
      <Layout />
    </WorkspaceProvider>
  );
}
function Login({
  needsSetup,
  onLogin,
}: {
  needsSetup: boolean;
  onLogin: () => void;
}) {
  const [password, setPassword] = useState("");
  const [updated] = useState(
    () => sessionStorage.getItem("skladno:password-updated") === "true",
  );
  const mutation = useMutation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      () => api("/api/auth/login", { method: "POST", body: { password } }),
      () => {
        setPassword("");
        sessionStorage.removeItem("skladno:password-updated");
        onLogin();
      },
    );
  };
  return (
    <div className="login-layout">
      <aside className="login-story">
        <Brand />
        <div className="login-story__content">
          <p className="eyebrow">Рабочее пространство владельца</p>
          <h1>
            Каждый склад.
            <br />
            Каждая оплата.
            <br />
            <span>Под контролем.</span>
          </h1>
          <p>Клиенты, условия аренды и сроки платежей — в одном месте.</p>
          <div className="login-story__illustration" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
        </div>
        <p className="login-story__footer">Складно · управление арендой</p>
      </aside>
      <main className="login-main">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="login-lock">
            <ShieldCheck size={25} />
          </span>
          <p className="eyebrow">Только для владельца</p>
          <h2>{needsSetup ? "Настроим доступ" : "С возвращением"}</h2>
          <p className="login-description">
            {needsSetup
              ? "Перед первым входом создайте единственную учётную запись владельца на сервере."
              : "Введите пароль, чтобы открыть ваше рабочее пространство."}
          </p>
          {needsSetup ? (
            <div className="setup-instructions">
              <strong>Первый запуск</strong>
              <p>В терминале сервера из папки проекта выполните:</p>
              <code>npm run owner:setup</code>
              <p>
                Задайте пароль от 12 до 128 символов. Он вводится скрыто и не
                отображается в интерфейсе.
              </p>
              <Button onPress={onLogin}>
                Проверить готовность <ArrowRight size={15} />
              </Button>
            </div>
          ) : (
            <FieldErrorsProvider error={mutation.error}>
              <form onSubmit={submit} className="login-form">
                {updated && (
                  <div className="info-note">
                    Пароль изменён. Войдите с новым паролем.
                  </div>
                )}
                <Field
                  name="password"
                  label="Пароль"
                  value={password}
                  onChange={setPassword}
                  type="password"
                  autoComplete="current-password"
                  required
                />
                <ErrorNotice error={mutation.error} />
                <Button type="submit" isPending={mutation.busy}>
                  Войти <ArrowRight size={16} />
                </Button>
                <p className="login-security">
                  <ShieldCheck size={13} />
                  Доступ есть только у владельца
                </p>
              </form>
            </FieldErrorsProvider>
          )}
        </div>
        <p className="login-main__footer">
          Ваше пространство для спокойной работы.
        </p>
      </main>
    </div>
  );
}

const navigation = [
  { to: "/", title: "Обзор", icon: LayoutDashboard },
  { to: "/clients", title: "Клиенты", icon: Users },
  { to: "/warehouses", title: "Склады", icon: Building2 },
  { to: "/leases", title: "Аренды", icon: FileText },
  { to: "/payments", title: "Оплаты", icon: Wallet },
  { to: "/schedule", title: "График платежей", icon: CalendarDays },
  { to: "/reports", title: "Поступления", icon: ChartNoAxesCombined },
];
function Layout() {
  const { today, businessName, environment, logout } = useWorkspace();
  const location = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [dirtyLogout, setDirtyLogout] = useState(false);
  const mutation = useMutation();
  const title =
    [
      ...navigation,
      { to: "/settings", title: "Настройки" },
      { to: "/notifications", title: "Напоминания" },
    ].find((item) =>
      item.to === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(item.to),
    )?.title ?? "Рабочее пространство";
  useEffect(() => {
    setMobileMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileMenu) return;
    const panel = document.getElementById("workspace-navigation");
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenu(false);
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [
        ...panel.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ),
      ].filter((item) => item.offsetParent !== null);
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [mobileMenu]);
  const requestLogout = () => {
    const event = new Event("skladno:before-logout", { cancelable: true });
    window.dispatchEvent(event);
    setDirtyLogout(event.defaultPrevented);
    setLogoutConfirm(true);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      {mobileMenu && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        role={mobileMenu ? "dialog" : undefined}
        aria-modal={mobileMenu ? true : undefined}
        className={`sidebar ${mobileMenu ? "sidebar--open" : ""}`}
        aria-label="Основная навигация"
      >
        <div className="sidebar-brand">
          <Brand />
          <Button
            className="sidebar-close"
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Закрыть меню"
            onPress={() => setMobileMenu(false)}
          >
            <X size={20} />
          </Button>
        </div>
        <div className="sidebar__section">
          <p className="sidebar__label">Рабочее пространство</p>
          <nav>
            {navigation.map(({ to, title: text, icon: Icon }) => (
              <NavLink
                key={to}
                end={to === "/"}
                to={to}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "nav-link--active" : ""}`
                }
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{text}</span>
                <span className="nav-link__dot" aria-hidden="true" />
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="sidebar__secondary">
          <NavLink
            to="/notifications"
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link--active" : ""}`
            }
          >
            <Bell size={18} strokeWidth={1.7} />
            Напоминания
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `nav-link ${isActive ? "nav-link--active" : ""}`
            }
          >
            <Settings2 size={18} strokeWidth={1.7} />
            Настройки
          </NavLink>
        </div>
        <div className="sidebar-summary">
          <span className="sidebar-summary__icon">
            <WarehouseMark />
          </span>
          <div>
            <strong>{businessName}</strong>
            <span>Всё об аренде в одном месте</span>
          </div>
        </div>
        <div className="sidebar__footer">
          <span className="owner-avatar" aria-hidden="true">
            В
          </span>
          <div>
            <strong>Владелец</strong>
            <small>Личное пространство</small>
          </div>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Выйти"
            onPress={requestLogout}
          >
            <LogOut size={17} />
          </Button>
        </div>
      </aside>
      <div className="workspace" inert={mobileMenu}>
        <header className="topbar">
          <div className="topbar__left">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label="Открыть меню"
              aria-expanded={mobileMenu}
              onPress={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </Button>
            <div className="topbar__breadcrumb">
              <span>{businessName}</span>
              <ChevronRight size={12} />
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar__right">
            {environment !== "production" && (
              <Badge>
                {environment === "development"
                  ? "Разработка"
                  : "Тестовая среда"}
              </Badge>
            )}
            <span className="topbar-date">
              {date(today, { year: undefined })}
            </span>
            <Link
              to="/notifications"
              className="icon-link topbar-bell"
              aria-label="Открыть журнал напоминаний"
            >
              <Bell size={18} />
            </Link>
            <span className="topbar-avatar" aria-label="Владелец">
              В
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          <Suspense fallback={<Loading label="Открываем раздел…" />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="page-footer">
          <span>Складно · управление арендой</span>
          <span>Всё на своих местах.</span>
        </footer>
      </div>
      <Confirm
        open={logoutConfirm}
        title="Выйти из рабочего пространства?"
        description={
          dirtyLogout
            ? "Есть несохранённые изменения. При выходе они будут потеряны."
            : "Для следующего входа потребуется пароль владельца."
        }
        confirmLabel="Выйти"
        busy={mutation.busy}
        error={mutation.error}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={() => {
          void mutation.run(logout);
        }}
      />
      <ScrollRestoration />
    </div>
  );
}
function NotFound() {
  return (
    <Empty
      title="Страница не найдена"
      description="Возможно, адрес изменился или был указан с ошибкой."
      action={
        <Link className="download-button" to="/">
          <ArrowLeft size={15} />
          На обзор
        </Link>
      }
    />
  );
}
function RouteError() {
  return (
    <div className="boot-screen">
      <Brand />
      <div className="boot-error">
        <h1>Не удалось открыть страницу</h1>
        <p>Обновите приложение. Введённые ранее данные остаются на сервере.</p>
        <a className="download-button" href="/">
          Вернуться к обзору
        </a>
      </div>
    </div>
  );
}
const router = createBrowserRouter([
  {
    path: "/",
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "clients", element: <ClientsPage /> },
      { path: "clients/:id", element: <ClientDetailPage /> },
      { path: "warehouses", element: <WarehousesPage /> },
      { path: "warehouses/:id", element: <WarehouseDetailPage /> },
      { path: "leases", element: <LeasesPage /> },
      { path: "leases/:id", element: <LeaseDetailPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "schedule", element: <SchedulePage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/password", element: <PasswordPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
export default function App() {
  return <RouterProvider router={router} />;
}
