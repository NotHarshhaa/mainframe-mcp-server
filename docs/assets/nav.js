/**
 * Mobile navigation — dropdown menu, backdrop, keyboard & resize handling.
 */
(function () {
  const toggle = document.getElementById('nav-menu-toggle');
  const menu = document.getElementById('nav-menu');
  const backdrop = document.getElementById('nav-backdrop');
  const header = document.querySelector('.site-header');
  if (!toggle || !menu || !backdrop || !header) return;

  const MQ = window.matchMedia('(max-width: 900px)');

  function isMobile() {
    return MQ.matches;
  }

  function setOpen(open) {
    const mobile = isMobile();
    document.body.classList.toggle('nav-open', open && mobile);
    toggle.setAttribute('aria-expanded', String(open && mobile));
    toggle.setAttribute('aria-label', open && mobile ? 'Close menu' : 'Open menu');

    if (mobile) {
      menu.setAttribute('aria-hidden', String(!open));
      backdrop.hidden = !open;
      backdrop.setAttribute('aria-hidden', String(!open));

      if (open) {
        const top = header.getBoundingClientRect().bottom;
        document.documentElement.style.setProperty('--nav-menu-top', `${top}px`);
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    } else {
      menu.removeAttribute('aria-hidden');
      backdrop.hidden = true;
      document.body.style.overflow = '';
    }
  }

  function closeMenu() {
    setOpen(false);
  }

  function openMenu() {
    if (isMobile()) setOpen(true);
  }

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (document.body.classList.contains('nav-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  backdrop.addEventListener('click', closeMenu);

  menu.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', () => {
      if (isMobile()) closeMenu();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  MQ.addEventListener('change', () => {
    closeMenu();
    if (!isMobile()) {
      menu.removeAttribute('aria-hidden');
    } else {
      menu.setAttribute('aria-hidden', 'true');
    }
  });

  window.addEventListener('resize', () => {
    if (document.body.classList.contains('nav-open') && isMobile()) {
      const top = header.getBoundingClientRect().bottom;
      document.documentElement.style.setProperty('--nav-menu-top', `${top}px`);
    }
    if (!isMobile()) closeMenu();
  });

  if (isMobile()) {
    menu.setAttribute('aria-hidden', 'true');
  }
})();
