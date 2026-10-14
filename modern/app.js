const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const NEWS_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MVR_URL = 'https://mvr.gov.mk/mk-MK/odnosi-so-javnost/bilteni';
const FIRMS_KEY_STORAGE = 'intel-prime-field-desk-firms-key';
const STORAGE_KEY = 'intel-prime-field-desk-evidence-v1';
const REFRESH_MS = 5 * 60 * 1000;
const $ = (selector) => document.querySelector(selector);
const mapStatus = $('#map-status');
const toast = $('#toast');
const evidenceDialog = $('#evidence-dialog');
let map;
let quakeLayer;
let evidenceLayer;
let fireLayer;
let aircraftLayer;
let streetLayer;
let satelliteLayer;
let earthquakes = [];
let fires = [];
let aircraft = [];
let evidence = [];
let pendingLocation = null;
let addingEvidence = false;
let editingEvidenceId = null;
let toastTimer;
let flightRefreshTimer;

function setMapStatus(message, isError = false) {
  mapStatus.textContent = message;
  mapStatus.classList.toggle('is-error', isError);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function formatTime(value) {
  if (!value) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(value) + ' UTC';
}

function formatAge(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

function setCount(element, count) {
  element.textContent = new Intl.NumberFormat().format(count);
}

function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([41.75, 22.2], 6);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
  });
  quakeLayer = L.layerGroup().addTo(map);
  evidenceLayer = L.layerGroup().addTo(map);
  fireLayer = L.layerGroup();
  aircraftLayer = L.layerGroup();
  map.on('zoomend moveend', () => {
    updateMapSummary();
    if ($('input[data-layer="aircraft"]').checked) {
      clearTimeout(flightRefreshTimer);
      flightRefreshTimer = setTimeout(loadAircraft, 1200);
    }
  });
  map.on('click', (event) => {
    if (!addingEvidence) return;
    addingEvidence = false;
    map.getContainer().style.cursor = '';
    pendingLocation = { lat: event.latlng.lat, lon: event.latlng.lng };
    $('#evidence-coordinates').textContent = `Location: ${pendingLocation.lat.toFixed(4)}, ${pendingLocation.lon.toFixed(4)}`;
    $('#evidence-dialog').showModal();
    $('#evidence-title').focus();
  });
  updateMapSummary();
  window.addEventListener('resize', () => map.invalidateSize());
}

function updateMapSummary() {
  $('#map-zoom').textContent = `${map.getZoom()}×`;
  const center = map.getCenter();
  $('#map-center').textContent = Math.abs(center.lat - 41.75) < 5 && Math.abs(center.lng - 22.2) < 6
    ? 'North Macedonia'
    : `${center.lat.toFixed(2)}°, ${center.lng.toFixed(2)}°`;
}

async function loadEarthquakes() {
  setMapStatus('Updating earthquake feed…');
  try {
    const response = await fetch(USGS_URL, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`USGS responded with ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error('USGS returned an unexpected feed format');
    earthquakes = data.features.map((feature) => {
      const [lon, lat, depth] = feature.geometry.coordinates;
      return {
        id: feature.id,
        lat,
        lon,
        depth,
        magnitude: feature.properties.mag,
        place: feature.properties.place || 'Location unavailable',
        time: feature.properties.time,
        url: feature.properties.url
      };
    }).filter((quake) => Number.isFinite(quake.lat) && Number.isFinite(quake.lon) && Number.isFinite(quake.magnitude));
    renderEarthquakes();
    $('#quake-updated').textContent = `USGS · updated ${formatTime(Date.now())}`;
    $('#last-updated').textContent = `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: 'UTC' }).format(Date.now())} UTC`;
    setMapStatus(`USGS feed updated · ${earthquakes.length} earthquakes in the past 24 hours`);
  } catch (error) {
    setMapStatus(`USGS feed unavailable: ${error.message}`, true);
    $('#quake-updated').textContent = 'Could not reach USGS';
    if (!earthquakes.length) {
      $('#activity-list').innerHTML = '<div class="empty-state"><p>The live feed is unavailable right now.</p><small>Check your connection or try refreshing in a few minutes.</small></div>';
    }
  }
}

async function loadFires() {
  try {
    const key = localStorage.getItem(FIRMS_KEY_STORAGE) || '';
    if (!key) {
      $('#fire-count').textContent = 'key';
      $('#fires-status').textContent = 'FIRMS is disconnected. Add a personal map key in this browser.';
      return;
    }
    $('#fires-status').textContent = 'Connecting to NASA FIRMS…';
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/13,35,46,50/VIIRS_SNPP_NRT/1`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`NASA FIRMS responded with ${response.status}`);
    const csv = await response.text();
    const lines = csv.trim().split(/\r?\n/);
    if (!lines[0]?.toLowerCase().includes('latitude,longitude')) throw new Error('NASA FIRMS returned an unexpected response');
    fires = lines.slice(1).map((line) => {
      const columns = line.split(',');
      return {
        lat: Number(columns[0]),
        lon: Number(columns[1]),
        brightness: Number(columns[2]),
        satellite: columns[5] || 'NASA FIRMS'
      };
    }).filter((fire) =>
      Number.isFinite(fire.lat) && Number.isFinite(fire.lon) &&
      Number.isFinite(fire.brightness) &&
      fire.lat >= 20 && fire.lat <= 55 && fire.lon >= 10 && fire.lon <= 65
    );
    renderFires();
    $('#fires-status').textContent = `Connected · ${fires.length} detections in the latest feed.`;
  } catch (error) {
    $('#fires-status').textContent = `FIRMS feed unavailable: ${error.message}`;
    if (!fires.length) $('#fire-count').textContent = 'error';
  }
}

