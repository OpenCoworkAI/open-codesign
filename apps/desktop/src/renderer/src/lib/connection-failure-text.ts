/** Prefer a translated hint key from the connection probe; otherwise show the raw hint. */
export function connectionFailureText(
  translate: (key: string) => string,
  failure: {
    hint?: string | undefined;
    hintKey?: string | undefined;
    message?: string | undefined;
  },
): string {
  if (failure.hintKey !== undefined && failure.hintKey.length > 0) {
    return translate(failure.hintKey);
  }
  return failure.hint ?? failure.message ?? '';
}
