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

        // Initial neighborhood render (after a small delay to let layout settle)
        setTimeout(() => {
            syncFromRGB();
        }, 100);
    }

    /* ── Family chips ───────────────────────────────────────── */
    function familyRepresentativeColor(family) {
        const members = allColors.filter(c => c.family === family);
        if (members.length === 0) return { r: 128, g: 128, b: 128 };
        // Use the median color by hue, with a brightness/saturation boost for visibility
        const sorted = [...members].sort((a, b) => a.hsl.h - b.hsl.h);
        const mid = sorted[Math.floor(sorted.length / 2)];
        return { r: mid.r, g: mid.g, b: mid.b };
    }

    function buildFamilyChips() {
        const families = [...new Set(allColors.map(c => c.family))].sort();
        familyChipsEl.innerHTML = "";
        for (const f of families) {
            const rep = familyRepresentativeColor(f);
            const hsl = rgb2hsl(rep.r, rep.g, rep.b);
            // Ensure chip color is visible: boost saturation and clamp lightness
            const chipS = Math.max(hsl.s, 30);
            const chipL = Math.min(Math.max(hsl.l, 30), 70);
            const chipRgb = hsl2rgb(hsl.h, chipS, chipL);
            const hexChip = "#" + [chipRgb.r, chipRgb.g, chipRgb.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
            const tc = textColor(chipRgb.r, chipRgb.g, chipRgb.b);

            const chip = document.createElement("button");
            chip.className = "family-chip";
            chip.textContent = f;
            chip.dataset.family = f;
            chip.style.setProperty("--chip-color", hexChip);
            chip.style.setProperty("--chip-text", tc);
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
        renderNeighborhood();
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
        renderNeighborhood();
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
        addToPaletteBtn.textContent = inPalette ? "Remove Color" : "Save Color";
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

    // Add to palette button
    addToPaletteBtn.addEventListener("click", () => {
        if (!closestMatch) return;
        togglePalette(closestMatch);
        updateAddToPaletteBtn();
    });

    /* ── Neighborhood Explorer ──────────────────────────────── */
    const neighborhoodPanel = document.getElementById("neighborhood-panel");
    const neighborhoodBody = document.getElementById("neighborhood-body");
    const axisX = document.getElementById("axis-x");
    const axisY = document.getElementById("axis-y");
    const neighborhoodZoom = document.getElementById("neighborhood-zoom");
    const zoomValue = document.getElementById("zoom-value");
    const neighborhoodCanvas = document.getElementById("neighborhood-canvas");
    const canvasWrap = document.getElementById("canvas-wrap");
    const neighborhoodTooltip = document.getElementById("neighborhood-tooltip");
    const tooltipSwatch = document.getElementById("tooltip-swatch");
    const tooltipName = document.getElementById("tooltip-name");
    const tooltipHex = document.getElementById("tooltip-hex");
    const crosshairSwatch = document.getElementById("crosshair-swatch");
    const crosshairHex = document.getElementById("crosshair-hex");
    const crosshairChannels = document.getElementById("crosshair-channels");
    const nearestList = document.getElementById("nearest-list");
    const presetBtns = document.querySelectorAll(".preset-btn");

    let neighborPins = [];           // cached array of {color, x, y, dist}

    // Channel accessors
    function getChannelValue(color, channel) {
        switch (channel) {
            case "r": return color.r;
            case "g": return color.g;
            case "b": return color.b;
            case "h": return color.hsl ? color.hsl.h : rgb2hsl(color.r, color.g, color.b).h;
            case "s": return color.hsl ? color.hsl.s : rgb2hsl(color.r, color.g, color.b).s;
            case "l": return color.hsl ? color.hsl.l : rgb2hsl(color.r, color.g, color.b).l;
        }
        return 0;
    }

    function getChannelMax(channel) {
        if (channel === "h") return 360;
        if (channel === "s" || channel === "l") return 100;
        return 255; // r, g, b
    }

    function getChannelLabel(channel) {
        const labels = { r: "R", g: "G", b: "B", h: "H", s: "S", l: "L" };
        return labels[channel] || channel.toUpperCase();
    }

    function isRgbChannel(ch) {
        return ch === "r" || ch === "g" || ch === "b";
    }

    // Build a color from pickerColor, overriding specific channel values
    function buildColorFromChannels(xChannel, xVal, yChannel, yVal) {
        // Determine which color space to use as base
        const xIsRGB = isRgbChannel(xChannel);
        const yIsRGB = isRgbChannel(yChannel);

        let r, g, b;

        if (xIsRGB && yIsRGB) {
            // Both RGB: use pickerColor as base
            r = pickerColor.r;
            g = pickerColor.g;
            b = pickerColor.b;
            if (xChannel === "r") r = xVal;
            else if (xChannel === "g") g = xVal;
            else if (xChannel === "b") b = xVal;
            if (yChannel === "r") r = yVal;
            else if (yChannel === "g") g = yVal;
            else if (yChannel === "b") b = yVal;
        } else if (!xIsRGB && !yIsRGB) {
            // Both HSL
            const baseHSL = rgb2hsl(pickerColor.r, pickerColor.g, pickerColor.b);
            let h = baseHSL.h, s = baseHSL.s, l = baseHSL.l;
            if (xChannel === "h") h = xVal;
            else if (xChannel === "s") s = xVal;
            else if (xChannel === "l") l = xVal;
            if (yChannel === "h") h = yVal;
            else if (yChannel === "s") s = yVal;
            else if (yChannel === "l") l = yVal;
            // Wrap hue
            h = ((h % 360) + 360) % 360;
            s = Math.max(0, Math.min(100, s));
            l = Math.max(0, Math.min(100, l));
            const rgb = hsl2rgb(h, s, l);
            r = rgb.r; g = rgb.g; b = rgb.b;
        } else {
            // Mixed: one RGB, one HSL. Use HSL as base, override.
            const baseHSL = rgb2hsl(pickerColor.r, pickerColor.g, pickerColor.b);
            let h = baseHSL.h, s = baseHSL.s, l = baseHSL.l;

            // Apply HSL channel first
            if (!xIsRGB) {
                if (xChannel === "h") h = xVal;
                else if (xChannel === "s") s = xVal;
                else if (xChannel === "l") l = xVal;
            }
            if (!yIsRGB) {
                if (yChannel === "h") h = yVal;
                else if (yChannel === "s") s = yVal;
                else if (yChannel === "l") l = yVal;
            }
            h = ((h % 360) + 360) % 360;
            s = Math.max(0, Math.min(100, s));
            l = Math.max(0, Math.min(100, l));

            const rgb = hsl2rgb(h, s, l);
            r = rgb.r; g = rgb.g; b = rgb.b;

            // Now apply RGB channel override
            if (xIsRGB) {
                if (xChannel === "r") r = xVal;
                else if (xChannel === "g") g = xVal;
                else if (xChannel === "b") b = xVal;
            }
            if (yIsRGB) {
                if (yChannel === "r") r = yVal;
                else if (yChannel === "g") g = yVal;
                else if (yChannel === "b") b = yVal;
            }
        }

        r = Math.max(0, Math.min(255, Math.round(r)));
        g = Math.max(0, Math.min(255, Math.round(g)));
        b = Math.max(0, Math.min(255, Math.round(b)));

        return { r, g, b };
    }

    function renderNeighborhood() {
        if (!neighborhoodCanvas) return;

        const xCh = axisX.value;
        const yCh = axisY.value;
        const zoom = parseInt(neighborhoodZoom.value) || 64;

        // Get center values for each axis
        const centerX = getChannelValue(pickerColor, xCh);
        const centerY = getChannelValue(pickerColor, yCh);

        // Determine ranges (handle hue wrap differently)
        const xMax = getChannelMax(xCh);
        const yMax = getChannelMax(yCh);

        // Rendering dimensions
        const rect = canvasWrap.getBoundingClientRect();
        const displaySize = Math.min(rect.width, rect.height) || 300;
        const dpr = window.devicePixelRatio || 1;
        const renderSize = Math.round(displaySize * dpr);

        neighborhoodCanvas.width = renderSize;
        neighborhoodCanvas.height = renderSize;

        const ctx = neighborhoodCanvas.getContext("2d");
        const imageData = ctx.createImageData(renderSize, renderSize);
        const data = imageData.data;

        for (let py = 0; py < renderSize; py++) {
            for (let px = 0; px < renderSize; px++) {
                const xVal = centerX - zoom + (px / (renderSize - 1)) * zoom * 2;
                const yVal = centerY + zoom - (py / (renderSize - 1)) * zoom * 2;

                const color = buildColorFromChannels(xCh, xVal, yCh, yVal);
                const idx = (py * renderSize + px) * 4;
                data[idx] = color.r;
                data[idx + 1] = color.g;
                data[idx + 2] = color.b;
                data[idx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Plot pins
        plotCatalogPins(ctx, renderSize, xCh, yCh, centerX, centerY, zoom);

        // Render nearest list
        renderNearestList();

        // Update preset button states
        updatePresetButtons();
    }

    function plotCatalogPins(ctx, size, xCh, yCh, centerX, centerY, zoom) {
        neighborPins = [];

        const dpr = window.devicePixelRatio || 1;
        const xMax = getChannelMax(xCh);
        const yMax = getChannelMax(yCh);

        // Determine threshold for non-axis channels (50% of zoom, scaled appropriately)
        const threshold = zoom * 0.6;

        // Get list of channels that are NOT x or y
        const allChannels = ["r", "g", "b", "h", "s", "l"];
        const fixedChannels = allChannels.filter(ch => ch !== xCh && ch !== yCh);

        for (const color of allColors) {
            // Check if color is within threshold on fixed channels
            let inRange = true;
            for (const ch of fixedChannels) {
                const colorVal = getChannelValue(color, ch);
                const pickerVal = getChannelValue(pickerColor, ch);
                const chMax = getChannelMax(ch);
                // Scale threshold proportionally to channel's max
                const scaledThreshold = threshold * (chMax / 255);
                let diff = Math.abs(colorVal - pickerVal);
                // Handle hue wrap
                if (ch === "h") {
                    diff = Math.min(diff, 360 - diff);
                }
                if (diff > scaledThreshold) {
                    inRange = false;
                    break;
                }
            }
            if (!inRange) continue;

            // Get x,y channel values for this color
            const colorX = getChannelValue(color, xCh);
            const colorY = getChannelValue(color, yCh);

            // Check if within zoom range
            let xDiff = colorX - centerX;
            let yDiff = colorY - centerY;

            // Handle hue wrap for x axis
            if (xCh === "h") {
                if (xDiff > 180) xDiff -= 360;
                else if (xDiff < -180) xDiff += 360;
            }
            if (yCh === "h") {
                if (yDiff > 180) yDiff -= 360;
                else if (yDiff < -180) yDiff += 360;
            }

            if (Math.abs(xDiff) > zoom || Math.abs(yDiff) > zoom) continue;

            // Map to pixel coordinates
            const px = ((xDiff + zoom) / (zoom * 2)) * size;
            const py = ((zoom - yDiff) / (zoom * 2)) * size;

            if (px < 0 || px >= size || py < 0 || py >= size) continue;

            // Calculate perceptual distance for sorting
            const dr = pickerColor.r - color.r;
            const dg = pickerColor.g - color.g;
            const db = pickerColor.b - color.b;
            const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);

            neighborPins.push({ color, x: px, y: py, dist });
        }

        // Sort by distance, limit to 40
        neighborPins.sort((a, b) => a.dist - b.dist);
        neighborPins = neighborPins.slice(0, 40);

        // Draw pins (reversed so closest are on top)
        for (let i = neighborPins.length - 1; i >= 0; i--) {
            const pin = neighborPins[i];
            const { color, x, y } = pin;

            // Draw circle (outline only, transparent interior)
            ctx.beginPath();
            ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
            ctx.strokeStyle = textColor(color.r, color.g, color.b);
            ctx.lineWidth = 1.5 * dpr;
            ctx.stroke();
        }

        // Draw center crosshair
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1 * dpr;
        const cx = size / 2, cy = size / 2;
        ctx.beginPath();
        ctx.moveTo(cx - 10 * dpr, cy);
        ctx.lineTo(cx + 10 * dpr, cy);
        ctx.moveTo(cx, cy - 10 * dpr);
        ctx.lineTo(cx, cy + 10 * dpr);
        ctx.stroke();
    }

    function renderNearestList() {
        if (!nearestList) return;
        nearestList.innerHTML = "";

        const top8 = neighborPins.slice(0, 8);
        for (const pin of top8) {
            const { color, dist } = pin;
            const el = document.createElement("div");
            el.className = "nearest-item";
            el.dataset.hex = color.hex;
            el.innerHTML =
                `<div class="ni-swatch" style="background:${color.hex}"></div>` +
                `<div class="ni-info">` +
                `<div class="ni-name">${color.displayName}</div>` +
                `<div class="ni-hex">${color.hex}</div>` +
                `</div>` +
                `<div class="ni-dist">${dist.toFixed(0)}</div>`;
            el.addEventListener("click", () => openPickerWithColor(color.r, color.g, color.b));
            el.addEventListener("mouseenter", () => highlightPin(color.hex));
            el.addEventListener("mouseleave", clearPinHighlight);
            nearestList.appendChild(el);
        }
    }

    function highlightPin(hex) {
        // Highlight the list item
        nearestList.querySelectorAll(".nearest-item").forEach(el => {
            el.classList.toggle("highlighted", el.dataset.hex === hex);
        });
    }

    function clearPinHighlight() {
        nearestList.querySelectorAll(".nearest-item").forEach(el => {
            el.classList.remove("highlighted");
        });
    }

    function updatePresetButtons() {
        const currentX = axisX.value;
        const currentY = axisY.value;
        presetBtns.forEach(btn => {
            const px = btn.dataset.x;
            const py = btn.dataset.y;
            const match = (px === currentX && py === currentY) || (px === currentY && py === currentX);
            btn.classList.toggle("active", match);
        });
    }

    function getColorAtCanvasPosition(canvasX, canvasY) {
        const xCh = axisX.value;
        const yCh = axisY.value;
        const zoom = parseInt(neighborhoodZoom.value) || 64;
        const centerX = getChannelValue(pickerColor, xCh);
        const centerY = getChannelValue(pickerColor, yCh);
        const size = neighborhoodCanvas.width;

        // Map pixel to channel values (same formula as render)
        const xVal = centerX - zoom + (canvasX / size) * zoom * 2;
        const yVal = centerY + zoom - (canvasY / size) * zoom * 2;

        return buildColorFromChannels(xCh, xVal, yCh, yVal);
    }

    function findPinNearPosition(canvasX, canvasY) {
        const dpr = window.devicePixelRatio || 1;
        const hitRadius = 12 * dpr;
        for (const pin of neighborPins) {
            const dx = pin.x - canvasX;
            const dy = pin.y - canvasY;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                return pin;
            }
        }
        return null;
    }

    // Canvas event handlers
    if (neighborhoodCanvas) {
        neighborhoodCanvas.addEventListener("mousemove", (e) => {
            const rect = neighborhoodCanvas.getBoundingClientRect();
            const scaleX = neighborhoodCanvas.width / rect.width;
            const scaleY = neighborhoodCanvas.height / rect.height;
            const canvasX = (e.clientX - rect.left) * scaleX;
            const canvasY = (e.clientY - rect.top) * scaleY;

            // Update crosshair bar
            const color = getColorAtCanvasPosition(canvasX, canvasY);
            const hex = rgb2hex(color.r, color.g, color.b);
            crosshairSwatch.style.background = hex;
            crosshairHex.textContent = hex;
            crosshairChannels.textContent = `R:${color.r} G:${color.g} B:${color.b}`;

            // Check for pin hover
            const pin = findPinNearPosition(canvasX, canvasY);
            if (pin) {
                // Show tooltip
                neighborhoodTooltip.classList.remove("hidden");
                tooltipSwatch.style.background = pin.color.hex;
                tooltipName.textContent = pin.color.displayName;
                tooltipHex.textContent = pin.color.hex;

                // Position tooltip (in viewport coords)
                const tooltipX = e.clientX - rect.left + 15;
                const tooltipY = e.clientY - rect.top - 10;
                neighborhoodTooltip.style.left = tooltipX + "px";
                neighborhoodTooltip.style.top = tooltipY + "px";

                // Highlight in list
                highlightPin(pin.color.hex);
            } else {
                neighborhoodTooltip.classList.add("hidden");
                clearPinHighlight();
            }
        });

        neighborhoodCanvas.addEventListener("mouseleave", () => {
            neighborhoodTooltip.classList.add("hidden");
            clearPinHighlight();
        });

        neighborhoodCanvas.addEventListener("click", (e) => {
            const rect = neighborhoodCanvas.getBoundingClientRect();
            const scaleX = neighborhoodCanvas.width / rect.width;
            const scaleY = neighborhoodCanvas.height / rect.height;
            const canvasX = (e.clientX - rect.left) * scaleX;
            const canvasY = (e.clientY - rect.top) * scaleY;

            // Check if clicking on a pin
            const pin = findPinNearPosition(canvasX, canvasY);
            if (pin) {
                // Load the catalog color
                openPickerWithColor(pin.color.r, pin.color.g, pin.color.b);
            } else {
                // Load the exact color at this position
                const color = getColorAtCanvasPosition(canvasX, canvasY);
                openPickerWithColor(color.r, color.g, color.b);
            }
        });
    }

    // Axis selector change handlers
    if (axisX) {
        axisX.addEventListener("change", renderNeighborhood);
    }
    if (axisY) {
        axisY.addEventListener("change", renderNeighborhood);
    }

    // Zoom slider
    if (neighborhoodZoom) {
        neighborhoodZoom.addEventListener("input", () => {
            zoomValue.textContent = "±" + neighborhoodZoom.value;
            renderNeighborhood();
        });
    }

    // Scroll-to-zoom on the canvas
    if (neighborhoodCanvas) {
        neighborhoodCanvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            const step = e.deltaY > 0 ? 4 : -4;
            const cur = parseInt(neighborhoodZoom.value) || 64;
            const min = parseInt(neighborhoodZoom.min) || 10;
            const max = parseInt(neighborhoodZoom.max) || 128;
            neighborhoodZoom.value = Math.max(min, Math.min(max, cur + step));
            zoomValue.textContent = "±" + neighborhoodZoom.value;
            renderNeighborhood();
        }, { passive: false });
    }

    // Scroll on range inputs to adjust value
    document.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener("wheel", (e) => {
            e.preventDefault();
            const min = parseFloat(slider.min) || 0;
            const max = parseFloat(slider.max) || 100;
            const range = max - min;
            const step = Math.max(1, Math.round(range / 100));
            const cur = parseFloat(slider.value) || 0;
            slider.value = Math.max(min, Math.min(max, cur + (e.deltaY < 0 ? step : -step)));
            slider.dispatchEvent(new Event("input", { bubbles: true }));
        }, { passive: false });
    });

    // Preset buttons
    presetBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            axisX.value = btn.dataset.x;
            axisY.value = btn.dataset.y;
            renderNeighborhood();
        });
    });

    /* ── Init ───────────────────────────────────────────────── */
    loadColors();
})();
