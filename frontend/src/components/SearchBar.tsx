import { useEffect, useRef, useState, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as searchApi from "../api/search";
import type { SearchResultEntry } from "../api/search";
import { useWorkspace } from "../context/WorkspaceContext";

function highlightMatch(text: string, term: string) {
  const trimmed = term.trim();
  if (!trimmed) return text;
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="search-bar-highlight">{text.slice(index, index + trimmed.length)}</mark>
      {text.slice(index + trimmed.length)}
    </>
  );
}

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { selectWorkspace, currentWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const requestIdRef = useRef(0);
  const shortcutLabel = useMemo(
    () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "Cmd K" : "Ctrl K"),
    []
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      searchApi
        .searchReports(trimmed)
        .then((data) => {
          // Ignora respostas de buscas antigas que chegaram depois de uma mais recente.
          if (requestId !== requestIdRef.current) return;
          setResults(data);
          setActiveIndex(-1);
          setOpen(true);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function openEntry(entry: SearchResultEntry) {
    if (currentWorkspace?.id !== entry.workspace_id) {
      selectWorkspace(entry.workspace_id);
    }
    navigate("/collection");
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      openEntry(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="search-bar">
      <input
        ref={inputRef}
        className="input search-bar-input"
        placeholder="Buscar relatorios..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="search-bar-listbox"
        aria-activedescendant={activeIndex >= 0 ? `search-bar-option-${activeIndex}` : undefined}
      />
      {!query && <kbd className="search-bar-shortcut">{shortcutLabel}</kbd>}
      {open && (
        <div className="search-bar-dropdown" role="listbox" id="search-bar-listbox">
          {loading ? (
            <div style={{ padding: "8px 4px" }}>
              <div className="skeleton skeleton-line" style={{ width: "80%" }} />
              <div className="skeleton skeleton-line" style={{ width: "60%" }} />
            </div>
          ) : results.length === 0 ? (
            <p className="search-bar-empty">Nenhum relatorio encontrado.</p>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.id}
                id={`search-bar-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`search-bar-item ${index === activeIndex ? "search-bar-item-active" : ""}`}
                onClick={() => openEntry(entry)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span style={{ fontWeight: 600 }}>{highlightMatch(entry.name, query)}</span>
                <span className="badge">{entry.workspace_name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
