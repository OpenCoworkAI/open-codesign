import { useEffect } from 'react';

export interface KeyBinding {
  combo: string;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  const expectMod = parts.includes('mod');
  const expectShift = parts.includes('shift');
  const expectAlt = parts.includes('alt');
  const key = parts[parts.length - 1] ?? '';

  const modPressed = e.metaKey || e.ctrlKey;
  if (expectMod !== modPressed) return false;
  if (expectShift !== e.shiftKey) return false;
  if (expectAlt !== e.altKey) return false;

  const eventKey = e.key.toLowerCase();
  if (key === 'enter') return eventKey === 'enter';
  if (key === 'escape' || key === 'esc') return eventKey === 'escape';
  return eventKey === key;
}

export function useKeyboard(bindings: KeyBinding[]): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      for (const b of bindings) {
        if (matches(e, b.combo)) {
          if (b.preventDefault !== false) e.preventDefault();
          b.handler(e);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings]);
}
