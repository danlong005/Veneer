// The demo's "other system": a small web server on this machine with a page
// per order (its packing list) and per invoice, for the Order Status screen's
// embedded page and invoice link. It listens on 127.0.0.1 only, on its own
// port, so it is another origin from Veneer's page, as another system would be.

import http from 'node:http';
import { ORDERS, STATUS_NAMES, findOrder, invoiceOf, type Order } from './demoOrders.ts';

/** The port the demo definitions' addresses use. */
export const DOCS_PORT = 8079;

const ITEMS = [
  ['A100', 'Widget, steel', 4.5], ['B200', 'Gadget, brass', 12.25], ['C300', 'Sprocket 12T', 8.0],
  ['D400', 'Flange 2in', 6.75], ['E500', 'Gasket kit', 3.2], ['F600', 'Bearing 6203', 5.4],
  ['G700', 'Bolt M8x40', 0.35], ['H800', 'Hose clamp', 1.1], ['J900', 'Valve, ball 1in', 18.9],
] as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** An order's lines: item, description, quantity, as many as the order has. */
export function linesOf(o: Order): { item: string; description: string; qty: number }[] {
  return Array.from({ length: o.lines }, (_, i) => {
    const [item, description] = ITEMS[(Number(o.number) + i) % ITEMS.length]!;
    return { item, description, qty: ((Number(o.number) * (i + 3)) % 40) + 1 };
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="viewport" content="width=device-width">
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 12px; color: #1d2433; background: #fff; }
  h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #5b6475; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e3e6ec; }
  th { font-weight: 600; color: #5b6475; } td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; padding: 0 6px; border-radius: 8px; background: #eef1f6; }
</style></head><body>${body}</body></html>`;
}

/** The page for a path: /orders/<number> (a packing list) or /invoices/INV-<number>. */
export function docsPage(path: string): { status: number; html: string } {
  const orderPath = /^\/orders\/(\d{1,6})\/?$/.exec(path);
  const invoicePath = /^\/invoices\/INV-(\d{1,6})\/?$/.exec(path);
  const o = findOrder(orderPath?.[1] ?? invoicePath?.[1] ?? '');
  if (!o) {
    return { status: 404, html: page('Not found', `<h1>Not found</h1><p>The demo has orders ${ORDERS[0]!.number} to ${ORDERS.at(-1)!.number}.</p>`) };
  }
  const lines = linesOf(o);
  if (orderPath) {
    const rows = lines.map((l) => `<tr><td>${l.item}</td><td>${escape(l.description)}</td><td class="n">${l.qty}</td></tr>`).join('');
    return {
      status: 200,
      html: page(`Packing list ${o.number}`, `<h1>Packing list · order ${o.number}</h1>
<p>${escape(o.customer)}, ${escape(o.city)} <span class="tag">${STATUS_NAMES[o.status]}</span></p>
<table><thead><tr><th>Item</th><th>Description</th><th class="n">Qty</th></tr></thead><tbody>${rows}</tbody></table>`),
    };
  }
  const total = o.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return {
    status: 200,
    html: page(`Invoice ${invoiceOf(o)}`, `<h1>Invoice ${invoiceOf(o)}</h1>
<p>${escape(o.customer)}, ${escape(o.city)}: ${lines.length} line${lines.length === 1 ? '' : 's'}, total ${total}</p>
<p>A demo page standing in for the invoice in another system.</p>`),
  };
}

/** Starts the documents server on 127.0.0.1; if it can't (the port is taken), says why instead. */
export function startDocsServer(port = DOCS_PORT): Promise<{ server: http.Server; port: number } | { error: string }> {
  const server = http.createServer((req, res) => {
    const { status, html } = req.method === 'GET' ? docsPage(new URL(req.url ?? '/', 'http://x').pathname) : { status: 405, html: '' };
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.once('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code === 'EADDRINUSE' ? `port ${port} is in use` : e.message }));
    server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}
