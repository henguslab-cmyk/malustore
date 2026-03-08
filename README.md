# MaluStore

Base inicial de marketplace com:

- Frontend em Next.js (pronto para evoluir com as telas criadas no Google Stitch)
- Backend no Supabase
- Versionamento com GitHub

## Arquitetura

- `app/`: paginas e layout do Next.js
- `lib/supabase.js`: cliente Supabase
- `.env.local`: credenciais locais do Supabase (nao versionado)

## Como rodar

```bash
npm install
npm run dev
```

Acesse: `http://localhost:3000`

Se no Windows aparecer `Error: spawn EPERM`, rode:

```bash
npm run dev:nofork
```

## Variaveis de ambiente

Crie `.env.local` com base em `.env.example`:

```bash
cp .env.example .env.local
```

## Tabela esperada no Supabase

A home faz leitura da tabela `products` com as colunas:

- `id`
- `name`
- `description`
- `price`
- `image_url`

Se sua tabela tiver nomes diferentes, ajuste a query em `app/page.js`.

## GitHub

Se ainda nao conectou o remoto:

```bash
git add .
git commit -m "chore: setup next + supabase marketplace base"
git branch -M main
git remote add origin <URL_DO_REPOSITORIO>
git push -u origin main
```

## Google Stitch

Use o Stitch para gerar/evoluir telas em Next.js e trazer os componentes para `app/` (ou `components/`).
Mantenha chamadas de dados centralizadas no Supabase para preservar essa arquitetura.

Para configurar MCP local, copie `stitch.mcp.example.json` para `stitch.mcp.json` e preencha sua chave.
