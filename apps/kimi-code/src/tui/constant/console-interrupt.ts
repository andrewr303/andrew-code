// Windows delivers Ctrl+C as SIGINT and often also as `\x03`. Wait this long
// before synthesizing a Ctrl+C key so a real keypress is not counted twice.
export const WINDOWS_CONSOLE_INTERRUPT_INJECT_MS = 30;
