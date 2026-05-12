"use client";

import { signIn } from "next-auth/react";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
  GITHUB_AUTH_ORIGIN_STORAGE_KEY,
  getCurrentGithubAuthOrigin,
} from "@/lib/github-auth-origin";

export function GitHubConnectButton({
  callbackUrl,
  className = "",
  intentStorageKey,
  label,
  style,
}: {
  callbackUrl: string;
  className?: string;
  intentStorageKey?: string;
  label: string;
  style?: CSSProperties;
}) {
  const [isPending, setIsPending] = useState(false);

  function handleClick() {
    setIsPending(true);

    window.sessionStorage.setItem(
      GITHUB_AUTH_ORIGIN_STORAGE_KEY,
      getCurrentGithubAuthOrigin()
    );

    if (intentStorageKey) {
      window.sessionStorage.setItem(intentStorageKey, "github");
    }

    void signIn("github", { callbackUrl }).catch(() => {
      if (intentStorageKey) {
        window.sessionStorage.removeItem(intentStorageKey);
      }

      setIsPending(false);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`marketing-primary-button marketing-hero-button relative z-30 min-w-[13rem] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      style={style}
    >
      <span>
        <span className="inline-flex items-center gap-2.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5 shrink-0"
          >
            <path d="M12 1.5C6.201 1.5 1.5 6.201 1.5 12c0 4.64 3.01 8.577 7.187 9.965.525.096.713-.228.713-.506 0-.249-.009-.907-.014-1.78-2.923.635-3.54-1.408-3.54-1.408-.478-1.214-1.167-1.538-1.167-1.538-.955-.653.072-.64.072-.64 1.056.074 1.612 1.085 1.612 1.085.938 1.607 2.461 1.143 3.06.874.095-.68.367-1.144.667-1.407-2.333-.265-4.785-1.167-4.785-5.193 0-1.147.409-2.085 1.08-2.82-.108-.265-.468-1.333.103-2.778 0 0 .88-.281 2.884 1.077A10.03 10.03 0 0 1 12 6.57c.892.004 1.79.12 2.628.354 2.003-1.358 2.882-1.077 2.882-1.077.572 1.445.212 2.513.104 2.778.672.735 1.079 1.673 1.079 2.82 0 4.036-2.456 4.925-4.797 5.184.377.324.713.962.713 1.939 0 1.4-.012 2.529-.012 2.873 0 .281.188.607.719.504A10.503 10.503 0 0 0 22.5 12c0-5.799-4.701-10.5-10.5-10.5Z" />
          </svg>
          {isPending ? "Connecting to GitHub..." : label}
        </span>
      </span>
    </button>
  );
}
