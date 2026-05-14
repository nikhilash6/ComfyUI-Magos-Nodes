"""
DWPose Temporal Extractor — Magos Nodes
Author: Magos Digital Studio

Detection pipeline extended from WanAnimatePreprocess/nodes.py (PoseAndFaceDetection)
with KEYFRAME_DATA output, per-frame detection flags, person_index selection,
and carry-forward on missed frames.

Original detection code © WanAnimatePreprocess authors — used under their license.
"""

import sys
import copy
import numpy as np
import torch
import cv2
from typing import Dict, Any, Optional, List

try:
    from comfy.utils import ProgressBar
    _COMFY_PBAR = True
except ImportError:
    _COMFY_PBAR = False

try:
    import folder_paths
    _FOLDER_PATHS = True
except ImportError:
    _FOLDER_PATHS = False


# ---------------------------------------------------------------------------
# Dynamic imports from WanAnimatePreprocess (hyphen prevents direct import)
# ---------------------------------------------------------------------------

def _wan_import(attr: str):
    """Scan sys.modules for a WanAnimatePreprocess sub-module that has `attr`."""
    for key, mod in sys.modules.items():
        if "WanAnimatePreprocess" not in key:
            continue
        obj = getattr(mod, attr, None)
        if obj is not None:
            return obj
    raise ImportError(
        f"'{attr}' not found in any WanAnimatePreprocess module. "
        "Make sure WanAnimatePreprocess is installed and loaded before this node."
    )


def _get_wan_fns():
    """
    Return (load_pose_metas_from_kp2ds_seq, crop, bbox_from_detector).
    These are imported lazily so the node can be registered even if
    WanAnimatePreprocess hasn't been loaded yet.
    """
    load_fn  = _wan_import("load_pose_metas_from_kp2ds_seq")
    crop_fn  = _wan_import("crop")
    bbox_fn  = _wan_import("bbox_from_detector")
    return load_fn, crop_fn, bbox_fn


def _get_wan_model_classes():
    """Return (ViTPose, Yolo) ONNX wrapper classes from WanAnimatePreprocess."""
    vitpose_cls = _wan_import("ViTPose")
    yolo_cls    = _wan_import("Yolo")
    return vitpose_cls, yolo_cls


# ---------------------------------------------------------------------------
# Constants (match PoseAndFaceDetection exactly)
# ---------------------------------------------------------------------------
IMG_NORM_MEAN    = np.array([0.485, 0.456, 0.406])
IMG_NORM_STD     = np.array([0.229, 0.224, 0.225])
INPUT_RESOLUTION = (256, 192)   # (H, W) for ViTPose crop
RESCALE          = 1.25         # bbox expansion factor

# Body keypoint indices in the 20-pt AAPoseMeta format
HEAD_INDICES = [0, 14, 15, 16, 17]   # NOSE, R_EYE, L_EYE, R_EAR, L_EAR


