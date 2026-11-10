# Frontend API contract

`LeaseDto.paidThrough` is also an EXCLUSIVE date boundary. To display «оплачено по», subtract one day exactly once. Null means no continuously paid first period.

All money values are integer kopecks. All business dates are YYYY-MM-DD. Period end and lease end dates in DTO are EXCLUSIVE (display one day earlier for a paid-through label). API routes require owner session except auth/status and login. All mutations require `X-Requested-With: warehouse-admin` and an Origin matching APP_URL. Browser fetch uses same-origin credentials. Errors: `{code,message,requestId,fields?}`; 401 means login required, 409 a conflict. DTOs: shared/contracts.ts.

- GET /api/auth/status -> `{authenticated,needsSetup}`. Setup needs server CLI, no public registration.
- POST /api/auth/login `{password}`; POST /api/auth/logout `{}`; POST /api/auth/change-password `{currentPassword,newPassword}`.
- GET /api/clients?search=&archived=false&page=1&pageSize=25&debt=false -> Page<ClientDto>.
- POST /api/clients `{name,phone,email,contact,notes}`; PATCH /api/clients/:id same fields + `version`; POST /api/clients/:id/archive `{version}`. GET /api/clients/:id -> `{client,leases,charges,payments}`.
- GET /api/warehouses?search=&occupancy=all|occupied|free&archived=false&page=1&pageSize=25 -> Page<WarehouseDto>.
- POST /api/warehouses `{number,area:null|number,address,notes,availability:'available'|'maintenance'}`; PATCH same + version; archive `{version}`. GET /api/warehouses/:id -> `{warehouse,leases,charges,payments}`.
- GET /api/leases?search=&status=all|active|scheduled|ended&clientId=&warehouseId=&page=1&pageSize=25 -> Page<LeaseDto>.
- POST /api/leases `{clientId,warehouseId,startDate,endDate:null|date,monthlyRateMinor,notes}`. GET /api/leases/:id -> `{lease,charges,payments}`. PATCH /api/leases/:id `{notes,version}`.
- POST /api/leases/:id/rates `{effectiveDate,monthlyRateMinor,version}`. Boundary of a future period only.
- POST /api/leases/:id/close `{endDate,version}`. End is exclusive boundary; paid future periods prevent close.
- POST /api/leases/:id/extend-schedule `{months:1..120}` -> charges (create beyond default horizon for multi-month payment).
- GET /api/charges?from=&to=&clientId=&warehouseId=&leaseId=&status=all|open|paid|overdue&page=1&pageSize=100 -> Page<ChargeDto>. `from/to` refer to due date, inclusive; no dates means all generated charges. Cancelled charges excluded by default.
- GET /api/schedule?from=&to=&clientId=&warehouseId= -> `{items:ChargeDto[],overdue:ChargeDto[]}`.
- POST /api/payments/preview PaymentInput (without idempotencyKey) -> PaymentPreview; POST /api/payments PaymentInput + UUID idempotencyKey -> PaymentDto. Charge IDs explicitly selected; amount above selected outstanding is rejected. Allocation oldest-first. Zero, negative, unsafe integers rejected.
- GET /api/payments?from=&to=&clientId=&warehouseId=&search=&includeReversed=false&page=1&pageSize=25 -> Page<PaymentDto> + `totalMinor`. Dates refer to receivedOn, inclusive.
- POST /api/payments/:id/reverse `{reason}`. Reason mandatory, financial history preserved.
- GET /api/dashboard?from=&to= -> DashboardDto. GET /api/reports/receipts?from=&to= -> ReportDto. GET /api/reports/receipts.csv same filters, download.
- GET /api/settings -> `{settings:SettingsDto,telegram:TelegramStatus}`. PATCH /api/settings SettingsDto including version. Bot token is server env only, never returned. Chat ID visible only in authenticated settings; don't log it.
- GET /api/notifications?page=1&pageSize=25 -> Page<NotificationDto>. POST /api/telegram/test `{}` sends actual message only via explicit user click.
- POST /api/demo `{confirm:true}` available only development, only on an empty business database; fills demonstration records. No default production samples.

Create/edit responses return the created DTO (or `{ok:true}` for archive/reverse/settings); refresh affected lists. Server-side filters and pagination. UI may request pageSize=100 for selection options; if more, provide search/load more.

Settings initial values: name «Складно», timezone Europe/Moscow, reminderDays5, reminderTime09:00, telegramEnabled=false. Actual timezone/today come from server, never browser-only date guesses.
