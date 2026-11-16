import * as pdfjsLib from "./vendor/pdf.min.mjs";

// Cambia esto si tu PDF tiene otro nombre.
const PDF_URL = "assets/revista.pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const scroller = $("scroller");
const counter = $("counter");
const loading = $("loading");

let urls = [];       // una imagen (blob) por página del PDF
let aspect = 0.7;    // ancho / alto de una página
let flip = null;     // instancia de PageFlip
let bookEl = null;   // contenedor del libro
let bookSizeNow = { width: 0, height: 0 };

/* ---------- Zoom ---------- */

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 2.5];
let zoomIdx = 1;
const zoom = () => ZOOMS[zoomIdx];

function updateZoomUI() {
  $("zlabel").textContent = Math.round(zoom() * 100) + "%";
  $("zin").disabled = zoomIdx === ZOOMS.length - 1;
  $("zout").disabled = zoomIdx === 0;
}

function setZoom(i) {
  const next = Math.max(0, Math.min(ZOOMS.length - 1, i));
  if (next === zoomIdx) return;
  zoomIdx = next;
  updateZoomUI();
  if (flip) mount(flip.getCurrentPageIndex());
}

$("zin").onclick = () => setZoom(zoomIdx + 1);
$("zout").onclick = () => setZoom(zoomIdx - 1);
updateZoomUI();

// Ctrl/Cmd + rueda (o pellizco en el trackpad) también acerca y aleja.
let wheelLock = false;
stage.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (wheelLock || Math.abs(e.deltaY) < 1) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 250);
    setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1));
  },
  { passive: false }
);

/* ---------- Pantalla completa (se activa de inmediato) ---------- */

const root = document.documentElement;
const requestFs = root.requestFullscreen || root.webkitRequestFullscreen;
const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
const fsButton = $("fs");

if (!requestFs) {
  // iPhone no permite pantalla completa en páginas web.
  fsButton.hidden = true;
} else {
  fsButton.onclick = () => {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) exitFs.call(document);
    else requestFs.call(root);
  };
}

function updateFsLabel() {
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  fsButton.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
}
document.addEventListener("fullscreenchange", updateFsLabel);
document.addEventListener("webkitfullscreenchange", updateFsLabel);

/* ---------- PDF a imágenes ---------- */

function showError(msg) {
  loading.innerHTML = `<div class="error">${msg}</div>`;
}

// Resolución de las imágenes: suficiente para que la página se vea nítida en
// pantallas de alta densidad, en pantalla completa y con algo de zoom.
function renderWidth() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const tallest = Math.max(screen.height || 0, window.innerHeight) - 110;
  const w = tallest * aspect * dpr * 1.6;
  return Math.round(Math.min(2000, Math.max(1000, w)));
}

async function renderPages(pdf) {
  const out = [];
  const targetWidth = renderWidth();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    out.push(URL.createObjectURL(blob));
    $("fill").style.width = Math.round((i / pdf.numPages) * 100) + "%";
    $("loading-text").textContent = `Preparando página ${i} de ${pdf.numPages}`;
    canvas.width = canvas.height = 0;
  }
  return out;
}

/* ---------- Libro ---------- */

function isPortrait() {
  return stage.clientWidth < 760;
}

function fitSize() {
  const availW = stage.clientWidth - 32;
  const availH = stage.clientHeight - 32;
  const pages = isPortrait() ? 1 : 2;
  let h = availH;
  let w = h * aspect;
  if (w * pages > availW) {
    w = availW / pages;
    h = w / aspect;
  }
  return { width: w, height: h };
}

function targetSize() {
  const f = fitSize();
  return { width: Math.floor(f.width * zoom()), height: Math.floor(f.height * zoom()) };
}

