// SPEC §9.2 step 1: trust the bytes, not the file name or Content-Type.

export type SniffedImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif';

export function sniffImageMime(head: Uint8Array): SniffedImage | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

/** HEIC and HEIF are interchangeable for upload purposes. */
export function mimeMatches(declared: string, sniffed: SniffedImage): boolean {
  const heif = (m: string) => m === 'image/heic' || m === 'image/heif';
  return declared === sniffed || (heif(declared) && heif(sniffed));
}
