/**
 * DWPose Temporal Editor — pop-up GUI v4
 * New in v4:
 *  - Catmull-Rom auto-smooth spline interpolation (with tension control)
 *  - Extended easing presets: back, elastic, expo, bounce
 *  - Per-segment easing (click tween line in dope sheet → popup)
 *  - Graph Editor tab: position curves for selected joint, draggable keyframe dots
 *  - Dope Sheet and Graph Editor on separate tabs
 *  - All v3 features preserved
 */

import { app } from "../../scripts/app.js";

// ---------------------------------------------------------------------------
// Skeleton constants
// ---------------------------------------------------------------------------
const BODY_CONNECTIONS = [
    [1,2],[1,5],[2,3],[3,4],[5,6],[6,7],
    [1,8],[1,11],[8,9],[9,10],[11,12],[12,13],
    [0,1],[0,14],[0,15],[14,16],[15,17],[10,19],[13,18],
];
// SMPL 24-joint connections for NLF overlay
// 0=Pelvis 1=L_Hip 2=R_Hip 3=Spine1 4=L_Knee 5=R_Knee 6=Spine2 7=L_Ankle 8=R_Ankle
// 9=Spine3 10=L_Foot 11=R_Foot 12=Neck 13=L_Collar 14=R_Collar 15=Head
// 16=L_Shoulder 17=R_Shoulder 18=L_Elbow 19=R_Elbow 20=L_Wrist 21=R_Wrist 22=L_Hand 23=R_Hand
const NLF_SMPL_CONNECTIONS = [
    [0,1],[0,2],[0,3],[3,6],[6,9],[9,12],[12,15],
    [1,4],[4,7],[7,10],[2,5],[5,8],[8,11],
    [9,13],[9,14],[13,16],[14,17],[16,18],[17,19],[18,20],[19,21],[20,22],[21,23],
];
const BONE_COLORS = [
    "#ff0000","#00ff00","#ff0000","#ff0000","#00ff00","#00ff00",
    "#ffff00","#ff00ff","#ffff00","#ffff00","#ff00ff","#ff00ff",
    "#00ffff","#c8c8c8","#c8c8c8","#969696","#969696",
    "#ffb400","#ff00b4",
];
const JOINT_COLORS = {
    0:"#00ffff", 1:"#ffff00",
    2:"#ff0000", 3:"#ff0000", 4:"#ff0000",
    5:"#00ff00", 6:"#00ff00", 7:"#00ff00",
    8:"#ffff00", 9:"#ffff00", 10:"#ffff00",
    11:"#ff00ff",12:"#ff00ff",13:"#ff00ff",
    14:"#c8c8c8",15:"#c8c8c8",16:"#969696",17:"#969696",
    18:"#ff00b4",19:"#ffb400",
};
const JOINT_LABELS = [
    "NOSE","NECK","R_SHLDR","R_ELBOW","R_WRIST",
    "L_SHLDR","L_ELBOW","L_WRIST","R_HIP","R_KNEE",
    "R_ANKLE","L_HIP","L_KNEE","L_ANKLE","R_EYE",
    "L_EYE","R_EAR","L_EAR","L_TOE","R_TOE",
];
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
];
const R_WRIST = 4, L_WRIST = 7;
const ROW_H = 24;

// Default hand pose — pixel offsets from wrist (image y-down). Right hand; left mirrors x.
const DEFAULT_RHAND_PX = [
    [  0,   0], // 0  Wrist
    [-15, -20], // 1  Thumb CMC
    [-28, -38], // 2  Thumb MCP
    [-37, -52], // 3  Thumb IP
    [-44, -63], // 4  Thumb TIP
    [-10, -52], // 5  Index MCP
    [-10, -73], // 6  Index PIP
    [-10, -85], // 7  Index DIP
    [-10, -93], // 8  Index TIP
    [  0, -55], // 9  Middle MCP
    [  0, -78], // 10 Middle PIP
    [  0, -91], // 11 Middle DIP
    [  0,-100], // 12 Middle TIP
    [ 10, -52], // 13 Ring MCP
    [ 10, -73], // 14 Ring PIP
    [ 10, -85], // 15 Ring DIP
    [ 10, -92], // 16 Ring TIP
    [ 20, -45], // 17 Pinky MCP
    [ 20, -61], // 18 Pinky PIP
    [ 20, -71], // 19 Pinky DIP
    [ 20, -78], // 20 Pinky TIP
];
const DEFAULT_LHAND_PX = DEFAULT_RHAND_PX.map(([x,y])=>[-x,y]);

// Z-only rotation enabled; set false to bench entirely, true+expand axes later
const ROTATION_ENABLED = true;

