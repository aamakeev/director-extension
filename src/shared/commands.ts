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

/**
 * Short list of actions only — large tap targets in the remote pad depend on keeping this small.
 * Stable `id` values are kept where possible for cooldown / spend payloads.
 */
export const COMMAND_GROUPS: DirectorCommandGroup[] = [
  {
    id: 'actions',
    title: 'ACTIONS',
    emoji: '🎬',
    commands: [
      { id: 'visual_closeup', label: 'Close-up', emoji: '🔍' },
      { id: 'visual_eyes', label: 'Eyes', emoji: '👁' },
      { id: 'tempo_slow', label: 'Slow', emoji: '🐌' },
      { id: 'tempo_turbo', label: 'Fast', emoji: '⚡' },
      { id: 'tempo_freeze', label: 'Hold', emoji: '🧊' },
      { id: 'sound_whisper', label: 'Whisper', emoji: '🤫' },
      { id: 'sound_dirty_talk', label: 'Heat', emoji: '🔥' },
      { id: 'sound_silence', label: 'Quiet', emoji: '🤐' },
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
