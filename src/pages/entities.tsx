import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useFilters } from "../hooks/useFilters";
import { Button, Tabs } from "@heroui/react";
import {
  Archive,
  ArrowUpRight,
  Building2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Users,
} from "lucide-react";
import type {
  ChargeDto,
  ClientDto,
  LeaseDto,
  Page,
  PaymentDto,
  WarehouseDto,
} from "../../shared/contracts";
import { api, query, useMutation, useResource } from "../api";
import { useWorkspace } from "../context";
import { date, initials, money } from "../format";
import {
  ChargeTable,
  LeaseTable,
  PaymentTable,
  ResourceBody,
} from "../components/business";
import {
  ClientEditor,
  LeaseEditor,
  PaymentEditor,
  ReversalEditor,
  WarehouseEditor,
} from "../components/editors";
import {
  Back,
  Badge,
  Confirm,
  DataTable,
  Empty,
  goBack,
  PageHeader,
  Pagination,
  Pick,
  SearchBox,
  Stat,
} from "../components/ui";

export function ClientsPage() {
  const { revision } = useWorkspace();
  const { params, set, page } = useFilters();
  const [editor, setEditor] = useState(false);
  const resource = useResource<Page<ClientDto>>(
    query("/api/clients", {
      search: params.get("search"),
      archived: params.get("archived") === "true",
      debt: params.get("debt") === "true",
      page,
      pageSize: 25,
    }),
    revision,
  );
  return (
    <>
      <PageHeader
        eyebrow="Арендаторы"
        title="Клиенты"
        description="Контакты, действующие аренды и расчёты с каждым клиентом."
        action={
          <Button onPress={() => setEditor(true)}>
            <Plus size={16} />
            Добавить клиента
          </Button>
        }
      />
      <div className="list-toolbar">
        <SearchBox
          value={params.get("search") ?? ""}
          onChange={(value) => set("search", value)}
          placeholder="Имя, организация или телефон"
        />
        <div className="toolbar-filters">
          <Pick
            label="Список клиентов"
            value={params.get("archived") === "true" ? "true" : "false"}
            onChange={(value) => set("archived", value)}
            options={[
              { id: "false", name: "Действующие" },
              { id: "true", name: "Архив" },
            ]}
          />
          <Pick
            label="Задолженность"
            value={params.get("debt") === "true" ? "true" : "false"}
            onChange={(value) => set("debt", value)}
            options={[
              { id: "false", name: "Все клиенты" },
              { id: "true", name: "Есть задолженность" },
            ]}
          />
        </div>
      </div>
      <ResourceBody resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="table-surface">
              <DataTable
                label="Клиенты"
                rows={data.items}
                columns={[
                  {
                    key: "name",
                    label: "Клиент",
                    render: (row) => (
                      <Link className="client-cell" to={`/clients/${row.id}`}>
                        <span className="avatar">{initials(row.name)}</span>
                        <span className="cell-stack">
                          <strong>{row.name}</strong>
                          <span className="cell-secondary">
                            {row.contact || row.email || "Контакт не указан"}
                          </span>
                        </span>
                      </Link>
                    ),
                  },
                  {
                    key: "phone",
                    label: "Телефон",
                    render: (row) =>
                      row.phone ? (
                        <a
                          className="subtle-link"
                          href={`tel:${row.phone.replace(/[^\d+]/g, "")}`}
                        >
                          {row.phone}
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      ),
                  },
                  {
                    key: "leases",
                    label: "Аренды",
                    render: (row) => (
                      <span>{row.activeLeases} действующих</span>
                    ),
                  },
                  {
                    key: "rate",
                    label: "Ставка / месяц",
                    className: "cell-money",
                    render: (row) => money(row.monthlyRateMinor),
                  },
                  {
                    key: "due",
                    label: "Ближайшая оплата",
                    render: (row) => date(row.nextDueDate),
                  },
                  {
                    key: "debt",
                    label: "Долг",
                    className: "cell-money",
                    render: (row) =>
                      row.debtMinor ? (
                        <strong className="text-danger">
                          {money(row.debtMinor)}
                        </strong>
                      ) : (
                        <span className="text-muted">Нет</span>
                      ),
                  },
                  {
                    key: "open",
                    label: "Карточка",
                    className: "cell-action",
                    render: (row) => (
                      <Link
                        className="icon-link"
                        aria-label={`Открыть клиента ${row.name}`}
                        to={`/clients/${row.id}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    ),
                  },
                ]}
              />
              <Pagination
                page={data}
                onChange={(value) => set("page", String(value))}
              />
            </div>
          ) : (
            <Empty
              icon={<Users size={28} />}
              title={
                params.get("search") || params.get("debt") === "true"
                  ? "Клиенты не найдены"
                  : params.get("archived") === "true"
                    ? "Архив пока пуст"
                    : "Добавьте первого клиента"
              }
              description="У каждого клиента будут свои склады, условия аренды и история оплат."
              action={
                params.get("archived") !== "true" && (
                  <Button variant="secondary" onPress={() => setEditor(true)}>
                    <Plus size={15} />
                    Добавить клиента
                  </Button>
                )
              }
            />
          )
        }
      </ResourceBody>
      {editor && <ClientEditor onClose={() => setEditor(false)} />}
    </>
  );
}

export function WarehousesPage() {
  const { revision } = useWorkspace();
  const { params, set, page } = useFilters();
  const [editor, setEditor] = useState(false);
  const resource = useResource<Page<WarehouseDto>>(
    query("/api/warehouses", {
      search: params.get("search"),
      archived: params.get("archived") === "true",
      occupancy: params.get("occupancy") ?? "all",
      page,
      pageSize: 25,
    }),
    revision,
  );
  return (
    <>
      <PageHeader
        eyebrow="Помещения"
        title="Склады"
        description="Все помещения, текущая занятость и запланированные аренды."
        action={
          <Button onPress={() => setEditor(true)}>
            <Plus size={16} />
            Добавить склад
          </Button>
        }
      />
      <div className="list-toolbar">
        <SearchBox
          value={params.get("search") ?? ""}
          onChange={(value) => set("search", value)}
          placeholder="Номер или адрес склада"
        />
        <div className="toolbar-filters">
          <Pick
            label="Занятость"
            value={params.get("occupancy") ?? "all"}
            onChange={(value) => set("occupancy", value)}
            options={[
              { id: "all", name: "Все склады" },
              { id: "occupied", name: "Занятые" },
              { id: "free", name: "Свободные" },
            ]}
          />
          <Pick
            label="Состояние записи"
            value={params.get("archived") === "true" ? "true" : "false"}
            onChange={(value) => set("archived", value)}
            options={[
              { id: "false", name: "Действующие" },
              { id: "true", name: "Архив" },
            ]}
          />
        </div>
      </div>
      <ResourceBody resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="table-surface">
              <DataTable
                label="Склады"
                rows={data.items}
                columns={[
                  {
                    key: "number",
                    label: "Склад",
                    render: (row) => (
                      <Link
                        className="client-cell"
                        to={`/warehouses/${row.id}`}
                      >
                        <span className="warehouse-avatar">
                          <Building2 size={20} />
                        </span>
                        <span className="cell-stack">
                          <strong>№ {row.number}</strong>
                          <span className="cell-secondary">
                            {row.area == null
                              ? "Площадь не указана"
                              : `${row.area} м²`}
                          </span>
                        </span>
                      </Link>
                    ),
                  },
                  {
                    key: "address",
                    label: "Расположение",
                    render: (row) =>
                      row.address || <span className="text-muted">—</span>,
                  },
                  {
                    key: "state",
                    label: "Статус",
                    render: (row) =>
                      row.availability === "maintenance" ? (
                        <Badge color="warning">Обслуживание</Badge>
                      ) : row.currentLease ? (
                        <Badge color="accent">Занят</Badge>
                      ) : (
                        <Badge color="success">Свободен</Badge>
                      ),
                  },
                  {
                    key: "client",
                    label: "Арендатор",
                    render: (row) =>
                      row.currentLease ? (
                        <Link
                          to={`/clients/${row.currentLease.clientId}`}
                          className="entity-link"
                        >
                          {row.currentLease.clientName}
                        </Link>
                      ) : row.nextLease ? (
                        <div className="cell-stack">
                          <Link
                            to={`/clients/${row.nextLease.clientId}`}
                            className="entity-link"
                          >
                            {row.nextLease.clientName}
                          </Link>
                          <span className="cell-secondary">
                            Заезд {date(row.nextLease.startDate)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted">Без арендатора</span>
                      ),
                  },
                  {
                    key: "rate",
                    label: "Ставка / месяц",
                    className: "cell-money",
                    render: (row) =>
                      row.currentLease
                        ? money(row.currentLease.monthlyRateMinor)
                        : "—",
                  },
                  {
                    key: "due",
                    label: "Ближайшая оплата",
                    render: (row) =>
                      date(
                        row.currentLease?.nextDueDate ??
                          row.nextLease?.nextDueDate,
                      ),
                  },
                  {
                    key: "open",
                    label: "Карточка",
                    className: "cell-action",
                    render: (row) => (
                      <Link
                        className="icon-link"
                        aria-label={`Открыть склад ${row.number}`}
                        to={`/warehouses/${row.id}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    ),
                  },
                ]}
              />
              <Pagination
                page={data}
                onChange={(value) => set("page", String(value))}
              />
            </div>
          ) : (
            <Empty
              icon={<Building2 size={28} />}
              title={
                params.get("search") ||
                (params.get("occupancy") && params.get("occupancy") !== "all")
                  ? "Склады не найдены"
                  : params.get("archived") === "true"
                    ? "Архив пока пуст"
                    : "Добавьте первый склад"
              }
              description="Укажите номер и характеристики. Стоимость аренды можно настроить для каждого клиента."
              action={
                params.get("archived") !== "true" && (
                  <Button variant="secondary" onPress={() => setEditor(true)}>
                    <Plus size={15} />
                    Добавить склад
                  </Button>
                )
              }
            />
          )
        }
      </ResourceBody>
      {editor && <WarehouseEditor onClose={() => setEditor(false)} />}
    </>
  );
}

