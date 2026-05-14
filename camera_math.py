"""
Camera motion math for the DWPose Temporal Editor.
Provides PCHIP (monotone cubic) position + quaternion-SLERP rotation interpolation,
and assembly of per-frame extrinsic + intrinsic matrices.

The extrinsic / intrinsic formulas exactly replicate ThreeOrbitRenderer
as coded in dwpose_temporal_editor.js:

  ThreeOrbitRenderer:
    - PerspectiveCamera(45°, aspect, 1, 200000)  — fixed FOV
    - fovZoom = tan(30°) / tan(cam_fov/2)        — distance modifier
    - orbitZoom = cam_z * fovZoom
    - dist = max(poseW, poseH) * 1.4 / orbitZoom
    - lookAt = (cam_x*poseW, -cam_y*poseH, 0)    — Three.js Y-up world
    - camPos = lookAt + orbit(pan, tilt, dist)
    - camera.lookAt(lookAt)

Coordinate conventions:
  Three.js world: X right, Y up,   Z toward viewer (OpenGL)
  Python pixel:   X right, Y down, Z toward viewer (editor units * Z_SCALE)

  Mapping:  x_px = x_3d + poseW/2
            y_px = poseH/2 - y_3d
            z_px = z_3d

SciPy is optional; falls back to numpy linear interpolation when not installed.
"""

from __future__ import annotations
import numpy as np
from typing import Dict, Any, Optional

try:
    from scipy.interpolate import PchipInterpolator
    from scipy.spatial.transform import Rotation as R, Slerp
    _SCIPY = True
except ImportError:
    _SCIPY = False

CAM_KEYS = ["cam_x", "cam_y", "cam_z", "cam_roll", "cam_tilt", "cam_pan", "cam_fov"]

# Three.js PerspectiveCamera FOV (hardcoded in ThreeOrbitRenderer._setup)
_THREE_JS_FOV_DEG = 45.0
# Reference FOV for fovZoom (cam_fov=60° → fovZoom=1, no change)
_REF_HALF_TAN = np.tan(np.deg2rad(30.0))


def extract_camera_keyframes(
    overrides: Dict[str, Any],
    frame_count: int,
) -> Optional[Dict[str, Any]]:
    """
    Pull camera keyframes out of the editor overrides dict.
    Returns None if no camera KFs exist.
    """
    cam_frames = {}
    for fi_str, ov in overrides.items():
        fi = int(fi_str)
        if any(k in ov for k in CAM_KEYS):
            cam_frames[fi] = ov

    if not cam_frames:
        return None

    times = sorted(cam_frames.keys())

    def get_val(fi, key, default):
        ov = cam_frames.get(fi, {})
        entry = ov.get(key)
        if entry is not None and len(entry) > 0:
            return float(entry[0])
        return default

    positions  = np.array([[get_val(fi, "cam_x",    0.0),
                             get_val(fi, "cam_y",    0.0),
                             get_val(fi, "cam_z",    1.0)] for fi in times])
    eulers_deg = np.array([[get_val(fi, "cam_pan",   0.0),
                             get_val(fi, "cam_tilt",  0.0),
                             get_val(fi, "cam_roll",  0.0)] for fi in times])
    fovs       = np.array([get_val(fi, "cam_fov", 60.0) for fi in times])

    return {
        "times":      np.array(times, dtype=float),
        "positions":  positions,
        "eulers_deg": eulers_deg,
        "fovs":       fovs,
    }


