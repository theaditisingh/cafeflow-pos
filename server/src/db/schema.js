import {
  pgTable, pgEnum, serial, integer, text, boolean, timestamp, uniqueIndex, index, jsonb, numeric,
} from 'drizzle-orm/pg-core';

// All money is stored as integer paise (₹1 = 100 paise). Tax rates are basis points (5% = 500).

export const roleEnum = pgEnum('role', ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN']);
export const orderTypeEnum = pgEnum('order_type', ['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
export const orderStatusEnum = pgEnum('order_status', ['OPEN', 'CONFIRMED', 'COMPLETED', 'CANCELLED']);
export const kitchenStatusEnum = pgEnum('kitchen_status', ['NOT_SENT', 'NEW', 'PREPARING', 'READY', 'SERVED']);
export const paymentStatusEnum = pgEnum('payment_status', ['UNPAID', 'PAID', 'REFUNDED', 'VOID']);
export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'UPI', 'CARD']);
export const tableStatusEnum = pgEnum('table_status', ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING']);
export const tableAreaEnum = pgEnum('table_area', ['INDOOR', 'OUTDOOR']);
export const stationEnum = pgEnum('station', ['BAR', 'KITCHEN', 'DESSERT']);
export const movementTypeEnum = pgEnum('movement_type', ['PURCHASE', 'ADJUSTMENT', 'ORDER_DEDUCTION', 'ORDER_RESTORE']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: boolean('archived').notNull().default(false),
});

export const menuItems = pgTable('menu_items', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  imageUrl: text('image_url'),
  pricePaise: integer('price_paise').notNull(),
  taxRateBp: integer('tax_rate_bp').notNull().default(500),
  station: stationEnum('station').notNull().default('KITCHEN'),
  isVeg: boolean('is_veg').notNull().default(true),
  available: boolean('available').notNull().default(true),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('menu_items_category_idx').on(t.categoryId)]);

export const variants = pgTable('variants', {
  id: serial('id').primaryKey(),
  menuItemId: integer('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  priceDeltaPaise: integer('price_delta_paise').notNull().default(0),
});

export const addons = pgTable('addons', {
  id: serial('id').primaryKey(),
  menuItemId: integer('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  pricePaise: integer('price_paise').notNull().default(0),
});

export const diningTables = pgTable('dining_tables', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  area: tableAreaEnum('area').notNull(),
  capacity: integer('capacity').notNull(),
  status: tableStatusEnum('status').notNull().default('AVAILABLE'),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').unique(),
  loyaltyPoints: integer('loyalty_points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  receiptNumber: text('receipt_number').unique(),
  kotNumber: text('kot_number').unique(),
  type: orderTypeEnum('type').notNull(),
  tableId: integer('table_id').references(() => diningTables.id),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  status: orderStatusEnum('status').notNull().default('OPEN'),
  kitchenStatus: kitchenStatusEnum('kitchen_status').notNull().default('NOT_SENT'),
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('UNPAID'),
  subtotalPaise: integer('subtotal_paise').notNull().default(0),
  discountType: text('discount_type'),
  discountValue: integer('discount_value').notNull().default(0),
  discountPaise: integer('discount_paise').notNull().default(0),
  taxPaise: integer('tax_paise').notNull().default(0),
  totalPaise: integer('total_paise').notNull().default(0),
  notes: text('notes'),
  stockDeducted: boolean('stock_deducted').notNull().default(false),
  loyaltyAwarded: boolean('loyalty_awarded').notNull().default(false),
  cancelReason: text('cancel_reason'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentToKitchenAt: timestamp('sent_to_kitchen_at', { withTimezone: true }),
  preparingAt: timestamp('preparing_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  servedAt: timestamp('served_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  index('orders_created_idx').on(t.createdAt),
  index('orders_table_idx').on(t.tableId),
  index('orders_status_idx').on(t.status, t.kitchenStatus),
]);

// Historical name/price/tax are copied here so old receipts never change when the menu is edited.
export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  menuItemId: integer('menu_item_id').references(() => menuItems.id),
  name: text('name').notNull(),
  variantName: text('variant_name'),
  addons: jsonb('addons').notNull().default([]),
  notes: text('notes'),
  isVeg: boolean('is_veg').notNull().default(true),
  station: stationEnum('station').notNull().default('KITCHEN'),
  unitPricePaise: integer('unit_price_paise').notNull(),
  quantity: integer('quantity').notNull(),
  taxRateBp: integer('tax_rate_bp').notNull(),
  lineSubtotalPaise: integer('line_subtotal_paise').notNull(),
  lineDiscountPaise: integer('line_discount_paise').notNull().default(0),
  lineTaxPaise: integer('line_tax_paise').notNull().default(0),
  lineTotalPaise: integer('line_total_paise').notNull(),
}, (t) => [index('order_items_order_idx').on(t.orderId)]);

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id),
  method: paymentMethodEnum('method').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  cashReceivedPaise: integer('cash_received_paise'),
  changePaise: integer('change_paise'),
  reference: text('reference'),
  status: text('status').notNull().default('SUCCESS'), // SUCCESS | REFUNDED | VOID
  refundReason: text('refund_reason'),
  idempotencyKey: text('idempotency_key').unique(),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  refundedBy: integer('refunded_by').references(() => users.id),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payments_order_idx').on(t.orderId)]);

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  orderId: integer('order_id').references(() => orders.id),
  type: text('type').notNull(), // EARN | REVERSE
  points: integer('points').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('loyalty_order_type_uq').on(t.orderId, t.type)]);

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
});

export const ingredients = pgTable('ingredients', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  unit: text('unit').notNull(), // g, ml, pcs
  stockQty: numeric('stock_qty', { precision: 14, scale: 3, mode: 'number' }).notNull().default(0),
  minStockQty: numeric('min_stock_qty', { precision: 14, scale: 3, mode: 'number' }).notNull().default(0),
  costPerUnitPaise: integer('cost_per_unit_paise').notNull().default(0),
  allowNegative: boolean('allow_negative').notNull().default(false),
});

export const recipes = pgTable('recipes', {
  id: serial('id').primaryKey(),
  menuItemId: integer('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  ingredientId: integer('ingredient_id').notNull().references(() => ingredients.id),
  quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull(),
}, (t) => [uniqueIndex('recipes_item_ing_uq').on(t.menuItemId, t.ingredientId)]);

export const purchases = pgTable('purchases', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id').notNull().references(() => suppliers.id),
  ingredientId: integer('ingredient_id').notNull().references(() => ingredients.id),
  quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull(),
  unitCostPaise: integer('unit_cost_paise').notNull(),
  totalPaise: integer('total_paise').notNull(),
  invoiceNo: text('invoice_no'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  ingredientId: integer('ingredient_id').notNull().references(() => ingredients.id),
  type: movementTypeEnum('type').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull(), // signed
  reason: text('reason'),
  orderId: integer('order_id').references(() => orders.id),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('stock_mov_ing_idx').on(t.ingredientId)]);

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  reason: text('reason'),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
