'use client';

import React, { useEffect, useRef, useState } from 'react';

type RevealProps = {
  children: React.ReactNode;
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'article';
  variant?: 'up' | 'fade' | 'scale' | 'left' | 'right';
  className?: string;
  style?: React.CSSProperties;
};

/** Fades its children up the first time they scroll into view. */
export function Reveal({ children, delay = 0, as = 'div', variant = 'up', className = '', style, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Tag = as as React.ElementType;
  return (
    <Tag
      {...rest}
      ref={ref}
      className={`reveal${variant !== 'up' ? ` v-${variant}` : ''}${visible ? ' in' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, ['--reveal-delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
