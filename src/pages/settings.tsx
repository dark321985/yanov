import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Switch } from "@heroui/react";
import {
  Bell,
  Check,
  FlaskConical,
  KeyRound,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import type {
  NotificationDto,
  Page,
  SettingsDto,
  TelegramStatus,
} from "../../shared/contracts";
import { api, query, useMutation, useResource } from "../api";
import { useWorkspace } from "../context";
import { date } from "../format";
import { ResourceBody } from "../components/business";
import {
  Badge,
  Confirm,
  DataTable,
  Empty,
  ErrorNotice,
  Field,
  FieldErrorsProvider,
  PageHeader,
  Pagination,
  Pick,
  useUnsaved,
} from "../components/ui";

const notificationNames: Record<NotificationDto["status"], string> = {
  pending: "Запланировано",
  sending: "Отправляется",
  sent: "Отправлено",
  failed: "Ошибка",
  uncertain: "Результат неизвестен",
  cancelled: "Отменено",
};
export function SettingsPage() {
  const { revision } = useWorkspace();
  const resource = useResource<{
    settings: SettingsDto;
    telegram: TelegramStatus;
  }>("/api/settings", revision);
  return (
    <>
      <PageHeader
        eyebrow="Параметры рабочего пространства"
        title="Настройки"
        description="Название, часовой пояс и напоминания о предстоящих оплатах."
      />
      <ResourceBody resource={resource}>
        {(data) => (
          <SettingsForm
            key={data.settings.version}
            settings={data.settings}
            telegram={data.telegram}
          />
        )}
      </ResourceBody>
    </>
  );
}

function SettingsForm({
  settings,
  telegram,
}: {
  settings: SettingsDto;
  telegram: TelegramStatus;
}) {
  const { invalidate, notify, refreshContext, environment } = useWorkspace();
  const [form, setForm] = useState(settings);
  const [reminderDays, setReminderDays] = useState(
    String(settings.reminderDays),
  );
  const [saved, setSaved] = useState(false);
  const [testConfirm, setTestConfirm] = useState(false);
  const [demoConfirm, setDemoConfirm] = useState(false);
  const mutation = useMutation();
  const test = useMutation();
  const demo = useMutation();
  const dirty =
    !saved &&
    (JSON.stringify(form) !== JSON.stringify(settings) ||
      reminderDays !== String(settings.reminderDays));
  const unsaved = useUnsaved(dirty && !mutation.busy);
  const change = <K extends keyof SettingsDto>(
    key: K,
    value: SettingsDto[K],
  ) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        const days = Number(reminderDays);
        if (
          !/^\d+$/.test(reminderDays) ||
          !Number.isInteger(days) ||
          days < 0 ||
          days > 90
        )
          throw new Error(
            "За сколько дней напоминать: укажите целое число от 0 до 90.",
          );
        if (form.telegramEnabled && !telegram.configured)
          throw new Error("Сначала настройте токен бота на сервере.");
        if (form.telegramEnabled && !form.telegramChatId.trim())
          throw new Error("Укажите ID получателя Telegram.");
        return api("/api/settings", {
          method: "PATCH",
          body: { ...form, reminderDays: days },
        });
      },
      () => {
        setSaved(true);
        notify("Настройки сохранены");
        invalidate();
        void refreshContext().catch(() => {});
      },
    );
  };
  return (
    <>
      <FieldErrorsProvider error={mutation.error}>
        <form className="settings-form" onSubmit={submit}>
          <fieldset disabled={mutation.busy}>
            <section className="settings-section">
              <div className="settings-section__intro">
                <h2>Основные</h2>
                <p>
                  Название хозяйства и местное время для сроков и уведомлений.
                </p>
              </div>
              <div className="settings-section__fields">
                <Field
                  name="businessName"
                  label="Название"
                  value={form.businessName}
                  onChange={(value) => change("businessName", value)}
                  required
                />
                <Pick
                  name="timezone"
                  label="Часовой пояс"
                  value={form.timezone}
                  onChange={(value) => change("timezone", value)}
                  options={[
                    ...new Map(
                      [
                        { id: form.timezone, name: form.timezone },
                        { id: "Europe/Moscow", name: "Москва · Europe/Moscow" },
                        {
                          id: "Europe/Kaliningrad",
                          name: "Калининград · Europe/Kaliningrad",
                        },
                        { id: "Europe/Samara", name: "Самара · Europe/Samara" },
                        {
                          id: "Asia/Yekaterinburg",
                          name: "Екатеринбург · Asia/Yekaterinburg",
                        },
                        {
                          id: "Asia/Novosibirsk",
                          name: "Новосибирск · Asia/Novosibirsk",
                        },
                        { id: "Asia/Irkutsk", name: "Иркутск · Asia/Irkutsk" },
                        {
                          id: "Asia/Vladivostok",
                          name: "Владивосток · Asia/Vladivostok",
                        },
                        { id: "UTC", name: "UTC" },
                      ].map((item) => [item.id, item]),
                    ).values(),
                  ]}
                />
              </div>
            </section>
            <section id="telegram" className="settings-section">
              <div className="settings-section__intro">
                <span className="settings-icon">
                  <Send size={20} />
                </span>
                <h2>Telegram-напоминания</h2>
                <p>
                  Напоминаем владельцу заранее о неоплаченных периодах аренды.
                </p>
                <Link className="subtle-link" to="/notifications">
                  Журнал отправок <Bell size={13} />
                </Link>
              </div>
              <div className="settings-section__fields">
                <div className="telegram-status">
                  <strong>Токен бота</strong>
                  <Badge color={telegram.configured ? "success" : "warning"}>
                    {telegram.configured
                      ? "Настроен на сервере"
                      : "Не настроен"}
                  </Badge>
                </div>
                <div className="info-note">
                  <p>
                    Создайте бота через{" "}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noreferrer"
                    >
                      @BotFather
                    </a>
                    , сохраните его токен в серверной переменной{" "}
                    <code>TELEGRAM_BOT_TOKEN</code> и перезапустите сервер.
                    Начните диалог с ботом, затем укажите ID получателя ниже.
                  </p>
                  <p>Токен хранится на сервере и не передаётся в браузер.</p>
                </div>
                <Field
                  name="telegramChatId"
                  label="ID получателя Telegram"
                  value={form.telegramChatId}
                  onChange={(value) => change("telegramChatId", value)}
                  autoComplete="off"
                  placeholder="Числовой ID вашего чата"
                  description="Число; для групп может начинаться с минуса. Не имя пользователя."
                />
                <div className="form-grid">
                  <Field
                    name="reminderDays"
                    label="Напомнить за сколько дней"
                    type="number"
                    value={reminderDays}
                    onChange={(value) => {
                      setReminderDays(value);
                      setSaved(false);
                    }}
                    min={0}
                    max={90}
                    step={1}
                    required
                    description="По умолчанию 5. Ноль — в день оплаты."
                  />
                  <Field
                    name="reminderTime"
                    label="Время отправки"
                    type="time"
                    value={form.reminderTime}
                    onChange={(value) => change("reminderTime", value)}
                    required
                    description={`В часовом поясе ${form.timezone}`}
                  />
                </div>
                <Switch
                  isSelected={form.telegramEnabled}
                  onChange={(value) => change("telegramEnabled", value)}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <strong>Автоматические напоминания</strong>
                    <span className="field-hint">
                      Отправляются, даже когда страница закрыта.
                    </span>
                  </Switch.Content>
                </Switch>
                <div className="telegram-test">
                  <Button
                    type="button"
                    variant="secondary"
                    onPress={() => setTestConfirm(true)}
                    isDisabled={
                      !telegram.configured || !settings.telegramChatId || dirty
                    }
                  >
                    <Send size={15} />
                    Отправить тест
                  </Button>
                  <p>
                    {dirty
                      ? "Сначала сохраните изменения."
                      : !settings.telegramChatId
                        ? "Сначала укажите и сохраните ID получателя."
                        : "Отправит настоящее сообщение по вашему нажатию."}
                  </p>
                </div>
                <div className="detail-facts">
                  <div>
                    <span>Последняя проверка</span>
                    <strong>
                      {telegram.lastRunAt
                        ? new Intl.DateTimeFormat("ru-RU", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: settings.timezone,
                          }).format(new Date(telegram.lastRunAt))
                        : "Ещё не выполнялась"}
                    </strong>
                  </div>
                  <div>
                    <span>Последняя успешная отправка</span>
                    <strong>
                      {telegram.lastSuccessAt
                        ? new Intl.DateTimeFormat("ru-RU", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: settings.timezone,
                          }).format(new Date(telegram.lastSuccessAt))
                        : "Ещё не было"}
                    </strong>
                  </div>
                </div>
              </div>
            </section>
          </fieldset>
          <ErrorNotice error={mutation.error} />
          <div className="settings-save">
            <span>
              {dirty ? "Есть несохранённые изменения" : "Настройки актуальны"}
            </span>
            <Button type="submit" isPending={mutation.busy} isDisabled={!dirty}>
              <Check size={15} />
              Сохранить настройки
            </Button>
          </div>
        </form>
      </FieldErrorsProvider>
      <section className="settings-section">
        <div className="settings-section__intro">
          <span className="settings-icon">
            <ShieldCheck size={20} />
          </span>
          <h2>Доступ владельца</h2>
          <p>Единственная учётная запись для управления хозяйством.</p>
        </div>
        <div className="settings-section__fields">
          <Link className="download-button" to="/settings/password">
            <KeyRound size={16} />
            Изменить пароль
          </Link>
          <p className="field-hint">
            Смена пароля завершит действующие сессии. Потребуется войти заново.
          </p>
        </div>
      </section>
      {environment === "development" && (
        <section className="settings-section demo-section">
          <div className="settings-section__intro">
            <span className="settings-icon">
              <FlaskConical size={20} />
            </span>
            <h2>Пример для знакомства</h2>
            <p>Доступен только в среде разработки.</p>
          </div>
          <div className="settings-section__fields">
            <p className="field-hint">
              На пустой базе можно добавить демонстрационные склады, клиентов и
              оплаты. Реальные данные не заменяются. При наличии записей сервер
              отклонит загрузку.
            </p>
            <Button
              variant="secondary"
              onPress={() => setDemoConfirm(true)}
              isDisabled={dirty}
            >
              Загрузить пример
            </Button>
          </div>
        </section>
      )}
      {unsaved}
      <Confirm
        open={testConfirm}
        title="Отправить тестовое сообщение?"
        description="Бот отправит настоящее сообщение получателю, сохранённому в настройках. Автоматические напоминания не включатся."
        confirmLabel="Отправить сообщение"
        busy={test.busy}
        error={test.error}
        onClose={() => setTestConfirm(false)}
        onConfirm={() => {
          void test.run(
            () => api("/api/telegram/test", { method: "POST", body: {} }),
            () => {
              notify("Тестовое сообщение отправлено");
              setTestConfirm(false);
              invalidate();
            },
          );
        }}
      />
      <Confirm
        open={demoConfirm}
        title="Добавить демонстрационные данные?"
        description="На пустой базе будут созданы примеры клиентов, складов, аренд и оплат. Они нужны только для знакомства с интерфейсом."
        confirmLabel="Загрузить пример"
        busy={demo.busy}
        error={demo.error}
        onClose={() => setDemoConfirm(false)}
        onConfirm={() => {
          void demo.run(
            () => api("/api/demo", { method: "POST", body: { confirm: true } }),
            () => {
              notify("Демонстрационные данные добавлены");
              setDemoConfirm(false);
              invalidate();
            },
          );
        }}
      />
    </>
  );
}

