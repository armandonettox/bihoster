import { describe, expect, it } from "vitest";
import { childrenOf, descendantIds, pathTo, topLevel } from "./folders";

const items = [
  { id: 1, parent_id: null },
  { id: 2, parent_id: 1 },
  { id: 3, parent_id: 2 },
  { id: 4, parent_id: 1 },
  { id: 5 },
  { id: 9, parent_id: 8 }, // o pai (8) a pessoa nao acessa
];

describe("folders", () => {
  it("as pastas de topo sao as sem pai ou com um pai que a pessoa nao ve", () => {
    expect(topLevel(items).map((i) => i.id)).toEqual([1, 5, 9]);
  });

  it("filhas diretas", () => {
    expect(childrenOf(items, 1).map((i) => i.id)).toEqual([2, 4]);
    expect(childrenOf(items, 3)).toEqual([]);
  });

  it("descendentes em qualquer nivel, sem a propria pasta", () => {
    expect([...descendantIds(items, 1)].sort()).toEqual([2, 3, 4]);
    expect([...descendantIds(items, 5)]).toEqual([]);
  });

  it("caminho do topo ate a pasta", () => {
    expect(pathTo(items, 3).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(pathTo(items, 5).map((i) => i.id)).toEqual([5]);
    expect(pathTo(items, 99)).toEqual([]);
  });

  it("dado sujo com ciclo nao trava", () => {
    const ciclo = [
      { id: 1, parent_id: 2 },
      { id: 2, parent_id: 1 },
    ];

    expect(pathTo(ciclo, 1).length).toBeLessThanOrEqual(2);
    expect(descendantIds(ciclo, 1).has(2)).toBe(true);
  });
});
