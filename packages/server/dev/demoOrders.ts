// Demo screens for the order components and widgets: Work with Orders (one
// list under four titles, so a definition per title shows it as displays and
// totals, a calendar, a board or charts), Order Status (output displays, a
// timeline, barcodes, an image, an embedded page and a help panel), Delivery
// Options (switch, time, mask, lookup and star rating) and a bill of
// materials (a tree).

import { Attr, HostStream } from '@veneer/tn5250';

const { WHITE, BLUE } = Attr;

/** A title centered on the 80-column title row, as IBM i screens have them. */
const centered = (title: string) => Math.floor((80 - title.length) / 2) + 1;

export interface Order {
  number: string;
  customer: string;
  /** Days from today: ship dates move with the calendar, so it always has this month's orders. */
  shipIn: number;
  /** ORD ordered, PCK picking, SHP shipped, DLV delivered, HLD on hold. */
  status: 'ORD' | 'PCK' | 'SHP' | 'DLV' | 'HLD';
  lines: number;
  /** Percent of the lines picked. */
  picked: number;
  amount: number;
  city: string;
  phone: string;
}

/** Each order has its own customer, so a chart's labels and slices are one per order. */
export const ORDERS: Order[] = [
  { number: '104571', customer: 'Lakeside Hardware', shipIn: -6, status: 'DLV', lines: 4, picked: 100, amount: 1250.00, city: 'Chicago', phone: '3125550142' },
  { number: '104572', customer: 'Harbor Supply Co', shipIn: -3, status: 'DLV', lines: 2, picked: 100, amount: 318.40, city: 'San Francisco', phone: '4155550198' },
  { number: '104573', customer: 'Capitol Office Goods', shipIn: -1, status: 'SHP', lines: 7, picked: 100, amount: 2890.00, city: 'Washington', phone: '2025550117' },
  { number: '104574', customer: 'Becker & Sons', shipIn: 0, status: 'SHP', lines: 3, picked: 100, amount: 640.25, city: 'Milwaukee', phone: '4145550163' },
  { number: '104575', customer: 'Pacific Imports', shipIn: 1, status: 'PCK', lines: 12, picked: 60, amount: 5420.00, city: 'Seattle', phone: '2065550181' },
  { number: '104576', customer: 'Desert Freight', shipIn: 2, status: 'PCK', lines: 5, picked: 40, amount: 980.00, city: 'Phoenix', phone: '6025550129' },
  { number: '104577', customer: 'Prairie Seed Co', shipIn: 3, status: 'PCK', lines: 6, picked: 75, amount: 1475.50, city: 'Omaha', phone: '4025550175' },
  { number: '104578', customer: 'Reed Plumbing', shipIn: 5, status: 'ORD', lines: 2, picked: 0, amount: 212.00, city: 'Atlanta', phone: '4045550136' },
  { number: '104579', customer: 'Northstar Medical', shipIn: 7, status: 'HLD', lines: 9, picked: 0, amount: 7300.00, city: 'Minneapolis', phone: '6125550154' },
  { number: '104580', customer: 'Price Electric', shipIn: 9, status: 'ORD', lines: 4, picked: 0, amount: 1088.00, city: 'Denver', phone: '3035550108' },
  { number: '104581', customer: 'Bluewater Marine', shipIn: 12, status: 'ORD', lines: 3, picked: 0, amount: 455.75, city: 'Tampa', phone: '8135550190' },
  { number: '104582', customer: 'Summit Outfitters', shipIn: 14, status: 'HLD', lines: 1, picked: 0, amount: 89.99, city: 'Boise', phone: '2085550111' },
  { number: '104583', customer: 'Granite Builders', shipIn: 18, status: 'ORD', lines: 8, picked: 0, amount: 3650.00, city: 'Salt Lake City', phone: '8015550147' },
  { number: '104584', customer: 'Coastal Bakery', shipIn: 21, status: 'ORD', lines: 2, picked: 0, amount: 162.30, city: 'Charleston', phone: '8435550122' },
];
/** Orders per page, rows 7 to 15. */
export const ORDERS_PAGE = 9;
/** The order Order Status and Delivery Options open on from the menu: a shipped one, so it has a tracking barcode. */
export const DEFAULT_ORDER = '104573';

export const STATUS_NAMES: Record<Order['status'], string> = { ORD: 'Ordered', PCK: 'Picking', SHP: 'Shipped', DLV: 'Delivered', HLD: 'On hold' };