function renderFires() {
  fireLayer.clearLayers();
  fires.forEach((fire) => {
    const marker = L.circleMarker([fire.lat, fire.lon], {
      radius: 5, color: '#d97835', fillColor: '#e79745', fillOpacity: 0.8, weight: 1
    });
    const popup = document.createElement('div');
    popup.className = 'evidence-popup';
    const title = document.createElement('strong');
    title.textContent = 'NASA FIRMS · Active fire';
    const detail = document.createElement('p');
    detail.textContent = `${fire.satellite} · Brightness ${Math.round(fire.brightness)} K · ${fire.lat.toFixed(3)}, ${fire.lon.toFixed(3)}`;
    popup.append(title, detail);
    marker.bindPopup(popup).addTo(fireLayer);
  });
  setCount($('#fire-count'), fires.length);
}

async function loadAircraft() {
  const bounds = map.getBounds();
  const params = new URLSearchParams({
    lamin: bounds.getSouth().toFixed(3),
    lomin: bounds.getWest().toFixed(3),
    lamax: bounds.getNorth().toFixed(3),
    lomax: bounds.getEast().toFixed(3)
  });
  $('#aircraft-status').textContent = 'Requesting current positions from OpenSky…';
  try {
    const response = await fetch(`https://opensky-network.org/api/states/all?${params}`, {
      cache: 'no-store', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`OpenSky responded with ${response.status}`);
    const data = await response.json();
    aircraft = (Array.isArray(data.states) ? data.states : []).map((state) => ({
      callsign: String(state[1] || '').trim() || 'Unknown aircraft',
      country: state[2] || 'Origin unavailable',
      lon: state[5],
      lat: state[6],
      altitude: state[7],
      onGround: state[8],
      velocity: state[9],
      track: state[10]
    })).filter((plane) => Number.isFinite(plane.lat) && Number.isFinite(plane.lon));
    renderAircraft();
    $('#aircraft-status').textContent = `OpenSky · ${aircraft.length} aircraft in the current view.`;
  } catch (error) {
    $('#aircraft-status').textContent = `Aircraft feed unavailable: ${error.message}`;
    if (!aircraft.length) $('#flight-count').textContent = 'error';
  }
}

function renderAircraft() {
  aircraftLayer.clearLayers();
  aircraft.forEach((plane) => {
    const icon = L.divIcon({
      className: 'aircraft-marker',
      html: `<span style="transform:rotate(${Number.isFinite(plane.track) ? plane.track : 0}deg)">✈</span>`,
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    });
    const marker = L.marker([plane.lat, plane.lon], { icon });
    const popup = document.createElement('div');
    popup.className = 'evidence-popup';
    const title = document.createElement('strong');
    title.textContent = plane.callsign;
    const detail = document.createElement('p');
    const altitude = Number.isFinite(plane.altitude) ? `${Math.round(plane.altitude)} m` : 'Altitude unavailable';
    const speed = Number.isFinite(plane.velocity) ? `${Math.round(plane.velocity * 3.6)} km/h` : 'Speed unavailable';
    detail.textContent = `${plane.country} · ${plane.onGround ? 'On ground' : altitude} · ${speed}`;
    popup.append(title, detail);
    marker.bindPopup(popup).addTo(aircraftLayer);
  });
  setCount($('#flight-count'), aircraft.length);
}

async function loadBulletins() {
  const list = $('#bulletin-list');
  $('#bulletin-status').textContent = 'Checking the official MVR index…';
  try {
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(MVR_URL)}`, {
      cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Bulletin source responded with ${response.status}`);
    const documentHtml = new DOMParser().parseFromString(await response.text(), 'text/html');
    const bulletins = [...documentHtml.querySelectorAll('a[href]')]
      .map((anchor) => {
        try {
          return {
            title: anchor.textContent.trim() || 'Official MVR bulletin',
            url: new URL(anchor.getAttribute('href'), MVR_URL).href
          };
        } catch {
          return null;
        }
      })
      .filter((item) => item && /\.pdf(?:$|\?)/i.test(item.url) && validSource(item.url))
      .slice(-12).reverse();
    if (!bulletins.length) throw new Error('No bulletin documents were found');
    list.replaceChildren(...bulletins.map((bulletin) => {
      const card = document.createElement('article');
      card.className = 'news-card';
      const link = document.createElement('a');
      link.href = bulletin.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      const title = document.createElement('h3');
      title.className = 'news-title';
      title.textContent = bulletin.title;
      const source = document.createElement('p');
      source.className = 'news-source';
      source.textContent = 'Official Ministry of Interior PDF';
      link.append(title, source);
      card.append(link);
      return card;
    }));
    $('#bulletin-status').textContent = `${bulletins.length} official documents`;
  } catch (error) {
    $('#bulletin-status').textContent = 'Official index unavailable';
    list.innerHTML = '<div class="empty-state"><p>Could not load the official bulletin list.</p><small>Use the official MVR link above to open the source directly.</small></div>';
  }
}

