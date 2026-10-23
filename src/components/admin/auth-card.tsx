export function AuthCard({ title, appName, children }: { title: string; appName: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-serif text-xl font-semibold text-sage-800">{appName}</p>
        <div className="panel p-6 sm:p-8">
          <h1 className="mb-6 text-xl font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
