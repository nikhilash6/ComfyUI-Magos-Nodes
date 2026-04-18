"""
Wan Ratio & FPS — Magos Nodes
Author: Magos Digital Studio

Dashboard for outputting Mod-16 compliant width/height integers and frame rates
for WanAnimate video generation.
"""

from typing import Dict, Any, Tuple


class WanRatioAndFPS:
    """
    A ComfyUI custom node that acts as a dashboard for WanAnimate video generation.
    Outputs Mod-16 compliant resolution dimensions and frame rates.
    
    Features:
    - Preset aspect ratios with Mod-16 compliant resolutions
    - Quality presets (480p, 720p, 1080p)
    - Custom width/height override with Mod-16 safety rounding
    - FPS presets with custom override option
    """
    
    # Resolution lookup table: ratio -> quality -> (width, height)
    # All values are Mod-16 compliant (divisible by 16)
    RESOLUTION_TABLE: Dict[str, Dict[str, Tuple[int, int]]] = {
        "16:9": {
            "480p": (832, 480),
            "720p": (1280, 720),
            "1080p": (1920, 1088),
        },
        "9:16": {
            "480p": (480, 832),
            "720p": (720, 1280),
            "1080p": (1088, 1920),
        },
        "1:1": {
            "480p": (512, 512),
            "720p": (768, 768),
            "1080p": (1024, 1024),
        },
        "4:3": {
            "480p": (640, 480),
            "720p": (960, 720),
            "1080p": (1440, 1088),
        },
        "3:4": {
            "480p": (480, 640),
            "720p": (720, 960),
            "1080p": (1088, 1440),
        },
        "21:9": {
            "480p": (1120, 480),
            "720p": (1680, 720),
            "1080p": (2528, 1088),
        },
    }
    
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                # Aspect ratio selection
                "ratio": (
                    ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "Custom"],
                    {"default": "16:9"},
                ),
                # Quality preset selection
                "quality": (
                    ["480p", "720p", "1080p"],
                    {"default": "720p"},
                ),
                # Custom width (used when ratio == "Custom")
                "custom_width": (
                    "INT",
                    {"default": 512, "min": 64, "max": 8192, "step": 16, "display": "number"},
                ),
                # Custom height (used when ratio == "Custom")
                "custom_height": (
                    "INT",
                    {"default": 512, "min": 64, "max": 8192, "step": 16, "display": "number"},
                ),
                # FPS preset selection
                "fps_preset": (
                    ["12", "15", "23.976", "24", "25", "30", "48", "50", "60", "Custom"],
                    {"default": "24"},
                ),
                # Custom FPS (used when fps_preset == "Custom")
                "custom_fps": (
                    "FLOAT",
                    {"default": 24.0, "min": 1.0, "max": 120.0, "step": 0.001, "display": "number"},
                ),
            },
        }
    
    CATEGORY = "MAGOS Nodes/Utils"
    RETURN_TYPES = ("INT", "INT", "FLOAT")
    RETURN_NAMES = ("width", "height", "fps")
    FUNCTION = "get_resolution_and_fps"
    
    def _ensure_mod16(self, value: int) -> int:
        """
        Ensure a value is Mod-16 compliant by rounding down.
        
        Args:
            value: The input integer value
            
        Returns:
            The nearest lower multiple of 16
        """
        return (value // 16) * 16
    
    def get_resolution_and_fps(
        self,
        ratio: str,
        quality: str,
        custom_width: int,
        custom_height: int,
        fps_preset: str,
        custom_fps: float,
    ) -> Tuple[int, int, float]:
        """
        Calculate and return width, height, and FPS based on inputs.
        
        Args:
            ratio: Selected aspect ratio preset or "Custom"
            quality: Selected quality preset (480p, 720p, 1080p)
            custom_width: Custom width value (used when ratio == "Custom")
            custom_height: Custom height value (used when ratio == "Custom")
            fps_preset: Selected FPS preset or "Custom"
            custom_fps: Custom FPS value (used when fps_preset == "Custom")
            
        Returns:
            Tuple of (width, height, fps) - width/height as int, fps as float
        """
        # =========================================
        # RESOLUTION MATH
        # =========================================
        if ratio == "Custom":
            # Use custom dimensions with Mod-16 safety rounding
            width = self._ensure_mod16(custom_width)
            height = self._ensure_mod16(custom_height)
        else:
            # Look up preset resolution from table
            if ratio in self.RESOLUTION_TABLE and quality in self.RESOLUTION_TABLE[ratio]:
                width, height = self.RESOLUTION_TABLE[ratio][quality]
            else:
                # Fallback to a safe default if something goes wrong
                width, height = 512, 512
        
        # =========================================
        # FPS MATH
        # =========================================
        if fps_preset == "Custom":
            fps = custom_fps
        else:
            # Convert preset string directly to float
            fps = float(fps_preset)
        
        return (width, height, fps)


# Node class mappings for ComfyUI registration
NODE_CLASS_MAPPINGS = {
    "WanRatioAndFPS": WanRatioAndFPS,
}

# Display name mappings for the node menu
NODE_DISPLAY_NAME_MAPPINGS = {
    "WanRatioAndFPS": "Wan Ratio & FPS",
}