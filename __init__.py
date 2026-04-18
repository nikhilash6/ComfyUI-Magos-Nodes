"""
Magos Nodes — ComfyUI custom node pack by Magos Digital Studio
"""

from .dwpose_cluster_retargeter import DWPoseClusterRetargeter, WEB_DIRECTORY
from .wan_master_control import WanRatioAndFPS
from .wan_sampler_presets import WanAnimateSamplerPresets
from .dwpose_temporal_extractor import DWPoseTEExtractor
from .dwpose_temporal_editor import DWPoseTEEditor, NLFModelLoader
from .dwpose_temporal_renderer import DWPoseTERenderer

NODE_CLASS_MAPPINGS = {
    "MagosPoseRetargeter":      DWPoseClusterRetargeter,
    "WanRatioAndFPS":           WanRatioAndFPS,
    "WanAnimateSamplerPresets": WanAnimateSamplerPresets,
    "DWPoseTEExtractor":        DWPoseTEExtractor,
    "DWPoseTEEditor":           DWPoseTEEditor,
    "DWPoseTERenderer":         DWPoseTERenderer,
    "NLFModelLoader":           NLFModelLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MagosPoseRetargeter":      "Magos Pose Retargeter",
    "WanRatioAndFPS":           "Wan Ratio & FPS",
    "WanAnimateSamplerPresets": "WanAnimate Sampler Presets",
    "DWPoseTEExtractor":        "Magos DWP Extractor",
    "DWPoseTEEditor":           "Magos DWP Editor",
    "DWPoseTERenderer":         "Magos DWP Renderer",
    "NLFModelLoader":           "NLF Model Loader",
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
