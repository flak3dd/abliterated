#!/usr/bin/env python3
"""Safety-strip + model-id tests (no GPU)."""
from __future__ import annotations
from spark_models import (
    DRAFT_MODEL_ID, FAST_MODEL_ID, KLEIN_MODEL_ID, MODEL_IDS, QUALITY_MODEL_ID,
    QWEN_EDIT_MODEL_ID, QWEN_IMAGE_MODEL_ID, resolve_model_id as resolve_spark_id, sampler_params,
)
from uncensored_flux import ALLOWED_MODEL_IDS, UNCENSORED_MODEL_ID, resolve_model_id, strip_safety

class DummyPipe:
    def __init__(self):
        self.safety_checker = object()
        self.feature_extractor = object()
        self.watermarker = object()
        self.nsfw_checker = object()
        self.requires_safety_checker = True

def main() -> None:
    assert resolve_model_id(None) == UNCENSORED_MODEL_ID
    assert resolve_model_id("") == UNCENSORED_MODEL_ID
    assert "comfy-dreamshaper" not in ALLOWED_MODEL_IDS
    pipe = DummyPipe(); strip_safety(pipe)
    assert pipe.safety_checker is None and pipe.requires_safety_checker is False
    assert QUALITY_MODEL_ID == "krea2-raw-fp8"
    assert FAST_MODEL_ID == "krea2-turbo"
    assert KLEIN_MODEL_ID == "flux2-klein-9b"
    assert DRAFT_MODEL_ID == "z-image-turbo-nsfw-nvfp4"
    assert resolve_spark_id(None) == QUALITY_MODEL_ID
    assert resolve_spark_id("quality") == QUALITY_MODEL_ID
    assert resolve_spark_id("hero") == QUALITY_MODEL_ID
    assert resolve_spark_id("krea2") == QUALITY_MODEL_ID
    assert resolve_spark_id("klein") == KLEIN_MODEL_ID
    assert resolve_spark_id("fast") == FAST_MODEL_ID
    assert resolve_spark_id("draft") == DRAFT_MODEL_ID
    assert resolve_spark_id("z-image-turbo-6b") == DRAFT_MODEL_ID
    assert resolve_spark_id("instruction") == QWEN_IMAGE_MODEL_ID
    assert resolve_spark_id("edit") == QWEN_EDIT_MODEL_ID
    sp = sampler_params("quality")
    assert sp["steps"] == 24 and sp["guidance"] == 3.5 and sp["lora_strength"] == 0.75
    assert "krea2-raw-fp8" in MODEL_IDS and "workflow_for" not in dir(__import__("spark_models"))
    from sampler_runtime import (
        FACESWAP_DEFAULT_PROMPT, compose_faceswap_prompt, pack_edit_images, use_vae_tiling,
        want_cpu_offload, unload_pipes, _pipes, size_from_ratio, fit_contain, fit_size_inside,
    )
    import os
    os.environ.pop("SAMPLER_VAE_TILING", None)
    assert use_vae_tiling(True) is True
    assert use_vae_tiling(False) is False
    os.environ["SAMPLER_VAE_TILING"] = "1"
    assert use_vae_tiling(False) is True
    os.environ["SAMPLER_VAE_TILING"] = "0"
    assert use_vae_tiling(True) is False
    os.environ.pop("SAMPLER_VAE_TILING", None)
    os.environ["SAMPLER_CPU_OFFLOAD"] = "0"
    assert want_cpu_offload(8.0) is False
    os.environ["SAMPLER_CPU_OFFLOAD"] = "1"
    assert want_cpu_offload(80.0) is True
    os.environ.pop("SAMPLER_CPU_OFFLOAD", None)
    assert want_cpu_offload(58.0) is False
    assert want_cpu_offload(10.0) is True
    _pipes.clear()
    _pipes["krea2-raw-fp8"] = object()
    _pipes["qwen-edit-2511-fp8"] = object()
    dropped = unload_pipes(keep="qwen-edit-2511-fp8")
    assert "krea2-raw-fp8" in dropped and "qwen-edit-2511-fp8" not in dropped
    assert list(_pipes.keys()) == ["qwen-edit-2511-fp8"]
    assert unload_pipes() == ["qwen-edit-2511-fp8"]
    assert _pipes == {}
    assert "second image" in compose_faceswap_prompt("")
    assert compose_faceswap_prompt("") == FACESWAP_DEFAULT_PROMPT
    mixed = compose_faceswap_prompt("keep the red jacket")
    assert "red jacket" in mixed and "identity" in mixed.lower()
    explicit = compose_faceswap_prompt("swap the face onto the target, keep the hat")
    assert explicit.startswith("swap the face")
    class _Img:
        def __init__(self, size):
            self.size = size
        def resize(self, wh):
            return _Img(wh)
    target, ident = _Img((800, 600)), _Img((2000, 2000))
    packed = pack_edit_images(target, ident, 1024, 1024)
    assert isinstance(packed, list) and len(packed) == 2
    assert packed[0].size == (1024, 768)
    assert packed[1].size == (1024, 1024)
    solo = pack_edit_images(target, None, 512, 512)
    assert solo.size == (512, 384)
    assert size_from_ratio(1, 1, 1024) == (1024, 1024)
    assert size_from_ratio(3, 4, 1024) == (768, 1024)
    assert size_from_ratio(16, 9, 1280) == (1280, 720)
    inside = fit_size_inside(3, 4, 1920, 1080)
    assert inside[0] / inside[1] == 3 / 4 or abs(inside[0] / inside[1] - 0.75) < 0.02
    assert inside[0] <= 1920 and inside[1] <= 1080
    fitted = fit_contain(_Img((100, 50)), 200, 200)
    assert fitted.size[0] / fitted.size[1] == 2.0
    from id_pipeline import (
        ID_1_MM, ID_3_MM, ID_ALTER_AU_LICENCE_PROMPT, ID_ALTER_PROMPT, ID_CAPTURE_PROMPT,
        ID_CLEAN_PROMPT, ID_LOCK_PROMPT, ID_PORTRAIT_PROMPT, ID_SELFIE_FROM_LICENCE_PROMPT,
        MIN_EDGE_PX, compose_id_prompt,
        id_content_ratio, id_intent, lock_source_document, low_res,
    )
    assert MIN_EDGE_PX == 800
    assert low_res(799, 1200) is True
    assert low_res(800, 800) is False
    assert low_res(1024, 800) is False
    clean = compose_id_prompt(kind="clean", id_type="passport", country="au")
    assert clean.startswith(ID_CLEAN_PROMPT)
    assert "Document type: passport." in clean
    assert "Issuing country code: AU." in clean
    assert "VERIFIED" not in clean
    assert "Do not rewrite" in clean or "Do not invent" in clean
    portrait = compose_id_prompt(kind="portrait", user_prompt="keep the beard", id_type="drivers_license")
    assert portrait.startswith(ID_PORTRAIT_PROMPT)
    assert "keep the beard" in portrait
    assert "watermarks" in portrait.lower() or "VERIFIED stamps" in portrait
    assert id_intent("clean") == "id_clean"
    assert id_intent("back") == "id_back"
    assert id_intent("portrait") == "id_portrait"
    lic = id_content_ratio("drivers_license", 1920, 1080)
    assert abs(lic[0] / lic[1] - ID_1_MM[0] / ID_1_MM[1]) < 1e-9
    lic_p = id_content_ratio("drivers_license", 600, 900)
    assert abs(lic_p[0] / lic_p[1] - ID_1_MM[1] / ID_1_MM[0]) < 1e-9
    nid = id_content_ratio("national_id", 1600, 900)
    assert abs(nid[0] / nid[1] - ID_1_MM[0] / ID_1_MM[1]) < 1e-9
    ppt = id_content_ratio("passport", 800, 1200)
    assert abs(ppt[0] / ppt[1] - ID_3_MM[0] / ID_3_MM[1]) < 1e-9
    ppt_l = id_content_ratio("passport", 1200, 800)
    assert abs(ppt_l[0] / ppt_l[1] - ID_3_MM[1] / ID_3_MM[0]) < 1e-9
    other = id_content_ratio("other", 800, 600)
    assert other == (800.0, 600.0)
    iso_in_sq = fit_size_inside(*id_content_ratio("drivers_license", 1600, 900), 1024, 1024)
    assert iso_in_sq[0] <= 1024 and iso_in_sq[1] <= 1024
    assert abs(iso_in_sq[0] / iso_in_sq[1] - ID_1_MM[0] / ID_1_MM[1]) < 0.02
    ppt_in_sq = fit_size_inside(*id_content_ratio("passport", 700, 1000), 1024, 1024)
    assert ppt_in_sq[0] <= 1024 and ppt_in_sq[1] <= 1024
    assert abs(ppt_in_sq[0] / ppt_in_sq[1] - ID_3_MM[0] / ID_3_MM[1]) < 0.02
    assert "ID-1" in compose_id_prompt(kind="clean", id_type="drivers_license")
    assert "ID-3" in compose_id_prompt(kind="portrait", id_type="passport")
    assert "do not stretch" in compose_id_prompt(kind="clean", id_type="national_id").lower()
    locked_prompt = compose_id_prompt(kind="portrait", user_prompt="keep the beard", id_type="drivers_license")
    assert locked_prompt.endswith(ID_LOCK_PROMPT) or ID_LOCK_PROMPT in locked_prompt
    assert locked_prompt.index("keep the beard") < locked_prompt.index("Copy every printed character")
    assert "timber" in ID_CAPTURE_PROMPT.lower()
    assert "no fingers" in ID_CAPTURE_PROMPT.lower()
    assert ID_CAPTURE_PROMPT in compose_id_prompt(kind="clean", id_type="drivers_license")
    assert ID_CAPTURE_PROMPT in compose_id_prompt(kind="back", id_type="passport")
    assert ID_CAPTURE_PROMPT in compose_id_prompt(kind="portrait", id_type="national_id")
    assert compose_id_prompt(kind="clean", id_type="drivers_license").index(ID_CAPTURE_PROMPT) < compose_id_prompt(kind="clean", id_type="drivers_license").index(ID_LOCK_PROMPT)
    altered = compose_id_prompt(kind="clean", id_type="drivers_license", country="AU", look="alter")
    assert ID_ALTER_PROMPT in altered
    assert ID_ALTER_AU_LICENCE_PROMPT in altered
    assert "timber" not in altered.lower() or "timber" in ID_ALTER_PROMPT.lower()
    assert "Australian driver licence" in altered
    assert ID_CAPTURE_PROMPT not in altered
    assert ID_LOCK_PROMPT in altered
    assert "timber" in compose_id_prompt(kind="clean", id_type="drivers_license").lower()
    assert "identical person" in ID_SELFIE_FROM_LICENCE_PROMPT.lower()
    assert "beauty filter" in ID_SELFIE_FROM_LICENCE_PROMPT.lower()
    from PIL import Image as PILImage, ImageDraw
    orig = PILImage.new("RGB", (200, 120), (210, 208, 200))
    od = ImageDraw.Draw(orig)
    od.rectangle((8, 18, 72, 102), fill=(50, 90, 140))
    od.rectangle((90, 36, 170, 48), fill=(20, 20, 20))
    od.rectangle((90, 58, 150, 70), fill=(20, 20, 20))
    od.ellipse((160, 80, 190, 110), fill=(180, 40, 40))
    edit = orig.copy()
    ed = ImageDraw.Draw(edit)
    ed.rectangle((8, 18, 72, 102), fill=(200, 80, 40))
    ed.rectangle((88, 32, 180, 76), fill=(210, 208, 200))
    ed.rectangle((90, 36, 170, 48), fill=(255, 0, 0))
    ed.ellipse((160, 80, 190, 110), fill=(0, 255, 0))
    locked_img = lock_source_document(orig, edit, kind="portrait", id_type="drivers_license")
    assert locked_img.getpixel((40, 60)) == edit.getpixel((40, 60))
    assert locked_img.getpixel((120, 42)) == orig.getpixel((120, 42))
    assert locked_img.getpixel((175, 95)) == orig.getpixel((175, 95))
    red = PILImage.new("RGB", (200, 120), (255, 0, 0))
    locked_clean = lock_source_document(orig, red, kind="clean", id_type="drivers_license")
    assert locked_clean.getpixel((120, 42)) == orig.getpixel((120, 42))
    print("uncensored_flux tests ok")

if __name__ == "__main__":
    main()
