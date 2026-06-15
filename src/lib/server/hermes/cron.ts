import { hermesApiGet } from './core';
import type { DeckCronJob } from '@/lib/types';

type HermesCronJobsResponse = {
  jobs?: unknown[];
  profile_id?: unknown;
  profileId?: unknown;
  profile?: unknown;
  routed_profile_id?: unknown;
  profile_routed?: unknown;
  routing?: unknown;
} | unknown[];

export class CronProfileRoutingError extends Error {
  readonly code = 'profile_routing_unavailable';
  readonly status = 502;
  constructor(profileId: string) {
    super(`Hermes API did not confirm cron profile routing for '${profileId}'. Restart/upgrade the Hermes API before showing profile-specific jobs.`);
    this.name = 'CronProfileRoutingError';
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function statusFor(row: Record<string, unknown>): DeckCronJob['status'] {
  if (row.enabled === false) return 'disabled';
  const state = str(row.state)?.toLowerCase();
  if (state === 'paused') return 'paused';
  if (state === 'running') return 'running';
  if (state === 'disabled') return 'disabled';
  return 'enabled';
}

function normalizeJob(raw: unknown, fallbackProfile?: string): DeckCronJob | null {
  const row = obj(raw);
  const id = str(row.id);
  if (!id) return null;
  const schedule = row.schedule;
  const scheduleObj = obj(schedule);
  return {
    id,
    name: str(row.name),
    status: statusFor(row),
    state: str(row.state),
    enabled: row.enabled !== false,
    schedule: str(row.schedule_display) || str(schedule) || str(scheduleObj.display) || JSON.stringify(schedule || {}),
    nextRunAt: str(row.next_run_at),
    lastRunAt: str(row.last_run_at),
    lastStatus: str(row.last_status),
    promptPreview: str(row.prompt),
    deliver: str(row.deliver),
    skills: strArray(row.skills),
    skill: str(row.skill),
    toolsets: strArray(row.enabled_toolsets),
    model: str(row.model),
    provider: str(row.provider),
    workdir: str(row.workdir),
    profile: str(row.profile) || fallbackProfile,
    script: str(row.script),
    noAgent: row.no_agent === true,
    repeat: obj(row.repeat),
    lastError: str(row.last_error),
    lastDeliveryError: str(row.last_delivery_error),
    createdAt: str(row.created_at),
  };
}

function jobsFromPayload(payload: HermesCronJobsResponse): unknown[] {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}

function confirmedProfileId(payload: HermesCronJobsResponse): string | undefined {
  if (Array.isArray(payload)) return undefined;
  const routing = obj(payload.routing);
  return str(payload.profile_id)
    || str(payload.profileId)
    || str(payload.routed_profile_id)
    || str(payload.profile)
    || str(routing.profile_id)
    || str(routing.profileId)
    || str(routing.routed_profile_id)
    || str(routing.profile);
}

function assertProfileRoutingConfirmed(payload: HermesCronJobsResponse, rawJobs: unknown[], requestedProfile: string): boolean {
  const confirmed = confirmedProfileId(payload);
  if (confirmed === requestedProfile) return true;

  const rowProfiles = rawJobs
    .map((job) => str(obj(job).profile))
    .filter((profile): profile is string => Boolean(profile));
  if (rowProfiles.length > 0 && rowProfiles.every((profile) => profile === requestedProfile)) return true;

  throw new CronProfileRoutingError(requestedProfile);
}

async function getCronJobsForProfile(profileId: string): Promise<DeckCronJob[]> {
  const payload = await hermesApiGet<HermesCronJobsResponse>(
    `/api/jobs?include_disabled=true&profile=${encodeURIComponent(profileId)}`,
    8000,
    profileId,
  );
  const rawJobs = jobsFromPayload(payload);
  const canAssignLegacyProfilelessJobs = assertProfileRoutingConfirmed(payload, rawJobs, profileId);
  return rawJobs
    .map((job) => normalizeJob(job, canAssignLegacyProfilelessJobs ? profileId : undefined))
    .filter((job): job is DeckCronJob => Boolean(job));
}

export async function getCronJobs(profileIds: readonly string[]): Promise<DeckCronJob[]> {
  const uniqueProfiles = Array.from(new Set(profileIds));
  if (!uniqueProfiles.length) return [];
  const byProfile = await Promise.all(uniqueProfiles.map(getCronJobsForProfile));
  return byProfile
    .flat()
    .sort((a, b) => String(a.nextRunAt || a.createdAt || '').localeCompare(String(b.nextRunAt || b.createdAt || '')));
}
