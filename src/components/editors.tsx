import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox } from "@heroui/react";
import { Check, Plus, ShieldCheck } from "lucide-react";
import type {
  ChargeDto,
  ClientDto,
  LeaseDto,
  Page,
  PaymentDto,
  PaymentInput,
  PaymentPreview,
  WarehouseDto,
} from "../../shared/contracts";
import { api, query, useMutation, useResource } from "../api";
import { useWorkspace } from "../context";
import {
  date,
  decimalMoney,
  inclusiveEnd,
  methodNames,
  money,
  parseMoney,
  period,
} from "../format";
import { ChargeBadge, DebtWarning, EntityPick, ResourceBody } from "./business";
import { ErrorNotice, Field, FieldMessage, FormDialog, Pick } from "./ui";

export function ClientEditor({
  client,
  onClose,
}: {
  client?: ClientDto;
  onClose: () => void;
}) {
  const { invalidate, notify } = useWorkspace();
  const initial = useMemo(
    () => ({
      name: client?.name ?? "",
      phone: client?.phone ?? "",
      email: client?.email ?? "",
      contact: client?.contact ?? "",
      notes: client?.notes ?? "",
    }),
    [client],
  );
  const [form, setForm] = useState(initial);
  const mutation = useMutation();
  const duplicateSearch = form.phone.replace(/\D/g, "").length >= 5
    ? form.phone.trim()
    : form.name.trim().length >= 3 ? form.name.trim() : "";
  const duplicateLookup = useResource<Page<ClientDto>>(duplicateSearch
    ? query("/api/clients", { search: duplicateSearch, page: 1, pageSize: 5 })
    : null);
  const similarClients = duplicateLookup.data?.items.filter((item) => item.id !== client?.id) ?? [];
  const field = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      () =>
        api(`/api/clients${client ? `/${client.id}` : ""}`, {
          method: client ? "PATCH" : "POST",
          body: { ...form, ...(client ? { version: client.version } : {}) },
        }),
      () => {
        invalidate();
        notify(client ? "Данные клиента сохранены" : "Клиент добавлен");
        onClose();
      },
    );
  };
  return (
    <FormDialog
      title={client ? "Редактировать клиента" : "Новый клиент"}
      description="Контакты арендатора и важная информация для работы."
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.busy}
      error={mutation.error}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    >
      <Field
        name="name"
        label="Имя или название организации"
        value={form.name}
        onChange={field("name")}
        required
        placeholder="Например, ООО «Мастерская»"
      />
      <div className="form-grid">
        <Field
          name="phone"
          label="Телефон"
          type="tel"
          value={form.phone}
          onChange={field("phone")}
          autoComplete="tel"
        />
        <Field
          name="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={field("email")}
          autoComplete="email"
        />
      </div>
      {duplicateSearch && duplicateLookup.loading && (
        <p className="field-hint" role="status">Проверяем похожие записи…</p>
      )}
      {duplicateSearch && !duplicateLookup.loading && duplicateLookup.error && (
        <div className="info-note" role="status">
          <p>Не удалось проверить похожих клиентов. Сохранение доступно.</p>
          <Button type="button" size="sm" variant="ghost" onPress={duplicateLookup.reload}>Повторить проверку</Button>
        </div>
      )}
      {duplicateSearch && !duplicateLookup.loading && !duplicateLookup.error && similarClients.length > 0 && (
        <div className="info-note" role="status">
          <p>Похожие клиенты уже есть. Проверьте, не добавляете ли вы повторно.</p>
          <ul>
            {similarClients.map((item) => (
              <li key={item.id}><Link to={`/clients/${item.id}`} target="_blank" rel="noreferrer">{item.name}</Link></li>
            ))}
          </ul>
          <p>Карточка откроется в новой вкладке. Сохранение доступно; записи не объединяются автоматически.</p>
        </div>
      )}
      <Field
        name="contact"
        label="Контактное лицо"
        value={form.contact}
        onChange={field("contact")}
      />
      <Field
        name="notes"
        label="Заметка"
        value={form.notes}
        onChange={field("notes")}
        multiline
      />
    </FormDialog>
  );
}

