'use client';

import { useEffect, useRef } from 'react';

type SitebotApi = {
  mount: (options: {
    siteId: string;
    apiUrl: string;
    color?: string;
    greeting?: string;
    title?: string;
    container?: HTMLElement | null;
  }) => HTMLElement | null;
  unmount: (siteId: string) => void;
};

declare global {
  interface Window {
    sitebot?: SitebotApi;
  }
}

const SCRIPT_MARKER = 'script[data-sitebot-embed]';

export function WidgetEmbed({
  siteId,
  apiUrl,
  color,
  greeting,
  title,
}: {
  siteId: string;
  apiUrl: string;
  color?: string;
  greeting?: string;
  title?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    const mount = () => {
      if (cancelled || !container || !window.sitebot) return;
      window.sitebot.mount({
        siteId,
        apiUrl,
        color,
        greeting,
        title,
        container,
      });
    };

    if (window.sitebot) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(SCRIPT_MARKER);
      if (existing) {
        existing.addEventListener('load', mount);
      } else {
        const script = document.createElement('script');
        script.src = `${apiUrl}/widget.js`;
        script.async = true;
        script.setAttribute('data-auto', 'false');
        script.setAttribute('data-sitebot-embed', 'true');
        script.addEventListener('load', mount);
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      window.sitebot?.unmount(siteId);
    };
  }, [siteId, apiUrl, color, greeting, title]);

  return <div id={`sitebot-embed-${siteId}`} ref={containerRef} />;
}
