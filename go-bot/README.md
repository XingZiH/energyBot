# Go Bot Executor

`go-bot` is an independent execution service for the energy rental product.

It owns:

- Telegram bot interactions
- TRON payment monitoring
- JustLend rent/return execution
- one-hour return scheduling

It does not own admin CRUD. The Angular admin UI and `nest-api` manage users,
menus, permissions, packages, orders, wallet transactions, and return task
records.

`go-bot` and `nest-api` share the same business tables through `DATABASE_URL`.
The bot runtime values are managed from the admin page:
`机器人控制 -> 平台配置`. Do not commit real tokens, private keys, or server
credentials.

## Layout

```text
go-bot/
  cmd/bot/main.go
  internal/config/config.go
  internal/orders/types.go
  internal/scheduler/scheduler.go
```

## Required Environment Config

- `DATABASE_URL`

## Admin Platform Config

Configure these in `机器人控制 -> 平台配置`:

- `TELEGRAM_BOT_TOKEN`
- `TRON_API_BASE_URL`
- `TRON_API_KEY`
- `PLATFORM_RECEIVE_ADDRESS`
- `JUSTLEND_CONTRACT_ADDRESS`
- `JUSTLEND_PAYER_PRIVATE_KEY`
- `ORDER_PAYMENT_TTL`, admin field: order payment TTL minutes, default `10`
- `ENERGY_RENTAL_TTL`, admin field: rental TTL minutes, default `60`
- `TELEGRAM_POLLING_INTERVAL`, admin field: polling interval seconds, default `2`
- `WORKER_INTERVAL`, admin field: worker interval seconds, default `60`
- `MIN_TRX_RESERVE_SUN`, admin field: minimum TRX reserve in SUN, default `0`

## Local Example

```powershell
$env:DATABASE_URL='postgres://user:password@localhost:5432/app'
```

## Commands

```powershell
go test ./...
go run ./cmd/bot
```
