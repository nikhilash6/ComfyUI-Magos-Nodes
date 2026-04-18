/**
 * Magos Pose Retargeter — Interactive Canvas Extension
 * Cluster-based pose editor for WanAnimate. Part of the Magos Nodes pack.
 * Author: Eli Rezik / Magos Digital Studio
 */

import { app } from "../../../scripts/app.js";

// DWPose Keypoint Indices
const KEYPOINTS = {
    NOSE: 0,
    NECK: 1,
    R_SHOULDER: 2,
    R_ELBOW: 3,
    R_WRIST: 4,
    L_SHOULDER: 5,
    L_ELBOW: 6,
    L_WRIST: 7,
    R_HIP: 8,
    R_KNEE: 9,
    R_ANKLE: 10,
    L_HIP: 11,
    L_KNEE: 12,
    L_ANKLE: 13,
    R_EYE: 14,
    L_EYE: 15,
    R_EAR: 16,
    L_EAR: 17,
    L_TOE: 18,
    R_TOE: 19
};

// OpenPose Hand Connections (21 points, 5 fingers)
// Format: [startIdx, endIdx, color]
const HAND_CONNECTIONS = {
    // Right hand (red tones)
    R_THUMB: [[0, 1], [1, 2], [2, 3], [3, 4]],
    R_INDEX: [[0, 5], [5, 6], [6, 7], [7, 8]],
    R_MIDDLE: [[0, 9], [9, 10], [10, 11], [11, 12]],
    R_RING: [[0, 13], [13, 14], [14, 15], [15, 16]],
    R_PINKY: [[0, 17], [17, 18], [18, 19], [19, 20]],
    // Palm connections
    R_PALM: [[0, 5], [5, 9], [9, 13], [13, 17]]
};

const L_HAND_CONNECTIONS = {
    L_THUMB: [[0, 1], [1, 2], [2, 3], [3, 4]],
    L_INDEX: [[0, 5], [5, 6], [6, 7], [7, 8]],
    L_MIDDLE: [[0, 9], [9, 10], [10, 11], [11, 12]],
    L_RING: [[0, 13], [13, 14], [14, 15], [15, 16]],
    L_PINKY: [[0, 17], [17, 18], [18, 19], [19, 20]],
    L_PALM: [[0, 5], [5, 9], [9, 13], [13, 17]]
};

// Skeleton connections with colors (RGB format)
const SKELETON_CONNECTIONS = [
    // Torso
    [KEYPOINTS.NECK, KEYPOINTS.R_SHOULDER, "#FF0000"],
    [KEYPOINTS.NECK, KEYPOINTS.L_SHOULDER, "#00FF00"],
    [KEYPOINTS.R_SHOULDER, KEYPOINTS.R_ELBOW, "#FF0000"],
    [KEYPOINTS.L_SHOULDER, KEYPOINTS.L_ELBOW, "#00FF00"],
    [KEYPOINTS.R_ELBOW, KEYPOINTS.R_WRIST, "#FF0000"],
    [KEYPOINTS.L_ELBOW, KEYPOINTS.L_WRIST, "#00FF00"],
    // Spine to hips
    [KEYPOINTS.NECK, KEYPOINTS.R_HIP, "#FFFF00"],
    [KEYPOINTS.NECK, KEYPOINTS.L_HIP, "#FF00FF"],
    // Legs
    [KEYPOINTS.R_HIP, KEYPOINTS.R_KNEE, "#FFFF00"],
    [KEYPOINTS.L_HIP, KEYPOINTS.L_KNEE, "#FF00FF"],
    [KEYPOINTS.R_KNEE, KEYPOINTS.R_ANKLE, "#FFFF00"],
    [KEYPOINTS.L_KNEE, KEYPOINTS.L_ANKLE, "#FF00FF"],
    [KEYPOINTS.R_ANKLE, KEYPOINTS.R_TOE, "#FFFF00"],
    [KEYPOINTS.L_ANKLE, KEYPOINTS.L_TOE, "#FF00FF"],
    // Head
    [KEYPOINTS.NECK, KEYPOINTS.NOSE, "#0000FF"],
    [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, "#0000FF"],
    [KEYPOINTS.NOSE, KEYPOINTS.L_EYE, "#0000FF"],
    [KEYPOINTS.R_EYE, KEYPOINTS.R_EAR, "#0000FF"],
    [KEYPOINTS.L_EYE, KEYPOINTS.L_EAR, "#0000FF"],
];

// Cluster definitions with widget mappings (Full Freedom - Independent widgets)
const CLUSTERS = {
    GLOBAL: {
        points: [KEYPOINTS.NECK, KEYPOINTS.R_SHOULDER, KEYPOINTS.L_SHOULDER, KEYPOINTS.R_HIP, KEYPOINTS.L_HIP],
        anchor: null,
        scaleWidgets: ["global_scale"],
        offsetWidgets: ["global_offset_x", "global_offset_y"],
        rotationWidget: null,
        mirrorCluster: null
    },
    HEAD: {
        points: [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, KEYPOINTS.L_EYE, KEYPOINTS.R_EAR, KEYPOINTS.L_EAR],
        anchor: KEYPOINTS.NECK,
        scaleWidgets: ["head_scale_x", "head_scale_y"],
        offsetWidgets: ["head_offset_x", "head_offset_y"],
        rotationWidget: "head_rotation",
        mirrorCluster: null
    },
    TORSO: {
        points: [KEYPOINTS.NECK, KEYPOINTS.R_SHOULDER, KEYPOINTS.L_SHOULDER, KEYPOINTS.R_HIP, KEYPOINTS.L_HIP],
        anchor: null,
        scaleWidgets: ["torso_scale_x", "torso_scale_y"],
        offsetWidgets: ["torso_offset_x", "torso_offset_y"],
        rotationWidget: "torso_rotation",
        mirrorCluster: null
    },
    RIGHT_ARM: {
        points: [KEYPOINTS.R_ELBOW, KEYPOINTS.R_WRIST],
        anchor: KEYPOINTS.R_SHOULDER,
        scaleWidgets: ["right_arm_scale_x", "right_arm_scale_y"],
        offsetWidgets: ["right_arm_offset_x", "right_arm_offset_y"],
        rotationWidget: "right_arm_rotation",
        mirrorCluster: "LEFT_ARM"
    },
    LEFT_ARM: {
        points: [KEYPOINTS.L_ELBOW, KEYPOINTS.L_WRIST],
        anchor: KEYPOINTS.L_SHOULDER,
        scaleWidgets: ["left_arm_scale_x", "left_arm_scale_y"],
        offsetWidgets: ["left_arm_offset_x", "left_arm_offset_y"],
        rotationWidget: "left_arm_rotation",
        mirrorCluster: "RIGHT_ARM"
    },
    RIGHT_LEG: {
        points: [KEYPOINTS.R_KNEE, KEYPOINTS.R_ANKLE, KEYPOINTS.R_TOE],
        anchor: KEYPOINTS.R_HIP,
        scaleWidgets: ["right_leg_scale_x", "right_leg_scale_y"],
        offsetWidgets: ["right_leg_offset_x", "right_leg_offset_y"],
        rotationWidget: "right_leg_rotation",
        mirrorCluster: "LEFT_LEG"
    },
    LEFT_LEG: {
        points: [KEYPOINTS.L_KNEE, KEYPOINTS.L_ANKLE, KEYPOINTS.L_TOE],
        anchor: KEYPOINTS.L_HIP,
        scaleWidgets: ["left_leg_scale_x", "left_leg_scale_y"],
        offsetWidgets: ["left_leg_offset_x", "left_leg_offset_y"],
        rotationWidget: "left_leg_rotation",
        mirrorCluster: "RIGHT_LEG"
    },
    FACE: {
        points: [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, KEYPOINTS.L_EYE, KEYPOINTS.R_EAR, KEYPOINTS.L_EAR],
        anchor: KEYPOINTS.NECK,
        scaleWidgets: ["face_scale_x", "face_scale_y"],
        offsetWidgets: ["face_offset_x", "face_offset_y"],
        rotationWidget: null,
        mirrorCluster: null
    }
};

// Body keypoint mirror pairs for GIZMO mode (idx → mirror idx)
const GIZMO_MIRROR_PAIRS = {
    2: 5,  5: 2,   // R_SHOULDER ↔ L_SHOULDER
    3: 6,  6: 3,   // R_ELBOW ↔ L_ELBOW
    4: 7,  7: 4,   // R_WRIST ↔ L_WRIST
    8: 11, 11: 8,  // R_HIP ↔ L_HIP
    9: 12, 12: 9,  // R_KNEE ↔ L_KNEE
    10: 13, 13: 10, // R_ANKLE ↔ L_ANKLE
    14: 15, 15: 14, // R_EYE ↔ L_EYE
    16: 17, 17: 16, // R_EAR ↔ L_EAR
    18: 19, 19: 18, // L_TOE ↔ R_TOE
};

// Default open-hand pose for right hand, relative to wrist at (0,0), y-down image coords.
// Reference length wrist→middle-tip ≈ 94 units; scale at runtime to match arm proportions.
const DEFAULT_RHAND_REL = [
    [  0,   0], // 0  wrist
    [ 22, -18], // 1  thumb CMC
    [ 36, -30], // 2  thumb MCP
    [ 48, -44], // 3  thumb IP
    [ 56, -54], // 4  thumb TIP
    [ 26, -58], // 5  index MCP
    [ 26, -74], // 6  index PIP
    [ 26, -84], // 7  index DIP
    [ 26, -91], // 8  index TIP
    [  8, -62], // 9  middle MCP
    [  7, -78], // 10 middle PIP
    [  7, -87], // 11 middle DIP
    [  7, -94], // 12 middle TIP
    [-10, -59], // 13 ring MCP
    [-11, -74], // 14 ring PIP
    [-11, -83], // 15 ring DIP
    [-11, -89], // 16 ring TIP
    [-24, -53], // 17 pinky MCP
    [-26, -65], // 18 pinky PIP
    [-26, -72], // 19 pinky DIP
    [-26, -77], // 20 pinky TIP
];
// Left hand is the mirror image (negate X)
const DEFAULT_LHAND_REL = DEFAULT_RHAND_REL.map(([x, y]) => [-x, y]);

class DWPosePreviewWidget {
    constructor(node) {
        this.node = node;
        this.origKps = null;
        this.origRHand = null;  // Original right hand keypoints (21 points)
        this.origLHand = null;  // Original left hand keypoints (21 points)
        this.referenceImage  = null;  // creature / target character image
        this.sourceFrameImage = null; // actor video frame at reference_frame_index
        this.activeBackground = "creature"; // "creature" | "source"
        this.poseWidth  = 512;  // actual pose frame dimensions
        this.poseHeight = 512;
        this.canvasWidth  = 512;  // canvas element size (== pose dims)
        this.canvasHeight = 512;
        this.dataLoaded = false;

        // Zoom / pan viewport state
        this.viewZoom    = 0.9;   // 0.9 = 5% ghost margin each side at default
        this.viewOffsetX = 512 * 0.05;
        this.viewOffsetY = 512 * 0.05;

        // Tracks which hands have been reset to the built-in default pose
        this._defaultedHands = new Set();
        
        // UI Mode: 'CLUSTER' or 'GIZMO'
        this.uiMode = 'GIZMO';

        // Face visualization toggle
        this.showFace = false;
        this.origFace = null;  // Original face landmarks
        
        // Micro-offsets for individual point editing
        this.microOffsets = { body: {}, lhand: {}, rhand: {}, face: {} };
        this.activePoint = null;  // { group: 'body'|'lhand'|'rhand'|'face', idx: number }

        // Disabled points — confidence will be zeroed in Python so DrawViTPose skips them
        this.disabledPoints = { body: new Set(), rhand: new Set(), lhand: new Set() };
        
        // Selection state
        this.activeCluster = null;
        this.dragMode = null; // 'MOVE' or 'SCALE' or 'GIZMO_DRAG'
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.dragStartValues = {};
        this.dragStartDist = 0;
        this.activeHandle = null; // 'tl', 'tr', 'bl', 'br'
        
        // Photoshop-style scale drag state
        this.dragStartMouse = { x: 0, y: 0 };
        this.dragStartScales = { x: 1.0, y: 1.0 };
        this.dragBoxSize = { w: 10, h: 10 };
        this.handleDir = { x: 1, y: 1 };

        // Rotation ring drag state
        this.rotatingHand      = null;
        this.rotatingCluster   = null;
        this.rotationCenter    = null;
        this.dragStartAngle    = 0;
        this.dragStartRotation = 0;

        // Mirror mode
        this.mirrorMode = false;

        // Custom input map — widget name → { range, num } pair (for control panel)
        this.customInputs = {};
        this.panelVisible = false;

        // Create main container
        this.container = document.createElement("div");
        this.container.className = "dwpose-preview-container";
        this.container.style.cssText = `
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px;
            background: #1e1e1e;
            border-radius: 4px;
        `;

        // Create toolbar
        this.toolbar = this.createToolbar();
        this.container.appendChild(this.toolbar);

        // Create collapsible control panel (starts hidden)
        this.controlPanel = this.createControlPanel();
        this.controlPanel.style.display = 'none';
        this.container.appendChild(this.controlPanel);

        // Create canvas
        this.canvas = document.createElement("canvas");
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        this.canvas.style.cssText = `
            width: 100%;
            height: auto;
            border: 1px solid #444;
            border-radius: 4px;
            cursor: default;
        `;
        this.ctx = this.canvas.getContext("2d");
        this.container.appendChild(this.canvas);
        
        // Bind events
        this.canvas.addEventListener("mousedown",   this.onMouseDown.bind(this));
        this.canvas.addEventListener("mousemove",   this.onMouseMove.bind(this));
        this.canvas.addEventListener("mouseup",     this.onMouseUp.bind(this));
        this.canvas.addEventListener("mouseleave",  this.onMouseUp.bind(this));
        this.canvas.addEventListener("contextmenu", this.onContextMenu.bind(this));
        this.canvas.addEventListener("wheel",       this.onWheel.bind(this), { passive: false });
        
        // Initial render
        this.render();
    }
    
