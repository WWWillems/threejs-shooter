import sharp from "sharp";

/**
 * How badly the wrap-around edges disagree, relative to the image's own
 * pixel-to-pixel variation. ~1 means the seam is no worse than any other
 * column/row (tiles cleanly); 2+ means a visible seam.
 */
export async function seamScore(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = (x, y) => data[y * w + x];

  let seamV = 0;
  let seamH = 0;
  for (let y = 0; y < h; y++) seamV += Math.abs(px(0, y) - px(w - 1, y));
  for (let x = 0; x < w; x++) seamH += Math.abs(px(x, 0) - px(x, h - 1));

  let baseV = 0;
  let baseH = 0;
  let nV = 0;
  let nH = 0;
  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 64));
  for (let x = 1; x < w; x += stepX) {
    for (let y = 0; y < h; y++) baseV += Math.abs(px(x, y) - px(x - 1, y));
    nV++;
  }
  for (let y = 1; y < h; y += stepY) {
    for (let x = 0; x < w; x++) baseH += Math.abs(px(x, y) - px(x, y - 1));
    nH++;
  }

  const sv = seamV / h;
  const sh = seamH / w;
  const bv = baseV / (nV * h);
  const bh = baseH / (nH * w);
  const ratioV = sv / Math.max(bv, 1e-6);
  const ratioH = sh / Math.max(bh, 1e-6);
  return {
    vertical: sv,
    horizontal: sh,
    baselineV: bv,
    baselineH: bh,
    ratio: Math.max(ratioV, ratioH),
    /** absolute mean difference across the worse seam, 0..255 */
    absolute: Math.max(sv, sh),
  };
}

/** Roll the image by half its size so the outer edges meet in the centre. */
export async function offsetHalf(buf) {
  const { width, height } = await sharp(buf).metadata();
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  const q = (left, top, w, h) => sharp(buf).extract({ left, top, width: w, height: h }).png().toBuffer();
  const [tl, tr, bl, br] = await Promise.all([
    q(0, 0, hw, hh),
    q(hw, 0, width - hw, hh),
    q(0, hh, hw, height - hh),
    q(hw, hh, width - hw, height - hh),
  ]);
  return sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .composite([
      { input: br, left: 0, top: 0 },
      { input: bl, left: width - hw, top: 0 },
      { input: tr, left: 0, top: height - hh },
      { input: tl, left: width - hw, top: height - hh },
    ])
    .png()
    .toBuffer();
}

/**
 * RGBA PNG mask: opaque everywhere except a transparent cross through the
 * centre (the API repaints transparent pixels only).
 */
export async function seamMask(width, height, fraction = 0.06) {
  const bw = Math.max(16, Math.round(width * fraction));
  const bh = Math.max(16, Math.round(height * fraction));
  const x0 = Math.floor(width / 2 - bw / 2);
  const x1 = x0 + bw;
  const y0 = Math.floor(height / 2 - bh / 2);
  const y1 = y0 + bh;
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((x >= x0 && x < x1) || (y >= y0 && y < y1)) data[(y * width + x) * 4 + 3] = 0;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 2x2 repeat preview, downscaled so the whole thing fits in `maxSize`. */
export async function tileCheck(buf, outPath, maxSize = 1024) {
  const { width, height } = await sharp(buf).metadata();
  const tile = await sharp(buf).png().toBuffer();
  await sharp({ create: { width: width * 2, height: height * 2, channels: 3, background: "#000000" } })
    .composite([
      { input: tile, left: 0, top: 0 },
      { input: tile, left: width, top: 0 },
      { input: tile, left: 0, top: height },
      { input: tile, left: width, top: height },
    ])
    .png()
    .resize({ width: Math.min(maxSize, width * 2), height: Math.min(maxSize, height * 2), fit: "inside" })
    .toFile(outPath);
}
