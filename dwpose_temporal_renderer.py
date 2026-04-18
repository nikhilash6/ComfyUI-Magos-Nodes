"""
DWPose Temporal Renderer — Magos Nodes
Author: Magos Digital Studio

Renders POSEDATA (required) + optional KEYFRAME_DATA (for Z-depth sorted body bones)
into an IMAGE batch. Drop-in replacement for DrawViTPose.
"""

import sys
import numpy as np
import torch
import cv2
from typing import Dict, Any, Optional, List


# ---------------------------------------------------------------------------
# Body skeleton connections and colors (DWPose 20-keypoint format)
# Indices: NOSE=0 NECK=1 R_SHOULDER=2 R_ELBOW=3 R_WRIST=4
#          L_SHOULDER=5 L_ELBOW=6 L_WRIST=7 R_HIP=8 R_KNEE=9
#          R_ANKLE=10 L_HIP=11 L_KNEE=12 L_ANKLE=13
#          R_EYE=14 L_EYE=15 R_EAR=16 L_EAR=17 L_TOE=18 R_TOE=19
# ---------------------------------------------------------------------------
BODY_CONNECTIONS = [
    # (joint_a, joint_b, color_BGR)
    (1, 2,  (255,   0,   0)),   # neck → R shoulder  (blue)
    (1, 5,  (  0, 255,   0)),   # neck → L shoulder  (green)
    (2, 3,  (255,   0,   0)),   # R shoulder → R elbow
    (3, 4,  (255,   0,   0)),   # R elbow → R wrist
    (5, 6,  (  0, 255,   0)),   # L shoulder → L elbow
    (6, 7,  (  0, 255,   0)),   # L elbow → L wrist
    (1, 8,  (255, 255,   0)),   # neck → R hip (cyan)
    (1, 11, (255,   0, 255)),   # neck → L hip (magenta)
    (8, 9,  (255, 255,   0)),   # R hip → R knee
    (9, 10, (255, 255,   0)),   # R knee → R ankle
    (11,12, (255,   0, 255)),   # L hip → L knee
    (12,13, (255,   0, 255)),   # L knee → L ankle
    (0, 1,  (  0, 255, 255)),   # nose → neck (yellow)
    (0, 14, (200, 200, 200)),   # nose → R eye
    (0, 15, (200, 200, 200)),   # nose → L eye
    (14,16, (150, 150, 150)),   # R eye → R ear
    (15,17, (150, 150, 150)),   # L eye → L ear
    (10,19, (255, 180,   0)),   # R ankle → R toe
    (13,18, (255,   0, 180)),   # L ankle → L toe
]

JOINT_COLORS = {
    0:  (  0, 255, 255),   # nose
    1:  (255, 255,   0),   # neck
    2:  (255,   0,   0),   # R shoulder
    3:  (255,   0,   0),   # R elbow
    4:  (255,   0,   0),   # R wrist
    5:  (  0, 255,   0),   # L shoulder
    6:  (  0, 255,   0),   # L elbow
    7:  (  0, 255,   0),   # L wrist
    8:  (255, 255,   0),   # R hip
    9:  (255, 255,   0),   # R knee
    10: (255, 255,   0),   # R ankle
    11: (255,   0, 255),   # L hip
    12: (255,   0, 255),   # L knee
    13: (255,   0, 255),   # L ankle
    14: (200, 200, 200),   # R eye
    15: (200, 200, 200),   # L eye
    16: (150, 150, 150),   # R ear
    17: (150, 150, 150),   # L ear
    18: (255,   0, 180),   # L toe
    19: (255, 180,   0),   # R toe
}

HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),         # thumb
    (0,5),(5,6),(6,7),(7,8),         # index
    (0,9),(9,10),(10,11),(11,12),    # middle
    (0,13),(13,14),(14,15),(15,16),  # ring
    (0,17),(17,18),(18,19),(19,20),  # pinky
]

FACE_CONNECTIONS = [
    *[(i, i+1) for i in range(0, 16)],   # jaw line
    *[(i, i+1) for i in range(17, 21)],  # R eyebrow
    *[(i, i+1) for i in range(22, 26)],  # L eyebrow
    *[(i, i+1) for i in range(27, 30)],  # nose bridge
    *[(i, i+1) for i in range(31, 35)],  # nose bottom
    *[(i, i+1) for i in range(36, 41)],  # R eye
    (41, 36),
    *[(i, i+1) for i in range(42, 47)],  # L eye
    (47, 42),
    *[(i, i+1) for i in range(48, 59)],  # outer lip
    (59, 48),
    *[(i, i+1) for i in range(60, 67)],  # inner lip
    (67, 60),
]


