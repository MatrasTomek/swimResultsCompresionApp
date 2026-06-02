# Copilot Instructions

## Project overview

This repository contains **lenex-parser** — a Next.js web app that converts swimming competition result files (`.lxf` / `.xlsx`) into a cumulative `zawodnicy.json` athlete database.

The app is in the `lenex-parser/` subdirectory. All commands must be run from there.

## Commands

```bash
cd lenex-parser

npm run dev      # development server on http://localhost:3000
npm run build    # production build
npm run lint     # ESLint (eslint.config.mjs, Next.js preset)
```

There are no tests.

## ⚠️ Next.js version warning

This project uses **Next.js 16.2.7** (React 19). APIs, conventions, and file structure may differ from your training data. Before writing any Next.js-specific code, check `node_modules/next/dist/docs/` for up-to-date guidance and heed deprecation notices.

## Architecture

```
lenex-parser/
├── app/
│   ├── page.tsx              # Single client component — drag-drop UI
│   ├── layout.tsx
│   └── api/
│       ├── process/route.ts  # POST: parse files, merge, return JSON download
│       └── clear/route.ts    # DELETE: remove data/zawodnicy.json
├── lib/
│   ├── lenex.ts              # .lxf parser + merge logic + shared types
│   └── xlsx-parser.ts        # .xlsx best-times parser
└── data/
    └── zawodnicy.json        # Persistent server-side athlete store (auto-created)
```

**Data flow:**
1. User uploads `.lxf` and/or `.xlsx` files in the browser.
2. `POST /api/process` parses them server-side, merges into `data/zawodnicy.json`, and streams the result back as a file download.
3. Response headers carry `X-Athlete-Count`, `X-New-Athlete-Count`, and `X-Errors` (JSON array).
4. `DELETE /api/clear` deletes `data/zawodnicy.json` to reset the store.

## Key types (lib/lenex.ts)

```ts
type ZawodnicyMap = Record<string, Zawodnik>  // key = normalizeKey(lastname, firstname)

interface Zawodnik {
  imie: string; nazwisko: string;
  rok_urodzenia: number | null;
  klub: string;
  starty: Start[];
}

interface Start {
  zawody: string; data: string; miejscowosc: string; basen: string;
  konkurencja_nr: number; dystans: string; styl: string; plec: string;
  tor: number; czas: string; punkty: number | null;
  timestamp_pobrania: string;
}
```

## Key conventions

**Athlete key:** `normalizeKey(lastname, firstname)` — NFD-normalized, ASCII-only, lowercase, spaces → `_`. Example: `"Wąs Amelia"` → `"was_amelia"`. Keys are the only identifier; mismatched names create duplicates.

**Date format:** `DD/M/YYYY` (e.g. `"16/5/2026"`). LXF ISO dates are converted by `formatDate()`; XLSX Polish month abbreviations (`Sty`, `Lut`, …, `Gru`) are converted by `parsePlDate()`.

**Deduplication fingerprint for starts:**
`zawody|data|dystans|styl|konkurencja_nr|tor` — used in `mergeZawodnicy()` to avoid adding duplicate race results when re-uploading the same file.

**LXF parsing:** `.lxf` files are ZIP archives containing a `.lef` or `.xml` file. Parsed with `adm-zip` + `fast-xml-parser`. The club name filter is case-insensitive exact match against the `<CLUB name>` attribute.

**XLSX parsing:** Expects the first sheet with a header row and columns in order: `Dystans | Basen | Czas | Pkt. | Data | Miasto (Kraj) | Zawody`. Each `.xlsx` file represents one athlete; the caller must supply `firstname` and `lastname` explicitly.

**Stroke/gender/course mapping** (Polish): defined as `STROKE_MAP`, `GENDER_MAP`, `COURSE_MAP` constants in `lib/lenex.ts`. Extend these maps when adding support for new values.

**Path alias:** `@/` maps to `lenex-parser/` root (tsconfig `paths`).

**Language:** All UI text, field names, and data values are in Polish.

**Data storage:** `data/zawodnicy.json` is written with tab indentation (`JSON.stringify(data, null, '\t')`). It is not a database — it is read in full and rewritten on every request.
