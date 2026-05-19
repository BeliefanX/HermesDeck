import { randomUUID } from 'node:crypto';

export { HERMES_API_BASE, HERMES_DASHBOARD_BASE } from './core';
export { hermesVersion, getHealth } from './health';
export { getProfiles } from './profiles';
export { getSessions, tagSessionSource, deleteSession } from './sessions';
export { getMessages, type GetMessagesOptions } from './messages';
export { getTools } from './tools';
export { readSkill, saveSkill, indexSkillFiles } from './skills';
export { readProfileConfig, saveProfileConfigFile } from './config';
export { getModels } from './models';
export { getDeckStats } from './stats';
export {
  getLcmDashboard,
  type LcmDashboard,
  type LcmProfileStats,
  type LcmPluginInfo,
  type LcmConfigSnapshot,
} from './lcm';
export { getRuns, getRunDetail } from './runs';
export { getTokenStats } from './tokens';
export { listTerminalActions, runTerminalAction } from './terminal';
export { createChatStream, resumeChatStream, type ChatStreamBody } from './chat-stream';
export { getActiveStream } from './stream-hub';
export {
  getBoards,
  getBoardSnapshot,
  getTaskDetail,
  createTask,
  applyTaskAction,
  assignTask,
  commentTask,
  setActiveBoard,
  getTaskLog,
  linkTasks,
  unlinkTasks,
  getDiagnostics,
  watchBoardEvents,
  getStats,
  getAssignees,
  getTaskContext,
  editTask,
  listMarkdownFiles,
  readMarkdownFile,
  writeMarkdownFile,
  type CreateTaskInput,
  type TaskAction,
  type EditTaskInput,
  type WatchHandle,
} from './kanban';

export function newId(prefix = 'local'): string {
  return `${prefix}_${randomUUID()}`;
}
