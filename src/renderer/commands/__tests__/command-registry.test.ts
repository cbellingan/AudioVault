import { describe, it, expect, vi } from 'vitest';
import { CommandRegistry } from '../command-registry';

describe('Slice F02: Typed Command Registry and Keyboard Routing', () => {
  it('registers handlers and evaluates eligibility based on context', () => {
    const registry = new CommandRegistry();
    const copySpy = vi.fn();

    registry.register({
      id: 'copy-transcript',
      label: 'Copy Transcript',
      shortcut: 'Shift+Cmd+C',
      isEnabled: (ctx) => ctx.hasTranscript && ctx.activeView === 'detail',
      execute: copySpy,
    });

    // When not in detail view or no transcript, isEnabled is false
    expect(registry.isEnabled('copy-transcript')).toBe(false);
    expect(registry.execute('copy-transcript')).toBe(false);
    expect(copySpy).not.toHaveBeenCalled();

    // Update context to detail view with transcript
    registry.updateContext({ activeView: 'detail', hasTranscript: true });
    expect(registry.isEnabled('copy-transcript')).toBe(true);
    expect(registry.execute('copy-transcript')).toBe(true);
    expect(copySpy).toHaveBeenCalledTimes(1);
  });

  it('prevents Space key from toggling playback while typing in text inputs', () => {
    const registry = new CommandRegistry();
    const playSpy = vi.fn();

    registry.register({
      id: 'play-pause',
      label: 'Play / Pause',
      shortcut: 'Space',
      isEnabled: () => true,
      execute: playSpy,
    });

    // Mock an input element target
    const inputElement = { tagName: 'INPUT', isContentEditable: false } as HTMLElement;
    const typingEvent = {
      code: 'Space',
      key: ' ',
      target: inputElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const handledInInput = registry.handleKeyDown(typingEvent);
    expect(handledInInput).toBe(false);
    expect(playSpy).not.toHaveBeenCalled();

    // Normal non-input target (e.g. body or div)
    const bodyElement = { tagName: 'DIV', isContentEditable: false } as HTMLElement;
    const normalEvent = {
      code: 'Space',
      key: ' ',
      target: bodyElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const handledOutside = registry.handleKeyDown(normalEvent);
    expect(handledOutside).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(normalEvent.preventDefault).toHaveBeenCalled();
  });

  it('handles navigation shortcuts: Cmd+K, Cmd+1, Cmd+2, Cmd+O', () => {
    const registry = new CommandRegistry();
    const searchSpy = vi.fn();
    const libSpy = vi.fn();
    const impSpy = vi.fn();
    const openSpy = vi.fn();

    registry.register({ id: 'search-focus', label: 'Search', isEnabled: () => true, execute: searchSpy });
    registry.register({ id: 'nav-library', label: 'Library', isEnabled: () => true, execute: libSpy });
    registry.register({ id: 'nav-imports', label: 'Imports', isEnabled: () => true, execute: impSpy });
    registry.register({ id: 'import-audio', label: 'Import', isEnabled: () => true, execute: openSpy });

    // Cmd+K
    registry.handleKeyDown({ metaKey: true, key: 'k', preventDefault: vi.fn() } as any);
    expect(searchSpy).toHaveBeenCalledTimes(1);

    // Cmd+1
    registry.handleKeyDown({ metaKey: true, key: '1', preventDefault: vi.fn() } as any);
    expect(libSpy).toHaveBeenCalledTimes(1);

    // Cmd+2
    registry.handleKeyDown({ metaKey: true, key: '2', preventDefault: vi.fn() } as any);
    expect(impSpy).toHaveBeenCalledTimes(1);

    // Cmd+O
    registry.handleKeyDown({ metaKey: true, key: 'o', preventDefault: vi.fn() } as any);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers star rating commands rate-0 through rate-5 when pressing 0-5 outside text inputs', () => {
    const registry = new CommandRegistry();
    const rateSpies: Record<number, any> = {};

    for (let r = 0; r <= 5; r++) {
      rateSpies[r] = vi.fn();
      registry.register({
        id: `rate-${r}` as any,
        label: `Rate ${r}`,
        isEnabled: () => true,
        execute: rateSpies[r],
      });
    }

    // Pressing '3' outside text editing
    const bodyElement = { tagName: 'DIV', isContentEditable: false } as HTMLElement;
    const event3 = {
      key: '3',
      target: bodyElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = registry.handleKeyDown(event3);
    expect(handled).toBe(true);
    expect(rateSpies[3]).toHaveBeenCalledTimes(1);
    expect(event3.preventDefault).toHaveBeenCalled();

    // Pressing '0' to clear rating
    const event0 = {
      key: '0',
      target: bodyElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    registry.handleKeyDown(event0);
    expect(rateSpies[0]).toHaveBeenCalledTimes(1);

    // Typing '3' inside an input element should NOT trigger rate-3
    const inputElement = { tagName: 'INPUT', isContentEditable: false } as HTMLElement;
    const inputEvent = {
      key: '3',
      target: inputElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const handledInInput = registry.handleKeyDown(inputEvent);
    expect(handledInInput).toBe(false);
    expect(rateSpies[3]).toHaveBeenCalledTimes(1); // Still 1 from before
  });

  it('handles Option+Cmd+C (copy-metadata) and Option+Cmd+V (paste-metadata) shortcuts', () => {
    const registry = new CommandRegistry();
    const copySpy = vi.fn();
    const pasteSpy = vi.fn();

    registry.register({
      id: 'copy-metadata',
      label: 'Copy Artist & Location',
      isEnabled: () => true,
      execute: copySpy,
    });

    registry.register({
      id: 'paste-metadata',
      label: 'Paste Artist & Location',
      isEnabled: (ctx) => Boolean(ctx.hasCopiedMetadata),
      execute: pasteSpy,
    });

    // Press Option+Cmd+C
    const bodyElement = { tagName: 'DIV', isContentEditable: false } as HTMLElement;
    const copyEvent = {
      metaKey: true,
      altKey: true,
      key: 'c',
      target: bodyElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const copyHandled = registry.handleKeyDown(copyEvent);
    expect(copyHandled).toBe(true);
    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(copyEvent.preventDefault).toHaveBeenCalled();

    // Paste metadata when hasCopiedMetadata is false -> should not execute
    const pasteEvent = {
      metaKey: true,
      altKey: true,
      key: 'v',
      target: bodyElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const pasteHandledBeforeCopy = registry.handleKeyDown(pasteEvent);
    expect(pasteHandledBeforeCopy).toBe(false);
    expect(pasteSpy).not.toHaveBeenCalled();

    // Set hasCopiedMetadata to true and test paste
    registry.updateContext({ hasCopiedMetadata: true });
    const pasteHandledAfterCopy = registry.handleKeyDown(pasteEvent);
    expect(pasteHandledAfterCopy).toBe(true);
    expect(pasteSpy).toHaveBeenCalledTimes(1);

    // Press Option+Cmd+C inside text input should not trigger
    const inputElement = { tagName: 'INPUT', isContentEditable: false } as HTMLElement;
    const inputCopyEvent = {
      metaKey: true,
      altKey: true,
      key: 'c',
      target: inputElement,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const inputHandled = registry.handleKeyDown(inputCopyEvent);
    expect(inputHandled).toBe(false);
    expect(copySpy).toHaveBeenCalledTimes(1);
  });

  it('handles undo, redo, cut-selection, trim-to-selection, and split-clip commands', () => {
    const registry = new CommandRegistry();
    const undoSpy = vi.fn();
    const redoSpy = vi.fn();
    const cutSpy = vi.fn();
    const trimSpy = vi.fn();
    const splitSpy = vi.fn();

    registry.register({
      id: 'undo',
      label: 'Undo',
      isEnabled: (ctx) => Boolean(ctx.canUndo),
      execute: undoSpy,
    });
    registry.register({
      id: 'redo',
      label: 'Redo',
      isEnabled: (ctx) => Boolean(ctx.canRedo),
      execute: redoSpy,
    });
    registry.register({
      id: 'cut-selection',
      label: 'Cut Selection',
      isEnabled: (ctx) => Boolean(ctx.hasSelectionRange),
      execute: cutSpy,
    });
    registry.register({
      id: 'trim-to-selection',
      label: 'Trim to Selection',
      isEnabled: (ctx) => Boolean(ctx.hasSelectionRange),
      execute: trimSpy,
    });
    registry.register({
      id: 'split-clip',
      label: 'Split Clip',
      isEnabled: (ctx) => Boolean(ctx.hasSelectionRange),
      execute: splitSpy,
    });

    const bodyElement = { tagName: 'DIV', isContentEditable: false } as HTMLElement;

    // Initially canUndo is false -> Cmd+Z does not trigger
    registry.handleKeyDown({ metaKey: true, key: 'z', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(undoSpy).not.toHaveBeenCalled();

    // Enable canUndo -> Cmd+Z triggers
    registry.updateContext({ canUndo: true });
    registry.handleKeyDown({ metaKey: true, key: 'z', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(undoSpy).toHaveBeenCalledTimes(1);

    // Redo via Shift+Cmd+Z
    registry.updateContext({ canRedo: true });
    registry.handleKeyDown({ metaKey: true, shiftKey: true, key: 'z', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(redoSpy).toHaveBeenCalledTimes(1);

    // Backspace / Delete with hasSelectionRange triggers cut-selection
    registry.updateContext({ hasSelectionRange: true });
    registry.handleKeyDown({ key: 'Backspace', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(cutSpy).toHaveBeenCalledTimes(1);

    // Alt+Cmd+T triggers trim-to-selection
    registry.handleKeyDown({ metaKey: true, altKey: true, key: 't', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(trimSpy).toHaveBeenCalledTimes(1);

    // Cmd+S with hasSelectionRange triggers split-clip
    registry.handleKeyDown({ metaKey: true, key: 's', target: bodyElement, preventDefault: vi.fn() } as any);
    expect(splitSpy).toHaveBeenCalledTimes(1);
  });
});

