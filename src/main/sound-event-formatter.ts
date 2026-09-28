import { SoundEvent } from '../shared/types';

export interface NormalizedSoundLabel {
  cleanLabel: string;
  category: 'nature' | 'animal' | 'music' | 'vocal' | 'human' | 'environment' | 'vehicle' | 'misc';
  icon: string;
  isProminentCue: boolean; // Whether it warrants inserting as a sound cue into speech/music tracks (e.g. horse neigh, applause)
}

/**
 * Maps raw AudioSet / YAMNet taxonomy labels to friendly, natural phrases with emojis and acoustic categories.
 */
export function normalizeSoundLabel(rawLabel: string): NormalizedSoundLabel {
  const lower = (rawLabel || '').trim().toLowerCase();

  // 1. Birds & Wildlife
  if (lower.includes('owl')) {
    return { cleanLabel: 'Owl call', category: 'animal', icon: '🦉', isProminentCue: true };
  }
  if (
    lower.includes('bird') ||
    lower.includes('chirp') ||
    lower.includes('tweet') ||
    lower.includes('songbird') ||
    lower.includes('crow') ||
    lower.includes('pigeon') ||
    lower.includes('dove')
  ) {
    return { cleanLabel: 'Birds chirping', category: 'nature', icon: '🐦', isProminentCue: true };
  }
  if (
    lower.includes('horse') ||
    lower.includes('neigh') ||
    lower.includes('whinny') ||
    lower.includes('clip-clop')
  ) {
    return { cleanLabel: 'Horse neigh', category: 'animal', icon: '🐴', isProminentCue: true };
  }
  if (lower.includes('dog') || lower.includes('bark') || lower.includes('howl') || lower.includes('growl')) {
    return { cleanLabel: 'Dog barking', category: 'animal', icon: '🐕', isProminentCue: true };
  }
  if (lower.includes('cat') || lower.includes('purr') || lower.includes('meow')) {
    return { cleanLabel: 'Cat', category: 'animal', icon: '🐱', isProminentCue: true };
  }
  if (lower.includes('cricket')) {
    return { cleanLabel: 'Crickets chirping', category: 'nature', icon: '🦗', isProminentCue: true };
  }
  if (lower.includes('frog') || lower.includes('croak') || lower.includes('toad')) {
    return { cleanLabel: 'Frogs croaking', category: 'nature', icon: '🐸', isProminentCue: true };
  }
  if (lower.includes('insect') || lower.includes('bee') || lower.includes('buzz') || lower.includes('fly')) {
    return { cleanLabel: 'Insects buzzing', category: 'nature', icon: '🐝', isProminentCue: true };
  }
  if (lower.includes('animal') || lower.includes('wildlife') || lower.includes('livestock')) {
    return { cleanLabel: 'Animal sounds', category: 'animal', icon: '🐾', isProminentCue: true };
  }

  // 2. Weather & Elements
  if (lower.includes('wind')) {
    return { cleanLabel: 'Wind blowing', category: 'nature', icon: '💨', isProminentCue: false };
  }
  if (lower.includes('rain') || lower.includes('raindrop') || lower.includes('drizzle')) {
    return { cleanLabel: 'Rain falling', category: 'nature', icon: '🌧️', isProminentCue: true };
  }
  if (lower.includes('thunder') || lower.includes('lightning') || lower.includes('storm')) {
    return { cleanLabel: 'Thunder', category: 'nature', icon: '⚡', isProminentCue: true };
  }
  if (lower.includes('water') || lower.includes('stream') || lower.includes('river') || lower.includes('ocean') || lower.includes('wave')) {
    return { cleanLabel: 'Water / Stream flowing', category: 'nature', icon: '🌊', isProminentCue: false };
  }
  if (lower.includes('fire') || lower.includes('crackling')) {
    return { cleanLabel: 'Campfire crackling', category: 'nature', icon: '🔥', isProminentCue: true };
  }

  // 3. Music & Instruments
  if (lower.includes('guitar') || lower.includes('plucked string')) {
    return { cleanLabel: 'Acoustic guitar', category: 'music', icon: '🎸', isProminentCue: false };
  }
  if (lower.includes('piano') || lower.includes('keyboard')) {
    return { cleanLabel: 'Piano', category: 'music', icon: '🎹', isProminentCue: false };
  }
  if (lower.includes('drum') || lower.includes('percussion') || lower.includes('cymbal')) {
    return { cleanLabel: 'Drums / Percussion', category: 'music', icon: '🥁', isProminentCue: false };
  }
  if (lower.includes('trumpet') || lower.includes('cornet') || lower.includes('brass instrument')) {
    return { cleanLabel: 'Trumpet / Brass', category: 'music', icon: '🎺', isProminentCue: false };
  }
  if (lower.includes('ukulele') || lower.includes('banjo')) {
    return { cleanLabel: 'Ukulele / Strings', category: 'music', icon: '🪕', isProminentCue: false };
  }
  if (lower.includes('violin') || lower.includes('fiddle') || lower.includes('cello') || lower.includes('bowed string')) {
    return { cleanLabel: 'Violin / Strings', category: 'music', icon: '🎻', isProminentCue: false };
  }
  if (lower.includes('singing') || lower.includes('choir') || lower.includes('vocal')) {
    return { cleanLabel: 'Singing vocals', category: 'vocal', icon: '🎤', isProminentCue: false };
  }
  if (lower.includes('music') || lower.includes('musical instrument')) {
    return { cleanLabel: 'Music playing', category: 'music', icon: '🎵', isProminentCue: false };
  }

  // 4. Human Sounds & Crowd
  if (lower.includes('applause') || lower.includes('clapping')) {
    return { cleanLabel: 'Applause / Clapping', category: 'human', icon: '👏', isProminentCue: true };
  }
  if (lower.includes('cheer') || lower.includes('crowd')) {
    return { cleanLabel: 'Crowd cheering', category: 'human', icon: '🙌', isProminentCue: true };
  }
  if (lower.includes('laughter') || lower.includes('giggle') || lower.includes('chuckle') || lower.includes('snicker')) {
    return { cleanLabel: 'Laughter', category: 'human', icon: '😄', isProminentCue: true };
  }
  if (lower.includes('footstep') || lower.includes('walking')) {
    return { cleanLabel: 'Footsteps', category: 'human', icon: '👣', isProminentCue: false };
  }
  if (lower.includes('crying') || lower.includes('sobbing')) {
    return { cleanLabel: 'Crying', category: 'human', icon: '😢', isProminentCue: true };
  }
  if (lower.includes('sigh') || lower.includes('cough') || lower.includes('sneeze') || lower.includes('gasp')) {
    return { cleanLabel: rawLabel, category: 'human', icon: '🗣️', isProminentCue: true };
  }

  // 5. Environmental & Mechanical
  if (lower.includes('outside') || lower.includes('rural') || lower.includes('natural')) {
    return { cleanLabel: 'Nature / Outdoor ambiance', category: 'environment', icon: '🌲', isProminentCue: false };
  }
  if (lower.includes('environmental noise') || lower.includes('background noise') || lower.includes('ambience') || lower.includes('room tone')) {
    return { cleanLabel: 'Room tone / Ambiance', category: 'environment', icon: '🍃', isProminentCue: false };
  }
  if (lower.includes('silence')) {
    return { cleanLabel: 'Silence / Quiet', category: 'environment', icon: '🤫', isProminentCue: false };
  }
  if (lower.includes('car') || lower.includes('vehicle') || lower.includes('traffic')) {
    return { cleanLabel: 'Traffic / Vehicle sounds', category: 'vehicle', icon: '🚗', isProminentCue: true };
  }
  if (lower.includes('aircraft') || lower.includes('airplane') || lower.includes('helicopter')) {
    return { cleanLabel: 'Aircraft', category: 'vehicle', icon: '✈️', isProminentCue: true };
  }
  if (lower.includes('train')) {
    return { cleanLabel: 'Train', category: 'vehicle', icon: '🚆', isProminentCue: true };
  }
  if (lower.includes('bell') || lower.includes('chime')) {
    return { cleanLabel: 'Bell chime', category: 'misc', icon: '🔔', isProminentCue: true };
  }
  if (lower.includes('clock') || lower.includes('tick')) {
    return { cleanLabel: 'Clock ticking', category: 'misc', icon: '⏱️', isProminentCue: false };
  }

  // Fallback: clean up redundant parenthetical or comma clauses
  const cleaned = rawLabel.split(',')[0].replace(/\([^)]*\)/g, '').trim();
  return {
    cleanLabel: cleaned || rawLabel,
    category: 'misc',
    icon: '🔊',
    isProminentCue: false,
  };
}