function renderEarthquakes() {
  quakeLayer.clearLayers();
  const visible = $('input[data-layer="earthquakes"]').checked;
  if (!visible) {
    $('#activity-list').innerHTML = '<div class="empty-state"><p>Earthquake layer is hidden.</p><small>Turn it back on to see recent USGS events.</small></div>';
    setCount($('#quake-count'), earthquakes.length);
    return;
  }
  earthquakes.forEach((quake) => {
    const color = quake.magnitude >= 5 ? '#d96855' : quake.magnitude >= 4 ? '#d79743' : '#668ea0';
    const marker = L.circleMarker([quake.lat, quake.lon], {
      radius: Math.min(13, Math.max(5, quake.magnitude * 2.2)),
      color,
      fillColor: color,
      fillOpacity: 0.38,
      weight: 1.5
    });
    const popup = document.createElement('div');
    popup.className = 'evidence-popup';
    const title = document.createElement('strong');
    title.textContent = `M${quake.magnitude.toFixed(1)} · ${quake.place}`;
    const detail = document.createElement('p');
    detail.textContent = `${formatTime(quake.time)} · Depth ${Math.round(quake.depth)} km`;
    const source = document.createElement('a');
    source.href = quake.url;
    source.target = '_blank';
    source.rel = 'noreferrer';
    source.textContent = 'View USGS details ↗';
    popup.append(title, detail, source);
    marker.bindPopup(popup);
    marker.addTo(quakeLayer);
  });
  setCount($('#quake-count'), earthquakes.length);
  $('#activity-list').replaceChildren(...earthquakes.slice(0, 35).map(createQuakeCard));
}

function createQuakeCard(quake) {
  const card = document.createElement('article');
  card.className = 'event-card';
  card.tabIndex = 0;
  const meta = document.createElement('div');
  meta.className = 'event-meta';
  const dot = document.createElement('i');
  dot.className = 'event-dot';
  dot.style.background = quake.magnitude >= 5 ? 'var(--red)' : quake.magnitude >= 4 ? 'var(--gold)' : '#668ea0';
  const time = document.createElement('span');
  time.textContent = formatAge(quake.time);
  meta.append(dot, time);
  const title = document.createElement('h3');
  title.className = 'event-title';
  title.textContent = `M${quake.magnitude.toFixed(1)} · ${quake.place}`;
  const detail = document.createElement('p');
  detail.className = 'event-detail';
  detail.textContent = `Depth ${Math.round(quake.depth)} km · ${formatTime(quake.time)}`;
  const open = () => {
    map.setView([quake.lat, quake.lon], Math.max(map.getZoom(), 7));
    quakeLayer.eachLayer((layer) => {
      if (layer.getLatLng?.().lat === quake.lat && layer.getLatLng?.().lng === quake.lon) layer.openPopup();
    });
  };
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  card.append(meta, title, detail);
  return card;
}

