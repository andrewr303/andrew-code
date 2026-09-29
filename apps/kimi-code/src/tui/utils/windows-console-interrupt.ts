import { Key, matchesKey, type InputListenerResult } from '@moonshot-ai/pi-tui';

import { WINDOWS_CONSOLE_INTERRUPT_INJECT_MS } from '../constant/console-interrupt';

export interface WindowsConsoleInterruptUi {
  addInputListener(listener: (data: string) => InputListenerResult): () => void;
  injectInput(data: string): void;
}

export interface WindowsConsoleInterruptHandle {
  /** Map a console SIGINT/SIGBREAK onto a Ctrl+C key if stdin did not deliver one. */
  onConsoleSignal(): void;
  dispose(): void;
}

/**
 * Windows delivers Ctrl+C as SIGINT (and Ctrl+Break as SIGBREAK) even when
 * stdin is in raw mode. Registering a signal listener prevents Node's default
 * exit; this helper then synthesizes `\x03` only when the key itself never
 * arrives, so one keypress cannot look like the TUI's double-tap exit.
 */
export function installWindowsConsoleInterrupt(
  ui: WindowsConsoleInterruptUi,
  now: () => number = Date.now,
): WindowsConsoleInterruptHandle {
  let lastCtrlCKeyAt = 0;
  let pendingInject: ReturnType<typeof setTimeout> | undefined;

  const disposeInput = ui.addInputListener((data) => {
    if (data === '\x03' || matchesKey(data, Key.ctrl('c'))) {
      lastCtrlCKeyAt = now();
    }
  });

  const dispose = (): void => {
    disposeInput();
    if (pendingInject !== undefined) {
      clearTimeout(pendingInject);
      pendingInject = undefined;
    }
  };

  return {
    onConsoleSignal(): void {
      if (pendingInject !== undefined) {
        clearTimeout(pendingInject);
      }
      pendingInject = setTimeout(() => {
        pendingInject = undefined;
        if (now() - lastCtrlCKeyAt <= WINDOWS_CONSOLE_INTERRUPT_INJECT_MS) return;
        ui.injectInput('\x03');
      }, WINDOWS_CONSOLE_INTERRUPT_INJECT_MS);
    },
    dispose,
  };
}
