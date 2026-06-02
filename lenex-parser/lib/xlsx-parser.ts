import * as XLSX from 'xlsx';
import { normalizeKey, Start, Zawodnik, ZawodnicyMap } from './lenex';

// ─── Polish month abbreviations ───────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  Sty: 1, Lut: 2, Mar: 3, Kwi: 4, Maj: 5, Cze: 6,
  Lip: 7, Sie: 8, Wrz: 9, 'Paź': 10, Lis: 11, Gru: 12,
};

/**
 * Parses Polish date like "29 Lis 2025" → "29/11/2025"
 */
function parsePlDate(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return raw;
  const [day, monStr, year] = parts;
  const mon = MONTH_MAP[monStr];
  if (!mon) return raw;
  return `${parseInt(day)}/${mon}/${year}`;
}

/**
 * Parses "50m dowolny" → { dystans: "50m", styl: "dowolny" }
 */
function parseDystans(raw: string): { dystans: string; styl: string } {
  const m = raw.trim().match(/^(\d+m)\s+(.+)$/i);
  if (!m) return { dystans: raw, styl: '' };
  return { dystans: m[1], styl: m[2] };
}

/**
 * Parses a single .xlsx file buffer (best-times format) and merges one
 * athlete's results into `output`.
 *
 * Expected columns (row 0 = header, then data rows):
 *   Dystans | Basen | Czas | Pkt. | Data | Miasto (Kraj) | Zawody
 */
export function parseXlsx(
  buffer: Buffer,
  firstname: string,
  lastname: string,
  klub: string,
  output: ZawodnicyMap,
  timestamp: string
): void {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Brak arkusza w pliku XLSX');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  if (rows.length < 2) return; // only header or empty

  const key = normalizeKey(lastname, firstname);
  if (!key) throw new Error('Nieprawidłowe imię lub nazwisko');

  if (!output[key]) {
    output[key] = {
      imie: firstname,
      nazwisko: lastname,
      rok_urodzenia: null,
      klub,
      starty: [],
    } satisfies Zawodnik;
  }

  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length < 7) continue;

    const [dystansRaw, basen, czas, pktRaw, dataRaw, miasto, zawody] = row.map(
      (v) => (v === undefined || v === null ? '' : String(v).trim())
    );

    if (!czas || !dataRaw || !dystansRaw) continue;

    const { dystans, styl } = parseDystans(dystansRaw);
    const data = parsePlDate(dataRaw);
    const pkt = parseInt(pktRaw);

    const start: Start = {
      zawody: zawody ?? '',
      data,
      miejscowosc: miasto ?? '',
      basen: basen ?? '',
      konkurencja_nr: 0,
      dystans,
      styl,
      plec: '',
      tor: 0,
      czas,
      punkty: isNaN(pkt) || pkt <= 0 ? null : pkt,
      timestamp_pobrania: timestamp,
    };

    output[key].starty.push(start);
  }
}