interface ClientDetail {
  client: ClientDto;
  leases: LeaseDto[];
  charges: ChargeDto[];
  payments: PaymentDto[];
}
interface WarehouseDetail {
  warehouse: WarehouseDto;
  leases: LeaseDto[];
  charges: ChargeDto[];
  payments: PaymentDto[];
}

export function ClientDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { revision, invalidate, notify } = useWorkspace();
  const resource = useResource<ClientDetail>(`/api/clients/${id}`, revision);
  const [editing, setEditing] = useState(false);
  const [newLease, setNewLease] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [paying, setPaying] = useState<ChargeDto | null>(null);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);
  const mutation = useMutation();
  return (
    <>
      <Back onPress={() => goBack(navigate, "/clients")}>Клиенты</Back>
      <ResourceBody resource={resource}>
        {({ client, leases, charges, payments }) => (
          <>
            <PageHeader
              eyebrow={
                client.archivedAt ? "Клиент в архиве" : "Карточка клиента"
              }
              title={client.name}
              description={
                client.contact || "Контакты, аренды и история расчётов."
              }
              action={
                !client.archivedAt && (
                  <>
                    <Button
                      variant="secondary"
                      onPress={() => setEditing(true)}
                    >
                      <Pencil size={15} />
                      Редактировать
                    </Button>
                    <Button onPress={() => setNewLease(true)}>
                      <Plus size={16} />
                      Оформить аренду
                    </Button>
                  </>
                )
              }
            />
            <div className="detail-overview">
              <div className="detail-contact">
                <span className="avatar avatar--large">
                  {initials(client.name)}
                </span>
                <div>
                  <strong>{client.contact || client.name}</strong>
                  <p>
                    {client.phone ? (
                      <a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}>
                        <Phone size={13} />
                        {client.phone}
                      </a>
                    ) : (
                      "Телефон не указан"
                    )}
                  </p>
                  {client.email && (
                    <p>
                      <a href={`mailto:${client.email}`}>
                        <Mail size={13} />
                        {client.email}
                      </a>
                    </p>
                  )}
                </div>
              </div>
              <Stat label="Действующие аренды" value={client.activeLeases} />
              <Stat
                label="Аренда в месяц"
                value={money(client.monthlyRateMinor)}
              />
              <Stat
                label="Задолженность"
                value={money(client.debtMinor)}
                tone={client.debtMinor ? "danger" : undefined}
              />
            </div>
            {client.notes && (
              <div className="detail-note">
                <strong>Заметка</strong>
                <p>{client.notes}</p>
              </div>
            )}
            <Tabs className="detail-tabs" defaultSelectedKey="leases">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Информация о клиенте">
                  <Tabs.Tab id="leases">
                    Аренды <span className="tab-count">{leases.length}</span>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="charges">
                    Начисления
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="payments">
                    Оплаты
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="leases">
                {leases.length ? (
                  <div className="table-surface">
                    <LeaseTable items={leases} />
                  </div>
                ) : (
                  <Empty
                    title="Пока нет аренд"
                    description="Свяжите клиента со складом и задайте индивидуальные условия."
                    action={
                      !client.archivedAt && (
                        <Button
                          variant="secondary"
                          onPress={() => setNewLease(true)}
                        >
                          Оформить аренду
                        </Button>
                      )
                    }
                  />
                )}
              </Tabs.Panel>
              <Tabs.Panel id="charges">
                {charges.length ? (
                  <div className="table-surface">
                    <ChargeTable items={charges} onPay={setPaying} />
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
                    title="Оплат пока нет"
                    description="История появится после первого поступления."
                  />
                )}
              </Tabs.Panel>
            </Tabs>
            {!client.archivedAt && (
              <div className="archive-area">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setArchiving(true)}
                >
                  <Archive size={14} />
                  Перенести клиента в архив
                </Button>
                <p>
                  История аренд и оплат сохранится. Действующие аренды нужно
                  предварительно завершить.
                </p>
              </div>
            )}
            {editing && (
              <ClientEditor client={client} onClose={() => setEditing(false)} />
            )}
            {newLease && (
              <LeaseEditor client={client} onClose={() => setNewLease(false)} />
            )}
            <Confirm
              open={archiving}
              title="Перенести клиента в архив?"
              description="Клиент исчезнет из действующего списка. История аренд и оплат сохранится."
              confirmLabel="В архив"
              busy={mutation.busy}
              error={mutation.error}
              onClose={() => setArchiving(false)}
              onConfirm={() => {
                void mutation.run(
                  () =>
                    api(`/api/clients/${client.id}/archive`, {
                      method: "POST",
                      body: { version: client.version },
                    }),
                  () => {
                    invalidate();
                    notify("Клиент перенесён в архив");
                    setArchiving(false);
                  },
                );
              }}
            />
          </>
        )}
      </ResourceBody>
      {paying && (
        <PaymentEditor charge={paying} onClose={() => setPaying(null)} />
      )}
      {reversing && (
        <ReversalEditor
          payment={reversing}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

export function WarehouseDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { revision, invalidate, notify } = useWorkspace();
  const resource = useResource<WarehouseDetail>(
    `/api/warehouses/${id}`,
    revision,
  );
  const [editing, setEditing] = useState(false);
  const [newLease, setNewLease] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [paying, setPaying] = useState<ChargeDto | null>(null);
  const [reversing, setReversing] = useState<PaymentDto | null>(null);
  const mutation = useMutation();
  return (
    <>
      <Back onPress={() => goBack(navigate, "/warehouses")}>Склады</Back>
      <ResourceBody resource={resource}>
        {({ warehouse, leases, charges, payments }) => (
          <>
            <PageHeader
              eyebrow={
                warehouse.archivedAt ? "Склад в архиве" : "Карточка помещения"
              }
              title={`Склад № ${warehouse.number}`}
              description={warehouse.address || "Расположение не указано"}
              action={
                !warehouse.archivedAt && (
                  <>
                    <Button
                      variant="secondary"
                      onPress={() => setEditing(true)}
                    >
                      <Pencil size={15} />
                      Редактировать
                    </Button>
                    {warehouse.availability === "available" && (
                      <Button onPress={() => setNewLease(true)}>
                        <Plus size={16} />
                        Оформить аренду
                      </Button>
                    )}
                  </>
                )
              }
            />
            <div className="detail-overview">
              <div className="detail-contact">
                <span className="warehouse-avatar warehouse-avatar--large">
                  <Building2 size={27} />
                </span>
                <div>
                  <strong>
                    {warehouse.area == null
                      ? "Площадь не указана"
                      : `${warehouse.area} м²`}
                  </strong>
                  <p>
                    <MapPin size={13} />
                    {warehouse.address || "Адрес не указан"}
                  </p>
                  <Badge
                    color={
                      warehouse.availability === "maintenance"
                        ? "warning"
                        : warehouse.currentLease
                          ? "accent"
                          : "success"
                    }
                  >
                    {warehouse.availability === "maintenance"
                      ? "Обслуживание"
                      : warehouse.currentLease
                        ? "Занят"
                        : "Свободен"}
                  </Badge>
                </div>
              </div>
              <Stat
                label="Текущий арендатор"
                value={
                  warehouse.currentLease ? (
                    <Link to={`/clients/${warehouse.currentLease.clientId}`}>
                      {warehouse.currentLease.clientName}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <Stat
                label="Ставка / месяц"
                value={
                  warehouse.currentLease
                    ? money(warehouse.currentLease.monthlyRateMinor)
                    : "—"
                }
              />
              <Stat
                label="Ближайшая оплата"
                value={date(warehouse.currentLease?.nextDueDate)}
              />
            </div>
            {warehouse.nextLease && (
              <div className="info-note">
                Запланирована аренда:{" "}
                <Link to={`/leases/${warehouse.nextLease.id}`}>
                  {warehouse.nextLease.clientName}
                </Link>
                , начало {date(warehouse.nextLease.startDate)}.
              </div>
            )}
            {warehouse.notes && (
              <div className="detail-note">
                <strong>Заметка</strong>
                <p>{warehouse.notes}</p>
              </div>
            )}
            <Tabs className="detail-tabs" defaultSelectedKey="leases">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Информация о складе">
                  <Tabs.Tab id="leases">
                    История аренд
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="charges">
                    Начисления
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="payments">
                    Оплаты
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="leases">
                {leases.length ? (
                  <div className="table-surface">
                    <LeaseTable items={leases} />
                  </div>
                ) : (
                  <Empty
                    title="Склад ещё не сдавался"
                    description="Оформите аренду для клиента, чтобы начать учёт."
                  />
                )}
              </Tabs.Panel>
              <Tabs.Panel id="charges">
                {charges.length ? (
                  <div className="table-surface">
                    <ChargeTable items={charges} onPay={setPaying} />
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
                  <Empty title="Оплат пока нет" />
                )}
              </Tabs.Panel>
            </Tabs>
            {!warehouse.archivedAt && (
              <div className="archive-area">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setArchiving(true)}
                >
                  <Archive size={14} />
                  Перенести склад в архив
                </Button>
                <p>
                  Действующие и запланированные аренды необходимо предварительно
                  завершить.
                </p>
              </div>
            )}
            {editing && (
              <WarehouseEditor
                warehouse={warehouse}
                onClose={() => setEditing(false)}
              />
            )}
            {newLease && (
              <LeaseEditor
                warehouse={warehouse}
                onClose={() => setNewLease(false)}
              />
            )}
            <Confirm
              open={archiving}
              title="Перенести склад в архив?"
              description="Склад исчезнет из действующего списка. История арендаторов и платежей сохранится."
              confirmLabel="В архив"
              busy={mutation.busy}
              error={mutation.error}
              onClose={() => setArchiving(false)}
              onConfirm={() => {
                void mutation.run(
                  () =>
                    api(`/api/warehouses/${warehouse.id}/archive`, {
                      method: "POST",
                      body: { version: warehouse.version },
                    }),
                  () => {
                    invalidate();
                    notify("Склад перенесён в архив");
                    setArchiving(false);
                  },
                );
              }}
            />
          </>
        )}
      </ResourceBody>
      {paying && (
        <PaymentEditor charge={paying} onClose={() => setPaying(null)} />
      )}
      {reversing && (
        <ReversalEditor
          payment={reversing}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

export function LeasesPage() {
  const { revision } = useWorkspace();
  const { params, set, page } = useFilters();
  const [editor, setEditor] = useState(false);
  const resource = useResource<Page<LeaseDto>>(
    query("/api/leases", {
      search: params.get("search"),
      status: params.get("status") ?? "all",
      clientId: params.get("clientId"),
      warehouseId: params.get("warehouseId"),
      page,
      pageSize: 25,
    }),
    revision,
  );
  return (
    <>
      <PageHeader
        eyebrow="Условия аренды"
        title="Аренды"
        description="Кто, какой склад и на каких условиях арендует."
        action={
          <Button onPress={() => setEditor(true)}>
            <Plus size={16} />
            Оформить аренду
          </Button>
        }
      />
      <div className="list-toolbar">
        <SearchBox
          value={params.get("search") ?? ""}
          onChange={(value) => set("search", value)}
          placeholder="Клиент или номер склада"
        />
        <Pick
          label="Статус аренды"
          value={params.get("status") ?? "all"}
          onChange={(value) => set("status", value)}
          options={[
            { id: "all", name: "Все аренды" },
            { id: "active", name: "Действующие" },
            { id: "scheduled", name: "Запланированные" },
            { id: "ended", name: "Завершённые" },
          ]}
        />
      </div>
      <ResourceBody resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="table-surface">
              <LeaseTable items={data.items} />
              <Pagination
                page={data}
                onChange={(value) => set("page", String(value))}
              />
            </div>
          ) : (
            <Empty
              title="Аренды не найдены"
              description="Выберите клиента и склад, задайте срок и индивидуальную стоимость."
              action={
                <Button variant="secondary" onPress={() => setEditor(true)}>
                  Оформить аренду
                </Button>
              }
            />
          )
        }
      </ResourceBody>
      {editor && <LeaseEditor onClose={() => setEditor(false)} />}
    </>
  );
}
