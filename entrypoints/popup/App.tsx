import { useEffect, useState } from 'react';
import type { CategoryId, ClassifySource } from '../../src/core/types';
import { CATEGORY_META } from '../../src/shared/defaults';
import { clockHM, hhmm } from '../../src/shared/format';
import type { PopupState } from '../../src/shared/messages';
import { useBodyMood } from '../../src/shared/mood';
import '../../src/shared/theme.css';
import './popup.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'private', 'other'];
const SOURCE: Record<ClassifySource, string> = { manual: '本页手动', channel: '按频道', rule: '按规则', default: '未归类' };

export function App() {
  const [st, setSt] = useState<PopupState | null>(null);
  const [now, setNow] = useState(Date.now());
  useBodyMood(st && st.phase !== 'day' ? 'night' : 'day');

  async function load(): Promise<void> {
    // ?tab=<id>：在普通标签页里打开 popup.html 时指定要看的标签（截图 / E2E 用）
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    const [t] = forced ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
    const id = forced || (t?.id ?? null);
    setSt((await chrome.runtime.sendMessage({ type: 'popup-state', tabId: id })) as PopupState);
  }

  useEffect(() => {
    void load();
    const a = setInterval(() => void load(), 5000);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  if (!st) return <div className="sw pop" />;
  const night = st.phase !== 'day';
  const send = async (msg: object) => {
    await chrome.runtime.sendMessage(msg);
    await load();
  };
  const tab = st.tab;
  const site = tab ? tab.host.replace(/^www\./, '') : '';
  const germanMin = Math.floor(st.germanSec / 60);

  return (
    <div className="sw pop" data-mood={night ? 'night' : 'day'}>
      <header className="pop-head">
        <span className="wordmark">SurfWarden</span>
        <PhaseLine st={st} now={now} />
      </header>

      {night ? (
        <section className="hero">
          <span className="sw-num clock">{hhmm(now)}</span>
          <p className="hero-sub">
            {st.phase === 'curfew' ? `该睡了 · 明早 ${st.wake} 起床` : `收个尾，${st.bedtime} 上床`}
          </p>
          <p className="sw-note">今天德语 {germanMin} 分钟，已经够了。</p>
        </section>
      ) : (
        <section className="hero">
          <span className="sw-label">今天的德语</span>
          <div className="hero-num">
            <span className="sw-num big">{germanMin}</span>
            <span className="unit">/ {st.germanGoalMin} 分钟</span>
            {germanMin >= st.germanGoalMin && <span className="done">达标</span>}
          </div>
          <Meter value={germanMin} goal={st.germanGoalMin} color={CATEGORY_META.german.color} />
        </section>
      )}

      <section className="stats">
        <Stat label="娱乐" value={`${Math.floor(st.driftSec / 60)}`} unit={`/ ${st.driftCapMin} 分`} over={st.driftSec / 60 >= st.driftCapMin} />
        <Stat label="私密" value={`${st.privateUsed}`} unit={`/ ${st.privatePerDay} 次`} over={st.privateUsed >= st.privatePerDay} />
        <Stat
          label="网页总计"
          value={st.totalSec >= 3600 ? clockHM(st.totalSec * 1000) : String(Math.floor(st.totalSec / 60))}
          unit={st.totalSec >= 3600 ? '小时' : '分'}
        />
      </section>

      {tab && (
        <section className="sw-card page">
          <div className="page-head">
            <span className="sw-swatch" style={{ background: CATEGORY_META[tab.category].color }} />
            <span className="host" title={tab.category === 'private' ? undefined : tab.url}>
              {tab.category === 'private' ? '私密站点' : site}
            </span>
            <span className="src">
              {CATEGORY_META[tab.category].name} · {SOURCE[tab.source]}
            </span>
          </div>

          <p className="sw-label lab">这一页算</p>
          <Seg current={tab.category} onPick={(c) => void send({ type: 'override', tabId: tab.tabId, category: c })} />

          {tab.channel && (
            <>
              <p className="sw-label lab">
                {tab.channel.platform === 'bilibili' ? 'UP 主' : '频道'} · {tab.channel.name}
              </p>
              <Seg
                current={tab.source === 'channel' ? tab.category : undefined}
                only={['german', 'study', 'drift']}
                onPick={(c) => void send({ type: 'mark-channel', tabId: tab.tabId, category: c })}
              />
            </>
          )}

          <p className="sw-label lab">整个站点以后都算</p>
          <Seg current={tab.source === 'rule' ? tab.category : undefined} onPick={(c) => void send({ type: 'add-rule', pattern: site, category: c })} />
        </section>
      )}

      {st.continueGerman && !night && (
        <button className="sw-btn sw-btn-cta wide" onClick={() => void chrome.tabs.create({ url: st.continueGerman!.url })}>
          继续德语 · {st.continueGerman.name}
        </button>
      )}

      {!st.incognitoAllowed && (
        <button className="notice" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
          隐身窗口还没授权——在那里刷的不会被统计，也不会被拦。<u>去打开</u>
        </button>
      )}

      <footer className="pop-foot">
        <button className="sw-btn-quiet" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/report.html') })}>
          报告
        </button>
        <button className="sw-btn-quiet" onClick={() => void chrome.runtime.openOptionsPage()}>
          设置
        </button>
        <span className="ver">v{chrome.runtime.getManifest().version}</span>
      </footer>
    </div>
  );
}

function PhaseLine({ st, now }: { st: PopupState; now: number }) {
  const left = st.nextChangeAt - now;
  if (st.phase === 'curfew') return <span className="phase night">宵禁中</span>;
  if (st.phase === 'winddown') return <span className="phase warn">离上床 {Math.max(0, Math.ceil(left / 60_000))} 分</span>;
  return <span className="phase">{clockHM(left)} 后收尾</span>;
}

function Meter({ value, goal, color }: { value: number; goal: number; color: string }) {
  return (
    <div className="sw-meter">
      <i style={{ width: `${Math.min(1, goal > 0 ? value / goal : 0) * 100}%`, background: color }} />
    </div>
  );
}

function Stat({ label, value, unit, over }: { label: string; value: string; unit: string; over?: boolean }) {
  return (
    <div className="stat">
      <span className="sw-label">{label}</span>
      <span>
        <span className={`sw-num v${over ? ' over' : ''}`}>{value}</span> <span className="u">{unit}</span>
      </span>
    </div>
  );
}

function Seg({ current, only = CATS, onPick }: { current?: CategoryId; only?: CategoryId[]; onPick: (c: CategoryId) => void }) {
  return (
    <div className="sw-seg">
      {only.map((c) => (
        <button key={c} className={c === current ? 'on' : ''} onClick={() => onPick(c)}>
          <span className="sw-dot" style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].name}
        </button>
      ))}
    </div>
  );
}
