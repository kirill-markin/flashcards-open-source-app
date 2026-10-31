import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import countries from "../../../backend/src/billing/regionalPricing/countries.json";
import { loadPublicRegionalOffer } from "../api/endpoints/stripeBilling";
import type { PublicRegionalOffer } from "../apiContracts/stripeBilling";

export const pricingCountryCodes: ReadonlyArray<string> = [...countries.fullPriceCountries, ...countries.discountedCountries]
  .map((country) => country.code).sort();
const preferenceName = "nibomo_pricing_country";

export function validatedPricingCountry(value: unknown): string | null {
  return typeof value === "string" && pricingCountryCodes.includes(value) ? value : null;
}

function readInitialCountry(): string | null {
  const values = new URLSearchParams(window.location.search).getAll("pricing_country");
  const query = values.length === 1 ? validatedPricingCountry(values[0]) : null;
  if (query !== null) return query;
  try {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${preferenceName}=`));
    return validatedPricingCountry(cookie?.slice(preferenceName.length + 1));
  } catch (error) {
    console.error("Pricing country preference could not be read", { code: "PRICING_COUNTRY_STORAGE_DENIED", error });
    return null;
  }
}

export type RegionalCountry = Readonly<{
  country: string | null; quote: PublicRegionalOffer | null; error: unknown; loading: boolean;
  select: (country: string) => void; restore: (country: string) => void; retry: () => void;
}>;

export function useRegionalCountry(): RegionalCountry {
  const location = useLocation();
  const navigate = useNavigate();
  const [country, setCountry] = useState(readInitialCountry);
  const countryRef = useRef(country);
  const [quote, setQuote] = useState<PublicRegionalOffer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [storageError, setStorageError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (!query.has("pricing_country")) return;
    query.delete("pricing_country");
    void navigate({ pathname: location.pathname, search: query.toString(), hash: location.hash }, { replace: true });
  }, [location, navigate]);
  useEffect(() => {
    const controller = new AbortController();
    const requestedCountry = country;
    setLoading(true);
    setError(null);
    void loadPublicRegionalOffer(country, controller.signal).then((next) => {
      if (controller.signal.aborted || countryRef.current !== requestedCountry) return;
      if (next.state === "offer" && validatedPricingCountry(next.selectedCountry) === null) throw new Error("Regional offer returned an unsupported country.");
      if (requestedCountry !== null && next.selectedCountry !== requestedCountry) throw new Error("Regional offer did not match the selected country.");
      setQuote(next);
      if (requestedCountry === null && next.state === "offer") {
        countryRef.current = next.selectedCountry;
        setCountry(next.selectedCountry);
      }
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted && countryRef.current === requestedCountry) setError(caught);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return (): void => controller.abort();
  }, [country, revision]);
  function select(value: string): void {
    const next = validatedPricingCountry(value);
    if (next === null) throw new Error("Choose a supported pricing country.");
    countryRef.current = next;
    setCountry(next);
    setStorageError(null);
    try {
      const hostname = window.location.hostname;
      const domain = hostname === "nibomo.com" || hostname.endsWith(".nibomo.com") ? "; Domain=nibomo.com" : "";
      document.cookie = `${preferenceName}=${next}; Path=/; Secure; SameSite=Lax; Max-Age=31536000${domain}`;
      if (!document.cookie.split("; ").includes(`${preferenceName}=${next}`)) throw new Error("The browser did not retain the pricing country preference.");
    } catch (caught) {
      console.error("Pricing country preference could not be saved", { code: "PRICING_COUNTRY_STORAGE_DENIED", error: caught });
      setStorageError(caught);
    }
  }
  function restore(value: string): void {
    const next = validatedPricingCountry(value);
    if (next === null) throw new Error("The saved Premium country is unsupported.");
    countryRef.current = next;
    setCountry(next);
  }
  return { country, restore, quote: quote?.selectedCountry === country ? quote : null, error: error ?? storageError, loading, select,
    retry: (): void => setRevision((value) => value + 1) };
}
