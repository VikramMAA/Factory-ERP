// Supabase Auth has no native username provider — it authenticates on email.
// Login uses usernames throughout the UI; this is the only place that knows
// they're actually synthetic emails under the hood. Never show this domain
// to a user, and never derive a username from a display name (SPEC.md
// discussion: renaming someone must never break their ability to log in).
export const USERNAME_EMAIL_DOMAIN = '@rewind.local'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${USERNAME_EMAIL_DOMAIN}`
}
