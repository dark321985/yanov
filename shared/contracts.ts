export type DatabaseStatus = 'connected' | 'not-configured' | 'unavailable';

export interface SystemStatus {
  environment: 'development' | 'production' | 'test';
  database: DatabaseStatus;
  timezone: string;
  stage: 1;
}

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  fields?: Record<string, string>;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export type LeaseStatus = 'scheduled' | 'active' | 'ended';
export type ChargeStatus = 'paid' | 'partial' | 'upcoming' | 'today' | 'overdue';
export type PaymentMethod = 'cash' | 'transfer' | 'other';
export interface ClientDto {
  id: string; name: string; phone: string; email: string; contact: string; notes: string;
  archivedAt: string | null; version: number; activeLeases: number;
  monthlyRateMinor: number; debtMinor: number; nextDueDate: string | null;
}
export interface WarehouseDto {
  id: string; number: string; area: number | null; address: string; notes: string;
  availability: 'available' | 'maintenance'; archivedAt: string | null; version: number;
  currentLease: LeaseDto | null; nextLease: LeaseDto | null;
}
export interface RateDto { id: string; effectiveDate: string; monthlyRateMinor: number }
export interface LeaseDto {
  id: string; clientId: string; warehouseId: string; clientName: string; warehouseNumber: string;
  startDate: string; endDate: string | null; releasedOn: string | null; notes: string; version: number; status: LeaseStatus;
  monthlyRateMinor: number; debtMinor: number; paidThrough: string | null; nextDueDate: string | null;
  rates: RateDto[];
}
export interface ChargeDto {
  id: string; leaseId: string; clientId: string; warehouseId: string; clientName: string; warehouseNumber: string;
  periodStart: string; periodEnd: string; dueDate: string; amountMinor: number;
  paidMinor: number; remainingMinor: number; status: ChargeStatus; cancelledAt: string | null;
}
export interface AllocationDto { chargeId: string; periodStart: string; periodEnd: string; amountMinor: number }
export interface PaymentDto {
  id: string; leaseId: string; clientId: string; warehouseId: string; clientName: string; warehouseNumber: string;
  receivedOn: string; amountMinor: number; method: PaymentMethod; notes: string;
  reversedAt: string | null; reversalReason: string | null; allocations: AllocationDto[];
}
export interface PaymentInput {
  leaseId: string; receivedOn: string; amountMinor: number; chargeIds: string[];
  method: PaymentMethod; notes: string; idempotencyKey?: string;
}
export interface PaymentPreview {
  amountMinor: number; selectedRemainingMinor: number; remainingAfterMinor: number;
  allocations: AllocationDto[]; olderDebtMinor: number;
}
export interface SettingsDto {
  businessName: string; timezone: string; reminderDays: number; reminderTime: string;
  telegramEnabled: boolean; telegramChatId: string; version: number;
}
export interface TelegramStatus {
  configured: boolean; lastRunAt: string | null; lastSuccessAt: string | null;
}
export interface NotificationDto {
  id: string; clientName: string; warehouseNumber: string; dueDate: string;
  scheduledOn: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
  attempts: number; sentAt: string | null; resultCode: string | null;
}
export interface DashboardDto {
  from: string; to: string; today: string;
  totals: { receivedMinor: number; overdueMinor: number; upcomingMinor: number; occupiedWarehouses: number; totalWarehouses: number; activeLeases: number };
  upcoming: ChargeDto[]; overdue: ChargeDto[];
  receiptsByMonth: { month: string; amountMinor: number }[];
}
export interface ReportDto {
  from: string; to: string; totalMinor: number;
  byMonth: { label: string; amountMinor: number }[];
  byWarehouse: { id: string; label: string; amountMinor: number }[];
  byClient: { id: string; label: string; amountMinor: number }[];
}
