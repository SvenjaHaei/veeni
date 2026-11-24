(function () {
  "use strict";

  var v = window.veeni;
  var PLACEHOLDER_PHOTOS = 3;
  var setRender = null;

  function readHero() {
    try {
      return JSON.parse(sessionStorage.getItem("veeni-hero") || "null");
    } catch (e) {
      return null;
    }
  }

  function renderGrid(products) {
    var grid = document.getElementById("set-grid");
    var hero = readHero();
    grid.innerHTML = products
      .map(function (p) {
        var soon = v.config.comingSoon;
        var available = v.availableSets(p).length;
        var cover = (v.availableSets(p)[0] || p.sets[0] || {}).images;
        return (
          '<a class="set-card" href="set.html?id=' + encodeURIComponent(p.id) + '">' +
          // Shop photos sit at the top of the page, so they load straight away.
          v.photoHtml(cover, 0, available || soon ? "" : v.t("set.soldOut"), true).replace(
            '<div class="photo">',
            // Coming back from a gift set page, its photo glides back into this spot.
            hero && hero.id === p.id ? '<div class="photo" style="view-transition-name: set-photo">' : '<div class="photo">'
          ) +
          "<h2>" + v.escapeHtml(v.local(p.name)) + "</h2>" +
          '<p class="muted">' + v.escapeHtml(v.local(p.tagline)) + "</p>" +
          (soon
            ? '<p class="price">' + v.t("set.comingSoon") + "</p>"
            : '<p class="price">' + v.price(p.price) +
              (available ? ' <span class="muted">· ' + v.t("set.available", { n: available }) + "</span>" : "") +
              "</p>") +
          "</a>"
        );
      })
      .join("");
  }

  // Remember which photo was clicked, so the set page can show it at once and the photo glides into place.
  function bindGrid() {
    var grid = document.getElementById("set-grid");
    grid.addEventListener("click", function (event) {
      var card = event.target.closest(".set-card");
      if (!card) {
        return;
      }
      grid.querySelectorAll(".photo").forEach(function (photo) { photo.style.viewTransitionName = ""; });
      var photo = card.querySelector(".photo");
      var img = photo.querySelector("img");
      photo.style.viewTransitionName = "set-photo";
      try {
        sessionStorage.setItem("veeni-hero", JSON.stringify({
          id: new URL(card.href).searchParams.get("id"),
          src: img ? img.getAttribute("src") : ""
        }));
      } catch (e) {}
    });
  }

  function renderSet(products) {
    var params = new URLSearchParams(location.search);
    var p = products.find(function (item) { return item.id === params.get("id"); });
    var root = document.getElementById("set");

    if (!p) {
      root.innerHTML = '<div class="page-head"><h1>' + v.t("set.notFound") + '</h1><p><a href="index.html">' + v.t("set.back") + "</a></p></div>";
      return;
    }

    document.title = v.local(p.name) + " · veeni";
    v.track("ViewContent", { content_ids: [p.sku], content_name: p.name.en, content_type: "product", value: p.price });

    // Start with the set from the link (?set=02), else the first one still for sale and not yet in the bag.
    var selected =
      p.sets.find(function (s) { return s.id === params.get("set") && !s.sold; }) ||
      p.sets.find(function (s) { return !s.sold && !v.inBag(p.id, s.id); }) ||
      v.availableSets(p)[0] ||
      null;

    var soon = v.config.comingSoon;
    var instagram = '<a href="https://www.instagram.com/' + v.config.instagram + '/" rel="noopener">Instagram</a>';

    // The page skeleton (back link, photo frame) is in set.html so the photo can transition in.
    document.getElementById("set-info").innerHTML =
      "<h1>" + v.escapeHtml(v.local(p.name)) + "</h1>" +
      '<p class="tagline muted">' + v.escapeHtml(v.local(p.tagline)) + "</p>" +
      (soon
        // Coming soon: no price, button or set picker, just a note.
        ? '<p class="price">' + v.t("set.comingSoon") + "</p>" +
          '<p class="coming-soon-note">' + v.t("set.comingSoonNote", { instagram: instagram }) + "</p>"
        // Order: add to bag right under the price, then what's inside, then choose the set.
        : '<p class="price">' + v.price(p.price) + "</p>" +
          '<button type="button" class="button block set-add" id="set-add"></button>') +
      '<h2 class="inside-title label">' + v.t("set.inside") + "</h2>" +
      '<ul class="inside">' +
      p.items
        .map(function (item) {
          return "<li>" + v.escapeHtml(v.local(item.name)) + "<span>" + v.escapeHtml(v.local(item.note)) + "</span></li>";
        })
        .join("") +
      "</ul>" +
      (soon ? "" : '<fieldset class="picker"><legend class="label">' + v.t("set.choose") + '</legend><div class="picker-grid" id="picker"></div></fieldset>');

    document.getElementById("set-info").classList.add("is-filled");

    var picker = document.getElementById("picker");
    var button = document.getElementById("set-add");

    function render() {
      // The main photo frame stays in place (it carries the page transition); only its image changes.
      var images = selected ? selected.images : [];
      var count = images && images.length ? images.length : PLACEHOLDER_PHOTOS;
      var main = document.getElementById("set-photo-main");
      var current = main.querySelector("img");
      if (images && images[0]) {
        if (!current || current.getAttribute("src") !== images[0]) {
          main.innerHTML = '<img src="' + v.escapeHtml(images[0]) + '" alt="">';
        }
      } else {
        main.innerHTML = v.photoHtml([], 0).replace(/^<div class="photo">|<\/div>$/g, "");
      }
      var rest = "";
      for (var i = 1; i < count; i++) {
        rest += v.photoHtml(images, i);
      }
      var holder = document.getElementById("set-photos");
      while (holder.lastElementChild && holder.lastElementChild !== main) {
        holder.removeChild(holder.lastElementChild);
      }
      holder.insertAdjacentHTML("beforeend", rest);

      if (!picker) {
        return;
      }

      picker.innerHTML = p.sets
        .map(function (s) {
          var state = s.sold ? v.t("set.sold") : v.inBag(p.id, s.id) ? v.t("set.inBag") : "";
          return (
            '<label class="pick' + (s.sold ? " is-sold" : "") + '">' +
            '<input type="radio" name="set" value="' + v.escapeHtml(s.id) + '"' +
            (selected && selected.id === s.id ? " checked" : "") + (s.sold ? " disabled" : "") + ">" +
            v.photoHtml(s.images, 0) +
            '<span class="pick-name">' + v.escapeHtml(v.setLabel(s)) + "</span>" +
            (state ? '<span class="pick-meta">' + v.escapeHtml(state) + "</span>" : "") +
            "</label>"
          );
        })
        .join("");

      if (!selected) {
        button.disabled = true;
        button.textContent = v.t("set.soldOut");
        return;
      }
      var already = v.inBag(p.id, selected.id);
      button.disabled = already;
      button.textContent = already ? v.t("set.inBag") : v.t("set.add", { name: v.setLabel(selected) });
    }

    if (!picker) {
      render();
      return;
    }

    picker.addEventListener("change", function (event) {
      selected = p.sets.find(function (s) { return s.id === event.target.value; });
      var url = new URL(location.href);
      url.searchParams.set("set", selected.id);
      history.replaceState(null, "", url);
      render();
    });

    button.addEventListener("click", function () {
      if (!selected) {
        return;
      }
      v.addToBag(p.id, selected.id);
      v.track("AddToCart", { content_ids: [p.sku + "-" + selected.id], content_name: p.name.en, content_type: "product", value: p.price });
      v.openBag();
    });

    setRender = render;
    render();
  }

  // Shop page: workshops and markets in the next two weeks (at most three), soonest first.
  // Hidden when nothing is coming up that soon; the calendar page lists everything.
  var NEXT_EVENTS = 3;
  var NEXT_DAYS = 14;

  function isSoon(event) {
    var limit = new Date();
    limit.setHours(0, 0, 0, 0);
    limit.setDate(limit.getDate() + NEXT_DAYS);
    return v.isUpcoming(event) && v.parseDate(event.date) <= limit;
  }
  function renderNextWorkshop() {
    var section = document.getElementById("next-workshop");
    if (!section) {
      return;
    }
    v.loadEvents().then(function (events) {
      var target = document.getElementById("next-workshop-event");
      function render() {
        var next = events
          .filter(isSoon)
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
          .slice(0, NEXT_EVENTS);
        section.hidden = !next.length;
        target.innerHTML = next
          .map(function (event) { return v.eventHtml(event, false, "calendar.html#event-" + encodeURIComponent(event.id)); })
          .join("");
      }
      render();
      v.bindBooking(target, events);
      document.addEventListener("veeni:bag", render);
    });
  }

  renderNextWorkshop();

  // While the shop is "coming soon", the shipping promise says so instead.
  var shippingPromise = document.getElementById("promise-shipping");
  if (shippingPromise && v.config.comingSoon) {
    shippingPromise.setAttribute("data-t", "home.promiseSoon");
    shippingPromise.textContent = v.t("home.promiseSoon");
  }

  // Coming soon: no gift sets on the site yet. The shop page shows a short note instead, set pages go back to it.
  function renderComingSoon() {
    var grid = document.getElementById("set-grid");
    if (grid) {
      grid.outerHTML =
        '<section class="coming-soon">' +
        '<div class="coming-soon-shape"><h2>' + v.escapeHtml(v.t("home.soonTitle")) + "</h2></div>" +
        "<p>" + v.t("set.comingSoonNote", { instagram: '<a href="https://www.instagram.com/' + v.config.instagram + '/" rel="noopener">Instagram</a>' }) + "</p>" +
        "</section>";
    }
    if (document.getElementById("set")) {
      location.replace("index.html");
    }
    return Promise.resolve();
  }

  function renderProducts() {
    if (v.config.comingSoon) {
      return renderComingSoon();
    }
    return v.loadProducts().then(function (products) {
      if (document.getElementById("set-grid")) {
        renderGrid(products);
      }
      if (document.getElementById("set")) {
        renderSet(products);
      }
    });
  }

  if (document.getElementById("set-grid")) {
    bindGrid();
  }
  document.addEventListener("veeni:bag", function () {
    if (setRender) {
      setRender();
    }
  });
  // Fresher product data arrived (e.g. a set sold meanwhile): draw again.
  document.addEventListener("veeni:data", function (event) {
    if (event.detail === "data/products.json") {
      renderProducts();
    }
  });

  renderProducts().catch(function () {
    var target = document.getElementById("set-grid") || document.getElementById("set");
    target.innerHTML = '<p class="form-error">' + v.t("checkout.failed", { email: v.config.email }) + "</p>";
  });
})();
