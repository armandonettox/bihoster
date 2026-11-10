import { describe, expect, it } from "vitest";
import { csvHeaders } from "./csvHeaders";

describe("csvHeaders", () => {
  it("separa os cabecalhos da primeira linha", () => {
    expect(csvHeaders("dim_unidade[uf],[Vidas Ativas]\nES,9648\nCE,4634")).toEqual(["dim_unidade[uf]", "[Vidas Ativas]"]);
  });

  it("tira as aspas e respeita virgula dentro delas", () => {
    expect(csvHeaders('"Tabela[Col, com virgula]","[Medida]"\r\nx,1')).toEqual(["Tabela[Col, com virgula]", "[Medida]"]);
  });

  it("aspas duplicadas dentro de aspas valem uma aspa", () => {
    expect(csvHeaders('"Ela disse ""oi""",b')).toEqual(['Ela disse "oi"', "b"]);
  });

  it("ignora cabecalhos vazios e espacos nas pontas", () => {
    expect(csvHeaders(" a , ,b,")).toEqual(["a", "b"]);
  });

  it("sem dados devolve lista vazia", () => {
    expect(csvHeaders("")).toEqual([]);
    expect(csvHeaders(undefined)).toEqual([]);
    expect(csvHeaders(null)).toEqual([]);
  });
});
