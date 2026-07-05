// Порт математики ASCII-бублика (Andy Sloane / Lex Fridman donut)
// https://github.com/sherwinvishesh/ASCII-Donut-Animation
// Превращение: C++ → TypeScript. Цвет не here — он задаётся через fg <text>.
// Палитра `".,-~:;=!*#$@"` отражает яркость (от тёмного к светлому).

const PALETTE = ".,-~:;=!*#$@";
const R1 = 1;
const R2 = 2;
const K2 = 5;
const K1 = K2 / (R1 + R2) * 2;

const TWO_PI = Math.PI * 2;

// Рисует один кадр бублика под заданные размеры (w × h символов).
// A, B — углы поворота (накапливаются со временем).
// Возвращает массив из h строк длиной ≤ w.
export function renderDonutFrame(A: number, B: number, w: number, h: number): string[] {
  // Выходные размерности: терминальная клетка ~2:1, компенсируем.
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.22;
  const ry = h * 0.65;

  const size = w * h;
  const chars = new Array<string>(size).fill(" ");
  const z = new Float32Array(size);

  const cosA = Math.cos(A), sinA = Math.sin(A);
  const cosB = Math.cos(B), sinB = Math.sin(B);

  // Шаги как в оригинале: j по 0.07 (~90), i по 0.02 (~314) = ~28k итераций.
  for (let j = 0; j < TWO_PI; j += 0.07) {
    const cosj = Math.cos(j), sinj = Math.sin(j);
    const hj = cosj + 2; // смещение центра бублика
    for (let i = 0; i < TWO_PI; i += 0.02) {
      const cosi = Math.cos(i), sini = Math.sin(i);

      // Глубина D = 1 / (z-составляющая + 5)
      const t = sini * hj;
      const D = 1 / (t * sinA + sinj * cosA + 5);

      // Поворот вокруг осей A (наклон) и B (вращение)
      const l = cosi;
      const m = cosj;
      const cosi_hj = l * hj;
      const nx = cosi_hj * cosB - (t * cosA - sinj * sinA) * sinB;
      const ny = cosi_hj * sinB + (t * cosA - sinj * sinA) * cosB;

      // Координаты на экране
      const x = Math.round(cx + rx * D * nx);
      const y = Math.round(cy + ry * D * ny);

      if (x < 0 || x >= w || y < 0 || y >= h) continue;

      const o = x + w * y;

      // Яркость N: проекция нормали на источник света
      const N =
        8 *
        ((sinj * sinA - sini * cosj * cosA) * cosB -
          sini * cosj * sinA -
          sinj * cosA -
          l * cosj * sinB);

      const curZ = z[o] ?? 0;
      if (D > curZ) {
        z[o] = D;
        const idx = N > 0 ? Math.min(Math.floor(N), PALETTE.length - 1) : 0;
        chars[o] = PALETTE[idx] ?? " ";
      }
    }
  }

  // Собираем строки, обрезаем trailing пробелы — иначе OpenTUI может
  // растянуть box по ширине и сломать выравнивание.
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) line += chars[x + w * y];
    out.push(line.replace(/\s+$/, ""));
  }
  // Срезаем общий leading-отступ: иначе блок включает пустое поле слева и
  // центрирование родителем уводит бублик вправо от середины.
  const indents = out.filter((l) => l.length > 0).map((l) => l.match(/^ */)![0].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return out.map((l) => l.slice(minIndent));
}