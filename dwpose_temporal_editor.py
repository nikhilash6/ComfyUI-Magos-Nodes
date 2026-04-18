"""
DWPose Temporal Editor — Node 2
Caches KEYFRAME_DATA server-side, exposes REST API for the pop-up JS editor,
applies overrides + Gaussian smoothing, and outputs both KEYFRAME_DATA and POSEDATA.
"""

import copy
import json
import base64
import io
import numpy as np
import torch
from typing import Dict, Any, Optional

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
                wx   += w * body_xy[src, ki, 0]
                wy   += w * body_xy[src, ki, 1]
                wsum += w
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
    Fill in interpolated joint positions for every frame that lies between two
    explicit override keyframes.  Keyframe frames themselves are never modified.
    Mirrors the JS _interpolateJoint() + _catmullRomInterp() logic exactly.

    tweens: {str(fi_left): {label: mode_string}} — per-segment easing overrides.
    catmull_tension: α for Catmull-Rom (default 0.5 = centripetal).
    """
    if not overrides:
        return kfd

    tweens = tweens or {}

    # Build per-joint sorted keyframe index lists
    joint_kf: Dict[str, list] = {}
    for frame_key, point_overrides in overrides.items():
        fi = int(frame_key)
        for label in point_overrides:
            joint_kf.setdefault(label, []).append(fi)

    for label in joint_kf:
        joint_kf[label].sort()

    frames = kfd["frames"]

    def _get_xy(fi: int, group: str, ki: int):
        """Return (x, y) for the joint at frame fi, or None."""
        frame = frames.get(fi)
        if frame is None:
            return None
        pt = _get_joint(frame, group, ki)
        return (float(pt[0]), float(pt[1])) if pt is not None else None

    for label, kf_indices in joint_kf.items():
        if len(kf_indices) < 2:
            continue

        parts = label.split("_", 1)
        if len(parts) != 2:
            continue
        group, idx_str = parts[0], parts[1]
        try:
            ki = int(idx_str)
        except ValueError:
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
                # Hold: in-between frames keep the anchor value (already written)
                continue

            xy_a = _get_xy(fi_a, group, ki)
            xy_b = _get_xy(fi_b, group, ki)
            if xy_a is None or xy_b is None:
                continue

            ax, ay = xy_a
            bx, by = xy_b

            if seg_mode == "catmull_rom":
                # Need the neighbour keyframes for ghost endpoints
                fi_prev = kf_indices[seg - 1] if seg > 0 else None
                fi_next = kf_indices[seg + 2] if seg + 2 < len(kf_indices) else None

                xy_prev = _get_xy(fi_prev, group, ki) if fi_prev is not None else None
                xy_next = _get_xy(fi_next, group, ki) if fi_next is not None else None

                # Mirror ghost endpoints at boundaries (same as JS)
                if xy_prev is None:
                    px, py = ax * 2.0 - bx, ay * 2.0 - by   # mirror fi_b around fi_a
                else:
                    px, py = xy_prev

                if xy_next is None:
                    nx, ny = bx * 2.0 - ax, by * 2.0 - ay   # mirror fi_a around fi_b
                else:
                    nx, ny = xy_next

                for fi in range(fi_a + 1, fi_b):
                    raw_t = (fi - fi_a) / span
                    ix = _catmull_rom_scalar(px, ax, bx, nx, raw_t, catmull_tension)
                    iy = _catmull_rom_scalar(py, ay, by, ny, raw_t, catmull_tension)
                    frame = frames.get(fi)
                    if frame is not None:
                        _set_joint_xy(frame, group, ki, ix, iy)
            else:
                # All easing modes: lerp with eased t
                for fi in range(fi_a + 1, fi_b):
                    raw_t = (fi - fi_a) / span
                    t     = _ease_t(raw_t, seg_mode)
                    ix    = ax + (bx - ax) * t
                    iy    = ay + (by - ay) * t
                    frame = frames.get(fi)
                    if frame is not None:
                        _set_joint_xy(frame, group, ki, ix, iy)

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
    RETURN_TYPES  = ("KEYFRAME_DATA", "POSEDATA")
    RETURN_NAMES  = ("keyframe_data", "pose_data")
    FUNCTION    = "edit"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "keyframe_data": ("KEYFRAME_DATA",),
            },
            "optional": {
                "source_images":    ("IMAGE",),
                "editor_state_json": ("STRING", {"default": "{}"}),
                "nlf_model":        ("NLF_MODEL",),
                "export_format":    (["dwpose", "nlf_3d"], {"default": "dwpose"}),
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

    def edit(
        self,
        keyframe_data: Dict[str, Any],
        source_images: Optional[torch.Tensor] = None,
        editor_state_json: str = "{}",
        nlf_model=None,
        export_format: str = "dwpose",
        unique_id: str = "0",
    ) -> Dict[str, Any]:

        node_id = str(unique_id)

        # 1. Parse editor state
        try:
            editor_state = json.loads(editor_state_json) if editor_state_json else {}
        except (json.JSONDecodeError, TypeError):
            editor_state = {}

        # 1b. Fingerprint check — discard saved state if footage changed
        current_fp = (
            f"{keyframe_data.get('frame_count', 0)}"
            f":{keyframe_data.get('width', 0)}"
            f":{keyframe_data.get('height', 0)}"
        )
        saved_fp = editor_state.get("_fingerprint", "")
        if saved_fp and saved_fp != current_fp:
            print(
                f"DWPoseTEEditor [{node_id}]: footage fingerprint changed "
                f"({saved_fp!r} → {current_fp!r}). Editor state reset."
            )
            editor_state = {}

        overrides        = editor_state.get("overrides",       {})
        z_depth          = editor_state.get("z_depth",         {})
        smooth_window    = int(editor_state.get("smooth_window", 0))
        interp_mode      = editor_state.get("interpolation",   "linear")
        tweens           = editor_state.get("tweens",           {})
        catmull_tension  = float(editor_state.get("catmull_tension", 0.5))

        # 2. Cache raw data for the JS editor to fetch
        DWPoseTEEditor._cache[node_id] = {
            "keyframe_data": keyframe_data,
            "source_images": source_images,
            "editor_state":  editor_state,
        }

        # 3. Apply overrides onto a working copy
        working_kfd = copy.deepcopy(keyframe_data)
        # Bake overrides and z_depth into the working copy
        working_kfd["overrides"] = overrides
        working_kfd["z_depth"]   = {int(k): v for k, v in z_depth.items()} if z_depth else {}
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
                            body[ki][0] = float(coords[0])
                            body[ki][1] = float(coords[1])
                            # conf=0 signals disabled joint
                            if len(coords) >= 3:
                                body[ki][2] = float(coords[2])
                        elif isinstance(coords, dict):
                            body[ki][0] = float(coords.get("x", body[ki][0]))
                            body[ki][1] = float(coords.get("y", body[ki][1]))
                            if "conf" in coords:
                                body[ki][2] = float(coords["conf"])

                elif group in ("lhand", "rhand"):
                    hand = frame.get(group)
                    if hand is not None and ki < len(hand):
                        if isinstance(coords, list) and len(coords) >= 2:
                            hand[ki][0] = float(coords[0])
                            hand[ki][1] = float(coords[1])
                        elif isinstance(coords, dict):
                            hand[ki][0] = float(coords.get("x", hand[ki][0]))
                            hand[ki][1] = float(coords.get("y", hand[ki][1]))

                elif group == "face":
                    face = frame.get("face")
                    if face is not None and ki < len(face):
                        if isinstance(coords, list) and len(coords) >= 2:
                            face[ki][0] = float(coords[0])
                            face[ki][1] = float(coords[1])
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

        z_depth_baked = working_kfd.get("z_depth", {})

        pose_metas = []
        for fi in range(frame_count):
            frame = frames.get(fi, {
                "width": W, "height": H,
                "body": [[0.0, 0.0, 0.0]] * 20,
                "rhand": None, "lhand": None, "face": None,
            })
            entry = _frame_to_posedata_entry(frame)
            if export_format == "nlf_3d":
                z_fi = z_depth_baked.get(fi) or z_depth_baked.get(str(fi)) or {}
                if isinstance(entry, dict):
                    entry["z_depth"] = z_fi
                else:
                    entry.z_depth = z_fi
            pose_metas.append(entry)

        pose_data = {
            "pose_metas":    pose_metas,
            "width":         W,
            "height":        H,
            "export_format": export_format,
        }

        # Cache NLF inference results when a model is connected
        if source_images is None:
            pass
        elif nlf_model is None:
            self._cache[unique_id]["nlf_error"] = "NLFModelLoader node not connected"
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

        return {"ui": {}, "result": (working_kfd, pose_data)}


# ---------------------------------------------------------------------------
# REST API — registered once at module import
# ---------------------------------------------------------------------------
if _SERVER_AVAILABLE:
    routes = PromptServer.instance.routes

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
        raw_z = {str(k): v for k, v in kfd.get("z_depth", {}).items()}
        payload = {
            "frame_count":    kfd.get("frame_count", 0),
            "width":          kfd.get("width",  512),
            "height":         kfd.get("height", 512),
            "frames":         frames_json,
            "overrides":      editor_state.get("overrides",      kfd.get("overrides", {})),
            "z_depth":        editor_state.get("z_depth",        raw_z),
            "smooth_window":  editor_state.get("smooth_window",  kfd.get("smooth_window", 0)),
            "tweens":         editor_state.get("tweens",         {}),
            "catmull_tension": editor_state.get("catmull_tension", 0.5),
            "interpolation":  editor_state.get("interpolation",  "catmull_rom"),
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
        return web.json_response({"available": True, "frames": nlf_data})


# ---------------------------------------------------------------------------
# NLF Model Loader node
# ---------------------------------------------------------------------------
class NLFModelLoader:
    """
    Loads a Neural Localizer Fields (NLF) model for true 3D depth estimation.
    Connect the output to DWPoseTEEditor and set export_format=nlf_3d to include
    z_depth in the POSEDATA output for use with WAN SCAIL.
    """
    CATEGORY = "MAGOS Nodes/Temporal Editor"
    RETURN_TYPES = ("NLF_MODEL",)
    RETURN_NAMES = ("nlf_model",)
    FUNCTION = "load"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_path": ("STRING", {
                    "default": "nlf_l_multi_0.3.2_fp16.safetensors",
                }),
            }
        }

    def load(self, model_path: str):
        from .nlf_integration import NLF_AVAILABLE, NLFStub
        stub = NLFStub()
        if not NLF_AVAILABLE:
            stub.error = "nlf package not installed — run: pip install nlf"
            print(f"[NLFModelLoader] {stub.error}")
            return (stub,)
        try:
            from .nlf_integration import load_nlf_model
            model = load_nlf_model(model_path)
            return (model,)
        except Exception as e:
            stub.error = str(e)
            print(f"[NLFModelLoader] Failed to load model: {e}")
            return (stub,)