export function PasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const mutation = useMutation();
  const unsaved = useUnsaved(
    !saved && !!(current || next || confirmation) && !mutation.busy,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        if (next.length < 12 || next.length > 128)
          throw new Error(
            "Новый пароль должен содержать от 12 до 128 символов.",
          );
        if (next !== confirmation)
          throw new Error("Новый пароль и подтверждение не совпадают.");
        return api("/api/auth/change-password", {
          method: "POST",
          body: { currentPassword: current, newPassword: next },
        });
      },
      () => {
        setSaved(true);
        setCurrent("");
        setNext("");
        setConfirmation("");
        sessionStorage.setItem("skladno:password-updated", "true");
        window.dispatchEvent(new Event("skladno:session-expired"));
      },
    );
  };
  return (
    <>
      <Link className="subtle-link back-button" to="/settings">
        ← Настройки
      </Link>
      <PageHeader
        eyebrow="Безопасность"
        title="Изменить пароль"
        description="После сохранения все сессии завершатся. Войдите с новым паролем."
      />
      <FieldErrorsProvider error={mutation.error}>
        <form className="password-form" onSubmit={submit}>
          <fieldset disabled={mutation.busy}>
            <Field
              name="currentPassword"
              label="Текущий пароль"
              value={current}
              onChange={setCurrent}
              type="password"
              autoComplete="current-password"
              required
            />
            <Field
              name="newPassword"
              label="Новый пароль"
              value={next}
              onChange={setNext}
              type="password"
              autoComplete="new-password"
              required
              description="От 12 до 128 символов."
            />
            <Field
              name="confirmation"
              label="Повторите новый пароль"
              value={confirmation}
              onChange={setConfirmation}
              type="password"
              autoComplete="new-password"
              required
            />
          </fieldset>
          <ErrorNotice error={mutation.error} />
          <Button type="submit" isPending={mutation.busy}>
            <KeyRound size={15} />
            Изменить пароль
          </Button>
        </form>
      </FieldErrorsProvider>
      {unsaved}
    </>
  );
}

