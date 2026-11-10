const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});
export const money = (minor: number) => rubles.format(minor / 100);
export const decimalMoney = (minor: number) =>
  (minor / 100).toFixed(2).replace(/\.00$/, "");
export function parseMoney(value: string): number {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Укажите сумму в рублях, не более двух знаков после запятой.",
    );
  const [whole = "0", fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error("Сумма должна быть больше нуля. Минимум — 0,01 ₽.");
  if (result > 1_000_000_000_000)
    throw new Error("Сумма не должна превышать 10 000 000 000 ₽.");
  return result;
}
export function date(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
export function shiftDays(value: string, days: number) {
  const parsed = new Date(`${value}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
export const inclusiveEnd = (exclusive: string | null) =>
  exclusive ? shiftDays(exclusive, -1) : null;
export const period = (start: string, end: string) =>
  `${date(start, { year: undefined })} — ${date(inclusiveEnd(end))}`;
export function monthBounds(value: string, delta = 0) {
  const parsed = new Date(`${value.slice(0, 7)}-01T12:00:00Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + delta);
  const from = parsed.toISOString().slice(0, 10);
  parsed.setUTCMonth(parsed.getUTCMonth() + 1);
  parsed.setUTCDate(0);
  return { from, to: parsed.toISOString().slice(0, 10) };
}
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
export const methodNames = {
  cash: "Наличные",
  transfer: "Перевод",
  other: "Другое",
} as const;
export const leaseNames = {
  active: "Действует",
  scheduled: "Запланирована",
  ended: "Завершена",
} as const;
export const chargeNames = {
  paid: "Оплачено",
  partial: "Частично",
  upcoming: "Ожидается",
  today: "Сегодня",
  overdue: "Просрочено",
} as const;
