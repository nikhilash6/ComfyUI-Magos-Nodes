# Magos Nodes — User Manual

**ComfyUI Custom Node Pack by Magos Digital Studio**
**DWPose + NLF skeleton editor, retargeter, and renderer for any pose-driven ComfyUI workflow.**

*Note: this manual was written by an AI (Claude) by reading the source code of every node in the pack. If any behaviour described here differs from what you see in ComfyUI, the code is authoritative — please file an issue.*

> **Scope:** the Extractor / Editor / Renderer work with both DWPose (2D body + hands + face) and NLF (3D SMPL body) data. The **Cluster Retargeter operates on DWPose only** — NLF body data passes through it unchanged. Edit and animate NLF freely in the Editor; reshape proportions only on DWPose.

The pack outputs standard ComfyUI types (`IMAGE`, `POSE_KEYPOINT`, `BBOX`) plus the WanAnimatePreprocess `POSEDATA` type, so it drives WanAnimate, ControlNet (OpenPose / DWPose), SCAIL, LTX-Video, UniAnimate, and any other pose-conditioned model.

---

## Table of Contents

1. [Magos DWP Extractor](#1-magos-dwp-extractor)
2. [Magos DWP Editor](#2-magos-dwp-editor)
   - [Opening the Editor](#opening-the-editor)
   - [Viewports](#viewports)
   - [Front / Back View](#front--back-view)
   - [Orbit View (3D)](#orbit-view-3d)
   - [Top / Side View](#top--side-view)
   - [Camera View](#camera-view)
   - [DWPose / NLF Mode Toggle](#dwpose--nlf-mode-toggle)
   - [Add Hand](#add-hand)
   - [New Scene](#new-scene)
   - [IK Mode](#ik-mode)
   - [Reference Overlay](#reference-overlay)
   - [Layer Panel](#layer-panel)
   - [Graph Editor](#graph-editor)
   - [Dope Sheet](#dope-sheet)
   - [Transport & Playback](#transport--playback)
   - [Keyframe Controls](#keyframe-controls)
   - [Ref Frame](#ref-frame)
   - [Save / Load / Apply](#save--load--apply)
   - [Keyboard Shortcuts](#keyboard-shortcuts)
   - [Outputs](#outputs)
3. [Magos DWP Renderer](#3-magos-dwp-renderer)
4. [Magos Pose Retargeter](#4-magos-pose-retargeter)
5. [Wan Ratio & FPS](#5-wan-ratio--fps)
6. [WanAnimate Sampler Presets](#6-wanimate-sampler-presets)
7. [Data Types](#7-data-types)
8. [Workflow Examples](#8-workflow-examples)
9. [NLF 3D Integration](#9-nlf-3d-integration)

---

## 1. Magos DWP Extractor

Detects body, hand, and face keypoints from a video frame batch using YOLO + ViTPose (the same models as WanAnimatePreprocess). Optionally runs NLF 3D pose estimation for depth data. Outputs raw `KEYFRAME_DATA` for the editor and `POSEDATA` for direct use.

### Inputs

| Input | Type | Description |
|---|---|---|
| `images` | IMAGE | Video frame batch (B, H, W, C) |
| `model` | POSEMODEL | Pose detection model from WanAnimatePreprocess |

### Parameters

| Parameter | Default | Description |
|---|---|---|
| `vitpose_model` | — | ViTPose ONNX model from `ComfyUI/models/detection` |
| `yolo_model` | — | YOLO ONNX model from `ComfyUI/models/detection` |
| `nlf_model` | (None) | NLF `.safetensors` from `ComfyUI/models/nlf/`. Select `(None)` to skip 3D estimation. Requires ComfyUI-SCAIL-Pose |
| `onnx_device` | CUDA | Device to run ONNX models on |
| `detect_hands` | On | Enable 21-point hand keypoint detection |
| `detect_face` | On | Enable 70-point face landmark detection |
| `detect_head` | On | Include head keypoints (nose, eyes, ears). Disable to zero out head confidence |
| `confidence_threshold` | 0.3 | Minimum keypoint confidence to accept |
| `person_index` | 0 | Which detected person to track (0 = largest bounding box) |
| `output_width` | 0 | Rescale keypoint X coordinates to this width. 0 = use source width |
| `output_height` | 0 | Rescale keypoint Y coordinates to this height. 0 = use source height |
| `face_padding` | 20 | Padding (pixels) around the face crop region |
| `debug_log` | Off | When on, writes a per-run trace to the console and `logs/session_*.log` |

### Outputs

| Output | Type | Description |
|---|---|---|
| `keyframe_data` | KEYFRAME_DATA | Full skeleton data — feed into Magos DWP Editor |
| `pose_data` | POSEDATA | Direct pose output — feed into Retargeter or Renderer |
| `face_images` | IMAGE | Cropped face region per frame (pixel crop of the actual video, not a skeleton) |
| `bboxes` | BBOX | Person bounding boxes per frame |
| `facebboxes` | BBOX | Face bounding boxes — compatible with SAM2Segmentation |
| `nlf_model` | NLF_MODEL | Loaded NLF pipeline (pass-through to Editor if running NLF at edit time) |

### Notes

- If no person is detected on a frame, the last valid detection is carried forward automatically.
- All detected frames are baked into `overrides` in the KEYFRAME_DATA, so every frame shows as a keyframe diamond in the editor timeline.
- When an NLF model is selected, 3D SMPL joint data is stored alongside DWPose data. The editor auto-bakes this as editable `nlf_body` joints when it opens.

---

## 2. Magos DWP Editor

A full-screen interactive editor that opens as a pop-up overlay inside ComfyUI. All edits are stored in the node widget and survive workflow saves and ComfyUI restarts.

> **Run the workflow at least once before opening the editor** — it needs the Extractor to have processed frames first.

The editor **automatically resets** when footage changes (different resolution or frame count).

### Node Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `keyframe_data` | KEYFRAME_DATA | Yes | Skeleton data from the Extractor (or any compatible source) |
| `source_images` | IMAGE | No | Original video frames — used as the editor canvas backdrop |
| `editor_state_json` | STRING | No (auto) | Internal — the editor widget writes its state here; do not edit manually |
| `nlf_model` | NLF_MODEL | No | Pass-through from the Extractor; lets the editor re-run NLF on edits if needed |
| `render` | enum | No | Output projection mode (see below) |
| `export_format` | enum | No | `dwpose` (default) outputs the standard DWPose pose data; `nlf_3d` swaps in NLF body data |
| `debug_log` | BOOLEAN | No | Write a timestamped trace to `logs/` per run |

### Render Modes

The `render` widget controls how `pose_data` is projected on output:

| Mode | Behaviour |
|---|---|
| **Editor Front** (default) | Flat 2D front view — POSEDATA equals the edited skeleton in pixel space |
| **Editor Camera** | Perspective projection through the animated camera keyframes |
| **Editor Camera Ortho** | Parallel (orthographic) projection through the animated camera |
| **Retargeter** | Leaves the skeleton unprojected; wire `pose_data` + `keyframe_data` + `camera_matrices` into the **Magos Pose Retargeter** to apply 2D cluster transforms in front-space before camera projection (avoids "transform a perspective photo" artefacts) |

Legacy render strings (`Front`, `Camera Perspective`, `Camera Orthographic`) from older workflows are auto-mapped to the new names — old graphs keep working.

### Opening the Editor

Click **"Open Temporal Editor"** on the node. The editor opens as a full-screen overlay. Press **F1** at any time to open the help panel with a full shortcut reference.

---

### Viewports

The editor supports up to four simultaneous viewports. **Click any viewport's header bar** to open a dropdown and choose from six view types:

| View | Description |
|---|---|
| **Front** | Standard 2D front-facing skeleton |
| **Back** | Mirrored front view (camera behind subject) |
| **Top** | Overhead projection — shows X/Z depth layout |
| **Side** | Lateral projection — shows Z/Y depth layout |
| **Orbit** | Interactive 3D view (Three.js) — drag to rotate |
| **Camera** | View through the animated camera; follows camera keyframes |

By default, a single front viewport fills the canvas. Enable **⬡ Turn to 3D** in the sidebar to switch to a four-viewport layout (Front, Orbit, Camera, Side).

---

### Front / Back View

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

### Orbit View (3D)

The Orbit viewport shows a real-time Three.js 3D scene. DWPose and NLF skeletons are rendered as cylinders and spheres.

- **Drag a joint horizontally** — adjusts its Z-depth (positive = closer to camera)
- **Drag a joint vertically** — adjusts Y position
- **Drag axis labels / empty canvas** — rotate the 3D scene
- **Scroll / middle-drag** — zoom and pan
- When multiple joints are selected, dragging moves the entire cluster

Z-depth controls draw order in the renderer: joints with higher Z are drawn on top of lower-Z joints.

**DWPose Opacity** and **NLF Overlay Opacity** sliders (with eye toggles) control visibility of each skeleton layer independently. Click the **👁 eye icon** next to a slider to toggle that layer on/off without changing the slider value.

---

### Top / Side View

Orthographic projections of the skeleton:
- **Top** — bird's-eye view; horizontal axis = X, vertical axis = Z-depth
- **Side** — lateral view; horizontal axis = Z-depth, vertical axis = Y

Drag joints in Top/Side views to adjust depth relationships. These views are especially useful for checking Z-depth spread without needing the 3D orbit.

---

### Camera View

Renders the scene as seen through the animated camera. Camera position, rotation, and FOV are driven by camera keyframes set in the Dope Sheet.

- **Lock Camera to View** — enables orbit-drag in the Camera viewport to directly set the camera pose and write keyframes
- The camera path spline is drawn in all other views for reference
- A **Camera** layer appears automatically in the Dope Sheet as soon as 3D mode is enabled

---

### DWPose / NLF Mode Toggle

The editor tab bar contains **DWPose** and **NLF** buttons. Clicking one switches both the Dope Sheet and Graph Editor to show the corresponding data:

- **DWPose** — shows body (20 joints), hands (21 pts each), face (70 landmarks); all standard editing applies
- **NLF** — shows the 18 SMPL joints from NLF 3D estimation; fully editable with keyframes, graph curves, gizmo, and drag

The **📊 Edit NLF Data** button in the sidebar (NLF section) also switches to NLF mode directly.

The NLF mode is only available when NLF data was produced by the Extractor (i.e. an NLF model was selected).

---

### Add Hand

If the detected skeleton has no hand data for a frame (or you want to add a second hand), use **＋ Add ▾ → Hand** in the sidebar.

1. Click **＋ Add ▾** to open the add menu
2. Click **＋ Hand** to reveal the side chooser
3. Click **＋ Right** or **＋ Left**

A default hand pose (open palm) is synthesized at the wrist position. All 21 finger joints are placed as overrides and can be dragged normally. Enable **IK** to move the entire hand together.

---

### New Scene

**File → New Scene…** opens a dialog to create a blank T-pose scene from scratch (no video required).

Options:
- **Frame count** and **canvas size**
- **Include face** checkbox — when enabled, adds 70 face landmark joints in a default position

Use this when you want to animate a pose from scratch rather than from detected video.

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

The right-side panel lists all joints grouped by body part: Body, Right Hand, Left Hand, Face (70 landmarks), and NLF Body (when in NLF mode).

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

The Dope Sheet automatically switches content when you toggle between DWPose and NLF modes.

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

### Ref Frame

The **⊕ Ref Frame** button (far left of the action row) creates a clean, camera-immune reference snapshot of frame 0's raw detection. This snapshot is stored separately from the main sequence and is never affected by camera transforms you apply in 3D mode.

**Why it exists:** When you enable 3D mode and set a camera angle, frame 0 of the main sequence becomes camera-projected (potentially distorted or angled). The Ref Frame always stays in its original front-view 2D form — making it a reliable skeleton reference for the Retargeter regardless of what the camera does to the sequence.

**How to use it:**

1. Click **⊕ Ref Frame** — a green banner appears and the viewport shows frame 0 in its original front-view detection.
2. Drag any joints that are badly detected (e.g., fix flying legs in a medium shot).
3. Click **✕ Exit Ref Frame** (same button) to return to normal editing.
4. Click **Apply Changes** to save the ref frame fixes.

**In Ref Frame mode:**
- Only frame 0's raw detection is shown — no interpolation, no camera projection.
- Dragging joints writes to the Ref Frame's own override store, separate from the main sequence overrides. Camera-related joints are excluded.
- The Dope Sheet and Graph Editor are not active in this mode.

**Connecting to the Retargeter:**
1. Connect `keyframe_data` from the Editor to the Retargeter's `keyframe_data` input.
2. Set **Reference Source = Ref Frame** on the Retargeter.
3. The Retargeter's preview panel now shows the ref frame skeleton for slider calibration.
4. The new **ref_frame_pose** output from the Retargeter contains the ref frame with all cluster transforms applied — wire it to a Renderer to preview the retargeted reference.

---

### Save / Load / Apply

- **💾 Save** — downloads the current editor state (overrides, Z-depth, smoothing, interpolation, Ref Frame fixes) as a `.json` file
- **📂 Load** — loads a previously saved `.json` project file
- **Apply Changes** — syncs the editor state to the ComfyUI node widget; re-queuing the workflow bakes all edits

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
| `keyframe_data` | KEYFRAME_DATA | Edited skeleton data with all overrides, Z-depth, smoothing, and Ref Frame baked in |
| `pose_data` | POSEDATA | Converted output compatible with Magos Pose Retargeter and DWPose renderer |
| `camera_matrices` | CAMERA_MATRICES | Per-frame extrinsic + intrinsic matrices derived from camera keyframes |
| `nlf_pred` | NLFPRED | NLF 3D joint data in SCAIL-Pose format — feed into NLF-aware renderer nodes |

---

## 3. Magos DWP Renderer

Renders skeleton data into a colored image batch. Drop-in replacement for DrawViTPose, with Z-depth sorting, a separate face output, and an optional NLF-only render mode.

### Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `pose_data` | POSEDATA | Yes | Skeleton coordinates — from the Editor or Retargeter |
| `keyframe_data` | KEYFRAME_DATA | No | Used for Z-depth values. Omit to render without depth sorting |
| `nlf_poses` | NLFPRED | No | NLF 3D joint data from the Editor; enables NLF render mode |
| `draw_face_on_pose` | BOOLEAN | No | Composite face landmarks onto `pose_images` as well. Default: Off |
| `pose_draw` | BOOLEAN | No | Use WanAnimatePreprocess's ellipse-style bone rendering when available (matches DrawViTPose output exactly). Default: Off — falls back to Magos line-style bones |
| `nlf_render_mode` | BOOLEAN | No | **NLF Render**: replaces the DWPose body bones with the NLF skeleton (purple). **DWPose Render** (default): renders DWPose body bones normally. Hands and face are always drawn from DWPose data. Only meaningful when `nlf_poses` is connected |
| `debug_log` | BOOLEAN | No | Write a timestamped trace to `logs/` per run |

### Outputs

| Output | Type | Description |
|---|---|---|
| `pose_images` | IMAGE | Body skeleton + hands on black background |
| `face_images` | IMAGE | Face landmarks only on black background |
| `pose_keypoints` | POSE_KEYPOINT | ControlNet-aux standard format (18-pt body, 70-pt face, 21-pt hands per frame) |
| `nlf_images` | IMAGE | NLF skeleton rendered in purple on black background (empty frames when NLF not connected) |

### Rendering Details

- Body connections are Z-depth sorted: bones with higher Z are drawn first so nearer bones appear on top.
- Hands are drawn on top of the body (right hand = orange, left hand = green).
- Face landmarks go to `face_images`. Enable `draw_face_on_pose` to also composite them onto `pose_images`.
- Keypoints with confidence below **0.5** are not rendered.
- Output: `(B, H, W, 3)` float32 tensor, values 0–1.

### NLF Render Mode

When `nlf_poses` is connected and **NLF Render** is toggled on, `pose_images` replaces the DWPose body bones with the NLF skeleton (purple, OpenPose-18 layout). Hands and face landmarks are still drawn from DWPose. `nlf_images` always contains the NLF skeleton on a separate output regardless of this toggle.

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

Applies per-cluster geometric transforms (scale, offset, rotation) to **DWPose** skeleton data across all frames. Useful for adapting a captured performance to a different character or canvas size.

> **DWPose only.** The Retargeter transforms DWPose body / hand / face keypoints. NLF 3D body data is not reshaped here — animate or correct NLF in the Editor's NLF tab instead.

### Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `pose_data` | POSEDATA | Yes | Skeleton to retarget |
| `reference_image` | IMAGE | No | Background image for visual calibration in the canvas |
| `source_images` | IMAGE | No | Source video frames for the canvas frame preview |
| `face_images` | IMAGE | No | Face pixel crops from the Extractor — transformed with face cluster settings |
| `keyframe_data` | KEYFRAME_DATA | No | Editor output — enables Ref Frame preview, `ref_frame_pose` output, and per-joint Z values for camera-aware projection |
| `camera_matrices` | CAMERA_MATRICES | No | Editor camera path — when wired, the retargeter applies 2D cluster transforms in front-space and then projects through the camera per frame |
| `camera_projection` | enum | No | `Perspective` (default) or `Orthographic` — only used when `camera_matrices` is connected |
| `micro_offsets_json` | STRING | No | Per-joint fine-tune offsets (managed by the canvas UI; not edited by hand) |
| `disabled_points_json` | STRING | No | Joints disabled in the canvas UI |
| `default_hands_json` | STRING | No | Default hand pose when hands are absent |
| `debug_log` | BOOLEAN | No | Write a timestamped trace to `logs/` per run |

### Global Controls

| Parameter | Default | Description |
|---|---|---|
| `global_scale` | 1.0 | Uniform scale applied to the whole skeleton |
| `global_offset_x/y` | 0 | Pixel offset applied after all other transforms |
| `reference_frame_index` | 0 | Which video frame to display in the canvas when Reference Source = Frame Index |
| `reference_source` | Frame Index | **Frame Index**: use `reference_frame_index` for the preview. **Ref Frame**: use the Editor's ⊕ Ref Frame snapshot (requires `keyframe_data` connected) |
| `transfer_face` | On | Include face landmark transforms in output |

### Cluster Controls

Each cluster (Torso, Head, Right Arm, Left Arm, Right Leg, Left Leg) has:

| Control | Description |
|---|---|
| `{cluster}_scale_x/y` | Scale the cluster around its root joint |
| `{cluster}_offset_x/y` | Pixel offset of the cluster after scaling |
| `{cluster}_rotation` | Rotation around the root joint (degrees) |

**Root joints:** Torso = hip center, Head = neck, Right/Left Arm = shoulders, Right/Left Leg = hips.

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
| `ref_frame_pose` | POSEDATA | Ref frame with the same cluster transforms applied — wire to a Renderer to preview the retargeted reference. Only populated when `keyframe_data` is connected and contains a Ref Frame |

### Ref Frame Workflow

1. In the Editor, click **⊕ Ref Frame**, clean up badly detected joints, then click **Apply Changes**.
2. Connect `keyframe_data` from the Editor to the Retargeter's `keyframe_data` input.
3. Set **Reference Source = Ref Frame** on the Retargeter.
4. Tune the cluster sliders — the preview panel shows the clean ref frame skeleton.
5. Optionally wire `ref_frame_pose` → Renderer to see the retargeted ref frame as a rendered pose image.

### Camera-aware Retargeting

When the Editor uses an animated camera, retargeting in front-space and then projecting through the camera produces correct results — retargeting after the camera projection ("transforming a perspective photo") distorts limbs.

1. In the Editor, set **render = "Retargeter"** so `pose_data` stays unprojected.
2. Wire `pose_data`, `keyframe_data`, and `camera_matrices` from the Editor into the Retargeter.
3. Choose `camera_projection` (Perspective or Orthographic) to match the Editor's camera type.
4. The Retargeter applies cluster transforms in 2D front-space, then projects each frame through the per-frame camera matrix, using Z values from `keyframe_data`.

If `camera_matrices` is not connected, the Retargeter ignores `camera_projection` and behaves as a plain 2D transformer (existing behaviour for non-camera workflows).

---

## 5. Wan Ratio & FPS

Outputs Mod-16 compliant resolution dimensions and frame rate. Designed around WanAnimate's Mod-16 requirement, but the `width` / `height` / `fps` outputs are plain `INT` / `INT` / `FLOAT` and work anywhere those types are accepted.

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

Internal format used between the Extractor, Editor, and Retargeter. Contains:
- `frames` — per-frame skeleton data in pixel coordinates (body 20 pts, hands 21 pts each, face 70 pts)
- `overrides` — manual edits: `{frame_index: {label: [x, y, conf, z]}}`
- `ref_frame` — clean front-view snapshot of frame 0 with ref frame overrides applied (present when ⊕ Ref Frame has been used and Apply Changes clicked)
- `tweens` — per-keyframe interpolation mode overrides
- `smooth_window` — Gaussian smoothing window size
- `frame_count`, `width`, `height`
- `nlf_frames` — SMPL 3D joint data per frame (present when NLF model was used in Extractor)

### POSEDATA

Compatible with WanAnimatePreprocess's DrawViTPose and Magos Pose Retargeter. A list of per-frame skeleton objects with pixel-coordinate keypoints.

### POSE_KEYPOINT

ControlNet-aux standard format. A list of one dict per frame, each containing:
- `people[0].pose_keypoints_2d` — 18 body keypoints in OpenPose format `[x, y, confidence]`
- `people[0].face_keypoints_2d` — 70 face landmarks
- `people[0].hand_left_keypoints_2d` / `hand_right_keypoints_2d` — 21 keypoints per hand
- `canvas_width`, `canvas_height`

Compatible with `DWPose Preprocessor Visualizer` and any ControlNet pose node.

### NLFPRED

NLF 3D joint data in SCAIL-Pose format: `{'joints3d_nonparam': [frame_tensors]}` where each frame tensor is `[n_persons, 24, 3]` float32 in millimetres (camera space). Feed into SCAIL-Pose compatible NLF renderer nodes.

### CAMERA_MATRICES

Per-frame camera transform data derived from camera keyframes in the Editor:
- `extrinsics` — `[N, 4, 4]` float32 camera-to-world transform matrices
- `intrinsics` — `[N, 3, 3]` float32 pinhole camera intrinsic matrices
- `fovs` — `[N]` float32 field-of-view values in degrees
- `frame_count`, `width`, `height`

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
    │ pose_images               (or pose_keypoints → ControlNet)
    ▼
[WanAnimate / SCAIL / LTX / UniAnimate / KSampler]
```

### With Retargeting + Ref Frame  *(DWPose only)*

```
[Magos DWP Editor]
    │ keyframe_data ──────────────────────────────────┐
    │ pose_data                                       │
    ▼                                                 ▼
[Magos Pose Retargeter] ←─── keyframe_data ──────────┘
    │ modified_pose_data          (Reference Source = Ref Frame)
    │ ref_frame_pose
    ▼
[Magos DWP Renderer]
    │ pose_images
    ▼
[any pose-conditioned model]
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

### NLF Render

```
[Magos DWP Editor]
    │ pose_data    │ nlf_poses
    ▼              ▼
[Magos DWP Renderer]  (NLF Render = On)
    │ pose_images  ← NLF body bones (purple) + DWPose hands/face
    │ nlf_images   ← NLF skeleton always
    ▼
[any pose-conditioned model]
```

---

## 9. NLF 3D Integration

NLF (Neural Localizer Fields) estimates 3D SMPL body joints from video frames. The data is integrated directly into the Extractor and fully editable in the Editor — no separate NLF node is needed.

### Setup

1. Install [ComfyUI-SCAIL-Pose](https://github.com/kijai/ComfyUI-SCAIL-Pose)
2. Place an NLF `.safetensors` model file in `ComfyUI/models/nlf/`
3. On the **Magos DWP Extractor** node, select the model in the **nlf_model** dropdown
4. Run the workflow — NLF inference runs alongside DWPose and caches the result

### Editing NLF Data

Once extracted, NLF data is available in the Editor:

- Click the **NLF** tab in the editor tab bar to switch the Dope Sheet and Graph Editor to NLF mode
- The 18 SMPL joints appear as editable rows — drag, keyframe, graph, and gizmo all work the same as DWPose
- Click **DWPose** to return to standard editing

### Viewport Display

- **NLF Overlay Opacity** slider — blends the purple NLF skeleton in all viewports; click the **👁** eye icon to toggle without changing the slider value
- **DWPose Opacity** slider — controls the white/colored DWPose skeleton visibility independently
- Enable **⬡ Turn to 3D** to switch to a four-viewport layout (Front, Orbit, Camera, Side) with the 3D renderer showing both skeletons

### Baking NLF Depth into DWPose

**⬇ Bake Z Depth** writes the NLF-estimated Z values into the DWPose body joints for every frame. This gives the standard renderer Z-depth sorting based on real 3D data. DWPose XY positions are unchanged — only depth is updated.

### Rendering NLF

Connect `nlf_pred` from the Editor to the Renderer's `nlf_poses` input. Two options:

- **DWPose Render** (default) — renders the DWPose skeleton normally; NLF is available in `nlf_images` only
- **NLF Render** — `pose_images` outputs the NLF skeleton (purple) instead of DWPose; useful for workflows that need NLF-projected poses as the primary output

### Z Normalization

NLF joint depths are automatically normalized per frame to ±0.5 editor units so the skeleton always fills the 3D view at a consistent scale, regardless of the subject's distance from the camera.

### Without NLF

If `(None)` is selected in the nlf_model dropdown, no 3D estimation is performed. The editor works normally — the NLF tab, overlay slider, and Bake Z Depth button simply have no effect.

---

*Magos Digital Studio — built for WanAnimate video generation workflows*

---

*This manual was generated by an AI (Claude) by reading the source code of every node in the pack. Report any inaccuracies via GitHub issues.*
