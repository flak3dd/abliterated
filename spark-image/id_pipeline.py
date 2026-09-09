"""ID-document edit prompts for Qwen-Edit on Spark.

Not LaMa / ESRGAN / StyleGAN / CycleGAN / a hosted verify API — those
are not in this stack. Portrait swap is Qwen-Edit-Plus multi-ref
(target = document, identity = headshot). Cleanup is a text-preserving
edit pass. No synthetic identity, no invented MRZ/numbers, no official
VERIFIED hologram.
"""
from __future__ import annotations

from typing import Any, Optional

MIN_EDGE_PX = 800
ID_MIN_EDGE_PX = MIN_EDGE_PX

ID_TYPES = (
    "drivers_license",
    "passport",
    "national_id",
    "residence_permit",
    "other",
)

# ISO/IEC 7810 millimetres. Content ratio is physical; media frame is independent.
ID_1_MM = (85.60, 53.98)  # credit-card / licence / national ID / residence permit
ID_3_MM = (88.0, 125.0)  # ICAO 9303 passport data page, portrait default (W×H)

ID_1_TYPES = frozenset({
    "drivers_license",
    "drivers_licence",
    "driver_license",
    "driver_licence",
    "licence",
    "license",
    "national_id",
    "residence_permit",
    "id_card",
    "id1",
    "id_1",
})
ID_3_TYPES = frozenset({"passport", "id3", "id_3"})


def _norm_id_type(id_type: str) -> str:
    return (id_type or "").strip().lower().replace(" ", "_").replace("-", "_")


def id_content_ratio(id_type: str, src_w: int = 0, src_h: int = 0) -> tuple[float, float]:
    """Physical document aspect. Scan pixels only pick orientation, never the ratio.

    Licence / national ID / residence permit → ID-1 85.60:53.98 (swap if scan is portrait).
    Passport → ID-3 88:125 portrait; 125:88 if the scan is wider.
    other → source pixels (or 1:1 when unknown).
    """
    t = _norm_id_type(id_type)
    sw, sh = max(0, int(src_w or 0)), max(0, int(src_h or 0))
    if t in ID_3_TYPES:
        if sw and sh and sw > sh:
            return (ID_3_MM[1], ID_3_MM[0])  # 125 × 88 landscape scan
        return ID_3_MM
    if t in ID_1_TYPES:
        if sw and sh and sh > sw:
            return (ID_1_MM[1], ID_1_MM[0])
        return ID_1_MM
    if sw and sh:
        return (float(sw), float(sh))
    return (1.0, 1.0)


ID_CAPTURE_PROMPT = (
    "Photorealistic high-resolution photograph of a real government-issued identity "
    "document, lying flat on a slightly textured neutral timber surface. Captured "
    "with a real smartphone camera, unprocessed look, natural mild sensor noise and "
    "subtle chromatic aberration, soft uneven daylight from the upper left creating "
    "gentle realistic shadows, no artificial perfection, slight natural card plastic "
    "scratch texture visible, micro-print and hologram elements present but not "
    "over-sharpened. Slight reflection without obstructing any card data or images. "
    "No glare, no fingers, perfect readability of text and photo. Authentic smartphone "
    "photography, slight optical imperfections, photorealistic, real-world capture."
)

ID_CLEAN_PROMPT = (
    "Restore this identity document photograph. Remove JPEG blocking, moire, "
    "screen glare, finger smudges, and compression ringing. Keep every printed "
    "character, number, barcode, MRZ, hologram, ghost portrait, signature, and "
    "layout exactly. Do not rewrite, translate, or invent personal data. Do not "
    "replace the portrait."
)

ID_BACK_PROMPT = (
    "Restore the back of this identity document. Remove glare, compression, and "
    "fingerprints. Keep all printed text, barcodes, mag-stripe area, and layout "
    "exactly. Do not invent numbers or machine-readable lines."
)

ID_PORTRAIT_PROMPT = (
    "This is an identity document. Replace only the portrait photograph with the "
    "identity from the second image. Keep every printed word, number, MRZ, "
    "hologram, ghost image, signature, coat of arms, and card layout. Match ID "
    "photo lighting: even flash, slight desaturation, neutral expression, head "
    "and shoulders in the portrait window. Do not invent personal data. Do not "
    "add watermarks, VERIFIED stamps, or extra faces."
)

