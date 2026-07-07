import { randomUUID } from 'node:crypto';

export { HERMES_API_BASE } from './core';
export { hermesVersion, getHealth } from './health';
export { AssignedProfilesUnavailableError, getAssignedRoutableProfiles, getStrictProfiles, proveProfileRoutable, type ProfileRoutabilityProof } from './profiles';
export {
  getSessions,
  getSessionsForStats,
  assertSessionBelongsToProfile,
  tagSessionSource,
  deleteSession,
  SessionProfileRoutingError,
  PROFILE_ROUTING_UNAVAILABLE,
  SESSION_PROFILE_MISMATCH,
} from './sessions';
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
export { CronProfileRoutingError, getCronJobs } from './cron';
export { getTokenStats } from './tokens';
export { listTerminalActions, runTerminalAction } from './terminal';
export { createChatStream, resumeChatStream, type ChatStreamBody, type ChatStreamProjectionHooks } from './chat-stream';
export { ActiveStreamAuthorizationError, getActiveStream } from './stream-hub';
export function newId(prefix = 'local'): string {
  return `${prefix}_${randomUUID()}`;
}