    createToolbar() {
        const toolbar = document.createElement("div");
        toolbar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";

        this.modeToggleBtn = this.createButton("Mode: Point Gizmo", () => this.toggleUiMode());
        this.modeToggleBtn.style.background = "#6a2a2a";
        toolbar.appendChild(this.modeToggleBtn);

        this.toggleFaceBtn = this.createButton("Show Face", () => this.toggleFace());
        toolbar.appendChild(this.toggleFaceBtn);

        this.mirrorBtn = this.createButton("Mirror: Off", () => this.toggleMirror());
        toolbar.appendChild(this.mirrorBtn);

        toolbar.appendChild(this.createButton("Reset All",    () => this.resetAll()));
        toolbar.appendChild(this.createButton("Reset Points", () => this.resetMicroOffsets()));
        toolbar.appendChild(this.createButton("Fit View",     () => { this._fitView(); this.render(); }));

        this.bgToggleBtn = this.createButton("BG: Creature", () => this._toggleBackground());
        this.bgToggleBtn.style.background = "#2a4a6a";
        toolbar.appendChild(this.bgToggleBtn);

        this.controlsBtn = this.createButton("⚙ Controls", () => this.togglePanel());
        toolbar.appendChild(this.controlsBtn);

        return toolbar;
    }

    togglePanel() {
        this.panelVisible = !this.panelVisible;
        this.controlPanel.style.display = this.panelVisible ? 'block' : 'none';
        this.controlsBtn.style.background = this.panelVisible ? '#4a5a6a' : '#444';
        const newH = this.node.computeSize([this.node.size[0], 0]);
        this.node.setSize([this.node.size[0], newH[1]]);
        app.graph.setDirtyCanvas(true);
    }
    
    toggleUiMode() {
        if (this.uiMode === 'CLUSTER') {
            this.uiMode = 'GIZMO';
            this.modeToggleBtn.textContent = "Mode: Point Gizmo";
            this.modeToggleBtn.style.background = "#6a2a2a";  // Red for gizmo mode
        } else {
            this.uiMode = 'CLUSTER';
            this.modeToggleBtn.textContent = "Mode: Cluster Box";
            this.modeToggleBtn.style.background = "#2a6a2a";  // Green for cluster mode
        }
        this.activeCluster = null;
        this.activePoint = null;
        this.render();
    }
    
    toggleFace() {
        this.showFace = !this.showFace;
        this.toggleFaceBtn.textContent = this.showFace ? "Hide Face" : "Show Face";
        this.toggleFaceBtn.style.background = this.showFace ? "#2a6a6a" : "#444";
        this.render();
    }

    toggleMirror() {
        this.mirrorMode = !this.mirrorMode;
        this.mirrorBtn.textContent = this.mirrorMode ? "Mirror: On" : "Mirror: Off";
        this.mirrorBtn.style.background = this.mirrorMode ? "#4a3a6a" : "#444";
    }

    createButton(text, onClick) {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.style.cssText = `
            padding: 4px 8px;
            background: #444;
            color: #fff;
            border: 1px solid #666;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        `;
        btn.addEventListener("click", onClick);
        btn.addEventListener("mouseenter", () => btn.style.background = "#555");
        btn.addEventListener("mouseleave", () => btn.style.background = "#444");
        return btn;
    }
    
    getWidget(name) {
        return this.node.widgets?.find(w => w.name === name);
    }

    getWidgetValue(name, defaultValue) {
        const widget = this.getWidget(name);
        return widget ? widget.value : defaultValue;
    }

    setWidgetValue(name, value) {
        const widget = this.getWidget(name);
        if (widget) {
            widget.value = value;
            if (widget.callback) widget.callback(widget.value);
        }
        // Keep control panel inputs in sync
        const pair = this.customInputs?.[name];
        if (pair) {
            const isFloat = parseFloat(pair.range.step) < 1;
            pair.range.value = value;
            pair.num.value = isFloat ? parseFloat(value).toFixed(2) : String(Math.round(value));
        }
    }

    // ─── Collapsible control panel ────────────────────────────────────────────

    createControlPanel() {
        const CLUSTER_DEFS = [
            { label: 'Global', sw: [['Scale', 'global_scale', 0.1, 5, 0.05]],
              ow: [['Offset X', 'global_offset_x', -3000, 3000, 1], ['Offset Y', 'global_offset_y', -3000, 3000, 1]],
              rw: [],
              reset: null },
            { label: 'Torso',
              sw: [['Scale X', 'torso_scale_x', 0.1, 5, 0.05], ['Scale Y', 'torso_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'torso_offset_x', -3000, 3000, 1], ['Offset Y', 'torso_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'torso_rotation', -180, 180, 0.5]],
              reset: 'TORSO' },
            { label: 'Head',
              sw: [['Scale X', 'head_scale_x', 0.1, 5, 0.05], ['Scale Y', 'head_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'head_offset_x', -3000, 3000, 1], ['Offset Y', 'head_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'head_rotation', -180, 180, 0.5]],
              reset: 'HEAD' },
            { label: 'R.Arm',
              sw: [['Scale X', 'right_arm_scale_x', 0.1, 5, 0.05], ['Scale Y', 'right_arm_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'right_arm_offset_x', -3000, 3000, 1], ['Offset Y', 'right_arm_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'right_arm_rotation', -180, 180, 0.5]],
              reset: 'RIGHT_ARM' },
            { label: 'L.Arm',
              sw: [['Scale X', 'left_arm_scale_x', 0.1, 5, 0.05], ['Scale Y', 'left_arm_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'left_arm_offset_x', -3000, 3000, 1], ['Offset Y', 'left_arm_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'left_arm_rotation', -180, 180, 0.5]],
              reset: 'LEFT_ARM' },
            { label: 'R.Leg',
              sw: [['Scale X', 'right_leg_scale_x', 0.1, 5, 0.05], ['Scale Y', 'right_leg_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'right_leg_offset_x', -3000, 3000, 1], ['Offset Y', 'right_leg_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'right_leg_rotation', -180, 180, 0.5]],
              reset: 'RIGHT_LEG' },
            { label: 'L.Leg',
              sw: [['Scale X', 'left_leg_scale_x', 0.1, 5, 0.05], ['Scale Y', 'left_leg_scale_y', 0.1, 5, 0.05]],
              ow: [['Offset X', 'left_leg_offset_x', -3000, 3000, 1], ['Offset Y', 'left_leg_offset_y', -3000, 3000, 1]],
              rw: [['Rotation', 'left_leg_rotation', -180, 180, 0.5]],
              reset: 'LEFT_LEG' },
        ];

        const panel = document.createElement('div');
        panel.style.cssText = `width:100%;background:#252525;border:1px solid #383838;
            border-radius:4px;padding:5px 6px;box-sizing:border-box;font-size:11px;color:#bbb;`;

        const makeGroup = (title, params, onReset) => {
            const group = document.createElement('div');
            group.style.cssText = 'margin-bottom:3px;border:1px solid #333;border-radius:3px;overflow:hidden;';

            let expanded = false;
            const header = document.createElement('div');
            header.style.cssText = `display:flex;align-items:center;justify-content:space-between;
                padding:4px 7px;background:#2e2e2e;cursor:pointer;user-select:none;`;
            header.innerHTML = `<span style="font-weight:bold;color:#ccc;">${title}</span><span class="arrow" style="color:#666;font-size:9px;">▶</span>`;

            const body = document.createElement('div');
            body.style.cssText = 'display:none;padding:5px 7px 4px;background:#262626;';

            header.addEventListener('click', () => {
                expanded = !expanded;
                body.style.display = expanded ? 'block' : 'none';
                header.querySelector('.arrow').textContent = expanded ? '▼' : '▶';
            });

            for (const [lbl, wname, min, max, step] of params) {
                body.appendChild(this._makeParamRow(lbl, wname, min, max, step));
            }

            if (onReset) {
                const rb = document.createElement('button');
                rb.textContent = '↺ Reset ' + title;
                rb.style.cssText = 'margin-top:4px;padding:2px 7px;background:#333;color:#888;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:10px;width:100%;';
                rb.addEventListener('click', onReset);
                body.appendChild(rb);
            }

            group.appendChild(header);
            group.appendChild(body);
            return group;
        };

        for (const def of CLUSTER_DEFS) {
            const allParams = [...def.sw, ...def.ow, ...(def.rw || [])];
            const onReset = def.reset
                ? () => { this.resetCluster(def.reset); }
                : () => {
                    this.setWidgetValue('global_scale', 1.0);
                    this.setWidgetValue('global_offset_x', 0);
                    this.setWidgetValue('global_offset_y', 0);
                    this.render(); app.canvas.setDirty(true);
                };
            panel.appendChild(makeGroup(def.label, allParams, onReset));
        }

        // Face group — whole-face cluster (scale/offset applied to face_images pixel crops)
        const faceParams = [
            ['Scale X', 'face_scale_x', 0.1, 5, 0.05], ['Scale Y', 'face_scale_y', 0.1, 5, 0.05],
            ['Offset X', 'face_offset_x', -3000, 3000, 1], ['Offset Y', 'face_offset_y', -3000, 3000, 1],
        ];
        panel.appendChild(makeGroup('Face Image', faceParams, () => { this.resetCluster('FACE'); }));

        // Hand scale + rotation group
        const handParams = [
            ['R.Scale X',    'right_hand_scale_x',   0.1, 5,    0.05],
            ['R.Scale Y',    'right_hand_scale_y',   0.1, 5,    0.05],
            ['R.Rotation',   'right_hand_rotation', -180, 180,  0.5 ],
            ['L.Scale X',    'left_hand_scale_x',    0.1, 5,    0.05],
            ['L.Scale Y',    'left_hand_scale_y',    0.1, 5,    0.05],
            ['L.Rotation',   'left_hand_rotation',  -180, 180,  0.5 ],
        ];
        const handGroup = makeGroup('Hands', handParams, () => {
            for (const name of ['right_hand_scale_x','right_hand_scale_y','left_hand_scale_x','left_hand_scale_y'])
                this.setWidgetValue(name, 1.0);
            for (const name of ['right_hand_rotation','left_hand_rotation'])
                this.setWidgetValue(name, 0.0);
            this.render(); app.canvas.setDirty(true);
        });
        // Append Default buttons inside the group body (second child)
        const handBody = handGroup.children[1];
        const defaultRow = document.createElement('div');
        defaultRow.style.cssText = 'display:flex;gap:4px;margin-top:4px;';
        const mkDefaultBtn = (label, side) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'flex:1;padding:2px 4px;background:#1a3a4a;color:#88ccee;border:1px solid #2a6080;border-radius:3px;cursor:pointer;font-size:10px;';
            b.addEventListener('click', () => this._applyDefaultHand(side));
            return b;
        };
        defaultRow.appendChild(mkDefaultBtn('R. Default', 'right'));
        defaultRow.appendChild(mkDefaultBtn('L. Default', 'left'));
        handBody.appendChild(defaultRow);
        panel.appendChild(handGroup);

