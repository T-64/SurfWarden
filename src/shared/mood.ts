import { useEffect } from 'react';

export type Mood = 'day' | 'night';

/** 让 <body> 的底色跟随「纸与夜」情绪（页面根节点之外的留白也要一致） */
export function useBodyMood(mood: Mood): void {
  useEffect(() => {
    document.body.style.background = mood === 'night' ? '#0d1020' : '#f3f0e8';
    document.documentElement.style.colorScheme = mood === 'night' ? 'dark' : 'light';
  }, [mood]);
}
