export type CommandId =
  | 'import-audio'
  | 'import-folder'
  | 'new-recording'
  | 'new-collection'
  | 'export'
  | 'find-in-transcript'
  | 'copy-transcript'
  | 'play-pause'
  | 'skip-back'
  | 'skip-forward'
  | 'transcribe'
  | 'rename'
  | 'add-to-collection'
  | 'mark-reviewed'
  | 'toggle-favorite'
  | 'save-excerpt'
  | 'show-in-finder'
  | 'nav-library'
  | 'nav-imports'
  | 'nav-settings'
  | 'show-details'
  | 'search-focus'
  | 'about'
  | 'help-getting-started'
  | 'help-shortcuts';

export interface CommandContext {
  activeView: 'library' | 'detail' | 'imports' | 'settings' | 'record';
  activeClipId?: string;
  hasSelectedClips: boolean;
  selectedCount: number;
  hasTranscript: boolean;
  isPlaying: boolean;
  isModalOpen: boolean;
}

export interface CommandHandler {
  id: CommandId;
  label: string;
  shortcut?: string;
  isEnabled: (ctx: CommandContext) => boolean;
  execute: () => void;
}

export class CommandRegistry {
  private handlers: Map<CommandId, CommandHandler> = new Map();
  private context: CommandContext = {
    activeView: 'library',
    hasSelectedClips: false,
    selectedCount: 0,
    hasTranscript: false,
    isPlaying: false,
    isModalOpen: false,
  };

  public updateContext(newContext: Partial<CommandContext>) {
    this.context = { ...this.context, ...newContext };
  }

  public getContext(): CommandContext {
    return { ...this.context };
  }

  public register(handler: CommandHandler) {
    this.handlers.set(handler.id, handler);
  }

  public unregister(id: CommandId) {
    this.handlers.delete(id);
  }

  public isEnabled(id: CommandId): boolean {
    const handler = this.handlers.get(id);
    if (!handler) return false;
    return handler.isEnabled(this.context);
  }

  public execute(id: CommandId): boolean {
    const handler = this.handlers.get(id);
    if (!handler) {
      console.warn(`[CommandRegistry] No handler registered for command: ${id}`);
      return false;
    }
    if (!handler.isEnabled(this.context)) {
      console.warn(`[CommandRegistry] Command ${id} is disabled in current context.`);
      return false;
    }
    handler.execute();
    return true;
  }

  /**
   * Evaluates keyboard events and executes registered commands.
   * Ensures Space does NOT toggle playback while editing in input elements.
   */
  public handleKeyDown(e: KeyboardEvent): boolean {
    const target = e.target as HTMLElement | null;
    const isEditingText =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    // Global: Escape closes modals / clears selection
    if (e.key === 'Escape') {
      return false;
    }

    // Cmd / Ctrl shortcuts
    if (e.metaKey || e.ctrlKey) {
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        return this.execute('search-focus');
      }
      if (key === '1' && !e.shiftKey) {
        e.preventDefault();
        return this.execute('nav-library');
      }
      if (key === '2' && !e.shiftKey) {
        e.preventDefault();
        return this.execute('nav-imports');
      }
      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        return this.execute('import-audio');
      }
      if (key === 'o' && e.shiftKey) {
        e.preventDefault();
        return this.execute('import-folder');
      }
      if (key === 'r' && e.shiftKey) {
        e.preventDefault();
        return this.execute('new-recording');
      }
      if (key === 'n' && e.shiftKey) {
        e.preventDefault();
        return this.execute('new-collection');
      }
      if (key === 'e' && e.shiftKey) {
        e.preventDefault();
        return this.execute('export');
      }
      if (key === 't' && e.shiftKey) {
        e.preventDefault();
        return this.execute('transcribe');
      }
      if (key === 'c' && e.shiftKey) {
        e.preventDefault();
        return this.execute('copy-transcript');
      }
      if (key === 'f' && !e.shiftKey && this.context.activeView === 'detail') {
        e.preventDefault();
        return this.execute('find-in-transcript');
      }
      if (key === 'd' && !e.shiftKey) {
        e.preventDefault();
        return this.execute('show-details');
      }
      if (e.key === ',') {
        e.preventDefault();
        return this.execute('nav-settings');
      }
    }

    // Playback outside text editing
    if (!isEditingText && !this.context.isModalOpen) {
      if (e.code === 'Space') {
        e.preventDefault();
        return this.execute('play-pause');
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        return this.execute('skip-back');
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        return this.execute('skip-forward');
      }
    }

    return false;
  }
}

export const commandRegistry = new CommandRegistry();
