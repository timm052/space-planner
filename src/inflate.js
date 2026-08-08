// One inflate that works in both places.
//
// PDF (and therefore .ai) content streams are usually FlateDecode. The browser
// has DecompressionStream and Node has zlib; neither is available in the other,
// and hand-rolling DEFLATE to avoid the split would be ~200 lines of bit
// twiddling whose failure mode is silently wrong geometry. This picks whichever
// exists, so the importer is exercised by the same code in tests and at runtime.

/**
 * @param {Uint8Array} bytes zlib- or raw-deflate-compressed data.
 * @returns {Promise<Uint8Array>}
 */
export async function inflate(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // zlib streams start 0x78; anything else is likely raw deflate.
  const looksZlib = u8[0] === 0x78;

  if (typeof DecompressionStream === 'function') {
    for (const fmt of looksZlib ? ['deflate', 'deflate-raw'] : ['deflate-raw', 'deflate']) {
      try {
        const ds = new DecompressionStream(fmt);
        const stream = new Blob([u8]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        /* try the other framing */
      }
    }
    throw new Error('Could not inflate the stream');
  }

  const zlib = await import('node:zlib');
  try {
    return new Uint8Array(looksZlib ? zlib.inflateSync(u8) : zlib.inflateRawSync(u8));
  } catch {
    return new Uint8Array(looksZlib ? zlib.inflateRawSync(u8) : zlib.inflateSync(u8));
  }
}
