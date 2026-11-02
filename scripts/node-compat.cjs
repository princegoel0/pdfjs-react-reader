/*
 * Polyfill zstd decompression hook for Node.js <22.14.0 (specifically Node 22.13.0 floor).
 *
 * `undici` >=8.12.0 unconditionally executes `createZstdDecompress.bind(...)` at module load time
 * (`lib/interceptor/decompress.js`), but `node:zlib.createZstdDecompress` was only introduced in Node 22.14.0.
 * In Node 22.13.0 environments (such as CI candidate and verify runners on the declared Node engine floor),
 * loading `jsdom` (which imports `undici`) causes Vitest to throw `TypeError: Cannot read properties of undefined (reading 'bind')`.
 *
 * Providing a no-op PassThrough factory when `createZstdDecompress` is absent allows `undici` to initialize
 * safely without altering production behavior (production package has zero runtime dependencies).
 */
const zlib = require('node:zlib');

if (typeof zlib.createZstdDecompress !== 'function') {
  Object.defineProperty(zlib, 'createZstdDecompress', {
    value: function createZstdDecompress() {
      const { PassThrough } = require('node:stream');
      return new PassThrough();
    },
    writable: true,
    configurable: true,
  });
}