function readEvidence() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error('The saved evidence is not a list.');
    return records.filter((item) =>
      item && typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      typeof item.lat === 'number' && Number.isFinite(item.lat) &&
      typeof item.lon === 'number' && Number.isFinite(item.lon)
    );
  } catch (error) {
    showToast(`Could not read saved evidence: ${error.message}`);
    return [];
  }
}

function persistEvidence() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(evidence));
  } catch (error) {
    showToast(`Could not save evidence: ${error.message}`);
    return false;
  }
  renderEvidence();
  return true;
}

function renderEvidence() {
  evidenceLayer.clearLayers();
  const list = $('#evidence-list');
  const visible = $('input[data-layer="evidence"]').checked;
  setCount($('#evidence-count'), evidence.length);
  if (visible) evidence.forEach((item) => {
    const marker = L.circleMarker([item.lat, item.lon], {
      radius: 7, color: '#18856c', fillColor: '#18856c', fillOpacity: 0.86, weight: 2
    });
    const popup = document.createElement('div');
    popup.className = 'evidence-popup';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const notes = document.createElement('p');
    notes.textContent = item.notes || 'No notes added.';
    popup.append(title, notes);
    if (item.source) {
      const source = document.createElement('a');
      source.href = item.source;
      source.target = '_blank';
      source.rel = 'noreferrer';
      source.textContent = 'Open source ↗';
      popup.append(source, document.createElement('br'));
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'popup-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteEvidence(item.id));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'popup-edit';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openEditEvidence(item));
    const actions = document.createElement('div');
    actions.className = 'popup-actions';
    actions.append(edit, remove);
    popup.append(actions);
    marker.bindPopup(popup).addTo(evidenceLayer);
  });
  if (!evidence.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">◇</span><p>No evidence saved yet.</p><small>Choose “Add evidence”, then click a location on the map.</small></div>';
    return;
  }
  list.replaceChildren(...evidence.slice().sort((a, b) => b.createdAt - a.createdAt).map(createEvidenceCard));
}

function createEvidenceCard(item) {
  const card = document.createElement('article');
  card.className = 'evidence-card';
  const title = document.createElement('h3');
  title.className = 'evidence-title';
  title.textContent = item.title;
  const detail = document.createElement('p');
  detail.className = 'evidence-detail';
  detail.textContent = `${item.lat.toFixed(3)}, ${item.lon.toFixed(3)} · ${formatTime(item.createdAt)}`;
  const note = document.createElement('p');
  note.className = 'evidence-detail';
  note.textContent = item.notes || 'No notes';
  const remove = document.createElement('button');
  remove.className = 'evidence-remove';
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => deleteEvidence(item.id));
  const edit = document.createElement('button');
  edit.className = 'evidence-edit';
  edit.type = 'button';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => openEditEvidence(item));
  card.append(title, detail, note, edit, remove);
  if (item.source) {
    const source = document.createElement('a');
    source.className = 'evidence-source';
    source.href = item.source;
    source.target = '_blank';
    source.rel = 'noreferrer';
    source.textContent = 'Open source ↗';
    card.append(source);
  }
  card.addEventListener('click', (event) => {
    if (event.target === remove || event.target === edit || event.target.closest('a')) return;
    map.setView([item.lat, item.lon], Math.max(map.getZoom(), 9));
  });
  return card;
}

function deleteEvidence(id) {
  if (!confirm('Delete this evidence item from this browser?')) return;
  evidence = evidence.filter((item) => item.id !== id);
  if (persistEvidence()) showToast('Evidence deleted.');
}

function openEvidenceDialog() {
  editingEvidenceId = null;
  $('#evidence-dialog h2').textContent = 'Save map evidence';
  $('#evidence-form button[type="submit"]').textContent = 'Save evidence';
  addingEvidence = true;
  map.getContainer().style.cursor = 'crosshair';
  showToast('Click a location on the map to add evidence.');
}

function openEditEvidence(item) {
  pendingLocation = { lat: item.lat, lon: item.lon };
  editingEvidenceId = item.id;
  $('#evidence-title').value = item.title;
  $('#evidence-notes').value = item.notes || '';
  $('#evidence-source').value = item.source || '';
  $('#evidence-coordinates').textContent = `Location: ${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}`;
  $('#evidence-dialog h2').textContent = 'Edit saved evidence';
  $('#evidence-form button[type="submit"]').textContent = 'Save changes';
  evidenceDialog.showModal();
  $('#evidence-title').focus();
}

