'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Lock, User, UserPlus } from 'lucide-react';
import { Btn } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { localizeError, useLang, useT } from '@/lib/i18n';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search?.get('next') || '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState(false);
  const userRef = useRef<HTMLInputElement | null>(null);
  const lang = useLang();

  const t = useT({
    zh: {
      title: 'HermesDeck',
      subtitle: '登录以访问控制台',
      username: '用户名',
      password: '密码',
      submit: '登录',
      submitting: '登录中…',
      hint: '首次启动会生成一次性密码，请检查服务器日志。登录后请到设置页修改密码。',
      invalid: '用户名或密码错误。',
      missing: '请填写用户名和密码。',
      networkError: '网络错误，请稍后重试。',
      tooMany: '尝试次数过多，请稍后再试。',
      register: '创建新账户',
    },
    en: {
      title: 'HermesDeck',
      subtitle: 'Sign in to access the deck',
      username: 'Username',
      password: 'Password',
      submit: 'Sign in',
      submitting: 'Signing in…',
      hint: 'A one-time password is printed to the server log on first run. Change it from Settings after signing in.',
      invalid: 'Invalid username or password.',
      missing: 'Please enter both username and password.',
      networkError: 'Network error — please try again.',
      tooMany: 'Too many attempts — please wait and try again.',
      register: 'Create a new account',
    },
  });

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/deck/auth/session')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        // Already signed in (the user opened /login directly) — send them
        // where they were headed instead of stranding them on a dead form.
        if (d?.authenticated) {
          router.replace(next && next.startsWith('/') ? next : '/');
          return;
        }
        setBootstrap(Boolean(d?.bootstrap));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t.missing);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/deck/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(t.tooMany);
        } else {
          setError(data?.error ? localizeError(data.error, lang) : t.invalid);
        }
        setSubmitting(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data?.pending) {
        window.location.replace('/pending');
        return;
      }
      // Use a hard navigation so middleware re-evaluates with the fresh cookie.
      const target = next && next.startsWith('/') ? next : '/';
      window.location.replace(target);
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>

          {error ? <div className="login-error">{error}</div> : null}

          <Btn
            type="submit"
            variant="primary"
            disabled={submitting}
            icon={<LogIn size={14} />}
            style={{ justifyContent: 'center', width: '100%' }}
          >
            {submitting ? t.submitting : t.submit}
          </Btn>

          <a className="btn ghost" href="/register" style={{ justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
            <UserPlus size={14} />
            {t.register}
          </a>

          {bootstrap ? <div className="login-hint">{t.hint}</div> : null}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
