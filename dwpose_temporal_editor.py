"""
DWPose Temporal Editor — Node 2
Caches KEYFRAME_DATA server-side, exposes REST API for the pop-up JS editor,
applies overrides + Gaussian smoothing, and outputs both KEYFRAME_DATA and POSEDATA.
"""

import copy
import json
import base64
import hashlib
import io
import os
import datetime
import traceback
import numpy as np
import torch
from typing import Dict, Any, Optional, List

# ---------------------------------------------------------------------------
# Content fingerprinting — detects clip change even when dimensions are same
# ---------------------------------------------------------------------------
def _compute_content_hash(keyframe_data: Dict[str, Any]) -> str:
    """Hash a sample of body keypoint data to detect clip changes."""
    frames = keyframe_data.get("frames", {})
    frame_count = keyframe_data.get("frame_count", 0)
    if not frames or frame_count == 0:
        return ""
    sample_indices = [0, frame_count // 4, frame_count // 2,
                      3 * frame_count // 4, frame_count - 1]
    parts = []
    for fi in sample_indices:
        frame = frames.get(fi) or frames.get(str(fi))
        if frame is None:
            continue
        for joint in (frame.get("body") or [])[:4]:
            if joint and len(joint) >= 2:
                parts.append(f"{joint[0]:.2f},{joint[1]:.2f}")
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Debug logging — writes a timestamped .txt file per run when enabled
# ---------------------------------------------------------------------------
_LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")


class _DebugLog:
    """Collects log lines and writes them atomically to a .txt file on close()."""

    def __init__(self, enabled: bool, node_id: str):
        self.enabled = enabled
        self._lines: List[str] = []
        self._path: Optional[str] = None
        if enabled:
            os.makedirs(_LOG_DIR, exist_ok=True)
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            fname = f"te_debug_{ts}_node{node_id}.txt"
            self._path = os.path.join(_LOG_DIR, fname)
            self._lines.append(f"=== DWPose Temporal Editor Debug Log ===")
            self._lines.append(f"Timestamp : {datetime.datetime.now().isoformat()}")
            self._lines.append(f"Node ID   : {node_id}")
            self._lines.append("")

    def section(self, title: str):
        if not self.enabled: return
        self._lines.append(f"[{title}]")

    def log(self, msg: str):
        if not self.enabled: return
        self._lines.append(msg)

    def blank(self):
        if not self.enabled: return
        self._lines.append("")

    def log_array(self, name: str, arr, fmt=".4f", max_rows=4):
        """Log a numpy array with label."""
        if not self.enabled: return
        if arr is None:
            self._lines.append(f"  {name}: None")
            return
        import numpy as _np
        arr = _np.asarray(arr)
        if arr.ndim == 1:
            vals = "  ".join(f"{v:{fmt}}" for v in arr[:max_rows])
            tail = f" ... (+{len(arr)-max_rows} more)" if len(arr) > max_rows else ""
            self._lines.append(f"  {name}: [{vals}{tail}]")
        elif arr.ndim == 2:
            for ri, row in enumerate(arr[:max_rows]):
                vals = "  ".join(f"{v:{fmt}}" for v in row)
                self._lines.append(f"  {name}[{ri}]: [{vals}]")
            if len(arr) > max_rows:
                self._lines.append(f"  {name}: ... ({len(arr)} rows total)")

    def close(self):
        if not self.enabled or not self._path: return
        try:
            with open(self._path, "w", encoding="utf-8") as f:
                f.write("\n".join(self._lines) + "\n")
            print(f"[TE Debug] Log written: {self._path}")
        except Exception as exc:
            print(f"[TE Debug] Failed to write log: {exc}")

try:
    from server import PromptServer
    from aiohttp import web
    _SERVER_AVAILABLE = True
except ImportError:
    _SERVER_AVAILABLE = False
    print("DWPoseTEEditor: PromptServer not available (not running inside ComfyUI).")


# ---------------------------------------------------------------------------
# AAPoseMeta compat — import the same dataclass WanAnimatePreprocess uses
# ---------------------------------------------------------------------------
def _get_aaposemeta_class():
    import sys
    for key, mod in sys.modules.items():
        if "WanAnimatePreprocess" not in key:
            continue
        for attr in ("AAPoseMeta", "PoseMeta"):
            cls = getattr(mod, attr, None)
            if cls is not None:
                return cls
    return None


# ---------------------------------------------------------------------------
# Helper: convert one KEYFRAME_DATA frame → AAPoseMeta-compatible dict/object
# ---------------------------------------------------------------------------
def _frame_to_posedata_entry(frame: Dict[str, Any]) -> Any:
    """
    Convert a single KEYFRAME_DATA frame dict into an AAPoseMeta instance (or plain dict
    fallback) compatible with MagosPoseRetargeter / DrawViTPose.

    KEYFRAME_DATA frame:
        body  [[x,y,conf]*20]
        rhand [[x,y,conf]*21] or None
        lhand [[x,y,conf]*21] or None
        face  [[x,y,conf]*70] or None
    """
    W = frame.get("width",  512)
    H = frame.get("height", 512)

    body_pts = frame.get("body", [])
    rhand_pts = frame.get("rhand")
    lhand_pts = frame.get("lhand")
    face_pts  = frame.get("face")

    # --- body ---
    n_body = 20
    kps_body   = np.zeros((n_body, 2), dtype=np.float32)
    kps_body_p = np.zeros(n_body,     dtype=np.float32)
    for i, pt in enumerate(body_pts[:n_body]):
        kps_body[i]   = [pt[0], pt[1]]
        kps_body_p[i] = pt[2]

    # --- hands ---
    n_hand = 21
    zero_hand   = np.zeros((n_hand, 2), dtype=np.float32)
    zero_hand_p = np.zeros(n_hand,       dtype=np.float32)

    if rhand_pts is not None:
        kps_rhand   = np.array([[p[0], p[1]] for p in rhand_pts], dtype=np.float32)
        kps_rhand_p = np.array([p[2] for p in rhand_pts],          dtype=np.float32)
    else:
        kps_rhand, kps_rhand_p = zero_hand.copy(), zero_hand_p.copy()

    if lhand_pts is not None:
        kps_lhand   = np.array([[p[0], p[1]] for p in lhand_pts], dtype=np.float32)
        kps_lhand_p = np.array([p[2] for p in lhand_pts],          dtype=np.float32)
    else:
        kps_lhand, kps_lhand_p = zero_hand.copy(), zero_hand_p.copy()

    # --- face ---
    n_face = 70
    if face_pts is not None:
        kps_face   = np.array([[p[0], p[1]] for p in face_pts[:n_face]], dtype=np.float32)
        kps_face_p = np.array([p[2] for p in face_pts[:n_face]],          dtype=np.float32)
    else:
        kps_face   = np.zeros((n_face, 2), dtype=np.float32)
        kps_face_p = np.zeros(n_face,       dtype=np.float32)

    AAPoseMeta = _get_aaposemeta_class()
    if AAPoseMeta is not None:
        try:
            meta = AAPoseMeta(
                kps_body   = kps_body,
                kps_body_p = kps_body_p,
                kps_rhand  = kps_rhand,
                kps_rhand_p= kps_rhand_p,
                kps_lhand  = kps_lhand,
                kps_lhand_p= kps_lhand_p,
                kps_face   = kps_face,
                kps_face_p = kps_face_p,
                width      = W,
                height     = H,
            )
            return meta
        except Exception:
            pass

    # Fallback: plain dict (MagosPoseRetargeter handles dicts too)
    return {
        "kps_body":    kps_body,
        "kps_body_p":  kps_body_p,
        "kps_rhand":   kps_rhand,
        "kps_rhand_p": kps_rhand_p,
        "kps_lhand":   kps_lhand,
        "kps_lhand_p": kps_lhand_p,
        "kps_face":    kps_face,
        "kps_face_p":  kps_face_p,
        "width":       W,
        "height":      H,
    }


# ---------------------------------------------------------------------------
# Gaussian smoothing (pure numpy, no scipy)
# ---------------------------------------------------------------------------
def _gaussian_smooth_keyframes(kfd: Dict[str, Any], window: int, anchor_frames: set) -> Dict[str, Any]:
    """
    Apply Gaussian temporal smoothing to body keypoints across frames.
    Frames in anchor_frames are skipped (they are intentional manual overrides).
    """
    if window <= 0:
        return kfd

    frames = kfd["frames"]
    frame_count = kfd["frame_count"]
    r = window // 2
    sigma = window / 3.0

    # Build kernel
    kernel = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2).astype(np.float32)
    kernel /= kernel.sum()

    # Collect body x/y timeseries for each of the 20 keypoints
    # shape: (frame_count, 20, 2)
    body_xy = np.zeros((frame_count, 20, 2), dtype=np.float32)
    body_cf = np.zeros((frame_count, 20),    dtype=np.float32)
    for fi in range(frame_count):
        frame = frames.get(fi)
        if frame is None:
            continue
        for ki, pt in enumerate(frame.get("body", [])[:20]):
            body_xy[fi, ki] = [pt[0], pt[1]]
            body_cf[fi, ki] = pt[2]

    # Smooth each keypoint timeseries, skipping anchor frames
    smoothed_xy = body_xy.copy()
    for ki in range(20):
        for fi in range(frame_count):
            if fi in anchor_frames:
                continue
            wx, wy, wsum = 0.0, 0.0, 0.0
            for di, w in enumerate(kernel):
                src = fi - r + di
                if src < 0 or src >= frame_count or src in anchor_frames:
                    continue
                cf = body_cf[src, ki]
                wx   += (w * cf) * body_xy[src, ki, 0]
                wy   += (w * cf) * body_xy[src, ki, 1]
                wsum += (w * cf)
            if wsum > 0:
                smoothed_xy[fi, ki, 0] = wx / wsum
                smoothed_xy[fi, ki, 1] = wy / wsum

    # Write smoothed values back into a deep copy of kfd
    result = copy.deepcopy(kfd)
    for fi in range(frame_count):
        if fi in anchor_frames:
            continue
        frame = result["frames"].get(fi)
        if frame is None:
            continue
        body = frame.get("body", [])
        for ki in range(min(20, len(body))):
            body[ki][0] = float(smoothed_xy[fi, ki, 0])
            body[ki][1] = float(smoothed_xy[fi, ki, 1])

    return result