def _get_draw_fn():
    """Try to import draw_aapose_by_meta_new from WanAnimatePreprocess."""
    for key, mod in sys.modules.items():
        if "WanAnimatePreprocess" not in key:
            continue
        fn = getattr(mod, "draw_aapose_by_meta_new", None)
        if fn is not None:
            return fn
    return None


def _kps_from_meta(meta) -> tuple:
    """Extract (kps_body, kps_body_p, kps_rhand, kps_rhand_p, kps_lhand, kps_lhand_p, kps_face, kps_face_p, W, H) from meta."""
    if isinstance(meta, dict):
        kps_body    = meta.get("kps_body",    np.zeros((20, 2), dtype=np.float32))
        kps_body_p  = meta.get("kps_body_p",  np.zeros(20,       dtype=np.float32))
        kps_rhand   = meta.get("kps_rhand",   np.zeros((21, 2),  dtype=np.float32))
        kps_rhand_p = meta.get("kps_rhand_p", np.zeros(21,       dtype=np.float32))
        kps_lhand   = meta.get("kps_lhand",   np.zeros((21, 2),  dtype=np.float32))
        kps_lhand_p = meta.get("kps_lhand_p", np.zeros(21,       dtype=np.float32))
        kps_face    = meta.get("kps_face",    np.zeros((70, 2),  dtype=np.float32))
        kps_face_p  = meta.get("kps_face_p",  np.zeros(70,       dtype=np.float32))
        W = meta.get("width",  512)
        H = meta.get("height", 512)
    else:
        kps_body    = getattr(meta, "kps_body",    np.zeros((20, 2), dtype=np.float32))
        kps_body_p  = getattr(meta, "kps_body_p",  np.zeros(20,       dtype=np.float32))
        kps_rhand   = getattr(meta, "kps_rhand",   np.zeros((21, 2),  dtype=np.float32))
        kps_rhand_p = getattr(meta, "kps_rhand_p", np.zeros(21,       dtype=np.float32))
        kps_lhand   = getattr(meta, "kps_lhand",   np.zeros((21, 2),  dtype=np.float32))
        kps_lhand_p = getattr(meta, "kps_lhand_p", np.zeros(21,       dtype=np.float32))
        kps_face    = getattr(meta, "kps_face",    np.zeros((70, 2),  dtype=np.float32))
        kps_face_p  = getattr(meta, "kps_face_p",  np.zeros(70,       dtype=np.float32))
        W = getattr(meta, "width",  512)
        H = getattr(meta, "height", 512)

    # Guard against None values (draw_aapose_by_meta_new crashes on None)
    if kps_rhand   is None: kps_rhand   = np.zeros((21, 2), dtype=np.float32)
    if kps_rhand_p is None: kps_rhand_p = np.zeros(21,       dtype=np.float32)
    if kps_lhand   is None: kps_lhand   = np.zeros((21, 2), dtype=np.float32)
    if kps_lhand_p is None: kps_lhand_p = np.zeros(21,       dtype=np.float32)
    if kps_face    is None: kps_face    = np.zeros((70, 2), dtype=np.float32)
    if kps_face_p  is None: kps_face_p  = np.zeros(70,       dtype=np.float32)

    # Force numpy — AAPoseMeta may store these as plain Python lists
    kps_body    = np.asarray(kps_body,    dtype=np.float32)
    kps_body_p  = np.asarray(kps_body_p,  dtype=np.float32)
    kps_rhand   = np.asarray(kps_rhand,   dtype=np.float32)
    kps_rhand_p = np.asarray(kps_rhand_p, dtype=np.float32)
    kps_lhand   = np.asarray(kps_lhand,   dtype=np.float32)
    kps_lhand_p = np.asarray(kps_lhand_p, dtype=np.float32)
    kps_face    = np.asarray(kps_face,    dtype=np.float32)
    kps_face_p  = np.asarray(kps_face_p,  dtype=np.float32)

    # Ensure correct shapes (reshape if stored as flat or (N,3))
    if kps_body.ndim == 2 and kps_body.shape[1] == 3:   kps_body   = kps_body[:, :2]
    if kps_rhand.ndim == 2 and kps_rhand.shape[1] == 3: kps_rhand  = kps_rhand[:, :2]
    if kps_lhand.ndim == 2 and kps_lhand.shape[1] == 3: kps_lhand  = kps_lhand[:, :2]
    if kps_face.ndim == 2 and kps_face.shape[1] == 3:   kps_face   = kps_face[:, :2]

    # WanAnimatePreprocess's load_pose_metas_from_kp2ds_seq slices kp2ds[22:91],
    # which includes the right_heel foot keypoint at index 22 before the 68 real
    # 300W face landmarks (23-90).  Drop that spurious first point so FACE_CONNECTIONS
    # (0-indexed for 68 pts) map correctly.
    if kps_face.shape[0] == 69:
        kps_face   = kps_face[1:]
        kps_face_p = kps_face_p[1:]

    return kps_body, kps_body_p, kps_rhand, kps_rhand_p, kps_lhand, kps_lhand_p, kps_face, kps_face_p, W, H


