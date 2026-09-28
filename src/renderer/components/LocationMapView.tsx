import React, { useState, useEffect } from 'react';

export interface PlaceResult {
  placeId: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface LocationMapViewProps {
  initialLocation?: string;
  onSelectLocation?: (locationName: string, coords?: { lat: number; lng: number }) => void;
  onClose: () => void;
  readOnly?: boolean;
}

export const LocationMapView: React.FC<LocationMapViewProps> = ({
  initialLocation = '',
  onSelectLocation,
  onClose,
  readOnly = false,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialLocation);
  const [activePlace, setActivePlace] = useState<PlaceResult | null>(null);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Search places using geocoding service
  async function handleSearch(query: string) {
    const q = query.trim();
    if (!q) return;
    setIsLoading(true);
    setSearchError(null);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Place search error (${response.status})`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const parsed: PlaceResult[] = data.map((item: any) => ({
          placeId: String(item.place_id || Math.random()),
          name: item.name || item.display_name.split(',')[0],
          displayName: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
        }));
        setResults(parsed);
        setActivePlace(parsed[0]);
      } else {
        setResults([]);
        setSearchError('No matching places found. Try a different place name or city.');
      }
    } catch (err: any) {
      console.warn('[LocationMapView] Geocoding lookup error:', err);
      // Fallback: create mock result from query string so user can still select it
      const fallbackPlace: PlaceResult = {
        placeId: 'manual',
        name: q,
        displayName: q,
        lat: 0,
        lng: 0,
      };
      setResults([fallbackPlace]);
      setActivePlace(fallbackPlace);
      setSearchError('Offline/Network restricted: using place query text directly.');
    } finally {
      setIsLoading(false);
    }
  }

  // Auto-search on mount if initialLocation is provided
  useEffect(() => {
    if (initialLocation.trim()) {
      handleSearch(initialLocation);
    }
  }, [initialLocation]);

  function handleSelectPlace(place: PlaceResult) {
    setActivePlace(place);
    setSearchQuery(place.name || place.displayName);
  }

  function handleConfirm() {
    if (!onSelectLocation) {
      onClose();
      return;
    }
    const finalName = activePlace ? activePlace.name || activePlace.displayName : searchQuery.trim();
    if (finalName) {
      onSelectLocation(
        finalName,
        activePlace && activePlace.lat !== 0 ? { lat: activePlace.lat, lng: activePlace.lng } : undefined
      );
    }
    onClose();
  }

  // Construct embedded map URL
  const mapUrl = activePlace && activePlace.lat !== 0 && activePlace.lng !== 0
    ? `https://maps.google.com/maps?q=${activePlace.lat},${activePlace.lng}&t=&z=15&ie=UTF8&iwloc=&output=embed`
    : searchQuery.trim()
    ? `https://maps.google.com/maps?q=${encodeURIComponent(searchQuery.trim())}&t=&z=14&ie=UTF8&iwloc=&output=embed`
    : null;

  const googleMapsWebUrl = activePlace && activePlace.lat !== 0 && activePlace.lng !== 0
    ? `https://www.google.com/maps/search/?api=1&query=${activePlace.lat},${activePlace.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery || 'recording location')}`;

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="location-map-modal">
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '820px', width: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🗺️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Track Location & Map Explorer
              </h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Cross-reference recording venue and place with interactive map
              </div>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close map modal">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
          {/* Search Bar */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                style={{ width: '100%', paddingLeft: '2rem' }}
                placeholder="Search place, studio, venue, or address (e.g. Abbey Road Studios, London)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch(searchQuery);
                  }
                }}
                data-testid="map-place-search-input"
                autoFocus
              />
              <span style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }}>
                🔍
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isLoading || !searchQuery.trim()}
              onClick={() => handleSearch(searchQuery)}
              data-testid="map-search-btn"
            >
              {isLoading ? 'Searching…' : 'Find Place'}
            </button>
          </div>

          {/* Quick presets */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Popular venues:</span>
            {[
              'Abbey Road Studios, London',
              'Electric Lady Studios, NY',
              'Red Rocks Amphitheatre, Colorado',
              'Sydney Opera House',
              'Central Park, NYC',
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                className="tag-suggestion-chip"
                style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                onClick={() => {
                  setSearchQuery(preset);
                  handleSearch(preset);
                }}
              >
                📍 {preset}
              </button>
            ))}
          </div>

          {searchError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.1)', padding: '6px 10px', borderRadius: '4px' }}>
              ℹ️ {searchError}
            </div>
          )}

          {/* Search Results list if multiple found */}
          {results.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '6px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Matching Places ({results.length}):
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                {results.map((res) => (
                  <button
                    key={res.placeId}
                    type="button"
                    style={{
                      background: activePlace?.placeId === res.placeId ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                      border: activePlace?.placeId === res.placeId ? '1px solid var(--accent-indigo)' : '1px solid transparent',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                    onClick={() => handleSelectPlace(res)}
                  >
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📍 {res.name}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      {res.displayName.split(',').slice(1, 3).join(',')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Embedded Map */}
          <div
            style={{
              flex: 1,
              minHeight: '280px',
              borderRadius: '8px',
              overflow: 'hidden',
              background: '#1a1d24',
              border: '1px solid var(--border-color)',
              position: 'relative',
            }}
          >
            {mapUrl ? (
              <iframe
                title="Location Map"
                src={mapUrl}
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: '280px', display: 'block' }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '280px', color: 'var(--text-muted)' }}>
                <span style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🗺️</span>
                <span>Type a place name above to view it on the map</span>
              </div>
            )}
          </div>

          {/* Selected Place Detail Bar */}
          {activePlace && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: '6px' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  📍 {activePlace.name}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {activePlace.displayName}
                </div>
                {activePlace.lat !== 0 && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                    Coords: {activePlace.lat.toFixed(5)}, {activePlace.lng.toFixed(5)}
                  </div>
                )}
              </div>
              <a
                href={googleMapsWebUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.72rem', padding: '3px 8px', textDecoration: 'none' }}
                title="Open location in external browser Google Maps"
              >
                Open in Browser ↗
              </a>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={!activePlace && !searchQuery.trim()}
              data-testid="confirm-location-btn"
            >
              ✓ Set as Track Location
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
