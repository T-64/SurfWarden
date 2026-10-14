import { useEffect, useState, type ReactNode } from 'react';
import { config } from '../../src/adapters/config';
import { clearAll, exportAll } from '../../src/adapters/db';
import { GATE_WAITS } from '../../src/core/policy';
import { formatHHMM, parseHHMM, phaseAt } from '../../src/core/schedule';
import type { CategoryId, ChannelRule, GermanTarget, Rule, Settings } from '../../src/core/types';
import { parsePattern } from '../../src/core/urlMatch';
import { CATEGORY_META } from '../../src/shared/defaults';
import { useBodyMood } from '../../src/shared/mood';
import '../../src/shared/theme.css';
import './options.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'private', 'other'];

interface Draft {
  settings: Settings;
  rules: Rule[];
  channels: ChannelRule[];
  targets: GermanTarget[];
}

export function OptionsApp() {
  const [saved, setSaved] = useState<Draft | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [incognito, setIncognito] = useState(true);
  const [flash, setFlash] = useState('');
  const locked = saved ? phaseAt(Date.now(), saved.settings.schedule) !== 'day' : false;
  useBodyMood(locked ? 'night' : 'day');

  async function load(): Promise<void> {
    const draft = {
      settings: await config.getSettings(),
      rules: await config.getRules(),
      channels: await config.getChannels(),
      targets: await config.getTargets(),
    };
    setSaved(draft);
    setD(structuredClone(draft));
    setIncognito(await chrome.extension.isAllowedIncognitoAccess());
  }
  useEffect(() => void load(), []);

  if (!d || !saved) return <div className="sw opt" />;

  // 收尾 / 宵禁期间锁定"放松约束"的配置——否则半夜改个就寝时间就绕过去了
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const badRules = d.rules.filter((r) => !parsePattern(r.pattern));
  const badTargets = d.targets.filter((t) => !/^https?:\/\//.test(t.url));
  const invalid = badRules.length + badTargets.length > 0;
  const s = d.settings;
  const set = (patch: Partial<Settings>) => setD({ ...d, settings: { ...s, ...patch } });
  const setRule = (id: string, patch: Partial<Rule>) => setD({ ...d, rules: d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const dropRule = (id: string) => setD({ ...d, rules: d.rules.filter((r) => r.id !== id) });
  const publicRules = d.rules.filter((r) => r.category !== 'private');
  const privateRules = d.rules.filter((r) => r.category === 'private');

  async function save(): Promise<void> {
    if (!d || invalid) return;
    await Promise.all([config.saveSettings(d.settings), config.saveRules(d.rules), config.saveChannels(d.channels), config.saveTargets(d.targets)]);
    await load();
    setFlash('已保存，立即生效');
    setTimeout(() => setFlash(''), 2500);
  }

  function addRule(category: CategoryId): void {
    const createdAt = d!.rules.reduce((m, r) => Math.max(m, r.createdAt), 0) + 1;
    setD({ ...d!, rules: [{ id: `r-${Date.now()}`, pattern: '', category, createdAt }, ...d!.rules] });
  }

  return (
    <div className="sw opt" data-mood={locked ? 'night' : 'day'}>
      <header className="opt-head">
        <p className="sw-label">SurfWarden · 设置</p>
        <h1 className="sw-title">规则写给白天的自己。</h1>
        <p className="sw-note">晚上（收尾和宵禁期间）作息、额度和白名单会锁住，第二天白天再改。所有数据只在本机。</p>
      </header>

      {!incognito && (
        <Block title="隐身窗口还没授权" note="不打开的话，隐身窗口里的浏览既不会被统计，也不会被拦。">
          <button className="sw-btn sw-btn-ghost" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
            打开扩展详情 → 允许在隐身模式下运行
          </button>
        </Block>
      )}

      <Block
        title="作息"
        note={`白天 → ${formatHHMM(s.schedule.windDown)} 收尾（娱乐关闭）→ ${formatHHMM(s.schedule.bedtime)} 宵禁 → ${formatHHMM(s.schedule.wake)} 起床`}
      >
        <div className="fields three">
          {(
            [
              ['windDown', '开始收尾'],
              ['bedtime', '上床'],
              ['wake', '起床'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                type="time"
                className="sw-input time"
                disabled={locked}
                value={formatHHMM(s.schedule[k])}
                onChange={(e) => {
                  const m = parseHHMM(e.target.value);
                  if (m !== null) set({ schedule: { ...s.schedule, [k]: m } });
                }}
              />
            </Field>
          ))}
        </div>
      </Block>

      <Block title="德语" note="拦截页和 popup 的「去学德语」优先回到你上次学德语的页面；没有记录时用下面第一个入口。">
        <div className="fields">
          <Field label="每日目标（分钟）">
            <Num value={s.germanGoalMin} min={5} max={600} onChange={(v) => set({ germanGoalMin: v })} />
          </Field>
        </div>
        <p className="sw-label lab">德语入口</p>
        {d.targets.map((t, i) => (
          <div className="row" key={t.id}>
            <input
              className="sw-input name"
              value={t.name}
              placeholder="名称"
              onChange={(e) => setD({ ...d, targets: d.targets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
            />
            <input
              className={`sw-input grow${badTargets.includes(t) ? ' bad' : ''}`}
              value={t.url}
              placeholder="https://…"
              onChange={(e) => setD({ ...d, targets: d.targets.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
            <button className="sw-btn-quiet" onClick={() => setD({ ...d, targets: d.targets.filter((_, j) => j !== i) })}>
              删除
            </button>
          </div>
        ))}
        <button className="sw-btn-quiet" onClick={() => setD({ ...d, targets: [...d.targets, { id: `t-${Date.now()}`, name: '', url: '' }] })}>
          + 添加入口
        </button>
      </Block>

      <Block title="娱乐" note={`白天进入娱乐站要先写意图、选时长；每次申请前的等待逐次变长（${GATE_WAITS.join(' / ')} 秒，不可改）。`}>
        <div className="fields">
          <Field label="每日总额（分钟）">
            <Num value={s.driftCapMin} min={0} max={600} disabled={locked} onChange={(v) => set({ driftCapMin: v })} />
          </Field>
          <Field label="可选时长（分钟，逗号分隔）">
            <input
              className="sw-input"
              disabled={locked}
              defaultValue={s.passOptionsMin.join(', ')}
              onChange={(e) => {
                const opts = e.target.value
                  .split(/[,，\s]+/)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n > 0 && n <= 120);
                if (opts.length > 0) set({ passOptionsMin: opts });
              }}
            />
          </Field>
        </div>
      </Block>

      <Block title="私密站点" note="打开这类网站时先进入冷静期：离开屏幕去洗把冷水脸、做几个俯卧撑，回来再决定。夜间一律拦截。">
        <div className="fields three">
          <Field label="冷静期（秒）">
            <Num value={s.privateCooldownSec} min={60} max={900} disabled={locked} onChange={(v) => set({ privateCooldownSec: v })} />
          </Field>
          <Field label="进入后可停留（分钟）">
            <Num value={s.privatePassMin} min={5} max={60} disabled={locked} onChange={(v) => set({ privatePassMin: v })} />
          </Field>
          <Field label="每天最多（次）">
            <Num value={s.privatePerDay} min={0} max={5} disabled={locked} onChange={(v) => set({ privatePerDay: v })} />
          </Field>
        </div>
        <details className="fold">
          <summary>站点列表（{privateRules.length} 个）</summary>
          <RuleRows rules={privateRules} bad={badRules} onSet={setRule} onDrop={dropRule} />
          <button className="sw-btn-quiet" onClick={() => addRule('private')}>
            + 添加站点
          </button>
        </details>
      </Block>

      <Block title="宵禁白名单" note="宵禁期间这些类别和站点仍可打开（会显示「已过就寝 N 分钟」）。娱乐和私密永远不在白名单里。">
        <div className="checks">
          {(['german', 'study', 'other'] as const).map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                disabled={locked}
                checked={s.curfewAllow.categories.includes(c)}
                onChange={(e) =>
                  set({
                    curfewAllow: {
                      ...s.curfewAllow,
                      categories: e.target.checked ? [...s.curfewAllow.categories, c] : s.curfewAllow.categories.filter((x) => x !== c),
                    },
                  })
                }
              />
              {CATEGORY_META[c].name}
            </label>
          ))}
        </div>
        <Field label="额外放行的站点（每行一个域名，含子域）">
          <textarea
            className="sw-input mono"
            rows={8}
            disabled={locked}
            defaultValue={s.curfewAllow.hosts.join('\n')}
            onChange={(e) =>
              set({
                curfewAllow: {
                  ...s.curfewAllow,
                  hosts: e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </Field>
        <div className="fields">
          <Field label="每晚可延长次数">
            <Num value={s.curfewExtPerNight} min={0} max={3} disabled={locked} onChange={(v) => set({ curfewExtPerNight: v })} />
          </Field>
          <Field label="每次延长（分钟）">
            <Num value={s.curfewExtMin} min={1} max={30} disabled={locked} onChange={(v) => set({ curfewExtMin: v })} />
          </Field>
        </div>
      </Block>

      <Block
        title="网址规则"
        note="写法：域名（含子域）· 域名/路径/* · *.域名/* · 完整网址 · re:正则。越具体的规则越优先；B 站、YouTube 按 UP 主区分请用下面的「频道」。"
      >
        <button className="sw-btn-quiet" onClick={() => addRule('drift')}>
          + 添加规则
        </button>
        <RuleRows rules={publicRules} bad={badRules} onSet={setRule} onDrop={dropRule} />
        {badRules.length > 0 && <p className="bad-note">有 {badRules.length} 条规则写法不对（红框），改好才能保存。</p>}
      </Block>

      <Block title="频道" note="B 站 UP 主 / YouTube 频道。在视频页的遮罩或 popup 里一键标记；频道优先于网址规则。">
        {d.channels.length === 0 && <p className="sw-note">还没有标记过频道。</p>}
        {d.channels.map((c, i) => (
          <div className="row rule" key={`${c.platform}:${c.id}`}>
            <span className="plat">{c.platform === 'bilibili' ? 'B 站' : 'YouTube'}</span>
            <span className="grow">{c.name}</span>
            <span className="sw-mono faint">{c.id}</span>
            <CatSelect value={c.category} onChange={(cat) => setD({ ...d, channels: d.channels.map((x, j) => (j === i ? { ...x, category: cat } : x)) })} />
            <button className="sw-btn-quiet" onClick={() => setD({ ...d, channels: d.channels.filter((_, j) => j !== i) })}>
              删除
            </button>
          </div>
        ))}
      </Block>

      <Block title="高级">
        <div className="fields">
          <Field label="无输入多久算离开（秒）· 有声音或视频在播时不算">
            <Num value={s.idleThresholdSec} min={15} max={600} onChange={(v) => set({ idleThresholdSec: v })} />
          </Field>
          <Field label="新的一天从几点开始（凌晨的上网算前一晚）">
            <Num value={s.dayCutoffHour} min={0} max={8} onChange={(v) => set({ dayCutoffHour: v })} />
          </Field>
        </div>
      </Block>

      <Block title="数据" note="明细保留 90 天；每日汇总、作息和意图日志永久保留。卸载扩展即删除全部数据。">
        <div className="row">
          <button className="sw-btn sw-btn-ghost" onClick={() => void exportJson()}>
            导出全部数据（JSON）
          </button>
          <button
            className="sw-btn sw-btn-danger"
            onClick={() => {
              if (confirm('清空全部使用记录？配置保留。此操作不可撤销。') && confirm('再确认一次：清空全部记录？')) void clearAll().then(() => setFlash('记录已清空'));
            }}
          >
            清空使用记录
          </button>
        </div>
      </Block>

      <div className={`savebar${dirty || flash ? ' show' : ''}`}>
        <span>{flash || (invalid ? '有写法不对的项，改好才能保存' : '有未保存的修改')}</span>
        {dirty && (
          <>
            <button className="sw-btn-quiet" onClick={() => setD(structuredClone(saved))}>
              撤销
            </button>
            <button className="sw-btn sw-btn-primary" disabled={invalid} onClick={() => void save()}>
              保存
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2 className="sw-h2">{title}</h2>
        {note && <p className="sw-note">{note}</p>}
      </div>
      <div className="block-body">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({ value, min, max, disabled, onChange }: { value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="sw-input"
      min={min}
      max={max}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
      }}
    />
  );
}

function CatSelect({ value, onChange }: { value: CategoryId; onChange: (c: CategoryId) => void }) {
  return (
    <select className="sw-select cat" value={value} onChange={(e) => onChange(e.target.value as CategoryId)}>
      {CATS.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_META[c].name}
        </option>
      ))}
    </select>
  );
}

function RuleRows({ rules, bad, onSet, onDrop }: { rules: Rule[]; bad: Rule[]; onSet: (id: string, p: Partial<Rule>) => void; onDrop: (id: string) => void }) {
  return (
    <div className="rules">
      {rules.map((r) => (
        <div className="row rule" key={r.id}>
          <input className={`sw-input mono grow${bad.includes(r) ? ' bad' : ''}`} value={r.pattern} placeholder="例如 live.bilibili.com" onChange={(e) => onSet(r.id, { pattern: e.target.value })} />
          <CatSelect value={r.category} onChange={(c) => onSet(r.id, { category: c })} />
          <button className="sw-btn-quiet" onClick={() => onDrop(r.id)}>
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

async function exportJson(): Promise<void> {
  const data = {
    exportedAt: new Date().toISOString(),
    config: await chrome.storage.local.get(null),
    ...(await exportAll()),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `surfwarden-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
