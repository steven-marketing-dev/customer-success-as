"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Login failed");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "linear-gradient(160deg, #FAF9F6 0%, #e8f6f3 50%, #FAF9F6 100%)" }}>
      {/* Decorative blobs */}
      <div className="fixed top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.08]" style={{ background: "radial-gradient(circle, #33b29c, transparent 70%)" }} />
      <div className="fixed bottom-[-15%] left-[-8%] w-[400px] h-[400px] rounded-full opacity-[0.06]" style={{ background: "radial-gradient(circle, #33b29c, transparent 70%)" }} />

      <div className="w-full max-w-[420px] fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl mint-gradient flex items-center justify-center mb-4" style={{ boxShadow: "0 4px 14px rgba(51, 178, 156, 0.25)" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 9h8M8 13h5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl font-800 text-[#2D3142] tracking-tight">Customer Success KB</h1>
          <p className="text-sm text-[#6B7280] mt-1">Your team's knowledge, always ready</p>
        </div>

        {/* Card */}
        <div className="rounded-[20px] bg-white p-8 sm:p-10" style={{ boxShadow: "0 4px 24px rgba(45, 49, 66, 0.06), 0 1px 3px rgba(45, 49, 66, 0.04)" }}>
          <h2 className="font-display text-xl font-700 text-[#2D3142] mb-6">Welcome back</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-[#2D3142] mb-1.5">Username</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="input-warm" placeholder="Enter your username" required autoFocus />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#2D3142] mb-1.5">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="input-warm" placeholder="Enter your password" required />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl px-4 py-3 fade-up" style={{ background: "#FEF2F1", border: "1px solid #FECACA" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#F97066" }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="white"><path d="M5 1v4M5 7v1" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </div>
                <p className="text-sm text-[#DC2626]">{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full mt-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #33b29c 0%, #2a9483 100%)", boxShadow: loading ? "none" : "0 4px 14px rgba(51, 178, 156, 0.25)" }}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  Signing in...
                </span>
              ) : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[#A0A5B2]">Powered by AI — Built for your CS team</p>
      </div>
    </div>
  );
}
