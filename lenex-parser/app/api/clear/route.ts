import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function DELETE(): Promise<NextResponse> {
  try {
    const files = await fs.readdir(DATA_DIR).catch(() => [] as string[]);
    const versioned = files.filter((f) => /^results_\d+\.json$/.test(f));
    await Promise.all(versioned.map((f) => fs.unlink(path.join(DATA_DIR, f))));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Błąd: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