# ---------------------------------------------------------------------------
# Node class
# ---------------------------------------------------------------------------
class DWPoseTEExtractor:
    """
    Detects body/hand/face keypoints using YOLO + ViTPose (same models as
    WanAnimatePreprocess) and outputs KEYFRAME_DATA for the temporal editor.
    """

    CATEGORY     = "MAGOS Nodes/Temporal Editor"
    RETURN_TYPES = ("KEYFRAME_DATA", "POSEDATA", "IMAGE", "BBOX", "BBOX", "NLF_MODEL")
    RETURN_NAMES = ("keyframe_data", "pose_data", "face_images", "bboxes", "facebboxes", "nlf_model")
    FUNCTION     = "extract"

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        all_models    = folder_paths.get_filename_list("detection") if _FOLDER_PATHS else []
        vitpose_models = [m for m in all_models if "vitpose" in m.lower()] or all_models
        yolo_models    = [m for m in all_models if "yolo"    in m.lower()] or all_models

        try:
            from .nlf_integration import list_nlf_models
            nlf_choices = ["(None)"] + list_nlf_models()
        except Exception:
            nlf_choices = ["(None)"]

        return {
            "required": {
                "images":               ("IMAGE",),
                "vitpose_model":        (vitpose_models, {"tooltip": "ViTPose ONNX model from ComfyUI/models/detection"}),
                "yolo_model":           (yolo_models,    {"tooltip": "YOLO ONNX model from ComfyUI/models/detection"}),
                "nlf_model":            (nlf_choices,    {"default": "(None)", "tooltip": "NLF .safetensors from ComfyUI/models/nlf/ for 3D depth. Requires ComfyUI-SCAIL-Pose. Select (None) to skip."}),
                "onnx_device":          (["CUDAExecutionProvider", "CPUExecutionProvider"], {"default": "CUDAExecutionProvider", "tooltip": "Device to run the ONNX models on"}),
                "detect_hands":         ("BOOLEAN", {"default": True,  "label_on": "Hands: On",  "label_off": "Hands: Off"}),
                "detect_face":          ("BOOLEAN", {"default": True,  "label_on": "Face: On",   "label_off": "Face: Off"}),
                "detect_head":          ("BOOLEAN", {"default": True,  "label_on": "Head: On",   "label_off": "Head: Off"}),
                "confidence_threshold": ("FLOAT",   {"default": 0.3,   "min": 0.0, "max": 1.0,   "step": 0.01}),
                "person_index":         ("INT",     {"default": 0,     "min": 0,   "max": 9,      "step": 1}),
                "output_width":         ("INT",     {"default": 0,     "min": 0,   "max": 8192,   "step": 8,  "tooltip": "0 = use source width"}),
                "output_height":        ("INT",     {"default": 0,     "min": 0,   "max": 8192,   "step": 8,  "tooltip": "0 = use source height"}),
                "face_padding":         ("INT",     {"default": 20,    "min": 0,   "max": 200,    "step": 1}),
                "debug_log":            ("BOOLEAN", {"default": False, "label_on": "Debug: On", "label_off": "Debug: Off", "tooltip": "Write full trace to CMD + logs/session_*.log"}),
            },
        }

    # ------------------------------------------------------------------
    def extract(
        self,
        images: torch.Tensor,
        vitpose_model: str,
        yolo_model: str,
        nlf_model: str              = "(None)",
        onnx_device: str            = "CUDAExecutionProvider",
        detect_hands: bool          = True,
        detect_face: bool           = True,
        detect_head: bool           = True,
        confidence_threshold: float = 0.3,
        person_index: int           = 0,
        output_width: int           = 0,
        output_height: int          = 0,
        face_padding: int           = 20,
        debug_log: bool             = False,
    ) -> tuple:

        from .debug_logger import get_logger
        log = get_logger("Extractor", debug_log)

        # Load NLF model natively (replaces the old NLF_MODEL input port)
        nlf_pipeline = None
        if nlf_model and nlf_model != "(None)":
            try:
                from .nlf_integration import load_nlf_model_scail
                nlf_pipeline = load_nlf_model_scail(nlf_model)
            except Exception as e:
                print(f"[NLF] Extractor: native load failed — {e}")

        log.section("EXTRACT START", {
            "images": images,
            "vitpose_model": vitpose_model,
            "yolo_model": yolo_model,
            "onnx_device": onnx_device,
            "detect_hands": detect_hands,
            "detect_face": detect_face,
            "detect_head": detect_head,
            "confidence_threshold": confidence_threshold,
            "person_index": person_index,
            "output_wh": (output_width, output_height),
            "nlf_model": nlf_model,
        })

        # Load ONNX models (same as OnnxDetectionModelLoader from WanAnimatePreprocess)
        vitpose_path = folder_paths.get_full_path_or_raise("detection", vitpose_model)
        yolo_path    = folder_paths.get_full_path_or_raise("detection", yolo_model)
        ViTPose, Yolo = _get_wan_model_classes()
        detector   = Yolo(yolo_path, onnx_device)
        pose_model = ViTPose(vitpose_path, onnx_device)

        # Lazy-import WanAnimatePreprocess helpers
        load_pose_metas_from_kp2ds_seq, crop, bbox_from_detector = _get_wan_fns()

        B, H, W, C = images.shape
        shape      = np.array([H, W])[None]           # required by YOLO
        images_np  = images.numpy()                   # (B, H, W, C) float32 0–1

        # ----------------------------------------------------------------
        # Step 1 — YOLO: detect person bounding boxes for all frames
        # ----------------------------------------------------------------
        detector.reinit()

        pbar = ProgressBar(B * 2) if _COMFY_PBAR else None
        progress = 0

        raw_detections = []   # one entry per frame: list of bbox dicts or single dict
        for img in images_np:
            frame_dets = detector(
                cv2.resize(img, (640, 640)).transpose(2, 0, 1)[None],
                shape
            )[0]   # list of detections for this frame
            raw_detections.append(frame_dets)
            progress += 1
            if pbar and progress % 5 == 0:
                pbar.update_absolute(progress)

        detector.cleanup()

        # ----------------------------------------------------------------
        # Step 2 — ViTPose: extract 133 keypoints per frame
        # ----------------------------------------------------------------
        pose_model.reinit()

        frames: Dict[int, Any] = {}
        last_valid_frame: Optional[Dict[str, Any]] = None

        for frame_idx, (img, frame_dets) in enumerate(zip(images_np, raw_detections)):
            # --- pick bbox for the requested person_index ---
            bbox = _pick_bbox(frame_dets, person_index)

            if bbox is None or bbox[-1] <= 0 or (bbox[2] - bbox[0]) < 10 or (bbox[3] - bbox[1]) < 10:
                bbox = None   # will trigger carry-forward below

            kp2ds = None
            if bbox is not None:
                try:
                    center, scale = bbox_from_detector(bbox, INPUT_RESOLUTION, rescale=RESCALE)
                    img_crop      = crop(img, center, scale, (INPUT_RESOLUTION[0], INPUT_RESOLUTION[1]))[0]
                    img_norm      = (img_crop - IMG_NORM_MEAN) / IMG_NORM_STD
                    img_norm      = img_norm.transpose(2, 0, 1).astype(np.float32)
                    kp2ds         = pose_model(img_norm[None], np.array(center)[None], np.array(scale)[None])
                except Exception as e:
                    print(f"DWPoseTEExtractor: ViTPose error on frame {frame_idx}: {e}")

            if kp2ds is not None:
                # Convert to KEYFRAME_DATA frame via WanAnimatePreprocess pipeline
                pose_metas = load_pose_metas_from_kp2ds_seq(kp2ds, width=W, height=H)
                meta = pose_metas[0]   # single frame

                frame_data = _meta_to_keyframe(
                    meta, W, H,
                    detect_hands, detect_face, detect_head,
                    confidence_threshold
                )
                frames[frame_idx] = frame_data
                last_valid_frame  = frame_data
            else:
                # Carry forward last valid detection
                if last_valid_frame is not None:
                    frames[frame_idx] = copy.deepcopy(last_valid_frame)
                    print(f"DWPoseTEExtractor: No person on frame {frame_idx}, carrying forward.")
                else:
                    frames[frame_idx] = _empty_frame(W, H)
                    print(f"DWPoseTEExtractor: No person on frame {frame_idx}, inserting empty frame.")

            progress += 1
            if pbar and progress % 5 == 0:
                pbar.update_absolute(progress)

        pose_model.cleanup()

        log.section("DETECTION DONE", {
            "total_frames": B,
            "frames_with_detection": sum(1 for f in frames.values() if any(p[2] > 0 for p in f.get("body", []))),
            "sample_frame_0_body_pts": len(frames.get(0, {}).get("body", [])),
            "sample_frame_0_rhand": "yes" if frames.get(0, {}).get("rhand") else "no",
            "sample_frame_0_lhand": "yes" if frames.get(0, {}).get("lhand") else "no",
        })
        if frames.get(0, {}).get("body"):
            log.array("frame_0_body", frames[0]["body"])

        # ----------------------------------------------------------------
        # Step 3 — optional resize of keypoints
        # ----------------------------------------------------------------
        out_W = output_width  if output_width  > 0 else W
        out_H = output_height if output_height > 0 else H
        sx_r  = out_W / W
        sy_r  = out_H / H
        if sx_r != 1.0 or sy_r != 1.0:
            for frame_data in frames.values():
                for pt in frame_data.get("body", []):
                    pt[0] *= sx_r; pt[1] *= sy_r
                for side in ("rhand", "lhand"):
                    hand = frame_data.get(side)
                    if hand:
                        for pt in hand:
                            pt[0] *= sx_r; pt[1] *= sy_r
                face = frame_data.get("face")
                if face:
                    for pt in face:
                        pt[0] *= sx_r; pt[1] *= sy_r
                frame_data["width"]  = out_W
                frame_data["height"] = out_H
            W, H = out_W, out_H

        # ----------------------------------------------------------------
        # Step 4 — bake all detected frames into overrides (every frame
        #           becomes a keyframe so the editor timeline shows diamonds)
        # ----------------------------------------------------------------
        overrides: Dict[int, Any] = {}
        for fi, frame_data in frames.items():
            entry: Dict[str, Any] = {}
            for i, pt in enumerate(frame_data.get("body", [])):
                entry[f"body_{i}"] = [pt[0], pt[1], pt[2]]
            for side in ("rhand", "lhand"):
                hand = frame_data.get(side)
                if hand:
                    for i, pt in enumerate(hand):
                        entry[f"{side}_{i}"] = [pt[0], pt[1], pt[2] if len(pt) > 2 else 1.0]
            face = frame_data.get("face")
            if face:
                for i, pt in enumerate(face):
                    entry[f"face_{i}"] = [pt[0], pt[1], pt[2] if len(pt) > 2 else 1.0]
            overrides[fi] = entry

        keyframe_data = {
            "frames":        frames,
            "frame_count":   B,
            "width":         W,
            "height":        H,
            "overrides":     overrides,
            "z_depth":       {},
            "smooth_window": 0,
        }

        # ----------------------------------------------------------------
        # Step 5 — build POSEDATA output
        # ----------------------------------------------------------------
        from .dwpose_temporal_editor import _frame_to_posedata_entry
        pose_metas = []
        for fi in range(B):
            frame = frames.get(fi, {
                "width": W, "height": H,
                "body": [[0.0, 0.0, 0.0]] * 20,
                "rhand": None, "lhand": None, "face": None,
            })
            pose_metas.append(_frame_to_posedata_entry(frame))
        pose_data = {"pose_metas": pose_metas, "width": W, "height": H}

        # ----------------------------------------------------------------
        # Step 6 — build face_images (cropped face region per frame)
        # ----------------------------------------------------------------
        face_imgs: List[np.ndarray] = []
        FACE_OUT = 256  # output face crop size
        for fi in range(B):
            img_np  = images_np[fi]   # (H, W, 3) float32 0-1
            fkps    = frames.get(fi, {}).get("face") if detect_face else None
            crop    = _crop_face_region(img_np, fkps, face_padding, W, H) if fkps else None
            if crop is not None:
                crop = cv2.resize(crop, (FACE_OUT, FACE_OUT))
            else:
                crop = np.zeros((FACE_OUT, FACE_OUT, 3), dtype=np.float32)
            face_imgs.append(crop)
        face_images_tensor = torch.from_numpy(np.stack(face_imgs, axis=0))  # (B, 256, 256, 3)

        # ----------------------------------------------------------------
        # Step 7 — bounding boxes (person and face)
        # ----------------------------------------------------------------
        # BBOX format expected by SAM2Segmentation:
        # list of bbox_lists — one bbox_list per image/frame, each bbox_list is
        # a list of [x1, y1, x2, y2] boxes for that frame.
        bboxes_list = []
        for dets in raw_detections:
            bbox = _pick_bbox(dets, person_index)
            if bbox is not None:
                b = bbox.tolist() if hasattr(bbox, "tolist") else list(bbox)
                bboxes_list.append([[float(b[0]), float(b[1]), float(b[2]), float(b[3])]])
            else:
                bboxes_list.append([])   # no detection this frame

        facebboxes_list = []
        for fi in range(B):
            fkps = frames.get(fi, {}).get("face")
            if fkps:
                valid = [p for p in fkps if p[2] > 0.1]
                if valid:
                    xs = [p[0] for p in valid]
                    ys = [p[1] for p in valid]
                    facebboxes_list.append([[float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]])
                else:
                    facebboxes_list.append([])
            else:
                facebboxes_list.append([])

        # ----------------------------------------------------------------
        # Step 8 — NLF 3D depth baking (optional, requires NLF Model Loader)
        # Runs NLF inference on the source images, maps SMPL 24-joint 3D
        # positions to the 18 OpenPose body joints, and bakes real metric
        # Z-depth into keyframe_data["z_depth"].  The raw SMPL frames are
        # stored in keyframe_data["nlf_frames"] for the editor overlay.
        # ----------------------------------------------------------------
        if nlf_pipeline is not None:
            try:
                from .nlf_integration import run_nlf_inference, NLFStub
                if isinstance(nlf_pipeline, NLFStub):
                    print(f"[NLF] Extractor: NLF model stub ({nlf_pipeline.error}) — skipping 3D bake.")
                else:
                    print("[NLF] Extractor: running NLF inference to bake Z-depth…")
                    nlf_results = run_nlf_inference(nlf_pipeline, images)
                    if nlf_results:
                        # Store SMPL frames for the editor's 3D overlay and NLF editing mode.
                        # The editor auto-bakes nlf_body_N overrides on open.
                        # Use "Bake Z Depth" in the editor sidebar to write NLF Z into DWPose body joints.
                        keyframe_data["nlf_frames"] = nlf_results
                        n_detected = sum(1 for f in nlf_results if f.get("body"))
                        print(f"[NLF] Extractor: SMPL data stored "
                              f"({n_detected}/{B} frames detected). "
                              f"Editor auto-bakes as nlf_body_N overrides on open.")
                    else:
                        print("[NLF] Extractor: inference returned no results.")
            except Exception as e:
                import traceback
                print(f"[NLF] Extractor: inference error — {e}")
                traceback.print_exc()

        print(f"DWPoseTEExtractor: Done — {B} frames ({W}×{H}).")
        log.section("EXTRACT DONE", {
            "keyframe_data.frame_count": keyframe_data["frame_count"],
            "keyframe_data.width": keyframe_data["width"],
            "keyframe_data.height": keyframe_data["height"],
            "overrides_frames": len(keyframe_data["overrides"]),
            "nlf_frames": "yes" if "nlf_frames" in keyframe_data else "no",
            "pose_data.frames": len(pose_data["pose_metas"]),
            "face_images_shape": tuple(face_images_tensor.shape),
            "bboxes_len": len(bboxes_list),
            "facebboxes_len": len(facebboxes_list),
        })
        return (
            keyframe_data,
            pose_data,
            face_images_tensor,
            bboxes_list,
            facebboxes_list,
            nlf_pipeline,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _crop_face_region(
    img_np: np.ndarray,
    face_kps: list,
    padding: int,
    W: int,
    H: int,
) -> Optional[np.ndarray]:
    """
    Crop the face bounding box (+ padding) from img_np (H,W,3 float32 0-1).
    face_kps is a list of [x_px, y_px, conf] pixel-coord points.
    Returns (h',w',3) float32 or None if too small.
    """
    valid = [p for p in face_kps if len(p) >= 3 and p[2] > 0.1]
    if len(valid) < 3:
        return None
    xs = [p[0] for p in valid]
    ys = [p[1] for p in valid]
    x0 = max(0,   int(min(xs)) - padding)
    y0 = max(0,   int(min(ys)) - padding)
    x1 = min(W,   int(max(xs)) + padding)
    y1 = min(H,   int(max(ys)) + padding)
    if x1 - x0 < 16 or y1 - y0 < 16:
        return None
    return img_np[y0:y1, x0:x1].copy()


def _pick_bbox(frame_dets, person_index: int):
    """
    Pick the detection at person_index from the YOLO output for one frame.
    The YOLO model returns a list of per-class dicts; each has a "bbox" key.
    Tries person_index first, falls back to index 0, then None.
    """
    if not frame_dets:
        return None
    # frame_dets is a list of result dicts (one per detection class).
    # Each element has a "bbox" key.
    try:
        det = frame_dets[person_index]
        bbox = det["bbox"] if isinstance(det, dict) else None
    except (IndexError, TypeError):
        det  = frame_dets[0]
        bbox = det["bbox"] if isinstance(det, dict) else None

    return bbox


def _meta_to_keyframe(
    meta: Dict[str, Any],
    W: int,
    H: int,
    detect_hands: bool,
    detect_face: bool,
    detect_head: bool,
    conf_thresh: float,
) -> Dict[str, Any]:
    """
    Convert one WanAnimatePreprocess meta dict (normalized 0-1 coords)
    into a KEYFRAME_DATA frame dict (pixel coords).

    meta keys: keypoints_body (20,3), keypoints_left_hand (21,3),
               keypoints_right_hand (21,3), keypoints_face (?,3)
    All normalized to [0,1] by load_pose_metas_from_kp2ds_seq.
    """
    wh = np.array([W, H], dtype=np.float32)

    # --- Body (20 pts) ---
    raw_body = np.array(meta["keypoints_body"], dtype=np.float32)   # (20, 3)
    body = []
    for i, pt in enumerate(raw_body):
        x = float(pt[0] * W)
        y = float(pt[1] * H)
        c = float(pt[2])
        # Zero head confidence when detect_head=False
        if not detect_head and i in HEAD_INDICES:
            c = 0.0
        body.append([x, y, c])

    # --- Hands (21 pts each) ---
    if detect_hands:
        raw_rhand = np.array(meta["keypoints_right_hand"], dtype=np.float32)
        raw_lhand = np.array(meta["keypoints_left_hand"],  dtype=np.float32)
        rhand_conf_mean = float(raw_rhand[:, 2].mean())
        lhand_conf_mean = float(raw_lhand[:, 2].mean())

        rhand = [[float(p[0]*W), float(p[1]*H), float(p[2])] for p in raw_rhand] \
            if rhand_conf_mean >= conf_thresh else None
        lhand = [[float(p[0]*W), float(p[1]*H), float(p[2])] for p in raw_lhand] \
            if lhand_conf_mean >= conf_thresh else None
    else:
        rhand = None
        lhand = None

    # --- Face (variable pts — whatever the model returns) ---
    if detect_face:
        raw_face = np.array(meta["keypoints_face"], dtype=np.float32)
        # split_kp2ds_for_aa slices kp2ds[22:91] which includes the right_heel foot
        # keypoint at index 22 before the 68 actual 300W face landmarks (23-90).
        # Drop that spurious first point so FACE_CONNECTIONS (0-67) map correctly.
        if len(raw_face) == 69:
            raw_face = raw_face[1:]
        face = [[float(p[0]*W), float(p[1]*H), float(p[2])] for p in raw_face]
        # Pad to 70 if shorter (normally 68 after the fix above)
        while len(face) < 70:
            face.append([0.0, 0.0, 0.0])
        face = face[:70]
    else:
        face = None

    return {
        "width":  W,
        "height": H,
        "body":   body,
        "rhand":  rhand,
        "lhand":  lhand,
        "face":   face,
    }


def _empty_frame(W: int, H: int) -> Dict[str, Any]:
    return {
        "width":  W,
        "height": H,
        "body":   [[0.0, 0.0, 0.0]] * 20,
        "rhand":  None,
        "lhand":  None,
        "face":   None,
    }
