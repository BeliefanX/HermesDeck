'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Lock, Mail, User, UserPlus } from 'lucide-react';
import { Btn } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { localizeError, useLang, useT } from '@/lib/i18n';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef<HTMLInputElement | null>(null);
  const lang = useLang();

  const t = useT({
    zh: {
      title: '创建 HermesDeck 账户',
      subtitle: '注册后需要管理员批准才能访问控制台',
      username: '用户名',
      password: '密码',
      displayName: '显示名称（可选）',
      email: '邮箱（可选）',
      submit: '提交注册',
      submitting: '提交中…',
      back: '返回登录',
      missing: '请填写用户名和密码。',
      networkError: '网络错误，请稍后重试。',
      approvedHint: '账户创建后会进入待批准状态。',
    },
    en: {
      title: 'Create a HermesDeck account',
      subtitle: 'An administrator must approve your account before app access is enabled.',
      username: 'Username',
      password: 'Password',
      displayName: 'Display name (optional)',
      email: 'Email (optional)',
      submit: 'Request account',
      submitting: 'Submitting…',
      back: 'Back to sign in',
      missing: 'Please enter both username and password.',
      networkError: 'Network error — please try again.',
      approvedHint: 'New accounts are created as pending approval.',
    },
  });

  useEffect(() => { userRef.current?.focus(); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t.missing);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/deck/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ? localizeError(data.error, lang) : t.networkError);
        setSubmitting(false);
        return;
      }
      router.replace('/pending');
    } catch {
      setError(t.networkError);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <LanguageToggle style={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }} />
      <div className="login-card">
        <div className="login-brand">
          <Image src="/icons/icon-192.png" alt="" width={48} height={48} />
          <div>
            <div className="login-title">{t.title}</div>
            <div className="login-subtitle">{t.subtitle}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <label className="login-field">
            <span>{t.username}</span>
            <div className="login-input">
              <User size={14} />
              <input
                ref={userRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                spellCheck={false}
                autoCapitalize="none"
              />
            </div>
          </label>

          <label className="login-field">
            <span>{t.password}</span>
            <div className="login-input">
              <Lock size={14} />
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>

          <label className="login-field">
            <span>{t.displayName}</span>
            <div className="login-input">
              <User size={14} />
              <input
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </label>

          <label className="login-field">
            <span>{t.email}</span>
            <div className="login-input">
              <Mail size={14} />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </label>

          {error ? <div className="login-error">{error}</div> : null}

          <Btn
            type="submit"
            variant="primary"
            disabled={submitting}
            icon={<UserPlus size={14} />}
            style={{ justifyContent: 'center', width: '100%' }}
          >
            {submitting ? t.submitting : t.submit}
          </Btn>

          <a className="btn ghost" href="/login" style={{ justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
            <ArrowLeft size={14} />
            {t.back}
          </a>

          <div className="login-hint">{t.approvedHint}</div>
        </form>
      </div>
    </div>
  );
}