def interpolate_camera(
    kf_data: Dict[str, Any],
    all_frames: np.ndarray,
) -> Dict[str, np.ndarray]:
    """
    Interpolate camera KFs to all_frames.
    Uses PchipInterpolator (monotone cubic) for position + FOV, SLERP for rotation.
    Always returns 'eulers_deg' [N, 3] for use in extrinsic building.
    """
    times      = kf_data["times"]
    positions  = kf_data["positions"]
    eulers_deg = kf_data["eulers_deg"]
    fovs       = kf_data["fovs"]

    n = len(all_frames)
    t_query = np.clip(all_frames.astype(float), times[0], times[-1])

    if _SCIPY and len(times) >= 2:
        # PchipInterpolator: monotone cubic — never overshoots between adjacent keyframes.
        # Critical for cam_z: CubicSpline overshoot causes apparent dolly-in-then-out.
        pos_interp  = PchipInterpolator(times, positions)(t_query).astype(np.float32)

        # pan=yaw(Y), tilt=pitch(X), roll(Z) — intrinsic YXZ
        rots = R.from_euler("YXZ", eulers_deg, degrees=True)
        if len(times) == 1:
            euler_interp = np.tile(eulers_deg[0], (n, 1)).astype(np.float32)
        else:
            slerp        = Slerp(times, rots)
            euler_interp = slerp(t_query).as_euler("YXZ", degrees=True).astype(np.float32)

        fov_interp = np.clip(
            PchipInterpolator(times, fovs)(t_query), 1.0, 200.0
        ).astype(np.float32)
    else:
        pos_interp   = np.array([np.interp(t_query, times, positions[:, i])
                                  for i in range(3)], dtype=np.float32).T
        fov_interp   = np.interp(t_query, times, fovs).astype(np.float32)
        euler_interp = np.array([np.interp(t_query, times, eulers_deg[:, i])
                                  for i in range(3)], dtype=np.float32).T

    return {
        "positions":   pos_interp,
        "eulers_deg":  euler_interp,
        "fovs":        fov_interp,
    }


def _build_js_camera_extrinsic(
    cam_x: float, cam_y: float, cam_z: float,
    pan_deg: float, tilt_deg: float, roll_deg: float,
    cam_fov_deg: float,
    pose_w: float, pose_h: float,
) -> np.ndarray:
    """
    Build 4×4 world-to-camera extrinsic matrix that exactly replicates
    ThreeOrbitRenderer's camera placement and lookAt orientation.

    Python pixel space: joints at [x_px, y_px, z_px] where
        x_px ∈ [0, poseW], y_px ∈ [0, poseH], z_px = z_editor * poseW * 0.35

    Three.js world space (used internally here):
        x_3d = x_px - poseW/2
        y_3d = poseH/2 - y_px   (Y flipped)
        z_3d = z_px
    """
    # ── Step 1: fovZoom and orbit distance (match JS exactly) ──
    fov_half_tan = np.tan(np.deg2rad(max(1.0, cam_fov_deg) / 2.0))
    fov_zoom     = _REF_HALF_TAN / fov_half_tan
    orbit_zoom   = max(0.01, cam_z * fov_zoom)
    dist         = max(pose_w, pose_h) * 1.4 / orbit_zoom

    # ── Step 2: lookAt and camera position in Three.js world ──
    pan  = np.deg2rad(pan_deg)
    tilt = np.deg2rad(tilt_deg)

    look_3d = np.array([cam_x * pose_w, -cam_y * pose_h, 0.0])
    cam_3d  = look_3d + np.array([
        np.sin(pan)  * np.cos(tilt) * dist,
        np.sin(tilt) * dist,
        np.cos(pan)  * np.cos(tilt) * dist,
    ])

    # ── Step 3: look-at rotation (Three.js convention, Y-up right-handed) ──
    fwd = look_3d - cam_3d
    norm = np.linalg.norm(fwd)
    if norm < 1e-8:
        fwd = np.array([0.0, 0.0, -1.0])
    else:
        fwd /= norm

    world_up = np.array([0.0, 1.0, 0.0])
    right = np.cross(fwd, world_up)
    rn = np.linalg.norm(right)
    if rn < 1e-8:
        right = np.array([1.0, 0.0, 0.0])
    else:
        right /= rn
    up_ortho = np.cross(right, fwd)

    # Apply roll (rotation of right/up around the forward axis)
    if roll_deg != 0.0:
        roll = np.deg2rad(roll_deg)
        c, s = np.cos(roll), np.sin(roll)
        right_new    = c * right    - s * up_ortho
        up_ortho_new = s * right    + c * up_ortho
        right, up_ortho = right_new, up_ortho_new

    # Camera-to-world columns: [right, up_ortho, -fwd]
    # (Three.js camera looks along -Z, so camera Z-axis = -fwd)
    R_c2w_3d = np.column_stack([right, up_ortho, -fwd])  # 3×3

    # ── Step 4: convert to Python pixel space extrinsic ──
    # Derivation:
    #   pt_cam_cv  = M_cam @ R_c2w^T @ M_world @ (pt_px - cam_px)
    # where:
    #   M_world = diag([1,-1,1])  (pt_3d from pt_px: x same, y flip, z same)
    #   M_cam   = diag([1,-1,-1]) (Three.js cam → OpenCV cam: flip Y and Z)
    #   cam_px  = (cam_3d.x + poseW/2, poseH/2 - cam_3d.y, cam_3d.z)
    M_world = np.diag([1.0, -1.0,  1.0])
    M_cam   = np.diag([1.0, -1.0, -1.0])

    E_R = M_cam @ R_c2w_3d.T @ M_world  # 3×3 world-to-camera rotation

    cam_px = np.array([
        cam_3d[0] + pose_w * 0.5,
        pose_h * 0.5 - cam_3d[1],
        cam_3d[2],
    ])

    E = np.eye(4, dtype=np.float32)
    E[:3, :3] = E_R.astype(np.float32)
    E[:3,  3] = (-E_R @ cam_px).astype(np.float32)
    return E


