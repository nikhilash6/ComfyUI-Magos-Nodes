import { app } from "../../scripts/app.js";

const BUILTIN_PRESETS = {
    "Preview / Distilled (4 Steps)": [4,  1.0, "dpm++_sde", 1.0],
    "Standard (20 Steps)":           [20, 5.0, "unipc",     0.0],
    "High Quality (30 Steps)":       [30, 5.0, "unipc",     0.0],
    "Maximum (40 Steps)":            [40, 5.0, "dpm++_sde", 0.0],
};

const BUILTIN_NAMES = new Set(Object.keys(BUILTIN_PRESETS));

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiGetPresets() {
    const r = await fetch("/magos/presets");
    return r.ok ? r.json() : {};
}

async function apiSavePreset(name, steps, cfg, scheduler, lora) {
    const r = await fetch("/magos/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, steps, cfg, scheduler, lora }),
    });
    return r.json();
}

async function apiDeletePreset(name) {
    const r = await fetch(`/magos/presets/${encodeURIComponent(name)}`, { method: "DELETE" });
    return r.json();
}

// ── Extension ─────────────────────────────────────────────────────────────────
app.registerExtension({
    name: "MagosNodes.WanSamplerPresets",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WanAnimateSamplerPresets") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            const node = this;

            const getW = (name) => node.widgets?.find(w => w.name === name);

            // ── Sync custom_* widgets from a preset's values ──────────────────
            const syncToPreset = (presetName, allPresets) => {
                const vals = allPresets[presetName];
                if (!vals) return;
                const map = [
                    ["custom_steps",         vals[0]],
                    ["custom_cfg",           vals[1]],
                    ["custom_scheduler",     vals[2]],
                    ["custom_lora_strength", vals[3]],
                ];
                for (const [name, value] of map) {
                    const w = getW(name);
                    if (w) { w.value = value; w.callback?.(value); }
                }
                app.canvas.setDirty(true);
            };

            // Hook preset dropdown changes
            const wPreset = getW("preset");
            if (wPreset) {
                const orig = wPreset.callback;
                wPreset.callback = (value) => {
                    orig?.call(wPreset, value);
                    const all = { ...BUILTIN_PRESETS };
                    apiGetPresets().then(u => syncToPreset(value, { ...all, ...u }));
                };
                // Sync on first load
                const all = { ...BUILTIN_PRESETS };
                apiGetPresets().then(u => syncToPreset(wPreset.value, { ...all, ...u }));
            }

            // ── Preset management DOM widget ──────────────────────────────────
            const container = document.createElement("div");
            container.style.cssText = "padding:4px 6px 6px;display:flex;flex-direction:column;gap:4px;";

            // Label
            const label = document.createElement("div");
            label.textContent = "User Presets";
            label.style.cssText = "font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;";
            container.appendChild(label);

            // Name input row
            const nameRow = document.createElement("div");
            nameRow.style.cssText = "display:flex;gap:4px;align-items:center;";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.placeholder = "Preset name…";
            nameInput.style.cssText = "flex:1;background:#333;border:1px solid #555;border-radius:4px;color:#eee;padding:3px 6px;font-size:11px;";
            nameRow.appendChild(nameInput);
            container.appendChild(nameRow);

            // Button row
            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:4px;";

            const mkBtn = (text, bg, onClick) => {
                const b = document.createElement("button");
                b.textContent = text;
                b.style.cssText = `flex:1;padding:3px 0;font-size:11px;border-radius:4px;cursor:pointer;border:1px solid #666;background:${bg};color:#eee;`;
                b.addEventListener("mouseenter", () => b.style.filter = "brightness(1.25)");
                b.addEventListener("mouseleave", () => b.style.filter = "");
                b.addEventListener("click", onClick);
                return b;
            };

            // ── Save button ───────────────────────────────────────────────────
            const saveBtn = mkBtn("Save", "#2a4a2a", async () => {
                const name = nameInput.value.trim();
                if (!name) { alert("Enter a preset name first."); return; }
                if (BUILTIN_NAMES.has(name)) { alert("Cannot overwrite a built-in preset."); return; }

                const steps    = getW("custom_steps")?.value        ?? 20;
                const cfg      = getW("custom_cfg")?.value          ?? 5.0;
                const sched    = getW("custom_scheduler")?.value    ?? "unipc";
                const lora     = getW("custom_lora_strength")?.value ?? 0.0;

                const res = await apiSavePreset(name, steps, cfg, sched, lora);
                if (res.error) { alert("Error: " + res.error); return; }

                // Add to dropdown if new
                const wP = getW("preset");
                if (wP && !wP.options?.values?.includes(name)) {
                    const customIdx = wP.options.values.indexOf("Custom");
                    wP.options.values.splice(customIdx === -1 ? wP.options.values.length : customIdx, 0, name);
                }

                nameInput.value = "";
                app.canvas.setDirty(true);
            });

            // ── Edit button ───────────────────────────────────────────────────
            const editBtn = mkBtn("Edit", "#4a3a1a", async () => {
                const wP    = getW("preset");
                const name  = wP?.value;
                if (!name || name === "Custom") { alert("Select a user preset to edit."); return; }
                if (BUILTIN_NAMES.has(name)) { alert("Cannot edit a built-in preset."); return; }

                const steps = getW("custom_steps")?.value        ?? 20;
                const cfg   = getW("custom_cfg")?.value          ?? 5.0;
                const sched = getW("custom_scheduler")?.value    ?? "unipc";
                const lora  = getW("custom_lora_strength")?.value ?? 0.0;

                const res = await apiSavePreset(name, steps, cfg, sched, lora);
                if (res.error) { alert("Error: " + res.error); return; }
                app.canvas.setDirty(true);
            });

            // ── Delete button ─────────────────────────────────────────────────
            const deleteBtn = mkBtn("Delete", "#4a1a1a", async () => {
                const wP   = getW("preset");
                const name = wP?.value;
                if (!name || name === "Custom") { alert("Select a user preset to delete."); return; }
                if (BUILTIN_NAMES.has(name)) { alert("Cannot delete a built-in preset."); return; }
                if (!confirm(`Delete preset "${name}"?`)) return;

                const res = await apiDeletePreset(name);
                if (res.error) { alert("Error: " + res.error); return; }

                // Remove from dropdown
                if (wP?.options?.values) {
                    const idx = wP.options.values.indexOf(name);
                    if (idx !== -1) wP.options.values.splice(idx, 1);
                }
                if (wP) { wP.value = "Custom"; wP.callback?.("Custom"); }
                app.canvas.setDirty(true);
            });

            btnRow.appendChild(saveBtn);
            btnRow.appendChild(editBtn);
            btnRow.appendChild(deleteBtn);
            container.appendChild(btnRow);

            // Pre-fill name input when a user preset is selected
            if (wPreset) {
                const orig2 = wPreset.callback;
                wPreset.callback = (value) => {
                    orig2?.call(wPreset, value);
                    if (!BUILTIN_NAMES.has(value) && value !== "Custom") {
                        nameInput.value = value;
                    } else {
                        nameInput.value = "";
                    }
                };
            }

            node.addDOMWidget("preset_manager", "wan_preset_manager", container, {
                getHeight: () => 80,
                serialize: false,
            });

            // Restore user presets into dropdown on creation
            apiGetPresets().then(userPresets => {
                const wP = getW("preset");
                if (!wP?.options?.values) return;
                const customIdx = wP.options.values.indexOf("Custom");
                for (const name of Object.keys(userPresets)) {
                    if (!wP.options.values.includes(name)) {
                        wP.options.values.splice(customIdx === -1 ? wP.options.values.length : customIdx, 0, name);
                    }
                }
            });

            return result;
        };
    },
});
