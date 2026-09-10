/** ID-document edit prompts — keep in lockstep with spark-image/id_pipeline.py. */

export const ID_MIN_EDGE_PX = 800;

export const ID_TYPES = [
  { id: 'drivers_license', label: 'Driver licence' },
  { id: 'passport', label: 'Passport' },
  { id: 'national_id', label: 'National ID' },
  { id: 'residence_permit', label: 'Residence permit' },
  { id: 'other', label: 'Other' },
] as const;

export type IdDocType = (typeof ID_TYPES)[number]['id'];
export type IdKind = 'clean' | 'back' | 'portrait';

/** ISO/IEC 7810 ID-1 millimetres (licence / national ID / residence permit). */
export const ID_1_MM = { w: 85.6, h: 53.98 } as const;
/** ICAO 9303 / ISO/IEC 7810 ID-3 millimetres, portrait data page default. */
export const ID_3_MM = { w: 88, h: 125 } as const;

const ID_1_TYPE_IDS = new Set([
  'drivers_license',
  'drivers_licence',
  'driver_license',
  'driver_licence',
  'licence',
  'license',
  'national_id',
  'residence_permit',
  'id_card',
  'id1',
  'id_1',
]);
const ID_3_TYPE_IDS = new Set(['passport', 'id3', 'id_3']);