function closeEvidenceDialog() {
  evidenceDialog.close();
  pendingLocation = null;
  editingEvidenceId = null;
  $('#evidence-form').reset();
}

function exportEvidence() {
  const backup = {
    format: 'intel-prime-evidence',
    version: 1,
    exportedAt: new Date().toISOString(),
    points: evidence
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `intel-prime-evidence-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Evidence backup downloaded.');
}

async function importEvidence(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'intel-prime-evidence' || !Array.isArray(backup.points)) {
      throw new Error('This file is not an Intel Prime evidence backup.');
    }
    const imported = backup.points.filter((item) =>
      item && typeof item.title === 'string' &&
      typeof item.lat === 'number' && Number.isFinite(item.lat) &&
      typeof item.lon === 'number' && Number.isFinite(item.lon)
    ).map((item) => ({
      id: crypto.randomUUID(),
      title: item.title.slice(0, 120),
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 1000) : '',
      source: validSource(item.source) ? item.source : '',
      lat: item.lat,
      lon: item.lon,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    }));
    evidence = [...imported, ...evidence];
    if (persistEvidence()) showToast(`Imported ${imported.length} evidence item${imported.length === 1 ? '' : 's'}.`);
  } catch (error) {
    showToast(`Import failed: ${error.message}`);
  } finally {
    $('#import-file').value = '';
  }
}

function validSource(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-view').forEach((view) => {
    const active = view.id === `view-${name}`;
    view.classList.toggle('is-visible', active);
    view.hidden = !active;
  });
}

function renderNews(articles) {
  const list = $('#news-list');
  const valid = articles.filter((article) => article.title && validSource(article.url));
  if (!valid.length) {
    list.innerHTML = '<div class="empty-state"><p>No recent articles were returned.</p><small>Try again later; news availability depends on the public source.</small></div>';
    return;
  }
  list.replaceChildren(...valid.slice(0, 20).map((article) => {
    const card = document.createElement('article');
    card.className = 'news-card';
    const link = document.createElement('a');
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const title = document.createElement('h3');
    title.className = 'news-title';
    title.textContent = article.title;
    const source = document.createElement('p');
    source.className = 'news-source';
    source.textContent = [article.domain, article.seendate ? formatGdeltDate(article.seendate) : 'Recent public report'].filter(Boolean).join(' · ');
    link.append(title, source);
    card.append(link);
    return card;
  }));
}

function formatGdeltDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return match ? formatTime(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6])) : 'Recent public report';
}

async function loadNews() {
  const list = $('#news-list');
  const params = new URLSearchParams({
    query: '(Macedonia OR "North Macedonia" OR Skopje)',
    mode: 'artlist',
    format: 'json',
    maxrecords: '20',
    sort: 'datedesc'
  });
  try {
    const response = await fetch(`${NEWS_URL}?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`News source responded with ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.articles)) throw new Error('News source returned an unexpected response');
    renderNews(data.articles);
  } catch (error) {
    list.innerHTML = '<div class="empty-state"><p>News feed unavailable right now.</p><small>The public news service may be offline or blocking this request.</small></div>';
  }
}

async function searchLocation() {
  const input = $('#location-search');
  const query = input.value.trim();
  if (!query) return;
  input.blur();
  try {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Search responded with ${response.status}`);
    const places = await response.json();
    if (!places.length) {
      showToast('No matching place found.');
      return;
    }
    const place = places[0];
    map.setView([Number(place.lat), Number(place.lon)], 12);
  } catch (error) {
    showToast(`Place search unavailable: ${error.message}`);
  }
}

