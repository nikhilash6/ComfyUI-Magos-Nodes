"""
NLF (Neural Localizer Fields) integration — EXPERIMENTAL.

Isolated module: importing this file never breaks the rest of the node pack.
All NLF-specific code lives here. The rest of the codebase only sees:

    from .nlf_integration import NLF_AVAILABLE, load_nlf_model, run_nlf_inference

Installation:
    pip install nlf
    # Drop nlf_l_multi_0.3.2_fp16.safetensors into ComfyUI/models/nlf/

Model download:
    https://github.com/isarandi/nlf
    huggingface.co/isarandi/nlf  (search for nlf_l_multi)
"""

from __future__ import annotations
import os
import numpy as np
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
# Availability check — safe to import at module level
# ---------------------------------------------------------------------------
NLF_AVAILABLE = False
_nlf_mod = None

try:
    import nlf as _nlf_mod          # pip install nlf
    NLF_AVAILABLE = True
except Exception:
    pass

# ComfyUI model folder helper (graceful if not inside ComfyUI)
def _get_model_dir() -> str:
    try:
        import folder_paths
        dirs = folder_paths.get_folder_paths("nlf")
        if dirs:
            return dirs[0]
        # Register a fallback path so ComfyUI knows about this type
        base = folder_paths.models_dir
        path = os.path.join(base, "nlf")
        os.makedirs(path, exist_ok=True)
        folder_paths.add_model_folder_path("nlf", path)
        return path
    except Exception:
        return os.path.join(os.path.dirname(__file__), "models", "nlf")


# ---------------------------------------------------------------------------
# Model loader
# ---------------------------------------------------------------------------
def load_nlf_model(model_name: str = "nlf_l_multi_0.3.2_fp16"):
    """
    Load an NLF model.  model_name can be a bare filename (no path/extension)
    or a full absolute path.  The .safetensors extension is added automatically.
    Returns the loaded model object, or raises RuntimeError with clear instructions.
    """
    if not NLF_AVAILABLE:
        raise RuntimeError(
            "NLF package not installed.\n"
            "Run:  pip install nlf\n"
            "Docs: https://github.com/isarandi/nlf"
        )

    # Resolve path
    if os.path.isabs(model_name) and os.path.isfile(model_name):
        model_path = model_name
    else:
        stem = model_name
        if not stem.endswith(".safetensors"):
            stem = stem + ".safetensors"
        model_path = os.path.join(_get_model_dir(), stem)

    if not os.path.isfile(model_path):
        raise RuntimeError(
            f"NLF model file not found: {model_path}\n"
            f"Download from: https://huggingface.co/isarandi/nlf\n"
            f"Place the .safetensors file in: {_get_model_dir()}"
        )

    print(f"[NLF] Loading model: {model_path}")
    try:
        model = _nlf_mod.load(model_path)
        print(f"[NLF] Model loaded successfully.")
        return model
    except Exception as e:
        raise RuntimeError(f"Failed to load NLF model: {e}") from e


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------
def run_nlf_inference(model, images_tensor) -> Optional[List[Dict[str, Any]]]:
    """
    Run NLF inference using ComfyUI-SCAIL-Pose MultipersonNLF pipeline.

    Args:
        model:          MultipersonNLF object returned by SCAIL-Pose NLFModelLoader.
        images_tensor:  torch.Tensor [N, H, W, 3] float32 in [0,1] range (ComfyUI IMAGE format).

    Returns:
        List of per-frame dicts:
        {
          "body": [[x_norm, y_norm, z_m], ...]  — 24 SMPL joints, XY normalised [0,1], Z metres
          "rhand": None, "lhand": None           — NLF does not output hand keypoints
        }
        Returns None on failure.
    """
    if model is None:
        return None

    if not hasattr(model, 'detect_and_estimate'):
        print("[NLF] Unsupported model type — expected SCAIL-Pose MultipersonNLF.")
        return None

    try:
        import torch
        import comfy.model_management as mm

        device = mm.get_torch_device()
        n_frames = images_tensor.shape[0]
        H, W = images_tensor.shape[1], images_tensor.shape[2]

        # BHWC float32 [0,1] → NCHW float32 on GPU (detector expects sRGB [0,1])
        images_nchw = images_tensor.permute(0, 3, 1, 2).to(device=device, dtype=torch.float32)

        # Phase 1: person detection
        if hasattr(model, 'detector') and model.detector is not None:
            model.detector.load()
        all_boxes = []
        for i in range(n_frames):
            boxes = model.detector.detect(images_nchw[i:i+1], threshold=0.3)
            all_boxes.extend(boxes)

        # Phase 2: pose estimation
        if hasattr(model, 'model_patcher') and model.model_patcher is not None:
            mm.load_model_gpu(model.model_patcher)

        results = []
        for i in range(n_frames):
            result = model.detect_and_estimate(
                images_nchw[i:i+1], num_aug=1, boxes=all_boxes[i:i+1],
            )
            p2d = result['poses2d'][0]  # [n_persons, n_joints, 2] image pixels
            p3d = result['poses3d'][0]  # [n_persons, n_joints, 3] metres

            if p2d.shape[0] == 0:
                results.append(_empty_frame())
                continue

            # First person; normalise 2D to [0,1], keep Z in metres
            j2d = p2d[0].cpu().float().numpy()
            j3d = p3d[0].cpu().float().numpy()
            body = [
                [float(j2d[j, 0]) / W, float(j2d[j, 1]) / H, float(j3d[j, 2])]
                for j in range(len(j2d))
            ]
            results.append({"body": body, "rhand": None, "lhand": None})

        n_joints = len(results[0]['body']) if results and results[0]['body'] else 0
        print(f"[NLF] Inference complete: {n_frames} frames, {n_joints} joints/frame.")
        return results

    except Exception as e:
        import traceback
        print(f"[NLF] Inference error: {e}")
        traceback.print_exc()
        return None


def _empty_frame() -> Dict[str, Any]:
    return {"body": [], "rhand": None, "lhand": None}


# ---------------------------------------------------------------------------
# Stub object — returned when NLF is not installed, so the rest of the code
# never has to null-check
# ---------------------------------------------------------------------------
class NLFStub:
    """Placeholder returned by NLFModelLoader when NLF is unavailable."""
    available = False
    error: str = ""
    def predict_batch(self, *a, **kw): return None

    def __repr__(self):
        return f"<NLFStub: {self.error or 'NLF not installed'}>"
