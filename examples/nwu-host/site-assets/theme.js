(() => {
  const storageKey = 'nwu911-theme';
  const root = document.documentElement;
  let contrastUpdateFrame = 0;

  function readTheme() {
    try {
      return window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function updateToggle(theme) {
    const isDark = theme === 'dark';
    const actionLabel = isDark ? '启用亮色模式' : '启用暗色模式';
    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
      toggle.setAttribute('aria-pressed', String(isDark));
      toggle.setAttribute('aria-label', actionLabel);
      toggle.setAttribute('title', actionLabel);
      const label = toggle.querySelector('[data-theme-toggle-label]');
      if (label) label.textContent = actionLabel;
    }
  }

  function parseRgb(value) {
    const match = value.match(/^rgba?\((.*)\)$/);
    if (!match) return null;
    const parts = match[1].trim().split(/[\s,/]+/);
    if (parts.length < 3 || parts.length > 4) return null;
    const channels = parts.slice(0, 3).map(part =>
      Math.max(0, Math.min(255, parseFloat(part) * (part.endsWith('%') ? 2.55 : 1))));
    const alpha = parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
    return [...channels, Math.max(0, Math.min(1, alpha))];
  }

  function relativeLuminance([red, green, blue]) {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return channel(red) * 0.2126 + channel(green) * 0.7152 + channel(blue) * 0.0722;
  }

  function contrastRatio(foreground, background) {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  function composite(foreground, background) {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [...foreground.slice(0, 3).map((channel, index) =>
      (channel * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha), alpha];
  }

  function textContrast(element) {
    const color = parseRgb(window.getComputedStyle(element).color);
    if (!color) return null;
    let foreground = color;
    let background = [0, 0, 0, 0];
    // Paint outward through each background and opacity group. A fixed dark
    // canvas gives the wrong answer for authored white/translucent backgrounds.
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (style.backgroundImage !== 'none' || style.mixBlendMode !== 'normal') return null;
      const layer = parseRgb(style.backgroundColor);
      if (!layer) return null;
      foreground = composite(foreground, layer);
      background = composite(background, layer);
      foreground[3] *= Number(style.opacity);
      background[3] *= Number(style.opacity);
    }
    const canvas = [255, 255, 255, 1];
    return { color, ratio: contrastRatio(composite(foreground, canvas), composite(background, canvas)) };
  }

  function fallbackTone([red, green, blue]) {
    const maximum = Math.max(red, green, blue) / 255;
    const minimum = Math.min(red, green, blue) / 255;
    const chroma = maximum - minimum;
    if (chroma < 0.16) return 'neutral';

    let hue;
    if (maximum === red / 255) hue = ((green - blue) / 255 / chroma) % 6;
    else if (maximum === green / 255) hue = (blue - red) / 255 / chroma + 2;
    else hue = (red - green) / 255 / chroma + 4;
    hue = (hue * 60 + 360) % 360;

    if (hue < 20 || hue >= 340) return 'danger';
    if (hue < 58) return 'warning';
    if (hue < 164) return 'success';
    return 'link';
  }

  function updateInlineContentContrast(isDark) {
    const contentRoots = document.querySelectorAll('.tutorial-content, .blog-content, .nwu-reader-content');
    for (const content of contentRoots) {
      for (const element of content.querySelectorAll('[data-theme-color-fallback]')) {
        delete element.dataset.themeColorFallback;
      }
      delete content.dataset.themeColorFallback;
      const reader = content.closest('.nwu-reader-shell');
      const darkContent = reader ? ['dark', 'abyss'].includes(reader.dataset.theme) : isDark;
      if (!darkContent) continue;
      const authoredColor = new Set();
      // Parent corrections also affect inherited colors. Check descendants in
      // DOM order so a child on a different background remains readable.
      for (const element of [content, ...content.querySelectorAll('*')]) {
        if (!element.style?.color && !authoredColor.has(element.parentElement)) continue;
        authoredColor.add(element);
        const original = textContrast(element);
        if (!original || original.ratio >= 4.5) continue;
        for (const tone of [fallbackTone(original.color), 'dark', 'light']) {
          element.dataset.themeColorFallback = tone;
          if ((textContrast(element)?.ratio ?? 0) >= 4.5) break;
          delete element.dataset.themeColorFallback;
        }
      }
    }
  }

  function scheduleInlineContentContrast() {
    if (contrastUpdateFrame) return;
    contrastUpdateFrame = window.requestAnimationFrame(() => {
      contrastUpdateFrame = 0;
      updateInlineContentContrast(root.dataset.theme === 'dark');
    });
  }

  function applyTheme(theme, persist) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = normalizedTheme;
    updateToggle(normalizedTheme);
    updateInlineContentContrast(normalizedTheme === 'dark');
    if (!persist) return;
    try {
      window.localStorage.setItem(storageKey, normalizedTheme);
    } catch {
      // The preference remains available for this page when storage is unavailable.
    }
  }

  function initialize() {
    window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
    applyTheme(root.dataset.theme === 'dark' ? 'dark' : readTheme(), false);
    for (const toggle of document.querySelectorAll('[data-theme-toggle]')) {
      toggle.addEventListener('click', () => {
        applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
      });
    }

    const contentRoot = document.getElementById('app') || document.querySelector('main');
    if (contentRoot && 'MutationObserver' in window) {
      const observer = new MutationObserver(scheduleInlineContentContrast);
      observer.observe(contentRoot, {
        attributes: true,
        attributeFilter: ['style', 'data-theme'],
        childList: true,
        subtree: true,
      });
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) applyTheme(event.newValue === 'dark' ? 'dark' : 'light', false);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
