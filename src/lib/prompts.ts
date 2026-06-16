// Compatibility barrel: slash command implementation lives in slash-commands.ts.
export {
  type SlashCommand,
  type SlashLocalAction as SlashAction,
  applyPromptTemplate,
  extractSlashQuery,
  filterCommands,
  useLocalizedSlashCommands as useLocalizedCommands,
} from './slash-commands';
