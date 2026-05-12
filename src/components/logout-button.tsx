"use client";

import { useState } from "react";

const BASE_BUTTON_CLASS =
  "px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted transition-colors hover:text-foreground disabled:opacity-60";

export function LogoutButton({ className = "" }: { className?: string }) {
  const [isPending, setIsPending] = useState(false);

  const handleLogout = async () => {
    setIsPending(true);

    try {
      const response = await fetch("/api/auth/session", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to sign out.");
      }

      window.location.replace("/");
    } catch {
      setIsPending(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={isPending}
      className={`${BASE_BUTTON_CLASS} ${className}`.trim()}
    >
      {isPending ? "Signing out" : "Sign out"}
    </button>
  );
}
