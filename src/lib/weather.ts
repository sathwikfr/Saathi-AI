/**
 * A one-line weather note for the parent's city on days that matter
 * ("It will be very hot today, around 42 degrees. Please drink plenty of water and stay indoors in the afternoon.").
 * Open-Meteo: free, no key (geocoding-api.open-meteo.com, api.open-meteo.com).
 * Never blocks a call: any failure or slow answer just means no note.
 */
export interface Forecast {
  maxC: number;
  minC: number;
  rainMm: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __carecircle_weather: Map<string, { at: number; f: Forecast | null }> | undefined;
}
const cache: Map<string, { at: number; f: Forecast | null }> = global.__carecircle_weather || new Map();
if (!global.__carecircle_weather) global.__carecircle_weather = cache;
const CACHE_MS = 3 * 3600000;

export async function geocodeCity(city: string, fetchImpl: typeof fetch = fetch): Promise<{ latitude: number; longitude: number; name: string } | null> {
  const q = city.trim();
  if (!q) return null;
  try {
    const res = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&countryCode=IN`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string }> };
    const r = data.results?.[0];
    return r ? { latitude: r.latitude, longitude: r.longitude, name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name } : null;
  } catch {
    return null;
  }
}

export async function todayForecast(lat: number, lon: number, now: Date, fetchImpl: typeof fetch = fetch): Promise<Forecast | null> {
  const day = new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${day}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.f;
  let f: Forecast | null = null;
  try {
    const res = await fetchImpl(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=1`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = (await res.json()) as { daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[] } };
    const d = data.daily;
    if (d?.temperature_2m_max?.length) {
      f = { maxC: d.temperature_2m_max[0], minC: d.temperature_2m_min?.[0] ?? d.temperature_2m_max[0], rainMm: d.precipitation_sum?.[0] ?? 0 };
    }
  } catch {
    f = null;
  }
  cache.set(key, { at: Date.now(), f });
  return f;
}

/** Only days worth mentioning get a note: heat, cold, heavy rain. Pure. */
export function weatherNote(f: Forecast | null): string | null {
  if (!f) return null;
  if (f.maxC >= 42) return `It will be extremely hot today, around ${Math.round(f.maxC)} degrees. Please drink plenty of water and stay indoors in the afternoon.`;
  if (f.maxC >= 39) return `It will be very hot today, around ${Math.round(f.maxC)} degrees. Please drink plenty of water.`;
  if (f.rainMm >= 30) return 'Heavy rain is expected today. Please take care, floors can be slippery.';
  if (f.minC <= 8) return `It will be cold today, down to ${Math.round(f.minC)} degrees. Please keep warm.`;
  return null;
}
