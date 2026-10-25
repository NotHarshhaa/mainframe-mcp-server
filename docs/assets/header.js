/**
 * Header behaviors — scroll-progress hairline, scrolled state, and scroll-spy
 * highlighting for the section currently in view. Complements nav.js (mobile
 * menu) and theme.js (dark/light) without touching either.
 */
(function () {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const progress = header.querySelector('.scroll-progress span');
  const links = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));

  // --- Scroll progress + solid-on-scroll --------------------------------
  let ticking = false;
  function update() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) {
      const pct = max > 0 ? Math.min(100, (scrollTop / max) * 100) : 0;
      progress.style.width = pct + '%';
    }
    header.classList.toggle('scrolled', scrollTop > 8);
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();

  // --- Scroll spy ---------------------------------------------------------
  const linkById = new Map();
  links.forEach((link) => {
    linkById.set((link.getAttribute('href') || '').slice(1), link);
  });
  const sections = Array.from(document.querySelectorAll('main section[id]')).filter(
    (section) => linkById.has(section.id),
  );

  if ('IntersectionObserver' in window && sections.length > 0) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove('active'));
          const link = linkById.get(entry.target.id);
          if (link) link.classList.add('active');
        });
      },
      // Fire when a section crosses the upper-middle band of the viewport.
      { rootMargin: '-35% 0px -60% 0px', threshold: 0 },
    );
    sections.forEach((section) => spy.observe(section));
  }
})();
