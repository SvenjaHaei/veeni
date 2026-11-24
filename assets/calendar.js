(function () {
  "use strict";

  var v = window.veeni;
  var PAST_MONTHS = 3;
  var root = document.getElementById("events");

  function render(events) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var cutoff = new Date(today);
    cutoff.setMonth(cutoff.getMonth() - PAST_MONTHS);

    var upcoming = events
      .filter(v.isUpcoming)
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var past = events
      .filter(function (e) { return !v.isUpcoming(e) && v.parseDate(e.date) >= cutoff; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var html = '<h2 class="label">' + v.t("calendar.upcoming") + "</h2>";
    html += upcoming.length
      ? upcoming.map(function (e) { return v.eventHtml(e, false); }).join("")
      : '<p class="events-none muted">' + v.t("calendar.none") + "</p>";
    if (past.length) {
      html += '<h2 class="label">' + v.t("calendar.past") + "</h2>";
      html += past.map(function (e) { return v.eventHtml(e, true); }).join("");
    }
    root.innerHTML = html;
  }

  v.loadEvents().then(function (events) {
    render(events);

    // Coming from a workshop link on the shop page: the rows only exist now, so scroll to it here.
    var linked = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (linked) {
      linked.scrollIntoView();
    }

    v.bindBooking(root, events);

    // Keep the "in your bag" counts in step with the bag drawer.
    document.addEventListener("veeni:bag", function () { render(events); });
  });
})();
