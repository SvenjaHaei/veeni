(function () {
  "use strict";

  var config = window.VEENI_CONFIG;
  var BAG_KEY = "veeni-bag";
  var LANG_KEY = "veeni-lang";

  // Storage can be blocked (private mode, strict settings); the site still works without it.
  function read(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  /* Language */

  function detectLang() {
    var fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "en" || fromUrl === "cs") {
      write(LANG_KEY, fromUrl);
      return fromUrl;
    }
    var saved = read(LANG_KEY, null);
    if (saved === "en" || saved === "cs") {
      return saved;
    }
    return /^cs|^sk/i.test(navigator.language || "") ? "cs" : "en";
  }

  /* Test mode: ?test=1 marks orders as tests until the tab is closed (or ?test=0). */

  function detectTestMode() {
    var fromUrl = new URLSearchParams(location.search).get("test");
    try {
      if (fromUrl === "1") {
        sessionStorage.setItem("veeni-test", "1");
      } else if (fromUrl === "0") {
        sessionStorage.removeItem("veeni-test");
      }
      return sessionStorage.getItem("veeni-test") === "1";
    } catch (e) {
      return fromUrl === "1";
    }
  }

  var testMode = detectTestMode();

  var lang = detectLang();
  document.documentElement.lang = lang;

  function t(key, vars) {
    var text = (window.VEENI_TEXT[lang] && window.VEENI_TEXT[lang][key]) || window.VEENI_TEXT.en[key] || key;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return name in vars ? vars[name] : match;
      });
    }
    return text;
  }

  function local(value) {
    if (value && typeof value === "object") {
      return value[lang] || value.en || "";
    }
    return value || "";
  }

  function price(amount) {
    var number = new Intl.NumberFormat(lang === "cs" ? "cs-CZ" : "en-GB").format(amount);
    return lang === "cs" ? number + " Kč" : number + " CZK";
  }

  function applyText(root) {
    (root || document).querySelectorAll("[data-t]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-t"));
    });
    // Headlines marked data-split put each sentence in its own span, so phones can break between them.
    (root || document).querySelectorAll("[data-split]").forEach(function (el) {
      el.innerHTML = el.textContent
        .split(/(?<=\.)\s+/)
        .map(function (part) { return '<span class="sentence">' + escapeHtml(part) + "</span>"; })
        .join(" ");
    });
    // Long texts (legal pages) are written out per language in the HTML.
    (root || document).querySelectorAll("[data-lang]").forEach(function (el) {
      el.hidden = el.getAttribute("data-lang") !== lang;
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Data */

  var cache = {};

  // Data is kept for the visit (sessionStorage), so pages can draw straight away, e.g. when going back.
  // A fresh copy is always fetched too; if it differs, "veeni:data" tells the page to redraw.
  function loadJson(path) {
    if (cache[path]) {
      return cache[path];
    }
    var key = "veeni-data:" + path;
    var kept = null;
    try {
      kept = sessionStorage.getItem(key);
    } catch (e) {}

    var fresh = fetch(path, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) {
          throw new Error("Could not load " + path);
        }
        return r.text();
      })
      .then(function (text) {
        try {
          sessionStorage.setItem(key, text);
        } catch (e) {}
        var data = JSON.parse(text);
        if (kept !== null && text !== kept) {
          cache[path] = Promise.resolve(data);
          document.dispatchEvent(new CustomEvent("veeni:data", { detail: path }));
        }
        return data;
      });

    if (kept !== null) {
      try {
        cache[path] = Promise.resolve(JSON.parse(kept));
        fresh.catch(function () {});
        return cache[path];
      } catch (e) {}
    }
    cache[path] = fresh;
    return fresh;
  }

  /* Order sheet
     Make adds one row per order to a Google Sheet. Its "stock" column lists what the order took,
     e.g. "SET-LIFE-01*1;WS-evt-wreaths*2". Sets listed there count as sold and workshop places as taken,
     so nothing is sold twice. Deleting a row (an order that was never paid) frees them again.
     Rows marked as tests only count while the site is in test mode. */

  var ORDERS_KEY = "veeni-orders";
  var ordersCache = null;

  // A small CSV reader: quoted fields, doubled quotes inside them, commas and line breaks.
  function parseCsv(text) {
    var rows = [], row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; }
        else { field += c; }
      } else if (c === '"') { quoted = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") { i++; }
        row.push(field); rows.push(row); row = []; field = "";
      } else { field += c; }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // { "SET-LIFE-01": 1, "WS-evt-wreaths": 2, ... }
  function takenFromCsv(text) {
    var rows = parseCsv(text);
    var head = (rows[0] || []).map(function (h) { return h.trim().toLowerCase(); });
    var stockCol = head.indexOf("stock");
    var testCol = head.indexOf("test");
    var taken = {};
    rows.slice(1).forEach(function (row) {
      if (testCol >= 0 && !testMode && /^(true|1|yes|ano|pravda)$/i.test((row[testCol] || "").trim())) {
        return;
      }
      (stockCol >= 0 ? [row[stockCol]] : row).forEach(function (cell) {
        var text = String(cell || "");
        // The order column as Make writes it: one {"sku":"…", …, "qty":n} per item.
        var items = text.match(/\{[^{}]*"sku"[^{}]*\}/g) || [];
        items.forEach(function (item) {
          var sku = /"sku"\s*:\s*"([^"]+)"/.exec(item);
          var qty = /"qty"\s*:\s*(\d+)/.exec(item);
          if (sku) {
            taken[sku[1]] = (taken[sku[1]] || 0) + (qty ? Number(qty[1]) : 1);
          }
        });
        if (items.length) {
          return;
        }
        // Or a short list like "SET-LIFE-01*1;WS-evt-wreaths*2".
        text.split(/[;\s]+/).forEach(function (token) {
          var match = /^(.+)\*(\d+)$/.exec(token.trim());
          if (match) {
            taken[match[1]] = (taken[match[1]] || 0) + Number(match[2]);
          }
        });
      });
    });
    return taken;
  }

  function fetchTaken() {
    var url = config.orderSheetUrl;
    var request = fetch(url + (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          throw new Error("Could not load the order sheet");
        }
        return r.text();
      })
      .then(takenFromCsv);
    // Never let a slow or broken sheet stop the shop.
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 4000); });
    return Promise.race([request, timeout]).catch(function () { return null; });
  }

  // fresh: skip the copy kept for this visit (used right before an order is sent).
  function loadTaken(fresh) {
    if (!config.orderSheetUrl) {
      return Promise.resolve({});
    }
    if (fresh) {
      return fetchTaken().then(function (taken) { return taken || {}; });
    }
    if (ordersCache) {
      return ordersCache;
    }
    var kept = null;
    try {
      kept = sessionStorage.getItem(ORDERS_KEY);
    } catch (e) {}
    var latest = fetchTaken().then(function (taken) {
      if (!taken) {
        return kept ? JSON.parse(kept) : {};
      }
      var text = JSON.stringify(taken);
      try {
        sessionStorage.setItem(ORDERS_KEY, text);
      } catch (e) {}
      if (kept !== null && text !== kept) {
        ordersCache = Promise.resolve(taken);
        document.dispatchEvent(new CustomEvent("veeni:data", { detail: "data/products.json" }));
        document.dispatchEvent(new CustomEvent("veeni:data", { detail: "data/events.json" }));
      }
      return taken;
    });
    ordersCache = kept !== null ? Promise.resolve(JSON.parse(kept)) : latest;
    return ordersCache;
  }

  // Copies of the data with the order sheet applied: taken sets are sold, workshop spots are what's left.
  function applyToProducts(products, taken) {
    var copy = JSON.parse(JSON.stringify(products));
    copy.forEach(function (product) {
      product.sets.forEach(function (set) {
        if (taken[product.sku + "-" + set.id]) {
          set.sold = true;
        }
      });
    });
    return copy;
  }

  function applyToEvents(events, taken) {
    var copy = JSON.parse(JSON.stringify(events));
    copy.forEach(function (event) {
      if (event.booking && event.booking.price) {
        event.booking.spots = Math.max(0, (Number(event.booking.spots) || 0) - (taken["WS-" + event.id] || 0));
      }
    });
    return copy;
  }

  function loadProducts() {
    return Promise.all([loadJson("data/products.json"), loadTaken()]).then(function (data) {
      return applyToProducts(data[0], data[1]);
    });
  }

  function loadEvents() {
    return Promise.all([loadJson("data/events.json"), loadTaken()]).then(function (data) {
      return applyToEvents(data[0], data[1]);
    });
  }

  // Everything the bag can contain: gift sets and workshop places.
  function loadCatalog() {
    return Promise.all([loadProducts(), loadEvents()]).then(function (data) {
      return { products: data[0], events: data[1] };
    });
  }

  // The same, with the order sheet read again right now: used just before an order is sent.
  function loadCatalogFresh() {
    return Promise.all([loadJson("data/products.json"), loadJson("data/events.json"), loadTaken(true)]).then(function (data) {
      return { products: applyToProducts(data[0], data[2]), events: applyToEvents(data[1], data[2]) };
    });
  }

  function parseDate(value) {
    var parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isUpcoming(event) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return parseDate(event.date) >= today;
  }

  // Sign-up details only count when a price is set (markets have none; the editor may leave an empty one).
  function bookingOf(event) {
    return event.booking && Number(event.booking.price) > 0 ? event.booking : null;
  }

  // A workshop can be booked on the site when it has a price and free spots and hasn't happened yet.
  function isBookable(event) {
    var booking = bookingOf(event);
    return Boolean(!config.comingSoon && booking && booking.spots > 0 && isUpcoming(event));
  }

  var PEBBLE_PATH = "M10 52C6 28 32 4 62 6c26 2 38 28 30 52-8 22-36 32-58 26C20 80 12 68 10 52Z";

  // The date inside a plum pebble: filled for upcoming, outlined for past.
  function datePebble(value, outlined) {
    var date = parseDate(value);
    var month = date.toLocaleDateString(lang === "cs" ? "cs-CZ" : "en-GB", { month: "short" }).replace(".", "");
    return (
      '<span class="pebble-date' + (outlined ? " is-outline" : "") + '">' +
      '<svg viewBox="0 0 100 90" preserveAspectRatio="none" aria-hidden="true"><path d="' + PEBBLE_PATH + '"/></svg>' +
      "<span><strong>" + date.getDate() + '</strong><span class="label">' + escapeHtml(month) + "</span></span>" +
      "</span>"
    );
  }

  // Until real photos exist (a set's "images"), each photo is a labelled box.
  function photoHtml(images, index, tag, eager) {
    var src = images && images[index];
    var inner = src
      ? '<img src="' + escapeHtml(src) + '" alt=""' + (eager ? "" : ' loading="lazy"') + ">"
      : '<span class="photo-placeholder label">' + escapeHtml(t("set.photo")) + "</span>";
    if (tag) {
      inner += '<span class="tag label">' + escapeHtml(tag) + "</span>";
    }
    return '<div class="photo">' + inner + "</div>";
  }

  function availableSets(product) {
    return product.sets.filter(function (set) { return !set.sold; });
  }

  // A set's own name ("Shell"), or "No. 2" for sets that don't have one yet.
  function setLabel(set) {
    return set.name ? local(set.name) : t("set.number", { n: Number(set.id) });
  }

  /* Bag
     Stored lines are either { id, set } for a one-of-a-kind gift set
     or { event, qty } for places in a workshop. */

  function getBag() {
    var bag = read(BAG_KEY, []);
    return Array.isArray(bag) ? bag : [];
  }

  function saveBag(bag) {
    write(BAG_KEY, bag);
    renderBagCount();
    renderBag();
    document.dispatchEvent(new CustomEvent("veeni:bag"));
  }

  function inBag(productId, setId) {
    return getBag().some(function (line) { return line.id === productId && line.set === setId; });
  }

  function addToBag(productId, setId) {
    if (inBag(productId, setId)) {
      return;
    }
    var bag = getBag();
    bag.push({ id: productId, set: setId });
    saveBag(bag);
  }

  function addWorkshop(eventId, spots) {
    var bag = getBag();
    var line = bag.find(function (item) { return item.event === eventId; });
    if (line) {
      line.qty = Math.min(line.qty + 1, spots);
    } else {
      bag.push({ event: eventId, qty: 1 });
    }
    saveBag(bag);
  }

  function workshopQty(eventId) {
    var line = getBag().find(function (item) { return item.event === eventId; });
    return line ? line.qty : 0;
  }

  function clearBag() {
    saveBag([]);
  }

  function bagCount() {
    return getBag().reduce(function (sum, line) { return sum + (line.qty || 1); }, 0);
  }

  // Joins the stored bag with current data; drops sold sets and workshops that can no longer be booked.
  function bagLines(catalog) {
    return getBag()
      .map(function (line, storeIndex) {
        if (line.event) {
          var event = catalog.events.find(function (e) { return e.id === line.event; });
          if (!event || !isBookable(event)) {
            return null;
          }
          var qty = Math.max(1, Math.min(line.qty, event.booking.spots));
          return {
            kind: "workshop",
            storeIndex: storeIndex,
            event: event,
            name: local(event.title),
            label: t("bag.workshop"),
            qty: qty,
            max: event.booking.spots,
            unitPrice: event.booking.price,
            lineTotal: event.booking.price * qty,
            physical: false
          };
        }
        var product = catalog.products.find(function (p) { return p.id === line.id; });
        var set = product && product.sets.find(function (s) { return s.id === line.set; });
        if (!set || set.sold) {
          return null;
        }
        return {
          kind: "set",
          storeIndex: storeIndex,
          product: product,
          set: set,
          name: local(product.name),
          label: setLabel(set),
          qty: 1,
          unitPrice: product.price,
          lineTotal: product.price,
          physical: true
        };
      })
      .filter(Boolean);
  }

  // Shipping only applies to gift sets; free shipping counts gift sets only.
  function totals(lines) {
    var subtotal = lines.reduce(function (sum, line) { return sum + line.lineTotal; }, 0);
    var goods = lines.reduce(function (sum, line) { return sum + (line.physical ? line.lineTotal : 0); }, 0);
    var shipping = goods === 0 || goods >= config.freeShippingFrom ? 0 : config.shippingPrice;
    return { subtotal: subtotal, shipping: shipping, total: subtotal + shipping, hasGoods: goods > 0 };
  }

  function linesHtml(lines, editable) {
    return lines
      .map(function (line) {
        var visual = line.kind === "workshop" ? '<div class="line-visual">' + datePebble(line.event.date) + "</div>" : photoHtml(line.set.images, 0);
        var actions = "";
        if (editable) {
          actions =
            '<div class="line-actions">' +
            (line.kind === "workshop"
              ? '<span class="qty" aria-label="' + escapeHtml(t("bag.people")) + '">' +
                '<button type="button" data-qty="-1" data-line="' + line.storeIndex + '" aria-label="−1">−</button>' +
                "<span>" + line.qty + "</span>" +
                '<button type="button" data-qty="1" data-line="' + line.storeIndex + '" aria-label="+1"' + (line.qty >= line.max ? " disabled" : "") + ">+</button>" +
                "</span>"
              : "") +
            '<button type="button" class="link-button" data-remove="' + line.storeIndex + '">' + escapeHtml(t("bag.remove")) + "</button>" +
            "</div>";
        } else if (line.kind === "workshop") {
          actions = '<p class="line-meta">' + t("bag.peopleCount", { n: line.qty }) + "</p>";
        }
        return (
          '<div class="line">' +
          visual +
          "<div>" +
          '<p class="line-name">' + escapeHtml(line.name) + "</p>" +
          '<p class="line-meta">' + escapeHtml(line.label) + "</p>" +
          actions +
          "</div>" +
          "<p>" + price(line.lineTotal) + "</p>" +
          "</div>"
        );
      })
      .join("");
  }

  function totalsHtml(sums) {
    return (
      '<div class="totals">' +
      "<div><span>" + t("bag.subtotal") + "</span><span>" + price(sums.subtotal) + "</span></div>" +
      (sums.hasGoods
        ? "<div><span>" + t("bag.shipping") + "</span><span>" + (sums.shipping === 0 ? t("bag.free") : price(sums.shipping)) + "</span></div>"
        : "") +
      '<div class="grand"><span>' + t("bag.total") + "</span><span>" + price(sums.total) + "</span></div>" +
      "</div>" +
      (sums.hasGoods ? '<p class="totals-note muted">' + t("bag.freeFrom", { amount: price(config.freeShippingFrom) }) + "</p>" : '<div class="totals-note"></div>')
    );
  }

  /* Meta Pixel: only loads after the visitor has agreed (EU consent rules). */

  var CONSENT_KEY = "veeni-consent";
  var pixelReady = false;
  var pixelQueue = [];

  function loadPixel() {
    if (pixelReady || !config.metaPixelId) {
      return;
    }
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,"script","https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", config.metaPixelId);
    window.fbq("track", "PageView");
    pixelReady = true;
    pixelQueue.forEach(function (args) { window.fbq.apply(null, args); });
    pixelQueue = [];
  }

  // Shop events (ViewContent, AddToCart, InitiateCheckout, Purchase); dropped unless the visitor agreed.
  function track(name, params) {
    if (!config.metaPixelId || read(CONSENT_KEY, null) !== "granted") {
      return;
    }
    var args = ["track", name, Object.assign({ currency: "CZK" }, params || {})];
    if (pixelReady) {
      window.fbq.apply(null, args);
    } else {
      pixelQueue.push(args);
    }
  }

  function showConsent() {
    var old = document.querySelector(".consent");
    if (old) {
      old.remove();
    }
    var box = document.createElement("div");
    box.className = "consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t("consent.title"));
    box.innerHTML =
      '<p>' + t("consent.text") + ' <a href="privacy.html">' + t("footer.privacy") + "</a></p>" +
      '<div class="consent-actions">' +
      '<button type="button" class="button secondary" data-consent="denied">' + t("consent.decline") + "</button>" +
      '<button type="button" class="button" data-consent="granted">' + t("consent.accept") + "</button>" +
      "</div>";
    box.addEventListener("click", function (event) {
      var choice = event.target.getAttribute("data-consent");
      if (!choice) {
        return;
      }
      write(CONSENT_KEY, choice);
      box.remove();
      if (choice === "granted") {
        loadPixel();
      } else if (pixelReady) {
        // Turning it off again: reload so the pixel is gone from this page too.
        location.reload();
      }
    });
    document.body.appendChild(box);
  }

  function initConsent() {
    if (!config.metaPixelId) {
      return;
    }
    var choice = read(CONSENT_KEY, null);
    if (choice === "granted") {
      loadPixel();
    } else if (choice === null) {
      showConsent();
    }
  }

  /* Events (calendar page and the next-workshop block on the shop page) */

  function bookingHtml(event) {
    var booking = bookingOf(event);
    if (booking && booking.spots <= 0) {
      return '<div class="event-book"><p class="label">' + t("calendar.full") + "</p></div>";
    }
    if (isBookable(event)) {
      var inBag = workshopQty(event.id);
      var spots = booking.spots === 1 ? t("calendar.oneSpotLeft") : t("calendar.spotsLeft", { n: booking.spots });
      return (
        '<div class="event-book">' +
        "<p>" + t("calendar.perPerson", { price: price(booking.price) }) + "</p>" +
        '<p class="muted event-spots">' + (inBag ? t("calendar.inBag", { n: inBag }) : spots) + "</p>" +
        '<button type="button" class="button" data-book="' + escapeHtml(event.id) + '"' + (inBag >= booking.spots ? " disabled" : "") + ">" +
        (inBag ? t("calendar.signUpMore") : t("calendar.signUp")) +
        "</button>" +
        "</div>"
      );
    }
    if (/^https?:\/\//.test(event.registrationUrl || "")) {
      return '<div class="event-book"><a class="button secondary" href="' + escapeHtml(event.registrationUrl) + '" rel="noopener">' + t("calendar.more") + "</a></div>";
    }
    return "";
  }

  // One event row: pebble date, details and (for upcoming events) the sign-up or link.
  // With link, the title leads there (the shop page links to the event on the calendar page).
  function eventHtml(event, isPast, link) {
    var locale = lang === "cs" ? "cs-CZ" : "en-GB";
    var weekday = parseDate(event.date).toLocaleDateString(locale, { weekday: "long" });
    var time = event.startTime ? event.startTime + (event.endTime ? "–" + event.endTime : "") : "";
    var meta = [t("calendar.type." + event.type), weekday, time, local(event.venue), local(event.city)].filter(Boolean).join(" · ");
    return (
      '<article class="event' + (isPast ? " is-past" : "") + '" id="event-' + escapeHtml(event.id) + '">' +
      datePebble(event.date, isPast) +
      "<div>" +
      "<h3>" + (link ? '<a class="event-link" href="' + escapeHtml(link) + '">' + escapeHtml(local(event.title)) + "</a>" : escapeHtml(local(event.title))) + "</h3>" +
      '<p class="event-meta">' + escapeHtml(meta) + "</p>" +
      (local(event.description) && !isPast ? '<p class="event-text">' + escapeHtml(local(event.description)) + "</p>" : "") +
      "</div>" +
      (isPast ? "" : bookingHtml(event)) +
      "</article>"
    );
  }

  // "Sign up" buttons inside root add a workshop place and open the bag.
  function bindBooking(root, events) {
    root.addEventListener("click", function (click) {
      var id = click.target.getAttribute("data-book");
      var event = id && events.find(function (e) { return e.id === id; });
      if (event && isBookable(event)) {
        addWorkshop(event.id, event.booking.spots);
        track("AddToCart", { content_ids: ["WS-" + event.id], content_name: local(event.title), content_type: "product", value: event.booking.price });
        openBag();
      }
    });
  }

  /* Header, footer and bag drawer */

  function page() {
    return document.body.getAttribute("data-page") || "";
  }

  function renderChrome() {
    var header = document.createElement("header");
    header.className = "site-header";
    header.innerHTML =
      '<div class="wrap">' +
      '<a class="site-logo" href="index.html"><img src="images/veeni-logo.png" alt="veeni" width="139" height="40">' +
      '<span class="site-tagline">' + t("brand.tagline") + "</span></a>" +
      '<nav class="site-nav label" aria-label="Main">' +
      '<a href="index.html"' + (page() === "shop" ? ' aria-current="page"' : "") + ">" + t("nav.shop") + "</a>" +
      '<a href="calendar.html"' + (page() === "calendar" ? ' aria-current="page"' : "") + ">" + t("nav.calendar") + "</a>" +
      '<button type="button" class="lang-switch" lang="' + (lang === "cs" ? "en" : "cs") + '" aria-label="' + t("nav.languageName") + '">' + t("nav.language") + "</button>" +
      // While the shop is "coming soon" there is no bag.
      (config.comingSoon ? "" :
      '<button type="button" class="bag-toggle" aria-haspopup="dialog" aria-label="' + t("nav.bag") + '">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>' +
      '<span class="bag-count" aria-hidden="true"></span></button>') +
      "</nav>" +
      "</div>";
    document.body.insertBefore(header, document.body.firstChild);

    if (testMode) {
      var band = document.createElement("p");
      band.className = "test-band label";
      band.innerHTML = t("test.band") + ' · <a href="?test=0">' + t("test.off") + "</a>";
      document.body.insertBefore(band, header);
    }

    var footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.innerHTML =
      '<div class="wrap">' +
      "<p>" + t("footer.about") + "</p>" +
      '<nav aria-label="Footer">' +
      '<a href="https://www.instagram.com/' + config.instagram + '/" rel="noopener">Instagram</a>' +
      '<a href="mailto:' + config.email + '">' + config.email + "</a>" +
      '<a href="terms.html">' + t("footer.terms") + "</a>" +
      '<a href="privacy.html">' + t("footer.privacy") + "</a>" +
      (config.metaPixelId ? '<button type="button" class="link-button consent-open">' + t("consent.settings") + "</button>" : "") +
      "</nav>" +
      "</div>";
    document.body.appendChild(footer);
    var consentOpen = footer.querySelector(".consent-open");
    if (consentOpen) {
      consentOpen.addEventListener("click", showConsent);
    }

    var drawer = document.createElement("div");
    drawer.innerHTML =
      '<div class="bag-backdrop" data-close-bag></div>' +
      '<aside class="bag" role="dialog" aria-modal="true" aria-labelledby="bag-title" aria-hidden="true">' +
      '<div class="bag-head"><h2 id="bag-title" class="label">' + t("bag.title") + "</h2>" +
      '<button type="button" class="label" data-close-bag>' + t("bag.close") + "</button></div>" +
      '<div class="bag-body"></div>' +
      '<div class="bag-foot"></div>' +
      "</aside>";
    document.body.appendChild(drawer);

    document.querySelectorAll(".lang-switch").forEach(function (button) {
      button.addEventListener("click", function () {
        write(LANG_KEY, lang === "cs" ? "en" : "cs");
        var url = new URL(location.href);
        url.searchParams.delete("lang");
        location.href = url.toString();
      });
    });

    var bagToggle = header.querySelector(".bag-toggle");
    if (bagToggle) {
      bagToggle.addEventListener("click", openBag);
    }
    drawer.querySelectorAll("[data-close-bag]").forEach(function (el) {
      el.addEventListener("click", closeBag);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && document.body.classList.contains("bag-open")) {
        closeBag();
      }
    });

    drawer.querySelector(".bag-body").addEventListener("click", function (event) {
      var target = event.target;
      var bag = getBag();
      if (target.hasAttribute("data-remove")) {
        bag.splice(Number(target.getAttribute("data-remove")), 1);
        saveBag(bag);
      } else if (target.hasAttribute("data-qty")) {
        var line = bag[Number(target.getAttribute("data-line"))];
        if (line) {
          line.qty += Number(target.getAttribute("data-qty"));
          // The upper limit is enforced when lines are built from the event's free spots.
          if (line.qty <= 0) {
            bag.splice(bag.indexOf(line), 1);
          }
          saveBag(bag);
        }
      }
    });

    renderBagCount();
  }

  var lastFocus = null;

  function openBag() {
    lastFocus = document.activeElement;
    renderBag();
    document.body.classList.add("bag-open");
    var panel = document.querySelector(".bag");
    panel.setAttribute("aria-hidden", "false");
    panel.querySelector("[data-close-bag]").focus();
  }

  function closeBag() {
    document.body.classList.remove("bag-open");
    document.querySelector(".bag").setAttribute("aria-hidden", "true");
    if (lastFocus) {
      lastFocus.focus();
    }
  }

  // The bag icon shows a small number only when something is in the bag.
  function renderBagCount() {
    var el = document.querySelector(".bag-count");
    var button = document.querySelector(".bag-toggle");
    if (!el) {
      return;
    }
    var n = bagCount();
    el.textContent = n ? n : "";
    button.setAttribute("aria-label", n === 0 ? t("nav.bag") : n === 1 ? t("nav.bagOne") : t("nav.bagItems", { n: n }));
  }

  function renderBag() {
    var body = document.querySelector(".bag-body");
    var foot = document.querySelector(".bag-foot");
    if (!body) {
      return;
    }
    loadCatalog().then(function (catalog) {
      var lines = bagLines(catalog);
      if (lines.length === 0) {
        body.innerHTML = '<p class="bag-empty muted">' + t("bag.empty") + "</p>";
        foot.innerHTML = "";
        return;
      }
      body.innerHTML = linesHtml(lines, true);
      foot.innerHTML = totalsHtml(totals(lines)) + '<a class="button block" href="checkout.html">' + t("bag.checkout") + "</a>";
    });
  }

  // Tab titles follow the chosen language; gift set pages set their own once the set is known.
  var titleKey = document.body.getAttribute("data-title");
  if (titleKey) {
    document.title = t(titleKey);
  }

  // "HANDMADE IN PRAGUE" is sized to run exactly the width of the logo, on every screen size.
  function fitTagline() {
    var logo = document.querySelector(".site-logo img");
    var line = document.querySelector(".site-tagline");
    if (!logo || !line || !logo.offsetWidth) {
      return;
    }
    // Optical alignment: the slanted "v" looks like it starts later than the straight "H",
    // and the logo image has a sliver of empty space on each side.
    var startInset = logo.offsetWidth * 0.05;
    var endInset = logo.offsetWidth * 0.013;
    var target = logo.offsetWidth - startInset - endInset;
    line.style.fontSize = "";
    line.style.marginLeft = startInset + "px";
    var size = parseFloat(getComputedStyle(line).fontSize);
    var spacing = parseFloat(getComputedStyle(line).letterSpacing) || 0;
    // Letter spacing also follows the last letter; that bit isn't visible, so leave it out.
    var visible = line.offsetWidth - spacing;
    if (visible > 0) {
      line.style.fontSize = (size * target / visible) + "px";
    }
  }

  // Checkout, payment and thank-you pages don't exist yet while the shop is "coming soon".
  if (config.comingSoon && page() === "checkout") {
    location.replace("index.html");
  }

  renderChrome();
  applyText();
  initConsent();

  var logoImg = document.querySelector(".site-logo img");
  if (logoImg) {
    logoImg.addEventListener("load", fitTagline);
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitTagline);
  }
  window.addEventListener("resize", fitTagline);
  fitTagline();

  window.veeni = {
    config: config,
    lang: lang,
    testMode: testMode,
    t: t,
    local: local,
    price: price,
    escapeHtml: escapeHtml,
    read: read,
    write: write,
    loadProducts: loadProducts,
    loadEvents: loadEvents,
    loadCatalog: loadCatalog,
    loadCatalogFresh: loadCatalogFresh,
    parseDate: parseDate,
    isUpcoming: isUpcoming,
    isBookable: isBookable,
    datePebble: datePebble,
    eventHtml: eventHtml,
    loadTaken: loadTaken,
    bindBooking: bindBooking,
    photoHtml: photoHtml,
    availableSets: availableSets,
    setLabel: setLabel,
    getBag: getBag,
    inBag: inBag,
    addToBag: addToBag,
    addWorkshop: addWorkshop,
    workshopQty: workshopQty,
    clearBag: clearBag,
    bagLines: bagLines,
    totals: totals,
    linesHtml: linesHtml,
    totalsHtml: totalsHtml,
    openBag: openBag,
    track: track,
    showConsent: showConsent
  };
})();