function updateClock() {
  $('#clock').textContent = `${new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(Date.now())} UTC`;
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.querySelectorAll('input[data-layer]').forEach((input) => input.addEventListener('change', () => {
    if (input.dataset.layer === 'earthquakes') renderEarthquakes();
    if (input.dataset.layer === 'evidence') renderEvidence();
    if (input.dataset.layer === 'fires') {
      if (input.checked) {
        map.addLayer(fireLayer);
        loadFires();
      } else {
        map.removeLayer(fireLayer);
      }
    }
    if (input.dataset.layer === 'aircraft') {
      if (input.checked) {
        map.addLayer(aircraftLayer);
        loadAircraft();
      } else {
        map.removeLayer(aircraftLayer);
        $('#aircraft-status').textContent = 'Aircraft layer is off.';
      }
    }
    const enabledCount = [...document.querySelectorAll('input[data-layer]')].filter((item) => item.checked).length;
    $('#layer-count').textContent = `${enabledCount} active`;
  }));
  $('#add-evidence').addEventListener('click', openEvidenceDialog);
  $('#refresh-feeds').addEventListener('click', () => {
    loadEarthquakes();
    if ($('input[data-layer="fires"]').checked) loadFires();
    if ($('input[data-layer="aircraft"]').checked) loadAircraft();
    if (!$('#view-news').hidden) loadNews();
    if (!$('#view-bulletins').hidden) loadBulletins();
  });
  $('#map-style').addEventListener('click', (event) => {
    const satellite = map.hasLayer(streetLayer);
    if (satellite) {
      map.removeLayer(streetLayer);
      satelliteLayer.addTo(map);
      event.currentTarget.textContent = 'Street';
    } else {
      map.removeLayer(satelliteLayer);
      streetLayer.addTo(map);
      event.currentTarget.textContent = 'Satellite';
    }
  });
  $('#refresh-news').addEventListener('click', loadNews);
  $('#refresh-bulletins').addEventListener('click', loadBulletins);
  $('#save-firms-key').addEventListener('click', () => {
    const key = $('#firms-key').value.trim();
    try {
      if (key) localStorage.setItem(FIRMS_KEY_STORAGE, key);
      else localStorage.removeItem(FIRMS_KEY_STORAGE);
    } catch (error) {
      showToast(`Could not save the FIRMS key: ${error.message}`);
      return;
    }
    showToast(key ? 'FIRMS key saved in this browser.' : 'FIRMS key removed.');
    if ($('input[data-layer="fires"]').checked) loadFires();
  });
  $('#location-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchLocation();
    }
  });
  $('#evidence-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingLocation) {
      closeEvidenceDialog();
      showToast('Choose a location on the map first.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const sourceText = String(form.get('source') || '').trim();
    if (sourceText && !validSource(sourceText)) {
      showToast('Source must be a valid HTTP or HTTPS URL.');
      return;
    }
    const updatedItem = {
      id: editingEvidenceId || crypto.randomUUID(),
      title: String(form.get('title')).trim(),
      notes: String(form.get('notes') || '').trim(),
      source: sourceText,
      lat: pendingLocation.lat,
      lon: pendingLocation.lon,
      createdAt: editingEvidenceId
        ? evidence.find((item) => item.id === editingEvidenceId)?.createdAt || Date.now()
        : Date.now()
    };
    if (editingEvidenceId) evidence = evidence.map((item) => item.id === editingEvidenceId ? updatedItem : item);
    else evidence.unshift(updatedItem);
    if (persistEvidence()) {
      const wasEditing = Boolean(editingEvidenceId);
      closeEvidenceDialog();
      activateTab('evidence');
      showToast(wasEditing ? 'Evidence updated.' : 'Evidence saved in this browser.');
    }
  });
  $('#close-dialog').addEventListener('click', closeEvidenceDialog);
  $('#cancel-dialog').addEventListener('click', closeEvidenceDialog);
  evidenceDialog.addEventListener('click', (event) => {
    if (event.target === evidenceDialog) closeEvidenceDialog();
  });
  evidenceDialog.addEventListener('close', () => {
    pendingLocation = null;
    editingEvidenceId = null;
    $('#evidence-form').reset();
  });
  $('#export-evidence').addEventListener('click', exportEvidence);
  $('#import-evidence').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) importEvidence(file);
  });
}

function start() {
  if (!window.L) {
    setMapStatus('Map library did not load. Check your connection and reload the page.', true);
    return;
  }
  initMap();
  evidence = readEvidence();
  renderEvidence();
  try {
    $('#firms-key').value = localStorage.getItem(FIRMS_KEY_STORAGE) || '';
  } catch (error) {
    $('#fires-status').textContent = `Browser storage is unavailable: ${error.message}`;
  }
  bindEvents();
  updateClock();
  loadEarthquakes();
  loadNews();
  loadBulletins();
  setInterval(updateClock, 15000);
  setInterval(loadEarthquakes, REFRESH_MS);
  setInterval(loadNews, REFRESH_MS);
  setInterval(loadBulletins, REFRESH_MS * 2);
  setInterval(() => {
    if ($('input[data-layer="fires"]').checked) loadFires();
    if ($('input[data-layer="aircraft"]').checked) loadAircraft();
  }, REFRESH_MS);
}

start();