CONF_THRESHOLD = 0.5  # matches DrawViTPose behaviour


def _render_frame(
    meta,
    frame_idx: int,
    z_depth_map: Optional[Dict[int, Dict[str, float]]],
    W: int,
    H: int,
) -> tuple:
    """
    Render one frame into two separate uint8 (H, W, 3) BGR numpy arrays:
      - pose canvas: body (Z-sorted) + hands
      - face canvas: face landmarks only

    Returns (pose_bgr, face_bgr).
    """
    pose_canvas = np.zeros((H, W, 3), dtype=np.uint8)
    face_canvas = np.zeros((H, W, 3), dtype=np.uint8)

    kps_body, kps_body_p, kps_rhand, kps_rhand_p, kps_lhand, kps_lhand_p, kps_face, kps_face_p, fw, fh = _kps_from_meta(meta)

    # ---------- Z-depth lookup ----------
    z_frame: Dict[str, float] = {}
    if z_depth_map:
        z_frame = z_depth_map.get(frame_idx, {})

    def get_z(joint_idx: int) -> float:
        return z_frame.get(f"body_{joint_idx}", 0.0)

    # ---------- Build connection list with avg Z ----------
    conn_list = []
    for (a, b, color) in BODY_CONNECTIONS:
        if kps_body_p[a] < CONF_THRESHOLD or kps_body_p[b] < CONF_THRESHOLD:
            continue
        avg_z = (get_z(a) + get_z(b)) / 2.0
        conn_list.append((avg_z, a, b, color))

    # Sort: higher Z = further back → draw first (painter's algorithm)
    conn_list.sort(key=lambda x: x[0], reverse=True)

    # ---------- Draw body connections (back to front) ----------
    for avg_z, a, b, color in conn_list:
        pt_a = (int(kps_body[a, 0]), int(kps_body[a, 1]))
        pt_b = (int(kps_body[b, 0]), int(kps_body[b, 1]))
        cv2.line(pose_canvas, pt_a, pt_b, color, 2, cv2.LINE_AA)

    # ---------- Draw body joints (back to front) ----------
    joint_z = [(get_z(i), i) for i in range(20) if kps_body_p[i] >= CONF_THRESHOLD]
    joint_z.sort(key=lambda x: x[0], reverse=True)
    for _, i in joint_z:
        pt = (int(kps_body[i, 0]), int(kps_body[i, 1]))
        color = JOINT_COLORS.get(i, (255, 255, 255))
        cv2.circle(pose_canvas, pt, 4, color, -1, cv2.LINE_AA)

    # ---------- Draw hands (onto pose canvas) ----------
    for hand_kps, hand_p, base_color in [
        (kps_rhand, kps_rhand_p, (  0, 100, 255)),
        (kps_lhand, kps_lhand_p, (  0, 200, 100)),
    ]:
        if np.all(hand_p < CONF_THRESHOLD):
            continue
        for (a, b) in HAND_CONNECTIONS:
            if hand_p[a] < CONF_THRESHOLD or hand_p[b] < CONF_THRESHOLD:
                continue
            pt_a = (int(hand_kps[a, 0]), int(hand_kps[a, 1]))
            pt_b = (int(hand_kps[b, 0]), int(hand_kps[b, 1]))
            cv2.line(pose_canvas, pt_a, pt_b, base_color, 1, cv2.LINE_AA)
        for i in range(21):
            if hand_p[i] < CONF_THRESHOLD:
                continue
            pt = (int(hand_kps[i, 0]), int(hand_kps[i, 1]))
            cv2.circle(pose_canvas, pt, 3, base_color, -1, cv2.LINE_AA)

    # ---------- Draw face (onto face canvas only) ----------
    if np.any(kps_face_p >= CONF_THRESHOLD):
        for (a, b) in FACE_CONNECTIONS:
            if a >= len(kps_face_p) or b >= len(kps_face_p):
                continue
            if kps_face_p[a] < CONF_THRESHOLD or kps_face_p[b] < CONF_THRESHOLD:
                continue
            pt_a = (int(kps_face[a, 0]), int(kps_face[a, 1]))
            pt_b = (int(kps_face[b, 0]), int(kps_face[b, 1]))
            cv2.line(face_canvas, pt_a, pt_b, (200, 200, 200), 1, cv2.LINE_AA)

    return pose_canvas, face_canvas


