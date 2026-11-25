import { useEffect, useState } from 'react';
import { en, type MessageKey } from '../../../../i18n/en';
import { ur } from '../../../../i18n/ur';
import { timeText } from '../../../alerts/labels';
import { Ico, initial } from '../../../alerts/ui';
import { MONEY_DIR, money } from '../money';
import { idleDisplay, openDisplayChannel, readDisplayMessage } from './channel';

function Bilingual({ label }: { label: MessageKey }) {
  return <>{en[label]} · <bdi lang="ur" dir="rtl">{ur[label]}</bdi></>;
}

function MenuName({ name }: { name: string }) {
  // Menu names are a single configured label. Preserve a bilingual label when it already includes Urdu.
  const bilingual = /^(.+?) · (\p{Script=Arabic}.*)$/u.exec(name);
  return bilingual === null
    ? <bdi>{name}</bdi>
    : <span><bdi>{bilingual[1]}</bdi> · <bdi lang="ur" dir="rtl">{bilingual[2]}</bdi></span>;
}

function Amount({ minor, className = '' }: { minor: number | null; className?: string }) {
  return <bdi className={className} dir={MONEY_DIR}>{minor === null ? '—' : money(minor)}</bdi>;
}

export function CustomerDisplay({ utcOffsetMs }: { utcOffsetMs?: number } = {}) {
  // Both values are already in the staff HTML. Opening the display does not start a staff session.
  const [offset] = useState(() => utcOffsetMs ??
    (Number(document.querySelector<HTMLMetaElement>('meta[name="pos-hub-utc-offset-ms"]')?.content) || 0));
  const [branch] = useState(() => document.querySelector<HTMLMetaElement>('meta[name="pos-branch-name"]')?.content ?? '');
  const [message, setMessage] = useState(() => idleDisplay('en'));

  useEffect(() => {
    const channel = openDisplayChannel();
    if (channel === null) return;
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const next = readDisplayMessage(event.data);
      if (next !== null) setMessage(next);
    });
    return () => channel.close();
  }, []);

  return (
    <main className="pu v-brand cd" lang="en" dir="ltr" data-theme="light">
      {message.kind === 'cart' && (
        <section className="cd-l">
          <h2><Bilingual label="cd.order" /></h2>
          <ul>
            {message.lines.map((line, index) => (
              <li className="cd-row" key={index}>
                <bdi className="q" dir="ltr">{line.qty}×</bdi>
                <MenuName name={line.name} />
                <Amount minor={line.line_minor} className="cd-price" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={message.kind === 'cart' ? 'cd-r' : 'cd-r cd-centered'} aria-live="polite">
        <header className="cd-header">
          {branch !== '' && <span className="cd-mark" aria-label={branch}>{initial(branch)}</span>}
        </header>
        {message.kind === 'idle' && <h1 className="cd-big"><Bilingual label="cd.welcome" /></h1>}
        {message.kind === 'cart' && (
          <>
            <div className="cd-label"><Bilingual label="cd.total" /></div>
            <Amount minor={message.total_minor} className="cd-big" />
            <div className="tk-readyby">
              <span className="tk-readyby__ic"><Ico name="clock" /></span>
              <div className="tk-readyby__t">
                <small><Bilingual label="c.ready_by" /></small>
                <bdi className="cd-time" dir="ltr">{message.ready_by_ms === null ? '—' : timeText(message.ready_by_ms, offset)}</bdi>
              </div>
            </div>
          </>
        )}
        {message.kind === 'paid' && (
          <div className="cd-paid">
            <h1 className="cd-big"><Ico name="check" /> <Bilingual label="cd.paid" /></h1>
            <div className="cd-label"><Bilingual label="cd.total" /> <Amount minor={message.total_minor} /></div>
            {message.change_minor !== undefined && (
              <div className="cd-label"><Bilingual label="cd.change" /> <Amount minor={message.change_minor} /></div>
            )}
          </div>
        )}
        <footer className="cd-footer">{en['cd.thanks']} <bdi lang="ur" dir="rtl">{ur['cd.thanks']}</bdi></footer>
      </section>
    </main>
  );
}
