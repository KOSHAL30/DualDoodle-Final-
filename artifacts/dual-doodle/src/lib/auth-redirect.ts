const REDIRECT_KEY = "dd_redirect";

export function consumePostAuthRedirect(): string {
  const target = sessionStorage.getItem(REDIRECT_KEY);
  sessionStorage.removeItem(REDIRECT_KEY);

  if (target && (target === "/dashboard" || /^\/room\/[A-Za-z0-9]{6}$/.test(target))) {
    return target;
  }

  return "/dashboard";
}
