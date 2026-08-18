export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-bg">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
