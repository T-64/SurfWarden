import { useCallback, useEffect, useState } from 'react';
import { configStore } from '../../src/adapters/configStore';
import { db } from '../../src/adapters/db';
import type { Category, Rule, Settings, StudyTarget } from '../../src/core/types';
import { TEMPLATE_PACKS } from '../../src/shared/defaults';

/** Options 管理页：规则/类别/学习目标/设置 CRUD + 模板导入 + 隐身引导 + 数据管理 */
export function OptionsApp() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [targets, setTargets] = useState<StudyTarget[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [incognito, setIncognito] = useState<boolean | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  const reload = useCallback(() => {
    void (async () => {
      const [rules, cats, targets, settings] = await Promise.all([
        configStore.getRules(),
        configStore.getCategories(),
        configStore.getStudyTargets(),
        configStore.getSettings(),
      ]);
      setRules(rules);
      setCats(cats);
      setTargets(targets);
      setSettings(settings);
    })();
  }, []);

  useEffect(() => {
    reload();
    chrome.extension.isAllowedIncognitoAccess((allowed) => setIncognito(allowed));
  }, [reload]);

  function flash(): void {
    setSavedAt(Date.now());
    window.setTimeout(() => setSavedAt(0), 2_000);
  }

  async function saveRules(next: Rule[]): Promise<void> {
    await configStore.saveRules(next);
    setRules(next);
    flash();
  }
  async function saveCats(next: Category[]): Promise<void> {
    await configStore.saveCategories(next);
    setCats(next);
    flash();
  }
  async function saveTargets(next: StudyTarget[]): Promise<void> {
    await configStore.saveStudyTargets(next);
    setTargets(next);
    flash();
  }
  async function saveSettings(next: Settings): Promise<void> {
    await configStore.saveSettings(next);
    setSettings(next);
    flash();
  }

  async function importPack(packId: string): Promise<void> {
    const pack = TEMPLATE_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const existing = new Set(rules.map((r) => r.pattern));
    let createdAt = rules.reduce((m, r) => Math.max(m, r.createdAt), 0);
    const additions: Rule[] = pack.items
      .filter((it) => !existing.has(it.pattern))
      .map((it, i) => ({
        id: `tpl-${pack.id}-${i}-${Date.now()}`,
        name: it.name,
        pattern: it.pattern,
        category: it.category,
        enabled: true,
        createdAt: ++createdAt,
      }));
    await saveRules([...rules, ...additions]);
  }

  async function exportAll(): Promise<void> {
    const config = await chrome.storage.local.get(null);
    const [sessions, usageDaily, exempts] = await Promise.all([
      db.sessions.toArray(),
      db.usageDaily.toArray(),
      db.exempts.toArray(),
    ]);
    const blob = new Blob(
      [JSON.stringify({ app: 'SurfWarden', exportedAt: new Date().toISOString(), config, data: { sessions, usageDaily, exempts } }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `surfwarden-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function clearAll(): Promise<void> {
    if (!window.confirm('清空全部规则与使用数据？此操作不可恢复。')) return;
    if (!window.confirm('再次确认：真的要清空吗？')) return;
    await chrome.storage.local.clear();
    await db.delete();
    await configStore.ensureDefaults();
    reload();
  }

  return (
    <div className="wrap">
      <h1>SurfWarden 设置</h1>
      <p className="muted">所有数据仅存本机，无任何网络请求。保存后立即生效（后台热更新）。</p>
      {savedAt > 0 && <p className="ok">✓ 已保存</p>}

      <section>
        <h2>🔒 隐身窗口覆盖</h2>
        {incognito === null ? (
          <p className="muted">检测中…</p>
        ) : incognito ? (
          <p className="ok">✓ 已允许隐身模式——隐身窗口的浏览也在统计与预算内（PRODUCT.md §3.7）。</p>
        ) : (
          <div>
            <p className="warn">⚠ 尚未开启：隐身窗口的浏览不会被统计，等于监督有后门。</p>
            <p className="muted">
              三步开启（约 10 秒）：① 在地址栏打开 <code>chrome://extensions</code>（Edge 为{' '}
              <code>edge://extensions</code>）② 找到 SurfWarden → 详情 ③ 打开「允许隐身模式」。开启后本页状态自动刷新。
            </p>
            <button className="btn" onClick={() => chrome.tabs.create({ url: 'chrome://extensions' })}>
              打开扩展管理页
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>📦 模板包一键导入</h2>
        <p className="muted">按 pattern 去重后追加，不会覆盖你已调整的规则。</p>
        <div className="row">
          {TEMPLATE_PACKS.map((p) => (
            <button key={p.id} className="btn" onClick={() => void importPack(p.id)}>
              导入「{p.name}」（{p.items.length} 条）
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>📏 规则（更具体的规则永远赢）</h2>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th style={{ width: '38%' }}>Pattern</th>
              <th style={{ width: '16%' }}>类别</th>
              <th style={{ width: '8%' }}>启用</th>
              <th style={{ width: '10%' }}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="text"
                    value={r.name}
                    onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={r.pattern}
                    onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, pattern: e.target.value } : x)))}
                  />
                </td>
                <td>
                  <select
                    value={r.category}
                    onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, category: e.target.value } : x)))}
                  >
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                  />
                </td>
                <td>
                  <button className="btn btn-danger" onClick={() => void saveRules(rules.filter((x) => x.id !== r.id))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={() =>
              void saveRules([
                ...rules,
                {
                  id: `r-${Date.now()}`,
                  name: '新规则',
                  pattern: 'example.com/path/*',
                  category: 'entertainment',
                  enabled: true,
                  createdAt: rules.reduce((m, r) => Math.max(m, r.createdAt), 0) + 1,
                },
              ])
            }
          >
            ＋ 添加规则
          </button>
          <button className="btn btn-primary" onClick={() => void saveRules(rules)}>
            保存规则
          </button>
          <span className="muted">语法：域名 / 域名+路径通配 / 完整 URL / re:正则</span>
        </div>
      </section>

      <section>
        <h2>🎨 类别与预算</h2>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th style={{ width: '14%' }}>颜色</th>
              <th style={{ width: '22%' }}>监督档位</th>
              <th style={{ width: '16%' }}>预算（分/天）</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <input
                    type="text"
                    value={c.color}
                    onChange={(e) => setCats(cats.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)))}
                  />
                </td>
                <td>
                  <select
                    value={c.action}
                    onChange={(e) =>
                      setCats(cats.map((x) => (x.id === c.id ? { ...x, action: e.target.value as Category['action'] } : x)))
                    }
                  >
                    <option value="track">只统计</option>
                    <option value="nudge">提醒（nudge）</option>
                    <option value="budget">预算封锁</option>
                    <option value="hard">完全封锁</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    placeholder="不限"
                    value={c.budgetMin ?? ''}
                    onChange={(e) =>
                      setCats(
                        cats.map((x) =>
                          x.id === c.id
                            ? { ...x, budgetMin: e.target.value === '' ? undefined : Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void saveCats(cats)}>
            保存类别
          </button>
          <span className="muted">档位：只统计 → 提醒 → 预算封锁 → 完全封锁（PRODUCT.md §3.4）</span>
        </div>
      </section>

      <section>
        <h2>📗 学习目标（引导页"去学习"的入口）</h2>
        <table>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td style={{ width: '30%' }}>
                  <input
                    type="text"
                    value={t.name}
                    onChange={(e) => setTargets(targets.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                  />
                </td>
                <td>
                  <input
                    type="url"
                    value={t.url}
                    onChange={(e) => setTargets(targets.map((x) => (x.id === t.id ? { ...x, url: e.target.value } : x)))}
                  />
                </td>
                <td style={{ width: '10%' }}>
                  <button className="btn btn-danger" onClick={() => void saveTargets(targets.filter((x) => x.id !== t.id))}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={() =>
              void saveTargets([...targets, { id: `t-${Date.now()}`, name: '德语课 A2', url: 'https://…' }])
            }
          >
            ＋ 添加学习目标
          </button>
          <button className="btn btn-primary" onClick={() => void saveTargets(targets)}>
            保存学习目标
          </button>
        </div>
      </section>

      <section>
        <h2>⚙️ 行为参数</h2>
        {settings && (
          <div className="grid">
            <label className="field">
              一天结束时刻（点）
              <input
                type="number"
                min={0}
                max={23}
                value={settings.dayCutoffHour}
                onChange={(e) => setSettings({ ...settings, dayCutoffHour: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              idle 判定阈值（秒）
              <input
                type="number"
                min={15}
                max={300}
                value={settings.idleThresholdSec}
                onChange={(e) => setSettings({ ...settings, idleThresholdSec: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              心跳宽限（秒）
              <input
                type="number"
                min={30}
                max={600}
                value={settings.idleGraceSec}
                onChange={(e) => setSettings({ ...settings, idleGraceSec: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              豁免次数 / 天
              <input
                type="number"
                min={0}
                max={20}
                value={settings.exemptPerDay}
                onChange={(e) => setSettings({ ...settings, exemptPerDay: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              单次豁免（分钟）
              <input
                type="number"
                min={1}
                max={60}
                value={settings.exemptMinutes}
                onChange={(e) => setSettings({ ...settings, exemptMinutes: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" disabled={!settings} onClick={() => settings && void saveSettings(settings)}>
            保存参数
          </button>
        </div>
      </section>

      <section>
        <h2>💾 数据</h2>
        <div className="row">
          <button className="btn" onClick={() => void exportAll()}>
            导出全部数据（JSON）
          </button>
          <button className="btn btn-danger" onClick={() => void clearAll()}>
            清空全部数据与配置
          </button>
        </div>
        <p className="muted">
          明细保留 90 天（每日切时自动清理），日聚合与豁免记录永久保留。所有数据只在本机：IndexedDB + chrome.storage。
        </p>
      </section>
    </div>
  );
}
