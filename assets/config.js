window.VEENI_CONFIG = {
  // true = no gift sets on the site yet: the shop page shows a "coming soon" note; no bag, checkout or sign-ups.
  // Set to false (and bump ?v=) to open the shop.
  comingSoon: true,
  webhookUrl: "https://hook.eu2.make.com/e7lx4mii0seuhvhan1lxhy64rrcbyabi",
  // Optional: a separate Make webhook for test orders (?test=1). Empty = use webhookUrl, marked "test": true.
  testWebhookUrl: "",
  bankAccount: "2301234567/2010",
  shippingPrice: 89,
  freeShippingFrom: 1000,
  email: "info@veeni.cz",
  instagram: "veeni.prague",
  // The Google Sheet Make writes every order into, as a CSV link (see make/README.md).
  // Sets listed there show as sold and workshop places as taken. Empty = only the "sold" ticks in the data count.
  orderSheetUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRtsxWr4U9qUdjjKg6uFM8CSUCYByXUfD8xQ_hHFwxKuEq-K1t9uEzFdfETZ0QzX2jUp-m9IDSo4pyw/pub?output=csv",
  // Meta Pixel ID from Meta Events Manager. Empty = no pixel and no consent banner.
  metaPixelId: ""
};
