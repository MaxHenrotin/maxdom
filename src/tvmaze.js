const BASE = 'https://api.tvmaze.com';
const MAX_RETRIES = 3;

export async function tvmazeGet(path, retryDelayMs = 2000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`);
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TVmaze ${path}: HTTP ${res.status}`);
    return res.json();
  }
}

export function toShowRow(json) {
  return {
    id: json.id,
    name: json.name,
    status: json.status,
    image_url: json.image?.medium ?? null,
    premiered_year: json.premiered ? Number(json.premiered.slice(0, 4)) : null,
    tvmaze_updated: json.updated,
  };
}

// Specials have a null number; the app only tracks regular episodes.
export function toEpisodeRows(json) {
  return json._embedded.episodes
    .filter((ep) => ep.number !== null)
    .map((ep) => ({
      id: ep.id,
      show_id: json.id,
      season: ep.season,
      number: ep.number,
      name: ep.name,
      airdate: ep.airdate || null,
      runtime: ep.runtime,
    }));
}
