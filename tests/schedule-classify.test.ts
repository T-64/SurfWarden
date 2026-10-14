import { describe, expect, it } from 'vitest';
import { hostInList, makeClassifier, siteKey } from '../src/core/classify';
import { formatHHMM, lastOccurrence, nextOccurrence, nextPhaseChange, parseHHMM, phaseAt } from '../src/core/schedule';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const sched = { windDown: 22 * 60 + 30, bedtime: 23 * 60, wake: 7 * 60 + 30 };

describe('schedule', () => {
  it('phaseAt：区间左闭右开、跨午夜', () => {
    expect(phaseAt(at(14, 22, 29), sched)).toBe('day');
    expect(phaseAt(at(14, 22, 30), sched)).toBe('winddown');
    expect(phaseAt(at(14, 23, 0), sched)).toBe('curfew');
    expect(phaseAt(at(15, 2, 0), sched)).toBe('curfew');
    expect(phaseAt(at(15, 7, 29), sched)).toBe('curfew');
    expect(phaseAt(at(15, 7, 30), sched)).toBe('day');
  });

  it('就寝在午夜之后也成立（00:30 就寝）', () => {
    const late = { windDown: 0, bedtime: 30, wake: 8 * 60 };
    expect(phaseAt(at(14, 23, 59), late)).toBe('day');
    expect(phaseAt(at(15, 0, 10), late)).toBe('winddown');
    expect(phaseAt(at(15, 0, 40), late)).toBe('curfew');
  });

  it('windDown = bedtime 表示没有收尾期', () => {
    expect(phaseAt(at(14, 22, 59), { ...sched, windDown: 23 * 60 })).toBe('day');
  });

  it('next/lastOccurrence 与 nextPhaseChange', () => {
    expect(nextOccurrence(at(14, 22, 40), 23 * 60)).toBe(at(14, 23));
    expect(nextOccurrence(at(14, 23, 0), 23 * 60)).toBe(at(15, 23));
    expect(lastOccurrence(at(15, 1, 0), 23 * 60)).toBe(at(14, 23));
    expect(nextPhaseChange(at(14, 14), sched)).toBe(at(14, 22, 30));
    expect(nextPhaseChange(at(14, 23, 5), sched)).toBe(at(15, 7, 30));
  });

  it('HH:MM 解析与格式化', () => {
    expect(parseHHMM('23:00')).toBe(1380);
    expect(parseHHMM('7:30')).toBe(450);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('abc')).toBeNull();
    expect(formatHHMM(450)).toBe('07:30');
  });
});

describe('classify', () => {
  const classify = makeClassifier(
    [
      { id: 'a', pattern: 'bilibili.com', category: 'drift', createdAt: 1 },
      { id: 'b', pattern: 'learngerman.dw.com', category: 'german', createdAt: 2 },
    ],
    [{ platform: 'bilibili', id: '42', name: 'Lisa', category: 'german' }],
  );

  it('频道规则 > 网址规则 > other', () => {
    const url = 'https://www.bilibili.com/video/BV1';
    expect(classify(url)).toEqual({ category: 'drift', source: 'rule' });
    expect(classify(url, { platform: 'bilibili', id: '42', name: 'Lisa' })).toEqual({ category: 'german', source: 'channel' });
    expect(classify(url, { platform: 'youtube', id: '42', name: 'x' })).toEqual({ category: 'drift', source: 'rule' });
    expect(classify('https://example.com/')).toEqual({ category: 'other', source: 'default' });
  });

  it('非 http(s) 不追踪', () => {
    expect(classify('chrome://newtab')).toBeNull();
    expect(classify('chrome-extension://abc/popup.html')).toBeNull();
    expect(classify('about:blank')).toBeNull();
  });
});

describe('siteKey / hostInList', () => {
  it('siteKey 近似 eTLD+1', () => {
    expect(siteKey('live.bilibili.com')).toBe('bilibili.com');
    expect(siteKey('www.bilibili.com')).toBe('bilibili.com');
    expect(siteKey('x.com')).toBe('x.com');
    expect(siteKey('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteKey('127.0.0.1')).toBe('127.0.0.1');
  });

  it('hostInList 含子域、不被后缀伪造', () => {
    expect(hostInList('mail.google.com', ['google.com'])).toBe(true);
    expect(hostInList('notgoogle.com', ['google.com'])).toBe(false);
    expect(hostInList('www.bahn.de', ['www.bahn.de'])).toBe(true);
  });
});
