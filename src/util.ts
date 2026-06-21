/** Normalise an unknown thrown value into a human-readable message. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
