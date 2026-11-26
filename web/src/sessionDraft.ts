export function readDraft<T>(key: string): T | undefined {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) as T : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraft(key: string, value: unknown) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The workflow remains usable with browser storage disabled.
  }
}
