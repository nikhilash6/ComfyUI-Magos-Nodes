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

// Three.js — loaded lazily for 3D orbit view
let THREE = null;
let _threeLoadCbs = [];
const _THREE_LOADING = import('https://esm.sh/three@0.169.0')
    .then(m => { THREE = m.default ?? m; _threeLoadCbs.forEach(cb => cb()); _threeLoadCbs = []; })
    .catch(() => console.warn('[DWPose] Three.js CDN unavailable — orbit falls back to 2D'));

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
// BODY_CONNECTIONS order: [1,2],[1,5],[2,3],[3,4],[5,6],[6,7],[1,8],[1,11],[8,9],[9,10],[11,12],[12,13],[0,1],[0,14],[0,15],[14,16],[15,17],[10,19],[13,18]
const BONE_COLORS = [
    "#0000ff","#00ff00","#0000ff","#0000ff","#00ff00","#00ff00",  // arms
    "#00ffff","#ff00ff","#00ffff","#00ffff","#ff00ff","#ff00ff",  // torso + legs
    "#ffff00","#c8c8c8","#c8c8c8","#969696","#969696",            // nose-neck, face
    "#00b4ff","#b400ff",                                           // toes
];
const JOINT_COLORS = {
    0:"#ffff00", 1:"#00ffff",
    2:"#0000ff", 3:"#0000ff", 4:"#0000ff",
    5:"#00ff00", 6:"#00ff00", 7:"#00ff00",
    8:"#00ffff", 9:"#00ffff", 10:"#00ffff",
    11:"#ff00ff",12:"#ff00ff",13:"#ff00ff",
    14:"#c8c8c8",15:"#c8c8c8",16:"#969696",17:"#969696",
    18:"#b400ff",19:"#00b4ff",
};
const RHAND_COLOR = "#ff6400";
const LHAND_COLOR = "#64c800";
const JOINT_LABELS = [
    "NOSE","NECK","R_SHLDR","R_ELBOW","R_WRIST",
    "L_SHLDR","L_ELBOW","L_WRIST","R_HIP","R_KNEE",
    "R_ANKLE","L_HIP","L_KNEE","L_ANKLE","R_EYE",
    "L_EYE","R_EAR","L_EAR","L_TOE","R_TOE",
];
const HAND_JOINT_LABELS = [
    "Wrist",
    "Thumb 1","Thumb 2","Thumb 3","Thumb 4",
    "Index 1","Index 2","Index 3","Index 4",
    "Mid 1",  "Mid 2",  "Mid 3",  "Mid 4",
    "Ring 1", "Ring 2", "Ring 3", "Ring 4",
    "Pinky 1","Pinky 2","Pinky 3","Pinky 4",
];
const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
];
const R_WRIST = 4, L_WRIST = 7;
// Face: 70 2D landmarks (300W convention after dropping the spurious index-22 pt in extractor)
const N_FACE = 70;
const FACE_COLOR = "#ffd44c";
const FACE_JOINT_LABELS = Array.from({length: N_FACE}, (_, i) => `F${i}`);
// NLF body — 18 OpenPose joints (same indexing/labels as DWpose body 0–17, no toes 18/19)
const N_NLF_BODY = 18;
const NLF_BODY_COLOR = "#b478ff";
// Shared group→points accessor so views/hit-tests stay consistent as groups are added.
const _grpPts = (fd, g) => fd && (
    g === "body"     ? fd.body :
    g === "rhand"    ? fd.rhand :
    g === "lhand"    ? fd.lhand :
    g === "face"     ? fd.face :
    g === "nlf_body" ? fd.nlf_body : null);
// Parse a joint label like "body_5" or "nlf_body_5" → { group, index }.
// Splits on the LAST underscore so multi-segment groups (nlf_body) work.
const _splitLabel = (lbl) => {
    const us = String(lbl).lastIndexOf("_");
    if (us < 0) return { group: lbl, index: -1 };
    const idx = parseInt(lbl.slice(us + 1));
    if (isNaN(idx)) return { group: lbl, index: -1 };
    return { group: lbl.slice(0, us), index: idx };
};
// Reverse of SMPL_TO_OPENPOSE: OpenPose 18 joint → SMPL 24 joint index
const OP18_TO_SMPL = {0:15,1:12,2:17,3:19,4:21,5:16,6:18,7:20,8:2,9:5,10:8,11:1,12:4,13:7};
const ROW_H = 24;
const PANEL_HEADER_H = 22;
const VIEW_CYCLE = ["front","back","top","side","orbit","camera"];
const VIEW_LABELS = { front:"FRONT", back:"BACK", top:"TOP", side:"SIDE", orbit:"ORBIT", camera:"CAMERA" };

// ---------------------------------------------------------------------------
// Shared theme — keeps button heights, colors, and focus states consistent
// ---------------------------------------------------------------------------
const THEME = {
    bgPanel:    "#111420",
    bgRow:      "#13141f",
    bgRowAlt:   "#0f1019",
    bgGroup:    "#191f36",
    bgBtn:      "#1d2138",
    bgBtnHover: "#252c44",
    bgBtnDown:  "#151930",
    border:     "#2c3352",
    borderHov:  "#4a68b0",
    accent:     "#5bc4ff",
    text:       "#d4ddf4",
    textDim:    "#7888a8",
    textMute:   "#424e6a",
    danger:     "#cc4b4b",
    success:    "#3aaa66",
    btnH:       24,        // unified button height (px)
};

/** Apply hover/focus/active states + a unified height. Idempotent.
 *  Hover/down use `filter: brightness(...)` so colored buttons retain their hue. */
function _styleButton(b, { bg = THEME.bgBtn, height = THEME.btnH } = {}) {
    Object.assign(b.style, {
        background: bg, border: `1px solid ${THEME.border}`,
        color: THEME.text, borderRadius: "4px",
        cursor: "pointer", fontSize: "12px",
        height: `${height}px`, lineHeight: "1",
        padding: "0 10px", boxSizing: "border-box",
        transition: "filter 90ms ease, border-color 90ms ease",
        outline: "none", filter: "brightness(1)",
    });
    b.addEventListener("mouseenter", () => { b.style.filter = "brightness(1.25)"; b.style.borderColor = THEME.borderHov; });
    b.addEventListener("mouseleave", () => { b.style.filter = "brightness(1)";    b.style.borderColor = THEME.border; });
    b.addEventListener("mousedown",  () => { b.style.filter = "brightness(0.85)"; });
    b.addEventListener("mouseup",    () => { b.style.filter = "brightness(1.25)"; });
    b.addEventListener("focus",      () => { b.style.borderColor = THEME.accent; });
    b.addEventListener("blur",       () => { b.style.borderColor = THEME.border; });
}

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
// Three.js orbit view renderer — cylinders + spheres for DWPose skeleton
// ---------------------------------------------------------------------------
class ThreeOrbitRenderer {
    constructor() {
        this._r  = null;   // WebGLRenderer
        this._s  = null;   // Scene
        this._c  = null;   // PerspectiveCamera
        this._sg = null;   // Group holding skeleton meshes (cleared each frame)
        this._ready = false;
        if (THREE) this._setup();
        else _threeLoadCbs.push(() => this._setup());
    }

    _setup() {
        if (!THREE) return;
        this._r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        this._r.setPixelRatio(1);
        this._r.setClearColor(0x000000, 0);   // transparent — drawn on top of 2D bg

        this._s = new THREE.Scene();
        this._s.add(new THREE.AmbientLight(0xffffff, 0.5));
        const key = new THREE.DirectionalLight(0xffffff, 0.88);
        key.position.set(0.5, 1.5, 2); this._s.add(key);
        const fill = new THREE.DirectionalLight(0x5577bb, 0.35);
        fill.position.set(-1, -0.5, -1); this._s.add(fill);

        this._sg = new THREE.Group();
        this._s.add(this._sg);
        this._c = new THREE.PerspectiveCamera(45, 1, 1, 200000);
        this._ready = true;
    }

    get ready() { return this._ready; }

    // outW/outH: output canvas dimensions — when provided, renders at that aspect and
    // letterboxes within the panel. Used by camera view to show the true output framing.
    render(ctx, vW, vH, fd, orbitYaw, orbitPitch, orbitZoom, poseW, poseH,
           zGO, showAll, hiddenGroups, hiddenLayers, selJoint, lookAt,
           outW = 0, outH = 0, dwposeAlpha = 1, boneScale = 1, nlfAlpha = 0) {
        this._dwposeAlpha = dwposeAlpha;
        this._boneScale   = boneScale;
        this._nlfAlpha    = nlfAlpha;
        if (!this._ready) return;

        // Compute render rect (letterboxed when output aspect differs from panel)
        let renderW = vW, renderH = vH;
        this._c.aspect = vW / vH;
        this._lastLetterbox = null;

        if (outW > 0 && outH > 0) {
            const outAspect   = outW / outH;
            const panelAspect = vW   / vH;
            if (outAspect > panelAspect) {
                renderW = vW;
                renderH = Math.round(vW / outAspect);
            } else {
                renderH = vH;
                renderW = Math.round(vH * outAspect);
            }
            this._c.aspect = outAspect;
            const lbX = Math.round((vW - renderW) / 2);
            const lbY = Math.round((vH - renderH) / 2);
            this._lastLetterbox = { x: lbX, y: lbY, w: renderW, h: renderH };
        }

        if (this._r.domElement.width !== renderW || this._r.domElement.height !== renderH)
            this._r.setSize(renderW, renderH, false);
        this._c.updateProjectionMatrix();

        const lat  = orbitPitch * Math.PI / 180;
        const lon  = orbitYaw   * Math.PI / 180;
        const dist = Math.max(poseW, poseH) * 1.4 / Math.max(0.01, orbitZoom);
        const lx = lookAt?.x ?? 0, ly = lookAt?.y ?? 0, lz = lookAt?.z ?? 0;
        this._c.position.set(
            lx + Math.sin(lon) * Math.cos(lat) * dist,
            ly + Math.sin(lat) * dist,
            lz + Math.cos(lon) * Math.cos(lat) * dist,
        );
        this._c.up.set(0, 1, 0);
        this._c.lookAt(lx, ly, lz);

        this._buildSkeleton(fd, poseW, poseH, zGO, showAll, hiddenGroups, hiddenLayers, selJoint);
        this._r.render(this._s, this._c);
        if (this._lastLetterbox) {
            const lb = this._lastLetterbox;
            ctx.drawImage(this._r.domElement, lb.x, lb.y, lb.w, lb.h);
        } else {
            ctx.drawImage(this._r.domElement, 0, 0);
        }
    }

    /** DWPose pixel-space → Three.js world (Y-up, Z toward viewer, centred at origin). */
    _w(px, py, pz, poseW, poseH) {
        return new THREE.Vector3(
            px - poseW * 0.5,
            -(py - poseH * 0.5),
            pz * poseW * 0.35,
        );
    }

    _buildSkeleton(fd, poseW, poseH, zGO, showAll, hiddenGroups, hiddenLayers, selJoint) {
        this._sg.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
                (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
            }
        });
        this._sg.clear();
        if (!fd) return;

        // Floor grid
        const grid = new THREE.GridHelper(poseW * 2, 14, 0x2255aa, 0x0d1825);
        const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
        mats.forEach(m => { m.transparent = true; m.opacity = 0.38; });
        grid.scale.set(1, 1, 0.65);
        this._sg.add(grid);

        const body = fd.body || [];
        const boneR = poseW * 0.013 * (this._boneScale ?? 1);
        const bodyVis = !hiddenGroups.has("body");
        const dwA = this._dwposeAlpha ?? 1;

        // Body bones
        if (bodyVis) {
            for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                const [a, b] = BODY_CONNECTIONS[i];
                if (!body[a] || !body[b]) continue;
                if (hiddenLayers.has(`body_${a}`) || hiddenLayers.has(`body_${b}`)) continue;
                const conf = showAll ? 1 : Math.min(body[a][2]??1, body[b][2]??1);
                if (conf < 0.01) continue;
                const za = (body[a][3]??0) + (zGO[`body_${a}`]??0);
                const zb = (body[b][3]??0) + (zGO[`body_${b}`]??0);
                const m = this._cyl(
                    this._w(body[a][0], body[a][1], za, poseW, poseH),
                    this._w(body[b][0], body[b][1], zb, poseW, poseH),
                    boneR, BONE_COLORS[i] || '#666', conf * dwA);
                if (m) this._sg.add(m);
            }
        }

        // Body joints
        if (bodyVis) {
            for (let i = 0; i < body.length; i++) {
                const pt = body[i]; if (!pt) continue;
                if (hiddenLayers.has(`body_${i}`)) continue;
                const conf = showAll ? 1 : (pt[2]??1); if (conf < 0.01) continue;
                const z = (pt[3]??0) + (zGO[`body_${i}`]??0);
                const isSel = selJoint?.group === "body" && selJoint?.index === i;
                this._sg.add(this._sph(
                    this._w(pt[0], pt[1], z, poseW, poseH),
                    isSel ? boneR * 1.9 : boneR * 1.2,
                    isSel ? '#ffd700' : (JOINT_COLORS[i] || '#fff'), conf * dwA));
            }
        }

        // Hands
        const rWZ = (body[R_WRIST]?.[3]??0) + (zGO[`body_${R_WRIST}`]??0);
        const lWZ = (body[L_WRIST]?.[3]??0) + (zGO[`body_${L_WRIST}`]??0);
        if (fd.rhand && !hiddenGroups.has("rhand"))
            this._hand(fd.rhand, rWZ, boneR * 0.5, RHAND_COLOR, 'rhand', poseW, poseH, zGO, hiddenLayers, showAll, selJoint, dwA);
        if (fd.lhand && !hiddenGroups.has("lhand"))
            this._hand(fd.lhand, lWZ, boneR * 0.5, LHAND_COLOR, 'lhand', poseW, poseH, zGO, hiddenLayers, showAll, selJoint, dwA);

        // Face landmarks — points only; 70 pts with bones gets visually noisy.
        if (fd.face && !hiddenGroups.has("face")) {
            const faceR = boneR * 0.28;
            const headZ = (body[0]?.[3] ?? 0) + (zGO[`body_0`] ?? 0);  // default anchor = nose Z
            const face = fd.face;
            for (let i = 0; i < face.length; i++) {
                const pt = face[i]; if (!pt) continue;
                if (hiddenLayers.has(`face_${i}`)) continue;
                const conf = showAll ? 1 : (pt[2] ?? 1); if (conf < 0.01) continue;
                const z = pt[3] ?? headZ;
                const isSel = selJoint?.group === "face" && selJoint?.index === i;
                this._sg.add(this._sph(
                    this._w(pt[0], pt[1], z, poseW, poseH),
                    isSel ? faceR * 1.8 : faceR,
                    isSel ? '#ffd700' : FACE_COLOR, conf * dwA));
            }
        }

        // NLF body — renders here in Three.js (matches DWpose's perspective-projected scale).
        // Opacity is controlled by the NLF Overlay slider (this._nlfAlpha) instead of dwA.
        const nlfA = this._nlfAlpha ?? 0;
        if (nlfA > 0 && fd.nlf_body && fd.nlf_body.length && !hiddenGroups.has("nlf_body")) {
            const _safeZ = (z) => {
                const v = z ?? 0;
                if (!isFinite(v) || Math.abs(v) > 1.5) return 0;
                return v;
            };
            const nlf = fd.nlf_body;
            for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                const [a, b] = BODY_CONNECTIONS[i];
                if (a >= nlf.length || b >= nlf.length) continue;
                if (!nlf[a] || !nlf[b]) continue;
                const conf = showAll ? 1 : Math.min(nlf[a][2] ?? 1, nlf[b][2] ?? 1);
                if (conf < 0.05) continue;
                if (hiddenLayers.has(`nlf_body_${a}`) || hiddenLayers.has(`nlf_body_${b}`)) continue;
                const m = this._cyl(
                    this._w(nlf[a][0], nlf[a][1], _safeZ(nlf[a][3]), poseW, poseH),
                    this._w(nlf[b][0], nlf[b][1], _safeZ(nlf[b][3]), poseW, poseH),
                    boneR * 0.85, NLF_BODY_COLOR, conf * nlfA);
                if (m) this._sg.add(m);
            }
            for (let i = 0; i < nlf.length; i++) {
                const pt = nlf[i]; if (!pt) continue;
                if (hiddenLayers.has(`nlf_body_${i}`)) continue;
                const conf = showAll ? 1 : (pt[2] ?? 1); if (conf < 0.05) continue;
                const isSel = selJoint?.group === "nlf_body" && selJoint?.index === i;
                this._sg.add(this._sph(
                    this._w(pt[0], pt[1], _safeZ(pt[3]), poseW, poseH),
                    isSel ? boneR * 1.9 : boneR * 1.15,
                    isSel ? '#ffd700' : NLF_BODY_COLOR, conf * nlfA));
            }
        }
    }

    _hand(kps, wristZ, boneR, color, pfx, poseW, poseH, zGO, hiddenLayers, showAll, selJoint, dwA = 1) {
        for (const [a, b] of HAND_CONNECTIONS) {
            if (!kps[a] || !kps[b]) continue;
            if (hiddenLayers.has(`${pfx}_${a}`) || hiddenLayers.has(`${pfx}_${b}`)) continue;
            const conf = showAll ? 1 : Math.min(kps[a][2]??1, kps[b][2]??1);
            if (conf < 0.01) continue;
            const zA = kps[a][3] ?? wristZ, zB = kps[b][3] ?? wristZ;
            const m = this._cyl(
                this._w(kps[a][0], kps[a][1], zA, poseW, poseH),
                this._w(kps[b][0], kps[b][1], zB, poseW, poseH),
                boneR, color, conf * dwA);
            if (m) this._sg.add(m);
        }
        for (let i = 0; i < kps.length; i++) {
            if (!kps[i] || hiddenLayers.has(`${pfx}_${i}`)) continue;
            const conf = showAll ? 1 : (kps[i][2]??1); if (conf < 0.01) continue;
            const z = kps[i][3] ?? wristZ;
            const isSel = selJoint?.group === pfx && selJoint?.index === i;
            this._sg.add(this._sph(
                this._w(kps[i][0], kps[i][1], z, poseW, poseH),
                isSel ? boneR * 1.6 : boneR * 1.0,
                isSel ? '#ffd700' : color, conf * dwA));
        }
    }

    _cyl(pA, pB, radius, colorStr, opacity = 1) {
        const ax = pB.x - pA.x, ay = pB.y - pA.y, az = pB.z - pA.z;
        const len = Math.sqrt(ax*ax + ay*ay + az*az);
        if (len < 0.5) return null;
        const geo = new THREE.CylinderGeometry(radius * 0.65, radius, len, 8, 1);
        const mat = new THREE.MeshPhongMaterial({ color: colorStr, shininess: 55,
            opacity, transparent: opacity < 0.99 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((pA.x+pB.x)*0.5, (pA.y+pB.y)*0.5, (pA.z+pB.z)*0.5);
        const ux = ax/len, uy = ay/len, uz = az/len;  // unit bone dir
        if (Math.abs(uy) > 0.9999) {
            if (uy < 0) mesh.rotation.z = Math.PI;
        } else {
            // setFromUnitVectors(Y-axis → bone direction)
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(ux,uy,uz));
        }
        return mesh;
    }

    _sph(pos, radius, colorStr, opacity = 1) {
        const geo = new THREE.SphereGeometry(radius, 10, 8);
        const mat = new THREE.MeshPhongMaterial({ color: colorStr, shininess: 70,
            opacity, transparent: opacity < 0.99 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        return mesh;
    }

    dispose() {
        if (!this._r) return;
        this._sg?.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
        });
        this._r.dispose(); this._r = null; this._s = null; this._c = null;
        this._sg = null; this._ready = false;
    }
}