# ---------------------------------------------------------------------------
# Keyframe interpolation (matches JS applyEasing / _interpolateJoint logic)
# ---------------------------------------------------------------------------

def _ease_t(t: float, mode: str) -> float:
    """Apply easing function to normalized time t ∈ [0, 1].
    Mirrors JS applyEasing() exactly — same case names, same math."""
    if mode == "constant":
        return 0.0
    elif mode == "ease":
        return t * t * (3.0 - 2.0 * t)       # smoothstep
    elif mode == "ease_in":
        return t * t
    elif mode == "ease_out":
        return 1.0 - (1.0 - t) ** 2
    elif mode == "cubic_in":
        return t * t * t
    elif mode == "cubic_out":
        return 1.0 - (1.0 - t) ** 3
    elif mode == "cubic_inout":
        return 4.0 * t * t * t if t < 0.5 else 1.0 - (-2.0 * t + 2.0) ** 3 / 2.0
    elif mode == "back_in":
        c1, c3 = 1.70158, 2.70158
        return c3 * t * t * t - c1 * t * t
    elif mode == "back_out":
        c1, c3 = 1.70158, 2.70158
        return 1.0 + c3 * (t - 1.0) ** 3 + c1 * (t - 1.0) ** 2
    elif mode == "back_inout":
        c1, c2 = 1.70158, 1.70158 * 1.525
        if t < 0.5:
            return ((2.0 * t) ** 2 * ((c2 + 1.0) * 2.0 * t - c2)) / 2.0
        else:
            return ((2.0 * t - 2.0) ** 2 * ((c2 + 1.0) * (2.0 * t - 2.0) + c2) + 2.0) / 2.0
    elif mode == "elastic_out":
        import math
        if t == 0.0:
            return 0.0
        if t == 1.0:
            return 1.0
        return (2.0 ** (-10.0 * t)) * math.sin((t * 10.0 - 0.75) * (2.0 * math.pi / 3.0)) + 1.0
    elif mode == "expo_out":
        return 1.0 - 2.0 ** (-10.0 * t) if t != 1.0 else 1.0
    elif mode == "bounce_out":
        n1, d1 = 7.5625, 2.75
        if t < 1.0 / d1:
            return n1 * t * t
        elif t < 2.0 / d1:
            t -= 1.5 / d1
            return n1 * t * t + 0.75
        elif t < 2.5 / d1:
            t -= 2.25 / d1
            return n1 * t * t + 0.9375
        else:
            t -= 2.625 / d1
            return n1 * t * t + 0.984375
    else:                   # "linear" (default)
        return t


def _catmull_rom_scalar(P0: float, P1: float, P2: float, P3: float, t: float, alpha: float = 0.5) -> float:
    """Standard Catmull-Rom interpolation between P1 and P2 at time t ∈ [0,1].
    alpha=0.5 is standard centripetal; mirrors JS catmullRomScalar()."""
    t2 = t * t
    t3 = t2 * t
    return alpha * (
        (2.0 * P1)
        + (-P0 + P2) * t
        + (2.0 * P0 - 5.0 * P1 + 4.0 * P2 - P3) * t2
        + (-P0 + 3.0 * P1 - 3.0 * P2 + P3) * t3
    )


def _get_joint(frame: Dict[str, Any], group: str, ki: int):
    """Return [x, y, conf] list for the given joint, or None."""
    if group == "body":
        pts = frame.get("body", [])
        return pts[ki] if ki < len(pts) else None
    pts = frame.get(group)  # "lhand", "rhand", or "face"
    if pts is not None and ki < len(pts):
        return pts[ki]
    return None


