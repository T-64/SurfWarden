import { useEffect, useState } from 'react';
import { canExempt, exemptAllowedDuringFocus } from '../../src/core/budget';
import { configStore } from '../../src/adapters/configStore';
import { exemptCountForDate, todayKey, usageForDate } from '../../src/adapters/db';
import type { Category, StudyTarget, UsageRow } from '../../src/core/types';
import { formatClock, formatDuration } from '../../src/shared/format';
import '../../src/shared/theme.css';

/**
 * 引导页 = 检查点（PRODUCT.md §3.5）：不是死胡同，是岔路口。
 * OpsDeck：点阵雷达背景 + 等宽仪表读数 + 信号绿主路（默认选项效应）。
 */
export function GuideApp() {
  const [info, setInfo] = useState<{
    cat?: Category;
    usedSec: number;
    exemptLeft: number;
    targets: StudyTarget[];
    budgetMin?: number;
    backUrl: string;
    focusRemainMin: number | null;
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
        focusRemainMin:
          settings.focusUntil !== undefined && Date.now() < settings.focusUntil
            ? Math.ceil((settings.focusUntil - Date.now()) / 60_000)
            : null,
      });
    })();
  }, []);

  if (!info) {
    return (
      <div className="od-app" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p className="od-caption">CHECKPOINT…</p>
      </div>
    );
  }
  const catName = info.cat?.name ?? '该类别';
  const catColor = info.cat?.color ?? 'var(--mute)';
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
    <div
      className="od-app od-dots"
      data-accent="signal"
      style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}
    >
      <div className="od-card" style={{ width: 560, maxWidth: '100%', padding: 28, background: 'var(--surface)' }}>
        {/* 顶部：类别键帽 + 检查点标签 / 专注状态 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="od-key">
            <span className="k-dot" style={{ background: catColor }} />
            {catName}
          </span>
          {info.focusRemainMin !== null ? (
            <span className="od-pill" style={{ color: 'var(--green)', borderColor: 'rgba(61,220,132,0.35)' }}>
              🎯 专注中 · 剩 {info.focusRemainMin} 分
            </span>
          ) : (
            <span className="od-caption">CHECKPOINT</span>
          )}
        </div>

        {/* 仪表读数 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 18 }}>
          <span className="od-stat" style={{ fontSize: 40, fontWeight: 600 }}>{formatClock(info.usedSec)}</span>
          {budgetSec !== undefined && (
            <span className="od-stat" style={{ fontSize: 16, color: 'var(--faint)' }}>/ {formatClock(budgetSec)}</span>
          )}
        </div>
        <div className="od-meter" style={{ marginTop: 10, height: 8 }}>
          <i style={{ width: `${Math.round(ratio * 100)}%`, background: catColor }} />
        </div>
        <p className="od-caption" style={{ margin: '8px 0 0', letterSpacing: 0 }}>
          今天的「{catName}」额度已用完
        </p>

        {/* 主路：学习目标（默认选项效应——信号绿） */}
        <div style={{ marginTop: 22 }}>
          <p className="od-caption" style={{ margin: '0 0 8px' }}>正路</p>
          <div className="od-stack">
            {info.targets.length === 0 ? (
              <div className="od-card-raised" style={{ padding: '12px 14px', fontSize: 12, color: 'var(--mute)' }}>
                还没配置学习目标。去 Options 页添加（比如你的德语课链接），这里就会出现一键直达。
              </div>
            ) : (
              info.targets.map((t) => (
                <a key={t.id} className="od-btn od-btn-signal" href={t.url} style={{ justifyContent: 'space-between' }}>
                  <span>📗 去学习：{t.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, opacity: 0.7 }}>GO →</span>
                </a>
              ))
            )}
          </div>
        </div>

        {/* 侧路：豁免 / 关闭（次要位置，如实计数；专注期不提供豁免） */}
        <div style={{ marginTop: 18 }}>
          <p className="od-caption" style={{ margin: '0 0 8px' }}>侧路</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {info.focusRemainMin === null && (
              <button className="od-btn od-btn-ghost" disabled={busy || info.exemptLeft <= 0} onClick={() => void doExempt()}>
                ⏱ 再来 5 分钟{info.exemptLeft > 0 ? ` · 剩 ${info.exemptLeft} 次` : '（今日已用完）'}
              </button>
            )}
            <button className="od-btn od-btn-ghost" onClick={() => window.close()}>
              ✕ 关掉这个页
            </button>
          </div>
          {exemptError && <p style={{ color: 'var(--red)', fontSize: 12, marginBottom: 0 }}>{exemptError}</p>}
        </div>

        {/* 底注 */}
        <div
          style={{
            marginTop: 22, paddingTop: 12, borderTop: '1px solid var(--line-soft)',
            display: 'flex', justifyContent: 'space-between', gap: 12,
          }}
        >
          <span className="od-caption" style={{ textTransform: 'none', letterSpacing: 0 }}>
            豁免是有限资源，用几次都会如实记录
          </span>
          <span className="od-caption" style={{ flex: 'none' }}>LOCAL ONLY</span>
        </div>
      </div>
    </div>
  );
}
