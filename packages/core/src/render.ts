/** Render untrusted text without allowing it to control a terminal. */
export function escapeTerminalControls(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => {
    const codePoint = character.codePointAt(0)!;
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  });
}
