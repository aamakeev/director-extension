export type DirectorCommand = {
  id: string;
  label: string;
  emoji: string;
  categoryId: string;
  categoryTitle: string;
};

export type DirectorCommandGroup = {
  id: string;
  title: string;
  emoji: string;
  commands: Array<Pick<DirectorCommand, 'id' | 'label' | 'emoji'>>;
};

export const COMMAND_GROUPS: DirectorCommandGroup[] = [
  {
    id: 'visual',
    title: 'VISUAL',
    emoji: '🎥',
    commands: [
      { id: 'visual_closeup', label: 'Close-up', emoji: '🔍' },
      { id: 'visual_angle', label: 'Change angle', emoji: '🎞' },
      { id: 'visual_eyes', label: 'Look in eyes', emoji: '👁' },
    ],
  },
  {
    id: 'tempo',
    title: 'TEMPO',
    emoji: '⏱',
    commands: [
      { id: 'tempo_slow', label: 'Slow', emoji: '🐌' },
      { id: 'tempo_turbo', label: 'Turbo', emoji: '⚡' },
      { id: 'tempo_freeze', label: 'Freeze', emoji: '🧊' },
    ],
  },
  {
    id: 'sound',
    title: 'SOUND',
    emoji: '🎙',
    commands: [
      { id: 'sound_whisper', label: 'Whisper', emoji: '🤫' },
      { id: 'sound_dirty_talk', label: 'Dirty talk', emoji: '🔥' },
      { id: 'sound_silence', label: 'Silence', emoji: '🤐' },
    ],
  },
  {
    id: 'acting',
    title: 'ACTING',
    emoji: '🎭',
    commands: [
      { id: 'acting_good', label: 'Good girl', emoji: '😇' },
      { id: 'acting_bad', label: 'Bad girl', emoji: '😈' },
    ],
  },
];

export const COMMAND_BY_ID: Record<string, DirectorCommand> = Object.fromEntries(
  COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => [
      command.id,
      {
        ...command,
        categoryId: group.id,
        categoryTitle: group.title,
      },
    ]),
  ),
);
