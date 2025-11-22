import './style.css'
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

function getColorForTemp(temp) {
  if (temp === null || typeof temp === 'undefined' || isNaN(Number(temp))) return '#AAAAAA';
  const t = Number(temp);
  if (t < 0) return '#0074D9';
  if (t >= 0 && t <= 10) return '#2ECC40';
  if (t > 10 && t <= 20) return '#FFDC00';
  if (t > 20) return '#FF4136';
  return '#AAAAAA';
}

const fetchAndDisplayLocations = async (map) => {
  try {
    const records = await pb.collection('locations').getFullList();
    locationsLayer.clearLayers();
    for (const record of records) {
      const coordinates = record.coordinates;
      if (!coordinates) continue;
      const lon = Number(coordinates.lon);
      const lat = Number(coordinates.lat);
      if (isNaN(lat) || isNaN(lon)) continue;
      const name = record.name || 'Unknown';
      const temp = (typeof record.temperature !== 'undefined' && record.temperature !== null) ? record.temperature : null;
      const popupContent = `<b>${name}</b>${temp !== null ? `<br>Temperature: ${temp} °C` : ''}`;
      const color = getColorForTemp(temp);
      console.log(color, temp);
      L.circle([lat, lon], { radius: 10000, color: color, fillColor: color, weight: 1, fillOpacity: 0.5 }).bindPopup(popupContent).addTo(locationsLayer);
    }
    updateStats(records);
  } catch (err) {
    console.error('Error fetching locations:', err);
  }
}

function updateStats(records) {
  try {
    const count = records.length;
    const temps = records.map(r => (typeof r.temperature !== 'undefined' && r.temperature !== null) ? Number(r.temperature) : null).filter(t => !isNaN(t));
    const avg = temps.length ? (temps.reduce((a,b) => a+b,0)/temps.length) : null;
    const max = temps.length ? Math.max(...temps) : null;
    const min = temps.length ? Math.min(...temps) : null;

    const elCount = document.getElementById('stat-count');
    const elAvg = document.getElementById('stat-avg');
    const elMax = document.getElementById('stat-max');
    const elMin = document.getElementById('stat-min');

    if (elCount) elCount.textContent = String(count);
    if (elAvg) elAvg.textContent = avg !== null ? (Math.round(avg*10)/10).toString() + ' °C' : '—';
    if (elMax) elMax.textContent = max !== null ? String(max) + ' °C' : '—';
    if (elMin) elMin.textContent = min !== null ? String(min) + ' °C' : '—';
  } catch (err) {
    console.error('updateStats error:', err);
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

const locationsLayer = L.layerGroup().addTo(map);

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

async function fetchCurrentWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current_weather=true&timezone=auto`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();
    if (data && data.current_weather && typeof data.current_weather.temperature !== 'undefined') {
      return data.current_weather.temperature;
    }
    return null;
  } catch (err) {
    console.error('fetchCurrentWeather error:', err);
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

    const temperature = await fetchCurrentWeather(lat, lng);

    await pb.collection('locations').create({
      name,
      coordinates: { lon: Number(lng), lat: Number(lat) },
      temperature: temperature !== null ? Number(temperature) : null
    });

    const popupContent = `<b>${name}</b>${temperature !== null ? `<br>Temperature: ${temperature} °C` : ''}`;
    await fetchAndDisplayLocations(map);
    L.popup().setLatLng([lat, lng]).setContent(popupContent).openOn(map);
  } catch (err) {
    console.error('Error during reverse geocoding or saving:', err);
    try {
      const temperatureFallback = await fetchCurrentWeather(lat, lng);
      await pb.collection('locations').create({ name: 'Unknown', coordinates: { lon: Number(lng), lat: Number(lat) }, temperature: temperatureFallback !== null ? Number(temperatureFallback) : null });
      const popupContentFallback = `<b>Unknown</b>${temperatureFallback !== null ? `<br>Temperature: ${temperatureFallback} °C` : ''}`;
      await fetchAndDisplayLocations(map);
      L.popup().setLatLng([lat, lng]).setContent(popupContentFallback).openOn(map);
    } catch (err2) {
      console.error('Error saving fallback record:', err2);
    }
  }
});
