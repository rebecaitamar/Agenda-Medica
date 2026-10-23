"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">Algo no funcionó</h1>
      <p className="mt-3 text-ink-soft">No pudimos cargar esta página. Probá de nuevo en unos segundos.</p>
      <p className="mt-6">
        <button type="button" className="btn-primary" onClick={reset}>Reintentar</button>
      </p>
    </main>
  );
}
