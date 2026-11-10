import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@heroui/react";
import { ArrowUpRight, Banknote, ChevronDown, CircleAlert } from "lucide-react";
import type {
  ChargeDto,
  ClientDto,
  LeaseDto,
  Page,
  PaymentDto,
  WarehouseDto,
} from "../../shared/contracts";
import { query, useResource } from "../api";
import { useWorkspace } from "../context";
import {
  chargeNames,
  date,
  leaseNames,
  methodNames,
  money,
  period,
} from "../format";
import {
  Badge,
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  Pick,
  SearchBox,
} from "./ui";

export function ChargeBadge({ charge }: { charge: ChargeDto }) {
  return (
    <Badge
      color={
        charge.status === "paid"
          ? "success"
          : charge.status === "overdue"
            ? "danger"
            : charge.status === "today" || charge.status === "partial"
              ? "warning"
              : "default"
      }
    >
      {chargeNames[charge.status]}
    </Badge>
  );
}
export function LeaseBadge({ lease }: { lease: LeaseDto }) {
  return (
    <Badge
      color={
        lease.status === "active"
          ? "success"
          : lease.status === "scheduled"
            ? "accent"
            : "default"
      }
    >
      {leaseNames[lease.status]}
    </Badge>
  );
}
export function ChargeTable({
  items,
  onPay,
  compact = false,
}: {
  items: ChargeDto[];
  onPay: (charge: ChargeDto) => void;
  compact?: boolean;
}) {
  return (
    <DataTable
      label="Начисления по аренде"
      rows={items}
      columns={[
        {
          key: "client",
          label: "Клиент / склад",
          render: (row) => (
            <div className="cell-stack">
              <Link className="entity-link" to={`/clients/${row.clientId}`}>
                {row.clientName}
              </Link>
              <Link
                className="cell-secondary"
                to={`/warehouses/${row.warehouseId}`}
              >
                Склад № {row.warehouseNumber}
              </Link>
            </div>
          ),
        },
        ...(!compact
          ? [
              {
                key: "period",
                label: "Период аренды",
                render: (row: ChargeDto) => (
                  <span className="nowrap">
                    {period(row.periodStart, row.periodEnd)}
                  </span>
                ),
              },
            ]
          : []),
        {
          key: "due",
          label: "Срок оплаты",
          render: (row) => (
            <span
              className={row.status === "overdue" ? "text-danger" : "nowrap"}
            >
              {date(row.dueDate)}
            </span>
          ),
        },
        {
          key: "remaining",
          label: "К оплате",
          className: "cell-money",
          render: (row) => (
            <div className="cell-stack">
              <strong>{money(row.remainingMinor)}</strong>
              {row.paidMinor > 0 && row.remainingMinor > 0 && (
                <span className="cell-secondary">
                  из {money(row.amountMinor)}
                </span>
              )}
            </div>
          ),
        },
        {
          key: "status",
          label: "Статус",
          render: (row) => <ChargeBadge charge={row} />,
        },
        {
          key: "action",
          label: "Действие",
          className: "cell-action",
          render: (row) =>
            row.remainingMinor > 0 ? (
              <Button size="sm" variant="secondary" onPress={() => onPay(row)}>
                <Banknote size={14} />
                Внести оплату
              </Button>
            ) : (
              <Link to={`/leases/${row.leaseId}`} className="subtle-link">
                Аренда <ArrowUpRight size={13} />
              </Link>
            ),
        },
      ]}
    />
  );
}
export function LeaseTable({ items }: { items: LeaseDto[] }) {
  return (
    <DataTable
      label="Договоры аренды"
      rows={items}
      columns={[
        {
          key: "client",
          label: "Клиент",
          render: (row) => (
            <Link className="entity-link" to={`/clients/${row.clientId}`}>
              {row.clientName}
            </Link>
          ),
        },
        {
          key: "warehouse",
          label: "Склад",
          render: (row) => (
            <Link to={`/leases/${row.id}`} className="warehouse-link">
              № {row.warehouseNumber}
              <ArrowUpRight size={13} />
            </Link>
          ),
        },
        {
          key: "period",
          label: "Срок аренды",
          render: (row) => (
            <div className="cell-stack">
              <span>с {date(row.startDate)}</span>
              <span className="cell-secondary">
                {row.releasedOn
                  ? `${row.startDate > row.releasedOn ? "Отменена" : "Освобождён"} ${date(row.releasedOn)}`
                  : "Бессрочно"}
              </span>
            </div>
          ),
        },
        {
          key: "rate",
          label: "Ставка / месяц",
          className: "cell-money",
          render: (row) => money(row.monthlyRateMinor),
        },
        {
          key: "debt",
          label: "Задолженность",
          className: "cell-money",
          render: (row) => (
            <span className={row.debtMinor ? "text-danger" : "text-muted"}>
              {row.debtMinor ? money(row.debtMinor) : "Нет"}
            </span>
          ),
        },
        {
          key: "status",
          label: "Статус",
          render: (row) => <LeaseBadge lease={row} />,
        },
        {
          key: "open",
          label: "Карточка",
          className: "cell-action",
          render: (row) => (
            <Link className="subtle-link" to={`/leases/${row.id}`}>
              Открыть <ArrowUpRight size={13} />
            </Link>
          ),
        },
      ]}
    />
  );
}
export function PaymentTable({
  items,
  onReverse,
}: {
  items: PaymentDto[];
  onReverse?: (payment: PaymentDto) => void;
}) {
  return (
    <DataTable
      label="История оплат"
      rows={items}
      columns={[
        {
          key: "date",
          label: "Получено",
          render: (row) => (
            <div className="cell-stack">
              <strong>{date(row.receivedOn)}</strong>
              <span className="cell-secondary">{methodNames[row.method]}</span>
            </div>
          ),
        },
        {
          key: "client",
          label: "Клиент / склад",
          render: (row) => (
            <div className="cell-stack">
              <Link className="entity-link" to={`/clients/${row.clientId}`}>
                {row.clientName}
              </Link>
              <Link className="cell-secondary" to={`/leases/${row.leaseId}`}>
                Склад № {row.warehouseNumber}
              </Link>
            </div>
          ),
        },
        {
          key: "period",
          label: "За какой срок",
          render: (row) => (
            <div className="cell-stack">
              {row.allocations.map((allocation) => (
                <span key={allocation.chargeId} className="allocation-line">
                  {period(allocation.periodStart, allocation.periodEnd)}
                  <span className="cell-secondary">
                    {money(allocation.amountMinor)}
                  </span>
                </span>
              ))}
              {row.notes && (
                <span className="cell-secondary cell-note">{row.notes}</span>
              )}
            </div>
          ),
        },
        {
          key: "amount",
          label: "Сумма",
          className: "cell-money",
          render: (row) => (
            <strong className={row.reversedAt ? "reversed-money" : ""}>
              {money(row.amountMinor)}
            </strong>
          ),
        },
        {
          key: "state",
          label: "Статус",
          render: (row) =>
            row.reversedAt ? (
              <div className="cell-stack">
                <Badge>Сторнировано</Badge>
                <span className="cell-secondary cell-note">
                  {row.reversalReason}
                </span>
              </div>
            ) : (
              <Badge color="success">Учтено</Badge>
            ),
        },
        ...(onReverse
          ? [
              {
                key: "reverse",
                label: "Действие",
                className: "cell-action",
                render: (row: PaymentDto) =>
                  !row.reversedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => onReverse(row)}
                    >
                      Сторнировать
                    </Button>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}

type ChoiceKind = "clients" | "warehouses" | "leases";
type ChoiceItem = ClientDto | WarehouseDto | LeaseDto;
function choiceName(kind: ChoiceKind, item: ChoiceItem) {
  return kind === "clients"
    ? (item as ClientDto).name
    : kind === "warehouses"
      ? `№ ${(item as WarehouseDto).number}${(item as WarehouseDto).address ? ` · ${(item as WarehouseDto).address}` : ""}`
      : `${(item as LeaseDto).clientName} · склад № ${(item as LeaseDto).warehouseNumber}`;
}
export function EntityPick({
  kind,
  label,
  name,
  value,
  onChange,
  required,
  initial,
  extra = {},
}: {
  kind: ChoiceKind;
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  initial?: { id: string; name: string };
  extra?: Record<string, string>;
}) {
  const { revision } = useWorkspace();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [choices, setChoices] = useState<{ id: string; name: string }[]>(
    initial ? [initial] : [],
  );
  const extraKey = JSON.stringify(extra);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const resource = useResource<Page<ChoiceItem>>(
    query(`/api/${kind}`, {
      ...(JSON.parse(extraKey) as Record<string, string>),
      search: debounced,
      page,
      pageSize: 100,
    }),
    revision,
  );
  useEffect(() => {
    if (!resource.data) return;
    const next = resource.data.items.map((item) => ({
      id: item.id,
      name: choiceName(kind, item),
    }));
    setChoices((previous) => {
      const retained =
        page === 1 ? previous.filter((item) => item.id === value) : previous;
      return [
        ...retained.filter(
          (item) => !next.some((entry) => entry.id === item.id),
        ),
        ...next,
      ];
    });
  }, [resource.data, kind, page, value]);
  return (
    <div className="entity-picker">
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder={`Найти: ${label.toLowerCase()}`}
      />
      <Pick
        name={name}
        label={label}
        value={value}
        onChange={onChange}
        required={required}
        options={choices}
        disabled={resource.loading && !choices.length}
        placeholder={resource.loading ? "Загрузка…" : "Выберите из списка"}
      />
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {!resource.loading && !resource.error && resource.data?.total === 0 && (
        <p className="field-hint">
          Ничего не найдено. Сначала добавьте запись в соответствующем разделе.
        </p>
      )}
      {resource.data && page * resource.data.pageSize < resource.data.total && (
        <Button
          size="sm"
          variant="ghost"
          isPending={resource.loading}
          onPress={() => setPage((current) => current + 1)}
        >
          <ChevronDown size={14} />
          Загрузить ещё варианты
        </Button>
      )}
    </div>
  );
}

export function BarChart({
  items,
  label,
  large = false,
}: {
  items: { label: string; amountMinor: number }[];
  label: string;
  large?: boolean;
}) {
  if (!items.length || items.every((item) => item.amountMinor === 0))
    return (
      <Empty
        title="Пока нет поступлений"
        description="График появится после первой зарегистрированной оплаты."
      />
    );
  const max = Math.max(...items.map((item) => item.amountMinor), 1);
  const width = Math.max(500, items.length * 66);
  const height = large ? 270 : 220;
  const baseline = height - 35;
  const chartHeight = height - 65;
  const unit = (width - 32) / items.length;
  return (
    <div className="chart-scroll">
      <svg
        className="bar-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        {[0, 0.5, 1].map((part) => (
          <g key={part}>
            <line
              x1="8"
              x2={width - 8}
              y1={baseline - chartHeight * part}
              y2={baseline - chartHeight * part}
              className="chart-grid"
            />
            <text
              x={width - 12}
              y={baseline - chartHeight * part - 7}
              textAnchor="end"
              className="chart-tick"
            >
              {money(Math.round(max * part))}
            </text>
          </g>
        ))}
        {items.map((item, i) => {
          const barHeight = (item.amountMinor / max) * chartHeight;
          const x = 16 + i * unit + unit * 0.25;
          return (
            <g key={`${item.label}-${i}`}>
              <title>
                {item.label}: {money(item.amountMinor)}
              </title>
              <rect
                x={x}
                y={baseline - barHeight}
                width={unit * 0.5}
                height={Math.max(1, barHeight)}
                rx="4"
                className="chart-bar"
              />
              <text
                x={x + unit * 0.25}
                y={height - 13}
                textAnchor="middle"
                className="chart-label"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="sr-only">
        {items.map((item) => (
          <p key={item.label}>
            {item.label}: {money(item.amountMinor)}
          </p>
        ))}
      </div>
    </div>
  );
}
export function ResourceBody<T>({
  resource,
  children,
}: {
  resource: {
    data: T | null;
    loading: boolean;
    error: Error | null;
    reload: () => void;
  };
  children: (value: T) => React.ReactNode;
}) {
  if (resource.loading) return <Loading />;
  if (resource.error)
    return <ErrorNotice error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <Empty title="Нет данных" />;
  return <>{children(resource.data)}</>;
}
export function DebtWarning({ minor }: { minor: number }) {
  return minor > 0 ? (
    <div className="inline-warning">
      <CircleAlert size={16} />
      <span>
        Есть более ранняя задолженность: <strong>{money(minor)}</strong>. Она не
        входит в выбранное распределение.
      </span>
    </div>
  ) : null;
}
