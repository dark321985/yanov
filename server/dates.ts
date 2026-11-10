export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2199-12-31'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10);
}
export function boundary(start: string, index: number): string {
  const original = new Date(`${start}T12:00:00Z`);
  const month = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth()+index, 1, 12));
  const last = new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  month.setUTCDate(Math.min(original.getUTCDate(),last)); return month.toISOString().slice(0,10);
}
export function periodIndex(start: string, date: string): number {
  const a = new Date(start); const b = new Date(date);
  return (b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
}
export function isBoundary(start: string, date: string) {
  const index = periodIndex(start,date); return index >= 0 && boundary(start,index) === date;
}
export function todayIn(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = (key: string) => parts.find((item)=>item.type===key)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function timeIn(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
}
