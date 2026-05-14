"""
NLF (Neural Localizer Fields) integration — EXPERIMENTAL.

Isolated module: importing this file never breaks the rest of the node pack.
All NLF-specific code lives here. The rest of the codebase only sees:

    from .nlf_integration import NLF_AVAILABLE, load_nlf_model, run_nlf_inference

Installation:
    # Install ComfyUI-SCAIL-Pose (provides MultipersonNLF + RT-DETR detector)
    # Drop nlf_l_multi_0.3.2_fp16.safetensors into ComfyUI/models/nlf/

Model download:
    https://huggingface.co/isarandi/nlf  (search for nlf_l_multi)
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

# ---------------------------------------------------------------------------
# SMPL 24-joint → OpenPose 18-joint mapping
# Source: SCAIL-Pose NLFPoseExtract/nlf_render.py process_data_to_COCO_format
# Note: SMPL uses world-space left/right; OpenPose uses image-space (mirrored).
# ---------------------------------------------------------------------------
SMPL_TO_OPENPOSE = {
    15: 0,   # SMPL head        → OP 0  Nose / Head
    12: 1,   # SMPL neck        → OP 1  Neck
    17: 2,   # SMPL l.shoulder  → OP 2  R.Shoulder (image-space mirror)
    16: 5,   # SMPL r.shoulder  → OP 5  L.Shoulder
    19: 3,   # SMPL l.elbow     → OP 3  R.Elbow
    18: 6,   # SMPL r.elbow     → OP 6  L.Elbow
    21: 4,   # SMPL l.wrist     → OP 4  R.Wrist
    20: 7,   # SMPL r.wrist     → OP 7  L.Wrist
    2:  8,   # SMPL l.hip       → OP 8  R.Hip
    1:  11,  # SMPL r.hip       → OP 11 L.Hip
    5:  9,   # SMPL l.knee      → OP 9  R.Knee
    4:  12,  # SMPL r.knee      → OP 12 L.Knee
    8:  10,  # SMPL l.ankle     → OP 10 R.Ankle
    7:  13,  # SMPL r.ankle     → OP 13 L.Ankle
}

# ComfyUI model folder helper (graceful if not inside ComfyUI)
def _get_model_dir() -> str:
    try:
        import folder_paths
        dirs = folder_paths.get_folder_paths("nlf")
        if dirs:
            return dirs[0]
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
# Native loader — uses ComfyUI-SCAIL-Pose's MultipersonNLF pipeline directly
# so the Extractor can load NLF like vitpose/yolo without a separate node.
# ---------------------------------------------------------------------------
_NLF_CACHE: Dict[str, Any] = {}  # key: (abs_model_path, mtime) → pipeline


def load_nlf_model_scail(filename: str):
    """Load an NLF .safetensors from ComfyUI/models/nlf/ via SCAIL-Pose's
    MultipersonNLF pipeline. Raises RuntimeError if SCAIL-Pose isn't installed.
    Cached per (path, mtime) so repeated extract() runs don't rebuild.
    """
    import sys
    import importlib
    import folder_paths
    from safetensors.torch import load_file
    from comfy import model_management as mm
    import comfy.ops
    import comfy.model_patcher

    # SCAIL-Pose lazy-imports NLFModel/MultipersonNLF/load_detector inside its own
    # NLFModelLoader.load_model, so they're not in sys.modules until that node runs.
    # Find the SCAIL-Pose root package and explicitly import its nlf_model submodules.
    scail_root = None
    for key, mod in sys.modules.items():
        if mod is None:
            continue
        if "SCAIL" in key and hasattr(mod, "__path__"):
            scail_root = key
            break
    if scail_root is None:
        raise RuntimeError(
            "ComfyUI-SCAIL-Pose is required for NLF. Install it and restart ComfyUI, "
            "then select an NLF model in the Extractor's nlf_model dropdown."
        )
    try:
        model_mod = importlib.import_module(f"{scail_root}.nlf_model.model")
        multi_mod = importlib.import_module(f"{scail_root}.nlf_model.multiperson")
        NLFModel = model_mod.NLFModel
        MultipersonNLF = multi_mod.MultipersonNLF
        load_detector = multi_mod.load_detector
    except Exception as e:
        raise RuntimeError(
            f"ComfyUI-SCAIL-Pose found but failed to import nlf_model submodules: {e}"
        ) from e

    _get_model_dir()  # ensure "nlf" folder is registered with folder_paths
    model_path = folder_paths.get_full_path_or_raise("nlf", filename)
    cache_key = (model_path, os.path.getmtime(model_path))
    if cache_key in _NLF_CACHE:
        return _NLF_CACHE[cache_key]

    print(f"[NLF] Loading via SCAIL pipeline: {model_path}")
    sd = load_file(model_path)

    crop_sd, detector_sd = {}, {}
    for k, v in sd.items():
        if k.startswith("detector."):
            detector_sd[k[len("detector."):]] = v
        elif not k.startswith("cano_all."):
            crop_sd[k] = v

    crop_model = NLFModel.from_state_dict(crop_sd, operations=comfy.ops.manual_cast).eval()
    load_device = mm.get_torch_device()
    offload_device = mm.unet_offload_device()
    model_patcher = comfy.model_patcher.ModelPatcher(
        crop_model, load_device=load_device, offload_device=offload_device,
    )

    detector = load_detector(detector_sd) if detector_sd else None
    canonical_points = sd.get("cano_all.smpl", crop_model.canonical_locs())
    num_vertices = 1024 if "cano_all.smpl" in sd else 0

    pipeline = MultipersonNLF(
        crop_model=crop_model,
        model_patcher=model_patcher,
        detector=detector,
        canonical_points=canonical_points,
        num_vertices=num_vertices,
    )
    _NLF_CACHE[cache_key] = pipeline
    print("[NLF] Model loaded successfully.")
    return pipeline


def list_nlf_models() -> list:
    """Return filename list from ComfyUI/models/nlf/ for the Extractor dropdown.
    Returns [] if folder_paths isn't available."""
    try:
        import folder_paths
        _get_model_dir()  # ensure registered
        return folder_paths.get_filename_list("nlf")
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 3D → 2D projection (mirrors SCAIL-Pose's intrinsic_matrix_from_field_of_view)
# ---------------------------------------------------------------------------
def _project_to_pixels(j3d: np.ndarray, H: int, W: int, fov_deg: float = 55.0) -> np.ndarray:
    """
    Project camera-space 3D joints [N, 3] (metres) → pixel coords [N, 2].
    Uses the same pinhole camera model as SCAIL-Pose (default FOV 55°).
    """
    focal = max(H, W) / (np.tan(np.radians(fov_deg / 2.0)) * 2.0)
    z = np.maximum(j3d[:, 2], 0.1)
    x2d = focal * j3d[:, 0] / z + W / 2.0
    y2d = focal * j3d[:, 1] / z + H / 2.0
    return np.stack([x2d, y2d], axis=1)


def _smpl_to_openpose18(j3d: np.ndarray, j2d_px: np.ndarray) -> List:
    """
    Map 24 SMPL joints to 18 OpenPose joints.
    Returns list of 18 entries: [x_px, y_px, confidence, z_m]
    Unmapped joints (eyes/ears, indices 14-17) get confidence 0.
    """
    result = [[0.0, 0.0, 0.0, 0.0]] * 18
    for smpl_idx, op_idx in SMPL_TO_OPENPOSE.items():
        if smpl_idx < len(j3d):
            result[op_idx] = [
                float(j2d_px[smpl_idx, 0]),
                float(j2d_px[smpl_idx, 1]),
                1.0,
                float(j3d[smpl_idx, 2]),
            ]
    return result


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------
def run_nlf_inference(model, images_tensor) -> Optional[List[Dict[str, Any]]]:
    """
    Run NLF inference using ComfyUI-SCAIL-Pose MultipersonNLF pipeline.

    Args:
        model:          MultipersonNLF pipeline (from load_nlf_model_scail).
        images_tensor:  torch.Tensor [N, H, W, 3] float32 in [0,1] range (ComfyUI IMAGE).

    Returns:
        List of per-frame dicts:
        {
          "body":      [[x_norm, y_norm, z_m], ...]  — 24 SMPL joints for overlay,
                        XY normalised [0,1], Z in metres (camera depth)
          "body_op18": [[x_px, y_px, conf, z_m], ...] — 18 OpenPose joints mapped
                        from SMPL, pixel coords, Z in metres.  conf=0 for unmapped.
          "rhand":     None   (NLF does not output hand keypoints)
          "lhand":     None
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
        H, W = int(images_tensor.shape[1]), int(images_tensor.shape[2])

        # BHWC float32 [0,1] → NCHW float32 (detect_and_estimate handles gamma internally)
        images_nchw = images_tensor.permute(0, 3, 1, 2).contiguous().to(device=device, dtype=torch.float32)

        # ---- Phase 1: person detection ----
        if not hasattr(model, 'detector') or model.detector is None:
            print("[NLF] No detector attached to model — cannot run inference.")
            return None
        model.detector.load()

        all_boxes = []
        for i in range(n_frames):
            boxes = model.detector.detect(images_nchw[i:i+1], threshold=0.3)
            all_boxes.extend(boxes)      # boxes is a list of 1 tensor per image

        # ---- Phase 2: pose estimation ----
        if hasattr(model, 'model_patcher') and model.model_patcher is not None:
            mm.load_model_gpu(model.model_patcher)

        results = []
        n_detected = 0
        for i in range(n_frames):
            result = model.detect_and_estimate(
                images_nchw[i:i+1],
                num_aug=1,
                boxes=all_boxes[i:i+1],
            )
            # poses3d is sliced to joints only (24 SMPL joints) by detect_and_estimate
            # poses2d is NOT sliced — project from 3D ourselves to avoid the vertices offset
            p3d_list = result['poses3d']   # list of 1 tensor [n_persons, 24, 3]
            p3d_frame = p3d_list[0]        # [n_persons, 24, 3]

            if p3d_frame.shape[0] == 0:
                results.append(_empty_frame())
                continue

            # First detected person
            j3d = p3d_frame[0].cpu().float().numpy()   # [24, 3] metres

            # Guard against models with unexpected joint counts
            if j3d.shape[0] < max(SMPL_TO_OPENPOSE.keys()) + 1:
                print(f"[NLF] Frame {i}: unexpected joint count {j3d.shape[0]}, skipping.")
                results.append(_empty_frame())
                continue

            # Project 3D → 2D pixel using same FOV as SCAIL-Pose renderer
            j2d_px = _project_to_pixels(j3d, H, W)     # [24, 2] pixel coords

            # All 24 SMPL joints — normalised XY for the editor overlay
            smpl_body = [
                [float(j2d_px[j, 0]) / W, float(j2d_px[j, 1]) / H, float(j3d[j, 2])]
                for j in range(len(j3d))
            ]

            # Map SMPL → OpenPose 18 — pixel XY + Z for baking into DWPose overrides
            op18 = _smpl_to_openpose18(j3d, j2d_px)

            results.append({
                "body":      smpl_body,
                "body_op18": op18,
                "rhand":     None,
                "lhand":     None,
                "j3d_raw":   j3d.tolist(),   # [24, 3] metres, camera space — used for NLFPRED output
            })
            n_detected += 1

        print(f"[NLF] Inference complete: {n_frames} frames, {n_detected} with detections, "
              f"{len(results[0]['body']) if results and results[0]['body'] else 0} SMPL joints/frame.")
        return results

    except Exception as e:
        import traceback
        print(f"[NLF] Inference error: {e}")
        traceback.print_exc()
        return None


def _empty_frame() -> Dict[str, Any]:
    return {"body": [], "body_op18": [], "rhand": None, "lhand": None}


# ---------------------------------------------------------------------------
# Stub object — returned when NLF is not installed
# ---------------------------------------------------------------------------
class NLFStub:
    """Placeholder returned when NLF is unavailable."""
    available = False
    error: str = ""
    def predict_batch(self, *a, **kw): return None

    def __repr__(self):
        return f"<NLFStub: {self.error or 'NLF not installed'}>"
