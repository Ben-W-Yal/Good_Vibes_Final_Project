/**
 * FilterPanel — floating panel for event category/severity filter controls
 */
import { useStore } from '../store';
import type { Category, Severity } from '../data/events';
import type { GlobeSource } from '../../../src/types/globe';

const CATEGORIES = [
  { key: 'conflict', label: 'Conflict', color: '#f85149', icon: '⚔️' },
  { key: 'domestic', label: 'Domestic', color: '#bc8cff', icon: '🏛️' },
  { key: 'local', label: 'Local', color: '#58a6ff', icon: '📍' },
  { key: 'social', label: 'Social', color: '#3fb950', icon: '🗣️' },
] as const satisfies ReadonlyArray<{ key: Category; label: string; color: string; icon: string }>;

const SEVERITIES = [
  { key: 'critical', label: 'Critical', color: '#f85149' },
  { key: 'high', label: 'High', color: '#f0883e' },
  { key: 'medium', label: 'Medium', color: '#d29922' },
  { key: 'low', label: 'Low', color: '#3fb950' },
] as const satisfies ReadonlyArray<{ key: Severity; label: string; color: string }>;

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7d', hours: 24 * 7 },
  { label: '14d', hours: 24 * 14 },
  { label: '30d', hours: 24 * 30 },
  { label: '90d', hours: 24 * 90 },
  // ACLED's free tier embargoes rows by ~13 months; "1y" is what makes ACLED show up.
  { label: '1y', hours: 24 * 365 },
];

/** News article language (ISO 639-1). */
const NEWS_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
] as const;

const SOURCES = [
  { key: 'ai', label: 'AI Web OSINT' },
  { key: 'thenewsapi', label: 'TheNewsAPI' },
  { key: 'acled', label: 'ACLED' },
  { key: 'liveuamap', label: 'Liveuamap' },
  { key: 'perigon', label: 'Perigon' },
  { key: 'gdelt', label: 'GDELT' },
] as const satisfies ReadonlyArray<{ key: GlobeSource; label: string }>;

