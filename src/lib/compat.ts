/**
 * Safe runtime polyfills for ECMAScript features required by `pdfjs-dist@6` that may be
 * absent in certain supported browser or runtime engines (e.g. `Map.prototype.getOrInsertComputed`
 * in Safari 18.0–18.6 and iOS Safari 18, and `Uint8Array.prototype.toHex` in Node <24).
 *
 * Zero dependencies, pure standard JS, idempotent.
 */
export function installPolyfills(): void {
  if (typeof Map !== 'undefined' && typeof (Map.prototype as any).getOrInsertComputed !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value: function getOrInsertComputed<K, V>(this: Map<K, V>, key: K, callback: (k: K) => V): V {
        if (this.has(key)) {
          return this.get(key)!;
        }
        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof Map !== 'undefined' && typeof (Map.prototype as any).getOrInsert !== 'function') {
    Object.defineProperty(Map.prototype, 'getOrInsert', {
      value: function getOrInsert<K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
        if (this.has(key)) {
          return this.get(key)!;
        }
        this.set(key, defaultValue);
        return defaultValue;
      },
      writable: true,
      configurable: true,
    });
  }

  if (typeof Uint8Array !== 'undefined' && typeof (Uint8Array.prototype as any).toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value: function toHex(this: Uint8Array): string {
        let hex = '';
        for (let i = 0; i < this.length; i++) {
          hex += this[i]!.toString(16).padStart(2, '0');
        }
        return hex;
      },
      writable: true,
      configurable: true,
    });
  }
}

installPolyfills();