ID_ALTER_PROMPT = (
    "Enhance this identity document photo while keeping it looking like a real "
    "unprocessed smartphone capture: remove glare and reflections, correct "
    "perspective, restore natural sensor noise and slight optical imperfections, "
    "avoid any AI-smooth or over-sharpened look, keep original data and layout "
    "exactly intact, authentic real-camera appearance."
)

ID_SELFIE_FROM_LICENCE_PROMPT = (
    "Using the person shown in the photograph on this Australian driver licence as "
    "the exact identity reference, generate a new high-quality photorealistic selfie "
    "of the same individual. The face must be clearly recognisable as the identical "
    "person (same age, gender, ethnicity, facial structure, and features). Centered "
    "close-up, looking directly at camera, neutral calm expression, eyes open and "
    "sharp. Authentic unretouched smartphone photography style with natural skin "
    "texture showing real pores, subtle imperfections, and subsurface scattering. "
    "Soft uneven window light creating natural asymmetric shadows, realistic irregular "
    "corneal specular highlights. Mild sensor noise, subtle chromatic aberration, "
    "natural depth of field. No beauty filter, no plastic skin, no perfect symmetry. "
    "Photorealistic, high detail, real-camera look."
)

ID_ALTER_AU_LICENCE_PROMPT = (
    "Process this exact Australian driver licence photograph. Keep the identical "
    "holder photo, all personal details, licence number, layout, colours, and "
    "state-specific design completely unchanged. Correct perspective so the card "
    "is perfectly flat and rectangular. Remove all glare, reflections, and "
    "hotspots. Naturally sharpen text and security features without over-sharpening. "
    "Restore realistic mild sensor noise, subtle chromatic aberration, and natural "
    "optical imperfections so it looks like an authentic unretouched smartphone "
    "capture. Maintain real card texture and micro-print. Soft uneven natural "
    "lighting. No beauty filters, no artificial smoothness, no changes to any data "
    "or the holder's face. Photorealistic real-camera result."
)

ALTER_LOOKS = frozenset({"alter", "img2img", "alteration", "alter_img2img", "id_alter"})

# Always last in compose_id_prompt so user notes cannot override the copy-lock.
ID_LOCK_PROMPT = (
    "Copy every printed character from the first image exactly: same letters, "
    "digits, punctuation, spacing, fonts, kerning, and positions. Names, dates, "
    "document numbers, MRZ, barcodes, and signatures must match the reference "
    "with zero changes. Copy every document graphic from the first image exactly: "
    "coat of arms, guilloche, holograms, kinegrams, ghost portrait, microprint, "
    "rainbow printing, visible UV patterns, stamps, and layout. Do not OCR, "
    "rewrite, translate, autocorrect, or invent text or graphics."
)

ID_NEGATIVE_PROMPT = (
    "rewritten text, different numbers, OCR errors, translated text, new name, "
    "invented MRZ, misspelled words, warped letters, extra hologram, extra stamp, "
    "VERIFIED watermark, different coat of arms, different guilloche, fingers, "
    "heavy glare, studio lighting, beauty filter, floating document, seamless "
    "backdrop, perfect symmetry, over-sharpened OCR, plastic beauty skin"
)


def compose_id_prompt(
    *,
    kind: str,
    user_prompt: str = "",
    id_type: str = "drivers_license",
    country: str = "",
    look: str = "capture",
) -> str:
    kind = (kind or "portrait").strip().lower()
    if kind in ("clean", "id_clean", "front_clean"):
        base = ID_CLEAN_PROMPT
    elif kind in ("back", "id_back", "back_clean"):
        base = ID_BACK_PROMPT
    else:
        base = ID_PORTRAIT_PROMPT
    bits = [base]
    t = _norm_id_type(id_type)
    if t and t != "other":
        bits.append(f"Document type: {t.replace('_', ' ')}.")
    if t in ID_3_TYPES:
        bits.append(
            "Physical size: ICAO 9303 / ISO/IEC 7810 ID-3 (88 × 125 mm). "
            "Keep this aspect; do not stretch or squash."
        )
    elif t in ID_1_TYPES:
        bits.append(
            "Physical size: ISO/IEC 7810 ID-1 (85.60 × 53.98 mm). "
            "Keep this aspect; do not stretch or squash."
        )
    cc = (country or "").strip().upper()
    if cc:
        bits.append(f"Issuing country code: {cc}.")
    look_n = (look or "capture").strip().lower().replace("-", "_")
    extra = (user_prompt or "").strip()
    if look_n in ALTER_LOOKS:
        canned = ID_ALTER_PROMPT + " " + ID_ALTER_AU_LICENCE_PROMPT
        if extra:
            bits.append(extra.rstrip("."))
        else:
            bits.append(canned)
    else:
        bits.append(ID_CAPTURE_PROMPT)
        if extra:
            bits.append(extra.rstrip("."))
    bits.append(ID_LOCK_PROMPT)
    return " ".join(bits)


