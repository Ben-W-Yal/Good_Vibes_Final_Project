Verified feed files consumed by the API:

- `verified-events.json`
- `verified-aircraft.json`
- `verified-ships.json`
- `verified-satellites.json`

Rules:

- Each file must contain a JSON array.
- Records missing provenance are dropped silently.
- Required provenance fields on every record:
  - `source` (non-empty string)
  - `sourceUrl` (`http://` or `https://`)

Additional required fields are validated in `server/routes.ts`.
