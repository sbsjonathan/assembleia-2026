# Destaques das perguntas

A extração colorida é independente da resposta escrita. A marcação usa somente a pergunta sem seu número e os parágrafos associados. O pedido retorna cláusulas da pergunta e citações literais mínimas; um rótulo curto `fact` identifica a informação necessária antes da citação. Esse rótulo não aparece na interface. Não são pedidos resumos, explicações, imagens, busca externa, âncoras duplicadas ou conteúdo de anotações pessoais no caminho de destaque.

A resposta conversacional e a aba de leitura literal mantêm suas instruções e configuração anteriores em outro pedido, executado em paralelo. Seus textos não delimitam as marcas. Falhas da resposta escrita não impedem os destaques, e uma falha na extração não apaga marcas anteriores. Pedidos simultâneos da mesma pergunta compartilham uma execução de cada tipo. A conclusão assíncrona preserva a aba selecionada.

## Cores e precisão

- Amarelo, verde e azul representam a primeira, segunda e terceira solicitações reais, na ordem da pergunta original. A ordem do JSON não determina a cor.
- Um grupo como 1–2 não representa duas perguntas. Vírgulas, listas de acontecimentos e perguntas mencionadas no corpo da resposta não criam novas cores.
- As cláusulas retornadas precisam corresponder ao enunciado. Sem uma divisão verificável, os trechos permanecem amarelos.
- Cada citação deve ocorrer de forma inequívoca no parágrafo indicado. Não existe expansão por semelhança, distância de edição ou uma única âncora.
- As seleções são validadas antes de substituir marcas anteriores. Trechos inválidos, ambíguos, fora de contexto ou inteiramente protegidos preservam o estado anterior.
- Marcas manuais nunca são sobrescritas. Recolorir uma marca de IA manualmente transfere seu controle ao usuário.
- Referências de apoio entre parênteses, referências finais após travessão e notas ficam sem cor. Um link que integra a resposta — como o Salmo 91 que será estudado — pode ser marcado sem perder a interação.
- A aplicação preserva o texto e os elementos do artigo, não aninha marcas e salva cada parágrafo alterado uma vez.

## Modelos

Verificação em 8 de novembro de 2026:

- Principal da extração: `gemini-3.5-flash-lite`, estável, com `thinkingLevel: minimal` e teto de 1.536 tokens de saída.
- Alternativa econômica: `gemini-3.1-flash-lite`, estável.
- O antigo `gemini-3.1-flash-lite-preview` está listado como desligado em 25 de maio de 2026. Ele não integra mais a seleção de modelos do marcador. Os outros agentes não são alterados por esta configuração.
- Preços de referência por milhão de tokens: 3.5 Flash-Lite US$ 0,30 de entrada / US$ 2,50 de saída; 3.1 Flash-Lite US$ 0,25 / US$ 1,50. Saída inclui pensamento. O proxy não retorna contagem de uso, portanto tamanho em caracteres não é apresentado como custo ou contagem de tokens.

Fontes oficiais: [modelos e descontinuação](https://ai.google.dev/gemini-api/docs/deprecations), [3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [preços](https://ai.google.dev/gemini-api/docs/pricing), [configuração de pensamento](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

## Validação

`python tests/test_question_highlight_core.py` valida classificação, correspondência literal, cores, referências e preservação de marcas. `python tests/test_question_highlights.py` valida a integração, as chamadas paralelas, falhas independentes, persistência, três cores e conteúdo da resposta escrita. Ambos executam em Chromium; `WEBKIT_EXECUTABLE` habilita WebKit. As suítes não chamam serviços reais.

Também foram feitos ensaios pequenos no proxy real, somente com o texto público dos casos fornecidos. A extração isolada identificou uma pergunta para os parágrafos 1–2; no parágrafo 3, terminou em “como ele vai nos proteger no futuro?”, excluindo a transição “Mas antes…”. A versão combinada com resposta escrita repetia essa transição, motivo da separação. Esses ensaios não são uma garantia de acerto em todos os estudos: novos exemplos devem ampliar a base de regressão.

Marcas antigas não são apagadas automaticamente. Para aplicar a nova extração a uma pergunta já salva, gere novamente sua resposta pelo ícone de IA.
