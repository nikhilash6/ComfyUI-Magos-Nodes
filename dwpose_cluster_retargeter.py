"""
Magos Pose Retargeter
Cluster-based pose retargeting for WanAnimate skeletons.
Lets you move, scale, and rotate body clusters on an interactive canvas
before sending pose data to the WanAnimate sampler.

Author: Eli Rezik / Magos Digital Studio
"""

import copy
import json
import base64
import numpy as np
import torch
import cv2
from typing import Dict, Optional, Tuple, Any

# Web directory for JavaScript extension
WEB_DIRECTORY = "./js"

# ---------------------------------------------------------------------------
# DWPose skeleton constants — match dwpose_temporal_editor.js exactly
# ---------------------------------------------------------------------------
# Body joint names (20 joints, OpenPose order)
_BODY_JOINT_NAMES = [
    "NOSE", "NECK", "R_SHLDR", "R_ELBOW", "R_WRIST",
    "L_SHLDR", "L_ELBOW", "L_WRIST", "R_HIP", "R_KNEE",
    "R_ANKLE", "L_HIP", "L_KNEE", "L_ANKLE", "R_EYE",
    "L_EYE", "R_EAR", "L_EAR", "L_TOE", "R_TOE",
]

# Body joint colors — BGR, matching JOINT_COLORS in dwpose_temporal_editor.js
_BODY_JOINT_COLORS_BGR = [
    (  0, 255, 255),  # 0  NOSE      #ffff00 yellow
    (255, 255,   0),  # 1  NECK      #00ffff cyan
    (255,   0,   0),  # 2  R_SHLDR   #0000ff blue
    (255,   0,   0),  # 3  R_ELBOW   #0000ff blue
    (255,   0,   0),  # 4  R_WRIST   #0000ff blue
    (  0, 255,   0),  # 5  L_SHLDR   #00ff00 green
    (  0, 255,   0),  # 6  L_ELBOW   #00ff00 green
    (  0, 255,   0),  # 7  L_WRIST   #00ff00 green
    (255, 255,   0),  # 8  R_HIP     #00ffff cyan
    (255, 255,   0),  # 9  R_KNEE    #00ffff cyan
    (255, 255,   0),  # 10 R_ANKLE   #00ffff cyan
    (255,   0, 255),  # 11 L_HIP     #ff00ff magenta
    (255,   0, 255),  # 12 L_KNEE    #ff00ff magenta
    (255,   0, 255),  # 13 L_ANKLE   #ff00ff magenta
    (200, 200, 200),  # 14 R_EYE     #c8c8c8 light gray
    (200, 200, 200),  # 15 L_EYE     #c8c8c8 light gray
    (150, 150, 150),  # 16 R_EAR     #969696 gray
    (150, 150, 150),  # 17 L_EAR     #969696 gray
    (255,   0, 180),  # 18 L_TOE     #b400ff violet
    (255, 180,   0),  # 19 R_TOE     #00b4ff azure
]

# Body bone connections — matching BONE_COLORS/BODY_CONNECTIONS in dwpose_temporal_editor.js
_BODY_BONE_CONNECTIONS = [
    (1,  2,  (255,   0,   0)),  # NECK→R_SHLDR    blue
    (1,  5,  (  0, 255,   0)),  # NECK→L_SHLDR    green
    (2,  3,  (255,   0,   0)),  # R_SHLDR→R_ELBOW blue
    (3,  4,  (255,   0,   0)),  # R_ELBOW→R_WRIST blue
    (5,  6,  (  0, 255,   0)),  # L_SHLDR→L_ELBOW green
    (6,  7,  (  0, 255,   0)),  # L_ELBOW→L_WRIST green
    (1,  8,  (255, 255,   0)),  # NECK→R_HIP      cyan
    (1, 11,  (255,   0, 255)),  # NECK→L_HIP      magenta
    (8,  9,  (255, 255,   0)),  # R_HIP→R_KNEE    cyan
    (9,  10, (255, 255,   0)),  # R_KNEE→R_ANKLE  cyan
    (10, 19, (255, 180,   0)),  # R_ANKLE→R_TOE   azure
    (11, 12, (255,   0, 255)),  # L_HIP→L_KNEE    magenta
    (12, 13, (255,   0, 255)),  # L_KNEE→L_ANKLE  magenta
    (13, 18, (255,   0, 180)),  # L_ANKLE→L_TOE   violet
    (1,  0,  (  0, 255, 255)),  # NECK→NOSE       yellow
    (0,  14, (200, 200, 200)),  # NOSE→R_EYE      gray
    (0,  15, (200, 200, 200)),  # NOSE→L_EYE      gray
    (14, 16, (150, 150, 150)),  # R_EYE→R_EAR     dark gray
    (15, 17, (150, 150, 150)),  # L_EYE→L_EAR     dark gray
]

_RHAND_COLOR_BGR = (  0, 100, 255)  # #ff6400 orange
_LHAND_COLOR_BGR = (  0, 200, 100)  # #64c800 lime

# Hand joint names (21 keypoints: 0=wrist, 1-4=thumb, 5-8=index, 9-12=mid, 13-16=ring, 17-20=pinky)
_HAND_JOINT_NAMES = [
    "Wrist",
    "Thumb 1", "Thumb 2", "Thumb 3", "Thumb 4",
    "Index 1", "Index 2", "Index 3", "Index 4",
    "Mid 1",   "Mid 2",   "Mid 3",   "Mid 4",
    "Ring 1",  "Ring 2",  "Ring 3",  "Ring 4",
    "Pinky 1", "Pinky 2", "Pinky 3", "Pinky 4",
]

# Hand connections (same as JS HAND_CONNECTIONS)
_HAND_CONNECTIONS = [
    (0,  1), (1,  2), (2,  3), (3,  4),
    (0,  5), (5,  6), (6,  7), (7,  8),
    (0,  9), (9,  10),(10, 11),(11, 12),
    (0, 13),(13, 14),(14, 15),(15, 16),
    (0, 17),(17, 18),(18, 19),(19, 20),
]


