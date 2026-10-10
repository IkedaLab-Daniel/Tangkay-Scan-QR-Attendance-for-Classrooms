import sharp from 'sharp';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProcessImageOptions {
  /** Max pixels on the long edge. Default: 1600 */
  maxLongEdgePx?: number;
  /** WebP quality 1–100. Default: 80 */
  quality?: number;
  /** Strip all EXIF metadata. Default: true */
  stripExif?: boolean;
}

export interface ProcessImageResult {
  buffer: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

export type ImageType = 'jpeg' | 'png' | 'webp';

// ─── Signature validation ─────────────────────────────────────────────────────

/**
 * Checks the first bytes (magic numbers) of a buffer to detect image type.
 * Returns null for anything not JPEG, PNG, or WebP (SVG, GIF, BMP, etc.).
 */
export function validateImageSignature(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }

  // WebP: RIFF????WEBP (bytes 0-3 = "RIFF", bytes 8-11 = "WEBP")
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

// ─── Image processing ─────────────────────────────────────────────────────────

/**
 * Validates, resizes, and re-encodes an image buffer to WebP.
 * - Rejects invalid image types (not JPEG, PNG, or WebP).
 * - Resizes to fit within maxLongEdgePx on the long edge; never upscales.
 * - Strips all EXIF metadata (GPS, device info, timestamps).
 * - Always outputs WebP.
 */
export async function processImage(
  inputBuffer: Buffer,
  options: ProcessImageOptions = {},
): Promise<ProcessImageResult> {
  const { maxLongEdgePx = 1600, quality = 80, stripExif = true } = options;

  const imageType = validateImageSignature(inputBuffer);
  if (!imageType) {
    throw new Error('Invalid image: must be JPEG, PNG, or WebP');
  }

  // Sharp strips all metadata by default when re-encoding. Only call withMetadata()
  // if the caller explicitly wants to preserve it (stripExif = false).
  let pipeline = stripExif ? sharp(inputBuffer) : sharp(inputBuffer).withMetadata();

  // Resize: fit within maxLongEdgePx on the long edge, never upscale
  pipeline = pipeline.resize({
    width: maxLongEdgePx,
    height: maxLongEdgePx,
    fit: 'inside',
    withoutEnlargement: true,
  });

  // Encode to WebP
  pipeline = pipeline.webp({ quality });

  const outputBuffer = await pipeline.toBuffer({ resolveWithObject: false }) as Buffer;

  // Read back dimensions from the output
  const meta = await sharp(outputBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  return {
    buffer: outputBuffer,
    mimeType: 'image/webp',
    width,
    height,
  };
}

// ─── Luminance scrim ──────────────────────────────────────────────────────────

/**
 * Computes average luminance from a raw image buffer.
 * Returns 'dark' if the image is light (luminance > 127) — a dark overlay is
 * needed to make text legible. Returns 'light' otherwise.
 */
export async function computeLuminanceScrim(buffer: Buffer): Promise<'light' | 'dark'> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { channels } = info;
  let total = 0;
  let pixelCount = 0;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    pixelCount++;
  }

  const avgLuminance = pixelCount > 0 ? total / pixelCount : 0;
  return avgLuminance > 127 ? 'dark' : 'light';
}

// ─── Placeholder ──────────────────────────────────────────────────────────────

/**
 * Generates a tiny blurred 20×20 WebP thumbnail as a base64 data URI.
 * Used as an LQIP (low-quality image placeholder) for backgrounds.
 */
export async function generatePlaceholder(buffer: Buffer): Promise<string> {
  const thumb = await sharp(buffer)
    .resize(20, 20, { fit: 'inside' })
    .blur(3)
    .webp({ quality: 20 })
    .toBuffer();
  return 'data:image/webp;base64,' + thumb.toString('base64');
}
