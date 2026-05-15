# Magos Nodes — ComfyUI DWPose & NLF Editor / Retargeter

*Note: this README was written by an AI from the source code.*

A professional node pack by **Magos Digital Studio** for precise pose control inside ComfyUI.
Extract **DWPose** body / hand / face keypoints **and** **NLF** 3D SMPL joints from a video batch, **edit either skeleton frame-by-frame in a full-screen interactive editor **(timeline + dope sheet + graph + 3D orbit + animated camera), retarget body cluster proportions, and render clean pose images.

The pack is engine-agnostic: it outputs standard ComfyUI types (`IMAGE`, `POSE_KEYPOINT`, `BBOX`) and the WanAnimatePreprocess `POSEDATA` type, so it plugs into **WanAnimate, ControlNet (OpenPose / DWPose), SCAIL, LTX-Video, UniAnimate**, and any other pose-driven pipeline.

> **Note on the Retargeter:** the cluster retargeter works on DWPose data only. NLF data passes through untransformed. Edit NLF freely in the editor, but the per-cluster scale / offset / rotation controls do not apply to NLF body joints.

---

## What's Included

| Node | Category | Purpose |
|---|---|---|
| **Magos DWP Extractor** | Temporal Editor | Detect body, hand, and face keypoints from a video batch; optional NLF 3D depth |
| **Magos DWP Editor** | Temporal Editor | Full-screen interactive timeline editor (pop-up overlay) |
| **Magos DWP Renderer** | Temporal Editor | Render edited skeletons to image batch and ControlNet keypoints; optional NLF-only render mode |
| **Magos Pose Retargeter** | Retargeting | Scale, offset, and rotate body clusters across all frames; Ref Frame preview + camera-aware projection |
| **Wan Ratio & FPS** | Utils | Mod-16 compliant resolution + FPS picker (handy for WanAnimate, usable anywhere) |
| **WanAnimate Sampler Presets** | Utils | One-click sampler configuration with user-saveable presets (WanAnimate-tuned defaults) |

All nodes register under the **MAGOS Nodes** sub-menu in the Add Node panel.


https://github.com/user-attachments/assets/47e56dc7-91b6-40d5-bcf2-2af323891f85








---

## Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- [ComfyUI-WanAnimatePreprocess](https://github.com/kijai/ComfyUI-WanAnimatePreprocess) — provides the YOLO + ViTPose ONNX detection backend and the `POSEDATA` type used throughout this pack. Required regardless of which downstream model you target (WanAnimate, ControlNet, SCAIL, LTX, UniAnimate, …).
- **Optional** — [ComfyUI-SCAIL-Pose](https://github.com/kijai/ComfyUI-SCAIL-Pose) for NLF 3D pose estimation.

Python deps (`numpy`, `opencv-python`, `torch`, `onnxruntime`) are all installed by ComfyUI / WanAnimatePreprocess.

---

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/MagosDigitalStudio/ComfyUI-Magos-Nodes
```

Restart ComfyUI. All nodes appear under **MAGOS Nodes** in the Add Node menu.

---

## Editor Highlights

- **Timeline editing** — drag joints, insert keyframes, smooth curves across any number of frames
- **Graph editor** — per-joint curve editing with Catmull-Rom / Linear / Step / Ease interpolation
- **Dope Sheet** — diamond view of all keyframes; move, copy, and trim in time
- **Multiple viewports** — Front, Back, Top, Side, Orbit (3D), and Camera views; switch any panel via the viewport dropdown
- **Face editing** — 70 face landmarks fully editable as a dedicated joint group with keyframes and graph curves
- **NLF 3D mode** — switch the editor to NLF mode for full keyframe editing of SMPL 3D joints (separate dope sheet, graph, drag, gizmo)
- **3D Orbit view** — Three.js rendered skeleton with Z-depth; drag joints to set depth for 2.5D rendering
- **Animated camera** — set per-frame camera position / rotation / FOV; preview through Camera viewport; export `CAMERA_MATRICES`
- **⊕ Ref Frame** — capture a clean front-view snapshot of frame 0 (unaffected by camera transforms) for use as a stable retargeter reference
- **Add Hand** — synthesize a hand pose at any wrist, then move it with IK
- **Reference overlay** — load a still image, video file, or image sequence as a canvas backdrop
- **Save / Load project** — export editor state to JSON and restore it later
- **Auto Keyframe** — automatically write keyframes on every joint drag

---

## Typical Workflows

The pack drives any pose-conditioned pipeline. Wire the Renderer's `pose_images` (IMAGE) or `pose_keypoints` (POSE_KEYPOINT) into whichever node your target model wants.

### Basic — Extract, Edit, Render

```
VHS_LoadVideo ──► Magos DWP Extractor ──► Magos DWP Editor ──► Magos DWP Renderer ──► [your model]
```

### With Retargeting (DWPose only)

```
Magos DWP Editor ──► keyframe_data ──► Magos Pose Retargeter ──► Magos DWP Renderer ──► [your model]
                                              └──► ref_frame_pose ──► Renderer (ref preview)
```

> The Retargeter operates on DWPose body / hand / face data only. NLF body data flows through the Editor untouched — animate or correct it in the Editor's NLF tab, but the cluster sliders won't reshape NLF joints.

### Camera-aware Retargeting (3D mode)

```
Magos DWP Editor (render = "Retargeter")
   │ pose_data
   │ keyframe_data
   │ camera_matrices
   ▼
Magos Pose Retargeter (camera_projection = "Perspective" | "Orthographic")
   │ modified_pose_data
   ▼
Magos DWP Renderer
```

### ControlNet (OpenPose / DWPose)

```
Magos DWP Renderer ──► pose_keypoints (POSE_KEYPOINT) ──► DWPose Preprocessor Visualizer ──► ControlNet
```

### WanAnimate / SCAIL / LTX-Video / UniAnimate

```
Magos DWP Renderer ──► pose_images (IMAGE) ──► WanAnimate / WanVideoAddSCAILPoseEmbeds / LTX pose node / UniAnimate
```

`pose_images` is a standard IMAGE tensor — no conversion needed for any of these pipelines.

---

## NLF 3D Integration

The Extractor includes a built-in NLF (Neural Localizer Fields) model selector. When an NLF model is selected, 3D SMPL joint positions are estimated alongside DWPose and stored for use in the editor.

**Requirements:**
1. [ComfyUI-SCAIL-Pose](https://github.com/kijai/ComfyUI-SCAIL-Pose) — provides the `MultipersonNLF` pipeline
2. An NLF `.safetensors` model file placed in `ComfyUI/models/nlf/`
3. Select the model in the **nlf_model** dropdown on the Extractor node

**In the editor:**
- Use the **DWPose / NLF** tab toggle to switch between DWPose and NLF editing modes
- In NLF mode the dope sheet, graph editor, and viewport all show the 18 SMPL joints
- **NLF Overlay Opacity** slider (with eye toggle) blends the purple NLF skeleton in all viewports
- **⬡ Turn to 3D** enables a 4-viewport layout (Front, Orbit, Camera, Side) with the 3D renderer active
- **⬇ Bake Z Depth** writes NLF depth values into the DWPose body joints for renderer output

**In the renderer:**
- Toggle **NLF Render** on the Renderer node to output the NLF skeleton (purple) instead of DWPose body bones (hands/face are still drawn from DWPose)

Selecting `(None)` in the nlf_model dropdown skips 3D estimation — the editor works normally without it.

---

## Ref Frame

The **⊕ Ref Frame** button in the editor captures a clean, camera-immune snapshot of frame 0's raw detection. Use it to fix badly detected joints (e.g., invisible legs in a medium shot) without any camera transform affecting the result.

Connect `keyframe_data` from the Editor to the Retargeter and set **Reference Source = Ref Frame** to tune retargeter sliders against this clean snapshot instead of a potentially camera-distorted frame.

The Retargeter's **ref_frame_pose** output always produces the ref frame with cluster transforms applied — wire it to a Renderer to preview the retargeted reference pose.

---

## Documentation

See [MANUAL.md](MANUAL.md) for a complete per-node reference (inputs, outputs, parameter ranges, keyboard shortcuts, data type definitions, and worked workflow examples).

---

## License

**GNU General Public License v3.0** — see [LICENSE](LICENSE) for the full text.

In short: you are free to use, study, share, and modify this software, but any derivative work that you distribute must also be released under GPL-3.0 (or a compatible later version) with full source code available. There is no warranty.

---

*Magos Digital Studio*

*This README was generated by an AI (Claude) by reading the source code of every node in the pack. Report any inaccuracies via GitHub issues.*
