// Named virtual devices: VENEER01, VENEER02, ... instead of QPADEVxxxx, so
// operators can tell Veneer jobs apart (WRKACTJOB, WRKCFGSTS).

/** IBM i device names: up to 10 characters, starting with a letter. */
const PREFIX = /^[A-Z][A-Z0-9]{0,7}$/;

export class DeviceNamePool {
  readonly prefix: string;
  readonly digits: number;
  readonly capacity: number;
  private readonly inUse = new Set<number>();

  constructor(prefix: string) {
    const p = prefix.toUpperCase();
    if (!PREFIX.test(p)) {
      throw new Error(`Device name prefix "${prefix}" must be 1-8 letters/digits starting with a letter`);
    }
    this.prefix = p;
    // Fill the 10-character name with digits, but no more than 3 (999 devices).
    this.digits = Math.min(3, 10 - p.length);
    this.capacity = 10 ** this.digits - 1;
  }

  /** The lowest free name, or undefined when every name is taken. */
  acquire(): string | undefined {
    for (let n = 1; n <= this.capacity; n++) {
      if (!this.inUse.has(n)) {
        this.inUse.add(n);
        return this.prefix + String(n).padStart(this.digits, '0');
      }
    }
    return undefined;
  }

  release(name: string): void {
    if (!name.startsWith(this.prefix)) return;
    this.inUse.delete(Number(name.slice(this.prefix.length)));
  }

  get size(): number {
    return this.inUse.size;
  }
}
