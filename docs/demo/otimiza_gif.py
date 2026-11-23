import sys
from pathlib import Path

from PIL import Image

# Argumentos: GIF de entrada, GIF de saida, largura final
entrada, saida, largura = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
im = Image.open(entrada)
total = im.n_frames

# Regiao onde a ferramenta de gravacao poe o rotulo preto ("wait", "key"...): canto superior esquerdo
REGIAO = (36, 8, 84, 40)


def tem_rotulo(quadro: Image.Image) -> bool:
    recorte = quadro.crop(REGIAO).convert("L")
    pixels = list(recorte.getdata())
    escuros = sum(1 for p in pixels if p < 60)
    return escuros / len(pixels) > 0.35


quadros, duracoes, removidos = [], [], 0
im.seek(0)
cabecalho_limpo = im.convert("RGB").crop(REGIAO)  # o cabecalho da primeira tela, sem rotulo nem janela aberta
for i in range(total):
    im.seek(i)
    rgb = im.convert("RGB")
    duracao = im.info.get("duration", 100)
    if i == total - 1 and tem_rotulo(rgb):
        # O quadro final e o que fica na tela no fim: em vez de descartar, apaga o rotulo com o cabecalho limpo
        rgb.paste(cabecalho_limpo, REGIAO[:2])
    elif tem_rotulo(rgb) and quadros:
        # O quadro com rotulo sai, e o tempo dele vai para o anterior
        duracoes[-1] += duracao
        removidos += 1
        continue
    altura = round(rgb.height * largura / rgb.width)
    quadros.append(rgb.resize((largura, altura), Image.LANCZOS))
    duracoes.append(duracao)

# Ritmo mais rapido (um GIF de README precisa ser curto), sem deixar nenhum quadro abaixo de 250 ms
duracoes = [max(250, int(d * 0.6)) for d in duracoes]

# Paleta adaptativa, sem pontilhado: a interface tem cores chapadas, e o pontilhado so engorda o arquivo
pequenos = [q.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.Dither.NONE) for q in quadros]
pequenos[0].save(saida, save_all=True, append_images=pequenos[1:], duration=duracoes, loop=0, optimize=True, disposal=1)
print(f"quadros: {total} -> {len(pequenos)} (removidos com rotulo: {removidos})")
print(f"tamanho: {entrada.stat().st_size / 1e6:.1f} MB -> {saida.stat().st_size / 1e6:.1f} MB | {quadros[0].size} | {sum(duracoes) / 1000:.0f} s")
