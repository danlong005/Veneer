// npm run demo:record: records each demo screen that has a definition into
// dev/screens/snapshots/, as the designer's Record for checks would, so
// `npm run check:screens -- packages/server/dev/screens` checks the demo's
// definitions. Run it again after changing a demo screen.

import { matchScreen } from '@veneer/screens';
import { getCodepage, type ScreenSnapshot } from '@veneer/terminal';
import * as tn3270 from '@veneer/tn3270';
import * as tn5250 from '@veneer/tn5250';
import { ScreenStore } from '../src/store.ts';
import { contacts, customerAddresses, jobs, orderEntry, shippingNotes, spoolFile } from './demoHost.ts';
import { CUSTOMERS as CUSTOMERS_3270, orders as orders3270, update, type Capabilities } from './demoHost3270.ts';
import { DEFAULT_ORDER, ORDER_VIEWS, billOfMaterials, deliveryOptions, orderStatus, orders, type OrderView } from './demoOrders.ts';
import { fileURLToPath } from 'node:url';

const cp = getCodepage(37);

function screen5250(stream: number[]): ScreenSnapshot {
  const t = new tn5250.Terminal({ codepage: cp, terminalType: 'IBM-3179-2', sendRecord: () => {} });
  t.processRecord(tn5250.buildRecord(0x03, stream));
  return tn5250.snapshot(t.screen, cp);
}

function screen3270(stream: number[]): ScreenSnapshot {
  const t = new tn3270.Terminal({ codepage: cp, model: 2, send3270: () => {}, sendSscpLu: () => {} });
  t.processRecord(Uint8Array.from(stream));
  return tn3270.snapshot(t.screen, cp);
}

const caps3270: Capabilities = { extended: true, alternate: { rows: 24, cols: 80 } };
// A fixed date, so the recorded order screens show the same dates each time.
const today = new Date(2026, 0, 15);

const screens: ScreenSnapshot[] = [
  screen5250(jobs(0)),
  screen5250(orderEntry()),
  screen5250(customerAddresses(0)),
  screen5250(contacts(0, undefined, 'cards')),
  screen5250(contacts(0, undefined, 'map')),
  screen5250(shippingNotes()),
  screen5250(spoolFile(0)),
  ...(Object.keys(ORDER_VIEWS) as OrderView[]).map((view) => screen5250(orders(0, view, undefined, today))),
  screen5250(orderStatus(DEFAULT_ORDER, undefined, today)),
  screen5250(deliveryOptions(DEFAULT_ORDER)),
  screen5250(billOfMaterials(0)),
  screen3270(update(caps3270, CUSTOMERS_3270[0])),
  screen3270(orders3270(caps3270, 0)),
];

const store = new ScreenStore(fileURLToPath(new URL('./screens', import.meta.url)));
await store.load();
const recorded = new Set<string>();
for (const snap of screens) {
  const def = matchScreen(snap, store.list());
  if (!def || recorded.has(def.id)) continue;
  await store.saveRecording({ name: def.id, definition: def.id, screen: snap });
  recorded.add(def.id);
}
const missing = store.list().filter((d) => !recorded.has(d.id)).map((d) => d.id);
console.log(`Recorded ${recorded.size} screens in ${store.dir}/snapshots.${missing.length ? ` No demo screen for: ${missing.join(', ')}.` : ''}`);
if (missing.length) process.exitCode = 1;
