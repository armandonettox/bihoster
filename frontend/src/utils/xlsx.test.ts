import { describe, expect, it } from "vitest";
import { parseCsv } from "./csvParse";
import { buildXlsx, buildZip, crc32, sheetName } from "./xlsx";

/** Leitor mínimo de zip sem compressão: devolve nome -> conteúdo, conferindo o CRC de cada arquivo. */
function lerZip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const fim = bytes.length - 22;
  expect(view.getUint32(fim, true)).toBe(0x06054b50);
  const total = view.getUint16(fim + 10, true);
  let posicao = view.getUint32(fim + 16, true);
  const arquivos: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    expect(view.getUint32(posicao, true)).toBe(0x02014b50);
    const crc = view.getUint32(posicao + 16, true);
    const tamanho = view.getUint32(posicao + 24, true);
    const nomeTam = view.getUint16(posicao + 28, true);
    const extraTam = view.getUint16(posicao + 30, true);
    const comentarioTam = view.getUint16(posicao + 32, true);
    const deslocamento = view.getUint32(posicao + 42, true);
    const nome = decoder.decode(bytes.slice(posicao + 46, posicao + 46 + nomeTam));
    expect(view.getUint32(deslocamento, true)).toBe(0x04034b50);
    const localNomeTam = view.getUint16(deslocamento + 26, true);
    const localExtraTam = view.getUint16(deslocamento + 28, true);
    const inicio = deslocamento + 30 + localNomeTam + localExtraTam;
    const dados = bytes.slice(inicio, inicio + tamanho);
    expect(crc32(dados)).toBe(crc);
    arquivos[nome] = decoder.decode(dados);
    posicao += 46 + nomeTam + extraTam + comentarioTam;
  }
  return arquivos;
}

describe("crc32", () => {
  it("bate com o valor conhecido de '123456789'", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildZip", () => {
  it("guarda os arquivos sem compressão e o leitor devolve o mesmo conteúdo", () => {
    const zip = buildZip([
      { name: "a.txt", data: new TextEncoder().encode("olá") },
      { name: "pasta/b.txt", data: new TextEncoder().encode("mundo") },
    ]);

    expect(lerZip(zip)).toEqual({ "a.txt": "olá", "pasta/b.txt": "mundo" });
  });
});

describe("buildXlsx", () => {
  const planilha = lerZip(
    buildXlsx([
      {
        name: "Vendas",
        rows: [
          ["Região", "Total", "Código"],
          ["Sul & Sudeste", "1234.5", "00123"],
          ["<Norte>", "-7", "x"],
        ],
      },
      { name: "Outra", rows: [["A"], ["1"]] },
    ]),
  );

  it("tem as partes que o Excel exige, com uma aba por planilha", () => {
    expect(Object.keys(planilha).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(planilha["xl/workbook.xml"]).toContain('<sheet name="Vendas" sheetId="1" r:id="rId1"/>');
    expect(planilha["xl/workbook.xml"]).toContain('<sheet name="Outra" sheetId="2" r:id="rId2"/>');
    expect(planilha["xl/_rels/workbook.xml.rels"]).toContain('Id="rId3"');
    expect(planilha["[Content_Types].xml"]).toContain("/xl/worksheets/sheet2.xml");
  });

  it("o cabeçalho vai em negrito e o resto como texto escapado", () => {
    const aba = planilha["xl/worksheets/sheet1.xml"];

    expect(aba).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Região</t></is></c>');
    expect(aba).toContain("Sul &amp; Sudeste");
    expect(aba).toContain("&lt;Norte&gt;");
  });

  it("números viram número e código com zero à esquerda continua texto", () => {
    const aba = planilha["xl/worksheets/sheet1.xml"];

    expect(aba).toContain('<c r="B2"><v>1234.5</v></c>');
    expect(aba).toContain('<c r="B3"><v>-7</v></c>');
    expect(aba).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>');
  });

  it("congela a primeira linha quando há dados", () => {
    expect(planilha["xl/worksheets/sheet1.xml"]).toContain('state="frozen"');
  });

  it("sem nenhuma planilha ainda gera um arquivo válido com uma aba vazia", () => {
    const vazio = lerZip(buildXlsx([]));

    expect(vazio["xl/workbook.xml"]).toContain('name="Planilha"');
  });

  it("remove caracteres de controle que o XML não aceita", () => {
    const aba = lerZip(buildXlsx([{ name: "A", rows: [["X"], ["a\u0001b"]] }]))["xl/worksheets/sheet1.xml"];

    expect(aba).toContain(">ab<");
  });
});

describe("sheetName", () => {
  it("tira os caracteres proibidos e limita a 31", () => {
    expect(sheetName("Vendas [2026]: total/região?", [])).toBe("Vendas 2026 total região");
    expect(sheetName("x".repeat(50), [])).toHaveLength(31);
  });

  it("nome vazio vira Planilha e repetido ganha número, sem diferenciar maiúscula", () => {
    expect(sheetName("///", [])).toBe("Planilha");
    expect(sheetName("Vendas", ["vendas"])).toBe("Vendas (2)");
    expect(sheetName("Vendas", ["Vendas", "Vendas (2)"])).toBe("Vendas (3)");
    expect(sheetName("y".repeat(40), ["y".repeat(31)])).toHaveLength(31);
  });
});

describe("parseCsv", () => {
  it("lê linhas simples e ignora o BOM", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("respeita aspas: vírgula, aspas duplicadas e quebra de linha dentro da célula", () => {
    expect(parseCsv('"Vendas[Região]","x, y"\n"he said ""oi""","l1\nl2"')).toEqual([
      ["Vendas[Região]", "x, y"],
      ['he said "oi"', "l1\nl2"],
    ]);
  });

  it("aceita CRLF, última linha sem quebra e células vazias", () => {
    expect(parseCsv("a,b\r\n,2\r\n3,")).toEqual([["a", "b"], ["", "2"], ["3", ""]]);
  });

  it("texto vazio não tem linhas", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(undefined)).toEqual([]);
  });
});
