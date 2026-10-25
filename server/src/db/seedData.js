// Fictional demo data for CafeFlow POS. Prices in paise, tax in basis points.
export const DEMO_PASSWORD = 'Cafe@1234';

export const demoUsers = [
  { name: 'Aarav Mehta', email: 'owner@cafeflow.test', role: 'OWNER' },
  { name: 'Priya Nair', email: 'manager@cafeflow.test', role: 'MANAGER' },
  { name: 'Rohan Das', email: 'cashier@cafeflow.test', role: 'CASHIER' },
  { name: 'Sunita Rao', email: 'kitchen@cafeflow.test', role: 'KITCHEN' },
];

export const categoryNames = ['Coffee', 'Tea', 'Cold Beverages', 'Snacks', 'Pizza', 'Burgers', 'Desserts'];

// [category, name, price(₹), isVeg, station, description, variants[[name, deltaRs]], addons[[name, priceRs]]]
export const menu = [
  ['Coffee', 'Cappuccino', 160, true, 'BAR', 'Espresso with steamed milk foam', [['Regular', 0], ['Large', 40]], [['Extra shot', 30], ['Vanilla syrup', 25]]],
  ['Coffee', 'Filter Coffee', 90, true, 'BAR', 'South Indian decoction coffee', [], []],
  ['Coffee', 'Espresso', 120, true, 'BAR', 'Single origin double shot', [], [['Extra shot', 30]]],
  ['Tea', 'Masala Chai', 60, true, 'BAR', 'Ginger and cardamom milk tea', [['Cutting', -20], ['Full', 0]], [['Extra ginger', 10]]],
  ['Tea', 'Lemon Iced Tea', 120, true, 'BAR', 'Black tea, lemon, mint', [], []],
  ['Cold Beverages', 'Cold Coffee', 170, true, 'BAR', 'Blended coffee with ice cream', [['Regular', 0], ['Large', 40]], [['Ice cream scoop', 40]]],
  ['Cold Beverages', 'Fresh Lime Soda', 90, true, 'BAR', 'Sweet or salted', [], []],
  ['Snacks', 'Veg Sandwich', 120, true, 'KITCHEN', 'Grilled vegetable sandwich', [], [['Extra cheese', 30]]],
  ['Snacks', 'French Fries', 110, true, 'KITCHEN', 'Crispy salted fries', [['Regular', 0], ['Peri peri', 20]], [['Cheese dip', 30]]],
  ['Snacks', 'Chicken Club Sandwich', 190, false, 'KITCHEN', 'Triple-decker with grilled chicken', [], []],
  ['Pizza', 'Margherita Pizza', 280, true, 'KITCHEN', 'Tomato, mozzarella, basil', [['8 inch', 0], ['10 inch', 80]], [['Extra cheese', 50], ['Olives', 30]]],
  ['Pizza', 'Chicken Tikka Pizza', 360, false, 'KITCHEN', 'Tandoori chicken and onion', [['8 inch', 0], ['10 inch', 90]], [['Extra cheese', 50]]],
  ['Burgers', 'Veg Burger', 140, true, 'KITCHEN', 'Aloo tikki burger with house sauce', [], [['Cheese slice', 20]]],
  ['Burgers', 'Chicken Burger', 190, false, 'KITCHEN', 'Crispy chicken patty burger', [], [['Cheese slice', 20]]],
  ['Desserts', 'Chocolate Brownie', 130, true, 'DESSERT', 'Warm fudge brownie', [], [['Ice cream scoop', 40]]],
  ['Desserts', 'Cheesecake Slice', 180, true, 'DESSERT', 'Baked New York style', [], []],
];

export const tables = [
  ['T1', 'INDOOR', 2], ['T2', 'INDOOR', 2], ['T3', 'INDOOR', 4], ['T4', 'INDOOR', 4], ['T5', 'INDOOR', 6],
  ['O1', 'OUTDOOR', 2], ['O2', 'OUTDOOR', 4], ['O3', 'OUTDOOR', 4], ['O4', 'OUTDOOR', 6],
];

export const customers = [
  ['Ananya Iyer', '9810000001'], ['Vikram Singh', '9810000002'], ['Meera Joshi', '9810000003'], ['Karan Malhotra', '9810000004'],
];

export const suppliers = [
  ['Sahyadri Coffee Traders', 'Ramesh Pai', '9820000001', 'orders@sahyadri.example'],
  ['Fresh Dairy Co-op', 'Lata Deshmukh', '9820000002', 'sales@freshdairy.example'],
  ['Metro Bakery Supplies', 'Imran Shaikh', '9820000003', 'imran@metrobakery.example'],
];

// [name, unit, stock, min, cost per unit (paise)]
export const ingredients = [
  ['Coffee beans', 'g', 5000, 1000, 120],
  ['Milk', 'ml', 20000, 5000, 6],
  ['Tea leaves', 'g', 2000, 500, 60],
  ['Pizza base', 'pcs', 40, 10, 2500],
  ['Mozzarella', 'g', 3000, 800, 45],
  ['Bread slices', 'pcs', 100, 30, 400],
  ['Potatoes', 'g', 8000, 2000, 4],
  ['Burger buns', 'pcs', 22, 15, 1200],
  ['Cocoa mix', 'g', 520, 400, 90],
];

// [menu item, ingredient, qty]
export const recipes = [
  ['Cappuccino', 'Coffee beans', 18], ['Cappuccino', 'Milk', 150],
  ['Cold Coffee', 'Coffee beans', 15], ['Cold Coffee', 'Milk', 200],
  ['Masala Chai', 'Tea leaves', 5], ['Masala Chai', 'Milk', 100],
  ['Margherita Pizza', 'Pizza base', 1], ['Margherita Pizza', 'Mozzarella', 120],
  ['Veg Sandwich', 'Bread slices', 2],
  ['French Fries', 'Potatoes', 200],
  ['Veg Burger', 'Burger buns', 1], ['Veg Burger', 'Potatoes', 120],
  ['Chocolate Brownie', 'Cocoa mix', 60],
];

export { defaultSettings } from '../lib/settings.js';
