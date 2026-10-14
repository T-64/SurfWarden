import { useEffect, useState, type ReactNode } from 'react';
import { config } from '../../src/adapters/config';
import { clearAll, exportAll } from '../../src/adapters/db';
import { GATE_WAITS } from '../../src/core/policy';
import { formatHHMM, parseHHMM, phaseAt } from '../../src/core/schedule';
import type { CategoryId, ChannelRule, GermanTarget, Rule, Settings } from '../../src/core/types';
import { parsePattern } from '../../src/core/urlMatch';
import { CATEGORY_META } from '../../src/shared/defaults';
import '../../src/shared/theme.css';
import './options.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'other'];

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

  if (!d || !saved) return <div className="od-app opt" />;

  // 收尾 / 宵禁期间锁定"放松约束"的配置项——否则半夜改个就寝时间就绕过去了
  const locked = phaseAt(Date.now(), saved.settings.schedule) !== 'day';
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const badRules = d.rules.filter((r) => !parsePattern(r.pattern));
  const badTargets = d.targets.filter((t) => !/^https?:\/\//.test(t.url));
  const s = d.settings;
  const set = (patch: Partial<Settings>) => setD({ ...d, settings: { ...s, ...patch } });

  async function save(): Promise<void> {
    if (!d || badRules.length > 0 || badTargets.length > 0) return;
    await Promise.all([config.saveSettings(d.settings), config.saveRules(d.rules), config.saveChannels(d.channels), config.saveTargets(d.targets)]);
    await load();
    setFlash('已保存，立即生效');
    setTimeout(() => setFlash(''), 2500);
  }

  return (
    <div className="od-app opt">
      <header>
        <h1>SurfWarden 设置</h1>
        <p className="od-caption">所有数据只在本机；没有任何网络请求。</p>
      </header>

      {!incognito && (
        <Section title="隐身窗口未授权">
          <p className="warn">隐身窗口里的浏览既不会被统计，也不会被拦——等于给自己留了后门。</p>
          <p className="hint">
            打开扩展详情页 → 打开「允许在隐身模式下运行」。开启后回到这里刷新。
          </p>
          <button className="od-btn od-btn-ghost" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>
            打开扩展详情页
          </button>
        </Section>
      )}

      {locked && <p className="lock">现在是收尾 / 宵禁时段：作息、娱乐额度和宵禁白名单已锁定，白天再改。</p>}

      <Section title="作息" note={`白天 → ${formatHHMM(s.schedule.windDown)} 收尾（娱乐关闭）→ ${formatHHMM(s.schedule.bedtime)} 宵禁 → ${formatHHMM(s.schedule.wake)} 起床`}>
        <div className="fields">
          {(
            [
              ['windDown', '开始收尾'],
              ['bedtime', '上床（宵禁开始）'],
              ['wake', '起床（宵禁结束）'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                type="time"
                className="od-input"
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
      </Section>

      <Section title="德语" note="拦截页和 popup 的「去学德语」会优先打开你上次学德语的页面，没有时用下面第一个入口。">
        <div className="fields">
          <Field label="每日目标（分钟）">
            <NumberInput value={s.germanGoalMin} min={5} max={600} onChange={(v) => set({ germanGoalMin: v })} />
          </Field>
        </div>
        <p className="label">德语入口</p>
        {d.targets.map((t, i) => (
          <div className="line" key={t.id}>
            <input className="od-input narrow" value={t.name} placeholder="名称" onChange={(e) => setD({ ...d, targets: d.targets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input
              className={`od-input${badTargets.includes(t) ? ' bad' : ''}`}
              value={t.url}
              placeholder="https://…"
              onChange={(e) => setD({ ...d, targets: d.targets.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
            <button className="od-btn-mini" onClick={() => setD({ ...d, targets: d.targets.filter((_, j) => j !== i) })}>
              删除
            </button>
          </div>
        ))}
        <button className="od-btn-mini" onClick={() => setD({ ...d, targets: [...d.targets, { id: `t-${Date.now()}`, name: '', url: '' }] })}>
          + 添加入口
        </button>
      </Section>

      <Section title="娱乐" note={`白天进入娱乐站要先写意图、选时长；每次申请前的等待逐次递增（${GATE_WAITS.join(' / ')} 秒，不可改）。`}>
        <div className="fields">
          <Field label="每日总额（分钟）">
            <NumberInput value={s.driftCapMin} min={0} max={600} disabled={locked} onChange={(v) => set({ driftCapMin: v })} />
          </Field>
          <Field label="可选时长（分钟，逗号分隔）">
            <input
              className="od-input"
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
      </Section>

      <Section title="宵禁白名单" note="宵禁期间这些类别和站点仍可打开（会显示「已过就寝 N 分钟」）。娱乐类永远不在白名单里。">
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
            className="od-input"
            rows={8}
            disabled={locked}
            defaultValue={s.curfewAllow.hosts.join('\n')}
            onChange={(e) => set({ curfewAllow: { ...s.curfewAllow, hosts: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) } })}
          />
        </Field>
        <div className="fields">
          <Field label="每晚可延长次数">
            <NumberInput value={s.curfewExtPerNight} min={0} max={3} disabled={locked} onChange={(v) => set({ curfewExtPerNight: v })} />
          </Field>
          <Field label="每次延长（分钟）">
            <NumberInput value={s.curfewExtMin} min={1} max={30} disabled={locked} onChange={(v) => set({ curfewExtMin: v })} />
          </Field>
        </div>
      </Section>

      <Section
        title="网址规则"
        note="语法：域名（含子域）· 域名/路径/*（路径前缀）· *.域名/*· 完整 URL · re:正则。越具体越优先；B 站视频按 UP 主区分请用下面的「频道」。"
      >
        <table className="od-table">
          <thead>
            <tr>
              <th>规则</th>
              <th style={{ width: 120 }}>类别</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {d.rules.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <input
                    className={`od-input mono${badRules.includes(r) ? ' bad' : ''}`}
                    value={r.pattern}
                    onChange={(e) => setD({ ...d, rules: d.rules.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)) })}
                  />
                </td>
                <td>
                  <CatSelect value={r.category} onChange={(c) => setD({ ...d, rules: d.rules.map((x, j) => (j === i ? { ...x, category: c } : x)) })} />
                </td>
                <td>
                  <button className="od-btn-mini" onClick={() => setD({ ...d, rules: d.rules.filter((_, j) => j !== i) })}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="od-btn-mini"
          onClick={() =>
            setD({
              ...d,
              rules: [{ id: `r-${Date.now()}`, pattern: '', category: 'drift', createdAt: d.rules.reduce((m, r) => Math.max(m, r.createdAt), 0) + 1 }, ...d.rules],
            })
          }
        >
          + 添加规则
        </button>
        {badRules.length > 0 && <p className="bad-note">有 {badRules.length} 条规则写法不对（红框），改好才能保存。</p>}
      </Section>

      <Section title="频道（UP 主 / YouTube 频道）" note="在视频页的遮罩或 popup 里一键标记。频道规则优先于网址规则。">
        {d.channels.length === 0 && <p className="hint">还没有标记过频道。</p>}
        <table className="od-table">
          <tbody>
            {d.channels.map((c, i) => (
              <tr key={`${c.platform}:${c.id}`}>
                <td>{c.platform === 'bilibili' ? 'B 站' : 'YouTube'}</td>
                <td>{c.name}</td>
                <td className="mono faint">{c.id}</td>
                <td style={{ width: 120 }}>
                  <CatSelect value={c.category} onChange={(cat) => setD({ ...d, channels: d.channels.map((x, j) => (j === i ? { ...x, category: cat } : x)) })} />
                </td>
                <td style={{ width: 60 }}>
                  <button className="od-btn-mini" onClick={() => setD({ ...d, channels: d.channels.filter((_, j) => j !== i) })}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="高级">
        <div className="fields">
          <Field label="无输入多久算离开（秒）· 有声音或视频在播时不算">
            <NumberInput value={s.idleThresholdSec} min={15} max={600} onChange={(v) => set({ idleThresholdSec: v })} />
          </Field>
          <Field label="新一天从几点开始（凌晨的上网算前一晚）">
            <NumberInput value={s.dayCutoffHour} min={0} max={8} onChange={(v) => set({ dayCutoffHour: v })} />
          </Field>
        </div>
      </Section>

      <Section title="数据">
        <div className="line">
          <button className="od-btn od-btn-ghost" onClick={() => void exportJson()}>
            导出全部数据（JSON）
          </button>
          <button
            className="od-btn od-btn-danger"
            onClick={() => {
              if (confirm('清空全部使用记录？配置保留。此操作不可撤销。') && confirm('再确认一次：清空全部记录？')) void clearAll().then(() => setFlash('记录已清空'));
            }}
          >
            清空使用记录
          </button>
        </div>
        <p className="hint">明细保留 90 天；每日汇总、作息和意图日志永久保留。卸载扩展即删除全部数据。</p>
      </Section>

      <div className={`savebar${dirty || flash ? ' show' : ''}`}>
        <span>{flash || (badRules.length + badTargets.length > 0 ? '有写法不对的项，改好才能保存' : '有未保存的修改')}</span>
        {dirty && (
          <>
            <button className="od-btn od-btn-ghost" onClick={() => setD(structuredClone(saved))}>
              撤销
            </button>
            <button className="od-btn od-btn-primary" disabled={badRules.length + badTargets.length > 0} onClick={() => void save()}>
              保存
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="od-section sec">
      <h2>{title}</h2>
      {note && <p className="hint">{note}</p>}
      {children}
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

function NumberInput({ value, min, max, disabled, onChange }: { value: number; min: number; max: number; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="od-input"
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
    <select className="od-select" value={value} onChange={(e) => onChange(e.target.value as CategoryId)}>
      {CATS.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_META[c].name}
        </option>
      ))}
    </select>
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
