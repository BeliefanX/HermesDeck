// Tool names that spawn or interact with a Hermes subagent. Visually distinct
// from regular tool calls so they're easy to find in long conversations.
export const SUBAGENT_TOOLS = new Set(['delegate_task']);
export const isSubagentTool = (name?: string) => !!(name && SUBAGENT_TOOLS.has(name));
