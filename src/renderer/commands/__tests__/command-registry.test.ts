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
});
