import { t } from './i18n.mjs';

export const projectionSites = [
  {
    id: 'minin', guide: 'Кузьма Минин', place: 'Площадь Минина и Пожарского',
    coords: [56.326997, 44.006961],
    location: 'Площадь или ближайший участок кремлёвской стены',
    story: 'Земский староста расскажет, как в 1611 году нижегородцы собирали деньги и имущество для ополчения и почему для города это было трудным решением.',
  },
  {
    id: 'chkalov', guide: 'Валерий Чкалов', place: 'Чкаловская лестница',
    coords: [56.330091, 44.008924],
    location: 'Стена кремля в районе истребителя',
    story: 'Лестницу начали строить в 1943 году в честь победы под Сталинградом и открыли в 1949-м. В рассказе её восьмёрка напоминает лётчику петлю в небе.',
  },
  {
    id: 'gorodovoy', guide: 'Городовой', place: 'Большая Покровская улица',
    coords: [56.317288, 43.995413],
    location: 'Базовая точка. Точное место выберет администрация',
    story: 'Городовой расскажет о старых постах, о том, как менялись улицы от кремля до причалов и что от прежнего Нижнего можно увидеть сегодня.',
  },
  {
    id: 'popov', guide: 'Александр Попов', place: 'Нижегородская радиолаборатория',
    coords: [56.329342, 44.013937],
    location: 'Район музея на Верхне-Волжской набережной',
    story: 'Попов расскажет о демонстрации приёмника в 1895 году. История продолжится в лаборатории, которая начала работу в Нижнем Новгороде в 1918 году, уже после его смерти.',
  },
  {
    id: 'gorky', guide: 'Максим Горький', place: 'Музей-квартира Горького',
    coords: [56.3228, 44.01851],
    location: 'Улица Семашко, 19',
    story: 'Горький вспомнит, как вернулся в родной город и где работал над пьесой «На дне». В доме на Семашко он жил с семьёй с 1902 по 1904 год.',
  },
];

export function openCoordinates(site) {
  const [lat, lon] = site.coords;
  return `https://yandex.ru/maps/?ll=${lon},${lat}&pt=${lon},${lat}&z=18`;
}

const layers = {
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri</a>, Vantor, Earthstar Geographics, GIS User Community',
  },
};

export async function mountProjectionMap(container, {
  site, initialView, onViewChange, onSelect, onTileStatus = () => {}, signal,
}) {
  const {default: L} = await import('./vendor/leaflet/leaflet.mjs');
  if (signal.aborted) return;
  const map = L.map(container, {
    minZoom: 11, maxZoom: 19, zoomSnap: .5, zoomControl: false,
    scrollWheelZoom: false, dragging: !site, touchZoom: !site, doubleClickZoom: !site,
    keyboard: !site, maxBounds: [[56.235, 43.79], [56.425, 44.23]],
  });
  map.attributionControl.setPrefix(false);
  if (!site) {
    const zoom = L.control.zoom({position: 'topleft', zoomInTitle: t('Приблизить'), zoomOutTitle: t('Отдалить')}).addTo(map);
    for (const button of zoom.getContainer().querySelectorAll('a')) {
      let release;
      // Keep the pressed face visible after even the shortest tap.
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        clearTimeout(release);
        button.classList.add('zoom-pressed');
        release = setTimeout(() => button.classList.remove('zoom-pressed'), 140);
      }, {capture: true, signal});
      signal.addEventListener('abort', () => clearTimeout(release), {once: true});
    }
  }
  L.imageOverlay('./assets/route-map.webp', [[56.300,43.935],[56.350,44.075]], {
    pane: 'tilePane', zIndex: 0,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const cityBounds = L.latLngBounds(projectionSites.map(site => site.coords));
  function fitAll() {
    map.fitBounds(cityBounds, {paddingTopLeft: [40, 78], paddingBottomRight: [40, 43], maxZoom: 15, animate: false});
  }
  if (site) map.setView(site.coords, 16);
  else if (initialView) map.setView(initialView.center, initialView.zoom);
  else fitAll();
  if (onViewChange) {
    map.on('moveend', () => onViewChange({center: map.getCenter(), zoom: map.getZoom()}));
  }

  const markers = (site ? [site] : projectionSites).map((point, index) => {
    const title = t(point.place) + ' · ' + t(point.guide);
    const marker = L.marker(point.coords, {
      title,
      icon: L.divIcon({
        className: 'projection-pin',
        html: '<img alt="" src="./assets/guide-portraits/' + point.id + '.webp">',
        iconSize: [44,44], iconAnchor: [22,22],
      }),
      riseOnHover: true,
      keyboard: !site, interactive: !site, autoPanOnFocus: false,
    }).addTo(map);
    const element = marker.getElement();
    element.dataset.site = point.id;
    if (onSelect) {
      element.setAttribute('aria-label', title);
      marker.on('click', () => onSelect(index));
      element.addEventListener('keydown', event => {
        if (event.key !== ' ') return;
        event.preventDefault();
        if (!event.repeat) onSelect(index);
      }, { signal });
    }
    return marker;
  });


  let activeLayer;
  let activeKind;
  function setLayer(kind) {
    if (kind === activeKind) return;
    activeLayer?.remove();
    activeKind = kind;
    onTileStatus('');
    const info = layers[kind];
    // The station uses no-referrer by default. Set the required Origin referrer on OSM tile images.
    const tileLayer = L.tileLayer(info.url, {
      attribution: info.attribution, maxZoom: 19, zIndex: 1,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    let loaded = 0;
    let errors = 0;
    tileLayer.on('loading', () => { loaded = 0; errors = 0; onTileStatus(''); });
    tileLayer.on('tileload', () => { loaded++; });
    tileLayer.on('tileerror', () => { errors++; });
    tileLayer.on('load', () => {
      if (tileLayer !== activeLayer || !errors || loaded) return;
      onTileStatus(t(kind === 'satellite'
        ? 'Спутниковые снимки сейчас недоступны. Показана схема центра.'
        : 'Онлайн-слой недоступен. Показана схема центра.'));
    });
    activeLayer = tileLayer;
    tileLayer.addTo(map);
  }

  const resize = new ResizeObserver(() => map.invalidateSize({pan: false}));
  resize.observe(container);
  signal.addEventListener('abort', () => {
    resize.disconnect();
    map.remove();
  }, {once:true});
  return {
    setLayer,
    highlight(id) {
      markers.forEach(marker => {
        const element = marker.getElement();
        const selected = element.dataset.site === id;
        marker.setZIndexOffset(selected ? 300 : 0);
        element.classList.toggle('is-current', selected);
      });
    },
  };
}
