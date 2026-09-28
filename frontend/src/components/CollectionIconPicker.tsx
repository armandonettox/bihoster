import CollectionIcon from "./CollectionIcon";

export const COLLECTION_ICONS = [
  "folder",
  "dataset",
  "insights",
  "monitoring",
  "dashboard",
  "bar_chart",
  "pie_chart",
  "trending_up",
  "table_chart",
  "storage",
  "database",
  "analytics",
  "description",
  "assignment",
  "business",
  "apartment",
  "account_balance",
  "groups",
  "support_agent",
  "local_hospital",
  "health_and_safety",
  "medical_services",
  "biotech",
  "science",
  "school",
  "psychology",
  "campaign",
  "shopping_cart",
  "inventory_2",
  "receipt_long",
];

export const COLLECTION_COLORS = [
  "#1E3A6B",
  "#5B9BD5",
  "#00B4A6",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#D97706",
  "#16A34A",
  "#0891B2",
  "#475569",
  "#171717",
];

export default function CollectionIconPicker({
  name,
  icon,
  color,
  onChangeIcon,
  onChangeColor,
}: {
  name: string;
  icon: string | null;
  color: string | null;
  onChangeIcon: (icon: string | null) => void;
  onChangeColor: (color: string | null) => void;
}) {
  return (
    <div className="icon-picker">
      <div className="icon-picker-preview">
        <CollectionIcon name={name || "?"} icon={icon} color={color} size={40} />
      </div>

      <div className="icon-picker-body">
        <p className="icon-picker-label">Cor</p>
        <div className="icon-picker-colors">
          {COLLECTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`icon-picker-color ${color === c ? "icon-picker-color-active" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => onChangeColor(c)}
              title={c}
            />
          ))}
        </div>

        <p className="icon-picker-label">Icone (opcional -- sem icone usa as iniciais)</p>
        <div className="icon-picker-icons">
          <button
            type="button"
            className={`icon-picker-icon ${!icon ? "icon-picker-icon-active" : ""}`}
            onClick={() => onChangeIcon(null)}
            title="Usar iniciais"
          >
            {(name || "?").slice(0, 2).toUpperCase()}
          </button>
          {COLLECTION_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              className={`icon-picker-icon material-symbols-outlined ${icon === i ? "icon-picker-icon-active" : ""}`}
              onClick={() => onChangeIcon(i)}
              title={i}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
