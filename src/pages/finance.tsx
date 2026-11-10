import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Checkbox, Tabs } from "@heroui/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutList,
  Pencil,
  Plus,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import type {
  ChargeDto,
  DashboardDto,
  LeaseDto,
  Page,
  PaymentDto,
  ReportDto,
} from "../../shared/contracts";
import { query, useResource } from "../api";
import { useWorkspace } from "../context";
import { date, inclusiveEnd, money, monthBounds, shiftDays } from "../format";
import {
  BarChart,
  ChargeTable,
  EntityPick,
  LeaseBadge,
  PaymentTable,
  ResourceBody,
} from "../components/business";
import {
  LeaseActionEditor,
  LeaseEditor,
  PaymentEditor,
  ReversalEditor,
} from "../components/editors";
import {
  Back,
  DataTable,
  DateRange,
  Empty,
  goBack,
  PageHeader,
  Pick,
  Pagination,
  SectionHeading,
  SearchBox,
  Stat,
} from "../components/ui";
import { useFilters } from "../hooks/useFilters";

export function DashboardPage() {
  const { today, businessName, revision } = useWorkspace();
  const [range, setRange] = useState(() => monthBounds(today));
  const [paying, setPaying] = useState<ChargeDto | "new" | null>(null);
  const [newLease, setNewLease] = useState(false);
  const resource = useResource<DashboardDto>(
    range.from && range.to && range.from <= range.to
      ? query("/api/dashboard", range)
      : null,
    revision,
  );
  return (
    <>
      <PageHeader
        eyebrow={`${date(today, { weekday: "long" })} · ${businessName}`}
        title="Обзор аренды"
        description="Поступления, ближайшие оплаты и всё, что требует внимания."
        action={
          <>
            <Button variant="secondary" onPress={() => setNewLease(true)}>
              <Plus size={15} />
              Новая аренда
            </Button>
            <Button onPress={() => setPaying("new")}>
              <Banknote size={16} />
              Внести оплату
            </Button>
          </>
        }
      />
      <div className="overview-period">
        <div>
          <strong>Период поступлений</strong>
          <p>Оплаты учитываются по фактической дате получения.</p>
        </div>
        <DateRange {...range} onChange={setRange} />
      </div>
      <ResourceBody resource={resource}>
        {(data) => (
          <>
            <div className="stats-row">
              <Stat
                label="Получено за период"
                value={money(data.totals.receivedMinor)}
                detail={`${date(data.from)} — ${date(data.to)}`}
                tone="accent"
              />
              <Stat
                label="Задолженность"
                value={money(data.totals.overdueMinor)}
                detail="По всем просроченным периодам"
                tone={data.totals.overdueMinor ? "danger" : undefined}
              />
              <Stat
                label="Ожидается за 30 дней"
                value={money(data.totals.upcomingMinor)}
                detail="Начиная с сегодняшнего дня"
              />
              <Stat
                label="Занято складов"
                value={
                  <>
                    {data.totals.occupiedWarehouses}
                    <span className="stat-fraction">
                      {" "}
                      / {data.totals.totalWarehouses}
                    </span>
                  </>
                }
                detail={`${data.totals.activeLeases} действующих аренд`}
              />
            </div>
            {data.totals.totalWarehouses === 0 && (
              <div className="onboarding-strip">
                <div>
                  <span className="onboarding-icon">
                    <Plus size={19} />
                  </span>
                  <div>
                    <strong>Начните с первого склада</strong>
                    <p>
                      Затем добавьте клиента и оформите аренду — здесь появятся
                      реальные цифры и ближайшие оплаты.
                    </p>
                  </div>
                </div>
                <Link className="action-link" to="/warehouses">
                  Добавить склад <ArrowRight size={15} />
                </Link>
              </div>
            )}
            <div className="dashboard-grid">
              <section className="chart-panel">
                <SectionHeading
                  title="Поступления"
                  description="Деньги, фактически полученные за выбранный период"
                  action={
                    <Link className="subtle-link" to="/reports">
                      Подробнее <ArrowRight size={14} />
                    </Link>
                  }
                />
                <BarChart
                  items={data.receiptsByMonth.map((item) => ({
                    label: date(`${item.month}-01`, {
                      day: undefined,
                      year: undefined,
                    }),
                    amountMinor: item.amountMinor,
                  }))}
                  label="Поступления по месяцам"
                />
              </section>
              <section className="occupancy-panel">
                <SectionHeading title="Загрузка складов" />
                <div className="occupancy-visual">
                  <div
                    className="occupancy-ring"
                    style={
                      {
                        "--occupancy": `${data.totals.totalWarehouses ? (data.totals.occupiedWarehouses / data.totals.totalWarehouses) * 100 : 0}%`,
                      } as React.CSSProperties
                    }
                  >
                    <div>
                      <strong>{data.totals.occupiedWarehouses}</strong>
                      <span>занято</span>
                    </div>
                  </div>
                  <div className="occupancy-legend">
                    <p>
                      <span className="legend-dot legend-dot--accent" />
                      Занято<strong>{data.totals.occupiedWarehouses}</strong>
                    </p>
                    <p>
                      <span className="legend-dot" />
                      Без текущей аренды
                      <strong>
                        {data.totals.totalWarehouses -
                          data.totals.occupiedWarehouses}
                      </strong>
                    </p>
                  </div>
                </div>
                <Link className="subtle-link" to="/warehouses">
                  Все склады <ArrowRight size={14} />
                </Link>
              </section>
            </div>
            <section className="dashboard-section">
              <SectionHeading
                title="Ближайшие оплаты"
                description="Неоплаченные периоды, по которым скоро наступит срок"
                action={
                  <Link className="subtle-link" to="/schedule">
                    Весь график <ArrowRight size={14} />
                  </Link>
                }
              />
              {data.upcoming.length ? (
                <div className="table-surface">
                  <ChargeTable
                    items={data.upcoming}
                    onPay={setPaying}
                    compact
                  />
                </div>
              ) : (
                <Empty
                  title="В ближайшее время оплат нет"
                  description="В ближайшие 30 дней нет неоплаченных периодов. Будущие сроки можно посмотреть в графике."
                  icon={<CalendarDays size={25} />}
                />
              )}
            </section>
            <section className="dashboard-section">
              <SectionHeading
                title="Требуют внимания"
                description="До 12 ближайших просроченных обязательств; не зависят от периода поступлений"
                action={
                  <Link className="subtle-link" to="/schedule">
                    Все просрочки <ArrowRight size={14} />
                  </Link>
                }
              />
              {data.overdue.length ? (
                <div className="table-surface">
                  <ChargeTable items={data.overdue} onPay={setPaying} />
                </div>
              ) : (
                <div className="all-clear">
                  <span>
                    <Check size={18} />
                  </span>
                  <div>
                    <strong>Просроченных оплат нет</strong>
                    <p>Все наступившие обязательства закрыты.</p>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </ResourceBody>
      {paying && (
        <PaymentEditor
          charge={paying === "new" ? undefined : paying}
          onClose={() => setPaying(null)}
        />
      )}
      {newLease && <LeaseEditor onClose={() => setNewLease(false)} />}
    </>
  );
}

interface LeaseDetail {
  lease: LeaseDto;
  charges: ChargeDto[];
  payments: PaymentDto[];
}
export function LeaseDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { revision } = useWorkspace();
  const resource = useResource<LeaseDetail>(`/api/leases/${id}`, revision);
  const [action, setAction] = useState<"notes" | "rate" | "close" | null>(null);
  const [paying, setPaying] = useState<ChargeDto | "new" | null>(null);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);
  return (
    <>
      <Back onPress={() => goBack(navigate, "/leases")}>Аренды</Back>
      <ResourceBody resource={resource}>
        {({ lease, charges, payments }) => (
          <>
            <PageHeader
              eyebrow="Карточка аренды"
              title={`Склад № ${lease.warehouseNumber}`}
              description={lease.clientName}
              action={
                <>
                  <Button
                    variant="secondary"
                    onPress={() => setAction("notes")}
                  >
                    <Pencil size={15} />
                    Заметка
                  </Button>
                  <Button onPress={() => setPaying("new")}>
                    <Banknote size={15} />
                    Внести оплату
                  </Button>
                </>
              }
            />
            <div className="lease-summary">
              <div className="lease-summary__main">
                <LeaseBadge lease={lease} />
                <h2>
                  <Link to={`/clients/${lease.clientId}`}>
                    {lease.clientName}
                  </Link>
                </h2>
                <Link
                  to={`/warehouses/${lease.warehouseId}`}
                  className="subtle-link"
                >
                  Склад № {lease.warehouseNumber} <ArrowRight size={13} />
                </Link>
                <p>
                  С {date(lease.startDate)}
                  {lease.endDate
                    ? ` по ${date(inclusiveEnd(lease.endDate))}`
                    : " · без даты окончания"}
                </p>
              </div>
              <Stat
                label="Текущая ставка / месяц"
                value={money(lease.monthlyRateMinor)}
              />
              <Stat
                label="Задолженность"
                value={money(lease.debtMinor)}
                tone={lease.debtMinor ? "danger" : undefined}
              />
              <Stat
                label="Оплачено по"
                value={date(inclusiveEnd(lease.paidThrough))}
                detail={
                  lease.nextDueDate
                    ? `Следующая оплата: ${date(lease.nextDueDate)}`
                    : "Предстоящих оплат нет"
                }
              />
            </div>
            {lease.notes && (
              <div className="detail-note">
                <strong>Заметка к аренде</strong>
                <p>{lease.notes}</p>
              </div>
            )}
            <Tabs className="detail-tabs" defaultSelectedKey="charges">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Информация об аренде">
                  <Tabs.Tab id="charges">
                    Начисления и сроки
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="payments">
                    История оплат
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="rates">
                    Ставки и условия
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="charges">
                {charges.length ? (
                  <div className="table-surface">
                    <ChargeTable
                      items={charges.filter((item) => !item.cancelledAt)}
                      onPay={setPaying}
                    />
                  </div>
                ) : (
                  <Empty title="Начислений пока нет" />
                )}
              </Tabs.Panel>
              <Tabs.Panel id="payments">
                {payments.length ? (
                  <div className="table-surface">
                    <PaymentTable items={payments} onReverse={setReversing} />
                  </div>
                ) : (
                  <Empty
                    title="Оплат ещё нет"
                    description="Зарегистрируйте поступление и укажите, какие периоды оно оплачивает."
                    action={
                      <Button
                        variant="secondary"
                        onPress={() => setPaying("new")}
                      >
                        Внести оплату
                      </Button>
                    }
                  />
                )}
              </Tabs.Panel>
              <Tabs.Panel id="rates">
                <div className="section-heading">
                  <div>
                    <h2>История ставок</h2>
                    <p>Изменения действуют с границы расчётного периода.</p>
                  </div>
                  {lease.status !== "ended" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => setAction("rate")}
                    >
                      Изменить будущую ставку
                    </Button>
                  )}
                </div>
                <div className="table-surface">
                  <DataTable
                    label="Ставки аренды"
                    rows={lease.rates}
                    columns={[
                      {
                        key: "effective",
                        label: "Действует с",
                        render: (row) => date(row.effectiveDate),
                      },
                      {
                        key: "rate",
                        label: "Ставка за месяц",
                        className: "cell-money",
                        render: (row) => money(row.monthlyRateMinor),
                      },
                    ]}
                  />
                </div>
                <p className="field-hint">
                  Условия каждого оплаченного периода хранятся в начислениях.
                  Новая ставка не переписывает финансовую историю.
                </p>
              </Tabs.Panel>
            </Tabs>
            {lease.status !== "ended" && (
              <div className="archive-area">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setAction("close")}
                >
                  Завершить аренду
                </Button>
                <p>
                  Склад освободится с указанной даты. История и задолженность
                  сохранятся.
                </p>
              </div>
            )}
            {action && (
              <LeaseActionEditor
                lease={lease}
                action={action}
                onClose={() => setAction(null)}
              />
            )}
            {paying && (
              <PaymentEditor
                lease={lease}
                charge={paying === "new" ? undefined : paying}
                onClose={() => setPaying(null)}
              />
            )}
          </>
        )}
      </ResourceBody>
      {reversing && (
        <ReversalEditor
          payment={reversing}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

export function PaymentsPage() {
  const { today, revision } = useWorkspace();
  const { params, set, setMany, reset, page } = useFilters();
  const [filterOpen, setFilterOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);
  const range = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
  const resource = useResource<Page<PaymentDto> & { totalMinor: number }>(
    query("/api/payments", {
      ...range,
      search: params.get("search"),
      clientId: params.get("clientId"),
      warehouseId: params.get("warehouseId"),
      includeReversed: params.get("includeReversed") === "true",
      method: params.get("method") ?? "all",
      page,
      pageSize: 25,
    }),
    revision,
  );
  const setRange = (value: { from: string; to: string }) => setMany(value);
  return (
    <>
      <PageHeader
        eyebrow="Фактические поступления"
        title="Оплаты"
        description="История полученных денег и распределение по периодам аренды."
        action={
          <Button onPress={() => setPaying(true)}>
            <Banknote size={16} />
            Внести оплату
          </Button>
        }
      />
      <div className="list-toolbar">
        <SearchBox
          value={params.get("search") ?? ""}
          onChange={(value) => set("search", value)}
          placeholder="Клиент, склад или комментарий"
        />
        <div className="toolbar-actions">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setFilterOpen((value) => !value)}
          >
            <SlidersHorizontal size={14} />
            Фильтры
          </Button>
          {(range.from ||
            range.to ||
            params.get("clientId") ||
            params.get("warehouseId") || params.get("method")) && (
            <Button size="sm" variant="ghost" onPress={reset}>
              Сбросить
            </Button>
          )}
        </div>
      </div>
      {filterOpen && (
        <div className="filter-panel">
          <DateRange {...range} onChange={setRange} />
          <div className="form-grid">
            <EntityPick
              kind="clients"
              label="Клиент"
              value={params.get("clientId") ?? ""}
              onChange={(value) => set("clientId", value)}
            />
            <EntityPick
              kind="warehouses"
              label="Склад"
              value={params.get("warehouseId") ?? ""}
              onChange={(value) => set("warehouseId", value)}
            />
          </div>
          <Pick label="Способ оплаты" value={params.get("method") ?? "all"} onChange={(value)=>set("method",value)} options={[{id:'all',name:'Все способы'},{id:'cash',name:'Наличные'},{id:'transfer',name:'Перевод'},{id:'other',name:'Другое'}]} />
          <Checkbox
            isSelected={params.get("includeReversed") === "true"}
            onChange={(value) => set("includeReversed", String(value))}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Показывать сторнированные оплаты
            </Checkbox.Content>
          </Checkbox>
          <p className="field-hint">
            Даты относятся к получению денег. Сегодня: {date(today)}.
          </p>
        </div>
      )}
      <ResourceBody resource={resource}>
        {(data) => (
          <>
            <div className="register-summary">
              <span>Получено по выбранным условиям</span>
              <strong>{money(data.totalMinor)}</strong>
              <span className="text-muted">
                Сторнированные оплаты не включены в сумму
              </span>
            </div>
            {data.items.length ? (
              <div className="table-surface">
                <PaymentTable items={data.items} onReverse={setReversing} />
                <Pagination
                  page={data}
                  onChange={(value) => set("page", String(value))}
                />
              </div>
            ) : (
              <Empty
                title="Оплаты не найдены"
                description="Внесите первое поступление или измените условия поиска."
                action={
                  <Button variant="secondary" onPress={() => setPaying(true)}>
                    Внести оплату
                  </Button>
                }
              />
            )}
          </>
        )}
      </ResourceBody>
      {paying && <PaymentEditor onClose={() => setPaying(false)} />}
      {reversing && (
        <ReversalEditor
          payment={reversing}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

interface ScheduleDto {
  items: ChargeDto[];
  overdue: ChargeDto[];
}
export function SchedulePage() {
  const { today, revision } = useWorkspace();
  const [month, setMonth] = useState(() => monthBounds(today).from);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [clientId, setClientId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [filters, setFilters] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [paying, setPaying] = useState<ChargeDto | null>(null);
  const range = monthBounds(month);
  const resource = useResource<ScheduleDto>(
    query("/api/schedule", { ...range, clientId, warehouseId }),
    revision,
  );
  const calendarStart = shiftDays(
    range.from,
    -((new Date(`${range.from}T12:00:00Z`).getUTCDay() + 6) % 7),
  );
  const totalDays =
    Number(range.to.slice(8, 10)) +
    ((new Date(`${range.from}T12:00:00Z`).getUTCDay() + 6) % 7);
  const cells = Array.from({ length: Math.ceil(totalDays / 7) * 7 }, (_, i) =>
    shiftDays(calendarStart, i),
  );
  return (
    <>
      <PageHeader
        eyebrow="Сроки и обязательства"
        title="График платежей"
        description="Когда и за какой склад должна поступить оплата."
      />
      <div className="payment-calendar-toolbar">
        <div className="payment-calendar-month">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Предыдущий месяц"
            onPress={() => {
              setMonth(monthBounds(month, -1).from);
              setSelectedDay(null);
            }}
          >
            <ChevronLeft size={18} />
          </Button>
          <h2>{date(month, { day: undefined, month: "long" })}</h2>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Следующий месяц"
            onPress={() => {
              setMonth(monthBounds(month, 1).from);
              setSelectedDay(null);
            }}
          >
            <ChevronRight size={18} />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setMonth(monthBounds(today).from);
              setSelectedDay(today);
            }}
          >
            Сегодня
          </Button>
        </div>
        <div className="toolbar-actions">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setFilters((value) => !value)}
          >
            <SlidersHorizontal size={14} />
            Фильтры
          </Button>
          <div className="view-toggle" aria-label="Отображение графика">
            <Button
              size="sm"
              variant={view === "calendar" ? "secondary" : "ghost"}
              aria-pressed={view === "calendar"}
              onPress={() => setView("calendar")}
            >
              <CalendarDays size={15} />
              Календарь
            </Button>
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-pressed={view === "list"}
              onPress={() => setView("list")}
            >
              <LayoutList size={15} />
              Список
            </Button>
          </div>
        </div>
      </div>
      {filters && (
        <div className="filter-panel form-grid">
          <EntityPick
            kind="clients"
            label="Клиент"
            value={clientId}
            onChange={setClientId}
          />
          <EntityPick
            kind="warehouses"
            label="Склад"
            value={warehouseId}
            onChange={setWarehouseId}
          />
          {(clientId || warehouseId) && (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setClientId("");
                setWarehouseId("");
              }}
            >
              Сбросить фильтры
            </Button>
          )}
        </div>
      )}
      <ResourceBody resource={resource}>
        {(data) => (
          <>
            {view === "calendar" ? (
              <>
                <div className="payment-calendar">
                  <div className="payment-calendar__weekdays">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  <div className="payment-calendar__grid">
                    {cells.map((day) => {
                      const items = data.items.filter(
                        (item) => item.dueDate === day,
                      );
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`payment-calendar__day ${day.slice(0, 7) !== month.slice(0, 7) ? "payment-calendar__day--outside" : ""} ${day === today ? "payment-calendar__day--today" : ""} ${day === selectedDay ? "payment-calendar__day--selected" : ""}`}
                          aria-label={`${date(day)}. Платежей: ${items.length}`}
                          aria-pressed={day === selectedDay}
                          onClick={() => {
                            if (day.slice(0, 7) !== month.slice(0, 7))
                              setMonth(monthBounds(day).from);
                            setSelectedDay(day);
                          }}
                        >
                          <span className="payment-calendar__number">
                            {Number(day.slice(8))}
                          </span>
                          <span className="payment-calendar__events">
                            {items.slice(0, 3).map((item) => (
                              <span
                                key={item.id}
                                className={`payment-calendar-event payment-calendar-event--${item.status}`}
                              >
                                <span>№ {item.warehouseNumber}</span>
                                <strong>
                                  {money(
                                    item.remainingMinor || item.amountMinor,
                                  )}
                                </strong>
                              </span>
                            ))}
                            {items.length > 3 && (
                              <span className="payment-calendar__more">
                                Ещё {items.length - 3}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="payment-calendar-legend">
                  <span>
                    <i className="legend-dot legend-dot--accent" />
                    Предстоит
                  </span>
                  <span>
                    <i className="legend-dot legend-dot--warning" />
                    Сегодня / частично
                  </span>
                  <span>
                    <i className="legend-dot legend-dot--danger" />
                    Просрочено
                  </span>
                  <span>
                    <i className="legend-dot legend-dot--success" />
                    Оплачено
                  </span>
                </div>
                {selectedDay && (
                  <section className="dashboard-section">
                    <SectionHeading
                      title={`Платежи на ${date(selectedDay)}`}
                      action={
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => setSelectedDay(null)}
                        >
                          Свернуть
                        </Button>
                      }
                    />
                    {data.items.some((item) => item.dueDate === selectedDay) ? (
                      <div className="table-surface">
                        <ChargeTable
                          items={data.items.filter(
                            (item) => item.dueDate === selectedDay,
                          )}
                          onPay={setPaying}
                        />
                      </div>
                    ) : (
                      <Empty title="На эту дату платежей нет" />
                    )}
                  </section>
                )}
              </>
            ) : data.items.length ? (
              <div className="table-surface">
                <ChargeTable items={data.items} onPay={setPaying} />
              </div>
            ) : (
              <Empty
                title="В этом месяце платежей нет"
                description="Переключите месяц или измените фильтры."
              />
            )}
            <section className="dashboard-section">
              <SectionHeading
                title="Просроченные обязательства"
                description="Все непогашенные просроченные периоды, в том числе за прошлые месяцы"
              />
              {data.overdue.length ? (
                <div className="table-surface">
                  <ChargeTable items={data.overdue} onPay={setPaying} />
                </div>
              ) : (
                <div className="all-clear">
                  <span>
                    <Check size={18} />
                  </span>
                  <strong>Просроченных оплат нет</strong>
                </div>
              )}
            </section>
          </>
        )}
      </ResourceBody>
      {paying && (
        <PaymentEditor charge={paying} onClose={() => setPaying(null)} />
      )}
    </>
  );
}

export function ReportsPage() {
  const { today, revision } = useWorkspace();
  const [range, setRange] = useState(() => monthBounds(today));
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const resource = useResource<ReportDto>(
    valid ? query("/api/reports/receipts", range) : null,
    revision,
  );
  const thisYear = () =>
    setRange({ from: `${today.slice(0, 4)}-01-01`, to: today });
  return (
    <>
      <PageHeader
        eyebrow="Финансовая картина"
        title="Поступления"
        description="Фактически полученные деньги за выбранный период. Без сторнированных оплат."
        action={
          valid && (
            <a
              href={query("/api/reports/receipts.csv", range)}
              download
              className="download-button"
            >
              <ArrowDownToLine size={16} />
              Скачать CSV
            </a>
          )
        }
      />
      <div className="report-period">
        <DateRange {...range} onChange={setRange} />
        <div className="quick-periods">
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setRange(monthBounds(today))}
          >
            Этот месяц
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setRange(monthBounds(today, -1))}
          >
            Прошлый месяц
          </Button>
          <Button size="sm" variant="ghost" onPress={thisYear}>
            С начала года
          </Button>
        </div>
      </div>
      {!valid && (
        <div className="info-note">
          Выберите корректный период: начало не должно быть позже окончания.
        </div>
      )}
      <ResourceBody resource={resource}>
        {(report) => (
          <>
            <div className="report-total">
              <span className="report-total__icon">
                <TrendingUp size={25} />
              </span>
              <div>
                <p>Получено за период</p>
                <strong>{money(report.totalMinor)}</strong>
                <span>
                  {date(report.from)} — {date(report.to)}
                </span>
              </div>
              <p>
                Это поступления по дате получения,
                <br />а не прибыль и не начисленная аренда.
              </p>
            </div>
            <section className="report-chart">
              <SectionHeading title="Динамика поступлений" />
              <BarChart
                items={report.byMonth}
                label="Поступления по месяцам"
                large
              />
            </section>
            <div className="report-breakdowns">
              <section>
                <SectionHeading title="По складам" />
                {report.byWarehouse.length ? (
                  <div className="ranking-list">
                    {report.byWarehouse.map((item) => (
                      <Link to={`/warehouses/${item.id}`} key={item.id}>
                        <span className="ranking-icon">
                          <FileText size={16} />
                        </span>
                        <span>{item.label}</span>
                        <strong>{money(item.amountMinor)}</strong>
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty title="Нет поступлений по складам" />
                )}
              </section>
              <section>
                <SectionHeading title="По клиентам" />
                {report.byClient.length ? (
                  <div className="ranking-list">
                    {report.byClient.map((item) => (
                      <Link to={`/clients/${item.id}`} key={item.id}>
                        <span>{item.label}</span>
                        <strong>{money(item.amountMinor)}</strong>
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty title="Нет поступлений по клиентам" />
                )}
              </section>
            </div>
          </>
        )}
      </ResourceBody>
    </>
  );
}