// ---------------------------------------------------------------------------
// Global interp-mode buttons (sidebar)
// ---------------------------------------------------------------------------
const INTERP_MODES = [
    { val: "catmull_rom", title: "Catmull-Rom (Auto-smooth spline)",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><circle cx="3" cy="13" r="1.5" fill="currentColor"/><circle cx="10" cy="4" r="1.5" fill="currentColor"/><circle cx="17" cy="11" r="1.5" fill="currentColor"/><circle cx="24" cy="5" r="1.5" fill="currentColor"/><path d="M3,13 C5,6 7,1 10,4 C13,7 14,14 17,11 C20,8 22,7 24,5" stroke="currentColor" stroke-width="1.8"/></svg>` },
    { val: "constant", title: "Constant (Hold)",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><polyline points="2,12 10,12 10,4 24,4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>` },
    { val: "linear",   title: "Linear",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><line x1="2" y1="13" x2="24" y2="3" stroke="currentColor" stroke-width="2"/></svg>` },
    { val: "ease",     title: "Ease (S-curve)",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><path d="M2,13 C6,13 8,8 13,8 C18,8 20,3 24,3" stroke="currentColor" stroke-width="2"/></svg>` },
    { val: "ease_in",  title: "Ease In",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><path d="M2,13 Q24,13 24,3" stroke="currentColor" stroke-width="2"/></svg>` },
    { val: "ease_out", title: "Ease Out",
      svg: `<svg width="26" height="16" viewBox="0 0 26 16" fill="none"><path d="M2,13 Q2,3 24,3" stroke="currentColor" stroke-width="2"/></svg>` },
];

// Per-segment popup preset grid (label, value)
const SEGMENT_PRESETS = [
    ["Global", null],
    ["Constant", "constant"], ["Linear", "linear"],
    ["Ease", "ease"], ["Ease In", "ease_in"], ["Ease Out", "ease_out"],
    ["Cubic In", "cubic_in"], ["Cubic Out", "cubic_out"], ["Cubic InOut", "cubic_inout"],
    ["Back In", "back_in"], ["Back Out", "back_out"], ["Back InOut", "back_inout"],
    ["Elastic Out", "elastic_out"], ["Expo Out", "expo_out"], ["Bounce Out", "bounce_out"],
    ["Catmull-Rom", "catmull_rom"],
];

// ---------------------------------------------------------------------------
// Easing functions
// ---------------------------------------------------------------------------
function applyEasing(t, mode) {
    switch (mode) {
        case "constant":     return 0;
        case "linear":       return t;
        case "ease":         return t * t * (3 - 2 * t);
        case "ease_in":      return t * t;
        case "ease_out":     return 1 - (1 - t) * (1 - t);
        case "cubic_in":     return t * t * t;
        case "cubic_out":    return 1 - (1 - t) ** 3;
        case "cubic_inout":  return t < 0.5 ? 4*t*t*t : 1 - (-2*t+2)**3 / 2;
        case "back_in":      return 2.70158*t*t*t - 1.70158*t*t;
        case "back_out":     return 1 + 2.70158*(t-1)**3 + 1.70158*(t-1)**2;
        case "back_inout":   { const c = 1.70158*1.525; return t<0.5 ? ((2*t)**2*((c+1)*2*t-c))/2 : ((2*t-2)**2*((c+1)*(2*t-2)+c)+2)/2; }
        case "elastic_out":  return t===0?0:t===1?1: Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(2*Math.PI/3))+1;
        case "expo_out":     return t===1?1:1-Math.pow(2,-10*t);
        case "bounce_out":   {
            const n=7.5625, d=2.75;
            if (t<1/d) return n*t*t;
            if (t<2/d) return n*(t-=1.5/d)*t+0.75;
            if (t<2.5/d) return n*(t-=2.25/d)*t+0.9375;
            return n*(t-=2.625/d)*t+0.984375;
        }
        default: return t;
    }
}

// Catmull-Rom spline value: P0,P1,P2,P3 are scalar values, t in [0,1]
// alpha=0.5 is the classic "uniform" Catmull-Rom
function catmullRomScalar(P0, P1, P2, P3, t, alpha) {
    const t2 = t*t, t3 = t2*t;
    return alpha * ((2*P1) + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t2 + (-P0+3*P1-3*P2+P3)*t3);
}


// ---------------------------------------------------------------------------
// TemporalEditorOverlay
// ---------------------------------------------------------------------------
class TemporalEditorOverlay {
    constructor(nodeId) {
        this.nodeId     = String(nodeId);
        this.frames        = {};
        this.overrides     = {};
        this.zDepth        = {};
        this.zGlobalOffset = {};   // per-label additive Z shift applied across all frames
        this.tweens        = {};       // {fi: {label: mode_string}}  per-segment easing
        this.smoothWindow      = 0;
        this.interpolationMode = "catmull_rom";
        this.catmullTension    = 0.5;
        this.frameCount = 0;
        this.poseW = 512;
        this.poseH = 512;

        this.currentFrame  = 0;
        this.selectedJoint = null;
        this.dragJoint     = null;
        this.dragGizmo     = null;
        this.gizmoCenter   = null;
        this.cameraView    = "front";

        this.playState  = "stopped";
        this.loopMode   = "cycle";   // "cycle" | "pingpong" | "off"
        this._playDir   = null;      // effective direction during ping-pong
        this.playFPS    = 24;
        this._playRAF   = null;
        this._playLastT = null;

        this.activeTab  = "dope";   // "dope" | "graph"
        this.expandedGroups = new Set(["body"]);

        // Graph editor state
        this.graphViewport = { frameStart: 0, frameEnd: 100, valMin: 0, valMax: 512 };
        this.graphDrag     = null;
        this._graphDragSel = null;   // rubber-band rect selection in graph editor
        this.graphShowX    = true;
        this.graphShowY    = true;
        this._segPopup     = null;

        // 3D Orbit camera
        this.orbitYaw   = -20;     // degrees, horizontal rotation
        this.orbitPitch = 15;      // degrees, vertical tilt
        this.orbitZoom  = 1.0;
        this._orbitDrag = null;    // {startX, startY, startYaw, startPitch}

        // Front view pan / zoom
        this.vpZoom  = 1.0;
        this.vpPanX  = 0;
        this.vpPanY  = 0;
        this._vpPanDrag = null;    // {startX, startY, startPanX, startPanY}

        // Multi-select on dope sheet
        this.selKfs           = new Set();  // "fi::label" composite keys
        this._trackDrag       = null;       // active drag state object (rubber_band or kf_move)
        this._trackDocMove    = null;       // document-level mousemove handler reference
        this._trackDocUp      = null;       // document-level mouseup handler reference
        this._lastKfMoveDelta = 0;
        this._kfClipboard     = null;       // {anchorFi, entries:[{label,fi_offset,data}]}

        // Viewport joint multi-select
        this.selectedJoints = new Set();     // Set of label strings e.g. "body_4"
        this._vpSelectRect  = null;          // {startX,startY,curX,curY} canvas rubber-band

        // Graph extras
        this.normalizeGraph = false;

        // Graph editor interaction state
        this._graphGrab    = null;   // {kfEntries, startX, startY, lastFiDelta, axisLock}
        this._graphScale   = null;   // {kfEntries, pivotFi, pivotVal, startX, startY, lastFiDelta, lastValScale, axisLock}
        this._graphPanDrag = null;   // {startX, startY, origFStart, origFEnd, origVMin, origVMax}
        this._lastGraphMouse = {x: 0, y: 0};

        // Reference card (orbit view)
        this.showReference = true;
        this.referenceImg  = null;           // custom HTMLImageElement if loaded
        this._refMeta      = null;           // { type, name, frameOffset, opacity }
        this._refVideo     = null;           // HTMLVideoElement for video reference
        this._refSeqFrames = null;           // Array of HTMLImageElement for image sequence

        // Hand IK/FK mode — per hand, when IK the entire hand follows the wrist rigidly
        this.handIkMode = { rhand: false, lhand: false };

        // Pre-rotation snapshot (reset each render cycle to prevent double-rotation)
        this._preRotZ = null;
        this._panelInputDragging = false;
        this._showAll = false;

        // NLF Experimental toggle state
        this._experimentalMode = false;
        this._nlfData = null;
        this._nlfBlend = 0.5;
        this._nlfStatus = "idle";  // "idle" | "loading" | "ok" | "unavailable"

        // Undo / Redo
        this._undoStack = [];
        this._redoStack = [];
        this._dragPreState = null;   // state captured at drag start; pushed on first actual change

        // Graph per-coordinate selection (separate from dope-sheet selKfs)
        this.graphSel = new Set();          // "fi::label::coord" e.g. "42::body_4::0"

        // Last clicked joint label in the layer panel (for shift-range select)
        this._lastClickedLayerLabel = null;

        // Auto Keyframe — when ON, dragging a joint automatically writes a keyframe
        this.autoKeyframe = true;
        this._tempKeys = new Set();        // "fi::label" keys written during a drag with autoKF ON
                                           // (used to revert them on seekFrame when autoKF is toggled)

        // Frame range (in/out points)
        this.frameRangeStart = 0;
        this.frameRangeEnd   = 0;          // set properly after data loads

        // Layer locks — labels in this set cannot be dragged in the viewport
        this.lockedLayers = new Set();

        // Layer visibility — hidden layers are not drawn in the viewport (editing aid only)
        this.hiddenGroups = new Set();  // group ids: "body", "rhand", "lhand", "face"
        this.hiddenLayers = new Set();  // joint labels: "body_4", "rhand_0", etc.

        // Per-joint detail panel expand state and live input refs
        this.expandedJoints  = new Set();
        this._detailInputs   = {};       // label → { xInp, yInp, confInp }

        this._bgCache   = {};
        this._bgPending = new Set();

        this._buildDOM();
        this._fetchData();
    }

    // -----------------------------------------------------------------------
    // DOM
    // -----------------------------------------------------------------------
    _buildDOM() {
        this.overlay = document.createElement("div");
        Object.assign(this.overlay.style, {
            position: "fixed", inset: "0", zIndex: "10000",
            background: "rgba(0,0,0,0.92)",
            display: "flex", flexDirection: "column",
            fontFamily: "sans-serif", color: "#fff",
        });

        // Header
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 16px", background: "#0f0f1e", borderBottom: "1px solid #333",
            flexShrink: "0",
        });
        header.innerHTML = `<span style="font-size:15px;font-weight:bold">DWPose Temporal Editor</span>`;
        const _headerBtns = document.createElement("div");
        _headerBtns.style.cssText = "display:flex;gap:6px;align-items:center;";

        // ── File menu dropdown ──
        const fileMenuWrap = document.createElement("div");
        fileMenuWrap.style.cssText = "position:relative;";
        const fileMenuBtn = this._mkBtn("☰ File", null, "#1a1a2e");
        Object.assign(fileMenuBtn.style, { fontWeight: "bold", letterSpacing: "0.03em" });

        const fileMenu = document.createElement("div");
        Object.assign(fileMenu.style, {
            display: "none", position: "absolute", top: "100%", left: "0",
            background: "#12121f", border: "1px solid #333", borderRadius: "6px",
            minWidth: "170px", zIndex: "9999", padding: "4px 0", marginTop: "3px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
        });

        const mkMenuItem = (label, icon, fn, color) => {
            const item = document.createElement("button");
            item.textContent = `${icon}  ${label}`;
            Object.assign(item.style, {
                display: "block", width: "100%", textAlign: "left",
                background: "none", border: "none", color: color || "#ccc",
                padding: "7px 14px", cursor: "pointer", fontSize: "12px",
            });
            item.addEventListener("mouseenter", () => { item.style.background = "#22223a"; });
            item.addEventListener("mouseleave", () => { item.style.background = "none"; });
            item.addEventListener("click", () => { fileMenu.style.display = "none"; fn(); });
            return item;
        };
        const mkMenuSep = () => {
            const s = document.createElement("hr");
            s.style.cssText = "border:none;border-top:1px solid #2a2a3a;margin:3px 0;";
            return s;
        };

        fileMenu.appendChild(mkMenuItem("New Scene…",    "✦", () => this._showProjectDialog("new"),  "#aaddff"));
        fileMenu.appendChild(mkMenuItem("Edit Project…", "✎", () => this._showProjectDialog("edit"), "#cccccc"));
        fileMenu.appendChild(mkMenuSep());
        fileMenu.appendChild(mkMenuItem("Save Project",  "💾", () => this._saveProject(),            "#88bbff"));
        fileMenu.appendChild(mkMenuItem("Load Project",  "📂", () => this._projectFileInput.click(), "#88ffbb"));

        fileMenuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const open = fileMenu.style.display !== "none";
            fileMenu.style.display = open ? "none" : "block";
        });
        document.addEventListener("click", () => { fileMenu.style.display = "none"; }, { capture: true, passive: true });

        fileMenuWrap.appendChild(fileMenuBtn);
        fileMenuWrap.appendChild(fileMenu);
        _headerBtns.appendChild(fileMenuWrap);
        _headerBtns.appendChild(this._mkBtn("Help [F1]", () => this._showHelp(), "#1a2a3a"));
        _headerBtns.appendChild(this._mkBtn("✕ Close", () => this.close(), "#444"));
        header.appendChild(_headerBtns);
        this.overlay.appendChild(header);

        // Main (canvas + sidebar)
        const main = document.createElement("div");
        Object.assign(main.style, { flex: "1", display: "flex", overflow: "hidden", minHeight: "0" });
        this.overlay.appendChild(main);

        const vpWrap = document.createElement("div");
        Object.assign(vpWrap.style, { flex: "1 1 0", position: "relative", background: "#111", overflow: "hidden" });
        this.canvas = document.createElement("canvas");
        Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block" });
        vpWrap.appendChild(this.canvas);

        this._showAllBtn = this._mkBtn("SHOW ALL", () => this._toggleShowAll(), "#1a1a2a");
        Object.assign(this._showAllBtn.style, {
            position:"absolute", top:"8px", right:"8px", zIndex:"10",
            padding:"3px 9px", fontSize:"10px", fontWeight:"bold", letterSpacing:"0.5px",
            color:"#556", border:"1px solid #333", borderRadius:"3px",
        });
        vpWrap.appendChild(this._showAllBtn);

        this._resetViewBtn = this._mkBtn("⟳ Reset View", () => this._resetView(), "#1a1a2a");
        Object.assign(this._resetViewBtn.style, {
            position:"absolute", top:"8px", right:"88px", zIndex:"10",
            padding:"3px 9px", fontSize:"10px",
            color:"#556", border:"1px solid #333", borderRadius:"3px",
        });
        vpWrap.appendChild(this._resetViewBtn);

        main.appendChild(vpWrap);

        // Sidebar
        const sidebar = document.createElement("div");
        Object.assign(sidebar.style, {
            flex: "0 0 214px", background: "#111827", borderLeft: "1px solid #333",
            padding: "10px 8px", display: "flex", flexDirection: "column", gap: "7px",
            overflowY: "auto",
        });
        main.appendChild(sidebar);

        this.jointInfoEl = document.createElement("div");
        Object.assign(this.jointInfoEl.style, {
            background: "#1e2235", borderRadius: "6px", padding: "8px", fontSize: "12px",
        });
        this.jointInfoEl.textContent = "No joint selected";
        sidebar.appendChild(this.jointInfoEl);

        // Camera — three icon buttons
        const camRow = document.createElement("div");
        camRow.style.cssText = "display:flex;gap:3px;";
        const camDefs = [
            ["⊡ Front", "front"], ["⊕ 3D", "orbit"], ["⊟ Split", "split"]
        ];
        this._camBtns = {};
        for (const [label, view] of camDefs) {
            const b = this._mkBtn(label, () => this._setCameraView(view), "#1e3a5a");
            Object.assign(b.style, { flex:"1", fontSize:"10px", padding:"3px 2px" });
            this._camBtns[view] = b;
            camRow.appendChild(b);
        }
        sidebar.appendChild(camRow);
        this._updateCamBtns();

        // Add menu
        const addMenuBtn = this._mkBtn("＋ Add ▾", () => {
            addMenuBody.style.display = addMenuBody.style.display === "none" ? "flex" : "none";
        }, "#1a2a1a");
        addMenuBtn.style.width = "100%";
        sidebar.appendChild(addMenuBtn);

        const addMenuBody = document.createElement("div");
        addMenuBody.style.cssText = "display:none;flex-direction:column;gap:3px;padding-left:6px;";

        this._addHandBtn = this._mkBtn("＋ Hand", () => this._onAddHandClick(), "#1a3020");
        this._addHandBtn.style.fontSize = "10px";
        addMenuBody.appendChild(this._addHandBtn);

        this._addHandChooser = document.createElement("div");
        this._addHandChooser.style.cssText = "display:none;gap:4px;";
        const _mkHandSideBtn = (label, side) => {
            const b = this._mkBtn(label, () => { this._addHand(side); this._addHandChooser.style.display = "none"; }, "#1a2a3a");
            b.style.flex = "1"; b.style.fontSize = "10px";
            return b;
        };
        this._addHandChooser.appendChild(_mkHandSideBtn("＋ Right", "rhand"));
        this._addHandChooser.appendChild(_mkHandSideBtn("＋ Left",  "lhand"));
        addMenuBody.appendChild(this._addHandChooser);
        sidebar.appendChild(addMenuBody);

        sidebar.appendChild(this._mkLabel("Drag joints freely · Ctrl+drag = box-select"));
        sidebar.appendChild(this._mkLabel("Shift+click joint = add to selection"));
        sidebar.appendChild(this._mkLabel("K=Add Key  Del=Remove  H=Hide"));

        // Reference card section
        sidebar.appendChild(this._mkLabel("──── Reference Card ────"));
        this.refToggleBtn = this._mkBtn("👁 Reference: ON", () => this._toggleReference(), "#1a2a1a");
        this.refToggleBtn.style.cssText += "width:100%;font-size:11px;";
        sidebar.appendChild(this.refToggleBtn);

        const refBtnRow = document.createElement("div");
        refBtnRow.style.cssText = "display:flex;gap:3px;margin-top:3px;";
        const refImgBtn = this._mkBtn("🖼 Image", () => this._refFileInput.click(), "#2a2a1a");
        Object.assign(refImgBtn.style, { flex: "1", fontSize: "10px" });
        const refVidBtn = this._mkBtn("🎬 Video", () => this._refVideoInput.click(), "#1a2a2a");
        Object.assign(refVidBtn.style, { flex: "1", fontSize: "10px" });
        const refSeqBtn = this._mkBtn("🎞 Seq", () => this._refSeqInput.click(), "#2a1a2a");
        Object.assign(refSeqBtn.style, { flex: "1", fontSize: "10px" });
        refBtnRow.append(refImgBtn, refVidBtn, refSeqBtn);
        sidebar.appendChild(refBtnRow);

        const refOffRow = document.createElement("div");
        refOffRow.style.cssText = "display:flex;align-items:center;gap:4px;margin-top:4px;";
        const refOffLbl = document.createElement("span");
        refOffLbl.textContent = "Offset:";
        refOffLbl.style.cssText = "font-size:10px;color:#667;flex-shrink:0;";
        this._refOffsetInp = document.createElement("input");
        Object.assign(this._refOffsetInp, { type: "number", value: "0", min: "-9999", max: "9999" });
        Object.assign(this._refOffsetInp.style, {
            width: "50px", background: "#1e1e30", border: "1px solid #335",
            color: "#aac", borderRadius: "3px", padding: "2px 4px", fontSize: "11px",
        });
        this._refOffsetInp.title = "Reference frame offset — drawn frame = current + offset";
        this._refOffsetInp.addEventListener("change", () => {
            const v = parseInt(this._refOffsetInp.value) || 0;
            if (this._refMeta) this._refMeta.frameOffset = v;
            this._renderFrame(this.currentFrame);
        });
        const refClearBtn = this._mkBtn("× Clear", () => {
            this.referenceImg = null;
            if (this._refVideo) { this._refVideo.src = ""; this._refVideo = null; }
            this._refSeqFrames = null;
            this._refMeta = null;
            if (this._refRelinkBanner) this._refRelinkBanner.style.display = "none";
            if (this._refInfoDiv) this._refInfoDiv.style.display = "none";
            this._renderFrame(this.currentFrame);
        }, "#2a1a1a");
        Object.assign(refClearBtn.style, { fontSize: "10px", flex: "1" });
        refOffRow.append(refOffLbl, this._refOffsetInp, refClearBtn);
        sidebar.appendChild(refOffRow);

        this._refRelinkBanner = document.createElement("div");
        this._refRelinkBanner.style.cssText = "display:none;background:#2a1a00;border:1px solid #664;border-radius:4px;padding:4px 6px;margin-top:4px;font-size:10px;color:#cc8;";
        sidebar.appendChild(this._refRelinkBanner);

        this._refInfoDiv = document.createElement("div");
        this._refInfoDiv.style.cssText = "display:none;font-size:9px;color:#556;margin-top:3px;line-height:1.5;padding:0 2px;";
        sidebar.appendChild(this._refInfoDiv);

        this._refFileInput = document.createElement("input");
        Object.assign(this._refFileInput, { type: "file", accept: "image/*" });
        this._refFileInput.style.display = "none";
        this._refFileInput.addEventListener("change", e => {
            const f = e.target.files[0]; if (!f) return;
            const url = URL.createObjectURL(f);
            const img = new Image();
            img.onload = () => {
                this.referenceImg = img;
                if (this._refVideo) { this._refVideo.src = ""; this._refVideo = null; }
                this._refSeqFrames = null;
                this._refMeta = { type: "image", name: f.name, frameOffset: 0, opacity: 0.55 };
                if (this._refOffsetInp) this._refOffsetInp.value = "0";
                if (this._refRelinkBanner) this._refRelinkBanner.style.display = "none";
                if (this._refInfoDiv) {
                    this._refInfoDiv.textContent = `${img.naturalWidth}×${img.naturalHeight}  ·  static image`;
                    this._refInfoDiv.style.display = "block";
                }
                this._renderFrame(this.currentFrame);
            };
            img.src = url;
        });
        document.body.appendChild(this._refFileInput);

        this._refVideoInput = document.createElement("input");
        Object.assign(this._refVideoInput, { type: "file", accept: "video/*" });
        this._refVideoInput.style.display = "none";
        this._refVideoInput.addEventListener("change", e => {
            const f = e.target.files[0]; if (!f) return;
            this._loadRefVideo(f);
            if (this._refRelinkBanner) this._refRelinkBanner.style.display = "none";
        });
        document.body.appendChild(this._refVideoInput);

        this._refSeqInput = document.createElement("input");
        Object.assign(this._refSeqInput, { type: "file", accept: "image/*", multiple: true });
        this._refSeqInput.style.display = "none";
        this._refSeqInput.addEventListener("change", e => {
            const files = [...e.target.files]; if (!files.length) return;
            this._loadRefSequence(files);
            if (this._refRelinkBanner) this._refRelinkBanner.style.display = "none";
        });
        document.body.appendChild(this._refSeqInput);

        // ---- Experimental / NLF Section ----
        sidebar.appendChild(this._mkLabel("──── Experimental ────"));

        this._expBtn = this._mkBtn("⚗ Experimental: OFF", () => this._toggleExperimental(), "#1a1a2a");
        this._expBtn.style.width = "100%";
        this._expBtn.style.fontSize = "11px";
        sidebar.appendChild(this._expBtn);

        this._nlfPanel = document.createElement("div");
        this._nlfPanel.style.cssText = "display:none;padding:4px 0;";

        this._nlfStatusEl = document.createElement("div");
        this._nlfStatusEl.style.cssText = "font-size:9px;color:#667;margin-bottom:4px;line-height:1.4;";
        this._nlfStatusEl.textContent = "NLF: not loaded";
        this._nlfPanel.appendChild(this._nlfStatusEl);

        this._nlfPanel.appendChild(this._mkLabel("DWPose ← Blend → NLF"));

        this._nlfBlendSlider = document.createElement("input");
        Object.assign(this._nlfBlendSlider, { type: "range", min: "0", max: "1", step: "0.05", value: "0.5" });
        this._nlfBlendSlider.style.width = "100%";
        this._nlfBlendSlider.addEventListener("input", () => {
            this._nlfBlend = parseFloat(this._nlfBlendSlider.value);
            this._renderFrame(this.currentFrame);
        });
        this._nlfPanel.appendChild(this._nlfBlendSlider);
        sidebar.appendChild(this._nlfPanel);

        // (Graph editor controls are now inside the graph panel itself — see graph panel setup)

        // ---- Resize handle: viewport/sidebar splitter ----
        const sidebarHandle = document.createElement("div");
        Object.assign(sidebarHandle.style, {
            width: "5px", flexShrink: "0", cursor: "ew-resize",
            background: "#1e1e30", borderLeft: "1px solid #333",
            transition: "background 0.15s",
        });
        sidebarHandle.title = "Drag to resize sidebar";
        sidebarHandle.addEventListener("mouseenter", () => { sidebarHandle.style.background = "#2a3a5a"; });
        sidebarHandle.addEventListener("mouseleave", () => { sidebarHandle.style.background = "#1e1e30"; });
        sidebarHandle.addEventListener("mousedown", ev => {
            ev.preventDefault();
            const startX = ev.clientX, startW = sidebar.getBoundingClientRect().width;
            const onMove = mv => { sidebar.style.flex = `0 0 ${Math.max(140, Math.min(420, startW - (mv.clientX - startX)))}px`; };
            const onUp   = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup",   onUp);
        });
        // Insert handle between vpWrap and sidebar
        main.insertBefore(sidebarHandle, sidebar);

        // ---- Timeline panel ----
        const timeline = document.createElement("div");
        this._timelineEl = timeline;
        Object.assign(timeline.style, {
            flexShrink: "0", background: "#0f0f1e", borderTop: "1px solid #333",
            display: "flex", flexDirection: "column", height: "260px",
        });
        // Resize handle at top of timeline
        const tlHandle = document.createElement("div");
        Object.assign(tlHandle.style, {
            height: "5px", flexShrink: "0", cursor: "ns-resize",
            background: "#1e1e30", borderTop: "1px solid #333",
        });
        tlHandle.title = "Drag to resize timeline";
        tlHandle.addEventListener("mouseenter", () => { tlHandle.style.background = "#2a3a5a"; });
        tlHandle.addEventListener("mouseleave", () => { tlHandle.style.background = "#1e1e30"; });
        tlHandle.addEventListener("mousedown", ev => {
            ev.preventDefault();
            const startY = ev.clientY, startH = timeline.getBoundingClientRect().height;
            const onMove = mv => {
                const newH = Math.max(80, Math.min(600, startH - (mv.clientY - startY)));
                timeline.style.height = `${newH}px`;
            };
            const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup",   onUp);
        });
        this.overlay.appendChild(tlHandle);
        this.overlay.appendChild(timeline);

        // Tab bar
        const tabBar = document.createElement("div");
        Object.assign(tabBar.style, {
            display: "flex", flexShrink: "0", borderBottom: "1px solid #2a2a3a",
            background: "#0a0a14",
        });
        this.tabBtns = {};
        for (const [id, label] of [["dope", "Dope Sheet"], ["graph", "Graph Editor"]]) {
            const b = document.createElement("button");
            b.textContent = label;
            Object.assign(b.style, {
                background: "none", border: "none", borderBottom: "2px solid transparent",
                color: "#888", padding: "5px 14px", cursor: "pointer", fontSize: "12px",
            });
            b.addEventListener("click", () => this._switchTab(id));
            this.tabBtns[id] = b;
            tabBar.appendChild(b);
        }
        timeline.appendChild(tabBar);

        // Transport controls (always visible)
        const ctrlRow = document.createElement("div");
        Object.assign(ctrlRow.style, {
            display: "flex", alignItems: "center", gap: "4px",
            padding: "4px 8px", flexShrink: "0", borderBottom: "1px solid #222",
            flexWrap: "wrap",
        });
        const toStartBtn = this._mkTransportBtn("⏮", "Jump to first frame", () => { this._stopPlayback(); this._seekFrame(0); });
        const playBwdBtn = this._mkTransportBtn("◀◀","Play Backwards",      () => this._togglePlay("backward"));
        const stepBwdBtn = this._mkTransportBtn("◀", "Step back one frame",  () => { this._stopPlayback(); this._seekFrame(this.currentFrame - 1); });
        const stepFwdBtn = this._mkTransportBtn("▶", "Step forward one frame",() => { this._stopPlayback(); this._seekFrame(this.currentFrame + 1); });
        const playFwdBtn = this._mkTransportBtn("▶▶","Play Forward",         () => this._togglePlay("forward"));
        const toEndBtn   = this._mkTransportBtn("⏭", "Jump to last frame",   () => { this._stopPlayback(); this._seekFrame(this.frameCount - 1); });
        this.playFwdBtn = playFwdBtn; this.playBwdBtn = playBwdBtn;

        // Loop mode toggle: Cycle → Ping-Pong → Off → Cycle …
        const loopBtn = document.createElement("button");
        const LOOP_STATES = ["cycle", "pingpong", "off"];
        const LOOP_LABEL  = { cycle: "↺", pingpong: "⇄", off: "→|" };
        const LOOP_TITLE  = { cycle: "Loop: Cycle (click to switch)", pingpong: "Loop: Ping-Pong (click to switch)", off: "Loop: Off (click to switch)" };
        const LOOP_COLOR  = { cycle: "#7affaa", pingpong: "#88ccff", off: "#888" };
        const LOOP_BG     = { cycle: "#1a4a2a", pingpong: "#1a2a4a", off: "#1e1e30" };
        const LOOP_BORDER = { cycle: "#3aaa6a", pingpong: "#3a6aaa", off: "#3a3a4a" };
        const applyLoopBtnStyle = () => {
            const m = this.loopMode;
            loopBtn.textContent = LOOP_LABEL[m];
            loopBtn.title       = LOOP_TITLE[m];
            Object.assign(loopBtn.style, {
                background: LOOP_BG[m], borderColor: LOOP_BORDER[m], color: LOOP_COLOR[m],
            });
        };
        Object.assign(loopBtn.style, {
            border: "1px solid", borderRadius: "3px", padding: "2px 6px",
            cursor: "pointer", fontSize: "13px", fontFamily: "monospace", minWidth: "28px",
        });
        loopBtn.addEventListener("click", () => {
            const idx = LOOP_STATES.indexOf(this.loopMode);
            this.loopMode = LOOP_STATES[(idx + 1) % LOOP_STATES.length];
            this._playDir = this.playState !== "stopped" ? this.playState : null;
            applyLoopBtnStyle();
        });
        applyLoopBtnStyle();
        this.loopBtn = loopBtn;

        const fpsLabel = this._mkLabel("FPS:");
        const fpsInput = document.createElement("input");
        Object.assign(fpsInput, { type: "number", min: "1", max: "120", value: "24" });
        Object.assign(fpsInput.style, {
            width: "38px", background: "#222", color: "#fff",
            border: "1px solid #444", borderRadius: "3px", padding: "1px 3px", fontSize: "11px",
        });
        fpsInput.addEventListener("change", () => {
            this.playFPS = Math.max(1, Math.min(120, parseInt(fpsInput.value) || 24));
            fpsInput.value = this.playFPS;
        });
        this._fpsInput = fpsInput;

        this.frameLabel = document.createElement("span");
        this.frameLabel.style.cssText = "font-size:12px;min-width:90px;";
        this.frameLabel.textContent = "Frame: 0 / 0";

        this.scrubber = document.createElement("input");
        Object.assign(this.scrubber, { type: "range", min: "0", max: "0", step: "1", value: "0" });
        this.scrubber.style.cssText = "flex:1;min-width:80px;";
        this.scrubber.addEventListener("mousedown", () => this._stopPlayback());
        this.scrubber.addEventListener("input",     () => this._seekFrame(parseInt(this.scrubber.value)));

        // Frame range in/out inputs
        const mkRangeInput = (placeholder, getVal, setVal) => {
            const inp = document.createElement("input");
            Object.assign(inp, { type: "number", min: "0", placeholder });
            Object.assign(inp.style, {
                width: "42px", background: "#222", color: "#adf",
                border: "1px solid #335", borderRadius: "3px", padding: "1px 3px", fontSize: "11px",
            });
            inp.title = placeholder === "In" ? "Frame Range Start (In point)" : "Frame Range End (Out point)";
            inp.addEventListener("change", () => {
                const v = parseInt(inp.value);
                if (!isNaN(v)) { setVal(Math.max(0, Math.min(v, this.frameCount - 1))); }
                inp.value = getVal();
                this._renderTrack(); this._renderFrame(this.currentFrame);
            });
            return inp;
        };
        this.rangeStartInp = mkRangeInput("In",
            () => this.frameRangeStart,
            v => { this.frameRangeStart = Math.min(v, this.frameRangeEnd); });
        this.rangeEndInp = mkRangeInput("Out",
            () => this.frameRangeEnd,
            v => { this.frameRangeEnd = Math.max(v, this.frameRangeStart); });
        const rangeLabel = this._mkLabel("Range:");

        ctrlRow.append(toStartBtn, playBwdBtn, stepBwdBtn, this.frameLabel, fpsLabel, fpsInput,
                       stepFwdBtn, playFwdBtn, toEndBtn, loopBtn, rangeLabel, this.rangeStartInp, this.rangeEndInp,
                       this.scrubber);
        timeline.appendChild(ctrlRow);

        // ---- Dope Sheet panel ----
        this.dopePanel = document.createElement("div");
        Object.assign(this.dopePanel.style, { display: "flex", flexDirection: "column", flex: "1", overflow: "hidden", minHeight: "0" });

        const layerArea = document.createElement("div");
        Object.assign(layerArea.style, { display: "flex", flex: "1", overflow: "hidden", minHeight: "0" });
        this.dopePanel.appendChild(layerArea);

        this.layerPanel = document.createElement("div");
        Object.assign(this.layerPanel.style, {
            width: "200px", flexShrink: "0", overflowY: "auto", overflowX: "hidden",
            background: "#0d0d1a", borderRight: "1px solid #2a2a3a",
        });
        layerArea.appendChild(this.layerPanel);

        // Resize handle between layer panel and track canvas
        const layerHandle = document.createElement("div");
        Object.assign(layerHandle.style, {
            width: "5px", flexShrink: "0", cursor: "ew-resize",
            background: "#1e1e30", borderLeft: "1px solid #2a2a3a",
            transition: "background 0.15s",
        });
        layerHandle.title = "Drag to resize layer panel";
        layerHandle.addEventListener("mouseenter", () => { layerHandle.style.background = "#2a3a5a"; });
        layerHandle.addEventListener("mouseleave", () => { layerHandle.style.background = "#1e1e30"; });
        layerHandle.addEventListener("mousedown", ev => {
            ev.preventDefault();
            const startX = ev.clientX;
            const startW = this.layerPanel.getBoundingClientRect().width;
            const onMove = mv => {
                const newW = Math.max(120, Math.min(500, startW + (mv.clientX - startX)));
                this.layerPanel.style.width = `${newW}px`;
                this._buildLayerPanel();
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
        layerArea.appendChild(layerHandle);

        this.trackWrapper = document.createElement("div");
        Object.assign(this.trackWrapper.style, { flex: "1", overflow: "auto", position: "relative" });
        this.trackCanvas = document.createElement("canvas");
        this.trackCanvas.style.cssText = "display:block;";
        this.trackWrapper.appendChild(this.trackCanvas);
        layerArea.appendChild(this.trackWrapper);

        // Graph canvas — shares the same flex area as trackWrapper, toggled by _switchTab
        this.graphCanvas = document.createElement("canvas");
        Object.assign(this.graphCanvas.style, { flex: "1", alignSelf: "stretch", display: "none", minWidth: "0", minHeight: "0" });
        layerArea.appendChild(this.graphCanvas);

        this.layerPanel.addEventListener("scroll", () => { this.trackWrapper.scrollTop = this.layerPanel.scrollTop; });
        this.trackWrapper.addEventListener("scroll", () => { this.layerPanel.scrollTop = this.trackWrapper.scrollTop; });
        this.trackCanvas.addEventListener("mousedown",   e => this._onTrackMouseDown(e));
        this.trackCanvas.addEventListener("contextmenu", e => { e.preventDefault(); this._onTrackRightClick(e); });

        const kfBar = document.createElement("div");
        Object.assign(kfBar.style, {
            display: "flex", gap: "4px", padding: "3px 8px",
            background: "#0a0a16", borderTop: "1px solid #1e1e2e",
            flexShrink: "0", alignItems: "center", flexWrap: "wrap",
        });
        const insBtn = this._mkBtn("⬦ Add Key  [K]",   () => this._insertKeyframeSelected(), "#1a3a2a");
        const delBtn = this._mkBtn("✕ Del Key  [Del]", () => this._deleteKeyframeSelected(), "#3a1a1a");
        const trimBefBtn = this._mkBtn("◀K✕ Before", () => this._trimKeyframesBefore(), "#2a1a2a");
        const trimAftBtn = this._mkBtn("✕K▶ After",  () => this._trimKeyframesAfter(),  "#2a1a2a");
        trimBefBtn.title = "Delete all keyframes BEFORE the current cursor position";
        trimAftBtn.title = "Delete all keyframes AFTER the current cursor position";
        // Auto Keyframe toggle
        this.autoKfBtn = this._mkBtn("⬤ Auto Key", () => this._toggleAutoKeyframe(), "#3a2a1a");
        this.autoKfBtn.title = "Auto Keyframe: automatically insert a keyframe when you move a joint.\nWhen OFF, drag changes are temporary until you press K.";
        this._updateAutoKfBtn();
        for (const b of [insBtn, delBtn, trimBefBtn, trimAftBtn, this.autoKfBtn]) {
            b.style.fontSize = "11px"; b.style.padding = "2px 8px";
        }
        kfBar.append(insBtn, delBtn, trimBefBtn, trimAftBtn, this.autoKfBtn);
        this.kfBar = kfBar;
        this.dopePanel.appendChild(kfBar);

        timeline.appendChild(this.dopePanel);

        // ── Graph controls panel (right side, shown only in graph mode) ──
        this.graphRightPanel = document.createElement("div");
        Object.assign(this.graphRightPanel.style, {
            width: "98px", flexShrink: "0", background: "#0b0b18",
            borderLeft: "1px solid #2a2a3a", overflowY: "auto",
            display: "none", flexDirection: "column", gap: "3px", padding: "5px 4px",
        });
        const mkGraphBtn = (text, fn, bg, title) => {
            const b = this._mkBtn(text, fn, bg);
            b.style.cssText += "font-size:10px;padding:2px 4px;width:100%;text-align:left;";
            if (title) b.title = title;
            return b;
        };
        const mkGDiv = () => { const d=document.createElement("hr"); d.style.cssText="border:none;border-top:1px solid #1e1e2e;margin:2px 0;"; return d; };

        // Keyframe section
        this.graphRightPanel.appendChild(mkGraphBtn("⬦ Add Key  [K]", () => this._insertKeyframeSelected(), "#1a3a2a", "Insert keyframe at current frame for active channels"));
        this.graphRightPanel.appendChild(mkGraphBtn("✕ Del Key  [X]", () => this._deleteGraphSelected(),      "#3a1a1a", "Delete selected keyframes (X or Delete)"));
        this.graphAutoKfBtn = mkGraphBtn("⬤ Auto Key", () => this._toggleAutoKeyframe(), "#3a2a1a", this.autoKfBtn?.title ?? "");
        this.graphRightPanel.appendChild(this.graphAutoKfBtn);
        this.graphRightPanel.appendChild(mkGDiv());

        // Edit section
        this.graphRightPanel.appendChild(mkGraphBtn("↔ Scale  [S]", () => this._startGraphScale(), "#1a2a3a", "Scale selected keyframes around selection center\nS=both axes, then X=time only, Y=value only"));
        this.graphRightPanel.appendChild(mkGraphBtn("〜 Smooth  [O]", () => this._smoothSelectedKfs(), "#1a2a2a", "Gaussian smooth selected keyframe values\n(only selected KFs are modified)"));
        this.graphRightPanel.appendChild(mkGDiv());

        // View section
        this.graphRightPanel.appendChild(mkGraphBtn("⊡ Fit View  [.]", () => { this._graphFitView(); this._renderGraphEditor(); }, "#1e2030", "Frame all keyframes in view (or press . / Home)"));
        this.graphRightPanel.appendChild(mkGraphBtn("⊞ Auto Range", () => { this._graphAutoFitRange(); this._renderGraphEditor(); }, "#1e2030", "Fit Y axis to actual data range, outlier-clamped ±100px"));
        this.normalizeBtn = mkGraphBtn("⇥ Normalize", () => {
            this.normalizeGraph = !this.normalizeGraph;
            this.normalizeBtn.style.background   = this.normalizeGraph ? "#1a3a5a" : "#1e2030";
            this.normalizeBtn.style.borderColor  = this.normalizeGraph ? "#3a88cc" : "#444";
            this._renderGraphEditor();
        }, "#1e2030", "Normalize all curves to −1…1 for comparison");
        this.graphRightPanel.appendChild(this.normalizeBtn);
        this.graphRightPanel.appendChild(mkGDiv());

        // Curve visibility: X and Y toggles
        const xyRow = document.createElement("div");
        xyRow.style.cssText = "display:flex;gap:3px;";
        const mkXYBtn = (label, col, prop) => {
            const b = this._mkBtn(label, () => { this[prop]=!this[prop]; b.style.opacity=this[prop]?"1":"0.3"; this._renderGraphEditor(); }, col);
            Object.assign(b.style, { fontSize:"11px", padding:"1px 6px", flex:"1" });
            return b;
        };
        xyRow.append(mkXYBtn("X","#883333","graphShowX"), mkXYBtn("Y","#338866","graphShowY"));
        this.graphRightPanel.appendChild(xyRow);
        this.graphRightPanel.appendChild(mkGDiv());

        layerArea.appendChild(this.graphRightPanel);

        // ---- Interpolation tool bar (always visible below dope/graph) ----
        const interpBar = document.createElement("div");
        Object.assign(interpBar.style, {
            display: "flex", alignItems: "center", gap: "4px", flexShrink: "0",
            padding: "4px 8px", background: "#0a0a14", borderTop: "1px solid #1e1e2e",
            flexWrap: "wrap",
        });
        const interpLabel = document.createElement("span");
        interpLabel.style.cssText = "font-size:10px;color:#556;margin-right:4px;white-space:nowrap;";
        interpLabel.textContent = "Default:";
        interpBar.appendChild(interpLabel);
        this.interpLabel = interpLabel;
        this.interpBtns = {};
        for (const { val, title, svg } of INTERP_MODES) {
            const btn = document.createElement("button");
            btn.title = title; btn.innerHTML = svg;
            Object.assign(btn.style, {
                background: "#2a2a3a", border: "1px solid #444", color: "#aaa",
                borderRadius: "4px", cursor: "pointer", padding: "3px 4px",
                width: "36px", height: "28px",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
            });
            btn.addEventListener("click", () => {
                const hasDopeSel  = this.selKfs.size > 0;
                const hasGraphSel = this.graphSel.size > 0;
                if (!hasDopeSel && !hasGraphSel) return; // require a selection — no global mode changes
                this._pushUndo();
                if (hasDopeSel) {
                    // Apply to dope-sheet selected KF segments
                    for (const key of this.selKfs) {
                        const [fStr, label] = key.split("::");
                        const fi = parseInt(fStr);
                        if (!this.tweens[fi]) this.tweens[fi] = {};
                        this.tweens[fi][label] = val;
                    }
                } else {
                    // Apply to graph-editor selected KF segments
                    const seen = new Set();
                    for (const key of this.graphSel) {
                        const parts = key.split("::");
                        const id = `${parts[0]}::${parts[1]}`;
                        if (seen.has(id)) continue;
                        seen.add(id);
                        const fi = parseInt(parts[0]), label = parts[1];
                        if (!this.tweens[fi]) this.tweens[fi] = {};
                        this.tweens[fi][label] = val;
                    }
                }
                this._updateInterpBtns();
                this._renderFrame(this.currentFrame);
                this._renderTrack();
                if (this.activeTab === "graph") this._renderGraphEditor();
            });
            this.interpBtns[val] = btn;
            interpBar.appendChild(btn);
        }
        timeline.appendChild(interpBar);

        // Action row
        const actRow = document.createElement("div");
        Object.assign(actRow.style, {
            display: "flex", justifyContent: "flex-end", gap: "8px",
            padding: "6px 10px", flexShrink: "0", borderTop: "1px solid #222",
        });
        const applyBtn = this._mkBtn("Apply Changes", () => this._applyChanges(), "#1a6a3a");
        applyBtn.style.fontWeight = "bold";
        const undoBtn = this._mkBtn("↩ Undo  [Ctrl+Z]", () => this._undo(), "#2a2a3a");
        const redoBtn = this._mkBtn("↪ Redo  [Ctrl+Y]", () => this._redo(), "#2a2a3a");
        actRow.append(undoBtn, redoBtn, applyBtn, this._mkBtn("Close", () => this.close()));
        timeline.appendChild(actRow);

        // Hidden file input for project load
        this._projectFileInput = document.createElement("input");
        Object.assign(this._projectFileInput, { type: "file", accept: ".json" });
        this._projectFileInput.style.display = "none";
        this._projectFileInput.addEventListener("change", e => {
            const f = e.target.files[0]; if (!f) return;
            this._loadProject(f);
            this._projectFileInput.value = "";
        });
        document.body.appendChild(this._projectFileInput);

        document.body.appendChild(this.overlay);

        // Viewport canvas events
        this.canvas.addEventListener("mousedown",   e => this._onCanvasMouseDown(e));
        this.canvas.addEventListener("mousemove",   e => this._onCanvasMouseMove(e));
        this.canvas.addEventListener("mouseup",     e => this._onCanvasMouseUp(e));
        this.canvas.addEventListener("contextmenu", e => this._onCanvasContextMenu(e));
        this.canvas.addEventListener("wheel",       e => this._onCanvasWheel(e), { passive: false });
        this.canvas.addEventListener("dblclick",    () => { this.vpZoom=1; this.vpPanX=0; this.vpPanY=0; this.orbitZoom=1; this._renderFrame(this.currentFrame); });

        // Graph canvas events
        this.graphCanvas.addEventListener("mousedown",   e => this._onGraphMouseDown(e));
        this.graphCanvas.addEventListener("mousemove",   e => this._onGraphMouseMove(e));
        this.graphCanvas.addEventListener("mouseup",     e => this._onGraphMouseUp(e));
        this.graphCanvas.addEventListener("contextmenu", e => { e.preventDefault(); if (this._graphGrab) this._cancelGraphGrab(); if (this._graphScale) this._cancelGraphScale(); });
        this.graphCanvas.addEventListener("wheel",       e => this._onGraphWheel(e), { passive: false });

        // Keyboard
        this._onKeyDown = e => {
            // F1 / ? — always open help, even when focus is in an input
            if (e.key === "F1" || (e.key === "?" && !e.ctrlKey && !e.altKey)) {
                e.preventDefault(); this._showHelp(); return;
            }
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            // --- Universal shortcuts (work in any tab) ---
            if (e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); this._undo(); return; }
            if (e.ctrlKey && (e.key === "y" || e.key === "Y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))) { e.preventDefault(); this._redo(); return; }
            if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); this._togglePlay("forward"); return; }
            if (e.key === "ArrowLeft")  { e.preventDefault(); this._stopPlayback(); this._seekFrame(this.currentFrame - 1); return; }
            if (e.key === "ArrowRight") { e.preventDefault(); this._stopPlayback(); this._seekFrame(this.currentFrame + 1); return; }
            if (e.key === "End")  { e.preventDefault(); this._stopPlayback(); this._seekFrame(this.frameCount - 1); return; }

            // --- H — hide/show selected joint(s); Alt+H — show all ---
            if ((e.key === "h" || e.key === "H") && !e.ctrlKey) {
                e.preventDefault();
                if (e.altKey) { this.hiddenLayers.clear(); this.hiddenGroups.clear(); }
                else { for (const lbl of this.selectedJoints) { if (this.hiddenLayers.has(lbl)) this.hiddenLayers.delete(lbl); else this.hiddenLayers.add(lbl); } }
                this._refreshTimeline(); this._renderFrame(this.currentFrame);
                if (this.activeTab === "graph") this._renderGraphEditor();
                return;
            }

            // ====== GRAPH EDITOR shortcuts ======
            if (this.activeTab === "graph") {
                // Escape: cancel grab OR clear selection
                if (e.key === "Escape") {
                    e.preventDefault();
                    if (this._graphGrab) { this._cancelGraphGrab(); return; }
                    this.graphSel.clear(); this._renderGraphEditor(); return;
                }
                // Swallow all keys during Grab or Scale (except universal)
                if (this._graphGrab) {
                    if (e.key === "x" || e.key === "X") { e.preventDefault(); this._graphGrab.axisLock = this._graphGrab.axisLock === "time"  ? null : "time";  this._applyGraphGrab(this._lastGraphMouse.x, this._lastGraphMouse.y); return; }
                    if (e.key === "y" || e.key === "Y") { e.preventDefault(); this._graphGrab.axisLock = this._graphGrab.axisLock === "value" ? null : "value"; this._applyGraphGrab(this._lastGraphMouse.x, this._lastGraphMouse.y); return; }
                    if (e.key === "Enter")  { e.preventDefault(); this._confirmGraphGrab(); return; }
                    return;
                }
                if (this._graphScale) {
                    if (e.key === "x" || e.key === "X") { e.preventDefault(); this._graphScale.axisLock = this._graphScale.axisLock === "time"  ? null : "time";  this._applyGraphScale(this._lastGraphMouse.x, this._lastGraphMouse.y); return; }
                    if (e.key === "y" || e.key === "Y") { e.preventDefault(); this._graphScale.axisLock = this._graphScale.axisLock === "value" ? null : "value"; this._applyGraphScale(this._lastGraphMouse.x, this._lastGraphMouse.y); return; }
                    if (e.key === "Enter") { e.preventDefault(); this._confirmGraphScale(); return; }
                    if (e.key === "Escape") { e.preventDefault(); this._cancelGraphScale(); return; }
                    return;
                }
                // G: grab  |  S: scale  |  O: smooth
                if ((e.key === "g" || e.key === "G") && !e.ctrlKey) { e.preventDefault(); this._startGraphGrab(); return; }
                if ((e.key === "s" || e.key === "S") && !e.ctrlKey) { e.preventDefault(); this._startGraphScale(); return; }
                if ((e.key === "o" || e.key === "O") && !e.ctrlKey) { e.preventDefault(); this._smoothSelectedKfs(); return; }
                // A / Ctrl+A: select all / deselect all
                if ((e.key === "a" || e.key === "A") && !e.ctrlKey) {
                    e.preventDefault();
                    if (this.graphSel.size > 0) this.graphSel.clear();
                    else { for (const lbl of this._graphLabels()) for (const fi of this._getKeyframesForJoint(lbl)) for (const c of [0,1]) this.graphSel.add(`${fi}::${lbl}::${c}`); }
                    this._renderGraphEditor(); return;
                }
                if (e.ctrlKey && (e.key === "a" || e.key === "A")) {
                    e.preventDefault();
                    for (const lbl of this._graphLabels()) for (const fi of this._getKeyframesForJoint(lbl)) for (const c of [0,1]) this.graphSel.add(`${fi}::${lbl}::${c}`);
                    this._renderGraphEditor(); return;
                }
                // X / Delete: delete selected keyframes
                if (e.key === "x" || e.key === "X" || e.key === "Delete") {
                    e.preventDefault(); this._deleteGraphSelected(); return;
                }
                // K / I: insert keyframe at current frame for active channels
                if (e.key === "k" || e.key === "K" || e.key === "i" || e.key === "I") {
                    e.preventDefault(); this._insertKeyframeSelected(); return;
                }
                // . (period): frame selected keyframes in view
                if (e.key === ".") {
                    e.preventDefault(); this._graphFitView(); this._renderGraphEditor(); return;
                }
                // Home: fit all frames in view
                if (e.key === "Home") {
                    e.preventDefault();
                    this.graphViewport = { frameStart: 0, frameEnd: Math.max(1, this.frameCount-1), valMin: 0, valMax: Math.max(this.poseW, this.poseH) };
                    this._renderGraphEditor(); return;
                }
                // Ctrl+C: copy graph-selected KFs into clipboard (via selKfs bridge)
                if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
                    e.preventDefault();
                    const seen = new Set();
                    for (const key of this.graphSel) { const p = key.split("::"); seen.add(`${p[0]}::${p[1]}`); }
                    for (const id of seen) this.selKfs.add(id);
                    this._copySelectedKeyframes(); return;
                }
                // Ctrl+V: paste at current frame
                if (e.ctrlKey && (e.key === "v" || e.key === "V")) { e.preventDefault(); this._pasteKeyframes(); return; }
                // Tab: switch to dope sheet
                if (e.key === "Tab") { e.preventDefault(); this._switchTab("dope"); return; }
                return;  // don't fall through to dope-sheet shortcuts
            }

            // ====== DOPE SHEET shortcuts ======
            if (e.key === "Escape") {
                e.preventDefault();
                this._hideSegmentPopup(); this.selKfs.clear(); this._renderTrack(); return;
            }
            // Home: jump to first frame (in dope sheet context)
            if (e.key === "Home") { e.preventDefault(); this._stopPlayback(); this._seekFrame(0); return; }
            // Tab: switch to graph editor
            if (e.key === "Tab") { e.preventDefault(); this._switchTab("graph"); return; }
            // K / I: insert keyframe
            if (e.key === "k" || e.key === "K" || e.key === "i" || e.key === "I") { e.preventDefault(); this._insertKeyframeSelected(); return; }
            // X / Delete: delete selected keyframes (or KF at cursor if nothing selected and joint active)
            if (e.key === "x" || e.key === "X" || e.key === "Delete") {
                e.preventDefault();
                if (this.selKfs.size > 0) this._deleteSelectedKeyframes();
                else if (this.selectedJoint) this._deleteKeyframeSelected();
                return;
            }
            // A: toggle select all / deselect all
            if ((e.key === "a" || e.key === "A") && !e.ctrlKey) {
                e.preventDefault();
                if (this.selKfs.size > 0) { this.selKfs.clear(); this._renderTrack(); }
                else this._selectAllKeyframes();
                return;
            }
            // Ctrl+A: select all
            if (e.ctrlKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); this._selectAllKeyframes(); return; }
            // Ctrl+C / Ctrl+V: copy/paste keyframes
            if (e.ctrlKey && (e.key === "c" || e.key === "C")) { this._copySelectedKeyframes(); return; }
            if (e.ctrlKey && (e.key === "v" || e.key === "V")) { this._pasteKeyframes(); return; }
        };
        window.addEventListener("keydown", this._onKeyDown);

        // Resize
        this._ro = new ResizeObserver(() => {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width  = rect.width;
            this.canvas.height = rect.height;
            this._renderFrame(this.currentFrame);
        });
        this._ro.observe(this.canvas);
        this._roGraph = new ResizeObserver(() => {
            if (this.activeTab !== "graph") return;
            const rect = this.graphCanvas.getBoundingClientRect();
            this.graphCanvas.width  = rect.width;
            this.graphCanvas.height = rect.height;
            this._graphAutoFitRange();
            this._renderGraphEditor();
        });
        this._roGraph.observe(this.graphCanvas);

        // Init tab state
        this._switchTab("dope");
    }

    _mkBtn(text, fn, bg = "#2a2a3a") {
        const b = document.createElement("button");
        b.textContent = text;
        Object.assign(b.style, {
            background: bg, border: "1px solid #444", color: "#fff",
            padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px",
        });
        b.addEventListener("click", fn);
        return b;
    }
    _mkLabel(text) {
        const l = document.createElement("div");
        l.style.cssText = "font-size:11px;color:#888;";
        l.textContent = text;
        return l;
    }
    _mkTransportBtn(text, title, fn) {
        const b = document.createElement("button");
        b.textContent = text; b.title = title;
        Object.assign(b.style, {
            background: "#1e1e30", border: "1px solid #3a3a4a", color: "#ccc",
            padding: "3px 7px", borderRadius: "4px", cursor: "pointer",
            fontSize: "13px", minWidth: "28px", lineHeight: "1",
        });
        b.addEventListener("click", fn);
        return b;
    }

    // -----------------------------------------------------------------------
    // Tab switching
    // -----------------------------------------------------------------------
    _switchTab(id) {
        this.activeTab = id;
        const inGraph = id === "graph";
        this.trackWrapper.style.display     = inGraph ? "none"  : "block";
        this.graphCanvas.style.display      = inGraph ? "block" : "none";
        this.graphRightPanel.style.display  = inGraph ? "flex"  : "none";
        if (this.kfBar) this.kfBar.style.display = inGraph ? "none" : "flex";

        for (const [tid, btn] of Object.entries(this.tabBtns)) {
            const active = tid === id;
            btn.style.color       = active ? "#fff" : "#888";
            btn.style.borderColor = active ? "#5588ff" : "transparent";
            btn.style.background  = active ? "#1a1a2e" : "none";
        }
        if (id === "graph") {
            // requestAnimationFrame lets the browser do layout before we read getBoundingClientRect
            requestAnimationFrame(() => {
                const rect = this.graphCanvas.getBoundingClientRect();
                if (rect.width > 0) {
                    this.graphCanvas.width  = Math.round(rect.width);
                    this.graphCanvas.height = Math.round(rect.height);
                }
                this._graphAutoFitRange();
                this._renderGraphEditor();
            });
        }
    }

    // -----------------------------------------------------------------------
    // Playback
    // -----------------------------------------------------------------------
    _togglePlay(direction) {
        if (this.playState === direction) this._stopPlayback();
        else this._startPlayback(direction);
    }
    _startPlayback(direction) {
        this._stopPlayback();
        this.playState = direction;
        this._playDir  = direction;
        this._playLastT = null;
        this._updatePlayBtns();
        const msPerFrame = 1000 / this.playFPS;
        const tick = (ts) => {
            if (this.playState !== direction) return;
            if (this._playLastT === null) this._playLastT = ts;
            const elapsed = ts - this._playLastT;
            if (elapsed >= msPerFrame) {
                this._playLastT = ts - (elapsed % msPerFrame);
                const lo = this.frameRangeStart;
                const hi = this.frameRangeEnd || this.frameCount - 1;
                let next = this.currentFrame + (this._playDir === "forward" ? 1 : -1);
                if (next > hi) {
                    if      (this.loopMode === "cycle")    { next = lo; }
                    else if (this.loopMode === "pingpong") { this._playDir = "backward"; next = Math.max(lo, hi - 1); }
                    else   { this._stopPlayback(); return; }
                } else if (next < lo) {
                    if      (this.loopMode === "cycle")    { next = hi; }
                    else if (this.loopMode === "pingpong") { this._playDir = "forward"; next = Math.min(hi, lo + 1); }
                    else   { this._stopPlayback(); return; }
                }
                this._seekFrame(next);
            }
            this._playRAF = requestAnimationFrame(tick);
        };
        this._playRAF = requestAnimationFrame(tick);
    }
    _stopPlayback() {
        if (this._playRAF) { cancelAnimationFrame(this._playRAF); this._playRAF = null; }
        this._playLastT = null; this.playState = "stopped"; this._playDir = null;
        this._updatePlayBtns();
    }
    _updatePlayBtns() {
        if (!this.playFwdBtn || !this.playBwdBtn) return;
        const fa = this.playState === "forward", ba = this.playState === "backward";
        this.playFwdBtn.textContent = fa ? "⏸" : "▶▶";
        this.playFwdBtn.title       = fa ? "Pause" : "Play Forward";
        Object.assign(this.playFwdBtn.style, { background: fa?"#1a4a2a":"#1e1e30", borderColor: fa?"#3aaa6a":"#3a3a4a", color: fa?"#7affaa":"#ccc" });
        this.playBwdBtn.textContent = ba ? "⏸" : "◀◀";
        this.playBwdBtn.title       = ba ? "Pause" : "Play Backwards";
        Object.assign(this.playBwdBtn.style, { background: ba?"#1a4a2a":"#1e1e30", borderColor: ba?"#3aaa6a":"#3a3a4a", color: ba?"#7affaa":"#ccc" });
    }

    _updateInterpBtns() {
        // Show the selected segment's mode (dope-sheet or graph selection).
        // If no selection, show the active segment at currentFrame (read-only indicator).
        // Buttons are only clickable when something is selected.
        let effectiveMode = null;
        let isPerSegment  = false;

        if (this.selKfs.size > 0) {
            const [fStr, label] = [...this.selKfs][0].split("::");
            const override = this.tweens[parseInt(fStr)]?.[label];
            if (override) { effectiveMode = override; isPerSegment = true; }
        } else if (this.graphSel?.size > 0) {
            const parts = [...this.graphSel][0].split("::");
            const override = this.tweens[parseInt(parts[0])]?.[parts[1]];
            if (override) { effectiveMode = override; isPerSegment = true; }
        } else {
            // Read-only: show what segment the playhead is inside, if any
            const fi = this.currentFrame;
            let found = false;
            for (const [tFi, tMap] of Object.entries(this.tweens)) {
                if (found) break;
                const tfi = parseInt(tFi);
                if (tfi > fi) continue;
                for (const [label, mode] of Object.entries(tMap)) {
                    const kfs = this._getKeyframesForJoint(label);
                    const idx = kfs.indexOf(tfi);
                    if (idx >= 0 && idx + 1 < kfs.length && kfs[idx + 1] > fi) {
                        effectiveMode = mode; isPerSegment = true; found = true; break;
                    }
                }
            }
        }

        const hasSel = this.selKfs.size > 0 || this.graphSel?.size > 0;
        for (const [val, btn] of Object.entries(this.interpBtns)) {
            const active = val === effectiveMode;
            btn.style.background  = active ? "#3a2a5a" : "#2a2a3a";
            btn.style.borderColor = active ? "#aa7aee"  : "#444";
            btn.style.color       = active ? "#ddaaff"  : (hasSel ? "#aaa" : "#555");
            btn.style.cursor      = hasSel ? "pointer"  : "default";
            btn.style.opacity     = hasSel ? "1" : "0.45";
        }

        if (this.interpLabel) {
            if (hasSel) {
                this.interpLabel.textContent = "Segment:";
                this.interpLabel.style.color = "#88aacc";
            } else if (isPerSegment) {
                this.interpLabel.textContent = "Active:";
                this.interpLabel.style.color = "#886699";
            } else {
                this.interpLabel.textContent = "Select KF:";
                this.interpLabel.style.color = "#445";
            }
        }
    }

    // -----------------------------------------------------------------------
    // Data fetch & init
    // -----------------------------------------------------------------------
    async _fetchData() {
        try {
            const r = await fetch(`/temporal-editor/data/${this.nodeId}`);
            if (!r.ok) throw new Error(await r.text());
            this._init(await r.json());
        } catch (e) {
            this.jointInfoEl.textContent = "Run the workflow first or Start a new Scene.";
        }
    }
    _init(data) {
        this.frameCount        = data.frame_count || 0;
        this.poseW             = data.width  || 512;
        this.poseH             = data.height || 512;
        this.smoothWindow      = data.smooth_window || 0;
        this.interpolationMode = data.interpolation || "catmull_rom";
        this.catmullTension    = data.catmull_tension ?? 0.5;

        this.frames = {};
        for (const [k, v] of Object.entries(data.frames || {}))
            this.frames[parseInt(k)] = v;
        this.overrides = {};
        for (const [k, v] of Object.entries(data.overrides || {}))
            this.overrides[parseInt(k)] = v;
        this.zDepth = {};
        for (const [k, v] of Object.entries(data.z_depth || {}))
            this.zDepth[parseInt(k)] = v;
        this.tweens = {};
        for (const [k, v] of Object.entries(data.tweens || {}))
            this.tweens[parseInt(k)] = v;

        this.scrubber.max       = String(Math.max(0, this.frameCount - 1));

        // Default range end to last frame so zone layout starts in linear (full) mode
        if (this.frameRangeEnd === 0 && this.frameCount > 1) {
            this.frameRangeEnd = this.frameCount - 1;
            if (this.rangeEndInp) this.rangeEndInp.value = this.frameRangeEnd;
        }

        this._updateInterpBtns();
        this.graphViewport = { frameStart: 0, frameEnd: Math.max(1, this.frameCount - 1), valMin: 0, valMax: Math.max(this.poseW, this.poseH) };

        this._refreshTimeline();
        this._seekFrame(0);
    }

    // -----------------------------------------------------------------------
    // Layer definitions
    // -----------------------------------------------------------------------
    _getLayerDefs() {
        const rows = [], exp = this.expandedGroups;
        const WRIST_SET = new Set(["body_4","body_7"]);
        const addJoint = (label, name, color, group, index) => {
            rows.push({ type:"joint", label, name, color, group, index });
            if (this.expandedJoints.has(label)) {
                rows.push({ type:"joint_detail", detail:"xy",      label, color, group, index });
                rows.push({ type:"joint_detail", detail:"z",       label, color, group, index });
                rows.push({ type:"joint_detail", detail:"zoffset", label, color, group, index });
                rows.push({ type:"joint_detail", detail:"conf",    label, color, group, index });
                if (ROTATION_ENABLED && WRIST_SET.has(label)) {
                    rows.push({ type:"wrist_rotation", label, color:"#aa88cc", group, index });
                }
            }
        };
        rows.push({ type: "group", id: "body",  name: "Body",   color: "#555" });
        if (exp.has("body"))  for (let i=0;i<20;i++) addJoint(`body_${i}`,  JOINT_LABELS[i], JOINT_COLORS[i]||"#aaa", "body",  i);
        rows.push({ type: "group", id: "rhand", name: "R Hand", color: "#0064ff" });
        if (exp.has("rhand")) for (let i=0;i<21;i++) addJoint(`rhand_${i}`, `Rf_${i}`,       "#4488ff",               "rhand", i);
        rows.push({ type: "group", id: "lhand", name: "L Hand", color: "#00c864" });
        if (exp.has("lhand")) for (let i=0;i<21;i++) addJoint(`lhand_${i}`, `Lf_${i}`,       "#44bb88",               "lhand", i);
        return rows;
    }

    // -----------------------------------------------------------------------
    // Timeline (dope sheet)
    // -----------------------------------------------------------------------
    _refreshTimeline() { this._buildLayerPanel(); this._renderTrack(); }

    _buildLayerPanel() {
        this.layerPanel.innerHTML = "";
        this._detailInputs = {};   // clear stale input refs; rebuilt below
        const rows = this._getLayerDefs();
        rows.forEach((row, ri) => {
            const el = document.createElement("div");
            Object.assign(el.style, {
                height:`${ROW_H}px`, display:"flex", alignItems:"center",
                padding:"0 6px", fontSize:"11px", cursor:"pointer",
                overflow:"hidden", whiteSpace:"nowrap", userSelect:"none", boxSizing:"border-box",
            });
            if (row.type === "group") {
                const isHiddenGrp = this.hiddenGroups.has(row.id);
                el.style.background = "#1e1e2e"; el.style.fontWeight = "bold";
                el.style.color = isHiddenGrp ? "#555" : "#aaa";
                el.style.cursor = "pointer";
                // Expand arrow + name
                const nameSpan = document.createElement("span");
                nameSpan.style.flex = "1";
                nameSpan.textContent = `${this.expandedGroups.has(row.id)?"▼":"▶"} ${row.name}`;
                el.appendChild(nameSpan);
                el.title = "Click: expand/collapse  |  Shift+Click: select all joints in group";
                // Eye button for group
                const eyeGrpBtn = document.createElement("button");
                eyeGrpBtn.textContent = isHiddenGrp ? "🙈" : "👁";
                eyeGrpBtn.title = isHiddenGrp ? "Show group in viewport" : "Hide group in viewport";
                Object.assign(eyeGrpBtn.style, {
                    background:"none", border:"none", cursor:"pointer", fontSize:"11px",
                    padding:"0 3px", flexShrink:"0", opacity: "1",
                });
                const _toggleGrpEye = () => {
                    if (this.hiddenGroups.has(row.id)) this.hiddenGroups.delete(row.id);
                    else this.hiddenGroups.add(row.id);
                    this._refreshTimeline(); this._renderFrame(this.currentFrame);
                };
                eyeGrpBtn.addEventListener("click", e2 => { e2.stopPropagation(); _toggleGrpEye(); });
                eyeGrpBtn.addEventListener("mouseenter", e2 => { if (e2.shiftKey) _toggleGrpEye(); });
                el.appendChild(eyeGrpBtn);
                if (row.id === "rhand" || row.id === "lhand") {
                    const isIk = this.handIkMode[row.id];
                    const ikBtn = document.createElement("button");
                    ikBtn.textContent = isIk ? "IK" : "FK";
                    ikBtn.title = isIk
                        ? "IK: fingers follow wrist — click to switch to FK"
                        : "FK: joints move independently — click to switch to IK";
                    Object.assign(ikBtn.style, {
                        background: isIk ? "#1a3a2a" : "#1e1e2e",
                        border: `1px solid ${isIk ? "#44bb66" : "#334"}`,
                        color: isIk ? "#88ffaa" : "#667",
                        borderRadius: "3px", padding: "0 5px", fontSize: "9px",
                        cursor: "pointer", flexShrink: "0", lineHeight: "16px",
                    });
                    ikBtn.addEventListener("click", e2 => {
                        e2.stopPropagation();
                        this.handIkMode[row.id] = !this.handIkMode[row.id];
                        this._refreshTimeline();
                    });
                    el.appendChild(ikBtn);
                }
                el.addEventListener("click", e => {
                    if (e.shiftKey) {
                        // Shift+click group: select ALL joints in this group
                        const groupRows = this._getLayerDefs().filter(r => r.type === "joint" && r.group === row.id);
                        for (const gr of groupRows) this.selectedJoints.add(gr.label);
                        if (groupRows.length > 0) {
                            this.selectedJoint = { group:groupRows[0].group, index:groupRows[0].index, label:groupRows[0].label };
                            this._updateJointInfo();
                        }
                    } else {
                        // Plain click: toggle expand/collapse
                        if (this.expandedGroups.has(row.id)) this.expandedGroups.delete(row.id);
                        else this.expandedGroups.add(row.id);
                    }
                    this._refreshTimeline(); this._renderFrame(this.currentFrame);
                    if (this.activeTab === "graph") this._renderGraphEditor();
                });
            } else if (row.type === "joint_detail") {
                // ---- Detail sub-row (X/Y or Conf) ----
                el.style.background = "#090914";
                el.style.borderLeft = `2px solid ${row.color}55`;
                el.style.cursor = "default";
                el.style.padding = "0 4px 0 10px";
                el.style.gap = "3px";

                if (!this._detailInputs[row.label]) this._detailInputs[row.label] = {};

                // Read effective value at current frame
                const detFd = this._getEffectiveFrame(this.currentFrame);
                const detPts = row.group==="body" ? detFd?.body : row.group==="rhand" ? detFd?.rhand : detFd?.lhand;
                const detPt = detPts?.[row.index] ?? [0, 0, 0];  // conf=0 when joint not in detection

                const writeDetail = (xOvr, yOvr, cOvr, zOvr) => {
                    const fi = this.currentFrame;
                    const fd2 = this._getEffectiveFrame(fi);
                    const gp  = row.group==="body" ? fd2?.body : row.group==="rhand" ? fd2?.rhand : fd2?.lhand;
                    const cur = gp?.[row.index] ?? [0, 0, 0];
                    const curZ = this.zDepth[fi]?.[row.label] ?? this.overrides[fi]?.[row.label]?.[3] ?? 0;
                    if (this._panelInputDragging) this._lazyPushUndo(); else this._pushUndo();
                    if (!this.overrides[fi]) this.overrides[fi] = {};
                    const z = zOvr !== undefined ? zOvr : curZ;
                    this.overrides[fi][row.label] = [
                        xOvr !== undefined ? xOvr : cur[0],
                        yOvr !== undefined ? yOvr : cur[1],
                        cOvr !== undefined ? Math.max(0, Math.min(1, cOvr)) : (cur[2] ?? 1),
                        z,
                    ];
                    if (zOvr !== undefined) {
                        if (!this.zDepth[fi]) this.zDepth[fi] = {};
                        this.zDepth[fi][row.label] = z;
                    }
                    this._renderFrame(fi); this._renderTrack(); this._updateDetailPanels();
                };

                const mkLbl = (t, w) => {
                    const s = document.createElement("span");
                    s.textContent = t;
                    s.style.cssText = `font-size:9px;color:#667;flex-shrink:0;min-width:${w}px;`;
                    return s;
                };
                const mkNumInp = (val, step) => {
                    const inp = document.createElement("input");
                    Object.assign(inp, { type:"number", value: val, step: String(step) });
                    Object.assign(inp.style, {
                        width:"46px", flex:"1", background:"#141428", color:"#aabbdd",
                        border:"1px solid #2a2a44", borderRadius:"2px",
                        padding:"0 3px", fontSize:"9px", height:"15px", boxSizing:"border-box",
                        cursor:"ew-resize",
                    });
                    inp.addEventListener("click", e2 => e2.stopPropagation());
                    let startX, startVal, moved;
                    const onMove = (ev) => {
                        const dx = ev.clientX - startX;
                        if (!moved && Math.abs(dx) < 3) return;
                        if (!moved) { moved = true; inp.blur(); document.body.style.cursor = "ew-resize"; }
                        inp.value = parseFloat((startVal + dx * step).toFixed(6));
                        if (!this._panelInputDragging) this._panelInputDragging = true;
                        inp.dispatchEvent(new Event("change"));
                    };
                    const onUp = () => {
                        document.removeEventListener("mousemove", onMove);
                        document.removeEventListener("mouseup", onUp);
                        document.body.style.cursor = "";
                        this._panelInputDragging = false;
                        if (moved) this._lazyPushUndo();
                        else inp.select();
                    };
                    inp.addEventListener("mousedown", e2 => {
                        e2.stopPropagation();
                        startX = e2.clientX;
                        startVal = parseFloat(inp.value) || 0;
                        moved = false;
                        this._armUndo();
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                    });
                    return inp;
                };

                if (row.detail === "xy") {
                    const xInp = mkNumInp(detPt[0].toFixed(1), 1);
                    const yInp = mkNumInp(detPt[1].toFixed(1), 1);
                    xInp.addEventListener("change", () => {
                        const v = parseFloat(xInp.value);
                        if (!isNaN(v)) writeDetail(v, undefined, undefined, undefined);
                        else xInp.value = detPt[0].toFixed(1);
                    });
                    yInp.addEventListener("change", () => {
                        const v = parseFloat(yInp.value);
                        if (!isNaN(v)) writeDetail(undefined, v, undefined, undefined);
                        else yInp.value = detPt[1].toFixed(1);
                    });
                    el.append(mkLbl("X", 10), xInp, mkLbl("Y", 10), yInp);
                    this._detailInputs[row.label].xInp = xInp;
                    this._detailInputs[row.label].yInp = yInp;
                } else if (row.detail === "z") {
                    const zVal = this.zDepth[this.currentFrame]?.[row.label]
                              ?? this.overrides[this.currentFrame]?.[row.label]?.[3] ?? 0;
                    const zInp = mkNumInp(zVal.toFixed(3), 0.01);
                    zInp.addEventListener("change", () => {
                        const v = parseFloat(zInp.value);
                        if (!isNaN(v)) writeDetail(undefined, undefined, undefined, v);
                        else zInp.value = zVal.toFixed(3);
                    });
                    el.append(mkLbl("Z", 10), zInp);
                    this._detailInputs[row.label].zInp = zInp;
                } else if (row.detail === "zoffset") {
                    const offVal = this.zGlobalOffset[row.label] ?? 0;
                    const offInp = mkNumInp(offVal.toFixed(3), 0.01);
                    offInp.style.color = "#88ddaa";
                    offInp.title = "Global Z offset — shifts this joint's depth across all frames";
                    offInp.addEventListener("change", () => {
                        const v = parseFloat(offInp.value);
                        if (!isNaN(v)) {
                            this.zGlobalOffset[row.label] = v;
                            this._renderFrame(this.currentFrame);
                        } else offInp.value = (this.zGlobalOffset[row.label] ?? 0).toFixed(3);
                    });
                    el.append(mkLbl("Z+", 14), offInp);
                    this._detailInputs[row.label].zOffsetInp = offInp;
                } else {
                    // conf row — show as 0–100 percentage for readability
                    const pct = ((detPt[2] ?? 1) * 100).toFixed(0);
                    const confInp = mkNumInp(pct, 1);
                    confInp.min = "0"; confInp.max = "100";
                    confInp.addEventListener("change", () => {
                        const v = parseFloat(confInp.value);
                        if (!isNaN(v)) writeDetail(undefined, undefined, v / 100);
                        else confInp.value = ((detPt[2]??1)*100).toFixed(0);
                    });
                    el.append(mkLbl("Conf %", 38), confInp);
                    this._detailInputs[row.label].confInp = confInp;
                }
            } else if (row.type === "wrist_rotation") {
                // ---- Wrist rotation sub-row: Rx Ry Rz inline ----
                el.style.background = "#0d0d14";
                el.style.borderLeft = "2px solid #aa88cc77";
                el.style.padding = "0 4px 0 10px";
                el.style.gap = "3px";
                el.style.cursor = "default";
                const mkRotLbl = (t) => {
                    const s = document.createElement("span");
                    s.textContent = t;
                    s.style.cssText = "font-size:9px;color:#667;flex-shrink:0;min-width:12px;";
                    return s;
                };
                if (!this._rotInputs) this._rotInputs = {};
                if (!this._rotInputs[row.label]) this._rotInputs[row.label] = {};
                const mkRotInp = (ch, color) => {
                    const key = `${row.label}::${ch}`;
                    const val = this.overrides[this.currentFrame]?.[key]
                             ?? this._interpolateChannel(row.label, ch, this.currentFrame) ?? 0;
                    const inp = document.createElement("input");
                    inp.type = "number"; inp.value = val.toFixed(1); inp.step = "1";
                    inp.min = "-180"; inp.max = "180";
                    Object.assign(inp.style, {
                        width:"40px", flex:"1", background:"#141428", color,
                        border:"1px solid #2a2a44", borderRadius:"2px",
                        padding:"0 2px", fontSize:"9px", height:"15px", boxSizing:"border-box",
                    });
                    inp.addEventListener("click", e2 => e2.stopPropagation());
                    inp.addEventListener("mousedown", e2 => e2.stopPropagation());
                    inp.addEventListener("change", () => {
                        const v = parseFloat(inp.value) || 0;
                        if (!this.overrides[this.currentFrame]) this.overrides[this.currentFrame] = {};
                        this.overrides[this.currentFrame][key] = v;
                        this._renderFrame(this.currentFrame);
                    });
                    this._rotInputs[row.label][ch] = inp;
                    return inp;
                };
                const degSpan2 = document.createElement("span");
                degSpan2.textContent = "°";
                degSpan2.style.cssText = "color:#555;font-size:9px;padding-left:1px;flex-shrink:0;";
                el.append(mkRotLbl("Rz"), mkRotInp("rz","#4488ff"), degSpan2);
            } else {
                // ---- Normal joint row ----
                const isActive = this.selectedJoint?.label === row.label;
                const isMultiSel = this.selectedJoints.has(row.label);
                const isLocked = this.lockedLayers.has(row.label);
                const isHidden = this.hiddenLayers.has(row.label) || this.hiddenGroups.has(row.group);
                el.style.background = isActive ? "#1a2a3a" : isMultiSel ? "#162230" : ri%2===0?"#111120":"#0e0e1c";
                if (isLocked || isHidden) el.style.opacity = isHidden ? "0.4" : "0.55";
                el.style.borderLeft = isMultiSel ? "2px solid #5599ff" : "2px solid transparent";

                // Detail expand arrow (▶/▼)
                const expandArrow = document.createElement("button");
                expandArrow.textContent = this.expandedJoints.has(row.label) ? "▼" : "▶";
                Object.assign(expandArrow.style, {
                    background:"none", border:"none", cursor:"pointer",
                    color: this.expandedJoints.has(row.label) ? "#88aacc" : "#445",
                    fontSize:"8px", padding:"0 3px 0 0", flexShrink:"0", lineHeight:"1",
                });
                expandArrow.title = "Show / hide position & confidence";
                expandArrow.addEventListener("click", e2 => {
                    e2.stopPropagation();
                    if (this.expandedJoints.has(row.label)) this.expandedJoints.delete(row.label);
                    else this.expandedJoints.add(row.label);
                    this._refreshTimeline();
                });
                el.appendChild(expandArrow);

                const dot = document.createElement("span");
                Object.assign(dot.style, { display:"inline-block", width:"6px", height:"6px", borderRadius:"50%", background:row.color, marginRight:"5px", flexShrink:"0" });
                el.appendChild(dot);
                const nameEl = document.createElement("span");
                nameEl.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;";
                nameEl.textContent = row.name;
                el.appendChild(nameEl);
                // Eye button for individual joint
                const eyeBtn = document.createElement("button");
                const isJointHidden = this.hiddenLayers.has(row.label);
                eyeBtn.textContent = isJointHidden ? "🙈" : "👁";
                eyeBtn.title = isJointHidden ? "Show joint in viewport" : "Hide joint in viewport (editing aid — does not affect output)";
                Object.assign(eyeBtn.style, {
                    background:"none", border:"none", cursor:"pointer", fontSize:"9px",
                    padding:"0 1px", flexShrink:"0", opacity: isJointHidden ? "1" : "0.25",
                });
                const _toggleJointEye = () => {
                    if (this.hiddenLayers.has(row.label)) this.hiddenLayers.delete(row.label);
                    else this.hiddenLayers.add(row.label);
                    this._refreshTimeline(); this._renderFrame(this.currentFrame);
                };
                eyeBtn.addEventListener("click", e2 => { e2.stopPropagation(); _toggleJointEye(); });
                eyeBtn.addEventListener("mouseenter", e2 => { eyeBtn.style.opacity = "1"; if (e2.shiftKey) _toggleJointEye(); });
                eyeBtn.addEventListener("mouseleave", () => { eyeBtn.style.opacity = this.hiddenLayers.has(row.label) ? "1" : "0.25"; });
                el.appendChild(eyeBtn);
                // Lock button
                const lockBtn = document.createElement("button");
                lockBtn.textContent = isLocked ? "🔒" : "🔓";
                lockBtn.title = isLocked ? "Unlock layer" : "Lock layer (prevents editing)";
                Object.assign(lockBtn.style, {
                    background:"none", border:"none", cursor:"pointer", fontSize:"10px",
                    padding:"0 2px", flexShrink:"0", opacity: isLocked ? "1" : "0.3",
                });
                const _toggleLock = () => {
                    if (this.lockedLayers.has(row.label)) this.lockedLayers.delete(row.label);
                    else this.lockedLayers.add(row.label);
                    this._refreshTimeline(); this._renderFrame(this.currentFrame);
                };
                lockBtn.addEventListener("click", e2 => { e2.stopPropagation(); _toggleLock(); });
                lockBtn.addEventListener("mouseenter", e2 => { lockBtn.style.opacity = "1"; if (e2.shiftKey) _toggleLock(); });
                lockBtn.addEventListener("mouseleave", () => { lockBtn.style.opacity = this.lockedLayers.has(row.label) ? "1" : "0.3"; });
                el.appendChild(lockBtn);
                el.addEventListener("click", e => {
                    if (e.shiftKey && this._lastClickedLayerLabel) {
                        // Range select: select all joint rows between last click and this one
                        const allJointRows = this._getLayerDefs().filter(r => r.type === "joint");
                        const lastIdx = allJointRows.findIndex(r => r.label === this._lastClickedLayerLabel);
                        const thisIdx = allJointRows.findIndex(r => r.label === row.label);
                        if (lastIdx !== -1 && thisIdx !== -1) {
                            const lo = Math.min(lastIdx, thisIdx), hi = Math.max(lastIdx, thisIdx);
                            for (let i = lo; i <= hi; i++) this.selectedJoints.add(allJointRows[i].label);
                        } else {
                            this.selectedJoints.add(row.label);
                        }
                    } else if (e.ctrlKey) {
                        // Ctrl: toggle individual without clearing others
                        if (this.selectedJoints.has(row.label)) this.selectedJoints.delete(row.label);
                        else this.selectedJoints.add(row.label);
                        this._lastClickedLayerLabel = row.label;
                    } else {
                        // Plain click: select only this joint
                        this.selectedJoints.clear();
                        this.selectedJoints.add(row.label);
                        this._lastClickedLayerLabel = row.label;
                    }
                    this.selectedJoint = { group:row.group, index:row.index, label:row.label };
                    this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
                    if (this.activeTab === "graph") { this._graphAutoFitRange(); this._renderGraphEditor(); }
                });
            }
            this.layerPanel.appendChild(el);
        });
    }

    _frameW() {
        const avail = this.trackWrapper?.clientWidth || 400;
        return Math.max(4, Math.min(20, Math.floor(avail / Math.max(1, this.frameCount))));
    }

    // Non-linear frame ↔ pixel mapping for zone-based timeline layout.
    // Pre zone  (frames [0, rangeStart-1]):    compressed into PRE_W  = 60px
    // Mid zone  (frames [rangeStart, rangeEnd]):  expanded  into MID_W px
    // Post zone (frames [rangeEnd+1, fc-1]):   compressed into POST_W = 60px
    // When range covers the full video, PRE=0 and POST=0 → linear layout.

    _frameToX(fi) {
        const W   = this.trackWrapper?.clientWidth || 400;
        const rs  = this.frameRangeStart, re = this.frameRangeEnd, fc = this.frameCount;
        const PRE  = rs > 0      ? 60 : 0;
        const POST = re < fc - 1 ? 60 : 0;
        const MID  = W - PRE - POST;
        if (fi < rs) {
            return PRE * (fi + 0.5) / Math.max(1, rs);
        } else if (fi <= re) {
            return PRE + MID * (fi - rs + 0.5) / Math.max(1, re - rs + 1);
        } else {
            return PRE + MID + POST * (fi - re - 1 + 0.5) / Math.max(1, fc - 1 - re);
        }
    }

    _framePxAt(fi) {
        const W   = this.trackWrapper?.clientWidth || 400;
        const rs  = this.frameRangeStart, re = this.frameRangeEnd, fc = this.frameCount;
        const PRE  = rs > 0      ? 60 : 0;
        const POST = re < fc - 1 ? 60 : 0;
        const MID  = W - PRE - POST;
        if (fi < rs)  return PRE  / Math.max(1, rs);
        if (fi <= re) return MID  / Math.max(1, re - rs + 1);
        return POST / Math.max(1, fc - 1 - re);
    }

    _xToFrame(x) {
        const W   = this.trackWrapper?.clientWidth || 400;
        const rs  = this.frameRangeStart, re = this.frameRangeEnd, fc = this.frameCount;
        const PRE  = rs > 0      ? 60 : 0;
        const POST = re < fc - 1 ? 60 : 0;
        const MID  = W - PRE - POST;
        let fi;
        if (x <= PRE && PRE > 0) {
            fi = Math.floor((x / PRE) * rs);
        } else if (x >= W - POST && POST > 0) {
            fi = re + 1 + Math.floor(((x - (W - POST)) / POST) * (fc - 1 - re));
        } else {
            fi = rs + Math.floor(((x - PRE) / Math.max(1, MID)) * (re - rs + 1));
        }
        return Math.max(0, Math.min(fc - 1, fi));
    }

    _renderTrack() {
        if (!this.trackCanvas || this.frameCount === 0) return;
        const rows = this._getLayerDefs();
        const W = this.trackWrapper?.clientWidth || 400;
        const H = rows.length * ROW_H;
        this.trackCanvas.width = W; this.trackCanvas.height = Math.max(H, 1);
        const ctx = this.trackCanvas.getContext("2d");

        // Zone metrics
        const rs = this.frameRangeStart, re = this.frameRangeEnd;
        const PRE_W  = rs > 0              ? 60 : 0;
        const POST_W = re < this.frameCount - 1 ? 60 : 0;
        const MID_W  = W - PRE_W - POST_W;

        // Pre/post zone darkening
        if (PRE_W > 0)  { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(0, 0, PRE_W, H); }
        if (POST_W > 0) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(PRE_W + MID_W, 0, POST_W, H); }

        // Row backgrounds
        rows.forEach((row, ri) => {
            ctx.fillStyle = row.type==="group" ? "#1a1a2c" : ri%2===0?"#111122":"#0e0e1e";
            ctx.fillRect(0, ri*ROW_H, W, ROW_H);
        });

        // Re-apply zone darkening on top of row backgrounds
        if (PRE_W > 0)  { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, 0, PRE_W, H); }
        if (POST_W > 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(PRE_W + MID_W, 0, POST_W, H); }

        // Frame grid — major at /10, minor at /5; skip dense frames in compressed zones
        ctx.lineWidth = 1;
        for (let fi=0; fi<this.frameCount; fi++) {
            if (this._framePxAt(fi) < 3 && fi % 10 !== 0) continue;
            const x = this._frameToX(fi);
            if (fi % 10 === 0) {
                ctx.strokeStyle = "#2a2a42";
                ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
                ctx.fillStyle = "#556"; ctx.font = "9px monospace";
                ctx.fillText(String(fi), x+2, 10);
            } else if (fi % 5 === 0) {
                ctx.strokeStyle = "#1e1e30";
                ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
            }
        }

        // Range IN / OUT boundary markers
        if (PRE_W > 0) {
            ctx.strokeStyle = "#44aaff"; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(PRE_W, 0); ctx.lineTo(PRE_W, H); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#44aaff"; ctx.font = "bold 9px monospace";
            ctx.fillText("IN", PRE_W + 2, 10);
        }
        if (POST_W > 0) {
            const xOut = PRE_W + MID_W;
            ctx.strokeStyle = "#ff8844"; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(xOut, 0); ctx.lineTo(xOut, H); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#ff8844"; ctx.font = "bold 9px monospace";
            ctx.fillText("OUT", xOut + 2, 10);
        }

        // Row dividers
        ctx.strokeStyle = "#1e1e30"; ctx.lineWidth = 1;
        rows.forEach((_, ri) => {
            ctx.beginPath(); ctx.moveTo(0,ri*ROW_H-0.5); ctx.lineTo(W,ri*ROW_H-0.5); ctx.stroke();
        });

        // Current frame highlight
        const cfx = this._frameToX(this.currentFrame);
        const cfw = this._framePxAt(this.currentFrame);
        ctx.fillStyle = "rgba(80,100,240,0.15)"; ctx.fillRect(cfx - cfw/2, 0, cfw, H);
        ctx.strokeStyle = "#6677ee"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cfx, 0); ctx.lineTo(cfx, H); ctx.stroke();

        // Tween lines (colored by interpolation mode per segment)
        rows.forEach((row, ri) => {
            if (row.type !== "joint") return;
            if (this.hiddenGroups.has(row.group) || this.hiddenLayers.has(row.label)) return;
            const kfs = this._getKeyframesForJoint(row.label);
            if (kfs.length < 2) return;
            const y = ri*ROW_H + ROW_H/2;
            for (let i=0; i<kfs.length-1; i++) {
                const x0 = this._frameToX(kfs[i]), x1 = this._frameToX(kfs[i+1]);
                const segMode = this.tweens[kfs[i]]?.[row.label] ?? this.interpolationMode;
                const segColor = segMode === "catmull_rom" ? "#33ee99" :
                                 segMode === "constant"    ? "#666677" :
                                 (segMode.startsWith("back")||segMode.startsWith("elastic")||segMode==="bounce_out") ? "#ff8844" :
                                 row.color + "99";
                ctx.strokeStyle = segColor; ctx.lineWidth = 2;
                ctx.setLineDash([4,3]);
                ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
                ctx.setLineDash([]);
            }
        });

        // Keyframe icons — shape encodes interpolation type (AE-style)
        // diamond=linear, circle=smooth(catmull_rom/cubic/etc), square=hold/constant, ease=hourglass
        const KFSZ = 9, KFSZ_SEL = 12, KFSZ_CUR = 10;

        const kfShape = m => {
            if (!m || m === 'linear') return 'diamond';
            if (m === 'constant')     return 'square';
            if (m === 'ease')         return 'ease';
            return 'circle';  // catmull_rom, ease_in, ease_out, cubic_*, back_*, elastic_out, etc.
        };

        const drawKfPath = (shape, sz) => {
            ctx.beginPath();
            const r = sz * 0.5;
            if (shape === 'square') {
                ctx.rect(-r * 0.88, -r * 0.88, r * 1.76, r * 1.76);
            } else if (shape === 'circle') {
                ctx.arc(0, 0, r * 1.08, 0, Math.PI * 2);
            } else if (shape === 'ease') {
                // Hourglass: diamond pinched inward at sides
                const w = r * 0.52;
                ctx.moveTo(0, -r);
                ctx.bezierCurveTo( w, -r * 0.22,  w,  r * 0.22, 0,  r);
                ctx.bezierCurveTo(-w,  r * 0.22, -w, -r * 0.22, 0, -r);
                ctx.closePath();
            } else {
                // Diamond
                ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
                ctx.closePath();
            }
        };

        rows.forEach((row, ri) => {
            if (row.type !== "joint") return;
            if (this.hiddenGroups.has(row.group) || this.hiddenLayers.has(row.label)) return;
            const kfs = this._getKeyframesForJoint(row.label);
            const y = ri * ROW_H + ROW_H / 2;

            kfs.forEach((fi, kfIdx) => {
                const key = `${fi}::${row.label}`;
                const isMultiSel  = this.selKfs.has(key);
                const isJointSel  = this.selectedJoint?.label === row.label;
                const isCurAndSel = fi === this.currentFrame && isJointSel;
                const sz = isMultiSel ? KFSZ_SEL : isCurAndSel ? KFSZ_CUR : KFSZ;
                const x  = this._frameToX(fi);

                // Outgoing = tween leaving this KF; incoming = tween arriving at this KF
                const prevFi  = kfIdx > 0               ? kfs[kfIdx - 1] : null;
                const nextFi  = kfIdx < kfs.length - 1  ? kfs[kfIdx + 1] : null;
                const gm      = this.interpolationMode;
                const outMode = nextFi !== null ? (this.tweens[fi]?.[row.label]     || gm) : null;
                const inMode  = prevFi !== null ? (this.tweens[prevFi]?.[row.label] || gm) : null;
                const outShape = outMode ? kfShape(outMode) : null;
                const inShape  = inMode  ? kfShape(inMode)  : null;
                const baseShape = outShape || inShape || 'diamond';
                const sameShape = !outShape || !inShape || outShape === inShape;

                const baseColor = isMultiSel ? "#55ddff" : isCurAndSel ? "#ffe44a" : (row.color || "#ffd700");
                const strokeC   = isMultiSel ? "#0088cc" : "#111";
                const strokeW   = isMultiSel ? 1.5 : 0.8;

                ctx.save();
                ctx.translate(x, y);

                // Selection glow
                if (isMultiSel) {
                    drawKfPath(baseShape, sz + 5);
                    ctx.fillStyle = "rgba(100,200,255,0.22)";
                    ctx.fill();
                }

                if (sameShape) {
                    // Single unified icon
                    drawKfPath(baseShape, sz);
                    ctx.fillStyle   = baseColor;
                    ctx.strokeStyle = strokeC;
                    ctx.lineWidth   = strokeW;
                    ctx.fill();
                    ctx.stroke();
                } else {
                    // Split: left half = incoming shape, right half = outgoing shape
                    for (const [side, shape] of [['left', inShape], ['right', outShape]]) {
                        ctx.save();
                        ctx.beginPath();
                        if (side === 'left') ctx.rect(-sz * 2.5, -sz * 2, sz * 2.5, sz * 4);
                        else                 ctx.rect(0,          -sz * 2, sz * 2.5, sz * 4);
                        ctx.clip();
                        drawKfPath(shape, sz);
                        ctx.fillStyle   = baseColor;
                        ctx.strokeStyle = strokeC;
                        ctx.lineWidth   = strokeW;
                        ctx.fill();
                        ctx.stroke();
                        ctx.restore();
                    }
                    // Hairline divider between halves
                    ctx.strokeStyle = "#000";
                    ctx.lineWidth   = 1;
                    ctx.beginPath();
                    ctx.moveTo(0, -sz * 0.6);
                    ctx.lineTo(0,  sz * 0.6);
                    ctx.stroke();
                }

                ctx.restore();
            });
        });

        // Sub-rows: joint_detail (position/conf) and wrist_rotation
        rows.forEach((row, ri) => {
            const ry2 = ri * ROW_H + ROW_H / 2;
            if (row.type === "joint_detail") {
                if (row.detail === "zoffset") return;  // global offset, no per-frame keyframes
                const detKfs = row.detail === "z"
                    ? Object.keys(this.zDepth).map(Number).filter(fi => this.zDepth[fi]?.[row.label] !== undefined).sort((a,b)=>a-b)
                    : Object.keys(this.overrides).map(Number).filter(fi => this.overrides[fi]?.[row.label] !== undefined).sort((a,b)=>a-b);
                if (detKfs.length === 0) return;
                const detColor = row.detail === "z" ? "#557799" : row.detail === "xy" ? "#6688bb" : "#558855";
                for (const fi of detKfs) {
                    const x2 = this._frameToX(fi);
                    ctx.fillStyle = detColor; ctx.strokeStyle = "#111"; ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(x2, ry2-KFSZ/2); ctx.lineTo(x2+KFSZ/2, ry2);
                    ctx.lineTo(x2, ry2+KFSZ/2); ctx.lineTo(x2-KFSZ/2, ry2);
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                }
            } else if (row.type === "wrist_rotation") {
                // Draw colored diamonds per rotation channel, with selection highlight
                for (const ch of ["rx","ry","rz"]) {
                    const chColor = ch==="rx"?"#ff8844":ch==="ry"?"#44bbff":"#ffdd44";
                    const kfs = this._getKeyframesForChannel(row.label, ch);
                    for (const fi of kfs) {
                        const key3 = `${fi}::${row.label}::${ch}`;
                        const isSel = this.selKfs.has(key3);
                        const x2 = this._frameToX(fi);
                        const sz = isSel ? KFSZ_SEL : KFSZ;
                        ctx.fillStyle = isSel ? "#ffffff" : chColor;
                        ctx.strokeStyle = "#111"; ctx.lineWidth = isSel ? 1.5 : 0.8;
                        ctx.beginPath();
                        ctx.moveTo(x2, ry2-sz/2); ctx.lineTo(x2+sz/2, ry2);
                        ctx.lineTo(x2, ry2+sz/2); ctx.lineTo(x2-sz/2, ry2);
                        ctx.closePath(); ctx.fill(); ctx.stroke();
                    }
                }
            }
        });

        // Rubber-band selection rect
        if (this._trackDrag?.mode === "rubber_band" && this._trackDrag.moved) {
            const {startX,startY,curX,curY} = this._trackDrag;
            const rx=Math.min(startX,curX), ry=Math.min(startY,curY);
            const rw=Math.abs(curX-startX), rh=Math.abs(curY-startY);
            ctx.fillStyle = "rgba(80,160,255,0.12)"; ctx.fillRect(rx,ry,rw,rh);
            ctx.strokeStyle = "#5599ff"; ctx.lineWidth = 1; ctx.setLineDash([3,2]);
            ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]);
        }
    }

    _trackCanvasPos(e) {
        // getBoundingClientRect already reflects scroll (canvas shifts up/left on screen
        // as the wrapper scrolls), so no scrollTop/scrollLeft addition needed.
        const rect = this.trackCanvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onTrackMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const {x, y} = this._trackCanvasPos(e);
        const fi  = this._xToFrame(x);
        const ri  = Math.floor(y/ROW_H);
        const row = this._getLayerDefs()[ri];

        // Update joint selection immediately so viewport updates
        if (row?.type === "joint") {
            this.selectedJoint = { group: row.group, index: row.index, label: row.label };
            if (!e.shiftKey) this.selectedJoints.clear();
            this.selectedJoints.add(row.label);
            this._updateJointInfo(); this._renderFrame(this.currentFrame);
            if (this.activeTab === "graph") { this._graphAutoFitRange(); this._renderGraphEditor(); }
        }

        this._seekFrame(fi);

        // Detect if we're clicking on an existing diamond — use pixel-radius hit detection
        // so clicks near (not exactly on) a keyframe icon still register.
        const rowIsHidden = row?.type === "joint" && (this.hiddenGroups.has(row.group) || this.hiddenLayers.has(row.label));
        let hitFi = null;
        let hitCh = null;
        if (row?.type === "joint" && !rowIsHidden) {
            const KF_HIT_PX = 10;
            let minDist = KF_HIT_PX;
            for (const kf of this._getKeyframesForJoint(row.label)) {
                const d = Math.abs(this._frameToX(kf) - x);
                if (d < minDist) { minDist = d; hitFi = kf; }
            }
        } else if (row?.type === "wrist_rotation") {
            const KF_HIT_PX = 10;
            let minDist = KF_HIT_PX;
            for (const ch of ["rx","ry","rz"]) {
                for (const kf of this._getKeyframesForChannel(row.label, ch)) {
                    const d = Math.abs(this._frameToX(kf) - x);
                    if (d < minDist) { minDist = d; hitFi = kf; hitCh = ch; }
                }
            }
        }
        const key = hitFi !== null
            ? (hitCh ? `${hitFi}::${row.label}::${hitCh}` : `${hitFi}::${row.label}`)
            : null;
        const hasDiamond = key !== null;
        const onSelectedDiamond = hasDiamond && this.selKfs.has(key) && !e.shiftKey;
        const shiftOnDiamond    = hasDiamond && this.selKfs.has(key) && e.shiftKey;

        // Build drag state object
        const trackMode = onSelectedDiamond ? "kf_move" : shiftOnDiamond ? "kf_duplicate" : "rubber_band";
        this._trackDrag = {
            startX: x, startY: y, curX: x, curY: y,
            fi, row, key, hasDiamond,
            shiftKey: e.shiftKey,
            moved: false,          // true once threshold crossed
            mode: trackMode,
            origOverrides: (onSelectedDiamond || shiftOnDiamond) ? JSON.parse(JSON.stringify(this.overrides)) : null,
            startFi: hitFi !== null ? hitFi : fi,
        };

        this._renderTrack();

        // Attach document-level listeners so drag continues outside the canvas
        this._trackDocMove = ev => this._onTrackMouseMove(ev);
        this._trackDocUp   = ev => this._onTrackMouseUp(ev);
        document.addEventListener("mousemove", this._trackDocMove);
        document.addEventListener("mouseup",   this._trackDocUp);
    }

    _onTrackMouseMove(e) {
        if (!this._trackDrag) return;
        const {x, y} = this._trackCanvasPos(e);
        const drag = this._trackDrag;
        drag.curX = x; drag.curY = y;

        // Threshold to confirm drag
        if (!drag.moved) {
            const dx = Math.abs(x - drag.startX), dy = Math.abs(y - drag.startY);
            if (dx <= 3 && dy <= 3) { this._renderTrack(); return; }
            drag.moved = true;
            if (drag.mode === "kf_move") this._pushUndo(); // push once on first move
        }

        if (drag.mode === "kf_move" || drag.mode === "kf_duplicate") {
            const isDup = drag.mode === "kf_duplicate";
            const deltaFi = this._xToFrame(x) - drag.startFi;
            if (deltaFi !== this._lastKfMoveDelta) {
                this._lastKfMoveDelta = deltaFi;
                // Restore snapshot (originals always intact in origOverrides)
                this.overrides = JSON.parse(JSON.stringify(drag.origOverrides));
                this.tweens    = {};
                const toAdd = [];
                for (const key of this.selKfs) {
                    const parts = key.split("::");
                    const origFi = parseInt(parts[0]);
                    const newFi = Math.max(0, Math.min(this.frameCount-1, origFi + deltaFi));
                    if (parts.length === 3) {
                        // Channel keyframe: "fi::label::ch"
                        const chKey = `${parts[1]}::${parts[2]}`;
                        if (this.overrides[origFi]?.[chKey] !== undefined)
                            toAdd.push({ origFi, newFi, chKey, data: this.overrides[origFi][chKey], isChannel: true });
                    } else {
                        const label = parts[1];
                        if (this.overrides[origFi]?.[label] !== undefined)
                            toAdd.push({ origFi, newFi, label, data: [...this.overrides[origFi][label]], isChannel: false });
                    }
                }
                if (!isDup) {
                    // Move: remove from original positions
                    for (const { origFi, label, chKey, isChannel } of toAdd) {
                        if (!this.overrides[origFi]) continue;
                        if (isChannel) delete this.overrides[origFi][chKey];
                        else delete this.overrides[origFi][label];
                        if (Object.keys(this.overrides[origFi]).length === 0) delete this.overrides[origFi];
                    }
                }
                // Write at new positions
                for (const { newFi, label, chKey, data, isChannel } of toAdd) {
                    if (!this.overrides[newFi]) this.overrides[newFi] = {};
                    if (isChannel) this.overrides[newFi][chKey] = data;
                    else this.overrides[newFi][label] = data;
                }
                // selKfs tracks the moved/duplicated positions
                const newSel = new Set();
                for (const key of this.selKfs) {
                    const parts = key.split("::");
                    const origFi = parseInt(parts[0]);
                    const newFi = Math.max(0, Math.min(this.frameCount-1, origFi + deltaFi));
                    if (parts.length === 3) newSel.add(`${newFi}::${parts[1]}::${parts[2]}`);
                    else newSel.add(`${newFi}::${parts[1]}`);
                }
                this.selKfs = newSel;
                this._renderTrack(); this._renderFrame(this.currentFrame);
            }
        } else {
            // Rubber-band selection — also seek frame under cursor
            const hoverFi = this._xToFrame(x);
            this._seekFrame(hoverFi);
            this._renderTrack();
        }
    }

    _onTrackMouseUp(e) {
        // Remove document-level listeners first
        if (this._trackDocMove) { document.removeEventListener("mousemove", this._trackDocMove); this._trackDocMove = null; }
        if (this._trackDocUp)   { document.removeEventListener("mouseup",   this._trackDocUp);   this._trackDocUp   = null; }

        const drag = this._trackDrag;
        this._trackDrag = null;
        if (!drag) return;

        if (drag.mode === "kf_move" || drag.mode === "kf_duplicate") {
            if (!drag.moved) {
                // Pure click (no drag): toggle selection
                if (drag.key) {
                    if (drag.shiftKey) {
                        if (this.selKfs.has(drag.key)) this.selKfs.delete(drag.key);
                        else this.selKfs.add(drag.key);
                    } else {
                        this.selKfs.clear(); this.selKfs.add(drag.key);
                    }
                }
                // Restore overrides (nothing actually changed in the data)
                if (drag.origOverrides) this.overrides = drag.origOverrides;
            } else {
                // Drag completed: selKfs already updated in _onTrackMouseMove
                this._lastKfMoveDelta = 0;
                this._refreshTimeline();
            }
            this._renderTrack();
            return;
        }

        // Rubber-band mode
        if (!drag.moved) {
            // Pure click — toggle diamond selection
            const { fi, row, key, hasDiamond, shiftKey } = drag;
            if ((row?.type === "joint" || row?.type === "wrist_rotation") && key) {
                if (hasDiamond) {
                    if (shiftKey) {
                        if (this.selKfs.has(key)) this.selKfs.delete(key);
                        else this.selKfs.add(key);
                    } else {
                        this.selKfs.clear(); this.selKfs.add(key);
                    }
                } else {
                    if (!shiftKey) this.selKfs.clear();
                }
            } else {
                if (!shiftKey) this.selKfs.clear();
            }
            this._renderTrack();
            return;
        }

        // Real rubber-band — select keyframes in rect
        const minX = Math.min(drag.startX, drag.curX), maxX = Math.max(drag.startX, drag.curX);
        const minY = Math.min(drag.startY, drag.curY), maxY = Math.max(drag.startY, drag.curY);
        const fi0 = this._xToFrame(minX);
        const fi1 = this._xToFrame(maxX);
        const ri0 = Math.floor(minY / ROW_H), ri1 = Math.floor(maxY / ROW_H);
        const rows = this._getLayerDefs();
        if (!drag.shiftKey) this.selKfs.clear();
        for (let ri = ri0; ri <= ri1; ri++) {
            const row = rows[ri]; if (!row) continue;
            if (row.type === "joint") {
                if (this.hiddenGroups.has(row.group) || this.hiddenLayers.has(row.label)) continue;
                for (let fi = fi0; fi <= fi1; fi++)
                    if (this.overrides[fi]?.[row.label] !== undefined)
                        this.selKfs.add(`${fi}::${row.label}`);
            } else if (row.type === "wrist_rotation") {
                for (const ch of ["rx","ry","rz"])
                    for (let fi = fi0; fi <= fi1; fi++)
                        if (this.overrides[fi]?.[`${row.label}::${ch}`] !== undefined)
                            this.selKfs.add(`${fi}::${row.label}::${ch}`);
            }
        }
        this._renderTrack();
    }

    _onTrackRightClick(e) {
        const rect = this.trackCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const fi  = this._xToFrame(x);
        const ri  = Math.floor(y/ROW_H);
        const row = this._getLayerDefs()[ri];
        if (!row || (row.type !== "joint" && row.type !== "wrist_rotation")) return;
        if (row.type === "wrist_rotation") {
            // Right-click on rotation diamond → delete that channel keyframe
            const KF_HIT_PX = 10;
            let hitFi = null, hitCh = null, minDist = KF_HIT_PX;
            for (const ch of ["rx","ry","rz"]) {
                for (const kf of this._getKeyframesForChannel(row.label, ch)) {
                    const d = Math.abs(this._frameToX(kf) - x);
                    if (d < minDist) { minDist = d; hitFi = kf; hitCh = ch; }
                }
            }
            if (hitFi !== null && hitCh !== null) {
                this._pushUndo();
                const chKey = `${row.label}::${hitCh}`;
                if (this.overrides[hitFi]) {
                    delete this.overrides[hitFi][chKey];
                    if (Object.keys(this.overrides[hitFi]).length === 0) delete this.overrides[hitFi];
                }
                this._refreshTimeline(); this._renderFrame(hitFi);
            }
            return;
        }
        const kfs = this._getKeyframesForJoint(row.label);
        // Radius-based hit detection for right-click delete
        const KF_HIT_PX = 10;
        let hitFi = null, minDist = KF_HIT_PX;
        for (const kf of kfs) {
            const d = Math.abs(this._frameToX(kf) - x);
            if (d < minDist) { minDist = d; hitFi = kf; }
        }
        if (hitFi !== null) {
            // Right-click on a diamond → delete keyframe
            this._deleteKeyframe(row.label, hitFi);
        } else if (kfs.length >= 2) {
            // Right-click between keyframes → per-segment easing popup
            let leftFi = -1;
            for (let i=kfs.length-1; i>=0; i--) if (kfs[i] < fi) { leftFi=kfs[i]; break; }
            if (leftFi !== -1) {
                const rightFi = kfs[kfs.findIndex(f=>f>fi)];
                if (rightFi !== undefined)
                    this._showSegmentPopup(row.label, leftFi, rightFi, e.clientX, e.clientY);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Undo / Redo
    // -----------------------------------------------------------------------
    _snapshot() {
        return {
            overrides: JSON.parse(JSON.stringify(this.overrides)),
            zDepth:    JSON.parse(JSON.stringify(this.zDepth)),
            tweens:    JSON.parse(JSON.stringify(this.tweens)),
        };
    }
    _pushUndo() {
        this._undoStack.push(this._snapshot());
        if (this._undoStack.length > 30) this._undoStack.shift();
        this._redoStack = [];
        this._dragPreState = null;   // any explicit push clears lazy state
    }
    /** Call at drag start — captures state for lazy push on first actual change. */
    _armUndo() {
        this._dragPreState = this._snapshot();
    }
    /** Call before modifying overrides/zDepth during a drag. */
    _lazyPushUndo() {
        if (this._dragPreState === null) return;
        this._undoStack.push(this._dragPreState);
        if (this._undoStack.length > 30) this._undoStack.shift();
        this._redoStack = [];
        this._dragPreState = null;
    }
    _undo() {
        if (!this._undoStack.length) return;
        this._redoStack.push(this._snapshot());
        const s = this._undoStack.pop();
        this.overrides = s.overrides; this.zDepth = s.zDepth; this.tweens = s.tweens;
        this._renderFrame(this.currentFrame); this._refreshTimeline();
        if (this.activeTab === "graph") this._renderGraphEditor();
    }
    _redo() {
        if (!this._redoStack.length) return;
        this._undoStack.push(this._snapshot());
        const s = this._redoStack.pop();
        this.overrides = s.overrides; this.zDepth = s.zDepth; this.tweens = s.tweens;
        this._renderFrame(this.currentFrame); this._refreshTimeline();
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    // -----------------------------------------------------------------------
    // Multi-select operations
    // -----------------------------------------------------------------------
    _deleteSelectedKeyframes() {
        if (this.selKfs.size === 0) return;
        this._pushUndo();
        for (const key of this.selKfs) {
            const parts = key.split("::");
            if (parts.length === 3) {
                // Channel keyframe: "fi::label::ch"
                const fi = parseInt(parts[0]);
                const chKey = `${parts[1]}::${parts[2]}`;
                if (this.overrides[fi]) {
                    delete this.overrides[fi][chKey];
                    if (Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
                }
            } else {
                this._deleteKeyframeRaw(parts[1], parseInt(parts[0]));
            }
        }
        this.selKfs.clear();
        this._refreshTimeline(); this._renderFrame(this.currentFrame);
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    /** Delete all keyframes strictly before the current frame (for selected joints or all joints). */
    _trimKeyframesBefore() {
        this._trimKeyframes(fi => fi < this.currentFrame);
    }

    /** Delete all keyframes strictly after the current frame (for selected joints or all joints). */
    _trimKeyframesAfter() {
        this._trimKeyframes(fi => fi > this.currentFrame);
    }

    _trimKeyframes(predicate) {
        const targets = new Set(
            this.selectedJoints.size > 0
                ? [...this.selectedJoints]
                : this._getLayerDefs().filter(r => r.type === "joint").map(r => r.label)
        );
        // Check if there's anything to remove before touching the stack
        let hasTargets = false;
        for (const fi of Object.keys(this.overrides).map(Number)) {
            if (!predicate(fi)) continue;
            if (Object.keys(this.overrides[fi] || {}).some(lbl => targets.has(lbl))) { hasTargets = true; break; }
        }
        if (!hasTargets) return;
        this._pushUndo();   // capture state BEFORE deletion
        for (const fi of Object.keys(this.overrides).map(Number)) {
            if (!predicate(fi)) continue;
            for (const label of Object.keys(this.overrides[fi] || {})) {
                if (!targets.has(label)) continue;
                if (this.lockedLayers.has(label)) continue;  // respect layer lock
                delete this.overrides[fi][label];
                if (this.tweens[fi]) delete this.tweens[fi][label];
            }
            if (this.overrides[fi] && Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
            if (this.tweens[fi]   && Object.keys(this.tweens[fi]).length   === 0) delete this.tweens[fi];
        }
        this._refreshTimeline(); this._renderFrame(this.currentFrame);
        if (this.activeTab === "graph") this._renderGraphEditor();
    }


    _toggleAutoKeyframe() {
        this.autoKeyframe = !this.autoKeyframe;
        // Discard any temp keys when turning OFF
        if (!this.autoKeyframe) this._tempKeys.clear();
        this._updateAutoKfBtn();
    }

    _updateAutoKfBtn() {
        const on = this.autoKeyframe;
        const style = { background: on ? "#6a2a1a" : "#3a2a1a", borderColor: on ? "#dd5533" : "#444",
            color: on ? "#ffaa88" : "#aaa", fontWeight: on ? "bold" : "normal" };
        for (const btn of [this.autoKfBtn, this.graphAutoKfBtn]) {
            if (!btn) continue;
            Object.assign(btn.style, style);
            btn.textContent = on ? "⬤ Auto Key ON" : "⬤ Auto Key OFF";
        }
    }

    _copySelectedKeyframes() {
        if (this.selKfs.size === 0 && this.selectedJoint) {
            // If nothing selected, copy all keyframes of selected joint
            const { label } = this.selectedJoint;
            for (const fi of this._getKeyframesForJoint(label))
                this.selKfs.add(`${fi}::${label}`);
        }
        if (this.selKfs.size === 0) return;
        const anchorFi = this.currentFrame;
        this._kfClipboard = { anchorFi, entries: [] };
        for (const key of this.selKfs) {
            const [fStr, label] = key.split("::");
            const fi = parseInt(fStr);
            const data = this.overrides[fi]?.[label];
            if (data !== undefined)
                this._kfClipboard.entries.push({ label, fi_offset: fi - anchorFi, data: [...data] });
        }
    }

    _pasteKeyframes() {
        if (!this._kfClipboard || this._kfClipboard.entries.length === 0) return;
        this._pushUndo();
        const pasteAtFi = this.currentFrame;
        this.selKfs.clear();
        for (const { label, fi_offset, data } of this._kfClipboard.entries) {
            const newFi = Math.max(0, Math.min(this.frameCount-1, pasteAtFi + fi_offset));
            if (!this.overrides[newFi]) this.overrides[newFi] = {};
            this.overrides[newFi][label] = [...data];
            this.selKfs.add(`${newFi}::${label}`);
        }
        this._refreshTimeline(); this._renderFrame(this.currentFrame);
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    _selectAllKeyframes() {
        // Select all visible keyframes of the currently selected joint (or all joints if none)
        const targetLabel = this.selectedJoint?.label ?? null;
        for (const [fi, overrideObj] of Object.entries(this.overrides)) {
            for (const label of Object.keys(overrideObj)) {
                if (targetLabel && label !== targetLabel) continue;
                const grp = label.split("_")[0];
                if (this.hiddenGroups.has(grp) || this.hiddenLayers.has(label)) continue;
                this.selKfs.add(`${fi}::${label}`);
            }
        }
        this._renderTrack();
    }

    // -----------------------------------------------------------------------
    // Per-segment easing popup
    // -----------------------------------------------------------------------
    _showSegmentPopup(label, fi_left, fi_right, screenX, screenY) {
        this._hideSegmentPopup();
        const popup = document.createElement("div");
        Object.assign(popup.style, {
            position: "fixed", zIndex: "20000",
            left: `${Math.min(screenX, window.innerWidth-220)}px`,
            top:  `${Math.min(screenY, window.innerHeight-260)}px`,
            background: "#1a1a2a", border: "1px solid #445",
            borderRadius: "6px", padding: "8px", width: "210px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
        });

        const title = document.createElement("div");
        title.style.cssText = "font-size:11px;color:#88aacc;margin-bottom:6px;";
        title.textContent = `Segment: frame ${fi_left} → ${fi_right} · ${label}`;
        popup.appendChild(title);

        const curMode = this.tweens[fi_left]?.[label] ?? null;
        const grid = document.createElement("div");
        Object.assign(grid.style, { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"3px" });

        for (const [presetLabel, presetVal] of SEGMENT_PRESETS) {
            const btn = document.createElement("button");
            btn.textContent = presetLabel;
            const isActive = presetVal === curMode || (presetVal === null && curMode === null);
            Object.assign(btn.style, {
                background: isActive ? "#1e5a3a" : "#2a2a3a",
                border: `1px solid ${isActive?"#3aaa7a":"#444"}`,
                color: isActive ? "#aaffcc" : "#ccc",
                borderRadius: "3px", cursor: "pointer",
                fontSize: "10px", padding: "3px 2px",
            });
            btn.addEventListener("click", () => {
                this._pushUndo();
                if (presetVal === null) {
                    // Remove per-segment override → falls back to global default
                    if (this.tweens[fi_left]) { delete this.tweens[fi_left][label]; }
                } else {
                    if (!this.tweens[fi_left]) this.tweens[fi_left] = {};
                    this.tweens[fi_left][label] = presetVal;
                }
                this._hideSegmentPopup();
                this._updateInterpBtns();
                this._renderFrame(this.currentFrame);
                this._renderTrack();
                if (this.activeTab === "graph") this._renderGraphEditor();
            });
            grid.appendChild(btn);
        }
        popup.appendChild(grid);

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "✕";
        Object.assign(closeBtn.style, {
            position:"absolute", top:"4px", right:"6px", background:"none",
            border:"none", color:"#888", cursor:"pointer", fontSize:"13px",
        });
        closeBtn.addEventListener("click", () => this._hideSegmentPopup());
        popup.appendChild(closeBtn);

        document.body.appendChild(popup);
        this._segPopup = popup;

        // Close on outside click
        const onOutside = (e) => {
            if (!popup.contains(e.target)) { this._hideSegmentPopup(); document.removeEventListener("mousedown", onOutside); }
        };
        setTimeout(() => document.addEventListener("mousedown", onOutside), 0);
    }

    _hideSegmentPopup() {
        if (this._segPopup) { document.body.removeChild(this._segPopup); this._segPopup = null; }
    }

    // -----------------------------------------------------------------------
    // Graph editor
    // -----------------------------------------------------------------------
    _graphFitView() {
        // Fall back to all keyframed joints if nothing explicitly selected
        let labels = this._graphLabels();
        if (labels.length === 0) {
            labels = this._getLayerDefs()
                .filter(r => r.type === "joint" && this._getKeyframesForJoint(r.label).length > 0)
                .map(r => r.label);
        }
        if (labels.length === 0) return;

        let vMin=Infinity, vMax=-Infinity, fMin=Infinity, fMax=-Infinity;
        for (const lbl of labels) {
            const kfs = this._getKeyframesForJoint(lbl);
            if (kfs.length === 0) continue;
            fMin = Math.min(fMin, kfs[0]);
            fMax = Math.max(fMax, kfs[kfs.length - 1]);
            // Sample the interpolated curve, not just raw override positions
            const step = Math.max(1, Math.floor((kfs[kfs.length - 1] - kfs[0]) / 80));
            for (let fi = kfs[0]; fi <= kfs[kfs.length - 1]; fi += step) {
                if (this.graphShowX) {
                    const v = this._getValueAtFrame(lbl, 0, fi);
                    if (v !== null) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
                }
                if (this.graphShowY) {
                    const v = this._getValueAtFrame(lbl, 1, fi);
                    if (v !== null) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
                }
            }
        }
        if (!isFinite(vMin)) {
            this.graphViewport = { frameStart: 0, frameEnd: this.frameCount - 1, valMin: 0, valMax: Math.max(this.poseW, this.poseH) };
            return;
        }
        const pad = Math.max((vMax - vMin) * 0.2, 15);
        this.graphViewport = {
            frameStart: Math.max(0, fMin - 3),
            frameEnd:   Math.min(this.frameCount - 1, fMax + 3),
            valMin: vMin - pad, valMax: vMax + pad,
        };
    }

    /**
     * Fit the Y axis to the actual data range for all visible joints.
     * Uses percentile clamping (2nd–98th) to ignore spikes/outliers,
     * then adds ±100px padding for comfortable visibility.
     * The frame range (X axis) is reset to the full clip.
     */
    _graphAutoFitRange() {
        let labels = this._graphLabels();
        if (labels.length === 0) {
            labels = this._getLayerDefs()
                .filter(r => r.type === "joint" && this._getKeyframesForJoint(r.label).length > 0)
                .map(r => r.label);
        }
        if (labels.length === 0) return;

        // Collect sampled values across the full frame span
        const allVals = [];
        let fMin = Infinity, fMax = -Infinity;
        for (const lbl of labels) {
            const kfs = this._getKeyframesForJoint(lbl);
            if (kfs.length === 0) continue;
            fMin = Math.min(fMin, kfs[0]);
            fMax = Math.max(fMax, kfs[kfs.length - 1]);
            // Sample at ~3-frame intervals — enough for accurate percentile without heavy cost
            const step = Math.max(1, Math.floor((kfs[kfs.length - 1] - kfs[0]) / 120));
            for (let fi = kfs[0]; fi <= kfs[kfs.length - 1]; fi += step) {
                if (this.graphShowX) {
                    const v = this._getValueAtFrame(lbl, 0, fi);
                    if (v !== null) allVals.push(v);
                }
                if (this.graphShowY) {
                    const v = this._getValueAtFrame(lbl, 1, fi);
                    if (v !== null) allVals.push(v);
                }
            }
        }
        if (allVals.length === 0) return;

        // Percentile clamping — 2nd to 98th — rejects isolated spikes
        allVals.sort((a, b) => a - b);
        const pct = (p) => allVals[Math.max(0, Math.min(allVals.length - 1, Math.round((allVals.length - 1) * p / 100)))];
        const lo = pct(2);
        const hi = pct(98);
        // Proportional padding: 30% of the value span, minimum 15 units so curves have breathing room
        const pad = Math.max((hi - lo) * 0.3, 15);

        this.graphViewport = {
            frameStart: Math.max(0, isFinite(fMin) ? fMin - 2 : 0),
            frameEnd:   Math.min(this.frameCount - 1, isFinite(fMax) ? fMax + 2 : this.frameCount - 1),
            valMin: lo - pad,
            valMax: hi + pad,
        };
    }

    /** Returns the list of joint labels to show in the graph. */
    _graphLabels() {
        if (this.selectedJoints.size > 0) return [...this.selectedJoints];
        if (this.selectedJoint) return [this.selectedJoint.label];
        return [];
    }

    _graphTransform() {
        const cw = this.graphCanvas.width  || 400;
        const ch = this.graphCanvas.height || 120;
        const PAD = { l:45, r:10, t:12, b:24 };
        const vw = cw - PAD.l - PAD.r, vh = ch - PAD.t - PAD.b;
        const { frameStart, frameEnd, valMin, valMax } = this.graphViewport;
        const fRange = Math.max(1, frameEnd - frameStart);
        const vRange = Math.max(1, valMax - valMin);
        return {
            fToX: (f) => PAD.l + (f - frameStart) / fRange * vw,
            vToY: (v) => PAD.t + (1 - (v - valMin) / vRange) * vh,
            xToF: (x) => frameStart + (x - PAD.l) / vw * fRange,
            yToV: (y) => valMin + (1 - (y - PAD.t) / vh) * vRange,
            PAD, cw, ch, vw, vh,
        };
    }

    /**
     * Get the interpolated or raw value for a joint at an exact frame index.
     * Respects the current interpolation mode.
     */
    _getValueAtFrame(label, coord, fi) {
        const ov = this.overrides[fi]?.[label];
        if (ov !== undefined) return ov[coord];
        const interp = this._interpolateJoint(label, fi);
        if (interp) return interp[coord];
        // Fall back to raw frame data
        const raw = this.frames[fi];
        if (!raw) return null;
        const parts = label.split("_"), group=parts[0], ki=parseInt(parts[1]);
        const pts = group==="body"?raw.body:(group==="rhand"?raw.rhand:raw.lhand);
        return pts?.[ki]?.[coord] ?? null;
    }

    /**
     * Apply JS-side Gaussian smoothing preview to get value for one (label, coord, fi).
     * Skips anchor frames (overrides). Returns null if no data available.
     */
    _getSmoothedValue(label, coord, fi) {
        if (this.smoothWindow <= 0) return this._getValueAtFrame(label, coord, fi);
        const r = Math.floor(this.smoothWindow / 2);
        const sigma = this.smoothWindow / 3;
        const anchors = new Set(Object.keys(this.overrides).map(Number));
        if (anchors.has(fi)) return this._getValueAtFrame(label, coord, fi);
        let wx = 0, wsum = 0;
        for (let d = -r; d <= r; d++) {
            const src = fi + d;
            if (src < 0 || src >= this.frameCount) continue;
            const w = Math.exp(-0.5 * (d / sigma) ** 2);
            const v = this._getValueAtFrame(label, coord, src);
            if (v === null) continue;
            wx += w * v; wsum += w;
        }
        return wsum > 0 ? wx / wsum : null;
    }

    _renderGraphEditor() {
        if (!this.graphCanvas || this.activeTab !== "graph") return;

        // Force canvas to match its display size if not yet set
        const rect = this.graphCanvas.getBoundingClientRect();
        if (rect.width > 0 && (this.graphCanvas.width !== Math.round(rect.width) || this.graphCanvas.height !== Math.round(rect.height))) {
            this.graphCanvas.width  = Math.round(rect.width);
            this.graphCanvas.height = Math.round(rect.height);
        }
        const cw = this.graphCanvas.width, ch = this.graphCanvas.height;
        if (!cw || !ch) return;
        const ctx = this.graphCanvas.getContext("2d");
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = "#09090f"; ctx.fillRect(0, 0, cw, ch);

        const T = this._graphTransform();
        const { fToX, vToY, PAD } = T;

        // Grid — vertical frame lines
        ctx.lineWidth = 1;
        const fStep = this._graphFrameStep();
        for (let f = Math.ceil(this.graphViewport.frameStart/fStep)*fStep; f <= this.graphViewport.frameEnd; f += fStep) {
            const x = fToX(f);
            ctx.strokeStyle = f % (fStep*5)===0 ? "#252538" : "#1a1a2a";
            ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, ch-PAD.b); ctx.stroke();
            ctx.fillStyle = "#556"; ctx.font = "9px monospace";
            ctx.fillText(String(f), x+2, ch-PAD.b+11);
        }
        // Grid — horizontal value lines (only in non-normalized mode; normalized mode draws its own ±1/0 grid later)
        if (!this.normalizeGraph) {
            const vStep = this._graphValStep();
            for (let v = Math.ceil(this.graphViewport.valMin/vStep)*vStep; v <= this.graphViewport.valMax; v += vStep) {
                const y = vToY(v);
                ctx.strokeStyle = "#1a1a2a"; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cw-PAD.r, y); ctx.stroke();
                ctx.fillStyle = "#556"; ctx.font = "9px monospace";
                ctx.fillText(v.toFixed(0), 2, y+3);
            }
            const zy = vToY(0);
            if (zy >= PAD.t && zy <= ch-PAD.b) {
                ctx.strokeStyle = "#334"; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(PAD.l, zy); ctx.lineTo(cw-PAD.r, zy); ctx.stroke();
            }
        }

        // Border
        ctx.strokeStyle = "#2e2e44"; ctx.lineWidth = 1;
        ctx.strokeRect(PAD.l, PAD.t, T.vw, T.vh);

        // Current frame line
        const cfx = fToX(this.currentFrame);
        ctx.strokeStyle = "#5577ee"; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]); ctx.beginPath(); ctx.moveTo(cfx,PAD.t); ctx.lineTo(cfx,ch-PAD.b); ctx.stroke();
        ctx.setLineDash([]);

        const labels = this._graphLabels();
        if (labels.length === 0) {
            ctx.fillStyle = "#445"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("Select a joint in the layer list to see its curve", cw/2, ch/2);
            ctx.textAlign = "left"; return;
        }

        const fStart = this.graphViewport.frameStart, fEnd = this.graphViewport.frameEnd;

        // Colour palette for multi-joint: X=warm, Y=cool, cycling hue per joint
        const JOINT_HUE = [0,30,60,120,180,210,270,300];
        const getColors = (ji, coord) => {
            const hue = JOINT_HUE[ji % JOINT_HUE.length];
            const shift = coord === 0 ? 0 : 40;  // X: base hue, Y: shifted
            return {
                raw:    `hsl(${hue+shift},60%,45%)`,
                bright: `hsl(${hue+shift},80%,65%)`,
            };
        };

        // Pre-compute normalization factors: mean-centered, shared scale across all channels.
        // Each channel is centered at its own mean; all channels share the same half-range
        // so relative amplitudes are preserved and curves visually overlay each other.
        const normFactor = {};  // key: `${label}_${coord}` → {mean, halfRange}
        if (this.normalizeGraph) {
            let globalHalfRange = 0;
            for (let ji=0; ji<labels.length; ji++) {
                const lbl = labels[ji];
                const kfs = this._getKeyframesForJoint(lbl);
                for (const coord of [0,1]) {
                    let mn=Infinity, mx=-Infinity;
                    for (const fi of kfs) {
                        const ov=this.overrides[fi]?.[lbl];
                        if (ov) { mn=Math.min(mn,ov[coord]); mx=Math.max(mx,ov[coord]); }
                    }
                    if (isFinite(mn)) {
                        normFactor[`${lbl}_${coord}`] = { mean: (mn+mx)/2, halfRange: 0 };
                        globalHalfRange = Math.max(globalHalfRange, (mx-mn)/2);
                    }
                }
            }
            if (globalHalfRange === 0) globalHalfRange = 1;
            for (const key of Object.keys(normFactor)) normFactor[key].halfRange = globalHalfRange;
        }
        this._lastNormFactors = normFactor;  // stored so mouse hit-test can reuse

        const applyNorm = (val, lbl, coord) => {
            if (!this.normalizeGraph) return val;
            const nf = normFactor[`${lbl}_${coord}`];
            if (!nf || nf.halfRange === 0) return 0;
            return (val - nf.mean) / nf.halfRange;  // → 0 at mean, ±1 at ±halfRange
        };

        // If normalizing, Y axis maps the centered values (-1…+1 typical range)
        const normalVToY = this.normalizeGraph
            ? (v) => PAD.t + (1 - (v + 1) / 2) * T.vh
            : vToY;

        for (let ji=0; ji<labels.length; ji++) {
            const label = labels[ji];
            const kfs   = this._getKeyframesForJoint(label);
            if (kfs.length < 1) continue;

            for (const coord of [0, 1]) {
                const show = coord === 0 ? this.graphShowX : this.graphShowY;
                if (!show) continue;
                const {raw: rawColor, bright: smoothColor} = getColors(ji, coord);

                // Draw curve segment-by-segment
                ctx.strokeStyle = rawColor; ctx.lineWidth = labels.length > 1 ? 1.2 : 1.5;
                ctx.setLineDash([]);
                ctx.beginPath(); let pathStarted = false;

                for (let ki = 0; ki < kfs.length; ki++) {
                    const fiA = kfs[ki];
                    const ovA = this.overrides[fiA]?.[label];
                    if (!ovA) continue;

                    if (ki < kfs.length - 1) {
                        const fiB = kfs[ki + 1];
                        const ovB = this.overrides[fiB]?.[label];
                        if (!ovB || fiB < fStart || fiA > fEnd) continue;

                        const mode = this.tweens[fiA]?.[label] ?? this.interpolationMode;
                        const xA = fToX(fiA), xB = fToX(fiB);
                        const segPixels = Math.max(20, Math.ceil(Math.abs(xB - xA)));

                        for (let s = 0; s <= segPixels; s++) {
                            const t = s / segPixels;
                            let raw;
                            if (mode === "catmull_rom") {
                                const interp = this._catmullRomInterp(label, fiA, fiB, t);
                                raw = interp ? interp[coord] : null;
                            } else {
                                const ti = applyEasing(t, mode);
                                raw = ovA[coord] + (ovB[coord] - ovA[coord]) * ti;
                            }
                            if (raw === null) continue;
                            const val = applyNorm(raw, label, coord);
                            const x = fToX(fiA + t * (fiB - fiA)), y = normalVToY(val);
                            if (!pathStarted) { ctx.moveTo(x, y); pathStarted = true; }
                            else ctx.lineTo(x, y);
                        }
                    } else {
                        if (fiA >= fStart-1 && fiA <= fEnd+1) {
                            const val = applyNorm(ovA[coord], label, coord);
                            const x = fToX(fiA), y = normalVToY(val);
                            if (!pathStarted) { ctx.moveTo(x, y); pathStarted = true; }
                            else ctx.lineTo(x, y);
                        }
                    }
                }
                ctx.stroke();

                // Smoothed preview (only for the primary / selectedJoint)
                if (this.smoothWindow > 0 && label === this.selectedJoint?.label) {
                    const STEPS = Math.max(2, T.vw);
                    ctx.strokeStyle = smoothColor; ctx.lineWidth = 2.5; ctx.setLineDash([2,2]);
                    ctx.beginPath(); let started = false;
                    for (let s = 0; s <= STEPS; s++) {
                        const f = fStart + (fEnd - fStart) * s / STEPS;
                        const fi = Math.round(f);
                        if (fi < 0 || fi >= this.frameCount) { started = false; continue; }
                        const raw = this._getSmoothedValue(label, coord, fi);
                        if (raw === null) { started = false; continue; }
                        const val = applyNorm(raw, label, coord);
                        const x = fToX(f), y = normalVToY(val);
                        if (!started) { ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
                    }
                    ctx.stroke(); ctx.setLineDash([]);
                }
            }
        }

        // Keyframe dots (for ALL active labels)
        for (let ji = 0; ji < labels.length; ji++) {
            const label = labels[ji];
            const kfs   = this._getKeyframesForJoint(label);
            for (const fi of kfs) {
                if (fi < fStart-1 || fi > fEnd+1) continue;
                const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                const x = fToX(fi);
                const isCur = fi === this.currentFrame;
                for (const [coord, show, dotColor] of [
                    [0, this.graphShowX, "#ff5555"],
                    [1, this.graphShowY, "#33ee99"],
                ]) {
                    if (!show) continue;
                    const val = applyNorm(ov[coord], label, coord);
                    const y = normalVToY(val);
                    const isCoordSel = this.graphSel.has(`${fi}::${label}::${coord}`);
                    ctx.fillStyle   = isCoordSel ? "#55ddff" : isCur ? "#ffe44a" : dotColor;
                    ctx.strokeStyle = isCoordSel ? "#aaeeff" : "#111"; ctx.lineWidth = isCoordSel ? 2 : 1.5;
                    ctx.setLineDash([]);
                    ctx.beginPath(); ctx.arc(x, y, isCur ? 6 : labels.length > 1 ? 3.5 : 4.5, 0, Math.PI*2);
                    ctx.fill(); ctx.stroke();
                }
            }
        }

        // Current frame badge (frame number on the cursor line)
        if (cfx >= PAD.l && cfx <= cw - PAD.r) {
            const badge = String(this.currentFrame);
            ctx.font = "bold 10px monospace";
            const bw = ctx.measureText(badge).width + 8;
            const bh = 14, bx = cfx - bw/2, by = PAD.t - bh - 1;
            ctx.fillStyle = "#3a5aee";
            ctx.beginPath(); ctx.roundRect?.(bx, by, bw, bh, 3); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.fillText(badge, cfx, by + bh - 3);
            ctx.textAlign = "left";
        }

        // Normalize axis labels and grid lines
        if (this.normalizeGraph) {
            // Grid lines at -1, 0, +1
            ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
            ctx.strokeStyle = "rgba(100,140,200,0.35)";
            for (const v of [1, -1]) {
                ctx.beginPath(); ctx.moveTo(PAD.l, normalVToY(v)); ctx.lineTo(cw-PAD.r, normalVToY(v)); ctx.stroke();
            }
            ctx.strokeStyle = "rgba(180,220,255,0.5)";
            ctx.beginPath(); ctx.moveTo(PAD.l, normalVToY(0)); ctx.lineTo(cw-PAD.r, normalVToY(0)); ctx.stroke();
            ctx.setLineDash([]);
            // Axis labels
            ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
            ctx.fillStyle = "#88ccff"; ctx.fillText(" 1", PAD.l-2, normalVToY(1)+4);
            ctx.fillStyle = "#aaddff"; ctx.fillText(" 0", PAD.l-2, normalVToY(0)+4);
            ctx.fillStyle = "#88ccff"; ctx.fillText("-1", PAD.l-2, normalVToY(-1)+4);
            ctx.textAlign = "left";
        }

        // Legend (show joint names when multiple)
        ctx.font = "10px sans-serif"; let lx = PAD.l + 4;
        if (this.graphShowX) {
            ctx.fillStyle = getColors(0,0).bright; ctx.fillRect(lx, PAD.t+3, 10, 8);
            ctx.fillStyle = "#ccc"; ctx.fillText("X", lx+12, PAD.t+11); lx += 28;
        }
        if (this.graphShowY) {
            ctx.fillStyle = getColors(0,1).bright; ctx.fillRect(lx, PAD.t+3, 10, 8);
            ctx.fillStyle = "#ccc"; ctx.fillText("Y", lx+12, PAD.t+11); lx += 28;
        }
        if (labels.length > 1) {
            ctx.fillStyle="#99aacc"; ctx.fillText(`${labels.length} joints`, lx, PAD.t+11); lx+=60;
        }
        if (this.normalizeGraph) {
            ctx.fillStyle="#88bbff"; ctx.fillText("normalized", lx, PAD.t+11); lx+=70;
        }
        if (this.smoothWindow > 0) {
            ctx.fillStyle = "#99aaff"; ctx.fillText(`⟿ smooth(${this.smoothWindow})`, lx, PAD.t+11);
        }

        // Rubber-band selection rect
        if (this._graphDragSel) {
            const {startX,startY,curX,curY} = this._graphDragSel;
            const rx=Math.min(startX,curX), ry=Math.min(startY,curY);
            const rw=Math.abs(curX-startX), rh=Math.abs(curY-startY);
            ctx.fillStyle = "rgba(80,160,255,0.08)"; ctx.fillRect(rx,ry,rw,rh);
            ctx.strokeStyle = "#5599ff"; ctx.lineWidth = 1; ctx.setLineDash([3,2]);
            ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]);
        }

        // S-scale mode indicator
        if (this._graphScale) {
            const sc = this._graphScale;
            const mx = this._lastGraphMouse.x, my = this._lastGraphMouse.y;
            const pivX = fToX(sc.pivotFi), pivY = normalVToY(this.normalizeGraph ? 0 : sc.pivotVal);
            ctx.save();
            // Draw pivot crosshair
            ctx.strokeStyle = "rgba(255,200,80,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([2,3]);
            ctx.beginPath(); ctx.moveTo(pivX, PAD.t); ctx.lineTo(pivX, ch-PAD.b); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(PAD.l, pivY); ctx.lineTo(cw-PAD.r, pivY); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#ffcc44"; ctx.font = "bold 11px sans-serif";
            const lockStr = sc.axisLock === "time" ? "  X=Time only" : sc.axisLock === "value" ? "  Y=Value only" : "";
            ctx.fillText(`SCALE${lockStr}  |  X=lock Time  Y=lock Value  Enter/LMB=confirm  Esc=cancel`, PAD.l+6, PAD.t+22);
            // Draw line from pivot to mouse
            ctx.strokeStyle = "rgba(255,200,80,0.4)"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pivX, pivY); ctx.lineTo(mx, my); ctx.stroke();
            ctx.restore();
        }

        // G-grab mode indicator
        if (this._graphGrab) {
            const grab = this._graphGrab;
            const mx = this._lastGraphMouse.x, my = this._lastGraphMouse.y;
            ctx.save();
            if (grab.axisLock === "time") {
                // Locked to time: draw horizontal guide at grab start Y
                ctx.strokeStyle = "rgba(255,140,30,0.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
                ctx.beginPath(); ctx.moveTo(PAD.l, grab.startY); ctx.lineTo(cw-PAD.r, grab.startY); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#ff8c1e"; ctx.font = "bold 11px sans-serif";
                ctx.fillText("GRAB  |  X = Time axis  (press X to unlock)", PAD.l+6, PAD.t+22);
            } else if (grab.axisLock === "value") {
                // Locked to value: draw vertical guide at grab start X
                ctx.strokeStyle = "rgba(30,180,255,0.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
                ctx.beginPath(); ctx.moveTo(grab.startX, PAD.t); ctx.lineTo(grab.startX, ch-PAD.b); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#1ec8ff"; ctx.font = "bold 11px sans-serif";
                ctx.fillText("GRAB  |  Y = Value axis  (press Y to unlock)", PAD.l+6, PAD.t+22);
            } else {
                ctx.fillStyle = "#ffcc44"; ctx.font = "bold 11px sans-serif";
                ctx.fillText("GRAB  |  X=lock Time  Y=lock Value  Enter/LMB=confirm  Esc=cancel", PAD.l+6, PAD.t+22);
            }
            // Draw crosshair at mouse position
            ctx.strokeStyle = "rgba(255,220,80,0.6)"; ctx.lineWidth = 1; ctx.setLineDash([2,2]);
            ctx.beginPath(); ctx.moveTo(mx, PAD.t); ctx.lineTo(mx, ch-PAD.b); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(PAD.l, my); ctx.lineTo(cw-PAD.r, my); ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
    }

    _graphFrameStep() {
        const range = this.graphViewport.frameEnd - this.graphViewport.frameStart;
        if (range <= 20)  return 1;
        if (range <= 100) return 10;
        if (range <= 500) return 50;
        return 100;
    }
    _graphValStep() {
        const range = this.graphViewport.valMax - this.graphViewport.valMin;
        if (range <= 50)   return 10;
        if (range <= 200)  return 50;
        if (range <= 1000) return 100;
        return 200;
    }

    _onGraphMouseDown(e) {
        const rect = this.graphCanvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        this._lastGraphMouse = {x: cx, y: cy};
        const T = this._graphTransform();

        // Confirm/cancel G-grab with LMB/RMB
        if (this._graphGrab) {
            e.preventDefault();
            if (e.button === 0) this._confirmGraphGrab();
            else if (e.button === 2) this._cancelGraphGrab();
            return;
        }

        // Middle mouse (button 1): start viewport pan
        if (e.button === 1) {
            e.preventDefault();
            const gv = this.graphViewport;
            this._graphPanDrag = { startX: cx, startY: cy,
                origFStart: gv.frameStart, origFEnd: gv.frameEnd,
                origVMin: gv.valMin, origVMax: gv.valMax };
            return;
        }

        if (e.button !== 0) return;
        e.preventDefault();

        // Ctrl+LMB: insert keyframe at cursor position for active channels
        if (e.ctrlKey) {
            this._stopPlayback();
            const fi = Math.max(0, Math.min(this.frameCount-1, Math.round(T.xToF(cx))));
            this._pushUndo();
            for (const label of this._graphLabels()) {
                if (this.lockedLayers.has(label)) continue;
                const fd = this._getEffectiveFrame(fi); if (!fd) continue;
                const parts = label.split("_"), grp = parts[0], ki = parseInt(parts[1]);
                const pts = grp==="body"?fd.body:(grp==="rhand"?fd.rhand:fd.lhand);
                if (!pts?.[ki]) continue;
                if (!this.overrides[fi]) this.overrides[fi] = {};
                if (!this.overrides[fi][label]) this.overrides[fi][label] = [...pts[ki]];
            }
            this._refreshTimeline(); this._renderGraphEditor(); this._seekFrame(fi);
            return;
        }

        // Use the same normalization factors as the last render pass so hit-test matches visuals
        const _nf = this._lastNormFactors || {};
        const kvToY = (label, coord, rawVal) => {
            if (!this.normalizeGraph) return T.vToY(rawVal);
            const nf = _nf[`${label}_${coord}`];
            if (!nf || nf.halfRange === 0) return T.PAD.t + T.vh / 2;
            const nv = (rawVal - nf.mean) / nf.halfRange;
            return T.PAD.t + (1 - (nv + 1) / 2) * T.vh;
        };

        // Hit-test dots across ALL active labels
        const THRESH = 9;
        let hitFi = -1, hitLabel = null, hitCoord = -1;
        outer: for (const label of this._graphLabels()) {
            for (const fi of this._getKeyframesForJoint(label)) {
                const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                const x = T.fToX(fi);
                for (const [coord, show] of [[0, this.graphShowX], [1, this.graphShowY]]) {
                    if (!show) continue;
                    const y = kvToY(label, coord, ov[coord]);
                    if (Math.hypot(cx-x, cy-y) <= THRESH) { hitFi=fi; hitLabel=label; hitCoord=coord; break outer; }
                }
            }
        }

        if (hitFi >= 0) {
            this._stopPlayback();
            const gKey = `${hitFi}::${hitLabel}::${hitCoord}`;
            if (e.shiftKey) {
                if (this.graphSel.has(gKey)) this.graphSel.delete(gKey); else this.graphSel.add(gKey);
            } else if (!this.graphSel.has(gKey)) {
                this.graphSel.clear(); this.graphSel.add(gKey);
            }
            this._seekFrame(hitFi);
            this._startGraphDrag(cx, cy, e.shiftKey);
            return;
        }

        // No dot hit: start rubber-band (clear selection if not shift)
        if (!e.shiftKey) this.graphSel.clear();
        this._graphDragSel = { startX: cx, startY: cy, curX: cx, curY: cy };
        const fi = Math.round(T.xToF(cx));
        if (fi >= 0 && fi < this.frameCount) this._seekFrame(fi);
    }

    _onGraphMouseMove(e) {
        const rect = this.graphCanvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        this._lastGraphMouse = {x: cx, y: cy};

        if (this._graphGrab)  { this._applyGraphGrab(cx, cy); return; }
        if (this._graphScale) { this._applyGraphScale(cx, cy); return; }

        if (this._graphPanDrag) {
            const { startX, startY, origFStart, origFEnd, origVMin, origVMax } = this._graphPanDrag;
            const T = this._graphTransform();
            const fRange = origFEnd - origFStart, vRange = origVMax - origVMin;
            const dF = -(cx - startX) / T.vw * fRange;
            const dV =  (cy - startY) / T.vh * vRange;
            this.graphViewport.frameStart = Math.max(0, origFStart + dF);
            this.graphViewport.frameEnd   = Math.min(this.frameCount-1, origFEnd + dF);
            this.graphViewport.valMin = origVMin + dV;
            this.graphViewport.valMax = origVMax + dV;
            this._renderGraphEditor(); return;
        }

        if (this._graphDragSel) {
            this._graphDragSel.curX = cx; this._graphDragSel.curY = cy;
            this._renderGraphEditor(); return;
        }

        if (this.graphDrag) { e.preventDefault(); this._applyGraphDrag(cx, cy); }
    }

    _onGraphMouseUp(e) {
        if (this._graphGrab  && e.button === 0) { this._confirmGraphGrab();  return; }
        if (this._graphGrab  && e.button === 2) { this._cancelGraphGrab();   return; }
        if (this._graphScale && e.button === 0) { this._confirmGraphScale(); return; }
        if (this._graphScale && e.button === 2) { this._cancelGraphScale();  return; }

        if (this._graphPanDrag) { this._graphPanDrag = null; return; }

        if (this._graphDragSel) {
            const sel = this._graphDragSel; this._graphDragSel = null;
            const T = this._graphTransform();
            const labels = this._graphLabels();
            const minX = Math.min(sel.startX, sel.curX), maxX = Math.max(sel.startX, sel.curX);
            const minY = Math.min(sel.startY, sel.curY), maxY = Math.max(sel.startY, sel.curY);
            if (!e.shiftKey) this.graphSel.clear();
            // Normalize-aware Y helper (same as in _onGraphMouseDown)
            const _nCache = {};
            const rbKvToY = (label, coord, rawVal) => {
                if (!this.normalizeGraph) return T.vToY(rawVal);
                const key = `${label}_${coord}`;
                if (!_nCache[key]) {
                    let mn = Infinity, mx = -Infinity;
                    for (const fi2 of this._getKeyframesForJoint(label)) {
                        const ov2 = this.overrides[fi2]?.[label];
                        if (ov2) { mn = Math.min(mn, ov2[coord]); mx = Math.max(mx, ov2[coord]); }
                    }
                    _nCache[key] = { mn, mx };
                }
                const { mn, mx } = _nCache[key];
                if (!isFinite(mn) || mx === mn) return T.PAD.t + T.vh / 2;
                const nv = (rawVal - mn) / (mx - mn) * 2 - 1;
                return T.PAD.t + (1 - (nv + 1) / 2) * T.vh;
            };
            for (const label of labels) {
                for (const fi of this._getKeyframesForJoint(label)) {
                    const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                    const x = T.fToX(fi);
                    for (const [coord, show] of [[0, this.graphShowX], [1, this.graphShowY]]) {
                        if (!show) continue;
                        const y = rbKvToY(label, coord, ov[coord]);
                        if (x >= minX && x <= maxX && y >= minY && y <= maxY)
                            this.graphSel.add(`${fi}::${label}::${coord}`);
                    }
                }
            }
            this._renderGraphEditor(); this._renderTrack(); return;
        }

        if (this.graphDrag) {
            // Update graphSel keys to reflect final frame positions
            const { kfEntries, lastFiDelta } = this.graphDrag;
            if (lastFiDelta !== 0) {
                const newSel = new Set();
                for (const key of this.graphSel) {
                    const [fStr, lbl, cStr] = key.split("::");
                    const origFi = parseInt(fStr);
                    const entry = kfEntries.find(en => en.origFi === origFi && en.label === lbl);
                    const newFi = entry ? Math.max(0, Math.min(this.frameCount-1, entry.origFi + lastFiDelta)) : origFi;
                    newSel.add(`${newFi}::${lbl}::${cStr}`);
                }
                this.graphSel = newSel;
            }
            this.graphDrag = null; this._dragPreState = null;
            this._refreshTimeline(); this._renderGraphEditor(); this._renderTrack();
        }
    }

    _onGraphWheel(e) {
        e.preventDefault();
        const { graphViewport: vp } = this;
        const T = this._graphTransform();
        const rect = this.graphCanvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const fRange = vp.frameEnd - vp.frameStart;
        const vRange = vp.valMax - vp.valMin;

        if (e.ctrlKey && e.shiftKey) {
            // Ctrl+Shift+Wheel: vertical zoom around cursor value
            const factor = e.deltaY > 0 ? 1.15 : 0.87;
            const pivot = T.yToV(cy);
            vp.valMin = pivot - (pivot - vp.valMin) * factor;
            vp.valMax = pivot + (vp.valMax - pivot) * factor;
        } else if (e.ctrlKey) {
            // Ctrl+Wheel: horizontal zoom around cursor frame
            const factor = e.deltaY > 0 ? 1.15 : 0.87;
            const pivot = T.xToF(cx);
            vp.frameStart = Math.max(0, pivot - (pivot - vp.frameStart) * factor);
            vp.frameEnd   = Math.min(this.frameCount-1, pivot + (vp.frameEnd - pivot) * factor);
        } else if (e.shiftKey) {
            // Shift+Wheel: vertical pan
            const shift = (e.deltaY > 0 ? 0.1 : -0.1) * vRange;
            vp.valMin += shift; vp.valMax += shift;
        } else {
            // Plain Wheel: horizontal pan
            const shift = (e.deltaY > 0 ? 0.1 : -0.1) * fRange;
            vp.frameStart = Math.max(0, vp.frameStart + shift);
            vp.frameEnd   = Math.min(this.frameCount-1, vp.frameEnd + shift);
        }
        this._renderGraphEditor();
    }

    // -----------------------------------------------------------------------
    // Graph editor — grab / drag helpers
    // -----------------------------------------------------------------------

    /** Build kfEntries from current graphSel and return them (unique fi::label pairs). */
    _graphKfEntriesFromSel() {
        const kfMap = new Map();
        for (const key of this.graphSel) {
            const [fStr, label] = key.split("::");
            const fi = parseInt(fStr), mapKey = `${fi}::${label}`;
            if (!kfMap.has(mapKey)) {
                const ov = this.overrides[fi]?.[label];
                if (ov) kfMap.set(mapKey, { origFi: fi, label, origVals: [...ov] });
            }
        }
        return [...kfMap.values()];
    }

    /**
     * Apply a combined time+value delta to graph keyframe entries.
     * Uses origFi/origVals as the reference → calling repeatedly with different
     * deltas always produces the correct result (no cumulative drift).
     */
    _applyGraphDelta(kfEntries, fiDelta, dVal, lastFiDelta, duplicate = false) {
        for (const entry of kfEntries) {
            // Clear the position from the previous iteration.
            // In duplicate mode: never touch origFi — it holds the original KF.
            const prevFi = Math.max(0, Math.min(this.frameCount-1, entry.origFi + lastFiDelta));
            if (!duplicate || prevFi !== entry.origFi) {
                if (this.overrides[prevFi]?.[entry.label] !== undefined) {
                    delete this.overrides[prevFi][entry.label];
                    if (Object.keys(this.overrides[prevFi]).length === 0) delete this.overrides[prevFi];
                }
            }
            // Write copy to new position (skip if it would land on the original — already there)
            const newFi = Math.max(0, Math.min(this.frameCount-1, entry.origFi + fiDelta));
            if (!duplicate || newFi !== entry.origFi) {
                if (!this.overrides[newFi]) this.overrides[newFi] = {};
                const newVals = [...entry.origVals];
                if (this.graphSel.has(`${entry.origFi}::${entry.label}::0`)) newVals[0] = entry.origVals[0] + dVal;
                if (this.graphSel.has(`${entry.origFi}::${entry.label}::1`)) newVals[1] = entry.origVals[1] + dVal;
                this.overrides[newFi][entry.label] = newVals;
            }
        }
    }

    /** Start a mouse-drag on a graph dot (LMB held). Shift = duplicate mode. */
    _startGraphDrag(startX, startY, shiftKey = false) {
        const kfEntries = this._graphKfEntriesFromSel();
        if (kfEntries.length === 0) return;
        this._armUndo();
        this.graphDrag = { startX, startY, kfEntries, lastFiDelta: 0, axisLock: null, duplicate: !!shiftKey };
    }

    _applyGraphDrag(cx, cy) {
        const { startX, startY, kfEntries, lastFiDelta, axisLock, duplicate } = this.graphDrag;
        const T = this._graphTransform();
        const gv = this.graphViewport;
        const fDelta = axisLock === "value" ? 0
            : Math.round((cx - startX) / T.vw * (gv.frameEnd - gv.frameStart));
        const dVal  = axisLock === "time"  ? 0
            : -(cy - startY) / T.vh * (gv.valMax - gv.valMin);
        if (fDelta === lastFiDelta && Math.abs(dVal) < 0.05) return;
        this._lazyPushUndo();
        this._applyGraphDelta(kfEntries, fDelta, dVal, lastFiDelta, duplicate);
        this.graphDrag.lastFiDelta = fDelta;
        this._renderGraphEditor(); this._renderFrame(this.currentFrame); this._renderTrack();
    }

    /** Start G-grab mode (keyboard G shortcut — mouse not held). */
    _startGraphGrab() {
        if (this.graphSel.size === 0) return;
        const kfEntries = this._graphKfEntriesFromSel();
        if (kfEntries.length === 0) return;
        this._pushUndo();   // save state; cancelled with _undo()
        this._graphGrab = {
            kfEntries,
            startX: this._lastGraphMouse.x,
            startY: this._lastGraphMouse.y,
            lastFiDelta: 0,
            axisLock: null,
        };
    }

    _applyGraphGrab(cx, cy) {
        const grab = this._graphGrab; if (!grab) return;
        const T = this._graphTransform();
        const gv = this.graphViewport;
        const fDelta = grab.axisLock === "value" ? 0
            : Math.round((cx - grab.startX) / T.vw * (gv.frameEnd - gv.frameStart));
        const dVal   = grab.axisLock === "time"  ? 0
            : -(cy - grab.startY) / T.vh * (gv.valMax - gv.valMin);
        this._applyGraphDelta(grab.kfEntries, fDelta, dVal, grab.lastFiDelta);
        grab.lastFiDelta = fDelta;
        this._renderGraphEditor(); this._renderFrame(this.currentFrame); this._renderTrack();
    }

    _confirmGraphGrab() {
        if (!this._graphGrab) return;
        const { kfEntries, lastFiDelta } = this._graphGrab;
        // Update graphSel keys to point to new frame indices
        if (lastFiDelta !== 0) {
            const newSel = new Set();
            for (const key of this.graphSel) {
                const [fStr, lbl, cStr] = key.split("::");
                const origFi = parseInt(fStr);
                const entry  = kfEntries.find(en => en.origFi === origFi && en.label === lbl);
                const newFi  = entry ? Math.max(0, Math.min(this.frameCount-1, entry.origFi + lastFiDelta)) : origFi;
                newSel.add(`${newFi}::${lbl}::${cStr}`);
            }
            this.graphSel = newSel;
        }
        this._graphGrab = null;
        this._refreshTimeline(); this._renderGraphEditor(); this._renderTrack();
    }

    _cancelGraphGrab() {
        if (!this._graphGrab) return;
        this._graphGrab = null;
        this._undo();   // restores pre-grab state (pushed in _startGraphGrab)
    }

    /** Delete all keyframes referenced by graphSel. */
    _deleteGraphSelected() {
        if (this.graphSel.size === 0) return;
        const pairs = new Set();
        for (const key of this.graphSel) {
            const [fStr, label] = key.split("::");
            pairs.add(`${fStr}::${label}`);
        }
        this._pushUndo();
        for (const pair of pairs) {
            const [fStr, label] = pair.split("::");
            this._deleteKeyframeRaw(label, parseInt(fStr));
        }
        this.graphSel.clear();
        this._refreshTimeline(); this._renderFrame(this.currentFrame); this._renderGraphEditor();
    }

    // -----------------------------------------------------------------------
    // Graph editor — Smooth Selected + Scale mode + Help
    // -----------------------------------------------------------------------

    /**
     * Gaussian-smooth the VALUE of selected keyframes.
     * Only selected KFs are modified; unselected KFs act as fixed anchors.
     * Window is determined by the `smoothWindow` slider (falls back to 5 if 0).
     */
    _smoothSelectedKfs() {
        if (this.graphSel.size === 0) return;
        const radius = Math.max(2, Math.floor((this.smoothWindow > 0 ? this.smoothWindow : 5) / 2));
        // Group selected KFs by label+coord
        const groups = new Map();
        for (const key of this.graphSel) {
            const [fStr, label, cStr] = key.split("::");
            const gk = `${label}::${cStr}`;
            if (!groups.has(gk)) groups.set(gk, new Set());
            groups.get(gk).add(parseInt(fStr));
        }
        this._pushUndo();
        for (const [gk, selFis] of groups) {
            const [label, cStr] = gk.split("::"); const coord = parseInt(cStr);
            const allKfs = this._getKeyframesForJoint(label);
            if (allKfs.length < 3) continue;
            // Build sorted array of {fi, val}
            const samples = allKfs.map(fi => ({ fi, val: this.overrides[fi]?.[label]?.[coord] ?? 0 }));
            const n = samples.length;
            const sigma = radius / 2;
            for (const fi of selFis) {
                const idx = samples.findIndex(s => s.fi === fi); if (idx < 0) continue;
                let wx = 0, wsum = 0;
                for (let d = -radius; d <= radius; d++) {
                    const j = idx + d; if (j < 0 || j >= n) continue;
                    const w = Math.exp(-0.5 * (d / sigma) ** 2);
                    wx += w * samples[j].val; wsum += w;
                }
                const smoothed = wsum > 0 ? wx / wsum : samples[idx].val;
                if (!this.overrides[fi]) this.overrides[fi] = {};
                if (!this.overrides[fi][label]) {
                    const fd = this._getEffectiveFrame(fi);
                    const p = label.split("_"), grp=p[0], ki=parseInt(p[1]);
                    const pts = grp==="body"?fd?.body:(grp==="rhand"?fd?.rhand:fd?.lhand);
                    this.overrides[fi][label] = pts?.[ki] ? [...pts[ki]] : [0,0,1];
                }
                this.overrides[fi][label][coord] = smoothed;
            }
        }
        this._renderGraphEditor(); this._renderFrame(this.currentFrame); this._renderTrack();
    }

    /** Start S-Scale mode for selected graph keyframes. */
    _startGraphScale() {
        if (this.graphSel.size === 0) return;
        const kfEntries = this._graphKfEntriesFromSel(); if (kfEntries.length === 0) return;
        // Pivot = median frame + median value of selected KFs
        const fiArr = [], valArr = [];
        for (const entry of kfEntries) {
            fiArr.push(entry.origFi);
            if (this.graphSel.has(`${entry.origFi}::${entry.label}::0`)) valArr.push(entry.origVals[0]);
            if (this.graphSel.has(`${entry.origFi}::${entry.label}::1`)) valArr.push(entry.origVals[1]);
        }
        const pivotFi  = fiArr.reduce((a,b)=>a+b,0)/fiArr.length;
        const pivotVal = valArr.length ? valArr.reduce((a,b)=>a+b,0)/valArr.length : 0;
        this._pushUndo();
        this._graphScale = { kfEntries, pivotFi, pivotVal,
            startX: this._lastGraphMouse.x, startY: this._lastGraphMouse.y,
            lastFiDelta: 0, lastValScale: 1, axisLock: null };
    }

    _applyGraphScale(cx, cy) {
        const sc = this._graphScale; if (!sc) return;
        const T = this._graphTransform(); const gv = this.graphViewport;
        const dx = cx - sc.startX, dy = sc.startY - cy;   // up = positive
        const fRange = gv.frameEnd - gv.frameStart, vRange = gv.valMax - gv.valMin;
        // Scale factors: mouse distance from center → multiplier
        const timeScale  = sc.axisLock === "value" ? 1 : 1 + dx / T.vw * 2;
        const valScale   = sc.axisLock === "time"  ? 1 : 1 + dy / T.vh * 2;
        // Restore original, then apply new scale (all from origFi/origVals)
        for (const entry of sc.kfEntries) {
            const prevFi = Math.max(0, Math.min(this.frameCount-1,
                Math.round(sc.pivotFi + (entry.origFi - sc.pivotFi) * sc.lastValScale)));
            if (this.overrides[prevFi]?.[entry.label]) {
                delete this.overrides[prevFi][entry.label];
                if (Object.keys(this.overrides[prevFi]).length===0) delete this.overrides[prevFi];
            }
        }
        for (const entry of sc.kfEntries) {
            const newFi = Math.max(0, Math.min(this.frameCount-1,
                Math.round(sc.pivotFi + (entry.origFi - sc.pivotFi) * timeScale)));
            if (!this.overrides[newFi]) this.overrides[newFi] = {};
            const nv = [...entry.origVals];
            if (this.graphSel.has(`${entry.origFi}::${entry.label}::0`))
                nv[0] = sc.pivotVal + (entry.origVals[0] - sc.pivotVal) * valScale;
            if (this.graphSel.has(`${entry.origFi}::${entry.label}::1`))
                nv[1] = sc.pivotVal + (entry.origVals[1] - sc.pivotVal) * valScale;
            this.overrides[newFi][entry.label] = nv;
        }
        sc.lastValScale = timeScale;   // reuse field for timeScale restore
        this._renderGraphEditor(); this._renderFrame(this.currentFrame); this._renderTrack();
    }

    _confirmGraphScale() {
        if (!this._graphScale) return;
        this._graphScale = null;
        this._refreshTimeline(); this._renderGraphEditor();
    }
    _cancelGraphScale() {
        if (!this._graphScale) return;
        this._graphScale = null;
        this._undo();
    }

    /** Show a help modal with all keyboard shortcuts. */
    _showHelp() {
        if (document.getElementById("_twHelp")) return;
        const modal = document.createElement("div");
        modal.id = "_twHelp";
        Object.assign(modal.style, {
            position:"fixed", inset:"0", zIndex:"30000", background:"rgba(0,0,0,0.75)",
            display:"flex", alignItems:"center", justifyContent:"center",
        });
        const panel = document.createElement("div");
        Object.assign(panel.style, {
            background:"#10101e", border:"1px solid #334", borderRadius:"8px",
            padding:"18px 22px", maxWidth:"760px", width:"90%", maxHeight:"82vh",
            overflowY:"auto", color:"#ccc", fontSize:"12px", lineHeight:"1.7",
            fontFamily:"monospace", boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
        });
        const sections = [
            ["Universal", [
                ["Space",                 "Play / Pause"],
                ["← / →",                "Step frame back / forward"],
                ["Home",                  "First frame (Dope Sheet) / Fit all (Graph)"],
                ["End",                   "Last frame"],
                ["Ctrl+Z",                "Undo"],
                ["Ctrl+Y / Ctrl+Shift+Z", "Redo"],
                ["Tab",                   "Toggle Dope Sheet ↔ Graph Editor"],
                ["H",                     "Hide selected joints"],
                ["Alt+H",                 "Unhide all joints"],
                ["F1",                    "Open / close this help"],
            ]],
            ["Viewport — Front View", [
                ["Drag joint",            "Move joint (Auto Key writes a keyframe)"],
                ["Shift+click joint",     "Add to multi-selection"],
                ["Ctrl+drag empty",       "Box-select joints"],
                ["RMB on joint",          "Disable / enable joint (confidence = 0)"],
                ["K",                     "Commit keyframe (when Auto Key is OFF)"],
                ["Scroll",                "Zoom in / out"],
                ["Middle-drag",           "Pan canvas"],
                ["Dbl-click",             "Reset zoom and pan"],
                ["SHOW ALL button",       "Override hidden joints and show everything"],
                ["⟳ Reset View button",  "Reset zoom and pan to fit the skeleton"],
            ]],
            ["Viewport — Camera & View", [
                ["Front button",          "2D front-view canvas (default)"],
                ["3D button",             "Orbit view — drag joints to set Z-depth"],
                ["Split button",          "Front + Orbit side-by-side"],
                ["＋ Add ▾ → Hand",       "Synthesize a hand pose at the wrist"],
                ["IK / FK toggle",        "Switch hand IK mode (moves all fingers with wrist)"],
                ["⚗ Experimental",        "Toggle NLF 3D overlay (requires NLFModelLoader node)"],
            ]],
            ["Viewport — Orbit (3D) View", [
                ["Drag joint horizontal", "Adjust joint Z-depth (front/back)"],
                ["Drag joint vertical",   "Adjust joint Y position"],
                ["Scroll",                "Zoom orbit canvas"],
                ["Middle-drag",           "Pan orbit canvas"],
                ["Drag axis labels",      "Rotate the 3D view"],
            ]],
            ["Reference Card", [
                ["🖼 Image",              "Load a still image as a reference overlay"],
                ["🎬 Video",              "Load a video file synced to the timeline"],
                ["🎞 Seq",               "Load an image sequence (multi-select in file picker)"],
                ["Opacity slider",        "Adjust reference image transparency"],
                ["× Clear",              "Remove the current reference"],
                ["👁 Reference: ON/OFF", "Toggle reference visibility"],
            ]],
            ["Graph Editor — Navigation", [
                ["Scroll",                "Pan horizontally"],
                ["Shift+Scroll",          "Pan vertically"],
                ["Ctrl+Scroll",           "Zoom horizontal (around cursor)"],
                ["Ctrl+Shift+Scroll",     "Zoom vertical (around cursor)"],
                ["Middle-drag",           "Free pan"],
                [". (period)",            "Fit selected keyframes in view"],
                ["Home",                  "Fit all frames in view"],
            ]],
            ["Graph Editor — Selection", [
                ["LMB click",             "Select keyframe (X or Y curve)"],
                ["Shift+LMB",             "Add / remove from selection"],
                ["Drag on empty",         "Rubber-band select"],
                ["A",                     "Select all / Deselect all (toggle)"],
                ["Ctrl+A",                "Add all to selection"],
                ["Ctrl+LMB",              "Insert keyframe at clicked position"],
                ["Escape",                "Deselect all / Cancel operation"],
            ]],
            ["Graph Editor — Editing", [
                ["K / I",                 "Insert keyframe at current frame"],
                ["X / Delete",            "Delete selected keyframes"],
                ["G",                     "Grab — move selected KFs (time + value)"],
                ["G → X / Y",            "Grab locked to time / value axis"],
                ["Enter / LMB",           "Confirm Grab or Scale"],
                ["Esc / RMB",             "Cancel Grab or Scale"],
                ["S",                     "Scale KFs around selection center"],
                ["S → X / Y",            "Scale time / value axis only"],
                ["O",                     "Gaussian smooth selected keyframe values"],
            ]],
            ["Dope Sheet", [
                ["LMB on track",          "Seek to frame"],
                ["LMB on diamond",        "Select keyframe"],
                ["Shift+LMB",             "Add to selection"],
                ["Drag on track",         "Rubber-band select"],
                ["Drag selection",        "Move keyframes in time"],
                ["A",                     "Select all / Deselect all"],
                ["K / I",                 "Insert keyframe at current frame"],
                ["X / Delete",            "Delete selected keyframes"],
                ["Ctrl+C / V",            "Copy / Paste selected keyframes"],
                ["◀K✕ Before",           "Trim all KFs before cursor"],
                ["✕K▶ After",            "Trim all KFs after cursor"],
            ]],
        ];
        let html = `<div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:12px;border-bottom:1px solid #334;padding-bottom:8px;">
            DWPose Temporal Editor — Help &amp; Shortcuts</div>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">`;
        for (const [sectionTitle, entries] of sections) {
            html += `<div style="margin-bottom:10px;"><div style="color:#88aacc;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${sectionTitle}</div>`;
            html += `<table style="width:100%;border-collapse:collapse;">`;
            for (const [key, desc] of entries) {
                html += `<tr><td style="color:#ffe088;padding:1px 6px 1px 0;white-space:nowrap;">${key}</td><td style="color:#bbb;">${desc}</td></tr>`;
            }
            html += `</table></div>`;
        }
        html += `</div>`;
        // Keyframe icon legend
        html += `<div style="margin-top:12px;border-top:1px solid #334;padding-top:10px;">`;
        html += `<div style="color:#88aacc;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Keyframe Icon Legend</div>`;
        html += `<div style="display:flex;gap:18px;flex-wrap:wrap;">`;
        const legendItems = [
            ['◆', '#ffd700', 'Linear — constant speed'],
            ['●', '#ffd700', 'Smooth (Catmull-Rom / Bezier)'],
            ['■', '#ffd700', 'Hold / Constant (instant jump)'],
            ['⧫', '#ffd700', 'Ease — slow in &amp; slow out (hourglass)'],
            ['◑', '#ffd700', 'Split — different in/out interpolation'],
        ];
        for (const [icon, color, desc] of legendItems) {
            html += `<span style="white-space:nowrap;"><span style="color:${color};font-size:14px;">${icon}</span> <span style="color:#aaa;font-size:11px;">${desc}</span></span>`;
        }
        html += `</div></div>`;
        html += `<div style="text-align:right;margin-top:14px;"><button id="_twHelpClose" style="background:#334;border:1px solid #556;color:#ccc;padding:5px 18px;border-radius:4px;cursor:pointer;font-size:12px;">Close  [Escape / F1]</button></div>`;
        panel.innerHTML = html;
        modal.appendChild(panel);
        document.body.appendChild(modal);
        const close = () => { if (modal.parentNode) document.body.removeChild(modal); };
        document.getElementById("_twHelpClose").addEventListener("click", close);
        modal.addEventListener("mousedown", e => { if (e.target === modal) close(); });
        // Close on Escape or F1 — but only this modal's own listener
        const onKey = e => { if (e.key === "Escape" || e.key === "F1") { e.stopPropagation(); close(); document.removeEventListener("keydown", onKey, true); } };
        document.addEventListener("keydown", onKey, true);
    }

    // -----------------------------------------------------------------------
    // Frame navigation
    // -----------------------------------------------------------------------
    _seekFrame(idx) {
        if (this.frameCount === 0) return;
        // Clamp to frame range
        const lo = this.frameRangeStart, hi = this.frameRangeEnd || this.frameCount - 1;
        idx = Math.max(lo, Math.min(hi, idx));

        // Auto Keyframe OFF: discard temporary edits when leaving the frame
        if (!this.autoKeyframe && this._tempKeys.size > 0 && idx !== this.currentFrame) {
            for (const key of this._tempKeys) {
                const [fStr, label] = key.split("::");
                const fi = parseInt(fStr);
                if (this.overrides[fi]) {
                    delete this.overrides[fi][label];
                    if (Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
                }
            }
            this._tempKeys.clear();
        }

        this.currentFrame = idx;
        this.scrubber.value = String(idx);
        this.frameLabel.textContent = `Frame: ${idx} / ${this.frameCount-1}`;
        this._renderFrame(idx);
        if (this._refVideo && this.showReference) this._seekRefVideo(idx);
        this._renderTrack();
        this._updateInterpBtns();
        this._updateDetailPanels();
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    _updateDetailPanels() {
        const fi = this.currentFrame;
        const fd = this._getEffectiveFrame(fi);
        if (this._detailInputs && Object.keys(this._detailInputs).length > 0) {
            for (const [label, inputs] of Object.entries(this._detailInputs)) {
                const [group, idxStr] = label.split("_");
                const index = parseInt(idxStr);
                const grpPts = group === "body" ? fd?.body : group === "rhand" ? fd?.rhand : fd?.lhand;
                const pt = grpPts?.[index] ?? [0, 0, 1];
                if (inputs.xInp    && document.activeElement !== inputs.xInp)    inputs.xInp.value    = pt[0].toFixed(1);
                if (inputs.yInp    && document.activeElement !== inputs.yInp)    inputs.yInp.value    = pt[1].toFixed(1);
                if (inputs.confInp && document.activeElement !== inputs.confInp) inputs.confInp.value = ((pt[2] ?? 1) * 100).toFixed(0);
                if (inputs.zInp    && document.activeElement !== inputs.zInp) {
                    const z = this.zDepth[fi]?.[label] ?? this.overrides[fi]?.[label]?.[3] ?? 0;
                    inputs.zInp.value = z.toFixed(3);
                }
                if (inputs.zOffsetInp && document.activeElement !== inputs.zOffsetInp) {
                    inputs.zOffsetInp.value = (this.zGlobalOffset[label] ?? 0).toFixed(3);
                }
            }
        }
        if (this._rotInputs) {
            for (const [label, chs] of Object.entries(this._rotInputs)) {
                for (const [ch, inp] of Object.entries(chs)) {
                    if (document.activeElement !== inp) {
                        const v = this.overrides[fi]?.[`${label}::${ch}`]
                               ?? this._interpolateChannel(label, ch, fi) ?? 0;
                        inp.value = v.toFixed(1);
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Viewport rendering
    // -----------------------------------------------------------------------
    _renderFrame(idx) {
        this._preRotZ = null;   // reset snapshot each render cycle (prevents double-rotation)
        const cw = this.canvas.width, ch = this.canvas.height;
        if (!cw||!ch) return;
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0,0,cw,ch); ctx.fillStyle="#0d0d1a"; ctx.fillRect(0,0,cw,ch);
        this.gizmoCenter = null;

        if (this.cameraView === "split") {
            const halfW = Math.floor(cw/2);
            this._renderFrontView(ctx, idx, halfW, ch, 0, 0);
            ctx.strokeStyle="#555"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(halfW,0); ctx.lineTo(halfW,ch); ctx.stroke();
            ctx.save(); ctx.translate(halfW,0); this._renderOrbitView(ctx, idx, halfW, ch); ctx.restore();
            return;
        }
        if (this.cameraView === "orbit") { this._renderOrbitView(ctx, idx, cw, ch); return; }
        this._renderFrontView(ctx, idx, cw, ch, 0, 0);
    }

    _getFrontTransform(vW, vH) {
        const base = Math.min(vW / this.poseW, vH / this.poseH) * 0.95;
        const sx = base * this.vpZoom, sy = sx;
        const ox = (vW - this.poseW * sx) / 2 + this.vpPanX;
        const oy = (vH - this.poseH * sy) / 2 + this.vpPanY;
        return { sx, sy, ox, oy };
    }

    _renderFrontView(ctx, idx, vW, vH, offX, offY) {
        const { sx,sy,ox,oy } = this._getFrontTransform(vW, vH);
        const aox=offX+ox, aoy=offY+oy;
        // Ghost region: fill entire viewport so user can see where the canvas edges are
        if (this.vpZoom > 1.05) {
            ctx.fillStyle="#0a0a14"; ctx.fillRect(offX, offY, vW, vH);
        }
        ctx.fillStyle="#1a1a2e"; ctx.fillRect(aox,aoy,this.poseW*sx,this.poseH*sy);
        const _refSrc = this.showReference ? this._getRefSource(idx) : null;
        if (_refSrc) {
            ctx.globalAlpha = this._refMeta?.opacity ?? 0.55;
            ctx.drawImage(_refSrc, aox, aoy, this.poseW*sx, this.poseH*sy);
            ctx.globalAlpha = 1;
        } else if (this._bgCache[idx]) {
            ctx.globalAlpha = 0.55;
            ctx.drawImage(this._bgCache[idx], aox, aoy, this.poseW*sx, this.poseH*sy);
            ctx.globalAlpha = 1;
        } else {
            this._fetchBg(idx);
        }
        ctx.strokeStyle="#3a3a5a"; ctx.lineWidth=1;
        ctx.strokeRect(aox+0.5,aoy+0.5,this.poseW*sx-1,this.poseH*sy-1);
        const dwAlpha = this._experimentalMode ? Math.max(0, 1 - this._nlfBlend) : 1;
        if (dwAlpha < 1) { ctx.save(); ctx.globalAlpha = dwAlpha; }
        this._drawSkeleton(ctx, idx, sx, sy, aox, aoy);
        if (dwAlpha < 1) ctx.restore();
        if (this._experimentalMode && this._nlfBlend > 0 && this._nlfData) {
            this._drawNlfOverlay(ctx, idx, sx, sy, aox, aoy, Math.min(1, this._nlfBlend * 2));
        }
        // Zoom level indicator
        if (this.vpZoom !== 1.0 || this.vpPanX !== 0 || this.vpPanY !== 0) {
            ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(offX+3, offY+vH-18, 130, 14);
            ctx.fillStyle = "#88aacc"; ctx.font = "9px monospace";
            ctx.fillText(`Zoom: ${this.vpZoom.toFixed(2)}x  Dbl-click: reset`, offX+6, offY+vH-7);
        }
        // Viewport rubber-band selection rect
        if (this._vpSelectRect) {
            const {startX,startY,curX,curY}=this._vpSelectRect;
            const rx=Math.min(startX,curX)+offX, ry=Math.min(startY,curY)+offY;
            const rw=Math.abs(curX-startX), rh=Math.abs(curY-startY);
            ctx.fillStyle="rgba(80,160,255,0.1)"; ctx.fillRect(rx,ry,rw,rh);
            ctx.strokeStyle="#5599ff"; ctx.lineWidth=1; ctx.setLineDash([3,2]);
            ctx.strokeRect(rx,ry,rw,rh); ctx.setLineDash([]);
        }
    }

    _poseToCanvas(px,py,sx,sy,ox,oy) { return { x:ox+px*sx, y:oy+py*sy }; }
    _canvasToPose(cx,cy,sx,sy,ox,oy) { return { x:(cx-ox)/sx, y:(cy-oy)/sy }; }

    _applyWristRotations(fd, idx) {
        // Snapshot original zDepth once per render cycle — prevents double-rotation when
        // both front view and orbit view call this with separate fd objects.
        if (!this._preRotZ) {
            this._preRotZ = {};
            const zf = this.zDepth[idx] || {};
            for (const k of Object.keys(zf)) this._preRotZ[k] = zf[k];
        }
        const snap = this._preRotZ;

        const applyRot = (wristLabel, side) => {
            // Only Z-axis rotation active; Rx/Ry kept for future use
            const rz=(this.overrides[idx]?.[`${wristLabel}::rz`]??this._interpolateChannel(wristLabel,"rz",idx)??0)*Math.PI/180;
            if (!rz) return;
            const handPts=side==="rhand"?fd.rhand:fd.lhand;
            if (!handPts?.length) return;
            const pX=handPts[0][0], pY=handPts[0][1];
            const cz=Math.cos(rz), sz2=Math.sin(rz);
            for (let i=0;i<handPts.length;i++) {
                const dx=handPts[i][0]-pX, dy=handPts[i][1]-pY;
                handPts[i][0]=pX+cz*dx-sz2*dy;
                handPts[i][1]=pY+sz2*dx+cz*dy;
            }
        };
        applyRot("body_4","rhand");
        applyRot("body_7","lhand");
    }

    _toggleExperimental() {
        this._experimentalMode = !this._experimentalMode;
        this._expBtn.textContent = `⚗ Experimental: ${this._experimentalMode ? "ON" : "OFF"}`;
        this._expBtn.style.background = this._experimentalMode ? "#1a2a3a" : "#1a1a2a";
        this._nlfPanel.style.display = this._experimentalMode ? "block" : "none";
        if (this._experimentalMode && this._nlfData === null && this._nlfStatus === "idle") {
            this._fetchNlfData();
        }
        this._renderFrame(this.currentFrame);
    }

    async _fetchNlfData() {
        this._nlfStatus = "loading";
        if (this._nlfStatusEl) this._nlfStatusEl.textContent = "NLF: loading...";
        try {
            const resp = await fetch(`/temporal-editor/nlf/${this.nodeId}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.available && data.frames?.length) {
                this._nlfData = data.frames;
                this._nlfStatus = "ok";
                if (this._nlfStatusEl)
                    this._nlfStatusEl.textContent = `NLF: ${data.frames.length} frames ✓`;
            } else {
                this._nlfStatus = "unavailable";
                const reason = data.reason || "connect NLFModelLoader node and re-run workflow";
                if (this._nlfStatusEl)
                    this._nlfStatusEl.textContent = `NLF: ${reason}`;
            }
        } catch (e) {
            this._nlfStatus = "unavailable";
            if (this._nlfStatusEl) this._nlfStatusEl.textContent = `NLF: ${e.message}`;
        }
        this._renderFrame(this.currentFrame);
    }

    _drawNlfOverlay(ctx, frameIdx, sx, sy, ox, oy, alpha) {
        const fd = this._nlfData?.[frameIdx]; if (!fd) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const body = fd.body || [];
        // NLF body XY is normalised [0,1] — scale to pose pixel space before _poseToCanvas
        const toC = (pt) => this._poseToCanvas(pt[0] * this.poseW, pt[1] * this.poseH, sx, sy, ox, oy);
        ctx.strokeStyle = "#aa44ff"; ctx.lineWidth = 1.5;
        for (const [a, b] of NLF_SMPL_CONNECTIONS) {
            if (!body[a] || !body[b]) continue;
            const pa = toC(body[a]), pb = toC(body[b]);
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }
        ctx.fillStyle = "#cc66ff";
        for (const pt of body) {
            if (!pt) continue;
            const c = toC(pt);
            ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    _drawSkeleton(ctx, idx, sx, sy, ox, oy) {
        const fd = this._getEffectiveFrame(idx); if (!fd) return;
        if (ROTATION_ENABLED) this._applyWristRotations(fd, idx);
        const body=fd.body||[], rhand=fd.rhand, lhand=fd.lhand;
        const ovr=this.overrides[idx]||{};
        const isDisabled = (g,ki) => { const ov=ovr[`${g}_${ki}`]; return Array.isArray(ov)&&ov[2]===0; };
        const isKeyed    = (l) => ovr[l]!==undefined;
        const isInterp   = (l) => !ovr[l] && this._interpolateJoint(l,idx)!==null;
        const isVis      = (label, group) => !this.hiddenGroups.has(group) && !this.hiddenLayers.has(label);
        const bodyVis    = !this.hiddenGroups.has("body");

        const baseAlpha = ctx.globalAlpha;  // inherit outer context (e.g. NLF blend)
        const showAll = this._showAll;
        for (let i=0;i<BODY_CONNECTIONS.length;i++) {
            const [a,b]=BODY_CONNECTIONS[i];
            if (!body[a]||!body[b]) continue;
            const boneAlpha = showAll ? 1 : Math.min(body[a][2]??1, body[b][2]??1);
            if (boneAlpha < 0.01) continue;
            if (isDisabled("body",a)||isDisabled("body",b)) continue;
            if (!bodyVis || !isVis(`body_${a}`,"body") || !isVis(`body_${b}`,"body")) continue;
            const pa=this._poseToCanvas(body[a][0],body[a][1],sx,sy,ox,oy);
            const pb=this._poseToCanvas(body[b][0],body[b][1],sx,sy,ox,oy);
            ctx.globalAlpha = baseAlpha * boneAlpha;
            ctx.strokeStyle=BONE_COLORS[i]||"#aaa"; ctx.lineWidth=2;
            ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
        }
        for (let i=0;i<body.length;i++) {
            const pt=body[i]; if (!pt) continue;
            const conf = showAll ? 1 : (pt[2]??1);
            if (conf < 0.01) continue;
            const label=`body_${i}`;
            if (!isVis(label,"body")) continue;
            if (isDisabled("body",i)) {
                ctx.globalAlpha = baseAlpha;
                const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
                ctx.strokeStyle="#ff2222"; ctx.lineWidth=2; const r=6;
                ctx.beginPath(); ctx.moveTo(c.x-r,c.y-r); ctx.lineTo(c.x+r,c.y+r); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(c.x+r,c.y-r); ctx.lineTo(c.x-r,c.y+r); ctx.stroke();
                continue;
            }
            const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
            const isKf=isKeyed(label), isInt=isInterp(label);
            const isSel=this.selectedJoint?.label===label;
            const isMulti=this.selectedJoints.has(label);
            ctx.globalAlpha = baseAlpha * conf;
            ctx.fillStyle=isKf?"#ffd700":isInt?"#88aaff":(JOINT_COLORS[i]||"#fff");
            ctx.beginPath();
            if (isKf) { ctx.save();ctx.translate(c.x,c.y);ctx.rotate(Math.PI/4);ctx.fillRect(-5,-5,10,10);ctx.restore(); }
            else { ctx.arc(c.x,c.y,isSel?7:5,0,Math.PI*2); ctx.fill(); }
            ctx.globalAlpha = baseAlpha;  // rings always at full (inherited) opacity
            if (isSel)   { ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,9,0,Math.PI*2);ctx.stroke(); }
            if (isMulti && !isSel) { ctx.strokeStyle="#5599ff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(c.x,c.y,8,0,Math.PI*2);ctx.stroke(); }
        }
        ctx.globalAlpha = baseAlpha;
        const rOff=isDisabled("body",R_WRIST), lOff=isDisabled("body",L_WRIST);
        if (rhand&&!rOff&&!this.hiddenGroups.has("rhand")) this._drawHand(ctx,rhand,"#0064ff","rhand",ovr,isKeyed,isInterp,sx,sy,ox,oy);
        if (lhand&&!lOff&&!this.hiddenGroups.has("lhand")) this._drawHand(ctx,lhand,"#00c864","lhand",ovr,isKeyed,isInterp,sx,sy,ox,oy);
        if (showAll) {
            const drawMissingHand = (present, off, group, wristIdx, color, label) => {
                if (present || off || this.hiddenGroups.has(group)) return;
                const wp = body[wristIdx]; if (!wp) return;
                const c = this._poseToCanvas(wp[0], wp[1], sx, sy, ox, oy);
                ctx.save(); ctx.globalAlpha = baseAlpha * 0.5;
                ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
                ctx.beginPath(); ctx.arc(c.x, c.y, 16, 0, Math.PI*2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = color; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
                ctx.fillText(label, c.x, c.y + 3);
                ctx.textAlign = "left"; ctx.restore();
            };
            drawMissingHand(rhand, rOff, "rhand", R_WRIST, "#0064ff", "R?");
            drawMissingHand(lhand, lOff, "lhand", L_WRIST, "#00c864", "L?");
        }

        const sg=this.selectedJoint?.group, sl=this.selectedJoint?.label;
        if (ROTATION_ENABLED) {
            if ((sg==="rhand"||sl===`body_${R_WRIST}`)&&rhand) this._drawHandGizmo(ctx,"rhand",rhand,sx,sy,ox,oy);
            if ((sg==="lhand"||sl===`body_${L_WRIST}`)&&lhand) this._drawHandGizmo(ctx,"lhand",lhand,sx,sy,ox,oy);
        }

    }

    _drawHand(ctx,kps,color,prefix,ovr,isKeyed,isInterp,sx,sy,ox,oy) {
        const baseAlpha = ctx.globalAlpha;
        const showAll = this._showAll;
        for (const [a,b] of HAND_CONNECTIONS) {
            if (!kps[a]||!kps[b]) continue;
            if (this.hiddenLayers.has(`${prefix}_${a}`)||this.hiddenLayers.has(`${prefix}_${b}`)) continue;
            const boneAlpha = showAll ? 1 : Math.min(kps[a][2]??1, kps[b][2]??1);
            if (boneAlpha < 0.01) continue;
            ctx.globalAlpha = baseAlpha * boneAlpha;
            const pa=this._poseToCanvas(kps[a][0],kps[a][1],sx,sy,ox,oy);
            const pb=this._poseToCanvas(kps[b][0],kps[b][1],sx,sy,ox,oy);
            ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
        }
        for (let i=0;i<kps.length;i++) {
            const pt=kps[i]; if (!pt) continue;
            const conf = showAll ? 1 : (pt[2]??1);
            if (conf < 0.01) continue;
            const label=`${prefix}_${i}`;
            if (this.hiddenLayers.has(label)) continue;
            const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
            const isKf=isKeyed(label), isInt=!isKf&&isInterp(label);
            const isSel=this.selectedJoint?.label===label;
            const isMulti=this.selectedJoints.has(label);
            ctx.globalAlpha = baseAlpha * conf;
            ctx.fillStyle=isKf?"#ffd700":isInt?"#88aaff":color;
            ctx.beginPath();
            if (isKf) { ctx.save();ctx.translate(c.x,c.y);ctx.rotate(Math.PI/4);ctx.fillRect(-4,-4,8,8);ctx.restore(); }
            else { ctx.arc(c.x,c.y,isSel?5:3,0,Math.PI*2); ctx.fill(); }
            ctx.globalAlpha = baseAlpha;
            if (isSel)   { ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(c.x,c.y,7,0,Math.PI*2);ctx.stroke(); }
            if (isMulti && !isSel) { ctx.strokeStyle="#5599ff";ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(c.x,c.y,6,0,Math.PI*2);ctx.stroke(); }
        }
        ctx.globalAlpha = baseAlpha;
    }

    // -----------------------------------------------------------------------
    // Hand gizmo
    // -----------------------------------------------------------------------
    _drawHandGizmo(ctx, side, kps, sx, sy, ox, oy) {
        if (!kps || !kps[0]) return;
        const pivot = this._poseToCanvas(kps[0][0], kps[0][1], sx, sy, ox, oy);
        this.gizmoCenter = { x: pivot.x, y: pivot.y, side };
        const R = 32;
        ctx.save();
        ctx.lineWidth = 2.5;
        // Z ring only — flat circle (rotation around Z axis, spins in screen plane)
        ctx.strokeStyle = "#4488ff";
        ctx.beginPath(); ctx.arc(pivot.x, pivot.y, R, 0, Math.PI*2); ctx.stroke();
        ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "#6699ff"; ctx.fillText("Z", pivot.x + R + 8, pivot.y + 3);
        ctx.textAlign = "left";
        ctx.restore();
    }

    _hitTestGizmo(cx, cy) {
        const gc = this.gizmoCenter; if (!gc) return null;
        const dx = cx - gc.x, dy = cy - gc.y;
        const R = 32, TOL = 7;
        // Z ring only
        const distZ = Math.hypot(dx, dy);
        if (distZ >= R - TOL && distZ <= R + TOL) return { axis:"z", side:gc.side };
        return null;
    }

    _rotateHand(side,axis,angleDeg) {
        const fi=this.currentFrame, fd=this._getEffectiveFrame(fi); if (!fd) return;
        const kps=side==="rhand"?fd.rhand:fd.lhand; if (!kps||kps.length===0) return;
        const pX=kps[0][0],pY=kps[0][1], zFrame=this.zDepth[fi]||{}, pZ=zFrame[`${side}_0`]??0;
        const rad=angleDeg*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
        if (!this.overrides[fi]) this.overrides[fi]={};
        if (!this.zDepth[fi])    this.zDepth[fi]={};
        for (let i=0;i<kps.length;i++) {
            const label=`${side}_${i}`;
            const x=kps[i][0],y=kps[i][1],z=zFrame[label]??pZ;
            const dx=x-pX,dy=y-pY,dz=z-pZ;
            let nx,ny,nz;
            if (axis==="x")      {nx=dx;ny=dy*cos-dz*sin;nz=dy*sin+dz*cos;}
            else if (axis==="y") {nx=dx*cos+dz*sin;ny=dy;nz=-dx*sin+dz*cos;}
            else                 {nx=dx*cos-dy*sin;ny=dx*sin+dy*cos;nz=dz;}
            this.overrides[fi][label]=[pX+nx,pY+ny,kps[i][2]??1.0];
            this.zDepth[fi][label]=pZ+nz;
        }
        this._renderFrame(fi); this._renderTrack();
    }

    // -----------------------------------------------------------------------
    // 3D Orbit camera
    // -----------------------------------------------------------------------
    /** Returns a 3×3 rotation matrix for current yaw + pitch. */
    _getOrbitMatrix() {
        const yaw   = this.orbitYaw   * Math.PI / 180;
        const pitch = this.orbitPitch * Math.PI / 180;
        const cy=Math.cos(yaw), sy=Math.sin(yaw);
        const cp=Math.cos(pitch), sp=Math.sin(pitch);
        // Ry (yaw) * Rx (pitch)
        return {
            m00: cy,   m01: sy*sp,  m02: sy*cp,
            m10: 0,    m11: cp,     m12: -sp,
            m20: -sy,  m21: cy*sp,  m22: cy*cp,
        };
    }

    /** Project a skeleton-space point to canvas coords using the orbit matrix. */
    _orbitProject(dx, dy, dz, M, scale, ocx, ocy) {
        const rx = M.m00*dx + M.m10*dy + M.m20*dz;
        const ry = M.m01*dx + M.m11*dy + M.m21*dz;
        return { x: ocx + rx * scale, y: ocy + ry * scale };
    }

    _renderOrbitView(ctx, idx, vW, vH) {
        ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, vW, vH);
        const fd = this._getEffectiveFrame(idx); if (!fd) return;
        if (ROTATION_ENABLED) this._applyWristRotations(fd, idx);
        const body = fd.body || [], rhand = fd.rhand, lhand = fd.lhand;
        const zFrame = this.zDepth[idx] || {};
        const Z_SCALE = this.poseW * 0.35;   // z-depth units → pose-pixel units

        const scale = Math.min(vW / this.poseW, vH / this.poseH) * 0.82 * this.orbitZoom;
        const ocx = vW / 2, ocy = vH / 2;
        const pivX = this.poseW / 2, pivY = this.poseH / 2;   // rotation pivot

        const M = this._getOrbitMatrix();
        const proj = (px, py, pz) =>
            this._orbitProject((px-pivX)*scale, (py-pivY)*scale, pz*Z_SCALE*scale, M, 1, ocx, ocy);

        // Reference card — a 3D plane behind the skeleton that rotates with the camera
        if (this.showReference) {
            const refImg = this._getRefSource(idx) || this._bgCache[idx];
            if (refImg) {
                const rW = refImg.videoWidth || refImg.naturalWidth || refImg.width || this.poseW;
                const rH = refImg.videoHeight || refImg.naturalHeight || refImg.height || this.poseH;
                const cardW = this.poseW * 0.9, cardH = this.poseH * 0.9;
                const cardZ = -0.8;
                const corners = [
                    [-cardW/2, -cardH/2, cardZ],
                    [ cardW/2, -cardH/2, cardZ],
                    [ cardW/2,  cardH/2, cardZ],
                    [-cardW/2,  cardH/2, cardZ],
                ];
                const pts = corners.map(([dx,dy,dz]) =>
                    this._orbitProject(dx*scale, dy*scale, dz*Z_SCALE*scale, M, 1, ocx, ocy));

                const [P0, P1, P2, P3] = pts;
                ctx.save();
                ctx.globalAlpha = this._refMeta?.opacity ?? 0.55;
                this._drawImageTri(ctx, refImg, P0, P1, P2, 0,0, rW,0, rW,rH);
                this._drawImageTri(ctx, refImg, P0, P2, P3, 0,0, rW,rH, 0,rH);
                ctx.globalAlpha = 1;
                ctx.restore();
            } else {
                this._fetchBg(idx);
            }
        }

        // Draw hint text
        ctx.fillStyle = "#334"; ctx.font = "10px sans-serif";
        ctx.fillText("Drag to orbit · Scroll to zoom", 6, vH - 6);

        // Skeleton pivot cross
        const pc = proj(pivX, pivY, 0);
        ctx.strokeStyle = "#223"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pc.x-10,pc.y); ctx.lineTo(pc.x+10,pc.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pc.x,pc.y-10); ctx.lineTo(pc.x,pc.y+10); ctx.stroke();

        const bodyGrpVis = !this.hiddenGroups.has("body");

        // Sort body bones back-to-front (painter's algo on projected Z)
        const bones = [];
        const showAll = this._showAll;
        for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
            const [a,b] = BODY_CONNECTIONS[i];
            if (!body[a]||!body[b]) continue;
            const boneAlpha = showAll ? 1 : Math.min(body[a][2]??1, body[b][2]??1);
            if (boneAlpha < 0.01) continue;
            if (!bodyGrpVis || this.hiddenLayers.has(`body_${a}`) || this.hiddenLayers.has(`body_${b}`)) continue;
            const za = (zFrame[`body_${a}`]??0) + (this.zGlobalOffset[`body_${a}`]??0);
            const zb = (zFrame[`body_${b}`]??0) + (this.zGlobalOffset[`body_${b}`]??0);
            const dza = (body[a][0]-pivX)*M.m02 + (body[a][1]-pivY)*M.m12 + za*Z_SCALE*M.m22;
            const dzb = (body[b][0]-pivX)*M.m02 + (body[b][1]-pivY)*M.m12 + zb*Z_SCALE*M.m22;
            bones.push({ i, a, b, za, zb, boneAlpha, depth: (dza+dzb)/2 });
        }
        bones.sort((x,y) => x.depth - y.depth);   // furthest first

        for (const { i, a, b, za, zb, boneAlpha } of bones) {
            const pa = proj(body[a][0],body[a][1],za), pb = proj(body[b][0],body[b][1],zb);
            ctx.globalAlpha = boneAlpha;
            ctx.strokeStyle = BONE_COLORS[i]||"#666"; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < body.length; i++) {
            const pt = body[i]; if (!pt) continue;
            const conf = showAll ? 1 : (pt[2]??1); if (conf < 0.01) continue;
            if (!bodyGrpVis || this.hiddenLayers.has(`body_${i}`)) continue;
            const z = (zFrame[`body_${i}`]??0) + (this.zGlobalOffset[`body_${i}`]??0), c = proj(pt[0],pt[1],z);
            const isSel = this.selectedJoint?.group==="body" && this.selectedJoint?.index===i;
            ctx.globalAlpha = conf;
            ctx.fillStyle = isSel ? "#ffd700" : (JOINT_COLORS[i]||"#fff");
            ctx.beginPath(); ctx.arc(c.x, c.y, isSel?8:5.5, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
            if (isSel) { ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(c.x,c.y,11,0,Math.PI*2); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;

        const rWZ = zFrame[`body_${R_WRIST}`]??0, lWZ = zFrame[`body_${L_WRIST}`]??0;
        if (rhand && !this.hiddenGroups.has("rhand")) this._drawHandOrbit(ctx, rhand, "#0064ff", "rhand", zFrame, rWZ + (this.zGlobalOffset[`body_${R_WRIST}`]??0), proj);
        if (lhand && !this.hiddenGroups.has("lhand")) this._drawHandOrbit(ctx, lhand, "#00c864", "lhand", zFrame, lWZ + (this.zGlobalOffset[`body_${L_WRIST}`]??0), proj);

        // NLF experimental orbit overlay
        if (this._experimentalMode && this._nlfBlend > 0 && this._nlfData) {
            const nlfFd = this._nlfData[idx];
            if (nlfFd) {
                const nlfAlpha = Math.min(1, this._nlfBlend * 2);
                ctx.save();
                ctx.globalAlpha = nlfAlpha;
                const nlfBody = nlfFd.body || [];
                ctx.strokeStyle = "#aa44ff"; ctx.lineWidth = 1.5;
                for (const [a, b] of NLF_SMPL_CONNECTIONS) {
                    if (!nlfBody[a] || !nlfBody[b]) continue;
                    const pa = proj(nlfBody[a][0] * this.poseW, nlfBody[a][1] * this.poseH, nlfBody[a][2] ?? 0);
                    const pb = proj(nlfBody[b][0] * this.poseW, nlfBody[b][1] * this.poseH, nlfBody[b][2] ?? 0);
                    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
                }
                ctx.fillStyle = "#cc66ff";
                for (const pt of nlfBody) {
                    if (!pt) continue;
                    const p = proj(pt[0] * this.poseW, pt[1] * this.poseH, pt[2] ?? 0);
                    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }
        }

        this._drawOrbitAxes(ctx, vW, vH, M);
    }

    _drawHandOrbit(ctx, kps, color, prefix, zFrame, wristZ, proj) {
        const showAll = this._showAll;
        for (const [a,b] of HAND_CONNECTIONS) {
            if (!kps[a]||!kps[b]) continue;
            if (this.hiddenLayers.has(`${prefix}_${a}`)||this.hiddenLayers.has(`${prefix}_${b}`)) continue;
            const boneAlpha = showAll ? 1 : Math.min(kps[a][2]??1, kps[b][2]??1);
            if (boneAlpha < 0.01) continue;
            const za = zFrame[`${prefix}_${a}`]??wristZ, zb = zFrame[`${prefix}_${b}`]??wristZ;
            const pa = proj(kps[a][0],kps[a][1],za), pb = proj(kps[b][0],kps[b][1],zb);
            ctx.globalAlpha = boneAlpha;
            ctx.strokeStyle = color; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
        }
        for (let i = 0; i < kps.length; i++) {
            const pt = kps[i]; if (!pt) continue;
            const conf = showAll ? 1 : (pt[2]??1); if (conf < 0.01) continue;
            if (this.hiddenLayers.has(`${prefix}_${i}`)) continue;
            const z = zFrame[`${prefix}_${i}`]??wristZ, c = proj(pt[0],pt[1],z);
            const isSel = this.selectedJoint?.group===prefix && this.selectedJoint?.index===i;
            ctx.globalAlpha = conf;
            ctx.fillStyle = isSel ? "#ffd700" : color;
            ctx.beginPath(); ctx.arc(c.x, c.y, isSel?5:3, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 1;
            if (isSel) { ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(c.x,c.y,7,0,Math.PI*2); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
    }

    /** Draw a small XYZ axis gizmo in the corner to show current orbit orientation. */
    _drawOrbitAxes(ctx, vW, vH, M) {
        const ox = 28, oy = vH - 28, len = 22;
        const proj2D = (x,y,z) => ({
            x: ox + (M.m00*x + M.m10*y + M.m20*z)*len,
            y: oy + (M.m01*x + M.m11*y + M.m21*z)*len,
        });
        const O = proj2D(0,0,0);
        ctx.lineWidth = 2; ctx.font = "bold 9px sans-serif";
        const axes = [
            [proj2D(1,0,0), "#ff5555", "X"],
            [proj2D(0,1,0), "#55ff55", "Y"],
            [proj2D(0,0,1), "#5599ff", "Z"],
        ];
        for (const [tip, col, lbl] of axes) {
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(O.x,O.y); ctx.lineTo(tip.x,tip.y); ctx.stroke();
            ctx.fillText(lbl, tip.x+2, tip.y+3);
        }
    }

    /**
     * Draw a triangle of an image onto canvas using affine (shear) mapping.
     * Works correctly for orthographic-projected parallelograms.
     * dPt = destination canvas {x,y}, sPt = source image [sx,sy]
     */
    _drawImageTri(ctx, img, dA, dB, dC, sAx,sAy, sBx,sBy, sCx,sCy) {
        // Compute affine matrix from src → dst triangle
        const dx = [dB.x-dA.x, dC.x-dA.x];
        const dy = [dB.y-dA.y, dC.y-dA.y];
        const dsx = [sBx-sAx, sCx-sAx];
        const dsy = [sBy-sAy, sCy-sAy];
        const det = dsx[0]*dsy[1] - dsx[1]*dsy[0];
        if (Math.abs(det) < 0.001) return;
        const a = (dx[0]*dsy[1] - dx[1]*dsy[0]) / det;
        const b = (dy[0]*dsy[1] - dy[1]*dsy[0]) / det;
        const c = (dx[1]*dsx[0] - dx[0]*dsx[1]) / det;
        const d2= (dy[1]*dsx[0] - dy[0]*dsx[1]) / det;
        const e = dA.x - a*sAx - c*sAy;
        const f = dA.y - b*sAx - d2*sAy;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(dA.x, dA.y); ctx.lineTo(dB.x, dB.y); ctx.lineTo(dC.x, dC.y);
        ctx.closePath(); ctx.clip();
        ctx.transform(a, b, c, d2, e, f);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
    }

    /** Hit-test joints in orbit view — returns {group, index, label} or null. */
    _hitTestOrbit(cx, cy, vW, vH) {
        const fd = this._getEffectiveFrame(this.currentFrame); if (!fd) return null;
        const M = this._getOrbitMatrix();
        const zFrame = this.zDepth[this.currentFrame] || {};
        const Z_SCALE = this.poseW * 0.35;
        const scale = Math.min(vW / this.poseW, vH / this.poseH) * 0.82 * this.orbitZoom;
        const ocx = vW/2, ocy = vH/2, pivX = this.poseW/2, pivY = this.poseH/2;
        const proj = (px,py,pz) =>
            this._orbitProject((px-pivX)*scale,(py-pivY)*scale,pz*Z_SCALE*scale,M,1,ocx,ocy);

        let best = null, bestD = 14;
        const test = (px, py, pz, group, i) => {
            const label = `${group}_${i}`;
            if (this.hiddenGroups.has(group) || this.hiddenLayers.has(label)) return;
            const c = proj(px,py,pz);
            const d = Math.hypot(cx-c.x, cy-c.y);
            if (d < bestD) { bestD=d; best={group, index:i, label}; }
        };
        const body = fd.body||[];
        for (let i=0;i<body.length;i++) {
            const pt=body[i]; if (!pt||pt[2]<0.01) continue;
            test(pt[0],pt[1],zFrame[`body_${i}`]??0,"body",i);
        }
        for (const [side,kps,wZ] of [["rhand",fd.rhand,zFrame[`body_${R_WRIST}`]??0],["lhand",fd.lhand,zFrame[`body_${L_WRIST}`]??0]]) {
            if (!kps || this.hiddenGroups.has(side)) continue;
            for (let i=0;i<kps.length;i++) {
                const pt=kps[i]; if (!pt) continue;
                test(pt[0],pt[1],zFrame[`${side}_${i}`]??wZ,side,i);
            }
        }
        return best;
    }

    _toggleReference() {
        this.showReference = !this.showReference;
        this.refToggleBtn.textContent = `👁 Reference: ${this.showReference?"ON":"OFF"}`;
        this.refToggleBtn.style.background = this.showReference ? "#1a2a1a" : "#2a1a1a";
        this._renderFrame(this.currentFrame);
    }

    _translateHand(fi, group, dX, dY, startIdx = 0) {
        if (Math.abs(dX) < 0.0001 && Math.abs(dY) < 0.0001) return;
        const rawPts = group === "rhand" ? this.frames[fi]?.rhand : this.frames[fi]?.lhand;
        const count = rawPts ? rawPts.length : 21;
        if (!this.overrides[fi]) this.overrides[fi] = {};
        const ovr = this.overrides[fi];
        const hasJoints = rawPts || Object.keys(ovr).some(k => k.startsWith(`${group}_`));
        if (!hasJoints) return;
        for (let i = startIdx; i < count; i++) {
            const lbl = `${group}_${i}`;
            const base = ovr[lbl] || rawPts?.[i];
            if (!base) continue;
            ovr[lbl] = [base[0] + dX, base[1] + dY, base[2] ?? 1.0, base[3] ?? 0];
        }
    }

    _getRefSource(idx) {
        if (this.referenceImg) return this.referenceImg;
        if (this._refVideo && this._refVideo.readyState >= 2) return this._refVideo;
        if (this._refSeqFrames?.length) {
            const i = Math.max(0, Math.min(this._refSeqFrames.length - 1,
                idx + (this._refMeta?.frameOffset || 0)));
            return this._refSeqFrames[i] || null;
        }
        return null;
    }

    _loadRefVideo(file) {
        if (this._refVideo) this._refVideo.src = "";
        this._refVideo = document.createElement("video");
        this._refVideo.muted = true;
        this._refVideo.preload = "auto";
        this._refVideo.src = URL.createObjectURL(file);
        this.referenceImg = null;
        this._refSeqFrames = null;
        this._refMeta = { type: "video", name: file.name, frameOffset: 0, opacity: 0.55 };
        if (this._refOffsetInp) this._refOffsetInp.value = "0";
        this._refVideo.addEventListener("loadedmetadata", () => {
            const v = this._refVideo;
            const dur = v.duration;
            const projectFps = parseFloat(this._fpsInput?.value) || 24;
            const estFrames = Math.round(dur * projectFps);
            if (this._refInfoDiv) {
                this._refInfoDiv.textContent =
                    `${v.videoWidth}×${v.videoHeight}  ·  ${dur.toFixed(2)}s  ·  ~${estFrames} frames @ ${projectFps}fps`;
                this._refInfoDiv.style.display = "block";
            }
            this._seekRefVideo(this.currentFrame);
        }, { once: true });
    }

    _seekRefVideo(fi) {
        if (!this._refVideo) return;
        const fps = parseFloat(this._fpsInput?.value) || 24;
        const t = Math.max(0, (fi + (this._refMeta?.frameOffset || 0)) / fps);
        if (Math.abs(this._refVideo.currentTime - t) < 0.001) {
            this._renderFrame(this.currentFrame);
            return;
        }
        this._refVideo.currentTime = t;
        this._refVideo.addEventListener("seeked", () => this._renderFrame(this.currentFrame), { once: true });
    }

    _loadRefSequence(files) {
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        this._refSeqFrames = new Array(sorted.length);
        this.referenceImg = null;
        if (this._refVideo) { this._refVideo.src = ""; this._refVideo = null; }
        this._refMeta = { type: "sequence", name: `${sorted[0].name} (+${sorted.length - 1})`, frameOffset: 0, opacity: 0.55 };
        if (this._refOffsetInp) this._refOffsetInp.value = "0";
        let loaded = 0;
        for (let i = 0; i < sorted.length; i++) {
            const img = new Image();
            img.onload = () => {
                if (++loaded === sorted.length) {
                    if (this._refInfoDiv) {
                        const first = this._refSeqFrames[0];
                        const projectFps = parseFloat(this._fpsInput?.value) || 24;
                        this._refInfoDiv.textContent =
                            `${first.naturalWidth}×${first.naturalHeight}  ·  ${sorted.length} frames  ·  ${(sorted.length / projectFps).toFixed(2)}s @ ${projectFps}fps`;
                        this._refInfoDiv.style.display = "block";
                    }
                    this._renderFrame(this.currentFrame);
                }
            };
            img.src = URL.createObjectURL(sorted[i]);
            this._refSeqFrames[i] = img;
        }
    }

    _showRelinkBanner() {
        if (!this._refRelinkBanner || !this._refMeta) return;
        const { type, name } = this._refMeta;
        this._refRelinkBanner.innerHTML = "";
        const msg = document.createElement("span");
        msg.textContent = `⚠ "${name}" — `;
        const relinkBtn = document.createElement("button");
        relinkBtn.textContent = "Re-link…";
        relinkBtn.style.cssText = "background:#3a2a00;border:1px solid #aa6622;color:#ffcc66;border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;";
        relinkBtn.addEventListener("click", () => {
            if (type === "video") this._refVideoInput?.click();
            else if (type === "sequence") this._refSeqInput?.click();
            else this._refFileInput?.click();
        });
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "×";
        closeBtn.style.cssText = "background:none;border:none;color:#aa7;font-size:13px;cursor:pointer;margin-left:4px;line-height:1;";
        closeBtn.addEventListener("click", () => { this._refRelinkBanner.style.display = "none"; });
        this._refRelinkBanner.append(msg, relinkBtn, closeBtn);
        this._refRelinkBanner.style.display = "block";
    }

    _setCameraView(view) {
        this.cameraView = view;
        this._updateCamBtns();
        this._renderFrame(this.currentFrame);
    }

    _updateCamBtns() {
        for (const [view, btn] of Object.entries(this._camBtns)) {
            const active = view === this.cameraView;
            btn.style.background   = active ? "#2a5080" : "#1e3a5a";
            btn.style.color        = active ? "#ffffff" : "#88aacc";
            btn.style.borderColor  = active ? "#4488cc" : "#2a4a6a";
        }
        const showReset = this.cameraView !== "front";
        this._resetViewBtn.style.display = showReset ? "block" : "none";
    }

    _resetView() {
        this.orbitYaw = -20; this.orbitPitch = 15; this.orbitZoom = 1.0;
        this.vpZoom = 1.0; this.vpPanX = 0; this.vpPanY = 0;
        this._renderFrame(this.currentFrame);
    }

    _onAddHandClick() {
        const fd = this._getEffectiveFrame(this.currentFrame);
        const hasR = !!(fd?.rhand);
        const hasL = !!(fd?.lhand);
        if (!hasR && hasL)  { this._addHand("rhand"); return; }
        if (!hasL && hasR)  { this._addHand("lhand"); return; }
        // Both missing or both present — show chooser
        this._addHandChooser.style.display =
            this._addHandChooser.style.display === "flex" ? "none" : "flex";
    }

    _addHand(side) {
        const fi = this.currentFrame;
        const fd = this._getEffectiveFrame(fi); if (!fd) return;
        const wristIdx = side === "rhand" ? R_WRIST : L_WRIST;
        const wp = fd.body?.[wristIdx];
        if (!wp) { console.warn("[AddHand] Wrist joint not found on this frame."); return; }
        const template = side === "rhand" ? DEFAULT_RHAND_PX : DEFAULT_LHAND_PX;
        const W = this.poseW || 512, H = this.poseH || 512;
        this._pushUndo();
        if (!this.overrides[fi]) this.overrides[fi] = {};
        for (let i = 0; i < 21; i++) {
            const [dx, dy] = template[i];
            this.overrides[fi][`${side}_${i}`] = [
                Math.max(0, Math.min(W, wp[0] + dx)),
                Math.max(0, Math.min(H, wp[1] + dy)),
                1.0, 0,
            ];
        }
        this._renderFrame(fi); this._renderTrack(); this._updateDetailPanels();
    }

    _toggleShowAll() {
        this._showAll = !this._showAll;
        const on = this._showAll;
        Object.assign(this._showAllBtn.style, {
            background:   on ? "#2a2400" : "#1a1a2a",
            color:        on ? "#ffdd44" : "#556",
            borderColor:  on ? "#887700" : "#333",
        });
        this._renderFrame(this.currentFrame);
    }

    async _fetchBg(idx) {
        if (this._bgPending.has(idx)) return;
        this._bgPending.add(idx);
        try {
            const r=await fetch(`/temporal-editor/background/${this.nodeId}/${idx}`);
            const d=await r.json();
            if (d.image) {
                const img=new Image();
                img.onload=()=>{this._bgCache[idx]=img;if(this.currentFrame===idx)this._renderFrame(idx);};
                img.src=`data:image/png;base64,${d.image}`;
            }
        } catch(_){}
    }

    // -----------------------------------------------------------------------
    // Hit testing
    // -----------------------------------------------------------------------
    _activeFrontViewW() { return this.cameraView==="split"?Math.floor(this.canvas.width/2):this.canvas.width; }

    _hitTest(cx,cy) {
        const vW=this._activeFrontViewW(), vH=this.canvas.height;
        const {sx,sy,ox,oy}=this._getFrontTransform(vW,vH);
        const THRESH=12, fd=this._getEffectiveFrame(this.currentFrame); if (!fd) return null;
        let best=null, bestD=THRESH;
        for (const {group,pts} of [{group:"body",pts:fd.body||[]},{group:"rhand",pts:fd.rhand||[]},{group:"lhand",pts:fd.lhand||[]}]) {
            if (!pts || this.hiddenGroups.has(group)) continue;
            for (let i=0;i<pts.length;i++) {
                const pt=pts[i]; if (!pt) continue;
                const label=`${group}_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
                const d=Math.hypot(cx-c.x,cy-c.y);
                if (d<bestD){bestD=d;best={group,index:i,label};}
            }
        }
        return best;
    }

    // -----------------------------------------------------------------------
    // Mouse events
    // -----------------------------------------------------------------------
    _onCanvasMouseDown(e) {
        e.preventDefault();
        this._hideSegmentPopup();
        const rect=this.canvas.getBoundingClientRect();
        const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
        const cw=this.canvas.width, ch=this.canvas.height;

        // Middle-mouse or Alt+left-drag → pan (front view)
        if (e.button===1 || (e.button===0 && e.altKey && this.cameraView==="front")) {
            this._vpPanDrag={startX:cx,startY:cy,startPanX:this.vpPanX,startPanY:this.vpPanY};
            return;
        }

        // Orbit view: left-drag on empty area → orbit; on joint → select/drag
        if (this.cameraView==="orbit" || (this.cameraView==="split" && cx>=Math.floor(cw/2))) {
            const isOrbitPane = this.cameraView==="orbit";
            const localCx = isOrbitPane ? cx : cx-Math.floor(cw/2);
            const vW = isOrbitPane ? cw : Math.floor(cw/2);
            const hit = this._hitTestOrbit(localCx, cy, vW, ch);
            if (hit) {
                if (e.shiftKey) this.selectedJoints.add(hit.label);
                else if (!this.selectedJoints.has(hit.label)) { this.selectedJoints.clear(); this.selectedJoints.add(hit.label); }
                this.selectedJoint=hit;
                this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
                if (this.lockedLayers.has(hit.label)) return; // locked — select only, no drag
                this._armUndo();
                const orbitMulti = this.selectedJoints.size > 1 && this.selectedJoints.has(hit.label);
                this.dragJoint={...hit, isOrbit:true, startCanvasX:localCx, startCanvasY:cy, multiDrag:orbitMulti};
            } else {
                this._orbitDrag={startX:localCx,startY:cy,startYaw:this.orbitYaw,startPitch:this.orbitPitch};
            }
            return;
        }

        // Front view: gizmo, then joint drag / rotation / rubber-band
        const gHit = ROTATION_ENABLED ? this._hitTestGizmo(cx,cy) : null;
        if (gHit) {
            const gc=this.gizmoCenter;
            this.dragGizmo={...gHit,lastMX:cx,lastMY:cy,lastAngle:Math.atan2(cy-gc.y,cx-gc.x)};
            return;
        }

        const hit=this._hitTest(cx,cy);
        if (hit) {
            if (e.shiftKey) this.selectedJoints.add(hit.label);
            else if (!this.selectedJoints.has(hit.label)) { this.selectedJoints.clear(); this.selectedJoints.add(hit.label); }
            this.selectedJoint=hit;
            this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
            if (this.lockedLayers.has(hit.label)) return; // locked — select only, no drag

            // Normal drag: if clicked joint is in selection, drag all selected; otherwise drag single
            const fi=this.currentFrame, fd=this._getEffectiveFrame(fi);
            this._armUndo();
            if (this.selectedJoints.size > 1 && this.selectedJoints.has(hit.label)) {
                const vW=this._activeFrontViewW(), vH=ch;
                const {sx,sy,ox,oy}=this._getFrontTransform(vW,vH);
                const pose=this._canvasToPose(cx,cy,sx,sy,ox,oy);
                this.dragJoint={...hit, multiDrag:true, startPoseX:pose.x, startPoseY:pose.y,
                    origPositions:this._getSelectionOrigPositions(fi, fd)};
            } else {
                this.dragJoint={...hit};
            }
            return;
        }

        // No joint hit → start viewport rubber-band selection
        if (!e.shiftKey) this.selectedJoints.clear();
        this._vpSelectRect={startX:cx,startY:cy,curX:cx,curY:cy};
        this._renderFrame(this.currentFrame);
    }

    /** Get centroid of selectedJoints in pose space. */
    _getSelectionCentroid(fi, fd) {
        let sx=0, sy=0, n=0;
        for (const lbl of this.selectedJoints) {
            const pt=this._getJointPosePos(lbl, fi, fd);
            if (pt) { sx+=pt[0]; sy+=pt[1]; n++; }
        }
        return n>0 ? {px:sx/n, py:sy/n} : null;
    }
    /** Get original pose positions for all selectedJoints. */
    _getSelectionOrigPositions(fi, fd) {
        const map={};
        for (const lbl of this.selectedJoints) {
            const pt=this._getJointPosePos(lbl, fi, fd);
            if (pt) map[lbl]={x:pt[0], y:pt[1]};
        }
        return map;
    }
    /** Get resolved [x,y] pose position for a joint label at fi. */
    _getJointPosePos(label, fi, fd) {
        const ov=this.overrides[fi]?.[label];
        if (ov) return ov;
        const parts=label.split("_"), grp=parts[0], ki=parseInt(parts[1]);
        const pts=grp==="body"?fd?.body:(grp==="rhand"?fd?.rhand:fd?.lhand);
        return pts?.[ki] ?? null;
    }

    _onCanvasMouseMove(e) {
        const rect=this.canvas.getBoundingClientRect();
        const cx=e.clientX-rect.left, cy=e.clientY-rect.top;

        // Viewport rubber-band selection
        if (this._vpSelectRect) {
            this._vpSelectRect.curX=cx; this._vpSelectRect.curY=cy;
            this._renderFrame(this.currentFrame);
            return;
        }

        // Pan drag
        if (this._vpPanDrag) {
            e.preventDefault();
            this.vpPanX=this._vpPanDrag.startPanX+(cx-this._vpPanDrag.startX);
            this.vpPanY=this._vpPanDrag.startPanY+(cy-this._vpPanDrag.startY);
            this._renderFrame(this.currentFrame);
            return;
        }

        // Orbit rotation drag
        if (this._orbitDrag) {
            e.preventDefault();
            const cw=this.canvas.width;
            const localCx=this.cameraView==="orbit"?cx:cx-Math.floor(cw/2);
            const dx=localCx-this._orbitDrag.startX, dy=cy-this._orbitDrag.startY;
            this.orbitYaw   = this._orbitDrag.startYaw   + dx*0.4;
            this.orbitPitch = Math.max(-89, Math.min(89, this._orbitDrag.startPitch + dy*0.4));
            this._renderFrame(this.currentFrame);
            return;
        }

        if (!this.dragJoint&&!this.dragGizmo) return;
        e.preventDefault();
        const fi=this.currentFrame;

        if (this.dragGizmo) {
            const {axis,side}=this.dragGizmo;
            let delta;
            if (axis==="z") {
                const gc=this.gizmoCenter;
                const na=Math.atan2(cy-gc.y,cx-gc.x);
                let da=(na-this.dragGizmo.lastAngle)*180/Math.PI;
                while(da>180)da-=360; while(da<-180)da+=360;
                this.dragGizmo.lastAngle=na; delta=da;
            } else if (axis==="x") { delta=-(cy-this.dragGizmo.lastMY)*0.5; this.dragGizmo.lastMY=cy; }
            else                   { delta=(cx-this.dragGizmo.lastMX)*0.5; }
            this.dragGizmo.lastMX=cx;
            if (Math.abs(delta)>0.01) this._rotateHand(side,axis,delta);
            return;
        }

        const {group,index,label}=this.dragJoint;

        // Orbit-view drag → free 3D movement via camera-space unproject
        if (this.dragJoint.isOrbit) {
            const cw=this.canvas.width, ch=this.canvas.height;
            const vW=this.cameraView==="orbit"?cw:Math.floor(cw/2);
            const localCx=this.cameraView==="orbit"?cx:cx-Math.floor(cw/2);
            const dscr_x=localCx-this.dragJoint.startCanvasX;
            const dscr_y=cy-this.dragJoint.startCanvasY;
            this.dragJoint.startCanvasX=localCx; this.dragJoint.startCanvasY=cy;
            if (dscr_x===0 && dscr_y===0) { this._renderFrame(fi); return; }
            this._lazyPushUndo();
            const scale=Math.min(vW/this.poseW,ch/this.poseH)*0.82*this.orbitZoom;
            const Z_SCALE=this.poseW*0.35;
            const M=this._getOrbitMatrix();
            // Camera-transpose unproject: Δpose = M^T · Δscreen / scale
            let dpx = dscr_x/scale * M.m00 + dscr_y/scale * M.m01;
            let dpy = dscr_x/scale * M.m10 + dscr_y/scale * M.m11;
            let dpz = (dscr_x/scale * M.m20 + dscr_y/scale * M.m21) / Z_SCALE;
            // Apply XY + Z movement — to all selected joints in multiDrag mode
            if (dpx !== 0 || dpy !== 0 || dpz !== 0) {
                const fd2=this._getEffectiveFrame(fi);
                if (!this.overrides[fi]) this.overrides[fi]={};
                const labelsToMove = this.dragJoint.multiDrag
                    ? [...this.selectedJoints].filter(l => !this.lockedLayers.has(l))
                    : [label];
                for (const lbl of labelsToMove) {
                    const parts=lbl.split("_"), grp=parts[0], ki=parseInt(parts[1]);
                    const pts2=grp==="body"?fd2?.body:(grp==="rhand"?fd2?.rhand:fd2?.lhand);
                    if (dpx !== 0 || dpy !== 0) {
                        const cur=this.overrides[fi]?.[lbl]||(pts2?.[ki]?[...pts2[ki]]:[0,0,1]);
                        this.overrides[fi][lbl]=[cur[0]+dpx, cur[1]+dpy, cur[2]??1.0];
                    }
                    if (dpz !== 0) {
                        if (!this.zDepth[fi]) this.zDepth[fi]={};
                        this.zDepth[fi][lbl]=parseFloat(((this.zDepth[fi]?.[lbl]??0)+dpz).toFixed(3));
                    }
                }
            }
            this._updateJointInfo(); this._renderFrame(fi);
            return;
        }

        // Front-view joint drag
        const vW=this._activeFrontViewW(), vH=this.canvas.height;
        const {sx,sy,ox,oy}=this._getFrontTransform(vW,vH);
        const pose=this._canvasToPose(cx,cy,sx,sy,ox,oy);
        this._lazyPushUndo();

        if (this.dragJoint.multiDrag) {
            // Move all selected joints together
            const delta={x:pose.x-this.dragJoint.startPoseX, y:pose.y-this.dragJoint.startPoseY};
            if (!this.overrides[fi]) this.overrides[fi]={};
            for (const [lbl, orig] of Object.entries(this.dragJoint.origPositions)) {
                const existing=this.overrides[fi][lbl];
                const conf=(Array.isArray(existing)&&existing[2]!==undefined)?existing[2]:1.0;
                this.overrides[fi][lbl]=[orig.x+delta.x, orig.y+delta.y, conf];
            }
        } else {
            // Move single joint
            if (!this.overrides[fi]) this.overrides[fi]={};

            // IK: capture delta before overwriting position
            let _ikDeltaX = 0, _ikDeltaY = 0;
            const _isRWrist = group === "body"  && index === R_WRIST && this.handIkMode.rhand;
            const _isLWrist = group === "body"  && index === L_WRIST && this.handIkMode.lhand;
            const _isRPalm  = group === "rhand" && index === 0       && this.handIkMode.rhand;
            const _isLPalm  = group === "lhand" && index === 0       && this.handIkMode.lhand;
            if (_isRWrist || _isLWrist || _isRPalm || _isLPalm) {
                const prevOv = this.overrides[fi]?.[label];
                const rawArr = group === "body" ? this.frames[fi]?.body
                             : group === "rhand" ? this.frames[fi]?.rhand
                             : this.frames[fi]?.lhand;
                const rawPt  = rawArr?.[index];
                const oldX   = prevOv?.[0] ?? rawPt?.[0] ?? pose.x;
                const oldY   = prevOv?.[1] ?? rawPt?.[1] ?? pose.y;
                _ikDeltaX = pose.x - oldX;
                _ikDeltaY = pose.y - oldY;
            }

            const existing=this.overrides[fi][label];
            const conf=(Array.isArray(existing)&&existing[2]!==undefined)?existing[2]:1.0;
            const z=this.zDepth[fi]?.[label]??0;
            this.overrides[fi][label]=[pose.x,pose.y,conf,z];
            const fd=this.frames[fi];
            if (fd) {
                const pts=group==="body"?fd.body:(group==="rhand"?fd.rhand:fd.lhand);
                if (pts?.[index]){pts[index][0]=pose.x;pts[index][1]=pose.y;}
            }

            // IK: propagate delta to linked joints
            if (_isRWrist) this._translateHand(fi, "rhand", _ikDeltaX, _ikDeltaY);
            if (_isLWrist) this._translateHand(fi, "lhand", _ikDeltaX, _ikDeltaY);
            if (_isRPalm || _isLPalm) {
                const handGroup = _isRPalm ? "rhand" : "lhand";
                const bWristIdx = _isRPalm ? R_WRIST : L_WRIST;
                // Translate fingers (skip joint 0, already written by drag)
                this._translateHand(fi, handGroup, _ikDeltaX, _ikDeltaY, 1);
                // Translate the body wrist joint
                if (_ikDeltaX !== 0 || _ikDeltaY !== 0) {
                    if (!this.overrides[fi]) this.overrides[fi] = {};
                    const bLbl = `body_${bWristIdx}`;
                    const bOv  = this.overrides[fi][bLbl];
                    const bRaw = this.frames[fi]?.body?.[bWristIdx];
                    const bBase = bOv || bRaw;
                    if (bBase) {
                        this.overrides[fi][bLbl] = [bBase[0] + _ikDeltaX, bBase[1] + _ikDeltaY, bBase[2] ?? 1.0];
                        if (bRaw) { bRaw[0] = this.overrides[fi][bLbl][0]; bRaw[1] = this.overrides[fi][bLbl][1]; }
                    }
                }
            }
        }
        this._updateJointInfo(); this._renderFrame(fi); this._renderTrack();
    }

    _onCanvasMouseUp(e) {
        // Finalize viewport rubber-band: select all joints inside the rect
        if (this._vpSelectRect) {
            const sel=this._vpSelectRect;
            this._vpSelectRect=null;
            const vW=this._activeFrontViewW(), vH=this.canvas.height;
            const {sx,sy,ox,oy}=this._getFrontTransform(vW,vH);
            const minCx=Math.min(sel.startX,sel.curX), maxCx=Math.max(sel.startX,sel.curX);
            const minCy=Math.min(sel.startY,sel.curY), maxCy=Math.max(sel.startY,sel.curY);
            if (!e.shiftKey) this.selectedJoints.clear();
            const fd=this._getEffectiveFrame(this.currentFrame);
            if (fd) {
                for (const {group,pts} of [{group:"body",pts:fd.body||[]},{group:"rhand",pts:fd.rhand||[]},{group:"lhand",pts:fd.lhand||[]}]) {
                    if (!pts) continue;
                    for (let i=0;i<pts.length;i++) {
                        const pt=pts[i]; if (!pt) continue;
                        const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
                        if (c.x>=minCx&&c.x<=maxCx&&c.y>=minCy&&c.y<=maxCy)
                            this.selectedJoints.add(`${group}_${i}`);
                    }
                }
            }
            // Update selectedJoint to last item in set (for info panel)
            const last=[...this.selectedJoints].pop();
            if (last) {
                const parts=last.split("_"), grp=parts[0], ki=parseInt(parts[1]);
                this.selectedJoint={group:grp,index:ki,label:last};
                this._updateJointInfo();
            }
            this._renderFrame(this.currentFrame); this._refreshTimeline();
            return;
        }
        // After drag: if autoKeyframe is OFF, tag overrides written during this drag as temporary
        if (this.dragJoint && !this.autoKeyframe) {
            const fi = this.currentFrame;
            const ovr = this.overrides[fi];
            if (ovr) {
                for (const label of Object.keys(ovr)) {
                    this._tempKeys.add(`${fi}::${label}`);
                }
            }
        }
        this.dragJoint=null; this.dragGizmo=null;
        this._vpPanDrag=null; this._orbitDrag=null;
        this._dragPreState=null;   // discard arm if no change occurred
    }

    _onCanvasWheel(e) {
        e.preventDefault();
        const rect=this.canvas.getBoundingClientRect();
        const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
        const cw=this.canvas.width, ch=this.canvas.height;
        const factor=e.deltaY>0?1/1.12:1.12;

        if (this.cameraView==="orbit" || (this.cameraView==="split" && cx>=Math.floor(cw/2))) {
            this.orbitZoom=Math.max(0.2,Math.min(8,this.orbitZoom*factor));
        } else {
            // Zoom around cursor in front view
            const vW=this._activeFrontViewW(), vH=ch;
            const {sx,oy,ox}=this._getFrontTransform(vW,vH);
            const poseX=(cx-ox)/sx, poseY=(cy-oy)/sx;
            this.vpZoom=Math.max(0.1,Math.min(30,this.vpZoom*factor));
            const newBase=Math.min(vW/this.poseW,vH/this.poseH)*0.95;
            const newSx=newBase*this.vpZoom;
            this.vpPanX=cx-poseX*newSx-(vW-this.poseW*newSx)/2;
            this.vpPanY=cy-poseY*newSx-(vH-this.poseH*newSx)/2;
        }
        this._renderFrame(this.currentFrame);
    }

    _onCanvasContextMenu(e) {
        e.preventDefault();
        const rect=this.canvas.getBoundingClientRect();
        const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
        if (this.cameraView==="orbit") return;
        if (this.cameraView==="split"&&cx>=Math.floor(this.canvas.width/2)) return;
        const hit=this._hitTest(cx,cy);
        if (!hit||hit.group!=="body") return;
        if (this.lockedLayers.has(hit.label)) return;
        const fi=this.currentFrame;
        this._pushUndo();
        if (!this.overrides[fi]) this.overrides[fi]={};
        const label=hit.label, fd=this.frames[fi], pt=fd?.body?.[hit.index];
        const existing=this.overrides[fi][label];
        if (Array.isArray(existing)&&existing[2]===0) delete this.overrides[fi][label];
        else this.overrides[fi][label]=[pt?.[0]??0,pt?.[1]??0,0];
        this._renderFrame(fi); this._renderTrack();
    }

    // -----------------------------------------------------------------------
    // Interpolation — per-segment + Catmull-Rom
    // -----------------------------------------------------------------------
    _getKeyframesForJoint(label) {
        const frames = new Set(
            Object.keys(this.overrides).map(Number)
                .filter(fi => this.overrides[fi]?.[label] !== undefined)
        );
        if (label === "body_4" || label === "body_7") {
            for (const ch of ["rx","ry","rz"])
                for (const fi of this._getKeyframesForChannel(label, ch))
                    frames.add(fi);
        }
        return [...frames].sort((a,b) => a-b);
    }

    _getKeyframesForChannel(label, ch) {
        const key=`${label}::${ch}`;
        return Object.keys(this.overrides).map(Number)
            .filter(fi=>this.overrides[fi]?.[key]!==undefined).sort((a,b)=>a-b);
    }

    _interpolateChannel(label, ch, frameIdx) {
        const key=`${label}::${ch}`;
        let prevFi=-1, nextFi=-1;
        for (let f=frameIdx-1;f>=0;f--)
            if (this.overrides[f]?.[key]!==undefined){prevFi=f;break;}
        for (let f=frameIdx+1;f<this.frameCount;f++)
            if (this.overrides[f]?.[key]!==undefined){nextFi=f;break;}
        if (prevFi===-1&&nextFi===-1) return null;
        if (prevFi===-1) return this.overrides[nextFi][key];
        if (nextFi===-1) return this.overrides[prevFi][key];
        const v0=this.overrides[prevFi][key], v1=this.overrides[nextFi][key];
        const t=(frameIdx-prevFi)/(nextFi-prevFi);
        const mode=this.tweens[prevFi]?.[key]??this.interpolationMode;
        return v0+(v1-v0)*applyEasing(t, mode==="catmull_rom"?"linear":mode);
    }

    _interpolateJoint(label, frameIdx) {
        let prevFi=-1, nextFi=-1;
        for (let f=frameIdx-1;f>=0;f--)
            if (this.overrides[f]?.[label]!==undefined){prevFi=f;break;}
        for (let f=frameIdx+1;f<this.frameCount;f++)
            if (this.overrides[f]?.[label]!==undefined){nextFi=f;break;}

        if (prevFi===-1&&nextFi===-1) return null;
        if (prevFi===-1) return [...this.overrides[nextFi][label]];
        if (nextFi===-1) return [...this.overrides[prevFi][label]];

        const v0=this.overrides[prevFi][label], v1=this.overrides[nextFi][label];
        const t=(frameIdx-prevFi)/(nextFi-prevFi);

        // Determine mode for this segment (per-segment override or global)
        const mode=this.tweens[prevFi]?.[label] ?? this.interpolationMode;

        if (mode==="catmull_rom") {
            return this._catmullRomInterp(label, prevFi, nextFi, t);
        }

        const ti=applyEasing(t, mode);
        return [v0[0]+(v1[0]-v0[0])*ti,
                v0[1]+(v1[1]-v0[1])*ti,
                v0.length>2?v0[2]:1.0,
                (v0[3]??0)+((v1[3]??0)-(v0[3]??0))*ti];
    }

    _catmullRomInterp(label, fi_a, fi_b, t) {
        const kfs=this._getKeyframesForJoint(label);
        const idxA=kfs.indexOf(fi_a);
        const fi_prev=idxA>0?kfs[idxA-1]:null;
        const fi_next=idxA+2<kfs.length?kfs[idxA+2]:null;

        const ov=(fi)=>fi!==null?this.overrides[fi][label]:null;
        const V_a=ov(fi_a), V_b=ov(fi_b);
        if (!V_a||!V_b) return null;

        // Ghost endpoints: mirror across the boundary
        const V_prev=fi_prev?ov(fi_prev):[V_a[0]*2-V_b[0],V_a[1]*2-V_b[1]];
        const V_next=fi_next?ov(fi_next):[V_b[0]*2-V_a[0],V_b[1]*2-V_a[1]];

        const alpha=this.catmullTension;
        const cr=(P0,P1,P2,P3,t)=>alpha*((2*P1)+(-P0+P2)*t+(2*P0-5*P1+4*P2-P3)*t*t+(-P0+3*P1-3*P2+P3)*t*t*t);

        return [
            cr(V_prev[0],V_a[0],V_b[0],V_next[0],t),
            cr(V_prev[1],V_a[1],V_b[1],V_next[1],t),
            V_a.length>2?V_a[2]:1.0,
            cr(V_prev[3]??0,V_a[3]??0,V_b[3]??0,V_next[3]??0,t),
        ];
    }

    _getEffectiveFrame(idx) {
        const raw=this.frames[idx]; if (!raw) return null;
        const ovr=this.overrides[idx]||{};

        // Synthesize a 21-point hand from overrides/interpolation when the raw frame
        // has no hand data — lets "Add Hand" work across all frames via interpolation.
        const synthHand = (group) => {
            const hasAny = Object.values(this.overrides).some(
                fo => fo && Object.keys(fo).some(k => k.startsWith(`${group}_`))
            );
            if (!hasAny) return null;
            return Array.from({length:21}, (_,i) => {
                const lbl=`${group}_${i}`, ov=ovr[lbl];
                if (ov) return [ov[0], ov[1], ov[2]??1];
                const interp=this._interpolateJoint(lbl, idx);
                return interp ? [interp[0], interp[1], interp[2]??1] : [0, 0, 0];
            });
        };

        const result={
            width:raw.width, height:raw.height,
            body: raw.body?raw.body.map(p=>[...p]):[],
            rhand:raw.rhand?raw.rhand.map(p=>[...p]):synthHand("rhand"),
            lhand:raw.lhand?raw.lhand.map(p=>[...p]):synthHand("lhand"),
            face: raw.face?raw.face.map(p=>[...p]):null,
        };
        const apply=(group,arr)=>{
            if (!arr) return;
            for (let i=0;i<arr.length;i++) {
                const label=`${group}_${i}`, ov=ovr[label];
                if (ov!==undefined){
                    arr[i][0]=ov[0]; arr[i][1]=ov[1]; if(ov[2]!==undefined)arr[i][2]=ov[2];
                    if (ov[3]!==undefined) { if(!this.zDepth[idx])this.zDepth[idx]={}; this.zDepth[idx][label]=ov[3]; }
                } else {
                    const interp=this._interpolateJoint(label,idx);
                    if(interp){
                        arr[i][0]=interp[0]; arr[i][1]=interp[1];
                        if(interp[3]!==undefined){ if(!this.zDepth[idx])this.zDepth[idx]={}; this.zDepth[idx][label]=interp[3]; }
                    }
                }
            }
        };
        apply("body",result.body); apply("rhand",result.rhand); apply("lhand",result.lhand);
        return result;
    }

    // -----------------------------------------------------------------------
    // Keyframe insert / delete
    // -----------------------------------------------------------------------
    _insertKeyframeSelected() {
        // Collect target labels: graphSel (graph tab) → selectedJoints (multi) → selectedJoint
        let labels;
        if (this.activeTab === "graph" && this.graphSel.size > 0) {
            const seen = new Set();
            for (const key of this.graphSel) seen.add(key.split("::")[1]);
            labels = [...seen];
        } else if (this.selectedJoints.size > 0) {
            labels = [...this.selectedJoints];
        } else if (this.selectedJoint) {
            labels = [this.selectedJoint.label];
        } else {
            return;
        }
        this._pushUndo();
        for (const lbl of labels) this._insertKeyframeRaw(lbl, this.currentFrame);
        this._refreshTimeline(); this._renderFrame(this.currentFrame);
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    _deleteKeyframeSelected() { if (this.selectedJoint) this._deleteKeyframe(this.selectedJoint.label, this.currentFrame); }

    _insertKeyframe(label, frameIdx) {
        this._pushUndo();
        this._insertKeyframeRaw(label, frameIdx);
        this._refreshTimeline(); this._renderFrame(frameIdx);
        if (this.activeTab==="graph") this._renderGraphEditor();
    }

    _insertKeyframeRaw(label, frameIdx) {
        const fd=this._getEffectiveFrame(frameIdx); if (!fd) return;
        const parts=label.split("_"), group=parts[0], ki=parseInt(parts[1]);
        const pts=group==="body"?fd.body:(group==="rhand"?fd.rhand:fd.lhand);
        if (!pts?.[ki]) return;
        if (!this.overrides[frameIdx]) this.overrides[frameIdx]={};
        const existing = this.overrides[frameIdx][label];
        const z = this.zDepth[frameIdx]?.[label] ?? 0;
        this.overrides[frameIdx][label] = existing
            ? (existing.length < 4 ? [...existing, z] : existing)
            : [pts[ki][0], pts[ki][1], pts[ki][2] ?? 1.0, z];
        this._tempKeys.delete(`${frameIdx}::${label}`);
        // Also keyframe wrist rotation channels if they exist
        const WRIST_SET = new Set(["body_4","body_7"]);
        if (WRIST_SET.has(label)) {
            for (const ch of ["rx","ry","rz"]) {
                const key = `${label}::${ch}`;
                this.overrides[frameIdx][key] = this.overrides[frameIdx][key] ?? 0;
            }
        }
    }

    _deleteKeyframe(label, frameIdx) {
        this._pushUndo();
        this._deleteKeyframeRaw(label, frameIdx);
    }

    _deleteKeyframeRaw(label, frameIdx) {
        if (!this.overrides[frameIdx]) return;
        delete this.overrides[frameIdx][label];
        if (Object.keys(this.overrides[frameIdx]).length===0) delete this.overrides[frameIdx];
        // Also clean up segment tween for this frame
        if (this.tweens[frameIdx]) { delete this.tweens[frameIdx][label]; if (Object.keys(this.tweens[frameIdx]).length===0) delete this.tweens[frameIdx]; }
        this._refreshTimeline(); this._renderFrame(frameIdx);
        if (this.activeTab==="graph") this._renderGraphEditor();
    }

    // -----------------------------------------------------------------------
    // Joint info
    // -----------------------------------------------------------------------
    _updateJointInfo() {
        if (!this.selectedJoint){this.jointInfoEl.textContent="No joint selected";return;}
        const {group,index,label}=this.selectedJoint, fi=this.currentFrame;
        const fd=this._getEffectiveFrame(fi);
        const pts=group==="body"?fd?.body:(group==="rhand"?fd?.rhand:fd?.lhand);
        const pt=pts?.[index];
        const z=group==="body"?(this.zDepth[fi]?.[`body_${index}`]??0):(this.zDepth[fi]?.[label]??0);
        const kfs=this._getKeyframesForJoint(label), isKf=this.overrides[fi]?.[label]!==undefined;
        const segMode=this.tweens[fi]?.[label]??null;
        const namePart=group==="body"?(JOINT_LABELS[index]||index):`finger_${index}`;
        this.jointInfoEl.innerHTML=`
            <div style="color:#ffd700;font-weight:bold">${label}</div>
            <div style="color:#aaa">${namePart}</div>
            <div>X: ${pt?.[0].toFixed(1)??"–"}  Y: ${pt?.[1].toFixed(1)??"–"}</div>
            <div>Z: ${z.toFixed(3)}</div>
            <div style="color:${isKf?"#ffd700":"#88aaff"}">${isKf?"⬦ Keyframe":"◦ Interpolated"}</div>
            ${segMode?`<div style="color:#ffaa44;font-size:10px">Seg: ${segMode}</div>`:""}
            <div style="color:#666;font-size:10px">${kfs.length} keyframe(s)</div>
        `;
    }

    // -----------------------------------------------------------------------
    // Apply / Close
    // -----------------------------------------------------------------------
    async _applyChanges() {
        const state={
            _fingerprint:   `${this.frameCount}:${this.poseW}:${this.poseH}`,
            overrides:      this.overrides,
            z_depth:        this.zDepth,
            tweens:         this.tweens,
            smooth_window:  this.smoothWindow,
            interpolation:  this.interpolationMode,
            catmull_tension:this.catmullTension,
        };
        try {
            await fetch(`/temporal-editor/state/${this.nodeId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(state)});
        } catch(e){console.warn("DWPoseTEEditor: state POST failed:",e);}
        const node=app.graph.getNodeById(parseInt(this.nodeId));
        if (node) {
            for (const w of node.widgets||[]) {
                if (w.name==="editor_state_json"){w.value=JSON.stringify(state);break;}
            }
            node.setDirtyCanvas(true,true);
        }
    }

    close() {
        this._stopPlayback();
        this._hideSegmentPopup();
        this._ro.disconnect();
        this._roGraph.disconnect();
        window.removeEventListener("keydown",this._onKeyDown);
        if (this._trackDocMove) { document.removeEventListener("mousemove", this._trackDocMove); this._trackDocMove = null; }
        if (this._trackDocUp)   { document.removeEventListener("mouseup",   this._trackDocUp);   this._trackDocUp   = null; }
        document.body.removeChild(this.overlay);
        if (this._refFileInput?.parentNode)   document.body.removeChild(this._refFileInput);
        if (this._refVideoInput?.parentNode)  document.body.removeChild(this._refVideoInput);
        if (this._refSeqInput?.parentNode)    document.body.removeChild(this._refSeqInput);
        if (this._refVideo) { this._refVideo.src = ""; this._refVideo = null; }
        if (this._projectFileInput?.parentNode) document.body.removeChild(this._projectFileInput);
    }

    // -----------------------------------------------------------------------
    // New Scene / Edit Project
    // -----------------------------------------------------------------------

    /** Default T-pose body keypoints scaled to given canvas dimensions. */
    _defaultBodyPose(w, h) {
        const cx = w / 2;
        return [
            [cx,            h*0.130, 1],  // 0  NOSE
            [cx,            h*0.220, 1],  // 1  NECK
            [cx - w*0.130,  h*0.260, 1],  // 2  R_SHLDR
            [cx - w*0.210,  h*0.380, 1],  // 3  R_ELBOW
            [cx - w*0.270,  h*0.500, 1],  // 4  R_WRIST
            [cx + w*0.130,  h*0.260, 1],  // 5  L_SHLDR
            [cx + w*0.210,  h*0.380, 1],  // 6  L_ELBOW
            [cx + w*0.270,  h*0.500, 1],  // 7  L_WRIST
            [cx - w*0.070,  h*0.540, 1],  // 8  R_HIP
            [cx - w*0.070,  h*0.700, 1],  // 9  R_KNEE
            [cx - w*0.070,  h*0.860, 1],  // 10 R_ANKLE
            [cx + w*0.070,  h*0.540, 1],  // 11 L_HIP
            [cx + w*0.070,  h*0.700, 1],  // 12 L_KNEE
            [cx + w*0.070,  h*0.860, 1],  // 13 L_ANKLE
            [cx - w*0.038,  h*0.108, 1],  // 14 R_EYE
            [cx + w*0.038,  h*0.108, 1],  // 15 L_EYE
            [cx - w*0.072,  h*0.140, 1],  // 16 R_EAR
            [cx + w*0.072,  h*0.140, 1],  // 17 L_EAR
            [cx + w*0.070,  h*0.910, 1],  // 18 L_TOE
            [cx - w*0.070,  h*0.910, 1],  // 19 R_TOE
        ];
    }

    /** Default relaxed open-hand pose for 21 keypoints anchored at wristX, wristY. */
    _defaultHandPose(wristX, wristY, isRight) {
        const s = isRight ? 1 : -1;
        const u = (this.poseH || 512) * 0.018;
        const pts = [
            [0,       0    ],  // 0  wrist
            [s*1.5,  -1.0  ],  // 1  thumb CMC
            [s*2.8,  -2.2  ],  // 2  thumb MCP
            [s*3.8,  -3.2  ],  // 3  thumb IP
            [s*4.5,  -4.2  ],  // 4  thumb TIP
            [s*0.8,  -3.5  ],  // 5  index MCP
            [s*0.8,  -5.2  ],  // 6  index PIP
            [s*0.8,  -6.5  ],  // 7  index DIP
            [s*0.8,  -7.5  ],  // 8  index TIP
            [s*0.0,  -3.8  ],  // 9  middle MCP
            [s*0.0,  -5.8  ],  // 10 middle PIP
            [s*0.0,  -7.2  ],  // 11 middle DIP
            [s*0.0,  -8.2  ],  // 12 middle TIP
            [s*-0.8, -3.5  ],  // 13 ring MCP
            [s*-0.8, -5.2  ],  // 14 ring PIP
            [s*-0.8, -6.5  ],  // 15 ring DIP
            [s*-0.8, -7.5  ],  // 16 ring TIP
            [s*-1.6, -3.0  ],  // 17 pinky MCP
            [s*-1.6, -4.5  ],  // 18 pinky PIP
            [s*-1.6, -5.5  ],  // 19 pinky DIP
            [s*-1.6, -6.2  ],  // 20 pinky TIP
        ];
        return pts.map(([dx, dy]) => [wristX + dx * u, wristY + dy * u, 1]);
    }

    /** Creates a blank scene with default T-pose skeleton on every frame. */
    _newScene(w, h, frameCount, fps) {
        this.poseW      = w;
        this.poseH      = h;
        this.frameCount = frameCount;
        this.overrides  = {};
        this.tweens     = {};
        this.zDepth     = {};
        this._undoStack = [];
        this._redoStack = [];

        const body  = this._defaultBodyPose(w, h);
        const rhand = this._defaultHandPose(body[4][0], body[4][1], true);
        const lhand = this._defaultHandPose(body[7][0], body[7][1], false);
        this.frames = {};
        for (let fi = 0; fi < frameCount; fi++) {
            this.frames[fi] = {
                width:  w,
                height: h,
                body:   body.map(p => [...p]),
                rhand:  rhand.map(p => [...p]),
                lhand:  lhand.map(p => [...p]),
                face:   null,
            };
        }

        if (this.scrubber) {
            this.scrubber.max = String(Math.max(0, frameCount - 1));
            this.scrubber.value = "0";
        }
        this.frameRangeStart = 0;
        this.frameRangeEnd   = frameCount - 1;
        if (this.rangeStartInp) this.rangeStartInp.value = 0;
        if (this.rangeEndInp)   this.rangeEndInp.value   = frameCount - 1;
        if (this.playFPS !== fps && this._fpsInput) this._fpsInput.value = fps;
        this.playFPS = fps;
        this.graphViewport = { frameStart: 0, frameEnd: Math.max(1, frameCount - 1), valMin: 0, valMax: Math.max(w, h) };

        this._seekFrame(0);
        this._refreshTimeline();
    }

    /**
     * Shows the New Scene / Edit Project dialog.
     * mode = "new" | "edit"
     */
    _showProjectDialog(mode) {
        const isNew = mode === "new";
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: "100000",
        });

        const box = document.createElement("div");
        Object.assign(box.style, {
            background: "#12121f", border: "1px solid #335",
            borderRadius: "10px", padding: "28px 32px", minWidth: "320px",
            color: "#ccc", fontFamily: "sans-serif",
            boxShadow: "0 12px 48px rgba(0,0,0,0.8)",
        });

        const title = document.createElement("div");
        title.textContent = isNew ? "New Scene" : "Edit Project";
        Object.assign(title.style, { fontSize: "17px", fontWeight: "bold", marginBottom: "20px", color: "#eef" });
        box.appendChild(title);

        const mkRow = (label, inputEl) => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:13px;";
            const lbl = document.createElement("label");
            lbl.textContent = label;
            Object.assign(lbl.style, { fontSize: "12px", color: "#99a", width: "110px", flexShrink: "0" });
            Object.assign(inputEl.style, {
                background: "#1e1e30", border: "1px solid #446", borderRadius: "4px",
                color: "#eef", padding: "4px 8px", fontSize: "13px", width: "100px",
            });
            row.append(lbl, inputEl);
            return row;
        };
        const mkInput = (type, val, min, max) => {
            const inp = document.createElement("input");
            Object.assign(inp, { type, value: String(val), min: String(min), max: String(max) });
            return inp;
        };

        const wInp = mkInput("number", this.poseW,      64,  4096);
        const hInp = mkInput("number", this.poseH,      64,  4096);
        const fInp = mkInput("number", isNew ? 60 : this.frameCount, 1, 10000);
        const rInp = mkInput("number", this.playFPS || 24, 1, 120);

        // Resolution presets
        const presetSection = document.createElement("div");
        presetSection.style.cssText = "margin-bottom:14px;";
        const presetLbl = document.createElement("div");
        presetLbl.textContent = "Presets";
        presetLbl.style.cssText = "font-size:11px;color:#667;margin-bottom:6px;";
        presetSection.appendChild(presetLbl);

        const PRESETS_H = [
            { label: "4K",   w: 3840, h: 2160 },
            { label: "FHD",  w: 1920, h: 1080 },
            { label: "HD",   w: 1280, h: 720  },
            { label: "480p", w: 854,  h: 480  },
            { label: "360p", w: 640,  h: 360  },
        ];
        const PRESETS_V = [
            { label: "4K↕",  w: 2160, h: 3840 },
            { label: "FHD↕", w: 1080, h: 1920 },
            { label: "HD↕",  w: 720,  h: 1280 },
            { label: "480↕", w: 480,  h: 854  },
            { label: "360↕", w: 360,  h: 640  },
        ];
        const mkPresetGroup = (presets, groupLabel) => {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:5px;";
            const gl = document.createElement("span");
            gl.textContent = groupLabel;
            gl.style.cssText = "font-size:9px;color:#445;width:26px;flex-shrink:0;";
            wrap.appendChild(gl);
            for (const p of presets) {
                const btn = document.createElement("button");
                btn.textContent = p.label;
                btn.title = `${p.w} × ${p.h}`;
                Object.assign(btn.style, {
                    background: "#1e1e30", border: "1px solid #446", color: "#99b",
                    borderRadius: "3px", padding: "2px 6px", fontSize: "10px",
                    cursor: "pointer", flex: "1",
                });
                btn.addEventListener("click", () => { wInp.value = p.w; hInp.value = p.h; });
                btn.addEventListener("mouseenter", () => { btn.style.background = "#2a2a4a"; btn.style.color = "#ccf"; });
                btn.addEventListener("mouseleave", () => { btn.style.background = "#1e1e30"; btn.style.color = "#99b"; });
                wrap.appendChild(btn);
            }
            return wrap;
        };
        presetSection.appendChild(mkPresetGroup(PRESETS_H, "↔"));
        presetSection.appendChild(mkPresetGroup(PRESETS_V, "↕"));
        box.appendChild(presetSection);

        box.appendChild(mkRow("Width (px)",    wInp));
        box.appendChild(mkRow("Height (px)",   hInp));
        box.appendChild(mkRow("Frames",        fInp));
        box.appendChild(mkRow("Frame Rate",    rInp));

        if (!isNew) {
            const note = document.createElement("div");
            note.textContent = "Note: changing frame count adds or trims frames at the end.";
            note.style.cssText = "font-size:10px;color:#667;margin-bottom:14px;";
            box.appendChild(note);
        }

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:8px;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        Object.assign(cancelBtn.style, {
            background:"#2a2a3a", border:"1px solid #444", color:"#aaa",
            borderRadius:"5px", padding:"6px 18px", cursor:"pointer", fontSize:"12px",
        });
        cancelBtn.addEventListener("click", () => overlay.remove());

        const confirmBtn = document.createElement("button");
        confirmBtn.textContent = isNew ? "Create" : "Apply";
        Object.assign(confirmBtn.style, {
            background:"#1a4a8a", border:"1px solid #559", color:"#eef",
            borderRadius:"5px", padding:"6px 18px", cursor:"pointer",
            fontSize:"12px", fontWeight:"bold",
        });
        confirmBtn.addEventListener("click", () => {
            const w  = Math.max(64,  Math.min(4096,  parseInt(wInp.value) || 512));
            const h  = Math.max(64,  Math.min(4096,  parseInt(hInp.value) || 512));
            const fc = Math.max(1,   Math.min(10000, parseInt(fInp.value) || 60));
            const fps= Math.max(1,   Math.min(120,   parseInt(rInp.value) || 24));
            overlay.remove();
            if (isNew) {
                this._newScene(w, h, fc, fps);
            } else {
                this._editProject(w, h, fc, fps);
            }
        });

        btnRow.append(cancelBtn, confirmBtn);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        fInp.focus(); fInp.select();
    }

    /** Applies project setting changes without destroying existing keyframes. */
    _editProject(w, h, frameCount, fps) {
        const prevCount = this.frameCount;
        this.poseW  = w;
        this.poseH  = h;
        this.playFPS = fps;
        if (this._fpsInput) this._fpsInput.value = fps;

        if (frameCount > prevCount) {
            const body  = this._defaultBodyPose(w, h);
            const rhand = this._defaultHandPose(body[4][0], body[4][1], true);
            const lhand = this._defaultHandPose(body[7][0], body[7][1], false);
            for (let fi = prevCount; fi < frameCount; fi++) {
                if (!this.frames[fi]) {
                    this.frames[fi] = {
                        width: w, height: h,
                        body:  body.map(p => [...p]),
                        rhand: rhand.map(p => [...p]),
                        lhand: lhand.map(p => [...p]),
                        face:  null,
                    };
                }
            }
        } else if (frameCount < prevCount) {
            for (let fi = frameCount; fi < prevCount; fi++) {
                delete this.frames[fi];
                delete this.overrides[fi];
                delete this.tweens[fi];
                delete this.zDepth[fi];
            }
            // Clamp selected keyframes that now fall out of range
            for (const key of [...this.selKfs]) {
                if (parseInt(key.split("::")[0]) >= frameCount) this.selKfs.delete(key);
            }
        }

        this.frameCount = frameCount;
        this.frameRangeEnd = Math.min(this.frameRangeEnd, frameCount - 1);
        if (this.scrubber) this.scrubber.max = String(Math.max(0, frameCount - 1));
        if (this.rangeEndInp) this.rangeEndInp.value = this.frameRangeEnd;

        const fi = Math.min(this.currentFrame, frameCount - 1);
        this._seekFrame(fi);
        this._refreshTimeline();
    }

    // -----------------------------------------------------------------------
    // Save / Load project
    // -----------------------------------------------------------------------
    _saveProject() {
        const state = {
            version: 2,
            frame_count: this.frameCount,
            width: this.poseW,
            height: this.poseH,
            frames: this.frames,
            overrides: this.overrides,
            z_depth: this.zDepth,
            tweens: this.tweens,
            smooth_window: this.smoothWindow,
            interpolation: this.interpolationMode,
            catmull_tension: this.catmullTension,
            reference: this._refMeta || null,
            z_global_offset: this.zGlobalOffset,
        };
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.download = `temporal_editor_${this.nodeId}_${ts}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _loadProject(file) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
            let data;
            try { data = JSON.parse(ev.target.result); }
            catch { alert("Invalid JSON file"); return; }
            this._pushUndo();
            if (data.overrides) {
                this.overrides = {};
                for (const [k, v] of Object.entries(data.overrides))
                    this.overrides[parseInt(k)] = v;
            }
            if (data.z_depth) {
                this.zDepth = {};
                for (const [k, v] of Object.entries(data.z_depth))
                    this.zDepth[parseInt(k)] = v;
            }
            if (data.tweens) {
                this.tweens = {};
                for (const [k, v] of Object.entries(data.tweens))
                    this.tweens[parseInt(k)] = v;
            }
            if (data.frame_count) {
                this.frameCount    = data.frame_count;
                this.scrubber.max  = String(Math.max(0, this.frameCount - 1));
                this.frameRangeStart = 0;
                this.frameRangeEnd   = this.frameCount - 1;
                if (this.rangeStartInp) this.rangeStartInp.value = 0;
                if (this.rangeEndInp)   this.rangeEndInp.value   = this.frameRangeEnd;
                this.graphViewport = { frameStart: 0, frameEnd: Math.max(1, this.frameCount - 1), valMin: 0, valMax: Math.max(this.poseW, this.poseH) };
            }
            if (data.width)  this.poseW = data.width;
            if (data.height) this.poseH = data.height;
            if (data.smooth_window !== undefined) this.smoothWindow = data.smooth_window;
            if (data.interpolation) this.interpolationMode = data.interpolation;
            if (data.catmull_tension !== undefined) this.catmullTension = data.catmull_tension;
            if (data.frames) {
                this.frames = {};
                for (const [k, v] of Object.entries(data.frames))
                    this.frames[parseInt(k)] = v;
            }
            if (data.z_global_offset) this.zGlobalOffset = data.z_global_offset;
            if (data.reference) {
                this._refMeta = data.reference;
                if (this._refOffsetInp) this._refOffsetInp.value = String(data.reference.frameOffset || 0);
                this.referenceImg = null;
                if (this._refVideo) { this._refVideo.src = ""; this._refVideo = null; }
                this._refSeqFrames = null;
                this._showRelinkBanner();
            }
            await this._applyChanges();
            this._refreshTimeline();
            this._seekFrame(0);
            if (this.activeTab === "graph") this._renderGraphEditor();
            this._updateInterpBtns();
        };
        reader.readAsText(file);
    }
}


// ---------------------------------------------------------------------------
// ComfyUI extension
// ---------------------------------------------------------------------------
app.registerExtension({
    name: "MAGOS.DWPoseTemporalEditor",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "DWPoseTEEditor") return;
        const orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            orig?.call(this);
            for (const w of this.widgets || []) {
                if (w.name === "editor_state_json") { w.computeSize = () => [0,-4]; w.hidden = true; }
            }
            this.addWidget("button","Open Temporal Editor",null,()=>{ new TemporalEditorOverlay(this.id); });
        };
    },
});
