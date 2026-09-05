import { useEffect, useState } from 'react';
import { canExempt } from '../../src/core/budget';
import { configStore } from '../../src/adapters/configStore';
import { exemptCountForDate, todayKey, usageForDate } from '../../src/adapters/db';
import type { Category, StudyTarget, UsageRow } from '../../src/core/types';
import { formatDuration } from '../../src/shared/format';

/**
 * 引导页（PRODUCT.md §3.5）：不是死胡同，是岔路口。
 * 主按钮永远是"去学习"（默认选项效应），豁免放次要位置且如实计数。
 */
export function GuideApp() {
  const [info, setInfo] = useState<{
    cat?: Category;
    usedSec: number;
    exemptLeft: number;
    targets: StudyTarget[];
    budgetMin?: number;
    backUrl: string;
  } | null>(null);
  const [exemptError, setExemptError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(location.search);
      const catId = params.get('cat') ?? '';
      const backUrl = params.get('url') ?? '';
      const settings = await configStore.getSettings();
      const [cats, targets, rows, exemptUsed] = await Promise.all([
        configStore.getCategories(),
        configStore.getStudyTargets(),
        usageForDate(todayKey(settings.dayCutoffHour)),
        exemptCountForDate(todayKey(settings.dayCutoffHour)),
      ]);
      const usedRows: UsageRow[] = rows;
      const usedSec = usedRows
        .filter((r) => r.categoryId === catId)
        .reduce((s, r) => s + r.seconds, 0);
      setInfo({
        cat: cats.find((c) => c.id === catId),
        usedSec,
        exemptLeft: Math.max(0, settings.exemptPerDay - exemptUsed),
        targets,
        budgetMin: cats.find((c) => c.id === catId)?.budgetMin,
        backUrl,
      });
    })();
  }, []);

  if (!info) return <div className="card">加载中…</div>;
  const catName = info.cat?.name ?? '该类别';
  const catColor = info.cat?.color ?? '#6b7280';
  const budgetSec = info.budgetMin !== undefined ? info.budgetMin * 60 : undefined;
  const ratio = budgetSec ? Math.min(1, info.usedSec / budgetSec) : 1;

  async function doExempt(): Promise<void> {
    if (!info) return;
    setBusy(true);
    setExemptError(null);
    const res = await chrome.runtime.sendMessage({ type: 'sw-exempt', categoryId: info.cat?.id });
    setBusy(false);
    if (res?.ok) {
      location.href = info.backUrl || 'about:blank';
    } else {
      setExemptError(res?.reason === 'exempt-exhausted' ? '今天的豁免次数已用完' : '操作失败，请重试');
    }
  }

  return (
    <div className="card">
      <span className="tag" style={{ background: catColor }}>
        {catName}
      </span>
      <h1>今天的「{catName}」时间用完了</h1>
      <div className="sub">
        {budgetSec !== undefined
          ? `已用 ${formatDuration(info.usedSec)} / 预算 ${formatDuration(budgetSec)}`
          : `已用 ${formatDuration(info.usedSec)}`}
      </div>
      <div className="meter">
        <i style={{ width: `${Math.round(ratio * 100)}%`, background: catColor }} />
      </div>
      <div className="stat">这一周你都在往哪走，值得看一眼 —— 不如现在就回正事上。</div>

      <div className="targets">
        {info.targets.length === 0 ? (
          <div className="empty">
            还没配置学习目标。去插件 Options 页添加一个（比如你的德语课链接），这里就会出现一键直达。
          </div>
        ) : (
          info.targets.map((t) => (
            <a key={t.id} className="btn btn-primary" href={t.url}>
              📗 去学习：{t.name}
            </a>
          ))
        )}
      </div>

      <div className="row">
        <button className="btn-mini" disabled={busy || info.exemptLeft <= 0} onClick={() => void doExempt()}>
          再来 {info.exemptLeft > 0 ? '5 分钟' : ''}
          {info.exemptLeft > 0 ? `（剩 ${info.exemptLeft} 次）` : '（今日豁免已用完）'}
        </button>
        <button className="btn-mini" onClick={() => window.close()}>
          关掉这个页
        </button>
      </div>
      {exemptError && <div className="hint">{exemptError}</div>}
      <div className="hint">
        豁免是有限资源：今天用了几次，报告里都会如实记着。本页由 SurfWarden 生成，数据仅存本机。
      </div>
    </div>
  );
}
