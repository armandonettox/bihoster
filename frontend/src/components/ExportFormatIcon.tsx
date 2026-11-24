export type ExportFormatKind = "xlsx" | "PPTX" | "PDF" | "PNG";

/** Logo de cada formato da janela Exportar, no estilo do menu de exportar do Power BI: Excel (verde), PowerPoint
 * (laranja), PDF (documento vermelho) e imagem. Desenhados aqui mesmo, sem arquivo de imagem. */
export default function ExportFormatIcon({ kind }: { kind: ExportFormatKind }) {
  const common = { width: 28, height: 28, viewBox: "0 0 28 28", "aria-hidden": true, className: "export-format-icon" } as const;

  if (kind === "xlsx") {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="24" height="22" rx="3" fill="#21a366" />
        <rect x="14" y="3" width="12" height="22" rx="3" fill="#33c481" opacity="0.45" />
        <rect x="2" y="7" width="13" height="14" rx="2" fill="#107c41" />
        <path d="M5.8 10.5h2.4l1.3 2.3 1.3-2.3h2.4l-2.5 3.5 2.6 3.5h-2.4l-1.4-2.4-1.4 2.4H5.7l2.6-3.5z" fill="#fff" />
      </svg>
    );
  }
  if (kind === "PPTX") {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="24" height="22" rx="3" fill="#ed6c47" />
        <rect x="14" y="3" width="12" height="22" rx="3" fill="#ff8f6b" opacity="0.5" />
        <rect x="2" y="7" width="13" height="14" rx="2" fill="#c43e1c" />
        <path d="M6.6 10.4h3.2c1.7 0 2.7.9 2.7 2.3s-1 2.3-2.7 2.3H8.4v2.6H6.6zm1.8 3.1h1.1c.7 0 1.1-.3 1.1-.8s-.4-.8-1.1-.8H8.4z" fill="#fff" />
      </svg>
    );
  }
  if (kind === "PDF") {
    return (
      <svg {...common}>
        <path d="M7 2.5h10l5 5V24a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 6 24V4A1.5 1.5 0 0 1 7 2.5z" fill="#fff" stroke="#6b7280" strokeWidth="1.2" />
        <path d="M17 2.5v5h5" fill="none" stroke="#6b7280" strokeWidth="1.2" />
        <rect x="3" y="12.5" width="16" height="8" rx="1.5" fill="#d93025" />
        <text x="11" y="18.7" textAnchor="middle" fontSize="6.2" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">
          PDF
        </text>
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="22" height="20" rx="3" fill="#e8f0fe" stroke="#4285f4" strokeWidth="1.4" />
      <circle cx="10" cy="11" r="2.2" fill="#4285f4" />
      <path d="M4.5 21.5l6-6 4 4 3-3 6 6" fill="none" stroke="#4285f4" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
