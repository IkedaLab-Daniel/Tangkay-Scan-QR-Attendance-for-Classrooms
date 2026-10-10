/**
 * One-time script: generates soft-color preset background WebP images
 * into apps/api/assets/presets/.
 *
 * Run from the repo root:
 *   npx ts-node apps/api/scripts/generatePresets.ts
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = path.join(__dirname, '..', 'assets', 'presets');

const PRESETS: Array<{ id: string; name: string; color: { r: number; g: number; b: number } }> = [
  { id: 'paper',  name: 'Paper',  color: { r: 0xfa, g: 0xf7, b: 0xf2 } },
  { id: 'sprout', name: 'Sprout', color: { r: 0xdd, g: 0xf0, b: 0xdf } },
  { id: 'oat',    name: 'Oat',    color: { r: 0xf1, g: 0xeb, b: 0xe0 } },
];

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const preset of PRESETS) {
    const outPath = path.join(OUTPUT_DIR, `${preset.id}.webp`);
    await sharp({
      create: {
        width: 400,
        height: 400,
        channels: 3,
        background: preset.color,
      },
    })
      .webp({ quality: 80 })
      .toFile(outPath);
    console.log(`[presets] generated ${outPath}`);
  }

  console.log('[presets] done — all preset images created.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
