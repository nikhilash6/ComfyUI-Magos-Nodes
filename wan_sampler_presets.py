"""
WanAnimate Sampler Presets — Magos Nodes
Author: Magos Digital Studio

Dashboard for outputting sampler parameters with built-in and user-saved presets
for WanAnimate video generation.
"""

import json
from pathlib import Path
from typing import Dict, Any, Tuple, Optional

USER_PRESETS_FILE = Path(__file__).parent / "user_presets.json"

SCHEDULER_OPTIONS = [
    "unipc", "unipc/beta", "dpm++", "dpm++/beta", "dpm++_sde", "dpm++_sde/beta",
    "euler", "euler/beta", "longcat_distill_euler", "deis", "lcm", "lcm/beta",
    "res_multistep", "er_sde", "flowmatch_causvid", "flowmatch_distill",
    "flowmatch_pusa", "multitalk", "sa_ode_stable", "rcm", "vibt_unipc",
]

BUILTIN_PRESETS: Dict[str, Tuple[int, float, str, float]] = {
    "Preview / Distilled (4 Steps)": (4,  1.0, "dpm++_sde", 1.0),
    "Standard (20 Steps)":           (20, 5.0, "unipc",     0.0),
    "High Quality (30 Steps)":       (30, 5.0, "unipc",     0.0),
    "Maximum (40 Steps)":            (40, 5.0, "dpm++_sde", 0.0),
}


def _load_user_presets() -> Dict[str, Tuple]:
    if not USER_PRESETS_FILE.exists():
        return {}
    try:
        with open(USER_PRESETS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return {k: tuple(v) for k, v in raw.items()}
    except Exception:
        return {}


def _save_user_presets(presets: Dict) -> None:
    with open(USER_PRESETS_FILE, "w", encoding="utf-8") as f:
        json.dump({k: list(v) for k, v in presets.items()}, f, indent=2)


# ── API routes (no queue needed) ─────────────────────────────────────────────
try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/magos/presets")
    async def _route_get_presets(request):
        return web.json_response(_load_user_presets())

    @PromptServer.instance.routes.post("/magos/presets")
    async def _route_save_preset(request):
        data = await request.json()
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response({"error": "name required"}, status=400)
        if name in BUILTIN_PRESETS:
            return web.json_response({"error": "cannot overwrite built-in preset"}, status=400)
        presets = _load_user_presets()
        presets[name] = (data["steps"], data["cfg"], data["scheduler"], data["lora"])
        _save_user_presets(presets)
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.delete("/magos/presets/{name}")
    async def _route_delete_preset(request):
        name = request.match_info["name"]
        if name in BUILTIN_PRESETS:
            return web.json_response({"error": "cannot delete built-in preset"}, status=400)
        presets = _load_user_presets()
        if name not in presets:
            return web.json_response({"error": "not found"}, status=404)
        del presets[name]
        _save_user_presets(presets)
        return web.json_response({"ok": True})

except Exception as e:
    print(f"[WanSamplerPresets] Could not register API routes: {e}")


# ── Node ──────────────────────────────────────────────────────────────────────
class WanAnimateSamplerPresets:
    """
    ComfyUI node providing preset sampler configurations for WanAnimate.
    Outputs steps, cfg, scheduler, and distilled LoRA strength.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        user_presets = _load_user_presets()
        all_presets = (
            list(BUILTIN_PRESETS.keys())
            + [k for k in user_presets if k not in BUILTIN_PRESETS]
            + ["Custom"]
        )
        return {
            "required": {
                "preset":              (all_presets,       {"default": "Standard (20 Steps)"}),
                "custom_steps":        ("INT",             {"default": 20,  "min": 1,   "max": 200,  "step": 1}),
                "custom_cfg":          ("FLOAT",           {"default": 5.0, "min": 0.0, "max": 30.0, "step": 0.1}),
                "custom_lora_strength":("FLOAT",           {"default": 0.0, "min": 0.0, "max": 10.0, "step": 0.05}),
                "custom_scheduler":    (SCHEDULER_OPTIONS, {"default": "unipc"}),
            },
        }

    CATEGORY = "MAGOS Nodes/Utils"
    RETURN_TYPES = ("INT", "FLOAT", SCHEDULER_OPTIONS, "FLOAT")
    RETURN_NAMES = ("steps", "cfg", "scheduler", "lora_strength")
    FUNCTION = "get_sampler_settings"

    def get_sampler_settings(
        self,
        preset: str,
        custom_steps: int,
        custom_cfg: float,
        custom_lora_strength: float,
        custom_scheduler: str,
    ) -> Tuple[int, float, str, float]:

        all_presets = {**BUILTIN_PRESETS, **_load_user_presets()}

        if preset in all_presets:
            steps, cfg, scheduler, lora = all_presets[preset]
        else:
            steps, cfg, scheduler, lora = custom_steps, custom_cfg, custom_scheduler, custom_lora_strength

        return (steps, cfg, scheduler, lora)


NODE_CLASS_MAPPINGS = {"WanAnimateSamplerPresets": WanAnimateSamplerPresets}
NODE_DISPLAY_NAME_MAPPINGS = {"WanAnimateSamplerPresets": "WanAnimate Sampler Presets"}