// ---------------------------------------------------------------------------
// TemporalEditorOverlay
// ---------------------------------------------------------------------------
class TemporalEditorOverlay {
    // Debug trace — POST user actions to /magos-debug/user-action when the node's
    // debug_log widget is on.
    _isDebugOn() {
        try {
            const node = app.graph.getNodeById(parseInt(this.nodeId));
            const w = node?.widgets?.find(w => w.name === "debug_log");
            return !!(w && w.value);
        } catch (_) { return false; }
    }
    _logAction(action, payload) {
        if (!this._isDebugOn()) return;
        try {
            fetch("/magos-debug/user-action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node: "Editor-JS", action, payload: payload || {} }),
                keepalive: true,
            }).catch(() => {});
        } catch (_) {}
    }

    constructor(nodeId) {
        this.nodeId     = String(nodeId);
        this.frames        = {};
        this.overrides     = {};
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
        this.expandedGroups = new Set(["body", "nlf_body"]);

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

        // Ref Frame — clean front-view frame 0 snapshot for the Retargeter
        this.refFrameOverrides = {};   // {label: [x,y,conf,z]} — single-frame, no time key
        this._inRefFrameMode   = false;
        this._refFrameBtn      = null;
        this._refFrameBanner   = null;

        // NLF / 3D depth toggle state
        this._experimentalMode = false;
        this._nlfData = null;
        this.selectedNlfJoint = null;   // {group:"nlf_body", index, label} — read-only selection for NLF graph view
        this._dwposeAlpha = 1.0;
        this._nlfAlpha = 0.5;
        this._boneScale = 1.0;
        this._nlfStatus = "idle";  // "idle" | "loading" | "ok" | "unavailable"

        // Three.js 3D orbit renderer (lazy-init on first orbit render)
        this._threeOrbit = null;

        // Multi-panel layout
        this._panelLayout = 1;       // 1 | 2 | 4
        this._panelViews  = ["front", "orbit", "top", "side"];
        this._activePanel = 0;
        this._panelState  = [
            { vpZoom:1, vpPanX:0, vpPanY:0, orbitYaw:-20, orbitPitch:15, orbitZoom:1.0 },
            { vpZoom:1, vpPanX:0, vpPanY:0, orbitYaw:-20, orbitPitch:15, orbitZoom:1.0 },
            { vpZoom:1, vpPanX:0, vpPanY:0, orbitYaw:-20, orbitPitch:15, orbitZoom:1.0 },
            { vpZoom:1, vpPanX:0, vpPanY:0, orbitYaw:-20, orbitPitch:15, orbitZoom:1.0 },
        ];
        this._dragPanel = 0;
        this._dragPanelRect = null;
        this._camLocked = false;       // Lock Camera to View — drag writes cam_pan/tilt KFs
        this._camLockBtnRect = null;   // Canvas-local rect for click detection
        this._camLockPreview = null;   // { pan?, tilt?, x?, y? } live preview during locked drag; committed on mouseUp
        this._camOrtho = true;         // Orthographic camera view (matches front view); false = perspective (Three.js)
        this._camOrthoBtnRect = null;
        this._camAimDrag = null;       // { startLX, startLY, startCamX, startCamY, view, sx?, sy? } — drag camera aim point in views
        this._orbitCenterOffset = null; // { x, y } — shifts ocx/ocy in _renderOrbitView for camera-view framing

        // Camera system — state lives in this.overrides (cam_x/y/z/roll/tilt/pan/fov labels)

        // Undo / Redo
        this._undoStack = [];
        this._redoStack = [];
        this._dragPreState = null;   // state captured at drag start; pushed on first actual change

        // Graph per-coordinate selection (separate from dope-sheet selKfs)
        this.graphSel = new Set();          // "fi::label::coord" e.g. "42::body_4::0"
        this._selectedCamLabels = new Set(); // camera scalar labels selected for graph view
        this._outputView = "front";          // "front" | "camera" — which view to bake into pose_data

        // Canvas size override (0 = use input data dimensions)
        this._canvasW = 0;
        this._canvasH = 0;
        this._canvasWInp = null; this._canvasHInp = null;  // sidebar input refs

        // Move gizmo (XY axis-constrained joint drag arrows in front/back views)
        this._moveGizmoPos  = null;   // { cx, cy } in full canvas coords
        this._moveGizmoDrag = null;   // { axis:"x"|"y", group, index, label }

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
            background: "rgba(0,0,0,0.96)",
            display: "flex", flexDirection: "column",
            fontFamily: "'Inter', -apple-system, system-ui, sans-serif", color: "#d4ddf4",
        });

        // Header
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 16px", background: "#0d1020", borderBottom: "1px solid #2c3352",
            flexShrink: "0",
        });
        header.innerHTML = `<span style="font-size:14px;font-weight:700;letter-spacing:0.04em;color:#d4ddf4;">Magos Pose Editor</span>`;
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
            background: "#0f1224", border: "1px solid #2c3352", borderRadius: "6px",
            minWidth: "170px", zIndex: "9999", padding: "4px 0", marginTop: "3px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
        });

        const mkMenuItem = (label, icon, fn, color) => {
            const item = document.createElement("button");
            item.textContent = `${icon}  ${label}`;
            Object.assign(item.style, {
                display: "block", width: "100%", textAlign: "left",
                background: "none", border: "none", color: color || "#b0bcd4",
                padding: "7px 14px", cursor: "pointer", fontSize: "12px",
            });
            item.addEventListener("mouseenter", () => { item.style.background = "#1e2540"; });
            item.addEventListener("mouseleave", () => { item.style.background = "none"; });
            item.addEventListener("click", () => { fileMenu.style.display = "none"; fn(); });
            return item;
        };
        const mkMenuSep = () => {
            const s = document.createElement("hr");
            s.style.cssText = "border:none;border-top:1px solid #252a42;margin:3px 0;";
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
        _headerBtns.appendChild(this._mkBtn("Help [F1]", () => this._showHelp(), "#1a2a3a", "Show keyboard shortcuts and help (F1)"));
        _headerBtns.appendChild(this._mkBtn("✕ Close", () => this.close(), "#444", "Close the editor without applying"));
        header.appendChild(_headerBtns);
        this.overlay.appendChild(header);

        // Main (canvas + sidebar)
        const main = document.createElement("div");
        Object.assign(main.style, { flex: "1", display: "flex", overflow: "hidden", minHeight: "0" });
        this.overlay.appendChild(main);

        const vpWrap = document.createElement("div");
        Object.assign(vpWrap.style, { flex: "1 1 0", position: "relative", background: "#08080f", overflow: "hidden" });
        this.canvas = document.createElement("canvas");
        Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block" });
        vpWrap.appendChild(this.canvas);

        this._showAllBtn = this._mkBtn("SHOW ALL", () => this._toggleShowAll(), "#1a1a2a", "Force-show all joints regardless of detection confidence");
        Object.assign(this._showAllBtn.style, {
            position:"absolute", top:"28px", right:"8px", zIndex:"10",
            padding:"3px 9px", fontSize:"10px", fontWeight:"bold", letterSpacing:"0.5px",
            color:"#4a5a78", border:"1px solid #2c3352", borderRadius:"3px",
        });
        vpWrap.appendChild(this._showAllBtn);

        this._resetViewBtn = this._mkBtn("⟳ Reset View", () => this._resetView(), "#111828", "Reset zoom/pan/orbit on the active viewport");
        Object.assign(this._resetViewBtn.style, {
            position:"absolute", top:"28px", right:"88px", zIndex:"10",
            padding:"3px 9px", fontSize:"10px",
            color:"#4a5a78", border:"1px solid #2c3352", borderRadius:"3px",
        });
        vpWrap.appendChild(this._resetViewBtn);

        main.appendChild(vpWrap);

        // Sidebar — one element, explicit JS-pinned height so overflow-y:scroll always
        // has a deterministic box to clip against. Flex stretch + min-height: 0 has
        // proved unreliable across browsers; this approach simply doesn't fail.
        const sidebar = document.createElement("div");
        Object.assign(sidebar.style, {
            flex: "0 0 214px", background: "#0e1220", borderLeft: "1px solid #2c3352",
            padding: "10px 8px", display: "flex", flexDirection: "column", gap: "7px",
            overflowY: "scroll", overflowX: "hidden",
            boxSizing: "border-box",
            scrollbarWidth: "thin", scrollbarColor: `${THEME.border} ${THEME.bgPanel}`,
        });
        main.appendChild(sidebar);
        // Keep sidebar reference under both names so the resize handle keeps working
        const sidebarOuter = sidebar;

        const _pinSidebarHeight = () => {
            const h = main.clientHeight;
            if (h > 0) {
                sidebar.style.height    = `${h}px`;
                sidebar.style.maxHeight = `${h}px`;
            }
        };
        // Pin after the overlay attaches to body and gets a real layout
        requestAnimationFrame(_pinSidebarHeight);
        setTimeout(_pinSidebarHeight, 50);
        if (typeof ResizeObserver !== "undefined") {
            this._sidebarRO = new ResizeObserver(_pinSidebarHeight);
            this._sidebarRO.observe(main);
        }
        window.addEventListener("resize", _pinSidebarHeight);

        this.jointInfoEl = document.createElement("div");
        Object.assign(this.jointInfoEl.style, {
            background: "#141828", borderRadius: "6px", padding: "8px", fontSize: "12px",
        });
        this.jointInfoEl.textContent = "No joint selected";
        sidebar.appendChild(this.jointInfoEl);

        // Layout buttons [1][2][4] — controls how many panels are shown
        const layoutRow = document.createElement("div");
        layoutRow.style.cssText = "display:flex;gap:3px;";
        this._layoutBtns = {};
        for (const [n, icon] of [[1,"⊡ 1"],[2,"⊟ 2"],[4,"⊞ 4"]]) {
            const b = this._mkBtn(icon, () => this._setLayout(n), "#1e3a5a");
            Object.assign(b.style, { flex:"1", fontSize:"11px", padding:"3px 4px" });
            this._layoutBtns[n] = b;
            layoutRow.appendChild(b);
        }
        this._camBtns = {};   // kept empty for _updateCamBtns compat
        sidebar.appendChild(layoutRow);
        this._updateLayoutBtns();

        // Ref Frame button — below layout, above Add
        this._refFrameBtn = this._mkBtn("⊕ Ref Frame", () => this._toggleRefFrameMode(), "#1a2a1a",
            "Enter Ref Frame mode to clean up frame 0's detection as a reference pose.\n" +
            "Camera transforms are ignored — always front-view.\n" +
            "Connect keyframe_data → Retargeter and set Reference Source = Ref Frame.");
        this._refFrameBtn.style.width = "100%";
        sidebar.appendChild(this._refFrameBtn);

        // Add menu
        const addMenuBtn = this._mkBtn("＋ Add ▾", () => {
            addMenuBody.style.display = addMenuBody.style.display === "none" ? "flex" : "none";
        }, "#1a2a1a");
        addMenuBtn.style.width = "100%";
        sidebar.appendChild(addMenuBtn);

        const addMenuBody = document.createElement("div");
        addMenuBody.style.cssText = "display:none;flex-direction:column;gap:3px;padding-left:6px;";

        this._addHandBtn = this._mkBtn("＋ Hand", () => this._onAddHandClick(), "#1a3020", "Add a synthesised hand to the current frame");
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

        const addCamBtn = this._mkBtn("◎ Camera", () => { if (!this._hasCameraKeyframes()) this._addCamera(); }, "#0e2a12", "Add a scene camera with keyframable position / rotation / FOV");
        addCamBtn.style.fontSize = "10px";
        addCamBtn.style.color = "#88cc88";
        addCamBtn.title = "Add a camera — adds ◎ Camera group to the dope sheet.\nKeyframe Position (X/Y/Z), Rotation (Roll/Tilt/Pan), and FOV to animate the camera.\nIn the Camera view panel, use Lock Camera to View to orbit-and-dolly and write KFs.";
        this._addCamBtn = addCamBtn;
        addMenuBody.appendChild(addCamBtn);

        sidebar.appendChild(addMenuBody);

        sidebar.appendChild(this._mkSidebarHeader("Quick Tips"));
        const _tip = (txt) => {
            const d = document.createElement("div");
            d.style.cssText = `font-size:10px;color:${THEME.textDim};line-height:1.45;`;
            d.textContent = txt;
            return d;
        };
        sidebar.appendChild(_tip("Drag joints freely · Ctrl+drag = box-select"));
        sidebar.appendChild(_tip("Shift+click joint = add to selection"));
        sidebar.appendChild(_tip("K = Add Key  ·  Del = Remove  ·  H = Hide"));
        sidebar.appendChild(_tip("Click a panel header to switch view"));

        // ── Output Canvas Size ─────────────────────────────────────────────
        sidebar.appendChild(this._mkSidebarHeader("Output Canvas"));
        const canvasSizeRow = document.createElement("div");
        canvasSizeRow.style.cssText = "display:flex;gap:4px;align-items:center;";

        // Show effective output dim: explicit canvas value, or input-pose fallback.
        // _canvasW=0 means "follow input" — typing a value makes it explicit.
        const mkDimInp = (placeholder, getVal, getInputDim, setVal) => {
            const inp = document.createElement("input");
            Object.assign(inp, { type: "number", min: "0", max: "8192", step: "8", placeholder });
            inp.value = getVal() || getInputDim() || "";
            Object.assign(inp.style, {
                width: "52px", background: "#0a0c18", color: "#d4ddf4",
                border: "1px solid #2c3352", borderRadius: "3px", padding: "2px 4px", fontSize: "11px",
            });
            inp.title = `Output ${placeholder} in pixels (matches input by default — use presets or type to override)`;
            inp.addEventListener("change", () => { setVal(parseInt(inp.value) || 0); });
            return inp;
        };
        const wInp = mkDimInp("W", () => this._canvasW, () => this.poseW, v => { this._canvasW = v; });
        const hInp = mkDimInp("H", () => this._canvasH, () => this.poseH, v => { this._canvasH = v; });
        this._canvasWInp = wInp; this._canvasHInp = hInp;
        const xLbl = document.createElement("span");
        xLbl.textContent = "×"; xLbl.style.cssText = "color:#555;font-size:12px;";
        canvasSizeRow.append(wInp, xLbl, hInp);
        sidebar.appendChild(canvasSizeRow);

        const presetRow = document.createElement("div");
        presetRow.style.cssText = "display:flex;gap:2px;flex-wrap:wrap;";
        // "Input" reverts to input-pose dims (clears explicit override).
        const inputBtn = this._mkBtn("Input", () => {
            this._canvasW = 0; this._canvasH = 0;
            wInp.value = this.poseW; hInp.value = this.poseH;
        }, "#1a2418");
        inputBtn.title = "Revert to input data dimensions";
        inputBtn.style.cssText += "font-size:9px;padding:2px 4px;flex:1;min-width:0;";
        presetRow.appendChild(inputBtn);
        for (const [w, h] of [[512,512],[768,768],[1024,1024],[768,1024],[1024,768],[1280,720]]) {
            const lbl = w === h ? `${w}` : `${w}×${h}`;
            const btn = this._mkBtn(lbl, () => {
                this._canvasW = w; this._canvasH = h;
                wInp.value = w; hInp.value = h;
            }, "#131824");
            btn.style.cssText += "font-size:9px;padding:2px 4px;flex:1;min-width:0;";
            presetRow.appendChild(btn);
        }
        sidebar.appendChild(presetRow);

        sidebar.appendChild(this._mkSidebarHeader("Reference Card"));
        this.refToggleBtn = this._mkBtn("👁 Reference: ON", () => this._toggleReference(), "#1a2a1a", "Toggle the reference image/video underlay in the viewport");
        this.refToggleBtn.style.cssText += "width:100%;font-size:11px;";
        sidebar.appendChild(this.refToggleBtn);

        const refBtnRow = document.createElement("div");
        refBtnRow.style.cssText = "display:flex;gap:3px;margin-top:3px;";
        const refImgBtn = this._mkBtn("🖼 Image", () => this._refFileInput.click(), "#2a2a1a", "Load a still image as the reference underlay");
        Object.assign(refImgBtn.style, { flex: "1", fontSize: "10px" });
        const refVidBtn = this._mkBtn("🎬 Video", () => this._refVideoInput.click(), "#1a2a2a", "Load a video file as the reference underlay (syncs to current frame)");
        Object.assign(refVidBtn.style, { flex: "1", fontSize: "10px" });
        const refSeqBtn = this._mkBtn("🎞 Seq", () => this._refSeqInput.click(), "#2a1a2a", "Load a sequence of images as a per-frame reference underlay");
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

        // ---- 3D Depth / NLF Section ----
        sidebar.appendChild(this._mkSidebarHeader("3D Depth (Experimental)"));

        this._expBtn = this._mkBtn("⬡ Turn to 3D: OFF", () => this._toggleExperimental(), "#1a1a2a", "Enable experimental 3D mode (auto-quad layout + NLF depth + 3D bone radius)");
        this._expBtn.style.width = "100%";
        this._expBtn.style.fontSize = "11px";
        sidebar.appendChild(this._expBtn);

        const expNote = document.createElement("div");
        expNote.textContent = "⚗ Experimental — requires NLF model on the Extractor";
        expNote.style.cssText = "font-size:9px;color:#c9a15a;font-style:italic;padding:2px 4px 4px;line-height:1.3;";
        sidebar.appendChild(expNote);

        this._nlfPanel = document.createElement("div");
        this._nlfPanel.style.cssText = "display:none;padding:4px 0;";

        this._nlfStatusEl = document.createElement("div");
        this._nlfStatusEl.style.cssText = "font-size:9px;color:#667;margin-bottom:4px;line-height:1.4;";
        this._nlfStatusEl.textContent = "NLF: not loaded";
        this._nlfPanel.appendChild(this._nlfStatusEl);

        // Slider moves fire at mousemove rate — coalesce redraws into one frame
        // so we don't dispose+rebuild every Three.js mesh per input event.
        const scheduleRender = () => {
            if (this._sliderRaf) return;
            this._sliderRaf = requestAnimationFrame(() => {
                this._sliderRaf = 0;
                this._renderFrame(this.currentFrame);
            });
        };

        // Slider + eye-toggle helper. Eye toggles between 0% and last non-zero value.
        const _mkSliderWithEye = (labelText, defaultValue, getProp, setProp) => {
            // Header row: label + eye button
            const headerRow = document.createElement("div");
            headerRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";
            const lbl = this._mkLabel(labelText);
            lbl.style.margin = "6px 0 2px";
            const eyeBtn = document.createElement("button");
            Object.assign(eyeBtn.style, {
                background: "none", border: "none", cursor: "pointer",
                fontSize: "12px", padding: "0 2px", flexShrink: "0",
                lineHeight: "1", color: THEME.textDim,
            });
            eyeBtn.title = "Toggle visibility (click) — last value is restored when turning back on";
            headerRow.append(lbl, eyeBtn);
            this._nlfPanel.appendChild(headerRow);
            // Slider
            const slider = document.createElement("input");
            Object.assign(slider, { type: "range", min: "0", max: "1", step: "0.05", value: String(defaultValue) });
            slider.style.width = "100%";
            this._nlfPanel.appendChild(slider);
            // Update eye icon based on whether value is > 0
            const lastNonZero = { v: defaultValue > 0 ? defaultValue : 1 };
            const refreshEye = () => {
                const v = getProp();
                eyeBtn.textContent = v > 0 ? "👁" : "🙈";
                eyeBtn.style.opacity = v > 0 ? "1" : "0.5";
            };
            slider.addEventListener("input", () => {
                const v = parseFloat(slider.value);
                setProp(v);
                if (v > 0) lastNonZero.v = v;
                refreshEye();
                scheduleRender();
            });
            eyeBtn.addEventListener("click", () => {
                const cur = getProp();
                const next = cur > 0 ? 0 : lastNonZero.v;
                setProp(next);
                slider.value = String(next);
                refreshEye();
                scheduleRender();
            });
            refreshEye();
            return slider;
        };

        this._dwposeAlphaSlider = _mkSliderWithEye("DWPose Opacity", 1,
            () => this._dwposeAlpha ?? 1,
            v => { this._dwposeAlpha = v; });

        this._nlfAlphaSlider = _mkSliderWithEye("NLF Overlay Opacity", 0.5,
            () => this._nlfAlpha ?? 0.5,
            v => { this._nlfAlpha = v; });

        this._nlfPanel.appendChild(this._mkLabel("3D Bone Radius"));
        this._boneScaleSlider = document.createElement("input");
        Object.assign(this._boneScaleSlider, { type: "range", min: "0.1", max: "3", step: "0.05", value: "1" });
        this._boneScaleSlider.style.width = "100%";
        this._boneScaleSlider.addEventListener("input", () => {
            this._boneScale = parseFloat(this._boneScaleSlider.value);
            scheduleRender();
        });
        this._nlfPanel.appendChild(this._boneScaleSlider);

        this._nlfApplyBtn = this._mkBtn("⬇ Bake Z Depth", () => this._applyNlfToDwpose(), "#1a2a1a", "Bake NLF-estimated Z depth into all DWPose keyframes");
        this._nlfApplyBtn.style.cssText += "width:100%;font-size:10px;margin-top:4px;";
        this._nlfApplyBtn.title = "Write NLF Z-depth into all body joints for every frame.\nDWPose XY positions are unchanged — only depth (Z) is set from NLF 3D data.";
        this._nlfPanel.appendChild(this._nlfApplyBtn);

        this._nlfUnbakeBtn = this._mkBtn("⬆ Unbake Z Depth", () => this._unbakeZDepth(), "#2a1a1a", "Clear baked Z depth from all keyframes (revert to flat 2D)");
        this._nlfUnbakeBtn.style.cssText += "width:100%;font-size:10px;margin-top:2px;";
        this._nlfUnbakeBtn.title = "Clear all baked Z-depth from body joints, flattening back to 2D. XY edits are preserved.";
        this._nlfPanel.appendChild(this._nlfUnbakeBtn);

        this._nlfDopeBtn = this._mkBtn("📊 Edit NLF Data", () => this._switchDataMode("nlf"), "#1a1a2a",
            "Switch the timeline to NLF mode — Dope Sheet + Graph Editor + viewport drags edit NLF keyframes (parallel to DWPose).");
        this._nlfDopeBtn.style.cssText += "width:100%;font-size:10px;margin-top:6px;";
        this._nlfPanel.appendChild(this._nlfDopeBtn);

        sidebar.appendChild(this._nlfPanel);

        // (Graph editor controls are now inside the graph panel itself — see graph panel setup)

        // ---- Resize handle: viewport/sidebar splitter ----
        const sidebarHandle = document.createElement("div");
        Object.assign(sidebarHandle.style, {
            width: "5px", flexShrink: "0", cursor: "ew-resize",
            background: "#161c34", borderLeft: "1px solid #2c3352",
            transition: "background 0.15s",
        });
        sidebarHandle.title = "Drag to resize sidebar";
        sidebarHandle.addEventListener("mouseenter", () => { sidebarHandle.style.background = "#253050"; });
        sidebarHandle.addEventListener("mouseleave", () => { sidebarHandle.style.background = "#161c34"; });
        sidebarHandle.addEventListener("mousedown", ev => {
            ev.preventDefault();
            const startX = ev.clientX, startW = sidebarOuter.getBoundingClientRect().width;
            const onMove = mv => { sidebarOuter.style.flex = `0 0 ${Math.max(140, Math.min(420, startW - (mv.clientX - startX)))}px`; };
            const onUp   = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup",   onUp);
        });
        // Insert handle between vpWrap and sidebar
        main.insertBefore(sidebarHandle, sidebarOuter);

        // ---- Timeline panel ----
        const timeline = document.createElement("div");
        this._timelineEl = timeline;
        Object.assign(timeline.style, {
            flexShrink: "0", background: "#0d1020", borderTop: "1px solid #2c3352",
            display: "flex", flexDirection: "column", height: "260px",
        });
        // Resize handle at top of timeline
        const tlHandle = document.createElement("div");
        Object.assign(tlHandle.style, {
            height: "5px", flexShrink: "0", cursor: "ns-resize",
            background: "#181e34", borderTop: "1px solid #2c3352",
        });
        tlHandle.title = "Drag to resize timeline";
        tlHandle.addEventListener("mouseenter", () => { tlHandle.style.background = "#253050"; });
        tlHandle.addEventListener("mouseleave", () => { tlHandle.style.background = "#181e34"; });
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
            display: "flex", alignItems: "center", flexShrink: "0",
            borderBottom: "1px solid #222a42", background: "#0a0c18",
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

        // DWpose / NLF data-mode toggle — switches the content of both Dope Sheet and Graph Editor
        const modeWrap = document.createElement("div");
        modeWrap.style.cssText = `display:flex;align-items:center;margin-left:auto;gap:0;padding:0 8px;`;
        this.dataMode = "dwpose";
        this.dataModeBtns = {};
        for (const [id, label, title] of [
            ["dwpose", "DWpose", "Show editable DWPose keyframes"],
            ["nlf",    "NLF",    "Show NLF detection data (read-only)"],
        ]) {
            const b = document.createElement("button");
            b.textContent = label;
            b.title = title;
            Object.assign(b.style, {
                background: THEME.bgPanel, border: `1px solid ${THEME.border}`,
                color: THEME.textDim, padding: "3px 12px", cursor: "pointer",
                fontSize: "11px", fontWeight: "600",
                borderRadius: id === "dwpose" ? "4px 0 0 4px" : "0 4px 4px 0",
                borderRight:  id === "dwpose" ? "none" : `1px solid ${THEME.border}`,
                transition: "background 90ms ease, color 90ms ease",
            });
            b.addEventListener("click", () => this._switchDataMode(id));
            this.dataModeBtns[id] = b;
            modeWrap.appendChild(b);
        }
        tabBar.appendChild(modeWrap);
        timeline.appendChild(tabBar);

        // Transport controls (always visible)
        const ctrlRow = document.createElement("div");
        Object.assign(ctrlRow.style, {
            display: "flex", alignItems: "center", gap: "4px",
            padding: "4px 8px", flexShrink: "0", borderBottom: "1px solid #1e2438",
            flexWrap: "wrap",
        });
        const toStartBtn = this._mkTransportBtn("⏮", "Jump to first frame",    () => { this._stopPlayback(); this._seekFrame(0); });
        const stepBwdBtn = this._mkTransportBtn("◀◀","Step back one frame",   () => { this._stopPlayback(); this._seekFrame(this.currentFrame - 1); });
        const playBwdBtn = this._mkTransportBtn("◀", "Play Backwards",        () => this._togglePlay("backward"));
        const playFwdBtn = this._mkTransportBtn("▶", "Play Forward",          () => this._togglePlay("forward"));
        const stepFwdBtn = this._mkTransportBtn("▶▶","Step forward one frame", () => { this._stopPlayback(); this._seekFrame(this.currentFrame + 1); });
        const toEndBtn   = this._mkTransportBtn("⏭", "Jump to last frame",    () => { this._stopPlayback(); this._seekFrame(this.frameCount - 1); });
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

        ctrlRow.append(toStartBtn, stepBwdBtn, playBwdBtn, this.frameLabel, fpsLabel, fpsInput,
                       playFwdBtn, stepFwdBtn, toEndBtn, loopBtn, rangeLabel, this.rangeStartInp, this.rangeEndInp,
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
            background: "#0a0c18", borderTop: "1px solid #1e2438",
            flexShrink: "0", alignItems: "center", flexWrap: "wrap",
        });
        const insBtn = this._mkBtn("⬦ Add Key  [K]",   () => this._insertKeyframeSelected(), "#1a3a2a");
        const delBtn = this._mkBtn("✕ Del Key  [Del]", () => this._deleteKeyframeSelected(), "#3a1a1a");
        const trimBefBtn = this._mkBtn("◀K✕ Before", () => this._trimKeyframesBefore(), "#2a1a2a");
        const trimAftBtn = this._mkBtn("✕K▶ After",  () => this._trimKeyframesAfter(),  "#2a1a2a");
        trimBefBtn.title = "Delete all keyframes BEFORE the current cursor position";
        trimAftBtn.title = "Delete all keyframes AFTER the current cursor position";
        // Auto Keyframe toggle
        this.autoKfBtn = this._mkBtn("⬤ Auto Key", () => this._toggleAutoKeyframe(), "#3a2a1a", "Auto-create a keyframe whenever you drag a joint");
        this.autoKfBtn.title = "Auto Keyframe: automatically insert a keyframe when you move a joint.\nWhen OFF, drag changes are temporary until you press K.";
        this._updateAutoKfBtn();
        for (const b of [insBtn, delBtn, trimBefBtn, trimAftBtn, this.autoKfBtn]) {
            b.style.fontSize = "11px"; b.style.padding = "2px 8px";
        }

        // Interpolation mode buttons — half size, on the right end of kfBar
        const interpSpacer = document.createElement("span");
        interpSpacer.style.cssText = "flex:1;";
        const interpKfLabel = document.createElement("span");
        interpKfLabel.style.cssText = "font-size:9px;color:#4a5a78;white-space:nowrap;";
        interpKfLabel.textContent = "KF:";
        this.interpLabel = interpKfLabel;
        this.interpBtns = {};
        for (const { val, title, svg } of INTERP_MODES) {
            const btn = document.createElement("button");
            btn.title = title; btn.innerHTML = svg;
            Object.assign(btn.style, {
                background: "#1d2138", border: "1px solid #2c3352", color: "#7888a8",
                borderRadius: "3px", cursor: "pointer", padding: "0",
                width: "20px", height: "16px",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: "0", overflow: "hidden",
            });
            const svgEl = btn.querySelector("svg");
            if (svgEl) { svgEl.style.width = "100%"; svgEl.style.height = "100%"; }
            btn.addEventListener("click", () => {
                const hasDopeSel  = this.selKfs.size > 0;
                const hasGraphSel = this.graphSel.size > 0;
                if (!hasDopeSel && !hasGraphSel) return;
                this._pushUndo();
                if (hasDopeSel) {
                    for (const key of this.selKfs) {
                        const [fStr, label] = key.split("::");
                        const fi = parseInt(fStr);
                        if (!this.tweens[fi]) this.tweens[fi] = {};
                        this.tweens[fi][label] = val;
                    }
                } else {
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
        }
        kfBar.append(insBtn, delBtn, trimBefBtn, trimAftBtn, this.autoKfBtn,
                     interpSpacer, interpKfLabel, ...Object.values(this.interpBtns));
        this.kfBar = kfBar;
        // Dope-only buttons — hidden in graph mode (graphRightPanel has equivalents).
        // Interp buttons + spacer + label stay visible in both modes since they
        // operate on graph-editor selection too.
        this._kfBarDopeOnly = [insBtn, delBtn, trimBefBtn, trimAftBtn, this.autoKfBtn];
        this.dopePanel.appendChild(kfBar);

        timeline.appendChild(this.dopePanel);
        // The DWpose dopePanel doubles as the NLF dopesheet — _getLayerDefs swaps rows by dataMode.
        this.nlfPanel = this.dopePanel;

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

        // Action row
        const actRow = document.createElement("div");
        Object.assign(actRow.style, {
            display: "flex", justifyContent: "flex-end", gap: "8px",
            padding: "6px 10px", flexShrink: "0", borderTop: "1px solid #1e2438",
        });
        const applyBtn = this._mkBtn("Apply", () => this._applyChanges(), "#1a6a3a", "Save all edits and push them through to the workflow");
        applyBtn.style.fontWeight = "bold";
        const undoBtn = this._mkBtn("↩", () => this._undo(), "#2a2a3a", "Undo (Ctrl+Z)");
        const redoBtn = this._mkBtn("↪", () => this._redo(), "#2a2a3a", "Redo (Ctrl+Y)");
        Object.assign(undoBtn.style, { padding: "0 7px", minWidth: "28px" });
        Object.assign(redoBtn.style, { padding: "0 7px", minWidth: "28px" });
        const resetCacheBtn = this._mkBtn("⟳ Reset", () => this._resetCache(), "#3a1a1a",
            "Clear server-side detection cache. Run the workflow again to re-detect from scratch.\nYour overrides and keyframes are kept.");

        actRow.append(undoBtn, redoBtn, applyBtn, resetCacheBtn, this._mkBtn("Close", () => this.close()));
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

    _mkBtn(text, fn, bg = THEME.bgBtn, title = "") {
        const b = document.createElement("button");
        b.textContent = text;
        if (title) b.title = title;
        _styleButton(b, { bg });
        if (fn) b.addEventListener("click", fn);
        return b;
    }
    _mkLabel(text) {
        const l = document.createElement("div");
        l.style.cssText = `font-size:10px;color:${THEME.textMute};letter-spacing:0.04em;text-transform:uppercase;margin:6px 0 2px;`;
        l.textContent = text.replace(/^─+\s*|\s*─+$/g, "").trim();
        return l;
    }
    /** Sidebar section header — flat label with accent underline (replaces collapsibles). */
    _mkSidebarHeader(text) {
        const wrap = document.createElement("div");
        wrap.style.cssText = `display:flex;align-items:center;gap:6px;margin:10px 0 4px;padding-bottom:3px;border-bottom:1px solid ${THEME.border};`;
        const accent = document.createElement("span");
        accent.style.cssText = `width:3px;height:11px;background:${THEME.accent};border-radius:2px;flex-shrink:0;`;
        const label = document.createElement("span");
        label.style.cssText = `font-size:10px;color:${THEME.text};font-weight:600;letter-spacing:0.06em;text-transform:uppercase;`;
        label.textContent = text;
        wrap.appendChild(accent); wrap.appendChild(label);
        return wrap;
    }
    /** Collapsible sidebar section. Returns { section, body } — append controls into `body`.
     *  Open/closed state persists in this._openSections by key. */
    _mkSection(title, key, defaultOpen = true) {
        if (!this._openSections) this._openSections = new Set();
        if (defaultOpen && !this._openSections.has(`__init__:${key}`)) {
            this._openSections.add(key);
            this._openSections.add(`__init__:${key}`);
        }
        const section = document.createElement("div");
        section.style.cssText = `border:1px solid ${THEME.border};border-radius:5px;background:${THEME.bgPanel};margin-top:6px;overflow:hidden;`;
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex", alignItems: "center", padding: "5px 8px",
            background: THEME.bgGroup, fontSize: "11px", fontWeight: "600",
            color: THEME.text, cursor: "pointer", userSelect: "none",
            letterSpacing: "0.04em", textTransform: "uppercase",
            borderBottom: `1px solid ${THEME.border}`,
        });
        const caret = document.createElement("span");
        caret.style.cssText = "width:12px;display:inline-block;color:" + THEME.textDim + ";";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = title;
        header.appendChild(caret); header.appendChild(titleSpan);
        const body = document.createElement("div");
        body.style.cssText = "padding:6px 8px;display:flex;flex-direction:column;gap:4px;";
        section.appendChild(header); section.appendChild(body);
        const apply = () => {
            const open = this._openSections.has(key);
            caret.textContent = open ? "▼" : "▶";
            body.style.display = open ? "flex" : "none";
            header.style.borderBottomColor = open ? THEME.border : "transparent";
        };
        apply();
        header.addEventListener("click", () => {
            if (this._openSections.has(key)) this._openSections.delete(key);
            else this._openSections.add(key);
            apply();
        });
        return { section, body };
    }
    _mkTransportBtn(text, title, fn) {
        const b = document.createElement("button");
        b.textContent = text; b.title = title;
        _styleButton(b, { bg: THEME.bgBtn, height: THEME.btnH });
        Object.assign(b.style, { fontSize: "13px", minWidth: "28px", padding: "0 7px" });
        b.addEventListener("click", fn);
        return b;
    }

    // -----------------------------------------------------------------------
    // Tab switching
    // -----------------------------------------------------------------------
    _switchTab(id) {
        this.activeTab = id;
        this._applyTabAndMode();
    }

    _switchDataMode(mode) {
        this.dataMode = mode;
        for (const [id, btn] of Object.entries(this.dataModeBtns)) {
            const active = id === mode;
            btn.style.background = active ? THEME.accent : THEME.bgPanel;
            btn.style.color      = active ? "#fff"       : THEME.textDim;
        }
        this._applyTabAndMode();
    }

    /** Apply the current (activeTab, dataMode) combination to the timeline panels.
     *  DWpose and NLF share the same dope/graph widgets — _getLayerDefs / _graphLabels
     *  swap rows by dataMode, so we just rebuild the timeline whenever the mode changes. */
    _applyTabAndMode() {
        const inDope  = this.activeTab === "dope";
        const inGraph = this.activeTab === "graph";

        this.dopePanel.style.display       = "flex";
        this.trackWrapper.style.display    = inDope ? "block" : "none";
        this.graphCanvas.style.display     = inGraph ? "block" : "none";
        this.graphRightPanel.style.display = inGraph ? "flex" : "none";
        // Keep kfBar visible in both modes so the interp buttons remain reachable
        // from the graph editor (they operate on graph selection too). Hide only the
        // dope-only buttons in graph mode — the graph right panel already has those.
        if (this.kfBar) this.kfBar.style.display = "flex";
        if (this._kfBarDopeOnly) {
            for (const b of this._kfBarDopeOnly) {
                if (b) b.style.display = inDope ? "" : "none";
            }
        }

        for (const [tid, btn] of Object.entries(this.tabBtns)) {
            const active = tid === this.activeTab;
            btn.style.color       = active ? "#d4ddf4" : "#5a6a88";
            btn.style.borderColor = active ? "#5bc4ff" : "transparent";
            btn.style.background  = active ? "#141e38" : "none";
        }
        if (this.dataModeBtns) {
            for (const [id, btn] of Object.entries(this.dataModeBtns)) {
                const active = id === this.dataMode;
                btn.style.background = active ? THEME.accent : THEME.bgPanel;
                btn.style.color      = active ? "#fff"       : THEME.textDim;
            }
        }

        if (inDope) this._refreshTimeline();
        if (inGraph) {
            requestAnimationFrame(() => {
                const rect = this.graphCanvas.getBoundingClientRect();
                if (rect.width > 0) {
                    this.graphCanvas.width  = Math.round(rect.width);
                    this.graphCanvas.height = Math.round(rect.height);
                }
                this._graphAutoFitRange(); this._renderGraphEditor();
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
        this.playFwdBtn.textContent = fa ? "⏸" : "▶";
        this.playFwdBtn.title       = fa ? "Pause" : "Play Forward";
        Object.assign(this.playFwdBtn.style, { background: fa?"#1a4a2a":"#1e1e30", borderColor: fa?"#3aaa6a":"#3a3a4a", color: fa?"#7affaa":"#ccc" });
        this.playBwdBtn.textContent = ba ? "⏸" : "◀";
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
            btn.style.background  = active ? "#2a1e4a" : "#1d2138";
            btn.style.borderColor = active ? "#8860cc"  : "#2c3352";
            btn.style.color       = active ? "#cc99ff"  : (hasSel ? "#7888a8" : "#3a4560");
            btn.style.cursor      = hasSel ? "pointer"  : "default";
            btn.style.opacity     = hasSel ? "1" : "0.45";
        }

        if (this.interpLabel) {
            if (hasSel) {
                this.interpLabel.textContent = "Seg:";
                this.interpLabel.style.color = "#5bc4ff";
            } else if (isPerSegment) {
                this.interpLabel.textContent = "KF:";
                this.interpLabel.style.color = "#7860aa";
            } else {
                this.interpLabel.textContent = "KF:";
                this.interpLabel.style.color = "#4a5a78";
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
        this._canvasW          = data.canvas_w || 0;
        this._canvasH          = data.canvas_h || 0;
        this._contentHash      = data._content_hash || "";
        if (this._canvasWInp) this._canvasWInp.value = this._canvasW || this.poseW || "";
        if (this._canvasHInp) this._canvasHInp.value = this._canvasH || this.poseH || "";

        this.frames = {};
        for (const [k, v] of Object.entries(data.frames || {}))
            this.frames[parseInt(k)] = v;
        this.overrides = {};
        for (const [k, v] of Object.entries(data.overrides || {}))
            this.overrides[parseInt(k)] = v;
        // Migrate legacy zDepth dict → overrides[fi][label][3]
        for (const [k, v] of Object.entries(data.z_depth || {})) {
            const fi = parseInt(k);
            for (const [label, z] of Object.entries(v)) {
                if (!this.overrides[fi]) this.overrides[fi] = {};
                const ov = this.overrides[fi][label];
                if (Array.isArray(ov)) { if (ov[3] === undefined) ov[3] = z; }
                else this.overrides[fi][label] = [0, 0, 1, z];
            }
        }
        // Ensure all override entries have z at index [3] (default 0)
        for (const fi of Object.keys(this.overrides)) {
            const frame = this.overrides[fi];
            for (const label of Object.keys(frame)) {
                const ov = frame[label];
                if (Array.isArray(ov) && ov.length === 3) ov.push(null);
            }
        }
        this.tweens = {};
        for (const [k, v] of Object.entries(data.tweens || {}))
            this.tweens[parseInt(k)] = v;
        this.refFrameOverrides = data.ref_frame_overrides || {};

        this.scrubber.max       = String(Math.max(0, this.frameCount - 1));

        // Default range end to last frame so zone layout starts in linear (full) mode
        if (this.frameRangeEnd === 0 && this.frameCount > 1) {
            this.frameRangeEnd = this.frameCount - 1;
            if (this.rangeEndInp) this.rangeEndInp.value = this.frameRangeEnd;
        }

        this._updateInterpBtns();
        this.graphViewport = { frameStart: 0, frameEnd: Math.max(1, this.frameCount - 1), valMin: 0, valMax: Math.max(this.poseW, this.poseH) };

        // Restore UI display state (experimental mode, viewports, opacity sliders, data mode)
        if (data.experimental_mode !== undefined) {
            const wantExp = !!data.experimental_mode;
            if (wantExp !== this._experimentalMode) this._toggleExperimental();
            // Override the panel layout/views that _toggleExperimental set, if we have saved ones
            if (wantExp && Array.isArray(data.panel_views)) {
                this._panelViews = [...data.panel_views];
                this._setLayout(data.panel_layout || 4);
            }
        }
        if (data.dwpose_alpha !== undefined) {
            this._dwposeAlpha = data.dwpose_alpha;
            if (this._dwposeAlphaSlider) {
                this._dwposeAlphaSlider.value = String(this._dwposeAlpha);
                this._dwposeAlphaSlider.dispatchEvent(new Event("input"));
            }
        }
        if (data.nlf_alpha !== undefined) {
            this._nlfAlpha = data.nlf_alpha;
            if (this._nlfAlphaSlider) {
                this._nlfAlphaSlider.value = String(this._nlfAlpha);
                this._nlfAlphaSlider.dispatchEvent(new Event("input"));
            }
        }
        if (data.data_mode) this._switchDataMode(data.data_mode);

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

        if (this.dataMode === "nlf") {
            // NLF mode: show only nlf_body rows (18 OpenPose joints, edited via overrides)
            rows.push({ type: "group", id: "nlf_body", name: "NLF Body", color: NLF_BODY_COLOR });
            if (exp.has("nlf_body"))
                for (let i = 0; i < N_NLF_BODY; i++)
                    addJoint(`nlf_body_${i}`, JOINT_LABELS[i] || `j${i}`, NLF_BODY_COLOR, "nlf_body", i);
        } else {
            // DWpose mode: body / hands / face
            rows.push({ type: "group", id: "body",  name: "Body",   color: "#555" });
            if (exp.has("body"))  for (let i=0;i<20;i++) addJoint(`body_${i}`,  JOINT_LABELS[i], JOINT_COLORS[i]||"#aaa", "body",  i);
            rows.push({ type: "group", id: "rhand", name: "R Hand", color: RHAND_COLOR });
            if (exp.has("rhand")) for (let i=0;i<21;i++) addJoint(`rhand_${i}`, HAND_JOINT_LABELS[i]||`f${i}`, RHAND_COLOR, "rhand", i);
            rows.push({ type: "group", id: "lhand", name: "L Hand", color: LHAND_COLOR });
            if (exp.has("lhand")) for (let i=0;i<21;i++) addJoint(`lhand_${i}`, HAND_JOINT_LABELS[i]||`f${i}`, LHAND_COLOR, "lhand", i);
            rows.push({ type: "group", id: "face",  name: "Face",   color: FACE_COLOR });
            if (exp.has("face"))  for (let i=0;i<N_FACE;i++) addJoint(`face_${i}`, FACE_JOINT_LABELS[i], FACE_COLOR, "face", i);
        }

        // Camera group — shown in 3D mode or once a camera KF exists
        if (this._experimentalMode || this._hasCameraKeyframes()) {
            rows.push({ type: "group", id: "camera", name: "◎ Camera", color: "#cc8800" });
            if (exp.has("camera")) {
                // Camera channels are scalars — single value, not 2D pose points
                const addCamScalar = (label, name, color, min, max, step, def, unit) =>
                    rows.push({ type: "camscalar", label, name, color, group: "camera",
                                min, max, step, def, unit: unit ?? "" });
                addCamScalar("cam_x",    "Pos X",  "#ffaa44", -2,   2,   0.01,  0,   "");
                addCamScalar("cam_y",    "Pos Y",  "#ff8844", -2,   2,   0.01,  0,   "");
                addCamScalar("cam_z",    "Pos Z",  "#ff6633",  0.1, 10,  0.01,  1.0, "");
                addCamScalar("cam_roll", "Roll",   "#aabb44", -180, 180, 0.5,   0,   "°");
                addCamScalar("cam_tilt", "Tilt",   "#88cc44",  -89,  89, 0.5,   0,   "°");
                addCamScalar("cam_pan",  "Pan",    "#44ccaa", -180, 180, 0.5,   0,   "°");
                addCamScalar("cam_fov",  "FOV",    "#ffcc44",  12,  200, 1,    60,   "°");
            }
        }
        return rows;
    }

    // -----------------------------------------------------------------------
    // Timeline (dope sheet)
    // -----------------------------------------------------------------------
    _refreshTimeline() {
        this._buildLayerPanel(); this._renderTrack(); this._renderFrame(this.currentFrame); this._updateCamBtnStyle();
    }
    _updateSidebarValues() {
        if (!this._sidebarRefs) return;
        const fi = this.currentFrame;
        for (const [label, ref] of Object.entries(this._sidebarRefs)) {
            const { valInp, kfBtn, row } = ref;
            const hasKf = !!this.overrides[fi]?.[label];
            kfBtn.textContent = hasKf ? "◆" : "◇";
            kfBtn.style.color = hasKf ? row.color : "#445";
            kfBtn.title = hasKf ? "Remove KF at this frame" : "Add KF at this frame";
            if (valInp) {
                const v = this.overrides[fi]?.[label]?.[0]
                    ?? this._interpolateJoint(label, fi)?.[0]
                    ?? row.def ?? 0;
                valInp.value = v.toFixed(row.step < 0.1 ? 3 : 2);
            }
        }
    }

    _updateCamBtnStyle() {
        if (!this._addCamBtn) return;
        const hasCam = this._hasCameraKeyframes();
        this._addCamBtn.style.background = hasCam ? "#1e1e28" : "#0e2a12";
        this._addCamBtn.style.color      = hasCam ? "#445566" : "#88cc88";
        this._addCamBtn.style.cursor     = hasCam ? "default" : "pointer";
        this._addCamBtn.title            = hasCam
            ? "Camera already added to dope sheet"
            : "Add a camera — adds ◎ Camera group to the dope sheet.";
    }

    _buildLayerPanel() {
        this.layerPanel.innerHTML = "";
        this._detailInputs = {};   // clear stale input refs; rebuilt below
        this._sidebarRefs  = {};   // camscalar valInp + kfBtn refs for live value updates
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
                el.style.background     = THEME.bgGroup;
                el.style.fontWeight     = "600";
                el.style.color          = isHiddenGrp ? THEME.textMute : THEME.text;
                el.style.cursor         = "pointer";
                el.style.borderTop      = `1px solid ${THEME.border}`;
                el.style.borderLeft     = `3px solid ${row.color || THEME.accent}`;
                el.style.transition     = "background 90ms ease";
                el.addEventListener("mouseenter", () => { if (!isHiddenGrp) el.style.background = "#222a44"; });
                el.addEventListener("mouseleave", () => { el.style.background = THEME.bgGroup; });
                // Expand arrow + name
                const nameSpan = document.createElement("span");
                nameSpan.style.flex = "1";
                nameSpan.style.letterSpacing = "0.02em";
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
                const detPts = _grpPts(detFd, row.group);
                const detPt = detPts?.[row.index] ?? [0, 0, 0];  // conf=0 when joint not in detection

                const writeDetail = (xOvr, yOvr, cOvr, zOvr) => {
                    const fi = this.currentFrame;
                    const fd2 = this._getEffectiveFrame(fi);
                    const gp  = _grpPts(fd2, row.group);
                    const cur = gp?.[row.index] ?? [0, 0, 1, 0];
                    const curZ = cur[3] ?? null;
                    if (this._panelInputDragging) this._lazyPushUndo(); else this._pushUndo();
                    if (!this.overrides[fi]) this.overrides[fi] = {};
                    const z = zOvr !== undefined ? zOvr : curZ;
                    this.overrides[fi][row.label] = [
                        xOvr !== undefined ? xOvr : cur[0],
                        yOvr !== undefined ? yOvr : cur[1],
                        cOvr !== undefined ? Math.max(0, Math.min(1, cOvr)) : (cur[2] ?? 1),
                        z,
                    ];
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
                    const zVal = detPt[3] ?? this.overrides[this.currentFrame]?.[row.label]?.[3] ?? 0;
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
            } else if (row.type === "camscalar") {
                // ---- Camera scalar channel row — single drag value ----
                el.style.background = "#0e0e1c";
                el.style.borderLeft = `3px solid ${row.color}`;
                el.style.padding = "0 6px 0 8px";
                el.style.gap = "4px"; el.style.cursor = "default";

                const dot2 = document.createElement("span");
                dot2.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;background:${row.color};flex-shrink:0;`;
                el.appendChild(dot2);

                const nameLbl = document.createElement("span");
                nameLbl.style.cssText = "font-size:10px;color:#99aacc;flex-shrink:0;min-width:36px;";
                nameLbl.textContent = row.name;
                el.appendChild(nameLbl);

                const curVal = this.overrides[this.currentFrame]?.[row.label]?.[0]
                    ?? this._interpolateJoint(row.label, this.currentFrame)?.[0] ?? row.def ?? 0;
                const valInp = document.createElement("input");
                Object.assign(valInp, { type: "number", value: curVal.toFixed(row.step < 0.1 ? 3 : 2),
                    step: String(row.step ?? 0.01) });
                if (row.min !== undefined) valInp.min = String(row.min);
                if (row.max !== undefined) valInp.max = String(row.max);
                Object.assign(valInp.style, {
                    flex: "1", background: "#141428", color: "#aabbdd",
                    border: "1px solid #2a2a44", borderRadius: "2px",
                    padding: "0 3px", fontSize: "11px", height: "17px", boxSizing: "border-box",
                    cursor: "ew-resize",
                });
                valInp.addEventListener("click", e2 => e2.stopPropagation());

                const writeCamScalar = (v) => {
                    const fi = this.currentFrame;
                    if (!this.overrides[fi]) this.overrides[fi] = {};
                    if (this._panelInputDragging) this._lazyPushUndo(); else this._pushUndo();
                    const prev = this.overrides[fi][row.label];
                    this.overrides[fi][row.label] = [v, prev?.[1]??0, 1, prev?.[3]??0];
                    this._renderFrame(fi); this._renderTrack();
                };

                let scStartX, scStartVal, scMoved;
                const scOnMove = (ev) => {
                    const dx = ev.clientX - scStartX;
                    if (!scMoved && Math.abs(dx) < 3) return;
                    if (!scMoved) { scMoved = true; valInp.blur(); document.body.style.cursor = "ew-resize"; }
                    let nv = scStartVal + dx * (row.step ?? 0.01);
                    if (row.min !== undefined) nv = Math.max(row.min, nv);
                    if (row.max !== undefined) nv = Math.min(row.max, nv);
                    valInp.value = nv.toFixed(row.step < 0.1 ? 3 : 2);
                    if (!this._panelInputDragging) this._panelInputDragging = true;
                    valInp.dispatchEvent(new Event("change"));
                };
                const scOnUp = () => {
                    document.removeEventListener("mousemove", scOnMove);
                    document.removeEventListener("mouseup", scOnUp);
                    document.body.style.cursor = "";
                    this._panelInputDragging = false;
                    if (scMoved) this._lazyPushUndo(); else valInp.select();
                };
                valInp.addEventListener("mousedown", e2 => {
                    e2.stopPropagation();
                    scStartX = e2.clientX; scStartVal = parseFloat(valInp.value) || 0; scMoved = false;
                    this._armUndo();
                    document.addEventListener("mousemove", scOnMove);
                    document.addEventListener("mouseup", scOnUp);
                });
                valInp.addEventListener("change", () => {
                    let v = parseFloat(valInp.value);
                    if (isNaN(v)) { valInp.value = curVal.toFixed(row.step < 0.1 ? 3 : 2); return; }
                    if (row.min !== undefined) v = Math.max(row.min, v);
                    if (row.max !== undefined) v = Math.min(row.max, v);
                    writeCamScalar(v);
                });
                el.appendChild(valInp);

                if (row.unit) {
                    const uLbl = document.createElement("span");
                    uLbl.style.cssText = "font-size:9px;color:#556;flex-shrink:0;padding-left:2px;";
                    uLbl.textContent = row.unit;
                    el.appendChild(uLbl);
                }

                // Keyframe diamond indicator
                const hasKf = !!this.overrides[this.currentFrame]?.[row.label];
                const kfBtn = document.createElement("span");
                kfBtn.textContent = hasKf ? "◆" : "◇";
                kfBtn.style.cssText = `color:${hasKf ? row.color : "#445"};font-size:11px;flex-shrink:0;cursor:pointer;padding:0 2px;`;
                kfBtn.title = hasKf ? "Remove KF at this frame" : "Add KF at this frame";
                kfBtn.addEventListener("click", e2 => {
                    e2.stopPropagation();
                    const fi = this.currentFrame;
                    if (this.overrides[fi]?.[row.label]) {
                        delete this.overrides[fi][row.label];
                        if (Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
                    } else {
                        if (!this.overrides[fi]) this.overrides[fi] = {};
                        const v = this._interpolateJoint(row.label, fi)?.[0] ?? row.def ?? 0;
                        this.overrides[fi][row.label] = [v, 0, 1, 0];
                    }
                    this._refreshTimeline(); this._renderFrame(fi);
                });
                el.appendChild(kfBtn);
                this._sidebarRefs[row.label] = { valInp, kfBtn, row };
                // Click row → select this channel for the graph editor
                el.style.cursor = "pointer";
                const isSel = this._selectedCamLabels?.has(row.label);
                if (isSel) el.style.background = "#1a2a1a";
                el.addEventListener("click", (e3) => {
                    e3.stopPropagation();
                    if (!this._selectedCamLabels) this._selectedCamLabels = new Set();
                    if (e3.ctrlKey) {
                        if (this._selectedCamLabels.has(row.label)) this._selectedCamLabels.delete(row.label);
                        else this._selectedCamLabels.add(row.label);
                    } else {
                        this._selectedCamLabels.clear();
                        this._selectedCamLabels.add(row.label);
                        this.selectedJoints.clear(); this.selectedJoint = null;
                    }
                    this._switchTab("graph");
                    this._graphAutoFitRange(); this._renderGraphEditor(); this._refreshTimeline();
                });
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
                // Keyframe diamond indicator
                const hasKf = !!this.overrides[this.currentFrame]?.[row.label];
                const kfBtn = document.createElement("span");
                kfBtn.textContent = hasKf ? "◆" : "◇";
                kfBtn.style.cssText = `color:${hasKf ? row.color : "#445"};font-size:11px;flex-shrink:0;cursor:pointer;padding:0 2px;`;
                kfBtn.title = hasKf ? "Remove KF at this frame" : "Add KF at this frame";
                kfBtn.addEventListener("click", e2 => {
                    e2.stopPropagation();
                    const fi = this.currentFrame;
                    if (this.overrides[fi]?.[row.label]) {
                        this._deleteKeyframe(row.label, fi);
                    } else {
                        this._insertKeyframe(row.label, fi);
                    }
                });
                el.appendChild(kfBtn);
                this._sidebarRefs[row.label] = { kfBtn, row };
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
            ctx.fillStyle = row.type==="group" ? "#171d32" : ri%2===0?"#12131e":"#0e0f19";
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
                ctx.strokeStyle = "#252a44";
                ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
                ctx.fillStyle = "#5a6a88"; ctx.font = "9px 'JetBrains Mono',monospace";
                ctx.fillText(String(fi), x+2, 10);
            } else if (fi % 5 === 0) {
                ctx.strokeStyle = "#1a1e30";
                ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
            }
        }

        // Range IN / OUT boundary markers
        if (PRE_W > 0) {
            ctx.strokeStyle = "#5bc4ff"; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(PRE_W, 0); ctx.lineTo(PRE_W, H); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#5bc4ff"; ctx.font = "bold 9px 'JetBrains Mono',monospace";
            ctx.fillText("IN", PRE_W + 2, 10);
        }
        if (POST_W > 0) {
            const xOut = PRE_W + MID_W;
            ctx.strokeStyle = "#f5a840"; ctx.lineWidth = 1.5; ctx.setLineDash([4,3]);
            ctx.beginPath(); ctx.moveTo(xOut, 0); ctx.lineTo(xOut, H); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#f5a840"; ctx.font = "bold 9px 'JetBrains Mono',monospace";
            ctx.fillText("OUT", xOut + 2, 10);
        }

        // Row dividers
        ctx.strokeStyle = "#1a1e2e"; ctx.lineWidth = 1;
        rows.forEach((_, ri) => {
            ctx.beginPath(); ctx.moveTo(0,ri*ROW_H-0.5); ctx.lineTo(W,ri*ROW_H-0.5); ctx.stroke();
        });

        // Current frame highlight
        const cfx = this._frameToX(this.currentFrame);
        const cfw = this._framePxAt(this.currentFrame);
        ctx.fillStyle = "rgba(91,196,255,0.1)"; ctx.fillRect(cfx - cfw/2, 0, cfw, H);
        ctx.strokeStyle = "#5bc4ff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cfx, 0); ctx.lineTo(cfx, H); ctx.stroke();

        // Tween lines (colored by interpolation mode per segment)
        rows.forEach((row, ri) => {
            if (row.type !== "joint" && row.type !== "camscalar") return;
            if (this.hiddenGroups.has(row.group) || this.hiddenLayers.has(row.label)) return;
            const kfs = this._getKeyframesForJoint(row.label);
            if (kfs.length < 2) return;
            const y = ri*ROW_H + ROW_H/2;
            for (let i=0; i<kfs.length-1; i++) {
                const x0 = this._frameToX(kfs[i]), x1 = this._frameToX(kfs[i+1]);
                const segMode = this.tweens[kfs[i]]?.[row.label] ?? this.interpolationMode;
                const segColor = segMode === "catmull_rom" ? "#40e8a0" :
                                 segMode === "constant"    ? "#556070" :
                                 (segMode.startsWith("back")||segMode.startsWith("elastic")||segMode==="bounce_out") ? "#f5a040" :
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
            if (row.type !== "joint" && row.type !== "camscalar") return;
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

                const baseColor = isMultiSel ? "#5bc4ff" : isCurAndSel ? "#f7c840" : (row.color || "#f7c840");
                const strokeC   = isMultiSel ? "#0068aa" : "#0a0c14";
                const strokeW   = isMultiSel ? 1.5 : 0.8;

                ctx.save();
                ctx.translate(x, y);

                // Selection glow
                if (isMultiSel) {
                    drawKfPath(baseShape, sz + 5);
                    ctx.fillStyle = "rgba(91,196,255,0.18)";
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
                if (row.detail === "zoffset") return;
                const detKfs = this._getKeyframesForDetailChannel(row.label, row.detail);
                if (detKfs.length === 0) return;
                const detColor = row.detail === "z" ? "#557799" : row.detail === "xy" ? "#6688bb" : "#558855";
                for (const fi of detKfs) {
                    const key3 = `${fi}::${row.label}::${row.detail}`;
                    const isSel = this.selKfs.has(key3);
                    const x2 = this._frameToX(fi);
                    const sz = isSel ? KFSZ_SEL : KFSZ;
                    ctx.fillStyle = isSel ? "#ffffff" : detColor;
                    ctx.strokeStyle = "#111"; ctx.lineWidth = isSel ? 1.5 : 0.8;
                    ctx.beginPath();
                    ctx.moveTo(x2, ry2-sz/2); ctx.lineTo(x2+sz/2, ry2);
                    ctx.lineTo(x2, ry2+sz/2); ctx.lineTo(x2-sz/2, ry2);
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
            ctx.fillStyle = "rgba(91,196,255,0.1)"; ctx.fillRect(rx,ry,rw,rh);
            ctx.strokeStyle = "#5bc4ff"; ctx.lineWidth = 1; ctx.setLineDash([3,2]);
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
        } else if (row?.type === "camscalar") {
            const KF_HIT_PX = 10;
            let minDist = KF_HIT_PX;
            for (const kf of this._getKeyframesForJoint(row.label)) {
                const d = Math.abs(this._frameToX(kf) - x);
                if (d < minDist) { minDist = d; hitFi = kf; }
            }
        } else if (row?.type === "joint_detail" && row.detail !== "zoffset") {
            const KF_HIT_PX = 10;
            let minDist = KF_HIT_PX;
            for (const kf of this._getKeyframesForDetailChannel(row.label, row.detail)) {
                const d = Math.abs(this._frameToX(kf) - x);
                if (d < minDist) { minDist = d; hitFi = kf; hitCh = row.detail; }
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
                    if (parts.length === 3 && ["xy","conf","z"].includes(parts[2])) {
                        // joint_detail channel keyframe — stored as indices in overrides[fi][label]
                        const label = parts[1], detail = parts[2];
                        const ov = this.overrides[origFi]?.[label];
                        if (ov) {
                            const idxs = detail === "xy" ? [0,1] : detail === "conf" ? [2] : [3];
                            toAdd.push({ origFi, newFi, label, detail, idxs, vals: idxs.map(i => ov[i]), isJointDetail: true });
                        }
                    } else if (parts.length === 3) {
                        // wrist_rotation channel keyframe: "fi::label::ch"
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
                    for (const item of toAdd) {
                        if (!this.overrides[item.origFi]) continue;
                        if (item.isJointDetail) {
                            const ov = this.overrides[item.origFi][item.label];
                            if (ov) { for (const i of item.idxs) ov[i] = null; }
                            if (!ov || ov.every(v => v == null)) {
                                delete this.overrides[item.origFi][item.label];
                                if (Object.keys(this.overrides[item.origFi]).length === 0) delete this.overrides[item.origFi];
                            }
                        } else if (item.isChannel) {
                            delete this.overrides[item.origFi][item.chKey];
                            if (Object.keys(this.overrides[item.origFi]).length === 0) delete this.overrides[item.origFi];
                        } else {
                            delete this.overrides[item.origFi][item.label];
                            if (Object.keys(this.overrides[item.origFi]).length === 0) delete this.overrides[item.origFi];
                        }
                    }
                }
                // Write at new positions
                for (const item of toAdd) {
                    if (!this.overrides[item.newFi]) this.overrides[item.newFi] = {};
                    if (item.isJointDetail) {
                        if (!this.overrides[item.newFi][item.label]) this.overrides[item.newFi][item.label] = [null,null,null,null];
                        for (let k = 0; k < item.idxs.length; k++) this.overrides[item.newFi][item.label][item.idxs[k]] = item.vals[k];
                    } else if (item.isChannel) {
                        this.overrides[item.newFi][item.chKey] = item.data;
                    } else {
                        this.overrides[item.newFi][item.label] = item.data;
                    }
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
            if ((row?.type === "joint" || row?.type === "wrist_rotation" || row?.type === "camscalar" || row?.type === "joint_detail") && key) {
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
            } else if (row.type === "camscalar") {
                for (let fi = fi0; fi <= fi1; fi++)
                    if (this.overrides[fi]?.[row.label] !== undefined)
                        this.selKfs.add(`${fi}::${row.label}`);
            } else if (row.type === "joint_detail" && row.detail !== "zoffset") {
                const idxMap = { xy: 0, conf: 2, z: 3 };
                const idx = idxMap[row.detail];
                for (let fi = fi0; fi <= fi1; fi++) {
                    const ov = this.overrides[fi]?.[row.label];
                    if (ov && ov[idx] != null) this.selKfs.add(`${fi}::${row.label}::${row.detail}`);
                }
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
        if (!row || (row.type !== "joint" && row.type !== "wrist_rotation" && row.type !== "camscalar")) return;
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
    /** Call before modifying overrides during a drag. */
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
        this.overrides = s.overrides; this.tweens = s.tweens;
        this._renderFrame(this.currentFrame); this._refreshTimeline();
        if (this.activeTab === "graph") this._renderGraphEditor();
    }
    _redo() {
        if (!this._redoStack.length) return;
        this._undoStack.push(this._snapshot());
        const s = this._redoStack.pop();
        this.overrides = s.overrides; this.tweens = s.tweens;
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
            if (parts.length === 3 && ["xy","conf","z"].includes(parts[2])) {
                // joint_detail channel: null specific indices in the override array
                const fi = parseInt(parts[0]), label = parts[1], detail = parts[2];
                const ov = this.overrides[fi]?.[label];
                if (ov) {
                    if (detail === "xy") { ov[0] = null; ov[1] = null; }
                    else if (detail === "conf") ov[2] = null;
                    else ov[3] = null;
                    if (ov.every(v => v == null)) {
                        delete this.overrides[fi][label];
                        if (Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
                    }
                }
            } else if (parts.length === 3) {
                // wrist_rotation channel keyframe
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
        // If joint_detail channel KFs are selected, trim only those channels
        if (this.selKfs.size > 0) {
            const detailKeys = [...this.selKfs].filter(k => {
                const p = k.split("::"); return p.length === 3 && ["xy","conf","z"].includes(p[2]);
            });
            if (detailKeys.length > 0) {
                const targets = {};
                for (const key of detailKeys) {
                    const [, label, detail] = key.split("::");
                    targets[`${label}::${detail}`] = { label, detail };
                }
                const idxFor = d => d === "xy" ? [0,1] : d === "conf" ? [2] : [3];
                let hasTargets = false;
                outer: for (const fi of Object.keys(this.overrides).map(Number)) {
                    if (!predicate(fi)) continue;
                    for (const { label, detail } of Object.values(targets)) {
                        const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                        if (idxFor(detail).some(i => ov[i] != null)) { hasTargets = true; break outer; }
                    }
                }
                if (!hasTargets) return;
                this._pushUndo();
                for (const fi of Object.keys(this.overrides).map(Number)) {
                    if (!predicate(fi)) continue;
                    for (const { label, detail } of Object.values(targets)) {
                        const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                        for (const i of idxFor(detail)) ov[i] = null;
                        if (ov.every(v => v == null)) {
                            delete this.overrides[fi][label];
                            if (Object.keys(this.overrides[fi]).length === 0) delete this.overrides[fi];
                        }
                    }
                }
                this.selKfs.clear();
                this._refreshTimeline(); this._renderFrame(this.currentFrame);
                if (this.activeTab === "graph") this._renderGraphEditor();
                return;
            }
        }
        const targets = new Set(
            this.selectedJoints.size > 0
                ? [...this.selectedJoints]
                : this._getLayerDefs().filter(r => r.type === "joint" || r.type === "camscalar").map(r => r.label)
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
                const grp = _splitLabel(label).group;
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
                .filter(r => (r.type === "joint" || r.type === "camscalar") && this._getKeyframesForJoint(r.label).length > 0)
                .map(r => r.label);
        }
        if (labels.length === 0) return;

        let vMin=Infinity, vMax=-Infinity, fMin=Infinity, fMax=-Infinity;
        for (const lbl of labels) {
            const kfs = this._getKeyframesForJoint(lbl);
            if (kfs.length === 0) continue;
            fMin = Math.min(fMin, kfs[0]);
            fMax = Math.max(fMax, kfs[kfs.length - 1]);
            const isCam = this._isCamScalarLabel(lbl);
            // Sample the interpolated curve, not just raw override positions
            const step = Math.max(1, Math.floor((kfs[kfs.length - 1] - kfs[0]) / 80));
            for (let fi = kfs[0]; fi <= kfs[kfs.length - 1]; fi += step) {
                if (this.graphShowX || isCam) {
                    const v = this._getValueAtFrame(lbl, 0, fi);
                    if (v !== null) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
                }
                if (this.graphShowY && !isCam) {
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
                .filter(r => (r.type === "joint" || r.type === "camscalar") && this._getKeyframesForJoint(r.label).length > 0)
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
            const isCam = this._isCamScalarLabel(lbl);
            // Sample at ~3-frame intervals — enough for accurate percentile without heavy cost
            const step = Math.max(1, Math.floor((kfs[kfs.length - 1] - kfs[0]) / 120));
            for (let fi = kfs[0]; fi <= kfs[kfs.length - 1]; fi += step) {
                if (this.graphShowX || isCam) {
                    const v = this._getValueAtFrame(lbl, 0, fi);
                    if (v !== null) allVals.push(v);
                }
                if (this.graphShowY && !isCam) {
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

    _isCamScalarLabel(label) { return label.startsWith("cam_"); }

    /** Returns the list of joint/camera labels to show in the graph. */
    _graphLabels() {
        if (this._selectedCamLabels?.size > 0) return [...this._selectedCamLabels];
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
        const { group, index: ki } = _splitLabel(label);
        const pts = _grpPts(raw, group);
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
        ctx.fillStyle = "#080810"; ctx.fillRect(0, 0, cw, ch);

        const T = this._graphTransform();
        const { fToX, vToY, PAD } = T;

        // Grid — vertical frame lines
        ctx.lineWidth = 1;
        const fStep = this._graphFrameStep();
        for (let f = Math.ceil(this.graphViewport.frameStart/fStep)*fStep; f <= this.graphViewport.frameEnd; f += fStep) {
            const x = fToX(f);
            ctx.strokeStyle = f % (fStep*5)===0 ? "#22283e" : "#181c2c";
            ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, ch-PAD.b); ctx.stroke();
            ctx.fillStyle = "#5a6a88"; ctx.font = "9px 'JetBrains Mono',monospace";
            ctx.fillText(String(f), x+2, ch-PAD.b+11);
        }
        // Grid — horizontal value lines (only in non-normalized mode; normalized mode draws its own ±1/0 grid later)
        if (!this.normalizeGraph) {
            const vStep = this._graphValStep();
            for (let v = Math.ceil(this.graphViewport.valMin/vStep)*vStep; v <= this.graphViewport.valMax; v += vStep) {
                const y = vToY(v);
                ctx.strokeStyle = "#181c2c"; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(cw-PAD.r, y); ctx.stroke();
                ctx.fillStyle = "#5a6a88"; ctx.font = "9px 'JetBrains Mono',monospace";
                ctx.fillText(v.toFixed(0), 2, y+3);
            }
            const zy = vToY(0);
            if (zy >= PAD.t && zy <= ch-PAD.b) {
                ctx.strokeStyle = "#2a3050"; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(PAD.l, zy); ctx.lineTo(cw-PAD.r, zy); ctx.stroke();
            }
        }

        // Border
        ctx.strokeStyle = "#252a42"; ctx.lineWidth = 1;
        ctx.strokeRect(PAD.l, PAD.t, T.vw, T.vh);

        // Current frame line
        const cfx = fToX(this.currentFrame);
        ctx.strokeStyle = "#5bc4ff"; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]); ctx.beginPath(); ctx.moveTo(cfx,PAD.t); ctx.lineTo(cfx,ch-PAD.b); ctx.stroke();
        ctx.setLineDash([]);

        const labels = this._graphLabels();
        if (labels.length === 0) {
            ctx.fillStyle = "#3a4a68"; ctx.font = "13px 'Inter',sans-serif"; ctx.textAlign = "center";
            ctx.fillText("Select a joint or camera channel in the dope sheet to see its curve", cw/2, ch/2);
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
            const isCam = this._isCamScalarLabel(label);

            for (const coord of isCam ? [0] : [0, 1]) {
                const show = isCam ? true : (coord === 0 ? this.graphShowX : this.graphShowY);
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
                    [0, this.graphShowX, "#ff6b6b"],
                    [1, this.graphShowY, "#50f0a0"],
                ]) {
                    if (!show) continue;
                    const val = applyNorm(ov[coord], label, coord);
                    const y = normalVToY(val);
                    const isCoordSel = this.graphSel.has(`${fi}::${label}::${coord}`);
                    ctx.fillStyle   = isCoordSel ? "#5bc4ff" : isCur ? "#f7c840" : dotColor;
                    ctx.strokeStyle = isCoordSel ? "#9adeff" : "#0a0c14"; ctx.lineWidth = isCoordSel ? 2 : 1.5;
                    ctx.setLineDash([]);
                    ctx.beginPath(); ctx.arc(x, y, isCur ? 6 : labels.length > 1 ? 3.5 : 4.5, 0, Math.PI*2);
                    ctx.fill(); ctx.stroke();
                }
            }
        }

        // Current frame badge (frame number on the cursor line)
        if (cfx >= PAD.l && cfx <= cw - PAD.r) {
            const badge = String(this.currentFrame);
            ctx.font = "bold 10px 'JetBrains Mono',monospace";
            const bw = ctx.measureText(badge).width + 8;
            const bh = 14, bx = cfx - bw/2, by = PAD.t - bh - 1;
            ctx.fillStyle = "#1a4870";
            ctx.beginPath(); ctx.roundRect?.(bx, by, bw, bh, 3); ctx.fill();
            ctx.fillStyle = "#5bc4ff"; ctx.textAlign = "center";
            ctx.fillText(badge, cfx, by + bh - 3);
            ctx.textAlign = "left";
        }

        // Normalize axis labels and grid lines
        if (this.normalizeGraph) {
            // Grid lines at -1, 0, +1
            ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
            ctx.strokeStyle = "rgba(91,196,255,0.25)";
            for (const v of [1, -1]) {
                ctx.beginPath(); ctx.moveTo(PAD.l, normalVToY(v)); ctx.lineTo(cw-PAD.r, normalVToY(v)); ctx.stroke();
            }
            ctx.strokeStyle = "rgba(91,196,255,0.45)";
            ctx.beginPath(); ctx.moveTo(PAD.l, normalVToY(0)); ctx.lineTo(cw-PAD.r, normalVToY(0)); ctx.stroke();
            ctx.setLineDash([]);
            // Axis labels
            ctx.font = "bold 10px 'JetBrains Mono',monospace"; ctx.textAlign = "right";
            ctx.fillStyle = "#5bc4ff"; ctx.fillText(" 1", PAD.l-2, normalVToY(1)+4);
            ctx.fillStyle = "#7ad4ff"; ctx.fillText(" 0", PAD.l-2, normalVToY(0)+4);
            ctx.fillStyle = "#5bc4ff"; ctx.fillText("-1", PAD.l-2, normalVToY(-1)+4);
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
                const { group: grp, index: ki } = _splitLabel(label);
                const pts = _grpPts(fd, grp);
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
                const isCamSel = this._isCamScalarLabel(label);
                for (const fi of this._getKeyframesForJoint(label)) {
                    const ov = this.overrides[fi]?.[label]; if (!ov) continue;
                    const x = T.fToX(fi);
                    const coordPairs = isCamSel ? [[0, true]] : [[0, this.graphShowX], [1, this.graphShowY]];
                    for (const [coord, show] of coordPairs) {
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
                    const { group: grp, index: ki } = _splitLabel(label);
                    const pts = _grpPts(fd, grp);
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
            background:"#0e1020", border:"1px solid #2c3352", borderRadius:"8px",
            padding:"18px 22px", maxWidth:"760px", width:"90%", maxHeight:"82vh",
            overflowY:"auto", color:"#b0bcd4", fontSize:"12px", lineHeight:"1.7",
            fontFamily:"'JetBrains Mono','Inter',monospace", boxShadow:"0 8px 40px rgba(0,0,0,0.8)",
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
            ["Layouts & Viewports", [
                ["⊡ 1 / ⊟ 2 / ⊞ 4",        "Switch panel layout (1, 2, or 4 viewports)"],
                ["Click panel header",   "Open view-picker dropdown (Front/Back/Top/Side/Orbit/Camera)"],
                ["Click inside panel",   "Make that panel the active one (blue accent border)"],
                ["F-badge (top-right)",   "Current frame / total frame count"],
                ["Axis gizmo (orbit)",    "Bottom-left X/Y/Z indicator — back axes dimmed"],
            ]],
            ["Viewport — Front / Back", [
                ["Drag joint",            "Move joint (Auto Key writes a keyframe)"],
                ["Shift+click joint",     "Add to multi-selection"],
                ["Ctrl+drag empty",       "Box-select joints"],
                ["RMB on joint",          "Disable / enable joint (confidence = 0)"],
                ["K",                     "Commit keyframe (when Auto Key is OFF)"],
                ["Scroll",                "Zoom in / out"],
                ["Middle / Alt-drag",     "Pan canvas"],
                ["Dbl-click",             "Reset zoom and pan"],
            ]],
            ["Viewport — Top / Side", [
                ["Drag joint horizontal", "Top: pose X | Side: Z-depth"],
                ["Drag joint vertical",   "Top: Z-depth | Side: pose Y"],
                ["Scroll",                "Zoom"],
                ["Middle / Alt-drag",     "Pan"],
            ]],
            ["Viewport — Orbit (3D)", [
                ["Drag empty",            "Rotate (orbit yaw/pitch)"],
                ["Drag joint",            "Move joint freely in camera-screen space"],
                ["Scroll",                "Zoom"],
                ["Middle-drag",           "Pan"],
                ["Axis gizmo bubbles",    "X = red, Y = green, Z = blue (world axes)"],
            ]],
            ["Viewport — Camera", [
                ["Click ◎ Camera",       "Add a scene camera (creates KFs for X/Y/Z/Roll/Tilt/Pan/FOV)"],
                ["Drag camera aim",       "Reposition camera target in front/top/side views"],
                ["Lock to View",          "Edit camera by orbiting in the camera viewport"],
                ["cam_z slider",          "Pull camera closer / further"],
                ["cam_fov slider",        "Wider / tighter lens"],
            ]],
            ["Pose Groups", [
                ["Body (20 joints)",      "OpenPose 18 + 2 toes — colored by side (R red/blue, L green/magenta)"],
                ["R Hand (21 joints)",    "Right hand fingers, orange (#ff6400)"],
                ["L Hand (21 joints)",    "Left hand fingers, green (#64c800)"],
                ["Face (70 joints)",      "300W landmarks, yellow (#ffd44c) — toggle in Face group eye icon"],
                ["NLF Body (18 joints)",  "SMPL 3D joints (NLF mode only) — purple, fully keyframable"],
                ["IK / FK on hand",       "IK: fingers follow wrist  ·  FK: independent finger joints"],
            ]],
            ["DWPose / NLF Modes", [
                ["Tab: DWPose",           "Dope Sheet + Graph Editor show DWPose body / hands / face"],
                ["Tab: NLF",              "Dope Sheet + Graph Editor switch to 18 SMPL joints (NLF only)"],
                ["📊 Edit NLF Data",      "Sidebar shortcut to jump straight into NLF mode"],
                ["NLF availability",      "NLF tab is active only if an NLF model was selected on the Extractor"],
            ]],
            ["Ref Frame", [
                ["⊕ Ref Frame",          "Capture clean front-view snapshot of frame 0 (camera-immune)"],
                ["Edit in Ref mode",      "Fix badly detected joints without camera distortion"],
                ["✕ Exit Ref Frame",      "Return to the main sequence"],
                ["Apply",                 "Save Ref Frame fixes back through the workflow"],
                ["Retargeter side",       "Set Reference Source = Ref Frame for clean slider calibration"],
            ]],
            ["Reference Card", [
                ["🖼 Image",              "Load a still image as the underlay"],
                ["🎬 Video",              "Load a video file (syncs to the timeline)"],
                ["🎞 Seq",               "Load an image sequence (multi-select in file picker)"],
                ["Offset",                "Per-frame offset between reference and pose data"],
                ["× Clear",              "Remove the current reference"],
                ["👁 Reference: ON/OFF", "Toggle visibility of the underlay"],
            ]],
            ["Output Canvas", [
                ["W × H fields",         "Show effective output size (input dims by default)"],
                ["Input preset",          "Revert to the input pose dimensions"],
                ["Size presets",          "512 / 768 / 1024 / 768×1024 / 1024×768 / 1280×720"],
                ["Effect",                "Sets pose_data dims; drives camera intrinsic K (cx, cy, focal)"],
            ]],
            ["3D Depth (Experimental)", [
                ["⬡ Turn to 3D",         "Auto-switches to 4 viewports + camera; enables NLF overlay"],
                ["DWPose Opacity",        "Fade DWPose skeleton to compare against NLF"],
                ["NLF Overlay Opacity",   "Show / hide NLF 3D ghost (purple)"],
                ["3D Bone Radius",        "Cylinder thickness in 3D orbit / camera views"],
                ["⬇ Bake Z Depth",       "Write NLF Z into all body keyframes (XY untouched)"],
                ["⬆ Unbake Z Depth",     "Clear baked Z depth from all keyframes"],
            ]],
            ["Project / Scene", [
                ["File → New Scene",      "Blank T-pose scene; checkbox adds default 70-pt face"],
                ["File → Edit Project",   "Change W/H/frames/FPS without losing keyframes"],
                ["＋ Add → Hand",         "Synthesised hand pose at the wrist"],
                ["＋ Add → Camera",       "Adds the ◎ Camera group with full keyframable rig"],
                ["💾 Save",              "Download editor state (overrides + Z + tweens + Ref Frame) to .json"],
                ["📂 Load",              "Restore a previously saved .json project file"],
                ["Apply",                 "Write all edits back through the workflow"],
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
        let html = `<div style="font-size:14px;font-weight:700;color:#d4ddf4;margin-bottom:12px;border-bottom:1px solid #2c3352;padding-bottom:8px;letter-spacing:0.04em;">
            Magos Pose Editor — Help &amp; Shortcuts</div>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">`;
        for (const [sectionTitle, entries] of sections) {
            html += `<div style="margin-bottom:10px;"><div style="color:#5bc4ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${sectionTitle}</div>`;
            html += `<table style="width:100%;border-collapse:collapse;">`;
            for (const [key, desc] of entries) {
                html += `<tr><td style="color:#f7c840;padding:1px 6px 1px 0;white-space:nowrap;">${key}</td><td style="color:#a0b0c8;">${desc}</td></tr>`;
            }
            html += `</table></div>`;
        }
        html += `</div>`;
        // Keyframe icon legend
        html += `<div style="margin-top:12px;border-top:1px solid #2c3352;padding-top:10px;">`;
        html += `<div style="color:#5bc4ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Keyframe Icon Legend</div>`;
        html += `<div style="display:flex;gap:18px;flex-wrap:wrap;">`;
        const legendItems = [
            ['◆', '#ffd700', 'Linear — constant speed'],
            ['●', '#ffd700', 'Smooth (Catmull-Rom / Bezier)'],
            ['■', '#ffd700', 'Hold / Constant (instant jump)'],
            ['⧫', '#ffd700', 'Ease — slow in &amp; slow out (hourglass)'],
            ['◑', '#ffd700', 'Split — different in/out interpolation'],
        ];
        for (const [icon, color, desc] of legendItems) {
            html += `<span style="white-space:nowrap;"><span style="color:${color};font-size:14px;">${icon}</span> <span style="color:#8898b8;font-size:11px;">${desc}</span></span>`;
        }
        html += `</div></div>`;
        html += `<div style="text-align:right;margin-top:14px;"><button id="_twHelpClose" style="background:#1d2138;border:1px solid #2c3352;color:#b0bcd4;padding:5px 18px;border-radius:4px;cursor:pointer;font-size:12px;">Close  [Escape / F1]</button></div>`;
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
        if (idx !== this.currentFrame) this._logAction("scrub", { from: this.currentFrame, to: idx });

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
        this._updateSidebarValues();
        if (this.activeTab === "graph") this._renderGraphEditor();
    }

    _updateDetailPanels() {
        const fi = this.currentFrame;
        const fd = this._getEffectiveFrame(fi);
        if (this._detailInputs && Object.keys(this._detailInputs).length > 0) {
            for (const [label, inputs] of Object.entries(this._detailInputs)) {
                const { group, index } = _splitLabel(label);
                const grpPts = _grpPts(fd, group);
                const pt = grpPts?.[index] ?? [0, 0, 1];
                if (inputs.xInp    && document.activeElement !== inputs.xInp)    inputs.xInp.value    = pt[0].toFixed(1);
                if (inputs.yInp    && document.activeElement !== inputs.yInp)    inputs.yInp.value    = pt[1].toFixed(1);
                if (inputs.confInp && document.activeElement !== inputs.confInp) inputs.confInp.value = ((pt[2] ?? 1) * 100).toFixed(0);
                if (inputs.zInp    && document.activeElement !== inputs.zInp) {
                    inputs.zInp.value = (pt[3] ?? 0).toFixed(3);
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
        this._preRotZ = null;
        this._moveGizmoPos = null;  // reset each frame; front views re-set it if joint selected
        const cw = this.canvas.width, ch = this.canvas.height;
        if (!cw||!ch) return;
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0,0,cw,ch); ctx.fillStyle="#08080f"; ctx.fillRect(0,0,cw,ch);
        this.gizmoCenter = null;

        const panelRects = this._getPanelRects(cw, ch);
        const n = panelRects.length;
        for (let i = 0; i < n; i++) {
            const r = panelRects[i];
            const view = this._panelViews[i] ?? "front";
            const contentH = r.h - PANEL_HEADER_H;
            const contentW = r.w;

            // Draw panel header
            this._drawPanelHeader(ctx, i, r, view);

            // Render view content in clipped region
            this._loadPanelState(i);
            const savedCamView = this.cameraView;
            this.cameraView = view;   // let _renderFrontView know which view mode is active
            ctx.save();
            ctx.beginPath(); ctx.rect(r.x, r.y + PANEL_HEADER_H, contentW, contentH); ctx.clip();
            ctx.translate(r.x, r.y + PANEL_HEADER_H);

            switch (view) {
                case "orbit":  this._renderOrbitView(ctx, idx, contentW, contentH); break;
                case "top":    this._renderOrthoView(ctx, idx, contentW, contentH, "top"); break;
                case "side":   this._renderOrthoView(ctx, idx, contentW, contentH, "side"); break;
                case "back":   this._renderBackView(ctx, idx, contentW, contentH); break;
                case "camera": this._renderCameraView(ctx, idx, contentW, contentH); break;
                default:       this._renderFrontView(ctx, idx, contentW, contentH, 0, 0); break;
            }

            // Promote gizmoCenter to full canvas coords (was in local content coords)
            if (this.gizmoCenter) {
                this.gizmoCenter.x += r.x;
                this.gizmoCenter.y += r.y + PANEL_HEADER_H;
            }
            ctx.restore();
            this.cameraView = savedCamView;
        }

        // Restore active-panel state — the loop leaves this.orbitZoom etc. set to panel[n-1]
        if (n > 1) this._loadPanelState(this._activePanel);

        // Draw panel dividers
        if (n > 1) {
            ctx.strokeStyle = "#2c3352"; ctx.lineWidth = 1;
            const vx = panelRects[1].x;
            ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx, ch); ctx.stroke();
            if (n === 4) {
                const hy = panelRects[2].y;
                ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(cw, hy); ctx.stroke();
            }
        }

        // Per-panel overlays: frame badge + active-panel accent border
        for (let i = 0; i < n; i++) {
            const r = panelRects[i];
            this._drawFrameBadge(ctx, r, idx);
            if (i === this._activePanel && n > 1) this._drawActivePanelBorder(ctx, r);
        }
    }

    _drawFrameBadge(ctx, r, idx) {
        const total = Math.max(0, this.frameCount - 1);
        const txt = `F ${idx} / ${total}`;
        ctx.save();
        ctx.font = "bold 10px 'JetBrains Mono',monospace";
        const w = ctx.measureText(txt).width + 12;
        const x = r.x + r.w - w - 6, y = r.y + PANEL_HEADER_H + 6;
        ctx.fillStyle = "rgba(6,8,18,0.78)";
        ctx.fillRect(x, y, w, 16);
        ctx.strokeStyle = "rgba(91,196,255,0.3)"; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 15);
        ctx.fillStyle = "#7ac8f0";
        ctx.textBaseline = "middle"; ctx.textAlign = "center";
        ctx.fillText(txt, x + w / 2, y + 8);
        ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        ctx.restore();
    }

    _drawActivePanelBorder(ctx, r) {
        ctx.save();
        ctx.strokeStyle = "#5a8cff"; ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        ctx.restore();
    }

    _getFrontTransform(vW, vH) {
        const base = Math.min(vW / this.poseW, vH / this.poseH) * 0.95;
        const sx = base * this.vpZoom, sy = sx;
        const ox = (vW - this.poseW * sx) / 2 + this.vpPanX;
        const oy = (vH - this.poseH * sy) / 2 + this.vpPanY;
        return { sx, sy, ox, oy };
    }

    // ── Grid / gizmo helpers ─────────────────────────────────────────────────

    /** Draw a 10×10 normalised grid over a 2D view canvas region. */
    _drawViewGrid(ctx, aox, aoy, pW, pH) {
        ctx.save();
        ctx.strokeStyle = "rgba(80,105,150,0.22)";
        ctx.lineWidth = 0.5;
        const DIVS = 10;
        for (let i = 1; i < DIVS; i++) {
            const x = aox + (i / DIVS) * pW;
            ctx.beginPath(); ctx.moveTo(x, aoy); ctx.lineTo(x, aoy + pH); ctx.stroke();
            const y = aoy + (i / DIVS) * pH;
            ctx.beginPath(); ctx.moveTo(aox, y); ctx.lineTo(aox + pW, y); ctx.stroke();
        }
        // Bright centre cross
        ctx.strokeStyle = "rgba(110,140,200,0.38)"; ctx.lineWidth = 1;
        const midX = aox + pW / 2, midY = aoy + pH / 2;
        ctx.beginPath(); ctx.moveTo(midX, aoy); ctx.lineTo(midX, aoy + pH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(aox, midY); ctx.lineTo(aox + pW, midY); ctx.stroke();
        ctx.restore();
    }

    /** Draw XY translation gizmo arrows at canvas position (cx, cy). */
    _drawMoveGizmo(ctx, cx, cy) {
        const LEN = 44, HEAD = 9;
        ctx.save();
        ctx.lineWidth = 2;
        // X axis — red → right
        ctx.strokeStyle = "#ee3333"; ctx.fillStyle = "#ee3333";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + LEN, cy); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + LEN + HEAD, cy);
        ctx.lineTo(cx + LEN, cy - HEAD / 2);
        ctx.lineTo(cx + LEN, cy + HEAD / 2);
        ctx.closePath(); ctx.fill();
        // Y axis — green ↑ up
        ctx.strokeStyle = "#33ee33"; ctx.fillStyle = "#33ee33";
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - LEN); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy - LEN - HEAD);
        ctx.lineTo(cx - HEAD / 2, cy - LEN);
        ctx.lineTo(cx + HEAD / 2, cy - LEN);
        ctx.closePath(); ctx.fill();
        // Centre square
        ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 0.7;
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
        ctx.restore();
    }

    /** Return "x", "y", or null depending on which gizmo arrow the pointer is over. */
    _hitTestMoveGizmo(lx, ly) {
        if (!this._moveGizmoPos || !this.selectedJoint) return null;
        const { cx, cy } = this._moveGizmoPos;
        const LEN = 44, HEAD = 9, RAD = 13;
        if (Math.abs(lx - (cx + LEN + HEAD / 2)) < RAD && Math.abs(ly - cy) < RAD) return "x";
        if (Math.abs(lx - cx) < RAD && Math.abs(ly - (cy - LEN - HEAD / 2)) < RAD) return "y";
        return null;
    }

    _renderFrontView(ctx, idx, vW, vH, offX, offY) {
        const { sx,sy,ox,oy } = this._getFrontTransform(vW, vH);
        const aox=offX+ox, aoy=offY+oy;
        // Ghost region: fill entire viewport so user can see where the canvas edges are
        if (this.vpZoom > 1.05) {
            ctx.fillStyle="#08080f"; ctx.fillRect(offX, offY, vW, vH);
        }

        ctx.fillStyle="#0e1020"; ctx.fillRect(aox,aoy,this.poseW*sx,this.poseH*sy);
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
        this._drawViewGrid(ctx, aox, aoy, this.poseW * sx, this.poseH * sy);
        const dwAlpha = this._experimentalMode ? this._dwposeAlpha : 1;
        if (dwAlpha < 1) { ctx.save(); ctx.globalAlpha = dwAlpha; }
        this._drawSkeleton(ctx, idx, sx, sy, aox, aoy);
        if (dwAlpha < 1) ctx.restore();
        // Move gizmo for selected joint — rendered on top of skeleton
        if (this.selectedJoint) {
            const _fgd = this._getEffectiveFrame(idx);
            const { group: _gg, index: _gi } = this.selectedJoint;
            const _gPts = _grpPts(_fgd, _gg);
            const _gPt  = _gPts?.[_gi];
            if (_gPt && (_gPt[2] ?? 1) >= 0.01) {
                const _gc = this._poseToCanvas(_gPt[0], _gPt[1], sx, sy, aox, aoy);
                this._moveGizmoPos = { cx: _gc.x, cy: _gc.y };
                this._drawMoveGizmo(ctx, _gc.x, _gc.y);
            }
        }
        if (this._experimentalMode && this._nlfAlpha > 0 && this._nlfData) {
            this._drawNlfOverlay(ctx, idx, sx, sy, aox, aoy, this._nlfAlpha);
        }
        // Camera motion path + 2D gizmo — shown in front/back/top/side views
        if (this._hasCameraKeyframes()) {
            this._drawCameraPath(ctx, (nx, ny) => ({ x: aox + nx * this.poseW * sx, y: aoy + ny * this.poseH * sy }));
            this._drawCamera2DGizmo(ctx, idx, sx, sy, aox, aoy, offX, offY, vW, vH);
        }
        // Zoom level indicator
        if (this.vpZoom !== 1.0 || this.vpPanX !== 0 || this.vpPanY !== 0) {
            ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(offX+3, offY+vH-18, 130, 14);
            ctx.fillStyle = "#5a7a9a"; ctx.font = "9px 'JetBrains Mono',monospace";
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

    // -----------------------------------------------------------------------
    // Back view — front mirrored on X
    // -----------------------------------------------------------------------
    _renderBackView(ctx, idx, vW, vH) {
        ctx.save();
        ctx.translate(vW, 0); ctx.scale(-1, 1);
        this._renderFrontView(ctx, idx, vW, vH, 0, 0);
        ctx.restore();
        ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(2,2,54,14);
        ctx.fillStyle="#5a7a9a"; ctx.font="bold 9px 'JetBrains Mono',monospace"; ctx.fillText("BACK VIEW",5,13);
    }

    // -----------------------------------------------------------------------
    // Camera view — orbit view driven by cam_pan / cam_tilt / cam_z KFs
    // -----------------------------------------------------------------------
    _renderCameraView(ctx, idx, vW, vH) {
        const cam = this._getInterpolatedCamera(idx);
        // Apply live preview (pan/tilt from orbit drag, x/y from shift-drag or aim drag)
        if (this._camLockPreview) {
            if (this._camLockPreview.pan  !== undefined) cam.pan  = this._camLockPreview.pan;
            if (this._camLockPreview.tilt !== undefined) cam.tilt = this._camLockPreview.tilt;
            if (this._camLockPreview.x    !== undefined) cam.x    = this._camLockPreview.x;
            if (this._camLockPreview.y    !== undefined) cam.y    = this._camLockPreview.y;
        }
        const savedYaw = this.orbitYaw, savedPitch = this.orbitPitch, savedZoom = this.orbitZoom;
        this.orbitYaw   = cam.pan;
        this.orbitPitch = cam.tilt;
        // FOV affects apparent zoom: 60° = 1×, telephoto (lower FOV) = more zoom
        const fovZoom = Math.tan(30 * Math.PI / 180) / Math.tan(Math.max(1, cam.fov) / 2 * Math.PI / 180);
        this.orbitZoom  = Math.max(0.01, cam.z * fovZoom);

        // Shift orbit center so cam.x/y aim point appears at screen center (like a real camera target)
        const M = this._getOrbitMatrix();
        const orbitScale = Math.min(vW / this.poseW, vH / this.poseH) * 0.82 * this.orbitZoom;
        this._orbitCenterOffset = {
            x: -(M.m00 * cam.x * this.poseW + M.m10 * cam.y * this.poseH) * orbitScale,
            y: -(M.m01 * cam.x * this.poseW + M.m11 * cam.y * this.poseH) * orbitScale,
        };
        const rollRad = cam.roll * Math.PI / 180;
        if (rollRad !== 0) { ctx.save(); ctx.translate(vW/2, vH/2); ctx.rotate(rollRad); ctx.translate(-vW/2, -vH/2); }
        this._renderOrbitView(ctx, idx, vW, vH);
        if (rollRad !== 0) ctx.restore();
        this._orbitCenterOffset = null;
        this.orbitYaw   = savedYaw;
        this.orbitPitch = savedPitch;
        this.orbitZoom  = savedZoom;

        // Camera frame border — follows letterbox rect when output aspect is set
        const lb = this._threeOrbit?._lastLetterbox;
        const bx = lb ? lb.x + 1 : 2,  by = lb ? lb.y + 1 : 2;
        const bw = lb ? lb.w - 2 : vW - 4, bh = lb ? lb.h - 2 : vH - 4;
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 2; ctx.setLineDash([6,3]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(bx + 1, by + 1, 108, 14);
        ctx.fillStyle = "#cc8800"; ctx.font = "bold 9px 'JetBrains Mono',monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText("◎ CAMERA VIEW", bx + 4, by + 2);
        ctx.textBaseline = "alphabetic";

        // Lock Camera to View button (anchored to letterbox bottom-left)
        const btnW = 140, btnH = 16, btnX = bx + 1, btnY = by + bh - 19;
        ctx.fillStyle = this._camLocked ? "rgba(20,80,180,0.85)" : "rgba(0,0,0,0.65)";
        ctx.fillRect(btnX, btnY, btnW, btnH);
        ctx.strokeStyle = this._camLocked ? "#44aaff" : "#445";
        ctx.lineWidth = 1; ctx.strokeRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = this._camLocked ? "#aaddff" : "#88aacc";
        ctx.font = "bold 9px 'JetBrains Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(this._camLocked ? "Lock Cam to View: ON" : "Lock Cam to View: OFF", btnX + 4, btnY + 3);
        ctx.textBaseline = "alphabetic";
        this._camLockBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };

        // Ortho / Perspective toggle (right of lock button)
        const orthW = 110, orthH = 16, orthX = btnX + btnW + 2, orthY = btnY;
        ctx.fillStyle = this._camOrtho ? "rgba(20,80,40,0.85)" : "rgba(60,20,20,0.85)";
        ctx.fillRect(orthX, orthY, orthW, orthH);
        ctx.strokeStyle = this._camOrtho ? "#44cc88" : "#cc6644";
        ctx.lineWidth = 1; ctx.strokeRect(orthX, orthY, orthW, orthH);
        ctx.fillStyle = this._camOrtho ? "#88ffcc" : "#ffaa88";
        ctx.font = "bold 9px 'JetBrains Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(this._camOrtho ? "⊡ Orthographic" : "⊙ Perspective", orthX + 4, orthY + 3);
        ctx.textBaseline = "alphabetic";
        this._camOrthoBtnRect = { x: orthX, y: orthY, w: orthW, h: orthH };

        // Hint when locked
        if (this._camLocked) {
            ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(bx + 1, btnY - 17, 180, 14);
            ctx.fillStyle = "#5a90c0"; ctx.font = "9px 'JetBrains Mono',monospace";
            ctx.textAlign = "left"; ctx.textBaseline = "top";
            ctx.fillText("Drag=orbit  Shift+drag=pan  Scroll=dolly  FOV=dope", bx + 4, btnY - 15);
            ctx.textBaseline = "alphabetic";
        }
    }

    // Simple 2D camera icon drawn in front / back / top / side views
    _drawCamera2DGizmo(ctx, idx, sx, sy, aox, aoy, offX, offY, vW, vH) {
        const cam = this._getInterpolatedCamera(idx);
        // Aim point in canvas coords (cam.x/y are normalised offsets from centre)
        const aimX = aox + (0.5 + cam.x) * this.poseW * sx;
        const aimY = aoy + (0.5 + cam.y) * this.poseH * sy;
        ctx.save();
        ctx.globalAlpha = 0.75;
        // Crosshair at aim point
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1; ctx.setLineDash([3,2]);
        ctx.beginPath();
        ctx.moveTo(aimX - 10, aimY); ctx.lineTo(aimX + 10, aimY);
        ctx.moveTo(aimX, aimY - 10); ctx.lineTo(aimX, aimY + 10);
        ctx.stroke(); ctx.setLineDash([]);
        // Small circle
        ctx.strokeStyle = "#ffcc44"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(aimX, aimY, 5, 0, Math.PI * 2); ctx.stroke();
        // Label
        ctx.fillStyle = "#cc8800"; ctx.font = "bold 8px monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText("◎ CAM", aimX + 7, aimY - 4);
        ctx.textBaseline = "alphabetic";
        ctx.restore();
    }

    // Camera flight-path spline drawn in all views except camera view.
    // project2D(normX, normY) → {x, y} in canvas coords, or null to skip point.
    _drawCameraPath(ctx, project2D) {
        const kfFrames = Object.keys(this.overrides)
            .map(Number).sort((a, b) => a - b)
            .filter(fi => "cam_x" in this.overrides[fi] || "cam_pan" in this.overrides[fi]);
        if (kfFrames.length < 2) return;

        // Sample the interpolated path at ~20 steps per segment
        const STEPS = 20;
        const span  = kfFrames[kfFrames.length - 1] - kfFrames[0];
        const step  = Math.max(1, span / (kfFrames.length * STEPS));
        const pts   = [];
        for (let fi = kfFrames[0]; fi <= kfFrames[kfFrames.length - 1] + 0.5; fi += step) {
            const cam = this._getInterpolatedCamera(Math.round(Math.min(fi, kfFrames[kfFrames.length - 1])));
            const p   = project2D(0.5 + cam.x, 0.5 + cam.y);
            if (p) pts.push(p);
        }

        ctx.save();
        ctx.strokeStyle = "rgba(255,160,40,0.55)";
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();

        // Dots at actual KF positions
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffaa28";
        kfFrames.forEach(fi => {
            const cam = this._getInterpolatedCamera(fi);
            const p   = project2D(0.5 + cam.x, 0.5 + cam.y);
            if (!p) return;
            ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Top / Side orthographic views
    // -----------------------------------------------------------------------
    _renderTopView(ctx, idx, vW, vH) {
        this._renderOrthoView(ctx, idx, vW, vH, "top");
    }
    _renderSideView(ctx, idx, vW, vH) {
        this._renderOrthoView(ctx, idx, vW, vH, "side");
    }

    _renderOrthoView(ctx, idx, vW, vH, axis) {
        ctx.fillStyle = "#0d0d1a"; ctx.fillRect(0, 0, vW, vH);

        const fd = this._getEffectiveFrame(idx); if (!fd) return;
        if (ROTATION_ENABLED) this._applyWristRotations(fd, idx);
        const body = fd.body || [];

        // Zoom/pan from panel state (loaded by _renderFrame before calling this)
        const MARGIN = 0.10;
        const scale  = Math.min(vW, vH) * (1 - MARGIN * 2) * this.vpZoom;
        const cx     = vW / 2 + this.vpPanX;
        const cy     = vH / 2 + this.vpPanY;
        const Z_RANGE = 1.5;

        const pW = this.poseW, pH = this.poseH;
        const toScreen = (jx, jy, jz) => {
            if (axis === "top") {
                return { x: cx + (jx / pW - 0.5) * scale, y: cy + jz / Z_RANGE * (scale * 0.5) };
            } else {
                return { x: cx - jz / Z_RANGE * (scale * 0.5), y: cy + (jy / pH - 0.5) * scale };
            }
        };

        // Grid lines
        ctx.strokeStyle = "#1e2a3a"; ctx.lineWidth = 1;
        for (let t = -1; t <= 1; t += 0.25) {
            const off = t / Z_RANGE * (scale * 0.5);
            if (axis === "top") {
                ctx.beginPath(); ctx.moveTo(0, cy + off); ctx.lineTo(vW, cy + off); ctx.stroke();
            } else {
                ctx.beginPath(); ctx.moveTo(cx + off, 0); ctx.lineTo(cx + off, vH); ctx.stroke();
            }
        }
        ctx.strokeStyle = "#2a3a5a"; ctx.lineWidth = 1.5;
        if (axis === "top") { ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(vW,cy); ctx.stroke(); }
        else                { ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,vH); ctx.stroke(); }

        // DWPose body bones
        const bodyGrpVis = !this.hiddenGroups.has("body");
        if (bodyGrpVis) {
            for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                const [a, b] = BODY_CONNECTIONS[i];
                if (!body[a] || !body[b]) continue;
                const boneAlpha = this._showAll ? 1 : Math.min(body[a][2]??1, body[b][2]??1);
                if (boneAlpha < 0.01) continue;
                const za = body[a][3] ?? 0;
                const zb = body[b][3] ?? 0;
                const pa = toScreen(body[a][0], body[a][1], za);
                const pb = toScreen(body[b][0], body[b][1], zb);
                ctx.globalAlpha = boneAlpha;
                ctx.strokeStyle = BONE_COLORS[i] || "#aaa"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
            }
            ctx.globalAlpha = 1;
            for (let i = 0; i < body.length; i++) {
                const pt = body[i]; if (!pt) continue;
                const alpha = this._showAll ? 1 : (pt[2]??1);
                if (alpha < 0.01) continue;
                const label = `body_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const p = toScreen(pt[0], pt[1], pt[3] ?? 0);
                ctx.globalAlpha = alpha;
                const isSelected = this.selectedJoints.has(label);
                ctx.fillStyle = JOINT_COLORS[i] || "#fff";
                ctx.beginPath(); ctx.arc(p.x, p.y, isSelected ? 6 : 4, 0, Math.PI*2); ctx.fill();
                if (isSelected) {
                    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI*2); ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
        }

        // DWPose hands in ortho view (use wrist Z for all hand joints)
        for (const [side, kps, wristIdx] of [["rhand",fd.rhand,R_WRIST],["lhand",fd.lhand,L_WRIST]]) {
            if (!kps || this.hiddenGroups.has(side)) continue;
            const wristZ = body[wristIdx]?.[3] ?? 0;
            ctx.strokeStyle = side === "rhand" ? "#8844ff" : "#44aaff"; ctx.lineWidth = 1;
            for (const [a, b] of HAND_CONNECTIONS) {
                if (!kps[a] || !kps[b]) continue;
                const pa = toScreen(kps[a][0], kps[a][1], wristZ);
                const pb = toScreen(kps[b][0], kps[b][1], wristZ);
                ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
            }
            ctx.fillStyle = side === "rhand" ? "#aa66ff" : "#66ccff";
            for (let i = 0; i < kps.length; i++) {
                if (!kps[i]) continue;
                const p = toScreen(kps[i][0], kps[i][1], wristZ);
                ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2); ctx.fill();
            }
        }

        // Face landmarks — anchor Z to nose (body[0]) when per-point Z is unset
        if (fd.face && !this.hiddenGroups.has("face")) {
            const headZ = body[0]?.[3] ?? 0;
            ctx.fillStyle = FACE_COLOR;
            for (let i = 0; i < fd.face.length; i++) {
                const pt = fd.face[i]; if (!pt) continue;
                const conf = this._showAll ? 1 : (pt[2] ?? 1);
                if (conf < 0.01) continue;
                const label = `face_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const p = toScreen(pt[0], pt[1], pt[3] ?? headZ);
                ctx.globalAlpha = conf;
                const isSel = this.selectedJoints.has(label);
                ctx.beginPath(); ctx.arc(p.x, p.y, isSel ? 3.5 : 1.8, 0, Math.PI*2); ctx.fill();
                if (isSel) {
                    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI*2); ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
        }

        // NLF overlay in ortho — use effective nlf_body so edits show up
        if (this._experimentalMode && this._nlfAlpha > 0 && this._nlfData) {
            const efd = this._getEffectiveFrame(idx);
            const nlf = efd?.nlf_body;
            if (nlf?.length) {
                const valid = (pt) => pt && isFinite(pt[0]) && isFinite(pt[1]) && (pt[2] ?? 0) > 0.05;
                ctx.save(); ctx.globalAlpha = this._nlfAlpha * 0.85;
                ctx.strokeStyle = NLF_BODY_COLOR; ctx.lineWidth = 1.6;
                for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                    const [a, b] = BODY_CONNECTIONS[i];
                    if (a >= nlf.length || b >= nlf.length) continue;
                    if (!valid(nlf[a]) || !valid(nlf[b])) continue;
                    const sa = toScreen(nlf[a][0], nlf[a][1], nlf[a][3] ?? 0);
                    const sb = toScreen(nlf[b][0], nlf[b][1], nlf[b][3] ?? 0);
                    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
                }
                ctx.fillStyle = NLF_BODY_COLOR;
                const ovr = this.overrides[idx] || {};
                const sel = this.selectedNlfJoint;
                for (let i = 0; i < nlf.length; i++) {
                    const pt = nlf[i]; if (!valid(pt)) continue;
                    const p = toScreen(pt[0], pt[1], pt[3] ?? 0);
                    const isKf = ovr[`nlf_body_${i}`] !== undefined;
                    const isSel = sel && sel.group === "nlf_body" && sel.index === i;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, isSel ? 4.5 : (isKf ? 3.5 : 2.5), 0, Math.PI * 2);
                    ctx.fill();
                    if (isSel) {
                        ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 1.5;
                        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
                        ctx.strokeStyle = NLF_BODY_COLOR;
                    }
                }
                ctx.restore();
            }
        }

        // Camera motion path + gizmo in ortho views
        if (this._hasCameraKeyframes()) {
            this._drawCameraPath(ctx, (nx, ny) => toScreen(nx, ny, 0));
            const cam = this._getInterpolatedCamera(idx);
            // Camera body sits in front of the scene (positive Z = closer in ortho view)
            const camDepth = +Math.min(1.0, cam.z * 0.65);
            // Camera body position depends on which axes this view shows
            const camBodyPt = axis === "top"
                ? toScreen(0.5 + cam.x, 0.5,         camDepth)   // top: X + Z-depth
                : toScreen(0.5,         0.5 + cam.y,  camDepth);  // side: Y + Z-depth
            const camAimPt = toScreen(0.5 + cam.x, 0.5 + cam.y, 0);
            ctx.save();
            ctx.globalAlpha = 0.8;
            // Line from camera body to aim point
            ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
            ctx.beginPath(); ctx.moveTo(camBodyPt.x, camBodyPt.y); ctx.lineTo(camAimPt.x, camAimPt.y); ctx.stroke();
            ctx.setLineDash([]);
            // Aim-point crosshair
            ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(camAimPt.x - 8, camAimPt.y); ctx.lineTo(camAimPt.x + 8, camAimPt.y);
            ctx.moveTo(camAimPt.x, camAimPt.y - 8); ctx.lineTo(camAimPt.x, camAimPt.y + 8);
            ctx.stroke();
            // Camera body icon
            ctx.strokeStyle = "#ffcc44"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(camBodyPt.x, camBodyPt.y, 5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = "#ffcc44"; ctx.font = "bold 8px monospace";
            ctx.textAlign = "left"; ctx.textBaseline = "top";
            ctx.fillText("◎ CAM", camBodyPt.x + 7, camBodyPt.y - 4);
            ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
            ctx.restore();
        }

        // Axis labels
        ctx.fillStyle = "#3a5a7a"; ctx.font = "10px 'JetBrains Mono',monospace";
        if (axis === "top") {
            ctx.fillText("→ X",  vW - 22, cy - 4);
            ctx.fillText("↓ Z",  cx + 4,  18);
        } else {
            ctx.fillText("← Z →", cx - 18, 14);
            ctx.fillText("↓ Y",   4, cy + 12);
        }
        // Selected-joint gizmo — use the same toScreen projection so it sits on the joint
        if (this.selectedJoint) {
            const sj = this.selectedJoint;
            const gPts = _grpPts(fd, sj.group);
            const pt = gPts?.[sj.index];
            if (pt && (pt[2] ?? 1) >= 0.01) {
                const headZ = (body[0]?.[3] ?? 0);
                const fallbackZ = sj.group === "face" ? headZ
                                : sj.group === "rhand" ? (body[R_WRIST]?.[3] ?? 0)
                                : sj.group === "lhand" ? (body[L_WRIST]?.[3] ?? 0)
                                : 0;
                const z = pt[3] ?? fallbackZ;
                const p = toScreen(pt[0], pt[1], z);
                this._drawMoveGizmo(ctx, p.x, p.y);
            }
        }

        // Zoom hint
        ctx.fillStyle = "#334"; ctx.font = "10px sans-serif";
        ctx.fillText("Scroll=zoom · Alt+drag=pan · Click joint=edit", 6, vH - 6);
    }

    _applyWristRotations(fd, idx) {
        // Z-axis rotation only — XY coords are rotated, z depth is unchanged.
        if (!this._preRotZ) this._preRotZ = {};

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

    // -----------------------------------------------------------------------
    // Camera system
    // -----------------------------------------------------------------------
    _getInterpolatedCamera(fi) {
        const get = (label, def) => {
            // Exact frame takes priority — _interpolateJoint searches fi-1/fi+1, missing the exact KF
            if (this.overrides[fi]?.[label] !== undefined) return this.overrides[fi][label][0];
            const v = this._interpolateJoint(label, fi);
            return v ? v[0] : def;
        };
        return {
            x:    get("cam_x",    0),
            y:    get("cam_y",    0),
            z:    get("cam_z",    1.0),
            roll: get("cam_roll", 0),
            tilt: get("cam_tilt", 0),
            pan:  get("cam_pan",  0),
            fov:  get("cam_fov",  60),
        };
    }

    _hasCameraKeyframes() {
        for (const ov of Object.values(this.overrides))
            if ("cam_x" in ov || "cam_y" in ov || "cam_z" in ov ||
                "cam_roll" in ov || "cam_tilt" in ov || "cam_pan" in ov || "cam_fov" in ov) return true;
        return false;
    }

    /** Called by "+ Camera" in Add menu — creates default KFs at frame 0 and opens dope sheet. */
    _addCamera() {
        if (!this.overrides[0]) this.overrides[0] = {};
        const ov = this.overrides[0];
        // cam_z = 1/0.82 ≈ 1.220 → orbitZoom = 1.220, scale = 0.82 * 1.220 = 1.0
        // → orthographic camera view fills panel exactly like the front view.
        const defCamZ = +(1.0 / 0.82).toFixed(3);   // 1.220
        if (!("cam_x"    in ov)) ov["cam_x"]    = [0,        0, 1, 0];
        if (!("cam_y"    in ov)) ov["cam_y"]    = [0,        0, 1, 0];
        if (!("cam_z"    in ov)) ov["cam_z"]    = [defCamZ,  0, 1, 0];
        if (!("cam_roll" in ov)) ov["cam_roll"] = [0,      0, 1, 0];
        if (!("cam_tilt" in ov)) ov["cam_tilt"] = [0,      0, 1, 0];
        if (!("cam_pan"  in ov)) ov["cam_pan"]  = [0,      0, 1, 0];
        if (!("cam_fov"  in ov)) ov["cam_fov"]  = [60,     0, 1, 0];
        this._setCameraView("camera");
        this._switchTab("dope");
        this.expandedGroups.add("camera");
        this._refreshTimeline();
        this._renderFrame(this.currentFrame);
    }

    // -----------------------------------------------------------------------
    // NLF / Experimental
    // -----------------------------------------------------------------------
    _toggleExperimental() {
        this._experimentalMode = !this._experimentalMode;
        this._expBtn.textContent = `⬡ Turn to 3D: ${this._experimentalMode ? "ON" : "OFF"}`;
        this._expBtn.style.background = this._experimentalMode ? "#1a2a3a" : "#1a1a2a";
        this._nlfPanel.style.display = this._experimentalMode ? "block" : "none";
        if (this._experimentalMode && this._nlfData === null && this._nlfStatus === "idle") {
            this._fetchNlfData();
        }
        // Auto-swap to 4-viewport layout with camera replacing top when 3D is on.
        if (this._experimentalMode) {
            this._preExp3dLayout = {
                panelLayout: this._panelLayout,
                panelViews:  [...this._panelViews],
                activePanel: this._activePanel,
            };
            this._panelViews = ["front", "orbit", "camera", "side"];
            this._setLayout(4);
        } else if (this._preExp3dLayout) {
            this._panelViews = [...this._preExp3dLayout.panelViews];
            this._activePanel = this._preExp3dLayout.activePanel;
            this._setLayout(this._preExp3dLayout.panelLayout);
            this._preExp3dLayout = null;
        } else {
            this._renderFrame(this.currentFrame);
        }
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
                const n = data.frames.filter(f => f.body?.length).length;
                const src = data.source === "extractor" ? " (from extractor)" : "";
                if (this._nlfStatusEl)
                    this._nlfStatusEl.textContent = `NLF: ${n}/${data.frames.length} frames detected ✓${src}`;
                // Bake every detected NLF frame as an override so the dopesheet shows a keyframe
                // diamond per frame (mirrors the DWpose extractor's per-frame baking).
                // NLF Z is in metres (e.g. 2.5 — 5 m) — normalize per-frame to editor units
                // [~ -0.5, +0.5] by mean-centering the body's depth values then scaling. The
                // Three.js orbit renderer multiplies z by poseW*0.35; without normalization the
                // skeleton flies offscreen.
                // Bake each detected NLF frame as keyframes. Per-frame DYNAMIC normalization:
                // mean-center then divide by that frame's max-abs-deviation × 2 → output range
                // is exactly [-0.5, +0.5] for every frame. This preserves the body's 3D depth
                // shape regardless of absolute distance from camera (matches the old read-only
                // overlay behavior and stays editable). Z is negated so closer-to-camera = +Z.
                let baked = 0;
                for (let fi = 0; fi < data.frames.length; fi++) {
                    const op18 = data.frames[fi]?.body_op18;
                    if (!op18) continue;
                    const zVals = [];
                    for (const p of op18) {
                        if (p && (p[2] ?? 0) >= 0.05 && isFinite(p[3])) zVals.push(p[3]);
                    }
                    if (!zVals.length) continue;
                    const zMean = zVals.reduce((a, b) => a + b, 0) / zVals.length;
                    const zMaxAbs = Math.max(...zVals.map(z => Math.abs(z - zMean)), 0.001);
                    const zNorm = (z) => (zMean - z) / zMaxAbs * 0.5;
                    if (!this.overrides[fi]) this.overrides[fi] = {};
                    for (let i = 0; i < op18.length; i++) {
                        const lbl = `nlf_body_${i}`;
                        const p = op18[i];
                        if (!p || (p[2] ?? 0) < 0.05) continue;
                        const zEditor = isFinite(p[3]) ? zNorm(p[3]) : null;
                        const existing = this.overrides[fi][lbl];
                        if (existing) {
                            existing[3] = zEditor;
                        } else {
                            this.overrides[fi][lbl] = [p[0], p[1], p[2] ?? 1, zEditor];
                            baked++;
                        }
                    }
                }
                if (baked > 0 || data.frames.length > 0) this._refreshTimeline();
            } else {
                this._nlfStatus = "unavailable";
                const reason = data.reason ||
                    "connect NLF Model Loader → Magos DWP Extractor and re-run workflow";
                if (this._nlfStatusEl)
                    this._nlfStatusEl.textContent = `NLF: ${reason}`;
            }
        } catch (e) {
            this._nlfStatus = "unavailable";
            if (this._nlfStatusEl) this._nlfStatusEl.textContent = `NLF: ${e.message}`;
        }
        this._renderFrame(this.currentFrame);
    }

    async _applyNlfToDwpose() {
        if (this._nlfStatus !== "ok" || !this._nlfData) {
            alert("No NLF data loaded. Enable Experimental, select an NLF model on the Extractor's nlf_model dropdown and re-run the workflow, then try again.");
            return;
        }
        this._logAction("bake_nlf_z_depth", { nlf_frames: this._nlfData?.length });
        if (this._nlfApplyBtn) this._nlfApplyBtn.textContent = "⏳ Baking Z…";
        try {
            const resp = await fetch(`/temporal-editor/nlf/apply/${this.nodeId}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (!data.available || !data.frames?.length) {
                alert("NLF apply data not available. Re-run the workflow first.");
                return;
            }

            this._armUndo();
            const frames = data.frames;

            // ── Pass 1: collect per-frame stats and find global Z range ──────
            // Orbit view uses: orbit_px = z_editor * (poseW * 0.35) * viewScale
            // Target: max z_editor = 0.5 → max orbit_px ≈ poseW*0.175 ≈ 90px
            // This keeps depth variation clearly visible without blowing out the view.
            const TARGET_HALF_RANGE = 0.5;  // ± editor units

            const perFrame = [];
            let globalMaxAbsZ = 0;
            for (let fi = 0; fi < frames.length; fi++) {
                const op18 = frames[fi]?.body_op18;
                if (!op18?.length) { perFrame.push(null); continue; }
                const zVals = op18.filter(j => j[2] > 0).map(j => j[3]);
                if (!zVals.length) { perFrame.push(null); continue; }
                const zMean = zVals.reduce((a, b) => a + b, 0) / zVals.length;
                const maxAbs = Math.max(...zVals.map(z => Math.abs(z - zMean)));
                if (maxAbs > globalMaxAbsZ) globalMaxAbsZ = maxAbs;
                perFrame.push({ op18, zMean });
            }

            // Scale factor: maps the globally largest Z deviation to TARGET_HALF_RANGE
            const zScale = globalMaxAbsZ > 0.001 ? TARGET_HALF_RANGE / globalMaxAbsZ : 1;

            // ── Pass 2: write normalised Z depths ─────────────────────────────
            // Only update Z on EXISTING user overrides — never recreate joints the
            // user explicitly cleaned/deleted. The extractor pre-bakes overrides for
            // every detected joint, so a missing override means the user removed it
            // intentionally and we must respect that.
            let appliedFrames = 0;
            let skippedJoints = 0;
            for (let fi = 0; fi < perFrame.length; fi++) {
                const pf = perFrame[fi];
                if (!pf) continue;
                const { op18, zMean } = pf;

                const frameOv = this.overrides[fi];
                if (!frameOv) continue;   // entire frame was cleaned — leave it alone

                for (let ji = 0; ji < op18.length; ji++) {
                    const [, , conf, z_m] = op18[ji];
                    if (conf < 0.01) continue;   // unmapped joint (eyes/ears)
                    const label = `body_${ji}`;
                    const z_editor = (zMean - z_m) * zScale;
                    if (frameOv[label]) {
                        frameOv[label][3] = z_editor;
                    } else {
                        skippedJoints++;   // user removed this joint — preserve removal
                    }
                }
                appliedFrames++;
            }

            this._lazyPushUndo();
            if (this._nlfStatusEl) {
                const skipMsg = skippedJoints > 0 ? ` (${skippedJoints} cleaned joints preserved)` : "";
                this._nlfStatusEl.textContent = `Z baked: ${appliedFrames} frames ✓${skipMsg}`;
            }
            this._renderFrame(this.currentFrame);
        } catch (e) {
            alert(`Bake Z Depth failed: ${e.message}`);
        } finally {
            if (this._nlfApplyBtn) this._nlfApplyBtn.textContent = "⬇ Bake Z Depth";
        }
    }

    _syncNlfJoint(fi, label, newX, newY) {
        if (!this._experimentalMode || !this._nlfData?.[fi]?.body) return;
        if (!label.startsWith("body_")) return;
        const ji = parseInt(label.split("_")[1]);
        const smplIdx = OP18_TO_SMPL[ji];
        if (smplIdx === undefined) return;
        const nlfPt = this._nlfData[fi].body[smplIdx];
        if (!nlfPt) return;
        nlfPt[0] = newX / this.poseW;
        nlfPt[1] = newY / this.poseH;
    }

    _unbakeZDepth() {
        this._pushUndo();
        let count = 0;
        for (const fi of Object.keys(this.overrides)) {
            const ov = this.overrides[fi];
            for (const label of Object.keys(ov)) {
                if (!label.startsWith("body_")) continue;
                if (Array.isArray(ov[label]) && ov[label].length >= 4) {
                    ov[label][3] = null;
                    count++;
                }
            }
        }
        if (this._nlfStatusEl) this._nlfStatusEl.textContent = `Unbaked: ${count} joints flattened ✓`;
        this._renderFrame(this.currentFrame);
    }

    // Draw a single NLF bone as a gradient-shaded tube (cylinder illusion)
    _drawNlfTube(ctx, x1, y1, x2, y2, r = 5) {
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) return;
        const nx = -dy / len, ny = dx / len;   // perpendicular (surface normal direction)
        const mx = (x1 + x2) * 0.5, my = (y1 + y2) * 0.5;
        const g = ctx.createLinearGradient(
            mx + nx * r, my + ny * r,
            mx - nx * r, my - ny * r
        );
        g.addColorStop(0,    "rgba(50,0,110,0.75)");
        g.addColorStop(0.22, "rgba(140,50,240,1.0)");
        g.addColorStop(0.5,  "rgba(230,160,255,1.0)");
        g.addColorStop(0.78, "rgba(140,50,240,1.0)");
        g.addColorStop(1,    "rgba(50,0,110,0.75)");
        ctx.strokeStyle = g;
        ctx.lineWidth   = r * 2;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // Draw a single NLF joint as a lit sphere
    _drawNlfSphere(ctx, x, y, r = 5) {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.08, x, y, r);
        g.addColorStop(0,   "#ffffff");
        g.addColorStop(0.35,"#e0a0ff");
        g.addColorStop(1,   "#4a0088");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawNlfOverlay(ctx, frameIdx, sx, sy, ox, oy, alpha) {
        // Read EFFECTIVE NLF data (per-frame raw + user overrides + interpolation).
        // Drawn as an 18-joint OpenPose-style skeleton so user edits show up directly.
        const fd = this._getEffectiveFrame(frameIdx);
        const nlf = fd?.nlf_body;
        if (!nlf || !nlf.length) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        const valid = (pt) => pt && isFinite(pt[0]) && isFinite(pt[1]) && (pt[2] ?? 0) > 0.05;
        const toC = (pt) => this._poseToCanvas(pt[0], pt[1], sx, sy, ox, oy);
        // Bones — reuse DWpose body topology (op18 has the same indexing 0..17)
        for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
            const [a, b] = BODY_CONNECTIONS[i];
            if (a >= nlf.length || b >= nlf.length) continue;
            if (!valid(nlf[a]) || !valid(nlf[b])) continue;
            const pa = toC(nlf[a]), pb = toC(nlf[b]);
            this._drawNlfTube(ctx, pa.x, pa.y, pb.x, pb.y, 4);
        }
        // Joint spheres + per-joint state (keyframe / interpolated)
        const ovr = this.overrides[frameIdx] || {};
        const sel = this.selectedNlfJoint;
        for (let i = 0; i < nlf.length; i++) {
            const pt = nlf[i]; if (!valid(pt)) continue;
            const c = toC(pt);
            const lbl = `nlf_body_${i}`;
            const isKf = ovr[lbl] !== undefined;
            const isSelected = sel && sel.group === "nlf_body" && sel.index === i;
            if (isSelected) {
                ctx.globalAlpha = 1;
                this._drawNlfSphere(ctx, c.x, c.y, 6);
                ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(c.x, c.y, 10, 0, Math.PI * 2); ctx.stroke();
                ctx.globalAlpha = alpha;
            } else if (isKf) {
                this._drawNlfSphere(ctx, c.x, c.y, 5);
                ctx.save(); ctx.globalAlpha = 1;
                ctx.fillStyle = "#ffd700"; ctx.translate(c.x, c.y); ctx.rotate(Math.PI / 4);
                ctx.fillRect(-3, -3, 6, 6); ctx.restore();
            } else {
                this._drawNlfSphere(ctx, c.x, c.y, 4);
            }
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
        if (rhand&&!rOff&&!this.hiddenGroups.has("rhand")) this._drawHand(ctx,rhand,RHAND_COLOR,"rhand",ovr,isKeyed,isInterp,sx,sy,ox,oy);
        if (lhand&&!lOff&&!this.hiddenGroups.has("lhand")) this._drawHand(ctx,lhand,LHAND_COLOR,"lhand",ovr,isKeyed,isInterp,sx,sy,ox,oy);

        // Face landmarks — points-only overlay
        const face = fd.face;
        if (face && !this.hiddenGroups.has("face")) {
            for (let i = 0; i < face.length; i++) {
                const pt = face[i]; if (!pt) continue;
                const conf = showAll ? 1 : (pt[2] ?? 1);
                if (conf < 0.01) continue;
                const label = `face_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const c = this._poseToCanvas(pt[0], pt[1], sx, sy, ox, oy);
                const isKf = isKeyed(label), isInt = !isKf && isInterp(label);
                const isSel = this.selectedJoint?.label === label;
                const isMulti = this.selectedJoints.has(label);
                ctx.globalAlpha = baseAlpha * conf;
                ctx.fillStyle = isKf ? "#ffd700" : isInt ? "#88aaff" : FACE_COLOR;
                ctx.beginPath();
                if (isKf) { ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(Math.PI/4); ctx.fillRect(-3,-3,6,6); ctx.restore(); }
                else      { ctx.arc(c.x, c.y, isSel ? 4 : 2.2, 0, Math.PI*2); ctx.fill(); }
                ctx.globalAlpha = baseAlpha;
                if (isSel)              { ctx.strokeStyle = "#fff";    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c.x,c.y,6,0,Math.PI*2); ctx.stroke(); }
                if (isMulti && !isSel)  { ctx.strokeStyle = "#5599ff"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(c.x,c.y,5,0,Math.PI*2); ctx.stroke(); }
            }
            ctx.globalAlpha = baseAlpha;
        }
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
        const pX=kps[0][0],pY=kps[0][1], pZ=kps[0][3]??0;
        const rad=angleDeg*Math.PI/180, cos=Math.cos(rad), sin=Math.sin(rad);
        if (!this.overrides[fi]) this.overrides[fi]={};
        for (let i=0;i<kps.length;i++) {
            const label=`${side}_${i}`;
            const x=kps[i][0],y=kps[i][1],z=kps[i][3]??pZ;
            const dx=x-pX,dy=y-pY,dz=z-pZ;
            let nx,ny,nz;
            if (axis==="x")      {nx=dx;ny=dy*cos-dz*sin;nz=dy*sin+dz*cos;}
            else if (axis==="y") {nx=dx*cos+dz*sin;ny=dy;nz=-dx*sin+dz*cos;}
            else                 {nx=dx*cos-dy*sin;ny=dx*sin+dy*cos;nz=dz;}
            this.overrides[fi][label]=[pX+nx,pY+ny,kps[i][2]??1.0,pZ+nz];
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
        ctx.fillStyle = "#06060d"; ctx.fillRect(0, 0, vW, vH);
        const fd = this._getEffectiveFrame(idx); if (!fd) return;
        if (ROTATION_ENABLED) this._applyWristRotations(fd, idx);
        const body = fd.body || [], rhand = fd.rhand, lhand = fd.lhand;
        const Z_SCALE = this.poseW * 0.35;   // z-depth units → pose-pixel units

        const scale = Math.min(vW / this.poseW, vH / this.poseH) * 0.82 * this.orbitZoom;
        const ocx = vW / 2 + (this._orbitCenterOffset?.x ?? 0);
        const ocy = vH / 2 + (this._orbitCenterOffset?.y ?? 0);
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
        ctx.fillStyle = "#2a3050"; ctx.font = "10px 'Inter',sans-serif";
        ctx.fillText("Drag to orbit · Scroll to zoom", 6, vH - 6);

        // ── Three.js 3D skeleton (cylinders) ──────────────────────────────────
        if (!this._threeOrbit) {
            this._threeOrbit = new ThreeOrbitRenderer();
            // Re-render once Three.js finishes loading so the 2D fallback swaps to 3D
            if (!THREE) _threeLoadCbs.push(() => this._renderFrame(this.currentFrame));
        }

        // Skip Three.js perspective layer in orthographic camera mode (matches front view)
        if (this._threeOrbit.ready && !(this.cameraView === "camera" && this._camOrtho)) {
            // In camera mode shift lookAt target to camera aim point in world coords
            let threeLA = null;
            if (this.cameraView === "camera" && this._hasCameraKeyframes()) {
                const cam = this._getInterpolatedCamera(idx);
                threeLA = { x: cam.x * this.poseW, y: -cam.y * this.poseH, z: 0 };
            }
            const outW = this.cameraView === "camera" ? (this._canvasW || this.poseW) : 0;
            const outH = this.cameraView === "camera" ? (this._canvasH || this.poseH) : 0;
            const dwA  = this._experimentalMode ? (this._dwposeAlpha ?? 1) : 1;
            const nlfA = this._experimentalMode ? (this._nlfAlpha ?? 0) : 0;
            this._threeOrbit.render(
                ctx, vW, vH, fd,
                this.orbitYaw, this.orbitPitch, this.orbitZoom,
                this.poseW, this.poseH,
                this.zGlobalOffset, this._showAll,
                this.hiddenGroups, this.hiddenLayers, this.selectedJoint, threeLA,
                outW, outH, dwA, this._boneScale ?? 1, nlfA,
            );
        } else {
            // ── 2D fallback (active until Three.js finishes loading) ───────────
            const showAll = this._showAll;

            // Floor grid
            {
                const STEPS = 9, DX = this.poseW / STEPS, DZ = 0.22;
                ctx.save(); ctx.strokeStyle = "rgba(55,80,120,0.35)"; ctx.lineWidth = 0.6;
                for (let iz = -STEPS; iz <= STEPS; iz++) {
                    const gz = iz * DZ;
                    const p1 = proj(0, pivY, gz), p2 = proj(this.poseW, pivY, gz);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                }
                for (let ix = 0; ix <= STEPS; ix++) {
                    const gx = ix * DX;
                    const p1 = proj(gx, pivY, -STEPS * DZ), p2 = proj(gx, pivY, STEPS * DZ);
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                }
                ctx.strokeStyle = "rgba(80,120,180,0.55)"; ctx.lineWidth = 1;
                const gcx1 = proj(this.poseW/2, pivY, -STEPS*DZ), gcx2 = proj(this.poseW/2, pivY, STEPS*DZ);
                ctx.beginPath(); ctx.moveTo(gcx1.x, gcx1.y); ctx.lineTo(gcx2.x, gcx2.y); ctx.stroke();
                const gcz1 = proj(0, pivY, 0), gcz2 = proj(this.poseW, pivY, 0);
                ctx.beginPath(); ctx.moveTo(gcz1.x, gcz1.y); ctx.lineTo(gcz2.x, gcz2.y); ctx.stroke();
                ctx.restore();
            }

            // Pivot cross
            const pc = proj(pivX, pivY, 0);
            ctx.strokeStyle = "#223"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(pc.x-10,pc.y); ctx.lineTo(pc.x+10,pc.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pc.x,pc.y-10); ctx.lineTo(pc.x,pc.y+10); ctx.stroke();

            const bodyGrpVis = !this.hiddenGroups.has("body");
            const bones = [];
            for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                const [a,b] = BODY_CONNECTIONS[i];
                if (!body[a]||!body[b]) continue;
                const boneAlpha = showAll ? 1 : Math.min(body[a][2]??1, body[b][2]??1);
                if (boneAlpha < 0.01) continue;
                if (!bodyGrpVis || this.hiddenLayers.has(`body_${a}`) || this.hiddenLayers.has(`body_${b}`)) continue;
                const za = (body[a][3]??0) + (this.zGlobalOffset[`body_${a}`]??0);
                const zb = (body[b][3]??0) + (this.zGlobalOffset[`body_${b}`]??0);
                const dza = (body[a][0]-pivX)*M.m02 + (body[a][1]-pivY)*M.m12 + za*Z_SCALE*M.m22;
                const dzb = (body[b][0]-pivX)*M.m02 + (body[b][1]-pivY)*M.m12 + zb*Z_SCALE*M.m22;
                bones.push({ i, a, b, za, zb, boneAlpha, depth: (dza+dzb)/2 });
            }
            bones.sort((x,y) => x.depth - y.depth);
            for (const { i, a, b, za, zb, boneAlpha } of bones) {
                const pa = proj(body[a][0],body[a][1],za), pb = proj(body[b][0],body[b][1],zb);
                const depthA = 0.5 + Math.max(-0.5, Math.min(0.5, za));
                const depthB = 0.5 + Math.max(-0.5, Math.min(0.5, zb));
                ctx.globalAlpha = boneAlpha * (Math.min(1, 0.5+depthA*0.5) + Math.min(1, 0.5+depthB*0.5)) / 2;
                ctx.strokeStyle = BONE_COLORS[i] || "#666";
                ctx.lineWidth = Math.max(1, 1.5 + (depthA + depthB) * 2.5);
                ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
            }
            ctx.globalAlpha = 1; ctx.lineCap = "butt";
            for (let i = 0; i < body.length; i++) {
                const pt = body[i]; if (!pt) continue;
                const conf = showAll ? 1 : (pt[2]??1); if (conf < 0.01) continue;
                if (!bodyGrpVis || this.hiddenLayers.has(`body_${i}`)) continue;
                const z = (pt[3]??0) + (this.zGlobalOffset[`body_${i}`]??0), c = proj(pt[0],pt[1],z);
                const isSel = this.selectedJoint?.group==="body" && this.selectedJoint?.index===i;
                ctx.globalAlpha = conf;
                ctx.fillStyle = isSel ? "#ffd700" : (JOINT_COLORS[i]||"#fff");
                ctx.beginPath(); ctx.arc(c.x, c.y, isSel?8:5.5, 0, Math.PI*2); ctx.fill();
                ctx.globalAlpha = 1;
                if (isSel) { ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(c.x,c.y,11,0,Math.PI*2); ctx.stroke(); }
            }
            ctx.globalAlpha = 1;
            const rWZ = (body[R_WRIST]?.[3]??0) + (this.zGlobalOffset[`body_${R_WRIST}`]??0);
            const lWZ = (body[L_WRIST]?.[3]??0) + (this.zGlobalOffset[`body_${L_WRIST}`]??0);
            if (rhand && !this.hiddenGroups.has("rhand")) this._drawHandOrbit(ctx, rhand, RHAND_COLOR, "rhand", rWZ, proj);
            if (lhand && !this.hiddenGroups.has("lhand")) this._drawHandOrbit(ctx, lhand, LHAND_COLOR, "lhand", lWZ, proj);
        }

        // NLF body — rendered by ThreeOrbitRenderer when its perspective layer is active.
        // When that's skipped (camera view + Orthographic), draw NLF as a 2D overlay so
        // it stays visible. The 2D path uses the same `proj()` ortho projection as the
        // body 2D fallback, so they remain at matching scale.
        const _threeActive = this._threeOrbit?.ready
            && !(this.cameraView === "camera" && this._camOrtho);
        if (!_threeActive && this._experimentalMode && this._nlfAlpha > 0 && this._nlfData) {
            const nlf = fd.nlf_body;
            if (nlf?.length) {
                const valid = (pt) => pt && isFinite(pt[0]) && isFinite(pt[1]) && (pt[2] ?? 0) > 0.05;
                ctx.save();
                ctx.globalAlpha = this._nlfAlpha;
                for (let i = 0; i < BODY_CONNECTIONS.length; i++) {
                    const [a, b] = BODY_CONNECTIONS[i];
                    if (a >= nlf.length || b >= nlf.length) continue;
                    if (!valid(nlf[a]) || !valid(nlf[b])) continue;
                    const pa = proj(nlf[a][0], nlf[a][1], nlf[a][3] ?? 0);
                    const pb = proj(nlf[b][0], nlf[b][1], nlf[b][3] ?? 0);
                    this._drawNlfTube(ctx, pa.x, pa.y, pb.x, pb.y, 4);
                }
                const ovr = this.overrides[idx] || {};
                for (let i = 0; i < nlf.length; i++) {
                    const pt = nlf[i]; if (!valid(pt)) continue;
                    const p = proj(pt[0], pt[1], pt[3] ?? 0);
                    const isKf = ovr[`nlf_body_${i}`] !== undefined;
                    this._drawNlfSphere(ctx, p.x, p.y, isKf ? 5 : 4);
                }
                ctx.restore();
            }
        }

        // Camera motion path + gizmo — only in external viewports, never when looking through the camera
        if (this.cameraView !== "camera") {
            if (this._hasCameraKeyframes()) {
                const poseW = this.poseW, poseH = this.poseH;
                this._drawCameraPath(ctx, (nx, ny) => proj((nx - 0.5) * poseW, (ny - 0.5) * poseH, 0));
            }
            if (this._hasCameraKeyframes()) {
                this._drawCameraGizmo(ctx, idx, proj, this.poseW, this.poseH);
            }
        }

        // Selected-joint gizmo — project joint into orbit screen space
        if (this.selectedJoint) {
            const sj = this.selectedJoint;
            const gPts = _grpPts(fd, sj.group);
            const pt = gPts?.[sj.index];
            if (pt && (pt[2] ?? 1) >= 0.01) {
                const z = pt[3] ?? 0;
                const gc = proj(pt[0], pt[1], z);
                this._drawMoveGizmo(ctx, gc.x, gc.y);
            }
        }

        this._drawViewCube(ctx, vW, vH, M);
        this._drawOrbitAxes(ctx, vW, vH, M);
    }

    _drawCameraGizmo(ctx, idx, proj, poseW, poseH) {
        const cam = this._getInterpolatedCamera(idx);
        // Blender-style camera frustum: camera body → 4 image-plane corners + up triangle
        const camZoom = Math.tan(30 * Math.PI / 180) / Math.tan(Math.max(1, cam.fov) / 2 * Math.PI / 180);

        // Compute actual camera 3D position using the same orbit math as camera_math.py:
        //   dist = max(poseW,poseH) * 1.4 / (cam.z * camZoom)
        //   cam_3d = look_3d + [sin(pan)*cos(tilt), sin(tilt), cos(pan)*cos(tilt)] * dist
        // Convert Three.js world → pixel space: px = x_3d+poseW/2, py = poseH/2-y_3d, pz = z_3d/Z_SCALE
        const dist  = Math.max(poseW, poseH) * 1.4 / Math.max(0.01, cam.z * camZoom);
        const pan   = cam.pan  * Math.PI / 180;
        const tilt  = cam.tilt * Math.PI / 180;
        const Z_SCALE = poseW * 0.35;

        // LookAt point in pixel space (image plane center)
        const lookX = poseW * (0.5 + cam.x);
        const lookY = poseH * (0.5 + cam.y);

        // Camera body position: look_3d + orbit offset, then pixel-space conversion
        // Three.js Y-up → pixel Y-down: camPY = lookY - sin(tilt)*dist
        const camPX = lookX + Math.sin(pan) * Math.cos(tilt) * dist;
        const camPY = lookY - Math.sin(tilt) * dist;
        const camPZ = Math.cos(pan) * Math.cos(tilt) * dist / Z_SCALE;

        // Image plane corners centred on lookAt point at z=0
        const hw = (poseW * 0.45) / camZoom;
        const hh = (poseH * 0.45) / camZoom;
        const fTL = proj(lookX - hw, lookY - hh, 0), fTR = proj(lookX + hw, lookY - hh, 0);
        const fBR = proj(lookX + hw, lookY + hh, 0), fBL = proj(lookX - hw, lookY + hh, 0);

        // Camera origin (lens position)
        const cPos = proj(camPX, camPY, camPZ);

        // Tiny camera body rectangle at lens position
        const bW = Math.min(poseW, poseH) * 0.035, bH = Math.min(poseW, poseH) * 0.028;
        const bTL = proj(camPX - bW, camPY - bH, camPZ), bTR = proj(camPX + bW, camPY - bH, camPZ);
        const bBR = proj(camPX + bW, camPY + bH, camPZ), bBL = proj(camPX - bW, camPY + bH, camPZ);

        // Up-triangle directly above camera body (solid, like Blender)
        const uH = bH * 1.8, uW = bW * 0.9;
        const tTip   = proj(camPX,       camPY - bH - uH, camPZ);
        const tLeft  = proj(camPX - uW,  camPY - bH,      camPZ);
        const tRight = proj(camPX + uW,  camPY - bH,      camPZ);

        ctx.save();
        ctx.globalAlpha = 0.88;

        // 4 frustum lines: camera origin → image plane corners
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1;
        const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); };
        line(cPos, fTL); line(cPos, fTR); line(cPos, fBR); line(cPos, fBL);

        // Image plane rectangle (solid, like Blender's near-clip frame)
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(fTL.x,fTL.y); ctx.lineTo(fTR.x,fTR.y); ctx.lineTo(fBR.x,fBR.y);
        ctx.lineTo(fBL.x,fBL.y); ctx.closePath(); ctx.stroke();

        // Diagonal cross on image plane (Blender detail)
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.5;
        line(fTL, fBR); line(fTR, fBL);
        ctx.globalAlpha = 0.88;

        // Camera body rectangle (small, at lens position)
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bTL.x,bTL.y); ctx.lineTo(bTR.x,bTR.y); ctx.lineTo(bBR.x,bBR.y);
        ctx.lineTo(bBL.x,bBL.y); ctx.closePath(); ctx.stroke();

        // Up-triangle: solid orange fill (Blender style)
        ctx.fillStyle = "#cc8800"; ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(tTip.x,tTip.y); ctx.lineTo(tLeft.x,tLeft.y); ctx.lineTo(tRight.x,tRight.y);
        ctx.closePath(); ctx.fill();

        // Lens origin dot
        ctx.fillStyle = "#ffcc44"; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(cPos.x, cPos.y, 3, 0, Math.PI*2); ctx.fill();

        // Label
        ctx.fillStyle = "#cc8800"; ctx.font = "bold 9px sans-serif"; ctx.globalAlpha = 0.9;
        ctx.fillText("CAM", cPos.x + 5, cPos.y - 5);

        ctx.restore();
    }

    _drawHandOrbit(ctx, kps, color, prefix, wristZ, proj) {
        const showAll = this._showAll;
        for (const [a,b] of HAND_CONNECTIONS) {
            if (!kps[a]||!kps[b]) continue;
            if (this.hiddenLayers.has(`${prefix}_${a}`)||this.hiddenLayers.has(`${prefix}_${b}`)) continue;
            const boneAlpha = showAll ? 1 : Math.min(kps[a][2]??1, kps[b][2]??1);
            if (boneAlpha < 0.01) continue;
            const za = kps[a][3]??wristZ, zb = kps[b][3]??wristZ;
            const pa = proj(kps[a][0],kps[a][1],za), pb = proj(kps[b][0],kps[b][1],zb);
            ctx.globalAlpha = boneAlpha;
            ctx.strokeStyle = color; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
        }
        for (let i = 0; i < kps.length; i++) {
            const pt = kps[i]; if (!pt) continue;
            const conf = showAll ? 1 : (pt[2]??1); if (conf < 0.01) continue;
            if (this.hiddenLayers.has(`${prefix}_${i}`)) continue;
            const z = pt[3]??wristZ, c = proj(pt[0],pt[1],z);
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
    /** Blender-style 3-axis gizmo bottom-left of orbit/camera viewports. */
    _drawOrbitAxes(ctx, vW, vH, M) {
        const ox = 32, oy = vH - 32, len = 22, R = 7;
        const proj2D = (x,y,z) => ({
            x: ox + (M.m00*x + M.m10*y + M.m20*z) * len,
            y: oy + (M.m01*x + M.m11*y + M.m21*z) * len,
            d:        (M.m02*x + M.m12*y + M.m22*z),  // depth — back-axis dimmed
        });
        // Subtle background disc so the gizmo reads against the skeleton
        ctx.save();
        ctx.fillStyle = "rgba(8,12,22,0.55)";
        ctx.beginPath(); ctx.arc(ox, oy, len + 12, 0, Math.PI * 2); ctx.fill();
        const tips = [
            { p: proj2D( 1,0,0), col: "#ff5e5e", lbl: "X" },
            { p: proj2D( 0,1,0), col: "#5fdd5f", lbl: "Y" },
            { p: proj2D( 0,0,1), col: "#6aa6ff", lbl: "Z" },
        ];
        // Sort back-to-front so closer axes overlap further ones
        tips.sort((a, b) => a.p.d - b.p.d);
        for (const t of tips) {
            const fwd = t.p.d >= -0.001;
            ctx.globalAlpha = fwd ? 1 : 0.45;
            // Axis line
            ctx.strokeStyle = t.col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(t.p.x, t.p.y); ctx.stroke();
            // Tip bubble + letter
            ctx.fillStyle = fwd ? t.col : "#22293e";
            ctx.beginPath(); ctx.arc(t.p.x, t.p.y, R, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = t.col; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(t.p.x, t.p.y, R, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = fwd ? "#0a0e18" : t.col;
            ctx.font = "bold 9px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(t.lbl, t.p.x, t.p.y + 0.5);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.restore();
    }

    /** ViewCube — top-right corner of 3D viewports; shows current orbit orientation as a 3D cube. */
    _drawViewCube(ctx, vW, vH, M) {
        const SZ = 46, cx = vW - SZ - 12, cy = 12 + SZ;
        const r = SZ * 0.5;
        const VERTS = [
            [-1,-1,-1],[+1,-1,-1],[+1,+1,-1],[-1,+1,-1],
            [-1,-1,+1],[+1,-1,+1],[+1,+1,+1],[-1,+1,+1],
        ];
        const FACES = [
            { v:[4,5,6,7], n:[0,0, 1], lbl:'F',  col:'#1e3d7a', bright:'#2a5aaa' },
            { v:[1,0,3,2], n:[0,0,-1], lbl:'B',  col:'#102040', bright:'#163060' },
            { v:[3,7,6,2], n:[0, 1,0], lbl:'T',  col:'#1a4268', bright:'#235a8a' },
            { v:[0,1,5,4], n:[0,-1,0], lbl:'Bo', col:'#0e1e38', bright:'#142840' },
            { v:[0,4,7,3], n:[-1,0,0], lbl:'L',  col:'#162e5e', bright:'#1e3e7a' },
            { v:[1,2,6,5], n:[ 1,0,0], lbl:'R',  col:'#142c5c', bright:'#1c3c78' },
        ];
        const proj = (x, y, z) => ({
            x: cx + (M.m00*x + M.m10*y + M.m20*z) * r * 0.64,
            y: cy + (M.m01*x + M.m11*y + M.m21*z) * r * 0.64,
            d:       M.m02*x + M.m12*y + M.m22*z,
        });
        const pv = VERTS.map(([x,y,z]) => proj(x,y,z));
        const sorted = FACES.map(f => {
            const d = f.v.reduce((s,i) => s + pv[i].d, 0) / 4;
            return { ...f, depth: d };
        }).sort((a,b) => a.depth - b.depth);
        ctx.save();
        // Background disc
        ctx.fillStyle = 'rgba(6,8,18,0.72)';
        ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI*2); ctx.fill();
        // Draw faces back-to-front
        for (const face of sorted) {
            const pts = face.v.map(i => pv[i]);
            const visible = face.depth > -0.05;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
            ctx.closePath();
            ctx.fillStyle = visible ? face.bright : face.col;
            ctx.fill();
            ctx.strokeStyle = '#3a5aaa';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            if (visible && r > 12) {
                const fcx = pts.reduce((s,p) => s+p.x, 0) / 4;
                const fcy = pts.reduce((s,p) => s+p.y, 0) / 4;
                ctx.fillStyle = 'rgba(180,215,255,0.9)';
                ctx.font = `bold ${Math.max(7, Math.round(r * 0.28))}px 'Inter',sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(face.lbl, fcx, fcy);
            }
        }
        // Outer ring highlight
        ctx.strokeStyle = 'rgba(91,196,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, r + 7, 0, Math.PI*2); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.restore();
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
            test(pt[0],pt[1],pt[3]??0,"body",i);
        }
        const rWZ = body[R_WRIST]?.[3]??0, lWZ = body[L_WRIST]?.[3]??0;
        for (const [side,kps,wZ] of [["rhand",fd.rhand,rWZ],["lhand",fd.lhand,lWZ]]) {
            if (!kps || this.hiddenGroups.has(side)) continue;
            for (let i=0;i<kps.length;i++) {
                const pt=kps[i]; if (!pt) continue;
                test(pt[0],pt[1],pt[3]??wZ,side,i);
            }
        }
        if (fd.face && !this.hiddenGroups.has("face")) {
            const headZ = body[0]?.[3] ?? 0;
            for (let i=0;i<fd.face.length;i++) {
                const pt=fd.face[i]; if (!pt||(pt[2]??1)<0.01) continue;
                test(pt[0],pt[1],pt[3]??headZ,"face",i);
            }
        }
        // NLF joints — use EFFECTIVE NLF data (raw + overrides), now editable
        if (this._experimentalMode && this._nlfAlpha > 0 && this._nlfData) {
            const nlfPts = fd?.nlf_body;
            if (nlfPts) {
                for (let i = 0; i < nlfPts.length; i++) {
                    const p = nlfPts[i]; if (!p || (p[2] ?? 0) < 0.05) continue;
                    const z = p[3] ?? 0;
                    const c = proj(p[0], p[1], z);
                    const d = Math.hypot(cx - c.x, cy - c.y);
                    if (d < bestD) { bestD = d; best = { group: "nlf_body", index: i, label: `nlf_body_${i}` }; }
                }
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

    // -----------------------------------------------------------------------
    // Multi-panel layout helpers
    // -----------------------------------------------------------------------
    _getPanelRects(cw, ch) {
        if (this._panelLayout === 4) {
            const hw = Math.floor(cw / 2), hh = Math.floor(ch / 2);
            return [
                { x:0,  y:0,  w:hw,     h:hh },
                { x:hw, y:0,  w:cw-hw,  h:hh },
                { x:0,  y:hh, w:hw,     h:ch-hh },
                { x:hw, y:hh, w:cw-hw,  h:ch-hh },
            ];
        }
        if (this._panelLayout === 2) {
            const hw = Math.floor(cw / 2);
            return [
                { x:0,  y:0, w:hw,    h:ch },
                { x:hw, y:0, w:cw-hw, h:ch },
            ];
        }
        return [{ x:0, y:0, w:cw, h:ch }];
    }

    _loadPanelState(i) {
        const s = this._panelState[i];
        this.vpZoom = s.vpZoom; this.vpPanX = s.vpPanX; this.vpPanY = s.vpPanY;
        this.orbitYaw = s.orbitYaw; this.orbitPitch = s.orbitPitch; this.orbitZoom = s.orbitZoom;
    }

    _savePanelState(i) {
        const s = this._panelState[i];
        s.vpZoom = this.vpZoom; s.vpPanX = this.vpPanX; s.vpPanY = this.vpPanY;
        s.orbitYaw = this.orbitYaw; s.orbitPitch = this.orbitPitch; s.orbitZoom = this.orbitZoom;
    }

    _drawPanelHeader(ctx, panelIdx, rect, view) {
        const H = PANEL_HEADER_H;
        const isActive = panelIdx === this._activePanel;
        // Background
        ctx.fillStyle = isActive ? "#141c36" : "#0d1020";
        ctx.fillRect(rect.x, rect.y, rect.w, H);
        // Accent line at bottom of header (top of content)
        if (isActive) {
            ctx.fillStyle = "#5bc4ff";
            ctx.fillRect(rect.x, rect.y + H - 2, rect.w, 2);
        } else {
            ctx.fillStyle = "#1e2540";
            ctx.fillRect(rect.x, rect.y + H - 1, rect.w, 1);
        }
        // View name + dropdown caret — click anywhere on header opens menu
        const lbl = VIEW_LABELS[view] ?? view.toUpperCase();
        ctx.font = "bold 10px 'JetBrains Mono',monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillStyle = isActive ? "#d4ddf4" : "#4a5a78";
        ctx.fillText(`${lbl}  ▾`, rect.x + rect.w / 2, rect.y + H / 2 - 1);
        ctx.textBaseline = "alphabetic";
    }

    _cyclePanelView(panelIdx, dir) {
        const cur = this._panelViews[panelIdx] ?? "front";
        const ci = VIEW_CYCLE.indexOf(cur);
        const ni = (ci + dir + VIEW_CYCLE.length) % VIEW_CYCLE.length;
        this._panelViews[panelIdx] = VIEW_CYCLE[ni];
        if (panelIdx === this._activePanel) {
            this.cameraView = VIEW_CYCLE[ni];
            this._updateLayoutBtns();
        }
    }

    /** Show a dropdown of available views for the given panel, anchored at viewport (clientX, clientY). */
    _showViewMenu(panelIdx, clientX, clientY) {
        // Close any existing menu first
        if (this._viewMenuEl) { this._viewMenuEl.remove(); this._viewMenuEl = null; }
        const cur = this._panelViews[panelIdx] ?? "front";
        const menu = document.createElement("div");
        Object.assign(menu.style, {
            position: "fixed", left: `${clientX}px`, top: `${clientY}px`,
            background: "#0f1224", border: "1px solid #2c3a5a", borderRadius: "4px",
            padding: "4px 0", minWidth: "120px",
            boxShadow: "0 6px 18px rgba(0,0,0,0.65)", zIndex: "100001",
            font: "11px 'JetBrains Mono',monospace", userSelect: "none",
        });
        const VIEW_TIPS = {
            front:  "Front orthographic view (Y-up)",
            back:   "Back orthographic view (front mirrored on X)",
            top:    "Top orthographic view (looks down -Y)",
            side:   "Side orthographic view (looks down +X)",
            orbit:  "Free 3D orbit camera (drag to rotate)",
            camera: "Animated scene camera (uses camera keyframes)",
        };
        for (const v of VIEW_CYCLE) {
            const item = document.createElement("div");
            item.textContent = VIEW_LABELS[v] ?? v.toUpperCase();
            item.title = VIEW_TIPS[v] || "";
            const isSel = v === cur;
            Object.assign(item.style, {
                padding: "5px 14px", cursor: "pointer",
                color: isSel ? "#f7c840" : "#b0bcd4",
                background: isSel ? "#162040" : "transparent",
                fontWeight: isSel ? "bold" : "normal",
            });
            item.addEventListener("mouseenter", () => { if (!isSel) item.style.background = "#151e38"; });
            item.addEventListener("mouseleave", () => { if (!isSel) item.style.background = "transparent"; });
            item.addEventListener("click", e => {
                e.stopPropagation();
                this._panelViews[panelIdx] = v;
                if (panelIdx === this._activePanel) this.cameraView = v;
                this._updateLayoutBtns();
                this._renderFrame(this.currentFrame);
                menu.remove(); this._viewMenuEl = null;
            });
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        this._viewMenuEl = menu;
        // Clamp to viewport edges if it would overflow
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth)   menu.style.left = `${window.innerWidth - r.width - 4}px`;
        if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 4}px`;
        // Dismiss on outside click / Escape (next tick to avoid catching the spawning click)
        const dismiss = (ev) => {
            if (ev.type === "keydown" && ev.key !== "Escape") return;
            if (ev.type === "mousedown" && menu.contains(ev.target)) return;
            menu.remove(); this._viewMenuEl = null;
            document.removeEventListener("mousedown", dismiss, true);
            document.removeEventListener("keydown",   dismiss, true);
        };
        setTimeout(() => {
            document.addEventListener("mousedown", dismiss, true);
            document.addEventListener("keydown",   dismiss, true);
        }, 0);
    }

    _setLayout(n) {
        this._panelLayout = n;
        // Ensure active panel is valid
        const maxPanels = n;
        if (this._activePanel >= maxPanels) {
            this._savePanelState(this._activePanel);
            this._activePanel = 0;
        }
        this._loadPanelState(this._activePanel);
        this.cameraView = this._panelViews[this._activePanel] ?? "front";
        this._updateLayoutBtns();
        this._renderFrame(this.currentFrame);
    }

    _updateLayoutBtns() {
        if (this._layoutBtns) {
            for (const [n, btn] of Object.entries(this._layoutBtns)) {
                const active = parseInt(n) === this._panelLayout;
                btn.style.background  = active ? "#2a5080" : "#1e3a5a";
                btn.style.color       = active ? "#fff"    : "#88aacc";
                btn.style.borderColor = active ? "#4488cc" : "#2a4a6a";
            }
        }
        const view = this.cameraView;
        this._resetViewBtn.style.display = view !== "front" ? "block" : "none";
    }

    _setCameraView(view) {
        this._panelViews[this._activePanel] = view;
        this.cameraView = view;
        this._updateLayoutBtns();
        this._renderFrame(this.currentFrame);
    }

    _updateCamBtns() { this._updateLayoutBtns(); }

    _resetView() {
        const s = this._panelState[this._activePanel];
        s.vpZoom = 1.0; s.vpPanX = 0; s.vpPanY = 0;
        s.orbitYaw = -20; s.orbitPitch = 15; s.orbitZoom = 1.0;
        this._loadPanelState(this._activePanel);
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
    _activeFrontViewW() {
        const cw = this.canvas.width, ch = this.canvas.height;
        return (this._getPanelRects(cw, ch)[this._activePanel]?.w) ?? cw;
    }
    _activeFrontViewH() {
        const cw = this.canvas.width, ch = this.canvas.height;
        const r = this._getPanelRects(cw, ch)[this._activePanel];
        return r ? r.h - PANEL_HEADER_H : ch;
    }

    _hitTest(lx, ly) {
        const vW = this._activeFrontViewW(), vH = this._activeFrontViewH();
        const {sx,sy,ox,oy}=this._getFrontTransform(vW,vH);
        const THRESH=12, fd=this._getEffectiveFrame(this.currentFrame); if (!fd) return null;
        let best=null, bestD=THRESH;
        for (const {group,pts} of [{group:"body",pts:fd.body||[]},{group:"rhand",pts:fd.rhand||[]},{group:"lhand",pts:fd.lhand||[]},{group:"face",pts:fd.face||[]}]) {
            if (!pts || this.hiddenGroups.has(group)) continue;
            for (let i=0;i<pts.length;i++) {
                const pt=pts[i]; if (!pt) continue;
                if ((pt[2]??1) < 0.01) continue;
                const label=`${group}_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const c=this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
                const d=Math.hypot(lx-c.x,ly-c.y);
                if (d<bestD){bestD=d;best={group,index:i,label};}
            }
        }
        // NLF ghost joints — read-only, selectable when overlay is visible
        const nlfHit = this._hitTestNlf(lx, ly, sx, sy, ox, oy, bestD);
        if (nlfHit) { best = nlfHit; bestD = nlfHit._d; }
        // Camera aim point — draggable in front/back views
        if (this._hasCameraKeyframes()) {
            const cam = this._getInterpolatedCamera(this.currentFrame);
            const aimX = ox + (0.5 + cam.x) * this.poseW * sx;
            const aimY = oy + (0.5 + cam.y) * this.poseH * sy;
            if (Math.hypot(lx - aimX, ly - aimY) < THRESH)
                return { group:"camera", index:-1, label:"camera_aim", isCameraAim:true };
        }
        return best;
    }

    /** Test NLF nlf_body joints against a front/back canvas point.
     *  Uses the EFFECTIVE NLF data (raw + overrides) so edited positions are clickable.
     *  Returns a hit object {group:"nlf_body", index, label, _d} or null. */
    _hitTestNlf(lx, ly, sx, sy, ox, oy, maxD) {
        if (!this._experimentalMode || !(this._nlfAlpha > 0) || !this._nlfData) return null;
        const fd = this._getEffectiveFrame(this.currentFrame);
        const pts = fd?.nlf_body;
        if (!pts) return null;
        let hit = null, hitD = maxD;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i]; if (!p || (p[2] ?? 0) < 0.05) continue;
            const c = this._poseToCanvas(p[0], p[1], sx, sy, ox, oy);
            const d = Math.hypot(lx - c.x, ly - c.y);
            if (d < hitD) { hitD = d; hit = { group: "nlf_body", index: i, label: `nlf_body_${i}`, _d: d }; }
        }
        return hit;
    }

    _hitTestOrtho(lx, ly, vW, vH, axis) {
        const MARGIN = 0.10;
        const scale = Math.min(vW, vH) * (1 - MARGIN * 2) * this.vpZoom;
        const cx = vW / 2 + this.vpPanX, cy = vH / 2 + this.vpPanY;
        const Z_RANGE = 1.5;
        const fi = this.currentFrame;
        const fd = this._getEffectiveFrame(fi); if (!fd) return null;
        const body = fd.body || [];
        const pW = this.poseW, pH = this.poseH;
        const headZ = body[0]?.[3] ?? 0;
        const rWZ = body[R_WRIST]?.[3] ?? 0, lWZ = body[L_WRIST]?.[3] ?? 0;
        let best = null, bestD = 14;
        const probe = (pts, group, defZ) => {
            if (!pts || this.hiddenGroups.has(group)) return;
            for (let i = 0; i < pts.length; i++) {
                const pt = pts[i]; if (!pt) continue;
                if ((pt[2] ?? 1) < 0.01) continue;
                const label = `${group}_${i}`;
                if (this.hiddenLayers.has(label)) continue;
                const z = pt[3] ?? defZ;
                let sx, sy;
                if (axis === "top") {
                    sx = cx + (pt[0] / pW - 0.5) * scale;
                    sy = cy + z / Z_RANGE * (scale * 0.5);
                } else {
                    sx = cx - z / Z_RANGE * (scale * 0.5);
                    sy = cy + (pt[1] / pH - 0.5) * scale;
                }
                const d = Math.hypot(lx - sx, ly - sy);
                if (d < bestD) { bestD = d; best = { group, index:i, label }; }
            }
        };
        probe(body,    "body",  0);
        probe(fd.rhand,"rhand", rWZ);
        probe(fd.lhand,"lhand", lWZ);
        probe(fd.face, "face",  headZ);
        // NLF joints — use EFFECTIVE NLF data so edited positions are clickable
        if (this._experimentalMode && this._nlfAlpha > 0 && this._nlfData) {
            const nlfPts = fd?.nlf_body;
            if (nlfPts) {
                for (let i = 0; i < nlfPts.length; i++) {
                    const p = nlfPts[i]; if (!p || (p[2] ?? 0) < 0.05) continue;
                    const z = p[3] ?? 0;
                    let px, py;
                    if (axis === "top") { px = cx + (p[0] / pW - 0.5) * scale; py = cy + z / Z_RANGE * (scale * 0.5); }
                    else                { px = cx - z / Z_RANGE * (scale * 0.5); py = cy + (p[1] / pH - 0.5) * scale; }
                    const d = Math.hypot(lx - px, ly - py);
                    if (d < bestD) { bestD = d; best = { group: "nlf_body", index: i, label: `nlf_body_${i}` }; }
                }
            }
        }
        // Camera aim point — draggable in ortho views
        if (this._hasCameraKeyframes()) {
            const cam = this._getInterpolatedCamera(fi);
            const aimSX = cx + cam.x * scale;
            const aimSY = cy + cam.y * scale;
            if (Math.hypot(lx - aimSX, ly - aimSY) < bestD || (!best && Math.hypot(lx - aimSX, ly - aimSY) < 14))
                return { group:"camera", index:-1, label:"camera_aim", isCameraAim:true };
        }
        return best;
    }

    // -----------------------------------------------------------------------
    // Mouse events
    // -----------------------------------------------------------------------
    _onCanvasMouseDown(e) {
        e.preventDefault();
        this._hideSegmentPopup();
        const canvasRect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - canvasRect.left, cy = e.clientY - canvasRect.top;
        const cw = this.canvas.width, ch = this.canvas.height;

        // Find which panel was clicked
        const panelRects = this._getPanelRects(cw, ch);
        let clickedPanel = -1, pRect = null;
        for (let i = 0; i < panelRects.length; i++) {
            const r = panelRects[i];
            if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
                clickedPanel = i; pRect = r; break;
            }
        }
        if (clickedPanel < 0) return;

        // Save previous active panel state and load new
        this._savePanelState(this._activePanel);
        this._activePanel = clickedPanel;
        this._loadPanelState(clickedPanel);
        this.cameraView = this._panelViews[clickedPanel] ?? "front";
        this._dragPanel = clickedPanel;
        this._dragPanelRect = pRect;

        const lx = cx - pRect.x;
        const ly = cy - pRect.y;

        // Panel header click — open view-picker dropdown
        if (ly < PANEL_HEADER_H) {
            this._showViewMenu(clickedPanel, e.clientX, e.clientY);
            return;
        }

        // Content-local coordinates (header removed)
        const clx = lx, cly = ly - PANEL_HEADER_H;
        const contentW = pRect.w, contentH = pRect.h - PANEL_HEADER_H;
        const view = this._panelViews[clickedPanel] ?? "front";

        // Middle-mouse or Alt+left-drag → pan
        if (e.button === 1 || (e.button === 0 && e.altKey && view !== "orbit")) {
            this._vpPanDrag = { startX: cx, startY: cy, startPanX: this.vpPanX, startPanY: this.vpPanY };
            return;
        }

        // Camera view — Lock Camera to View button or Ortho/Persp toggle or locked-orbit drag
        if (view === "camera") {
            const btn = this._camLockBtnRect;
            if (btn && clx >= btn.x && clx < btn.x + btn.w && cly >= btn.y && cly < btn.y + btn.h) {
                this._camLocked = !this._camLocked;
                this._renderFrame(this.currentFrame);
                return;
            }
            const orthBtn = this._camOrthoBtnRect;
            if (orthBtn && clx >= orthBtn.x && clx < orthBtn.x + orthBtn.w && cly >= orthBtn.y && cly < orthBtn.y + orthBtn.h) {
                this._camOrtho = !this._camOrtho;
                this._renderFrame(this.currentFrame);
                return;
            }
            if (this._camLocked && e.button === 0) {
                const cam = this._getInterpolatedCamera(this.currentFrame);
                if (e.shiftKey) {
                    // Shift+drag = lateral pan (writes cam_x / cam_y KFs)
                    this._orbitDrag = { startX: clx, startY: cly, startCamX: cam.x, startCamY: cam.y, isCamPan: true };
                } else {
                    // Regular drag = orbit rotation (writes cam_pan / cam_tilt KFs)
                    this._orbitDrag = { startX: clx, startY: cly, startYaw: cam.pan, startPitch: cam.tilt, isCamLocked: true };
                }
            }
            return;  // Camera view: no joint hit-tests (orbit render doesn't match front-view coords)
        }

        // Orbit view
        if (view === "orbit") {
            const hit = this._hitTestOrbit(clx, cly, contentW, contentH);
            if (hit) {
                if (hit.group === "nlf_body") this.selectedNlfJoint = { group: hit.group, index: hit.index, label: hit.label };
                else this.selectedNlfJoint = null;
                if (e.shiftKey) this.selectedJoints.add(hit.label);
                else if (!this.selectedJoints.has(hit.label)) { this.selectedJoints.clear(); this.selectedJoints.add(hit.label); }
                this.selectedJoint = hit;
                this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
                if (this.lockedLayers.has(hit.label)) return;
                this._armUndo();
                const orbitMulti = this.selectedJoints.size > 1 && this.selectedJoints.has(hit.label);
                this.dragJoint = { ...hit, isOrbit: true, startCanvasX: clx, startCanvasY: cly, multiDrag: orbitMulti };
            } else {
                this._orbitDrag = { startX: clx, startY: cly, startYaw: this.orbitYaw, startPitch: this.orbitPitch };
            }
            return;
        }

        // Ortho views — joint hit or pan
        if (view === "top" || view === "side") {
            const hit = this._hitTestOrtho(clx, cly, contentW, contentH, view);
            if (hit?.isCameraAim) {
                const cam = this._getInterpolatedCamera(this.currentFrame);
                const scale = Math.min(contentW, contentH) * (1 - 0.10 * 2) * this.vpZoom;
                this._armUndo();
                this._camAimDrag = { startLX: clx, startLY: cly, startCamX: cam.x, startCamY: cam.y,
                    view, scale };
            } else if (hit) {
                if (hit.group === "nlf_body") this.selectedNlfJoint = { group: hit.group, index: hit.index, label: hit.label };
                else this.selectedNlfJoint = null;
                if (e.shiftKey) this.selectedJoints.add(hit.label);
                else { this.selectedJoints.clear(); this.selectedJoints.add(hit.label); }
                this.selectedJoint = hit;
                this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
                if (this.lockedLayers.has(hit.label)) return;
                this._armUndo();
                this.dragJoint = { ...hit, isOrthoView: view, startLX: clx, startLY: cly,
                    orthoVW: contentW, orthoVH: contentH };
            } else if (e.button === 0) {
                if (!e.shiftKey) this.selectedJoints.clear();
                this._vpPanDrag = { startX: cx, startY: cy, startPanX: this.vpPanX, startPanY: this.vpPanY };
            }
            return;
        }

        // Front / back / camera view
        // Move gizmo hit test (XY axis arrows) — takes priority over joint hit
        const mgHit = this._hitTestMoveGizmo(cx, cy);
        if (mgHit && this.selectedJoint && !this.lockedLayers.has(this.selectedJoint.label)) {
            this._armUndo();
            const { group: _mg, index: _mi, label: _ml } = this.selectedJoint;
            this._moveGizmoDrag = { axis: mgHit, group: _mg, index: _mi, label: _ml };
            return;
        }

        const gHit = ROTATION_ENABLED ? this._hitTestGizmo(cx, cy) : null;
        if (gHit) {
            const gc = this.gizmoCenter;
            this.dragGizmo = { ...gHit, lastMX: cx, lastMY: cy, lastAngle: Math.atan2(cy - gc.y, cx - gc.x) };
            return;
        }

        const hit = this._hitTest(clx, cly);
        if (hit?.isCameraAim) {
            // Drag camera aim point in front/back view to reposition cam_x/cam_y
            const cam = this._getInterpolatedCamera(this.currentFrame);
            const { sx, sy } = this._getFrontTransform(contentW, contentH);
            this._armUndo();
            this._camAimDrag = { startLX: clx, startLY: cly, startCamX: cam.x, startCamY: cam.y,
                view, sx, sy };
            return;
        }
        if (hit) {
            // NLF hits also go through the normal drag path now (NLF is editable).
            // Track the NLF selection so the graph editor / overlay highlight know about it.
            if (hit.group === "nlf_body") this.selectedNlfJoint = { group: hit.group, index: hit.index, label: hit.label };
            else this.selectedNlfJoint = null;
            if (e.shiftKey) this.selectedJoints.add(hit.label);
            else if (!this.selectedJoints.has(hit.label)) { this.selectedJoints.clear(); this.selectedJoints.add(hit.label); }
            this.selectedJoint = hit;
            this._updateJointInfo(); this._renderFrame(this.currentFrame); this._refreshTimeline();
            if (this.lockedLayers.has(hit.label)) return;

            const fi = this.currentFrame, fd = this._getEffectiveFrame(fi);
            this._armUndo();
            if (this.selectedJoints.size > 1 && this.selectedJoints.has(hit.label)) {
                const { sx, sy, ox, oy } = this._getFrontTransform(contentW, contentH);
                const pose = this._canvasToPose(clx, cly, sx, sy, ox, oy);
                this.dragJoint = { ...hit, multiDrag: true, startPoseX: pose.x, startPoseY: pose.y,
                    origPositions: this._getSelectionOrigPositions(fi, fd) };
            } else {
                this.dragJoint = { ...hit };
            }
            return;
        }

        // No joint hit → rubber-band selection (in panel content-local coords)
        if (!e.shiftKey) this.selectedJoints.clear();
        this._vpSelectRect = { startX: clx, startY: cly, curX: clx, curY: cly };
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
        const { group: grp, index: ki } = _splitLabel(label);
        const pts = _grpPts(fd, grp);
        return pts?.[ki] ?? null;
    }

    _onCanvasMouseMove(e) {
        const canvasRect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - canvasRect.left, cy = e.clientY - canvasRect.top;
        const pRect = this._dragPanelRect;
        // Local content-area coordinates for the drag panel
        const localX = pRect ? cx - pRect.x : cx;
        const localY = pRect ? cy - pRect.y - PANEL_HEADER_H : cy;

        // Viewport rubber-band selection (stored in panel content-local coords)
        if (this._vpSelectRect) {
            this._vpSelectRect.curX = localX; this._vpSelectRect.curY = localY;
            this._renderFrame(this.currentFrame);
            return;
        }

        // Pan drag — uses absolute canvas delta for vpPanX/Y
        if (this._vpPanDrag) {
            e.preventDefault();
            this.vpPanX = this._vpPanDrag.startPanX + (cx - this._vpPanDrag.startX);
            this.vpPanY = this._vpPanDrag.startPanY + (cy - this._vpPanDrag.startY);
            this._savePanelState(this._dragPanel);
            this._renderFrame(this.currentFrame);
            return;
        }

        // Camera aim-point drag in front/top/side views → cam_x / cam_y
        if (this._camAimDrag) {
            e.preventDefault();
            const d = this._camAimDrag;
            const dx = localX - d.startLX, dy = localY - d.startLY;
            let newX = d.startCamX, newY = d.startCamY;
            if (d.view === "front" || d.view === "back") {
                newX = Math.max(-2, Math.min(2, d.startCamX + dx / (this.poseW * d.sx)));
                newY = Math.max(-2, Math.min(2, d.startCamY + dy / (this.poseH * d.sy)));
            } else if (d.view === "top") {
                newX = Math.max(-2, Math.min(2, d.startCamX + dx / d.scale));
                // Y unchanged in top view (top view X = scene X, top view Y = scene Z)
            } else { // side
                newY = Math.max(-2, Math.min(2, d.startCamY + dy / d.scale));
                // X unchanged in side view (side view Y = scene Y)
            }
            this._camLockPreview = { ...(this._camLockPreview ?? {}), x: newX, y: newY };
            this._renderFrame(this.currentFrame);
            return;
        }

        // Orbit rotation drag (startX/Y stored in panel content-local)
        if (this._orbitDrag) {
            e.preventDefault();
            const dx = localX - this._orbitDrag.startX, dy = localY - this._orbitDrag.startY;
            if (this._orbitDrag.isCamPan) {
                // Shift+drag in camera view — lateral pan → cam_x / cam_y (live preview)
                const pRect2 = this._dragPanelRect;
                const cW = pRect2 ? pRect2.w : this.canvas.width;
                const cH = pRect2 ? pRect2.h - PANEL_HEADER_H : this.canvas.height;
                const orbitScale = Math.min(cW / this.poseW, cH / this.poseH) * 0.82 * this.orbitZoom;
                const newX = Math.max(-2, Math.min(2, this._orbitDrag.startCamX - dx / (this.poseW * orbitScale)));
                const newY = Math.max(-2, Math.min(2, this._orbitDrag.startCamY - dy / (this.poseH * orbitScale)));
                this._camLockPreview = { ...(this._camLockPreview ?? {}), x: newX, y: newY };
                this._renderFrame(this.currentFrame);
                return;
            }
            const newYaw   = this._orbitDrag.startYaw   + dx * 0.4;
            const newPitch = Math.max(-89, Math.min(89, this._orbitDrag.startPitch + dy * 0.4));
            if (this._orbitDrag.isCamLocked) {
                // Live preview only — KF is committed on mouseUp to avoid KF spam
                this._camLockPreview = { pan: newYaw, tilt: newPitch };
                this._renderFrame(this.currentFrame);
            } else {
                this.orbitYaw   = newYaw;
                this.orbitPitch = newPitch;
                this._savePanelState(this._dragPanel);
                this._renderFrame(this.currentFrame);
            }
            return;
        }

        // Move gizmo axis-constrained drag
        if (this._moveGizmoDrag) {
            e.preventDefault();
            const { axis, group, index, label } = this._moveGizmoDrag;
            const fi = this.currentFrame;
            const vWg = this._activeFrontViewW(), vHg = this._activeFrontViewH();
            const { sx: gsx, sy: gsy, ox: gox, oy: goy } = this._getFrontTransform(vWg, vHg);
            const gPose = this._canvasToPose(localX, localY, gsx, gsy, gox, goy);
            this._lazyPushUndo();
            if (!this.overrides[fi]) this.overrides[fi] = {};
            const fd2g = this._getEffectiveFrame(fi);
            const pts2g = _grpPts(fd2g, group);
            const cur = this.overrides[fi][label] || (pts2g?.[index] ? [...pts2g[index]] : [0.5, 0.5, 1, null]);
            const conf = cur[2] ?? 1.0, z = cur[3] ?? null;
            if (axis === "x") {
                this.overrides[fi][label] = [gPose.x, cur[1], conf, z];
                if (pts2g?.[index]) pts2g[index][0] = gPose.x;
            } else {
                this.overrides[fi][label] = [cur[0], gPose.y, conf, z];
                if (pts2g?.[index]) pts2g[index][1] = gPose.y;
            }
            this._updateJointInfo(); this._renderFrame(fi);
            return;
        }

        if (!this.dragJoint && !this.dragGizmo) return;
        e.preventDefault();
        const fi = this.currentFrame;

        if (this.dragGizmo) {
            const { axis, side } = this.dragGizmo;
            let delta;
            if (axis === "z") {
                const gc = this.gizmoCenter;
                const na = Math.atan2(cy - gc.y, cx - gc.x);
                let da = (na - this.dragGizmo.lastAngle) * 180 / Math.PI;
                while (da > 180) da -= 360; while (da < -180) da += 360;
                this.dragGizmo.lastAngle = na; delta = da;
            } else if (axis === "x") { delta = -(cy - this.dragGizmo.lastMY) * 0.5; this.dragGizmo.lastMY = cy; }
            else                     { delta = (cx - this.dragGizmo.lastMX) * 0.5; }
            this.dragGizmo.lastMX = cx;
            if (Math.abs(delta) > 0.01) this._rotateHand(side, axis, delta);
            return;
        }

        const { group, index, label } = this.dragJoint;

        // Orbit-view drag → free 3D movement via camera-space unproject
        if (this.dragJoint.isOrbit) {
            const contentW = pRect ? pRect.w : this.canvas.width;
            const contentH = pRect ? pRect.h - PANEL_HEADER_H : this.canvas.height;
            const dscr_x = localX - this.dragJoint.startCanvasX;
            const dscr_y = localY - this.dragJoint.startCanvasY;
            this.dragJoint.startCanvasX = localX; this.dragJoint.startCanvasY = localY;
            if (dscr_x === 0 && dscr_y === 0) { this._renderFrame(fi); return; }
            this._lazyPushUndo();
            const scale = Math.min(contentW / this.poseW, contentH / this.poseH) * 0.82 * this.orbitZoom;
            const Z_SCALE = this.poseW * 0.35;
            const M = this._getOrbitMatrix();
            let dpx = dscr_x / scale * M.m00 + dscr_y / scale * M.m01;
            let dpy = dscr_x / scale * M.m10 + dscr_y / scale * M.m11;
            let dpz = (dscr_x / scale * M.m20 + dscr_y / scale * M.m21) / Z_SCALE;
            if (dpx !== 0 || dpy !== 0 || dpz !== 0) {
                const fd2 = this._getEffectiveFrame(fi);
                if (!this.overrides[fi]) this.overrides[fi] = {};
                const labelsToMove = this.dragJoint.multiDrag
                    ? [...this.selectedJoints].filter(l => !this.lockedLayers.has(l))
                    : [label];
                for (const lbl of labelsToMove) {
                    const { group: grp, index: ki } = _splitLabel(lbl);
                    const pts2 = _grpPts(fd2, grp);
                    if (dpx !== 0 || dpy !== 0) {
                        const cur = this.overrides[fi]?.[lbl] || (pts2?.[ki] ? [...pts2[ki]] : [0,0,1,null]);
                        this.overrides[fi][lbl] = [cur[0]+dpx, cur[1]+dpy, cur[2]??1.0, cur[3]??null];
                        if (grp === "body") this._syncNlfJoint(fi, lbl, this.overrides[fi][lbl][0], this.overrides[fi][lbl][1]);
                    }
                    if (dpz !== 0) {
                        if (!this.overrides[fi][lbl]) this.overrides[fi][lbl] = [0, 0, 1, null];
                        const ov = this.overrides[fi][lbl];
                        if (ov.length < 4) ov.push(null);
                        ov[3] = parseFloat(((ov[3]??0)+dpz).toFixed(3));
                    }
                }
            }
            this._updateJointInfo(); this._renderFrame(fi);
            return;
        }

        // Ortho-view drag (top/side) → edit X/Y pose and Z depth
        if (this.dragJoint.isOrthoView) {
            const axis = this.dragJoint.isOrthoView;
            const vW = this.dragJoint.orthoVW, vH = this.dragJoint.orthoVH;
            const MARGIN = 0.10;
            const scale = Math.min(vW, vH) * (1 - MARGIN * 2) * this.vpZoom;
            const Z_RANGE = 1.5;
            const dscr_x = localX - this.dragJoint.startLX;
            const dscr_y = localY - this.dragJoint.startLY;
            this.dragJoint.startLX = localX; this.dragJoint.startLY = localY;
            if (dscr_x === 0 && dscr_y === 0) { this._renderFrame(fi); return; }
            this._lazyPushUndo();
            const fd2 = this._getEffectiveFrame(fi);
            if (!this.overrides[fi]) this.overrides[fi] = {};
            const { group: grp, index: ki } = _splitLabel(label);
            const pts2 = _grpPts(fd2, grp);
            const cur = this.overrides[fi]?.[label] || (pts2?.[ki] ? [...pts2[ki]] : [0.5, 0.5, 1, 0]);
            const curZ = cur[3] ?? (pts2?.[ki]?.[3] ?? 0);
            if (axis === "top") {
                // Horizontal → pose X; Vertical → Z depth
                const dpx = dscr_x / scale;
                const dz  = dscr_y * Z_RANGE / (scale * 0.5);
                this.overrides[fi][label] = [cur[0] + dpx, cur[1], cur[2] ?? 1.0, parseFloat((curZ + dz).toFixed(3))];
            } else {
                // Side: Horizontal → Z depth (negated); Vertical → pose Y
                const dz  = -dscr_x * Z_RANGE / (scale * 0.5);
                const dpy = dscr_y / scale;
                this.overrides[fi][label] = [cur[0], cur[1] + dpy, cur[2] ?? 1.0, parseFloat((curZ + dz).toFixed(3))];
            }
            this._updateJointInfo(); this._renderFrame(fi);
            return;
        }

        // Front-view joint drag — use panel content-local coords
        const vW = this._activeFrontViewW(), vH = this._activeFrontViewH();
        const {sx,sy,ox,oy} = this._getFrontTransform(vW, vH);
        const pose = this._canvasToPose(localX, localY, sx, sy, ox, oy);
        this._lazyPushUndo();

        if (this._inRefFrameMode) {
            // Ref frame mode: write to refFrameOverrides only, no IK, no camera
            if (this.dragJoint.multiDrag) {
                const delta={x:pose.x-this.dragJoint.startPoseX, y:pose.y-this.dragJoint.startPoseY};
                for (const [lbl, orig] of Object.entries(this.dragJoint.origPositions)) {
                    const existing = this.refFrameOverrides[lbl];
                    const conf=(Array.isArray(existing)&&existing[2]!==undefined)?existing[2]:1.0;
                    const z=Array.isArray(existing)?existing[3]??null:null;
                    this.refFrameOverrides[lbl]=[orig.x+delta.x, orig.y+delta.y, conf, z];
                }
            } else {
                const existing = this.refFrameOverrides[label];
                const conf=(Array.isArray(existing)&&existing[2]!==undefined)?existing[2]:1.0;
                const z=existing?.[3]??null;
                this.refFrameOverrides[label]=[pose.x,pose.y,conf,z];
            }
        } else if (this.dragJoint.multiDrag) {
            // Move all selected joints together
            const delta={x:pose.x-this.dragJoint.startPoseX, y:pose.y-this.dragJoint.startPoseY};
            if (!this.overrides[fi]) this.overrides[fi]={};
            for (const [lbl, orig] of Object.entries(this.dragJoint.origPositions)) {
                const existing=this.overrides[fi][lbl];
                const conf=(Array.isArray(existing)&&existing[2]!==undefined)?existing[2]:1.0;
                const z=Array.isArray(existing)?existing[3]??null:null;
                this.overrides[fi][lbl]=[orig.x+delta.x, orig.y+delta.y, conf, z];
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
            const z=existing?.[3]??null;
            this.overrides[fi][label]=[pose.x,pose.y,conf,z];
            const fd=this.frames[fi];
            if (fd) {
                const pts = _grpPts(fd, group);
                if (pts?.[index]){pts[index][0]=pose.x;pts[index][1]=pose.y;}
            }
            if (group === "body") this._syncNlfJoint(fi, label, pose.x, pose.y);

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
        if (this._vpSelectRect) {
            const sel = this._vpSelectRect;
            this._vpSelectRect = null;
            const vW = this._activeFrontViewW(), vH = this._activeFrontViewH();
            const { sx, sy, ox, oy } = this._getFrontTransform(vW, vH);
            const minCx = Math.min(sel.startX,sel.curX), maxCx = Math.max(sel.startX,sel.curX);
            const minCy = Math.min(sel.startY,sel.curY), maxCy = Math.max(sel.startY,sel.curY);
            if (!e.shiftKey) this.selectedJoints.clear();
            const fd = this._getEffectiveFrame(this.currentFrame);
            if (fd) {
                for (const {group,pts} of [{group:"body",pts:fd.body||[]},{group:"rhand",pts:fd.rhand||[]},{group:"lhand",pts:fd.lhand||[]},{group:"face",pts:fd.face||[]}]) {
                    if (!pts || this.hiddenGroups.has(group)) continue;
                    for (let i = 0; i < pts.length; i++) {
                        const pt = pts[i]; if (!pt) continue;
                        if ((pt[2]??1) < 0.01) continue;
                        const c = this._poseToCanvas(pt[0],pt[1],sx,sy,ox,oy);
                        if (c.x>=minCx&&c.x<=maxCx&&c.y>=minCy&&c.y<=maxCy)
                            this.selectedJoints.add(`${group}_${i}`);
                    }
                }
            }
            const last = [...this.selectedJoints].pop();
            if (last) {
                const { group: grp, index: ki } = _splitLabel(last);
                this.selectedJoint = { group:grp, index:ki, label:last };
                this._updateJointInfo();
            }
            this._renderFrame(this.currentFrame); this._refreshTimeline();
            return;
        }
        if (this.dragJoint && !this.autoKeyframe) {
            const fi = this.currentFrame, ovr = this.overrides[fi];
            if (ovr) for (const label of Object.keys(ovr)) this._tempKeys.add(`${fi}::${label}`);
        }
        // Commit camera aim drag (front/ortho views) → cam_x / cam_y KFs
        if (this._camAimDrag && this._camLockPreview) {
            const fi = this.currentFrame;
            if (!this.overrides[fi]) this.overrides[fi] = {};
            const ov = this.overrides[fi];
            if (this._camLockPreview.x !== undefined) {
                const prev = ov["cam_x"];
                ov["cam_x"] = [this._camLockPreview.x, prev?.[1]??0, prev?.[2]??1, prev?.[3]??0];
            }
            if (this._camLockPreview.y !== undefined) {
                const prev = ov["cam_y"];
                ov["cam_y"] = [this._camLockPreview.y, prev?.[1]??0, prev?.[2]??1, prev?.[3]??0];
            }
            this._camLockPreview = null;
            this._refreshTimeline();
        }
        this._camAimDrag = null;

        // Commit locked-camera orbit drag (pan/tilt) or pan drag (x/y) on mouse release
        if (this._orbitDrag && this._camLockPreview) {
            const fi = this.currentFrame;
            if (!this.overrides[fi]) this.overrides[fi] = {};
            const ov = this.overrides[fi];
            if (this._orbitDrag.isCamLocked) {
                const prev  = ov["cam_pan"],  prevT = ov["cam_tilt"];
                ov["cam_pan"]  = [this._camLockPreview.pan,  prev?.[1]??0,  prev?.[2]??1,  prev?.[3]??0];
                ov["cam_tilt"] = [this._camLockPreview.tilt, prevT?.[1]??0, prevT?.[2]??1, prevT?.[3]??0];
            }
            if (this._orbitDrag.isCamPan) {
                if (this._camLockPreview.x !== undefined) {
                    const prev = ov["cam_x"];
                    ov["cam_x"] = [this._camLockPreview.x, prev?.[1]??0, prev?.[2]??1, prev?.[3]??0];
                }
                if (this._camLockPreview.y !== undefined) {
                    const prev = ov["cam_y"];
                    ov["cam_y"] = [this._camLockPreview.y, prev?.[1]??0, prev?.[2]??1, prev?.[3]??0];
                }
            }
            this._camLockPreview = null;
            this._refreshTimeline();
        }
        this.dragJoint = null; this.dragGizmo = null; this._moveGizmoDrag = null;
        this._vpPanDrag = null; this._orbitDrag = null;
        this._dragPreState = null;
    }

    _onCanvasWheel(e) {
        e.preventDefault();
        const canvasRect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - canvasRect.left, cy = e.clientY - canvasRect.top;
        const cw = this.canvas.width, ch = this.canvas.height;
        const factor = e.deltaY > 0 ? 1/1.12 : 1.12;

        // Find which panel the wheel is over
        const panelRects = this._getPanelRects(cw, ch);
        let wheelPanel = this._activePanel, wRect = panelRects[this._activePanel];
        for (let i = 0; i < panelRects.length; i++) {
            const r = panelRects[i];
            if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
                wheelPanel = i; wRect = r; break;
            }
        }
        this._loadPanelState(wheelPanel);
        const view = this._panelViews[wheelPanel] ?? "front";
        const lx = cx - wRect.x, ly = cy - wRect.y - PANEL_HEADER_H;
        const contentW = wRect.w, contentH = wRect.h - PANEL_HEADER_H;

        if (view === "camera" && this._camLocked) {
            // Dolly: scroll writes cam_z KF — FOV never changed by viewport interaction
            const fi = this.currentFrame;
            if (!this.overrides[fi]) this.overrides[fi] = {};
            const prev = this.overrides[fi]["cam_z"];
            const curZ = prev?.[0] ?? 1.0;
            const newZ = Math.max(0.1, Math.min(10, curZ * factor));
            this.overrides[fi]["cam_z"] = [newZ, prev?.[1]??0, prev?.[2]??1, prev?.[3]??0];
            this._savePanelState(wheelPanel);
            if (wheelPanel !== this._activePanel) this._loadPanelState(this._activePanel);
            this._renderFrame(fi);
            return;
        } else if (view === "orbit") {
            this.orbitZoom = Math.max(0.2, Math.min(8, this.orbitZoom * factor));
        } else {
            // Zoom around cursor (front/back/camera/top/side)
            const { sx, ox, oy } = this._getFrontTransform(contentW, contentH);
            const poseX = (lx - ox) / sx, poseY = (ly - oy) / sx;
            this.vpZoom = Math.max(0.1, Math.min(30, this.vpZoom * factor));
            const newBase = Math.min(contentW/this.poseW, contentH/this.poseH) * 0.95;
            const newSx = newBase * this.vpZoom;
            this.vpPanX = lx - poseX*newSx - (contentW - this.poseW*newSx)/2;
            this.vpPanY = ly - poseY*newSx - (contentH - this.poseH*newSx)/2;
        }
        this._savePanelState(wheelPanel);
        // If zoomed panel is not active, reload active panel state for rendering
        if (wheelPanel !== this._activePanel) this._loadPanelState(this._activePanel);
        this._renderFrame(this.currentFrame);
    }

    _onCanvasContextMenu(e) {
        e.preventDefault();
        const canvasRect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - canvasRect.left, cy = e.clientY - canvasRect.top;
        const view = this._panelViews[this._activePanel] ?? "front";
        if (view === "orbit" || view === "top" || view === "side") return;
        const pRect = this._dragPanelRect ?? this._getPanelRects(this.canvas.width, this.canvas.height)[this._activePanel];
        const lx = cx - (pRect?.x ?? 0), ly = cy - (pRect?.y ?? 0) - PANEL_HEADER_H;
        const hit = this._hitTest(lx, ly);
        if (!hit || hit.group !== "body") return;
        if (this.lockedLayers.has(hit.label)) return;
        const fi = this.currentFrame;
        this._pushUndo();
        if (!this.overrides[fi]) this.overrides[fi] = {};
        const label = hit.label, fd = this.frames[fi], pt = fd?.body?.[hit.index];
        const existing = this.overrides[fi][label];
        if (Array.isArray(existing) && existing[2] === 0) delete this.overrides[fi][label];
        else this.overrides[fi][label] = [pt?.[0]??0, pt?.[1]??0, 0];
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

    // Per-channel keyframe lookup for joint_detail rows (xy=indices 0-1, conf=2, z=3)
    _getKeyframesForDetailChannel(label, detail) {
        const idx = detail === "xy" ? 0 : detail === "conf" ? 2 : 3;
        return Object.keys(this.overrides).map(Number).filter(fi => {
            const ov = this.overrides[fi]?.[label];
            return ov !== undefined && ov[idx] !== null && ov[idx] !== undefined;
        }).sort((a, b) => a - b);
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
        const z0=v0[3], z1=v1[3];
        const zi=(z0===null&&z1===null)?null:(z0??0)+((z1??0)-(z0??0))*ti;
        const c0=v0.length>2?v0[2]:1.0, c1=v1.length>2?v1[2]:1.0;
        return [v0[0]+(v1[0]-v0[0])*ti,
                v0[1]+(v1[1]-v0[1])*ti,
                c0+(c1-c0)*ti,
                zi];
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

        const allNullZ = [V_prev,V_a,V_b,V_next].every(v=>v[3]===null||v[3]===undefined);
        const zi = allNullZ ? null : cr(V_prev[3]??0,V_a[3]??0,V_b[3]??0,V_next[3]??0,t);
        return [
            cr(V_prev[0],V_a[0],V_b[0],V_next[0],t),
            cr(V_prev[1],V_a[1],V_b[1],V_next[1],t),
            cr(V_prev[2]??1,V_a[2]??1,V_b[2]??1,V_next[2]??1,t),
            zi,
        ];
    }

    _toggleRefFrameMode() {
        this._inRefFrameMode = !this._inRefFrameMode;
        const on = this._inRefFrameMode;

        this._refFrameBtn.textContent   = on ? "✕ Exit Ref Frame" : "⊕ Ref Frame";
        this._refFrameBtn.style.background = on ? "#1a3a1a" : "#1a2a1a";
        this._refFrameBtn.style.color   = on ? "#8fcc8f" : "";

        // Create banner on first use; append to the first viewport container
        if (!this._refFrameBanner) {
            this._refFrameBanner = Object.assign(document.createElement("div"), {
                textContent: "⊕ EDITING REF FRAME  —  Camera transforms are ignored"
            });
            Object.assign(this._refFrameBanner.style, {
                position: "absolute", top: "38px", left: "50%",
                transform: "translateX(-50%)",
                background: "#0a2a0a", border: "1px solid #4a8a4a", color: "#8fcc8f",
                padding: "4px 16px", borderRadius: "4px", fontSize: "12px",
                zIndex: "100", pointerEvents: "none", whiteSpace: "nowrap",
            });
            const vpWrap = this._viewportContainer || this._mainContainer;
            if (vpWrap) vpWrap.appendChild(this._refFrameBanner);
        }
        this._refFrameBanner.style.display = on ? "block" : "none";

        // Force scrubber to frame 0 so drag code picks up fi=0
        if (on) this._seekFrame(0);
        else     this._renderFrame(this.currentFrame);
        this._refreshTimeline();
    }

    _getEffectiveFrame(idx) {
        const raw=this.frames[idx]; if (!raw) return null;
        // In ref frame mode, frame 0 uses refFrameOverrides (camera-immune)
        const ovr = (this._inRefFrameMode && idx === 0)
            ? this.refFrameOverrides
            : (this.overrides[idx] || {});

        // Synthesize a 21-point hand from overrides/interpolation when the raw frame
        // has no hand data — lets "Add Hand" work across all frames via interpolation.
        const synthHand = (group) => {
            const hasAny = Object.values(this.overrides).some(
                fo => fo && Object.keys(fo).some(k => k.startsWith(`${group}_`))
            );
            if (!hasAny) return null;
            return Array.from({length:21}, (_,i) => {
                const lbl=`${group}_${i}`, ov=ovr[lbl];
                if (ov) return [ov[0], ov[1], ov[2]??1, ov[3]??null];
                const interp=this._interpolateJoint(lbl, idx);
                return interp ? [interp[0], interp[1], interp[2]??1, interp[3]??null] : [0, 0, 1, null];
            });
        };

        // Base = the per-frame extracted pose (mocap-style). Overrides/interpolation
        // stack on top as user corrections. Fallback to frame 0 per group when raw
        // is missing that group — lets synthesised hands/face from KFs still render.
        const f0 = this.frames[0];
        const result={
            width:raw.width, height:raw.height,
            body: raw.body?raw.body.map(p=>[...p]):(f0?.body?f0.body.map(p=>[...p]):[]),
            rhand:raw.rhand?raw.rhand.map(p=>[...p]):(f0?.rhand?f0.rhand.map(p=>[...p]):synthHand("rhand")),
            lhand:raw.lhand?raw.lhand.map(p=>[...p]):(f0?.lhand?f0.lhand.map(p=>[...p]):synthHand("lhand")),
            face: raw.face?raw.face.map(p=>[...p]):(f0?.face?f0.face.map(p=>[...p]):null),
        };
        const apply=(group,arr)=>{
            if (!arr) return;
            for (let i=0;i<arr.length;i++) {
                const label=`${group}_${i}`, ov=ovr[label];
                if (ov!==undefined){
                    if (ov[0] != null) arr[i][0]=ov[0];
                    if (ov[1] != null) arr[i][1]=ov[1];
                    if (ov[2] != null) arr[i][2]=ov[2];
                    arr[i][3] = ov[3] ?? null;
                } else {
                    const interp=this._interpolateJoint(label,idx);
                    if(interp){
                        if (interp[0] != null) arr[i][0]=interp[0];
                        if (interp[1] != null) arr[i][1]=interp[1];
                        if (interp[2] != null) arr[i][2]=interp[2];
                        arr[i][3] = interp[3] ?? null;
                    }
                }
            }
        };
        apply("body",result.body); apply("rhand",result.rhand); apply("lhand",result.lhand); apply("face",result.face);

        // NLF body — same effective-frame treatment so it can be edited like DWpose.
        // Per-frame dynamic Z normalization: each frame's body always spans [-0.5, +0.5]
        // editor units, preserving the 3D depth shape regardless of camera distance.
        // Z is negated so closer-to-camera = +Z (matches the old read-only overlay).
        const nlfRaw = this._nlfData?.[idx]?.body_op18;
        if (nlfRaw && nlfRaw.length) {
            const zVals = [];
            for (const p of nlfRaw) {
                if (p && (p[2] ?? 0) >= 0.05 && isFinite(p[3])) zVals.push(p[3]);
            }
            const zMean = zVals.length ? zVals.reduce((a, b) => a + b, 0) / zVals.length : 0;
            const zMaxAbs = zVals.length ? Math.max(...zVals.map(z => Math.abs(z - zMean)), 0.001) : 1;
            const zNorm = (z) => (zMean - z) / zMaxAbs * 0.5;
            result.nlf_body = nlfRaw.map(p => {
                if (!p) return [0, 0, 0, null];
                const z = isFinite(p[3]) ? zNorm(p[3]) : null;
                return [p[0], p[1], p[2] ?? 0, z];
            });
            apply("nlf_body", result.nlf_body);
            // Defensive clamp — anything beyond ±1.5 editor units is stale legacy metres-Z.
            for (const r of result.nlf_body) {
                if (r && r[3] != null && (!isFinite(r[3]) || Math.abs(r[3]) > 1.5)) r[3] = 0;
            }
        } else if (this._nlfData) {
            // No raw NLF for this frame — synthesise from overrides + interpolation if any exist
            const hasAny = Object.values(this.overrides).some(
                fo => fo && Object.keys(fo).some(k => k.startsWith("nlf_body_"))
            );
            if (hasAny) {
                result.nlf_body = Array.from({length: N_NLF_BODY}, (_, i) => {
                    const lbl = `nlf_body_${i}`, ov = ovr[lbl];
                    if (ov) return [ov[0], ov[1], ov[2] ?? 1, ov[3] ?? null];
                    const interp = this._interpolateJoint(lbl, idx);
                    return interp ? [interp[0], interp[1], interp[2] ?? 1, interp[3] ?? null] : [0, 0, 0, null];
                });
            }
        }
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

    _deleteKeyframeSelected() {
        if (this.selKfs.size > 0) { this._deleteSelectedKeyframes(); return; }
        const fi = this.currentFrame;
        if (this.selectedJoints.size > 1) {
            this._pushUndo();
            for (const lbl of this.selectedJoints) this._deleteKeyframeRaw(lbl, fi);
            this._refreshTimeline(); this._renderFrame(fi);
            return;
        }
        if (this.selectedJoint) this._deleteKeyframe(this.selectedJoint.label, fi);
    }

    _insertKeyframe(label, frameIdx) {
        this._pushUndo();
        this._insertKeyframeRaw(label, frameIdx);
        this._refreshTimeline(); this._renderFrame(frameIdx);
        if (this.activeTab==="graph") this._renderGraphEditor();
    }

    _insertKeyframeRaw(label, frameIdx) {
        const fd=this._getEffectiveFrame(frameIdx); if (!fd) return;
        const { group, index: ki } = _splitLabel(label);
        const pts = _grpPts(fd, group);
        if (!pts?.[ki]) return;
        if (!this.overrides[frameIdx]) this.overrides[frameIdx]={};
        const existing = this.overrides[frameIdx][label];
        const z = existing?.[3] ?? pts[ki][3] ?? null;
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
        const pts = _grpPts(fd, group);
        const pt=pts?.[index];
        const z=pt?.[3]??0;
        const kfs=this._getKeyframesForJoint(label), isKf=this.overrides[fi]?.[label]!==undefined;
        const segMode=this.tweens[fi]?.[label]??null;
        const namePart = group === "body"  ? (JOINT_LABELS[index]      || index)
                       : group === "face"  ? (FACE_JOINT_LABELS[index] || `F${index}`)
                       :                     (HAND_JOINT_LABELS[index] || `finger_${index}`);
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
            _fingerprint:      `${this.frameCount}:${this.poseW}:${this.poseH}:${this._contentHash||""}`,
            overrides:         this.overrides,
            tweens:            this.tweens,
            smooth_window:     this.smoothWindow,
            interpolation:     this.interpolationMode,
            catmull_tension:   this.catmullTension,
            output_view:       this._outputView,
            canvas_w:          this._canvasW || 0,
            canvas_h:          this._canvasH || 0,
            // UI display state — does not affect workflow output
            experimental_mode: this._experimentalMode,
            panel_layout:      this._panelLayout,
            panel_views:       [...this._panelViews],
            dwpose_alpha:      this._dwposeAlpha ?? 1,
            nlf_alpha:         this._nlfAlpha ?? 0.5,
            data_mode:         this.dataMode ?? "dwpose",
            ref_frame_overrides: this.refFrameOverrides,
        };
        this._logAction("apply_changes", {
            override_frames: Object.keys(this.overrides).length,
            tween_frames: Object.keys(this.tweens).length,
            smooth_window: this.smoothWindow,
            interpolation: this.interpolationMode,
            output_view: this._outputView,
        });
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

    _resetCache() {
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: "100001",
        });

        const box = document.createElement("div");
        Object.assign(box.style, {
            background: "#0e1020", border: "1px solid #2c3352",
            borderRadius: "10px", padding: "28px 32px", minWidth: "340px", maxWidth: "420px",
            color: "#b0bcd4", fontFamily: "'Inter',sans-serif",
            boxShadow: "0 12px 48px rgba(0,0,0,0.9)",
        });

        const title = document.createElement("div");
        title.textContent = "Reset Cache";
        Object.assign(title.style, { fontSize: "16px", fontWeight: "700", marginBottom: "14px", color: "#d4ddf4" });
        box.appendChild(title);

        const desc = document.createElement("div");
        desc.textContent = "Clear the server detection cache so the next workflow run re-detects poses from scratch.";
        Object.assign(desc.style, { fontSize: "12px", color: "#7888a8", marginBottom: "20px", lineHeight: "1.5" });
        box.appendChild(desc);

        const divider = document.createElement("div");
        divider.style.cssText = "border-top:1px solid #334;margin-bottom:16px;";
        box.appendChild(divider);

        const question = document.createElement("div");
        question.textContent = "Also revert all edits to detected state?";
        Object.assign(question.style, { fontSize: "13px", fontWeight: "bold", color: "#ddc", marginBottom: "8px" });
        box.appendChild(question);

        const warning = document.createElement("div");
        warning.textContent = "This will permanently delete all keyframes and changes made in the editor. This cannot be undone.";
        Object.assign(warning.style, { fontSize: "11px", color: "#c87", marginBottom: "22px", lineHeight: "1.5" });
        box.appendChild(warning);

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;";

        const mkDialogBtn = (text, bg, border, color, onClick) => {
            const b = document.createElement("button");
            b.textContent = text;
            Object.assign(b.style, {
                background: bg, border: `1px solid ${border}`, color,
                borderRadius: "5px", padding: "7px 14px", cursor: "pointer",
                fontSize: "12px", fontWeight: "bold",
            });
            b.addEventListener("click", onClick);
            b.addEventListener("mouseenter", () => b.style.filter = "brightness(1.2)");
            b.addEventListener("mouseleave", () => b.style.filter = "");
            return b;
        };

        const cancelBtn = mkDialogBtn("Cancel", "#2a2a3a", "#444", "#aaa", () => overlay.remove());

        const resetOnlyBtn = mkDialogBtn("Reset Cache Only", "#2a2a1a", "#554", "#cc9",
            async () => {
                overlay.remove();
                try { await fetch(`/temporal-editor/reset-cache/${this.nodeId}`, { method: "POST" }); }
                catch(e) { console.warn("Reset cache failed:", e); }
                this._clearNlfSession();
            });

        const revertBtn = mkDialogBtn("Yes — Revert to Detection", "#3a0a0a", "#733", "#f99",
            async () => {
                overlay.remove();
                try { await fetch(`/temporal-editor/reset-cache/${this.nodeId}`, { method: "POST" }); }
                catch(e) { console.warn("Reset cache failed:", e); }
                // Clear all user edits and undo history (truly non-undoable)
                this.overrides   = {};
                this.tweens      = {};
                this._undoStack  = [];
                this._redoStack  = [];
                // Re-populate overrides from base detection frames so the dopesheet
                // shows the original detected poses as editable keyframes
                for (const [fiStr, frame] of Object.entries(this.frames)) {
                    const fi = parseInt(fiStr);
                    if (!frame) continue;
                    const ov = {};
                    if (frame.body) {
                        frame.body.forEach((kp, ki) => {
                            ov[`body_${ki}`] = [kp[0], kp[1], kp[2], kp[3] ?? 0];
                        });
                    }
                    if (frame.rhand) {
                        frame.rhand.forEach((kp, ki) => {
                            ov[`rhand_${ki}`] = [kp[0], kp[1], kp[2], kp[3] ?? 0];
                        });
                    }
                    if (frame.lhand) {
                        frame.lhand.forEach((kp, ki) => {
                            ov[`lhand_${ki}`] = [kp[0], kp[1], kp[2], kp[3] ?? 0];
                        });
                    }
                    if (Object.keys(ov).length > 0) this.overrides[fi] = ov;
                }
                // Re-populate NLF overrides from loaded NLF data using the same
                // per-frame Z normalization applied during initial NLF load
                if (this._nlfData) {
                    for (let fi = 0; fi < this._nlfData.length; fi++) {
                        const op18 = this._nlfData[fi]?.body_op18;
                        if (!op18) continue;
                        const zVals = [];
                        for (const p of op18)
                            if (p && (p[2] ?? 0) >= 0.05 && isFinite(p[3])) zVals.push(p[3]);
                        if (!zVals.length) continue;
                        const zMean = zVals.reduce((a, b) => a + b, 0) / zVals.length;
                        const zMaxAbs = Math.max(...zVals.map(z => Math.abs(z - zMean)), 0.001);
                        const zNorm = z => (zMean - z) / zMaxAbs * 0.5;
                        if (!this.overrides[fi]) this.overrides[fi] = {};
                        for (let i = 0; i < op18.length; i++) {
                            const p = op18[i];
                            if (!p || (p[2] ?? 0) < 0.05) continue;
                            this.overrides[fi][`nlf_body_${i}`] = [p[0], p[1], p[2] ?? 1,
                                isFinite(p[3]) ? zNorm(p[3]) : null];
                        }
                    }
                }
                this._refreshTimeline();
                this._seekFrame(this.currentFrame);
            });

        btnRow.append(cancelBtn, resetOnlyBtn, revertBtn);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }

    _clearNlfSession() {
        this._nlfData   = null;
        this._nlfStatus = "idle";
        if (this._nlfStatusEl) this._nlfStatusEl.textContent = "NLF: not loaded";
        this._renderFrame(this.currentFrame);
    }

    _saveUiState() {
        // Persist UI-only fields to the widget without POSTing to the server
        // (no server round-trip → no workflow trigger). Called automatically on close.
        const node = app.graph.getNodeById(parseInt(this.nodeId));
        if (!node) return;
        for (const w of node.widgets || []) {
            if (w.name !== "editor_state_json") continue;
            let base = {};
            try { base = JSON.parse(w.value || "{}"); } catch(_) {}
            Object.assign(base, {
                experimental_mode: this._experimentalMode,
                panel_layout:      this._panelLayout,
                panel_views:       [...this._panelViews],
                dwpose_alpha:      this._dwposeAlpha ?? 1,
                nlf_alpha:         this._nlfAlpha ?? 0.5,
                data_mode:         this.dataMode ?? "dwpose",
            });
            w.value = JSON.stringify(base);
            break;
        }
    }

    close() {
        this._saveUiState();
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

    /** Default 70-landmark face pose anchored at noseX/noseY (300W convention). */
    _defaultFacePose(noseX, noseY) {
        // Scale face to ~12% of pose height; offsets in unit head-size below.
        const u = (this.poseH || 512) * 0.012;
        const pts = new Array(N_FACE);
        // Jawline 0–16 (chin curve, left ear → chin → right ear)
        for (let i = 0; i < 17; i++) {
            const t = (i - 8) / 8;                       // -1 .. +1
            pts[i] = [t * 5.5, 6 + (1 - t * t) * 2.0];   // shallow U
        }
        // Right brow 17–21, Left brow 22–26
        for (let i = 0; i < 5; i++) {
            const t = i / 4;
            pts[17 + i] = [-3.6 + t * 2.4, -3.0 - Math.sin(t * Math.PI) * 0.6];
            pts[22 + i] = [ 1.2 + t * 2.4, -3.6 + Math.sin(t * Math.PI) * 0.6];
        }
        // Nose bridge 27–30 + nostrils 31–35
        for (let i = 0; i < 4; i++) pts[27 + i] = [0, -1.8 + i * 0.9];
        for (let i = 0; i < 5; i++) {
            const t = (i - 2) / 2;
            pts[31 + i] = [t * 1.4, 2.0];
        }
        // Right eye 36–41, Left eye 42–47 (6 pts each, ovals)
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            pts[36 + i] = [-2.4 + Math.cos(a) * 1.0, -1.2 + Math.sin(a) * 0.4];
            pts[42 + i] = [ 2.4 + Math.cos(a) * 1.0, -1.2 + Math.sin(a) * 0.4];
        }
        // Outer lips 48–59 (12 pts ellipse)
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            pts[48 + i] = [Math.cos(a) * 2.2, 4.4 + Math.sin(a) * 0.9];
        }
        // Inner lips 60–67 (8 pts smaller ellipse)
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            pts[60 + i] = [Math.cos(a) * 1.4, 4.4 + Math.sin(a) * 0.4];
        }
        // Pupils 68–69 (right, left)
        pts[68] = [-2.4, -1.2];
        pts[69] = [ 2.4, -1.2];
        return pts.map(([dx, dy]) => [noseX + dx * u, noseY + dy * u, 1, null]);
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
    _newScene(w, h, frameCount, fps, withFace = false) {
        this.poseW      = w;
        this.poseH      = h;
        this.frameCount = frameCount;
        this.overrides  = {};
        this.tweens     = {};
        this._undoStack = [];
        this._redoStack = [];

        const body  = this._defaultBodyPose(w, h);
        const rhand = this._defaultHandPose(body[4][0], body[4][1], true);
        const lhand = this._defaultHandPose(body[7][0], body[7][1], false);
        const face  = withFace ? this._defaultFacePose(body[0][0], body[0][1]) : null;
        this.frames = {};
        for (let fi = 0; fi < frameCount; fi++) {
            this.frames[fi] = {
                width:  w,
                height: h,
                body:   body.map(p => [...p]),
                rhand:  rhand.map(p => [...p]),
                lhand:  lhand.map(p => [...p]),
                face:   face ? face.map(p => [...p]) : null,
            };
        }
        if (withFace) this.expandedGroups.add("face");

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
            background: "#0e1020", border: "1px solid #2c3352",
            borderRadius: "10px", padding: "28px 32px", minWidth: "320px",
            color: "#b0bcd4", fontFamily: "'Inter',sans-serif",
            boxShadow: "0 12px 48px rgba(0,0,0,0.9)",
        });

        const title = document.createElement("div");
        title.textContent = isNew ? "New Scene" : "Edit Project";
        Object.assign(title.style, { fontSize: "16px", fontWeight: "700", marginBottom: "20px", color: "#d4ddf4" });
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

        // Face checkbox — only on New Scene; Edit Project leaves face state alone
        const faceInp = document.createElement("input");
        faceInp.type = "checkbox";
        faceInp.checked = false;
        if (isNew) {
            const faceRow = document.createElement("div");
            faceRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:13px;";
            const faceLbl = document.createElement("label");
            faceLbl.textContent = "Include Face";
            Object.assign(faceLbl.style, { fontSize: "12px", color: "#99a", width: "110px", flexShrink: "0", cursor: "pointer" });
            Object.assign(faceInp.style, { width: "16px", height: "16px", cursor: "pointer", accentColor: "#ffd44c" });
            faceLbl.addEventListener("click", () => { faceInp.checked = !faceInp.checked; });
            const faceHint = document.createElement("span");
            faceHint.textContent = "70 default landmarks";
            faceHint.style.cssText = "font-size:10px;color:#667;";
            faceRow.append(faceLbl, faceInp, faceHint);
            box.appendChild(faceRow);
        }

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
                this._newScene(w, h, fc, fps, faceInp.checked);
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
                // Migrate legacy zDepth → overrides[fi][label][3]
                for (const [k, v] of Object.entries(data.z_depth)) {
                    const fi = parseInt(k);
                    for (const [label, z] of Object.entries(v)) {
                        if (!this.overrides[fi]) this.overrides[fi] = {};
                        const ov = this.overrides[fi][label];
                        if (Array.isArray(ov)) { if (ov[3] === undefined) ov[3] = z; }
                        else this.overrides[fi][label] = [0, 0, 1, z];
                    }
                }
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