function mount(startIndex = 0) {
  if (flip) {
    try { flip.destroy(); } catch (e) { /* el libro anterior ya no existe */ }
  }

  bookEl = document.createElement("div");
  bookEl.id = "book";
  scroller.appendChild(bookEl);

  bookSizeNow = targetSize();
  flip = new St.PageFlip(bookEl, {
    width: bookSizeNow.width,
    height: bookSizeNow.height,
    size: "fixed",
    showCover: true,
    usePortrait: true,
    maxShadowOpacity: 0.4,
    mobileScrollSupport: zoom() > 1,
    flippingTime: 700,
  });

  // Modo HTML: las páginas son <img> normales, así el navegador las dibuja
  // a la resolución real de la pantalla y no se ven pixeladas.
  const pages = urls.map((u, i) => {
    const div = document.createElement("div");
    div.className = "page " + (i % 2 === 0 ? "page-right" : "page-left");
    const img = new Image();
    img.src = u;
    img.alt = "";
    img.draggable = false;
    div.appendChild(img);
    return div;
  });
  flip.loadFromHTML(pages);

  // Con zoom el libro puede ser más ancho que la pantalla: se fija su ancho
  // para que la librería no lo reduzca a una sola página.
  if (!isPortrait()) bookEl.style.width = bookSizeNow.width * 2 + "px";

  if (startIndex > 0) flip.turnToPage(startIndex);

  const total = urls.length;
  const local = flip; // si el libro se vuelve a montar, los eventos viejos se ignoran

  // Portada y contraportada se muestran solas y centradas.
  let busy = false;
  let settleTimer = null;

  const place = () => {
    if (local !== flip) return;
    const i = flip.getCurrentPageIndex();
    const portrait = isPortrait();
    let pos = "mid";
    if (!busy && !portrait) {
      if (i === 0) pos = "first";
      else if (i >= total - 1 && total % 2 === 0) pos = "last";
    }
    bookEl.dataset.pos = pos;
    bookEl.dataset.orient = portrait ? "portrait" : "landscape";
  };

  const updateCounter = () => {
    if (local !== flip) return;
    counter.textContent = `${flip.getCurrentPageIndex() + 1} / ${total}`;
  };

  flip.on("flip", () => {
    updateCounter();
    busy = true;
    place();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      busy = false;
      place();
    }, 900);
  });

  flip.on("changeState", (e) => {
    if (e.data === "flipping" || e.data === "user_fold") {
      busy = true;
      place();
    } else if (e.data === "read" && settleTimer === null) {
      busy = false;
      place();
    }
  });

  // Sin animación en la colocación inicial.
  bookEl.style.transition = "none";
  updateCounter();
  place();
  requestAnimationFrame(() => requestAnimationFrame(() => { bookEl.style.transition = ""; }));

  // Con zoom, empieza centrado.
  requestAnimationFrame(() => {
    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  });
}

// Si cambia el tamaño de la ventana (incluida la pantalla completa) se vuelve a
// montar el libro con el nuevo tamaño, sin recargar la página.
let resizeTimer;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!flip) return;
    const next = targetSize();
    const changed =
      Math.abs(next.width - bookSizeNow.width) > 3 ||
      Math.abs(next.height - bookSizeNow.height) > 3;
    if (changed) mount(flip.getCurrentPageIndex());
  }, 250);
}
window.addEventListener("resize", onResize);
document.addEventListener("fullscreenchange", onResize);
document.addEventListener("webkitfullscreenchange", onResize);

document.addEventListener("keydown", (e) => {
  if (!flip) return;
  if (e.key === "ArrowRight") flip.flipNext();
  else if (e.key === "ArrowLeft") flip.flipPrev();
  else if (e.key === "+" || e.key === "=") setZoom(zoomIdx + 1);
  else if (e.key === "-" || e.key === "_") setZoom(zoomIdx - 1);
  else if (e.key === "0") setZoom(1);
});
$("prev").onclick = () => flip && flip.flipPrev();
$("next").onclick = () => flip && flip.flipNext();

async function init() {
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ url: PDF_URL }).promise;
  } catch (e) {
    showError(
      "No se pudo abrir el PDF. Revisa que <code>assets/revista.pdf</code> exista " +
      "y que abras el sitio desde un servidor (GitHub Pages), no con doble clic."
    );
    console.error(e);
    return;
  }

  const first = await pdf.getPage(1);
  const v = first.getViewport({ scale: 1 });
  aspect = v.width / v.height;

  urls = await renderPages(pdf);
  mount(0);
  loading.remove();
}

init();