def _build_pose_keypoints(pose_metas, W: int, H: int) -> list:
    """Build ControlNet-aux POSE_KEYPOINT format (one dict per frame)."""
    result = []
    for meta in pose_metas:
        kps_body, kps_body_p, kps_rhand, kps_rhand_p, \
        kps_lhand, kps_lhand_p, kps_face, kps_face_p, fw, fh = _kps_from_meta(meta)

        body18 = [[float(kps_body[i, 0]), float(kps_body[i, 1]), float(kps_body_p[i])]
                  for i in range(min(18, len(kps_body)))]
        lhand  = [[float(kps_lhand[i, 0]), float(kps_lhand[i, 1]), float(kps_lhand_p[i])]
                  for i in range(min(21, len(kps_lhand)))]
        rhand  = [[float(kps_rhand[i, 0]), float(kps_rhand[i, 1]), float(kps_rhand_p[i])]
                  for i in range(min(21, len(kps_rhand)))]
        face   = [[float(kps_face[i, 0]),  float(kps_face[i, 1]),  float(kps_face_p[i])]
                  for i in range(min(68, len(kps_face)))]

        result.append({
            "people": [{
                "pose_keypoints_2d":       body18,
                "face_keypoints_2d":       face,
                "hand_left_keypoints_2d":  lhand,
                "hand_right_keypoints_2d": rhand,
            }],
            "canvas_height": int(fh) if fh else H,
            "canvas_width":  int(fw) if fw else W,
        })
    return result


class DWPoseTERenderer:
    """
    Renders a POSEDATA batch into colored skeleton images with optional Z-depth sorting.
    Drop-in replacement for DrawViTPose.
    """

    CATEGORY     = "MAGOS Nodes/Temporal Editor"
    RETURN_TYPES = ("IMAGE", "IMAGE", "POSE_KEYPOINT")
    RETURN_NAMES = ("pose_images", "face_images", "pose_keypoints")
    FUNCTION     = "render"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "pose_data": ("POSEDATA",),
            },
            "optional": {
                "keyframe_data":     ("KEYFRAME_DATA",),
                "draw_face_on_pose": ("BOOLEAN", {"default": False,
                                                  "label_on":  "Face on Pose: On",
                                                  "label_off": "Face on Pose: Off"}),
            },
        }

    def render(
        self,
        pose_data: Any,
        keyframe_data: Optional[Dict[str, Any]] = None,
        draw_face_on_pose: bool = False,
    ) -> tuple:

        # --- Unpack POSEDATA ---
        if isinstance(pose_data, list):
            pose_metas = pose_data
        elif isinstance(pose_data, dict):
            pose_metas = pose_data.get("pose_metas", [pose_data])
        else:
            pose_metas = [pose_data]

        if not pose_metas:
            dummy = torch.zeros((1, 512, 512, 3), dtype=torch.float32)
            return (dummy, dummy, [])

        # Determine canvas size from first frame
        first = pose_metas[0]
        if isinstance(first, dict):
            W = int(first.get("width",  512))
            H = int(first.get("height", 512))
        else:
            W = int(getattr(first, "width",  512))
            H = int(getattr(first, "height", 512))

        # --- Unpack Z-depth map from KEYFRAME_DATA ---
        z_depth_map: Optional[Dict[int, Dict[str, float]]] = None
        if keyframe_data is not None:
            raw_z = keyframe_data.get("z_depth", {})
            if raw_z:
                z_depth_map = {int(k): v for k, v in raw_z.items()}

        # --- Render each frame ---
        pose_frames: List[np.ndarray] = []
        face_frames: List[np.ndarray] = []
        for fi, meta in enumerate(pose_metas):
            pose_bgr, face_bgr = _render_frame(meta, fi, z_depth_map, W, H)
            if draw_face_on_pose:
                pose_bgr = cv2.add(pose_bgr, face_bgr)
            pose_frames.append(cv2.cvtColor(pose_bgr, cv2.COLOR_BGR2RGB))
            face_frames.append(cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB))

        # Stack → (B, H, W, C) float32 tensors
        pose_tensor = torch.from_numpy(np.stack(pose_frames, axis=0).astype(np.float32) / 255.0)
        face_tensor = torch.from_numpy(np.stack(face_frames, axis=0).astype(np.float32) / 255.0)

        pose_keypoints = _build_pose_keypoints(pose_metas, W, H)
        return (pose_tensor, face_tensor, pose_keypoints)
