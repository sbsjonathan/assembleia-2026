# Assembleia 2026

Aplicativo da Assembleia de Circuito de 2026–2027 com o superintendente de circuito: **“Feliz é aquele que confia em Jeová” — Provérbios 16:20**. A base de Bíblia, estudos e editor vem do sistema Sentinela; este aplicativo tem publicação, versão e dados próprios.

- Início: abas Manhã, Tarde e Perguntas; 11 notas por discurso, cinco respostas de revisão e atalho para A Sentinela.
- Bíblia: leitor, busca e referências da versão atual do sistema de estudo.
- Anotações: editor atual, com opção de versão anterior e cópias de recuperação.
- A Sentinela: abre diretamente o estudo da semana corrente, calculada no momento do toque. O catálogo continua disponível em `estudos.html`.
- Salvar: conta, sincronização e preparação para uso offline.

Ao abrir, a aba acompanha o período da parte marcada no programa. Durante o uso, uma escolha manual de aba ou edição de anotação é preservada.

Ao sair da anotação em tela cheia, o programa retorna à aba e ao campo editado e gera o resumo. O texto integral, incluindo blocos recolhidos, continua disponível ao expandir novamente. Anotações de até 50 caracteres são reproduzidas sem IA; a partir de 51 caracteres, o resumidor pode ser acionado. Falhas do serviço permitem uma nova tentativa ao reabrir e sair da anotação.

Os títulos da programação, campos e placeholders usam Noto Sans e o mesmo tamanho global de leitura (19,36px no nível 3; máximo de 30px). Os campos crescem com o conteúdo e têm espaçamento compacto. A barra inferior mantém o tamanho original.

Os seis cânticos do programa abrem as respectivas páginas oficiais do JW.org, com letra e áudio. O atalho “Resumo de A Sentinela” também acompanha a semana corrente, mesmo se o aplicativo permanecer aberto na virada de domingo para segunda.

O ícone próprio representa as fileiras e o palco de um auditório, em roxo sobre lavanda clara. O manifesto mantém a identidade da instalação `assembleia-2026`, enquanto a versão desta linha começa por `ass26-`.

Notas, preferências e bancos locais usam `ass26:`; caches usam `ass26-shell-v5`, `ass26-bible-v1`, `ass26-runtime-v1` e `ass26-artigos-v1`. Os registros desta programação usam o identificador permanente `ca-copgm27`, independente de horário, posição ou ano do aparelho.

Na atualização da variante anterior, os dados do namespace `assembleia-2026:` são copiados sem apagar os originais. Notas do antigo congresso ficam separadas como `legacy-congresso:` e não são associadas aos novos discursos. Os dados do aplicativo Sentinela não são importados nem apagados.

## Desenvolvimento

Sirva esta pasta com um servidor HTTP, por exemplo `python -m http.server 8000`. Antes de publicar alterações, regenere os hashes com `python scripts/build-offline-assets.py`.

Testes de persistência: `node tests/assembly-sync.cjs`.
Testes de atualização dos downloads: `node tests/assembly-cache-migration.cjs`.
Testes de isolamento em navegador: `python tests/test_app_scope.py` (requer Playwright; `WEBKIT_EXECUTABLE` habilita o teste WebKit).
Testes de abertura da semana corrente: `python tests/test_current_study.py`.
Testes de seleção, composição e viewport do editor: `python tests/test_program_caret.py`. O teclado é simulado nesses testes; a validação nativa é feita no iPhone.
Testes de ida e volta da anotação, resumo e recuperação de falhas: `python tests/test_program_summary.py`.

## Publicação

GitHub Pages publica a raiz da branch `main` em https://sbsjonathan.github.io/assembleia-2026/.

Versão atual: `ass26-2026.11.07.5`. No iPhone, abra o endereço no Safari e use Compartilhar → Adicionar à Tela de Início.

O catálogo bíblico incluído permanece disponível no pacote. Cânticos externos, áudios, serviços de IA e sincronização precisam de conexão. A Sentinela consulta primeiro o estudo semanal já baixado; sem download nem conexão, informa que o estudo está indisponível.

A base vem do commit `d6a893c6bd388a7fefe2fe1949259e4091dd63a9` de Sentinela 2026. O snapshot do editor v1 é preservado na cópia original; nesta variante, o bootstrap de armazenamento e os tipos de documentos da nuvem foram adaptados, com hashes de origem registrados no manifesto.

Programa e perguntas oficiais: https://www.jw.org/pt/biblioteca/programas/Programa-da-Assembleia-de-Circuito-de-2026-2027-com-o-Superintendente-de-Circuito/ . A conferência da base mais recente foi feita em 7 de novembro de 2026.

A sincronização compara as versões antes de gravar e guarda cópias locais das divergências conhecidas. Gravações exatamente simultâneas em aparelhos diferentes ainda exigem suporte atômico no backend para garantia completa.
