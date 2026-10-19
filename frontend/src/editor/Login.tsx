import { useState, type FormEvent } from "react";
import { backend } from "./backend";

export function Login({ onLogin }: { onLogin: (user: string) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await backend.login(name.trim(), password));
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <form onSubmit={submit} className="w-[380px] space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div>
          <h1 className="text-xl font-semibold">Layout-editor</h1>
          <p className="mt-1 text-sm text-zinc-400">Logga in med ditt editorkonto.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-300">Namn</span>
          <input
            autoFocus
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-sky-500"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-300">Lösenord</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-sky-500"
          />
        </label>
        {error && <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button
          disabled={busy || !name.trim() || !password}
          className="w-full rounded-md bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {busy ? "Loggar in…" : "Logga in"}
        </button>
        <p className="text-xs text-zinc-500">
          Konton skapas på servern: <code className="text-zinc-400">python -m backend.users add &lt;namn&gt;</code>
        </p>
      </form>
    </div>
  );
}
