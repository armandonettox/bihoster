# Como gravar o GIF de demonstração

O GIF do README (`docs/demo.gif`) é gravado com um **Power BI de mentira**, para mostrar relatórios sem usar nenhum dado
real. Tudo roda no seu computador e nada disso entra no sistema de produção.

| Arquivo | Para que serve |
|---|---|
| `fake_powerbi.py` | Responde o mínimo que o BIHoster pede ao Azure AD e à API do Power BI e serve uma página de dashboard no lugar do relatório embutido. Os números vêm de `demo_data.json` e são inventados. |
| `demo_data.json` | Coleções, relatórios, números e cores da demonstração. Edite aqui para mudar o que aparece. |
| `embed_template.html` | A página que faz o papel do relatório do Power BI. |
| `run_demo.py` | Sobe o backend com um banco temporário novo, apontado para o Power BI de mentira (troca só os dois endereços do Power BI, só nesta execução). |
| `seed_demo.py` | Cria a conta, a conexão, 3 coleções, 6 relatórios e as miniaturas. |
| `serve_demo.py` | Serve o frontend compilado e repassa `/api` e `/static` ao backend, como o nginx. Também injeta o trecho que redireciona o iframe do relatório (a biblioteca do Power BI só aceita HTTPS de um domínio `*.powerbi.com`). |
| `otimiza_gif.py`, `quita_quadros.py` | Reduzem o GIF gravado (tamanho, ritmo e quadros indesejados). Precisam do Pillow. |

## Passo a passo

```bash
# 1. Compilar o frontend para servir na raiz (o /api vira o proxy)
cd frontend && VITE_API_URL=/api npm run build && cd ..

# 2. Backend de demonstração (porta 8000) e, em outro terminal, os dados
python docs/demo/run_demo.py
python docs/demo/seed_demo.py

# 3. Frontend (porta 5180)
python docs/demo/serve_demo.py
```

Abra `http://localhost:5180` e entre com `demo@example.com` / `DemoSenha123` (conta que só existe nesse banco temporário).
Grave a tela com a ferramenta que preferir. Depois reduza o GIF:

```bash
pip install pillow
python docs/demo/otimiza_gif.py gravacao.gif demo-passo1.gif 1000      # largura final em pixels
python docs/demo/quita_quadros.py demo-passo1.gif docs/demo.gif 2,4     # opcional: tira quadros pelo número
```

O `otimiza_gif.py` troca a paleta (sem pontilhado), acelera o ritmo e descarta os quadros em que a ferramenta de gravação
desenhou um rótulo no canto superior esquerdo. Ajuste a constante `REGIAO` dele se a sua ferramenta marcar outro canto.

## Cuidados

- A porta 5180 e a 8000 precisam estar livres. Se outro programa usar uma delas, mude com as variáveis `DEMO_WEB_PORT` e
  `DEMO_API_PORT`, e `DEMO_FRONTEND_ORIGIN` no `run_demo.py`.
- Todos os nomes e números da demonstração são fictícios. Não coloque dado real em `demo_data.json`.
- Mantenha o GIF abaixo de uns 2 MB para o README carregar rápido.