function normIdType(idType?: string): string {
  return (idType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Physical document aspect. Scan pixels only pick orientation, never the ratio. */
export function idContentRatio(
  idType?: string,
  srcW = 0,
  srcH = 0,
): { w: number; h: number } {
  const t = normIdType(idType);
  const sw = Math.max(0, Math.round(srcW || 0));
  const sh = Math.max(0, Math.round(srcH || 0));
  if (ID_3_TYPE_IDS.has(t)) {
    if (sw && sh && sw > sh) return { w: ID_3_MM.h, h: ID_3_MM.w };
    return { w: ID_3_MM.w, h: ID_3_MM.h };
  }
  if (ID_1_TYPE_IDS.has(t)) {
    if (sw && sh && sh > sw) return { w: ID_1_MM.h, h: ID_1_MM.w };
    return { w: ID_1_MM.w, h: ID_1_MM.h };
  }
  if (sw && sh) return { w: sw, h: sh };
  return { w: 1, h: 1 };
}

export const ID_CAPTURE_PROMPT =
  'Photorealistic high-resolution photograph of a real government-issued identity document, lying flat on a slightly textured neutral timber surface. Captured with a real smartphone camera, unprocessed look, natural mild sensor noise and subtle chromatic aberration, soft uneven daylight from the upper left creating gentle realistic shadows, no artificial perfection, slight natural card plastic scratch texture visible, micro-print and hologram elements present but not over-sharpened. Slight reflection without obstructing any card data or images. No glare, no fingers, perfect readability of text and photo. Authentic smartphone photography, slight optical imperfections, photorealistic, real-world capture.';

export const ID_CLEAN_PROMPT =
  'Restore this identity document photograph. Remove JPEG blocking, moire, screen glare, finger smudges, and compression ringing. Keep every printed character, number, barcode, MRZ, hologram, ghost portrait, signature, and layout exactly. Do not rewrite, translate, or invent personal data. Do not replace the portrait.';

export const ID_BACK_PROMPT =
  'Restore the back of this identity document. Remove glare, compression, and fingerprints. Keep all printed text, barcodes, mag-stripe area, and layout exactly. Do not invent numbers or machine-readable lines.';

export const ID_PORTRAIT_PROMPT =
  'This is an identity document. Replace only the portrait photograph with the identity from the second image. Keep every printed word, number, MRZ, hologram, ghost image, signature, coat of arms, and card layout. Match ID photo lighting: even flash, slight desaturation, neutral expression, head and shoulders in the portrait window. Do not invent personal data. Do not add watermarks, VERIFIED stamps, or extra faces.';

export const ID_ALTER_PROMPT =
  'Enhance this identity document photo while keeping it looking like a real unprocessed smartphone capture: remove glare and reflections, correct perspective, restore natural sensor noise and slight optical imperfections, avoid any AI-smooth or over-sharpened look, keep original data and layout exactly intact, authentic real-camera appearance.';

export const ID_ALTER_AU_LICENCE_PROMPT =
  "Process this exact Australian driver licence photograph. Keep the identical holder photo, all personal details, licence number, layout, colours, and state-specific design completely unchanged. Correct perspective so the card is perfectly flat and rectangular. Remove all glare, reflections, and hotspots. Naturally sharpen text and security features without over-sharpening. Restore realistic mild sensor noise, subtle chromatic aberration, and natural optical imperfections so it looks like an authentic unretouched smartphone capture. Maintain real card texture and micro-print. Soft uneven natural lighting. No beauty filters, no artificial smoothness, no changes to any data or the holder's face. Photorealistic real-camera result.";

export type IdLook = 'capture' | 'alter' | 'selfie';

export const ID_SELFIE_FROM_LICENCE_PROMPT =
  'Using the person shown in the photograph on this Australian driver licence as the exact identity reference, generate a new high-quality photorealistic selfie of the same individual. The face must be clearly recognisable as the identical person (same age, gender, ethnicity, facial structure, and features). Centered close-up, looking directly at camera, neutral calm expression, eyes open and sharp. Authentic unretouched smartphone photography style with natural skin texture showing real pores, subtle imperfections, and subsurface scattering. Soft uneven window light creating natural asymmetric shadows, realistic irregular corneal specular highlights. Mild sensor noise, subtle chromatic aberration, natural depth of field. No beauty filter, no plastic skin, no perfect symmetry. Photorealistic, high detail, real-camera look.';

export const ID_TEMPLATES = [
  {
    id: 'alter_img2img',
    label: 'Alteration (img2img)',
    idType: 'drivers_license' as const,
    country: 'AU',
    look: 'alter' as const,
    intent: 'id_clean' as const,
    ratioId: 'auto' as const,
    runLabel: 'Run alteration',
    hint: 'Qwen-Edit img2img: flatten, deglare, keep AU licence data exact.',
    prompt: `${ID_ALTER_PROMPT}\n\n${ID_ALTER_AU_LICENCE_PROMPT}`,
  },
  {
    id: 'au_licence_selfie',
    label: 'Licence selfie',
    idType: 'drivers_license' as const,
    country: 'AU',
    look: 'selfie' as const,
    intent: 'edit' as const,
    ratioId: '3:4' as const,
    runLabel: 'Run licence selfie',
    hint: 'Qwen-Edit img2img: selfie of the person on the AU licence. Not a document restore.',
    prompt: ID_SELFIE_FROM_LICENCE_PROMPT,
  },
] as const;

/** Always last in composeIdPrompt so user notes cannot override the copy-lock. */
export const ID_LOCK_PROMPT =
  'Copy every printed character from the first image exactly: same letters, digits, punctuation, spacing, fonts, kerning, and positions. Names, dates, document numbers, MRZ, barcodes, and signatures must match the reference with zero changes. Copy every document graphic from the first image exactly: coat of arms, guilloche, holograms, kinegrams, ghost portrait, microprint, rainbow printing, visible UV patterns, stamps, and layout. Do not OCR, rewrite, translate, autocorrect, or invent text or graphics.';

export const ID_NEGATIVE_PROMPT =
  'rewritten text, different numbers, OCR errors, translated text, new name, invented MRZ, misspelled words, warped letters, extra hologram, extra stamp, VERIFIED watermark, different coat of arms, different guilloche, fingers, heavy glare, studio lighting, beauty filter, floating document, seamless backdrop, perfect symmetry, over-sharpened OCR, plastic beauty skin';

export function composeIdPrompt(opts: {
  kind: IdKind;
  userPrompt?: string;
  idType?: string;
  country?: string;
  look?: string;
}): string {
  const kind = (opts.kind || 'portrait').toLowerCase();
  const base = kind === 'clean' ? ID_CLEAN_PROMPT : kind === 'back' ? ID_BACK_PROMPT : ID_PORTRAIT_PROMPT;
  const bits = [base];
  const t = normIdType(opts.idType);
  if (t && t !== 'other') bits.push(`Document type: ${t.replace(/_/g, ' ')}.`);
  if (ID_3_TYPE_IDS.has(t)) {
    bits.push('Physical size: ICAO 9303 / ISO/IEC 7810 ID-3 (88 × 125 mm). Keep this aspect; do not stretch or squash.');
  } else if (ID_1_TYPE_IDS.has(t)) {
    bits.push('Physical size: ISO/IEC 7810 ID-1 (85.60 × 53.98 mm). Keep this aspect; do not stretch or squash.');
  }
  const cc = (opts.country || '').trim().toUpperCase();
  if (cc) bits.push(`Issuing country code: ${cc}.`);
  const look = (opts.look || 'capture').trim().toLowerCase().replace(/-/g, '_');
  const extra = (opts.userPrompt || '').trim();
  const alter = look === 'alter' || look === 'img2img' || look === 'alteration' || look === 'alter_img2img' || look === 'id_alter';
  if (alter) {
    if (extra) bits.push(extra.replace(/\.+$/, ''));
    else bits.push(`${ID_ALTER_PROMPT} ${ID_ALTER_AU_LICENCE_PROMPT}`);
  } else {
    bits.push(ID_CAPTURE_PROMPT);
    if (extra) bits.push(extra.replace(/\.+$/, ''));
  }
  bits.push(ID_LOCK_PROMPT);
  return bits.join(' ');
}

export function idIntent(kind: IdKind): 'id_clean' | 'id_back' | 'id_portrait' {
  if (kind === 'clean') return 'id_clean';
  if (kind === 'back') return 'id_back';
  return 'id_portrait';
}

export function lowRes(width: number, height: number, limit = ID_MIN_EDGE_PX): boolean {
  return Math.min(width, height) < limit;
}

export function probeImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read image size'));
    img.src = src;
  });
}
