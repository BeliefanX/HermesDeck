'use client';
import { Card, Page } from '@/components/Brand';
import { LiveTerminal } from '@/components/LiveTerminal';

export default function TerminalPage() {
  return (
    <Page>
      <Card
        padding={0}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 'clamp(560px, calc(100dvh - 120px), 1600px)',
        }}
      >
        <LiveTerminal />
      </Card>
    </Page>
  );
}
