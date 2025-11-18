import './style.css'
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

const fetchAndDisplayLocations = async (map) => {
  try {
    const records = await pb.collection('locations').getFullList();
    for (const record of records) {
      const coordinates = record.coordinates;
      const name = record.name;
      const lon = coordinates.lon;
      const lat = coordinates.lat;
      if (isNaN(lat) || isNaN(lon)) continue;
      L.marker([lat, lon]).bindPopup(`<b>${name || 'Unknown'}</b>`).addTo(map);
    }
  } catch (err) {
    console.error('Error fetching locations:', err);
  }
}

const initializeMap = () => {
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Chri' // OpenStreetMap contributors
  });

  const osmHOT = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Chri' // OpenStreetMap contributors
  });

  const Esri_WorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Chri' // Esri contributors
  });

  const map = L.map('map', {
    center: [0,0],
    zoom: 2,
    layers: [Esri_WorldImagery]
  });

  const baseMaps = {
    "OpenStreetMap": osm,
    "OpenStreetMap.HOT": osmHOT,
    "Esri_WorldImagery": Esri_WorldImagery
  };

  L.control.layers(baseMaps).addTo(map);
  return map;
}

var map = initializeMap();

fetchAndDisplayLocations(map);

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Geocode error: ${res.status}`);
    const data = await res.json();
    return data.display_name || (data.address && (data.address.city || data.address.town || data.address.village || data.address.county || data.address.state)) || null;
  } catch (err) {
    console.error('reverseGeocode error:', err);
    return null;
  }
}

map.on('click', async (e) => {
  const { lat, lng } = e.latlng;

  // Temp
  L.popup()
    .setLatLng(e.latlng)
    .setContent('Looking up place...')
    .openOn(map);

  try {
    const name = await reverseGeocode(lat, lng) || 'Unknown';

    await pb.collection('locations').create({
      name,
      coordinates: { lon: Number(lng), lat: Number(lat) }
    });

    L.marker([lat, lng]).bindPopup(`<b>${name}</b>`).addTo(map).openPopup();
  } catch (err) {
    console.error('Error during reverse geocoding or saving:', err);
    try {
      await pb.collection('locations').create({ name: 'Unknown', coordinates: { lon: Number(lng), lat: Number(lat) } });
      L.marker([lat, lng]).bindPopup(`<b>Unknown</b>`).addTo(map);
    } catch (err2) {
      console.error('Error saving fallback record:', err2);
    }
  }
});

