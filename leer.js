import * as pdfjsLib from "./vendor/pdf.min.mjs";

// Cambia esto si tu PDF tiene otro nombre.
const PDF_URL = "assets/revista.pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const bookEl = $("book");
const counter = $("counter");
const loading = $("loading");

function showError(msg) {
  loading.innerHTML = `<div class="error">${msg}</div>`;
}

async function renderPages(pdf) {
  const urls = [];
  // Resolución de render: suficiente para pantallas retina sin disparar la memoria.
  const targetWidth = Math.min(1400, Math.round(window.innerHeight * 1.2 * (window.devicePixelRatio || 1)));
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvas }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    urls.push(URL.createObjectURL(blob));
    $("fill").style.width = Math.round((i / pdf.numPages) * 100) + "%";
    $("loading-text").textContent = `Preparando página ${i} de ${pdf.numPages}`;
    canvas.width = canvas.height = 0;
  }
  return urls;
}

function bookSize(aspect) {
  // aspect = ancho / alto de una página
  const availW = stage.clientWidth - 32;
  const availH = stage.clientHeight - 32;
  const portrait = stage.clientWidth < 760;
  const spreadFactor = portrait ? 1 : 2;
  let h = availH;
  let w = h * aspect;
  if (w * spreadFactor > availW) {
    w = availW / spreadFactor;
    h = w / aspect;
  }
  return { width: Math.floor(w), height: Math.floor(h) };
}

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
  const aspect = v.width / v.height;

  const urls = await renderPages(pdf);

  const { width, height } = bookSize(aspect);
  const flip = new St.PageFlip(bookEl, {
    width,
    height,
    size: "fixed",
    showCover: true,
    usePortrait: true,
    maxShadowOpacity: 0.4,
    mobileScrollSupport: false,
    flippingTime: 700,
  });
  flip.loadFromImages(urls);

  const total = urls.length;
  const update = () => {
    const p = flip.getCurrentPageIndex() + 1;
    counter.textContent = `${p} / ${total}`;
  };
  flip.on("flip", update);
  flip.on("init", update);
  update();

  // En la portada y la contraportada el libro se muestra de una sola página, centrada.
  const placeBook = (settled = false) => {
    const portrait = flip.getOrientation() === "portrait";
    const i = flip.getCurrentPageIndex();
    let pos = "mid";
    if (!portrait && (settled === true || flip.getState() === "read")) {
      if (i === 0) pos = "first";
      else if (i >= total - 1 && total % 2 === 0) pos = "last";
    }
    bookEl.dataset.pos = pos;
  };
  flip.on("changeState", () => placeBook());
  let settleTimer;
  flip.on("flip", () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => placeBook(), 850);
  });
  flip.on("init", () => placeBook());
  placeBook();

  loading.remove();

  $("prev").onclick = () => flip.flipPrev();
  $("next").onclick = () => flip.flipNext();
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") flip.flipNext();
    if (e.key === "ArrowLeft") flip.flipPrev();
  });

  $("fs").onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  // Si cambia el tamaño de la ventana, se recarga el lector para reajustar el libro.
  let t;
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) > 40) location.reload();
    }, 400);
  });
}

init();
