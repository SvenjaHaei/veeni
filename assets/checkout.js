(function () {
  "use strict";

  var v = window.veeni;
  var ORDER_KEY = "veeni-order";

  /* Checkout */

  function initCheckout(catalog) {
    var form = document.getElementById("checkout-form");
    var error = document.getElementById("checkout-error");
    var submit = document.getElementById("checkout-submit");

    document.getElementById("terms-consent").innerHTML = v.t("checkout.agreeTerms", {
      terms: '<a href="terms.html" target="_blank">' + v.t("checkout.termsLink") + "</a>"
    });
    document.getElementById("privacy-consent").innerHTML = v.t("checkout.agreePrivacy", {
      privacy: '<a href="privacy.html" target="_blank">' + v.t("checkout.privacyLink") + "</a>"
    });

    var deliveryFields = form.querySelectorAll(".delivery-field");
    var lead = document.getElementById("checkout-lead");

    function render() {
      var lines = v.bagLines(catalog);
      var sums = v.totals(lines);
      document.getElementById("checkout-lines").innerHTML = v.linesHtml(lines, false);
      document.getElementById("checkout-totals").innerHTML = v.totalsHtml(sums);
      // Workshop-only orders need no delivery address.
      var needsAddress = sums.hasGoods || lines.length === 0;
      deliveryFields.forEach(function (field) {
        field.hidden = !needsAddress;
        field.querySelector("input").required = needsAddress;
      });
      lead.textContent = v.t(needsAddress ? "checkout.lead" : "checkout.leadWorkshop");
      submit.disabled = lines.length === 0;
      error.textContent = lines.length === 0 ? v.t("checkout.empty") : "";
      return lines;
    }

    var startLines = render();
    if (startLines.length) {
      var startSums = v.totals(startLines);
      v.track("InitiateCheckout", { value: startSums.total, num_items: startLines.length });
    }
    // The bag drawer can change quantities while the checkout is open.
    window.addEventListener("storage", render);
    document.addEventListener("veeni:bag", render);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var lines = render();
      if (lines.length === 0) {
        return;
      }

      var missing = Array.prototype.some.call(form.elements, function (el) {
        return el.required && (el.type === "checkbox" ? !el.checked : !el.value.trim());
      });
      if (missing) {
        error.textContent = v.t("checkout.missing");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())) {
        error.textContent = v.t("checkout.emailInvalid");
        return;
      }

      var sums = v.totals(lines);
      var needsAddress = sums.hasGoods;
      // Same shape as the previous shop, so the Make scenario keeps working;
      // "type" tells gift sets and workshop places apart.
      var payload = {
        customer: {
          firstName: form.firstName.value.trim(),
          lastName: form.lastName.value.trim(),
          email: form.email.value.trim(),
          phone: form.phone.value.trim(),
          street: needsAddress ? form.street.value.trim() : "",
          city: needsAddress ? form.city.value.trim() : "",
          zip: needsAddress ? form.zip.value.trim() : ""
        },
        items: lines.map(function (line) {
          if (line.kind === "workshop") {
            return {
              type: "workshop",
              sku: "WS-" + line.event.id,
              // Names follow the customer's language, so the email can too; nameEn stays the same for your records.
              name: v.local(line.event.title),
              nameEn: line.event.title.en || line.event.title,
              variant: line.event.date + (line.event.startTime ? " " + line.event.startTime : ""),
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal
            };
          }
          return {
            type: "giftset",
            sku: line.product.sku + "-" + line.set.id,
            name: v.local(line.product.name) + " – " + v.setLabel(line.set),
            nameEn: line.product.name.en + " – " + (line.set.name ? line.set.name.en : "No. " + Number(line.set.id)),
            variant: line.set.id + (line.set.holder ? "-" + line.set.holder : ""),
            qty: 1,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal
          };
        }),
        subtotal: sums.subtotal,
        shipping: sums.shipping,
        total: sums.total,
        language: v.lang,
        test: v.testMode
      };

      submit.disabled = true;
      submit.textContent = v.t("checkout.placing");
      error.textContent = "";

      // Someone may have bought the same set a moment ago: check the order sheet once more before sending.
      var before = describe(lines);
      v.loadCatalogFresh()
        .then(function (fresh) {
          catalog.products = fresh.products;
          catalog.events = fresh.events;
          var now = render();
          if (describe(now) !== before) {
            var stop = new Error("changed");
            stop.changed = true;
            throw stop;
          }
          return sendOrder(payload);
        })
        .then(function (order) {
          order.hasGoods = needsAddress;
          order.contentIds = payload.items.map(function (item) { return item.sku; });
          order.test = v.testMode;
          v.write(ORDER_KEY, order);
          v.clearBag();
          location.href = "payment.html";
        })
        .catch(function (problem) {
          var lines = render();
          error.textContent = problem && problem.changed
            ? v.t("checkout.changed")
            : v.t("checkout.failed", { email: v.config.email }) +
              // In test mode, show what went wrong, to help fix the Make scenario.
              (v.testMode && problem ? " [" + problem.message + "]" : "");
          submit.disabled = lines.length === 0;
          submit.textContent = v.t("checkout.place");
        });
    });
  }

  // A short fingerprint of the bag, to notice when the fresh check changed it.
  function describe(lines) {
    return lines.map(function (line) {
      return line.kind === "workshop" ? "w:" + line.event.id + ":" + line.qty : "s:" + line.product.id + ":" + line.set.id;
    }).join("|");
  }

  // Make answers with the payment QR code, either as an image or as JSON.
  function sendOrder(payload) {
    var url = (v.testMode && v.config.testWebhookUrl) || v.config.webhookUrl;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error("Make replied " + response.status + ": " + text.slice(0, 160));
        });
      }
      // Make may send the order number as a header (only readable if Make exposes it, see make/README.md)
      // or in the JSON body; accept the usual spellings.
      var orderNumber = ["x-veeni-order-number", "order-number", "x-order-number", "ordernumber"]
        .map(function (name) { return (response.headers.get(name) || "").trim(); })
        .filter(Boolean)[0] || "";
      var type = (response.headers.get("content-type") || "").toLowerCase();

      var qrPromise = type.indexOf("image/") !== -1
        ? response.blob().then(blobToDataUrl).then(function (qr) { return { qr: qr, body: {} }; })
        : response.text().then(function (text) {
            var body = {};
            try {
              body = JSON.parse(text);
            } catch (e) {
              return { qr: text.trim(), body: {}, raw: text };
            }
            var data = body.data || {};
            return {
              qr: body.paymentQrCode || body.paymentQr || body.qrCode || body.qrImage || body.qrUrl ||
                data.paymentQrCode || data.qrCode || data.qrImage || data.qrUrl || "",
              body: body
            };
          });

      return qrPromise.then(function (result) {
        var qr = normalizeQr(result.qr);
        if (!qr) {
          throw new Error("No QR code in Make's reply: " + String(result.raw || JSON.stringify(result.body) || "").slice(0, 160));
        }
        var body = result.body || {};
        var data = body.data || {};
        var fromBody = body.orderNumber || body["Order-number"] || body["order-number"] || body.order_number || body.orderId ||
          data.orderNumber || data["Order-number"] || data.orderId;
        var number = orderNumber || (fromBody ? String(fromBody).trim() : "");
        if (!number) {
          // Test mode shows what came back, to help set up the Make response.
          if (v.testMode && window.console) {
            console.warn("veeni: no order number in Make's reply. Readable headers:", Array.from(response.headers.keys()), "JSON keys:", Object.keys(body));
          }
          number = fallbackOrderNumber();
        }
        return {
          orderNumber: number,
          variableSymbol: String(number),
          bankAccount: result.body.bankAccount || v.config.bankAccount,
          total: payload.total,
          qr: qr
        };
      });
    });
  }

  function normalizeQr(value) {
    var text = String(value || "").trim();
    if (!text) {
      return "";
    }
    if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text)) {
      return text;
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      return "data:image/png;base64," + text.replace(/\s+/g, "");
    }
    return "";
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () { resolve(reader.result || ""); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Only used when Make sends no order number. Digits only: Czech variable symbols allow max. 10 digits.
  function fallbackOrderNumber() {
    var now = new Date();
    return String(now.getFullYear()).slice(-2) + String(now.getTime()).slice(-8);
  }

  /* Payment */

  function initPayment() {
    var root = document.getElementById("payment");
    var order = v.read(ORDER_KEY, null);
    if (!order || !order.qr) {
      document.getElementById("payment-lead").textContent = v.t("payment.missing");
      return;
    }
    // Report the order to the Meta Pixel once; test orders are never reported.
    if (!order.tracked && !order.test) {
      v.track("Purchase", { value: order.total, content_ids: order.contentIds || [], content_type: "product" });
      order.tracked = true;
      v.write(ORDER_KEY, order);
    }
    var fileName = "veeni-payment-" + String(order.variableSymbol).replace(/[^\w-]/g, "") + ".png";
    // Grid areas keep "Save QR code" and "I've paid" on one line on wide screens.
    root.innerHTML =
      '<div class="payment-qr"><img src="' + v.escapeHtml(order.qr) + '" alt="' + v.escapeHtml(v.t("payment.qrAlt")) + '"></div>' +
      '<dl class="payment-facts">' +
      "<div><dt>" + v.t("payment.amount") + "</dt><dd>" + v.price(order.total) + "</dd></div>" +
      "<div><dt>" + v.t("payment.account") + "</dt><dd>" + v.escapeHtml(order.bankAccount) + "</dd></div>" +
      "<div><dt>" + v.t("payment.vs") + "</dt><dd>" + v.escapeHtml(order.variableSymbol) + "</dd></div>" +
      "</dl>" +
      // On a phone the QR can't be scanned from the same screen, so it can be saved and opened in the banking app.
      '<a class="button secondary block payment-save" href="' + v.escapeHtml(order.qr) + '" download="' + fileName + '">' + v.t("payment.save") + "</a>" +
      '<a class="button block payment-done" href="thank-you.html">' + v.t("payment.done") + "</a>" +
      '<p class="payment-hint muted">' + v.t("payment.saveHint") + "</p>";

    // Bank transfers have no instant confirmation, so say what happens after paying.
    var steps = order.hasGoods === false
      ? ["payment.step1", "payment.step2Workshop", "payment.step3Workshop"]
      : ["payment.step1", "payment.step2", "payment.step3"];
    document.getElementById("next-steps-list").innerHTML = steps
      .map(function (key, index) { return "<li><span>" + (index + 1) + "</span>" + v.t(key) + "</li>"; })
      .join("");
    document.getElementById("next-steps").hidden = false;
  }

  /* Thank you */

  function initThanks() {
    var order = v.read(ORDER_KEY, null);
    var workshopOnly = order && order.hasGoods === false;
    document.getElementById("thanks-lead").textContent = v.t(workshopOnly ? "thanks.leadWorkshop" : "thanks.lead");
    document.getElementById("thanks-note").textContent = v.t("thanks.note");
    document.getElementById("thanks-order").textContent = order && order.orderNumber ? v.t("thanks.order", { order: order.orderNumber }) : "";
    var instagram = document.getElementById("thanks-instagram");
    instagram.href = "https://www.instagram.com/" + v.config.instagram + "/";
    instagram.textContent = v.t("thanks.instagram", { handle: v.config.instagram });
    try {
      localStorage.removeItem(ORDER_KEY);
    } catch (e) {}
  }

  if (document.getElementById("checkout-form")) {
    v.loadCatalog().then(initCheckout);
  } else if (document.getElementById("payment")) {
    initPayment();
  } else if (document.getElementById("thanks-lead")) {
    initThanks();
  }
})();
