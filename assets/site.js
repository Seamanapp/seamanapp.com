// Seaman App — seamanapp.com. Vanilla, no frameworks, no tracking.
// Mark that JS is running: reveal-hiding only applies when .js is present, so
// if this script ever fails the page still shows all content (never blank).
document.documentElement.classList.add('js');
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Safety net: reveal everything after 2.5s even if the observer misfires.
  setTimeout(() => document.querySelectorAll('.reveal:not(.in)')
    .forEach(el => el.classList.add('in')), 2500);

  // ── scroll progress + sticky header ──
  const bar = document.getElementById('bar');
  const header = document.querySelector('header');
  const onScroll = () => {
    const h = document.documentElement;
    const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    if (bar) bar.style.width = (p * 100) + '%';
    if (header) header.classList.toggle('scrolled', h.scrollTop > 20);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── mobile menu ──
  const menuBtn = document.querySelector('.menu-btn');
  const menu = document.querySelector('.nav nav');
  menuBtn?.addEventListener('click', () => menu.classList.toggle('open'));
  menu?.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => menu.classList.remove('open')));

  // ── reveal on scroll + counters + progress bars ──
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const dur = 1400, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * e).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      en.target.querySelectorAll?.('[data-count]').forEach(animateCount);
      en.target.querySelectorAll?.('.bar i').forEach(i => i.style.width = (i.dataset.w || '70') + '%');
      io.unobserve(en.target);
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal, .stat, .bar').forEach(el => io.observe(el));

  // ── card cursor glow ──
  document.querySelectorAll('.cardx').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  // ── 3D tilt on the hero device ──
  if (!reduce) {
    const stage = document.querySelector('.stage');
    const tilt = document.querySelector('.tilt');
    if (stage && tilt) {
      stage.addEventListener('pointermove', e => {
        const r = stage.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.transform = `rotateY(${x * 16}deg) rotateX(${-y * 16}deg)`;
      });
      stage.addEventListener('pointerleave', () => {
        tilt.style.transform = 'rotateY(0) rotateX(0)';
      });
    }
  }

  // ── starfield / constellation canvas ──
  const cv = document.getElementById('stars');
  if (cv && !reduce) {
    const ctx = cv.getContext('2d');
    let w, h, pts;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const resize = () => {
      w = cv.width = innerWidth * dpr; h = cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
      const n = Math.min(90, Math.floor(innerWidth / 16));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - .5) * .12 * dpr, vy: (Math.random() - .5) * .12 * dpr,
        r: (Math.random() * 1.4 + .4) * dpr,
      }));
    };
    resize(); addEventListener('resize', resize);
    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = 'rgba(180,210,255,.55)'; ctx.fill();
      }
      const max = 130 * dpr;
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < max) {
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(120,170,240,${(1 - d / max) * .18})`;
            ctx.lineWidth = dpr * .6; ctx.stroke();
          }
        }
      requestAnimationFrame(loop);
    };
    loop();
  }

  // ── smooth-scroll for in-page anchors ──
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id.length > 1) {
        const t = document.querySelector(id);
        if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
      }
    });
  });
})();

// ── waitlist: real capture to Supabase (publishable key, insert-only RLS),
//    with a graceful mailto fallback so a lead is never lost ──
(() => {
  const SB_URL = 'https://iegxzjflqqoxxarfomnv.supabase.co';
  const SB_KEY = 'sb_publishable_we44OUTEJHf3kacz0Opi4w_TBWkj0Q2';
  const form = document.getElementById('waitlist');
  if (!form) return;
  const msg = document.getElementById('wlMsg');
  const sc = document.getElementById('scarcity');
  const box = form.closest('.cta-box');
  const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  const setMsg = (t, cls) => { msg.textContent = t; msg.className = 'wl-msg show ' + cls; };

  // Live founding-crew count (aggregate only — no rows/emails exposed).
  // Stays on the static line until there's a meaningful number (avoids "0 aboard").
  fetch(SB_URL + '/rest/v1/rpc/waitlist_count', { method: 'POST', headers: H, body: '{}' })
    .then(r => (r.ok ? r.json() : null))
    .then(n => {
      if (typeof n === 'number' && n >= 12 && sc) {
        const left = Math.max(0, 100 - n);
        sc.innerHTML = '<b>' + n.toLocaleString() + '</b> sailors already aboard · <b>' + left +
          '</b> of the first 100 founding bunks left · your email stays private, no spam.';
      }
    }).catch(() => {});

  // Capture goes to Supabase (insert-only RLS). A Database Webhook on the
  // `waitlist` table then emails admin@seamanapp.com server-side via the
  // `waitlist-notify` Edge Function — first-party, no third-party relay, and the
  // destination address never appears in this page source.
  // Last-ditch fallback if Supabase is unreachable: open the visitor's mail app.
  const mailFallback = (email) => {
    location.href = 'mailto:admin@seamanapp.com?subject=' + encodeURIComponent('Claim my bunk') +
      '&body=' + encodeURIComponent('Please add me to the founding beta: ' + email);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.company && form.company.value) return; // honeypot: silently drop bots
    const email = (form.email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMsg('Please enter a valid email so we can reach you.', 'err'); form.email.focus(); return;
    }
    form.classList.add('busy');
    try {
      const r = await fetch(SB_URL + '/rest/v1/waitlist', {
        method: 'POST', headers: Object.assign({ Prefer: 'return=minimal' }, H),
        body: JSON.stringify({ email, source: 'website' }),
      });
      if (r.ok || r.status === 201 || r.status === 204) {
        box.classList.add('done'); setMsg('You’re on the list — welcome aboard, sailor. Watch your inbox. ⚓', 'ok');
      } else if (r.status === 409) {
        box.classList.add('done'); setMsg('You’re already on the list — we’ve got you. ⚓', 'ok');
      } else {
        throw new Error('http ' + r.status);
      }
    } catch (err) {
      // Never lose a lead: hand off to the visitor's mail client, addressed to admin.
      setMsg('Opening your mail app to finish your request…', 'ok');
      mailFallback(email);
    } finally {
      form.classList.remove('busy');
    }
  });
})();