export function WarehouseEditor({
  warehouse,
  onClose,
}: {
  warehouse?: WarehouseDto;
  onClose: () => void;
}) {
  const { invalidate, notify } = useWorkspace();
  const initial = useMemo(
    () => ({
      number: warehouse?.number ?? "",
      area: warehouse?.area == null ? "" : String(warehouse.area),
      address: warehouse?.address ?? "",
      notes: warehouse?.notes ?? "",
      availability: warehouse?.availability ?? "available",
    }),
    [warehouse],
  );
  const [form, setForm] = useState(initial);
  const mutation = useMutation();
  const field = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        const area = form.area.trim()
          ? Number(form.area.replace(",", "."))
          : null;
        if (area !== null && (!Number.isFinite(area) || area <= 0))
          throw new Error("Площадь должна быть больше нуля.");
        return api(`/api/warehouses${warehouse ? `/${warehouse.id}` : ""}`, {
          method: warehouse ? "PATCH" : "POST",
          body: {
            ...form,
            area,
            ...(warehouse ? { version: warehouse.version } : {}),
          },
        });
      },
      () => {
        invalidate();
        notify(warehouse ? "Данные склада сохранены" : "Склад добавлен");
        onClose();
      },
    );
  };
  return (
    <FormDialog
      title={warehouse ? "Редактировать склад" : "Новый склад"}
      description="Номер склада должен быть уникальным. Стоимость задаётся отдельно в каждой аренде."
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.busy}
      error={mutation.error}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    >
      <div className="form-grid">
        <Field
          name="number"
          label="Номер склада"
          value={form.number}
          onChange={field("number")}
          required
          placeholder="А-01"
        />
        <Field
          name="area"
          label="Площадь, м²"
          value={form.area}
          onChange={field("area")}
          inputMode="decimal"
          placeholder="Необязательно"
        />
      </div>
      <Field
        name="address"
        label="Адрес / расположение"
        value={form.address}
        onChange={field("address")}
      />
      <Pick
        name="availability"
        label="Доступность"
        value={form.availability}
        onChange={field("availability")}
        options={[
          { id: "available", name: "Доступен для аренды" },
          { id: "maintenance", name: "На обслуживании" },
        ]}
      />
      <Field
        name="notes"
        label="Заметка"
        value={form.notes}
        onChange={field("notes")}
        multiline
      />
    </FormDialog>
  );
}

export function LeaseEditor({
  onClose,
  client,
  warehouse,
}: {
  onClose: () => void;
  client?: { id: string; name: string };
  warehouse?: { id: string; number: string };
}) {
  const { today, invalidate, notify } = useWorkspace();
  const initial = useMemo(
    () => ({
      clientId: client?.id ?? "",
      warehouseId: warehouse?.id ?? "",
      startDate: today,
      endDate: "",
      rate: "",
      notes: "",
    }),
    [client?.id, warehouse?.id, today],
  );
  const [form, setForm] = useState(initial);
  const mutation = useMutation();
  const field = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        if (!form.clientId || !form.warehouseId)
          throw new Error("Выберите клиента и склад.");
        if (form.endDate && form.endDate <= form.startDate)
          throw new Error("Дата освобождения должна быть позже начала аренды.");
        return api("/api/leases", {
          method: "POST",
          body: {
            clientId: form.clientId,
            warehouseId: form.warehouseId,
            startDate: form.startDate,
            endDate: form.endDate || null,
            monthlyRateMinor: parseMoney(form.rate),
            notes: form.notes,
          },
        });
      },
      () => {
        invalidate();
        notify("Аренда оформлена");
        onClose();
      },
    );
  };
  return (
    <FormDialog
      title="Новая аренда"
      description="Индивидуальная ставка действует только для выбранного клиента и склада."
      wide
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.busy}
      error={mutation.error}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
    >
      <div className="form-grid">
        <EntityPick
          kind="clients"
          name="clientId"
          label="Клиент"
          value={form.clientId}
          onChange={field("clientId")}
          initial={client}
          required
        />
        <EntityPick
          kind="warehouses"
          name="warehouseId"
          label="Склад"
          value={form.warehouseId}
          onChange={field("warehouseId")}
          initial={
            warehouse
              ? { id: warehouse.id, name: `№ ${warehouse.number}` }
              : undefined
          }
          required
        />
      </div>
      <div className="form-grid">
        <Field
          name="startDate"
          label="Начало аренды"
          type="date"
          value={form.startDate}
          onChange={field("startDate")}
          required
        />
        <Field
          name="endDate"
          label="Дата освобождения"
          type="date"
          value={form.endDate}
          onChange={field("endDate")}
          min={form.startDate}
          description="Необязательно. С этой даты склад уже свободен."
        />
      </div>
      <Field
        name="monthlyRateMinor"
        label="Ставка за расчётный месяц, ₽"
        value={form.rate}
        onChange={field("rate")}
        required
        inputMode="decimal"
        placeholder="Например, 15000"
        description="Расчётный месяц отсчитывается от даты начала аренды. Минимальная ставка — 0,01 ₽."
      />
      <Field
        name="notes"
        label="Заметка к аренде"
        value={form.notes}
        onChange={field("notes")}
        multiline
      />
      <div className="info-note">
        Система проверит пересечение сроков с другими арендами. Указанная дата
        освобождения в оплачиваемый срок не включается.
      </div>
    </FormDialog>
  );
}

