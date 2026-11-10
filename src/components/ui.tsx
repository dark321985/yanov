import { createContext, useContext, useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import {
  Button,
  Chip,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Table,
  TextArea,
  TextField,
} from "@heroui/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Inbox,
  Search,
  X,
} from "lucide-react";
import type { Page } from "../../shared/contracts";
import { ApiFailure } from "../api";

const fieldLabels: Record<string, string> = {
  name: "Имя или название",
  phone: "Телефон",
  email: "Email",
  contact: "Контактное лицо",
  notes: "Заметка",
  number: "Номер склада",
  area: "Площадь",
  address: "Расположение",
  availability: "Доступность",
  clientId: "Клиент",
  warehouseId: "Склад",
  leaseId: "Аренда",
  startDate: "Начало аренды",
  effectiveDate: "Дата изменения ставки",
  monthlyRateMinor: "Ставка за месяц",
  amountMinor: "Сумма поступления",
  receivedOn: "Дата поступления",
  chargeIds: "Оплачиваемые периоды",
  method: "Способ оплаты",
  reason: "Причина сторнирования",
  businessName: "Название",
  timezone: "Часовой пояс",
  reminderDays: "Дней до напоминания",
  reminderTime: "Время отправки",
  telegramChatId: "ID получателя Telegram",
  telegramEnabled: "Автоматические напоминания",
  password: "Пароль",
  currentPassword: "Текущий пароль",
  newPassword: "Новый пароль",
  version: "Версия записи",
  months: "Число месяцев",
};
const FieldErrors = createContext<Record<string, string>>({});
export function FieldErrorsProvider({
  error,
  children,
}: {
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <FieldErrors.Provider
      value={error instanceof ApiFailure ? error.fields : {}}
    >
      {children}
    </FieldErrors.Provider>
  );
}
export function useFieldError(name?: string) {
  const fields = useContext(FieldErrors);
  if (!name) return undefined;
  return (
    Object.entries(fields)
      .filter(([key]) => key === name || key.startsWith(`${name}.`))
      .map(([, message]) => message)
      .join(" ") || undefined
  );
}
export function FieldMessage({ name, id }: { name: string; id?: string }) {
  const error = useFieldError(name);
  return error ? (
    <p id={id} className="field-error text-danger" role="alert">
      {error}
    </p>
  ) : null;
}

