'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, Shield, UserCog, UserX } from 'lucide-react';
import { Btn, SectionHead, Tag } from '@/components/Brand';
import { localizeError, useLang, useT } from '@/lib/i18n';

type DeckRole = 'super_admin' | 'admin' | 'user';
type DeckStatus = 'pending' | 'active' | 'disabled' | 'rejected';

type AdminUser = {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: DeckRole;
  status: DeckStatus;
  assignedProfileIds: string[];
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  disabledAt?: string;
  disabledBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
};

type DeckProfile = { id?: string; profileId?: string; name?: string };
type SessionResponse = {
  authenticated?: boolean;
  role?: DeckRole;
  capabilities?: { canManageUsers?: boolean };
};

function profileId(profile: DeckProfile): string | undefined {
  return profile.id || profile.profileId || profile.name;
}

function statusTone(status: DeckStatus): 'green' | 'yellow' | 'red' | 'default' {
  if (status === 'active') return 'green';
  if (status === 'pending') return 'yellow';
  if (status === 'disabled' || status === 'rejected') return 'red';
  return 'default';
}

function roleTone(role: DeckRole): 'accent' | 'cyan' | 'default' {
  if (role === 'super_admin') return 'accent';
  if (role === 'admin') return 'cyan';
  return 'default';
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed: ${res.status}`;
    const detail = typeof data?.detail === 'string' ? ` ${data.detail}` : '';
    throw new Error(`${message}${detail}`.trim());
  }
  return data as T;
}

export function AdminUsersPanel() {
  const lang = useLang();
  const t = useT({
    zh: {
      kicker: '管理员',
      title: '用户审批与 Agent 分配',
      loading: '加载中…',
      refresh: '刷新',
      desc: '审批待处理账号、停用或重新启用用户，并分配 Agent。不可变的 super_admin 仅用于可见性展示，不能被修改。',
      pendingQueue: (n: number) => `待审批队列：${n}`,
      immutableNote: '此不可变 super_admin 账户不能降级、停用、删除或分配 Agent。',
      approve: '批准',
      disableButton: '停用',
      reject: '拒绝',
      promote: '提升为管理员',
      demote: '降级为普通用户',
      assignAgents: '分配 Agent',
      immutableAssignments: '不可变 super_admin 禁用 Agent 分配。',
      noProfiles: 'Hermes Agent 未返回任何可分配 Agent。',
      profileCatalogUnavailable: 'Agent 目录暂不可用；用户审批仍可继续，但 Agent 分配会保持关闭，直到目录恢复。',
      updatedAssignments: (u: string) => `已更新 ${u} 的 Agent 分配。`,
      approved: (u: string) => `已批准 ${u}。`,
      disabled: (u: string) => `已停用 ${u}。`,
      rejected: (u: string) => `已拒绝 ${u}。`,
      promoted: (u: string) => `已将 ${u} 提升为管理员。`,
      demoted: (u: string) => `已将 ${u} 降级为普通用户。`,
      statusPending: '待审批',
      statusActive: '活跃',
      statusDisabled: '已停用',
      statusRejected: '已拒绝',
      roleSuperAdmin: '超级管理员',
      roleAdmin: '管理员',
      roleUser: '用户',
    },
    en: {
      kicker: 'ADMIN',
      title: 'User approvals & Agent assignments',
      loading: 'Loading…',
      refresh: 'Refresh',
      desc: 'Approve pending accounts, disable or reactivate users, and assign Agents. The immutable super_admin is listed for visibility only and cannot be changed.',
      pendingQueue: (n: number) => `Pending queue: ${n}`,
      immutableNote: 'This immutable super_admin account cannot be demoted, disabled, deleted, or assigned Agents.',
      approve: 'Approve',
      disableButton: 'Disable',
      reject: 'Reject',
      promote: 'Promote to admin',
      demote: 'Demote to user',
      assignAgents: 'Assign Agents',
      immutableAssignments: 'Assignments are disabled for immutable super_admin.',
      noProfiles: 'No assignable Agents were returned by Hermes Agent.',
      profileCatalogUnavailable: 'Agent catalog is unavailable; user approvals remain available, but Agent assignment stays disabled until the catalog recovers.',
      updatedAssignments: (u: string) => `Updated Agent assignments for ${u}.`,
      approved: (u: string) => `Approved ${u}.`,
      disabled: (u: string) => `Disabled ${u}.`,
      rejected: (u: string) => `Rejected ${u}.`,
      promoted: (u: string) => `Promoted ${u} to admin.`,
      demoted: (u: string) => `Demoted ${u} to user.`,
      statusPending: 'pending',
      statusActive: 'active',
      statusDisabled: 'disabled',
      statusRejected: 'rejected',
      roleSuperAdmin: 'super admin',
      roleAdmin: 'admin',
      roleUser: 'user',
    },
  });
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [currentRole, setCurrentRole] = useState<DeckRole>('user');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileCatalogWarning, setProfileCatalogWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const profileIds = useMemo(
    () => profiles.map(profileId).filter((id): id is string => !!id),
    [profiles],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProfileCatalogWarning(null);
    try {
      const sessionRes = await fetch('/api/deck/auth/session', { cache: 'no-store' });
      const session = await sessionRes.json().catch(() => ({})) as SessionResponse;
      const allowed = !!session.authenticated && !!session.capabilities?.canManageUsers;
      setCanManageUsers(allowed);
      setCurrentRole(session.role || 'user');
      if (!allowed) return;
      const usersData = await fetch('/api/deck/admin/users', { cache: 'no-store' })
        .then((res) => readJson<{ users: AdminUser[] }>(res));
      setUsers(usersData.users || []);

      try {
        const profilesData = await fetch('/api/deck/profiles', { cache: 'no-store' })
          .then((res) => readJson<{ profiles: DeckProfile[] }>(res));
        setProfiles(profilesData.profiles || []);
      } catch {
        // Profile assignment must stay fail-closed when Hermes Agent cannot
        // validate the catalog, but that outage must not block unrelated admin
        // actions such as approving or disabling users.
        setProfiles([]);
        setProfileCatalogWarning(t.profileCatalogUnavailable);
      }
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : String(err), lang));
    } finally {
      setLoading(false);
    }
  }, [lang, t.profileCatalogUnavailable]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function patchUser(user: AdminUser, patch: Record<string, unknown>, label: string) {
    setSavingUserId(user.id);
    setError(null);
    setSuccess(null);
    try {
      const data = await fetch(`/api/deck/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((res) => readJson<{ user: AdminUser }>(res));
      setUsers((prev) => prev.map((u) => u.id === user.id ? data.user : u));
      setSuccess(label);
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : String(err), lang));
    } finally {
      setSavingUserId(null);
    }
  }

  async function saveAssignments(user: AdminUser, assignedProfileIds: string[]) {
    setSavingUserId(user.id);
    setError(null);
    setSuccess(null);
    try {
      const data = await fetch(`/api/deck/admin/users/${encodeURIComponent(user.id)}/profiles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedProfileIds }),
      }).then((res) => readJson<{ user: AdminUser }>(res));
      setUsers((prev) => prev.map((u) => u.id === user.id ? data.user : u));
      setSuccess(t.updatedAssignments(user.username));
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : String(err), lang));
    } finally {
      setSavingUserId(null);
    }
  }

  if (!canManageUsers) return null;

  const pending = users.filter((user) => user.status === 'pending');
  const isSuperAdminActor = currentRole === 'super_admin';
  const mutedText = { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0 };
  const roleText = (role: DeckRole) => role === 'super_admin' ? t.roleSuperAdmin : role === 'admin' ? t.roleAdmin : t.roleUser;
  const statusText = (status: DeckStatus) =>
    status === 'pending' ? t.statusPending : status === 'active' ? t.statusActive : status === 'disabled' ? t.statusDisabled : t.statusRejected;

  return (
    <section
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-2)',
        padding: 18,
        background: 'var(--panel)',
      }}
    >
      <SectionHead
        kicker={t.kicker}
        title={t.title}
        right={<Btn size="sm" icon={<RefreshCw size={12} className={loading ? 'spin' : ''} />} onClick={refresh} disabled={loading}>{loading ? t.loading : t.refresh}</Btn>}
      />
      <p style={{ ...mutedText, marginBottom: 12 }}>
        {t.desc}
      </p>
      {pending.length ? (
        <div style={{ marginBottom: 12, padding: '10px 0', borderTop: '1px solid var(--status-yellow-border)', borderBottom: '1px solid var(--status-yellow-border)' }}>
          <b style={{ color: 'var(--strong-text)', fontSize: 13 }}>{t.pendingQueue(pending.length)}</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {pending.map((user) => (
              <Tag key={user.id} variant="yellow">{user.username}</Tag>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)', borderRadius: 8, padding: '8px 10px' }}>{error}</div>
      ) : null}
      {profileCatalogWarning ? (
        <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--yellow)', background: 'var(--status-yellow-bg)', border: '1px solid var(--status-yellow-border)', borderRadius: 8, padding: '8px 10px' }}>{profileCatalogWarning}</div>
      ) : null}
      {success ? (
        <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--green)', background: 'var(--status-green-bg)', border: '1px solid var(--status-green-border)', borderRadius: 8, padding: '8px 10px' }}>{success}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--hairline)' }}>
        {users.map((user, index) => {
          const disabled = user.immutable || savingUserId === user.id;
          const canChangeRole = isSuperAdminActor && !user.immutable;
          return (
            <div key={user.id} style={{ padding: '14px 0', borderTop: index === 0 ? 'none' : '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ color: 'var(--strong-text)', fontSize: 14 }}>{user.displayName || user.username}</b>
                    <Tag variant={roleTone(user.role)} icon={<Shield size={10} />}>{roleText(user.role)}</Tag>
                    <Tag variant={statusTone(user.status)}>{statusText(user.status)}</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    @{user.username}{user.email ? ` · ${user.email}` : ''}
                  </div>
                  {user.immutable ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                      {t.immutableNote}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {user.status !== 'active' ? (
                    <Btn size="sm" variant="primary" icon={<CheckCircle2 size={12} />} disabled={disabled} onClick={() => patchUser(user, { status: 'active' }, t.approved(user.username))}>{t.approve}</Btn>
                  ) : null}
                  {user.status === 'active' ? (
                    <Btn size="sm" variant="danger" icon={<UserX size={12} />} disabled={disabled} onClick={() => patchUser(user, { status: 'disabled' }, t.disabled(user.username))}>{t.disableButton}</Btn>
                  ) : null}
                  {user.status === 'pending' ? (
                    <Btn size="sm" variant="danger" disabled={disabled} onClick={() => patchUser(user, { status: 'rejected' }, t.rejected(user.username))}>{t.reject}</Btn>
                  ) : null}
                  {canChangeRole && user.role === 'user' ? (
                    <Btn size="sm" icon={<UserCog size={12} />} disabled={disabled} onClick={() => patchUser(user, { role: 'admin' }, t.promoted(user.username))}>{t.promote}</Btn>
                  ) : null}
                  {canChangeRole && user.role === 'admin' ? (
                    <Btn size="sm" icon={<UserCog size={12} />} disabled={disabled} onClick={() => patchUser(user, { role: 'user' }, t.demoted(user.username))}>{t.demote}</Btn>
                  ) : null}
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted-2)', marginBottom: 8 }}>
                  {t.assignAgents}
                </div>
                {user.immutable ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.immutableAssignments}</div>
                ) : profileIds.length ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {profileIds.map((id) => {
                      const checked = user.assignedProfileIds.includes(id);
                      const nextAssignments = checked ? user.assignedProfileIds.filter((pid) => pid !== id) : [...user.assignedProfileIds, id];
                      return (
                        <label key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 999, padding: '4px 9px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => saveAssignments(user, nextAssignments)}
                          />
                          {id}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.noProfiles}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