export default function FilterPanel() {
  const { showFilters, setShowFilters, filters, setFilters, setTimeRangeHours } = useStore();

  if (!showFilters) return null;

  const toggleCategory = (cat: Category) => {
    const current = filters.categories;
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    setFilters({ categories: next });
  };

  const toggleSeverity = (sev: Severity) => {
    const current = filters.severities;
    const next = current.includes(sev)
      ? current.filter((s) => s !== sev)
      : [...current, sev];
    setFilters({ severities: next });
  };

  const allCatsActive = CATEGORIES.every((c) => filters.categories.includes(c.key));
  const allSevsActive = SEVERITIES.every((s) => filters.severities.includes(s.key));
  const allSourcesActive = SOURCES.every((s) => filters.sources.includes(s.key));

  const toggleAllCats = () => {
    setFilters({ categories: allCatsActive ? [] : CATEGORIES.map((c) => c.key) });
  };

  const toggleAllSevs = () => {
    setFilters({ severities: allSevsActive ? [] : SEVERITIES.map((s) => s.key) });
  };

  const toggleSource = (source: GlobeSource) => {
    const next = filters.sources.includes(source)
      ? filters.sources.filter((s) => s !== source)
      : [...filters.sources, source];
    setFilters({ sources: next });
  };

  const toggleAllSources = () => {
    setFilters({ sources: allSourcesActive ? [] : SOURCES.map((s) => s.key) });
  };

  const setNewsLanguage = (code: string) => {
    setFilters({ newsLanguages: [code] });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        left: 16,
        width: 260,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 10,
        zIndex: 500,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #30363d',
          background: '#1c2333',
        }}
      >
        <span style={{ color: '#e6edf3', fontSize: 13, fontWeight: 600 }}>Event Filter</span>
        <button
          data-testid="filter-panel-close"
          onClick={() => setShowFilters(false)}
          style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '12px 14px', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
        {/* Categories */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Event Types
            </span>
            <button
              data-testid="filter-toggle-all-cats"
              onClick={toggleAllCats}
              style={{
                background: 'none',
                border: 'none',
                color: '#1f6feb',
                cursor: 'pointer',
                fontSize: 11,
                padding: 0,
              }}
            >
              {allCatsActive ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CATEGORIES.map(({ key, label, color, icon }) => {
              const active = filters.categories.includes(key);
              return (
                <button
                  key={key}
                  data-testid={`filter-cat-${key}`}
                  onClick={() => toggleCategory(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: active ? `${color}22` : '#0d1117',
                    border: `1px solid ${active ? color : '#30363d'}`,
                    borderRadius: 20,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    color: active ? color : '#6e7681',
                    fontSize: 11,
                    fontWeight: 500,
                    transition: 'all 0.12s ease',
                  }}
                >
                  <span style={{ fontSize: 10 }}>{icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Severity */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Severity
            </span>
            <button
              data-testid="filter-toggle-all-sevs"
              onClick={toggleAllSevs}
              style={{ background: 'none', border: 'none', color: '#1f6feb', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              {allSevsActive ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SEVERITIES.map(({ key, label, color }) => {
              const active = filters.severities.includes(key);
              return (
                <button
                  key={key}
                  data-testid={`filter-sev-${key}`}
                  onClick={() => toggleSeverity(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: active ? `${color}22` : '#0d1117',
                    border: `1px solid ${active ? color : '#30363d'}`,
                    borderRadius: 20,
                    padding: '4px 12px',
                    cursor: 'pointer',
                    color: active ? color : '#6e7681',
                    fontSize: 11,
                    fontWeight: 600,
                    transition: 'all 0.12s ease',
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: active ? color : '#30363d',
                      display: 'inline-block',
                    }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time range */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #21262d' }}>
          <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>
            Time Range
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIME_RANGES.map((t) => (
              <button
                key={t.label}
                data-testid={`filter-time-${t.label}`}
                onClick={() => setTimeRangeHours(t.hours)}
                style={{
                  background: filters.timeRangeHours === t.hours ? '#1f6feb22' : '#0d1117',
                  border: `1px solid ${filters.timeRangeHours === t.hours ? '#1f6feb' : '#30363d'}`,
                  borderRadius: 20,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  color: filters.timeRangeHours === t.hours ? '#58a6ff' : '#6e7681',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* News language */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #21262d' }}>
          <span
            style={{
              color: '#8b949e',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              display: 'block',
              marginBottom: 8,
            }}
          >
            News language
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {NEWS_LANGUAGES.map(({ code, label }) => {
              const active = filters.newsLanguages.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  data-testid={`filter-news-lang-${code}`}
                  onClick={() => setNewsLanguage(code)}
                  style={{
                    background: active ? '#1f6feb22' : '#0d1117',
                    border: `1px solid ${active ? '#1f6feb' : '#30363d'}`,
                    borderRadius: 20,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    color: active ? '#58a6ff' : '#6e7681',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p style={{ color: '#6e7681', fontSize: 10, margin: 0, lineHeight: 1.4 }}>
            Applies to news feeds. Default is English.
          </p>
        </div>

        {/* Sources */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #21262d' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Sources
            </span>
            <button
              onClick={toggleAllSources}
              style={{ background: 'none', border: 'none', color: '#1f6feb', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              {allSourcesActive ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SOURCES.map(({ key, label }) => {
              const active = filters.sources.includes(key);
              const isLiveua = key === 'liveuamap';
              const color = isLiveua ? '#f0883e' : '#58a6ff';
              return (
                <button
                  key={key}
                  onClick={() => toggleSource(key)}
                  style={{
                    background: active ? `${color}22` : '#0d1117',
                    border: `1px solid ${active ? color : '#30363d'}`,
                    borderRadius: 20,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    color: active ? color : '#6e7681',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
