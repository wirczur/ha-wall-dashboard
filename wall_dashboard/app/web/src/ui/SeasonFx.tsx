// A few slow particles over the background (snow, hearts, leaves, petals). Pure CSS animation, hidden on lite tablets.
import { useMemo, type CSSProperties, type FC } from 'react';
import type { FxKind } from '../lib/occasion';

const COLORS: Record<string, string[]> = {
  leaves: ['#E0782B', '#B5541C', '#D9A33A', '#8C3B1E'],
  petals: ['#FFFFFF', '#F7D6E6', '#FBEFB4', '#D8ECC1'],
  hearts: ['var(--accent)', '#E77D93', '#F2B3C0']
};

export const SeasonFx: FC<{ kind: FxKind; count?: number }> = ({ kind, count = kind === 'snow' ? 34 : 22 }) => {
  const items = useMemo(() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    return Array.from({ length: count }, () => ({ x: rnd() * 100, s: rnd(), d: rnd(), delay: rnd(), sway: rnd() - .5, c: Math.floor(rnd() * 4) }));
  }, [count]);
  if (kind === 'none') return null;
  return (
    <div className={'fx fx-' + kind} aria-hidden="true">
      {items.map((p, i) => {
        const size = kind === 'snow' ? 4 + p.s * 6 : 10 + p.s * 12;
        const dur = (kind === 'snow' ? 14 : 22) + p.d * 16;
        const pal = COLORS[kind];
        const style = {
          '--x': p.x + '%', '--s': size + 'px', '--d': dur + 's', '--delay': -p.delay * dur + 's', '--sway': p.sway * 120 + 'px',
          '--o': kind === 'snow' ? .35 + p.s * .5 : .55 + p.s * .3,
          ...(kind === 'leaves' || kind === 'petals' ? { width: size, height: size * .7, borderRadius: '0 80% 0 80%', background: pal[p.c % pal.length] } : {}),
          ...(kind === 'hearts' ? { color: pal[p.c % pal.length] } : {})
        } as CSSProperties;
        return <i key={i} style={style}>{kind === 'hearts' ? '♥' : null}</i>;
      })}
    </div>
  );
};
