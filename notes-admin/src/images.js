const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 3200;
const OPTIMIZE_ABOVE_BYTES = 8 * 1024 * 1024;

const MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

const EXTENSION_MIME = Object.fromEntries(Object.entries(MIME_EXTENSION).map(([mime, extension]) => [extension, mime]));
EXTENSION_MIME.jpeg = 'image/jpeg';

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp,image/svg+xml,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.svg,.heic,.heif';

function extensionOf(name = '') {
  return String(name).split('.').pop()?.toLowerCase() || '';
}

function asciiBaseName(name = '') {
  const withoutExtension = String(name).replace(/\.[^.]+$/, '');
  const normalized = withoutExtension.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'image';
}

function bytesStartWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

export async function detectImageType(file) {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = new TextDecoder('ascii').decode(bytes);
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (/^GIF8[79]a/.test(text)) return 'image/gif';
  if (/^RIFF....WEBP/s.test(text)) return 'image/webp';
  if (bytesStartWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  const brand = text.slice(4, 16).toLowerCase();
  if (brand.includes('ftypavif') || brand.includes('ftypavis')) return 'image/avif';
  if (/ftyp(?:heic|heix|hevc|hevx|heim|heis|mif1|msf1)/i.test(brand)) return 'image/heic';
  const beginning = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(beginning)) return 'image/svg+xml';
  const declared = String(file.type || '').toLowerCase();
  if (MIME_EXTENSION[declared]) return declared;
  return EXTENSION_MIME[extensionOf(file.name)] || '';
}

function makeFile(blob, originalName, mime) {
  const extension = MIME_EXTENSION[mime];
  return new File([blob], `${asciiBaseName(originalName)}.${extension}`, { type: mime, lastModified: Date.now() });
}

async function decodeBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像の書き出しに失敗しました。')), type, quality));
}

async function rasterize(file, { force = false } = {}) {
  const bitmap = await decodeBitmap(file);
  try {
    const width = bitmap.naturalWidth || bitmap.width;
    const height = bitmap.naturalHeight || bitmap.height;
    if (!width || !height) throw new Error('画像の縦横サイズを読み取れませんでした。');
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    if (!force && scale === 1 && file.size <= OPTIMIZE_ABOVE_BYTES) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('画像変換用のCanvasを作成できませんでした。');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, 'image/webp', 0.86);
    return makeFile(blob, file.name, 'image/webp');
  } finally {
    bitmap.close?.();
  }
}

async function convertHeic(file) {
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!(blob instanceof Blob) || !blob.size) throw new Error('HEICからJPEGへ変換できませんでした。');
  return makeFile(blob, file.name, 'image/jpeg');
}

function uniqueImagePath(file, index) {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `${Date.now().toString(36)}${index.toString(36)}`;
  return `assets/images/notes/${Date.now()}-${id}-${file.name}`;
}

export async function prepareImageFiles(files) {
  const images = [];
  const messages = [];
  for (const [index, original] of [...files].entries()) {
    if (!original.size) throw new Error(`${original.name}: 空のファイルです。`);
    if (original.size > MAX_INPUT_BYTES) throw new Error(`${original.name}: 40MBを超える画像は選択できません。`);
    const detected = await detectImageType(original);
    if (!detected) throw new Error(`${original.name}: 対応画像として判別できません。JPEG・PNG・WebP・GIF・AVIF・BMP・SVG・HEICを使用してください。`);

    let prepared;
    let needsBuildConversion = false;
    if (detected === 'image/heic' || detected === 'image/heif') {
      try {
        prepared = await convertHeic(original);
        messages.push(`${original.name} をJPEGへ変換しました。`);
      } catch {
        prepared = makeFile(original, original.name, detected);
        needsBuildConversion = true;
        messages.push(`${original.name} は公開ビルド時にJPEGへ変換します。`);
      }
    } else if (detected === 'image/svg+xml') {
      prepared = await rasterize(makeFile(original, original.name, detected), { force: true });
      messages.push(`${original.name} を安全なWebP画像へ変換しました。`);
    } else if (detected === 'image/gif') {
      prepared = makeFile(original, original.name, detected);
    } else {
      const typed = makeFile(original, original.name, detected);
      prepared = await rasterize(typed);
      if (prepared !== typed) messages.push(`${original.name} をWeb表示向けに縮小・最適化しました。`);
    }

    if (prepared.size > MAX_OUTPUT_BYTES) throw new Error(`${original.name}: 変換後も15MBを超えています。元画像を小さくしてください。`);
    images.push({ file: prepared, originalName: original.name, path: uniqueImagePath(prepared, index), needsBuildConversion });
  }
  return { images, messages };
}
