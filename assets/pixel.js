/* Meta pixel for seamanapp.com.
 *
 * WHAT THIS DOES AND DELIBERATELY DOES NOT DO.
 *
 * It reports INTENT only - PageView, ViewContent, InitiateCheckout. It never
 * reports a Purchase. Purchases are sent server-side from the PayMongo webhook,
 * after the money has actually landed, because a browser Purchase can be
 * blocked, lost when the buyer never returns from PayMongo's hosted QR page, or
 * simply fired by anyone who opens the right URL. One source of truth for money,
 * and it is not this file.
 *
 * The one job this file has that the server cannot do: capture `_fbp` and `_fbc`
 * - Meta's own cookies, where `_fbc` names the actual ad click - and hand them
 * to the checkout call so the server-side Purchase can be attributed back to the
 * ad that produced it. Without that, every campaign reports zero sales even
 * when it produced them.
 *
 * The pixel ID is public by nature; it appears in the page source of every site
 * that runs one. Nothing secret lives here.
 */
(function () {
  var PIXEL_ID = '2599864923796884';

  /* ---- Meta base code (their snippet, unmodified in behaviour) ---- */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  /* ---- Reading the identifiers back out ---- */

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : '';
  }

  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || ''; }
    catch (e) { return ''; }
  }

  /* The pixel writes `_fbc` itself when a page is opened with ?fbclid=...,
   * but only once fbevents.js has loaded. A buyer on ship wifi can tap through
   * to checkout before that happens, and then the click is lost. So if the
   * cookie is not there yet we rebuild it from the URL using Meta's documented
   * format: fb.<subdomainIndex>.<creationTime>.<fbclid>  */
  function fbc() {
    var c = cookie('_fbc');
    if (c) return c;
    var id = param('fbclid');
    return id ? 'fb.1.' + Date.now() + '.' + id : '';
  }

  window.smPixel = {
    /** {fbp, fbc} to hand to the checkout call. Either may be empty. */
    ids: function () { return { fbp: cookie('_fbp'), fbc: fbc() }; },

    /** The page the buyer is deciding on, without query or fragment - those
     *  can carry a coupon code or the fbclid itself, which do not belong in an
     *  analytics field. */
    sourceUrl: function () { return location.origin + location.pathname; },

    /** Standard event passthrough, guarded so a blocked pixel cannot throw
     *  inside a click handler and stop the buyer reaching checkout. */
    track: function (name, params) {
      try { if (window.fbq) fbq('track', name, params || {}); } catch (e) {}
    },
  };

  /* ViewContent on the two pages that sell something, so Meta learns which
   * traffic actually reads the offer rather than bouncing off the hero.
   *
   * HOST-AWARE ON PURPOSE. The Port to Port page is served from two roots -
   * seamanapp.com/course/port-to-port/ AND the canonical course.seamanapp.com,
   * where the same file sits at "/". Matching on path alone would silently
   * fire nothing on the host people actually share. */
  var path = location.pathname;
  var host = location.hostname;
  var isPortToPort = host === 'course.seamanapp.com' || /^\/course\/port-to-port\/?$/.test(path);
  var isClub = /^\/club\/?$/.test(path);

  if (isClub) {
    window.smPixel.track('ViewContent', {
      content_name: 'Navigators Club', content_type: 'product',
      content_ids: ['club'], currency: 'PHP', value: 6500,
    });
  } else if (isPortToPort) {
    window.smPixel.track('ViewContent', {
      content_name: 'Port to Port', content_type: 'product',
      content_ids: ['port-to-port'], currency: 'PHP', value: 3250,
    });
  }
})();
