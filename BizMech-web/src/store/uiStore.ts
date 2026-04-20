/**
 * uiStore — user-facing UI preferences that persist across sessions.
 *
 * Currently tracks the global font-size scale so users who want bigger
 * labels can bump everything up. The scale is applied by setting a
 * `data-font-scale` attribute on the <html> element and reading it from
 * index.css via CSS variables.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontScale = 'sm' | 'md' | 'lg' | 'xl';

interface UIState {
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
}

const FONT_SCALE_REM: Record<FontScale, string> = {
  sm: '14px',
  md: '16px',
  lg: '17px',
  xl: '18px',
};

export function applyFontScale(scale: FontScale) {
  const root = document.documentElement;
  root.style.setProperty('--app-font-size', FONT_SCALE_REM[scale]);
  root.setAttribute('data-font-scale', scale);
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      fontScale: 'md',
      setFontScale: (fontScale) => {
        applyFontScale(fontScale);
        set({ fontScale });
      },
    }),
    {
      name: 'bizmech.ui',
      onRehydrateStorage: () => (state) => {
        if (state?.fontScale) applyFontScale(state.fontScale);
      },
    },
  ),
);
