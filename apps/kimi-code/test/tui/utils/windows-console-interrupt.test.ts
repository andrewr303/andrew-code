import { afterEach, describe, expect, it, vi } from 'vitest';

import { WINDOWS_CONSOLE_INTERRUPT_INJECT_MS } from '#/tui/constant/console-interrupt';
import { installWindowsConsoleInterrupt } from '#/tui/utils/windows-console-interrupt';

describe('installWindowsConsoleInterrupt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeUi() {
    const listeners = new Set<(data: string) => void>();
    return {
      injectInput: vi.fn(),
      addInputListener: (listener: (data: string) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      emit(data: string) {
        for (const listener of listeners) listener(data);
      },
    };
  }

  it('synthesizes Ctrl+C when a console signal arrives with no key', () => {
    vi.useFakeTimers();
    const ui = makeUi();
    const handle = installWindowsConsoleInterrupt(ui, () => Date.now());

    handle.onConsoleSignal();
    expect(ui.injectInput).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WINDOWS_CONSOLE_INTERRUPT_INJECT_MS);
    expect(ui.injectInput).toHaveBeenCalledOnce();
    expect(ui.injectInput).toHaveBeenCalledWith('\x03');

    handle.dispose();
  });

  it('does not synthesize Ctrl+C when the key already arrived', () => {
    vi.useFakeTimers();
    const ui = makeUi();
    const handle = installWindowsConsoleInterrupt(ui, () => Date.now());

    ui.emit('\x03');
    handle.onConsoleSignal();
    vi.advanceTimersByTime(WINDOWS_CONSOLE_INTERRUPT_INJECT_MS);

    expect(ui.injectInput).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('does not synthesize Ctrl+C when the key arrives during the inject delay', () => {
    vi.useFakeTimers();
    const ui = makeUi();
    const handle = installWindowsConsoleInterrupt(ui, () => Date.now());

    handle.onConsoleSignal();
    ui.emit('\x03');
    vi.advanceTimersByTime(WINDOWS_CONSOLE_INTERRUPT_INJECT_MS);

    expect(ui.injectInput).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('dispose cancels a pending inject', () => {
    vi.useFakeTimers();
    const ui = makeUi();
    const handle = installWindowsConsoleInterrupt(ui, () => Date.now());

    handle.onConsoleSignal();
    handle.dispose();
    vi.advanceTimersByTime(WINDOWS_CONSOLE_INTERRUPT_INJECT_MS);

    expect(ui.injectInput).not.toHaveBeenCalled();
  });
});
