const DEFAULT_COLOR = "#1E3A6B";

export default function CollectionIcon({
  name,
  icon,
  color,
  size = 22,
}: {
  name: string;
  icon?: string | null;
  color?: string | null;
  size?: number;
}) {
  const background = color || DEFAULT_COLOR;
  const style = {
    width: size,
    height: size,
    backgroundColor: background,
    fontSize: icon ? Math.round(size * 0.6) : Math.round(size * 0.4),
  };

  return (
    <span className="collection-icon" style={style}>
      {icon ? (
        <span className="material-symbols-outlined" style={{ fontSize: style.fontSize }}>
          {icon}
        </span>
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
