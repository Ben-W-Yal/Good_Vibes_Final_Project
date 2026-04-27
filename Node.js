// Quick Cesium ion check: list assets using an env token.
const accessToken =
  process.env.CESIUM_ION_TOKEN ?? process.env.VITE_CESIUM_ION_TOKEN ?? "";

if (!accessToken) {
  throw new Error(
    "Missing CESIUM_ION_TOKEN (or VITE_CESIUM_ION_TOKEN) in your environment.",
  );
}

const endpoint = "https://api.cesium.com/v1/assets";

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // keep raw text for diagnostics
  }
  return { res, text, json };
}

let attempt = await fetchJson(endpoint, {
  headers: { Authorization: `Bearer ${accessToken}` },
});

if (!attempt.res.ok) {
  const withQueryToken = new URL(endpoint);
  withQueryToken.searchParams.set("access_token", accessToken);
  attempt = await fetchJson(withQueryToken.toString());
}

if (!attempt.res.ok) {
  const details = attempt.text || JSON.stringify(attempt.json) || "No response body";
  throw new Error(
    `Cesium ion request failed: ${attempt.res.status} ${attempt.res.statusText}\n${details}`,
  );
}

const payload = attempt.json ?? {};
console.log(`Cesium ion assets: ${Array.isArray(payload?.items) ? payload.items.length : 0}`);