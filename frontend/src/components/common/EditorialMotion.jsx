import { useEffect, useId, useRef } from 'react';
import { animate } from 'framer-motion/dom/mini';

// Content stays visible in prerendered HTML and when motion APIs are unavailable.
// Only public-page decoration uses this component; analysis controls stay steady.
export default function EditorialMotion({ as: Tag = 'div', className = '', children }) {
  const rootRef = useRef(null);
  const cursorRef = useRef(null);
  const gradientId = useId();

  useEffect(() => {
    const root = rootRef.current;
    const cursor = cursorRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const revealed = new WeakSet();
    let dispose = () => {};

    const configure = () => {
      dispose();
      if (reducedMotion.matches) {
        root.dataset.motion = 'reduced';
        dispose = () => {};
        return;
      }

      const animations = new Map();
      const originalStyles = new Map();
      const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!isIntersecting) continue;
          observer.unobserve(target);
          if (revealed.has(target)) continue;
          revealed.add(target);
          if (!target.animate || target.contains(document.activeElement) || target.matches(':target') || target.querySelector(':target')) continue;
          const transform = getComputedStyle(target).transform;
          const resting = transform === 'none' ? '' : transform;
          // Fade sections containing controls without moving their hit targets.
          // Completing a translated reveal on pointer focus can otherwise move
          // a link between mouse-down and mouse-up and swallow the click.
          const hasControls = target.matches('a[href], button, input, select, textarea') || target.querySelector('a[href], button, input, select, textarea');
          originalStyles.set(target, { opacity: target.style.opacity, transform: target.style.transform });
          const animation = animate(target, {
            opacity: [0.2, 1],
            transform: [hasControls ? resting || 'none' : `translate3d(0, 44px, 0) ${resting}`, resting || 'none']
          }, {
            duration: 0.9,
            delay: Math.min(240, Math.max(0, Number(target.dataset.revealDelay) || 0)) / 1000,
            ease: [0.22, 1, 0.36, 1]
          });
          animations.set(target, animation);
          const release = () => animations.delete(target);
          Promise.resolve(animation).then(release, release);
        }
      }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' }) : null;
      [...root.querySelectorAll('[data-reveal], .reading-content > section'), document.querySelector('.site-footer')].filter(Boolean).forEach((target) => {
        if (!revealed.has(target)) observer?.observe(target);
      });

      // Keyboard focus always receives the element in its resting position.
      const onFocus = (event) => {
        for (const [target, animation] of animations) {
          if (target.contains(event.target)) animation.complete();
        }
      };
      document.addEventListener('focusin', onFocus);

      let frame = 0;
      let destination = null;
      const paint = () => {
        cursor.style.transform = `translate3d(${destination.x - 80}px, ${destination.y - 80}px, 0)`;
        frame = 0;
      };
      const hide = () => {
        cursor.removeAttribute('data-active');
        cancelAnimationFrame(frame);
        frame = 0;
        destination = null;
      };
      const onPointer = (event) => {
        if (reducedMotion.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
        destination = { x: event.clientX, y: event.clientY };
        cursor.dataset.active = 'true';
        if (!frame) frame = requestAnimationFrame(paint);
      };
      const onKey = (event) => { if (event.key === 'Tab') hide(); };
      const onVisibility = () => { if (document.hidden) hide(); };
      window.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('pointerleave', hide);
      window.addEventListener('blur', hide);
      document.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      root.dataset.motion = 'enabled';

      dispose = () => {
        observer?.disconnect();
        for (const animation of animations.values()) animation.cancel();
        animations.clear();
        for (const [target, styles] of originalStyles) {
          target.style.opacity = styles.opacity;
          target.style.transform = styles.transform;
        }
        document.removeEventListener('focusin', onFocus);
        window.removeEventListener('pointermove', onPointer);
        document.removeEventListener('pointerleave', hide);
        window.removeEventListener('blur', hide);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
        hide();
      };
    };

    configure();
    reducedMotion.addEventListener('change', configure);
    finePointer.addEventListener('change', configure);
    return () => {
      reducedMotion.removeEventListener('change', configure);
      finePointer.removeEventListener('change', configure);
      dispose();
      root.removeAttribute('data-motion');
    };
  }, []);

  return <Tag ref={rootRef} className={`editorial-motion ${className}`}>
    <div className="motion-ambient" aria-hidden="true">
      <svg ref={cursorRef} className="motion-cursor" viewBox="0 0 160 160" focusable="false">
        <defs><radialGradient id={gradientId}><stop stopColor="#526e52" stopOpacity=".24" /><stop offset=".45" stopColor="#91a57d" stopOpacity=".12" /><stop offset="1" stopColor="#91a57d" stopOpacity="0" /></radialGradient></defs>
        <circle cx="80" cy="80" r="80" fill={`url(#${gradientId})`} />
      </svg>
    </div>
    {children}
  </Tag>;
}