/** The orders list's four titles; each has its own demo definition. */
export const ORDER_VIEWS = {
  list: 'Work with Orders',
  calendar: 'Orders by Ship Date',
  board: 'Orders by Status',
  chart: 'Order Amounts',
} as const;
export type OrderView = keyof typeof ORDER_VIEWS;

export const ORDER_OPTIONS: Record<string, string> = { '5': 'Display', '8': 'Order status' };

export function findOrder(number: string): Order | undefined {
  return ORDERS.find((o) => o.number === number.trim().padStart(6, '0'));
}

function shipDate(order: Order, today: Date): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + order.shipIn);
}
const two = (n: number) => String(n).padStart(2, '0');
/** MM/DD/YY, as the list shows it. */
export const mdy = (d: Date) => `${two(d.getMonth() + 1)}/${two(d.getDate())}/${two(d.getFullYear() % 100)}`;
/** YYYYMMDD, as Order Status shows it. */
export const ymd = (d: Date) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The heading's columns: each value is left-aligned under its heading, numbers right-aligned to its end. */
const COL = { order: 7, customer: 15, ship: 37, status: 48, lines: 56, picked: 63, amount: 74 } as const;

/** Work with Orders (ORD200) under one of its four titles, 9 orders a page. */
export function orders(page: number, view: OrderView = 'list', message?: string, today = new Date()): number[] {
  const title = ORDER_VIEWS[view];
  const s = new HostStream().clear().write()
    .text(1, 2, 'ORD200')
    .text(1, centered(title), title, WHITE)
    .text(1, 72, 'VENEER')
    .text(3, 2, 'Type options, press Enter.', BLUE)
    .text(4, 3, '5=Display', BLUE)
    .text(4, 15, '8=Order status', BLUE)
    .text(6, 2, 'Opt  Order   Customer              Ship date  Status  Lines  Picked     Amount', WHITE);
  ORDERS.slice(page * ORDERS_PAGE, (page + 1) * ORDERS_PAGE).forEach((o, i) => {
    const row = 7 + i;
    const right = (end: number, text: string) => s.text(row, end - text.length + 1, text);
    s.field(row, 3, 2)
      .text(row, COL.order, o.number)
      .text(row, COL.customer, o.customer)
      .text(row, COL.ship, mdy(shipDate(o, today)))
      .text(row, COL.status, o.status);
    right(COL.lines + 4, String(o.lines));
    right(COL.picked + 5, String(o.picked));
    right(COL.amount + 5, money(o.amount));
  });
  const last = (page + 1) * ORDERS_PAGE >= ORDERS.length;
  s.text(16, 73, last ? 'Bottom' : 'More...')
    .text(22, 2, 'F3=Exit   F5=Refresh   F12=Cancel', BLUE);
  if (message) s.text(24, 2, message.slice(0, 78));
  return s.cursor(7, 3).readMdt().build();
}

/** A tracking number for an order that has shipped: all digits, so its Code 128 barcode stays short. */
export const trackingOf = (o: Order) => (o.status === 'SHP' || o.status === 'DLV' ? `9400${o.number}0042` : '');
export const invoiceOf = (o: Order) => `INV-${o.number}`;
/** sales@ and the customer's first word: short enough to stay clear of what is right of it. */
export const emailOf = (o: Order) => `sales@${o.customer.split(' ')[0]!.toLowerCase()}.example`;
const phoneText = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;

/**
 * Order Status (ORD300): one order's details, as text the definition shows
 * as displays. The order number is a field: type another and press Enter.
 * The number is also at 18:70, for the QR code.
 */
export function orderStatus(number: string, message?: string, today = new Date()): number[] {
  const o = findOrder(number) ?? findOrder(DEFAULT_ORDER)!;
  const s = new HostStream().clear().write()
    .text(1, 2, 'ORD300')
    .text(1, centered('Order Status'), 'Order Status', WHITE)
    .text(2, 2, 'Type an order number, press Enter.', BLUE)
    .text(4, 4, 'Order  . . . . .').field(4, 22, 6, { value: o.number })
    .text(6, 4, 'Customer . . . :').text(6, 22, o.customer)
    .text(7, 4, 'Status . . . . :').text(7, 22, o.status)
    .text(8, 4, 'Ship date  . . :').text(8, 22, ymd(shipDate(o, today)))
    // Cents with the decimal point implied, as an RPG program's packed field shows them.
    .text(9, 4, 'Amount . . . . :').text(9, 22, String(Math.round(o.amount * 100)).padStart(9, '0'))
    .text(10, 4, 'Paid . . . . . :').text(10, 22, o.status === 'SHP' || o.status === 'DLV' ? 'Y' : 'N')
    .text(11, 4, 'Picked % . . . :').text(11, 22, String(o.picked))
    .text(12, 4, 'Email  . . . . :').text(12, 22, emailOf(o))
    .text(13, 4, 'Phone  . . . . :').text(13, 22, phoneText(o.phone))
    .text(14, 4, 'Invoice  . . . :').text(14, 22, invoiceOf(o))
    .text(16, 4, 'Tracking . . . :');
  const tracking = trackingOf(o);
  // Blank until it ships: a barcode of blank text draws nothing.
  if (tracking) s.text(16, 22, tracking);
  s.text(18, 70, o.number)
    .text(22, 2, 'F1=Help   F3=Exit   F10=Delivery options   F12=Cancel', BLUE);
  if (message) s.text(24, 2, message.slice(0, 78));
  return s.cursor(4, 22).readMdt().build();
}

