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
            },
        }
    
    CATEGORY = "MAGOS Nodes/Retargeting"
    RETURN_TYPES = ("POSEDATA", "IMAGE", "IMAGE")
    RETURN_NAMES = ("modified_pose_data", "preview", "face_images")
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
        # Apply body micro-offsets
        if "body" in micro_offsets:
            for idx_str, offset in micro_offsets["body"].items():
                idx = int(idx_str)
                if 0 <= idx < len(new_kps):
                    dx = offset.get("x", 0)
                    dy = offset.get("y", 0)
                    new_kps[idx] = new_kps[idx] + np.array([dx, dy])
        
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
            if isinstance(new_frame, dict):
                new_frame["kps_face"] = new_face
            else:
                new_frame.kps_face = new_face
        
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
        
        # Define skeleton connections with colors (BGR format)
        # Format: (point1_idx, point2_idx, color)
        skeleton_connections = [
            # Torso
            (self.NECK, self.R_SHOULDER, (255, 0, 0)),      # Blue - Right shoulder
            (self.NECK, self.L_SHOULDER, (0, 255, 0)),      # Green - Left shoulder
            (self.R_SHOULDER, self.R_ELBOW, (255, 0, 0)),   # Blue - Right upper arm
            (self.L_SHOULDER, self.L_ELBOW, (0, 255, 0)),   # Green - Left upper arm
            (self.R_ELBOW, self.R_WRIST, (255, 0, 0)),      # Blue - Right forearm
            (self.L_ELBOW, self.L_WRIST, (0, 255, 0)),      # Green - Left forearm
            # Spine to hips
            (self.NECK, self.R_HIP, (255, 255, 0)),         # Cyan - Right hip
            (self.NECK, self.L_HIP, (255, 0, 255)),         # Magenta - Left hip
            # Legs
            (self.R_HIP, self.R_KNEE, (255, 255, 0)),       # Cyan - Right thigh
            (self.L_HIP, self.L_KNEE, (255, 0, 255)),       # Magenta - Left thigh
            (self.R_KNEE, self.R_ANKLE, (255, 255, 0)),     # Cyan - Right shin
            (self.L_KNEE, self.L_ANKLE, (255, 0, 255)),     # Magenta - Left shin
            (self.R_ANKLE, self.R_TOE, (255, 255, 0)),      # Cyan - Right foot
            (self.L_ANKLE, self.L_TOE, (255, 0, 255)),      # Magenta - Left foot
            # Head
            (self.NECK, self.NOSE, (0, 0, 255)),            # Red - Neck to nose
            (self.NOSE, self.R_EYE, (0, 0, 255)),           # Red - Right eye
            (self.NOSE, self.L_EYE, (0, 0, 255)),           # Red - Left eye
            (self.R_EYE, self.R_EAR, (0, 0, 255)),          # Red - Right ear
            (self.L_EYE, self.L_EAR, (0, 0, 255)),          # Red - Left ear
        ]
        
        def draw_skeleton(kps: np.ndarray, color_alpha: float = 1.0, is_original: bool = True):
            """Draw a skeleton on the canvas."""
            line_thickness = 2 if is_original else 3
            point_radius = 3 if is_original else 5
            
            for p1_idx, p2_idx, color in skeleton_connections:
                # Check confidence for both points
                if (confidence[p1_idx] < self.CONFIDENCE_THRESHOLD or 
                    confidence[p2_idx] < self.CONFIDENCE_THRESHOLD):
                    continue
                
                p1 = kps[p1_idx]
                p2 = kps[p2_idx]
                
                # Skip if points are invalid
                if np.any(np.isnan(p1)) or np.any(np.isnan(p2)):
                    continue
                if np.any(p1 == 0) or np.any(p2 == 0):
                    continue
                
                # Apply alpha to color
                adjusted_color = tuple(int(c * color_alpha) for c in color)
                
                # Draw line
                cv2.line(
                    canvas,
                    (int(p1[0]), int(p1[1])),
                    (int(p2[0]), int(p2[1])),
                    adjusted_color,
                    line_thickness,
                    cv2.LINE_AA
                )
            
            # Draw keypoints
            for idx, point in enumerate(kps):
                if confidence[idx] < self.CONFIDENCE_THRESHOLD:
                    continue
                if np.any(np.isnan(point)) or np.any(point == 0):
                    continue
                
                color = (128, 128, 128) if is_original else (0, 0, 0)
                cv2.circle(canvas, (int(point[0]), int(point[1])), point_radius, color, -1, cv2.LINE_AA)
        
        # Draw original skeleton in lighter colors
        draw_skeleton(orig_kps, color_alpha=0.4, is_original=True)
        
        # Draw new skeleton on top
        draw_skeleton(new_kps, color_alpha=1.0, is_original=False)
        
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
        source_images: Optional[torch.Tensor] = None,
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
        
        # Process each frame
        preview_metas = []
        new_frames = []
        for frame in input_frames:
            new_frame, preview_meta = self._transform_frame(frame, params, micro_offsets, disabled_points, default_hands)
            if not transfer_face:
                if isinstance(new_frame, dict):
                    new_frame.pop("kps_face", None)
                elif hasattr(new_frame, "kps_face"):
                    new_frame.kps_face = None
            new_frames.append(new_frame)
            preview_metas.append(preview_meta)

        # Preserve the original input format so downstream nodes aren't confused
        if isinstance(pose_data, list):
            output_pose_data = new_frames
        elif isinstance(pose_data, dict):
            output_pose_data = {**pose_data, "pose_metas": new_frames}
        else:
            output_pose_data = new_frames[0] if len(new_frames) == 1 else new_frames
        
        # Generate preview for the chosen reference frame (default 0)
        first_frame_kps_list = []
        canvas_dims = [512, 512]

        if preview_metas:
            ref_idx = min(reference_frame_index, len(preview_metas) - 1)
            ref_frame_meta = input_frames[ref_idx] if input_frames else {}
            preview_image = self._generate_preview(
                preview_metas[ref_idx],
                ref_frame_meta,
                reference_image
            )

            # Extract reference frame keypoints for UI
            first_orig_kps = preview_metas[ref_idx]["orig_kps"]
            # Convert numpy array to list for JSON serialization
            first_frame_kps_list = first_orig_kps.tolist()

            # Get canvas dimensions
            if isinstance(ref_frame_meta, dict):
                canvas_dims = [
                    ref_frame_meta.get("width", 512),
                    ref_frame_meta.get("height", 512)
                ]
            else:
                canvas_dims = [
                    getattr(ref_frame_meta, "width", 512),
                    getattr(ref_frame_meta, "height", 512)
                ]
        else:
            # Return empty preview if no frames
            preview_image = torch.zeros((1, 512, 512, 3), dtype=np.float32)
            ref_idx = 0

        # Store UI data for output
        self._ui_output = {
            "first_frame_kps": first_frame_kps_list,
            "canvas_dims": canvas_dims,
            "first_frame_lhand": preview_metas[ref_idx].get("orig_lhand", None).tolist() if preview_metas and preview_metas[ref_idx].get("orig_lhand") is not None else None,
            "first_frame_rhand": preview_metas[ref_idx].get("orig_rhand", None).tolist() if preview_metas and preview_metas[ref_idx].get("orig_rhand") is not None else None,
            "first_frame_face": preview_metas[ref_idx].get("orig_face") if preview_metas and preview_metas[ref_idx].get("orig_face") is not None else None,
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

        return {"ui": self._ui_output, "result": (output_pose_data, preview_image, face_images)}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("NaN")