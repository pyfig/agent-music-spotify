import { theme } from "./theme";

// Плавный градиент на tiny-шрифте штатно невозможен: массив color у
// <ascii-font> индексируется по цветовым слоям шрифта (у tiny слой один),
// а не по буквам. Поэтому рендерим каждую букву отдельным <ascii-font>
// со своим цветом. gap: 1 совпадает с letterspace_size шрифта tiny.
function lerpHex(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

const TEXT = "music-agent";

export function Logo() {
  const chars = [...TEXT];
  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      {chars.map((c, i) => (
        <ascii-font
          key={i}
          text={c}
          font="tiny"
          style={{
            color: lerpHex(theme.accent, theme.green, i / (chars.length - 1)),
          }}
        />
      ))}
    </box>
  );
}