/** Carriers the Delivery Options carrier field takes; F4 lists them. */
export const CARRIERS: Record<string, string> = { UPS: 'UPS', FDX: 'FedEx', USPS: 'US Mail', DHL: 'DHL', LTL: 'Freight (LTL)' };

/** Delivery Options' fields and the values each order starts with. */
export const DELIVERY_FIELDS = { after: '7:22', phone: '8:22', carrier: '9:22', notify: '10:22', rating: '11:22' } as const;

/**
 * Delivery Options (DLV100) for an order: deliver-after time (HHMM), contact
 * phone (10 digits), carrier code, notify customer (Y/N) and a service
 * rating (1-5). `typed` shows the user's values again after an error.
 */
export function deliveryOptions(number: string, message?: string, typed?: Map<string, string>, cursor = { row: 7, col: 22 }): number[] {
  const o = findOrder(number) ?? findOrder(DEFAULT_ORDER)!;
  const value = (id: string, host: string) => typed?.get(id) ?? host;
  const F = DELIVERY_FIELDS;
  const s = new HostStream().clear().write()
    .text(1, 2, 'DLV100')
    .text(1, centered('Delivery Options'), 'Delivery Options', WHITE)
    .text(3, 2, 'Type choices, press Enter.', BLUE)
    .text(5, 4, 'Order  . . . . :').text(5, 22, `${o.number}  ${o.customer}`)
    .text(7, 4, 'Deliver after . .').field(7, 22, 4, { value: value(F.after, '1400') }).text(7, 30, 'HHMM, 24-hour', BLUE)
    .text(8, 4, 'Contact phone . .').field(8, 22, 10, { value: value(F.phone, o.phone) }).text(8, 34, 'Digits only', BLUE)
    .text(9, 4, 'Carrier  . . . .').field(9, 22, 6, { ffw: 0x4020, value: value(F.carrier, 'UPS') }).text(9, 30, 'F4 for a list', BLUE)
    .text(10, 4, 'Notify customer').field(10, 22, 1, { ffw: 0x4020, value: value(F.notify, 'Y') }).text(10, 30, 'Y=Yes, N=No', BLUE)
    .text(11, 4, 'Service rating').field(11, 22, 1, { ffw: 0x4700, value: value(F.rating, '4') }).text(11, 30, '1-5', BLUE)
    .text(22, 2, 'F3=Exit   F4=Prompt   F12=Cancel', BLUE);
  if (message) s.text(24, 2, message.slice(0, 78));
  return s.cursor(cursor.row, cursor.col).readMdt().build();
}

/** The carrier list F4 shows on the message line. */
export const CARRIER_LIST = `Carriers: ${Object.entries(CARRIERS).map(([code, name]) => (code === name ? code : `${code} ${name}`)).join(', ')}`;

/**
 * What Delivery Options does with Enter, like a real program: checks each
 * field, putting the cursor on the first bad one, or says what it saved.
 */
export function checkDelivery(fields: Map<string, string>, number: string): { message: string; error?: string } {
  const F = DELIVERY_FIELDS;
  const o = findOrder(number) ?? findOrder(DEFAULT_ORDER)!;
  const get = (id: string, start: string) => (fields.has(id) ? fields.get(id)! : start).trim();
  const after = get(F.after, '1400');
  const phone = get(F.phone, o.phone);
  const carrier = get(F.carrier, 'UPS').toUpperCase();
  const notify = get(F.notify, 'Y').toUpperCase();
  const rating = fields.has(F.rating) ? decodeDigits(fields.get(F.rating)!) : '4';
  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(after)) return { error: F.after, message: `Deliver after ${after || '(blank)'} is not a time: type HHMM, such as 1430.` };
  if (!/^\d{10}$/.test(phone)) return { error: F.phone, message: 'Contact phone must be 10 digits.' };
  if (!CARRIERS[carrier]) return { error: F.carrier, message: `Carrier ${carrier || '(blank)'} is not known. Press F4 for a list.` };
  if (notify !== 'Y' && notify !== 'N') return { error: F.notify, message: 'Notify customer must be Y or N.' };
  if (!/^[1-5]$/.test(rating)) return { error: F.rating, message: 'Service rating must be 1 to 5.' };
  return {
    message: `Saved: after ${after.slice(0, 2)}:${after.slice(2)}, phone ${phoneText(phone)}, ${CARRIERS[carrier]}, ` +
      `notify ${notify}, rating ${rating}`,
  };
}

