// Only UI-observed boundaries cross this route; request/provider outcomes remain server-owned.
export const browserAuthFactsScript = `
  function authFact(eventName, method) {
    if (collectionDisabled || !document.cookie.split(";").some(function(value) {
      return value.trim() === "product_analytics_collection=1";
    })) return;
    void fetch("/api/auth-fact?screen=signin&ui_locale=" + encodeURIComponent(uiLocale), {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: eventName, method: method }),
    }).then(function(response) {
      if (!response.ok) console.warn("Sign-in fact could not be reported", { status: response.status });
    }).catch(function() { console.warn("Sign-in fact could not be reported: check connectivity."); });
  }
`;