export function LeaseActionEditor({
  lease,
  action,
  onClose,
}: {
  lease: LeaseDto;
  action: "notes" | "rate" | "close";
  onClose: () => void;
}) {
  const { today, invalidate, notify } = useWorkspace();
  const [notes, setNotes] = useState(lease.notes);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rate, setRate] = useState(decimalMoney(lease.monthlyRateMinor));
  const mutation = useMutation();
  const dirty =
    action === "notes"
      ? notes !== lease.notes
      : !!effectiveDate || rate !== decimalMoney(lease.monthlyRateMinor);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        if (action === "notes")
          return api(`/api/leases/${lease.id}`, {
            method: "PATCH",
            body: { notes, version: lease.version },
          });
        if (!effectiveDate) throw new Error("Выберите дату.");
        if (action === "rate")
          return api(`/api/leases/${lease.id}/rates`, {
            method: "POST",
            body: {
              effectiveDate,
              monthlyRateMinor: parseMoney(rate),
              version: lease.version,
            },
          });
        return api(`/api/leases/${lease.id}/close`, {
          method: "POST",
          body: { endDate: effectiveDate, version: lease.version },
        });
      },
      () => {
        invalidate();
        notify(
          action === "close" ? "Срок аренды изменён" : "Изменения сохранены",
        );
        onClose();
      },
    );
  };
  return (
    <FormDialog
      title={
        action === "notes"
          ? "Заметка к аренде"
          : action === "rate"
            ? "Новая ставка аренды"
            : "Завершение аренды"
      }
      description={`Склад № ${lease.warehouseNumber} · ${lease.clientName}`}
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.busy}
      error={mutation.error}
      dirty={dirty}
      submitLabel={action === "close" ? "Подтвердить завершение" : "Сохранить"}
    >
      {action === "notes" ? (
        <Field
          name="notes"
          label="Заметка"
          value={notes}
          onChange={setNotes}
          multiline
        />
      ) : (
        <>
          <Field
            name={action === "rate" ? "effectiveDate" : "endDate"}
            label={
              action === "rate" ? "Действует с даты" : "Склад свободен с даты"
            }
            type="date"
            value={effectiveDate}
            onChange={setEffectiveDate}
            min={action === "rate" ? today : lease.startDate}
            required
            description={
              action === "rate"
                ? "Только граница будущего расчётного периода."
                : "Дата освобождения не включается в оплачиваемый срок. Укажите границу расчётного периода."
            }
          />
          {action === "rate" ? (
            <>
              <Field
                name="monthlyRateMinor"
                label="Новая ставка за месяц, ₽"
                value={rate}
                onChange={setRate}
                required
                inputMode="decimal"
              />
              <div className="info-note">
                Изменение не затрагивает оплаченные периоды и финансовую
                историю. Сервер проверит возможность изменения.
              </div>
            </>
          ) : (
            <>
              <div className="detail-facts">
                <div>
                  <span>Текущая задолженность</span>
                  <strong>{money(lease.debtMinor)}</strong>
                </div>
                <div>
                  <span>Оплачено по</span>
                  <strong>{date(inclusiveEnd(lease.paidThrough))}</strong>
                </div>
              </div>
              <div className="info-note">
                Аренда остаётся в истории. Уже оплаченные будущие периоды не
                позволяют завершить аренду раньше них. Задолженность не
                списывается.
              </div>
            </>
          )}
        </>
      )}
    </FormDialog>
  );
}

export function ReversalEditor({
  payment,
  onClose,
}: {
  payment: PaymentDto;
  onClose: () => void;
}) {
  const { invalidate, notify } = useWorkspace();
  const [reason, setReason] = useState("");
  const mutation = useMutation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.run(
      async () => {
        if (!reason.trim()) throw new Error("Укажите причину сторнирования.");
        return api(`/api/payments/${payment.id}/reverse`, {
          method: "POST",
          body: { reason: reason.trim() },
        });
      },
      () => {
        invalidate();
        notify("Оплата сторнирована. История сохранена.");
        onClose();
      },
    );
  };
  return (
    <FormDialog
      title="Сторнировать оплату"
      description={`${money(payment.amountMinor)} · ${date(payment.receivedOn)} · ${payment.clientName}`}
      onClose={onClose}
      onSubmit={submit}
      busy={mutation.busy}
      error={mutation.error}
      dirty={!!reason}
      submitLabel="Сторнировать"
    >
      <div className="inline-warning">
        Оплата будет исключена из поступлений, а её распределение отменено.
        Начисления снова потребуют оплаты. Запись и причина останутся в истории.
        Это не банковский возврат.
      </div>
      <Field
        name="reason"
        label="Причина"
        value={reason}
        onChange={setReason}
        multiline
        required
        placeholder="Например, оплата внесена дважды"
      />
    </FormDialog>
  );
}