/** A signed numeric field's digits (the last digit carries the sign in its zone). */
function decodeDigits(text: string): string {
  return text.trim().replace(/[}J-R]$/, (c) => String('}JKLMNOPQR'.indexOf(c))).replace(/[{A-I]$/, (c) => String('{ABCDEFGHI'.indexOf(c)));
}

/** A bill of materials for one bicycle: level, part, description, quantity, unit. */
export const BOM: [number, string, string, number, string][] = [
  [1, 'FRAME-200', 'Frame, touring 56cm', 1, 'EA'],
  [2, 'TUBE-TOP', 'Top tube, steel', 1, 'EA'],
  [2, 'TUBE-DOWN', 'Down tube, steel', 1, 'EA'],
  [2, 'STAY-REAR', 'Rear stays', 1, 'PR'],
  [2, 'FORK-200', 'Fork, steel', 1, 'EA'],
  [3, 'CROWN-12', 'Fork crown', 1, 'EA'],
  [3, 'DROPOUT-F', 'Front dropouts', 2, 'EA'],
  [1, 'WHEEL-F', 'Wheel, front 700c', 1, 'EA'],
  [2, 'RIM-700', 'Rim, 700c 32h', 1, 'EA'],
  [2, 'SPOKE-292', 'Spoke, 292mm', 32, 'EA'],
  [2, 'HUB-F32', 'Hub, front 32h', 1, 'EA'],
  [3, 'BEARING-6', 'Bearing, cartridge', 2, 'EA'],
  [1, 'WHEEL-R', 'Wheel, rear 700c', 1, 'EA'],
  [2, 'RIM-700', 'Rim, 700c 32h', 1, 'EA'],
  [2, 'SPOKE-290', 'Spoke, 290mm', 32, 'EA'],
  [2, 'HUB-R32', 'Hub, rear 32h', 1, 'EA'],
  [1, 'DRIVETRAIN', 'Drivetrain kit', 1, 'KT'],
  [2, 'CRANK-170', 'Crankset, 170mm', 1, 'EA'],
  [2, 'CHAIN-10', 'Chain, 10 speed', 1, 'EA'],
  [2, 'CASSETTE-11', 'Cassette, 11-34', 1, 'EA'],
  [1, 'BELL-01', 'Bell', 1, 'EA'],
  [1, 'MANUAL-EN', 'Owner\'s manual', 1, 'EA'],
];
/** Parts per page, rows 8 to 17. */
export const BOM_PAGE = 10;

/**
 * Display Bill of Materials (BOM100): the parts of BIKE-200, each indented
 * two columns a level under "Component", with its level in "Lvl" too.
 */
export function billOfMaterials(page: number, message?: string): number[] {
  const s = new HostStream().clear().write()
    .text(1, 2, 'BOM100')
    .text(1, centered('Display Bill of Materials'), 'Display Bill of Materials', WHITE)
    .text(3, 2, 'Item . . . . . :   BIKE-200     Touring bicycle')
    .text(4, 2, 'Type options, press Enter.', BLUE)
    .text(5, 3, '5=Display', BLUE)
    .text(7, 2, 'Opt  Lvl  Component        Description              Qty  UOM', WHITE);
  BOM.slice(page * BOM_PAGE, (page + 1) * BOM_PAGE).forEach(([level, part, desc, qty, uom], i) => {
    const row = 8 + i;
    s.field(row, 3, 2)
      .text(row, 7, String(level))
      .text(row, 12 + 2 * (level - 1), part)
      .text(row, 29, desc)
      .text(row, 56 - String(qty).length + 1, String(qty))
      .text(row, 59, uom);
  });
  const last = (page + 1) * BOM_PAGE >= BOM.length;
  s.text(18, 73, last ? 'Bottom' : 'More...')
    .text(22, 2, 'F3=Exit   F12=Cancel', BLUE);
  if (message) s.text(24, 2, message.slice(0, 78));
  return s.cursor(8, 3).readMdt().build();
}
