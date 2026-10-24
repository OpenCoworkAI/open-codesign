/** Project only the Windows DPAPI-wrapped key, never cookies or other profile state. */
export function projectCredentialState(raw: string): string {
  try {
    const state = JSON.parse(raw) as { os_crypt?: { encrypted_key?: unknown } };
    const key = state.os_crypt?.encrypted_key;
    if (
      typeof key !== 'string' ||
      key.length > 16_384 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(key) ||
      Buffer.from(key, 'base64').subarray(0, 5).toString() !== 'DPAPI'
    )
      throw new Error();
    return JSON.stringify({ os_crypt: { encrypted_key: key } });
  } catch {
    throw new Error('BACKGROUND_MODEL_CREDENTIAL_STATE_INVALID');
  }
}
