(function () {
    "use strict";

    /* ── State ──────────────────────────────────────────────── */
    let allColors = [];
    let palette = [];          // array of color objects
    let activeFilters = new Set();  // active family filters (empty = show all)
    let searchTerm = "";
    let sortMode = "number";

    /* ── DOM refs ───────────────────────────────────────────── */
    const grid = document.getElementById("grid");
    const searchInput = document.getElementById("search");
    const sortSelect = document.getElementById("sort-select");
    const clearBtn = document.getElementById("clear-btn");
    const familyChipsEl = document.getElementById("family-chips");
    const resultCount = document.getElementById("result-count");
    const paletteColors = document.getElementById("palette-colors");
    const paletteEmpty = document.getElementById("palette-empty");
    const paletteActions = document.getElementById("palette-actions");
    const copyPaletteBtn = document.getElementById("copy-palette-btn");
    const clearPaletteBtn = document.getElementById("clear-palette-btn");

    /* ── Helpers ────────────────────────────────────────────── */
    function parseName(raw) {
        // "Chromatic-Dorval-CH2-0042-BLANC-FIESCH"
        // strip common prefix, extract number, family, descriptor
        const parts = raw.replace(/[_]/g, "-").split("-");
        // parts: ["Chromatic", "Dorval", "CH2", "0042", "BLANC", "FIESCH"]
        const numIdx = parts.findIndex(p => /^\d{4}$/.test(p));
        const number = numIdx >= 0 ? parseInt(parts[numIdx], 10) : 0;
        const rest = numIdx >= 0 ? parts.slice(numIdx + 1) : parts;
        const family = rest.length > 0 ? rest[0] : "";
        const descriptor = rest.length > 1 ? rest.slice(1).join(" ") : "";
        const displayName = rest.join(" ");
        return { number, family, descriptor, displayName };
    }

    function luminance(r, g, b) {
        // relative luminance
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function textColor(r, g, b) {
        return luminance(r, g, b) > 0.35 ? "#1a1a1e" : "#ffffff";
    }

    function rgb2hsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return { h: h * 360, s: s * 100, l: l * 100 };
    }

    function hsl2rgb(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    function rgb2hex(r, g, b) {
        return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    }

    function hex2rgb(hex) {
        hex = hex.replace(/^#/, "");
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6 || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }

    function findClosestColor(r, g, b) {
        let best = null, bestDist = Infinity;
        for (const c of allColors) {
            const dr = r - c.r, dg = g - c.g, db = b - c.b;
            const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        }
        return { color: best, distance: bestDist };
    }

    /* ── Data loading ───────────────────────────────────────── */
    async function loadColors() {
        const resp = await fetch("data/NUANCIER-CHROMATIC-DORVAL.json");
        const raw = await resp.json();
        allColors = raw.map(c => {
            const parsed = parseName(c.name);
            const hsl = rgb2hsl(c.r, c.g, c.b);
            return { ...c, ...parsed, hsl };
        });

        buildFamilyChips();
        restorePalette();
        render();
    }

    /* ── Family chips ───────────────────────────────────────── */
    function buildFamilyChips() {
        const families = [...new Set(allColors.map(c => c.family))].sort();
        familyChipsEl.innerHTML = "";
        for (const f of families) {
            const chip = document.createElement("button");
            chip.className = "family-chip";
            chip.textContent = f;
            chip.dataset.family = f;
            chip.addEventListener("click", () => toggleFamily(f, chip));
            familyChipsEl.appendChild(chip);
        }
    }

    function toggleFamily(family, chip) {
        if (activeFilters.has(family)) {
            activeFilters.delete(family);
            chip.classList.remove("active");
        } else {
            activeFilters.add(family);
            chip.classList.add("active");
        }
        render();
    }

    /* ── Filtering & sorting ────────────────────────────────── */
    function filtered() {
        let colors = allColors;

        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            colors = colors.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.hex.toLowerCase().includes(q) ||
                c.displayName.toLowerCase().includes(q)
            );
        }

        if (activeFilters.size > 0) {
            colors = colors.filter(c => activeFilters.has(c.family));
        }

        return sorted(colors);
    }

    function sorted(colors) {
        const copy = [...colors];
        switch (sortMode) {
            case "alpha":
                copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
                break;
            case "hue":
                copy.sort((a, b) => a.hsl.h - b.hsl.h || a.hsl.l - b.hsl.l);
                break;
            case "lightness":
                copy.sort((a, b) => b.hsl.l - a.hsl.l || a.hsl.h - b.hsl.h);
                break;
            default: // "number"
                copy.sort((a, b) => a.number - b.number);
        }
        return copy;
    }

    /* ── Render grid ────────────────────────────────────────── */
    function render() {
        const colors = filtered();
        resultCount.textContent = colors.length + " / " + allColors.length + " colors";

        // Build HTML in one batch for performance
        const paletteHexes = new Set(palette.map(c => c.hex));
        const frag = document.createDocumentFragment();

        for (const c of colors) {
            const el = document.createElement("div");
            el.className = "swatch" + (paletteHexes.has(c.hex) ? " in-palette" : "");

            const fg = textColor(c.r, c.g, c.b);
            el.innerHTML =
                `<div class="swatch-color" style="background:${c.hex}">` +
                `<span class="hex" style="color:${fg}">${c.hex}</span>` +
                `</div>` +
                `<div class="swatch-info">` +
                `<div class="name" title="${c.displayName}">${c.displayName}</div>` +
                `<div class="family">${c.family} · #${String(c.number).padStart(4, "0")}</div>` +
                `</div>`;

            el.addEventListener("click", () => openPickerWithColor(c.r, c.g, c.b));
            frag.appendChild(el);
        }

        grid.innerHTML = "";
        grid.appendChild(frag);
    }

    /* ── Palette ────────────────────────────────────────────── */
    function togglePalette(color) {
        const idx = palette.findIndex(c => c.hex === color.hex && c.number === color.number);
        if (idx >= 0) {
            palette.splice(idx, 1);
        } else {
            palette.push(color);
        }
        savePalette();
        renderPalette();
        render(); // update .in-palette class
    }

    function renderPalette() {
        const hasPalette = palette.length > 0;
        paletteEmpty.style.display = hasPalette ? "none" : "";
        paletteActions.style.display = hasPalette ? "" : "none";

        const existing = paletteColors.querySelectorAll(".palette-swatch");
        existing.forEach(el => el.remove());

        for (const c of palette) {
            const el = document.createElement("div");
            el.className = "palette-swatch";
            el.innerHTML =
                `<div class="ps-color" style="background:${c.hex}"></div>` +
                `<div class="ps-details">` +
                `<div class="ps-name" title="${c.displayName}">${c.displayName}</div>` +
                `<div class="ps-hex">${c.hex}</div>` +
                `</div>` +
                `<span class="ps-remove">×</span>`;
            el.addEventListener("click", () => openPickerWithColor(c.r, c.g, c.b));
            el.querySelector(".ps-remove").addEventListener("click", (e) => {
                e.stopPropagation();
                togglePalette(c);
            });
            paletteColors.appendChild(el);
        }
        updateAddToPaletteBtn();
    }

    function savePalette() {
        try {
            const data = palette.map(c => ({ hex: c.hex, number: c.number }));
            localStorage.setItem("chromatic-palette", JSON.stringify(data));
        } catch (_) { /* ignore */ }
    }

    function restorePalette() {
        try {
            const saved = JSON.parse(localStorage.getItem("chromatic-palette"));
            if (Array.isArray(saved)) {
                for (const item of saved) {
                    const found = allColors.find(c => c.hex === item.hex && c.number === item.number);
                    if (found) palette.push(found);
                }
            }
        } catch (_) { /* ignore */ }
        renderPalette();
    }

    /* ── Events ─────────────────────────────────────────────── */
    let debounceTimer;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchTerm = searchInput.value.trim();
            render();
        }, 200);
    });

    sortSelect.addEventListener("change", () => {
        sortMode = sortSelect.value;
        render();
    });

    clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        searchTerm = "";
        sortSelect.value = "number";
        sortMode = "number";
        activeFilters.clear();
        familyChipsEl.querySelectorAll(".family-chip").forEach(c => c.classList.remove("active"));
        render();
    });

    copyPaletteBtn.addEventListener("click", () => {
        const text = palette.map(c => c.hex).join(", ");
        navigator.clipboard.writeText(text).then(() => {
            copyPaletteBtn.textContent = "Copied!";
            setTimeout(() => { copyPaletteBtn.textContent = "Copy Hex"; }, 1500);
        });
    });

    clearPaletteBtn.addEventListener("click", () => {
        palette.length = 0;
        savePalette();
        renderPalette();
        render();
    });

    /* ── Color Picker ────────────────────────────────────── */
    const pickerPanel = document.getElementById("picker-panel");
    const pickerPreview = document.getElementById("picker-preview");
    const pickerNative = document.getElementById("picker-native");
    const pickerHex = document.getElementById("picker-hex");

    const pR = document.getElementById("picker-r");
    const pRn = document.getElementById("picker-r-num");
    const pG = document.getElementById("picker-g");
    const pGn = document.getElementById("picker-g-num");
    const pB = document.getElementById("picker-b");
    const pBn = document.getElementById("picker-b-num");
    const pH = document.getElementById("picker-h");
    const pHn = document.getElementById("picker-h-num");
    const pS = document.getElementById("picker-s");
    const pSn = document.getElementById("picker-s-num");
    const pL = document.getElementById("picker-l");
    const pLn = document.getElementById("picker-l-num");

    const closestSwatch = document.getElementById("closest-swatch");
    const closestName = document.getElementById("closest-name");
    const closestHex = document.getElementById("closest-hex");
    const closestDist = document.getElementById("closest-distance");
    const closestResult = document.getElementById("closest-result");
    const closestGoto = document.getElementById("closest-goto");

    let pickerColor = { r: 255, g: 255, b: 255 };
    let closestMatch = null;
    let highlightedEl = null;
    const addToPaletteBtn = document.getElementById("add-to-palette-btn");

    function openPickerWithColor(r, g, b) {
        pickerColor = { r, g, b };
        syncFromRGB();
    }

    // Sync all UI from current pickerColor (source: RGB)
    function syncFromRGB() {
        const { r, g, b } = pickerColor;
        pR.value = r; pRn.value = r;
        pG.value = g; pGn.value = g;
        pB.value = b; pBn.value = b;

        const hsl = rgb2hsl(r, g, b);
        pH.value = Math.round(hsl.h); pHn.value = Math.round(hsl.h);
        pS.value = Math.round(hsl.s); pSn.value = Math.round(hsl.s);
        pL.value = Math.round(hsl.l); pLn.value = Math.round(hsl.l);

        const hex = rgb2hex(r, g, b);
        pickerHex.value = hex.slice(1);
        pickerNative.value = hex;
        pickerPreview.style.background = hex;

        updateClosest();
    }

    // Sync all UI from HSL inputs
    function syncFromHSL() {
        const h = parseInt(pH.value) || 0;
        const s = parseInt(pS.value) || 0;
        const l = parseInt(pL.value) || 0;
        const { r, g, b } = hsl2rgb(h, s, l);
        pickerColor = { r, g, b };

        pR.value = r; pRn.value = r;
        pG.value = g; pGn.value = g;
        pB.value = b; pBn.value = b;

        pHn.value = h; pSn.value = s; pLn.value = l;

        const hex = rgb2hex(r, g, b);
        pickerHex.value = hex.slice(1);
        pickerNative.value = hex;
        pickerPreview.style.background = hex;

        updateClosest();
    }

    // Sync all UI from hex input
    function syncFromHex() {
        const parsed = hex2rgb(pickerHex.value);
        if (!parsed) return;
        pickerColor = parsed;
        syncFromRGB();
    }

    function updateClosest() {
        if (allColors.length === 0) return;
        const { color, distance } = findClosestColor(pickerColor.r, pickerColor.g, pickerColor.b);
        closestMatch = color;
        closestSwatch.style.background = color.hex;
        closestName.textContent = color.displayName;
        closestHex.textContent = color.hex;
        closestDist.textContent = distance < 1 ? "Exact match" : "Distance: " + distance.toFixed(1);
        updateAddToPaletteBtn();
    }

    function updateAddToPaletteBtn() {
        if (!closestMatch || !addToPaletteBtn) return;
        const inPalette = palette.some(c => c.hex === closestMatch.hex && c.number === closestMatch.number);
        addToPaletteBtn.textContent = inPalette ? "Remove from Palette" : "Add to Palette";
        addToPaletteBtn.classList.toggle("in-palette", inPalette);
    }

    function clearHighlight() {
        if (highlightedEl) {
            highlightedEl.classList.remove("highlight-closest");
            highlightedEl = null;
        }
    }

    function scrollToClosest() {
        if (!closestMatch) return;
        clearHighlight();
        const swatches = grid.querySelectorAll(".swatch");
        for (const el of swatches) {
            const hexSpan = el.querySelector(".hex");
            if (hexSpan && hexSpan.textContent === closestMatch.hex) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                el.classList.add("highlight-closest");
                highlightedEl = el;
                setTimeout(() => el.classList.remove("highlight-closest"), 3000);
                break;
            }
        }
    }

    // --- Picker event wiring ---

    // RGB sliders
    for (const [slider, num, key] of [[pR, pRn, "r"], [pG, pGn, "g"], [pB, pBn, "b"]]) {
        slider.addEventListener("input", () => {
            num.value = slider.value;
            pickerColor[key] = parseInt(slider.value);
            syncFromRGB();
        });
        num.addEventListener("input", () => {
            const v = Math.max(0, Math.min(255, parseInt(num.value) || 0));
            slider.value = v;
            pickerColor[key] = v;
            syncFromRGB();
        });
    }

    // HSL sliders
    for (const [slider, num] of [[pH, pHn], [pS, pSn], [pL, pLn]]) {
        slider.addEventListener("input", () => {
            num.value = slider.value;
            syncFromHSL();
        });
        num.addEventListener("input", () => {
            const max = parseInt(slider.max);
            const v = Math.max(0, Math.min(max, parseInt(num.value) || 0));
            slider.value = v;
            num.value = v;
            syncFromHSL();
        });
    }

    // Hex input
    let hexDebounce;
    pickerHex.addEventListener("input", () => {
        clearTimeout(hexDebounce);
        hexDebounce = setTimeout(syncFromHex, 200);
    });

    // Native color picker
    pickerNative.addEventListener("input", () => {
        const parsed = hex2rgb(pickerNative.value);
        if (parsed) {
            pickerColor = parsed;
            syncFromRGB();
        }
    });

    // Closest color interactions
    closestGoto.addEventListener("click", (e) => {
        e.stopPropagation();
        scrollToClosest();
    });

    closestResult.addEventListener("click", () => {
        if (closestMatch) {
            openPickerWithColor(closestMatch.r, closestMatch.g, closestMatch.b);
        }
    });

    // Copy buttons
    document.querySelectorAll(".picker-copy-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            let text;
            const fmt = btn.dataset.copy;
            if (fmt === "hex") text = "#" + pickerHex.value;
            else if (fmt === "rgb") text = `rgb(${pickerColor.r}, ${pickerColor.g}, ${pickerColor.b})`;
            else if (fmt === "hsl") text = `hsl(${pH.value}, ${pS.value}%, ${pL.value}%)`;
            if (text) {
                navigator.clipboard.writeText(text).then(() => {
                    const orig = btn.textContent;
                    btn.textContent = "Copied!";
                    setTimeout(() => { btn.textContent = orig; }, 1200);
                });
            }
        });
    });

    // Add to palette button
    addToPaletteBtn.addEventListener("click", () => {
        if (!closestMatch) return;
        togglePalette(closestMatch);
        updateAddToPaletteBtn();
    });

    /* ── Init ───────────────────────────────────────────────── */
    loadColors();
})();