/**
 * Formats seconds into MM:SS format.
 */
export function formatSecondsTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Synthesizes a structured acoustic transcript when speech recognition is absent or blank.
 */
export function synthesizeAcousticTranscription(events: SoundEvent[]): {
  transcription: string; // Summary preview (e.g. "🎧 [Acoustic Scene]: Birds chirping, Owl")
  fullTranscription: string; // Timestamped text passages
  chunks: Array<{ text: string; timestamp: [number, number] }>;
  tags: string[];
} {
  if (!events || events.length === 0) {
    return {
      transcription: '🎧 [Acoustic Scene]: Ambient environment',
      fullTranscription: '[00:00] 🍃 Ambient room tone',
      chunks: [{ text: '🍃 Ambient room tone', timestamp: [0, 5] }],
      tags: ['Ambient', 'Field Recording'],
    };
  }

  // Deduplicate and collect distinct primary labels
  const uniqueLabels = Array.from(new Set(events.map((e) => e.label)));
  const tags: string[] = [];
  uniqueLabels.forEach((label) => {
    tags.push(label);
  });

  // Short preview line
  const topNames = uniqueLabels.slice(0, 3).join(', ');
  const summary = `🎧 [Acoustic Scene]: ${topNames}`;

  // Time-annotated full transcript lines & chunks
  const passageLines: string[] = [];
  const chunks: Array<{ text: string; timestamp: [number, number] }> = [];

  events.forEach((ev) => {
    const timeLabel = formatSecondsTimestamp(ev.timestamp[0]);
    const icon = ev.icon ? `${ev.icon} ` : '';
    const confPct = ev.confidence ? ` (${Math.round(ev.confidence * 100)}%)` : '';
    const chunkText = `${icon}${ev.label}`.trim();
    const line = `[${timeLabel}] ${chunkText}${confPct}`;

    passageLines.push(line);
    chunks.push({
      text: chunkText,
      timestamp: [ev.timestamp[0], ev.timestamp[1]],
    });
  });

  return {
    transcription: summary,
    fullTranscription: passageLines.join('\n\n'),
    chunks,
    tags,
  };
}