        return panel;
    }

    _makeParamRow(label, widgetName, min, max, step) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:4px;';

        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'color:#888;font-size:10px;min-width:52px;flex-shrink:0;';

        row.appendChild(lbl);
        row.appendChild(this._makeInputPair(widgetName, min, max, step));
        return row;
    }

    _makeInputPair(widgetName, min, max, step) {
        const isFloat = step < 1;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1;';

        const range = document.createElement('input');
        range.type = 'range';
        range.min = min; range.max = max; range.step = step;
        range.value = isFloat ? 1 : 0;
        range.style.cssText = 'flex:1;min-width:0;cursor:pointer;accent-color:#5a8a5a;';

        const num = document.createElement('input');
        num.type = 'number';
        num.min = min; num.max = max; num.step = step;
        num.value = isFloat ? '1.00' : '0';
        num.style.cssText = 'width:54px;flex-shrink:0;background:#2a2a2a;color:#ddd;border:1px solid #444;' +
            'border-radius:3px;padding:1px 3px;font-size:10px;box-sizing:border-box;text-align:right;';

        const apply = (v) => {
            const clamped = Math.max(min, Math.min(max, v));
            range.value = clamped;
            num.value = isFloat ? clamped.toFixed(2) : String(Math.round(clamped));
            this.setWidgetValue(widgetName, clamped);
            this.render();
            app.canvas.setDirty(true);
        };
        range.addEventListener('input', () => { const v = parseFloat(range.value); if (!isNaN(v)) apply(v); });
        num.addEventListener('input',   () => { const v = parseFloat(num.value);   if (!isNaN(v)) apply(v); });

        this.customInputs[widgetName] = { range, num };
        wrapper.appendChild(range);
        wrapper.appendChild(num);
        return wrapper;
    }

    syncPanelFromWidgets() {
        for (const [name, pair] of Object.entries(this.customInputs)) {
            const w = this.getWidget(name);
            if (w == null) continue;
            const isFloat = parseFloat(pair.range.step) < 1;
            pair.range.value = w.value;
            pair.num.value = isFloat ? parseFloat(w.value).toFixed(2) : String(Math.round(w.value));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    
    // Transform point using the universal formula
    transformPoint(origPoint, origAnchor, newAnchor, scaleX, scaleY, offsetX = 0, offsetY = 0) {
        return [
            newAnchor[0] + (origPoint[0] - origAnchor[0]) * scaleX + offsetX,
            newAnchor[1] + (origPoint[1] - origAnchor[1]) * scaleY + offsetY
        ];
    }
    
    // Calculate hip center
    calculateHipCenter(kps) {
        return [
            (kps[KEYPOINTS.R_HIP][0] + kps[KEYPOINTS.L_HIP][0]) / 2,
            (kps[KEYPOINTS.R_HIP][1] + kps[KEYPOINTS.L_HIP][1]) / 2
        ];
    }
    
    // Apply hierarchical transforms to get current skeleton (Absolute Decoupling - baseKps)
    transformSkeleton() {
        if (!this.origKps) return null;
        
        const origKps = this.origKps;
        const newKps = origKps.map(p => [...p]);
        
        // Global
        const globalScale = this.getWidgetValue("global_scale", 1.0);
        const globalOffsetX = this.getWidgetValue("global_offset_x", 0);
        const globalOffsetY = this.getWidgetValue("global_offset_y", 0);
        
        // Torso
        const torsoScaleX = this.getWidgetValue("torso_scale_x", 1.0);
        const torsoScaleY = this.getWidgetValue("torso_scale_y", 1.0);
        const torsoOffsetX = this.getWidgetValue("torso_offset_x", 0);
        const torsoOffsetY = this.getWidgetValue("torso_offset_y", 0);
        
        // Head
        const headScaleX = this.getWidgetValue("head_scale_x", 1.0);
        const headScaleY = this.getWidgetValue("head_scale_y", 1.0);
        const headOffsetX = this.getWidgetValue("head_offset_x", 0);
        const headOffsetY = this.getWidgetValue("head_offset_y", 0);
        
        // Right Arm (independent)
        const rightArmScaleX = this.getWidgetValue("right_arm_scale_x", 1.0);
        const rightArmScaleY = this.getWidgetValue("right_arm_scale_y", 1.0);
        const rightArmOffsetX = this.getWidgetValue("right_arm_offset_x", 0);
        const rightArmOffsetY = this.getWidgetValue("right_arm_offset_y", 0);
        
        // Left Arm (independent)
        const leftArmScaleX = this.getWidgetValue("left_arm_scale_x", 1.0);
        const leftArmScaleY = this.getWidgetValue("left_arm_scale_y", 1.0);
        const leftArmOffsetX = this.getWidgetValue("left_arm_offset_x", 0);
        const leftArmOffsetY = this.getWidgetValue("left_arm_offset_y", 0);
        
        // Right Leg (independent)
        const rightLegScaleX = this.getWidgetValue("right_leg_scale_x", 1.0);
        const rightLegScaleY = this.getWidgetValue("right_leg_scale_y", 1.0);
        const rightLegOffsetX = this.getWidgetValue("right_leg_offset_x", 0);
        const rightLegOffsetY = this.getWidgetValue("right_leg_offset_y", 0);
        
        // Left Leg (independent)
        const leftLegScaleX = this.getWidgetValue("left_leg_scale_x", 1.0);
        const leftLegScaleY = this.getWidgetValue("left_leg_scale_y", 1.0);
        const leftLegOffsetX = this.getWidgetValue("left_leg_offset_x", 0);
        const leftLegOffsetY = this.getWidgetValue("left_leg_offset_y", 0);
        
        // 1. CREATE BASE KPS (Global Transform Only)
        // baseKps is the original skeleton with ONLY global_scale and global_offset applied
        // Every local cluster uses baseKps as both origin AND destination anchor
        const origHipCenter = this.calculateHipCenter(origKps);
        const baseKps = origKps.map(p => [
            origHipCenter[0] + (p[0] - origHipCenter[0]) * globalScale + globalOffsetX,
            origHipCenter[1] + (p[1] - origHipCenter[1]) * globalScale + globalOffsetY
        ]);
        
        const baseHipCenter = this.calculateHipCenter(baseKps);
        
        // 2. TORSO Cluster (uses baseKps for both orig and new anchor)
        for (const idx of [KEYPOINTS.NECK, KEYPOINTS.R_SHOULDER, KEYPOINTS.L_SHOULDER, KEYPOINTS.R_HIP, KEYPOINTS.L_HIP]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseHipCenter, baseHipCenter,
                torsoScaleX, torsoScaleY, torsoOffsetX, torsoOffsetY
            );
        }
        
        // 3. HEAD Cluster (uses baseKps for both orig and new anchor)
        const baseNeck = baseKps[KEYPOINTS.NECK];
        for (const idx of [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, KEYPOINTS.L_EYE, KEYPOINTS.R_EAR, KEYPOINTS.L_EAR]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseNeck, baseNeck,
                headScaleX, headScaleY, headOffsetX, headOffsetY
            );
        }
        
        // 4. ARM CLUSTERS (Independent, uses baseKps)
        const baseRShoulder = baseKps[KEYPOINTS.R_SHOULDER];
        const baseLShoulder = baseKps[KEYPOINTS.L_SHOULDER];
        // Right Arm
        for (const idx of [KEYPOINTS.R_ELBOW, KEYPOINTS.R_WRIST]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseRShoulder, baseRShoulder,
                rightArmScaleX, rightArmScaleY, rightArmOffsetX, rightArmOffsetY
            );
        }
        // Left Arm
        for (const idx of [KEYPOINTS.L_ELBOW, KEYPOINTS.L_WRIST]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseLShoulder, baseLShoulder,
                leftArmScaleX, leftArmScaleY, leftArmOffsetX, leftArmOffsetY
            );
        }
        
        // 5. LEG CLUSTERS (Independent, uses baseKps)
        const baseRHip = baseKps[KEYPOINTS.R_HIP];
        const baseLHip = baseKps[KEYPOINTS.L_HIP];
        // Right Leg
        for (const idx of [KEYPOINTS.R_KNEE, KEYPOINTS.R_ANKLE, KEYPOINTS.R_TOE]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseRHip, baseRHip,
                rightLegScaleX, rightLegScaleY, rightLegOffsetX, rightLegOffsetY
            );
        }
        // Left Leg
        for (const idx of [KEYPOINTS.L_KNEE, KEYPOINTS.L_ANKLE, KEYPOINTS.L_TOE]) {
            newKps[idx] = this.transformPoint(
                baseKps[idx], baseLHip, baseLHip,
                leftLegScaleX, leftLegScaleY, leftLegOffsetX, leftLegOffsetY
            );
        }
        
        // CLUSTER ROTATIONS (applied after all move+scale)
        const rotateCluster = (pts, indices, cx, cy, angleDeg) => {
            if (angleDeg === 0) return;
            const rad = angleDeg * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            for (const idx of indices) {
                const px = pts[idx][0] - cx, py = pts[idx][1] - cy;
                pts[idx] = [cx + px * cos - py * sin, cy + px * sin + py * cos];
            }
        };

        const torsoRot    = this.getWidgetValue("torso_rotation", 0.0);
        const headRot     = this.getWidgetValue("head_rotation", 0.0);
        const rArmRot     = this.getWidgetValue("right_arm_rotation", 0.0);
        const lArmRot     = this.getWidgetValue("left_arm_rotation", 0.0);
        const rLegRot     = this.getWidgetValue("right_leg_rotation", 0.0);
        const lLegRot     = this.getWidgetValue("left_leg_rotation", 0.0);

        if (torsoRot !== 0) {
            const ax = (newKps[KEYPOINTS.R_HIP][0] + newKps[KEYPOINTS.L_HIP][0]) / 2;
            const ay = (newKps[KEYPOINTS.R_HIP][1] + newKps[KEYPOINTS.L_HIP][1]) / 2;
            rotateCluster(newKps, [KEYPOINTS.NECK, KEYPOINTS.R_SHOULDER, KEYPOINTS.L_SHOULDER, KEYPOINTS.R_HIP, KEYPOINTS.L_HIP], ax, ay, torsoRot);
        }
        if (headRot !== 0) rotateCluster(newKps, [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, KEYPOINTS.L_EYE, KEYPOINTS.R_EAR, KEYPOINTS.L_EAR], newKps[KEYPOINTS.NECK][0], newKps[KEYPOINTS.NECK][1], headRot);
        if (rArmRot !== 0) rotateCluster(newKps, [KEYPOINTS.R_ELBOW, KEYPOINTS.R_WRIST], newKps[KEYPOINTS.R_SHOULDER][0], newKps[KEYPOINTS.R_SHOULDER][1], rArmRot);
        if (lArmRot !== 0) rotateCluster(newKps, [KEYPOINTS.L_ELBOW, KEYPOINTS.L_WRIST], newKps[KEYPOINTS.L_SHOULDER][0], newKps[KEYPOINTS.L_SHOULDER][1], lArmRot);
        if (rLegRot !== 0) rotateCluster(newKps, [KEYPOINTS.R_KNEE, KEYPOINTS.R_ANKLE, KEYPOINTS.R_TOE], newKps[KEYPOINTS.R_HIP][0], newKps[KEYPOINTS.R_HIP][1], rLegRot);
        if (lLegRot !== 0) rotateCluster(newKps, [KEYPOINTS.L_KNEE, KEYPOINTS.L_ANKLE, KEYPOINTS.L_TOE], newKps[KEYPOINTS.L_HIP][0], newKps[KEYPOINTS.L_HIP][1], lLegRot);

        // Apply Body Micro-Offsets (Final additive layer)
        if (this.microOffsets && this.microOffsets.body) {
            for (const idxStr in this.microOffsets.body) {
                const idx = parseInt(idxStr);
                if (idx >= 0 && idx < newKps.length && newKps[idx]) {
                    const offset = this.microOffsets.body[idxStr];
                    newKps[idx][0] += offset.x || 0;
                    newKps[idx][1] += offset.y || 0;
                }
            }
        }

        return newKps;
    }
    
    // Calculate bounding box for a cluster
    getClusterBoundingBox(clusterName, kps) {
        // FACE uses the 68-point face landmarks, not body keypoints
        if (clusterName === 'FACE') {
            if (!this.showFace) return null;
            const facePts = this.transformFace();
            if (!facePts) return null;

            // Filter out nulls and [0,0] sentinel values
            const valid = facePts.filter(p => p && !(p[0] === 0 && p[1] === 0));
            if (valid.length === 0) return null;

            // Compute centroid and reject outliers beyond 2.5 std-devs
            // (DWPose sometimes places a single landmark wildly off-face)
            const cx = valid.reduce((s, p) => s + p[0], 0) / valid.length;
            const cy = valid.reduce((s, p) => s + p[1], 0) / valid.length;
            const sdx = Math.sqrt(valid.reduce((s, p) => s + (p[0]-cx)**2, 0) / valid.length);
            const sdy = Math.sqrt(valid.reduce((s, p) => s + (p[1]-cy)**2, 0) / valid.length);
            const limX = Math.max(20, sdx * 2.5);
            const limY = Math.max(20, sdy * 2.5);

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of valid) {
                if (Math.abs(p[0]-cx) > limX || Math.abs(p[1]-cy) > limY) continue;
                minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
                maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
            }
            return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
        }

        const cluster = CLUSTERS[clusterName];
        if (!cluster || !kps) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const idx of cluster.points) {
            const p = kps[idx];
            if (!p) continue;
            minX = Math.min(minX, p[0]);
            minY = Math.min(minY, p[1]);
            maxX = Math.max(maxX, p[0]);
            maxY = Math.max(maxY, p[1]);
        }

        if (!isFinite(minX)) return null;

        return { minX, minY, maxX, maxY };
    }
    
    // Get cluster anchor point
    getClusterAnchor(clusterName, kps) {
        const cluster = CLUSTERS[clusterName];
        if (!cluster || !kps) return null;
        
        if (clusterName === "GLOBAL") {
            return this.calculateHipCenter(kps);
        }
        
        if (cluster.anchor !== null) {
            return kps[cluster.anchor];
        }
        
        // Default to center of bounding box
        const bbox = this.getClusterBoundingBox(clusterName, kps);
        if (!bbox) return null;
        return [(bbox.minX + bbox.maxX) / 2, (bbox.minY + bbox.maxY) / 2];
    }
    
    // Get handle positions for bounding box
    getHandlePositions(bbox) {
        if (!bbox) return null;
        const { minX, minY, maxX, maxY } = bbox;
        return {
            tl: [minX, minY],
            tr: [maxX, minY],
            bl: [minX, maxY],
            br: [maxX, maxY]
        };
    }
    
    // Check if mouse is over a handle
    checkHandleHit(mouseX, mouseY, bbox) {
        const handles = this.getHandlePositions(bbox);
        if (!handles) return null;
        
        const threshold = 10;
        
        for (const [name, pos] of Object.entries(handles)) {
            const dist = Math.sqrt(Math.pow(mouseX - pos[0], 2) + Math.pow(mouseY - pos[1], 2));
            if (dist < threshold) {
                return name;
            }
        }
        return null;
    }
    
    render() {
        const ctx = this.ctx;
        const cw = this.canvasWidth;
        const ch = this.canvasHeight;
        const pw = this.poseWidth;
        const ph = this.poseHeight;

        // Ghost zone: clear whole canvas with a slightly darker shade
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(0, 0, cw, ch);

        if (!this.dataLoaded || !this.origKps) {
            ctx.fillStyle = "#888";
            ctx.font = "14px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("Please hit Queue Prompt once to load pose data", cw / 2, ch / 2);
            return;
        }

        // All pose-space drawing is transformed by zoom + pan so points can be dragged off-canvas
        ctx.save();
        ctx.translate(this.viewOffsetX, this.viewOffsetY);
        ctx.scale(this.viewZoom, this.viewZoom);

        // Pose area background
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(0, 0, pw, ph);

        // Draw background image if available (fills pose area only)
        const bgImg = this.activeBackground === "source"
            ? (this.sourceFrameImage || this.referenceImage)
            : (this.referenceImage   || this.sourceFrameImage);
        if (bgImg) {
            ctx.globalAlpha = 0.6;
            ctx.drawImage(bgImg, 0, 0, pw, ph);
            ctx.globalAlpha = 1.0;
        }
        
        // Get transformed keypoints
        const newKps = this.transformSkeleton();
        if (!newKps) return;
        
        // Draw transformed skeleton only (NO ghost skeleton)
        this.drawSkeleton(newKps, 1.0, false);
        
        // Draw hands if available (suppress when the corresponding wrist is disabled)
        const hands = this.transformHands(newKps);
        if (hands.rhand && !this.disabledPoints.body.has(KEYPOINTS.R_WRIST)) {
            this.drawHand(hands.rhand, "#FF6666", 1.0);
            this.drawRotationRing(newKps[KEYPOINTS.R_WRIST], this.getWidgetValue("right_hand_rotation", 0), "#FF6666");
        }
        if (hands.lhand && !this.disabledPoints.body.has(KEYPOINTS.L_WRIST)) {
            this.drawHand(hands.lhand, "#66FF66", 1.0);
            this.drawRotationRing(newKps[KEYPOINTS.L_WRIST], this.getWidgetValue("left_hand_rotation", 0), "#66FF66");
        }
        
        // Draw face if enabled
        if (this.showFace && this.origFace) {
            const transformedFace = this.transformFace();
            if (transformedFace) {
                this.drawFace(transformedFace, "#FFAA00", 1.0);  // Orange for face
            }
        }
        
        // Mode-specific UI rendering
        if (this.uiMode === 'CLUSTER') {
            // Draw Global Anchor (hip center)
            const globalScale = this.getWidgetValue("global_scale", 1.0);
            const globalOffsetX = this.getWidgetValue("global_offset_x", 0);
            const globalOffsetY = this.getWidgetValue("global_offset_y", 0);
            
            const origHipCenter = this.calculateHipCenter(this.origKps);
            const currentHipCenter = [
                origHipCenter[0] * globalScale + globalOffsetX,
                origHipCenter[1] * globalScale + globalOffsetY
            ];
            
            // Draw global anchor
            ctx.save();
            ctx.strokeStyle = "#00FFFF";
            ctx.fillStyle = "#00FFFF";
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.arc(currentHipCenter[0], currentHipCenter[1], 8, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(currentHipCenter[0], currentHipCenter[1], 3, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.beginPath();
            ctx.moveTo(currentHipCenter[0] - 6, currentHipCenter[1]);
            ctx.lineTo(currentHipCenter[0] + 6, currentHipCenter[1]);
            ctx.moveTo(currentHipCenter[0], currentHipCenter[1] - 6);
            ctx.lineTo(currentHipCenter[0], currentHipCenter[1] + 6);
            ctx.stroke();
            ctx.restore();
            
            // Draw bounding box, handles, and rotation ring for active cluster
            if (this.activeCluster && this.activeCluster !== "GLOBAL") {
                const bbox = this.getClusterBoundingBox(this.activeCluster, newKps);
                if (bbox) {
                    this.drawBoundingBox(bbox);
                    this.drawHandles(bbox);
                    this.drawTooltip(this.activeCluster, bbox);
                }
                // Draw cluster rotation ring
                const cluster = CLUSTERS[this.activeCluster];
                if (cluster && cluster.rotationWidget) {
                    const center = this.getClusterAnchor(this.activeCluster, newKps);
                    if (center) {
                        const angleDeg = this.getWidgetValue(cluster.rotationWidget, 0.0);
                        this.drawClusterRotationRing(center, angleDeg, "#FFCC44");
                    }
                }
            } else if (this.activeCluster === "GLOBAL") {
                // Global bounding box around entire skeleton
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;
                
                for (const p of newKps) {
                    if (!p) continue;
                    minX = Math.min(minX, p[0]);
                    minY = Math.min(minY, p[1]);
                    maxX = Math.max(maxX, p[0]);
                    maxY = Math.max(maxY, p[1]);
                }
                
                if (isFinite(minX)) {
                    this.drawBoundingBox({ minX, minY, maxX, maxY }, "#00FFFF");
                    this.drawHandles({ minX, minY, maxX, maxY });
                    this.drawTooltip("GLOBAL", { minX, minY, maxX, maxY });
                }
            }
        } else if (this.uiMode === 'GIZMO' && this.activePoint) {
            // Draw crosshair gizmo over active point
            let p = null;
            if (this.activePoint.group === 'body') p = newKps[this.activePoint.idx];
            else if (this.activePoint.group === 'rhand') p = hands.rhand ? hands.rhand[this.activePoint.idx] : null;
            else if (this.activePoint.group === 'lhand') p = hands.lhand ? hands.lhand[this.activePoint.idx] : null;
            
            if (p) {
                ctx.save();
                ctx.strokeStyle = "#FFFF00"; // Yellow highlight
                ctx.lineWidth = 2;
                // Draw crosshairs
                ctx.beginPath();
                ctx.moveTo(p[0] - 15, p[1]); ctx.lineTo(p[0] + 15, p[1]);
                ctx.moveTo(p[0], p[1] - 15); ctx.lineTo(p[0], p[1] + 15);
                ctx.stroke();
                // Draw circle
                ctx.beginPath();
                ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                
                // Generate human-readable point name
                let pName = "";
                if (this.activePoint.group === 'body') {
                    const POINT_NAMES = Object.keys(KEYPOINTS).reduce((acc, key) => { acc[KEYPOINTS[key]] = key; return acc; }, {});
                    pName = POINT_NAMES[this.activePoint.idx] || `Body_${this.activePoint.idx}`;
                } else if (this.activePoint.group === 'face') {
                    if (this.activePoint.idx >= 48 && this.activePoint.idx <= 67) pName = `Mouth_${this.activePoint.idx}`;
                    else pName = `Face_${this.activePoint.idx}`;
                } else {
                    pName = `${this.activePoint.group}_${this.activePoint.idx}`.toUpperCase();
                }

                // Draw taller tooltip with point name
                const offset = this.microOffsets[this.activePoint.group][this.activePoint.idx] || {x: 0, y: 0};
                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.fillRect(p[0] + 10, p[1] - 35, 120, 32);
                ctx.fillStyle = "white";
                ctx.font = "10px monospace";
                ctx.fillText(pName, p[0] + 15, p[1] - 22);
                ctx.fillText(`dx:${offset.x} dy:${offset.y}`, p[0] + 15, p[1] - 9);
            }
        }

        // Draw red X over disabled body points so the user can see they're off
        if (this.disabledPoints.body.size > 0) {
            ctx.save();
            ctx.strokeStyle = "#FF3333";
            ctx.lineWidth = 2;
            const r = 6;
            for (const idx of this.disabledPoints.body) {
                const p = newKps[idx];
                if (!p || (p[0] === 0 && p[1] === 0)) continue;
                ctx.beginPath();
                ctx.moveTo(p[0] - r, p[1] - r); ctx.lineTo(p[0] + r, p[1] + r);
                ctx.moveTo(p[0] + r, p[1] - r); ctx.lineTo(p[0] - r, p[1] + r);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Dashed frame boundary — shows the actual pose area vs the ghost zone
        ctx.save();
        ctx.strokeStyle = "rgba(180,180,180,0.25)";
        ctx.lineWidth = 1 / this.viewZoom;  // constant 1px regardless of zoom
        ctx.setLineDash([4 / this.viewZoom, 4 / this.viewZoom]);
        ctx.strokeRect(0, 0, pw, ph);
        ctx.restore();

        // End of pose-space drawing — exit zoom+pan transform
        ctx.restore();
    }

    drawSkeleton(kps, alpha, isOriginal) {
        const ctx = this.ctx;
        
        ctx.globalAlpha = alpha;
        ctx.lineWidth = isOriginal ? 2 : 3;
        
        // Draw connections
        for (const [p1Idx, p2Idx, color] of SKELETON_CONNECTIONS) {
            const p1 = kps[p1Idx];
            const p2 = kps[p2Idx];
            
            if (!p1 || !p2) continue;
            if (p1[0] === 0 && p1[1] === 0) continue;
            if (p2[0] === 0 && p2[1] === 0) continue;
            
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
        }
        
        // Draw keypoints
        const pointRadius = isOriginal ? 3 : 5;
        ctx.fillStyle = isOriginal ? "#808080" : "#000000";
        
        for (let i = 0; i < kps.length; i++) {
            const p = kps[i];
            if (!p || (p[0] === 0 && p[1] === 0)) continue;
            
            ctx.beginPath();
            ctx.arc(p[0], p[1], pointRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.globalAlpha = 1.0;
    }
    
    drawBoundingBox(bbox, color = "#4488FF") {
        const ctx = this.ctx;
        const padding = 10;
        
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        
        ctx.strokeRect(
            bbox.minX - padding,
            bbox.minY - padding,
            bbox.maxX - bbox.minX + padding * 2,
            bbox.maxY - bbox.minY + padding * 2
        );
        
        ctx.restore();
    }
    
    drawHandles(bbox) {
        const ctx = this.ctx;
        const handles = this.getHandlePositions(bbox);
        if (!handles) return;
        
        const size = 8;
        
        ctx.save();
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#4488FF";
        ctx.lineWidth = 1;
        
        for (const pos of Object.values(handles)) {
            ctx.fillRect(pos[0] - size / 2, pos[1] - size / 2, size, size);
            ctx.strokeRect(pos[0] - size / 2, pos[1] - size / 2, size, size);
        }
        
        ctx.restore();
    }
    
    drawTooltip(clusterName, bbox) {
        const ctx = this.ctx;
        const cluster = CLUSTERS[clusterName];
        if (!cluster) return;
        
        // Build tooltip text
        let lines = [];
        
        // Scale values
        if (cluster.scaleWidgets && cluster.scaleWidgets.length > 0) {
            if (clusterName === "GLOBAL") {
                const scale = this.getWidgetValue(cluster.scaleWidgets[0], 1.0);
                lines.push(`Scale: ${(scale * 100).toFixed(1)}%`);
            } else {
                const scaleX = this.getWidgetValue(cluster.scaleWidgets[0], 1.0);
                const scaleY = this.getWidgetValue(cluster.scaleWidgets[1], 1.0);
                lines.push(`Scale X: ${(scaleX * 100).toFixed(1)}%, Y: ${(scaleY * 100).toFixed(1)}%`);
            }
        }
        
        // Offset values
        if (cluster.offsetWidgets && cluster.offsetWidgets.length > 0) {
            const offsets = cluster.offsetWidgets.map(w => this.getWidgetValue(w, 0));
            if (offsets.length === 2) {
                lines.push(`dx: ${offsets[0]}px, dy: ${offsets[1]}px`);
            } else {
                lines.push(`offset: ${offsets[0]}px`);
            }
        }
        
        // Calculate tooltip position
        const padding = 8;
        const lineHeight = 14;
        const x = bbox.maxX + 15;
        let y = bbox.minY;
        
        // Measure text
        ctx.font = "11px monospace";
        let maxWidth = 0;
        for (const line of lines) {
            maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
        }
        
        const tooltipWidth = maxWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;
        
        // Draw tooltip background
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.strokeStyle = "#4488FF";
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.roundRect(x, y, tooltipWidth, tooltipHeight, 4);
        ctx.fill();
        ctx.stroke();
        
        // Draw text
        ctx.fillStyle = "#FFFFFF";
        ctx.textBaseline = "top";
        
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], x + padding, y + padding + i * lineHeight);
        }
        
        ctx.restore();
    }
    
    // Detect which cluster the mouse is near (z-index hierarchy)
    detectCluster(mouseX, mouseY) {
        if (!this.origKps) return null;
        
        const newKps = this.transformSkeleton();
        if (!newKps) return null;
        
        const threshold = 25;
        
        // Z-INDEX HIERARCHY (foreground to background):
        // 1. Global Anchor (highest priority)
        // 2. Foreground limbs: HEAD, RIGHT_ARM, LEFT_ARM, RIGHT_LEG, LEFT_LEG
        // 3. Background: TORSO (lowest priority)
        
        // 1. Check Global Anchor first
        const globalScale = this.getWidgetValue("global_scale", 1.0);
        const globalOffsetX = this.getWidgetValue("global_offset_x", 0);
        const globalOffsetY = this.getWidgetValue("global_offset_y", 0);
        
        const origHipCenter = this.calculateHipCenter(this.origKps);
        const currentHipCenter = [
            origHipCenter[0] * globalScale + globalOffsetX,
            origHipCenter[1] * globalScale + globalOffsetY
        ];
        
        const globalDist = Math.sqrt(
            Math.pow(mouseX - currentHipCenter[0], 2) +
            Math.pow(mouseY - currentHipCenter[1], 2)
        );
        
        if (globalDist < 15) {
            return "GLOBAL";
        }
        
        // 2. Check FACE cluster when face overlay is visible
        if (this.showFace && this.origFace) {
            const facePts = this.transformFace();
            if (facePts) {
                for (const p of facePts) {
                    if (!p || (p[0] === 0 && p[1] === 0)) continue;
                    if (Math.hypot(mouseX - p[0], mouseY - p[1]) < threshold) return 'FACE';
                }
            }
        }

        // 3. Check foreground limbs in priority order
        const foregroundClusters = ["HEAD", "RIGHT_ARM", "LEFT_ARM", "RIGHT_LEG", "LEFT_LEG"];
        
        for (const clusterName of foregroundClusters) {
            const cluster = CLUSTERS[clusterName];
            if (!cluster) continue;
            
            for (const pointIdx of cluster.points) {
                const point = newKps[pointIdx];
                if (!point) continue;
                
                const dist = Math.sqrt(
                    Math.pow(mouseX - point[0], 2) +
                    Math.pow(mouseY - point[1], 2)
                );
                
                if (dist < threshold) {
                    return clusterName;
                }
            }
        }
        
        // 4. Check TORSO (background) - allows clicking shoulders/neck to select torso
        const torsoCluster = CLUSTERS["TORSO"];
        if (torsoCluster) {
            for (const pointIdx of torsoCluster.points) {
                const point = newKps[pointIdx];
                if (!point) continue;
                
                const dist = Math.sqrt(
                    Math.pow(mouseX - point[0], 2) +
                    Math.pow(mouseY - point[1], 2)
                );
                
                if (dist < threshold) {
                    return "TORSO";
                }
            }
        }
        
        return null;
    }
    
    // Raw canvas pixel coordinates from a mouse event (before zoom/pan)
    _getCanvasRaw(e) {
        const rect   = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width  / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top)  * scaleY,
        };
    }

    // Convert a mouse event to pose-space coordinates (accounts for current zoom + pan)
    _getMousePose(e) {
        const { x: cx, y: cy } = this._getCanvasRaw(e);
        return {
            x: (cx - this.viewOffsetX) / this.viewZoom,
            y: (cy - this.viewOffsetY) / this.viewZoom,
        };
    }

    // Reset the viewport so the pose fills the canvas with ~5% ghost margin on each side
    _fitView() {
        const zoom = Math.min(this.canvasWidth / this.poseWidth, this.canvasHeight / this.poseHeight) * 0.9;
        this.viewZoom    = zoom;
        this.viewOffsetX = (this.canvasWidth  - this.poseWidth  * zoom) / 2;
        this.viewOffsetY = (this.canvasHeight - this.poseHeight * zoom) / 2;
    }

    onWheel(e) {
        e.preventDefault();
        const { x: cx, y: cy } = this._getCanvasRaw(e);
        const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.max(0.05, Math.min(5.0, this.viewZoom * factor));
        // Zoom towards cursor: keep the pose-space point under the cursor fixed on screen
        this.viewOffsetX = cx - (cx - this.viewOffsetX) * (newZoom / this.viewZoom);
        this.viewOffsetY = cy - (cy - this.viewOffsetY) * (newZoom / this.viewZoom);
        this.viewZoom    = newZoom;
        this.render();
    }

    onContextMenu(e) {
        e.preventDefault();
        if (!this.dataLoaded || this.uiMode !== 'GIZMO') return;

        const { x: mouseX, y: mouseY } = this._getMousePose(e);

        const hit = this.detectPoint(mouseX, mouseY);
        if (!hit || hit.group === 'face') return;  // only body/rhand/lhand toggling

        const set = this.disabledPoints[hit.group];
        if (!set) return;
        if (set.has(hit.idx)) {
            set.delete(hit.idx);
        } else {
            set.add(hit.idx);
        }
        this.saveDisabledPoints();
        this.render();
    }

    onMouseDown(e) {
        if (!this.dataLoaded) return;
        
        // Middle mouse button — pan the viewport
        if (e.button === 1) {
            e.preventDefault();
            const raw = this._getCanvasRaw(e);
            this.isDragging     = true;
            this.dragMode       = 'PAN';
            this.panStartMouse  = { x: raw.x, y: raw.y };
            this.panStartOffset = { x: this.viewOffsetX, y: this.viewOffsetY };
            this.canvas.style.cursor = "grab";
            return;
        }

        const { x: mouseX, y: mouseY } = this._getMousePose(e);

        // ROTATION RING — check before cluster/gizmo logic (works in both modes)
        if (this.origRHand || this.origLHand) {
            const newKps = this.transformSkeleton();
            const hands  = this.transformHands(newKps);
            const ring   = this.detectRotationRing(mouseX, mouseY, newKps, hands);
            if (ring) {
                this.isDragging        = true;
                this.dragMode          = 'ROTATE';
                this.rotatingHand      = ring.hand;
                this.rotationCenter    = ring.wrist;
                this.dragStartAngle    = Math.atan2(mouseY - ring.wrist[1], mouseX - ring.wrist[0]);
                this.dragStartRotation = this.getWidgetValue(
                    ring.hand === 'right' ? 'right_hand_rotation' : 'left_hand_rotation', 0.0
                );
                this.canvas.style.cursor = "crosshair";
                this.render();
                return;
            }
        }

        // CLUSTER ROTATION RING — check for active cluster's rotation handle (CLUSTER mode only)
        if (this.uiMode === 'CLUSTER' && this.activeCluster) {
            const newKps2 = this.transformSkeleton();
            const rotHit = this.detectClusterRotationRing(mouseX, mouseY, this.activeCluster, newKps2);
            if (rotHit) {
                const cluster = CLUSTERS[this.activeCluster];
                this.isDragging        = true;
                this.dragMode          = 'ROTATE_CLUSTER';
                this.rotatingCluster   = this.activeCluster;
                this.rotationCenter    = rotHit.center;
                this.dragStartAngle    = Math.atan2(mouseY - rotHit.center[1], mouseX - rotHit.center[0]);
                this.dragStartRotation = this.getWidgetValue(cluster.rotationWidget, 0.0);
                this.canvas.style.cursor = "crosshair";
                this.render();
                return;
            }
        }

        // GIZMO MODE INTERCEPTION
        if (this.uiMode === 'GIZMO') {
            const clickedPoint = this.detectPoint(mouseX, mouseY);
            if (clickedPoint) {
                this.activePoint = clickedPoint;
                this.isDragging = true;
                this.dragMode = 'GIZMO_DRAG';
                this.dragStartMouse = { x: mouseX, y: mouseY };
                
                // Initialize if it doesn't exist
                if (!this.microOffsets[clickedPoint.group]) this.microOffsets[clickedPoint.group] = {};
                if (!this.microOffsets[clickedPoint.group][clickedPoint.idx]) {
                    this.microOffsets[clickedPoint.group][clickedPoint.idx] = { x: 0, y: 0 };
                }
                
                // Store starting offset for delta calculation
                this.dragStartMicroOffset = { 
                    x: this.microOffsets[clickedPoint.group][clickedPoint.idx].x,
                    y: this.microOffsets[clickedPoint.group][clickedPoint.idx].y
                };
                
                this.canvas.style.cursor = "move";
            } else {
                this.activePoint = null;
                this.canvas.style.cursor = "default";
            }
            this.render();
            return;
        }
        
        // Check if clicking on a handle of active cluster
        if (this.activeCluster) {
            const newKps = this.transformSkeleton();
            let bbox;
            
            if (this.activeCluster === "GLOBAL") {
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;
                for (const p of newKps) {
                    if (!p) continue;
                    minX = Math.min(minX, p[0]);
                    minY = Math.min(minY, p[1]);
                    maxX = Math.max(maxX, p[0]);
                    maxY = Math.max(maxY, p[1]);
                }
                bbox = { minX, minY, maxX, maxY };
            } else {
                bbox = this.getClusterBoundingBox(this.activeCluster, newKps);
            }
            
            if (bbox) {
                const handleHit = this.checkHandleHit(mouseX, mouseY, bbox);
                if (handleHit) {
                    // Start Photoshop-style scale drag
                    this.isDragging = true;
                    this.dragMode = 'SCALE';
                    this.activeHandle = handleHit;
                    
                    // Store initial mouse position
                    this.dragStartMouse = { x: mouseX, y: mouseY };
                    
                    // Store current scale values
                    const cluster = CLUSTERS[this.activeCluster];
                    this.dragStartScales = {
                        x: this.getWidgetValue(cluster.scaleWidgets[0], 1.0),
                        y: cluster.scaleWidgets.length > 1 ? this.getWidgetValue(cluster.scaleWidgets[1], 1.0) : 1.0
                    };
                    
                    // Store initial box size (with minimum to prevent division by zero)
                    this.dragBoxSize = {
                        w: Math.max(10, bbox.maxX - bbox.minX),
                        h: Math.max(10, bbox.maxY - bbox.minY)
                    };
                    
                    // Store the bounding box for anchor compensation
                    this.dragStartBox = bbox;
                    
                    // Store starting offset values for anchor compensation
                    this.dragStartValues = {};
                    for (const w of cluster.offsetWidgets) {
                        this.dragStartValues[w] = this.getWidgetValue(w, 0);
                    }
                    
                    // Calculate handle direction relative to box center
                    const boxCenterX = (bbox.minX + bbox.maxX) / 2;
                    const boxCenterY = (bbox.minY + bbox.maxY) / 2;
                    const handles = this.getHandlePositions(bbox);
                    const handlePos = handles[handleHit];
                    
                    this.handleDir = {
                        x: handlePos[0] > boxCenterX ? 1 : -1,
                        y: handlePos[1] > boxCenterY ? 1 : -1
                    };
                    
                    this.canvas.style.cursor = "nwse-resize";
                    return;
                }
            }
        }
        
        // Check for cluster selection
        const clickedCluster = this.detectCluster(mouseX, mouseY);
        
        if (clickedCluster) {
            this.activeCluster = clickedCluster;
            this.isDragging = true;
            this.dragMode = 'MOVE';
            this.dragStart = { x: mouseX, y: mouseY };
            
            // Store starting offset values
            const cluster = CLUSTERS[clickedCluster];
            this.dragStartValues = {};
            for (const w of cluster.offsetWidgets) {
                this.dragStartValues[w] = this.getWidgetValue(w, 0);
            }
            
            this.canvas.style.cursor = "grabbing";
        } else {
            // Click on empty space deselects
            this.activeCluster = null;
        }
        
        this.render();
    }
    
    onMouseMove(e) {
        if (!this.dataLoaded) return;

        // Pan mode uses raw canvas coords (not pose-space)
        if (this.dragMode === 'PAN') {
            const raw = this._getCanvasRaw(e);
            this.viewOffsetX = this.panStartOffset.x + (raw.x - this.panStartMouse.x);
            this.viewOffsetY = this.panStartOffset.y + (raw.y - this.panStartMouse.y);
            this.render();
            return;
        }

        const { x: mouseX, y: mouseY } = this._getMousePose(e);

        if (!this.isDragging) {
            // Check rotation ring hover cursor first (works in both modes)
            if (this.origRHand || this.origLHand) {
                const newKps = this.transformSkeleton();
                const hands  = this.transformHands(newKps);
                if (this.detectRotationRing(mouseX, mouseY, newKps, hands)) {
                    this.canvas.style.cursor = "crosshair";
                    return;
                }
            }

            // Update cursor based on hover - CLUSTER mode only
            if (this.uiMode === 'CLUSTER') {
                if (this.activeCluster) {
                    const newKps = this.transformSkeleton();
                    let bbox;
                    
                    if (this.activeCluster === "GLOBAL") {
                        let minX = Infinity, minY = Infinity;
                        let maxX = -Infinity, maxY = -Infinity;
                        for (const p of newKps) {
                            if (!p) continue;
                            minX = Math.min(minX, p[0]);
                            minY = Math.min(minY, p[1]);
                            maxX = Math.max(maxX, p[0]);
                            maxY = Math.max(maxY, p[1]);
                        }
                        bbox = { minX, minY, maxX, maxY };
                    } else {
                        bbox = this.getClusterBoundingBox(this.activeCluster, newKps);
                    }
                    
                    if (bbox) {
                        const handleHit = this.checkHandleHit(mouseX, mouseY, bbox);
                        if (handleHit) {
                            this.canvas.style.cursor = "nwse-resize";
                            return;
                        }
                    }
                }
                
                const cluster = this.detectCluster(mouseX, mouseY);
                this.canvas.style.cursor = cluster ? "grab" : "default";
            } else if (this.uiMode === 'GIZMO') {
                // GIZMO mode hover - check for point proximity
                const point = this.detectPoint(mouseX, mouseY);
                this.canvas.style.cursor = point ? "pointer" : "default";
            }
            return;
        }
        
        if (this.dragMode === 'MOVE') {
            const deltaX = mouseX - this.dragStart.x;
            const deltaY = mouseY - this.dragStart.y;

            const cluster = CLUSTERS[this.activeCluster];

            // Dynamically apply offsets based on cluster's offsetWidgets array
            if (cluster.offsetWidgets.length >= 2) {
                const offsetXWidget = cluster.offsetWidgets[0];
                const offsetYWidget = cluster.offsetWidgets[1];
                const newX = Math.round(this.dragStartValues[offsetXWidget] + deltaX);
                const newY = Math.round(this.dragStartValues[offsetYWidget] + deltaY);
                this.setWidgetValue(offsetXWidget, newX);
                this.setWidgetValue(offsetYWidget, newY);
                // Mirror: negate X offset on the paired cluster
                if (this.mirrorMode && cluster.mirrorCluster) {
                    const mc = CLUSTERS[cluster.mirrorCluster];
                    if (mc && mc.offsetWidgets.length >= 2) {
                        this.setWidgetValue(mc.offsetWidgets[0], -newX);
                        this.setWidgetValue(mc.offsetWidgets[1], newY);
                    }
                }
            } else if (cluster.offsetWidgets.length === 1) {
                const offsetWidget = cluster.offsetWidgets[0];
                this.setWidgetValue(offsetWidget, Math.round(this.dragStartValues[offsetWidget] + deltaY));
            }
        } else if (this.dragMode === 'SCALE') {
            // Photoshop-style bounding box delta scaling with anchor compensation
            const cluster = CLUSTERS[this.activeCluster];
            
            // Calculate mouse delta from drag start
            const dx = mouseX - this.dragStartMouse.x;
            const dy = mouseY - this.dragStartMouse.y;
            
            // Calculate scale multipliers based on box size
            // handleDir ensures pulling RIGHT on RIGHT handle makes it bigger (+1),
            // but pulling RIGHT on LEFT handle makes it smaller (-1)
            const scaleMultiplierX = 1.0 + ((dx * this.handleDir.x) / this.dragBoxSize.w);
            const scaleMultiplierY = 1.0 + ((dy * this.handleDir.y) / this.dragBoxSize.h);
            
            // Calculate new scales
            const newScaleX = Math.max(0.1, Math.min(10.0, this.dragStartScales.x * scaleMultiplierX));
            const newScaleY = Math.max(0.1, Math.min(10.0, this.dragStartScales.y * scaleMultiplierY));
            
            // Apply to cluster's scale widgets with anchor compensation
            if (cluster.scaleWidgets.length === 2 && cluster.offsetWidgets.length === 2) {
                // Set Scales
                this.setWidgetValue(cluster.scaleWidgets[0], newScaleX);
                this.setWidgetValue(cluster.scaleWidgets[1], newScaleY);

                // ANCHOR COMPENSATION MATH
                // Calculate where the anatomical anchor is on screen (Global Transform Only)
                const globalScale = this.getWidgetValue("global_scale", 1.0);
                const globalOffsetX = this.getWidgetValue("global_offset_x", 0);
                const globalOffsetY = this.getWidgetValue("global_offset_y", 0);
                
                const origHipCenter = this.calculateHipCenter(this.origKps);
                let baseAnchorX = origHipCenter[0];
                let baseAnchorY = origHipCenter[1];
                
                if (cluster.anchor !== null) {
                    baseAnchorX = origHipCenter[0] + (this.origKps[cluster.anchor][0] - origHipCenter[0]) * globalScale + globalOffsetX;
                    baseAnchorY = origHipCenter[1] + (this.origKps[cluster.anchor][1] - origHipCenter[1]) * globalScale + globalOffsetY;
                } else if (this.activeCluster === "TORSO") {
                    baseAnchorX = origHipCenter[0] * globalScale + globalOffsetX;
                    baseAnchorY = origHipCenter[1] * globalScale + globalOffsetY;
                }

                // Identify the stationary corner of the bounding box (opposite to dragging handle)
                const stationaryX = this.handleDir.x > 0 ? this.dragStartBox.minX : this.dragStartBox.maxX;
                const stationaryY = this.handleDir.y > 0 ? this.dragStartBox.minY : this.dragStartBox.maxY;

                // Calculate the new offset required to keep the stationary corner locked in place
                const startOffsetX = this.dragStartValues[cluster.offsetWidgets[0]];
                const startOffsetY = this.dragStartValues[cluster.offsetWidgets[1]];
                
                const newOffsetX = startOffsetX + (stationaryX - baseAnchorX - startOffsetX) * (1 - newScaleX / this.dragStartScales.x);
                const newOffsetY = startOffsetY + (stationaryY - baseAnchorY - startOffsetY) * (1 - newScaleY / this.dragStartScales.y);

                this.setWidgetValue(cluster.offsetWidgets[0], Math.round(newOffsetX));
                this.setWidgetValue(cluster.offsetWidgets[1], Math.round(newOffsetY));
            } else if (this.activeCluster === "GLOBAL") {
                // GLOBAL only has one scale widget - use average of X and Y
                const avgScale = (newScaleX + newScaleY) / 2;
                this.setWidgetValue(cluster.scaleWidgets[0], avgScale);
            }
        } else if (this.dragMode === 'GIZMO_DRAG' && this.activePoint) {
            const dx = mouseX - this.dragStartMouse.x;
            const dy = mouseY - this.dragStartMouse.y;

            const newOx = Math.round(this.dragStartMicroOffset.x + dx);
            const newOy = Math.round(this.dragStartMicroOffset.y + dy);
            this.microOffsets[this.activePoint.group][this.activePoint.idx] = { x: newOx, y: newOy };

            // Mirror body points across X axis
            if (this.mirrorMode && this.activePoint.group === 'body') {
                const mirrorIdx = GIZMO_MIRROR_PAIRS[this.activePoint.idx];
                if (mirrorIdx !== undefined) {
                    if (!this.microOffsets.body[mirrorIdx]) this.microOffsets.body[mirrorIdx] = { x: 0, y: 0 };
                    this.microOffsets.body[mirrorIdx] = { x: -newOx, y: newOy };
                }
            }

            this.saveMicroOffsets(); // Serialize to Python
        } else if (this.dragMode === 'ROTATE' && this.rotationCenter) {
            const currentAngle = Math.atan2(
                mouseY - this.rotationCenter[1],
                mouseX - this.rotationCenter[0]
            );
            const deltaDeg = (currentAngle - this.dragStartAngle) * 180 / Math.PI;
            const newRot = Math.max(-180, Math.min(180,
                this.dragStartRotation + deltaDeg
            ));
            const wName = this.rotatingHand === 'right' ? 'right_hand_rotation' : 'left_hand_rotation';
            this.setWidgetValue(wName, Math.round(newRot * 10) / 10);
        } else if (this.dragMode === 'ROTATE_CLUSTER' && this.rotationCenter) {
            const currentAngle = Math.atan2(mouseY - this.rotationCenter[1], mouseX - this.rotationCenter[0]);
            const deltaDeg = (currentAngle - this.dragStartAngle) * 180 / Math.PI;
            const newRot = Math.max(-180, Math.min(180, this.dragStartRotation + deltaDeg));
            const rounded = Math.round(newRot * 10) / 10;
            const cluster = CLUSTERS[this.rotatingCluster];
            if (cluster && cluster.rotationWidget) {
                this.setWidgetValue(cluster.rotationWidget, rounded);
                if (this.mirrorMode && cluster.mirrorCluster) {
                    const mc = CLUSTERS[cluster.mirrorCluster];
                    if (mc && mc.rotationWidget) this.setWidgetValue(mc.rotationWidget, rounded);
                }
            }
        }
        
        this.render();
        app.canvas.setDirty(true);
    }
    
    onMouseUp() {
        if (this.dragMode === 'GIZMO_DRAG') {
            this.saveMicroOffsets(); // Flush final position on release
        }
        this.isDragging = false;
        this.dragMode = null;
        this.activeHandle = null;
        this.canvas.style.cursor = this.dataLoaded ? "default" : "default";
    }
    
    resetAll() {
        for (const name of [
            "global_scale",
            "torso_scale_x", "torso_scale_y",
            "head_scale_x", "head_scale_y",
            "right_arm_scale_x", "right_arm_scale_y",
            "left_arm_scale_x", "left_arm_scale_y",
            "right_leg_scale_x", "right_leg_scale_y",
            "left_leg_scale_x", "left_leg_scale_y",
            "face_scale_x", "face_scale_y",
        ]) { this.setWidgetValue(name, 1.0); }

        for (const name of [
            "global_offset_x", "global_offset_y",
            "torso_offset_x", "torso_offset_y",
            "head_offset_x", "head_offset_y",
            "right_arm_offset_x", "right_arm_offset_y",
            "left_arm_offset_x", "left_arm_offset_y",
            "right_leg_offset_x", "right_leg_offset_y",
            "left_leg_offset_x", "left_leg_offset_y",
            "face_offset_x", "face_offset_y",
        ]) { this.setWidgetValue(name, 0); }

        for (const name of [
            "right_hand_scale_x", "right_hand_scale_y",
            "left_hand_scale_x",  "left_hand_scale_y",
        ]) { this.setWidgetValue(name, 1.0); }

        for (const name of [
            "right_hand_rotation", "left_hand_rotation",
            "torso_rotation", "head_rotation",
            "right_arm_rotation", "left_arm_rotation",
            "right_leg_rotation", "left_leg_rotation",
        ]) { this.setWidgetValue(name, 0.0); }

        this.microOffsets = { body: {}, lhand: {}, rhand: {}, face: {} };
        this.saveMicroOffsets();
        this.disabledPoints = { body: new Set(), rhand: new Set(), lhand: new Set() };
        this.saveDisabledPoints();
        this.render();
        app.canvas.setDirty(true);
    }

    resetCluster(clusterName) {
        const cluster = CLUSTERS[clusterName];
        if (!cluster) return;

        for (const w of cluster.scaleWidgets) this.setWidgetValue(w, 1.0);
        for (const w of cluster.offsetWidgets) this.setWidgetValue(w, 0);
        if (cluster.rotationWidget) this.setWidgetValue(cluster.rotationWidget, 0.0);

        this.render();
        app.canvas.setDirty(true);
    }
    
    setPoseData(kps, width = 512, height = 512, lhand = null, rhand = null, face = null) {
        if (!kps || kps.length < 20) return;

        this.origKps      = kps.map(p => [...p]);
        this.poseWidth    = width;
        this.poseHeight   = height;
        this.canvasWidth  = width;
        this.canvasHeight = height;
        this.canvas.width  = width;
        this.canvas.height = height;
        this._defaultedHands.clear();
        this._fitView();
        this.dataLoaded   = true;

        if (lhand && lhand.length >= 21) this.origLHand = lhand.map(p => [...p]);
        if (rhand && rhand.length >= 21) this.origRHand = rhand.map(p => [...p]);
        if (face  && face.length  > 0)   this.origFace  = face.map(p => p ? [...p] : [0, 0]);

        this.render();

        // Resize node to match canvas aspect ratio
        const newH = this.node.computeSize([this.node.size[0], 0]);
        this.node.setSize([this.node.size[0], newH[1]]);
        app.graph.setDirtyCanvas(true);
    }
    
    // Rotate an array of [x,y] points around a center by angleDeg degrees
    _rotatePoints(points, cx, cy, angleDeg) {
        if (angleDeg === 0) return points;
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        return points.map(p => [
            cx + (p[0] - cx) * cos - (p[1] - cy) * sin,
            cy + (p[0] - cx) * sin + (p[1] - cy) * cos
        ]);
    }

    // Apply stored micro-offsets to a hand point array (mutates a copy)
    _applyHandMicroOffsets(pts, group) {
        const offsets = this.microOffsets[group];
        if (!offsets) return pts;
        pts = pts.map(p => [...p]);
        for (const idxStr in offsets) {
            const idx = parseInt(idxStr);
            if (idx >= 0 && idx < pts.length) {
                pts[idx][0] += offsets[idxStr].x || 0;
                pts[idx][1] += offsets[idxStr].y || 0;
            }
        }
        return pts;
    }

    // Transform hands based on wrist position, cluster transforms, and rotation
    transformHands(newKps) {
        const result = { rhand: null, lhand: null };
        const rightRotDeg = this.getWidgetValue("right_hand_rotation", 0.0);
        const leftRotDeg  = this.getWidgetValue("left_hand_rotation",  0.0);

        const rsx = this.getWidgetValue("right_hand_scale_x", 1.0);
        const rsy = this.getWidgetValue("right_hand_scale_y", 1.0);
        const lsx = this.getWidgetValue("left_hand_scale_x",  1.0);
        const lsy = this.getWidgetValue("left_hand_scale_y",  1.0);

        const scaleAround = (pts, wx, wy, sx, sy) => {
            if (sx === 1.0 && sy === 1.0) return pts;
            return pts.map(p => [wx + (p[0] - wx) * sx, wy + (p[1] - wy) * sy]);
        };

        if (this.origRHand && newKps[KEYPOINTS.R_WRIST]) {
            const origRWrist = this.origKps[KEYPOINTS.R_WRIST];
            const newRWrist  = newKps[KEYPOINTS.R_WRIST];
            const dx = newRWrist[0] - origRWrist[0], dy = newRWrist[1] - origRWrist[1];
            let pts = this.origRHand.map(p => [p[0] + dx, p[1] + dy]);
            pts = scaleAround(pts, newRWrist[0], newRWrist[1], rsx, rsy);
            pts = this._rotatePoints(pts, newRWrist[0], newRWrist[1], rightRotDeg);
            result.rhand = this._applyHandMicroOffsets(pts, 'rhand');
        }

        if (this.origLHand && newKps[KEYPOINTS.L_WRIST]) {
            const origLWrist = this.origKps[KEYPOINTS.L_WRIST];
            const newLWrist  = newKps[KEYPOINTS.L_WRIST];
            const dx = newLWrist[0] - origLWrist[0], dy = newLWrist[1] - origLWrist[1];
            let pts = this.origLHand.map(p => [p[0] + dx, p[1] + dy]);
            pts = scaleAround(pts, newLWrist[0], newLWrist[1], lsx, lsy);
            pts = this._rotatePoints(pts, newLWrist[0], newLWrist[1], leftRotDeg);
            result.lhand = this._applyHandMicroOffsets(pts, 'lhand');
        }

        return result;
    }
    
    // Draw hand skeleton
    drawHand(kps, color, alpha = 1.0) {
        if (!kps || kps.length < 21) return;
        
        const ctx = this.ctx;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        
        // Draw all finger connections
        const allConnections = [
            ...Object.values(HAND_CONNECTIONS).flat(),
            ...Object.values(L_HAND_CONNECTIONS).flat()
        ];
        
        for (const [p1Idx, p2Idx] of allConnections) {
            const p1 = kps[p1Idx];
            const p2 = kps[p2Idx];
            if (!p1 || !p2) continue;
            if (p1[0] === 0 && p1[1] === 0) continue;
            if (p2[0] === 0 && p2[1] === 0) continue;
            
            ctx.beginPath();
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
        }
        
        // Draw keypoints
        ctx.fillStyle = color;
        for (let i = 0; i < kps.length; i++) {
            const p = kps[i];
            if (!p || (p[0] === 0 && p[1] === 0)) continue;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.globalAlpha = 1.0;
    }
    
    // Draw a rotation ring + angle indicator around a wrist point
    drawRotationRing(wrist, angleDeg, color) {
        const ctx = this.ctx;
        const R = Math.min(35, Math.max(12, this.canvasWidth * 0.025));
        const dotR = Math.max(6, R * 0.18);
        const rad = angleDeg * Math.PI / 180;
        const hx = wrist[0] + Math.cos(rad) * R;
        const hy = wrist[1] + Math.sin(rad) * R;

        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = color;
        ctx.fillStyle   = color;
        ctx.lineWidth   = Math.max(1.5, R * 0.04);
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(wrist[0], wrist[1], R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(wrist[0], wrist[1]);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.restore();
    }

    // Returns {hand, wrist}|null — whether mouseX/Y hits a rotation handle dot
    detectRotationRing(mouseX, mouseY, newKps, hands) {
        const R = Math.min(35, Math.max(12, this.canvasWidth * 0.025));
        const hitR = Math.max(10, R * 0.35);
        const check = (hand, wristKp, widgetName) => {
            if (!newKps[wristKp]) return null;
            const w = newKps[wristKp];
            const angleDeg = this.getWidgetValue(widgetName, 0);
            const rad = angleDeg * Math.PI / 180;
            const hx = w[0] + Math.cos(rad) * R;
            const hy = w[1] + Math.sin(rad) * R;
            if (Math.hypot(mouseX - hx, mouseY - hy) < hitR) return { hand, wrist: w };
            return null;
        };
        if (hands.rhand) {
            const hit = check('right', KEYPOINTS.R_WRIST, 'right_hand_rotation');
            if (hit) return hit;
        }
        if (hands.lhand) {
            const hit = check('left', KEYPOINTS.L_WRIST, 'left_hand_rotation');
            if (hit) return hit;
        }
        return null;
    }

    // Draw a rotation ring around a cluster anchor (CLUSTER mode, active cluster only)
    drawClusterRotationRing(center, angleDeg, color) {
        const ctx = this.ctx;
        const R = Math.min(50, Math.max(20, this.canvasWidth * 0.04));
        const dotR = Math.max(5, R * 0.18);
        const rad = angleDeg * Math.PI / 180;
        const hx = center[0] + Math.cos(rad) * R;
        const hy = center[1] + Math.sin(rad) * R;

        ctx.save();
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = color;
        ctx.fillStyle   = color;
        ctx.lineWidth   = Math.max(1.5, R * 0.05);
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(center[0], center[1], R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(center[0], center[1]);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.restore();
    }

    // Returns {center} if mouse hits the cluster rotation handle dot
    detectClusterRotationRing(mouseX, mouseY, clusterName, newKps) {
        const cluster = CLUSTERS[clusterName];
        if (!cluster || !cluster.rotationWidget) return null;

        const R = Math.min(50, Math.max(20, this.canvasWidth * 0.04));
        const hitR = Math.max(8, R * 0.35);
        const center = this.getClusterAnchor(clusterName, newKps);
        if (!center) return null;

        const angleDeg = this.getWidgetValue(cluster.rotationWidget, 0.0);
        const rad = angleDeg * Math.PI / 180;
        const hx = center[0] + Math.cos(rad) * R;
        const hy = center[1] + Math.sin(rad) * R;
        if (Math.hypot(mouseX - hx, mouseY - hy) < hitR) return { center };
        return null;
    }

    // Transform face landmarks — whole-face cluster transform
    transformFace() {
        if (!this.origFace || !this.origKps) return null;

        const faceScaleX = this.getWidgetValue("face_scale_x",  1.0);
        const faceScaleY = this.getWidgetValue("face_scale_y",  1.0);
        const faceOffsetX = this.getWidgetValue("face_offset_x", 0);
        const faceOffsetY = this.getWidgetValue("face_offset_y", 0);

        // Anchor face on nose+eyes centroid so it follows head cluster transforms.
        // Use transformSkeleton() to get the fully-transformed body points.
        const newKps = this.transformSkeleton();
        const faceIdxs = [KEYPOINTS.NOSE, KEYPOINTS.R_EYE, KEYPOINTS.L_EYE];

        const validOrig = faceIdxs.filter(i => this.origKps[i] && !(this.origKps[i][0] === 0 && this.origKps[i][1] === 0));
        const validNew  = newKps ? faceIdxs.filter(i => newKps[i] && !(newKps[i][0] === 0 && newKps[i][1] === 0)) : [];

        const mean = (arr, kps) => {
            const xs = arr.map(i => kps[i][0]), ys = arr.map(i => kps[i][1]);
            return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
        };

        // Fall back to neck if no valid face anchor points
        const origAnchor = validOrig.length ? mean(validOrig, this.origKps) : [...this.origKps[KEYPOINTS.NECK]];
        const newAnchor  = (validNew.length && newKps) ? mean(validNew, newKps) : (newKps ? [...newKps[KEYPOINTS.NECK]] : [...origAnchor]);

        // Whole-face cluster transform anchored on nose+eyes centroid
        const pts = this.origFace.map(p => {
            if (!p || (p[0] === 0 && p[1] === 0)) return [0, 0];
            return [
                newAnchor[0] + (p[0] - origAnchor[0]) * faceScaleX + faceOffsetX,
                newAnchor[1] + (p[1] - origAnchor[1]) * faceScaleY + faceOffsetY
            ];
        });

        // Micro-offsets (point gizmo edits)
        if (this.microOffsets.face) {
            for (const idxStr in this.microOffsets.face) {
                const idx = parseInt(idxStr);
                if (idx >= 0 && idx < pts.length) {
                    pts[idx][0] += this.microOffsets.face[idxStr].x || 0;
                    pts[idx][1] += this.microOffsets.face[idxStr].y || 0;
                }
            }
        }

        return pts;
    }
    
    // Draw face landmarks with mouth connections
    drawFace(kps, color = "#FFAA00", alpha = 1.0) {
        if (!kps || kps.length === 0) return;

        // load_pose_metas_from_kp2ds_seq slices kp2ds[22:91] (69 pts), prepending
        // the right_heel foot keypoint before the 68 real 300W face landmarks.
        // Drop it so connections (0-indexed for 68 pts) map correctly.
        if (kps.length === 69) kps = kps.slice(1);

        const ctx = this.ctx;
        ctx.globalAlpha = alpha;

        // 68-point face landmark connections (standard 300W / DWPose format)
        // Jawline: 0-16
        // Left eyebrow: 17-21
        // Right eyebrow: 22-26
        // Nose bridge: 27-30
        // Nose bottom: 31-35
        // Left eye: 36-41
        // Right eye: 42-47
        // Outer mouth: 48-59
        // Inner mouth: 60-67
        
        const connections = [];
        
        // Jawline
        for (let i = 0; i < 16; i++) connections.push([i, i + 1]);
        // Left eyebrow
        for (let i = 17; i < 21; i++) connections.push([i, i + 1]);
        // Right eyebrow
        for (let i = 22; i < 26; i++) connections.push([i, i + 1]);
        // Nose bridge
        for (let i = 27; i < 30; i++) connections.push([i, i + 1]);
        // Nose bottom
        connections.push([30, 31], [31, 32], [32, 33], [33, 34], [34, 35], [35, 30]);
        // Left eye
        for (let i = 36; i < 41; i++) connections.push([i, i + 1]);
        connections.push([41, 36]);
        // Right eye
        for (let i = 42; i < 47; i++) connections.push([i, i + 1]);
        connections.push([47, 42]);
        // Outer mouth
        for (let i = 48; i < 59; i++) connections.push([i, i + 1]);
        connections.push([59, 48]);
        // Inner mouth
        for (let i = 60; i < 67; i++) connections.push([i, i + 1]);
        connections.push([67, 60]);
        
        // Draw connections with thin lines
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        
        for (const [p1Idx, p2Idx] of connections) {
            if (p1Idx >= kps.length || p2Idx >= kps.length) continue;
            const p1 = kps[p1Idx];
            const p2 = kps[p2Idx];
            if (!p1 || !p2) continue;
            if (p1[0] === 0 && p1[1] === 0) continue;
            if (p2[0] === 0 && p2[1] === 0) continue;
            
            ctx.beginPath();
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
        }
        
        // Draw keypoints as small dots
        ctx.fillStyle = color;
        for (let i = 0; i < kps.length; i++) {
            const p = kps[i];
            if (!p || (p[0] === 0 && p[1] === 0)) continue;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.globalAlpha = 1.0;
    }
    
    // Detect point near mouse for GIZMO mode
    detectPoint(mouseX, mouseY) {
        if (!this.origKps) return null;
        
        const newKps = this.transformSkeleton();
        if (!newKps) return null;
        
        const threshold = 15 / this.viewZoom;  // constant screen-space hit radius regardless of zoom
        
        // Check body keypoints
        for (let i = 0; i < newKps.length; i++) {
            const p = newKps[i];
            if (!p || (p[0] === 0 && p[1] === 0)) continue;
            
            const dist = Math.sqrt(Math.pow(mouseX - p[0], 2) + Math.pow(mouseY - p[1], 2));
            if (dist < threshold) {
                return { group: 'body', idx: i };
            }
        }
        
        // Check hands
        const hands = this.transformHands(newKps);
        
        if (hands.rhand) {
            for (let i = 0; i < hands.rhand.length; i++) {
                const p = hands.rhand[i];
                if (!p || (p[0] === 0 && p[1] === 0)) continue;
                
                const dist = Math.sqrt(Math.pow(mouseX - p[0], 2) + Math.pow(mouseY - p[1], 2));
                if (dist < threshold) {
                    return { group: 'rhand', idx: i };
                }
            }
        }
        
        if (hands.lhand) {
            for (let i = 0; i < hands.lhand.length; i++) {
                const p = hands.lhand[i];
                if (!p || (p[0] === 0 && p[1] === 0)) continue;
                
                const dist = Math.sqrt(Math.pow(mouseX - p[0], 2) + Math.pow(mouseY - p[1], 2));
                if (dist < threshold) {
                    return { group: 'lhand', idx: i };
                }
            }
        }
        
        // Check face points if face is visible
        if (this.showFace) {
            const facePoints = this.transformFace();
            if (facePoints) {
                for (let i = 0; i < facePoints.length; i++) {
                    const p = facePoints[i];
                    if (!p || (p[0] === 0 && p[1] === 0)) continue;
                    
                    const dist = Math.sqrt(Math.pow(mouseX - p[0], 2) + Math.pow(mouseY - p[1], 2));
                    if (dist < threshold) {
                        return { group: 'face', idx: i };
                    }
                }
            }
        }
        
        return null;
    }
    
    saveMicroOffsets() {
        this.setWidgetValue("micro_offsets_json", JSON.stringify(this.microOffsets));
    }

    saveDisabledPoints() {
        const serialized = {
            body:  [...this.disabledPoints.body],
            rhand: [...this.disabledPoints.rhand],
            lhand: [...this.disabledPoints.lhand],
        };
        this.setWidgetValue("disabled_points_json", JSON.stringify(serialized));
    }

    resetMicroOffsets() {
        this.microOffsets = { body: {}, lhand: {}, rhand: {}, face: {} };
        this.saveMicroOffsets();
        this.render();
        app.canvas.setDirty(true);
    }
    
    // Apply built-in default open-hand pose for 'right' or 'left', scaled to arm proportions
    _applyDefaultHand(side) {
        if (!this.origKps) return;
        const wristIdx    = side === 'right' ? KEYPOINTS.R_WRIST    : KEYPOINTS.L_WRIST;
        const shoulderIdx = side === 'right' ? KEYPOINTS.R_SHOULDER : KEYPOINTS.L_SHOULDER;
        const origWrist    = this.origKps[wristIdx];
        const origShoulder = this.origKps[shoulderIdx];
        if (!origWrist || !origShoulder) return;

        // Scale so that the wrist→middle-finger-tip span matches ~35% of the arm length
        const armLen = Math.hypot(origShoulder[0] - origWrist[0], origShoulder[1] - origWrist[1]);
        const scale  = Math.max(10, armLen) * 0.35 / 94; // 94 = reference length in template

        const template = side === 'right' ? DEFAULT_RHAND_REL : DEFAULT_LHAND_REL;
        const newHand  = template.map(([rx, ry]) => [origWrist[0] + rx * scale, origWrist[1] + ry * scale]);

        if (side === 'right') {
            this.origRHand = newHand;
            this.microOffsets.rhand = {};
        } else {
            this.origLHand = newHand;
            this.microOffsets.lhand = {};
        }

        this._defaultedHands.add(side);
        this._saveDefaultHands();
        this.saveMicroOffsets();
        this.render();
        app.canvas.setDirty(true);
    }

    _saveDefaultHands() {
        const data = {};
        if (this._defaultedHands.has('right') && this.origRHand) data.rhand = this.origRHand;
        if (this._defaultedHands.has('left')  && this.origLHand) data.lhand = this.origLHand;
        this.setWidgetValue('default_hands_json', JSON.stringify(data));
    }

    setReferenceImage(img) {
        this.referenceImage = img;
        this._updateBgToggleBtn();
        this.render();
    }

    setSourceFrameImage(img) {
        this.sourceFrameImage = img;
        this._updateBgToggleBtn();
        this.render();
    }

    _toggleBackground() {
        this.activeBackground = this.activeBackground === "creature" ? "source" : "creature";
        this._updateBgToggleBtn();
        this.render();
    }

    _updateBgToggleBtn() {
        if (!this.bgToggleBtn) return;
        const hasCreature = !!this.referenceImage;
        const hasSource   = !!this.sourceFrameImage;
        if (!hasCreature && !hasSource) {
            this.bgToggleBtn.textContent = "BG: None";
            this.bgToggleBtn.style.opacity = "0.4";
            this.bgToggleBtn.disabled = true;
        } else {
            this.bgToggleBtn.disabled = false;
            this.bgToggleBtn.style.opacity = "1";
            this.bgToggleBtn.textContent = this.activeBackground === "creature"
                ? "BG: Creature"
                : "BG: Actor Frame";
            this.bgToggleBtn.style.background = this.activeBackground === "creature"
                ? "#2a4a6a"
                : "#4a2a6a";
        }
    }
}

// Register ComfyUI extension
app.registerExtension({
    name: "MagosNodes.PoseRetargeter",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MagosPoseRetargeter") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated?.apply(this, arguments);
            
            this.previewWidget = new DWPosePreviewWidget(this);
            const pw   = this.previewWidget;
            const node = this;

            // Hide micro_offsets_json widget — it must be in optional (not hidden) so ComfyUI
            // creates a real JS widget that setWidgetValue() can write to, but we don't want
            // it visible in the node UI.
            const moWidget = this.widgets?.find(w => w.name === "micro_offsets_json");
            if (moWidget) {
                moWidget.computeSize = () => [0, -4];
                moWidget.hidden = true;
            }

            const dpWidget = this.widgets?.find(w => w.name === "disabled_points_json");
            if (dpWidget) {
                dpWidget.computeSize = () => [0, -4];
                dpWidget.hidden = true;
            }

            const dhWidget = this.widgets?.find(w => w.name === "default_hands_json");
            if (dhWidget) {
                dhWidget.computeSize = () => [0, -4];
                dhWidget.hidden = true;
            }

            this.addDOMWidget("preview", "dwpose_preview", pw.container, {
                getHeight: () => {
                    // toolbar + container padding/gaps + optional panel
                    const TOOLBAR_H = 50;
                    const PANEL_H   = pw.panelVisible ? 310 : 0;
                    const PADDING   = 20;
                    const availW = Math.max(50, node.size[0] - 30);
                    const canvasH = (pw.canvasWidth > 0 && pw.canvasHeight > 0)
                        ? Math.round(availW * pw.canvasHeight / pw.canvasWidth)
                        : 300;
                    return TOOLBAR_H + PANEL_H + PADDING + canvasH;
                },
            });

            // Auto-adjust height when user resizes node width
            const origOnResize = this.onResize;
            this.onResize = function(size) {
                origOnResize?.call(node, size);
                if (pw.canvasWidth > 0) {
                    requestAnimationFrame(() => {
                        const ideal = node.computeSize([size[0], 0]);
                        if (Math.abs(ideal[1] - node.size[1]) > 2) {
                            node.setSize([size[0], ideal[1]]);
                            app.graph.setDirtyCanvas(true);
                        }
                    });
                }
            };

            // All managed widget names
            const managedWidgets = [
                "global_scale",
                "torso_scale_x", "torso_scale_y",
                "head_scale_x", "head_scale_y",
                "right_arm_scale_x", "right_arm_scale_y",
                "left_arm_scale_x", "left_arm_scale_y",
                "right_leg_scale_x", "right_leg_scale_y",
                "left_leg_scale_x", "left_leg_scale_y",
                "global_offset_x", "global_offset_y",
                "torso_offset_x", "torso_offset_y",
                "head_offset_x", "head_offset_y",
                "right_arm_offset_x", "right_arm_offset_y",
                "left_arm_offset_x", "left_arm_offset_y",
                "right_leg_offset_x", "right_leg_offset_y",
                "left_leg_offset_x", "left_leg_offset_y",
                "face_scale_x", "face_scale_y", "face_offset_x", "face_offset_y",
                "right_hand_scale_x", "right_hand_scale_y", "right_hand_rotation",
                "left_hand_scale_x", "left_hand_scale_y", "left_hand_rotation",
                "torso_rotation", "head_rotation",
                "right_arm_rotation", "left_arm_rotation",
                "right_leg_rotation", "left_leg_rotation",
            ];

            for (const name of managedWidgets) {
                const widget = this.widgets?.find(w => w.name === name);
                if (!widget) continue;

                // Hide native widget — control panel replaces it
                widget.hidden = true;
                widget.computeSize = () => [0, -4];

                // Wrap callback: re-render canvas + sync panel input
                const origCb = widget.callback;
                widget.callback = (value) => {
                    origCb?.call(widget, value);
                    pw.render();
                    // Sync panel inputs if value came from outside (workflow load, etc.)
                    const pair = pw.customInputs?.[name];
                    if (pair) {
                        const isFloat = parseFloat(pair.range.step) < 1;
                        pair.range.value = value;
                        pair.num.value = isFloat ? parseFloat(value).toFixed(2) : String(Math.round(value));
                    }
                    app.canvas.setDirty(true);
                };
            }

            // Sync panel to restored widget values after workflow loads
            setTimeout(() => {
                pw.syncPanelFromWidgets();
                const newH = node.computeSize([node.size[0], 0]);
                node.setSize([node.size[0], newH[1]]);
                app.graph.setDirtyCanvas(true);
            }, 80);

            return result;
        };
        
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            const result = onExecuted?.apply(this, arguments);
            
            if (this.previewWidget && message) {
                try {
                    if (message.first_frame_kps && message.first_frame_kps.length >= 20) {
                        const canvasDims = message.canvas_dims || [512, 512];
                        const lhand = message.first_frame_lhand || null;
                        const rhand = message.first_frame_rhand || null;
                        const face = message.first_frame_face || null;
                        this.previewWidget.setPoseData(message.first_frame_kps, canvasDims[0], canvasDims[1], lhand, rhand, face);
                    }

                    if (message.reference_image && message.reference_image[0]) {
                        const img = new Image();
                        img.onload = () => { this.previewWidget.setReferenceImage(img); };
                        img.src = "data:image/png;base64," + message.reference_image[0];
                    }

                    if (message.source_frame_image && message.source_frame_image[0]) {
                        const img = new Image();
                        img.onload = () => { this.previewWidget.setSourceFrameImage(img); };
                        img.src = "data:image/png;base64," + message.source_frame_image[0];
                    }
                } catch (e) {
                    console.warn("MagosPoseRetargeter: Could not process UI data", e);
                }
            }
            
            return result;
        };
    },
});

console.log("DWPose Cluster Retargeter extension loaded");