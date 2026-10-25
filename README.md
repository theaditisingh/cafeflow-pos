# CafeFlow POS

A cafe and restaurant point-of-sale system with original branding: billing counter, tables, kitchen tickets and display, inventory, customers and loyalty, reports and staff management.

- **Frontend:** React 19, Vite, Tailwind CSS 4, Lucide icons, Recharts
- **Backend:** Node.js, Express 5, Zod validation, JWT auth, bcrypt password hashing
- **Database:** PostgreSQL with **Drizzle ORM** (SQL migrations in `server/drizzle`)
- Free, open-source packages only. No external APIs, and no payment gateway.

> **UPI and card payments are recorded, not processed.** CafeFlow never moves money. The cashier confirms payment through their own UPI app or card machine and then records it. The payment screen says so.

## Repository layout

```
cafeflow-pos/
├── server/                 Express API
│   ├── src/db/             schema.js, migrate.js, seed.js, seedData.js, seedDemo.js
│   ├── src/routes/         HTTP routes (auth, menu, orders, kitchen, tables, customers, inventory, reports, admin)
│   ├── src/services/       order lifecycle and stock logic (all run inside DB transactions)
│   ├── src/lib/billing.js  pure price/tax/discount maths (shared with the client cart preview)
│   ├── drizzle/            generated SQL migrations
│   └── tests/              Vitest + Supertest integration tests
├── client/                 React + Vite app
└── docker-compose.yml      optional: PostgreSQL only
```

## Requirements

**Node.js 22.12 or newer** (the test runner needs it; check with `node -v`) and PostgreSQL 14+ installed locally. Docker is optional.

## Setup

### 1. Create the databases (once)

```bash
psql -U postgres -c "CREATE USER cafeflow WITH PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE cafeflow_pos OWNER cafeflow;"
psql -U postgres -c "CREATE DATABASE cafeflow_test OWNER cafeflow;"
```

Or, with Docker, `docker compose up -d` starts a PostgreSQL 16 with the same user and databases (see the notes in `docker-compose.yml`).

### 2. Backend

```bash
cd server
cp .env.example .env      # then edit the values
npm install
npm run db:migrate        # create tables
npm run db:seed           # demo menu, tables, staff, customers, stock and a week of demo orders
npm run dev               # API at http://localhost:4000
```

### 3. Frontend (second terminal)

```bash
cd client
npm install
npm run dev               # app at http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173 and sign in with a demo account.

## Windows (PowerShell) quick start

Run these in PowerShell, from the project folder. `psql` is in `C:\Program Files\PostgreSQL\<version>\bin`; if `psql` is not recognised, call it with its full path.

```powershell
# 1. Create the database user and databases (asks for the 'postgres' password you chose at install)
#    Use letters and digits only in the new password, so it is safe inside the connection URL.
@"
CREATE USER cafeflow WITH PASSWORD 'ChangeMe123';
CREATE DATABASE cafeflow_pos OWNER cafeflow;
CREATE DATABASE cafeflow_test OWNER cafeflow;
"@ | psql -U postgres

# 2. Backend
cd server
Copy-Item .env.example .env
notepad .env          # set the password in both URLs, and a long random JWT_SECRET
npm install
npm run db:migrate
npm run db:seed
npm run dev           # leave running: http://localhost:4000

# 3. Frontend (open a SECOND PowerShell window, from the project folder)
cd client
npm install
npm run dev           # leave running: http://localhost:5173
```

Then open http://localhost:5173. If PowerShell blocks `npm` with a script-execution error, run `npm.cmd install` / `npm.cmd run dev`, or allow scripts for your user with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

To run the tests: `cd server; npm run test:db:migrate; npm test`.

## Environment variables

`server/.env` (see `server/.env.example`; the real `.env` is git-ignored):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the app |
| `TEST_DATABASE_URL` | Separate database used only by the test suite |
| `JWT_SECRET` | Long random string used to sign login tokens. Required. |
| `PORT` | API port (default 4000) |

Client (optional): `VITE_API_TARGET` is the backend URL the dev server proxies `/api` to (default `http://localhost:4000`).

## Demo logins

Password for all demo accounts: `Cafe@1234`

