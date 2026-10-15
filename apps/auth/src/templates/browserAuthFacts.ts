// Only UI-observed boundaries cross this route; request/provider outcomes remain server-owned.
export const browserAuthFactsScript = `
  function sendAuthFact(fact) {
    if (collectionDisabled || !document.cookie.split(";").some(function(value) {
      return value.trim() === "product_analytics_collection=1";
    })) return;
    const screen = typeof authFactScreen === "undefined" ? "signin" : authFactScreen;
    void fetch("/api/auth-fact?screen=" + encodeURIComponent(screen) + "&ui_locale=" + encodeURIComponent(uiLocale), {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fact),
    }).then(function(response) {
      if (!response.ok) console.warn("Sign-in fact could not be reported", { status: response.status });
    }).catch(function() { console.warn("Sign-in fact could not be reported: check connectivity."); });
  }
  function authFact(eventName, method) {
    sendAuthFact({ eventName: eventName, method: method });
  }
`;
