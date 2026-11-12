import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { AuditFilters, AuditSummary, DashboardWidget } from "../../../api/audit";
import { GRID_GAP, MIN_SIZE, ROW_HEIGHT, STACK_BELOW_PX, applyLayout, readingOrder } from "./gridLayout";
import type { FilterPatch } from "./interactions";
import WidgetView from "./WidgetView";

interface Props {
  widgets: DashboardWidget[];
  columns: number;
  summary: AuditSummary;
  /** Filtros da pagina, repassados aos visuais personalizados */
  filters?: AuditFilters;
  editing: boolean;
  /** Quem pode editar mas nao tem a permissao de mover ve o painel parado no modo de edicao */
  canMove?: boolean;
  /** Permissoes dos botoes de cada visual no modo de edicao */
  canConfigure?: boolean;
  canRemove?: boolean;
  onEditWidget?: (id: string) => void;
  onRemoveWidget?: (id: string) => void;
  /** Clicar num item de um visual pede este filtro a pagina (so fora do modo de edicao) */
  onFilterBy?: (patch: FilterPatch) => void;
  /** Chamado a cada mudanca de posicao ou tamanho (so no modo de edicao) */
  onChange: (widgets: DashboardWidget[]) => void;
}

/** O painel: visuais numa grade que se pode arrastar e redimensionar quando `editing`. */
export default function DashboardGrid({
  widgets,
  columns,
  summary,
  filters,
  editing,
  canMove = true,
  canConfigure = true,
  canRemove = true,
  onChange,
  onEditWidget,
  onRemoveWidget,
  onFilterBy,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();

  if (mounted && width < STACK_BELOW_PX) {
    return (
      <div ref={containerRef} className="dash-stack">
        {readingOrder(widgets).map((widget) => (
          <div key={widget.id} className="dash-item" style={{ height: widget.h * ROW_HEIGHT + (widget.h - 1) * GRID_GAP }}>
            <WidgetView widget={widget} summary={summary} filters={filters} editing={false} onFilterBy={onFilterBy} />
          </div>
        ))}
      </div>
    );
  }

  const layout: Layout = widgets.map((widget) => ({
    i: widget.id,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
    minW: MIN_SIZE[widget.type]?.w ?? 2,
    minH: MIN_SIZE[widget.type]?.h ?? 2,
  }));

  return (
    <div ref={containerRef} className={`dash-grid ${editing ? "dash-grid-editing" : ""}`}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: columns, rowHeight: ROW_HEIGHT, margin: [GRID_GAP, GRID_GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing && canMove, handle: ".dash-drag", cancel: ".dash-actions" }}
          resizeConfig={{ enabled: editing && canMove, handles: ["s", "e", "se"] }}
          onLayoutChange={(next) => editing && canMove && onChange(applyLayout(widgets, next))}
        >
          {widgets.map((widget) => (
            <div key={widget.id} className="dash-item">
              <WidgetView
                widget={widget}
                summary={summary}
                filters={filters}
                editing={editing}
                onEdit={canConfigure ? () => onEditWidget?.(widget.id) : undefined}
                onRemove={canRemove ? () => onRemoveWidget?.(widget.id) : undefined}
                onFilterBy={onFilterBy}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