/**
 * Interweaves prominent non-speech sound events (e.g. horse neigh, applause, owl)
 * into an existing speech transcript and chunk list.
 */
export function weaveSoundEventsIntoTranscript(
  speechTranscript: string,
  speechChunks: Array<{ text: string; timestamp: [number, number] }> = [],
  soundEvents: SoundEvent[] = []
): {
  transcription: string;
  fullTranscription: string;
  chunks: Array<{ text: string; timestamp: [number, number] }>;
  tags: string[];
} {
  // Only weave sound events that are marked as prominent acoustic cues and not pure speech/music
  const prominentEvents = soundEvents.filter((ev) => {
    const norm = normalizeSoundLabel(ev.label);
    const lower = ev.label.toLowerCase();
    const isSpeechOrMusic = lower.includes('speech') || lower.includes('singing') || lower.includes('music playing');
    return norm.isProminentCue && !isSpeechOrMusic && ev.confidence >= 0.15;
  });

  if (prominentEvents.length === 0) {
    return {
      transcription: speechTranscript,
      fullTranscription: speechTranscript,
      chunks: speechChunks,
      tags: [],
    };
  }

  // Combine speech chunks and sound event cues into a sorted chronological timeline
  const combinedChunks: Array<{ text: string; timestamp: [number, number]; isSoundEvent?: boolean }> = [
    ...speechChunks.map((c) => ({ ...c, isSoundEvent: false })),
    ...prominentEvents.map((ev) => ({
      text: `[Sound Event: ${ev.icon ? ev.icon + ' ' : ''}${ev.label}]`,
      timestamp: ev.timestamp,
      isSoundEvent: true,
    })),
  ];

  combinedChunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);

  // Build timestamped full text
  const passageLines = combinedChunks.map((c) => {
    const timeLabel = formatSecondsTimestamp(c.timestamp[0]);
    return `[${timeLabel}] ${c.text}`;
  });

  const soundEventTags = prominentEvents.map((e) => e.label);

  return {
    transcription: speechTranscript,
    fullTranscription: passageLines.join('\n\n'),
    chunks: combinedChunks.map((c) => ({ text: c.text, timestamp: c.timestamp })),
    tags: Array.from(new Set(soundEventTags)),
  };
}