def _set_joint_xycz(frame: Dict[str, Any], group: str, ki: int, x: float, y: float, c: float, z: float) -> None:
    """Update x, y, confidence, and z of the given joint in-place."""
    if group == "body":
        pts = frame.get("body", [])
        if ki < len(pts):
            pts[ki][0] = x; pts[ki][1] = y; pts[ki][2] = c
            if len(pts[ki]) < 4: pts[ki].append(z)
            else: pts[ki][3] = z
    else:
        pts = frame.get(group)
        if pts is not None and ki < len(pts):
            pts[ki][0] = x; pts[ki][1] = y; pts[ki][2] = c
            if len(pts[ki]) < 4: pts[ki].append(z)
            else: pts[ki][3] = z


def _set_joint_xy(frame: Dict[str, Any], group: str, ki: int, x: float, y: float) -> None:
    """Update x, y of the given joint in-place (confidence is left unchanged)."""
    if group == "body":
        pts = frame.get("body", [])
        if ki < len(pts):
            pts[ki][0] = x
            pts[ki][1] = y
    else:
        pts = frame.get(group)
        if pts is not None and ki < len(pts):
            pts[ki][0] = x
            pts[ki][1] = y


def _bake_interpolation(
    kfd: Dict[str, Any],
    overrides: Dict[str, Any],
    interp_mode: str,
    tweens: Optional[Dict[str, Any]] = None,
    catmull_tension: float = 0.5,
) -> Dict[str, Any]:
    """
    Fill in interpolated joint positions for every frame based on override keyframes.
    Mirrors JS _interpolateJoint() / _getEffectiveFrame() behavior exactly:
      - Joints WITH keyframes: backward-hold before first KF, forward-hold after last KF,
        interpolate between KFs.
      - Joints with NO keyframes: freeze at frame 0 value (JS static-base behavior).

    tweens: {str(fi_left): {label: mode_string}} — per-segment easing overrides.
    catmull_tension: α for Catmull-Rom (default 0.5 = centripetal).
    """
    if not overrides:
        return kfd

    tweens = tweens or {}

    frames = kfd["frames"]
    frame_count = kfd.get("frame_count", len(frames))

    # Build per-joint sorted keyframe index lists
    joint_kf: Dict[str, list] = {}
    for frame_key, point_overrides in overrides.items():
        fi = int(frame_key)
        for label in point_overrides:
            joint_kf.setdefault(label, []).append(fi)

    for label in joint_kf:
        joint_kf[label].sort()

    def _get_xycz(fi: int, group: str, ki: int):
        """Return (x, y, c, z) for the joint at frame fi, or None."""
        frame = frames.get(fi)
        if frame is None: return None
        pt = _get_joint(frame, group, ki)
        if pt is None: return None
        x = float(pt[0])
        y = float(pt[1])
        c = float(pt[2]) if len(pt) > 2 else 1.0
        z = float(pt[3]) if len(pt) > 3 and pt[3] is not None else 0.0
        return (x, y, c, z)

    for label, kf_indices in joint_kf.items():
        parts = label.split("_", 1)
        if len(parts) != 2:
            continue
        group, idx_str = parts[0], parts[1]
        try:
            ki = int(idx_str)
        except ValueError:
            continue

        fi_first = kf_indices[0]
        fi_last  = kf_indices[-1]

        # Backward hold: frames 0..fi_first-1 get the first keyframe's value
        xycz_first = _get_xycz(fi_first, group, ki)
        if xycz_first is not None:
            for fi in range(0, fi_first):
                frame = frames.get(fi)
                if frame is not None:
                    _set_joint_xycz(frame, group, ki, *xycz_first)

        # Forward hold: frames fi_last+1..end get the last keyframe's value
        xycz_last = _get_xycz(fi_last, group, ki)
        if xycz_last is not None:
            for fi in range(fi_last + 1, frame_count):
                frame = frames.get(fi)
                if frame is not None:
                    _set_joint_xycz(frame, group, ki, *xycz_last)

        # Interpolate between keyframes (requires 2+ KFs)
        if len(kf_indices) < 2:
            continue

        for seg in range(len(kf_indices) - 1):
            fi_a = kf_indices[seg]
            fi_b = kf_indices[seg + 1]
            span = fi_b - fi_a
            if span <= 1:
                continue

            # Determine per-segment mode (JS stores tweens keyed by str(fi_left))
            seg_mode = (
                tweens.get(str(fi_a), {}).get(label)
                or tweens.get(fi_a, {}).get(label)
                or interp_mode
            )

            if seg_mode == "constant":
                continue

            xycz_a = _get_xycz(fi_a, group, ki)
            xycz_b = _get_xycz(fi_b, group, ki)
            if xycz_a is None or xycz_b is None:
                continue

            ax, ay, ac, az = xycz_a
            bx, by, bc, bz = xycz_b

            if seg_mode == "catmull_rom":
                fi_prev = kf_indices[seg - 1] if seg > 0 else None
                fi_next = kf_indices[seg + 2] if seg + 2 < len(kf_indices) else None

                xycz_prev = _get_xycz(fi_prev, group, ki) if fi_prev is not None else None
                xycz_next = _get_xycz(fi_next, group, ki) if fi_next is not None else None

                if xycz_prev is None:
                    px, py, pc, pz = ax * 2.0 - bx, ay * 2.0 - by, ac * 2.0 - bc, az * 2.0 - bz
                else:
                    px, py, pc, pz = xycz_prev

                if xycz_next is None:
                    nx, ny, nc, nz = bx * 2.0 - ax, by * 2.0 - ay, bc * 2.0 - ac, bz * 2.0 - az
                else:
                    nx, ny, nc, nz = xycz_next

                for fi in range(fi_a + 1, fi_b):
                    raw_t = (fi - fi_a) / span
                    ix = _catmull_rom_scalar(px, ax, bx, nx, raw_t, catmull_tension)
                    iy = _catmull_rom_scalar(py, ay, by, ny, raw_t, catmull_tension)
                    ic = _catmull_rom_scalar(pc, ac, bc, nc, raw_t, catmull_tension)
                    iz = _catmull_rom_scalar(pz, az, bz, nz, raw_t, catmull_tension)
                    frame = frames.get(fi)
                    if frame is not None:
                        _set_joint_xycz(frame, group, ki, ix, iy, ic, iz)
            else:
                # All easing modes: lerp with eased t
                for fi in range(fi_a + 1, fi_b):
                    raw_t = (fi - fi_a) / span
                    t     = _ease_t(raw_t, seg_mode)
                    ix    = ax + (bx - ax) * t
                    iy    = ay + (by - ay) * t
                    ic    = ac + (bc - ac) * t
                    iz    = az + (bz - az) * t
                    frame = frames.get(fi)
                    if frame is not None:
                        _set_joint_xycz(frame, group, ki, ix, iy, ic, iz)

    # Freeze unkeyframed BODY joints at frame 0 — mirrors JS "frame 0 as static base".
    # Only body joints: hands and face must animate per-frame from DWPose so they stay
    # naturally aligned with the body wrists (NLF-baked per frame).  Freezing hands at
    # frame 0 while wrists move causes the retargeter's wrist→hand bone to stretch.
    frame0 = frames.get(0)
    if frame0 is not None:
        group_data = frame0.get("body", [])
        for ki in range(len(group_data)):
            label = f"body_{ki}"
            if label in joint_kf:
                continue  # already handled by keyframe logic above
            xycz0 = _get_xycz(0, "body", ki)
            if xycz0 is None:
                continue
            for fi in range(1, frame_count):
                frame = frames.get(fi)
                if frame is not None:
                    _set_joint_xycz(frame, "body", ki, *xycz0)

    return kfd


