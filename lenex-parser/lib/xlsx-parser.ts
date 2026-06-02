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

// Each discipline group spans 5 data columns; groups are separated by 1 null column.
const GROUP_SIZE = 6;

/**
 * A row is a section header when it contains "Pkt." at positions 4, 10, 16, ...
 * (offset 4 within each GROUP_SIZE block). Returns the col indices of all "Pkt." cells.
 */
function findPktCols(row: unknown[]): number[] {
  const cols: number[] = [];
  for (let i = 4; i < row.length; i += GROUP_SIZE) {
    if (typeof row[i] === 'string' && (row[i] as string).trim() === 'Pkt.') {
      cols.push(i);
    }
  }
  return cols;
}

/**
 * Extracts discipline names from a section header row using the "Pkt." positions.
 * Discipline name sits 4 columns before "Pkt." in the same group.
 */
function extractDisciplines(row: unknown[], pktCols: number[]): string[] {
  return pktCols.map((pktCol) => {
    const nameCell = row[pktCol - 4];
    return typeof nameCell === 'string' ? nameCell.trim() : '';
  });
}

/**
 * Parses a single .xlsx file buffer (best-times multi-column format) and
 * merges one athlete's results into `output`.
 *
 * Format:
 *   Row 0  — title/season header (skipped)
 *   Section headers — discipline names at cols 0, 6, 12, … with "Pkt." at cols 4, 10, 16, …
 *   Data rows  — for each group g at offset g*6: [Date, City, Pool, Time, Points]
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

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  if (rows.length < 2) return;

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

  let currentDisciplines: string[] = [];

  // Skip row 0 (title/season row)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row) continue;

    const pktCols = findPktCols(row);

    if (pktCols.length > 0) {
      currentDisciplines = extractDisciplines(row, pktCols);
      continue;
    }

    // Data row — process each known discipline group
    for (let g = 0; g < currentDisciplines.length; g++) {
      const discipline = currentDisciplines[g];
      if (!discipline) continue;

      const offset = g * GROUP_SIZE;
      const dateRaw = row[offset];
      const city = row[offset + 1];
      const pool = row[offset + 2];
      const time = row[offset + 3];
      const ptsRaw = row[offset + 4];

      if (dateRaw === null || time === null) continue;

      const dateStr = String(dateRaw).trim();
      const czassStr = String(time).trim();
      if (!dateStr || !czassStr) continue;

      const { dystans, styl } = parseDystans(discipline);
      const data = parsePlDate(dateStr);
      const ptsNum = Number(ptsRaw);

      const start: Start = {
        zawody: '',
        data,
        miejscowosc: city !== null ? String(city).trim() : '',
        basen: pool !== null ? String(pool).trim() : '',
        konkurencja_nr: 0,
        dystans,
        styl,
        plec: '',
        tor: 0,
        czas: czassStr,
        punkty: isNaN(ptsNum) || ptsNum <= 0 ? null : ptsNum,
        timestamp_pobrania: timestamp,
      };

      output[key].starty.push(start);
    }
  }
}
