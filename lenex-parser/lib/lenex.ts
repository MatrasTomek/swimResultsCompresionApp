import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

// ─── Output types ────────────────────────────────────────────────────────────

export interface Start {
  zawody: string;
  data: string;
  miejscowosc: string;
  basen: string;
  konkurencja_nr: number;
  dystans: string;
  styl: string;
  plec: string;
  tor: number;
  czas: string;
  punkty: number | null;
  timestamp_pobrania: string;
}

export interface Zawodnik {
  imie: string;
  nazwisko: string;
  rok_urodzenia: number | null;
  klub: string;
  starty: Start[];
}

export type ZawodnicyMap = Record<string, Zawodnik>;

// ─── Internal types ───────────────────────────────────────────────────────────

interface EventInfo {
  nr: number;
  dystans: string;
  styl: string;
  plec: string;
  sessionDate: string; // ISO date from SESSION
}

// ─── Mappings ─────────────────────────────────────────────────────────────────

const STROKE_MAP: Record<string, string> = {
  FREE: 'dowolny',
  BREAST: 'klasyczny',
  BACK: 'grzbietowy',
  FLY: 'motylkowy',
  BUTTERFLY: 'motylkowy',
  MEDLEY: 'zmienny',
  INDIVIDUAL_MEDLEY: 'zmienny',
};

const COURSE_MAP: Record<string, string> = {
  LCM: '50m',
  SCM: '25m',
  SCY: '25y',
};

const GENDER_MAP: Record<string, string> = {
  F: 'Kobiet',
  M: 'Mężczyzn',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts ISO date "2026-05-16" to "16/5/2026" */
function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[3])}/${parseInt(m[2])}/${m[1]}`;
}

/** Normalizes athlete key: "Wąs Amelia" → "was_amelia" */
export function normalizeKey(lastname: string, firstname: string): string {
  const raw = `${lastname} ${firstname}`.toLowerCase();
  const ascii = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]/g, '');
  return ascii.trim().replace(/\s+/g, '_');
}

// ─── Core parser ─────────────────────────────────────────────────────────────

/**
 * Parses a single .lxf file buffer and returns athletes from the given club.
 * Merges results into the provided `output` map (mutates it).
 */
export function parseLxf(
  buffer: Buffer,
  clubName: string,
  output: ZawodnicyMap,
  timestamp: string
): void {
  // 1. Unzip
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => {
    const name = e.entryName.toLowerCase();
    return name.endsWith('.lef') || name.endsWith('.xml');
  });
  if (!xmlEntry) throw new Error('Brak pliku .lef/.xml w archiwum ZIP');

  const xmlStr = xmlEntry.getData().toString('utf-8');

  // 2. Parse XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) =>
      ['MEET', 'SESSION', 'EVENT', 'CLUB', 'ATHLETE', 'RESULT', 'HEAT'].includes(name),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = parser.parse(xmlStr) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meets: any[] = doc?.LENEX?.MEETS?.MEET ?? [];

  for (const meet of meets) {
    const meetName = String(meet['name'] ?? '');
    const meetCity = String(meet['city'] ?? '');
    const meetCourse = String(meet['course'] ?? '');
    const basen = COURSE_MAP[meetCourse] ?? meetCourse;

    // 3. Build eventid → EventInfo from SESSIONS
    const eventMap: Record<string, EventInfo> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions: any[] = meet?.SESSIONS?.SESSION ?? [];

    for (const session of sessions) {
      const sessionDate = String(session['date'] ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = session?.EVENTS?.EVENT ?? [];

      for (const ev of events) {
        const eventid = String(ev['eventid'] ?? '');
        const nr = parseInt(String(ev['number'] ?? '0'));
        const gender = String(ev['gender'] ?? '');
        const swimstyle = ev['SWIMSTYLE'] ?? {};
        const distance = String(swimstyle['distance'] ?? '');
        const stroke = String(swimstyle['stroke'] ?? '').toUpperCase();

        if (eventid && nr > 0) {
          eventMap[eventid] = {
            nr,
            dystans: distance ? `${distance}m` : '',
            styl: STROKE_MAP[stroke] ?? stroke.toLowerCase(),
            plec: GENDER_MAP[gender] ?? gender,
            sessionDate,
          };
        }
      }
    }

    // 4. Filter clubs and iterate athletes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clubs: any[] = meet?.CLUBS?.CLUB ?? [];

    for (const club of clubs) {
      const thisClubName = String(club['name'] ?? '');

      if (thisClubName.toLowerCase() !== clubName.toLowerCase()) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const athletes: any[] = club?.ATHLETES?.ATHLETE ?? [];

      for (const ath of athletes) {
        const firstname = String(ath['firstname'] ?? '');
        const lastname = String(ath['lastname'] ?? '');
        const birthdate = String(ath['birthdate'] ?? '');
        const rok = birthdate ? parseInt(birthdate.slice(0, 4)) || null : null;

        const key = normalizeKey(lastname, firstname);
        if (!key) continue;

        // Initialize athlete entry if not present
        if (!output[key]) {
          output[key] = {
            imie: firstname,
            nazwisko: lastname,
            rok_urodzenia: rok,
            klub: thisClubName,
            starty: [],
          };
        }

        // 5. Build starts from RESULTS
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results: any[] = ath?.RESULTS?.RESULT ?? [];

        for (const res of results) {
          const status = String(res['status'] ?? '').trim();
          if (status !== '') continue; // DNS / DNF / DSQ / WDR

          const swimtime = String(res['swimtime'] ?? '');
          if (!swimtime || swimtime === '-1') continue;

          const eventid = String(res['eventid'] ?? '');
          const evInfo = eventMap[eventid];
          if (!evInfo) continue;

          const lane = parseInt(String(res['lane'] ?? '0'));
          const points = res['points'] !== undefined ? parseInt(String(res['points'])) : NaN;

          output[key].starty.push({
            zawody: meetName,
            data: formatDate(evInfo.sessionDate),
            miejscowosc: meetCity,
            basen,
            konkurencja_nr: evInfo.nr,
            dystans: evInfo.dystans,
            styl: evInfo.styl,
            plec: evInfo.plec,
            tor: lane,
            czas: swimtime,
            punkty: isNaN(points) || points <= 0 ? null : points,
            timestamp_pobrania: timestamp,
          });
        }
      }
    }

    // 6. LENEX 2.x fallback: results under EVENT > RESULTS > RESULT with swimmerid
    // Only if no athletes found via clubs (rare, but preserve compatibility)
  }
}

/**
 * Processes multiple .lxf buffers and returns a merged ZawodnicyMap.
 */
export function processLxfFiles(
  files: { name: string; buffer: Buffer }[],
  clubName: string
): { result: ZawodnicyMap; errors: string[] } {
  const output: ZawodnicyMap = {};
  const errors: string[] = [];
  const timestamp = new Date().toISOString();

  for (const file of files) {
    try {
      parseLxf(file.buffer, clubName, output, timestamp);
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Sort starts by date then event number for each athlete
  for (const key of Object.keys(output)) {
    output[key].starty.sort((a, b) => {
      const da = a.data.split('/').reverse().join('');
      const db = b.data.split('/').reverse().join('');
      if (da !== db) return da.localeCompare(db);
      return a.konkurencja_nr - b.konkurencja_nr;
    });
  }

  return { result: output, errors };
}
