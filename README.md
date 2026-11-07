# Assembleia 2026

Aplicativo da Assembleia de Circuito de 2026–2027 com o superintendente de circuito: **“Feliz é aquele que confia em Jeová” — Provérbios 16:20**. A base de Bíblia, estudos e editor vem do sistema Sentinela; este aplicativo tem publicação, versão e dados próprios.

- Início: abas Manhã, Tarde e Perguntas; 11 notas por discurso, cinco respostas de revisão e atalho para A Sentinela.
- Bíblia: leitor, busca e referências da versão atual do sistema de estudo.
- Anotações: editor atual, com opção de versão anterior e cópias de recuperação.
- A Sentinela: catálogo de estudos em `estudos.html`.
- Salvar: conta, sincronização e preparação para uso offline.

Ao abrir, a aba acompanha o período da parte marcada no programa. Durante o uso, uma escolha manual de aba ou edição de anotação é preservada.

Os títulos da programação, campos e placeholders usam Noto Sans e o mesmo tamanho global de leitura (19,36px no nível 3; máximo de 30px). Os campos crescem com o conteúdo e têm espaçamento compacto. A barra inferior mantém o tamanho original.

O ícone próprio mostra um livro branco e um sol dourado sobre fundo violeta. O manifesto mantém a identidade da instalação `assembleia-2026`, enquanto a versão desta linha começa por `ass26-`.

Notas, preferências e bancos locais usam `ass26:`; caches usam `ass26-shell-v2`, `ass26-bible-v1`, `ass26-runtime-v1` e `ass26-artigos-v1`. Os registros desta programação usam o identificador permanente `ca-copgm27`, independente de horário, posição ou ano do aparelho.

Na atualização da variante anterior, os dados do namespace `assembleia-2026:` são copiados sem apagar os originais. Notas do antigo congresso ficam separadas como `legacy-congresso:` e não são associadas aos novos discursos. Os dados do aplicativo Sentinela não são importados nem apagados.

## Desenvolvimento

Sirva esta pasta com um servidor HTTP, por exemplo `python -m http.server 8000`. Antes de publicar alterações, regenere os hashes com `python scripts/build-offline-assets.py`.

Testes de persistência: `node tests/assembly-sync.cjs`.
Testes de atualização dos downloads: `node tests/assembly-cache-migration.cjs`.
Testes de isolamento em navegador: `python tests/test_app_scope.py` (requer Playwright; `WEBKIT_EXECUTABLE` habilita o teste WebKit).

## Publicação

GitHub Pages publica a raiz da branch `main` em https://sbsjonathan.github.io/assembleia-2026/.

Versão atual: `ass26-2026.11.07.2`. No iPhone, abra o endereço no Safari e use Compartilhar → Adicionar à Tela de Início.

O catálogo bíblico incluído permanece disponível no pacote. Áudios, serviços de IA e sincronização precisam de conexão. Estudos semanais devem ser baixados pela aba A Sentinela.

A base vem do commit `d6a893c6bd388a7fefe2fe1949259e4091dd63a9` de Sentinela 2026. O snapshot do editor v1 é preservado na cópia original; nesta variante, o bootstrap de armazenamento e os tipos de documentos da nuvem foram adaptados, com hashes de origem registrados no manifesto.

Programa e perguntas oficiais: https://www.jw.org/pt/biblioteca/programas/Programa-da-Assembleia-de-Circuito-de-2026-2027-com-o-Superintendente-de-Circuito/ . A conferência da base mais recente foi feita em 7 de novembro de 2026.

A sincronização compara as versões antes de gravar e guarda cópias locais das divergências conhecidas. Gravações exatamente simultâneas em aparelhos diferentes ainda exigem suporte atômico no backend para garantia completa.
