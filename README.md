# Chromatic Explorer

A web-based color palette explorer and picker for Chromatic Dorval paint colors. Browse, search, filter, and build custom palettes from the complete color range.

## Project Structure

```
ChromaticExplorer/
├── app/                    Web application (static HTML/CSS/JS)
│   ├── index.html          HTML markup
│   ├── css/styles.css      Styles
│   ├── js/app.js           Application logic
│   └── data/               Color data (JSON, generated from swatches)
├── tools/                  Python CLI utilities
│   ├── serve.py            Development server
│   └── read_aco.py         Adobe .aco → JSON converter
├── swatches/               Source Adobe Color Swatch files
└── pyproject.toml          Project metadata
```

## Quick Start

Start the development server:

```bash
python tools/serve.py
```

Then open http://localhost:8000 in your browser.

## Converting Swatches

To regenerate the JSON color data from an Adobe `.aco` swatch file:

```bash
python tools/read_aco.py                                         # uses default swatch
python tools/read_aco.py swatches/NUANCIER-CHROMATIC-DORVAL.aco  # explicit path
```

Output is written to `app/data/`.

## Features

- **Search** by name, hex code, or color family
- **Sort** by original order, alphabetical, hue, or lightness
- **Filter** by color family chips
- **Color picker** with RGB sliders, HSL inputs, hex input, and native picker
- **Closest match** finder with weighted Euclidean distance
- **Palette** builder with localStorage persistence
- **Copy** hex, RGB, or HSL values to clipboard
