# Magos Nodes — User Manual

**ComfyUI Custom Node Pack by Magos Digital Studio**

---

## Table of Contents

1. [Magos DWP Extractor](#1-magos-dwp-extractor)
2. [Magos DWP Editor](#2-magos-dwp-editor)
   - [Opening the Editor](#opening-the-editor)
   - [Front View (Main Viewport)](#front-view-main-viewport)
   - [Orbit View (3D / Z-Depth)](#orbit-view-3d--z-depth)
   - [Split View](#split-view)
   - [Add Hand](#add-hand)
   - [IK Mode](#ik-mode)
   - [Reference Overlay](#reference-overlay)
   - [Layer Panel](#layer-panel)
   - [Graph Editor](#graph-editor)
   - [Dope Sheet](#dope-sheet)
   - [Transport & Playback](#transport--playback)
   - [Keyframe Controls](#keyframe-controls)
   - [Save / Load / Apply](#save--load--apply)
   - [Keyboard Shortcuts](#keyboard-shortcuts)
3. [Magos DWP Renderer](#3-magos-dwp-renderer)
4. [Magos Pose Retargeter](#4-magos-pose-retargeter)
5. [Wan Ratio & FPS](#5-wan-ratio--fps)
6. [WanAnimate Sampler Presets](#6-wanimate-sampler-presets)
7. [Data Types](#7-data-types)
8. [Workflow Examples](#8-workflow-examples)
9. [Experimental: NLF Overlay](#9-experimental-nlf-overlay)

---

## 1. Magos DWP Extractor

Detects body, hand, and face keypoints from a video frame batch using YOLO + ViTPose (the same models as WanAnimatePreprocess). Outputs raw `KEYFRAME_DATA` for the editor and `POSEDATA` for direct use.

### Inputs

| Input | Type | Description |
|---|---|---|
| `images` | IMAGE | Video frame batch (B, H, W, C) |
| `model` | POSEMODEL | Pose detection model from WanAnimatePreprocess |

### Parameters

| Parameter | Default | Description |
|---|---|---|
| `detect_hands` | On | Enable 21-point hand keypoint detection |
| `detect_face` | Off | Enable 68-point face landmark detection |
| `detect_head` | On | Include head keypoints (nose, eyes, ears). Disable to zero out head confidence |
| `confidence_threshold` | 0.3 | Minimum keypoint confidence to accept |
| `person_index` | 0 | Which detected person to track (0 = largest bounding box) |
| `output_width` | 0 | Rescale keypoint X coordinates to this width. 0 = use source width |
| `output_height` | 0 | Rescale keypoint Y coordinates to this height. 0 = use source height |
| `face_padding` | 20 | Padding (pixels) around the face crop region |

### Outputs

| Output | Type | Description |
|---|---|---|
| `keyframe_data` | KEYFRAME_DATA | Full skeleton data — feed into Magos DWP Editor |
| `pose_data` | POSEDATA | Direct pose output — feed into Retargeter or Renderer |
| `face_images` | IMAGE | Cropped face region per frame (pixel crop of the actual video, not a skeleton) |
| `bboxes` | BBOX | Person bounding boxes per frame |
| `facebboxes` | BBOX | Face bounding boxes — compatible with SAM2Segmentation |

### Notes

- If no person is detected on a frame, the last valid detection is carried forward automatically.
- All detected frames are baked into `overrides` in the KEYFRAME_DATA, so every frame shows as a keyframe diamond in the editor timeline.

---

## 2. Magos DWP Editor

A full-screen interactive editor that opens as a pop-up overlay inside ComfyUI. All edits are stored in the node widget and survive workflow saves and ComfyUI restarts.

> **Run the workflow at least once before opening the editor** — it needs the Extractor to have processed frames first.

The editor **automatically resets** when footage changes (different resolution or frame count).

### Opening the Editor

Click **"Open Temporal Editor"** on the node. The editor opens as a full-screen overlay. Press **F1** at any time to open the help panel with a full shortcut reference.

---

### Front View (Main Viewport)

The main canvas showing the skeleton overlaid on the source video frame.

**Mouse controls:**
- **Drag a joint** — move it; creates or updates a keyframe if Auto Key is ON
- **Shift + click a joint** — add to multi-selection without clearing current selection
- **Ctrl + drag empty area** — rubber-band box-select joints
- **Right-click a joint** — disable / enable it (disabled joints render at confidence 0 and appear as a red X)
- **Scroll wheel** — zoom in / out
- **Middle-click drag** — pan the canvas
- **Double-click** — reset zoom and pan

**Overlay buttons:**
- **SHOW ALL** (top-right corner) — temporarily reveal all hidden joints
- **⟳ Reset View** (top-right corner) — reset zoom and pan to fit the skeleton

**Joint appearance:**
- White circle — raw detected position (no override on this frame)
- Blue circle — interpolated position (between keyframes)
- Gold diamond — manually set keyframe
- Red X — disabled joint (excluded from renderer output)

---

### Orbit View (3D / Z-Depth)

Switch to **3D** using the camera button in the sidebar. The orbit canvas shows a rotatable 3D view where the horizontal axis represents Z-depth.

- **Drag a joint horizontally** — adjusts its Z-depth (positive = closer to camera)
- **Drag a joint vertically** — adjusts Y position
- **Drag axis labels** — rotate the 3D view
- **Scroll / middle-drag** — zoom and pan the orbit canvas
- When multiple joints are selected, dragging moves the entire cluster

Z-depth controls draw order in the renderer: joints with higher Z are drawn on top of joints with lower Z.

---

### Split View

Click **Split** to show Front View and Orbit View side-by-side. This is the most efficient layout for sculpting Z-depth while watching the 2D result update in real time.

---

### Add Hand

If the detected skeleton has no hand data for a frame (or you want to add a second hand), use **＋ Add ▾ → Hand** in the sidebar.

1. Click **＋ Add ▾** to open the add menu
2. Click **＋ Hand** to reveal the side chooser
3. Click **＋ Right** or **＋ Left**

A default hand pose (open palm) is synthesized at the wrist position. All 21 finger joints are placed as overrides and can be dragged normally. Enable **IK** to move the entire hand together.

---

### IK Mode

Each hand group in the Layer Panel has an **IK / FK** toggle button.

- **IK ON** — dragging the wrist (body joint) or palm base (hand joint 0) moves all finger joints as a rigid cluster. Use this to reposition the whole hand without distorting finger shape.
- **FK ON** (default) — each joint moves independently.

IK mode only affects hand groups. Body joints always move individually.

---

### Reference Overlay

Load a reference image, video, or image sequence to overlay on the canvas for tracing or matching:

- **🖼 Image** — a still image shown on every frame
- **🎬 Video** — a video file; each frame is synced to the timeline
- **🎞 Seq** — an image sequence (select multiple files in the file picker)
- **Opacity slider** — adjust how transparent the reference is
- **👁 Reference: ON/OFF** — toggle visibility
- **× Clear** — remove the current reference

---

### Layer Panel

The right-side panel lists all joints grouped by body part (Body, Right Hand, Left Hand, Face).

- **Click a row** — select that joint (clears current selection)
- **Ctrl + click** — toggle individual joint in/out of selection
- **Shift + click** — range-select all joints between last clicked and current
- **Eye icon** — hide / show a joint in the viewport (display only; does not affect output)
- **Lock icon** — lock a joint so it cannot be moved (locked joints are excluded from cluster moves)

---

### Graph Editor

Switch to the **Graph** tab to edit per-joint position curves over time. Selected joints show X (red) and Y (blue) curves.

**Navigation:**
- Scroll — pan horizontally; Shift+Scroll — pan vertically
- Ctrl+Scroll — zoom horizontal; Ctrl+Shift+Scroll — zoom vertical
- Middle-drag — free pan

**Editing:**
- Click a curve point to select it; rubber-band drag to select multiple
- Drag selected points to move them in time and value
- **G** — Grab mode (move); **S** — Scale mode (rescale around center)
- Lock axis: press **X** or **Y** after starting Grab/Scale
- **Enter** / left-click — confirm; **Esc** / right-click — cancel
- **K / I** — insert keyframe at current frame for selected joints
- **Del** — delete selected keyframes
- **O** — Gaussian smooth selected keyframe values

**Interpolation** (buttons below graph, apply to selected or all):
- **Catmull-Rom** — smooth spline (default)
- **Linear** — straight lines between keyframes
- **Step / Hold** — value holds until next keyframe (hard cuts)
- **Ease** — slow in and slow out (hourglass curve)

---

### Dope Sheet

Switch to the **Dope Sheet** tab for a diamond view of all keyframes across all joints.

- Click a diamond to select that keyframe
- Drag selection to move keyframes in time
- **Ctrl+C / V** — copy and paste selected keyframes
- **◀K✕ Before** / **✕K▶ After** — trim all keyframes before or after the current frame

---

### Transport & Playback

| Control | Description |
|---|---|
| **◀ / ▶** | Step one frame backward / forward |
| **Space** | Play / pause real-time preview |
| **Frame scrubber** | Click or drag to seek |
| **Thumbnail strip** | Click any thumbnail to jump to that frame |
| **FPS field** | Set playback frame rate |
| **Range fields** | Restrict playback to a sub-range |

---

### Keyframe Controls

| Control | Description |
|---|---|
| **⬤ Auto Key** | When ON, every joint drag automatically writes a keyframe |
| **⬦ Add Key [K]** | Manually insert a keyframe for all selected joints |
| **✕ Del Key [Del]** | Delete keyframes for all selected joints at current frame |
| **◀K✕ Before** | Remove all keyframes before the current frame |
| **✕K▶ After** | Remove all keyframes after the current frame |

---

### Save / Load / Apply

- **💾 Save** — downloads the current editor state (overrides, Z-depth, smoothing, interpolation) as a `.json` file
- **📂 Load** — loads a previously saved `.json` project file
- **Apply Changes** — syncs the editor state to the ComfyUI node widget

> Always click **Apply Changes** before closing if you want your edits to take effect when you queue the workflow.

---

### Keyboard Shortcuts

| Key | Action |
|---|---|
| **F1** | Open / close help panel |
| **Space** | Play / pause |
| **← / →** | Previous / next frame |
| **K / I** | Insert keyframe for selected joints |
| **Del** | Delete selected keyframes |
| **H** | Hide selected joints |
| **Alt+H** | Unhide all joints |
| **Tab** | Toggle Dope Sheet ↔ Graph Editor |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** | Redo |
| **Escape** | Close editor |

### State Persistence

| Scenario | Edits preserved? |
|---|---|
| Close and reopen editor popup | Yes |
| ComfyUI server restart, same workflow | Yes (stored in widget) |
| Re-queue with same video | Yes |
| Load different video (different resolution or frame count) | **No — auto-reset** |
| Delete and re-add the node | No (new node ID) |

---

### Outputs

| Output | Type | Description |
|---|---|---|
| `keyframe_data` | KEYFRAME_DATA | Edited skeleton data with all overrides, Z-depth, and smoothing applied |
| `pose_data` | POSEDATA | Converted output compatible with Magos Pose Retargeter and DWPose renderer |

---

## 3. Magos DWP Renderer

Renders skeleton data into a colored image batch. Drop-in replacement for DrawViTPose, with Z-depth sorting and a separate face output.

### Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `pose_data` | POSEDATA | Yes | Skeleton coordinates — from the Editor or Retargeter |
| `keyframe_data` | KEYFRAME_DATA | No | Used for Z-depth values. Omit to render without depth sorting |
| `draw_face_on_pose` | BOOLEAN | No | Composite face landmarks onto `pose_images` as well. Default: Off |

### Outputs

| Output | Type | Description |
|---|---|---|
| `pose_images` | IMAGE | Body skeleton + hands on black background |
| `face_images` | IMAGE | Face landmarks only on black background |
| `pose_keypoints` | POSE_KEYPOINT | ControlNet-aux standard format (18-pt body, 68-pt face, 21-pt hands per frame) |

### Rendering Details

- Body connections are Z-depth sorted: bones with higher Z are drawn first so nearer bones appear on top.
- Hands are drawn on top of the body (right hand = blue, left hand = green).
- Face landmarks go to `face_images`. Enable `draw_face_on_pose` to also composite them onto `pose_images`.
- Keypoints with confidence below **0.5** are not rendered.
- Output: `(B, H, W, 3)` float32 tensor, values 0–1.

### Compatibility

| Downstream Node | Connect To |
|---|---|
| WanAnimate pose condition | `pose_images` |
| SCAIL (`WanVideoAddSCAILPoseEmbeds`) | `pose_images` |
| LTX-Video pose node | `pose_images` |
| UniAnimate | `pose_images` |
| ControlNet (DWPose Preprocessor Visualizer) | `pose_keypoints` |

---

## 4. Magos Pose Retargeter

Applies per-cluster geometric transforms (scale, offset, rotation) to skeleton data across all frames. Useful for adapting a captured performance to a different character or canvas size.

### Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `pose_data` | POSEDATA | Yes | Skeleton to retarget |
| `reference_image` | IMAGE | No | Background image for visual calibration in the canvas |
| `source_images` | IMAGE | No | Source video frames for the canvas frame preview |
| `face_images` | IMAGE | No | Face pixel crops from the Extractor — transformed with face cluster settings |
| `micro_offsets_json` | STRING | No | Per-joint fine-tune offsets (managed by the canvas UI) |
| `disabled_points_json` | STRING | No | Joints disabled in the canvas UI |
| `default_hands_json` | STRING | No | Default hand pose when hands are absent |

### Global Controls

| Parameter | Default | Description |
|---|---|---|
| `global_scale` | 1.0 | Uniform scale applied to the whole skeleton |
| `global_offset_x/y` | 0 | Pixel offset applied after all other transforms |
| `reference_frame_index` | 0 | Which frame to display in the canvas for calibration |
| `transfer_face` | On | Include face landmark transforms in output |

### Cluster Controls

Each cluster (Torso, Head, Right Arm, Left Arm, Right Leg, Left Leg) has:

| Control | Description |
|---|---|
| `{cluster}_scale_x/y` | Scale the cluster around its root joint |
| `{cluster}_offset_x/y` | Pixel offset of the cluster after scaling |
| `{cluster}_rotation` | Rotation around the root joint (degrees) |

**Root joints:** Torso = neck, Head = nose, Right/Left Arm = shoulders, Right/Left Leg = hips.

### Hand & Face Controls

| Parameter | Description |
|---|---|
| `right/left_hand_scale_x/y` | Scale hand keypoints around the wrist |
| `right/left_hand_rotation` | Rotate hand keypoints around the wrist |
| `face_scale_x/y` | Scale face landmarks and face pixel crops |
| `face_offset_x/y` | Translate face landmarks and pixel crops |

### Outputs

| Output | Type | Description |
|---|---|---|
| `modified_pose_data` | POSEDATA | Retargeted skeleton — feed into Magos DWP Renderer |
| `preview` | IMAGE | Single-frame preview showing original (faded) and retargeted skeleton (solid) |
| `face_images` | IMAGE | Face pixel crops with face cluster transforms applied |

---

## 5. Wan Ratio & FPS

Outputs Mod-16 compliant resolution dimensions and frame rate for WanAnimate.

### Parameters

| Parameter | Options | Description |
|---|---|---|
| `ratio` | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, Custom | Aspect ratio preset |
| `quality` | 480p, 720p, 1080p | Resolution tier |
| `custom_width/height` | 64–8192 | Used when ratio = Custom (auto-rounded to nearest lower Mod-16) |
| `fps_preset` | 12, 15, 23.976, 24, 25, 30, 48, 50, 60, Custom | Frames per second |
| `custom_fps` | 1.0–120.0 | Used when fps_preset = Custom |

### Preset Resolutions

| Ratio | 480p | 720p | 1080p |
|---|---|---|---|
| 16:9 | 832×480 | 1280×720 | 1920×1088 |
| 9:16 | 480×832 | 720×1280 | 1088×1920 |
| 1:1 | 512×512 | 768×768 | 1024×1024 |
| 4:3 | 640×480 | 960×720 | 1440×1088 |
| 3:4 | 480×640 | 720×960 | 1088×1440 |
| 21:9 | 1120×480 | 1680×720 | 2528×1088 |

### Outputs

`width` (INT), `height` (INT), `fps` (FLOAT)

---

## 6. WanAnimate Sampler Presets

Quick-select sampler configuration with built-in quality presets and user-saveable custom presets.

### Parameters

| Parameter | Description |
|---|---|
| `preset` | Select a built-in or user-saved preset. Choose **Custom** to set values manually |
| `custom_steps` | Number of diffusion steps |
| `custom_cfg` | CFG / guidance scale |
| `custom_scheduler` | Scheduler algorithm |
| `custom_lora_strength` | Distilled LoRA strength (set > 0 for distilled / LCM models) |

### Built-in Presets

| Preset | Steps | CFG | Scheduler | LoRA |
|---|---|---|---|---|
| Preview / Distilled (4 Steps) | 4 | 1.0 | dpm++_sde | 1.0 |
| Standard (20 Steps) | 20 | 5.0 | unipc | 0.0 |
| High Quality (30 Steps) | 30 | 5.0 | unipc | 0.0 |
| Maximum (40 Steps) | 40 | 5.0 | dpm++_sde | 0.0 |

Custom presets are saved to `user_presets.json` and persist across sessions. Built-in presets cannot be overwritten.

### Outputs

`steps` (INT), `cfg` (FLOAT), `scheduler` (STRING), `lora_strength` (FLOAT)

---

## 7. Data Types

### KEYFRAME_DATA

Internal format used between the Extractor and Editor. Contains:
- `frames` — per-frame skeleton data in pixel coordinates (body 20 pts, hands 21 pts each, face 68 pts)
- `overrides` — manual edits: `{frame_index: {label: [x, y, conf, z]}}`
- `z_depth` — Z-depth values: `{frame_index: {label: float}}`
- `tweens` — per-keyframe interpolation mode overrides
- `smooth_window` — Gaussian smoothing window size
- `frame_count`, `width`, `height`

### POSEDATA

Compatible with WanAnimatePreprocess's DrawViTPose and Magos Pose Retargeter. A list of per-frame skeleton objects with pixel-coordinate keypoints.

### POSE_KEYPOINT

ControlNet-aux standard format. A list of one dict per frame, each containing:
- `people[0].pose_keypoints_2d` — 18 body keypoints in OpenPose format `[x, y, confidence]`
- `people[0].face_keypoints_2d` — 68 face landmarks
- `people[0].hand_left_keypoints_2d` / `hand_right_keypoints_2d` — 21 keypoints per hand
- `canvas_width`, `canvas_height`

Compatible with `DWPose Preprocessor Visualizer` and any ControlNet pose node.

### BBOX

Standard ComfyUI bounding box format: `[[x1, y1, x2, y2], ...]` per frame. Compatible with SAM2Segmentation and Florence2 nodes.

---

## 8. Workflow Examples

### Minimal Pose Control

```
[VHS_LoadVideo]
    │ images
    ▼
[WanAnimatePreprocess / LoadPoseModel]
    │ model
    ▼
[Magos DWP Extractor]
    │ keyframe_data
    ▼
[Magos DWP Editor]  ← Open editor, edit, click Apply
    │ pose_data
    ▼
[Magos DWP Renderer]
    │ pose_images
    ▼
[WanAnimate / KSampler]
```

### With Retargeting

```
[VHS_LoadVideo] ──────────────► [Magos DWP Extractor]
[LoadPoseModel] ──────────────►     │ keyframe_data
                                     ▼
                               [Magos DWP Editor]
                                │ pose_data
                                ▼
                         [Magos Pose Retargeter]
                          │ modified_pose_data
                          ▼
                     [Magos DWP Renderer]
                      │ pose_images
                      ▼
                 [WanAnimate]
```

### Face Segmentation with SAM2

```
[Magos DWP Extractor]
    │ face_images (pixel crop)    │ facebboxes (BBOX)
    ▼                             ▼
[IP-Adapter Face]          [SAM2Segmentation]
                                  │ mask
                                  ▼
                             [WanAnimate inpaint]
```

### ControlNet Pose Pipeline

```
[Magos DWP Renderer]
    │ pose_keypoints (POSE_KEYPOINT)
    ▼
[DWPose Preprocessor Visualizer]
    │ IMAGE
    ▼
[ControlNet Apply]
```

---

## 9. Experimental: NLF Overlay

> **Status: Experimental — not ready for production use.**

The editor can display a 3D SMPL skeleton as a ghosted purple overlay alongside the standard DWPose view. This uses Neural Localizer Fields (NLF) to estimate 24 SMPL body joints with full 3D depth.

### Requirements

1. [ComfyUI-SCAIL-Pose](https://github.com/kijai/ComfyUI-SCAIL-Pose) — provides the `MultipersonNLF` pipeline
2. An NLF `.safetensors` model file placed in `ComfyUI/models/nlf/`
3. Connect the **NLF Model Loader** node output to the `nlf_model` input on **Magos DWP Editor**

### Usage

1. Connect the NLF Model Loader and run the workflow (inference is cached during graph execution)
2. Open the editor and click **⚗ Experimental** in the sidebar to toggle it ON
3. The status line shows "NLF: N frames ✓" when data is available
4. Use the **DWPose ← Blend → NLF** slider:
   - **0** — DWPose only (standard view)
   - **0.5** — both overlaid (purple ghost + normal skeleton)
   - **1** — NLF only (pure 3D overlay)

If no NLF model is connected, the status shows "not available" and the slider has no effect. The editor works normally without any NLF node in the workflow.

---

*Magos Digital Studio — built for WanAnimate video generation workflows*