def _build_js_intrinsic(pose_w: int, pose_h: int, out_w: int = 0, out_h: int = 0) -> np.ndarray:
    """
    Build 3×3 intrinsic K matching Three.js PerspectiveCamera(45°, aspect).
    Vertical FOV is always 45°; aspect only widens horizontal FOV, so fx = fy.
    When out_w/out_h are given (output canvas), K is for that canvas size.
    """
    rw = out_w if out_w > 0 else pose_w
    rh = out_h if out_h > 0 else pose_h
    fy = (rh / 2.0) / np.tan(np.deg2rad(_THREE_JS_FOV_DEG / 2.0))
    return np.array([
        [fy, 0.0, rw / 2.0],
        [0.0, fy, rh / 2.0],
        [0.0, 0.0, 1.0],
    ], dtype=np.float32)


def compute_camera_matrices(
    overrides: Dict[str, Any],
    frame_count: int,
    pose_w: int,
    pose_h: int,
    out_w: int = 0,
    out_h: int = 0,
) -> Optional[Dict[str, Any]]:
    """
    Full pipeline: editor overrides → interpolated camera → batched matrices.
    Returns None if no camera keyframes exist.
    Returns dict with keys:
        extrinsics [N,4,4], intrinsics [N,3,3], fovs [N], positions [N,3],
        dists [N] (orbit distance per frame, for orthographic projection), scipy_used bool

    out_w/out_h: output canvas size (used for K matrix cx/cy/fy). Defaults to pose_w/pose_h.
    """
    kf_data = extract_camera_keyframes(overrides, frame_count)
    if kf_data is None:
        return None

    all_frames = np.arange(frame_count, dtype=float)
    interp     = interpolate_camera(kf_data, all_frames)

    K          = _build_js_intrinsic(pose_w, pose_h, out_w, out_h)
    extrinsics = np.zeros((frame_count, 4, 4), dtype=np.float32)
    intrinsics = np.tile(K, (frame_count, 1, 1)).astype(np.float32)
    dists      = np.zeros(frame_count, dtype=np.float32)

    for i in range(frame_count):
        cam_x = float(interp["positions"][i, 0])
        cam_y = float(interp["positions"][i, 1])
        cam_z = float(interp["positions"][i, 2])
        pan   = float(interp["eulers_deg"][i, 0])   # cam_pan  → yaw
        tilt  = float(interp["eulers_deg"][i, 1])   # cam_tilt → pitch
        roll  = float(interp["eulers_deg"][i, 2])   # cam_roll
        fov   = float(interp["fovs"][i])             # cam_fov (degrees)

        extrinsics[i] = _build_js_camera_extrinsic(
            cam_x, cam_y, cam_z, pan, tilt, roll, fov, pose_w, pose_h
        )

        # Orbit distance — used for orthographic (parallel) projection output
        fov_half_tan  = np.tan(np.deg2rad(max(1.0, fov) / 2.0))
        fov_zoom      = _REF_HALF_TAN / fov_half_tan
        orbit_zoom    = max(0.01, cam_z * fov_zoom)
        dists[i]      = max(pose_w, pose_h) * 1.4 / orbit_zoom

    return {
        "extrinsics": extrinsics,
        "intrinsics": intrinsics,
        "fovs":       interp["fovs"],
        "positions":  interp["positions"],
        "dists":      dists,
        "scipy_used": _SCIPY,
    }