export function NotificationsPage() {
  const { revision, timezone } = useWorkspace();
  const [page, setPage] = useState(1);
  const resource = useResource<Page<NotificationDto>>(
    query("/api/notifications", { page, pageSize: 25 }),
    revision,
  );
  return (
    <>
      <PageHeader
        eyebrow="Telegram"
        title="Журнал напоминаний"
        description="Планирование и результаты отправки сообщений владельцу."
        action={
          <Button variant="secondary" onPress={resource.reload}>
            <RefreshCw size={15} />
            Обновить
          </Button>
        }
      />
      <div className="info-note">
        Для неопределённого результата доставка не считается подтверждённой.
        Автоматический повтор может быть ограничен, чтобы не отправить дубликат.{" "}
        <Link to="/settings#telegram">Настроить напоминания</Link>
      </div>
      <ResourceBody resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="table-surface">
              <DataTable
                label="Журнал Telegram-напоминаний"
                rows={data.items}
                columns={[
                  {
                    key: "client",
                    label: "Клиент / склад",
                    render: (row) => (
                      <div className="cell-stack">
                        <strong>{row.clientName}</strong>
                        <span className="cell-secondary">
                          Склад № {row.warehouseNumber}
                        </span>
                      </div>
                    ),
                  },
                  {
                    key: "due",
                    label: "Срок оплаты",
                    render: (row) => date(row.dueDate),
                  },
                  {
                    key: "scheduled",
                    label: "План отправки",
                    render: (row) => date(row.scheduledOn),
                  },
                  {
                    key: "state",
                    label: "Результат",
                    render: (row) => (
                      <Badge
                        color={
                          row.status === "sent"
                            ? "success"
                            : row.status === "failed"
                              ? "danger"
                              : row.status === "uncertain"
                                ? "warning"
                                : "default"
                        }
                      >
                        {notificationNames[row.status]}
                      </Badge>
                    ),
                  },
                  {
                    key: "attempts",
                    label: "Попытки",
                    render: (row) => row.attempts,
                  },
                  {
                    key: "sent",
                    label: "Отправлено",
                    render: (row) =>
                      row.sentAt
                        ? new Intl.DateTimeFormat("ru-RU", {
                            dateStyle: "short",
                            timeStyle: "short",
                            timeZone: timezone,
                          }).format(new Date(row.sentAt))
                        : "—",
                  },
                  {
                    key: "code",
                    label: "Код результата",
                    render: (row) => (
                      <span className="cell-secondary">
                        {row.resultCode ?? "—"}
                      </span>
                    ),
                  },
                ]}
              />
              <Pagination page={data} onChange={setPage} />
            </div>
          ) : (
            <Empty
              icon={<Bell size={25} />}
              title="Напоминаний пока нет"
              description="Настройте Telegram и включите уведомления. Здесь появятся запланированные отправки и их результаты."
              action={
                <Link className="download-button" to="/settings#telegram">
                  Настроить Telegram
                </Link>
              }
            />
          )
        }
      </ResourceBody>
    </>
  );
}