interface LeaseDetail {
  lease: LeaseDto;
  charges: ChargeDto[];
  payments: PaymentDto[];
}
export function PaymentEditor({
  onClose,
  charge,
  lease,
}: {
  onClose: () => void;
  charge?: ChargeDto;
  lease?: LeaseDto;
}) {
  const { today, revision, invalidate, notify } = useWorkspace();
  const [leaseId, setLeaseId] = useState(charge?.leaseId ?? lease?.id ?? "");
  const [receivedOn, setReceivedOn] = useState(today);
  const [amount, setAmount] = useState(
    charge ? decimalMoney(charge.remainingMinor) : "",
  );
  const [method, setMethod] = useState("transfer");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>(charge ? [charge.id] : []);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [extendMonths, setExtendMonths] = useState("12");
  const [created, setCreated] = useState(false);
  const key = useRef(crypto.randomUUID());
  const mutation = useMutation();
  const extension = useMutation();
  const resource = useResource<LeaseDetail>(
    leaseId ? `/api/leases/${leaseId}` : null,
    revision,
  );
  const signature = JSON.stringify({
    leaseId,
    receivedOn,
    amount,
    method,
    notes,
    selected,
  });
  const previewValid = !!preview && previewSignature === signature;
  const choices =
    resource.data?.charges.filter(
      (item) => !item.cancelledAt && item.remainingMinor > 0,
    ) ?? [];
  const leaseLabel = charge
    ? {
        id: charge.leaseId,
        name: `${charge.clientName} · склад № ${charge.warehouseNumber}`,
      }
    : lease
      ? {
          id: lease.id,
          name: `${lease.clientName} · склад № ${lease.warehouseNumber}`,
        }
      : undefined;
  const chooseLease = (id: string) => {
    setLeaseId(id);
    setSelected([]);
    setPreview(null);
    setAmount("");
    key.current = crypto.randomUUID();
  };
  const chooseCharge = (id: string, checked: boolean) => {
    const ids = checked
      ? [...selected, id]
      : selected.filter((item) => item !== id);
    setSelected(ids);
    setPreview(null);
    setAmount(
      ids.length
        ? decimalMoney(
            choices
              .filter((item) => ids.includes(item.id))
              .reduce((sum, item) => sum + item.remainingMinor, 0),
          )
        : "",
    );
  };
  const input = (): PaymentInput => {
    if (!leaseId) throw new Error("Выберите аренду.");
    if (!selected.length)
      throw new Error("Выберите хотя бы один период для оплаты.");
    if (!receivedOn) throw new Error("Укажите дату поступления денег.");
    return {
      leaseId,
      receivedOn,
      amountMinor: parseMoney(amount),
      chargeIds: selected,
      method: method as PaymentInput["method"],
      notes,
    };
  };
  const check = () => {
    void mutation.run(
      () =>
        api<PaymentPreview>("/api/payments/preview", {
          method: "POST",
          body: input(),
        }),
      (result) => {
        setPreview(result);
        setPreviewSignature(signature);
        key.current = crypto.randomUUID();
      },
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!previewValid) {
      check();
      return;
    }
    void mutation.run(
      () =>
        api<PaymentDto>("/api/payments", {
          method: "POST",
          body: { ...input(), idempotencyKey: key.current },
        }),
      () => {
        setCreated(true);
        invalidate();
        notify("Оплата зарегистрирована");
        onClose();
      },
    );
  };
  const extend = () => {
    void extension.run(
      async () => {
        const months = Number(extendMonths);
        if (!Number.isInteger(months) || months < 1 || months > 120)
          throw new Error("Укажите от 1 до 120 месяцев.");
        return api(`/api/leases/${leaseId}/extend-schedule`, {
          method: "POST",
          body: { months },
        });
      },
      () => {
        resource.reload();
        setPreview(null);
        notify("График начислений продлён");
      },
    );
  };
  return (
    <FormDialog
      title="Внести оплату"
      description="Деньги относятся к выбранным расчётным периодам. Можно оплатить часть суммы или несколько месяцев сразу."
      onClose={onClose}
      onSubmit={submit}
      wide
      busy={mutation.busy || extension.busy}
      error={mutation.error}
      dirty={
        !created &&
        (!!amount ||
          !!notes ||
          selected.length > 0 ||
          receivedOn !== today ||
          !!leaseId)
      }
      submitLabel={
        previewValid ? "Зарегистрировать оплату" : "Проверить распределение"
      }
      submitDisabled={!leaseId || resource.loading || !!resource.error}
    >
      <EntityPick
        kind="leases"
        name="leaseId"
        label="Аренда"
        value={leaseId}
        onChange={chooseLease}
        initial={leaseLabel}
        required
      />
      {leaseId && (
        <ResourceBody resource={resource}>
          {(detail) => (
            <>
              <div className="payment-period-heading">
                <strong>Какие периоды оплачиваем</strong>
                <span>Склад № {detail.lease.warehouseNumber}</span>
              </div>
              <FieldMessage name="chargeIds" id="payment-charge-errors" />
              {choices.length ? (
                <div
                  className="payment-periods"
                  role="group"
                  aria-label="Оплачиваемые периоды"
                  aria-describedby="payment-charge-errors"
                >
                  {choices.map((item) => (
                    <div
                      key={item.id}
                      className={`payment-period ${selected.includes(item.id) ? "payment-period--selected" : ""}`}
                    >
                      <Checkbox
                        isSelected={selected.includes(item.id)}
                        onChange={(checked) => chooseCharge(item.id, checked)}
                        aria-label={`Оплатить ${period(item.periodStart, item.periodEnd)}`}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="cell-stack">
                            <strong>
                              {period(item.periodStart, item.periodEnd)}
                            </strong>
                            <span className="cell-secondary">
                              Срок оплаты: {date(item.dueDate)}
                            </span>
                          </span>
                        </Checkbox.Content>
                      </Checkbox>
                      <div className="payment-period__amount">
                        <strong>{money(item.remainingMinor)}</strong>
                        <ChargeBadge charge={item} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="info-note">
                  <Check size={16} />
                  Все созданные периоды оплачены. Для оплаты вперёд продлите
                  график ниже.
                </div>
              )}
              {detail.lease.status !== "ended" && (
                <div className="extend-schedule">
                  <Field
                    name="months"
                    label="Добавить будущие месяцы"
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    value={extendMonths}
                    onChange={setExtendMonths}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    isPending={extension.busy}
                    onPress={extend}
                  >
                    <Plus size={14} />
                    Продлить график
                  </Button>
                  <ErrorNotice error={extension.error} />
                </div>
              )}
            </>
          )}
        </ResourceBody>
      )}
      <div className="form-grid">
        <Field
          name="amountMinor"
          label="Сумма поступления, ₽"
          value={amount}
          onChange={setAmount}
          required
          inputMode="decimal"
          description="Для частичной оплаты уменьшите сумму."
        />
        <Field
          name="receivedOn"
          label="Дата поступления"
          type="date"
          value={receivedOn}
          onChange={setReceivedOn}
          max={today}
          required
        />
      </div>
      <Pick
        name="method"
        label="Способ оплаты"
        value={method}
        onChange={setMethod}
        options={Object.entries(methodNames).map(([id, name]) => ({
          id,
          name,
        }))}
      />
      <Field
        name="notes"
        label="Комментарий"
        value={notes}
        onChange={setNotes}
        multiline
      />
      {previewValid && preview && (
        <div className="payment-preview">
          <h3>
            <ShieldCheck size={18} />
            Проверьте распределение
          </h3>
          <div className="preview-summary">
            <div>
              <span>Поступление</span>
              <strong>{money(preview.amountMinor)}</strong>
            </div>
            <div>
              <span>Остаток выбранных периодов после оплаты</span>
              <strong>{money(preview.remainingAfterMinor)}</strong>
            </div>
          </div>
          {preview.allocations.map((allocation) => (
            <div key={allocation.chargeId} className="preview-allocation">
              <span>
                {period(allocation.periodStart, allocation.periodEnd)}
              </span>
              <strong>{money(allocation.amountMinor)}</strong>
            </div>
          ))}
          <DebtWarning minor={preview.olderDebtMinor} />
          <p>
            Сохранение зарегистрирует фактическое поступление. Повторный клик не
            создаст дубликат.
          </p>
        </div>
      )}
    </FormDialog>
  );
}