| Role | Email | Can use |
|---|---|---|
| Owner | owner@cafeflow.test | Everything, including staff accounts |
| Manager | manager@cafeflow.test | Dashboard, billing, menu, inventory, reports, settings, refunds/voids |
| Cashier | cashier@cafeflow.test | Billing, tables, orders, customers, kitchen display |
| Kitchen | kitchen@cafeflow.test | Kitchen display only |

**Change or disable these accounts before using CafeFlow for a real business** (Settings → Staff & roles, as Owner).

## Database commands

```bash
npm run db:generate       # after editing src/db/schema.js: create a new SQL migration
npm run db:migrate        # apply pending migrations
npm run db:seed           # load demo data (see safety note)
npm run test:db:migrate   # apply migrations to the test database
```

**Seed safety:** `db:seed` *replaces* the contents of the database it points at with demo data. It refuses to run if any non-demo order exists, and only `--force` overrides that. Demo orders are flagged `is_demo` and marked "Demo" in the UI and on receipts. Never run the seed against a database holding real data.

## Tests and build

```bash
cd server && npm run test:db:migrate && npm test     # backend: billing, orders, payments, kitchen, stock, permissions, reports, admin
cd client && npm run build                           # production build of the frontend
```

The test suite uses `TEST_DATABASE_URL` and clears that database between runs. Point it at a database you do not care about.

## Business rules

All money is stored as integer **paise**, and tax rates as **basis points** (500 = 5%). The server recalculates every total from current menu prices. Client-submitted totals are ignored.

- **Order items** copy name, variant, add-ons, price and tax at the time of sale, so old receipts never change when the menu is edited. Menu items are archived, not deleted.
- **Tax and discounts:** tax is configurable (exclusive or inclusive) and set per menu item. Discounts are a percentage or flat amount, applied before tax and split across lines. Cashiers are capped at a configurable discount percentage. CafeFlow does not decide your legal GST treatment: confirm the correct rates with your accountant.
- **Kitchen vs billing:** kitchen status (New, Preparing, Ready, Served) and payment status are independent fields.
- **Order flow:** Save (open) → Send KOT (items locked, KOT number issued, stock deducted) → Pay (receipt number issued, order completed). Paying an order that was never sent to the kitchen sends it automatically.
- **Duplicate protection:** each payment attempt carries an idempotency key and the order row is locked, so double-clicks and retries record exactly one payment.
- **Stock:** ingredients are deducted from recipes when the order is sent to the kitchen, once only. Cancelling restores them only if the kitchen has not started preparing. Stock cannot go negative unless that ingredient is explicitly set to allow it. Stock is changed only by purchases, adjustments (with a mandatory reason) and orders, and every change is in the movement log.
- **Cancellation:** only unpaid orders can be cancelled, with a reason. A cashier cannot cancel an order already in the kitchen; a manager can. The table is freed.
- **Refund / void** (manager or owner, mandatory reason, audit-logged): marks the payment refunded or void and reverses loyalty points. It does **not** return ingredients to stock (the food was made) and does not reopen the order. Reports show refunds separately.
- **Tables:** a dine-in order marks its table Occupied. Paying or cancelling marks it Available. Reserved and Cleaning are set manually, and a table being cleaned cannot take an order.
- **Loyalty:** points are earned only when a payment is recorded, once per order (database-enforced), at the configured points per ₹100.
- **Report definitions:** *Total collected* = paid order totals. *Net sales* = total collected − tax. *Gross sales* = net sales + discounts. Refunds and voids are shown separately, by refund date. All dates use Indian Standard Time.

## Frontend screens

| Screen | Roles | What it does |
|---|---|---|
| Dashboard | Owner, Manager | Live sales, order counts by type, 7-day trend, payment mix, best sellers, low stock, recent orders |
| Billing | Owner, Manager, Cashier | Category tabs, search, cart, variants/add-ons/notes, order types, tables, customer, discount, KOT, payment, printable receipt |
| Tables | Owner, Manager, Cashier | Indoor/outdoor floor plan, status changes, start an order from a table |
| Orders | Owner, Manager, Cashier | Search and filter history, order detail, reprint, cancel, refund/void |
| Kitchen | All roles | Board (New / Preparing / Ready / Served) and KOT list; refreshes every 4 seconds; prep times |
| Menu | Owner, Manager | Categories, items, variants, add-ons, availability, tax rate, station |
| Inventory | Owner, Manager | Stock, purchases, suppliers, recipes, adjustments, movement history |
| Customers | Owner, Manager, Cashier | Records, order history, loyalty history |
| Reports | Owner, Manager | Sales, items, categories, cancellations, stock; date range; CSV export |
| Settings | Owner, Manager | Cafe details, tax and discount rules, loyalty; staff accounts (Owner); audit log |

