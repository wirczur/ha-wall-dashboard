// Assist on the panel: round button in the corner; sheet with the conversation, input, hold-to-talk microphone.
import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { assistant, useAssistant } from '../lib/assist';
import { Icon } from '../ui/Icon';

const DEFAULT_HINTS = ['Zgaś wszystkie światła na parterze', 'Jaka jest temperatura w salonie?', 'Włącz telewizor w salonie', 'Czy brama jest zamknięta?'];
const PHASE: Record<string, string> = { ready: 'Powiedz słowo wybudzające…', listening: 'Słucham…', thinking: 'Myślę…', speaking: 'Odpowiadam…' };

export const AssistantButton: FC = () => {
  const st = useAssistant();
  if (!st.cfg) return null;
  return <>
    <button className={'as-fab' + (st.phase !== 'idle' && st.phase !== 'ready' ? ' busy' : '') + (st.wakeOn ? ' wake' : '')} onClick={() => assistant.open(!st.open)}
      aria-label="Asystent" title={st.wakeOn ? 'Asystent – słucha słowa wybudzającego' : 'Asystent'}>
      <Icon name={st.phase === 'listening' ? 'mdi:microphone' : 'mdi:account-voice'} size={26} />
    </button>
    {st.open && <AssistSheet />}
  </>;
};

const AssistSheet: FC = () => {
  const st = useAssistant();
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [st.msgs.length, st.phase]);
  const cfg = st.cfg!;
  const hints = cfg.hints?.length ? cfg.hints : DEFAULT_HINTS;
  const send = () => { assistant.ask(text); setText(''); };
  const voice = cfg.voice !== 'off';
  return createPortal(
    <div className="as-scrim" onClick={() => assistant.open(false)}>
      <div className="as-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Asystent">
        <div className="as-h">
          <b><Icon name="mdi:account-voice" size={20} /> Asystent</b>
          <small>{PHASE[st.phase] ?? (st.wakeOn ? 'słucha słowa wybudzającego' : '')}</small>
          <span className="grow" />
          {st.msgs.length > 0 && <button className="as-new" onClick={() => assistant.reset()} title="Zacznij od zera – asystent zapomni wcześniejsze pytania"><Icon name="mdi:chat-plus-outline" size={18} />Nowa rozmowa</button>}
          <button className="as-x" onClick={() => assistant.open(false)} aria-label="Zamknij"><Icon name="close" size={20} /></button>
        </div>
        <div className="as-list" ref={list}>
          {!st.msgs.length && <p className="as-empty">Zapytaj o coś albo poproś o zmianę – np. światła, temperaturę, rolety.{voice ? ' Przytrzymaj mikrofon i mów.' : ''}</p>}
          {st.msgs.map((m) => m.who === 'sep' ? <div key={m.id} className="as-sep"><span>{m.text}</span></div> : <div key={m.id} className={'as-m ' + m.who}>{m.text}</div>)}
          {st.phase === 'thinking' && <div className="as-m ai as-dots"><i /><i /><i /></div>}
        </div>
        {st.micError && <small className="as-err">{st.micError}</small>}
        <div className="as-hints">{hints.map((h) => <button key={h} onClick={() => assistant.ask(h)}>{h}</button>)}</div>
        <div className="as-in">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Napisz polecenie…" aria-label="Polecenie" />
          {text.trim()
            ? <button className="as-send" onClick={send} aria-label="Wyślij"><Icon name="mdi:send" size={22} /></button>
            : voice && <button className={'as-mic' + (st.phase === 'listening' ? ' on' : '')} aria-label="Przytrzymaj i mów"
                onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); assistant.pttDown(); }}
                onPointerUp={() => assistant.pttUp()} onPointerCancel={() => assistant.pttUp()} onContextMenu={(e) => e.preventDefault()}>
                <Icon name="mdi:microphone" size={24} /></button>}
        </div>
      </div>
    </div>, document.body
  );
};
