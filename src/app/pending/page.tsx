'use client';
import Image from 'next/image';
import { ArrowLeft, Clock, LogOut } from 'lucide-react';
import { Btn } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useT } from '@/lib/i18n';

export default function PendingPage() {
  const t = useT({
    zh: {
      title: '账户待批准',
      subtitle: '管理员批准你的账户后，你就可以访问 HermesDeck。',
      body: '你的注册请求已收到。当前账户不会获得应用会话，也不能访问受保护页面或 /api/deck/* 功能。请稍后返回登录重试。',
      login: '返回登录',
      signOut: '清除会话并返回登录',
    },
    en: {
      title: 'Account pending approval',
      subtitle: 'An administrator must approve your account before you can use HermesDeck.',
      body: 'Your registration request has been received. Pending accounts do not receive an app session and cannot access protected pages or /api/deck/* functionality. Please return to sign in after approval.',
      login: 'Back to sign in',
      signOut: 'Clear session and return to sign in',
    },
  });

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

        <div className="login-form">
          <div className="login-hint" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Clock size={16} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{t.body}</span>
          </div>

          <a className="btn primary" href="/login" style={{ justifyContent: 'center', width: '100%', textDecoration: 'none' }}>
            <ArrowLeft size={14} />
            {t.login}
          </a>

          <form action="/api/deck/auth/logout" method="post">
            <Btn type="submit" variant="ghost" icon={<LogOut size={14} />} style={{ justifyContent: 'center', width: '100%' }}>
              {t.signOut}
            </Btn>
          </form>
        </div>
      </div>
    </div>
  );
}
