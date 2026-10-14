import { useEffect, useState } from 'react';
import type { CategoryId, ClassifySource } from '../../src/core/types';
import { CATEGORY_META } from '../../src/shared/defaults';
import { clockHM, formatMin, mmss } from '../../src/shared/format';
import type { PopupState } from '../../src/shared/messages';
import '../../src/shared/theme.css';
import './popup.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'other'];
const SOURCE: Record<ClassifySource, string> = { manual: '本页手动', channel: '按频道', rule: '按规则', default: '未归类' };

export function App() {
  const [st, setSt] = useState<PopupState | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  async function load(): Promise<void> {
    // ?tab=<id>：在普通标签页里打开 popup.html 时指定要看的标签（截图 / E2E 用）
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    const [t] = forced ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
    const id = forced || (t?.id ?? null);
    setTabId(id);
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

  if (!st) return <div className="od-app pop" />;

  const send = async (msg: object) => {
    await chrome.runtime.sendMessage(msg);
    await load();
  };
  const tab = st.tab;
  const site = tab?.host.replace(/^www\./, '');

  return (
    <div className="od-app pop">
      <header className="pop-head">
        <span className="brand">
          SURF<b>WARDEN</b>
        </span>
        <PhasePill st={st} now={now} />
      </header>

      <section className="od-card pad">
        <Meter label="德语" value={st.germanSec} goalMin={st.germanGoalMin} color={CATEGORY_META.german.color} done="今日达标 ✓" />
        <Meter label="娱乐" value={st.driftSec} goalMin={st.driftCapMin} color={CATEGORY_META.drift.color} done="额度用完" />
        <p className="od-caption total">今天网页总计 {formatMin(st.totalSec)}</p>
      </section>

      {tab && (
        <section className="od-card pad">
          <div className="cur">
            <span className="dot" style={{ background: CATEGORY_META[tab.category].color }} />
            <span className="host" title={tab.url}>
              {site}
            </span>
            <span className="od-caption src">
              {CATEGORY_META[tab.category].name} · {SOURCE[tab.source]}
            </span>
          </div>
          {tab.timing && <p className="live">● 记录中 {mmss(tab.liveSec * 1000)}</p>}

          <p className="label">这一页算</p>
          <CatButtons current={tab.category} onPick={(c) => void send({ type: 'override', tabId: tab.tabId, category: c })} />

          {tab.channel && (
            <>
              <p className="label">
                {tab.channel.platform === 'bilibili' ? 'UP 主' : '频道'}「{tab.channel.name}」以后都算
              </p>
              <CatButtons
                current={tab.source === 'channel' ? tab.category : undefined}
                only={['german', 'study', 'drift']}
                onPick={(c) => void send({ type: 'mark-channel', tabId: tab.tabId, category: c })}
              />
            </>
          )}

          <p className="label">整个 {site} 以后都算</p>
          <CatButtons
            current={tab.source === 'rule' ? tab.category : undefined}
            onPick={(c) => void send({ type: 'add-rule', pattern: site, category: c })}
          />
        </section>
      )}

      {st.continueGerman && (
        <button className="od-btn od-btn-signal wide" onClick={() => void chrome.tabs.create({ url: st.continueGerman!.url })}>
          继续德语 · {st.continueGerman.name}
        </button>
      )}

      {!st.incognitoAllowed && (
        <section className="od-card pad warn">
          隐身窗口未授权：在隐身里刷的不会被统计，也不会被拦。
          <button className="od-btn-mini" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
            去打开「允许在隐身模式下运行」
          </button>
        </section>
      )}

      <footer className="pop-foot">
        <button className="od-btn-mini" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/report.html') })}>
          报告
        </button>
        <button className="od-btn-mini" onClick={() => void chrome.runtime.openOptionsPage()}>
          设置
        </button>
        <span className="od-caption ver">v{chrome.runtime.getManifest().version}</span>
      </footer>
    </div>
  );
}

function PhasePill({ st, now }: { st: PopupState; now: number }) {
  if (st.phase === 'curfew') return <span className="pill violet">宵禁中 · 明早 {st.wake}</span>;
  const left = st.nextChangeAt - now;
  if (st.phase === 'winddown') return <span className="pill amber">离上床 {Math.max(0, Math.ceil(left / 60_000))} 分</span>;
  return <span className="pill">{clockHM(left)} 后收尾</span>;
}

function Meter({ label, value, goalMin, color, done }: { label: string; value: number; goalMin: number; color: string; done: string }) {
  const min = Math.floor(value / 60);
  const ratio = goalMin > 0 ? Math.min(1, min / goalMin) : 0;
  return (
    <div className="meter">
      <div className="od-meter-row">
        <span>{label}</span>
        <span className="od-stat">
          {min} <small>/ {goalMin} 分</small>
          {min >= goalMin && <em> {done}</em>}
        </span>
      </div>
      <div className="od-meter">
        <i style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function CatButtons({ current, only = CATS, onPick }: { current?: CategoryId; only?: CategoryId[]; onPick: (c: CategoryId) => void }) {
  return (
    <div className="cats">
      {only.map((c) => (
        <button
          key={c}
          className={`cat-btn${c === current ? ' on' : ''}`}
          style={{ ['--c' as string]: CATEGORY_META[c].color }}
          onClick={() => onPick(c)}
        >
          {CATEGORY_META[c].name}
        </button>
      ))}
    </div>
  );
}