# Z scale used by the JS orbit view to convert editor-normalised Z units into
# pixel-space depth. Mirrors `Z_SCALE = poseW * 0.35` in dwpose_temporal_editor.js.
def get_z_scale(pose_w: int) -> float:
    return float(pose_w) * 0.35


def project_frame_pts(
    pts: Optional[list],
    E: np.ndarray,
    K: np.ndarray,
    z_scale: float,
    ortho_dist: Optional[float] = None,
    z_lookup: Optional[list] = None,
) -> Optional[list]:
    """Project pixel-space joints through camera extrinsic E [4,4] + intrinsic K [3,3].

    Args:
        pts: list of [x, y, conf] or [x, y, conf, z] joints. None → returns None.
        E: 4x4 extrinsic matrix (world → camera).
        K: 3x3 intrinsic matrix.
        z_scale: depth multiplier — typically `get_z_scale(pose_w)` to match the
                 JS orbit view (`poseW * 0.35`).
        ortho_dist: if set, parallel/orthographic projection at this fixed distance
                    (no perspective divide).
        z_lookup: optional parallel list of Z values; when provided overrides pt[3].
                  Used by the retargeter to inject Z from an external KEYFRAME_DATA
                  source (since AAPoseMeta's kps_body is 2D-only).

    Returns: list of [px, py, conf] in output pixel coords (sized by K), or None.

    Joints with conf < 0.01 collapse to (0, 0, conf) and are skipped at render time.
    Joints behind the camera (z_cam <= 0.01) under perspective projection collapse
    to (0, 0, 0).
    """
    if pts is None:
        return None
    out: list = []
    for pi, pt in enumerate(pts):
        xn, yn = float(pt[0]), float(pt[1])
        conf = float(pt[2]) if len(pt) > 2 else 1.0
        if z_lookup is not None and pi < len(z_lookup) and z_lookup[pi] is not None:
            zv = float(z_lookup[pi])
        else:
            zv = float(pt[3]) if len(pt) > 3 and pt[3] is not None else 0.0
        if conf < 0.01:
            out.append([0.0, 0.0, conf])
            continue
        pt_h = np.array([xn, yn, zv * z_scale, 1.0], dtype=np.float32)
        pt_cam = E @ pt_h
        if ortho_dist is not None:
            px = K[0, 0] * pt_cam[0] / ortho_dist + K[0, 2]
            py = K[1, 1] * pt_cam[1] / ortho_dist + K[1, 2]
        else:
            if pt_cam[2] <= 0.01:
                out.append([0.0, 0.0, 0.0])
                continue
            px = K[0, 0] * pt_cam[0] / pt_cam[2] + K[0, 2]
            py = K[1, 1] * pt_cam[1] / pt_cam[2] + K[1, 2]
        out.append([float(px), float(py), conf])
    return out
