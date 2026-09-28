// The garage: the title screen's row showing your car, and the panel of cars it
// opens. Picking a card takes effect at once — the renderer reads garage.car every
// frame — and is remembered in neondrift:car. Unknown or missing ids are Neon.

import { $ } from "../core/dom.js";
import { read, write } from "../core/storage.js";
import { CARS, carById, drawCarShape, garage } from "../render/cars.js";

const KEY = "neondrift:car";
const PAPER = "#e8f0ff", ICE = "#2fe3ff";
const $row = $("garagebtn"), $rowCar = $("garagecar"), $rowName = $("garagename");
const $cards = $("garagecards");

garage.car = carById(read(KEY)).id;   // at import, so before main.js's first frame

// One car centred in a canvas, as large as fits with room for its glow. A hidden
// canvas measures 0×0 and is skipped; open() paints the panel once it shows.
function paint(cv, car) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const s = Math.min((w * 0.78) / (car.front - car.rear), (h * 0.7) / 24);
  c.translate(w / 2, h / 2); c.scale(s, s); c.translate(-(car.front + car.rear) / 2, 0);
  drawCarShape(c, car, { body: PAPER, glow: ICE, blur: 14 * dpr, details: true });
}

const cards = CARS.map(car => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "gcard"; b.dataset.car = car.id; b.setAttribute("data-pad", "");
  const cv = document.createElement("canvas"); cv.setAttribute("aria-hidden", "true");
  const name = document.createElement("span"); name.className = "gname"; name.textContent = car.name;
  const chassis = document.createElement("span"); chassis.className = "gchassis"; chassis.textContent = car.chassis;
  b.append(cv, name, chassis);
  b.addEventListener("click", e => { e.stopPropagation(); choose(car.id); });
  $cards.append(b);
  return { car, b, cv };
});

function refresh() {
  const car = carById(garage.car);
  $rowName.textContent = car.name;
  paint($rowCar, car);
  for (const k of cards) k.b.setAttribute("aria-pressed", String(k.car.id === car.id));
}

function choose(id) {
  garage.car = carById(id).id;
  write(KEY, garage.car);
  refresh();
}

export const garageOpen = () => document.body.classList.contains("garage");

function openGarage() {
  document.body.classList.add("garage");
  for (const k of cards) paint(k.cv, k.car);
  refresh();
}

export function closeGarage() {
  document.body.classList.remove("garage");
  refresh();   // the row was hidden while open; repaint it now it shows again
}

$row.addEventListener("click", e => { e.stopPropagation(); openGarage(); });
$("garagedone").addEventListener("click", e => { e.stopPropagation(); closeGarage(); });
addEventListener("keydown", e => { if (e.key === "Escape" && garageOpen()) closeGarage(); });
addEventListener("resize", () => {
  refresh();
  if (garageOpen()) for (const k of cards) paint(k.cv, k.car);
});
refresh();
