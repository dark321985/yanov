export class AppError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string, readonly fields?: Record<string, string>) {
    super(message);
  }
}
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const missing = () => new AppError(404, 'NOT_FOUND', 'Запись не найдена.');
