'use client';
import { useCallback, useEffect, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckHealth, DeckNotificationConfigResponse, DeckNotificationPreferences } from '@/lib/types';
import { Sun, Moon, Monitor, Trash2, ShieldCheck, Server, Database, RefreshCw, LogOut, KeyRound, UserRound, Bell, BellOff, Send } from 'lucide-react';
import { Page, Card, SectionHead, Chip, Btn, Tag, Kicker, Kbd, ListRow } from '@/components/Brand';
import { AdminUsersPanel } from '@/components/AdminUsersPanel';

import { localizeError, setLang, useLang, useT } from '@/lib/i18n';
import { useDeckSession } from '@/lib/use-deck-session';
import { useActiveProfile } from '@/lib/profile-context';

type Theme = 'dark' | 'light';

type NotificationPermissionState = NotificationPermission | 'unsupported' | 'unknown';

function urlBase64ToApplicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output.buffer.slice(0) as ArrayBuffer;
}

function notificationSupportState(): NotificationPermissionState {
  if (typeof window === 'undefined') return 'unknown';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission;
}

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [themeMounted, setThemeMounted] = useState(false);
  const [health, setHealth] = useState<DeckHealth | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number>(0);
  const { session } = useDeckSession();
  const immutableUsername = session?.role === 'super_admin';

  // Account section
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [newUsername, setNewUsername] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [notificationState, setNotificationState] = useState<DeckNotificationConfigResponse | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('unknown');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const { activeProfile, profiles, loading: profilesLoading } = useActiveProfile();
  const lang = useLang();

  const t = useT({
    zh: {
      intro: '基础设置：主题、连接信息、本地缓存。敏感配置不会暴露给前端；后续版本将通过受限的 BFF 进行编辑。',
      appearance: '外观',
      themeTitle: '主题',
      themeDesc: '主题偏好保存在浏览器中，并通过 SSR 引导脚本回放，避免页面闪烁。',
      dark: '深色',
      light: '浅色',
      followSystem: '跟随系统',
      languageTitle: '语言',
      languageDesc: '界面语言保存在浏览器中，并会同步到文档语言属性。',
      chinese: '中文',
      english: 'English',
      backend: '后端',
      connections: 'Hermes 连接',
      refreshing: '刷新中…',
      refresh: '刷新',
      apiServer: 'Hermes API 服务',
      dashboard: 'Hermes API-only',
      healthy: '正常',
      fallback: '回退',
      seen: 'API',
      sidecar: '不可用',
      envVars: '环境变量 · 已脱敏',
      apiServerLabel: 'API 服务：',
      dashboardLabel: 'API-only：',
      authLabel: '认证：',
      localCache: '本地缓存',
      browserState: '浏览器存储状态',
      cacheDesc: 'HermesDeck 在浏览器中保存草稿、会话索引和 response_id 链路缓存；置顶 / 文件夹 / 标签等会话组织由服务器同步。',
      onDevice: '仅本机',
      clearCache: '清除 HermesDeck 缓存',
      cleared: '已清除',
      confirmClear: '确认清除 HermesDeck 本地缓存？将清除草稿、会话索引和 response 链路缓存；服务器同步的置顶 / 文件夹 / 标签会保留。主题、语言与当前 Agent 会保留。此操作无法撤销。',
      notifications: '通知',
      notificationTitle: '浏览器通知',
      notificationDesc: '聊天、Kanban 任务或定时任务完成后，HermesDeck 可通过 PWA Web Push / 页面打开时通知发送系统提醒。消息正文不会写入通知内容。',
      notificationUnavailable: '服务器未配置 VAPID，通知暂不可用。',
      notificationUnsupported: '此浏览器不支持 Service Worker Push 通知。',
      permission: '权限',
      subscribedDevices: '已订阅设备',
      enableNotifications: '启用通知',
      disableNotifications: '停用本设备',
      sendTest: '发送测试',
      notifyChatDone: '聊天完成',
      notifyChatFailed: '聊天失败',
      notifyKanbanDone: 'Kanban 任务完成',
      notifyCronDone: '定时任务完成',
      saved: '已保存',
      testSent: '测试通知已发送',
      subscriptionEnabled: '本设备已订阅',
      subscriptionDisabled: '本设备已取消订阅',
      noNotificationProfile: '没有可用的 Agent，无法发送测试通知。',
    },
    en: {
      intro: 'Basics: theme, connection info, local cache. Sensitive config is not exposed in the frontend; future versions will edit it via a guarded BFF.',
      appearance: 'APPEARANCE',
      themeTitle: 'Theme',
      themeDesc: 'Theme persists in the browser and is replayed by the SSR bootstrap script to avoid flashes.',
      dark: 'Dark',
      light: 'Light',
      followSystem: 'Follow system',
      languageTitle: 'Language',
      languageDesc: 'UI language is stored in the browser and reflected on the document language attribute.',
      chinese: '中文',
      english: 'English',
      backend: 'BACKEND',
      connections: 'Hermes connections',
      refreshing: 'Refreshing…',
      refresh: 'Refresh',
      apiServer: 'Hermes API Server',
      dashboard: 'Hermes API-only',
      healthy: 'Healthy',
      fallback: 'Fallback',
      seen: 'API',
      sidecar: 'Unavailable',
      envVars: 'ENV VARS · SECRETS REDACTED',
      apiServerLabel: 'API server:',
      dashboardLabel: 'API-only:',
      authLabel: 'Auth:',
      localCache: 'LOCAL CACHE',
      browserState: 'Browser-stored state',
      cacheDesc: 'HermesDeck keeps drafts, the session index and response_id chain caches in the browser; pins, folders, tags and other session organization sync through the server.',
      onDevice: 'on-device only',
      clearCache: 'Clear HermesDeck cache',
      cleared: 'Cleared',
      confirmClear: 'Clear HermesDeck local cache? This removes drafts, the session index and response chain caches; server-synced pins, folders and tags are kept. Your theme, language and active Agent are kept. This cannot be undone.',
      notifications: 'NOTIFICATIONS',
      notificationTitle: 'Browser notifications',
      notificationDesc: 'HermesDeck can send PWA Web Push / page-open system notifications when chat replies, Kanban tasks or scheduled jobs complete. Message bodies are not included in notification text.',
      notificationUnavailable: 'Server VAPID keys are not configured, so notifications are unavailable.',
      notificationUnsupported: 'This browser does not support Service Worker Push notifications.',
      permission: 'Permission',
      subscribedDevices: 'Subscribed devices',
      enableNotifications: 'Enable notifications',
      disableNotifications: 'Disable this device',
      sendTest: 'Send test',
      notifyChatDone: 'Chat completed',
      notifyChatFailed: 'Chat failed',
      notifyKanbanDone: 'Kanban task completed',
      notifyCronDone: 'Scheduled job completed',
      saved: 'Saved',
      testSent: 'Test notification sent',
      subscriptionEnabled: 'This device is subscribed',
      subscriptionDisabled: 'This device is unsubscribed',
      noNotificationProfile: 'No available Agent, so a test notification cannot be sent.',
    },
  });

  async function resolveTestNotificationProfileId(): Promise<string> {
    if (activeProfile) return activeProfile;
    const loadedProfile = profiles.find((p) => p.active)?.id || profiles[0]?.id;
    if (loadedProfile) return loadedProfile;
    const refreshed = await deckApi.profiles();
    const refreshedProfile = refreshed.profiles?.find((p) => p.active)?.id || refreshed.profiles?.[0]?.id;
    if (refreshedProfile) return refreshedProfile;
    throw new Error(t.noNotificationProfile);
  }

  const tAcc = useT({
    zh: {
      kicker: '账号',
      title: '用户名与密码',
      desc: '修改 HermesDeck 的登录账号与密码。会话 Cookie 在 30 天后过期；持续访问会自动续期。',
      currentUsername: '当前用户名',
      newUsername: '新用户名（留空则不修改）',
      currentPassword: '当前密码',
      newPassword: '新密码（留空则不修改）',
      confirmPassword: '确认新密码',
      save: '保存修改',
      saving: '保存中…',
      logout: '退出登录',
      passwordMismatch: '两次输入的新密码不一致。',
      missingCurrent: '请输入当前密码以确认操作。',
      noChange: '没有需要保存的修改。',
      saved: '已保存。',
      savedRelogin: '密码已更新，请使用新密码登录。',
      immutableUsername: 'super_admin 用户名不能修改；仍然可以修改密码。',
      immutableUsernamePlaceholder: 'super_admin 用户名不可修改',
    },
    en: {
      kicker: 'ACCOUNT',
      title: 'Username & password',
      desc: 'Update the credentials used to sign in to HermesDeck. The session cookie expires after 30 days; continued use slides the expiry forward.',
      currentUsername: 'Current username',
      newUsername: 'New username (leave blank to keep)',
      currentPassword: 'Current password',
      newPassword: 'New password (leave blank to keep)',
      confirmPassword: 'Confirm new password',
      save: 'Save changes',
      saving: 'Saving…',
      logout: 'Sign out',
      passwordMismatch: 'New passwords do not match.',
      missingCurrent: 'Enter the current password to confirm.',
      noChange: 'Nothing to save.',
      saved: 'Saved.',
      savedRelogin: 'Password updated — please sign in again.',
      immutableUsername: 'super_admin username cannot be changed; password changes are still allowed.',
      immutableUsernamePlaceholder: 'super_admin username is immutable',
    },
  });

  const refreshNotifications = useCallback(async () => {
    setNotificationPermission(notificationSupportState());
    try {
      setNotificationState(await deckApi.notificationConfig());
    } catch (err) {
      setNotificationError(localizeError(err instanceof Error ? err.message : 'Failed to load notifications.', lang));
    }
  }, [lang]);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || 'dark');
    setThemeMounted(true);
    refreshHealth();
    void refreshNotifications();
    measureStorage();
  }, [refreshNotifications]);

  useEffect(() => {
    if (session?.authenticated && typeof session.username === 'string') {
      setCurrentUsername(session.username);
    }
  }, [session]);

  async function saveAccount() {
    setAccountError(null);
    setAccountSuccess(null);
    const wantsName = !immutableUsername && newUsername.trim().length > 0 && newUsername.trim() !== currentUsername;
    const wantsPwd = newPassword.length > 0;
    if (!wantsName && !wantsPwd) {
      setAccountError(tAcc.noChange);
      return;
    }
    if (!currentPassword) {
      setAccountError(tAcc.missingCurrent);
      return;
    }
    if (wantsPwd && newPassword !== confirmPassword) {
      setAccountError(tAcc.passwordMismatch);
      return;
    }
    setAccountSaving(true);
    try {
      const res = await fetch('/api/deck/auth/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newUsername: wantsName ? newUsername.trim() : undefined,
          newPassword: wantsPwd ? newPassword : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setAccountError(localizeError(data?.error || 'Failed to save changes.', lang));
        setAccountSaving(false);
        return;
      }
      if (typeof data.username === 'string') setCurrentUsername(data.username);
      setNewUsername('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAccountSuccess(data.passwordChanged ? tAcc.savedRelogin : tAcc.saved);
    } catch {
      setAccountError(localizeError('Network error.', lang));
    } finally {
      setAccountSaving(false);
    }
  }


  function applyTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hermesdeck-theme', next); } catch {}
  }

  function applySystemTheme() {
    try { localStorage.removeItem('hermesdeck-theme'); } catch {}
    const sys: Theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(sys);
    document.documentElement.dataset.theme = sys;
  }

  async function refreshHealth() {
    setRefreshing(true);
    try { setHealth(await deckApi.health()); } catch {} finally { setRefreshing(false); }
  }

  async function enableNotifications() {
    setNotificationBusy(true);
    setNotificationError(null);
    setNotificationMessage(null);
    try {
      const state = notificationState || await deckApi.notificationConfig();
      setNotificationState(state);
      if (!state.config.available || !state.config.publicKey) {
        setNotificationError(t.notificationUnavailable);
        return;
      }
      if (notificationSupportState() === 'unsupported') {
        setNotificationPermission('unsupported');
        setNotificationError(t.notificationUnsupported);
        return;
      }
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      setNotificationPermission(permission);
      if (permission !== 'granted') return;
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToApplicationServerKey(state.config.publicKey),
      });
      await deckApi.savePushSubscription(subscription.toJSON());
      await refreshNotifications();
      setNotificationMessage(t.subscriptionEnabled);
    } catch (err) {
      setNotificationError(localizeError(err instanceof Error ? err.message : 'Failed to enable notifications.', lang));
    } finally {
      setNotificationBusy(false);
    }
  }

  async function disableNotifications() {
    setNotificationBusy(true);
    setNotificationError(null);
    setNotificationMessage(null);
    try {
      if (notificationSupportState() === 'unsupported') return;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => false);
        await deckApi.deletePushSubscription(endpoint);
      }
      await refreshNotifications();
      setNotificationMessage(t.subscriptionDisabled);
    } catch (err) {
      setNotificationError(localizeError(err instanceof Error ? err.message : 'Failed to disable notifications.', lang));
    } finally {
      setNotificationBusy(false);
    }
  }

  async function saveNotificationPreference(patch: Partial<DeckNotificationPreferences>) {
    setNotificationBusy(true);
    setNotificationError(null);
    setNotificationMessage(null);
    try {
      const result = await deckApi.saveNotificationPreferences(patch);
      setNotificationState((prev) => prev ? { ...prev, preferences: result.preferences } : prev);
      setNotificationMessage(t.saved);
    } catch (err) {
      setNotificationError(localizeError(err instanceof Error ? err.message : 'Failed to save notifications.', lang));
    } finally {
      setNotificationBusy(false);
    }
  }

  async function sendTestNotification() {
    setNotificationBusy(true);
    setNotificationError(null);
    setNotificationMessage(null);
    try {
      const profileId = await resolveTestNotificationProfileId();
      await deckApi.sendTestNotification(profileId);
      setNotificationMessage(t.testSent);
    } catch (err) {
      setNotificationError(localizeError(err instanceof Error ? err.message : 'Failed to send test notification.', lang));
    } finally {
      setNotificationBusy(false);
    }
  }

  function measureStorage() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!k) continue;
        const v = localStorage.getItem(k) || '';
        total += k.length + v.length;
      }
      setStorageUsed(total);
    } catch {}
  }

  function clearChatStorage() {
    if (!confirm(t.confirmClear)) return;
    try {
      // Genuine preferences are tiny and not "cache" — keep them so clearing
      // doesn't silently drop the user back to the default profile / Chinese
      // UI / collapsed sidebar.
      const KEEP = new Set([
        'hermesdeck-theme',
        'hermesdeck-lang',
        'hermesdeck-sidebar-collapsed',
        'hermesdeck.active-profile.v1',
      ]);
      Object.keys(localStorage)
        .filter((k) => k.startsWith('hermesdeck') && !KEEP.has(k))
        .forEach((k) => localStorage.removeItem(k));
      setCleared(true);
      measureStorage();
      setTimeout(() => setCleared(false), 2400);
    } catch {}
  }

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
  const labelStyle: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted-2)', fontWeight: 500 };
  const inputStyle: React.CSSProperties = {
    height: 36, padding: '0 12px',
    background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8,
    fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
  };

  return (
    <Page intro={t.intro}>
      <Card>
        <SectionHead
          kicker={tAcc.kicker}
          title={tAcc.title}
          right={
            <form action="/api/deck/auth/logout" method="post" style={{ margin: 0 }}>
              <Btn size="sm" variant="danger" icon={<LogOut size={12} />} type="submit">
                {tAcc.logout}
              </Btn>
            </form>
          }
        />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: 620 }}>
          {tAcc.desc}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Tag icon={<UserRound size={11} />}>{currentUsername || '—'}</Tag>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>{tAcc.newUsername}</span>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder={immutableUsername ? tAcc.immutableUsernamePlaceholder : currentUsername}
              style={{ ...inputStyle, opacity: immutableUsername ? 0.62 : 1 }}
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              disabled={immutableUsername}
              aria-describedby={immutableUsername ? 'super-admin-username-note' : undefined}
            />
            {immutableUsername ? (
              <span id="super-admin-username-note" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                {tAcc.immutableUsername}
              </span>
            ) : null}
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{tAcc.currentPassword}</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
              autoComplete="current-password"
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{tAcc.newPassword}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
              autoComplete="new-password"
            />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{tAcc.confirmPassword}</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              autoComplete="new-password"
            />
          </label>
        </div>
        {accountError ? (
          <div style={{
            marginTop: 12, fontSize: 12.5, color: 'var(--red)',
            background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)',
            borderRadius: 8, padding: '8px 10px',
          }}>{accountError}</div>
        ) : null}
        {accountSuccess ? (
          <div style={{
            marginTop: 12, fontSize: 12.5, color: 'var(--green)',
            background: 'var(--status-green-bg)', border: '1px solid var(--status-green-border)',
            borderRadius: 8, padding: '8px 10px',
          }}>{accountSuccess}</div>
        ) : null}
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Btn variant="primary" icon={<KeyRound size={13} />} onClick={saveAccount} disabled={accountSaving}>
            {accountSaving ? tAcc.saving : tAcc.save}
          </Btn>
        </div>
      </Card>

      <AdminUsersPanel />

      <Card>
        <SectionHead kicker={t.appearance} title={t.themeTitle} />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          {t.themeDesc}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={themeMounted && theme === 'dark'} onClick={() => applyTheme('dark')} icon={<Moon size={11} />}>{t.dark}</Chip>
          <Chip active={themeMounted && theme === 'light'} onClick={() => applyTheme('light')} icon={<Sun size={11} />}>{t.light}</Chip>
          <Chip onClick={applySystemTheme} icon={<Monitor size={11} />}>{t.followSystem}</Chip>
        </div>
      </Card>

      <Card>
        <SectionHead kicker={t.appearance} title={t.languageTitle} />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          {t.languageDesc}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={lang === 'zh'} onClick={() => setLang('zh')}>{t.chinese}</Chip>
          <Chip active={lang === 'en'} onClick={() => setLang('en')}>{t.english}</Chip>
        </div>
      </Card>

      <Card>
        <SectionHead kicker={t.notifications} title={t.notificationTitle} />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: 720 }}>
          {t.notificationDesc}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <Tag icon={notificationPermission === 'granted' ? <Bell size={11} /> : <BellOff size={11} />}>
            {t.permission}: {notificationPermission}
          </Tag>
          <Tag>{t.subscribedDevices}: {notificationState?.subscriptionCount ?? '—'}</Tag>
          <Tag variant={notificationState?.config.available ? 'green' : 'yellow'}>
            {notificationState?.config.available ? 'VAPID' : (notificationState ? t.notificationUnavailable : '—')}
          </Tag>
        </div>
        {notificationPermission === 'unsupported' ? (
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>{t.notificationUnsupported}</p>
        ) : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <Btn icon={<Bell size={13} />} onClick={enableNotifications} disabled={notificationBusy || notificationPermission === 'unsupported'}>
            {t.enableNotifications}
          </Btn>
          <Btn icon={<BellOff size={13} />} onClick={disableNotifications} disabled={notificationBusy || notificationPermission === 'unsupported'}>
            {t.disableNotifications}
          </Btn>
          <Btn icon={<Send size={13} />} onClick={sendTestNotification} disabled={notificationBusy || !notificationState?.config.available || (profilesLoading && !activeProfile)}>
            {t.sendTest}
          </Btn>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip
            active={notificationState?.preferences.chatCompleted !== false}
            onClick={() => saveNotificationPreference({ chatCompleted: !(notificationState?.preferences.chatCompleted !== false) })}
          >
            {t.notifyChatDone}
          </Chip>
          <Chip
            active={notificationState?.preferences.chatFailed !== false}
            onClick={() => saveNotificationPreference({ chatFailed: !(notificationState?.preferences.chatFailed !== false) })}
          >
            {t.notifyChatFailed}
          </Chip>
          <Chip
            active={notificationState?.preferences.kanbanTaskCompleted !== false}
            onClick={() => saveNotificationPreference({ kanbanTaskCompleted: !(notificationState?.preferences.kanbanTaskCompleted !== false) })}
          >
            {t.notifyKanbanDone}
          </Chip>
          <Chip
            active={notificationState?.preferences.cronJobCompleted !== false}
            onClick={() => saveNotificationPreference({ cronJobCompleted: !(notificationState?.preferences.cronJobCompleted !== false) })}
          >
            {t.notifyCronDone}
          </Chip>
        </div>
        {notificationMessage ? <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--green)' }}>{notificationMessage}</div> : null}
        {notificationError ? <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)' }}>{notificationError}</div> : null}
      </Card>

      <Card>
        <SectionHead
          kicker={t.backend}
          title={t.connections}
          right={
            <Btn size="sm" icon={<RefreshCw size={12} className={refreshing ? 'spin' : ''} />} onClick={refreshHealth} disabled={refreshing}>
              {refreshing ? t.refreshing : t.refresh}
            </Btn>
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <ListRow
            first
            icon={<Server size={14} />}
            title={t.apiServer}
            sub={health?.apiServer.baseUrl || '—'}
            right={<Tag variant={health?.apiServer.healthy ? 'green' : 'yellow'}>{health?.apiServer.healthy ? t.healthy : t.fallback}</Tag>}
          />
          <ListRow
            icon={<Database size={14} />}
            title={t.dashboard}
            sub={health?.dashboard.baseUrl || '—'}
            right={<Tag variant={health?.dashboard.healthy ? 'green' : 'yellow'}>{health?.dashboard.healthy ? t.seen : t.sidecar}</Tag>}
          />
        </div>
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--hairline)',
          }}
        >
          <Kicker style={{ marginBottom: 8 }}>{t.envVars}</Kicker>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text)' }}>
            <div>{t.apiServerLabel} <Kbd>HERMES_API_BASE</Kbd></div>
            <div>{t.dashboardLabel} <Kbd>HERMES_API_BASE</Kbd></div>
            <div>{t.authLabel} <Kbd>HERMES_API_KEY</Kbd> · <Kbd>API_SERVER_KEY</Kbd></div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHead kicker={t.localCache} title={t.browserState} />
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 14px', maxWidth: 620 }}>
          {t.cacheDesc}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Tag icon={<ShieldCheck size={11} />}>{t.onDevice}</Tag>
          <Tag>~ {(storageUsed / 1024).toFixed(1)} KB</Tag>
          <Btn variant="danger" icon={<Trash2 size={13} />} onClick={clearChatStorage}>
            {t.clearCache}
          </Btn>
          {cleared && <Tag variant="green">{t.cleared}</Tag>}
        </div>
      </Card>
    </Page>
  );
}
