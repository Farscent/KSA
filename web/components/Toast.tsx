export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="animate-toastin absolute bottom-5 right-5 rounded-md px-4 py-2.5 text-xs text-white"
      style={{ background: "var(--color-header)", boxShadow: "0 8px 20px rgba(0,0,0,.18)" }}
    >
      {message}
    </div>
  );
}