export function Loading({ label = "Загружаем данные…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <Spinner size="sm" />
      {label}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return error ? (
    <div className="error-notice" role="alert">
      <AlertCircle size={17} />
      <div>
        <strong>{error.message}</strong>
        {error instanceof ApiFailure && error.status === 409 && (
          <p>
            Данные могли измениться. Обновите страницу и проверьте актуальное
            состояние.
          </p>
        )}
        {error instanceof ApiFailure &&
          Object.keys(error.fields).length > 0 && (
            <ul>
              {Object.entries(error.fields).map(([field, message]) => (
                <li key={field}>
                  {fieldLabels[field.split(".")[0] ?? field] ?? "Параметр"}:{" "}
                  {message}
                </li>
              ))}
            </ul>
          )}
      </div>
      {retry && (
        <Button size="sm" variant="tertiary" onPress={retry}>
          Повторить
        </Button>
      )}
    </div>
  ) : null;
}
export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon ?? <Inbox size={26} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  );
}
export function Back({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" className="back-button" onPress={onPress}>
      <ArrowLeft size={15} />
      {children}
    </Button>
  );
}
export function goBack(navigate: NavigateFunction, fallback: string) {
  if (
    typeof window.history.state?.idx === "number" &&
    window.history.state.idx > 0
  )
    navigate(-1);
  else navigate(fallback);
}
export function Badge({
  children,
  color = "default",
}: {
  children: ReactNode;
  color?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <Chip size="sm" color={color} variant="soft">
      <span className="status-dot" aria-hidden="true" />
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Поиск…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <TextField aria-label={placeholder} value={value} onChange={onChange}>
        <Input placeholder={placeholder} />
      </TextField>
      {value && (
        <Button
          size="sm"
          isIconOnly
          variant="ghost"
          aria-label="Очистить поиск"
          onPress={() => onChange("")}
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
export function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  description,
  error,
  multiline = false,
  min,
  max,
  step,
  autoComplete,
  placeholder,
  disabled = false,
  inputMode,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "password" | "date" | "time" | "number";
  required?: boolean;
  description?: string;
  error?: string;
  multiline?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  const contextError = useFieldError(name);
  const message = error ?? contextError;
  return (
    <TextField
      className="form-field"
      name={name}
      value={value}
      onChange={onChange}
      type={type}
      isRequired={required}
      isInvalid={!!message}
      isDisabled={disabled}
      autoComplete={autoComplete}
    >
      <Label>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </Label>
      {multiline ? (
        <TextArea rows={3} placeholder={placeholder} />
      ) : (
        <Input
          type={type}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          inputMode={inputMode}
        />
      )}
      {description && <Description>{description}</Description>}
      {message && <FieldError>{message}</FieldError>}
    </TextField>
  );
}
export function Pick({
  label,
  name,
  value,
  onChange,
  options,
  placeholder = "Выберите…",
  required = false,
  disabled = false,
  description,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  description?: string;
}) {
  const error = useFieldError(name);
  return (
    <Select
      className="form-field"
      name={name}
      isInvalid={!!error}
      placeholder={placeholder}
      value={value || null}
      onChange={(key) => onChange(key == null ? "" : String(key))}
      isRequired={required}
      isDisabled={disabled}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      {description && <Description>{description}</Description>}
      {error && <FieldError>{error}</FieldError>}
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.name}
            >
              {option.name}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (value: { from: string; to: string }) => void;
}) {
  return (
    <div className="date-range">
      <Field
        label="С даты"
        type="date"
        value={from}
        onChange={(value) => onChange({ from: value, to })}
        max={to || undefined}
      />
      <span className="date-range__separator" aria-hidden="true">
        —
      </span>
      <Field
        label="По дату"
        type="date"
        value={to}
        onChange={(value) => onChange({ from, to: value })}
        min={from || undefined}
      />
    </div>
  );
}
export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}
export function DataTable<T extends { id: string }>({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
}) {
  return (
    <Table className="data-table">
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            {columns.map((column, i) => (
              <Table.Column
                key={column.key}
                id={column.key}
                isRowHeader={i === 0}
                className={column.className}
              >
                {column.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id} id={row.id}>
                {columns.map((column) => (
                  <Table.Cell key={column.key} className={column.className}>
                    {column.render(row)}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
export function Pagination({
  page,
  onChange,
}: {
  page: Pick<Page<unknown>, "page" | "pageSize" | "total">;
  onChange: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  return (
    <div className="table-pagination">
      <span>
        {page.total
          ? `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} из ${page.total}`
          : "0 записей"}
      </span>
      <div>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="Предыдущая страница"
          isDisabled={page.page <= 1}
          onPress={() => onChange(page.page - 1)}
        >
          <ArrowLeft size={15} />
        </Button>
        <span>
          {page.page} / {pages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="Следующая страница"
          isDisabled={page.page >= pages}
          onPress={() => onChange(page.page + 1)}
        >
          <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
export function useUnsaved(dirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const beforeLogout = (event: Event) => event.preventDefault();
    window.addEventListener("skladno:before-logout", beforeLogout);
    return () =>
      window.removeEventListener("skladno:before-logout", beforeLogout);
  }, [dirty]);
  return (
    <Confirm
      open={blocker.state === "blocked"}
      title="Изменения не сохранены"
      description="Если перейти на другую страницу, введённые данные будут потеряны."
      confirmLabel="Перейти без сохранения"
      onConfirm={() => {
        if (blocker.state === "blocked") blocker.proceed();
      }}
      onClose={() => {
        if (blocker.state === "blocked") blocker.reset();
      }}
    />
  );
}
export function Confirm({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  danger = false,
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: Error | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
    >
      <Modal.Container size="sm">
        <Modal.Dialog role="alertdialog">
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="dialog-description">{description}</p>
            <ErrorNotice error={error ?? null} />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
              Отмена
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              isPending={busy}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
export function FormDialog({
  title,
  description,
  children,
  onClose,
  onSubmit,
  busy = false,
  error,
  dirty = false,
  submitLabel = "Сохранить",
  wide = false,
  footer,
  submitDisabled = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  error?: Error | null;
  dirty?: boolean;
  submitLabel?: string;
  wide?: boolean;
  footer?: ReactNode;
  submitDisabled?: boolean;
}) {
  const [discard, setDiscard] = useState(false);
  const formId = useId();
  const unsaved = useUnsaved(dirty && !busy);
  const close = () => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <Modal.Backdrop
        isOpen
        onOpenChange={(value) => {
          if (!value) close();
        }}
        isDismissable={!busy}
        isKeyboardDismissDisabled={busy}
      >
        <Modal.Container size={wide ? "lg" : "md"} scroll="inside">
          <Modal.Dialog className="editor-dialog">
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label="Закрыть окно"
              className="editor-dialog__close"
              isDisabled={busy}
              onPress={close}
            >
              <X size={18} />
            </Button>
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
              {description && (
                <p className="dialog-description">{description}</p>
              )}
            </Modal.Header>
            <Modal.Body>
              <FieldErrorsProvider error={error}>
                <form id={formId} onSubmit={onSubmit} className="editor-form">
                  <fieldset disabled={busy}>{children}</fieldset>
                  <ErrorNotice error={error ?? null} />
                </form>
              </FieldErrorsProvider>
            </Modal.Body>
            <Modal.Footer>
              {footer}
              <Button variant="tertiary" isDisabled={busy} onPress={close}>
                Отмена
              </Button>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                isPending={busy}
                isDisabled={submitDisabled}
              >
                {submitLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      {unsaved}
      <Confirm
        open={discard}
        title="Закрыть без сохранения?"
        description="Введённые изменения будут потеряны."
        confirmLabel="Закрыть без сохранения"
        danger
        onClose={() => setDiscard(false)}
        onConfirm={onClose}
      />
    </>
  );
}
export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "danger" | "accent";
}) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}
export function SectionHeading({
  title,
  action,
  description,
}: {
  title: string;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
