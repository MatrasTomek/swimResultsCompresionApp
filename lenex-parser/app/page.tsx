'use client';

import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'done' | 'error';

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [clubName, setClubName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const lxf = Array.from(incoming).filter((f) =>
      f.name.toLowerCase().endsWith('.lxf')
    );
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...lxf.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length || !clubName.trim()) return;

    setStatus('loading');
    setMessage('');

    const form = new FormData();
    form.append('clubName', clubName.trim());
    files.forEach((f) => form.append('files', f));

    try {
      const res = await fetch('/api/process', { method: 'POST', body: form });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? res.statusText);
      }

      const athleteCount = res.headers.get('X-Athlete-Count') ?? '?';
      const errorsRaw = res.headers.get('X-Errors') ?? '';
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zawodnicy_${clubName.trim()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      let msg = `Pobrano JSON dla ${athleteCount} zawodnika/ów z klubu „${clubName.trim()}".`;
      if (errorsRaw) {
        const errs: string[] = JSON.parse(errorsRaw);
        msg += ` Błędy (${errs.length}): ${errs.join('; ')}`;
      }
      setStatus('done');
      setMessage(msg);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const canSubmit = files.length > 0 && clubName.trim().length > 0 && status !== 'loading';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
      <main className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl shadow-md p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            LENEX → JSON
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Wgraj pliki <code>.lxf</code> i podaj nazwę klubu, aby pobrać plik{' '}
            <code>zawodnicy.json</code>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors
              ${isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-zinc-300 dark:border-zinc-700 hover:border-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
          >
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Przeciągnij pliki <span className="font-semibold">.lxf</span> tutaj
            </p>
            <p className="mt-1 text-xs text-zinc-400">lub kliknij, aby wybrać</p>
            <input
              ref={inputRef}
              type="file"
              accept=".lxf"
              multiple
              className="sr-only"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2"
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-200">
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.name)}
                    className="ml-3 shrink-0 text-zinc-400 hover:text-red-500 transition-colors"
                    aria-label={`Usuń ${f.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Club name */}
          <div>
            <label
              htmlFor="clubName"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
            >
              Nazwa klubu (dokładna)
            </label>
            <input
              id="clubName"
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="np. Olimpijczyk Brzesko"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800
                         text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white
                       hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {status === 'loading' ? 'Przetwarzanie…' : 'Generuj i pobierz JSON'}
          </button>
        </form>

        {/* Status message */}
        {message && (
          <p
            className={`rounded-lg px-4 py-3 text-sm ${
              status === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
            }`}
          >
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
