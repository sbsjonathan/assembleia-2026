# Assembleia 2026

Aplicativo de programação, Bíblia e anotações baseado no sistema de estudo Sentinela, com a página inicial do Congresso 2026.

- Início: programação de sexta-feira, sábado e domingo, notas por discurso e resumos.
- Bíblia: leitor, busca e referências da versão atual do sistema de estudo.
- Anotações: editor atual, com opção de versão anterior e cópias de recuperação.
- A Sentinela: catálogo de estudos em `estudos.html`.
- Salvar: conta, sincronização e preparação para uso offline.

O nome instalado e os ícones são próprios deste aplicativo. As notas, preferências, bancos locais, canais de conexão e caches têm identificação separada da instalação do Sentinela. Não há importação automática de dados de outros aplicativos.

## Desenvolvimento

Sirva esta pasta com um servidor HTTP, por exemplo `python -m http.server 8000`. Antes de publicar alterações, regenere os hashes com `python scripts/build-offline-assets.py`.

Testes de persistência: `node tests/assembly-sync.cjs`.
Testes de isolamento em navegador: `python tests/test_app_scope.py` (requer Playwright; `WEBKIT_EXECUTABLE` habilita o teste WebKit).

## Publicação

GitHub Pages publica a raiz da branch `main` em https://sbsjonathan.github.io/assembleia-2026/.

O catálogo bíblico incluído permanece disponível no pacote. Áudios, serviços de IA e sincronização precisam de conexão. Estudos semanais devem ser baixados pela aba A Sentinela.

A base vem do commit `d6a893c6bd388a7fefe2fe1949259e4091dd63a9` de Sentinela 2026. O snapshot do editor v1 é preservado na cópia original; nesta variante, o bootstrap de armazenamento e os tipos de documentos da nuvem foram adaptados, com hashes de origem registrados no manifesto.

A sincronização compara as versões antes de gravar e guarda cópias locais das divergências conhecidas. Gravações exatamente simultâneas em aparelhos diferentes ainda exigem suporte atômico no backend para garantia completa.
