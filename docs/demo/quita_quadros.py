import sys
from pathlib import Path

from PIL import Image

# Argumentos: GIF de entrada, GIF de saida, indices dos quadros a tirar (ex: 2,4). O tempo deles vai para o quadro anterior.
entrada, saida = Path(sys.argv[1]), Path(sys.argv[2])
tirar = {int(n) for n in sys.argv[3].split(",") if n}
im = Image.open(entrada)
quadros, duracoes = [], []
for i in range(im.n_frames):
    im.seek(i)
    duracao = im.info.get("duration", 100)
    if i in tirar and quadros:
        duracoes[-1] += duracao
        continue
    quadros.append(im.convert("RGB").quantize(colors=96, method=Image.MEDIANCUT, dither=Image.Dither.NONE))
    duracoes.append(duracao)
quadros[0].save(saida, save_all=True, append_images=quadros[1:], duration=duracoes, loop=0, optimize=True, disposal=1)
print(f"quadros: {im.n_frames} -> {len(quadros)} | {saida.stat().st_size / 1e6:.1f} MB | {sum(duracoes) / 1000:.0f} s")
