'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Lock, User, UserPlus } from 'lucide-react';
import { Btn } from '@/components/Brand';
import { BrandMark } from '@/components/BrandMark';
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
  const [mfa, setMfa] = useState<{ token: string; totp: boolean; passkey: boolean } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const userRef = useRef<HTMLInputElement | null>(null);
  const lang = useLang();

  const t = useT({
    zh: {
      title: 'HermesDeck', subtitle: '登录以访问控制台', username: '用户名', password: '密码', submit: '登录', submitting: '登录中…',
      hint: '首次启动会生成一次性密码，请检查服务器日志。登录后请到设置页修改密码。', invalid: '用户名或密码错误。', missing: '请填写用户名和密码。',
      networkError: '网络错误，请稍后重试。', tooMany: '尝试次数过多，请稍后再试。', register: '创建新账户', mfaCode: '二次验证码', passkey: '使用通行密钥',
    },
    en: {
      title: 'HermesDeck', subtitle: 'Sign in to access the deck', username: 'Username', password: 'Password', submit: 'Sign in', submitting: 'Signing in…',
      hint: 'A one-time password is printed to the server log on first run. Change it from Settings after signing in.', invalid: 'Invalid username or password.', missing: 'Please enter both username and password.',
      networkError: 'Network error — please try again.', tooMany: 'Too many attempts — please wait and try again.', register: 'Create a new account', mfaCode: 'Two-factor code', passkey: 'Use passkey',
    },
  });

  useEffect(() => { userRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/deck/auth/session')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
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
    if (!username.trim() || !password) { setError(t.missing); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/deck/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), password }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(res.status === 429 ? t.tooMany : (data?.error ? localizeError(data.error, lang) : t.invalid));
        setSubmitting(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data?.pending) { window.location.replace('/pending'); return; }
      if (data?.mfaRequired && typeof data.mfaToken === 'string') {
        setMfa({ token: data.mfaToken, totp: !!data.factors?.totp, passkey: !!data.factors?.passkey });
        setSubmitting(false);
        return;
      }
      window.location.replace(next && next.startsWith('/') ? next : '/');
    } catch {
      setError(t.networkError);
      setSubmitting(false);
    }
  }

  async function finishTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!mfa) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/deck/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login-totp', mfaToken: mfa.token, code: totpCode }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || t.invalid);
      window.location.replace(next && next.startsWith('/') ? next : '/');
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : t.invalid, lang));
      setSubmitting(false);
    }
  }

  async function finishPasskey() {
    if (!mfa) return;
    setSubmitting(true); setError(null);
    try {
      const optRes = await fetch('/api/deck/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'passkey-login-options', mfaToken: mfa.token }) });
      const opt = await optRes.json();
      if (!optRes.ok) throw new Error(opt?.error || t.invalid);
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const response = await startAuthentication({ optionsJSON: opt.options });
      const res = await fetch('/api/deck/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'passkey-login-verify', mfaToken: mfa.token, challengeId: opt.challengeId, response }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || t.invalid);
      window.location.replace(next && next.startsWith('/') ? next : '/');
    } catch (err) {
      setError(localizeError(err instanceof Error ? err.message : t.invalid, lang));
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <LanguageToggle className="btn icon ghost login-language-toggle" style={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }} />
      <div className="login-card">
        <div className="login-brand"><BrandMark alt="HermesDeck" width={48} height={48} /><div><div className="login-title">{t.title}</div><div className="login-subtitle">{t.subtitle}</div></div></div>
        <form onSubmit={mfa?.totp ? finishTotp : onSubmit} className="login-form">
          {!mfa ? <>
            <label className="login-field"><span>{t.username}</span><div className="login-input"><User size={14} /><input ref={userRef} type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoCapitalize="none" /></div></label>
            <label className="login-field"><span>{t.password}</span><div className="login-input"><Lock size={14} /><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div></label>
          </> : null}
          {mfa?.totp ? <label className="login-field"><span>{t.mfaCode}</span><div className="login-input"><Lock size={14} /><input inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} /></div></label> : null}
          {error ? <div className="login-error">{error}</div> : null}
          {mfa?.totp ? <Btn type="submit" variant="primary" disabled={submitting} icon={<LogIn size={14} />} style={{ justifyContent: 'center', width: '100%' }}>{submitting ? t.submitting : t.submit}</Btn> : null}
          {mfa?.passkey ? <Btn type="button" disabled={submitting} onClick={finishPasskey} style={{ justifyContent: 'center', width: '100%' }}>{t.passkey}</Btn> : null}
          {!mfa ? <Btn type="submit" variant="primary" disabled={submitting} icon={<LogIn size={14} />} style={{ justifyContent: 'center', width: '100%' }}>{submitting ? t.submitting : t.submit}</Btn> : null}
          {!mfa ? <a className="btn ghost" href="/register" style={{ justifyContent: 'center', width: '100%', textDecoration: 'none' }}><UserPlus size={14} />{t.register}</a> : null}
          {bootstrap && !mfa ? <div className="login-hint">{t.hint}</div> : null}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