def _photo_window_box(width: int, height: int, id_type: str) -> tuple[int, int, int, int]:
    """Default portrait-photo rectangle on an ISO-framed document (inclusive pixel box)."""
    w, h = max(1, int(width)), max(1, int(height))
    t = _norm_id_type(id_type)
    landscape = w >= h
    if t in ID_3_TYPES:
        if landscape:
            return int(w * 0.55), int(h * 0.08), int(w * 0.97), int(h * 0.78)
        return int(w * 0.50), int(h * 0.06), int(w * 0.97), int(h * 0.50)
    if landscape:
        return int(w * 0.03), int(h * 0.10), int(w * 0.40), int(h * 0.90)
    return int(w * 0.08), int(h * 0.04), int(w * 0.92), int(h * 0.42)


def lock_source_document(original: Any, edited: Any, *, kind: str = "portrait", id_type: str = "") -> Any:
    """Hard-copy original print and graphics. Portrait may change only the photo window.

    Qwen-Edit redraws type; this composite is the guarantee that text/graphics match
    the reference scan. Clean/back: original on edges/chroma (print + security art),
    edited only on smooth lighting. Portrait: original everywhere except the photo box.
    """
    if original is None or edited is None:
        return edited
    try:
        from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat
    except Exception:
        return edited
    try:
        o = original.convert("RGB")
        e = edited.convert("RGB")
    except Exception:
        return edited
    if e.size != o.size:
        try:
            e = e.resize(o.size, resample=Image.Resampling.LANCZOS)
        except Exception:
            try:
                e = e.resize(o.size)
            except Exception:
                return edited
    w, h = o.size
    kind_n = (kind or "portrait").strip().lower()
    if kind_n in ("clean", "id_clean", "front_clean", "back", "id_back", "back_clean"):
        gray = o.convert("L")
        structure = ImageChops.difference(
            gray.filter(ImageFilter.MaxFilter(3)),
            gray.filter(ImageFilter.MinFilter(3)),
        )
        print_mask = structure.point(lambda p: 255 if p > 4 else 0)
        try:
            sat = o.convert("HSV").split()[1].point(lambda p: 255 if p > 28 else 0)
            print_mask = ImageChops.lighter(print_mask, sat)
        except Exception:
            pass
        # Close glyph interiors (stroke/bar fill) so type is not punched out.
        print_mask = print_mask.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(5))
        print_mask = print_mask.filter(ImageFilter.GaussianBlur(radius=1.1))
        return Image.composite(o, e, print_mask)
    x0, y0, x1, y1 = _photo_window_box(w, h, id_type)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, max(x0 + 1, x1)), min(h, max(y0 + 1, y1))
    window = Image.new("L", (w, h), 0)
    ImageDraw.Draw(window).rectangle((x0, y0, x1, y1), fill=255)
    try:
        diff = ImageChops.difference(o, e).convert("L")
        core = ImageChops.multiply(window, diff.point(lambda p: 255 if p > 18 else 0))
        core = core.filter(ImageFilter.MaxFilter(9))
        if ImageStat.Stat(core).mean[0] >= 4:
            window = core
    except Exception:
        pass
    window = window.filter(ImageFilter.GaussianBlur(radius=4))
    return Image.composite(e, o, window)


def min_edge(width: int, height: int) -> int:
    return min(int(width), int(height))


def low_res(width: int, height: int, limit: int = MIN_EDGE_PX) -> bool:
    return min_edge(width, height) < int(limit)


id_low_res = low_res


def id_intent(kind: str) -> str:
    k = (kind or "").strip().lower()
    if k in ("clean", "id_clean", "front_clean"):
        return "id_clean"
    if k in ("back", "id_back", "back_clean"):
        return "id_back"
    return "id_portrait"


def needs_identity(intent: str) -> bool:
    return (intent or "").strip().lower() in {
        "id_portrait",
        "id-portrait",
        "id_faceswap",
        "id-swap",
    }
