import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">No encontramos esta página</h1>
      <p className="mt-3 text-ink-soft">Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <p className="mt-6">
        <Link href="/" className="btn-primary">Ir al inicio</Link>
      </p>
    </main>
  );
}
