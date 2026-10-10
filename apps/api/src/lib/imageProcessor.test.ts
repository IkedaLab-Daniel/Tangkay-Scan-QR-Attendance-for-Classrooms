import sharp from 'sharp';
import { validateImageSignature, processImage, computeLuminanceScrim, generatePlaceholder } from './imageProcessor';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Generate a minimal 10×10 JPEG buffer using sharp */
async function makeJpegBuffer(width = 10, height = 10): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

/** Generate a minimal 10×10 PNG buffer using sharp */
async function makePngBuffer(width = 10, height = 10): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

/** Generate a minimal WebP buffer using sharp */
async function makeWebpBuffer(width = 10, height = 10): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .webp()
    .toBuffer();
}

// ─── validateImageSignature ────────────────────────────────────────────────────

describe('validateImageSignature', () => {
  it('detects JPEG', async () => {
    const buf = await makeJpegBuffer();
    expect(validateImageSignature(buf)).toBe('jpeg');
  });

  it('detects PNG', async () => {
    const buf = await makePngBuffer();
    expect(validateImageSignature(buf)).toBe('png');
  });

  it('detects WebP', async () => {
    const buf = await makeWebpBuffer();
    expect(validateImageSignature(buf)).toBe('webp');
  });

  it('returns null for random bytes', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    expect(validateImageSignature(buf)).toBeNull();
  });

  it('returns null for SVG header', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(validateImageSignature(buf)).toBeNull();
  });

  it('returns null for GIF header', () => {
    const buf = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00');
    expect(validateImageSignature(buf)).toBeNull();
  });

  it('returns null for a buffer shorter than 12 bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff]); // Only 3 bytes — too short for full check
    // JPEG check only needs 3 bytes — should still detect it
    expect(validateImageSignature(buf)).toBeNull(); // less than 12 bytes → null
  });
});

// ─── processImage ─────────────────────────────────────────────────────────────

describe('processImage', () => {
  it('converts a JPEG to WebP', async () => {
    const jpeg = await makeJpegBuffer(10, 10);
    const result = await processImage(jpeg);

    expect(result.mimeType).toBe('image/webp');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);

    // Verify output is really WebP by checking its signature
    expect(validateImageSignature(result.buffer)).toBe('webp');
  });

  it('converts a PNG to WebP', async () => {
    const png = await makePngBuffer(10, 10);
    const result = await processImage(png);

    expect(result.mimeType).toBe('image/webp');
    expect(validateImageSignature(result.buffer)).toBe('webp');
  });

  it('converts a WebP to WebP', async () => {
    const webp = await makeWebpBuffer(10, 10);
    const result = await processImage(webp);

    expect(result.mimeType).toBe('image/webp');
    expect(validateImageSignature(result.buffer)).toBe('webp');
  });

  it('returns correct dimensions for a 10×10 input (no resize needed)', async () => {
    const jpeg = await makeJpegBuffer(10, 10);
    const result = await processImage(jpeg, { maxLongEdgePx: 1600 });

    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });

  it('resizes a large image so the long edge is at most maxLongEdgePx', async () => {
    // Make a 400×200 image and cap at 200 — should produce 200×100
    const jpeg = await makeJpegBuffer(400, 200);
    const result = await processImage(jpeg, { maxLongEdgePx: 200 });

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(200);
    // Aspect ratio preserved: width ≈ 2× height
    expect(result.width / result.height).toBeCloseTo(2, 0);
  });

  it('does not upscale small images', async () => {
    const jpeg = await makeJpegBuffer(10, 10);
    const result = await processImage(jpeg, { maxLongEdgePx: 1600 });

    // Should not be enlarged beyond original size
    expect(result.width).toBeLessThanOrEqual(1600);
    expect(result.height).toBeLessThanOrEqual(1600);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });

  it('strips EXIF metadata from the output', async () => {
    const jpeg = await makeJpegBuffer(10, 10);
    const result = await processImage(jpeg, { stripExif: true });

    // WebP output should have no EXIF data
    const meta = await sharp(result.buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('throws for an invalid image buffer', async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
    await expect(processImage(garbage)).rejects.toThrow('Invalid image');
  });

  it('throws for an SVG buffer', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(processImage(svg)).rejects.toThrow('Invalid image');
  });
});

// ─── computeLuminanceScrim ─────────────────────────────────────────────────────

describe('computeLuminanceScrim', () => {
  it('returns "dark" for a very bright (white) image', async () => {
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const result = await computeLuminanceScrim(buf);
    expect(result).toBe('dark');
  });

  it('returns "light" for a very dark (near-black) image', async () => {
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();
    const result = await computeLuminanceScrim(buf);
    expect(result).toBe('light');
  });

  it('works on a WebP buffer too', async () => {
    const buf = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .webp()
      .toBuffer();
    const result = await computeLuminanceScrim(buf);
    // Luminance > 127 → 'dark'
    expect(result).toBe('dark');
  });
});

// ─── generatePlaceholder ──────────────────────────────────────────────────────

describe('generatePlaceholder', () => {
  it('returns a data URI string starting with data:image/webp;base64,', async () => {
    const buf = await makeJpegBuffer(100, 100);
    const result = await generatePlaceholder(buf);
    expect(typeof result).toBe('string');
    expect(result.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('base64 payload is non-empty and decodes to a valid buffer', async () => {
    const buf = await makeJpegBuffer(50, 50);
    const result = await generatePlaceholder(buf);
    const b64 = result.replace('data:image/webp;base64,', '');
    const decoded = Buffer.from(b64, 'base64');
    expect(decoded.length).toBeGreaterThan(0);
    // Verify it's a valid WebP by checking magic bytes
    expect(validateImageSignature(decoded)).toBe('webp');
  });

  it('produces a very small output (thumbnail ≤ 5 KB)', async () => {
    const buf = await makeJpegBuffer(800, 600);
    const result = await generatePlaceholder(buf);
    const b64 = result.replace('data:image/webp;base64,', '');
    const decoded = Buffer.from(b64, 'base64');
    expect(decoded.length).toBeLessThan(5 * 1024);
  });
});