class DWPoseClusterRetargeter:
    
    # Body Keypoint Indices
    NOSE = 0
    NECK = 1
    R_SHOULDER = 2
    R_ELBOW = 3
    R_WRIST = 4
    L_SHOULDER = 5
    L_ELBOW = 6
    L_WRIST = 7
    R_HIP = 8
    R_KNEE = 9
    R_ANKLE = 10
    L_HIP = 11
    L_KNEE = 12
    L_ANKLE = 13
    R_EYE = 14
    L_EYE = 15
    R_EAR = 16
    L_EAR = 17
    L_TOE = 18
    R_TOE = 19
    
    # Confidence threshold for valid keypoints
    CONFIDENCE_THRESHOLD = 0.1

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "pose_data": ("POSEDATA",),
                "transfer_face": ("BOOLEAN", {"default": True, "label_on": "Face: On", "label_off": "Face: Off"}),
                # Float inputs (Min: 0.1, Max: 10.0, Default: 1.0, Step: 0.05)
                "global_scale": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "torso_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "torso_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "head_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "head_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "right_arm_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "right_arm_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "left_arm_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "left_arm_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "right_leg_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "right_leg_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "left_leg_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "left_leg_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                # Int inputs (Min: -1024, Max: 1024, Default: 0, Step: 1)
                "global_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "global_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "torso_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "torso_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "head_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "head_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "right_arm_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "right_arm_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "left_arm_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "left_arm_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "right_leg_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "right_leg_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "left_leg_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "left_leg_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                # Face Cluster (whole face position/scale — applied to face_images pixel crops)
                "face_scale_x": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "face_scale_y": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.05}),
                "face_offset_x": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                "face_offset_y": ("INT", {"default": 0, "min": -3000, "max": 3000, "step": 1}),
                # Cluster Rotation (applied after move+scale for each cluster)
                "torso_rotation":     ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "head_rotation":      ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "right_arm_rotation": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "left_arm_rotation":  ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "right_leg_rotation": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "left_leg_rotation":  ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                # Hand Scale + Rotation
                "right_hand_scale_x":  ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "right_hand_scale_y":  ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "right_hand_rotation": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                "left_hand_scale_x":   ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "left_hand_scale_y":   ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.05}),
                "left_hand_rotation":  ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1}),
                # Canvas reference frame — which frame index to display in the retargeter canvas
                "reference_frame_index": ("INT", {"default": 0, "min": 0, "max": 9999, "step": 1}),
                "reference_source": (["Frame Index", "Ref Frame"], {"default": "Frame Index",
                    "tooltip": "Ref Frame: uses the clean front-view snapshot from the Editor's ⊕ Ref Frame button."}),
                "debug_log": ("BOOLEAN", {"default": False, "label_on": "Debug: On", "label_off": "Debug: Off", "tooltip": "Write full trace to CMD + logs/session_*.log"}),
            },
            "optional": {
                "reference_image": ("IMAGE",),
                # Source video frames — feed the original video batch here so the canvas
                # can toggle between the creature (reference_image) and the actor video frame
                # at reference_frame_index for visual calibration.
                "source_images":  ("IMAGE",),
                "face_images": ("IMAGE",),
                # Serialized gizmo edits — must be in optional so ComfyUI creates a real JS widget.
                # Hidden visually in JS via computeSize = () => [0, -4].
                "micro_offsets_json":    ("STRING", {"default": "{}"}),
                "disabled_points_json": ("STRING", {"default": "{}"}),
                "default_hands_json":   ("STRING", {"default": "{}"}),
                "keyframe_data": ("KEYFRAME_DATA",),
                # Optional: when wired, the retargeter projects each transformed frame
                # through the editor's per-frame camera matrix AFTER applying 2D cluster
                # transforms in front-space. This avoids the "transform a perspective
                # photo" failure when the editor's render mode is set to a camera view.
                # Requires keyframe_data to be wired too (Z is read from it per joint).
                "camera_matrices": ("CAMERA_MATRICES",),
                # Retargeter-side projection mode (only used when camera_matrices is connected).
                "camera_projection": (["Perspective", "Orthographic"], {"default": "Perspective"}),
            },
        }
    
    CATEGORY = "MAGOS Nodes/Retargeting"
    RETURN_TYPES = ("POSEDATA", "IMAGE", "IMAGE", "POSEDATA")
    RETURN_NAMES = ("modified_pose_data", "preview", "face_images", "ref_frame_pose")
    FUNCTION = "retarget_pose"
    OUTPUT_NODE = True
    
    def _get_valid_point(self, kps: np.ndarray, idx: int, confidence: np.ndarray = None) -> Optional[np.ndarray]:
        """Check if a keypoint is valid based on confidence threshold."""
        if confidence is not None and confidence[idx] < self.CONFIDENCE_THRESHOLD:
            return None
        point = kps[idx]
        if np.any(np.isnan(point)) or np.any(point == 0):
            return None
        return point
    
    def _transform_point(
        self,
        orig_point: np.ndarray,
        orig_anchor: np.ndarray,
        new_anchor: np.ndarray,
        scale: Tuple[float, float],
        offset: Tuple[float, float] = (0, 0)
    ) -> np.ndarray:
        """
        Apply the universal transform formula:
        new_point = new_anchor + ((orig_point - orig_anchor) * scale_vector) + offset_vector
        """
        scale_vector = np.array(scale, dtype=np.float32)
        offset_vector = np.array(offset, dtype=np.float32)
        
        # Calculate relative position from original anchor
        relative_pos = orig_point - orig_anchor
        
        # Apply scale
        scaled_pos = relative_pos * scale_vector
        
        # Attach to new anchor and add offset
        new_point = new_anchor + scaled_pos + offset_vector
        
        return new_point
    
    def _calculate_hip_center(self, kps: np.ndarray) -> np.ndarray:
        """Calculate the midpoint between left and right hip."""
        return (kps[self.R_HIP] + kps[self.L_HIP]) / 2.0

    def _rotate_hand(self, hand_kps: np.ndarray, wrist: np.ndarray, angle_deg: float) -> np.ndarray:
        """Rotate hand keypoints around the wrist point by angle_deg degrees."""
        if angle_deg == 0:
            return hand_kps
        angle_rad = np.radians(angle_deg)
        c, s = np.cos(angle_rad), np.sin(angle_rad)
        rot = np.array([[c, -s], [s, c]], dtype=np.float32)
        return wrist + (hand_kps - wrist) @ rot.T

    def _scale_hand(self, hand_kps: np.ndarray, wrist: np.ndarray, scale_x: float, scale_y: float) -> np.ndarray:
        """Scale hand keypoints around the wrist point."""
        if scale_x == 1.0 and scale_y == 1.0:
            return hand_kps
        rel = hand_kps - wrist
        rel[:, 0] *= scale_x
        rel[:, 1] *= scale_y
        return wrist + rel

    def _rotate_cluster(self, kps: np.ndarray, indices: list, anchor: np.ndarray, angle_deg: float) -> None:
        """Rotate cluster keypoints in-place around anchor by angle_deg degrees."""
        if angle_deg == 0.0:
            return
        angle_rad = np.radians(angle_deg)
        c, s = np.cos(angle_rad), np.sin(angle_rad)
        rot = np.array([[c, -s], [s, c]], dtype=np.float32)
        for idx in indices:
            kps[idx] = anchor + (kps[idx] - anchor) @ rot.T

    def _apply_micro_offsets(
        self,
        new_kps: np.ndarray,
        micro_offsets: Dict[str, Any],
        new_rhand: Optional[np.ndarray] = None,
        new_lhand: Optional[np.ndarray] = None
    ) -> Tuple[np.ndarray, Optional[np.ndarray], Optional[np.ndarray]]:
        """
        Apply micro-offsets as a final additive layer AFTER cluster math.
        Structure: {"body": {"4": {"x": 5, "y": -2}}, "lhand": {...}, "rhand": {...}}
        """
        # Body micro-offsets are applied by the caller BEFORE hand transforms so the
        # hand anchor follows the final wrist position; do not re-apply them here.

        # Apply hand micro-offsets
        if new_rhand is not None and "rhand" in micro_offsets:
            for idx_str, offset in micro_offsets["rhand"].items():
                idx = int(idx_str)
                if 0 <= idx < len(new_rhand):
                    dx = offset.get("x", 0)
                    dy = offset.get("y", 0)
                    new_rhand[idx] = new_rhand[idx] + np.array([dx, dy])
        
        if new_lhand is not None and "lhand" in micro_offsets:
            for idx_str, offset in micro_offsets["lhand"].items():
                idx = int(idx_str)
                if 0 <= idx < len(new_lhand):
                    dx = offset.get("x", 0)
                    dy = offset.get("y", 0)
                    new_lhand[idx] = new_lhand[idx] + np.array([dx, dy])
        
        return new_kps, new_rhand, new_lhand
    
    def _transform_frame(
        self,
        frame: Any,
        params: Dict[str, float],
        micro_offsets: Dict[str, Any] = None,
        disabled_points: Dict[str, list] = None,
        default_hands: Dict[str, Any] = None,
    ) -> Tuple[Any, Dict[str, Any]]:
        """
        Apply hierarchical cluster transforms to a single frame.
        Returns the transformed frame and metadata for preview generation.
        Supports both dict and object (AAPoseMeta) frame types.
        """
        if micro_offsets is None:
            micro_offsets = {}
        if disabled_points is None:
            disabled_points = {}
        if default_hands is None:
            default_hands = {}
        
        # 1. Safely extract original keypoints and confidence
        if isinstance(frame, dict):
            orig_kps = frame.get("kps_body", np.zeros((20, 2), dtype=np.float32))
            confidence = frame.get("kps_body_p", np.ones(20, dtype=np.float32))
            orig_rhand = frame.get("kps_rhand", None)
            orig_lhand = frame.get("kps_lhand", None)
        else:
            orig_kps = getattr(frame, "kps_body", np.zeros((20, 2), dtype=np.float32))
            confidence = getattr(frame, "kps_body_p", np.ones(20, dtype=np.float32))
            orig_rhand = getattr(frame, "kps_rhand", None)
            orig_lhand = getattr(frame, "kps_lhand", None)
        
        # Override hand data when the user applied a default hand pose from the JS canvas
        if "rhand" in default_hands and default_hands["rhand"]:
            orig_rhand = np.array(default_hands["rhand"], dtype=np.float32)
        if "lhand" in default_hands and default_hands["lhand"]:
            orig_lhand = np.array(default_hands["lhand"], dtype=np.float32)

        # Ensure they are numpy arrays and copy them
        orig_kps = np.array(orig_kps).copy()
        confidence = np.array(confidence).copy()
        new_kps = orig_kps.copy()
        
        # Extract parameters - Global
        global_scale = params["global_scale"]
        global_offset_x = params["global_offset_x"]
        global_offset_y = params["global_offset_y"]
        
        # Torso parameters
        torso_scale_x = params["torso_scale_x"]
        torso_scale_y = params["torso_scale_y"]
        torso_offset_x = params["torso_offset_x"]
        torso_offset_y = params["torso_offset_y"]
        
        # Head parameters
        head_scale_x = params["head_scale_x"]
        head_scale_y = params["head_scale_y"]
        head_offset_x = params["head_offset_x"]
        head_offset_y = params["head_offset_y"]
        
        # Right Arm parameters (independent)
        right_arm_scale_x = params["right_arm_scale_x"]
        right_arm_scale_y = params["right_arm_scale_y"]
        right_arm_offset_x = params["right_arm_offset_x"]
        right_arm_offset_y = params["right_arm_offset_y"]
        
        # Left Arm parameters (independent)
        left_arm_scale_x = params["left_arm_scale_x"]
        left_arm_scale_y = params["left_arm_scale_y"]
        left_arm_offset_x = params["left_arm_offset_x"]
        left_arm_offset_y = params["left_arm_offset_y"]
        
        # Right Leg parameters (independent)
        right_leg_scale_x = params["right_leg_scale_x"]
        right_leg_scale_y = params["right_leg_scale_y"]
        right_leg_offset_x = params["right_leg_offset_x"]
        right_leg_offset_y = params["right_leg_offset_y"]
        
        # Left Leg parameters (independent)
        left_leg_scale_x = params["left_leg_scale_x"]
        left_leg_scale_y = params["left_leg_scale_y"]
        left_leg_offset_x = params["left_leg_offset_x"]
        left_leg_offset_y = params["left_leg_offset_y"]
        
        # Face cluster (whole-face position/scale — applied to face_images pixel crops)
        face_scale_x = params["face_scale_x"]
        face_scale_y = params["face_scale_y"]
        face_offset_x = params["face_offset_x"]
        face_offset_y = params["face_offset_y"]

        # Hand scale + rotation parameters
        right_hand_scale_x  = params["right_hand_scale_x"]
        right_hand_scale_y  = params["right_hand_scale_y"]
        right_hand_rotation = params["right_hand_rotation"]
        left_hand_scale_x   = params["left_hand_scale_x"]
        left_hand_scale_y   = params["left_hand_scale_y"]
        left_hand_rotation  = params["left_hand_rotation"]
        
        # =========================================
        # 1. CREATE BASE KPS (Global Transform Only)
        # =========================================
        # base_kps is the original skeleton with ONLY global_scale and global_offset applied
        # Every local cluster uses base_kps as both origin AND destination anchor
        orig_hip_center = self._calculate_hip_center(orig_kps)
        base_kps = orig_kps.copy()
        for i in range(len(base_kps)):
            base_kps[i] = orig_hip_center + (orig_kps[i] - orig_hip_center) * global_scale + np.array([global_offset_x, global_offset_y])
        
        base_hip_center = self._calculate_hip_center(base_kps)

        # =========================================
        # 2. TORSO CLUSTER
        # =========================================
        # Anchor: Hip Center (uses base_kps for both orig and new anchor)
        for idx in [self.NECK, self.R_SHOULDER, self.L_SHOULDER, self.R_HIP, self.L_HIP]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_hip_center, base_hip_center, (torso_scale_x, torso_scale_y), (torso_offset_x, torso_offset_y))
        
        # =========================================
        # 3. HEAD CLUSTER
        # =========================================
        # Anchor: Neck (uses base_kps for both orig and new anchor)
        base_neck = base_kps[self.NECK]
        for idx in [self.NOSE, self.R_EYE, self.L_EYE, self.R_EAR, self.L_EAR]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_neck, base_neck, (head_scale_x, head_scale_y), (head_offset_x, head_offset_y))

        # =========================================
        # 4. ARM CLUSTERS (Independent)
        # =========================================
        # Right Arm: Anchor is R_Shoulder (uses base_kps)
        base_r_shoulder, base_l_shoulder = base_kps[self.R_SHOULDER], base_kps[self.L_SHOULDER]
        for idx in [self.R_ELBOW, self.R_WRIST]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_r_shoulder, base_r_shoulder, (right_arm_scale_x, right_arm_scale_y), (right_arm_offset_x, right_arm_offset_y))
        # Left Arm: Anchor is L_Shoulder (uses base_kps)
        for idx in [self.L_ELBOW, self.L_WRIST]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_l_shoulder, base_l_shoulder, (left_arm_scale_x, left_arm_scale_y), (left_arm_offset_x, left_arm_offset_y))

        # =========================================
        # 5. LEG CLUSTERS (Independent)
        # =========================================
        # Right Leg: Anchor is R_Hip (uses base_kps)
        base_r_hip, base_l_hip = base_kps[self.R_HIP], base_kps[self.L_HIP]
        for idx in [self.R_KNEE, self.R_ANKLE, self.R_TOE]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_r_hip, base_r_hip, (right_leg_scale_x, right_leg_scale_y), (right_leg_offset_x, right_leg_offset_y))
        # Left Leg: Anchor is L_Hip (uses base_kps)
        for idx in [self.L_KNEE, self.L_ANKLE, self.L_TOE]:
            if self._get_valid_point(orig_kps, idx, confidence) is not None:
                new_kps[idx] = self._transform_point(base_kps[idx], base_l_hip, base_l_hip, (left_leg_scale_x, left_leg_scale_y), (left_leg_offset_x, left_leg_offset_y))

        # =========================================
        # 6. CLUSTER ROTATIONS (applied after all move+scale)
        # =========================================
        torso_rotation     = params.get("torso_rotation", 0.0)
        head_rotation      = params.get("head_rotation", 0.0)
        right_arm_rotation = params.get("right_arm_rotation", 0.0)
        left_arm_rotation  = params.get("left_arm_rotation", 0.0)
        right_leg_rotation = params.get("right_leg_rotation", 0.0)
        left_leg_rotation  = params.get("left_leg_rotation", 0.0)

        if torso_rotation != 0.0:
            torso_anchor = (new_kps[self.R_HIP] + new_kps[self.L_HIP]) / 2.0
            self._rotate_cluster(new_kps, [self.NECK, self.R_SHOULDER, self.L_SHOULDER, self.R_HIP, self.L_HIP], torso_anchor, torso_rotation)
        if head_rotation != 0.0:
            self._rotate_cluster(new_kps, [self.NOSE, self.R_EYE, self.L_EYE, self.R_EAR, self.L_EAR], new_kps[self.NECK], head_rotation)
        if right_arm_rotation != 0.0:
            self._rotate_cluster(new_kps, [self.R_ELBOW, self.R_WRIST], new_kps[self.R_SHOULDER], right_arm_rotation)
        if left_arm_rotation != 0.0:
            self._rotate_cluster(new_kps, [self.L_ELBOW, self.L_WRIST], new_kps[self.L_SHOULDER], left_arm_rotation)
        if right_leg_rotation != 0.0:
            self._rotate_cluster(new_kps, [self.R_KNEE, self.R_ANKLE, self.R_TOE], new_kps[self.R_HIP], right_leg_rotation)
        if left_leg_rotation != 0.0:
            self._rotate_cluster(new_kps, [self.L_KNEE, self.L_ANKLE, self.L_TOE], new_kps[self.L_HIP], left_leg_rotation)

        # Body micro-offsets must land BEFORE the hand block: the hand anchors on
        # new_kps[R_WRIST]/[L_WRIST], and a wrist micro-offset would otherwise leave
        # the hand behind at the pre-offset wrist position.
        if micro_offsets and "body" in micro_offsets:
            for idx_str, offset in micro_offsets["body"].items():
                idx = int(idx_str)
                if 0 <= idx < len(new_kps):
                    dx = offset.get("x", 0)
                    dy = offset.get("y", 0)
                    new_kps[idx] = new_kps[idx] + np.array([dx, dy])

        # Initialize hand arrays for micro-offsets
        new_rhand = None
        new_lhand = None

        if isinstance(frame, dict):
            new_frame = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in frame.items()}
            new_frame["kps_body"] = new_kps
            new_frame["kps_body_p"] = confidence.copy()
            if orig_rhand is not None and "kps_rhand" in frame:
                new_r_wrist = new_kps[self.R_WRIST]
                rh = np.array(orig_rhand) + (new_r_wrist - orig_kps[self.R_WRIST])
                rh = self._scale_hand(rh, new_r_wrist, right_hand_scale_x, right_hand_scale_y)
                new_rhand = self._rotate_hand(rh, new_r_wrist, right_hand_rotation)
                new_frame["kps_rhand"] = new_rhand
            if orig_lhand is not None and "kps_lhand" in frame:
                new_l_wrist = new_kps[self.L_WRIST]
                lh = np.array(orig_lhand) + (new_l_wrist - orig_kps[self.L_WRIST])
                lh = self._scale_hand(lh, new_l_wrist, left_hand_scale_x, left_hand_scale_y)
                new_lhand = self._rotate_hand(lh, new_l_wrist, left_hand_rotation)
                new_frame["kps_lhand"] = new_lhand
        else:
            new_frame = copy.copy(frame)
            new_frame.kps_body = new_kps
            new_frame.kps_body_p = confidence.copy()
            # copy.copy() is shallow — explicitly copy remaining confidence arrays so
            # downstream code can't mutate our output through shared numpy references
            for _attr in ("kps_rhand_p", "kps_lhand_p", "kps_face_p"):
                _arr = getattr(frame, _attr, None)
                if _arr is not None:
                    setattr(new_frame, _attr, np.array(_arr).copy())
            if orig_rhand is not None and hasattr(frame, "kps_rhand") and frame.kps_rhand is not None:
                new_r_wrist = new_kps[self.R_WRIST]
                rh = np.array(orig_rhand) + (new_r_wrist - orig_kps[self.R_WRIST])
                rh = self._scale_hand(rh, new_r_wrist, right_hand_scale_x, right_hand_scale_y)
                new_rhand = self._rotate_hand(rh, new_r_wrist, right_hand_rotation)
                new_frame.kps_rhand = new_rhand
            if orig_lhand is not None and hasattr(frame, "kps_lhand") and frame.kps_lhand is not None:
                new_l_wrist = new_kps[self.L_WRIST]
                lh = np.array(orig_lhand) + (new_l_wrist - orig_kps[self.L_WRIST])
                lh = self._scale_hand(lh, new_l_wrist, left_hand_scale_x, left_hand_scale_y)
                new_lhand = self._rotate_hand(lh, new_l_wrist, left_hand_rotation)
                new_frame.kps_lhand = new_lhand
        
        # =========================================
        # 6. TRANSFORM FACE LANDMARKS (HEAD CLUSTER)
        # =========================================
        # Apply same Head Cluster math to face landmarks
        orig_face = frame.get("kps_face", None) if isinstance(frame, dict) else getattr(frame, "kps_face", None)
        new_face = None
        
        if orig_face is not None:
            # Handle both dict and object formats
            if isinstance(orig_face, dict):
                orig_face = orig_face.get("kps", None) or list(orig_face.values())
            elif hasattr(orig_face, 'tolist'):
                orig_face = orig_face.tolist()

            # load_pose_metas_from_kp2ds_seq slices kp2ds[22:91] (69 pts), which
            # prepends the right_heel foot keypoint before the 68 real 300W face
            # landmarks.  Drop it so face indices stay correct.
            if isinstance(orig_face, (list, np.ndarray)) and len(orig_face) == 69:
                orig_face = orig_face[1:]

            if orig_face is not None and len(orig_face) > 0:
                # Anchor face on nose+eyes centroid so it follows head cluster transforms.
                # new_kps already has head cluster + rotation applied at this point.
                face_anchor_idxs = [self.NOSE, self.R_EYE, self.L_EYE]
                valid_orig = [orig_kps[i] for i in face_anchor_idxs
                              if not (np.any(np.isnan(orig_kps[i])) or np.all(orig_kps[i] == 0))]
                valid_new  = [new_kps[i]  for i in face_anchor_idxs
                              if not (np.any(np.isnan(new_kps[i]))  or np.all(new_kps[i]  == 0))]

                orig_face_anchor = np.mean(valid_orig, axis=0) if valid_orig else orig_kps[self.NECK]
                new_face_anchor  = np.mean(valid_new,  axis=0) if valid_new  else new_kps[self.NECK]

                # Whole-face cluster transform anchored on nose+eyes centroid
                new_face = []
                for point in orig_face:
                    if point is None or (point[0] == 0 and point[1] == 0):
                        new_face.append([0.0, 0.0])
                    else:
                        new_face.append([
                            new_face_anchor[0] + (point[0] - orig_face_anchor[0]) * face_scale_x + face_offset_x,
                            new_face_anchor[1] + (point[1] - orig_face_anchor[1]) * face_scale_y + face_offset_y
                        ])

                # Apply micro-offsets to face
                if micro_offsets and 'face' in micro_offsets:
                    for idx_str, offset in micro_offsets['face'].items():
                        idx = int(idx_str)
                        if idx < len(new_face):
                            new_face[idx][0] += offset.get('x', 0)
                            new_face[idx][1] += offset.get('y', 0)

        # =========================================
        # 7. APPLY MICRO-OFFSETS (FINAL ADDITIVE LAYER)
        # =========================================
        # This must happen AFTER all cluster math is complete
        if micro_offsets:
            new_kps, new_rhand, new_lhand = self._apply_micro_offsets(new_kps, micro_offsets, new_rhand, new_lhand)
            # Update the frame with micro-offset adjusted values
            if isinstance(frame, dict):
                new_frame["kps_body"] = new_kps
                if new_rhand is not None:
                    new_frame["kps_rhand"] = new_rhand
                if new_lhand is not None:
                    new_frame["kps_lhand"] = new_lhand
            else:
                new_frame.kps_body = new_kps
                if new_rhand is not None:
                    new_frame.kps_rhand = new_rhand
                if new_lhand is not None:
                    new_frame.kps_lhand = new_lhand
        
        # =========================================
        # 8. APPLY DISABLED POINTS (zero confidence so DrawViTPose skips them)
        # =========================================
        new_confidence = confidence.copy()
        disabled_body = set(disabled_points.get("body", []))
        for idx in disabled_body:
            if 0 <= idx < len(new_confidence):
                new_confidence[idx] = 0.0
        if isinstance(new_frame, dict):
            new_frame["kps_body_p"] = new_confidence
        else:
            new_frame.kps_body_p = new_confidence

        # When a wrist is disabled, suppress the entire corresponding hand so DrawViTPose
        # doesn't render orphaned finger bones
        if self.R_WRIST in disabled_body:
            if isinstance(new_frame, dict):
                new_frame.pop("kps_rhand", None)
                new_frame["kps_rhand_p"] = np.zeros(21, dtype=np.float32)
            else:
                new_frame.kps_rhand = None
                new_frame.kps_rhand_p = np.zeros(21, dtype=np.float32)
        if self.L_WRIST in disabled_body:
            if isinstance(new_frame, dict):
                new_frame.pop("kps_lhand", None)
                new_frame["kps_lhand_p"] = np.zeros(21, dtype=np.float32)
            else:
                new_frame.kps_lhand = None
                new_frame.kps_lhand_p = np.zeros(21, dtype=np.float32)

        # Add transformed face to frame
        if new_face is not None:
            new_face_np = np.array(new_face, dtype=np.float32)
            if isinstance(new_frame, dict):
                new_frame["kps_face"] = new_face_np
            else:
                new_frame.kps_face = new_face_np
        
        # Return metadata for preview (include hands and face)
        preview_meta = {
            "orig_kps": orig_kps,
            "new_kps": new_kps,
            "confidence": confidence,
            "orig_rhand": orig_rhand,
            "orig_lhand": orig_lhand,
            "new_rhand": new_rhand,
            "new_lhand": new_lhand,
            "orig_face": orig_face,
            "new_face": new_face,
        }
        
        return new_frame, preview_meta
    
    def _generate_preview(
        self,
        preview_meta: Dict[str, Any],
        frame_meta: Any,
        reference_image: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """
        Generate a visual preview of the skeleton transformation.
        
        Creates a canvas, optionally overlays a reference image at 65% opacity,
        and draws the stick figure skeleton.
        Supports both dict and object frame_meta types.
        """
        # Safely get canvas dimensions from frame metadata
        if isinstance(frame_meta, dict):
            width = frame_meta.get("width", 512)
            height = frame_meta.get("height", 512)
        else:
            width = getattr(frame_meta, "width", 512)
            height = getattr(frame_meta, "height", 512)
        
        # Create canvas
        canvas = np.ones((height, width, 3), dtype=np.uint8) * 255  # White background
        
        # If reference image provided, overlay it at 65% opacity
        if reference_image is not None:
            # Convert from ComfyUI format [B, H, W, C] to OpenCV format [H, W, C]
            ref_img = reference_image[0].cpu().numpy()
            ref_img = (ref_img * 255).astype(np.uint8)
            ref_img = cv2.cvtColor(ref_img, cv2.COLOR_RGB2BGR)
            
            # Resize to fit canvas
            ref_img = cv2.resize(ref_img, (width, height))
            
            # Blend at 65% opacity
            canvas = cv2.addWeighted(ref_img, 0.65, canvas, 0.35, 0)
        
        orig_kps = preview_meta["orig_kps"]
        new_kps = preview_meta["new_kps"]
        confidence = preview_meta["confidence"]
        
        orig_rhand = preview_meta.get("orig_rhand")
        orig_lhand = preview_meta.get("orig_lhand")
        new_rhand  = preview_meta.get("new_rhand")
        new_lhand  = preview_meta.get("new_lhand")

        font      = cv2.FONT_HERSHEY_SIMPLEX
        font_body = 0.32
        lw_body   = 1

        def _pt_ok(kps, idx, conf=None):
            if idx >= len(kps):
                return False
            p = kps[idx]
            if p is None or np.any(np.isnan(p)):
                return False
            if conf is not None and conf[idx] < self.CONFIDENCE_THRESHOLD:
                return False
            return True

        def draw_body(kps: np.ndarray, alpha: float, label_joints: bool):
            for a, b, color in _BODY_BONE_CONNECTIONS:
                if not _pt_ok(kps, a, confidence) or not _pt_ok(kps, b, confidence):
                    continue
                c = tuple(int(v * alpha) for v in color)
                cv2.line(canvas, (int(kps[a][0]), int(kps[a][1])),
                         (int(kps[b][0]), int(kps[b][1])), c, lw_body, cv2.LINE_AA)
            for idx in range(len(kps)):
                if not _pt_ok(kps, idx, confidence):
                    continue
                jc = tuple(int(v * alpha) for v in _BODY_JOINT_COLORS_BGR[idx])
                r  = 4 if label_joints else 3
                cv2.circle(canvas, (int(kps[idx][0]), int(kps[idx][1])), r, jc, -1, cv2.LINE_AA)
                if label_joints:
                    name = _BODY_JOINT_NAMES[idx] if idx < len(_BODY_JOINT_NAMES) else str(idx)
                    tx, ty = int(kps[idx][0]) + 5, int(kps[idx][1]) - 4
                    cv2.putText(canvas, name, (tx, ty), font, font_body,
                                (0, 0, 0), 2, cv2.LINE_AA)
                    cv2.putText(canvas, name, (tx, ty), font, font_body,
                                jc, 1, cv2.LINE_AA)

        def draw_hand(kps, hand_bgr: tuple, alpha: float):
            if kps is None or len(kps) == 0:
                return
            kps = np.array(kps)
            c = tuple(int(v * alpha) for v in hand_bgr)
            for a, b in _HAND_CONNECTIONS:
                if a >= len(kps) or b >= len(kps):
                    continue
                pa, pb = kps[a], kps[b]
                if np.any(pa == 0) or np.any(pb == 0):
                    continue
                cv2.line(canvas, (int(pa[0]), int(pa[1])),
                         (int(pb[0]), int(pb[1])), c, 1, cv2.LINE_AA)
            for idx in range(len(kps)):
                p = kps[idx]
                if np.any(p == 0) or np.any(np.isnan(p)):
                    continue
                cv2.circle(canvas, (int(p[0]), int(p[1])), 3, c, -1, cv2.LINE_AA)

        # Draw original (faded, no labels)
        draw_body(orig_kps, alpha=0.35, label_joints=False)
        draw_hand(orig_rhand, _RHAND_COLOR_BGR, alpha=0.35)
        draw_hand(orig_lhand, _LHAND_COLOR_BGR, alpha=0.35)

        # Draw transformed (full opacity, with labels)
        draw_body(new_kps, alpha=1.0, label_joints=True)
        draw_hand(new_rhand, _RHAND_COLOR_BGR, alpha=1.0)
        draw_hand(new_lhand, _LHAND_COLOR_BGR, alpha=1.0)
        
        # Convert back to RGB and ComfyUI format [B, H, W, C]
        canvas = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
        canvas = canvas.astype(np.float32) / 255.0
        
        # Add batch dimension
        preview_tensor = torch.from_numpy(canvas).unsqueeze(0)
        
        return preview_tensor
    
    def _transform_face_images(
        self,
        face_images: torch.Tensor,
        face_scale_x: float,
        face_scale_y: float,
        face_offset_x: int,
        face_offset_y: int,
    ) -> torch.Tensor:
        """
        Apply scale + translation to face image crops using bilinear grid_sample.
        face_images: [N, H, W, C] float32 ComfyUI tensor
        face_scale_x/y > 1 zooms in; offset moves content in pixels within the crop.
        """
        if face_scale_x == 1.0 and face_scale_y == 1.0 and face_offset_x == 0 and face_offset_y == 0:
            return face_images

        N, H, W, _ = face_images.shape
        # [N, C, H, W] for grid_sample
        imgs = face_images.permute(0, 3, 1, 2).float()

        # Build inverse affine: maps output coords → input coords in [-1,1] space.
        # output[x] = input[(x - tx_norm) / sx]  →  theta = [[1/sx, 0, -tx_norm/sx], ...]
        tx_norm = face_offset_x / (W / 2.0)
        ty_norm = face_offset_y / (H / 2.0)
        theta = torch.tensor(
            [
                [1.0 / face_scale_x, 0.0, -tx_norm / face_scale_x],
                [0.0, 1.0 / face_scale_y, -ty_norm / face_scale_y],
            ],
            dtype=torch.float32,
            device=face_images.device,
        ).unsqueeze(0).expand(N, -1, -1)

        grid = torch.nn.functional.affine_grid(theta, imgs.shape, align_corners=False)
        out = torch.nn.functional.grid_sample(imgs, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
        return out.permute(0, 2, 3, 1)  # [N, H, W, C]

    def _project_new_frames_inplace(
        self,
        new_frames: list,
        kfd_frames: Dict[Any, Any],
        extr_np: np.ndarray,
        intr_np: np.ndarray,
        dists_np: Optional[np.ndarray],
        z_scale: float,
        use_ortho: bool,
        project_frame_pts,
    ) -> None:
        """Project each transformed frame's joints through E·K, in-place.

        kfd_frames: editor-style {fi: {body, rhand, lhand, face}} with 4-coord points
                    (x, y, conf, z). Used as the Z source — AAPoseMeta has no Z.
        Mutates each frame in `new_frames`: kps_body / kps_rhand / kps_lhand / kps_face
        are replaced with their projected (X, Y); kps_*_p arrays are kept aligned.
        """
        n_frames = min(len(new_frames), int(extr_np.shape[0]))

        def _build_pts(kps2d, kps_p):
            if kps2d is None:
                return None
            # kps2d may be ndarray (kps_body / kps_rhand / kps_lhand always are after
            # _transform_frame), but kps_face can arrive as a plain list of [x, y]
            # pairs when the face transform path didn't normalize it. Use bracket-chain
            # indexing (kps2d[i][0]) which works for both.
            n = len(kps2d)
            return [[float(kps2d[i][0]), float(kps2d[i][1]),
                     float(kps_p[i]) if kps_p is not None and i < len(kps_p) else 1.0]
                    for i in range(n)]

        def _z_lookup_from_kfd_group(kfd_frame: Optional[Dict[str, Any]], group: str, n: int):
            if not kfd_frame:
                return None
            arr = kfd_frame.get(group)
            if not arr:
                return None
            zs: list = []
            for i in range(n):
                if i < len(arr):
                    pt = arr[i]
                    z = float(pt[3]) if isinstance(pt, (list, tuple)) and len(pt) > 3 and pt[3] is not None else 0.0
                else:
                    z = 0.0
                zs.append(z)
            return zs

        def _write_back(frame, attr: str, projected: Optional[list]):
            """Write projected list of [px, py, conf] back into frame as kps_{attr} + kps_{attr}_p."""
            if projected is None:
                return
            xy = np.array([[p[0], p[1]] for p in projected], dtype=np.float32)
            cp = np.array([p[2] for p in projected], dtype=np.float32)
            if isinstance(frame, dict):
                frame[f"kps_{attr}"]   = xy
                frame[f"kps_{attr}_p"] = cp
            else:
                setattr(frame, f"kps_{attr}",   xy)
                setattr(frame, f"kps_{attr}_p", cp)

        for fi in range(n_frames):
            frame = new_frames[fi]
            E = extr_np[fi]
            K = intr_np[fi]
            ortho_dist = float(dists_np[fi]) if (use_ortho and dists_np is not None) else None
            kfd_frame = kfd_frames.get(fi) or kfd_frames.get(str(fi))

            for attr, group in [("body", "body"), ("rhand", "rhand"),
                                ("lhand", "lhand"), ("face", "face")]:
                kps2d = (frame.get(f"kps_{attr}") if isinstance(frame, dict)
                         else getattr(frame, f"kps_{attr}", None))
                if kps2d is None or len(kps2d) == 0:
                    continue
                kps_p = (frame.get(f"kps_{attr}_p") if isinstance(frame, dict)
                         else getattr(frame, f"kps_{attr}_p", None))
                pts_in = _build_pts(kps2d, kps_p)
                z_lookup = _z_lookup_from_kfd_group(kfd_frame, group, len(pts_in))
                projected = project_frame_pts(
                    pts_in, E, K, z_scale,
                    ortho_dist=ortho_dist, z_lookup=z_lookup,
                )
                _write_back(frame, attr, projected)

    def retarget_pose(
        self,
        pose_data: Dict[str, Any],
        transfer_face: bool = True,
        reference_image: Optional[torch.Tensor] = None,
        face_images: Optional[torch.Tensor] = None,
        global_scale: float = 1.0,
        global_offset_x: int = 0,
        global_offset_y: int = 0,
        torso_scale_x: float = 1.0,
        torso_scale_y: float = 1.0,
        torso_offset_x: int = 0,
        torso_offset_y: int = 0,
        head_scale_x: float = 1.0,
        head_scale_y: float = 1.0,
        head_offset_x: int = 0,
        head_offset_y: int = 0,
        right_arm_scale_x: float = 1.0,
        right_arm_scale_y: float = 1.0,
        right_arm_offset_x: int = 0,
        right_arm_offset_y: int = 0,
        left_arm_scale_x: float = 1.0,
        left_arm_scale_y: float = 1.0,
        left_arm_offset_x: int = 0,
        left_arm_offset_y: int = 0,
        right_leg_scale_x: float = 1.0,
        right_leg_scale_y: float = 1.0,
        right_leg_offset_x: int = 0,
        right_leg_offset_y: int = 0,
        left_leg_scale_x: float = 1.0,
        left_leg_scale_y: float = 1.0,
        left_leg_offset_x: int = 0,
        left_leg_offset_y: int = 0,
        face_scale_x: float = 1.0,
        face_scale_y: float = 1.0,
        face_offset_x: int = 0,
        face_offset_y: int = 0,
        right_hand_scale_x: float = 1.0,
        right_hand_scale_y: float = 1.0,
        right_hand_rotation: float = 0.0,
        left_hand_scale_x: float = 1.0,
        left_hand_scale_y: float = 1.0,
        left_hand_rotation: float = 0.0,
        torso_rotation: float = 0.0,
        head_rotation: float = 0.0,
        right_arm_rotation: float = 0.0,
        left_arm_rotation: float = 0.0,
        right_leg_rotation: float = 0.0,
        left_leg_rotation: float = 0.0,
        micro_offsets_json: str = "{}",
        disabled_points_json: str = "{}",
        default_hands_json: str = "{}",
        reference_frame_index: int = 0,
        reference_source: str = "Frame Index",
        source_images: Optional[torch.Tensor] = None,
        keyframe_data: Optional[Dict[str, Any]] = None,
        camera_matrices: Optional[Dict[str, Any]] = None,
        camera_projection: str = "Perspective",
        debug_log: bool = False,
    ) -> Tuple[Dict[str, Any], torch.Tensor]:
        """
        Main entry point for the node.

        Args:
            pose_data: The input pose data dictionary with WanAnimate format
            reference_image: Optional reference image for preview overlay
            **scale/offset parameters: Transformation controls (independent per cluster)
            micro_offsets_json: JSON-serialized gizmo point edits from JS canvas
            
        Returns:
            Tuple of (modified_pose_data, preview_image)
        """
        from .debug_logger import get_logger
        rlog = get_logger("Retargeter", debug_log)
        rlog.section("RETARGET START", {
            "pose_data_type": type(pose_data).__name__,
            "transfer_face": transfer_face,
            "reference_frame_index": reference_frame_index,
            "reference_image": reference_image,
            "face_images": face_images,
            "source_images": source_images,
            "micro_offsets_json_len": len(micro_offsets_json or ""),
            "disabled_points_json_len": len(disabled_points_json or ""),
            "default_hands_json_len": len(default_hands_json or ""),
        })

        # Parse micro_offsets_json from canvas widget
        try:
            micro_offsets = json.loads(micro_offsets_json) if micro_offsets_json else {}
        except (json.JSONDecodeError, TypeError):
            micro_offsets = {}

        # Parse disabled_points_json from canvas widget
        try:
            disabled_points = json.loads(disabled_points_json) if disabled_points_json else {}
        except (json.JSONDecodeError, TypeError):
            disabled_points = {}

        # Parse default_hands_json — JS writes absolute kps when user clicks "Default" for a hand
        try:
            default_hands = json.loads(default_hands_json) if default_hands_json else {}
        except (json.JSONDecodeError, TypeError):
            default_hands = {}
        
        # Extract frames safely (handles raw lists, dicts, and single objects)
        if isinstance(pose_data, list):
            input_frames = pose_data
        elif isinstance(pose_data, dict):
            input_frames = pose_data.get("pose_metas", [pose_data])
        else:
            input_frames = [pose_data]
            
        # Collect transform parameters - all independent
        params = {
            "global_scale": global_scale,
            "global_offset_x": global_offset_x,
            "global_offset_y": global_offset_y,
            "torso_scale_x": torso_scale_x,
            "torso_scale_y": torso_scale_y,
            "torso_offset_x": torso_offset_x,
            "torso_offset_y": torso_offset_y,
            "head_scale_x": head_scale_x,
            "head_scale_y": head_scale_y,
            "head_offset_x": head_offset_x,
            "head_offset_y": head_offset_y,
            "right_arm_scale_x": right_arm_scale_x,
            "right_arm_scale_y": right_arm_scale_y,
            "right_arm_offset_x": right_arm_offset_x,
            "right_arm_offset_y": right_arm_offset_y,
            "left_arm_scale_x": left_arm_scale_x,
            "left_arm_scale_y": left_arm_scale_y,
            "left_arm_offset_x": left_arm_offset_x,
            "left_arm_offset_y": left_arm_offset_y,
            "right_leg_scale_x": right_leg_scale_x,
            "right_leg_scale_y": right_leg_scale_y,
            "right_leg_offset_x": right_leg_offset_x,
            "right_leg_offset_y": right_leg_offset_y,
            "left_leg_scale_x": left_leg_scale_x,
            "left_leg_scale_y": left_leg_scale_y,
            "left_leg_offset_x": left_leg_offset_x,
            "left_leg_offset_y": left_leg_offset_y,
            "face_scale_x": face_scale_x,
            "face_scale_y": face_scale_y,
            "face_offset_x": face_offset_x,
            "face_offset_y": face_offset_y,
            "right_hand_scale_x": right_hand_scale_x,
            "right_hand_scale_y": right_hand_scale_y,
            "right_hand_rotation": right_hand_rotation,
            "left_hand_scale_x": left_hand_scale_x,
            "left_hand_scale_y": left_hand_scale_y,
            "left_hand_rotation": left_hand_rotation,
            "torso_rotation": torso_rotation,
            "head_rotation": head_rotation,
            "right_arm_rotation": right_arm_rotation,
            "left_arm_rotation": left_arm_rotation,
            "right_leg_rotation": right_leg_rotation,
            "left_leg_rotation": left_leg_rotation,
        }
        
        rlog.section("PARAMS PARSED", {
            "input_frames": len(input_frames),
            "micro_offsets.body": len((micro_offsets or {}).get("body", {})),
            "micro_offsets.rhand": len((micro_offsets or {}).get("rhand", {})),
            "micro_offsets.lhand": len((micro_offsets or {}).get("lhand", {})),
            "micro_offsets.face": len((micro_offsets or {}).get("face", {})),
            "disabled_points.body": len((disabled_points or {}).get("body", [])),
            "default_hands": list((default_hands or {}).keys()),
        })
        rlog.widgets(params)

        if (micro_offsets or {}).get("body"):
            rlog.kv("micro_offsets.body (full)", micro_offsets["body"])

        # Process each frame
        preview_metas = []
        new_frames = []
        for fi, frame in enumerate(input_frames):
            rlog.section(f"FRAME {fi} — before transform", {}) if fi == reference_frame_index else None
            new_frame, preview_meta = self._transform_frame(frame, params, micro_offsets, disabled_points, default_hands)
            if fi == reference_frame_index:
                rlog.array("orig_kps",  preview_meta.get("orig_kps"))
                rlog.array("new_kps",   preview_meta.get("new_kps"))
                if preview_meta.get("orig_rhand") is not None:
                    rlog.kv("orig_rhand[0] (body->hand ref)", preview_meta["orig_rhand"][0])
                    rlog.kv("orig_kps[R_WRIST]", preview_meta["orig_kps"][self.R_WRIST])
                    rlog.kv("new_kps[R_WRIST]",  preview_meta["new_kps"][self.R_WRIST])
                    if preview_meta.get("new_rhand") is not None:
                        rlog.kv("new_rhand[0] (should equal orig_rhand[0] + (new_wrist - orig_wrist))",
                                preview_meta["new_rhand"][0])
                if preview_meta.get("orig_lhand") is not None:
                    rlog.kv("orig_lhand[0]", preview_meta["orig_lhand"][0])
                    rlog.kv("orig_kps[L_WRIST]", preview_meta["orig_kps"][self.L_WRIST])
                    rlog.kv("new_kps[L_WRIST]",  preview_meta["new_kps"][self.L_WRIST])
                    if preview_meta.get("new_lhand") is not None:
                        rlog.kv("new_lhand[0]", preview_meta["new_lhand"][0])
            if not transfer_face:
                if isinstance(new_frame, dict):
                    new_frame.pop("kps_face", None)
                elif hasattr(new_frame, "kps_face"):
                    new_frame.kps_face = None
            new_frames.append(new_frame)
            preview_metas.append(preview_meta)

        # ── Camera projection (optional) ─────────────────────────────────────
        # When camera_matrices is wired, project the just-transformed front-space
        # joints through each frame's E·K. This is the correct order of operations:
        # cluster transforms in front-space first (so proportions and rotations
        # behave as the user expects), THEN perspective projection. Doing it the
        # other way around (editor projects, then retargeter scales) compounds
        # 2D scale on already-foreshortened pixels and breaks the skeleton.
        #
        # Z values are pulled from keyframe_data (the editor's pure 3D pose stream),
        # since AAPoseMeta's kps_body/kps_rhand/etc. are 2D-only.
        projected_dims = None  # (W, H) when projection runs
        if camera_matrices is not None:
            if keyframe_data is None:
                raise RuntimeError(
                    "MagosPoseRetargeter: camera_matrices is connected but keyframe_data "
                    "is not. Per-joint Z is required for camera projection — wire the "
                    "Editor's keyframe_data output into this node alongside camera_matrices."
                )
            from .camera_math import project_frame_pts, get_z_scale
            kfd_frames = keyframe_data.get("frames", {}) if isinstance(keyframe_data, dict) else {}
            cam_frame_count = int(camera_matrices.get("frame_count", len(new_frames)))
            if len(new_frames) != cam_frame_count:
                print(f"[Retargeter] Warning: pose_data has {len(new_frames)} frames but "
                      f"camera_matrices has {cam_frame_count}. Projecting min(len) frames.")
            extr = camera_matrices["extrinsics"]
            intr = camera_matrices["intrinsics"]
            dists_arr = camera_matrices.get("dists")
            cam_w = int(camera_matrices.get("width", 512))
            cam_h = int(camera_matrices.get("height", 512))
            pose_w = int(camera_matrices.get("pose_w", cam_w))
            z_scale = get_z_scale(pose_w)
            use_ortho = camera_projection == "Orthographic"
            if use_ortho and dists_arr is None:
                print("[Retargeter] camera_projection='Orthographic' but camera_matrices has no "
                      "'dists' field — falling back to Perspective.")
                use_ortho = False

            # Coerce extrinsics/intrinsics/dists to numpy arrays once (torch tensors get
            # converted via .detach().cpu().numpy()).
            def _to_np(t):
                if hasattr(t, "detach"):
                    return t.detach().cpu().numpy()
                return np.asarray(t)
            extr_np = _to_np(extr)
            intr_np = _to_np(intr)
            dists_np = _to_np(dists_arr) if dists_arr is not None else None

            self._project_new_frames_inplace(
                new_frames, kfd_frames, extr_np, intr_np, dists_np,
                z_scale, use_ortho, project_frame_pts,
            )
            projected_dims = (cam_w, cam_h)

        # Preserve the original input format so downstream nodes aren't confused
        if isinstance(pose_data, list):
            output_pose_data = new_frames
        elif isinstance(pose_data, dict):
            output_pose_data = {**pose_data, "pose_metas": new_frames}
            if projected_dims is not None:
                output_pose_data["width"]  = projected_dims[0]
                output_pose_data["height"] = projected_dims[1]
        else:
            output_pose_data = new_frames[0] if len(new_frames) == 1 else new_frames
        
        # Generate preview for the chosen reference frame (default 0)
        first_frame_kps_list = []
        canvas_dims = [512, 512]

        # Pre-compute the transformed ref frame once (used by both preview and ref_frame_pose output)
        _rf_new_frame = None
        _rf_meta = None
        _rf_raw = (keyframe_data or {}).get("ref_frame")
        if _rf_raw is not None:
            try:
                from .dwpose_temporal_editor import _frame_to_posedata_entry
                _rf_new_frame, _rf_meta = self._transform_frame(
                    _frame_to_posedata_entry(_rf_raw), params, micro_offsets, disabled_points, default_hands
                )
            except Exception as _e:
                print(f"MagosPoseRetargeter: ref frame transform failed: {_e}")

        _ui_ref_meta = None  # preview_meta used for UI hand/face export
        if preview_metas:
            ref_idx = min(reference_frame_index, len(preview_metas) - 1)

            if reference_source == "Ref Frame" and _rf_meta is not None:
                _ui_ref_meta = _rf_meta
                preview_image = self._generate_preview(_rf_meta, _rf_raw, reference_image)
                first_frame_kps_list = _rf_meta["orig_kps"].tolist()
                canvas_dims = [_rf_raw.get("width", 512), _rf_raw.get("height", 512)]
            else:
                _ui_ref_meta = preview_metas[ref_idx]
                ref_frame_meta = input_frames[ref_idx] if input_frames else {}
                preview_image = self._generate_preview(_ui_ref_meta, ref_frame_meta, reference_image)
                first_frame_kps_list = _ui_ref_meta["orig_kps"].tolist()
                if isinstance(ref_frame_meta, dict):
                    canvas_dims = [ref_frame_meta.get("width", 512), ref_frame_meta.get("height", 512)]
                else:
                    canvas_dims = [getattr(ref_frame_meta, "width", 512), getattr(ref_frame_meta, "height", 512)]
        else:
            # Return empty preview if no frames
            preview_image = torch.zeros((1, 512, 512, 3), dtype=np.float32)
            ref_idx = 0

        # Store UI data for output
        self._ui_output = {
            "first_frame_kps": first_frame_kps_list,
            "canvas_dims": canvas_dims,
            "first_frame_lhand": _ui_ref_meta.get("orig_lhand", None).tolist() if _ui_ref_meta and _ui_ref_meta.get("orig_lhand") is not None else None,
            "first_frame_rhand": _ui_ref_meta.get("orig_rhand", None).tolist() if _ui_ref_meta and _ui_ref_meta.get("orig_rhand") is not None else None,
            "first_frame_face": _ui_ref_meta.get("orig_face") if _ui_ref_meta and _ui_ref_meta.get("orig_face") is not None else None,
        }
        
        # Add reference image to UI output if provided
        if reference_image is not None:
            try:
                ref_img = reference_image[0].cpu().numpy()
                ref_img = (ref_img * 255).astype(np.uint8)
                ref_img = cv2.cvtColor(ref_img, cv2.COLOR_RGB2BGR)
                ref_img = cv2.resize(ref_img, (canvas_dims[0], canvas_dims[1]))
                _, buffer = cv2.imencode('.png', ref_img)
                self._ui_output["reference_image"] = [base64.b64encode(buffer).decode('utf-8')]
            except Exception as e:
                print(f"MagosPoseRetargeter: Could not encode reference image: {e}")

        # Add the source video frame at reference_frame_index for the canvas toggle
        if source_images is not None:
            try:
                src_idx = min(ref_idx, source_images.shape[0] - 1)
                src_img = source_images[src_idx].cpu().numpy()
                src_img = (src_img * 255).astype(np.uint8)
                src_img = cv2.cvtColor(src_img, cv2.COLOR_RGB2BGR)
                src_img = cv2.resize(src_img, (canvas_dims[0], canvas_dims[1]))
                _, buffer = cv2.imencode('.png', src_img)
                self._ui_output["source_frame_image"] = [base64.b64encode(buffer).decode('utf-8')]
            except Exception as e:
                print(f"MagosPoseRetargeter: Could not encode source frame image: {e}")
        
        # Face images: apply spatial transform when enabled, otherwise pass through unchanged.
        # Never set to None — downstream nodes crash on NoneType. If face_images was never
        # connected it stays None, which is correct (no wire = no downstream).
        if transfer_face and face_images is not None:
            face_images = self._transform_face_images(
                face_images, face_scale_x, face_scale_y, face_offset_x, face_offset_y
            )

        # Build ref_frame_pose output: reuse the already-computed transformed ref frame
        ref_frame_pose = None
        if _rf_new_frame is not None and _rf_raw is not None:
            _rf_w = _rf_raw.get("width", canvas_dims[0] if canvas_dims else 512)
            _rf_h = _rf_raw.get("height", canvas_dims[1] if canvas_dims else 512)
            ref_frame_pose = {"pose_metas": [_rf_new_frame], "width": _rf_w, "height": _rf_h}

        rlog.section("RETARGET DONE", {
            "output_frames": len(new_frames),
            "preview_image_shape": tuple(preview_image.shape) if hasattr(preview_image, "shape") else None,
            "face_images_out": face_images,
            "ref_frame_pose": "built" if ref_frame_pose else "none",
        })
        return {"ui": self._ui_output, "result": (output_pose_data, preview_image, face_images, ref_frame_pose)}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("NaN")