Receipts print at 80 mm thermal width via the browser print dialog.

## API reference

All routes are under `/api`, send and return JSON, and need `Authorization: Bearer <token>` except `POST /auth/login`. Errors return `{ "error": "message", "details": [...] }` with a suitable HTTP status (400 validation, 401 not signed in, 403 not permitted, 404, 409 conflict). Roles: **O**wner is allowed everywhere; the lists show who else can call each route.

**Auth**

| Method & path | Roles | Notes |
|---|---|---|
| `POST /auth/login` | public | `{ email, password }` → `{ token, user }` |
| `GET /auth/me` | any | current user |

**Menu** (`/menu`)

| Method & path | Roles | Notes |
|---|---|---|
| `GET /categories`, `GET /items` | any | `?available=true` hides unavailable items |
| `POST/PUT/DELETE /categories[/:id]` | Manager | delete archives; refused if the category has live items |
| `POST/PUT/DELETE /items[/:id]` | Manager | items may carry `variants` and `addons`; delete archives |
| `PATCH /items/:id/availability` | Manager, Cashier, Kitchen | `{ available }` |

**Orders** (`/orders`, Manager and Cashier unless noted)

| Method & path | Notes |
|---|---|
| `GET /` | filters: `q, from, to, type, status, paymentStatus, kitchenStatus, customerId, limit, offset` → `{ rows, total }` |
| `GET /:id` | full order with items and payments |
| `GET /:id/receipt` | receipt data; `?reprint=1` is audit-logged |
| `POST /` | create an order from `{ type, tableId, items[], discount, customer*, notes }` |
| `PUT /:id` | replace items/discount/customer on an order that is still open |
| `POST /:id/send-kitchen` | issue KOT, lock items, deduct stock (idempotent) |
| `POST /:id/payments` | `{ method: CASH\|UPI\|CARD, cashReceivedPaise?, reference?, idempotencyKey? }` |
| `POST /:id/cancel` | `{ reason }` |
| `POST /:id/refund` | Manager only. `{ type: REFUND\|VOID, reason }` |

**Kitchen** (`/kitchen`)

| Method & path | Roles | Notes |
|---|---|---|
| `GET /tickets` | any | `?state=active\|served\|all&station=BAR\|KITCHEN\|DESSERT` |
| `PATCH /orders/:id/status` | Manager, Kitchen, Cashier | `{ status: NEW\|PREPARING\|READY\|SERVED }`; only valid transitions |

**Tables** (`/tables`): `GET /` (Manager, Cashier); `POST /`, `PUT /:id`, `DELETE /:id` (Manager); `PATCH /:id/status` (Manager, Cashier).

**Customers** (`/customers`, Manager and Cashier): `GET /?q=`, `GET /:id`, `POST /`, `PUT /:id`.

**Inventory** (`/inventory`, Manager): `GET|POST /ingredients`, `PUT /ingredients/:id`, `GET /low-stock`, `GET|POST /suppliers`, `PUT|DELETE /suppliers/:id`, `GET|POST /purchases`, `POST /adjustments`, `GET /movements?ingredientId=`, `GET /recipes`, `PUT /recipes/:menuItemId`.

**Reports** (`/reports`, Manager): `GET /dashboard`, `/sales`, `/payments`, `/items`, `/categories`, `/cancellations`, `/stock`. All except the dashboard take `?from=YYYY-MM-DD&to=YYYY-MM-DD`, and `&format=csv` downloads a CSV.

**Admin**: `GET /settings` (any), `PUT /settings` (Manager); `GET|POST /staff`, `PUT /staff/:id` (Owner); `GET /audit?action=&limit=&offset=` (Manager).

## Known limitations

- There is no production static-file serving. Run `npm run build` in `client/` and host `client/dist` behind a server that proxies `/api` to the API.
- Kitchen and floor-plan screens sync by polling every few seconds, not websockets.
- Menu images are URLs or built-in icons; there is no image upload.
- The optional Docker Compose file starts PostgreSQL only and has not been run in the development environment used to build this project.