# ---------------------------------------------------------------------------
# Node class
# ---------------------------------------------------------------------------
class DWPoseTEEditor:
    """
    Interactive temporal editor node.
    Caches KEYFRAME_DATA + source images for the JS pop-up editor,
    applies overrides and smoothing, then outputs KEYFRAME_DATA + POSEDATA.
    """

    # Server-side cache: keyed by str(node_id)
    _cache: Dict[str, Any] = {}

    CATEGORY    = "MAGOS Nodes/Temporal Editor"
    RETURN_TYPES     = ("KEYFRAME_DATA", "POSEDATA", "CAMERA_MATRICES", "NLFPRED")
    RETURN_NAMES     = ("keyframe_data", "pose_data", "camera_matrices", "nlf_poses")
    OUTPUT_IS_LIST   = (False, False, False, False)
    OUTPUT_TOOLTIPS  = ("", "", "Batched extrinsic [N,4,4] + intrinsic [N,3,3] matrices. None if no camera added.",
                         "SCAIL-Pose compatible NLFPRED dict (joints3d_nonparam, [N,24,3] mm). None if no NLF model was used.")
    FUNCTION    = "edit"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "keyframe_data": ("KEYFRAME_DATA",),
            },
            "optional": {
                "source_images":     ("IMAGE",),
                "editor_state_json": ("STRING", {"default": "{}"}),
                "nlf_model":         ("NLF_MODEL",),
                "render":            (["Editor Front", "Editor Camera", "Editor Camera Ortho", "Retargeter"],
                                      {"default": "Editor Front",
                                       "tooltip": (
                                           "Editor Front = flat 2D rendered here.\n"
                                           "Editor Camera = perspective projection through camera keyframes, rendered here.\n"
                                           "Editor Camera Ortho = parallel projection, rendered here.\n"
                                           "Retargeter = leave unprojected; wire pose_data + keyframe_data + camera_matrices "
                                           "into MagosPoseRetargeter for camera-view retargeting."
                                       )}),
                "export_format":     (["dwpose", "nlf_3d"], {"default": "dwpose"}),
                "debug_log":         ("BOOLEAN", {"default": False,
                                               "tooltip": "Write a timestamped debug .txt log to <plugin>/logs/ for each run"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("NaN")

    # ------------------------------------------------------------------
    # Core execution
    # ------------------------------------------------------------------

    # Legacy → new render-mode strings. Saved workflows from before the rename
    # used "Front" / "Camera Perspective" / "Camera Orthographic" — translate
    # transparently so old graphs keep working.
    _RENDER_LEGACY = {
        "Front":               "Editor Front",
        "Camera Perspective":  "Editor Camera",
        "Camera Orthographic": "Editor Camera Ortho",
        "front":               "Editor Front",
        "camera":              "Editor Camera",
    }

    def edit(
        self,
        keyframe_data: Dict[str, Any],
        source_images: Optional[torch.Tensor] = None,
        editor_state_json: str = "{}",
        nlf_model=None,
        render: str = "Editor Front",
        export_format: str = "dwpose",
        debug_log: bool = False,
        unique_id: str = "0",
    ) -> Dict[str, Any]:

        node_id = str(unique_id)
        dbg = _DebugLog(debug_log, node_id)

        # Normalize legacy render-mode strings
        render = self._RENDER_LEGACY.get(render, render)

        from .debug_logger import get_logger
        slog = get_logger("Editor", debug_log)
        slog.section("EDIT START", {
            "node_id": node_id,
            "source_images": source_images,
            "render": render,
            "export_format": export_format,
            "kf.frame_count": keyframe_data.get("frame_count"),
            "kf.width": keyframe_data.get("width"),
            "kf.height": keyframe_data.get("height"),
            "kf.has_nlf_frames": "nlf_frames" in keyframe_data,
            "nlf_model": "connected" if nlf_model is not None else None,
            "editor_state_json_len": len(editor_state_json or ""),
        })

        # 1. Parse editor state
        try:
            editor_state = json.loads(editor_state_json) if editor_state_json else {}
        except (json.JSONDecodeError, TypeError):
            editor_state = {}
            dbg.log("WARNING: editor_state_json failed to parse — using empty state")

        # 1b. Fingerprint check — discard saved state if footage changed
        current_fp = (
            f"{keyframe_data.get('frame_count', 0)}"
            f":{keyframe_data.get('width', 0)}"
            f":{keyframe_data.get('height', 0)}"
            f":{_compute_content_hash(keyframe_data)}"
        )
        saved_fp = editor_state.get("_fingerprint", "")
        if saved_fp and saved_fp != current_fp:
            print(
                f"DWPoseTEEditor [{node_id}]: footage fingerprint changed "
                f"({saved_fp!r} → {current_fp!r}). Editor state reset."
            )
            editor_state = {}

        overrides        = editor_state.get("overrides",       {})
        smooth_window    = int(editor_state.get("smooth_window", 0))
        interp_mode      = editor_state.get("interpolation",   "linear")
        tweens           = editor_state.get("tweens",           {})
        catmull_tension  = float(editor_state.get("catmull_tension", 0.5))

        slog.section("EDITOR STATE PARSED", {
            "override_frames": sorted(int(k) for k in overrides.keys()),
            "smooth_window": smooth_window,
            "interp_mode": interp_mode,
            "tween_count": len(tweens),
            "catmull_tension": catmull_tension,
        })

        # ── DEBUG: CONFIG ────────────────────────────────────────────────────
        dbg.section("CONFIG")
        dbg.log(f"frame_count     : {keyframe_data.get('frame_count', '?')}")
        dbg.log(f"pose_size       : {keyframe_data.get('width','?')}x{keyframe_data.get('height','?')}")
        dbg.log(f"render          : {render}")
        dbg.log(f"interp_mode     : {interp_mode}  catmull_tension={catmull_tension}")
        dbg.log(f"smooth_window   : {smooth_window}")
        dbg.log(f"export_format   : {export_format}")
        dbg.log(f"override_frames : {sorted(int(k) for k in overrides.keys())}")
        dbg.blank()

        # ── DEBUG: OVERRIDES SUMMARY ─────────────────────────────────────────
        if overrides:
            dbg.section("OVERRIDES SUMMARY")
            from collections import Counter as _Counter
            label_counts = _Counter()
            cam_kf_frames: Dict[str, list] = {}
            for fi_str, ov in overrides.items():
                for lbl, val in ov.items():
                    label_counts[lbl] += 1
                    if lbl.startswith("cam_"):
                        cam_kf_frames.setdefault(lbl, []).append(int(fi_str))
            for lbl, cnt in sorted(label_counts.items()):
                dbg.log(f"  {lbl:20s}: {cnt} keyframe(s)")
            dbg.blank()
            if cam_kf_frames:
                dbg.section("CAMERA KEYFRAMES (raw override values)")
                cam_label_order = ["cam_x","cam_y","cam_z","cam_pan","cam_tilt","cam_roll","cam_fov"]
                all_cam_fi = sorted(set(int(fi) for lbl in cam_kf_frames.values() for fi in lbl))
                for fi in all_cam_fi:
                    ov = overrides.get(str(fi), {})
                    parts = []
                    for lbl in cam_label_order:
                        v = ov.get(lbl)
                        parts.append(f"{lbl}={v[0]:.3f}" if (v and len(v)>0) else f"{lbl}=-")
                    dbg.log(f"  Frame {fi:4d}: " + "  ".join(parts))
                dbg.blank()

        # 2. Cache raw data for the JS editor to fetch
        DWPoseTEEditor._cache[node_id] = {
            "keyframe_data": keyframe_data,
            "source_images": source_images,
            "editor_state":  editor_state,
        }

        # Carry NLF frames from the extractor into the cache so the editor
        # can serve the SMPL overlay without a separate NLF model on the editor.
        if "nlf_frames" in keyframe_data:
            DWPoseTEEditor._cache[node_id]["nlf_data"] = keyframe_data["nlf_frames"]
            DWPoseTEEditor._cache[node_id].pop("nlf_error", None)

        # 3. Apply overrides onto a working copy
        working_kfd = copy.deepcopy(keyframe_data)
        working_kfd["overrides"]     = overrides
        working_kfd["smooth_window"] = smooth_window

        # Apply each override entry
        anchor_frames: set = set()
        for frame_key, point_overrides in overrides.items():
            fi = int(frame_key)
            anchor_frames.add(fi)
            frame = working_kfd["frames"].get(fi)
            if frame is None:
                continue
            for label, coords in point_overrides.items():
                # label format: "body_4", "lhand_7", "rhand_0", "face_12"
                parts = label.split("_", 1)
                if len(parts) != 2:
                    continue
                group, idx_str = parts[0], parts[1]
                try:
                    ki = int(idx_str)
                except ValueError:
                    continue

                if group == "body":
                    body = frame.get("body", [])
                    if ki < len(body):
                        if isinstance(coords, list) and len(coords) >= 2:
                            # Per-channel keyframes use null for unset channels — skip those
                            if coords[0] is not None: body[ki][0] = float(coords[0])
                            if coords[1] is not None: body[ki][1] = float(coords[1])
                            if len(coords) >= 3 and coords[2] is not None:
                                body[ki][2] = float(coords[2])
                            if len(coords) >= 4 and coords[3] is not None:
                                if len(body[ki]) < 4: body[ki].append(float(coords[3]))
                                else: body[ki][3] = float(coords[3])
                        elif isinstance(coords, dict):
                            body[ki][0] = float(coords.get("x", body[ki][0]))
                            body[ki][1] = float(coords.get("y", body[ki][1]))
                            if "conf" in coords:
                                body[ki][2] = float(coords["conf"])

                elif group in ("lhand", "rhand"):
                    hand = frame.get(group)
                    if hand is not None and ki < len(hand):
                        if isinstance(coords, list) and len(coords) >= 2:
                            if coords[0] is not None: hand[ki][0] = float(coords[0])
                            if coords[1] is not None: hand[ki][1] = float(coords[1])
                            if len(coords) >= 3 and coords[2] is not None:
                                hand[ki][2] = float(coords[2])
                            if len(coords) >= 4 and coords[3] is not None:
                                if len(hand[ki]) < 4: hand[ki].append(float(coords[3]))
                                else: hand[ki][3] = float(coords[3])
                        elif isinstance(coords, dict):
                            hand[ki][0] = float(coords.get("x", hand[ki][0]))
                            hand[ki][1] = float(coords.get("y", hand[ki][1]))

                elif group == "face":
                    face = frame.get("face")
                    if face is not None and ki < len(face):
                        if isinstance(coords, list) and len(coords) >= 2:
                            if coords[0] is not None: face[ki][0] = float(coords[0])
                            if coords[1] is not None: face[ki][1] = float(coords[1])
                        elif isinstance(coords, dict):
                            face[ki][0] = float(coords.get("x", face[ki][0]))
                            face[ki][1] = float(coords.get("y", face[ki][1]))

        # 4. Gaussian smoothing (skips anchor frames)
        if smooth_window > 0:
            working_kfd = _gaussian_smooth_keyframes(working_kfd, smooth_window, anchor_frames)

        # 4b. Bake keyframe interpolation between override anchors
        if overrides:
            working_kfd = _bake_interpolation(
                working_kfd, overrides, interp_mode,
                tweens=tweens, catmull_tension=catmull_tension,
            )

        # 5. Convert → POSEDATA
        frames = working_kfd.get("frames", {})
        frame_count = working_kfd.get("frame_count", len(frames))
        W = working_kfd.get("width",  512)
        H = working_kfd.get("height", 512)

        # `render` comes from the node widget, not the editor state

        # Output canvas size comes from the editor sidebar only — the Renderer
        # node has its own canvas_width/canvas_height inputs for final output.
        out_w = int(editor_state.get("canvas_w", 0) or 0)
        out_h = int(editor_state.get("canvas_h", 0) or 0)
        norm_w = out_w if out_w > 0 else W
        norm_h = out_h if out_h > 0 else H

        # ── DEBUG: BAKED JOINT SAMPLE ────────────────────────────────────────
        dbg.section("BAKED JOINT SAMPLE (body[0..2] at frames 0,1,mid,last)")
        _sample_fis = sorted(set([0, 1, frame_count//2, max(0,frame_count-1)]))
        for _sfi in _sample_fis:
            _sf = frames.get(_sfi, {})
            _sb = _sf.get("body", [])
            if _sb:
                _row = " | ".join(f"b{i}=({_sb[i][0]:.1f},{_sb[i][1]:.1f},c={_sb[i][2] if len(_sb[i])>2 else '?':.2f},z={_sb[i][3] if len(_sb[i])>3 else 0:.3f})" for i in range(min(3,len(_sb))))
                dbg.log(f"  fi={_sfi:4d}: {_row}")
        dbg.blank()

        # Pre-compute camera matrices (needed for camera-view projection and CAMERA_MATRICES output)
        camera_matrices_out = None
        cam_result = None
        try:
            from .camera_math import compute_camera_matrices
            import torch as _torch
            cam_result = compute_camera_matrices(overrides, frame_count, W, H, out_w, out_h)
            if cam_result is not None:
                camera_matrices_out = {
                    "extrinsics":  _torch.tensor(cam_result["extrinsics"], dtype=_torch.float32),
                    "intrinsics":  _torch.tensor(cam_result["intrinsics"], dtype=_torch.float32),
                    "fovs":        _torch.tensor(cam_result["fovs"],       dtype=_torch.float32),
                    "dists":       _torch.tensor(cam_result["dists"],      dtype=_torch.float32),
                    "frame_count": frame_count,
                    "width":       norm_w,
                    "height":      norm_h,
                    "pose_w":      W,
                    "pose_h":      H,
                    "scipy_used":  cam_result["scipy_used"],
                }
                fovs_arr = cam_result["fovs"]
                print(f"[Camera] {frame_count} frames, scipy={cam_result['scipy_used']}, "
                      f"fov_range=[{fovs_arr.min():.1f}°, {fovs_arr.max():.1f}°]")

                # ── DEBUG: CAMERA INTERPOLATION SAMPLE ───────────────────────
                dbg.section("CAMERA INTERPOLATION SAMPLE (positions+fovs, every max(1,N//10) frames)")
                _step = max(1, frame_count // 10)
                _pos = cam_result["positions"]
                _fovs = cam_result["fovs"]
                _exts = cam_result["extrinsics"]
                dbg.log(f"  scipy_used={cam_result['scipy_used']}  norm_canvas={norm_w}x{norm_h}")
                dbg.log(f"  {'fi':>4}  {'cam_x':>8}  {'cam_y':>8}  {'cam_z':>8}  {'fov':>7}")
                for _fi in range(0, frame_count, _step):
                    dbg.log(f"  {_fi:4d}  {_pos[_fi,0]:8.4f}  {_pos[_fi,1]:8.4f}  {_pos[_fi,2]:8.4f}  {_fovs[_fi]:7.2f}°")
                dbg.blank()

                dbg.section("CAMERA INTRINSIC K (all frames same)")
                K0 = cam_result["intrinsics"][0]
                dbg.log(f"  K = [[{K0[0,0]:.2f}, {K0[0,1]:.2f}, {K0[0,2]:.2f}],")
                dbg.log(f"       [{K0[1,0]:.2f}, {K0[1,1]:.2f}, {K0[1,2]:.2f}],")
                dbg.log(f"       [{K0[2,0]:.2f}, {K0[2,1]:.2f}, {K0[2,2]:.2f}]]")
                dbg.blank()

                dbg.section("EXTRINSICS SAMPLE (frames 0, mid, last)")
                for _fi in [0, frame_count//2, frame_count-1]:
                    _E = _exts[_fi]
                    dbg.log(f"  Frame {_fi}:")
                    for _r in range(4):
                        dbg.log(f"    [{_E[_r,0]:8.4f}  {_E[_r,1]:8.4f}  {_E[_r,2]:8.4f}  {_E[_r,3]:9.4f}]")
                dbg.blank()

        except Exception as e:
            dbg.section("CAMERA MATRIX ERROR")
            dbg.log(traceback.format_exc())
            dbg.blank()
            print(f"[Camera] Matrix computation skipped: {e}")

        # "Retargeter" mode emits unprojected pose_data (same as Editor Front) so the
        # downstream MagosPoseRetargeter can apply 2D cluster transforms in front-space
        # and then project through camera_matrices itself.
        do_cam_project = render in ("Editor Camera", "Editor Camera Ortho") and cam_result is not None
        is_ortho_output = render == "Editor Camera Ortho"
        if render == "Retargeter" and cam_result is None:
            print("[Editor] render='Retargeter' but no camera keyframes — pose_data will be plain front view. "
                  "Add camera keyframes if you want camera-view retargeting downstream.")
        elif render == "Retargeter":
            print("[Editor] render='Retargeter' — emitting front-view pose_data + camera_matrices for "
                  "MagosPoseRetargeter (wire keyframe_data + pose_data + camera_matrices).")
        _Z_SCALE = float(W) * 0.35   # matches JS orbit view: Z_SCALE = poseW * 0.35

        # ── DEBUG: PROJECTION MODE ───────────────────────────────────────────
        dbg.section("PROJECTION")
        dbg.log(f"  do_cam_project = {do_cam_project}  is_ortho = {is_ortho_output}  (render={render!r}, cam_result={'yes' if cam_result else 'None'})")
        dbg.log(f"  Z_SCALE = {_Z_SCALE:.2f}  (poseW * 0.35)")
        dbg.log(f"  norm_w={norm_w}  norm_h={norm_h}")
        dbg.blank()

        # Pure projection lives in camera_math.project_frame_pts; this wrapper adds
        # one-shot debug logging tied to the editor's _DebugLog stream.
        from .camera_math import project_frame_pts as _project_frame_pts_pure
        _proj_sample_done = [False]   # list so the inner closure can mutate

        def _project_frame_pts(pts, E, K, _fi_dbg=-1, _ortho_dist=None):
            if pts is None:
                return None
            out = _project_frame_pts_pure(pts, E, K, _Z_SCALE, ortho_dist=_ortho_dist)
            if not _proj_sample_done[0] and pts and out:
                dbg.section(f"PROJECTION DETAIL — body joints at frame {_fi_dbg}")
                for _pi in range(min(4, len(pts), len(out))):
                    pt = pts[_pi]
                    op = out[_pi]
                    xn = float(pt[0]); yn = float(pt[1])
                    conf = float(pt[2]) if len(pt) > 2 else 1.0
                    zv = float(pt[3]) if len(pt) > 3 and pt[3] is not None else 0.0
                    if conf < 0.01:
                        dbg.log(f"    pt{_pi}: conf<0.01 → skip")
                        continue
                    mode_str = f"ortho(d={_ortho_dist:.1f})" if _ortho_dist else "persp"
                    dbg.log(
                        f"    pt{_pi}: in=({xn:.1f},{yn:.1f},z={zv:.3f}) "
                        f"→ {mode_str} → out=({op[0]:.1f},{op[1]:.1f}) conf={conf:.2f}"
                    )
                dbg.blank()
                _proj_sample_done[0] = True
            return out

        # Bake ref frame: original detection frame 0 + refFrameOverrides, NO camera projection
        ref_frame_overrides = editor_state.get("ref_frame_overrides") or {}
        base_f0 = working_kfd.get("frames", {}).get(0)
        if base_f0 is not None:
            import re as _re
            _label_re = _re.compile(r'^(body|rhand|lhand|face)_(\d+)$')
            ref_baked = copy.deepcopy(base_f0)
            for label, coords in ref_frame_overrides.items():
                m = _label_re.match(label)
                if not m:
                    continue
                grp, idx = m.group(1), int(m.group(2))
                arr = ref_baked.get(grp)
                if arr and idx < len(arr) and isinstance(coords, list) and len(coords) >= 2:
                    pt = arr[idx]
                    if coords[0] is not None: pt[0] = float(coords[0])
                    if coords[1] is not None: pt[1] = float(coords[1])
                    if len(coords) >= 3 and coords[2] is not None: pt[2] = float(coords[2])
                    if len(coords) >= 4 and coords[3] is not None:
                        if len(pt) < 4: pt.append(float(coords[3]))
                        else: pt[3] = float(coords[3])
            working_kfd["ref_frame"] = ref_baked

        pose_metas = []
        for fi in range(frame_count):
            frame = frames.get(fi, {
                "width": W, "height": H,
                "body": [[0.0, 0.0, 0.0]] * 20,
                "rhand": None, "lhand": None, "face": None,
            })

            if do_cam_project:
                E = cam_result["extrinsics"][fi]
                K = cam_result["intrinsics"][fi]
                ortho_dist = float(cam_result["dists"][fi]) if is_ortho_output else None
                frame = {
                    "width": norm_w, "height": norm_h,
                    "body":  _project_frame_pts(frame.get("body", []), E, K, _fi_dbg=fi, _ortho_dist=ortho_dist),
                    "rhand": _project_frame_pts(frame.get("rhand"),    E, K, _ortho_dist=ortho_dist),
                    "lhand": _project_frame_pts(frame.get("lhand"),    E, K, _ortho_dist=ortho_dist),
                    "face":  _project_frame_pts(frame.get("face"),     E, K, _ortho_dist=ortho_dist),
                }

            entry = _frame_to_posedata_entry(frame)
            if export_format == "nlf_3d":
                # Export z values from frame joint tuples for downstream 3D nodes
                z_out = {}
                for bi, pt in enumerate(frame.get("body", [])):
                    if len(pt) > 3: z_out[f"body_{bi}"] = pt[3]
                if isinstance(entry, dict):
                    entry["z_depth"] = z_out
                else:
                    entry.z_depth = z_out
            pose_metas.append(entry)

        pose_data = {
            "pose_metas":    pose_metas,
            "width":         norm_w,
            "height":        norm_h,
            "export_format": export_format,
        }

        # Cache NLF inference results when a model is connected
        if source_images is None:
            pass
        elif nlf_model is None:
            self._cache[unique_id]["nlf_error"] = "No NLF model selected on the Extractor"
        else:
            try:
                from .nlf_integration import run_nlf_inference, NLFStub, NLF_AVAILABLE
                if not NLF_AVAILABLE:
                    self._cache[unique_id]["nlf_error"] = "nlf package not installed — run: pip install nlf"
                elif isinstance(nlf_model, NLFStub):
                    self._cache[unique_id]["nlf_error"] = nlf_model.error or "NLF model not loaded"
                else:
                    nlf_results = run_nlf_inference(nlf_model, source_images)
                    if nlf_results:
                        self._cache[unique_id]["nlf_data"] = nlf_results
                        self._cache[unique_id].pop("nlf_error", None)
                        print(f"[NLF] Cached {len(nlf_results)} frames of 3D joint data.")
                    else:
                        self._cache[unique_id]["nlf_error"] = "inference returned no results"
            except Exception as e:
                self._cache[unique_id]["nlf_error"] = str(e)
                print(f"[NLF] Inference skipped: {e}")

        # ── Build NLFPRED output (SCAIL-Pose compatible) ─────────────────────
        # Respects render mode: Editor Front / Retargeter → raw 3D mm; camera views → joint
        # positions are transformed through the editor camera then back-projected
        # to 3D so RenderNLFPoses / SaveNLFPosesAs3D match the DWPose output.
        nlf_pred_out = None
        nlf_data = self._cache.get(node_id, {}).get("nlf_data")
        if nlf_data:
            try:
                import torch as _torch
                _NLF_FOV_DEG = 55.0
                _focal_in  = max(H, W) / (np.tan(np.radians(_NLF_FOV_DEG / 2.0)) * 2.0)
                _focal_out = max(norm_h, norm_w) / (np.tan(np.radians(_NLF_FOV_DEG / 2.0)) * 2.0)

                per_frame = []
                for fi, frame in enumerate(nlf_data):
                    j3d_raw = frame.get("j3d_raw")   # [24, 3] metres camera-space, or None
                    if j3d_raw is None:
                        per_frame.append(_torch.zeros((1, 24, 3), dtype=_torch.float32))
                        continue

                    j3d = np.array(j3d_raw, dtype=np.float32)  # [24, 3]

                    if not do_cam_project or cam_result is None:
                        # Front view — pass through raw 3D in millimetres
                        out_3d = j3d * 1000.0
                    else:
                        # Camera view — project → editor-camera transform → back-project
                        E = cam_result["extrinsics"][fi]   # [4,4] numpy
                        K = cam_result["intrinsics"][fi]   # [3,3] numpy
                        ortho_dist = float(cam_result["dists"][fi]) if is_ortho_output else None

                        out_3d = np.zeros_like(j3d)
                        for ji in range(len(j3d)):
                            z_m = float(j3d[ji, 2])
                            z_safe = max(z_m, 0.01)

                            # NLF 3D (metres) → pixel space using NLF pinhole FOV
                            x_px = _focal_in * float(j3d[ji, 0]) / z_safe + W  / 2.0
                            y_px = _focal_in * float(j3d[ji, 1]) / z_safe + H  / 2.0

                            # Apply editor camera extrinsic (z_editor=0: NLF depth is
                            # already metres, not editor-normalised units, so we pass
                            # the pixel XY only and preserve original metric depth)
                            pt_h   = np.array([x_px, y_px, 0.0, 1.0], dtype=np.float32)
                            pt_cam = E @ pt_h

                            if ortho_dist is not None:
                                px_out = K[0, 0] * pt_cam[0] / ortho_dist + K[0, 2]
                                py_out = K[1, 1] * pt_cam[1] / ortho_dist + K[1, 2]
                            else:
                                if pt_cam[2] <= 0.01:
                                    out_3d[ji] = [0.0, 0.0, z_m * 1000.0]
                                    continue
                                px_out = K[0, 0] * pt_cam[0] / pt_cam[2] + K[0, 2]
                                py_out = K[1, 1] * pt_cam[1] / pt_cam[2] + K[1, 2]

                            # Back-project to 3D at original metric depth so the
                            # NLF renderer (55° FOV) produces the same pixel positions
                            depth_mm = z_m * 1000.0
                            out_3d[ji, 0] = (px_out - norm_w / 2.0) * depth_mm / _focal_out
                            out_3d[ji, 1] = (py_out - norm_h / 2.0) * depth_mm / _focal_out
                            out_3d[ji, 2] = depth_mm

                    # SCAIL-Pose convention: [n_persons, 24, 3] mm
                    per_frame.append(_torch.tensor(out_3d, dtype=_torch.float32).unsqueeze(0))

                nlf_pred_out = {"joints3d_nonparam": [per_frame]}
                print(f"[NLF] NLFPRED built: {len(per_frame)} frames, render={render!r}")
            except Exception as _e:
                print(f"[NLF] Could not build NLFPRED output: {_e}")

        slog.section("EDIT DONE", {
            "working_kfd.frame_count": working_kfd.get("frame_count"),
            "pose_data.frames": len(pose_data.get("pose_metas", [])) if isinstance(pose_data, dict) else "?",
            "camera_matrices_out": "yes" if camera_matrices_out is not None else None,
            "nlf_pred_out": f"{len(nlf_data)} frames" if nlf_data else "None",
        })
        dbg.close()
        return {"ui": {}, "result": (working_kfd, pose_data, camera_matrices_out, nlf_pred_out)}


# ---------------------------------------------------------------------------
# REST API — registered once at module import
# ---------------------------------------------------------------------------
if _SERVER_AVAILABLE:
    routes = PromptServer.instance.routes

    @routes.post("/magos-debug/user-action")
    async def magos_log_user_action(request):
        """JS posts user actions here. Body: {node, action, payload}."""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "bad json"}, status=400)
        node    = str(body.get("node", "JS"))
        action  = str(body.get("action", "unknown"))
        payload = body.get("payload") if isinstance(body.get("payload"), dict) else None
        try:
            from .debug_logger import log_user_action
            log_user_action(node, action, payload)
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)
        return web.json_response({"ok": True})

    @routes.get("/temporal-editor/data/{node_id}")
    async def te_get_data(request):
        """Return the full KEYFRAME_DATA for a node (no images)."""
        node_id = request.match_info["node_id"]
        cached  = DWPoseTEEditor._cache.get(node_id)
        if cached is None:
            return web.json_response({"error": "No data cached for this node. Run the workflow first."}, status=404)

        kfd = cached["keyframe_data"]

        # Convert integer-keyed frames dict to string keys for JSON
        frames_json = {}
        for fi, frame in kfd.get("frames", {}).items():
            frames_json[str(fi)] = frame

        editor_state = cached.get("editor_state", {})

        # Prefer editor_state for all mutable fields — it holds what the user
        # last clicked Apply with.  Fall back to kfd fields only when the
        # editor has never been used (empty editor_state).
        payload = {
            "frame_count":    kfd.get("frame_count", 0),
            "width":          kfd.get("width",  512),
            "height":         kfd.get("height", 512),
            "_content_hash":  _compute_content_hash(kfd),
            "frames":         frames_json,
            "overrides":      editor_state.get("overrides",      kfd.get("overrides", {})),
            "smooth_window":  editor_state.get("smooth_window",  kfd.get("smooth_window", 0)),
            "tweens":         editor_state.get("tweens",         {}),
            "catmull_tension": editor_state.get("catmull_tension", 0.5),
            "interpolation":  editor_state.get("interpolation",  "catmull_rom"),
            "canvas_w":       editor_state.get("canvas_w",       0),
            "canvas_h":       editor_state.get("canvas_h",       0),
            # UI display state — restored on editor open, does not affect workflow output
            "experimental_mode": editor_state.get("experimental_mode", False),
            "panel_layout":      editor_state.get("panel_layout",      1),
            "panel_views":       editor_state.get("panel_views",       ["front", "orbit", "top", "side"]),
            "dwpose_alpha":      editor_state.get("dwpose_alpha",      1.0),
            "nlf_alpha":         editor_state.get("nlf_alpha",         0.5),
            "data_mode":         editor_state.get("data_mode",         "dwpose"),
            "ref_frame_overrides": editor_state.get("ref_frame_overrides", {}),
        }
        return web.json_response(payload)

    @routes.get("/temporal-editor/background/{node_id}/{frame_idx}")
    async def te_get_background(request):
        """Return a single source frame as base64 PNG (lazy-loaded per seek)."""
        node_id   = request.match_info["node_id"]
        frame_idx = int(request.match_info["frame_idx"])
        cached    = DWPoseTEEditor._cache.get(node_id)

        if cached is None or cached.get("source_images") is None:
            return web.json_response({"image": None})

        src = cached["source_images"]  # (B, H, W, C) float32
        if frame_idx < 0 or frame_idx >= src.shape[0]:
            return web.json_response({"image": None})

        frame_np = (src[frame_idx].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        try:
            import cv2
            frame_bgr = cv2.cvtColor(frame_np, cv2.COLOR_RGB2BGR)
            _, buf    = cv2.imencode(".png", frame_bgr)
            b64       = base64.b64encode(buf).decode("utf-8")
        except Exception:
            # Fallback using PIL
            from PIL import Image
            img = Image.fromarray(frame_np)
            bio = io.BytesIO()
            img.save(bio, format="PNG")
            b64 = base64.b64encode(bio.getvalue()).decode("utf-8")

        return web.json_response({"image": b64})

    @routes.post("/temporal-editor/state/{node_id}")
    async def te_post_state(request):
        """Save editor state (overrides, z_depth, smooth_window) from JS."""
        node_id = request.match_info["node_id"]
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid JSON"}, status=400)

        cached = DWPoseTEEditor._cache.get(node_id)
        if cached is not None:
            cached["editor_state"] = body

        return web.json_response({"ok": True})

    @routes.get("/temporal-editor/nlf/{node_id}")
    async def te_get_nlf(request):
        """Return cached NLF 3D joint data for a node, or {available: false}."""
        node_id = request.match_info["node_id"]
        cached = DWPoseTEEditor._cache.get(node_id)
        if cached is None:
            return web.json_response({"error": "No data cached."}, status=404)
        nlf_data = cached.get("nlf_data")
        if not nlf_data:
            return web.json_response({"available": False, "frames": [], "reason": cached.get("nlf_error", "")})
        # Tag where this NLF data came from so the JS can show a helpful status
        from_extractor = "nlf_frames" in cached.get("keyframe_data", {})
        return web.json_response({
            "available": True,
            "frames":    nlf_data,
            "source":    "extractor" if from_extractor else "editor",
        })

    @routes.get("/temporal-editor/nlf/apply/{node_id}")
    async def te_get_nlf_apply(request):
        """
        Return NLF data formatted as DWPose overrides (pixel XY + Z in metres).
        JS uses this to bake NLF 3D joint positions into the editor as keyframes.
        Response: { available, frames: [{body_op18: [[x_px, y_px, conf, z_m], ...]}, ...] }
        """
        node_id = request.match_info["node_id"]
        cached = DWPoseTEEditor._cache.get(node_id)
        if cached is None:
            return web.json_response({"error": "No data cached."}, status=404)
        nlf_data = cached.get("nlf_data")
        if not nlf_data:
            return web.json_response({"available": False, "reason": cached.get("nlf_error", "")})
        # Strip overlay-only fields to reduce payload size; keep body_op18 only
        apply_frames = [
            {"body_op18": fd.get("body_op18", [])}
            for fd in nlf_data
        ]
        return web.json_response({"available": True, "frames": apply_frames})

    @routes.post("/temporal-editor/reset-cache/{node_id}")
    async def te_reset_cache(request):
        """Clear the server-side cache for a node without wiping editor state.
        The next workflow run will re-detect from scratch.
        Editor state (overrides, tweens, etc.) stored in the widget is not affected."""
        node_id = request.match_info["node_id"]
        existed = node_id in DWPoseTEEditor._cache
        if existed:
            editor_state = DWPoseTEEditor._cache[node_id].get("editor_state", {})
            DWPoseTEEditor._cache.pop(node_id, None)
            print(f"[Editor] Cache cleared for node {node_id}.")
        return web.json_response({"ok": True, "had_cache": existed})
