/**
 * FilterPanel — floating panel for event feed filters
 */
import { useStore } from '../store';
import type { GlobeSource } from '../../../src/types/globe';
import type { EventType } from '../data/events';
import type { RegionFilterKey } from '../lib/eventFilters';
import { EVENT_TYPE_FILTERS, REGION_FILTERS } from '../lib/eventFilters';

const EVENT_TYPES = EVENT_TYPE_FILTERS;
const REGIONS = REGION_FILTERS;

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
  { key: 'acled', label: 'ACLED' },
  { key: 'gdelt', label: 'GDELT' },
] as const satisfies ReadonlyArray<{ key: GlobeSource; label: string }>;

export default function FilterPanel() {
  const {
    showFilters,
    setShowFilters,
    filters,
    setFilters,
    setTimeRangeHours,
    selectedEvent,
    selectedTracker,
  } = useStore();

  if (!showFilters) return null;
  const leftOffset = selectedEvent ? 416 : selectedTracker ? 396 : 16;

  const toggleEventType = (eventType: EventType) => {
    const current = filters.eventTypes;
    const next = current.includes(eventType)
      ? current.filter((t) => t !== eventType)
      : [...current, eventType];
    setFilters({ eventTypes: next });
  };

  const toggleRegion = (region: RegionFilterKey) => {
    const current = filters.regions;
    const next = current.includes(region)
      ? current.filter((r) => r !== region)
      : [...current, region];
    setFilters({ regions: next });
  };

  const allTypesActive = EVENT_TYPES.every((t) => filters.eventTypes.includes(t));
  const allRegionsActive = REGIONS.every((r) => filters.regions.includes(r.key));
  const allSourcesActive = SOURCES.every((s) => filters.sources.includes(s.key));

  const toggleAllTypes = () => {
    setFilters({ eventTypes: allTypesActive ? [] : [...EVENT_TYPES] });
  };

  const toggleAllRegions = () => {
    setFilters({ regions: allRegionsActive ? [] : REGIONS.map((r) => r.key) });
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
        left: leftOffset,
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
              data-testid="filter-toggle-all-types"
              onClick={toggleAllTypes}
              style={{
                background: 'none',
                border: 'none',
                color: '#1f6feb',
                cursor: 'pointer',
                fontSize: 11,
                padding: 0,
              }}
            >
              {allTypesActive ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EVENT_TYPES.map((type) => {
              const active = filters.eventTypes.includes(type);
              const color = '#58a6ff';
              return (
                <button
                  key={type}
                  data-testid={`filter-type-${type.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => toggleEventType(type)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
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
                  {type}
                </button>
              );
            })}
          </div>
        </div>

        {/* Regions */}
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
              Regions
            </span>
            <button
              data-testid="filter-toggle-all-regions"
              onClick={toggleAllRegions}
              style={{ background: 'none', border: 'none', color: '#1f6feb', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              {allRegionsActive ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {REGIONS.map(({ key, label }) => {
              const active = filters.regions.includes(key);
              const color = '#d29922';
              return (
                <button
                  key={key}
                  data-testid={`filter-region-${key}`}
                  onClick={() => toggleRegion(key)}
                  style={{
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
              const color = '#58a6ff';
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
