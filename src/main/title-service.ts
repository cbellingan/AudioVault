import path from 'path';

export class TitleService {
  private generatorPromise: Promise<any> | null = null;
  private isInitialized = false;

  /**
   * Lazily loads the quantized local instruction LLM on-device.
   * Model: Xenova/LaMini-Flan-T5-77M (~40MB quantized ONNX, cached locally).
   */
  private async getGenerator() {
    if (!this.generatorPromise) {
      this.generatorPromise = (async () => {
        try {
          let transformersModule: any;
          try {
            transformersModule = await import('@xenova/transformers');
          } catch {
            transformersModule = await (new Function('return import("@xenova/transformers")')());
          }
          const { pipeline } = transformersModule as typeof import('@xenova/transformers');

          const p = await pipeline(
            'text2text-generation',
            'Xenova/LaMini-Flan-T5-77M',
            {
              quantized: true,
            }
          );
          this.isInitialized = true;
          return p;
        } catch (err) {
          console.error('[TitleService] Failed to load local LLM model:', err);
          return null;
        }
      })();
    }
    return this.generatorPromise;
  }

  /**
   * Cleans transcript text by stripping automated prefixes, audio tags, and quotes.
   */
  public cleanTranscript(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/^\[[^\]]+\]:\s*"?/, '')
      .replace(/"?$/, '')
      .replace(/\.\.\.short take detected\.\.\./gi, '')
      .replace(/\[(?:whisper|local whisper|yamnet)[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generates a concise 2 to 4 word title from transcribed speech text.
   * Uses local LLM with an organic heuristic fallback.
   */
  public async generateShortTitle(transcript: string): Promise<string> {
    const cleanText = this.cleanTranscript(transcript);
    if (!cleanText || cleanText.length < 5) {
      return '';
    }

    try {
      const generator = await this.getGenerator();
      if (generator) {
        const prompt = `Summarize this speech into a short 2 to 4 word title: ${cleanText.slice(0, 300)}`;
        const output = await generator(prompt, {
          max_new_tokens: 10,
          temperature: 0.1,
        });

        const rawGenerated = output[0]?.generated_text || '';
        let cleaned = rawGenerated
          .replace(/^(title|summary|name|topic|headline):\s*/i, '')
          .replace(/[\"\'\.\,\!\?]/g, '')
          .trim();

        // Ensure 2 to 5 words max
        const words: string[] = cleaned.split(/\s+/).filter(Boolean).slice(0, 5);
        if (words.length > 0) {
          // Title Case formatting
          return words
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
        }
      }
    } catch (err) {
      console.warn('[TitleService] LLM generation failed, using heuristic fallback:', err);
    }

    // Heuristic fallback: extract salient content words
    return this.heuristicTitleFallback(cleanText);
  }

  /**
   * Formats a composite title combining the hardware filename with the generated title:
   * e.g., "260831-185613 - Pushing Feel"
   */
  public async generateCompositeTitle(
    currentTitleOrFilename: string,
    transcript: string
  ): Promise<string> {
    const baseName = this.extractBaseFileName(currentTitleOrFilename);
    const shortTitle = await this.generateShortTitle(transcript);

    if (!shortTitle) {
      return baseName;
    }

    return `${baseName} - ${shortTitle}`;
  }

  /**
   * Extracts the root hardware recorder filename (e.g. "260831-185613" from "260831-185613 - Old Title.WAV")
   */
  public extractBaseFileName(input: string): string {
    if (!input) return 'Take';
    // Strip path and extension
    let base = path.basename(input).replace(/\.[^/.]+$/, '');
    // If it already contains " - ", keep the primary prefix
    if (base.includes(' - ')) {
      base = base.split(' - ')[0].trim();
    }
    return base;
  }

  /**
   * Lightweight fallback for extracting salient keywords from text if LLM is unavailable.
   */
  private heuristicTitleFallback(text: string): string {
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to',
      'for', 'of', 'it', 'its', 'we', 'you', 'they', 'i', 'im', 'that', 'this', 'was', 'so',
      'yeah', 'yes', 'no', 'okay', 'right', 'like', 'just', 'well', 'um', 'uh', 'there'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    if (words.length === 0) return '';

    const selected = words.slice(0, 3);
    return selected
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
