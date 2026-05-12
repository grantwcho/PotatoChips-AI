export const GITHUB_AUTH_ORIGIN_STORAGE_KEY =
  "potatochipsai:github-auth-origin-url";

export function getCurrentGithubAuthOrigin() {
  if (typeof window === "undefined") {
    return "/";
  }

  const pathname = window.location.pathname || "/";
  const search = window.location.search || "";
  const hash = window.location.hash || "";

  return `${pathname}${search}${hash}`;
}
